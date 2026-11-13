#!/usr/bin/env node
// Where Bring a Trailer's live auctions should finish, written to the prediction ledger as model 32.
//
// For each public live BaT lot on the homepage board (market_pulse_live, read with the anon key so no private record
// is ever priced), scripts/market/live-finish.py finds the finished BaT lots that looked most like it at the same
// hours to close (same no-reserve flag, a near bid, a near position of the bid against where its model page usually
// finishes; same page, make and model year preferred) in the local BaT archive, and estimates the finish as the bid
// times their weighted median rise, with an 80% range calibrated per hours to close, no-reserve flag and grade.
// The board reads the rows through live_finish_estimates() (migration 20261015100000; other houses 20261111220000).
// Another house's open lots (market_pulse_live_houses) are estimated the same way, moved by that house's own replay
// (live-finish-houses.py, the "houses" block of live-finish-coverage.json), and only for a house and hours it passed.
//
// Measured offline (2026-10-15, report kept with the session logs): on 25,673 car lots closed 2026-04..09, never used
// for tuning, the median miss was 16.7% a day before the close and 11.7% at ten minutes, and 80% ranges held 79-80%;
// replayed on 1,106 production lots closed 09-28..10-14: 16.2% and 80.8%. The board's model 31 band: 27%.
//
// Write rule: a lot gets a row at first sight, when its bid changed since its latest model 32 row, or when it crossed
// a calibration horizon (120, 72, 48, 24, 12, 6, 3, 1 h, 10 min); about 3,000-3,500 rows a day instead of one per lot
// per hour. When nothing qualifies, the lot closing soonest is written, so the reader's two-hour freshness check
// (no rows at all from a stopped writer) holds.
//
// Run: npm run market:live-finish            (writes to prod via the service key)
//      npm run market:live-finish -- --dry-run  (reads only; prints what it would write)
// Needs: python3 with numpy and pandas, the duckdb CLI, and the local archive (not in git): BAT_ARCHIVE=/path/to/
// bat-archive.duckdb, default scripts/data/bat-archive.duckdb. The estimator caches derived tables per archive file
// (LIVE_FINISH_CACHE, default ~/Library/Caches/nuke-market-live-finish); the first run on a new archive builds it.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY = process.argv.includes('--dry-run');
if (!URL || !ANON || (!SERVICE && !DRY)) throw new Error('VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required (dotenvx run --)');
const MODEL_VERSION = 32;
const HORIZONS = [120, 72, 48, 24, 12, 6, 3, 1, 1 / 6];
const PY = join(dirname(fileURLToPath(import.meta.url)), 'live-finish.py');
// The latest production measurement of the ranges per match mode and grade; it caps the confidence wording.
const COVERAGE = join(dirname(fileURLToPath(import.meta.url)), 'live-finish-coverage.json');
const ARCHIVE = resolve(process.env.BAT_ARCHIVE || 'scripts/data/bat-archive.duckdb');
const CACHE = process.env.LIVE_FINISH_CACHE || join(homedir(), 'Library', 'Caches', 'nuke-market-live-finish');
mkdirSync(CACHE, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'live-finish-'));
const pulseJson = join(dir, 'pulse.json');
const outJson = join(dir, 'rows.json');

const rest = async (path, { key = SERVICE, method = 'GET', body, prefer } = {}) => {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path.slice(0, 80)}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 || res.headers.get('content-length') === '0' ? null : res.json();
};

// 1. the public live board
const pulse = await rest('rpc/market_pulse_live', { key: ANON, method: 'POST', body: {} });
const now = new Date(pulse?.synced_at ?? NaN);
if (!Number.isFinite(now.getTime())) throw new Error('market_pulse_live has no synced_at; nothing is written without the source time');
const batCols = Array.isArray(pulse?.columns) ? pulse.columns : null;
const lotsIn = (Array.isArray(pulse?.auctions) ? pulse.auctions : []).map((a) => batCols
  ? { ...Object.fromEntries(batCols.map((c, i) => [c, a[i]])), house: 'bringatrailer' } : a);
// 1b. the other houses' open lots (market_pulse_live_houses, anon), only for the houses whose own backtest passed
// (live-finish-coverage.json "houses", written by live-finish-houses.py; collecting-cars and ebay-motors say why not).
// Each is read at its house reader's last successful read (live_auction_sources, service key; the board's newest lot
// write for that house in a dry run): the bid as the house showed it then, its hours to close counted from then.
const houses = JSON.parse(readFileSync(COVERAGE, 'utf8')).houses ?? {};
const shown = Object.keys(houses).filter((h) => houses[h].show);
const perHouse = {};
if (shown.length && batCols) {
  const hp = await rest('rpc/market_pulse_live_houses', { key: ANON, method: 'POST', body: {} });
  const readAt = Object.fromEntries((hp?.houses ?? []).map((h) => [h.house, h.read_at]));
  if (!DRY) {
    const src = await rest(`live_auction_sources?select=slug,last_successful_sync&slug=in.(${shown.join(',')})`);
    for (const s of src ?? []) if (s.last_successful_sync) readAt[s.slug] = s.last_successful_sync;
  }
  for (const a of hp?.auctions ?? []) {
    const lot = Object.fromEntries(hp.columns.map((c, i) => [c, a[i]]));
    if (!shown.includes(lot.house) || !readAt[lot.house]) continue;
    lotsIn.push({ ...lot, as_of: new Date(readAt[lot.house]).toISOString() });
    perHouse[lot.house] = (perHouse[lot.house] ?? 0) + 1;
  }
}
writeFileSync(pulseJson, JSON.stringify(batCols ? lotsIn : pulse));
const live = lotsIn.length;
// The lots prod lists as motorcycles (vehicles.canonical_vehicle_type, anon-readable) are never priced as cars.
const kindsJson = join(dir, 'kinds.json');
const ids = lotsIn.map((a) => (Array.isArray(a) ? a[0] : a.id)).filter(Boolean);
const kinds = {};
for (let i = 0; i < ids.length; i += 200) {
  const got = await rest(`vehicles?select=id,canonical_vehicle_type&id=in.(${ids.slice(i, i + 200).join(',')})`, { key: ANON });
  for (const v of got ?? []) if (v.canonical_vehicle_type) kinds[v.id] = v.canonical_vehicle_type;
}
writeFileSync(kindsJson, JSON.stringify(kinds));

// 2. estimates from the archive (local, read-only)
// The moment comes from the source, never a machine's clock: the board's synced_at is the latest read of BaT's live
// page (sync-live-auctions, every 15 min), so a row says "the bid as BaT showed it then" and its hours to close are
// counted from then. A stalled sync makes the rows age out of live_finish_estimates() instead of passing as fresh.
// (2026-11-07: the Mac's clock ran 3 h 35 min slow and every row was stamped hours early.) (now: step 1.) Another
// house's lot carries its own read moment (as_of, step 1b).
execFileSync('python3', [PY, '--lots', pulseJson, '--kinds', kindsJson, '--archive', ARCHIVE, '--cache', CACHE, '--coverage', COVERAGE, '--now', now.toISOString(), '--out', outJson],
  { stdio: ['ignore', 'inherit', 'inherit'] });
// The estimator writes {rows, skipped} (each skipped lot with its reason); an older build wrote the row list alone, with
// the skipped lots beside it.
const parsed = JSON.parse(readFileSync(outJson, 'utf8'));
const rows = Array.isArray(parsed) ? parsed : (parsed.rows ?? []);
let skipped = Array.isArray(parsed) ? [] : (parsed.skipped ?? []);
if (Array.isArray(parsed)) {
  for (const f of [`${outJson}.skipped.json`, outJson.replace(/\.json$/, '.skipped.json')]) {
    try { skipped = JSON.parse(readFileSync(f, 'utf8')); break; } catch { /* try the other name */ }
  }
}

// 3. the write rule, against each lot's latest model 32 row
const latest = new Map();
const key = DRY ? ANON : SERVICE;
if (!DRY) {
  for (let i = 0; i < rows.length; i += 200) {
    const ids = rows.slice(i, i + 200).map((r) => r.vehicle_id).join(',');
    const prior = await rest(`hammer_predictions?select=vehicle_id,current_bid,hours_remaining,predicted_at&model_version=eq.${MODEL_VERSION}&vehicle_id=in.(${ids})&order=predicted_at.desc`, { key });
    for (const p of prior ?? []) if (!latest.has(p.vehicle_id)) latest.set(p.vehicle_id, p);
  }
}
const crossed = (before, after) => HORIZONS.some((h) => before > h && after <= h);
const due = rows.filter((r) => {
  const p = latest.get(r.vehicle_id);
  return !p || Number(p.current_bid) !== Number(r.current_bid)
    || (p.hours_remaining != null && r.hours_remaining != null && crossed(Number(p.hours_remaining), Number(r.hours_remaining)));
});
if (due.length === 0 && rows.length > 0) due.push([...rows].sort((a, b) => Number(a.hours_remaining) - Number(b.hours_remaining))[0]);
const out = due.map((r) => ({ ...r, model_version: MODEL_VERSION, time_window: 'live',
  notes: typeof r.notes === 'string' ? r.notes : JSON.stringify(r.notes ?? {}) }));

// 4. write
const houseOf = new Map(lotsIn.flatMap((a) => (Array.isArray(a) || a.house === 'bringatrailer' ? [] : [[a.id, a.house]])));
const byHouse = Object.fromEntries(Object.entries(perHouse).map(([h, n]) => [h, { live: n,
  estimated: rows.filter((r) => houseOf.get(r.vehicle_id) === h).length, written: out.filter((r) => houseOf.get(r.vehicle_id) === h).length }]));
if (DRY) {
  console.log(JSON.stringify({ dry_run: true, live, houses: byHouse, estimated: rows.length, skipped: skipped.length, would_write: out.length,
    sample: out.slice(0, 3).map((r) => ({ vehicle_id: r.vehicle_id, bid: r.current_bid, hours: r.hours_remaining,
      estimate: r.predicted_hammer, low: r.predicted_low, high: r.predicted_high })) }));
} else {
  for (let i = 0; i < out.length; i += 500) {
    await rest('hammer_predictions', { method: 'POST', body: out.slice(i, i + 500), prefer: 'return=minimal' });
  }
  console.log(JSON.stringify({ live, houses: byHouse, estimated: rows.length, skipped: skipped.length, already_current: rows.length - due.length, written: out.length }));
}
