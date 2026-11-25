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
const CHILD_LIMITATION = 'Projection of an existing model reading of one image. Capture and analysis clocks are unverified. Not whole-vehicle condition or independent corroboration.';
const HASH = /^[0-9a-f]{64}$/;
const CONTRACT_INTENT_CONFIRM_THRESHOLD = 0.6; // supabase/functions/_shared/byokImageVerdict.mjs INTENT_CONFIRM_THRESHOLD

/**
 * The reader's own contract makes needs_clarification true whenever the photo's INTENT (why it was taken: labor,
 * inspection, documentation...) is unknown or under 0.6 (byokImageVerdict.mjs, the labor-value guard). That flag is
 * about labor attribution, not about what the photo shows. A stored reading whose flag is explained by exactly that
 * condition is intent-only; a flag beside a confirmed intent has some other cause and stays a hold.
 */
export function clarificationIsIntentOnly(data) {
  return data?.needs_clarification === true &&
    (data.intent === 'unknown' ||
     (typeof data.intent === 'string' && data.intent.length > 0 && Number.isFinite(data.intent_confidence) &&
      data.intent_confidence < CONTRACT_INTENT_CONFIRM_THRESHOLD));
}

/**
 * A stored reading whose own words say its frame is a picture of a picture. This is the database's
 * public.photo_reading_is_print (migration 20261119230000) copied: the same pattern over the narrative and the first
 * component label, so a change to one must change the other. vehicle_build_reconstruction and
 * vehicle_part_installation_evidence already leave such photos out; here nothing new is keyed from one, because its
 * three fields describe the car in the print and the photo's date is the day the print was photographed.
 * Measured 2026-11-20 on the proof vehicle: 6 such photos of 481, 2 of them carrying a keyed assembly state from before
 * this hold (those two rows stay current: retracting them is the database's to do, no agent route supersedes a child).
 */
const PRINT_READING = /\b(printed|paper|album)\s+(sheet|page)\b|\bprinted\s+(\w+\s+){0,2}(photograph|picture)s?\b/i;
export function readingIsPictureOfPicture(data) {
  const first = Array.isArray(data?.components_seen) ? data.components_seen[0]?.label : null;
  return PRINT_READING.test(`${typeof data?.narrative_one_line === 'string' ? data.narrative_one_line : ''} ${typeof first === 'string' ? first : ''}`);
}

/**
 * What a projected child may carry: ids, a pointer to its source reading, one enum value, clocks, a fixed sentence.
 * Never the reader's notes, questions, text regions or any other prose. Returns true only for that exact shape, so a
 * child that ever picked up free text is refused here before the database is even asked.
 */
export function childCarriesOnlyEnumAndPointers(claim) {
  const d = claim?.structured_data;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
  const spec = Object.values(IMAGE_PROPERTIES).find(([key]) => key === claim.property_key);
  if (!spec) return false;
  const allowed = new Set([claim.property_key, 'image_id', 'property_key', 'analysis_kind', 'projection_version',
    'source_observation_id', 'source_result_hash', 'source_extraction_method', 'source_model_confidence',
    'source_recorded_at', 'source_observed_at', 'observed_at_basis', 'capture_at', 'analyzed_at', 'claim_role',
    'source_family', 'limitation']);
  if (Object.keys(d).length !== allowed.size || Object.keys(d).some(key => !allowed.has(key))) return false;
  return spec[1].includes(d[claim.property_key]) && d.property_key === claim.property_key &&
    UUID.test(d.image_id ?? '') && UUID.test(d.source_observation_id ?? '') && HASH.test(d.source_result_hash ?? '') &&
    d.analysis_kind === 'image_property_projection' && d.projection_version === PROJECTION_VERSION &&
    d.claim_role === 'inferred' && d.observed_at_basis === 'source_testimony_recorded_at' &&
    d.capture_at === null && d.analyzed_at === null && d.source_family === `image:${d.image_id}` &&
    /^[a-z0-9_.:-]{1,80}$/i.test(d.source_extraction_method ?? '') && Number.isFinite(d.source_model_confidence) &&
    timestamp(d.source_recorded_at) && (d.source_observed_at === null || timestamp(d.source_observed_at)) &&
    d.limitation === CHILD_LIMITATION &&
    claim.raw_source_ref === `vehicle_observations:${d.source_observation_id}` &&
    claim.kind === 'condition' && nonempty(claim.source_identifier);
}

/** Read immutable stored testimony, not today's mutable image cache. No inference. */
export function projectImageProperties(observation, image, { releaseIntentOnlyClarification = false } = {}) {
  const data = observation?.structured_data;
  if (!UUID.test(observation?.id ?? '') || observation?.kind !== 'condition' ||
      observation.is_superseded === true || data?.analysis_kind !== 'image_deep_byok') {
    return deferred('not_current_byok_testimony');
  }
  if (!UUID.test(data.image_id ?? '') || !UUID.test(observation.vehicle_id ?? '') ||
      image?.id !== data.image_id || image?.vehicle_id !== observation.vehicle_id) {
    return deferred('image_vehicle_mismatch');
  }
  // is_document and the receipt scene are refused by the batch intake too (20261004064216): a photographed paper
  // is not the vehicle, whatever the reading's three fields say.
  if (data.scene_type === 'receipt_document') return deferred('receipt_document');
  if (readingIsPictureOfPicture(data)) return deferred('picture_of_picture');
  if (image.is_sensitive === true || image.is_superseded === true || image.is_duplicate === true || image.is_document === true ||
      ![null, undefined, 'approved'].includes(image.vision_gate_status) ||
      ['mismatch', 'unrelated'].includes(image.image_vehicle_match_status)) {
    return deferred('image_not_eligible');
  }
  // The batch intake and the public field reader still hold every needs_clarification reading, so only the
  // one-at-a-time route may ask for the intent-only release.
  const clarificationHeld = data.needs_clarification === true &&
    !(releaseIntentOnlyClarification && clarificationIsIntentOnly(data));
  if (observation.confidence === 'low' || data.needs_review === true || clarificationHeld || data.attribution_doubt) {
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
        limitation: CHILD_LIMITATION,
      },
    });
  }
  return { claims, deferred: claims.length ? null : 'no_known_scalar_values',
    ...(data.needs_clarification === true && claims.length ? { released_intent_only_clarification: true } : {}) };
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
        .select('id,vehicle_id,property_id,structured_data,confidence_score,observed_at,ingested_at,source_identifier,extraction_method,agent_model,raw_source_ref,kind,is_superseded,source_observation_id,source:observation_sources!source_id(slug)')
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
          // the source reading as the typed key, not only inside structured_data (migration 20261125191500)
          row.data.source_observation_id !== claim.structured_data.source_observation_id ||
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

export const TYPED_SOURCE_SLICE = 200;   // rows a call to supersede_untyped_cached_image_properties re-lands (its limit is 1..500)
export const TYPED_SOURCE_CALLS = 25;    // calls a walk makes: 5,000 rows, more than any vehicle holds (proof vehicle 776, 2026-11-25)
export const SINGLE_SLICE = 20;   // claims per call on the one-at-a-time route: each call has its own 60 s budget
const SOURCE_COLUMNS = 'id,vehicle_id,kind,is_superseded,observed_at,ingested_at,agent_model,agent_tier,extraction_method,confidence,confidence_score,structured_data';
const IMAGE_COLUMNS = 'id,vehicle_id,is_sensitive,is_superseded,is_duplicate,is_document,vision_gate_status,image_vehicle_match_status';

/**
 * The current deep reading of each photo, as the database's image_stage_reading_parent picks it: of the photo's deep
 * readings on this vehicle that are not superseded, the one its stamp points at, else the newest by ingested_at (a missing
 * clock last), ties to the lowest id.
 *   pointers  [{ id, current_observation_id }]   the photo's own stamp
 *   readings  [{ id, vehicle_id, kind, is_superseded, ingested_at, image_id }]   every deep reading naming those photos
 */
export function currentReadingIds(pointers, readings, vehicleId) {
  const stamp = new Map(pointers.map(row => [row.id, row.current_observation_id]));
  const micros = row => { try { return row.ingested_at ? instantMicros(row.ingested_at) : -1n; } catch { return -1n; } };
  const chosen = new Map();
  for (const row of readings) {
    if (!stamp.has(row.image_id) || row.vehicle_id !== vehicleId || row.kind !== 'condition' || row.is_superseded === true || !UUID.test(row.id ?? '')) continue;
    const have = chosen.get(row.image_id);
    if (!have) { chosen.set(row.image_id, row); continue; }
    if (have.id === stamp.get(row.image_id)) continue;
    const newer = micros(row) > micros(have) || (micros(row) === micros(have) && row.id < have.id);
    if (row.id === stamp.get(row.image_id) || newer) chosen.set(row.image_id, row);
  }
  return [...new Set([...chosen.values()].map(row => row.id))];
}

/**
 * project-cached: walk one vehicle's stored deep readings, newest first, and project their three values (dry run)
 * or land them. Returns { receipt, exitCode }; the receipt holds counts and fixed reason words only.
 *
 * single: the batch intake takes a public vehicle's listing photos only. This route sends one claim at a time through
 * ingest-observation and reads each row and its witness back, so it serves an owner's own photos. It keeps what the
 * batch intake checks beside that rule: each child row it would write must pass the database's observation_is_public
 * on its own (the source reading's prose is not what gets written), and a claim that a row already holds (current or
 * superseded) is not sent again. Readings flagged needs_clarification only because their intent is unconfirmed are
 * projected here (the flag is about labor attribution, not about the three values).
 */
export async function projectCachedRun(sb, { vehicleId, limit = 100, pages = 1, before, apply = false, single = false, imageIds = null }) {
  // imageIds: only the CURRENT reading of each named photo (the stage worker's one-photo call), chosen by the database's own
  // rule (image_stage_reading_parent, which its gap finder uses to say a photo has a reading to key): among the photo's
  // unsuperseded deep readings on this vehicle, the one the photo's ai_scan_metadata.byok_deep_analysis.observation_id points
  // at; when that pointer is missing or names a reading that is no longer current, the newest. Never every unsuperseded
  // reading that names the photo (a retried intake can leave a second one that never landed on the photo). Everything below
  // is the same code path, holds and safety checks included.
  if (imageIds !== null && (!Array.isArray(imageIds) || imageIds.length === 0 || imageIds.length > 100 || !imageIds.every(id => UUID.test(id ?? '')))) {
    throw new Error('project-cached: imageIds must be 1..100 uuids');
  }
  const counts = { sampled_condition_rows: 0, source_rows: 0, eligible_claims: 0 };
  const landed = { inserted: 0, duplicates: 0, verified: 0, failed: 0, unattempted: 0 };
  const held = { already_projected: 0, already_projected_superseded: 0, released_intent_only_clarification: 0 };
  const deferred = {};
  const defer = why => { deferred[why] = (deferred[why] || 0) + 1; };
  const signal = () => AbortSignal.timeout(10000);
  let cursor = null, walked = 0, reachedOldest = false, last = {}, reason, currentIds = null;
  if (imageIds) {
    const pointers = await sb.from('vehicle_images').select('id,current_observation_id:ai_scan_metadata->byok_deep_analysis->>observation_id')
      .in('id', imageIds).abortSignal(AbortSignal.timeout(10000));
    if (pointers.error || !Array.isArray(pointers.data)) throw new Error('project-cached: current readings unavailable');
    // found through the (image_id, analysis_kind) index alone; the vehicle, the kind and currency are checked on the few rows back
    const readings = await sb.from('vehicle_observations').select('id,vehicle_id,kind,is_superseded,ingested_at,image_id:structured_data->>image_id')
      .eq('structured_data->>analysis_kind', 'image_deep_byok').in('structured_data->>image_id', imageIds)
      .limit(1000).abortSignal(AbortSignal.timeout(10000));
    if (readings.error || !Array.isArray(readings.data)) throw new Error('project-cached: current readings unavailable');
    currentIds = currentReadingIds(pointers.data, readings.data, vehicleId);
    if (!currentIds.length) reachedOldest = true;   // none of the photos carries a reading: nothing to walk
  }
  // Before anything has landed a failed read is an error, as it always was. After, the receipt must still say what landed.
  const stop = why => {
    if (!landed.inserted && !landed.duplicates && walked <= 1) throw new Error(`project-cached: ${why.replaceAll('_', ' ')}`);
    landed.failed++; reason = why;
  };
  while (walked < pages && !(currentIds && !currentIds.length)) {
    let query = sb.from('vehicle_observations').select(SOURCE_COLUMNS)
      .eq('vehicle_id', vehicleId).eq('kind', 'condition').eq('structured_data->>analysis_kind', 'image_deep_byok');
    if (imageIds) query = query.in('id', currentIds);   // currency was decided by currentReadingIds (not superseded, as the database counts it)
    // Keyset on (ingested_at, id): readings that share one instant across a window's edge are not skipped.
    query = cursor ? query.or(`ingested_at.lt."${cursor.at}",and(ingested_at.eq."${cursor.at}",id.lt.${cursor.id})`)
      : query.lt('ingested_at', before);
    const result = await query.order('ingested_at', { ascending: false }).order('id', { ascending: false })
      .limit(limit).abortSignal(signal());
    walked++;
    if (result.error || !Array.isArray(result.data)) { stop('source_query_failed'); break; }
    const sources = result.data.filter(row => row.structured_data?.analysis_kind === 'image_deep_byok' &&
      (!imageIds || imageIds.includes(row.structured_data?.image_id)));
    const ids = [...new Set(sources.map(row => row.structured_data?.image_id).filter(id => UUID.test(id ?? '')))];
    const images = ids.length ? await sb.from('vehicle_images').select(IMAGE_COLUMNS).in('id', ids).abortSignal(signal())
      : { data: [], error: null };
    if (images.error || !Array.isArray(images.data)) { stop('image_query_failed'); break; }
    const byId = new Map(images.data.map(row => [row.id, row]));
    let claims = [];
    for (const source of sources) {
      const projected = projectImageProperties(source, byId.get(source.structured_data.image_id),
        { releaseIntentOnlyClarification: single });
      if (projected.deferred) { defer(projected.deferred); continue; }
      if (single) {
        // The batch intake asks the database whether the SOURCE reading may be shown. This route judges what it would
        // write: the child row, which holds an enum value, ids and a pointer, never the reader's prose. The photo's
        // own eligibility (sensitive, document, mismatch) was judged above. A child that carries anything else, or
        // that the database would not show on its own, is refused.
        let refused = null;
        for (const claim of projected.claims) {
          if (!childCarriesOnlyEnumAndPointers(claim)) { refused = 'child_not_public'; break; }
          let open;
          try { open = await sb.rpc('observation_is_public', { p_kind: claim.kind, p_data: claim.structured_data }).abortSignal(signal()); }
          catch { open = { error: true }; }
          if (!open || open.error) { refused = 'privacy_check_unavailable'; break; }
          if (open.data !== true) { refused = 'child_not_public'; break; }
        }
        if (refused) { defer(refused); continue; }
        if (projected.released_intent_only_clarification) held.released_intent_only_clarification++;
      }
      claims.push(...projected.claims);
    }
    if (single && claims.length) {
      const parents = [...new Set(claims.map(claim => claim.structured_data.source_observation_id))];
      const have = new Map();
      let failed = false;
      for (let i = 0; i < parents.length && !failed; i += 100) {
        const prior = await sb.from('vehicle_observations')
          .select('is_superseded,source_observation_id:structured_data->>source_observation_id,property_key:structured_data->>property_key')
          .eq('vehicle_id', vehicleId).eq('extraction_method', 'cached_byok_property_projection_v1')
          .in('structured_data->>source_observation_id', parents.slice(i, i + 100)).limit(1000).abortSignal(signal());
        if (prior.error || !Array.isArray(prior.data)) { failed = true; break; }
        for (const row of prior.data) {
          const key = `${row.source_observation_id}:${row.property_key}`;
          have.set(key, have.get(key) === true || row.is_superseded === true);
        }
      }
      if (failed) { stop('prior_rows_unavailable'); break; }
      claims = claims.filter(claim => {
        const key = `${claim.structured_data.source_observation_id}:${claim.property_key}`;
        if (!have.has(key)) return true;
        held.already_projected++;
        if (have.get(key)) held.already_projected_superseded++;
        return false;
      });
    }
    counts.sampled_condition_rows += result.data.length; counts.source_rows += sources.length; counts.eligible_claims += claims.length;
    if (apply && (claims.length || (pages === 1 && !single))) {
      const slices = single ? Array.from({ length: Math.ceil(claims.length / SINGLE_SLICE) }, (_, i) => claims.slice(i * SINGLE_SLICE, (i + 1) * SINGLE_SLICE)) : [claims];
      let sent = 0;
      for (const slice of slices) {
        last = await applyImagePropertyClaims(sb, slice, single ? { mode: 'legacy' } : {});
        for (const key of Object.keys(landed)) landed[key] += last[key] || 0;
        sent += slice.length;
        if (last.failed > 0) break;
      }
      if (last.failed > 0) { landed.unattempted += claims.length - sent; reason = last.reason || 'ingest_failed'; break; }
    }
    if (result.data.length < limit) { reachedOldest = true; break; }
    const tail = result.data[result.data.length - 1];
    cursor = { at: tail.ingested_at, id: tail.id };
  }
  // Rows this projection landed before its source reading became a typed key (migration 20261125191500) are re-landed by the
  // database as successors carrying the key, the old row superseded by its successor. Vehicle walk only, after the walk.
  let typedSource = null;
  if (apply && !imageIds && !reason) {
    typedSource = { succeeded: 0, held_source_not_current: 0, remaining: null, calls: 0 };
    while (typedSource.calls < TYPED_SOURCE_CALLS) {
      let out;
      try { out = await sb.rpc('supersede_untyped_cached_image_properties', { p_vehicle_id: vehicleId, p_limit: TYPED_SOURCE_SLICE }).abortSignal(AbortSignal.timeout(40000)); }
      catch { out = { error: true }; }
      typedSource.calls++;
      const d = out?.data;
      if (!out || out.error || !Number.isSafeInteger(d?.succeeded) || !Number.isSafeInteger(d?.remaining) ||
          !Number.isSafeInteger(d?.held_source_not_current)) { landed.failed++; reason = 'typed_source_relink_failed'; break; }
      // succeeded sums over calls; held and remaining are what is left after the last call
      typedSource.succeeded += d.succeeded;
      typedSource.held_source_not_current = d.held_source_not_current; typedSource.remaining = d.remaining;
      if (d.succeeded === 0 || d.remaining === 0) break;
    }
  }
  const summed = single || pages > 1;
  // imageIds: the readings this call judged current for the named photos (ids only), so its caller can say which reading
  // its answer is about
  const receipt = { mode: apply ? 'apply' : 'dry_run', route: single ? 'single' : 'batch', vehicle_id: vehicleId,
    ...(currentIds ? { current_reading_ids: currentIds } : {}),
    ...counts, window_limit: limit, window_before: before, pages_walked: walked, reached_oldest_row: reachedOldest,
    full_history_verified: false, model_calls: 0, deferred, ...(single ? held : {}),
    ...(apply && !summed ? last : {}),
    ...(typedSource ? { typed_source: typedSource } : {}),
    ...(apply && summed ? { ...landed, ...(reason ? { reason } : {}) } : {}),
    ...(apply && !summed && reason === 'typed_source_relink_failed' ? { failed: (last.failed || 0) + 1, reason } : {}),
    ...(!apply && reason ? { failed: landed.failed, reason } : {}) };
  const nothing = apply && counts.eligible_claims === 0 && held.already_projected === 0 && !(typedSource?.succeeded > 0);
  return { receipt, exitCode: receipt.failed > 0 || nothing ? 1 : 0 };
}
