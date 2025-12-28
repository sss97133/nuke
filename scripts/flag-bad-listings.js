#!/usr/bin/env node
/**
 * Flag bad listings in database:
 * - Listings with /video URLs (should be actual listing pages)
 * - Listings with no images or very few images
 * Run: node scripts/flag-bad-listings.js
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

async function flagBadListings() {
  console.log('🔍 Finding bad listings...\n');
  
  // Step 1: Find vehicles with /video URLs
  console.log('📊 Step 1: Finding vehicles with /video URLs...');
  
  const { data: videoUrlVehicles, error: videoError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, platform_url, primary_image_url')
    .or('discovery_url.ilike.%/video%,platform_url.ilike.%/video%');
  
  if (videoError) {
    console.error('❌ Error:', videoError);
    return;
  }
  
  console.log(`   Found ${videoUrlVehicles?.length || 0} vehicles with /video URLs\n`);
  
  // Step 2: Find vehicles with no images or very few images
  console.log('📊 Step 2: Finding vehicles with no/few images...');
  
  // Get all vehicles and their image counts
  const { data: allVehicles, error: allError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, platform_url, primary_image_url')
    .limit(10000);
  
  if (allError) {
    console.error('❌ Error:', allError);
    return;
  }
  
  const vehiclesWithFewImages = [];
  
  for (const vehicle of allVehicles || []) {
    const { data: images, error: imgError } = await supabase
      .from('vehicle_images')
      .select('id')
      .eq('vehicle_id', vehicle.id)
      .not('is_document', 'is', true); // Exclude documents from count
    
    if (imgError) continue;
    
    const imageCount = images?.length || 0;
    
    // Flag if no images or very few (less than 3)
    if (imageCount < 3) {
      vehiclesWithFewImages.push({
        ...vehicle,
        image_count: imageCount
      });
    }
  }
  
  console.log(`   Found ${vehiclesWithFewImages.length} vehicles with < 3 images\n`);
  
  // Step 3: Print results
  console.log('📋 BAD LISTINGS SUMMARY:\n');
  
  if (videoUrlVehicles && videoUrlVehicles.length > 0) {
    console.log(`❌ Vehicles with /video URLs (${videoUrlVehicles.length}):`);
    videoUrlVehicles.slice(0, 20).forEach(v => {
      console.log(`   - ${v.year || '?'} ${v.make || '?'} ${v.model || '?'}`);
      console.log(`     discovery_url: ${v.discovery_url || 'N/A'}`);
      console.log(`     platform_url: ${v.platform_url || 'N/A'}`);
    });
    if (videoUrlVehicles.length > 20) {
      console.log(`   ... and ${videoUrlVehicles.length - 20} more`);
    }
    console.log('');
  }
  
  if (vehiclesWithFewImages.length > 0) {
    console.log(`❌ Vehicles with < 3 images (${vehiclesWithFewImages.length}):`);
    vehiclesWithFewImages.slice(0, 20).forEach(v => {
      console.log(`   - ${v.year || '?'} ${v.make || '?'} ${v.model || '?'} (${v.image_count} images)`);
      console.log(`     discovery_url: ${v.discovery_url || 'N/A'}`);
    });
    if (vehiclesWithFewImages.length > 20) {
      console.log(`   ... and ${vehiclesWithFewImages.length - 20} more`);
    }
    console.log('');
  }
  
  // Step 4: Create a flag/status field (if it doesn't exist, we'll just log for now)
  console.log('💡 RECOMMENDATIONS:\n');
  console.log('   1. Fix /video URLs: Update discovery_url and platform_url to actual listing pages');
  console.log('   2. Re-extract images: Run extract-premium-auction on corrected URLs');
  console.log('   3. Delete bad listings: If they cannot be fixed, delete them');
  
  return {
    videoUrlCount: videoUrlVehicles?.length || 0,
    fewImagesCount: vehiclesWithFewImages.length,
    videoUrlVehicles: videoUrlVehicles || [],
    vehiclesWithFewImages: vehiclesWithFewImages
  };
}

flagBadListings().catch(console.error);


