#!/usr/bin/env node
/**
 * Cleanup Bad Location Data
 *
 * Removes invalid location data from external_identities metadata
 * where state is not a valid US state abbreviation
 *
 * Usage: dotenvx run -- node scripts/contacts/cleanup-bad-locations.js
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
  return res.json();
}

async function getIdentitiesWithLocation(offset = 0, limit = 500) {
  // Get identities that have city in metadata
  const data = await fetchJSON(
    `${SUPABASE_URL}/rest/v1/external_identities?platform=eq.bat&select=id,handle,metadata&offset=${offset}&limit=${limit}`
  );

  // Filter to those with city set
  return data.filter(i => i.metadata?.city);
}

async function clearBadLocation(id, currentMetadata) {
  // Remove location fields from metadata
  const newMetadata = { ...currentMetadata };
  delete newMetadata.city;
  delete newMetadata.state;
  delete newMetadata.country;
  delete newMetadata.location_source;
  delete newMetadata.location_updated_at;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/external_identities?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ metadata: newMetadata })
  });

  return res.ok;
}

function isValidLocation(metadata) {
  if (!metadata?.city || !metadata?.state) return false;

  // Check if state is a valid abbreviation
  if (!VALID_STATES.has(metadata.state)) return false;

  // Check if city looks reasonable (not too long, no suspicious patterns)
  const city = metadata.city;
  if (city.length > 30) return false;
  if (city.toLowerCase().includes('leather')) return false;
  if (city.toLowerCase().includes('cloth')) return false;
  if (city.toLowerCase().includes('interior')) return false;
  if (city.toLowerCase().includes('gray')) return false;
  if (city.toLowerCase().includes('black')) return false;
  if (city.toLowerCase().includes('tan')) return false;
  if (city.toLowerCase().includes('lounge')) return false;

  return true;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  CLEANUP BAD LOCATION DATA                                   ║');
  console.log('║  Removing invalid city/state from identities                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  let totalChecked = 0;
  let totalCleaned = 0;
  let totalValid = 0;
  let offset = 0;

  while (true) {
    const identities = await getIdentitiesWithLocation(offset, 500);

    if (!identities.length) {
      console.log('\nNo more identities to check');
      break;
    }

    console.log(`\nChecking batch at offset ${offset}...`);

    for (const identity of identities) {
      totalChecked++;

      if (isValidLocation(identity.metadata)) {
        totalValid++;
      } else {
        // Bad location - clear it
        const ok = await clearBadLocation(identity.id, identity.metadata);
        if (ok) {
          totalCleaned++;
          console.log(`  ✗ Cleared bad location for ${identity.handle}: "${identity.metadata.city}, ${identity.metadata.state}"`);
        }
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 50));
    }

    offset += 500;

    // Safety limit
    if (offset > 10000) {
      console.log('\nReached safety limit');
      break;
    }
  }

  console.log(`\n════════════════════════════════════════`);
  console.log(`COMPLETE`);
  console.log(`  Checked: ${totalChecked}`);
  console.log(`  Valid locations: ${totalValid}`);
  console.log(`  Cleaned bad data: ${totalCleaned}`);
  console.log(`════════════════════════════════════════`);
}

main().catch(console.error);
