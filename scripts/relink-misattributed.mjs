#!/usr/bin/env node
/**
 * relink-misattributed.mjs — paced contamination cleanup.
 *
 * Moves gate-rejected, mis-bucketed images off a SOURCE vehicle onto their TRUE
 * vehicle via the canonical relink_testimony() (collision-safe, audited, never
 * deletes). After each move, flips the image's vision_gate_status to 'approved'
 * (it's now correctly attributed, so it should show on the target profile).
 *
 * WHY a script (not one SQL batch): vehicle_images UPDATE fires heavy per-row
 * triggers (compute_vehicle_value, maintain_vehicle_has_photos), so a batched
 * statement blows the timeout. One relink per statement, paced, fits the budget.
 *
 * Run UNSANDBOXED (network):
 *   dotenvx run -- node scripts/relink-misattributed.mjs \
 *     --source <uuid> --target <uuid> --reason-like '%gmc%' [--exclude '%3500%' --exclude '%dually%'] [--limit 200]
 */
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const arg = (n, d=null) => { const i = args.indexOf(n); return i>=0 ? args[i+1] : d; };
const argAll = (n) => args.reduce((a,v,i)=> (args[i-1]===n ? [...a,v] : a), []);

const SOURCE = arg('--source');
const TARGET = arg('--target');
const REASON_LIKE = arg('--reason-like');
const EXCLUDES = argAll('--exclude');
const LIMIT = parseInt(arg('--limit','500'));
const NOTE = arg('--note', 'contamination cleanup: mis-bucketed image relinked to true vehicle (vision verdict)');
if (!SOURCE || !TARGET || !REASON_LIKE) { console.error('need --source --target --reason-like'); process.exit(1); }

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

let q = sb.from('vehicle_images').select('id')
  .eq('vehicle_id', SOURCE)
  .eq('vision_gate_status', 'rejected_misattributed')
  .ilike('vision_gate_agent_reasoning', REASON_LIKE)
  .limit(LIMIT);
for (const ex of EXCLUDES) q = q.not('vision_gate_agent_reasoning', 'ilike', ex);

const { data: rows, error } = await q;
if (error) { console.error('fetch:', error.message); process.exit(1); }
console.log(`candidates: ${rows.length}  ${SOURCE.slice(0,8)} -> ${TARGET.slice(0,8)}`);

let relinked=0, skipped=0, failed=0;
for (const { id } of rows) {
  try {
    const { data: res, error: e } = await sb.rpc('relink_testimony', {
      p_observation_type: 'image', p_observation_id: id, p_target_vehicle_id: TARGET, p_reason: NOTE,
    });
    if (e) { failed++; console.log(`  FAIL ${id.slice(0,8)} ${e.message.slice(0,70)}`); continue; }
    if (res?.success) {
      // now correctly attributed -> let it show on the target
      await sb.from('vehicle_images').update({
        vision_gate_status: 'approved',
        vision_gate_agent_reasoning: 'relinked from mis-bucket; confirmed this vehicle (cleanup)',
        vision_gate_processed_at: new Date().toISOString(),
      }).eq('id', id);
      relinked++;
    } else { skipped++; }   // e.g. file_hash_exists_on_target (already home)
  } catch (err) { failed++; console.log(`  ERR ${id.slice(0,8)} ${String(err.message).slice(0,70)}`); }
  process.stdout.write(`\r  relinked=${relinked} skipped=${skipped} failed=${failed}  `);
  await new Promise(r => setTimeout(r, 150));   // pace: let the per-row triggers breathe
}
console.log(`\ndone: relinked=${relinked} skipped=${skipped} failed=${failed}`);
