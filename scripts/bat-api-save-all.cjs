#!/usr/bin/env node
/**
 * bat-api-save-all.cjs
 *
 * Crawls the ENTIRE BaT listings-filter API and saves every page to local JSON.
 * This creates a permanent local cache — we never need to re-crawl.
 *
 * Then enriches vehicles from the saved data.
 *
 * Rate: 5s between requests to avoid 429s. ~9 hours for 6,442 pages.
 * Can resume from where it left off (checks existing files).
 *
 * Usage: dotenvx run -- node scripts/bat-api-save-all.cjs
 *        dotenvx run -- node scripts/bat-api-save-all.cjs --enrich-only  (skip crawl, just apply)
 */

const pg = require('pg');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data', 'bat-api-pages');
fs.mkdirSync(DATA_DIR, { recursive: true });

const client = new pg.Client({
  connectionString: 'postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
  statement_timeout: 55000,
});

const args = process.argv.slice(2);
const ENRICH_ONLY = args.includes('--enrich-only');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const API_BASE = 'https://bringatrailer.com/wp-json/bringatrailer/1.0/data/listings-filter';

// ── Phase 1: Crawl and save ──
async function crawlAndSave() {
  console.log('=== Phase 1: Crawling BaT API (saving to disk) ===');

  // Check what we already have
  const existing = new Set(
    fs.readdirSync(DATA_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => parseInt(f.replace('.json', '')))
      .filter(n => !isNaN(n))
  );
  console.log(`  Already saved: ${existing.size} pages`);

  // Get total pages
  const probe = await fetch(`${API_BASE}?page=1&get_items=true`, { headers: { 'User-Agent': UA } });
  const probeData = await probe.json();
  const totalPages = probeData.pages_total;
  const totalItems = probeData.items_total;
  console.log(`  Total: ${totalItems.toLocaleString()} listings across ${totalPages.toLocaleString()} pages`);

  // Save page 1 if not already saved
  if (!existing.has(1)) {
    fs.writeFileSync(path.join(DATA_DIR, '1.json'), JSON.stringify(probeData.items));
    existing.add(1);
  }

  let consecutive429 = 0;
  let baseDelay = 3000;
  let saved = existing.size;
  const startTime = Date.now();

  for (let page = 1; page <= totalPages; page++) {
    if (existing.has(page)) continue;

    try {
      const res = await fetch(`${API_BASE}?page=${page}&get_items=true`, {
        headers: { 'User-Agent': UA },
      });

      if (res.status === 429) {
        consecutive429++;
        const backoff = Math.min(10000 * Math.pow(2, consecutive429 - 1), 120000);
        if (consecutive429 <= 3) console.log(`  Page ${page}: 429 — backing off ${(backoff/1000).toFixed(0)}s`);
        baseDelay = Math.min(baseDelay + 1000, 8000);
        await sleep(backoff);
        page--; // Retry
        continue;
      }

      consecutive429 = 0;

      if (!res.ok) {
        console.log(`  Page ${page}: HTTP ${res.status}`);
        await sleep(baseDelay * 2);
        continue;
      }

      const data = await res.json();
      const items = data.items || [];

      if (items.length === 0) {
        // Save empty marker
        fs.writeFileSync(path.join(DATA_DIR, `${page}.json`), '[]');
        existing.add(page);
        saved++;
        await sleep(baseDelay);
        continue;
      }

      fs.writeFileSync(path.join(DATA_DIR, `${page}.json`), JSON.stringify(items));
      existing.add(page);
      saved++;

      if (saved % 50 === 0) {
        const elapsed = (Date.now() - startTime) / 1000 / 60;
        const newPages = saved - (existing.size - saved); // approximate
        const rate = saved / Math.max(elapsed, 0.1);
        const remaining = (totalPages - saved) / rate;
        console.log(`  Saved ${saved}/${totalPages} pages — ${rate.toFixed(1)} p/min — ETA ${remaining.toFixed(0)} min — delay ${(baseDelay/1000).toFixed(1)}s`);
      }

      await sleep(baseDelay);
    } catch (e) {
      console.log(`  Page ${page} error: ${e.message}`);
      await sleep(baseDelay * 3);
    }
  }

  console.log(`  Crawl complete: ${saved} pages saved to ${DATA_DIR}`);
  return saved;
}

// ── Phase 2: Enrich from saved data ──
function parseTitle(title) {
  if (!title) return { year: null, make: null, model: null };
  let clean = title
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

async function enrichFromSaved() {
  console.log('\n=== Phase 2: Enriching vehicles from saved API data ===');

  // Load all saved pages
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')).sort((a, b) => {
    return parseInt(a) - parseInt(b);
  });
  console.log(`  Saved pages: ${files.length}`);

  // Build URL → API data map
  const apiData = new Map();
  for (const file of files) {
    try {
      const items = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
      for (const item of items) {
        const url = item.url?.replace(/\/$/, '');
        if (url) apiData.set(url, item);
      }
    } catch (e) {
      // Skip corrupt files
    }
  }
  console.log(`  Unique listings loaded: ${apiData.size.toLocaleString()}`);

  // Load vehicles needing enrichment
  console.log('  Loading vehicles needing enrichment...');
  const vehicles = new Map();
  let lastUrl = '';
  while (true) {
    const r = await client.query(`
      SELECT id, listing_url, year, make, model, sale_price, gps_latitude, sale_date, title, status
      FROM vehicles
      WHERE auction_source = 'bat' AND deleted_at IS NULL
        AND listing_url IS NOT NULL AND listing_url != ''
        AND listing_url > $1
        AND (
          year IS NULL OR make IS NULL OR make = '' OR
          (sale_price IS NULL OR sale_price = 0) OR
          gps_latitude IS NULL OR
          sale_date IS NULL OR
          title IS NULL OR title = '' OR
          status = 'pending_backfill'
        )
      ORDER BY listing_url LIMIT 5000
    `, [lastUrl]);
    if (r.rows.length === 0) break;
    for (const row of r.rows) {
      vehicles.set(row.listing_url.replace(/\/$/, ''), row);
    }
    lastUrl = r.rows[r.rows.length - 1].listing_url;
  }
  console.log(`  Vehicles needing enrichment: ${vehicles.size.toLocaleString()}`);

  // Match and update
  let updated = 0, noMatch = 0;
  for (const [url, vehicle] of vehicles) {
    // Try both with and without trailing slash
    const item = apiData.get(url) || apiData.get(url + '/');
    if (!item) {
      noMatch++;
      continue;
    }

    const sets = [];
    const vals = [vehicle.id];
    let paramIdx = 2;

    // Year/make/model from title
    if (!vehicle.year || !vehicle.make || vehicle.make === '') {
      const parsed = parseTitle(item.title);
      if (parsed.year && !vehicle.year) {
        sets.push(`year = $${paramIdx}`); vals.push(parsed.year); paramIdx++;
      }
      if (parsed.make && (!vehicle.make || vehicle.make === '')) {
        sets.push(`make = $${paramIdx}`); vals.push(parsed.make); paramIdx++;
      }
      if (parsed.model && !vehicle.model) {
        sets.push(`model = $${paramIdx}`); vals.push(parsed.model); paramIdx++;
      }
    }

    // Price
    if ((!vehicle.sale_price || vehicle.sale_price === 0) && item.current_bid > 0) {
      sets.push(`sale_price = $${paramIdx}`); vals.push(item.current_bid); paramIdx++;
    }

    // GPS
    if (!vehicle.gps_latitude && item.lat && item.lon) {
      sets.push(`gps_latitude = $${paramIdx}`); vals.push(item.lat); paramIdx++;
      sets.push(`gps_longitude = $${paramIdx}`); vals.push(item.lon); paramIdx++;
    }

    // Sale date
    if (!vehicle.sale_date && item.timestamp_end) {
      sets.push(`sale_date = $${paramIdx}`); vals.push(new Date(item.timestamp_end * 1000).toISOString()); paramIdx++;
    }

    // Title
    if ((!vehicle.title || vehicle.title === '') && item.title) {
      sets.push(`title = $${paramIdx}`); vals.push(item.title); paramIdx++;
      sets.push(`listing_title = $${paramIdx}`); vals.push(item.title); paramIdx++;
    }

    // Promote pending_backfill to active
    if (vehicle.status === 'pending_backfill') {
      sets.push(`status = $${paramIdx}`); vals.push('active'); paramIdx++;
    }

    if (sets.length > 0) {
      await client.query(`UPDATE vehicles SET ${sets.join(', ')} WHERE id = $1`, vals);
      updated++;
    }

    if (updated % 1000 === 0 && updated > 0) {
      console.log(`  Updated ${updated.toLocaleString()} vehicles`);
      await new Promise(r => setTimeout(r, 50));
    }
  }

  console.log(`\n  Enrichment complete: ${updated.toLocaleString()} updated, ${noMatch.toLocaleString()} no API match`);
}

async function run() {
  await client.connect();

  if (!ENRICH_ONLY) {
    await crawlAndSave();
  }

  await enrichFromSaved();

  // Final stats
  const stats = await client.query(`
    SELECT
      COUNT(*)::int as total,
      COUNT(CASE WHEN sale_price > 0 THEN 1 END)::int as price,
      COUNT(CASE WHEN year IS NOT NULL THEN 1 END)::int as yr,
      COUNT(CASE WHEN gps_latitude IS NOT NULL THEN 1 END)::int as gps,
      COUNT(CASE WHEN sale_date IS NOT NULL THEN 1 END)::int as sale_date,
      COUNT(CASE WHEN vin IS NOT NULL AND vin != '' THEN 1 END)::int as vin,
      COUNT(CASE WHEN status = 'pending_backfill' THEN 1 END)::int as pending
    FROM vehicles WHERE auction_source = 'bat' AND deleted_at IS NULL
  `);
  const s = stats.rows[0];
  console.log(`\n=== BaT FINAL ===`);
  console.log(`Total: ${s.total.toLocaleString()}`);
  console.log(`  price: ${s.price} (${(s.price/s.total*100).toFixed(1)}%)`);
  console.log(`  year: ${s.yr} (${(s.yr/s.total*100).toFixed(1)}%)`);
  console.log(`  GPS: ${s.gps} (${(s.gps/s.total*100).toFixed(1)}%)`);
  console.log(`  sale_date: ${s.sale_date} (${(s.sale_date/s.total*100).toFixed(1)}%)`);
  console.log(`  VIN: ${s.vin} (${(s.vin/s.total*100).toFixed(1)}%)`);
  console.log(`  pending_backfill: ${s.pending}`);

  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
