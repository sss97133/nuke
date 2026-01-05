#!/usr/bin/env node
/**
 * Aggressive anti-detection test for KSL
 * Tests multiple stealth techniques to bypass PerimeterX
 */

import { chromium } from 'playwright';
import fs from 'fs';

const TEST_URL = 'https://cars.ksl.com/listing/10286857';

async function testAggressiveStealth() {
  console.log('🥷 Testing AGGRESSIVE stealth techniques for KSL...\n');
  
  // Strategy 1: Playwright with maximum stealth
  console.log('Strategy 1: Playwright with aggressive args...');
  
  const browser = await chromium.launch({
    headless: false, // Try visible browser (harder to detect)
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
      '--disable-web-security',
      '--disable-features=BlockInsecurePrivateNetworkRequests',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920,1080',
      '--start-maximized',
      '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ],
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/Denver', // MST (KSL is Utah)
    permissions: ['geolocation'],
    geolocation: { latitude: 40.7608, longitude: -111.8910 }, // Salt Lake City
    colorScheme: 'light',
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
    javaScriptEnabled: true,
  });
  
  const page = await context.newPage();
  
  // Remove webdriver flag
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
    });
    
    // Add realistic chrome properties
    window.chrome = {
      runtime: {},
    };
    
    // Mock permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );
    
    // Add plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
    
    // Add languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });
  });
  
  try {
    console.log('   Navigating to KSL listing...');
    await page.goto(TEST_URL, { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 
    });
    
    // Wait longer for PerimeterX challenge
    console.log('   Waiting for PerimeterX challenge to resolve...');
    await page.waitForTimeout(8000);
    
    // Mimic human behavior - scroll slowly
    console.log('   Mimicking human scrolling...');
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          
          if (totalHeight >= scrollHeight / 2) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });
    
    await page.waitForTimeout(2000);
    
    // Take screenshot
    await page.screenshot({ path: 'ksl-aggressive-test.png', fullPage: true });
    console.log('   📸 Screenshot saved: ksl-aggressive-test.png');
    
    // Extract data
    const result = await page.evaluate(() => {
      return {
        title: document.title,
        bodyText: document.body?.textContent?.substring(0, 500) || '',
        imageCount: document.querySelectorAll('img[src*="ksl"], img[src*="ksldigital"]').length,
        images: Array.from(document.querySelectorAll('img[src*="ksl"], img[src*="ksldigital"]'))
          .map(img => img.src)
          .filter(src => !src.includes('logo') && !src.includes('icon'))
          .slice(0, 30)
      };
    });
    
    console.log('\n📊 Results:');
    console.log(`   Title: ${result.title}`);
    console.log(`   Images found: ${result.imageCount}`);
    console.log(`   Body text preview: ${result.bodyText.substring(0, 100)}...`);
    
    // Check if blocked
    const isBlocked = result.title.includes('denied') || 
                     result.title.includes('Blocked') ||
                     result.bodyText.includes('PerimeterX') ||
                     result.bodyText.includes('_pxCustomLogo');
    
    if (isBlocked) {
      console.log('\n❌ BLOCKED by PerimeterX');
      console.log('   Only found logo image from block page');
    } else {
      console.log('\n✅ SUCCESS! Bypassed PerimeterX');
      console.log(`   Extracted ${result.images.length} real vehicle images`);
      
      // Save results
      fs.writeFileSync('ksl-aggressive-success.json', JSON.stringify(result, null, 2));
      console.log('   💾 Saved to ksl-aggressive-success.json');
    }
    
    // Keep browser open for manual inspection
    console.log('\n⏸️  Browser staying open for 30 seconds for manual inspection...');
    await page.waitForTimeout(30000);
    
    await browser.close();
    
    return { success: !isBlocked, result };
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    await page.screenshot({ path: 'ksl-aggressive-error.png' });
    await browser.close();
    throw error;
  }
}

// Run test
testAggressiveStealth()
  .then(({ success }) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

