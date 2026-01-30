#!/usr/bin/env node
/**
 * Propagate Seller Locations
 *
 * Once we know a seller's location from one listing,
 * apply that location to all their other listings
 *
 * Usage: dotenvx run -- node scripts/contacts/propagate-seller-locations.js
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
  console.log('║  PROPAGATE SELLER LOCATIONS                                  ║');
  console.log('║  Apply known seller locations to all their listings          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Step 1: Get all auction_events with seller_location AND seller_name
  console.log('Step 1: Finding sellers with known locations...\n');

  const eventsWithLocation = await fetchJSON(
    `${SUPABASE_URL}/rest/v1/auction_events?seller_location=not.is.null&seller_name=not.is.null&select=seller_name,seller_location`
  );

  // Build seller -> location map
  const sellerLocations = {};
  for (const event of eventsWithLocation) {
    if (!sellerLocations[event.seller_name]) {
      sellerLocations[event.seller_name] = event.seller_location;
    }
  }

  console.log(`Found ${Object.keys(sellerLocations).length} sellers with known locations\n`);

  // Step 2: Find events without location but with known seller
  console.log('Step 2: Finding events to update...\n');

  let updated = 0;
  let offset = 0;

  while (true) {
    const eventsWithoutLocation = await fetchJSON(
      `${SUPABASE_URL}/rest/v1/auction_events?seller_location=is.null&seller_name=not.is.null&select=id,seller_name&offset=${offset}&limit=500`
    );

    if (!eventsWithoutLocation.length) break;

    for (const event of eventsWithoutLocation) {
      const knownLocation = sellerLocations[event.seller_name];
      if (knownLocation) {
        await fetchJSON(`${SUPABASE_URL}/rest/v1/auction_events?id=eq.${event.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ seller_location: knownLocation })
        });
        updated++;

        if (updated <= 20 || updated % 100 === 0) {
          console.log(`  ✓ ${event.seller_name} → ${knownLocation}`);
        }
      }
    }

    offset += 500;
    if (offset > 50000) break; // Safety limit
  }

  // Step 3: Also update external_identities with seller locations
  console.log('\nStep 3: Updating external_identities...\n');

  let identitiesUpdated = 0;

  for (const [seller, location] of Object.entries(sellerLocations)) {
    // Parse "City, ST" format
    const parts = location.split(',').map(s => s.trim());
    if (parts.length !== 2) continue;
    const [city, state] = parts;

    // Find identity
    const identities = await fetchJSON(
      `${SUPABASE_URL}/rest/v1/external_identities?platform=eq.bat&handle=eq.${encodeURIComponent(seller)}&select=id,metadata`
    );

    if (!identities.length) continue;

    const identity = identities[0];

    // Skip if already has location
    if (identity.metadata?.city) continue;

    // Update metadata
    const newMetadata = {
      ...identity.metadata,
      city,
      state,
      country: 'USA',
      location_source: 'auction_event',
      location_updated_at: new Date().toISOString()
    };

    await fetchJSON(`${SUPABASE_URL}/rest/v1/external_identities?id=eq.${identity.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ metadata: newMetadata })
    });

    identitiesUpdated++;
    if (identitiesUpdated <= 10) {
      console.log(`  ✓ ${seller} → ${city}, ${state}`);
    }
  }

  console.log(`\n════════════════════════════════════════`);
  console.log(`COMPLETE`);
  console.log(`  Auction events updated: ${updated}`);
  console.log(`  Identities updated: ${identitiesUpdated}`);
  console.log(`════════════════════════════════════════`);
}

main().catch(console.error);
