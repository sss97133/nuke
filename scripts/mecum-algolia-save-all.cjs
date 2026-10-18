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
 *        dotenvx run -- node scripts/mecum-algolia-save-all.cjs --dedup-only [--dry-run]
 *        dotenvx run -- node scripts/mecum-algolia-save-all.cjs --phase3-only [--dry-run]
 *        dotenvx run -- node scripts/mecum-algolia-save-all.cjs --lot-urls-only [--enqueue=N] [--dry-run]
 *
 * --dedup-only     merge duplicate Mecum lot pairs, skip enrichment
 * --phase3-only    run only the year+make+price match (Phase 3)
 * --lot-urls-only  set listing_url from a canonical Mecum lot discovery_url (Phase 4); merge vehicles that share the lot
 * --enqueue=N      with --lot-urls-only: queue up to N promoted lots (this run's, then earlier runs' not yet landed) for
 *                  extract-mecum's targets lane
 * --dry-run        count what dedup / Phase 3 / Phase 4 would write, write nothing
 */

const pg = require('pg');
const fs = require('fs');
const path = require('path');

const DATA_DIR = fs.existsSync(path.join(__dirname, 'data', 'mecum-algolia'))
  ? path.join(__dirname, 'data', 'mecum-algolia')
  : '/Users/skylar/nuke/scripts/data/mecum-algolia';
fs.mkdirSync(DATA_DIR, { recursive: true });

const args = process.argv.slice(2);
const ENRICH_ONLY = args.includes('--enrich-only');
const DEDUP_ONLY = args.includes('--dedup-only');
const PHASE3_ONLY = args.includes('--phase3-only');
const DRY_RUN = args.includes('--dry-run');
const LOT_URLS_ONLY = args.includes('--lot-urls-only');
const ENQUEUE_LIMIT = Math.max(0, parseInt((args.find(a => a.startsWith('--enqueue=')) || '--enqueue=0').split('=')[1], 10) || 0);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// vehicles has no auction_source index: page by uuid prefix so each statement is a short pkey range scan
const ID_WINDOWS = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
async function loadMecumVehicles(columns, extraWhere = 'TRUE') {
  const rows = [];
  for (let i = 0; i < ID_WINDOWS.length; i++) {
    const lo = `${ID_WINDOWS[i]}000000-0000-0000-0000-000000000000`;
    const hi = i + 1 < ID_WINDOWS.length ? `${ID_WINDOWS[i + 1]}000000-0000-0000-0000-000000000000` : null;
    const r = await client.query(`
      SELECT ${columns}
      FROM vehicles
      WHERE id >= $1::uuid ${hi ? 'AND id < $2::uuid' : ''}
        AND auction_source = 'mecum' AND deleted_at IS NULL
        AND (${extraWhere})
    `, hi ? [lo, hi] : [lo]);
    rows.push(...r.rows);
    if ((i + 1) % 64 === 0) console.log(`  [${i + 1}/${ID_WINDOWS.length} id windows] ${rows.length.toLocaleString()} rows`);
  }
  return rows;
}

const normLotPath = (u) => {
  if (!u) return '';
  const m = String(u).toLowerCase().match(/\/lots\/([^/?#]+)(?:\/([^/?#]+))?/);
  return m ? (m[2] ? `${m[1]}/${m[2]}` : m[1]) : '';
};
const lotKey = (u) => normLotPath(u).split('/')[0] || null;

const isMecumHost = (u) => {
  try {
    return /(^|\.)mecum\.com$/i.test(new URL(u).hostname);
  } catch {
    return false;
  }
};

const ALGOLIA_APP_ID = 'U6CFCQ7V52';
const ALGOLIA_API_KEY = '0291c46cde807bcb428a021a96138fcb';
const INDEX_NAME = 'wp_posts_lot';

const client = new pg.Client({
  connectionString: `postgresql://postgres.qkgaybvrernstplzjaam:${process.env.SUPABASE_DB_PASSWORD}@aws-0-us-west-1.pooler.supabase.com:5432/postgres`,
  statement_timeout: 300000,
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

  // Build permalink / lot code → lot data map (case-insensitive)
  const parseSaleDate = (lot) => {
    const runDate = lot.taxonomies?.run_date?.[0]?.name;
    if (runDate && /^\d{4}-\d{2}-\d{2}/.test(runDate)) return runDate.slice(0, 10);
    if (lot.auction_day_start_meta && /^\d{4}-\d{2}-\d{2}/.test(lot.auction_day_start_meta)) return lot.auction_day_start_meta.slice(0, 10);
    if (typeof lot.auction_end_date_meta === 'number' && lot.auction_end_date_meta > 0) {
      return new Date(lot.auction_end_date_meta * 1000).toISOString().slice(0, 10);
    }
    return null;
  };

  const lotMap = new Map();
  for (const lot of lots) {
    if (lot.permalink) {
      const p = normLotPath(lot.permalink);
      if (p) lotMap.set(p, lot);
      const firstSeg = p.split('/')[0];
      if (firstSeg) lotMap.set(firstSeg, lot);
    }
    if (lot.web_id_meta) {
      lotMap.set(String(lot.web_id_meta).toLowerCase(), lot);
    }
  }
  console.log(`  Indexed ${lotMap.size.toLocaleString()} entries`);

  console.log('  Loading Mecum vehicles...');
  const allVehicles = await loadMecumVehicles(`
    id, listing_url, discovery_url, year, make, model, sale_price, sale_status, sale_date,
    primary_image_url, image_count, color, interior_color, transmission, body_style, engine_size,
    description, provenance_metadata, gps_latitude, listing_location, vin, title, status, mileage, user_id, created_at
  `);
  console.log(`  Mecum vehicles loaded: ${allVehicles.length.toLocaleString()}`);

  const mergedDupIds = await dedupMecumVehicles(allVehicles);
  await enrichVehicles(allVehicles.filter(v => !mergedDupIds.has(v.id)), lotMap, parseSaleDate);
}

// ── Phase 1.5: Deduplicate Mecum vehicles sharing the same canonical lot key ──
async function dedupMecumVehicles(allVehicles) {
  const byLotKey = new Map();
  for (const v of allVehicles) {
    const rawUrl = v.listing_url || v.discovery_url;
    if (!rawUrl) continue;
    const p = normLotPath(rawUrl);
    const k = p ? p.split('/')[0] : null;
    if (!k) continue;
    let group = byLotKey.get(k);
    if (!group) {
      group = [];
      byLotKey.set(k, group);
    }
    group.push(v);
  }

  const mergePairs = [];
  let dupGroupsCount = 0, userOwnedSkipped = 0;
  for (const [, group] of byLotKey.entries()) {
    if (group.length < 2) continue;
    dupGroupsCount++;
    group.sort(byMergePriority);
    const primary = group[0];
    for (let i = 1; i < group.length; i++) {
      const dup = group[i];
      if (primary.user_id || dup.user_id) { // Gate 2: never auto-merge user-owned vehicles
        userOwnedSkipped++;
        continue;
      }
      mergePairs.push({ primary, dup });
    }
  }
  console.log(`  Found ${mergePairs.length.toLocaleString()} duplicate Mecum pairs across ${dupGroupsCount.toLocaleString()} lot groups (${userOwnedSkipped.toLocaleString()} user-owned pairs skipped)`);
  if (DRY_RUN) return new Set();
  const mergedDupIds = await mergeDuplicatePairs(mergePairs);
  console.log(`  Mecum dedup complete: ${mergedDupIds.size.toLocaleString()} duplicate rows merged across ${dupGroupsCount.toLocaleString()} lot groups`);
  return mergedDupIds;
}

const scoreVehicle = (v) =>
  (v.user_id ? 1000 : 0) +
  (Math.min(v.image_count || 0, 50) * 2) +
  (v.sale_status === 'sold' && v.sale_price > 0 ? 10 : 0) +
  (v.primary_image_url ? 4 : 0) +
  (v.listing_url ? 2 : 0) +
  (v.discovery_url ? 2 : 0) +
  (v.sale_date ? 2 : 0) +
  (v.vin ? 2 : 0) +
  (v.description ? 1 : 0);
const byMergePriority = (a, b) => (scoreVehicle(b) - scoreVehicle(a)) || (new Date(a.created_at) - new Date(b.created_at));

// Merge { primary, dup } pairs through merge_into_primary_batch; returns the dup ids that merged.
async function mergeDuplicatePairs(mergePairs) {
  const mergedDupIds = new Set();
  let mergedCount = 0, failedPairs = 0;
  const MERGE_BATCH = 100;
  // Partition mergePairs into waves so no two pairs in the same batch share a primary.id
  // (prevents sibling duplicate rows from colliding on unique indexes in a single UPDATE).
  const mergeBatches = [];
  let remainingPairs = mergePairs.slice();
  while (remainingPairs.length > 0) {
    const wave = [];
    const nextRemaining = [];
    const seenPrimary = new Set();
    for (const pair of remainingPairs) {
      if (!seenPrimary.has(pair.primary.id)) {
        seenPrimary.add(pair.primary.id);
        wave.push(pair);
      } else {
        nextRemaining.push(pair);
      }
    }
    for (let j = 0; j < wave.length; j += MERGE_BATCH) {
      mergeBatches.push(wave.slice(j, j + MERGE_BATCH));
    }
    remainingPairs = nextRemaining;
  }

  let processedPairs = 0;
  for (let bIdx = 0; bIdx < mergeBatches.length; bIdx++) {
    const chunk = mergeBatches[bIdx];
    processedPairs += chunk.length;
    try {
      const res = await client.query(
        `SELECT merge_into_primary_batch($1::uuid[], $2::uuid[]) AS r`,
        [chunk.map(c => c.primary.id), chunk.map(c => c.dup.id)]
      );
      const r = res.rows[0]?.r;
      const dupsMerged = r?.merged_dup_ids || [];
      const byDup = new Map(chunk.map(c => [c.dup.id, c]));
      for (const dId of dupsMerged) {
        mergedDupIds.add(dId);
        mergedCount++;
        const pair = byDup.get(dId);
        if (pair) {
          const { primary, dup } = pair;
          if (!primary.listing_url && dup.listing_url) primary.listing_url = dup.listing_url;
          if (!primary.discovery_url && dup.discovery_url) primary.discovery_url = dup.discovery_url;
          if (!primary.primary_image_url && dup.primary_image_url) primary.primary_image_url = dup.primary_image_url;
          if (!primary.sale_date && dup.sale_date) primary.sale_date = dup.sale_date;
        }
      }
      if ((bIdx + 1) % 10 === 0 || bIdx + 1 === mergeBatches.length) {
        console.log(`  Merged ${mergedCount.toLocaleString()}/${mergePairs.length.toLocaleString()} duplicate Mecum vehicles...`);
      }
    } catch (e) {
      failedPairs += chunk.length;
      console.log(`  Batch merge warning at batch ${bIdx} (${processedPairs}): ${e.message}`);
    }
  }
  if (failedPairs > 0) console.log(`  Unmerged pairs (failed batches): ${failedPairs.toLocaleString()}`);
  return mergedDupIds;
}

async function enrichVehicles(vehicles, lotMap, parseSaleDate) {
  // Match and batch-update
  let updated = 0, matched = 0, gpsFixed = 0, priceFixed = 0, imgFixed = 0, dateFixed = 0;
  const pendingUpdates = [];
  const usedListingUrls = new Set();
  for (const v of vehicles) {
    if (v.listing_url) usedListingUrls.add(v.listing_url);
  }

  const flushBatch = async (batch) => {
    if (batch.length === 0) return;
    await client.query(`
      WITH locked AS (
        SELECT id FROM vehicles WHERE id = ANY($1::uuid[]) FOR UPDATE SKIP LOCKED
      )
      UPDATE vehicles AS v SET
        listing_url = COALESCE(v.listing_url, CASE
          WHEN u.listing_url IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM vehicles v2 WHERE v2.listing_url = u.listing_url AND v2.deleted_at IS NULL AND v2.id <> v.id
          ) THEN u.listing_url
          ELSE NULL
        END),
        sale_date = COALESCE(v.sale_date, u.sale_date::date),
        primary_image_url = COALESCE(v.primary_image_url, u.primary_image_url),
        color = COALESCE(v.color, u.color),
        interior_color = COALESCE(v.interior_color, u.interior_color),
        transmission = COALESCE(v.transmission, u.transmission),
        body_style = COALESCE(v.body_style, u.body_style),
        engine_size = COALESCE(v.engine_size, u.engine_size),
        description = COALESCE(v.description, u.description),
        provenance_metadata = CASE
          WHEN u.prov_meta IS NOT NULL THEN COALESCE(v.provenance_metadata, '{}'::jsonb) || u.prov_meta::jsonb
          ELSE v.provenance_metadata
        END,
        gps_latitude = COALESCE(v.gps_latitude, u.gps_lat::double precision),
        gps_longitude = COALESCE(v.gps_longitude, u.gps_lng::double precision),
        listing_location = COALESCE(v.listing_location, u.listing_location),
        year = COALESCE(v.year, u.year::int),
        make = COALESCE(NULLIF(v.make, ''), u.make),
        model = COALESCE(NULLIF(v.model, ''), u.model),
        title = COALESCE(NULLIF(v.title, ''), u.title),
        listing_title = COALESCE(NULLIF(v.listing_title, ''), u.title),
        status = CASE WHEN v.status = 'pending_backfill' THEN 'active' ELSE v.status END
      FROM UNNEST(
        $1::uuid[],
        $2::text[],
        $3::text[],
        $4::text[],
        $5::text[],
        $6::text[],
        $7::text[],
        $8::text[],
        $9::text[],
        $10::text[],
        $11::text[],
        $12::double precision[],
        $13::double precision[],
        $14::text[],
        $15::int[],
        $16::text[],
        $17::text[],
        $18::text[]
      ) AS u(
        id, listing_url, sale_date, primary_image_url, color, interior_color,
        transmission, body_style, engine_size, description, prov_meta,
        gps_lat, gps_lng, listing_location, year, make, model, title
      )
      JOIN locked l ON l.id = u.id
      WHERE v.id = l.id
    `, [
      batch.map(b => b.id),
      batch.map(b => b.listing_url),
      batch.map(b => b.sale_date),
      batch.map(b => b.primary_image_url),
      batch.map(b => b.color),
      batch.map(b => b.interior_color),
      batch.map(b => b.transmission),
      batch.map(b => b.body_style),
      batch.map(b => b.engine_size),
      batch.map(b => b.description),
      batch.map(b => b.prov_meta),
      batch.map(b => b.gps_lat),
      batch.map(b => b.gps_lng),
      batch.map(b => b.listing_location),
      batch.map(b => b.year),
      batch.map(b => b.make),
      batch.map(b => b.model),
      batch.map(b => b.title),
    ]);
  };

  for (const vehicle of vehicles) {
    let lot = null;
    const rawUrl = vehicle.listing_url || vehicle.discovery_url;

    if (rawUrl) {
      const p = normLotPath(rawUrl);
      if (p) lot = lotMap.get(p);
      if (!lot && p) {
        const firstSeg = p.split('/')[0];
        if (firstSeg) lot = lotMap.get(firstSeg);
      }
    }

    if (!lot) continue;
    matched++;

    const rawCanonicalUrl = lot.permalink ? `https://www.mecum.com${lot.permalink}` : rawUrl;
    let canonicalUrl = null;
    if (!vehicle.listing_url && rawCanonicalUrl && !usedListingUrls.has(rawCanonicalUrl)) {
      canonicalUrl = rawCanonicalUrl;
      usedListingUrls.add(rawCanonicalUrl);
    }
    const saleDate = parseSaleDate(lot);
    const firstImg = lot.images_meta?.[0]?.url || null;

    const auctionRaw = lot.taxonomies?.auction_tax?.[0]?.name || '';
    const auctionName = auctionRaw ? auctionRaw.split('|')[0].trim() : null;
    const collectionRaw = lot.taxonomies?.collection_tax?.[0]?.name || '';
    const collectionName = collectionRaw ? collectionRaw.split('|')[0].replace(/&amp;/g, '&').trim() : null;
    const lotNumber = lot.lot_number_meta || null;
    const seriesSpecs = lot.lot_series_meta || null;
    const bodyStyleTax = lot.taxonomies?.body_type?.[0]?.name || null;
    const engineMatch = seriesSpecs
      ? seriesSpecs.match(/\b(\d{3,4}(?:\/\d{2,4}\s*HP)?\s*(?:CI\s*)?(?:Hemi\s*|Six\s*Pack\s*|6-BBL\s*)?(?:V-?8|V-?6|V-?12|I-?6|L88|LS6|LS5)?|\d\.\dL\s*(?:V-?8|V-?6)?)/i)
      : null;
    const engineSizeVal = engineMatch?.[1] ? engineMatch[1].trim() : null;

    let provMetaJson = null;
    const existingProv = vehicle.provenance_metadata && typeof vehicle.provenance_metadata === 'object'
      ? vehicle.provenance_metadata
      : {};
    if ((lotNumber && !existingProv.mec_lot_number) || (auctionName && !existingProv.mec_auction_name)) {
      provMetaJson = JSON.stringify({
        ...(lotNumber ? { mec_lot_number: String(lotNumber) } : {}),
        ...(auctionName ? { mec_auction_name: auctionName } : {}),
        ...(lot.web_id_meta ? { mec_web_id: String(lot.web_id_meta) } : {}),
        ...(seriesSpecs ? { mec_series: seriesSpecs } : {}),
        ...(collectionName ? { mec_collection: collectionName } : {}),
        ...(lot.low_estimate_meta ? { mec_estimate_low: Number(lot.low_estimate_meta) || null } : {}),
        ...(lot.high_estimate_meta ? { mec_estimate_high: Number(lot.high_estimate_meta) || null } : {}),
      });
    }

    let desc = null;
    if (!vehicle.description) {
      const descParts = [
        lot.post_title,
        seriesSpecs ? `Highlights: ${seriesSpecs}.` : null,
        auctionName ? `Offered at Mecum ${auctionName}${lotNumber ? ` (Lot ${lotNumber})` : ''}.` : null,
        collectionName ? `Collection: ${collectionName}.` : null,
      ].filter(Boolean);
      if (descParts.length > 1) desc = descParts.join(' ');
    }

    let gpsLat = null, gpsLng = null, city = null;
    if (!vehicle.gps_latitude) {
      const auctionTax = lot.taxonomies?.auction_tax?.[0]?.name;
      city = extractCity(auctionTax);
      if (city && CITY_GPS[city]) {
        gpsLat = CITY_GPS[city][0];
        gpsLng = CITY_GPS[city][1];
      }
    }

    const yearTax = lot.taxonomies?.lot_year?.[0]?.name;
    const parsedYear = yearTax ? parseInt(yearTax, 10) : null;
    const makeTax = lot.taxonomies?.make?.[0]?.name || null;
    const modelTax = lot.taxonomies?.model?.[0]?.name || null;
    const titleVal = lot.post_title || null;

    const needsUpdate =
      (!vehicle.listing_url && canonicalUrl) ||
      (!vehicle.sale_date && saleDate) ||
      (!vehicle.primary_image_url && firstImg) ||
      (!vehicle.color && lot.color_meta) ||
      (!vehicle.interior_color && lot.interior_meta) ||
      (!vehicle.transmission && lot.transmission_type_meta) ||
      (!vehicle.body_style && bodyStyleTax) ||
      (!vehicle.engine_size && engineSizeVal) ||
      (!vehicle.description && desc) ||
      provMetaJson !== null ||
      (!vehicle.gps_latitude && gpsLat !== null) ||
      (!vehicle.year && parsedYear) ||
      (!vehicle.make && makeTax) ||
      (!vehicle.model && modelTax) ||
      (!vehicle.title && titleVal) ||
      vehicle.status === 'pending_backfill';

    if (!needsUpdate) continue;

    if (!vehicle.sale_date && saleDate) dateFixed++;
    if (!vehicle.primary_image_url && firstImg) imgFixed++;
    if (!vehicle.gps_latitude && gpsLat !== null) gpsFixed++;

    pendingUpdates.push({
      id: vehicle.id,
      listing_url: canonicalUrl || null,
      sale_date: saleDate || null,
      primary_image_url: firstImg || null,
      color: lot.color_meta || null,
      interior_color: lot.interior_meta || null,
      transmission: lot.transmission_type_meta || null,
      body_style: bodyStyleTax,
      engine_size: engineSizeVal,
      description: desc || null,
      prov_meta: provMetaJson,
      gps_lat: gpsLat,
      gps_lng: gpsLng,
      listing_location: city || null,
      year: Number.isFinite(parsedYear) ? parsedYear : null,
      make: makeTax,
      model: modelTax,
      title: titleVal,
    });
    updated++;

    if (pendingUpdates.length >= 1000) {
      await flushBatch(pendingUpdates.splice(0, pendingUpdates.length));
      console.log(`  Updated ${updated.toLocaleString()} (img: ${imgFixed.toLocaleString()}, date: ${dateFixed.toLocaleString()}, GPS: ${gpsFixed.toLocaleString()})`);
    }
  }

  if (pendingUpdates.length > 0) {
    await flushBatch(pendingUpdates.splice(0, pendingUpdates.length));
  }

  console.log(`\n  Enrichment complete:`);
  console.log(`    Matched: ${matched.toLocaleString()}`);
  console.log(`    Updated: ${updated.toLocaleString()}`);
  console.log(`    Images fixed: ${imgFixed.toLocaleString()}`);
  console.log(`    Sale dates fixed: ${dateFixed.toLocaleString()}`);
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

  // Load URL-less Mecum vehicles or vehicles missing images/dates
  const vehicles = await loadMecumVehicles(`
    id, year, make, sale_price, sale_date, primary_image_url,
    color, interior_color, transmission, description,
    gps_latitude, listing_url, discovery_url, listing_location
  `, 'listing_url IS NULL OR primary_image_url IS NULL OR sale_date IS NULL');
  console.log(`  Vehicles missing URL/image/date: ${vehicles.length.toLocaleString()}`);

  const vehicleKey = (v) => (v.year && v.make && v.sale_price > 0)
    ? `${v.year}|${v.make.toLowerCase()}|${v.sale_price}`
    : null;
  const vehicleKeyCounts = new Map();
  for (const v of vehicles) {
    const k = vehicleKey(v);
    if (k) vehicleKeyCounts.set(k, (vehicleKeyCounts.get(k) || 0) + 1);
  }

  // A year+make+price hit is only trusted when it cannot contradict a lot the vehicle already points at:
  // the key must be unique on both sides, the vehicle's URLs must be Mecum lot URLs for the same lot (or absent),
  // and the lot URL must not already belong to another live vehicle.
  const lotUrl = (lot) => (lot.permalink ? 'https://www.mecum.com' + lot.permalink : null);
  const lotKeysOf = (lot) => new Set(
    [lotKey(lot.permalink), lot.web_id_meta ? String(lot.web_id_meta).toLowerCase() : null].filter(Boolean)
  );
  let keyHits = 0, sharedKey = 0, foreignUrl = 0, urlConflict = 0, urlOwnedElsewhere = 0;
  const candidates = [];
  for (const vehicle of vehicles) {
    const key = vehicleKey(vehicle);
    if (!key) continue;
    const lot = keyMap.get(key);
    if (!lot) continue;
    keyHits++;
    if (vehicleKeyCounts.get(key) > 1) { sharedKey++; continue; }
    const urls = [vehicle.listing_url, vehicle.discovery_url].filter(Boolean);
    if (urls.some(u => !isMecumHost(u))) { foreignUrl++; continue; }
    const ownKeys = urls.map(lotKey).filter(Boolean);
    const lotKeys = lotKeysOf(lot);
    if (ownKeys.length > 0 && !ownKeys.some(k => lotKeys.has(k))) { urlConflict++; continue; }
    candidates.push({ vehicle, lot });
  }

  const urlOwners = new Map(); // listing_url → live vehicle ids
  const urlsToCheck = [...new Set(candidates.map(c => lotUrl(c.lot)).filter(Boolean))];
  for (let i = 0; i < urlsToCheck.length; i += 1000) {
    const r = await client.query(
      `SELECT id, listing_url FROM vehicles WHERE deleted_at IS NULL AND listing_url = ANY($1::text[])`,
      [urlsToCheck.slice(i, i + 1000)]
    );
    for (const row of r.rows) {
      if (!urlOwners.has(row.listing_url)) urlOwners.set(row.listing_url, new Set());
      urlOwners.get(row.listing_url).add(row.id);
    }
  }
  const accepted = candidates.filter(({ vehicle, lot }) => {
    const owners = urlOwners.get(lotUrl(lot));
    const ownedByOther = !!owners && [...owners].some(id => id !== vehicle.id);
    if (ownedByOther) urlOwnedElsewhere++;
    return !ownedByOther;
  });

  console.log(`  Key hits: ${keyHits.toLocaleString()} — rejected: shared vehicle key ${sharedKey.toLocaleString()}, non-Mecum URL ${foreignUrl.toLocaleString()}, different lot URL ${urlConflict.toLocaleString()}, lot URL owned by another vehicle ${urlOwnedElsewhere.toLocaleString()}`);
  console.log(`  Accepted matches: ${accepted.length.toLocaleString()}${DRY_RUN ? ' (dry run, nothing written)' : ''}`);

  let matched = 0, gpsFixed = 0, urlFixed = 0, imgFixed = 0, dateFixed = 0, rowsUpdated = 0, uniqueConflicts = 0;
  for (const { vehicle, lot } of accepted) {
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

    // Add listing_url / discovery_url from permalink
    if (lot.permalink) {
      const url = 'https://www.mecum.com' + lot.permalink;
      if (!vehicle.listing_url) {
        sets.push(`listing_url = $${paramIdx}`); vals.push(url); paramIdx++;
        urlFixed++;
      }
      if (!vehicle.discovery_url) {
        sets.push(`discovery_url = $${paramIdx}`); vals.push(url); paramIdx++;
      }
    }

    // Sale date
    const runDate = lot.taxonomies?.run_date?.[0]?.name;
    const saleDate = (runDate && /^\d{4}-\d{2}-\d{2}/.test(runDate))
      ? runDate.slice(0, 10)
      : (typeof lot.auction_end_date_meta === 'number' && lot.auction_end_date_meta > 0
          ? new Date(lot.auction_end_date_meta * 1000).toISOString().slice(0, 10)
          : null);
    if (!vehicle.sale_date && saleDate) {
      sets.push(`sale_date = $${paramIdx}`); vals.push(saleDate); paramIdx++;
      dateFixed++;
    }

    // Primary image
    const firstImg = lot.images_meta?.[0]?.url || null;
    if (!vehicle.primary_image_url && firstImg) {
      sets.push(`primary_image_url = $${paramIdx}`); vals.push(firstImg); paramIdx++;
      imgFixed++;
    }

    // Color / interior / transmission
    if (!vehicle.color && lot.color_meta) {
      sets.push(`color = $${paramIdx}`); vals.push(lot.color_meta); paramIdx++;
    }
    if (!vehicle.interior_color && lot.interior_meta) {
      sets.push(`interior_color = $${paramIdx}`); vals.push(lot.interior_meta); paramIdx++;
    }
    if (!vehicle.transmission && lot.transmission_type_meta) {
      sets.push(`transmission = $${paramIdx}`); vals.push(lot.transmission_type_meta); paramIdx++;
    }

    // Description
    if (!vehicle.description) {
      const auctionRaw = lot.taxonomies?.auction_tax?.[0]?.name || '';
      const auctionName = auctionRaw ? auctionRaw.split('|')[0].trim() : null;
      const collectionRaw = lot.taxonomies?.collection_tax?.[0]?.name || '';
      const collectionName = collectionRaw ? collectionRaw.split('|')[0].replace(/&amp;/g, '&').trim() : null;
      const lotNumber = lot.lot_number_meta || null;
      const seriesSpecs = lot.lot_series_meta || null;
      const descParts = [
        lot.post_title,
        seriesSpecs ? `Highlights: ${seriesSpecs}.` : null,
        auctionName ? `Offered at Mecum ${auctionName}${lotNumber ? ` (Lot ${lotNumber})` : ''}.` : null,
        collectionName ? `Collection: ${collectionName}.` : null,
      ].filter(Boolean);
      if (descParts.length > 1) {
        sets.push(`description = $${paramIdx}`); vals.push(descParts.join(' ')); paramIdx++;
      }
    }

    if (sets.length > 0 && !DRY_RUN) {
      try {
        const r = await client.query(`UPDATE vehicles SET ${sets.join(', ')} WHERE id = $1`, vals);
        rowsUpdated += r.rowCount;
      } catch (e) {
        if (e.code !== '23505') throw e;
        uniqueConflicts++;
      }
    }

    if (matched % 500 === 0) {
      console.log(`  Matched ${matched.toLocaleString()} (updated: ${rowsUpdated}, GPS: ${gpsFixed}, URLs: ${urlFixed}, img: ${imgFixed}, date: ${dateFixed})`);
    }
  }

  console.log(`\n  Phase 3 complete${DRY_RUN ? ' (dry run)' : ''}:`);
  console.log(`    Matched: ${matched.toLocaleString()}`);
  console.log(`    Rows updated: ${rowsUpdated.toLocaleString()} (unique-index conflicts skipped: ${uniqueConflicts.toLocaleString()})`);
  console.log(`    Images fixed: ${imgFixed.toLocaleString()}`);
  console.log(`    Sale dates fixed: ${dateFixed.toLocaleString()}`);
  console.log(`    GPS fixed: ${gpsFixed.toLocaleString()}`);
  console.log(`    URLs added: ${urlFixed.toLocaleString()}`);
}

// ── Phase 4: the lot page a URL-less vehicle was discovered at is its listing ──
// Stored Mecum listing URLs are Algolia permalinks: www host, upper-case lot code, trailing slash.
const MECUM_LOT_URL = /^https?:\/\/(?:www\.)?mecum\.com\/lots\/([A-Za-z0-9-]+)\/([A-Za-z0-9-]+)\/?$/;
const canonicalLotUrl = (u) => {
  const m = u ? String(u).match(MECUM_LOT_URL) : null;
  return m ? `https://www.mecum.com/lots/${m[1].toUpperCase()}/${m[2].toLowerCase()}/` : null;
};
const lotUrlSpellings = (canon) => {
  const [, id, slug] = canon.match(MECUM_LOT_URL);
  const out = new Set();
  for (const code of [id, id.toLowerCase()]) {
    for (const host of ['https://www.mecum.com', 'https://mecum.com']) {
      out.add(`${host}/lots/${code}/${slug}/`);
      out.add(`${host}/lots/${code}/${slug}`);
    }
  }
  return [...out];
};
const MECUM_TARGETS_TAG = 'mecum-targets:1'; // extract-mecum batch_from_targets lands pending rows with this tag first

async function promoteLotUrls() {
  console.log('\n=== Phase 4: Promoting canonical Mecum lot discovery_urls to listing_url ===');
  const VEHICLE_COLS = `id, listing_url, discovery_url, year, make, sale_price, sale_status, sale_date,
    primary_image_url, image_count, vin, description IS NOT NULL AS description, user_id, created_at`;
  const urlless = await loadMecumVehicles(VEHICLE_COLS, 'listing_url IS NULL');
  const candidates = [];
  let notLotUrl = 0;
  for (const v of urlless) {
    const url = canonicalLotUrl(v.discovery_url);
    if (url) candidates.push({ v, url, key: lotKey(url) });
    else notLotUrl++;
  }
  console.log(`  URL-less live Mecum vehicles: ${urlless.length.toLocaleString()} — canonical lot discovery_url: ${candidates.length.toLocaleString()}, other: ${notLotUrl.toLocaleString()}`);

  // A lot is owned by another live vehicle when that vehicle holds any spelling of it as listing_url or
  // discovery_url, or carries the Mecum event for it.
  const ownersByKey = new Map();
  const ownerRows = new Map();
  const addOwner = (key, row) => {
    if (!ownersByKey.has(key)) ownersByKey.set(key, new Set());
    ownersByKey.get(key).add(row.id);
    ownerRows.set(row.id, row);
  };
  for (let i = 0; i < candidates.length; i += 200) {
    const chunk = candidates.slice(i, i + 200);
    const spellings = chunk.flatMap(c => lotUrlSpellings(c.url));
    const held = await client.query(`
      SELECT ${VEHICLE_COLS} FROM vehicles
      WHERE deleted_at IS NULL AND status IS DISTINCT FROM 'merged'
        AND (listing_url = ANY($1::text[]) OR discovery_url = ANY($1::text[]))`, [spellings]);
    for (const row of held.rows) {
      for (const u of [row.listing_url, row.discovery_url]) if (u && spellings.includes(u)) addOwner(lotKey(u), row);
    }
    const events = await client.query(`
      SELECT DISTINCT e.vehicle_id, e.source_url FROM vehicle_events e
      WHERE e.source_url = ANY($1::text[]) AND e.source_platform = 'mecum' AND e.vehicle_id IS NOT NULL`, [spellings]);
    const eventVehicleIds = [...new Set(events.rows.map(r => r.vehicle_id))].filter(id => !ownerRows.has(id));
    const eventOwners = eventVehicleIds.length
      ? (await client.query(`SELECT ${VEHICLE_COLS} FROM vehicles WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL AND status IS DISTINCT FROM 'merged'`, [eventVehicleIds])).rows
      : [];
    const liveById = new Map([...held.rows.map(r => [r.id, r]), ...ownerRows.entries(), ...eventOwners.map(r => [r.id, r])]);
    for (const e of events.rows) if (liveById.has(e.vehicle_id)) addOwner(lotKey(e.source_url), liveById.get(e.vehicle_id));
    await sleep(200);
  }

  const byKey = new Map();
  for (const c of candidates) {
    if (!byKey.has(c.key)) byKey.set(c.key, []);
    byKey.get(c.key).push(c);
  }
  const promote = [];
  const mergePairs = [];
  const survivorOf = new Map(); // lot key → { primary, url } when the lot's vehicles merge
  let sharedLots = 0, identityConflicts = 0, userOwnedSkipped = 0;
  for (const [key, cs] of byKey) {
    const groupIds = new Set([...cs.map(c => c.v.id), ...(ownersByKey.get(key) || [])]);
    if (groupIds.size === 1) { promote.push(cs[0]); continue; }
    sharedLots++;
    const group = [...groupIds].map(id => ownerRows.get(id) || cs.find(c => c.v.id === id).v).sort(byMergePriority);
    const primary = group[0];
    survivorOf.set(key, { primary, url: cs[0].url, dupIds: group.slice(1).map(d => d.id) });
    for (const dup of group.slice(1)) {
      const pair = JSON.stringify({ lot: key, primary: primary.id, dup: dup.id });
      const disagree = (primary.year && dup.year && primary.year !== dup.year)
        || (primary.make && dup.make && primary.make.toLowerCase() !== dup.make.toLowerCase());
      if (disagree) { identityConflicts++; console.log(`  identity conflict, not merged: ${pair}`); continue; }
      if (primary.user_id || dup.user_id) { userOwnedSkipped++; continue; } // Gate 2: never auto-merge user-owned vehicles
      mergePairs.push({ primary, dup });
      console.log(`  duplicate: ${pair}`);
    }
  }
  console.log(`  To promote: ${promote.length.toLocaleString()} — lots held by more than one live vehicle: ${sharedLots.toLocaleString()} (merge pairs ${mergePairs.length}, identity conflicts ${identityConflicts}, user-owned skipped ${userOwnedSkipped})`);

  let merged = new Set();
  if (!DRY_RUN && mergePairs.length > 0) merged = await mergeDuplicatePairs(mergePairs);
  for (const { primary, url, dupIds } of survivorOf.values()) {
    if (!DRY_RUN && !primary.listing_url && dupIds.every(id => merged.has(id))) promote.push({ v: primary, url, key: lotKey(url) });
  }

  let promoted = 0, outcomeChanged = 0;
  const promotedIds = new Set();
  const PROMOTE_BATCH = 500;
  const promoteSql = `
    WITH u AS (SELECT * FROM unnest($1::uuid[], $2::text[]) AS u(id, url)),
    before AS (SELECT v.id, v.canonical_outcome FROM vehicles v JOIN u ON u.id = v.id),
    locked AS (
      SELECT id FROM vehicles WHERE id = ANY($1::uuid[]) AND listing_url IS NULL AND deleted_at IS NULL
      FOR UPDATE SKIP LOCKED
    )
    UPDATE vehicles v SET listing_url = u.url
    FROM u JOIN locked l ON l.id = u.id JOIN before b ON b.id = u.id
    WHERE v.id = u.id
      AND NOT EXISTS (SELECT 1 FROM vehicles v2 WHERE v2.listing_url = u.url AND v2.deleted_at IS NULL AND v2.id <> v.id)
    RETURNING v.id, v.canonical_outcome IS DISTINCT FROM b.canonical_outcome AS outcome_changed`;
  if (DRY_RUN && promote.length > 0) {
    const probe = promote.slice(0, 50);
    await client.query('BEGIN');
    const r = await client.query(promoteSql, [probe.map(c => c.v.id), probe.map(c => c.url)]);
    await client.query('ROLLBACK');
    console.log(`  Dry-run probe (rolled back): ${r.rowCount}/${probe.length} rows would update, canonical_outcome changes: ${r.rows.filter(x => x.outcome_changed).length}`);
  } else {
    for (let i = 0; i < promote.length; i += PROMOTE_BATCH) {
      const chunk = promote.slice(i, i + PROMOTE_BATCH);
      const r = await client.query(promoteSql, [chunk.map(c => c.v.id), chunk.map(c => c.url)]);
      promoted += r.rowCount;
      for (const x of r.rows) promotedIds.add(x.id);
      const recomputed = r.rows.filter(x => x.outcome_changed).map(x => x.id);
      outcomeChanged += recomputed.length;
      if (recomputed.length) console.log(`  canonical_outcome recomputed by trg_resolve_canonical_columns: ${JSON.stringify(recomputed)}`);
      console.log(`  Promoted ${promoted.toLocaleString()}/${promote.length.toLocaleString()} (canonical_outcome changed: ${outcomeChanged})`);
      await sleep(2000);
    }
  }

  // Enrichment goes through extract-mecum's targets lane (batch_from_targets), never a direct crawl from here.
  const limit = ENQUEUE_LIMIT;
  let queued = 0, alreadyQueued = 0;
  const toQueue = [];
  if (limit > 0) {
    const pool = promote.filter(c => DRY_RUN || promotedIds.has(c.v.id));
    // Lots an earlier run promoted that never landed: listing_url is the canonical form of the discovery lot and the vehicle
    // carries no Mecum event yet.
    if (pool.length < limit) {
      const inPool = new Set(pool.map(c => c.v.id));
      const unlanded = await loadMecumVehicles(VEHICLE_COLS, `listing_url LIKE 'https://www.mecum.com/lots/%' AND discovery_url IS NOT NULL
        AND status IS DISTINCT FROM 'merged'
        AND NOT EXISTS (SELECT 1 FROM vehicle_events e WHERE e.vehicle_id = vehicles.id AND e.source_platform = 'mecum')`);
      let earlier = 0;
      for (const v of unlanded) {
        const url = canonicalLotUrl(v.discovery_url);
        if (!url || url !== v.listing_url || inPool.has(v.id)) continue;
        pool.push({ v, url, key: lotKey(url) });
        earlier++;
      }
      console.log(`  Promoted earlier and not landed yet: ${earlier.toLocaleString()}`);
    }
    pool.sort((a, b) => (Number(!!a.v.primary_image_url) - Number(!!b.v.primary_image_url)) || (new Date(b.v.created_at) - new Date(a.v.created_at)));
    for (let i = 0; i < pool.length && toQueue.length < limit; i += 200) {
      const chunk = pool.slice(i, i + 200);
      const q = await client.query(`SELECT listing_url FROM import_queue WHERE listing_url = ANY($1::text[])`, [chunk.flatMap(c => lotUrlSpellings(c.url))]);
      const queuedKeys = new Set(q.rows.map(r => lotKey(r.listing_url)));
      for (const c of chunk) {
        if (queuedKeys.has(c.key)) { alreadyQueued++; continue; }
        if (toQueue.length < limit) toQueue.push(c);
      }
    }
    if (!DRY_RUN && toQueue.length > 0) {
      for (let i = 0; i < toQueue.length; i += 500) {
        const chunk = toQueue.slice(i, i + 500);
        const r = await client.query(`
          INSERT INTO import_queue (listing_url, status, extractor_version, vehicle_id, raw_data)
          SELECT u.url, 'pending', $3, u.id, jsonb_build_object('reason', 'listing_url promoted from discovery_url; land lot page')
          FROM unnest($1::uuid[], $2::text[]) AS u(id, url)
          ON CONFLICT (listing_url) DO NOTHING`, [chunk.map(c => c.v.id), chunk.map(c => c.url), MECUM_TARGETS_TAG]);
        queued += r.rowCount;
        await sleep(2000);
      }
    }
  }

  console.log(`\n  Phase 4 complete${DRY_RUN ? ' (dry run)' : ''}:`);
  console.log(`    listing_url promoted: ${promoted.toLocaleString()}${DRY_RUN ? ` (would promote ${promote.length.toLocaleString()})` : ''}`);
  console.log(`    duplicates merged: ${merged.size.toLocaleString()}${DRY_RUN ? ` (would merge ${mergePairs.length})` : ''}`);
  console.log(`    queued for extract-mecum: ${queued.toLocaleString()}${DRY_RUN ? ` (would queue ${toQueue.length.toLocaleString()})` : ''}, already in import_queue: ${alreadyQueued.toLocaleString()}`);
}

async function run() {
  await client.connect();
  await client.query("SET statement_timeout = '300s'");

  if (LOT_URLS_ONLY) {
    await promoteLotUrls();
    await client.end();
    return;
  }

  if (DEDUP_ONLY || PHASE3_ONLY) {
    if (DEDUP_ONLY) {
      console.log('=== Dedup only: merging duplicate Mecum lot pairs ===');
      const vehicles = await loadMecumVehicles(`
        id, listing_url, discovery_url, sale_price, sale_status, sale_date, primary_image_url,
        image_count, vin, description IS NOT NULL AS description, user_id, created_at
      `);
      console.log(`  Mecum vehicles loaded: ${vehicles.length.toLocaleString()}`);
      await dedupMecumVehicles(vehicles);
    }
    if (PHASE3_ONLY) await enrichByYearMakePrice();
    await client.end();
    return;
  }

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
