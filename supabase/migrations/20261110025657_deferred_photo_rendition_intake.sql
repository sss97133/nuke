-- Optional supplied-review capture through the existing identity-first owner.
-- No source replay, uploads, new table, new grant, classifier, filing or work assertion.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='3s';
DO $guard$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.attribute_testimony(text,uuid,uuid,text,uuid,numeric,text)'::regprocedure)
    IS DISTINCT FROM '7492c54c97880e31123dcd49d56b0f9c'
    OR to_regprocedure('public.attribute_testimony(uuid,uuid,jsonb)') IS NOT NULL THEN
   RAISE EXCEPTION 'first attribution owner drifted; review current definition';
 END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.ingest_image_identity_first(jsonb)'::regprocedure)
    IS DISTINCT FROM '4f452ee74bc9e656317720a79e055c3b' THEN
   RAISE EXCEPTION 'identity intake owner drifted; review the current body';
 END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.auto_group_photos_into_events()'::regprocedure)
    IS DISTINCT FROM 'bcdc7f1417a50d4ea4d1d7ecde81ed42' THEN
   RAISE EXCEPTION 'photo session grouping owner drifted; review the current body';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.ingest_image_identity_first(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_image_url text;
  v_sha text;
  v_phash_hex text;
  v_source text;
  v_source_type text;
  v_source_identifier text;
  v_owner_verified boolean;
  v_is_own boolean;
  v_is_external boolean;
  v_documented_by uuid;
  v_trust_class text;
  v_trust_score int;
  v_identity_id uuid;
  v_appearance_id uuid;
  v_image_id uuid;
  v_existing uuid;
  v_deferred boolean := coalesce(p_payload->>'processing_mode','automatic') = 'subscription_review';
  v_provenance jsonb;
  v_clock timestamptz;
  v_zone text;
  v_exif jsonb;
  v_existing_row public.vehicle_images%ROWTYPE;
BEGIN
  v_uid := COALESCE(auth.uid(), nullif(p_payload->>'user_id','')::uuid);
  IF p_payload ? 'processing_mode' AND p_payload->>'processing_mode' NOT IN ('automatic','subscription_review') THEN
    RAISE EXCEPTION 'unknown_image_processing_mode';
  END IF;
  IF v_deferred THEN
    IF auth.role() IS DISTINCT FROM 'service_role' OR auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'deferred_rendition_requires_service_role' USING ERRCODE='42501';
    END IF;
    v_provenance := p_payload->'source_provenance';
    IF octet_length(p_payload::text)>131072 OR v_uid IS NULL OR p_payload->>'source' IS DISTINCT FROM 'iphoto'
       OR p_payload->>'source_type' IS DISTINCT FROM 'local_filesystem'
       OR nullif(p_payload->>'vehicle_id','') IS NOT NULL
       OR coalesce((p_payload->>'owner_verified')::boolean,false)
       OR nullif(p_payload->>'phash_hex','') IS NOT NULL
       OR nullif(p_payload->>'phash_bytes','') IS NOT NULL
       OR nullif(p_payload->>'camera_make','') IS NOT NULL
       OR nullif(p_payload->>'camera_model','') IS NOT NULL
       OR nullif(p_payload->>'documented_by_device','') IS NOT NULL
       OR coalesce(p_payload->>'image_type','general') <> 'general'
       OR coalesce(p_payload->>'category','reference') <> 'reference'
       OR coalesce(p_payload->>'content_sha256','') !~ '^[0-9a-f]{64}$'
       OR coalesce(p_payload->>'image_url','') !~ '^https://[^/]+/'
       OR p_payload->>'mime_type' IS DISTINCT FROM 'image/jpeg'
       OR nullif(btrim(p_payload->>'source_path'),'') IS NULL
       OR nullif(btrim(p_payload->>'original_filename'),'') IS NULL
       OR jsonb_typeof(coalesce(p_payload->'exif_data','{}'::jsonb)) IS DISTINCT FROM 'object'
       OR coalesce((p_payload->>'file_size_bytes')::bigint,0) <= 0
       OR coalesce((p_payload->>'width_px')::integer,0) <= 0
       OR coalesce((p_payload->>'height_px')::integer,0) <= 0
       OR jsonb_typeof(v_provenance) IS DISTINCT FROM 'object'
       OR v_provenance->>'contract' IS DISTINCT FROM 'photos_cached_preview_v1'
       OR v_provenance->>'rendition_kind' IS DISTINCT FROM 'cached_preview'
       OR v_provenance->>'rendition_sha256' IS DISTINCT FROM p_payload->>'content_sha256'
       OR coalesce(v_provenance->>'photos_asset_uuid','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR lower(p_payload->>'source_identifier') IS DISTINCT FROM lower(v_provenance->>'photos_asset_uuid')
       OR v_provenance->>'clock_basis' IS DISTINCT FROM 'photos_library_retained_exif'
       OR jsonb_typeof(v_provenance->'original_available_at_capture') IS DISTINCT FROM 'boolean'
       OR coalesce(v_provenance->>'original_local_timestamp','') !~ '^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$'
       OR coalesce(v_provenance->>'captured_at','') !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$'
       OR coalesce(v_provenance->>'metadata_captured_at','') !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_provenance) k WHERE k NOT IN
          ('contract','photos_asset_uuid','rendition_kind','rendition_sha256','clock_basis','captured_at',
           'original_local_timestamp','timezone_name','timezone_offset_seconds','metadata_captured_at','original_available_at_capture'))
    THEN RAISE EXCEPTION 'invalid_deferred_rendition'; END IF;
    v_clock := (v_provenance->>'captured_at')::timestamptz;
    v_zone := v_provenance->>'timezone_name';
    IF NOT isfinite(v_clock) OR v_clock IS DISTINCT FROM nullif(p_payload->>'taken_at','')::timestamptz
       OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=v_zone)
       OR to_char(v_clock AT TIME ZONE v_zone,'YYYY:MM:DD HH24:MI:SS') IS DISTINCT FROM v_provenance->>'original_local_timestamp'
       OR extract(epoch FROM ((v_clock AT TIME ZONE v_zone) - (v_clock AT TIME ZONE 'UTC')))
          IS DISTINCT FROM (v_provenance->>'timezone_offset_seconds')::numeric
       OR NOT isfinite((v_provenance->>'metadata_captured_at')::timestamptz)
       OR (v_provenance->>'metadata_captured_at')::timestamptz > now()+interval '5 minutes'
    THEN RAISE EXCEPTION 'invalid_deferred_capture_clock'; END IF;
    -- Library custody does not establish who photographed or performed the work.
    -- Exact cached-rendition bytes are a separate identity from an unavailable original.
    v_exif := jsonb_build_object('source_rendition',v_provenance,
      'uuid',v_provenance->>'photos_asset_uuid',
      'original_filename',p_payload->>'original_filename',
      'capture_time_zone',v_zone,'capture_time_basis','Photos library retained EXIF; subsecond library capture clock',
      'library_retained_exif',coalesce(p_payload->'exif_data','{}'::jsonb));
    PERFORM pg_advisory_xact_lock(hashtextextended('deferred-photo:'||v_uid||':'||(p_payload->>'content_sha256'),0));
  ELSE
    v_exif := coalesce(p_payload->'exif_data','{}'::jsonb);
  END IF;

  v_image_url := nullif(p_payload->>'image_url','');
  IF v_image_url IS NULL THEN
    RAISE EXCEPTION 'ingest_image_identity_first: image_url is required';
  END IF;

  v_sha := nullif(p_payload->>'content_sha256','');
  v_phash_hex := COALESCE(
    nullif(p_payload->>'phash_hex',''),
    CASE WHEN v_sha IS NOT NULL THEN 'sha256:'||v_sha END
  );
  IF v_phash_hex IS NULL THEN
    RAISE EXCEPTION 'ingest_image_identity_first: need phash_hex or content_sha256';
  END IF;

  v_source            := COALESCE(nullif(p_payload->>'source',''),'user_upload');
  v_source_type       := COALESCE(nullif(p_payload->>'source_type',''),'direct_upload');
  v_source_identifier := nullif(p_payload->>'source_identifier','');
  v_owner_verified    := CASE WHEN v_deferred THEN false ELSE (p_payload->>'owner_verified')::boolean END;

  v_is_own := v_source_type IN ('camera_capture','direct_upload','local_filesystem')
              AND COALESCE(v_owner_verified, true);
  v_is_external   := NOT v_is_own;
  v_documented_by := CASE WHEN v_is_own THEN v_uid END;

  v_trust_class := CASE
    WHEN v_deferred THEN 'unknown'
    WHEN NOT v_is_own AND v_source_type IN ('camera_capture','direct_upload','local_filesystem') THEN 'forwarded'
    WHEN v_source_type = 'camera_capture' THEN 'owner_captured'
    WHEN v_source_type IN ('direct_upload','local_filesystem') THEN 'owner_uploaded'
    WHEN v_source_type IN ('website','social_media','listing_scrape','publication') THEN 'platform_listing'
    WHEN v_source_type = 'mcp' THEN 'agent_submitted'
    WHEN v_source_type IN ('dropbox','google_drive','email_attachment','received') THEN 'forwarded'
    WHEN v_source_type = 'screenshot' THEN 'screenshot'
    ELSE 'unknown' END;
  v_trust_score := CASE v_trust_class
    WHEN 'owner_captured' THEN 85 WHEN 'owner_uploaded' THEN 80
    WHEN 'platform_listing' THEN 70 WHEN 'agent_submitted' THEN 60
    WHEN 'forwarded' THEN 50 WHEN 'screenshot' THEN 40 ELSE 30 END;

  IF v_deferred THEN
    SELECT * INTO v_existing_row FROM public.vehicle_images
      WHERE file_hash=v_sha AND source=v_source AND user_id=v_uid
        AND ai_scan_metadata#>>'{processing_policy,mode}'='subscription_review'
      ORDER BY id LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      IF v_existing_row.image_url IS DISTINCT FROM v_image_url
         OR v_existing_row.exif_data IS DISTINCT FROM v_exif
         OR v_existing_row.taken_at IS DISTINCT FROM v_clock
         OR v_existing_row.file_size IS DISTINCT FROM (p_payload->>'file_size_bytes')::bigint
         OR v_existing_row.is_superseded OR v_existing_row.is_sensitive
      THEN RAISE EXCEPTION 'deferred_rendition_source_conflict'; END IF;
      RETURN jsonb_build_object('ok',true,'identity_id',v_existing_row.image_identity_id,
        'appearance_id',v_existing_row.ai_scan_metadata#>'{identity_first,appearance_id}',
        'image_id',v_existing_row.id,'reused_leaf',true,'processing_mode','subscription_review',
        'processing_status',v_existing_row.ai_processing_status,'vehicle_id',v_existing_row.vehicle_id);
    END IF;
  END IF;

  INSERT INTO image_identities (
    phash_hex, content_hash_sha256, phash,
    first_seen_source, first_seen_path, original_filename, mime_type, file_size_bytes,
    width_px, height_px, exif_data, camera_make, camera_model,
    taken_at, gps_latitude, gps_longitude, photographer_id
  ) VALUES (
    v_phash_hex, v_sha,
    CASE WHEN nullif(p_payload->>'phash_bytes','') IS NOT NULL THEN decode(p_payload->>'phash_bytes','hex') END,
    v_source, p_payload->>'source_path', nullif(p_payload->>'original_filename',''),
    nullif(p_payload->>'mime_type',''), nullif(p_payload->>'file_size_bytes','')::bigint,
    nullif(p_payload->>'width_px','')::int, nullif(p_payload->>'height_px','')::int,
    v_exif,
    nullif(p_payload->>'camera_make',''), nullif(p_payload->>'camera_model',''),
    nullif(p_payload->>'taken_at','')::timestamptz,
    nullif(p_payload->>'gps_latitude','')::numeric, nullif(p_payload->>'gps_longitude','')::numeric,
    CASE WHEN v_is_own THEN v_uid END
  )
  ON CONFLICT (phash_hex) DO UPDATE SET
    observation_count   = image_identities.observation_count + 1,
    content_hash_sha256 = COALESCE(image_identities.content_hash_sha256, EXCLUDED.content_hash_sha256),
    camera_make         = COALESCE(image_identities.camera_make, EXCLUDED.camera_make),
    camera_model        = COALESCE(image_identities.camera_model, EXCLUDED.camera_model),
    taken_at            = COALESCE(image_identities.taken_at, EXCLUDED.taken_at),
    gps_latitude        = COALESCE(image_identities.gps_latitude, EXCLUDED.gps_latitude),
    gps_longitude       = COALESCE(image_identities.gps_longitude, EXCLUDED.gps_longitude),
    photographer_id     = COALESCE(image_identities.photographer_id, EXCLUDED.photographer_id),
    updated_at          = now()
  RETURNING id INTO v_identity_id;

  IF v_source_identifier IS NOT NULL THEN
    SELECT id INTO v_appearance_id FROM image_appearances
     WHERE image_identity_id = v_identity_id
       AND source_type = v_source_type
       AND source_identifier = v_source_identifier
       AND (NOT v_deferred OR seen_by=v_uid)
     LIMIT 1;
  END IF;
  IF v_appearance_id IS NULL THEN
    INSERT INTO image_appearances (
      image_identity_id, source_type, source_path, source_filename, source_identifier,
      content_hash, seen_by, metadata
    ) VALUES (
      v_identity_id, v_source_type, p_payload->>'source_path', nullif(p_payload->>'source_filename',''),
      v_source_identifier, v_sha, v_uid,
      jsonb_build_object('trust_class', v_trust_class, 'trust_score', v_trust_score,
                         'is_own', v_is_own, 'channel', v_source)
      || CASE WHEN v_deferred THEN jsonb_build_object('source_provenance',v_provenance) ELSE '{}'::jsonb END
    ) RETURNING id INTO v_appearance_id;
  END IF;

  IF v_deferred AND EXISTS(SELECT 1 FROM public.vehicle_images
       WHERE file_hash=v_sha AND user_id=v_uid) THEN
    RAISE EXCEPTION 'rendition_already_has_source_requires_reconciliation';
  END IF;

  IF v_sha IS NOT NULL AND NOT v_deferred THEN
    SELECT id INTO v_existing FROM vehicle_images
     WHERE file_hash = v_sha AND source = v_source LIMIT 1;
  END IF;

  IF v_existing IS NOT NULL THEN
    UPDATE vehicle_images
       SET image_identity_id = COALESCE(image_identity_id, v_identity_id)
     WHERE id = v_existing;
    v_image_id := v_existing;
  ELSE
    INSERT INTO vehicle_images (
      image_identity_id, image_url, storage_path, user_id, documented_by_user_id,
      documented_by_device, is_external, source, file_hash, perceptual_hash, phash, dhash,
      vehicle_id, taken_at, latitude, longitude, mime_type, file_size,
      exif_data, ai_scan_metadata, apple_ml_labels, category, image_type, ai_processing_status, is_approved
    ) VALUES (
      v_identity_id, v_image_url, nullif(p_payload->>'storage_path',''), v_uid, v_documented_by,
      nullif(p_payload->>'documented_by_device',''), v_is_external, v_source, v_sha,
      v_phash_hex, nullif(p_payload->>'phash_hex',''), nullif(p_payload->>'dhash',''),
      nullif(p_payload->>'vehicle_id','')::uuid,
      nullif(p_payload->>'taken_at','')::timestamptz,
      nullif(p_payload->>'gps_latitude','')::numeric, nullif(p_payload->>'gps_longitude','')::numeric,
      nullif(p_payload->>'mime_type',''), nullif(p_payload->>'file_size_bytes','')::bigint,
      v_exif,
      jsonb_build_object('identity_first', jsonb_build_object(
        'identity_id', v_identity_id, 'appearance_id', v_appearance_id,
        'trust_class', v_trust_class, 'trust_score', v_trust_score, 'is_own', v_is_own))
      || CASE WHEN v_deferred THEN jsonb_build_object('processing_policy',jsonb_build_object(
          'mode','subscription_review','state','awaiting_supplied_classification','deferred',true)) ELSE '{}'::jsonb END,
      CASE WHEN p_payload ? 'apple_ml_labels'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'apple_ml_labels')) END,
      COALESCE(nullif(p_payload->>'category',''), CASE WHEN v_is_own THEN 'general' ELSE 'reference' END),
      COALESCE(nullif(p_payload->>'image_type',''),'general'),
      CASE WHEN v_deferred THEN 'skipped' ELSE 'pending' END,
      CASE WHEN v_deferred THEN false ELSE true END
    ) RETURNING id INTO v_image_id;
  END IF;

  IF v_deferred AND EXISTS(SELECT 1 FROM public.vehicle_images WHERE id=v_image_id
       AND (vehicle_id IS NOT NULL OR ai_processing_status IS DISTINCT FROM 'skipped'
            OR documented_by_user_id IS NOT NULL OR is_approved IS TRUE)) THEN
    RAISE EXCEPTION 'deferred_rendition_intake_effect_changed';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'processing_mode',CASE WHEN v_deferred THEN 'subscription_review' ELSE 'automatic' END,
    'identity_id', v_identity_id,
    'appearance_id', v_appearance_id,
    'image_id', v_image_id,
    'is_own', v_is_own,
    'is_external', v_is_external,
    'documented_by_user_id', v_documented_by,
    'trust_class', v_trust_class,
    'trust_score', v_trust_score,
    'reused_leaf', (v_existing IS NOT NULL)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.auto_group_photos_into_events()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ev uuid; photo_date date; existing_count int; nb uuid;
begin
  -- An explicit source capture awaiting a supplied review is not a work event.
  if NEW.ai_scan_metadata#>>'{processing_policy,mode}'='subscription_review' then return NEW; end if;
  if NEW.taken_at is null then return NEW; end if;
  photo_date := date(NEW.taken_at);

  if NEW.vehicle_id is null then
    -- session grouping: nearest same-user unfiled neighbour within 20 min that already has a pending event
    select vi.timeline_event_id into nb
      from vehicle_images vi
     where NEW.user_id is not null and vi.user_id = NEW.user_id and vi.vehicle_id is null and vi.timeline_event_id is not null
       and vi.taken_at between NEW.taken_at - interval '20 minutes' and NEW.taken_at + interval '20 minutes'
     order by abs(extract(epoch from vi.taken_at - NEW.taken_at)) limit 1;
    if nb is not null then
      select te.id into ev from timeline_events te where te.id = nb and te.vehicle_id is null and te.event_type = 'pending_analysis';
    end if;
  else
    select id into ev from timeline_events where vehicle_id = NEW.vehicle_id and event_date = photo_date limit 1;
  end if;

  if ev is not null then
    select coalesce(array_length(coalesce(image_urls, array[]::text[]), 1), 0) into existing_count from timeline_events where id = ev;
    update timeline_events set
      image_urls = coalesce(image_urls, array[]::text[]) || array[NEW.image_url],
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('photo_count', existing_count + 1, 'last_photo_added', now(),
                   'session_start', least(coalesce((metadata->>'session_start')::timestamptz, NEW.taken_at), NEW.taken_at),
                   'session_end', greatest(coalesce((metadata->>'session_end')::timestamptz, NEW.taken_at), NEW.taken_at)),
      title = (existing_count + 1) || ' photos from ' || to_char(photo_date, 'Mon DD, YYYY')
    where id = ev;
    NEW.timeline_event_id := ev;
  else
    insert into timeline_events (vehicle_id, user_id, event_type, source, event_date, title, description, image_urls, metadata)
    values (NEW.vehicle_id, NEW.user_id, 'pending_analysis', 'photo_upload', photo_date,
            '1 photo from ' || to_char(photo_date, 'Mon DD, YYYY'), 'AI analysis pending', array[NEW.image_url],
            jsonb_build_object('photo_count', 1, 'needs_ai_analysis', true, 'device_fingerprint', NEW.exif_data->'camera', 'created_at', now(),
                               'session_start', NEW.taken_at, 'session_end', NEW.taken_at,
                               'unresolved', NEW.vehicle_id is null))
    returning id into ev;
    NEW.timeline_event_id := ev;
  end if;
  return NEW;
end $function$
;

-- Preserve current service-only access (no new reader or caller).
REVOKE ALL ON FUNCTION public.ingest_image_identity_first(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_image_identity_first(jsonb) TO service_role;
-- Source-bound first filing uses the existing attribution/audit owner. The
-- supplied comparison is attributed inference, never an owner confirmation.
CREATE OR REPLACE FUNCTION public.attribute_testimony(
 p_image_id uuid, p_proof_observation_id uuid, p_expected_source jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='pg_catalog','public','pg_temp'
AS $function$
DECLARE
 proof public.vehicle_observations%ROWTYPE; classified public.vehicle_observations%ROWTYPE;
 src public.vehicle_images%ROWTYPE; anchor public.vehicle_images%ROWTYPE;
 body jsonb; ref jsonb; comparison jsonb; feature jsonb; cls jsonb; read_source jsonb;
 target uuid; classification_id uuid; anchors uuid[]; kinds text[]; result jsonb;
 replay boolean; n integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR auth.uid() IS NOT NULL THEN
  RAISE EXCEPTION 'reviewed_filing_requires_service_role' USING ERRCODE='42501';
 END IF;
 SELECT o.* INTO proof FROM public.vehicle_observations o JOIN public.observation_sources s ON s.id=o.source_id
  WHERE o.id=p_proof_observation_id AND s.slug='photo_pipeline' FOR SHARE OF o;
 IF NOT FOUND OR proof.kind IS DISTINCT FROM 'provenance'
    OR proof.extraction_method IS DISTINCT FROM 'reviewed_image_attribution_v1'
    OR proof.analysis_deferred IS DISTINCT FROM true OR proof.is_superseded IS TRUE
    OR proof.vehicle_id IS NOT NULL OR nullif(btrim(proof.agent_model),'') IS NULL
    OR isfinite(proof.observed_at) IS DISTINCT FROM true OR proof.observed_at>now()+interval '5 minutes'
    OR proof.extraction_metadata->'is_inferred' IS DISTINCT FROM 'true'::jsonb
 THEN RAISE EXCEPTION 'invalid_reviewed_filing_proof'; END IF;
 body:=proof.structured_data;
 IF jsonb_typeof(body) IS DISTINCT FROM 'object' OR octet_length(body::text)>65536
    OR body->>'contract' IS DISTINCT FROM 'reviewed_image_attribution_v1'
    OR (body->>'source_image_id')::uuid IS DISTINCT FROM p_image_id
    OR jsonb_typeof(body->'anchors') IS DISTINCT FROM 'array'
    OR jsonb_array_length(body->'anchors') NOT BETWEEN 1 AND 8
    OR jsonb_typeof(body->'correspondences') IS DISTINCT FROM 'array'
    OR jsonb_array_length(body->'correspondences')<>jsonb_array_length(body->'anchors')
    OR body->'contradictions' IS DISTINCT FROM '[]'::jsonb
    OR coalesce(body->>'basis','') NOT IN ('visual_correspondence','visual_sequence')
    OR body->'global_novelty_asserted' IS DISTINCT FROM 'false'::jsonb
    OR nullif(btrim(body->>'candidate_scope'),'') IS NULL
    OR jsonb_typeof(p_expected_source) IS DISTINCT FROM 'object'
    OR coalesce(p_expected_source->>'source_sha256','') !~ '^[0-9a-f]{64}$'
    OR nullif(p_expected_source->>'image_url','') IS NULL
    OR isfinite((p_expected_source->>'expected_updated_at')::timestamptz) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'invalid_reviewed_filing_scope'; END IF;
 target:=(body->>'target_vehicle_id')::uuid;
 classification_id:=(body->>'classification_observation_id')::uuid;
 IF target IS NULL OR classification_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.vehicles v
      WHERE v.id=target AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL) THEN
  RAISE EXCEPTION 'reviewed_filing_target_unavailable';
 END IF;
 anchors:=ARRAY(SELECT (r->>'image_id')::uuid FROM jsonb_array_elements(body->'anchors') r);
 IF p_image_id=ANY(anchors) OR array_position(anchors,NULL) IS NOT NULL
    OR cardinality(anchors)<>(SELECT count(DISTINCT a) FROM unnest(anchors) a) THEN
  RAISE EXCEPTION 'reviewed_filing_duplicate_source';
 END IF;
 -- Lock every source in stable order before rechecking any of their current
 -- source URLs, capture clocks, filing, privacy, or withdrawal state.
 PERFORM 1 FROM public.vehicle_images i WHERE i.id=ANY(anchors||p_image_id) ORDER BY i.id FOR UPDATE;
 -- Follow the established image→vehicle lock order, then recheck the target
 -- after any concurrent deletion or merge that committed while we waited.
 PERFORM 1 FROM public.vehicles v WHERE v.id=target
  AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'reviewed_filing_target_unavailable'; END IF;
 SELECT * INTO src FROM public.vehicle_images WHERE id=p_image_id;
 IF NOT FOUND OR src.image_url IS DISTINCT FROM p_expected_source->>'image_url'
    OR src.file_hash IS DISTINCT FROM p_expected_source->>'source_sha256'
    OR proof.source_url IS DISTINCT FROM src.image_url
    OR body->>'source_sha256' IS DISTINCT FROM src.file_hash
    OR src.ai_scan_metadata#>>'{processing_policy,mode}' IS DISTINCT FROM 'subscription_review'
    OR src.exif_data#>>'{source_rendition,contract}' IS DISTINCT FROM 'photos_cached_preview_v1'
    OR src.exif_data#>>'{source_rendition,rendition_sha256}' IS DISTINCT FROM src.file_hash
    OR src.ai_processing_status IS DISTINCT FROM 'completed'
    OR src.is_sensitive OR src.is_superseded OR src.is_duplicate OR src.is_document OR src.doc_flag
    OR coalesce(src.vision_gate_status::text,'') NOT IN ('pending','approved')
    OR coalesce(src.image_vehicle_match_status,'') IN ('mismatch','unrelated')
    OR src.taken_at IS NULL OR NOT isfinite(src.taken_at)
 THEN RAISE EXCEPTION 'reviewed_filing_source_changed'; END IF;
 replay:=src.vehicle_id=target AND EXISTS(SELECT 1 FROM public.reattribution_audit a
   WHERE a.observation_type='image' AND a.old_vehicle_id IS NULL AND a.new_vehicle_id=target
     AND a.old_observation_id=p_image_id AND a.new_observation_id=p_image_id
     AND a.reason='first_attribution: reviewed_image_attribution_v1; proof_observation_id='||p_proof_observation_id||'; signal=reviewed_visual_chain');
 IF (src.vehicle_id IS NOT NULL AND NOT coalesce(replay,false))
    OR (src.updated_at IS DISTINCT FROM (p_expected_source->>'expected_updated_at')::timestamptz AND NOT coalesce(replay,false)) THEN
  RAISE EXCEPTION 'reviewed_filing_source_changed';
 END IF;
 SELECT o.* INTO classified FROM public.vehicle_observations o JOIN public.observation_sources s ON s.id=o.source_id
  WHERE o.id=classification_id AND s.slug='photo_pipeline' FOR SHARE OF o;
 IF NOT FOUND OR classified.extraction_method IS DISTINCT FROM 'supplied_image_classification_v1'
    OR classified.analysis_deferred IS DISTINCT FROM true OR classified.is_superseded IS TRUE
    OR classified.vehicle_id IS NOT NULL OR nullif(btrim(classified.agent_model),'') IS NULL
    OR isfinite(classified.observed_at) IS DISTINCT FROM true OR classified.observed_at>now()+interval '5 minutes'
    OR classified.source_url IS DISTINCT FROM src.image_url
    OR (classified.structured_data->>'source_image_id')::uuid IS DISTINCT FROM p_image_id
    OR src.ai_scan_metadata#>>'{classification_review,observation_id}' IS DISTINCT FROM classification_id::text
    OR src.ai_scan_metadata#>>'{classification_review,source_identifier}' IS DISTINCT FROM classified.source_identifier
    OR classified.structured_data->'classification' IS DISTINCT FROM src.ai_scan_metadata->'classification'
 THEN RAISE EXCEPTION 'reviewed_filing_classification_changed'; END IF;
 cls:=classified.structured_data->'classification';
 read_source:=classified.extraction_metadata->'source';
 IF ((src.ai_scan_metadata->'classification_review')-'observation_id'-'source_identifier') IS DISTINCT FROM read_source
    OR read_source->>'image_url' IS DISTINCT FROM src.image_url
    OR read_source->>'reviewed_sha256' IS DISTINCT FROM src.file_hash
    OR read_source->>'reviewed_url' IS DISTINCT FROM src.image_url
    OR isfinite((read_source->>'reviewed_at')::timestamptz) IS DISTINCT FROM true
    OR isfinite((read_source->>'expected_updated_at')::timestamptz) IS DISTINCT FROM true
    OR (read_source->>'reviewed_at')::timestamptz>now()+interval '5 minutes'
    OR cls->'classifier_ok' IS DISTINCT FROM 'true'::jsonb
    OR cls->'is_automotive' IS DISTINCT FROM 'true'::jsonb
    OR cls->>'image_medium' IS DISTINCT FROM 'photograph'
    OR coalesce(cls->>'image_type','') NOT IN ('vehicle_exterior','vehicle_interior','engine_bay','undercarriage','detail_closeup','vin_plate','part_closeup','progress_shot')
    OR cls#>'{v2,is_document}' IS DISTINCT FROM 'false'::jsonb
    OR cls#>'{v2,vehicle_fields}' IS DISTINCT FROM '[]'::jsonb
    OR coalesce(cls#>'{v2,vin}','null'::jsonb)<>'null'::jsonb
 THEN RAISE EXCEPTION 'reviewed_filing_requires_current_physical_classification'; END IF;
 FOR ref IN SELECT r FROM jsonb_array_elements(body->'anchors') r LOOP
  SELECT * INTO anchor FROM public.vehicle_images WHERE id=(ref->>'image_id')::uuid;
  IF NOT FOUND OR anchor.vehicle_id IS DISTINCT FROM target OR anchor.user_id IS DISTINCT FROM src.user_id
     OR anchor.image_url IS DISTINCT FROM ref->>'source_url' OR anchor.file_hash IS DISTINCT FROM ref->>'source_sha256'
     OR coalesce(anchor.file_hash,'') !~ '^[0-9a-f]{64}$'
     OR anchor.taken_at IS NULL OR NOT isfinite(anchor.taken_at)
     OR anchor.taken_at IS DISTINCT FROM (ref->>'taken_at')::timestamptz
     OR anchor.is_sensitive OR anchor.is_superseded OR anchor.is_duplicate OR anchor.is_document OR anchor.doc_flag
     OR coalesce(anchor.vision_gate_status::text,'approved')<>'approved'
     OR coalesce(anchor.image_vehicle_match_status,'') IN ('mismatch','unrelated') THEN
   RAISE EXCEPTION 'reviewed_filing_anchor_changed';
  END IF;
  SELECT count(*) INTO n FROM jsonb_array_elements(body->'correspondences') c
   WHERE (c->>'anchor_image_id')::uuid=anchor.id;
  IF n<>1 THEN RAISE EXCEPTION 'reviewed_filing_correspondence_missing'; END IF;
  SELECT c INTO comparison FROM jsonb_array_elements(body->'correspondences') c WHERE (c->>'anchor_image_id')::uuid=anchor.id;
  IF jsonb_typeof(comparison->'features') IS DISTINCT FROM 'array'
     OR jsonb_array_length(comparison->'features') NOT BETWEEN 2 AND 12
     OR (body->>'basis'='visual_sequence' AND nullif(btrim(comparison->>'sequence_context'),'') IS NULL) THEN
   RAISE EXCEPTION 'invalid_reviewed_filing_correspondence';
  END IF;
  kinds:='{}';
  FOR feature IN SELECT f FROM jsonb_array_elements(comparison->'features') f LOOP
   IF coalesce(feature->>'kind','') NOT IN ('identifier','body_geometry','component_geometry','fixed_wear','configuration','work_state')
      OR nullif(btrim(feature->>'source_witness'),'') IS NULL OR length(feature->>'source_witness')>2000
      OR nullif(btrim(feature->>'anchor_witness'),'') IS NULL OR length(feature->>'anchor_witness')>2000 THEN
    RAISE EXCEPTION 'invalid_reviewed_filing_witness';
   END IF;
   kinds:=array_append(kinds,feature->>'kind');
  END LOOP;
  IF (SELECT count(DISTINCT k) FROM unnest(kinds) k)<2
     OR NOT(kinds&&ARRAY['identifier','body_geometry','component_geometry','fixed_wear']) THEN
   RAISE EXCEPTION 'reviewed_filing_requires_visible_correspondence';
  END IF;
 END LOOP;
 IF coalesce(replay,false) THEN RETURN jsonb_build_object('success',true,'mode','existing_reviewed_attribution',
   'observation_id',p_image_id,'new_vehicle_id',target,'proof_observation_id',p_proof_observation_id); END IF;
 result:=public.attribute_testimony('image',p_image_id,target,
   'reviewed_image_attribution_v1; proof_observation_id='||p_proof_observation_id,NULL,NULL,'reviewed_visual_chain');
 IF result->'success' IS DISTINCT FROM 'true'::jsonb
    OR NOT EXISTS(SELECT 1 FROM public.vehicle_images WHERE id=p_image_id AND vehicle_id=target AND image_url=src.image_url
       AND file_hash=src.file_hash AND user_id=src.user_id AND exif_data=src.exif_data) THEN
  RAISE EXCEPTION 'reviewed_filing_not_applied';
 END IF;
 RETURN result||jsonb_build_object('proof_observation_id',p_proof_observation_id,'classification_observation_id',classification_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.attribute_testimony(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attribute_testimony(uuid,uuid,jsonb) TO service_role;

COMMIT;
