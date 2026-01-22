/**
 * Backfill auction_events with final_price
 *
 * BaT extraction captures sold prices but they may not be in auction_events.
 * Check external_listings and vehicles for price data to backfill.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('=== BACKFILL AUCTION PRICES ===\n');

  // 1. Check current state
  const { count: totalEvents } = await supabase.from('auction_events').select('*', { count: 'exact', head: true });
  const { count: eventsWithPrice } = await supabase.from('auction_events').select('*', { count: 'exact', head: true }).not('final_price', 'is', null);

  console.log(`Auction events: ${(totalEvents || 0).toLocaleString()}`);
  console.log(`With final_price: ${(eventsWithPrice || 0).toLocaleString()}`);

  // 2. Check external_listings for price data
  const { count: listingsWithPrice } = await supabase
    .from('external_listings')
    .select('*', { count: 'exact', head: true })
    .not('final_price', 'is', null);

  console.log(`\nExternal listings with final_price: ${(listingsWithPrice || 0).toLocaleString()}`);

  // 3. Check if we can link external_listings to auction_events
  const { data: sampleListings } = await supabase
    .from('external_listings')
    .select('id, vehicle_id, listing_url, final_price, current_bid, platform')
    .not('final_price', 'is', null)
    .limit(10);

  console.log('\nSample listings with prices:');
  for (const listing of sampleListings || []) {
    console.log(`  ${listing.platform}: $${listing.final_price?.toLocaleString()} | ${listing.listing_url?.substring(0, 50)}...`);
  }

  // 4. Check auction_events to see what data they have
  const { data: sampleEvents } = await supabase
    .from('auction_events')
    .select('id, vehicle_id, auction_url, final_price, source, sale_status')
    .limit(10);

  console.log('\nSample auction_events:');
  for (const event of sampleEvents || []) {
    console.log(`  ${event.source}: ${event.sale_status || 'unknown'} | $${event.final_price || 0} | ${event.auction_url?.substring(0, 50)}...`);
  }

  // 5. Try to backfill from external_listings
  console.log('\n=== BACKFILLING FROM EXTERNAL_LISTINGS ===');

  // Get external_listings with prices that have vehicle_ids
  const { data: listingsToBackfill } = await supabase
    .from('external_listings')
    .select('id, vehicle_id, listing_url, final_price')
    .not('final_price', 'is', null)
    .not('vehicle_id', 'is', null)
    .limit(1000);

  let updated = 0;
  for (const listing of listingsToBackfill || []) {
    // Find matching auction_event by vehicle_id
    const { data: matchingEvent } = await supabase
      .from('auction_events')
      .select('id, final_price')
      .eq('vehicle_id', listing.vehicle_id)
      .is('final_price', null)
      .limit(1)
      .maybeSingle();

    if (matchingEvent) {
      const { error } = await supabase
        .from('auction_events')
        .update({
          final_price: listing.final_price,
          sale_status: 'sold',
          updated_at: new Date().toISOString()
        })
        .eq('id', matchingEvent.id);

      if (!error) {
        updated++;
      }
    }
  }

  console.log(`Updated ${updated} auction_events with prices from external_listings`);

  // 6. Check vehicles table for price data in origin_metadata
  console.log('\n=== CHECKING ORIGIN_METADATA FOR PRICES ===');

  const { data: vehiclesWithMeta } = await supabase
    .from('vehicles')
    .select('id, origin_metadata')
    .not('origin_metadata', 'is', null)
    .limit(100);

  let pricesFound = 0;
  for (const v of vehiclesWithMeta || []) {
    const meta = v.origin_metadata as any;
    if (meta?.sold_price || meta?.final_price || meta?.sale_price || meta?.winning_bid) {
      pricesFound++;
    }
  }
  console.log(`Vehicles with price in origin_metadata (sample of 100): ${pricesFound}`);

  // 7. Final status
  const { count: finalEventsWithPrice } = await supabase
    .from('auction_events')
    .select('*', { count: 'exact', head: true })
    .not('final_price', 'is', null);

  console.log(`\n=== FINAL STATUS ===`);
  console.log(`Auction events with final_price: ${(finalEventsWithPrice || 0).toLocaleString()}`);
}

main().catch(console.error);
