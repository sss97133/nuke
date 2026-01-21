import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function checkLinkage() {
  console.log('=== COMMENT LINKAGE ANALYSIS ===\n');

  // 1. Check auction_comments table structure
  const { data: sampleComments } = await supabase
    .from('auction_comments')
    .select('id, vehicle_id, auction_event_id, auction_platform, author_username, bid_amount, posted_at')
    .limit(10);

  console.log('Sample auction_comments:');
  console.log(JSON.stringify(sampleComments, null, 2));

  // 2. Count comments WITH vehicle_id
  const { count: withVehicleId } = await supabase
    .from('auction_comments')
    .select('*', { count: 'exact', head: true })
    .not('vehicle_id', 'is', null);

  // 3. Count comments WITHOUT vehicle_id
  const { count: withoutVehicleId } = await supabase
    .from('auction_comments')
    .select('*', { count: 'exact', head: true })
    .is('vehicle_id', null);

  console.log(`\nComments WITH vehicle_id: ${withVehicleId?.toLocaleString()}`);
  console.log(`Comments WITHOUT vehicle_id: ${withoutVehicleId?.toLocaleString()}`);

  // 4. Get distinct vehicle_ids
  const { data: vehicleIds } = await supabase
    .from('auction_comments')
    .select('vehicle_id')
    .not('vehicle_id', 'is', null)
    .limit(100000);

  const uniqueVehicleIds = new Set(vehicleIds?.map(c => c.vehicle_id) || []);
  console.log(`Unique vehicle_ids in comments: ${uniqueVehicleIds.size}`);

  // 5. Check auction_events linkage
  const { count: totalAuctionEvents } = await supabase
    .from('auction_events')
    .select('*', { count: 'exact', head: true });

  console.log(`\nTotal auction_events: ${totalAuctionEvents?.toLocaleString()}`);

  // 6. Check comments by auction_event_id
  const { count: withEventId } = await supabase
    .from('auction_comments')
    .select('*', { count: 'exact', head: true })
    .not('auction_event_id', 'is', null);

  console.log(`Comments WITH auction_event_id: ${withEventId?.toLocaleString()}`);

  // 7. Sample auction_events
  const { data: sampleEvents } = await supabase
    .from('auction_events')
    .select('id, vehicle_id, platform, auction_url, total_comments, total_bids')
    .limit(5);

  console.log('\nSample auction_events:');
  console.log(JSON.stringify(sampleEvents, null, 2));

  // 8. Check if we can link comments through auction_events
  if (sampleEvents && sampleEvents.length > 0) {
    const eventId = sampleEvents[0].id;
    const { count: commentsForEvent } = await supabase
      .from('auction_comments')
      .select('*', { count: 'exact', head: true })
      .eq('auction_event_id', eventId);

    console.log(`\nComments for first auction_event: ${commentsForEvent}`);
  }

  // 9. Check vehicles table has matching IDs
  const sampleVehicleId = Array.from(uniqueVehicleIds)[0];
  if (sampleVehicleId) {
    const { data: matchingVehicle } = await supabase
      .from('vehicles')
      .select('id, listing_title, bat_auction_url')
      .eq('id', sampleVehicleId)
      .single();

    console.log(`\nSample vehicle match for ${sampleVehicleId}:`);
    console.log(JSON.stringify(matchingVehicle, null, 2));
  }

  // 10. Find unlinked comments that could be linked
  const { data: orphanedByUrl } = await supabase
    .from('auction_comments')
    .select('id, auction_url')
    .is('vehicle_id', null)
    .not('auction_url', 'is', null)
    .limit(10);

  console.log('\nOrphaned comments with auction_url (could be linked):');
  for (const c of orphanedByUrl || []) {
    console.log(`  ${c.auction_url?.slice(0, 60)}...`);
  }
}

checkLinkage().catch(console.error);
