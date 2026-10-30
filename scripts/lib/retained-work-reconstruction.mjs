/**
 * Reconstruct a reviewable work model from captured existing records. This is an
 * extraction/read model, not an intake writer, Sign, invoice or execution ledger.
 * Every extracted value keeps its observation and JSON pointer. Source labels,
 * billing states and visual appearances never become physical completion.
 */
import { createHash } from 'node:crypto';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pointerKey = key => String(key).replaceAll('~', '~0').replaceAll('/', '~1');
export function atPointer(value, pointer) {
  if (pointer === '') return value;
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) throw new Error('invalid_source_pointer');
  return pointer.slice(1).split('/').reduce((current, key) => {
    const name = key.replaceAll('~1', '/').replaceAll('~0', '~');
    return current != null && Object.hasOwn(current, name) ? current[name] : undefined;
  }, value);
}

function uniqueRecords(rows, name) {
  if (!Array.isArray(rows)) throw new Error(`missing_${name}`);
  const records = new Map();
  for (const row of rows) {
    if (!object(row) || !text(row.id)) throw new Error(`invalid_${name}_record`);
    if (records.has(row.id) && digest(records.get(row.id)) !== digest(row)) throw new Error('source_revision_conflict');
    records.set(row.id, row);
  }
  return [...records.values()];
}

function observationRef(observation, pointer) {
  if (atPointer(observation, pointer) === undefined) throw new Error('missing_source_value');
  return { table: 'vehicle_observations', id: observation.id, pointer,
    sourceId: observation.source_id ?? null, eventAt: observation.observed_at ?? null,
    recordedAt: observation.ingested_at ?? null, method: observation.extraction_method ?? null,
    recordSha256: digest(observation) };
}

function coverageFor(input, key, count) {
  const declared = input.coverage?.[key];
  if (declared?.complete === true) return { state: declared.count !== undefined && declared.count !== count
    ? 'capture_population_mismatch' : 'complete_for_declared_selection', records: count };
  const limit = input.limits?.[key];
  return { state: Number.isInteger(limit) && count > limit ? 'incomplete_page' : 'not_assessed', records: count };
}

export function reconstructRetainedWork(input) {
  if (!object(input) || input.schemaVersion !== 'technician_evidence_capture_v1' || !text(input.vehicle?.id)) {
    throw new Error('invalid_capture');
  }
  const vehicleId = input.vehicle.id;
  const workOrders = uniqueRecords(input.workOrders, 'work_orders');
  if (workOrders.some(order => order.vehicle_id !== vehicleId)) throw new Error('foreign_work_order');
  const sources = uniqueRecords(input.workRecords, 'work_records');
  const eligible = sources.filter(source => source.vehicle_id === vehicleId && source.kind === 'work_record'
    && source.is_superseded === false);
  const eligibleIds = new Set(eligible.map(source => source.id));
  const excluded = sources.filter(source => !eligibleIds.has(source.id)).map(source => ({ id: source.id,
    reason: source.vehicle_id !== vehicleId ? 'different_vehicle' : source.kind !== 'work_record' ? 'different_kind'
      : source.is_superseded === true ? 'superseded_source' : 'currentness_unestablished' }));
  const scope = new Map();
  const paymentReports = [];
  const obligations = [];
  const context = input.ownerContext ?? { sources: [], claims: [] };
  if (!Array.isArray(context.claims)) throw new Error('invalid_owner_context_claims');
  const contextSources = new Map(uniqueRecords(context.sources, 'owner_context_sources').map(source => [source.id, source]));
  const reportedRelationships = [];
  for (const claim of context.claims) {
    const source = contextSources.get(claim.basisSourceId);
    if (!['ownership_period', 'delivery_obligation', 'technician_role'].includes(claim.relationship)
      || claim.vehicleId !== vehicleId || !source || !text(source.text) || !text(claim.basisExcerpt)
      || !source.text.includes(claim.basisExcerpt)) throw new Error('unsupported_owner_context_claim');
    reportedRelationships.push({ claim, assurance: 'reviewed_owner_answer_not_authenticated_sign',
      source: { id: source.id, kind: 'owner_answer', exactExcerpt: claim.basisExcerpt,
        recordedAt: source.recordedAt ?? null, recordSha256: digest(source), retainedSource: source.retainedSource ?? null },
      admission: 'not_written_to_canonical_relationships' });
  }
  for (const source of eligible) {
    const data = object(source.structured_data) ? source.structured_data : {};
    // These are recorded build/billing entries. A noun such as "spark plugs"
    // does not become an installation, and a supplier does not become a performer.
    if (data.subject === 'client_billing_line' && text(data.log) && Number.isInteger(data.row) && text(data.item)) {
      const locator = JSON.stringify([data.log, data.row]);
      const entry = scope.get(locator) ?? { documentLabel: data.log, row: data.row, interpretations: [] };
      const fields = ['item', 'category', 'supplier', 'client', 'billing_column', 'billing_status', 'billing_split', 'labor_minutes'];
      entry.interpretations.push({ sourceObservationId: source.id,
        claims: Object.fromEntries(fields.filter(key => Object.hasOwn(data, key)).map(key => [key, {
          value: data[key], source: observationRef(source, `/structured_data/${pointerKey(key)}`),
        }])),
        execution: 'not_established_by_billing_entry',
        minutesBasis: 'recorded_log_value_not_measured_duration',
        jobBinding: { state: workOrders.length ? 'candidate_same_vehicle_only' : 'unbound_work_scope',
          candidateWorkOrderIds: workOrders.map(order => order.id) },
      });
      scope.set(locator, entry);
    }
    if (text(data.payment_status)) paymentReports.push({ value: data.payment_status,
      source: observationRef(source, '/structured_data/payment_status'),
      assurance: data.trust === 'owner_stated' ? 'retained_owner_report' : 'retained_source_report',
      client: text(data.client) ? { value: data.client, source: observationRef(source, '/structured_data/client') } : null,
      authenticatedPaymentWitness: false });
    if (text(data.obligation)) obligations.push({ kind: data.obligation,
      source: observationRef(source, '/structured_data/obligation'),
      narrative: text(source.content_text) ? { value: source.content_text, source: observationRef(source, '/content_text') } : null,
      assurance: data.trust === 'owner_stated' ? 'retained_owner_report' : 'retained_source_report',
      client: text(data.client) ? { value: data.client, source: observationRef(source, '/structured_data/client') } : null,
      performerActorId: null, performerBinding: 'requires_sourced_party_relationship',
      fulfillment: 'not_inferred_from_payment_or_job_status',
      candidateWorkOrderIds: workOrders.map(order => order.id) });
  }

  const images = uniqueRecords(input.images, 'images');
  const imageBacklog = [];
  const appearances = [];
  const failedStates = new Set(['failed', 'error', 'permanent_failure']);
  for (const image of images) {
    if (image.vehicle_id !== vehicleId || image.is_superseded === true || image.is_duplicate === true) {
      imageBacklog.push({ imageId: image.id, state: 'excluded_image', reason: 'subject_or_currentness' }); continue;
    }
    const metadata = object(image.ai_scan_metadata) ? image.ai_scan_metadata : {};
    const key = object(metadata.byok_deep_analysis) ? 'byok_deep_analysis'
      : object(metadata.deep_analysis) ? 'deep_analysis' : null;
    const analysis = key ? metadata[key] : null;
    const processing = image.ai_processing_status ?? null;
    const mismatch = ['mismatch', 'unrelated'].includes(image.image_vehicle_match_status)
      || String(image.vision_gate_status || '').startsWith('rejected');
    const attribution = mismatch ? 'attribution_rejected' : image.vision_gate_status !== 'approved' ? 'attribution_review' : 'approved';
    // Analysis availability and attribution are separate dimensions: completed
    // processing does not mean approved attribution, nor a fulfilled work order.
    const analysisState = failedStates.has(processing) ? 'processing_failed'
      : analysis ? 'retained_analysis_available' : processing === 'completed' ? 'completed_without_retained_analysis'
        : 'analysis_pending';
    imageBacklog.push({ imageId: image.id, capturedAt: image.taken_at ?? null, addedAt: image.created_at ?? null,
      processingState: processing, analysisState, attributionState: attribution,
      retainedAnalysisAvailable: !!analysis,
      componentSchema: !analysis ? 'no_analysis' : Array.isArray(analysis.components_seen)
        ? 'retained_array' : 'missing_or_malformed',
      workAttribution: 'not_established', source: { table: 'vehicle_images', id: image.id, recordSha256: digest(image) } });
    if (analysis && Array.isArray(analysis.components_seen)) {
      analysis.components_seen.forEach((claim, index) => appearances.push({ imageId: image.id,
        rawClaim: claim, source: { table: 'vehicle_images', id: image.id,
          pointer: `/ai_scan_metadata/${key}/components_seen/${index}`, recordSha256: digest(image) },
        attributionState: attribution, physicalInstance: 'unresolved', operationPerformed: 'not_established' }));
    }
  }

  const imageContext = input.imageObjects;
  if (imageContext != null && (!object(imageContext) || imageContext.vehicle_id !== vehicleId
    || !workOrders.some(order => order.id === imageContext.work_order_id)
    || imageContext.job_attribution !== 'vehicle_context_only'
    || !Array.isArray(imageContext.frames))) throw new Error('invalid_image_job_context');
  const frames = new Map();
  for (const frame of imageContext?.frames ?? []) {
    if (!text(frame.observation_id) || !text(frame.image_id) || !Array.isArray(frame.sightings)) throw new Error('invalid_image_frame');
    if (frames.has(frame.observation_id) && digest(frames.get(frame.observation_id)) !== digest(frame)) throw new Error('image_source_revision_conflict');
    frames.set(frame.observation_id, frame);
  }

  return {
    schemaVersion: 'retained_work_reconstruction_v1', stage: 'private_source_reconstruction_for_review',
    vehicle: input.vehicle, capturedAt: input.capturedAt ?? null,
    workOrders: workOrders.map(order => ({ id: order.id, recordedStatus: order.status,
      recordedCompletionAt: order.completed_at ?? null,
      partyReferences: { customerAccountId: order.customer_id ?? null, requestingActorId: order.requesting_actor_id ?? null,
        leadActorId: order.lead_actor_id ?? null },
      fulfillment: 'requires_scoped_execution_acceptance_and_delivery_evidence',
      source: { table: 'work_orders', id: order.id, recordSha256: digest(order) } })),
    ownershipPeriods: (input.ownershipPeriods ?? []).filter(period => period.vehicle_id === vehicleId).map(period => ({ recorded: period,
      source: { table: 'vehicle_ownerships', id: period.id, recordSha256: digest(period) } })),
    scopeEntries: [...scope.values()].map(entry => ({ ...entry,
      sourceState: entry.interpretations.length === 1 ? 'one_retained_interpretation' : 'multiple_retained_interpretations' })),
    reportedRelationships, paymentReports, obligations, imageBacklog, appearances,
    imageContext: { workOrderId: imageContext?.work_order_id ?? null, jobAttribution: imageContext?.job_attribution ?? 'not_read',
      observations: frames.size, distinctImages: new Set([...frames.values()].map(frame => frame.image_id)).size,
      sightings: [...frames.values()].reduce((sum, frame) => sum + frame.sightings.length, 0),
      coverage: imageContext?.coverage ?? { state: 'not_read', reason: 'no_job_context_supplied' },
      interpretation: 'Repeated sightings are retained evidence, not unique parts, measured labor or completed operations.' },
    coverage: { selection: input.selection, workRecords: { ...coverageFor(input, 'workRecords', sources.length), eligibleRecords: eligible.length },
      excludedWorkRecords: excluded, rawWorkRecords: sources.length,
      selectedImages: coverageFor(input, 'images', images.length),
      realWorldWorkPopulation: 'not_assessed' },
    effects: { databaseWrites: false, canonicalJobsCreated: false, operationsCompleted: false,
      identityClaimsApproved: false, paidInference: false, moneyMoved: false },
  };
}
