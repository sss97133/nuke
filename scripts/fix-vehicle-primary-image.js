#!/usr/bin/env node

/**
 * Fix vehicle primary image by checking if it matches the vehicle
 * and setting it to the first BAT image if available
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env.local') });
dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const VEHICLE_ID = process.argv[2] || 'bfaf7f3c-9a6a-4164-bffb-1e9fae075883';

async function fixPrimaryImage() {
  console.log(`\n🔧 Fixing primary image for vehicle: ${VEHICLE_ID}\n`);

  // Get vehicle
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('id, year, make, model, primary_image_url, image_url, origin_metadata')
    .eq('id', VEHICLE_ID)
    .single();

  if (!vehicle) {
    console.error('❌ Vehicle not found');
    return;
  }

  console.log(`Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`Current primary_image_url: ${vehicle.primary_image_url || 'N/A'}`);

  // Get all images ordered by position (BAT images should be first)
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('id, image_url, is_primary, position, source, created_at')
    .eq('vehicle_id', VEHICLE_ID)
    .not('is_duplicate', 'is', true)
    .not('is_document', 'is', true)
    .order('position', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(10);

  if (!images || images.length === 0) {
    console.error('❌ No images found');
    return;
  }

  console.log(`\nFound ${images.length} images:`);
  images.forEach((img, idx) => {
    console.log(`  ${idx + 1}. ${img.is_primary ? '⭐ PRIMARY' : ''} Position: ${img.position ?? 'NULL'} Source: ${img.source || 'N/A'}`);
    console.log(`     ${img.image_url.substring(0, 100)}...`);
  });

  // Find the best primary image (prefer BAT images, then first non-duplicate)
  const batImage = images.find(img => img.source === 'bat_import' || img.image_url?.includes('bringatrailer.com'));
  const bestImage = batImage || images[0];

  if (!bestImage) {
    console.error('❌ No suitable image found');
    return;
  }

  console.log(`\n✅ Setting primary image to: ${bestImage.image_url.substring(0, 100)}...`);

  // Unset all current primaries
  await supabase
    .from('vehicle_images')
    .update({ is_primary: false })
    .eq('vehicle_id', VEHICLE_ID);

  // Set new primary
  const { error: updateError } = await supabase
    .from('vehicle_images')
    .update({ is_primary: true })
    .eq('id', bestImage.id);

  if (updateError) {
    console.error('❌ Error updating primary:', updateError);
    return;
  }

  // Update vehicle's primary_image_url
  const { error: vehicleError } = await supabase
    .from('vehicles')
    .update({ 
      primary_image_url: bestImage.image_url,
      image_url: bestImage.image_url,
      updated_at: new Date().toISOString()
    })
    .eq('id', VEHICLE_ID);

  if (vehicleError) {
    console.error('❌ Error updating vehicle:', vehicleError);
    return;
  }

  console.log('✅ Primary image updated successfully!');
}

fixPrimaryImage().catch(console.error);

