-- Withheld paths of vehicle_images.ai_scan_metadata: rule rows, applied wherever anon reads that jsonb.
--
-- The defect (measured 2026-11-25, read-only). latitude, longitude, location_name and exif_data are revoked from anon,
-- but the jsonb ai_scan_metadata is not, and the deep image reader writes a place description into it. As anon on one
-- public car (83f6f033), 20 of 20 sampled shown photos returned byok_deep_analysis.presence.place_hint through
-- vehicle_images_public, and vehicle_image_findings returned license_plate on 9 frames (it reads the table with no
-- gallery test, so it also served frames the gallery hides: 2,387 frames against the gallery's 2,157).
--
-- Basis: a key census of ai_scan_metadata by key name and count, never values (32,386 rows of the 5 uploaders whose
-- metadata is an object, 14,574 of them on shown photos, paths to depth 4; then depth 8 for place, person, contact,
-- OCR-text and money leaf names over 32,374 of those rows, one dense week re-run in 6-hour slices; a 0.02% block
-- sample of every uploader's rows to depth 5 found no further name; posted on the TransAm board 2026-11-25). Every
-- path that names a place, a plate, a person, OCR text, a document's personal fields or money became a rule row; each
-- row carries its census count.
-- Not withheld (checked): classification.v2.vin* and classification.vin_detected (the VIN is a public column of the
-- view), plate_fields.* (a data/trim plate), presence.person/dog and on_device_vision flags (booleans), appraiser.context
-- (a label the tiering writer composes), classifier cost receipts, narratives and scene/phase labels.
--
-- The fix, in one transaction:
--   1. public.image_scan_withheld_paths (surface, path text[], reason, basis): the rule rows. Readable by service_role
--      only; anon and authenticated never read it directly (the helper below is SECURITY DEFINER).
--   2. public.image_scan_metadata_for_viewer(meta, uploader, vehicle): returns meta unchanged when it carries none of the
--      rule paths, or when the caller is service_role, a direct database session (no request claims, not PostgREST's
--      authenticator: the idiom of vehicle_image_privacy_withheld), the photo's uploader, or tied to its vehicle
--      (vehicle_viewer_tied). Otherwise it returns meta with every rule path removed (jsonb #-). The tie is looked up
--      only for a row that carries a rule path. COST 1, so a whole-row use of the view (vehicle_image_gallery_eligible
--      (vehicle_images_public), the #3868 policies) still inlines and never calls it.
--   3. CREATE OR REPLACE VIEW vehicle_images_public: the live column list, names, order and types unchanged
--      (2026-11-25 pg_get_viewdef md5 21ad7028a04d54602de5c195f175cdf2), security_invoker kept; ai_scan_metadata is
--      the helper's result. No other column changes. No DDL on vehicle_images.
--   4. vehicle_image_findings reads vehicle_images_public (so the rule paths are gone for untied callers) and states the
--      gallery test: an untied caller who is not the uploader gets only gallery-eligible frames.
--
-- Not in this migration (named in the PR): the table itself still serves the raw jsonb. anon holds a column grant on
-- vehicle_images.ai_scan_metadata and authenticated holds table SELECT, and logged-out pages (the lightbox, the
-- analysis stream) select it from the table. The grant cannot simply be revoked: this view is security_invoker and
-- reads vi.ai_scan_metadata, so without the grant anon's read of the view fails 42501 (checked on PG17). Closing the
-- table path needs the helper to read the jsonb itself by photo id (SECURITY DEFINER), so the view no longer names the
-- column; then those pages move to the view, then the grant is revoked. The same deep verdict is copied into
-- vehicle_observations.structured_data (image_deep_byok), which anon also reads; that is a table and gets its own fix.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.image_scan_withheld_paths (
  surface text NOT NULL DEFAULT 'vehicle_images.ai_scan_metadata'
    CHECK (surface IN ('vehicle_images.ai_scan_metadata', 'vehicle_observations.structured_data')),
  path text[] NOT NULL CHECK (cardinality(path) BETWEEN 1 AND 8 AND array_position(path, NULL) IS NULL),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  basis text NOT NULL CHECK (btrim(basis) <> ''),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (surface, path)
);
ALTER TABLE public.image_scan_withheld_paths ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.image_scan_withheld_paths FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.image_scan_withheld_paths TO service_role;
COMMENT ON TABLE public.image_scan_withheld_paths IS
  'Rule rows: jsonb paths removed from a photo''s analysis for a caller who is not its uploader, not tied to its vehicle and not service_role. surface vehicle_images.ai_scan_metadata is applied by image_scan_metadata_for_viewer (vehicle_images_public, vehicle_image_findings). basis cites the key census that found the path (counts only).';

INSERT INTO public.image_scan_withheld_paths (surface, path, reason, basis) VALUES
  ('vehicle_images.ai_scan_metadata', '{byok_deep_analysis,presence,place_hint}', 'place: the deep reader''s description of where the photo was taken (latitude, longitude and location_name are already revoked from anon)',
   'census 2026-11-25: 12,941 rows carry it, 12,703 non-empty text, 10,550 on shown photos'),
  ('vehicle_images.ai_scan_metadata', '{byok_deep_analysis,text_regions}', 'OCR text read off the frame (plates, signs, addresses); a region''s text cannot be told safe by path',
   'census 2026-11-25: 12,940 rows carry it, 4,769 with regions and text, 3,680 on shown photos'),
  ('vehicle_images.ai_scan_metadata', '{classification,detected_text}', 'OCR text read off the frame by the classifier (plates, signs, addresses)',
   'census 2026-11-25: 20,210 rows carry it, 8,062 with text, 2,450 of those on shown photos'),
  ('vehicle_images.ai_scan_metadata', '{classification,v2,text_lines}', 'OCR text lines read off the frame by the v2 classifier (plates, signs, addresses)',
   'census 2026-11-25: 18,417 rows carry it, 6,905 with lines (6,523 with text at depth 8), 1,803 of those on shown photos'),
  ('vehicle_images.ai_scan_metadata', '{classification,v2,document,fields}', 'document fields read off a paper: names, addresses, phones, emails, birth places, bank details, amounts, plates',
   'census 2026-11-25 (depth 8): fields.names 217 rows, amounts 149, vendor_address 38, owner_address 31, owner_names 27, vendor_phone 27, addresses 20, buyer_name 7, license_plate 6 (per key, rows can overlap); on shown photos: 1 in the first pass, names 2 and amounts 2 in the re-run week'),
  ('vehicle_images.ai_scan_metadata', '{deep_analysis,subject,text_visible}', 'OCR text read off the frame by the older deep reader',
   'census 2026-11-25: 624 rows carry it, 440 with text, 139 of those on shown photos'),
  ('vehicle_images.ai_scan_metadata', '{license_plate}', 'plate: vehicles.license_plate is revoked from anon (#3902)',
   'census 2026-11-25: 16 rows, 16 non-empty text, 9 on shown photos'),
  ('vehicle_images.ai_scan_metadata', '{location}', 'place',
   'census 2026-11-25: 1 row, non-empty text, on a shown photo'),
  ('vehicle_images.ai_scan_metadata', '{extracted_text}', 'OCR text read off the frame',
   'census 2026-11-25: 1 row, non-empty text, on a shown photo'),
  ('vehicle_images.ai_scan_metadata', '{full_classification,person_visible}', 'person: a visible person''s name and identifiers',
   'census 2026-11-25: 1 row (person_visible.name non-empty), on a shown photo'),
  ('vehicle_images.ai_scan_metadata', '{recipient}', 'person: a shipment recipient',
   'census 2026-11-25: 1 row, non-empty text, on a shown photo'),
  ('vehicle_images.ai_scan_metadata', '{shipment_number}', 'shipping identifier',
   'census 2026-11-25: 1 row, non-empty text, on a shown photo'),
  ('vehicle_images.ai_scan_metadata', '{price}', 'money amount read off a document',
   'census 2026-11-25: 1 row, on a shown photo'),
  ('vehicle_images.ai_scan_metadata', '{cost_basis_input}', 'money amount',
   'census 2026-11-25: 1 row, on a shown photo')
ON CONFLICT (surface, path) DO NOTHING;

CREATE OR REPLACE FUNCTION public.image_scan_metadata_for_viewer(p_meta jsonb, p_user_id uuid, p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER COST 1
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_out jsonb := p_meta;
  v_hit boolean := false;
  v_path text[];
  v_uid uuid;
BEGIN
  IF p_meta IS NULL OR jsonb_typeof(p_meta) <> 'object' THEN
    RETURN p_meta;
  END IF;
  FOR v_path IN SELECT r.path FROM public.image_scan_withheld_paths r WHERE r.surface = 'vehicle_images.ai_scan_metadata' LOOP
    IF v_out #> v_path IS NOT NULL THEN
      v_out := v_out #- v_path;
      v_hit := true;
    END IF;
  END LOOP;
  IF NOT v_hit THEN
    RETURN p_meta;
  END IF;
  -- service_role, or a direct database session (cron, a job, a fold): no request claims and not PostgREST's authenticator
  IF auth.role() = 'service_role' OR (auth.role() IS NULL AND session_user <> 'authenticator') THEN
    RETURN p_meta;
  END IF;
  v_uid := auth.uid();
  IF v_uid IS NOT NULL AND (p_user_id = v_uid OR public.vehicle_viewer_tied(p_vehicle_id)) THEN
    RETURN p_meta;
  END IF;
  RETURN v_out;
END
$function$;
REVOKE ALL ON FUNCTION public.image_scan_metadata_for_viewer(jsonb, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.image_scan_metadata_for_viewer(jsonb, uuid, uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.image_scan_metadata_for_viewer(jsonb, uuid, uuid) IS
  'A photo''s ai_scan_metadata as the caller may read it: the image_scan_withheld_paths rule paths removed unless the caller is service_role, a direct database session, the uploader (p_user_id) or tied to the vehicle (vehicle_viewer_tied). COST 1 so whole-row uses of vehicle_images_public keep inlining.';

-- The live view (2026-11-25), column for column; only ai_scan_metadata goes through the helper, once per row: the
-- LATERAL (... OFFSET 0) keeps the call out of each projection (a gallery read projects ai_scan_metadata 13 times;
-- inlined, that was 13 calls a row: 394 ms against 48 ms raw on a 3,040-photo PG17 fixture, 60 ms this way). A read
-- that never names ai_scan_metadata (the whole-row gallery test, a count) drops the unused call.
CREATE OR REPLACE VIEW public.vehicle_images_public WITH (security_invoker = true) AS
 SELECT vi.id,
    vi.vehicle_id,
    vi.user_id,
    vi.image_url,
    vi.image_type,
    vi.category,
    vi."position",
    vi.caption,
    vi.is_primary,
    vi.created_at,
    vi.updated_at,
    vi.timeline_event_id,
    vi.image_context,
    vi.file_hash,
    vi.file_name,
    vi.file_size,
    vi.taken_at,
    vi.source,
    vi.source_url,
    vi.is_external,
    vi.mime_type,
    vi.is_sensitive,
    vi.sensitive_type,
    vi.storage_path,
    vi.safe_preview_url,
    vi.process_stage,
    vi.workflow_role,
    vi.area,
    vi.part,
    vi.damage_type,
    vi.operation,
    vi.materials,
    vi.labels,
    vi.task_id,
    vi.event_id,
    vi.angle,
    vi.perspective,
    vi.thumbnail_url,
    vi.medium_url,
    vi.large_url,
    vi.optimization_status,
    vi.optimized_at,
    vi.variants,
    vi.spatial_tags,
    s.ai_scan_metadata,
    vi.ai_last_scanned,
    vi.ai_component_count,
    vi.ai_avg_confidence,
    vi.filename,
    vi.temp_session_id,
    vi.is_approved,
    vi.approved_by,
    vi.approved_at,
    vi.imported_by,
    vi.ghost_user_id,
    vi.verification_status,
    vi.pending_submission_id,
    vi.image_category,
    vi.approval_status,
    vi.submitted_by,
    vi.redaction_level,
    vi.redacted_by,
    vi.redacted_at,
    vi.redaction_reason,
    vi.uploaded_at,
    vi.analysis_history,
    vi.context_score,
    vi.processing_models_used,
    vi.total_processing_cost,
    vi.rotation,
    vi.document_classification,
    vi.is_document,
    vi.document_category,
    vi.manual_priority,
    vi.display_order,
    vi.user_tags,
    vi.user_notes,
    vi.ai_processing_status,
    vi.ai_processing_started_at,
    vi.ai_processing_completed_at,
    vi.ai_suggestions,
    vi.organization_status,
    vi.organized_at,
    vi.ai_detected_vehicle,
    vi.ai_detected_angle,
    vi.ai_detected_angle_confidence,
    vi.suggested_vehicle_id,
    vi.perceptual_hash,
    vi.dhash,
    vi.duplicate_of,
    vi.is_duplicate,
    vi.documented_by_user_id,
    vi.photographer_attribution,
    vi.user_confirmed_vehicle,
    vi.user_confirmed_vehicle_by,
    vi.user_confirmed_vehicle_at,
    vi.auto_suggested_vehicle_id,
    vi.auto_suggestion_confidence,
    vi.auto_suggestion_reasons,
    vi.angle_confidence,
    vi.yaw_deg,
    vi.yaw_confidence,
    vi.angle_source,
    vi.bbox,
    vi.doc_flag,
    vi.doc_confidence,
    vi.components,
    vi.vehicle_vin,
    vi.vehicle_vin_confidence,
    vi.vehicle_make,
    vi.vehicle_model,
    vi.vehicle_year,
    vi.vehicle_confidence,
    vi.vehicle_source,
    vi.stale,
    vi.last_rerun_at,
    vi.tags,
    vi.ai_extractions,
    vi.ai_extraction_consensus,
    vi.phash,
    vi.condition_score,
    vi.damage_flags,
    vi.modification_flags,
    vi.photo_quality_score,
    vi.vision_analyzed_at,
    vi.vision_model_version,
    vi.surface_coord_v,
    vi.surface_coord_u,
    vi.camera_pose,
    vi.vehicle_zone,
    vi.zone_confidence,
    vi.yono_queued_at,
    vi.interior_quality,
    vi.zone_source,
    vi.fabrication_stage,
    vi.stage_confidence,
    vi.duration_seconds,
    vi.video_codec,
    vi.video_resolution,
    vi.is_video,
    vi.image_vehicle_match_status,
    vi.image_medium,
    vi.apple_ml_labels,
    vi.vehicle_score,
    vi.upload_batch_id,
    vi.work_session_id,
    vi.merged_from_vehicle_id,
    vi.vision_gate_status,
    vi.vision_gate_processed_at,
    vi.vision_gate_agent_reasoning,
    vi.vision_gate_attribution_confidence,
    vi.is_superseded,
    vi.superseded_by,
    vi.superseded_at,
    vi.ai_retry_count,
    vi.image_identity_id
   FROM public.vehicle_images vi
     CROSS JOIN LATERAL (SELECT public.image_scan_metadata_for_viewer(vi.ai_scan_metadata, vi.user_id, vi.vehicle_id) AS ai_scan_metadata OFFSET 0) s;


-- vehicle_image_findings: the same {total, rows} shape and keys, read from the view (rule paths removed for untied
-- callers), with the gallery test stated for a caller who is neither tied to the vehicle nor the frame's uploader.
CREATE OR REPLACE FUNCTION public.vehicle_image_findings(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH viewer AS (
    SELECT (SELECT auth.uid()) AS uid,
           coalesce((SELECT auth.role()) = 'service_role', false)
           OR ((SELECT auth.role()) IS NULL AND session_user <> 'authenticator')
           OR ((SELECT auth.uid()) IS NOT NULL AND public.vehicle_viewer_tied(p_vehicle_id)) AS tied
  ),
  frames AS (
    SELECT j.*, vi.vision_analyzed_at
      FROM public.vehicle_images_public vi
      CROSS JOIN viewer w
      LEFT JOIN LATERAL jsonb_to_record(CASE WHEN jsonb_typeof(vi.ai_scan_metadata) = 'object' THEN vi.ai_scan_metadata END) AS j(
             classifier jsonb, error jsonb, vin jsonb, license_plate jsonb, engine jsonb, engine_guess jsonb, engine_badge jsonb,
             transmission jsonb, color_visible jsonb, interior_trim jsonb, odometer jsonb, mileage_at_listing jsonb, source jsonb,
             part_number jsonb, critical jsonb, privacy_concern jsonb, attribution_concern jsonb, phase jsonb, scene_class jsonb,
             make_guess jsonb, model_guess jsonb, year_guess jsonb, confidence jsonb, byok_deep_analysis jsonb) ON true
     WHERE vi.vehicle_id = p_vehicle_id
       AND (w.tied OR (w.uid IS NOT NULL AND vi.user_id = w.uid) OR public.vehicle_image_gallery_eligible(vi))
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
COMMENT ON FUNCTION public.vehicle_image_findings(uuid) IS
  'The Image analysis card''s read: {total, rows} for the frames of one vehicle the caller may read, at most 5,000 (SECURITY INVOKER over vehicle_images_public, so the vehicle_images row policies and the image_scan_withheld_paths rules apply). A caller who is neither tied to the vehicle nor the frame''s uploader gets gallery-eligible frames only. rows holds, per frame with anything to report, the non-null scalar keys of ai_scan_metadata the card aggregates plus vision_analyzed_at.';

DO $verify$
DECLARE
  v_sig text;
BEGIN
  SELECT md5(string_agg(attname || ' ' || format_type(atttypid, atttypmod), ',' ORDER BY attnum)) INTO v_sig
    FROM pg_attribute WHERE attrelid = 'public.vehicle_images_public'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v_sig IS DISTINCT FROM '7baba6813c194888fb4aec5e60a050d7' THEN
    RAISE EXCEPTION 'vehicle_images_public columns changed (signature %)', v_sig;
  END IF;
  IF NOT coalesce((SELECT 'security_invoker=true' = ANY (reloptions) FROM pg_class WHERE oid = 'public.vehicle_images_public'::regclass), false) THEN
    RAISE EXCEPTION 'vehicle_images_public lost security_invoker';
  END IF;
  IF NOT has_table_privilege('anon', 'public.vehicle_images_public', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.vehicle_images_public', 'SELECT') THEN
    RAISE EXCEPTION 'vehicle_images_public grants changed';
  END IF;
  IF has_table_privilege('anon', 'public.image_scan_withheld_paths', 'SELECT')
     OR has_table_privilege('authenticated', 'public.image_scan_withheld_paths', 'SELECT') THEN
    RAISE EXCEPTION 'image_scan_withheld_paths is readable by anon or authenticated';
  END IF;
  IF (SELECT count(*) FROM public.image_scan_withheld_paths WHERE surface = 'vehicle_images.ai_scan_metadata') < 14 THEN
    RAISE EXCEPTION 'image_scan_withheld_paths is missing rule rows';
  END IF;
  IF NOT (SELECT prosecdef AND procost = 1 AND provolatile = 's' FROM pg_proc WHERE oid = 'public.image_scan_metadata_for_viewer(jsonb,uuid,uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'image_scan_metadata_for_viewer is not SECURITY DEFINER, STABLE, COST 1';
  END IF;
  IF NOT has_function_privilege('anon', 'public.vehicle_image_findings(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.vehicle_image_findings(uuid)', 'EXECUTE')
     OR has_function_privilege('public', 'public.vehicle_image_findings(uuid)', 'EXECUTE')
     OR (SELECT prosecdef FROM pg_proc WHERE oid = 'public.vehicle_image_findings(uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'vehicle_image_findings is not security invoker with anon, authenticated and service_role grants';
  END IF;
END
$verify$;

COMMIT;

-- Live verification (after apply), counts only, with request.jwt.claims = {"role":"anon"} and role anon (and again as
-- authenticated with a random sub: a stranger):
--   select count(*) from (select ai_scan_metadata m from vehicle_images_public where vehicle_id = <83f6f033...>
--     and vehicle_image_gallery_eligible(vehicle_images_public) limit 2000) x
--    where m #> '{byok_deep_analysis,presence,place_hint}' is not null or m #> '{byok_deep_analysis,text_regions}' is not null
--       or m #> '{classification,detected_text}' is not null or m #> '{classification,v2,text_lines}' is not null
--       or m #> '{classification,v2,document,fields}' is not null or m #> '{deep_analysis,subject,text_visible}' is not null
--       or m ?| array['license_plate','location','extracted_text','recipient','shipment_number','price','cost_basis_input']
--       or m #> '{full_classification,person_visible}' is not null                                          -- 0
--   rpc vehicle_image_findings(<83f6f033...>): rows with license_plate 0; total <= the anon gallery count (2,157)
--   The same count FROM vehicle_images (the table) stays above 0 until the follow-up described in the header.
