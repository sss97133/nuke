#!/usr/bin/env node
/**
 * Link all BaT vehicles to BaT organization
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BAT_ORG_ID = '222375e1-901e-4a2c-a254-4e412f0e2a56';

async function main() {
  console.log('Fetching BaT vehicle IDs...');

  // Get all BaT vehicle IDs with pagination
  const batVehicles = [];
  let offset = 0;
  while (true) {
    const batRes = await fetch(
      `${SUPABASE_URL}/rest/v1/vehicles?discovery_url=ilike.*bringatrailer*&select=id&limit=1000&offset=${offset}`,
      {
        headers: {
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'apikey': SUPABASE_KEY,
        },
      }
    );
    const batch = await batRes.json();
    if (batch.length === 0) break;
    batVehicles.push(...batch);
    offset += 1000;
    process.stdout.write(`\r  Fetched ${batVehicles.length} vehicles...`);
  }
  console.log(`\nFound ${batVehicles.length} BaT vehicles`);

  // Get already linked vehicle IDs with pagination
  const linkedIds = new Set();
  offset = 0;
  while (true) {
    const linkedRes = await fetch(
      `${SUPABASE_URL}/rest/v1/organization_vehicles?organization_id=eq.${BAT_ORG_ID}&select=vehicle_id&limit=1000&offset=${offset}`,
      {
        headers: {
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'apikey': SUPABASE_KEY,
        },
      }
    );
    const batch = await linkedRes.json();
    if (batch.length === 0) break;
    batch.forEach(v => linkedIds.add(v.vehicle_id));
    offset += 1000;
  }
  console.log(`Already linked: ${linkedIds.size}`);

  // Find unlinked
  const unlinked = batVehicles.filter(v => !linkedIds.has(v.id));
  console.log(`To link: ${unlinked.length}`);

  if (unlinked.length === 0) {
    console.log('All vehicles already linked!');
    return;
  }

  // Insert in small batches of 25 with delays to avoid trigger timeout
  const BATCH_SIZE = 25;
  let total = 0;
  let errors = 0;

  for (let i = 0; i < unlinked.length; i += BATCH_SIZE) {
    const batch = unlinked.slice(i, i + BATCH_SIZE);
    const records = batch.map(v => ({
      organization_id: BAT_ORG_ID,
      vehicle_id: v.id,
      relationship_type: 'sold_by',
      auto_tagged: true,
    }));

    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/organization_vehicles`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'apikey': SUPABASE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify(records),
      });

      if (res.ok) {
        total += batch.length;
        if (total % 500 === 0 || i + BATCH_SIZE >= unlinked.length) {
          console.log(`Progress: ${total}/${unlinked.length} linked`);
        }
      } else {
        errors++;
        if (errors <= 5) {
          const err = await res.text();
          console.error(`Batch error: ${err.slice(0, 80)}`);
        }
      }
    } catch (e) {
      errors++;
      if (errors <= 5) console.error(`Network error: ${e.message}`);
    }

    // Small delay between batches
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\nDone! Linked ${total} vehicles to BaT org.`);
}

main().catch(console.error);
