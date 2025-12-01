#!/usr/bin/env node
/**
 * Import BaT images for the Jaguar XKE vehicle
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const vehicleId = 'c1b04f00-7abf-4e1c-afd2-43fba17a6a1b';
const batUrl = 'https://bringatrailer.com/listing/1964-jaguar-xke-series-1-roadster-5/';

async function scrapeBaTImages() {
  console.log(`📡 Scraping images from BaT listing...`);
  console.log(`   URL: ${batUrl}\n`);
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto(batUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    
    const imageUrls = await page.evaluate(() => {
      const images = [];
      const seen = new Set();
      
      // Strategy 1: Look for gallery images in data attributes
      const galleryEl = document.querySelector('[data-gallery-items]');
      if (galleryEl) {
        try {
          const raw = galleryEl.getAttribute('data-gallery-items');
          if (raw) {
            const items = JSON.parse(raw);
            if (Array.isArray(items)) {
              for (const it of items) {
                const url = it?.large?.url || it?.full?.url || it?.small?.url;
                if (url && !seen.has(url)) {
                  seen.add(url);
                  images.push(url);
                }
              }
            }
          }
        } catch (e) {
          console.log('Failed to parse gallery data:', e);
        }
      }
      
      // Strategy 2: Look for all img tags
      document.querySelectorAll('img').forEach(el => {
        let src = el.src || el.getAttribute('src') || el.getAttribute('data-src');
        if (!src) return;
        
        src = src.split('?')[0].split(' ')[0];
        
        if (src.includes('wp-content/uploads') && 
            !src.includes('logo') && 
            !src.includes('icon') &&
            !src.includes('avatar') &&
            !src.includes('gravatar') &&
            !src.match(/-(\d+)x\d+\./) &&
            !seen.has(src)) {
          seen.add(src);
          images.push(src);
        }
      });
      
      // Strategy 3: Extract from HTML source
      const html = document.documentElement.innerHTML;
      const regex = /https:\/\/bringatrailer\.com\/wp-content\/uploads\/[^"'\s<>]+\.(jpg|jpeg|png|webp)/gi;
      const matches = html.matchAll(regex);
      for (const match of matches) {
        let src = match[0].split('?')[0];
        if (!src.includes('-150x') && 
            !src.includes('-300x') && 
            !src.includes('logo') &&
            !src.includes('icon') &&
            !seen.has(src)) {
          seen.add(src);
          images.push(src);
        }
      }
      
      return Array.from(new Set(images));
    });
    
    await browser.close();
    console.log(`✅ Found ${imageUrls.length} images`);
    return imageUrls;
  } catch (error) {
    await browser.close();
    console.error(`❌ Error scraping: ${error.message}`);
    throw error;
  }
}

async function downloadAndUploadImage(imageUrl, index) {
  try {
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    const ext = imageUrl.match(/\.(jpg|jpeg|png|webp)/i)?.[0] || '.jpg';
    const filename = `bat_${Date.now()}_${index}${ext}`;
    const storagePath = `vehicles/${vehicleId}/bat/${filename}`;
    
    // Upload to vehicle-images bucket
    const { error: uploadError } = await supabase.storage
      .from('vehicle-images')
      .upload(storagePath, buffer, {
        contentType: response.headers.get('content-type') || 'image/jpeg',
        cacheControl: '3600',
        upsert: false
      });
    
    if (uploadError) {
      throw uploadError;
    }
    
    const { data: { publicUrl } } = supabase.storage
      .from('vehicle-images')
      .getPublicUrl(storagePath);
    
    return publicUrl;
  } catch (error) {
    console.error(`   ❌ Failed to download/upload image ${index}: ${error.message}`);
    return null;
  }
}

async function importImages() {
  console.log('🚗 Importing BaT images for Jaguar XKE\n');
  console.log('='.repeat(60));
  
  // Get vehicle info
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .single();
  
  if (vehicleError || !vehicle) {
    console.error('❌ Vehicle not found:', vehicleError);
    process.exit(1);
  }
  
  console.log(`Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`BaT URL: ${vehicle.bat_auction_url || batUrl}\n`);
  
  // Check existing images
  const { data: existingImages } = await supabase
    .from('vehicle_images')
    .select('id, image_url')
    .eq('vehicle_id', vehicleId);
  
  console.log(`Existing images: ${existingImages?.length || 0}\n`);
  
  // Scrape images from BaT
  const imageUrls = await scrapeBaTImages();
  
  if (imageUrls.length === 0) {
    console.log('❌ No images found on BaT listing');
    process.exit(1);
  }
  
  console.log(`\n📥 Downloading and uploading ${imageUrls.length} images...\n`);
  
  // Get user ID (use vehicle owner or default)
  const userId = vehicle.user_id || '0b9f107a-d124-49de-9ded-94698f63c1c4';
  
  let uploaded = 0;
  let failed = 0;
  
  for (let i = 0; i < imageUrls.length; i++) {
    const imageUrl = imageUrls[i];
    process.stdout.write(`[${i + 1}/${imageUrls.length}] Processing... `);
    
    const publicUrl = await downloadAndUploadImage(imageUrl, i);
    
    if (publicUrl) {
      // Insert image record
      const { error: insertError } = await supabase
        .from('vehicle_images')
        .insert({
          vehicle_id: vehicleId,
          image_url: publicUrl,
          user_id: userId,
          is_primary: i === 0, // First image is primary
          source: 'bat_listing',
          source_url: imageUrl,
          is_external: false
        });
      
      if (insertError) {
        console.log(`❌ DB insert failed: ${insertError.message}`);
        failed++;
      } else {
        console.log(`✅ Uploaded`);
        uploaded++;
      }
    } else {
      failed++;
    }
    
    // Rate limiting
    if (i < imageUrls.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`\n✅ Import complete!`);
  console.log(`   Uploaded: ${uploaded} images`);
  console.log(`   Failed: ${failed} images`);
  console.log(`   Total: ${imageUrls.length} images found\n`);
}

importImages().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

