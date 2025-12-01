#!/usr/bin/env node
/**
 * Scrape KSL listings in parallel and import to database
 * Designed to be called from admin UI or run directly
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

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
  try {
    // Use the existing scrape-vehicle edge function
    const { data, error } = await supabase.functions.invoke('scrape-vehicle', {
      body: { url }
    });
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error(`   ❌ Error scraping ${url}:`, error.message);
    return null;
  }
}

async function findOrCreateVehicle(listingData, kslUrl) {
  // Check if vehicle already exists by discovery_url
  const { data: existing } = await supabase
    .from('vehicles')
    .select('id')
    .eq('discovery_url', kslUrl)
    .maybeSingle();
  
  if (existing) {
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
      // Update discovery_url if not set
      await supabase
        .from('vehicles')
        .update({ discovery_url: kslUrl })
        .eq('id', vinMatch.id);
      return { id: vinMatch.id, created: false };
    }
  }
  
  // Extract year, make, model from title or listing data
  let year = listingData.year;
  let make = listingData.make;
  let model = listingData.model;
  
  if (!year || !make || !model) {
    // Try to parse from title
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
    return { id: null, created: false, error: 'Could not extract year/make/model' };
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
      color: listingData.color || null,
      asking_price: listingData.asking_price || null,
      profile_origin: 'ksl_import',
      discovery_source: 'ksl_automated_import',
      discovery_url: kslUrl,
      origin_metadata: {
        ksl_listing_title: listingData.title,
        ksl_listing_id: listingData.listingId,
        scraped_at: new Date().toISOString(),
        description: listingData.description?.substring(0, 1000) || null
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

async function scrapeKSLSearch(searchUrl, maxListings = 20) {
  console.log('🚀 Scraping KSL search results...\n');
  console.log(`URL: ${searchUrl}\n`);

  const browser = await chromium.launch({ 
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();
  
  try {
    console.log('   Navigating to search page...');
    await page.goto(searchUrl, { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 
    });
    await page.waitForTimeout(5000);
    
    // Extract listing URLs
    const listingUrls = await page.evaluate(() => {
      const urls = new Set();
      const links = document.querySelectorAll('a[href*="/listing/"]');
      
      links.forEach(link => {
        const href = link.getAttribute('href');
        if (!href) return;
        
        let fullUrl = href;
        if (href.startsWith('/')) {
          fullUrl = `https://cars.ksl.com${href}`;
        }
        
        if (fullUrl.includes('cars.ksl.com') && fullUrl.includes('/listing/')) {
          urls.add(fullUrl);
        }
      });
      
      return Array.from(urls).slice(0, 20);
    });
    
    console.log(`\n📋 Found ${listingUrls.length} unique listings\n`);
    
    await browser.close();
    return listingUrls;
    
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function main() {
  const searchUrl = process.argv[2] || 'https://cars.ksl.com/v2/search/make/Chevrolet/yearFrom/1970/yearTo/1991';
  const maxListings = parseInt(process.argv[3]) || 20;
  const importToDb = process.argv[4] !== 'false';
  
  try {
    // Step 1: Scrape search results
    const listingUrls = await scrapeKSLSearch(searchUrl, maxListings);
    
    if (listingUrls.length === 0) {
      console.log('❌ No listings found');
      return;
    }
    
    console.log(`\n📥 Processing ${listingUrls.length} listings...\n`);
    
    let imported = 0;
    let skipped = 0;
    let errors = 0;
    const results = [];
    
    // Step 2: Process listings in parallel (batches of 5)
    const batchSize = 5;
    for (let i = 0; i < listingUrls.length; i += batchSize) {
      const batch = listingUrls.slice(i, i + batchSize);
      console.log(`\nProcessing batch ${Math.floor(i / batchSize) + 1} (${batch.length} listings)...`);
      
      const batchResults = await Promise.all(
        batch.map(async (url, idx) => {
          const globalIdx = i + idx + 1;
          console.log(`[${globalIdx}/${listingUrls.length}] ${url}`);
          
          try {
            // Scrape the listing
            const listingData = await scrapeKSLListing(url);
            
            if (!listingData) {
              errors++;
              return { url, success: false, error: 'Could not scrape' };
            }
            
            if (!importToDb) {
              return { url, success: true, data: listingData };
            }
            
            // Import to database
            const result = await findOrCreateVehicle(listingData, url);
            
            if (result.error) {
              errors++;
              return { url, success: false, error: result.error };
            }
            
            if (result.created) {
              imported++;
              console.log(`   ✅ Created: ${result.id}`);
            } else {
              skipped++;
              console.log(`   ⏭️  Already exists: ${result.id}`);
            }
            
            return { url, success: true, vehicleId: result.id, created: result.created };
            
          } catch (error) {
            errors++;
            console.error(`   ❌ Error: ${error.message}`);
            return { url, success: false, error: error.message };
          }
        })
      );
      
      results.push(...batchResults);
      
      // Rate limiting between batches
      if (i + batchSize < listingUrls.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ Successfully imported: ${imported} vehicles`);
    console.log(`⏭️  Skipped (already exists): ${skipped}`);
    console.log(`❌ Errors: ${errors}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Save results
    const outputFile = path.join(process.cwd(), 'ksl-import-results.json');
    fs.writeFileSync(
      outputFile,
      JSON.stringify({ searchUrl, results, summary: { imported, skipped, errors } }, null, 2)
    );
    console.log(`💾 Results saved to ${outputFile}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main().catch(console.error);

