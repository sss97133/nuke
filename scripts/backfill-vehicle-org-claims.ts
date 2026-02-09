#!/usr/bin/env npx tsx
/**
 * Backfill organization_vehicles from bat_listings (and optionally external_listings).
 * Run until the function returns 0. Uses small batches to avoid timeouts.
 *
 * Usage: dotenvx run -- npx tsx scripts/backfill-vehicle-org-claims.ts
 * Or:    dotenvx run -- npx tsx scripts/backfill-vehicle-org-claims.ts --batch 2000
 */

import { createClient } from '@supabase/supabase-js';

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || process.argv.find(a => a.startsWith('--batch='))?.split('=')[1] || '1000', 10);

async function main() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (use dotenvx run --)');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  let total = 0;
  let n = 0;

  console.log(`Backfilling vehicle-org claims from bat_listings (batch size ${BATCH_SIZE})...`);

  while (true) {
    const { data, error } = await supabase.rpc('backfill_vehicle_org_claims_from_bat_listings', {
      p_batch_size: BATCH_SIZE,
    });

    if (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }

    const inserted = typeof data === 'number' ? data : 0;
    total += inserted;
    n += 1;

    if (inserted === 0) {
      console.log(`Done. Total rows backfilled: ${total} (${n} batches).`);
      break;
    }

    process.stdout.write(`  Batch ${n}: +${inserted} (total ${total})\r`);
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
