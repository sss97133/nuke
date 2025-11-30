#!/usr/bin/env node
/**
 * Backfill missing images for Craigslist vehicles
 * 
 * This script:
 * 1. Finds vehicles imported from Craigslist that have no images
 * 2. Gets their original listing URL from discovery_url or external_listings
 * 3. Re-scrapes the listing to get image URLs
 * 4. Downloads and imports images using the same logic as the scraper
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

/**
 * Get listing URL from vehicle metadata
 */
async function getListingUrl(vehicleId) {
  // Try external_listings first
  const { data: external } = await supabase
    .from('external_listings')
    .select('listing_url')
    .eq('vehicle_id', vehicleId)
    .maybeSingle();
  
  if (external?.listing_url) {
    return external.listing_url;
  }
  
  // Try timeline_events metadata
  const { data: events } = await supabase
    .from('timeline_events')
    .select('metadata')
    .eq('vehicle_id', vehicleId)
    .eq('source', 'craigslist')
    .order('event_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  
  if (events?.metadata?.listing_url) {
    return events.metadata.listing_url;
  }
  
  // Try vehicle discovery_url
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('discovery_url')
    .eq('id', vehicleId)
    .maybeSingle();
  
  if (vehicle?.discovery_url) {
    return vehicle.discovery_url;
  }
  
  return null;
}

/**
 * Scrape listing to get images
 */
async function scrapeListingImages(listingUrl) {
  try {
    const { data, error } = await supabase.functions.invoke('scrape-vehicle', {
      body: { url: listingUrl }
    });
    
    if (error) {
      console.warn(`      ⚠️ Scrape error: ${error.message}`);
      return null;
    }
    
    if (data?.success && data?.data?.images && data.data.images.length > 0) {
      return data.data.images;
    }
    
    return null;
  } catch (err) {
    console.warn(`      ⚠️ Scrape failed: ${err.message}`);
    return null;
  }
}

/**
 * Import images for a vehicle
 */
async function importImages(vehicleId, imageUrls, listingUrl, importUserId) {
  if (!imageUrls || imageUrls.length === 0) return { imported: 0 };
  
  // Create ghost user for Craigslist photographer
  const photographerFingerprint = `CL-Photographer-${listingUrl}`;
  let ghostUserId = null;
  
  const { data: existingGhost } = await supabase
    .from('ghost_users')
    .select('id')
    .eq('device_fingerprint', photographerFingerprint)
    .maybeSingle();
  
  if (existingGhost?.id) {
    ghostUserId = existingGhost.id;
  } else {
    const { data: newGhost, error: ghostError } = await supabase
      .from('ghost_users')
      .insert({
        device_fingerprint: photographerFingerprint,
        camera_make: 'Unknown',
        camera_model: 'Craigslist Listing',
        display_name: `Craigslist Photographer`,
        total_contributions: 0
      })
      .select('id')
      .single();
    
    if (!ghostError && newGhost?.id) {
      ghostUserId = newGhost.id;
    }
  }

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
      const fileName = `${Date.now()}_${i}.${ext}`;
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
        
        // Create vehicle_images record
        // Use importUserId (real user) not ghostUserId for user_id field
        // Ghost users are tracked via device_attributions table
        const { data: imageData, error: imageInsertError } = await supabase
          .from('vehicle_images')
          .insert({
            vehicle_id: vehicleId,
            image_url: publicUrl,
            user_id: importUserId, // Must be real auth user for triggers
            is_primary: i === 0,
            source: 'craigslist_scrape',
            taken_at: new Date().toISOString(),
            exif_data: {
              source_url: imageUrl,
              discovery_url: listingUrl,
              imported_by_user_id: importUserId,
              imported_at: new Date().toISOString(),
              attribution_note: 'Photographer unknown - images from Craigslist listing. Original photographer can claim with proof.',
              claimable: true,
              device_fingerprint: photographerFingerprint,
              ghost_user_id: ghostUserId // Store ghost user reference in metadata
            }
          })
          .select('id')
          .single();
        
        if (imageInsertError) {
          console.warn(`      ⚠️ Failed to create image record ${i + 1}: ${imageInsertError.message}`);
          continue;
        }
        
        // Create device attribution if ghost user exists
        if (imageData?.id && ghostUserId) {
          await supabase
            .from('device_attributions')
            .insert({
              image_id: imageData.id,
              device_fingerprint: photographerFingerprint,
              ghost_user_id: ghostUserId,
              uploaded_by_user_id: importUserId,
              attribution_source: 'craigslist_listing_unknown_photographer',
              confidence_score: 50
            });
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
 * Process a single vehicle
 */
async function processVehicle(vehicle, importUserId) {
  console.log(`\n📦 ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.id})`);
  
  // Get listing URL
  const listingUrl = await getListingUrl(vehicle.id);
  
  if (!listingUrl) {
    console.log(`   ⚠️ No listing URL found - skipping`);
    return { processed: false, reason: 'no_url' };
  }
  
  console.log(`   📄 Listing: ${listingUrl}`);
  
  // Scrape images
  console.log(`   📸 Scraping images...`);
  const imageUrls = await scrapeListingImages(listingUrl);
  
  if (!imageUrls || imageUrls.length === 0) {
    console.log(`   ❌ No images found in listing`);
    return { processed: true, imported: 0, reason: 'no_images' };
  }
  
  console.log(`   ✅ Found ${imageUrls.length} images`);
  
  // Import images
  if (DRY_RUN) {
    console.log(`   🔍 DRY RUN: Would import ${imageUrls.length} images`);
    return { processed: true, imported: imageUrls.length, reason: 'dry_run' };
  }
  
  console.log(`   📥 Downloading and importing images...`);
  const result = await importImages(vehicle.id, imageUrls, listingUrl, importUserId);
  
  console.log(`   ✅ Imported ${result.imported}/${imageUrls.length} images`);
  return { processed: true, imported: result.imported };
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 Backfilling missing Craigslist images...\n');
  
  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }
  
  // Get a valid user ID from existing vehicles that have an uploaded_by
  const { data: vehicleUser, error: vehicleError } = await supabase
    .from('vehicles')
    .select('uploaded_by')
    .not('uploaded_by', 'is', null)
    .limit(1)
    .maybeSingle();
  
  let importUserId = vehicleUser?.uploaded_by;
  
  if (!importUserId) {
    // Try to get from auth.users via RPC or check vehicles.user_id (generated column)
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
    console.error('   Create a vehicle first, or manually set importUserId in the script.');
    process.exit(1);
  }
  
  console.log(`Using user ID: ${importUserId}\n`);
  
  // Find vehicles from Craigslist with no images
  console.log('Finding Craigslist vehicles without images...\n');
  
  // Get vehicles with discovery_source or source = craigslist
  const { data: vehicles, error: vehiclesError } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .or('discovery_source.ilike.%craigslist%,discovery_source.ilike.%cl%')
    .order('created_at', { ascending: false });
  
  if (vehiclesError) {
    console.error('❌ Error fetching vehicles:', vehiclesError.message);
    process.exit(1);
  }
  
  if (!vehicles || vehicles.length === 0) {
    console.log('ℹ️ No Craigslist vehicles found');
    return;
  }
  
  console.log(`Found ${vehicles.length} Craigslist vehicles\n`);
  
  // Check which ones have no images
  const vehiclesWithoutImages = [];
  
  for (const vehicle of vehicles) {
    const { count } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', vehicle.id)
      .or('is_document.is.null,is_document.eq.false');
    
    if (!count || count === 0) {
      vehiclesWithoutImages.push(vehicle);
    }
  }
  
  console.log(`Found ${vehiclesWithoutImages.length} vehicles without images\n`);
  
  if (vehiclesWithoutImages.length === 0) {
    console.log('✅ All vehicles already have images!');
    return;
  }
  
  const vehiclesToProcess = MAX_VEHICLES 
    ? vehiclesWithoutImages.slice(0, MAX_VEHICLES)
    : vehiclesWithoutImages;
  
  console.log(`Processing ${vehiclesToProcess.length} vehicles...\n`);
  
  const stats = {
    total: vehiclesToProcess.length,
    processed: 0,
    imported: 0,
    errors: 0,
    no_url: 0,
    no_images: 0
  };
  
  // Process vehicles
  for (let i = 0; i < vehiclesToProcess.length; i++) {
    const vehicle = vehiclesToProcess[i];
    console.log(`\n[${i + 1}/${vehiclesToProcess.length}]`);
    
    try {
      const result = await processVehicle(vehicle, importUserId);
      
      stats.processed++;
      if (result.imported) stats.imported += result.imported;
      if (result.reason === 'no_url') stats.no_url++;
      if (result.reason === 'no_images') stats.no_images++;
      
      // Progress update every 10
      if ((i + 1) % 10 === 0) {
        console.log(`\n📊 Progress: ${i + 1}/${vehiclesToProcess.length} | ${stats.imported} images imported`);
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
  console.log(`  No listing URL: ${stats.no_url}`);
  console.log(`  No images in listing: ${stats.no_images}`);
  console.log(`  Errors: ${stats.errors}`);
}

main().catch(console.error);

