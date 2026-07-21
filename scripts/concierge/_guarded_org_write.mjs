// scripts/concierge/_guarded_org_write.mjs
// ────────────────────────────────────────────────────────────────────────────
// THE ONE DOOR the L'Officiel concierge enrichers write served columns through.
//
// WHY THIS FILE EXISTS AND WHY IT IS NOT `write.mjs` ITSELF
// ────────────────────────────────────────────────────────────────────────────
// scripts/entity/write.mjs is the gate. It is subject-agnostic on purpose. But
// running the selftest against these scripts' real payload turns up a wall:
//
//   node scripts/entity/write.mjs set organization <id> description "…"
//   -> REFUSED [unknown] applicability: no check applies to organization.description
//                        — this value was NOT examined; unknown is not pass
//
// That refusal is CORRECT (AGENTS.md invariant 2) and must not be softened.
// validate()'s own hint says the cure: `pass context.evidence (entity_gate +
// geo_scope)`. Every defect this cluster produced is precisely an entity_gate /
// geo_scope defect —
//
//   BODY+SOUL ST BARTH -> Indonesian gambling site  (entity_gate, lapsed domain)
//   MEDIFLIGHT         -> "Mediflight Of Oklahoma"  (geo_scope)
//   a restaurant       -> Saint-Barthélemy-de-Bellegarde, Dordogne (geo_scope)
//   Bagatelle ST BARTH -> "Bagatelle ST TROPEZ"     (both, only in composition)
//
// — and all four are catchable ONLY when the page the enricher already fetched
// travels with the value. The enrichers HAVE that page. They were throwing it
// away at the write boundary. So this adapter's whole job is:
//
//     carry the evidence to the gate, and carry the gate's verdict back.
//
// It adds NO checks (write.mjs's stated rule). It calls writeFields unchanged.
//
// WHAT ELSE IT HAS TO GET RIGHT — the lost-update trap
// ────────────────────────────────────────────────────────────────────────────
// Every one of these scripts writes ONE `.update()` mixing two different kinds
// of column:
//   served facts   description, phone, address, email, website, hours_of_operation
//   bookkeeping    metadata, data_signals, enrichment_sources, enrichment_status
// Only the first kind belongs to the gate. The second IS the provenance record
// and stays a direct write.
//
// But writeField's quarantine/quality/supersession records land in
// `organizations.metadata`, read from the row IT loaded. If the caller then
// writes its own `metadata` built from a read taken BEFORE that, it silently
// clobbers the quarantine — the held value would be lost, which is the one
// thing quarantine exists to prevent. So the sidecar update happens LAST and
// the gate's own metadata records are merged into it from
// `result.evidence.{quarantine,quality,supersession}` rather than re-read.
// Deterministic, no extra round trip, no race.
// ────────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js';
import { writeFields } from '../entity/write.mjs';
import { fitRegion, STBARTH_REGION_TEXT } from '../entity/validate.mjs';

let _db = null;
const db = () => (_db ??= createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  global: { headers: { 'X-Nuke-Writer': 'scripts/concierge/_guarded_org_write.mjs' } },
}));

// ════════════════════════════════════════════════════════════════════════════
// THE REGION — fitted from the live population, ONCE per process.
// ════════════════════════════════════════════════════════════════════════════
// geoScope takes either a bbox (hard geometry, used when the evidence carries a
// coordinate) or the text form (hard_positive / negative dialling codes and
// postcodes, used when it does not — which is every firecrawl scrape). Both are
// supplied so whichever the evidence supports is the one that fires. The bbox
// is FITTED, never hardcoded: `fitRegion` derives it from the concierge orgs'
// own lat/lng, and if the population is too small it returns null and the text
// form carries alone. It is never invented.
let _region;
export async function conciergeRegion() {
  if (_region !== undefined) return _region;
  let box = null;
  try {
    box = await fitRegion('organization', (q) => q.eq('metadata->>project', 'lofficiel-concierge'));
  } catch { /* a region we could not fit is `unknown`, not a wrong region */ }
  _region = { ...STBARTH_REGION_TEXT, ...(box || {}) };
  return _region;
}

// ════════════════════════════════════════════════════════════════════════════
// EVIDENCE — built from what the enricher actually fetched, never assumed.
// ════════════════════════════════════════════════════════════════════════════
// `text` is the page body. It is what turns the BODY+SOUL check on: entityGate
// only asks "does the page still name this business" when there IS a body. A
// caller with no page text (a promotion script reading a months-old capture)
// passes none, and the gate downgrades honestly rather than pretending it
// looked. Absence of evidence is reported as absence.
export function pageEvidence({ url, text = null, island = null, phone_on_page = false, lat = null, lng = null, address = null } = {}) {
  const ev = { url: url || null };
  if (text) ev.text = String(text).slice(0, 20000);   // the checks regex over this; a whole site is waste
  // `island` is a SIGNAL STRING, never a boolean. entityGate feeds it to
  // islandSufficient(), which only rejects the literal 'island_repeated' — so a
  // `true` passed here satisfies the island requirement for any page that merely
  // mentions the name, which is the Saint-Barthélemy-de-Bellegarde defect
  // exactly. Callers hold booleans (fill-org-profiles' islandSignal is
  // SBH.test), so the wrong type is a live hazard, not a hypothetical. Reject it
  // and let entityGate compute islandPresence(text, host) itself.
  if (typeof island === 'string' && island) ev.island = island;
  else if (island != null && typeof island !== 'string') {
    throw new TypeError(`pageEvidence: island must be a signal string ('island_phone' | 'island_postcode' | 'island_domain' | 'island_repeated'), got ${typeof island} (${island}). A boolean here silently satisfies the island test for any page naming the region — omit it and let entityGate derive it from the page text.`);
  }
  if (phone_on_page) ev.phone_on_page = true;
  if (lat != null && lng != null) { ev.lat = lat; ev.lng = lng; }
  if (address) ev.address = typeof address === 'string' ? address : JSON.stringify(address);
  return ev;
}

// A value that is absent is not a value. Unknown is not zero and not false —
// so nothing empty is ever handed to the gate as though it were a claim.
const isAbsent = (v) => v === null || v === undefined
  || (typeof v === 'string' && !v.trim())
  || (Array.isArray(v) && !v.length)
  || (v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);

export const ADMITTED = (r) => r?.action === 'applied' || r?.action === 'would_apply';

// ════════════════════════════════════════════════════════════════════════════
// guardedOrgWrite — served fields through the gate, bookkeeping straight through
// ════════════════════════════════════════════════════════════════════════════
//   org       { id, name, latitude?, longitude?, city?, country?, region? }
//   fields    [{ field, value, source, source_url, observed_at, method, trust,
//                kind?, supersede?, context? }]
//   evidence  from pageEvidence() — the page this claim came off
//   sidecar   the bookkeeping patch (metadata / data_signals / enrichment_*).
//             `metadata` here MUST already be the caller's merged object; the
//             gate's own metadata records are folded in on top before the write.
//   apply     false => nothing is written, by anyone, anywhere.
//
// returns { decisions, admitted, held, sidecar_error }
//   decisions  { [field]: writeField result }  — branch on `.action`, NOT `.applied`
//   mergeDecisions  decisions from an EARLIER guardedOrgWrite on the same org
//             whose metadata records must survive this sidecar write. A caller
//             that gates its fields and then writes its bookkeeping in two
//             steps has to hand the first step's records to the second, or the
//             second silently clobbers them. See the lost-update note above.
export async function guardedOrgWrite({ org, fields = [], evidence = null, sidecar = null, apply = false, region = null, mergeDecisions = null } = {}) {
  const out = { decisions: {}, admitted: [], held: [], sidecar_error: null };
  if (!org?.id) { out.sidecar_error = 'no org id'; return out; }

  const reg = region ?? await conciergeRegion();
  const subject = {
    name: org.name,
    latitude: org.latitude ?? null, longitude: org.longitude ?? null,
    city: org.city ?? null, country: org.country ?? null,
    region: reg,
  };

  const live = fields.filter((f) => f && f.field && !isAbsent(f.value));
  for (const f of fields) {
    if (f?.field && isAbsent(f.value)) {
      // Recorded, not silently dropped: "the source said nothing" is a
      // different fact from "the source was never asked".
      out.decisions[f.field] = { action: 'skipped', severity: 'unknown', reason: 'source carried no value for this field — absence, not a claim', applied: false };
    }
  }

  if (live.length) {
    const items = live.map((f) => ({
      subject_type: 'organization',
      subject_id: org.id,
      field: f.field,
      value: f.value,
      source: f.source ?? null,
      source_url: f.source_url ?? evidence?.url ?? null,
      observed_at: f.observed_at ?? null,
      method: f.method ?? null,
      trust: f.trust ?? null,
      kind: f.kind ?? null,
      actor: f.actor ?? 'concierge-enricher',
      supersede: f.supersede ?? false,
      context: { subject, region: reg, ...(evidence ? { evidence } : {}), ...(f.context || {}) },
    }));
    const rs = await writeFields(items, { apply });
    rs.forEach((r, i) => {
      const name = items[i].field;
      out.decisions[name] = r;
      (ADMITTED(r) ? out.admitted : out.held).push(name);
    });
  }

  // ── the bookkeeping write, LAST, with the gate's records folded in ────────
  if (sidecar && Object.keys(sidecar).length) {
    const patch = { ...sidecar };
    let meta = patch.metadata ? { ...patch.metadata } : null;
    const all = { ...(mergeDecisions || {}), ...out.decisions };
    for (const r of Object.values(all)) {
      for (const rec of [r?.evidence?.quarantine, r?.evidence?.quality, r?.evidence?.supersession]) {
        if (rec?.column === 'metadata' && rec.key) { meta = { ...(meta || {}), [rec.key]: rec.record }; }
      }
    }
    if (meta) patch.metadata = meta;
    // The verdict on every held field is carried onto the profile itself, so a
    // blank column reads as "held, here is why" and not as "nobody looked."
    const held = Object.entries(all).filter(([, r]) => !ADMITTED(r) && r.action !== 'skipped');
    if (held.length) {
      patch.data_signals = {
        ...(patch.data_signals || {}),
        write_gate: {
          gated_at: new Date().toISOString(),
          writer: 'scripts/entity/write.mjs via scripts/concierge/_guarded_org_write.mjs',
          held: Object.fromEntries(held.map(([f, r]) => [f, { action: r.action, severity: r.severity, reason: String(r.reason || '').slice(0, 400) }])),
        },
      };
    }
    if (apply) {
      const { error } = await db().from('organizations').update(patch).eq('id', org.id);
      if (error) out.sidecar_error = error.message;
    }
    out.sidecar_patch = patch;
  }
  return out;
}

// One-line-per-decision console form, so every enricher reports the gate the
// same way and a held value is never invisible in a run log.
export function reportDecisions(name, decisions) {
  for (const [field, r] of Object.entries(decisions)) {
    if (r.action === 'skipped' || ADMITTED(r)) continue;
    console.error(`   HELD ${field.padEnd(20)} ${String(name).slice(0, 30).padEnd(32)} [${r.action}/${r.severity}] ${String(r.reason || '').slice(0, 150)}`);
  }
}
