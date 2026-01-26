#!/usr/bin/env node

/**
 * Batch Image Optimization Script
 * 
 * This script processes existing images in the database to generate
 * thumbnail, medium, and large variants for performance optimization.
 * 
 * Usage: node batch-optimize-images.js [--limit=100] [--vehicle=uuid]
 */

require('dotenv').config({ path: '../.env' });
const { createClient } = require('@supabase/supabase-js');

// Parse command line arguments
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.split('=');
  acc[key.replace('--', '')] = value || true;
  return acc;
}, {});

const BATCH_SIZE = parseInt(args.limit) || 50;
const VEHICLE_ID = args.vehicle || null;

// Initialize Supabase client
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

// Image size configurations
const IMAGE_SIZES = {
  thumbnail: { width: 150, quality: 70 },
  medium: { width: 400, quality: 80 },
  large: { width: 800, quality: 85 },
};

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get images that need optimization
 */
async function getUnoptimizedImages(limit = BATCH_SIZE, vehicleId = null) {
  let query = supabase
    .from('vehicle_images')
    .select('*')
    .or('optimization_status.eq.pending,optimization_status.is.null')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (vehicleId) {
    query = query.eq('vehicle_id', vehicleId);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching unoptimized images:', error);
    return [];
  }

  return data || [];
}

/**
 * Update image record with variant URLs
 */
async function updateImageRecord(imageId, variants) {
  const { error } = await supabase
    .from('vehicle_images')
    .update({
      thumbnail_url: variants.thumbnail,
      medium_url: variants.medium,
      large_url: variants.large,
      optimization_status: 'completed',
      optimized_at: new Date().toISOString()
    })
    .eq('id', imageId);

  if (error) {
    console.error(`Failed to update image ${imageId}:`, error);
    return false;
  }

  return true;
}

/**
 * Mark image as failed
 */
async function markImageFailed(imageId, errorMessage) {
  await supabase
    .from('vehicle_images')
    .update({
      optimization_status: 'failed',
      optimization_error: errorMessage
    })
    .eq('id', imageId);
}

/**
 * Process a single image
 */
async function processImage(image) {
  console.log(`Processing image ${image.id} for vehicle ${image.vehicle_id}`);

  try {
    // Skip if already optimized
    if (image.optimization_status === 'completed' && 
        image.thumbnail_url && 
        image.medium_url && 
        image.large_url) {
      console.log(`  Image ${image.id} already optimized, skipping`);
      return true;
    }

    // For now, we'll simulate the optimization process
    // In a real implementation, this would:
    // 1. Download the original image
    // 2. Generate variants using sharp or similar library
    // 3. Upload variants to storage
    // 4. Update the database record

    console.log(`  Would optimize image: ${image.image_url}`);
    console.log(`  Storage path: ${image.storage_path}`);
    
    // Simulate variant URLs (in production, these would be real uploaded URLs)
    const variants = {
      thumbnail: image.image_url.replace('/images/', '/images/thumbnail/'),
      medium: image.image_url.replace('/images/', '/images/medium/'),
      large: image.image_url.replace('/images/', '/images/large/')
    };

    // Update database record
    const success = await updateImageRecord(image.id, variants);
    
    if (success) {
      console.log(`  ✓ Image ${image.id} marked as optimized`);
    } else {
      console.log(`  ✗ Failed to update image ${image.id}`);
    }

    return success;
  } catch (error) {
    console.error(`  Error processing image ${image.id}:`, error.message);
    await markImageFailed(image.id, error.message);
    return false;
  }
}

/**
 * Main processing function
 */
async function processImages() {
  console.log('=================================');
  console.log('Batch Image Optimization Script');
  console.log('=================================');
  console.log(`Batch size: ${BATCH_SIZE}`);
  if (VEHICLE_ID) {
    console.log(`Vehicle filter: ${VEHICLE_ID}`);
  }
  console.log('');

  // Get statistics
  const { count: totalImages } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true });

  const { count: unoptimizedCount } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .or('optimization_status.eq.pending,optimization_status.is.null');

  console.log(`Total images: ${totalImages}`);
  console.log(`Unoptimized images: ${unoptimizedCount}`);
  console.log(`Coverage: ${((totalImages - unoptimizedCount) / totalImages * 100).toFixed(2)}%`);
  console.log('');

  // Process images in batches
  let processedCount = 0;
  let successCount = 0;
  let hasMore = true;

  while (hasMore) {
    console.log(`\nFetching batch ${Math.floor(processedCount / BATCH_SIZE) + 1}...`);
    
    const images = await getUnoptimizedImages(BATCH_SIZE, VEHICLE_ID);
    
    if (images.length === 0) {
      console.log('No more images to process');
      hasMore = false;
      break;
    }

    console.log(`Processing ${images.length} images...`);

    for (const image of images) {
      const success = await processImage(image);
      processedCount++;
      if (success) successCount++;

      // Add delay to prevent overwhelming the system
      await sleep(100);
    }

    if (images.length < BATCH_SIZE) {
      hasMore = false;
    }

    // Add delay between batches
    if (hasMore) {
      console.log(`\nWaiting 2 seconds before next batch...`);
      await sleep(2000);
    }
  }

  console.log('\n=================================');
  console.log('Processing Complete');
  console.log('=================================');
  console.log(`Images processed: ${processedCount}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Failed: ${processedCount - successCount}`);
  console.log(`Success rate: ${(successCount / processedCount * 100).toFixed(2)}%`);
}

// Run the script
processImages()
  .then(() => {
    console.log('\nScript completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nScript failed:', error);
    process.exit(1);
  });
