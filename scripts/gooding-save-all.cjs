#!/usr/bin/env node
/**
 * gooding-save-all.cjs
 *
 * Saves all Gooding lot data from their Gatsby page-data API.
 * Each lot page has a /page-data/lot/{slug}/page-data.json endpoint
 * that returns structured data including auction name, sale price, etc.
 *
 * Phase 1: Fetch all lot page-data and save locally
 * Phase 2: Geocode from auction names
 *
 * Usage: dotenvx run -- node scripts/gooding-save-all.cjs
 *        dotenvx run -- node scripts/gooding-save-all.cjs --enrich-only
 */

const pg = require('pg');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data', 'gooding-lots');
fs.mkdirSync(DATA_DIR, { recursive: true });

const args = process.argv.slice(2);
const ENRICH_ONLY = args.includes('--enrich-only');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const client = new pg.Client({
  connectionString: 'postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
  statement_timeout: 55000,
});

// Auction name → GPS
const AUCTION_GPS = {
  'pebble beach': [36.5725, -121.9486],
  'scottsdale': [33.4942, -111.9261],
  'amelia island': [30.6357, -81.4626],
  'palm beach': [26.7056, -80.0364],
  'geared online': null, // online auction, no location
  'monterey': [36.6002, -121.8947],
  'london': [51.5074, -0.1278],
  'paris': [48.8566, 2.3522],
  'passings': null, // online/private sales
};

function matchAuctionGPS(auctionName) {
  if (!auctionName) return null;
  const lower = auctionName.toLowerCase();
  for (const [keyword, gps] of Object.entries(AUCTION_GPS)) {
    if (lower.includes(keyword) && gps) {
      return { city: keyword, gps };
    }
  }
  return null;
}

async function fetchLotData(slug) {
  try {
    const url = `https://www.goodingco.com/page-data/lot/${slug}/page-data.json`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const lot = data?.result?.data?.contentfulLot;
    if (!lot) return null;

    return {
      slug: lot.slug,
      title: lot.title,
      lotNumber: lot.lotNumber,
      salePrice: lot.salePrice,
      lowEstimate: lot.lowEstimate,
      highEstimate: lot.highEstimate,
      auctionName: lot.auction?.name || null,
      auctionId: lot.auction?.contentful_id || null,
      item: lot.item ? {
        vin: lot.item?.vin,
        year: lot.item?.year,
        make: lot.item?.make,
        model: lot.item?.model,
        mileage: lot.item?.mileage,
        engine: lot.item?.engine,
        transmission: lot.item?.transmission,
        exteriorColor: lot.item?.exteriorColor,
        interiorColor: lot.item?.interiorColor,
      } : null,
    };
  } catch (e) {
    return null;
  }
}

async function downloadAll() {
  console.log('=== Phase 1: Downloading Gooding lot data ===');

  // Get all vehicle slugs from DB
  const result = await client.query(`
    SELECT listing_url FROM vehicles
    WHERE auction_source = 'gooding' AND deleted_at IS NULL AND listing_url IS NOT NULL
  `);

  const slugs = result.rows.map(r => {
    const m = r.listing_url.match(/\/lot\/([^?/]+)/);
    return m ? m[1] : null;
  }).filter(Boolean);

  console.log(`  Total Gooding vehicles: ${slugs.length}`);

  // Check what we already have
  const existing = new Set(
    fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''))
  );
  const toFetch = slugs.filter(s => !existing.has(s.replace(/[^a-zA-Z0-9_-]/g, '_')));
  console.log(`  Already saved: ${existing.size}, need to fetch: ${toFetch.length}`);

  let fetched = 0, errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < toFetch.length; i++) {
    const slug = toFetch[i];
    // Sanitize slug for filesystem
    const safeSlug = slug.replace(/[^a-zA-Z0-9_-]/g, '_');
    const data = await fetchLotData(slug);

    if (data) {
      fs.writeFileSync(path.join(DATA_DIR, `${safeSlug}.json`), JSON.stringify(data));
      fetched++;
    } else {
      // Save empty marker so we don't retry
      fs.writeFileSync(path.join(DATA_DIR, `${safeSlug}.json`), JSON.stringify(null));
      errors++;
    }

    if ((i + 1) % 100 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = (i + 1) / elapsed;
      const remaining = (toFetch.length - i - 1) / rate;
      console.log(`  [${i + 1}/${toFetch.length}] fetched: ${fetched}, errors: ${errors} — ${elapsed.toFixed(0)}s elapsed, ~${remaining.toFixed(0)}s remaining`);
    }

    await sleep(200); // Polite delay
  }

  console.log(`  Download complete: ${fetched} lots, ${errors} errors`);
}

async function enrichFromSaved() {
  console.log('\n=== Phase 2: Enriching Gooding vehicles ===');

  // Load all saved lots
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  console.log(`  Saved lot files: ${files.length}`);

  // Build slug → lot data map
  const lotMap = new Map();
  const auctionNames = new Map(); // Track all unique auction names
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
      if (data && data.slug) {
        lotMap.set(data.slug, data);
        if (data.auctionName) {
          auctionNames.set(data.auctionName, (auctionNames.get(data.auctionName) || 0) + 1);
        }
      }
    } catch (e) { /* skip */ }
  }

  console.log(`  Valid lots: ${lotMap.size}`);
  console.log(`  Unique auctions: ${auctionNames.size}`);
  for (const [name, count] of [...auctionNames.entries()].sort((a, b) => b[1] - a[1])) {
    const gps = matchAuctionGPS(name);
    console.log(`    ${name}: ${count} lots ${gps ? `→ ${gps.city}` : '→ UNMAPPED'}`);
  }

  // Load vehicles and update
  console.log('\n  Loading Gooding vehicles...');
  const vehicles = [];
  let lastId = '00000000-0000-0000-0000-000000000000';
  while (true) {
    const r = await client.query(`
      SELECT id, listing_url, year, make, model, sale_price, vin, title, status,
             gps_latitude, listing_location, mileage
      FROM vehicles
      WHERE auction_source = 'gooding' AND deleted_at IS NULL AND id > $1
      ORDER BY id LIMIT 5000
    `, [lastId]);
    if (r.rows.length === 0) break;
    vehicles.push(...r.rows);
    lastId = r.rows[r.rows.length - 1].id;
  }
  console.log(`  Gooding vehicles: ${vehicles.length}`);

  let updated = 0, matched = 0, gpsFixed = 0, priceFixed = 0;
  for (const vehicle of vehicles) {
    const slugM = vehicle.listing_url?.match(/\/lot\/(.+?)(?:\/)?$/);
    if (!slugM) continue;

    const lot = lotMap.get(slugM[1]);
    if (!lot) continue;
    matched++;

    const sets = [];
    const vals = [vehicle.id];
    let paramIdx = 2;

    // GPS from auction name
    if (!vehicle.gps_latitude && lot.auctionName) {
      const gps = matchAuctionGPS(lot.auctionName);
      if (gps) {
        sets.push(`gps_latitude = $${paramIdx}`); vals.push(gps.gps[0]); paramIdx++;
        sets.push(`gps_longitude = $${paramIdx}`); vals.push(gps.gps[1]); paramIdx++;
        sets.push(`listing_location = COALESCE(listing_location, $${paramIdx})`); vals.push(gps.city); paramIdx++;
        gpsFixed++;
      }
    }

    // Price
    if ((!vehicle.sale_price || vehicle.sale_price === 0) && lot.salePrice > 0) {
      sets.push(`sale_price = $${paramIdx}`); vals.push(lot.salePrice); paramIdx++;
      priceFixed++;
    }

    // VIN
    if ((!vehicle.vin || vehicle.vin === '') && lot.item?.vin && lot.item.vin.length >= 11) {
      sets.push(`vin = $${paramIdx}`); vals.push(lot.item.vin); paramIdx++;
    }

    // Year
    if (!vehicle.year && lot.item?.year) {
      sets.push(`year = $${paramIdx}`); vals.push(parseInt(lot.item.year)); paramIdx++;
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
  }

  console.log(`\n  Enrichment complete:`);
  console.log(`    Matched: ${matched}`);
  console.log(`    Updated: ${updated}`);
  console.log(`    GPS fixed: ${gpsFixed}`);
  console.log(`    Price fixed: ${priceFixed}`);
}

async function run() {
  await client.connect();

  if (!ENRICH_ONLY) {
    await downloadAll();
  }

  await enrichFromSaved();

  // Final stats
  const stats = await client.query(`
    SELECT COUNT(*)::int as total,
           COUNT(CASE WHEN sale_price > 0 THEN 1 END)::int as price,
           COUNT(CASE WHEN gps_latitude IS NOT NULL THEN 1 END)::int as gps,
           COUNT(CASE WHEN vin IS NOT NULL AND vin != '' THEN 1 END)::int as vin
    FROM vehicles WHERE auction_source = 'gooding' AND deleted_at IS NULL
  `);
  const s = stats.rows[0];
  console.log(`\n=== GOODING FINAL ===`);
  console.log(`Total: ${s.total}`);
  console.log(`  price: ${s.price} (${(s.price/s.total*100).toFixed(1)}%)`);
  console.log(`  GPS: ${s.gps} (${(s.gps/s.total*100).toFixed(1)}%)`);
  console.log(`  VIN: ${s.vin} (${(s.vin/s.total*100).toFixed(1)}%)`);

  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
