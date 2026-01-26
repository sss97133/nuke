import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function analyzeDataQuality() {
  console.log('=== BAT DATA QUALITY ANALYSIS ===\n');

  // 1. Total BaT vehicles
  const { count: totalBat } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .or('bat_auction_url.neq.,listing_url.ilike.%bringatrailer%,discovery_url.ilike.%bringatrailer%');

  console.log(`Total BaT vehicles: ${totalBat}\n`);

  // 2. Vehicles with comments
  const { data: withComments } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT COUNT(DISTINCT v.id) as vehicles_with_comments
      FROM vehicles v
      JOIN auction_comments ac ON ac.vehicle_id = v.id
      WHERE v.bat_auction_url IS NOT NULL
         OR v.listing_url ILIKE '%bringatrailer%'
         OR v.discovery_url ILIKE '%bringatrailer%'
    `
  });
  console.log('Vehicles with comments:', withComments);

  // 3. Total comments and bids
  const { count: totalComments } = await supabase
    .from('auction_comments')
    .select('*', { count: 'exact', head: true });

  const { count: totalBids } = await supabase
    .from('auction_comments')
    .select('*', { count: 'exact', head: true })
    .not('bid_amount', 'is', null);

  console.log(`\nTotal auction_comments: ${totalComments}`);
  console.log(`Total bids (with bid_amount): ${totalBids}`);
  console.log(`Non-bid comments: ${(totalComments || 0) - (totalBids || 0)}`);

  // 4. Comment coverage by platform
  const { data: platformBreakdown } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT
        COALESCE(auction_platform, 'unknown') as platform,
        COUNT(*) as comment_count,
        COUNT(DISTINCT vehicle_id) as vehicle_count,
        COUNT(bid_amount) as bid_count
      FROM auction_comments
      GROUP BY auction_platform
      ORDER BY comment_count DESC
    `
  });
  console.log('\nComments by platform:', platformBreakdown);

  // 5. Data completeness check
  const { data: completeness } = await supabase.rpc('exec_sql', {
    sql: `
      WITH bat_vehicles AS (
        SELECT id, listing_title, vin, mileage, color, interior_color,
               transmission, engine_size, description, listing_location,
               sale_price, bat_auction_url, listing_url
        FROM vehicles
        WHERE bat_auction_url IS NOT NULL
           OR listing_url ILIKE '%bringatrailer%'
           OR discovery_url ILIKE '%bringatrailer%'
      )
      SELECT
        COUNT(*) as total,
        COUNT(vin) as has_vin,
        COUNT(mileage) as has_mileage,
        COUNT(color) as has_color,
        COUNT(interior_color) as has_interior,
        COUNT(transmission) as has_trans,
        COUNT(engine_size) as has_engine,
        COUNT(CASE WHEN LENGTH(COALESCE(description, '')) > 100 THEN 1 END) as has_desc_100,
        COUNT(listing_location) as has_location,
        COUNT(sale_price) as has_sale_price
      FROM bat_vehicles
    `
  });
  console.log('\nData completeness:', completeness);

  // 6. Image coverage
  const { data: imageCoverage } = await supabase.rpc('exec_sql', {
    sql: `
      WITH bat_vehicles AS (
        SELECT id FROM vehicles
        WHERE bat_auction_url IS NOT NULL
           OR listing_url ILIKE '%bringatrailer%'
           OR discovery_url ILIKE '%bringatrailer%'
      )
      SELECT
        COUNT(DISTINCT bv.id) as total_bat,
        COUNT(DISTINCT vi.vehicle_id) as with_images,
        ROUND(100.0 * COUNT(DISTINCT vi.vehicle_id) / NULLIF(COUNT(DISTINCT bv.id), 0), 1) as pct
      FROM bat_vehicles bv
      LEFT JOIN vehicle_images vi ON vi.vehicle_id = bv.id
    `
  });
  console.log('\nImage coverage:', imageCoverage);

  // 7. Bid data analysis
  const { data: bidAnalysis } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT
        COUNT(*) as total_bids,
        COUNT(DISTINCT vehicle_id) as vehicles_with_bids,
        COUNT(DISTINCT author_username) as unique_bidders,
        ROUND(AVG(bid_amount), 0) as avg_bid,
        MIN(bid_amount) as min_bid,
        MAX(bid_amount) as max_bid
      FROM auction_comments
      WHERE bid_amount IS NOT NULL
    `
  });
  console.log('\nBid analysis:', bidAnalysis);

  // 8. Top bidders
  const { data: topBidders } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT
        author_username,
        COUNT(*) as bid_count,
        COUNT(DISTINCT vehicle_id) as vehicles_bid_on,
        ROUND(AVG(bid_amount), 0) as avg_bid,
        MAX(bid_amount) as highest_bid
      FROM auction_comments
      WHERE bid_amount IS NOT NULL
        AND author_username IS NOT NULL
      GROUP BY author_username
      ORDER BY bid_count DESC
      LIMIT 15
    `
  });
  console.log('\nTop bidders:', topBidders);

  // 9. Vehicles missing key data
  const { data: missingData } = await supabase
    .from('vehicles')
    .select('id, listing_title, vin, mileage, color, transmission, bat_auction_url, listing_url')
    .or('bat_auction_url.neq.,listing_url.ilike.%bringatrailer%')
    .or('vin.is.null,mileage.is.null,color.is.null,transmission.is.null')
    .limit(10);

  console.log('\n=== SAMPLE VEHICLES MISSING DATA ===');
  for (const v of missingData || []) {
    const missing: string[] = [];
    if (!v.vin) missing.push('VIN');
    if (!v.mileage) missing.push('mileage');
    if (!v.color) missing.push('color');
    if (!v.transmission) missing.push('trans');
    console.log(`${v.listing_title?.slice(0, 50)}... | Missing: ${missing.join(', ')}`);
  }

  // 10. Analytics potential
  console.log('\n=== ANALYTICS POTENTIAL ===');
  console.log('With bid data we can analyze:');
  console.log('  - Bid velocity (bids per hour in final hours)');
  console.log('  - Price prediction based on early bid patterns');
  console.log('  - Bidder behavior (sniping vs early bidding)');
  console.log('  - Reserve-met correlation with bid count/comments');
  console.log('  - Watcher-to-bidder conversion rates');
  console.log('  - Time-of-day bidding patterns');
  console.log('  - Seller engagement impact on final price');
  console.log('  - Comment sentiment vs final price correlation');
}

analyzeDataQuality().catch(console.error);
