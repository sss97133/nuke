/**
 * COMPLETE BAT IMPORT: Vehicles + Images
 * 1. Scrapes all 55+ listings from VIVA member page
 * 2. Creates vehicle record for each
 * 3. Downloads all images from each listing
 */

import { chromium } from 'playwright';

const VIVA_MEMBER_URL = 'https://bringatrailer.com/member/vivalasvegasautos/';
const VIVA_ORG_ID = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf';
const VIVA_USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

console.log('🚀 COMPLETE BAT IMPORT STARTING...\n');

// Step 1: Get all listing URLs
async function getAllListingURLs() {
  console.log('📡 Step 1: Scraping member page for all listings...');
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto(VIVA_MEMBER_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);
  
  // Click "Show more" repeatedly
  let clicks = 0;
  while (clicks < 30) {
    try {
      const btn = page.locator('button:has-text("Show more")').first();
      const disabled = await btn.evaluate(b => b.disabled);
      if (disabled) break;
      
      await btn.click();
      clicks++;
      await page.waitForTimeout(1500);
    } catch {
      break;
    }
  }
  
  console.log(`  Clicked "Show more" ${clicks} times`);
  
  // Extract URLs
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

// Step 2: Import listing via Edge Function
async function importListing(url) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/import-bat-listing`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': ANON_KEY
    },
    body: JSON.stringify({
      bat_url: url,
      organization_id: VIVA_ORG_ID
    })
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Import failed: ${text}`);
  }
  
  return await response.json();
}

// Step 3: Download images for a listing
async function downloadImages(batUrl, vehicleId) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto(batUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  
  // Extract image URLs
  const imageUrls = await page.evaluate(() => {
    const images = [];
    document.querySelectorAll('img').forEach(img => {
      const alt = img.alt || '';
      let src = img.src;
      
      if (alt.includes('Load larger image') && src && src.includes('wp-content/uploads')) {
        src = src.split('?')[0]; // Full resolution
        if (!images.includes(src)) {
          images.push(src);
        }
      }
    });
    return images;
  });
  
  await browser.close();
  
  if (imageUrls.length === 0) {
    throw new Error('No images found');
  }
  
  // Download and upload each image
  let uploaded = 0;
  for (let i = 0; i < Math.min(imageUrls.length, 20); i++) {
    try {
      const imgUrl = imageUrls[i];
      const imgResponse = await fetch(imgUrl);
      if (!imgResponse.ok) continue;
      
      const arrayBuffer = await imgResponse.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      const fileName = `bat_${Date.now()}_${i}.jpg`;
      const filePath = `vehicles/${vehicleId}/bat/${fileName}`;
      
      // Upload to Supabase Storage
      const uploadResponse = await fetch(`${SUPABASE_URL}/storage/v1/object/vehicle-data/${filePath}`, {
        method: 'POST',
        headers: {
          'apikey': ANON_KEY,
          'authorization': `Bearer ${ANON_KEY}`,
          'Content-Type': 'image/jpeg'
        },
        body: buffer
      });
      
      if (!uploadResponse.ok) continue;
      
      // Create image record
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/vehicle-data/${filePath}`;
      
      await fetch(`${SUPABASE_URL}/rest/v1/vehicle_images`, {
        method: 'POST',
        headers: {
          'apikey': ANON_KEY,
          'authorization': `Bearer ${ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          vehicle_id: vehicleId,
          image_url: publicUrl,
          user_id: VIVA_USER_ID,
          storage_path: filePath,
          filename: fileName,
          mime_type: 'image/jpeg',
          file_size: buffer.length,
          category: 'bat_listing',
          is_primary: i === 0,
          source: 'bat_listing',
          source_url: imgUrl
        })
      });
      
      uploaded++;
      await new Promise(r => setTimeout(r, 200));
    } catch {}
  }
  
  return uploaded;
}

// Main execution
const listingURLs = await getAllListingURLs();

let created = 0;
let updated = 0;
let imagesDownloaded = 0;
let errors = 0;

console.log('📦 Step 2: Importing vehicles and downloading images...\n');

for (let i = 0; i < listingURLs.length; i++) {
  const url = listingURLs[i];
  const shortName = url.split('/listing/')[1]?.slice(0, 40) || url;
  
  process.stdout.write(`[${i + 1}/${listingURLs.length}] ${shortName}... `);
  
  try {
    // Import vehicle
    const importResult = await importListing(url);
    const vehicleId = importResult.vehicleId || importResult.vehicle_id;
    
    if (!vehicleId) {
      console.log('❌ No vehicle ID returned');
      errors++;
      continue;
    }
    
    if (importResult.created) created++;
    else updated++;
    
    // Download images
    const imageCount = await downloadImages(url, vehicleId);
    imagesDownloaded += imageCount;
    
    console.log(`✅ ${imageCount} images`);
    
    // Rate limit
    await new Promise(r => setTimeout(r, 3000));
    
  } catch (error) {
    console.log(`❌ ${error.message}`);
    errors++;
  }
}

console.log(`\n\n🎯 FINAL RESULTS:`);
console.log(`─────────────────────────────────`);
console.log(`Vehicles created: ${created}`);
console.log(`Vehicles updated: ${updated}`);
console.log(`Total images downloaded: ${imagesDownloaded}`);
console.log(`Errors: ${errors}`);
console.log(`\n✅ Complete!`);

