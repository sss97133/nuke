// ════════════════════════════════════════════════════════════════════════════
// THE ADJUDICATION CORE — universal, subject-agnostic.
// ════════════════════════════════════════════════════════════════════════════
//
// THE FRAME's central demand: "adjudicate every claim per-field across all
// witnesses, surface conflicts as conflicts, and carry the verdict on the
// profile." Nothing in this codebase implemented that. This does.
//
// WHAT THIS IS NOT: a stored column. Every value here is computed at call time.
// A frozen verdict rots the instant a new observation lands — the same defect
// class as the flat `properties.base_price` scalar that produced the 27x-wrong
// villa prices. There is no write path in this file, by design.
//
// PRIOR ART THIS EXTENDS (read before changing anything here):
//   • observation_effective_weight(base_trust, confidence, observed_at, kind,
//     category) — live SQL, measured 2026-07-20 via pg_get_functiondef. The
//     weight formula below is a VERBATIM port so the model stays singular.
//     When the proposed v_subject_verdict view lands it must call the SQL
//     function directly and delete the port. See MIGRATION PROPOSAL doc.
//   • docs/library/technical/engineering-manual/10-testimony-fields.md §10.4 —
//     the worked composition (BaT 0.581 + BJ 0.440 beat forum 0.243) and the
//     1.15 corroboration factor. Not re-derived; lifted.
//   • vehicle_current_state — the EXISTING vehicle adjudicator. Measured
//     defect: it is `row_number() ... rn = 1`, i.e. it picks ONE observation
//     row and reads EVERY field off it. If BaT has the colour and the VIN
//     decode has the engine, one of them is discarded wholesale. It is a
//     best-ROW view, not a best-FIELD view. This file is the per-field
//     generalisation of the same weight formula. vehicle_current_state is NOT
//     replaced — it is live and read by the app (liveness-and-intent rule 1).
//
// ════════════════════════════════════════════════════════════════════════════

// ── The weight formula ──────────────────────────────────────────────────────
// Verbatim port of the live SQL. exp(-0.693 * age_days / half_life) is the
// half-life decay; 0.693 is ln(2) as the SQL hardcodes it (kept identical
// rather than "improved" to ln(2), so the two implementations cannot drift).
export const relevance = (observedAt, halfLifeDays, now = Date.now()) => {
  // AN UNKNOWN OBSERVATION DATE IS NOT A FRESH ONE.
  // The SQL function is never called with a NULL p_observed_at because
  // vehicle_observations.observed_at is NOT NULL. The adapters CAN produce a
  // dateless claim (villa_inventory carries no timestamp column at all), and
  // the original code papered over that by stamping Date.now() at the adapter.
  // That is the same lie as a backfill stamped 'now' for January data: it makes
  // undated substrate look permanently fresh. Unknown returns null, and null
  // propagates into "cannot be served" — symmetric with unknown trust.
  if (observedAt == null) return null;
  const t = new Date(observedAt).getTime();
  if (!Number.isFinite(t)) return null;
  if (halfLifeDays == null || halfLifeDays <= 0) return 1.0; // permanent
  const ageDays = (now - t) / 86400000;
  return Math.min(1.0, Math.exp((-0.693 * ageDays) / halfLifeDays));
};

// Mirrors observation_half_life_days(kind, category). Measured from prod.
// NOTE — SUBSTRATE INCONSISTENCY, surfaced not fixed (wire-closure protocol:
// "surface disagreements, don't fix them inline"). THREE competing decay models
// exist in prod and they disagree:
//   1. observation_half_life_days() SQL fn : specification = 1825 (5y)
//   2. observation_half_lives TABLE        : specification = 999999 (permanent)
//   3. observation_sources.decay_half_life_days : per-source, e.g. 90 for
//      ai-description-extraction — and this is the one v_observations_needing_refresh
//      actually applies in prod.
// Chapter 10 §10.5 agrees with (1). This port follows (1) because it is the one
// the live weight function uses. Reconciling them is an owner decision.
export const halfLifeDays = (kind, category = null) => {
  switch (kind) {
    case 'specification':
      return ['vin', 'build_sheet', 'catalogue_raisonne'].includes(category) ? null : 1825;
    case 'condition': return 730;
    case 'work_record': return 3650;
    case 'provenance': return null;
    case 'ownership': return 10950;
    case 'sale_result': return 1095;
    case 'valuation': return 365;
    case 'listing': return 90;
    case 'comment': return 730;
    case 'social_mention': return 90;
    case 'media': return 1825;
    case 'bid': return 730;
    case 'expert_opinion': return 1825;
    case 'sighting': return 365;
    default: return 730;
  }
};

export const effectiveWeight = (baseTrust, confidence, observedAt, kind, category, now) => {
  const r = relevance(observedAt, halfLifeDays(kind, category), now);
  if (r == null) return null; // undated ⇒ unweighable, not weight-1
  return Math.round((baseTrust ?? 0.5) * (confidence ?? 0.5) * r * 1e4) / 1e4;
};

export const freshnessLabel = (observedAt, kind, now) => {
  const r = relevance(observedAt, halfLifeDays(kind), now);
  if (r == null) return 'undated';
  return r > 0.7 ? 'fresh' : r > 0.5 ? 'aging' : r > 0.25 ? 'stale' : 'expired';
};

// ── Value normalisation ─────────────────────────────────────────────────────
// MEASURED NECESSITY, not a nicety. Vehicle a90c008a (1983 GMC K2500) carries
// exterior_color from two witnesses:
//   iphoto (trust 1.00)              "Midnight Blue Metallic / Frost White two-tone"
//   ai-description-extraction (0.65) "Midnight Blue Metallic and Frost White two-tone"
// These AGREE. A naive string compare reports a conflict and suppresses the
// corroboration bonus — inventing a disagreement that does not exist, which is
// its own kind of fabrication. Normalisation is comparison-only: the verdict
// always carries the raw winning value, never the normalised form.
export function normaliseValue(v) {
  if (v == null) return null;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return String(v);
  return String(v)
    .toLowerCase()
    .replace(/[\/&+]|\band\b/g, ' ')  // "/" "and" "&" "+" are the same conjunction
    .replace(/[^\p{L}\p{N}\s.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Grouping identity ───────────────────────────────────────────────────────
// A claim competes only with claims about the SAME thing. That is
// (subject, property_key, discriminator_value) — NOT (subject, property_key).
//
// MEASURED, on Skylar's K5 (vehicle e08bf694, 1,848 property-keyed observations):
//   grouping wire_landmark_traversal by `wire_id`        -> 15+ groups "conflict",
//     reporting L01/L02/L05/L06/L07 as five rival answers
//   grouping it by its REGISTERED discriminator `traversal_key`
//     -> 291 groups, ZERO conflicts.
// The registry (observation_properties.discriminator_key) is the difference
// between a correct adjudicator and one that invents 15 conflicts on a clean
// harness. Never group without consulting it.
//
// cardinality='multi' WITHOUT a discriminator = a genuine set (a vehicle has
// many owners over time); distinct values coexist and are NOT conflicts.
export const groupKey = (c) =>
  [c.subject_type, c.subject_id, c.property_key, c.discriminator_value ?? ''].join(' ');

// ── The adjudicator ─────────────────────────────────────────────────────────
//
// Ordering, in the priority the brief specifies: witness tier, then recency,
// then corroboration count — all three collapsed into the weight formula, which
// already multiplies trust (tier) by decayed recency, plus an explicit
// corroboration factor. Corroboration is counted over DISTINCT witnesses: ten
// re-scrapes of one site are one witness, not ten (otherwise a single loud
// source out-votes a registry by volume alone).
//
// TRUST-UNKNOWN IS NOT TRUST-ZERO (AGENTS.md invariant 2 / cardinal rule).
// A witness from an unregistered source has base_trust = null. It is counted,
// cited and allowed to raise a conflict, but it can never WIN — a value cannot
// be served on the authority of a source whose authority is unmeasured. This is
// what forces the villa-price case to block rather than to guess, and it is the
// direct application of feedback_valuation_block_when_not_defensible: "block
// ('not priced yet'), never an honest-low guess."
export function adjudicate(claims, { now = Date.now(), corroborationFactor = 1.15 } = {}) {
  if (!claims.length) return null;
  const first = claims[0];

  // Weight every claim.
  const weighted = claims.map((c) => {
    const trustKnown = c.base_trust != null;
    // TWO independent unknowns, and neither may be defaulted:
    //   trust unknown  -> the witness's authority is unmeasured
    //   date  unknown  -> the claim's decay is unmeasurable
    // Either one alone is enough to bar the claim from WINNING. It is still
    // counted, cited and allowed to raise a conflict.
    const dateKnown = c.observed_at != null && Number.isFinite(new Date(c.observed_at).getTime());
    return {
      ...c,
      trust_known: trustKnown,
      date_known: dateKnown,
      serviceable: trustKnown && dateKnown,
      weight: trustKnown && dateKnown
        ? effectiveWeight(c.base_trust, c.confidence, c.observed_at, c.kind, c.category, now)
        : null,
      relevance: relevance(c.observed_at, halfLifeDays(c.kind, c.category), now),
      freshness: freshnessLabel(c.observed_at, c.kind, now),
      norm: normaliseValue(c.value),
    };
  });

  // ── UNREGISTERED PROPERTY: no verdict, and no conflict either ────────────
  // If the key is not in observation_properties, its cardinality and its
  // discriminator are UNKNOWN — and unknown is not "single". Asserting a
  // conflict here fabricates a disagreement out of ignorance.
  //
  // MEASURED, and this tool got it wrong first: defaulting unregistered keys
  // to cardinality='single' made the K5 report `witness_image_id` as one
  // verdict against 50+ rival values. They are not rivals — it is a set of
  // image references with no registry entry. Reporting that as a conflict is
  // the same failure as the false wire_id grouping, one layer up. So: report
  // the values, name the gap, adjudicate nothing.
  if (!first.registered) {
    const values = [...new Set(weighted.map((w) => w.norm))];
    return {
      subject_type: first.subject_type, subject_id: first.subject_id,
      field: first.property_key, discriminator: null,
      shape: 'unregistered',
      verdict: null, verdict_blocked: true,
      reason: `'${first.property_key}' is not in observation_properties — cardinality and discriminator unknown, so neither a verdict nor a conflict can be asserted`,
      needs: `register '${first.property_key}' in observation_properties (data_type, cardinality, discriminator_key) via schema_proposals`,
      distinct_values: values.length,
      values: weighted.slice(0, 20).map((w) => ({ value: w.value, witness: w.witness, observed_at: w.observed_at })),
      citations: citationsOf(weighted), citation_count: new Set(weighted.map((w) => w.witness)).size,
      conflicts: [], confidence: null, freshness: null, newest_observed_at: null,
      witness_count: new Set(weighted.map((w) => w.witness)).size,
    };
  }

  // Set-valued properties do not compete. Report the set; assert no verdict.
  if (first.cardinality === 'multi' && !first.discriminator_key) {
    const values = [...new Set(weighted.map((w) => w.norm))];
    return {
      subject_type: first.subject_type, subject_id: first.subject_id,
      field: first.property_key, discriminator: null,
      shape: 'set',
      verdict: null, verdict_blocked: false,
      reason: `cardinality='multi' with no discriminator — ${values.length} coexisting values, not rival claims`,
      values: weighted.map((w) => ({ value: w.value, witness: w.witness, observed_at: w.observed_at })),
      citations: citationsOf(weighted), conflicts: [], confidence: null,
      witness_count: new Set(weighted.map((w) => w.witness)).size,
    };
  }

  // Cluster by normalised value.
  const clusters = new Map();
  for (const w of weighted) {
    const k = w.norm ?? ' null';
    if (!clusters.has(k)) clusters.set(k, []);
    clusters.get(k).push(w);
  }

  const scored = [...clusters.entries()].map(([norm, members]) => {
    const witnesses = new Set(members.map((m) => m.witness));
    const known = members.filter((m) => m.serviceable);
    const base = known.reduce((a, m) => a + m.weight, 0);
    // Corroboration applies per §10.4 only when DISTINCT witnesses agree.
    const distinctKnown = new Set(known.map((m) => m.witness)).size;
    const corroborated = distinctKnown > 1;
    return {
      norm,
      // The served value is the raw form from the heaviest known witness —
      // never the normalised string.
      value: (known.length ? known : members).slice().sort((a, b) => (b.weight ?? -1) - (a.weight ?? -1))[0].value,
      members,
      witnesses: [...witnesses],
      witness_count: witnesses.size,
      all_trust_unknown: known.length === 0,
      unserviceable_reason: known.length === 0
        ? (members.some((m) => m.trust_known) ? 'undated' : 'trust_unknown')
        : null,
      corroborated,
      total_weight: corroborated ? Math.round(base * corroborationFactor * 1e4) / 1e4 : Math.round(base * 1e4) / 1e4,
      newest: members.reduce((a, m) => (new Date(m.observed_at) > new Date(a.observed_at) ? m : a)),
    };
  });

  const rankable = scored.filter((s) => !s.all_trust_unknown);
  scored.sort((a, b) => b.total_weight - a.total_weight);
  rankable.sort((a, b) => b.total_weight - a.total_weight);

  const winner = rankable[0] ?? null;
  const runner = rankable[1] ?? null;

  // ── The block rules ──────────────────────────────────────────────────────
  let blocked = false, reason = null;
  if (!winner) {
    blocked = true;
    const anyUndated = scored.some((s) => s.unserviceable_reason === 'undated');
    const anyUntrusted = scored.some((s) => s.unserviceable_reason === 'trust_unknown');
    reason = [
      anyUntrusted && 'every witness is from an unregistered source — trust is unknown, and unknown is not zero. Register the source in observation_sources to make this adjudicable.',
      anyUndated && 'the substrate carries no observation date for these claims, so decay is unmeasurable — an undated claim is not a fresh one. Record an observed_at at the source.',
    ].filter(Boolean).join(' ');
  } else if (runner && winner.total_weight > 0 && (winner.total_weight - runner.total_weight) / winner.total_weight < 0.10) {
    // A <10% margin between rival values is not a verdict, it is a coin flip
    // wearing a decimal point.
    blocked = true;
    reason = `top two values within ${(((winner.total_weight - runner.total_weight) / winner.total_weight) * 100).toFixed(1)}% — no defensible winner`;
  } else if (first.unit_conflict) {
    blocked = true;
    reason = first.unit_conflict;
  }

  const conflicts = scored
    .filter((s) => s !== winner)
    .map((s) => ({
      value: s.value,
      total_weight: s.all_trust_unknown ? null : s.total_weight,
      trust: s.all_trust_unknown ? 'unknown' : 'measured',
      unserviceable_reason: s.unserviceable_reason,
      witnesses: s.witnesses,
      witness_count: s.witness_count,
      newest_observed_at: s.newest.observed_at,
      freshness: s.newest.freshness,
      citations: citationsOf(s.members),
    }));

  return {
    subject_type: first.subject_type, subject_id: first.subject_id,
    field: first.property_key,
    discriminator: first.discriminator_key ? { key: first.discriminator_key, value: first.discriminator_value } : null,
    shape: 'single',
    verdict: blocked ? null : winner.value,
    verdict_blocked: blocked,
    reason,
    // CONFIDENCE MUST DRILL OR IT IS VANITY (the brief's word). This is not a
    // bare float: it is the weight, its inputs, and the rows that produced it.
    confidence: blocked ? null : {
      score: winner.total_weight,
      corroborated: winner.corroborated,
      corroboration_factor: winner.corroborated ? corroborationFactor : 1,
      margin_over_runner_up: runner ? Math.round((winner.total_weight - runner.total_weight) * 1e4) / 1e4 : null,
      components: winner.members.filter((m) => m.serviceable).map((m) => ({
        witness: m.witness, base_trust: m.base_trust, extraction_confidence: m.confidence,
        kind: m.kind, half_life_days: halfLifeDays(m.kind, m.category),
        relevance: Math.round(m.relevance * 1e4) / 1e4, weight: m.weight,
        observation_id: m.observation_id ?? null, source_url: m.source_url ?? null,
      })),
    },
    // CITATIONS ARE A PRODUCT SURFACE, not debug output — Skylar: "we want
    // multiple and frequent citations not use a tired old description."
    citations: winner ? citationsOf(winner.members) : citationsOf(weighted),
    citation_count: winner ? new Set(winner.members.map((m) => m.witness)).size : 0,
    freshness: winner ? winner.newest.freshness : null,
    newest_observed_at: winner ? winner.newest.observed_at : null,
    witness_count: new Set(weighted.map((w) => w.witness)).size,
    // Conflicts are ALWAYS carried, never silently resolved, even when a clear
    // winner exists. That is the whole point.
    conflicts,
  };
}

const citationsOf = (members) =>
  members.map((m) => ({
    witness: m.witness,
    trust: m.base_trust ?? 'unknown',
    observed_at: m.observed_at,
    freshness: m.freshness ?? null,
    adapter: m.adapter,
    provenance: m.provenance ?? null,
    source_url: m.source_url ?? null,
    observation_id: m.observation_id ?? null,
    excerpt: m.excerpt ? String(m.excerpt).slice(0, 140) : null,
  }));
