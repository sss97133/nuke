#!/usr/bin/env node
import { chromium } from 'playwright';

const url = 'https://collectingcars.com/for-sale/2004-ferrari-360-challenge-stradale-12';

async function debug() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  });

  const page = await context.newPage();

  console.log('Loading page...');
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(5000);

  // Get page text and look for bid-related content
  const text = await page.evaluate(() => document.body.innerText);

  // Find lines with bid/price info
  const lines = text.split('\n').filter(l =>
    /bid|price|£|€|\$|auction|reserve/i.test(l) && l.trim().length < 100
  );

  console.log('\n=== Bid-related text ===');
  lines.slice(0, 30).forEach(l => console.log(l.trim()));

  // Also check for specific patterns
  console.log('\n=== Pattern matches ===');
  const bidMatch = text.match(/Current\s*Bid[:\s]*[£$€]?([\d,]+)/i);
  const highBidMatch = text.match(/High\s*Bid[:\s]*[£$€]?([\d,]+)/i);
  const priceMatch = text.match(/[£€]([\d,]+)/g);

  console.log('Current Bid match:', bidMatch?.[0]);
  console.log('High Bid match:', highBidMatch?.[0]);
  console.log('Price matches:', priceMatch?.slice(0, 5));

  await browser.close();
}

debug().catch(console.error);
