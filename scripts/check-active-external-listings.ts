import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function checkActiveListings() {
  console.log('=== ACTIVE VEHICLE EVENTS ===\n');

  // Find active/live vehicle events
  const { data: listings, error } = await supabase
    .from('vehicle_events')
    .select('id, vehicle_id, source_platform, source_url, event_status, current_price, bid_count, view_count, ended_at, updated_at')
    .in('event_status', ['active', 'live'])
    .order('updated_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${listings?.length || 0} active events:\n`);

  for (const l of listings || []) {
    const endTime = l.ended_at ? new Date(l.ended_at) : null;
    const remaining = endTime ? Math.max(0, endTime.getTime() - Date.now()) / 1000 / 60 : null;

    console.log(`ID: ${l.id}`);
    console.log(`  Vehicle: ${l.vehicle_id}`);
    console.log(`  Platform: ${l.source_platform}`);
    console.log(`  Status: ${l.event_status}`);
    console.log(`  Current Price: $${l.current_price?.toLocaleString() || 'N/A'}`);
    console.log(`  Bid Count: ${l.bid_count ?? 'N/A'}`);
    console.log(`  Views: ${l.view_count ?? 'N/A'}`);
    console.log(`  End Date: ${l.ended_at || 'N/A'}`);
    console.log(`  Time Remaining: ${remaining !== null ? `${remaining.toFixed(1)} minutes` : 'N/A'}`);
    console.log(`  URL: ${l.source_url}`);
    console.log('');
  }

  // Also check the GT500CR specifically (from earlier conversation)
  console.log('=== GT500CR STATUS ===\n');
  const { data: gt500 } = await supabase
    .from('vehicle_events')
    .select('*')
    .ilike('source_url', '%gt500cr%')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (gt500) {
    console.log('GT500CR Vehicle Event:');
    console.log(`  ID: ${gt500.id}`);
    console.log(`  Status: ${gt500.event_status}`);
    console.log(`  Current Price: $${gt500.current_price?.toLocaleString()}`);
    console.log(`  End Date: ${gt500.ended_at}`);
    console.log(`  Extracted At: ${gt500.extracted_at}`);
    console.log(`  Updated: ${gt500.updated_at}`);
  } else {
    console.log('GT500CR not found in vehicle_events');
  }
}

checkActiveListings().catch(console.error);
