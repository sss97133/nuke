#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// adjudicate.mjs — THE VERDICT LAYER, universal across subject types.
// ════════════════════════════════════════════════════════════════════════════
//
// For any (subject_type, subject_id[, field]) compute, over every witness:
//   VERDICT     the value to serve — by witness tier, recency, corroboration
//   CITATIONS   how many independent witnesses support it, and which
//   FRESHNESS   age of the newest supporting observation
//   CONFLICTS   disagreements listed, never silently resolved
//   CONFIDENCE  derived and drillable to the rows that produced it
//
// USAGE
//   cd /Users/skylar/nuke
//   dotenvx run --quiet -- node scripts/entity/adjudicate.mjs <type> <id> [--field=F] [--json]
//   dotenvx run --quiet -- node scripts/entity/adjudicate.mjs --score <type> [<id>] [--json]
//   dotenvx run --quiet -- node scripts/entity/adjudicate.mjs --demo      # the 5-subject proof
//
// READ-ONLY. There is no write path in this tool, deliberately: a stored
// verdict rots the instant a new observation lands (the flat-price defect that
// produced 27x-wrong villa prices). Verdicts are computed at call time, always.
//
// EXTENDS, DOES NOT REPLACE (liveness-and-intent rule 1 — unwired != dead):
//   • scripts/entity/validate.mjs — SUBJECTS registry, db(), toNightly(),
//     validate(). Imported, not reimplemented. Adding a subject type is still
//     one row in THAT file.
//   • vehicle_current_state (live view, read by the app) — left untouched.
//   • v_org_authentication (live view, read by the L'Officiel app + producer
//     board) — left untouched. `--score` computes the GENERALISED score in
//     this script; the SQL generalisation is a PROPOSAL, not an application.
//   • v_villa_channel_dispersion (live view) — already does per-field rate
//     conflict detection for villas, but emits pairs with no verdict. The
//     property adapter below reads the same substrate and adds the verdict
//     layer on top. That view is not altered (a concurrent workflow owns it).
// ════════════════════════════════════════════════════════════════════════════

import { db, SUBJECTS, toNightly, validate } from './validate.mjs';
import { adjudicate, groupKey } from './_adjudication.mjs';

const NOW = Date.now();
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const JSONOUT = flag('json');

// ════════════════════════════════════════════════════════════════════════════
// SOURCE TRUST — measured, never assumed.
// ════════════════════════════════════════════════════════════════════════════
// base_trust comes from observation_sources or it is null. An unregistered
// witness gets null, NOT a default 0.5 — a guessed trust is a fabricated fact
// and it would let an unvetted scraper out-vote a registry.
let _sources = null;
async function sources() {
  if (_sources) return _sources;
  const { data, error } = await db().from('observation_sources')
    .select('id,slug,display_name,base_trust_score,tier,category,decay_half_life_days');
  if (error) throw new Error(`observation_sources: ${error.message}`);
  _sources = { byId: new Map(data.map((s) => [s.id, s])), bySlug: new Map(data.map((s) => [s.slug, s])) };
  return _sources;
}

let _props = null;
async function properties() {
  if (_props) return _props;
  const { data, error } = await db().from('observation_properties')
    .select('id,property_key,data_type,unit,cardinality,discriminator_key,verification_scope,trust_floor,namespace,category');
  if (error) throw new Error(`observation_properties: ${error.message}`);
  _props = new Map(data.map((p) => [p.property_key, p]));
  return _props;
}

// ════════════════════════════════════════════════════════════════════════════
// WITNESS ADAPTERS
// ════════════════════════════════════════════════════════════════════════════
// An adapter turns some existing substrate into uniform claims. Each claim is
//   { subject_type, subject_id, property_key, discriminator_key/value, value,
//     witness, base_trust, confidence, kind, observed_at, adapter, provenance }
//
// WHY ADAPTERS AND NOT "JUST READ vehicle_observations":
// Measured 2026-07-20 — the whole table holds exactly ONE non-vehicle row. Org
// and property facts live in structured tables (organizations.metadata,
// villa_inventory) because the polymorphic write path only opened on
// 2026-06-17 and `property` is still rejected by the CHECK constraint. An
// adjudicator that reads only observations would return "no witnesses" for
// every org and every villa on the platform and would look, wrongly, like the
// data does not exist.
//
// Adapters are READ-ONLY PROJECTIONS. They are not a second write path and
// they do not fork the substrate (feedback: no-standalone-artifact-surfaces).
// Each is tagged `layer: 'pre_observation'`, which makes the migration backlog
// self-reporting: every pre_observation claim is a claim that SHOULD be a real
// observation once its subject type is expressible.
const ADAPTERS = {};

const OBS_COLS = 'id,vehicle_id,kind,structured_data,confidence_score,observed_at,source_id,source_url,property_id,is_superseded,rank,content_text';
const MAX_OBS = Number(opt('max-observations') ?? 20000);

// Paged read of vehicle_observations. Stable order by id so pages cannot
// overlap or skip. Stops at MAX_OBS and SAYS SO rather than silently
// truncating — a verdict computed over an unannounced subset is a lie.
async function pageObs(tweak) {
  const out = [];
  for (let from = 0; from < MAX_OBS; from += 1000) {
    let q = db().from('vehicle_observations').select(OBS_COLS).order('id', { ascending: true }).range(from, from + 999);
    const { data, error } = await tweak(q);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) return out;
  }
  out.truncatedAt = MAX_OBS;
  return out;
}

// ── 1. observations (universal, primary) ────────────────────────────────────
ADAPTERS.observations = {
  layer: 'canonical',
  applies: () => true,
  async gather(type, id) {
    const src = await sources();
    const props = await properties();
    let rows, degraded = null;

    if (type === 'vehicle') {
      // PostgREST caps at 1000 and silently CLAMPS anything larger — exactly
      // 1000 is the cap, not the truth. Measured cost of getting this wrong:
      // an unpaginated read of vehicle a90c008a returned only the iphoto
      // witness for exterior_color and reported "1 witness, no conflict",
      // hiding the ai-description-extraction witness entirely. A truncated
      // read does not degrade a verdict, it FALSIFIES it — the missing rows
      // are invisible. Always page.
      rows = await pageObs((q) => q.eq('vehicle_id', id).eq('is_superseded', false));
    } else {
      // MEASURED BOTTLENECK — there is NO index on (subject_type, subject_id).
      // pg_indexes shows 22 indexes on vehicle_observations, none on subject.
      // Guide 20 §7 step 1 explicitly deferred it "to a concurrent follow-up
      // once non-vehicle rows exist". Non-vehicle rows now exist, so the
      // follow-up is due.
      //
      // Measured 2026-07-20, not assumed (production-engineering law 2 — time
      // it before you theorize):
      //     .eq('subject_id', <one org uuid>)  -> 1 row in  53,511 ms
      //     .eq('subject_type','organization') -> 5 rows in 39,469 ms
      // A seq scan over 10,249,718 rows to return one row. It does NOT throw
      // via PostgREST (its timeout is generous) — it just costs ~53s per
      // subject, which is why this is a bottleneck and not a crash. The same
      // predicate DOES time out through the MCP SQL path (statement_timeout).
      // So the failure is silent-ish and slow, the worst combination.
      // Proposed fix in the migration proposal doc; owner-gated, not applied.
      //
      // Degrade honestly if it ever does throw, rather than returning zero
      // witnesses silently (silent failure is the house style of broken
      // systems — production-engineering law 6).
      try {
        rows = await pageObs((q) => q.eq('subject_type', type).eq('subject_id', id));
      } catch (e) {
        rows = [];
        degraded = `observation adapter unavailable for subject_type='${type}': ${String(e.message).slice(0, 120)} — no index on (subject_type, subject_id); see MIGRATION PROPOSAL in docs`;
      }
    }

    const claims = [];
    if (rows?.truncatedAt) degraded = `read stopped at ${rows.truncatedAt} observations — verdict computed over a SUBSET; raise --max-observations`;
    for (const r of rows ?? []) {
      const sd = r.structured_data || {};
      const s = src.byId.get(r.source_id);
      // Per-field grammar, ALREADY LIVE IN PROD: structured_data.property_key +
      // .value + the property_id FK. Measured on the K5: 1,848 rows, 14 keys,
      // property_id populated on 100% of them. This grammar was not invented
      // here — it is read.
      if (sd.property_key) {
        const p = props.get(sd.property_key);
        claims.push(mkClaim({
          type, id, property_key: sd.property_key, value: sd.value,
          prop: p, discriminator_value: p?.discriminator_key ? sd[p.discriminator_key] : null,
          witness: s?.slug ?? 'unregistered', base_trust: s?.base_trust_score ?? null,
          confidence: r.confidence_score, kind: r.kind, observed_at: r.observed_at,
          adapter: 'observations', layer: 'canonical', observation_id: r.id,
          source_url: r.source_url, excerpt: r.content_text,
          provenance: { rank: r.rank, property_id: r.property_id },
        }));
        continue;
      }
      // Legacy blob observations: each scalar key is its own claim. This is
      // how the per-field verdict reaches the ~10.2M rows written before the
      // property grammar existed, without rewriting a single one of them.
      for (const [k, v] of Object.entries(sd)) {
        if (v == null || typeof v === 'object') continue;
        if (['quote', 'confidence', 'field', 'value', 'image_id'].includes(k)) continue;
        const p = props.get(k);
        claims.push(mkClaim({
          type, id, property_key: k, value: v, prop: p,
          discriminator_value: p?.discriminator_key ? sd[p.discriminator_key] : null,
          witness: s?.slug ?? 'unregistered', base_trust: s?.base_trust_score ?? null,
          confidence: r.confidence_score, kind: r.kind, observed_at: r.observed_at,
          adapter: 'observations', layer: 'canonical', observation_id: r.id,
          source_url: r.source_url, excerpt: sd.quote ?? null,
          provenance: { rank: r.rank, legacy_blob: true },
        }));
      }
    }
    return { claims, degraded };
  },
};

// ── 2. org geocode (organization) ───────────────────────────────────────────
// organizations.metadata.geocode carries a stored position AND, when Apple
// Maps disagreed, a `conflict` block naming the rival position and the
// measured delta in metres. That is a two-witness disagreement with full
// provenance already sitting in prod — 33 of them, measured. v_org_authentication
// reads the same block as a boolean `geo_conflict` and then throws the detail
// away. This adapter keeps it.
ADAPTERS.org_geocode = {
  layer: 'pre_observation',
  applies: (t) => t === 'organization',
  async gather(type, id) {
    const { data, error } = await db().from('organizations')
      .select('id,name,latitude,longitude,metadata').eq('id', id).maybeSingle();
    if (error) throw new Error(`organizations: ${error.message}`);
    if (!data) return { claims: [] };
    const g = data.metadata?.geocode ?? {};
    const claims = [];
    // ── READ THE DATE THE SUBSTRATE ALREADY CARRIES ────────────────────────
    // MEASURED 2026-07-20, and this adapter got it wrong first: the geocode
    // block stores its observation date under the key `at`, NOT `geocoded_at`.
    //   organizations 4fd7de3a GEOTOPO -> {"at":"2026-07-02","source":"nominatim",...}
    // Of 1,323 orgs carrying metadata.geocode with coordinates:
    //   1,077 (81.4%) date it under `at`   <- the key the original chain missed
    //     246 (18.6%) date it under `geocoded_at`
    //       0 carry no date at all
    // So the `?? Date.now()` tail was not a rare last resort — it was the
    // branch that fired for four out of five organizations, restamping a
    // 2026-07-02 nominatim fix as observed TODAY. That is precisely the
    // backfill defect the brief names: real provenance existed on the source
    // row and the reader overwrote it with 'now', making stale geocodes look
    // permanently fresh. `at` goes first; the now-fallback is DELETED rather
    // than reordered, because a fabricated date is worse than no date.
    const at = g.at ?? g.observed_at ?? g.geocoded_at ?? g.flagged_at ?? data.metadata?.updated_at ?? null;
    if (data.latitude != null) {
      claims.push(mkClaim({
        type, id, property_key: 'geo_point', value: fmtGeo(data.latitude, data.longitude), cardinality: 'single',
        witness: g.source ?? 'unrecorded', base_trust: null, confidence: null,
        kind: 'specification', observed_at: at, adapter: 'org_geocode', layer: 'pre_observation',
        provenance: { stored: true, geocode_source: g.source ?? null, apple_confirmed_m: g.apple_confirmed_m ?? null },
      }));
    }
    if (g.conflict?.apple_lat != null) {
      claims.push(mkClaim({
        type, id, property_key: 'geo_point', value: fmtGeo(g.conflict.apple_lat, g.conflict.apple_lon), cardinality: 'single',
        witness: g.conflict.source ?? 'applemaps', base_trust: null, confidence: null,
        kind: 'specification', observed_at: g.conflict.flagged_at ?? at,
        adapter: 'org_geocode', layer: 'pre_observation',
        provenance: { delta_m: g.conflict.delta_m, flagged_at: g.conflict.flagged_at },
      }));
    }
    return { claims };
  },
};

// ── 3. villa listings (property) ────────────────────────────────────────────
// Each villa_inventory row is one agency's listing of a villa: an independent
// witness with its own price, bedroom count and source host. 1,210 rows over
// 612 distinct names. v_villa_canonical resolves these with
// `DISTINCT ON (lower(name))` — it silently keeps one listing and discards the
// rest. That IS the silent resolution THE FRAME forbids, and it is how a
// 19,285/night witness and a 120,000/night witness for villa "Neo" collapse
// into one number with no visible disagreement.
ADAPTERS.villa_listing = {
  layer: 'pre_observation',
  applies: (t) => t === 'property',
  async gather(type, id) {
    const { data: self, error } = await db().from('properties')
      .select('id,name,base_price,price_currency,price_period').eq('id', id).maybeSingle();
    if (error) throw new Error(`properties: ${error.message}`);
    if (!self?.name) return { claims: [] };
    const { data: peers, error: pe } = await db().from('villa_inventory')
      .select('id,name,base_price,price_currency,price_period,bedrooms,max_guests,source_url,manager_name,latitude,longitude')
      .ilike('name', self.name).limit(1000);
    if (pe) throw new Error(`villa_inventory: ${pe.message}`);

    const claims = [];
    const periods = new Set(), currencies = new Set();
    for (const p of peers ?? []) {
      const host = p.source_url ? p.source_url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] : (p.manager_name ?? 'unknown');
      const nightly = p.base_price != null ? toNightly(Number(p.base_price), p.price_period) : null;
      if (p.price_period) periods.add(String(p.price_period).toLowerCase());
      if (p.base_price != null && p.price_currency) currencies.add(String(p.price_currency).toUpperCase());
      if (p.base_price != null) {
        // ── COMPARE LIKE WITH LIKE, OR DO NOT COMPARE ────────────────────
        // MEASURED on villa "Neo" (2026-07-20), the case that makes this
        // non-negotiable:
        //     wimco.com   19,285.71 USD / night
        //     sibarth.com 120,000.00 USD / week
        // Compared raw, that is a 6.2x "conflict" and any winner-picking is a
        // 6x error. Normalised, sibarth is 17,142.86/night and the two
        // witnesses agree within 12.5%. The 6x disagreement was never real —
        // it was a units artefact, and it is the same shape as the flat-scalar
        // defect that produced the 27x-wrong villa prices.
        //
        // toNightly() is definitional only (a week is 7 nights); it fabricates
        // nothing. Currency is NEVER converted — an FX rate at an observed time
        // is a fact I would have to invent (AGENTS.md invariant 1), so claims
        // in different currencies are marked unresolvable instead.
        const comparable = nightly != null;
        claims.push(mkClaim({
          type, id,
          property_key: comparable ? 'base_price_nightly' : 'base_price',
          value: comparable ? Math.round(nightly.value * 100) / 100 : Number(p.base_price),
          cardinality: 'single',
          witness: host, base_trust: null, confidence: null,
          // UNDATED, AND SAID SO. villa_inventory has NO timestamp column of
          // any kind (verified against information_schema 2026-07-20: 22
          // columns, not one of them temporal). The original code stamped
          // Date.now() here, which under kind='listing' (90-day half-life)
          // reported every villa rate as relevance 1.0 / 'fresh' forever.
          // A rate scraped in January would have read as observed today.
          // Today those claims block on unknown trust anyway — but four
          // add_source proposals for these very hosts are sitting open in
          // schema_proposals, and the moment one is approved these claims
          // become servable AND permanently fresh in the same instant. null
          // is the honest value; the adjudicator refuses to serve on it.
          kind: 'listing', observed_at: null,
          adapter: 'villa_listing', layer: 'pre_observation', source_url: p.source_url,
          provenance: {
            observed_at_unknown: 'villa_inventory carries no timestamp column',
            currency: p.price_currency, period: p.price_period,
            as_listed: Number(p.base_price), normalised_by: comparable ? `÷${nightly.factor} (${p.price_period}→night, definitional)` : null,
            listing_id: p.id, manager: p.manager_name,
          },
        }));
      }
      if (p.bedrooms != null) {
        claims.push(mkClaim({
          type, id, property_key: 'bedrooms', value: p.bedrooms, cardinality: 'single',
          witness: host, base_trust: null, confidence: null,
          kind: 'listing', observed_at: null, // see note above — no timestamp exists to read
          adapter: 'villa_listing', layer: 'pre_observation', source_url: p.source_url,
          provenance: { observed_at_unknown: 'villa_inventory carries no timestamp column', listing_id: p.id },
        }));
      }
    }
    // Periods are reconciled above (definitional). CURRENCIES are not, and
    // cannot be without inventing an FX rate — so a multi-currency group is
    // genuinely unresolvable and is marked as such rather than guessed.
    const unit_conflict = currencies.size > 1
      ? `witnesses quote different currencies (${[...currencies].join(' vs ')}) — unresolvable without an FX rate at the observed time, which would be a fabricated fact. Adjudicate per-currency.`
      : null;
    if (unit_conflict) for (const c of claims) if (String(c.property_key).startsWith('base_price')) c.unit_conflict = unit_conflict;
    return { claims };
  },
};

function fmtGeo(lat, lon) { return `${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`; }

function mkClaim(o) {
  return {
    subject_type: o.type, subject_id: o.id,
    property_key: o.property_key, value: o.value,
    // registered=false means the registry has nothing to say about this key,
    // and the adjudicator refuses to invent a cardinality for it.
    // An adapter MAY declare cardinality for a field it defines itself (a villa
    // listing has exactly one base_price; an org has one position) — that is
    // the adapter's own contract, not a guess about someone else's data. It is
    // recorded as 'adapter_declared' so the distinction stays visible, and it
    // is still a standing reason to register the key properly.
    registered: o.prop ? 'registry' : (o.cardinality ? 'adapter_declared' : false),
    cardinality: o.prop?.cardinality ?? o.cardinality ?? null,
    discriminator_key: o.prop?.discriminator_key ?? null,
    discriminator_value: o.discriminator_value ?? null,
    category: o.prop?.category ?? null,
    witness: o.witness, base_trust: o.base_trust, confidence: o.confidence,
    kind: o.kind, observed_at: o.observed_at,
    adapter: o.adapter, layer: o.layer,
    observation_id: o.observation_id ?? null, source_url: o.source_url ?? null,
    excerpt: o.excerpt ?? null, provenance: o.provenance ?? null,
    unit_conflict: o.unit_conflict ?? null,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// THE VERDICT PASS
// ════════════════════════════════════════════════════════════════════════════
export async function adjudicateSubject(type, id, { field = null } = {}) {
  if (!SUBJECTS[type]) throw new Error(`unknown subject_type "${type}" — known: ${Object.keys(SUBJECTS).join(', ')}`);
  const all = [], notes = [], used = [];
  for (const [name, a] of Object.entries(ADAPTERS)) {
    if (!a.applies(type)) continue;
    const { claims, degraded } = await a.gather(type, id);
    if (degraded) notes.push(degraded);
    if (claims.length) used.push(`${name}(${claims.length})`);
    all.push(...claims);
  }
  const scoped = field ? all.filter((c) => c.property_key === field) : all;

  const groups = new Map();
  for (const c of scoped) {
    const k = groupKey(c);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const fields = [...groups.values()].map((g) => adjudicate(g, { now: NOW })).filter(Boolean);

  // ── ADMISSIBILITY: winning an argument is not the same as being credible ──
  // adjudicate() answers "which witness wins?". validate() answers "is this
  // value admissible at all?". They are different questions and both must
  // pass. A villa whose only witness quotes 2,000,000/night wins its group
  // uncontested and is still not a number to serve.
  //
  // This composes THE OTHER universal tool rather than reimplementing its
  // checks (validate.mjs owns bands, unit/currency requirements, image sanity,
  // the entity gate). Only numeric verdicts are checked here because that is
  // where validate() works without network I/O; image and geo admissibility
  // are available in validate.mjs and are the obvious next wiring.
  for (const f of fields) {
    if (f.verdict_blocked || f.verdict == null || typeof f.verdict !== 'number') continue;
    const ctx = f.confidence?.components?.[0] ?? {};
    const prov = (groups.get(`${type} ${id} ${f.field} ${f.discriminator?.value ?? ''}`) ?? [])[0]?.provenance ?? {};
    const v = await validate({
      subject_type: type, field: f.field, value: f.verdict,
      context: { currency: prov.currency, period: prov.period, is_money: /price|rate|cost|fee/i.test(f.field) },
    });
    f.admissibility = { verdict: v.verdict, checks: v.checks.filter((c) => c.severity !== 'pass') };
    if (v.verdict === 'block' || v.verdict === 'quarantine') {
      f.verdict_blocked = true;
      f.reason = `won its group but is inadmissible — validate(): ${v.checks.find((c) => c.severity === v.verdict)?.reason ?? v.verdict}`;
      f.verdict = null; f.confidence = null;
    }
  }

  fields.sort((a, b) => (b.conflicts.length - a.conflicts.length) || String(a.field).localeCompare(String(b.field)));

  return {
    subject_type: type, subject_id: id,
    expressible_as_observation: SUBJECTS[type].expressible,
    adapters_used: used, notes,
    witness_total: new Set(scoped.map((c) => c.witness)).size,
    claim_total: scoped.length,
    fields_adjudicated: fields.length,
    conflicted_fields: fields.filter((f) => f.conflicts.length).length,
    blocked_fields: fields.filter((f) => f.verdict_blocked).length,
    fields,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// THE EVIDENCE SCORE — generalised from v_org_authentication.
// ════════════════════════════════════════════════════════════════════════════
// v_org_authentication scores orgs on six axes (location, mark, catalogue,
// feed, editorial, story) -> score 0-6 -> band absent/emerging/established/
// embedded -> dispatch_gaps. That model is GOOD and it is LIVE (the L'Officiel
// app and the producer board read it). It is extended here, not replaced:
// the same axis names, the same band thresholds, the same gap list. What is
// added is (a) other subject types, and (b) drill — every axis carries the
// witnesses that satisfied it, so a score can be argued with.
//
// THE ax_mark DEFECT, fixed here (the brief asked for it in passing):
//   live:  ax_mark := (logo_url IS NOT NULL)
// That scores a mark as authentic when the stored image is a blank knockout
// that composites to nothing on the paper ground, or a 16x16 favicon standing
// in for a logo. repair-blank-marks.mjs already MEASURED both classes and
// wrote metadata.mark_quarantine / metadata.mark_quality. The live view
// ignores both. Measured now: 1,011 orgs have a logo_url; 355 carry a
// mark_quarantine; 8 carry mark_quality=low_resolution_favicon AND still have
// a non-null logo_url — so 8 orgs are scoring an authenticated mark off a
// favicon. Honest version below: a mark counts when it is present, not
// quarantined, and not a known-inadequate stand-in.
const AXES = {
  organization: [
    { ax: 'ax_location', need: 'storefront survey', test: (o) => {
        const g = o.metadata?.geocode ?? {};
        const good = ['field_survey', 'applemaps_localsearch', 'osm_poi_name_match'].includes(g.source)
          || g.apple_confirmed_m != null || g.corroborated != null;
        return { pass: !!good && g.conflict == null, why: g.conflict ? `geo conflict ${g.conflict.delta_m}m vs ${g.conflict.source}` : (g.source ?? 'no geocode') };
      } },
    { ax: 'ax_mark', need: 'capture mark', test: (o) => {
        if (!o.logo_url) return { pass: false, why: o.metadata?.mark_quarantine ? `quarantined: ${o.metadata.mark_quarantine.reason}` : 'no mark' };
        if (o.metadata?.mark_quarantine?.nulled) return { pass: false, why: `quarantined: ${o.metadata.mark_quarantine.reason}` };
        if (o.metadata?.mark_quality?.reason === 'low_resolution_favicon')
          return { pass: false, why: `low-res stand-in (${o.metadata.mark_quality.detail?.slice(0, 60)}) — MEASURED, live view scores this true` };
        return { pass: true, why: 'mark present, not quarantined, not a known stand-in' };
      } },
    { ax: 'ax_catalogue', need: 'ingest catalogue', rel: 'products' },
    { ax: 'ax_feed', need: 'instagram connect', rel: 'feed' },
    { ax: 'ax_editorial', need: 'editorial link', rel: 'editorial' },
    // ax_story matches the LIVE view's field exactly: NULLIF(metadata->>'description','').
    // It deliberately does NOT fall back to the organizations.description COLUMN.
    //
    // I had it read the column first and it silently diverged from prod:
    // MAURICE CAR RENTAL has description (column) but no metadata.description,
    // so my score said 1/6 while v_org_authentication said 0 on that axis.
    // Whether the column counts as a story is a SUBSTRATE question with a real
    // answer somewhere (which writer fills which field, and is the column
    // aggregator boilerplate?) — not something a scoring tool gets to decide
    // by picking the more generous branch. Matching prod and reporting the
    // divergence is the honest move; the fallback is a silent score inflation.
    // OPEN QUESTION FOR THE OWNER — see the migration proposal doc.
    { ax: 'ax_story', need: 'read profile', test: (o) => {
        const meta = o.metadata?.description;
        const q = o.metadata?.quarantine?.description;
        const divergent = !meta && !!o.description;
        return {
          pass: !!(meta && String(meta).trim()),
          why: q ? 'quarantined as aggregator template'
            : divergent ? 'no metadata.description; a description COLUMN exists but the live view ignores it — divergence, not scored'
            : (meta ? 'metadata.description present' : 'no description'),
        };
      } },
  ],
  property: [
    { ax: 'ax_location', need: 'geo fix', test: (p) => ({ pass: p.latitude != null && p.longitude != null, why: p.latitude != null ? 'coordinates present' : 'no coordinates' }) },
    { ax: 'ax_mark', need: 'capture imagery', rel: 'images' },
    { ax: 'ax_catalogue', need: 'rate card', test: (p) => ({ pass: p.base_price != null && p.price_currency != null && p.price_period != null, why: p.base_price == null ? 'no price' : (p.price_period == null ? 'price without a period — not defensible' : 'priced with unit') }) },
    { ax: 'ax_feed', need: 'availability calendar', rel: 'availability' },
    { ax: 'ax_editorial', need: 'editorial link', rel: 'editorial' },
    { ax: 'ax_story', need: 'read profile', test: (p) => ({ pass: !!(p.description ?? p.tagline), why: 'description/tagline' }) },
  ],
  vehicle: [
    { ax: 'ax_location', need: 'sighting/location', rel: 'obs_location' },
    { ax: 'ax_mark', need: 'capture imagery', rel: 'images' },
    { ax: 'ax_catalogue', need: 'specification', rel: 'obs_spec' },
    { ax: 'ax_feed', need: 'recent observation', rel: 'obs_recent' },
    { ax: 'ax_editorial', need: 'listing/editorial', rel: 'obs_listing' },
    { ax: 'ax_story', need: 'provenance', rel: 'obs_provenance' },
  ],
};
const BAND = (s) => (s >= 5 ? 'embedded' : s >= 3 ? 'established' : s >= 1 ? 'emerging' : 'absent');

async function scoreSubject(type, id) {
  const spec = AXES[type];
  if (!spec) throw new Error(`no evidence axes defined for '${type}'. Axes are per-type by design (the brief: "axes appropriate to its type") — add a row to AXES.`);
  const s = SUBJECTS[type];
  const { data: row, error } = await db().from(s.table).select('*').eq(s.pk, id).maybeSingle();
  if (error) throw new Error(`${s.table}: ${error.message}`);
  if (!row) throw new Error(`${type} ${id} not found`);

  const rel = {};
  if (type === 'organization') {
    rel.products = (await db().from('concierge_products').select('id', { count: 'exact', head: true }).eq('org_id', id).eq('status', 'live').eq('is_superseded', false)).count ?? 0;
    rel.feed = (await db().from('concierge_partner_connections').select('id', { count: 'exact', head: true }).eq('org_id', id).eq('channel', 'instagram').eq('status', 'connected')).count ?? 0;
    rel.editorial = (await db().from('organization_brands').select('id', { count: 'exact', head: true }).eq('organization_id', id)).count ?? 0;
  } else if (type === 'property') {
    rel.images = (await db().from('property_images').select('id', { count: 'exact', head: true }).eq('property_id', id)).count ?? 0;
    rel.availability = (await db().from('villa_availability_observations').select('id', { count: 'exact', head: true }).eq('property_id', id)).count ?? 0;
    rel.editorial = 0;
  } else if (type === 'vehicle') {
    const kinds = ['sighting', 'specification', 'listing', 'provenance'];
    for (const k of kinds) {
      rel[`obs_${k === 'sighting' ? 'location' : k === 'specification' ? 'spec' : k}`] =
        (await db().from('vehicle_observations').select('id', { count: 'exact', head: true }).eq('vehicle_id', id).eq('kind', k).eq('is_superseded', false)).count ?? 0;
    }
    rel.images = (await db().from('vehicle_images').select('id', { count: 'exact', head: true }).eq('vehicle_id', id)).count ?? 0;
    const recent = await db().from('vehicle_observations').select('observed_at').eq('vehicle_id', id)
      .gte('observed_at', new Date(NOW - 365 * 86400000).toISOString()).limit(1);
    rel.obs_recent = recent.data?.length ?? 0;
  }

  const axes = spec.map((a) => {
    const r = a.test ? a.test(row) : { pass: (rel[a.rel] ?? 0) > 0, why: `${a.rel}=${rel[a.rel] ?? 0}` };
    return { axis: a.ax, pass: !!r.pass, evidence: r.why, need: a.need };
  });
  const score = axes.filter((a) => a.pass).length;
  return {
    subject_type: type, subject_id: id, name: row[s.nameCol] ?? null,
    score, of: axes.length, band: BAND(score),
    axes,
    dispatch_gaps: axes.filter((a) => !a.pass).map((a) => a.need),
    extends: 'v_org_authentication (live, unmodified) — same axes, same bands, same gap list; adds other subject types + per-axis drill + the honest ax_mark',
  };
}

// ════════════════════════════════════════════════════════════════════════════
// RENDER
// ════════════════════════════════════════════════════════════════════════════
const C = { r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', c: '\x1b[36m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };

function render(res) {
  console.log(`\n${C.b}${res.subject_type}${C.x} ${res.subject_id}`);
  console.log(`${C.d}adapters: ${res.adapters_used.join(' ') || '(none)'} · witnesses ${res.witness_total} · claims ${res.claim_total} · fields ${res.fields_adjudicated} · conflicted ${res.conflicted_fields} · blocked ${res.blocked_fields}${C.x}`);
  if (!res.expressible_as_observation) console.log(`${C.y}  ! subject_type '${res.subject_type}' is NOT writable to vehicle_observations (CHECK constraint) — all claims below are pre_observation substrate${C.x}`);
  for (const n of res.notes) console.log(`${C.y}  ! ${n}${C.x}`);
  for (const f of res.fields) {
    const disc = f.discriminator ? `${C.d}[${f.discriminator.key}=${f.discriminator.value}]${C.x}` : '';
    if (f.shape === 'set') {
      console.log(`\n  ${C.c}${f.field}${C.x} ${disc} ${C.d}SET (${f.values.length}) — ${f.reason}${C.x}`);
      continue;
    }
    const head = f.verdict_blocked
      ? `${C.r}BLOCKED${C.x} ${C.d}${f.reason}${C.x}`
      : `${C.g}${JSON.stringify(f.verdict)}${C.x} ${C.d}conf ${f.confidence.score} · ${f.citation_count} witness${f.citation_count === 1 ? '' : 'es'} · ${f.freshness}${C.x}`;
    console.log(`\n  ${C.c}${f.field}${C.x} ${disc} → ${head}`);
    for (const c of f.citations) {
      console.log(`      ${C.d}cite${C.x} ${c.witness} ${C.d}trust=${c.trust} ${c.observed_at ? '@' + String(c.observed_at).slice(0, 10) : 'observed=undated'}${c.source_url ? ' ' + c.source_url.slice(0, 60) : ''}${C.x}`);
    }
    for (const k of f.conflicts) {
      console.log(`      ${C.y}conflict${C.x} ${JSON.stringify(k.value)} ${C.d}weight=${k.total_weight ?? 'unknown-trust'} · ${k.witness_count} witness(es): ${k.witnesses.join(', ')}${C.x}`);
    }
  }
  console.log('');
}

function renderScore(s) {
  console.log(`\n${C.b}${s.subject_type}${C.x} ${s.name ?? s.subject_id} ${C.d}${s.subject_id}${C.x}`);
  console.log(`  ${C.b}${s.score}/${s.of}${C.x} ${C.c}${s.band}${C.x}`);
  for (const a of s.axes) console.log(`    ${a.pass ? C.g + '✓' : C.r + '✗'}${C.x} ${a.axis.padEnd(14)} ${C.d}${a.evidence}${C.x}`);
  if (s.dispatch_gaps.length) console.log(`  ${C.y}gaps:${C.x} ${s.dispatch_gaps.join(' · ')}`);
  console.log('');
}

// ════════════════════════════════════════════════════════════════════════════
// CLI
// ════════════════════════════════════════════════════════════════════════════
async function main() {
  if (flag('demo')) return demo();

  if (flag('score')) {
    const rest = args.filter((a) => !a.startsWith('--'));
    const [type, id] = rest;
    if (!type) throw new Error('usage: --score <subject_type> <id>');
    const out = await scoreSubject(type, id);
    return JSONOUT ? console.log(JSON.stringify(out, null, 2)) : renderScore(out);
  }

  const rest = args.filter((a) => !a.startsWith('--'));
  const [type, id] = rest;
  if (!type || !id) {
    console.log(`usage:
  adjudicate.mjs <subject_type> <subject_id> [--field=F] [--json]
  adjudicate.mjs --score <subject_type> <subject_id> [--json]
  adjudicate.mjs --demo

subject types: ${Object.keys(SUBJECTS).join(', ')}`);
    process.exit(1);
  }
  const out = await adjudicateSubject(type, id, { field: opt('field') });
  return JSONOUT ? console.log(JSON.stringify(out, null, 2)) : render(out);
}

// ── The proof: 5 subjects, 3 entity types, genuinely conflicting witnesses ──
// Every id below was found by measurement (see the session record), not chosen
// to make the tool look good. Two of the five are Skylar's own vehicles.
const DEMO = [
  ['vehicle', 'a90c008a-3379-41d8-9eb2-b4eda365d74c',
    "1 · VEHICLE — 1983 GMC K2500 (Skylar's). VIN: a served verdict with a rival VIN preserved, not deleted. interior_color: owner beats extractor. exterior_color: two witnesses that LOOK like a conflict and are not.",
    null, ['vin', 'interior_color', 'exterior_color']],
  ['vehicle', 'e08bf694-970f-4cbe-8a74-8715158a0f2e',
    "2 · VEHICLE — 1977 K5 Blazer (Skylar's). The discriminator test: 291 traversal groups, ZERO conflicts. Grouped by the wrong key this reports 15+ conflicts that do not exist.",
    'wire_landmark_traversal', null],
  ['organization', '4fd7de3a-9435-4630-a870-2f221426fe2b',
    '3 · ORGANIZATION — GEOTOPO. Stored geocode vs Apple Maps, 4,127 m apart. Blocked: both witnesses unregistered, so neither can be served.',
    null, null],
  ['organization', '3368cfbf-0b93-4e3d-9dd0-661ad3082843',
    '4 · ORGANIZATION — ST BARTH EVASION. 3,388 m geo conflict, same shape.',
    null, null],
  ['property', null,
    '5 · PROPERTY — villa NEO. wimco 19,285.71/night vs sibarth 120,000/week. Raw, that is a 6.2x "conflict"; normalised it is 12.5%. Blocked on unknown trust — never a price we cannot defend.',
    null, null],
];

async function demo() {
  for (const [type, id0, why, field, only] of DEMO) {
    let id = id0;
    if (type === 'property') {
      const { data } = await db().from('properties').select('id,name').ilike('name', 'neo').limit(1);
      if (!data?.length) { console.log(`\n${C.y}skip: no property named "neo"${C.x}`); continue; }
      id = data[0].id;
    }
    console.log(`\n${C.b}${'─'.repeat(76)}${C.x}\n${C.b}${why}${C.x}`);
    const res = await adjudicateSubject(type, id, { field });
    // `only` narrows a broad subject to the named fields for legibility. The
    // counts in the header are always the FULL population, never the filtered
    // one — a demo that quietly reports numbers for a subset would be the
    // truncation lie this tool exists to prevent.
    if (only) res.fields = res.fields.filter((f) => only.includes(f.field));
    render(res);
  }
  console.log(`${C.b}${'─'.repeat(76)}${C.x}\n${C.b}EVIDENCE SCORE — generalised from v_org_authentication${C.x}`);
  renderScore(await scoreSubject('organization', '4fd7de3a-9435-4630-a870-2f221426fe2b'));
  const { data: p } = await db().from('properties').select('id').ilike('name', 'neo').limit(1);
  if (p?.length) renderScore(await scoreSubject('property', p[0].id));
  renderScore(await scoreSubject('vehicle', 'e08bf694-970f-4cbe-8a74-8715158a0f2e'));
}

main().catch((e) => { console.error(`${C.r}${e.message}${C.x}`); process.exit(1); });
