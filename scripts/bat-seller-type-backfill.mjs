#!/usr/bin/env node
/**
 * scripts/bat-seller-type-backfill.mjs
 *
 * Plans auction_events.seller_type for BaT lots already read, from BaT's own "Private Party or Dealer" line in the
 * lot-page HTML we saved (listing_page_snapshots.html). Reads saved snapshots only; it never fetches bat.com.
 * It uses the same parser as extract-bat-core (supabase/functions/_shared/batSellerType.ts).
 *
 *   dotenvx run -q -- node scripts/bat-seller-type-backfill.mjs [--from ISO] [--to ISO] [--batch 100] [--max-rows 2000]
 *                                                              [--out ~/nuke-logs/bat-seller-type-20261020/plan.jsonl]
 *
 * DRY RUN ONLY. There is no --apply: no sanctioned writer for auction_events.seller_type exists yet (the existing
 * auction_events writers each take one field: correct_auction_event_dates, correct_auction_event_link). The script
 * prints counts and writes a JSONL plan, one line per lot to set:
 *   {event_id, vehicle_id, source_url, snapshot_id, snapshot_sha256, fetched_at, party_type_raw, seller_type,
 *    expected_seller_type: null}
 * `expected_seller_type: null` is the compare-and-set value a writer must check (only rows still NULL are planned).
 * Snapshot URLs end in '/', auction_events.source_url does not (older rows may also be http://: those count as noEvent).
 * Only the latest snapshot per lot in the window counts. Rows whose line is absent or unrecognized are counted, not
 * planned; their raw text is in the plan's `unrecognized` lines so a new BaT wording is visible.
 *
 * Reads run in `begin read only` with statement_timeout 25 s, keyset-paged on (fetched_at, id), paced 1 s apart.
 * Needs SUPABASE_ACCESS_TOKEN (run under dotenvx).
 */
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { readBatPartyLine } from '../supabase/functions/_shared/batSellerType.ts';

const PROJECT = 'qkgaybvrernstplzjaam';
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
if (args.includes('--apply')) { console.error('no --apply: no sanctioned writer for auction_events.seller_type exists yet (see header)'); process.exit(2); }
const FROM = opt('--from', new Date(Date.now() - 2 * 86400e3).toISOString());
const TO = opt('--to', new Date().toISOString());
const BATCH = Math.min(Math.max(Number(opt('--batch', '100')) || 100, 1), 300);
const MAX_ROWS = Math.min(Math.max(Number(opt('--max-rows', '2000')) || 2000, 1), 20000);
const OUT = opt('--out', resolve(homedir(), 'nuke-logs', 'bat-seller-type-20261020', 'plan.jsonl'));
const isTs = (t) => !Number.isNaN(Date.parse(t));
if (!isTs(FROM) || !isTs(TO) || Date.parse(FROM) >= Date.parse(TO)) { console.error('usage: --from ISO --to ISO (from < to)'); process.exit(2); }
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error('SUPABASE_ACCESS_TOKEN is not set (run under dotenvx)'); process.exit(2); }

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, '');
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
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

const c = { snapshots: 0, lots: 0, withLine: 0, noLine: 0, recognized: 0, unrecognized: 0, noEvent: 0, alreadySet: 0, planned: 0,
  private: 0, dealer: 0 };
const latestByUrl = new Map();
let cursor = null; // [fetched_at, id]
let scanned = 0;
while (scanned < MAX_ROWS) {
  const after = cursor ? `and (lps.fetched_at, lps.id) > (${lit(cursor[0])}::timestamptz, ${lit(cursor[1])}::uuid)` : '';
  const rows = await api(`begin read only; set local statement_timeout = '25s';
    select lps.id, lps.fetched_at, lps.listing_url, lps.html_sha256,
           substring(lps.html from '(?i)Private\\s+Party\\s+or\\s+Dealer.{0,250}') as snippet,
           ae.id as event_id, ae.vehicle_id, ae.seller_type as current_seller_type
      from listing_page_snapshots lps
      left join auction_events ae on ae.source = 'bat' and ae.source_url = regexp_replace(lps.listing_url, '/+$', '')
     where lps.platform = 'bat' and lps.success and lps.html is not null
       and lps.listing_url like '%/listing/%'
       and lps.fetched_at >= ${lit(FROM)}::timestamptz and lps.fetched_at < ${lit(TO)}::timestamptz ${after}
     order by lps.fetched_at, lps.id limit ${BATCH}; commit;`);
  if (!rows.length) break;
  for (const r of rows) {
    c.snapshots++;
    const prev = latestByUrl.get(`${r.listing_url}|${r.event_id}`);
    if (!prev || prev.fetched_at < r.fetched_at) latestByUrl.set(`${r.listing_url}|${r.event_id}`, r);
  }
  const last = rows[rows.length - 1];
  cursor = [last.fetched_at, last.id];
  scanned += rows.length;
  if (rows.length < BATCH) break;
}

for (const r of latestByUrl.values()) {
  c.lots++;
  const line = readBatPartyLine(r.snippet);
  if (!line.party_type_raw) { c.noLine++; continue; }
  c.withLine++;
  if (!line.seller_type) {
    c.unrecognized++;
    appendFileSync(OUT, JSON.stringify({ unrecognized: true, source_url: r.listing_url, snapshot_id: r.id, party_type_raw: line.party_type_raw }) + '\n');
    continue;
  }
  c.recognized++;
  c[line.seller_type]++;
  if (!r.event_id) { c.noEvent++; continue; }
  if (r.current_seller_type) { c.alreadySet++; continue; }
  c.planned++;
  appendFileSync(OUT, JSON.stringify({
    event_id: r.event_id, vehicle_id: r.vehicle_id, source_url: r.listing_url, snapshot_id: r.id, snapshot_sha256: r.html_sha256,
    fetched_at: r.fetched_at, party_type_raw: line.party_type_raw, seller_type: line.seller_type, expected_seller_type: null,
  }) + '\n');
}

console.log(JSON.stringify({ mode: 'dry-run (plan only; no writer)', window: [FROM, TO], rows_scanned: scanned, ...c, plan: OUT }, null, 2));
