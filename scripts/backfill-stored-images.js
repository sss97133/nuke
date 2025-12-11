#!/usr/bin/env node

/**
 * Backfill Stored Images
 * 
 * Processes image URLs stored in origin_metadata and uploads them to vehicle_images table
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load env
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '..', '.env.local');

try {
  const envFile = readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  });
} catch (error) {
  // .env.local not found
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function backfillImages(vehicle) {
  const imageUrls = vehicle.origin_metadata?.image_urls;
  
  if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
    return { uploaded: 0, skipped: 0 };
  }

  // Filter out junk images (icons, logos, thumbnails)
  const validImages = imageUrls.filter(url => {
    if (!url || typeof url !== 'string') return false;
    const lower = url.toLowerCase();
    return !lower.includes('icon') && 
           !lower.includes('logo') && 
           !lower.includes('svg') &&
           !lower.includes('opt-out') &&
           !lower.includes('social-') &&
           !lower.includes('countries/') &&
           !lower.includes('listings/') &&
           !lower.includes('partial-load') &&
           !lower.includes('resize=235') && // Small thumbnails
           !lower.includes('resize=470') && // Medium thumbnails
           (lower.includes('.jpg') || lower.includes('.jpeg') || lower.includes('.png') || lower.includes('wp-content/uploads'));
  });

  if (validImages.length === 0) {
    console.log(`  ⚠️  No valid images after filtering`);
    return { uploaded: 0, skipped: imageUrls.length };
  }

  // Limit to first 20 images to avoid overwhelming
  const imagesToUpload = validImages.slice(0, 20);

  console.log(`  📸 Found ${validImages.length} valid images (uploading ${imagesToUpload.length})`);

  try {
    const { data: backfillResult, error: backfillError } = await supabase.functions.invoke('backfill-images', {
      body: {
        vehicle_id: vehicle.id,
        image_urls: imagesToUpload,
        source: 'stored_metadata_backfill',
        run_analysis: false
      }
    });

    if (backfillError) {
      console.log(`  ❌ Backfill failed: ${backfillError.message}`);
      return { uploaded: 0, skipped: imagesToUpload.length, error: backfillError.message };
    }

    const uploaded = backfillResult?.uploaded || 0;
    console.log(`  ✅ Uploaded ${uploaded} images`);
    return { uploaded, skipped: imagesToUpload.length - uploaded };
  } catch (err) {
    console.log(`  ❌ Error: ${err.message}`);
    return { uploaded: 0, skipped: imagesToUpload.length, error: err.message };
  }
}

async function main() {
  const batchSize = parseInt(process.argv[2]) || 50;

  console.log('🚀 Backfilling Stored Images\n');

  // Get pending vehicles with stored image URLs but no actual images
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select(`
      id,
      year,
      make,
      model,
      origin_metadata
    `)
    .eq('status', 'pending')
    .is('is_public', false)
    .not('origin_metadata->image_urls', 'is', null)
    .limit(batchSize);

  if (error) {
    console.error('❌ Failed to fetch vehicles:', error.message);
    process.exit(1);
  }

  if (!vehicles || vehicles.length === 0) {
    console.log('✅ No vehicles with stored image URLs to process');
    return;
  }

  // Filter to only those without actual images
  const vehiclesNeedingImages = [];
  for (const vehicle of vehicles) {
    const { count } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', vehicle.id);
    
    if (count === 0) {
      vehiclesNeedingImages.push(vehicle);
    }
  }

  if (vehiclesNeedingImages.length === 0) {
    console.log('✅ All vehicles already have images');
    return;
  }

  console.log(`📋 Processing ${vehiclesNeedingImages.length} vehicles...\n`);

  const results = {
    processed: 0,
    uploaded: 0,
    skipped: 0,
    failed: 0
  };

  for (const vehicle of vehiclesNeedingImages) {
    console.log(`\n🔍 ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
    const result = await backfillImages(vehicle);
    results.processed++;
    results.uploaded += result.uploaded || 0;
    results.skipped += result.skipped || 0;
    if (result.error) results.failed++;

    // Small delay
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`\n✅ Complete!`);
  console.log(`   Processed: ${results.processed}`);
  console.log(`   Uploaded: ${results.uploaded} images`);
  console.log(`   Skipped: ${results.skipped} images`);
  console.log(`   Failed: ${results.failed}`);
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

