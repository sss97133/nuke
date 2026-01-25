#!/usr/bin/env node
/**
 * Mecum FAST DISCOVER - Scrape auction catalog pages
 * Gets: price, year, make, model, thumbnail, URL
 */

import { chromium } from 'playwright';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAX_PAGES = parseInt(process.argv[2]) || 500;
const PARALLEL = parseInt(process.argv[3]) || 3;

// Mecum auction slugs to scrape
const AUCTIONS = [
  'kissimmee-2025', 'kissimmee-2024', 'kissimmee-2023',
  'monterey-2025', 'monterey-2024', 'monterey-2023',
  'indy-2025', 'indy-2024', 'indy-2023',
  'glendale-2025', 'glendale-2024', 'glendale-2023',
  'las-vegas-2024', 'las-vegas-2023',
  'houston-2024', 'houston-2023',
  'harrisburg-2024', 'harrisburg-2023',
  'dallas-fort-worth-2024', 'dallas-fort-worth-2023',
  'kansas-city-2024', 'kansas-city-2023',
];

let existingUrls = new Set();

async function loadExistingUrls() {
  console.log('Loading existing Mecum URLs...');
  let offset = 0;
  const limit = 1000;
  let allUrls = [];

  while (true) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.mecum&select=discovery_url&limit=${limit}&offset=${offset}`, {
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

async function scrapeAuctionPage(page, auctionSlug, pageNum) {
  const url = `https://www.mecum.com/auctions/${auctionSlug}/lots/?page=${pageNum}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Scroll to load lazy content
    await page.evaluate(() => window.scrollTo(0, 2000));
    await page.waitForTimeout(1500);

    const listings = await page.evaluate(() => {
      const results = [];
      const seen = new Set();

      // Mecum pattern: /lots/[ID]/[year]-[make]-[model]/
      document.querySelectorAll('a[href*="/lots/"]').forEach(link => {
        const href = link.href;
        const match = href.match(/\/lots\/(\d+)\/(\d{4})-([^\/]+)/);
        if (!match) return;

        const lotId = match[1];
        if (seen.has(lotId)) return;
        seen.add(lotId);

        const card = link.closest('div, article, li') || link.parentElement;
        const text = card?.innerText || '';

        // Parse from URL: 1967-jaguar-e-type-series-i-roadster
        const year = parseInt(match[2]);
        const slug = match[3].replace(/-/g, ' ');
        const parts = slug.split(' ');
        const make = parts[0];
        const model = parts.slice(1).join(' ');

        // Get price from text
        const priceMatch = text.match(/\$[\d,]+/);

        // Get image
        const img = card?.querySelector('img[src*="mecum"], img[src*="cloudfront"]');

        results.push({
          url: href.split('?')[0].replace(/\/$/, ''),
          lotId,
          year,
          make,
          model,
          price: priceMatch ? parseInt(priceMatch[0].replace(/[$,]/g, '')) : null,
          thumbnail: img?.src || null,
        });
      });

      return results;
    });

    return { success: true, listings, pageNum, auctionSlug };
  } catch (e) {
    return { success: false, error: e.message, pageNum, auctionSlug, listings: [] };
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
        discovery_source: 'mecum',
        listing_source: 'mecum-fast-discover',
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

async function worker(workerId, browser, jobQueue, stats) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  while (jobQueue.length > 0) {
    const job = jobQueue.shift();
    if (!job) break;

    const result = await scrapeAuctionPage(page, job.auction, job.page);

    if (result.success && result.listings.length > 0) {
      const { saved, skipped } = await saveListings(result.listings);
      stats.saved += saved;
      stats.skipped += skipped;
      stats.pages++;
      console.log(`[W${workerId}] ${job.auction} p${job.page}: ${result.listings.length} found, ${saved} new`);
    } else if (result.listings.length === 0) {
      stats.pages++;
    } else {
      stats.errors++;
    }
  }

  await context.close();
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Mecum FAST DISCOVER                                       ║');
  console.log(`║  Auctions: ${AUCTIONS.length} | Pages/auction: ${MAX_PAGES} | Workers: ${PARALLEL}       ║`);
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  await loadExistingUrls();

  const browser = await chromium.launch({ headless: true });

  // Build job queue: each auction × pages
  const jobQueue = [];
  for (const auction of AUCTIONS) {
    for (let p = 1; p <= 50; p++) { // Most auctions have <50 pages
      jobQueue.push({ auction, page: p });
    }
  }

  const stats = { saved: 0, skipped: 0, pages: 0, errors: 0 };

  const workers = [];
  for (let i = 0; i < PARALLEL; i++) {
    workers.push(worker(i, browser, jobQueue, stats));
  }

  await Promise.all(workers);
  await browser.close();

  console.log(`\n✅ Done! Saved ${stats.saved} new vehicles`);
}

main().catch(console.error);
