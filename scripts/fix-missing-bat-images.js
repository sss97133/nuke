/**
 * FIX MISSING BAT IMAGES
 * Download images for specific vehicles showing blanks on inventory page
 */

import { chromium } from 'playwright';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const VIVA_USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';

// Manual mapping of vehicles to their BaT URLs (from scraper results)
const VEHICLE_BAT_MAP = {
  'd7bc0005-6ddb-4e34-8e0d-4d529cfa45e5': 'https://bringatrailer.com/listing/2004-ford-f-350-26/', // 2004 Ford F350
  'f7a10a48-4cd8-4ff9-9166-702367d1c859': 'https://bringatrailer.com/listing/1988-jeep-wrangler-32/', // 1988 Jeep Wrangler
  '1ac8edba-4613-4dc3-a619-7b282e5737e8': null, // 1987 Nissan Maxima - NOT ON BAT
  'b5a0c58a-6915-499b-ba5d-63c42fb6a91f': 'https://bringatrailer.com/listing/1985-chevrolet-suburban-11/', // 1985 Suburban
  '07124fb6-d58e-48f5-8a1a-8b57b6d7ecb0': null, // 1980 Chevrolet - NOT ON BAT
  '9f69eaaf-15ab-417d-bea1-80603a5b6372': 'https://bringatrailer.com/listing/1979-gmc-k1500/', // 1979 GMC K15
  '5f6cc95c-9c1e-4a45-8371-40312c253abb': 'https://bringatrailer.com/listing/1978-chevrolet-k20-pickup-9/', // 1978 K20
  '3f1791fe-4fe2-4994-b6fe-b137ffa57370': 'https://bringatrailer.com/listing/1976-chevrolet-c20-pickup-5/', // 1976 Silverado
  '05b2cc98-cd4f-4fb6-a17e-038d6664905e': 'https://bringatrailer.com/listing/1972-chevrolet-k10-pickup-6/', // 1972 K10
  '50b9dca5-32af-4dec-8eb8-0956d6d0ac8c': null // 1971 C10 - NOT ON BAT
};

async function downloadBATImages(batUrl, vehicleId) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto(batUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1500);
    
    const imageUrls = await page.evaluate(() => {
      const images = [];
      document.querySelectorAll('img').forEach(img => {
        const alt = img.alt || '';
        const src = img.src;
        if (alt.includes('Load larger image') && src && src.includes('wp-content/uploads')) {
          const fullUrl = src.split('?')[0];
          if (!images.includes(fullUrl)) images.push(fullUrl);
        }
      });
      return images;
    });
    
    await browser.close();
    
    if (imageUrls.length === 0) return 0;
    
    // Download first 10 images
    let uploaded = 0;
    for (let i = 0; i < Math.min(imageUrls.length, 10); i++) {
      try {
        const imgResponse = await fetch(imageUrls[i]);
        if (!imgResponse.ok) continue;
        
        const buffer = Buffer.from(await imgResponse.arrayBuffer());
        const fileName = `bat_${i}.jpg`;
        const filePath = `vehicle-data/${vehicleId}/bat/${fileName}`;
        
        const { error } = await supabase.storage
          .from('vehicle-data')
          .upload(filePath, buffer, { contentType: 'image/jpeg', upsert: false });
        
        if (error) continue;
        
        const { data: urlData } = supabase.storage.from('vehicle-data').getPublicUrl(filePath);
        
        await supabase.from('vehicle_images').insert({
          vehicle_id: vehicleId,
          image_url: urlData.publicUrl,
          user_id: VIVA_USER_ID,
          storage_path: filePath,
          filename: fileName,
          mime_type: 'image/jpeg',
          file_size: buffer.length,
          category: 'bat_listing',
          is_primary: i === 0,
          metadata: { source: 'bat_scraper', bat_url: imageUrls[i], listing_url: batUrl }
        });
        
        uploaded++;
      } catch (e) {
        // Continue
      }
    }
    
    return uploaded;
    
  } catch (error) {
    try { await browser.close(); } catch {}
    return 0;
  }
}

// Process all vehicles
console.log('🔄 Processing vehicles with missing images...\n');

let processed = 0;
let totalImages = 0;

for (const [vehicleId, batUrl] of Object.entries(VEHICLE_BAT_MAP)) {
  if (!batUrl) {
    console.log(`⏭️  ${vehicleId.slice(0, 8)}: No BaT listing`);
    continue;
  }
  
  const shortUrl = batUrl.split('/listing/')[1].slice(0, 30);
  process.stdout.write(`${shortUrl}... `);
  
  const count = await downloadBATImages(batUrl, vehicleId);
  
  if (count > 0) {
    console.log(`✅ ${count} images`);
    totalImages += count;
    processed++;
  } else {
    console.log(`❌ Failed`);
  }
  
  await new Promise(r => setTimeout(r, 2000));
}

console.log(`\n✅ Downloaded ${totalImages} images for ${processed} vehicles`);

