#!/usr/bin/env node
/**
 * scripts/bat-corrections/supersede-live-end-events.mjs
 *
 * Retires the BaT end events extract-bat-core wrote for RUNNING lots before 4.5.0: auction_ended rows created before
 * the end they name ("BaT ended • bid to $X", dated the scheduled end, priced at the bid of that read). Each row goes
 * whole into superseded_rows through the sanctioned writer supersede_timeline_events, naming the listing's end row read
 * after the close as its replacement when one exists. Nothing is edited or deleted outside that writer.
 * Migration 20261016203000_supersede_timeline_events.sql defines the writer and the plan.
 *
 *   dotenvx run -q -- node scripts/bat-corrections/supersede-live-end-events.mjs --from 2026-01-01 --to 2026-11-01
 *       dry run (the default): plans each event_date day with plan_bat_live_end_supersessions, logs every planned row,
 *       prints the counts by class. Nothing is written.
 *   ... --inline       plans with the migration file's own plan query (read only), for before the migration is deployed
 *   ... --apply        calls supersede_timeline_events for the planned rows, --batch rows per call (default 50)
 *   ... --log-dir DIR  JSONL logs (default ~/nuke-logs/bat-ended-20261015)
 *
 * Run --apply only after extract-bat-core 4.5.0 is deployed: the older extractor inserts the row again on its next
 * read of a running lot. Re-running is safe: a retired row is no longer planned, and the writer answers 'already'.
 * Reads run inside `begin read only` through the Supabase Management API (as readme-stats.mjs does); each write call
 * sets statement_timeout 30 s; after each call it checks for lock waiters and pauses while there are more than two.
 * Needs SUPABASE_ACCESS_TOKEN.
 */
import { readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATION = resolve(ROOT, 'supabase/migrations/20261016203000_supersede_timeline_events.sql');
const PROJECT = 'qkgaybvrernstplzjaam';
const ASSERTED_BY = 'scripts/bat-corrections/supersede-live-end-events.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const APPLY = args.includes('--apply');
const INLINE = args.includes('--inline');
const FROM = opt('--from', '2025-01-01');
const TO = opt('--to', new Date(Date.now() + 30 * 86400e3).toISOString().slice(0, 10));
const BATCH = Math.min(Math.max(Number(opt('--batch', '50')) || 50, 1), 500);
const LOG_DIR = opt('--log-dir', resolve(homedir(), 'nuke-logs', 'bat-ended-20261015'));
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
if (!isDay(FROM) || !isDay(TO) || FROM >= TO) { console.error('usage: --from YYYY-MM-DD --to YYYY-MM-DD (from < to)'); process.exit(2); }
if (APPLY && INLINE) { console.error('--apply plans with the deployed function; drop --inline'); process.exit(2); }

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error('SUPABASE_ACCESS_TOKEN is not set (run under dotenvx)'); process.exit(2); }

mkdirSync(LOG_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const LOG = resolve(LOG_DIR, `${APPLY ? 'apply' : 'plan'}-${stamp}.jsonl`);
const log = (o) => appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(query, attempt = 1) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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

// --inline: the plan function's own body from the migration, its parameters bound as literals.
const isUuid = (u) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(u);
function inlinePlan(from, to, limit, after) {
  const body = readFileSync(MIGRATION, 'utf8').match(/AS \$plan\$\n([\s\S]*?)\n\$plan\$;/)?.[1];
  if (!body) throw new Error(`plan body not found in ${MIGRATION}`);
  return `set local "TimeZone" = 'UTC'; ` + body.replace(/\bp_from\b/g, `'${from}'::date`)
    .replace(/\bp_to\b/g, `'${to}'::date`).replace(/\bp_limit\b/g, String(limit))
    .replace(/\bp_after\b/g, after ? `'${after}'::uuid` : 'NULL::uuid');
}
// One page of the plan, in id order after the cursor. A statement timeout (the 9 s read bound; the DB is IO-starved)
// is retried once warm, then the page shrinks (100 → 25 → 5); a page that still times out is reported, not guessed.
async function planPage(from, to, after) {
  for (const limit of [100, 100, 25, 5]) {
    if (after && !isUuid(after)) throw new Error(`bad cursor ${after}`);
    const sql = INLINE ? inlinePlan(from, to, limit, after)
      : `select public.plan_bat_live_end_supersessions('${from}'::date, '${to}'::date, ${limit}, ${after ? `'${after}'::uuid` : 'NULL'}) as plan`;
    try {
      const rows = await read(sql);
      const out = INLINE ? Object.values(rows[0] ?? {})[0] : rows[0]?.plan;
      return { rows: Array.isArray(out) ? out : [], limit };
    } catch (e) {
      if (!/57014/.test(String(e?.message))) throw e;
      console.error(`${from}: plan page timed out at limit ${limit}; retrying`);
      await sleep(5000);
    }
  }
  return null;
}
async function plan(from, to) {
  const all = [];
  let after = null;
  for (;;) {
    const page = await planPage(from, to, after);
    if (!page) { log({ unplanned: { day: from, after } }); result.unplanned_days.push(from); break; }
    all.push(...page.rows);
    if (page.rows.length < page.limit) break;
    after = page.rows[page.rows.length - 1].event_id;
  }
  return all;
}

const nextDay = (d) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400e3).toISOString().slice(0, 10);
const counts = {};
const result = { planned: 0, retired: 0, already: 0, missing: 0, stale: 0, refused: 0, referenced: 0, unplanned_days: [] };
log({ run: { apply: APPLY, inline: INLINE, from: FROM, to: TO, batch: BATCH } });

for (let day = FROM; day < TO; day = nextDay(day)) {
  const rows = await plan(day, nextDay(day));
  if (!rows.length) continue;
  result.planned += rows.length;
  for (const r of rows) {
    counts[r.class] = (counts[r.class] ?? 0) + 1;
    log({ planned: r });
  }
  if (!APPLY) { console.error(`${day}: ${rows.length} planned`); continue; }
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map(({ event_id, expected_vehicle_id, expected_event_type, replacement_event_id, source, reason }) =>
      ({ event_id, expected_vehicle_id, expected_event_type, replacement_event_id, source, reason }));
    const payload = JSON.stringify(batch);
    if (payload.includes('$j$')) throw new Error('payload contains the dollar-quote tag');
    const out = await api(`set statement_timeout = '30s'; select public.supersede_timeline_events($j$${payload}$j$::jsonb, '${ASSERTED_BY}') as r`);
    const r = out[0]?.r ?? {};
    log({ day, batch: i / BATCH, result: r });
    result.retired += Number(r.retired ?? 0);
    for (const k of ['already', 'missing', 'stale', 'refused', 'referenced']) result[k] += (r[k] ?? []).length;
    console.error(`${day} batch ${i / BATCH}: retired ${r.retired ?? 0} of ${batch.length}` +
      ['already', 'missing', 'stale', 'refused', 'referenced'].map((k) => (r[k]?.length ? `, ${k} ${r[k].length}` : '')).join(''));
    for (let waits = 0; ; waits++) {
      const lw = Number((await api(`select count(*) as n from pg_stat_activity where wait_event_type = 'Lock'`))[0]?.n ?? 0);
      if (lw <= 2) break;
      if (waits >= 10) { log({ stop: `lock waiters ${lw} after ${waits} pauses` }); console.error(`lock waiters ${lw}; stopping`); process.exit(3); }
      console.error(`lock waiters ${lw}; pausing 60s`); await sleep(60000);
    }
  }
}
log({ done: { counts, ...result } });
console.log(JSON.stringify({ apply: APPLY, from: FROM, to: TO, by_class: counts, ...result, log: LOG }, null, 2));
