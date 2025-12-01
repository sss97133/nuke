#!/usr/bin/env node
/**
 * Test KSL Scraper - Fetch ~20 truck listings from KSL
 * Tests the scraper with real data before building admin tooling
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const KSL_SEARCH_URL = process.argv[2] || 'https://cars.ksl.com/v2/search/make/Chevrolet/yearFrom/1970/yearTo/1991';

async function testKSLScraper() {
  console.log('🚀 Testing KSL Scraper...\n');
  console.log(`URL: ${KSL_SEARCH_URL}\n`);

  const browser = await chromium.launch({ 
    headless: true, // Run headless for automation
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();
  
  try {
    console.log('   Navigating to search page...');
    await page.goto(KSL_SEARCH_URL, { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 
    });
    await page.waitForTimeout(5000);
    
    // Take a screenshot to see what we're working with
    await page.screenshot({ path: 'ksl-search-page.png', fullPage: true });
    console.log('   📸 Screenshot saved: ksl-search-page.png');
    
    // Extract listing URLs - try multiple selectors
    const listingData = await page.evaluate(() => {
      const results = [];
      const seen = new Set();
      
      // Try multiple selector strategies
      const selectors = [
        'a[href*="/listing/"]',
        'a[href*="/detail/"]',
        'a[href*="/classifieds/"]',
        '.listing a',
        '.result a',
        '[data-listing-id] a',
        'article a'
      ];
      
      for (const selector of selectors) {
        const links = document.querySelectorAll(selector);
        links.forEach(link => {
          const href = link.getAttribute('href');
          if (!href) return;
          
          // Normalize URL
          let fullUrl = href;
          if (href.startsWith('/')) {
            fullUrl = `https://cars.ksl.com${href}`;
          }
          
          if (!fullUrl.includes('cars.ksl.com')) return;
          if (seen.has(fullUrl)) return;
          seen.add(fullUrl);
          
          // Extract listing ID
          const listingIdMatch = href.match(/\/(\d+)/);
          const listingId = listingIdMatch ? listingIdMatch[1] : null;
          
          // Get title from various sources
          const title = link.textContent?.trim() || 
                       link.closest('article, .listing, .result, .card')?.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim() ||
                       'Untitled Listing';
          
          // Get price if available
          const priceText = link.closest('article, .listing, .result, .card')?.textContent || '';
          const priceMatch = priceText.match(/\$([\d,]+)/);
          const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
          
          // Get image if available
          const img = link.closest('article, .listing, .result, .card')?.querySelector('img');
          const imageUrl = img ? img.getAttribute('src') || img.getAttribute('data-src') : null;
          
          results.push({
            url: fullUrl,
            listingId,
            title: title.substring(0, 200),
            price,
            imageUrl
          });
        });
      }
      
      // Remove duplicates and limit to 20
      const unique = Array.from(
        new Map(results.map(item => [item.url, item])).values()
      ).slice(0, 20);
      
      return unique;
    });
    
    console.log(`\n📋 Found ${listingData.length} listings\n`);
    
    // Display results
    listingData.forEach((listing, i) => {
      console.log(`${i + 1}. ${listing.title}`);
      console.log(`   URL: ${listing.url}`);
      if (listing.price) console.log(`   Price: $${listing.price.toLocaleString()}`);
      console.log('');
    });
    
    // Save to file
    const outputFile = path.join(process.cwd(), 'ksl-test-listings.json');
    fs.writeFileSync(
      outputFile,
      JSON.stringify(listingData, null, 2)
    );
    
    console.log(`💾 Saved to ${outputFile}`);
    console.log(`\n✅ Test complete! Found ${listingData.length} listings`);
    
    // Now test scraping one listing in detail
    if (listingData.length > 0) {
      console.log('\n🔍 Testing detailed scrape of first listing...\n');
      const testListing = listingData[0];
      
      const detailPage = await browser.newPage();
      try {
        await detailPage.goto(testListing.url, { 
          waitUntil: 'networkidle',
          timeout: 20000 
        });
        await detailPage.waitForTimeout(2000);
        
        const detailData = await detailPage.evaluate(() => {
          const data = {};
          
          // Title
          const titleEl = document.querySelector('h1, .title, [class*="title"]');
          data.title = titleEl?.textContent?.trim() || '';
          
          // Price
          const bodyText = document.body?.textContent || '';
          const priceMatch = bodyText.match(/\$([\d,]+)/);
          if (priceMatch) {
            data.price = parseInt(priceMatch[1].replace(/,/g, ''));
          }
          
          // Year/Make/Model from title
          const yearMatch = data.title.match(/\b(19|20)\d{2}\b/);
          if (yearMatch) {
            data.year = parseInt(yearMatch[0]);
          }
          
          const afterYear = data.title.replace(/\b(19|20)\d{2}\b/, '').trim();
          const parts = afterYear.split(/\s+/);
          if (parts.length >= 2) {
            data.make = parts[0];
            data.model = parts.slice(1, 3).join(' ');
          }
          
          // VIN
          const vinMatch = bodyText.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
          if (vinMatch && !/[IOQ]/.test(vinMatch[1])) {
            data.vin = vinMatch[1].toUpperCase();
          }
          
          // Mileage
          const mileageMatch = bodyText.match(/(\d{1,3}(?:,\d{3})*)\s*(?:miles|mi)/i);
          if (mileageMatch) {
            data.mileage = parseInt(mileageMatch[1].replace(/,/g, ''));
          }
          
          // Description
          const descEl = document.querySelector('.description, [class*="description"], .details');
          data.description = descEl?.textContent?.trim().substring(0, 1000) || '';
          
          // Images
          const images = [];
          const imgElements = document.querySelectorAll('img[src*="ksl"], img[data-src*="ksl"]');
          imgElements.forEach(img => {
            const src = img.getAttribute('src') || img.getAttribute('data-src');
            if (src && !src.includes('logo') && !src.includes('icon')) {
              images.push(src);
            }
          });
          data.images = images.slice(0, 20);
          
          return data;
        });
        
        console.log('📊 Detailed scrape result:');
        console.log(JSON.stringify(detailData, null, 2));
        
        // Save detailed test
        const detailFile = path.join(process.cwd(), 'ksl-test-detail.json');
        fs.writeFileSync(
          detailFile,
          JSON.stringify({ url: testListing.url, ...detailData }, null, 2)
        );
        console.log(`\n💾 Detailed data saved to ${detailFile}`);
        
      } finally {
        await detailPage.close();
      }
    }
    
    return listingData;
    
  } catch (error) {
    console.error('❌ Error:', error);
    console.error('Stack:', error.stack);
    throw error;
  } finally {
    await browser.close();
  }
}

testKSLScraper().catch(console.error);

