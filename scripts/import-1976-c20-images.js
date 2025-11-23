#!/usr/bin/env node
/**
 * Import BAT images for 1976 Chevrolet C20 
 * Date images to January 15, 2024 (purchase date)
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

const BAT_URL = 'https://bringatrailer.com/listing/1976-chevrolet-c20-pickup-5/';
const VEHICLE_ID = '3f1791fe-4fe2-4994-b6fe-b137ffa57370';
const PURCHASE_DATE = '2024-01-15T12:00:00Z'; // January 15, 2024
const USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';

async function extractBaTImages(batUrl) {
  console.log('Fetching BAT listing...');
  const response = await fetch(batUrl);
  const html = await response.text();

  const imageUrls = [];
  const pattern = /https:\/\/bringatrailer\.com\/wp-content\/uploads\/[^"']+\.(?:jpg|jpeg|png)/gi;
  
  const matches = html.matchAll(pattern);
  for (const match of matches) {
    const url = match[0];
    if (!url.includes('logo') && !url.includes('icon') && !imageUrls.includes(url)) {
      imageUrls.push(url);
    }
  }

  return [...new Set(imageUrls)].slice(0, 10); // Unique, max 10
}

async function downloadAndSaveImage(imageUrl, index) {
  try {
    console.log(`Downloading image ${index + 1}...`);
    
    const response = await fetch(imageUrl);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const fileName = `bat_c20_${Date.now()}_${index}.jpg`;
    const storagePath = `${VEHICLE_ID}/${fileName}`;

    // Upload to storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('vehicle-images')
      .upload(storagePath, buffer, {
        contentType: 'image/jpeg',
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      console.error(`  ❌ Upload failed: ${uploadError.message}`);
      return null;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('vehicle-images')
      .getPublicUrl(storagePath);

    // Insert image with purchase date as taken_at
    const { data: imageData, error: imageError } = await supabase
      .from('vehicle_images')
      .insert({
        vehicle_id: VEHICLE_ID,
        user_id: USER_ID,
        image_url: publicUrl,
        storage_path: storagePath,
        filename: fileName,
        file_size: buffer.length,
        mime_type: 'image/jpeg',
        taken_at: PURCHASE_DATE, // January 15, 2024
        is_primary: index === 0,
        category: 'purchase',
        source: 'bat_listing',
        is_sensitive: false,
        exif_data: {
          source: 'bat_listing',
          original_url: imageUrl,
          import_date: new Date().toISOString(),
          purchase_documentation: true
        }
      })
      .select()
      .single();

    if (imageError) {
      console.error(`  ❌ DB insert failed: ${imageError.message}`);
      return null;
    }

    console.log(`  ✅ Saved: ${imageData.id}`);
    return imageData;

  } catch (error) {
    console.error(`  ❌ Error: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log('🚀 Importing 1976 C20 images from BAT\n');
  console.log(`Vehicle: ${VEHICLE_ID}`);
  console.log(`Purchase Date: ${PURCHASE_DATE}`);
  console.log(`BAT URL: ${BAT_URL}\n`);

  const imageUrls = await extractBaTImages(BAT_URL);
  console.log(`Found ${imageUrls.length} images to import\n`);

  for (let i = 0; i < imageUrls.length; i++) {
    await downloadAndSaveImage(imageUrls[i], i);
    await new Promise(resolve => setTimeout(resolve, 500)); // Rate limit
  }

  console.log('\n✅ Import complete!');
  console.log('Images dated to January 15, 2024 (purchase date)');
}

main();

