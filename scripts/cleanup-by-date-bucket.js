#!/usr/bin/env node
/**
 * Remove images from date buckets that don't match the dominant bucket
 * This targets images from other auctions/listing periods
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

function extractDateBucket(url) {
  const match = url.match(/wp-content\/uploads\/(\d{4})\/(\d{2})\//);
  return match ? match[0] : null;
}

async function cleanupByDateBucket(vehicleId) {
  console.log(`🔍 Cleaning up images by date bucket for: ${vehicleId}\n`);
  
  // Get all BaT images
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url, source_url, is_primary, is_duplicate')
    .eq('vehicle_id', vehicleId)
    .or('image_url.ilike.%bringatrailer.com%,source_url.ilike.%bringatrailer.com%');
  
  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }
  
  if (!images || images.length === 0) {
    console.log('No BaT images found');
    return;
  }
  
  // Group by date bucket
  const buckets = {};
  for (const img of images) {
    const url = img.source_url || img.image_url || '';
    const bucket = extractDateBucket(url);
    if (bucket) {
      if (!buckets[bucket]) buckets[bucket] = [];
      buckets[bucket].push(img);
    }
  }
  
  console.log('Date buckets:');
  Object.entries(buckets).sort().forEach(([bucket, imgs]) => {
    console.log(`  ${bucket}: ${imgs.length} images`);
  });
  
  // Find dominant bucket (largest count)
  const dominantBucket = Object.entries(buckets).reduce((max, [bucket, imgs]) => {
    return imgs.length > (max[1]?.length || 0) ? [bucket, imgs] : max;
  }, [null, []]);
  
  console.log(`\n✅ Dominant bucket: ${dominantBucket[0]} (${dominantBucket[1]?.length} images)`);
  
  if (!dominantBucket[0] || dominantBucket[1].length < 5) {
    console.log('⚠️  Dominant bucket too small, skipping cleanup');
    return;
  }
  
  // Parse dominant bucket date
  const dominantMatch = dominantBucket[0].match(/(\d{4})\/(\d{2})/);
  if (!dominantMatch) {
    console.log('⚠️  Could not parse dominant bucket date');
    return;
  }
  const dominantYear = parseInt(dominantMatch[1]);
  const dominantMonth = parseInt(dominantMatch[2]);
  
  // Allow images from adjacent months (listing can span months)
  // Also allow second-largest bucket if it's close in size (within 50%)
  const sortedBuckets = Object.entries(buckets)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 2); // Top 2 buckets
  
  const validBuckets = new Set([dominantBucket[0]]);
  
  // If second bucket is within 50% size and adjacent month, include it
  if (sortedBuckets.length > 1) {
    const secondBucket = sortedBuckets[1];
    const secondMatch = secondBucket[0].match(/(\d{4})\/(\d{2})/);
    if (secondMatch && secondBucket[1].length >= dominantBucket[1].length * 0.5) {
      const secondYear = parseInt(secondMatch[1]);
      const secondMonth = parseInt(secondMatch[2]);
      // Check if adjacent month (same year, month diff of 1, or different year but Dec->Jan)
      const yearDiff = secondYear - dominantYear;
      const monthDiff = secondMonth - dominantMonth;
      if ((yearDiff === 0 && Math.abs(monthDiff) === 1) || (yearDiff === 1 && dominantMonth === 12 && secondMonth === 1) || (yearDiff === -1 && dominantMonth === 1 && secondMonth === 12)) {
        validBuckets.add(secondBucket[0]);
        console.log(`✅ Including adjacent bucket: ${secondBucket[0]} (${secondBucket[1].length} images)`);
      }
    }
  }
  
  // Mark images from other buckets as duplicate
  const toRemove = [];
  for (const [bucket, imgs] of Object.entries(buckets)) {
    if (!validBuckets.has(bucket)) {
      toRemove.push(...imgs);
    }
  }
  
  console.log(`\n⚠️  Found ${toRemove.length} images from other date buckets to remove\n`);
  
  let marked = 0;
  for (const img of toRemove) {
    if (img.is_primary) {
      console.log(`⚠️  Skipping primary image: ${img.id}`);
      continue;
    }
    
    if (img.is_duplicate) {
      continue; // Already marked
    }
    
    const bucket = extractDateBucket(img.source_url || img.image_url || '');
    const { error: updateError } = await supabase
      .from('vehicle_images')
      .update({ is_duplicate: true })
      .eq('id', img.id);
    
    if (updateError) {
      console.error(`  ❌ Failed to mark ${img.id}: ${updateError.message}`);
    } else {
      marked++;
    }
  }
  
  console.log(`✅ Marked ${marked} images as duplicate (from non-dominant date buckets)`);
}

const vehicleId = process.argv[2] || 'c49e286c-41c8-405b-b9d3-0f24f7c9edeb';
cleanupByDateBucket(vehicleId).catch(console.error);

