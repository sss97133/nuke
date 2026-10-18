#!/usr/bin/env node
// Expected-price bands for Bring a Trailer's live auctions, written to the prediction ledger.
//
// For each public live BaT lot on the homepage board (market_pulse_live, read with the anon key so no
// private record is ever priced), match its title to a BaT model page learned from the local BaT archive,
// price it with the archive's CompBase band from title-only features, weighted toward the lot's own variant
// (scripts/market/live-bands.sql), and add one hammer_predictions row (model_version 31) for lots that don't
// have one yet. The homepage reads the band and computes hot/cold live from the current bid and the time left
// (migrations 20260927230000, 20260928000000). Version 30 (page-level comps) rows stay in the ledger for scoring.
//
// Measured 2026-09-27 on 9,365 recent car lots with their model page hidden: the title matches the right
// page 96.4% of the time (97.7% when one page holds >= 60% of the matches, 89% of lots). Version 31 bands on
// 10,065 cars sold 2026-06-27..09-26: 80% band caught 77.5%, 50% band 49.3%, median miss 25.5% (v30: 27.3%).
//
// Run: npm run market:live-bands   (writes to prod via the service key)
// The archive is local data (not in git): BAT_ARCHIVE=/path/to/bat-archive.duckdb, default scripts/data/bat-archive.duckdb.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) throw new Error('VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required (dotenvx run --)');
const MODEL_VERSION = 31;
const SQL_FILE = join(dirname(fileURLToPath(import.meta.url)), 'live-bands.sql');
const ARCHIVE = resolve(process.env.BAT_ARCHIVE || 'scripts/data/bat-archive.duckdb');
const dir = mkdtempSync(join(tmpdir(), 'live-bands-'));
const liveTsv = join(dir, 'live.tsv');
const bandsCsv = join(dir, 'bands.csv');

const rest = async (path, { key = SERVICE, method = 'GET', body, prefer } = {}) => {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 || res.headers.get('content-length') === '0' ? null : res.json();
};

// 1. the public live board
const pulse = await rest('rpc/market_pulse_live', { key: ANON, method: 'POST', body: {} });
const lots = (pulse?.auctions ?? []).map((r) => ({ id: r[0], bid: r[4], endsAt: Date.parse(r[5]), noReserve: r[9] === true, title: r[11] }))
  .filter((l) => l.title && l.endsAt > Date.now());
const clean = (s) => String(s).replace(/[\t\r\n]/g, ' ');
writeFileSync(liveTsv, lots.map((l) => [l.id, l.bid ?? '', l.noReserve, clean(l.title)].join('\t')).join('\n') + '\n');

// 2. bands from the archive (read-only)
const sql = readFileSync(SQL_FILE, 'utf8').replaceAll('__LIVE_TSV__', liveTsv).replaceAll('__BANDS_CSV__', bandsCsv);
execFileSync('duckdb', ['-readonly', ARCHIVE], { input: sql, stdio: ['pipe', 'inherit', 'inherit'] });
const [header, ...lines] = readFileSync(bandsCsv, 'utf8').trim().split('\n');
const cols = header.split(',');
const bands = lines.filter(Boolean).map((line) => Object.fromEntries(line.split(',').map((v, i) => [cols[i], v])));

// 3. only lots without a band of this version yet (the band is priced once, at first sight, from sales before it)
const byId = new Map(lots.map((l) => [l.id, l]));
const existing = new Set();
for (let i = 0; i < bands.length; i += 200) {
  const ids = bands.slice(i, i + 200).map((b) => b.vehicle_id).join(',');
  const rows = await rest(`hammer_predictions?select=vehicle_id&model_version=eq.${MODEL_VERSION}&vehicle_id=in.(${ids})`);
  for (const r of rows ?? []) existing.add(r.vehicle_id);
}
const tier = (p) => (p < 25000 ? 'a' : p < 50000 ? 'b' : p < 100000 ? 'c' : 'd');
const now = new Date();
const rows = bands.filter((b) => !existing.has(b.vehicle_id)).map((b) => {
  const lot = byId.get(b.vehicle_id);
  const p50 = Number(b.p50);
  return {
    vehicle_id: b.vehicle_id,
    current_bid: lot?.bid ?? 0,
    hours_remaining: lot ? Math.round(((lot.endsAt - now.getTime()) / 3600000) * 10) / 10 : null,
    time_window: 'live',
    price_tier: tier(p50),
    model_version: MODEL_VERSION,
    comp_median: p50,
    comp_count: Number(b.n_comps),
    predicted_hammer: p50,
    predicted_low: Number(b.p10),
    predicted_high: Number(b.p90),
    confidence_score: Number(b.share),
    predicted_at: now.toISOString(),
    notes: JSON.stringify({ method: 'title-only CompBase band, variant-weighted (live-bands.sql)', cohort: b.cohort,
                            match_share: Number(b.share), n_eff: Number(b.n_eff), p25: Number(b.p25), p75: Number(b.p75),
                            variant_level: Number(b.variant_level), variant_words: b.variant_words || null }),
  };
});
for (let i = 0; i < rows.length; i += 500) {
  await rest('hammer_predictions', { method: 'POST', body: rows.slice(i, i + 500), prefer: 'return=minimal' });
}
console.log(JSON.stringify({ live: lots.length, priced: bands.length, already_had_band: existing.size, inserted: rows.length }));
