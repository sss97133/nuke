// Backfill ai_suggestion into metadata for the 4 existing needs_input events
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VEHICLE_ID = 'a90c008a-3379-41d8-9eb2-b4eda365d74c';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const events = [
  { id: '34de5ff1-d811-4da4-a703-90456e2f609e', date: '2025-09-25' },
  { id: '6f94fe4b-8697-4653-a7ff-18c016604f12', date: '2025-10-18' },
  { id: '93a0b0dc-effe-4863-afa6-d938d0580709', date: '2026-02-10' },
  { id: '4b622d7f-7bb3-46ba-a2b9-02a6fda4705e', date: '2025-10-01' },
];

// Fetch image IDs for each event by timeline_event_id
async function getImageIds(eventId) {
  const { data } = await supabase
    .from('vehicle_images')
    .select('id')
    .eq('vehicle_id', VEHICLE_ID)
    .eq('timeline_event_id', eventId)
    .limit(8);
  return (data || []).map(i => i.id);
}

async function getSuggestion(eventId, date, imageIds) {
  if (imageIds.length === 0) return null;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/suggest-bundle-label`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ vehicle_id: VEHICLE_ID, bundle_date: date, image_ids: imageIds }),
  });
  if (!res.ok) { console.error('suggest failed for', date, res.status); return null; }
  return res.json();
}

// Run all in parallel
const results = await Promise.allSettled(
  events.map(async (ev) => {
    const imageIds = await getImageIds(ev.id);
    console.log(`${ev.date}: ${imageIds.length} images`);

    const suggestion = await getSuggestion(ev.id, ev.date, imageIds);
    if (!suggestion) return { ev, suggestion: null };

    console.log(`${ev.date}: AI → "${suggestion.title}" (${suggestion.event_type}, ${Math.round(suggestion.confidence * 100)}%)`);
    return { ev, suggestion };
  })
);

// Write suggestions back to DB
for (const result of results) {
  if (result.status !== 'fulfilled' || !result.value.suggestion) continue;
  const { ev, suggestion } = result.value;

  // Get current metadata first
  const { data: current } = await supabase
    .from('timeline_events')
    .select('metadata, title, event_type')
    .eq('id', ev.id)
    .single();

  const VALID_DB_EVENT_TYPES = new Set([
    'purchase', 'sale', 'registration', 'inspection', 'maintenance', 'repair',
    'modification', 'accident', 'insurance_claim', 'recall', 'ownership_transfer',
    'lien_change', 'title_update', 'mileage_reading', 'other', 'pending_analysis',
    'profile_merge', 'profile_merged', 'vehicle_added', 'vin_added', 'work_completed',
    'service', 'auction_listed', 'auction_started', 'auction_bid_placed',
    'auction_reserve_met', 'auction_extended', 'auction_ending_soon',
    'auction_ended', 'auction_sold', 'auction_reserve_not_met',
  ]);
  const safeType = VALID_DB_EVENT_TYPES.has(suggestion.event_type)
    ? suggestion.event_type
    : current?.event_type || 'other';

  const { error } = await supabase
    .from('timeline_events')
    .update({
      // Update title with AI suggestion if it's still the generic placeholder
      title: (current?.title?.startsWith('Photo session') || current?.title?.startsWith('Initial photo') || current?.title?.startsWith('Second photo') || current?.title?.startsWith('Pre-sale') || current?.title?.startsWith('BaT listing'))
        ? suggestion.title
        : current?.title,
      event_type: safeType,
      confidence_score: Math.max(40, Math.round(suggestion.confidence * 100)),
      metadata: {
        ...(current?.metadata || {}),
        ai_suggestion: {
          title: suggestion.title,
          event_type: suggestion.event_type,
          confidence: suggestion.confidence,
          reasoning: suggestion.reasoning,
        },
      },
    })
    .eq('id', ev.id);

  if (error) {
    console.error(`Failed to update ${ev.date}:`, error.message);
  } else {
    console.log(`✓ ${ev.date} updated with suggestion`);
  }
}

console.log('\nDone.');
