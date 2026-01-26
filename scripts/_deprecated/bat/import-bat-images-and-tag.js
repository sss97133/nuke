#!/usr/bin/env node

/**
 * Import ALL images from BaT listing and AI-tag them with angles
 * BaT has professional photography = complete coverage
 */

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// BaT listing for 1972 K10
const BAT_URL = 'https://bringatrailer.com/listing/1972-chevrolet-k10-pickup-6/';
const VEHICLE_ID = 'd7962908-9a01-4082-a85e-6bbe532550b2';

async function extractBaTImages(batUrl) {
  console.log('Fetching BaT listing...');
  const response = await fetch(batUrl);
  const html = await response.text();

  // Extract all high-res image URLs from BaT gallery
  const imageUrls = [];
  
  // BaT uses different patterns for images
  const patterns = [
    /https:\/\/bringatrailer\.com\/wp-content\/uploads\/[^"']+\.(?:jpg|jpeg|png)/gi,
    /data-src="([^"]+\.(?:jpg|jpeg|png))"/gi,
    /srcset="([^"]+\.(?:jpg|jpeg|png)[^"]*\s+\d+w)"/gi
  ];

  for (const pattern of patterns) {
    const matches = html.matchAll(pattern);
    for (const match of matches) {
      let url = match[1] || match[0];
      // Extract just the URL if it's in a srcset
      if (url.includes(' ')) {
        url = url.split(' ')[0];
      }
      if (url && !url.includes('logo') && !url.includes('icon') && 
          !url.includes('/themes/') && !imageUrls.includes(url)) {
        imageUrls.push(url);
      }
    }
  }

  // Deduplicate and get high-res versions
  const uniqueUrls = [...new Set(imageUrls)]
    .filter(url => !url.includes('-150x') && !url.includes('-300x'))  // Skip thumbnails
    .slice(0, 50);  // Limit to 50 best images

  console.log(`Found ${uniqueUrls.length} high-res images from BaT`);
  return uniqueUrls;
}

async function downloadAndSaveImage(imageUrl, index) {
  try {
    console.log(`Downloading image ${index + 1}...`);
    
    const response = await fetch(imageUrl);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Generate filename
    const ext = imageUrl.match(/\.(jpg|jpeg|png|webp)$/i)?.[1] || 'jpg';
    const filename = `bat_k10_${Date.now()}_${index}.${ext}`;
    const storagePath = `${VEHICLE_ID}/${filename}`;

    // Upload to Supabase storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('vehicle-images')
      .upload(storagePath, buffer, {
        contentType: `image/${ext}`,
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      console.error(`  ❌ Upload failed: ${uploadError.message}`);
      return null;
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('vehicle-images')
      .getPublicUrl(storagePath);

    // Create vehicle_images entry
    const { data: imageData, error: imageError } = await supabase
      .from('vehicle_images')
      .insert({
        vehicle_id: VEHICLE_ID,
        image_url: publicUrl,
        user_id: null,  // Photographer unknown - claimable
        source: 'bat_listing',
        category: 'exterior',  // Will be refined by AI tagging
        imported_by: '0b9f107a-d124-49de-9ded-94698f63c1c4',
        metadata: {
          original_bat_url: imageUrl,
          bat_listing: BAT_URL,
          photographer_unknown: true,
          claimable: true,
          imported_from: 'bat'
        }
      })
      .select()
      .single();

    if (imageError) {
      console.error(`  ❌ DB insert failed: ${imageError.message}`);
      return null;
    }

    console.log(`  ✅ Saved image ${index + 1}: ${imageData.id}`);
    return imageData;

  } catch (error) {
    console.error(`  ❌ Error: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log('🚀 Starting BaT image import + AI angle tagging\n');
  console.log(`Vehicle: 1972 Chevrolet K10`);
  console.log(`BaT Listing: ${BAT_URL}\n`);

  // Step 1: Extract image URLs from BaT
  const imageUrls = await extractBaTImages(BAT_URL);
  
  if (imageUrls.length === 0) {
    console.log('❌ No images found. BaT may be blocking scraping.');
    return;
  }

  // Step 2: Download and save each image
  const savedImages = [];
  for (let i = 0; i < Math.min(imageUrls.length, 50); i++) {
    const imageData = await downloadAndSaveImage(imageUrls[i], i);
    if (imageData) {
      savedImages.push(imageData);
    }
    
    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`\n✅ Imported ${savedImages.length} images from BaT`);
  console.log(`\n📊 Coverage Status:`);
  
  // Step 3: Check coverage (AI tagging happens automatically via Edge Function)
  const { data: coverage } = await supabase
    .from('vehicle_image_coverage')
    .select('*')
    .eq('vehicle_id', VEHICLE_ID)
    .single();

  if (coverage) {
    console.log(`Exterior:      ${coverage.exterior_essential_count}/${coverage.exterior_essential_total}`);
    console.log(`Interior:      ${coverage.interior_essential_count}/${coverage.interior_essential_total}`);
    console.log(`Undercarriage: ${coverage.undercarriage_essential_count}/${coverage.undercarriage_essential_total}`);
    console.log(`Engine Bay:    ${coverage.engine_bay_essential_count}/${coverage.engine_bay_essential_total}`);
    console.log(`VIN Plates:    ${coverage.vin_plates_essential_count}/${coverage.vin_plates_essential_total}`);
    console.log(`\nOverall:       ${coverage.essential_coverage_percent}%`);
  }

  console.log(`\n✨ Done! Visit https://n-zero.dev/vehicle/${VEHICLE_ID} to see coverage`);
}

main().catch(console.error);

