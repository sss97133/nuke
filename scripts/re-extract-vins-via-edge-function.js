#!/usr/bin/env node
/**
 * Re-extract VINs from vehicle images using the analyze-image edge function
 * 
 * This is better than direct OpenAI calls because:
 * - Uses the existing analyze-image function which has proper API key handling
 * - Uses the VIN extraction logic already tested in production
 * - Automatically updates vehicle VINs when found
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceRoleKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

// Configuration
const ONLY_MISSING_VINS = true; // Only process vehicles without VINs
const MAX_IMAGES_PER_VEHICLE = 20; // Limit images per vehicle
const MAX_VEHICLES_TO_PROCESS = null; // Set to number to limit, null for all

/**
 * Process a single vehicle using analyze-image function
 */
async function processVehicle(vehicle) {
  console.log(`\n📦 Processing: ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.id})`);
  console.log(`   Current VIN: ${vehicle.vin || 'None'}`);

  // Get images for this vehicle
  // Handle NULL is_document values (treat as false/non-document)
  const { data: images, error: imagesError } = await supabase
    .from('vehicle_images')
    .select('id, image_url, is_document, exif_data')
    .eq('vehicle_id', vehicle.id)
    .or('is_document.is.null,is_document.eq.false') // Include NULL and false
    .order('created_at', { ascending: true })
    .limit(MAX_IMAGES_PER_VEHICLE);

  if (imagesError) {
    console.error(`  ❌ Error fetching images:`, imagesError.message);
    return { processed: false, found: false };
  }

  if (!images || images.length === 0) {
    console.log(`  ⚠️ No images found`);
    return { processed: false, found: false };
  }

  console.log(`   Found ${images.length} images, processing via analyze-image function...`);

  // Get a user ID for the function call
  const { data: users } = await supabase.auth.admin.listUsers({ limit: 1 });
  const userId = users?.users[0]?.id;

  if (!userId) {
    console.error(`  ❌ No users found in database`);
    return { processed: false, found: false };
  }

  let foundVIN = null;
  let foundConfidence = 0;

  // Process each image through analyze-image function
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    
    // Skip if already analyzed for VIN
    if (image.exif_data?.vin_tag?.extracted_data?.vin) {
      const existingVIN = image.exif_data.vin_tag.extracted_data.vin;
      console.log(`   [${i + 1}/${images.length}] Image ${image.id} already has VIN: ${existingVIN}`);
      
      if (existingVIN && existingVIN.length === 17) {
        const confidence = image.exif_data.vin_tag.confidence || 0;
        if (confidence > foundConfidence) {
          foundVIN = existingVIN;
          foundConfidence = confidence;
        }
      }
      continue;
    }

    console.log(`   [${i + 1}/${images.length}] Analyzing image ${image.id}...`);

    try {
      // Call analyze-image edge function
      const { data, error } = await supabase.functions.invoke('analyze-image', {
        body: {
          image_url: image.image_url,
          vehicle_id: vehicle.id,
          user_id: userId
        }
      });

      if (error) {
        console.warn(`      ⚠️ Function error: ${error.message}`);
        continue;
      }

      // Check if VIN was extracted
      if (data?.vin_tag?.is_vin_tag && data.vin_tag.extracted_data?.vin) {
        const vin = data.vin_tag.extracted_data.vin.toUpperCase().trim();
        const confidence = data.vin_tag.confidence || 0;

        // Validate VIN
        if (vin.length === 17 && !/[IOQ]/.test(vin)) {
          console.log(`      ✅ Found VIN: ${vin} (confidence: ${confidence}%)`);
          
          if (confidence > foundConfidence) {
            foundVIN = vin;
            foundConfidence = confidence;
          }
        }
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (err) {
      console.warn(`      ⚠️ Error analyzing image:`, err.message);
      continue;
    }
  }

  // Update vehicle VIN if we found one with sufficient confidence
  if (foundVIN && foundConfidence >= 70) {
    // Only update if vehicle doesn't have a VIN, or if we found a different one
    if (!vehicle.vin || vehicle.vin.toUpperCase() !== foundVIN.toUpperCase()) {
      const { error: updateError } = await supabase
        .from('vehicles')
        .update({ vin: foundVIN })
        .eq('id', vehicle.id);

      if (updateError) {
        console.error(`  ❌ Error updating VIN:`, updateError.message);
        return { processed: true, found: true, updated: false };
      }

      console.log(`  ✅ Updated VIN: ${foundVIN} (confidence: ${foundConfidence}%)`);
      return { processed: true, found: true, updated: true, vin: foundVIN, confidence: foundConfidence };
    } else {
      console.log(`  ℹ️ VIN already matches: ${foundVIN}`);
      return { processed: true, found: true, updated: false };
    }
  } else if (foundVIN) {
    console.log(`  ⚠️ VIN found but low confidence: ${foundVIN} (${foundConfidence}%)`);
    return { processed: true, found: true, updated: false };
  } else {
    console.log(`  ❌ No VIN found`);
    return { processed: true, found: false };
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 Re-extracting VINs from vehicle images using analyze-image function...\n');

  // Get all vehicles
  let vehicleQuery = supabase
    .from('vehicles')
    .select('id, year, make, model, vin')
    .order('created_at', { ascending: false });

  // Optionally filter to only vehicles without VINs
  if (ONLY_MISSING_VINS) {
    vehicleQuery = vehicleQuery.or('vin.is.null,vin.eq.,vin.like.VIVA-%');
  }

  const { data: allVehicles, error: vehiclesError } = await vehicleQuery;

  if (vehiclesError) {
    console.error('❌ Error fetching vehicles:', vehiclesError.message);
    process.exit(1);
  }

  if (!allVehicles || allVehicles.length === 0) {
    console.log('ℹ️ No vehicles found');
    return;
  }

  // Pre-filter: Get vehicles that actually have images to speed up processing
  console.log('Checking which vehicles have images...');
  const vehiclesWithImages = [];
  
  for (const vehicle of allVehicles) {
    const { count } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', vehicle.id)
      .or('is_document.is.null,is_document.eq.false');
    
    if (count && count > 0) {
      vehiclesWithImages.push(vehicle);
    }
  }
  
  console.log(`Found ${vehiclesWithImages.length} vehicles with images out of ${allVehicles.length} total\n`);
  
  // Use filtered list - only process vehicles that have images
  const vehiclesToProcess = vehiclesWithImages.length > 0 ? vehiclesWithImages : allVehicles;

  console.log(`Configuration:`);
  console.log(`  - Only missing VINs: ${ONLY_MISSING_VINS}`);
  console.log(`  - Max images per vehicle: ${MAX_IMAGES_PER_VEHICLE}`);
  console.log(`  - Using analyze-image edge function\n`);

  // Limit vehicles if specified
  const finalVehiclesToProcess = MAX_VEHICLES_TO_PROCESS 
    ? vehiclesToProcess.slice(0, MAX_VEHICLES_TO_PROCESS)
    : vehiclesToProcess;

  console.log(`Processing ${finalVehiclesToProcess.length} vehicles with images...\n`);

  const stats = {
    total: finalVehiclesToProcess.length,
    processed: 0,
    found: 0,
    updated: 0,
    errors: 0
  };

  // Process vehicles one at a time to avoid rate limiting
  for (let i = 0; i < finalVehiclesToProcess.length; i++) {
    const vehicle = finalVehiclesToProcess[i];
    console.log(`\n[${i + 1}/${finalVehiclesToProcess.length}]`);

    try {
      const result = await processVehicle(vehicle);
      
      stats.processed++;
      if (result.found) stats.found++;
      if (result.updated) stats.updated++;
      
      // Show progress every 5 vehicles
      if ((i + 1) % 5 === 0) {
        console.log(`\n📊 Progress: ${i + 1}/${finalVehiclesToProcess.length} processed | ${stats.found} VINs found | ${stats.updated} updated`);
      }
    } catch (error) {
      console.error(`  ❌ Error processing vehicle:`, error.message);
      stats.errors++;
    }
  }

  console.log(`\n\n✅ Processing complete!`);
  console.log(`\nStatistics:`);
  console.log(`  Total vehicles: ${stats.total}`);
  console.log(`  Processed: ${stats.processed}`);
  console.log(`  VINs found: ${stats.found}`);
  console.log(`  VINs updated: ${stats.updated}`);
  console.log(`  Errors: ${stats.errors}`);
}

main().catch(console.error);

