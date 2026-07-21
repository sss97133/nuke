#!/usr/bin/env node
// scripts/entity/validate.mjs — UNIVERSAL pre-write validation gate.
//
// ────────────────────────────────────────────────────────────────────────────
// WHAT THIS IS
// ────────────────────────────────────────────────────────────────────────────
// One subject-agnostic `validate()` that runs BEFORE a value is written to any
// subject type. It returns verdicts. It NEVER writes, NEVER nulls, NEVER
// deletes — remediation stays with the scripts that already own it
// (`concierge/repair-blank-marks.mjs`, `concierge/quarantine-elan-prices.mjs`),
// which preserve the as-found value with a `restore:` SQL string. That division
// is deliberate: a gate that also repairs is a gate that can corrupt.
//
// ────────────────────────────────────────────────────────────────────────────
// WHY IT EXISTS (each check is a measured defect, not a hypothetical)
// ────────────────────────────────────────────────────────────────────────────
//   Elan villas stored 294-804 USD/week vs merchant-published 22,000-125,000
//   a garment at 0.12 EUR that the merchant sells at 12.00 EUR (100x)
//   WIMCO nightly rates rendered as the weekly headline (3.4x understatement)
//   BODY+SOUL ST BARTH given the logo of an Indonesian gambling site that
//     seized its lapsed domain
//   MEDIFLIGHT (St Barth) matched to "Mediflight Of Oklahoma"
//   a St Barth restaurant matched to Saint-Barthelemy-de-Bellegarde, Dordogne
//   Bagatelle cited from a page headed "Bagatelle ST TROPEZ"
//   5 marks that composite to pure white and render as an empty box
//   244 villas wearing one logo binary belonging to their rental agency
//
// Every one of those was found AFTER the write, by a human or a one-off scan.
// This file is that forensics turned into a gate.
//
// ────────────────────────────────────────────────────────────────────────────
// WHAT IT DOES NOT REPLACE  (rule: liveness-and-intent §1, unwired != dead)
// ────────────────────────────────────────────────────────────────────────────
//   scripts/concierge/_org_entity_gate.mjs   — IMPORTED, not reimplemented.
//     Every rule in it carries an inline measured false-positive citation. It is
//     the core of check (c). This file wraps it with a subject adapter so
//     property/person/product/brand subjects reach the same adjudicator. If you
//     improve an identity rule, improve it THERE.
//   scripts/concierge/repair-blank-marks.mjs — its hardcoded BLANK/LOW_RES lists
//     came from a one-off `scan_marks.py`. Check (e) is that method generalized
//     so the list never has to be hand-maintained again. The repair script keeps
//     its remediation job and its quarantine-metadata vocabulary; this file
//     reuses that vocabulary verbatim (`blank_renders_invisible`,
//     `low_resolution_favicon`) so verdicts and repairs speak one language.
//   scripts/concierge/quarantine-elan-prices.mjs — same relationship for (a).
//
// ────────────────────────────────────────────────────────────────────────────
// LIBRARY GROUNDING
// ────────────────────────────────────────────────────────────────────────────
//   docs/library/technical/engineering-manual/20-polymorphic-subject-build-guide.md
//     §3 the subject model  — subject_type/subject_id, cashflow_deals shape.
//     §5 the un-fakeable gate per entity class. This file is the *value-level*
//        gate; §5 is the *entity-level* gate. They compose: §5 asks "has this
//        entity formed?", this asks "is this claim about it survivable?".
//   docs/library/intellectual/contemplations/the-trust-invariant.md
//     — hence: verdicts only. Nothing here deletes or overwrites testimony.
//   .claude/rules/agent-trust-invariants.md — no raw INSERT, no DELETE.
//   AGENTS.md invariant 2 — unknown is not zero and not false. A check with
//     insufficient evidence returns pass:null (UNKNOWN), never a silent pass.
//
// ────────────────────────────────────────────────────────────────────────────
// USAGE
// ────────────────────────────────────────────────────────────────────────────
//   library:
//     import { validate } from './scripts/entity/validate.mjs';
//     const r = await validate({ subject_type:'property', field:'base_price',
//                                value: 804, context: { currency:'USD',
//                                period:'week', subject:{ name:'Grace' } } });
//     r.verdict  -> 'block' | 'quarantine' | 'flag' | 'pass' | 'unknown'
//     r.checks   -> [{ check, pass, severity, reason, evidence }, ...]
//
//   CLI (audits rows that already exist):
//     node scripts/entity/validate.mjs bands                       # refit + print
//     node scripts/entity/validate.mjs audit property base_price
//     node scripts/entity/validate.mjs audit product price
//     node scripts/entity/validate.mjs audit organization logo_url --images
//     node scripts/entity/validate.mjs audit organization logo_url --shared
//     node scripts/entity/validate.mjs selftest                    # the 9 defects
//   always: cd /Users/skylar/nuke && dotenvx run --quiet -- node scripts/entity/validate.mjs ...

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  adjudicate, isAggregator, hostCarriesName, islandPresence, islandSufficient,
  registrable, hostCore, nameCore, tokens, compact, sameBusiness, LOCATOR_PATH,
} from '../concierge/_org_entity_gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BANDS_PATH = path.join(HERE, 'bands.json');

// ── severity ladder ─────────────────────────────────────────────────────────
// Reused verbatim from the remediation scripts so a verdict maps 1:1 onto an
// action that already has a precedent in this codebase.
//   block      — never write this. It is a fabrication or a category error.
//   quarantine — a stored value contradicted by better evidence. The existing
//                repair scripts null it + preserve it + record a restore path.
//   flag       — real but degraded (a 16x16 favicon standing in for a logo).
//                repair-blank-marks.mjs deliberately does NOT null these.
//   pass / unknown.
// `unknown` MUST outrank `flag`. Adversarial proof 2026-07-20 (mechanism M2): with unknown
// below flag, a check that never examined anything was absorbed by any flag — measured
// `entity_gate:flag` + `geo_scope:unknown` -> verdict `flag` -> APPLIED. That makes the stated
// invariant "unknown is not permission" false the moment two checks compose, and it is how the
// Dordogne class reaches a served column. An unexamined check must never be outvoted by a weak
// opinion; it ranks below quarantine (a known defect still quarantines rather than degrading to
// "we didn't look") and above flag.
const SEV = { block: 4, quarantine: 3, unknown: 2.5, flag: 2, pass: 0 };
const worst = (checks) => {
  let v = 'pass';
  for (const c of checks) if (SEV[c.severity] > SEV[v]) v = c.severity;
  return v;
};

let _db = null;
export const db = () => (_db ??= createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY));

// Hard cap: a column audit that silently starts paging 1.14M rows looks like a
// hang, and a hang gets a tool abandoned. Stop and say so instead.
const MAX_PAGED = 50000;
async function page(table, cols, tweak) {
  let out = [], from = 0;
  for (;;) {
    if (out.length >= MAX_PAGED) {
      console.warn(`  ! ${table}: stopped at ${MAX_PAGED} rows (cap). Bands fitted on a prefix, not the whole table — treat them as provisional.`);
      break;
    }
    let q = db().from(table).select(cols).order('id', { ascending: true }).range(from, from + 999);
    if (tweak) q = tweak(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out = out.concat(data);
    // PostgREST caps at 1000 and silently clamps larger limits. Exactly 1000 is
    // the cap, not the truth — keep paging.
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// THE SUBJECT REGISTRY — one row per subject type, everything else is generic.
// ════════════════════════════════════════════════════════════════════════════
// Adding a subject type is adding a row here. No check below knows any subject
// type by name. `expressible` records whether vehicle_observations can currently
// hold an observation about this type (measured 2026-07-19: the CHECK constraint
// is NOT VALID but still enforced on INSERT, so only vehicle/organization/user/
// asset are writable). Validation is available for ALL types regardless — a gate
// that only runs where writes already work is useless for planning the write.
export const SUBJECTS = {
  vehicle: {
    table: 'vehicles', pk: 'id', nameCol: 'make',
    // Deliberately EMPTY, not an oversight. Vehicle price plausibility already
    // has an owner: the comps/valuation organs (`bat_listings`, adjustment
    // factors, `hammer_predictions`) — see memory `deal-system-pickup`. Fitting
    // a second, dumber band over 1.14M vehicles here would be minting a rival
    // authority for a question that is already answered better elsewhere
    // (AGENTS.md invariant 3, don't mint). `validate()` still accepts vehicle
    // subjects for every other check; only the price band defers.
    priceFields: [], imageFields: ['primary_image_url'],
    expressible: true,
  },
  organization: {
    table: 'organizations', pk: 'id', nameCol: 'name',
    priceFields: ['hourly_rate_min', 'hourly_rate_max', 'asking_price'],
    imageFields: ['logo_url', 'banner_url'],
    identityCols: 'id,name,website,city,country,latitude,longitude,source_url,metadata',
    expressible: true,
  },
  property: {
    table: 'properties', pk: 'id', nameCol: 'name',
    priceFields: ['base_price', 'sale_price'],
    priceUnitCols: { base_price: ['price_currency', 'price_period'], sale_price: ['sale_price_currency', null] },
    imageFields: [],
    identityCols: 'id,name,city,region,country,latitude,longitude,source_url,metadata',
    expressible: false, // subject_type CHECK rejects 'property' — measured
  },
  product: {
    table: 'concierge_products', pk: 'id', nameCol: 'name',
    priceFields: ['price'],
    priceUnitCols: { price: ['currency', 'price_unit'] },
    imageFields: [],
    identityCols: 'id,org_id,name,price,currency,price_unit,source,structured_data',
    // The merchant is the price regime. Without this the pooled EUR band
    // flags every luxury handbag and every cappuccino.
    groupCol: 'org_id',
    expressible: false,
  },
  person: {
    table: 'mag_people', pk: 'name_canon', nameCol: 'display_name',
    priceFields: [], imageFields: [],
    identityCols: 'name_canon,display_name,instagram,handles,source',
    expressible: false, // PK is TEXT; subject_id is uuid. Structurally unaddressable.
  },
  brand: {
    table: 'brands', pk: 'id', nameCol: 'name',
    priceFields: [], imageFields: ['logo_url'],
    identityCols: 'id,name,slug,website_url,logo_url',
    expressible: false,
  },
  publication_page: {
    table: 'publication_pages', pk: 'id', nameCol: null,
    priceFields: [], imageFields: ['image_url', 'thumbnail_url'],
    identityCols: 'id,publication_id,page_number,image_url,extracted_text,phash',
    expressible: false,
  },
};

// ════════════════════════════════════════════════════════════════════════════
// PERIOD NORMALISATION — definitional only. NO FX.
// ════════════════════════════════════════════════════════════════════════════
// A week is 7 nights by definition, so normalising week→night fabricates
// nothing. Converting EUR→USD would require a market rate at an observed time,
// which is a FACT I would have to invent (AGENTS.md invariant 1). So bands are
// fitted per-currency and never across currencies. This is why EUR/week yacht
// charters (median 425,000) do not poison the USD/week villa band (median
// 10,045) — they are separate populations, correctly.
const NIGHTS = { night: 1, nightly: 1, day: 1, daily: 1, week: 7, weekly: 7, month: 30, monthly: 30, year: 365 };
export const toNightly = (v, period) => {
  const f = NIGHTS[String(period || '').toLowerCase()];
  return f ? { value: v / f, factor: f } : null;
};

// ════════════════════════════════════════════════════════════════════════════
// (a) NUMERIC PLAUSIBILITY BAND — derived FROM THE DATA, never hardcoded.
// ════════════════════════════════════════════════════════════════════════════
// Method: log10 + median/MAD.
//
// Why log space: the defects are multiplicative (27x, 100x, 155x), not
// additive. In linear space a 155x understatement sits *closer* to the median
// than a 3x overstatement — the wrong geometry entirely.
//
// Why median/MAD and not mean/sd: the fitting data CONTAINS the defects. 9 Elan
// rows in 366 USD/week rows is 2.5% contamination; MAD tolerates up to 50%,
// mean/sd is dragged by a single 155x outlier. This is the whole reason the
// band can be honestly derived from dirty data.
//
// Why 4.0 MAD and not 3.0: measured. At k=3.0 the fitted USD/night band
// rejects legitimately-cheap real rows near the p1 tail. At k=4.0 the band on
// USD/week is roughly 1,500-90,000 nightly-normalised, which admits every
// genuine villa in the table and still rejects 804/wk (=115/night) by ~1.1
// decades. The constant is a measured trade-off, not a guess — refit with
// `bands --k=N` and the printed reject list is the evidence.
const MAD_K = 4.0;
const MIN_SAMPLES = 12; // below this the band is noise; return UNKNOWN, not pass.

function fitBand(values) {
  const xs = values.filter((v) => typeof v === 'number' && isFinite(v) && v > 0).map((v) => Math.log10(v)).sort((a, b) => a - b);
  if (xs.length < MIN_SAMPLES) return { n: xs.length, insufficient: true };
  const med = xs[Math.floor(xs.length / 2)];
  const dev = xs.map((x) => Math.abs(x - med)).sort((a, b) => a - b);
  let mad = dev[Math.floor(dev.length / 2)];
  // A degenerate MAD (every row identical) must not produce a zero-width band
  // that rejects the next legitimate value. Fall back to the interdecile range.
  if (mad <= 0) mad = (xs[Math.floor(xs.length * 0.9)] - xs[Math.floor(xs.length * 0.1)]) / 4 || 0.25;
  return {
    n: xs.length,
    median: 10 ** med,
    lo: 10 ** (med - MAD_K * mad),
    hi: 10 ** (med + MAD_K * mad),
    observed_min: 10 ** xs[0],
    observed_max: 10 ** xs[xs.length - 1],
    log_mad: mad,
    k: MAD_K,
  };
}

// Bands are cached so the gate is cheap on the write path, and refit on demand
// so they track the data. A band is a measurement with an observed_at, like any
// other number here (memory: numbers-carry-source-DNA).
let _bands = null;
export function loadBands() {
  if (_bands) return _bands;
  if (fs.existsSync(BANDS_PATH)) _bands = JSON.parse(fs.readFileSync(BANDS_PATH, 'utf8'));
  else _bands = { fitted_at: null, bands: {} };
  return _bands;
}
export const bandKey = (subject_type, field, currency, normalised, group) =>
  `${subject_type}.${field}.${currency || 'NOCUR'}${normalised ? '.per_night' : ''}${group ? `@${group}` : ''}`;

// GROUPED BANDS — added after the first audit run measured its own false
// positives. A single global product.price.EUR band [10.56, 1576] flagged a
// €3,900 Bottega Veneta clutch and an €8 cappuccino as defects. Neither is one.
// `concierge_products` is not one population; it is ~100 merchants with
// price regimes spanning three orders of magnitude, and pooling them makes the
// band mean nothing at either end.
//
// So when a group (the merchant, the source) has enough of its own rows, its
// own band is used and the global one is ignored. Within Bottega, €3,900 is
// unremarkable; within the cafe, €8 is unremarkable; and a €0.12 garment is
// still 100x below ITS OWN merchant's regime, which is exactly the claim the
// original defect report made ("a garment stored at 0.12 EUR that the merchant
// sells at 12.00"). The grouped band is therefore not just more precise — it is
// a closer statement of the actual defect.
const GROUP_MIN = 24;
export const groupOf = (subject_type, row) =>
  subject_type === 'product' ? (row.org_id ?? null)
    : subject_type === 'property' ? (() => { try { return new URL(row.source_url).hostname.replace(/^www\./, ''); } catch { return null; } })()
      : null;

export function numericPlausibility({ subject_type, field, value, context = {} }) {
  const name = 'numeric_plausibility';
  if (value == null) return { check: name, pass: null, severity: 'unknown', reason: 'value is null — unknown is not zero', evidence: {} };
  if (typeof value !== 'number' || !isFinite(value)) {
    return { check: name, pass: false, severity: 'block', reason: `not a finite number: ${JSON.stringify(value)}`, evidence: { value } };
  }
  if (value < 0) return { check: name, pass: false, severity: 'block', reason: 'negative', evidence: { value } };

  const { currency, period, group } = context;
  const norm = period ? toNightly(value, period) : null;
  const bands = loadBands().bands;
  // Prefer the subject's own merchant/source band; fall back to the pooled one.
  const gKey = group ? bandKey(subject_type, field, currency, !!norm, group) : null;
  const gBand = gKey ? bands[gKey] : null;
  const useGroup = gBand && !gBand.insufficient;
  const key = useGroup ? gKey : bandKey(subject_type, field, currency, !!norm);
  const band = bands[key];
  const probe = norm ? norm.value : value;

  if (!band || band.insufficient) {
    return {
      check: name, pass: null, severity: 'unknown',
      reason: `no fitted band for ${key} (${band ? `only ${band.n} samples, need ${MIN_SAMPLES}` : 'never fitted'}) — cannot judge`,
      evidence: { key, probe },
    };
  }
  if (probe >= band.lo && probe <= band.hi) {
    return { check: name, pass: true, severity: 'pass', reason: `within fitted ${useGroup ? 'group' : 'population'} band`, evidence: { key, probe, lo: band.lo, hi: band.hi, n: band.n, scope: useGroup ? 'group' : 'population' } };
  }
  const decades = probe < band.lo ? Math.log10(band.lo / probe) : Math.log10(probe / band.hi);
  const ratio = probe < band.lo ? band.median / probe : probe / band.median;
  return {
    check: name, pass: false,
    // Off by >1 decade is not a mis-parse of degree, it is a different number.
    severity: decades >= 1 ? 'block' : 'quarantine',
    reason: `${probe.toFixed(2)}${norm ? ` (${value} per ${period} → per night)` : ''} is ${decades.toFixed(2)} decades outside the fitted ${key} band [${band.lo.toFixed(2)}, ${band.hi.toFixed(2)}]; ${ratio.toFixed(1)}x from the median ${band.median.toFixed(2)}`,
    evidence: { key, probe, raw: value, period, lo: band.lo, hi: band.hi, median: band.median, n: band.n, decades: +decades.toFixed(3), ratio: +ratio.toFixed(2), scope: useGroup ? 'group' : 'population' },
  };
}

// ── (a2) COHORT DISPLACEMENT ────────────────────────────────────────────────
// MEASURED REFUTATION OF (a), and the reason this check exists.
//
// I fitted the band, then tested it against the 9 real Elan values preserved in
// `metadata.price_quarantine.base_price_as_found`. Per-night they are:
//   42, 77, 90, 115, 126, 290, 564, 797, 1107
// The population band [145, 17002] catches FIVE of the nine. The other four are
// individually plausible villa rates — 797/night is only wrong relative to that
// villa's OWN published rate, which no population statistic can know. So the
// per-value band, on its own, would have shipped 4 of the 9 wrong prices.
//
// But the defect was never per-value. It was one systematic parse failure on
// one source's leg. Measured against the live table (2026-07-20):
//   wimco.com           n=388  median 1714/night   +0.04 decades
//   sibarth.com         n=359  median 1429/night   -0.04 decades
//   masterski-pilou.com n= 17  median 1815/night   +0.06 decades
//   elanvillarental.com n=  9  median  126/night   -1.10 decades  <-- all 9
//   edmiston.com        n=  7  median 26429/night  +1.23 decades  <-- see below
// Elan is the only downward-displaced cohort in the table and it is displaced
// by more than a decade. One finding, all nine rows, zero misses.
//
// Edmiston is displaced UPWARD by a comparable amount and is NOT a price defect
// — those rows are superyacht charters (their metadata carries `parent_shipyard`
// and `charter_broker_claim_caveat`), i.e. a different population filed under
// one subject type. That is a real finding of a different kind, and the check
// should surface it rather than suppress it.
//
// Hence severity `flag`, never `block`: a displaced cohort is a lead requiring
// merchant verification, not a verdict. Confirming it is what
// quarantine-elan-prices.mjs did by hand, and it is right that a human loop
// sits there — "never show a price you can't defend" cuts both ways.
const COHORT_DECADES = 0.7;
const COHORT_MIN = 5;

export function cohortDisplacement(rows, { cohortKey = 'source_host', valueKey = '__nightly' } = {}) {
  const nums = rows.map((r) => r[valueKey]).filter((v) => typeof v === 'number' && v > 0);
  if (nums.length < MIN_SAMPLES) return [];
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const pop = med(nums);
  const by = {};
  for (const r of rows) if (typeof r[valueKey] === 'number' && r[valueKey] > 0) (by[r[cohortKey] ?? 'unknown'] ??= []).push(r);
  const out = [];
  for (const [k, rs] of Object.entries(by)) {
    if (rs.length < COHORT_MIN) continue;
    const m = med(rs.map((r) => r[valueKey]));
    const d = Math.log10(m / pop);
    if (Math.abs(d) < COHORT_DECADES) continue;
    out.push({
      check: 'cohort_displacement', pass: false, severity: 'flag',
      reason: `cohort "${k}" (n=${rs.length}) sits ${d > 0 ? '+' : ''}${d.toFixed(2)} decades from the population median (${m.toFixed(0)} vs ${pop.toFixed(0)}) — either a systematic parse failure across this source's whole leg (the Elan shape) or a different population filed under one subject type (the Edmiston shape). Verify against the merchant before acting.`,
      evidence: { cohort: k, n: rs.length, cohort_median: +m.toFixed(2), population_median: +pop.toFixed(2), decades: +d.toFixed(3), direction: d > 0 ? 'high' : 'low', subjects: rs.map((r) => r.__name).slice(0, 12) },
    });
  }
  return out.sort((a, b) => Math.abs(b.evidence.decades) - Math.abs(a.evidence.decades));
}

// ════════════════════════════════════════════════════════════════════════════
// (b) UNIT + CURRENCY REQUIRED
// ════════════════════════════════════════════════════════════════════════════
// A price without both is not a cheap price — it is an UNKNOWN price wearing a
// number. This is the WIMCO defect's real shape: the nightly values are stored
// correctly (measured: USD/night median 1,714, coherent with USD/week median
// 10,045 → 1,435/night), so nothing was mis-parsed. What broke is that a
// consumer read the number and supplied its own unit. The gate's job is
// therefore to make the unit non-optional AT THE VALUE, so no reader can ever
// have to assume one.
const CURRENCY = /^[A-Z]{3}$/;
export function unitCurrencyRequired({ field, value, context = {} }) {
  const name = 'unit_currency_required';
  if (value == null) return { check: name, pass: null, severity: 'unknown', reason: 'no value', evidence: {} };
  const isMoney = context.is_money ?? /price|rate|cost|amount|fee|value|revenue/i.test(field);
  if (!isMoney) return { check: name, pass: true, severity: 'pass', reason: 'not a money field', evidence: {} };

  const { currency, period } = context;
  const missing = [];
  if (!currency) missing.push('currency');
  else if (!CURRENCY.test(String(currency))) missing.push(`currency "${currency}" is not an ISO-4217 code`);
  if (!period) missing.push('unit/period');
  else if (!NIGHTS[String(period).toLowerCase()] && !/each|item|sale|hour|person|piece|unit/i.test(period)) {
    missing.push(`unit "${period}" is not a recognised period or count unit`);
  }
  if (!missing.length) return { check: name, pass: true, severity: 'pass', reason: `${currency} per ${period}`, evidence: { currency, period } };
  return {
    check: name, pass: false, severity: 'block',
    reason: `money value ${value} carries no ${missing.join(' and no ')} — a number without a unit is not a price`,
    evidence: { value, currency: currency ?? null, period: period ?? null, missing },
  };
}

// Column-level companion: mixing units inside ONE column is an error even when
// every individual row is well-formed, because every downstream reader must
// then branch. Audit-mode only — it needs the whole column to see it.
export function unitCoherence(rows, { currencyKey, periodKey }) {
  const name = 'unit_coherence';
  const combos = {};
  for (const r of rows) {
    if (r.__value == null) continue;
    const k = `${r[currencyKey] ?? 'NULL'}/${r[periodKey] ?? 'NULL'}`;
    (combos[k] ??= []).push(r);
  }
  const keys = Object.keys(combos).sort((a, b) => combos[b].length - combos[a].length);
  if (keys.length <= 1) return { check: name, pass: true, severity: 'pass', reason: 'one unit throughout', evidence: { combos: keys } };
  const dist = Object.fromEntries(keys.map((k) => [k, combos[k].length]));
  const hasNull = keys.some((k) => k.includes('NULL'));
  return {
    check: name, pass: false,
    severity: hasNull ? 'block' : 'flag',
    reason: `${keys.length} distinct currency/unit combinations share one column — every reader must branch, and the one that forgets produces the WIMCO defect (nightly rendered as weekly)`,
    evidence: { distribution: dist, dominant: keys[0], has_null_unit: hasNull },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// (c) ENTITY GATE — generalised, NOT rewritten.
// ════════════════════════════════════════════════════════════════════════════
// `_org_entity_gate.mjs` already answers "does this page belong to this org",
// and every clause in it is bounded by a measured false positive. Read its
// header before touching identity logic.
//
// The generalisation insight: `hostCarriesName`, `isAggregator`, `LOCATOR_PATH`
// and `sameBusiness` never mention organisations. They are name-vs-source
// functions. What was org-specific was only the CALLER — it knew how to pull a
// name out of an `organizations` row. So the extension is an adapter table
// (subjectIdentity) plus a per-subject-type relaxation of the island rule:
//
//   organization — full adjudication (own door required). Unchanged.
//   property     — a villa legitimately lives on its AGENCY's domain
//                  (villa Grace on elanvillarental.com is correct, not a
//                  defect), so `own_site` is not required. What IS required is
//                  that the page names this villa. Downgraded to a naming test,
//                  which is exactly what the Bagatelle-ST-TROPEZ defect needed:
//                  right brand, wrong outlet, caught on the outlet token.
//   product      — must be reachable from its org's own verified door.
//   person/brand — name/handle carriage only; no island rule (a contributor may
//                  legitimately be documented anywhere).
export function subjectIdentity(subject_type, row = {}) {
  const s = SUBJECTS[subject_type];
  switch (subject_type) {
    case 'organization': return { name: row.name || row.business_name, host: row.website, region: { city: row.city, country: row.country, lat: row.latitude, lng: row.longitude } };
    case 'property': return { name: row.name, host: row.source_url, region: { city: row.city, country: row.country, lat: row.latitude, lng: row.longitude }, agency: row.metadata?.agency };
    case 'product': return { name: row.name, host: row.source, org_id: row.org_id };
    case 'person': return { name: row.display_name || row.name_canon, handles: [row.instagram, ...(row.handles || [])].filter(Boolean) };
    case 'brand': return { name: row.name, host: row.website_url };
    case 'vehicle': return { name: [row.year, row.make, row.model].filter(Boolean).join(' '), host: row.listing_url, vin: row.vin };
    case 'publication_page': return { name: null, host: null, page: row.page_number };
    default: return { name: row[s?.nameCol] ?? null, host: row.source_url ?? null };
  }
}

const REQUIRES_OWN_DOOR = new Set(['organization', 'brand']);

export function entityGate({ subject_type, subject = {}, evidence = {} }) {
  const name = 'entity_gate';
  const subjName = subject.name;
  const url = evidence.url || evidence.source_url;
  if (!subjName || !url) {
    return { check: name, pass: null, severity: 'unknown', reason: `cannot adjudicate: ${!subjName ? 'subject has no name' : 'evidence has no URL'}`, evidence: { subjName, url } };
  }
  let host, pathname;
  try { const u = new URL(url); host = u.hostname.replace(/^www\./, ''); pathname = u.pathname; }
  catch { return { check: name, pass: false, severity: 'block', reason: `unparseable evidence URL: ${url}`, evidence: { url } }; }

  const md = evidence.text || '';
  const island = evidence.island ?? islandPresence(md, host);
  const phoneOnPage = !!evidence.phone_on_page;

  if (REQUIRES_OWN_DOOR.has(subject_type)) {
    // Unmodified call into the existing adjudicator. Do not inline its logic.
    const v = adjudicate({ orgName: subjName, host, path: pathname, island, phoneOnPage });
    if (v.verdict === 'own_site') {
      // MEASURED GAP IN THE EXISTING GATE, found by this selftest (2026-07-20).
      // BODY+SOUL ST BARTH: the org's real domain lapsed and was seized by an
      // Indonesian gambling site. `bodysoulstbarth.com` still satisfies
      // host_is_name AND ISLAND_IN_HOST → island_domain → island_sufficient, so
      // adjudicate() returns own_site and always will. Every one of its signals
      // is a signal about the DOMAIN, and a domain survives its owner.
      //
      // The body does not. A seized domain keeps the name in the URL and drops
      // it from the page. So when page text is available, require the subject's
      // distinctive tokens to actually appear in it. Deliberately implemented
      // HERE and not inside _org_entity_gate.mjs: that file's contract is
      // host-vs-name adjudication and every rule in it is bounded by a measured
      // host-level false positive. This is a different question (does the
      // CONTENT still belong to the subject) and folding it in would blur a
      // file whose precision is its value. If Skylar wants it pushed down, that
      // is a deliberate move, not a side effect of this work.
      const toks0 = tokens(subjName);
      if (md && toks0.length) {
        const seen = toks0.filter((t) => new RegExp(`\\b${t}`, 'i').test(md));
        if (seen.length === 0) {
          return {
            check: name, pass: false,
            // A short snippet naming none of the tokens is weaker evidence than
            // a full page doing so, but it is never NO evidence — so it is a
            // flag, not a silent pass (invariant: unknown is not false).
            severity: md.length >= 200 ? 'block' : 'flag',
            reason: `host passes every domain test (${v.host_carries_name}) but the page body names none of the subject's distinctive tokens (${toks0.join(', ')}) — a domain outlives its owner; this is the lapsed-domain-seizure shape`,
            evidence: { host, verdict: 'content_contradicts_host', tokens: toks0, text_len: md.length, sample: md.slice(0, 120) },
          };
        }
      }
      return { check: name, pass: true, severity: 'pass', reason: `own_site (${v.host_carries_name})`, evidence: { host, verdict: v.verdict, ...v } };
    }
    return {
      check: name, pass: false,
      // An aggregator/locator page is real evidence ABOUT the subject, just not
      // its door — that is a downgrade, not a fabrication. A page that does not
      // name the subject at all, or names a different region's namesake, is the
      // MEDIFLIGHT-Oklahoma class and must never be written.
      severity: ['aggregator', 'stockist_locator', 'global_maison'].includes(v.verdict) ? 'flag' : 'block',
      reason: `${v.verdict}: ${v.reason}`,
      evidence: { host, path: pathname, island, verdict: v.verdict },
    };
  }

  // Non-door subjects: the source need not be owned, but it must NAME the subject.
  const carried = hostCarriesName(subjName, host, phoneOnPage);
  const slug = compact(decodeURIComponent(pathname));
  const nc = nameCore(subjName);
  const inPath = nc.length >= 4 && slug.includes(nc);
  const toks = tokens(subjName);
  const tokHits = toks.filter((t) => slug.includes(compact(t)) || (md && new RegExp(`\\b${t}`, 'i').test(md)));

  if (carried || inPath || (toks.length && tokHits.length === toks.length)) {
    return {
      check: name, pass: true, severity: 'pass',
      reason: carried ? `source host carries the name (${carried})` : inPath ? 'source path carries the name' : `source names all ${toks.length} distinctive token(s)`,
      evidence: { host, path: pathname, carried, inPath, tokHits },
    };
  }
  return {
    check: name, pass: false,
    severity: tokHits.length ? 'flag' : 'block',
    reason: tokHits.length
      // Bagatelle: the brand token matched, the outlet token did not. Partial
      // naming is the most dangerous state — it looks like a hit.
      ? `source names only ${tokHits.length}/${toks.length} distinctive tokens (${tokHits.join(',')}) — partial naming is the "right brand, wrong outlet" shape`
      : `source neither hosts nor names "${subjName}"`,
    evidence: { host, path: pathname, tokens: toks, tokHits },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// (d) GEOGRAPHIC SCOPE
// ════════════════════════════════════════════════════════════════════════════
// Two distinct failures, and the second is the subtle one:
//   MEDIFLIGHT -> "Mediflight Of Oklahoma"       : same name, different continent
//   restaurant -> Saint-Barthélemy-de-Bellegarde : the REGION NAME ITSELF is
//                 ambiguous. Mainland France has communes named Saint-Barthélemy.
//                 `_org_entity_gate.islandSufficient` already encodes exactly
//                 this scar ("repetition of the island's NAME is never island
//                 presence"). This check enforces the positive form of it: a
//                 place-name string is never proof of place; only a coordinate,
//                 a postcode, or a dialling code is.
//
// The reference region is DERIVED from the subject population (a bbox fitted
// over the live lat/lng of the subject's own class), not hardcoded to St Barth.
export function geoScope({ subject = {}, evidence = {}, region = null }) {
  const name = 'geo_scope';
  const ref = region || subject.region;
  if (!ref) return { check: name, pass: null, severity: 'unknown', reason: 'subject has no known region', evidence: {} };

  // Hard geometry first — a coordinate cannot be argued with.
  const eLat = evidence.lat ?? evidence.latitude, eLng = evidence.lng ?? evidence.longitude;
  if (eLat != null && eLng != null && ref.bbox) {
    const [w, s, e, n] = ref.bbox;
    const inside = eLat >= s && eLat <= n && eLng >= w && eLng <= e;
    const km = ref.lat != null ? haversine(eLat, eLng, ref.lat, ref.lng) : null;
    if (inside) return { check: name, pass: true, severity: 'pass', reason: `evidence coordinate inside the fitted region bbox`, evidence: { eLat, eLng, bbox: ref.bbox, km } };
    return {
      check: name, pass: false, severity: 'block',
      reason: `evidence coordinate (${eLat}, ${eLng}) is outside the subject's region${km != null ? `, ${Math.round(km)} km from its centroid` : ''} — this is the MEDIFLIGHT-Of-Oklahoma class`,
      evidence: { eLat, eLng, bbox: ref.bbox, km },
    };
  }

  // No coordinate: fall back to the un-ambiguous contacts only.
  //
  // The URL PATH counts as locational text, and that is what catches Bagatelle.
  // `bagatelle.com/venues/st-tropez` passes every identity test — nameCore
  // strips the "ST BARTH" qualifier, leaving "bagatelle", which IS the host. The
  // brand is right. Only the OUTLET is wrong, and the outlet is named nowhere
  // but the path. So no single check can catch it: entity_gate correctly says
  // "this is Bagatelle's own site" and geo_scope correctly says "this page is
  // about St Tropez." The finding only exists in the composition, which is why
  // validate() runs them together and takes the worst verdict.
  const pathText = (() => { try { return decodeURIComponent(new URL(evidence.url || evidence.source_url).pathname).replace(/[/_-]+/g, ' '); } catch { return ''; } })();
  const text = [evidence.text, evidence.display_name, evidence.address, pathText].filter(Boolean).join(' ');
  if (!text) return { check: name, pass: null, severity: 'unknown', reason: 'no coordinate and no locational text in evidence', evidence: {} };
  const pos = (ref.hard_positive || []).find((p) => new RegExp(p, 'i').test(text));
  const neg = (ref.negative || []).find((p) => new RegExp(p, 'i').test(text));
  // Both present is a real state, not an edge case: a St Barth venue's own site
  // may legitimately mention its St Tropez sister. Contradiction plus
  // corroboration is neither a pass nor a block — it is a page that needs a
  // human to say which outlet it describes.
  if (pos && neg) {
    return { check: name, pass: false, severity: 'flag', reason: `evidence carries a regional contact (/${pos}/) AND names a contradicting region (/${neg}/) — cannot tell which outlet this page describes`, evidence: { positive: pos, negative: neg } };
  }
  if (neg) return { check: name, pass: false, severity: 'block', reason: `evidence names a contradicting region (/${neg}/)`, evidence: { matched: neg } };
  if (pos) return { check: name, pass: true, severity: 'pass', reason: `evidence carries an unambiguous regional contact (/${pos}/)`, evidence: { matched: pos } };
  const soft = (ref.soft_positive || []).find((p) => new RegExp(p, 'i').test(text));
  return {
    check: name, pass: null, severity: 'unknown',
    reason: soft
      ? `evidence names the region ("${soft}") but a place-name is not proof of place — mainland France has its own Saint-Barthélemy communes. Needs a coordinate, postcode or dialling code.`
      : 'no regional signal either way',
    evidence: { soft_match: soft ?? null },
  };
}

function haversine(a1, o1, a2, o2) {
  const R = 6371, r = Math.PI / 180;
  const dA = (a2 - a1) * r, dO = (o2 - o1) * r;
  const h = Math.sin(dA / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dO / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ════════════════════════════════════════════════════════════════════════════
// (e) IMAGE SANITY
// ════════════════════════════════════════════════════════════════════════════
// Generalises `scan_marks.py` (the one-off that found 5 blanks in 605 marks) and
// the hand-typed BLANK/LOW_RES lists in repair-blank-marks.mjs.
//
// The load-bearing method, quoting that script's own reasoning: `ax_mark` is
// literally `logo_url IS NOT NULL`, so a stored image that composites to
// nothing still scores the org as having captured its mark. A null is honest;
// an invisible image is not. So: decode, FLATTEN ONTO THE PAPER GROUND (#FAFAF8
// — the actual page background), then measure tonal range. A white-on-
// transparent knockout logo has plenty of range as a PNG and zero range on
// paper. Judging the URL, the file size, or the raw pixels all miss it.
// THRESHOLDS DERIVED FROM DATA, and one of them was measured to be WRONG first.
//
// scan_marks.py used tonal RANGE and reported the 5 confirmed blanks at range
// 0-1. Reimplemented over sharp, those same images score range 5 — different
// colourspace rounding — so a range<=2 rule inherited from the Python numbers
// silently passes every one of them. It did, on the first selftest run. The
// lesson is the library's own: do not port a threshold, port the METHOD and
// re-fit the constant against this implementation's numbers.
//
// So the primary discriminator is INK COVERAGE: the share of pixels that differ
// from the image's own modal (background) tone by more than 8 levels, after
// compositing onto the paper ground. It is scale-free and needs no colourspace
// luck. Measured over a 109-mark live sample (2026-07-20):
//
//   blank      Gasoline Alley Garage  1100x791  ink 0%       range 5
//              Petrol Lounge          1080x646  ink 0%       range 10
//              Mille Miglia            180x64   ink 0%       range 5
//              Road Scholars          2000x734  ink 0%       range 19
//              Roadscholars            547x196  ink 0.158%   range 26
//   ── the gap ────────────────────────────────────────────────────────
//   real       SweetCars               357x152  ink 3.407%   range 195
//              VOCHELLE François       341x340  ink 3.594%   range 250
//              AMNIOS                  500x161  ink 5.940%   range 129
//
// 0.158% to 3.407% is a 21x empty gap. 1.0% sits in the middle of it. Note also
// that RANGE alone would have missed Road Scholars (19) and Roadscholars (26)
// under any threshold that keeps AMNIOS-like marks — which is why range is kept
// only as corroborating evidence, never as the test.
export const PAPER_GROUND = '#FAFAF8';
const MIN_MARK_PX = 48;    // measured: every confirmed low-res defect was <=45px; every good mark exceeded 48.
const BLANK_INK_PCT = 1.0; // measured: mid-point of a 21x gap in the live distribution.

export async function imageSanity({ value, context = {} }) {
  const name = 'image_sanity';
  if (!value) return { check: name, pass: null, severity: 'unknown', reason: 'no image', evidence: {} };
  if (typeof value !== 'string') return { check: name, pass: false, severity: 'block', reason: 'image value is not a string', evidence: { value } };

  // Caught live 2026-07-20: 9 organizations store the literal strings "Logo"
  // and "Logo Image" in logo_url. Not a URL, not an image — a placeholder that
  // scores as a captured mark.
  if (!/^(https?:|data:|\/)/i.test(value)) {
    return { check: name, pass: false, severity: 'block', reason: `not a URL — a placeholder string ("${value}") stored in an image column still scores as a captured mark`, evidence: { value } };
  }

  let sharp;
  try { ({ default: sharp } = await import('sharp')); }
  catch { return { check: name, pass: null, severity: 'unknown', reason: 'sharp unavailable — cannot decode', evidence: {} }; }

  let buf;
  try {
    const res = await fetch(value, { signal: AbortSignal.timeout(context.timeout_ms ?? 20000) });
    if (!res.ok) return { check: name, pass: false, severity: 'quarantine', reason: `image URL returns HTTP ${res.status}`, evidence: { value, status: res.status } };
    buf = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return { check: name, pass: null, severity: 'unknown', reason: `fetch failed: ${e.message} — unreachable is not the same as bad`, evidence: { value } };
  }

  try {
    const img = sharp(buf);
    const meta = await img.metadata();
    const { width: w, height: h } = meta;
    if (!w || !h) return { check: name, pass: false, severity: 'block', reason: 'undecodable image', evidence: { value, bytes: buf.length } };

    const flat = await sharp(buf).flatten({ background: PAPER_GROUND }).removeAlpha().toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });
    let min = 255, max = 0, sum = 0;
    const hist = new Array(256).fill(0);
    for (const px of flat.data) { if (px < min) min = px; if (px > max) max = px; sum += px; hist[px]++; }
    const range = max - min, lum = Math.round(sum / flat.data.length);
    // Modal tone = the image's own background after compositing. Ink = anything
    // that visibly departs from it. A knockout logo that vanished into the paper
    // has no ink; a real mark has several percent.
    let mode = 0; for (let i = 1; i < 256; i++) if (hist[i] > hist[mode]) mode = i;
    let inkPx = 0;
    for (const px of flat.data) if (Math.abs(px - mode) > 8) inkPx++;
    const ink = +(100 * inkPx / flat.data.length).toFixed(3);
    const ev = { value, w, h, ink_pct: ink, range, lum, bytes: buf.length, format: meta.format, has_alpha: !!meta.hasAlpha };

    if (ink < BLANK_INK_PCT) {
      // Same reason + method strings the repair script writes into
      // metadata.mark_quarantine, so a verdict and a repair are one vocabulary.
      return {
        check: name, pass: false, severity: 'quarantine',
        reason: `blank_renders_invisible — only ${ink}% of pixels depart from the background once composited onto the paper ground (${w}x${h} range=${range} lum=${lum}); the profile would show an empty box while scoring the mark as captured`,
        evidence: { ...ev, method: 'sharp_decode_composite_on_paper_ground' },
      };
    }
    if (w < MIN_MARK_PX || h < MIN_MARK_PX) {
      // NOT nulled: this is genuinely the subject's own asset, just too small.
      // repair-blank-marks.mjs makes exactly this distinction and it is right.
      return {
        check: name, pass: false, severity: 'flag',
        reason: `low_resolution_favicon — ${w}x${h} favicon standing in for a mark; a real asset, too small to render at profile scale`,
        evidence: { ...ev, method: 'sharp_decode_dimension_check', needs: 'recapture at og:image / apple-touch-icon / site-header size' },
      };
    }
    return { check: name, pass: true, severity: 'pass', reason: `${w}x${h} ${meta.format}, tonal range ${range} on paper ground`, evidence: ev };
  } catch (e) {
    return { check: name, pass: false, severity: 'block', reason: `decode failed: ${e.message}`, evidence: { value, bytes: buf.length } };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// (f) SHARED BINARY / SHARED VALUE
// ════════════════════════════════════════════════════════════════════════════
// 244 villas wearing one logo binary belonging to their rental agency. The logo
// is real; the ATTRIBUTION is false. This is not an image defect — the image is
// fine — it is an identity defect, so it needs the whole column to see it.
//
// The threshold is not a count, it is a question: are the sharers related? Two
// rows for one business sharing a logo is a DUPLICATE (a different, benign
// finding). N unrelated subjects sharing one is a platform/agency asset
// misattributed N times. `sameBusiness` from the existing gate answers exactly
// that question, and it too is measured against a false positive
// ("BAR DE LOUBLI" / "BAR DE L'OUBLI" is one business; fredmanagement-stbarth
// across five companies is a portal).
// MEASURED CORRECTION (2026-07-20): my first version compared URLs and would
// have MISSED the headline defect entirely. The 244 villas do not share a URL —
// each has its own `org-assets/marks/<org-id>.png` in storage. They share the
// BYTES. `lofficiel-concierge/scripts/mirror_org_marks.mjs --audit` already
// established the right method (`sha256_collision_audit`, recorded in every
// quarantine row as `metadata.mark_quarantine.sha256`), and this check must
// speak that language rather than invent a weaker one.
//
// Division of labour, deliberately: mirror_org_marks.mjs OWNS fetching and
// hashing marks at scale and owns the quarantine write. This function owns the
// clustering verdict, and accepts a digest computed by whoever has the bytes —
// so the same logic serves marks, gallery photos, `publication_pages.phash`,
// or any future binary, and there is exactly one copy of the "is this cluster a
// misattribution or a duplicate row" judgement.
export async function digestOf(url, { timeout_ms = 20000 } = {}) {
  const { createHash } = await import('node:crypto');
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeout_ms) });
    if (!r.ok) return null;
    return createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex');
  } catch { return null; }
}

export function sharedValue(rows, { field, threshold = 2 } = {}) {
  const groups = {};
  for (const r of rows) {
    const v = r[field];
    if (v == null || v === '') continue;
    (groups[v] ??= []).push(r);
  }
  const out = [];
  for (const [v, rs] of Object.entries(groups)) {
    if (rs.length < threshold) continue;
    const names = rs.map((r) => r.__name ?? r.name ?? r.id);
    // Are they all the same business under different rows?
    let allSame = true;
    for (let i = 1; i < names.length && allSame; i++) if (!sameBusiness(String(names[0]), String(names[i]))) allSame = false;
    out.push({
      check: 'shared_value', pass: false,
      severity: allSame ? 'flag' : (rs.length >= 10 ? 'block' : 'quarantine'),
      reason: allSame
        ? `${rs.length} rows share ${field} but resolve to one business — a duplicate-row finding, not a misattribution`
        : `${rs.length} unrelated subjects share one ${field} — a value held by N unrelated subjects belongs to a platform or agency, not to any of them`,
      evidence: { field, value: String(v).slice(0, 140), n: rs.length, duplicate_rows: allSame, subjects: names.slice(0, 12), ids: rs.map((r) => r.id).slice(0, 12) },
    });
  }
  return out.sort((a, b) => b.evidence.n - a.evidence.n);
}

// ════════════════════════════════════════════════════════════════════════════
// THE ENTRY POINT
// ════════════════════════════════════════════════════════════════════════════
// Composable: every check is independent and each returns the same shape, so
// callers may run one or all. `validate` runs the ones that apply to the value
// in hand. Checks that lack evidence return UNKNOWN — they never silently pass.
export async function validate({ subject_type, field, value, context = {} }) {
  if (!SUBJECTS[subject_type]) {
    return { subject_type, field, verdict: 'block', checks: [{ check: 'subject_registry', pass: false, severity: 'block', reason: `unknown subject_type "${subject_type}" — add it to SUBJECTS`, evidence: { known: Object.keys(SUBJECTS) } }] };
  }
  const checks = [];
  const isImage = context.is_image ?? /logo|image|photo|banner|thumbnail|mark|avatar/i.test(field);
  const isMoney = context.is_money ?? /price|rate|cost|amount|fee|asking/i.test(field);

  if (isMoney || typeof value === 'number') {
    checks.push(unitCurrencyRequired({ field, value, context }));
    checks.push(numericPlausibility({ subject_type, field, value, context }));
  }
  if (isImage) checks.push(await imageSanity({ value, context }));
  if (context.evidence) {
    checks.push(entityGate({ subject_type, subject: context.subject || {}, evidence: context.evidence }));
    checks.push(geoScope({ subject: context.subject || {}, evidence: context.evidence, region: context.region }));
  }
  if (Array.isArray(context.peers)) {
    const shared = sharedValue([...context.peers, { id: '__self', name: context.subject?.name, [field]: value }], { field });
    checks.push(...shared.filter((s) => s.evidence.ids.includes('__self')));
  }
  // ADVERSARIAL REPAIR (2026-07-20, verification pass).
  // `worst([])` returns 'pass' — so a (subject, field) pair that matches NO
  // check (not money, not an image, no evidence, no peers) returned verdict
  // 'pass' having examined nothing. Measured blast radius at the time of the
  // fix: 26/26 descriptive fields sampled across all 7 subject types —
  // vehicle.vin, organization.name, person.display_name, brand.slug,
  // publication_page.extracted_text, etc. This contradicted this file's own
  // stated contract five lines above ("Checks that lack evidence return
  // UNKNOWN — they never silently pass"): the individual checks honour it, the
  // compositor did not. It also had a live consumer — observe.mjs:349 records
  // `validation_verdict` onto the observation payload, so an unexamined 'pass'
  // would land in never-deleted testimony as if the value had been vetted.
  // Unknown is not pass (AGENTS.md invariant 2: if you can't cite it, mark it
  // unknown — don't hallucinate it closed).
  if (!checks.length) {
    checks.push({
      check: 'applicability',
      pass: null,
      severity: 'unknown',
      reason: `no check applies to ${subject_type}.${field} — this value was NOT examined; unknown is not pass`,
      evidence: {
        subject_type,
        field,
        hint: 'pass context.evidence (entity_gate + geo_scope), context.peers (shared_value), or set context.is_money / context.is_image to route this field to a check',
      },
    });
  }
  return {
    subject_type, field, value,
    expressible_as_observation: SUBJECTS[subject_type].expressible,
    verdict: worst(checks),
    checks,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// REGION FITTING — derived from the live subject population.
// ════════════════════════════════════════════════════════════════════════════
export async function fitRegion(subject_type, filter) {
  const s = SUBJECTS[subject_type];
  const rows = await page(s.table, `${s.pk},latitude,longitude`, (q) => filter ? filter(q.not('latitude', 'is', null)) : q.not('latitude', 'is', null));
  const lats = rows.map((r) => r.latitude).sort((a, b) => a - b);
  const lngs = rows.map((r) => r.longitude).sort((a, b) => a - b);
  if (lats.length < MIN_SAMPLES) return null;
  const q = (a, p) => a[Math.floor(a.length * p)];
  // Interquartile-padded box: robust to a handful of already-mis-geocoded rows
  // (the Dordogne restaurant sits in this very table).
  const pad = 0.35;
  const [s_, n_] = [q(lats, 0.05) - pad, q(lats, 0.95) + pad];
  const [w_, e_] = [q(lngs, 0.05) - pad, q(lngs, 0.95) + pad];
  return { bbox: [w_, s_, e_, n_], lat: q(lats, 0.5), lng: q(lngs, 0.5), n: rows.length, fitted_at: new Date().toISOString() };
}

// The un-ambiguous regional contacts for St Barth. `hard_positive` is the list
// of things that CANNOT belong to a mainland namesake; `soft_positive` is the
// place-name itself, which per the existing gate's measured scar is never proof.
export const STBARTH_REGION_TEXT = {
  hard_positive: ['\\b97133\\b', '(?:\\+\\s?590|00\\s?590|\\b0590|\\b0690)[\\s.\\-]?\\d'],
  soft_positive: ['saint[- ]?barth', 'st[.\\s-]?barth', '\\bsbh\\b'],
  negative: ['de-bellegarde', 'dordogne', 'oklahoma', 'st[ -]tropez', 'saint[- ]tropez', '\\bisère\\b', 'ardèche'],
};

// ════════════════════════════════════════════════════════════════════════════
// CLI
// ════════════════════════════════════════════════════════════════════════════
const C = { r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const paint = (sev, t) => `${{ block: C.r + C.b, quarantine: C.r, flag: C.y, unknown: C.d, pass: C.g }[sev] || ''}${t}${C.x}`;

// Column sets differ per table (`vehicles` has no source_url, `concierge_products`
// has `source` instead). Probe one row rather than assume — the repo is not prod
// and neither is my memory of a schema.
async function loadColumn(subject_type, field) {
  const s = SUBJECTS[subject_type];
  const uc = s.priceUnitCols?.[field];
  const { data: probe, error: pe } = await db().from(s.table).select('*').limit(1);
  if (pe) throw new Error(`${s.table}: ${pe.message}`);
  const present = new Set(Object.keys(probe[0] || {}));
  const cols = [s.pk, s.nameCol, field, ...(uc || []).filter(Boolean), 'source_url', 'source', s.groupCol]
    .filter((c) => c && present.has(c));
  const rows = await page(s.table, [...new Set(cols)].join(','));
  return rows.map((r) => ({
    ...r, id: r[s.pk], __name: r[s.nameCol], __value: r[field],
    __currency: uc?.[0] ? r[uc[0]] : null, __period: uc?.[1] ? r[uc[1]] : null,
  }));
}

async function cmdBands(args) {
  const k = Number((args.find((a) => a.startsWith('--k=')) || '').slice(4)) || MAD_K;
  const out = { fitted_at: new Date().toISOString(), method: `log10 median +/- ${k} MAD; period normalised to per-night; NO currency conversion`, k, min_samples: MIN_SAMPLES, bands: {} };
  for (const [st, s] of Object.entries(SUBJECTS)) {
    for (const field of s.priceFields) {
      let rows;
      try { rows = await loadColumn(st, field); } catch (e) { console.log(`  skip ${st}.${field}: ${e.message}`); continue; }
      const buckets = {}, gBuckets = {};
      for (const r of rows) {
        if (r.__value == null) continue;
        const n = r.__period ? toNightly(r.__value, r.__period) : null;
        const v = n ? n.value : r.__value;
        (buckets[bandKey(st, field, r.__currency, !!n)] ??= []).push(v);
        const g = groupOf(st, r);
        if (g) (gBuckets[bandKey(st, field, r.__currency, !!n, g)] ??= []).push(v);
      }
      for (const [key, vals] of Object.entries(buckets)) {
        const band = fitBand(vals);
        out.bands[key] = band;
        console.log(`  ${key.padEnd(46)} n=${String(band.n).padStart(5)} ${band.insufficient ? C.d + 'INSUFFICIENT' + C.x : `band [${band.lo.toFixed(1)}, ${band.hi.toFixed(1)}] med=${band.median.toFixed(1)}`}`);
      }
      let kept = 0;
      for (const [key, vals] of Object.entries(gBuckets)) {
        if (vals.length < GROUP_MIN) continue;   // too thin to be its own authority
        const band = fitBand(vals);
        if (band.insufficient) continue;
        out.bands[key] = band; kept++;
      }
      if (kept) console.log(`  ${C.d}+ ${kept} per-group bands (>=${GROUP_MIN} rows each) — these override the pooled band for their own subjects${C.x}`);
    }
  }
  fs.writeFileSync(BANDS_PATH, JSON.stringify(out, null, 2));
  _bands = out;
  console.log(`\nwrote ${BANDS_PATH}`);
}

async function cmdAudit(subject_type, field, args) {
  const s = SUBJECTS[subject_type];
  if (!s) throw new Error(`unknown subject_type ${subject_type}`);
  const rows = await loadColumn(subject_type, field);
  const uc = s.priceUnitCols?.[field];
  console.log(`${C.b}audit ${subject_type}.${field}${C.x} — ${rows.length} rows, ${rows.filter((r) => r.__value != null).length} non-null`);
  console.log(`${C.d}subject expressible as an observation today: ${s.expressible}${C.x}\n`);
  const findings = [];

  if (args.includes('--shared')) {
    for (const f of sharedValue(rows, { field })) findings.push(f);
  } else if (args.includes('--images')) {
    const limit = Number((args.find((a) => a.startsWith('--limit=')) || '').slice(8)) || 60;
    const withVal = rows.filter((r) => r.__value);
    console.log(`${C.d}decoding ${Math.min(limit, withVal.length)} of ${withVal.length} images…${C.x}`);
    for (const r of withVal.slice(0, limit)) {
      const res = await imageSanity({ value: r.__value });
      if (res.severity !== 'pass') findings.push({ ...res, evidence: { ...res.evidence, subject: r.__name, id: r.id } });
    }
  } else {
    if (uc) findings.push(unitCoherence(rows, { currencyKey: uc[0], periodKey: uc[1] }));
    // Cohort displacement needs the whole column. Cohort = the source that
    // produced the row (host if we have a URL, else `source`, else org).
    const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
    const cohortRows = rows.filter((r) => r.__value != null).map((r) => ({
      ...r,
      // Prefer the registry's grouping column: for products `source` is the
      // coarse label "merchant_site" across 2,244 rows from many merchants,
      // which pools regimes the cohort check exists to separate.
      source_host: groupOf(subject_type, r) || hostOf(r.source_url) || r.source || 'unknown',
      __nightly: r.__period ? (toNightly(r.__value, r.__period)?.value ?? r.__value) : r.__value,
    }));
    // One currency at a time — no FX, so cross-currency medians are meaningless.
    for (const cur of [...new Set(cohortRows.map((r) => r.__currency))]) {
      findings.push(...cohortDisplacement(cohortRows.filter((r) => r.__currency === cur)));
    }
    for (const r of rows) {
      if (r.__value == null) continue;
      const ctx = { currency: r.__currency, period: r.__period, group: groupOf(subject_type, r) };
      for (const res of [unitCurrencyRequired({ field, value: r.__value, context: ctx }), numericPlausibility({ subject_type, field, value: r.__value, context: ctx })]) {
        if (res.severity === 'block' || res.severity === 'quarantine') findings.push({ ...res, evidence: { ...res.evidence, subject: r.__name, id: r.id, source_url: r.source_url } });
      }
    }
  }

  const bySev = {};
  for (const f of findings) (bySev[f.severity] ??= []).push(f);
  for (const sev of ['block', 'quarantine', 'flag', 'unknown']) {
    for (const f of (bySev[sev] || []).slice(0, 40)) {
      console.log(`${paint(sev, sev.toUpperCase().padEnd(11))} ${String(f.evidence.subject ?? f.evidence.value ?? '').slice(0, 40).padEnd(42)} ${f.reason}`);
    }
    if ((bySev[sev] || []).length > 40) console.log(`${C.d}  … ${bySev[sev].length - 40} more ${sev}${C.x}`);
  }
  console.log(`\n${findings.length} findings: ` + ['block', 'quarantine', 'flag', 'unknown'].map((s2) => `${(bySev[s2] || []).length} ${s2}`).join(', '));
  console.log(`${C.d}This tool reports. Remediation belongs to the scripts that preserve a restore path.${C.x}`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'bands') return cmdBands(rest);
  if (cmd === 'audit') return cmdAudit(rest[0], rest[1], rest.slice(2));
  if (cmd === 'selftest') return (await import('./validate.selftest.mjs')).run();
  console.log(`usage:
  node scripts/entity/validate.mjs bands [--k=4.0]
  node scripts/entity/validate.mjs audit <subject_type> <field> [--shared|--images [--limit=N]]
  node scripts/entity/validate.mjs selftest
subject types: ${Object.keys(SUBJECTS).join(', ')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
