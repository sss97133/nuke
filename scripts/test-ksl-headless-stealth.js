#!/usr/bin/env node
/**
 * Test if headless mode can bypass PerimeterX with extra stealth
 */

import { chromium } from 'playwright';

const TEST_URL = 'https://cars.ksl.com/listing/10286857';

async function testHeadlessStealth() {
  console.log('🥷 Testing HEADLESS Playwright with maximum stealth...\n');
  
  const browser = await chromium.launch({
    headless: true, // Try headless for production
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
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
  
  // Stealth init script
  await page.addInitScript(() => {
    // Remove webdriver
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    
    // Add chrome object
    window.chrome = { runtime: {} };
    
    // Plugins
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    
    // Mock permissions query
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: 'default' }) :
        originalQuery(parameters)
    );
  });
  
  try {
    await page.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(8000); // Wait for PerimeterX
    
    // Human-like scrolling
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
    
    // Extract
    const result = await page.evaluate(() => ({
      title: document.title,
      imageCount: document.querySelectorAll('img[src*="ksldigital"], img[src*="image.ksldigital"]').length,
      images: Array.from(document.querySelectorAll('img'))
        .map(img => img.src || img.getAttribute('data-src'))
        .filter(src => src && 
                      (src.includes('ksldigital.com') || src.includes('image.ksl.com')) &&
                      !src.includes('logo') && 
                      !src.includes('icon') &&
                      !src.includes('svg') &&
                      !src.includes('weather'))
        .slice(0, 50),
      bodyPreview: document.body?.textContent?.substring(0, 200) || ''
    }));
    
    const isBlocked = result.title.includes('denied') || 
                     result.title.includes('Blocked') ||
                     result.bodyPreview.includes('PerimeterX');
    
    console.log('📊 Results (HEADLESS mode):');
    console.log(`   Title: ${result.title}`);
    console.log(`   Images found: ${result.imageCount}`);
    console.log(`   Extracted: ${result.images.length}`);
    console.log(`   Status: ${isBlocked ? '❌ BLOCKED' : '✅ SUCCESS'}`);
    
    if (!isBlocked && result.images.length > 5) {
      console.log('\n🎉 HEADLESS MODE WORKS!');
      console.log('   This can run in production Docker containers');
      console.log(`   Sample images: ${result.images.slice(0, 3).join(', ')}`);
    } else {
      console.log('\n❌ HEADLESS MODE BLOCKED');
      console.log('   Need visible browser (headless: false) which requires X11/display');
    }
    
    await browser.close();
    return { success: !isBlocked, images: result.images.length };
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    await browser.close();
    return { success: false, images: 0 };
  }
}

testHeadlessStealth()
  .then(({ success, images }) => {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(success ? `✅ SUCCESS: ${images} images` : '❌ FAILED: Blocked by PerimeterX');
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Fatal:', error);
    process.exit(1);
  });

