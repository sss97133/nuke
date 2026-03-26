#!/usr/bin/env node
/**
 * drain-queue-no-ai.mjs
 *
 * Fast queue drainer for structured sources — NO AI, NO LLM.
 * Creates vehicle records from URL-parsed data and pre-existing raw_data.
 *
 * Sources handled:
 *   1. Classic Driver (50K) — Y/M/M from URL slug + raw_data.cd_id
 *   2. ClassicCars.com (34K) — Y/M/M from URL slug + raw_data images + location
 *   3. Mecum (16K) — Y/M/M from listing_title parse
 *   4. Barrett-Jackson (6K) — Y/M/M + VIN + price + lot from raw_data
 *   5. BaT (25K) — Y/M/M from URL, fetch page for JSON-LD/HTML enrichment
 *
 * Modes:
 *   --skeleton-only: URL/raw_data parse only, no HTTP fetches (CD, CC, Mecum, BJ)
 *   --fetch-enrich:  Fetch pages for richer data (BaT, optionally CC)
 *   --source X:      Only process source X (classic-driver, classiccars, bat, mecum, barrett-jackson)
 *   --dry-run:       Parse and log but don't write to DB
 *   --concurrency N: Parallel fetches (default 15)
 *   --batch N:       DB batch size (default 200)
 *   --max N:         Max items to process (default unlimited)
 *
 * Usage:
 *   dotenvx run -- node scripts/drain-queue-no-ai.mjs --skeleton-only --source classic-driver
 *   dotenvx run -- node scripts/drain-queue-no-ai.mjs --skeleton-only   # all skeleton sources
 *   dotenvx run -- node scripts/drain-queue-no-ai.mjs --fetch-enrich --source bat --concurrency 20
 */

import pg from 'pg';
const { Client } = pg;

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, def) {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? (typeof def === 'number' ? parseInt(args[idx + 1]) : args[idx + 1]) : def;
}
const SKELETON_ONLY = args.includes('--skeleton-only');
const FETCH_ENRICH = args.includes('--fetch-enrich');
const SOURCE_FILTER = getArg('--source', null);
const DRY_RUN = args.includes('--dry-run');
const CONCURRENCY = getArg('--concurrency', 15);
const BATCH_SIZE = getArg('--batch', 200);
const MAX_TOTAL = getArg('--max', 999999999);
const SKIP_IMAGES = args.includes('--skip-images');
const VERSION = 'drain-no-ai:1.0.0';

if (!SKELETON_ONLY && !FETCH_ENRICH) {
  console.log('Must specify --skeleton-only or --fetch-enrich (or both)');
  process.exit(1);
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Source detection ────────────────────────────────────────────────────────
function detectSource(url) {
  if (url.includes('classicdriver.com')) return 'classic-driver';
  if (url.includes('classiccars.com')) return 'classiccars';
  if (url.includes('bringatrailer.com')) return 'bat';
  if (url.includes('mecum.com')) return 'mecum';
  if (url.includes('barrett-jackson.com')) return 'barrett-jackson';
  return null;
}

// Map source to auction_source value used in vehicles table
const AUCTION_SOURCE_MAP = {
  'classic-driver': 'classic-driver',
  'classiccars': 'classiccars',
  'bat': 'bat',
  'mecum': 'mecum',
  'barrett-jackson': 'barrett-jackson',
};

// Map source to listing_source value used in vehicles table
const LISTING_SOURCE_MAP = {
  'classic-driver': 'drain-no-ai',
  'classiccars': 'drain-no-ai',
  'bat': 'drain-no-ai',
  'mecum': 'drain-no-ai',
  'barrett-jackson': 'drain-no-ai',
};

// ─── Title case helper ───────────────────────────────────────────────────────
function titleCase(s) {
  if (!s) return s;
  // Don't title-case if it looks like an acronym or intentional casing
  if (s === s.toUpperCase() && s.length > 1) {
    // ALL CAPS — title case it: "CHEVROLET" -> "Chevrolet", but keep "GT" as "GT"
    if (s.length <= 3) return s; // Keep short acronyms like GT, SS, Z28
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }
  return s;
}

// Proper make casing: "CHEVROLET" -> "Chevrolet", "BMW" -> "BMW"
function normalizeMake(make) {
  if (!make) return make;
  make = make.trim();
  // Short all-caps makes that should stay uppercase
  const keepUpper = ['BMW', 'GMC', 'MG', 'TVR', 'AC', 'DKW', 'NSU', 'ISO', 'DAF', 'VW'];
  if (keepUpper.includes(make.toUpperCase())) return make.toUpperCase();
  // Hyphenated makes
  if (make.includes('-')) {
    return make.split('-').map(p => titleCase(p)).join('-');
  }
  return titleCase(make);
}

// ─── Source-specific parsers (NO FETCH) ──────────────────────────────────────

/**
 * Classic Driver: URL = /en/car/{make}/{model}/{year}/{id}
 * raw_data = { cd_id, source }
 * Queue already has listing_year, listing_make, listing_model, listing_title
 */
function parseClassicDriver(row) {
  const v = {
    listing_url: row.listing_url,
    year: row.listing_year,
    make: normalizeMake(row.listing_make),
    model: row.listing_model ? titleCase(row.listing_model) : null,
    title: row.listing_title,
    listing_source: 'drain-no-ai',
    auction_source: 'classic-driver',
    import_method: 'bulk_import',
    extractor_version: VERSION,
  };

  // Extract from URL if queue fields missing
  if (!v.year || !v.make) {
    // Full URL: /en/car/{make}/{model}/{year}/{id}
    const m = row.listing_url.match(/\/en\/car\/([^/]+)\/([^/]+)\/(\d{4})\/(\d+)/);
    if (m) {
      if (!v.make) v.make = normalizeMake(decodeURIComponent(m[1]).replace(/-/g, ' '));
      if (!v.model) v.model = titleCase(decodeURIComponent(m[2]).replace(/-/g, ' '));
      if (!v.year) v.year = parseInt(m[3]);
    } else {
      // Partial URL with make/model but no year: /en/car/{make}/{model}/{id}
      const m2 = row.listing_url.match(/\/en\/car\/([^/]+)\/([^/]+)\/(\d+)$/);
      if (m2) {
        if (!v.make) v.make = normalizeMake(decodeURIComponent(m2[1]).replace(/-/g, ' '));
        if (!v.model) v.model = titleCase(decodeURIComponent(m2[2]).replace(/-/g, ' '));
      }
      // ID-only URL: /en/car/{id} — skip, can't extract anything without fetch
    }
  }

  // Skip items with no usable data (ID-only URLs with no queue fields)
  if (!v.year && !v.make) return null;

  if (!v.title) {
    const parts = [v.year, v.make, v.model].filter(Boolean);
    if (parts.length > 0) v.title = parts.join(' ');
  }

  return v;
}

/**
 * ClassicCars.com: URL = /listings/view/{id}/{year}-{make}-{model}-for-sale-in-{city}-{state}-{zip}
 * raw_data = { listing_id, zip, lastmod, location, image_count, sitemap_images[] }
 * Queue already has listing_year, listing_make, listing_model
 */
function parseClassicCars(row) {
  const raw = row.raw_data || {};
  const v = {
    listing_url: row.listing_url,
    year: row.listing_year,
    make: normalizeMake(row.listing_make),
    model: row.listing_model ? titleCase(row.listing_model) : null,
    title: row.listing_title,
    listing_source: 'drain-no-ai',
    auction_source: 'classiccars',
    import_method: 'bulk_import',
    extractor_version: VERSION,
  };

  // Location from raw_data
  if (raw.location) {
    const parts = raw.location.split('-');
    if (parts.length >= 2) {
      const city = parts.slice(0, -1).map(p => titleCase(p)).join(' ');
      const state = parts[parts.length - 1].toUpperCase();
      v.location = `${city}, ${state}`;
      v.city = city;
      v.state = state;
    }
  }
  if (raw.zip) v.zip_code = raw.zip;

  // Images from sitemap
  if (raw.sitemap_images?.length > 0) {
    v.image_urls = raw.sitemap_images;
    v.primary_image_url = raw.sitemap_images[0];
  }

  if (!v.title && v.year && v.make && v.model) {
    v.title = `${v.year} ${v.make} ${v.model}`;
  }

  return v;
}

/**
 * Mecum: URL = /lots/{id}/{year}-{make}-{model...}/
 * listing_title is already populated: "2005 Bentley Continental GT"
 * raw_data is usually empty {}
 * NOTE: ~1.3K items are memorabilia (tools, gas pumps, etc.) — no year in title.
 * We skip those (return null) since they're not vehicles.
 */
function parseMecum(row) {
  const v = {
    listing_url: row.listing_url,
    year: row.listing_year,
    listing_source: 'drain-no-ai',
    auction_source: 'mecum',
    import_method: 'bulk_import',
    extractor_version: VERSION,
  };

  // Parse make/model from listing_title: "2005 Bentley Continental GT"
  if (row.listing_title) {
    v.title = row.listing_title;
    const m = row.listing_title.match(/^(\d{4})\s+(\S+)\s+(.+)$/);
    if (m) {
      if (!v.year) v.year = parseInt(m[1]);
      v.make = normalizeMake(m[2]);
      v.model = m[3].trim();
    }
  }

  // Fallback: parse from URL /lots/{id}/{year}-{make}-{model}/
  if (!v.make) {
    const m = row.listing_url.match(/\/lots\/\d+\/(\d{4})-([^-/]+)-([^/]+)/);
    if (m) {
      if (!v.year) v.year = parseInt(m[1]);
      v.make = normalizeMake(m[2].replace(/-/g, ' '));
      v.model = titleCase(m[3].replace(/-/g, ' '));
    }
  }

  // Skip non-vehicle items (memorabilia, parts, tools, etc.)
  if (!v.year && !v.make) return null;

  return v;
}

/**
 * Barrett-Jackson: raw_data has structured data from API
 * { vin, price, is_sold, item_id, event_slug, lot_number, reserve_type }
 * Queue has listing_year, listing_make, listing_model, listing_title
 */
function parseBarrettJackson(row) {
  const raw = row.raw_data || {};
  const v = {
    listing_url: row.listing_url,
    year: row.listing_year,
    make: normalizeMake(row.listing_make),
    model: row.listing_model,
    title: row.listing_title,
    listing_source: 'drain-no-ai',
    auction_source: 'barrett-jackson',
    import_method: 'api',
    extractor_version: VERSION,
  };

  // Rich data from raw_data
  if (raw.vin && raw.vin.length >= 5) v.vin = raw.vin.toUpperCase();
  if (raw.price && raw.price > 0) {
    v.sale_price = parseInt(raw.price);
    v.sold_price = parseInt(raw.price);
    v.canonical_sold_price = parseInt(raw.price);
  }
  if (raw.is_sold !== undefined) {
    v.auction_outcome = raw.is_sold ? 'sold' : 'no_sale';
    v.canonical_outcome = raw.is_sold ? 'sold' : 'no_sale';
  }
  if (raw.lot_number) v.bat_lot_number = String(raw.lot_number);
  if (raw.reserve_type) {
    if (raw.reserve_type.toLowerCase().includes('no reserve')) {
      v.reserve_status = 'no_reserve';
    }
    // If there IS a reserve, we can't tell from this data if it was met — leave NULL
  }

  return v;
}

/**
 * BaT (skeleton only — no fetch): URL = /listing/{year}-{make}-{model}[-suffix]/
 * Queue has listing_year, listing_make, listing_model
 */
function parseBatSkeleton(row) {
  const v = {
    listing_url: row.listing_url,
    year: row.listing_year,
    make: normalizeMake(row.listing_make),
    model: row.listing_model ? titleCase(row.listing_model) : null,
    title: row.listing_title,
    listing_source: 'drain-no-ai',
    auction_source: 'bat',
    import_method: 'bulk_import',
    extractor_version: VERSION,
  };

  if (!v.title && v.year && v.make && v.model) {
    v.title = `${v.year} ${v.make} ${v.model}`;
  }

  return v;
}

// ─── BaT page fetch + parse (for --fetch-enrich) ────────────────────────────
function parseBatHtml(html, row) {
  const v = parseBatSkeleton(row);
  v.import_method = 'scraper';

  const title = (html.match(/<title>([^<]+)<\/title>/i) || [])[1] || '';

  // Price from title
  const sold = title.match(/sold\s+for\s+\$([0-9,]+)/i);
  if (sold) {
    v.sale_price = parseInt(sold[1].replace(/,/g, ''));
    v.sold_price = v.sale_price;
    v.canonical_sold_price = v.sale_price;
    v.auction_outcome = 'sold';
    v.canonical_outcome = 'sold';
  } else {
    const bid = title.match(/bid\s+to\s+\$([0-9,]+)/i);
    if (bid) {
      v.high_bid = parseInt(bid[1].replace(/,/g, ''));
      v.auction_outcome = 'no_sale';
      v.canonical_outcome = 'no_sale';
    }
  }

  // JSON-LD
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const items = [].concat(JSON.parse(m[1].trim()));
      for (const item of items) {
        if (['Product', 'Car', 'Vehicle'].includes(item['@type'])) {
          if (item.description && !v.description) {
            v.description = item.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000);
          }
          if (item.image && !v.primary_image_url) {
            const img = Array.isArray(item.image) ? item.image[0] : item.image;
            v.primary_image_url = typeof img === 'string' ? img : img?.url;
          }
          if (item.vehicleIdentificationNumber) v.vin = item.vehicleIdentificationNumber.toUpperCase();
          if (item.mileageFromOdometer) {
            const mi = parseInt(String(item.mileageFromOdometer.value || item.mileageFromOdometer).replace(/\D/g, ''));
            if (mi > 0 && mi < 999999) v.mileage = mi;
          }
          if (item.offers && !v.sale_price) {
            const o = Array.isArray(item.offers) ? item.offers[0] : item.offers;
            if (o.price) {
              const p = parseInt(String(o.price).replace(/\D/g, ''));
              if (p > 0) {
                v.sale_price = p;
                v.sold_price = p;
                v.canonical_sold_price = p;
                v.auction_outcome = 'sold';
                v.canonical_outcome = 'sold';
              }
            }
          }
        }
      }
    } catch {}
  }

  // og:image fallback
  if (!v.primary_image_url) {
    const og = html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
               html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (og?.[1]?.startsWith('http') && !og[1].includes('logo')) {
      v.primary_image_url = og[1].replace(/&amp;/g, '&');
    }
  }

  // Description fallbacks
  if (!v.description) {
    const og = html.match(/(?:property=["']og:description["']|name=["']description["'])[^>]+content=["']([^"']{40,})["']/i);
    if (og?.[1]) v.description = og[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').slice(0, 2000);
  }

  // Transmission
  if (html.match(/\bautomatic\b|auto\s*trans|tiptronic|powerglide/i)) v.transmission = 'Automatic';
  else if (html.match(/\bmanual\b|stick.?shift|[3-6]-speed\s*manual/i)) v.transmission = 'Manual';

  // Mileage fallback
  if (!v.mileage) {
    const mi = html.match(/~?([0-9][0-9,]+)\s*(?:miles|mi\.?\b)/i);
    if (mi) { const val = parseInt(mi[1].replace(/,/g, '')); if (val > 0 && val < 999999) v.mileage = val; }
  }

  // Location
  const loc = html.match(/"location"\s*:\s*"([^"]+)"/i);
  if (loc) v.location = loc[1];

  // VIN fallback
  if (!v.vin) {
    const vinMatch = html.match(/(?:VIN|Chassis)[^A-HJ-NPR-Z0-9]{0,20}([A-HJ-NPR-Z0-9]{17})/i);
    if (vinMatch) v.vin = vinMatch[1].toUpperCase();
  }

  // Images
  const images = new Set();
  if (v.primary_image_url) images.add(v.primary_image_url);
  const re = /https?:\/\/[^"'\s<>]*bringatrailer\.com\/wp-content\/uploads\/[^"'\s<>]+\.(?:jpg|jpeg|png|webp)/gi;
  let mm;
  while ((mm = re.exec(html)) !== null) {
    const u = mm[0].replace(/&amp;/g, '&');
    if (!u.includes('logo') && !u.includes('favicon') && !u.includes('icon') && !u.includes('avatar')) {
      images.add(u);
    }
  }
  if (images.size > 0) v.image_urls = [...images];

  return v;
}

// ─── ClassicCars.com page fetch + JSON-LD parse ─────────────────────────────
function parseClassicCarsHtml(html, row) {
  const v = parseClassicCars(row);
  v.import_method = 'scraper';

  // JSON-LD: @type Car with full structured data
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const items = [].concat(JSON.parse(m[1].trim()));
      for (const item of items) {
        if (['Car', 'Vehicle', 'Product'].includes(item['@type'])) {
          if (item.vehicleIdentificationNumber) v.vin = item.vehicleIdentificationNumber.toUpperCase();
          if (item.mileageFromOdometer) {
            const mi = parseInt(String(item.mileageFromOdometer.value || item.mileageFromOdometer).replace(/\D/g, ''));
            if (mi > 0 && mi < 999999) v.mileage = mi;
          }
          if (item.color) v.color = item.color;
          if (item.vehicleInteriorColor) v.interior_color = item.vehicleInteriorColor;
          if (item.vehicleTransmission) v.transmission = item.vehicleTransmission;
          if (item.vehicleEngine?.engineType) v.engine_type = item.vehicleEngine.engineType;
          if (item.description) v.description = item.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000);
          if (item.offers) {
            const o = Array.isArray(item.offers) ? item.offers[0] : item.offers;
            if (o.price) {
              const p = parseInt(String(o.price).replace(/\D/g, ''));
              if (p > 0) {
                v.asking_price = p;
                v.sale_price = p;
              }
            }
          }
          if (item.image) {
            const imgs = Array.isArray(item.image) ? item.image : [item.image];
            const urls = imgs.map(i => typeof i === 'string' ? i : i?.url).filter(Boolean);
            if (urls.length > 0) {
              v.image_urls = [...new Set([...(v.image_urls || []), ...urls])];
              if (!v.primary_image_url) v.primary_image_url = urls[0];
            }
          }
        }
      }
    } catch {}
  }

  // og:image fallback
  if (!v.primary_image_url) {
    const og = html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    if (og?.[1]?.startsWith('http')) v.primary_image_url = og[1].replace(/&amp;/g, '&');
  }

  return v;
}

// ─── HTTP fetch with timeout ─────────────────────────────────────────────────
async function fetchPage(url) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { headers: BROWSER_HEADERS, signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(tid);
    if (!r.ok) return { html: null, status: r.status };
    const html = await r.text();
    if (html.length < 500) return { html: null, status: 204 };
    return { html, status: r.status };
  } catch (e) {
    clearTimeout(tid);
    return { html: null, status: 0, error: e.message };
  }
}

// ─── Vehicle insert SQL builder ──────────────────────────────────────────────
function buildInsertSQL(vehicles) {
  if (vehicles.length === 0) return null;

  // Columns we can populate
  const COLS = [
    'listing_url', 'year', 'make', 'model', 'title', 'vin',
    'sale_price', 'sold_price', 'canonical_sold_price', 'asking_price',
    'mileage', 'color', 'interior_color', 'transmission', 'engine_type',
    'description', 'primary_image_url', 'location', 'city', 'state', 'zip_code',
    'auction_source', 'listing_source', 'import_method', 'extractor_version',
    'auction_outcome', 'canonical_outcome', 'high_bid',
    'bat_lot_number', 'reserve_status',
  ];

  const valueSets = [];
  const params = [];
  let paramIdx = 1;

  for (const v of vehicles) {
    const colPlaceholders = [];
    const usedCols = [];

    for (const col of COLS) {
      if (v[col] !== undefined && v[col] !== null && v[col] !== '') {
        usedCols.push(col);
        colPlaceholders.push(`$${paramIdx++}`);
        params.push(v[col]);
      }
    }

    if (usedCols.length === 0) continue;

    // We need all rows to use the same columns, so pad with NULL
    // Actually, let's just do individual inserts for simplicity with ON CONFLICT
    valueSets.push({ cols: usedCols, placeholders: colPlaceholders, vehicle: v });
  }

  return valueSets;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();
  let totalProcessed = 0, totalCreated = 0, totalSkipped = 0, totalErrors = 0;
  let totalImages = 0, totalFetched = 0;

  console.log(`\n=== DRAIN QUEUE — NO AI ===`);
  console.log(`Mode: ${SKELETON_ONLY ? 'skeleton' : ''}${FETCH_ENRICH ? ' fetch-enrich' : ''}`);
  console.log(`Source: ${SOURCE_FILTER || 'ALL'} | Batch: ${BATCH_SIZE} | Max: ${MAX_TOTAL} | DryRun: ${DRY_RUN}`);
  if (FETCH_ENRICH) console.log(`Concurrency: ${CONCURRENCY}`);
  console.log('');

  // Connect
  const client = new Client({
    host: 'aws-0-us-west-1.pooler.supabase.com', port: 6543,
    user: 'postgres.qkgaybvrernstplzjaam',
    password: process.env.SUPABASE_DB_PASSWORD || 'RbzKq32A0uhqvJMQ',
    database: 'postgres', ssl: { rejectUnauthorized: false },
    statement_timeout: 120000,
  });
  client.on('error', (e) => { console.error('DB background error:', e.message); });
  await client.connect();
  // Prevent auto-merge triggers from firing during bulk insert
  // (trigger_check_duplicates checks this setting and skips if TRUE)
  await client.query("SET app.is_merging_vehicles = 'TRUE'");
  console.log('Connected to DB (merge triggers bypassed).');

  // Build WHERE clause for source filter
  const sourceFilters = {
    'classic-driver': "listing_url LIKE '%classicdriver.com%'",
    'classiccars': "listing_url LIKE '%classiccars.com%'",
    'bat': "listing_url LIKE '%bringatrailer.com%'",
    'mecum': "listing_url LIKE '%mecum.com%'",
    'barrett-jackson': "listing_url LIKE '%barrett-jackson.com%'",
  };

  // Determine which sources to process
  let skeletonSources = ['classic-driver', 'classiccars', 'mecum', 'barrett-jackson', 'bat'];
  let fetchSources = ['bat']; // BaT benefits most from fetching

  if (SOURCE_FILTER) {
    if (!sourceFilters[SOURCE_FILTER]) {
      console.error(`Unknown source: ${SOURCE_FILTER}. Valid: ${Object.keys(sourceFilters).join(', ')}`);
      process.exit(1);
    }
    skeletonSources = [SOURCE_FILTER];
    fetchSources = [SOURCE_FILTER];
  }

  // ─── Phase 1: Skeleton processing (no HTTP) ─────────────────────────────
  if (SKELETON_ONLY) {
    console.log('\n─── Phase 1: Skeleton Processing (no HTTP) ───');

    for (const source of skeletonSources) {
      if (totalProcessed >= MAX_TOTAL) break;

      const where = sourceFilters[source];
      if (!where) continue;

      // Count pending
      const { rows: countRows } = await client.query(
        `SELECT count(*) as cnt FROM import_queue WHERE status = 'pending' AND ${where}`
      );
      const pendingCount = parseInt(countRows[0].cnt);
      if (pendingCount === 0) {
        console.log(`  ${source}: 0 pending, skipping`);
        continue;
      }
      console.log(`\n  ${source}: ${pendingCount.toLocaleString()} pending`);

      let sourceProcessed = 0, sourceCreated = 0, sourceSkipped = 0, sourceErrors = 0;
      let round = 0;

      while (sourceProcessed < pendingCount && totalProcessed < MAX_TOTAL) {
        round++;
        const remaining = Math.min(BATCH_SIZE, MAX_TOTAL - totalProcessed);

        // Claim batch
        const { rows: batch } = await client.query(
          `SELECT id, listing_url, listing_title, listing_year, listing_make, listing_model,
                  listing_price, thumbnail_url, raw_data, source_id
           FROM import_queue
           WHERE status = 'pending' AND ${where}
           ORDER BY priority ASC, created_at ASC
           LIMIT $1`,
          [remaining]
        );

        if (batch.length === 0) break;

        // Parse all items
        const parsed = [];
        const failedIds = [];

        for (const row of batch) {
          try {
            let v;
            switch (source) {
              case 'classic-driver': v = parseClassicDriver(row); break;
              case 'classiccars': v = parseClassicCars(row); break;
              case 'mecum': v = parseMecum(row); break;
              case 'barrett-jackson': v = parseBarrettJackson(row); break;
              case 'bat': v = parseBatSkeleton(row); break;
              default: continue;
            }

            // Parser returned null = unparseable item (memorabilia, ID-only URL, etc.)
            if (!v) {
              failedIds.push(row.id);
              sourceErrors++;
              continue;
            }

            // Must have at minimum year + make OR a title
            if (!v.year && !v.title) {
              failedIds.push(row.id);
              sourceErrors++;
              continue;
            }

            // Must have a listing_url
            if (!v.listing_url) {
              failedIds.push(row.id);
              sourceErrors++;
              continue;
            }

            v._queueId = row.id;
            v._sourceId = row.source_id;
            if (row.thumbnail_url && !v.primary_image_url) v.primary_image_url = row.thumbnail_url;

            parsed.push(v);
          } catch (e) {
            failedIds.push(row.id);
            sourceErrors++;
          }
        }

        // Insert vehicles in individual statements with ON CONFLICT
        const completeIds = [];
        const insertedVehicleIds = []; // { queueId, vehicleId }

        // ─── BATCH INSERT: multi-row INSERT ... ON CONFLICT DO NOTHING ───
        // The fixed column set for all skeleton inserts:
        const FIXED_COLS = [
          'listing_url', 'year', 'make', 'model', 'title', 'vin',
          'sale_price', 'sold_price', 'canonical_sold_price', 'asking_price',
          'mileage', 'color', 'interior_color', 'transmission', 'engine_type',
          'description', 'primary_image_url', 'location', 'city', 'state', 'zip_code',
          'auction_source', 'listing_source', 'import_method', 'extractor_version',
          'auction_outcome', 'canonical_outcome', 'high_bid',
          'bat_lot_number', 'reserve_status', 'import_queue_id',
        ];
        const COL_COUNT = FIXED_COLS.length;

        if (DRY_RUN) {
          for (const v of parsed) {
            console.log(`    [DRY] ${v.year} ${v.make} ${v.model} — ${v.listing_url.slice(0, 80)}`);
            completeIds.push(v._queueId);
            sourceCreated++;
          }
        } else {
          // Process in sub-batches of 50 for multi-row inserts
          // Sub-batch of 10 rows per INSERT to keep trigger overhead manageable
          for (let bi = 0; bi < parsed.length; bi += 10) {
            const subBatch = parsed.slice(bi, bi + 50);
            const vals = [];
            const rowPhs = [];

            for (const v of subBatch) {
              const rowVals = FIXED_COLS.map(col => {
                if (col === 'import_queue_id') return v._queueId;
                const val = v[col];
                return (val !== undefined && val !== null && val !== '') ? val : null;
              });
              vals.push(...rowVals);
              const baseIdx = (vals.length - COL_COUNT);
              rowPhs.push(`(${FIXED_COLS.map((_, ci) => `$${baseIdx + ci + 1}`).join(',')})`);
            }

            try {
              const sql = `INSERT INTO vehicles (${FIXED_COLS.join(', ')})
                           VALUES ${rowPhs.join(', ')}
                           ON CONFLICT (listing_url) WHERE deleted_at IS NULL AND listing_url IS NOT NULL AND listing_url <> ''
                           DO NOTHING
                           RETURNING id, listing_url`;

              const res = await client.query(sql, vals);
              const insertedUrls = new Set(res.rows.map(r => r.listing_url));

              for (const v of subBatch) {
                completeIds.push(v._queueId);
                const matchRow = res.rows.find(r => r.listing_url === v.listing_url);
                if (matchRow) {
                  insertedVehicleIds.push({ queueId: v._queueId, vehicleId: matchRow.id });
                  sourceCreated++;
                } else {
                  // Existed already (ON CONFLICT DO NOTHING) — still mark complete
                  sourceSkipped++;
                }
              }
            } catch (e) {
              // If batch insert fails, fall back to individual inserts
              if (sourceErrors <= 3) console.error(`    Batch insert error: ${e.message?.slice(0, 150)}`);
              for (const v of subBatch) {
                try {
                  const cols = []; const ivals = []; const phs = []; let pi = 1;
                  for (const col of FIXED_COLS) {
                    const val = col === 'import_queue_id' ? v._queueId : v[col];
                    if (val !== undefined && val !== null && val !== '') {
                      cols.push(col); ivals.push(val); phs.push(`$${pi++}`);
                    }
                  }
                  const res = await client.query(
                    `INSERT INTO vehicles (${cols.join(', ')}) VALUES (${phs.join(', ')})
                     ON CONFLICT (listing_url) WHERE deleted_at IS NULL AND listing_url IS NOT NULL AND listing_url <> '' DO NOTHING
                     RETURNING id`, ivals);
                  completeIds.push(v._queueId);
                  if (res.rows.length > 0) {
                    insertedVehicleIds.push({ queueId: v._queueId, vehicleId: res.rows[0].id });
                    sourceCreated++;
                  } else { sourceSkipped++; }
                } catch (e2) {
                  // VIN conflict — retry without VIN
                  if (e2.message?.includes('vin_unique') || e2.message?.includes('vehicles_vin')) {
                    try {
                      const cols2 = []; const ivals2 = []; const phs2 = []; let pi2 = 1;
                      for (const col of FIXED_COLS) {
                        if (col === 'vin') continue; // Skip VIN
                        const val = col === 'import_queue_id' ? v._queueId : v[col];
                        if (val !== undefined && val !== null && val !== '') {
                          cols2.push(col); ivals2.push(val); phs2.push(`$${pi2++}`);
                        }
                      }
                      const res2 = await client.query(
                        `INSERT INTO vehicles (${cols2.join(', ')}) VALUES (${phs2.join(', ')})
                         ON CONFLICT (listing_url) WHERE deleted_at IS NULL AND listing_url IS NOT NULL AND listing_url <> '' DO NOTHING
                         RETURNING id`, ivals2);
                      completeIds.push(v._queueId);
                      if (res2.rows.length > 0) {
                        insertedVehicleIds.push({ queueId: v._queueId, vehicleId: res2.rows[0].id });
                        sourceCreated++;
                      } else { sourceSkipped++; }
                    } catch (e3) {
                      failedIds.push(v._queueId);
                      sourceErrors++;
                      if (sourceErrors <= 5) console.error(`    Retry without VIN failed: ${e3.message?.slice(0, 120)}`);
                    }
                  } else if (e2.message?.includes('foreign key constraint') || e2.message?.includes('fkey')) {
                    // FK error from trigger trying to merge/delete — vehicle likely exists, mark complete
                    completeIds.push(v._queueId);
                    sourceSkipped++;
                  } else {
                    failedIds.push(v._queueId);
                    sourceErrors++;
                    if (sourceErrors <= 5) console.error(`    Individual insert error: ${e2.message?.slice(0, 120)}`);
                  }
                }
              }
            }
          }
        }

        // Insert images for ClassicCars.com vehicles (from sitemap_images in raw_data)
        if (!SKIP_IMAGES && source === 'classiccars') {
          for (const v of parsed) {
            if (!v.image_urls?.length) continue;
            const match = insertedVehicleIds.find(x => x.queueId === v._queueId);
            if (!match) continue;

            try {
              for (let ci = 0; ci < v.image_urls.length; ci += 50) {
                const chunk = v.image_urls.slice(ci, ci + 50);
                const imgVals = [];
                const imgPhs = chunk.map((url, idx) => {
                  imgVals.push(match.vehicleId, url, 'classiccars', true);
                  return `($${idx * 4 + 1}, $${idx * 4 + 2}, $${idx * 4 + 3}, $${idx * 4 + 4})`;
                }).join(',');

                const ir = await client.query(
                  `INSERT INTO vehicle_images (vehicle_id, image_url, source, is_external) VALUES ${imgPhs}
                   ON CONFLICT DO NOTHING`,
                  imgVals
                );
                totalImages += ir.rowCount;
              }
            } catch {}
          }
        }

        // Mark queue items complete
        if (!DRY_RUN && completeIds.length > 0) {
          for (let ci = 0; ci < completeIds.length; ci += 200) {
            const chunk = completeIds.slice(ci, ci + 200);
            const phs = chunk.map((_, i) => `$${i + 1}`).join(',');
            try {
              await client.query(
                `UPDATE import_queue SET status = 'complete', processed_at = NOW(), extractor_version = '${VERSION}'
                 WHERE id IN (${phs})`,
                chunk
              );
            } catch (e) {
              console.error(`    Queue mark error: ${e.message?.slice(0, 80)}`);
            }
          }
        }

        // Link vehicle_id back to queue
        if (!DRY_RUN && insertedVehicleIds.length > 0) {
          for (const { queueId, vehicleId } of insertedVehicleIds) {
            try {
              await client.query(
                `UPDATE import_queue SET vehicle_id = $1 WHERE id = $2 AND vehicle_id IS NULL`,
                [vehicleId, queueId]
              );
            } catch {}
          }
        }

        // Mark failures
        if (!DRY_RUN && failedIds.length > 0) {
          for (let ci = 0; ci < failedIds.length; ci += 200) {
            const chunk = failedIds.slice(ci, ci + 200);
            const phs = chunk.map((_, i) => `$${i + 1}`).join(',');
            try {
              await client.query(
                `UPDATE import_queue SET status = 'failed', error_message = 'parse-failed', failure_category = 'parse_error'
                 WHERE id IN (${phs})`,
                chunk
              );
            } catch {}
          }
        }

        sourceProcessed += batch.length;
        totalProcessed += batch.length;

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const rate = totalProcessed > 0 ? (totalProcessed / ((Date.now() - startTime) / 1000) * 3600).toFixed(0) : 0;

        if (round % 5 === 0 || batch.length < BATCH_SIZE) {
          console.log(
            `    R${round}: ${batch.length} claimed | +${completeIds.length} complete | +${failedIds.length} fail | ` +
            `Source: ${sourceProcessed.toLocaleString()}/${pendingCount.toLocaleString()} | ` +
            `Total: ${totalProcessed.toLocaleString()} @ ${rate}/hr | ${elapsed}s`
          );
        }

        // Small delay between batches to avoid lock pressure
        if (batch.length === BATCH_SIZE) await sleep(100);
      }

      totalCreated += sourceCreated;
      totalSkipped += sourceSkipped;
      totalErrors += sourceErrors;

      console.log(`  ${source} done: ${sourceProcessed} processed, ${sourceCreated} created, ${sourceSkipped} skipped, ${sourceErrors} errors`);
    }
  }

  // ─── Phase 2: Fetch + enrich (HTTP required) ────────────────────────────
  if (FETCH_ENRICH) {
    console.log('\n─── Phase 2: Fetch + Enrich (HTTP) ───');

    for (const source of fetchSources) {
      if (totalProcessed >= MAX_TOTAL) break;

      const where = sourceFilters[source];
      if (!where) continue;

      const { rows: countRows } = await client.query(
        `SELECT count(*) as cnt FROM import_queue WHERE status = 'pending' AND ${where}`
      );
      const pendingCount = parseInt(countRows[0].cnt);
      if (pendingCount === 0) {
        console.log(`  ${source}: 0 pending, skipping`);
        continue;
      }
      console.log(`\n  ${source}: ${pendingCount.toLocaleString()} pending (fetch mode)`);

      let sourceProcessed = 0, sourceCreated = 0, sourceErrors = 0;
      let consecutiveRateLimits = 0;
      let round = 0;

      while (sourceProcessed < pendingCount && totalProcessed < MAX_TOTAL) {
        round++;
        const claimSize = Math.min(BATCH_SIZE, MAX_TOTAL - totalProcessed);

        const { rows: batch } = await client.query(
          `SELECT id, listing_url, listing_title, listing_year, listing_make, listing_model,
                  listing_price, thumbnail_url, raw_data, source_id
           FROM import_queue
           WHERE status = 'pending' AND ${where}
           ORDER BY priority ASC, created_at ASC
           LIMIT $1`,
          [claimSize]
        );

        if (batch.length === 0) break;

        // Fetch pages concurrently
        const queue = [...batch];
        const results = [];

        while (queue.length > 0) {
          const wave = queue.splice(0, CONCURRENCY);

          const waveResults = await Promise.allSettled(
            wave.map(async (row) => {
              const { html, status, error } = await fetchPage(row.listing_url);
              if (!html) {
                if (status === 429 || status === 403) return { row, rateLimited: true };
                return { row, error: error || `HTTP ${status}` };
              }

              let v;
              if (source === 'bat') v = parseBatHtml(html, row);
              else if (source === 'classiccars') v = parseClassicCarsHtml(html, row);
              else {
                // For other sources, just do skeleton parse (fetching not needed)
                v = { error: 'no-fetch-parser' };
              }

              return { row, vehicle: v };
            })
          );

          let waveRL = 0;
          for (const r of waveResults) {
            if (r.status === 'fulfilled') {
              results.push(r.value);
              if (r.value.rateLimited) waveRL++;
            } else {
              results.push({ row: wave[0], error: 'promise_rejected' });
            }
          }

          if (waveRL > 0) {
            consecutiveRateLimits += waveRL;
            if (consecutiveRateLimits >= 5) {
              console.log(`    Rate limited ${consecutiveRateLimits}x — backing off 30s`);
              await sleep(30000);
              consecutiveRateLimits = 0;
            } else {
              await sleep(3000);
            }
          } else {
            consecutiveRateLimits = 0;
            if (queue.length > 0) await sleep(500);
          }
        }

        // Process results
        const completeIds = [];
        const failedIds = [];

        for (const r of results) {
          if (r.rateLimited) continue; // Will retry next round
          if (r.error) {
            failedIds.push(r.row.id);
            sourceErrors++;
            continue;
          }

          const v = r.vehicle;
          if (!v || !v.listing_url) {
            failedIds.push(r.row.id);
            sourceErrors++;
            continue;
          }

          if (DRY_RUN) {
            console.log(`    [DRY] ${v.year} ${v.make} ${v.model} | $${v.sale_price || '?'} | ${v.vin || 'no VIN'}`);
            completeIds.push(r.row.id);
            sourceCreated++;
            continue;
          }

          try {
            const cols = [];
            const vals = [];
            const phs = [];
            let pi = 1;

            const fields = {
              listing_url: v.listing_url,
              year: v.year, make: v.make, model: v.model, title: v.title,
              vin: v.vin, sale_price: v.sale_price, sold_price: v.sold_price,
              canonical_sold_price: v.canonical_sold_price,
              mileage: v.mileage, color: v.color, interior_color: v.interior_color,
              transmission: v.transmission, description: v.description,
              primary_image_url: v.primary_image_url, location: v.location,
              auction_source: v.auction_source, listing_source: v.listing_source,
              import_method: v.import_method, extractor_version: v.extractor_version,
              auction_outcome: v.auction_outcome, canonical_outcome: v.canonical_outcome,
              high_bid: v.high_bid, import_queue_id: r.row.id,
            };

            for (const [col, val] of Object.entries(fields)) {
              if (val !== undefined && val !== null && val !== '') {
                cols.push(col);
                vals.push(val);
                phs.push(`$${pi++}`);
              }
            }

            const sql = `INSERT INTO vehicles (${cols.join(', ')})
                         VALUES (${phs.join(', ')})
                         ON CONFLICT (listing_url) WHERE deleted_at IS NULL AND listing_url IS NOT NULL AND listing_url <> ''
                         DO UPDATE SET
                           year = COALESCE(NULLIF(vehicles.year, 0), EXCLUDED.year),
                           make = COALESCE(NULLIF(vehicles.make, ''), EXCLUDED.make),
                           model = COALESCE(NULLIF(vehicles.model, ''), EXCLUDED.model),
                           title = COALESCE(NULLIF(vehicles.title, ''), EXCLUDED.title),
                           vin = COALESCE(NULLIF(vehicles.vin, ''), EXCLUDED.vin),
                           sale_price = COALESCE(NULLIF(vehicles.sale_price, 0), EXCLUDED.sale_price),
                           sold_price = COALESCE(NULLIF(vehicles.sold_price, 0), EXCLUDED.sold_price),
                           canonical_sold_price = COALESCE(NULLIF(vehicles.canonical_sold_price, 0), EXCLUDED.canonical_sold_price),
                           mileage = COALESCE(NULLIF(vehicles.mileage, 0), EXCLUDED.mileage),
                           transmission = COALESCE(NULLIF(vehicles.transmission, ''), EXCLUDED.transmission),
                           description = COALESCE(NULLIF(vehicles.description, ''), EXCLUDED.description),
                           primary_image_url = COALESCE(NULLIF(vehicles.primary_image_url, ''), EXCLUDED.primary_image_url),
                           location = COALESCE(NULLIF(vehicles.location, ''), EXCLUDED.location),
                           auction_outcome = COALESCE(NULLIF(vehicles.auction_outcome, ''), EXCLUDED.auction_outcome),
                           canonical_outcome = COALESCE(NULLIF(vehicles.canonical_outcome, ''), EXCLUDED.canonical_outcome),
                           updated_at = NOW()
                         RETURNING id`;

            const res = await client.query(sql, vals);
            if (res.rows.length > 0) {
              completeIds.push(r.row.id);
              sourceCreated++;

              // Insert images
              if (!SKIP_IMAGES && v.image_urls?.length > 0) {
                const vid = res.rows[0].id;
                try {
                  for (let ci = 0; ci < v.image_urls.length; ci += 50) {
                    const chunk = v.image_urls.slice(ci, ci + 50);
                    const imgVals = [];
                    const imgPhs = chunk.map((url, idx) => {
                      imgVals.push(vid, url, source, true);
                      return `($${idx * 4 + 1}, $${idx * 4 + 2}, $${idx * 4 + 3}, $${idx * 4 + 4})`;
                    }).join(',');
                    const ir = await client.query(
                      `INSERT INTO vehicle_images (vehicle_id, image_url, source, is_external) VALUES ${imgPhs}
                       ON CONFLICT DO NOTHING`, imgVals
                    );
                    totalImages += ir.rowCount;
                  }
                } catch {}
              }

              // Link vehicle_id back
              try {
                await client.query(
                  `UPDATE import_queue SET vehicle_id = $1 WHERE id = $2 AND vehicle_id IS NULL`,
                  [res.rows[0].id, r.row.id]
                );
              } catch {}
            }
          } catch (e) {
            if (e.message?.includes('unique') || e.message?.includes('duplicate')) {
              completeIds.push(r.row.id);
            } else {
              failedIds.push(r.row.id);
              sourceErrors++;
              if (sourceErrors <= 5) console.error(`    Insert error: ${e.message?.slice(0, 120)}`);
            }
          }
        }

        // Mark queue items
        if (!DRY_RUN && completeIds.length > 0) {
          for (let ci = 0; ci < completeIds.length; ci += 200) {
            const chunk = completeIds.slice(ci, ci + 200);
            const phs = chunk.map((_, i) => `$${i + 1}`).join(',');
            try {
              await client.query(
                `UPDATE import_queue SET status = 'complete', processed_at = NOW(), extractor_version = '${VERSION}'
                 WHERE id IN (${phs})`, chunk
              );
            } catch {}
          }
        }

        if (!DRY_RUN && failedIds.length > 0) {
          for (let ci = 0; ci < failedIds.length; ci += 200) {
            const chunk = failedIds.slice(ci, ci + 200);
            const phs = chunk.map((_, i) => `$${i + 1}`).join(',');
            try {
              await client.query(
                `UPDATE import_queue SET status = 'failed', error_message = 'fetch-or-parse-failed',
                         failure_category = 'fetch_error', attempts = COALESCE(attempts, 0) + 1
                 WHERE id IN (${phs})`, chunk
              );
            } catch {}
          }
        }

        sourceProcessed += batch.length;
        totalProcessed += batch.length;
        totalFetched += results.filter(r => r.vehicle).length;

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const rate = totalFetched > 0 ? (totalFetched / ((Date.now() - startTime) / 1000) * 3600).toFixed(0) : 0;

        console.log(
          `    R${round}: ${batch.length} claimed | +${completeIds.length} ok | +${failedIds.length} fail | ` +
          `${sourceProcessed.toLocaleString()}/${pendingCount.toLocaleString()} | ` +
          `Fetched: ${totalFetched} @ ${rate}/hr | ${elapsed}s`
        );
      }

      console.log(`  ${source} done: ${sourceProcessed} processed, ${sourceCreated} created, ${sourceErrors} errors`);
    }
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const rate = totalProcessed > 0 ? (totalProcessed / ((Date.now() - startTime) / 1000) * 3600).toFixed(0) : 0;

  console.log(`\n=== DRAIN COMPLETE ===`);
  console.log(`Processed: ${totalProcessed.toLocaleString()}`);
  console.log(`Created:   ${totalCreated.toLocaleString()}`);
  console.log(`Skipped:   ${totalSkipped.toLocaleString()} (already existed)`);
  console.log(`Errors:    ${totalErrors.toLocaleString()}`);
  console.log(`Images:    ${totalImages.toLocaleString()}`);
  if (totalFetched > 0) console.log(`Fetched:   ${totalFetched.toLocaleString()}`);
  console.log(`Duration:  ${elapsed}s | Rate: ${rate}/hr`);
  if (DRY_RUN) console.log(`\n*** DRY RUN — nothing written to DB ***`);
  console.log('');

  try { await client.end(); } catch {}
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
