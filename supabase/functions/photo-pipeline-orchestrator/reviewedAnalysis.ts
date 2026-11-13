import { validateVerdict } from "../_shared/byokImageVerdict.mjs";

export const REVIEW_METHOD = "reviewed_image_analysis_v1";
export const REVIEW_SELECT = "id,vehicle_id,image_url,updated_at,is_sensitive,is_superseded,is_duplicate,is_document,doc_flag,vision_gate_status,image_vehicle_match_status,ai_scan_metadata";
type ObjectValue = Record<string, any>;
const object = (v: unknown): v is ObjectValue => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const text = (v: unknown, max = 200): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const optionalText = (v: unknown, max = 200) => v === undefined || v === null || text(v, max);
const probability = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const instant = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const https = (v: unknown): v is string => { try { return typeof v === "string" && new URL(v).protocol === "https:" && v.length <= 4000; } catch { return false; } };
const keys = (v: ObjectValue, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
const VERDICT_KEYS = ["image_id", "vehicle_id", "scene_type", "build_phase_guess", "intent", "intent_confidence", "components_seen", "state_observations", "workshop_signals", "presence", "camera_pose", "narrative_one_line", "confidence", "damage_localized", "text_regions", "needs_review", "needs_clarification", "context_complete", "open_questions", "agent_notes"];

export class ReviewedAnalysisError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
function assert(ok: unknown, code: string, status = 400): asserts ok { if (!ok) throw new ReviewedAnalysisError(code, status); }

/** The existing BYOK schema, with bounded JSON and explicit source/provenance.
 * No camera estimates, confidence, labor intent or components are filled in here. */
export function validateReviewedAnalysis(input: unknown, now = Date.now()): ObjectValue {
  assert(object(input) && keys(input, ["action", "verdict", "source", "provenance"]), "invalid_review_envelope");
  assert(input.action === "record_reviewed_analysis" && object(input.verdict) && object(input.source) && object(input.provenance), "invalid_review_envelope");
  assert(JSON.stringify(input).length <= 128 * 1024, "review_too_large");
  const v = input.verdict, s = input.source, p = input.provenance;
  assert(keys(v, VERDICT_KEYS) && uuid(v.image_id) && uuid(v.vehicle_id), "invalid_review_identity");
  assert(validateVerdict(v).length === 0, "invalid_review_verdict");
  assert(text(v.narrative_one_line, 4000) && probability(v.confidence) && probability(v.intent_confidence), "invalid_review_verdict");
  assert(object(v.state_observations) && keys(v.state_observations, ["rust_severity", "paint_state", "completeness", "damage_callouts"]) &&
    ["none", "surface", "pitting", "perforation", "unknown"].includes(v.state_observations.rust_severity) &&
    ["bare_metal", "primer", "sealer", "base", "clear", "aged", "unknown"].includes(v.state_observations.paint_state) &&
    ["stripped", "partial", "assembled", "unknown"].includes(v.state_observations.completeness), "invalid_review_state");
  assert(object(v.presence) && keys(v.presence, ["person", "dog", "place_hint"]) && typeof v.presence.person === "boolean" &&
    (v.presence.dog === undefined || typeof v.presence.dog === "boolean") && optionalText(v.presence.place_hint, 1000), "invalid_review_presence");
  assert(object(v.workshop_signals) && keys(v.workshop_signals, ["tools_visible", "fixturing", "weld_quality", "lighting"]) &&
    Array.isArray(v.workshop_signals.tools_visible) && text(v.workshop_signals.fixturing) && text(v.workshop_signals.lighting) &&
    optionalText(v.workshop_signals.weld_quality), "invalid_review_workshop");
  assert(object(v.camera_pose) && keys(v.camera_pose, ["method", "framing", "azimuth_deg", "elevation_deg", "distance_est", "exif_present"]), "invalid_review_camera");
  assert(optionalText(v.camera_pose.method) && optionalText(v.camera_pose.framing, 1000) &&
    (v.camera_pose.exif_present === undefined || v.camera_pose.exif_present === null || typeof v.camera_pose.exif_present === "boolean"), "invalid_review_camera");
  for (const [field, lo, hi] of [["azimuth_deg", 0, 360], ["elevation_deg", -90, 90]] as const) {
    const n = v.camera_pose[field];
    assert(n === undefined || n === null || typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi, "invalid_review_camera");
  }
  const distance = v.camera_pose.distance_est;
  assert(distance === undefined || distance === null || distance === "unknown" || typeof distance === "string" && /^~?\s*\d+(?:\.\d+)?\s*m$/.test(distance), "invalid_review_camera");
  for (const [field, allowed] of [["components_seen", ["label", "confidence", "bbox", "part_number_guess"]], ["text_regions", ["text", "bbox", "confidence"]], ["damage_localized", ["label", "bbox", "severity"]]] as const) {
    const rows = v[field] ?? [];
    assert(Array.isArray(rows) && rows.length <= 100, "invalid_review_regions");
    for (const r of rows) {
      assert(object(r) && keys(r, [...allowed]) && r.bbox[0] < r.bbox[2] && r.bbox[1] < r.bbox[3], "invalid_review_regions");
      assert(text(r[field === "text_regions" ? "text" : "label"], 2000), "invalid_review_regions");
      if (r.confidence !== undefined) assert(probability(r.confidence), "invalid_review_regions");
      if (r.part_number_guess !== undefined && r.part_number_guess !== null) assert(text(r.part_number_guess), "invalid_review_regions");
      if (field === "damage_localized") assert(optionalText(r.severity), "invalid_review_regions");
    }
  }
  for (const field of ["needs_review", "needs_clarification", "context_complete"]) assert(v[field] === undefined || typeof v[field] === "boolean", "invalid_review_flags");
  assert(optionalText(v.agent_notes, 4000), "invalid_review_notes");
  for (const rows of [v.open_questions ?? [], v.state_observations.damage_callouts ?? [], v.workshop_signals.tools_visible])
    assert(Array.isArray(rows) && rows.length <= 100 && rows.every(x => text(x, 2000)), "invalid_review_lists");
  assert(keys(s, ["image_url", "expected_updated_at", "reviewed_url", "reviewed_sha256", "reviewed_at"]) && https(s.image_url) && https(s.reviewed_url) &&
    /^[0-9a-f]{64}$/.test(s.reviewed_sha256) && instant(s.expected_updated_at) && instant(s.reviewed_at) && Date.parse(s.reviewed_at) <= now + 300000, "invalid_review_source");
  assert(keys(p, ["agent_model", "agent_tier", "extraction_method", "run_id", "agent_duration_ms", "agent_cost_cents", "cost_basis"]) &&
    text(p.agent_model) && text(p.agent_tier) && text(p.extraction_method) && text(p.run_id) && optionalText(p.cost_basis, 1000), "invalid_review_provenance");
  for (const k of ["agent_duration_ms", "agent_cost_cents"]) assert(p[k] === undefined || p[k] === null || typeof p[k] === "number" && Number.isFinite(p[k]) && p[k] >= 0, "invalid_review_provenance");
  return input;
}

function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function sameInstant(a: string, b: string): boolean {
  const micros = (x: string) => BigInt(Date.parse(x)) * 1000n + BigInt((x.match(/\.(\d{1,6})/)?.[1] ?? "").padEnd(6, "0").slice(3));
  return instant(a) && instant(b) && micros(a) === micros(b);
}

export interface ReviewedAnalysisDeps {
  authorize(): Promise<boolean>;
  readImage(id: string): Promise<ObjectValue | null>;
  ingest(observation: ObjectValue): Promise<ObjectValue>;
  project(observationId: string): Promise<ObjectValue>;
  now?: () => number;
}

/** Only these three persistence operations are reachable: exact-image read,
 * deferred observation intake, and its transactional projection/recompute. */
export async function recordReviewedAnalysis(input: unknown, deps: ReviewedAnalysisDeps): Promise<ObjectValue> {
  assert(await deps.authorize(), "review_requires_service_role", 403);
  const packet = validateReviewedAnalysis(input, deps.now?.());
  const { verdict: v, source: s, provenance: p } = packet;
  // The CAS token is custody, not a material visual result. Same review replay
  // retains its identity after our own projection changed updated_at.
  const material = { verdict: v, source: { ...s, expected_updated_at: undefined }, provenance: p };
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(material)));
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
  const identifier = `${REVIEW_METHOD}:${v.image_id}:${hash}`;
  const image = await deps.readImage(v.image_id);
  assert(image && image.vehicle_id === v.vehicle_id && image.image_url === s.image_url, "review_source_changed", 409);
  assert(!image.is_sensitive && !image.is_superseded && !image.is_duplicate && !image.is_document && !image.doc_flag &&
    [null, "approved"].includes(image.vision_gate_status ?? null) && !["mismatch", "unrelated"].includes(image.image_vehicle_match_status), "review_source_withdrawn", 409);
  assert(sameInstant(image.updated_at, s.expected_updated_at) || image.ai_scan_metadata?.byok_deep_analysis?.source_identifier === identifier, "review_source_changed", 409);
  const observation = {
    source_slug: "photo_pipeline", kind: "condition", vehicle_id: v.vehicle_id,
    source_url: s.image_url, source_identifier: identifier, observed_at: s.reviewed_at,
    content_text: v.narrative_one_line, agent_inferred: true, defer_analysis: true,
    confidence_score: v.confidence, agent_model: p.agent_model, agent_tier: p.agent_tier,
    // extractor_id is a nullable UUID registry reference, not a producer label.
    // This supplied review has no registered extractor; retain its method and
    // reviewer provenance without inventing that identity.
    extraction_method: REVIEW_METHOD,
    ...(p.agent_duration_ms != null ? { agent_duration_ms: p.agent_duration_ms } : {}),
    ...(p.agent_cost_cents != null ? { agent_cost_cents: p.agent_cost_cents } : {}),
    raw_source_ref: `vehicle_images:${v.image_id}`,
    observer_raw: { image_id: v.image_id, review_hash: hash },
    structured_data: { ...v, analysis_kind: "image_deep_byok", witness_image_id: v.image_id, is_inferred: true },
    extraction_metadata: { reviewed_image: s, reviewer_provenance: p, review_hash: hash },
  };
  const landed = await deps.ingest(observation);
  assert(landed?.success === true && uuid(landed.observation_id), "review_observation_not_persisted", 502);
  const projection = await deps.project(landed.observation_id);
  assert(projection?.success === true && projection.observation_id === landed.observation_id && projection.image_id === v.image_id && projection.vehicle_id === v.vehicle_id
    && uuid(projection.image_observation_id),
    "review_projection_not_persisted", 409);
  return { ...projection, model_calls: 0, observation_duplicate: landed.duplicate === true };
}
