#!/usr/bin/env node
import { chromium } from 'playwright';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function testExtract() {
  // Get a pending Hagerty vehicle
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.hagerty&status=eq.pending&select=id,discovery_url&limit=1`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const [vehicle] = await res.json();

  if (!vehicle) {
    console.log('No pending Hagerty vehicles');
    return;
  }

  console.log('Testing:', vehicle.discovery_url);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(vehicle.discovery_url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(5000);

  // Scroll to load all content
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
  }

  const data = await page.evaluate(() => {
    const bodyText = document.body.innerText;

    // VIN
    const vinMatch = bodyText.match(/VIN[:\s]+([A-HJ-NPR-Z0-9]{17})/i);

    // Title
    const title = document.querySelector('h1')?.innerText?.trim();

    // Specs - look for common patterns
    const mileageMatch = bodyText.match(/([0-9,]+)\s*(?:miles|mi)/i);
    const engineMatch = bodyText.match(/Engine[:\s]+([^\n]+)/i) || bodyText.match(/(\d+\.?\d*[Ll]|V\d+|[Ii]nline.?\d+)[^\n]*/i);
    const transMatch = bodyText.match(/Transmission[:\s]+([^\n]+)/i);
    const extColorMatch = bodyText.match(/(?:Exterior|Ext\.?)[:\s]+([^\n]+)/i);
    const intColorMatch = bodyText.match(/(?:Interior|Int\.?)[:\s]+([^\n]+)/i);

    // Sale info
    const soldMatch = bodyText.match(/Sold\s*(?:for)?\s*\$?([0-9,]+)/i);
    const currentBidMatch = bodyText.match(/Current\s*Bid[:\s]*\$?([0-9,]+)/i);
    const buyNowMatch = bodyText.match(/Buy\s*(?:It\s*)?Now[:\s]*\$?([0-9,]+)/i);

    // Description
    const descEl = document.querySelector('[class*="description"], [class*="about"], .listing-details');
    const description = descEl?.innerText?.slice(0, 500);

    // Images
    const images = [...document.querySelectorAll('img')]
      .map(i => i.src || i.dataset?.src)
      .filter(s => s && (s.includes('hagerty') || s.includes('cloudinary')))
      .filter(s => !s.includes('logo') && !s.includes('icon') && !s.includes('avatar'))
      .filter(s => s.includes('upload') || s.includes('image'))
      .map(s => s.split('?')[0])
      .filter((v, i, a) => a.indexOf(v) === i);

    // Debug - look for color patterns
    const colorSection = bodyText.match(/(?:color|exterior|interior)[^\n]*[\n]?[^\n]*/gi)?.slice(0, 10);

    return {
      vin: vinMatch?.[1],
      title,
      mileage: mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null,
      engine: engineMatch?.[1]?.trim(),
      transmission: transMatch?.[1]?.trim(),
      exterior_color: extColorMatch?.[1]?.trim(),
      interior_color: intColorMatch?.[1]?.trim(),
      sold_price: soldMatch ? parseInt(soldMatch[1].replace(/,/g, '')) : null,
      current_bid: currentBidMatch ? parseInt(currentBidMatch[1].replace(/,/g, '')) : null,
      buy_now_price: buyNowMatch ? parseInt(buyNowMatch[1].replace(/,/g, '')) : null,
      description,
      images: images.length,
      _colorSection: colorSection,
      _firstPart: bodyText.slice(0, 2000)
    };
  });

  console.log('\n=== EXTRACTED DATA ===');
  console.log(JSON.stringify(data, null, 2));

  await browser.close();
}

testExtract().catch(console.error);
