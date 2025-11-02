#!/usr/bin/env node

/**
 * Re-extract EXIF data for images with missing taken_at dates
 * Focuses on vehicle d7962908-9a01-4082-a85e-6bbe532550b2 (1972 K10)
 */

import { createClient } from '@supabase/supabase-js';
import exifr from 'exifr';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env from frontend directory
dotenv.config({ path: join(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in environment');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function extractEXIF(imageUrl) {
  try {
    console.log(`Fetching image: ${imageUrl.substring(0, 100)}...`);
    const response = await fetch(imageUrl);
    const buffer = await response.arrayBuffer();
    
    const exifData = await exifr.parse(buffer, {
      gps: true,
      tiff: true,
      exif: true,
      iptc: false,
      ifd0: true,
      ifd1: false,
      mergeOutput: false
    });

    if (!exifData) {
      console.log('No EXIF data found');
      return null;
    }

    // Extract structured EXIF
    const structured = {
      camera: {
        make: exifData.Make || null,
        model: exifData.Model || null,
      },
      location: {
        latitude: exifData.latitude || null,
        longitude: exifData.longitude || null,
      },
      technical: {
        iso: exifData.ISO || null,
        aperture: exifData.FNumber ? `f/${exifData.FNumber}` : null,
        focalLength: exifData.FocalLength ? `${exifData.FocalLength}mm` : null,
        shutterSpeed: exifData.ExposureTime ? `1/${Math.round(1 / exifData.ExposureTime)}` : null,
      },
      DateTimeOriginal: exifData.DateTimeOriginal || exifData.CreateDate || exifData.ModifyDate || null
    };

    return structured;
  } catch (error) {
    console.error('EXIF extraction failed:', error.message);
    return null;
  }
}

async function fixMissingEXIF() {
  console.log('🔍 Finding images with missing EXIF data...\n');

  // Get all images for this vehicle without taken_at
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url, taken_at, created_at, exif_data')
    .eq('vehicle_id', 'd7962908-9a01-4082-a85e-6bbe532550b2')
    .is('taken_at', null);

  if (error) {
    console.error('Error fetching images:', error);
    return;
  }

  console.log(`Found ${images.length} images without taken_at dates\n`);

  let fixed = 0;
  let failed = 0;

  for (const image of images) {
    console.log(`\n📸 Processing: ${image.id}`);
    
    // Extract EXIF
    const exifData = await extractEXIF(image.image_url);
    
    if (!exifData || !exifData.DateTimeOriginal) {
      console.log('❌ No date found in EXIF, skipping');
      failed++;
      continue;
    }

    // Update database
    const { error: updateError } = await supabase
      .from('vehicle_images')
      .update({
        exif_data: exifData,
        taken_at: exifData.DateTimeOriginal
      })
      .eq('id', image.id);

    if (updateError) {
      console.error('❌ Update failed:', updateError);
      failed++;
    } else {
      console.log(`✅ Fixed: taken_at set to ${exifData.DateTimeOriginal}`);
      fixed++;
    }

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Fixed: ${fixed}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📈 Total: ${images.length}`);
}

fixMissingEXIF().catch(console.error);

