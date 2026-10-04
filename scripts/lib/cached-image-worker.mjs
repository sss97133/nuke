import { projectImageProperties, applyImagePropertyClaims } from './image-property-projection.mjs';

export const CACHE_WORKER_VERSION = 'public_cached_image_properties_v1';
export const CACHE_BUDGET = Object.freeze({ vehicles: 60, image_page: 1000, image_visits: 100000,
  default_sources: 100000, maximum_sources: 100000, maximum_claims: 300000, queries: 5000,
  query_ms: 10000, run_ms: 300000, hosted_calls: 0, hosted_spend_usd: 0 });
export const CACHE_ASSAY_BUDGET = Object.freeze({ ...CACHE_BUDGET, vehicles: 1, image_page: 100,
  image_visits: 100, default_sources: 20, maximum_sources: 100, maximum_claims: 300,
  queries: 20, run_ms: 60000 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const timestamp = value => typeof value === 'string' && TIME.test(value) && Number.isFinite(Date.parse(value));
const PROPERTY_KEYS = ['image_visible_rust_severity', 'image_visible_paint_stage', 'image_visible_assembly_state'];
class WorkerError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new WorkerError(code); };

export function initialCheckpoint(now = new Date().toISOString()) {
  return { version: CACHE_WORKER_VERSION, cutoff: now, vehicle_cursor: null,
    current_vehicle_id: null, image_cursor: null, completed_cycles: 0 };
}
export function validateCheckpoint(value) {
  if (!value || value.version !== CACHE_WORKER_VERSION || !timestamp(value.cutoff) ||
      !Number.isSafeInteger(value.completed_cycles) || value.completed_cycles < 0 ||
      Object.keys(value).some(key => !['version', 'cutoff', 'vehicle_cursor', 'current_vehicle_id', 'image_cursor', 'completed_cycles'].includes(key)) ||
      ![value.vehicle_cursor, value.current_vehicle_id].every(id => id === null || UUID.test(id ?? '')) ||
      (value.image_cursor !== null && (!value.current_vehicle_id || !UUID.test(value.image_cursor?.id ?? '') ||
        !timestamp(value.image_cursor?.created_at) || Object.keys(value.image_cursor).some(key => !['id', 'created_at'].includes(key))))) fail('checkpoint_invalid');
  return structuredClone(value);
}

/** Public auction provenance is required separately from public vehicle visibility. */
export function publicCachedImageEligible(image, vehicleId) {
  if (!UUID.test(image?.id ?? '') || image.vehicle_id !== vehicleId ||
      image.vision_gate_status !== 'approved' || image.is_sensitive === true ||
      image.is_duplicate === true || image.is_superseded === true || image.is_document === true ||
      ['mismatch', 'unrelated'].includes(image.image_vehicle_match_status)) return false;
  let url;
  try { url = new URL(image.image_url); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return false;
  return (['bat', 'bat_import'].includes(image.source) &&
      (url.hostname === 'bringatrailer.com' || url.hostname.endsWith('.bringatrailer.com'))) ||
    (image.source === 'external_import' && url.hostname === 'images.craigslist.org');
}

export async function runCachedImageProjection(sb, { checkpoint = initialCheckpoint(), apply = false,
  verifyOnly = false, vehicleId = null,
  sourceLimit = verifyOnly ? CACHE_ASSAY_BUDGET.default_sources : CACHE_BUDGET.default_sources, saveCheckpoint = async () => {},
  now = () => Date.now(), applyClaims = applyImagePropertyClaims } = {}) {
  let cursor;
  const budget = verifyOnly ? CACHE_ASSAY_BUDGET : CACHE_BUDGET;
  const started = now();
  const result = { schema_version: 2, mode: verifyOnly ? 'cached_assay' : apply ? 'cached_apply' : 'cached_dry_run',
    consumer: CACHE_WORKER_VERSION, status: 'failed', reason: 'not_started',
    budget: { ...budget, sources: sourceLimit }, remaining_unknown: true, full_history_verified: false,
    candidate_vehicles: 0, inspected_vehicles: 0, inspected_images: 0, eligible_source_images: 0,
    source_rows: 0, eligible_claims: 0, existing_claims: 0, ...(verifyOnly ? { missing_claims: 0 } : {}), newly_persisted_claims: 0,
    confirmed_new_observations: 0, confirmed_new_witnesses: 0, confirmed_reader_visible_claims: 0,
    verified_sources: 0, verified_batches: 0, deferred: {}, queries: 0, canonical_batch_calls: 0,
    query_scope: 'all_worker_client_requests_including_batch_ingest_excluding_writer_internal_queries',
    hosted_calls: 0, hosted_spend_usd: 0, model_calls: 0, elapsed_ms: 0, checkpoint_saved: false };
  const defer = reason => { result.deferred[reason] = (result.deferred[reason] ?? 0) + 1; };
  const remaining = () => budget.run_ms - (now() - started);
  const exhausted = () => result.eligible_source_images >= sourceLimit ||
    result.inspected_images >= budget.image_visits || remaining() <= 0;
  function countRequest() {
    if (remaining() <= 0) fail('run_budget_exhausted');
    if (result.queries >= budget.queries) fail('query_budget_exhausted');
    result.queries++;
  }
  async function query(makeQuery, { maxRows, object = false } = {}) {
    countRequest();
    const controller = new AbortController();
    let timer;
    try {
      const response = await Promise.race([
        makeQuery().abortSignal(controller.signal),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new WorkerError('query_timeout')); },
          Math.min(budget.query_ms, remaining())); }),
      ]);
      if (response?.error || response?.status >= 400) fail('database_query_failed');
      if (object) {
        if (!response?.data || typeof response.data !== 'object' || Array.isArray(response.data)) fail('reader_response_invalid');
      } else if (!Array.isArray(response?.data) || (maxRows !== undefined && response.data.length > maxRows)) fail('database_response_invalid');
      return response.data;
    } catch (error) { throw error instanceof WorkerError ? error : new WorkerError('database_query_failed'); }
    finally { clearTimeout(timer); controller.abort(); }
  }
  async function checkpointAt(next) {
    if (apply) {
      try { await saveCheckpoint(structuredClone(next)); } catch { fail('checkpoint_write_failed'); }
      result.checkpoint_saved = true;
    }
    cursor = next;
  }
  async function advanceVehicle(vehicleId) {
    await checkpointAt({ ...cursor, vehicle_cursor: vehicleId, current_vehicle_id: null, image_cursor: null });
  }
  try {
    cursor = validateCheckpoint(checkpoint);
    if (typeof apply !== 'boolean' || typeof verifyOnly !== 'boolean' ||
        !Number.isInteger(sourceLimit) || sourceLimit < 1 || sourceLimit > budget.maximum_sources ||
        (verifyOnly && (apply || !UUID.test(vehicleId ?? '') || cursor.vehicle_cursor ||
          cursor.current_vehicle_id || cursor.image_cursor)) || (!verifyOnly && vehicleId !== null)) fail('invalid_work_budget');
    const registry = await query(() => sb.from('observation_properties').select('id,property_key')
      .in('property_key', PROPERTY_KEYS).limit(4), { maxRows: 3 });
    const propertyIds = new Map(registry.map(row => [row.property_key, row.id]));
    if (propertyIds.size !== 3 || PROPERTY_KEYS.some(key => !UUID.test(propertyIds.get(key) ?? ''))) fail('property_registry_incomplete');
    const sources = await query(() => sb.from('observation_sources').select('id,slug')
      .eq('slug', 'photo_pipeline').limit(2), { maxRows: 2 });
    if (sources.length !== 1 || !UUID.test(sources[0].id ?? '')) fail('source_registry_invalid');
    const sourceId = sources[0].id;

    // The outer loop pages vehicles until a finite time/work budget, not an hourly throughput claim.
    while (!exhausted()) {
      const candidates = verifyOnly ? [{ vehicle_id: vehicleId }] : await query(() => {
        let q = sb.from('image_coverage_by_vehicle').select('vehicle_id,seen_t1')
          .gt('seen_t1', 0).order('vehicle_id', { ascending: true }).limit(CACHE_BUDGET.vehicles);
        if (cursor.vehicle_cursor) q = q.gt('vehicle_id', cursor.vehicle_cursor);
        return q;
      }, { maxRows: CACHE_BUDGET.vehicles });
      if (candidates.some(row => !UUID.test(row.vehicle_id ?? '')) ||
          new Set(candidates.map(row => row.vehicle_id)).size !== candidates.length) fail('candidate_response_invalid');
      const vehicleIds = [...new Set([cursor.current_vehicle_id, ...candidates.map(row => row.vehicle_id)].filter(Boolean))].slice(0, budget.vehicles);
      result.candidate_vehicles += vehicleIds.length;
      if (!vehicleIds.length) {
        await checkpointAt({ ...initialCheckpoint(new Date(now()).toISOString()), completed_cycles: cursor.completed_cycles + 1 });
        result.status = 'complete'; result.reason = 'bounded_coverage_cycle_complete'; break;
      }
      const vehicles = await query(() => sb.from('vehicles').select('id,is_public').in('id', vehicleIds)
        .limit(budget.vehicles), { maxRows: budget.vehicles });
      const publicIds = new Set(vehicles.filter(row => row.is_public === true).map(row => row.id));
      for (const vehicleId of vehicleIds) {
        if (exhausted()) break;
        result.inspected_vehicles++;
        if (!publicIds.has(vehicleId)) { defer('vehicle_not_public'); await advanceVehicle(vehicleId); continue; }
        if (cursor.current_vehicle_id !== vehicleId) await checkpointAt({ ...cursor, current_vehicle_id: vehicleId, image_cursor: null });
        while (!exhausted()) {
          const limit = Math.min(budget.image_page, sourceLimit - result.eligible_source_images,
            budget.image_visits - result.inspected_images);
          const images = await query(() => {
            let q = sb.from('vehicle_images')
              .select('id,vehicle_id,image_url,source,is_sensitive,is_duplicate,is_superseded,is_document,vision_gate_status,image_vehicle_match_status,created_at')
              .eq('vehicle_id', vehicleId).lte('created_at', cursor.cutoff)
              .in('source', ['bat', 'bat_import', 'external_import']).eq('vision_gate_status', 'approved')
              .not('is_sensitive', 'is', true).not('is_duplicate', 'is', true).not('is_superseded', 'is', true)
              .not('is_document', 'is', true)
              .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit);
            if (cursor.image_cursor) {
              const { created_at, id } = cursor.image_cursor;
              q = q.or(`created_at.lt.${created_at},and(created_at.eq.${created_at},id.lt.${id})`);
            }
            return q;
          }, { maxRows: limit });
          if (!images.length) { await advanceVehicle(vehicleId); break; }
          if (new Set(images.map(image => image?.id)).size !== images.length || images.some(image =>
            !UUID.test(image?.id ?? '') || image.vehicle_id !== vehicleId || !timestamp(image.created_at))) fail('image_response_invalid');
          result.inspected_images += images.length;
          const eligibleImages = images.filter(image => publicCachedImageEligible(image, vehicleId));
          for (let n = eligibleImages.length; n < images.length; n++) defer('image_not_public_qualified');
          const parentsByImage = new Map();
          if (eligibleImages.length) {
            const ids = eligibleImages.map(image => image.id);
            const response = await query(() => sb.rpc('get_cached_image_projection_parents', {
              p_vehicle_id: vehicleId, p_image_ids: ids, p_cutoff: cursor.cutoff,
            }), { object: true });
            if (response.requested !== ids.length || !Number.isSafeInteger(response.found) || response.found < 0 ||
                !Array.isArray(response.parents) || response.parents.length !== ids.length ||
                !timestamp(response.cutoff) || Date.parse(response.cutoff) !== Date.parse(cursor.cutoff)) fail('parent_response_invalid');
            const requested = new Set(ids);
            let found = 0;
            for (const entry of response.parents) {
              if (!requested.has(entry?.image_id) || parentsByImage.has(entry.image_id) ||
                  (entry.parent !== null && (typeof entry.parent !== 'object' || Array.isArray(entry.parent)))) fail('parent_response_invalid');
              const parent = entry.parent;
              if (parent !== null && (!UUID.test(parent?.id ?? '') || parent.vehicle_id !== vehicleId ||
                  parent.structured_data?.image_id !== entry.image_id || parent.kind !== 'condition' ||
                  parent.structured_data.analysis_kind !== 'image_deep_byok' || !timestamp(parent.ingested_at) ||
                  Date.parse(parent.ingested_at) > Date.parse(cursor.cutoff))) fail('parent_response_invalid');
              if (parent) found++;
              parentsByImage.set(entry.image_id, parent);
            }
            if (found !== response.found) fail('parent_response_invalid');
            result.source_rows += found;
          }
          const groups = [];
          for (const image of eligibleImages) {
            const parent = parentsByImage.get(image.id);
            if (!parent) { defer('immutable_testimony_missing'); continue; }
            // Sanitized state fields cannot attest the privacy of the full
            // original. Only the protected selector can supply this verdict.
            if (parent.source_is_public !== true) {
              defer(parent.source_is_public === false ? 'source_not_public' : 'source_visibility_unknown');
              continue;
            }
            if (parent.structured_data.scene_type === 'receipt_document') { defer('document_testimony'); continue; }
            const projected = projectImageProperties(parent, image);
            if (projected.deferred) { defer(projected.deferred); continue; }
            groups.push({ image, parent, claims: projected.claims });
          }
          const claims = groups.flatMap(group => group.claims);
          result.eligible_source_images += groups.length; result.eligible_claims += claims.length;
          if (claims.length) {
            const expected = new Map(claims.map(claim => [claim.source_identifier, claim]));
            if (expected.size !== claims.length) fail('projection_identity_duplicate');
            // UUID parent chunks bound GET URL size and remain below the REST row cap.
            async function readLanded() {
              const landed = [];
              for (let start = 0; start < groups.length; start += 100) {
                const ids = groups.slice(start, start + 100).map(group => group.parent.id);
                const rows = await query(() => sb.from('vehicle_observations')
                  .select('id,vehicle_id,kind,source_id,source_identifier,property_id,structured_data,confidence_score,is_superseded')
                  .eq('vehicle_id', vehicleId).eq('source_id', sourceId).eq('kind', 'condition')
                  .eq('structured_data->>analysis_kind', 'image_property_projection')
                  .eq('structured_data->>projection_version', 'byok_image_properties_v1')
                  .in('structured_data->>source_observation_id', ids).limit(ids.length * 3 + 1), { maxRows: ids.length * 3 });
                landed.push(...rows);
              }
              if (landed.some(row => !expected.has(row.source_identifier)) ||
                  new Set(landed.map(row => row.source_identifier)).size !== landed.length ||
                  new Set(landed.map(row => row.id)).size !== landed.length) fail('canonical_readback_mismatch');
              return landed;
            }
            let landed = await readLanded();
            const existing = new Set(landed.map(row => row.source_identifier));
            const missing = claims.filter(claim => !existing.has(claim.source_identifier));
            result.existing_claims += claims.length - missing.length;
            if (verifyOnly) {
              result.missing_claims += missing.length;
              if (missing.length) fail('canonical_readback_incomplete');
            }
            if (apply && missing.length) {
              result.canonical_batch_calls++;
              const applied = await applyClaims(sb, missing, { mode: 'batch', registry, sourceId,
                runMs: Math.max(1, Math.min(60000, remaining())), onRequest: countRequest });
              if (applied.failed !== 0 || applied.unattempted !== 0 || applied.verified !== missing.length ||
                  !Number.isSafeInteger(applied.inserted) || applied.inserted < 0 ||
                  !Number.isSafeInteger(applied.duplicates) || applied.inserted + applied.duplicates !== missing.length) fail('canonical_persistence_unverified');
              result.newly_persisted_claims += applied.inserted;
              result.confirmed_new_observations += applied.inserted;
              result.confirmed_new_witnesses += applied.inserted;
              landed = await readLanded();
            }
            if (apply || verifyOnly) {
              if (landed.length !== claims.length) fail('canonical_readback_incomplete');
              const rowsByIdentity = new Map(landed.map(row => [row.source_identifier, row]));
              for (const claim of claims) {
                const row = rowsByIdentity.get(claim.source_identifier);
                if (!UUID.test(row?.id ?? '') || row.vehicle_id !== vehicleId || row.source_id !== sourceId ||
                    row.kind !== 'condition' || row.is_superseded === true || row.property_id !== propertyIds.get(claim.property_key) ||
                    row.structured_data?.image_id !== claim.structured_data.image_id ||
                    row.structured_data?.source_observation_id !== claim.structured_data.source_observation_id ||
                    row.structured_data?.source_result_hash !== claim.structured_data.source_result_hash ||
                    row.structured_data?.source_recorded_at !== claim.structured_data.source_recorded_at ||
                    row.structured_data?.[claim.property_key] !== claim.structured_data[claim.property_key] ||
                    !Number.isFinite(row.confidence_score) || row.confidence_score < 0 || row.confidence_score > 0.6) fail('canonical_readback_mismatch');
              }
              // Refresh after ALL writes; caching an earlier reader response would hide later claims.
              for (const propertyKey of new Set(claims.map(claim => claim.property_key))) {
                const reader = await query(() => sb.rpc('get_field_provenance', { p_vehicle_id: vehicleId, p_field: propertyKey }), { object: true });
                if (reader.vehicle_id !== vehicleId || reader.field !== propertyKey || !Array.isArray(reader.image_observations)) fail('reader_evidence_unverified');
                const visible = new Map(reader.image_observations.map(item => [item.observation_id, item]));
                for (const claim of claims.filter(claim => claim.property_key === propertyKey)) {
                  const row = rowsByIdentity.get(claim.source_identifier), item = visible.get(row.id);
                  if (item?.image_id !== claim.structured_data.image_id || !UUID.test(item.witness_id ?? '') ||
                      item.witness_role !== 'derived' || item.value !== claim.structured_data[propertyKey]) fail('reader_evidence_unverified');
                }
              }
              result.confirmed_reader_visible_claims += claims.length;
              result.verified_sources += groups.length;
              result.verified_batches++;
            }
          }
          // No image in this batch advances until every admitted claim is proven.
          const last = images.at(-1);
          await checkpointAt({ ...cursor, image_cursor: { created_at: last.created_at, id: last.id } });
          if (images.length < limit) { await advanceVehicle(vehicleId); break; }
        }
      }
      if (verifyOnly) {
        if (!cursor.current_vehicle_id) {
          result.status = result.eligible_claims > 0 ? 'complete' : 'incomplete';
          result.reason = result.eligible_claims > 0 ? 'selected_vehicle_examined' : 'no_eligible_claims';
        }
        break;
      }
    }
    if (result.reason === 'not_started') { result.status = 'incomplete'; result.reason = 'work_budget_reached'; }
  } catch (error) {
    result.reason = error instanceof WorkerError ? error.code : 'cached_worker_failed';
    result.status = verifyOnly && ['query_budget_exhausted', 'run_budget_exhausted'].includes(result.reason) ? 'incomplete' : 'failed';
  }
  result.elapsed_ms = Math.max(0, now() - started);
  return { ...result, checkpoint: cursor ?? null };
}

export function cachedWorkerExitCode(result) {
  if (result?.mode === 'cached_assay') {
    if (result.consumer !== CACHE_WORKER_VERSION || result.status === 'failed') return 1;
    return result.status === 'complete' && result.eligible_claims > 0 &&
      result.confirmed_reader_visible_claims === result.eligible_claims ? 0 : 2;
  }
  return result?.consumer === CACHE_WORKER_VERSION && ['complete', 'incomplete'].includes(result.status) ? 0 : 1;
}
