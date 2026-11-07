#!/usr/bin/env node
// Stores first-person chat statements as owner_statement_v1 testimony through the SQL writer record_owner_statement.
// Dry-run by default: prints what each statement would resolve to and the facts parsed from it; nothing is written.
//
//   dotenvx run -- node scripts/garage/ingest-owner-statements.mjs --user <uuid> --file statements.jsonl
//   dotenvx run -- node scripts/garage/ingest-owner-statements.mjs --user <uuid> --file statements.jsonl --apply
//
// Input: JSON lines, one statement each: {"message_id": "<chat message id>", "text": "<quoted words>",
//   "observed_at": "<iso, optional>", "vehicle_hint": {"year":..,"make":..,"model":..,"vin":..} | [ {..}, {..} ]}
// A missing hint gets a VIN (17 characters) and/or a four-digit year read from the text; nothing else is guessed.
// source_ref is "chat_message:<message_id>". Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (run under dotenvx).
// The call is a top-level PostgREST RPC with the service-role key; the function is idempotent per (account, source_ref, vehicle).
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const user = opt('user'); const file = opt('file'); const apply = args.includes('--apply');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!user || !uuid.test(user) || !file) { console.error('usage: --user <uuid> --file <statements.jsonl> [--apply]'); process.exit(2); }
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required (run under dotenvx)'); process.exit(2); }

export function hintFromText(text) {
  const hint = {};
  const vin = text.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i); if (vin) hint.vin = vin[0].toUpperCase();
  const year = text.match(/\b(19[2-9]\d|20[0-4]\d)\b/); if (year) hint.year = Number(year[1]);
  return hint;
}

const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
let failed = 0;
for (const [i, line] of lines.entries()) {
  let row; try { row = JSON.parse(line); } catch { console.error(`line ${i + 1}: not JSON`); failed++; continue; }
  if (!row.message_id || !row.text) { console.error(`line ${i + 1}: message_id and text required`); failed++; continue; }
  const hint = row.vehicle_hint ?? hintFromText(row.text);
  const res = await fetch(`${url}/rest/v1/rpc/record_owner_statement`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_user: user, p_text: row.text, p_source_ref: `chat_message:${row.message_id}`,
      p_observed_at: row.observed_at ?? new Date().toISOString(), p_vehicle_hint: hint, p_dry_run: !apply }),
  });
  if (!res.ok) { console.error(`message ${row.message_id}: ${res.status} ${await res.text()}`); failed++; continue; }
  for (const r of await res.json()) {
    console.log(`${apply ? 'stored ' : 'would store '} message ${row.message_id}: ${r.resolution}` +
      `${r.vehicle_id ? ` -> ${r.vehicle_id}` : ''} candidates=${(r.candidates ?? []).length} facts=${JSON.stringify(r.facts)}` +
      `${r.observation_id ? ` observation=${r.observation_id}` : ''}`);
  }
}
if (!apply) console.log('dry run: nothing written (pass --apply to store)');
process.exit(failed ? 1 : 0);
