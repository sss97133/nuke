/**
 * DOWNLOAD ALL BAT IMAGES - FAST VERSION
 * Uses the listing URLs we already scraped from the member page
 * Downloads images for vehicles that need them
 */

import { chromium } from 'playwright';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const VIVA_ORG_ID = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf';
const VIVA_USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';

console.log('📸 DOWNLOADING ALL BAT IMAGES (FAST)...\n');

// Get all 55 BaT listing URLs
async function getAllBATListings() {
  console.log(`📡 Loading BaT member page...`);
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('https://bringatrailer.com/member/vivalasvegasautos/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);
  
  // Click "Show more" until all listings loaded
  let clicks = 0;
  while (clicks < 30) {
    try {
      const btn = page.locator('button:has-text("Show more")').first();
      const isDisabled = await btn.evaluate(b => b.disabled);
      if (isDisabled) break;
      
      await btn.click();
      clicks++;
      await page.waitForTimeout(1000);
    } catch {
      break;
    }
  }
  
  // Extract all listing URLs
  const urls = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/listing/"]'));
    const seen = new Set();
    links.forEach(a => {
      const href = a.href;
      if (href && href.includes('/listing/')) {
        seen.add(href);
      }
    });
    return Array.from(seen);
  });
  
  await browser.close();
  
  console.log(`✅ Found ${urls.length} BaT listings\n`);
  return urls;
}

async function downloadImagesForListing(batUrl) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto(batUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    
    // Extract title to match to vehicle
    const title = await page.title();
    const titleMatch = title.match(/^(\d{4})\s+(\w+)\s+([^-]+)/);
    if (!titleMatch) {
      await browser.close();
      return { error: 'Could not parse title' };
    }
    
    const [_, year, make, model] = titleMatch;
    
    // Find matching vehicle
    const { data: vehicles } = await supabase
      .from('organization_vehicles')
      .select('vehicle_id, vehicles!inner(id, year, make, model)')
      .eq('organization_id', VIVA_ORG_ID)
      .eq('vehicles.year', parseInt(year))
      .ilike('vehicles.make', `%${make}%`)
      .limit(5);
    
    if (!vehicles || vehicles.length === 0) {
      await browser.close();
      return { error: `No match for ${year} ${make} ${model}` };
    }
    
    // Check if vehicle already has images
    const vehicleId = vehicles[0].vehicle_id;
    const { count } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', vehicleId);
    
    if (count > 0) {
      await browser.close();
      return { skipped: true, reason: 'Already has images' };
    }
    
    // Extract all gallery images
    const imageUrls = await page.evaluate(() => {
      const images = [];
      const allImages = document.querySelectorAll('img');
      
      allImages.forEach(img => {
        const alt = img.alt || '';
        let src = img.src;
        
        if (alt.includes('Load larger image') && src && src.includes('wp-content/uploads')) {
          src = src.split('?')[0]; // Get full resolution
          if (!images.includes(src)) {
            images.push(src);
          }
        }
      });
      
      return images;
    });
    
    await browser.close();
    
    if (imageUrls.length === 0) {
      return { error: 'No images found on page' };
    }
    
    // Download and upload images
    let uploaded = 0;
    for (let i = 0; i < Math.min(imageUrls.length, 15); i++) {
      try {
        const imgUrl = imageUrls[i];
        const imgResponse = await fetch(imgUrl);
        if (!imgResponse.ok) continue;
        
        const arrayBuffer = await imgResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        const fileName = `bat_${Date.now()}_${i}.jpg`;
        const filePath = `vehicle-data/${vehicleId}/bat/${fileName}`;
        
        const { error: uploadError } = await supabase.storage
          .from('vehicle-data')
          .upload(filePath, buffer, {
            contentType: 'image/jpeg',
            upsert: false
          });
        
        if (uploadError) continue;
        
        const { data: urlData } = supabase.storage
          .from('vehicle-data')
          .getPublicUrl(filePath);
        
        await supabase
          .from('vehicle_images')
          .insert({
            vehicle_id: vehicleId,
            image_url: urlData.publicUrl,
            user_id: VIVA_USER_ID,
            storage_path: filePath,
            filename: fileName,
            mime_type: 'image/jpeg',
            file_size: buffer.length,
            category: 'bat_listing',
            is_primary: i === 0,
            metadata: {
              source: 'bat_scraper',
              bat_original_url: imgUrl,
              listing_url: batUrl,
              scrape_date: new Date().toISOString()
            }
          });
        
        uploaded++;
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        // Silent continue
      }
    }
    
    return { uploaded, vehicleId };
    
  } catch (error) {
    await browser.close();
    return { error: error.message };
  }
}

// Main
const listingURLs = await getAllBATListings();

let processed = 0;
let totalImages = 0;
let skipped = 0;
let errors = 0;

console.log(`🔄 Processing ${listingURLs.length} listings...\n`);

for (let i = 0; i < listingURLs.length; i++) {
  const url = listingURLs[i];
  const shortName = url.split('/listing/')[1]?.slice(0, 40) || url;
  
  process.stdout.write(`[${i + 1}/${listingURLs.length}] ${shortName}... `);
  
  try {
    const result = await downloadImagesForListing(url);
    
    if (result.error) {
      console.log(`❌ ${result.error}`);
      errors++;
    } else if (result.skipped) {
      console.log(`⏭️  ${result.reason}`);
      skipped++;
    } else if (result.uploaded) {
      console.log(`✅ ${result.uploaded} images`);
      totalImages += result.uploaded;
      processed++;
    }
    
    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 3000));
    
  } catch (error) {
    console.log(`❌ ${error.message}`);
    errors++;
  }
}

console.log(`\n\n🎯 FINAL RESULTS:`);
console.log(`─────────────────────────────────────`);
console.log(`Listings processed: ${processed}`);
console.log(`Total images downloaded: ${totalImages}`);
console.log(`Skipped (already have images): ${skipped}`);
console.log(`Errors: ${errors}`);
console.log(`\n✅ BaT image download complete!`);

