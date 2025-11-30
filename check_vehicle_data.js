// Script to check vehicle images and add sample data if needed
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const vehicleId = 'c1b04f00-7abf-4e1c-afd2-43fba17a6a1b';

async function checkAndAddImages() {
  console.log('Checking vehicle images...\n');
  
  // Check existing images
  const { data: images, error: imgError } = await supabase
    .from('vehicle_images')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: false });

  if (imgError) {
    console.error('Error fetching images:', imgError);
    return;
  }

  console.log(`Found ${images?.length || 0} images for vehicle ${vehicleId}`);
  
  if (images && images.length > 0) {
    console.log('\nExisting images:');
    images.forEach((img, i) => {
      console.log(`${i + 1}. ${img.image_url}`);
      console.log(`   Primary: ${img.is_primary}, Document: ${img.is_document}`);
    });
  } else {
    console.log('\nNo images found. Checking vehicle info...');
    
    // Get vehicle info
    const { data: vehicle, error: vehError } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', vehicleId)
      .single();

    if (vehError) {
      console.error('Error fetching vehicle:', vehError);
      return;
    }

    console.log(`Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
    console.log(`VIN: ${vehicle.vin || 'Not set'}`);
    console.log(`Source: ${vehicle.profile_origin || 'Unknown'}`);
    
    // Check if there's a BAT URL we can scrape
    if (vehicle.bat_auction_url || vehicle.discovery_url) {
      const batUrl = vehicle.bat_auction_url || vehicle.discovery_url;
      console.log(`\nBAT URL found: ${batUrl}`);
      console.log('You can use the BAT scraper to fetch images from this URL.');
    }
  }

  // Check for active auction listings
  console.log('\n--- Checking for active auctions ---');
  const { data: listings, error: listingError } = await supabase
    .from('vehicle_listings')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .eq('status', 'active')
    .in('sale_type', ['auction', 'live_auction']);

  if (listingError) {
    console.error('Error fetching listings:', listingError);
  } else {
    console.log(`Found ${listings?.length || 0} active auction listings`);
    if (listings && listings.length > 0) {
      listings.forEach((listing, i) => {
        console.log(`\nListing ${i + 1}:`);
        console.log(`  ID: ${listing.id}`);
        console.log(`  Type: ${listing.sale_type}`);
        console.log(`  Current Bid: $${(listing.current_high_bid_cents || 0) / 100}`);
        console.log(`  Bid Count: ${listing.bid_count || 0}`);
        console.log(`  End Time: ${listing.auction_end_time || 'Not set'}`);
      });
    }
  }
}

checkAndAddImages().catch(console.error);

