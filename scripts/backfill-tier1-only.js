#!/usr/bin/env node

/**
 * BACKFILL WITH TIER1 - Uses working tier1 function
 * 
 * analyze-image has database bugs
 * analyze-image-tier1 works perfectly
 * 
 * Let's just use what works!
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
const envConfig = dotenv.parse(fs.readFileSync(envPath));

const SUPABASE_URL = envConfig.SUPABASE_URL || envConfig.VITE_SUPABASE_URL;
const SUPABASE_KEY = envConfig.SUPABASE_SERVICE_ROLE_KEY || envConfig.SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BATCH_SIZE = 10;
const DELAY_MS = 500;

let stats = {
  total: 0,
  processed: 0,
  succeeded: 0,
  failed: 0,
  startTime: Date.now()
};

async function analyzeWithTier1(image) {
  try {
    const { data, error } = await supabase.functions.invoke('analyze-image-tier1', {
      body: {
        image_url: image.image_url,
        vehicle_id: image.vehicle_id,
        image_id: image.id
      }
    });

    if (error) throw new Error(error.message);

    // Update timestamp
    await supabase
      .from('vehicle_images')
      .update({ 
        ai_last_scanned: new Date().toISOString(),
        ai_scan_metadata: {
          tier_1_analysis: data,
          scanned_at: new Date().toISOString()
        }
      })
      .eq('id', image.id);

    console.log(`   ✅ ${image.id.slice(0,8)}`);
    stats.succeeded++;
    return true;

  } catch (error) {
    console.log(`   ❌ ${image.id.slice(0,8)}: ${error.message}`);
    stats.failed++;
    return false;
  }
}

async function main() {
  console.log('🚀 BACKFILL WITH TIER1 (Working Function)');
  console.log('==========================================\n');

  // Get all unanalyzed images with pagination
  let images = [];
  let page = 0;
  const pageSize = 1000;
  
  console.log('Loading unanalyzed images...');
  while (true) {
    const { data, error } = await supabase
      .from('vehicle_images')
      .select('id, image_url, vehicle_id')
      .is('ai_last_scanned', null)
      .not('vehicle_id', 'is', null)
      .order('created_at', { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error || !data || data.length === 0) break;
    
    images = images.concat(data);
    console.log(`  Loaded ${images.length}...`);
    
    if (data.length < pageSize) break;
    page++;
  }

  stats.total = images.length;
  console.log(`\n📸 Found ${stats.total} unanalyzed images\n`);

  // Process in batches
  const totalBatches = Math.ceil(images.length / BATCH_SIZE);

  for (let i = 0; i < images.length; i += BATCH_SIZE) {
    const batch = images.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    
    console.log(`\n[Batch ${batchNum}/${totalBatches}]`);
    
    await Promise.all(batch.map(img => analyzeWithTier1(img)));
    
    stats.processed += batch.length;
    
    const percent = (stats.processed / stats.total * 100).toFixed(1);
    const elapsed = Date.now() - stats.startTime;
    const rate = stats.processed / (elapsed / 1000 / 60);
    const eta = (stats.total - stats.processed) / rate;
    
    console.log(`Progress: ${stats.processed}/${stats.total} (${percent}%) | Rate: ${rate.toFixed(1)}/min | ETA: ${eta.toFixed(0)}min`);

    if (i + BATCH_SIZE < images.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }

  console.log('\n\n🏁 COMPLETE');
  console.log('==========================================');
  console.log(`Total: ${stats.total}`);
  console.log(`✅ Succeeded: ${stats.succeeded}`);
  console.log(`❌ Failed: ${stats.failed}`);
  console.log(`Success Rate: ${(stats.succeeded / stats.total * 100).toFixed(1)}%`);
  console.log(`Duration: ${((Date.now() - stats.startTime) / 1000 / 60).toFixed(1)} minutes\n`);
}

main().catch(console.error);

