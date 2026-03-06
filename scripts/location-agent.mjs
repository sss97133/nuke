#!/usr/bin/env node
/**
 * location-agent.mjs — Comprehensive Location Backfill Agent
 *
 * Geocodes all vehicles with text locations but no GPS coordinates.
 * Strategy: collect unique locations → geocode once → apply to all matching vehicles in bulk.
 *
 * Phases:
 * 1. Backfill bat_location → listing_location where listing_location is NULL
 * 2. Collect all unique location strings needing geocoding
 * 3. Geocode unique locations (lookup table → Nominatim → zip centroid)
 * 4. Bulk-apply GPS coordinates to all matching vehicles
 *
 * Usage:
 *   dotenvx run -- node scripts/location-agent.mjs
 *   dotenvx run -- node scripts/location-agent.mjs --dry-run
 *   dotenvx run -- node scripts/location-agent.mjs --phase 2    # skip to phase 2
 *   dotenvx run -- node scripts/location-agent.mjs --parallel 4  # parallel update workers
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const START_PHASE = parseInt(args.find(a => a.startsWith('--phase='))?.split('=')[1] || '1');
const PARALLEL = parseInt(args.find(a => a.startsWith('--parallel='))?.split('=')[1] || '3');
const NOMINATIM_DELAY_MS = 1050;
const NOMINATIM_UA = 'nuke-vehicle-platform/2.0 (data@nuke.auto)';

// ── State name → abbreviation map ──
const STATE_NAME_TO_ABBREV = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
  'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
  'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC',
};

const VALID_STATES = new Set(Object.values(STATE_NAME_TO_ABBREV));

const COUNTRY_ONLY = new Set([
  'united states', 'canada', 'europe', 'australia', 'united kingdom', 'japan',
  'germany', 'mexico', 'italy', 'france', 'sweden', 'netherlands', 'switzerland',
  'uk', 'spain', 'belgium', 'norway', 'denmark', 'new zealand', 'austria',
  'ireland', 'israel', 'south africa', 'brazil', 'finland', 'portugal',
  'czech republic', 'poland', 'romania', 'greece', 'hungary', 'qatar', 'uae',
]);

// Canadian provinces
const CANADIAN_PROVINCES = {
  'alberta': 'AB', 'british columbia': 'BC', 'manitoba': 'MB',
  'new brunswick': 'NB', 'newfoundland': 'NL', 'nova scotia': 'NS',
  'ontario': 'ON', 'prince edward island': 'PE', 'quebec': 'QC',
  'saskatchewan': 'SK',
};

// ── Location parsing ──
function parseLocationString(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length < 3) return null;
  if (COUNTRY_ONLY.has(trimmed.toLowerCase())) return null;

  // Extract zip code first
  const zipMatch = trimmed.match(/\b(\d{5}(?:-\d{4})?)\b/);
  const zip = zipMatch?.[1] || null;
  const withoutZip = zip ? trimmed.replace(zip, '').replace(/\s{2,}/g, ' ').trim() : trimmed;
  const cleaned = withoutZip.replace(/[,\s]+$/, '').trim();

  if (!cleaned || cleaned.length < 2) return null;

  // Handle "City, State" or "City, Full State Name" format
  const commaIdx = cleaned.lastIndexOf(',');
  if (commaIdx <= 0) return null;

  // Check for Canadian format: "City, Province, Canada"
  const parts = cleaned.split(',').map(s => s.trim());
  if (parts.length >= 3 && parts[parts.length - 1].toLowerCase() === 'canada') {
    const city = parts[0];
    const province = parts[1].toLowerCase();
    const provCode = CANADIAN_PROVINCES[province];
    if (provCode && city.length >= 2) {
      return { city, state: provCode, country: 'CA', zip: null, clean: `${city}, ${provCode}, Canada` };
    }
  }

  const city = cleaned.slice(0, commaIdx).trim();
  const rest = cleaned.slice(commaIdx + 1).split(',')[0].trim();

  if (!city || city.length < 2) return null;

  // Resolve state
  let state = null;
  const restUpper = rest.toUpperCase().replace(/[^A-Z]/g, '');
  if (VALID_STATES.has(restUpper)) {
    state = restUpper;
  } else {
    state = STATE_NAME_TO_ABBREV[rest.toLowerCase().trim()] || null;
  }

  if (!state) return null;
  return { city, state, country: 'US', zip, clean: zip ? `${city}, ${state} ${zip}` : `${city}, ${state}` };
}

// ── Geocoding functions ──
const geoCache = new Map(); // "city|state" → { lat, lng, source } or null

async function lookupInTable(city, state) {
  const { data } = await supabase
    .from('fb_marketplace_locations')
    .select('latitude, longitude')
    .eq('state_code', state)
    .ilike('name', `${city}%`)
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const lat = parseFloat(data.latitude);
  const lng = parseFloat(data.longitude);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  return { lat, lng, source: 'lookup_table', confidence: 0.75 };
}

async function nominatimGeocode(city, state, country = 'US') {
  const cc = country === 'CA' ? 'ca' : 'us';
  const q = encodeURIComponent(`${city}, ${state}${country === 'CA' ? ', Canada' : ''}`);
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&countrycodes=${cc}&limit=1&addressdetails=0`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': NOMINATIM_UA } });
    if (!res.ok) return null;
    const results = await res.json();
    if (!results?.length) return null;
    const lat = parseFloat(results[0].lat);
    const lng = parseFloat(results[0].lon);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    return { lat, lng, source: 'nominatim', confidence: 0.65 };
  } catch {
    return null;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Phase 1: Backfill bat_location → listing_location ──
async function phase1_backfillBatLocation() {
  console.log('\n═══ PHASE 1: Backfill bat_location → listing_location ═══');

  let lastId = '00000000-0000-0000-0000-000000000000';
  let totalBackfilled = 0;
  let totalSkipped = 0;

  while (true) {
    const { data: vehicles, error } = await supabase
      .from('vehicles')
      .select('id, bat_location')
      .not('bat_location', 'is', null)
      .is('listing_location', null)
      .is('deleted_at', null)
      .gt('id', lastId)
      .order('id', { ascending: true })
      .limit(1000);

    if (error) { console.error('Error:', error.message); break; }
    if (!vehicles || vehicles.length === 0) break;

    let batchFixed = 0;
    for (const v of vehicles) {
      const parsed = parseLocationString(v.bat_location);
      if (parsed) {
        if (!DRY_RUN) {
          await supabase.from('vehicles').update({
            listing_location: parsed.clean,
            listing_location_raw: v.bat_location,
            listing_location_source: 'bat_location_backfill',
            listing_location_confidence: 0.8,
            listing_location_observed_at: new Date().toISOString(),
            city: parsed.city,
            state: parsed.state,
            zip_code: parsed.zip,
          }).eq('id', v.id);
        }
        batchFixed++;
      } else {
        totalSkipped++;
      }
    }

    totalBackfilled += batchFixed;
    lastId = vehicles[vehicles.length - 1].id;
    if (totalBackfilled % 5000 === 0 || vehicles.length < 1000) {
      console.log(`  Backfilled: ${totalBackfilled}, skipped: ${totalSkipped}`);
    }
    await sleep(50);
    if (vehicles.length < 1000) break;
  }

  console.log(`  DONE Phase 1: ${totalBackfilled} backfilled, ${totalSkipped} skipped (country-only or unparseable)`);
  return totalBackfilled;
}

// ── Phase 2: Collect unique locations & geocode ──
async function phase2_collectAndGeocode() {
  console.log('\n═══ PHASE 2: Collect unique locations & geocode ═══');

  // Collect all unique location strings from vehicles needing GPS
  const uniqueLocations = new Map(); // "parsed_clean" → { city, state, country, zip, count }
  // Also track unique city+state for dedup (since geocoding is by city+state, not zip)
  const cityStatePairs = new Map(); // "city|state" → { city, state, country, count, locationKeys: [] }
  let lastId = '00000000-0000-0000-0000-000000000000';
  let totalScanned = 0;
  let unparseable = 0;

  console.log('  Scanning vehicles for unique locations...');

  const SCAN_BATCH = 1000; // PostgREST max_rows is 1000
  while (true) {
    const { data: vehicles, error } = await supabase
      .from('vehicles')
      .select('id, listing_location, location, bat_location')
      .is('gps_latitude', null)
      .is('deleted_at', null)
      .or('listing_location.not.is.null,location.not.is.null,bat_location.not.is.null')
      .gt('id', lastId)
      .order('id', { ascending: true })
      .limit(SCAN_BATCH);

    if (error) { console.error('Scan error:', error.message); break; }
    if (!vehicles || vehicles.length === 0) break;

    for (const v of vehicles) {
      const rawLoc = v.listing_location || v.location || v.bat_location;
      if (!rawLoc) continue;

      const parsed = parseLocationString(rawLoc);
      if (!parsed) { unparseable++; continue; }

      const locKey = parsed.clean.toLowerCase();
      const csKey = `${parsed.city.toLowerCase()}|${parsed.state}`;

      if (uniqueLocations.has(locKey)) {
        uniqueLocations.get(locKey).count++;
      } else {
        uniqueLocations.set(locKey, { ...parsed, count: 1 });
      }

      if (cityStatePairs.has(csKey)) {
        const cs = cityStatePairs.get(csKey);
        cs.count++;
        if (!cs.locationKeys.includes(locKey)) cs.locationKeys.push(locKey);
      } else {
        cityStatePairs.set(csKey, { city: parsed.city, state: parsed.state, country: parsed.country, count: 1, locationKeys: [locKey] });
      }
    }

    totalScanned += vehicles.length;
    lastId = vehicles[vehicles.length - 1].id;
    if (totalScanned % 10000 === 0) {
      console.log(`  Scanned ${totalScanned} vehicles, ${uniqueLocations.size} unique locations, ${cityStatePairs.size} unique city+state pairs`);
    }
    if (vehicles.length < SCAN_BATCH) break;
  }

  console.log(`  Scan complete: ${totalScanned} vehicles, ${uniqueLocations.size} unique locations, ${cityStatePairs.size} unique city+state pairs, ${unparseable} unparseable`);

  // Sort city+state pairs by total vehicle count (geocode most impactful first)
  const sorted = [...cityStatePairs.entries()]
    .sort((a, b) => b[1].count - a[1].count);

  console.log(`  Top 10 city+state: ${sorted.slice(0, 10).map(([k, v]) => `${k}(${v.count})`).join(', ')}`);
  console.log(`  Dedup ratio: ${uniqueLocations.size} locations → ${cityStatePairs.size} geocode calls (${((1 - cityStatePairs.size / uniqueLocations.size) * 100).toFixed(0)}% reduction)`);

  // Geocode each unique city+state pair (NOT each zip-variant location)
  let lookupHits = 0, nominatimHits = 0, failed = 0;
  let geocodedVehicleCount = 0;

  console.log(`\n  Geocoding ${sorted.length} unique city+state pairs...`);

  for (let i = 0; i < sorted.length; i++) {
    const [csKey, cs] = sorted[i];

    // Try lookup table first
    let geo = await lookupInTable(cs.city, cs.state);
    if (geo) {
      lookupHits++;
    } else {
      // Nominatim fallback
      geo = await nominatimGeocode(cs.city, cs.state, cs.country);
      if (geo) {
        nominatimHits++;
      } else {
        failed++;
        if (failed <= 20) console.log(`    MISS: "${csKey}" (${cs.count} vehicles)`);
      }
      await sleep(NOMINATIM_DELAY_MS);
    }

    if (geo) {
      // Apply geo result to ALL location keys for this city+state
      for (const locKey of cs.locationKeys) {
        geoCache.set(locKey, geo);
      }
      geocodedVehicleCount += cs.count;
    }

    if ((i + 1) % 100 === 0 || i === sorted.length - 1) {
      const pct = ((i + 1) / sorted.length * 100).toFixed(1);
      console.log(`  Progress: ${i + 1}/${sorted.length} (${pct}%) | lookup: ${lookupHits}, nominatim: ${nominatimHits}, failed: ${failed} | ~${geocodedVehicleCount} vehicles`);
    }
  }

  console.log(`\n  DONE Phase 2: ${geoCache.size} locations geocoded (${cityStatePairs.size} API calls), covering ~${geocodedVehicleCount} vehicles`);
  console.log(`    Lookup table: ${lookupHits}, Nominatim: ${nominatimHits}, Failed: ${failed}`);

  return geoCache;
}

// ── Phase 3: Bulk-apply GPS coordinates ──
async function phase3_applyCoordinates(geoCache) {
  console.log('\n═══ PHASE 3: Apply GPS coordinates to vehicles ═══');

  if (DRY_RUN) {
    console.log('  DRY RUN — skipping writes');
    return 0;
  }

  let lastId = '00000000-0000-0000-0000-000000000000';
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalProcessed = 0;

  while (true) {
    const { data: vehicles, error } = await supabase
      .from('vehicles')
      .select('id, listing_location, location, bat_location')
      .is('gps_latitude', null)
      .is('deleted_at', null)
      .or('listing_location.not.is.null,location.not.is.null,bat_location.not.is.null')
      .gt('id', lastId)
      .order('id', { ascending: true })
      .limit(500);

    if (error) { console.error('Fetch error:', error.message); break; }
    if (!vehicles || vehicles.length === 0) break;

    // Build batch of updates
    const updates = [];
    for (const v of vehicles) {
      const rawLoc = v.listing_location || v.location || v.bat_location;
      if (!rawLoc) { totalSkipped++; continue; }

      const parsed = parseLocationString(rawLoc);
      if (!parsed) { totalSkipped++; continue; }

      const key = parsed.clean.toLowerCase();
      const geo = geoCache.get(key);
      if (!geo) { totalSkipped++; continue; }

      updates.push({
        id: v.id,
        gps_latitude: geo.lat,
        gps_longitude: geo.lng,
        listing_location: v.listing_location || parsed.clean,
        listing_location_raw: v.listing_location ? undefined : rawLoc,
        listing_location_source: v.listing_location ? undefined : 'location_agent_backfill',
        listing_location_confidence: v.listing_location ? undefined : geo.confidence,
        listing_location_observed_at: v.listing_location ? undefined : new Date().toISOString(),
        city: parsed.city,
        state: parsed.state,
        zip_code: parsed.zip,
      });
    }

    // Apply updates in parallel batches
    const CHUNK = 50;
    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK);
      await Promise.all(chunk.map(u => {
        const updateFields = { gps_latitude: u.gps_latitude, gps_longitude: u.gps_longitude };
        if (!u.listing_location_raw) {
          // listing_location already exists, just update GPS + city/state
          updateFields.city = u.city;
          updateFields.state = u.state;
          if (u.zip_code) updateFields.zip_code = u.zip_code;
        } else {
          // Also backfill listing_location fields
          updateFields.listing_location = u.listing_location;
          updateFields.listing_location_raw = u.listing_location_raw;
          updateFields.listing_location_source = u.listing_location_source;
          updateFields.listing_location_confidence = u.listing_location_confidence;
          updateFields.listing_location_observed_at = u.listing_location_observed_at;
          updateFields.city = u.city;
          updateFields.state = u.state;
          if (u.zip_code) updateFields.zip_code = u.zip_code;
        }
        return supabase.from('vehicles').update(updateFields).eq('id', u.id);
      }));
    }

    totalUpdated += updates.length;
    totalProcessed += vehicles.length;
    lastId = vehicles[vehicles.length - 1].id;

    if (totalUpdated % 5000 < 500 || vehicles.length < 500) {
      console.log(`  Updated: ${totalUpdated}, skipped: ${totalSkipped}, processed: ${totalProcessed}`);
    }

    await sleep(30); // Brief pause between batches
    if (vehicles.length < 500) break;
  }

  console.log(`\n  DONE Phase 3: ${totalUpdated} vehicles updated with GPS coordinates`);
  return totalUpdated;
}

// ── Phase 4: Mecum/BJ event-based geocoding ──
async function phase4_eventGeocoding() {
  console.log('\n═══ PHASE 4: Mecum/BJ event-based geocoding ═══');

  // Mecum auction locations (from known event history)
  const MECUM_EVENTS = {
    'kissimmee': { city: 'Kissimmee', state: 'FL', lat: 28.2920, lng: -81.4076 },
    'indianapolis': { city: 'Indianapolis', state: 'IN', lat: 39.7684, lng: -86.1581 },
    'harrisburg': { city: 'Harrisburg', state: 'PA', lat: 40.2732, lng: -76.8867 },
    'dallas': { city: 'Dallas', state: 'TX', lat: 32.7767, lng: -96.7970 },
    'houston': { city: 'Houston', state: 'TX', lat: 29.7604, lng: -95.3698 },
    'kansas city': { city: 'Kansas City', state: 'MO', lat: 39.0997, lng: -94.5786 },
    'monterey': { city: 'Monterey', state: 'CA', lat: 36.6002, lng: -121.8947 },
    'denver': { city: 'Denver', state: 'CO', lat: 39.7392, lng: -104.9903 },
    'portland': { city: 'Portland', state: 'OR', lat: 45.5152, lng: -122.6784 },
    'las vegas': { city: 'Las Vegas', state: 'NV', lat: 36.1699, lng: -115.1398 },
    'glendale': { city: 'Glendale', state: 'AZ', lat: 33.5387, lng: -112.1860 },
    'chicago': { city: 'Chicago', state: 'IL', lat: 41.8781, lng: -87.6298 },
    'tulsa': { city: 'Tulsa', state: 'OK', lat: 36.1540, lng: -95.9928 },
    'louisville': { city: 'Louisville', state: 'KY', lat: 38.2527, lng: -85.7585 },
    'seattle': { city: 'Seattle', state: 'WA', lat: 47.6062, lng: -122.3321 },
  };

  // Barrett-Jackson auction locations
  const BJ_EVENTS = {
    'scottsdale': { city: 'Scottsdale', state: 'AZ', lat: 33.4942, lng: -111.9261 },
    'palm beach': { city: 'West Palm Beach', state: 'FL', lat: 26.7153, lng: -80.0534 },
    'las vegas': { city: 'Las Vegas', state: 'NV', lat: 36.1699, lng: -115.1398 },
    'houston': { city: 'Houston', state: 'TX', lat: 29.7604, lng: -95.3698 },
  };

  // For Mecum: check if listing title or other fields contain event city
  // For now, try to extract from bat_location or listing_location which may have been parsed from snapshots
  let mecumGeocoded = 0;
  let bjGeocoded = 0;

  // Check Mecum vehicles without GPS that have location text in bat_location
  const { data: mecumNoGps } = await supabase
    .from('vehicles')
    .select('id, bat_location, listing_location, location')
    .in('auction_source', ['Mecum', 'mecum'])
    .is('gps_latitude', null)
    .limit(1);

  const mecumCount = (await supabase
    .from('vehicles')
    .select('id', { count: 'exact', head: true })
    .in('auction_source', ['Mecum', 'mecum'])
    .is('gps_latitude', null)
  ).count || 0;

  console.log(`  Mecum vehicles without GPS: ${mecumCount}`);
  console.log(`  Barrett-Jackson vehicles without GPS: (checking...)`);

  const bjCount = (await supabase
    .from('vehicles')
    .select('id', { count: 'exact', head: true })
    .in('auction_source', ['barrett-jackson', 'Barrett-Jackson'])
    .is('gps_latitude', null)
  ).count || 0;

  console.log(`  Barrett-Jackson vehicles without GPS: ${bjCount}`);
  console.log(`  Event-based geocoding requires snapshot location extraction (future phase)`);

  return { mecumGeocoded, bjGeocoded };
}

// ── Main ──
async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║        LOCATION AGENT v1.0               ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`  Starting phase: ${START_PHASE}`);
  console.log(`  Parallel updates: ${PARALLEL}`);

  const startTime = Date.now();

  // Pre-check
  const { count: noGpsCount } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact', head: true })
    .is('gps_latitude', null)
    .not('deleted_at', 'not.is', null);

  const { count: hasGpsCount } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact', head: true })
    .not('gps_latitude', 'is', null);

  console.log(`\n  Current state: ${hasGpsCount?.toLocaleString()} with GPS, ${noGpsCount?.toLocaleString()} without`);

  if (START_PHASE <= 1) await phase1_backfillBatLocation();
  const geocodeResults = await phase2_collectAndGeocode();
  const totalUpdated = await phase3_applyCoordinates(geocodeResults);
  if (START_PHASE <= 4) await phase4_eventGeocoding();

  // Final stats
  const { count: finalGpsCount } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact', head: true })
    .not('gps_latitude', 'is', null);

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║              FINAL REPORT                ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  Before: ${hasGpsCount?.toLocaleString()} vehicles with GPS`);
  console.log(`  After:  ${finalGpsCount?.toLocaleString()} vehicles with GPS`);
  console.log(`  Added:  ${((finalGpsCount || 0) - (hasGpsCount || 0)).toLocaleString()} new GPS coordinates`);
  console.log(`  Elapsed: ${elapsed} minutes`);
}

main().catch(e => { console.error(e); process.exit(1); });
