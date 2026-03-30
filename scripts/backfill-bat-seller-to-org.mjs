#!/usr/bin/env node
/**
 * Backfill bat_seller → organization wiring
 *
 * For each (seller_username, organization_id) in bat_seller_monitors:
 * 1. Find vehicles WHERE bat_seller ILIKE seller_username
 * 2. Upsert external_identities (platform='bat', handle=seller_username)
 * 3. Upsert organization_vehicles (org_id, vehicle_id, relationship_type='sold_by')
 * 4. Update vehicle_events SET source_organization_id WHERE vehicle_id + platform='bat' + currently NULL
 * 5. Update vehicle_events SET seller_external_identity_id WHERE same conditions
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const BATCH_SIZE = 500;
const SLEEP_MS = 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  // 1. Get all seller → org mappings
  const { data: monitors, error: monErr } = await supabase
    .from('bat_seller_monitors')
    .select('seller_username, organization_id');

  if (monErr) {
    console.error('Failed to fetch bat_seller_monitors:', monErr.message);
    process.exit(1);
  }

  console.log(`Found ${monitors.length} seller→org mappings`);

  let totalLinked = 0;
  let totalEventsUpdated = 0;

  for (const { seller_username, organization_id } of monitors) {
    console.log(`\n--- Processing: ${seller_username} → org ${organization_id} ---`);

    // 2. Upsert external_identity for this seller
    const { data: eiData, error: eiErr } = await supabase
      .from('external_identities')
      .upsert(
        { platform: 'bat', handle: seller_username, first_seen_at: new Date().toISOString() },
        { onConflict: 'platform,handle', ignoreDuplicates: false }
      )
      .select('id')
      .single();

    if (eiErr) {
      // Try select if upsert fails
      const { data: existing } = await supabase
        .from('external_identities')
        .select('id')
        .eq('platform', 'bat')
        .eq('handle', seller_username)
        .single();

      if (!existing) {
        console.warn(`  Could not get/create external_identity for ${seller_username}: ${eiErr.message}`);
        continue;
      }
      var externalIdentityId = existing.id;
    } else {
      var externalIdentityId = eiData.id;
    }

    console.log(`  External identity ID: ${externalIdentityId}`);

    // 3. Find vehicles with this bat_seller (paginate to avoid 1000 row limit)
    let vehicles = [];
    let page = 0;
    const PAGE_SIZE = 1000;
    while (true) {
      const { data: batch, error: vErr } = await supabase
        .from('vehicles')
        .select('id')
        .ilike('bat_seller', seller_username)
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (vErr) {
        console.warn(`  Vehicle query failed: ${vErr.message}`);
        break;
      }
      vehicles = vehicles.concat(batch || []);
      if (!batch || batch.length < PAGE_SIZE) break;
      page++;
    }

    console.log(`  Found ${vehicles.length} vehicles for ${seller_username}`);
    if (vehicles.length === 0) continue;

    // 4. Process in batches
    for (let i = 0; i < vehicles.length; i += BATCH_SIZE) {
      const batch = vehicles.slice(i, i + BATCH_SIZE);
      const vehicleIds = batch.map((v) => v.id);

      if (dryRun) {
        console.log(`  [DRY RUN] Would process batch ${i / BATCH_SIZE + 1} (${batch.length} vehicles)`);
        continue;
      }

      // 4a. Upsert organization_vehicles
      const orgVehicleRows = vehicleIds.map((vid) => ({
        organization_id,
        vehicle_id: vid,
        relationship_type: 'sold_by',
        status: 'active',
        auto_tagged: true,
        auto_matched_at: new Date().toISOString(),
        auto_matched_reasons: ['bat_seller_monitor_match'],
      }));

      const { error: ovErr } = await supabase
        .from('organization_vehicles')
        .upsert(orgVehicleRows, {
          onConflict: 'organization_id,vehicle_id,relationship_type',
          ignoreDuplicates: true,
        });

      if (ovErr) {
        console.warn(`  organization_vehicles upsert error (batch ${i / BATCH_SIZE + 1}): ${ovErr.message}`);
      } else {
        totalLinked += batch.length;
      }

      // 4b. Update vehicle_events — set source_organization_id + seller_external_identity_id
      const { error: veErr } = await supabase
        .from('vehicle_events')
        .update({
          source_organization_id: organization_id,
          seller_external_identity_id: externalIdentityId,
        })
        .in('vehicle_id', vehicleIds)
        .eq('source_platform', 'bat')
        .is('source_organization_id', null);

      if (veErr) {
        console.warn(`  vehicle_events update error (batch ${i / BATCH_SIZE + 1}): ${veErr.message}`);
      }

      totalEventsUpdated += batch.length;

      console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} vehicles linked`);
      await sleep(SLEEP_MS);
    }
  }

  console.log(`\n=== COMPLETE ===`);
  console.log(`Total vehicles linked: ${totalLinked}`);
  console.log(`Total event batches updated: ${totalEventsUpdated}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
