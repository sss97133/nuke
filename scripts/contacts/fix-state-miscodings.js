#!/usr/bin/env node
/**
 * Fix State Miscodings
 *
 * The retry script matched state codes incorrectly for many cities.
 * This fixes known city→state mappings.
 *
 * Usage: dotenvx run -- node scripts/contacts/fix-state-miscodings.js
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// City → correct state mappings (lowercase city → correct state code)
const CITY_STATE_FIXES = {
  // New York cities incorrectly coded as NE
  'roslyn heights': 'NY',
  'southampton': 'NY',
  'new lebanon center': 'NY',
  'port washington': 'NY',
  'east moriches': 'NY',
  'clifton park': 'NY',
  'philmont': 'NY',
  'highland': 'NY',
  'woodstock': 'NY',
  'north salem': 'NY',
  'hudson': 'NY',
  'wappingers falls': 'NY',
  'jamestown': 'NY',
  'angola': 'NY',
  'plainview': 'NY',
  'brooklyn': 'NY',
  'new hyde park': 'NY',
  'malone': 'NY',
  'syracuse': 'NY',
  'saint james': 'NY',
  'rochester': 'NY',
  'newburgh': 'NY',
  'mount kisco': 'NY',
  'larchmont': 'NY',
  'ithaca college': 'NY',
  'bloomingburg': 'NY',
  'east elmhurst': 'NY',
  'williamsville': 'NY',
  'medford': 'NY', // Long Island
  'port washington': 'NY',
  'woodside': 'NY',
  'patchogue': 'NY',
  'islip': 'NY',
  'new york': 'NY',
  'north las vegas': 'NV',
  'buffalo': 'NY',

  // New Jersey cities incorrectly coded as NE
  'englewood cliffs': 'NJ',
  'millburn': 'NJ',
  'basking ridge': 'NJ',
  'lumberton township': 'NJ',
  'verona': 'NJ',
  'whitehouse': 'NJ',
  'neptune': 'NJ',
  'lebanon': 'NJ',
  'parsippany': 'NJ',
  'allenhurst': 'NJ',
  'asbury park': 'NJ',
  'ramsey': 'NJ',
  'jackson township': 'NJ',
  'chester': 'NJ',
  'bridgewater': 'NJ',
  'rutherford': 'NJ',
  'morristown': 'NJ',
  'edgewater': 'NJ',
  'brick': 'NJ',
  'toms river': 'NJ',
  'plainfield': 'NJ',
  'merchantville': 'NJ',
  'manchester': 'NJ',
  'hasbrouck heights': 'NJ',

  // New Hampshire
  'nashua': 'NH',
  'exeter': 'NH',

  // New Mexico cities incorrectly coded as NE
  'albuquerque': 'NM',
  'santa fe': 'NM',
  'los alamos': 'NM',

  // Minnesota cities incorrectly coded as MI
  'minneapolis': 'MN',
  'minnetonka': 'MN',
  'inver grove heights': 'MN',
  'stillwater': 'MN',
  'cologne': 'MN',
  'scandia': 'MN',

  // Missouri cities incorrectly coded as MI
  'kansas city': 'MO',
  'saint louis': 'MO',

  // Arizona cities incorrectly coded as AR
  'sun city': 'AZ',
  'san tan valley': 'AZ',

  // International cities that should be removed
  'auckland': null, // New Zealand
  'renkum': null, // Netherlands
  'winnipeg': null, // Canada
  'surrey': null, // Canada/UK
  'spruce grove': null, // Canada

  // Other common miscodings
  'bay saint louis': 'MS',
  'murphy': 'NC',
  'beulah': 'ND',
  'westwood': 'MA',
  'potomac': 'MD',
  'new britain': 'CT',
  'damariscotta': 'ME',
  'snow hill': 'MD',
  'finksburg': 'MD',
  'bennington': 'VT',

  // Nebraska cities that are actually correct (don't change)
  // 'ponca': 'NE', // actual NE city
  // 'fremont': 'NE', // actual NE city
  // 'minden': 'NE', // actual NE city
  // 'schuyler': 'NE', // actual NE city
  // 'bennet': 'NE', // actual NE city
  // 'linden': 'NE', // could be NE
  // 'raymond': 'NE', // actual NE city
  // 'watertown': 'NE', // could be SD/WI/NY
  // 'stockton': 'NE', // could be CA
  // 'farmington': 'NE', // could be many states
  // 'belvidere': 'NE', // actual NE city
};

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
  console.log('║  FIX STATE MISCODINGS                                        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Get all auction_events with locations (paginated)
  let allEvents = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const events = await fetchJSON(
      `${SUPABASE_URL}/rest/v1/auction_events?seller_location=not.is.null&select=id,seller_name,seller_location&offset=${offset}&limit=${limit}`
    );
    if (!events.length) break;
    allEvents = allEvents.concat(events);
    offset += limit;
    if (events.length < limit) break;
  }

  console.log(`Found ${allEvents.length} events with locations\n`);
  const events = allEvents;

  let fixed = 0, removed = 0, skipped = 0;

  for (const event of events) {
    const loc = event.seller_location;
    const match = loc.match(/^([^,]+),\s*([A-Z]{2})$/);
    if (!match) {
      skipped++;
      continue;
    }

    const [, city, state] = match;
    const cityLower = city.toLowerCase().trim();

    if (CITY_STATE_FIXES.hasOwnProperty(cityLower)) {
      const correctState = CITY_STATE_FIXES[cityLower];

      if (correctState === null) {
        // International city - remove location
        await fetchJSON(`${SUPABASE_URL}/rest/v1/auction_events?id=eq.${event.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ seller_location: null })
        });
        console.log(`  ✗ Removed: ${event.seller_name} - ${loc} (international)`);
        removed++;
      } else if (state !== correctState) {
        // Fix state code
        const newLoc = `${city}, ${correctState}`;
        await fetchJSON(`${SUPABASE_URL}/rest/v1/auction_events?id=eq.${event.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ seller_location: newLoc })
        });
        console.log(`  ✓ Fixed: ${event.seller_name} - ${loc} → ${newLoc}`);
        fixed++;
      }
    }
  }

  // Also fix external_identities metadata
  console.log('\nFixing external_identities...');
  const identities = await fetchJSON(
    `${SUPABASE_URL}/rest/v1/external_identities?platform=eq.bat&select=id,handle,metadata`
  );

  let identitiesFixed = 0;
  for (const identity of identities) {
    if (!identity.metadata?.city) continue;

    const cityLower = identity.metadata.city.toLowerCase().trim();
    if (CITY_STATE_FIXES.hasOwnProperty(cityLower)) {
      const correctState = CITY_STATE_FIXES[cityLower];

      if (correctState === null) {
        // Remove location from metadata
        const newMetadata = { ...identity.metadata };
        delete newMetadata.city;
        delete newMetadata.state;
        delete newMetadata.country;
        await fetchJSON(`${SUPABASE_URL}/rest/v1/external_identities?id=eq.${identity.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ metadata: newMetadata })
        });
        identitiesFixed++;
      } else if (identity.metadata.state !== correctState) {
        const newMetadata = { ...identity.metadata, state: correctState };
        await fetchJSON(`${SUPABASE_URL}/rest/v1/external_identities?id=eq.${identity.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ metadata: newMetadata })
        });
        identitiesFixed++;
      }
    }
  }

  console.log(`\n════════════════════════════════════════`);
  console.log(`COMPLETE`);
  console.log(`  Events fixed: ${fixed}`);
  console.log(`  Events removed (international): ${removed}`);
  console.log(`  Events skipped (no match): ${skipped}`);
  console.log(`  Identities fixed: ${identitiesFixed}`);
  console.log(`════════════════════════════════════════`);
}

main().catch(console.error);
