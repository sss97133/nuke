-- Retained live owner, 2026-11-09; source-only fixture, no private rows.
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
BEGIN
  v_uid := COALESCE(auth.uid(), nullif(p_payload->>'user_id','')::uuid);

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
  v_owner_verified    := (p_payload->>'owner_verified')::boolean;

  v_is_own := v_source_type IN ('camera_capture','direct_upload','local_filesystem')
              AND COALESCE(v_owner_verified, true);
  v_is_external   := NOT v_is_own;
  v_documented_by := CASE WHEN v_is_own THEN v_uid END;

  v_trust_class := CASE
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
    COALESCE(p_payload->'exif_data','{}'::jsonb),
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
    ) RETURNING id INTO v_appearance_id;
  END IF;

  IF v_sha IS NOT NULL THEN
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
      exif_data, ai_scan_metadata, apple_ml_labels, category, image_type
    ) VALUES (
      v_identity_id, v_image_url, nullif(p_payload->>'storage_path',''), v_uid, v_documented_by,
      nullif(p_payload->>'documented_by_device',''), v_is_external, v_source, v_sha,
      v_phash_hex, nullif(p_payload->>'phash_hex',''), nullif(p_payload->>'dhash',''),
      nullif(p_payload->>'vehicle_id','')::uuid,
      nullif(p_payload->>'taken_at','')::timestamptz,
      nullif(p_payload->>'gps_latitude','')::numeric, nullif(p_payload->>'gps_longitude','')::numeric,
      nullif(p_payload->>'mime_type',''), nullif(p_payload->>'file_size_bytes','')::bigint,
      COALESCE(p_payload->'exif_data','{}'::jsonb),
      jsonb_build_object('identity_first', jsonb_build_object(
        'identity_id', v_identity_id, 'appearance_id', v_appearance_id,
        'trust_class', v_trust_class, 'trust_score', v_trust_score, 'is_own', v_is_own)),
      CASE WHEN p_payload ? 'apple_ml_labels'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'apple_ml_labels')) END,
      COALESCE(nullif(p_payload->>'category',''), CASE WHEN v_is_own THEN 'general' ELSE 'reference' END),
      COALESCE(nullif(p_payload->>'image_type',''),'general')
    ) RETURNING id INTO v_image_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
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

CREATE OR REPLACE FUNCTION public.attribute_testimony(p_observation_type text, p_observation_id uuid, p_target_vehicle_id uuid, p_reason text, p_actor_user_id uuid DEFAULT NULL::uuid, p_confidence numeric DEFAULT NULL::numeric, p_signal text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_old_vehicle_id uuid;
  v_is_primary     boolean;
  v_file_hash      text;
  v_keep_primary   boolean := false;
BEGIN
  IF p_observation_type NOT IN ('image','observation') THEN
    RAISE EXCEPTION 'observation_type must be image or observation, got %', p_observation_type;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = p_target_vehicle_id) THEN
    RAISE EXCEPTION 'target vehicle % does not exist', p_target_vehicle_id;
  END IF;

  IF p_observation_type = 'image' THEN
    SELECT vehicle_id, COALESCE(is_primary,false), file_hash
      INTO v_old_vehicle_id, v_is_primary, v_file_hash
      FROM vehicle_images WHERE id = p_observation_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'image % not found', p_observation_id;
    END IF;

    -- FIRST-attribution ONLY. Already-attributed -> use relink_testimony to move.
    IF v_old_vehicle_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'already_attributed',
        'observation_id', p_observation_id, 'current_vehicle_id', v_old_vehicle_id,
        'hint', 'use relink_testimony() to move an already-attributed image');
    END IF;

    -- Guard: identical content already on target (the (vehicle_id,file_hash) rule).
    IF v_file_hash IS NOT NULL AND EXISTS (
      SELECT 1 FROM vehicle_images b
      WHERE b.vehicle_id = p_target_vehicle_id AND b.file_hash = v_file_hash
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'file_hash_exists_on_target',
        'observation_id', p_observation_id);
    END IF;

    -- Keep is_primary only if it was primary AND target has no primary yet;
    -- otherwise force false (respect the one-primary-per-vehicle index).
    v_keep_primary := v_is_primary AND NOT EXISTS (
      SELECT 1 FROM vehicle_images b
      WHERE b.vehicle_id = p_target_vehicle_id AND b.is_primary = true
        AND COALESCE(b.is_document,false) = false
        AND COALESCE(b.is_duplicate,false) = false
    );

    UPDATE vehicle_images
       SET vehicle_id = p_target_vehicle_id,
           is_primary = v_keep_primary,
           vision_gate_status = CASE
             WHEN vision_gate_status = 'pending' AND COALESCE(is_sensitive, false) = false
             THEN 'approved'::public.vision_gate_status
             ELSE vision_gate_status
           END,
           is_approved = CASE
             WHEN vision_gate_status = 'pending' AND COALESCE(is_sensitive, false) = false
             THEN true
             ELSE is_approved
           END,
           approval_status = CASE
             WHEN vision_gate_status = 'pending' AND COALESCE(is_sensitive, false) = false
             THEN 'approved'
             ELSE approval_status
           END,
           updated_at = NOW()
     WHERE id = p_observation_id;

  ELSE
    SELECT vehicle_id INTO v_old_vehicle_id
      FROM vehicle_observations WHERE id = p_observation_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'observation % not found', p_observation_id;
    END IF;
    IF v_old_vehicle_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'already_attributed',
        'observation_id', p_observation_id, 'current_vehicle_id', v_old_vehicle_id,
        'hint', 'use reattribute_observation() to move an already-attributed observation');
    END IF;
    UPDATE vehicle_observations
       SET vehicle_id = p_target_vehicle_id
     WHERE id = p_observation_id;
  END IF;

  INSERT INTO reattribution_audit (
    observation_type, old_observation_id, old_vehicle_id,
    new_observation_id, new_vehicle_id, reason, actor_user_id)
  VALUES (
    p_observation_type, p_observation_id, NULL,
    p_observation_id, p_target_vehicle_id,
    'first_attribution: ' || COALESCE(p_reason,'')
      || COALESCE('; confidence=' || p_confidence::text, '')
      || COALESCE('; signal=' || p_signal, ''),
    p_actor_user_id);

  RETURN jsonb_build_object(
    'success', true,
    'mode', 'first_attribution',
    'observation_type', p_observation_type,
    'observation_id', p_observation_id,
    'old_vehicle_id', NULL,
    'new_vehicle_id', p_target_vehicle_id,
    'confidence', p_confidence,
    'signal', p_signal);
END;
$function$
;
