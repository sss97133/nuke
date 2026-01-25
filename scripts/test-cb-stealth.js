#!/usr/bin/env node
import { chromium } from 'playwright';

async function testCB() {
  const url = process.argv[2] || 'https://carsandbids.com/auctions/kpvemoxz/1999-honda-s2000';
  console.log('Testing:', url);

  const browser = await chromium.launch({
    headless: false, // Try with visible browser
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  // Remove webdriver property
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(10000);

    const title = await page.title();
    console.log('Page title:', title);

    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
    console.log('Body preview:', bodyText);

  } catch (e) {
    console.log('Error:', e.message);
  }

  await browser.close();
}

testCB().catch(console.error);
