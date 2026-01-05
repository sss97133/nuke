#!/usr/bin/env node
/**
 * Scrape ALL 514 KSL listings (1964-1991) with Playwright stealth
 * Verified working - bypasses PerimeterX
 */

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: '../nuke_frontend/.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const isDryRun = process.argv.includes('--dry-run');
const limitArg = process.argv.find(arg => arg.startsWith('--limit'));
const maxVehicles = limitArg ? parseInt(limitArg.split('=')[1]) : null;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function launchBrowser() {
  return await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1920,1080',
    ],
  });
}

async function createStealthPage(browser) {
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
  
  return { page, context };
}

async function scrapeSearchPage(browser, pageNum) {
  const url = `https://cars.ksl.com/search/yearFrom/1964/yearTo/1991/page/${pageNum}`;
  const { page, context } = await createStealthPage(browser);
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(10000); // PerimeterX wait
    
    // Scroll
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let total = 0;
        const timer = setInterval(() => {
          window.scrollBy(0, 100);
          total += 100;
          if (total >= document.body.scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });
    
    await page.waitForTimeout(2000);
    
    const listings = await page.evaluate(() => {
      const results = [];
      const seen = new Set();
      
      document.querySelectorAll('a[href*="/listing/"]').forEach(link => {
        const href = link.getAttribute('href');
        if (!href) return;
        
        const url = href.startsWith('/') ? `https://cars.ksl.com${href}` : href;
        const cleanUrl = url.split('?')[0].split('#')[0];
        
        if (seen.has(cleanUrl)) return;
        seen.add(cleanUrl);
        
        const match = href.match(/listing\/(\d+)/);
        if (!match) return;
        
        const card = link.closest('article, [class*="listing"], [class*="card"]');
        const title = card?.querySelector('h2, h3, h4, [class*="title"]')?.textContent?.trim() || link.textContent?.trim() || '';
        
        results.push({
          url: cleanUrl,
          listing_id: match[1],
          title,
        });
      });
      
      return results;
    });
    
    await context.close();
    return listings;
    
  } catch (error) {
    console.error(`   ❌ Page ${pageNum} error: ${error.message}`);
    await context.close();
    return [];
  }
}

async function scrapeListingDetail(browser, url) {
  const { page, context } = await createStealthPage(browser);
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(10000);
    
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let total = 0;
        const timer = setInterval(() => {
          window.scrollBy(0, 100);
          total += 100;
          if (total >= document.body.scrollHeight / 2) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });
    
    await page.waitForTimeout(2000);
    
    const data = await page.evaluate(() => {
      const title = document.title.replace(' | KSL Cars', '').trim();
      const bodyText = document.body?.textContent || '';
      
      const result = { title, images: [] };
      
      const yearMatch = title.match(/\b(19\d{2}|20\d{2})\b/);
      if (yearMatch) result.year = parseInt(yearMatch[0]);
      
      const afterYear = title.replace(/\b(19|20)\d{2}\b/, '').trim();
      const parts = afterYear.split(/\s+/);
      if (parts.length >= 2) {
        result.make = parts[0];
        result.model = parts.slice(1, 4).join(' ');
      }
      
      const priceMatch = bodyText.match(/\$(\d{1,3}(?:,\d{3})*)/);
      if (priceMatch) result.asking_price = parseInt(priceMatch[1].replace(/,/g, ''));
      
      const mileageMatch = bodyText.match(/(\d{1,3}(?:,\d{3})*)\s*(?:miles|mi)/i);
      if (mileageMatch) result.mileage = parseInt(mileageMatch[1].replace(/,/g, ''));
      
      const vinMatch = bodyText.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
      if (vinMatch && !/[IOQ]/.test(vinMatch[1])) result.vin = vinMatch[1].toUpperCase();
      
      const locationMatch = title.match(/in\s+([^|]+)/);
      if (locationMatch) result.location = locationMatch[1].trim();
      
      const seen = new Set();
      document.querySelectorAll('img').forEach(img => {
        const src = img.src || img.getAttribute('data-src');
        if (src && src.includes('ksldigital.com') && !src.includes('logo') && !src.includes('icon') && !src.includes('svg') && !src.includes('weather') && !seen.has(src)) {
          seen.add(src);
          result.images.push(src);
        }
      });
      
      return result;
    });
    
    await context.close();
    return data;
    
  } catch (error) {
    console.error(`   ❌ Detail error: ${error.message}`);
    await context.close();
    return null;
  }
}

async function main() {
  console.log('🚀 KSL 1964-1991 Complete Scraper\n');
  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE IMPORT'}`);
  if (maxVehicles) console.log(`Limit: ${maxVehicles} vehicles`);
  console.log('Target: All 514 listings\n');
  
  const logFile = `logs/ksl-all-${new Date().toISOString().split('T')[0]}.log`;
  fs.mkdirSync('logs', { recursive: true });
  const log = (msg) => {
    console.log(msg);
    fs.appendFileSync(logFile, msg + '\n');
  };
  
  const stats = { total: 0, created: 0, existing: 0, failed: 0, images: 0 };
  
  log(`Started: ${new Date().toISOString()}\n`);
  
  // PHASE 1: Scrape all search pages
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('PHASE 1: Discovering all listings');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  const browser = await launchBrowser();
  const allListings = [];
  let emptyCount = 0;
  
  for (let pageNum = 1; pageNum <= 25 && emptyCount < 2; pageNum++) {
    log(`Page ${pageNum}:`);
    const listings = await scrapeSearchPage(browser, pageNum);
    
    if (listings.length === 0) {
      emptyCount++;
      log(`   ⚠️  Empty (${emptyCount}/2 - end of results?)`);
      if (emptyCount >= 2) break;
    } else {
      emptyCount = 0;
      allListings.push(...listings);
      log(`   ✅ ${listings.length} found (total: ${allListings.length})`);
    }
    
    if (pageNum < 25 && listings.length > 0) {
      const wait = 30000 + Math.random() * 10000;
      log(`   ⏸️  ${Math.round(wait/1000)}s wait...\n`);
      await sleep(wait);
    }
  }
  
  await browser.close();
  
  const unique = Array.from(new Map(allListings.map(l => [l.url, l])).values());
  log(`\n✅ Discovery complete: ${unique.length} unique listings\n`);
  
  const toProcess = maxVehicles ? unique.slice(0, maxVehicles) : unique;
  
  // PHASE 2: Scrape details + import
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log(`PHASE 2: Extracting ${toProcess.length} vehicles`);
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  const detailBrowser = await launchBrowser();
  
  for (let i = 0; i < toProcess.length; i++) {
    const listing = toProcess[i];
    stats.total++;
    
    log(`\n[${i + 1}/${toProcess.length}] ${listing.title}`);
    
    const data = await scrapeListingDetail(detailBrowser, listing.url);
    
    if (!data || !data.year || !data.make) {
      stats.failed++;
      log(`   ❌ Failed to extract`);
      continue;
    }
    
    log(`   📊 ${data.year} ${data.make} ${data.model}`);
    log(`   📸 ${data.images.length} images`);
    if (data.vin) log(`   🔑 VIN: ${data.vin}`);
    
    // Check if exists
    const { data: existing } = await supabase
      .from('vehicles')
      .select('id')
      .eq('discovery_url', listing.url)
      .maybeSingle();
    
    if (existing) {
      stats.existing++;
      log(`   ⏭️  Exists: ${existing.id}`);
    } else if (isDryRun) {
      stats.created++;
      log(`   [DRY RUN] Would create`);
    } else {
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
          discovery_source: 'ksl_batch_scrape',
          discovery_url: listing.url,
          origin_metadata: {
            ksl_title: data.title,
            ksl_location: data.location,
            scraped_at: new Date().toISOString(),
            image_count: data.images.length,
          },
          is_public: true,
          status: 'active',
        })
        .select('id')
        .single();
      
      if (error) {
        stats.failed++;
        log(`   ❌ Insert failed: ${error.message}`);
      } else {
        stats.created++;
        stats.images += data.images.length;
        log(`   ✅ Created: ${newVehicle.id}`);
        
        // Upload images
        if (data.images.length > 0) {
          const { error: imgError } = await supabase.functions.invoke('backfill-images', {
            body: {
              vehicle_id: newVehicle.id,
              image_urls: data.images.slice(0, 50),
              source: 'ksl_listing',
              source_url: listing.url,
            },
          });
          
          if (imgError) {
            log(`   ⚠️  Image upload failed`);
          } else {
            log(`   ✅ ${data.images.length} images uploaded`);
          }
        }
      }
    }
    
    // Rate limit
    if (i < toProcess.length - 1) {
      const wait = 12000 + Math.random() * 8000;
      log(`   ⏸️  ${Math.round(wait/1000)}s...`);
      await sleep(wait);
    }
  }
  
  await detailBrowser.close();
  
  // Summary
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('📊 COMPLETE');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log(`Total: ${stats.total}`);
  log(`Created: ${stats.created}`);
  log(`Existing: ${stats.existing}`);
  log(`Failed: ${stats.failed}`);
  log(`Images: ${stats.images}`);
  log(`Success: ${((stats.created + stats.existing) / stats.total * 100).toFixed(1)}%`);
  log(`Finished: ${new Date().toISOString()}`);
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  fs.writeFileSync(`logs/ksl-summary-${new Date().toISOString().split('T')[0]}.json`, JSON.stringify({
    date: new Date().toISOString(),
    stats,
    mode: isDryRun ? 'dry-run' : 'live',
  }, null, 2));
}

main().catch(console.error);

