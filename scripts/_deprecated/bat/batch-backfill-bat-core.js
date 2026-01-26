#!/usr/bin/env node
/**
 * Batch backfill for BaT vehicles using the `extract-bat-core` Edge Function.
 *
 * Goal:
 * - Fix polluted spec fields (engine_size/color/transmission garbage)
 * - Ensure raw listing description history exists (extraction_metadata.raw_listing_description)
 *
 * Usage:
 *   node scripts/batch-backfill-bat-core.js --limit 100 --concurrency 1
 *
 * Notes:
 * - Uses anon JWT from nuke_frontend/scripts/test-orgs-query.js (never prints it).
 * - Reads via PostgREST (RLS must allow reads; production does).
 * - Writes happen inside the Edge Function using service role.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';

function parseArgs(argv) {
  const out = { limit: 100, concurrency: 1, onlyPolluted: false, onlyMissingDesc: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') out.limit = Number(argv[++i] || '100');
    else if (a === '--concurrency') out.concurrency = Number(argv[++i] || '1');
    else if (a === '--only-polluted') out.onlyPolluted = true;
    else if (a === '--only-missing-desc') out.onlyMissingDesc = true;
  }
  if (!Number.isFinite(out.limit) || out.limit <= 0) out.limit = 100;
  if (!Number.isFinite(out.concurrency) || out.concurrency <= 0) out.concurrency = 1;
  out.concurrency = Math.min(5, Math.max(1, Math.floor(out.concurrency)));
  return out;
}

function readAnonJwt() {
  const candidate = path.join(process.cwd(), 'nuke_frontend', 'scripts', 'test-orgs-query.js');
  const src = readFileSync(candidate, 'utf8');
  const jwtMatch = src.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/);
  if (!jwtMatch) throw new Error('anon JWT not found in nuke_frontend/scripts/test-orgs-query.js');
  return jwtMatch[0];
}

function canonicalizeUrl(u) {
  try {
    const url = new URL(u);
    url.hash = '';
    url.search = '';
    if (url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1);
    return url.toString();
  } catch {
    const base = String(u || '').split('#')[0].split('?')[0];
    return base.endsWith('/') ? base.slice(0, -1) : base;
  }
}

function isBatUrl(u) {
  const s = String(u || '').toLowerCase();
  return s.includes('bringatrailer.com/listing/');
}

function looksLikeBatBoilerplate(t) {
  const s = String(t || '').toLowerCase();
  return (
    s.includes('for sale on bat auctions') ||
    s.includes('bring a trailer') ||
    s.includes('bringatrailer.com') ||
    s.includes('sold for $') ||
    s.includes('(lot #') ||
    s.includes('lot #') ||
    s.includes('auction preview') ||
    s.includes('| bring a trailer') ||
    s.includes('|')
  );
}

function wordCount(t) {
  return String(t || '').trim().split(/\s+/).filter(Boolean).length;
}

function looksLikeEngineSpec(t) {
  const s = String(t || '');
  return (
    /\b\d+(?:\.\d+)?-?\s*Liter\b/i.test(s) ||
    /\b\d+(?:\.\d+)?\s*L\b/i.test(s) ||
    /\bV\d\b/i.test(s) ||
    /\b[0-9,]{3,5}\s*cc\b/i.test(s) ||
    /\b\d{2,3}\s*ci\b/i.test(s) ||
    /\bcubic\s+inch\b/i.test(s) ||
    /\bflat[-\s]?four\b/i.test(s) ||
    /\bflat[-\s]?six\b/i.test(s) ||
    /\binline[-\s]?(?:three|four|five|six)\b/i.test(s) ||
    /\binline[-\s]?\d\b/i.test(s) ||
    /\bv-?twin\b/i.test(s)
  );
}

function looksLikeTransmissionSpec(t) {
  const s = String(t || '');
  return (
    /\b(transmission|transaxle|gearbox)\b/i.test(s) ||
    /\b(manual|automatic)\b/i.test(s) ||
    /\b(cvt|dct)\b/i.test(s) ||
    /\bdual[-\s]?clutch\b/i.test(s) ||
    /\b(\d{1,2}-speed|four-speed|five-speed|six-speed|seven-speed|eight-speed|nine-speed|ten-speed)\b/i.test(s) ||
    /\b(th400|th350|4l60|4l80|zf|getrag|tiptronic|pdk)\b/i.test(s)
  );
}

function isPollutedSpec(field, val) {
  const t = String(val ?? '').trim().toLowerCase();
  if (!t) return false;
  if (t === 'var' || t === 'cycles') return true;
  if (looksLikeBatBoilerplate(t)) return true;
  if (t.length > 140) return true;
  if (field === 'transmission') {
    if (
      t.startsWith(',') ||
      t.includes('driving experien') ||
      t.includes('is said to have') ||
      t.includes('were removed sometime') ||
      (!looksLikeTransmissionSpec(t) && (wordCount(t) > 18 || t.length > 90)) ||
      (/[.!?]/.test(t) && t.length > 60)
    ) return true;
  }
  if (field === 'color') {
    if (t === 'var') return true;
    if (t.length > 80) return true;
  }
  if (field === 'engine_size') {
    if (t === 'cycles') return true;
    if (!looksLikeEngineSpec(t) && (wordCount(t) > 14 || t.length > 90)) return true;
    if (!looksLikeEngineSpec(t) && (t.includes('table') || t.includes('coffee'))) return true;
  }
  return false;
}

async function restSelect(anonJwt, table, query) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const resp = await fetch(url, {
    headers: { apikey: anonJwt, Authorization: `Bearer ${anonJwt}` },
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`REST ${table} HTTP ${resp.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return []; }
}

async function fetchAllBatVehicles(anonJwt) {
  const pageSize = 1000;
  let offset = 0;
  const out = [];
  while (true) {
    const query =
      'select=id,discovery_url,bat_auction_url,listing_url,engine_size,color,transmission,auction_end_date,updated_at' +
      '&or=(' +
      'discovery_url.ilike.*bringatrailer.com/listing/*,' +
      'bat_auction_url.ilike.*bringatrailer.com/listing/*' +
      ')' +
      `&order=auction_end_date.desc.nullslast,updated_at.desc.nullslast` +
      `&limit=${pageSize}&offset=${offset}`;
    const rows = await restSelect(anonJwt, 'vehicles', query);
    if (!Array.isArray(rows) || rows.length === 0) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

async function fetchRawDescVehicleIdSet(anonJwt) {
  const pageSize = 1000;
  let offset = 0;
  const set = new Set();
  while (true) {
    const query =
      'select=vehicle_id' +
      '&field_name=eq.raw_listing_description' +
      `&limit=${pageSize}&offset=${offset}`;
    const rows = await restSelect(anonJwt, 'extraction_metadata', query);
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) {
      if (r && r.vehicle_id) set.add(String(r.vehicle_id));
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return set;
}

async function invokeExtractBatCore(anonJwt, payload) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/extract-bat-core`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonJwt,
      Authorization: `Bearer ${anonJwt}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!resp.ok || data?.success === false) {
    throw new Error(`extract-bat-core HTTP ${resp.status}: ${JSON.stringify(data).slice(0, 400)}`);
  }
  return data;
}

async function runWithConcurrency(items, concurrency, worker) {
  let idx = 0;
  const results = [];
  const workers = Array.from({ length: concurrency }).map(async () => {
    while (true) {
      const cur = idx++;
      if (cur >= items.length) return;
      results[cur] = await worker(items[cur], cur);
    }
  });
  await Promise.all(workers);
  return results;
}

(async () => {
  const args = parseArgs(process.argv);
  const anonJwt = readAnonJwt();

  console.log(`Loading BaT vehicles...`);
  const batVehicles = await fetchAllBatVehicles(anonJwt);
  console.log(`Found ${batVehicles.length} BaT vehicles`);

  console.log(`Loading raw listing description ids...`);
  const rawDescSet = await fetchRawDescVehicleIdSet(anonJwt);
  console.log(`Found ${rawDescSet.size} vehicles with raw_listing_description`);

  const targets = [];
  for (const v of batVehicles) {
    const vehicleId = String(v.id);
    const url = String(v.bat_auction_url || v.discovery_url || v.listing_url || '').trim();
    if (!vehicleId || !isBatUrl(url)) continue;

    const missingDesc = !rawDescSet.has(vehicleId);
    const polluted =
      isPollutedSpec('engine_size', v.engine_size) ||
      isPollutedSpec('color', v.color) ||
      isPollutedSpec('transmission', v.transmission);

    const include =
      (args.onlyPolluted ? polluted : true) &&
      (args.onlyMissingDesc ? missingDesc : true) &&
      (args.onlyPolluted || args.onlyMissingDesc ? true : (missingDesc || polluted));

    if (!include) continue;
    targets.push({ vehicleId, url: canonicalizeUrl(url), missingDesc, polluted });
  }

  console.log(`Targets: ${targets.length} (missingDesc or polluted). Running limit=${args.limit}, concurrency=${args.concurrency}`);

  const batch = targets.slice(0, args.limit);
  let ok = 0;
  let fail = 0;

  await runWithConcurrency(batch, args.concurrency, async (t, i) => {
    const label = `[${i + 1}/${batch.length}]`;
    try {
      const data = await invokeExtractBatCore(anonJwt, { url: t.url, vehicle_id: t.vehicleId, prefer_snapshot: true });
      ok++;
      const method = String(data?.extraction_method || '');
      console.log(`${label} OK vehicle=${t.vehicleId} polluted=${t.polluted ? '1' : '0'} missingDesc=${t.missingDesc ? '1' : '0'} method=${method}`);
    } catch (e) {
      fail++;
      console.log(`${label} FAIL vehicle=${t.vehicleId} url=${t.url} err=${e?.message || String(e)}`);
    }
  });

  console.log(`Done. ok=${ok} fail=${fail}`);
  if (fail > 0) process.exitCode = 1;
})().catch((e) => {
  console.error(`Fatal: ${e?.message || String(e)}`);
  process.exit(1);
});

