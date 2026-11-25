-- Shared schema for the scan-metadata contracts (test_scan_metadata_withheld_paths.sql,
-- test_definer_readers_scan_rules.sql): the photo-reading base fixture, production's vehicle_images columns, the live
-- vehicle_images_public, vehicle_image_findings and get_image_deep_analysis (md5 checked) and the policy-copy registry.
-- Disposable PG17 only; fixture rows. -- ALLOW_RAW_TESTIMONY_WRITE
\ir photo_reading_select_base.sql
-- service_role reads as in production (BYPASSRLS), also on a cluster where the role already existed without it.
ALTER ROLE service_role BYPASSRLS;
-- The vehicles columns the vehicle_value rules read (not granted to anon or authenticated, as live 2026-11-25).
ALTER TABLE public.vehicles ADD COLUMN license_plate text, ADD COLUMN owner_name text, ADD COLUMN owner_contact text,
  ADD COLUMN purchase_location text;
UPDATE public.vehicles SET license_plate = 'tst-pl8 9';

-- Production's full vehicle_images columns (2026-11-25, pg_attribute; the base fixture holds a subset).
-- guardrail-allow(center-key-fk): vehicle_images.suggested_vehicle_id: production has no foreign key on it (pg_constraint 2026-11-25)
-- guardrail-allow(center-key-fk): vehicle_images.auto_suggested_vehicle_id: production has no foreign key on it (pg_constraint 2026-11-25)
-- guardrail-allow(center-key-fk): vehicle_images.merged_from_vehicle_id: production has no foreign key on it (pg_constraint 2026-11-25)
ALTER TABLE public.vehicle_images
  ADD COLUMN image_type text,
  ADD COLUMN category text,
  ADD COLUMN position integer,
  ADD COLUMN caption text,
  ADD COLUMN is_primary boolean,
  ADD COLUMN created_at timestamp with time zone,
  ADD COLUMN updated_at timestamp with time zone,
  ADD COLUMN timeline_event_id uuid,
  ADD COLUMN image_context text,
  ADD COLUMN file_hash text,
  ADD COLUMN file_name text,
  ADD COLUMN file_size bigint,
  ADD COLUMN taken_at timestamp with time zone,
  ADD COLUMN source_url text,
  ADD COLUMN mime_type text,
  ADD COLUMN sensitive_type text,
  ADD COLUMN storage_path text,
  ADD COLUMN safe_preview_url text,
  ADD COLUMN process_stage text,
  ADD COLUMN workflow_role text,
  ADD COLUMN area text,
  ADD COLUMN part text,
  ADD COLUMN damage_type text,
  ADD COLUMN operation text,
  ADD COLUMN materials text[],
  ADD COLUMN labels text[],
  ADD COLUMN task_id uuid,
  ADD COLUMN event_id uuid,
  ADD COLUMN angle text,
  ADD COLUMN perspective text,
  ADD COLUMN longitude numeric(11,8),
  ADD COLUMN location_name text,
  ADD COLUMN thumbnail_url text,
  ADD COLUMN medium_url text,
  ADD COLUMN large_url text,
  ADD COLUMN optimization_status text,
  ADD COLUMN optimized_at timestamp with time zone,
  ADD COLUMN variants jsonb,
  ADD COLUMN spatial_tags jsonb[],
  ADD COLUMN ai_scan_metadata jsonb,
  ADD COLUMN ai_last_scanned timestamp with time zone,
  ADD COLUMN ai_component_count integer,
  ADD COLUMN ai_avg_confidence numeric(3,2),
  ADD COLUMN filename text,
  ADD COLUMN temp_session_id text,
  ADD COLUMN approved_by uuid,
  ADD COLUMN approved_at timestamp with time zone,
  ADD COLUMN imported_by uuid,
  ADD COLUMN ghost_user_id uuid,
  ADD COLUMN pending_submission_id uuid,
  ADD COLUMN image_category text,
  ADD COLUMN submitted_by uuid,
  ADD COLUMN redacted_by uuid,
  ADD COLUMN redacted_at timestamp with time zone,
  ADD COLUMN redaction_reason text,
  ADD COLUMN uploaded_at timestamp with time zone,
  ADD COLUMN analysis_history jsonb,
  ADD COLUMN context_score integer,
  ADD COLUMN processing_models_used text[],
  ADD COLUMN total_processing_cost numeric(10,6),
  ADD COLUMN rotation integer,
  ADD COLUMN document_classification text,
  ADD COLUMN document_category text,
  ADD COLUMN manual_priority integer,
  ADD COLUMN display_order integer,
  ADD COLUMN user_tags text[],
  ADD COLUMN user_notes text,
  ADD COLUMN ai_processing_status text,
  ADD COLUMN ai_processing_started_at timestamp with time zone,
  ADD COLUMN ai_processing_completed_at timestamp with time zone,
  ADD COLUMN ai_suggestions jsonb,
  ADD COLUMN organization_status text,
  ADD COLUMN organized_at timestamp with time zone,
  ADD COLUMN ai_detected_vehicle jsonb,
  ADD COLUMN ai_detected_angle text,
  ADD COLUMN ai_detected_angle_confidence real,
  ADD COLUMN suggested_vehicle_id uuid,
  ADD COLUMN perceptual_hash text,
  ADD COLUMN dhash text,
  ADD COLUMN duplicate_of uuid,
  ADD COLUMN documented_by_device text,
  ADD COLUMN photographer_attribution text,
  ADD COLUMN user_confirmed_vehicle boolean,
  ADD COLUMN user_confirmed_vehicle_by uuid,
  ADD COLUMN user_confirmed_vehicle_at timestamp with time zone,
  ADD COLUMN auto_suggested_vehicle_id uuid,
  ADD COLUMN auto_suggestion_confidence real,
  ADD COLUMN auto_suggestion_reasons text[],
  ADD COLUMN angle_confidence numeric,
  ADD COLUMN yaw_deg numeric,
  ADD COLUMN yaw_confidence numeric,
  ADD COLUMN angle_source text,
  ADD COLUMN bbox jsonb,
  ADD COLUMN doc_flag boolean,
  ADD COLUMN doc_confidence numeric,
  ADD COLUMN components jsonb,
  ADD COLUMN vehicle_vin text,
  ADD COLUMN vehicle_vin_confidence numeric,
  ADD COLUMN vehicle_make text,
  ADD COLUMN vehicle_model text,
  ADD COLUMN vehicle_year integer,
  ADD COLUMN vehicle_confidence numeric,
  ADD COLUMN vehicle_source text,
  ADD COLUMN stale boolean,
  ADD COLUMN last_rerun_at timestamp with time zone,
  ADD COLUMN tags jsonb,
  ADD COLUMN ai_extractions jsonb,
  ADD COLUMN ai_extraction_consensus jsonb,
  ADD COLUMN device_fingerprint text,
  ADD COLUMN location_confidence numeric(3,2),
  ADD COLUMN phash text,
  ADD COLUMN condition_score smallint,
  ADD COLUMN damage_flags text[],
  ADD COLUMN modification_flags text[],
  ADD COLUMN photo_quality_score smallint,
  ADD COLUMN vision_analyzed_at timestamp with time zone,
  ADD COLUMN vision_model_version text,
  ADD COLUMN surface_coord_v numeric(8,2),
  ADD COLUMN surface_coord_u numeric(8,2),
  ADD COLUMN camera_pose jsonb,
  ADD COLUMN vehicle_zone text,
  ADD COLUMN zone_confidence numeric(4,3),
  ADD COLUMN yono_queued_at timestamp with time zone,
  ADD COLUMN interior_quality smallint,
  ADD COLUMN zone_source text,
  ADD COLUMN fabrication_stage text,
  ADD COLUMN stage_confidence real,
  ADD COLUMN duration_seconds numeric,
  ADD COLUMN video_codec text,
  ADD COLUMN video_resolution text,
  ADD COLUMN is_video boolean,
  ADD COLUMN image_medium text,
  ADD COLUMN apple_ml_labels text[],
  ADD COLUMN vehicle_score real,
  ADD COLUMN upload_batch_id uuid,
  ADD COLUMN work_session_id uuid,
  ADD COLUMN merged_from_vehicle_id uuid,
  ADD COLUMN vision_gate_processed_at timestamp with time zone,
  ADD COLUMN vision_gate_agent_reasoning text,
  ADD COLUMN vision_gate_attribution_confidence numeric,
  ADD COLUMN superseded_by uuid,
  ADD COLUMN superseded_at timestamp with time zone,
  ADD COLUMN ai_retry_count integer,
  ADD COLUMN image_identity_id uuid,
  ADD COLUMN occurred_at timestamp with time zone,
  ADD COLUMN ingest_kind text;

-- Production's vehicle_images_public: the live text (pg_get_viewdef), checked by md5 below. Its gallery overload takes the
-- view's row type, so it is dropped with the base fixture's subset view and re-created with the live body.
GRANT SELECT (id, vehicle_id, user_id, image_url, image_type, category, position, caption, is_primary, created_at, updated_at, timeline_event_id, image_context, file_hash, file_name, file_size, taken_at, source, source_url, is_external, mime_type, is_sensitive, sensitive_type, storage_path, safe_preview_url, process_stage, workflow_role, area, part, damage_type, operation, materials, labels, task_id, event_id, angle, perspective, thumbnail_url, medium_url, large_url, optimization_status, optimized_at, variants, spatial_tags, ai_scan_metadata, ai_last_scanned, ai_component_count, ai_avg_confidence, filename, temp_session_id, is_approved, approved_by, approved_at, imported_by, ghost_user_id, verification_status, pending_submission_id, image_category, approval_status, submitted_by, redaction_level, redacted_by, redacted_at, redaction_reason, uploaded_at, analysis_history, context_score, processing_models_used, total_processing_cost, rotation, document_classification, is_document, document_category, manual_priority, display_order, user_tags, user_notes, ai_processing_status, ai_processing_started_at, ai_processing_completed_at, ai_suggestions, organization_status, organized_at, ai_detected_vehicle, ai_detected_angle, ai_detected_angle_confidence, suggested_vehicle_id, perceptual_hash, dhash, duplicate_of, is_duplicate, documented_by_user_id, photographer_attribution, user_confirmed_vehicle, user_confirmed_vehicle_by, user_confirmed_vehicle_at, auto_suggested_vehicle_id, auto_suggestion_confidence, auto_suggestion_reasons, angle_confidence, yaw_deg, yaw_confidence, angle_source, bbox, doc_flag, doc_confidence, components, vehicle_vin, vehicle_vin_confidence, vehicle_make, vehicle_model, vehicle_year, vehicle_confidence, vehicle_source, stale, last_rerun_at, tags, ai_extractions, ai_extraction_consensus, phash, condition_score, damage_flags, modification_flags, photo_quality_score, vision_analyzed_at, vision_model_version, surface_coord_v, surface_coord_u, camera_pose, vehicle_zone, zone_confidence, yono_queued_at, interior_quality, zone_source, fabrication_stage, stage_confidence, duration_seconds, video_codec, video_resolution, is_video, image_vehicle_match_status, image_medium, apple_ml_labels, vehicle_score, upload_batch_id, work_session_id, merged_from_vehicle_id, vision_gate_status, vision_gate_processed_at, vision_gate_agent_reasoning, vision_gate_attribution_confidence, is_superseded, superseded_by, superseded_at, ai_retry_count, image_identity_id) ON public.vehicle_images TO anon;
DO $$ BEGIN
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.vehicle_images'::regclass AND attnum > 0 AND NOT attisdropped) <> 165 THEN
    RAISE EXCEPTION 'FAIL: vehicle_images fixture does not carry production''s 165 columns';
  END IF;
END $$;
DROP FUNCTION public.vehicle_image_gallery_eligible(public.vehicle_images_public);
DROP VIEW public.vehicle_images_public;
CREATE VIEW public.vehicle_images_public WITH (security_invoker = true) AS
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
   FROM vehicle_images;
CREATE OR REPLACE FUNCTION public.vehicle_image_gallery_eligible(vehicle_images_public)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    coalesce(($1).is_document,false)=false
    AND coalesce(($1).is_duplicate,false)=false
    AND coalesce(($1).is_superseded,false)=false
    AND nullif(btrim(($1).image_url),'') IS NOT NULL
    AND ($1).image_url NOT LIKE 'file://%'
    AND (($1).source IS NULL OR ($1).source <> 'e2e_test')
    AND coalesce(($1).image_vehicle_match_status,'') NOT IN ('mismatch','unrelated')
    AND CASE
      WHEN ($1).vision_gate_status IS NULL OR ($1).vision_gate_status::text='approved' THEN true
      WHEN ($1).vision_gate_status::text='pending' THEN
        coalesce(($1).is_sensitive,false)=false
        AND (
          (
            coalesce(($1).source='bat_import',false)
            AND ($1).is_external IS TRUE
            AND ($1).is_approved IS TRUE
            AND coalesce(($1).approval_status::text IN ('approved','auto_approved'),false)
            AND coalesce(($1).verification_status='approved',false)
            AND coalesce(($1).redaction_level::text='none',false)
            AND ($1).image_url ~* '^https://(www\.)?bringatrailer\.com/wp-content/uploads/'
            AND public.bat_pending_image_listing_by_id(($1).id)
          )
          OR (
            -- listing capture: a photo taken from a public web listing by an extractor, never an upload
            coalesce(($1).source='bat_import',false)=false
            AND ($1).is_external IS TRUE
            AND ($1).user_id IS NULL
            AND ($1).is_approved IS TRUE
            AND coalesce(($1).approval_status::text,'') <> 'rejected'
            AND coalesce(($1).verification_status='approved',false)
            AND coalesce(($1).redaction_level::text='none',false)
            AND ($1).image_url ~* '^https://'
          )
        )
      ELSE false
    END
    -- privacy rule rows (image_privacy_rules): a custody photo with a keyed private reading, for a viewer who is
    -- neither its uploader nor tied to its vehicle
    AND NOT public.vehicle_image_privacy_withheld(($1).id);
$function$;
GRANT SELECT ON public.vehicle_images_public TO anon, authenticated;
GRANT ALL ON public.vehicle_images_public TO service_role;

DO $$ BEGIN
  IF (md5(pg_get_viewdef('public.vehicle_images_public'::regclass)),
      md5(pg_get_functiondef('public.vehicle_image_gallery_eligible(public.vehicle_images_public)'::regprocedure)),
      (SELECT md5(string_agg(attname || ' ' || format_type(atttypid, atttypmod), ',' ORDER BY attnum)) FROM pg_attribute
        WHERE attrelid = 'public.vehicle_images_public'::regclass AND attnum > 0 AND NOT attisdropped))
     IS DISTINCT FROM ('21ad7028a04d54602de5c195f175cdf2'::text, '7393cb61fab3ff10327e0c3fc7864551'::text, '7baba6813c194888fb4aec5e60a050d7'::text) THEN
    RAISE EXCEPTION 'FAIL: fixture view or overload does not hash to production''s 2026-11-25 text';
  END IF;
  RAISE NOTICE 'PASS: fixture vehicle_images_public and its gallery overload hash to production''s 2026-11-25 text';
END $$;
-- vehicle_image_findings as live (20261014052000; prosrc md5 checked by the migration's guard).
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
-- get_image_deep_analysis as live (20261125160500), with the table its review check reads.
CREATE TABLE public.image_observations (image_id uuid REFERENCES public.vehicle_images(id), is_active boolean, observed_by text,
  agent_version text, confidence_basis jsonb);
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
$function$
;
GRANT EXECUTE ON FUNCTION public.get_image_deep_analysis(uuid) TO anon, authenticated, service_role;
DO $$ BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.get_image_deep_analysis(uuid)'::regprocedure) <> '35593b09f682203f625e5c058740a29d' THEN
    RAISE EXCEPTION 'FAIL: fixture get_image_deep_analysis does not hash to production''s 2026-11-25 body';
  END IF;
END $$;

-- The policy-copy registry of #3925 (live shape 2026-11-25).
CREATE TABLE public.private_row_policy_copies(reader text NOT NULL, relation text NOT NULL, policy_filter text NOT NULL, recorded_hash text NOT NULL,
  owner_lane text NOT NULL, note text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (reader, relation, policy_filter));
-- Its live hash function, stubbed: answers the hash in test.vi_policy_hash, by default production's vehicle_images
-- SELECT/ALL hash since #3971 (d00a311f...), which 20261125200000 and the readers after it check before registering.
CREATE FUNCTION public.private_row_policy_hash(p_relation text, p_policy_filter text) RETURNS TABLE (policy_hash text, policies int)
LANGUAGE sql STABLE AS $$ SELECT current_setting('test.vi_policy_hash', true), 1 $$;
SELECT set_config('test.vi_policy_hash', 'd00a311fd7235bb19240f3fd812493c4', false);
