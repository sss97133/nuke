#!/usr/bin/env node
/**
 * byok-fleet-next.mjs — pick the next vehicle(s) the BYOK deep-analysis loop should
 * drain, across the WHOLE personal fleet. Replaces the hardcoded single-vehicle plist
 * arg that pinned the cron to one (drained) K5 — wound W1 of the image-ecosystem mandate.
 *
 * Reads ONLY the per-vehicle coverage counter table (image_coverage_by_vehicle, kept
 * fresh by refresh_image_coverage()). It NEVER scans the 38.9M-row vehicle_images table
 * (that times out on the pooler — W5).
 *
 * Ranking (the §3 "inflow-first" rule — today's photos never wait behind 2024's):
 *   1. INFLOW  vehicles whose last-7d photos aren't deep-analyzed yet (inflow_7d - seen_7d)
 *   2. BACKLOG vehicles with gated-but-unseen approved frames (gated_t0 - seen_t1)
 * Emits up to --limit candidate vehicle_ids (one per line, highest priority first).
 * The caller (byok-fleet-batch.sh) tries each in turn; a candidate that prepare() finds
 * drained is refreshed in the counter (--refresh <id>) so it won't be re-picked.
 *
 * Usage:
 *   node byok-fleet-next.mjs --limit 30      → print ranked candidate vehicle_ids
 *   node byok-fleet-next.mjs --refresh <id>  → recompute that vehicle's counter row
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('byok-fleet-next: missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const sb = createClient(URL, KEY);
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };

// --refresh mode: reconcile one vehicle's counter (called after a vehicle drains).
const refreshVid = arg('--refresh');
if (refreshVid) {
  const { error } = await sb.rpc('refresh_image_coverage', { p_vehicle_id: refreshVid });
  if (error) { console.error('byok-fleet-next: refresh failed:', error.message); process.exit(1); }
  console.log('refreshed', refreshVid);
  process.exit(0);
}

const LIMIT = parseInt(arg('--limit', '20'));
const { data, error } = await sb
  .from('image_coverage_by_vehicle')
  .select('vehicle_id,gated_t0,seen_t1,stale_rehash,inflow_7d,seen_7d')
  .limit(5000);
if (error) { console.error('byok-fleet-next:', error.message); process.exit(1); }

const scored = (data || []).map((r) => {
  const gatedUnseen = Math.max(0, (r.gated_t0 || 0) - (r.seen_t1 || 0));
  const inflowDeficit = Math.max(0, (r.inflow_7d || 0) - (r.seen_7d || 0));
  // inflow dominates the score so new photos are always drained before the backfill.
  return { vehicle_id: r.vehicle_id, gatedUnseen, inflowDeficit, score: inflowDeficit * 1_000_000 + gatedUnseen };
}).filter((r) => r.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, LIMIT);

if (!scored.length) {
  console.error('byok-fleet-next: fleet drained (no pending/inflow work in the coverage counter)');
  process.exit(3);
}
for (const r of scored) console.log(r.vehicle_id);
