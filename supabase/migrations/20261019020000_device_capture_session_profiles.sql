-- Extend the existing authenticated device writer; no new grants, tables or jobs.
-- A source-bound VIN/chassis anchor can resolve/create a private contributor profile
-- with nearby capture views, without making the user create or name an album.
SET lock_timeout = '3s';
SET statement_timeout = '10s';
DO $owner_guard$
DECLARE current_hash text := md5(pg_get_functiondef('public.device_file_images_as(uuid,jsonb,boolean)'::regprocedure));
BEGIN
  IF current_hash = 'ef7f1e2e80b32e4f14b4dd79fe53a7ea' THEN RETURN; END IF; -- gitleaks:allow (function-definition fingerprint, not a credential)
  IF current_hash <> '3ebf80290e589be68cb8fe77cef627f3' THEN -- gitleaks:allow (function-definition fingerprint, not a credential)
    RAISE EXCEPTION 'capture-session writer owner drift: public.device_file_images_as(uuid,jsonb,boolean)';
  END IF;
  EXECUTE $updated_definition$CREATE OR REPLACE FUNCTION public.device_file_images_as(p_caller uuid, p_items jsonb, p_server_checked boolean DEFAULT false)
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
$updated_definition$;
END $owner_guard$;

DO $owner_guard$
DECLARE current_hash text := md5(pg_get_functiondef('public.device_create_vehicle_profile(jsonb)'::regprocedure));
BEGIN
  IF current_hash = '4f8f3e20ba9bf969529c79c18993fbd1' THEN RETURN; END IF; -- gitleaks:allow (function-definition fingerprint, not a credential)
  IF current_hash <> 'da8356fc870ae3faca467f345b259f5d' THEN -- gitleaks:allow (function-definition fingerprint, not a credential)
    RAISE EXCEPTION 'capture-session writer owner drift: public.device_create_vehicle_profile(jsonb)';
  END IF;
  EXECUTE $updated_definition$CREATE OR REPLACE FUNCTION public.device_create_vehicle_profile(p_profile jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '2s'
AS $function$
DECLARE
  c_profiles_per_hour CONSTANT integer := 5;
  v_caller uuid := auth.uid();
  v_basis text;
  v_ident text;          -- what goes in the vin column: a VIN or a chassis serial
  v_year integer;
  v_make text;
  v_make_canonical text;
  v_make_display text;
  v_model text;
  v_model_words text[];
  v_album text;
  v_album_id text;
  v_words text[];
  v_pairs text[];
  v_image_ids uuid[];
  v_evidence jsonb;
  v_key text;
  v_method text;
  v_conf numeric;
  v_need integer;
  v_usable uuid[];       -- the caller's live, ungated photos among image_ids (album basis: with pixels)
  v_unfiled uuid[];      -- the usable ones filed on no vehicle
  v_exact uuid[];        -- usable photos with an exact VIN read
  v_holder_rows integer;
  v_holders uuid[];
  v_assoc uuid[];
  v_vehicle_id uuid;
  v_status text;
  v_replay boolean := false;
  v_recent integer;
  v_filing jsonb;
  v_contributor boolean := false;
  v_identity_run uuid;
  v_identity_method text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'device_create_vehicle_profile: authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_profile IS NULL OR jsonb_typeof(p_profile) <> 'object' THEN
    RAISE EXCEPTION 'device_create_vehicle_profile: p_profile must be a JSON object' USING ERRCODE = '22023';
  END IF;

  -- Shape.
  v_basis := p_profile ->> 'basis';
  v_evidence := CASE WHEN jsonb_typeof(p_profile -> 'evidence') = 'object' THEN p_profile -> 'evidence' ELSE '{}'::jsonb END;
  v_album := nullif(btrim(p_profile ->> 'album_name'), '');
  v_album_id := nullif(btrim(p_profile ->> 'album_native_id'), '');
  v_make := nullif(btrim(p_profile ->> 'make'), '');
  v_model := nullif(btrim(p_profile ->> 'model'), '');
  v_year := CASE WHEN pg_input_is_valid(p_profile ->> 'year', 'integer') THEN (p_profile ->> 'year')::integer END;
  IF v_basis IS NULL OR v_basis NOT IN ('vin', 'serial_album', 'album', 'capture_session') THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'basis must be vin, serial_album, album or capture_session');
  END IF;
  IF jsonb_typeof(p_profile -> 'image_ids') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_profile -> 'image_ids') NOT BETWEEN 1 AND 500
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_profile -> 'image_ids') x
                WHERE jsonb_typeof(x) <> 'string' OR NOT pg_input_is_valid(x #>> '{}', 'uuid')) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'basis', v_basis, 'detail', 'image_ids must be 1 to 500 uuids');
  END IF;
  IF length(v_evidence::text) > 8192 THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'basis', v_basis, 'detail', 'evidence is over 8 KB');
  END IF;
  v_image_ids := ARRAY(SELECT DISTINCT (x #>> '{}')::uuid FROM jsonb_array_elements(p_profile -> 'image_ids') x);

  -- The basis's identifier and, for album bases, what the album name itself supports.
  IF v_basis = 'capture_session' THEN
    -- A source-bound identifier read anchors a bounded capture sequence. An album
    -- declaration is not identity evidence and is not required for this path.
    v_ident := upper(btrim(coalesce(p_profile ->> 'vin', p_profile ->> 'serial', '')));
    v_identity_run := CASE WHEN pg_input_is_valid(v_evidence ->> 'identity_run_id','uuid')
      THEN (v_evidence ->> 'identity_run_id')::uuid END;
    v_identity_method := v_evidence ->> 'identity_method_version';
    IF v_ident !~ '^[A-Z0-9]{8,17}$' OR v_ident !~ '[A-Z]' OR v_ident !~ '[0-9]'
       OR (length(v_ident) = 17 AND NOT public.validate_vin_check_digit(v_ident)) THEN
      RETURN jsonb_build_object('status', 'invalid_identifier', 'basis', v_basis);
    END IF;
    IF v_evidence ->> 'context_method' IS DISTINCT FROM 'vin_capture_session_v1'
       OR NOT coalesce(pg_input_is_valid(v_evidence ->> 'anchor_image_id', 'uuid'), false)
       OR coalesce(v_evidence ->> 'anchor_source_sha256', '') !~ '^[a-f0-9]{64}$'
       OR upper(btrim(coalesce(v_evidence ->> 'identifier_read', ''))) <> v_ident
       OR v_evidence ->> 'edit_distance' IS DISTINCT FROM '0'
       OR coalesce(v_evidence ->> 'identifier_legibility', '') NOT IN ('clear', 'partial')
       OR v_identity_run IS NULL
       OR coalesce(v_identity_method,'') !~ '^vehicle-identity-context-fold-v2:[A-Za-z0-9._:-]{1,80}$'
       OR cardinality(v_image_ids) NOT BETWEEN 2 AND 100 THEN
      RETURN jsonb_build_object('status', 'insufficient_evidence', 'basis', v_basis,
        'detail', 'needs an exact source-bound identifier anchor and its capture sequence');
    END IF;
    IF v_year IS NOT NULL AND v_year NOT BETWEEN 1900 AND extract(year FROM now())::integer + 1 THEN
      RETURN jsonb_build_object('status', 'invalid_input', 'basis', v_basis, 'detail', 'invalid contextual year');
    END IF;
    IF length(v_ident) < 17 AND v_make IS NULL THEN
      RETURN jsonb_build_object('status', 'insufficient_evidence', 'basis', v_basis,
        'detail', 'a classic serial needs its make from capture evidence for identifier namespace');
    END IF;
    v_make_canonical := CASE WHEN v_make IS NOT NULL THEN upper(public.normalize_make(v_make)) END;
    IF v_make IS NOT NULL AND NOT EXISTS (SELECT 1 FROM canonical_makes WHERE canonical_name = v_make_canonical) THEN
      RETURN jsonb_build_object('status', 'insufficient_evidence', 'basis', v_basis, 'detail', 'unknown contextual make');
    END IF;
    SELECT cm.display_name INTO v_make_display FROM canonical_makes cm WHERE cm.canonical_name = v_make_canonical;
    v_key := CASE WHEN length(v_ident) = 17 THEN 'vin:' ELSE 'serial:' END || v_ident;
    v_method := 'capture_session'; v_conf := CASE WHEN v_evidence ->> 'identifier_legibility' = 'clear' THEN 0.9 ELSE 0.85 END; v_need := 2;
  ELSIF v_basis = 'vin' THEN
    v_ident := upper(btrim(coalesce(p_profile ->> 'vin', '')));
    IF v_ident !~ '^[A-HJ-NPR-Z0-9]{17}$' OR NOT public.validate_vin_check_digit(v_ident) THEN
      RETURN jsonb_build_object('status', 'invalid_vin', 'basis', v_basis, 'detail',
        'a 17-character VIN whose 9th character is its ISO 3779 check digit (North American VINs)');
    END IF;
    v_key := 'vin:' || v_ident; v_method := 'vin_ocr'; v_conf := 0.95; v_need := 1;
  ELSE
    IF v_basis = 'serial_album' THEN
      v_ident := upper(btrim(coalesce(p_profile ->> 'serial', '')));
      IF v_ident !~ '^[A-Z0-9]{8,16}$' OR v_ident !~ '[A-Z]' OR v_ident !~ '[0-9]' THEN
        RETURN jsonb_build_object('status', 'invalid_serial', 'basis', v_basis,
          'detail', 'a chassis serial of 8 to 16 characters mixing letters and digits');
      END IF;
      v_key := 'serial:' || v_ident; v_method := 'serial_ocr'; v_conf := 0.9; v_need := 2;
    ELSE
      v_key := 'album:' || coalesce(v_album_id, lower(v_album)); v_method := 'album_map'; v_conf := 0.85; v_need := 12;
    END IF;
    -- The album name's words, split as the phone splits them (spaces, underscores, commas), and adjacent pairs.
    v_words := array_remove(regexp_split_to_array(lower(coalesce(v_album, '')), '[\s_,]+'), '');
    v_pairs := ARRAY(SELECT v_words[i] || ' ' || v_words[i + 1] FROM generate_series(1, cardinality(v_words) - 1) i);
    v_make_canonical := upper(public.normalize_make(v_make));
    v_model_words := array_remove(regexp_split_to_array(lower(coalesce(v_model, '')), '[\s_,]+'), '');
    IF v_album IS NULL THEN
      RETURN jsonb_build_object('status', 'insufficient_evidence', 'basis', v_basis, 'detail', 'album_name is required');
    ELSIF v_year IS NULL OR v_year NOT BETWEEN 1900 AND extract(year FROM now())::integer + 1
          OR NOT (v_year::text = ANY (v_words)) THEN
      RETURN jsonb_build_object('status', 'insufficient_evidence', 'basis', v_basis,
        'detail', 'year must be 1900 to next year and appear in the album name');
    ELSIF v_make IS NULL OR NOT EXISTS (
            SELECT 1 FROM (SELECT lower(v_make) AS a
                           UNION
                           SELECT lower(s.a) FROM canonical_makes cm,
                                  unnest(cm.aliases || ARRAY[cm.canonical_name, cm.display_name]) s(a)
                           WHERE cm.canonical_name = v_make_canonical) m
            WHERE m.a = ANY (v_words) OR m.a = ANY (v_pairs)) THEN
      RETURN jsonb_build_object('status', 'insufficient_evidence', 'basis', v_basis,
        'detail', 'the album name must name the make');
    ELSIF v_basis = 'album' AND v_model IS NULL THEN
      RETURN jsonb_build_object('status', 'insufficient_evidence', 'basis', v_basis, 'detail', 'the album basis needs a model');
    ELSIF v_model IS NOT NULL AND NOT (v_model_words <@ v_words) THEN
      RETURN jsonb_build_object('status', 'insufficient_evidence', 'basis', v_basis,
        'detail', 'the album name must hold the model');
    END IF;
    v_make_display := coalesce((SELECT cm.display_name FROM canonical_makes cm
                                WHERE cm.canonical_name = v_make_canonical LIMIT 1), v_make);
  END IF;

  -- One request per caller at a time: the replay, dedupe and rate checks below then hold until this commits.
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('device_create_vehicle_profile:' || v_caller::text, 0));
  EXCEPTION WHEN lock_not_available THEN
    RETURN jsonb_build_object('status', 'busy', 'basis', v_basis,
      'detail', 'another profile request from this account is running; send it again');
  END;

  -- Replay: this caller's profile from the same basis and key.
  SELECT x.id INTO v_vehicle_id FROM vehicles x
   WHERE x.uploaded_by = v_caller AND x.profile_origin = 'device_evidence'
     AND x.origin_metadata -> 'device_evidence' ->> 'key' = v_key
   ORDER BY x.created_at, x.id LIMIT 1;
  IF FOUND THEN
    v_replay := true;
    IF public.vehicle_merge_terminal(v_vehicle_id) IS NULL THEN
      RETURN jsonb_build_object('status', 'exists_unavailable', 'basis', v_basis, 'vehicle_id', v_vehicle_id, 'replay', true,
        'detail', 'the profile this evidence created is deleted or merged under a hold');
    END IF;
    v_vehicle_id := public.vehicle_merge_terminal(v_vehicle_id);
    v_status := 'created'; v_method := CASE WHEN v_basis = 'capture_session' THEN 'capture_session' ELSE 'new_profile' END;
  END IF;

  IF v_status IS NULL OR v_basis = 'capture_session' THEN
    IF v_basis = 'capture_session' THEN v_method := 'capture_session'; END IF;
    IF v_basis = 'capture_session' THEN
      PERFORM vi.id FROM vehicle_images vi WHERE vi.id = ANY(v_image_ids) AND vi.user_id = v_caller
        ORDER BY vi.id FOR UPDATE;
    END IF;
    -- The evidence: the caller's own live photos among image_ids.
    SELECT coalesce(array_agg(vi.id ORDER BY vi.id), '{}'),
           coalesce(array_agg(vi.id ORDER BY vi.id) FILTER (WHERE vi.vehicle_id IS NULL), '{}')
      INTO v_usable, v_unfiled
      FROM vehicle_images vi
     WHERE vi.id = ANY (v_image_ids) AND vi.user_id = v_caller AND vi.is_superseded IS NOT TRUE
       AND coalesce(vi.vision_gate_status::text, '') NOT IN ('rejected_personal', 'rejected_misattributed')
       AND (v_basis <> 'album' OR btrim(coalesce(vi.image_url, '')) <> '');
    IF v_basis = 'capture_session' THEN
      -- Validate every member against the retained upload, not caller-supplied
      -- coordinates. Missing clocks/GPS stays unresolved.
      SELECT ARRAY[vi.id] INTO v_exact FROM vehicle_images vi
       WHERE vi.id = (v_evidence ->> 'anchor_image_id')::uuid AND vi.id = ANY(v_usable)
         AND vi.file_hash = v_evidence ->> 'anchor_source_sha256'
         AND nullif(btrim(vi.image_url), '') IS NOT NULL
         AND vi.is_duplicate IS NOT TRUE AND vi.is_document IS NOT TRUE AND vi.is_sensitive IS NOT TRUE
         AND vi.taken_at IS NOT NULL
         AND vi.latitude BETWEEN -90 AND 90 AND vi.longitude BETWEEN -180 AND 180;
      IF coalesce(cardinality(v_exact), 0) <> 1
         OR cardinality(v_usable) <> cardinality(v_image_ids)
         OR EXISTS (
           SELECT 1 FROM vehicle_images vi CROSS JOIN vehicle_images a
            WHERE a.id = v_exact[1] AND vi.id = ANY(v_image_ids)
              AND (nullif(btrim(vi.image_url), '') IS NULL OR vi.file_hash IS NULL
                OR vi.is_duplicate IS TRUE OR vi.is_document IS TRUE OR vi.is_sensitive IS TRUE
                OR vi.taken_at IS NULL OR vi.latitude IS NULL OR vi.longitude IS NULL
                OR vi.latitude NOT BETWEEN -90 AND 90 OR vi.longitude NOT BETWEEN -180 AND 180
                OR abs(extract(epoch FROM vi.taken_at - a.taken_at)) > 900
                OR 6371000 * 2 * asin(sqrt(least(1.0,
                     power(sin(radians(vi.latitude - a.latitude) / 2), 2)
                     + cos(radians(a.latitude)) * cos(radians(vi.latitude))
                     * power(sin(radians(vi.longitude - a.longitude) / 2), 2)))) > 100))
         OR (SELECT max(taken_at) - min(taken_at) FROM vehicle_images WHERE id = ANY(v_image_ids)) > interval '15 minutes' THEN
        RETURN jsonb_build_object('status', 'insufficient_evidence', 'basis', v_basis,
          'detail', 'capture members need nearby source clocks/GPS and live source bytes');
      END IF;
      -- Fresh on-device source reads are stored in image_observations' protected
      -- reading-only namespace. They provide the VIN and vehicle classification,
      -- but assert no physical membership; this fold adds only a VIN-anchored,
      -- nearby capture relation after contextual qualification.
      IF NOT EXISTS (
        SELECT 1 FROM public.image_observations o
        CROSS JOIN LATERAL jsonb_array_elements(coalesce(
          o.confidence_basis #> '{visual_subject_reading_v1,envelope,device_source_context,observations}',
          o.confidence_basis #> '{visual_subject_reading_v1,envelope,raw_model_reading,observations}')) anchor_read
        WHERE o.image_id = (v_evidence ->> 'anchor_image_id')::uuid
          AND o.observed_by = 'visual_subject_reading_v1' AND o.is_active AND o.superseded_by IS NULL
          AND o.confidence_basis #>> '{visual_subject_reading_v1,envelope,user_id}' = v_caller::text
          AND coalesce(o.confidence_basis #>> '{visual_subject_reading_v1,envelope,device_source_context,kind}',
            o.confidence_basis #>> '{visual_subject_reading_v1,envelope,raw_model_reading,kind}') IN ('on_device_identity_read_v1','on_device_identity_context_v1')
          AND coalesce(o.confidence_basis #>> '{visual_subject_reading_v1,envelope,device_source_context,identity_run_id}',
            o.confidence_basis #>> '{visual_subject_reading_v1,envelope,raw_model_reading,identity_run_id}') = v_identity_run::text
          AND coalesce(o.confidence_basis #>> '{visual_subject_reading_v1,envelope,device_source_context,identity_method_version}',
            o.confidence_basis #>> '{visual_subject_reading_v1,envelope,raw_model_reading,identity_method_version}') = v_identity_method
          AND anchor_read ->> 'image_id' = (v_evidence ->> 'anchor_image_id')
          AND anchor_read ->> 'is_document' = 'false' AND (anchor_read -> 'vin_candidates') ? v_ident
          AND coalesce(o.confidence_basis #> '{visual_subject_reading_v1,envelope,device_source_context,inputs}',
            o.confidence_basis #> '{visual_subject_reading_v1,envelope,inputs}') @>
            jsonb_build_array(jsonb_build_object('image_id', v_evidence ->> 'anchor_image_id', 'source_sha256', v_evidence ->> 'anchor_source_sha256'))
      ) OR EXISTS (
        SELECT 1 FROM unnest(v_image_ids) AS members(member_id)
        JOIN public.vehicle_images member ON member.id = member_id
        WHERE member_id <> (v_evidence ->> 'anchor_image_id')::uuid AND NOT EXISTS (
          SELECT 1 FROM public.image_observations o
          CROSS JOIN LATERAL jsonb_array_elements(coalesce(
            o.confidence_basis #> '{visual_subject_reading_v1,envelope,device_source_context,observations}',
            o.confidence_basis #> '{visual_subject_reading_v1,envelope,raw_model_reading,observations}')) anchor_read
          CROSS JOIN LATERAL jsonb_array_elements(coalesce(
            o.confidence_basis #> '{visual_subject_reading_v1,envelope,device_source_context,observations}',
            o.confidence_basis #> '{visual_subject_reading_v1,envelope,raw_model_reading,observations}')) member_read
          WHERE o.image_id = member_id AND o.observed_by = 'visual_subject_reading_v1'
            AND o.is_active AND o.superseded_by IS NULL
            AND o.confidence_basis #>> '{visual_subject_reading_v1,envelope,user_id}' = v_caller::text
            AND coalesce(o.confidence_basis #>> '{visual_subject_reading_v1,envelope,device_source_context,kind}',
              o.confidence_basis #>> '{visual_subject_reading_v1,envelope,raw_model_reading,kind}') IN ('on_device_identity_read_v1','on_device_identity_context_v1')
            AND coalesce(o.confidence_basis #>> '{visual_subject_reading_v1,envelope,device_source_context,identity_run_id}',
              o.confidence_basis #>> '{visual_subject_reading_v1,envelope,raw_model_reading,identity_run_id}') = v_identity_run::text
            AND coalesce(o.confidence_basis #>> '{visual_subject_reading_v1,envelope,device_source_context,identity_method_version}',
              o.confidence_basis #>> '{visual_subject_reading_v1,envelope,raw_model_reading,identity_method_version}') = v_identity_method
            AND anchor_read ->> 'image_id' = (v_evidence ->> 'anchor_image_id')
            AND (anchor_read -> 'vin_candidates') ? v_ident AND anchor_read ->> 'is_document' = 'false'
            AND member_read ->> 'image_id' = member_id::text
            AND member_read ->> 'is_vehicle' = 'true' AND member_read ->> 'is_document' = 'false'
            AND coalesce(o.confidence_basis #> '{visual_subject_reading_v1,envelope,device_source_context,inputs}',
              o.confidence_basis #> '{visual_subject_reading_v1,envelope,inputs}') @>
              jsonb_build_array(jsonb_build_object('image_id', member_id::text, 'source_sha256', member.file_hash))
            AND coalesce(o.confidence_basis #> '{visual_subject_reading_v1,envelope,device_source_context,inputs}',
              o.confidence_basis #> '{visual_subject_reading_v1,envelope,inputs}') @>
              jsonb_build_array(jsonb_build_object('image_id', v_evidence ->> 'anchor_image_id', 'source_sha256', v_evidence ->> 'anchor_source_sha256'))
        )
      ) OR EXISTS (
        -- Another fresh, source-matching VIN inside this same physical capture
        -- neighborhood is a hard conflict even if the phone omitted it from the
        -- requested profile member list.
        SELECT 1 FROM public.image_observations o
        CROSS JOIN LATERAL jsonb_array_elements(coalesce(
          o.confidence_basis #> '{visual_subject_reading_v1,envelope,device_source_context,observations}',
          o.confidence_basis #> '{visual_subject_reading_v1,envelope,raw_model_reading,observations}')) other_read
        CROSS JOIN LATERAL jsonb_array_elements_text(other_read -> 'vin_candidates') other_vin(vin)
        JOIN public.vehicle_images other_image ON other_image.id = (other_read ->> 'image_id')::uuid
        CROSS JOIN public.vehicle_images anchor_image
        WHERE o.observed_by = 'visual_subject_reading_v1' AND o.is_active AND o.superseded_by IS NULL
          AND o.confidence_basis #>> '{visual_subject_reading_v1,envelope,user_id}' = v_caller::text
          AND coalesce(o.confidence_basis #>> '{visual_subject_reading_v1,envelope,device_source_context,kind}',
            o.confidence_basis #>> '{visual_subject_reading_v1,envelope,raw_model_reading,kind}') IN ('on_device_identity_read_v1','on_device_identity_context_v1')
          AND coalesce(o.confidence_basis #>> '{visual_subject_reading_v1,envelope,device_source_context,identity_run_id}',
            o.confidence_basis #>> '{visual_subject_reading_v1,envelope,raw_model_reading,identity_run_id}') = v_identity_run::text
          AND coalesce(o.confidence_basis #>> '{visual_subject_reading_v1,envelope,device_source_context,identity_method_version}',
            o.confidence_basis #>> '{visual_subject_reading_v1,envelope,raw_model_reading,identity_method_version}') = v_identity_method
          AND anchor_image.id = (v_evidence ->> 'anchor_image_id')::uuid
          AND other_image.id <> anchor_image.id AND other_image.user_id = v_caller
          AND other_read ->> 'is_document' = 'false'
          AND other_vin.vin ~ '^[A-HJ-NPR-Z0-9]{17}$' AND public.validate_vin_check_digit(other_vin.vin)
          AND upper(other_vin.vin) <> v_ident
          AND other_image.is_superseded IS NOT TRUE AND other_image.is_duplicate IS NOT TRUE
          AND other_image.is_document IS NOT TRUE AND other_image.is_sensitive IS NOT TRUE
          AND coalesce(other_image.vision_gate_status::text,'') NOT IN ('rejected_personal','rejected_misattributed')
          AND coalesce(o.confidence_basis #> '{visual_subject_reading_v1,envelope,device_source_context,inputs}',
            o.confidence_basis #> '{visual_subject_reading_v1,envelope,inputs}') @>
            jsonb_build_array(jsonb_build_object('image_id', other_image.id::text, 'source_sha256', other_image.file_hash))
          AND other_image.file_hash ~ '^[a-f0-9]{64}$'
          AND other_image.taken_at IS NOT NULL AND anchor_image.taken_at IS NOT NULL
          AND abs(extract(epoch FROM other_image.taken_at - anchor_image.taken_at)) <= 900
          AND other_image.latitude BETWEEN -90 AND 90 AND other_image.longitude BETWEEN -180 AND 180
          AND anchor_image.latitude BETWEEN -90 AND 90 AND anchor_image.longitude BETWEEN -180 AND 180
          AND 6371000 * 2 * asin(sqrt(least(1.0,
               power(sin(radians(other_image.latitude - anchor_image.latitude) / 2), 2)
               + cos(radians(anchor_image.latitude)) * cos(radians(other_image.latitude))
               * power(sin(radians(other_image.longitude - anchor_image.longitude) / 2), 2)))) <= 100
      ) THEN
        RETURN jsonb_build_object('status', 'insufficient_evidence', 'basis', v_basis,
          'detail', 'fresh contextual on-device VIN and vehicle reads are required');
      END IF;
    END IF;
    IF v_basis = 'vin' THEN
      v_exact := ARRAY(
        SELECT u FROM unnest(v_usable) u
        WHERE CASE WHEN jsonb_typeof(v_evidence -> 'reads') = 'array'
                   THEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_evidence -> 'reads') rd
                                WHERE rd ->> 'image_id' = u::text AND btrim(rd ->> 'edit_distance') = '0'
                                  AND (rd ->> 'text' IS NULL OR upper(btrim(rd ->> 'text')) = v_ident))
                   ELSE btrim(coalesce(v_evidence ->> 'edit_distance', '')) = '0' END);
    END IF;
    IF cardinality(CASE WHEN v_basis = 'vin' THEN v_exact ELSE v_usable END) < v_need THEN
      RETURN jsonb_build_object('status', 'insufficient_evidence', 'basis', v_basis,
        'detail', CASE v_basis
          WHEN 'vin' THEN 'needs at least 1 of your photos with an exact read of the VIN (edit_distance 0)'
          WHEN 'serial_album' THEN 'needs at least 2 of your photos'
          ELSE 'needs at least 12 of your uploaded photos' END,
        'usable', cardinality(v_usable));
    END IF;

    -- Dedupe on the identifier: any live vehicle holding it, anywhere.
    IF v_basis IN ('vin', 'serial_album', 'capture_session') THEN
      SELECT count(*), coalesce(array_agg(DISTINCT t.id) FILTER (WHERE t.id IS NOT NULL), '{}')
        INTO v_holder_rows, v_holders
        FROM vehicles x CROSS JOIN LATERAL (SELECT public.vehicle_merge_terminal(x.id) AS id) t
       WHERE upper(btrim(x.vin)) = v_ident;
      -- An old serial can repeat across makes: only a holder of the album's make is this vehicle.
      IF (v_basis = 'serial_album' OR v_basis = 'capture_session' AND length(v_ident) < 17 AND v_make IS NOT NULL) AND cardinality(v_holders) > 0 THEN
        IF NOT EXISTS (SELECT 1 FROM vehicles x WHERE x.id = ANY (v_holders)
                       AND upper(public.normalize_make(x.make)) = v_make_canonical) THEN
          RETURN jsonb_build_object('status', 'ambiguous', 'basis', v_basis,
            'detail', 'this serial is on a vehicle of another make');
        END IF;
        v_holders := ARRAY(SELECT x.id FROM vehicles x WHERE x.id = ANY (v_holders)
                           AND upper(public.normalize_make(x.make)) = v_make_canonical ORDER BY x.id);
      END IF;
      IF cardinality(v_holders) > 1 THEN
        v_assoc := ARRAY(SELECT public.user_associated_vehicle_ids(v_caller));
        RETURN jsonb_build_object('status', 'ambiguous', 'basis', v_basis,
          'detail', 'more than one vehicle holds this identifier',
          'candidates', to_jsonb(ARRAY(SELECT x.id FROM vehicles x WHERE x.id = ANY (v_holders)
                                       AND (x.id = ANY (v_assoc) OR x.is_public IS TRUE) ORDER BY x.id)));
      ELSIF cardinality(v_holders) = 1 THEN
        v_vehicle_id := v_holders[1];
        v_assoc := ARRAY(SELECT public.user_associated_vehicle_ids(v_caller));
        IF NOT (v_vehicle_id = ANY (v_assoc)) THEN
          RETURN jsonb_strip_nulls(jsonb_build_object('status', 'exists_not_associated', 'basis', v_basis,
            'vehicle_id', (SELECT x.id FROM vehicles x WHERE x.id = v_vehicle_id AND x.is_public IS TRUE),
            'detail', 'a vehicle you are not associated with holds this identifier; nothing filed'));
        END IF;
        v_status := 'exists_vin';
      ELSIF v_holder_rows > 0 THEN
        RETURN jsonb_build_object('status', 'exists_unavailable', 'basis', v_basis,
          'detail', 'only deleted or held vehicles carry this identifier; not minting another');
      END IF;
    ELSE
      -- Album: exactly one associated vehicle of that year and make whose model is blank or shares the album model's
      -- words.
      v_assoc := ARRAY(SELECT public.user_associated_vehicle_ids(v_caller));
      v_holders := ARRAY(
        SELECT x.id FROM vehicles x
        WHERE x.id = ANY (v_assoc) AND x.year = v_year
          AND upper(public.normalize_make(x.make)) = v_make_canonical
          AND (nullif(btrim(x.model), '') IS NULL
               OR array_remove(regexp_split_to_array(lower(x.model), '[^a-z0-9]+'), '')
                    <@ array_remove(regexp_split_to_array(lower(v_model), '[^a-z0-9]+'), '')
               OR array_remove(regexp_split_to_array(lower(v_model), '[^a-z0-9]+'), '')
                    <@ array_remove(regexp_split_to_array(lower(x.model), '[^a-z0-9]+'), ''))
        ORDER BY x.id);
      IF cardinality(v_holders) > 1 THEN
        RETURN jsonb_build_object('status', 'ambiguous', 'basis', v_basis,
          'detail', 'more than one of your vehicles matches this album', 'candidates', to_jsonb(v_holders));
      ELSIF cardinality(v_holders) = 1 THEN
        v_vehicle_id := v_holders[1];
        v_status := 'exists_associated';
      END IF;
    END IF;
  END IF;

  -- A capture must not overwrite an existing filing, including on replay.
  IF v_basis = 'capture_session' AND EXISTS (
    SELECT 1 FROM vehicle_images vi WHERE vi.id = ANY(v_image_ids) AND vi.vehicle_id IS NOT NULL
      AND (v_vehicle_id IS NULL OR public.vehicle_merge_terminal(vi.vehicle_id) IS DISTINCT FROM v_vehicle_id)) THEN
    RETURN jsonb_build_object('status', 'conflict', 'basis', v_basis,
      'detail', 'a capture member is already filed on another vehicle; use audited correction');
  END IF;

  -- Mint.
  IF v_basis = 'capture_session' AND v_status IS NULL AND v_evidence ->> 'identifier_legibility' <> 'clear' THEN
    RETURN jsonb_build_object('status', 'insufficient_evidence', 'basis', v_basis,
      'detail', 'a partial identifier can suggest an existing vehicle but cannot seed a new one');
  END IF;
  IF v_status IS NULL THEN
    IF cardinality(CASE WHEN v_basis = 'vin' THEN ARRAY(SELECT unnest(v_exact) INTERSECT SELECT unnest(v_unfiled))
                        ELSE v_unfiled END) < v_need THEN
      RETURN jsonb_build_object('status', 'insufficient_evidence', 'basis', v_basis,
        'detail', 'the evidence photos are already filed on other vehicles', 'usable', cardinality(v_usable),
        'unfiled', cardinality(v_unfiled));
    END IF;
    -- vehicles.uploaded_by references profiles.
    IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = v_caller) THEN
      RETURN jsonb_build_object('status', 'invalid_input', 'basis', v_basis, 'detail', 'this account has no profile');
    END IF;
    SELECT count(*) INTO v_recent FROM vehicles x
     WHERE x.uploaded_by = v_caller AND x.profile_origin = 'device_evidence' AND x.created_at > now() - interval '1 hour';
    IF v_recent >= c_profiles_per_hour THEN
      RETURN jsonb_build_object('status', 'rate_limited', 'basis', v_basis,
        'detail', format('at most %s new profiles an hour from device evidence', c_profiles_per_hour));
    END IF;
    BEGIN
      INSERT INTO vehicles (
        uploaded_by, year, make, model, vin, is_public, status, is_draft, entry_type, verification_status,
        source, profile_origin, import_method, content_source_type, created_by_user_id, created_via_role,
        vin_source, vin_confidence, vin_source_image_id, year_source, make_source, model_source, origin_metadata)
      VALUES (
        v_caller,
        CASE WHEN v_basis <> 'vin' THEN v_year END,
        CASE WHEN v_basis <> 'vin' THEN v_make_display END,
        CASE WHEN v_basis <> 'vin' THEN v_model END,
        v_ident,
        false, 'active', false, 'contributor_data', 'unverified',
        'device_evidence', 'device_evidence', 'automated', 'user', v_caller, 'photographer',
        CASE v_basis WHEN 'vin' THEN 'device_vin_ocr' WHEN 'serial_album' THEN 'device_serial_ocr' WHEN 'capture_session' THEN 'device_capture_session' END,
        CASE v_basis WHEN 'vin' THEN 95 WHEN 'serial_album' THEN 90 WHEN 'capture_session' THEN 90 ELSE 50 END,
        CASE WHEN v_basis IN ('vin', 'capture_session') THEN v_exact[1] END,
        CASE WHEN v_basis = 'capture_session' THEN CASE WHEN v_year IS NOT NULL THEN 'device_capture_session' END WHEN v_basis <> 'vin' THEN 'device_album_name' END,
        CASE WHEN v_basis = 'capture_session' THEN CASE WHEN v_make IS NOT NULL THEN 'device_capture_session' END WHEN v_basis <> 'vin' THEN 'device_album_name' END,
        CASE WHEN v_model IS NOT NULL THEN CASE WHEN v_basis = 'capture_session' THEN 'device_capture_session' WHEN v_basis <> 'vin' THEN 'device_album_name' END END,
        jsonb_build_object('import_source', 'device_evidence', 'import_date', current_date,
          'device_evidence', jsonb_strip_nulls(jsonb_build_object(
            'key', v_key, 'basis', v_basis,
            'vin', CASE WHEN v_basis = 'vin' OR v_basis = 'capture_session' AND length(v_ident) = 17 THEN v_ident END,
            'serial', CASE WHEN v_basis = 'serial_album' OR v_basis = 'capture_session' AND length(v_ident) < 17 THEN v_ident END,
            'year', v_year, 'make', v_make, 'model', v_model,
            'album_name', v_album, 'album_native_id', v_album_id,
            'image_ids', to_jsonb(v_image_ids[1:50]), 'image_count', cardinality(v_image_ids),
            'exact_read_image_ids', CASE WHEN v_basis IN ('vin', 'capture_session') THEN to_jsonb(v_exact[1:50]) END,
            'evidence', v_evidence,
            'requested_by', v_caller, 'requested_at', now(),
            'writer', 'device_create_vehicle_profile (20261017021000)',
            'ownership_asserted', false,
            'owner_direction', '2026-10-15: after the vision run the app assigns photos to the image owner''s '
              || 'associated vehicle profiles and creates new profiles when the data supports it'))))
      RETURNING id INTO v_vehicle_id;
    EXCEPTION WHEN unique_violation THEN
      RETURN jsonb_build_object('status', 'busy', 'basis', v_basis,
        'detail', 'another vehicle took this identifier while the profile was being created; send it again');
    END;
    v_status := 'created'; v_method := CASE WHEN v_basis = 'capture_session' THEN 'capture_session' ELSE 'new_profile' END;
  END IF;

  -- File the photos (exact reads first, so they land inside the time budget).
  v_filing := public.device_file_images_as(v_caller,
    (SELECT jsonb_agg(jsonb_build_object('image_id', u.id, 'vehicle_id', v_vehicle_id, 'method', v_method,
              'confidence', v_conf, 'evidence', jsonb_build_object('basis', v_basis, 'key', v_key)
                || CASE WHEN v_basis = 'capture_session' THEN jsonb_build_object(
                  'anchor_image_id', v_evidence ->> 'anchor_image_id',
                  'anchor_source_sha256', v_evidence ->> 'anchor_source_sha256',
                  'interpretation_run_key', v_evidence ->> 'interpretation_run_key',
                  'read_at', v_evidence ->> 'read_at',
                  'request_ref', md5(jsonb_build_object('evidence',v_evidence,'members',
                    ARRAY(SELECT x FROM unnest(v_image_ids) x ORDER BY x))::text))
                ELSE '{}'::jsonb END)
            ORDER BY (u.id = ANY (coalesce(v_exact, '{}'))) DESC, u.ord)
     FROM unnest(v_image_ids) WITH ORDINALITY u(id, ord)),
    true);

  -- The caller photographed the profile this evidence created; ownership stays unasserted.
  IF v_status = 'created' AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = v_caller)
     AND EXISTS (SELECT 1 FROM vehicle_images vi WHERE vi.vehicle_id = v_vehicle_id AND vi.user_id = v_caller) THEN
    INSERT INTO vehicle_contributors (vehicle_id, user_id, role, start_date, notes, status,
                                      can_edit, can_delete, can_approve, can_sell)
    VALUES (v_vehicle_id, v_caller, 'photographer',
      coalesce((SELECT min(vi.taken_at)::date FROM vehicle_images vi
                WHERE vi.vehicle_id = v_vehicle_id AND vi.user_id = v_caller), current_date),
      'device_evidence (device_create_vehicle_profile, basis ' || v_basis || '): photographed this vehicle; '
        || 'ownership not asserted. start_date = the earliest filed photo''s taken_at, or the filing day when none has one',
      'active', false, false, false, false)
    ON CONFLICT (vehicle_id, user_id, role) DO NOTHING;
  END IF;
  v_contributor := EXISTS (SELECT 1 FROM vehicle_contributors vc
                           WHERE vc.vehicle_id = v_vehicle_id AND vc.user_id = v_caller AND vc.role = 'photographer');

  RETURN jsonb_build_object('status', v_status, 'vehicle_id', v_vehicle_id, 'basis', v_basis, 'replay', v_replay,
    'contributor', v_contributor, 'filing', v_filing);
END
$function$
$updated_definition$;
END $owner_guard$;
