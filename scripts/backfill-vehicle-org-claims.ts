#!/usr/bin/env npx tsx
/**
 * Backfill organization_vehicles from vehicle_events (source_platform='bat', seller + auction_platform).
 * Uses id-range batching to avoid timeouts. Run until inserted_seller + inserted_platform is 0.
 *
 * Usage: dotenvx run -- npx tsx scripts/backfill-vehicle-org-claims.ts
 *        BATCH_SIZE=2000 dotenvx run -- npx tsx scripts/backfill-vehicle-org-claims.ts
 */

import { createClient } from '@supabase/supabase-js';

const BATCH_SIZE = parseInt(
  process.env.BATCH_SIZE || process.argv.find((a) => a.startsWith('--batch='))?.split('=')[1] || '2000',
  10
);

async function main() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (use dotenvx run --)');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  let totalSeller = 0;
  let totalPlatform = 0;
  const stateFile = process.env.BACKFILL_STATE_FILE || '.backfill-vehicle-org-claims-last-id';
  const fs = await import('fs');
  let lastId: string | null = null;
  try {
    const s = fs.readFileSync(stateFile, 'utf8').trim();
    if (s) lastId = s;
  } catch (_) {}
  let n = 0;

  console.log(`Backfilling vehicle-org claims from vehicle_events (batch size ${BATCH_SIZE})${lastId ? ` resuming after ${lastId.slice(0, 8)}...` : '...'}`);

  while (true) {
    const { data, error } = await supabase.rpc('backfill_vehicle_org_claims_from_vehicle_events', {
      p_batch_size: BATCH_SIZE,
      p_after_id: lastId,
    });

    if (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }

    const row = Array.isArray(data) ? data[0] : data;
    const insertedSeller = row?.inserted_seller ?? 0;
    const insertedPlatform = row?.inserted_platform ?? 0;
    lastId = row?.last_id ?? null;

    totalSeller += insertedSeller;
    totalPlatform += insertedPlatform;
    n += 1;

    const total = insertedSeller + insertedPlatform;
    if (total === 0 && !lastId) {
      console.log(`Done. Batches: ${n}, seller rows: ${totalSeller}, platform rows: ${totalPlatform}.`);
      break;
    }

    process.stdout.write(`  Batch ${n}: seller +${insertedSeller} platform +${insertedPlatform} (total s:${totalSeller} p:${totalPlatform})\r`);
    if (lastId) fs.writeFileSync(stateFile, lastId);
    if (!lastId) {
      try { fs.unlinkSync(stateFile); } catch (_) {}
      break;
    }
  }

  console.log('\nRefreshing total_vehicles for all orgs...');
  const { data: refreshed, error: refreshErr } = await supabase.rpc('refresh_org_total_vehicles');
  if (refreshErr) {
    console.warn('Refresh warning:', refreshErr.message);
  } else {
    console.log('Refreshed total_vehicles for', refreshed, 'orgs.');
  }
}

main();
