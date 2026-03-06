#!/usr/bin/env node
/**
 * bat-backfill-overnight.cjs
 *
 * Backfills all missing BaT vehicles using BaT's REST API.
 *
 * Discovery: BaT exposes a listings-filter endpoint that returns structured
 * data for all 231K+ completed auctions — URL, title, price, GPS, comments,
 * country, timestamps. No auth needed.
 *
 * Phase 1: Crawl BaT API to discover all listing URLs + metadata (~6,442 pages)
 * Phase 2: Compare against existing vehicles table
 * Phase 3: Upsert missing vehicles with API data (title parse → year/make/model)
 * Phase 4: Queue missing listing page fetches for full extraction
 *
 * Usage: dotenvx run -- node scripts/bat-backfill-overnight.cjs
 *        dotenvx run -- node scripts/bat-backfill-overnight.cjs --start-page 1000
 *        dotenvx run -- node scripts/bat-backfill-overnight.cjs --phase 3  (skip to phase 3)
 */

const pg = require('pg');

const client = new pg.Client({
  connectionString: 'postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
  statement_timeout: 55000,
});

const args = process.argv.slice(2);
const START_PAGE = parseInt(args.find(a => a.startsWith('--start-page='))?.split('=')[1] || '1');
const SKIP_TO_PHASE = parseInt(args.find(a => a.startsWith('--phase='))?.split('=')[1] || '1');
const FETCH_WORKERS = parseInt(args.find(a => a.startsWith('--fetch-workers='))?.split('=')[1] || '3');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const API_BASE = 'https://bringatrailer.com/wp-json/bringatrailer/1.0/data/listings-filter';

// ── Title parser: "Modified 1968 Chevrolet Camaro Coupe 6-Speed" → {year, make, model} ──
function parseTitle(title) {
  if (!title) return { year: null, make: null, model: null };

  // Strip common prefixes
  let clean = title
    .replace(/^\d+k?-mile\s+/i, '')
    .replace(/^no[- ]reserve:?\s*/i, '')
    .replace(/^modified\s+/i, '')
    .replace(/^euro[- ]?spec\s+/i, '')
    .replace(/^original[- ]owner\s+/i, '')
    .replace(/^single[- ]owner\s+/i, '')
    .replace(/^one[- ]owner\s+/i, '')
    .trim();

  // Extract year (1900-2029)
  const yearMatch = clean.match(/\b(19\d{2}|20[0-2]\d)\b/);
  const year = yearMatch ? parseInt(yearMatch[1]) : null;

  if (!year) return { year: null, make: null, model: null };

  // Everything after year is "make model trim..."
  const afterYear = clean.substring(clean.indexOf(String(year)) + 4).trim();
  const parts = afterYear.split(/\s+/);

  if (parts.length === 0) return { year, make: null, model: null };

  // Known multi-word makes
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
  } else if (multiMakes[parts[0]?.toLowerCase()]) {
    make = parts[0];
    modelStart = 1;
  } else {
    make = parts[0];
    modelStart = 1;
  }

  const model = parts.slice(modelStart).join(' ') || null;
  return { year, make: make || null, model: model || null };
}

// ── Phase 1: Crawl BaT API for all listings ──
async function discoverFromApi() {
  console.log('=== Phase 1: Discovering BaT listings via REST API ===');

  // First, get total count
  const probe = await fetch(`${API_BASE}?page=1&get_items=true`, {
    headers: { 'User-Agent': UA },
  });
  const probeData = await probe.json();
  const totalItems = probeData.items_total;
  const totalPages = probeData.pages_total;
  console.log(`  Total listings: ${totalItems.toLocaleString()} across ${totalPages.toLocaleString()} pages`);

  // Store all discovered listings
  const allListings = new Map(); // url → listing data
  let emptyPages = 0;
  const MAX_EMPTY = 20; // BaT sometimes returns empty pages under load

  // Process first page
  for (const item of probeData.items || []) {
    const url = item.url?.replace(/\/$/, '');
    if (url) allListings.set(url, item);
  }

  let page = Math.max(2, START_PAGE);
  const startTime = Date.now();
  let baseDelay = 2000; // Start at 2s between requests
  let consecutive429 = 0;

  while (page <= totalPages && emptyPages < MAX_EMPTY) {
    try {
      const res = await fetch(`${API_BASE}?page=${page}&get_items=true`, {
        headers: { 'User-Agent': UA },
      });

      if (res.status === 429) {
        consecutive429++;
        // Exponential backoff: 5s, 10s, 20s, 40s, 60s cap
        const backoff = Math.min(5000 * Math.pow(2, consecutive429 - 1), 60000);
        if (consecutive429 <= 3) console.log(`  Page ${page}: rate limited, backing off ${backoff / 1000}s (baseDelay now ${Math.min(baseDelay + 500, 5000) / 1000}s)`);
        baseDelay = Math.min(baseDelay + 500, 5000); // Permanently slow down
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
          if (url) allListings.set(url, item);
        }
      }

      if (page % 50 === 0) {
        const elapsed = (Date.now() - startTime) / 1000 / 60;
        const pagesComplete = page - START_PAGE;
        const rate = pagesComplete / elapsed;
        const remaining = (totalPages - page) / rate;
        console.log(`  Page ${page}/${totalPages}: ${allListings.size.toLocaleString()} listings — ${rate.toFixed(1)} pages/min — ETA ${remaining.toFixed(0)} min — delay ${(baseDelay/1000).toFixed(1)}s`);
      }

      page++;
      await sleep(baseDelay);
    } catch (e) {
      console.log(`  Page ${page} error: ${e.message}`);
      emptyPages++;
      page++;
      await sleep(baseDelay * 2);
    }
  }

  console.log(`  Discovery complete: ${allListings.size.toLocaleString()} listings from ${page - 1} pages`);
  return allListings;
}

// ── Phase 2: Find which URLs we're missing ──
async function findMissing(allListings) {
  console.log('\n=== Phase 2: Finding missing URLs ===');

  // Get existing vehicle URLs
  const existingVehicles = new Map(); // url → {id, has_price, has_gps}
  let lastUrl = '';
  while (true) {
    const r = await client.query(`
      SELECT id, listing_url,
             (sale_price IS NOT NULL AND sale_price > 0) as has_price,
             (gps_latitude IS NOT NULL) as has_gps
      FROM vehicles
      WHERE auction_source = 'bat' AND deleted_at IS NULL
        AND listing_url IS NOT NULL AND listing_url != '' AND listing_url > $1
      ORDER BY listing_url LIMIT 5000
    `, [lastUrl]);
    if (r.rows.length === 0) break;
    for (const row of r.rows) {
      existingVehicles.set(row.listing_url.replace(/\/$/, ''), {
        id: row.id,
        hasPrice: row.has_price,
        hasGps: row.has_gps,
      });
    }
    lastUrl = r.rows[r.rows.length - 1].listing_url;
  }
  console.log(`  Existing BaT vehicles: ${existingVehicles.size.toLocaleString()}`);

  // Classify
  const needInsert = []; // completely new
  const needUpdate = []; // exist but missing price/gps that API has

  for (const [url, listing] of allListings) {
    const existing = existingVehicles.get(url);
    if (!existing) {
      needInsert.push({ url, listing });
    } else {
      // Check if API has data we're missing
      const apiHasPrice = listing.current_bid && listing.current_bid > 0;
      const apiHasGps = listing.lat && listing.lon;
      if ((!existing.hasPrice && apiHasPrice) || (!existing.hasGps && apiHasGps)) {
        needUpdate.push({ url, listing, vehicleId: existing.id });
      }
    }
  }

  console.log(`  Need insert (new vehicles): ${needInsert.length.toLocaleString()}`);
  console.log(`  Need update (missing price/gps): ${needUpdate.length.toLocaleString()}`);

  return { needInsert, needUpdate };
}

// ── Phase 3: Insert new vehicles from API data ──
async function insertNewVehicles(needInsert) {
  console.log(`\n=== Phase 3: Inserting ${needInsert.length.toLocaleString()} new vehicles ===`);

  let inserted = 0, failed = 0;
  const BATCH = 100;

  for (let i = 0; i < needInsert.length; i += BATCH) {
    const batch = needInsert.slice(i, i + BATCH);

    for (const { url, listing } of batch) {
      try {
        const parsed = parseTitle(listing.title);
        const saleDate = listing.timestamp_end
          ? new Date(listing.timestamp_end * 1000).toISOString()
          : null;

        await client.query(`
          INSERT INTO vehicles (
            listing_url, auction_source, status,
            year, make, model, title,
            sale_price,
            gps_latitude, gps_longitude,
            sale_date, listing_title,
            reserve_status
          ) VALUES (
            $1, 'bat', 'discovered',
            $2, $3, $4, $5,
            $6,
            $7, $8,
            $9, $10,
            $11
          )
          ON CONFLICT DO NOTHING
        `, [
          url,
          parsed.year,
          parsed.make,
          parsed.model,
          listing.title,
          listing.current_bid || null,
          listing.lat || null,
          listing.lon || null,
          saleDate,
          listing.title,
          listing.noreserve ? 'no_reserve' : null,
        ]);
        inserted++;
      } catch (e) {
        failed++;
        if (failed <= 5) console.log(`  Insert error: ${e.message.slice(0, 100)}`);
      }
    }

    if ((i + BATCH) % 1000 === 0 || i + BATCH >= needInsert.length) {
      console.log(`  ${inserted.toLocaleString()} inserted, ${failed} failed — ${((i + BATCH) / needInsert.length * 100).toFixed(1)}%`);
    }

    // Breathe
    await client.query('SELECT pg_sleep(0.05)');
  }

  console.log(`  Insert complete: ${inserted.toLocaleString()} new, ${failed} failed`);
  return inserted;
}

// ── Phase 3b: Update existing vehicles with missing data ──
async function updateExistingVehicles(needUpdate) {
  if (needUpdate.length === 0) return 0;
  console.log(`\n=== Phase 3b: Updating ${needUpdate.length.toLocaleString()} vehicles with missing data ===`);

  let updated = 0;
  for (const { url, listing, vehicleId } of needUpdate) {
    const sets = [];
    const vals = [vehicleId];
    let paramIdx = 2;

    if (listing.current_bid && listing.current_bid > 0) {
      sets.push(`sale_price = COALESCE(sale_price, $${paramIdx})`);
      vals.push(listing.current_bid);
      paramIdx++;
    }

    if (listing.lat && listing.lon) {
      sets.push(`gps_latitude = COALESCE(gps_latitude, $${paramIdx})`);
      vals.push(listing.lat);
      paramIdx++;
      sets.push(`gps_longitude = COALESCE(gps_longitude, $${paramIdx})`);
      vals.push(listing.lon);
      paramIdx++;
    }

    if (sets.length > 0) {
      await client.query(`UPDATE vehicles SET ${sets.join(', ')} WHERE id = $1`, vals);
      updated++;
    }
  }

  console.log(`  Updated ${updated.toLocaleString()} vehicles`);
  return updated;
}

// ── Phase 4: Fetch individual listing pages for full extraction ──
async function fetchMissingPages(needInsert) {
  // Only fetch pages for new vehicles that don't have snapshots
  console.log(`\n=== Phase 4: Checking which new vehicles need page fetches ===`);

  // Get existing snapshots
  const existingSnapshots = new Set();
  let lastUrl = '';
  while (true) {
    const r = await client.query(`
      SELECT DISTINCT listing_url FROM listing_page_snapshots
      WHERE platform = 'bat' AND success = true AND listing_url > $1
      ORDER BY listing_url LIMIT 5000
    `, [lastUrl]);
    if (r.rows.length === 0) break;
    for (const row of r.rows) {
      existingSnapshots.add(row.listing_url.replace(/\/$/, ''));
    }
    lastUrl = r.rows[r.rows.length - 1].listing_url;
  }
  console.log(`  Existing snapshots: ${existingSnapshots.size.toLocaleString()}`);

  const needFetch = needInsert
    .map(n => n.url)
    .filter(url => !existingSnapshots.has(url));

  console.log(`  Need page fetch: ${needFetch.length.toLocaleString()} (${needInsert.length - needFetch.length} already have snapshots)`);

  if (needFetch.length === 0) return 0;

  console.log(`  Fetching ${needFetch.length.toLocaleString()} pages with ${FETCH_WORKERS} workers...`);

  let fetched = 0, failed = 0, idx = 0;
  const startTime = Date.now();
  const crypto = require('crypto');

  async function worker(workerId) {
    while (idx < needFetch.length) {
      const myIdx = idx++;
      const url = needFetch[myIdx];

      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': UA },
          redirect: 'follow',
        });

        if (!res.ok) {
          failed++;
          await client.query(`
            INSERT INTO listing_page_snapshots (platform, listing_url, fetched_at, http_status, success, error_message)
            VALUES ('bat', $1, NOW(), $2, false, $3)
            ON CONFLICT DO NOTHING
          `, [url, res.status, `HTTP ${res.status}`]);
          await sleep(FETCH_WORKERS * 600);
          continue;
        }

        const html = await res.text();
        const sha256 = crypto.createHash('sha256').update(html).digest('hex');

        await client.query(`
          INSERT INTO listing_page_snapshots (platform, listing_url, fetched_at, fetch_method, http_status, success, html, html_sha256, content_length)
          VALUES ('bat', $1, NOW(), 'direct', 200, true, $2, $3, $4)
          ON CONFLICT DO NOTHING
        `, [url, html, sha256, html.length]);

        fetched++;
      } catch (e) {
        failed++;
      }

      const total = fetched + failed;
      if (total % 100 === 0 && total > 0) {
        const elapsed = (Date.now() - startTime) / 1000 / 60;
        const rate = total / elapsed;
        const remaining = (needFetch.length - total) / rate;
        console.log(`  [W${workerId}] ${total.toLocaleString()}/${needFetch.length.toLocaleString()} — ${fetched} ok, ${failed} failed — ${rate.toFixed(0)}/min — ETA ${remaining.toFixed(0)} min`);
      }

      await sleep(FETCH_WORKERS * 600);
    }
  }

  const workers = [];
  for (let i = 0; i < FETCH_WORKERS; i++) {
    await sleep(i * 200);
    workers.push(worker(i));
  }
  await Promise.all(workers);

  console.log(`  Fetch complete: ${fetched.toLocaleString()} ok, ${failed} failed`);
  return fetched;
}

async function run() {
  await client.connect();
  console.log(`BaT Backfill — started at ${new Date().toISOString()}`);
  console.log(`Config: start_page=${START_PAGE}, skip_to_phase=${SKIP_TO_PHASE}, fetch_workers=${FETCH_WORKERS}\n`);

  let allListings;

  // Phase 1: Discover via API
  if (SKIP_TO_PHASE <= 1) {
    allListings = await discoverFromApi();
  }

  // If skipping to later phase, we still need listings data
  if (!allListings || allListings.size === 0) {
    console.log('No listings discovered. If resuming, use --start-page to continue.\n');
    // Can still process snapshots→vehicles
  }

  // Phase 2 + 3: Find missing and insert
  if (allListings && allListings.size > 0 && SKIP_TO_PHASE <= 3) {
    const { needInsert, needUpdate } = await findMissing(allListings);

    if (needInsert.length > 0) {
      await insertNewVehicles(needInsert);
    }

    if (needUpdate.length > 0) {
      await updateExistingVehicles(needUpdate);
    }

    // Phase 4: Fetch individual listing pages for full extraction
    if (needInsert.length > 0) {
      await fetchMissingPages(needInsert);
    }
  }

  // Final stats
  const stats = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM vehicles WHERE auction_source = 'bat' AND deleted_at IS NULL) as bat_vehicles,
      (SELECT COUNT(*)::int FROM vehicles WHERE auction_source = 'bat' AND deleted_at IS NULL AND sale_price > 0) as with_price,
      (SELECT COUNT(*)::int FROM vehicles WHERE auction_source = 'bat' AND deleted_at IS NULL AND gps_latitude IS NOT NULL) as with_gps,
      (SELECT COUNT(DISTINCT listing_url)::int FROM listing_page_snapshots WHERE platform = 'bat' AND success = true) as snapshots
  `);
  const s = stats.rows[0];
  console.log(`\n=== FINAL ===`);
  console.log(`BaT vehicles:  ${s.bat_vehicles.toLocaleString()}`);
  console.log(`  with price:  ${s.with_price.toLocaleString()} (${(s.with_price / s.bat_vehicles * 100).toFixed(1)}%)`);
  console.log(`  with GPS:    ${s.with_gps.toLocaleString()} (${(s.with_gps / s.bat_vehicles * 100).toFixed(1)}%)`);
  console.log(`  snapshots:   ${s.snapshots.toLocaleString()}`);
  console.log(`\nbat-snapshot-parser cron will handle full extraction from snapshots.`);

  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
