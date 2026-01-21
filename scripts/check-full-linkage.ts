import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function checkFullLinkage() {
  console.log('=== FULL LINKAGE CHECK ===\n');

  // 1. Get unique vehicle_ids directly linked in auction_comments
  const { data: directLinked } = await supabase
    .from('auction_comments')
    .select('vehicle_id')
    .not('vehicle_id', 'is', null);

  const directVehicleIds = new Set(directLinked?.map(c => c.vehicle_id) || []);
  console.log(`Direct vehicle_id links in auction_comments: ${directVehicleIds.size}`);

  // 2. Get unique vehicle_ids via auction_events
  const { data: viaEvents } = await supabase
    .from('auction_events')
    .select('vehicle_id')
    .not('vehicle_id', 'is', null);

  const eventVehicleIds = new Set(viaEvents?.map(e => e.vehicle_id) || []);
  console.log(`Unique vehicles in auction_events: ${eventVehicleIds.size}`);

  // 3. Check comments that have auction_event_id but might be missing vehicle_id
  const { data: sampleWithEvent } = await supabase
    .from('auction_comments')
    .select('id, vehicle_id, auction_event_id')
    .not('auction_event_id', 'is', null)
    .limit(5);

  console.log('\nSample comments with auction_event_id:');
  console.log(JSON.stringify(sampleWithEvent, null, 2));

  // 4. For each auction_event, count comments
  const { data: eventCounts } = await supabase
    .from('auction_events')
    .select('id, vehicle_id, total_comments, total_bids, auction_url')
    .gt('total_comments', 50)
    .order('total_comments', { ascending: false })
    .limit(20);

  console.log('\nAuction events with 50+ comments:');
  for (const e of eventCounts || []) {
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('listing_title')
      .eq('id', e.vehicle_id)
      .maybeSingle();

    console.log(`${e.total_comments} comments | ${e.total_bids} bids | ${vehicle?.listing_title?.slice(0, 50) || 'Unknown'}...`);
  }

  // 5. Verify comments link via auction_event_id
  if (eventCounts && eventCounts[0]) {
    const testEventId = eventCounts[0].id;
    const { count } = await supabase
      .from('auction_comments')
      .select('*', { count: 'exact', head: true })
      .eq('auction_event_id', testEventId);

    console.log(`\nVerification: Event ${testEventId} has ${count} comments in auction_comments`);
    console.log(`  Expected: ${eventCounts[0].total_comments}`);
  }

  // 6. Count comments that CAN be linked via auction_event
  const { count: linkableViaEvent } = await supabase
    .from('auction_comments')
    .select('*', { count: 'exact', head: true })
    .not('auction_event_id', 'is', null);

  console.log(`\nComments linkable via auction_event_id: ${linkableViaEvent?.toLocaleString()}`);

  // 7. Find comments without any linkage
  const { count: orphanedComments } = await supabase
    .from('auction_comments')
    .select('*', { count: 'exact', head: true })
    .is('vehicle_id', null)
    .is('auction_event_id', null);

  console.log(`Truly orphaned comments (no links): ${orphanedComments?.toLocaleString()}`);
}

checkFullLinkage().catch(console.error);
