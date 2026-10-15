#!/usr/bin/env node
/**
 * quarantine-gate-rejected.mjs — move a user's gate-rejected photos that are still filed on a real vehicle to the
 * intake quarantine vehicle, through relink_testimony (audited in reattribution_audit, keeps merged_from_vehicle_id,
 * never deletes). Dry run by default: it reads and reports, and writes nothing.
 *
 * WHY: the vision gate marks a photo rejected_misattributed or rejected_personal, but nothing moves it, so the verdict
 * never reaches the car page (owner audit 2026-10-15: ~942 such rows of the owner's still filed on real vehicles, only
 * 19 in quarantine). The quarantine vehicle 14447ecd ("UNRESOLVED Intake Quarantine", is_public false) is where gate
 * rejects wait for re-homing.
 *
 * What it does not do: touch vision_gate_status, move rows already superseded, or move a photo whose file is already in
 * quarantine (relink_testimony refuses file_hash_exists_on_target; the dry run predicts those).
 *
 * Reads are bounded: one created_at window at a time on (user_id, created_at), halved down to one hour on a timeout.
 *
 * Usage (from the repo root; the key comes from the environment, never the command line):
 *   dotenvx run -- node scripts/quarantine-gate-rejected.mjs --user <uuid>                # dry run, JSONL log
 *   dotenvx run -- node scripts/quarantine-gate-rejected.mjs --user <uuid> --apply [--limit 200]
 *   [--log <path>]  default ~/nuke-logs/quarantine-gate-rejected-<UTC date>/<dry-run|apply>-<time>.jsonl
 *   [--from 2025-01-01] [--to <now>]  created_at range to walk
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const QUARANTINE = '14447ecd-293e-4203-9045-90102559c904';
const GATE_REJECTED = ['rejected_misattributed', 'rejected_personal'];

const args = process.argv.slice(2);
const arg = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const USER = arg('--user');
const APPLY = args.includes('--apply');
const LIMIT = arg('--limit') ? Number.parseInt(arg('--limit'), 10) : Infinity;
const FROM = new Date(arg('--from', '2025-01-01T00:00:00Z'));
const TO = new Date(arg('--to', new Date().toISOString()));
if (!/^[0-9a-f-]{36}$/i.test(USER ?? '')) { console.error('--user <uuid> is required'); process.exit(2); }

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('SUPABASE_URL and a service key are required in the environment (dotenvx run --)'); process.exit(2); }
const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);  // 20261015T150600
const logPath = arg('--log', path.join(os.homedir(), 'nuke-logs', `quarantine-gate-rejected-${stamp.slice(0, 8)}`,
  `${APPLY ? 'apply' : 'dry-run'}-${stamp}.jsonl`));
fs.mkdirSync(path.dirname(logPath), { recursive: true });
const log = fs.createWriteStream(logPath, { flags: 'a' });
const write = (rec) => log.write(JSON.stringify({ at: new Date().toISOString(), ...rec }) + '\n');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isTimeout = (e) => /57014|statement timeout|canceling statement/i.test(e?.message ?? '');

// One created_at window of this user's rows; a window that times out is split in half, down to one hour.
async function readWindow(from, to, out) {
  const { data, error } = await sb.from('vehicle_images')
    .select('id, vehicle_id, vision_gate_status, source, created_at, taken_at, file_hash, is_superseded')
    .eq('user_id', USER)
    .gte('created_at', from.toISOString()).lt('created_at', to.toISOString())
    .in('vision_gate_status', GATE_REJECTED)
    .not('vehicle_id', 'is', null)
    .neq('vehicle_id', QUARANTINE)
    .order('created_at', { ascending: true })
    .limit(1000);
  if (error) {
    if (isTimeout(error) && to - from > 3600e3) {
      const mid = new Date(from.getTime() + Math.floor((to - from) / 2));
      await readWindow(from, mid, out); await readWindow(mid, to, out); return;
    }
    throw new Error(`read ${from.toISOString()}..${to.toISOString()}: ${error.message}`);
  }
  if (data.length === 1000) {  // a full page: split so nothing past the page is skipped
    const mid = new Date(from.getTime() + Math.floor((to - from) / 2));
    if (to - from <= 3600e3) throw new Error(`more than 1000 rows in one hour at ${from.toISOString()}`);
    await readWindow(from, mid, out); await readWindow(mid, to, out); return;
  }
  for (const row of data) if (row.is_superseded !== true) out.push(row);
  await sleep(150);
}

const { data: inQuarantine, error: qErr } = await sb.from('vehicle_images')
  .select('file_hash').eq('vehicle_id', QUARANTINE).not('file_hash', 'is', null).limit(5000);
if (qErr) { console.error(`quarantine read: ${qErr.message}`); process.exit(1); }
const quarantineHashes = new Set(inQuarantine.map((r) => r.file_hash));

const candidates = [];
const month = 31 * 24 * 3600e3;
for (let t = FROM.getTime(); t < TO.getTime(); t += month) {
  await readWindow(new Date(t), new Date(Math.min(t + month, TO.getTime())), candidates);
}

const summary = { user: USER, apply: APPLY, quarantine: QUARANTINE, log: logPath, candidates: candidates.length,
  by_gate: {}, by_source: {}, by_vehicle: {}, predicted_refusal_file_in_quarantine: 0,
  moved: 0, refused: {}, failed: 0 };
const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
for (const row of candidates) {
  bump(summary.by_gate, row.vision_gate_status); bump(summary.by_source, row.source); bump(summary.by_vehicle, row.vehicle_id);
  if (row.file_hash && quarantineHashes.has(row.file_hash)) summary.predicted_refusal_file_in_quarantine++;
}

let attempted = 0;
for (const row of candidates) {
  const base = { image_id: row.id, from_vehicle_id: row.vehicle_id, gate: row.vision_gate_status, source: row.source,
    created_at: row.created_at, taken_at: row.taken_at };
  if (!APPLY) {
    write({ ...base, action: 'would_relink',
      predicted: row.file_hash && quarantineHashes.has(row.file_hash) ? 'file_hash_exists_on_target' : 'relink' });
    continue;
  }
  if (attempted >= LIMIT) break;
  attempted++;
  const reason = `vision gate ${row.vision_gate_status} on a photo still filed on ${row.vehicle_id}: moved to the intake `
    + `quarantine until evidence places it (scripts/quarantine-gate-rejected.mjs)`;
  const { data: res, error } = await sb.rpc('relink_testimony', {
    p_observation_type: 'image', p_observation_id: row.id, p_target_vehicle_id: QUARANTINE, p_reason: reason,
    p_actor_user_id: null,
  });
  if (error) { summary.failed++; write({ ...base, action: 'relink', error: error.message.slice(0, 200) }); }
  else if (res?.success) { summary.moved++; write({ ...base, action: 'relink', result: res }); }
  else { bump(summary.refused, res?.error ?? 'unknown'); write({ ...base, action: 'relink', refused: res?.error ?? 'unknown' }); }
  await sleep(150);  // vehicle_id moves fire the heavy per-row triggers; one statement at a time, paced
}

summary.by_vehicle = Object.fromEntries(Object.entries(summary.by_vehicle).sort((a, b) => b[1] - a[1]).slice(0, 15));
write({ summary });
log.end();
console.log(JSON.stringify(summary, null, 2));
