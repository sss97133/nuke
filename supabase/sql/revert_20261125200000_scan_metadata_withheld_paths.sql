-- Revert of 20261125200000_scan_metadata_withheld_paths.sql: vehicle_images_public serves ai_scan_metadata raw again,
-- vehicle_image_findings reads vehicle_images with no gallery test (its 20261014052000 body), and the helper and the
-- rule table are dropped. Run by hand only if the migration must be undone; it re-opens the place_hint and plate leak.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE VIEW public.vehicle_images_public WITH (security_invoker = true) AS
 SELECT id,
    vehicle_id,
    user_id,
    image_url,
    image_type,
    category,
    "position",
    caption,
    is_primary,
    created_at,
    updated_at,
    timeline_event_id,
    image_context,
    file_hash,
    file_name,
    file_size,
    taken_at,
    source,
    source_url,
    is_external,
    mime_type,
    is_sensitive,
    sensitive_type,
    storage_path,
    safe_preview_url,
    process_stage,
    workflow_role,
    area,
    part,
    damage_type,
    operation,
    materials,
    labels,
    task_id,
    event_id,
    angle,
    perspective,
    thumbnail_url,
    medium_url,
    large_url,
    optimization_status,
    optimized_at,
    variants,
    spatial_tags,
    ai_scan_metadata,
    ai_last_scanned,
    ai_component_count,
    ai_avg_confidence,
    filename,
    temp_session_id,
    is_approved,
    approved_by,
    approved_at,
    imported_by,
    ghost_user_id,
    verification_status,
    pending_submission_id,
    image_category,
    approval_status,
    submitted_by,
    redaction_level,
    redacted_by,
    redacted_at,
    redaction_reason,
    uploaded_at,
    analysis_history,
    context_score,
    processing_models_used,
    total_processing_cost,
    rotation,
    document_classification,
    is_document,
    document_category,
    manual_priority,
    display_order,
    user_tags,
    user_notes,
    ai_processing_status,
    ai_processing_started_at,
    ai_processing_completed_at,
    ai_suggestions,
    organization_status,
    organized_at,
    ai_detected_vehicle,
    ai_detected_angle,
    ai_detected_angle_confidence,
    suggested_vehicle_id,
    perceptual_hash,
    dhash,
    duplicate_of,
    is_duplicate,
    documented_by_user_id,
    photographer_attribution,
    user_confirmed_vehicle,
    user_confirmed_vehicle_by,
    user_confirmed_vehicle_at,
    auto_suggested_vehicle_id,
    auto_suggestion_confidence,
    auto_suggestion_reasons,
    angle_confidence,
    yaw_deg,
    yaw_confidence,
    angle_source,
    bbox,
    doc_flag,
    doc_confidence,
    components,
    vehicle_vin,
    vehicle_vin_confidence,
    vehicle_make,
    vehicle_model,
    vehicle_year,
    vehicle_confidence,
    vehicle_source,
    stale,
    last_rerun_at,
    tags,
    ai_extractions,
    ai_extraction_consensus,
    phash,
    condition_score,
    damage_flags,
    modification_flags,
    photo_quality_score,
    vision_analyzed_at,
    vision_model_version,
    surface_coord_v,
    surface_coord_u,
    camera_pose,
    vehicle_zone,
    zone_confidence,
    yono_queued_at,
    interior_quality,
    zone_source,
    fabrication_stage,
    stage_confidence,
    duration_seconds,
    video_codec,
    video_resolution,
    is_video,
    image_vehicle_match_status,
    image_medium,
    apple_ml_labels,
    vehicle_score,
    upload_batch_id,
    work_session_id,
    merged_from_vehicle_id,
    vision_gate_status,
    vision_gate_processed_at,
    vision_gate_agent_reasoning,
    vision_gate_attribution_confidence,
    is_superseded,
    superseded_by,
    superseded_at,
    ai_retry_count,
    image_identity_id
   FROM public.vehicle_images;

CREATE OR REPLACE FUNCTION public.vehicle_image_findings(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH frames AS (
    SELECT j.*, vi.vision_analyzed_at
      FROM public.vehicle_images vi
      LEFT JOIN LATERAL jsonb_to_record(CASE WHEN jsonb_typeof(vi.ai_scan_metadata) = 'object' THEN vi.ai_scan_metadata END) AS j(
             classifier jsonb, error jsonb, vin jsonb, license_plate jsonb, engine jsonb, engine_guess jsonb, engine_badge jsonb,
             transmission jsonb, color_visible jsonb, interior_trim jsonb, odometer jsonb, mileage_at_listing jsonb, source jsonb,
             part_number jsonb, critical jsonb, privacy_concern jsonb, attribution_concern jsonb, phase jsonb, scene_class jsonb,
             make_guess jsonb, model_guess jsonb, year_guess jsonb, confidence jsonb, byok_deep_analysis jsonb) ON true
     WHERE vi.vehicle_id = p_vehicle_id
     LIMIT 5000
  ),
  reported AS (
    SELECT o.row
      FROM frames f
      CROSS JOIN LATERAL (
        SELECT coalesce(jsonb_object_agg(t.k, t.v), '{}'::jsonb) AS row
          FROM (VALUES
                 ('classifier', f.classifier), ('error', f.error), ('vin', f.vin), ('license_plate', f.license_plate),
                 ('engine', f.engine), ('engine_guess', f.engine_guess), ('engine_badge', f.engine_badge),
                 ('transmission', f.transmission), ('color_visible', f.color_visible), ('interior_trim', f.interior_trim),
                 ('odometer', f.odometer), ('mileage_at_listing', f.mileage_at_listing), ('source', f.source),
                 ('part_number', f.part_number), ('critical', f.critical), ('privacy_concern', f.privacy_concern),
                 ('attribution_concern', f.attribution_concern), ('phase', f.phase), ('scene_class', f.scene_class),
                 ('make_guess', f.make_guess), ('model_guess', f.model_guess), ('year_guess', f.year_guess),
                 ('confidence', f.confidence),
                 ('byok_scene_type', f.byok_deep_analysis -> 'scene_type'),
                 ('byok_build_phase_guess', f.byok_deep_analysis -> 'build_phase_guess'),
                 ('byok_confidence', f.byok_deep_analysis -> 'confidence'),
                 ('vision_analyzed_at', to_jsonb(f.vision_analyzed_at))
               ) AS t(k, v)
         WHERE t.v IS NOT NULL AND t.v <> 'null'::jsonb
      ) o
     WHERE o.row <> '{}'::jsonb
  )
  SELECT jsonb_build_object(
           'total', (SELECT count(*) FROM frames),
           'rows', coalesce((SELECT jsonb_agg(row) FROM reported), '[]'::jsonb));
$function$;
REVOKE ALL ON FUNCTION public.vehicle_image_findings(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_image_findings(uuid) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.image_scan_metadata_for_viewer(jsonb, uuid, uuid);
DROP TABLE IF EXISTS public.image_scan_withheld_paths;

DO $verify$
BEGIN
  IF md5(pg_get_viewdef('public.vehicle_images_public'::regclass)) <> '21ad7028a04d54602de5c195f175cdf2' THEN
    RAISE EXCEPTION 'vehicle_images_public is not the 2026-11-25 definition';
  END IF;
END
$verify$;
COMMIT;
