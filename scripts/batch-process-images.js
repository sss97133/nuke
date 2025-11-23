#!/usr/bin/env node

/**
 * BATCH IMAGE PROCESSOR
 * 
 * Processes all unprocessed images through the analyze-image pipeline
 * Features:
 * - Concurrent processing with configurable batch size
 * - Progress tracking
 * - Error handling and retry logic
 * - Resume capability
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load environment variables
const possiblePaths = [
  path.resolve(process.cwd(), 'nuke_frontend/.env.local'),
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env')
];

let envConfig = {};
for (const envPath of possiblePaths) {
  if (fs.existsSync(envPath)) {
    envConfig = dotenv.parse(fs.readFileSync(envPath));
    console.log(`✓ Loaded env from: ${envPath}`);
    break;
  }
}

const supabaseUrl = envConfig.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = envConfig.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Configuration
const BATCH_SIZE = parseInt(process.argv[2]) || 5; // Concurrent requests
const DELAY_MS = parseInt(process.argv[3]) || 2000; // Delay between batches
const VEHICLE_ID_FILTER = process.argv[4]; // Optional vehicle filter
const MAX_RETRIES = 3;

let totalProcessed = 0;
let totalSuccess = 0;
let totalFailed = 0;
let startTime = Date.now();

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

async function getUnprocessedImages() {
  console.log('\n📊 Fetching unprocessed images...');
  
  let query = supabase
    .from('vehicle_images')
    .select('id, image_url, vehicle_id, ai_scan_metadata')
    .order('created_at', { ascending: false });
  
  if (VEHICLE_ID_FILTER) {
    query = query.eq('vehicle_id', VEHICLE_ID_FILTER);
    console.log(`   Filtering by vehicle: ${VEHICLE_ID_FILTER}`);
  }
  
  const { data, error } = await query;
  
  if (error) {
    console.error('❌ Error fetching images:', error);
    return [];
  }
  
  // Filter for truly unprocessed (no scanned_at timestamp)
  const unprocessed = (data || []).filter(img => {
    const metadata = img.ai_scan_metadata;
    if (!metadata || typeof metadata !== 'object') return true;
    return !metadata.scanned_at;
  });
  
  console.log(`   Found ${unprocessed.length} unprocessed out of ${data?.length || 0} total`);
  return unprocessed;
}

async function processImage(image, retryCount = 0) {
  try {
    const { data, error } = await supabase.functions.invoke('analyze-image', {
      body: {
        image_url: image.image_url,
        vehicle_id: image.vehicle_id
      }
    });
    
    if (error) {
      // Retry on failure
      if (retryCount < MAX_RETRIES) {
        console.log(`   ⟳ Retrying ${image.id} (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, 1000 * (retryCount + 1))); // Exponential backoff
        return await processImage(image, retryCount + 1);
      }
      
      return {
        success: false,
        imageId: image.id,
        error: error.message
      };
    }
    
    return {
      success: data.success || true,
      imageId: image.id,
      tags: data.tags?.length || 0
    };
  } catch (e) {
    if (retryCount < MAX_RETRIES) {
      console.log(`   ⟳ Retrying ${image.id} (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      await new Promise(r => setTimeout(r, 1000 * (retryCount + 1)));
      return await processImage(image, retryCount + 1);
    }
    
    return {
      success: false,
      imageId: image.id,
      error: e.message
    };
  }
}

async function processBatch(images, batchNum, totalBatches) {
  const startTime = Date.now();
  
  console.log(`\n📦 Batch ${batchNum}/${totalBatches} (${images.length} images)`);
  console.log('─'.repeat(80));
  
  // Process concurrently
  const results = await Promise.all(
    images.map(async (img) => {
      const result = await processImage(img);
      
      if (result.success) {
        console.log(`   ✓ ${result.imageId.substring(0, 8)}... (${result.tags} tags)`);
      } else {
        console.log(`   ✗ ${result.imageId.substring(0, 8)}... Error: ${result.error}`);
      }
      
      return result;
    })
  );
  
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  const duration = Date.now() - startTime;
  
  totalProcessed += images.length;
  totalSuccess += successCount;
  totalFailed += failCount;
  
  // Calculate stats
  const elapsed = Date.now() - startTime;
  const imagesPerSecond = (totalProcessed / (elapsed / 1000)).toFixed(2);
  const remaining = (totalBatches - batchNum) * images.length;
  const eta = remaining > 0 ? formatDuration((remaining / totalProcessed) * elapsed) : '0s';
  
  console.log('─'.repeat(80));
  console.log(`   ✓ Success: ${successCount} | ✗ Failed: ${failCount} | ⏱ ${duration}ms`);
  console.log(`   Overall: ${totalSuccess}/${totalProcessed} | Rate: ${imagesPerSecond} img/s | ETA: ${eta}`);
  
  return { successCount, failCount };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                     BATCH IMAGE PROCESSOR                                  ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log(`\nConfiguration:`);
  console.log(`   Batch size: ${BATCH_SIZE} concurrent requests`);
  console.log(`   Delay between batches: ${DELAY_MS}ms`);
  console.log(`   Max retries: ${MAX_RETRIES}`);
  if (VEHICLE_ID_FILTER) {
    console.log(`   Vehicle filter: ${VEHICLE_ID_FILTER}`);
  }
  
  const images = await getUnprocessedImages();
  
  if (images.length === 0) {
    console.log('\n✅ No unprocessed images found!');
    return;
  }
  
  console.log(`\n📸 Processing ${images.length} images...`);
  
  // Split into batches
  const batches = [];
  for (let i = 0; i < images.length; i += BATCH_SIZE) {
    batches.push(images.slice(i, i + BATCH_SIZE));
  }
  
  const totalBatches = batches.length;
  
  // Process batches
  for (let i = 0; i < batches.length; i++) {
    await processBatch(batches[i], i + 1, totalBatches);
    
    // Delay between batches (except last one)
    if (i < batches.length - 1) {
      console.log(`   ⏳ Waiting ${DELAY_MS}ms before next batch...`);
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }
  
  // Final summary
  const totalDuration = Date.now() - startTime;
  const successRate = ((totalSuccess / totalProcessed) * 100).toFixed(1);
  const avgTime = (totalDuration / totalProcessed).toFixed(0);
  
  console.log('\n' + '═'.repeat(80));
  console.log('📊 FINAL RESULTS');
  console.log('═'.repeat(80));
  console.log(`Total processed:     ${totalProcessed}`);
  console.log(`Successful:          ${totalSuccess} ✓`);
  console.log(`Failed:              ${totalFailed} ✗`);
  console.log(`Success rate:        ${successRate}%`);
  console.log(`Total duration:      ${formatDuration(totalDuration)}`);
  console.log(`Average per image:   ${avgTime}ms`);
  console.log('═'.repeat(80) + '\n');
  
  if (totalFailed > 0) {
    console.log('⚠️  Some images failed to process. You can:');
    console.log('   1. Run this script again to retry failed images');
    console.log('   2. Check Edge Function logs for errors');
    console.log('   3. Verify API keys are still valid\n');
  } else {
    console.log('✅ All images processed successfully!\n');
  }
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});

