/**
 * Backfill auction_events with final_price v3
 *
 * Copy winning_bid or high_bid to final_price
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('=== BACKFILL AUCTION PRICES V3 ===\n');

  // 1. First update final_price from winning_bid where final_price is null
  console.log('Updating final_price from winning_bid...');
  const { count: fromWinningBid, error: err1 } = await supabase
    .from('auction_events')
    .update({ final_price: supabase.rpc('coalesce_winning_bid') })
    .is('final_price', null)
    .not('winning_bid', 'is', null);

  // That won't work with RPC. Do it differently:

  // Get events with winning_bid but no final_price
  const { data: eventsWithWinningBid } = await supabase
    .from('auction_events')
    .select('id, winning_bid')
    .is('final_price', null)
    .not('winning_bid', 'is', null)
    .limit(5000);

  let updatedFromWinningBid = 0;
  for (const event of eventsWithWinningBid || []) {
    const { error } = await supabase
      .from('auction_events')
      .update({ final_price: event.winning_bid })
      .eq('id', event.id);

    if (!error) updatedFromWinningBid++;

    if (updatedFromWinningBid % 100 === 0) {
      process.stdout.write(`\rUpdated ${updatedFromWinningBid} from winning_bid...`);
    }
  }
  console.log(`\nUpdated ${updatedFromWinningBid} from winning_bid`);

  // Get events with high_bid but no final_price
  const { data: eventsWithHighBid } = await supabase
    .from('auction_events')
    .select('id, high_bid')
    .is('final_price', null)
    .not('high_bid', 'is', null)
    .limit(5000);

  let updatedFromHighBid = 0;
  for (const event of eventsWithHighBid || []) {
    const { error } = await supabase
      .from('auction_events')
      .update({ final_price: event.high_bid })
      .eq('id', event.id);

    if (!error) updatedFromHighBid++;

    if (updatedFromHighBid % 100 === 0) {
      process.stdout.write(`\rUpdated ${updatedFromHighBid} from high_bid...`);
    }
  }
  console.log(`\nUpdated ${updatedFromHighBid} from high_bid`);

  // Now try to get prices from external_listings for remaining
  console.log('\nChecking external_listings for additional prices...');

  const { data: eventsStillNeedingPrice } = await supabase
    .from('auction_events')
    .select('id, vehicle_id')
    .is('final_price', null)
    .not('vehicle_id', 'is', null)
    .limit(5000);

  let updatedFromListings = 0;
  for (const event of eventsStillNeedingPrice || []) {
    // Find matching external_listing
    const { data: listing } = await supabase
      .from('external_listings')
      .select('final_price, current_bid')
      .eq('vehicle_id', event.vehicle_id)
      .or('final_price.not.is.null,current_bid.not.is.null')
      .limit(1)
      .maybeSingle();

    if (listing) {
      const price = listing.final_price || listing.current_bid;
      if (price) {
        const { error } = await supabase
          .from('auction_events')
          .update({ final_price: price })
          .eq('id', event.id);

        if (!error) updatedFromListings++;
      }
    }

    if (updatedFromListings % 50 === 0 && updatedFromListings > 0) {
      process.stdout.write(`\rUpdated ${updatedFromListings} from external_listings...`);
    }
  }
  console.log(`\nUpdated ${updatedFromListings} from external_listings`);

  // Final count
  const { count: eventsWithPrice } = await supabase
    .from('auction_events')
    .select('*', { count: 'exact', head: true })
    .not('final_price', 'is', null);

  const { count: totalEvents } = await supabase.from('auction_events').select('*', { count: 'exact', head: true });

  console.log(`\n=== FINAL STATUS ===`);
  console.log(`Auction events with final_price: ${(eventsWithPrice || 0).toLocaleString()} / ${(totalEvents || 0).toLocaleString()}`);
  console.log(`Coverage: ${((eventsWithPrice || 0) / (totalEvents || 1) * 100).toFixed(1)}%`);
}

main().catch(console.error);
