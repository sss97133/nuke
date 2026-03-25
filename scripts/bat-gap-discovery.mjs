#!/usr/bin/env node
/**
 * bat-gap-discovery.mjs — Close the BaT listing gap.
 *
 * Status as of 2026-03-25:
 *   - BaT API reports: 234,943 total listings
 *   - We have: 165,339 unique clean URLs across all tables (204K was inflated by comment fragments)
 *   - TRUE gap: ~69,600 undiscovered listings
 *   - bat_extraction_queue: 30.5K genuinely pending (after reconciling 96K + clearing 39K comment URLs)
 *
 * Strategy:
 *   Phase 1: Crawl BaT listings-filter API with proper rate limiting (3-5s delays)
 *            API returns newest ~9,900 items (275 pages × 36 items).
 *   Phase 2: Deduplicate against ALL known URLs (vehicles, bat_extraction_queue, snapshots, bat_listings)
 *   Phase 3: Insert new vehicles with API metadata (year/make/model/price/GPS/sale_date)
 *   Phase 4: Queue into bat_extraction_queue for full page extraction
 *   Phase 5: Mark queue entries that already have vehicles as 'complete'
 *
 * The API has a 275-page hard limit (returns 0 items beyond that).
 * This script gets the newest ~9,900 listings. For deeper discovery,
 * use bat-discover-all-urls.ts (Playwright-based Show More clicking).
 *
 * Usage:
 *   dotenvx run -- node scripts/bat-gap-discovery.mjs
 *   dotenvx run -- node scripts/bat-gap-discovery.mjs --dry-run
 *   dotenvx run -- node scripts/bat-gap-discovery.mjs --api-only   # Skip DB operations
 *   dotenvx run -- node scripts/bat-gap-discovery.mjs --reconcile  # Just fix queue vs vehicles
 */

import pg from 'pg';

const DB_URL = 'postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres';

function makeClient() {
  return new pg.Client({ connectionString: DB_URL, statement_timeout: 55000 });
}

let client = makeClient();

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const API_ONLY = args.includes('--api-only');
const RECONCILE_ONLY = args.includes('--reconcile');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const API_BASE = 'https://bringatrailer.com/wp-json/bringatrailer/1.0/data/listings-filter';

// ── Title parser ──
function parseTitle(title) {
  if (!title) return { year: null, make: null, model: null };
  let clean = title
    .replace(/&#0?38;/g, '&').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&')
    .replace(/^\d+k?-mile\s+/i, '')
    .replace(/^no[- ]reserve:?\s*/i, '')
    .replace(/^modified\s+/i, '')
    .replace(/^euro[- ]?spec\s+/i, '')
    .replace(/^original[- ]owner\s+/i, '')
    .replace(/^single[- ]owner\s+/i, '')
    .replace(/^one[- ]owner\s+/i, '')
    .trim();

  const yearMatch = clean.match(/\b(19\d{2}|20[0-2]\d)\b/);
  const year = yearMatch ? parseInt(yearMatch[1]) : null;
  if (!year) return { year: null, make: null, model: null };

  const afterYear = clean.substring(clean.indexOf(String(year)) + 4).trim();
  const parts = afterYear.split(/\s+/);
  if (parts.length === 0) return { year, make: null, model: null };

  const multiMakes = {
    'alfa romeo': 2, 'aston martin': 2, 'austin healey': 2, 'austin-healey': 1,
    'de tomaso': 2, 'land rover': 2, 'mercedes benz': 2, 'mercedes-benz': 1,
    'rolls royce': 2, 'rolls-royce': 1,
  };

  let make, modelStart;
  const twoWord = parts.slice(0, 2).join(' ').toLowerCase();
  if (multiMakes[twoWord]) {
    make = parts.slice(0, 2).join(' ');
    modelStart = 2;
  } else {
    make = parts[0];
    modelStart = 1;
  }

  const model = parts.slice(modelStart).join(' ') || null;
  return { year, make: make || null, model: model || null };
}

// ── Phase 1: Crawl BaT API ──
async function crawlApi() {
  console.log('=== Phase 1: Crawling BaT listings-filter API ===');

  const probe = await fetch(`${API_BASE}?page=1&get_items=true`, {
    headers: { 'User-Agent': UA },
  });
  const probeData = await probe.json();
  const totalItems = probeData.items_total;
  const totalPages = probeData.pages_total;
  console.log(`  BaT total catalog: ${totalItems.toLocaleString()} listings (${totalPages.toLocaleString()} pages)`);
  console.log(`  API accessible: ~275 pages × 36 = ~9,900 newest items`);

  const allListings = new Map();

  // Process first page
  for (const item of probeData.items || []) {
    const url = item.url?.replace(/\/$/, '');
    if (url && url.includes('/listing/')) allListings.set(url, item);
  }

  let page = 2;
  let baseDelay = 3000; // 3s between requests (BaT rate limits at < 2s)
  let consecutive429 = 0;
  let emptyPages = 0;
  const MAX_EMPTY = 5;
  const startTime = Date.now();

  while (page <= 280 && emptyPages < MAX_EMPTY) {
    try {
      const res = await fetch(`${API_BASE}?page=${page}&get_items=true`, {
        headers: { 'User-Agent': UA },
      });

      if (res.status === 429) {
        consecutive429++;
        const backoff = Math.min(5000 * Math.pow(2, consecutive429 - 1), 120000);
        console.log(`  Page ${page}: 429 — backing off ${(backoff / 1000).toFixed(0)}s (attempt ${consecutive429})`);
        baseDelay = Math.min(baseDelay + 1000, 8000);
        await sleep(backoff);
        continue; // Retry same page
      }

      consecutive429 = 0;

      if (!res.ok) {
        console.log(`  Page ${page}: HTTP ${res.status}`);
        emptyPages++;
        page++;
        await sleep(baseDelay * 2);
        continue;
      }

      const data = await res.json();
      const items = data.items || [];

      if (items.length === 0) {
        emptyPages++;
      } else {
        emptyPages = 0;
        for (const item of items) {
          const url = item.url?.replace(/\/$/, '');
          if (url && url.includes('/listing/')) allListings.set(url, item);
        }
      }

      if (page % 25 === 0) {
        const elapsed = (Date.now() - startTime) / 1000 / 60;
        const rate = (page - 1) / Math.max(elapsed, 0.1);
        const remaining = (275 - page) / rate;
        console.log(`  Page ${page}/275: ${allListings.size.toLocaleString()} listings — ${rate.toFixed(1)} pages/min — ETA ${remaining.toFixed(0)} min`);
      }

      page++;
      await sleep(baseDelay);
    } catch (e) {
      console.log(`  Page ${page} error: ${e.message}`);
      page++;
      await sleep(baseDelay * 2);
    }
  }

  console.log(`  API crawl complete: ${allListings.size.toLocaleString()} listings from ${page - 1} pages`);
  return { allListings, totalItems };
}

// ── Phase 2: Load all known URLs and find gaps ──
async function findGaps(allListings) {
  console.log('\n=== Phase 2: Loading known URLs and finding gaps ===');

  const known = new Set();

  // Load from vehicles
  let lastUrl = '';
  let batVehicles = 0;
  while (true) {
    const r = await client.query(`
      SELECT COALESCE(RTRIM(bat_auction_url, '/'), RTRIM(listing_url, '/'), RTRIM(discovery_url, '/')) as url
      FROM vehicles
      WHERE deleted_at IS NULL
        AND (bat_auction_url LIKE '%bringatrailer.com/listing/%'
          OR listing_url LIKE '%bringatrailer.com/listing/%'
          OR discovery_url LIKE '%bringatrailer.com/listing/%')
        AND COALESCE(bat_auction_url, listing_url, discovery_url) > $1
      ORDER BY COALESCE(bat_auction_url, listing_url, discovery_url)
      LIMIT 5000
    `, [lastUrl]);
    if (r.rows.length === 0) break;
    for (const row of r.rows) {
      if (row.url) known.add(row.url.replace(/\/$/, ''));
    }
    batVehicles += r.rows.length;
    lastUrl = r.rows[r.rows.length - 1].url || '';
  }
  console.log(`  vehicles: ${batVehicles.toLocaleString()} BaT URLs (${known.size.toLocaleString()} unique)`);

  // Load from bat_extraction_queue
  let lastQUrl = '';
  let queueCount = 0;
  while (true) {
    const r = await client.query(`
      SELECT RTRIM(bat_url, '/') as url FROM bat_extraction_queue
      WHERE bat_url LIKE '%bringatrailer.com/listing/%' AND bat_url > $1
      ORDER BY bat_url LIMIT 5000
    `, [lastQUrl]);
    if (r.rows.length === 0) break;
    for (const row of r.rows) {
      if (row.url) known.add(row.url);
    }
    queueCount += r.rows.length;
    lastQUrl = r.rows[r.rows.length - 1].url || '';
  }
  console.log(`  bat_extraction_queue: ${queueCount.toLocaleString()} URLs (${known.size.toLocaleString()} unique total)`);

  // Load from snapshots
  let lastSUrl = '';
  let snapCount = 0;
  while (true) {
    const r = await client.query(`
      SELECT RTRIM(listing_url, '/') as url FROM listing_page_snapshots
      WHERE platform = 'bat' AND listing_url LIKE '%bringatrailer.com/listing/%' AND listing_url > $1
      ORDER BY listing_url LIMIT 5000
    `, [lastSUrl]);
    if (r.rows.length === 0) break;
    for (const row of r.rows) {
      if (row.url) known.add(row.url);
    }
    snapCount += r.rows.length;
    lastSUrl = r.rows[r.rows.length - 1].url || '';
  }
  console.log(`  listing_page_snapshots: ${snapCount.toLocaleString()} URLs (${known.size.toLocaleString()} unique total)`);

  // Load from bat_listings
  let lastLUrl = '';
  let listCount = 0;
  while (true) {
    const r = await client.query(`
      SELECT RTRIM(bat_listing_url, '/') as url FROM bat_listings
      WHERE bat_listing_url LIKE '%bringatrailer.com/listing/%' AND bat_listing_url > $1
      ORDER BY bat_listing_url LIMIT 5000
    `, [lastLUrl]);
    if (r.rows.length === 0) break;
    for (const row of r.rows) {
      if (row.url) known.add(row.url);
    }
    listCount += r.rows.length;
    lastLUrl = r.rows[r.rows.length - 1].url || '';
  }
  console.log(`  bat_listings: ${listCount.toLocaleString()} URLs (${known.size.toLocaleString()} unique total)`);

  // Find new URLs from API crawl
  const newListings = [];
  for (const [url, listing] of allListings) {
    if (!known.has(url)) {
      newListings.push({ url, listing });
    }
  }

  console.log(`\n  Known BaT URLs: ${known.size.toLocaleString()}`);
  console.log(`  API returned: ${allListings.size.toLocaleString()}`);
  console.log(`  NEW (not in any table): ${newListings.length.toLocaleString()}`);

  return { known, newListings };
}

// ── Phase 3: Insert new vehicles ──
async function insertNewVehicles(newListings) {
  if (newListings.length === 0) {
    console.log('\n=== Phase 3: No new vehicles to insert ===');
    return 0;
  }
  console.log(`\n=== Phase 3: Inserting ${newListings.length.toLocaleString()} new vehicles ===`);

  if (DRY_RUN) {
    console.log('  [DRY RUN] Would insert:');
    for (const { url, listing } of newListings.slice(0, 10)) {
      console.log(`    ${listing.title?.slice(0, 60)} — ${url}`);
    }
    if (newListings.length > 10) console.log(`    ... and ${newListings.length - 10} more`);
    return 0;
  }

  let inserted = 0, failed = 0;
  for (const { url, listing } of newListings) {
    try {
      const parsed = parseTitle(listing.title);
      const saleDate = listing.timestamp_end
        ? new Date(listing.timestamp_end * 1000).toISOString()
        : null;
      const title = (listing.title || '')
        .replace(/&#0?38;/g, '&').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');

      await client.query(`
        INSERT INTO vehicles (
          listing_url, bat_auction_url, auction_source, source, status,
          year, make, model, title, listing_title,
          sale_price,
          gps_latitude, gps_longitude,
          sale_date,
          reserve_status
        ) VALUES (
          $1, $1, 'bat', 'bat', 'discovered',
          $2, $3, $4, $5, $5,
          $6,
          $7, $8,
          $9,
          $10
        )
        ON CONFLICT DO NOTHING
      `, [
        url,
        parsed.year,
        parsed.make,
        parsed.model,
        title,
        listing.current_bid || null,
        listing.lat || null,
        listing.lon || null,
        saleDate,
        listing.noreserve ? 'no_reserve' : null,
      ]);
      inserted++;
    } catch (e) {
      failed++;
      if (failed <= 5) console.log(`  Insert error: ${e.message.slice(0, 100)}`);
    }

    if (inserted % 500 === 0 && inserted > 0) {
      console.log(`  ${inserted.toLocaleString()} inserted, ${failed} failed`);
      await client.query('SELECT pg_sleep(0.05)');
    }
  }

  console.log(`  Insert complete: ${inserted.toLocaleString()} new, ${failed} failed`);
  return inserted;
}

// ── Phase 4: Queue into bat_extraction_queue ──
async function queueForExtraction(newListings) {
  if (newListings.length === 0) return 0;
  console.log(`\n=== Phase 4: Queuing ${newListings.length.toLocaleString()} URLs for extraction ===`);

  if (DRY_RUN) {
    console.log('  [DRY RUN] Would queue URLs');
    return 0;
  }

  let queued = 0;
  const BATCH = 50;
  for (let i = 0; i < newListings.length; i += BATCH) {
    const batch = newListings.slice(i, i + BATCH);
    for (const { url } of batch) {
      try {
        await client.query(`
          INSERT INTO bat_extraction_queue (bat_url, status, priority, created_at)
          VALUES ($1, 'pending', 5, NOW())
          ON CONFLICT (bat_url) DO NOTHING
        `, [url]);
        queued++;
      } catch (e) {
        // Skip duplicates
      }
    }
    if ((i + BATCH) % 500 === 0) {
      console.log(`  Queued ${queued.toLocaleString()} so far`);
      await client.query('SELECT pg_sleep(0.05)');
    }
  }

  console.log(`  Queue complete: ${queued.toLocaleString()} new entries`);
  return queued;
}

// ── Phase 5: Reconcile queue vs vehicles ──
async function reconcileQueue() {
  console.log('\n=== Phase 5: Reconciling bat_extraction_queue vs vehicles ===');

  if (DRY_RUN) {
    const r = await client.query(`
      SELECT count(*) as cnt FROM bat_extraction_queue beq
      WHERE beq.status = 'pending'
      AND EXISTS (
        SELECT 1 FROM vehicles v
        WHERE v.listing_url = beq.bat_url OR v.bat_auction_url = beq.bat_url
      )
    `);
    console.log(`  [DRY RUN] Would mark ${r.rows[0].cnt} queue entries as 'complete' (vehicle exists)`);
    return 0;
  }

  // Mark queue entries as complete where vehicle already exists
  let totalMarked = 0;
  while (true) {
    const r = await client.query(`
      WITH to_mark AS (
        SELECT beq.id FROM bat_extraction_queue beq
        WHERE beq.status = 'pending'
        AND EXISTS (
          SELECT 1 FROM vehicles v
          WHERE v.listing_url = beq.bat_url OR v.bat_auction_url = beq.bat_url
        )
        LIMIT 1000
      )
      UPDATE bat_extraction_queue SET status = 'complete', completed_at = NOW()
      WHERE id IN (SELECT id FROM to_mark)
    `);
    const affected = r.rowCount || 0;
    if (affected === 0) break;
    totalMarked += affected;
    console.log(`  Marked ${totalMarked.toLocaleString()} as complete so far`);
    await client.query('SELECT pg_sleep(0.1)');
  }

  console.log(`  Reconciliation complete: ${totalMarked.toLocaleString()} queue entries marked as 'complete'`);

  // Check lock impact
  const locks = await client.query(`SELECT count(*) as cnt FROM pg_stat_activity WHERE wait_event_type='Lock'`);
  if (parseInt(locks.rows[0].cnt) > 0) {
    console.log(`  WARNING: ${locks.rows[0].cnt} lock waiters detected!`);
  }

  return totalMarked;
}

// ── Main ──
async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  BaT GAP DISCOVERY                                     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : RECONCILE_ONLY ? 'RECONCILE ONLY' : API_ONLY ? 'API ONLY' : 'FULL'}`);
  console.log('');

  await client.connect();

  // Get current state
  const state = await client.query(`
    SELECT
      (SELECT count(*) FROM vehicles WHERE source = 'bat' AND deleted_at IS NULL)::int as vehicles,
      (SELECT count(*) FROM bat_extraction_queue)::int as queue_total,
      (SELECT count(*) FROM bat_extraction_queue WHERE status = 'pending')::int as queue_pending,
      (SELECT count(*) FROM listing_page_snapshots WHERE platform = 'bat' AND success = true)::int as snapshots
  `);
  const s = state.rows[0];
  console.log(`  Current state:`);
  console.log(`    BaT vehicles: ${s.vehicles.toLocaleString()}`);
  console.log(`    Extraction queue: ${s.queue_total.toLocaleString()} total, ${s.queue_pending.toLocaleString()} pending`);
  console.log(`    Snapshots: ${s.snapshots.toLocaleString()}`);
  console.log('');

  if (RECONCILE_ONLY) {
    await reconcileQueue();
    await printFinalStats();
    await client.end();
    return;
  }

  // Close DB during long API crawl (prevents stale connection errors)
  await client.end();

  // Phase 1: Crawl API
  const { allListings, totalItems } = await crawlApi();

  // Reconnect to DB for Phases 2-5
  client = makeClient();
  await client.connect();

  if (API_ONLY) {
    console.log(`\n  API returned ${allListings.size.toLocaleString()} / ${totalItems.toLocaleString()} total`);
    console.log(`  Estimated gap: ~${(totalItems - s.vehicles).toLocaleString()} listings`);
    await client.end();
    return;
  }

  // Phase 2: Find gaps
  const { known, newListings } = await findGaps(allListings);

  // Phase 3: Insert new vehicles
  const inserted = await insertNewVehicles(newListings);

  // Phase 4: Queue for extraction
  const queued = await queueForExtraction(newListings);

  // Phase 5: Reconcile
  const reconciled = await reconcileQueue();

  // Final report
  await printFinalStats();

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  SUMMARY                                                ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  BaT total catalog: ${totalItems.toLocaleString()}`);
  console.log(`  Known URLs before: ${known.size.toLocaleString()}`);
  console.log(`  API returned: ${allListings.size.toLocaleString()}`);
  console.log(`  New URLs discovered: ${newListings.length.toLocaleString()}`);
  console.log(`  Vehicles inserted: ${inserted.toLocaleString()}`);
  console.log(`  Queued for extraction: ${queued.toLocaleString()}`);
  console.log(`  Queue entries reconciled: ${reconciled.toLocaleString()}`);
  console.log(`  Remaining gap: ~${(totalItems - known.size - newListings.length).toLocaleString()} listings`);
  console.log('');
  console.log('  To discover the deeper gap (~20K+ older listings):');
  console.log('    dotenvx run -- npx tsx scripts/bat-discover-all-urls.ts');
  console.log('  (Playwright-based — clicks Show More through all 6,500+ pages)');

  await client.end();
}

async function printFinalStats() {
  const stats = await client.query(`
    SELECT
      (SELECT count(*) FROM vehicles WHERE source = 'bat' AND deleted_at IS NULL)::int as vehicles,
      (SELECT count(*) FROM bat_extraction_queue WHERE status = 'pending')::int as queue_pending,
      (SELECT count(*) FROM bat_extraction_queue WHERE status = 'complete')::int as queue_complete,
      (SELECT count(*) FROM bat_extraction_queue WHERE status = 'failed')::int as queue_failed
  `);
  const s = stats.rows[0];
  console.log(`\n  Final state:`);
  console.log(`    BaT vehicles: ${s.vehicles.toLocaleString()}`);
  console.log(`    Queue: ${s.queue_pending.toLocaleString()} pending, ${s.queue_complete.toLocaleString()} complete, ${s.queue_failed.toLocaleString()} failed`);
}

main().catch(e => { console.error(e); process.exit(1); });
