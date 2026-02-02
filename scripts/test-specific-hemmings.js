#!/usr/bin/env node
import { chromium } from 'playwright';

const url = 'https://hemmings.com/auction/1987-jeep-grand-wagoneer-scottsdale-az-918954';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
});
const page = await context.newPage();

try {
  console.log('Loading:', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  console.log('Page loaded, waiting...');
  await page.waitForTimeout(8000);

  console.log('Scrolling...');
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
  }

  console.log('Extracting data...');
  const data = await page.evaluate(() => {
    const bodyText = document.body.innerText;
    const vinMatch = bodyText.match(/VIN[:\s#]+([A-HJ-NPR-Z0-9]{17})/i);
    const title = document.querySelector('h1')?.innerText?.trim();
    const mileageMatch = bodyText.match(/(?:Mileage|Miles)[:\s]+([0-9,]+)/i);
    const engineMatch = bodyText.match(/Engine[:\s]+([^\n]+)/i);
    const priceMatch = bodyText.match(/\$([0-9,]+)/);

    return {
      vin: vinMatch?.[1],
      title,
      mileage: mileageMatch?.[1],
      engine: engineMatch?.[1],
      price: priceMatch?.[1],
      hasH1: !!document.querySelector('h1'),
      bodyLength: bodyText.length
    };
  });

  console.log('Extracted:', JSON.stringify(data, null, 2));

} catch (e) {
  console.error('Error:', e.message);
}

await browser.close();
