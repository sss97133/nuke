#!/usr/bin/env node

/**
 * SIMPLE PROCESSOR - Works with anon key
 * Just invokes Edge Functions, no direct DB access needed
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;


if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

console.log('Starting processing with working anon key...\n');

// Test with first image
const testImageUrl = 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/18377b38-4232-4549-ba36-acce06b7f67e/dee16914-99c1-4106-a25c-bdd6601dc83d.jpg';
const testImageId = 'c869d996-f36e-41a6-8874-e5f42b026517';
const testVehicleId = '18377b38-4232-4549-ba36-acce06b7f67e';

console.log('Processing test image...');

const { data, error } = await supabase.functions.invoke('analyze-image-tier1', {
  body: {
    image_url: testImageUrl,
    image_id: testImageId,
    vehicle_id: testVehicleId,
    estimated_resolution: 'medium'
  }
});

if (error) {
  console.log('❌ Error:', error);
} else {
  console.log('✅ Success!');
  console.log('Angle:', data.angle);
  console.log('Category:', data.category);
  console.log('Components:', data.components_visible);
  console.log('Quality:', data.image_quality?.overall_score, '/10');
  console.log('\n🎉 Processing works! Ready to scale up.');
}
