#!/usr/bin/env node

/**
 * Test analyze-image function with a single image
 * Verifies API keys and extraction pipeline work before batch processing
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load env vars
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

const supabaseUrl = envConfig.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
// Use service role key for testing (has access to invoke functions and read all data)
const supabaseKey = envConfig.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || envConfig.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase env vars');
  console.error('   Need: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_ANON_KEY)');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Get a test image
async function getTestImage() {
  const { data, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url, vehicle_id, category')
    .or('ai_scan_metadata.is.null,ai_scan_metadata.eq.{}')
    .limit(1)
    .single();
  
  if (error || !data) {
    console.error('❌ No test image found:', error);
    return null;
  }
  
  return data;
}

async function testAnalysis(image) {
  console.log('\n🧪 Testing analyze-image function...');
  console.log(`   Image ID: ${image.id}`);
  console.log(`   URL: ${image.image_url.substring(0, 60)}...`);
  console.log(`   Vehicle: ${image.vehicle_id}`);
  console.log(`   Category: ${image.category}`);
  
  try {
    console.log('\n   📡 Calling analyze-image function...');
    const { data, error } = await supabase.functions.invoke('analyze-image', {
      body: {
        image_url: image.image_url,
        vehicle_id: image.vehicle_id,
        timeline_event_id: null
      }
    });
    
    if (error) {
      console.error(`\n   ❌ Function Error:`, error);
      return { success: false, error };
    }
    
    console.log(`\n   ✓ Function Response:`, JSON.stringify(data, null, 2));
    
    // Check if data was saved to DB
    console.log('\n   🔍 Verifying data was saved...');
    const { data: updatedImage, error: fetchError } = await supabase
      .from('vehicle_images')
      .select('ai_scan_metadata')
      .eq('id', image.id)
      .single();
    
    if (fetchError) {
      console.error(`   ❌ Could not verify save:`, fetchError);
      return { success: false, error: fetchError };
    }
    
    const metadata = updatedImage?.ai_scan_metadata || {};
    console.log(`   Metadata keys:`, Object.keys(metadata));
    
    const hasRekognition = !!metadata.rekognition;
    const hasAppraiser = !!metadata.appraiser;
    const hasSPID = !!metadata.spid;
    const hasScannedAt = !!metadata.scanned_at;
    
    console.log(`\n   📊 Extraction Results:`);
    console.log(`      Rekognition: ${hasRekognition ? '✓' : '✗'}`);
    console.log(`      Appraiser: ${hasAppraiser ? '✓' : '✗'}`);
    console.log(`      SPID: ${hasSPID ? '✓' : '✗'}`);
    console.log(`      Scanned At: ${hasScannedAt ? '✓' : '✗'}`);
    
    // Check SPID table
    if (hasSPID) {
      const { data: spidData } = await supabase
        .from('vehicle_spid_data')
        .select('*')
        .eq('vehicle_id', image.vehicle_id)
        .maybeSingle();
      
      if (spidData) {
        console.log(`\n   📋 SPID Data Saved:`);
        console.log(`      VIN: ${spidData.vin || 'N/A'}`);
        console.log(`      RPO Codes: ${spidData.rpo_codes?.length || 0}`);
        console.log(`      Confidence: ${spidData.extraction_confidence || 'N/A'}`);
      }
    }
    
    const success = hasRekognition && hasScannedAt;
    
    if (success) {
      console.log(`\n   ✅ TEST PASSED - Function is working!`);
    } else {
      console.log(`\n   ⚠️  TEST PARTIAL - Some extractions missing`);
    }
    
    return { success, data, metadata };
    
  } catch (e) {
    console.error(`\n   ❌ Exception:`, e.message);
    console.error(`   Stack:`, e.stack);
    return { success: false, error: e.message };
  }
}

async function main() {
  console.log('🔬 Testing analyze-image Function\n');
  console.log('='.repeat(60));
  
  const image = await getTestImage();
  if (!image) {
    console.log('❌ No test image available');
    return;
  }
  
  const result = await testAnalysis(image);
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Success: ${result.success ? '✅ YES' : '❌ NO'}`);
  
  if (!result.success) {
    console.log(`\n⚠️  Issues detected:`);
    console.log(`   - Check Supabase Edge Function secrets:`);
    console.log(`     • OPENAI_API_KEY`);
    console.log(`     • AWS_ACCESS_KEY_ID`);
    console.log(`     • AWS_SECRET_ACCESS_KEY`);
    console.log(`     • SERVICE_ROLE_KEY`);
    console.log(`\n   Dashboard: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/settings/functions`);
  } else {
    console.log(`\n✅ Ready for batch processing!`);
  }
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
