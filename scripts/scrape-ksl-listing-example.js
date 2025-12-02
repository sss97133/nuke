#!/usr/bin/env node
/**
 * Scrape a specific KSL listing based on actual page structure
 * Example: https://cars.ksl.com/listing/10322112
 */

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('❌ Error: SUPABASE key not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function scrapeKSLListing(url) {
  console.log(`🔍 Scraping: ${url}\n`);

  const browser = await chromium.launch({ 
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 }
  });
  
  const page = await context.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    
    const data = await page.evaluate(() => {
      const result = {};
      
      // Title - from the main heading
      const titleEl = document.querySelector('h1, [class*="title"], [data-testid*="title"]');
      result.title = titleEl?.textContent?.trim() || document.title?.replace(' - KSL Cars', '').trim() || '';
      
      // Extract year/make/model from title
      if (result.title) {
        const yearMatch = result.title.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) {
          result.year = parseInt(yearMatch[0]);
        }
        
        const afterYear = result.title.replace(/\b(19|20)\d{2}\b/, '').trim();
        const parts = afterYear.split(/\s+/);
        if (parts.length >= 2) {
          result.make = parts[0];
          result.model = parts.slice(1).join(' ');
        }
      }
      
      // Price - look for price in various formats
      const bodyText = document.body?.textContent || '';
      const priceMatch = bodyText.match(/\$([\d,]+)/);
      if (priceMatch) {
        result.asking_price = parseInt(priceMatch[1].replace(/,/g, ''));
      }
      
      // Mileage - look for mileage patterns
      const mileageMatch = bodyText.match(/(\d{1,3}(?:,\d{3})*)\s*(?:miles|mi|mileage)/i);
      if (mileageMatch) {
        result.mileage = parseInt(mileageMatch[1].replace(/,/g, ''));
      }
      
      // VIN - 17 character alphanumeric
      const vinMatch = bodyText.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
      if (vinMatch && !/[IOQ]/.test(vinMatch[1])) {
        result.vin = vinMatch[1].toUpperCase();
      }
      
      // Location
      const locationMatch = bodyText.match(/([A-Za-z\s]+(?:,\s*[A-Z]{2})?)\s*•\s*\d+\s*(?:Day|Days|Hour|Hours)/);
      if (locationMatch) {
        result.location = locationMatch[1].trim();
      }
      
      // Description - look for description section
      const descSelectors = [
        '[class*="description"]',
        '[class*="details"]',
        '[id*="description"]',
        '.listing-description'
      ];
      
      for (const selector of descSelectors) {
        const descEl = document.querySelector(selector);
        if (descEl) {
          result.description = descEl.textContent?.trim().substring(0, 5000) || '';
          break;
        }
      }
      
      // Images - extract all vehicle images
      result.images = [];
      const imgElements = document.querySelectorAll('img');
      imgElements.forEach(img => {
        const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
        if (src && 
            (src.includes('ksl.com') || src.includes('img.ksl.com')) &&
            !src.includes('logo') && 
            !src.includes('icon') &&
            !src.includes('avatar')) {
          const fullUrl = src.startsWith('http') ? src : `https://cars.ksl.com${src}`;
          if (!result.images.includes(fullUrl)) {
            result.images.push(fullUrl);
          }
        }
      });
      
      // Get specifications from the page
      const specsText = bodyText;
      
      // Engine
      const engineMatch = specsText.match(/(\d+\.\d+L\s*(?:V\d+|\w+))/i);
      if (engineMatch) {
        result.engine = engineMatch[1];
      }
      
      // Body style
      const bodyMatch = specsText.match(/Body[:\s]+([A-Za-z\s]+)/i);
      if (bodyMatch) {
        result.body_style = bodyMatch[1].trim();
      }
      
      // Title type
      const titleMatch = specsText.match(/Title[:\s]+(Clean|Salvage|Rebuilt|Other)/i);
      if (titleMatch) {
        result.title_status = titleMatch[1];
      }
      
      return result;
    });
    
    await browser.close();
    
    console.log('📊 Scraped data:');
    console.log(JSON.stringify(data, null, 2));
    
    return data;
    
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function importVehicle(listingData, url) {
  // Check if already exists
  const { data: existing } = await supabase
    .from('vehicles')
    .select('id')
    .eq('discovery_url', url)
    .maybeSingle();
  
  if (existing) {
    console.log(`\n⏭️  Vehicle already exists: ${existing.id}`);
    return { id: existing.id, created: false };
  }
  
  // Check by VIN if available
  if (listingData.vin) {
    const { data: vinMatch } = await supabase
      .from('vehicles')
      .select('id')
      .eq('vin', listingData.vin)
      .maybeSingle();
    
    if (vinMatch) {
      console.log(`\n⏭️  Vehicle with VIN already exists: ${vinMatch.id}`);
      await supabase
        .from('vehicles')
        .update({ discovery_url: url })
        .eq('id', vinMatch.id);
      return { id: vinMatch.id, created: false };
    }
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
      model = parts.slice(1).join(' ');
    }
  }
  
  if (!year || !make || !model) {
    throw new Error('Could not extract year/make/model from listing');
  }
  
  console.log(`\n📝 Creating vehicle: ${year} ${make} ${model}`);
  
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
      body_style: listingData.body_style || null,
      engine_size: listingData.engine || null,
      profile_origin: 'ksl_import',
      discovery_source: 'ksl_automated_import',
      discovery_url: url,
      origin_metadata: {
        ksl_listing_title: listingData.title,
        ksl_location: listingData.location,
        scraped_at: new Date().toISOString()
      },
      is_public: true,
      status: 'active',
      description: listingData.description || null
    })
    .select('id')
    .single();
  
  if (vehicleError) {
    throw new Error(`Failed to create vehicle: ${vehicleError.message}`);
  }
  
  console.log(`✅ Created vehicle: ${newVehicle.id}`);
  
  // Import images if available
  if (listingData.images && listingData.images.length > 0) {
    console.log(`\n📸 Found ${listingData.images.length} images (not importing automatically - use image import tool)`);
  }
  
  return { id: newVehicle.id, created: true };
}

async function main() {
  const listingUrl = process.argv[2] || 'https://cars.ksl.com/listing/10322112';
  
  try {
    console.log('🚀 KSL Listing Scraper\n');
    
    // Scrape the listing
    const listingData = await scrapeKSLListing(listingUrl);
    
    // Import to database
    const result = await importVehicle(listingData, listingUrl);
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(result.created ? '✅ Successfully imported!' : '⏭️  Already exists');
    console.log(`Vehicle ID: ${result.id}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);

