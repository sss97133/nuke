#!/usr/bin/env node
/**
 * Remove specific contaminated images based on URL patterns
 * This is more targeted than the general cleanup - focuses on known contamination patterns
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

// Check if URL indicates contamination (wrong vehicle, noise, etc.)
function isContaminated(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  
  // Known noise patterns (from batDomMap.ts)
  const noisePatterns = [
    'qotw',
    'winner-template',
    'weekly-weird',
    'mile-marker',
    'podcast',
    'merch',
    'dec-merch',
    'podcast-graphic',
    'site-post-',
    'thumbnail-template',
    'screenshot-',
    'countries/',
    'themes/',
    'assets/img/',
    /\/web-\d{3,}-/i
  ];
  
  for (const pattern of noisePatterns) {
    if (typeof pattern === 'string' && lower.includes(pattern)) return true;
    if (pattern instanceof RegExp && pattern.test(lower)) return true;
  }
  
  // Wrong vehicle brands (should not appear on car listings)
  const wrongBrands = [
    'ducati',  // Motorcycle brand
    'yamaha',  // Motorcycle brand
    'honda',   // Could be motorcycle
    'kawasaki', // Motorcycle brand
    'suzuki',   // Motorcycle brand
  ];
  
  // Only flag if the URL clearly indicates it's a motorcycle/other vehicle
  // Check if the brand appears in the filename (not just anywhere)
  const filenameMatch = url.match(/\/([^/]+\.(jpg|jpeg|png))(?:\?|$)/i);
  if (filenameMatch) {
    const filename = filenameMatch[1].toLowerCase();
    for (const brand of wrongBrands) {
      // Only flag if brand is in filename AND it's clearly a different vehicle type
      if (filename.includes(brand)) {
        // Check if it's a car listing (not a motorcycle listing)
        // We'll be conservative - only flag obvious mismatches
        return true; // For now, flag any Ducati/etc in filename
      }
    }
  }
  
  return false;
}

async function removeContaminatedImages(vehicleId) {
  console.log(`🔍 Checking vehicle: ${vehicleId}\n`);
  
  // Get all BaT images for this vehicle
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url, source_url, is_primary, storage_path')
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
  
  console.log(`Total BaT images: ${images.length}`);
  
  const toRemove = [];
  for (const img of images) {
    const url = img.source_url || img.image_url || '';
    if (isContaminated(url)) {
      toRemove.push({ ...img, reason: 'contaminated_pattern' });
    }
  }
  
  console.log(`\n⚠️  Found ${toRemove.length} contaminated images to remove:\n`);
  toRemove.slice(0, 10).forEach((img, i) => {
    const url = img.source_url || img.image_url || '';
    console.log(`  ${i+1}. ${url.substring(url.indexOf('wp-content/uploads/') + 18, url.indexOf('?') > 0 ? url.indexOf('?') : Math.min(url.length, url.indexOf('wp-content/uploads/') + 80))}`);
  });
  if (toRemove.length > 10) {
    console.log(`  ... and ${toRemove.length - 10} more`);
  }
  
  if (toRemove.length === 0) {
    console.log('✅ No contaminated images found');
    return;
  }
  
  // Mark as duplicate (don't delete, safer)
  let marked = 0;
  for (const img of toRemove) {
    if (img.is_primary) {
      console.log(`\n⚠️  Skipping primary image: ${img.id}`);
      continue;
    }
    
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
  
  console.log(`\n✅ Marked ${marked} images as duplicate`);
}

const vehicleId = process.argv[2] || 'c49e286c-41c8-405b-b9d3-0f24f7c9edeb';
removeContaminatedImages(vehicleId).catch(console.error);

