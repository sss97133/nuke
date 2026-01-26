/**
 * QUICK BAT IMAGE SQL GENERATOR
 * Generates SQL INSERT statements for BaT images
 */

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const VIVA_USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';

// Specific URLs to process
const TARGETS = [
  { url: 'https://bringatrailer.com/listing/1988-jeep-wrangler-32/', vehicle_id: 'f7a10a48-4cd8-4ff9-9166-702367d1c859' },
  { url: 'https://bringatrailer.com/listing/1985-chevrolet-suburban-11/', vehicle_id: 'b5a0c58a-6915-499b-ba5d-63c42fb6a91f' },
  { url: 'https://bringatrailer.com/listing/1976-chevrolet-c20-pickup-5/', vehicle_id: '3f1791fe-4fe2-4994-b6fe-b137ffa57370' },
  { url: 'https://bringatrailer.com/listing/1979-gmc-k1500/', vehicle_id: '9f69eaaf-15ab-417d-bea1-80603a5b6372' }
];

const browser = await chromium.launch({ headless: true });

for (const target of TARGETS) {
  const page = await browser.newPage();
  
  try {
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1500);
    
    const imageUrls = await page.evaluate(() => {
      const images = [];
      document.querySelectorAll('img').forEach(img => {
        const alt = img.alt || '';
        const src = img.src;
        if (alt.includes('Load larger image') && src && src.includes('wp-content/uploads')) {
          images.push(src.split('?')[0]);
        }
      });
      return images.slice(0, 10);
    });
    
    if (imageUrls.length > 0) {
      // Insert directly
      const inserts = imageUrls.map((url, i) => ({
        vehicle_id: target.vehicle_id,
        image_url: url,
        user_id: VIVA_USER_ID,
        category: 'bat_listing',
        is_primary: i === 0
      }));
      
      const { error } = await supabase
        .from('vehicle_images')
        .insert(inserts);
      
      if (error) {
        console.log(`❌ ${target.url}: ${error.message}`);
      } else {
        console.log(`✅ ${target.url}: ${imageUrls.length} images linked`);
      }
    }
    
  } catch (error) {
    console.log(`❌ ${target.url}: ${error.message}`);
  }
  
  await page.close();
  await new Promise(r => setTimeout(r, 1000));
}

await browser.close();
console.log('\n✅ Done!');

