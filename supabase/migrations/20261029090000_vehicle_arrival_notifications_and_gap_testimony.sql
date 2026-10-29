-- A vehicle arrives at the shop: the profile notifies its photographer, a tag-only session files on a candidate,
-- and the day receipt shows the gaps between photo bursts with the owner's one-tap testimony for them.
-- Owner direction 2026-10-28: ~/nuke-logs/trans-am-20261028/SPEC.md sections 1-3 (not in the repo).
--
-- 1. create_notification(uuid,text,text,text,uuid,uuid,jsonb,integer), the sanctioned user_notifications writer
--    (service_role only since 20260927180000), inserted columns the table no longer has (related_user_id, priority)
--    with search_path '' and an unqualified table name, so every call failed (0 rows in 60 days, read 2026-10-28).
--    It now writes the live columns: image_id, organization_id and action_url come from p_metadata; priority and the
--    related user stay in metadata (the related user also lands in from_user_id when it is an auth user).
-- 2. device_create_vehicle_profile (live body of 20261023000400, md5-checked against prod 2026-10-28):
--    a. basis tag_only: a clear cowl/trim tag (year, make, body number) with no VIN or serial read creates a PRIVATE
--       candidate (vin null, origin_metadata.identity_status = needs_identifier) and files the session through the
--       same capture checks (one device, 15 minutes, 100 m, live source bytes), thresholds and hourly limit;
--       replay key tag:<canonical make>:<body number>; re-validated on replay like capture_session.
--    b. a profile this call mints sends one notification to the caller through create_notification: type
--       vehicle_profile_created (title by relationship) or vehicle_profile_needs_identifier for tag_only. The
--       relationship comes from existing signals: organization_locations within 150 m of the anchor frame's GPS
--       where the caller is an active organization_contributors member, and clients.business_id for a client_id the
--       app names. Never on replay; a failed notification never undoes the profile.
-- 3. record_work_session_testimony: the signed-in owner/photographer states the work in a gap between photo bursts;
--    one work_sessions row, session_type owner_testimony, intent_source owner, status confirmed. confirm_work_session
--    only flips confirmation on an existing row and create-work-session-from-evidence is an edge function (service
--    role); neither can carry an owner statement, so this extends the work record ledger with its one SQL writer.
--    work_sessions_intent_source_check gains 'owner'.
-- 4. get_user_day_receipt (live body, unchanged money masking) returns gaps: intervals over 60 minutes between the
--    user's consecutive photos that day, each with the covering testimony session's id.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.work_sessions DROP CONSTRAINT IF EXISTS work_sessions_intent_source_check;
ALTER TABLE public.work_sessions ADD CONSTRAINT work_sessions_intent_source_check
  CHECK (intent_source = ANY (ARRAY['ai_inferred'::text, 'owner_confirmed'::text, 'owner'::text])) NOT VALID;
ALTER TABLE public.work_sessions VALIDATE CONSTRAINT work_sessions_intent_source_check;

CREATE OR REPLACE FUNCTION public.create_notification(p_user_id uuid, p_type text, p_title text, p_message text,
  p_vehicle_id uuid DEFAULT NULL::uuid, p_related_user_id uuid DEFAULT NULL::uuid, p_metadata jsonb DEFAULT '{}'::jsonb,
  p_priority integer DEFAULT 1)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_meta jsonb := CASE WHEN jsonb_typeof(p_metadata) = 'object' THEN p_metadata ELSE '{}'::jsonb END;
  v_from uuid;
BEGIN
  IF p_related_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_related_user_id) THEN
    v_from := p_related_user_id;
  END IF;
  INSERT INTO public.user_notifications (user_id, type, notification_type, title, message, vehicle_id, image_id,
    organization_id, from_user_id, action_url, metadata)
  VALUES (p_user_id, p_type, p_type, p_title, p_message, p_vehicle_id,
    CASE WHEN pg_input_is_valid(v_meta ->> 'image_id', 'uuid') THEN (v_meta ->> 'image_id')::uuid END,
    CASE WHEN pg_input_is_valid(v_meta ->> 'organization_id', 'uuid') THEN (v_meta ->> 'organization_id')::uuid END,
    v_from,
    nullif(btrim(v_meta ->> 'action_url'), ''),
    v_meta || jsonb_strip_nulls(jsonb_build_object('priority', p_priority, 'related_user_id', p_related_user_id)))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.create_notification(uuid, text, text, text, uuid, uuid, jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text, uuid, uuid, jsonb, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.device_create_vehicle_profile(p_profile jsonb)
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
  -- 20261029090000: tag_only candidates and the arrival notification.
  c_org_radius_m CONSTANT numeric := 150;
  v_tag jsonb := '{}'::jsonb;
  v_body text;
  v_minted boolean := false;
  v_anchor uuid;
  v_lat numeric;
  v_lon numeric;
  v_org_id uuid;
  v_org_name text;
  v_org_role text;
  v_client_id uuid;
  v_relationship text;
  v_label text;
  v_ntype text;
  v_title text;
  v_message text;
  v_notification_id uuid;
  v_notification_error text;
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
  IF v_basis IS NULL OR v_basis NOT IN ('vin', 'serial_album', 'album', 'capture_session', 'tag_only') THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'basis must be vin, serial_album, album, capture_session or tag_only');
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
    -- Scraper rule (_shared/batChassis.ts): 5-16 chars with at least one digit (letters optional; pre-1981
    -- chassis numbers such as Porsche 356 '215618' are all digits), or a check-digit-valid 17-char VIN.
    IF NOT ((v_ident ~ '^[A-Z0-9]{5,16}$' AND v_ident ~ '[0-9]')
            OR (v_ident ~ '^[A-HJ-NPR-Z0-9]{17}$' AND public.validate_vin_check_digit(v_ident))) THEN
      RETURN jsonb_build_object('status', 'invalid_identifier', 'basis', v_basis);
    END IF;
    IF v_evidence ->> 'context_method' IS DISTINCT FROM 'vin_capture_session_v1'
       OR NOT coalesce(pg_input_is_valid(v_evidence ->> 'anchor_image_id', 'uuid'), false)
       OR coalesce(v_evidence ->> 'anchor_source_sha256', '') !~ '^[a-f0-9]{64}$'
       OR upper(btrim(coalesce(v_evidence ->> 'identifier_read', ''))) <> v_ident
       OR v_evidence ->> 'edit_distance' IS DISTINCT FROM '0'
       OR coalesce(v_evidence ->> 'identifier_legibility', '') NOT IN ('clear', 'partial')
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
  ELSIF v_basis = 'tag_only' THEN
    -- A decoded cowl/trim tag (year, make, body series, body number) with no VIN or serial read. It files the
    -- session on a private candidate profile (vin null, identity_status needs_identifier); it never dedupes on or
    -- asserts an identifier. Replay key: tag:<canonical make>:<body number>.
    IF nullif(btrim(coalesce(p_profile ->> 'vin', p_profile ->> 'serial', '')), '') IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'invalid_input', 'basis', v_basis,
        'detail', 'a session with an identifier read uses basis capture_session');
    END IF;
    v_tag := CASE WHEN jsonb_typeof(v_evidence -> 'tag') = 'object' THEN v_evidence -> 'tag' ELSE '{}'::jsonb END;
    v_body := upper(btrim(coalesce(v_tag ->> 'body_number', '')));
    IF v_evidence ->> 'context_method' IS DISTINCT FROM 'cowl_tag_session_v1'
       OR NOT coalesce(pg_input_is_valid(v_evidence ->> 'anchor_image_id', 'uuid'), false)
       OR coalesce(v_evidence ->> 'anchor_source_sha256', '') !~ '^[a-f0-9]{64}$'
       OR v_body !~ '^[A-Z0-9]{3,12}$' OR v_body !~ '[0-9]'
       OR coalesce(v_evidence ->> 'tag_legibility', '') <> 'clear'
       OR cardinality(v_image_ids) NOT BETWEEN 2 AND 100 THEN
      RETURN jsonb_build_object('status', 'insufficient_evidence', 'basis', v_basis,
        'detail', 'needs a clear source-bound cowl/trim tag anchor with its body number and its capture sequence');
    END IF;
    IF v_year IS NULL OR v_year NOT BETWEEN 1900 AND extract(year FROM now())::integer + 1 OR v_make IS NULL THEN
      RETURN jsonb_build_object('status', 'insufficient_evidence', 'basis', v_basis,
        'detail', 'a tag-only profile needs the model year and make the tag decodes');
    END IF;
    v_make_canonical := upper(public.normalize_make(v_make));
    IF NOT EXISTS (SELECT 1 FROM canonical_makes WHERE canonical_name = v_make_canonical) THEN
      RETURN jsonb_build_object('status', 'insufficient_evidence', 'basis', v_basis, 'detail', 'unknown contextual make');
    END IF;
    SELECT cm.display_name INTO v_make_display FROM canonical_makes cm WHERE cm.canonical_name = v_make_canonical;
    v_key := 'tag:' || v_make_canonical || ':' || v_body;
    v_method := 'new_profile'; v_conf := 0.85; v_need := 2;
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
      IF v_ident !~ '^[A-Z0-9]{5,16}$' OR v_ident !~ '[0-9]' THEN
        RETURN jsonb_build_object('status', 'invalid_serial', 'basis', v_basis,
          'detail', 'a chassis serial of 5 to 16 letters/digits with at least one digit');
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

  IF v_status IS NULL OR v_basis IN ('capture_session', 'tag_only') THEN
    IF v_basis = 'capture_session' THEN v_method := 'capture_session'; END IF;
    IF v_basis IN ('capture_session', 'tag_only') THEN
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
    IF v_basis IN ('capture_session', 'tag_only') THEN
      -- Validate every member against the retained upload, not caller-supplied
      -- coordinates. Missing clocks/GPS/device evidence stays unresolved.
      SELECT ARRAY[vi.id] INTO v_exact FROM vehicle_images vi
       WHERE vi.id = (v_evidence ->> 'anchor_image_id')::uuid AND vi.id = ANY(v_usable)
         AND vi.file_hash = v_evidence ->> 'anchor_source_sha256'
         AND nullif(btrim(vi.image_url), '') IS NOT NULL
         AND vi.is_duplicate IS NOT TRUE AND vi.is_document IS NOT TRUE AND vi.is_sensitive IS NOT TRUE
         AND vi.taken_at IS NOT NULL AND vi.device_fingerprint IS NOT NULL
         AND vi.latitude BETWEEN -90 AND 90 AND vi.longitude BETWEEN -180 AND 180;
      IF coalesce(cardinality(v_exact), 0) <> 1
         OR cardinality(v_usable) <> cardinality(v_image_ids)
         OR EXISTS (
           SELECT 1 FROM vehicle_images vi CROSS JOIN vehicle_images a
            WHERE a.id = v_exact[1] AND vi.id = ANY(v_image_ids)
              AND (nullif(btrim(vi.image_url), '') IS NULL OR vi.file_hash IS NULL
                OR vi.is_duplicate IS TRUE OR vi.is_document IS TRUE OR vi.is_sensitive IS TRUE
                OR vi.device_fingerprint IS DISTINCT FROM a.device_fingerprint
                OR vi.taken_at IS NULL OR vi.latitude IS NULL OR vi.longitude IS NULL
                OR vi.latitude NOT BETWEEN -90 AND 90 OR vi.longitude NOT BETWEEN -180 AND 180
                OR abs(extract(epoch FROM vi.taken_at - a.taken_at)) > 900
                OR 6371000 * 2 * asin(sqrt(least(1.0,
                     power(sin(radians(vi.latitude - a.latitude) / 2), 2)
                     + cos(radians(a.latitude)) * cos(radians(vi.latitude))
                     * power(sin(radians(vi.longitude - a.longitude) / 2), 2)))) > 100))
         OR (SELECT max(taken_at) - min(taken_at) FROM vehicle_images WHERE id = ANY(v_image_ids)) > interval '15 minutes' THEN
        RETURN jsonb_build_object('status', 'insufficient_evidence', 'basis', v_basis,
          'detail', 'capture members must retain one device, nearby source clocks/GPS and live source bytes');
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
          WHEN 'tag_only' THEN 'needs at least 2 of your photos'
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
    ELSIF v_basis = 'album' THEN
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
  IF v_basis IN ('capture_session', 'tag_only') AND EXISTS (
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
        CASE v_basis WHEN 'vin' THEN 95 WHEN 'serial_album' THEN 90 WHEN 'capture_session' THEN 90 WHEN 'tag_only' THEN NULL ELSE 50 END,
        CASE WHEN v_basis IN ('vin', 'capture_session') THEN v_exact[1] END,
        CASE WHEN v_basis = 'tag_only' THEN 'device_cowl_tag' WHEN v_basis = 'capture_session' THEN CASE WHEN v_year IS NOT NULL THEN 'device_capture_session' END WHEN v_basis <> 'vin' THEN 'device_album_name' END,
        CASE WHEN v_basis = 'tag_only' THEN 'device_cowl_tag' WHEN v_basis = 'capture_session' THEN CASE WHEN v_make IS NOT NULL THEN 'device_capture_session' END WHEN v_basis <> 'vin' THEN 'device_album_name' END,
        CASE WHEN v_model IS NOT NULL THEN CASE WHEN v_basis = 'tag_only' THEN 'device_cowl_tag' WHEN v_basis = 'capture_session' THEN 'device_capture_session' WHEN v_basis <> 'vin' THEN 'device_album_name' END END,
        CASE WHEN v_basis = 'tag_only' THEN jsonb_build_object('identity_status', 'needs_identifier') ELSE '{}'::jsonb END
        || jsonb_build_object('import_source', 'device_evidence', 'import_date', current_date,
          'device_evidence', jsonb_strip_nulls(jsonb_build_object(
            'key', v_key, 'basis', v_basis,
            'vin', CASE WHEN v_basis = 'vin' OR v_basis = 'capture_session' AND length(v_ident) = 17 THEN v_ident END,
            'serial', CASE WHEN v_basis = 'serial_album' OR v_basis = 'capture_session' AND length(v_ident) < 17 THEN v_ident END,
            'year', v_year, 'make', v_make, 'model', v_model,
            'album_name', v_album, 'album_native_id', v_album_id,
            'tag', CASE WHEN v_basis = 'tag_only' THEN v_tag END,
            'body_number', CASE WHEN v_basis = 'tag_only' THEN v_body END,
            'image_ids', to_jsonb(v_image_ids[1:50]), 'image_count', cardinality(v_image_ids),
            'exact_read_image_ids', CASE WHEN v_basis IN ('vin', 'capture_session') THEN to_jsonb(v_exact[1:50]) END,
            'anchor_image_id', CASE WHEN v_basis = 'tag_only' THEN v_exact[1] END,
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
    v_minted := true;
  END IF;

  -- File the photos (exact reads first, so they land inside the time budget).
  v_filing := public.device_file_images_as(v_caller,
    (SELECT jsonb_agg(jsonb_build_object('image_id', u.id, 'vehicle_id', v_vehicle_id, 'method', v_method,
              'confidence', v_conf, 'evidence', jsonb_build_object('basis', v_basis, 'key', v_key)
                || CASE WHEN v_basis IN ('capture_session', 'tag_only') THEN jsonb_build_object(
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

  -- 20261029090000: one notification to the caller for a profile this call minted (never on replay). The words
  -- follow the relationship: a client vehicle of the shop the session's GPS names (client_id must be that shop's
  -- client), a vehicle at a shop where the caller works (not as its owner), else the caller's own vehicle. A failed
  -- notification never undoes the profile; it is reported in the result.
  IF v_minted THEN
    BEGIN
      v_anchor := coalesce(v_exact[1], v_usable[1]);
      SELECT vi.latitude, vi.longitude INTO v_lat, v_lon FROM vehicle_images vi WHERE vi.id = v_anchor;
      IF v_lat IS NOT NULL AND v_lon IS NOT NULL THEN
        SELECT o.id, coalesce(nullif(btrim(o.business_name), ''), nullif(btrim(o.name), ''), 'your shop'), oc.role
          INTO v_org_id, v_org_name, v_org_role
          FROM organization_locations ol
          JOIN organization_contributors oc ON oc.organization_id = ol.organization_id AND oc.user_id = v_caller
               AND coalesce(oc.status, 'active') = 'active' AND (oc.end_date IS NULL OR oc.end_date >= current_date)
          JOIN organizations o ON o.id = ol.organization_id
          CROSS JOIN LATERAL (SELECT 6371000 * 2 * asin(sqrt(least(1.0,
                 power(sin(radians(ol.latitude - v_lat) / 2), 2)
                 + cos(radians(v_lat)) * cos(radians(ol.latitude))
                 * power(sin(radians(ol.longitude - v_lon) / 2), 2)))) AS m) d
         WHERE ol.latitude BETWEEN -90 AND 90 AND ol.longitude BETWEEN -180 AND 180 AND d.m <= c_org_radius_m
         ORDER BY d.m, ol.organization_id
         LIMIT 1;
      END IF;
      IF v_org_id IS NOT NULL AND pg_input_is_valid(p_profile ->> 'client_id', 'uuid') THEN
        SELECT c.id INTO v_client_id FROM clients c
         WHERE c.id = (p_profile ->> 'client_id')::uuid AND c.business_id = v_org_id;
      END IF;
      v_relationship := CASE WHEN v_client_id IS NOT NULL THEN 'client'
                             WHEN v_org_id IS NOT NULL AND coalesce(v_org_role, '') <> 'owner' THEN 'shop'
                             ELSE 'owner' END;
      v_label := coalesce(nullif(btrim(concat_ws(' ', v_year::text, v_make_display, v_model)), ''),
                          'vehicle ' || v_ident, 'vehicle');
      v_ntype := CASE WHEN v_basis = 'tag_only' THEN 'vehicle_profile_needs_identifier' ELSE 'vehicle_profile_created' END;
      v_title := CASE
        WHEN v_basis = 'tag_only' THEN 'Take one photo of the VIN plate to finish ' || v_label
        WHEN v_relationship = 'client' THEN 'Client vehicle profile: ' || v_label
        WHEN v_relationship = 'shop' THEN 'New vehicle at ' || v_org_name || ': ' || v_label
        ELSE 'Your new vehicle profile: ' || v_label END;
      v_message := format('%s of %s photos filed%s.', coalesce(v_filing -> 'counts' ->> 'filed', '0'), cardinality(v_image_ids),
        coalesce(' from ' || (SELECT min(vi.taken_at)::date::text FROM vehicle_images vi WHERE vi.id = ANY (v_image_ids)), ''))
        || CASE WHEN v_basis = 'tag_only'
             THEN ' The body tag identifies it; the VIN plate is the one frame missing.'
             ELSE ' Private until you choose to share it.' END;
      v_notification_id := public.create_notification(v_caller, v_ntype, v_title, v_message, v_vehicle_id, NULL,
        jsonb_strip_nulls(jsonb_build_object(
          'image_id', v_anchor,
          'action_url', '/vehicle/' || v_vehicle_id::text,
          'organization_id', v_org_id,
          'basis', v_basis,
          'relationship', v_relationship,
          'identity_status', CASE WHEN v_basis = 'tag_only' THEN 'needs_identifier' END,
          'evidence_summary', jsonb_strip_nulls(jsonb_build_object(
            'key', v_key, 'image_count', cardinality(v_image_ids),
            'filed', coalesce((v_filing -> 'counts' ->> 'filed')::integer, 0),
            'anchor_image_id', v_anchor,
            'identifier_legibility', v_evidence ->> 'identifier_legibility',
            'tag_legibility', v_evidence ->> 'tag_legibility',
            'organization_distance_m_max', CASE WHEN v_org_id IS NOT NULL THEN c_org_radius_m END)),
          'writer', 'device_create_vehicle_profile (20261029090000)')),
        1);
    EXCEPTION WHEN OTHERS THEN
      v_notification_error := SQLSTATE || ': ' || SQLERRM;
    END;
  END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object('status', v_status, 'vehicle_id', v_vehicle_id, 'basis', v_basis, 'replay', v_replay,
    'contributor', v_contributor, 'filing', v_filing, 'identity_status', CASE WHEN v_basis = 'tag_only' THEN 'needs_identifier' END,
    'notification_id', v_notification_id, 'relationship', v_relationship, 'notification_error', v_notification_error));
END
$function$;

-- grants on device_create_vehicle_profile are kept by CREATE OR REPLACE (authenticated, service_role).

CREATE OR REPLACE FUNCTION public.record_work_session_testimony(p_vehicle_id uuid, p_session_date date,
  p_start timestamptz, p_end timestamptz, p_description text, p_hours numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '2s'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_desc text := nullif(btrim(p_description), '');
  v_vehicle uuid;
  v_minutes integer;
  v_span integer;
  v_frames integer;
  v_inside integer;
  v_overlap uuid;
  v_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'record_work_session_testimony: authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_vehicle_id IS NULL OR p_session_date IS NULL OR p_start IS NULL OR p_end IS NULL OR v_desc IS NULL OR p_hours IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'vehicle, date, start, end, description and hours are required');
  END IF;
  IF p_end <= p_start OR p_start < p_session_date::timestamptz OR p_end > (p_session_date + 1)::timestamptz THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'start and end fall on the session date, end after start');
  END IF;
  v_span := ceil(extract(epoch FROM p_end - p_start) / 60)::integer;
  v_minutes := round(p_hours * 60)::integer;
  IF p_hours <= 0 OR v_minutes < 1 OR v_minutes > v_span THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'hours must be above 0 and no longer than the interval',
      'interval_minutes', v_span);
  END IF;
  IF length(v_desc) > 2000 THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'description is over 2,000 characters');
  END IF;
  v_vehicle := public.vehicle_merge_terminal(p_vehicle_id);
  IF v_vehicle IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found', 'detail', 'the vehicle is missing, deleted, or merged under a hold');
  END IF;

  -- Who may state it: the caller photographed this vehicle that day and holds it as owner or uploader, or as an
  -- active owner/photographer contributor.
  SELECT count(*) INTO v_frames FROM vehicle_images vi
   WHERE vi.vehicle_id = v_vehicle AND vi.user_id = v_caller
     AND vi.taken_at >= p_session_date::timestamptz AND vi.taken_at < (p_session_date + 1)::timestamptz
     AND vi.is_superseded IS NOT TRUE AND vi.is_duplicate IS NOT TRUE;
  IF v_frames = 0 OR NOT (
       EXISTS (SELECT 1 FROM vehicles x WHERE x.id = v_vehicle AND v_caller IN (x.owner_id, x.uploaded_by))
       OR EXISTS (SELECT 1 FROM vehicle_contributors vc WHERE vc.vehicle_id = v_vehicle AND vc.user_id = v_caller
                    AND vc.role IN ('owner', 'photographer') AND coalesce(vc.status, 'active') = 'active')) THEN
    RETURN jsonb_build_object('status', 'not_authorized',
      'detail', 'only the owner or photographer of this vehicle''s frames that day can state its work');
  END IF;

  BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('record_work_session_testimony:' || v_vehicle::text || ':' || p_session_date::text, 0));
  EXCEPTION WHEN lock_not_available THEN
    RETURN jsonb_build_object('status', 'busy', 'detail', 'another statement for this vehicle and day is being recorded; send it again');
  END;

  -- Photo-derived sessions are day envelopes (first to last frame), so they do not block a gap; another statement does.
  SELECT ws.id INTO v_overlap FROM work_sessions ws
   WHERE ws.vehicle_id = v_vehicle AND ws.session_date = p_session_date AND ws.session_type = 'owner_testimony'
     AND tstzrange(ws.start_time, ws.end_time) && tstzrange(p_start, p_end)
   ORDER BY ws.start_time, ws.id LIMIT 1;
  IF v_overlap IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'overlap', 'existing_session_id', v_overlap,
      'detail', 'a stated session already covers part of this interval');
  END IF;
  SELECT count(*) INTO v_inside FROM vehicle_images vi
   WHERE vi.vehicle_id = v_vehicle AND vi.user_id = v_caller AND vi.taken_at > p_start AND vi.taken_at < p_end
     AND vi.is_superseded IS NOT TRUE AND vi.is_duplicate IS NOT TRUE;
  IF v_inside > 0 THEN
    RETURN jsonb_build_object('status', 'not_a_gap', 'photos_inside', v_inside,
      'detail', 'photos of this vehicle fall inside the interval; state the time between bursts');
  END IF;

  INSERT INTO work_sessions (user_id, vehicle_id, session_date, start_time, end_time, duration_minutes,
    confidence_score, image_count, work_description, title, status, session_type, intent, intent_source,
    owner_confirmed_at, owner_confirmed_by, evidence, metadata)
  VALUES (v_caller, v_vehicle, p_session_date, p_start, p_end, v_minutes,
    1.0, 0, v_desc, left(v_desc, 120), 'confirmed', 'owner_testimony', 'labor', 'owner',
    now(), v_caller,
    jsonb_build_object('basis', 'owner_testimony', 'rung', 'proven', 'stated_hours', p_hours,
      'interval_minutes', v_span, 'frames_that_day', v_frames),
    jsonb_build_object('writer', 'record_work_session_testimony (20261029090000)', 'stated_at', now(),
      'stated_by', v_caller))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('status', 'recorded', 'session_id', v_id, 'vehicle_id', v_vehicle,
    'duration_minutes', v_minutes, 'interval_minutes', v_span);
END
$function$;
REVOKE ALL ON FUNCTION public.record_work_session_testimony(uuid, date, timestamptz, timestamptz, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_work_session_testimony(uuid, date, timestamptz, timestamptz, text, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_user_day_receipt(p_user_id uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_owner boolean := (auth.uid() = p_user_id);
  v_photos jsonb;
  v_work jsonb;
  v_receipts jsonb := '[]'::jsonb;
  v_facets jsonb;
  v_gaps jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', s.id, 'url', s.image_url, 'thumb', COALESCE(s.thumbnail_url, s.image_url),
           'vehicle_id', s.vehicle_id, 'taken_at', s.taken_at,
           'file_name', s.file_name,
           'narrative', NULLIF(s.narrative, ''),
           'components', s.components,
           'part_numbers', s.part_numbers,
           'intent', COALESCE(s.confirmed_intent, s.model_intent),
           'intent_confidence', s.intent_confidence,
           'intent_confirmed', s.intent_confirmed,
           'owner_note', s.owner_note,
           'analyzed_by', s.analyzed_by,
           'analyzed_at', s.analyzed_at
         ) ORDER BY s.taken_at), '[]'::jsonb)
  INTO v_photos
  FROM (
    SELECT vi.id, vi.image_url, vi.thumbnail_url, vi.vehicle_id, vi.taken_at, vi.file_name,
           a.structured_data->>'narrative_one_line' AS narrative,
           (SELECT jsonb_agg(c->>'label')
              FROM jsonb_array_elements(COALESCE(a.structured_data->'components_seen','[]'::jsonb)) c
              WHERE c->>'label' IS NOT NULL) AS components,
           (SELECT jsonb_agg(t->>'text')
              FROM jsonb_array_elements(COALESCE(a.structured_data->'text_regions','[]'::jsonb)) t
              WHERE t->>'text' IS NOT NULL) AS part_numbers,
           a.structured_data->>'intent' AS model_intent,
           a.structured_data->>'intent_confirmed_value' AS confirmed_intent,
           NULLIF(a.structured_data->>'intent_confidence','')::numeric AS intent_confidence,
           NULLIF(a.structured_data->>'intent_owner_confirmed','')::boolean AS intent_confirmed,
           -- Owner's own words about this frame (latest), surfaced as primary voice.
           -- Prune by vehicle_id FIRST (idx_observations_vehicle_comment_bid) so this
           -- never seq-scans the 7.5M-row observations table — it lands on the handful
           -- of comments for this vehicle, then filters to this image.
           (SELECT oc.content_text
              FROM vehicle_observations oc
              WHERE oc.vehicle_id = vi.vehicle_id
                AND oc.kind = 'comment'
                AND oc.structured_data->>'analysis_kind' = 'owner_comment'
                AND oc.structured_data->>'image_id' = vi.id::text
              ORDER BY oc.observed_at DESC
              LIMIT 1) AS owner_note,
           a.agent_model AS analyzed_by,
           a.ingested_at AS analyzed_at
    FROM vehicle_images vi
    LEFT JOIN vehicles v ON v.id = vi.vehicle_id
    LEFT JOIN LATERAL (
      SELECT o.structured_data, o.agent_model, o.ingested_at
      FROM vehicle_observations o
      WHERE o.structured_data->>'analysis_kind' = 'image_deep_byok'
        AND o.structured_data->>'image_id' = vi.id::text
      ORDER BY o.ingested_at DESC
      LIMIT 1
    ) a ON true
    WHERE vi.user_id = p_user_id
      AND vi.taken_at >= p_date::timestamptz
      AND vi.taken_at < (p_date + 1)::timestamptz
      AND COALESCE(vi.is_duplicate, false) = false
      AND (v_is_owner OR (vi.vehicle_id IS NOT NULL AND v.is_public = true))
    ORDER BY vi.taken_at
    LIMIT 60
  ) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', ws.id,
           'title', COALESCE(ws.title, ws.work_type, 'work session'),
           'vehicle_id', ws.vehicle_id,
           'duration_minutes', ws.duration_minutes,
           'total_job_cost', CASE WHEN v_is_owner THEN ws.total_job_cost ELSE NULL END,
           'session_type', ws.session_type
         ) ORDER BY ws.start_time NULLS LAST), '[]'::jsonb)
  INTO v_work
  FROM work_sessions ws
  WHERE ws.user_id = p_user_id AND ws.session_date = p_date;

  IF v_is_owner THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', r.id, 'vendor', r.vendor_name, 'total', r.total_amount,
             'vehicle_id', r.vehicle_id) ORDER BY r.total_amount DESC NULLS LAST), '[]'::jsonb)
    INTO v_receipts
    FROM receipts r
    WHERE r.user_id = p_user_id
      AND p_date IN (r.transaction_date, r.purchase_date, r.receipt_date);
  END IF;

  -- 20261029090000: gaps over 60 minutes between this user's consecutive photos that day (the same rows the photo
  -- list reads, without its 60-row cap), each with the owner testimony session that covers it.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'start', g.prev_at, 'end', g.taken_at,
           'minutes', floor(extract(epoch FROM g.taken_at - g.prev_at) / 60)::integer,
           'vehicle_id', CASE WHEN g.prev_vehicle_id = g.vehicle_id THEN g.vehicle_id END,
           'before_image_id', g.prev_id, 'after_image_id', g.id,
           'testimony_id', t.id) ORDER BY g.prev_at), '[]'::jsonb)
  INTO v_gaps
  FROM (
    SELECT vi.id, vi.vehicle_id, vi.taken_at,
           lag(vi.id) OVER w AS prev_id, lag(vi.vehicle_id) OVER w AS prev_vehicle_id, lag(vi.taken_at) OVER w AS prev_at
    FROM vehicle_images vi
    LEFT JOIN vehicles v ON v.id = vi.vehicle_id
    WHERE vi.user_id = p_user_id
      AND vi.taken_at >= p_date::timestamptz
      AND vi.taken_at < (p_date + 1)::timestamptz
      AND COALESCE(vi.is_duplicate, false) = false
      AND (v_is_owner OR (vi.vehicle_id IS NOT NULL AND v.is_public = true))
    WINDOW w AS (ORDER BY vi.taken_at, vi.id)
  ) g
  LEFT JOIN LATERAL (
    SELECT ws.id FROM work_sessions ws
    WHERE ws.user_id = p_user_id AND ws.session_date = p_date AND ws.session_type = 'owner_testimony'
      AND tstzrange(ws.start_time, ws.end_time) && tstzrange(g.prev_at, g.taken_at)
    ORDER BY ws.start_time, ws.id LIMIT 1
  ) t ON true
  WHERE g.prev_at IS NOT NULL AND g.taken_at - g.prev_at > interval '60 minutes';

  v_facets := jsonb_build_object(
    'photos', jsonb_array_length(v_photos),
    'work', jsonb_array_length(v_work),
    'receipts', jsonb_array_length(v_receipts),
    'gaps', jsonb_array_length(v_gaps)
  );

  RETURN jsonb_build_object(
    'date', p_date,
    'is_owner_view', v_is_owner,
    'photos', v_photos,
    'work_sessions', v_work,
    'receipts', v_receipts,
    'gaps', v_gaps,
    'facets', v_facets
  );
END;
$function$;

COMMIT;
