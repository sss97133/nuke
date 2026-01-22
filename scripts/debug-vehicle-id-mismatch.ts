/**
 * Debug why vehicle_ids don't match between tables
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('=== DEBUG VEHICLE ID MISMATCH ===\n');

  // Get a sample listing with price
  const { data: listing } = await supabase
    .from('external_listings')
    .select('id, vehicle_id, final_price, listing_url')
    .not('final_price', 'is', null)
    .not('vehicle_id', 'is', null)
    .limit(1)
    .single();

  if (!listing) {
    console.log('No listing found');
    return;
  }

  console.log('External listing:');
  console.log(`  vehicle_id: ${listing.vehicle_id}`);
  console.log(`  listing_url: ${listing.listing_url}`);
  console.log(`  final_price: ${listing.final_price}`);

  // Check if this vehicle exists
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .eq('id', listing.vehicle_id)
    .maybeSingle();

  if (vehicle) {
    console.log(`\nVehicle exists: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  } else {
    console.log('\nVehicle DOES NOT exist!');
  }

  // Check all auction_events for this vehicle
  const { data: events, count } = await supabase
    .from('auction_events')
    .select('*', { count: 'exact' })
    .eq('vehicle_id', listing.vehicle_id);

  console.log(`\nAuction events for this vehicle_id: ${count}`);
  if (events && events.length > 0) {
    console.log('Event:', JSON.stringify(events[0], null, 2));
  }

  // Get any auction_event to compare
  console.log('\n\n=== COMPARE TABLES ===');

  // Get sample vehicle_ids from each table
  const { data: listingIds } = await supabase
    .from('external_listings')
    .select('vehicle_id')
    .not('vehicle_id', 'is', null)
    .limit(10);

  const { data: eventIds } = await supabase
    .from('auction_events')
    .select('vehicle_id')
    .not('vehicle_id', 'is', null)
    .limit(10);

  console.log('External listing vehicle_ids:');
  listingIds?.forEach(l => console.log(`  ${l.vehicle_id}`));

  console.log('\nAuction event vehicle_ids:');
  eventIds?.forEach(e => console.log(`  ${e.vehicle_id}`));

  // Check overlap
  const listingIdSet = new Set(listingIds?.map(l => l.vehicle_id) || []);
  const eventIdSet = new Set(eventIds?.map(e => e.vehicle_id) || []);

  const overlap = [...listingIdSet].filter(id => eventIdSet.has(id));
  console.log(`\nOverlap in sample: ${overlap.length} / 10`);

  // Bigger sample
  const { data: allListingIds } = await supabase
    .from('external_listings')
    .select('vehicle_id')
    .not('vehicle_id', 'is', null)
    .limit(3000);

  const { data: allEventIds } = await supabase
    .from('auction_events')
    .select('vehicle_id')
    .not('vehicle_id', 'is', null)
    .limit(4000);

  const bigListingSet = new Set(allListingIds?.map(l => l.vehicle_id) || []);
  const bigEventSet = new Set(allEventIds?.map(e => e.vehicle_id) || []);

  const bigOverlap = [...bigListingSet].filter(id => bigEventSet.has(id));
  console.log(`\nBigger sample overlap: ${bigOverlap.length} / ${bigListingSet.size} listings have matching events`);
}

main().catch(console.error);
