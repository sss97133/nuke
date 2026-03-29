#!/usr/bin/env node
/**
 * Backfill analysis signals for recently-viewed vehicles.
 *
 * Targets the 100 most-viewed vehicles (last 30 days) that have
 * the fewest signals, so the frontend SIGNALS section shows data
 * for vehicles people actually look at.
 *
 * Calls analysis-engine-coordinator with action: "evaluate_vehicle"
 * for each vehicle. Batches 5 at a time with 2s delay between batches.
 * Stops on any error to avoid burning credits on a broken pipeline.
 *
 * Usage:
 *   npm run ops:signals               # compute for 100 most-viewed
 *   npm run ops:signals:dry-run       # preview which vehicles would be computed
 *   npm run ops:signals -- --limit=20 # compute for top 20 only
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

const BATCH_SIZE = 5;
const DELAY_MS = 2000;
const MAX_VEHICLES = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '100', 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callCoordinator(vehicleId) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/analysis-engine-coordinator`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'evaluate_vehicle', vehicle_id: vehicleId }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, status: res.status, error: text };
  }
  return { ok: true, data: await res.json().catch(() => ({})) };
}

function severityBreakdown(signals) {
  if (!signals || !Array.isArray(signals)) return '';
  const counts = {};
  for (const s of signals) {
    const sev = s.severity || 'unknown';
    counts[sev] = (counts[sev] || 0) + 1;
  }
  return Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ');
}

async function findRecentlyViewedVehicles() {
  // Use raw SQL via RPC to get recently-viewed vehicles sorted by signal sparsity
  // This matches the query from the prompt: vehicles viewed in last 30 days, ordered
  // by signal_count ASC, last_viewed DESC
  const { data, error } = await supabase.rpc('execute_readonly_query', {
    p_sql: `
      SELECT json_agg(row_order) as vehicles FROM (
        SELECT v.id, v.year, v.make, v.model,
          (SELECT max(viewed_at) FROM vehicle_views vv WHERE vv.vehicle_id = v.id) as last_viewed,
          (SELECT count(*) FROM analysis_signals s WHERE s.vehicle_id = v.id) as signal_count
        FROM vehicles v
        WHERE v.id IN (
          SELECT DISTINCT vehicle_id FROM vehicle_views
          WHERE viewed_at > now() - interval '30 days'
        )
        ORDER BY
          (SELECT count(*) FROM analysis_signals s WHERE s.vehicle_id = v.id) ASC,
          (SELECT max(viewed_at) FROM vehicle_views vv WHERE vv.vehicle_id = v.id) DESC
        LIMIT ${MAX_VEHICLES}
      ) row_order
    `
  });

  if (error) {
    // Fallback: use PostgREST approach if RPC fails
    console.warn('RPC query failed, falling back to PostgREST approach:', error.message);
    return await findVehiclesFallback();
  }

  const parsed = typeof data === 'string' ? JSON.parse(data) : data;
  return parsed?.vehicles || [];
}

async function findVehiclesFallback() {
  // Fallback: get recent vehicle views, then filter out those with signals
  const { data: views } = await supabase
    .from('vehicle_views')
    .select('vehicle_id')
    .gt('viewed_at', new Date(Date.now() - 30 * 86400000).toISOString())
    .order('viewed_at', { ascending: false })
    .limit(500);

  if (!views || views.length === 0) return [];

  const uniqueIds = [...new Set(views.map(v => v.vehicle_id))];

  // Check which already have signals
  const { data: existing } = await supabase
    .from('analysis_signals')
    .select('vehicle_id')
    .in('vehicle_id', uniqueIds.slice(0, 200));

  const existingSet = new Set((existing || []).map(e => e.vehicle_id));
  const idsWithoutSignals = uniqueIds.filter(id => !existingSet.has(id)).slice(0, MAX_VEHICLES);

  // Get vehicle details
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .in('id', idsWithoutSignals);

  return vehicles || [];
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`Scanning for ${MAX_VEHICLES} most-viewed vehicles (last 30 days) needing signals...`);

  const vehiclesToProcess = await findRecentlyViewedVehicles();

  console.log(`Found ${vehiclesToProcess.length} vehicles to compute signals for`);

  if (vehiclesToProcess.length === 0) {
    console.log('All recently-viewed vehicles already have signals. Nothing to do.');
    return;
  }

  if (dryRun) {
    for (const v of vehiclesToProcess.slice(0, 20)) {
      console.log(`  [DRY RUN] Would compute: ${v.year || '?'} ${v.make || '?'} ${v.model || '?'} (${v.id}) — ${v.signal_count ?? 0} existing signals`);
    }
    if (vehiclesToProcess.length > 20) {
      console.log(`  ... and ${vehiclesToProcess.length - 20} more`);
    }
    return;
  }

  let computed = 0;
  let errors = 0;

  for (let i = 0; i < vehiclesToProcess.length; i += BATCH_SIZE) {
    const batch = vehiclesToProcess.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(v => callCoordinator(v.id))
    );

    for (let j = 0; j < results.length; j++) {
      const v = batch[j];
      const r = results[j];
      if (r.status === 'fulfilled' && r.value.ok) {
        const d = r.value.data;
        const signalCount = d?.widgets_evaluated ?? d?.signals?.length ?? '?';
        const breakdown = severityBreakdown(d?.signals);
        console.log(`  [${v.id.slice(0, 8)}] ${v.year || '?'} ${v.make || '?'} ${v.model || '?'} — computed ${signalCount} signals (${breakdown})`);
        computed++;
      } else {
        const err = r.status === 'fulfilled' ? r.value.error : r.reason;
        console.error(`  [ERR] ${v.year || '?'} ${v.make || '?'} ${v.model || '?'}: ${String(err).slice(0, 120)}`);
        errors++;
        if (errors >= 3) {
          console.error('\nStopping — too many errors. Fix the pipeline before retrying.');
          process.exit(1);
        }
      }
    }

    const progress = Math.min(i + BATCH_SIZE, vehiclesToProcess.length);
    console.log(`\n  --- batch ${Math.floor(i / BATCH_SIZE) + 1}: ${progress}/${vehiclesToProcess.length} (${computed} ok, ${errors} err) ---\n`);
    if (i + BATCH_SIZE < vehiclesToProcess.length) await sleep(DELAY_MS);
  }

  console.log(`\n=== SIGNALS COMPUTE SWEEP COMPLETE ===`);
  console.log(`  Vehicles processed: ${computed}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Run "npm run ops:signals" again to process remaining vehicles.`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
