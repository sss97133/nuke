/**
 * FIX BROKEN BAT IMAGES FOR SUBURBAN
 * Downloads broken BaT images and saves them to Supabase storage
 */

import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 
                     process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || 
                     process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('❌ Missing Supabase key. Need SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const VEHICLE_ID = 'b5a0c58a-6915-499b-ba5d-63c42fb6a91f';
const BAT_URL = 'https://bringatrailer.com/listing/1985-chevrolet-suburban-11/';
const USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';

// Broken image URLs from the database
const BROKEN_IMAGE_URLS = [
  'https://bringatrailer.com/wp-content/uploads/2025/04/1985_chevrolet_suburban_silverado_1500_4x4_1714516316c3DSCF6805-Edit-99933.jpg',
  'https://bringatrailer.com/wp-content/uploads/2025/04/1985_chevrolet_suburban_silverado_1500_4x4_1714516316c3DSCF6819-Edit-99999.jpg',
  'https://bringatrailer.com/wp-content/uploads/2025/04/1985_chevrolet_suburban_silverado_1500_4x4_1714516316c3DSCF6820-Edit-100006.jpg',
  'https://bringatrailer.com/wp-content/uploads/2025/04/1985_chevrolet_suburban_silverado_1500_4x4_1714516316c3DSCF6821-Edit-100018.jpg',
  'https://bringatrailer.com/wp-content/uploads/2025/04/1985_chevrolet_suburban_silverado_1500_4x4_1714516316c3DSCF6822-Edit-100012.jpg'
];

async function scrapeBATImages(batUrl) {
  console.log(`\n📡 Scraping fresh images from BaT listing...`);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    // Set longer timeout and use domcontentloaded instead of networkidle
    await page.goto(batUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000); // Wait for images to load
    
    // Extract all gallery images - try multiple strategies
    const imageUrls = await page.evaluate(() => {
      const images = [];
      const seen = new Set();
      
      // Strategy 1: Look for gallery images in common BaT patterns
      document.querySelectorAll('img, [data-src], [data-lazy-src], [data-full], picture source').forEach(el => {
        let src = el.src || 
                  el.getAttribute('src') ||
                  el.getAttribute('data-src') || 
                  el.getAttribute('data-lazy-src') || 
                  el.getAttribute('data-full') ||
                  el.getAttribute('srcset')?.split(' ')[0];
        
        if (!src) return;
        
        // Clean up the URL
        src = src.split('?')[0].split(' ')[0]; // Remove query params and srcset sizes
        
        // Filter for actual vehicle images
        if (src.includes('wp-content/uploads') && 
            !src.includes('logo') && 
            !src.includes('icon') &&
            !src.includes('avatar') &&
            !src.includes('gravatar') &&
            !src.match(/-(\d+)x\d+\./) && // Skip thumbnails like -150x150
            !seen.has(src)) {
          seen.add(src);
          images.push(src);
        }
      });
      
      // Strategy 2: Look for gallery container and extract all images
      const gallery = document.querySelector('.gallery, .image-gallery, [class*="gallery"], [class*="images"]');
      if (gallery) {
        gallery.querySelectorAll('img, [data-src], [data-lazy-src]').forEach(el => {
          let src = el.src || el.getAttribute('data-src') || el.getAttribute('data-lazy-src');
          if (src) {
            src = src.split('?')[0].split(' ')[0];
            if (src.includes('wp-content/uploads') && !seen.has(src)) {
              seen.add(src);
              images.push(src);
            }
          }
        });
      }
      
      // Strategy 3: Extract from page source HTML directly
      const html = document.documentElement.innerHTML;
      const regex = /https:\/\/bringatrailer\.com\/wp-content\/uploads\/[^"'\s<>]+\.(jpg|jpeg|png|webp)/gi;
      const matches = html.matchAll(regex);
      for (const match of matches) {
        let src = match[0].split('?')[0];
        if (!src.includes('-150x') && !src.includes('-300x') && !seen.has(src)) {
          seen.add(src);
          images.push(src);
        }
      }
      
      return images;
    });
    
    await browser.close();
    console.log(`✅ Found ${imageUrls.length} images from BaT`);
    return imageUrls;
  } catch (error) {
    await browser.close();
    console.error(`❌ Error scraping BaT: ${error.message}`);
    return [];
  }
}

async function downloadAndUploadImage(imageUrl, imageId, index) {
  try {
    console.log(`  [${index + 1}/5] Downloading: ${path.basename(imageUrl)}`);
    
    // Try to download the image
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} - Image not found`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Get file extension
    const ext = path.extname(imageUrl).split('?')[0] || '.jpg';
    const filename = `bat_suburban_${Date.now()}_${index}${ext}`;
    const storagePath = `vehicles/${VEHICLE_ID}/bat/${filename}`;
    
    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('vehicle-images')
      .upload(storagePath, buffer, {
        contentType: response.headers.get('content-type') || 'image/jpeg',
        cacheControl: '3600',
        upsert: false
      });
    
    if (uploadError) {
      // Try vehicle-data bucket if vehicle-images doesn't work
      const { error: uploadError2 } = await supabase.storage
        .from('vehicle-data')
        .upload(`vehicles/${VEHICLE_ID}/bat/${filename}`, buffer, {
          contentType: response.headers.get('content-type') || 'image/jpeg',
          cacheControl: '3600',
          upsert: false
        });
      
      if (uploadError2) throw uploadError2;
      
      // Get public URL from vehicle-data
      const { data: { publicUrl } } = supabase.storage
        .from('vehicle-data')
        .getPublicUrl(`vehicles/${VEHICLE_ID}/bat/${filename}`);
      
      return publicUrl;
    }
    
    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('vehicle-images')
      .getPublicUrl(storagePath);
    
    return publicUrl;
  } catch (error) {
    console.error(`    ❌ Failed: ${error.message}`);
    return null;
  }
}

async function updateImageRecord(imageId, newUrl, originalUrl) {
  try {
    // First get the existing record to preserve user_id
    const { data: existing } = await supabase
      .from('vehicle_images')
      .select('user_id, exif_data')
      .eq('id', imageId)
      .single();
    
    const { error } = await supabase
      .from('vehicle_images')
      .update({
        image_url: newUrl,
        is_external: false,
        source: 'bat_listing',
        source_url: originalUrl,
        user_id: existing?.user_id || USER_ID, // Preserve existing user_id or use default
        exif_data: {
          ...(existing?.exif_data || {}),
          original_bat_url: originalUrl,
          downloaded_at: new Date().toISOString(),
          fixed: true
        }
      })
      .eq('id', imageId);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error(`    ❌ Failed to update DB: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🚀 Fixing broken BaT images for Suburban\n');
  console.log(`Vehicle ID: ${VEHICLE_ID}`);
  console.log(`BaT URL: ${BAT_URL}\n`);
  
  // Get existing broken image records
  const { data: brokenImages, error: fetchError } = await supabase
    .from('vehicle_images')
    .select('id, image_url')
    .eq('vehicle_id', VEHICLE_ID)
    .or('image_url.ilike.%bringatrailer.com%,source.eq.bat_listing_broken')
    .order('created_at');
  
  if (fetchError) {
    console.error('❌ Error fetching broken images:', fetchError);
    return;
  }
  
  console.log(`📸 Found ${brokenImages.length} broken images to fix\n`);
  
  // First, try to download the original URLs directly
  let fixedCount = 0;
  let failedCount = 0;
  const failedUrls = [];
  
  for (let i = 0; i < brokenImages.length; i++) {
    const img = brokenImages[i];
    const originalUrl = img.image_url;
    
    console.log(`\n[${i + 1}/${brokenImages.length}] Processing image ${img.id}`);
    
    const newUrl = await downloadAndUploadImage(originalUrl, img.id, i);
    
    if (newUrl) {
      const updated = await updateImageRecord(img.id, newUrl, originalUrl);
      if (updated) {
        console.log(`  ✅ Fixed! New URL: ${newUrl.substring(0, 80)}...`);
        fixedCount++;
      } else {
        failedCount++;
        failedUrls.push({ id: img.id, url: originalUrl });
      }
    } else {
      failedCount++;
      failedUrls.push({ id: img.id, url: originalUrl });
    }
    
    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // If we have failures, try scraping BaT for fresh images
  if (failedUrls.length > 0) {
    console.log(`\n\n🔄 ${failedUrls.length} images failed direct download. Scraping BaT for fresh images...`);
    
    const freshImageUrls = await scrapeBATImages(BAT_URL);
    
    if (freshImageUrls.length > 0) {
      console.log(`\n📥 Found ${freshImageUrls.length} fresh images. Matching and downloading...`);
      
      // Try to match failed images with fresh ones
      for (let i = 0; i < Math.min(failedUrls.length, freshImageUrls.length); i++) {
        const failed = failedUrls[i];
        const freshUrl = freshImageUrls[i];
        
        console.log(`\n  [${i + 1}/${failedUrls.length}] Trying fresh image from BaT`);
        const newUrl = await downloadAndUploadImage(freshUrl, failed.id, i);
        
        if (newUrl) {
          const updated = await updateImageRecord(failed.id, newUrl, freshUrl);
          if (updated) {
            console.log(`  ✅ Fixed with fresh image!`);
            fixedCount++;
            failedCount--;
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
  
  console.log(`\n\n🎯 RESULTS:`);
  console.log(`✅ Fixed: ${fixedCount} images`);
  console.log(`❌ Failed: ${failedCount} images`);
  
  if (fixedCount > 0) {
    console.log(`\n✅ Successfully fixed ${fixedCount} broken BaT images!`);
  }
  
  if (failedCount > 0) {
    console.log(`\n⚠️  ${failedCount} images could not be fixed. They may have been removed from BaT.`);
  }
}

main().catch(console.error);

