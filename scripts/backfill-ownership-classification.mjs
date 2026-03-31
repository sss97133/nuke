#!/usr/bin/env node
/**
 * Backfill ownership classification on organization_vehicles
 *
 * Reads vehicles.description for all org-linked vehicles,
 * runs the regex classifier, updates relationship_type where currently 'sold_by'.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function classifyOwnership(description) {
  if (!description) return null;
  const desc = description.toLowerCase();
  // OWNER: selling dealer acquired/purchased/possesses the vehicle
  if (/sell(er|ing dealer).s (acquisition|purchase|possession|care|ownership|collection|inventory)|acquired by the sell(er|ing dealer)|purchased by the sell(er|ing dealer)|bought by the sell(er|ing dealer)|the sell(er|ing dealer) (acquired|purchased|bought|obtained)|prior to the sell(er|ing dealer)|before the sell(er|ing dealer)|(miles|kilometers) (were |have been )?(added|driven) by the sell(er|ing dealer)|sell(er|ing dealer) in \d{4}/.test(desc)) {
    return 'owner';
  }
  // CONSIGNER: explicit consignment language
  if (/on behalf of|consign(ed|ment)|offered on consignment/.test(desc)) {
    return 'consigner';
  }
  // CONSIGNER: "current owner" distinct from selling dealer
  if (/current owner/.test(desc) && !/sell(er|ing dealer).s (acquisition|purchase|possession)|acquired by the sell(er|ing dealer)|the sell(er|ing dealer) (acquired|purchased)/.test(desc)) {
    return 'consigner';
  }
  // BUILT: seller built or restored
  if (/built by the sell(er|ing dealer)|restored by the sell(er|ing dealer)|sell(er|ing dealer)('s| has) (built|restored)/.test(desc)) {
    return 'supplier_build';
  }
  return null;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  // Only process dealer-specific orgs from bat_seller_monitors (not platform orgs like BaT, C&B)
  const { data: monitors } = await supabase
    .from('bat_seller_monitors')
    .select('organization_id');
  const dealerOrgIds = monitors?.map(m => m.organization_id) || [];
  console.log(`Processing ${dealerOrgIds.length} dealer orgs from bat_seller_monitors`);

  if (dealerOrgIds.length === 0) {
    console.log('No dealer orgs found. Exiting.');
    return;
  }

  // Get all org-linked vehicles with relationship_type = 'sold_by' for dealer orgs only
  let offset = 0;
  let totalUpdated = 0;
  let totalChecked = 0;
  const counts = { owner: 0, consigner: 0, built_by: 0, unchanged: 0 };

  while (true) {
    const { data: orgVehicles, error } = await supabase
      .from('organization_vehicles')
      .select('id, vehicle_id, organization_id')
      .eq('relationship_type', 'sold_by')
      .in('organization_id', dealerOrgIds)
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error('Query error:', error.message);
      break;
    }
    if (!orgVehicles || orgVehicles.length === 0) break;

    // Get descriptions for these vehicles
    const vehicleIds = orgVehicles.map((ov) => ov.vehicle_id);
    const { data: vehicles } = await supabase
      .from('vehicles')
      .select('id, description')
      .in('id', vehicleIds);

    const descMap = new Map();
    for (const v of vehicles || []) {
      if (v.description) descMap.set(v.id, v.description);
    }

    for (const ov of orgVehicles) {
      totalChecked++;
      const desc = descMap.get(ov.vehicle_id);
      const newType = classifyOwnership(desc);

      if (newType) {
        counts[newType]++;
        if (!dryRun) {
          // Delete old 'sold_by' row and insert with new type
          // (unique constraint is on org_id, vehicle_id, relationship_type)
          const { error: delErr } = await supabase
            .from('organization_vehicles')
            .delete()
            .eq('id', ov.id);

          if (!delErr) {
            const { error: insErr } = await supabase
              .from('organization_vehicles')
              .upsert({
                organization_id: ov.organization_id,
                vehicle_id: ov.vehicle_id,
                relationship_type: newType,
                status: 'active',
                auto_tagged: true,
                auto_matched_at: new Date().toISOString(),
                auto_matched_reasons: ['description_regex_classifier'],
              }, { onConflict: 'organization_id,vehicle_id,relationship_type', ignoreDuplicates: true });

            if (!insErr) totalUpdated++;
          }
        }
      } else {
        counts.unchanged++;
      }
    }

    console.log(`Processed ${offset + orgVehicles.length} org-vehicle links (${totalUpdated} reclassified)`);
    offset += BATCH_SIZE;

    if (orgVehicles.length < BATCH_SIZE) break;
    await sleep(100);
  }

  console.log(`\n=== COMPLETE ===`);
  console.log(`Checked: ${totalChecked}`);
  console.log(`Reclassified: ${totalUpdated}`);
  console.log(`  Owner: ${counts.owner}`);
  console.log(`  Consigner: ${counts.consigner}`);
  console.log(`  Built by: ${counts.built_by}`);
  console.log(`  Unchanged: ${counts.unchanged}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
