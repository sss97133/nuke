#!/usr/bin/env node
/**
 * Process January 2024 Images
 * Triggers AI analysis for all unprocessed images from January
 * Extracts SPID data and verifies vehicle information
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables');
  console.error('Required: VITE_SUPABASE_URL and VITE_SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function processImage(image) {
  console.log(`\n  📸 ${image.file_name}`);
  console.log(`     Date: ${new Date(image.taken_at).toLocaleDateString()}`);
  console.log(`     Vehicle: ${image.vehicle_id.substring(0, 8)}...`);
  
  try {
    // Call analyze-image edge function
    const { data, error } = await supabase.functions.invoke('analyze-image', {
      body: {
        image_url: image.image_url,
        vehicle_id: image.vehicle_id,
        image_id: image.id
      }
    });
    
    if (error) {
      console.error(`     ❌ Failed: ${error.message}`);
      return { success: false, spidDetected: false };
    }
    
    console.log(`     ✅ Processed`);
    
    // Check if SPID was detected
    if (data?.spid_data?.is_spid_sheet && data.spid_data.confidence > 70) {
      console.log(`     🎯 SPID SHEET DETECTED!`);
      console.log(`        Confidence: ${data.spid_data.confidence}%`);
      
      const extracted = data.spid_data.extracted_data;
      if (extracted.vin) {
        console.log(`        VIN: ${extracted.vin}`);
      }
      if (extracted.paint_code_exterior) {
        console.log(`        Paint: ${extracted.paint_code_exterior}`);
      }
      if (extracted.rpo_codes && extracted.rpo_codes.length > 0) {
        console.log(`        RPO Codes: ${extracted.rpo_codes.join(', ')}`);
      }
      
      return { success: true, spidDetected: true };
    }
    
    return { success: true, spidDetected: false };
    
  } catch (err) {
    console.error(`     ❌ Error: ${err.message}`);
    return { success: false, spidDetected: false };
  }
}

async function main() {
  console.log('=' .repeat(60));
  console.log('PROCESSING JANUARY 2024 IMAGES');
  console.log('='.repeat(60));
  console.log();
  
  // Get all January 2024 images
  console.log('🔍 Finding January 2024 images...');
  
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url, vehicle_id, file_name, taken_at, ai_scan_metadata')
    .gte('taken_at', '2024-01-01T00:00:00')
    .lt('taken_at', '2024-02-01T00:00:00')
    .order('taken_at');
  
  if (error) {
    console.error('❌ Error fetching images:', error.message);
    process.exit(1);
  }
  
  if (!images || images.length === 0) {
    console.log('No January 2024 images found.');
    return;
  }
  
  // Filter to unprocessed only
  const unprocessed = images.filter(img => 
    !img.ai_scan_metadata || 
    !img.ai_scan_metadata.rekognition
  );
  
  console.log(`\n📊 Found ${images.length} total images`);
  console.log(`   ${images.length - unprocessed.length} already processed`);
  console.log(`   ${unprocessed.length} need processing`);
  
  if (unprocessed.length === 0) {
    console.log('\n✅ All January images already processed!');
    return;
  }
  
  console.log(`\n🚀 Processing ${unprocessed.length} images...\n`);
  
  let processed = 0;
  let failed = 0;
  let spidFound = 0;
  
  for (const image of unprocessed) {
    const result = await processImage(image);
    
    if (result.success) {
      processed++;
      if (result.spidDetected) {
        spidFound++;
      }
    } else {
      failed++;
    }
    
    // Rate limit: wait 2 seconds between requests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('PROCESSING COMPLETE');
  console.log('='.repeat(60));
  console.log(`✅ Successfully processed: ${processed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`🎯 SPID sheets found: ${spidFound}`);
  
  if (spidFound > 0) {
    console.log('\n💡 To view SPID data:');
    console.log('   1. Go to vehicle profile');
    console.log('   2. Check Basic Info for "Verified by SPID" badges');
    console.log('   3. View RPO codes extracted from SPID');
    console.log('   4. Click "View SPID Sheet" link to see original image');
  }
  
  console.log('\n✨ Done!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

