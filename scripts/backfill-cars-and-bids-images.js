#!/usr/bin/env node

/**
 * Backfill Cars & Bids vehicles with missing images
 * 
 * Problem: Cars & Bids vehicles have image URLs in origin_metadata.image_urls
 * but not all images are inserted into vehicle_images table because:
 * 1. CDN path parameters (width=80,height=80) aren't being cleaned properly
 * 2. Some URLs are filtered out as "garbage" thumbnails
 * 
 * Solution: Re-process image URLs from origin_metadata, properly clean them,
 * and insert any missing images into vehicle_images table.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '../nuke_frontend/.env.local') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/**
 * Clean Cars & Bids image URL - remove CDN path parameters to get full resolution
 */
function cleanCarsAndBidsImageUrl(url) {
  if (!url || typeof url !== 'string') return null;
  
  let cleaned = url.trim();
  
  // Decode HTML entities
  cleaned = cleaned
    .replace(/&#038;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"');
  
  // Cars & Bids CDN: Remove width/height/quality/fit params from path
  // Example: /cdn-cgi/image/width=80,height=80,quality=70,fit=cover/... -> /cdn-cgi/image/...
  if (cleaned.includes('cdn-cgi/image/')) {
    // Remove path-based parameters (width=, height=, quality=, fit=)
    cleaned = cleaned.replace(/cdn-cgi\/image\/width=\d+,height=\d+,quality=\d+,fit=\w+\//, 'cdn-cgi/image/');
    cleaned = cleaned.replace(/cdn-cgi\/image\/width=\d+,height=\d+,quality=\d+\//, 'cdn-cgi/image/');
    cleaned = cleaned.replace(/cdn-cgi\/image\/width=\d+,height=\d+\//, 'cdn-cgi/image/');
    cleaned = cleaned.replace(/cdn-cgi\/image\/width=\d+,quality=\d+\//, 'cdn-cgi/image/');
    cleaned = cleaned.replace(/cdn-cgi\/image\/width=\d+\//, 'cdn-cgi/image/');
    cleaned = cleaned.replace(/cdn-cgi\/image\/quality=\d+\//, 'cdn-cgi/image/');
  }
  
  // Remove query parameters
  cleaned = cleaned.split('?')[0];
  
  // Remove size suffixes
  cleaned = cleaned
    .replace(/-\d+x\d+\.(jpg|jpeg|png|webp)$/i, '.$1')
    .replace(/-thumb(?:nail)?\.(jpg|jpeg|png|webp)$/i, '.$1')
    .replace(/-small\.(jpg|jpeg|png|webp)$/i, '.$1')
    .replace(/-medium\.(jpg|jpeg|png|webp)$/i, '.$1');
  
  return cleaned.trim();
}

/**
 * Check if URL is a valid vehicle image (not garbage)
 */
function isValidVehicleImage(url) {
  if (!url || typeof url !== 'string') return false;
  
  const lower = url.toLowerCase();
  
  // Must be from Cars & Bids media CDN
  if (!lower.includes('media.carsandbids.com')) return false;
  
  // Exclude SVGs
  if (lower.endsWith('.svg') || lower.includes('.svg?')) return false;
  
  // Exclude UI elements
  if (lower.includes('/countries/')) return false;
  if (lower.includes('/logo') || lower.includes('/logos/')) return false;
  if (lower.includes('/icon') || lower.includes('/icons/')) return false;
  if (lower.includes('/assets/') || lower.includes('/static/')) return false;
  if (lower.includes('/button') || lower.includes('/badge')) return false;
  if (lower.includes('/avatar') || lower.includes('/profile_pic')) return false;
  if (lower.includes('/favicon')) return false;
  if (lower.includes('/seller/')) return false;
  if (lower.includes('placeholder')) return false;
  
  // Exclude video thumbnails
  if (lower.includes('/video') || lower.includes('/videos/')) return false;
  
  // Even after cleaning, if it still has tiny size params in path, skip it
  if (lower.match(/width=80|width=100|width=120|height=80|height=100|height=120/)) {
    // Double-check - maybe it's already cleaned
    if (!lower.includes('/cdn-cgi/image/')) {
      // If no CDN path, might be valid
      return true;
    }
    return false;
  }
  
  return true;
}

/**
 * Backfill images for a single vehicle
 */
async function backfillVehicleImages(vehicle) {
  const vehicleId = vehicle.id;
  const discoveryUrl = vehicle.discovery_url || vehicle.platform_url;
  
  console.log(`\n🔍 Processing: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`   ID: ${vehicleId}`);
  console.log(`   URL: ${discoveryUrl || 'NONE'}`);
  
  // Get image URLs from origin_metadata
  const originMetadata = vehicle.origin_metadata || {};
  const imageUrls = originMetadata.image_urls || originMetadata.images || [];
  
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    console.log(`   ⚠️  No image URLs in origin_metadata`);
    return { success: false, reason: 'no_image_urls' };
  }
  
  console.log(`   📸 Found ${imageUrls.length} image URLs in metadata`);
  
  // Clean and filter URLs
  const cleanedUrls = imageUrls
    .map(cleanCarsAndBidsImageUrl)
    .filter(url => url && url.startsWith('http'))
    .filter(isValidVehicleImage);
  
  console.log(`   ✅ ${cleanedUrls.length} valid cleaned URLs`);
  
  if (cleanedUrls.length === 0) {
    console.log(`   ⚠️  No valid image URLs after cleaning`);
    return { success: false, reason: 'no_valid_urls' };
  }
  
  // Get existing images for this vehicle
  const { data: existingImages, error: existingError } = await supabase
    .from('vehicle_images')
    .select('image_url')
    .eq('vehicle_id', vehicleId);
  
  if (existingError) {
    console.log(`   ❌ Error fetching existing images: ${existingError.message}`);
    return { success: false, reason: 'fetch_error', error: existingError.message };
  }
  
  const existingUrls = new Set((existingImages || []).map(img => img.image_url));
  console.log(`   📊 Already have ${existingUrls.size} images in database`);
  
  // Find missing URLs
  const missingUrls = cleanedUrls.filter(url => !existingUrls.has(url));
  
  if (missingUrls.length === 0) {
    console.log(`   ✅ All images already inserted`);
    return { success: true, reason: 'already_complete', inserted: 0 };
  }
  
  console.log(`   🔄 Need to insert ${missingUrls.length} missing images`);
  
  // Get next position
  let nextPosition = 0;
  let hasPrimary = false;
  
  if (existingImages && existingImages.length > 0) {
    const { data: positionData } = await supabase
      .from('vehicle_images')
      .select('position, is_primary')
      .eq('vehicle_id', vehicleId)
      .order('position', { ascending: false })
      .limit(1)
      .single();
    
    if (positionData) {
      nextPosition = (positionData.position || 0) + 1;
      hasPrimary = positionData.is_primary === true;
    }
    
    // Check if any existing image is primary
    if (!hasPrimary) {
      const { data: primaryCheck } = await supabase
        .from('vehicle_images')
        .select('is_primary')
        .eq('vehicle_id', vehicleId)
        .eq('is_primary', true)
        .limit(1)
        .single();
      
      hasPrimary = primaryCheck !== null;
    }
  }
  
  // Insert missing images
  let inserted = 0;
  let errors = [];
  
  for (const imageUrl of missingUrls) {
    try {
      const makePrimary = !hasPrimary && nextPosition === 0;
      
      const { error: insertError } = await supabase
        .from('vehicle_images')
        .insert({
          vehicle_id: vehicleId,
          image_url: imageUrl,
          source: 'external_import',
          source_url: imageUrl,
          is_external: true,
          ai_processing_status: 'pending',
          position: nextPosition,
          display_order: nextPosition,
          is_primary: makePrimary,
          is_document: false,
          is_approved: true,
          approval_status: 'auto_approved',
          redaction_level: 'none',
          exif_data: {
            source_url: discoveryUrl,
            discovery_url: discoveryUrl,
            imported_from: 'cars & bids',
            backfilled: true,
            backfill_date: new Date().toISOString(),
          },
        });
      
      if (insertError) {
        const errorMsg = `Failed to insert ${imageUrl}: ${insertError.message}`;
        console.log(`   ❌ ${errorMsg}`);
        errors.push(errorMsg);
      } else {
        inserted++;
        if (makePrimary) hasPrimary = true;
        nextPosition++;
      }
    } catch (e) {
      const errorMsg = `Exception inserting ${imageUrl}: ${e.message}`;
      console.log(`   ❌ ${errorMsg}`);
      errors.push(errorMsg);
    }
  }
  
  console.log(`   ✅ Inserted ${inserted} images${errors.length > 0 ? ` (${errors.length} errors)` : ''}`);
  
  return {
    success: true,
    inserted,
    errors,
    total_urls: cleanedUrls.length,
    existing_count: existingUrls.size,
    new_count: inserted,
  };
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 Starting Cars & Bids image backfill\n');
  console.log(`Supabase URL: ${SUPABASE_URL.substring(0, 30)}...\n`);
  
  // Get command line args
  const args = process.argv.slice(2);
  const vehicleIdArg = args.find(arg => arg.startsWith('--vehicle-id='));
  const vehicleId = vehicleIdArg ? vehicleIdArg.split('=')[1] : null;
  
  if (vehicleId) {
    // Backfill single vehicle
    console.log(`Processing single vehicle: ${vehicleId}\n`);
    
    const { data: vehicle, error } = await supabase
      .from('vehicles')
      .select('id, year, make, model, discovery_url, platform_url, origin_metadata')
      .eq('id', vehicleId)
      .single();
    
    if (error || !vehicle) {
      console.error(`❌ Vehicle not found: ${error?.message || 'Unknown error'}`);
      process.exit(1);
    }
    
    const result = await backfillVehicleImages(vehicle);
    console.log(`\n📊 Result:`, result);
  } else {
    // Backfill all Cars & Bids vehicles with missing images
    console.log('Finding Cars & Bids vehicles with missing images...\n');
    
    // Find vehicles with Cars & Bids URLs
    const { data: vehicles, error } = await supabase
      .from('vehicles')
      .select('id, year, make, model, discovery_url, platform_url, origin_metadata')
      .or('discovery_url.ilike.%carsandbids.com%,platform_url.ilike.%carsandbids.com%')
      .limit(100);
    
    if (error) {
      console.error(`❌ Error fetching vehicles: ${error.message}`);
      process.exit(1);
    }
    
    console.log(`Found ${vehicles.length} Cars & Bids vehicles\n`);
    
    // For each vehicle, check if it has missing images
    const results = {
      processed: 0,
      inserted: 0,
      already_complete: 0,
      errors: [],
    };
    
    for (const vehicle of vehicles) {
      const result = await backfillVehicleImages(vehicle);
      results.processed++;
      
      if (result.success) {
        if (result.inserted > 0) {
          results.inserted += result.inserted;
        } else {
          results.already_complete++;
        }
      } else {
        results.errors.push({
          vehicle_id: vehicle.id,
          reason: result.reason,
          error: result.error,
        });
      }
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`   Processed: ${results.processed}`);
    console.log(`   Images inserted: ${results.inserted}`);
    console.log(`   Already complete: ${results.already_complete}`);
    console.log(`   Errors: ${results.errors.length}`);
    
    if (results.errors.length > 0) {
      console.log(`\n❌ Errors:`);
      results.errors.forEach(err => {
        console.log(`   - ${err.vehicle_id}: ${err.reason}${err.error ? ` (${err.error})` : ''}`);
      });
    }
  }
}

// Run
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

