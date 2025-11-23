#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const env = dotenv.parse(fs.readFileSync('nuke_frontend/.env.local'));
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

console.log('🧪 Testing with 3 images...\n');

const { data: images } = await supabase
  .from('vehicle_images')
  .select('id, image_url, vehicle_id')
  .limit(3);

if (!images || images.length === 0) {
  console.log('No images found');
  process.exit(1);
}

console.log(`Found ${images.length} images to test\n`);

let successCount = 0;
let totalCost = 0;

for (const img of images) {
  const shortId = img.id.substring(0, 8);
  console.log(`Processing ${shortId}...`);
  
  try {
    const { data, error } = await supabase.functions.invoke('analyze-image-tier1', {
      body: {
        image_url: img.image_url,
        image_id: img.id,
        vehicle_id: img.vehicle_id,
        estimated_resolution: 'medium'
      }
    });
    
    if (error) {
      console.log(`  ❌ Error: ${error.message}`);
      continue;
    }
    
    console.log(`  ✓ ${data.angle} | ${data.category} | Score: ${data.image_quality?.overall_score}/10`);
    successCount++;
    totalCost += 0.00008; // Claude Haiku cost
  } catch (e) {
    console.log(`  ❌ Exception: ${e.message}`);
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${successCount}/${images.length} successful`);
console.log(`Cost: $${totalCost.toFixed(6)}`);
console.log(`${'='.repeat(60)}\n`);

if (successCount === images.length) {
  console.log('✅ ALL TESTS PASSED!');
  console.log('\nSafe to run full batch:');
  console.log('  node scripts/tiered-batch-processor.js');
} else {
  console.log('⚠️  Some tests failed - check errors above');
}
