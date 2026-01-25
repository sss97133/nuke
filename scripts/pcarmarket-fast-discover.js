#!/usr/bin/env node
/**
 * PCarMarket FAST DISCOVER - Scrape all listing cards
 * Gets: price, year, make, model, thumbnail, URL
 */

import { chromium } from 'playwright';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAX_PAGES = parseInt(process.argv[2]) || 200;
const PARALLEL = parseInt(process.argv[3]) || 3;

let existingUrls = new Set();

async function loadExistingUrls() {
  console.log('Loading existing PCarMarket URLs...');
  let offset = 0;
  const limit = 1000;
  let allUrls = [];

  while (true) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.pcarmarket&select=discovery_url&limit=${limit}&offset=${offset}`, {
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
  // PCarMarket: scrape both auctions and marketplace, paginated via scroll
  const urls = pageNum <= 100
    ? [`https://pcarmarket.com/auctions/`]
    : [`https://pcarmarket.com/marketplace/`];

  const allListings = [];

  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(2000);

      // Scroll to load more
      for (let i = 0; i < pageNum; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1000);
      }

      const listings = await page.evaluate(() => {
        const results = [];
        const seen = new Set();

        // PCarMarket uses /auction/[slug] pattern
        document.querySelectorAll('a[href*="/auction/"]').forEach(link => {
          const href = link.href;
          if (!href.match(/\/auction\/[a-z0-9-]+/i)) return;

          const slug = href.match(/\/auction\/([^\/\?]+)/)?.[1];
          if (!slug || seen.has(slug) || slug === 'submit-your-listing') return;

          // MUST start with 4-digit year to be a vehicle (filters out signs, memorabilia)
          const slugMatch = slug.match(/^(\d{4})-([a-z]+)-(.+)/i);
          if (!slugMatch) return; // Skip non-vehicle items

          seen.add(slug);

          const card = link.closest('div, article, li') || link.parentElement;
          const text = card?.innerText || '';

          // Get price from text
          const priceMatch = text.match(/\$[\d,]+/);

          // Get image
          const img = card?.querySelector('img[src*="pcarmarket"], img[src*="cloudfront"]');

          const year = parseInt(slugMatch[1]);
          const make = slugMatch[2];
          const model = slugMatch[3].replace(/-/g, ' ');

          // Validate year is reasonable (1900-2030)
          if (year < 1900 || year > 2030) return;

          results.push({
            url: href.split('?')[0].replace(/\/$/, ''),
            year,
            make,
            model,
            price: priceMatch ? parseInt(priceMatch[0].replace(/[$,]/g, '')) : null,
            thumbnail: img?.src || null,
          });
        });

        return results;
      });

      allListings.push(...listings);
    } catch (e) {
      console.log(`Error on ${url}: ${e.message}`);
    }
  }

  return { success: true, listings: allListings, pageNum };
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
        make: listing.make || 'Porsche',
        model: listing.model,
        sale_price: listing.price,
        discovery_url: normalizedUrl,
        discovery_source: 'pcarmarket',
        listing_source: 'pcarmarket-fast-discover',
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
      stats.pages++;
      console.log(`[W${workerId}] Page ${pageNum}: ${result.listings.length} found, ${saved} new, ${skipped} exist`);
    } else if (result.listings.length === 0) {
      console.log(`[W${workerId}] Page ${pageNum}: 0 listings (end?)`);
      stats.pages++;
    } else {
      console.log(`[W${workerId}] Page ${pageNum}: FAILED`);
      stats.errors++;
    }
  }

  await context.close();
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  PCarMarket FAST DISCOVER                                  ║');
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
