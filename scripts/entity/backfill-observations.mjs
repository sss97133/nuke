#!/usr/bin/env node
// scripts/entity/backfill-observations.mjs — THE BASELINE.
//
// ────────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS
// ────────────────────────────────────────────────────────────────────────────
// The concierge corpus holds thousands of facts (an org's phone, a villa's
// geo, a product's availability) as bare serving columns with NO per-field
// date. An undated fact cannot change: a re-crawl has nothing to diff against,
// so every pass looks like fresh news and nothing can ever be shown to have
// moved. This script converts facts we ALREADY HOLD into dated observations so
// the next crawl produces a *diff*.
//   docs/library/technical/engineering-manual/19-temporal-change-ingestion.md
//
// ADDITIVE ONLY. The source columns are never touched — they remain the
// serving values. This writes testimony beside them, through observe.mjs,
// through ingest-observation. No UPDATE, no DELETE, no overwrite.
//
// ────────────────────────────────────────────────────────────────────────────
// THE DATE LADDER — the load-bearing part, and the easiest thing to fake
// ────────────────────────────────────────────────────────────────────────────
// Every emitted observation carries `observed_at_basis` (the exact JSON path
// the date came from) and `observed_at_confidence`. NOTHING is stamped now().
// The ladder is tried in order; a rung only applies if the value stored in the
// provenance envelope MATCHES the current column value — otherwise that date
// belongs to a superseded value, not to this one, and we fall through.
//
//   ORGANIZATIONS
//    1.00  metadata.access_sb.observed_at        + facts[field] == column value
//    1.00  metadata.web_discovery.observed_at    + wd.website == column value
//    1.00  metadata.geocode.at                   (latitude/longitude only)
//    0.85  metadata.scraped_at                   batch stamp of the
//          (directory-saintbarth.com, 2026-01-30) — the FIELD's own capture
//          time inside that batch is unverified, hence 0.85 not 1.00
//    0.75  metadata.social_searched_at           (social_links only)
//    0.55  metadata.enriched_at / last_enriched_at
//    0.30  created_at  -> UPPER BOUND ONLY. The fact was observed at or before
//          the row was created. Emitted with date_uncertain:true. This is the
//          honest alternative to inventing a timestamp.
//
//   PROPERTIES   metadata.observed_at (1.00) > metadata.ingested_at (0.80) >
//                metadata.scraped_at (0.85) > created_at (0.30)
//   PRODUCTS     concierge_products.observed_at (1.00) — real per-row date
//
// ────────────────────────────────────────────────────────────────────────────
// WHAT THE BACKFILL DELIBERATELY SKIPS  (and why that is the right answer)
// ────────────────────────────────────────────────────────────────────────────
// Some concierge facts are ALREADY dated observations with full provenance and
// re-emitting them here would FORK them (guide 20 §7 step 5 — "org facts that
// already live in structured tables are read as proof directly; re-emitting
// them as observations would be a data fork"):
//   • concierge_products.price/currency  — the row itself carries
//     (source, method, observed_at, trust, confidence_score, is_superseded,
//      superseded_by). It IS an observation table wearing a product's name.
//   • price_observations                 — already polymorphic
//     (entity_type, entity_id, …, observed_at, trust) with 3,619 live villa
//     rate rows. Villa pricing has a dated home; it does not need this one.
// observe.mjs REFUSES these by name (`already_dated`). That refusal firing is
// a feature of the run, not a gap in it.
//
// ────────────────────────────────────────────────────────────────────────────
// USAGE
// ────────────────────────────────────────────────────────────────────────────
//   node scripts/entity/backfill-observations.mjs plan                 # all types, dry-run
//   node scripts/entity/backfill-observations.mjs plan organization --limit 200
//   node scripts/entity/backfill-observations.mjs run organization --limit 50 --commit
//   node scripts/entity/backfill-observations.mjs sources              # what must be registered
//   node scripts/entity/backfill-observations.mjs verify               # post-write census
//   always: cd /Users/skylar/nuke && dotenvx run --quiet -- node scripts/entity/… (network needs no sandbox)

import { observe, subjectWritability } from './observe.mjs';
import { db } from './validate.mjs';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sql = async (query) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/execute_sql`, {
    method: 'POST', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t}`);
  return JSON.parse(t);
};

const iso = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d.toISOString(); };
const same = (a, b) => a != null && b != null && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const j = (v) => { if (v == null) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch { return null; } };

// ════════════════════════════════════════════════════════════════════════════
// SOURCES that must exist in observation_sources for the commit path.
// ingest-observation's own error hint is "Register source in observation_sources
// table first" — that table is the designed extension point, not testimony.
// Trust scores are deliberately modest: a scraped directory is a witness, not a
// registry. `access-sb` ALREADY EXISTS and is NOT re-minted — it only needs
// 'specification' appended to supported_observations (purely additive).
// ════════════════════════════════════════════════════════════════════════════
export const REQUIRED_SOURCES = [
  { slug: 'directory-saintbarth', display_name: 'Directory Saint-Barth (directory-saintbarth.com)', category: 'aggregator', tier: 3, base_trust_score: 0.60, decay_half_life_days: 365, supported_observations: ['specification'], notes: 'Island business directory. 1,329 orgs ingested in the 2026-01-30 sweep.' },
  { slug: 'org-web-discovery', display_name: 'Org web discovery (firecrawl_search + entity gate)', category: 'internal', tier: 3, base_trust_score: 0.70, decay_half_life_days: 180, supported_observations: ['specification'], notes: 'scripts/concierge/discover-org-websites.mjs, adjudicated by _org_entity_gate.mjs.' },
  { slug: 'nominatim', display_name: 'Nominatim / OpenStreetMap geocoder', category: 'registry', tier: 3, base_trust_score: 0.65, decay_half_life_days: 730, supported_observations: ['specification'], notes: 'Geocoding only. Precision recorded per-observation.' },
];
export const SOURCE_PATCHES = [
  { slug: 'access-sb', append_supported_observations: ['specification'], why: 'access.sb emits name/phone/address/hours/description — specifications it demonstrably supports. Additive; nothing removed.' },
];

// ════════════════════════════════════════════════════════════════════════════
// MINERS — one per subject type. Each yields {field, value, observed_at,
// basis, confidence, source, method, trust, source_url, quote?}
// ════════════════════════════════════════════════════════════════════════════

const ORG_COLS = 'id,name,business_name,description,website,phone,address,logo_url,social_links,latitude,longitude,metadata,enrichment_sources,last_enriched_at,source_url,discovered_via,created_at';

function* mineOrganization(o) {
  const m = j(o.metadata) || {};
  const acc = m.access_sb || null;
  const wd = m.web_discovery || null;
  const geo = m.geocode || null;
  const social = j(o.social_links);

  // rung 1 — access.sb envelope, per-field value match
  const accAt = iso(acc?.observed_at);
  const accFacts = acc?.facts || {};
  const accFor = (col) => (accAt && same(accFacts[col], o[col]))
    ? { observed_at: accAt, basis: 'organizations.metadata.access_sb.observed_at', confidence: 1.0, source: 'access-sb', method: acc.extraction_method || 'sitemap+jsonld', trust: 'T2', source_url: acc.source_url || o.source_url, quote: accFacts[col] }
    : null;

  // rung 2 — web discovery
  const wdAt = iso(wd?.observed_at);
  const wdWebsite = (wdAt && wd.website && same(wd.website, o.website))
    ? { observed_at: wdAt, basis: 'organizations.metadata.web_discovery.observed_at', confidence: 1.0, source: 'org-web-discovery', method: wd.method || 'firecrawl_search+entity_gate', trust: wd.trust || 'T3', source_url: wd.website, quote: wd.evidence?.[0]?.title }
    : null;

  // rung 3 — geocode
  const geoAt = iso(geo?.at);

  // rung 4 — the directory batch stamp
  const scrapedAt = iso(m.scraped_at);
  const dirRung = (scrapedAt && /directory-saintbarth/i.test(String(m.source || o.discovered_via || '')))
    ? { observed_at: scrapedAt, basis: 'organizations.metadata.scraped_at (directory-saintbarth.com batch)', confidence: 0.85, source: 'directory-saintbarth', method: 'directory_scrape', trust: 'T3', source_url: o.source_url }
    : (scrapedAt ? { observed_at: scrapedAt, basis: 'organizations.metadata.scraped_at', confidence: 0.75, source: 'agent-submission', method: 'scrape', trust: 'T3', source_url: o.source_url } : null);

  // rung 5/6
  const socialAt = iso(m.social_searched_at);
  const enrichAt = iso(m.enriched_at || o.last_enriched_at);
  const enrichRung = enrichAt ? { observed_at: enrichAt, basis: m.enriched_at ? 'organizations.metadata.enriched_at' : 'organizations.last_enriched_at', confidence: 0.55, source: 'agent-submission', method: 'enrichment', trust: 'T3', source_url: o.source_url } : null;

  // rung 7 — UPPER BOUND. Never a fabrication: the fact existed no later than
  // the row that carries it.
  const createdRung = iso(o.created_at)
    ? { observed_at: iso(o.created_at), basis: 'organizations.created_at (UPPER BOUND — true capture time unknown)', confidence: 0.30, source: 'agent-submission', method: 'row_created_upper_bound', trust: 'T4', source_url: o.source_url }
    : null;

  const ladder = (col, extra = []) => [accFor(col), ...extra, dirRung, enrichRung, createdRung].find(Boolean);

  const emit = (field, value, rung, extra = {}) => rung && value != null && value !== ''
    ? { field, value, ...rung, extra } : null;

  const rows = [
    emit('name', o.name || o.business_name, ladder('name')),
    emit('description', o.description, ladder('description')),
    emit('website', o.website, ladder('website', [wdWebsite])),
    emit('phone', o.phone, ladder('phone')),
    emit('address', o.address, ladder('address')),
    emit('logo_url', o.logo_url, ladder('logo_url', [enrichRung])),
    social && Object.keys(social).length
      ? emit('social_links', social, [
          wdAt && wd?.socials ? { observed_at: wdAt, basis: 'organizations.metadata.web_discovery.observed_at', confidence: 1.0, source: 'org-web-discovery', method: wd.method || 'firecrawl_search', trust: 'T3', source_url: o.website } : null,
          socialAt ? { observed_at: socialAt, basis: 'organizations.metadata.social_searched_at', confidence: 0.75, source: 'agent-submission', method: 'social_search', trust: 'T3', source_url: o.website } : null,
          dirRung, enrichRung, createdRung,
        ].find(Boolean))
      : null,
    (o.latitude != null && o.longitude != null)
      ? emit('geo', { latitude: Number(o.latitude), longitude: Number(o.longitude) },
          geoAt
            ? { observed_at: geoAt, basis: 'organizations.metadata.geocode.at', confidence: 1.0, source: (geo.source === 'nominatim' ? 'nominatim' : 'agent-submission'), method: `geocode:${geo.precision || 'unknown'}`, trust: 'T3', source_url: null }
            : (accFor('geo') || dirRung || createdRung),
          { geocode_precision: geo?.precision ?? null })
      : null,
  ].filter(Boolean);
  for (const r of rows) yield r;
}

const PROP_COLS = 'id,name,latitude,longitude,specs,metadata,source_url,discovered_via,property_type,city,region,created_at';

function* mineProperty(p) {
  const m = j(p.metadata) || {};
  const specs = j(p.specs) || {};
  const rung =
    iso(m.observed_at) ? { observed_at: iso(m.observed_at), basis: 'properties.metadata.observed_at', confidence: 1.0, source: m.source || 'agent-submission', method: m.method || 'live_scrape', trust: m.trust || 'T3', source_url: p.source_url }
    : iso(m.scraped_at) ? { observed_at: iso(m.scraped_at), basis: 'properties.metadata.scraped_at', confidence: 0.85, source: m.source || 'agent-submission', method: 'scrape', trust: m.trust || 'T3', source_url: p.source_url }
    : iso(m.ingested_at) ? { observed_at: iso(m.ingested_at), basis: 'properties.metadata.ingested_at (ingest time, not capture time)', confidence: 0.80, source: m.source || 'agent-submission', method: m.method || 'ingest', trust: m.trust || 'T3', source_url: p.source_url }
    : iso(p.created_at) ? { observed_at: iso(p.created_at), basis: 'properties.created_at (UPPER BOUND — true capture time unknown)', confidence: 0.30, source: 'agent-submission', method: 'row_created_upper_bound', trust: 'T4', source_url: p.source_url }
    : null;
  if (!rung) return;
  const bedrooms = specs.bedrooms_max ?? specs.bedrooms_min ?? specs.bedrooms ?? null;
  const out = [
    p.name ? { field: 'name', value: p.name, ...rung } : null,
    (p.latitude != null && p.longitude != null) ? { field: 'geo', value: { latitude: Number(p.latitude), longitude: Number(p.longitude) }, ...rung } : null,
    bedrooms != null ? { field: 'bedrooms', value: Number(bedrooms), ...rung } : null,
    m.agency ? { field: 'agency_channel', value: m.agency, ...rung, extra: { agency_source: m.source ?? null } } : null,
  ].filter(Boolean);
  for (const r of out) yield r;
}

const PROD_COLS = 'id,org_id,name,kind,price,currency,price_unit,status,source,method,observed_at,trust,confidence_score,provenance,created_at';

function* mineProduct(pr) {
  const at = iso(pr.observed_at) || iso(pr.created_at);
  if (!at) return;
  const rung = {
    observed_at: at,
    basis: pr.observed_at ? 'concierge_products.observed_at (real per-row capture date)' : 'concierge_products.created_at (UPPER BOUND)',
    confidence: pr.observed_at ? 1.0 : 0.30,
    source: pr.source || 'agent-submission', method: pr.method || 'scrape', trust: pr.trust || 'T3',
    source_url: (j(pr.provenance) || {}).source_url ?? null,
  };
  // price + currency are DELIBERATELY attempted so observe.mjs's already_dated
  // fork-guard fires and is visible in the report — they must NOT land.
  const out = [
    { field: 'price', value: pr.price, ...rung },
    { field: 'currency', value: pr.currency, ...rung },
    { field: 'availability', value: pr.status, ...rung, extra: { price_unit: pr.price_unit ?? null } },
  ].filter((r) => r.value != null && r.value !== '');
  for (const r of out) yield r;
}

const MINERS = {
  organization: { cols: ORG_COLS, table: 'organizations', mine: mineOrganization },
  property: { cols: PROP_COLS, table: 'properties', mine: mineProperty },
  product: { cols: PROD_COLS, table: 'concierge_products', mine: mineProduct },
};

// ════════════════════════════════════════════════════════════════════════════
// PAGED READ — PostgREST caps at 1000 and silently clamps larger limits.
// ════════════════════════════════════════════════════════════════════════════
async function page(table, cols, limit) {
  const c = db(); const out = []; const step = 1000;
  for (let from = 0; ; from += step) {
    const take = limit ? Math.min(step, limit - out.length) : step;
    if (take <= 0) break;
    const { data, error } = await c.from(table).select(cols).order('id', { ascending: true }).range(from, from + take - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < take) break;
    if (limit && out.length >= limit) break;
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// THE RUN
// ════════════════════════════════════════════════════════════════════════════
export async function backfill(subject_type, { limit = null, commit = false, concurrency = 6, onRow = null } = {}) {
  const spec = MINERS[subject_type];
  if (!spec) throw new Error(`no miner for ${subject_type}`);
  const rows = await page(spec.table, spec.cols, limit);

  const stats = {
    subject_type, subjects_scanned: rows.length, candidates: 0,
    by_action: {}, by_field: {}, by_source: {}, by_basis: {}, by_date: {},
    uncertain: 0, refusals: {}, samples: [], errors: [],
  };
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

  const jobs = [];
  for (const row of rows) for (const c of spec.mine(row)) jobs.push({ row, c });
  stats.candidates = jobs.length;

  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const { row, c } = jobs[i++];
      let r;
      try {
        r = await observe({
          subject_type, subject_id: row.id,
          field: c.field, value: c.value,
          source: c.source, source_url: c.source_url,
          observed_at: c.observed_at,
          observed_at_basis: c.basis,
          observed_at_confidence: c.confidence,
          trust: c.trust, method: c.method,
          kind: 'specification',
          quote: c.quote,
          extra: { backfill: 'scripts/entity/backfill-observations.mjs', origin_column: c.field, ...(c.extra || {}) },
          validation_context: {},
          // `row` was paged straight out of the subject's own table, so its
          // existence is already proven — skip observe()'s existence round
          // trip (added 2026-07-20) rather than re-asking the DB per fact.
          subject_verified: true,
          commit,
        });
      } catch (e) { stats.errors.push(String(e?.message || e)); continue; }

      bump(stats.by_action, r.action);
      if (r.action === 'refused') bump(stats.refusals, String(r.reason).split(':')[0]);
      if (r.action === 'written' || r.action === 'dry_run' || r.action === 'duplicate') {
        bump(stats.by_field, c.field);
        bump(stats.by_source, c.source);
        bump(stats.by_basis, c.basis);
        bump(stats.by_date, c.observed_at.slice(0, 10));
        if (c.confidence < 0.5) stats.uncertain++;
      }
      // Blocked subject types still BUILD a payload — sample it so the reader
      // can see exactly what would land the instant the CHECK is extended.
      if (stats.samples.length < 3 && r.payload) stats.samples.push({ action: r.action, reason: r.reason, observation_id: r.observation_id, payload: r.payload });
      if (onRow) onRow(r, c, row);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return stats;
}

// ════════════════════════════════════════════════════════════════════════════
// CLI
// ════════════════════════════════════════════════════════════════════════════
const C = { r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
function argv() { const a = process.argv.slice(2); const o = { _: [] }; for (let i = 0; i < a.length; i++) { if (a[i].startsWith('--')) { const k = a[i].slice(2).replace(/-/g, '_'); if (a[i + 1] && !a[i + 1].startsWith('--')) o[k] = a[++i]; else o[k] = true; } else o._.push(a[i]); } return o; }

const top = (o, n = 12) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);

function report(s) {
  console.log(`\n${C.b}${s.subject_type}${C.x}  subjects=${s.subjects_scanned}  candidate facts=${s.candidates}`);
  console.log(`  actions:   ${top(s.by_action).map(([k, v]) => `${k}=${v}`).join('  ')}`);
  if (Object.keys(s.refusals).length) console.log(`  ${C.r}refusals:${C.x}  ${top(s.refusals).map(([k, v]) => `${k}=${v}`).join('  ')}`);
  if (Object.keys(s.by_field).length) {
    console.log(`  by field:  ${top(s.by_field).map(([k, v]) => `${k}=${v}`).join('  ')}`);
    console.log(`  by source: ${top(s.by_source).map(([k, v]) => `${k}=${v}`).join('  ')}`);
    console.log(`  ${C.b}date distribution (real, mined — never now()):${C.x}`);
    for (const [d, n] of Object.entries(s.by_date).sort()) console.log(`     ${d}  ${String(n).padStart(6)}`);
    console.log(`  date basis:`);
    for (const [b, n] of top(s.by_basis, 20)) console.log(`     ${String(n).padStart(6)}  ${b}`);
    console.log(`  ${s.uncertain ? C.y : C.g}date_uncertain (confidence<0.5, upper-bound only): ${s.uncertain}${C.x}`);
  }
  if (s.errors.length) console.log(`  ${C.r}errors: ${s.errors.length}${C.x}  ${s.errors.slice(0, 3).join(' | ')}`);
}

async function main() {
  const a = argv(); const cmd = a._[0] || 'plan';
  const types = a._[1] ? [a._[1]] : ['organization', 'property', 'product'];
  const limit = a.limit ? Number(a.limit) : null;

  if (cmd === 'sources') {
    const have = await sql(`select slug, supported_observations from observation_sources where slug in (${[...REQUIRED_SOURCES.map((s) => s.slug), ...SOURCE_PATCHES.map((s) => s.slug)].map((s) => `'${s}'`).join(',')})`);
    const bySlug = Object.fromEntries(have.map((h) => [h.slug, h]));
    console.log(`\n${C.b}SOURCES REQUIRED BY THE COMMIT PATH${C.x}\n`);
    for (const s of REQUIRED_SOURCES) {
      const h = bySlug[s.slug];
      console.log(`  ${h ? C.g + 'present ' : C.r + 'MISSING '}${C.x} ${s.slug.padEnd(24)} trust=${s.base_trust_score} tier=${s.tier}  ${C.d}${s.notes}${C.x}`);
    }
    for (const p of SOURCE_PATCHES) {
      const h = bySlug[p.slug];
      const ok = h && p.append_supported_observations.every((k) => (h.supported_observations || []).includes(k));
      console.log(`  ${ok ? C.g + 'patched ' : C.y + 'NEEDS   '}${C.x} ${p.slug.padEnd(24)} append supported_observations ${JSON.stringify(p.append_supported_observations)}  ${C.d}${p.why}${C.x}`);
    }
    console.log(`\n${C.d}observation_sources is a REGISTRY, not testimony — ingest-observation's own\nerror hint is "Register source in observation_sources table first". Register\nwith: node scripts/entity/backfill-observations.mjs sources --apply${C.x}\n`);
    if (a.apply) {
      const c = db();
      for (const s of REQUIRED_SOURCES) {
        if (bySlug[s.slug]) { console.log(`  skip ${s.slug} (exists — never overwritten)`); continue; }
        const { error } = await c.from('observation_sources').insert(s);
        console.log(`  ${error ? C.r + 'FAIL ' + error.message : C.g + 'registered'}${C.x} ${s.slug}`);
      }
      for (const p of SOURCE_PATCHES) {
        const h = bySlug[p.slug]; if (!h) { console.log(`  ${C.r}skip ${p.slug} — not present${C.x}`); continue; }
        const merged = [...new Set([...(h.supported_observations || []), ...p.append_supported_observations])];
        if (merged.length === (h.supported_observations || []).length) { console.log(`  skip ${p.slug} (already)`); continue; }
        const { error } = await c.from('observation_sources').update({ supported_observations: merged }).eq('slug', p.slug);
        console.log(`  ${error ? C.r + 'FAIL ' + error.message : C.g + 'appended  '}${C.x} ${p.slug} -> ${JSON.stringify(merged)}`);
      }
    }
    return;
  }

  if (cmd === 'verify') {
    // Counting by subject_type is a SEQ SCAN (10.2M rows, no index on
    // (subject_type, subject_id) — guide 20 §7 step 1 deferred it) and times
    // out. idx_observations_source EXISTS, so the census runs by source_id.
    const slugs = [...REQUIRED_SOURCES.map((s) => s.slug), 'access-sb', 'agent-submission'];
    const q = `select s.slug, o.subject_type, o.structured_data->>'field' field,
                      count(*) n, min(o.observed_at) first_obs, max(o.observed_at) last_obs,
                      count(*) filter (where (o.structured_data->>'date_uncertain')='true') uncertain
               from vehicle_observations o join observation_sources s on s.id=o.source_id
               where s.slug in (${slugs.map((x) => `'${x}'`).join(',')})
                 and o.structured_data->>'writer' = 'scripts/entity/observe.mjs'
               group by 1,2,3 order by 4 desc`;
    console.table(await sql(q));
    const d = `select o.observed_at::date d, count(*) n from vehicle_observations o join observation_sources s on s.id=o.source_id
               where s.slug in (${slugs.map((x) => `'${x}'`).join(',')}) and o.structured_data->>'writer'='scripts/entity/observe.mjs'
               group by 1 order by 1`;
    console.log('\nREAL DATE DISTRIBUTION OF WRITTEN OBSERVATIONS:');
    console.table(await sql(d));
    return;
  }

  const commit = cmd === 'run' && !!a.commit;
  if (cmd === 'run' && !a.commit) console.log(`${C.y}no --commit: running dry${C.x}`);
  for (const t of types) {
    const w = subjectWritability(t);
    if (commit && !w.writable) console.log(`\n${C.y}${t}: not writable (${w.blocker}) — payloads will be built and shown, nothing sent.${C.x}`);
    const s = await backfill(t, { limit, commit });
    report(s);
    if (a.samples && s.samples.length) console.log(JSON.stringify(s.samples, null, 2));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(2); });
