-- ============================================================================
-- Device evidence: the phone files its owner's photos onto the vehicles the owner is associated with, and creates a
-- private vehicle profile when the evidence supports one
-- ============================================================================
--
-- OWNER DIRECTION (Skylar, 2026-10-15, verbatim): "the app after vision run is supposed to assign the vehicle to a
-- profile under the image owners associated vehicle profiles, its supposed to create new profiles if theres enough data
-- to support it. this is the most important innovation in system"
-- For the three bounded bases of device_create_vehicle_profile below, this supersedes the never-mint stance of
-- docs/design/GARAGE_EVIDENCE_MODEL.md ("an unresolved statement retains its label and candidates without minting a
-- vehicle"). Every other unresolved identity keeps that rule.
--
-- WHY (read on prod 2026-10-15; uid 0b9f107a = the owner):
--   * The phone (apps/nuke-capture-ios AttributionEngine) reads VINs, chassis serials and albums on the device but had
--     no sanctioned server writer: its VIN match wrote vehicle_id with a raw client UPDATE until 2026-10-15, and
--     attribute_image_session files at confidence 1.0 as an owner confirmation, which an automatic read is not.
--   * Nothing returned the vehicles a user is associated with. The owner holds 211 vehicles by user_id and 148 by
--     owner_id (295 live by either), 128 vehicle_contributors rows and 238 active organization_vehicles rows of the 8
--     organizations he is an active contributor of. The phone matched against user_id alone.
--   * The user-callable vehicle creators are convert_personal_album_to_vehicle (an image_sets album; no evidence gate,
--     no dedupe) and accept_vehicle_suggestion (it names vehicles columns that do not exist). Neither checks a VIN.
--   * validate_vin_check_digit is deployed with no source in the repo and no caller (md5(prosrc) 3e3ee5322c0f7c9a...).
--
-- WHAT:
--   1. validate_vin_check_digit(text): recovered as deployed, body unchanged (CREATE OR REPLACE keeps its ACL). The
--      ISO 3779 / North American check digit at position 9.
--   2. vehicle_merge_terminal(uuid): the live end of a vehicle's merge chain; NULL for a missing or deleted vehicle, a
--      chain over ten hops, or a chain through a merge held for an un-merge. The hold list is 20261016221500's:
--      eeb9fa61 (a different turquoise '66 merged by an AI tier-2 decision; its fix is an un-merge). service_role only.
--   3. user_associated_vehicle_ids(uuid): the user's vehicles by user_id (= uploaded_by) or owner_id, their active
--      vehicle_contributors rows, and the active organization_vehicles of organizations they are an active contributor
--      of; each followed to vehicle_merge_terminal, merged/deleted/held dropped. An end user may ask only about
--      themselves (another uid returns no rows). authenticated, service_role. Set-returning: the API cuts at 1,000 rows.
--   4. device_file_images_as(caller, items, server_checked): the per-photo filing. Owner-only; the two RPCs call it.
--   5. device_file_images(jsonb): authenticated; caller = auth.uid(). Items <= 500:
--      {image_id, vehicle_id, method vin_ocr|serial_ocr|album_map|new_profile, confidence, evidence}. Per photo: the
--      caller is its user_id; not superseded; not gate-rejected (rejected_personal, rejected_misattributed); the vehicle
--      resolves to a live terminal; already there -> 'already'; filed elsewhere -> 'conflict' (no change); the terminal is
--      associated with the caller; confidence >= 0.9 (vin/serial) or 0.85 (album_map, new_profile); the method's own
--      evidence (a 17-character VIN on the vehicle for vin_ocr, a 4-16-character one for serial_ocr, edit_distance <= 2;
--      an album_sync_map row of the caller on that vehicle for album_map; a device_evidence profile of the caller for
--      new_profile). Writes only through attribute_testimony('image', id, vehicle, reason, caller, confidence,
--      'device_' || method), which audits to reattribution_audit. Each photo is its own subtransaction under
--      lock_timeout 2 s ('busy' on a lock). Each filing fires the vehicle_id-move triggers (the 2026-10-16 relink run
--      measured up to ~250 ms each), so a call stops starting photos after min(6 s, half the caller's statement_timeout)
--      and returns the rest 'deferred' for the client to resend.
--   6. device_create_vehicle_profile(jsonb): authenticated. {basis, vin, serial, year, make, model, album_name,
--      album_native_id, image_ids, evidence}. Thresholds are enforced here, not trusted from the phone:
--        vin          17 characters, valid check digit (else 'invalid_vin'), >= 1 of the caller's photos with an exact
--                     read (edit_distance 0, request-level or per photo in evidence.reads)
--        serial_album 8-16 letters and digits mixed (else 'invalid_serial'), year 1900..next year and make named in the
--                     album name, >= 2 of the caller's photos
--        album        year, make and model all named in the album name, >= 12 of the caller's photos with uploaded pixels
--      Order: the same basis + key (VIN, serial or album_native_id) from this caller returns its first profile (status
--      'created', replay true); then dedupe: a live vehicle anywhere holding the VIN or serial (vin column) is
--      'exists_vin' (its photos filed when the caller is associated with it) or 'exists_not_associated' (nothing filed;
--      its id withheld when it is private); a VIN held only by deleted or held vehicles is 'exists_unavailable'; for an
--      album, exactly one associated vehicle of that year and make (normalize_make: Chevy = Chevrolet) whose model is
--      blank or shares the album model's words is 'exists_associated' (photos filed, method album_map), more than one is
--      'ambiguous' (no change). Otherwise, at most 5 device profiles per caller per hour ('rate_limited'), it mints:
--      is_public false (private: the vehicles_private_select policy shows it to user_id/owner_id/uploaded_by/access),
--      uploaded_by = caller (user_id is generated from it), owner_id NULL (ownership is not asserted), entry_type
--      contributor_data, profile_origin and source 'device_evidence', origin_metadata.device_evidence holding the basis,
--      key, exact identifiers, photo ids and the phone's evidence; files the photos (method new_profile, confidence
--      0.95 vin / 0.9 serial_album / 0.85 album); and adds the caller as a 'photographer' vehicle_contributors row (not
--      an owner). One advisory lock per caller serializes these requests (lock_timeout 2 s -> 'busy').
--      Identity evidence is recorded in origin_metadata, not vehicle_observations: the observation front door is the
--      ingest-observation edge function, and no SQL observation writer accepts a device read (ingest_cached_image_
--      property_batch takes public same-vehicle cohorts only).
--
-- Not here: the phone client (apps/nuke-capture-ios, its own PR); suggestions (suggested_vehicle_id) are not touched.
-- Live verification after CI applies (as postgres, read-only):
--   select proname, prosecdef, proconfig, proacl from pg_proc where proname in ('device_file_images',
--     'device_create_vehicle_profile','user_associated_vehicle_ids','device_file_images_as','vehicle_merge_terminal');
--   select count(*) from user_associated_vehicle_ids('0b9f107a-d124-49de-9ded-94698f63c1c4');   -- ~600, see WHY
--   anon POST /rest/v1/rpc/device_file_images -> 401/permission denied
-- Contract: supabase/sql/test_device_attribution.sql (db-contracts job).
-- Reversal: drop the five new functions; every filing has a reattribution_audit row (signal device_<method>) and
-- relink_testimony moves a photo back; a minted profile is marked by profile_origin 'device_evidence'.

SET statement_timeout = '60s';
SET lock_timeout = '5s';

BEGIN;

-- 1. Recovered as deployed (pg_get_functiondef, 2026-10-15). Unchanged.
CREATE OR REPLACE FUNCTION public.validate_vin_check_digit(vin text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  transliteration jsonb := '{"A":1,"B":2,"C":3,"D":4,"E":5,"F":6,"G":7,"H":8,"J":1,"K":2,"L":3,"M":4,"N":5,"P":7,"R":9,"S":2,"T":3,"U":4,"V":5,"W":6,"X":7,"Y":8,"Z":9}';
  weights int[] := ARRAY[8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];
  total int := 0;
  ch char;
  val int;
  expected_check char;
  remainder int;
BEGIN
  IF length(vin) != 17 THEN RETURN false; END IF;
  -- I and O and Q are not valid in VINs
  IF vin ~ '[IOQ]' THEN RETURN false; END IF;
  
  FOR i IN 1..17 LOOP
    ch := upper(substring(vin FROM i FOR 1));
    IF ch >= '0' AND ch <= '9' THEN
      val := ch::int;
    ELSE
      val := (transliteration->>ch)::int;
      IF val IS NULL THEN RETURN false; END IF;
    END IF;
    total := total + val * weights[i];
  END LOOP;
  
  remainder := total % 11;
  IF remainder = 10 THEN expected_check := 'X';
  ELSE expected_check := remainder::text::char;
  END IF;
  
  RETURN substring(vin FROM 9 FOR 1) = expected_check;
END;
$function$;

-- 2. The live end of a merge chain.
CREATE OR REPLACE FUNCTION public.vehicle_merge_terminal(p_vehicle_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $function$
DECLARE
  -- Merges held for an un-merge: nothing follows them (evidence in 20261016221500's header).
  c_held_merges CONSTANT uuid[] := ARRAY['eeb9fa61-01e8-49a6-8eab-a7cc0e23d30f']::uuid[];
  v uuid := p_vehicle_id;
  v_next uuid;
  v_deleted_at timestamptz;
  v_status text;
BEGIN
  IF p_vehicle_id IS NULL THEN RETURN NULL; END IF;
  FOR i IN 1..10 LOOP
    IF v = ANY (c_held_merges) THEN RETURN NULL; END IF;
    SELECT x.merged_into_vehicle_id, x.deleted_at, x.status INTO v_next, v_deleted_at, v_status
      FROM vehicles x WHERE x.id = v;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF v_next IS NULL THEN
      IF v_deleted_at IS NOT NULL OR v_status IN ('deleted', 'merged') THEN RETURN NULL; END IF;
      RETURN v;
    END IF;
    v := v_next;
  END LOOP;
  RETURN NULL;
END
$function$;

-- 3. The vehicles a user is associated with.
CREATE OR REPLACE FUNCTION public.user_associated_vehicle_ids(p_user uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH caller AS (
    -- An end user is answered only about themselves.
    SELECT p_user AS id
    WHERE p_user IS NOT NULL
      AND (coalesce(auth.role(), '') NOT IN ('anon', 'authenticated') OR p_user = auth.uid())
  ), seed AS (
    SELECT v.id FROM caller c JOIN vehicles v ON v.user_id = c.id
    UNION
    SELECT v.id FROM caller c JOIN vehicles v ON v.owner_id = c.id
    UNION
    SELECT vc.vehicle_id FROM caller c JOIN vehicle_contributors vc ON vc.user_id = c.id
    WHERE coalesce(vc.status, 'active') = 'active'
    UNION
    SELECT ov.vehicle_id
    FROM caller c
    JOIN organization_contributors oc ON oc.user_id = c.id AND oc.status = 'active'
    JOIN organization_vehicles ov ON ov.organization_id = oc.organization_id AND ov.status = 'active'
  )
  SELECT DISTINCT t.id
  FROM seed s
  CROSS JOIN LATERAL (SELECT public.vehicle_merge_terminal(s.id) AS id) t
  WHERE t.id IS NOT NULL
$function$;

-- 4. The per-photo filing. p_server_checked: the caller (device_create_vehicle_profile) has already verified the
-- evidence, so the method's own checks are skipped; every other check still runs.
CREATE OR REPLACE FUNCTION public.device_file_images_as(p_caller uuid, p_items jsonb, p_server_checked boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
SET lock_timeout = '2s'
AS $function$
DECLARE
  c_methods CONSTANT text[] := ARRAY['vin_ocr', 'serial_ocr', 'album_map', 'new_profile'];
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
            ELSE
              v_status := 'conflict'; v_current := v_img.vehicle_id;
            END IF;
          ELSIF NOT (v_terminal = ANY (v_assoc)) THEN
            v_status := 'not_associated';
          ELSIF NOT p_server_checked THEN
            v_dist := btrim(v_evidence ->> 'edit_distance');
            SELECT length(btrim(x.vin)) INTO v_vin_len FROM vehicles x WHERE x.id = v_terminal;
            v_detail := CASE
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
              format('device %s by the photo''s owner; evidence %s', v_method, left(v_evidence::text, 300)),
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
$function$;

-- 5. The phone's filing entry.
CREATE OR REPLACE FUNCTION public.device_file_images(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET lock_timeout = '2s'
AS $function$
BEGIN
  RETURN public.device_file_images_as(auth.uid(), p_items, false);
END
$function$;

-- 6. Resolve or create a vehicle profile from device evidence.
CREATE OR REPLACE FUNCTION public.device_create_vehicle_profile(p_profile jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET lock_timeout = '2s'
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
  IF v_basis IS NULL OR v_basis NOT IN ('vin', 'serial_album', 'album') THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'basis must be vin, serial_album or album');
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
  IF v_basis = 'vin' THEN
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
    v_status := 'created'; v_method := 'new_profile';
  END IF;

  IF v_status IS NULL THEN
    -- The evidence: the caller's own live photos among image_ids.
    SELECT coalesce(array_agg(vi.id ORDER BY vi.id), '{}'),
           coalesce(array_agg(vi.id ORDER BY vi.id) FILTER (WHERE vi.vehicle_id IS NULL), '{}')
      INTO v_usable, v_unfiled
      FROM vehicle_images vi
     WHERE vi.id = ANY (v_image_ids) AND vi.user_id = v_caller AND vi.is_superseded IS NOT TRUE
       AND coalesce(vi.vision_gate_status::text, '') NOT IN ('rejected_personal', 'rejected_misattributed')
       AND (v_basis <> 'album' OR btrim(coalesce(vi.image_url, '')) <> '');
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
    IF v_basis IN ('vin', 'serial_album') THEN
      SELECT count(*), coalesce(array_agg(DISTINCT t.id) FILTER (WHERE t.id IS NOT NULL), '{}')
        INTO v_holder_rows, v_holders
        FROM vehicles x CROSS JOIN LATERAL (SELECT public.vehicle_merge_terminal(x.id) AS id) t
       WHERE upper(btrim(x.vin)) = v_ident;
      -- An old serial can repeat across makes: only a holder of the album's make is this vehicle.
      IF v_basis = 'serial_album' AND cardinality(v_holders) > 0 THEN
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

  -- Mint.
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
        CASE v_basis WHEN 'vin' THEN 'device_vin_ocr' WHEN 'serial_album' THEN 'device_serial_ocr' END,
        CASE v_basis WHEN 'vin' THEN 95 WHEN 'serial_album' THEN 90 ELSE 50 END,
        CASE WHEN v_basis = 'vin' THEN v_exact[1] END,
        CASE WHEN v_basis <> 'vin' THEN 'device_album_name' END,
        CASE WHEN v_basis <> 'vin' THEN 'device_album_name' END,
        CASE WHEN v_basis <> 'vin' AND v_model IS NOT NULL THEN 'device_album_name' END,
        jsonb_build_object('import_source', 'device_evidence', 'import_date', current_date,
          'device_evidence', jsonb_strip_nulls(jsonb_build_object(
            'key', v_key, 'basis', v_basis,
            'vin', CASE WHEN v_basis = 'vin' THEN v_ident END,
            'serial', CASE WHEN v_basis = 'serial_album' THEN v_ident END,
            'year', v_year, 'make', v_make, 'model', v_model,
            'album_name', v_album, 'album_native_id', v_album_id,
            'image_ids', to_jsonb(v_image_ids[1:50]), 'image_count', cardinality(v_image_ids),
            'exact_read_image_ids', CASE WHEN v_basis = 'vin' THEN to_jsonb(v_exact[1:50]) END,
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
    v_status := 'created'; v_method := 'new_profile';
  END IF;

  -- File the photos (exact reads first, so they land inside the time budget).
  v_filing := public.device_file_images_as(v_caller,
    (SELECT jsonb_agg(jsonb_build_object('image_id', u.id, 'vehicle_id', v_vehicle_id, 'method', v_method,
              'confidence', v_conf, 'evidence', jsonb_build_object('basis', v_basis, 'key', v_key))
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
$function$;

-- Stated grants (Supabase's default privileges would otherwise give anon EXECUTE).
REVOKE ALL ON FUNCTION public.vehicle_merge_terminal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_merge_terminal(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.user_associated_vehicle_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_associated_vehicle_ids(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.device_file_images_as(uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.device_file_images(jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.device_file_images(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.device_create_vehicle_profile(jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.device_create_vehicle_profile(jsonb) TO authenticated;

COMMENT ON FUNCTION public.vehicle_merge_terminal(uuid) IS
  'The live end of a vehicle''s merge chain (itself when never merged); NULL for a missing or deleted vehicle, over ten '
  'hops, or a chain through a merge held for an un-merge (eeb9fa61, see 20261016221500). service_role. 20261017021000.';
COMMENT ON FUNCTION public.user_associated_vehicle_ids(uuid) IS
  'Vehicles a user is associated with: user_id (= uploaded_by) or owner_id, active vehicle_contributors rows, active '
  'organization_vehicles of organizations the user is an active contributor of; merge-followed, merged/deleted/held '
  'dropped. An end user is answered only about themselves. 20261017021000.';
COMMENT ON FUNCTION public.device_file_images_as(uuid, jsonb, boolean) IS
  'Per-photo device filing behind device_file_images and device_create_vehicle_profile; writes only through '
  'attribute_testimony (signal device_<method>). Owner-only. 20261017021000.';
COMMENT ON FUNCTION public.device_file_images(jsonb) IS
  'The phone files its owner''s photos (<= 500 items: image_id, vehicle_id, method vin_ocr|serial_ocr|album_map|'
  'new_profile, confidence, evidence) onto vehicles the owner is associated with, through attribute_testimony. Returns '
  '{ok, requested, counts, filed, results[{image_id, vehicle_id, status, detail, current_vehicle_id}]}; ''deferred'' '
  'photos are to be sent again. Owner direction 2026-10-15: "the app after vision run is supposed to assign the vehicle '
  'to a profile under the image owners associated vehicle profiles". 20261017021000.';
COMMENT ON FUNCTION public.device_create_vehicle_profile(jsonb) IS
  'Resolves or creates a private vehicle profile from device evidence (basis vin | serial_album | album; thresholds '
  'enforced here), files the photos and adds the caller as a photographer contributor, never an owner. Statuses: '
  'created, exists_vin, exists_not_associated, exists_associated, exists_unavailable, ambiguous, rate_limited, '
  'invalid_vin, invalid_serial, invalid_input, insufficient_evidence, busy. Owner direction 2026-10-15: "its supposed '
  'to create new profiles if theres enough data to support it". 20261017021000.';

COMMIT;

RESET statement_timeout;
RESET lock_timeout;
