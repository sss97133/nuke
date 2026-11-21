/**
 * Shared identity-first ingest payload for owner-library photo scripts.
 *
 * Sealed capture: hash local bytes, then call ingest_image_identity_first.
 * vehicle_id is intentionally omitted so the leaf is not stamped onto a
 * vehicle at ingest. Album or folder context may be recorded in exif_data
 * as a suggestion for a later visual-identity / capture-set filer — never
 * as an assignment.
 */

import { createHash } from 'node:crypto';
import { instantMicros } from './image-property-projection.mjs';

export function buildIdentityFirstPayload({
  contentSha256,
  publicUrl,
  storagePath,
  filename,
  mimeType,
  fileSize,
  userId,
  meta = {},
  albumName = null,
  suggestedVehicleId = null,
  syncedBy,
  source = 'iphoto',
  sourceIdentifier = null,
  sourcePath = null,
  originalFilename = null,
  appleMlLabels = null,
}) {
  if (!contentSha256) throw new Error('contentSha256 is required');
  if (!publicUrl) throw new Error('publicUrl is required');
  if (!storagePath) throw new Error('storagePath is required');
  if (!userId) throw new Error('userId is required');
  if (!syncedBy) throw new Error('syncedBy is required');

  const exifInfo = meta.exif_info || meta.exif_data || {};
  const capturedAt = meta.date_original || exifInfo.date || meta.taken_at || meta.date || null;
  const labels = Array.isArray(appleMlLabels) ? appleMlLabels
    : (Array.isArray(meta.labels) ? meta.labels : null);
  const hasLabels = Array.isArray(labels) && labels.length > 0;

  const payload = {
    content_sha256: contentSha256,
    image_url: publicUrl,
    storage_path: storagePath,
    source,
    source_type: 'local_filesystem',
    source_identifier: sourceIdentifier || meta.uuid || storagePath,
    source_filename: filename,
    original_filename: originalFilename || meta.original_filename || filename,
    owner_verified: true,
    user_id: userId,
    // vehicle_id omitted — server pipeline files after visual identity
    mime_type: mimeType,
    file_size_bytes: fileSize,
    exif_data: {
      ...exifInfo,
      ...(meta.uuid && { uuid: meta.uuid }),
      original_filename: originalFilename || meta.original_filename || filename,
      synced_by: syncedBy,
      ...(albumName && { album_name: albumName }),
      ...(suggestedVehicleId && { suggested_vehicle_id: suggestedVehicleId }),
      ...(meta.location_name && { place_name: meta.location_name }),
      ...(meta.place?.name && { place_name: meta.place.name }),
      ...(hasLabels && { labels_source: 'apple_photos_on_device_media_analysis_via_osxphotos' }),
    },
  };

  if (sourcePath || meta.path) payload.source_path = sourcePath || meta.path;
  if (meta.original_width != null) payload.width_px = meta.original_width;
  if (meta.original_height != null) payload.height_px = meta.original_height;
  if (exifInfo.camera_make) payload.camera_make = exifInfo.camera_make;
  if (exifInfo.camera_model) payload.camera_model = exifInfo.camera_model;
  if (capturedAt) payload.taken_at = capturedAt;
  if (meta.latitude != null) payload.gps_latitude = meta.latitude;
  if (meta.longitude != null) payload.gps_longitude = meta.longitude;
  if (hasLabels) payload.apple_ml_labels = labels;

  if (Object.prototype.hasOwnProperty.call(payload, 'vehicle_id')) {
    throw new Error('identity-first payload must not stamp vehicle_id');
  }
  return payload;
}

export function personalLibraryStoragePath(userId, scriptSlug, filename) {
  if (!userId) throw new Error('userId is required');
  if (!scriptSlug) throw new Error('scriptSlug is required');
  if (!filename) throw new Error('filename is required');
  if (scriptSlug.includes('/') || scriptSlug.includes('..')) {
    throw new Error('scriptSlug must be a single path segment');
  }
  return `users/${userId}/${scriptSlug}/${filename}`;
}

// Recheck the dependencies of an already admitted reviewed filing. This does
// not authorize a new filing or turn inferred visual correspondence into ownership.
export function reviewedFilingCurrent({ row, audit, proof, classification, anchors, vehicle, sourceId }) {
  const current = o => o && o.is_superseded === false && o.superseded_by === null;
  const timeEqual = (a, b) => instantMicros(a) !== null && instantMicros(a) === instantMicros(b);
  const same = (a, b) => JSON.stringify(stableJson(a)) === JSON.stringify(stableJson(b));
  const usableImage = i => current(i) && i.is_sensitive === false && !i.is_duplicate &&
    !i.is_document && !i.doc_flag && !['mismatch', 'unrelated'].includes(i.image_vehicle_match_status);
  const body = proof?.structured_data, cls = classification?.structured_data?.classification;
  if (!sourceId || !vehicle || vehicle.id !== row.vehicle_id || vehicle.deleted_at !== null || vehicle.merged_into_vehicle_id !== null ||
    !usableImage(row) || !['approved', 'pending'].includes(row.vision_gate_status ?? 'pending') ||
    !audit || audit.observation_type !== 'image' || audit.old_vehicle_id !== null ||
    audit.new_vehicle_id !== row.vehicle_id || audit.old_observation_id !== row.id || audit.new_observation_id !== row.id ||
    !current(proof) || proof.source_id !== sourceId || proof.kind !== 'media' ||
    proof.vehicle_id !== null || proof.analysis_deferred !== true || !proof.agent_model ||
    proof.extraction_method !== 'reviewed_image_attribution_v1' || proof.extraction_metadata?.is_inferred !== true ||
    audit.reason !== `first_attribution: reviewed_image_attribution_v1; proof_observation_id=${proof.id}; signal=reviewed_visual_chain` ||
    proof.source_url !== row.image_url || body?.contract !== 'reviewed_image_attribution_v1' ||
    body.source_image_id !== row.id || body.source_sha256 !== row.file_hash || body.target_vehicle_id !== row.vehicle_id ||
    !same(body.contradictions, []) || body.global_novelty_asserted !== false ||
    !['visual_correspondence', 'visual_sequence'].includes(body.basis) || !body.candidate_scope ||
    !current(classification) || classification.source_id !== sourceId || classification.vehicle_id !== null ||
    classification.analysis_deferred !== true || classification.extraction_method !== 'supplied_image_classification_v1' ||
    body.classification_observation_id !== classification.id || classification.source_url !== row.image_url ||
    classification.structured_data?.source_image_id !== row.id || row.ai_processing_status !== 'completed' ||
    row.ai_scan_metadata?.classification_review?.observation_id !== classification.id ||
    row.ai_scan_metadata?.classification_review?.source_identifier !== classification.source_identifier ||
    !same(cls, row.ai_scan_metadata?.classification) || cls?.classifier_ok !== true || cls.is_automotive !== true ||
    cls.image_medium !== 'photograph' || cls.v2?.is_document !== false || !same(cls.v2?.vehicle_fields, []) || cls.v2?.vin != null)
    return false;
  const review = row.ai_scan_metadata.classification_review, read = classification.extraction_metadata?.source;
  const { observation_id: _id, source_identifier: _identifier, ...reviewSource } = review;
  if (!same(reviewSource, read) || read?.image_url !== row.image_url || read.reviewed_url !== row.image_url ||
    read.reviewed_sha256 !== row.file_hash) return false;
  if (!Array.isArray(body.anchors) || body.anchors.length < 1 || body.anchors.length > 8 ||
    new Set(body.anchors.map(a => a.image_id)).size !== body.anchors.length ||
    !Array.isArray(body.correspondences) || body.correspondences.length !== body.anchors.length) return false;
  return body.anchors.every(ref => {
    const anchor = anchors.find(a => a.id === ref.image_id);
    const comparisons = body.correspondences.filter(c => c.anchor_image_id === ref.image_id);
    if (!usableImage(anchor) || anchor.id === row.id || anchor.user_id !== row.user_id ||
      anchor.vehicle_id !== row.vehicle_id || (anchor.vision_gate_status ?? 'approved') !== 'approved' ||
      anchor.image_url !== ref.source_url || anchor.file_hash !== ref.source_sha256 ||
      !/^[0-9a-f]{64}$/.test(anchor.file_hash) || !timeEqual(anchor.taken_at, ref.taken_at) || comparisons.length !== 1)
      return false;
    const c = comparisons[0], features = c.features;
    if (!Array.isArray(features) || features.length < 2 || features.length > 12 ||
      (body.basis === 'visual_sequence' && !c.sequence_context)) return false;
    const kinds = new Set(features.map(f => f.kind));
    return kinds.size >= 2 && ['identifier', 'body_geometry', 'component_geometry', 'fixed_wear'].some(k => kinds.has(k)) &&
      features.every(f => ['identifier', 'body_geometry', 'component_geometry', 'fixed_wear', 'configuration', 'work_state'].includes(f.kind) &&
        typeof f.source_witness === 'string' && f.source_witness.trim() && f.source_witness.length <= 2000 &&
        typeof f.anchor_witness === 'string' && f.anchor_witness.trim() && f.anchor_witness.length <= 2000);
  });
}

function stableJson(value) {
  return Array.isArray(value) ? value.map(stableJson) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stableJson(value[key])])) : value;
}

async function loadReviewedFiling(sb, row) {
  const result = async query => {
    const { data, error } = await query;
    if (error) throw new Error(`filing_read_failed: ${error.message}`);
    return data;
  };
  const [audits, sources, vehicles] = await Promise.all([
    result(sb.from('reattribution_audit').select('*').eq('old_observation_id', row.id)
      .eq('observation_type', 'image').order('created_at', { ascending: false }).limit(1)),
    result(sb.from('observation_sources').select('id').eq('slug', 'photo_pipeline').limit(1)),
    result(sb.from('vehicles').select('id,deleted_at,merged_into_vehicle_id').eq('id', row.vehicle_id).limit(1)),
  ]);
  const audit = audits[0], sourceId = sources[0]?.id, vehicle = vehicles[0];
  const proofId = audit?.reason?.match(/^first_attribution: reviewed_image_attribution_v1; proof_observation_id=([0-9a-f-]{36}); signal=reviewed_visual_chain$/)?.[1];
  if (!proofId) return { audit, sourceId, vehicle };
  const observations = ids => result(sb.from('vehicle_observations')
    .select('id,source_id,kind,vehicle_id,is_superseded,superseded_by,analysis_deferred,agent_model,extraction_method,extraction_metadata,structured_data,source_url,source_identifier')
    .in('id', ids).limit(2));
  const proof = (await observations([proofId]))[0];
  const body = proof?.structured_data;
  if (!body?.classification_observation_id || !Array.isArray(body.anchors) || body.anchors.length > 8)
    return { audit, sourceId, vehicle, proof };
  const [classifications, anchors] = await Promise.all([
    observations([body.classification_observation_id]),
    result(sb.from('vehicle_images').select('id,user_id,vehicle_id,image_url,file_hash,taken_at,is_sensitive,is_superseded,superseded_by,is_duplicate,is_document,doc_flag,vision_gate_status,image_vehicle_match_status')
      .in('id', body.anchors.map(a => a.image_id)).limit(8)),
  ]);
  return { audit, sourceId, vehicle, proof, classification: classifications[0], anchors };
}

/** Read-only source-fact export for the existing reviewed intake plan.
 * The version identifies a retained capture, NEVER the current PhotoKit original.
 * A vehicle_id is a recorded filing, not sufficient proof of a complete filing.
 */
export async function reconcileReviewedRenditions(sb, plan, { userId, readBytes,
  observedAt = new Date().toISOString(), deadlineMs = 120000, loadFiling = loadReviewedFiling,
} = {}) {
  await ingestReviewedRenditions(sb, plan, { userId, readBytes, apply: false });
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const hash = value => createHash('sha256').update(value).digest('hex');
  const digest = value => hash(JSON.stringify(canonical(value)));
  if (!Number.isFinite(Date.parse(observedAt)) || !Number.isFinite(deadlineMs) || deadlineMs <= 0 || deadlineMs > 120000)
    throw new Error('invalid_reconciliation_bounds');
  const started = Date.now(), sourceNamespace = `retained-photos-capture:${userId}`;
  const assets = [], sourceFacts = {};
  for (const r of plan.records) {
    if (Date.now() - started >= deadlineMs) throw new Error('source_reconciliation_deadline');
    const p = r.payload.p_payload, sid = p.source_identifier.toLowerCase();
    const version = digest(p.source_provenance);
    assets.push({ id: sid, sourceVersion: version, mediaKind: 'image', captureAt: p.taken_at,
      captureClockBasis: p.source_provenance.clock_basis, latitude: null, longitude: null });
    const fact = { sourceVersion: version, selectedForAdmission: false,
      rendition: { sourceVersion: version, sha256: p.content_sha256,
        byteSize: p.file_size_bytes, mimeType: p.mime_type },
      privacy: { status: 'clear', sourceVersion: version, intendedUse: 'vehicle_gallery',
        decisionId: `supplied-privacy-review:${digest(r.privacy_review)}`, basis: 'supplied_review',
        review: r.privacy_review },
      currentLibraryVersion: 'unknown', originalStatus: 'unverified',
      retainedProvenance: p.source_provenance };
    sourceFacts[sid] = fact;
    const read = async () => {
      const result = await sb.from('vehicle_images').select(
        'id,user_id,vehicle_id,source,file_hash,file_size,mime_type,image_url,storage_path,taken_at,exif_data,ai_scan_metadata,is_superseded,superseded_by,is_sensitive,updated_at,ai_processing_status,is_duplicate,is_document,doc_flag,vision_gate_status,image_vehicle_match_status')
        .eq('user_id', userId).eq('source', 'iphoto').eq('file_hash', p.content_sha256).limit(2);
      if (result.error) throw new Error(`source_read_failed: ${result.error.message}`);
      if (!Array.isArray(result.data) || result.data.length > 1) throw new Error('ambiguous_rendition');
      return result.data[0];
    };
    const row = await read();
    if (!row) continue;
    if (row.user_id !== userId || row.source !== 'iphoto' || row.file_hash !== p.content_sha256 ||
      row.file_size !== p.file_size_bytes || row.mime_type !== p.mime_type ||
      row.image_url !== p.image_url || row.storage_path !== p.storage_path ||
      instantMicros(row.taken_at) === null || instantMicros(row.taken_at) !== instantMicros(p.taken_at) ||
      digest(row.exif_data?.source_rendition ?? null) !== version ||
      row.ai_scan_metadata?.processing_policy?.mode !== 'subscription_review' ||
      row.is_superseded !== false || row.superseded_by !== null || row.is_sensitive !== false)
      throw new Error('existing_rendition_conflict');
    const downloaded = await sb.storage.from(r.storage_bucket).download(r.storage_path);
    if (downloaded.error || !downloaded.data) throw new Error('stored_rendition_unavailable');
    const bytes = Buffer.from(await downloaded.data.arrayBuffer());
    if (bytes.length !== p.file_size_bytes || hash(bytes) !== p.content_sha256)
      throw new Error('stored_rendition_changed');
    const evidence = row.vehicle_id ? await loadFiling(sb, row) : null;
    // A source changed while its bytes/dependencies were read cannot qualify this snapshot.
    if (digest(await read() ?? null) !== digest(row)) throw new Error('source_changed_during_reconciliation');
    fact.existingLeaf = { imageId: row.id, sourceNamespace, sourceId: sid, sourceVersion: version,
      byteRole: 'rendition', sha256: p.content_sha256, visibility: 'current', isSuperseded: false,
      supersededBy: null, sourceBindingId: `vehicle_images:${row.id}:source_rendition:${version}` };
    fact.readback = { startedAt: observedAt, finishedAt: new Date().toISOString(),
      atomic: false, rowSha256: digest(row), storedBytesVerified: true };
    fact.filing = { status: row.vehicle_id ? 'partial' : 'none', sourceVersion: version,
      recordedVehicleId: row.vehicle_id ?? null, basis: 'current_leaf_vehicle_id_only' };
    if (evidence) {
      fact.filingEvidence = { row, ...evidence };
      if (reviewedFilingCurrent({ row, ...evidence })) {
        fact.filing = { ...fact.filing, status: 'supported_complete', sourceNamespace, sourceId: sid,
          imageId: row.id, intendedUse: 'vehicle_gallery', decisionId: evidence.audit.id,
          witnessId: evidence.proof.id, basis: 'current_reviewed_visual_correspondence',
          inferred: true, evidenceSha256: digest(evidence) };
      } else if (evidence.proof) {
        fact.filing.status = 'disputed';
        fact.filing.basis = 'reviewed_filing_dependency_changed';
      }
    }
  }
  if (Date.now() - started >= deadlineMs) throw new Error('source_reconciliation_deadline');
  assets.sort((a, b) => a.id.localeCompare(b.id));
  return { schemaVersion: 1, intendedUse: 'vehicle_gallery', snapshot: {
    snapshotId: `retained-captures:${digest(assets)}`, sourceNamespace, observedAt, accessScope: 'sample',
    sourceScope: 'retained_capture', sourceVersionBasis: 'retained_provenance_sha256',
    declaredAssetCount: assets.length, mediaCoverage: { imagesEnumerated: true,
      videosEnumerated: false, knownVideosOutsideSelector: 0 }, assets },
    sourceFacts, candidates: [], priorSourceIds: [] };
}

/** Bounded replay of locally reviewed cached renditions through the same writer.
 * No classifier, vehicle assignment, original-byte claim or sync watermark.
 * Every replay rechecks the canonical row; a checkpoint is never proof of intake.
 */
export async function ingestReviewedRenditions(sb, plan, {
  userId, readBytes, apply = false, record = async () => {},
} = {}) {
  const fail = message => { throw new Error(message); };
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const started = Date.now();
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value ?? '');
  if (!uuid(userId) || !Array.isArray(plan?.records) || !plan.records.length || plan.records.length > 25) fail('invalid_reviewed_plan');
  const seen = new Set(), units = [];
  // Validate every local byte and disposition before any network mutation.
  for (const r of plan.records) {
    const p = r.payload?.p_payload, v = p?.source_provenance;
    if (!p || p.user_id !== userId || p.processing_mode !== 'subscription_review' ||
      p.source !== 'iphoto' || p.source_type !== 'local_filesystem' || p.owner_verified !== false ||
      p.vehicle_id != null || !uuid(p.source_identifier) || p.mime_type !== 'image/jpeg' ||
      v?.contract !== 'photos_cached_preview_v1' || v.rendition_kind !== 'cached_preview' ||
      !uuid(v.photos_asset_uuid) || v.photos_asset_uuid.toLowerCase() !== p.source_identifier.toLowerCase() ||
      v.rendition_sha256 !== p.content_sha256 ||
      r.privacy_review?.disposition !== 'publishable_work_evidence' ||
      r.privacy_review?.source_sha256 !== p.content_sha256 || !r.privacy_review?.reviewer ||
      !Number.isFinite(Date.parse(r.privacy_review?.reviewed_at)) ||
      r.local_cached_preview !== p.source_path) fail('invalid_reviewed_source');
    const identity = p.source_identifier.toLowerCase();
    if (seen.has(identity)) fail('duplicate_source_in_plan');
    seen.add(identity);
    const bytes = await readBytes(r.local_cached_preview);
    if (sha(bytes) !== p.content_sha256 || bytes.length !== p.file_size_bytes) fail('local_rendition_changed');
    const path = `users/${userId}/iphoto/previews/${p.source_identifier}/${p.content_sha256}.jpeg`;
    if (r.storage_bucket !== 'vehicle-photos' || r.storage_upsert !== false ||
      r.storage_path !== path || p.storage_path !== path) fail('invalid_rendition_storage');
    const { data: { publicUrl } } = sb.storage.from('vehicle-photos').getPublicUrl(path);
    if (p.image_url !== publicUrl) fail('invalid_rendition_url');
    units.push({ r, p, bytes, path });
  }
  if (!apply) return { mode: 'dry_run', sources: units.length, uploaded: 0, admitted: 0, model_calls: 0 };
  // The new overload refuses this empty proof before any write. Older servers
  // lack the overload: stop before uploading rather than silently ignoring mode.
  const probe = await sb.rpc('attribute_testimony', { p_image_id: null, p_proof_observation_id: null, p_expected_source: {} });
  if (!probe.error?.message?.includes('invalid_reviewed_filing_proof')) fail('reviewed_intake_not_deployed');
  const results = [];
  for (const { p, bytes, path } of units) {
    if (Date.now() - started > 15 * 60 * 1000) fail('reviewed_intake_deadline');
    const lookup = async () => {
      const { data, error } = await sb.from('vehicle_images')
        .select('id,user_id,file_hash,image_url,storage_path,taken_at,exif_data,ai_scan_metadata,is_superseded,superseded_by,is_sensitive')
        .eq('user_id', userId).eq('source', 'iphoto').eq('file_hash', p.content_sha256).limit(2);
      if (error) fail(`source_read_failed: ${error.message}`);
      if (data.length > 1) fail('ambiguous_rendition');
      const row = data[0];
      if (row && (row.is_superseded || row.superseded_by || row.is_sensitive ||
        row.image_url !== p.image_url || row.storage_path !== path ||
        row.exif_data?.source_rendition?.photos_asset_uuid?.toLowerCase() !== p.source_identifier.toLowerCase() ||
        row.exif_data?.source_rendition?.rendition_sha256 !== p.content_sha256 ||
        row.ai_scan_metadata?.processing_policy?.mode !== 'subscription_review' ||
        instantMicros(row.taken_at) === null || instantMicros(row.taken_at) !== instantMicros(p.taken_at) ||
        JSON.stringify(canonical(row.exif_data?.source_rendition)) !== JSON.stringify(canonical(p.source_provenance)))) fail('existing_rendition_conflict');
      return row;
    };
    let row = await lookup();
    if (!row) {
      await record({ source_identifier: p.source_identifier, sha256: p.content_sha256, phase: 'upload_intent' });
      const bucket = sb.storage.from('vehicle-photos');
      const uploaded = await bucket.upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
      if (uploaded.error) {
        // Storage may have committed before a transport failure. Verify exact
        // bytes before admitting its URL; never trust an "already exists" string.
        const existing = await bucket.download(path);
        if (existing.error || !existing.data || sha(Buffer.from(await existing.data.arrayBuffer())) !== p.content_sha256)
          fail('storage_write_unverified');
      }
      await record({ source_identifier: p.source_identifier, sha256: p.content_sha256, phase: 'admission_intent' });
      const response = await sb.rpc('ingest_image_identity_first', { p_payload: p });
      // An ambiguous response is reconciled before another request can occur.
      row = await lookup();
      if (!row) fail(`admission_unverified: ${response.error?.message ?? 'missing canonical row'}`);
      if (response.data?.image_id && response.data.image_id !== row.id) fail('admission_identity_mismatch');
    }
    const result = { source_identifier: p.source_identifier, sha256: p.content_sha256, image_id: row.id,
      phase: 'source_verified', classification_verified: false, filing_verified: false, consumer_verified: false };
    await record(result);
    results.push(result);
  }
  return { mode: 'apply', sources: units.length, results, model_calls: 0 };
}
