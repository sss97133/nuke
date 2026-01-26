#!/usr/bin/env node
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

const BATCH_SIZE = 20;

async function processBatch() {
  console.log('🎯 CONTEXTUAL IMAGE ANALYSIS - BATCH PROCESSOR\n');
  console.log('='.repeat(60));
  
  // Get images needing contextual analysis
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url, vehicle_id')
    .is('ai_scan_metadata->contextual_analysis', null)
    .limit(BATCH_SIZE);
  
  if (error) {
    console.error('Error fetching images:', error);
    return;
  }
  
  if (!images || images.length === 0) {
    console.log('✅ No images need contextual analysis!');
    return;
  }
  
  console.log(`Found ${images.length} images to analyze\n`);
  
  let processed = 0;
  let failed = 0;
  
  for (const img of images) {
    const num = processed + failed + 1;
    process.stdout.write(`[${num}/${images.length}] ${img.id.substring(0, 8)}... `);
    
    try {
      const { data, error: analyzeError } = await supabase.functions.invoke('analyze-image-contextual', {
        body: {
          image_url: img.image_url,
          vehicle_id: img.vehicle_id,
          image_id: img.id
        }
      });
      
      if (analyzeError) throw analyzeError;
      
      const angle = data?.insights?.angle || data?.angle || 'unknown';
      console.log(`✅ ${angle}`);
      processed++;
      
    } catch (err) {
      console.log(`❌ ${err.message}`);
      failed++;
    }
    
    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`✅ Processed: ${processed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('='.repeat(60));
}

processBatch();

