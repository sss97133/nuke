#!/usr/bin/env node
/**
 * Batch ARS (Auction Readiness Score) computation
 *
 * Scores vehicles via persist_auction_readiness() with per-vehicle
 * error handling and progress reporting. Commits each vehicle independently
 * so timeouts don't roll back entire batches.
 *
 * Usage:
 *   dotenvx run -- node scripts/batch-ars-scoring.mjs [--batch 5000] [--max 50000] [--continue]
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const args = process.argv.slice(2);
const batchIdx = args.indexOf('--batch');
const BATCH_SIZE = batchIdx >= 0 ? parseInt(args[batchIdx + 1]) : 5000;
const maxIdx = args.indexOf('--max');
const MAX_TOTAL = maxIdx >= 0 ? parseInt(args[maxIdx + 1]) : 999999;
const CONTINUE = args.includes('--continue');

async function getUnscored(limit) {
  const { data, error } = await supabase.rpc('exec_sql', {
    sql_text: `
      SELECT v.id FROM vehicles v
      LEFT JOIN auction_readiness ar ON v.id = ar.vehicle_id
      WHERE ar.vehicle_id IS NULL
        AND v.status IN ('active', 'sold', 'pending')
      LIMIT ${limit}
    `
  });
  if (error) throw new Error(`Query failed: ${error.message}`);
  return data;
}

async function scoreVehicle(vehicleId) {
  const { data, error } = await supabase.rpc('persist_auction_readiness', {
    p_vehicle_id: vehicleId
  });
  if (error) throw error;
  return data;
}

async function getStats() {
  const { data } = await supabase.rpc('exec_sql', {
    sql_text: `SELECT tier, count(*)::int as cnt FROM auction_readiness GROUP BY 1 ORDER BY 2 DESC`
  });
  return data;
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  ARS Batch Scoring');
  console.log(`  Batch: ${BATCH_SIZE} | Max: ${MAX_TOTAL}`);
  console.log('═══════════════════════════════════════════════════\n');

  let totalScored = 0;
  let totalErrors = 0;
  const startTime = Date.now();

  while (totalScored + totalErrors < MAX_TOTAL) {
    const remaining = Math.min(BATCH_SIZE, MAX_TOTAL - totalScored - totalErrors);
    let vehicles;
    try {
      vehicles = await getUnscored(remaining);
    } catch (err) {
      console.error(`Failed to fetch unscored vehicles: ${err.message}`);
      break;
    }

    if (!vehicles || vehicles.length === 0) {
      console.log('No more unscored vehicles.');
      break;
    }

    console.log(`Batch: ${vehicles.length} vehicles`);

    for (let i = 0; i < vehicles.length; i++) {
      try {
        await scoreVehicle(vehicles[i].id);
        totalScored++;
      } catch {
        totalErrors++;
      }

      if ((totalScored + totalErrors) % 500 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const rate = (totalScored / (elapsed / 60)).toFixed(0);
        console.log(`  Scored: ${totalScored} | Errors: ${totalErrors} | ${elapsed}s | ${rate}/min`);
      }
    }

    if (!CONTINUE) break;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\nDone: ${totalScored} scored, ${totalErrors} errors in ${elapsed}s`);

  const stats = await getStats();
  if (stats) {
    console.log('\nTier distribution:');
    for (const row of stats) {
      console.log(`  ${row.tier}: ${row.cnt}`);
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
