#!/usr/bin/env node
/**
 * Clean up contaminated images from all BaT vehicle listings
 * 
 * This script:
 * 1. Finds all BaT vehicles
 * 2. Gets canonical image URLs from origin_metadata (DOM-extracted, clean)
 * 3. Marks images that don't match canonical set as duplicates/contaminated
 * 4. Uses noise filtering to identify obviously wrong images
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Error: Supabase service role key not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Normalize image URLs for comparison (same logic as batDomMap.ts)
function normalizeImageUrl(url) {
  if (!url || typeof url !== 'string') return null;
  return url
    .split('#')[0]
    .split('?')[0]
    .replace(/&#038;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/-scaled\./g, '.')
    .replace(/[?&]w=\d+/g, '')
    .replace(/[?&]resize=[^&]*/g, '')
    .replace(/[?&]fit=[^&]*/g, '')
    .trim();
}

// Check if image is known BaT noise (same logic as batDomMap.ts)
function isKnownNoise(url) {
  const f = url.toLowerCase();
  return (
    f.includes('qotw') ||
    f.includes('winner-template') ||
    f.includes('weekly-weird') ||
    f.includes('mile-marker') ||
    f.includes('podcast') ||
    f.includes('merch') ||
    f.includes('dec-merch') ||
    f.includes('podcast-graphic') ||
    f.includes('site-post-') ||
    f.includes('thumbnail-template') ||
    f.includes('screenshot-') ||
    f.includes('countries/') ||
    f.includes('themes/') ||
    f.includes('assets/img/') ||
    /\/web-\d{3,}-/i.test(f) ||
    // Ducati and other brands that don't match vehicle
    f.includes('ducati')
  );
}

async function cleanupVehicleImages(vehicle) {
  const vehicleId = vehicle.id;
  const vehicleName = `${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}`;
  
  console.log(`\n🔍 Processing: ${vehicleName} (${vehicleId.substring(0, 8)}...)`);
  
  // Get canonical images from origin_metadata (these are the clean, DOM-extracted images)
  const om = (vehicle.origin_metadata && typeof vehicle.origin_metadata === 'object') ? vehicle.origin_metadata : {};
  const rawCanonicalUrls = Array.isArray(om?.image_urls) ? om.image_urls : [];
  
  // CRITICAL: Filter noise from canonical URLs first! 
  // The canonical list itself may be contaminated with SVG icons, themes, etc.
  const cleanCanonicalUrls = rawCanonicalUrls.filter(url => {
    if (!url || typeof url !== 'string') return false;
    // Only include actual wp-content/uploads images (not themes, assets, SVG, etc.)
    return url.includes('bringatrailer.com/wp-content/uploads/') && 
           !url.includes('.svg') &&
           !isKnownNoise(url);
  });
  
  const canonicalSet = new Set(cleanCanonicalUrls.map(normalizeImageUrl).filter(Boolean));
  
  console.log(`   Raw canonical URLs: ${rawCanonicalUrls.length}, Clean canonical URLs: ${canonicalSet.size}`);
  
  if (canonicalSet.size === 0) {
    console.log(`   ⚠️  No clean canonical images found in origin_metadata, skipping`);
    return { vehicleId, removed: 0, kept: 0, skipped: true };
  }
  
  // Get all BaT images for this vehicle
  // We want images where EITHER image_url OR source_url contains BaT URL
  // (some images have BaT URL in image_url, others have it in source_url after being stored)
  const { data: images, error: imgErr } = await supabase
    .from('vehicle_images')
    .select('id, image_url, source_url, storage_path, is_primary, is_duplicate, created_at')
    .eq('vehicle_id', vehicleId);
  
  // Filter to only BaT images (check both image_url and source_url)
  const batImages = (images || []).filter(img => {
    const imgUrl = (img.image_url || '').toLowerCase();
    const srcUrl = (img.source_url || '').toLowerCase();
    return imgUrl.includes('bringatrailer.com/wp-content/uploads/') || 
           srcUrl.includes('bringatrailer.com/wp-content/uploads/');
  });
  
  if (imgErr) {
    console.error(`   ❌ Error fetching images: ${imgErr.message}`);
    return { vehicleId, removed: 0, kept: 0, error: imgErr.message };
  }
  
  const totalImages = batImages.length;
  console.log(`   Total BaT images in DB: ${totalImages}`);
  
  if (batImages.length === 0) {
    return { vehicleId, removed: 0, kept: 0, skipped: true };
  }
  
  // Extract original BaT URL from image (could be in image_url or source_url)
  const extractBatUrl = (img) => {
    // Prefer source_url (original URL before storage)
    if (img.source_url && img.source_url.includes('bringatrailer.com/wp-content/uploads/')) {
      return normalizeImageUrl(img.source_url);
    }
    // Fall back to image_url if it's a BaT URL
    if (img.image_url && img.image_url.includes('bringatrailer.com/wp-content/uploads/')) {
      return normalizeImageUrl(img.image_url);
    }
    // Can't find BaT URL
    return null;
  };
  
  // Build set of normalized canonical URLs (already filtered for noise above)
  const normalizedCanonicalSet = new Set();
  for (const url of cleanCanonicalUrls) {
    const normalized = normalizeImageUrl(url);
    if (normalized) normalizedCanonicalSet.add(normalized);
  }
  
  // Group images by date bucket to identify the correct set
  const bucketCounts = new Map();
  const imagesByBucket = new Map();
  
  for (const img of batImages) {
    const batUrl = extractBatUrl(img);
    
    if (batUrl && batUrl.includes('bringatrailer.com/wp-content/uploads/')) {
      const bucket = batUrl.match(/\/wp-content\/uploads\/(\d{4})\/(\d{2})\//);
      if (bucket) {
        const bucketKey = `${bucket[1]}/${bucket[2]}`;
        bucketCounts.set(bucketKey, (bucketCounts.get(bucketKey) || 0) + 1);
        if (!imagesByBucket.has(bucketKey)) imagesByBucket.set(bucketKey, []);
        imagesByBucket.get(bucketKey).push(img);
      }
    }
  }
  
  // Find dominant bucket (should match canonical images' date)
  let dominantBucket = null;
  let dominantCount = 0;
  for (const [bucket, count] of bucketCounts.entries()) {
    if (count > dominantCount) {
      dominantBucket = bucket;
      dominantCount = count;
    }
  }
  
  // Identify images to remove
  const imagesToRemove = [];
  const imagesToKeep = [];
  
  for (const img of batImages) {
    const batUrl = extractBatUrl(img);
    if (!batUrl) {
      // Can't determine original URL, be conservative and keep it
      imagesToKeep.push(img);
      continue;
    }
    
    // Remove if it's known noise
    if (isKnownNoise(batUrl)) {
      imagesToRemove.push({ ...img, reason: 'known_noise', batUrl });
      continue;
    }
    
    // Keep if it's in canonical set
    if (normalizedCanonicalSet.has(batUrl)) {
      imagesToKeep.push(img);
      continue;
    }
    
    // Check if it's in the dominant date bucket (likely from same listing)
    const bucket = batUrl.match(/\/wp-content\/uploads\/(\d{4})\/(\d{2})\//);
    const imgBucket = bucket ? `${bucket[1]}/${bucket[2]}` : null;
    if (imgBucket === dominantBucket && dominantCount >= 5) {
      // Keep images from dominant bucket (likely correct listing)
      imagesToKeep.push(img);
      continue;
    }
    
    // BE CONSERVATIVE: Only mark as duplicate if it's clearly from a different date bucket
    // AND we have a strong dominant bucket. Don't mark if we're not sure.
    if (imgBucket && dominantBucket && imgBucket !== dominantBucket && dominantCount >= 10) {
      // Clear contamination - from different month/year, not in canonical, and we have a strong dominant bucket
      imagesToRemove.push({ ...img, reason: 'different_date_bucket', batUrl });
    } else {
      // If we're not sure, keep it (better to show extra images than hide good ones)
      imagesToKeep.push(img);
    }
  }
  
  console.log(`   ✅ Images to keep: ${imagesToKeep.length}`);
  console.log(`   ❌ Images to remove: ${imagesToRemove.length}`);
  
  // Mark images as duplicates rather than deleting (safer, can review later)
  let removed = 0;
  for (const img of imagesToRemove) {
    // Don't mark primary images as duplicate (update primary first if needed)
    if (img.is_primary) {
      console.log(`   ⚠️  Skipping primary image removal: ${img.id}`);
      continue;
    }
    
    const { error: updateError } = await supabase
      .from('vehicle_images')
      .update({ 
        is_duplicate: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', img.id);
    
    if (updateError) {
      console.error(`   ❌ Failed to mark image ${img.id} as duplicate: ${updateError.message}`);
    } else {
      removed++;
    }
  }
  
  // If we removed the primary image, set a new one from the kept images
  const primaryRemoved = imagesToRemove.some(img => img.is_primary && !img.reason);
  if (primaryRemoved && imagesToKeep.length > 0) {
    const newPrimary = imagesToKeep[0];
    const { error: primaryError } = await supabase
      .from('vehicle_images')
      .update({ is_primary: true })
      .eq('id', newPrimary.id);
    
    if (primaryError) {
      console.error(`   ⚠️  Failed to set new primary: ${primaryError.message}`);
    } else {
      console.log(`   ✅ Set new primary image`);
    }
  }
  
  return { vehicleId, removed, kept: imagesToKeep.length, skipped: false };
}

async function main() {
  console.log('🧹 Cleaning up contaminated images from all BaT vehicles...\n');
  
  // Get all BaT vehicles
  const { data: vehicles, error: vehiclesError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, bat_auction_url, discovery_url, origin_metadata')
    .or('bat_auction_url.ilike.%bringatrailer.com%,discovery_url.ilike.%bringatrailer.com%')
    .order('created_at', { ascending: false });
  
  if (vehiclesError) {
    console.error('❌ Error fetching vehicles:', vehiclesError);
    process.exit(1);
  }
  
  console.log(`📦 Found ${vehicles?.length || 0} BaT vehicles to process\n`);
  
  const results = {
    total: vehicles?.length || 0,
    processed: 0,
    skipped: 0,
    totalRemoved: 0,
    errors: []
  };
  
  // Process each vehicle
  for (const vehicle of vehicles || []) {
    try {
      const result = await cleanupVehicleImages(vehicle);
      results.processed++;
      
      if (result.skipped) {
        results.skipped++;
      } else {
        results.totalRemoved += result.removed || 0;
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`   ❌ Error processing vehicle ${vehicle.id}:`, error);
      results.errors.push({ vehicleId: vehicle.id, error: error.message });
    }
  }
  
  console.log(`\n✅ Cleanup complete!`);
  console.log(`   Total vehicles: ${results.total}`);
  console.log(`   Processed: ${results.processed}`);
  console.log(`   Skipped: ${results.skipped}`);
  console.log(`   Total images marked as duplicate: ${results.totalRemoved}`);
  if (results.errors.length > 0) {
    console.log(`   Errors: ${results.errors.length}`);
    results.errors.forEach(e => console.log(`     - ${e.vehicleId}: ${e.error}`));
  }
}

main().catch(console.error);

