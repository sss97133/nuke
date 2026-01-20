import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function report() {
  console.log('='.repeat(70));
  console.log('LIVE AUCTION REPORT');
  console.log(new Date().toLocaleString());
  console.log('='.repeat(70));

  const { data: auctions } = await supabase
    .from('vehicles')
    .select('listing_title, high_bid, bid_count, reserve_status, auction_source, listing_url, updated_at, year, make, model')
    .eq('listing_source', 'live_auction_extractor')
    .order('high_bid', { ascending: false, nullsFirst: false });

  if (!auctions || auctions.length === 0) {
    console.log('No live auctions found');
    return;
  }

  console.log(`\nFound ${auctions.length} live auctions\n`);

  for (const a of auctions) {
    console.log('─'.repeat(70));
    console.log(a.listing_title);
    console.log(`  ${a.year || '?'} ${a.make || '?'} ${a.model || '?'}`);
    console.log(`  Source: ${a.auction_source}`);
    if (a.high_bid) console.log(`  Current Bid: $${a.high_bid.toLocaleString()}`);
    if (a.bid_count) console.log(`  Bids: ${a.bid_count}`);
    if (a.reserve_status) console.log(`  Reserve: ${a.reserve_status}`);
    console.log(`  URL: ${a.listing_url}`);
  }

  console.log('\n' + '='.repeat(70));
  const totalBids = auctions.reduce((sum, a) => sum + (a.high_bid || 0), 0);
  console.log(`Total value in live auctions: $${totalBids.toLocaleString()}`);
  console.log('='.repeat(70));
}

report();
