/**
 * Shared identity-first ingest payload for owner-library photo scripts.
 *
 * Sealed capture: hash local bytes, then call ingest_image_identity_first.
 * vehicle_id is intentionally omitted so the leaf is not stamped onto a
 * vehicle at ingest. Album or folder context may be recorded in exif_data
 * as a suggestion for a later visual-identity / capture-set filer — never
 * as an assignment.
 */

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
