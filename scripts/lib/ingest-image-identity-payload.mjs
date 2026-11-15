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
