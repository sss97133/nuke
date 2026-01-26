/**
 * PARALLEL BAT IMAGE DOWNLOADER
 * Fast batch download of all BaT images for Viva vehicles
 */

import { chromium } from 'playwright';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const VIVA_USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';

// Hardcoded URLs from the scraper
const BAT_URLS = [
  'https://bringatrailer.com/listing/1987-gmc-suburban-13/',
  'https://bringatrailer.com/listing/1993-chevrolet-corvette-zr-1-41/',
  'https://bringatrailer.com/listing/1978-chevrolet-k20-pickup-9/',
  'https://bringatrailer.com/listing/2023-speed-utv-el-jefe-2/',
  'https://bringatrailer.com/listing/2023-winnebago-sprinter-rv-conversion-4/',
  'https://bringatrailer.com/listing/2019-thor-motor-coach-hurricane-29m/',
  'https://bringatrailer.com/listing/2023-speed-utv-el-jefe/',
  'https://bringatrailer.com/listing/1958-citroen-2cv-4/',
  'https://bringatrailer.com/listing/2010-bmw-135i-convertible-2/',
  'https://bringatrailer.com/listing/1985-chevrolet-suburban-11/',
  'https://bringatrailer.com/listing/1965-chevrolet-impala-ss-41/',
  'https://bringatrailer.com/listing/2004-ford-f-350-26/',
  'https://bringatrailer.com/listing/2023-speed-utv-el-jefe-le/',
  'https://bringatrailer.com/listing/1984-citroen-2cv6/',
  'https://bringatrailer.com/listing/1970-ford-ranchero-18/',
  'https://bringatrailer.com/listing/2023-ford-f-150-raptor-71/',
  'https://bringatrailer.com/listing/2023-ford-f-150-raptor-70/',
  'https://bringatrailer.com/listing/2023-ford-f-150-raptor-69/',
  'https://bringatrailer.com/listing/1980-chevrolet-k30-pickup-2-2/',
  'https://bringatrailer.com/listing/2022-ford-f-150-raptor-36/',
  'https://bringatrailer.com/listing/2001-gmc-yukon-xl-11/',
  'https://bringatrailer.com/listing/1983-mercedes-benz-240d-74/',
  'https://bringatrailer.com/listing/1976-chevrolet-c20-pickup-5/',
  'https://bringatrailer.com/listing/1932-ford-highboy-5/',
  'https://bringatrailer.com/listing/2003-mercedes-benz-s55-amg-28/',
  'https://bringatrailer.com/listing/1980-chevrolet-k30-pickup-2/',
  'https://bringatrailer.com/listing/1972-chevrolet-k10-pickup-6/',
  'https://bringatrailer.com/listing/1966-chevrolet-c10-pickup-105/',
  'https://bringatrailer.com/listing/1988-jeep-wrangler-32/',
  'https://bringatrailer.com/listing/1968-porsche-911-35/',
  'https://bringatrailer.com/listing/1946-mercury-eight-6/',
  'https://bringatrailer.com/listing/1979-gmc-k1500/',
  'https://bringatrailer.com/listing/2008-bentley-continental-gtc-27/',
  'https://bringatrailer.com/listing/2001-gmc-yukon-xl-2/',
  'https://bringatrailer.com/listing/1989-cadillac-eldorado-biarritz-6/',
  'https://bringatrailer.com/listing/2021-ford-mustang-shelby-gt500-48/',
  'https://bringatrailer.com/listing/1996-gmc-suburban-slt-2500-4x4-7/',
  'https://bringatrailer.com/listing/1999-chevrolet-suburban-55/',
  'https://bringatrailer.com/listing/no-reserve-1995-ford-f-150-xlt-supercab-4x4-5-8l/',
  'https://bringatrailer.com/listing/2020-subaru-wrx-sti-15/',
  'https://bringatrailer.com/listing/1991-ford-f-350-5/',
  'https://bringatrailer.com/listing/1999-porsche-911-carrera-cabriolet-49/',
  'https://bringatrailer.com/listing/2008-lamborghini-gallardo-36/',
  'https://bringatrailer.com/listing/1989-chrysler-tc-18/',
  'https://bringatrailer.com/listing/1987-gmc-suburban-3/',
  'https://bringatrailer.com/listing/1977-ford-f-150-ranger-17/',
  'https://bringatrailer.com/listing/1985-subaru-brat-2/',
  'https://bringatrailer.com/listing/1964-chevrolet-corvette-16/',
  'https://bringatrailer.com/listing/1982-chrysler-le-baron-2/',
  'https://bringatrailer.com/listing/2005-bmw-m3-convertible-18/',
  'https://bringatrailer.com/listing/1983-porsche-911sc-targa-11/',
  'https://bringatrailer.com/listing/1984-mercedes-benz-380sl-11/',
  'https://bringatrailer.com/listing/1986-jeep-grand-wagoneer-2/',
  'https://bringatrailer.com/listing/1985-pontiac-fiero-gt/',
  'https://bringatrailer.com/listing/1966-ford-mustang-fastback-gt350r-gt350r2-tribute/'
];

async function downloadImagesForURL(batUrl, vehicleIdHint = null) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    // Extract year/make/model from URL for matching
    const urlParts = batUrl.split('/listing/')[1].split('/')[0];
    const match = urlParts.match(/^(\d{4})-([a-z-]+)-(.+?)(-\d+)?$/);
    
    if (!match) {
      await browser.close();
      return { error: 'Could not parse URL' };
    }
    
    const [_, yearStr, makeSlug, modelSlug] = match;
    const year = parseInt(yearStr);
    const make = makeSlug.replace(/-/g, ' ');
    const model = modelSlug.replace(/-/g, ' ');
    
    // Find matching vehicle in database
    const { data: ovs } = await supabase
      .from('organization_vehicles')
      .select('vehicle_id, vehicles!inner(id, year, make, model, vin)')
      .eq('organization_id', 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf')
      .eq('vehicles.year', year)
      .limit(20);
    
    if (!ovs || ovs.length === 0) {
      await browser.close();
      return { error: `No vehicle for ${year}` };
    }
    
    // Fuzzy match on make/model
    const vehicle = ovs.find(v => {
      const vMake = v.vehicles.make.toLowerCase();
      const vModel = v.vehicles.model.toLowerCase();
      return vMake.includes(make.split(' ')[0]) || make.split(' ')[0].includes(vMake);
    }) || ovs[0];
    
    const vehicleId = vehicle.vehicle_id;
    
    // Check if already has images
    const { count } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', vehicleId);
    
    if (count > 0) {
      await browser.close();
      return { skipped: true, vehicleId };
    }
    
    // Load page and extract images
    await page.goto(batUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1500);
    
    const imageUrls = await page.evaluate(() => {
      const images = [];
      const allImages = document.querySelectorAll('img');
      
      allImages.forEach(img => {
        const alt = img.alt || '';
        let src = img.src;
        
        if (alt.includes('Load larger image') && src && src.includes('wp-content/uploads')) {
          src = src.split('?')[0];
          if (!images.includes(src)) {
            images.push(src);
          }
        }
      });
      
      return images;
    });
    
    await browser.close();
    
    if (imageUrls.length === 0) {
      return { error: 'No images', vehicleId };
    }
    
    // Download images (limit to 10 for speed)
    let uploaded = 0;
    for (let i = 0; i < Math.min(imageUrls.length, 10); i++) {
      try {
        const imgUrl = imageUrls[i];
        const imgResponse = await fetch(imgUrl);
        if (!imgResponse.ok) continue;
        
        const arrayBuffer = await imgResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        const fileName = `bat_${i}.jpg`;
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
              listing_url: batUrl
            }
          });
        
        uploaded++;
        
      } catch (error) {
        // Continue
      }
    }
    
    return { uploaded, vehicleId };
    
  } catch (error) {
    try { await browser.close(); } catch {}
    return { error: error.message };
  }
}

// Process in batches of 3 parallel
async function processBatch(urls) {
  const results = await Promise.allSettled(
    urls.map(url => downloadImagesForURL(url))
  );
  
  return results.map((r, i) => ({
    url: urls[i],
    result: r.status === 'fulfilled' ? r.value : { error: r.reason?.message || 'Failed' }
  }));
}

// Main
console.log(`🔄 Processing ${BAT_URLS.length} BaT listings in parallel batches...\n`);

let processed = 0;
let totalImages = 0;
let skipped = 0;
let errors = 0;

const BATCH_SIZE = 3;
for (let i = 0; i < BAT_URLS.length; i += BATCH_SIZE) {
  const batch = BAT_URLS.slice(i, i + BATCH_SIZE);
  console.log(`\n📦 Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(BAT_URLS.length / BATCH_SIZE)}:`);
  
  const results = await processBatch(batch);
  
  results.forEach(({ url, result }) => {
    const shortName = url.split('/listing/')[1].slice(0, 35);
    
    if (result.error) {
      console.log(`  ❌ ${shortName}: ${result.error}`);
      errors++;
    } else if (result.skipped) {
      console.log(`  ⏭️  ${shortName}: Already has images`);
      skipped++;
    } else if (result.uploaded) {
      console.log(`  ✅ ${shortName}: ${result.uploaded} images`);
      totalImages += result.uploaded;
      processed++;
    }
  });
  
  // Small delay between batches
  await new Promise(resolve => setTimeout(resolve, 2000));
}

console.log(`\n\n🎯 FINAL RESULTS:`);
console.log(`─────────────────────────────────────`);
console.log(`Vehicles with new images: ${processed}`);
console.log(`Total images downloaded: ${totalImages}`);
console.log(`Skipped (already have images): ${skipped}`);
console.log(`Errors: ${errors}`);
console.log(`\n✅ Complete!`);

