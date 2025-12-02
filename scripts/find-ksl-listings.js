#!/usr/bin/env node
/**
 * Find KSL listing URLs from search page
 * Uses Firecrawl to bypass bot protection
 */

import { chromium } from 'playwright';
import fs from 'fs';

const SEARCH_URL = process.argv[2] || 'https://cars.ksl.com/v2/search/make/Chevrolet/yearFrom/1970/yearTo/1991';

async function findListings() {
  console.log('🔍 Finding KSL listings from search page...\n');
  console.log(`URL: ${SEARCH_URL}\n`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    
    // Scroll to load more
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);
    
    const listingUrls = await page.evaluate(() => {
      const urls = new Set();
      const links = document.querySelectorAll('a[href*="/listing/"]');
      
      links.forEach(link => {
        const href = link.getAttribute('href');
        if (!href) return;
        
        let fullUrl = href.startsWith('/') ? `https://cars.ksl.com${href}` : href;
        if (fullUrl.includes('cars.ksl.com') && fullUrl.includes('/listing/')) {
          const cleanUrl = fullUrl.split('?')[0].split('#')[0];
          urls.add(cleanUrl);
        }
      });
      
      return Array.from(urls);
    });
    
    await browser.close();
    
    console.log(`📋 Found ${listingUrls.length} listing URLs\n`);
    
    // Save to file
    fs.writeFileSync('ksl-listings-found.json', JSON.stringify(listingUrls, null, 2));
    console.log(`💾 Saved to ksl-listings-found.json\n`);
    
    // Display first 20
    console.log('First 20 listings:');
    listingUrls.slice(0, 20).forEach((url, i) => {
      console.log(`  ${i + 1}. ${url}`);
    });
    
    return listingUrls;
    
  } catch (error) {
    await browser.close();
    throw error;
  }
}

findListings().catch(console.error);

