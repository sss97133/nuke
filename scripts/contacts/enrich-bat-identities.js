#!/usr/bin/env node
/**
 * Enrich BaT External Identities
 *
 * Links identities to their activity and extracts location:
 * 1. Link auction_comments to external_identities
 * 2. Find vehicles they sold (is_seller=true comments)
 * 3. Extract seller location from vehicle data
 * 4. Aggregate stats (bid count, comment count, vehicles sold)
 *
 * Usage: dotenvx run -- node scripts/contacts/enrich-bat-identities.js
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

async function getIdentitiesWithoutLocation() {
  // Get BaT identities that don't have location in metadata
  const data = await fetchJSON(
    `${SUPABASE_URL}/rest/v1/external_identities?platform=eq.bat&select=id,handle&limit=1000`
  );
  return data.filter(i => !i.metadata?.city);
}

async function getSellerVehicles(username) {
  // Find vehicles where this user was the seller
  const comments = await fetchJSON(
    `${SUPABASE_URL}/rest/v1/auction_comments?author_username=eq.${encodeURIComponent(username)}&is_seller=eq.true&select=vehicle_id&limit=50`
  );

  if (!comments.length) return [];

  const vehicleIds = [...new Set(comments.map(c => c.vehicle_id))];

  // Get vehicle details with location
  const vehicles = await fetchJSON(
    `${SUPABASE_URL}/rest/v1/vehicles?id=in.(${vehicleIds.join(',')})&select=id,year,make,model,city,state,country`
  );

  return vehicles;
}

async function getUserActivity(username) {
  // Get aggregated activity for a user
  const [bids, comments, sellerComments] = await Promise.all([
    fetchJSON(`${SUPABASE_URL}/rest/v1/auction_comments?author_username=eq.${encodeURIComponent(username)}&comment_type=eq.bid&select=count`),
    fetchJSON(`${SUPABASE_URL}/rest/v1/auction_comments?author_username=eq.${encodeURIComponent(username)}&comment_type=neq.bid&select=count`),
    fetchJSON(`${SUPABASE_URL}/rest/v1/auction_comments?author_username=eq.${encodeURIComponent(username)}&is_seller=eq.true&select=count`)
  ]);

  return {
    bid_count: bids[0]?.count || 0,
    comment_count: comments[0]?.count || 0,
    seller_comment_count: sellerComments[0]?.count || 0
  };
}

async function updateIdentity(id, metadata) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/external_identities?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ metadata })
  });
  return res.ok;
}

async function enrichIdentity(identity) {
  const { id, handle } = identity;

  // Get their activity stats
  const activity = await getUserActivity(handle);

  // Get vehicles they sold
  const vehicles = await getSellerVehicles(handle);

  // Extract location from first vehicle with location
  let city = null, state = null, country = null;
  for (const v of vehicles) {
    if (v.city) {
      city = v.city;
      state = v.state;
      country = v.country;
      break;
    }
  }

  // Build enriched metadata
  const metadata = {
    ...activity,
    is_seller: vehicles.length > 0,
    vehicles_sold: vehicles.length,
    vehicle_makes: [...new Set(vehicles.map(v => v.make).filter(Boolean))],
    city,
    state,
    country,
    enriched_at: new Date().toISOString()
  };

  return { id, handle, metadata, hasLocation: !!city };
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  BAT IDENTITY ENRICHMENT                                     ║');
  console.log('║  Adding activity stats and location data                     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Get sample of identities to enrich
  console.log('Fetching identities to enrich...');

  // Focus on sellers first (they have location data from vehicles)
  const sellers = await fetchJSON(
    `${SUPABASE_URL}/rest/v1/external_identities?platform=eq.bat&select=id,handle,metadata&order=last_seen_at.desc&limit=500`
  );

  console.log(`Processing ${sellers.length} identities...\n`);

  let enriched = 0, withLocation = 0, errors = 0;

  for (const identity of sellers) {
    try {
      const result = await enrichIdentity(identity);

      // Update the identity
      const ok = await updateIdentity(result.id, result.metadata);

      if (ok) {
        enriched++;
        if (result.hasLocation) withLocation++;

        if (enriched <= 10 || enriched % 50 === 0) {
          const loc = result.metadata.city ? `${result.metadata.city}, ${result.metadata.state}` : 'no location';
          console.log(`  ✓ ${result.handle} - ${result.metadata.vehicles_sold} vehicles, ${loc}`);
        }
      } else {
        errors++;
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 200));

    } catch (e) {
      errors++;
    }
  }

  console.log(`\n════════════════════════════════════════`);
  console.log(`COMPLETE`);
  console.log(`  Enriched: ${enriched}`);
  console.log(`  With location: ${withLocation}`);
  console.log(`  Errors: ${errors}`);
  console.log(`════════════════════════════════════════`);
}

main().catch(console.error);
