#!/usr/bin/env node
/**
 * One-off cleanup script to remove BAT data from a specific vehicle
 * 
 * Usage:
 *   node scripts/cleanup-vehicle-bat-data.js <vehicle_id>
 * 
 * This removes:
 * - BAT external_listings
 * - BAT auction_comments
 * - BAT bat_comments
 * - Clears BAT fields from vehicle record
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function cleanupVehicleBATData(vehicleId) {
  console.log(`🧹 Cleaning up BAT data for vehicle: ${vehicleId}\n`);

  // 1. Delete external_listings
  const { data: listings, error: listingsError } = await supabase
    .from('external_listings')
    .select('id, listing_url, platform')
    .eq('vehicle_id', vehicleId)
    .or('platform.eq.bat,listing_url.ilike.%bringatrailer.com%');

  if (listingsError) {
    console.error('❌ Error fetching listings:', listingsError);
  } else if (listings && listings.length > 0) {
    console.log(`   Found ${listings.length} BAT external_listings to delete:`);
    listings.forEach(l => console.log(`     - ${l.listing_url} (${l.platform})`));
    
    const { error: deleteError } = await supabase
      .from('external_listings')
      .delete()
      .eq('vehicle_id', vehicleId)
      .or('platform.eq.bat,listing_url.ilike.%bringatrailer.com%');

    if (deleteError) {
      console.error('❌ Error deleting listings:', deleteError);
    } else {
      console.log(`   ✅ Deleted ${listings.length} external_listings\n`);
    }
  } else {
    console.log('   ℹ️  No BAT external_listings found\n');
  }

  // 2. Delete auction_comments
  const { data: auctionComments, error: commentsError } = await supabase
    .from('auction_comments')
    .select('id, listing_url, platform, author_username')
    .eq('vehicle_id', vehicleId)
    .or('platform.eq.bat,listing_url.ilike.%bringatrailer.com%,source.eq.bat');

  if (commentsError) {
    console.error('❌ Error fetching auction_comments:', commentsError);
  } else if (auctionComments && auctionComments.length > 0) {
    console.log(`   Found ${auctionComments.length} BAT auction_comments to delete`);
    
    const { error: deleteError } = await supabase
      .from('auction_comments')
      .delete()
      .eq('vehicle_id', vehicleId)
      .or('platform.eq.bat,listing_url.ilike.%bringatrailer.com%,source.eq.bat');

    if (deleteError) {
      console.error('❌ Error deleting auction_comments:', deleteError);
    } else {
      console.log(`   ✅ Deleted ${auctionComments.length} auction_comments\n`);
    }
  } else {
    console.log('   ℹ️  No BAT auction_comments found\n');
  }

  // 3. Delete bat_comments
  const { data: batComments, error: batCommentsError } = await supabase
    .from('bat_comments')
    .select('id, bat_username')
    .eq('vehicle_id', vehicleId);

  if (batCommentsError) {
    console.error('❌ Error fetching bat_comments:', batCommentsError);
  } else if (batComments && batComments.length > 0) {
    console.log(`   Found ${batComments.length} bat_comments to delete`);
    
    const { error: deleteError } = await supabase
      .from('bat_comments')
      .delete()
      .eq('vehicle_id', vehicleId);

    if (deleteError) {
      console.error('❌ Error deleting bat_comments:', deleteError);
    } else {
      console.log(`   ✅ Deleted ${batComments.length} bat_comments\n`);
    }
  } else {
    console.log('   ℹ️  No bat_comments found\n');
  }

  // 4. Clear BAT fields from vehicle
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('id, bat_auction_url, bat_sold_price, bat_sale_date, bat_listing_title, bat_seller, bat_location')
    .eq('id', vehicleId)
    .single();

  if (vehicle && (vehicle.bat_auction_url || vehicle.bat_sold_price || vehicle.bat_sale_date)) {
    console.log('   Clearing BAT fields from vehicle record...');
    
    const { error: updateError } = await supabase
      .from('vehicles')
      .update({
        bat_auction_url: null,
        bat_sold_price: null,
        bat_sale_date: null,
        bat_listing_title: null,
        bat_seller: null,
        bat_location: null
      })
      .eq('id', vehicleId);

    if (updateError) {
      console.error('❌ Error clearing BAT fields:', updateError);
    } else {
      console.log('   ✅ Cleared BAT fields from vehicle\n');
    }
  } else {
    console.log('   ℹ️  No BAT fields to clear\n');
  }

  // 5. Fix organizations with bad business_name (description text) and location data
  const { data: badOrgs } = await supabase
    .from('businesses')
    .select('id, business_name, city, state')
    .or('business_name.ilike.%is a dealer specializing%,business_name.ilike.%specializing is vintage%,business_name.ilike.%has fitted this car%,business_name.eq.:,city.eq.:,state.eq.:');

  if (badOrgs && badOrgs.length > 0) {
    console.log(`   Found ${badOrgs.length} organizations with bad data:`);
    badOrgs.forEach(org => {
      console.log(`     - ID: ${org.id}`);
      if (org.business_name) console.log(`       business_name: ${org.business_name.substring(0, 60)}...`);
      if (org.city === ':' || org.state === ':') console.log(`       location: city="${org.city}", state="${org.state}"`);
    });
    
    // Clear bad data from these orgs
    const badOrgIds = badOrgs.map(o => o.id);
    const { error: updateOrgsError } = await supabase
      .from('businesses')
      .update({
        business_name: null,
        city: null,
        state: null
      })
      .in('id', badOrgIds)
      .or('business_name.ilike.%is a dealer specializing%,business_name.ilike.%specializing is vintage%,business_name.ilike.%has fitted this car%,business_name.eq.:,city.eq.:,state.eq.:');

    if (updateOrgsError) {
      console.error('❌ Error fixing bad organizations:', updateOrgsError);
    } else {
      console.log(`   ✅ Fixed ${badOrgs.length} bad organizations\n`);
    }
  } else {
    console.log('   ℹ️  No bad organizations found\n');
  }

  console.log('✅ Cleanup complete!');
}

async function main() {
  const vehicleId = process.argv[2];
  
  if (!vehicleId) {
    console.error('❌ Usage: node scripts/cleanup-vehicle-bat-data.js <vehicle_id>');
    process.exit(1);
  }

  await cleanupVehicleBATData(vehicleId);
}

main().catch(console.error);

