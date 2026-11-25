-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_<name> -f supabase/sql/test_scan_metadata_withheld_paths.sql
-- Proves 20261125200000_scan_metadata_withheld_paths.sql:
--   * vehicle_images_public keeps production's column list, order and types (signature md5 as read 2026-11-25),
--     security_invoker and grants; only ai_scan_metadata changes.
--   * anon and a signed-in stranger get no withheld path on any photo (24 paths: place_hint, the OCR-text paths,
--     document fields, license_plate, location, person, shipment and money keys, and the model free text: agent_notes,
--     open_questions, open_facts, narrative, damage_callouts, framing, classification description and medium_context,
--     appraiser text), checked against a list written here, independent of the rule table; no license_plate element in
--     v2 vehicle_fields; the car's plate replaced by [withheld] inside a kept label, written with other spaces and case;
--     every other key, siblings of a withheld key and the other array elements included, comes back as stored.
--   * the uploader (an untied photographer included), a viewer tied to the vehicle, service_role (BYPASSRLS) and a
--     direct database session still get every key; PostgREST's authenticator with empty claims is stripped like anon.
--   * vehicle_image_findings: anon and a stranger get gallery-eligible frames only and no license_plate; the owner and a
--     tied viewer get every frame they read with license_plate; an untied uploader gets their own frame's plate only.
--   * get_image_deep_analysis (the live body, md5 checked): anon and a stranger get the scene, none of the withheld
--     text; the uploader and a tied mechanic get every field.
--   * a whole-row gallery test over the view never calls vehicle_image_scan_metadata; three projections evaluate it once
--     per row; the rules come from image_scan_rules_compiled (no image_scan_rules call in the view's plan) and the rule
--     table's trigger recompiles them.
--   * deleting the place_hint rule row brings place_hint back to anon; overlapping rules ({presence} and
--     {presence,place_hint}) remove the whole object; a plate redaction that would break the JSON withholds the whole
--     analysis; the plate is found after a JSON escape (\n, \t), with a newline inside, and slash- or dot-separated.
--   * the plate oracle is closed: as anon and as a stranger, the worker (both forms) and image_scan_rules refuse
--     (42501), a document-taking form of the callable does not exist (42883), and no anon- or authenticated-executable
--     function that reaches the worker takes jsonb, json, text or a rule array (catalog); the callable takes an image id,
--     returns NULL for a photo the caller may not see, and its time does not say whether the car has a plate on file
--     (200 interleaved calls each way, medians within 15%).
--   * image_scan_text_path_gaps: 0 on the fixture, a new long model-text path reported; service_role only.
--   * the revert applies and restores the live bodies (their md5).
-- Which assertion fails if the fix is removed (mutation run 2026-11-25, each failing a named assertion): a rule row
-- renamed or its value changed -> "anon: no withheld path on any photo (fixed list)"; the authenticator guard ->
-- "authenticator session with empty claims"; rules computed per row -> "plan: no image_scan_rules call"; the patch merge
-- in the removal tree -> the fixed list; get_image_deep_analysis left raw -> the migration's verify block; the JSON
-- fallback -> "value redaction that would break the JSON"; both overlap prunings -> "overlapping rules"; the worker
-- left anon-executable -> "oracle: ..."; an early exit when no plate is on file -> "timing: ..."; the old lookbehind
-- -> "plate after a JSON escape ..."; the visibility re-check removed -> "callable: a hidden photo"; the live
-- vehicle_images policy-hash check removed -> "another live vehicle_images policy hash".
-- Fixture: supabase/sql/fixtures/photo_reading_select_base.sql, then production's full vehicle_images column list and
-- the live vehicle_images_public definition (pg_get_viewdef md5 checked) with its gallery overload re-created verbatim.
-- Fixture rows only, in a disposable database. -- ALLOW_RAW_TESTIMONY_WRITE
\ir fixtures/photo_reading_select_base.sql
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

-- Two more photos on public car A: clean_a (u1, metadata with no withheld path) and photog_a (uploaded by u3, who is not
-- tied to A). Every photo gets metadata; tokens TST* mark each withheld value.
INSERT INTO public.vehicle_images (id, vehicle_id, user_id, image_url, source, is_document, is_external, vision_gate_status) VALUES
  ('10000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'https://x.invalid/8.jpg', 'user_upload', false, false, 'approved'),
  ('10000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000003', 'https://x.invalid/9.jpg', 'user_upload', false, false, 'approved');
CREATE FUNCTION public.t_label2(p uuid) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(public.t_label(p), CASE p WHEN '10000000-0000-0000-0000-000000000008' THEN 'clean_a' WHEN '10000000-0000-0000-0000-000000000009' THEN 'photog_a' END) $$;
GRANT EXECUTE ON FUNCTION public.t_label2(uuid) TO anon, authenticated, service_role;
UPDATE public.vehicle_images SET ai_scan_metadata = '{
  "classifier": "fixture", "scene_class": "exterior", "license_plate": "TSTPLATE1", "location": "TSTPLACE-L",
  "extracted_text": "TSTOCR-E", "recipient": "TSTPERSON-R", "shipment_number": "TSTSHIP", "price": "TSTMONEY-P",
  "cost_basis_input": "TSTMONEY-C",
  "classification": {"label": "exterior", "detected_text": ["TSTOCR-D"], "description": "TSTDESC", "medium_context": "TSTMED",
    "v2": {"vin": {"value": "1GKEV18K8LF000000"}, "text_lines": [{"text": "TSTOCR-L", "confidence": 0.9}],
      "vehicle_fields": [{"field_name": "color", "value": "red", "evidence": "paint"},
                         {"field_name": "license_plate", "value": "TSTPLATE2", "evidence": "TSTPLATE2 on the rear"}],
      "document": {"kind": "receipt", "fields": {"owner_address": "TSTPLACE-A", "vendor_phone": "TSTPHONE"}}}},
  "deep_analysis": {"subject": {"kind": "engine", "text_visible": ["TSTOCR-V"]}},
  "full_classification": {"person_visible": {"name": "TSTPERSON-N", "technician_id": 7}, "kept": 1},
  "byok_deep_analysis": {"scene_type": "engine_bay", "narrative_one_line": "TSTNARR at TSTPLACE-H",
    "presence": {"person": false, "dog": false, "place_hint": "TSTPLACE-H"},
    "text_regions": [{"text": "TSTOCR-T", "bbox": [0, 0, 1, 1], "confidence": 0.9}],
    "agent_notes": "TSTNOTE plate TSTPLATE1", "open_questions": ["TSTQ"], "saturation": {"version": "s1", "open_facts": ["TSTFACT"]},
    "state_observations": {"paint_state": "good", "damage_callouts": ["TSTDMG"]}, "camera_pose": {"yaw": 10, "framing": "TSTFRAME"},
    "components_seen": [{"label": "plate reads TST PL8-9 on the bumper"}, {"label": "chrome bumper"}]},
  "appraiser": {"primary_label": "Exterior", "description": "TSTAPPD", "context": "TSTAPPC"},
  "route_result": "routed to the deep reader after the classifier marked the frame exterior and rich enough"}'::jsonb
 WHERE id <> '10000000-0000-0000-0000-000000000008';
UPDATE public.vehicle_images SET ai_scan_metadata = '{"classifier": "fixture", "byok_deep_analysis": {"scene_type": "interior", "presence": {"person": true}}}'::jsonb
 WHERE id = '10000000-0000-0000-0000-000000000008';

-- Before: the view's shape, options and grants.
SELECT (SELECT md5(string_agg(attname || ' ' || format_type(atttypid, atttypmod), ',' ORDER BY attnum)) FROM pg_attribute
          WHERE attrelid = 'public.vehicle_images_public'::regclass AND attnum > 0 AND NOT attisdropped) AS sig_before,
       (SELECT reloptions::text || relacl::text || pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public.vehicle_images_public'::regclass) AS opts_before \gset
SELECT public.t_claims(''); SET ROLE anon;
SELECT (SELECT jsonb_agg(ai_scan_metadata) FROM public.vehicle_images_public)::text LIKE '%TSTPLACE-H%' AS leak_before \gset
RESET ROLE;
SELECT public.t_assert(:'leak_before'::boolean, 'before: anon reads place_hint through vehicle_images_public (the defect)');

-- The policy-copy registry of #3925 (live shape 2026-11-25).
CREATE TABLE public.private_row_policy_copies(reader text NOT NULL, relation text NOT NULL, policy_filter text NOT NULL, recorded_hash text NOT NULL,
  owner_lane text NOT NULL, note text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (reader, relation, policy_filter));
-- Its live hash function, stubbed: answers the hash set in test.vi_policy_hash (the fixture's policies are not prod's).
CREATE FUNCTION public.private_row_policy_hash(p_relation text, p_policy_filter text) RETURNS TABLE (policy_hash text, policies int)
LANGUAGE sql STABLE AS $$ SELECT current_setting('test.vi_policy_hash', true), 1 $$;
-- Another live vehicle_images policy hash (the pre-#3971 one): the migration stops and applies nothing.
SELECT set_config('test.vi_policy_hash', '3af9ebbc1bebf423e3bd1e0b7c45a194', false);
\set ON_ERROR_STOP 0
\ir ../migrations/20261125200000_scan_metadata_withheld_paths.sql
\set ON_ERROR_STOP 1
SELECT public.t_assert(to_regprocedure('public.vehicle_image_scan_metadata(uuid)') IS NULL
  AND to_regclass('public.image_scan_withheld_paths') IS NULL AND NOT EXISTS (SELECT 1 FROM public.private_row_policy_copies),
  'another live vehicle_images policy hash: the migration applies nothing');
SELECT set_config('test.vi_policy_hash', 'd00a311fd7235bb19240f3fd812493c4', false);
\ir ../migrations/20261125200000_scan_metadata_withheld_paths.sql

-- 1. Shape.
SELECT public.t_assert((SELECT md5(string_agg(attname || ' ' || format_type(atttypid, atttypmod), ',' ORDER BY attnum)) FROM pg_attribute
          WHERE attrelid = 'public.vehicle_images_public'::regclass AND attnum > 0 AND NOT attisdropped) = :'sig_before'
  AND (SELECT reloptions::text || relacl::text || pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public.vehicle_images_public'::regclass) = :'opts_before',
  'view: same 156 columns, names, order and types; same security_invoker, grants and owner');
SELECT public.t_assert((SELECT count(*) FROM public.image_scan_withheld_paths GROUP BY () HAVING true) IS NOT NULL
  AND (SELECT string_agg(rule_kind || ':' || n, ',' ORDER BY rule_kind) FROM (SELECT rule_kind, count(*) n FROM public.image_scan_withheld_paths GROUP BY 1) k)
      = 'array_element:1,free_text:16,path:8,reviewed_keep:11,vehicle_value:1',
  'rule rows: 8 path, 16 free_text, 1 array_element, 1 vehicle_value (license_plate), 11 reviewed_keep, each with its basis');
SELECT public.t_assert(NOT has_table_privilege('anon', 'public.image_scan_withheld_paths', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.image_scan_withheld_paths', 'SELECT'), 'rule table: not readable by anon or authenticated');

-- The paths withheld, written here (not read from the rule table), and the reader of what a caller got.
CREATE FUNCTION public.t_withheld_hits(p jsonb) RETURNS bigint LANGUAGE sql IMMUTABLE AS $$
  SELECT count(*) FROM jsonb_array_elements(p) e, unnest(ARRAY[
    '{byok_deep_analysis,presence,place_hint}', '{byok_deep_analysis,text_regions}', '{license_plate}', '{location}',
    '{extracted_text}', '{full_classification,person_visible}', '{recipient}', '{shipment_number}', '{price}',
    '{cost_basis_input}', '{classification,detected_text}', '{classification,v2,text_lines}',
    '{classification,v2,document,fields}', '{deep_analysis,subject,text_visible}',
    '{byok_deep_analysis,agent_notes}', '{byok_deep_analysis,open_questions}', '{byok_deep_analysis,saturation,open_facts}',
    '{byok_deep_analysis,narrative_one_line}', '{byok_deep_analysis,state_observations,damage_callouts}',
    '{byok_deep_analysis,camera_pose,framing}', '{classification,description}', '{classification,medium_context}',
    '{appraiser,description}', '{appraiser,context}']::text[]) AS w(path)
  WHERE (e -> 'm') #> w.path::text[] IS NOT NULL $$;
CREATE FUNCTION public.t_view_read() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('l', public.t_label2(id), 'm', ai_scan_metadata) ORDER BY id), '[]') FROM public.vehicle_images_public $$;
GRANT EXECUTE ON FUNCTION public.t_withheld_hits(jsonb), public.t_view_read() TO anon, authenticated, service_role;

-- 2. anon: every photo anon reads (vehicle_images RLS) comes back without a withheld path; the rest is as stored.
SELECT public.t_claims(''); SET ROLE anon;
SELECT public.t_view_read() AS anon_read \gset
RESET ROLE;
SELECT public.t_assert(jsonb_array_length(:'anon_read'::jsonb) >= 4, format('anon reads photos through the view (%s)', jsonb_array_length(:'anon_read'::jsonb)));
SELECT public.t_assert(public.t_withheld_hits(:'anon_read'::jsonb) = 0 AND :'anon_read' NOT LIKE '%TST%', 'anon: no withheld path on any photo (fixed list)');
SELECT public.t_assert(:'anon_read' NOT LIKE '%"license_plate"%' AND :'anon_read' NOT ILIKE '%pl8%', 'anon: no plate element in vehicle_fields and the car''s plate nowhere in the text');
SELECT public.t_assert((SELECT e -> 'm' FROM jsonb_array_elements(:'anon_read'::jsonb) e WHERE e ->> 'l' = 'shown_a')
  = '{"classifier": "fixture", "scene_class": "exterior", "full_classification": {"kept": 1},
      "classification": {"label": "exterior", "v2": {"vin": {"value": "1GKEV18K8LF000000"}, "document": {"kind": "receipt"},
        "vehicle_fields": [{"field_name": "color", "value": "red", "evidence": "paint"}]}},
      "deep_analysis": {"subject": {"kind": "engine"}},
      "byok_deep_analysis": {"scene_type": "engine_bay", "presence": {"person": false, "dog": false},
        "saturation": {"version": "s1"}, "state_observations": {"paint_state": "good"}, "camera_pose": {"yaw": 10},
        "components_seen": [{"label": "plate reads [withheld] on the bumper"}, {"label": "chrome bumper"}]},
      "appraiser": {"primary_label": "Exterior"},
      "route_result": "routed to the deep reader after the classifier marked the frame exterior and rich enough"}'::jsonb,
  'anon: shown_a keeps every other key as stored (scene, presence flags, siblings of a withheld key, the other array element, reviewed system text), the car''s plate replaced inside a kept label');
SELECT public.t_assert((SELECT e -> 'm' FROM jsonb_array_elements(:'anon_read'::jsonb) e WHERE e ->> 'l' = 'clean_a')
  = (SELECT ai_scan_metadata FROM public.vehicle_images WHERE id = '10000000-0000-0000-0000-000000000008'), 'anon: a photo with no withheld path comes back unchanged');

-- 3. A signed-in stranger: the same.
SELECT public.t_claims('00000000-0000-0000-0000-000000000002'); SET ROLE authenticated;
SELECT public.t_view_read() AS u2_read \gset
RESET ROLE;
SELECT public.t_assert(public.t_withheld_hits(:'u2_read'::jsonb) = 0 AND :'u2_read' NOT LIKE '%TST%', 'stranger: no withheld path on any photo (fixed list)');

-- 4. The uploader who is not tied to the car: their own photos whole, nobody else's.
SELECT public.t_claims('00000000-0000-0000-0000-000000000003'); SET ROLE authenticated;
SELECT public.t_view_read() AS u3_read \gset
RESET ROLE;
SELECT public.t_assert((SELECT string_agg(e ->> 'l', ',' ORDER BY e ->> 'l') FROM jsonb_array_elements(:'u3_read'::jsonb) e WHERE e::text LIKE '%TSTPLACE-H%') = 'photog_a,photog_b',
  'untied uploader: place_hint on their own two photos (public car A, private car B), on no one else''s');
SELECT public.t_assert(public.t_withheld_hits((SELECT jsonb_agg(e) FROM jsonb_array_elements(:'u3_read'::jsonb) e WHERE e ->> 'l' = 'photog_a')) = 24,
  'untied uploader: all 24 withheld paths on their own photo');

-- 5. Tied viewers: the owner (u1) and A's mechanic (u4) read every key on A's photos, the mechanic on u3's photo too.
SELECT public.t_claims('00000000-0000-0000-0000-000000000001'); SET ROLE authenticated;
SELECT public.t_view_read() AS u1_read \gset
SELECT public.t_claims('00000000-0000-0000-0000-000000000004');
SELECT public.t_view_read() AS u4_read \gset
RESET ROLE;
SELECT public.t_assert((SELECT bool_and(e::text LIKE '%TSTPLACE-H%' AND e::text LIKE '%TSTPLATE1%' AND e::text LIKE '%TST PL8-9%' AND e::text LIKE '%TSTPLATE2%') FROM jsonb_array_elements(:'u1_read'::jsonb) e WHERE e ->> 'l' <> 'clean_a')
  AND (SELECT count(*) FROM jsonb_array_elements(:'u1_read'::jsonb) e WHERE e ->> 'l' <> 'clean_a') >= 6,
  'owner: every withheld value on every photo they read (shown, unfiled, private, deleted car, document, plate, photographer''s)');
SELECT public.t_assert((SELECT string_agg(e ->> 'l', ',' ORDER BY e ->> 'l') FROM jsonb_array_elements(:'u4_read'::jsonb) e WHERE e::text LIKE '%TSTPLACE-H%')
  = 'document_a,photog_a,plate_a,shown_a', 'tied mechanic: every withheld value on A''s photos, including another uploader''s');

-- 6. service_role and a direct database session (no claims, not authenticator) read every key.
SELECT public.t_claims('service'); SET ROLE service_role;
SELECT public.t_view_read() AS svc_read \gset
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SELECT public.t_view_read() AS db_read \gset
SELECT public.t_assert(public.t_withheld_hits(:'svc_read'::jsonb) = 192 AND public.t_withheld_hits(:'db_read'::jsonb) = 192
  AND :'svc_read' LIKE '%TST PL8-9%' AND :'db_read' LIKE '%TSTPLATE2%',
  format('service_role and a direct session: all 24 paths on all 8 photos that carry them, plate text intact (%s, %s)', public.t_withheld_hits(:'svc_read'::jsonb), public.t_withheld_hits(:'db_read'::jsonb)));

-- 7. vehicle_image_findings on public car A (shown_a, document_a, plate_a, clean_a, photog_a).
CREATE FUNCTION public.t_findings_summary(p uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('total', (f ->> 'total')::int,
    'plates', (SELECT count(*) FROM jsonb_array_elements(f -> 'rows') r WHERE r ? 'license_plate'))
  FROM (SELECT public.vehicle_image_findings(p) f) s $$;
GRANT EXECUTE ON FUNCTION public.t_findings_summary(uuid) TO anon, authenticated, service_role;
SELECT public.t_claims(''); SET ROLE anon;
SELECT public.t_findings_summary('a0000000-0000-0000-0000-00000000000a') AS f_anon,
       (SELECT count(*) FROM public.vehicle_images_public vip WHERE vip.vehicle_id = 'a0000000-0000-0000-0000-00000000000a'
          AND public.vehicle_image_gallery_eligible(vip)) AS anon_gallery,
       (SELECT count(*) FROM public.vehicle_images WHERE vehicle_id = 'a0000000-0000-0000-0000-00000000000a') AS anon_rls_rows \gset
SELECT public.t_claims('00000000-0000-0000-0000-000000000002'); SET ROLE authenticated;
SELECT public.t_findings_summary('a0000000-0000-0000-0000-00000000000a') AS f_u2 \gset
SELECT public.t_claims('00000000-0000-0000-0000-000000000001');
SELECT public.t_findings_summary('a0000000-0000-0000-0000-00000000000a') AS f_u1 \gset
SELECT public.t_claims('00000000-0000-0000-0000-000000000004');
SELECT public.t_findings_summary('a0000000-0000-0000-0000-00000000000a') AS f_u4 \gset
SELECT public.t_claims('00000000-0000-0000-0000-000000000003');
SELECT public.t_findings_summary('a0000000-0000-0000-0000-00000000000a') AS f_u3 \gset
RESET ROLE;
SELECT public.t_assert(:anon_rls_rows = 5 AND :anon_gallery = 3, format('fixture: anon''s row policies admit 5 frames of A, the gallery 3 (%s, %s)', :anon_rls_rows, :anon_gallery));
SELECT public.t_assert(:'f_anon'::jsonb = '{"total": 3, "plates": 0}'::jsonb,
  format('findings, anon: the 3 gallery frames only (no document, no privacy-withheld frame), no plate; got %s', :'f_anon'));
SELECT public.t_assert(:'f_u2'::jsonb = :'f_anon'::jsonb, 'findings, stranger: what anon gets');
SELECT public.t_assert(:'f_u1'::jsonb = '{"total": 5, "plates": 4}'::jsonb AND :'f_u4'::jsonb = :'f_u1'::jsonb,
  format('findings, owner and tied mechanic: all 5 frames, plates on the 4 that carry one; got %s, %s', :'f_u1', :'f_u4'));
SELECT public.t_assert(:'f_u3'::jsonb = '{"total": 3, "plates": 1}'::jsonb,
  format('findings, untied uploader: the gallery frames, a plate on their own frame only; got %s', :'f_u3'));

-- 8. Whole-row uses of the view never call vehicle_image_scan_metadata (the gallery overload and the #3868 policy shape
--    inline).
SELECT public.t_claims(''); SET ROLE anon;
CREATE TEMP TABLE t_plans (q text, plan text);
DO $$ DECLARE l text; acc text;
BEGIN
  acc := '';
  FOR l IN EXECUTE 'EXPLAIN (VERBOSE, COSTS OFF) SELECT count(*) FROM public.vehicle_images_public vip WHERE public.vehicle_image_gallery_eligible(vip)' LOOP acc := acc || l || E'\n'; END LOOP;
  INSERT INTO t_plans VALUES ('gallery', acc);
  acc := '';
  FOR l IN EXECUTE 'EXPLAIN (VERBOSE, COSTS OFF) SELECT 1 FROM public.vehicles v WHERE EXISTS (SELECT 1 FROM public.vehicle_images_public vip WHERE vip.vehicle_id = v.id AND public.vehicle_image_gallery_eligible(vip))' LOOP acc := acc || l || E'\n'; END LOOP;
  INSERT INTO t_plans VALUES ('exists', acc);
  acc := '';
  FOR l IN EXECUTE $q$EXPLAIN (VERBOSE, COSTS OFF) SELECT ai_scan_metadata -> 'classification', ai_scan_metadata -> 'byok_deep_analysis' ->> 'scene_type', ai_scan_metadata ->> 'classifier' FROM public.vehicle_images_public$q$ LOOP acc := acc || l || E'\n'; END LOOP;
  INSERT INTO t_plans VALUES ('projections', acc);
END $$;
SELECT bool_and(plan NOT LIKE '%vehicle_image_scan_metadata%') FILTER (WHERE q <> 'projections') AS no_helper,
       bool_and(plan LIKE '%vehicle_image_privacy_withheld%') FILTER (WHERE q <> 'projections') AS inlined,
       -- an evaluated call prints bare after "Output: "; a later node's use of its result prints in parentheses
       max((length(plan) - length(replace(plan, 'Output: vehicle_image_scan_metadata(', ''))) / length('Output: vehicle_image_scan_metadata(')) FILTER (WHERE q = 'projections') AS helper_calls
  FROM t_plans \gset
RESET ROLE;
SELECT public.t_assert(:'no_helper'::boolean AND :'inlined'::boolean, 'plan: whole-row gallery tests over the view inline and never call vehicle_image_scan_metadata');
SELECT public.t_assert(:helper_calls = 1, format('plan: three projections of ai_scan_metadata evaluate vehicle_image_scan_metadata in one plan node, once per row (%s evaluating nodes)', :helper_calls));

-- 9. The rule row is what withholds: without the place_hint row, anon reads place_hint again (rolled back).
BEGIN;
DELETE FROM public.image_scan_withheld_paths WHERE path = '{byok_deep_analysis,presence,place_hint}';
SELECT public.t_claims(''); SET ROLE anon;
SELECT public.t_view_read()::text LIKE '%TSTPLACE-H%' AS back_without_rule \gset
RESET ROLE;
ROLLBACK;
SELECT public.t_assert(:'back_without_rule'::boolean, 'rule rows drive it: deleting the place_hint row returns place_hint to anon');

-- 10. PostgREST's authenticator with no claims (role anon set, claims empty) is not a direct session: it is stripped.
SET SESSION AUTHORIZATION authenticator;
SET ROLE anon;
SELECT set_config('request.jwt.claims', '', false);
SELECT public.t_view_read() AS authr_read \gset
RESET ROLE;
RESET SESSION AUTHORIZATION;
SELECT public.t_assert(jsonb_array_length(:'authr_read'::jsonb) >= 4 AND public.t_withheld_hits(:'authr_read'::jsonb) = 0 AND :'authr_read' NOT LIKE '%TST%',
  'authenticator session with empty claims: stripped like anon');

-- 11. get_image_deep_analysis on shown_a: anon and a stranger get no place, notes, questions, narrative or damage text;
--     the uploader and the tied mechanic get every field.
CREATE FUNCTION public.t_gida(p uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT to_jsonb(g) FROM public.get_image_deep_analysis(p) g $$;
GRANT EXECUTE ON FUNCTION public.t_gida(uuid) TO anon, authenticated, service_role;
SELECT id AS shown_a_id FROM public.vehicle_images WHERE public.t_label2(id) = 'shown_a' \gset
SELECT public.t_claims(''); SET ROLE anon;
SELECT public.t_gida(:'shown_a_id') AS g_anon \gset
SELECT public.t_claims('00000000-0000-0000-0000-000000000002'); SET ROLE authenticated;
SELECT public.t_gida(:'shown_a_id') AS g_u2 \gset
SELECT public.t_claims('00000000-0000-0000-0000-000000000001');
SELECT public.t_gida(:'shown_a_id') AS g_u1 \gset
SELECT public.t_claims('00000000-0000-0000-0000-000000000004');
SELECT public.t_gida(:'shown_a_id') AS g_u4 \gset
RESET ROLE;
SELECT public.t_assert(:'g_anon'::jsonb ->> 'scene_type' = 'engine_bay' AND :'g_anon' NOT LIKE '%TST%' AND :'g_anon'::jsonb ->> 'place_hint' IS NULL
  AND :'g_anon'::jsonb ->> 'agent_notes' IS NULL AND :'g_u2'::jsonb = :'g_anon'::jsonb,
  'get_image_deep_analysis, anon and stranger: the photo''s scene, none of the withheld text');
SELECT public.t_assert(:'g_u1'::jsonb ->> 'place_hint' = 'TSTPLACE-H' AND :'g_u1'::jsonb ->> 'agent_notes' LIKE 'TSTNOTE%'
  AND :'g_u4'::jsonb = :'g_u1'::jsonb, 'get_image_deep_analysis, uploader and tied mechanic: every field');

-- 12. The free-text check: no long string in the fixture escapes a rule; a new model-text path is reported.
SELECT public.t_assert((SELECT count(*) FROM public.vehicle_images vi, public.image_scan_text_path_gaps(vi.ai_scan_metadata) g) = 0,
  'free-text check: every string longer than 40 characters in the fixture sits under a rule');
SELECT public.t_assert((SELECT array_agg(g ORDER BY g) FROM public.image_scan_text_path_gaps(
    '{"new_reader": {"notes": [{"text": "a model sentence that names a street and a town and runs long"}]}, "route_result": "routed to the deep reader after the classifier marked it"}'::jsonb) g)
  = '{new_reader.notes.[].text}'::text[], 'free-text check: a new long-string path is reported (array steps as []), a reviewed one is not');
SELECT public.t_assert(NOT has_function_privilege('anon', 'public.image_scan_text_path_gaps(jsonb,integer,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.image_scan_text_path_gaps(jsonb,integer,text)', 'EXECUTE'), 'free-text check: service_role only');

-- 13. The rules are compiled once, not rebuilt per photo: the view's plan has no image_scan_rules call; the compiled row
--     equals image_scan_rules(); a change to the rule table recompiles it (statement trigger, rolled back).
SELECT public.t_claims(''); SET ROLE anon;
CREATE TEMP TABLE t_rplan (l text);
DO $$ DECLARE l text; BEGIN
  FOR l IN EXECUTE $q$EXPLAIN (ANALYZE, VERBOSE, COSTS OFF, TIMING OFF, SUMMARY OFF) SELECT ai_scan_metadata -> 'classification' FROM public.vehicle_images_public$q$ LOOP
    INSERT INTO t_rplan VALUES (l);
  END LOOP;
END $$;
RESET ROLE;
SELECT string_agg(l, E'\n') AS rplan FROM t_rplan \gset
SELECT public.t_assert(:'rplan' NOT LIKE '%image_scan_rules(%' AND :'rplan' LIKE '%vehicle_image_scan_metadata(vi.id)%',
  'plan: no image_scan_rules call; one vehicle_image_scan_metadata(vi.id) per row');
BEGIN;
SET LOCAL track_functions = 'all';
SELECT public.t_claims(''); SET ROLE anon;
SELECT count(*) AS n_view_rows, count(x.c) AS n_evaluated FROM (SELECT ai_scan_metadata -> 'classification' AS c FROM public.vehicle_images_public) x \gset
RESET ROLE;
SELECT coalesce(pg_stat_get_xact_function_calls('public.image_scan_rules(text)'::regprocedure), 0) AS rules_calls,
       coalesce(pg_stat_get_xact_function_calls('public.vehicle_image_scan_metadata(uuid)'::regprocedure), 0) AS wrapper_calls \gset
COMMIT;
SELECT public.t_assert(:rules_calls = 0 AND :wrapper_calls = :n_view_rows,
  format('calls: image_scan_rules 0 times, vehicle_image_scan_metadata once per row (%s, %s rows)', :rules_calls, :wrapper_calls));
SELECT public.t_assert((SELECT rules = public.image_scan_rules('vehicle_images.ai_scan_metadata') AND rule_rows = 37
                          FROM public.image_scan_rules_compiled WHERE surface = 'vehicle_images.ai_scan_metadata'),
  'compiled rules: equal to image_scan_rules() over the 37 rule rows');
BEGIN;
INSERT INTO public.image_scan_withheld_paths (rule_kind, path, reason, basis) VALUES ('path', '{scene_class}', 'test', 'test');
SELECT (SELECT rule_rows FROM public.image_scan_rules_compiled WHERE surface = 'vehicle_images.ai_scan_metadata') AS rows_after_insert \gset
SELECT public.t_claims(''); SET ROLE anon;
SELECT (SELECT e -> 'm' FROM jsonb_array_elements(public.t_view_read()) e WHERE e ->> 'l' = 'shown_a') ? 'scene_class' AS scene_after_insert \gset
RESET ROLE;
ROLLBACK;
SELECT public.t_assert(:rows_after_insert = 38 AND NOT :'scene_after_insert'::boolean,
  'trigger: a new rule row recompiles the rules and applies on the next read');

-- 14. A rule on a whole object and one inside it: the whole object goes, the siblings stay (rolled back).
BEGIN;
INSERT INTO public.image_scan_withheld_paths (rule_kind, path, reason, basis)
  VALUES ('free_text', '{byok_deep_analysis,presence}', 'test', 'test');
SELECT public.t_claims(''); SET ROLE anon;
SELECT (SELECT e -> 'm' -> 'byok_deep_analysis' FROM jsonb_array_elements(public.t_view_read()) e WHERE e ->> 'l' = 'shown_a') AS nested_b \gset
RESET ROLE;
ROLLBACK;
SELECT public.t_assert(NOT (:'nested_b'::jsonb ? 'presence') AND :'nested_b'::jsonb -> 'camera_pose' = '{"yaw": 10}'
  AND :'nested_b'::jsonb ->> 'scene_type' = 'engine_bay', 'overlapping rules: {presence} and {presence,place_hint} remove presence, keep the siblings');

-- 15. The plate inside a kept string is replaced and the JSON stays valid; a plate that matches a bare number breaks the
--     JSON text, and the photo's analysis is withheld whole rather than served (fixture rows, rolled back).
-- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture)
BEGIN;
UPDATE public.vehicles SET license_plate = '48-2915' WHERE id = 'a0000000-0000-0000-0000-00000000000a';
UPDATE public.vehicle_images SET ai_scan_metadata = ai_scan_metadata || '{"seen_at": "2026-11-25 48 2915"}'
 WHERE public.t_label2(id) = 'shown_a';
SELECT public.t_claims(''); SET ROLE anon;
SELECT (SELECT e -> 'm' FROM jsonb_array_elements(public.t_view_read()) e WHERE e ->> 'l' = 'shown_a') AS plate_str \gset
RESET ROLE;
UPDATE public.vehicle_images SET ai_scan_metadata = ai_scan_metadata || '{"odometer_reading": 482915}'
 WHERE public.t_label2(id) = 'shown_a';
SET ROLE anon;
SELECT (SELECT e -> 'm' FROM jsonb_array_elements(public.t_view_read()) e WHERE e ->> 'l' = 'shown_a') AS plate_num \gset
RESET ROLE;
ROLLBACK;
SELECT public.t_assert(:'plate_str'::jsonb ->> 'seen_at' = '2026-11-25 [withheld]' AND :'plate_str'::jsonb ->> 'scene_class' = 'exterior',
  'value redaction: the plate in a kept string, written with other separators, is replaced; the rest stays');
SELECT public.t_assert(:'plate_num'::jsonb = '{"withheld": true}', 'value redaction that would break the JSON: the analysis is withheld whole');

-- 17. The plate oracle is closed. Nothing anon or a stranger can execute takes a document: the worker (both forms) and
--     image_scan_rules refuse (42501); a document-taking form of the callable does not exist (42883); the catalog holds
--     no anon- or authenticated-executable function that reaches the worker with a jsonb, json, text or rule-array
--     argument. The callable takes an image id: NULL for a photo the caller may not see, stripped for a shown one,
--     whole for the uploader.
CREATE FUNCTION public.t_sqlstate(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
GRANT EXECUTE ON FUNCTION public.t_sqlstate(text) TO anon, authenticated;
SELECT id AS plate_a_id FROM public.vehicle_images WHERE public.t_label2(id) = 'plate_a' \gset
SELECT id AS document_a_id FROM public.vehicle_images WHERE public.t_label2(id) = 'document_a' \gset
SELECT id AS photog_a_id FROM public.vehicle_images WHERE public.t_label2(id) = 'photog_a' \gset
CREATE TEMP TABLE t_oracle (who text, k text, v text);
GRANT INSERT, SELECT ON t_oracle TO anon, authenticated;
DO $$ BEGIN PERFORM 1; END $$;
SELECT public.t_claims(''); SET ROLE anon;
INSERT INTO t_oracle VALUES
  ('anon', 'worker4', public.t_sqlstate($q$SELECT public.image_scan_metadata_for_viewer('{"x": "tst-pl8 9"}'::jsonb, NULL, 'a0000000-0000-0000-0000-00000000000a', ARRAY[ROW('vehicle_value', '{}', '{}', 0, 'license_plate', '', 4)::public.image_scan_rule])$q$)),
  ('anon', 'worker3', public.t_sqlstate($q$SELECT public.image_scan_metadata_for_viewer('{"x": "tst-pl8 9"}'::jsonb, NULL, 'a0000000-0000-0000-0000-00000000000a')$q$)),
  ('anon', 'rules', public.t_sqlstate($q$SELECT public.image_scan_rules('vehicle_images.ai_scan_metadata')$q$)),
  ('anon', 'doc_form', public.t_sqlstate($q$SELECT public.vehicle_image_scan_metadata('{"x": "tst-pl8 9"}'::jsonb)$q$)),
  ('anon', 'hidden', (public.vehicle_image_scan_metadata(:'document_a_id') IS NULL)::text),
  ('anon', 'shown', (SELECT (m IS NOT NULL AND m::text NOT LIKE '%TST%')::text FROM (SELECT public.vehicle_image_scan_metadata(:'shown_a_id') m) x)),
  ('anon', 'missing', (public.vehicle_image_scan_metadata('99999999-0000-0000-0000-000000000000') IS NULL)::text);
SELECT public.t_claims('00000000-0000-0000-0000-000000000002'); SET ROLE authenticated;
INSERT INTO t_oracle VALUES
  ('stranger', 'worker4', public.t_sqlstate($q$SELECT public.image_scan_metadata_for_viewer('{"x": "tst-pl8 9"}'::jsonb, NULL, 'a0000000-0000-0000-0000-00000000000a', ARRAY[ROW('vehicle_value', '{}', '{}', 0, 'license_plate', '', 4)::public.image_scan_rule])$q$)),
  ('stranger', 'worker3', public.t_sqlstate($q$SELECT public.image_scan_metadata_for_viewer('{"x": "tst-pl8 9"}'::jsonb, NULL, 'a0000000-0000-0000-0000-00000000000a')$q$)),
  ('stranger', 'hidden', (public.vehicle_image_scan_metadata(:'document_a_id') IS NULL)::text);
SELECT public.t_claims('00000000-0000-0000-0000-000000000003');
INSERT INTO t_oracle VALUES
  ('uploader', 'own', (SELECT (public.vehicle_image_scan_metadata(:'photog_a_id') = ai_scan_metadata)::text FROM public.vehicle_images WHERE id = :'photog_a_id'));
RESET ROLE;
-- a hidden photo with no uploader (user_id NULL): still NULL for a signed-in stranger (every term COALESCEd)
-- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture)
BEGIN;
UPDATE public.vehicle_images SET user_id = NULL WHERE id = :'document_a_id';
SELECT public.t_claims('00000000-0000-0000-0000-000000000002'); SET ROLE authenticated;
SELECT (public.vehicle_image_scan_metadata(:'document_a_id') IS NULL)::text AS hnu \gset
RESET ROLE;
ROLLBACK;
INSERT INTO t_oracle VALUES ('stranger', 'hidden_null_uploader', :'hnu');
SELECT string_agg(who || '.' || k || '=' || v, ' ' ORDER BY who, k) AS oracle_rows FROM t_oracle \gset
SELECT public.t_assert(:'oracle_rows' = 'anon.doc_form=42883 anon.hidden=true anon.missing=true anon.rules=42501 anon.shown=true anon.worker3=42501 anon.worker4=42501 stranger.hidden=true stranger.hidden_null_uploader=true stranger.worker3=42501 stranger.worker4=42501 uploader.own=true',
  format('oracle: a guessed-plate document cannot be passed by anon or a stranger (42501 / 42883); the callable answers by image id only (%s)', :'oracle_rows'));
SELECT public.t_assert(NOT EXISTS (
    SELECT 1 FROM pg_proc p, unnest(ARRAY['anon', 'authenticated']) r(role)
     WHERE p.pronamespace = 'public'::regnamespace
       AND (p.proname LIKE 'image_scan%' OR p.proname = 'vehicle_image_scan_metadata' OR p.prosrc LIKE '%image_scan_metadata_for_viewer%')
       AND has_function_privilege(r.role, p.oid, 'EXECUTE')
       AND EXISTS (SELECT 1 FROM unnest(p.proargtypes::oid[]) t WHERE t IN ('jsonb'::regtype, 'json'::regtype, 'text'::regtype, 'public.image_scan_rule[]'::regtype))),
  'catalog: no anon- or authenticated-executable function that reaches the worker takes jsonb, json, text or rules');
SELECT public.t_assert((SELECT recorded_hash = 'd00a311fd7235bb19240f3fd812493c4' AND owner_lane = 'ta-policies' FROM public.private_row_policy_copies
                         WHERE reader = 'vehicle_image_scan_metadata(uuid)' AND relation = 'vehicle_images'), 'policy copy registered');

-- 18. The plate after a JSON escape and with other separators (the car's plate is tst-pl8 9; fixture rows, rolled back).
-- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture)
BEGIN;
UPDATE public.vehicle_images SET ai_scan_metadata = ai_scan_metadata || '{"n1": "plate:\nTSTPL89", "n2": "plate:\tTSTPL89",
  "n3": "TST/PL8/9 on the bumper", "n4": "TST.PL8.9 on the bumper", "n5": "TST\nPL89", "n6": "TSTPL890 is longer"}'::jsonb
 WHERE public.t_label2(id) = 'shown_a';
SELECT public.t_claims(''); SET ROLE anon;
SELECT public.vehicle_image_scan_metadata(:'shown_a_id') AS esc \gset
RESET ROLE;
ROLLBACK;
SELECT public.t_assert(:'esc'::jsonb ->> 'n1' = E'plate:\n[withheld]' AND :'esc'::jsonb ->> 'n2' = E'plate:\t[withheld]',
  format('plate after a JSON escape (newline, tab): replaced, the escape kept (%s, %s)', :'esc'::jsonb -> 'n1', :'esc'::jsonb -> 'n2'));
SELECT public.t_assert(:'esc'::jsonb ->> 'n3' = '[withheld] on the bumper' AND :'esc'::jsonb ->> 'n4' = '[withheld] on the bumper'
  AND :'esc'::jsonb ->> 'n5' = '[withheld]' AND :'esc'::jsonb ->> 'n6' = 'TSTPL890 is longer',
  format('plate slash-, dot- and newline-separated: replaced; inside a longer token: kept (%s)', :'esc'));

-- 18b. A vehicles column the role may select is not withheld: with license_plate granted to authenticated, a stranger
--      reads the plate inside the kept label (rolled back).
BEGIN;
GRANT SELECT (license_plate) ON public.vehicles TO authenticated;
SELECT public.t_claims('00000000-0000-0000-0000-000000000002'); SET ROLE authenticated;
SELECT public.vehicle_image_scan_metadata(:'shown_a_id')::text LIKE '%plate reads TST PL8-9%' AS plate_granted \gset
RESET ROLE;
ROLLBACK;
SELECT public.t_assert(:'plate_granted'::boolean, 'vehicle_value: not applied when the request role may select the column');

-- 19. Time does not say whether a plate is on file: the same 24 KB document on two shown photos of two public cars, one
--     with a plate on file and one without, 200 interleaved calls each way as anon; medians within 15%.
-- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture)
BEGIN;
INSERT INTO public.vehicles SELECT (jsonb_populate_record(v, jsonb_build_object('id', 'a0000000-0000-0000-0000-0000000000ee', 'license_plate', NULL))).*
  FROM public.vehicles v WHERE v.id = 'a0000000-0000-0000-0000-00000000000a';
INSERT INTO public.vehicle_images SELECT (jsonb_populate_record(i, jsonb_build_object('id', '10000000-0000-0000-0000-0000000000ee',
    'vehicle_id', 'a0000000-0000-0000-0000-0000000000ee', 'image_url', 'https://x.invalid/ee.jpg'))).*
  FROM public.vehicle_images i WHERE i.id = '10000000-0000-0000-0000-000000000008';
UPDATE public.vehicle_images SET ai_scan_metadata = jsonb_build_object('classifier', 'fixture',
    'byok_deep_analysis', jsonb_build_object('scene_type', 'engine_bay', 'presence', jsonb_build_object('place_hint', 'TSTPLACE-H'),
      'components_seen', (SELECT jsonb_agg(jsonb_build_object('label', 'component label number ' || k || ' with a long description', 'confidence', 0.7)) FROM generate_series(1, 300) k)))
 WHERE id IN ('10000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-0000000000ee');
CREATE FUNCTION public.t_time_pair(a uuid, b uuid, n integer) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE ta float8[] := '{}'; tb float8[] := '{}'; t0 timestamptz; x jsonb; i integer;
BEGIN
  FOR i IN 1 .. 20 LOOP x := public.vehicle_image_scan_metadata(a); x := public.vehicle_image_scan_metadata(b); END LOOP;
  FOR i IN 1 .. n LOOP
    IF i % 2 = 0 THEN
      t0 := clock_timestamp(); x := public.vehicle_image_scan_metadata(a); ta := ta || extract(epoch FROM clock_timestamp() - t0)::float8;
      t0 := clock_timestamp(); x := public.vehicle_image_scan_metadata(b); tb := tb || extract(epoch FROM clock_timestamp() - t0)::float8;
    ELSE
      t0 := clock_timestamp(); x := public.vehicle_image_scan_metadata(b); tb := tb || extract(epoch FROM clock_timestamp() - t0)::float8;
      t0 := clock_timestamp(); x := public.vehicle_image_scan_metadata(a); ta := ta || extract(epoch FROM clock_timestamp() - t0)::float8;
    END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'plate_us', round(((SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY v) FROM unnest(ta) v) * 1e6)::numeric, 1),
    'none_us', round(((SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY v) FROM unnest(tb) v) * 1e6)::numeric, 1),
    'same_out', public.vehicle_image_scan_metadata(a) = public.vehicle_image_scan_metadata(b),
    'stripped', NOT (public.vehicle_image_scan_metadata(a) -> 'byok_deep_analysis' -> 'presence' ? 'place_hint'));
END $$;
-- Up to three trials of 200 pairs; the first inside the bound is kept. A shared CI runner can stall one trial; the
-- early-exit mutant measured 0.69 and fails every trial.
CREATE FUNCTION public.t_time_best(a uuid, b uuid, n integer) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb; k integer;
BEGIN
  FOR k IN 1 .. 3 LOOP
    r := public.t_time_pair(a, b, n) || jsonb_build_object('trial', k);
    EXIT WHEN (r ->> 'plate_us')::numeric / nullif((r ->> 'none_us')::numeric, 0) BETWEEN 0.87 AND 1.15;
  END LOOP;
  RETURN r;
END $$;
GRANT EXECUTE ON FUNCTION public.t_time_pair(uuid, uuid, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.t_time_best(uuid, uuid, integer) TO anon;
SELECT public.t_claims(''); SET ROLE anon;
SELECT public.t_time_best('10000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-0000000000ee', 200) AS tp \gset
RESET ROLE;
ROLLBACK;
SELECT public.t_assert((:'tp'::jsonb ->> 'same_out')::boolean AND (:'tp'::jsonb ->> 'stripped')::boolean
  AND (:'tp'::jsonb ->> 'plate_us')::numeric / (:'tp'::jsonb ->> 'none_us')::numeric BETWEEN 0.87 AND 1.15,
  format('timing: plate on file vs none, same document, medians within 15%% (%s)', :'tp'));

-- 16. The revert applies: the 2026-11-25 bodies come back (its own md5 checks) and the new objects are gone.
\ir revert_20261125200000_scan_metadata_withheld_paths.sql
SELECT public.t_assert(to_regtype('public.image_scan_rule') IS NULL AND to_regclass('public.image_scan_withheld_paths') IS NULL
  AND to_regprocedure('public.image_scan_rules(text)') IS NULL AND to_regprocedure('public.image_scan_text_path_gaps(jsonb,integer,text)') IS NULL
  AND to_regprocedure('public.vehicle_image_scan_metadata(uuid)') IS NULL AND to_regclass('public.image_scan_rules_compiled') IS NULL
  AND to_regprocedure('public.image_scan_rules_compile()') IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.private_row_policy_copies WHERE reader = 'vehicle_image_scan_metadata(uuid)'),
  'revert: rule table, type and helpers dropped, live bodies restored');

SELECT 'scan_metadata_withheld_paths contract: PASS' AS result;
