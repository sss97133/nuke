#!/usr/bin/env node
/**
 * bonhams-auction-geocode.cjs
 *
 * Maps Bonhams auction IDs to GPS coordinates by:
 * 1. Fetching each auction page to get JSON-LD location data
 * 2. Saving auction→location mapping to local cache
 * 3. Updating vehicles with GPS coordinates
 *
 * Usage: dotenvx run -- node scripts/bonhams-auction-geocode.cjs
 *        dotenvx run -- node scripts/bonhams-auction-geocode.cjs --enrich-only
 */

const pg = require('pg');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const CACHE_FILE = path.join(DATA_DIR, 'bonhams-auction-locations.json');
const args = process.argv.slice(2);
const ENRICH_ONLY = args.includes('--enrich-only');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const client = new pg.Client({
  connectionString: 'postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
  statement_timeout: 55000,
});

// Known Bonhams auction cities → GPS
const CITY_GPS = {
  'scottsdale': [33.4942, -111.9261],
  'arizona': [33.4942, -111.9261],
  'phoenix': [33.4484, -112.0740],
  'greenwich': [41.0262, -73.6282],
  'monterey': [36.6002, -121.8947],
  'carmel': [36.5554, -121.9233],
  'quail lodge': [36.5554, -121.9233],
  'amelia island': [30.6357, -81.4626],
  'paris': [48.8566, 2.3522],
  'london': [51.5074, -0.1278],
  'monaco': [43.7384, 7.4246],
  'monte carlo': [43.7384, 7.4246],
  'monte-carlo': [43.7384, 7.4246],
  'san francisco': [37.7749, -122.4194],
  'los angeles': [34.0522, -118.2437],
  'new york': [40.7128, -74.0060],
  'new york city': [40.7128, -74.0060],
  'philadelphia': [39.9526, -75.1652],
  'detroit': [42.3314, -83.0458],
  'chicago': [41.8781, -87.6298],
  'fort lauderdale': [26.1224, -80.1373],
  'miami': [25.7617, -80.1918],
  'las vegas': [36.1699, -115.1398],
  'pebble beach': [36.5725, -121.9486],
  'goodwood': [50.8610, -0.7560],
  'oxford': [51.7520, -1.2577],
  'brussels': [50.8503, 4.3517],
  'zurich': [47.3769, 8.5417],
  'geneva': [46.2044, 6.1432],
  'hong kong': [22.3193, 114.1694],
  'tokyo': [35.6762, 139.6503],
  'sydney': [33.8688, 151.2093],
  'hendon': [51.5894, -0.2287],  // RAF Museum
  'beaulieu': [50.8663, -1.4531], // National Motor Museum
  'chichester': [50.8365, -0.7792],
  'stuttgart': [48.7758, 9.1829],
  'knokke': [51.3546, 3.2895],
  'palm beach': [26.7056, -80.0364],
  'spa': [50.4871, 5.8664],
  'gstaad': [46.4747, 7.2872],
  'padua': [45.4064, 11.8768],
  'newport': [41.4901, -71.3128],
  'hartford': [41.7658, -72.6734],
  'hershey': [40.2856, -76.6497],
  'blenheim palace': [51.8414, -1.3614],
  'bonhams': [51.5074, -0.1278], // Default London HQ
  'san diego': [32.7157, -117.1611],
  'dallas': [32.7767, -96.7970],
  'houston': [29.7604, -95.3698],
  'auburn': [41.3698, -85.0588],
  'owls head': [44.0817, -69.0609],
  'battersea': [51.4750, -0.1500], // London
  'chelsea': [51.4875, -0.1687],   // London
  'knightsbridge': [51.5010, -0.1607], // London
  'mayfair': [51.5098, -0.1472], // London
  // UK regional
  'stafford': [52.8063, -2.1174],
  'guildford': [51.2362, -0.5704],
  'harrogate': [53.9921, -1.5418],
  'bicester': [51.8992, -1.1505],
  'market harborough': [52.4778, -0.9205],
  'edinburgh': [55.9533, -3.1883],
  'silverstone': [52.0739, -1.0147],
  'kenilworth': [52.3469, -1.5801],
  'weybridge': [51.3714, -0.4571],
  'gaydon': [52.1871, -1.4834],
  'henley': [51.5355, -0.9030],
  'peterborough': [52.5695, -0.2405],
  'bath': [51.3811, -2.3590],
  'birmingham': [52.4862, -1.8904],
  'burton': [52.8023, -1.6378],
  // US regional
  'fernandina beach': [30.6697, -81.4626], // Amelia Island area
  'brookline': [42.3317, -71.1212],
  'middletown': [41.5126, -71.2817],
  'portland': [45.5152, -122.6784],
  'seattle': [47.6062, -122.3321],
  'darien': [41.0787, -73.4700],
  'boston': [42.3601, -71.0589],
  // European regional
  'chantilly': [49.1946, 2.4628],
  'chéserex': [46.3883, 6.1400],
  'reims': [49.2583, 3.5167],
  'dubai': [25.2048, 55.2708],
  'melbourne': [-37.8136, 144.9631],
  'armadale': [-37.8559, 145.0192],
};

function matchCity(locationStr) {
  if (!locationStr) return null;
  const lower = locationStr.toLowerCase();

  // Try exact known cities first
  for (const [city, gps] of Object.entries(CITY_GPS)) {
    if (lower.includes(city)) {
      return { city, gps };
    }
  }
  return null;
}

// Fetch auction page and extract location from JSON-LD
async function fetchAuctionLocation(auctionId) {
  try {
    const url = `https://www.bonhams.com/auction/${auctionId}/`;
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
    });

    if (!res.ok) return null;

    const html = await res.text();

    // Extract JSON-LD
    const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
    if (jsonLdMatch) {
      try {
        const ld = JSON.parse(jsonLdMatch[1]);
        const location = ld.location;
        if (location) {
          const name = location.name || '';
          const address = location.address;
          let addressStr = '';
          if (typeof address === 'string') addressStr = address;
          else if (address) addressStr = [address.addressLocality, address.addressRegion, address.addressCountry].filter(Boolean).join(', ');

          return {
            name: ld.name || '',
            location: name,
            address: addressStr,
            raw: `${name} ${addressStr}`.trim(),
          };
        }
      } catch (e) { /* parse error */ }
    }

    // Fallback: try to extract from title or meta
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) {
      return { name: titleMatch[1], location: '', address: '', raw: titleMatch[1] };
    }

    return null;
  } catch (e) {
    return null;
  }
}

async function run() {
  await client.connect();

  // Load or build auction location cache
  let auctionLocations = {};
  if (fs.existsSync(CACHE_FILE)) {
    auctionLocations = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    console.log(`Loaded ${Object.keys(auctionLocations).length} cached auction locations`);
  }

  if (!ENRICH_ONLY) {
    // Get all unique auction IDs
    const result = await client.query(`
      SELECT DISTINCT (regexp_match(listing_url, '/auction/(\\d+)/'))[1] as auction_id,
             COUNT(*)::int as lot_count
      FROM vehicles
      WHERE auction_source = 'bonhams' AND deleted_at IS NULL AND listing_url IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC
    `);

    const auctionIds = result.rows.filter(r => r.auction_id && !auctionLocations[r.auction_id]);
    console.log(`Total auction IDs: ${result.rows.length}, need to fetch: ${auctionIds.length}`);

    let fetched = 0, errors = 0;
    for (const row of auctionIds) {
      const loc = await fetchAuctionLocation(row.auction_id);
      if (loc) {
        auctionLocations[row.auction_id] = loc;
        fetched++;
      } else {
        errors++;
      }

      if ((fetched + errors) % 20 === 0) {
        console.log(`  Fetched ${fetched}, errors ${errors} / ${auctionIds.length} — saving...`);
        fs.writeFileSync(CACHE_FILE, JSON.stringify(auctionLocations, null, 2));
      }

      await sleep(500); // Polite delay
    }

    fs.writeFileSync(CACHE_FILE, JSON.stringify(auctionLocations, null, 2));
    console.log(`Fetch complete: ${fetched} locations, ${errors} errors`);
  }

  // Phase 2: Geocode from cached locations
  console.log('\n=== Geocoding Bonhams vehicles from auction locations ===');

  // Build auction_id → GPS map
  const auctionGPS = {};
  let mappedCount = 0, unmappedCount = 0;
  const unmappedLocations = new Set();

  for (const [auctionId, loc] of Object.entries(auctionLocations)) {
    const match = matchCity(loc.raw) || matchCity(loc.location) || matchCity(loc.address) || matchCity(loc.name);
    if (match) {
      auctionGPS[auctionId] = { gps: match.gps, city: match.city };
      mappedCount++;
    } else {
      unmappedCount++;
      if (loc.raw) unmappedLocations.add(loc.raw.substring(0, 80));
    }
  }

  console.log(`  Mapped: ${mappedCount}, Unmapped: ${unmappedCount}`);
  if (unmappedLocations.size > 0 && unmappedLocations.size <= 30) {
    console.log('  Unmapped locations:');
    for (const loc of unmappedLocations) {
      console.log(`    - ${loc}`);
    }
  }

  // Update vehicles
  let updated = 0;
  const batchSize = 500;
  let offset = 0;

  while (true) {
    const r = await client.query(`
      SELECT id, listing_url
      FROM vehicles
      WHERE auction_source = 'bonhams' AND deleted_at IS NULL
        AND gps_latitude IS NULL AND listing_url IS NOT NULL
      ORDER BY id LIMIT $1 OFFSET $2
    `, [batchSize, offset]);

    if (r.rows.length === 0) break;

    for (const vehicle of r.rows) {
      const aidMatch = vehicle.listing_url.match(/\/auction\/(\d+)\//);
      if (!aidMatch) continue;

      const gpsInfo = auctionGPS[aidMatch[1]];
      if (!gpsInfo) continue;

      await client.query(
        `UPDATE vehicles SET gps_latitude = $2, gps_longitude = $3, listing_location = COALESCE(listing_location, $4) WHERE id = $1`,
        [vehicle.id, gpsInfo.gps[0], gpsInfo.gps[1], gpsInfo.city]
      );
      updated++;
    }

    offset += batchSize;
    if (updated > 0 && updated % 1000 === 0) {
      console.log(`  Updated ${updated} vehicles`);
    }
  }

  console.log(`\n  Geocoded ${updated} Bonhams vehicles`);

  // Final stats
  const stats = await client.query(`
    SELECT COUNT(*)::int as total,
           COUNT(CASE WHEN gps_latitude IS NOT NULL THEN 1 END)::int as gps
    FROM vehicles WHERE auction_source = 'bonhams' AND deleted_at IS NULL
  `);
  const s = stats.rows[0];
  console.log(`  Bonhams GPS: ${s.gps}/${s.total} (${(s.gps/s.total*100).toFixed(1)}%)`);

  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
