#!/usr/bin/env node
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
});
const page = await context.newPage();

try {
  console.log('Loading page...');
  await page.goto('https://hemmings.com/auction/1969-dodge-charger-southampton-ny-687854', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  await page.waitForTimeout(3000);

  const title = await page.title();
  const url = page.url();
  const h1Count = await page.$$eval('h1', els => els.length);
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));

  console.log('Title:', title);
  console.log('Final URL:', url);
  console.log('H1 count:', h1Count);
  console.log('Body preview:', bodyText);

} catch (e) {
  console.error('Error:', e.message);
}

await browser.close();
