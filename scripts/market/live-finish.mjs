#!/usr/bin/env node
// Where Bring a Trailer's live auctions should finish, written to the prediction ledger as model 32.
//
// For each public live BaT lot on the homepage board (market_pulse_live, read with the anon key so no private record
// is ever priced), scripts/market/live-finish.py finds the finished BaT lots that looked most like it at the same
// hours to close (same no-reserve flag, a near bid, a near position of the bid against where its model page usually
// finishes; same page, make and model year preferred) in the local BaT archive, and estimates the finish as the bid
// times their weighted median rise, with an 80% range calibrated per hours to close, no-reserve flag and grade.
// The board reads the rows through live_finish_estimates() (migration 20261015100000).
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
writeFileSync(pulseJson, JSON.stringify(pulse));
const live = Array.isArray(pulse?.auctions) ? pulse.auctions.length : 0;

// 2. estimates from the archive (local, read-only)
const now = new Date();
execFileSync('python3', [PY, '--lots', pulseJson, '--archive', ARCHIVE, '--cache', CACHE, '--coverage', COVERAGE, '--now', now.toISOString(), '--out', outJson],
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
if (DRY) {
  console.log(JSON.stringify({ dry_run: true, live, estimated: rows.length, skipped: skipped.length, would_write: out.length,
    sample: out.slice(0, 3).map((r) => ({ vehicle_id: r.vehicle_id, bid: r.current_bid, hours: r.hours_remaining,
      estimate: r.predicted_hammer, low: r.predicted_low, high: r.predicted_high })) }));
} else {
  for (let i = 0; i < out.length; i += 500) {
    await rest('hammer_predictions', { method: 'POST', body: out.slice(i, i + 500), prefer: 'return=minimal' });
  }
  console.log(JSON.stringify({ live, estimated: rows.length, skipped: skipped.length, already_current: rows.length - due.length, written: out.length }));
}
