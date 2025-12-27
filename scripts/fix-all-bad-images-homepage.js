#!/usr/bin/env node
/**
 * Comprehensive fix for bad images on homepage
 * - Fixes bad primary images in vehicle_images table
 * - Updates vehicle.primary_image_url
 * - Prioritizes exterior shots over interior/engine bay
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

// Check if image URL is bad (thumbnail, video, interior, etc)
function isBadImage(url) {
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
    lower.includes('/interior') ||
    lower.includes('dashboard') ||
    lower.includes('engine') ||
    lower.includes('bay') ||
    lower.includes('underhood')
  );
}

// Check if image is interior/engine bay (not suitable for primary)
function isInteriorOrEngineBay(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.includes('interior') ||
    lower.includes('dashboard') ||
    lower.includes('engine') ||
    lower.includes('bay') ||
    lower.includes('underhood') ||
    lower.includes('trunk') ||
    lower.includes('cargo')
  );
}

async function fixBadImages() {
  console.log('🔍 Finding vehicles with bad primary images...\n');
  
  // Get all public vehicles
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .eq('is_public', true)
    .neq('status', 'pending')
    .limit(500);
  
  if (error) {
    console.error('❌ Error:', error);
    return;
  }
  
  console.log(`📊 Checking ${vehicles.length} vehicles...\n`);
  
  let fixed = 0;
  let skipped = 0;
  
  for (const vehicle of vehicles) {
    // Get all images for this vehicle
    const { data: images } = await supabase
      .from('vehicle_images')
      .select('id, image_url, is_primary, created_at')
      .eq('vehicle_id', vehicle.id)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(100);
    
    if (!images || images.length === 0) {
      skipped++;
      continue;
    }
    
    // Get current primary (or first image if no primary set)
    let currentPrimary = images.find(img => img.is_primary);
    if (!currentPrimary && images.length > 0) {
      currentPrimary = images[0];
    }
    
    // Always try to improve - prioritize exterior shots
    // Find good exterior images (not bad, not interior/engine bay)
    const goodExteriorImages = images.filter(img => 
      !isBadImage(img.image_url) && !isInteriorOrEngineBay(img.image_url)
    );
    
    // Fallback to any good images (including interior if that's all we have)
    const goodImages = goodExteriorImages.length > 0 
      ? goodExteriorImages 
      : images.filter(img => !isBadImage(img.image_url));
    
    if (goodImages.length === 0) {
      skipped++;
      continue;
    }
    
    // Select best image (first good exterior, or first good image)
    const newPrimary = goodImages[0];
    
    // Only update if different from current
    if (currentPrimary && currentPrimary.id === newPrimary.id && currentPrimary.is_primary) {
      // Already correct, just ensure vehicle.primary_image_url matches
      const { data: vehicleData } = await supabase
        .from('vehicles')
        .select('primary_image_url')
        .eq('id', vehicle.id)
        .single();
      
      if (vehicleData?.primary_image_url !== newPrimary.image_url) {
        await supabase
          .from('vehicles')
          .update({ primary_image_url: newPrimary.image_url })
          .eq('id', vehicle.id);
        fixed++;
      }
      continue;
    }
    
    // Update primary flag
    if (currentPrimary && currentPrimary.id !== newPrimary.id) {
      await supabase
        .from('vehicle_images')
        .update({ is_primary: false })
        .eq('id', currentPrimary.id);
    }
    
    await supabase
      .from('vehicle_images')
      .update({ is_primary: true })
      .eq('id', newPrimary.id);
    
    // Update vehicle.primary_image_url
    await supabase
      .from('vehicles')
      .update({ primary_image_url: newPrimary.image_url })
      .eq('id', vehicle.id);
    
    fixed++;
    console.log(`✅ Fixed ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}`);
  }
  
  console.log(`\n✅ Fixed ${fixed} vehicles`);
  console.log(`⏭️  Skipped ${skipped} vehicles (no good images)`);
}

fixBadImages().catch(console.error);

