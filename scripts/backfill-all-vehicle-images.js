#!/usr/bin/env node
/**
 * Comprehensive Backfill Script for ALL Vehicle Images
 * 
 * This script:
 * 1. Finds ALL vehicles that have image URLs in origin_metadata but no vehicle_images records
 * 2. OR vehicles that have vehicle_images records but image_url is null/empty
 * 3. Re-extracts images from origin_metadata.image_urls or re-scrapes from discovery_url
 * 4. Downloads and imports images using the same logic as the scraper
 * 5. Ensures image_url field is properly populated
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
const MAX_VEHICLES = null; // null = all, or set to number
const DRY_RUN = false; // Set to true to see what would be done without actually doing it
const BATCH_SIZE = 10; // Process vehicles in batches

/**
 * Get image URLs from vehicle metadata or re-scrape
 */
async function getImageUrls(vehicle) {
  // First, try origin_metadata.image_urls
  const originMeta = vehicle.origin_metadata || {};
  if (originMeta.image_urls && Array.isArray(originMeta.image_urls) && originMeta.image_urls.length > 0) {
    console.log(`   ✅ Found ${originMeta.image_urls.length} cached image URLs in origin_metadata`);
    return originMeta.image_urls.slice(0, 20);
  }
  
  // If no cached URLs, try to re-scrape from discovery_url
  if (vehicle.discovery_url) {
    console.log(`   📡 Re-scraping from discovery_url: ${vehicle.discovery_url}`);
    try {
      const { data, error } = await supabase.functions.invoke('scrape-vehicle', {
        body: { url: vehicle.discovery_url }
      });
      
      if (!error && data?.success && data?.data?.images && data.data.images.length > 0) {
        console.log(`   ✅ Found ${data.data.images.length} images via re-scrape`);
        return data.data.images.slice(0, 20);
      }
    } catch (err) {
      console.warn(`   ⚠️ Re-scrape failed: ${err.message}`);
    }
  }
  
  return [];
}

/**
 * Check if vehicle has valid images in vehicle_images table
 */
async function hasValidImages(vehicleId) {
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url')
    .eq('vehicle_id', vehicleId)
    .eq('is_document', false);
  
  if (error) {
    console.warn(`   ⚠️ Error checking images: ${error.message}`);
    return false;
  }
  
  // Check if we have images with valid image_url
  const validImages = (images || []).filter(img => 
    img.image_url && 
    typeof img.image_url === 'string' && 
    img.image_url.trim() !== '' &&
    (img.image_url.startsWith('http') || img.image_url.startsWith('/'))
  );
  
  return validImages.length > 0;
}

/**
 * Import images for a vehicle
 */
async function importImages(vehicleId, imageUrls, listingUrl, importUserId) {
  if (!imageUrls || imageUrls.length === 0) return { imported: 0 };
  
  let imported = 0;
  
  for (let i = 0; i < imageUrls.length; i++) {
    const imageUrl = imageUrls[i];
    
    try {
      // Download image
      const imageResponse = await fetch(imageUrl, {
        signal: AbortSignal.timeout(10000)
      });
      
      if (!imageResponse.ok) {
        console.warn(`      ⚠️ Failed to download image ${i + 1}: HTTP ${imageResponse.status}`);
        continue;
      }
      
      const imageBlob = await imageResponse.blob();
      const arrayBuffer = await imageBlob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      
      // Generate filename
      const ext = imageUrl.match(/\.(jpg|jpeg|png|webp)$/i)?.[1] || 'jpg';
      const fileName = `backfill_${Date.now()}_${i}.${ext}`;
      const storagePath = `${vehicleId}/${fileName}`;
      
      if (!DRY_RUN) {
        // Upload to Supabase Storage
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('vehicle-images')
          .upload(storagePath, uint8Array, {
            contentType: `image/${ext}`,
            cacheControl: '3600',
            upsert: false
          });
        
        if (uploadError) {
          console.warn(`      ⚠️ Failed to upload image ${i + 1}: ${uploadError.message}`);
          continue;
        }
        
        // Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from('vehicle-images')
          .getPublicUrl(storagePath);
        
        // CRITICAL: Create vehicle_images record with image_url field populated
        const { data: imageData, error: imageInsertError } = await supabase
          .from('vehicle_images')
          .insert({
            vehicle_id: vehicleId,
            image_url: publicUrl, // CRITICAL: This is the field the frontend reads
            user_id: importUserId,
            is_primary: i === 0,
            source: 'backfill',
            taken_at: new Date().toISOString(),
            exif_data: {
              source_url: imageUrl,
              discovery_url: listingUrl,
              imported_by_user_id: importUserId,
              imported_at: new Date().toISOString(),
              backfilled: true
            }
          })
          .select('id')
          .single();
        
        if (imageInsertError) {
          console.warn(`      ⚠️ Failed to create image record ${i + 1}: ${imageInsertError.message}`);
          continue;
        }
        
        imported++;
        if ((i + 1) % 5 === 0) {
          console.log(`      📸 Imported ${i + 1}/${imageUrls.length}...`);
        }
      } else {
        imported++; // Count in dry run
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
      
    } catch (err) {
      console.warn(`      ⚠️ Error processing image ${i + 1}: ${err.message}`);
    }
  }
  
  return { imported };
}

/**
 * Fix existing images that have null/empty image_url
 */
async function fixExistingImages(vehicleId) {
  // Find images with null or empty image_url
  const { data: brokenImages, error } = await supabase
    .from('vehicle_images')
    .select('id, storage_path, variants')
    .eq('vehicle_id', vehicleId)
    .eq('is_document', false)
    .or('image_url.is.null,image_url.eq.');
  
  if (error || !brokenImages || brokenImages.length === 0) {
    return { fixed: 0 };
  }
  
  console.log(`   🔧 Found ${brokenImages.length} images with missing image_url, fixing...`);
  
  let fixed = 0;
  for (const img of brokenImages) {
    // Try to reconstruct URL from storage_path
    if (img.storage_path) {
      const { data: { publicUrl } } = supabase.storage
        .from('vehicle-images')
        .getPublicUrl(img.storage_path);
      
      if (publicUrl) {
        const { error: updateError } = await supabase
          .from('vehicle_images')
          .update({ image_url: publicUrl })
          .eq('id', img.id);
        
        if (!updateError) {
          fixed++;
          console.log(`      ✅ Fixed image ${img.id}`);
        }
      }
    }
    
    // Also try variants if storage_path doesn't work
    if (!img.storage_path && img.variants) {
      const variants = typeof img.variants === 'string' ? JSON.parse(img.variants) : img.variants;
      const url = variants.full || variants.large || variants.medium || variants.thumbnail;
      
      if (url) {
        const { error: updateError } = await supabase
          .from('vehicle_images')
          .update({ image_url: url })
          .eq('id', img.id);
        
        if (!updateError) {
          fixed++;
          console.log(`      ✅ Fixed image ${img.id} from variants`);
        }
      }
    }
  }
  
  return { fixed };
}

/**
 * Process a single vehicle
 */
async function processVehicle(vehicle, importUserId) {
  console.log(`\n📦 ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.id})`);
  
  // First, check if vehicle already has valid images
  const hasImages = await hasValidImages(vehicle.id);
  if (hasImages) {
    console.log(`   ✅ Vehicle already has valid images`);
    
    // Still check for broken images and fix them
    const fixResult = await fixExistingImages(vehicle.id);
    if (fixResult.fixed > 0) {
      console.log(`   🔧 Fixed ${fixResult.fixed} broken image records`);
    }
    
    return { processed: true, imported: 0, fixed: fixResult.fixed, reason: 'already_has_images' };
  }
  
  // Get image URLs
  const imageUrls = await getImageUrls(vehicle);
  
  if (!imageUrls || imageUrls.length === 0) {
    console.log(`   ❌ No images available`);
    return { processed: true, imported: 0, reason: 'no_images' };
  }
  
  console.log(`   ✅ Found ${imageUrls.length} images to import`);
  
  // Import images
  if (DRY_RUN) {
    console.log(`   🔍 DRY RUN: Would import ${imageUrls.length} images`);
    return { processed: true, imported: imageUrls.length, reason: 'dry_run' };
  }
  
  console.log(`   📥 Downloading and importing images...`);
  const result = await importImages(vehicle.id, imageUrls, vehicle.discovery_url, importUserId);
  
  console.log(`   ✅ Imported ${result.imported}/${imageUrls.length} images`);
  return { processed: true, imported: result.imported };
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 Comprehensive Vehicle Image Backfill\n');
  
  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }
  
  // Get a valid user ID
  const { data: vehicleUser, error: vehicleError } = await supabase
    .from('vehicles')
    .select('uploaded_by')
    .not('uploaded_by', 'is', null)
    .limit(1)
    .maybeSingle();
  
  let importUserId = vehicleUser?.uploaded_by;
  
  if (!importUserId) {
    const { data: vehiclesWithUser } = await supabase
      .from('vehicles')
      .select('user_id')
      .not('user_id', 'is', null)
      .limit(1)
      .maybeSingle();
    
    importUserId = vehiclesWithUser?.user_id;
  }
  
  if (!importUserId) {
    console.error('❌ No valid user ID found. Need at least one vehicle with uploaded_by or user_id.');
    process.exit(1);
  }
  
  console.log(`Using user ID: ${importUserId}\n`);
  
  // Find vehicles that need image backfill
  console.log('Finding vehicles that need image backfill...\n');
  
  // Strategy: Get all vehicles, then check which ones need images
  const { data: allVehicles, error: vehiclesError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, origin_metadata')
    .eq('is_public', true)
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  
  if (vehiclesError) {
    console.error('❌ Error fetching vehicles:', vehiclesError.message);
    process.exit(1);
  }
  
  if (!allVehicles || allVehicles.length === 0) {
    console.log('ℹ️ No vehicles found');
    return;
  }
  
  console.log(`Found ${allVehicles.length} active public vehicles\n`);
  
  // Check which vehicles need images (batch check)
  const vehiclesNeedingImages = [];
  
  for (let i = 0; i < allVehicles.length; i += BATCH_SIZE) {
    const batch = allVehicles.slice(i, i + BATCH_SIZE);
    const vehicleIds = batch.map(v => v.id);
    
    // Check which have images
    const { data: vehiclesWithImages } = await supabase
      .from('vehicle_images')
      .select('vehicle_id, image_url')
      .in('vehicle_id', vehicleIds)
      .eq('is_document', false);
    
    const vehiclesWithValidImages = new Set();
    (vehiclesWithImages || []).forEach(img => {
      if (img.image_url && typeof img.image_url === 'string' && img.image_url.trim() !== '') {
        vehiclesWithValidImages.add(img.vehicle_id);
      }
    });
    
    // Add vehicles that don't have valid images
    batch.forEach(vehicle => {
      if (!vehiclesWithValidImages.has(vehicle.id)) {
        vehiclesNeedingImages.push(vehicle);
      }
    });
    
    console.log(`Checked ${Math.min(i + BATCH_SIZE, allVehicles.length)}/${allVehicles.length} vehicles...`);
  }
  
  console.log(`\nFound ${vehiclesNeedingImages.length} vehicles needing images\n`);
  
  if (vehiclesNeedingImages.length === 0) {
    console.log('✅ All vehicles already have images!');
    return;
  }
  
  const vehiclesToProcess = MAX_VEHICLES 
    ? vehiclesNeedingImages.slice(0, MAX_VEHICLES)
    : vehiclesNeedingImages;
  
  console.log(`Processing ${vehiclesToProcess.length} vehicles...\n`);
  
  const stats = {
    total: vehiclesToProcess.length,
    processed: 0,
    imported: 0,
    fixed: 0,
    errors: 0,
    no_images: 0,
    already_has_images: 0
  };
  
  // Process vehicles
  for (let i = 0; i < vehiclesToProcess.length; i++) {
    const vehicle = vehiclesToProcess[i];
    console.log(`\n[${i + 1}/${vehiclesToProcess.length}]`);
    
    try {
      const result = await processVehicle(vehicle, importUserId);
      
      stats.processed++;
      if (result.imported) stats.imported += result.imported;
      if (result.fixed) stats.fixed += result.fixed;
      if (result.reason === 'no_images') stats.no_images++;
      if (result.reason === 'already_has_images') stats.already_has_images++;
      
      // Progress update every 10
      if ((i + 1) % 10 === 0) {
        console.log(`\n📊 Progress: ${i + 1}/${vehiclesToProcess.length} | ${stats.imported} images imported | ${stats.fixed} fixed`);
      }
      
      // Delay between vehicles
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.error(`  ❌ Error: ${error.message}`);
      stats.errors++;
    }
  }
  
  console.log(`\n\n✅ Backfill complete!`);
  console.log(`\nStatistics:`);
  console.log(`  Total vehicles: ${stats.total}`);
  console.log(`  Processed: ${stats.processed}`);
  console.log(`  Images imported: ${stats.imported}`);
  console.log(`  Images fixed: ${stats.fixed}`);
  console.log(`  Already had images: ${stats.already_has_images}`);
  console.log(`  No images available: ${stats.no_images}`);
  console.log(`  Errors: ${stats.errors}`);
}

main().catch(console.error);

