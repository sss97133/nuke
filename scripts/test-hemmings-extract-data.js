#!/usr/bin/env node
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
});
const page = await context.newPage();

try {
  await page.goto('https://hemmings.com/auction/1969-dodge-charger-southampton-ny-687854', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });
  await page.waitForTimeout(3000);

  const data = await page.evaluate(() => {
    const bodyText = document.body.innerText;

    // VIN
    const vinMatch = bodyText.match(/VIN[:\s#]+([A-HJ-NPR-Z0-9]{17})/i);

    // Title
    const title = document.querySelector('h1')?.innerText?.trim();

    // Specs
    const mileageMatch = bodyText.match(/(?:Mileage|Miles)[:\s]+([0-9,]+)/i);
    const engineMatch = bodyText.match(/Engine[:\s]+([^\n]+)/i) || bodyText.match(/(\d+\.?\d*[Ll]|V\d+|[Ii]nline.?\d+|Flat.?\d+)[^\n]*/i);
    const transMatch = bodyText.match(/Transmission[:\s]+([^\n]+)/i);
    const extColorMatch = bodyText.match(/(?:Exterior\s*Color|Ext\.?\s*Color)[:\s]+([^\n]+)/i);

    // Price
    const priceMatch = bodyText.match(/\$([0-9,]+)/) || bodyText.match(/Price[:\s]+\$?([0-9,]+)/i);

    // Images
    const images = [...document.querySelectorAll('img')]
      .map(i => i.src || i.dataset?.src)
      .filter(s => s && (s.includes('hemmings') || s.includes('cloudinary') || s.includes('cloudfront')))
      .filter(s => !s.includes('logo') && !s.includes('icon'))
      .map(s => s.split('?')[0])
      .filter((v, i, a) => a.indexOf(v) === i);

    return {
      vin: vinMatch?.[1],
      title,
      mileage: mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null,
      engine: engineMatch?.[1]?.trim(),
      transmission: transMatch?.[1]?.trim(),
      exterior_color: extColorMatch?.[1]?.trim(),
      price: priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null,
      imageCount: images.length,
      images: images.slice(0, 5)
    };
  });

  console.log('Extracted data:', JSON.stringify(data, null, 2));

} catch (e) {
  console.error('Error:', e.message);
}

await browser.close();
