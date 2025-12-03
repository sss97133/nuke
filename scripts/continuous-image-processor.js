#!/usr/bin/env node
/**
 * CONTINUOUS IMAGE PROCESSOR
 * Runs in loop until all images are analyzed
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '../nuke_frontend/.env.local') });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

const BATCH_SIZE = 25;
const DELAY_BETWEEN_BATCHES = 2000; // 2 seconds

let totalProcessed = 0;
let totalFailed = 0;

async function processBatch() {
  // Get images needing analysis
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url, vehicle_id')
    .is('ai_scan_metadata->contextual_analysis', null)
    .limit(BATCH_SIZE);
  
  if (error || !images || images.length === 0) {
    return 0;
  }
  
  let processed = 0;
  
  for (const img of images) {
    try {
      const { data, error: analyzeError } = await supabase.functions.invoke('analyze-image-contextual', {
        body: {
          image_url: img.image_url,
          vehicle_id: img.vehicle_id,
          image_id: img.id
        }
      });
      
      if (analyzeError) throw analyzeError;
      processed++;
      totalProcessed++;
      
    } catch (err) {
      totalFailed++;
    }
  }
  
  return processed;
}

async function main() {
  console.log('🚀 CONTINUOUS IMAGE PROCESSOR');
  console.log('='.repeat(60));
  console.log('Press Ctrl+C to stop\n');
  
  let batchNum = 0;
  
  while (true) {
    batchNum++;
    
    const startTime = Date.now();
    const processed = await processBatch();
    const duration = Date.now() - startTime;
    
    if (processed === 0) {
      console.log('\n✅ ALL IMAGES ANALYZED!');
      break;
    }
    
    // Get remaining count
    const { count } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .is('ai_scan_metadata->contextual_analysis', null);
    
    const percent = ((totalProcessed / (totalProcessed + count)) * 100).toFixed(1);
    
    console.log(`Batch ${batchNum}: ✅ ${processed} | Total: ${totalProcessed} | Remaining: ${count} (${percent}%) | ${(duration/1000).toFixed(1)}s`);
    
    if (count === 0) {
      console.log('\n🎉 COMPLETE! All images analyzed.');
      break;
    }
    
    await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`📊 FINAL: ${totalProcessed} analyzed, ${totalFailed} failed`);
}

main().catch(console.error);

