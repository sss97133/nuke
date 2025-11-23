#!/usr/bin/env node

/**
 * JUST SET ANGLES
 * 
 * Simplest possible task: Get angle for all 2,742 images
 * Metric: How many have angle defined? (target: 2,742)
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://qkgaybvrernstplzjaam.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk'
);

console.log('Setting angles for all images...\n');

// Get images without angle
const { data: images } = await supabase
  .from('vehicle_images')
  .select('id, image_url')
  .or('angle.is.null,angle.eq.')
  .limit(2742);

console.log(`Found ${images?.length || 0} images without angle\n`);

if (!images || images.length === 0) {
  console.log('✅ All images have angles!');
  process.exit(0);
}

let processed = 0;
let successful = 0;

// Process slowly to avoid rate limits (1 per second)
for (const img of images) {
  try {
    const { data, error } = await supabase.functions.invoke('set-image-angle', {
      body: {
        image_url: img.image_url,
        image_id: img.id
      }
    });
    
    if (error) throw error;
    
    const shortId = img.id.substring(0, 8);
    console.log(`✓ ${shortId}... → ${data.angle}`);
    successful++;
    
  } catch (e) {
    console.log(`✗ ${img.id.substring(0, 8)}... → ${e.message}`);
  }
  
  processed++;
  
  // Progress every 10 images
  if (processed % 10 === 0) {
    console.log(`\n[${processed}/${images.length}] ${((processed/images.length)*100).toFixed(1)}% - ${successful} successful\n`);
  }
  
  // Rate limit: 1 per second
  await new Promise(r => setTimeout(r, 1000));
}

console.log(`\n✅ Complete: ${successful}/${processed} angles set`);
console.log(`\nCheck: SELECT COUNT(*) FROM vehicle_images WHERE angle IS NOT NULL;`);

