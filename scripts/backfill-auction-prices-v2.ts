/**
 * Backfill auction_events with final_price v2
 *
 * Match by vehicle_id and update final_price
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('=== BACKFILL AUCTION PRICES V2 ===\n');

  // Get external_listings with prices and vehicle_ids
  const { data: listingsWithPrices } = await supabase
    .from('external_listings')
    .select('id, vehicle_id, final_price, current_bid, listing_url')
    .not('vehicle_id', 'is', null)
    .or('final_price.not.is.null,current_bid.not.is.null')
    .limit(5000);

  console.log(`Found ${listingsWithPrices?.length || 0} external_listings with prices`);

  let updated = 0;
  let alreadySet = 0;
  let noMatch = 0;

  for (const listing of listingsWithPrices || []) {
    // Get the price (prefer final_price, fall back to current_bid)
    const price = listing.final_price || listing.current_bid;
    if (!price) continue;

    // Find matching auction_event
    const { data: event } = await supabase
      .from('auction_events')
      .select('id, final_price')
      .eq('vehicle_id', listing.vehicle_id)
      .maybeSingle();

    if (!event) {
      noMatch++;
      continue;
    }

    if (event.final_price) {
      alreadySet++;
      continue;
    }

    // Update the auction_event
    const { error } = await supabase
      .from('auction_events')
      .update({
        final_price: price,
        sale_status: listing.final_price ? 'sold' : 'active',
        updated_at: new Date().toISOString()
      })
      .eq('id', event.id);

    if (!error) {
      updated++;
    }

    if ((updated + alreadySet + noMatch) % 100 === 0) {
      process.stdout.write(`\rProcessed ${updated + alreadySet + noMatch}... (${updated} updated)`);
    }
  }

  console.log(`\n\n=== SUMMARY ===`);
  console.log(`Updated: ${updated}`);
  console.log(`Already had price: ${alreadySet}`);
  console.log(`No matching event: ${noMatch}`);

  // Final count
  const { count: eventsWithPrice } = await supabase
    .from('auction_events')
    .select('*', { count: 'exact', head: true })
    .not('final_price', 'is', null);

  console.log(`\nAuction events with final_price: ${(eventsWithPrice || 0).toLocaleString()}`);
}

main().catch(console.error);
