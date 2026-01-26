import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function runAnalytics() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║           BAT DATA ANALYTICS OVERVIEW                         ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  // ========== DATA INVENTORY ==========
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('                         DATA INVENTORY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const { count: totalVehicles } = await supabase.from('vehicles').select('*', { count: 'exact', head: true });
  const { count: batVehicles } = await supabase.from('vehicles').select('*', { count: 'exact', head: true })
    .or('bat_auction_url.neq.,listing_url.ilike.%bringatrailer%,discovery_url.ilike.%bringatrailer%');
  const { count: totalComments } = await supabase.from('auction_comments').select('*', { count: 'exact', head: true });
  const { count: totalBids } = await supabase.from('auction_comments').select('*', { count: 'exact', head: true }).not('bid_amount', 'is', null);
  const { count: sellerComments } = await supabase.from('auction_comments').select('*', { count: 'exact', head: true }).eq('is_seller', true);
  const { count: auctionEvents } = await supabase.from('auction_events').select('*', { count: 'exact', head: true });
  const { count: externalListings } = await supabase.from('external_listings').select('*', { count: 'exact', head: true });
  const { count: snapshots } = await supabase.from('listing_page_snapshots').select('*', { count: 'exact', head: true });

  console.log(`Total vehicles:          ${totalVehicles?.toLocaleString().padStart(10)}`);
  console.log(`BaT vehicles:            ${batVehicles?.toLocaleString().padStart(10)}`);
  console.log(`Auction events:          ${auctionEvents?.toLocaleString().padStart(10)}`);
  console.log(`External listings:       ${externalListings?.toLocaleString().padStart(10)}`);
  console.log(`Page snapshots:          ${snapshots?.toLocaleString().padStart(10)}`);
  console.log('');
  console.log(`Total comments:          ${totalComments?.toLocaleString().padStart(10)}`);
  console.log(`  └─ Bids (with amount): ${totalBids?.toLocaleString().padStart(10)}`);
  console.log(`  └─ Seller comments:    ${sellerComments?.toLocaleString().padStart(10)}`);
  console.log(`  └─ Discussion:         ${((totalComments || 0) - (totalBids || 0)).toLocaleString().padStart(10)}`);

  // ========== BIDDER ANALYSIS ==========
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('                       BIDDER ANALYSIS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Get all bids for analysis
  const { data: allBids } = await supabase
    .from('auction_comments')
    .select('author_username, bid_amount, posted_at, vehicle_id')
    .not('bid_amount', 'is', null)
    .not('author_username', 'is', null);

  const bidderStats: Record<string, { count: number; total: number; max: number; min: number; vehicles: Set<string> }> = {};
  for (const b of allBids || []) {
    if (!b.author_username) continue;
    if (!bidderStats[b.author_username]) {
      bidderStats[b.author_username] = { count: 0, total: 0, max: 0, min: Infinity, vehicles: new Set() };
    }
    const s = bidderStats[b.author_username];
    s.count++;
    s.total += b.bid_amount || 0;
    s.max = Math.max(s.max, b.bid_amount || 0);
    s.min = Math.min(s.min, b.bid_amount || 0);
    if (b.vehicle_id) s.vehicles.add(b.vehicle_id);
  }

  const uniqueBidders = Object.keys(bidderStats).length;
  const totalBidValue = Object.values(bidderStats).reduce((a, b) => a + b.total, 0);
  const avgBidPerBidder = totalBidValue / uniqueBidders;

  console.log(`Unique bidders:          ${uniqueBidders.toLocaleString()}`);
  console.log(`Total bid value:         $${totalBidValue.toLocaleString()}`);
  console.log(`Avg per bidder:          $${Math.round(avgBidPerBidder).toLocaleString()}`);

  // Top bidders by activity
  const topByCount = Object.entries(bidderStats).sort((a, b) => b[1].count - a[1].count).slice(0, 10);
  console.log('\nTop 10 Most Active Bidders:');
  console.log('──────────────────────────────────────────────────────────────────');
  console.log('Username               Bids   Vehicles    Avg Bid       Max Bid');
  console.log('──────────────────────────────────────────────────────────────────');
  for (const [name, stats] of topByCount) {
    const avg = Math.round(stats.total / stats.count);
    console.log(`${name.padEnd(20)} ${stats.count.toString().padStart(5)}   ${stats.vehicles.size.toString().padStart(8)}   $${avg.toLocaleString().padStart(8)}   $${stats.max.toLocaleString().padStart(10)}`);
  }

  // Top bidders by value
  const topByValue = Object.entries(bidderStats).sort((a, b) => b[1].max - a[1].max).slice(0, 10);
  console.log('\nTop 10 Highest Bidders (by max bid):');
  console.log('──────────────────────────────────────────────────────────────────');
  for (const [name, stats] of topByValue) {
    console.log(`${name.padEnd(20)} Max: $${stats.max.toLocaleString().padStart(12)}  (${stats.count} bids)`);
  }

  // ========== PRICE ANALYSIS ==========
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('                        PRICE ANALYSIS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Get vehicles with sale prices
  const { data: soldVehicles } = await supabase
    .from('vehicles')
    .select('id, sale_price, year, make, model')
    .not('sale_price', 'is', null)
    .gt('sale_price', 1000)
    .or('bat_auction_url.neq.,listing_url.ilike.%bringatrailer%')
    .order('sale_price', { ascending: false })
    .limit(1000);

  if (soldVehicles && soldVehicles.length > 0) {
    const prices = soldVehicles.map(v => v.sale_price).filter((p): p is number => typeof p === 'number');
    const totalSales = prices.reduce((a, b) => a + b, 0);
    const avgSale = totalSales / prices.length;
    const medianSale = prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)];

    console.log(`Vehicles with sale prices: ${soldVehicles.length.toLocaleString()}`);
    console.log(`Total sales value:         $${totalSales.toLocaleString()}`);
    console.log(`Average sale price:        $${Math.round(avgSale).toLocaleString()}`);
    console.log(`Median sale price:         $${medianSale.toLocaleString()}`);
    console.log(`Highest sale:              $${Math.max(...prices).toLocaleString()}`);
    console.log(`Lowest sale:               $${Math.min(...prices).toLocaleString()}`);

    // Price distribution
    const buckets = [10000, 25000, 50000, 100000, 250000, 500000, 1000000];
    console.log('\nPrice distribution:');
    let prev = 0;
    for (const b of buckets) {
      const count = prices.filter(p => p > prev && p <= b).length;
      const pct = ((count / prices.length) * 100).toFixed(1);
      console.log(`  $${prev.toLocaleString().padStart(10)} - $${b.toLocaleString().padStart(10)}: ${count.toString().padStart(4)} vehicles (${pct}%)`);
      prev = b;
    }
    const over1m = prices.filter(p => p > 1000000).length;
    console.log(`  $1,000,000+                      : ${over1m.toString().padStart(4)} vehicles (${((over1m / prices.length) * 100).toFixed(1)}%)`);
  }

  // ========== ANALYTICS POTENTIAL ==========
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('                   ANALYTICS WE CAN BUILD');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('1. BIDDER PROFILES');
  console.log('   - Track bidder win rates, avg bid-to-win ratio');
  console.log('   - Identify snipers vs early bidders');
  console.log('   - Bidder price range preferences');
  console.log('');
  console.log('2. AUCTION DYNAMICS');
  console.log('   - Bid velocity in final hours/minutes');
  console.log('   - Time-to-first-bid correlation with final price');
  console.log('   - Soft-close extension frequency');
  console.log('');
  console.log('3. PRICE PREDICTION');
  console.log('   - ML model: early bid count → final price');
  console.log('   - Comment sentiment → price premium');
  console.log('   - Watcher-to-bidder conversion rates');
  console.log('');
  console.log('4. SELLER ANALYSIS');
  console.log('   - Seller comment engagement vs final price');
  console.log('   - Response time to questions');
  console.log('   - Reserve-met rate by seller');
  console.log('');
  console.log('5. MARKET TIMING');
  console.log('   - Best day of week to end auctions');
  console.log('   - Seasonal price variations');
  console.log('   - Holiday effect on auction activity');
  console.log('');
  console.log('6. COMPETITIVE INTELLIGENCE');
  console.log('   - Which dealers are most active bidders');
  console.log('   - Market share by make/model');
  console.log('   - Price trends over time');

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                         END OF REPORT');
  console.log('═══════════════════════════════════════════════════════════════════\n');
}

runAnalytics().catch(console.error);
