#!/usr/bin/env node
/**
 * Scrape KSL listing with Playwright (bypasses PerimeterX)
 * Returns HTML + images for a single KSL URL
 * 
 * Usage:
 *   node scripts/scrape-ksl-with-playwright.js https://cars.ksl.com/listing/12345
 */

import { chromium } from 'playwright';

async function scrapeKSL(url) {
  if (!url || !url.includes('ksl.com')) {
    throw new Error('Invalid KSL URL');
  }
  
  console.log(`🥷 Scraping KSL with Playwright stealth: ${url}`);
  
  const browser = await chromium.launch({
    headless: true, // Works in headless!
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
  
  // Anti-detection init script
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(8000); // PerimeterX challenge wait
    
    // Human-like scrolling to load lazy images
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
    
    // Extract data
    const result = await page.evaluate(() => {
      const data = {
        title: document.title,
        html: document.documentElement.outerHTML,
        images: [],
      };
      
      // Extract all vehicle images
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
          data.images.push(src);
        }
      });
      
      return data;
    });
    
    await browser.close();
    
    // Check if blocked
    const isBlocked = result.title.includes('denied') || 
                     result.title.includes('Blocked') ||
                     result.html.includes('_pxCustomLogo');
    
    if (isBlocked) {
      console.log(`❌ Blocked by PerimeterX`);
      return { success: false, data: null };
    }
    
    console.log(`✅ Success: ${result.images.length} images extracted`);
    return { 
      success: true, 
      data: {
        title: result.title,
        html: result.html,
        images: result.images
      }
    };
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    await browser.close();
    return { success: false, data: null, error: error.message };
  }
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2] || TEST_URL;
  
  scrapeKSL(url)
    .then(({ success, data }) => {
      if (success) {
        console.log(`\n✅ SUCCESS`);
        console.log(`   Title: ${data.title}`);
        console.log(`   Images: ${data.images.length}`);
        console.log(`   Sample: ${data.images.slice(0, 3).join('\n           ')}`);
        process.exit(0);
      } else {
        console.log('\n❌ FAILED');
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error('Fatal:', error);
      process.exit(1);
    });
}

export { scrapeKSL };

