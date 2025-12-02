#!/usr/bin/env node
/**
 * Improved KSL search scraper - better selectors and error handling
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

async function scrapeSearchPage(searchUrl) {
  console.log('🚀 Scraping KSL search page...\n');
  console.log(`URL: ${searchUrl}\n`);

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
    console.log('   Navigating to search page...');
    await page.goto(searchUrl, { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 
    });
    
    // Wait for listings to load
    await page.waitForTimeout(5000);
    
    // Scroll to load more content
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(2000);
    
    // Extract listing URLs using multiple strategies
    const listingUrls = await page.evaluate(() => {
      const urls = new Set();
      
      // Strategy 1: Look for links with /listing/ in href
      const allLinks = document.querySelectorAll('a[href]');
      allLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (!href) return;
        
        // Normalize URL
        let fullUrl = href;
        if (href.startsWith('/')) {
          fullUrl = `https://cars.ksl.com${href}`;
        }
        
        // Check if it's a listing URL
        if (fullUrl.includes('cars.ksl.com') && fullUrl.includes('/listing/')) {
          // Extract just the base listing URL (remove query params and fragments)
          const cleanUrl = fullUrl.split('?')[0].split('#')[0];
          urls.add(cleanUrl);
        }
      });
      
      return Array.from(urls);
    });
    
    console.log(`\n📋 Found ${listingUrls.length} unique listing URLs\n`);
    
    // Take screenshot for debugging
    await page.screenshot({ path: 'ksl-search-debug.png', fullPage: true });
    console.log('   📸 Screenshot saved: ksl-search-debug.png');
    
    await browser.close();
    return listingUrls;
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    await page.screenshot({ path: 'ksl-search-error.png', fullPage: true });
    await browser.close();
    throw error;
  }
}

async function scrapeAndImportListing(url) {
  try {
    console.log(`   🔍 ${url}`);
    
    // Check if already exists
    const { data: existing } = await supabase
      .from('vehicles')
      .select('id')
      .eq('discovery_url', url)
      .maybeSingle();
    
    if (existing) {
      console.log(`      ⏭️  Already exists`);
      return { success: true, created: false, vehicleId: existing.id };
    }
    
    // Try using the scrape-vehicle function, but with better error handling
    const { data: listingData, error: scrapeError } = await supabase.functions.invoke('scrape-vehicle', {
      body: { url },
      timeout: 60000
    });
    
    if (scrapeError || !listingData) {
      console.log(`      ⚠️  Could not scrape: ${scrapeError?.message || 'No data'}`);
      return { success: false, error: scrapeError?.message || 'No data' };
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
      console.log(`      ⚠️  Could not extract vehicle info`);
      return { success: false, error: 'Could not extract vehicle info' };
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
      console.log(`      ❌ Error: ${vehicleError.message}`);
      return { success: false, error: vehicleError.message };
    }
    
    console.log(`      ✅ Created: ${newVehicle.id} (${year} ${make} ${model})`);
    return { success: true, created: true, vehicleId: newVehicle.id };
    
  } catch (error) {
    console.log(`      ❌ Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function main() {
  const searchUrl = process.argv[2] || 'https://cars.ksl.com/v2/search/make/Chevrolet/yearFrom/1970/yearTo/1991';
  const maxListings = parseInt(process.argv[3]) || 20;
  
  try {
    // Step 1: Scrape search page for listing URLs
    const listingUrls = await scrapeSearchPage(searchUrl);
    
    if (listingUrls.length === 0) {
      console.log('❌ No listings found on search page');
      console.log('   Check ksl-search-debug.png for what the page looks like');
      return;
    }
    
    // Limit to max listings
    const urlsToProcess = listingUrls.slice(0, maxListings);
    console.log(`\n📥 Processing ${urlsToProcess.length} listings...\n`);
    
    let imported = 0;
    let skipped = 0;
    let errors = 0;
    
    // Process in batches
    const batchSize = 5;
    for (let i = 0; i < urlsToProcess.length; i += batchSize) {
      const batch = urlsToProcess.slice(i, i + batchSize);
      console.log(`\nBatch ${Math.floor(i / batchSize) + 1}:`);
      
      const results = await Promise.all(
        batch.map(url => scrapeAndImportListing(url))
      );
      
      results.forEach(result => {
        if (result.success) {
          if (result.created) imported++;
          else skipped++;
        } else {
          errors++;
        }
      });
      
      // Rate limiting
      if (i + batchSize < urlsToProcess.length) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ Successfully imported: ${imported} vehicles`);
    console.log(`⏭️  Skipped (already exists): ${skipped}`);
    console.log(`❌ Errors: ${errors}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main().catch(console.error);

