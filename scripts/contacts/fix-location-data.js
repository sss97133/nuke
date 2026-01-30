#!/usr/bin/env node
/**
 * Fix Location Data
 *
 * 1. Removes invalid locations (not matching "City, ST" pattern)
 * 2. Normalizes state abbreviations to uppercase
 * 3. Fixes known city→state corrections (Phoenix=AZ, Boulder City=NV, etc.)
 *
 * Usage: dotenvx run -- node scripts/contacts/fix-location-data.js
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VALID_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'
]);

// Known city → correct state mappings for Arizona (often miscoded as AR)
const ARIZONA_CITIES = new Set([
  'phoenix', 'tucson', 'scottsdale', 'mesa', 'tempe', 'chandler', 'glendale',
  'gilbert', 'peoria', 'surprise', 'yuma', 'avondale', 'flagstaff', 'goodyear',
  'lake havasu city', 'buckeye', 'casa grande', 'sierra vista', 'maricopa',
  'oro valley', 'prescott', 'apache junction', 'bullhead city', 'sedona'
]);

// Known city → correct state mappings for Nevada (often miscoded as NE)
const NEVADA_CITIES = new Set([
  'las vegas', 'henderson', 'reno', 'north las vegas', 'sparks', 'carson city',
  'boulder city', 'willow beach', 'mesquite', 'elko', 'fernley', 'laughlin'
]);

// Known city → correct state mappings for New Jersey (often miscoded as NE)
const NEW_JERSEY_CITIES = new Set([
  'wyckoff', 'demarest', 'moonachie', 'englewood', 'hackensack', 'paramus',
  'ridgewood', 'teaneck', 'fair lawn', 'bergenfield', 'cliffside park',
  'fort lee', 'hoboken', 'jersey city', 'newark', 'elizabeth', 'paterson',
  'trenton', 'atlantic city', 'princeton', 'cherry hill'
]);

// Bad patterns that indicate it's not a real location
const BAD_PATTERNS = [
  'leather', 'cloth', 'interior', 'gray', 'black', 'tan', 'lounge',
  'bidding', 'trim', 'paint', 'engine', 'wheel', 'gallery', 'below',
  'white with', 'red with', 'blue with', 'the following', 'listing',
  'addition to', 'california since', 'depth history'
];

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  if (options.method === 'PATCH') return res.ok;
  return res.json();
}

function fixLocation(location) {
  if (!location || typeof location !== 'string') return null;

  // Check for bad patterns
  const lowerLoc = location.toLowerCase();
  for (const pattern of BAD_PATTERNS) {
    if (lowerLoc.includes(pattern)) return null;
  }

  // Parse "City, ST" format
  const parts = location.split(',').map(s => s.trim());
  if (parts.length !== 2) return null;

  let [city, state] = parts;
  state = state.toUpperCase();

  // Skip if city is too short or too long
  if (city.length < 2 || city.length > 35) return null;

  // Fix known miscoded states based on city
  const cityLower = city.toLowerCase();

  if (ARIZONA_CITIES.has(cityLower) && (state === 'AR' || state === 'AZ')) {
    state = 'AZ';
  } else if (NEVADA_CITIES.has(cityLower) && (state === 'NE' || state === 'NV')) {
    state = 'NV';
  } else if (NEW_JERSEY_CITIES.has(cityLower) && (state === 'NE' || state === 'NJ')) {
    state = 'NJ';
  }

  // Validate final state
  if (!VALID_STATES.has(state)) return null;

  // Capitalize city properly
  city = city.split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

  return `${city}, ${state}`;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  FIX LOCATION DATA                                           ║');
  console.log('║  Cleaning and normalizing seller_location values             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  let fixed = 0, cleared = 0, unchanged = 0;
  let offset = 0;

  while (true) {
    const events = await fetchJSON(
      `${SUPABASE_URL}/rest/v1/auction_events?seller_location=not.is.null&select=id,seller_location&offset=${offset}&limit=200`
    );

    if (!events.length) {
      console.log('\nNo more events to process');
      break;
    }

    console.log(`\nProcessing batch at offset ${offset}...`);

    for (const event of events) {
      const original = event.seller_location;
      const corrected = fixLocation(original);

      if (corrected === null) {
        // Clear invalid location
        await fetchJSON(`${SUPABASE_URL}/rest/v1/auction_events?id=eq.${event.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ seller_location: null })
        });
        cleared++;
        console.log(`  ✗ Cleared: "${original}"`);
      } else if (corrected !== original) {
        // Update with corrected location
        await fetchJSON(`${SUPABASE_URL}/rest/v1/auction_events?id=eq.${event.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ seller_location: corrected })
        });
        fixed++;
        console.log(`  ✓ Fixed: "${original}" → "${corrected}"`);
      } else {
        unchanged++;
      }

      await new Promise(r => setTimeout(r, 30));
    }

    offset += 200;
    if (offset > 5000) {
      console.log('\nReached safety limit');
      break;
    }
  }

  console.log(`\n════════════════════════════════════════`);
  console.log(`COMPLETE`);
  console.log(`  Fixed: ${fixed}`);
  console.log(`  Cleared: ${cleared}`);
  console.log(`  Unchanged: ${unchanged}`);
  console.log(`════════════════════════════════════════`);
}

main().catch(console.error);
