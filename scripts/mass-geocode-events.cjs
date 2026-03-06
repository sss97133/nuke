#!/usr/bin/env node
/**
 * mass-geocode-events.cjs
 *
 * Geocodes vehicles using auction_events data — no external API calls needed.
 * All GPS coordinates are hardcoded from known auction venues.
 *
 * Phase 1: Barrett-Jackson via source_url city slugs (~58K vehicles)
 * Phase 2: Mecum via source_url city slugs (~1K vehicles)
 * Phase 3: Seller_location from auction_events → vehicles (~5.8K)
 *
 * Uses batched updates to avoid statement timeouts.
 */

const pg = require('pg');
const client = new pg.Client({
  connectionString: 'postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
  statement_timeout: 55000,
});

// Barrett-Jackson event venue GPS coordinates
const BJ_EVENTS = [
  // Major recurring events
  { slugs: ['scottsdale'], city: 'Scottsdale', state: 'AZ', lat: 33.4942, lng: -111.9261 },
  { slugs: ['palm-beach', 'palmbeach'], city: 'West Palm Beach', state: 'FL', lat: 26.7153, lng: -80.0534 },
  { slugs: ['las-vegas', 'lasvegas'], city: 'Las Vegas', state: 'NV', lat: 36.1699, lng: -115.1398 },
  { slugs: ['houston'], city: 'Houston', state: 'TX', lat: 29.7604, lng: -95.3698 },
  // Discovered from "unknown" bucket
  { slugs: ['northeast'], city: 'Uncasville', state: 'CT', lat: 41.4345, lng: -72.1071 }, // Mohegan Sun
  { slugs: ['reno'], city: 'Reno', state: 'NV', lat: 39.5296, lng: -119.8138 },
  { slugs: ['orange-county'], city: 'Orange', state: 'CA', lat: 33.7879, lng: -117.8531 }, // OC Fair & Event Center
  { slugs: ['new-orleans'], city: 'New Orleans', state: 'LA', lat: 29.9511, lng: -90.0715 },
  { slugs: ['petersen-museum'], city: 'Los Angeles', state: 'CA', lat: 34.0622, lng: -118.3614 }, // Petersen Museum
];

// Mecum event venue GPS coordinates
const MECUM_EVENTS = [
  { slugs: ['kissimmee'], city: 'Kissimmee', state: 'FL', lat: 28.2920, lng: -81.4076 },
  { slugs: ['indianapolis', 'indy'], city: 'Indianapolis', state: 'IN', lat: 39.7684, lng: -86.1581 },
  { slugs: ['harrisburg'], city: 'Harrisburg', state: 'PA', lat: 40.2732, lng: -76.8867 },
  { slugs: ['dallas'], city: 'Dallas', state: 'TX', lat: 32.7767, lng: -96.7970 },
  { slugs: ['houston'], city: 'Houston', state: 'TX', lat: 29.7604, lng: -95.3698 },
  { slugs: ['kansas'], city: 'Kansas City', state: 'MO', lat: 39.0997, lng: -94.5786 },
  { slugs: ['monterey'], city: 'Monterey', state: 'CA', lat: 36.6002, lng: -121.8947 },
  { slugs: ['denver'], city: 'Denver', state: 'CO', lat: 39.7392, lng: -104.9903 },
  { slugs: ['portland'], city: 'Portland', state: 'OR', lat: 45.5152, lng: -122.6784 },
  { slugs: ['vegas', 'las-vegas'], city: 'Las Vegas', state: 'NV', lat: 36.1699, lng: -115.1398 },
  { slugs: ['glendale'], city: 'Glendale', state: 'AZ', lat: 33.5387, lng: -112.1860 },
  { slugs: ['chicago', 'schaumburg'], city: 'Chicago', state: 'IL', lat: 41.8781, lng: -87.6298 },
  { slugs: ['tulsa'], city: 'Tulsa', state: 'OK', lat: 36.1540, lng: -95.9928 },
  { slugs: ['louisville'], city: 'Louisville', state: 'KY', lat: 38.2527, lng: -85.7585 },
  { slugs: ['seattle'], city: 'Seattle', state: 'WA', lat: 47.6062, lng: -122.3321 },
  { slugs: ['austin'], city: 'Austin', state: 'TX', lat: 30.2672, lng: -97.7431 },
  { slugs: ['scottsdale'], city: 'Scottsdale', state: 'AZ', lat: 33.4942, lng: -111.9261 },
  { slugs: ['chattanooga'], city: 'Chattanooga', state: 'TN', lat: 35.0456, lng: -85.3097 },
  { slugs: ['davenport'], city: 'Davenport', state: 'IA', lat: 41.5236, lng: -90.5776 },
  { slugs: ['bloomington'], city: 'Bloomington', state: 'IL', lat: 40.4842, lng: -88.9937 },
];

async function geocodeBySlug(platform, events, sourceFilter) {
  let grandTotal = 0;

  for (const event of events) {
    // Build ILIKE conditions for all slugs
    const slugConditions = event.slugs.map(s => `ae.source_url ILIKE '%${s}%'`).join(' OR ');

    let affected = 0;
    while (true) {
      const r = await client.query(`
        UPDATE vehicles SET
          gps_latitude = $1, gps_longitude = $2,
          listing_location = $3, listing_location_source = '${platform}_event',
          listing_location_confidence = 0.85, listing_location_observed_at = NOW(),
          city = $4, state = $5
        WHERE id IN (
          SELECT v.id FROM vehicles v
          JOIN auction_events ae ON ae.vehicle_id = v.id
          WHERE v.auction_source IN (${sourceFilter})
            AND v.gps_latitude IS NULL AND v.deleted_at IS NULL
            AND (${slugConditions})
          LIMIT 2000
        )
      `, [event.lat, event.lng, `${event.city}, ${event.state}`, event.city, event.state]);

      affected += r.rowCount;
      if (r.rowCount === 0) break;
      await client.query('SELECT pg_sleep(0.05)');
    }

    if (affected > 0) {
      console.log(`  ${event.slugs[0]}: ${affected} updated`);
    }
    grandTotal += affected;
  }

  return grandTotal;
}

async function geocodeFromSellerLocation() {
  console.log('\n=== Phase 3: Seller location from auction_events ===');

  // Get unique seller_locations that map to known cities
  // We'll use a simplified approach — parse "City, ST" patterns
  let lastId = '00000000-0000-0000-0000-000000000000';
  let updated = 0;
  let processed = 0;

  while (true) {
    const result = await client.query(`
      SELECT DISTINCT ON (v.id) v.id, ae.seller_location
      FROM vehicles v
      JOIN auction_events ae ON ae.vehicle_id = v.id
      WHERE v.gps_latitude IS NULL AND v.deleted_at IS NULL
        AND ae.seller_location IS NOT NULL
        AND ae.seller_location != ''
        AND v.id > $1
      ORDER BY v.id, ae.created_at DESC
      LIMIT 500
    `, [lastId]);

    if (result.rows.length === 0) break;
    processed += result.rows.length;

    // Copy seller_location to listing_location for later geocoding by the location-agent
    const updates = [];
    for (const row of result.rows) {
      const loc = row.seller_location.trim();
      if (loc.length < 3) continue;
      updates.push({ id: row.id, location: loc });
    }

    // Batch update listing_location so the location-agent can geocode these
    for (const u of updates) {
      await client.query(`
        UPDATE vehicles SET
          listing_location = $1,
          listing_location_source = 'auction_event_seller'
        WHERE id = $2 AND listing_location IS NULL
      `, [u.location, u.id]);
      updated++;
    }

    lastId = result.rows[result.rows.length - 1].id;
    if (processed % 2000 === 0) {
      console.log(`  Processed ${processed}, updated listing_location for ${updated}`);
    }
    await client.query('SELECT pg_sleep(0.05)');
    if (result.rows.length < 500) break;
  }

  return updated;
}

async function run() {
  await client.connect();

  // Get before stats
  const before = await client.query(
    `SELECT COUNT(CASE WHEN gps_latitude IS NOT NULL THEN 1 END)::int as has_gps FROM vehicles WHERE deleted_at IS NULL`
  );
  console.log(`GPS coverage before: ${before.rows[0].has_gps}`);

  // === Phase 1: Barrett-Jackson ===
  console.log('\n=== Phase 1: Barrett-Jackson event geocoding ===');
  const bjTotal = await geocodeBySlug('bj', BJ_EVENTS, `'barrett-jackson', 'Barrett-Jackson'`);
  console.log(`Barrett-Jackson DONE: ${bjTotal} geocoded`);

  // === Phase 2: Mecum ===
  console.log('\n=== Phase 2: Mecum event geocoding ===');
  const mecumTotal = await geocodeBySlug('mecum', MECUM_EVENTS, `'mecum', 'Mecum'`);
  console.log(`Mecum DONE: ${mecumTotal} geocoded`);

  // === Phase 3: Seller location backfill ===
  const sellerTotal = await geocodeFromSellerLocation();
  console.log(`Seller location backfill: ${sellerTotal} listing_locations set`);

  // Final stats
  const after = await client.query(
    `SELECT COUNT(CASE WHEN gps_latitude IS NOT NULL THEN 1 END)::int as has_gps FROM vehicles WHERE deleted_at IS NULL`
  );
  console.log(`\n========================================`);
  console.log(`GPS coverage before: ${before.rows[0].has_gps}`);
  console.log(`GPS coverage after:  ${after.rows[0].has_gps}`);
  console.log(`NEW GPS coordinates: ${after.rows[0].has_gps - before.rows[0].has_gps}`);
  console.log(`========================================`);

  await client.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
