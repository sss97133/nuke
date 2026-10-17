#!/usr/bin/env node
/**
 * scripts/bat-corrections/project-bat-results.mjs
 *
 * Projects BaT results already on record in auction_events onto the vehicles rows that lag them, through
 * project_bat_result_to_vehicle (migration 20261018041000) and so through correct_vehicle_sale_provenance_batch: every
 * field cited to auction_events/<id>, the original kept, a concurrent writer winning (stale). Never lowers a value.
 *
 *   dotenvx run -q -- node scripts/bat-corrections/project-bat-results.mjs --from 2026-09-01 --to 2026-10-19
 *       dry run (the default): finds the lagging lots per auction_end_date window (3 days, indexed) and asks the
 *       function for each plan (p_apply false). Nothing is written.
 * Only a final with a second witness is projected: a page-read receipt in extraction_metadata, a cited correction in
 * the vehicle's sale_provenance_corrections, or the stream's native sale_result observation (BaT's own "Sold on … for
 * USD $X to …" record), carrying the same amount. The rest are logged as unwitnessed.
 *   ... --profile   applies one batch inside a transaction that is rolled back: statuses and time per call
 *   ... --apply     applies, --batch rows per call (default 20, at most 1000), --pace-ms between calls (default 3000)
 *   ... --log-dir   JSONL logs (default ~/nuke-logs/bat-close-projection-20261016)
 *
 * Reads run inside `begin read only` with statement_timeout 9 s; each write call sets statement_timeout 9 s (the
 * vehicles trigger chain costs ~0.1-0.5 s a row, so a batch stays small). After each call it checks lock waiters and
 * pauses while there are more than two. Needs SUPABASE_ACCESS_TOKEN.
 */
import { mkdirSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const PROJECT = 'qkgaybvrernstplzjaam';
const ASSERTED_BY = 'scripts/bat-corrections/project-bat-results.mjs';
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const APPLY = args.includes('--apply');
const PROFILE = args.includes('--profile');
const FROM = opt('--from', '2026-09-01');
const TO = opt('--to', new Date(Date.now() + 2 * 86400e3).toISOString().slice(0, 10));
const BATCH = Math.min(Math.max(Number(opt('--batch', '20')) || 20, 1), 1000);
const PACE_MS = Math.max(Number(opt('--pace-ms', '3000')) || 3000, 1000);
const LOG_DIR = opt('--log-dir', resolve(homedir(), 'nuke-logs', 'bat-close-projection-20261016'));
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
if (!isDay(FROM) || !isDay(TO) || FROM >= TO) { console.error('usage: --from YYYY-MM-DD --to YYYY-MM-DD'); process.exit(2); }
if (APPLY && PROFILE) { console.error('--apply or --profile, not both'); process.exit(2); }
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error('SUPABASE_ACCESS_TOKEN is not set (run under dotenvx)'); process.exit(2); }

mkdirSync(LOG_DIR, { recursive: true });
const mode = APPLY ? 'apply' : PROFILE ? 'profile' : 'plan';
const LOG = resolve(LOG_DIR, `${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
const log = (o) => appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(query, attempt = 1) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (res.status === 429 || res.status >= 500 || /ThrottlerException/.test(text)) {
    if (attempt >= 8) throw new Error(`gave up after ${attempt} attempts (${res.status}): ${text.slice(0, 200)}`);
    await sleep(15000 * attempt);
    return api(query, attempt + 1);
  }
  let rows = null;
  try { rows = JSON.parse(text); } catch { /* below */ }
  if (!res.ok || !Array.isArray(rows)) throw new Error(`query failed (${res.status}): ${text.slice(0, 400)}`);
  await sleep(1000);
  return rows;
}
const read = (sql) => api(`begin read only; set local statement_timeout = '9s'; ${sql}; commit;`);
const isUuid = (u) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(u);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

// The lagging lots of one window: a BaT result whose vehicles row is that listing and holds less than the final, or a
// sold result whose sale is not on that row (no price, a lower price, or a status other than sold).
const lagging = (lo, hi) => read(`
  select a.id event_id, a.vehicle_id, a.outcome,
         greatest(coalesce(a.winning_bid,0), coalesce(a.high_bid,0)) final,
         greatest(coalesce(v.high_bid,0), coalesce(v.sale_price,0)) vehicle_value, v.sale_price, v.sale_status,
         -- a second witness of the final: a page-read receipt (extraction_metadata) or a cited correction carrying it
         (exists (select 1 from extraction_metadata m where m.vehicle_id = v.id and m.field_name in ('high_bid','sale_price')
                    and m.field_value ~ '^[0-9]+(\\.[0-9]+)?$'
                    and m.field_value::numeric = greatest(coalesce(a.winning_bid,0), coalesce(a.high_bid,0)))
          or exists (select 1 from jsonb_array_elements(coalesce(v.provenance_metadata->'sale_provenance_corrections','[]')) c
                    where c->>'field' in ('high_bid','sale_price') and c->>'corrected' ~ '^[0-9]+(\\.[0-9]+)?$'
                      and (c->>'corrected')::numeric = greatest(coalesce(a.winning_bid,0), coalesce(a.high_bid,0)))
          -- or BaT's own record as the stream received it ("Sold on 10/9/26 for USD $103,000.00 to PIDI")
          or exists (select 1 from vehicle_observations o where o.vehicle_id = v.id and o.kind = 'sale_result'
                    and o.extraction_method = 'bat_public_live_v1'
                    and o.source_url in (rtrim(a.source_url,'/'), rtrim(a.source_url,'/') || '/')
                    and replace(substring(o.content_text from 'USD \\$([0-9,]+)'), ',', '')::numeric
                        = greatest(coalesce(a.winning_bid,0), coalesce(a.high_bid,0)))) witnessed
  from auction_events a join vehicles v on v.id = a.vehicle_id and v.deleted_at is null
  where a.source = 'bat' and a.outcome in ('sold','reserve_not_met')
    and a.auction_end_date >= '${lo}' and a.auction_end_date < '${hi}'
    and rtrim(v.listing_url,'/') = rtrim(a.source_url,'/')
    and (greatest(coalesce(v.high_bid,0), coalesce(v.sale_price,0)) < greatest(coalesce(a.winning_bid,0), coalesce(a.high_bid,0))
         -- a sold lot whose sale is not on the vehicle: no price, a lower price, or a status other than sold
         or (a.outcome = 'sold' and (v.sale_price is null or v.sale_price < greatest(coalesce(a.winning_bid,0), coalesce(a.high_bid,0))
                                     or v.sale_status is distinct from 'sold')))
  order by a.auction_end_date, a.id`);

const ids = [];
for (let d = FROM; d < TO; d = addDays(d, 3)) {
  const hi = addDays(d, 3) < TO ? addDays(d, 3) : TO;
  const rows = await lagging(d, hi);
  for (const r of rows) { ids.push(r); log({ lagging: r }); }
  if (rows.length) console.error(`${d}..${hi}: ${rows.length} lagging`);
}
const unwitnessed = ids.filter((r) => !r.witnessed);
for (const r of unwitnessed) log({ unwitnessed: r });
const todo = ids.filter((r) => r.witnessed);
const summary = { mode, from: FROM, to: TO, lagging: ids.length, unwitnessed: unwitnessed.map((r) => r.event_id), sold: ids.filter((r) => r.outcome === 'sold').length,
  reserve_not_met: ids.filter((r) => r.outcome === 'reserve_not_met').length, statuses: {}, calls: 0, ms: [] };

for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH).map((r) => r.event_id).filter(isUuid);
  const arr = `array[${batch.map((u) => `'${u}'::uuid`).join(',')}]`;
  const apply = APPLY || PROFILE;
  const body = `select e id, public.project_bat_result_to_vehicle(e, ${apply}, '${ASSERTED_BY}') r from unnest(${arr}) e`;
  const t0 = Date.now();
  const sql = PROFILE
    ? `begin; set local statement_timeout = '9s'; create temp table zz_projection as select clock_timestamp() t0, x.* from (${body}) x; select id, r, extract(epoch from clock_timestamp() - (select min(t0) from zz_projection)) * 1000 ms from zz_projection; rollback;`
    : APPLY ? `set statement_timeout = '9s'; ${body}` : `begin read only; set local statement_timeout = '9s'; ${body}; commit;`;
  const out = await api(sql);
  const ms = Date.now() - t0;
  summary.calls += 1; summary.ms.push(ms);
  for (const row of out) {
    const status = row.r?.status ?? 'unknown';
    summary.statuses[status] = (summary.statuses[status] ?? 0) + 1;
    log({ batch: i / BATCH, ms, event_id: row.id, result: row.r, db_ms: row.ms ?? null });
  }
  console.error(`batch ${i / BATCH}: ${out.length} rows in ${ms} ms ` + JSON.stringify(summary.statuses));
  if (APPLY) {
    for (let waits = 0; ; waits++) {
      const lw = Number((await api(`select count(*) as n from pg_stat_activity where wait_event_type = 'Lock'`))[0]?.n ?? 0);
      if (lw <= 2) break;
      if (waits >= 10) { log({ stop: `lock waiters ${lw}` }); process.exit(3); }
      await sleep(60000);
    }
    await sleep(ms > 10000 ? Math.max(PACE_MS, ms * 2) : PACE_MS);
  }
  if (PROFILE) break;   // one batch is the profile
}
log({ done: summary });
console.log(JSON.stringify({ ...summary, log: LOG }, null, 2));
