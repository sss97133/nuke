// Signed derivation evidence: maps every garage producer conclusion to a row of public.garage_derivation_evidence
// (migration 20261111210000) and writes it through PostgREST as the conclusion is made.
//
//   const sink = createSink({ script: PRODUCER, args });          // writes when SUPABASE_SERVICE_ROLE_KEY is set and --no-db is absent
//   await sink.write(fromPlaceMatch(row, sink.ctx));              // never throws: a failed write is counted, the local scratch row stays
//   process.exitCode = sink.finish() ? 0 : 1;
//
// Local JSONL files stay as optional scratch/resume files; the database row is the record. Rows are idempotent on dedupe_key
// (insert ... on conflict do nothing), so re-running a producer or the importer never duplicates a conclusion.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const PRODUCER_AGENT = 'injestion';
export const KINDS = ['scene_label', 'place_match', 'place_exemplar', 'sign_read', 'duplicate_judgment', 'seller_history_match', 'relationship_role'];
const PROJECT_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const BATCH = 200;

export const sha256 = (t) => createHash('sha256').update(t).digest('hex');

// JSON with sorted keys, so equal content hashes equal.
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

let gitShaCache;
export function gitSha() {
  if (process.env.GARAGE_PRODUCER_SHA) return process.env.GARAGE_PRODUCER_SHA;
  if (gitShaCache === undefined) {
    try { gitShaCache = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { gitShaCache = 'unknown'; }
  }
  return gitShaCache;
}
export const producerVersion = (script) => `${gitSha()}:${script}`;

const toUuid = (v) => (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v.toLowerCase() : null);
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// Build a table row. `payload` is what the conclusion says (hashed); the dedupe key adds the subject identity and the run.
export function evidenceRow(kind, f, ctx = {}) {
  if (!KINDS.includes(kind)) throw new Error(`unknown kind ${kind}`);
  if (!toUuid(f.run_id)) throw new Error(`${kind}: run_id must be a uuid`);
  const base = {
    kind, vehicle_id: toUuid(f.vehicle_id), other_vehicle_id: toUuid(f.other_vehicle_id), user_id: toUuid(f.user_id),
    organization_id: toUuid(f.organization_id), session_key: f.session_key ?? null, subject_key: f.subject_key ?? null,
    image_ids: (f.image_ids ?? []).filter((i) => toUuid(i)), conclusion: String(f.conclusion), conclusion_detail: f.conclusion_detail ?? {},
    confidence: num(f.confidence), rationale: f.rationale ?? null, evidence: f.evidence ?? {},
    producer_agent: ctx.agent ?? PRODUCER_AGENT, producer_script: f.script, producer_version: ctx.version ?? producerVersion(f.script),
    model: f.model ?? null, viewer: f.viewer ?? null, run_id: f.run_id.toLowerCase(), source_run_id: toUuid(f.source_run_id),
    observed_at: f.observed_at ?? null,
  };
  const payload = { kind, conclusion: base.conclusion, conclusion_detail: base.conclusion_detail, confidence: base.confidence, rationale: base.rationale, evidence: base.evidence,
    model: base.model, viewer: base.viewer, vehicle_id: base.vehicle_id, other_vehicle_id: base.other_vehicle_id, user_id: base.user_id, organization_id: base.organization_id,
    session_key: base.session_key, subject_key: base.subject_key };
  const content_hash = sha256(canonical(payload));
  const dedupe_key = sha256(canonical({ kind, run: base.run_id, v: base.vehicle_id, o: base.other_vehicle_id, u: base.user_id, org: base.organization_id,
    s: base.session_key, k: base.subject_key, viewer: base.viewer, content_hash }));
  // Import provenance is stored with the row but not hashed: the same conclusion found in two scratch files is one row.
  const stored = ctx.importedFrom ? { ...base, evidence: { ...base.evidence, imported_from: ctx.importedFrom } } : base;
  return { ...stored, content_hash, dedupe_key };
}

// ---- mappers: one per producer row shape (the rows the scripts already emit) ---------------------------------------------

export const fromSceneLabel = (r, ctx) => evidenceRow('scene_label', {
  script: r.producer ?? 'scripts/garage/label-scenes.mjs', run_id: r.run_id, vehicle_id: r.vehicle_id, session_key: r.session_key, image_ids: r.image_ids,
  conclusion: r.scene_label, confidence: r.confidence, rationale: r.rationale, model: r.model, viewer: r.viewer ?? 1, observed_at: r.created_at,
  evidence: { photo_count: r.photo_count ?? null },
}, ctx);

export const fromPlaceMatch = (r, ctx) => evidenceRow('place_match', {
  script: r.producer ?? 'scripts/garage/match-places.mjs', run_id: r.run_id, vehicle_id: r.vehicle_id, session_key: r.session_key, image_ids: r.image_ids,
  organization_id: r.org_id, conclusion: r.org_id ?? 'neither', confidence: r.confidence, rationale: r.rationale, model: r.model, viewer: r.viewer ?? 1, observed_at: r.created_at,
  evidence: { cues: r.cues ?? [], sign_text: r.sign_text ?? null, candidate_org_ids: r.candidate_org_ids ?? [], photo_count: r.photo_count ?? null },
}, ctx);

// An exemplar: a reference photo for a place. `placeRow` = { org_id, org_name, org_kind }, `ex` = { url, source, cite }.
export const fromPlaceExemplar = (placeRow, ex, { runId, script = 'scripts/garage/build-place-exemplars.mjs', observedAt = null } = {}, ctx) => evidenceRow('place_exemplar', {
  script, run_id: runId, vehicle_id: ex.cite?.vehicle_id, session_key: ex.cite?.session_key ?? null, organization_id: placeRow.org_id, subject_key: ex.url,
  conclusion: ex.source, confidence: ex.cite?.confidence, model: ex.cite?.model ?? null, observed_at: observedAt, source_run_id: ex.cite?.run_id ?? ex.cite?.source_run_id ?? null,
  evidence: { org_name: placeRow.org_name ?? null, org_kind: placeRow.org_kind ?? null, cite: ex.cite ?? {} },
}, ctx);

export const fromSignRead = (r, ctx) => evidenceRow('sign_read', {
  script: r.producer ?? 'scripts/garage/mine-sign-evidence.mjs', run_id: r.run_id, source_run_id: r.source_run_id, vehicle_id: r.vehicle_id, session_key: r.session_key,
  organization_id: r.org_id, conclusion: r.org_id, rationale: r.quote, viewer: r.source_viewer ?? null, observed_at: r.created_at ?? null,
  evidence: { quote: r.quote, source_run_id: r.source_run_id ?? null, source_viewer: r.source_viewer ?? null },
}, ctx);

export const fromDuplicateJudgment = (r, ctx) => evidenceRow('duplicate_judgment', {
  script: r.producer ?? 'scripts/garage/compare-duplicates.mjs', run_id: r.run_id, vehicle_id: r.a_id, other_vehicle_id: r.b_id,
  conclusion: r.verdict ?? String(r.same_vehicle), confidence: r.confidence, rationale: r.rationale, model: r.model, observed_at: r.created_at,
  evidence: { contradictions: r.contradictions ?? [], fields: r.fields ?? {}, ...(r.cite ? { cite: r.cite } : {}) },
}, ctx);

// A BaT member-history card. `vehicleId` is a resolved vehicle or null (an unresolved match is retained, not guessed).
export const fromSellerHistory = (h, { runId, vehicleId = null, organizationId = null, script = 'scripts/garage/ingest-bat-seller-history.mjs', matchedBy = null, observedAt = null } = {}, ctx) => evidenceRow('seller_history_match', {
  script, run_id: runId, vehicle_id: vehicleId, organization_id: organizationId, subject_key: h.url, observed_at: observedAt,
  conclusion: vehicleId ? 'vehicle_matched' : 'listing_unmatched',
  evidence: { handle: h.handle ?? null, bat_user_id: h.bat_user_id ?? null, title: h.title ?? null, lot_number: h.lot_number ?? null, vin: h.vin ?? null,
    seller_username: h.seller_username ?? null, end_date: h.end_date ?? null, result: h.result ?? null, matched_by: matchedBy, fetched_with: h.fetched_with ?? null },
}, ctx);

// A relationship-role proposal (replay / preview row: vehicle_id, derived_role, confidence, reason, evidence chain).
export const fromRelationshipRole = (r, { runId, userId = null, script = 'scripts/garage/replay-relationship-derivations.mjs', observedAt = null, mode = null } = {}, ctx) => evidenceRow('relationship_role', {
  script, run_id: runId, vehicle_id: r.vehicle_id, user_id: userId, conclusion: r.derived_role, confidence: r.confidence, rationale: r.reason, observed_at: observedAt,
  evidence: { old_role: r.old_role ?? null, evidence_ids: r.evidence_ids ?? [], title_verification_id: r.title_verification_id ?? null,
    documented_from: r.documented_from ?? null, documented_to: r.documented_to ?? null, mode, derivation: r.evidence ?? {} },
}, ctx);

// ---- sink ------------------------------------------------------------------------------------------------------------------

// Idempotent insert of rows. `fetchFn` is injectable for tests.
export async function insertRows(rows, { url, key, fetchFn = fetch }) {
  if (!rows.length) return { ok: true, sent: 0 };
  const res = await fetchFn(`${url}/rest/v1/garage_derivation_evidence?on_conflict=dedupe_key`, { method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(rows), signal: AbortSignal.timeout(60000) });
  if (!res.ok) return { ok: false, sent: 0, error: `${res.status} ${(await res.text()).slice(0, 300)}` };
  return { ok: true, sent: rows.length };
}

// Writes to the database when a service-role key is present and --no-db is absent; otherwise reports once and does nothing.
export function createSink({ script, args = process.argv.slice(2), env = process.env, fetchFn = fetch, log = (m) => console.error(m) } = {}) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const enabled = !args.includes('--no-db') && Boolean(key);
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? PROJECT_URL;
  const stats = { written: 0, failed: 0, errors: [] };
  if (!enabled) log(args.includes('--no-db') ? 'derivation evidence: --no-db, conclusions stay in local scratch only' : 'derivation evidence: no SUPABASE_SERVICE_ROLE_KEY, conclusions stay in local scratch only');
  return {
    enabled, stats, ctx: { version: producerVersion(script) },
    async write(rowOrRows) {
      const rows = (Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]).filter(Boolean);
      if (!enabled || !rows.length) return { ok: true, sent: 0 };
      try {
        const r = await insertRows(rows, { url, key, fetchFn });
        if (r.ok) stats.written += r.sent; else { stats.failed += rows.length; stats.errors.push(r.error); log(`derivation evidence write failed: ${r.error}`); }
        return r;
      } catch (e) { stats.failed += rows.length; stats.errors.push(e.message); log(`derivation evidence write failed: ${e.message}`); return { ok: false, error: e.message }; }
    },
    // true when nothing failed
    finish() { if (enabled) log(`derivation evidence: ${stats.written} rows sent, ${stats.failed} failed`); return stats.failed === 0; },
  };
}
export { BATCH };
