#!/usr/bin/env node

/**
 * WORKING BATCH PROCESSOR
 * Uses production anon key (confirmed working!)
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://qkgaybvrernstplzjaam.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk'
);

const BATCH_SIZE = 3;  // Reduced to avoid rate limits
const DELAY_MS = 3000; // Increased delay between batches

let totalProcessed = 0;
let totalSuccess = 0;
let totalCost = 0;
const startTime = Date.now();

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║          BATCH IMAGE PROCESSOR (WORKING!)                      ║');
console.log('╚════════════════════════════════════════════════════════════════╝');
console.log('\nFetching unprocessed images...\n');

const { data: images, error } = await supabase
  .from('vehicle_images')
  .select('id, image_url, vehicle_id, ai_scan_metadata')
  .limit(3000);

if (error) {
  console.error('❌ Error fetching images:', error);
  process.exit(1);
}

const unprocessed = images.filter(img => 
  !img.ai_scan_metadata || !img.ai_scan_metadata.tier_1_analysis
);

console.log(`Found ${unprocessed.length} unprocessed out of ${images.length} total\n`);

if (unprocessed.length === 0) {
  console.log('✅ All images already processed!');
  process.exit(0);
}

// Process in batches
const batches = [];
for (let i = 0; i < unprocessed.length; i += BATCH_SIZE) {
  batches.push(unprocessed.slice(i, i + BATCH_SIZE));
}

console.log(`Processing ${unprocessed.length} images in ${batches.length} batches...\n`);

for (let b = 0; b < batches.length; b++) {
  const batch = batches[b];
  
  console.log(`📦 Batch ${b + 1}/${batches.length} (${batch.length} images)`);
  console.log('─'.repeat(70));
  
  const results = await Promise.all(
    batch.map(async (img) => {
      try {
        const { data, error } = await supabase.functions.invoke('analyze-image-tier1', {
          body: {
            image_url: img.image_url,
            image_id: img.id,
            vehicle_id: img.vehicle_id,
            estimated_resolution: 'medium'
          }
        });
        
        if (error) throw error;
        
        const shortId = img.id.substring(0, 8);
        console.log(`   ✓ ${shortId}... | ${data.angle} | ${data.category} | ${data.image_quality?.overall_score}/10`);
        
        totalSuccess++;
        totalCost += 0.00008; // Claude Haiku
        
        return { success: true };
      } catch (e) {
        console.log(`   ✗ ${img.id.substring(0, 8)}... | ${e.message}`);
        return { success: false };
      }
    })
  );
  
  totalProcessed += batch.length;
  const successCount = results.filter(r => r.success).length;
  
  console.log('─'.repeat(70));
  console.log(`   Success: ${successCount}/${batch.length} | Total cost: $${totalCost.toFixed(4)}`);
  
  const elapsed = Date.now() - startTime;
  const rate = (totalProcessed / (elapsed / 60000)).toFixed(1);
  const remaining = unprocessed.length - totalProcessed;
  const eta = remaining > 0 ? Math.ceil((remaining / totalProcessed) * (elapsed / 60000)) : 0;
  
  console.log(`   Overall: ${totalSuccess}/${totalProcessed} | Rate: ${rate} img/min | ETA: ${eta}min\n`);
  
  if (b < batches.length - 1) {
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
}

const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

console.log('═'.repeat(70));
console.log('📊 COMPLETE');
console.log('═'.repeat(70));
console.log(`Total: ${totalProcessed} images`);
console.log(`Success: ${totalSuccess} (${((totalSuccess/totalProcessed)*100).toFixed(1)}%)`);
console.log(`Cost: $${totalCost.toFixed(4)}`);
console.log(`Time: ${duration} minutes`);
console.log('═'.repeat(70));
console.log('\n✅ Processing complete! Check dashboard: https://n-zero.dev/admin/image-processing\n');
