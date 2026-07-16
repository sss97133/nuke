#!/usr/bin/env node
/**
 * process-photo.mjs — per-photo intake step of the daily-receipt loop.
 *
 * For one photo + caller-provided classification, performs:
 *   1. Compute SHA-256 hash for dedup
 *   2. Upload to vehicle-photos storage bucket (idempotent)
 *   3. INSERT into vehicle_images with classification fields (area, part, operation,
 *      image_type, category, caption) so get_daily_work_receipt RPC surfaces it
 *   4. POST atom to ingest-observation with full provenance
 *   5. Print observation_id + vehicle_image_id for downstream tools
 *
 * The vision step (producing the classification JSON) is CALLER-BYOK — done by
 * the LLM in the parent session, not by this script. This script handles the
 * deterministic plumbing only. See docs/library/technical/engineering-manual/17-daily-receipt-processor.md.
 *
 * Usage:
 *   dotenvx run -- node scripts/daily-receipt/process-photo.mjs \
 *     --photo /tmp/apr14-start/20260414_120933_IMG_9419.jpg \
 *     --vehicle-id eeb9fa61-01e8-49a6-8eab-a7cc0e23d30f \
 *     --taken-at 2026-04-14T12:09:33+00:00 \
 *     --source-identifier iphone:IMG_9419.HEIC \
 *     --classification-file /tmp/img9419.json
 *
 * Classification JSON shape (produced by caller-vision step):
 *   {
 *     "scene_class": "exterior_delivery",        // → vehicle_images.image_type + .category
 *     "area": "underbody",                         // → vehicle_images.area
 *     "action": "received_at_shop",                // → vehicle_images.operation
 *     "parts_visible": ["running-pony grille",...],// → vehicle_images.part (first item)
 *     "caption": "Black Mustang on lift...",       // → vehicle_images.caption
 *     "fabrication_stage": "intake",                // → vehicle_images.fabrication_stage
 *     "confidence": 0.95,
 *     "vehicle_match_basis": "running-pony grille emblem",
 *     "ml_labels": ["Building","Bumper","Outdoor"]
 *   }
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { basename } from 'path';
import { execFileSync } from 'child_process';

// Read EXIF identity fields from a photo file via exiftool. Returns null if no make.
function readExif(filePath) {
  try {
    const out = execFileSync('exiftool', [
      '-j', '-n',
      '-Make', '-Model', '-Software', '-LensModel',
      '-DateTimeOriginal', '-DateTimeDigitized', '-CreateDate',
      '-GPSLatitude', '-GPSLongitude', '-GPSAltitude',
      '-FocalLength', '-FNumber', '-ISO', '-ExposureTime', '-Flash',
      '-ImageWidth', '-ImageHeight', '-Orientation',
      '-SerialNumber', '-BodySerialNumber',
      filePath,
    ], { encoding: 'utf-8' });
    const arr = JSON.parse(out);
    const r = arr[0] || {};
    const exif_data = {};
    if (r.Make) exif_data.camera_make = String(r.Make);
    if (r.Model) exif_data.camera_model = String(r.Model);
    if (r.Software) exif_data.software = String(r.Software);
    if (r.LensModel) exif_data.lens_model = String(r.LensModel);
    if (r.FocalLength != null) exif_data.focal_length = r.FocalLength;
    if (r.FNumber != null) exif_data.aperture = r.FNumber;
    if (r.ISO != null) exif_data.iso = r.ISO;
    if (r.ExposureTime != null) exif_data.shutter_speed = r.ExposureTime;
    if (r.Flash != null) exif_data.flash_fired = !!r.Flash;
    if (r.ImageWidth) exif_data.width = r.ImageWidth;
    if (r.ImageHeight) exif_data.height = r.ImageHeight;
    if (r.Orientation) exif_data.orientation = r.Orientation;
    if (r.SerialNumber) exif_data.camera_serial = String(r.SerialNumber);
    if (r.BodySerialNumber && !exif_data.camera_serial) exif_data.camera_serial = String(r.BodySerialNumber);
    if (r.GPSLatitude != null && r.GPSLongitude != null) {
      exif_data.location = { latitude: Number(r.GPSLatitude), longitude: Number(r.GPSLongitude) };
      if (r.GPSAltitude != null) exif_data.location.altitude = Number(r.GPSAltitude);
    }
    return {
      exif_data: Object.keys(exif_data).length > 0 ? exif_data : null,
      datetime_original: r.DateTimeOriginal || r.DateTimeDigitized || r.CreateDate || null,
    };
  } catch (e) {
    return { exif_data: null, datetime_original: null };
  }
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) { console.error('Missing env'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, KEY);

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : null; };

const PHOTO = arg('--photo');
const VEHICLE_ID = arg('--vehicle-id');
const TAKEN_AT = arg('--taken-at');
const SOURCE_ID = arg('--source-identifier') || (PHOTO ? `local:${basename(PHOTO)}` : null);
const CLASSIFICATION_FILE = arg('--classification-file');
const CLASSIFICATION_INLINE = arg('--classification');

if (!PHOTO || !VEHICLE_ID || !TAKEN_AT || (!CLASSIFICATION_FILE && !CLASSIFICATION_INLINE)) {
  console.error('Required: --photo --vehicle-id --taken-at (--classification-file | --classification)');
  process.exit(1);
}

const classification = CLASSIFICATION_FILE
  ? JSON.parse(readFileSync(CLASSIFICATION_FILE, 'utf-8'))
  : JSON.parse(CLASSIFICATION_INLINE);

const fileBuf = readFileSync(PHOTO);
const fileSize = statSync(PHOTO).size;
const sha = createHash('sha256').update(fileBuf).digest('hex');
const ext = PHOTO.split('.').pop().toLowerCase();
const mime = (ext === 'png') ? 'image/png' : 'image/jpeg';
const storagePath = `${VEHICLE_ID}/daily-receipt/${sha.slice(0, 12)}_${basename(PHOTO)}`;

// 1. Dedup check: has this hash already been inserted for this vehicle?
const { data: existing } = await supabase
  .from('vehicle_images')
  .select('id, image_url')
  .eq('vehicle_id', VEHICLE_ID)
  .eq('file_hash', sha)
  .limit(1);

let imageId, imageUrl;
if (existing && existing.length > 0) {
  imageId = existing[0].id;
  imageUrl = existing[0].image_url;
  console.log(`[dedup] vehicle_image ${imageId} already exists for hash ${sha.slice(0,12)}`);
} else {
  // 2. Upload to storage (upsert so we can re-run safely)
  const up = await supabase.storage.from('vehicle-photos')
    .upload(storagePath, fileBuf, { contentType: mime, upsert: true });
  if (up.error) { console.error('upload:', up.error.message); process.exit(2); }
  imageUrl = supabase.storage.from('vehicle-photos').getPublicUrl(storagePath).data.publicUrl;

  // EXIF extraction from disk file — chain-of-custody substrate
  const { exif_data: exifData, datetime_original } = readExif(PHOTO);
  const USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';

  // 3. Insert vehicle_images row with classification fields populated
  const row = {
    vehicle_id: VEHICLE_ID,
    image_url: imageUrl,
    storage_path: storagePath,
    file_name: basename(PHOTO),
    file_hash: sha,
    file_size: fileSize,
    mime_type: mime,
    source: 'daily_receipt',
    taken_at: TAKEN_AT,
    is_external: false,
    ai_processing_status: 'completed',
    // Do NOT auto-bless — see process-photo-cascade.mjs note (privacy incident 2026-05-30).
    vision_gate_status: 'review_needed',
    user_id: USER_ID,
    documented_by_user_id: USER_ID,
    ...(exifData && { exif_data: exifData }),
    ...(exifData?.location?.latitude != null && { latitude: exifData.location.latitude }),
    ...(exifData?.location?.longitude != null && { longitude: exifData.location.longitude }),
    // Classification fields — what the RPC reads:
    area: classification.area || classification.scene_class,
    part: Array.isArray(classification.parts_visible) ? classification.parts_visible.join(', ').slice(0,200) : null,
    operation: classification.action,
    fabrication_stage: classification.fabrication_stage,
    image_type: classification.scene_class,
    category: classification.scene_class,
    caption: classification.caption,
    ai_scan_metadata: {
      classifier: 'caller-byok',
      classifier_model: 'claude-opus-4-7-1m',
      classified_via: 'caller-vision-Read-tool',
      full_classification: classification,
    },
  };
  const ins = await supabase.from('vehicle_images').insert(row).select('id').single();
  if (ins.error) { console.error('insert:', ins.error.message); process.exit(3); }
  imageId = ins.data.id;
  console.log(`[insert] vehicle_image ${imageId}${exifData?.camera_make ? ` (EXIF: ${exifData.camera_make} ${exifData.camera_model})` : ' (no EXIF)'}`);

  // Chain-of-custody: device_attributions row when EXIF identity present
  if (exifData?.camera_make) {
    const fp = `camera:${exifData.camera_make.toLowerCase().replace(/\s+/g,'-')}:${(exifData.camera_model||'unknown').toLowerCase().replace(/\s+/g,'-')}`;
    const { error: attribErr } = await supabase.from('device_attributions').insert({
      image_id: imageId,
      camera_make: exifData.camera_make,
      camera_model: exifData.camera_model || null,
      camera_serial: exifData.camera_serial || null,
      device_fingerprint: fp,
      software: exifData.software || null,
      attribution_source: 'photos_library_daily_receipt',
      extraction_method: 'exiftool_passthrough',
      confidence_score: 100,
      actual_contributor_id: USER_ID,
      uploaded_by_user_id: USER_ID,
      datetime_original: datetime_original ? new Date(datetime_original.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')).toISOString() : (TAKEN_AT || null),
      latitude: exifData.location?.latitude ?? null,
      longitude: exifData.location?.longitude ?? null,
      raw_exif: exifData,
    });
    if (attribErr && !/duplicate|unique/i.test(attribErr.message || '')) {
      console.error(`  device_attribution error: ${attribErr.message}`);
    }
  }
}

// 4. POST atom to ingest-observation (canonical write path)
const obsBody = {
  source_slug: 'photo_pipeline',
  kind: 'media',
  observed_at: TAKEN_AT,
  source_identifier: SOURCE_ID,
  vehicle_id: VEHICLE_ID,
  content_text: classification.caption || classification.description || '',
  structured_data: {
    ...classification,
    vehicle_image_id: imageId,
    file_hash: sha,
  },
  agent_tier: 'caller-byok',
  agent_model: 'claude-opus-4-7-1m',
  extraction_method: 'caller-vision-Read-tool',
  raw_source_ref: PHOTO,
};

const obsResp = await fetch(`${SUPABASE_URL}/functions/v1/ingest-observation`, {
  method: 'POST',
  headers: {
    'apikey': KEY,
    'Authorization': `Bearer ${KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(obsBody),
});
const obsJson = await obsResp.json();
if (!obsJson.success) {
  console.error('ingest-observation:', JSON.stringify(obsJson).slice(0, 300));
  process.exit(4);
}

console.log(JSON.stringify({
  vehicle_image_id: imageId,
  observation_id: obsJson.observation_id,
  storage_path: storagePath,
  taken_at: TAKEN_AT,
  scene: classification.scene_class,
  action: classification.action,
}, null, 2));
