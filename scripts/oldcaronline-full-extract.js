#!/usr/bin/env node
/**
 * OldCarOnline Full Extraction
 * Extracts all listings from oldcaronline.com
 *
 * Usage: node oldcaronline-full-extract.js [max_listings] [rate_delay_ms]
 */

import { chromium } from 'playwright';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAX_LISTINGS = parseInt(process.argv[2]) || 5000;
const RATE_DELAY = parseInt(process.argv[3]) || 1200;

// Pages to scrape for listing discovery
const DISCOVERY_PAGES = [
  'https://www.oldcaronline.com/',
  'https://www.oldcaronline.com/Classic-Cars-For-Sale-On-OldCarOnline.com/results?',
];

// Popular makes for broader coverage
const MAKES = [
  'Chevrolet', 'Ford', 'Dodge', 'Plymouth', 'Pontiac', 'Buick', 'Cadillac',
  'Oldsmobile', 'Mercury', 'Lincoln', 'Chrysler', 'AMC', 'Studebaker',
  'Packard', 'Porsche', 'Mercedes', 'Jaguar', 'MG', 'Triumph', 'Austin',
  'Volkswagen', 'BMW', 'Alfa', 'Fiat', 'Datsun', 'Toyota', 'Honda'
];

for (const make of MAKES) {
  DISCOVERY_PAGES.push(`https://www.oldcaronline.com/Classic-${make}-For-Sale-On-OldCarOnline.com/results?make=${make}`);
}

// Year range pages
for (let decade = 1920; decade <= 2000; decade += 10) {
  DISCOVERY_PAGES.push(`https://www.oldcaronline.com/Classic-Cars-For-Sale-On-OldCarOnline.com/results?year1=${decade}&year2=${decade + 9}`);
}

async function discoverListings(page) {
  const allListings = new Set();

  console.log(`Discovering listings from ${DISCOVERY_PAGES.length} pages...`);

  for (const url of DISCOVERY_PAGES) {
    const pageName = url.includes('make=') ? url.split('make=')[1] :
                     url.includes('year1=') ? `${url.match(/year1=(\d+)/)[1]}s` : 'Main';

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(2000);

      // Scroll to load more
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollBy(0, 600));
        await page.waitForTimeout(300);
      }

      const listings = await page.evaluate(() => {
        return [...document.querySelectorAll('a[href*="for-sale-ID"][href$=".htm"]')]
          .map(a => a.href)
          .filter((v, i, a) => a.indexOf(v) === i);
      });

      const before = allListings.size;
      listings.forEach(l => allListings.add(l));
      const added = allListings.size - before;

      if (added > 0) {
        process.stdout.write(`  ${pageName}: +${added} (total: ${allListings.size})\n`);
      }

      await page.waitForTimeout(800);

      if (allListings.size >= MAX_LISTINGS) {
        console.log(`  Reached max listings limit (${MAX_LISTINGS})`);
        break;
      }

    } catch (e) {
      // Silent fail - continue with other pages
    }
  }

  return [...allListings];
}

async function extractListing(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(1200);

  return await page.evaluate(() => {
    const text = document.body.innerText;
    const title = document.querySelector('h1')?.innerText || document.title;

    // Parse title: "1966 AMC American 440 for sale by Owner - Mead, Washington"
    const yearMatch = title.match(/^(\d{4})/);
    const makeModelMatch = title.match(/^\d{4}\s+([A-Za-z]+(?:\s+Benz)?)\s+(.+?)(?:\s+for\s+sale|\s+-\s+[A-Z]|$)/i);

    // Price
    const priceMatches = text.match(/\$\s*([\d,]+)/g) || [];
    const prices = priceMatches.map(p => parseInt(p.replace(/[$,\s]/g, ''))).filter(p => p > 500 && p < 10000000);
    const price = prices.length > 0 ? Math.max(...prices) : null;

    // Location from title
    const locationMatch = title.match(/(?:for\s+sale[^-]*-\s*)([^,]+),?\s*([A-Za-z\s]+)?$/i);

    // Images
    const images = [...document.querySelectorAll('img')]
      .map(i => i.src)
      .filter(s => s && s.includes('http') && !s.includes('logo') && !s.includes('icon') && !s.includes('banner'))
      .filter((v, i, a) => a.indexOf(v) === i);

    // VIN (if present)
    const vinMatch = text.match(/VIN[:\s#]*([A-HJ-NPR-Z0-9]{17})/i);

    // Mileage
    const mileageMatch = text.match(/(\d{1,3},?\d{3})\s*(?:miles?|mi\.?)/i);

    return {
      url: window.location.href,
      title,
      year: yearMatch ? parseInt(yearMatch[1]) : null,
      make: makeModelMatch ? makeModelMatch[1].trim() : null,
      model: makeModelMatch ? makeModelMatch[2].trim() : null,
      price,
      city: locationMatch ? locationMatch[1].trim() : null,
      state: locationMatch && locationMatch[2] ? locationMatch[2].trim() : null,
      vin: vinMatch ? vinMatch[1] : null,
      mileage: mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null,
      images,
      primary_image: images[0] || null
    };
  });
}

async function saveVehicle(data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/vehicles`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal,resolution=merge-duplicates'
    },
    body: JSON.stringify({
      discovery_url: data.url,
      discovery_source: 'oldcaronline',
      year: data.year,
      make: data.make,
      model: data.model,
      sale_price: data.price,
      vin: data.vin,
      mileage: data.mileage,
      primary_image_url: data.primary_image,
      status: 'active',
      notes: `OldCarOnline listing. ${data.city || ''}${data.state ? ', ' + data.state : ''}. ${data.images.length} images.`
    })
  });

  return res.ok;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  OLDCARONLINE FULL EXTRACTION                                ║');
  console.log('║  Max listings: ' + MAX_LISTINGS.toString().padEnd(45) + '║');
  console.log('║  Rate delay: ' + RATE_DELAY + 'ms'.padEnd(47) + '║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const startTime = Date.now();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Phase 1: Discover all listings
    const listings = await discoverListings(page);
    console.log(`\nDiscovered ${listings.length} unique listings\n`);

    // Phase 2: Extract each
    let saved = 0, errors = 0, skipped = 0;

    for (let i = 0; i < listings.length; i++) {
      const url = listings[i];

      try {
        const data = await extractListing(page, url);

        // Quality check - skip if no year or make
        if (!data.year || !data.make) {
          skipped++;
          continue;
        }

        const ok = await saveVehicle(data);

        if (ok) {
          saved++;
          if (saved % 50 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
            const rate = (saved / (Date.now() - startTime) * 1000 * 60).toFixed(0);
            console.log(`[${elapsed}m] Saved ${saved}/${listings.length} (~${rate}/min)`);
          }
        } else {
          errors++;
        }

      } catch (e) {
        errors++;
      }

      // Rate limit
      await page.waitForTimeout(RATE_DELAY);
    }

    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`\n════════════════════════════════════════`);
    console.log(`COMPLETE in ${elapsed} minutes`);
    console.log(`  Saved: ${saved}`);
    console.log(`  Errors: ${errors}`);
    console.log(`  Skipped (bad data): ${skipped}`);
    console.log(`════════════════════════════════════════`);

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
