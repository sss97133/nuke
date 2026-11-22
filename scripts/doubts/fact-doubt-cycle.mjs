#!/usr/bin/env node
// One bounded fire of the fact-doubt loop, run by subscription-reader-batch.sh on every full fire, so doubts are raised
// after ingestion and answered on the owner's subscription without an agent starting either script.
//   1. raise: raise-fact-doubts.mjs's main for up to --vehicles of the owner's vehicles, newest photo landings first, then
//      the rest round-robin (cursor in ~/nuke/logs/.fact-doubt-cursor). Raising is idempotent on the evidence state, so a
//      vehicle whose evidence did not change raises nothing.
//   2. answer: answer-fact-doubts.mjs's main, department-wide (--all-vehicles), up to --answer-limit pending doubts, on the
//      subscription reader (`claude -p`, no key). Each blind task is built from its own question row, so answering across
//      vehicles reads nothing of another question.
// Writes only through the two scripts' writers (raise_evidence_judgment, retire_evidence_judgment, claim_evidence_judgments,
// answer_evidence_judgment). Prints one JSON summary line (counts and ids only, never a value or a reader's words).
//   dotenvx run -q -f ~/nuke/.env -- node scripts/doubts/fact-doubt-cycle.mjs --owner <uuid> [--vehicles 3]
//        [--answer-limit 6] [--window-hours 24] [--out file.json] [--dry-run]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { client, arg } from './db.mjs';
import { main as raiseMain } from './raise-fact-doubts.mjs';
import { main as answerMain } from './answer-fact-doubts.mjs';

const UUID36 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Vehicles to raise this fire: recent landings first, then round-robin after the cursor, no repeats, at most n. */
export function pickVehicles({ recent, all, cursor, n }) {
  const out = [];
  const add = (id) => { if (out.length < n && UUID36.test(id ?? '') && !out.includes(id)) out.push(id); };
  for (const id of recent) add(id);
  const sorted = [...new Set(all)].filter((id) => UUID36.test(id)).sort();
  const start = cursor ? sorted.findIndex((id) => id > cursor) : 0;
  const order = start < 0 ? sorted : [...sorted.slice(start), ...sorted.slice(0, start)];
  let next = cursor ?? null;
  for (const id of order) {
    if (out.length >= n) break;
    if (!out.includes(id)) { add(id); next = id; }
  }
  return { vehicles: out, cursor: next };
}

export async function main(argv = process.argv.slice(2), env = process.env, deps = {}) {
  const owner = arg(argv, '--owner'); const n = Number(arg(argv, '--vehicles', 3));
  const answerLimit = Number(arg(argv, '--answer-limit', 6)); const windowHours = Number(arg(argv, '--window-hours', 24));
  const dry = argv.includes('--dry-run'); const out = arg(argv, '--out');
  if (!UUID36.test(owner ?? '')) throw new Error('--owner <uuid> required');
  if (!(n >= 0 && n <= 20) || !(answerLimit >= 0 && answerLimit <= 50)) throw new Error('--vehicles 0..20, --answer-limit 0..50');
  const db = deps.db ?? client(env);
  const raise = deps.raise ?? raiseMain; const answer = deps.answer ?? answerMain;
  const cursorFile = deps.cursorFile ?? join(homedir(), 'nuke', 'logs', '.fact-doubt-cursor');
  const summary = { cli: 'fact-doubt-cycle', dry_run: dry, vehicles: [], raised: 0, existing: 0, retired: 0, skipped_no_frames: 0,
    answered: 0, answered_value: 0, failed: 0, pending_before: 0, errors: 0, error_classes: {}, stopped: null };
  const err = (cls) => { summary.errors++; summary.error_classes[cls] = (summary.error_classes[cls] ?? 0) + 1; };

  // 1. raise
  const since = new Date(Date.now() - windowHours * 3600e3).toISOString();
  const owned = await db.req(`vehicles?select=id&or=(user_id.eq.${owner},owner_id.eq.${owner})&deleted_at=is.null&limit=2000`);
  const ownedSet = new Set(owned.map((v) => v.id));
  const landed = await db.req(`vehicle_images?select=vehicle_id&user_id=eq.${owner}&created_at=gte.${since}&vehicle_id=not.is.null&order=created_at.desc&limit=1000`);
  const recent = [...new Set(landed.map((r) => r.vehicle_id))].filter((id) => ownedSet.has(id));
  let cursor = null; try { cursor = readFileSync(cursorFile, 'utf8').trim() || null; } catch { /* first fire */ }
  const pick = pickVehicles({ recent, all: [...ownedSet], cursor, n });
  for (const vehicleId of pick.vehicles) {
    try {
      const s = await raise(['--vehicle', vehicleId, ...(dry ? ['--dry-run'] : [])], env);
      const actions = s.doubts.map((d) => String(d.action));
      const line = { vehicle_id: vehicleId, recent: recent.includes(vehicleId), doubts: s.doubts.length,
        raised: actions.filter((a) => a === 'inserted' || a === 'revived' || a === 'would_raise').length, retired: s.retired, skipped_no_frames: s.skipped_no_frames.length, errors: s.errors.length };
      summary.raised += line.raised; summary.existing += actions.filter((a) => a.startsWith('exists') || a === 'unchanged').length;
      summary.retired += s.retired; summary.skipped_no_frames += line.skipped_no_frames;
      if (s.errors.length) err('raise_item');
      summary.vehicles.push(line);
    } catch (e) { err('raise_vehicle'); summary.vehicles.push({ vehicle_id: vehicleId, error: String(e.message).slice(0, 120) }); }
  }
  if (!dry && pick.cursor) { try { mkdirSync(dirname(cursorFile), { recursive: true }); writeFileSync(cursorFile, pick.cursor); } catch { err('cursor'); } }

  // 2. answer (department-wide, subscription)
  if (answerLimit > 0) {
    try {
      const a = await answer(['--all-vehicles', '--limit', String(answerLimit), '--provider', 'subscription', ...(dry ? ['--dry-run'] : [])], env);
      summary.pending_before = a.pending_for_vehicle ?? 0;
      summary.answered = a.answered.filter((x) => x.outcome || x.would_ask).length;
      summary.answered_value = a.answered.filter((x) => x.outcome === 'value').length;
      summary.failed = a.failed.length;
      // why answers failed, as classes: the first words of an infrastructure error with ids and numbers removed, or
      // refused_locally for an answer the local validator refused (its problems can name a read value, so they stay out)
      for (const f of a.failed) {
        const cls = f.problems ? 'refused_locally' : `answer: ${String(f.error ?? 'unknown').replace(/[0-9a-f-]{36}|\d+/gi, '#').slice(0, 60)}`;
        summary.error_classes[cls] = (summary.error_classes[cls] ?? 0) + 1;
      }
      if (a.stopped) summary.stopped = String(a.stopped).slice(0, 120);
    } catch (e) { err('answer'); summary.stopped = String(e.message).slice(0, 120); }
  }
  // a receipt file only when the fire did something (the wrapper keeps no empty files)
  const did = summary.raised + summary.retired + summary.answered + summary.failed + summary.errors > 0;
  if (out && did) { try { writeFileSync(out, JSON.stringify(summary)); } catch { err('out'); } }
  return summary;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((s) => { console.log(JSON.stringify(s)); process.exitCode = s.errors ? 1 : 0; })
    .catch((e) => { console.error(String(e.message).slice(0, 200)); process.exitCode = 1; });
}
