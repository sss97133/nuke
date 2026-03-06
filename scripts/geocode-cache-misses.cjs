#!/usr/bin/env node
/**
 * geocode-cache-misses.cjs
 *
 * One-time script: geocodes the ~1,471 location strings not in geocoding_cache
 * via Nominatim, caches the results. After this, the cache-based cron handles everything.
 *
 * Architecture:
 *   geocoding_cache (26K entries, instant) → Nominatim (cache misses only, 1/sec)
 *
 * This eliminates the Nominatim bottleneck permanently. Future vehicles
 * hit the cache first; Nominatim is only needed for genuinely new locations.
 */

const pg = require('pg');
const client = new pg.Client({
  connectionString: 'postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
  statement_timeout: 55000,
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function geocodeNominatim(location) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'NukeVehiclePlatform/1.0 (geocoding backfill)' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.length === 0) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), display: data[0].display_name };
  } catch { return null; }
}

function parseLocation(loc) {
  // Try to extract city/state from location string
  const parts = loc.split(',').map(s => s.trim());
  if (parts.length >= 2) {
    return { city: parts[0], state: parts[parts.length - 1] };
  }
  return { city: loc, state: null };
}

async function run() {
  await client.connect();

  // Get uncached locations
  const result = await client.query(`
    SELECT DISTINCT v.listing_location
    FROM vehicles v
    LEFT JOIN geocoding_cache gc ON v.listing_location = gc.location_string
    WHERE v.deleted_at IS NULL AND v.gps_latitude IS NULL
      AND v.listing_location IS NOT NULL AND v.listing_location != ''
      AND gc.location_string IS NULL
    ORDER BY v.listing_location
  `);

  console.log(`Uncached locations to geocode: ${result.rows.length}`);

  let geocoded = 0, failed = 0, cached = 0;

  for (const row of result.rows) {
    const loc = row.listing_location;
    const gps = await geocodeNominatim(loc);

    if (gps) {
      const parsed = parseLocation(loc);
      await client.query(`
        INSERT INTO geocoding_cache (location_string, latitude, longitude, city, state, source)
        VALUES ($1, $2, $3, $4, $5, 'nominatim')
        ON CONFLICT (location_string) DO NOTHING
      `, [loc, gps.lat, gps.lng, parsed.city, parsed.state]);
      geocoded++;
      cached++;
    } else {
      failed++;
    }

    const total = geocoded + failed;
    if (total % 50 === 0) {
      console.log(`  ${total}/${result.rows.length} — ${geocoded} geocoded, ${failed} failed`);
    }

    // Nominatim rate limit: 1 req/sec
    await sleep(1100);
  }

  console.log(`\nDone: ${geocoded} geocoded and cached, ${failed} failed`);
  console.log(`Cache now has ${(await client.query('SELECT COUNT(*)::int as c FROM geocoding_cache')).rows[0].c} entries`);

  // Now apply the newly cached coords
  const applied = await client.query('SELECT geocode_from_cache_batch(5000)');
  console.log(`Applied ${applied.rows[0].geocode_from_cache_batch} vehicles from new cache entries`);

  await client.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
