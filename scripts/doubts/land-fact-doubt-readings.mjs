#!/usr/bin/env node
// Lands readable fact-doubt answers as keyed readings. Reads fact_doubt_readings_to_land (20261124193100: answered value
// doubts not yet landed, one witness photo each) and posts each to ingest-observation, the sanctioned writer, as method
// fact_doubt_reread_v1 (buildReadingObservation). Idempotent: a landed request (or a re-ask that read the same value with
// the same model) is not listed again, and the writer dedupes a replay. Run by fact-doubt-cycle.mjs after its answer step.
// Prints counts only, never a value.
//   dotenvx run -q -f ~/nuke/.env -- node scripts/doubts/land-fact-doubt-readings.mjs [--limit 50] [--dry-run]
import { fileURLToPath } from 'node:url';
import { client, arg } from './db.mjs';
import { buildReadingObservation } from './fact-doubts.mjs';

export async function main(argv = process.argv.slice(2), env = process.env, deps = {}) {
  const limit = Number(arg(argv, '--limit', 50)); const dry = argv.includes('--dry-run');
  if (!(limit >= 0 && limit <= 200)) throw new Error('--limit 0..200');
  const db = deps.db ?? client(env);
  const out = { listed: 0, landed: 0, duplicate: 0, refused: 0, failed: 0, refusal_classes: {}, observation_ids: [], dry_run: dry };
  const rows = limit ? await db.rpc('fact_doubt_readings_to_land', { p_limit: limit }) : [];
  out.listed = rows.length;
  const refuse = (cls) => { out.refused++; out.refusal_classes[cls] = (out.refusal_classes[cls] ?? 0) + 1; };
  for (const row of rows) {
    let body;
    try { body = buildReadingObservation(row); } catch { refuse('row_shape'); continue; }
    if (dry) continue;
    try {
      const r = await db.fn('ingest-observation', body);
      if (r.ok && r.json?.observation_id) { if (r.json.duplicate) out.duplicate++; else out.landed++; out.observation_ids.push(r.json.observation_id); }
      // the writer's refusal as a class: its first words with ids and digits removed (a refusal never quotes the value)
      else if (r.status >= 400 && r.status < 500) refuse(`${r.status}: ${String(r.json?.error ?? 'refused').replace(/[0-9a-f-]{36}|\d+/gi, '#').slice(0, 60)}`);
      else out.failed++;
    } catch { out.failed++; }
  }
  return out;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((s) => { console.log(JSON.stringify(s)); process.exitCode = s.failed ? 1 : 0; })
    .catch((e) => { console.error(String(e.message).slice(0, 200)); process.exitCode = 1; });
}
