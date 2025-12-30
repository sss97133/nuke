#!/usr/bin/env node

/**
 * Diagnostic script to check for vehicle data mismatches
 * Specifically checks if images, prices, and vehicle data are consistent
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env.local') });
dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const VEHICLE_ID = process.argv[2] || 'bfaf7f3c-9a6a-4164-bffb-1e9fae075883';

async function diagnoseVehicle() {
  console.log(`\n🔍 Diagnosing vehicle: ${VEHICLE_ID}\n`);
  console.log('='.repeat(80));

  // 1. Get vehicle data
  console.log('\n1️⃣  VEHICLE DATA:');
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', VEHICLE_ID)
    .single();

  if (vehicleError) {
    console.error('❌ Error fetching vehicle:', vehicleError);
    return;
  }

  if (!vehicle) {
    console.error('❌ Vehicle not found');
    return;
  }

  console.log(`   ID: ${vehicle.id}`);
  console.log(`   Year: ${vehicle.year}`);
  console.log(`   Make: ${vehicle.make}`);
  console.log(`   Model: ${vehicle.model}`);
  console.log(`   VIN: ${vehicle.vin || 'N/A'}`);
  console.log(`   Sale Price: ${vehicle.sale_price ? `$${vehicle.sale_price.toLocaleString()}` : 'N/A'}`);
  console.log(`   Asking Price: ${vehicle.asking_price ? `$${vehicle.asking_price.toLocaleString()}` : 'N/A'}`);
  console.log(`   Current Value: ${vehicle.current_value ? `$${vehicle.current_value.toLocaleString()}` : 'N/A'}`);
  console.log(`   Primary Image URL: ${vehicle.primary_image_url || 'N/A'}`);
  console.log(`   Image URL: ${vehicle.image_url || 'N/A'}`);
  console.log(`   BAT Auction URL: ${vehicle.bat_auction_url || 'N/A'}`);
  console.log(`   Discovery URL: ${vehicle.discovery_url || 'N/A'}`);
  console.log(`   Profile Origin: ${vehicle.profile_origin || 'N/A'}`);
  console.log(`   Origin Metadata: ${vehicle.origin_metadata ? JSON.stringify(vehicle.origin_metadata, null, 2).substring(0, 200) + '...' : 'N/A'}`);

  // 2. Get all images for this vehicle
  console.log('\n2️⃣  VEHICLE IMAGES:');
  const { data: images, error: imagesError } = await supabase
    .from('vehicle_images')
    .select('id, image_url, source_url, is_primary, position, source, created_at, is_duplicate, is_document')
    .eq('vehicle_id', VEHICLE_ID)
    .order('position', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (imagesError) {
    console.error('❌ Error fetching images:', imagesError);
  } else {
    console.log(`   Total images: ${images?.length || 0}`);
    console.log(`   Primary images: ${images?.filter(img => img.is_primary).length || 0}`);
    console.log(`   Duplicate images: ${images?.filter(img => img.is_duplicate).length || 0}`);
    console.log(`   Document images: ${images?.filter(img => img.is_document).length || 0}`);
    
    if (images && images.length > 0) {
      console.log('\n   First 10 images:');
      images.slice(0, 10).forEach((img, idx) => {
        const url = img.image_url || img.source_url || 'N/A';
        const batMatch = url.includes('bringatrailer.com');
        const isPrimary = img.is_primary ? '⭐ PRIMARY' : '';
        const isDup = img.is_duplicate ? '🔁 DUPLICATE' : '';
        const isDoc = img.is_document ? '📄 DOCUMENT' : '';
        console.log(`   ${idx + 1}. ${isPrimary} ${isDup} ${isDoc} ${batMatch ? '🖼️ BAT' : ''}`);
        console.log(`      URL: ${url.substring(0, 100)}${url.length > 100 ? '...' : ''}`);
        console.log(`      Source: ${img.source || 'N/A'}`);
        console.log(`      Position: ${img.position ?? 'NULL'}`);
        console.log(`      Created: ${img.created_at}`);
      });
    }
  }

  // 3. Check for images that might belong to other vehicles (by URL pattern)
  console.log('\n3️⃣  CHECKING FOR IMAGE CONTAMINATION:');
  if (images && images.length > 0) {
    const batImages = images.filter(img => {
      const url = (img.image_url || img.source_url || '').toLowerCase();
      return url.includes('bringatrailer.com');
    });

    console.log(`   BAT images found: ${batImages.length}`);
    
    // Check if any images match known contamination patterns
    const contaminated = images.filter(img => {
      const url = (img.image_url || img.source_url || '').toLowerCase();
      return (
        url.includes('/countries/') ||
        url.includes('/themes/') ||
        url.includes('/assets/img/') ||
        url.endsWith('.svg') ||
        url.includes('logo') ||
        url.includes('qotw') ||
        url.includes('winner-template')
      );
    });

    if (contaminated.length > 0) {
      console.log(`   ⚠️  CONTAMINATED IMAGES FOUND: ${contaminated.length}`);
      contaminated.forEach((img, idx) => {
        console.log(`   ${idx + 1}. ${img.image_url || img.source_url}`);
      });
    } else {
      console.log('   ✅ No obvious contamination patterns found');
    }
  }

  // 4. Check external listings
  console.log('\n4️⃣  EXTERNAL LISTINGS:');
  const { data: listings, error: listingsError } = await supabase
    .from('external_listings')
    .select('*')
    .eq('vehicle_id', VEHICLE_ID)
    .order('created_at', { ascending: false });

  if (listingsError) {
    console.error('❌ Error fetching listings:', listingsError);
  } else {
    console.log(`   Total listings: ${listings?.length || 0}`);
    if (listings && listings.length > 0) {
      listings.forEach((listing, idx) => {
        console.log(`   ${idx + 1}. ${listing.platform} - ${listing.listing_status}`);
        console.log(`      URL: ${listing.listing_url || 'N/A'}`);
        console.log(`      Current Bid: ${listing.current_bid ? `$${listing.current_bid.toLocaleString()}` : 'N/A'}`);
        console.log(`      Final Price: ${listing.final_price ? `$${listing.final_price.toLocaleString()}` : 'N/A'}`);
      });
    }
  }

  // 5. Check RPC function result
  console.log('\n5️⃣  RPC FUNCTION RESULT:');
  const { data: rpcData, error: rpcError } = await supabase
    .rpc('get_vehicle_profile_data', { p_vehicle_id: VEHICLE_ID });

  if (rpcError) {
    console.error('❌ RPC Error:', rpcError);
  } else {
    if (rpcData && rpcData.vehicle) {
      console.log(`   Vehicle from RPC: ${rpcData.vehicle.year} ${rpcData.vehicle.make} ${rpcData.vehicle.model}`);
      console.log(`   Images from RPC: ${rpcData.images?.length || 0}`);
      console.log(`   Stats: ${JSON.stringify(rpcData.stats || {}, null, 2)}`);
    } else {
      console.log('   ⚠️  RPC returned null or no vehicle data');
    }
  }

  // 6. Check for other vehicles with similar images (potential duplicates)
  console.log('\n6️⃣  CHECKING FOR DUPLICATE VEHICLES:');
  if (images && images.length > 0) {
    const firstImageUrl = images[0]?.image_url;
    if (firstImageUrl) {
      const { data: otherVehicles, error: otherError } = await supabase
        .from('vehicle_images')
        .select('vehicle_id, vehicles!inner(id, year, make, model)')
        .eq('image_url', firstImageUrl)
        .neq('vehicle_id', VEHICLE_ID)
        .limit(5);

      if (!otherError && otherVehicles && otherVehicles.length > 0) {
        console.log(`   ⚠️  Found ${otherVehicles.length} other vehicle(s) with the same image URL:`);
        otherVehicles.forEach((v, idx) => {
          const veh = v.vehicles;
          console.log(`   ${idx + 1}. ${veh.year} ${veh.make} ${veh.model} (${veh.id})`);
        });
      } else {
        console.log('   ✅ No duplicate vehicles found with same image URL');
      }
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n✅ Diagnosis complete!\n');
}

diagnoseVehicle().catch(console.error);

