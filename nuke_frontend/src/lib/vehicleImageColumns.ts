import { supabase } from './supabase';

// Precise location, EXIF and device columns of vehicle_images are not granted to anon (privacy: no exact places or
// device identifiers to visitors); a signed-out read must name only the granted columns, or PostgREST refuses it.
export const VEHICLE_IMAGE_ANON_EXCLUDED_COLUMNS = [
  'latitude', 'longitude', 'location_name', 'location_confidence', 'exif_data', 'device_fingerprint', 'documented_by_device',
] as const;

export const VEHICLE_IMAGE_PUBLIC_COLUMNS = 'id, vehicle_id, user_id, image_url, image_type, category, position, caption, is_primary, created_at, updated_at, timeline_event_id, image_context, file_hash, file_name, file_size, taken_at, source, source_url, is_external, mime_type, is_sensitive, sensitive_type, storage_path, safe_preview_url, process_stage, workflow_role, area, part, damage_type, operation, materials, labels, task_id, event_id, angle, perspective, thumbnail_url, medium_url, large_url, optimization_status, optimized_at, variants, spatial_tags, ai_scan_metadata, ai_last_scanned, ai_component_count, ai_avg_confidence, filename, temp_session_id, is_approved, approved_by, approved_at, imported_by, ghost_user_id, verification_status, pending_submission_id, image_category, approval_status, submitted_by, redaction_level, redacted_by, redacted_at, redaction_reason, uploaded_at, analysis_history, context_score, processing_models_used, total_processing_cost, rotation, document_classification, is_document, document_category, manual_priority, display_order, user_tags, user_notes, ai_processing_status, ai_processing_started_at, ai_processing_completed_at, ai_suggestions, organization_status, organized_at, ai_detected_vehicle, ai_detected_angle, ai_detected_angle_confidence, suggested_vehicle_id, perceptual_hash, dhash, duplicate_of, is_duplicate, documented_by_user_id, photographer_attribution, user_confirmed_vehicle, user_confirmed_vehicle_by, user_confirmed_vehicle_at, auto_suggested_vehicle_id, auto_suggestion_confidence, auto_suggestion_reasons, angle_confidence, yaw_deg, yaw_confidence, angle_source, bbox, doc_flag, doc_confidence, components, vehicle_vin, vehicle_vin_confidence, vehicle_make, vehicle_model, vehicle_year, vehicle_confidence, vehicle_source, stale, last_rerun_at, tags, ai_extractions, ai_extraction_consensus, phash, condition_score, damage_flags, modification_flags, photo_quality_score, vision_analyzed_at, vision_model_version, surface_coord_v, surface_coord_u, camera_pose, vehicle_zone, zone_confidence, yono_queued_at, interior_quality, zone_source, fabrication_stage, stage_confidence, duration_seconds, video_codec, video_resolution, is_video, image_vehicle_match_status, image_medium, apple_ml_labels, vehicle_score, upload_batch_id, work_session_id, merged_from_vehicle_id, vision_gate_status, vision_gate_processed_at, vision_gate_agent_reasoning, vision_gate_attribution_confidence, is_superseded, superseded_by, superseded_at, ai_retry_count, image_identity_id';

// An unknown session counts as signed out, so the read asks only for anon-granted columns.
async function signedIn(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return !!data?.session;
  } catch {
    return false;
  }
}

/** Columns for a full vehicle_images row as the current viewer may read it (typed as the full row; signed-out rows lack the excluded fields). */
export async function vehicleImageRowColumns(): Promise<'*'> {
  return ((await signedIn()) ? '*' : VEHICLE_IMAGE_PUBLIC_COLUMNS) as '*';
}

// Split a select list on commas outside parentheses, so an embed such as `vehicle:vehicles(id, year)` stays whole.
function splitTopLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) { out.push(list.slice(start, i)); start = i + 1; }
  }
  out.push(list.slice(start));
  return out;
}

/** The given select list, minus the columns anon may not read when signed out. */
export async function vehicleImageColumnsForViewer<T extends string>(columns: T): Promise<T> {
  if (await signedIn()) return columns;
  const excluded = new Set<string>(VEHICLE_IMAGE_ANON_EXCLUDED_COLUMNS);
  // An item may be a column, an alias of a JSON path (`exif_camera:exif_data->camera`) or a path; what it reads is the
  // part after the alias, up to the first arrow.
  const reads = (item: string) => item.replace(/^[A-Za-z_][A-Za-z0-9_]*:(?!:)/, '').split('->')[0].trim();
  return splitTopLevel(columns).map((c) => c.trim()).filter((c) => c && !excluded.has(reads(c))).join(', ') as T;
}

/**
 * Where a gallery read goes. The gate filter `vehicle_image_gallery_eligible` takes the whole row, which anon cannot form
 * once its column grants withhold location/EXIF/device fields, so a signed-out gallery read uses vehicle_images_public (the
 * same rows and gate, without those columns) and a signed-in read keeps the table.
 */
export async function vehicleImageGallerySource(): Promise<'vehicle_images'> {
  return ((await signedIn()) ? 'vehicle_images' : 'vehicle_images_public') as 'vehicle_images';
}
