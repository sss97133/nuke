#!/usr/bin/env node

/**
 * Direct test of analyze-image Edge Function
 * Uses direct HTTP call to bypass Supabase client issues
 */

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
      break;
    }
  } catch (e) {}
}

const supabaseUrl = envConfig.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const anonKey = envConfig.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const serviceKey = envConfig.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  console.error('❌ Missing VITE_SUPABASE_URL');
  process.exit(1);
}

// Use service key if available, otherwise anon key
const key = serviceKey || anonKey;
if (!key) {
  console.error('❌ Missing API key (need SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY)');
  process.exit(1);
}

const FUNCTION_URL = `${supabaseUrl}/functions/v1/analyze-image`;

async function testFunction(imageUrl, vehicleId) {
  console.log('\n🧪 Testing analyze-image function directly...');
  console.log(`   URL: ${FUNCTION_URL}`);
  console.log(`   Image: ${imageUrl.substring(0, 60)}...`);
  console.log(`   Vehicle: ${vehicleId}`);
  
  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_url: imageUrl,
        vehicle_id: vehicleId,
        timeline_event_id: null
      })
    });
    
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    
    console.log(`\n   Status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      console.error(`   ❌ Error Response:`, data);
      return { success: false, status: response.status, error: data };
    }
    
    console.log(`   ✓ Success Response:`, JSON.stringify(data, null, 2));
    return { success: true, data };
    
  } catch (e) {
    console.error(`   ❌ Exception:`, e.message);
    return { success: false, error: e.message };
  }
}

async function main() {
  console.log('🔬 Direct Edge Function Test\n');
  console.log('='.repeat(60));
  
  // Test with a known image
  const testImageUrl = 'https://bringatrailer.com/wp-content/uploads/2024/04/1972-Chevrolet-K10-Cheyenne-Super-SWB-0001-57312.jpg';
  const testVehicleId = '05b2cc98-cd4f-4fb6-a17e-038d6664905e';
  
  const result = await testFunction(testImageUrl, testVehicleId);
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST RESULT');
  console.log('='.repeat(60));
  
  if (result.success) {
    console.log('✅ Function call succeeded!');
    console.log('\n⚠️  Next: Check database to verify data was saved:');
    console.log('   - vehicle_images.ai_scan_metadata should have rekognition/appraiser/spid');
    console.log('   - vehicle_spid_data table should have records if SPID detected');
    console.log('   - image_tags should have auto-generated tags');
  } else {
    console.log('❌ Function call failed');
    console.log('\nCommon issues:');
    console.log('   1. Edge Function secrets not set in Supabase Dashboard');
    console.log('   2. Invalid API key for function invocation');
    console.log('   3. Function deployment issue');
    console.log('\nCheck: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/functions');
  }
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});

