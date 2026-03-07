#!/usr/bin/env npx tsx
/**
 * Backfill organization_vehicles from every source so org profiles show correct vehicle counts.
 * Run: dotenvx run -- npx tsx scripts/backfill-all-org-vehicle-links.ts
 *
 * Sources:
 * - vehicle_events (source_platform='bat') → seller (sold_by) + BAT org (auction_platform) [existing RPC]
 * - build_threads → forum org (work_location) where business_name = forum_sources.slug
 * - vehicles.origin_organization_id → sold_by
 * - vehicle_events → seller (sold_by) + platform (auction_platform)
 * - timeline_events → organization_id + vehicle_id (work_location)
 *
 * Then refreshes businesses.total_vehicles.
 */

import { createClient } from '@supabase/supabase-js';

const BATCH = parseInt(process.env.BATCH_SIZE || '2000', 10);

async function main() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Need VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (use dotenvx run --)');
    process.exit(1);
  }
  const supabase = createClient(url, key);

  console.log('=== Backfill all org–vehicle links (batch size', BATCH, ') ===\n');

  // 1) BAT: seller + platform (existing RPC, returns inserted_seller, inserted_platform, last_id)
  console.log('1. BAT vehicle events (seller + auction_platform)...');
  let lastId: string | null = null;
  let batSeller = 0;
  let batPlatform = 0;
  let batBatches = 0;
  while (true) {
    const { data, error } = await supabase.rpc('backfill_vehicle_org_claims_from_vehicle_events', {
      p_batch_size: BATCH,
      p_after_id: lastId,
    });
    if (error) {
      console.error('BAT backfill error:', error.message);
      break;
    }
    const row = Array.isArray(data) ? data[0] : data;
    const s = (row?.inserted_seller ?? 0) as number;
    const p = (row?.inserted_platform ?? 0) as number;
    lastId = row?.last_id ?? null;
    batSeller += s;
    batPlatform += p;
    batBatches++;
    if (s + p === 0 && !lastId) break;
    process.stdout.write(`   batch ${batBatches}: seller +${s} platform +${p}\r`);
  }
  console.log(`   BAT done: seller ${batSeller}, platform ${batPlatform} (${batBatches} batches).`);

  // 2) Build threads (forums)
  console.log('2. Build threads (forum → org)...');
  let btTotal = 0;
  while (true) {
    const { data, error } = await supabase.rpc('backfill_org_vehicles_from_build_threads', {
      p_batch_size: BATCH,
    });
    if (error) {
      console.error('Build threads error:', error.message);
      break;
    }
    const inserted = (Array.isArray(data) ? data[0]?.inserted : data?.inserted) ?? 0;
    btTotal += inserted;
    if (inserted === 0) break;
    process.stdout.write(`   inserted ${btTotal}\r`);
  }
  console.log(`   Build threads done: ${btTotal} links.`);

  // 3) vehicles.origin_organization_id
  console.log('3. Vehicles.origin_organization_id...');
  let originTotal = 0;
  while (true) {
    const { data, error } = await supabase.rpc('backfill_org_vehicles_from_origin_org', {
      p_batch_size: BATCH,
    });
    if (error) {
      console.error('Origin org error:', error.message);
      break;
    }
    const inserted = (Array.isArray(data) ? data[0]?.inserted : data?.inserted) ?? 0;
    originTotal += inserted;
    if (inserted === 0) break;
    process.stdout.write(`   inserted ${originTotal}\r`);
  }
  console.log(`   Origin org done: ${originTotal} links.`);

  // 4) vehicle_events
  console.log('4. Vehicle events (seller + platform)...');
  let extSeller = 0;
  let extPlatform = 0;
  while (true) {
    const { data, error } = await supabase.rpc('backfill_org_vehicles_from_vehicle_events', {
      p_batch_size: BATCH,
    });
    if (error) {
      console.error('Vehicle events error:', error.message);
      break;
    }
    const row = Array.isArray(data) ? data[0] : data;
    const s = (row?.inserted_seller ?? 0) as number;
    const p = (row?.inserted_platform ?? 0) as number;
    extSeller += s;
    extPlatform += p;
    if (s + p === 0) break;
    process.stdout.write(`   seller +${extSeller} platform +${extPlatform}\r`);
  }
  console.log(`   Vehicle events done: seller ${extSeller}, platform ${extPlatform}.`);

  // 5) timeline_events
  console.log('5. Timeline events...');
  let teTotal = 0;
  while (true) {
    const { data, error } = await supabase.rpc('backfill_org_vehicles_from_timeline_events', {
      p_batch_size: BATCH,
    });
    if (error) {
      console.error('Timeline events error:', error.message);
      break;
    }
    const inserted = (Array.isArray(data) ? data[0]?.inserted : data?.inserted) ?? 0;
    teTotal += inserted;
    if (inserted === 0) break;
    process.stdout.write(`   inserted ${teTotal}\r`);
  }
  console.log(`   Timeline events done: ${teTotal} links.`);

  // 6) Refresh total_vehicles on businesses
  console.log('\n6. Refreshing businesses.total_vehicles...');
  const { data: refreshed, error: refreshErr } = await supabase.rpc('refresh_org_total_vehicles');
  if (refreshErr) {
    console.warn('Refresh error:', refreshErr.message);
  } else {
    console.log('   Refreshed', refreshed, 'orgs.');
  }

  console.log('\n=== Done. Run again to catch any new data. ===');
}

main();
