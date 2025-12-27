#!/usr/bin/env node
/**
 * Fix Cars & Bids listings with broken/pixelated images
 * 
 * This script:
 * 1. Finds all Cars & Bids vehicles with problematic images
 * 2. Re-extracts full-resolution images from listing URLs
 * 3. Replaces low-res/thumbnail images with full-res versions
 * 4. Updates origin_metadata with correct image URLs
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Find Cars & Bids vehicles with problematic images
async function findProblematicListings() {
  console.log('🔍 Finding Cars & Bids vehicles with problematic images...\n');
  
  // Get all Cars & Bids vehicles
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, platform_url, discovery_url, origin_metadata, profile_origin')
    .or('platform_url.ilike.%carsandbids.com%,discovery_url.ilike.%carsandbids.com%')
    .limit(1000);
  
  if (error) {
    console.error('❌ Error fetching vehicles:', error);
    return [];
  }
  
  if (!vehicles || vehicles.length === 0) {
    console.log('✅ No Cars & Bids vehicles found');
    return [];
  }
  
  console.log(`📊 Found ${vehicles.length} Cars & Bids vehicles\n`);
  
  // Check each vehicle for problematic images
  const problematic = [];
  
  for (const vehicle of vehicles) {
    // Get image count
    const { count: imageCount } = await supabase
      .from('vehicle_images')
      .select('id', { count: 'exact', head: true })
      .eq('vehicle_id', vehicle.id);
    
    // Get listing URL - clean up video URLs
    let listingUrl = vehicle.platform_url || vehicle.discovery_url || 
      (vehicle.origin_metadata?.listing_url) || 
      (vehicle.origin_metadata?.bat_listing_url);
    
    if (!listingUrl || !listingUrl.includes('carsandbids.com/auctions/')) {
      continue;
    }
    
    // Remove /video suffix - that's not the correct listing URL
    // Also look for the actual listing URL in origin_metadata if available
    listingUrl = listingUrl.replace(/\/video\/?$/, '');
    
    // If URL still looks incomplete (just /auctions/ID without year-make-model), 
    // try to find the full URL in metadata or construct it from vehicle data
    if (listingUrl.match(/\/auctions\/[a-zA-Z0-9]+\/?$/)) {
      const fullUrl = vehicle.origin_metadata?.listing_url || 
                     vehicle.origin_metadata?.bat_listing_url;
      if (fullUrl && fullUrl.includes('carsandbids.com/auctions/') && !fullUrl.includes('/video')) {
        listingUrl = fullUrl;
      }
    }
    
    // Check for problematic images (thumbnails, video frames, low-res)
    const { data: images } = await supabase
      .from('vehicle_images')
      .select('id, image_url, source_url')
      .eq('vehicle_id', vehicle.id)
      .limit(100);
    
    if (!images || images.length === 0) {
      problematic.push({ vehicle, issue: 'NO_IMAGES', listingUrl });
      continue;
    }
    
    // Check for thumbnail/video/low-res patterns
    const hasProblematicImages = images.some(img => {
      const url = (img.image_url || img.source_url || '').toLowerCase();
      return url.includes('thumb') || 
             url.includes('thumbnail') || 
             url.includes('video') ||
             url.match(/-\d+x\d+\.(jpg|jpeg|png|webp)$/) ||
             url.includes('-small') ||
             url.includes('-medium');
    });
    
    if (hasProblematicImages) {
      problematic.push({ vehicle, issue: 'LOW_RES_IMAGES', listingUrl, imageCount: images.length });
    } else if (imageCount < 5) {
      problematic.push({ vehicle, issue: 'FEW_IMAGES', listingUrl, imageCount });
    }
  }
  
  console.log(`⚠️  Found ${problematic.length} problematic listings:\n`);
  problematic.forEach((p, i) => {
    console.log(`${i + 1}. ${p.vehicle.year || '?'} ${p.vehicle.make || '?'} ${p.vehicle.model || '?'}`);
    console.log(`   Issue: ${p.issue} | Images: ${p.imageCount || 0} | URL: ${p.listingUrl}\n`);
  });
  
  return problematic;
}

// Re-extract images from listing URL
async function reExtractImages(listingUrl) {
  try {
    console.log(`🔄 Re-extracting images from: ${listingUrl}`);
    
    const { data, error } = await supabase.functions.invoke('extract-premium-auction', {
      body: {
        url: listingUrl,
        max_vehicles: 1,
        debug: false,
      },
    });
    
    if (error) {
      console.error(`❌ Extraction error:`, error);
      return { success: false, error: error.message };
    }
    
    if (!data || !data.success) {
      console.log(`   ⚠️  Extraction response:`, JSON.stringify(data, null, 2));
      return { success: false, error: data?.error || 'Extraction failed' };
    }
    
    // The extraction function stores images in the database, so we need to check external_listings metadata
    // or wait a moment and then check the vehicle's origin_metadata for images
    console.log(`   📊 Extraction result: ${data.vehicles_extracted || 0} extracted, ${data.vehicles_created || 0} created, ${data.vehicles_updated || 0} updated`);
    
    // Try to get images from external_listings metadata if available
    // For now, return success if extraction succeeded - images should be in DB
    return { success: true, images: [], note: 'Images stored in database' };
  } catch (error) {
    console.error(`❌ Exception during extraction:`, error);
    return { success: false, error: error.message };
  }
}

// Fix a single listing
async function fixListing(problematic) {
  const { vehicle, listingUrl } = problematic;
  const vehicleName = `${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}`;
  
  console.log(`\n🔧 Fixing: ${vehicleName} (${vehicle.id.substring(0, 8)}...)`);
  console.log(`   URL: ${listingUrl}`);
  
  // Step 1: Re-extract images (this stores them in the database)
  const extraction = await reExtractImages(listingUrl);
  if (!extraction.success) {
    console.log(`   ⚠️  Failed to extract images: ${extraction.error}`);
    return { success: false, error: extraction.error };
  }
  
  // Wait a moment for images to be stored
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Get images from external_listings metadata
  const { data: externalListing } = await supabase
    .from('external_listings')
    .select('metadata')
    .eq('vehicle_id', vehicle.id)
    .eq('platform', 'carsandbids')
    .maybeSingle();
  
  const fullResImages = externalListing?.metadata?.images || externalListing?.metadata?.image_urls || [];
  
  if (fullResImages.length === 0) {
    console.log(`   ⚠️  No images found in external_listings metadata`);
    return { success: false, error: 'No images extracted' };
  }
  
  console.log(`   ✅ Got ${fullResImages.length} full-resolution images from metadata`);
  
  // Step 2: Delete problematic images (thumbnails, video frames, low-res)
  const { data: existingImages } = await supabase
    .from('vehicle_images')
    .select('id, image_url, source_url')
    .eq('vehicle_id', vehicle.id);
  
  if (existingImages && existingImages.length > 0) {
    const problematicIds = existingImages
      .filter(img => {
        const url = (img.image_url || img.source_url || '').toLowerCase();
        return url.includes('thumb') || 
               url.includes('thumbnail') || 
               url.includes('video') ||
               url.match(/-\d+x\d+\.(jpg|jpeg|png|webp)$/) ||
               url.includes('-small') ||
               url.includes('-medium') ||
               url.includes('media.carsandbids.com'); // Delete all Cars & Bids images to replace with full-res
      })
      .map(img => img.id);
    
    if (problematicIds.length > 0) {
      const { error: deleteError } = await supabase
        .from('vehicle_images')
        .delete()
        .in('id', problematicIds);
      
      if (deleteError) {
        console.log(`   ⚠️  Error deleting old images: ${deleteError.message}`);
      } else {
        console.log(`   🗑️  Deleted ${problematicIds.length} problematic images`);
      }
    }
  }
  
  // Step 3: Update origin_metadata with new full-res image URLs
  const { error: updateError } = await supabase
    .from('vehicles')
    .update({
      origin_metadata: {
        ...(vehicle.origin_metadata || {}),
        image_urls: fullResImages,
        image_count: fullResImages.length,
        images_extracted_at: new Date().toISOString(),
      },
    })
    .eq('id', vehicle.id);
  
  if (updateError) {
    console.log(`   ⚠️  Error updating metadata: ${updateError.message}`);
  } else {
    console.log(`   ✅ Updated origin_metadata with ${fullResImages.length} image URLs`);
  }
  
  // Step 4: Backfill images using the backfill-images function
  console.log(`   📥 Backfilling images...`);
  const { error: backfillError } = await supabase.functions.invoke('backfill-images', {
    body: {
      vehicle_id: vehicle.id,
      image_urls: fullResImages,
      source: 'cars_and_bids',
      run_analysis: false,
      max_images: fullResImages.length,
      continue: false,
    },
  });
  
  if (backfillError) {
    console.log(`   ⚠️  Backfill error: ${backfillError.message}`);
    return { success: false, error: backfillError.message };
  }
  
  console.log(`   ✅ Successfully fixed listing!`);
  return { success: true, imagesAdded: fullResImages.length };
}

// Main execution
async function main() {
  const batchSize = parseInt(process.argv[2]) || 10;
  const startFrom = parseInt(process.argv[3]) || 0;
  
  console.log('🚀 Cars & Bids Listing Fix Script\n');
  console.log(`📦 Batch size: ${batchSize}`);
  console.log(`📍 Starting from: ${startFrom}\n`);
  
  const problematic = await findProblematicListings();
  
  if (problematic.length === 0) {
    console.log('✅ No problematic listings found!');
    return;
  }
  
  const batch = problematic.slice(startFrom, startFrom + batchSize);
  console.log(`\n🔧 Processing ${batch.length} listings...\n`);
  
  const results = [];
  for (let i = 0; i < batch.length; i++) {
    const result = await fixListing(batch[i]);
    results.push(result);
    
    // Rate limiting
    if (i < batch.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  const successCount = results.filter(r => r.success).length;
  console.log(`\n✅ Fixed ${successCount}/${batch.length} listings`);
  
  if (startFrom + batchSize < problematic.length) {
    console.log(`\n📝 Run again with: node scripts/fix-cars-and-bids-listings.js ${batchSize} ${startFrom + batchSize}`);
  }
}

main().catch(console.error);

