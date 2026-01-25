#!/usr/bin/env node
/**
 * Hemmings FAST DISCOVER - Scrape classified listings
 * Gets: price, year, make, model, thumbnail, URL
 */

import { chromium } from 'playwright';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PARALLEL = parseInt(process.argv[2]) || 3;

// Hemmings categories to scrape (pagination doesn't work, so we scrape each category)
const CATEGORIES = [
  'classics', 'convertibles', 'muscle-cars', 'sports-cars', 'exotics',
  'restomods-customs', 'trucks', 'suvs', '4x4s', 'race', 'performance-cars',
  'luxury-cars', 'late-model', 'wagons', 'american', 'japanese', 'british', 'european'
];

let existingUrls = new Set();

async function loadExistingUrls() {
  console.log('Loading existing Hemmings URLs...');
  let offset = 0;
  const limit = 1000;
  let allUrls = [];

  while (true) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.hemmings&select=discovery_url&limit=${limit}&offset=${offset}`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
    });
    const data = await res.json();
    if (data.length === 0) break;
    allUrls = allUrls.concat(data);
    offset += limit;
  }

  existingUrls = new Set(allUrls.map(v => v.discovery_url?.toLowerCase().replace(/\/$/, '')).filter(Boolean));
  console.log(`Loaded ${existingUrls.size} existing URLs\n`);
}

async function scrapeCategory(page, category) {
  // Hemmings uses /listing/ and /auction/ URLs - scrape each category page
  const url = `https://www.hemmings.com/classifieds/cars-for-sale/${category}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(5000);

    // Scroll multiple times to load more content
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);
    }

    const listings = await page.evaluate(() => {
      const results = [];
      const seen = new Set();

      // Hemmings uses /listing/YEAR-MAKE-MODEL-LOCATION-ID or /auction/YEAR-MAKE-MODEL-ID
      document.querySelectorAll('a[href*="/listing/"], a[href*="/auction/"]').forEach(link => {
        const href = link.href;

        // Extract listing ID (6+ digit number at end)
        const idMatch = href.match(/(\d{6,})$/);
        if (!idMatch) return;

        const listingId = idMatch[1];
        if (seen.has(listingId)) return;
        seen.add(listingId);

        // Parse URL: /listing/1957-cadillac-eldorado-cape-coral-fl-296011
        // or /auction/1970-chevrolet-monte-carlo-379218
        const urlMatch = href.match(/\/(listing|auction)\/(\d{4})-([a-z]+)-(.+)-\d{6,}/i);
        if (!urlMatch) return;

        const year = parseInt(urlMatch[2]);
        const make = urlMatch[3].charAt(0).toUpperCase() + urlMatch[3].slice(1).toLowerCase();

        // Model is between make and location-ID
        // URL ends with: -[city-parts]-[STATE]-[ID] where STATE is 2-letter US state
        const states = 'al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc';
        let modelPart = urlMatch[4];
        // Find and remove location (everything from last state abbrev to end)
        const stateMatch = modelPart.match(new RegExp('-([a-z]+-)*(' + states + ')$', 'i'));
        if (stateMatch) {
          // Remove the city-state portion
          modelPart = modelPart.substring(0, modelPart.length - stateMatch[0].length);
        }
        const model = modelPart.replace(/-/g, ' ');

        if (year < 1900 || year > 2030) return;

        const card = link.closest('article, div[class*="card"], div[class*="listing"]') || link.parentElement?.parentElement;
        const text = card?.innerText || '';

        // Get price
        const priceMatch = text.match(/\$\s*([\d,]+)/);

        // Get image
        const img = card?.querySelector('img[src*="hemmings"], img[src*="cloudinary"], img[data-src]');

        results.push({
          url: href.split('?')[0].replace(/\/$/, ''),
          year,
          make,
          model,
          price: priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null,
          thumbnail: img?.src || img?.dataset?.src || null,
        });
      });

      return results;
    });

    return { success: true, listings, category };
  } catch (e) {
    return { success: false, error: e.message, category, listings: [] };
  }
}

async function saveListings(listings) {
  let saved = 0, skipped = 0, failed = 0;

  for (const listing of listings) {
    if (!listing.url) continue;

    const normalizedUrl = listing.url.toLowerCase().replace(/\/$/, '');

    if (existingUrls.has(normalizedUrl)) {
      skipped++;
      continue;
    }

    try {
      const vehicleData = {
        year: listing.year,
        make: listing.make,
        model: listing.model,
        sale_price: listing.price,
        discovery_url: normalizedUrl,
        discovery_source: 'hemmings',
        listing_source: 'hemmings-fast-discover',
        status: 'active',
      };

      const res = await fetch(`${SUPABASE_URL}/rest/v1/vehicles`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(vehicleData),
      });

      if (res.ok) {
        const [vehicle] = await res.json();

        if (listing.thumbnail && vehicle?.id) {
          await fetch(`${SUPABASE_URL}/rest/v1/vehicle_images`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              vehicle_id: vehicle.id,
              image_url: listing.thumbnail,
              source: 'external_import',
              is_external: true,
              is_primary: true,
              is_approved: true,
              position: 0,
            }),
          }).catch(() => {});
        }

        saved++;
        existingUrls.add(normalizedUrl);
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
    }
  }

  return { saved, skipped, failed };
}

async function worker(workerId, browser, categoryQueue, stats) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  while (categoryQueue.length > 0) {
    const category = categoryQueue.shift();
    if (!category) break;

    const result = await scrapeCategory(page, category);

    if (result.success && result.listings.length > 0) {
      const { saved, skipped } = await saveListings(result.listings);
      stats.saved += saved;
      stats.skipped += skipped;
      stats.categories++;
      console.log(`[W${workerId}] ${category}: ${result.listings.length} found, ${saved} new`);
    } else if (result.success && result.listings.length === 0) {
      console.log(`[W${workerId}] ${category}: 0 listings`);
      stats.categories++;
    } else {
      console.log(`[W${workerId}] ${category}: ERROR - ${result.error}`);
      stats.errors++;
    }
  }

  await context.close();
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Hemmings FAST DISCOVER                                    ║');
  console.log(`║  Categories: ${CATEGORIES.length} | Workers: ${PARALLEL}                              ║`);
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  await loadExistingUrls();

  const browser = await chromium.launch({ headless: true });
  const categoryQueue = [...CATEGORIES];
  const stats = { saved: 0, skipped: 0, categories: 0, errors: 0 };

  const workers = [];
  for (let i = 0; i < PARALLEL; i++) {
    workers.push(worker(i, browser, categoryQueue, stats));
  }

  await Promise.all(workers);
  await browser.close();

  console.log(`\n✅ Done! Saved ${stats.saved} new vehicles from ${stats.categories} categories`);
}

main().catch(console.error);
