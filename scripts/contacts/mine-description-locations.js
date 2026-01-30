#!/usr/bin/env node
/**
 * Mine Vehicle Descriptions for Locations
 *
 * Extracts location data from stored vehicle descriptions
 * No web scraping needed - uses existing database content
 *
 * Usage: dotenvx run -- node scripts/contacts/mine-description-locations.js [limit]
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LIMIT = parseInt(process.argv[2]) || 1000;

const STATE_NAMES = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA',
  'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE', 'florida': 'FL', 'georgia': 'GA',
  'hawaii': 'HI', 'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA',
  'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS', 'missouri': 'MO',
  'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH',
  'oklahoma': 'OK', 'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT', 'vermont': 'VT',
  'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY'
};

const stateNamesPattern = Object.keys(STATE_NAMES).join('|');

// Patterns that reliably indicate location
const PATTERNS = [
  // "title in California" - very reliable
  new RegExp(`title in the seller.*?\\bin (${stateNamesPattern})\\b`, 'i'),
  new RegExp(`title in (${stateNamesPattern})\\b`, 'i'),

  // "offered ... in California"
  new RegExp(`offered (?:at no reserve |by the seller |by the selling dealer )?(?:with .+ )?in (${stateNamesPattern})\\b`, 'i'),

  // "in City, State" - city capture
  new RegExp(`in ([A-Z][a-z]+(?:\\s[A-Z][a-z]+)?),\\s*(${stateNamesPattern})\\b`, 'i'),

  // "located in City, State"
  new RegExp(`located in ([A-Z][a-z]+(?:\\s[A-Z][a-z]+)?),?\\s*(${stateNamesPattern})\\b`, 'i'),
];

// Skip patterns that look like false positives
const SKIP_PATTERNS = [
  /new exhaust/i, /in new/i, /in late/i, /in early/i, /in preparation/i,
  /in storage/i, /in service/i, /restored by/i, /rebuilt by/i,
  /in addition/i, /in the/i, /in place/i, /in working/i,
];

function extractLocation(description) {
  if (!description) return null;

  // Check for skip patterns first
  for (const skip of SKIP_PATTERNS) {
    if (skip.test(description.substring(0, 100))) continue;
  }

  for (const pattern of PATTERNS) {
    const match = description.match(pattern);
    if (match) {
      // Get state
      let state = null;
      let city = null;

      // Find which group is the state
      for (let i = 1; i < match.length; i++) {
        const val = match[i];
        if (!val) continue;
        const valLower = val.toLowerCase();
        if (STATE_NAMES[valLower]) {
          state = STATE_NAMES[valLower];
        } else if (val.length > 2 && /^[A-Z][a-z]/.test(val)) {
          // Looks like a city name
          city = val;
        }
      }

      if (state) {
        // Skip false positives
        if (city && ['new', 'late', 'early', 'preparation'].includes(city.toLowerCase())) {
          continue;
        }
        return { city: city || null, state, country: 'USA' };
      }
    }
  }

  return null;
}

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

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  MINE DESCRIPTIONS FOR LOCATIONS                             ║');
  console.log(`║  Processing up to ${LIMIT} vehicles                               ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  let extracted = 0, skipped = 0;
  let offset = 0;

  while (offset < LIMIT) {
    const batchSize = Math.min(500, LIMIT - offset);

    // Get vehicles without city that have descriptions
    const vehicles = await fetchJSON(
      `${SUPABASE_URL}/rest/v1/vehicles?city=is.null&description=not.is.null&select=id,description&offset=${offset}&limit=${batchSize}`
    );

    if (!vehicles.length) {
      console.log('\nNo more vehicles to process');
      break;
    }

    console.log(`\nProcessing batch at offset ${offset}...`);

    for (const vehicle of vehicles) {
      const location = extractLocation(vehicle.description);

      if (location) {
        // Update vehicle
        await fetchJSON(`${SUPABASE_URL}/rest/v1/vehicles?id=eq.${vehicle.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            city: location.city,
            state: location.state,
            country: location.country
          })
        });

        extracted++;
        if (extracted <= 30 || extracted % 100 === 0) {
          const loc = location.city ? `${location.city}, ${location.state}` : location.state;
          console.log(`  ✓ ${loc}`);
        }
      } else {
        skipped++;
      }
    }

    offset += batchSize;
  }

  console.log(`\n════════════════════════════════════════`);
  console.log(`COMPLETE`);
  console.log(`  Locations extracted: ${extracted}`);
  console.log(`  No location found: ${skipped}`);
  console.log(`  Hit rate: ${(extracted / (extracted + skipped) * 100).toFixed(1)}%`);
  console.log(`════════════════════════════════════════`);
}

main().catch(console.error);
