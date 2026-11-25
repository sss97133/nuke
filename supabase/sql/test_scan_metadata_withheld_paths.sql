-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_<name> -f supabase/sql/test_scan_metadata_withheld_paths.sql
-- Proves 20261125200000_scan_metadata_withheld_paths.sql:
--   * vehicle_images_public keeps production's column list, order and types (signature md5 as read 2026-11-25),
--     security_invoker and grants; only ai_scan_metadata changes.
--   * anon and a signed-in stranger get no withheld path on any photo (place_hint, the four OCR-text paths, document
--     fields, license_plate, location, extracted_text, person_visible, recipient, shipment_number, price,
--     cost_basis_input), checked against a list written here, independent of the rule table; every other key, siblings
--     of a withheld key included, comes back as stored.
--   * the uploader (an untied photographer included), a viewer tied to the vehicle, service_role and a direct database
--     session still get every key.
--   * vehicle_image_findings: anon and a stranger get gallery-eligible frames only (no document, no privacy-withheld
--     frame) and no license_plate; the owner and a tied viewer get every frame they read with license_plate; an untied
--     uploader gets their own frame's plate only.
--   * a whole-row gallery test over the view (the #3868 policy shape) never calls the helper (plan text).
--   * deleting the place_hint rule row brings place_hint back to anon (the rule row is what withholds it).
-- Which assertion fails if a rule row is removed from the migration: "rule rows: 14 paths" and, with that count
-- changed to match, "anon: no withheld path on any photo (fixed list)" (mutation run 2026-11-25).
-- Fixture: supabase/sql/fixtures/photo_reading_select_base.sql, then production's full vehicle_images column list and
-- the live vehicle_images_public definition (pg_get_viewdef md5 checked) with its gallery overload re-created verbatim.
-- Fixture rows only, in a disposable database. -- ALLOW_RAW_TESTIMONY_WRITE
\ir fixtures/photo_reading_select_base.sql

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
  "classification": {"label": "exterior", "detected_text": ["TSTOCR-D"],
    "v2": {"vin": {"value": "1GKEV18K8LF000000"}, "text_lines": [{"text": "TSTOCR-L", "confidence": 0.9}],
      "document": {"kind": "receipt", "fields": {"owner_address": "TSTPLACE-A", "vendor_phone": "TSTPHONE"}}}},
  "deep_analysis": {"subject": {"kind": "engine", "text_visible": ["TSTOCR-V"]}},
  "full_classification": {"person_visible": {"name": "TSTPERSON-N", "technician_id": 7}, "kept": 1},
  "byok_deep_analysis": {"scene_type": "engine_bay", "narrative_one_line": "kept narrative",
    "presence": {"person": false, "dog": false, "place_hint": "TSTPLACE-H"},
    "text_regions": [{"text": "TSTOCR-T", "bbox": [0, 0, 1, 1], "confidence": 0.9}]}}'::jsonb
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

\ir ../migrations/20261125200000_scan_metadata_withheld_paths.sql

-- 1. Shape.
SELECT public.t_assert((SELECT md5(string_agg(attname || ' ' || format_type(atttypid, atttypmod), ',' ORDER BY attnum)) FROM pg_attribute
          WHERE attrelid = 'public.vehicle_images_public'::regclass AND attnum > 0 AND NOT attisdropped) = :'sig_before'
  AND (SELECT reloptions::text || relacl::text || pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public.vehicle_images_public'::regclass) = :'opts_before',
  'view: same 156 columns, names, order and types; same security_invoker, grants and owner');
SELECT public.t_assert((SELECT count(*) FROM public.image_scan_withheld_paths WHERE basis LIKE 'census 2026-11-25%') = 14,
  'rule rows: 14 paths, each with its census basis');
SELECT public.t_assert(NOT has_table_privilege('anon', 'public.image_scan_withheld_paths', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.image_scan_withheld_paths', 'SELECT'), 'rule table: not readable by anon or authenticated');

-- The paths withheld, written here (not read from the rule table), and the reader of what a caller got.
CREATE FUNCTION public.t_withheld_hits(p jsonb) RETURNS bigint LANGUAGE sql IMMUTABLE AS $$
  SELECT count(*) FROM jsonb_array_elements(p) e, unnest(ARRAY[
    '{byok_deep_analysis,presence,place_hint}', '{byok_deep_analysis,text_regions}', '{license_plate}', '{location}',
    '{extracted_text}', '{full_classification,person_visible}', '{recipient}', '{shipment_number}', '{price}',
    '{cost_basis_input}', '{classification,detected_text}', '{classification,v2,text_lines}',
    '{classification,v2,document,fields}', '{deep_analysis,subject,text_visible}']::text[]) AS w(path)
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
SELECT public.t_assert((SELECT e -> 'm' FROM jsonb_array_elements(:'anon_read'::jsonb) e WHERE e ->> 'l' = 'shown_a')
  = '{"classifier": "fixture", "scene_class": "exterior", "full_classification": {"kept": 1},
      "classification": {"label": "exterior", "v2": {"vin": {"value": "1GKEV18K8LF000000"}, "document": {"kind": "receipt"}}},
      "deep_analysis": {"subject": {"kind": "engine"}},
      "byok_deep_analysis": {"scene_type": "engine_bay", "narrative_one_line": "kept narrative", "presence": {"person": false, "dog": false}}}'::jsonb,
  'anon: shown_a keeps every other key as stored (scene, narrative, presence flags, siblings of a withheld key)');
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
SELECT public.t_assert(public.t_withheld_hits((SELECT jsonb_agg(e) FROM jsonb_array_elements(:'u3_read'::jsonb) e WHERE e ->> 'l' = 'photog_a')) = 14,
  'untied uploader: all 14 withheld paths on their own photo');

-- 5. Tied viewers: the owner (u1) and A's mechanic (u4) read every key on A's photos, the mechanic on u3's photo too.
SELECT public.t_claims('00000000-0000-0000-0000-000000000001'); SET ROLE authenticated;
SELECT public.t_view_read() AS u1_read \gset
SELECT public.t_claims('00000000-0000-0000-0000-000000000004');
SELECT public.t_view_read() AS u4_read \gset
RESET ROLE;
SELECT public.t_assert((SELECT bool_and(e::text LIKE '%TSTPLACE-H%' AND e::text LIKE '%TSTPLATE1%') FROM jsonb_array_elements(:'u1_read'::jsonb) e WHERE e ->> 'l' <> 'clean_a')
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
SELECT public.t_assert(public.t_withheld_hits(:'svc_read'::jsonb) = 112 AND public.t_withheld_hits(:'db_read'::jsonb) = 112,
  format('service_role and a direct session: all 14 paths on all 8 photos that carry them (%s, %s)', public.t_withheld_hits(:'svc_read'::jsonb), public.t_withheld_hits(:'db_read'::jsonb)));

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

-- 8. Whole-row uses of the view never call the helper (the gallery overload and the #3868 policy shape inline).
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
SELECT bool_and(plan NOT LIKE '%image_scan_metadata_for_viewer%') FILTER (WHERE q <> 'projections') AS no_helper,
       bool_and(plan LIKE '%vehicle_image_privacy_withheld%') FILTER (WHERE q <> 'projections') AS inlined,
       -- an evaluated call prints bare after "Output: "; a later node's use of its result prints in parentheses
       max((length(plan) - length(replace(plan, 'Output: image_scan_metadata_for_viewer(', ''))) / length('Output: image_scan_metadata_for_viewer(')) FILTER (WHERE q = 'projections') AS helper_calls
  FROM t_plans \gset
RESET ROLE;
SELECT public.t_assert(:'no_helper'::boolean AND :'inlined'::boolean, 'plan: whole-row gallery tests over the view inline and never call image_scan_metadata_for_viewer');
SELECT public.t_assert(:helper_calls = 1, format('plan: three projections of ai_scan_metadata evaluate the helper in one plan node, once per row (%s evaluating nodes)', :helper_calls));

-- 9. The rule row is what withholds: without the place_hint row, anon reads place_hint again (rolled back).
BEGIN;
DELETE FROM public.image_scan_withheld_paths WHERE path = '{byok_deep_analysis,presence,place_hint}';
SELECT public.t_claims(''); SET ROLE anon;
SELECT public.t_view_read()::text LIKE '%TSTPLACE-H%' AS back_without_rule \gset
RESET ROLE;
ROLLBACK;
SELECT public.t_assert(:'back_without_rule'::boolean, 'rule rows drive it: deleting the place_hint row returns place_hint to anon');

SELECT 'scan_metadata_withheld_paths contract: PASS' AS result;
