#!/usr/bin/env node
/**
 * bj-api-save-all.cjs
 *
 * Saves ALL Barrett-Jackson auction results from their REST API to local JSON.
 * Creates a permanent local cache — we never need to re-crawl.
 *
 * B-J API:
 *   GET /api/previous-docket-results?page=1&size=48&slug={event-slug}
 *   Returns: id, item_id, lot_number, title, year, make, model, style, vin,
 *            price, is_sold, exterior_color, interior_color, transmission_type_name,
 *            engine_size, full_description, short_description, event_slug, run_date,
 *            main_image_url, is_reserve, reserve_type_name
 *
 *   GET /api/facets (returns all event slugs with lot counts)
 *
 * Cloudflare-protected — uses Playwright to get valid cookies, then fetches via API.
 *
 * Usage: dotenvx run -- node scripts/bj-api-save-all.cjs
 *        dotenvx run -- node scripts/bj-api-save-all.cjs --enrich-only
 */

const pg = require('pg');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DATA_DIR = path.join(__dirname, 'data', 'bj-api-events');
fs.mkdirSync(DATA_DIR, { recursive: true });

const args = process.argv.slice(2);
const ENRICH_ONLY = args.includes('--enrich-only');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const API_BASE = 'https://www.barrett-jackson.com/api';

const client = new pg.Client({
  connectionString: 'postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
  statement_timeout: 55000,
});

// ── Get Cloudflare cookies via Playwright ──
async function getCookies() {
  console.log('  Launching browser to get Cloudflare cookies...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Navigate to main site to get Cloudflare cookies
  await page.goto('https://www.barrett-jackson.com/', { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(3000);

  const cookies = await context.cookies();
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const ua = await page.evaluate(() => navigator.userAgent);

  await browser.close();
  console.log(`  Got ${cookies.length} cookies`);
  return { cookieStr, ua };
}

// ── Fetch with cookies ──
async function apiFetch(url, cookies) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': cookies.ua,
      'Cookie': cookies.cookieStr,
      'Accept': 'application/json',
      'Referer': 'https://www.barrett-jackson.com/',
    },
  });
  return res;
}

// ── Phase 1: Crawl and save all events ──
async function crawlAndSave() {
  console.log('=== Phase 1: Crawling B-J API (saving to disk) ===');

  const cookies = await getCookies();

  // Get all event slugs
  console.log('  Fetching event list...');
  const facetsRes = await apiFetch(`${API_BASE}/facets`, cookies);
  if (!facetsRes.ok) {
    console.log(`  Failed to fetch facets: ${facetsRes.status}`);
    // Try re-getting cookies
    const text = await facetsRes.text();
    console.log(`  Response: ${text.substring(0, 200)}`);
    return;
  }

  const facets = await facetsRes.json();
  console.log(`  Found ${facets.length} events`);

  // Check what we already have
  const existing = new Set(
    fs.readdirSync(DATA_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''))
  );
  console.log(`  Already saved: ${existing.size} events`);

  let savedCount = 0;
  let totalLots = 0;
  const startTime = Date.now();

  for (const event of facets) {
    const slug = event.value;
    if (!slug) continue;

    // Skip if already saved
    if (existing.has(slug)) {
      console.log(`  ${slug}: already saved`);
      continue;
    }

    // Fetch all pages for this event
    const allLots = [];
    let page = 1;
    let totalPages = 1;
    let retries = 0;

    while (page <= totalPages) {
      try {
        const url = `${API_BASE}/previous-docket-results?page=${page}&size=48&slug=${encodeURIComponent(slug)}`;
        const res = await apiFetch(url, cookies);

        if (res.status === 403) {
          console.log(`  ${slug} page ${page}: 403 — refreshing cookies...`);
          Object.assign(cookies, await getCookies());
          retries++;
          if (retries > 3) {
            console.log(`  ${slug}: too many 403s, skipping`);
            break;
          }
          continue;
        }

        if (!res.ok) {
          console.log(`  ${slug} page ${page}: HTTP ${res.status}`);
          break;
        }

        const data = await res.json();
        const pagination = data.meta?.pagination;
        if (pagination) {
          totalPages = pagination.pageCount || 1;
        }

        const lots = data.data || [];
        for (const lot of lots) {
          allLots.push(lot.attributes || lot);
        }

        page++;
        retries = 0;
        await sleep(1500); // Polite delay
      } catch (e) {
        console.log(`  ${slug} page ${page} error: ${e.message}`);
        break;
      }
    }

    if (allLots.length > 0 || page > totalPages) {
      fs.writeFileSync(path.join(DATA_DIR, `${slug}.json`), JSON.stringify(allLots, null, 0));
      existing.add(slug);
      savedCount++;
      totalLots += allLots.length;

      const elapsed = (Date.now() - startTime) / 1000 / 60;
      console.log(`  ${slug}: ${allLots.length} lots — ${savedCount} events saved — ${totalLots} total lots — ${elapsed.toFixed(1)} min`);
    }
  }

  console.log(`  Crawl complete: ${savedCount} events, ${totalLots} lots saved to ${DATA_DIR}`);
}

// ── Phase 2: Enrich from saved data ──
function parsePrice(priceStr) {
  if (!priceStr || typeof priceStr !== 'string') return null;
  const clean = priceStr.replace(/[$,]/g, '');
  const num = parseFloat(clean);
  return isNaN(num) || num <= 0 ? null : num;
}

async function enrichFromSaved() {
  console.log('\n=== Phase 2: Enriching vehicles from saved B-J API data ===');

  // Load all saved events
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  console.log(`  Saved events: ${files.length}`);

  // Build item_id → lot data map (item_id is the number at end of listing URL)
  const apiData = new Map();
  for (const file of files) {
    try {
      const lots = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
      for (const lot of lots) {
        if (lot.item_id) {
          apiData.set(String(lot.item_id), lot);
        }
        // Also index by slug (URL path ending)
        if (lot.slug) {
          apiData.set(lot.slug, lot);
        }
      }
    } catch (e) { /* skip corrupt files */ }
  }
  console.log(`  Unique lots loaded: ${apiData.size.toLocaleString()}`);

  // Load B-J vehicles
  console.log('  Loading B-J vehicles...');
  const vehicles = [];
  let lastId = '00000000-0000-0000-0000-000000000000';
  while (true) {
    const r = await client.query(`
      SELECT id, listing_url, year, make, model, sale_price, vin, title, status,
             gps_latitude, listing_location
      FROM vehicles
      WHERE auction_source = 'barrett-jackson' AND deleted_at IS NULL
        AND id > $1
      ORDER BY id LIMIT 5000
    `, [lastId]);
    if (r.rows.length === 0) break;
    vehicles.push(...r.rows);
    lastId = r.rows[r.rows.length - 1].id;
  }
  console.log(`  B-J vehicles loaded: ${vehicles.length.toLocaleString()}`);

  // Match and update
  let updated = 0, matched = 0, noMatch = 0;
  for (const vehicle of vehicles) {
    // Extract item_id from listing URL
    let lot = null;
    if (vehicle.listing_url) {
      // URL format: .../vehicle/{slug}-{item_id}
      const m = vehicle.listing_url.match(/(\d+)(?:\/)?$/);
      if (m) lot = apiData.get(m[1]);

      // Also try matching by slug
      if (!lot) {
        const slugM = vehicle.listing_url.match(/vehicle\/(.+?)(?:\/)?$/);
        if (slugM) lot = apiData.get(slugM[1]);
      }
    }

    if (!lot) {
      noMatch++;
      continue;
    }
    matched++;

    const sets = [];
    const vals = [vehicle.id];
    let paramIdx = 2;

    // Price
    if ((!vehicle.sale_price || vehicle.sale_price === 0) && lot.price) {
      const price = parsePrice(lot.price);
      if (price) {
        sets.push(`sale_price = $${paramIdx}`); vals.push(price); paramIdx++;
      }
    }

    // VIN
    if ((!vehicle.vin || vehicle.vin === '') && lot.vin && lot.vin.length >= 11) {
      sets.push(`vin = $${paramIdx}`); vals.push(lot.vin); paramIdx++;
    }

    // Year
    if (!vehicle.year && lot.year_numeric) {
      sets.push(`year = $${paramIdx}`); vals.push(lot.year_numeric); paramIdx++;
    }

    // Make
    if ((!vehicle.make || vehicle.make === '') && lot.make) {
      // Capitalize properly
      const make = lot.make.charAt(0) + lot.make.slice(1).toLowerCase();
      sets.push(`make = $${paramIdx}`); vals.push(make); paramIdx++;
    }

    // Model
    if ((!vehicle.model || vehicle.model === '') && lot.model) {
      sets.push(`model = $${paramIdx}`); vals.push(lot.model); paramIdx++;
    }

    // Title
    if ((!vehicle.title || vehicle.title === '') && lot.title) {
      sets.push(`title = $${paramIdx}`); vals.push(lot.title); paramIdx++;
      sets.push(`listing_title = $${paramIdx}`); vals.push(lot.title); paramIdx++;
    }

    // Promote pending_backfill
    if (vehicle.status === 'pending_backfill') {
      sets.push(`status = $${paramIdx}`); vals.push('active'); paramIdx++;
    }

    if (sets.length > 0) {
      await client.query(`UPDATE vehicles SET ${sets.join(', ')} WHERE id = $1`, vals);
      updated++;
    }

    if (updated % 1000 === 0 && updated > 0) {
      console.log(`  Updated ${updated.toLocaleString()} vehicles`);
    }
  }

  console.log(`\n  Enrichment complete: ${matched.toLocaleString()} matched, ${updated.toLocaleString()} updated, ${noMatch.toLocaleString()} no match`);
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
      COUNT(CASE WHEN vin IS NOT NULL AND vin != '' THEN 1 END)::int as vin,
      COUNT(CASE WHEN status = 'pending_backfill' THEN 1 END)::int as pending
    FROM vehicles WHERE auction_source = 'barrett-jackson' AND deleted_at IS NULL
  `);
  const s = stats.rows[0];
  console.log(`\n=== B-J FINAL ===`);
  console.log(`Total: ${s.total.toLocaleString()}`);
  console.log(`  price: ${s.price} (${(s.price/s.total*100).toFixed(1)}%)`);
  console.log(`  year: ${s.yr} (${(s.yr/s.total*100).toFixed(1)}%)`);
  console.log(`  GPS: ${s.gps} (${(s.gps/s.total*100).toFixed(1)}%)`);
  console.log(`  VIN: ${s.vin} (${(s.vin/s.total*100).toFixed(1)}%)`);
  console.log(`  pending_backfill: ${s.pending}`);

  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
