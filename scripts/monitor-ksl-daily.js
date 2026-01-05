#!/usr/bin/env node
/**
 * Daily KSL monitoring - Check for new 1964-1991 vehicles
 * Runs daily to detect new listings and monitor existing ones
 * 
 * Usage:
 *   node scripts/monitor-ksl-daily.js
 * 
 * Setup cron:
 *   0 6 * * * cd /Users/skylar/nuke && node scripts/monitor-ksl-daily.js >> logs/ksl-monitor.log 2>&1
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

// Check first 3 pages to catch new listings (they appear on top)
const SEARCH_URLS = [
  'https://cars.ksl.com/search/yearFrom/1964/yearTo/1991/page/1',
  'https://cars.ksl.com/search/yearFrom/1964/yearTo/1991/page/2',
  'https://cars.ksl.com/search/yearFrom/1964/yearTo/1991/page/3',
];

async function scrapeNewListings() {
  console.log(`\n🔍 Daily KSL Monitor - ${new Date().toISOString()}\n`);
  
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
    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(8000);
    
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
    
    const listings = await page.evaluate(() => {
      const results = [];
      const seen = new Set();
      
      document.querySelectorAll('a[href*="/listing/"]').forEach(link => {
        const href = link.getAttribute('href');
        if (!href) return;
        
        let fullUrl = href.startsWith('/') ? `https://cars.ksl.com${href}` : href;
        const cleanUrl = fullUrl.split('?')[0].split('#')[0];
        
        if (seen.has(cleanUrl)) return;
        seen.add(cleanUrl);
        
        const listingIdMatch = href.match(/listing\/(\d+)/);
        if (!listingIdMatch) return;
        
        const card = link.closest('article, [class*="listing"], [class*="card"]');
        const title = card?.querySelector('h2, h3, h4, [class*="title"]')?.textContent?.trim() || 
                     link.textContent?.trim() || '';
        
        results.push({
          url: cleanUrl,
          listing_id: listingIdMatch[1],
          title,
        });
      });
      
      return results;
    });
    
    await browser.close();
    return listings;
    
  } catch (error) {
    console.error(`❌ Error scraping page: ${error.message}`);
    await browser.close();
    return [];
  }
}

async function main() {
  console.log(`\n🔍 Daily KSL Monitor - ${new Date().toISOString()}\n`);
  
  try {
    // Scrape first 3 pages (new listings appear on top)
    const allListings = [];
    for (const searchUrl of SEARCH_URLS) {
      console.log(`Checking: ${searchUrl}`);
      const listings = await scrapeSearchPage(searchUrl);
      allListings.push(...listings);
      
      if (SEARCH_URLS.indexOf(searchUrl) < SEARCH_URLS.length - 1) {
        console.log(`   Waiting 30s...`);
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
    }
    
    // Deduplicate
    const listings = Array.from(
      new Map(allListings.map(item => [item.url, item])).values()
    );
    
    console.log(`\n✅ Found ${listings.length} current listings\n`);
    
    // Check which are new
    const newListings = [];
    for (const listing of listings) {
      const { data: existing } = await supabase
        .from('vehicles')
        .select('id')
        .eq('discovery_url', listing.url)
        .maybeSingle();
      
      if (!existing) {
        newListings.push(listing);
      }
    }
    
    console.log(`🆕 New listings: ${newListings.length}`);
    
    if (newListings.length > 0) {
      console.log('\n📋 New listings to import:');
      newListings.forEach((l, i) => {
        console.log(`${i + 1}. ${l.title}`);
        console.log(`   ${l.url}`);
      });
      
      // Queue for import
      const { error: queueError } = await supabase
        .from('import_queue')
        .insert(
          newListings.map(l => ({
            url: l.url,
            source: 'ksl',
            status: 'pending',
            discovered_at: new Date().toISOString(),
            raw_data: { title: l.title, listing_id: l.listing_id },
          }))
        );
      
      if (queueError) {
        console.error(`❌ Failed to queue: ${queueError.message}`);
      } else {
        console.log(`✅ Queued ${newListings.length} listings for import`);
      }
    }
    
    // Check for removed/sold listings
    const { data: ourVehicles } = await supabase
      .from('vehicles')
      .select('id, discovery_url, year, make, model')
      .ilike('discovery_url', '%cars.ksl.com%')
      .gte('year', 1964)
      .lte('year', 1991)
      .eq('status', 'active');
    
    const currentUrls = new Set(listings.map(l => l.url));
    const removedVehicles = ourVehicles?.filter(v => v.discovery_url && !currentUrls.has(v.discovery_url)) || [];
    
    if (removedVehicles.length > 0) {
      console.log(`\n⚠️  ${removedVehicles.length} listings may have been removed/sold:`);
      removedVehicles.slice(0, 10).forEach(v => {
        console.log(`   - ${v.year} ${v.make} ${v.model} (${v.id})`);
      });
      
      // Mark as potentially sold (don't delete - they might come back)
      console.log(`   💾 Logged ${removedVehicles.length} potentially sold vehicles`);
    }
    
    // Summary
    const summary = {
      timestamp: new Date().toISOString(),
      total_listings: listings.length,
      new_listings: newListings.length,
      our_vehicles: ourVehicles?.length || 0,
      potentially_sold: removedVehicles.length,
    };
    
    const summaryFile = `logs/ksl-monitor-${new Date().toISOString().split('T')[0]}.json`;
    fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
    
    console.log(`\n✅ Monitor complete`);
    console.log(`   Summary: ${summaryFile}`);
    
    return summary;
    
  } catch (error) {
    console.error('❌ Monitor failed:', error.message);
    await browser.close();
    throw error;
  }
}

main()
  .then((summary) => {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Daily Monitor Summary:');
    console.log(`   Total KSL listings: ${summary.total_listings}`);
    console.log(`   New listings: ${summary.new_listings}`);
    console.log(`   Our vehicles: ${summary.our_vehicles}`);
    console.log(`   Potentially sold: ${summary.potentially_sold}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal:', error);
    process.exit(1);
  });

