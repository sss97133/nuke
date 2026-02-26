#!/usr/bin/env node
/**
 * geocode-backfill.mjs
 *
 * Backfills gps_latitude/gps_longitude for vehicles that have location text
 * but no coordinates. Runs locally (no edge function timeout).
 *
 * Strategy:
 * 1. Parse location string → city + state
 * 2. Lookup in fb_marketplace_locations (fast, no rate limit)
 * 3. Nominatim fallback at 1 req/sec (free, no key)
 *
 * Usage:
 *   dotenvx run -- node scripts/geocode-backfill.mjs
 *   dotenvx run -- node scripts/geocode-backfill.mjs --batch-size 500 --dry-run
 *   dotenvx run -- node scripts/geocode-backfill.mjs --start-offset 5000
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const BATCH_SIZE = parseInt(args.find(a => a.startsWith('--batch-size='))?.split('=')[1] || '500');
const START_OFFSET = parseInt(args.find(a => a.startsWith('--start-offset='))?.split('=')[1] || '0');
const NOMINATIM_DELAY_MS = 1150;
const NOMINATIM_UA = 'nuke-geocoder/1.0 (contact@nuke.com)';

// --- Location parser (mirrors _shared/parseLocation.ts) ---

const VALID_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]);

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

const CITY_STATE_OVERRIDES = {
  'phoenix': 'AZ', 'tucson': 'AZ', 'scottsdale': 'AZ', 'mesa': 'AZ',
  'tempe': 'AZ', 'chandler': 'AZ', 'gilbert': 'AZ', 'flagstaff': 'AZ', 'sedona': 'AZ',
  'las vegas': 'NV', 'henderson': 'NV', 'reno': 'NV', 'carson city': 'NV',
};

function parseLocation(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Extract zip code first
  const zipMatch = trimmed.match(/\b(\d{5}(?:-\d{4})?)\b/);
  const zip = zipMatch?.[1] || null;
  const withoutZip = zip ? trimmed.replace(zip, '').replace(/\s{2,}/g, ' ').trim() : trimmed;

  // Remove trailing separators
  const cleaned = withoutZip.replace(/[,\s]+$/, '').trim();
  if (!cleaned || cleaned.length < 2) return null;

  const commaIdx = cleaned.indexOf(',');
  if (commaIdx <= 0) return null;

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

  // Override for known collision cities
  const cityLower = city.toLowerCase();
  if (CITY_STATE_OVERRIDES[cityLower]) {
    state = CITY_STATE_OVERRIDES[cityLower];
  }

  if (!state) return null;
  return { city, state, zip, clean: zip ? `${city}, ${state} ${zip}` : `${city}, ${state}` };
}

// --- Geocoding ---

const geoCache = new Map(); // "city|state" → geo result or null

async function geocode(city, state) {
  const key = `${city.toLowerCase()}|${state}`;
  if (geoCache.has(key)) return geoCache.get(key);

  // Pass 1: lookup table (fast, no rate limit)
  let geo = await lookupInTable(city, state);

  // Pass 2: Nominatim fallback
  if (!geo) {
    geo = await nominatimGeocode(city, state);
    await sleep(NOMINATIM_DELAY_MS);
  }

  geoCache.set(key, geo); // cache null too (avoid re-querying dead locations)
  return geo;
}

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
  return { latitude: lat, longitude: lng, source: 'lookup_table', confidence: 0.75 };
}

async function nominatimGeocode(city, state) {
  const q = encodeURIComponent(`${city}, ${state}, USA`);
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&countrycodes=us&limit=1&addressdetails=0`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': NOMINATIM_UA } });
    if (!res.ok) return null;
    const results = await res.json();
    if (!results?.length) return null;
    const lat = parseFloat(results[0].lat);
    const lng = parseFloat(results[0].lon);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    return { latitude: lat, longitude: lng, source: 'nominatim', confidence: 0.65 };
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// --- Main ---

async function main() {
  console.log(`\n🌍 Geocode Backfill`);
  console.log(`   dry_run: ${DRY_RUN}, batch_size: ${BATCH_SIZE}, start_offset: ${START_OFFSET}`);
  console.log(`   Fetching vehicles...\n`);

  const stats = { total: 0, lookup_hit: 0, nominatim_hit: 0, skipped: 0, failed: 0 };
  let lastId = START_OFFSET === 0 ? '00000000-0000-0000-0000-000000000000' : null;
  let processedTotal = 0;

  // If START_OFFSET is a numeric offset, find the ID to start from
  if (START_OFFSET > 0 && !lastId) {
    const { data: anchor } = await supabase
      .from('vehicles')
      .select('id')
      .or('listing_location.not.is.null,location.not.is.null')
      .is('gps_latitude', null)
      .order('id', { ascending: true })
      .limit(1)
      .range(START_OFFSET, START_OFFSET);
    lastId = anchor?.[0]?.id || '00000000-0000-0000-0000-000000000000';
  }

  while (true) {
    const { data: vehicles, error } = await supabase
      .from('vehicles')
      .select('id, listing_location, location')
      .or('listing_location.not.is.null,location.not.is.null')
      .is('gps_latitude', null)
      .gt('id', lastId)
      .order('id', { ascending: true })
      .limit(BATCH_SIZE);

    if (error) { console.error('Fetch error:', error.message); break; }
    if (!vehicles || vehicles.length === 0) { console.log('✅ No more vehicles to geocode.'); break; }

    console.log(`Batch processed=${processedTotal}: ${vehicles.length} vehicles`);

    for (const v of vehicles) {
      const rawLoc = v.listing_location || v.location;
      const parsed = parseLocation(rawLoc);

      if (!parsed) {
        stats.skipped++;
        continue;
      }

      stats.total++;

      const cacheKey = `${parsed.city.toLowerCase()}|${parsed.state}`;
      const wasCached = geoCache.has(cacheKey);
      const geo = await geocode(parsed.city, parsed.state);

      if (!wasCached && geo) {
        if (geo.source === 'lookup_table') stats.lookup_hit++;
        else stats.nominatim_hit++;
      }

      if (!geo) {
        stats.failed++;
        continue;
      }

      if (!DRY_RUN) {
        const updates = {
          gps_latitude: geo.latitude,
          gps_longitude: geo.longitude,
        };
        // Also backfill listing_location_* if only legacy location column was set
        if (!v.listing_location && parsed.clean) {
          updates.listing_location = parsed.clean;
          updates.listing_location_raw = rawLoc;
          updates.listing_location_source = 'geocode_backfill';
          updates.listing_location_confidence = geo.confidence;
          updates.listing_location_observed_at = new Date().toISOString();
        }

        await supabase.from('vehicles').update(updates).eq('id', v.id);

        await supabase.from('vehicle_location_observations').upsert({
          vehicle_id: v.id,
          source_type: 'geocoded',
          source_platform: geo.source,
          observed_at: new Date().toISOString(),
          location_text_raw: rawLoc,
          location_text_clean: parsed.clean,
          city: parsed.city,
          region_code: parsed.state,
          postal_code: parsed.zip,
          latitude: geo.latitude,
          longitude: geo.longitude,
          precision: 'city',
          confidence: geo.confidence,
          metadata: { geocode_source: geo.source },
        }, { onConflict: 'vehicle_id,source_type,source_platform' });
      }
    }

    const pct = stats.total > 0
      ? ((stats.lookup_hit + stats.nominatim_hit) / stats.total * 100).toFixed(1)
      : '0';
    console.log(`  → geocoded: ${stats.lookup_hit + stats.nominatim_hit} (${pct}%), lookup: ${stats.lookup_hit}, nominatim: ${stats.nominatim_hit}, cache_size: ${geoCache.size}, skipped: ${stats.skipped}, failed: ${stats.failed}`);

    lastId = vehicles[vehicles.length - 1].id;
    processedTotal += vehicles.length;
    if (vehicles.length < BATCH_SIZE) break;
  }

  console.log(`\n📊 Final stats:`);
  console.log(`   Total processed: ${stats.total}`);
  console.log(`   Lookup table hits: ${stats.lookup_hit}`);
  console.log(`   Nominatim hits: ${stats.nominatim_hit}`);
  console.log(`   Skipped (no city/state): ${stats.skipped}`);
  console.log(`   Failed (no geo result): ${stats.failed}`);
  console.log(`   Success rate: ${stats.total > 0 ? ((stats.lookup_hit + stats.nominatim_hit) / stats.total * 100).toFixed(1) : 0}%`);
}

main().catch(console.error);
