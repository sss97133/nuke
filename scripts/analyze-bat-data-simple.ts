import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function analyze() {
  console.log('=== BAT DATA ANALYSIS ===\n');

  // 1. Total comments and bids
  const { count: totalComments } = await supabase
    .from('auction_comments')
    .select('*', { count: 'exact', head: true });

  const { count: totalBids } = await supabase
    .from('auction_comments')
    .select('*', { count: 'exact', head: true })
    .not('bid_amount', 'is', null);

  console.log(`Total auction_comments: ${totalComments?.toLocaleString()}`);
  console.log(`Total bids (with amounts): ${totalBids?.toLocaleString()}`);
  console.log(`Discussion comments: ${((totalComments || 0) - (totalBids || 0)).toLocaleString()}`);

  // 2. Unique vehicles with comments
  const { data: vehicleCommentCounts } = await supabase
    .from('auction_comments')
    .select('vehicle_id')
    .limit(50000);

  const uniqueVehiclesWithComments = new Set(vehicleCommentCounts?.map(c => c.vehicle_id) || []).size;
  console.log(`\nVehicles with comments: ${uniqueVehiclesWithComments.toLocaleString()}`);

  // 3. Unique bidders
  const { data: bidders } = await supabase
    .from('auction_comments')
    .select('author_username')
    .not('bid_amount', 'is', null)
    .limit(100000);

  const uniqueBidders = new Set(bidders?.map(b => b.author_username).filter(Boolean) || []).size;
  console.log(`Unique bidders: ${uniqueBidders.toLocaleString()}`);

  // 4. Sample bid data
  const { data: sampleBids } = await supabase
    .from('auction_comments')
    .select('author_username, bid_amount, posted_at, vehicle_id')
    .not('bid_amount', 'is', null)
    .order('bid_amount', { ascending: false })
    .limit(20);

  console.log('\n=== HIGHEST BIDS ===');
  for (const b of sampleBids || []) {
    console.log(`$${b.bid_amount?.toLocaleString()} by ${b.author_username} (${b.posted_at?.slice(0, 10)})`);
  }

  // 5. Most active bidders (sample)
  const { data: allBidderData } = await supabase
    .from('auction_comments')
    .select('author_username, bid_amount')
    .not('bid_amount', 'is', null)
    .not('author_username', 'is', null)
    .limit(100000);

  const bidderStats: Record<string, { count: number; total: number; max: number }> = {};
  for (const b of allBidderData || []) {
    if (!b.author_username) continue;
    if (!bidderStats[b.author_username]) {
      bidderStats[b.author_username] = { count: 0, total: 0, max: 0 };
    }
    bidderStats[b.author_username].count++;
    bidderStats[b.author_username].total += b.bid_amount || 0;
    bidderStats[b.author_username].max = Math.max(bidderStats[b.author_username].max, b.bid_amount || 0);
  }

  const topBidders = Object.entries(bidderStats)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 15);

  console.log('\n=== TOP BIDDERS (by bid count) ===');
  for (const [name, stats] of topBidders) {
    console.log(`${name}: ${stats.count} bids, avg $${Math.round(stats.total / stats.count).toLocaleString()}, max $${stats.max.toLocaleString()}`);
  }

  // 6. Vehicles without any comments
  const { count: totalBatVehicles } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .or('bat_auction_url.neq.,listing_url.ilike.%bringatrailer%,discovery_url.ilike.%bringatrailer%');

  console.log(`\n=== COVERAGE ===`);
  console.log(`Total BaT vehicles: ${totalBatVehicles?.toLocaleString()}`);
  console.log(`Vehicles with comments: ${uniqueVehiclesWithComments.toLocaleString()}`);
  console.log(`Coverage: ${((uniqueVehiclesWithComments / (totalBatVehicles || 1)) * 100).toFixed(1)}%`);

  // 7. Check for seller comments
  const { count: sellerComments } = await supabase
    .from('auction_comments')
    .select('*', { count: 'exact', head: true })
    .eq('is_seller', true);

  console.log(`\nSeller comments: ${sellerComments?.toLocaleString()}`);

  // 8. External listings coverage
  const { count: externalListings } = await supabase
    .from('external_listings')
    .select('*', { count: 'exact', head: true })
    .eq('platform', 'bat');

  console.log(`External listings (BaT): ${externalListings?.toLocaleString()}`);

  // 9. Snapshots
  const { count: snapshots } = await supabase
    .from('listing_page_snapshots')
    .select('*', { count: 'exact', head: true });

  console.log(`Listing page snapshots: ${snapshots?.toLocaleString()}`);

  // 10. What analytics we can run
  console.log('\n=== ANALYTICS READY TO BUILD ===');
  console.log('With 61,897 bid records, we can:');
  console.log('  1. Bidder Profiles - track individual bidder patterns');
  console.log('  2. Bid Velocity - analyze final-minute activity');
  console.log('  3. Price Prediction - ML model from bid patterns');
  console.log('  4. Seller Analysis - engagement impact on price');
  console.log('  5. Market Timing - best day/time to end auctions');
  console.log('  6. Reserve Analysis - predict reserve-met outcomes');
  console.log('  7. Competition Index - bid count vs final price');
  console.log('  8. Sniper Detection - identify last-second bidders');
}

analyze().catch(console.error);
