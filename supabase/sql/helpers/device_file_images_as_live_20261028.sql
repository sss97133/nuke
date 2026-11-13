-- Live definition read from production on 2026-10-28 (pg_get_functiondef), for the PG17 contract fixture.
CREATE OR REPLACE FUNCTION public.device_file_images_as(p_caller uuid, p_items jsonb, p_server_checked boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
 SET lock_timeout TO '2s'
AS $function$
DECLARE
  c_methods CONSTANT text[] := ARRAY['vin_ocr', 'serial_ocr', 'album_map', 'new_profile', 'capture_session'];
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  v_deadline timestamptz;
  v_assoc uuid[];
  v_album_terminals uuid[];
  v_seen uuid[] := '{}';
  r record;
  v_img record;
  v_image_id uuid;
  v_vehicle_id uuid;
  v_terminal uuid;
  v_method text;
  v_conf numeric;
  v_min_conf numeric;
  v_evidence jsonb;
  v_dist text;
  v_vin_len integer;
  v_res jsonb;
  v_status text;
  v_detail text;
  v_capture_ref text;
  v_current uuid;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF p_caller IS NULL THEN
    RAISE EXCEPTION 'device_file_images: authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'device_file_images: p_items must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_items) > 500 THEN
    RAISE EXCEPTION 'device_file_images: at most 500 items a call, got %', jsonb_array_length(p_items)
      USING ERRCODE = '22023';
  END IF;
  -- Photos are not started after min(6 s, half the caller's statement_timeout) from the statement's start.
  v_deadline := statement_timestamp() + make_interval(secs => (CASE WHEN coalesce(v_timeout_ms, 0) <= 0 THEN 6000
    ELSE least(6000, v_timeout_ms / 2) END / 1000.0)::double precision);
  v_assoc := ARRAY(SELECT public.user_associated_vehicle_ids(p_caller));
  v_album_terminals := ARRAY(SELECT DISTINCT t.id
                             FROM album_sync_map m CROSS JOIN LATERAL (SELECT public.vehicle_merge_terminal(m.vehicle_id) AS id) t
                             WHERE m.user_id = p_caller AND m.vehicle_id IS NOT NULL AND t.id IS NOT NULL);

  FOR r IN SELECT e.value AS item, e.ordinality AS n FROM jsonb_array_elements(p_items) WITH ORDINALITY e LOOP
    v_status := NULL; v_detail := NULL; v_current := NULL; v_terminal := NULL;
    v_image_id := CASE WHEN jsonb_typeof(r.item) = 'object' AND pg_input_is_valid(r.item ->> 'image_id', 'uuid')
                       THEN (r.item ->> 'image_id')::uuid END;
    v_vehicle_id := CASE WHEN jsonb_typeof(r.item) = 'object' AND pg_input_is_valid(r.item ->> 'vehicle_id', 'uuid')
                         THEN (r.item ->> 'vehicle_id')::uuid END;
    v_method := CASE WHEN jsonb_typeof(r.item) = 'object' THEN r.item ->> 'method' END;
    v_evidence := CASE WHEN jsonb_typeof(r.item -> 'evidence') = 'object' THEN r.item -> 'evidence' ELSE '{}'::jsonb END;
    v_capture_ref := CASE WHEN p_server_checked AND v_method = 'capture_session' THEN md5(v_evidence::text) END;
    v_conf := CASE WHEN pg_input_is_valid(r.item ->> 'confidence', 'numeric') THEN (r.item ->> 'confidence')::numeric END;
    v_min_conf := CASE WHEN v_method IN ('vin_ocr', 'serial_ocr') THEN 0.9 ELSE 0.85 END;

    IF v_image_id IS NULL OR v_vehicle_id IS NULL THEN
      v_status := 'invalid_item'; v_detail := 'image_id and vehicle_id must be uuids';
    ELSIF v_method IS NULL OR NOT (v_method = ANY (c_methods)) THEN
      v_status := 'invalid_method'; v_detail := 'method must be one of ' || array_to_string(c_methods, ', ');
    ELSIF v_conf IS NULL OR v_conf > 1 OR v_conf < v_min_conf THEN
      v_status := 'low_confidence'; v_detail := format('%s needs a confidence from %s to 1', v_method, v_min_conf);
    ELSIF v_image_id = ANY (v_seen) THEN
      v_status := 'duplicate_item';
    ELSIF r.n > 1 AND clock_timestamp() > v_deadline THEN
      v_status := 'deferred'; v_detail := 'this call''s time budget is spent; send the photo again';
    ELSE
      v_seen := v_seen || v_image_id;
      BEGIN
        SELECT vi.user_id, vi.vehicle_id, vi.is_superseded, vi.vision_gate_status::text AS gate
          INTO v_img FROM vehicle_images vi WHERE vi.id = v_image_id FOR UPDATE;
        IF NOT FOUND THEN
          v_status := 'not_found';
        ELSIF v_img.user_id IS DISTINCT FROM p_caller THEN
          v_status := 'not_owner';
        ELSIF v_img.is_superseded IS TRUE THEN
          v_status := 'superseded';
        ELSIF v_img.gate IN ('rejected_personal', 'rejected_misattributed') THEN
          v_status := 'gate_rejected'; v_detail := v_img.gate;
        ELSE
          v_terminal := public.vehicle_merge_terminal(v_vehicle_id);
          IF v_terminal IS NULL THEN
            v_status := 'vehicle_unavailable'; v_detail := 'the vehicle is missing, deleted, or merged under a hold';
          ELSIF v_img.vehicle_id IS NOT NULL THEN
            IF v_img.vehicle_id = v_terminal OR public.vehicle_merge_terminal(v_img.vehicle_id) = v_terminal THEN
              v_status := 'already';
              -- A new supported reading confirms an existing filing without moving
              -- testimony. The same request is idempotent, including transport replay.
              IF v_capture_ref IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM reattribution_audit a WHERE a.observation_type = 'image'
                  AND a.old_observation_id = v_image_id AND a.new_observation_id = v_image_id
                  AND a.new_vehicle_id = v_terminal AND a.actor_user_id = p_caller
                  AND (a.reason LIKE 'device capture_session %' OR a.reason LIKE 'first_attribution: device capture_session %')
                  AND strpos(a.reason, 'evidence_ref=' || v_capture_ref || ';') > 0) THEN
                INSERT INTO reattribution_audit(observation_type,old_observation_id,old_vehicle_id,
                  new_observation_id,new_vehicle_id,reason,actor_user_id)
                VALUES('image',v_image_id,v_img.vehicle_id,v_image_id,v_terminal,
                  format('device capture_session confirms existing filing; evidence_ref=%s; evidence %s',
                    v_capture_ref,left(v_evidence::text,300)),p_caller);
              END IF;
            ELSE
              v_status := 'conflict'; v_current := v_img.vehicle_id;
            END IF;
          ELSIF NOT (v_terminal = ANY (v_assoc)) THEN
            v_status := 'not_associated';
          ELSIF NOT p_server_checked THEN
            v_dist := btrim(v_evidence ->> 'edit_distance');
            SELECT length(btrim(x.vin)) INTO v_vin_len FROM vehicles x WHERE x.id = v_terminal;
            v_detail := CASE
              WHEN v_method = 'capture_session' THEN 'capture_session requires the validated profile writer'
              WHEN v_method IN ('vin_ocr', 'serial_ocr') AND v_dist IS NOT NULL AND v_dist !~ '^[0-2]$' THEN
                'edit_distance must be 0, 1 or 2'
              WHEN v_method = 'vin_ocr' AND v_vin_len IS DISTINCT FROM 17 THEN
                'vin_ocr needs a vehicle holding a 17-character VIN'
              WHEN v_method = 'serial_ocr' AND coalesce(v_vin_len, 0) NOT BETWEEN 4 AND 16 THEN
                'serial_ocr needs a vehicle holding a 4-16-character chassis serial'
              WHEN v_method = 'album_map' AND NOT (
                CASE WHEN nullif(btrim(v_evidence ->> 'album_native_id'), '') IS NULL THEN v_terminal = ANY (v_album_terminals)
                     ELSE EXISTS (SELECT 1 FROM album_sync_map m
                                  WHERE m.user_id = p_caller AND m.apple_album_id = btrim(v_evidence ->> 'album_native_id')
                                    AND public.vehicle_merge_terminal(m.vehicle_id) = v_terminal) END) THEN
                'album_map needs an album_sync_map row of yours on this vehicle'
              WHEN v_method = 'new_profile' AND NOT EXISTS (
                SELECT 1 FROM vehicles x
                WHERE x.id = v_terminal AND x.uploaded_by = p_caller AND x.profile_origin = 'device_evidence') THEN
                'new_profile files only onto a profile your device evidence created'
            END;
            IF v_detail IS NOT NULL THEN v_status := 'insufficient_evidence'; END IF;
          END IF;
          IF v_status IS NULL THEN
            v_res := public.attribute_testimony('image', v_image_id, v_terminal,
              format('device %s by the photo''s owner; %sevidence %s', v_method,
                CASE WHEN v_capture_ref IS NOT NULL THEN 'evidence_ref=' || v_capture_ref || '; ' ELSE '' END,
                left(v_evidence::text, 300)),
              p_caller, v_conf, 'device_' || v_method);
            IF (v_res ->> 'success')::boolean THEN
              v_status := 'filed';
            ELSIF v_res ->> 'error' = 'file_hash_exists_on_target' THEN
              v_status := 'duplicate_on_target'; v_detail := 'the same file is already on this vehicle';
            ELSIF v_res ->> 'error' = 'already_attributed' THEN
              v_status := 'conflict'; v_current := (v_res ->> 'current_vehicle_id')::uuid;
            ELSE
              v_status := 'error'; v_detail := v_res::text;
            END IF;
          END IF;
        END IF;
      EXCEPTION
        WHEN lock_not_available THEN
          v_status := 'busy'; v_detail := 'the photo or its vehicle is locked by another writer; send it again';
        WHEN OTHERS THEN
          v_status := 'error'; v_detail := SQLSTATE || ': ' || SQLERRM;
      END;
    END IF;

    v_results := v_results || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'image_id', coalesce(v_image_id::text, r.item ->> 'image_id'), 'vehicle_id', coalesce(v_terminal, v_vehicle_id),
      'status', v_status, 'detail', v_detail, 'current_vehicle_id', v_current)));
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'requested', jsonb_array_length(p_items),
    'counts', coalesce((SELECT jsonb_object_agg(c.status, c.n)
                        FROM (SELECT x ->> 'status' AS status, count(*) AS n
                              FROM jsonb_array_elements(v_results) x GROUP BY 1) c), '{}'::jsonb),
    'filed', coalesce((SELECT jsonb_agg(x -> 'image_id') FROM jsonb_array_elements(v_results) x
                       WHERE x ->> 'status' = 'filed'), '[]'::jsonb),
    'results', v_results);
END
$function$

;
