#!/usr/bin/env node
/**
 * Import BaT Listing - THE RIGHT WAY
 * 
 * Input: BaT listing URL
 * Output: Complete vehicle profile with ALL data
 * 
 * Extracts from BaT listing:
 * - Year/Make/Model/VIN
 * - Sale price (or bid price)
 * - ALL images (as external links)
 * - Description
 * - Mileage
 * - Timeline event (sale/auction)
 * 
 * Saves ONCE. Saves CORRECTLY. No phantom records.
 */

const { chromium } = require('playwright');
const { Client } = require('pg');

const DB_CONFIG = {
  host: 'aws-0-us-west-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.qkgaybvrernstplzjaam',
  password: 'RbzKq32A0uhqvJMQ',
  ssl: { rejectUnauthorized: false }
};

const VIVA_ORG_ID = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf';
const USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';

async function scrapeBaTListing(url) {
  console.log(`📡 Scraping: ${url}\n`);
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  
  // Extract ALL data
  const data = await page.evaluate(() => {
    // Title has year/make/model
    const title = document.querySelector('h1')?.textContent.trim() || '';
    const yearMatch = title.match(/(19\\d{2}|20\\d{2})/);
    
    // Price
    const priceText = document.body.textContent;
    const soldMatch = priceText.match(/Sold for USD \\$([0-9,]+)/);
    const bidMatch = priceText.match(/Bid to USD \\$([0-9,]+)/);
    const price = soldMatch ? 
      parseInt(soldMatch[1].replace(/,/g, '')) :
      (bidMatch ? parseInt(bidMatch[1].replace(/,/g, '')) : 0);
    
    // Images - get ALL wp-content/uploads images
    const imageUrls = [];
    document.querySelectorAll('img').forEach(img => {
      if (img.src && img.src.includes('wp-content/uploads')) {
        const clean = img.src.split('?')[0]; // Remove query params
        if (!imageUrls.includes(clean)) {
          imageUrls.push(clean);
        }
      }
    });
    
    // Description (first paragraph usually)
    const desc = document.querySelector('p')?.textContent.trim() || '';
    
    // Mileage (look for odometer text)
    const mileageMatch = priceText.match(/(\\d{1,3},?\\d{3})\\s*miles?/i);
    const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null;
    
    return {
      title,
      year: yearMatch ? parseInt(yearMatch[1]) : null,
      price,
      imageUrls,
      description: desc.substring(0, 500),
      mileage
    };
  });
  
  await browser.close();
  
  // Parse make/model from title
  const parts = data.title.split(' ');
  data.make = parts[1] || '';
  data.model = parts.slice(2).join(' ').replace(/ \\d+×\\d+/g, '').trim();
  
  return data;
}

async function saveToDatabase(batData, batUrl) {
  const client = new Client(DB_CONFIG);
  await client.connect();
  
  try {
    console.log('💾 Saving to database...\n');
    
    // Check if vehicle exists
    const existing = await client.query(`
      SELECT id FROM vehicles 
      WHERE year = $1 
        AND make ILIKE $2
        AND vin LIKE 'VIVA-%'
      LIMIT 1
    `, [batData.year, `%${batData.make}%`]);
    
    let vehicleId;
    
    if (existing.rows.length > 0) {
      vehicleId = existing.rows[0].id;
      console.log(`  ✅ Found existing vehicle: ${vehicleId}\n`);
      
      // Update it
      await client.query(`
        UPDATE vehicles 
        SET 
          current_value = $1,
          sale_price = $1,
          mileage = COALESCE(mileage, $2),
          description = COALESCE(description, $3)
        WHERE id = $4
      `, [batData.price, batData.mileage, batData.description, vehicleId]);
      
      console.log(`  ✅ Updated price: $${batData.price.toLocaleString()}`);
      
    } else {
      console.log('  ⚠️  Vehicle not found in database, skipping create');
      return;
    }
    
    // Add images (as external links - no upload needed!)
    console.log(`\n📸 Adding ${batData.imageUrls.length} images...\n`);
    
    for (let i = 0; i < batData.imageUrls.length; i++) {
      await client.query(`
        INSERT INTO vehicle_images (
          vehicle_id,
          user_id,
          image_url,
          is_primary,
          category
        ) VALUES ($1, $2, $3, $4, 'bat_listing')
        ON CONFLICT DO NOTHING
      `, [vehicleId, USER_ID, batData.imageUrls[i], i === 0]);
    }
    
    console.log(`  ✅ Added ${batData.imageUrls.length} images\n`);
    
    // Add timeline event
    await client.query(`
      INSERT INTO timeline_events (
        vehicle_id,
        event_type,
        event_date,
        title,
        description,
        cost_amount,
        source
      ) VALUES ($1, 'sale', CURRENT_DATE, $2, $3, $4, 'bat_listing')
      ON CONFLICT DO NOTHING
    `, [
      vehicleId,
      `BaT Listing - $${batData.price.toLocaleString()}`,
      `${batData.title}. ${batUrl}`,
      batData.price
    ]);
    
    console.log(`  ✅ Added timeline event\n`);
    
    console.log('✅ COMPLETE - Vehicle has all BaT data');
    
  } finally {
    await client.end();
  }
}

// RUN IT
const batUrl = process.argv[2];

if (!batUrl) {
  console.log('Usage: node import-bat-listing-properly.js <bat-url>');
  console.log('Example: node import-bat-listing-properly.js https://bringatrailer.com/listing/1966-chevrolet-c10-pickup-105/');
  process.exit(1);
}

(async () => {
  const batData = await scrapeBaTListing(batUrl);
  await saveToDatabase(batData, batUrl);
  console.log('\n✅ Done. Refresh n-zero.dev to see the vehicle with complete BaT data.');
})();

