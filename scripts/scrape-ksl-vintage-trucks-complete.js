#!/usr/bin/env node
/**
 * Scrape ALL 1964-1991 vehicles from KSL using Playwright stealth
 * Processes search results and imports vehicles with images
 * 
 * Usage:
 *   node scripts/scrape-ksl-vintage-trucks-complete.js [--dry-run] [--limit N]
 */

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: '../nuke_frontend/.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const isDryRun = process.argv.includes('--dry-run');
const limitArg = process.argv.find(arg => arg.startsWith('--limit'));
const maxListings = limitArg ? parseInt(limitArg.split('=')[1]) : null;

// Generate search URLs dynamically to get all pages
// KSL shows ~25-50 listings per page, 514 total = ~11-21 pages
function generateSearchUrls() {
  const urls = [];
  for (let page = 1; page <= 25; page++) { // Over-estimate to ensure we get all
    urls.push(`https://cars.ksl.com/search/yearFrom/1964/yearTo/1991/page/${page}`);
  }
  return urls;
}

const SEARCH_URLS = generateSearchUrls();

async function scrapeSearchPage(searchUrl, browser) {
  console.log(`\n🔍 Scraping search page: ${searchUrl}`);
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/Denver',
    geolocation: { latitude: 40.7608, longitude: -111.8910 },
    permissions: ['geolocation'],
  });
  
  const page = await context.newPage();
  
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });
  
  try {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(10000); // Longer wait for PerimeterX (increased from 8s)
    
    // Scroll to load lazy content
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= document.body.scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });
    
    await page.waitForTimeout(2000);
    
    // Extract listing URLs and basic info
    const listings = await page.evaluate(() => {
      const results = [];
      const seen = new Set();
      
      // Find all listing links
      document.querySelectorAll('a[href*="/listing/"]').forEach(link => {
        const href = link.getAttribute('href');
        if (!href) return;
        
        let fullUrl = href;
        if (href.startsWith('/')) {
          fullUrl = `https://cars.ksl.com${href}`;
        }
        
        const cleanUrl = fullUrl.split('?')[0].split('#')[0];
        if (seen.has(cleanUrl)) return;
        seen.add(cleanUrl);
        
        // Get listing ID
        const listingIdMatch = href.match(/listing\/(\d+)/);
        const listingId = listingIdMatch ? listingIdMatch[1] : null;
        
        if (!listingId) return;
        
        // Get preview data from card
        const card = link.closest('article, [class*="listing"], [class*="card"], [class*="result"]');
        const title = card?.querySelector('h2, h3, h4, [class*="title"]')?.textContent?.trim() || 
                     link.textContent?.trim() || '';
        
        const priceEl = card?.querySelector('[class*="price"]');
        const priceText = priceEl?.textContent || '';
        const priceMatch = priceText.match(/\$([\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        
        const imgEl = card?.querySelector('img');
        const thumbnail = imgEl?.src || imgEl?.getAttribute('data-src') || null;
        
        results.push({
          url: cleanUrl,
          listing_id: listingId,
          title,
          price,
          thumbnail,
        });
      });
      
      return results;
    });
    
    await context.close();
    
    console.log(`   ✅ Found ${listings.length} listings`);
    return listings;
    
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    await context.close();
    return [];
  }
}

async function scrapeListingDetail(url) {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1920,1080',
    ],
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/Denver',
    geolocation: { latitude: 40.7608, longitude: -111.8910 },
    permissions: ['geolocation'],
  });
  
  const page = await context.newPage();
  
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(8000);
    
    // Scroll to load gallery
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= document.body.scrollHeight / 2) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });
    
    await page.waitForTimeout(2000);
    
    const data = await page.evaluate(() => {
      const result = {
        title: document.title.replace(' | KSL Cars', '').replace(' in ', ' - ').trim(),
        images: [],
      };
      
      // Extract vehicle info from body text
      const bodyText = document.body?.textContent || '';
      
      // Year
      const yearMatch = result.title.match(/\b(19\d{2}|20\d{2})\b/);
      if (yearMatch) result.year = parseInt(yearMatch[0]);
      
      // Make/Model from title
      const afterYear = result.title.replace(/\b(19|20)\d{2}\b/, '').trim();
      const parts = afterYear.split(/\s+/);
      if (parts.length >= 2) {
        result.make = parts[0];
        result.model = parts.slice(1, 4).join(' '); // Up to 3 words for model
      }
      
      // Price
      const priceMatch = bodyText.match(/\$(\d{1,3}(?:,\d{3})*)/);
      if (priceMatch) {
        result.asking_price = parseInt(priceMatch[1].replace(/,/g, ''));
      }
      
      // Mileage
      const mileageMatch = bodyText.match(/(\d{1,3}(?:,\d{3})*)\s*(?:miles|mi|mileage)/i);
      if (mileageMatch) {
        result.mileage = parseInt(mileageMatch[1].replace(/,/g, ''));
      }
      
      // VIN
      const vinMatch = bodyText.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
      if (vinMatch && !/[IOQ]/.test(vinMatch[1])) {
        result.vin = vinMatch[1].toUpperCase();
      }
      
      // Location
      const locationMatch = result.title.match(/in\s+([^|]+)/);
      if (locationMatch) {
        result.location = locationMatch[1].trim();
      }
      
      // Description
      const descEl = document.querySelector('[class*="description"], [class*="details"]');
      if (descEl) {
        result.description = descEl.textContent?.trim().substring(0, 5000) || '';
      }
      
      // Extract ALL vehicle images
      const seen = new Set();
      document.querySelectorAll('img').forEach(img => {
        const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
        if (src && 
            (src.includes('ksldigital.com') || src.includes('image.ksl.com')) &&
            !src.includes('logo') && 
            !src.includes('icon') &&
            !src.includes('svg') &&
            !src.includes('weather') &&
            !seen.has(src)) {
          seen.add(src);
          result.images.push(src);
        }
      });
      
      return result;
    });
    
    await browser.close();
    return data;
    
  } catch (error) {
    console.error(`   ❌ Error scraping detail: ${error.message}`);
    await browser.close();
    return null;
  }
}

async function importVehicle(data, url) {
  if (!data.year || !data.make || !data.model) {
    console.log(`   ⚠️  Skipping (missing year/make/model): ${data.title}`);
    return null;
  }
  
  // Check if already exists
  const { data: existing } = await supabase
    .from('vehicles')
    .select('id')
    .eq('discovery_url', url)
    .maybeSingle();
  
  if (existing) {
    console.log(`   ⏭️  Already exists: ${existing.id}`);
    return { id: existing.id, created: false, images: data.images.length };
  }
  
  // Check by VIN
  if (data.vin) {
    const { data: vinMatch } = await supabase
      .from('vehicles')
      .select('id')
      .eq('vin', data.vin)
      .maybeSingle();
    
    if (vinMatch) {
      console.log(`   ⏭️  VIN match exists: ${vinMatch.id}`);
      // Update discovery URL
      await supabase
        .from('vehicles')
        .update({ discovery_url: url })
        .eq('id', vinMatch.id);
      return { id: vinMatch.id, created: false, images: data.images.length };
    }
  }
  
  if (isDryRun) {
    console.log(`   [DRY RUN] Would create: ${data.year} ${data.make} ${data.model}`);
    return { id: 'dry-run', created: true, images: data.images.length };
  }
  
  // Create vehicle
  const { data: newVehicle, error } = await supabase
    .from('vehicles')
    .insert({
      year: data.year,
      make: data.make.toLowerCase(),
      model: data.model.toLowerCase(),
      vin: data.vin || null,
      mileage: data.mileage || null,
      asking_price: data.asking_price || null,
      profile_origin: 'ksl_import',
      discovery_source: 'ksl_automated_scrape',
      discovery_url: url,
      origin_metadata: {
        ksl_title: data.title,
        ksl_location: data.location,
        scraped_at: new Date().toISOString(),
        image_count: data.images.length,
      },
      is_public: true,
      status: 'active',
      description: data.description || null,
    })
    .select('id')
    .single();
  
  if (error) {
    console.error(`   ❌ Failed to create: ${error.message}`);
    return null;
  }
  
  console.log(`   ✅ Created: ${newVehicle.id}`);
  
  // Queue image import
  if (data.images.length > 0) {
    console.log(`   📸 Queuing ${data.images.length} images for backfill...`);
    
    // Call backfill-images Edge Function
    const { error: imgError } = await supabase.functions.invoke('backfill-images', {
      body: {
        vehicle_id: newVehicle.id,
        image_urls: data.images.slice(0, 50), // Limit to 50 images
        source: 'ksl_listing',
        source_url: url,
      },
    });
    
    if (imgError) {
      console.log(`   ⚠️  Image upload failed: ${imgError.message}`);
    } else {
      console.log(`   ✅ Images uploaded`);
    }
  }
  
  return { id: newVehicle.id, created: true, images: data.images.length };
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('🚀 KSL Vintage Vehicle Scraper (1964-1991)\n');
  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE IMPORT'}`);
  if (maxListings) console.log(`Limit: ${maxListings} listings`);
  console.log('');
  
  const stats = {
    total: 0,
    created: 0,
    existing: 0,
    failed: 0,
    images: 0,
  };
  
  const logFile = `logs/ksl-scrape-${new Date().toISOString().split('T')[0]}.log`;
  fs.mkdirSync('logs', { recursive: true });
  
  const log = (msg) => {
    console.log(msg);
    fs.appendFileSync(logFile, msg + '\n');
  };
  
  log(`Started: ${new Date().toISOString()}`);
  log(`Target: All 1964-1991 vehicles (estimated 514 listings)`);
  log(`Max pages: 25`);
  log('');
  
  // Scrape all search pages (stop when we hit an empty page)
  const allListings = [];
  let emptyPageCount = 0;
  
  for (let i = 0; i < SEARCH_URLS.length; i++) {
    const searchUrl = SEARCH_URLS[i];
    const listings = await scrapeSearchPage(searchUrl);
    
    if (listings.length === 0) {
      emptyPageCount++;
      log(`   ⚠️  Empty page (${emptyPageCount}/2) - might be end of results`);
      
      if (emptyPageCount >= 2) {
        log(`   ✅ Reached end of search results at page ${i + 1}`);
        break;
      }
    } else {
      emptyPageCount = 0; // Reset counter
      allListings.push(...listings);
    }
    
    // Wait between search pages to avoid rate limits
    if (i < SEARCH_URLS.length - 1 && listings.length > 0) {
      const waitTime = 25000 + Math.random() * 10000; // 25-35s
      console.log(`   ⏸️  Waiting ${Math.round(waitTime/1000)}s before next search page...`);
      await sleep(waitTime);
    }
  }
  
    // Deduplicate
    const uniqueListings = Array.from(
      new Map(allListings.map(item => [item.url, item])).values()
    );
    
    log(`\n📋 Total unique listings found: ${uniqueListings.length}`);
    
    const toProcess = maxListings ? uniqueListings.slice(0, maxListings) : uniqueListings;
    log(`📋 Processing: ${toProcess.length} listings\n`);
    
  } finally {
    // Close search browser
    await browser.close();
    log(`   🔒 Browser closed\n`);
  }
  
  // Process each listing
  for (let i = 0; i < toProcess.length; i++) {
    const listing = toProcess[i];
    stats.total++;
    
    log(`\n[${i + 1}/${toProcess.length}] ${listing.title}`);
    log(`   URL: ${listing.url}`);
    
    // Scrape detail page
    const detailData = await scrapeListingDetail(listing.url);
    
    if (!detailData) {
      stats.failed++;
      log(`   ❌ Failed to scrape detail page`);
      continue;
    }
    
    log(`   📊 Extracted: ${detailData.year} ${detailData.make} ${detailData.model}`);
    log(`   📸 Images: ${detailData.images.length}`);
    if (detailData.vin) log(`   🔑 VIN: ${detailData.vin}`);
    if (detailData.mileage) log(`   🛣️  Mileage: ${detailData.mileage.toLocaleString()}`);
    if (detailData.asking_price) log(`   💰 Price: $${detailData.asking_price.toLocaleString()}`);
    
    // Import to database
    const result = await importVehicle(detailData, listing.url);
    
    if (result) {
      if (result.created) {
        stats.created++;
        stats.images += result.images;
      } else {
        stats.existing++;
      }
    } else {
      stats.failed++;
    }
    
    // Rate limiting - wait between requests
    if (i < toProcess.length - 1) {
      const waitTime = 10000 + Math.random() * 5000; // 10-15 seconds
      console.log(`   ⏸️  Waiting ${Math.round(waitTime/1000)}s...`);
      await sleep(waitTime);
    }
  }
  
  // Summary
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('📊 SCRAPING COMPLETE');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log(`Total listings: ${stats.total}`);
  log(`Created: ${stats.created}`);
  log(`Already existed: ${stats.existing}`);
  log(`Failed: ${stats.failed}`);
  log(`Total images: ${stats.images}`);
  log(`Success rate: ${((stats.created + stats.existing) / stats.total * 100).toFixed(1)}%`);
  log(`Finished: ${new Date().toISOString()}`);
  log(`Log: ${logFile}`);
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // Save summary
  const summaryFile = `logs/ksl-scrape-summary-${new Date().toISOString().split('T')[0]}.json`;
  fs.writeFileSync(summaryFile, JSON.stringify({
    date: new Date().toISOString(),
    stats,
    mode: isDryRun ? 'dry-run' : 'live',
  }, null, 2));
  
  console.log(`📄 Summary: ${summaryFile}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

