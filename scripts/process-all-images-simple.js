#!/usr/bin/env node

/**
 * SIMPLE BATCH PROCESSOR - No local API keys needed!
 * Uses production Supabase Edge Function which already has all keys
 */

import { createClient } from '@supabase/supabase-js';

// Load from environment
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const possiblePaths = [
  path.resolve(process.cwd(), 'nuke_frontend/.env.local'),
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env')
];

let envConfig = {};
for (const envPath of possiblePaths) {
  if (fs.existsSync(envPath)) {
    envConfig = dotenv.parse(fs.readFileSync(envPath));
    break;
  }
}

const SUPABASE_URL = envConfig.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = envConfig.SUPABASE_SERVICE_ROLE_KEY || envConfig.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BATCH_SIZE = 5;
const DELAY_MS = 2000;

let totalProcessed = 0;
let totalSuccess = 0;
let totalFailed = 0;
const startTime = Date.now();

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

async function getUnprocessedImages() {
  console.log('📊 Fetching unprocessed images...');
  
  const { data, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url, vehicle_id, ai_scan_metadata')
    .order('created_at', { ascending: false })
    .limit(3000);
  
  if (error) {
    console.error('❌ Error:', error);
    return [];
  }
  
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
      if (retryCount < 2) {
        await new Promise(r => setTimeout(r, 1000 * (retryCount + 1)));
        return await processImage(image, retryCount + 1);
      }
      return { success: false, imageId: image.id, error: error.message };
    }
    
    return {
      success: true,
      imageId: image.id,
      tags: data?.tags?.length || 0
    };
  } catch (e) {
    if (retryCount < 2) {
      await new Promise(r => setTimeout(r, 1000 * (retryCount + 1)));
      return await processImage(image, retryCount + 1);
    }
    return { success: false, imageId: image.id, error: e.message };
  }
}

async function processBatch(images, batchNum, totalBatches) {
  console.log(`\n📦 Batch ${batchNum}/${totalBatches} (${images.length} images)`);
  console.log('─'.repeat(80));
  
  const results = await Promise.all(
    images.map(async (img) => {
      const result = await processImage(img);
      const shortId = result.imageId.substring(0, 8);
      
      if (result.success) {
        console.log(`   ✓ ${shortId}... (${result.tags} tags)`);
      } else {
        console.log(`   ✗ ${shortId}... ${result.error}`);
      }
      
      return result;
    })
  );
  
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  
  totalProcessed += images.length;
  totalSuccess += successCount;
  totalFailed += failCount;
  
  const elapsed = Date.now() - startTime;
  const rate = (totalProcessed / (elapsed / 1000)).toFixed(2);
  const remaining = (totalBatches - batchNum) * BATCH_SIZE;
  const eta = remaining > 0 ? formatDuration((remaining / totalProcessed) * elapsed) : '0s';
  
  console.log('─'.repeat(80));
  console.log(`   Success: ${successCount} | Failed: ${failCount}`);
  console.log(`   Overall: ${totalSuccess}/${totalProcessed} | Rate: ${rate} img/s | ETA: ${eta}`);
  
  return { successCount, failCount };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                  BATCH IMAGE PROCESSOR (SIMPLE)                            ║');
  console.log('║                                                                            ║');
  console.log('║  Uses production Edge Function (already has all API keys)                 ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log(`\nConfiguration:`);
  console.log(`   Batch size: ${BATCH_SIZE} concurrent`);
  console.log(`   Delay: ${DELAY_MS}ms between batches`);
  console.log(`   Retries: 2 per image\n`);
  
  const images = await getUnprocessedImages();
  
  if (images.length === 0) {
    console.log('\n✅ No unprocessed images!\n');
    return;
  }
  
  console.log(`\n📸 Processing ${images.length} images...\n`);
  
  const batches = [];
  for (let i = 0; i < images.length; i += BATCH_SIZE) {
    batches.push(images.slice(i, i + BATCH_SIZE));
  }
  
  for (let i = 0; i < batches.length; i++) {
    await processBatch(batches[i], i + 1, batches.length);
    
    if (i < batches.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }
  
  const duration = formatDuration(Date.now() - startTime);
  const successRate = ((totalSuccess / totalProcessed) * 100).toFixed(1);
  
  console.log('\n' + '═'.repeat(80));
  console.log('📊 COMPLETE');
  console.log('═'.repeat(80));
  console.log(`Total: ${totalProcessed} | Success: ${totalSuccess} | Failed: ${totalFailed}`);
  console.log(`Success Rate: ${successRate}% | Duration: ${duration}`);
  console.log('═'.repeat(80) + '\n');
}

main().catch(err => {
  console.error('❌ Fatal:', err);
  process.exit(1);
});

