#!/usr/bin/env node
/**
 * mecum-algolia-save-all.cjs
 *
 * Downloads ALL Mecum lot data from their Algolia search index.
 * Algolia: App ID U6CFCQ7V52, public search key, index "wp_posts_lot"
 * 302,229 records as of 2026-03-02.
 *
 * Each record has: post_title, permalink (lot URL), auction_tax (event+city),
 * year, make, model, sold, highest_bid_or_price, color, engine, transmission,
 * images, lot_number, etc.
 *
 * Uses Algolia's browse endpoint to iterate all records (no 1000-hit limit).
 * Saves to local JSON files. Then enriches vehicles from saved data.
 *
 * Usage: dotenvx run -- node scripts/mecum-algolia-save-all.cjs
 *        dotenvx run -- node scripts/mecum-algolia-save-all.cjs --enrich-only
 */

const pg = require('pg');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data', 'mecum-algolia');
fs.mkdirSync(DATA_DIR, { recursive: true });

const args = process.argv.slice(2);
const ENRICH_ONLY = args.includes('--enrich-only');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ALGOLIA_APP_ID = 'U6CFCQ7V52';
const ALGOLIA_API_KEY = '0291c46cde807bcb428a021a96138fcb';
const INDEX_NAME = 'wp_posts_lot';

const client = new pg.Client({
  connectionString: 'postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
  statement_timeout: 55000,
});

// ── Mecum event city → GPS mapping ──
const CITY_GPS = {
  'Kissimmee': [28.2919, -81.4076],
  'Indy': [39.7684, -86.1581],
  'Indianapolis': [39.7684, -86.1581],
  'Glendale': [33.5387, -112.1860],
  'Monterey': [36.6002, -121.8947],
  'Las Vegas': [36.1699, -115.1398],
  'Harrisburg': [40.2732, -76.8867],
  'Dallas': [32.7767, -96.7970],
  'Houston': [29.7604, -95.3698],
  'Walworth': [42.5311, -88.5992],
  'Kansas City': [39.0997, -94.5786],
  'Tulsa': [36.1540, -95.9928],
  'Anamosa': [42.1083, -91.2850],
  'Chattanooga': [35.0456, -85.3097],
  'East Moline': [41.5070, -90.4404],
  'Davenport': [41.5236, -90.5776],
  'Orlando': [28.5383, -81.3792],
  'Portland': [45.5152, -122.6784],
  'Denver': [39.7392, -104.9903],
  'Frankfort': [38.2009, -84.8733],
  'Schaumburg': [42.0334, -88.0834],
  'Scottsdale': [33.4942, -111.9261],
  'Phoenix': [33.4484, -112.0740],
  'Chicago': [41.8781, -87.6298],
  'Louisville': [38.2527, -85.7585],
  'Osceola': [28.2919, -81.4076], // Same as Kissimmee area
  'Anaheim': [33.8366, -117.9143],
  'Santa Monica': [34.0195, -118.4912],
  'Los Angeles': [34.0522, -118.2437],
  'Austin': [30.2672, -97.7431],
  'Seattle': [47.6062, -122.3321],
  'St. Charles': [38.7837, -90.4973],
  'Punta Gorda': [26.9298, -82.0454],
  'Des Moines': [41.5868, -93.6250],
  'St. Paul': [44.9537, -93.0900],
  'San Diego County': [32.7157, -117.1611],
  'Nashville': [36.1627, -86.7816],
  'Shorewood': [41.5206, -88.2034],
  'Bloomington Gold': [39.1653, -86.5264], // Bloomington, IN
  'Pecatonica': [42.3139, -89.3584],
  'Ontario': [34.0633, -117.6509],
  'Fountain City': [44.1308, -91.7068], // WI
  'Jefferson': [36.4204, -81.4734], // NC (Vannoy Collection)
  'San Antonio': [29.4241, -98.4936],
  'Abilene': [38.9170, -97.2134], // KS (Abilene Machine)
  'Rogers': [36.3320, -94.1185], // AR (Rogers' Classic Car Museum)
  'Dallas/Fort Worth': [32.7767, -96.7970],
  'Indy Road Art': [39.7684, -86.1581], // Same as Indy
  'Indy Fall Special': [39.7684, -86.1581],
  'Las Vegas Motorcycles': [36.1699, -115.1398],
  'Las Vegas Motorcycles June': [36.1699, -115.1398],
  'Kansas City Spring': [39.0997, -94.5786],
  'Kansas City December': [39.0997, -94.5786],
  'Kansas City March': [39.0997, -94.5786],
  'Harrisburg Road Art': [40.2732, -76.8867],
  'Harrisburg Motorcycles': [40.2732, -76.8867],
  'Chicago Motorcycles': [41.8781, -87.6298],
  'Houston Motorcycles': [29.7604, -95.3698],
  'Indy Motorcycles': [39.7684, -86.1581],
  'Monterey Motorcycles': [36.6002, -121.8947],
  'Kissimmee Road Art': [28.2919, -81.4076],
  'Kissimmee Summer Special': [28.2919, -81.4076],
  'Orlando Summer Special': [28.5383, -81.3792],
  'Florida Summer Special': [28.2919, -81.4076],
};

function extractCity(auctionName) {
  if (!auctionName) return null;
  // Format: "City Year|timestamp|timestamp" or "City YYYY"
  let name = auctionName.split('|')[0].trim();
  // Remove year from end
  name = name.replace(/\s+\d{4}$/, '').trim();

  // Try direct match first
  if (CITY_GPS[name]) return name;

  // Strip common suffixes: "Motorcycles", "Road Art", "Summer Special", etc.
  const suffixes = [
    ' Motorcycles June', ' Motorcycles', ' Road Art', ' Summer Special',
    ' Fall Special', ' Spring Classic', ' Spring', ' Fall Premier',
    ' Fall', ' December', ' March', ' Tractor Auction',
    ' Iowa Premier', ' Iowa Spring', ' Iowa', ' Tractor Spring Classic',
  ];
  for (const suffix of suffixes) {
    if (name.endsWith(suffix)) {
      const stripped = name.slice(0, -suffix.length).trim();
      if (CITY_GPS[stripped]) return stripped;
    }
  }

  // Handle "Gone Farmin'" prefix events
  if (name.startsWith("Gone Farmin'")) {
    // Check for city after the prefix
    const afterPrefix = name.replace("Gone Farmin'", '').trim();
    if (CITY_GPS[afterPrefix]) return afterPrefix;
    // Default Gone Farmin' to Walworth
    return 'Walworth';
  }

  // Handle "Dana Mecum's" events → Indianapolis
  if (name.startsWith("Dana Mecum's")) return 'Indianapolis';

  // Handle "The Road Art" events → Indianapolis
  if (name.includes('Road Art')) return 'Indianapolis';

  // Handle "Florida Summer Special" → Kissimmee
  if (name.includes('Florida')) return 'Kissimmee';

  // Named collection auctions with known locations
  const collectionLocations = {
    'The Eddie Vannoy Collection': 'Jefferson',
    "Elmer's Auto": 'Fountain City',
    'The John Parham Estate': 'Anamosa',
    'Larry\'s Legacy': 'Indianapolis',
    'The Walker Sign Collection': 'Indianapolis',
    'Charles Schneider Collection': 'Indianapolis',
    'Ron Drosselmeyer Collection': 'Indianapolis',
    'The Salmon Brothers Collection': 'Indianapolis',
    'EJ Cole Collection': 'Indianapolis',
    'Schaaf Tractor': 'Indianapolis',
    "Fran and Ron Green's": 'San Antonio',
    'The Toy Auction': 'Indianapolis',
    'The Abilene Machine': 'Abilene',
    'The Henry': 'Indianapolis',
    'The David J. Sniader': 'Indianapolis',
  };

  for (const [pattern, city] of Object.entries(collectionLocations)) {
    if (name.includes(pattern)) return city;
  }

  return name || null;
}

// ── Algolia search helper ──
async function algoliaSearch(params) {
  const url = `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/*/queries`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Algolia-Application-Id': ALGOLIA_APP_ID,
      'X-Algolia-API-Key': ALGOLIA_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [{ indexName: INDEX_NAME, params }],
    }),
  });
  if (!res.ok) throw new Error(`Algolia HTTP ${res.status}`);
  const data = await res.json();
  return data.results[0];
}

// ── Phase 1: Download all records from Algolia ──
// Browse endpoint needs admin key, so we segment by auction event (263 events, each < 10K lots)
async function downloadAll() {
  console.log('=== Phase 1: Downloading all Mecum lots from Algolia ===');

  // Step 1: Get all auction event slugs
  console.log('  Fetching auction event list...');
  const facetResult = await algoliaSearch(
    'hitsPerPage=0&facets=%5B%22taxonomies.auction_tax.slug%22%5D&maxValuesPerFacet=500'
  );
  const eventFacets = facetResult.facets?.['taxonomies.auction_tax.slug'] || {};
  const events = Object.entries(eventFacets).sort((a, b) => b[1] - a[1]);
  console.log(`  Found ${events.length} auction events, ${facetResult.nbHits.toLocaleString()} total lots`);

  // Step 2: Download each event's lots
  const allHits = [];
  const startTime = Date.now();

  for (let i = 0; i < events.length; i++) {
    const [slug, count] = events[i];

    // Check if we already saved this event
    const eventFile = path.join(DATA_DIR, `event_${slug}.json`);
    if (fs.existsSync(eventFile)) {
      try {
        const cached = JSON.parse(fs.readFileSync(eventFile, 'utf8'));
        allHits.push(...cached);
        if ((i + 1) % 20 === 0) {
          console.log(`  [${i + 1}/${events.length}] ${slug}: ${cached.length} lots (cached) — total: ${allHits.length}`);
        }
        continue;
      } catch (e) { /* re-download */ }
    }

    const eventHits = [];
    const totalPages = Math.ceil(count / 1000);

    for (let page = 0; page < totalPages && page < 10; page++) {
      try {
        const result = await algoliaSearch(
          `hitsPerPage=1000&page=${page}&filters=taxonomies.auction_tax.slug%3A${encodeURIComponent(slug)}`
        );
        const hits = result.hits || [];
        for (const h of hits) {
          const { _highlightResult, _snippetResult, ...rest } = h;
          eventHits.push(rest);
        }
        if (hits.length < 1000) break;
        await sleep(100);
      } catch (e) {
        console.log(`  ${slug} page ${page} error: ${e.message}`);
        break;
      }
    }

    // Save per-event file
    fs.writeFileSync(eventFile, JSON.stringify(eventHits));
    allHits.push(...eventHits);

    const elapsed = (Date.now() - startTime) / 1000;
    if ((i + 1) % 10 === 0 || eventHits.length > 2000) {
      console.log(`  [${i + 1}/${events.length}] ${slug}: ${eventHits.length} lots — total: ${allHits.length.toLocaleString()} — ${elapsed.toFixed(0)}s`);
    }

    await sleep(150);
  }

  console.log(`  Download complete: ${allHits.length.toLocaleString()} total lots across ${events.length} event files`);
}

// ── Phase 2: Enrich vehicles from saved data ──
async function enrichFromSaved() {
  console.log('\n=== Phase 2: Enriching vehicles from saved Mecum Algolia data ===');

  // Load from individual event files (combined file too large for Node.js string limit)
  const eventFiles = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('event_') && f.endsWith('.json'));
  if (eventFiles.length === 0) {
    console.log('  No saved data found! Run without --enrich-only first.');
    return;
  }

  const lots = [];
  for (const file of eventFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
      lots.push(...data);
    } catch (e) { /* skip corrupt files */ }
  }
  console.log(`  Loaded ${lots.length.toLocaleString()} lots from ${eventFiles.length} event files`);

  // Build permalink → lot data map
  const lotMap = new Map();
  for (const lot of lots) {
    if (lot.permalink) {
      // Normalize: /lots/NNNN/description/ → mecum.com/lots/NNNN/description
      const url = 'https://mecum.com' + lot.permalink.replace(/\/$/, '');
      lotMap.set(url, lot);
      // Also store by lot ID for matching
      const lotId = lot.permalink.match(/\/lots\/(\d+)\//);
      if (lotId) lotMap.set(lotId[1], lot);
    }
  }
  console.log(`  Indexed ${lotMap.size.toLocaleString()} entries`);

  // Load Mecum vehicles
  console.log('  Loading Mecum vehicles...');
  const vehicles = [];
  let lastId = '00000000-0000-0000-0000-000000000000';
  while (true) {
    const r = await client.query(`
      SELECT id, listing_url, year, make, model, sale_price, gps_latitude,
             listing_location, vin, title, status, mileage
      FROM vehicles
      WHERE auction_source = 'mecum' AND deleted_at IS NULL
        AND id > $1
      ORDER BY id LIMIT 5000
    `, [lastId]);
    if (r.rows.length === 0) break;
    vehicles.push(...r.rows);
    lastId = r.rows[r.rows.length - 1].id;
  }
  console.log(`  Mecum vehicles: ${vehicles.length.toLocaleString()}`);

  // Match and update
  let updated = 0, matched = 0, gpsFixed = 0, priceFixed = 0;
  for (const vehicle of vehicles) {
    let lot = null;

    if (vehicle.listing_url) {
      // Try exact URL match
      const normalUrl = vehicle.listing_url.replace(/\/$/, '');
      lot = lotMap.get(normalUrl);

      // Try by lot ID
      if (!lot) {
        const lotId = vehicle.listing_url.match(/lots\/(\d+)/);
        if (lotId) lot = lotMap.get(lotId[1]);
      }
    }

    if (!lot) continue;
    matched++;

    const sets = [];
    const vals = [vehicle.id];
    let paramIdx = 2;

    // GPS from auction event
    if (!vehicle.gps_latitude) {
      const auctionTax = lot.taxonomies?.auction_tax?.[0]?.name;
      const city = extractCity(auctionTax);
      if (city) {
        const gps = CITY_GPS[city];
        if (gps) {
          sets.push(`gps_latitude = $${paramIdx}`); vals.push(gps[0]); paramIdx++;
          sets.push(`gps_longitude = $${paramIdx}`); vals.push(gps[1]); paramIdx++;
          sets.push(`listing_location = COALESCE(listing_location, $${paramIdx})`); vals.push(city); paramIdx++;
          gpsFixed++;
        }
      }
    }

    // Price
    if ((!vehicle.sale_price || vehicle.sale_price === 0) && lot.highest_bid_or_price > 0) {
      sets.push(`sale_price = $${paramIdx}`); vals.push(lot.highest_bid_or_price); paramIdx++;
      priceFixed++;
    }

    // Year
    if (!vehicle.year) {
      const yearTax = lot.taxonomies?.lot_year?.[0]?.name;
      if (yearTax) {
        sets.push(`year = $${paramIdx}`); vals.push(parseInt(yearTax)); paramIdx++;
      }
    }

    // Make
    if (!vehicle.make || vehicle.make === '') {
      const makeTax = lot.taxonomies?.make?.[0]?.name;
      if (makeTax) {
        sets.push(`make = $${paramIdx}`); vals.push(makeTax); paramIdx++;
      }
    }

    // Model
    if (!vehicle.model || vehicle.model === '') {
      const modelTax = lot.taxonomies?.model?.[0]?.name;
      if (modelTax) {
        sets.push(`model = $${paramIdx}`); vals.push(modelTax); paramIdx++;
      }
    }

    // Title
    if ((!vehicle.title || vehicle.title === '') && lot.post_title) {
      sets.push(`title = $${paramIdx}`); vals.push(lot.post_title); paramIdx++;
      sets.push(`listing_title = $${paramIdx}`); vals.push(lot.post_title); paramIdx++;
    }

    // Promote pending_backfill
    if (vehicle.status === 'pending_backfill') {
      sets.push(`status = $${paramIdx}`); vals.push('active'); paramIdx++;
    }

    if (sets.length > 0) {
      await client.query(`UPDATE vehicles SET ${sets.join(', ')} WHERE id = $1`, vals);
      updated++;
    }

    if (updated % 2000 === 0 && updated > 0) {
      console.log(`  Updated ${updated.toLocaleString()} (GPS: ${gpsFixed}, price: ${priceFixed})`);
      await sleep(50);
    }
  }

  console.log(`\n  Enrichment complete:`);
  console.log(`    Matched: ${matched.toLocaleString()}`);
  console.log(`    Updated: ${updated.toLocaleString()}`);
  console.log(`    GPS fixed: ${gpsFixed.toLocaleString()}`);
  console.log(`    Price fixed: ${priceFixed.toLocaleString()}`);
}

// ── Phase 3: Match URL-less vehicles by year+make+price ──
async function enrichByYearMakePrice() {
  console.log('\n=== Phase 3: Matching URL-less Mecum vehicles by year+make+price ===');

  // Load all event files
  const eventFiles = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('event_') && f.endsWith('.json'));
  if (eventFiles.length === 0) return;

  // Build year+make+price → lot data map (only lots with unique combos)
  const keyMap = new Map(); // key → lot
  const dupeKeys = new Set();
  let lotCount = 0;

  for (const file of eventFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
      for (const lot of data) {
        const year = lot.taxonomies?.lot_year?.[0]?.name;
        const make = lot.taxonomies?.make?.[0]?.name;
        const price = lot.highest_bid_or_price || lot.hammer_price_meta;
        if (!year || !make || !price || price <= 0) continue;

        const key = `${year}|${make.toLowerCase()}|${price}`;
        if (dupeKeys.has(key)) continue;
        if (keyMap.has(key)) {
          dupeKeys.add(key);
          keyMap.delete(key);
          continue;
        }
        keyMap.set(key, lot);
        lotCount++;
      }
    } catch (e) { /* skip */ }
  }

  console.log(`  Built ${keyMap.size.toLocaleString()} unique year+make+price keys (${dupeKeys.size.toLocaleString()} dupes excluded)`);

  // Load URL-less Mecum vehicles without GPS
  const vehicles = [];
  let lastId = '00000000-0000-0000-0000-000000000000';
  while (true) {
    const r = await client.query(`
      SELECT id, year, make, sale_price, gps_latitude, listing_url, listing_location
      FROM vehicles
      WHERE auction_source = 'mecum' AND deleted_at IS NULL
        AND listing_url IS NULL AND gps_latitude IS NULL
        AND id > $1
      ORDER BY id LIMIT 5000
    `, [lastId]);
    if (r.rows.length === 0) break;
    vehicles.push(...r.rows);
    lastId = r.rows[r.rows.length - 1].id;
  }
  console.log(`  URL-less vehicles without GPS: ${vehicles.length.toLocaleString()}`);

  let matched = 0, gpsFixed = 0, urlFixed = 0;
  for (const vehicle of vehicles) {
    if (!vehicle.year || !vehicle.make || !vehicle.sale_price) continue;

    const key = `${vehicle.year}|${vehicle.make.toLowerCase()}|${vehicle.sale_price}`;
    const lot = keyMap.get(key);
    if (!lot) continue;
    matched++;

    const sets = [];
    const vals = [vehicle.id];
    let paramIdx = 2;

    // GPS from auction event
    const auctionTax = lot.taxonomies?.auction_tax?.[0]?.name;
    const city = extractCity(auctionTax);
    if (city) {
      const gps = CITY_GPS[city];
      if (gps) {
        sets.push(`gps_latitude = $${paramIdx}`); vals.push(gps[0]); paramIdx++;
        sets.push(`gps_longitude = $${paramIdx}`); vals.push(gps[1]); paramIdx++;
        sets.push(`listing_location = COALESCE(listing_location, $${paramIdx})`); vals.push(city); paramIdx++;
        gpsFixed++;
      }
    }

    // Add listing_url from permalink
    if (lot.permalink) {
      const url = 'https://www.mecum.com' + lot.permalink.replace(/\/$/, '');
      sets.push(`listing_url = $${paramIdx}`); vals.push(url); paramIdx++;
      urlFixed++;
    }

    if (sets.length > 0) {
      await client.query(`UPDATE vehicles SET ${sets.join(', ')} WHERE id = $1`, vals);
    }

    if (matched % 2000 === 0 && matched > 0) {
      console.log(`  Matched ${matched.toLocaleString()} (GPS: ${gpsFixed}, URLs: ${urlFixed})`);
    }
  }

  console.log(`\n  Phase 3 complete:`);
  console.log(`    Matched: ${matched.toLocaleString()}`);
  console.log(`    GPS fixed: ${gpsFixed.toLocaleString()}`);
  console.log(`    URLs added: ${urlFixed.toLocaleString()}`);
}

async function run() {
  await client.connect();

  if (!ENRICH_ONLY) {
    await downloadAll();
  }

  await enrichFromSaved();
  await enrichByYearMakePrice();

  // Final stats
  const stats = await client.query(`
    SELECT
      COUNT(*)::int as total,
      COUNT(CASE WHEN sale_price > 0 THEN 1 END)::int as price,
      COUNT(CASE WHEN year IS NOT NULL THEN 1 END)::int as yr,
      COUNT(CASE WHEN gps_latitude IS NOT NULL THEN 1 END)::int as gps,
      COUNT(CASE WHEN vin IS NOT NULL AND vin != '' THEN 1 END)::int as vin,
      COUNT(CASE WHEN mileage IS NOT NULL AND mileage > 0 THEN 1 END)::int as mileage,
      COUNT(CASE WHEN status = 'pending_backfill' THEN 1 END)::int as pending
    FROM vehicles WHERE auction_source = 'mecum' AND deleted_at IS NULL
  `);
  const s = stats.rows[0];
  console.log(`\n=== MECUM FINAL ===`);
  console.log(`Total: ${s.total.toLocaleString()}`);
  console.log(`  price: ${s.price} (${(s.price/s.total*100).toFixed(1)}%)`);
  console.log(`  year: ${s.yr} (${(s.yr/s.total*100).toFixed(1)}%)`);
  console.log(`  GPS: ${s.gps} (${(s.gps/s.total*100).toFixed(1)}%)`);
  console.log(`  VIN: ${s.vin} (${(s.vin/s.total*100).toFixed(1)}%)`);
  console.log(`  mileage: ${s.mileage} (${(s.mileage/s.total*100).toFixed(1)}%)`);
  console.log(`  pending_backfill: ${s.pending}`);

  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
