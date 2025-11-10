/**
 * DOWNLOAD BAT IMAGES FOR ALL VIVA VEHICLES
 * Scrapes BaT listing pages and downloads gallery images
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

console.log('📸 DOWNLOADING BAT IMAGES FOR VIVA VEHICLES...\n');

async function getVehiclesNeedingImages() {
  const { data: vehicles, error } = await supabase
    .from('organization_vehicles')
    .select(`
      id,
      vehicle_id,
      vehicles!inner(
        id,
        year,
        make,
        model,
        sale_price,
        sale_date
      )
    `)
    .eq('organization_id', VIVA_ORG_ID);

  if (error) throw error;

  // Check which ones need images
  const needImages = [];
  for (const v of vehicles || []) {
    const { count } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', v.vehicle_id);

    if (count === 0) {
      needImages.push(v);
    }
  }

  return needImages;
}

async function findBATUrl(vehicle) {
  // Search BaT for the vehicle
  const searchTerm = `${vehicle.vehicles.year} ${vehicle.vehicles.make} ${vehicle.vehicles.model}`.toLowerCase();
  const batSearchUrl = `https://bringatrailer.com/member/vivalasvegasautos/`;
  
  // Return a constructed URL based on common patterns
  // This is a best-guess approach - we'll validate in the scraping step
  const slug = `${vehicle.vehicles.year}-${vehicle.vehicles.make.toLowerCase()}-${vehicle.vehicles.model.toLowerCase().replace(/\s+/g, '-')}`;
  return `https://bringatrailer.com/listing/${slug}/`;
}

async function scrapeBATImages(batUrl, vehicleId) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto(batUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000); // Let images load
    
    // Extract all gallery images
    const imageUrls = await page.evaluate(() => {
      const images = [];
      
      // BaT gallery thumbnails have "Load larger image" in alt text
      const allImages = document.querySelectorAll('img');
      
      allImages.forEach(img => {
        const alt = img.alt || '';
        let src = img.src;
        
        // Filter for gallery images
        if (alt.includes('Load larger image') && src && src.includes('wp-content/uploads')) {
          // Remove resize parameters to get full resolution
          src = src.split('?')[0]; // Strip all query params
          if (!images.includes(src)) {
            images.push(src);
          }
        }
      });
      
      return images;
    });
    
    await browser.close();
    
    if (imageUrls.length === 0) {
      console.log(`  ⚠️  No images found`);
      return 0;
    }
    
    console.log(`  📸 Found ${imageUrls.length} images`);
    
    // Download and upload each image
    let uploaded = 0;
    for (let i = 0; i < Math.min(imageUrls.length, 20); i++) { // Limit to 20 images per vehicle
      const imgUrl = imageUrls[i];
      
      try {
        // Download image
        const imgResponse = await fetch(imgUrl);
        if (!imgResponse.ok) continue;
        
        const arrayBuffer = await imgResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        // Upload to Supabase storage
        const fileName = `bat_${Date.now()}_${i}.jpg`;
        const filePath = `vehicle-data/${vehicleId}/bat_${fileName}`;
        
        const { error: uploadError } = await supabase.storage
          .from('vehicle-data')
          .upload(filePath, buffer, {
            contentType: 'image/jpeg',
            upsert: false
          });
        
        if (uploadError) {
          console.error(`    ❌ Upload error: ${uploadError.message}`);
          continue;
        }
        
        // Get public URL
        const { data: urlData } = supabase.storage
          .from('vehicle-data')
          .getPublicUrl(filePath);
        
        // Create image record
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
            is_primary: i === 0, // First image is primary
            metadata: {
              source: 'bat_scraper',
              bat_url: imgUrl,
              original_listing: batUrl,
              scrape_date: new Date().toISOString()
            }
          });
        
        uploaded++;
        
        // Rate limit
        await new Promise(resolve => setTimeout(resolve, 300));
        
      } catch (error) {
        console.error(`    ❌ Image ${i + 1} error:`, error.message);
      }
    }
    
    return uploaded;
    
  } catch (error) {
    console.error(`  ❌ Scrape error:`, error.message);
    await browser.close();
    return 0;
  }
}

// Main execution
const vehicles = await getVehiclesNeedingImages();

console.log(`🚗 Found ${vehicles.length} vehicles without images\n`);

let processed = 0;
let totalImages = 0;
let errors = 0;

for (const vehicle of vehicles) {
  const v = vehicle.vehicles;
  const displayName = `${v.year} ${v.make} ${v.model}`;
  
  process.stdout.write(`[${processed + 1}/${vehicles.length}] ${displayName}... `);
  
  try {
    // Try to find BaT URL
    const batUrl = await findBATUrl(vehicle);
    
    // Attempt to scrape images
    const imageCount = await scrapeBATImages(batUrl, vehicle.vehicle_id);
    
    if (imageCount > 0) {
      console.log(`✅ Downloaded ${imageCount} images`);
      totalImages += imageCount;
    } else {
      console.log(`⚠️  No images downloaded`);
    }
    
    processed++;
    
    // Rate limit between vehicles
    await new Promise(resolve => setTimeout(resolve, 2000));
    
  } catch (error) {
    console.log(`❌ ${error.message}`);
    errors++;
  }
}

console.log(`\n\n🎯 FINAL RESULTS:`);
console.log(`─────────────────────────────────────`);
console.log(`Vehicles processed: ${processed}`);
console.log(`Total images downloaded: ${totalImages}`);
console.log(`Errors: ${errors}`);
console.log(`\n✅ BaT image download complete!`);
