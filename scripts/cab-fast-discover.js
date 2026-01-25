#!/usr/bin/env node
/**
 * C&B FAST DISCOVER - Scrape all listing cards from past-auctions pages
 * Gets: price, year, make, model, thumbnail, URL
 * Target: 670+ pages in minutes, not days
 */

import { chromium } from 'playwright';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const START_PAGE = parseInt(process.argv[2]) || 1;
const END_PAGE = parseInt(process.argv[3]) || 700;
const PARALLEL = parseInt(process.argv[4]) || 3;

const CAB_ORG_ID = "4dac1878-b3fc-424c-9e92-3cf552f1e053";

// Global cache of existing URLs
let existingUrls = new Set();

async function loadExistingUrls() {
  console.log('Loading existing C&B URLs...');
  let offset = 0;
  const limit = 1000;
  let allUrls = [];

  while (true) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.carsandbids&select=discovery_url&limit=${limit}&offset=${offset}`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
    });
    const data = await res.json();
    if (data.length === 0) break;
    allUrls = allUrls.concat(data);
    offset += limit;
    process.stdout.write(`  ${allUrls.length} loaded...\r`);
  }

  existingUrls = new Set(allUrls.map(v => v.discovery_url?.toLowerCase().replace(/\/$/, '')).filter(Boolean));
  console.log(`Loaded ${existingUrls.size} existing URLs\n`);
}

async function scrapePage(page, pageNum) {
  const url = `https://carsandbids.com/past-auctions/?page=${pageNum}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Extract all listing cards
    const rawListings = await page.evaluate(() => {
      const seen = new Set();
      const results = [];

      document.querySelectorAll('a[href*="/auctions/"]').forEach(link => {
        const href = link.href;
        // Match auction URLs like /auctions/ABC123/2022-chevrolet-corvette
        const urlMatch = href.match(/\/auctions\/([A-Za-z0-9]+)\/(\d{4})-([^\/]+)/);
        if (!urlMatch) return;

        const auctionId = urlMatch[1];
        if (seen.has(auctionId)) return;
        seen.add(auctionId);

        const card = link.closest('li, article, div') || link;
        const cardText = card.innerText || '';

        // Get price from card text
        const priceMatch = cardText.match(/(?:Sold for|Bid to|Reserve not met at)\s*\$?([\d,]+)/i);

        // Get image
        const img = card.querySelector('img[src*="carsandbids"]');

        // Parse YMM from URL slug: 2022-chevrolet-corvette-stingray-coupe
        const slug = urlMatch[3]; // chevrolet-corvette-stingray-coupe
        const parts = slug.split('-');
        const make = parts[0];
        const model = parts.slice(1).join(' ');

        results.push({
          url: href.replace(/\/$/, ''),
          year: parseInt(urlMatch[2]),
          make: make,
          model: model,
          price: priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null,
          thumbnail: img?.src || null,
          status: cardText.includes('Sold') ? 'sold' : cardText.includes('Reserve not met') ? 'reserve_not_met' : 'ended',
        });
      });

      return results;
    });

    return { success: true, listings: rawListings, pageNum };
  } catch (e) {
    return { success: false, error: e.message, pageNum, listings: [] };
  }
}

async function saveListings(listings) {
  let saved = 0, skipped = 0, failed = 0;

  for (const listing of listings) {
    if (!listing.url) continue;

    // Normalize URL to lowercase for consistent matching
    const normalizedUrl = listing.url.toLowerCase().replace(/\/$/, '');

    // Check in-memory cache (super fast)
    if (existingUrls.has(normalizedUrl)) {
      skipped++;
      continue;
    }

    try {

    // Insert vehicle
    const vehicleData = {
      year: listing.year,
      make: listing.make,
      model: listing.model,
      sale_price: listing.price,
      discovery_url: normalizedUrl,
      discovery_source: 'carsandbids',
      listing_source: 'cab-fast-discover',
      status: listing.status?.includes('sold') ? 'sold' : 'active',
      auction_status: listing.status || null,
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

      // Save thumbnail as image
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
            source_url: listing.thumbnail,
            is_external: true,
            is_primary: true,
            approval_status: 'auto_approved',
            is_approved: true,
            position: 0,
          }),
        }).catch(() => {});
      }

      // Link to org
      if (vehicle?.id) {
        await fetch(`${SUPABASE_URL}/rest/v1/organization_vehicles`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=ignore-duplicates'
          },
          body: JSON.stringify({
            organization_id: CAB_ORG_ID,
            vehicle_id: vehicle.id,
            relationship_type: 'consigner',
            status: 'active',
            auto_tagged: true,
          }),
        });
      }

      saved++;
      existingUrls.add(normalizedUrl); // Add to cache
    } else {
      // Insert failed - likely duplicate or constraint violation
      const errText = await res.text().catch(() => 'unknown');
      if (!errText.includes('duplicate') && !errText.includes('23505')) {
        console.log(`    Insert failed: ${errText.slice(0, 50)}`);
      }
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
      const { saved, skipped, failed } = await saveListings(result.listings);
      stats.saved += saved;
      stats.skipped += skipped;
      stats.failed = (stats.failed || 0) + (failed || 0);
      stats.pages++;
      console.log(`[W${workerId}] Page ${pageNum}: ${result.listings.length} found, ${saved} new, ${skipped} exist, ${failed || 0} failed`);
    } else if (!result.success) {
      console.log(`[W${workerId}] Page ${pageNum}: FAILED - ${result.error?.slice(0, 50)}`);
      stats.errors++;
    } else {
      console.log(`[W${workerId}] Page ${pageNum}: 0 listings (end of results?)`);
      stats.pages++;
    }
  }

  await context.close();
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  C&B FAST DISCOVER - Thumbnail Scraper                     ║');
  console.log(`║  Pages: ${START_PAGE}-${END_PAGE} | Workers: ${PARALLEL}                            ║`);
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Load existing URLs into memory for fast lookup
  await loadExistingUrls();

  const startTime = Date.now();
  const browser = await chromium.launch({ headless: true });

  // Build page queue
  const pageQueue = [];
  for (let i = START_PAGE; i <= END_PAGE; i++) {
    pageQueue.push(i);
  }

  const stats = { saved: 0, skipped: 0, pages: 0, errors: 0 };

  // Launch workers
  const workers = [];
  for (let i = 0; i < PARALLEL; i++) {
    workers.push(worker(i, browser, pageQueue, stats));
  }

  await Promise.all(workers);
  await browser.close();

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n✅ Done in ${elapsed} min`);
  console.log(`   Pages: ${stats.pages} | New: ${stats.saved} | Skipped: ${stats.skipped} | Errors: ${stats.errors}`);
}

main().catch(console.error);
