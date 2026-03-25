#!/usr/bin/env node
/**
 * bat-deep-discovery.mjs — Discover ALL BaT listing URLs via Playwright.
 *
 * The BaT listings-filter API only returns the newest ~9,900 items.
 * This script uses Playwright to click "Show More" on the results page
 * to paginate through ALL 234K+ listings.
 *
 * BaT loads ~36 items per "Show More" click. At 234K listings, that's
 * ~6,500 clicks. With 2-3s per click, this takes 4-6 hours.
 *
 * Usage:
 *   dotenvx run -- node scripts/bat-deep-discovery.mjs
 *   dotenvx run -- node scripts/bat-deep-discovery.mjs --max-pages 1000
 *   dotenvx run -- node scripts/bat-deep-discovery.mjs --dry-run
 *
 * Requirements: playwright installed (npx playwright install chromium)
 *
 * How it works:
 *   1. Opens BaT /auctions/results/ in headless Chrome
 *   2. Repeatedly clicks "Show More" to load all listings
 *   3. Extracts listing URLs from the DOM
 *   4. Deduplicates against all known URLs in DB
 *   5. Inserts new vehicles with basic metadata
 *   6. Queues into bat_extraction_queue for full extraction
 *
 * Rate: ~36 listings per click, ~2-3s per click
 * Expected new discoveries: ~70K URLs (from 165K → 235K)
 */

import pg from 'pg';
import { chromium } from 'playwright';

const client = new pg.Client({
  connectionString: 'postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
  statement_timeout: 55000,
});

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const MAX_PAGES = parseInt(args.find(a => a.startsWith('--max-pages='))?.split('=')[1] || '7000');
const FLUSH_EVERY = 500; // Flush to DB every N new URLs
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Load all known URLs ──
async function loadKnownUrls() {
  console.log('Loading known BaT URLs from all tables...');
  const known = new Set();

  const tables = [
    { table: 'vehicles', column: 'listing_url', filter: "listing_url LIKE '%bringatrailer.com/listing/%' AND deleted_at IS NULL" },
    { table: 'vehicles', column: 'bat_auction_url', filter: "bat_auction_url LIKE '%bringatrailer.com/listing/%' AND deleted_at IS NULL" },
    { table: 'vehicles', column: 'discovery_url', filter: "discovery_url LIKE '%bringatrailer.com/listing/%' AND deleted_at IS NULL" },
    { table: 'bat_extraction_queue', column: 'bat_url', filter: "bat_url LIKE '%bringatrailer.com/listing/%'" },
    { table: 'listing_page_snapshots', column: 'listing_url', filter: "platform = 'bat' AND listing_url LIKE '%bringatrailer.com/listing/%'" },
    { table: 'bat_listings', column: 'bat_listing_url', filter: "bat_listing_url LIKE '%bringatrailer.com/listing/%'" },
  ];

  for (const { table, column, filter } of tables) {
    let lastUrl = '';
    let count = 0;
    while (true) {
      const r = await client.query(`
        SELECT RTRIM(split_part(${column}, '#', 1), '/') as url
        FROM ${table}
        WHERE ${filter} AND ${column} > $1
        ORDER BY ${column} LIMIT 5000
      `, [lastUrl]);
      if (r.rows.length === 0) break;
      for (const row of r.rows) {
        if (row.url) known.add(row.url);
      }
      count += r.rows.length;
      lastUrl = r.rows[r.rows.length - 1].url || '';
    }
    console.log(`  ${table}.${column}: ${count.toLocaleString()} rows (${known.size.toLocaleString()} unique total)`);
  }

  console.log(`Total known: ${known.size.toLocaleString()} unique BaT listing URLs\n`);
  return known;
}

// ── Flush new URLs to DB ──
async function flushToDB(newUrls) {
  if (newUrls.length === 0) return 0;

  let inserted = 0;
  for (const url of newUrls) {
    try {
      // Insert into vehicles
      await client.query(`
        INSERT INTO vehicles (listing_url, bat_auction_url, auction_source, source, status)
        VALUES ($1, $1, 'bat', 'bat', 'discovered')
        ON CONFLICT DO NOTHING
      `, [url]);

      // Queue for extraction
      await client.query(`
        INSERT INTO bat_extraction_queue (bat_url, status, priority, created_at)
        VALUES ($1, 'pending', 5, NOW())
        ON CONFLICT (bat_url) DO NOTHING
      `, [url]);

      inserted++;
    } catch (e) {
      // Skip errors (duplicates, etc)
    }
  }

  // Breathe
  await client.query('SELECT pg_sleep(0.05)');
  return inserted;
}

// ── Main discovery loop ──
async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  BaT DEEP DISCOVERY (Playwright)                       ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Max pages: ${MAX_PAGES}, flush every: ${FLUSH_EVERY}`);
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

  await client.connect();
  const known = await loadKnownUrls();

  // Launch browser
  console.log('Launching headless Chrome...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  // Navigate to results page
  console.log('Navigating to BaT completed results...');
  await page.goto('https://bringatrailer.com/auctions/results/', {
    waitUntil: 'networkidle',
    timeout: 60000,
  });

  // Wait for initial listings
  await page.waitForSelector('a[href*="/listing/"]', { timeout: 30000 });

  let totalPages = 0;
  let totalFound = 0;
  let totalNew = 0;
  let totalInserted = 0;
  let consecutiveEmpty = 0;
  let pendingFlush = [];
  const startTime = Date.now();

  while (totalPages < MAX_PAGES && consecutiveEmpty < 10) {
    totalPages++;

    // Extract all visible listing URLs
    const urls = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/listing/"]'));
      return [...new Set(
        links
          .map(a => a.href)
          .filter(h => h.includes('/listing/') && !h.includes('#'))
          .map(h => h.replace(/\/$/, ''))
      )];
    });

    totalFound = urls.length; // Cumulative count of all visible URLs

    // Find new URLs
    const pageNew = [];
    for (const url of urls) {
      if (!known.has(url)) {
        known.add(url); // Mark as known immediately
        pageNew.push(url);
        pendingFlush.push(url);
      }
    }

    totalNew += pageNew.length;

    if (pageNew.length === 0) {
      consecutiveEmpty++;
    } else {
      consecutiveEmpty = 0;
    }

    // Flush to DB periodically
    if (pendingFlush.length >= FLUSH_EVERY && !DRY_RUN) {
      const batch = pendingFlush.splice(0);
      const inserted = await flushToDB(batch);
      totalInserted += inserted;
      console.log(`    Flushed ${batch.length} URLs → ${inserted} inserted`);
    }

    // Progress report
    if (totalPages % 50 === 0 || pageNew.length > 10) {
      const elapsed = (Date.now() - startTime) / 1000 / 60;
      const rate = totalPages / elapsed;
      console.log(`  Page ${totalPages}: ${totalFound.toLocaleString()} visible, ${totalNew.toLocaleString()} new, ${pageNew.length} this page — ${rate.toFixed(1)} pages/min`);
    }

    // Click "Show More"
    try {
      const showMore = await page.$('button:has-text("Show More"), .auctions-footer-button, [data-bind*="loadNextPage"]');
      if (!showMore) {
        console.log('  No "Show More" button found — end of results');
        break;
      }

      const isVisible = await showMore.isVisible();
      if (!isVisible) {
        // Check for loading spinner
        const loading = await page.$('.listing-loading, [data-bind*="itemsLoading"]');
        if (loading) {
          await sleep(3000);
          continue;
        }
        console.log('  Button not visible — end of results');
        break;
      }

      await showMore.scrollIntoViewIfNeeded();
      await sleep(500);
      await showMore.click();

      // Wait for new content
      await sleep(2000);
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    } catch (e) {
      console.log(`  Click error: ${e.message.slice(0, 80)}`);
      // Try scrolling to trigger lazy load
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(3000);
      consecutiveEmpty++;
    }
  }

  // Final flush
  if (pendingFlush.length > 0 && !DRY_RUN) {
    const inserted = await flushToDB(pendingFlush);
    totalInserted += inserted;
    console.log(`  Final flush: ${pendingFlush.length} URLs → ${inserted} inserted`);
  }

  await browser.close();

  // Print report
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  DISCOVERY COMPLETE                                     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Pages loaded: ${totalPages.toLocaleString()}`);
  console.log(`  Total URLs visible: ${totalFound.toLocaleString()}`);
  console.log(`  New URLs discovered: ${totalNew.toLocaleString()}`);
  console.log(`  Vehicles inserted: ${totalInserted.toLocaleString()}`);
  console.log(`  Time: ${elapsed} minutes`);
  console.log(`  Rate: ${(totalPages / parseFloat(elapsed)).toFixed(1)} pages/min`);

  // Final DB state
  const state = await client.query(`
    SELECT
      (SELECT count(*) FROM vehicles WHERE source = 'bat' AND deleted_at IS NULL)::int as vehicles,
      (SELECT count(*) FROM bat_extraction_queue WHERE status = 'pending')::int as pending
  `);
  const s = state.rows[0];
  console.log(`\n  DB state:`);
  console.log(`    BaT vehicles: ${s.vehicles.toLocaleString()}`);
  console.log(`    Queue pending: ${s.pending.toLocaleString()}`);

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
