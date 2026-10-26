#!/usr/bin/env node
/**
 * Photo work ledger, stage 2: land readings from read-photos.mjs through record_photo_work_readings (service role).
 *
 *   dotenvx run -- node scripts/photo-work-ledger/ingest-readings.mjs --person <uuid> --readings readings.jsonl \
 *     [--batch 200] [--pause-ms 1500] [--tier 1] [--dry-run]
 *
 * Load budget: one RPC of at most --batch readings at a time, --pause-ms between calls, stop on the first error.
 * The writer is idempotent per image, pass and tier, so a rerun lands only what is missing.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const person = arg('person'); const file = arg('readings');
if (!/^[0-9a-f-]{36}$/i.test(person ?? '') || !file) { console.error('usage: --person <uuid> --readings <jsonl>'); process.exit(2); }
const size = Math.min(Number(arg('batch', 200)), 500); const pause = Number(arg('pause-ms', 1500));
const tier = Number(arg('tier', 1)); const dry = Boolean(arg('dry-run', false));

const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.reading && r.pass)
  .map(r => ({ image_id: r.id, model: r.model, pass: r.pass, tier, reading: r.reading, usage: r.usage }));
console.error(`${rows.length} readings in ${file}`);
if (dry) process.exit(0);

const sb = createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });
const total = { received: 0, recorded: 0, already_recorded: 0, refused: 0, assets_created: 0, sightings_recorded: 0 };
for (let i = 0; i < rows.length; i += size) {
  const t0 = Date.now();
  const { data, error } = await sb.rpc('record_photo_work_readings', { p_person: person, p_readings: rows.slice(i, i + size) });
  if (error) { console.error(`batch at ${i} failed: ${error.message}`); process.exit(1); }
  for (const k of Object.keys(total)) total[k] += data[k] ?? 0;
  console.error(`${i + size > rows.length ? rows.length : i + size}/${rows.length} ${Date.now() - t0} ms ${JSON.stringify(data)}`);
  await new Promise(r => setTimeout(r, pause));
}
console.log(JSON.stringify(total));
