#!/usr/bin/env node
// scripts/entity/observe.mjs — UNIVERSAL dated-fact writer.
//
// ────────────────────────────────────────────────────────────────────────────
// WHAT THIS IS
// ────────────────────────────────────────────────────────────────────────────
// One subject-agnostic `observe()` that turns (subject, field, value, when,
// who-said-so) into ONE observation through the sanctioned front door
// (`ingest-observation`). It never INSERTs, never UPDATEs, never DELETEs.
//
// It is the write half of the pair whose read/gate half is
// `scripts/entity/validate.mjs`. It IMPORTS that file's `validate()` and
// `SUBJECTS` registry rather than restating them — if a subject's writability
// or a value's plausibility changes, it changes THERE, once.
//
// ────────────────────────────────────────────────────────────────────────────
// WHAT IT DOES NOT REPLACE  (rule: .claude/rules/liveness-and-intent.md §1 —
// "unwired != dead. Deletion is owner-only.")
// ────────────────────────────────────────────────────────────────────────────
//   scripts/entity/validate.mjs            — IMPORTED. The gate. Not restated.
//   scripts/concierge/_org_entity_gate.mjs — reached THROUGH validate.mjs.
//   supabase/functions/ingest-observation  — the front door. Called, not bypassed.
//   concierge_products.(source,method,observed_at,trust,confidence_score)
//   price_observations.(entity_type,entity_id,source,method,observed_at,trust)
//       ^^ THESE ARE ALREADY DATED-FACT SUBSTRATES and they are ALIVE
//          (3,619 price_observations rows, 23,731 products, all carrying real
//          observed_at). This tool does NOT re-emit facts that already have a
//          dated home — that would fork them. See `alreadyDated()` below and
//          §"WHAT THE BACKFILL DELIBERATELY SKIPS" in backfill-observations.mjs.
//
// ────────────────────────────────────────────────────────────────────────────
// LIBRARY GROUNDING
// ────────────────────────────────────────────────────────────────────────────
//   docs/library/technical/engineering-manual/20-polymorphic-subject-build-guide.md
//     §3 subject model (subject_type/subject_id, cashflow_deals shape)
//     §7 steps 1-2 APPLIED 2026-06-17 — non-vehicle subjects are *expressible*;
//        this file is the "first real org writer" that §7 step 2 said would
//        validate the non-vehicle path. Step 5's warning is honoured: facts that
//        already live in structured provenance-bearing tables are read as proof,
//        NOT re-emitted (single-write-path / no data fork).
//   docs/library/technical/engineering-manual/04-observation-system.md — one
//        intake path for all data regardless of type or source.
//   docs/library/technical/engineering-manual/19-temporal-change-ingestion.md —
//        an undated fact cannot change; dating the existing corpus is what makes
//        the next crawl a *diff* instead of a fresh opinion.
//   docs/library/intellectual/contemplations/the-trust-invariant.md — supersede,
//        never overwrite; the serving column is untouched by design.
//   .claude/rules/agent-trust-invariants.md — front door only; no raw INSERT.
//   AGENTS.md invariant 2 — unknown is not zero and not false.
//
// ────────────────────────────────────────────────────────────────────────────
// THE DATING RULE (the load-bearing part)
// ────────────────────────────────────────────────────────────────────────────
// `observed_at` is REQUIRED and is NEVER defaulted to now(). A fact captured in
// January stamped with today's date is a lie that makes the whole corpus look
// permanently fresh and silently destroys decay, refresh and diff. Callers must
// pass a mined date plus `observed_at_basis` (WHERE the date came from) and
// `observed_at_confidence` (0..1). If the real date is unknowable the caller
// passes the best UPPER BOUND with confidence < 0.5 and the row is marked
// `date_uncertain: true` in structured_data — never a fabricated timestamp.
//
// NOTE: the `vehicle_observations.observed_at_confidence` COLUMN exists and
// defaults to 1.00, but `ingest-observation` does not currently accept it. So
// this tool carries date confidence in `structured_data.observed_at_confidence`
// and `structured_data.observed_at_basis`. Threading it to the column is a
// one-line, conditional-spread, backward-compatible endpoint change — PROPOSED
// in the handoff, not applied (no deploy in this lane).
//
// ────────────────────────────────────────────────────────────────────────────
// IDEMPOTENCY  (and the cross-subject dedup bug it defuses)
// ────────────────────────────────────────────────────────────────────────────
// `ingest-observation` hashes {source, kind, vehicle_id, source_url,
// source_identifier, observed_at, text, data, observer}. `subject_type` and
// `subject_id` are ABSENT from that hash — so two different org subjects with
// otherwise-identical payloads collapse onto one row and the caller is handed
// somebody else's observation_id. (Measured: re-sending the Jacques Zolty
// payload with A3 ARCHITECTURES' subject_id returned Jacques Zolty's row.)
//
// This tool defuses that from the CALLER side, with no deploy: the subject is
// embedded in `source_identifier`, which IS in the hash and IS in the DB-level
// `unique_observation` index (source_id, source_identifier, kind, content_hash).
//   source_identifier = "<prefix>:<subject_id>:<field>"
// Same subject + same field + same date + same value  -> duplicate (no write).
// Same payload, different subject                     -> different hash. Fixed.
// The prefix map preserves the `org:` shape already in production rather than
// minting a new one.
//
// ────────────────────────────────────────────────────────────────────────────
// USAGE
// ────────────────────────────────────────────────────────────────────────────
//   library:
//     import { observe } from './scripts/entity/observe.mjs';
//     const r = await observe({
//       subject_type: 'organization',
//       subject_id: '3e5f3e3d-08b8-4e0d-9f56-ab026886a085',
//       field: 'phone', value: '+590 590 27 65 94',
//       source: 'directory-saintbarth', source_url: 'https://…',
//       observed_at: '2026-01-30T14:10:15.069Z',
//       observed_at_basis: 'organizations.metadata.scraped_at',
//       observed_at_confidence: 0.85,
//       method: 'directory_scrape', trust: 'T2',
//       commit: true,
//     });
//     r.action -> 'written' | 'duplicate' | 'dry_run' | 'refused'
//
//   CLI (dry-run unless --commit):
//     node scripts/entity/observe.mjs \
//       --subject-type organization --subject-id <uuid> \
//       --field website --value https://x.com \
//       --source agent-submission --source-url https://x.com \
//       --observed-at 2026-07-20T00:00:00Z \
//       --observed-at-basis metadata.web_discovery.observed_at \
//       --observed-at-confidence 1 --method firecrawl_search --trust T2 [--commit]
//     node scripts/entity/observe.mjs subjects      # writability of every type
//   always: cd /Users/skylar/nuke && dotenvx run --quiet -- node scripts/entity/observe.mjs …

import { validate, SUBJECTS, db } from './validate.mjs';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ════════════════════════════════════════════════════════════════════════════
// STORE BINDINGS — where a dated fact about each subject type physically lands.
// MEASURED against the live DB on 2026-07-20, not assumed.
// ════════════════════════════════════════════════════════════════════════════
// vehicle_observations.subject_type CHECK (NOT VALID, but NOT VALID still
// enforces on INSERT — measured) allows exactly:
//     'vehicle' | 'organization' | 'user' | 'asset'
// Everything else is REFUSED here rather than mangled into an allowed bucket.
// In particular `asset` is NOT a dumping ground: `assets` is a real table
// (id, asset_type, creator_id, owner_id, vehicle_id, garment_id,
// publication_id) and pointing a villa's subject_id at properties.id under
// subject_type='asset' would be permanent, undeletable mis-attribution in a
// never-delete table. Blocked is honest; hijacked is contamination.
export const SUBJECT_TYPE_CHECK = ['vehicle', 'organization', 'user', 'asset'];

// source_identifier prefixes. `org` is NOT an abbreviation chosen here — it is
// the shape already in production on observation 28b14392-…, and this map
// exists so that convention is extended rather than replaced.
const ID_PREFIX = {
  vehicle: 'veh', organization: 'org', user: 'user', asset: 'asset',
  property: 'prop', product: 'prod', person: 'person',
  brand: 'brand', publication_page: 'page',
};

// Facts that ALREADY have a dated home with full provenance. Re-emitting these
// as observations forks them (guide 20 §7 step 5). Refused with a pointer.
const ALREADY_DATED = {
  product: {
    price:    'concierge_products.(price, source, method, observed_at, trust, confidence_score) — the row IS the dated observation',
    currency: 'concierge_products.(currency, observed_at) — dated in place',
    // seasonal/nightly rates for any entity:
  },
  property: {
    base_price: 'price_observations.(entity_type, entity_id, rate, source, method, observed_at, trust) — 3,619 live rows, polymorphic already',
    sale_price: 'price_observations — same table',
  },
};
export const alreadyDated = (t, f) => ALREADY_DATED[t]?.[f] ?? null;

// ════════════════════════════════════════════════════════════════════════════
// SUBJECT EXISTENCE — added 2026-07-20 during adversarial verification.
// ════════════════════════════════════════════════════════════════════════════
// GAP FOUND: observe() accepted ANY uuid as a subject_id without checking it
// resolves to a real row. Measured: subject_id=00000000-0000-0000-0000-
// 000000000000 with subject_type='organization' returned `dry_run`, i.e. it
// would have COMMITTED. Likewise an organization uuid passed as a vehicle
// subject was accepted.
// Why that is severe rather than cosmetic: vehicle_observations is
// never-deleted testimony. An orphan or cross-table subject_id is PERMANENT
// mis-attribution with no remedy — the exact harm the header already reasons
// about when it refuses to hijack subject_type='asset' for villas. The door
// was shut on the type and left open on the id.
// Cost control: one HEAD count per (type,id). Callers that already loaded the
// subject row (the backfill does — it pages the table) pass
// `subject_verified: true` and pay nothing.
const _existsCache = new Map();
export async function subjectExists(subject_type, subject_id) {
  const s = SUBJECTS[subject_type];
  if (!s) return { ok: false, reason: `unknown subject_type "${subject_type}"` };
  if (!subject_id) return { ok: false, reason: 'subject_id is required' };
  const key = `${subject_type}:${subject_id}`;
  if (_existsCache.has(key)) return _existsCache.get(key);
  let r;
  try {
    const { count, error } = await db()
      .from(s.table).select(s.pk, { count: 'exact', head: true }).eq(s.pk, subject_id);
    if (error) r = { ok: false, reason: `existence check failed: ${error.message}`, indeterminate: true };
    else if (!count) r = { ok: false, reason: `no ${s.table} row with ${s.pk}=${subject_id} — refusing to write orphan testimony to a never-delete table` };
    else r = { ok: true };
  } catch (e) {
    // AGENTS.md invariant 2: unknown is not false. A failed CHECK is not proof
    // of absence — but it is also not permission to write. Refuse, flagged
    // indeterminate so a caller can distinguish "absent" from "couldn't tell".
    r = { ok: false, reason: `existence check errored: ${String(e?.message || e)}`, indeterminate: true };
  }
  _existsCache.set(key, r);
  return r;
}

export function subjectWritability(subject_type) {
  const s = SUBJECTS[subject_type];
  if (!s) return { writable: false, reason: `unknown subject_type "${subject_type}" — add it to SUBJECTS in validate.mjs`, blocker: 'unregistered' };
  if (subject_type === 'person') return { writable: false, reason: 'mag_people PK is name_canon TEXT; vehicle_observations.subject_id is uuid — structurally unaddressable', blocker: 'no_uuid_pk' };
  if (subject_type === 'brand') return { writable: false, reason: 'brand identity is split across brands(uuid) and organization_brands.brand_name(text), unreconciled', blocker: 'identity_unreconciled' };
  if (!SUBJECT_TYPE_CHECK.includes(subject_type)) {
    return { writable: false, blocker: 'subject_type_check', reason: `vehicle_observations_subject_type_chk rejects '${subject_type}' (allows ${SUBJECT_TYPE_CHECK.join('|')}). OWNER-GATED: adding it is a schema change — propose, never apply.` };
  }
  return { writable: true, reason: null, blocker: null };
}

// ════════════════════════════════════════════════════════════════════════════
// THE WRITER
// ════════════════════════════════════════════════════════════════════════════
export async function observe({
  subject_type, subject_id, field, value,
  source, source_url = null,
  observed_at, observed_at_basis = null, observed_at_confidence = null,
  trust = null, method = null,
  kind = 'specification',
  content_text = null, quote = null,
  extra = {},
  rank = 'normal',
  validation_context = null,   // pass null to skip; pass {} to run with no extra context
  subject_verified = false,    // caller already loaded the subject row — skip the existence round trip
  commit = false,
  allow_unvalidated = false,
}) {
  const out = { subject_type, subject_id, field, value, action: null, reason: null, observation_id: null, payload: null, validation: null };

  // ── refusals that must happen BEFORE anything else ────────────────────────
  const w = subjectWritability(subject_type);

  if (value === null || value === undefined || value === '' ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === 'object' && !Array.isArray(value) && Object.keys(value ?? {}).length === 0)) {
    // AGENTS.md invariant 2: unknown is not zero and not false. An absent value
    // is not an observation of absence — recording absence is a different act
    // with a different writer (scripts/concierge/record-web-absence.mjs).
    out.action = 'refused'; out.reason = 'empty_value: unknown is not zero — use record-web-absence.mjs to testify to absence';
    return out;
  }
  if (!observed_at) {
    out.action = 'refused'; out.reason = 'no_observed_at: refusing to stamp now() on a fact of unknown age — mine a date or pass an upper bound with confidence<0.5';
    return out;
  }
  const already = alreadyDated(subject_type, field);
  if (already) {
    out.action = 'refused'; out.reason = `already_dated: ${already}`;
    return out;
  }

  // ── the gate (tool 1) ─────────────────────────────────────────────────────
  if (validation_context !== null) {
    try {
      out.validation = await validate({ subject_type, field, value, context: validation_context });
    } catch (e) {
      out.validation = { verdict: 'unknown', error: String(e?.message || e), checks: [] };
    }
    const v = out.validation.verdict;
    if ((v === 'block' || v === 'quarantine') && !allow_unvalidated) {
      out.action = 'refused'; out.reason = `validate_${v}: ` + (out.validation.checks || []).filter((c) => c.pass === false).map((c) => `${c.check}: ${c.reason}`).join(' | ');
      return out;
    }
  } else {
    out.validation = { verdict: 'skipped', checks: [] };
  }

  // ── subject must resolve to a real row (see subjectExists above) ──────────
  if (!subject_verified) {
    const ex = await subjectExists(subject_type, subject_id);
    if (!ex.ok) {
      out.action = 'refused';
      out.reason = `subject_not_found: ${ex.reason}`;
      out.blocker = ex.indeterminate ? 'existence_indeterminate' : 'subject_missing';
      return out;
    }
  }

  if (!w.writable) {
    // Payload is still BUILT (and returned) so the blocked types are exercised
    // end-to-end and land the instant the owner signs off on the CHECK.
    out.payload = buildPayload({ subject_type, subject_id, field, value, source, source_url, observed_at, observed_at_basis, observed_at_confidence, trust, method, kind, content_text, quote, extra, rank, validation: out.validation });
    out.action = 'refused'; out.reason = `not_writable: ${w.reason}`; out.blocker = w.blocker;
    return out;
  }

  out.payload = buildPayload({ subject_type, subject_id, field, value, source, source_url, observed_at, observed_at_basis, observed_at_confidence, trust, method, kind, content_text, quote, extra, rank, validation: out.validation });

  if (!commit) { out.action = 'dry_run'; return out; }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/ingest-observation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(out.payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    out.action = 'error'; out.reason = `${res.status} ${body.error || ''} ${body.details || ''}`.trim();
    return out;
  }
  out.observation_id = body.observation_id;
  out.action = body.duplicate ? 'duplicate' : 'written';
  out.confidence_score = body.confidence_score;
  return out;
}

function buildPayload({ subject_type, subject_id, field, value, source, source_url, observed_at, observed_at_basis, observed_at_confidence, trust, method, kind, content_text, quote, extra, rank, validation }) {
  const conf = observed_at_confidence == null ? null : Number(observed_at_confidence);
  return {
    source_slug: source,
    kind,
    observed_at: new Date(observed_at).toISOString(),
    source_url: source_url || undefined,
    // subject + field embedded here on purpose — see IDEMPOTENCY above.
    source_identifier: `${ID_PREFIX[subject_type] || subject_type}:${subject_id}:${field}`,
    // ── THE VEHICLE CASE — fixed 2026-07-20 during adversarial verification ──
    // GAP FOUND: subject_type='vehicle' previously emitted subject:{type,id}
    // and NO vehicle_id, producing a row with subject_id set and
    // vehicle_id NULL. Guide 20 §3 defines the effective subject as
    // (subject_type, COALESCE(subject_id, vehicle_id)) — so that row is
    // *technically* well-formed, and *practically* invisible: every vehicle
    // read surface in this platform keys on vehicle_id, including
    // idx_observations_vehicle, idx_observations_vehicle_time,
    // idx_vo_vehicle_source_kind and idx_vobs_specs_covering (all measured,
    // all `WHERE vehicle_id IS NOT NULL` or keyed on it), plus ingest-
    // observation's own gapFillVehicle / writeFieldEvidence post-processing.
    // A "universal" writer that silently orphans facts about the platform's
    // CORE subject is org-shaped with a parameter bolted on. The canonical
    // vehicle form is vehicle_id set / subject_id NULL, which is also what
    // makes the row byte-identical to the untouched pre-existing vehicle path.
    ...(subject_type === 'vehicle'
      ? { vehicle_id: subject_id }
      : { subject: { type: subject_type, id: subject_id } }),
    content_text: content_text || undefined,
    structured_data: {
      field,
      value,
      // provenance of the NUMBER, per feedback_numbers_carry_source_DNA
      method: method || undefined,
      trust: trust || undefined,
      // provenance of the DATE — the thing that is easiest to fake and most
      // load-bearing. Carried here because ingest-observation does not yet
      // accept the observed_at_confidence column (see header).
      observed_at_basis: observed_at_basis || undefined,
      observed_at_confidence: conf ?? undefined,
      ...(conf != null && conf < 0.5 ? { date_uncertain: true } : {}),
      ...(quote ? { quote } : {}),
      ...(validation && validation.verdict !== 'skipped' ? { validation_verdict: validation.verdict } : {}),
      ...(validation?.verdict === 'flag' ? { validation_flags: validation.checks.filter((c) => c.pass === false).map((c) => c.check) } : {}),
      writer: 'scripts/entity/observe.mjs',
      ...extra,
    },
    rank,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// CLI
// ════════════════════════════════════════════════════════════════════════════
const C = { r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };

function argv() {
  const a = process.argv.slice(2); const o = { _: [] };
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) {
      const k = a[i].slice(2).replace(/-/g, '_');
      if (a[i + 1] && !a[i + 1].startsWith('--')) o[k] = a[++i]; else o[k] = true;
    } else o._.push(a[i]);
  }
  return o;
}

// ════════════════════════════════════════════════════════════════════════════
// OWNER-GATED PROPOSALS — printed, never applied.
// Kept HERE rather than in a status .md so a future agent reading the tool gets
// the whole picture cold. AGENTS.md invariant 4 / guide 20 §7: schema changes
// need Skylar's explicit sign-off.
// ════════════════════════════════════════════════════════════════════════════
export const PROPOSALS = [
  {
    id: 'P1', priority: 'blocks everything below',
    title: 'Extend vehicle_observations subject_type CHECK to the platform\'s real subject types',
    why: 'Measured: the CHECK is NOT VALID but NOT VALID still enforces on INSERT. Of 7 subject types in this platform exactly ONE (organization) can be written today. property (1,278 rows), product (23,731) and publication_page (47,792) are refused at insert. 502 property + 200 product dated facts are mined, validated and payload-built by this toolkit right now and cannot land.',
    sql: `ALTER TABLE vehicle_observations DROP CONSTRAINT vehicle_observations_subject_type_chk;
ALTER TABLE vehicle_observations ADD CONSTRAINT vehicle_observations_subject_type_chk
  CHECK (subject_type IN ('vehicle','organization','user','asset','property','product','publication_page')) NOT VALID;`,
    cost: 'Metadata-only, instant, no table rewrite, no row touched. Reversible.',
    not_included: 'person (mag_people PK is TEXT — needs an id uuid first) and brand (brands uuid vs organization_brands.brand_name text — needs reconciliation). Both are ontology decisions, not CHECK edits. Do not guess the join; guide 20 §7 step 4b already got blocked guessing an actors↔users join.',
  },
  {
    id: 'P2', priority: 'PREREQUISITE to any large backfill, not a follow-up',
    title: 'Index (subject_type, subject_id) on vehicle_observations',
    why: 'Guide 20 §7 step 1 deferred this "until non-vehicle rows exist". They exist now. Measured today: SELECT subject_type, count(*) ... WHERE subject_type<>\'vehicle\' TIMES OUT on 10,249,718 rows. Every read surface for non-vehicle subjects is currently unservable, and the full org backfill is ~19k more rows against an unindexed predicate.',
    sql: `CREATE INDEX CONCURRENTLY idx_vobs_subject ON vehicle_observations (subject_type, subject_id)
  WHERE subject_type <> 'vehicle';`,
    cost: 'Partial index — covers ~500 rows today, stays tiny, never touches the 10.2M vehicle rows. CONCURRENTLY = no write lock.',
  },
  {
    id: 'P3', priority: 'correctness bug, code not schema',
    title: 'Add subject_type/subject_id to the ingest-observation content hash',
    why: 'ingest-observation/index.ts L139-149 hashes {source,kind,vehicle_id,source_url,source_identifier,observed_at,text,data,observer}. The subject is ABSENT. Two different subjects with identical payloads collapse and the caller is handed someone else\'s observation_id. This is the identical bug fixed for vehicle_id on 2026-05-24, never extended to the subject. _shared/observationWriter.ts L326 is worse — it hashes only {platform,kind,identifier,text,fields}, missing vehicle_id AND source_url AND subject; it never got the 2026-05-24 fix at all. Two write paths, two hash formulas.',
    sql: null,
    workaround_in_place: 'observe.mjs embeds <prefix>:<subject_id>:<field> in source_identifier, which IS in the hash and in the unique_observation index. Correct for THIS writer; every other caller is still exposed.',
  },
  {
    id: 'P4', priority: 'makes the dating honest at the column level',
    title: 'Thread observed_at_confidence / observed_at_basis through ingest-observation',
    why: 'The vehicle_observations.observed_at_confidence COLUMN exists and defaults to 1.00, so every backfilled row currently claims a perfectly-known date at the column level while structured_data honestly says 0.30. Any consumer reading the column is misled. One conditional spread, byte-identical when omitted — same pattern as the subject.',
    sql: null,
  },
  {
    id: 'P5', priority: 'design decision, needs a ruling',
    title: 'Two competing decay models are live; the wrong one wins',
    why: 'observation_half_lives says kind=specification is permanent (999999 days). observation_sources.decay_half_life_days says 90-365 per source. The deployed v_observations_needing_refresh reads the SOURCE value, so an org\'s permanent specification decays on a 90-day clock. That view also resolves the subject from structured_data->>\'subject\' — a THIRD subject convention predating the column, so every backfilled row reads back as subject:null.',
    sql: null,
  },
];

function printProposals() {
  console.log(`\n${C.b}OWNER-GATED — PROPOSED, NOT APPLIED${C.x}\n`);
  for (const p of PROPOSALS) {
    console.log(`${C.b}${p.id}  ${p.title}${C.x}\n   ${C.y}priority:${C.x} ${p.priority}\n   ${C.d}${p.why}${C.x}`);
    if (p.sql) console.log(`${C.g}${p.sql.split('\n').map((l) => '   ' + l).join('\n')}${C.x}`);
    if (p.cost) console.log(`   cost: ${p.cost}`);
    if (p.not_included) console.log(`   ${C.r}deliberately NOT included:${C.x} ${p.not_included}`);
    if (p.workaround_in_place) console.log(`   workaround in place: ${p.workaround_in_place}`);
    console.log();
  }
}

async function main() {
  const a = argv();
  const cmd = a._[0];

  if (cmd === 'subjects' || (!cmd && !a.subject_type)) {
    console.log(`\n${C.b}SUBJECT WRITABILITY — measured against the live DB${C.x}\n`);
    for (const t of Object.keys(SUBJECTS)) {
      const w = subjectWritability(t);
      const mark = w.writable ? `${C.g}WRITABLE${C.x}` : `${C.r}BLOCKED ${C.x}`;
      console.log(`  ${mark}  ${t.padEnd(17)} ${SUBJECTS[t].table.padEnd(22)} ${w.reason ? C.d + w.reason + C.x : ''}`);
    }
    console.log(`\n${C.d}Blocked types still build a full payload (observe() returns it) — they land\nthe moment the CHECK is extended. That is an OWNER-GATED schema change.${C.x}\n`);
    return;
  }

  if (cmd === 'propose') { printProposals(); return; }

  const r = await observe({
    subject_type: a.subject_type, subject_id: a.subject_id,
    field: a.field, value: a.value,
    source: a.source, source_url: a.source_url,
    observed_at: a.observed_at,
    observed_at_basis: a.observed_at_basis,
    observed_at_confidence: a.observed_at_confidence == null ? null : Number(a.observed_at_confidence),
    trust: a.trust, method: a.method,
    kind: a.kind || 'specification',
    quote: a.quote,
    validation_context: a.no_validate ? null : {},
    commit: !!a.commit,
    allow_unvalidated: !!a.allow_unvalidated,
  });
  const col = { written: C.g, duplicate: C.d, dry_run: C.y, refused: C.r, error: C.r }[r.action] || '';
  console.log(`${col}${r.action}${C.x}${r.reason ? '  ' + r.reason : ''}${r.observation_id ? '  ' + r.observation_id : ''}`);
  if (r.payload) console.log(JSON.stringify(r.payload, null, 2));
  if (r.action === 'error' || r.action === 'refused') process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(2); });
