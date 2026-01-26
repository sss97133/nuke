#!/usr/bin/env node
/**
 * Auto-generated extractor for https://kindredmotorworks.com
 * Generated: 2026-01-25T19:12:00.716Z
 *
 * Usage: node extract-kindredmotorworks-com.js [batch_size] [workers]
 */

import { chromium } from 'playwright';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = parseInt(process.argv[2]) || 50;
const WORKERS = parseInt(process.argv[3]) || 2;

const CONFIG = {
  "SITE_TYPE": "marketplace",
  "CURRENT_INVENTORY_URL": "https://kindredmotorworks.com/for-sale",
  "SOLD_INVENTORY_URL": null,
  "LISTING_URL_PATTERN": "a[href*=\"vehicle\"], a[href*=\"listing\"], a[href*=\"car\"], a[href*=\"build\"]",
  "EXTRACTION_SELECTORS": {
    "year": "h1, .title",
    "make": "h1",
    "model": "h1, .title, .vehicle-title",
    "price": ".price, [class*=\"price\"]",
    "vin": ".vin, [class*=\"vin\"]",
    "mileage": ".mileage, [class*=\"mileage\"]",
    "images": "img[src*=\"vehicle\"], .gallery img, .slider img, [class*=\"gallery\"] img"
  },
  "PAGINATION_PATTERN": "a[href*=\"page\"], .pagination a, [class*=\"next\"], [class*=\"load-more\"]",
  "CHALLENGES": [
    "lazy_loading",
    "dynamic_content"
  ],
  "RECOMMENDED_APPROACH": "playwright"
};

async function discoverListings(page, inventoryUrl) {
  await page.goto(inventoryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Scroll to load lazy content
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);

  const listings = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href*="vehicle"], a[href*="listing"], a[href*="inventory/"], a[href*="/car/"], a[href*="/lot/"]')];
    return links
      .map(a => a.href)
      .filter(h => h && !h.includes('#'))
      .filter((v, i, a) => a.indexOf(v) === i);
  });

  return listings;
}

async function extractListing(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    return await page.evaluate(() => {
      const text = document.body.innerText;

      // Year extraction
      const yearMatch = text.match(/\b(19[0-9]{2}|20[0-2][0-9])\b/);

      // Price extraction
      const priceMatch = text.match(/\$([\d,]+)/);

      // VIN extraction
      const vinMatch = text.match(/VIN[:\s]*([A-Z0-9]{17})/i);

      // Mileage extraction
      const mileageMatch = text.match(/(\d{1,3},?\d{3})\s*(miles?|mi\.?)/i);

      // Images
      const images = [...document.querySelectorAll('img')]
        .map(i => i.src || i.dataset?.src)
        .filter(s => s && s.includes('http') && !s.includes('logo') && !s.includes('icon'))
        .filter((v, i, a) => a.indexOf(v) === i);

      // Title parsing for make/model
      const title = document.querySelector('h1')?.innerText || document.title;

      return {
        url: window.location.href,
        title,
        year: yearMatch ? parseInt(yearMatch[1]) : null,
        price: priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null,
        vin: vinMatch?.[1] || null,
        mileage: mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null,
        images,
        raw_text: text.slice(0, 5000)
      };
    });
  } catch (e) {
    return { url, error: e.message };
  }
}

async function saveVehicle(data) {
  // Use AI to extract make/model from title if needed
  const vehicleData = {
    discovery_url: data.url,
    discovery_source: 'kindredmotorworks-com',
    year: data.year,
    sale_price: data.price,
    vin: data.vin,
    mileage: data.mileage,
    primary_image_url: data.images?.[0],
    status: 'pending'
  };

  // Insert or update
  const res = await fetch(`${SUPABASE_URL}/rest/v1/vehicles`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify(vehicleData)
  });

  return res.ok;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  KINDREDMOTORWORKS-COM EXTRACTOR');
  console.log('║  Auto-generated extractor');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Discover listings
    console.log('Discovering listings...');
    const listings = await discoverListings(page, 'https://kindredmotorworks.com');
    console.log(`Found ${listings.length} listings\n`);

    // Extract each
    let success = 0, errors = 0;
    for (const url of listings.slice(0, BATCH_SIZE)) {
      const data = await extractListing(page, url);
      if (data.error) {
        errors++;
        console.log(`✗ ${url.slice(0, 50)}... - ${data.error}`);
      } else {
        await saveVehicle(data);
        success++;
        console.log(`✓ ${data.year || '?'} - ${data.title?.slice(0, 40) || 'Unknown'}`);
      }
    }

    console.log(`\n✅ Done: ${success} extracted, ${errors} errors`);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
