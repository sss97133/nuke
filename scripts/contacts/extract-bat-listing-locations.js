#!/usr/bin/env node
/**
 * Extract BaT Listing Locations
 *
 * Scrapes BaT listing pages to extract seller location
 * and updates vehicles and external_identities
 *
 * Usage: dotenvx run -- node scripts/contacts/extract-bat-listing-locations.js [limit]
 */

import { chromium } from 'playwright';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LIMIT = parseInt(process.argv[2]) || 50;

async function getListingsWithoutLocation() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/auction_events?seller_location=is.null&source_url=not.is.null&select=id,source_url,seller_name,vehicle_id&limit=${LIMIT}`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    }
  );
  return res.json();
}

async function updateEventLocation(eventId, location) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/auction_events?id=eq.${eventId}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ seller_location: location })
  });
  return res.ok;
}

async function updateVehicleLocation(vehicleId, city, state) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/vehicles?id=eq.${vehicleId}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ city, state, country: 'USA' })
  });
  return res.ok;
}

async function updateIdentityLocation(handle, city, state) {
  // Find the identity
  const findRes = await fetch(
    `${SUPABASE_URL}/rest/v1/external_identities?platform=eq.bat&handle=eq.${encodeURIComponent(handle)}&select=id,metadata`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    }
  );
  const identities = await findRes.json();

  if (!identities.length) return false;

  const identity = identities[0];
  const newMetadata = {
    ...identity.metadata,
    city,
    state,
    country: 'USA',
    location_source: 'bat_listing',
    location_updated_at: new Date().toISOString()
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/external_identities?id=eq.${identity.id}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ metadata: newMetadata })
  });
  return res.ok;
}

// Known city → correct state corrections
const ARIZONA_CITIES = new Set(['phoenix','tucson','scottsdale','mesa','tempe','chandler','glendale','gilbert','peoria','surprise','yuma','avondale','flagstaff','goodyear','lake havasu city','buckeye','casa grande','sierra vista','maricopa','oro valley','prescott','apache junction','bullhead city','sedona']);
const NEVADA_CITIES = new Set(['las vegas','henderson','reno','north las vegas','sparks','carson city','boulder city','willow beach','mesquite','elko','fernley','laughlin']);
const NEW_JERSEY_CITIES = new Set(['wyckoff','demarest','moonachie','englewood','hackensack','paramus','ridgewood','teaneck','fair lawn','bergenfield','cliffside park','fort lee','hoboken','jersey city','newark','elizabeth','paterson','trenton','atlantic city','princeton','cherry hill','jamestown']);
const BAD_PATTERNS = ['leather','cloth','interior','gray','black','tan','lounge','bidding','trim','paint','engine','wheel','gallery','below','white with','red with','blue with','following','listing','addition to','california since','depth history'];

function normalizeLocation(city, state) {
  if (!city || !state) return null;

  city = city.trim();
  state = state.trim().toUpperCase();
  const cityLower = city.toLowerCase();

  // Check for bad patterns
  for (const pattern of BAD_PATTERNS) {
    if (cityLower.includes(pattern)) return null;
  }

  // Fix known miscoded states
  if (ARIZONA_CITIES.has(cityLower) && (state === 'AR' || state === 'AZ')) {
    state = 'AZ';
  } else if (NEVADA_CITIES.has(cityLower) && (state === 'NE' || state === 'NV')) {
    state = 'NV';
  } else if (NEW_JERSEY_CITIES.has(cityLower) && (state === 'NE' || state === 'NJ')) {
    state = 'NJ';
  }

  // Capitalize city properly
  city = city.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

  return { city, state };
}

async function extractLocation(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);

    const location = await page.evaluate(() => {
      // US state abbreviations (case-insensitive matching)
      const states = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'];
      const statePattern = states.join('|');

      const text = document.body.innerText;
      const lines = text.split('\n');

      for (const line of lines) {
        // Match "City, ST" where ST is a valid state abbreviation (case-insensitive)
        const match = line.match(new RegExp(`^\\s*([A-Z][a-zA-Z\\s]+),\\s*(${statePattern})\\s*$`, 'i'));
        if (match) {
          return { city: match[1].trim(), state: match[2].toUpperCase() };
        }

        // Match "Location: City, ST"
        const locMatch = line.match(new RegExp(`Location[:\\s]+([A-Z][a-zA-Z\\s]+),\\s*(${statePattern})`, 'i'));
        if (locMatch) {
          return { city: locMatch[1].trim(), state: locMatch[2].toUpperCase() };
        }
      }

      // Fallback: look for "in City, State" near start of description
      const inMatch = text.substring(0, 2000).match(new RegExp(`(?:located in|offered in|selling in|in)\\s+([A-Z][a-zA-Z\\s]+),\\s*(${statePattern})\\b`, 'i'));
      if (inMatch) {
        return { city: inMatch[1].trim(), state: inMatch[2].toUpperCase() };
      }

      return null;
    });

    // Normalize and validate
    if (location) {
      return normalizeLocation(location.city, location.state);
    }
    return null;

  } catch (e) {
    return null;
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  BAT LISTING LOCATION EXTRACTION                             ║');
  console.log(`║  Processing up to ${LIMIT} listings                               ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });
  const page = await context.newPage();

  let extracted = 0, errors = 0;

  try {
    const listings = await getListingsWithoutLocation();
    console.log(`Found ${listings.length} listings to process\n`);

    for (const listing of listings) {
      const location = await extractLocation(page, listing.source_url);

      if (location) {
        // Update auction_event
        await updateEventLocation(listing.id, `${location.city}, ${location.state}`);

        // Update vehicle
        if (listing.vehicle_id) {
          await updateVehicleLocation(listing.vehicle_id, location.city, location.state);
        }

        // Update seller identity
        if (listing.seller_name) {
          await updateIdentityLocation(listing.seller_name, location.city, location.state);
        }

        extracted++;
        console.log(`  ✓ ${listing.seller_name || 'Unknown'} → ${location.city}, ${location.state}`);
      } else {
        errors++;
      }

      // Rate limit
      await page.waitForTimeout(1500);
    }

    console.log(`\n════════════════════════════════════════`);
    console.log(`COMPLETE`);
    console.log(`  Locations extracted: ${extracted}`);
    console.log(`  Not found: ${errors}`);
    console.log(`════════════════════════════════════════`);

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
