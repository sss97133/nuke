import { classificationFromReader } from "./classifierProvider.ts";
import type { PipelineReceipt, PipelineSource } from "./persistence.ts";

export const CLASSIFICATION_METHOD = "supplied_image_classification_v1";
export const CLASSIFICATION_SELECT = "id,image_url,vehicle_id,updated_at,is_superseded,is_duplicate,ai_scan_metadata";
type Row = Record<string, any>;
const object = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Row, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
const uuid = (v: unknown) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const text = (v: unknown, max = 200) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const instant = (v: unknown) => typeof v === "string" && /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const https = (v: unknown) => { try { return typeof v === "string" && v.length <= 4000 && new URL(v).protocol === "https:"; } catch { return false; } };
function canonical(v: any): any { return Array.isArray(v) ? v.map(canonical) : object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v; }
export class SuppliedClassificationError extends Error { constructor(public code: string, public status = 400) { super(code); } }
function requireValue(ok: unknown, code: string, status = 400): asserts ok { if (!ok) throw new SuppliedClassificationError(code, status); }

interface Dependencies {
  authorize(): Promise<boolean>;
  readImage(id: string): Promise<Row | null>;
  ingest(observation: Row): Promise<Row>;
  persist(id: string, receipt: PipelineReceipt, state: Row, metadata: Row, source: PipelineSource): Promise<void>;
}

/** Extend the existing supplied-reader entry with a bounded coarse-only mode.
 * History is source testimony, not a new accepted fact or identity vote. */
export async function recordSuppliedClassification(input: Row, deps: Dependencies, receipt: PipelineReceipt) {
  requireValue(await deps.authorize(), "classification_requires_service_role", 403);
  requireValue(object(input) && keys(input, ["processing_mode", "image_id", "image_url", "vehicle_id", "classification_raw", "reader", "source", "provenance"]) && input.processing_mode === "classification_only" && uuid(input.image_id) &&
    (input.vehicle_id === null || uuid(input.vehicle_id)) && object(input.classification_raw) && text(input.reader, 80), "invalid_supplied_classification");
  const s = input.source, p = input.provenance, raw = input.classification_raw;
  requireValue(object(s) && keys(s, ["image_url", "expected_updated_at", "reviewed_url", "reviewed_sha256", "reviewed_at"]) && https(s.image_url) && input.image_url === s.image_url && https(s.reviewed_url) &&
    instant(s.expected_updated_at) && instant(s.reviewed_at) && Date.parse(s.reviewed_at) <= Date.now() + 300000 &&
    /^[a-f0-9]{64}$/.test(s.reviewed_sha256), "invalid_classification_source");
  requireValue(object(p) && keys(p, ["agent_model", "agent_tier", "extraction_method", "run_id"]) && text(p.agent_model) && text(p.agent_tier) && text(p.extraction_method) && text(p.run_id), "invalid_classification_provenance");
  requireValue(JSON.stringify(input).length <= 128 * 1024, "classification_too_large");
  // The completed cache invokes existing SQL landing. Coarse mode must carry
  // no generic spec/identity/financial payload into that independent owner.
  requireValue((raw.vehicle_fields === undefined || Array.isArray(raw.vehicle_fields) && raw.vehicle_fields.length === 0) &&
    raw.vin == null && raw.vin_detected == null && raw.document == null, "classification_only_contains_facts");
  const classification = await classificationFromReader(structuredClone(raw), input.reader);
  requireValue(classification.classifier_ok === true, "classifier_response_invalid");
  requireValue(!classification.v2?.vehicle_fields.length && !classification.v2?.vin && !classification.vin_detected, "classification_only_contains_facts");
  const material = canonical({ image_id: input.image_id, vehicle_id: input.vehicle_id, classification_raw: raw,
    source: { ...s, expected_updated_at: undefined }, reader: input.reader, provenance: p });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(material)));
  const hash = [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, "0")).join("");
  const identifier = `${CLASSIFICATION_METHOD}:${input.image_id}:${hash}`;
  const image = await deps.readImage(input.image_id);
  requireValue(image && image.image_url === s.image_url && image.vehicle_id === input.vehicle_id && !image.is_superseded && !image.is_duplicate, "classification_source_changed", 409);
  const old = image.ai_scan_metadata ?? {}, prior = old.classification_review;
  if (prior?.source_identifier === identifier && uuid(prior.observation_id) &&
    JSON.stringify(canonical(old.classification)) === JSON.stringify(canonical(classification))) {
    return { success: true, image_id: image.id, observation_id: prior.observation_id, duplicate: true, updated_at: image.updated_at, model_calls: 0 };
  }
  requireValue(image.updated_at === s.expected_updated_at, "classification_source_changed", 409);
  // Deliberately source-only: an unprojected attempt cannot become a current
  // vehicle claim if another writer moves/replaces the image before CAS. The
  // retained image reference is not a fabricated same-car witness.
  const observation = await deps.ingest({ source_slug: "photo_pipeline", kind: "media", vehicle_id: null,
    source_url: s.image_url, raw_source_ref: `vehicle_images:${image.id}`, source_identifier: identifier, observed_at: s.reviewed_at,
    content_text: classification.description, agent_inferred: true, defer_analysis: true,
    agent_model: p.agent_model, agent_tier: p.agent_tier, extraction_method: CLASSIFICATION_METHOD,
    structured_data: { source_image_id: image.id, source_vehicle_id: image.vehicle_id, classification,
      classification_raw: raw, previous_classification: old.classification ?? null,
      previous_observation_id: prior?.observation_id ?? old.photo_pipeline?.receipt?.observation_id ?? null,
      previous_pipeline_receipt: old.photo_pipeline?.receipt ?? null },
    extraction_metadata: { source: s, reader: input.reader, reviewer_provenance: p,
      status: "supplied_reading_requires_current_projection", supersedes_cache_version: image.updated_at } });
  requireValue(observation?.success === true && uuid(observation.observation_id), "classification_history_not_persisted", 502);
  const classificationReview = { observation_id: observation.observation_id, source_identifier: identifier, ...s };
  await deps.persist(image.id, { ...receipt, classifier_model: classification.classifier_receipt?.model,
    classifier_attempts: 1, observation_id: observation.observation_id, observation_status: observation.duplicate ? "existing" : "created" },
    { ai_processing_status: "completed", ai_processing_completed_at: new Date().toISOString() },
    { classification, classification_review: classificationReview, classifier_failed: false, pipeline_version: "v2" },
    { image_url: s.image_url, vehicle_id: image.vehicle_id, expected_updated_at: image.updated_at });
  const current = await deps.readImage(image.id);
  requireValue(current && current.image_url === s.image_url && current.vehicle_id === image.vehicle_id &&
    current.ai_scan_metadata?.classification_review?.observation_id === observation.observation_id, "classification_source_changed", 409);
  return { success: true, image_id: image.id, observation_id: observation.observation_id,
    classification: classification.image_type, updated_at: current.updated_at, model_calls: 0 };
}
