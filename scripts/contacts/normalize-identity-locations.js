#!/usr/bin/env node
/**
 * Normalize External Identity Locations
 *
 * Fixes state codes in metadata to uppercase and corrects known miscodings
 *
 * Usage: dotenvx run -- node scripts/contacts/normalize-identity-locations.js
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

const ARIZONA_CITIES = new Set(['phoenix','tucson','scottsdale','mesa','tempe','chandler','glendale','gilbert','peoria','surprise','yuma','avondale','flagstaff','goodyear','buckeye','casa grande','sierra vista','prescott','sedona']);
const NEVADA_CITIES = new Set(['las vegas','henderson','reno','boulder city','willow beach','carson city','sparks','mesquite','elko','fernley','laughlin']);
const NEW_JERSEY_CITIES = new Set(['wyckoff','demarest','moonachie','englewood','hackensack','paramus','ridgewood','teaneck','hoboken','jersey city','newark','elizabeth','paterson','trenton','atlantic city','princeton','cherry hill','jamestown']);

async function main() {
  console.log('Normalizing identity locations...\n');

  let offset = 0;
  let fixed = 0;

  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/external_identities?platform=eq.bat&select=id,handle,metadata&offset=${offset}&limit=500`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const data = await res.json();
    if (!data.length) break;

    for (const identity of data) {
      if (!identity.metadata?.city || !identity.metadata?.state) continue;

      let city = identity.metadata.city;
      let state = identity.metadata.state.toUpperCase();
      const cityLower = city.toLowerCase();

      // Fix known miscodings
      if (ARIZONA_CITIES.has(cityLower) && (state === 'AR' || state === 'AZ')) {
        state = 'AZ';
      } else if (NEVADA_CITIES.has(cityLower) && (state === 'NE' || state === 'NV')) {
        state = 'NV';
      } else if (NEW_JERSEY_CITIES.has(cityLower) && (state === 'NE' || state === 'NJ')) {
        state = 'NJ';
      }

      // Skip if no change needed
      if (state === identity.metadata.state && VALID_STATES.has(state)) continue;

      // Update
      const newMetadata = { ...identity.metadata, state };

      await fetch(`${SUPABASE_URL}/rest/v1/external_identities?id=eq.${identity.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ metadata: newMetadata })
      });

      console.log(`  ✓ ${identity.handle}: ${city}, ${identity.metadata.state} → ${state}`);
      fixed++;
    }

    offset += 500;
    if (offset > 10000) break;
  }

  console.log(`\nFixed: ${fixed} identities`);
}

main().catch(console.error);
