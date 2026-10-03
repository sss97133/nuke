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
  const sourceHash = createHash('sha256').update(JSON.stringify(sourceResult)).digest('hex');
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

/** One finite pass; successful HTTP alone is insufficient. Read back its typed links. */
export async function applyImagePropertyClaims(sb, claims, { runMs = 60000 } = {}) {
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
        .select('id,vehicle_id,property_id,structured_data,confidence_score')
        .eq('id', id).maybeSingle().abortSignal(AbortSignal.timeout(timeout()));
      const witness = await sb.from('observation_witnesses').select('id')
        .eq('observation_id', id).eq('image_id', claim.structured_data.image_id)
        .eq('witness_role', 'derived').limit(2).abortSignal(AbortSignal.timeout(timeout()));
      if (row.error || witness.error || !propertyIds.get(claim.property_key) ||
          row.data?.property_id !== propertyIds.get(claim.property_key) ||
          row.data.vehicle_id !== claim.vehicle_id ||
          row.data.structured_data?.[claim.property_key] !== claim.structured_data[claim.property_key] ||
          row.data.structured_data?.source_observation_id !== claim.structured_data.source_observation_id ||
          row.data.structured_data?.image_id !== claim.structured_data.image_id ||
          row.data.structured_data?.source_result_hash !== claim.structured_data.source_result_hash ||
          row.data.structured_data?.source_recorded_at !== claim.structured_data.source_recorded_at ||
          !Number.isFinite(row.data.confidence_score) || row.data.confidence_score < 0 ||
          row.data.confidence_score > 0.6 || witness.data?.length !== 1) {
        receipt.failed++; break;
      }
      result.data.duplicate === true ? receipt.duplicates++ : receipt.inserted++;
      receipt.verified++;
    } catch {
      receipt.failed++; break;
    }
  }
  return receipt;
}
