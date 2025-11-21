#!/usr/bin/env node

/**
 * Batch Process All Images
 * 
 * Processes all unprocessed images through the analyze-image function
 * which includes: Rekognition, Appraiser Brain, and SPID extraction
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load env vars - try multiple locations
let envConfig = {};
const possiblePaths = [
  path.resolve(process.cwd(), 'nuke_frontend/.env.local'),
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env')
];

for (const envPath of possiblePaths) {
  try {
    if (fs.existsSync(envPath)) {
      envConfig = dotenv.parse(fs.readFileSync(envPath));
      console.log(`✓ Loaded env from: ${envPath}`);
      break;
    }
  } catch (e) {
    // Try next path
  }
}

// Also check process.env directly (for CI/CD)
const supabaseUrl = envConfig.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
// Use service role key for batch processing (has full permissions)
const supabaseKey = envConfig.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || envConfig.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase env vars. Tried:', possiblePaths);
  console.error('   Need: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_ANON_KEY)');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Configuration
const BATCH_SIZE = 10; // Process 10 images at a time
const DELAY_MS = 1000; // 1 second delay between batches
const VEHICLE_ID_FILTER = process.argv[2]; // Optional: filter by vehicle ID

async function getUnprocessedImages() {
  console.log('📊 Fetching unprocessed images...');
  
  // Fetch all images (we'll filter unprocessed in code)
  let query = supabase
    .from('vehicle_images')
    .select('id, image_url, vehicle_id, ai_scan_metadata')
    .order('created_at', { ascending: false })
    .limit(1000); // Process in chunks
  
  if (VEHICLE_ID_FILTER) {
    query = query.eq('vehicle_id', VEHICLE_ID_FILTER);
    console.log(`   Filtering by vehicle: ${VEHICLE_ID_FILTER}`);
  }
  
  const { data, error } = await query;
  
  if (error) {
    console.error('❌ Error fetching images:', error);
    return [];
  }
  
  // Filter for unprocessed: no scanned_at timestamp
  const unprocessed = (data || []).filter(img => {
    const metadata = img.ai_scan_metadata;
    if (!metadata || typeof metadata !== 'object') return true;
    return !metadata.scanned_at;
  });
  
  console.log(`   Found ${unprocessed.length} unprocessed out of ${data?.length || 0} total`);
  return unprocessed;
}

async function processImage(image) {
  try {
    console.log(`   Processing ${image.id}...`);
    
    const { data, error } = await supabase.functions.invoke('analyze-image', {
      body: {
        image_url: image.image_url,
        vehicle_id: image.vehicle_id,
        timeline_event_id: null
      }
    });
    
    if (error) {
      console.error(`   ❌ Failed ${image.id}:`, error.message);
      return { success: false, error: error.message };
    }
    
    console.log(`   ✓ Success ${image.id}`);
    return { success: true, data };
    
  } catch (e) {
    console.error(`   ❌ Exception ${image.id}:`, e.message);
    return { success: false, error: e.message };
  }
}

async function processBatch(images, batchNum, totalBatches) {
  console.log(`\n📦 Batch ${batchNum}/${totalBatches} (${images.length} images)`);
  
  const results = await Promise.all(
    images.map(img => processImage(img))
  );
  
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  
  console.log(`   Results: ${successCount} ✓, ${failCount} ❌`);
  
  return { successCount, failCount };
}

async function main() {
  console.log('🚀 Starting batch image processing...\n');
  
  const images = await getUnprocessedImages();
  
  if (images.length === 0) {
    console.log('✅ No unprocessed images found!');
    return;
  }
  
  console.log(`📸 Found ${images.length} unprocessed images\n`);
  
  // Process in batches
  const batches = [];
  for (let i = 0; i < images.length; i += BATCH_SIZE) {
    batches.push(images.slice(i, i + BATCH_SIZE));
  }
  
  const totalBatches = batches.length;
  let totalSuccess = 0;
  let totalFailed = 0;
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const result = await processBatch(batch, i + 1, totalBatches);
    totalSuccess += result.successCount;
    totalFailed += result.failCount;
    
    // Delay between batches (except last one)
    if (i < batches.length - 1) {
      console.log(`   ⏳ Waiting ${DELAY_MS}ms before next batch...`);
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('📊 FINAL RESULTS');
  console.log('='.repeat(50));
  console.log(`Total processed: ${images.length}`);
  console.log(`Successful: ${totalSuccess} ✓`);
  console.log(`Failed: ${totalFailed} ❌`);
  console.log(`Success rate: ${((totalSuccess / images.length) * 100).toFixed(1)}%`);
  console.log('='.repeat(50));
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
