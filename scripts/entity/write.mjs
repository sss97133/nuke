#!/usr/bin/env node
// scripts/entity/write.mjs — THE SINGLE GUARDED WRITER for served columns.
//
// ────────────────────────────────────────────────────────────────────────────
// WHAT THIS IS
// ────────────────────────────────────────────────────────────────────────────
// Every write to a column the app SERVES (organizations.description,
// properties.base_price, concierge_products.price, organizations.logo_url …)
// goes through `writeField`. Today ~20 scripts hold their own `.update()` and
// each one is an ungated door: a careless write is indistinguishable from truth
// the moment it lands, and it stays until a human notices. That is the defect
// class this file closes — not by being careful, but by making validation
// impossible to forget, because the write path and the gate are the same call.
//
// It composes three organs that ALREADY EXIST and are NOT reimplemented here:
//   scripts/entity/validate.mjs   — the verdict. Every check in it is a
//                                   measured defect. This file adds none.
//   scripts/entity/observe.mjs    — the dated fact, through ingest-observation.
//   the metadata quarantine convention established by
//   scripts/concierge/quarantine-elan-prices.mjs (`metadata.price_quarantine`)
//   and scripts/concierge/repair-blank-marks.mjs (`metadata.mark_quarantine`,
//   `metadata.mark_quality`) — reused verbatim, same keys, same vocabulary, so
//   one query finds every preserved value whether a repair script or this
//   writer put it there.
//
// ────────────────────────────────────────────────────────────────────────────
// THE CONTRACT, ARGUED
// ────────────────────────────────────────────────────────────────────────────
// writeField({ subject_type, subject_id, field, value, source, source_url,
//              observed_at, method, trust, actor, ... })
//   -> { applied, action, severity, reason, observation_id, evidence }
//
//    `action` is the field to branch on:
//      applied      the column was written
//      would_apply  dry run; it WOULD have been written
//      quarantined  held at the door, candidate preserved, column untouched
//      conflict     an incumbent differs; supersede:true is the only way past
//      refused      blocked, unknown, or no provenance
//    `applied` is true only for a real committed write, so in dry-run a refusal
//    and an admission both report applied:false — branch on `action`.
//
// 1. VALIDATE FIRST — and validate even when the write will be refused for
//    other reasons. ORDER ARGUED: provenance refusal (rule 4) is cheaper than
//    the gate and could run first, but then a provenance-less write would
//    teach us nothing about whether the VALUE was plausible. The gate's verdict
//    is itself evidence about the source, and evidence is the product. So:
//    structural preflight → gate → provenance → conflict → write.
//
// 2. SEVERITY → ACTION. The ladder is validate.mjs's, the mapping is here:
//      block      → REFUSED. No column write, no quarantine record. A blocked
//                   value is a category error or a fabrication (a negative
//                   price, a placeholder string in an image column, a value a
//                   full decade outside its own population). Preserving it in
//                   metadata with a restore path would invite a human to
//                   restore a category error. The observation is its record.
//      quarantine → COLUMN UNTOUCHED, candidate PRESERVED in the metadata
//                   quarantine convention with an `apply:` SQL recovery path.
//                   Contradicted-by-better-evidence is not the same as absurd;
//                   it may be right and we may be wrong, so it stays reachable.
//      flag       → APPLIED, with the degradation recorded alongside in
//                   `<class>_quality`. PRECEDENT: repair-blank-marks.mjs
//                   deliberately does NOT null a low-resolution favicon — it is
//                   genuinely the subject's own asset, just too small. Refusing
//                   a real-but-degraded value would leave the profile emptier
//                   than the truth. Downgrading is a repair job, not a gate job.
//      unknown    → REFUSED. Unknown is not permission (AGENTS.md invariant 2).
//                   This is the one that would be easiest to get wrong and it
//                   is the whole point: "no fitted band, cannot judge" must not
//                   mean "go ahead".
//      pass       → APPLIED.
//
// 3. OBSERVE ALWAYS, EVEN WHEN REFUSED. A refused write is a fact: we learned
//    this source asserted something implausible. It is written through
//    observe.mjs with the verdict attached, NOT with a second validate() run —
//    `validation_context: null` skips observe's own gate (it would re-fetch and
//    re-decode every image) and the verdict travels in `extra` instead, landing
//    in `structured_data.validation_verdict` exactly where observe's own gate
//    would have put it. Where the subject cannot be expressed as an observation
//    — `vehicle_observations.subject_type` CHECK admits only vehicle /
//    organization / user / asset, and property.base_price + product.price are
//    ALREADY DATED elsewhere (price_observations, the product row itself) —
//    this DEGRADES: `observation.action = 'refused'` with the reason carried in
//    the return value. It never throws, and it never fakes a write.
//
// 4. NEVER SILENTLY OVERWRITE. The current column value is read before every
//    write. A differing non-null incumbent is a CONFLICT: refused, both values
//    returned. `supersede: true` is the only way past it, and it preserves the
//    prior value under `<field>_supersession` with a `restore:` SQL string —
//    the same shape quarantine-elan-prices.mjs uses, because a supersession
//    that cannot be undone is a delete wearing a different verb.
//
// 5. PROVENANCE IS MANDATORY. No `source` or no `observed_at` → refused. A
//    value whose origin is unknown cannot be defended, and defensibility is the
//    product. `now()` is not an observed_at (observe.mjs makes the same
//    refusal for the same reason); it is a timestamp of the scrape, not of the
//    fact.
//
// 6. DRY-RUN BY DEFAULT. `apply: true` is the only thing that writes.
//
// ────────────────────────────────────────────────────────────────────────────
// WHAT THIS FILE DELIBERATELY DOES NOT DO
// ────────────────────────────────────────────────────────────────────────────
//   - It adds no checks. If a defect class is not caught, fix validate.mjs (or
//     _org_entity_gate.mjs) so the audit CLI and the write path stay one truth.
//   - It never DELETEs and never NULLs a served column. Remediation of values
//     ALREADY in the table belongs to the repair scripts that own it. This gate
//     only decides about values arriving.
//   - It does not guess a metadata column. `vehicles` has three plausible jsonb
//     columns and no established quarantine convention; rather than mint one on
//     the platform's core table, quarantine there is REFUSED with a reason.
//
// ────────────────────────────────────────────────────────────────────────────
// USAGE
// ────────────────────────────────────────────────────────────────────────────
//   library (single):
//     import { writeField } from './scripts/entity/write.mjs';
//     const r = await writeField({
//       subject_type: 'property', subject_id: '<uuid>', field: 'base_price',
//       value: 22000, source: 'elanvillarental', source_url: 'https://…',
//       observed_at: '2026-07-20', method: 'live_page_verification',
//       trust: 'measured', actor: 'agent:turnstile-elan', apply: true });
//
//   library (batch — one read per table, one cohort pass, N decisions):
//     import { writeFields } from './scripts/entity/write.mjs';
//     const rs = await writeFields(items, { apply: true });
//
//   CLI:
//     node scripts/entity/write.mjs selftest        # replays real defects, writes nothing
//     node scripts/entity/write.mjs set property <id> base_price 22000 \
//          --source=elan --observed-at=2026-07-20 [--apply] [--supersede]
//   always: cd /Users/skylar/nuke && dotenvx run --quiet -- node scripts/entity/write.mjs …

import { createClient } from '@supabase/supabase-js';
import {
  validate, SUBJECTS, cohortDisplacement, sharedValue, digestOf, toNightly, groupOf,
} from './validate.mjs';
import { observe } from './observe.mjs';

let _db = null;
// X-Nuke-Writer: every write this gate makes leaves a write_receipts row naming
// this path (migration 20260721000000). Undeclared writes stand out on v_write_pulse.
const db = () => (_db ??= createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  global: { headers: { 'X-Nuke-Writer': 'scripts/entity/write.mjs' } },
}));

// ════════════════════════════════════════════════════════════════════════════
// WHERE A REFUSED-BUT-PRESERVED VALUE LANDS
// ════════════════════════════════════════════════════════════════════════════
// MEASURED 2026-07-20 against the live schema, not assumed. `null` means this
// table has no jsonb sidecar and therefore no quarantine store — a quarantine
// verdict there is refused rather than silently downgraded to a pass, because
// "I could not preserve it" is not "it was fine".
const META_COL = {
  organization: 'metadata',        // organizations.metadata  (jsonb) — the convention's home
  property: 'metadata',            // properties.metadata     (jsonb) — price_quarantine lives here
  product: 'structured_data',      // concierge_products.structured_data (jsonb)
  publication_page: 'metadata',    // publication_pages.metadata (jsonb)
  vehicle: null,                   // three candidate jsonb cols, no convention — do not mint one
  brand: null,                     // brands has no jsonb column at all
  person: null,                    // mag_people has no jsonb column at all
};

// Quarantine key by field class, so this writer's records are found by the same
// query that finds the repair scripts' records. Not a new vocabulary — theirs.
const QUARANTINE_KEY = (field, isImage, isMoney) =>
  isMoney ? 'price_quarantine' : isImage ? 'mark_quarantine' : `${field}_quarantine`;
const QUALITY_KEY = (field, isImage, isMoney) =>
  isMoney ? 'price_quality' : isImage ? 'mark_quality' : `${field}_quality`;

const isImageField = (field, ctx = {}) => ctx.is_image ?? /logo|image|photo|banner|thumbnail|mark|avatar/i.test(field);
const isMoneyField = (field, ctx = {}) => ctx.is_money ?? /price|rate|cost|amount|fee|asking/i.test(field);

// SQL literal for the restore/apply strings. These are strings a HUMAN pastes,
// so they must be correct and obviously safe to read; nothing here executes SQL.
const sqlLit = (v) =>
  v === null || v === undefined ? 'NULL'
    : typeof v === 'number' ? String(v)
      : typeof v === 'boolean' ? (v ? 'true' : 'false')
        : `'${String(v).replace(/'/g, "''")}'`;

// Equality that does not manufacture a conflict out of formatting. A stored
// "  22000 " and an incoming 22000 are the same claim; 22000 and 22000.4 are not.
const sameValue = (a, b) => {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'number' || typeof b === 'number') {
    const x = Number(a), y = Number(b);
    return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 1e-9;
  }
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return String(a).trim() === String(b).trim();
};

// ════════════════════════════════════════════════════════════════════════════
// SUBJECT ROW LOAD — one read serves conflict detection, unit derivation and
// band grouping, so the gate is never asked to judge a price whose currency and
// period are sitting in the same row it is about to overwrite.
// ════════════════════════════════════════════════════════════════════════════
function unitColsFor(subject_type, field) {
  const s = SUBJECTS[subject_type];
  const pair = s?.priceUnitCols?.[field];
  return { currencyCol: pair?.[0] ?? null, periodCol: pair?.[1] ?? null };
}

function selectListFor(subject_type, field) {
  const s = SUBJECTS[subject_type];
  const { currencyCol, periodCol } = unitColsFor(subject_type, field);
  const cols = new Set([s.pk, field]);
  if (s.nameCol) cols.add(s.nameCol);
  if (currencyCol) cols.add(currencyCol);
  if (periodCol) cols.add(periodCol);
  if (META_COL[subject_type]) cols.add(META_COL[subject_type]);
  // whatever groupOf() needs to find the merchant/source band
  if (subject_type === 'product') cols.add('org_id');
  if (subject_type === 'property') cols.add('source_url');
  return [...cols].join(',');
}

async function loadRow(subject_type, subject_id, field) {
  const s = SUBJECTS[subject_type];
  const { data, error } = await db().from(s.table).select(selectListFor(subject_type, field)).eq(s.pk, subject_id).limit(1);
  if (error) return { row: null, error: error.message };
  return { row: data?.[0] ?? null, error: null };
}

// Batch loader — PostgREST caps at 1000 rows and silently clamps larger limits,
// so ids are chunked well under the cap rather than trusting one big `.in()`.
async function loadRows(subject_type, ids, field) {
  const s = SUBJECTS[subject_type];
  const out = new Map();
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 200) {
    const slice = uniq.slice(i, i + 200);
    const { data, error } = await db().from(s.table).select(selectListFor(subject_type, field)).in(s.pk, slice);
    if (error) return { rows: out, error: error.message };
    for (const r of data) out.set(String(r[s.pk]), r);
  }
  return { rows: out, error: null };
}

// ════════════════════════════════════════════════════════════════════════════
// THE OBSERVATION SIDE — always attempted, never fatal.
// ════════════════════════════════════════════════════════════════════════════
// The verdict rides in `extra` because observe.mjs's own gate is skipped here
// (validation_context: null). Running validate twice would re-fetch and
// re-decode every image over the network for zero new information; passing the
// verdict forward keeps ONE adjudication behind ONE observation, which is also
// the only way the observation and the column decision can never disagree.
async function recordObservation({
  subject_type, subject_id, field, value, source, source_url, observed_at,
  observed_at_basis, observed_at_confidence, method, trust, actor, kind,
  verdict, checks, outcome, reason, commit,
}) {
  try {
    const r = await observe({
      subject_type, subject_id, field, value,
      source, source_url, observed_at, observed_at_basis, observed_at_confidence,
      method, trust, kind: kind || 'specification',
      validation_context: null,          // already adjudicated — see above
      extra: {
        writer: 'scripts/entity/write.mjs',
        actor: actor || undefined,
        validation_verdict: verdict,
        write_outcome: outcome,          // applied | refused | quarantined | conflict
        write_reason: reason || undefined,
        ...(checks?.length ? { validation_failed_checks: checks.filter((c) => c.pass === false).map((c) => c.check) } : {}),
        ...(checks?.length ? { validation_unknown_checks: checks.filter((c) => c.pass === null).map((c) => c.check) } : {}),
      },
      commit,
    });
    return {
      action: r.action, reason: r.reason, blocker: r.blocker ?? null,
      observation_id: r.observation_id ?? null,
    };
  } catch (e) {
    // A failed observation must never convert into a failed refusal. Degrade.
    return { action: 'error', reason: String(e?.message || e), blocker: 'observe_threw', observation_id: null };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// writeField — THE DOOR
// ════════════════════════════════════════════════════════════════════════════
export async function writeField({
  subject_type, subject_id, field, value,
  source = null, source_url = null, observed_at = null,
  observed_at_basis = null, observed_at_confidence = null,
  method = null, trust = null, actor = null, kind = null,
  context = {},                 // extra validation context (currency/period/evidence/peers/region)
  supersede = false,
  apply = false,
  _row = undefined,             // batch pre-load; undefined = load it here
  _extraChecks = [],            // batch-level findings (cohort displacement) folded into the verdict
} = {}) {
  const out = {
    subject_type, subject_id, field, value,
    applied: false,
    // `applied` alone is ambiguous in dry-run: a refusal and a would-be write
    // both report applied:false, and reading the first selftest output I
    // mislabelled admitted values as REFUSED. `action` is the unambiguous one
    // and every caller should branch on it, not on `applied`.
    //   applied | would_apply | refused | quarantined | conflict
    action: 'refused',
    severity: 'unknown', reason: null,
    observation_id: null, observation: null,
    evidence: { checks: [], current_value: undefined, dry_run: !apply },
  };
  const done = (severity, reason, action = 'refused') => { out.severity = severity; out.reason = reason; out.action = action; return out; };

  // ── structural preflight (cannot even be adjudicated) ─────────────────────
  if (!SUBJECTS[subject_type]) return done('block', `unknown subject_type "${subject_type}" — add it to SUBJECTS in validate.mjs (known: ${Object.keys(SUBJECTS).join('|')})`);
  if (!subject_id) return done('block', 'subject_id is required');
  if (!field) return done('block', 'field is required');
  if (value === undefined) return done('unknown', 'value is undefined — unknown is not zero and not false; use the absence writer to testify to absence');

  // ── load the incumbent + the row's own units (one read, several jobs) ─────
  let row = _row;
  if (row === undefined) {
    const l = await loadRow(subject_type, subject_id, field);
    if (l.error) return done('unknown', `could not read ${SUBJECTS[subject_type].table}.${field}: ${l.error} — refusing to write blind`);
    row = l.row;
  }
  if (!row) return done('block', `no ${SUBJECTS[subject_type].table} row with ${SUBJECTS[subject_type].pk}=${subject_id} — refusing to write to a subject that does not exist`);

  const current = row[field];
  out.evidence.current_value = current ?? null;
  const { currencyCol, periodCol } = unitColsFor(subject_type, field);
  const isImage = isImageField(field, context);
  const isMoney = isMoneyField(field, context);

  // Units are DERIVED from the row unless the caller overrides. The WIMCO
  // defect is exactly a reader supplying its own unit, so the unit must come
  // from the same place as the number, never from the reader's assumption.
  const vctx = {
    ...context,
    currency: context.currency ?? (currencyCol ? row[currencyCol] : undefined),
    period: context.period ?? (periodCol ? row[periodCol] : undefined),
    group: context.group ?? groupOf(subject_type, row) ?? undefined,
    subject: context.subject ?? { name: SUBJECTS[subject_type].nameCol ? row[SUBJECTS[subject_type].nameCol] : undefined, ...row },
  };

  // ── 0. THE UNIT MUST SURVIVE THE WRITE ────────────────────────────────────
  // Adversarial proof 2026-07-20 (mechanism M1): the served patch was `{ [field]: value }`
  // alone, so a caller could declare period:'night', have the number judged against the
  // NIGHTLY band, and land it in a row whose stored price_period still says 'week'. That is
  // the 388-villa WIMCO defect reproduced THROUGH the gate, and it needed no adversarial
  // intent — 464 rows (edenrock 264, lebarth 186, elan 9, sibarth 5) currently hold a
  // non-night unit with base_price empty, and the routed Le Barth leg writes into exactly
  // those. A gate that validates a unit the database will not store is theatre.
  //
  // Two rules, both narrow:
  //   (a) a declared unit that CONTRADICTS the row's stored unit is refused outright — the
  //       caller and the row cannot both be right, and silently trusting the caller is how
  //       the defect happens;
  //   (b) a declared unit on a row that has NONE is carried into the same patch as the
  //       number, so the value and its unit land together or not at all.
  const unitPatch = {};
  let unitConflict = null;
  if (isMoney) {
    for (const [col, declared, kind] of [
      [currencyCol, context.currency, 'currency'],
      [periodCol, context.period, 'period'],
    ]) {
      if (!col || declared == null) continue;
      const stored = row[col];
      if (stored != null && String(stored) !== String(declared)) {
        unitConflict ??= { column: col, kind, stored, declared };
      } else if (stored == null) {
        unitPatch[col] = declared;
      }
    }
  }

  // ── 1. THE GATE, FIRST ────────────────────────────────────────────────────
  let v;
  try {
    v = await validate({ subject_type, field, value, context: vctx });
  } catch (e) {
    // A gate that errored did not pass anything. Unknown is not permission.
    v = { verdict: 'unknown', checks: [{ check: 'gate', pass: null, severity: 'unknown', reason: `validate threw: ${String(e?.message || e)}`, evidence: {} }] };
  }
  // ── shared-binary (the 244-villa defect) — only when peers are supplied ───
  // validate.mjs's `sharedValue` owns the "misattribution vs duplicate row"
  // judgement and is called here UNCHANGED. What it needs is the right key:
  // the 244 villas do NOT share a logo_url (each has its own storage path) —
  // they share the BYTES. So when the caller supplies peers carrying digests,
  // the incoming value is hashed with the exported `digestOf` and clustered on
  // `__digest`. No peers supplied → no cost, no check, and the verdict says so
  // rather than pretending the question was asked.
  const peerChecks = [];
  if (isImageField(field, context) && Array.isArray(context.peers) && context.peers.length) {
    const mine = context.digest ?? await digestOf(value);
    if (mine) {
      const rows = [
        ...context.peers.filter((p) => p.__digest || p.digest).map((p) => ({ ...p, __digest: p.__digest ?? p.digest })),
        { id: '__self', name: vctx.subject?.name, __digest: mine },
      ];
      // Match the finding by its VALUE, not by looking for '__self' in
      // evidence.ids — that list is `.slice(0, 12)` inside sharedValue, so on
      // the real 244-villa cluster the self row falls off the end and the
      // finding was silently dropped. Measured: the first version of this line
      // reported "no shared_value finding" on a 225-row cluster.
      const mineKey = String(mine).slice(0, 140);
      peerChecks.push(...sharedValue(rows, { field: '__digest' }).filter((s) => s.evidence.value === mineKey));
    } else {
      peerChecks.push({ check: 'shared_value', pass: null, severity: 'unknown', reason: 'could not hash the incoming binary — cannot tell whether it is already worn by other subjects', evidence: { value } });
    }
  }

  const checks = [...(v.checks || []), ...peerChecks, ..._extraChecks];
  // Batch/peer findings can only ever RAISE severity, never lower it.
  const SEV = { block: 4, quarantine: 3, flag: 2, unknown: 1, pass: 0 };
  let verdict = v.verdict;
  for (const c of [...peerChecks, ..._extraChecks]) if (SEV[c.severity] > SEV[verdict]) verdict = c.severity;

  // ── COHORT ESCALATION — a WRITE-DOOR policy, not a change to the gate ─────
  // validate.mjs gives cohort_displacement severity `flag` and argues it well:
  // in an AUDIT, a displaced cohort is a lead requiring merchant verification,
  // not a verdict — Edmiston's +1.23 decades is superyachts, not a defect.
  // But an audit says "look" and a door must say yes or no, and `flag` at a
  // door means SERVE IT. Measured on the real replay: with cohort at flag, 4 of
  // the 9 Elan prices (2027, 3948, 5582, 7746 USD/wk) were admitted — the exact
  // four the per-value band cannot catch, which is the whole reason the cohort
  // check exists. Admitting them defeats the check that found them.
  // So at the door only, a displaced cohort escalates flag → quarantine:
  // not served, not lost, recoverable with an apply: path, verification owed.
  // The gate keeps its honest audit semantics; the policy lives with the write.
  if (verdict === 'flag' && checks.some((c) => c.check === 'cohort_displacement' && c.pass === false)) {
    verdict = 'quarantine';
    checks.push({
      check: 'cohort_escalation', pass: false, severity: 'quarantine',
      reason: 'cohort_displacement is `flag` in audit but a write door cannot serve a lead — escalated to quarantine so the value is held, preserved and verifiable rather than published',
      evidence: { policy: 'scripts/entity/write.mjs cohort escalation' },
    });
  }
  out.evidence.checks = checks;
  out.evidence.verdict = verdict;
  out.evidence.units = { currency: vctx.currency ?? null, period: vctx.period ?? null, band_group: vctx.group ?? null };
  const failing = checks.filter((c) => c.pass === false);
  const gateReason = (failing.length ? failing : checks.filter((c) => c.pass === null))
    .map((c) => `${c.check}: ${c.reason}`).join(' | ') || 'no failing check';

  const observeArgs = {
    subject_type, subject_id, field, value, source, source_url, observed_at,
    observed_at_basis, observed_at_confidence, method, trust, actor, kind,
    verdict, checks,
  };

  // ── 1b. UNIT CONFLICT (see the M1 note above) ─────────────────────────────
  // Placed after the gate so the observation records what the gate thought too, but it
  // OVERRIDES any verdict: a value judged in one unit and served in another is wrong however
  // plausible the number looked.
  if (unitConflict) {
    const { column, kind, stored, declared } = unitConflict;
    const obs = await recordObservation({ ...observeArgs, outcome: 'refused', reason: `declared ${kind} contradicts stored`, commit: apply });
    out.observation = obs; out.observation_id = obs.observation_id;
    out.evidence.unit_conflict = unitConflict;
    return done('block',
      `refused_unit_conflict: caller declared ${kind}='${declared}' but ${SUBJECTS[subject_type].table}.${column} already holds '${stored}'. The number would be judged as ${declared} and served as ${stored} — that is the nightly-rate-labelled-weekly defect. Resolve the unit before writing the value.`);
  }

  // ── 2. PROVENANCE (after the gate, so a refusal still teaches us) ─────────
  if (!source || !observed_at) {
    const missing = [!source && 'source', !observed_at && 'observed_at'].filter(Boolean).join(' and ');
    // Not observed either: an observation with no source and no date IS the
    // thing we are refusing. There is nothing defensible to keep.
    out.observation = { action: 'not_attempted', reason: `no ${missing} — an observation without provenance is the defect, not a record of it` };
    return done('block', `no_provenance: missing ${missing} — a value whose origin is unknown cannot be defended, and defensibility is the product (gate said: ${verdict})`);
  }

  // ── 3. SEVERITY → ACTION ──────────────────────────────────────────────────
  if (verdict === 'block' || verdict === 'unknown') {
    const obs = await recordObservation({ ...observeArgs, outcome: 'refused', reason: gateReason, commit: apply });
    out.observation = obs; out.observation_id = obs.observation_id;
    return done(verdict, verdict === 'unknown'
      ? `refused_unknown: the gate could not judge this value — unknown is not permission (${gateReason})`
      : `refused_block: ${gateReason}`);
  }

  if (verdict === 'quarantine') {
    const metaCol = META_COL[subject_type];
    const obs = await recordObservation({ ...observeArgs, outcome: 'quarantined', reason: gateReason, commit: apply });
    out.observation = obs; out.observation_id = obs.observation_id;
    if (!metaCol) {
      return done('quarantine', `refused_quarantine_unstorable: ${gateReason} — and ${SUBJECTS[subject_type].table} has no registered jsonb sidecar, so the candidate cannot be preserved. Column untouched; the observation${obs.observation_id ? ` (${obs.observation_id})` : ' attempt'} is the only record.`, 'quarantined');
    }
    const key = QUARANTINE_KEY(field, isImage, isMoney);
    const rec = {
      reason: failing[0]?.check === 'image_sanity' ? String(failing[0].reason).split(' —')[0] : 'contradicted_by_gate',
      detail: gateReason,
      method: method || 'entity_write_gate',
      trust: trust || 'measured',
      // The repair scripts set nulled:true because they REMOVED a served value.
      // Nothing was removed here — an arriving candidate was held at the door.
      nulled: false,
      held_at_write: true,
      [`${field}_rejected`]: value,
      value_rejected: value,
      currency: vctx.currency ?? null,
      period: vctx.period ?? null,
      source, source_url: source_url || null,
      observed_at,
      actor: actor || null,
      writer: 'scripts/entity/write.mjs',
      verdict: 'quarantine',
      failed_checks: failing.map((c) => c.check),
      recorded_at: new Date().toISOString(),
      needs: 'verify against the merchant/subject before admitting this value',
      // RECOVERY PATH. The repair scripts carry `restore:` (put back what I
      // removed); this carries `apply:` (admit what I held) — the same promise
      // pointed the other way: nothing is lost, a human can act on it.
      apply: `UPDATE ${SUBJECTS[subject_type].table} SET ${field}=${sqlLit(value)} WHERE ${SUBJECTS[subject_type].pk}=${sqlLit(subject_id)};`,
    };
    out.evidence.quarantine = { column: metaCol, key, record: rec };
    if (apply) {
      const metadata = { ...(row[metaCol] || {}), [key]: rec };
      const { error } = await db().from(SUBJECTS[subject_type].table).update({ [metaCol]: metadata }).eq(SUBJECTS[subject_type].pk, subject_id);
      if (error) return done('quarantine', `refused_quarantine: ${gateReason} — AND the quarantine record failed to land: ${error.message}. Served column untouched.`, 'quarantined');
    }
    return done('quarantine', `refused_quarantine: ${gateReason} — served column untouched; candidate preserved at ${metaCol}.${key} with an apply: path${apply ? '' : ' (DRY RUN)'}`, 'quarantined');
  }

  // verdict is now 'pass' or 'flag' — the write is admissible.

  // ── 4. CONFLICT — never silently overwrite ────────────────────────────────
  // An EMPTY jsonb is not an incumbent fact. MEASURED 2026-07-20 wiring the
  // concierge enrichers: `organizations.hours_of_operation` defaults to `{}`,
  // which is truthy, so the first real opening-hours write ever attempted
  // reported `refused_conflict: already holds {}`. That is a fact column
  // standing empty being defended as though something stood in it — the gate
  // refusing a fill it should have admitted. Every caller in this repo already
  // treats `{}`/`[]` as empty (`!Object.keys(cur.hours_of_operation || {}).length`),
  // so the writer disagreeing with them was the bug, not the callers.
  // Deliberately NOT extended to 0 or false: those are values, and unknown is
  // not zero and not false runs in both directions.
  const isEmptyContainer = (x) => x !== null && typeof x === 'object'
    && (Array.isArray(x) ? x.length === 0 : Object.keys(x).length === 0);
  const hasIncumbent = current !== null && current !== undefined && current !== ''
    && !isEmptyContainer(current);
  const differs = hasIncumbent && !sameValue(current, value);
  if (differs && !supersede) {
    const obs = await recordObservation({ ...observeArgs, outcome: 'conflict', reason: `incumbent ${JSON.stringify(current)} differs`, commit: apply });
    out.observation = obs; out.observation_id = obs.observation_id;
    out.evidence.conflict = {
      field, current, incoming: value,
      resolve: 'pass supersede:true to overwrite (prior value is preserved with a restore path), or adjudicate both as observations: node scripts/entity/adjudicate.mjs',
    };
    return done('conflict', `refused_conflict: ${SUBJECTS[subject_type].table}.${field} already holds ${JSON.stringify(current)} and the incoming value is ${JSON.stringify(value)} — a fact column is never silently overwritten`, 'conflict');
  }

  // The unit travels with the number, in one patch — see the M1 note above. Never a second
  // write that could land alone or fail separately.
  const patch = { [field]: value, ...unitPatch };
  let metaOut = null;

  if (differs && supersede) {
    const metaCol = META_COL[subject_type];
    if (!metaCol) {
      const obs = await recordObservation({ ...observeArgs, outcome: 'refused', reason: 'supersession unrecordable', commit: apply });
      out.observation = obs; out.observation_id = obs.observation_id;
      return done('block', `refused_supersede_unrecordable: ${SUBJECTS[subject_type].table} has no registered jsonb sidecar, so the prior value ${JSON.stringify(current)} could not be preserved. A supersession that cannot be undone is a delete wearing a different verb.`);
    }
    const skey = `${field}_supersession`;
    const prior = (row[metaCol] || {})[skey];
    const rec = {
      superseded_at: new Date().toISOString(),
      [`${field}_as_found`]: current,
      new_value: value,
      reason: `superseded by ${source} observed ${observed_at}`,
      source, source_url: source_url || null, method: method || null, trust: trust || null,
      actor: actor || null,
      writer: 'scripts/entity/write.mjs',
      restore: `UPDATE ${SUBJECTS[subject_type].table} SET ${field}=${sqlLit(current)} WHERE ${SUBJECTS[subject_type].pk}=${sqlLit(subject_id)};`,
      // Chain, never replace: the second supersession must not erase the first.
      previous: prior ?? null,
    };
    metaOut = { ...(row[metaCol] || {}), [skey]: rec };
    out.evidence.supersession = { column: metaCol, key: skey, record: rec };
  }

  if (verdict === 'flag') {
    const metaCol = META_COL[subject_type];
    if (metaCol) {
      const qkey = QUALITY_KEY(field, isImage, isMoney);
      const qrec = {
        reason: failing[0]?.check === 'image_sanity' ? String(failing[0].reason).split(' —')[0] : 'degraded_but_real',
        detail: gateReason,
        method: method || 'entity_write_gate',
        trust: trust || 'measured',
        nulled: false,
        value_applied: value,
        source, source_url: source_url || null, observed_at,
        actor: actor || null,
        writer: 'scripts/entity/write.mjs',
        recorded_at: new Date().toISOString(),
        needs: failing[0]?.evidence?.needs || 'recapture at higher quality / verify the cohort against the merchant',
      };
      metaOut = { ...(metaOut ?? row[metaCol] ?? {}), [qkey]: qrec };
      out.evidence.quality = { column: metaCol, key: qkey, record: qrec };
    } else {
      out.evidence.quality = { column: null, note: `no jsonb sidecar on ${SUBJECTS[subject_type].table} — the flag survives only on the observation` };
    }
  }

  if (metaOut) patch[META_COL[subject_type]] = metaOut;
  out.evidence.patch = patch;

  if (!apply) {
    const obs = await recordObservation({ ...observeArgs, outcome: 'applied', reason: 'dry run', commit: false });
    out.observation = obs; out.observation_id = obs.observation_id;
    out.applied = false;
    return done(verdict, `dry_run: would ${differs ? 'SUPERSEDE' : hasIncumbent ? 're-affirm' : 'SET'} ${SUBJECTS[subject_type].table}.${field} = ${JSON.stringify(value)} (verdict ${verdict}) — re-run with apply:true`, 'would_apply');
  }

  // ── 5. THE WRITE ──────────────────────────────────────────────────────────
  const { error } = await db().from(SUBJECTS[subject_type].table).update(patch).eq(SUBJECTS[subject_type].pk, subject_id);
  if (error) {
    const obs = await recordObservation({ ...observeArgs, outcome: 'refused', reason: `column write failed: ${error.message}`, commit: true });
    out.observation = obs; out.observation_id = obs.observation_id;
    return done('block', `write_failed: ${error.message}`);
  }
  out.applied = true;
  // Observed AFTER the column write succeeded, so the testimony never claims a
  // write that did not happen. (Refusals observe before returning, above.)
  const obs = await recordObservation({ ...observeArgs, outcome: 'applied', reason: null, commit: true });
  out.observation = obs; out.observation_id = obs.observation_id;
  return done(verdict, `applied${differs ? ' (superseded, prior value preserved with a restore path)' : ''}${verdict === 'flag' ? ' (flagged degraded — recorded alongside)' : ''}`, 'applied');
}

// ════════════════════════════════════════════════════════════════════════════
// writeFields — THE BATCH FORM
// ════════════════════════════════════════════════════════════════════════════
// Not a loop with sugar. Two things it does that N single calls cannot:
//
//   1. ONE read per (subject_type, field) instead of N round trips.
//   2. COHORT DISPLACEMENT — the check that catches the Elan class. Measured in
//      validate.mjs's own header: the per-value band catches FIVE of the nine
//      Elan villas; the other four are individually plausible villa rates and
//      no population statistic can know they are wrong. The defect was never
//      per-value — it was one systematic parse failure across one source's
//      whole leg, and it is only visible across rows. A bulk enricher is
//      exactly where that leg arrives, so this is where the check belongs.
//      `cohortDisplacement` is called AS IS from validate.mjs; nothing is
//      reimplemented. It needs a population to compare against, so the live
//      column is loaded once (capped) and the incoming batch is measured
//      against it. Severity is `flag` by design — a displaced cohort is a lead
//      requiring merchant verification, not a verdict — but combined with a
//      band miss it is what turns 5/9 into 9/9.
//
// Batch findings can only RAISE a per-item severity, never lower one.
// ════════════════════════════════════════════════════════════════════════════
const COHORT_POP_CAP = 4000;

export async function cohortFindings(subject_type, field, items) {
  const s = SUBJECTS[subject_type];
  if (!s || !isMoneyField(field)) return { findings: [], reason: 'not a money field — cohort displacement is a price-regime check' };
  const { currencyCol, periodCol } = unitColsFor(subject_type, field);
  const cols = [s.pk, field, s.nameCol, currencyCol, periodCol, subject_type === 'property' ? 'source_url' : null, subject_type === 'product' ? 'org_id' : null]
    .filter(Boolean).join(',');

  // live population, paged under the 1000-row cap
  const pop = [];
  for (let from = 0; from < COHORT_POP_CAP; from += 1000) {
    const { data, error } = await db().from(s.table).select(cols).not(field, 'is', null).range(from, from + 999);
    if (error) return { findings: [], reason: `population read failed: ${error.message}` };
    pop.push(...data);
    if (data.length < 1000) break;
  }

  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
  const shape = (r, val, cur, per, name, cohort) => {
    const n = per ? toNightly(val, per) : null;
    return { __nightly: n ? n.value : val, __name: name, __cur: cur, source_host: cohort ?? 'unknown' };
  };

  const rows = pop.map((r) => shape(r, r[field], currencyCol ? r[currencyCol] : null, periodCol ? r[periodCol] : null,
    s.nameCol ? r[s.nameCol] : r[s.pk],
    subject_type === 'property' ? host(r.source_url) : subject_type === 'product' ? r.org_id : null));

  // Incoming candidates join the population under their OWN source host, which
  // is what makes an arriving bad leg visible before it lands.
  const incoming = items.map((it) => shape(it, it.value, it.context?.currency ?? null, it.context?.period ?? null,
    it.__name ?? it.subject_id, it.__cohort ?? host(it.source_url) ?? it.source ?? 'incoming'));

  const findings = cohortDisplacement([...rows, ...incoming], { cohortKey: 'source_host', valueKey: '__nightly' });
  return { findings, reason: null, population_n: rows.length, incoming_n: incoming.length };
}

export async function writeFields(items, { apply = false, cohort = true, ...defaults } = {}) {
  if (!Array.isArray(items) || !items.length) return [];
  const results = new Array(items.length);

  // group by (subject_type, field) — one read + one cohort pass per group
  const groups = new Map();
  items.forEach((it, i) => {
    const k = `${it.subject_type}::${it.field}`;
    (groups.get(k) ?? groups.set(k, []).get(k)).push({ it, i });
  });

  for (const [k, members] of groups) {
    const [subject_type, field] = k.split('::');
    if (!SUBJECTS[subject_type]) {
      for (const { it, i } of members) results[i] = await writeField({ ...defaults, ...it, apply });
      continue;
    }
    const { rows, error } = await loadRows(subject_type, members.map((m) => m.it.subject_id), field);
    if (error) {
      for (const { it, i } of members) results[i] = { ...it, applied: false, severity: 'unknown', reason: `batch read failed: ${error} — refusing to write blind`, observation_id: null, evidence: {} };
      continue;
    }

    // batch-level cohort check
    let extra = [];
    let cohortMeta = null;
    if (cohort && isMoneyField(field)) {
      const cf = await cohortFindings(subject_type, field, members.map(({ it }) => {
        const row = rows.get(String(it.subject_id));
        const { currencyCol, periodCol } = unitColsFor(subject_type, field);
        return {
          ...it,
          __name: row && SUBJECTS[subject_type].nameCol ? row[SUBJECTS[subject_type].nameCol] : it.subject_id,
          context: {
            currency: it.context?.currency ?? (currencyCol && row ? row[currencyCol] : null),
            period: it.context?.period ?? (periodCol && row ? row[periodCol] : null),
          },
        };
      }));
      cohortMeta = { population_n: cf.population_n, incoming_n: cf.incoming_n, reason: cf.reason };
      // Only findings naming a cohort present in THIS batch attach to it.
      const batchCohorts = new Set(members.map(({ it }) => {
        try { return new URL(it.source_url).hostname.replace(/^www\./, ''); } catch { return it.__cohort ?? it.source ?? 'incoming'; }
      }));
      extra = cf.findings.filter((f) => batchCohorts.has(f.evidence.cohort));
    }

    for (const { it, i } of members) {
      results[i] = await writeField({
        ...defaults, ...it, apply,
        _row: rows.get(String(it.subject_id)) ?? null,
        _extraChecks: extra,
      });
      if (cohortMeta) results[i].evidence.cohort = cohortMeta;
    }
  }
  return results;
}

// ════════════════════════════════════════════════════════════════════════════
// CLI
// ════════════════════════════════════════════════════════════════════════════
const C = { r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', c: '\x1b[36m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const colour = (sev) => sev === 'pass' ? C.g : sev === 'flag' ? C.y : sev === 'unknown' ? C.c : C.r;
// The label reads off `action`, never `applied` — in dry-run `applied` is false
// for admissions and refusals alike, and reading the first selftest output I
// mislabelled four admitted Elan prices as REFUSED because of exactly that.
const LABEL = { applied: 'ADMITTED', would_apply: 'WOULD ADMIT', quarantined: 'QUARANTINED', conflict: 'CONFLICT   ', refused: 'REFUSED    ' };
const label = (r) => LABEL[r.action] ?? r.action;
const admits = (r) => r.action === 'applied' || r.action === 'would_apply';

function argv() {
  const a = process.argv.slice(2); const o = { _: [] };
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) {
      const kv = a[i].slice(2); const eq = kv.indexOf('=');
      if (eq > -1) o[kv.slice(0, eq).replace(/-/g, '_')] = kv.slice(eq + 1);
      else o[kv.replace(/-/g, '_')] = true;
    } else o._.push(a[i]);
  }
  return o;
}

// ── the replay ──────────────────────────────────────────────────────────────
// Every case below is a REAL preserved record read live from the DB, not a
// fixture. The 9 Elan prices come from `properties.metadata.price_quarantine
// .base_price_as_found`; the blank marks from `organizations.metadata
// .mark_quarantine.logo_url_as_found`. Replaying them means asking: if this
// value arrived TODAY through the guarded door, would it get in?
// This selftest writes nothing — every call is dry-run.
async function selftest() {
  const sb = db();
  let refused = 0, admitted = 0, cases = 0;

  console.log(`\n${C.b}REPLAY 1 — the 9 Elan villa prices (27x-155x below the merchant's published rate)${C.x}`);
  console.log(`${C.d}source: properties.metadata.price_quarantine.base_price_as_found — preserved by quarantine-elan-prices.mjs${C.x}\n`);
  const { data: elan } = await sb.from('properties')
    .select('id,name,base_price,price_currency,price_period,source_url,metadata')
    .not('metadata->price_quarantine', 'is', null);

  const items = (elan || []).map((r) => ({
    subject_type: 'property', subject_id: r.id, field: 'base_price',
    value: r.metadata.price_quarantine.base_price_as_found,
    source: 'elanvillarental', source_url: r.source_url,
    observed_at: '2026-07-01', method: 'html_scrape', trust: 'reported',
    actor: 'agent:replay',
    context: { currency: r.metadata.price_quarantine.price_currency_as_found, period: r.metadata.price_quarantine.price_period_as_found },
    __name: r.name,
  }));

  // (a) each value on its own — what a single-row writer sees
  console.log(`${C.b}  1a. one at a time (the per-value band alone)${C.x}`);
  const solo = [];
  for (const it of items) {
    const r = await writeField({ ...it, apply: false });
    solo.push(r);
    cases++;
    const nightly = it.value / 7;
    console.log(`   ${colour(r.severity)}${label(r)}${C.x} ${String(it.__name).padEnd(14)} ${String(it.value).padStart(5)} USD/wk (${nightly.toFixed(0)}/night)  ${C.d}[${r.severity}]${C.x}`);
    console.log(`      ${C.d}${(r.reason || '').slice(0, 190)}${C.x}`);
    if (admits(r)) admitted++; else refused++;
  }

  // (b) the same nine as a batch — the leg, which is what actually arrived
  console.log(`\n${C.b}  1b. as the batch they really were (band + cohort displacement)${C.x}`);
  const batch = await writeFields(items, { apply: false });
  let bRef = 0;
  batch.forEach((r, i) => {
    if (!admits(r)) bRef++;
    const co = (r.evidence.checks || []).find((c) => c.check === 'cohort_displacement');
    console.log(`   ${colour(r.severity)}${label(r)}${C.x} ${String(items[i].__name).padEnd(14)} ${String(items[i].value).padStart(5)} USD/wk  ${C.d}[${r.severity}]${co ? ` +cohort ${co.evidence.decades} decades` : ''}${C.x}`);
  });
  const soloRef = solo.filter((r) => !admits(r)).length;
  console.log(`   ${C.b}${bRef}/${items.length} held as a batch${C.x} ${C.d}(vs ${soloRef}/${items.length} one at a time — the per-value band alone admits ${items.length - soloRef} genuinely-plausible-looking rates that are only wrong relative to their own merchant)${C.x}`);
  console.log(`   ${C.d}population compared against: ${batch[0]?.evidence?.cohort?.population_n} live rows${C.x}`);
  console.log(`   ${C.d}observation path: ${batch[0]?.observation?.action} — ${(batch[0]?.observation?.reason || '').slice(0, 150)}${C.x}`);

  console.log(`\n${C.b}REPLAY 2 — marks that composite to nothing / are misattributed${C.x}`);
  console.log(`${C.d}source: organizations.metadata.mark_quarantine.logo_url_as_found — preserved by repair-blank-marks.mjs${C.x}\n`);
  const { data: marks } = await sb.from('organizations')
    .select('id,name,logo_url,website,city,country,metadata')
    .not('metadata->mark_quarantine', 'is', null).limit(400);
  const withUrl = (marks || []).filter((o) => o.metadata?.mark_quarantine?.logo_url_as_found).slice(0, 8);
  for (const o of withUrl) {
    const q = o.metadata.mark_quarantine;
    const r = await writeField({
      subject_type: 'organization', subject_id: o.id, field: 'logo_url',
      value: q.logo_url_as_found,
      source: 'mirror_org_marks', source_url: o.website || null,
      observed_at: '2026-07-01', method: 'site_icon_mirror', trust: 'reported',
      actor: 'agent:replay', apply: false,
    });
    cases++;
    if (admits(r)) admitted++; else refused++;
    console.log(`   ${colour(r.severity)}${label(r)}${C.x} ${String(o.name).slice(0, 32).padEnd(34)} ${C.d}[${r.severity}] originally: ${q.reason}${C.x}`);
    console.log(`      ${C.d}${(r.reason || '').slice(0, 190)}${C.x}`);
  }

  // ── 2b. the 244-villa defect: one binary worn by N unrelated subjects ─────
  // The bytes are a real logo. The ATTRIBUTION is false. Nothing about the
  // image can catch this — only the peer set can, which is why it needs the
  // caller to supply peers. `mirror_org_marks.mjs --audit` already computes the
  // digests and preserved them in metadata.mark_quarantine.sha256, so this
  // replays against the real recorded hashes rather than re-fetching 244 files.
  console.log(`\n${C.b}  2b. one binary worn by N unrelated subjects (context.peers supplied)${C.x}`);
  const { data: shared } = await sb.from('organizations')
    .select('id,name,metadata').eq('metadata->mark_quarantine->>reason', 'shared_binary').limit(300);
  const byDigest = {};
  for (const o of shared || []) {
    const d = o.metadata?.mark_quarantine?.sha256;
    if (d) (byDigest[d] ??= []).push(o);
  }
  const biggest = Object.entries(byDigest).sort((a, b) => b[1].length - a[1].length)[0];
  if (biggest) {
    const [digest, members] = biggest;
    const victim = members[0];
    const peers = members.slice(1).map((o) => ({ id: o.id, name: o.name, __digest: digest }));
    const r = await writeField({
      subject_type: 'organization', subject_id: victim.id, field: 'logo_url',
      value: victim.metadata.mark_quarantine.logo_url_at_flag || `https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/org-assets/marks/${victim.id}.png`,
      source: 'mirror_org_marks', observed_at: '2026-07-01', method: 'site_icon_mirror',
      trust: 'reported', actor: 'agent:replay', apply: false,
      // digest supplied so the replay does not re-fetch the binary; a live
      // caller omits it and writeField hashes the incoming bytes itself.
      context: { peers, digest },
    });
    cases++; if (admits(r)) admitted++; else refused++;
    const sv = (r.evidence.checks || []).find((c) => c.check === 'shared_value');
    console.log(`   ${colour(r.severity)}${label(r)}${C.x} ${String(victim.name).slice(0, 32).padEnd(34)} ${C.d}[${r.severity}] ${sv ? `${sv.evidence.n} subjects share this binary` : 'no shared_value finding'}${C.x}`);
    console.log(`      ${C.d}${(r.reason || '').slice(0, 210)}${C.x}`);
    if (sv) console.log(`      ${C.d}peers: ${sv.evidence.subjects.slice(0, 6).join(' · ')}${C.x}`);
  }

  console.log(`\n${C.b}REPLAY 3 — the contract's own refusals${C.x}\n`);
  const org = (marks || [])[0];
  const probes = [
    ['no provenance (no source, no observed_at)', { subject_type: 'organization', subject_id: org.id, field: 'description', value: 'A lovely boutique.' }],
    ['no observed_at only', { subject_type: 'organization', subject_id: org.id, field: 'description', value: 'A lovely boutique.', source: 'site_sweep' }],
    ['placeholder string in an image column ("Logo Image")', { subject_type: 'organization', subject_id: org.id, field: 'logo_url', value: 'Logo Image', source: 'scrape', observed_at: '2026-07-01' }],
    // The WIMCO shape at the door: a number with no unit anywhere. organizations
    // has no priceUnitCols, so nothing can be derived and nothing may be assumed.
    ['money with no currency/period (the WIMCO shape)', { subject_type: 'organization', subject_id: org.id, field: 'asking_price', value: 4500, source: 's', observed_at: '2026-07-01' }],
    ['negative price', { subject_type: 'organization', subject_id: org.id, field: 'asking_price', value: -100, source: 's', observed_at: '2026-07-01', context: { currency: 'USD', period: 'sale' } }],
    ['a field no check applies to → unknown, not pass', { subject_type: 'organization', subject_id: org.id, field: 'description', value: 'A lovely boutique.', source: 'site_sweep', observed_at: '2026-07-01' }],
    ['unknown subject_type', { subject_type: 'villa', subject_id: org.id, field: 'x', value: 1, source: 's', observed_at: '2026-07-01' }],
    ['subject that does not exist', { subject_type: 'organization', subject_id: '00000000-0000-0000-0000-000000000000', field: 'description', value: 'x', source: 's', observed_at: '2026-07-01' }],
  ];
  for (const [lbl, args] of probes) {
    const r = await writeField({ ...args, apply: false });
    cases++;
    if (admits(r)) admitted++; else refused++;
    console.log(`   ${colour(r.severity)}${label(r)}${C.x} ${lbl}`);
    console.log(`      ${C.d}[${r.severity}] ${(r.reason || '').slice(0, 200)}${C.x}`);
  }

  console.log(`\n${C.b}REPLAY 4 — conflict / supersession on a real occupied column${C.x}\n`);
  // A WIMCO villa with a real, in-band nightly rate. The incoming value is also
  // in band — so the gate says pass and the ONLY thing standing between a
  // plausible number and a served column is the conflict rule. That is the case
  // worth demonstrating: silent overwrite is how a good value replaces a better
  // one with nobody ever knowing.
  const { data: occupied } = await sb.from('properties')
    .select('id,name,base_price,price_currency,price_period,source_url,metadata')
    .ilike('source_url', '%wimco%').not('base_price', 'is', null).limit(1);
  if (occupied?.[0]) {
    const o = occupied[0];
    const incoming = Math.round(o.base_price * 1.15);
    const args = { subject_type: 'property', subject_id: o.id, field: 'base_price', value: incoming, source: 'other_scrape', source_url: o.source_url, observed_at: '2026-07-01', actor: 'agent:replay', apply: false };
    const a = await writeField(args);
    console.log(`   ${colour(a.severity)}${label(a)}${C.x} ${String(o.name)}.base_price ${o.base_price} → ${incoming} ${o.price_currency}/${o.price_period}, no supersede`);
    console.log(`      ${C.d}[${a.severity}] ${(a.reason || '').slice(0, 210)}${C.x}`);
    const b = await writeField({ ...args, supersede: true });
    console.log(`   ${colour(b.severity)}${label(b)}${C.x} same write WITH supersede:true (still dry-run)`);
    console.log(`      ${C.d}[${b.severity}] ${(b.reason || '').slice(0, 210)}${C.x}`);
    if (b.evidence.supersession) console.log(`      ${C.d}restore path preserved: ${b.evidence.supersession.record.restore}${C.x}`);
    cases += 2; if (admits(a)) admitted++; else refused++; if (admits(b)) admitted++; else refused++;
  }

  console.log(`\n${C.b}${cases} cases · ${refused} held at the door · ${admitted} admitted${C.x}`);
  console.log(`${C.d}Nothing was written, nulled or deleted by this selftest (every call dry-run).${C.x}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = argv();
  const cmd = a._[0];
  if (cmd === 'selftest') { await selftest(); }
  else if (cmd === 'set') {
    const [, subject_type, subject_id, field, raw] = a._;
    if (!field) { console.error('usage: write.mjs set <subject_type> <subject_id> <field> <value> --source=X --observed-at=YYYY-MM-DD [--apply] [--supersede]'); process.exit(1); }
    const value = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
    const r = await writeField({
      subject_type, subject_id, field, value,
      source: a.source ?? null, source_url: a.source_url ?? null,
      observed_at: a.observed_at ?? null, method: a.method ?? null, trust: a.trust ?? null,
      actor: a.actor ?? 'cli', supersede: !!a.supersede, apply: !!a.apply,
    });
    console.log(JSON.stringify(r, null, 2));
  } else if (cmd === 'plan') {
    // ── THE NON-JS DOOR ─────────────────────────────────────────────────────
    // Reads a JSON array of writeField items on stdin, emits a JSON array of
    // decisions on stdout. This exists so a Python ingest reaches the SAME gate
    // — same validate.mjs, same bands.json, same cohort pass — instead of a
    // second implementation that would drift the first time either is edited.
    // Batch, not per-item, because cohort displacement is only reachable over a
    // batch, and the cohort pass is what turned 5/9 into 9/9 on the Elan leg.
    // Dry-run unless --apply. Exit 3 when anything was held, so a caller that
    // ignores stdout still fails loudly rather than proceeding.
    const stdin = await new Promise((res, rej) => {
      let s = ''; process.stdin.setEncoding('utf8');
      process.stdin.on('data', (d) => { s += d; });
      process.stdin.on('end', () => res(s));
      process.stdin.on('error', rej);
    });
    let items;
    try { items = JSON.parse(stdin || '[]'); } catch (e) {
      console.log(JSON.stringify({ error: `stdin is not JSON: ${e.message}`, decisions: [] }));
      process.exit(2);
    }
    if (!Array.isArray(items)) {
      console.log(JSON.stringify({ error: 'stdin must be a JSON array of write items', decisions: [] }));
      process.exit(2);
    }
    const rs = await writeFields(items, { apply: !!a.apply });
    const decisions = rs.map((r, i) => ({
      index: i,
      subject_type: items[i].subject_type ?? null,
      subject_id: items[i].subject_id ?? null,
      field: items[i].field ?? null,
      value: items[i].value ?? null,
      name: items[i].__name ?? null,
      admitted: admits(r),
      action: r.action,
      severity: r.severity,
      reason: r.reason,
      observation_id: r.observation_id ?? null,
      checks: (r.evidence?.checks || []).map((c) => ({ check: c.check, severity: c.severity, code: c.code ?? null })),
      units: r.evidence?.units ?? null,
      cohort: r.evidence?.cohort ?? null,
    }));
    const held = decisions.filter((d) => !d.admitted).length;
    console.log(JSON.stringify({
      apply: !!a.apply, n: decisions.length, admitted: decisions.length - held, held, decisions,
    }));
    // exitCode, not process.exit(): exit() kills the process before stdout drains,
    // truncating envelopes >64KB (pipe buffer) — every large-batch caller then
    // crashes parsing half a JSON line. Nothing runs after this branch, so letting
    // the loop drain is safe. Measured: 166-item batch = 131KB envelope, truncated
    // at 65,362 bytes before this fix; parses whole after.
    process.exitCode = held ? 3 : 0;
  } else {
    console.log('commands: selftest | set <subject_type> <subject_id> <field> <value> [--source=] [--observed-at=] [--apply] [--supersede] | plan  (JSON array on stdin -> JSON decisions on stdout, exit 3 if any held)');
  }
}
