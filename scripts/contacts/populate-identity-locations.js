#!/usr/bin/env node
/**
 * Populate External Identity Locations
 *
 * Finds location from vehicles they sold and updates metadata
 *
 * Usage: dotenvx run -- node scripts/contacts/populate-identity-locations.js
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
  return res.json();
}

async function getIdentitiesNeedingLocation(limit = 100) {
  // Get identities that don't have location in metadata
  // Focus on ones that have been active (have metadata from bulk import)
  const data = await fetchJSON(
    `${SUPABASE_URL}/rest/v1/external_identities?platform=eq.bat&select=id,handle,metadata&limit=${limit}`
  );

  return data.filter(i => !i.metadata?.city);
}

async function findSellerLocation(handle) {
  // Find vehicles where this user was the seller
  const comments = await fetchJSON(
    `${SUPABASE_URL}/rest/v1/auction_comments?author_username=eq.${encodeURIComponent(handle)}&is_seller=eq.true&select=vehicle_id&limit=10`
  );

  if (!comments.length) return null;

  // Get vehicles with location
  const vehicleIds = [...new Set(comments.map(c => c.vehicle_id).filter(Boolean))];
  if (!vehicleIds.length) return null;

  const vehicles = await fetchJSON(
    `${SUPABASE_URL}/rest/v1/vehicles?id=in.(${vehicleIds.join(',')})&city=not.is.null&select=city,state,country&limit=5`
  );

  if (vehicles.length && vehicles[0].city) {
    return {
      city: vehicles[0].city,
      state: vehicles[0].state,
      country: vehicles[0].country || 'USA'
    };
  }

  return null;
}

async function updateIdentityLocation(id, currentMetadata, location) {
  const newMetadata = {
    ...currentMetadata,
    city: location.city,
    state: location.state,
    country: location.country,
    location_source: 'vehicle_sale',
    location_updated_at: new Date().toISOString()
  };

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

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  POPULATE IDENTITY LOCATIONS                                 ║');
  console.log('║  Finding seller locations from vehicle data                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  let totalProcessed = 0;
  let totalLocated = 0;
  let batch = 0;

  while (batch < 20) { // Process up to 2000 identities
    batch++;
    console.log(`\nBatch ${batch}...`);

    const identities = await getIdentitiesNeedingLocation(100);
    if (!identities.length) {
      console.log('No more identities to process');
      break;
    }

    let batchLocated = 0;

    for (const identity of identities) {
      totalProcessed++;

      const location = await findSellerLocation(identity.handle);

      if (location) {
        const ok = await updateIdentityLocation(identity.id, identity.metadata, location);
        if (ok) {
          batchLocated++;
          totalLocated++;

          if (totalLocated <= 20 || totalLocated % 50 === 0) {
            console.log(`  ✓ ${identity.handle} → ${location.city}, ${location.state}`);
          }
        }
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 100));
    }

    console.log(`  Batch: ${batchLocated} located out of ${identities.length}`);

    if (batchLocated === 0) {
      // No more sellers with location data, try different batch
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log(`\n════════════════════════════════════════`);
  console.log(`COMPLETE`);
  console.log(`  Processed: ${totalProcessed}`);
  console.log(`  Located: ${totalLocated}`);
  console.log(`════════════════════════════════════════`);
}

main().catch(console.error);
