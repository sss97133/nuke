#!/usr/bin/env node
/**
 * Fix bad primary images on homepage
 * Identifies vehicles with problematic primary_image_url and fixes them
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Check if primary_image_url is problematic
function isBadPrimaryImage(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  return (
    lower.includes('thumb') ||
    lower.includes('thumbnail') ||
    lower.includes('video') ||
    lower.includes('-scaled') ||
    lower.match(/-\d+x\d+\.(jpg|jpeg|png|webp)$/) ||
    lower.includes('-small') ||
    lower.includes('-medium') ||
    lower.includes('interior') ||
    lower.includes('dashboard') ||
    lower.includes('engine')
  );
}

async function fixBadPrimaryImages() {
  console.log('🔍 Finding vehicles with bad primary images...\n');
  
  // Get vehicles with problematic primary_image_url
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, primary_image_url')
    .eq('is_public', true)
    .not('primary_image_url', 'is', null)
    .limit(1000);
  
  if (error) {
    console.error('❌ Error:', error);
    return;
  }
  
  const badImages = vehicles.filter(v => isBadPrimaryImage(v.primary_image_url));
  console.log(`⚠️  Found ${badImages.length} vehicles with bad primary images\n`);
  
  let fixed = 0;
  
  for (const vehicle of badImages.slice(0, 100)) { // Limit to 100 for now
    // Get good images from vehicle_images table
    const { data: images } = await supabase
      .from('vehicle_images')
      .select('image_url, is_primary')
      .eq('vehicle_id', vehicle.id)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(50);
    
    if (!images || images.length === 0) {
      console.log(`⏭️  Skipping ${vehicle.year} ${vehicle.make} ${vehicle.model} - no images in vehicle_images`);
      continue;
    }
    
    // Filter out bad images
    const goodImages = images.filter(img => !isBadPrimaryImage(img.image_url));
    
    if (goodImages.length === 0) {
      console.log(`⏭️  Skipping ${vehicle.year} ${vehicle.make} ${vehicle.model} - all images are bad`);
      continue;
    }
    
    // Use primary image or first good image
    const newPrimary = goodImages[0]?.image_url;
    
    if (newPrimary) {
      const { error: updateError } = await supabase
        .from('vehicles')
        .update({ primary_image_url: newPrimary })
        .eq('id', vehicle.id);
      
      if (updateError) {
        console.error(`❌ Failed to update ${vehicle.id}:`, updateError.message);
      } else {
        fixed++;
        console.log(`✅ Fixed ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
      }
    }
  }
  
  console.log(`\n✅ Fixed ${fixed} vehicles`);
}

fixBadPrimaryImages().catch(console.error);

