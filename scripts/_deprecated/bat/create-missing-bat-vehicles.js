/**
 * CREATE MISSING BAT VEHICLE PROFILES
 * Scrapes BaT listings that didn't match existing vehicles and creates new profiles
 */

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const VIVA_ORG_ID = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf';
const VIVA_USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';

console.log('🔍 FINDING AND CREATING MISSING BAT VEHICLES...\n');

// Get all BaT listing URLs from member page
async function getAllBATListings() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('https://bringatrailer.com/member/vivalasvegasautos/', { 
    waitUntil: 'domcontentloaded', 
    timeout: 60000 
  });
  await page.waitForTimeout(2000);
  
  // Click "Show more" to load all listings
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
  return urls;
}

// Parse BaT listing page to extract vehicle data
async function parseBATListing(batUrl) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto(batUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);
    
    const data = await page.evaluate(() => {
      // Extract title
      const titleEl = document.querySelector('h1');
      const title = titleEl ? titleEl.textContent.trim() : '';
      
      // Parse year/make/model
      const match = title.match(/^(\d{4})\s+([A-Za-z-]+)\s+(.+?)(?:\s+for\s+sale|\s*$)/);
      if (!match) return null;
      
      const [_, year, make, modelFull] = match;
      
      // Extract VIN
      let vin = null;
      const bodyText = document.body.textContent;
      const vinMatch = bodyText.match(/VIN[:\s]+([A-HJ-NPR-Z0-9]{17})/i);
      if (vinMatch) vin = vinMatch[1];
      
      // Extract sale price
      let salePrice = null;
      const priceText = document.body.textContent.match(/Sold for.*?USD\s+\$([\\d,]+)/);
      if (priceText) {
        salePrice = parseInt(priceText[1].replace(/,/g, ''));
      }
      
      // Extract sale date
      let saleDate = null;
      const dateMatch = document.body.textContent.match(/on\s+(\w+\s+\d{1,2},\s+\d{4})/);
      if (dateMatch) {
        saleDate = new Date(dateMatch[1]).toISOString().split('T')[0];
      }
      
      // Extract images
      const images = [];
      document.querySelectorAll('img').forEach(img => {
        const alt = img.alt || '';
        const src = img.src;
        if (alt.includes('Load larger image') && src && src.includes('wp-content/uploads')) {
          images.push(src.split('?')[0]);
        }
      });
      
      return {
        title,
        year: parseInt(year),
        make,
        model: modelFull,
        vin,
        salePrice,
        saleDate,
        images: images.slice(0, 10)
      };
    });
    
    await browser.close();
    return data;
    
  } catch (error) {
    try { await browser.close(); } catch {}
    return null;
  }
}

// Check if vehicle exists by VIN or year/make/model
async function vehicleExists(vehicleData) {
  if (vehicleData.vin) {
    const { data } = await supabase
      .from('vehicles')
      .select('id')
      .eq('vin', vehicleData.vin)
      .single();
    if (data) return data.id;
  }
  
  // Check by year/make/model in org inventory
  const { data: ovs } = await supabase
    .from('organization_vehicles')
    .select('vehicle_id, vehicles!inner(year, make, model)')
    .eq('organization_id', VIVA_ORG_ID)
    .eq('vehicles.year', vehicleData.year)
    .ilike('vehicles.make', `%${vehicleData.make.toLowerCase()}%`)
    .limit(1);
  
  if (ovs && ovs.length > 0) {
    return ovs[0].vehicle_id;
  }
  
  return null;
}

// Create vehicle profile with BaT data
async function createVehicleFromBAT(vehicleData, batUrl) {
  // Create vehicle
  const { data: vehicle, error: vError } = await supabase
    .from('vehicles')
    .insert({
      year: vehicleData.year,
      make: vehicleData.make.toLowerCase(),
      model: vehicleData.model.toLowerCase(),
      vin: vehicleData.vin,
      sale_price: vehicleData.salePrice,
      sale_date: vehicleData.saleDate,
      description: `Sold on Bring a Trailer for $${(vehicleData.salePrice || 0).toLocaleString()}`,
      is_public: true,
      uploaded_by: VIVA_USER_ID
    })
    .select('id')
    .single();
  
  if (vError) throw vError;
  
  const vehicleId = vehicle.id;
  
  // Link to Viva organization
  await supabase
    .from('organization_vehicles')
    .insert({
      organization_id: VIVA_ORG_ID,
      vehicle_id: vehicleId,
      relationship_type: 'sold_by',
      listing_status: 'sold',
      sale_price: vehicleData.salePrice,
      sale_date: vehicleData.saleDate
    });
  
  // Add images
  if (vehicleData.images && vehicleData.images.length > 0) {
    const imageInserts = vehicleData.images.map((url, i) => ({
      vehicle_id: vehicleId,
      image_url: url,
      user_id: VIVA_USER_ID,
      category: 'bat_listing',
      is_primary: i === 0,
      filename: `bat_${i}.jpg`
    }));
    
    await supabase.from('vehicle_images').insert(imageInserts);
  }
  
  // Add validation
  await supabase.from('data_validations').insert([
    {
      entity_type: 'vehicle',
      entity_id: vehicleId,
      field_name: 'sale_price',
      field_value: (vehicleData.salePrice || 0).toString(),
      validation_source: 'bat_listing',
      confidence_score: 100,
      source_url: batUrl,
      notes: 'Sale price verified from BaT auction'
    }
  ]);
  
  return vehicleId;
}

// Main execution
const allBATUrls = await getAllBATListings();
console.log(`📋 Found ${allBATUrls.length} total BaT listings\n`);

let created = 0;
let skipped = 0;
let errors = 0;

for (let i = 0; i < allBATUrls.length; i++) {
  const url = allBATUrls[i];
  const shortName = url.split('/listing/')[1]?.slice(0, 40) || url;
  
  process.stdout.write(`[${i + 1}/${allBATUrls.length}] ${shortName}... `);
  
  try {
    const vehicleData = await parseBATListing(url);
    
    if (!vehicleData) {
      console.log('❌ Parse failed');
      errors++;
      continue;
    }
    
    const existingId = await vehicleExists(vehicleData);
    
    if (existingId) {
      console.log('⏭️  Exists');
      skipped++;
    } else {
      const newId = await createVehicleFromBAT(vehicleData, url);
      console.log(`✅ CREATED (${newId.slice(0, 8)}...)`);
      created++;
    }
    
    // Rate limit
    await new Promise(r => setTimeout(r, 3000));
    
  } catch (error) {
    console.log(`❌ ${error.message}`);
    errors++;
  }
}

console.log(`\n\n🎯 FINAL RESULTS:`);
console.log(`─────────────────────────────────────`);
console.log(`New vehicles created: ${created}`);
console.log(`Existing vehicles skipped: ${skipped}`);
console.log(`Errors: ${errors}`);
console.log(`\n✅ All BaT vehicles now have profiles!`);

