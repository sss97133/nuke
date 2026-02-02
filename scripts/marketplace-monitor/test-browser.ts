#!/usr/bin/env npx tsx

/**
 * Simple test - just launch browser and go to Facebook
 */

import { chromium } from 'playwright';

async function test() {
  console.log('1. Launching Chrome...');

  const context = await chromium.launchPersistentContext('./fb-session', {
    headless: false,
    slowMo: 50,
    viewport: { width: 1280, height: 800 },
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  console.log('2. Chrome launched. Opening page...');

  const page = await context.newPage();

  console.log('3. Navigating to Facebook Marketplace...');

  await page.goto('https://www.facebook.com/marketplace', {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });

  console.log('4. Page loaded. URL:', page.url());

  // Check if logged in
  const url = page.url();
  if (url.includes('login') || url.includes('checkpoint')) {
    console.log('');
    console.log('========================================');
    console.log('🔐 NOT LOGGED IN');
    console.log('Please log into Facebook in the browser window.');
    console.log('Press Ctrl+C when done logging in.');
    console.log('========================================');

    // Keep browser open
    await new Promise(() => {});
  } else {
    console.log('✅ Already logged in!');

    // Try to find some listings
    await page.waitForTimeout(5000);
    const links = await page.$$('a[href*="/marketplace/item/"]');
    console.log(`Found ${links.length} listing links on page`);

    // Keep browser open for inspection
    console.log('');
    console.log('Browser will stay open. Press Ctrl+C to close.');
    await new Promise(() => {});
  }
}

test().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
