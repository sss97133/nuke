import { createHash } from 'node:crypto';

export const PROJECTION_VERSION = 'byok_image_properties_v1';
export const IMAGE_PROPERTIES = {
  rust_severity: ['image_visible_rust_severity', ['none', 'surface', 'pitting', 'perforation']],
  paint_state: ['image_visible_paint_stage', ['bare_metal', 'primer', 'sealer', 'base', 'clear', 'aged']],
  completeness: ['image_visible_assembly_state', ['stripped', 'partial', 'assembled']],
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const deferred = reason => ({ claims: [], deferred: reason });

/** Read immutable stored testimony, not today's mutable image cache. No inference. */
export function projectImageProperties(observation, image) {
  const data = observation?.structured_data;
  if (!UUID.test(observation?.id ?? '') || observation?.kind !== 'condition' ||
      observation.is_superseded === true || data?.analysis_kind !== 'image_deep_byok') {
    return deferred('not_current_byok_testimony');
  }
  if (!UUID.test(data.image_id ?? '') || !UUID.test(observation.vehicle_id ?? '') ||
      image?.id !== data.image_id || image?.vehicle_id !== observation.vehicle_id) {
    return deferred('image_vehicle_mismatch');
  }
  if (image.is_sensitive === true || image.is_superseded === true || image.is_duplicate === true ||
      ![null, undefined, 'approved'].includes(image.vision_gate_status) ||
      ['mismatch', 'unrelated'].includes(image.image_vehicle_match_status)) {
    return deferred('image_not_eligible');
  }
  if (observation.confidence === 'low' || data.needs_review === true || data.needs_clarification === true || data.attribution_doubt) {
    return deferred('source_requires_review');
  }
  if (!nonempty(observation.agent_model) || !nonempty(observation.extraction_method) ||
      !timestamp(observation.ingested_at)) return deferred('source_provenance_incomplete');
  if (!Number.isFinite(observation.confidence_score) || observation.confidence_score < 0.6 ||
      observation.confidence_score > 1) return deferred('source_confidence_ineligible');

  const claims = [];
  const sourceResult = {
    observation_id: observation.id, image_id: image.id, vehicle_id: image.vehicle_id,
    model: observation.agent_model, method: observation.extraction_method,
    recorded_at: observation.ingested_at,
    state_observations: Object.fromEntries(Object.keys(IMAGE_PROPERTIES)
      .map(key => [key, data.state_observations?.[key] ?? null])),
  };
  const sourceResultJson = JSON.stringify(sourceResult);
  const sourceHash = createHash('sha256').update(sourceResultJson).digest('hex');
  for (const [sourceKey, [propertyKey, values]] of Object.entries(IMAGE_PROPERTIES)) {
    const value = data.state_observations?.[sourceKey];
    if (!values.includes(value)) continue;
    claims.push({
      source_slug: 'photo_pipeline', kind: 'condition', vehicle_id: image.vehicle_id,
      property_key: propertyKey, agent_inferred: true, defer_analysis: true,
      // This is the time the source testimony was recorded. Historical observed_at
      // mixes capture/review/ingest clocks, so never relabel it as photo capture.
      observed_at: observation.ingested_at,
      source_identifier: `${PROJECTION_VERSION}:${observation.id}:${sourceHash}:${propertyKey}`,
      // Transport proof only. The canonical hash enumerates its existing fields;
      // this envelope never becomes a second copy of testimony in structured_data.
      source_result_json: sourceResultJson,
      raw_source_ref: `vehicle_observations:${observation.id}`,
      agent_model: observation.agent_model,
      agent_tier: observation.agent_tier || undefined,
      extraction_method: 'cached_byok_property_projection_v1',
      agent_cost_cents: 0,
      structured_data: {
        [propertyKey]: value, image_id: image.id, property_key: propertyKey,
        analysis_kind: 'image_property_projection', projection_version: PROJECTION_VERSION,
        source_observation_id: observation.id, source_result_hash: sourceHash,
        source_extraction_method: observation.extraction_method,
        source_model_confidence: observation.confidence_score,
        source_recorded_at: observation.ingested_at,
        source_observed_at: timestamp(observation.observed_at) ? observation.observed_at : null,
        observed_at_basis: 'source_testimony_recorded_at',
        capture_at: null, analyzed_at: null, claim_role: 'inferred',
        source_family: `image:${image.id}`,
        limitation: 'Projection of an existing model reading of one image. Capture and analysis clocks are unverified. Not whole-vehicle condition or independent corroboration.',
      },
    });
  }
  return { claims, deferred: claims.length ? null : 'no_known_scalar_values' };
}

// PostgreSQL retains microseconds; Date.parse alone would accept sub-ms drift.
// Normalize only for comparison: never change source payloads or replay hashes.
export function instantMicros(value) {
  if (typeof value !== 'string') return null;
  const match = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return null;
  return BigInt(Date.parse(value)) * 1000n + BigInt((match[1] ?? '').padEnd(6, '0').slice(3));
}

export const IMAGE_PROPERTY_BATCH_MODE = 'cached_image_property_projection_v1';
export const IMAGE_PROPERTY_BATCH_LIMIT = 3000;

/** The batch front door verifies row and witness persistence in one transaction.
 * Legacy calls require an explicit option; a failed batch never reroutes. */
export async function applyImagePropertyClaims(sb, claims, { runMs = 60000, mode = 'batch',
  registry: suppliedRegistry, sourceId, onRequest = () => {} } = {}) {
  if (mode === 'legacy') return applyImagePropertyClaimsLegacy(sb, claims, { runMs });
  const receipt = { inserted: 0, duplicates: 0, verified: 0, failed: 0, unattempted: Array.isArray(claims) ? claims.length : 0,
    requests: 0, observations: [] };
  if (mode !== 'batch' || !Number.isInteger(runMs) || runMs < 1 || runMs > 60000 ||
      !Array.isArray(claims) || claims.length > IMAGE_PROPERTY_BATCH_LIMIT) {
    return { ...receipt, failed: 1, reason: 'invalid_budget' };
  }
  if (claims.length === 0) return receipt;
  const deadline = Date.now() + runMs;
  const request = (maximumMs = 10000) => {
    if (Date.now() >= deadline) throw new Error('run_budget_exhausted');
    onRequest(); receipt.requests++;
    return Math.max(1, Math.min(maximumMs, deadline - Date.now()));
  };
  let registry = suppliedRegistry;
  try {
    if (registry === undefined) {
      const response = await sb.from('observation_properties').select('id,property_key')
        .in('property_key', [...new Set(claims.map(claim => claim.property_key))])
        .abortSignal(AbortSignal.timeout(request()));
      if (response?.error || !Array.isArray(response?.data)) throw new Error('registry_unavailable');
      registry = response.data;
    }
    if (!Array.isArray(registry)) throw new Error('registry_incomplete');
    const propertyIds = new Map(registry.map(row => [row.property_key, row.id]));
    if (propertyIds.size !== registry.length || claims.some(claim => !UUID.test(propertyIds.get(claim.property_key) ?? ''))) {
      throw new Error('registry_incomplete');
    }
    const body = { mode: IMAGE_PROPERTY_BATCH_MODE, observations: claims };
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 8 * 1024 * 1024 ||
        new Set(claims.map(claim => claim.source_identifier)).size !== claims.length) throw new Error('invalid_budget');
    const timeout = request(45000);
    receipt.unattempted = 0;
    const response = await sb.functions.invoke('ingest-observation-batch', { body, timeout });
    const data = response?.data;
    if (response?.error || data?.success !== true || !UUID.test(data.source_id ?? '') ||
        (sourceId !== undefined && data.source_id !== sourceId) || data.total !== claims.length || data.failed !== 0 ||
        !Number.isSafeInteger(data.ingested) || data.ingested < 0 ||
        !Number.isSafeInteger(data.duplicates) || data.duplicates < 0 ||
        data.ingested + data.duplicates !== claims.length || !Array.isArray(data.results) ||
        data.results.length !== claims.length) throw new Error('batch_receipt_invalid');
    const indices = new Set(), ids = new Set(), witnesses = new Set();
    let inserted = 0, duplicates = 0;
    for (const row of data.results) {
      const index = row?.index;
      if (!Number.isSafeInteger(index) || index < 0 || index >= claims.length || indices.has(index)) throw new Error('batch_receipt_invalid');
      const claim = claims[index];
      if (row.success !== true || typeof row.duplicate !== 'boolean' || !UUID.test(row.observation_id ?? '') ||
          !UUID.test(row.witness_id ?? '') || ids.has(row.observation_id) || witnesses.has(row.witness_id) ||
          row.vehicle_id !== claim.vehicle_id || row.image_id !== claim.structured_data.image_id ||
          row.property_id !== propertyIds.get(claim.property_key) || row.property_key !== claim.property_key ||
          row.value !== claim.structured_data[claim.property_key] ||
          row.source_observation_id !== claim.structured_data.source_observation_id ||
          row.source_result_hash !== claim.structured_data.source_result_hash ||
          row.source_recorded_at !== claim.structured_data.source_recorded_at ||
          !Number.isFinite(row.confidence_score) || row.confidence_score < 0 || row.confidence_score > 0.6) {
        throw new Error('batch_receipt_invalid');
      }
      indices.add(index); ids.add(row.observation_id); witnesses.add(row.witness_id);
      row.duplicate ? duplicates++ : inserted++;
    }
    if (inserted !== data.ingested || duplicates !== data.duplicates) throw new Error('batch_receipt_invalid');
    return { ...receipt, inserted, duplicates, verified: claims.length, observations: data.results };
  } catch (error) {
    const safe = ['invalid_budget', 'registry_unavailable', 'registry_incomplete', 'run_budget_exhausted', 'batch_receipt_invalid'];
    return { ...receipt, failed: 1, reason: safe.includes(error?.message) ? error.message : 'batch_request_failed' };
  }
}

/** Explicit compatibility mode; never selected after a failed batch. */
async function applyImagePropertyClaimsLegacy(sb, claims, { runMs = 60000 } = {}) {
  const receipt = { inserted: 0, duplicates: 0, verified: 0, failed: 0, unattempted: claims.length };
  if (!Number.isInteger(runMs) || runMs < 1 || runMs > 60000 || claims.length > 1500) {
    return { ...receipt, failed: 1, reason: 'invalid_budget' };
  }
  const deadline = Date.now() + runMs;
  const timeout = () => Math.max(1, Math.min(10000, deadline - Date.now()));
  if (claims.length === 0) return receipt;
  let registry;
  try {
    registry = await sb.from('observation_properties').select('id,property_key')
    .in('property_key', [...new Set(claims.map(claim => claim.property_key))])
    .abortSignal(AbortSignal.timeout(timeout()));
  } catch { return { ...receipt, failed: 1, reason: 'registry_unavailable' }; }
  if (registry.error || !Array.isArray(registry.data)) return { ...receipt, failed: 1, reason: 'registry_unavailable' };
  const propertyIds = new Map(registry.data.map(row => [row.property_key, row.id]));
  if (claims.some(claim => !UUID.test(propertyIds.get(claim.property_key) ?? ''))) {
    return { ...receipt, failed: 1, reason: 'registry_incomplete' };
  }
  for (const claim of claims) {
    if (Date.now() >= deadline) { receipt.failed++; receipt.reason = 'run_budget_exhausted'; break; }
    receipt.unattempted--;
    try {
      const result = await sb.functions.invoke('ingest-observation', { body: claim, timeout: timeout() });
      if (result.error || result.data?.success !== true || !UUID.test(result.data?.observation_id ?? '')) {
        receipt.failed++; break;
      }
      const id = result.data.observation_id;
      const row = await sb.from('vehicle_observations')
        .select('id,vehicle_id,property_id,structured_data,confidence_score,observed_at,ingested_at,source_identifier,extraction_method,agent_model,raw_source_ref,kind,is_superseded,source:observation_sources!source_id(slug)')
        .eq('id', id).maybeSingle().abortSignal(AbortSignal.timeout(timeout()));
      const witness = await sb.from('observation_witnesses').select('id')
        .eq('observation_id', id).eq('image_id', claim.structured_data.image_id)
        .eq('witness_role', 'derived').limit(2).abortSignal(AbortSignal.timeout(timeout()));
      const eventTime = instantMicros(row.data?.observed_at);
      const ingestTime = instantMicros(row.data?.ingested_at);
      const expectedEventTime = instantMicros(claim.observed_at);
      if (row.error || witness.error || !propertyIds.get(claim.property_key) ||
          row.data?.property_id !== propertyIds.get(claim.property_key) ||
          row.data.id !== id || row.data.is_superseded !== false || row.data.kind !== claim.kind ||
          row.data.source?.slug !== claim.source_slug || row.data.source_identifier !== claim.source_identifier ||
          row.data.extraction_method !== claim.extraction_method || row.data.agent_model !== claim.agent_model ||
          row.data.raw_source_ref !== claim.raw_source_ref ||
          eventTime === null || ingestTime === null || expectedEventTime === null ||
          eventTime !== expectedEventTime || ingestTime < eventTime ||
          row.data.vehicle_id !== claim.vehicle_id ||
          // This projection emits allowlisted scalar fields only; include all its
          // retained provenance/unknown clocks, not just the result digest.
          Object.entries(claim.structured_data).some(([key, value]) => row.data.structured_data?.[key] !== value) ||
          !Number.isFinite(row.data.confidence_score) || row.data.confidence_score < 0 ||
          row.data.confidence_score > 0.6 || witness.data?.length !== 1) {
        receipt.failed++; receipt.reason = 'persistence_readback_mismatch'; break;
      }
      result.data.duplicate === true ? receipt.duplicates++ : receipt.inserted++;
      receipt.verified++;
    } catch {
      receipt.failed++; break;
    }
  }
  return receipt;
}
