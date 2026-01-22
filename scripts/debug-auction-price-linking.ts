/**
 * Debug why auction prices aren't linking
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('=== DEBUG AUCTION PRICE LINKING ===\n');

  // 1. Check a sample external_listing with price
  const { data: sampleListing } = await supabase
    .from('external_listings')
    .select('*')
    .not('final_price', 'is', null)
    .limit(1)
    .single();

  if (sampleListing) {
    console.log('Sample external_listing with price:');
    console.log(`  ID: ${sampleListing.id}`);
    console.log(`  vehicle_id: ${sampleListing.vehicle_id}`);
    console.log(`  listing_url: ${sampleListing.listing_url}`);
    console.log(`  final_price: $${sampleListing.final_price?.toLocaleString()}`);
    console.log(`  platform: ${sampleListing.platform}`);

    // Check if this vehicle has an auction_event
    if (sampleListing.vehicle_id) {
      const { data: matchingEvent } = await supabase
        .from('auction_events')
        .select('*')
        .eq('vehicle_id', sampleListing.vehicle_id)
        .maybeSingle();

      if (matchingEvent) {
        console.log('\nMatching auction_event found!');
        console.log(`  ID: ${matchingEvent.id}`);
        console.log(`  final_price: ${matchingEvent.final_price}`);
        console.log(`  auction_url: ${matchingEvent.auction_url}`);
      } else {
        console.log('\nNo matching auction_event for this vehicle_id');
      }
    }
  }

  // 2. Check auction_events structure
  const { data: sampleEvent } = await supabase
    .from('auction_events')
    .select('*')
    .limit(1)
    .single();

  console.log('\n\nSample auction_event:');
  if (sampleEvent) {
    console.log(`  ID: ${sampleEvent.id}`);
    console.log(`  vehicle_id: ${sampleEvent.vehicle_id}`);
    console.log(`  auction_url: ${sampleEvent.auction_url}`);
    console.log(`  source: ${sampleEvent.source}`);
    console.log(`  source_url: ${sampleEvent.source_url}`);
    console.log(`  final_price: ${sampleEvent.final_price}`);
    console.log(`  sale_status: ${sampleEvent.sale_status}`);
  }

  // 3. Try to match by URL instead of vehicle_id
  console.log('\n\n=== MATCHING BY URL ===');

  // Get external_listings with prices
  const { data: listingsWithPrices } = await supabase
    .from('external_listings')
    .select('id, listing_url, final_price, vehicle_id')
    .not('final_price', 'is', null)
    .limit(100);

  let urlMatches = 0;
  let vehicleIdMatches = 0;

  for (const listing of listingsWithPrices || []) {
    // Try URL match
    const { data: urlMatch } = await supabase
      .from('auction_events')
      .select('id')
      .or(`auction_url.eq.${listing.listing_url},source_url.eq.${listing.listing_url}`)
      .maybeSingle();

    if (urlMatch) urlMatches++;

    // Try vehicle_id match
    if (listing.vehicle_id) {
      const { data: vidMatch } = await supabase
        .from('auction_events')
        .select('id')
        .eq('vehicle_id', listing.vehicle_id)
        .maybeSingle();

      if (vidMatch) vehicleIdMatches++;
    }
  }

  console.log(`URL matches: ${urlMatches} / 100`);
  console.log(`Vehicle ID matches: ${vehicleIdMatches} / 100`);

  // 4. Check if auction_events have vehicle_ids at all
  const { count: eventsWithVehicle } = await supabase
    .from('auction_events')
    .select('*', { count: 'exact', head: true })
    .not('vehicle_id', 'is', null);

  const { count: totalEvents } = await supabase.from('auction_events').select('*', { count: 'exact', head: true });

  console.log(`\nAuction events with vehicle_id: ${eventsWithVehicle} / ${totalEvents}`);

  // 5. Check external_listings with vehicle_ids
  const { count: listingsWithVehicle } = await supabase
    .from('external_listings')
    .select('*', { count: 'exact', head: true })
    .not('vehicle_id', 'is', null);

  const { count: totalListings } = await supabase.from('external_listings').select('*', { count: 'exact', head: true });

  console.log(`External listings with vehicle_id: ${listingsWithVehicle} / ${totalListings}`);
}

main().catch(console.error);
