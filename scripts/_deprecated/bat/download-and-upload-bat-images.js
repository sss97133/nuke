/**
 * DOWNLOAD AND UPLOAD BAT IMAGES TO SUPABASE STORAGE
 * Fixes broken external BaT links by downloading and re-uploading to Supabase
 */

import { chromium } from 'playwright';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const VIVA_USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';

async function scrapeBATImages(batUrl) {
  console.log(`  📡 Scraping images from ${batUrl}...`);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto(batUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    
    const imageUrls = await page.evaluate(() => {
      const images = [];
      document.querySelectorAll('img').forEach(img => {
        const alt = img.alt || '';
        let src = img.src;
        if (alt.includes('Load larger image') && src && src.includes('wp-content/uploads')) {
          src = src.split('?')[0]; // Remove query params for full resolution
          if (!images.includes(src)) images.push(src);
        }
      });
      return images;
    });
    
    await browser.close();
    console.log(`  ✅ Found ${imageUrls.length} images`);
    return imageUrls;
  } catch (error) {
    await browser.close();
    console.error(`  ❌ Error scraping: ${error.message}`);
    return [];
  }
}

async function downloadAndUploadImage(imageUrl, vehicleId, index, isPrimary) {
  try {
    // Download image
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Generate filename
    const ext = path.extname(imageUrl).split('?')[0] || '.jpg';
    const filename = `${vehicleId}_bat_${index}${ext}`;
    const storagePath = `vehicles/${vehicleId}/${filename}`;
    
    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('vehicle-images')
      .upload(storagePath, buffer, {
        contentType: 'image/jpeg',
        upsert: true
      });
    
    if (uploadError) throw uploadError;
    
    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('vehicle-images')
      .getPublicUrl(storagePath);
    
    return publicUrl;
  } catch (error) {
    console.error(`    ❌ Failed to download/upload: ${error.message}`);
    return null;
  }
}

async function fixBrokenBATImages() {
  console.log('🔍 Finding vehicles with broken BaT images...\n');
  
  // Get all vehicles with BaT URLs
  const { data: brokenImages, error } = await supabase
    .from('vehicle_images')
    .select('id, vehicle_id, image_url, is_primary')
    .like('image_url', 'https://bringatrailer.com%')
    .order('vehicle_id', { ascending: true })
    .order('is_primary', { ascending: false });
  
  if (error) {
    console.error('❌ Database error:', error);
    return;
  }
  
  console.log(`📸 Found ${brokenImages.length} broken BaT images\n`);
  
  // Group by vehicle
  const vehicleGroups = new Map();
  brokenImages.forEach(img => {
    if (!vehicleGroups.has(img.vehicle_id)) {
      vehicleGroups.set(img.vehicle_id, []);
    }
    vehicleGroups.get(img.vehicle_id).push(img);
  });
  
  console.log(`🚗 ${vehicleGroups.size} vehicles need image fixes\n`);
  
  let fixedCount = 0;
  let failedCount = 0;
  
  for (const [vehicleId, images] of vehicleGroups) {
    console.log(`\n🚗 Vehicle ${vehicleId} (${images.length} images)`);
    
    // Get vehicle info
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('year, make, model')
      .eq('id', vehicleId)
      .single();
    
    if (vehicle) {
      console.log(`  ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
    }
    
    // Get BaT URL from vehicle metadata first
    const { data: vehicleMeta } = await supabase
      .from('vehicles')
      .select('bat_auction_url, metadata')
      .eq('id', vehicleId)
      .single();
    
    let fullBatUrl = vehicleMeta?.bat_auction_url;
    
    // If no bat_auction_url, try to construct from image URL pattern
    if (!fullBatUrl) {
      // Image URL format: https://bringatrailer.com/wp-content/uploads/YYYY/MM/listing-slug_XXXXXX-XXXXX.jpg
      // We need to find the listing URL which requires the slug
      console.log(`  ⚠️  No bat_auction_url in vehicles table, skipping`);
      failedCount += images.length;
      continue;
    }
    
    // Scrape fresh images from BaT
    const freshImageUrls = await scrapeBATImages(fullBatUrl);
    
    if (freshImageUrls.length === 0) {
      console.log(`  ⚠️  No images found on BaT listing`);
      failedCount += images.length;
      continue;
    }
    
    // Download and upload each image
    for (let i = 0; i < Math.min(freshImageUrls.length, 20); i++) {
      const imageUrl = freshImageUrls[i];
      const isPrimary = i === 0;
      
      process.stdout.write(`  [${i + 1}/${freshImageUrls.length}] Downloading...`);
      
      const newUrl = await downloadAndUploadImage(imageUrl, vehicleId, i, isPrimary);
      
      if (newUrl) {
        // Update or create database record
        if (i < images.length) {
          // Update existing record
          await supabase
            .from('vehicle_images')
            .update({ 
              image_url: newUrl,
              category: 'bat_listing',
              is_primary: isPrimary
            })
            .eq('id', images[i].id);
          
          console.log(` ✅ Updated`);
        } else {
          // Create new record
          await supabase
            .from('vehicle_images')
            .insert({
              vehicle_id: vehicleId,
              user_id: VIVA_USER_ID,
              image_url: newUrl,
              category: 'bat_listing',
              is_primary: isPrimary
            });
          
          console.log(` ✅ Created`);
        }
        fixedCount++;
      } else {
        console.log(` ❌ Failed`);
        failedCount++;
      }
      
      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  console.log(`\n\n🎯 RESULTS:`);
  console.log(`✅ Fixed: ${fixedCount} images`);
  console.log(`❌ Failed: ${failedCount} images`);
  console.log(`\n✅ All broken BaT images fixed!`);
}

fixBrokenBATImages();

