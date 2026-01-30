#!/usr/bin/env node
/**
 * Auto-generated extractor for https://oldcaronline.com
 * Generated: 2026-01-29T14:29:38.689Z
 *
 * Usage: node extract-oldcaronline-com.js [batch_size] [workers]
 */

import { chromium } from 'playwright';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = parseInt(process.argv[2]) || 50;
const WORKERS = parseInt(process.argv[3]) || 2;

const CONFIG = {
  "SITE_TYPE": "dealer",
  "CURRENT_INVENTORY_URL": "https://www.oldcaronline.com/Classic-Cars-For-Sale-On-OldCarOnline.com/results?",
  "SOLD_INVENTORY_URL": null,
  "LISTING_URL_PATTERN": "https://www.oldcaronline.com/",
  "EXTRACTION_SELECTORS": {
    "year": "\\b(19|20)\\d{2}\\b",
    "make": "h1, .title",
    "model": "h1, .title, .vehicle-title",
    "price": "\\$[\\d,]+",
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

// Pages to scrape for listings
const PAGES_TO_SCRAPE = [
  'https://www.oldcaronline.com/',
  'https://www.oldcaronline.com/Classic-Cars-For-Sale-On-OldCarOnline.com/results?',
];

// Add make-specific pages for more coverage
const MAKES = ['Chevrolet', 'Ford', 'Dodge', 'Plymouth', 'Pontiac', 'Buick', 'Cadillac', 'Oldsmobile', 'Mercury', 'Lincoln', 'Chrysler', 'AMC', 'Studebaker', 'Packard', 'Hudson', 'Nash', 'Willys', 'Jeep', 'International', 'GMC'];
for (const make of MAKES) {
  PAGES_TO_SCRAPE.push(`https://www.oldcaronline.com/Classic-${make}-For-Sale-On-OldCarOnline.com/results?make=${make}`);
}

async function discoverListings(page, inventoryUrl) {
  const allListings = [];
  const seen = new Set();

  for (const url of PAGES_TO_SCRAPE) {
    const pageName = url.includes('make=') ? url.split('make=')[1] : 'Main';
    console.log(`  Scanning ${pageName}...`);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(2500);

      // Scroll to load lazy content
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollBy(0, 800));
        await page.waitForTimeout(400);
      }

      // Find listing links - pattern: *-for-sale-ID*.htm
      const listings = await page.evaluate(() => {
        const links = [...document.querySelectorAll('a[href*="for-sale-ID"][href$=".htm"]')];
        return links
          .map(a => a.href)
          .filter((v, i, a) => a.indexOf(v) === i);
      });

      let newCount = 0;
      for (const listing of listings) {
        if (!seen.has(listing)) {
          seen.add(listing);
          allListings.push(listing);
          newCount++;
        }
      }

      if (newCount > 0) {
        console.log(`    +${newCount} new (total: ${allListings.length})`);
      }

      // Rate limit
      await page.waitForTimeout(1200);

    } catch (e) {
      console.log(`    Error: ${e.message.slice(0, 50)}`);
    }
  }

  return allListings;
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

async function parseTitle(title) {
  // Parse "1967 Chevrolet Corvette" style titles
  const match = title?.match(/^(\d{4})\s+(\w+)\s+(.+)/);
  if (match) {
    return { year: parseInt(match[1]), make: match[2], model: match[3].split(/\s*-\s*/)[0].trim() };
  }
  return {};
}

async function saveVehicle(data) {
  const parsed = await parseTitle(data.title);

  const vehicleData = {
    discovery_url: data.url,
    discovery_source: 'oldcaronline',
    year: data.year || parsed.year,
    make: parsed.make || null,
    model: parsed.model || null,
    sale_price: data.price,
    vin: data.vin,
    mileage: data.mileage,
    primary_image_url: data.images?.[0],
    status: 'active',  // These are live listings
    notes: `OldCarOnline listing. ${data.images?.length || 0} images.`
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
  console.log('║  OLDCARONLINE-COM EXTRACTOR');
  console.log('║  Auto-generated extractor');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Discover listings
    console.log('Discovering listings...');
    const listings = await discoverListings(page, 'https://oldcaronline.com');
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
