#!/usr/bin/env node

/**
 * BACKFILL ALL IMAGES - Simple and Reliable
 * 
 * Finds all vehicle images without ai_last_scanned timestamp
 * and processes them through the analyze-image edge function.
 * 
 * Usage:
 *   node scripts/backfill-all-images.js [batch_size] [delay_ms]
 * 
 * Examples:
 *   node scripts/backfill-all-images.js              # Defaults: 10 images, 1000ms delay
 *   node scripts/backfill-all-images.js 20 500       # 20 images per batch, 500ms delay
 *   node scripts/backfill-all-images.js --dry-run    # Test mode (no actual processing)
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load environment
const possiblePaths = [
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), 'nuke_frontend/.env.local'),
];

let envConfig = {};
for (const envPath of possiblePaths) {
  if (fs.existsSync(envPath)) {
    envConfig = dotenv.parse(fs.readFileSync(envPath));
    console.log(`✓ Loaded env from: ${envPath}`);
    break;
  }
}

const SUPABASE_URL = envConfig.SUPABASE_URL || envConfig.VITE_SUPABASE_URL || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = envConfig.SUPABASE_SERVICE_ROLE_KEY || envConfig.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Configuration
const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = parseInt(process.argv[2]) || 10;
const DELAY_MS = parseInt(process.argv[3]) || 1000;
const MAX_RETRIES = 3;

let stats = {
  total: 0,
  processed: 0,
  succeeded: 0,
  failed: 0,
  skipped: 0,
  errors: [],
  startTime: Date.now()
};

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

async function analyzeImage(image, retryCount = 0) {
  try {
    console.log(`   Analyzing: ${image.id.slice(0, 8)}... (${image.file_name || 'unnamed'})`);
    
    if (DRY_RUN) {
      console.log(`   [DRY RUN] Would analyze: ${image.image_url}`);
      return { success: true, dryRun: true };
    }

    const { data, error } = await supabase.functions.invoke('analyze-image', {
      body: {
        image_url: image.image_url,
        vehicle_id: image.vehicle_id,
        image_id: image.id
      }
    });

    if (error) {
      throw new Error(error.message || JSON.stringify(error));
    }

    // Update timestamp
    await supabase
      .from('vehicle_images')
      .update({ ai_last_scanned: new Date().toISOString() })
      .eq('id', image.id);

    console.log(`   ✅ Success`);
    return { success: true, data };

  } catch (error) {
    const errorMsg = error.message || 'Unknown error';
    
    // Retry logic
    if (retryCount < MAX_RETRIES) {
      const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
      console.log(`   ⚠️  Error: ${errorMsg}`);
      console.log(`   🔄 Retry ${retryCount + 1}/${MAX_RETRIES} in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return analyzeImage(image, retryCount + 1);
    }
    
    console.log(`   ❌ Failed after ${MAX_RETRIES} retries: ${errorMsg}`);
    stats.errors.push({ image_id: image.id, error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

async function processBatch(images, batchNum, totalBatches) {
  console.log(`\n[Batch ${batchNum}/${totalBatches}] Processing ${images.length} images...`);
  
  const results = await Promise.all(
    images.map(image => analyzeImage(image))
  );

  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  stats.processed += images.length;
  stats.succeeded += succeeded;
  stats.failed += failed;

  console.log(`[Batch ${batchNum}/${totalBatches}] Complete: ${succeeded} succeeded, ${failed} failed`);
  
  // Progress update
  const elapsed = Date.now() - stats.startTime;
  const rate = stats.processed / (elapsed / 1000 / 60); // images per minute
  const remaining = stats.total - stats.processed;
  const estimatedTime = remaining / rate; // minutes
  
  console.log(`📊 Progress: ${stats.processed}/${stats.total} (${Math.round(stats.processed / stats.total * 100)}%) - ${rate.toFixed(1)}/min - ETA: ${estimatedTime.toFixed(0)}min`);
}

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('🚀 BACKFILL ALL IMAGES - AI ANALYSIS');
  console.log('='.repeat(80));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}`);
  console.log(`Batch Size: ${BATCH_SIZE} images`);
  console.log(`Delay: ${DELAY_MS}ms between batches`);
  console.log(`Started: ${new Date().toLocaleString()}`);
  console.log('='.repeat(80) + '\n');

  // Step 1: Get all unprocessed images (paginated to handle >1000 rows)
  console.log('Step 1: Finding unprocessed images...');
  
  let images = [];
  let page = 0;
  const pageSize = 1000;
  
  while (true) {
    const { data, error } = await supabase
      .from('vehicle_images')
      .select('id, image_url, vehicle_id, file_name, created_at')
      .is('ai_last_scanned', null)
      .not('vehicle_id', 'is', null) // Only images with vehicles
      .order('created_at', { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      console.error('❌ Failed to fetch images:', error);
      process.exit(1);
    }

    if (!data || data.length === 0) break;
    
    images = images.concat(data);
    console.log(`   Loaded ${images.length} images...`);
    
    if (data.length < pageSize) break; // Last page
    page++;
  }

  if (images.length === 0) {
    console.log('✅ No unprocessed images found! All images have been analyzed.');
    return;
  }

  stats.total = images.length;
  console.log(`\n📸 Found ${stats.total} unprocessed images total`);
  
  if (DRY_RUN) {
    console.log('\n🔍 DRY RUN MODE - Showing first 10 images that would be processed:');
    images.slice(0, 10).forEach((img, i) => {
      console.log(`   ${i + 1}. ${img.id.slice(0, 8)} - ${img.file_name || 'unnamed'} (${img.created_at})`);
    });
    console.log(`\n... and ${images.length - 10} more`);
    console.log('\n✅ Dry run complete. Run without --dry-run to process.\n');
    return;
  }

  // Step 2: Process in batches
  console.log(`\nStep 2: Processing ${stats.total} images in batches of ${BATCH_SIZE}...\n`);

  const totalBatches = Math.ceil(images.length / BATCH_SIZE);

  for (let i = 0; i < images.length; i += BATCH_SIZE) {
    const batch = images.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    
    await processBatch(batch, batchNum, totalBatches);

    // Delay between batches (except for last batch)
    if (i + BATCH_SIZE < images.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }

  // Final summary
  const elapsed = Date.now() - stats.startTime;
  
  console.log('\n\n' + '='.repeat(80));
  console.log('🏁 BACKFILL COMPLETE');
  console.log('='.repeat(80));
  console.log(`⏱️  Total time: ${formatDuration(elapsed)}`);
  console.log(`\n📸 Images:`);
  console.log(`   Total found: ${stats.total}`);
  console.log(`   Processed: ${stats.processed}`);
  console.log(`   ✅ Succeeded: ${stats.succeeded}`);
  console.log(`   ❌ Failed: ${stats.failed}`);
  console.log(`   ⏭️  Skipped: ${stats.skipped}`);
  
  if (stats.errors.length > 0) {
    console.log(`\n❌ Errors (${stats.errors.length}):`);
    stats.errors.slice(0, 10).forEach(err => {
      console.log(`   - ${err.image_id}: ${err.error}`);
    });
    if (stats.errors.length > 10) {
      console.log(`   ... and ${stats.errors.length - 10} more`);
    }
  }

  console.log(`\n📈 Performance:`);
  console.log(`   Rate: ${(stats.processed / (elapsed / 1000 / 60)).toFixed(1)} images/min`);
  console.log(`   Average: ${(elapsed / stats.processed).toFixed(0)}ms per image`);
  
  console.log('='.repeat(80) + '\n');
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});

