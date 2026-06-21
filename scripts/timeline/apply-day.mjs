#!/usr/bin/env node
/**
 * apply-day.mjs — chronological timeline day-walker, APPLY step.
 *
 * Applies per-photo vision verdicts for one date, using ONLY sanctioned paths:
 *   - reattribute  → reattribute_observation() RPC (supersede + lineage + audit),
 *                    then mark the new row approved on its correct vehicle.
 *   - confirm      → vision_gate_status='approved' (real verdict, replaces auto-bless)
 *   - personal     → vision_gate_status='rejected_personal' (kept as testimony, gated out)
 *   - ambiguous    → vision_gate_status='review_needed'
 * Then rebuilds the day card (build-day.mjs) for every vehicle touched. Idempotent.
 *
 * Never deletes, never raw-UPDATEs content — gate status is metadata; moves go via RPC.
 *
 * Usage:
 *   dotenvx run -- node scripts/timeline/apply-day.mjs --date 2016-04-23 \
 *     [--decisions /tmp/day/2016-04-23/decisions.json] [--dry-run]
 *
 * decisions.json: { "date": "...", "decisions": [
 *   { "id": "<image uuid>", "verdict": "confirm|reattribute|personal|ambiguous",
 *     "target_vehicle_id": "<uuid, for reattribute>", "reason": "..." } ] }
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, KEY);
const ACTOR = '0b9f107a-d124-49de-9ded-94698f63c1c4';
const __dir = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const arg = (n, d = null) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : d; };
const DATE = arg('--date');
const DRY = args.includes('--dry-run');
const DECISIONS = arg('--decisions', DATE ? `/tmp/day/${DATE}/decisions.json` : null);
if (!DATE || !DECISIONS) { console.error('--date and --decisions required'); process.exit(1); }

const { decisions } = JSON.parse(readFileSync(DECISIONS, 'utf8'));
const GATE = { confirm: 'approved', personal: 'rejected_personal', ambiguous: 'review_needed' };
const touched = new Set();
const tally = { confirm: 0, personal: 0, ambiguous: 0, reattribute: 0, err: 0 };

for (const d of decisions) {
  try {
    if (d.verdict === 'reattribute') {
      if (!d.target_vehicle_id) { console.error(`  ${d.id}: reattribute missing target`); tally.err++; continue; }
      if (DRY) { console.log(`  [dry] reattribute ${d.id} -> ${d.target_vehicle_id.slice(0,8)}`); tally.reattribute++; touched.add(d.target_vehicle_id); continue; }
      const { data, error } = await supabase.rpc('reattribute_observation', {
        p_observation_type: 'image', p_observation_id: d.id,
        p_target_vehicle_id: d.target_vehicle_id,
        p_reason: d.reason || 'timeline day-walk vision verdict 2026-05-30',
        p_actor_user_id: ACTOR,
      });
      if (error) { console.error(`  ${d.id}: rpc ${error.message}`); tally.err++; continue; }
      const newId = data?.new_observation_id || data?.new_observation_id;
      if (newId) await supabase.from('vehicle_images').update({ vision_gate_status: 'approved', vision_gate_processed_at: new Date().toISOString() }).eq('id', newId);
      touched.add(d.target_vehicle_id); tally.reattribute++;
    } else if (GATE[d.verdict]) {
      if (DRY) { console.log(`  [dry] ${d.verdict} ${d.id}`); tally[d.verdict]++; }
      else {
        const { error } = await supabase.from('vehicle_images')
          .update({ vision_gate_status: GATE[d.verdict], vision_gate_agent_reasoning: `timeline day-walk: ${d.verdict}`, vision_gate_processed_at: new Date().toISOString() })
          .eq('id', d.id);
        if (error) { console.error(`  ${d.id}: ${error.message}`); tally.err++; continue; }
        tally[d.verdict]++;
      }
      const { data: row } = await supabase.from('vehicle_images').select('vehicle_id').eq('id', d.id).maybeSingle();
      if (row?.vehicle_id) touched.add(row.vehicle_id);
    } else {
      console.error(`  ${d.id}: unknown verdict ${d.verdict}`); tally.err++;
    }
  } catch (e) { console.error(`  ${d.id}: ${e.message}`); tally.err++; }
}

console.log(`${DATE} applied:`, JSON.stringify(tally));

// Rebuild day cards for every touched vehicle
if (!DRY) {
  for (const vid of touched) {
    try {
      const out = execFileSync('node', [join(__dir, '..', 'daily-receipt', 'build-day.mjs'), '--vehicle-id', vid, '--date', DATE], { encoding: 'utf8' });
      console.log(`  build-day ${vid.slice(0,8)}: ${out.trim().split('\n').pop()}`);
    } catch (e) { console.error(`  build-day ${vid.slice(0,8)} failed: ${e.message}`); }
  }
}
