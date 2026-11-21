#!/usr/bin/env node
/**
 * Refreshes the stored class price (vehicle_class_price) for an account's garage, or for listed vehicles, through the
 * service-role RPC refresh_vehicle_class_prices (migration 20261121073000). Re-runs the vehicles whose cohort is not yet
 * classified until every one is complete, nothing moves, or --rounds is spent. Writes only through that function.
 *
 *   dotenvx run -q -- node scripts/data/refresh-class-prices.mjs --user <account uuid> [--out results.json]
 *   dotenvx run -q -- node scripts/data/refresh-class-prices.mjs --ids <uuid,uuid,...> [--out results.json]
 *
 * --user reads the vehicles from get_user_garage(<account>) as the service role (every relationship the account holds).
 * Options: --batch <n> ids per call (default 40), --budget <ms> per call (default 40000), --rounds <n> (default 40).
 * Prints one line per vehicle with its final status, then a summary. The key is read from the environment, never printed.
 */
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) { console.error('SUPABASE_SERVICE_ROLE_KEY is not set (run under dotenvx run)'); process.exit(2); }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const batch = Math.min(Math.max(Number(opt('batch', 40)) || 40, 1), 500);
const budget = Math.min(Math.max(Number(opt('budget', 40000)) || 40000, 1000), 45000);
const rounds = Math.max(Number(opt('rounds', 40)) || 40, 1);

async function rpc(fn, body) {
  const started = Date.now();
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn} answered ${res.status} after ${Date.now() - started} ms: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

let ids;
if (opt('user')) {
  if (!uuid.test(opt('user'))) { console.error('--user must be a uuid'); process.exit(2); }
  const garage = await rpc('get_user_garage', { p_user_id: opt('user') });
  ids = [...new Set(garage.map(row => row.vehicle_id))];
  console.log(`get_user_garage: ${ids.length} vehicles`);
} else if (opt('ids')) {
  ids = [...new Set(opt('ids').split(',').map(s => s.trim()).filter(Boolean))];
  if (ids.some(id => !uuid.test(id))) { console.error('--ids must be uuids'); process.exit(2); }
} else {
  console.error('usage: refresh-class-prices.mjs --user <uuid> | --ids <uuid,...> [--out file] [--batch n] [--budget ms] [--rounds n]');
  process.exit(2);
}

const latest = new Map();
let pending = ids;
for (let round = 1; round <= rounds && pending.length; round++) {
  let moved = 0;
  for (let i = 0; i < pending.length; i += batch) {
    const chunk = pending.slice(i, i + batch);
    const t0 = Date.now();
    const rows = await rpc('refresh_vehicle_class_prices', { p_vehicle_ids: chunk, p_budget_ms: budget });
    for (const { vehicle_id, result } of rows) {
      // Progress is a changed answer (status, k of n, price); the call's own timing is not progress.
      const strip = r => r && JSON.stringify({ ...r, ms: undefined, classified_this_call: undefined });
      if (result.status !== 'not_reached' && (strip(latest.get(vehicle_id)) !== strip(result) || result.classified_this_call > 0)) moved++;
      latest.set(vehicle_id, result);
    }
    const done = rows.filter(r => r.result.complete).length;
    console.log(`round ${round}: ${chunk.length} sent, ${done} complete, ${Date.now() - t0} ms`);
  }
  pending = ids.filter(id => !latest.get(id)?.complete);
  if (!moved) { console.log(`round ${round}: nothing moved; stopping with ${pending.length} incomplete`); break; }
}

const results = ids.map(id => latest.get(id) ?? { vehicle_id: id, status: 'not_reached', complete: false });
for (const r of results) {
  console.log([r.vehicle_id, r.status, r.value ?? '', r.value_low != null ? `${r.value_low}-${r.value_high}` : '', r.n ?? '',
    r.reason ?? '', r.cohort ?? ''].join('\t'));
}
const by = results.reduce((acc, r) => { const k = r.complete ? r.status : `${r.status} (incomplete)`; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
console.log(`summary of ${results.length}: ${JSON.stringify(by)}`);
if (opt('out')) writeFileSync(opt('out'), JSON.stringify({ at: new Date().toISOString(), ids: ids.length, results }, null, 1));
