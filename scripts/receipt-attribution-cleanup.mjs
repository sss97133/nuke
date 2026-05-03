#!/usr/bin/env node
/**
 * WS-8: Receipt Attribution Cleanup
 *
 * Heuristically attributes receipts that have no vehicle_id and no
 * submitted_observation_id, then submits them via ingest-observation as
 * `expense` observations under source_slug='receipt-scan' (registered by WS-3).
 *
 * Heuristics, in order, stop at first match with confidence >= 0.6:
 *   1. raw_text vehicle mention   (MUSTANG, K5, K10, BLAZER, CHARGER...)  -> 0.85
 *   2. line-item parts hints      (289 V8 -> Mustang; 350 small block ->  -> 0.75
 *      K5/K10; "diesel" -> trucks)
 *   3. merchant pattern + scope   (Mustang-only / V8-only merchants)      -> 0.70
 *   4. date proximity to vehicle photo activity (single match in ±3 day  -> 0.80
 *      window across observed_at on vehicle_observations.kind='media')
 *
 * Below 0.6 -> log to output/receipt-attribution-2026-05-03.log, do NOT submit.
 *
 * Usage:
 *   dotenvx run -- node scripts/receipt-attribution-cleanup.mjs --dry-run
 *   dotenvx run -- node scripts/receipt-attribution-cleanup.mjs --limit=200
 *   dotenvx run -- node scripts/receipt-attribution-cleanup.mjs              # full run
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1], 10) : null;

const SKYLAR_USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';
const LOG_PATH = path.resolve(process.cwd(), 'output/receipt-attribution-2026-05-03.log');
const INGEST_URL = `${SUPABASE_URL}/functions/v1/ingest-observation`;

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------- Heuristic configuration ----------

// Vehicle aliases for raw_text scanning. Each entry: pattern -> set of
// candidate vehicle filters (year/make/model). At resolution time, we map to
// a vehicle_id by querying Skylar's vehicles table.
const TEXT_HINTS = [
  { re: /\bMUSTANG\b/i,           hint: { make: 'Ford', modelLike: 'Mustang' }, conf: 0.85 },
  { re: /\bELEANOR\b/i,           hint: { make: 'Ford', modelLike: 'eleanor' }, conf: 0.95 },
  { re: /\b(K-?5|K5\b|BLAZER)\b/i, hint: { modelLike: 'Blazer' },              conf: 0.80 },
  { re: /\bK-?10\b/i,             hint: { modelLike: 'K10' },                   conf: 0.80 },
  { re: /\bK-?20\b/i,             hint: { modelLike: 'K20' },                   conf: 0.80 },
  { re: /\bK-?30\b/i,             hint: { modelLike: 'K30' },                   conf: 0.80 },
  { re: /\bC-?10\b/i,             hint: { modelLike: 'C10' },                   conf: 0.80 },
  { re: /\bSUBURBAN\b/i,          hint: { modelLike: 'Suburban' },              conf: 0.75 },
  { re: /\bCHARGER\b/i,           hint: { make: 'Dodge', modelLike: 'Charger' },conf: 0.80 },
  { re: /\bBRONCO\b/i,            hint: { make: 'Ford', modelLike: 'Bronco' },  conf: 0.75 },
  { re: /\bCAMARO\b/i,            hint: { make: 'Chevrolet', modelLike: 'Camaro' }, conf: 0.75 },
  { re: /\bCHEVELLE\b/i,          hint: { make: 'Chevrolet', modelLike: 'Chevelle' }, conf: 0.75 },
  { re: /\bCORVETTE\b/i,          hint: { make: 'Chevrolet', modelLike: 'Corvette' }, conf: 0.75 },
  { re: /\bCHEYENNE\b/i,          hint: { trimLike: 'Cheyenne' },               conf: 0.65 },
];

// Line-item / parts hints. Lower confidence — engine code alone isn't proof.
const PART_HINTS = [
  { re: /\b289\b.*\bV-?8\b/i,                hint: { make: 'Ford', modelLike: 'Mustang' }, conf: 0.65 },
  { re: /\b289\s+(?:HiPo|cobra)/i,           hint: { make: 'Ford', modelLike: 'Mustang' }, conf: 0.75 },
  { re: /\b302\s+(?:V-?8|cleveland|windsor)/i, hint: { make: 'Ford' },                       conf: 0.55 }, // too generic, will be filtered
  { re: /\b351\s+(?:cleveland|windsor)/i,    hint: { make: 'Ford' },                       conf: 0.55 },
  { re: /\b350\s+(?:V-?8|small\s*block)/i,   hint: { make: 'Chevrolet' },                   conf: 0.55 },
  { re: /\bdiesel\b/i,                        hint: { isTruck: true },                       conf: 0.55 },
];

// Merchant patterns. Tuple: regex over vendor_name, candidate filter, conf.
// For these to fire, OTHER signals (text/parts) must already implicate a
// candidate set. Standalone merchant alone is weak — we cap at 0.70 only when
// it narrows the field to a single vehicle.
const MERCHANT_NARROW = [
  { re: /\bMOPAR\b/i,                hint: { make: 'Dodge' },     conf: 0.70 },
  { re: /\bCJ\s*Pony\s*Parts\b/i,    hint: { make: 'Ford', modelLike: 'Mustang' }, conf: 0.70 },
  { re: /\bMustangs?\s*(?:Unlimited|Plus|Etc)\b/i, hint: { make: 'Ford', modelLike: 'Mustang' }, conf: 0.75 },
  { re: /\bToms?\s*Off\s*Road\b/i,   hint: { make: 'Ford', modelLike: 'Bronco' }, conf: 0.65 }, // early Bronco specialist
  { re: /\bBlazer\s*Boss\b/i,        hint: { modelLike: 'Blazer' }, conf: 0.75 },
];

// ---------- Helpers ----------

let vehicleCache = null;
async function loadVehicles() {
  if (vehicleCache) return vehicleCache;
  const { data, error } = await sb
    .from('vehicles')
    .select('id, year, make, model, trim, vin')
    .eq('user_id', SKYLAR_USER_ID)
    .limit(2000);
  if (error) throw error;
  vehicleCache = data || [];
  return vehicleCache;
}

function isTruckModel(v) {
  const m = (v.model || '').toLowerCase();
  return /(\bk-?\d|\bc-?\d|blazer|bronco|suburban|f-?\d|silverado|sierra|truck|jimmy|ranchero|pickup)/.test(m);
}

function matchVehiclesToHint(hint, vehicles) {
  const matches = vehicles.filter((v) => {
    if (hint.make && !(v.make || '').toLowerCase().includes(hint.make.toLowerCase())) return false;
    if (hint.modelLike && !(v.model || '').toLowerCase().includes(hint.modelLike.toLowerCase())) return false;
    if (hint.trimLike && !(v.trim || '').toLowerCase().includes(hint.trimLike.toLowerCase())) return false;
    if (hint.isTruck && !isTruckModel(v)) return false;
    return true;
  });
  return matches;
}

function getReceiptText(receipt) {
  const re = receipt.raw_extraction || {};
  const parts = [];
  if (re.raw_text) parts.push(re.raw_text);
  // OCR blocks:
  const blocks = (re.ocr && re.ocr.blocks) || [];
  for (const b of blocks) if (b.text) parts.push(b.text);
  // line-item descriptions:
  const items = (re.what && re.what.items) || [];
  for (const i of items) if (i.description) parts.push(i.description);
  return parts.join(' \n ');
}

// Pre-cached photo-activity index per vehicle: array of timestamps (ms) for
// observations of kind='media' or 'work_record'.
let photoIndex = null;
async function loadPhotoIndex(vehicleIds) {
  if (photoIndex) return photoIndex;
  console.log(`Loading activity index for ${vehicleIds.length} vehicles (media + work_record)...`);
  const idx = new Map();
  // Page through in chunks of vehicles to avoid huge IN clauses
  const VCHUNK = 50;
  for (let i = 0; i < vehicleIds.length; i += VCHUNK) {
    const slice = vehicleIds.slice(i, i + VCHUNK);
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await sb
        .from('vehicle_observations')
        .select('vehicle_id, observed_at, kind')
        .in('vehicle_id', slice)
        .in('kind', ['media', 'work_record'])
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const o of data) {
        if (!o.vehicle_id || !o.observed_at) continue;
        const t = Date.parse(o.observed_at);
        if (Number.isNaN(t)) continue;
        let arr = idx.get(o.vehicle_id);
        if (!arr) { arr = []; idx.set(o.vehicle_id, arr); }
        arr.push(t);
      }
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }
  for (const arr of idx.values()) arr.sort((a, b) => a - b);
  photoIndex = idx;
  let totalEntries = 0;
  for (const arr of idx.values()) totalEntries += arr.length;
  console.log(`Activity index: ${idx.size} vehicles, ${totalEntries} timestamps.`);
  return photoIndex;
}

function activityNearDate(idx, vehicleId, dateMs, windowMs) {
  const arr = idx.get(vehicleId);
  if (!arr || arr.length === 0) return false;
  // binary search
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < dateMs - windowMs) lo = mid + 1;
    else if (arr[mid] > dateMs + windowMs) hi = mid - 1;
    else return true;
  }
  return false;
}

// ---------- Heuristic pipeline ----------

function tryTextHints(text, vehicles) {
  if (!text) return null;
  for (const h of TEXT_HINTS) {
    if (h.re.test(text)) {
      const cands = matchVehiclesToHint(h.hint, vehicles);
      if (cands.length === 1) {
        return { vehicleId: cands[0].id, confidence: h.conf, signal: 'raw_text', match: h.re.toString() };
      } else if (cands.length > 1) {
        // ambiguous — return candidate set to be narrowed by later heuristics
        return { vehicleId: null, candidates: cands, confidence: 0, signal: 'raw_text_ambiguous', match: h.re.toString() };
      }
    }
  }
  return null;
}

function tryPartHints(text, vehicles) {
  if (!text) return null;
  for (const h of PART_HINTS) {
    if (h.re.test(text)) {
      const cands = matchVehiclesToHint(h.hint, vehicles);
      if (cands.length === 1 && h.conf >= 0.6) {
        return { vehicleId: cands[0].id, confidence: h.conf, signal: 'part_hint', match: h.re.toString() };
      }
    }
  }
  return null;
}

function tryMerchantHint(vendorName, vehicles) {
  if (!vendorName) return null;
  for (const h of MERCHANT_NARROW) {
    if (h.re.test(vendorName)) {
      const cands = matchVehiclesToHint(h.hint, vehicles);
      if (cands.length === 1) {
        return { vehicleId: cands[0].id, confidence: h.conf, signal: 'merchant', match: h.re.toString() };
      }
    }
  }
  return null;
}

async function tryDateProximity(receipt, vehicles, idx) {
  const date = receipt.transaction_date;
  if (!date) return null;
  const dateMs = Date.parse(date);
  if (Number.isNaN(dateMs)) return null;
  const WINDOW = 3 * 24 * 60 * 60 * 1000; // ±3 days
  const hits = [];
  for (const v of vehicles) {
    if (activityNearDate(idx, v.id, dateMs, WINDOW)) hits.push(v.id);
  }
  if (hits.length === 1) {
    return { vehicleId: hits[0], confidence: 0.80, signal: 'date_proximity_singleton', match: `±3d of ${date}` };
  }
  return null;
}

// Combine: raw_text first, then refine ambiguous via merchant/parts/date.
async function attributeReceipt(receipt, vehicles, idx) {
  const text = getReceiptText(receipt);
  const vendor = receipt.vendor_name || '';

  // 1. Strong text mention
  const t = tryTextHints(text, vehicles);
  if (t && t.confidence >= 0.6 && t.vehicleId) return t;

  // 2. Part hints
  const p = tryPartHints(text, vehicles);
  if (p && p.confidence >= 0.6 && p.vehicleId) return p;

  // 3. Merchant narrow
  const m = tryMerchantHint(vendor, vehicles);
  if (m && m.confidence >= 0.6 && m.vehicleId) return m;

  // 4. Date proximity to single vehicle's activity
  const d = await tryDateProximity(receipt, vehicles, idx);
  if (d && d.confidence >= 0.6 && d.vehicleId) return d;

  // 5. Refine ambiguous text-hint candidate set with date proximity
  if (t && t.candidates && receipt.transaction_date) {
    const dateMs = Date.parse(receipt.transaction_date);
    if (!Number.isNaN(dateMs)) {
      const WINDOW = 3 * 24 * 60 * 60 * 1000;
      const inWindow = t.candidates.filter((v) => activityNearDate(idx, v.id, dateMs, WINDOW));
      if (inWindow.length === 1) {
        return {
          vehicleId: inWindow[0].id,
          confidence: 0.78,
          signal: 'raw_text_plus_date',
          match: t.match,
        };
      }
    }
  }

  return null;
}

// ---------- Submit observation ----------

async function submitObservation(receipt, attribution) {
  const re = receipt.raw_extraction || {};
  const items = (re.what && re.what.items) || [];
  const observedAt = receipt.transaction_date
    ? `${receipt.transaction_date}T00:00:00Z`
    : (receipt.created_at || new Date().toISOString());

  const structured_data = {
    vendor_name: receipt.vendor_name,
    vendor_address: re.who?.vendor_address ?? null,
    transaction_date: receipt.transaction_date,
    total_amount: receipt.total_amount,
    subtotal: receipt.subtotal,
    tax: receipt.tax_amount,
    invoice_number: receipt.invoice_number ?? receipt.transaction_number,
    line_items: items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      unit_price: i.unit_price,
      total_price: i.total_price,
      part_number: i.part_number ?? null,
      brand: i.brand ?? null,
      category: i.category ?? null,
    })),
    receipt_id: receipt.id,
    file_url: receipt.file_url,
    attribution: {
      method: 'ws8-heuristic',
      signal: attribution.signal,
      match: attribution.match,
      heuristic_confidence: attribution.confidence,
    },
  };

  // The 'receipt-scan' observation_source supports kinds:
  //   work_record (parts/labor), specification (titles/registrations), comment (misc)
  // Mirror WS-3's classifyKind logic.
  const haystack = [
    receipt.vendor_name ?? '',
    JSON.stringify(receipt.raw_extraction ?? {}),
  ].join(' ').toLowerCase();
  const DOC_KW = ['insurance','policy','premium','coverage','registration','title','dmv','license plate','smog cert','tag'];
  const PARTS_KW = ['part','battery','filter','oil','coolant','brake','tire','spark plug','belt','hose','rotor','engine','transmission'];
  const LABOR_KW = ['labor','service','install','repair','diagnose','tune','alignment','rotate','balance','mount','inspection','smog','hours','shop fee'];
  let kind = 'comment';
  if (DOC_KW.some((k) => haystack.includes(k))) kind = 'specification';
  else if (PARTS_KW.some((k) => haystack.includes(k))) kind = 'work_record';
  else if (LABOR_KW.some((k) => haystack.includes(k))) kind = 'work_record';

  const body = {
    source_slug: 'receipt-scan',
    kind,
    observed_at: observedAt,
    source_identifier: `receipt:${receipt.id}`,
    source_url: receipt.file_url,
    content_text: re.raw_text || null,
    structured_data,
    vehicle_id: attribution.vehicleId,
    extraction_method: 'ws8-heuristic-attribution',
    extraction_metadata: {
      heuristic: attribution.signal,
      heuristic_confidence: attribution.confidence,
      heuristic_match: attribution.match,
    },
  };

  const res = await fetch(INGEST_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  let json;
  try { json = JSON.parse(txt); } catch { json = { error: txt }; }
  if (!res.ok) {
    throw new Error(`ingest-observation ${res.status}: ${txt.slice(0, 300)}`);
  }
  return json;
}

async function markReceiptSubmitted(receiptId, observationId) {
  const { error } = await sb
    .from('receipts')
    .update({
      submitted_observation_id: observationId,
      submitted_at: new Date().toISOString(),
    })
    .eq('id', receiptId);
  if (error) throw error;
}

// ---------- Main ----------

async function fetchUnattributed() {
  const all = [];
  let from = 0;
  const PAGE = 500;
  while (true) {
    const { data, error } = await sb
      .from('receipts')
      .select('id, vendor_name, transaction_date, total_amount, subtotal, tax_amount, invoice_number, transaction_number, file_url, vehicle_id, scope_type, scope_id, raw_extraction, created_at, submitted_observation_id')
      .is('vehicle_id', null)
      .is('submitted_observation_id', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (LIMIT && all.length >= LIMIT) break;
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return LIMIT ? all.slice(0, LIMIT) : all;
}

async function main() {
  console.log(`WS-8 Receipt Attribution Cleanup (dry_run=${DRY_RUN}${LIMIT ? `, limit=${LIMIT}` : ''})`);
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  const logFh = fs.openSync(LOG_PATH, 'a');
  const logLine = (obj) => fs.writeSync(logFh, JSON.stringify(obj) + '\n');
  logLine({ event: 'run_start', at: new Date().toISOString(), dry_run: DRY_RUN, limit: LIMIT });

  const vehicles = await loadVehicles();
  console.log(`Loaded ${vehicles.length} vehicles for Skylar.`);

  const idx = await loadPhotoIndex(vehicles.map((v) => v.id));

  const receipts = await fetchUnattributed();
  console.log(`Fetched ${receipts.length} unattributed receipts.`);

  const stats = {
    total: receipts.length,
    attributed: 0,
    submitted: 0,
    skipped_low_confidence: 0,
    failed: 0,
    by_signal: {},
    by_vehicle: {},
    duplicates: 0,
  };

  let i = 0;
  for (const r of receipts) {
    i++;
    if (i % 100 === 0) console.log(`  progress: ${i}/${receipts.length}`);

    let attribution;
    try {
      attribution = await attributeReceipt(r, vehicles, idx);
    } catch (e) {
      stats.failed++;
      logLine({ event: 'attribute_error', receipt_id: r.id, error: String(e) });
      continue;
    }

    if (!attribution || attribution.confidence < 0.6) {
      stats.skipped_low_confidence++;
      logLine({
        event: 'skip_low_confidence',
        receipt_id: r.id,
        vendor: r.vendor_name,
        date: r.transaction_date,
        total: r.total_amount,
        scope_type: r.scope_type,
      });
      continue;
    }

    stats.attributed++;
    stats.by_signal[attribution.signal] = (stats.by_signal[attribution.signal] || 0) + 1;
    stats.by_vehicle[attribution.vehicleId] = (stats.by_vehicle[attribution.vehicleId] || 0) + 1;

    if (DRY_RUN) {
      logLine({
        event: 'would_submit',
        receipt_id: r.id,
        vendor: r.vendor_name,
        vehicle_id: attribution.vehicleId,
        signal: attribution.signal,
        confidence: attribution.confidence,
        match: attribution.match,
      });
      continue;
    }

    try {
      const result = await submitObservation(r, attribution);
      if (result.duplicate) stats.duplicates++;
      const obsId = result.observation_id || result.id;
      if (obsId) {
        await markReceiptSubmitted(r.id, obsId);
        stats.submitted++;
        logLine({
          event: 'submitted',
          receipt_id: r.id,
          observation_id: obsId,
          vehicle_id: attribution.vehicleId,
          signal: attribution.signal,
          confidence: attribution.confidence,
          duplicate: !!result.duplicate,
        });
      } else {
        stats.failed++;
        logLine({ event: 'submit_no_observation_id', receipt_id: r.id, response: result });
      }
    } catch (e) {
      stats.failed++;
      logLine({ event: 'submit_error', receipt_id: r.id, error: e?.message || JSON.stringify(e) || String(e) });
    }
  }

  // Resolve vehicle UUIDs to friendly labels in the final summary
  const byVehicleNamed = {};
  for (const [vid, n] of Object.entries(stats.by_vehicle)) {
    const v = vehicles.find((x) => x.id === vid);
    const name = v ? `${v.year} ${v.make} ${v.model}${v.trim ? ' ' + v.trim : ''}` : vid;
    byVehicleNamed[`${name} [${vid}]`] = n;
  }

  const summary = {
    event: 'run_summary',
    at: new Date().toISOString(),
    total: stats.total,
    attributed: stats.attributed,
    submitted: stats.submitted,
    duplicates: stats.duplicates,
    skipped_low_confidence: stats.skipped_low_confidence,
    failed: stats.failed,
    by_signal: stats.by_signal,
    by_vehicle: byVehicleNamed,
  };
  logLine(summary);
  fs.closeSync(logFh);
  console.log('\n=== WS-8 SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
