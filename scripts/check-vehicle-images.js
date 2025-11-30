#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Check specific vehicles that showed "No images found"
const vehicleIds = [
  '69571d27-d590-432f-abf6-f78e2885b401', // 1989 Chevrolet Truck
  'a78733d2-e1db-49fd-a456-5507602696ff', // 1984 Chevrolet Truck
  'c1b04f00-7abf-4e1c-afd2-43fba17a6a1b', // 1964 jaguar xke
];

for (const vehicleId of vehicleIds) {
  console.log(`\n=== Checking vehicle ${vehicleId} ===`);
  
  // Get vehicle info
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .eq('id', vehicleId)
    .single();
  
  console.log(`Vehicle: ${vehicle?.year} ${vehicle?.make} ${vehicle?.model}`);
  
  // Check ALL images (no filter)
  const { data: allImages, count: allCount } = await supabase
    .from('vehicle_images')
    .select('id, image_url, is_document', { count: 'exact' })
    .eq('vehicle_id', vehicleId);
  
  console.log(`Total images (no filter): ${allCount || 0}`);
  
  // Check with is_document = false
  const { data: falseImages, count: falseCount } = await supabase
    .from('vehicle_images')
    .select('id, image_url, is_document', { count: 'exact' })
    .eq('vehicle_id', vehicleId)
    .eq('is_document', false);
  
  console.log(`Images with is_document = false: ${falseCount || 0}`);
  
  // Check with is_document = NULL or false
  const { data: nullOrFalseImages, count: nullOrFalseCount } = await supabase
    .from('vehicle_images')
    .select('id, image_url, is_document', { count: 'exact' })
    .eq('vehicle_id', vehicleId)
    .or('is_document.is.null,is_document.eq.false');
  
  console.log(`Images with is_document NULL or false: ${nullOrFalseCount || 0}`);
  
  if (allImages && allImages.length > 0) {
    console.log(`\nSample images:`);
    allImages.slice(0, 3).forEach(img => {
      console.log(`  - ${img.id}: is_document=${img.is_document}, url=${img.image_url?.substring(0, 60)}...`);
    });
  }
}

