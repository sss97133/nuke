#!/usr/bin/env node

/**
 * PREVENTIVE SOLUTION: Image Contamination Prevention
 * 
 * This script:
 * 1. Validates all images match their assigned vehicles
 * 2. Detects and flags mismatches early
 * 3. Can be run as a cron job to catch issues before they spread
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env.local') });
dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function preventContamination() {
  console.log(`\n🛡️  Image Contamination Prevention Check\n`);
  console.log('='.repeat(80));

  // 1. Find images that exist for multiple vehicles (definite contamination)
  console.log(`\n1️⃣  Checking for duplicate image URLs across vehicles...`);
  
  const { data: duplicateImages } = await supabase.rpc('find_duplicate_image_urls', {});
  
  if (!duplicateImages) {
    // Fallback query
    const { data: allImages } = await supabase
      .from('vehicle_images')
      .select('image_url, vehicle_id, vehicles!inner(id, year, make, model)')
      .not('image_url', 'is', null)
      .not('is_duplicate', 'is', true)
      .not('is_document', 'is', true)
      .limit(10000);

    // Group by image_url
    const byUrl = new Map();
    (allImages || []).forEach(img => {
      const url = img.image_url;
      if (!byUrl.has(url)) {
        byUrl.set(url, []);
      }
      byUrl.get(url).push({
        vehicle_id: img.vehicle_id,
        vehicle: img.vehicles
      });
    });

    const duplicates = [];
    for (const [url, vehicles] of byUrl.entries()) {
      const uniqueVehicles = new Set(vehicles.map(v => v.vehicle_id));
      if (uniqueVehicles.size > 1) {
        duplicates.push({
          image_url: url,
          vehicles: vehicles.map(v => ({
            id: v.vehicle_id,
            name: `${v.vehicle.year} ${v.vehicle.make} ${v.vehicle.model}`
          }))
        });
      }
    }

    if (duplicates.length > 0) {
      console.log(`   ⚠️  Found ${duplicates.length} images assigned to multiple vehicles:`);
      duplicates.slice(0, 10).forEach((dup, idx) => {
        console.log(`   ${idx + 1}. Image URL: ${dup.image_url.substring(0, 80)}...`);
        console.log(`      Assigned to: ${dup.vehicles.map(v => v.name).join(', ')}`);
      });
      
      if (duplicates.length > 10) {
        console.log(`   ... and ${duplicates.length - 10} more`);
      }
    } else {
      console.log('   ✅ No duplicate image URLs found across vehicles');
    }
  }

  // 2. Check for BAT images that don't match vehicle's BAT URL
  console.log(`\n2️⃣  Checking BAT images match vehicle listings...`);
  
  const { data: batVehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model, bat_auction_url, discovery_url, origin_metadata')
    .or('bat_auction_url.not.is.null,discovery_url.ilike.%bringatrailer.com%')
    .limit(100);

  let batMismatches = 0;
  for (const vehicle of (batVehicles || [])) {
    const batUrl = vehicle.bat_auction_url || vehicle.discovery_url;
    if (!batUrl || !batUrl.includes('bringatrailer.com/listing/')) continue;

    const canonicalUrls = vehicle.origin_metadata?.image_urls || [];
    if (canonicalUrls.length === 0) continue;

    // Check if vehicle has BAT images
    const { data: batImages } = await supabase
      .from('vehicle_images')
      .select('id, image_url, source_url')
      .eq('vehicle_id', vehicle.id)
      .or('source.eq.bat_import,image_url.ilike.%bringatrailer.com%')
      .not('is_duplicate', 'is', true)
      .limit(50);

    if (!batImages || batImages.length === 0) {
      batMismatches++;
      if (batMismatches <= 5) {
        console.log(`   ⚠️  ${vehicle.year} ${vehicle.make} ${vehicle.model} has canonical URLs but no BAT images in DB`);
      }
    }
  }

  if (batMismatches === 0) {
    console.log('   ✅ All BAT vehicles have matching images');
  } else {
    console.log(`   ⚠️  ${batMismatches} BAT vehicles missing images`);
  }

  // 3. Check for vehicles with wrong primary images (by checking if primary matches vehicle metadata)
  console.log(`\n3️⃣  Checking primary images...`);
  
  const { data: vehiclesWithPrimaries } = await supabase
    .from('vehicles')
    .select('id, year, make, model, primary_image_url, image_url')
    .not('primary_image_url', 'is', null)
    .limit(100);

  let wrongPrimaries = 0;
  for (const vehicle of (vehiclesWithPrimaries || [])) {
    // Check if primary image actually belongs to this vehicle
    const { data: primaryImage } = await supabase
      .from('vehicle_images')
      .select('id, vehicle_id')
      .eq('image_url', vehicle.primary_image_url)
      .eq('vehicle_id', vehicle.id)
      .maybeSingle();

    if (!primaryImage) {
      // Check if it belongs to another vehicle
      const { data: otherVehicle } = await supabase
        .from('vehicle_images')
        .select('vehicle_id, vehicles!inner(id, year, make, model)')
        .eq('image_url', vehicle.primary_image_url)
        .neq('vehicle_id', vehicle.id)
        .maybeSingle();

      if (otherVehicle) {
        wrongPrimaries++;
        if (wrongPrimaries <= 5) {
          console.log(`   ⚠️  ${vehicle.year} ${vehicle.make} ${vehicle.model} has primary image from ${otherVehicle.vehicles.year} ${otherVehicle.vehicles.make} ${otherVehicle.vehicles.model}`);
        }
      }
    }
  }

  if (wrongPrimaries === 0) {
    console.log('   ✅ All primary images belong to correct vehicles');
  } else {
    console.log(`   ⚠️  ${wrongPrimaries} vehicles have wrong primary images`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n✅ Prevention check complete!\n');
  
  // Return summary for cron monitoring
  return {
    duplicateImages: duplicates?.length || 0,
    batMismatches,
    wrongPrimaries,
    needsAction: (duplicates?.length || 0) > 0 || batMismatches > 0 || wrongPrimaries > 0
  };
}

preventContamination().then(result => {
  if (result.needsAction) {
    console.log('⚠️  ACTION REQUIRED: Image contamination detected!');
    process.exit(1);
  } else {
    console.log('✅ No contamination detected');
    process.exit(0);
  }
}).catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});

