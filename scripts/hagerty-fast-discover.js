#!/usr/bin/env node
/**
 * Hagerty Marketplace FAST DISCOVER
 * Gets: price, year, make, model, thumbnail, URL
 */

import { chromium } from 'playwright';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAX_PAGES = parseInt(process.argv[2]) || 300;
const PARALLEL = parseInt(process.argv[3]) || 3;

let existingUrls = new Set();

async function loadExistingUrls() {
  console.log('Loading existing Hagerty URLs...');
  let offset = 0;
  const limit = 1000;
  let allUrls = [];

  while (true) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.hagerty&select=discovery_url&limit=${limit}&offset=${offset}`, {
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

async function scrapePage(page, pageNum) {
  const url = `https://www.hagerty.com/marketplace/page/${pageNum}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    const listings = await page.evaluate(() => {
      const results = [];
      const seen = new Set();

      // Hagerty pattern: /marketplace/auction/YYYY-Make-Model/UUID
      document.querySelectorAll('a[href*="/marketplace/auction/"]').forEach(link => {
        const href = link.href;
        const match = href.match(/\/marketplace\/auction\/(\d{4})-([^\/]+)\/([a-f0-9-]+)/i);
        if (!match) return;

        const uuid = match[3];
        if (seen.has(uuid)) return;
        seen.add(uuid);

        const card = link.closest('div, article, li') || link.parentElement;
        const text = card?.innerText || '';

        // Parse from URL: 1967-Chevrolet-Chevelle
        const year = parseInt(match[1]);
        const makeModel = match[2].split('-');
        const make = makeModel[0];
        const model = makeModel.slice(1).join(' ');

        // Get price from text
        const priceMatch = text.match(/\$\s*([\d,]+)/);

        // Get image
        const img = card?.querySelector('img[src*="hagerty"], img[src*="cloudinary"]');

        results.push({
          url: href.split('?')[0].replace(/\/$/, ''),
          year,
          make,
          model,
          price: priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null,
          thumbnail: img?.src || null,
        });
      });

      return results;
    });

    return { success: true, listings, pageNum };
  } catch (e) {
    return { success: false, error: e.message, pageNum, listings: [] };
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
        discovery_source: 'hagerty',
        listing_source: 'hagerty-fast-discover',
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

async function worker(workerId, browser, pageQueue, stats) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  while (pageQueue.length > 0) {
    const pageNum = pageQueue.shift();
    if (pageNum === undefined) break;

    const result = await scrapePage(page, pageNum);

    if (result.success && result.listings.length > 0) {
      const { saved, skipped } = await saveListings(result.listings);
      stats.saved += saved;
      stats.skipped += skipped;
      stats.pages++;
      console.log(`[W${workerId}] Page ${pageNum}: ${result.listings.length} found, ${saved} new`);
    } else if (result.listings.length === 0) {
      console.log(`[W${workerId}] Page ${pageNum}: 0 listings`);
      stats.pages++;
    } else {
      stats.errors++;
    }
  }

  await context.close();
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Hagerty Marketplace FAST DISCOVER                         ║');
  console.log(`║  Pages: 1-${MAX_PAGES} | Workers: ${PARALLEL}                               ║`);
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  await loadExistingUrls();

  const browser = await chromium.launch({ headless: true });
  const pageQueue = Array.from({ length: MAX_PAGES }, (_, i) => i + 1);
  const stats = { saved: 0, skipped: 0, pages: 0, errors: 0 };

  const workers = [];
  for (let i = 0; i < PARALLEL; i++) {
    workers.push(worker(i, browser, pageQueue, stats));
  }

  await Promise.all(workers);
  await browser.close();

  console.log(`\n✅ Done! Saved ${stats.saved} new vehicles`);
}

main().catch(console.error);
