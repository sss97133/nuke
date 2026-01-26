/**
 * FIX ALL BROKEN BAT IMAGES
 * Finds and fixes all broken BaT images across all vehicles
 * Downloads images from BaT listings and saves them to Supabase storage
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

const DEFAULT_USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';

async function scrapeBATImages(batUrl) {
  console.log(`  📡 Scraping images from BaT listing...`);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto(batUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    
    const imageUrls = await page.evaluate(() => {
      const images = [];
      const seen = new Set();
      
      // Strategy 1: Look for gallery images
      document.querySelectorAll('img, [data-src], [data-lazy-src], [data-full], picture source').forEach(el => {
        let src = el.src || 
                  el.getAttribute('src') ||
                  el.getAttribute('data-src') || 
                  el.getAttribute('data-lazy-src') || 
                  el.getAttribute('data-full') ||
                  el.getAttribute('srcset')?.split(' ')[0];
        
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
      
      // Strategy 2: Extract from HTML source
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
    console.log(`  ✅ Found ${imageUrls.length} images`);
    return imageUrls;
  } catch (error) {
    await browser.close();
    console.error(`  ❌ Error scraping: ${error.message}`);
    return [];
  }
}

async function downloadAndUploadImage(imageUrl, vehicleId, index, userId) {
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
    
    const ext = path.extname(imageUrl).split('?')[0] || '.jpg';
    const filename = `bat_${Date.now()}_${index}${ext}`;
    const storagePath = `vehicles/${vehicleId}/bat/${filename}`;
    
    // Try vehicle-images bucket first
    let { error: uploadError } = await supabase.storage
      .from('vehicle-images')
      .upload(storagePath, buffer, {
        contentType: response.headers.get('content-type') || 'image/jpeg',
        cacheControl: '3600',
        upsert: false
      });
    
    let publicUrl;
    if (uploadError) {
      // Try vehicle-data bucket
      const storagePath2 = `vehicles/${vehicleId}/bat/${filename}`;
      const { error: uploadError2 } = await supabase.storage
        .from('vehicle-data')
        .upload(storagePath2, buffer, {
          contentType: response.headers.get('content-type') || 'image/jpeg',
          cacheControl: '3600',
          upsert: false
        });
      
      if (uploadError2) throw uploadError2;
      
      const { data: { publicUrl: url } } = supabase.storage
        .from('vehicle-data')
        .getPublicUrl(storagePath2);
      publicUrl = url;
    } else {
      const { data: { publicUrl: url } } = supabase.storage
        .from('vehicle-images')
        .getPublicUrl(storagePath);
      publicUrl = url;
    }
    
    return publicUrl;
  } catch (error) {
    return null;
  }
}

async function updateImageRecord(imageId, newUrl, originalUrl, userId) {
  try {
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
        user_id: existing?.user_id || userId,
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
    return false;
  }
}

async function fixBrokenImagesForVehicle(vehicleId, vehicleInfo, brokenImages) {
  console.log(`\n🚗 ${vehicleInfo.year || ''} ${vehicleInfo.make || ''} ${vehicleInfo.model || ''}`);
  console.log(`   Vehicle ID: ${vehicleId}`);
  console.log(`   Broken images: ${brokenImages.length}`);
  
  const batUrl = vehicleInfo.bat_auction_url;
  if (!batUrl) {
    console.log(`   ⚠️  No BaT URL found, skipping`);
    return { fixed: 0, failed: brokenImages.length };
  }
  
  console.log(`   BaT URL: ${batUrl}`);
  
  // Try direct download first
  let fixedCount = 0;
  let failedCount = 0;
  const failedImages = [];
  
  for (let i = 0; i < brokenImages.length; i++) {
    const img = brokenImages[i];
    const originalUrl = img.image_url;
    
    process.stdout.write(`   [${i + 1}/${brokenImages.length}] Trying direct download...`);
    
    const newUrl = await downloadAndUploadImage(originalUrl, vehicleId, i, vehicleInfo.user_id || DEFAULT_USER_ID);
    
    if (newUrl) {
      const updated = await updateImageRecord(img.id, newUrl, originalUrl, vehicleInfo.user_id || DEFAULT_USER_ID);
      if (updated) {
        console.log(` ✅ Fixed`);
        fixedCount++;
      } else {
        console.log(` ❌ DB update failed`);
        failedCount++;
        failedImages.push(img);
      }
    } else {
      console.log(` ❌ Download failed`);
      failedCount++;
      failedImages.push(img);
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // If we have failures, scrape BaT for fresh images
  if (failedImages.length > 0) {
    console.log(`   🔄 ${failedImages.length} images failed. Scraping BaT for fresh images...`);
    
    const freshImageUrls = await scrapeBATImages(batUrl);
    
    if (freshImageUrls.length > 0) {
      console.log(`   📥 Found ${freshImageUrls.length} fresh images. Downloading...`);
      
      for (let i = 0; i < Math.min(failedImages.length, freshImageUrls.length); i++) {
        const failed = failedImages[i];
        const freshUrl = freshImageUrls[i];
        
        process.stdout.write(`   [${i + 1}/${failedImages.length}] Downloading fresh image...`);
        
        const newUrl = await downloadAndUploadImage(freshUrl, vehicleId, i, vehicleInfo.user_id || DEFAULT_USER_ID);
        
        if (newUrl) {
          const updated = await updateImageRecord(failed.id, newUrl, freshUrl, vehicleInfo.user_id || DEFAULT_USER_ID);
          if (updated) {
            console.log(` ✅ Fixed`);
            fixedCount++;
            failedCount--;
          } else {
            console.log(` ❌ DB update failed`);
          }
        } else {
          console.log(` ❌ Download failed`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
  
  return { fixed: fixedCount, failed: failedCount };
}

async function main() {
  console.log('🔍 Finding all broken BaT images...\n');
  
  // Find all broken BaT images - any image with BaT URL should be fixed
  const { data: brokenImages, error: fetchError } = await supabase
    .from('vehicle_images')
    .select(`
      id,
      vehicle_id,
      image_url,
      user_id,
      is_external,
      vehicles!inner(
        id,
        year,
        make,
        model,
        bat_auction_url,
        uploaded_by
      )
    `)
    .or('image_url.ilike.%bringatrailer.com%,source.eq.bat_listing_broken')
    .order('vehicle_id');
  
  if (fetchError) {
    console.error('❌ Error fetching broken images:', fetchError);
    return;
  }
  
  if (!brokenImages || brokenImages.length === 0) {
    console.log('✅ No broken BaT images found!');
    return;
  }
  
  console.log(`📸 Found ${brokenImages.length} broken images across all vehicles\n`);
  
  // Group by vehicle
  const vehicleGroups = new Map();
  brokenImages.forEach(img => {
    const vehicleId = img.vehicle_id;
    if (!vehicleGroups.has(vehicleId)) {
      vehicleGroups.set(vehicleId, {
        vehicle: img.vehicles,
        images: []
      });
    }
    vehicleGroups.get(vehicleId).images.push(img);
  });
  
  console.log(`🚗 ${vehicleGroups.size} vehicles need image fixes\n`);
  console.log('='.repeat(60));
  
  let totalFixed = 0;
  let totalFailed = 0;
  
  // Process each vehicle
  for (const [vehicleId, { vehicle, images }] of vehicleGroups) {
    const result = await fixBrokenImagesForVehicle(vehicleId, vehicle, images);
    totalFixed += result.fixed;
    totalFailed += result.failed;
    
    console.log(`   Result: ${result.fixed} fixed, ${result.failed} failed`);
    console.log('-'.repeat(60));
  }
  
  console.log('\n\n🎯 FINAL RESULTS:');
  console.log(`✅ Total fixed: ${totalFixed} images`);
  console.log(`❌ Total failed: ${totalFailed} images`);
  console.log(`🚗 Vehicles processed: ${vehicleGroups.size}`);
  
  if (totalFixed > 0) {
    console.log(`\n✅ Successfully fixed ${totalFixed} broken BaT images!`);
  }
  
  if (totalFailed > 0) {
    console.log(`\n⚠️  ${totalFailed} images could not be fixed. They may have been removed from BaT.`);
  }
}

main().catch(console.error);

