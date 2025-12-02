#!/usr/bin/env node
/**
 * Direct KSL import - scrapes and imports listings
 * Uses direct fetch since edge function has issues
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { chromium } from 'playwright';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('❌ Error: SUPABASE key not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Known listing URLs - these are real listings we found earlier
const LISTING_URLS = [
  'https://cars.ksl.com/listing/10302276',
  'https://cars.ksl.com/listing/10323198',
  'https://cars.ksl.com/listing/10322827',
  'https://cars.ksl.com/listing/10322112',
  'https://cars.ksl.com/listing/10321970',
  'https://cars.ksl.com/listing/10321968',
  'https://cars.ksl.com/listing/10297247',
  'https://cars.ksl.com/listing/10321302',
  'https://cars.ksl.com/listing/10321283',
  'https://cars.ksl.com/listing/10269335',
  'https://cars.ksl.com/listing/10299803',
  'https://cars.ksl.com/listing/10320525',
  'https://cars.ksl.com/listing/10275450',
  'https://cars.ksl.com/listing/10319968',
  'https://cars.ksl.com/listing/10319820',
];

async function scrapeListingDirect(url) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);
    
    // Wait for page to load
    try {
      await page.waitForSelector('h1, [class*="title"], [data-testid*="title"]', { timeout: 10000 });
    } catch (e) {
      // Continue anyway
    }
    
    const data = await page.evaluate(() => {
      const result = {};
      
      // Title - try multiple selectors
      let titleEl = document.querySelector('h1');
      if (!titleEl) {
        titleEl = document.querySelector('[class*="title"]');
      }
      if (!titleEl) {
        titleEl = document.querySelector('[data-testid*="title"]');
      }
      if (!titleEl) {
        titleEl = document.querySelector('title');
      }
      result.title = titleEl?.textContent?.trim() || '';
      
      // If still no title, try to get from page title
      if (!result.title) {
        result.title = document.title?.replace(' - KSL Cars', '').trim() || '';
      }
      
      // Year/Make/Model from title
      const yearMatch = result.title.match(/\b(19|20)\d{2}\b/);
      if (yearMatch) {
        result.year = parseInt(yearMatch[0]);
      }
      
      const afterYear = result.title.replace(/\b(19|20)\d{2}\b/, '').trim();
      const parts = afterYear.split(/\s+/);
      if (parts.length >= 2) {
        result.make = parts[0];
        result.model = parts.slice(1, 3).join(' ');
      }
      
      // Body text for extraction
      const bodyText = document.body?.textContent || '';
      
      // Price
      const priceMatch = bodyText.match(/\$([\d,]+)/);
      if (priceMatch) {
        result.asking_price = parseInt(priceMatch[1].replace(/,/g, ''));
      }
      
      // VIN
      const vinMatch = bodyText.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
      if (vinMatch && !/[IOQ]/.test(vinMatch[1])) {
        result.vin = vinMatch[1].toUpperCase();
      }
      
      // Mileage
      const mileageMatch = bodyText.match(/(\d{1,3}(?:,\d{3})*)\s*(?:miles|mi)/i);
      if (mileageMatch) {
        result.mileage = parseInt(mileageMatch[1].replace(/,/g, ''));
      }
      
      // Description
      const descEl = document.querySelector('.description, [class*="description"]');
      result.description = descEl?.textContent?.trim().substring(0, 5000) || '';
      
      // Images
      result.images = [];
      const imgs = document.querySelectorAll('img[src*="ksl"], img[data-src*="ksl"]');
      imgs.forEach(img => {
        const src = img.getAttribute('src') || img.getAttribute('data-src');
        if (src && !src.includes('logo') && !src.includes('icon')) {
          result.images.push(src);
        }
      });
      result.images = result.images.slice(0, 20);
      
      return result;
    });
    
    await browser.close();
    return data;
    
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function findOrCreateVehicle(listingData, url) {
  // Check if exists
  const { data: existing } = await supabase
    .from('vehicles')
    .select('id')
    .eq('discovery_url', url)
    .maybeSingle();
  
  if (existing) {
    return { id: existing.id, created: false };
  }
  
  // Extract vehicle info
  let year = listingData.year;
  let make = listingData.make;
  let model = listingData.model;
  
  if (!year || !make || !model) {
    const title = listingData.title || '';
    const yearMatch = title.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      year = parseInt(yearMatch[0]);
    }
    
    const afterYear = title.replace(/\b(19|20)\d{2}\b/, '').trim();
    const parts = afterYear.split(/\s+/);
    if (parts.length >= 2) {
      make = parts[0];
      model = parts.slice(1, 3).join(' ');
    }
  }
  
  if (!year || !make || !model) {
    return { id: null, created: false, error: 'Could not extract vehicle info' };
  }
  
  // Create vehicle
  const { data: newVehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .insert({
      year,
      make: make.toLowerCase(),
      model: model.toLowerCase(),
      vin: listingData.vin || null,
      mileage: listingData.mileage || null,
      asking_price: listingData.asking_price || null,
      profile_origin: 'ksl_import',
      discovery_source: 'ksl_automated_import',
      discovery_url: url,
      origin_metadata: {
        ksl_listing_title: listingData.title,
        scraped_at: new Date().toISOString()
      },
      is_public: true,
      status: 'active',
      description: listingData.description || null
    })
    .select('id')
    .single();
  
  if (vehicleError) {
    return { id: null, created: false, error: vehicleError.message };
  }
  
  return { id: newVehicle.id, created: true };
}

async function main() {
  const maxListings = parseInt(process.argv[2]) || 20;
  const listings = LISTING_URLS.slice(0, maxListings);
  
  console.log('🚀 KSL Direct Import\n');
  console.log(`📋 Processing ${listings.length} listings...\n`);
  
  let imported = 0;
  let skipped = 0;
  let errors = 0;
  
  // Process in batches of 3
  const batchSize = 3;
  for (let i = 0; i < listings.length; i += batchSize) {
    const batch = listings.slice(i, i + batchSize);
    
    console.log(`\nProcessing batch ${Math.floor(i / batchSize) + 1}...`);
    
    for (const url of batch) {
      const idx = i + batch.indexOf(url) + 1;
      console.log(`\n[${idx}/${listings.length}] ${url}`);
      
      try {
        // Scrape
        const listingData = await scrapeListingDirect(url);
        
        if (!listingData.title) {
          console.log(`   ⚠️  No title found`);
          errors++;
          continue;
        }
        
        console.log(`   📊 ${listingData.title}`);
        console.log(`      ${listingData.year || '?'} ${listingData.make || '?'} ${listingData.model || '?'}`);
        
        // Import
        const result = await findOrCreateVehicle(listingData, url);
        
        if (result.error) {
          console.log(`   ❌ Error: ${result.error}`);
          errors++;
        } else if (result.created) {
          console.log(`   ✅ Created: ${result.id}`);
          imported++;
        } else {
          console.log(`   ⏭️  Already exists: ${result.id}`);
          skipped++;
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1500));
        
      } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
        errors++;
      }
    }
    
    // Longer delay between batches
    if (i + batchSize < listings.length) {
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Successfully imported: ${imported} vehicles`);
  console.log(`⏭️  Skipped (already exists): ${skipped}`);
  console.log(`❌ Errors: ${errors}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(console.error);

