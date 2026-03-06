#!/usr/bin/env node
/**
 * collecting-cars-save-all.cjs
 *
 * Downloads ALL Collecting Cars listings from their Typesense API.
 * API: https://dora.production.collecting.com/multi_search
 * Key: pHuIUBo3XGxHk9Ll9g4q71qXbTYAM2w1 (public client-side key)
 *
 * Saves to local JSON, then enriches vehicles with GPS from location field.
 *
 * Usage: dotenvx run -- node scripts/collecting-cars-save-all.cjs
 *        dotenvx run -- node scripts/collecting-cars-save-all.cjs --enrich-only
 */

const pg = require('pg');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data', 'collecting-cars');
fs.mkdirSync(DATA_DIR, { recursive: true });

const args = process.argv.slice(2);
const ENRICH_ONLY = args.includes('--enrich-only');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const API_URL = 'https://dora.production.collecting.com/multi_search?x-typesense-api-key=pHuIUBo3XGxHk9Ll9g4q71qXbTYAM2w1';

const client = new pg.Client({
  connectionString: 'postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
  statement_timeout: 55000,
});

async function typesenseSearch(filterBy, page = 1, perPage = 250) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      searches: [{
        collection: 'production_cars',
        q: '*',
        filter_by: filterBy,
        per_page: perPage,
        page: page,
        query_by: 'title,productMake,vehicleMake,productYear',
      }],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.results[0];
}

async function downloadAll() {
  console.log('=== Phase 1: Downloading all Collecting Cars listings ===');

  for (const stage of ['sold', 'live', 'comingsoon']) {
    const stageFile = path.join(DATA_DIR, `${stage}.json`);

    // Check if already saved
    if (fs.existsSync(stageFile)) {
      const stats = fs.statSync(stageFile);
      if (stats.size > 1000) {
        const data = JSON.parse(fs.readFileSync(stageFile, 'utf8'));
        console.log(`  ${stage}: ${data.length} lots (cached, ${(stats.size/1024).toFixed(0)} KB)`);
        continue;
      }
    }

    console.log(`  Fetching ${stage} listings...`);
    const allHits = [];
    let page = 1;
    let total = 0;

    while (true) {
      try {
        const filter = `listingStage:${stage} && lotType:car`;
        const result = await typesenseSearch(filter, page, 250);
        total = result.found;

        const docs = (result.hits || []).map(h => h.document);
        allHits.push(...docs);

        console.log(`  ${stage} page ${page}: ${docs.length} hits (total: ${allHits.length}/${total})`);

        if (docs.length < 250 || allHits.length >= total) break;
        page++;
        await sleep(200);
      } catch (e) {
        console.log(`  ${stage} page ${page} error: ${e.message}`);
        break;
      }
    }

    fs.writeFileSync(stageFile, JSON.stringify(allHits, null, 0));
    console.log(`  ${stage}: ${allHits.length} lots saved`);
  }
}

// Major city geocoding lookup
const CITY_GPS = {
  'london': [51.5074, -0.1278], 'surrey': [51.3148, -0.5600],
  'essex': [51.7343, 0.4691], 'kent': [51.2787, 0.5217],
  'hampshire': [51.0577, -1.3081], 'berkshire': [51.4534, -1.1736],
  'buckinghamshire': [51.8137, -0.8095], 'hertfordshire': [51.8098, -0.2377],
  'sussex': [50.9252, -0.4800], 'oxfordshire': [51.7519, -1.2578],
  'manchester': [53.4808, -2.2426], 'birmingham': [52.4862, -1.8904],
  'bristol': [51.4545, -2.5879], 'leeds': [53.8008, -1.5491],
  'edinburgh': [55.9533, -3.1883], 'glasgow': [55.8642, -4.2518],
  'melbourne': [-37.8136, 144.9631], 'sydney': [-33.8688, 151.2093],
  'brisbane': [-27.4698, 153.0251], 'perth': [-31.9505, 115.8605],
  'dubai': [25.2048, 55.2708], 'abu dhabi': [24.4539, 54.3773],
  'paris': [48.8566, 2.3522], 'amsterdam': [52.3676, 4.9041],
  'munich': [48.1351, 11.5820], 'berlin': [52.5200, 13.4050],
  'tokyo': [35.6762, 139.6503], 'hong kong': [22.3193, 114.1694],
  'new york': [40.7128, -74.0060], 'los angeles': [34.0522, -118.2437],
  'san francisco': [37.7749, -122.4194], 'chicago': [41.8781, -87.6298],
  'miami': [25.7617, -80.1918],
};

// Country code → approximate GPS
const COUNTRY_GPS = {
  'GB': [51.5074, -0.1278], 'AU': [-33.8688, 151.2093],
  'US': [39.8283, -98.5795], 'AE': [25.2048, 55.2708],
  'NL': [52.3676, 4.9041], 'DE': [50.1109, 8.6821],
  'FR': [48.8566, 2.3522], 'IT': [41.9028, 12.4964],
  'JP': [35.6762, 139.6503], 'CH': [47.3769, 8.5417],
  'BE': [50.8503, 4.3517], 'ES': [40.4168, -3.7038],
  'CA': [43.6532, -79.3832], 'NZ': [-36.8485, 174.7633],
  'SE': [59.3293, 18.0686], 'SG': [1.3521, 103.8198],
  'HK': [22.3193, 114.1694], 'IE': [53.3498, -6.2603],
  'AT': [48.2082, 16.3738], 'PT': [38.7223, -9.1393],
  'DK': [55.6761, 12.5683], 'NO': [59.9139, 10.7522],
  'ZA': [-33.9249, 18.4241], 'PL': [52.2297, 21.0122],
};

function matchGPS(location, countryCode) {
  if (location) {
    const lower = location.toLowerCase();
    for (const [city, gps] of Object.entries(CITY_GPS)) {
      if (lower.includes(city)) return { gps, city };
    }
  }
  if (countryCode && COUNTRY_GPS[countryCode]) {
    return { gps: COUNTRY_GPS[countryCode], city: countryCode };
  }
  return null;
}

async function enrichFromSaved() {
  console.log('\n=== Phase 2: Enriching Collecting Cars vehicles ===');

  // Load all saved data
  const allLots = [];
  for (const stage of ['sold', 'live', 'comingsoon']) {
    const f = path.join(DATA_DIR, `${stage}.json`);
    if (fs.existsSync(f)) {
      const data = JSON.parse(fs.readFileSync(f, 'utf8'));
      allLots.push(...data);
    }
  }
  console.log(`  Total lots: ${allLots.length}`);

  // Build slug → lot map (exact + base slug without trailing -N)
  const lotMap = new Map();
  for (const lot of allLots) {
    if (lot.slug) {
      lotMap.set(lot.slug, lot);
      // Also index by base slug (strip trailing -N suffix for fuzzy match)
      const base = lot.slug.replace(/-\d+$/, '');
      if (!lotMap.has(base)) lotMap.set(base, lot);
    }
    if (lot.auctionId) lotMap.set(String(lot.auctionId), lot);
  }
  console.log(`  Indexed: ${lotMap.size} entries`);

  // Load vehicles
  const vehicles = [];
  let lastId = '00000000-0000-0000-0000-000000000000';
  while (true) {
    const r = await client.query(`
      SELECT id, listing_url, year, make, model, sale_price, gps_latitude,
             listing_location, vin, title, status
      FROM vehicles
      WHERE auction_source = 'collecting_cars' AND deleted_at IS NULL AND id > $1
      ORDER BY id LIMIT 5000
    `, [lastId]);
    if (r.rows.length === 0) break;
    vehicles.push(...r.rows);
    lastId = r.rows[r.rows.length - 1].id;
  }
  console.log(`  Vehicles: ${vehicles.length}`);

  let matched = 0, updated = 0, gpsFixed = 0;
  for (const vehicle of vehicles) {
    let lot = null;
    if (vehicle.listing_url) {
      // URL format: collectingcars.com/for-sale/{slug}
      const m = vehicle.listing_url.match(/for-sale\/(.+?)(?:\/)?$/);
      if (m) lot = lotMap.get(m[1]);
    }
    if (!lot) continue;
    matched++;

    const sets = [];
    const vals = [vehicle.id];
    let paramIdx = 2;

    // GPS - prefer coords from Typesense, fall back to city match
    if (!vehicle.gps_latitude) {
      let lat, lon, locText;
      if (lot.coords && lot.coords.length === 2 && lot.coords[0] !== 0) {
        lat = lot.coords[0]; lon = lot.coords[1];
        locText = lot.location || lot.countryCode;
      } else {
        const gps = matchGPS(lot.location, lot.countryCode);
        if (gps) { lat = gps.gps[0]; lon = gps.gps[1]; locText = lot.location || gps.city; }
      }
      if (lat && lon) {
        sets.push(`gps_latitude = $${paramIdx}`); vals.push(lat); paramIdx++;
        sets.push(`gps_longitude = $${paramIdx}`); vals.push(lon); paramIdx++;
        sets.push(`listing_location = COALESCE(listing_location, $${paramIdx})`); vals.push(locText); paramIdx++;
        gpsFixed++;
      }
    }

    // Price - try priceSold first, then currentBid
    if (!vehicle.sale_price || vehicle.sale_price === 0) {
      const price = lot.priceSold > 0 ? lot.priceSold : (lot.currentBid > 0 ? lot.currentBid : 0);
      if (price > 0) {
        sets.push(`sale_price = $${paramIdx}`); vals.push(price); paramIdx++;
      }
    }

    if (sets.length > 0) {
      await client.query(`UPDATE vehicles SET ${sets.join(', ')} WHERE id = $1`, vals);
      updated++;
    }
  }

  console.log(`\n  Matched: ${matched}, Updated: ${updated}, GPS fixed: ${gpsFixed}`);
}

async function run() {
  await client.connect();

  if (!ENRICH_ONLY) {
    await downloadAll();
  }

  await enrichFromSaved();

  const stats = await client.query(`
    SELECT COUNT(*)::int as total,
           COUNT(CASE WHEN gps_latitude IS NOT NULL THEN 1 END)::int as gps,
           COUNT(CASE WHEN sale_price > 0 THEN 1 END)::int as price
    FROM vehicles WHERE auction_source = 'collecting_cars' AND deleted_at IS NULL
  `);
  const s = stats.rows[0];
  console.log(`\n=== COLLECTING CARS FINAL ===`);
  console.log(`Total: ${s.total}`);
  console.log(`  GPS: ${s.gps} (${(s.gps/s.total*100).toFixed(1)}%)`);
  console.log(`  Price: ${s.price} (${(s.price/s.total*100).toFixed(1)}%)`);

  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
