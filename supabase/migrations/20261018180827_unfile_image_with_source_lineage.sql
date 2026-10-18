-- LOCAL PROPOSAL / HELD: attribution correction only. Not approved for deployment or production calls.
-- Extends the existing service-only writer with a NULL image destination; observations still require a vehicle.
-- Keeps source bytes/clocks/privacy provenance, pending gates, and an audit-linked replacement row.
-- No data rewrite, new RPC, grants, RLS changes, trigger bypass or model call. Existing non-NULL URL-only matching stays.
-- Downstream exact-lineage integration is separately required BEFORE any historical correction (see private handoff).
-- ALLOW_RAW_TESTIMONY_WRITE: extension of the existing sanctioned supersession writer itself.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '3s';
DO $guard$
DECLARE fingerprint text;
BEGIN
  fingerprint := md5(pg_get_functiondef('public.reattribute_observation(text,uuid,uuid,text,uuid)'::regprocedure));
  IF fingerprint NOT IN ('8f251feebd5ab696392f47a6c6522220', '80d2446a40d56654a522958dc397e909') THEN -- gitleaks:allow (public function-definition fingerprints, not credentials)
    RAISE EXCEPTION 'reattribute_observation body drifted; review before replacement (md5 %)', fingerprint;
  END IF;
END;
$guard$;

-- Pin the existing projection owners; only add their missing supersession events.
DO $projection_guard$
BEGIN
  IF md5(pg_get_functiondef('public.recompute_vehicle_primary_image(uuid)'::regprocedure)) <> '0abc418f16fa239c346397f060bba3e9' THEN -- gitleaks:allow (public function-definition fingerprint, not a credential)
    RAISE EXCEPTION 'projection owner recompute_vehicle_primary_image(uuid) drifted; review before wiring';
  END IF;
  IF md5(pg_get_functiondef('public.sync_vehicle_primary_image()'::regprocedure)) <> 'eeadb2f43b97a495d68d10843daccf04' THEN -- gitleaks:allow (public function-definition fingerprint, not a credential)
    RAISE EXCEPTION 'projection owner sync_vehicle_primary_image() drifted; review before wiring';
  END IF;
  IF md5(pg_get_functiondef('public.update_vehicle_image_count()'::regprocedure)) <> 'dda1278abc564ec2f6d2ee6ac5d28ac5' THEN -- gitleaks:allow (public function-definition fingerprint, not a credential)
    RAISE EXCEPTION 'projection owner update_vehicle_image_count() drifted; review before wiring';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.vehicle_images'::regclass AND tgname='trg_vehicle_images_count'
    AND pg_get_triggerdef(oid) IN ('CREATE TRIGGER trg_vehicle_images_count AFTER DELETE OR UPDATE OF vehicle_id, is_duplicate ON public.vehicle_images FOR EACH ROW EXECUTE FUNCTION update_vehicle_image_count()', 'CREATE TRIGGER trg_vehicle_images_count AFTER DELETE OR UPDATE OF vehicle_id, is_duplicate, is_superseded ON public.vehicle_images FOR EACH ROW EXECUTE FUNCTION update_vehicle_image_count()')) THEN
    RAISE EXCEPTION 'projection trigger trg_vehicle_images_count drifted; review before replacement';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.vehicle_images'::regclass AND tgname='trg_sync_vehicle_primary_image'
    AND pg_get_triggerdef(oid) IN ('CREATE TRIGGER trg_sync_vehicle_primary_image AFTER DELETE OR UPDATE OF is_primary, is_duplicate, image_vehicle_match_status, image_url ON public.vehicle_images FOR EACH ROW EXECUTE FUNCTION sync_vehicle_primary_image()', 'CREATE TRIGGER trg_sync_vehicle_primary_image AFTER DELETE OR UPDATE OF is_primary, is_duplicate, image_vehicle_match_status, image_url, is_superseded ON public.vehicle_images FOR EACH ROW EXECUTE FUNCTION sync_vehicle_primary_image()')) THEN
    RAISE EXCEPTION 'projection trigger trg_sync_vehicle_primary_image drifted; review before replacement';
  END IF;
END;
$projection_guard$;

CREATE OR REPLACE FUNCTION public.reattribute_observation(p_observation_type text, p_observation_id uuid, p_target_vehicle_id uuid, p_reason text, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE v_old_vehicle_id UUID; v_already_superseded BOOLEAN; v_found BOOLEAN := false; v_new_observation_id UUID;
  v_copy UUID; v_audit_id UUID; v_source public.vehicle_images%ROWTYPE;
  v_unfile jsonb; v_expected jsonb;
BEGIN
  IF p_observation_type IS NULL OR p_observation_type NOT IN ('image', 'observation') THEN RAISE EXCEPTION 'observation_type must be image or observation, got %', p_observation_type; END IF;
  IF p_target_vehicle_id IS NULL AND p_observation_type <> 'image' THEN
    RAISE EXCEPTION 'only image observations can be unfiled';
  END IF;
  IF p_target_vehicle_id IS NOT NULL THEN
    PERFORM 1 FROM public.vehicles WHERE id = p_target_vehicle_id FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'target vehicle % does not exist', p_target_vehicle_id; END IF;
  END IF;
  IF p_observation_type = 'image' THEN
    SELECT true, vehicle_id, COALESCE(is_superseded, false) INTO v_found, v_old_vehicle_id, v_already_superseded FROM vehicle_images WHERE id = p_observation_id FOR UPDATE;
  ELSE
    SELECT true, vehicle_id, COALESCE(is_superseded, false) INTO v_found, v_old_vehicle_id, v_already_superseded FROM vehicle_observations WHERE id = p_observation_id FOR UPDATE;
  END IF;
  IF NOT v_found THEN RAISE EXCEPTION '% % not found', p_observation_type, p_observation_id; END IF;
  IF v_already_superseded THEN RETURN jsonb_build_object('success', false, 'error', 'already_superseded', 'observation_id', p_observation_id); END IF;
  IF v_old_vehicle_id IS NOT DISTINCT FROM p_target_vehicle_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'target_same_as_current', 'observation_id', p_observation_id, 'vehicle_id', v_old_vehicle_id); END IF;
  -- An unfile keeps the original source receipt and creates a pending attribution leaf.
  -- This operation requests no pixel analysis. 'skipped' is the existing pipeline state;
  -- it prevents the INSERT trigger from scheduling a new paid analysis of identical bytes.
  IF p_observation_type = 'image' AND p_target_vehicle_id IS NULL THEN
    IF p_reason IS NULL OR octet_length(p_reason)>16384 OR NOT pg_input_is_valid(p_reason,'jsonb') THEN
      RAISE EXCEPTION 'unfile requires a structured reviewed source contract';
    END IF;
    v_unfile:=p_reason::jsonb; v_expected:=v_unfile->'expected';
    IF jsonb_typeof(v_unfile) IS DISTINCT FROM 'object' OR jsonb_typeof(v_expected) IS DISTINCT FROM 'object'
       OR v_unfile->>'contract' IS DISTINCT FROM 'photo_unfile_review_v1'
       OR v_unfile->>'scope' IS DISTINCT FROM 'negative_vehicle_attribution'
       OR v_unfile->'destination_identity_asserted' IS DISTINCT FROM 'false'::jsonb
       OR nullif(btrim(v_unfile->>'reason'),'') IS NULL OR length(v_unfile->>'reason')>1000
       OR nullif(btrim(v_unfile->>'review_ref'),'') IS NULL OR length(v_unfile->>'review_ref')>2048
       OR nullif(btrim(v_unfile->>'review_method'),'') IS NULL OR length(v_unfile->>'review_method')>200
       OR nullif(btrim(v_unfile->>'review_observer'),'') IS NULL OR length(v_unfile->>'review_observer')>200
       OR jsonb_typeof(v_unfile->'reviewed_at') IS DISTINCT FROM 'string'
       OR coalesce(v_unfile->>'reviewed_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}'
       OR NOT coalesce(pg_input_is_valid(v_unfile->>'reviewed_at','timestamptz'),false) THEN
      RAISE EXCEPTION 'invalid unfile review provenance';
    END IF;
    IF NOT isfinite((v_unfile->>'reviewed_at')::timestamptz)
       OR (v_unfile->>'reviewed_at')::timestamptz > clock_timestamp()+interval '5 minutes' THEN
      RAISE EXCEPTION 'unfile requires a finite dated review within server future tolerance';
    END IF;
    SELECT * INTO STRICT v_source FROM public.vehicle_images WHERE id = p_observation_id;
    -- The actor is the authorization principal, not the observer of the visual review.
    IF p_actor_user_id IS NULL OR p_actor_user_id IS DISTINCT FROM v_source.user_id THEN
      RAISE EXCEPTION 'unfile actor must be the source account principal';
    END IF;
    IF NOT coalesce(pg_input_is_valid(v_expected->>'user_id','uuid'),false)
       OR NOT coalesce(pg_input_is_valid(v_expected->>'old_vehicle_id','uuid'),false)
       OR NOT coalesce(pg_input_is_valid(v_expected->>'created_at','timestamptz'),false)
       OR NOT coalesce(pg_input_is_valid(v_expected->>'taken_at','timestamptz'),false)
       OR coalesce(v_expected->>'source_sha256','') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'unfile requires exact expected source identity and clocks';
    END IF;
    IF NOT isfinite((v_expected->>'created_at')::timestamptz)
       OR NOT isfinite((v_expected->>'taken_at')::timestamptz) THEN
      RAISE EXCEPTION 'unfile requires finite expected source clocks';
    END IF;
    -- Compare-and-set under the already held source row lock. A correct re-filing
    -- or byte/clock repair after review must not be silently unfiled by a stale plan.
    IF (v_expected->>'user_id')::uuid IS DISTINCT FROM v_source.user_id
       OR (v_expected->>'old_vehicle_id')::uuid IS DISTINCT FROM v_source.vehicle_id
       OR v_expected->>'source_sha256' IS DISTINCT FROM v_source.file_hash
       OR v_expected->>'image_url' IS DISTINCT FROM v_source.image_url
       OR v_expected->>'storage_path' IS DISTINCT FROM v_source.storage_path
       OR (v_expected->>'created_at')::timestamptz IS DISTINCT FROM v_source.created_at
       OR (v_expected->>'taken_at')::timestamptz IS DISTINCT FROM v_source.taken_at THEN
      RAISE EXCEPTION 'unfile reviewed source changed; new preflight required';
    END IF;
    IF v_source.user_id IS NULL OR v_source.file_hash !~ '^[0-9a-f]{64}$'
       OR v_source.file_hash IS NULL OR v_source.storage_path IS NULL OR v_source.storage_path = ''
       OR v_source.image_url !~ '^https://' OR v_source.created_at IS NULL OR v_source.taken_at IS NULL
       OR NOT isfinite(v_source.created_at) OR NOT isfinite(v_source.taken_at)
       OR v_source.superseded_by IS NOT NULL OR v_source.superseded_at IS NOT NULL THEN
      RAISE EXCEPTION 'unfile requires a complete, current hashed source witness';
    END IF;
    v_audit_id := gen_random_uuid();
    INSERT INTO public.vehicle_images (
      vehicle_id, user_id, image_url, image_type, image_category, category, position, caption, is_primary, created_at, updated_at,
      file_name, source, exif_data, file_hash, file_size, taken_at, latitude, longitude, location_name, apple_ml_labels,
      photographer_attribution, documented_by_device, documented_by_user_id, storage_path, thumbnail_url, medium_url, large_url,
      merged_from_vehicle_id, is_superseded, superseded_by, vision_gate_status,
      is_sensitive, sensitive_type, redacted_by, redacted_at, redaction_reason, is_document,
      is_duplicate, duplicate_of, is_external, image_identity_id, is_approved, ai_processing_status, ai_scan_metadata)
    SELECT NULL, user_id, image_url, image_type, image_category, category, position, caption, false, created_at, NOW(),
      file_name, source, exif_data, file_hash, file_size, taken_at, latitude, longitude, location_name, apple_ml_labels,
      photographer_attribution, documented_by_device, documented_by_user_id, storage_path, thumbnail_url, medium_url, large_url,
      v_old_vehicle_id, false, NULL, 'pending',
      is_sensitive, sensitive_type, redacted_by, redacted_at, redaction_reason, is_document,
      is_duplicate, duplicate_of, is_external, image_identity_id, false, 'skipped',
      jsonb_build_object('reattribution', jsonb_build_object('operation', 'unfile',
        'source_image_id', p_observation_id, 'audit_id', v_audit_id, 'analysis_requested', false,
        'initial_vision_gate_status', 'pending', 'recorded_at', NOW(),
        'review_contract',v_unfile->>'contract','review_ref',v_unfile->>'review_ref',
        'review_method',v_unfile->>'review_method','review_observer',v_unfile->>'review_observer',
        'reviewed_at',v_unfile->'reviewed_at'))
    FROM public.vehicle_images WHERE id = p_observation_id RETURNING id INTO v_new_observation_id;
    -- The existing duplicate trigger may mark this row duplicate_of its ancestor.
    -- Do not clear that true duplicate flag: downstream lineage collapses it to ONE source photo.
    UPDATE public.vehicle_images SET is_superseded = true, superseded_at = NOW(), superseded_by = v_new_observation_id
      WHERE id = p_observation_id;
    INSERT INTO public.reattribution_audit
      (id, observation_type, old_observation_id, old_vehicle_id, new_observation_id, new_vehicle_id, reason, actor_user_id)
    VALUES (v_audit_id, 'image', p_observation_id, v_old_vehicle_id, v_new_observation_id, NULL, p_reason, p_actor_user_id);
    RETURN jsonb_build_object('success', true, 'observation_type', 'image', 'old_observation_id', p_observation_id,
      'old_vehicle_id', v_old_vehicle_id, 'new_observation_id', v_new_observation_id, 'new_vehicle_id', NULL,
      'merged_from_vehicle_id', v_old_vehicle_id, 'reason', p_reason, 'superseded_at', NOW(),
      'audit_id', v_audit_id, 'analysis_requested', false, 'vision_gate_status', 'pending');
  END IF;
  -- The target may already hold this image (same image_url, live): supersede onto that copy instead of minting a
  -- second one. A hybrid row's Barrett-Jackson photos are exact copies of the docket car's own row (2026-10-15).
  IF p_observation_type = 'image' THEN
    SELECT t.id INTO v_copy FROM vehicle_images t
     WHERE t.vehicle_id = p_target_vehicle_id AND COALESCE(t.is_superseded, false) = false
       AND t.image_url = (SELECT s.image_url FROM vehicle_images s WHERE s.id = p_observation_id)
     ORDER BY t.created_at, t.id LIMIT 1;
    IF v_copy IS NOT NULL THEN
      UPDATE vehicle_images SET is_superseded = true, superseded_at = NOW(), superseded_by = v_copy WHERE id = p_observation_id;
      INSERT INTO reattribution_audit (observation_type, old_observation_id, old_vehicle_id, new_observation_id, new_vehicle_id, reason, actor_user_id)
      VALUES (p_observation_type, p_observation_id, v_old_vehicle_id, v_copy, p_target_vehicle_id,
              p_reason || ' (the target already held this image; superseded onto its copy)', p_actor_user_id);
      RETURN jsonb_build_object('success', true, 'observation_type', p_observation_type, 'old_observation_id', p_observation_id,
        'old_vehicle_id', v_old_vehicle_id, 'new_observation_id', v_copy, 'new_vehicle_id', p_target_vehicle_id,
        'onto_existing_copy', true, 'reason', p_reason, 'superseded_at', NOW());
    END IF;
  END IF;
  IF p_observation_type = 'image' THEN
    INSERT INTO vehicle_images (
      vehicle_id, user_id, image_url, image_type, image_category, category, position, caption, is_primary, created_at, updated_at,
      file_name, source, exif_data, file_hash, file_size, taken_at, latitude, longitude, location_name, apple_ml_labels,
      photographer_attribution, documented_by_device, documented_by_user_id, storage_path, thumbnail_url, medium_url, large_url,
      merged_from_vehicle_id, is_superseded, superseded_by, vision_gate_status)
    SELECT p_target_vehicle_id, user_id, image_url, image_type, image_category, category, position, caption, is_primary, created_at, NOW(),
      file_name, source, exif_data, file_hash, file_size, taken_at, latitude, longitude, location_name, apple_ml_labels,
      photographer_attribution, documented_by_device, documented_by_user_id, storage_path, thumbnail_url, medium_url, large_url,
      v_old_vehicle_id, false, NULL, 'pending'
    FROM vehicle_images WHERE id = p_observation_id RETURNING id INTO v_new_observation_id;
    UPDATE vehicle_images SET is_superseded = true, superseded_at = NOW(), superseded_by = v_new_observation_id WHERE id = p_observation_id;
  ELSE
    INSERT INTO vehicle_observations (
      vehicle_id, kind, source_id, source_identifier, source_url, content_text, content_hash, structured_data, confidence,
      observed_at, ingested_at, observer_id, observer_raw, submitted_by_user_id, agent_tier, agent_model, extraction_method,
      rank, merged_from_vehicle_id, is_superseded, superseded_by)
    SELECT p_target_vehicle_id, kind, source_id, source_identifier, source_url, content_text, content_hash, structured_data, confidence,
      observed_at, NOW(), observer_id, observer_raw, submitted_by_user_id, agent_tier, agent_model, extraction_method,
      rank, v_old_vehicle_id, false, NULL
    FROM vehicle_observations WHERE id = p_observation_id RETURNING id INTO v_new_observation_id;
    UPDATE vehicle_observations SET is_superseded = true, superseded_at = NOW(), superseded_by = v_new_observation_id WHERE id = p_observation_id;
  END IF;
  INSERT INTO reattribution_audit (observation_type, old_observation_id, old_vehicle_id, new_observation_id, new_vehicle_id, reason, actor_user_id)
  VALUES (p_observation_type, p_observation_id, v_old_vehicle_id, v_new_observation_id, p_target_vehicle_id, p_reason, p_actor_user_id);
  RETURN jsonb_build_object('success', true, 'observation_type', p_observation_type, 'old_observation_id', p_observation_id, 'old_vehicle_id', v_old_vehicle_id,
    'new_observation_id', v_new_observation_id, 'new_vehicle_id', p_target_vehicle_id, 'merged_from_vehicle_id', v_old_vehicle_id, 'reason', p_reason, 'superseded_at', NOW());
END; $function$;

-- Existing owners exclude superseded images. Notify them when membership is withdrawn.
CREATE OR REPLACE TRIGGER trg_vehicle_images_count AFTER DELETE OR UPDATE OF vehicle_id, is_duplicate, is_superseded ON public.vehicle_images FOR EACH ROW EXECUTE FUNCTION update_vehicle_image_count();
CREATE OR REPLACE TRIGGER trg_sync_vehicle_primary_image AFTER DELETE OR UPDATE OF is_primary, is_duplicate, image_vehicle_match_status, image_url, is_superseded ON public.vehicle_images FOR EACH ROW EXECUTE FUNCTION sync_vehicle_primary_image();
COMMIT;
