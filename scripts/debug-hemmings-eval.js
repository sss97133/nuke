#!/usr/bin/env node
import { chromium } from 'playwright';

const url = 'https://hemmings.com/auction/1969-dodge-charger-southampton-ny-687854';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
});
const page = await context.newPage();

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(8000);

  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
  }

  // Use the EXACT same extraction logic as the script
  const data = await page.evaluate(() => {
    const bodyText = document.body.innerText;

    const vinMatch = bodyText.match(/VIN[:\s#]+([A-HJ-NPR-Z0-9]{17})/i);
    const title = document.querySelector('h1')?.innerText?.trim();
    const mileageMatch = bodyText.match(/(?:Mileage|Miles)[:\s]+([0-9,]+)/i);
    const engineMatch = bodyText.match(/Engine[:\s]+([^\n]+)/i) || bodyText.match(/(\d+\.?\d*[Ll]|V\d+|[Ii]nline.?\d+|Flat.?\d+)[^\n]*/i);
    const transMatch = bodyText.match(/Transmission[:\s]+([^\n]+)/i);
    const extColorMatch = bodyText.match(/(?:Exterior\s*Color|Ext\.?\s*Color)[:\s]+([^\n]+)/i);
    const intColorMatch = bodyText.match(/(?:Interior\s*Color|Int\.?\s*Color)[:\s]+([^\n]+)/i);
    const drivetrainMatch = bodyText.match(/Drivetrain[:\s]+([^\n]+)/i);
    const priceMatch = bodyText.match(/\$([0-9,]+)/) || bodyText.match(/Price[:\s]+\$?([0-9,]+)/i);
    const stockMatch = bodyText.match(/Stock\s*#?[:\s]+([^\n]+)/i);
    const dealerMatch = bodyText.match(/(?:Seller|Dealer|Offered By)[:\s]+([^\n]+)/i);
    const locationMatch = bodyText.match(/(?:Location|Located)[:\s]+([^\n]+)/i);

    const descEl = document.querySelector('[class*="description"], [class*="about"], .listing-description, #description');
    const description = descEl?.innerText?.slice(0, 2000) || '';

    const features = [];
    document.querySelectorAll('li, .feature, .option, .equipment-item').forEach(el => {
      const text = el.innerText?.trim();
      if (text && text.length > 5 && text.length < 150) features.push(text);
    });

    const images = [...document.querySelectorAll('img')]
      .map(i => i.src || i.dataset?.src || i.dataset?.lazySrc)
      .filter(s => s && (s.includes('hemmings') || s.includes('cloudinary') || s.includes('cloudfront')))
      .filter(s => !s.includes('logo') && !s.includes('icon') && !s.includes('avatar') && !s.includes('placeholder'))
      .filter(s => s.includes('/listings/') || s.includes('upload') || s.includes('image'))
      .map(s => s.split('?')[0])
      .filter((v, i, a) => a.indexOf(v) === i);

    return {
      vin: vinMatch?.[1],
      title,
      mileage: mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null,
      engine: engineMatch?.[1]?.trim(),
      transmission: transMatch?.[1]?.trim(),
      drivetrain: drivetrainMatch?.[1]?.trim(),
      exterior_color: extColorMatch?.[1]?.trim(),
      interior_color: intColorMatch?.[1]?.trim(),
      price: priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null,
      stock_number: stockMatch?.[1]?.trim(),
      dealer: dealerMatch?.[1]?.trim(),
      location: locationMatch?.[1]?.trim(),
      description,
      features: features.slice(0, 30),
      images,
      outcome: 'listed'
    };
  });

  console.log('Extracted data:');
  console.log(JSON.stringify(data, null, 2));

} catch (e) {
  console.error('Error:', e.message);
}

await browser.close();
