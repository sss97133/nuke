-- Revert of 20261125200000_scan_metadata_withheld_paths.sql: vehicle_images_public serves ai_scan_metadata raw again,
-- vehicle_image_findings reads vehicle_images with no gallery test (its 20261014052000 body), get_image_deep_analysis
-- reads byok_deep_analysis raw (its 20261125160500 body), and the helpers, the rule type and the rule table are dropped. Run by hand only if the migration must be undone; it re-opens the place_hint and plate leak.
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

-- get_image_deep_analysis: its 20261125160500 body, reading byok_deep_analysis raw.
CREATE OR REPLACE FUNCTION public.get_image_deep_analysis(p_image_id uuid)
 RETURNS TABLE(image_id uuid, narrative text, intent text, intent_confidence numeric, scene_type text, build_phase text, place_hint text, confidence numeric, agent_model text, agent_notes text, analyzed_at timestamp with time zone, paint_state text, rust_severity text, completeness text, damage_callouts jsonb, components jsonb, open_questions jsonb, needs_review boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 -- definer_readers_visibility_v1: shown, uploader or tied (20261125160500)
 SELECT vi.id,b->>'narrative_one_line',b->>'intent',nullif(b->>'intent_confidence','')::numeric,
  b->>'scene_type',b->>'build_phase_guess',b->'presence'->>'place_hint',nullif(b->>'confidence','')::numeric,
  b->>'agent_model',b->>'agent_notes',nullif(b->>'analyzed_at','')::timestamptz,
  b->'state_observations'->>'paint_state',b->'state_observations'->>'rust_severity',
  b->'state_observations'->>'completeness',b->'state_observations'->'damage_callouts',
  b->'components_seen',b->'open_questions',nullif(b->>'needs_review','')::boolean
 FROM public.vehicle_images vi
 CROSS JOIN LATERAL(SELECT vi.ai_scan_metadata->'byok_deep_analysis' AS b) j
 WHERE vi.id=p_image_id AND vi.ai_scan_metadata ? 'byok_deep_analysis'
   AND (coalesce(b->>'prompt_version','')<>'reviewed_image_analysis_v1' OR EXISTS(
     SELECT 1 FROM public.image_observations io WHERE io.image_id=vi.id AND io.is_active
       AND io.observed_by='caller-byok' AND io.agent_version='reviewed_image_analysis_v1'
       AND io.confidence_basis#>>'{reviewed_image_analysis_v1,observation_id}'=b->>'observation_id'
       AND io.confidence_basis#>>'{reviewed_image_analysis_v1,image_url}'=vi.image_url
       AND io.confidence_basis#>>'{reviewed_image_analysis_v1,vehicle_id}'=vi.vehicle_id::text))
   AND (
     coalesce((
       SELECT true
       FROM public.vehicle_images_public vip
       JOIN public.vehicles v ON v.id = vip.vehicle_id
       WHERE vip.id = vi.id
         AND coalesce(vip.is_sensitive, false) = false
         AND v.is_public = true
         AND v.deleted_at IS NULL
         AND public.vehicle_image_gallery_eligible(vip)), false)
     OR ((SELECT auth.uid()) IS NOT NULL AND vi.user_id = (SELECT auth.uid()))
     OR public.vehicle_viewer_tied(vi.vehicle_id));
$function$;

DROP FUNCTION IF EXISTS public.image_scan_text_path_gaps(jsonb, integer, text);
DROP FUNCTION IF EXISTS public.image_scan_metadata_for_viewer(jsonb, uuid, uuid);
DROP FUNCTION IF EXISTS public.image_scan_metadata_for_viewer(jsonb, uuid, uuid, public.image_scan_rule[]);
DROP FUNCTION IF EXISTS public.image_scan_rules(text);
DROP TYPE IF EXISTS public.image_scan_rule;
DROP TABLE IF EXISTS public.image_scan_withheld_paths;

DO $verify$
BEGIN
  IF md5(pg_get_viewdef('public.vehicle_images_public'::regclass)) <> '21ad7028a04d54602de5c195f175cdf2' THEN
    RAISE EXCEPTION 'vehicle_images_public is not the 2026-11-25 definition';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.vehicle_image_findings(uuid)'::regprocedure) <> '3f3b62421cfc0b516106029ecf0945a9'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.get_image_deep_analysis(uuid)'::regprocedure) <> '35593b09f682203f625e5c058740a29d' THEN
    RAISE EXCEPTION 'vehicle_image_findings or get_image_deep_analysis is not its 2026-11-25 body';
  END IF;
END
$verify$;
COMMIT;
