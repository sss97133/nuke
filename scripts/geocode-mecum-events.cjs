#!/usr/bin/env node
/**
 * geocode-mecum-events.cjs
 *
 * Phase 1: Scan Mecum snapshots to extract auction cities from meta descriptions.
 * Phase 2: Build url→city map and update vehicles in batches.
 * Phase 3: Barrett-Jackson URL slug mapping.
 *
 * Uses batch processing to avoid statement timeouts.
 */

const pg = require('pg');
const client = new pg.Client({
  connectionString: 'postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
  statement_timeout: 55000, // 55 second timeout
});

// Build GPS lookup with both abbreviation and full state name variants
const CITY_DATA = [
  { city: 'Kissimmee', state: 'FL', stateFull: 'Florida', lat: 28.2920, lng: -81.4076 },
  { city: 'Indianapolis', state: 'IN', stateFull: 'Indiana', lat: 39.7684, lng: -86.1581 },
  { city: 'Harrisburg', state: 'PA', stateFull: 'Pennsylvania', lat: 40.2732, lng: -76.8867 },
  { city: 'Dallas', state: 'TX', stateFull: 'Texas', lat: 32.7767, lng: -96.7970 },
  { city: 'Houston', state: 'TX', stateFull: 'Texas', lat: 29.7604, lng: -95.3698 },
  { city: 'Kansas City', state: 'MO', stateFull: 'Missouri', lat: 39.0997, lng: -94.5786 },
  { city: 'Monterey', state: 'CA', stateFull: 'California', lat: 36.6002, lng: -121.8947 },
  { city: 'Denver', state: 'CO', stateFull: 'Colorado', lat: 39.7392, lng: -104.9903 },
  { city: 'Portland', state: 'OR', stateFull: 'Oregon', lat: 45.5152, lng: -122.6784 },
  { city: 'Las Vegas', state: 'NV', stateFull: 'Nevada', lat: 36.1699, lng: -115.1398 },
  { city: 'Glendale', state: 'AZ', stateFull: 'Arizona', lat: 33.5387, lng: -112.1860 },
  { city: 'Chicago', state: 'IL', stateFull: 'Illinois', lat: 41.8781, lng: -87.6298 },
  { city: 'Tulsa', state: 'OK', stateFull: 'Oklahoma', lat: 36.1540, lng: -95.9928 },
  { city: 'Louisville', state: 'KY', stateFull: 'Kentucky', lat: 38.2527, lng: -85.7585 },
  { city: 'Seattle', state: 'WA', stateFull: 'Washington', lat: 47.6062, lng: -122.3321 },
  { city: 'Davenport', state: 'IA', stateFull: 'Iowa', lat: 41.5236, lng: -90.5776 },
  { city: 'Schaumburg', state: 'IL', stateFull: 'Illinois', lat: 42.0334, lng: -88.0834 },
  { city: 'Chattanooga', state: 'TN', stateFull: 'Tennessee', lat: 35.0456, lng: -85.3097 },
  { city: 'Austin', state: 'TX', stateFull: 'Texas', lat: 30.2672, lng: -97.7431 },
  { city: 'Walworth', state: 'WI', stateFull: 'Wisconsin', lat: 42.5311, lng: -88.5984 },
  { city: 'Osceola', state: 'WI', stateFull: 'Wisconsin', lat: 45.3205, lng: -92.6999 },
  { city: 'Baxter', state: 'MN', stateFull: 'Minnesota', lat: 46.3430, lng: -94.2866 },
  { city: 'Bloomington', state: 'IL', stateFull: 'Illinois', lat: 40.4842, lng: -88.9937 },
  { city: 'Belvidere', state: 'IL', stateFull: 'Illinois', lat: 42.2639, lng: -88.8443 },
  { city: 'Scottsdale', state: 'AZ', stateFull: 'Arizona', lat: 33.4942, lng: -111.9261 },
  { city: 'Palm Beach', state: 'FL', stateFull: 'Florida', lat: 26.7153, lng: -80.0534 },
  { city: 'West Palm Beach', state: 'FL', stateFull: 'Florida', lat: 26.7153, lng: -80.0534 },
  { city: 'Fort Lauderdale', state: 'FL', stateFull: 'Florida', lat: 26.1224, lng: -80.1373 },
  { city: 'Anamosa', state: 'IA', stateFull: 'Iowa', lat: 42.1083, lng: -91.2854 },
  { city: 'East Moline', state: 'IL', stateFull: 'Illinois', lat: 41.5072, lng: -90.4424 },
  { city: 'Orlando', state: 'FL', stateFull: 'Florida', lat: 28.5383, lng: -81.3792 },
  { city: 'Jefferson', state: 'NC', stateFull: 'North Carolina', lat: 36.4204, lng: -81.4734 },
  { city: 'Punta Gorda', state: 'FL', stateFull: 'Florida', lat: 26.9298, lng: -82.0454 },
  { city: 'Frankfort', state: 'IL', stateFull: 'Illinois', lat: 41.4953, lng: -87.8486 },
  { city: 'Franklin', state: 'TN', stateFull: 'Tennessee', lat: 35.9251, lng: -86.8689 },
  { city: 'Pecatonica', state: 'IL', stateFull: 'Illinois', lat: 42.3133, lng: -89.3584 },
  { city: 'Solomon', state: 'KS', stateFull: 'Kansas', lat: 38.9197, lng: -97.3714 },
  { city: 'Elkhorn', state: 'WI', stateFull: 'Wisconsin', lat: 42.6728, lng: -88.5443 },
];

// Build lookup map with both "city, st" and "city, full state" variants
const CITY_GPS = {};
for (const c of CITY_DATA) {
  const entry = { lat: c.lat, lng: c.lng, city: c.city, state: c.state };
  CITY_GPS[`${c.city.toLowerCase()}, ${c.state.toLowerCase()}`] = entry;
  CITY_GPS[`${c.city.toLowerCase()}, ${c.stateFull.toLowerCase()}`] = entry;
}

async function run() {
  await client.connect();

  // === PHASE 1: Scan Mecum snapshots in batches ===
  console.log('=== Phase 1: Scan Mecum snapshots for auction cities ===');

  // Build map of listing_url → city from snapshots
  const urlCityMap = new Map(); // listing_url → "City, ST"
  let lastUrl = '';
  let scanned = 0;
  const newCities = new Map();

  while (true) {
    const result = await client.query(`
      SELECT listing_url,
        SUBSTRING(html FROM 'content="View [^"]*in ([^"]{3,40}) as [A-Z]') as auction_city
      FROM listing_page_snapshots
      WHERE platform = 'mecum' AND success = true AND html IS NOT NULL
        AND listing_url > $1
      ORDER BY listing_url
      LIMIT 500
    `, [lastUrl]);

    if (result.rows.length === 0) break;

    for (const row of result.rows) {
      if (row.auction_city) {
        const city = row.auction_city.trim();
        // Filter out junk regex matches (partial title captures)
        if (city.includes('for sale at') || city.includes('in ,') || city.length < 4 || !city.includes(',')) {
          continue;
        }
        urlCityMap.set(row.listing_url, city);
        const cityKey = city.toLowerCase();
        if (!CITY_GPS[cityKey]) {
          newCities.set(cityKey, (newCities.get(cityKey) || 0) + 1);
        }
      }
    }

    scanned += result.rows.length;
    lastUrl = result.rows[result.rows.length - 1].listing_url;
    if (scanned % 5000 === 0) {
      console.log(`  Scanned ${scanned} snapshots, ${urlCityMap.size} with city`);
    }
    if (result.rows.length < 500) break;
  }

  console.log(`  Scan complete: ${scanned} snapshots, ${urlCityMap.size} with city data`);

  if (newCities.size > 0) {
    console.log('  Unknown cities (need GPS coords):');
    for (const [city, count] of [...newCities.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    "${city}" — ${count} snapshots`);
    }
  }

  // === PHASE 2: Update Mecum vehicles in batches ===
  console.log('\n=== Phase 2: Update Mecum vehicles ===');

  let totalUpdated = 0;
  let totalNoSnapshot = 0;
  let totalNoCity = 0;
  let lastId = '00000000-0000-0000-0000-000000000000';

  while (true) {
    const result = await client.query(`
      SELECT id, listing_url FROM vehicles
      WHERE auction_source IN ('Mecum', 'mecum')
        AND gps_latitude IS NULL AND deleted_at IS NULL
        AND id > $1
      ORDER BY id LIMIT 1000
    `, [lastId]);

    if (result.rows.length === 0) break;

    for (const row of result.rows) {
      const url = row.listing_url;
      if (!url) { totalNoSnapshot++; continue; }

      // Try exact match and trailing slash variants
      const cityStr = urlCityMap.get(url)
        || urlCityMap.get(url + '/')
        || urlCityMap.get(url.replace(/\/$/, ''));

      if (!cityStr) { totalNoCity++; continue; }

      const cityKey = cityStr.toLowerCase().trim();
      const gps = CITY_GPS[cityKey];
      if (!gps) continue;

      await client.query(`
        UPDATE vehicles SET
          gps_latitude = $1, gps_longitude = $2,
          listing_location = $3, listing_location_source = 'mecum_event',
          listing_location_confidence = 0.9, listing_location_observed_at = NOW(),
          city = $4, state = $5
        WHERE id = $6 AND gps_latitude IS NULL
      `, [gps.lat, gps.lng, cityStr, gps.city, gps.state, row.id]);
      totalUpdated++;
    }

    lastId = result.rows[result.rows.length - 1].id;
    if (totalUpdated % 2000 < 1000 || result.rows.length < 1000) {
      console.log(`  Updated: ${totalUpdated}, no_snapshot: ${totalNoSnapshot}, no_city: ${totalNoCity}`);
    }
    await client.query('SELECT pg_sleep(0.05)');
    if (result.rows.length < 1000) break;
  }

  console.log(`\nMecum DONE: ${totalUpdated} geocoded`);

  // === PHASE 3: Barrett-Jackson URL slug mapping ===
  console.log('\n=== Phase 3: Barrett-Jackson event geocoding ===');

  const BJ_SLUGS = [
    { slug: 'scottsdale', ...CITY_GPS['scottsdale, az'] },
    { slug: 'palm-beach', ...CITY_GPS['palm beach, fl'] },
    { slug: 'las-vegas', ...CITY_GPS['las vegas, nv'] },
    { slug: 'houston', ...CITY_GPS['houston, tx'] },
  ];

  let bjTotal = 0;
  for (const event of BJ_SLUGS) {
    // Batch update in chunks to avoid statement timeout
    let affected = 0;
    while (true) {
      const r = await client.query(`
        UPDATE vehicles SET
          gps_latitude = $1, gps_longitude = $2,
          listing_location = $3, listing_location_source = 'bj_event',
          listing_location_confidence = 0.85, listing_location_observed_at = NOW(),
          city = $4, state = $5
        WHERE id IN (
          SELECT id FROM vehicles
          WHERE auction_source IN ('barrett-jackson', 'Barrett-Jackson')
            AND gps_latitude IS NULL AND deleted_at IS NULL
            AND listing_url ILIKE $6
          LIMIT 2000
        )
      `, [event.lat, event.lng, `${event.city}, ${event.state}`, event.city, event.state, `%${event.slug}%`]);

      affected += r.rowCount;
      if (r.rowCount === 0) break;
      await client.query('SELECT pg_sleep(0.05)');
    }
    console.log(`  ${event.slug}: ${affected} updated`);
    bjTotal += affected;
  }

  console.log(`\nBarrett-Jackson DONE: ${bjTotal} geocoded`);

  // Final stats
  const finalResult = await client.query(
    `SELECT COUNT(CASE WHEN gps_latitude IS NOT NULL THEN 1 END)::int as has_gps FROM vehicles WHERE deleted_at IS NULL`
  );
  console.log(`\nTotal vehicles with GPS now: ${finalResult.rows[0].has_gps}`);

  await client.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
