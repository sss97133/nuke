import { observationContentHash } from "../_shared/observationContentHash.ts";
import { IMAGE_PROPERTY_VALUES, isSupportedImagePropertyKey } from "../ingest-observation/imageProperties.ts";

export const CACHED_PROPERTY_MODE = "cached_image_property_projection_v1";
export const MAX_CACHED_CLAIMS = 3000;
export const MAX_BATCH_BYTES = 8 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const object = (x: unknown): x is Record<string, any> => !!x && typeof x === "object" && !Array.isArray(x);
const time = (x: unknown) => typeof x === "string" && Number.isFinite(Date.parse(x));
const TOP_KEYS = new Set(["source_slug", "kind", "vehicle_id", "property_key", "agent_inferred", "defer_analysis",
  "observed_at", "source_identifier", "raw_source_ref", "agent_model", "agent_tier", "extraction_method",
  "agent_cost_cents", "structured_data", "source_result_json"]);

export class BatchAdmissionError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}

/** The size ceiling applies while streaming, including absent/false Content-Length. */
export async function readBatchBody(req: Request): Promise<Record<string, any>> {
  if (Number(req.headers.get("content-length")) > MAX_BATCH_BYTES) throw new BatchAdmissionError("batch_too_large", 413);
  if (!req.body) throw new BatchAdmissionError("batch_body_required");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BATCH_BYTES) { await reader.cancel(); throw new BatchAdmissionError("batch_too_large", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let parsed;
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new BatchAdmissionError("invalid_batch_json"); }
  if (!object(parsed)) throw new BatchAdmissionError("invalid_batch_object");
  return parsed;
}

/** SQL rechecks every parent, image, property and clock inside the write transaction. */
export async function prepareCachedClaims(observations: unknown) {
  if (!Array.isArray(observations) || observations.length < 1 || observations.length > MAX_CACHED_CLAIMS) {
    throw new BatchAdmissionError("cached_claim_count_invalid");
  }
  const identities = new Set<string>();
  for (const claim of observations) {
    const d = claim?.structured_data;
    if (!object(claim) || Object.keys(claim).some(k => !TOP_KEYS.has(k)) ||
        claim.source_slug !== "photo_pipeline" || claim.kind !== "condition" ||
        claim.agent_inferred !== true || claim.defer_analysis !== true || claim.agent_cost_cents !== 0 ||
        !UUID.test(claim.vehicle_id ?? "") || !isSupportedImagePropertyKey(claim.property_key) ||
        !time(claim.observed_at) || !object(d) || !UUID.test(d.image_id ?? "") ||
        !UUID.test(d.source_observation_id ?? "") || !HASH.test(d.source_result_hash ?? "") ||
        d.analysis_kind !== "image_property_projection" || d.projection_version !== "byok_image_properties_v1" ||
        d.property_key !== claim.property_key || d.claim_role !== "inferred" ||
        !time(d.source_recorded_at) || d.source_recorded_at !== claim.observed_at ||
        d.capture_at !== null || d.analyzed_at !== null ||
        d.observed_at_basis !== "source_testimony_recorded_at" ||
        !Number.isFinite(d.source_model_confidence) || d.source_model_confidence < 0.6 || d.source_model_confidence > 1 ||
        typeof claim.agent_model !== "string" || !claim.agent_model.trim() ||
        claim.extraction_method !== "cached_byok_property_projection_v1" ||
        claim.raw_source_ref !== `vehicle_observations:${d.source_observation_id}` ||
        claim.source_identifier !== `byok_image_properties_v1:${d.source_observation_id}:${d.source_result_hash}:${claim.property_key}` ||
        !(IMAGE_PROPERTY_VALUES[claim.property_key] as readonly unknown[]).includes(d[claim.property_key])) {
      throw new BatchAdmissionError("cached_claim_invalid");
    }
    if (typeof claim.source_result_json !== "string" || !claim.source_result_json ||
        new TextEncoder().encode(claim.source_result_json).byteLength > 16384) {
      throw new BatchAdmissionError("cached_source_proof_invalid");
    }
    let source;
    try { source = JSON.parse(claim.source_result_json); } catch { throw new BatchAdmissionError("cached_source_proof_invalid"); }
    const sourceKeys = ["observation_id", "image_id", "vehicle_id", "model", "method", "recorded_at", "state_observations"];
    const scalarKeys = ["rust_severity", "paint_state", "completeness"];
    const scalarKey = claim.property_key === "image_visible_rust_severity" ? "rust_severity"
      : claim.property_key === "image_visible_paint_stage" ? "paint_state" : "completeness";
    if (!object(source) || Object.keys(source).length !== sourceKeys.length || Object.keys(source).some(k => !sourceKeys.includes(k)) ||
        source.observation_id !== d.source_observation_id || source.image_id !== d.image_id || source.vehicle_id !== claim.vehicle_id ||
        source.model !== claim.agent_model || source.method !== d.source_extraction_method || source.recorded_at !== d.source_recorded_at ||
        !object(source.state_observations) || Object.keys(source.state_observations).length !== scalarKeys.length ||
        Object.keys(source.state_observations).some(k => !scalarKeys.includes(k)) || source.state_observations[scalarKey] !== d[claim.property_key]) {
      throw new BatchAdmissionError("cached_source_proof_invalid");
    }
    if (identities.has(claim.source_identifier)) throw new BatchAdmissionError("duplicate_batch_identity");
    identities.add(claim.source_identifier);
  }
  // No property/source DB lookups per item: the transaction resolves registries once.
  return await Promise.all(observations.map(async claim => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(claim.source_result_json));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    if (hash !== claim.structured_data.source_result_hash) throw new BatchAdmissionError("cached_source_proof_hash_mismatch");
    return { ...claim, content_hash: await observationContentHash(claim) };
  }));
}

/** A 200/SQL return alone cannot declare the batch persisted. */
export function validateCachedReceipt(data: unknown, claims: Record<string, any>[]) {
  if (!object(data) || data.success !== true || !UUID.test(data.source_id ?? "") ||
      data.submitted !== claims.length || data.verified !== claims.length ||
      !Number.isSafeInteger(data.inserted) || data.inserted < 0 ||
      !Number.isSafeInteger(data.duplicates) || data.duplicates < 0 ||
      data.inserted + data.duplicates !== claims.length ||
      !Array.isArray(data.results) || data.results.length !== claims.length) throw new BatchAdmissionError("batch_receipt_incomplete", 503);
  const seen = new Set<number>(), ids = new Set<string>(), witnesses = new Set<string>();
  let inserted = 0;
  for (const row of data.results) {
    const claim = claims[row?.index], d = claim?.structured_data;
    if (!object(row) || !Number.isInteger(row.index) || !claim || seen.has(row.index) ||
        !UUID.test(row.observation_id ?? "") || ids.has(row.observation_id) ||
        !UUID.test(row.witness_id ?? "") || witnesses.has(row.witness_id) ||
        !UUID.test(row.property_id ?? "") || typeof row.duplicate !== "boolean" ||
        row.vehicle_id !== claim.vehicle_id || row.image_id !== d.image_id ||
        row.property_key !== claim.property_key || row.value !== d[claim.property_key] ||
        row.source_observation_id !== d.source_observation_id || row.source_result_hash !== d.source_result_hash ||
        row.source_recorded_at !== d.source_recorded_at ||
        !Number.isFinite(row.confidence_score) || row.confidence_score < 0 || row.confidence_score > 0.6) {
      throw new BatchAdmissionError("batch_receipt_mismatch", 503);
    }
    seen.add(row.index); ids.add(row.observation_id); witnesses.add(row.witness_id);
    if (!row.duplicate) inserted++;
  }
  if (inserted !== data.inserted) throw new BatchAdmissionError("batch_receipt_count_mismatch", 503);
  return { success: true, total: claims.length, source_id: data.source_id,
    ingested: data.inserted, duplicates: data.duplicates, failed: 0,
    results: data.results.map((row: Record<string, unknown>) => ({ ...row, success: true })) };
}

export async function ingestCachedProperties(sb: any, observations: unknown) {
  const claims = await prepareCachedClaims(observations);
  let result;
  try {
    result = await sb.rpc("ingest_cached_image_property_batch", { p_claims: claims })
      .abortSignal(AbortSignal.timeout(40000));
  } catch { throw new BatchAdmissionError("batch_transaction_unavailable", 503); }
  if (result.error) throw new BatchAdmissionError("batch_transaction_rejected", 422);
  return validateCachedReceipt(result.data, claims);
}
