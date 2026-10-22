-- Completes 20261023000000 seed/gate after the vehicles columns land in 20261023000300. Idempotent.
SET statement_timeout = '120s';
-- Body-style canon: extend the existing canonical_body_styles table (no enum, no duplicate table).
INSERT INTO public.canonical_body_styles (canonical_name, display_name, vehicle_type, aliases, description, is_active)
VALUES
  ('SPEEDSTER','Speedster','CAR',ARRAY['speedster'],'Low-windscreen open two-seater (e.g. Porsche 356 Speedster 1954-58)',true),
  ('CONVERTIBLE_D','Convertible D','CAR',ARRAY['convertible d','convertible "d"'],'Porsche 356A Convertible D (Drauz) 1958-59',true),
  ('CABRIOLET','Cabriolet','CAR',ARRAY['cabriolet','cabrio'],'Fully trimmed convertible with padded top',true),
  ('HARDTOP','Hardtop','CAR',ARRAY['hardtop','karmann hardtop','notchback'],'Fixed or welded hardtop body (e.g. 356B Karmann Hardtop)',true)
ON CONFLICT (canonical_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.identifier_rule_for(p_make text, p_model text, p_kind text, p_value text)
RETURNS TABLE (rule_id bigint, rule_status text, series text, body_style text, coachbuilder text, model_year_from int, model_year_to int)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH v AS (SELECT upper(regexp_replace(coalesce(p_value,''), '[\s\-/.]', '', 'g')) AS n),
  r AS (SELECT ir.* FROM identifier_rules ir, v
        WHERE ir.make_canonical = upper(public.normalize_make(p_make)) AND ir.kind = p_kind
          AND lower(coalesce(p_model,'')) LIKE ir.model_prefix || '%')
  SELECT r.id, 'in_range', r.series, r.body_style, r.coachbuilder, r.model_year_from, r.model_year_to
  FROM r, v WHERE v.n ~ r.pattern AND (r.range_lo IS NULL OR (v.n ~ '^[0-9]+$' AND v.n::bigint BETWEEN r.range_lo AND r.range_hi))
  UNION ALL
  SELECT NULL::bigint, CASE WHEN EXISTS (SELECT 1 FROM r) THEN 'out_of_range' ELSE 'no_rule' END, NULL, NULL, NULL, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM r, v WHERE v.n ~ r.pattern AND (r.range_lo IS NULL OR (v.n ~ '^[0-9]+$' AND v.n::bigint BETWEEN r.range_lo AND r.range_hi)))
  LIMIT 1
$$;

-- Lands one readIdentifierClaims() result (listing text or photo/capture-set read). Service role only.
CREATE OR REPLACE FUNCTION public.land_identifier_claims(p_vehicle_id uuid, p_read jsonb, p_source_url text, p_extractor text,
  p_source_kind text DEFAULT 'listing_text', p_source_image_id uuid DEFAULT NULL, p_run_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v record; c jsonb; n int := 0; rr record; v_rule_body text; v_body text;
BEGIN
  SELECT id, make, model FROM vehicles WHERE id = p_vehicle_id INTO v;
  IF v.id IS NULL THEN RETURN jsonb_build_object('status','no_vehicle'); END IF;
  FOR c IN SELECT * FROM jsonb_array_elements(coalesce(p_read->'identifiers','[]')) LOOP
    SELECT * INTO rr FROM identifier_rule_for(v.make, v.model, c->>'kind', c->>'value');
    INSERT INTO vehicle_identifiers (vehicle_id, kind, value, make_canonical, source_kind, source_url, source_image_id, quote,
      extractor, run_id, confidence, rule_id, rule_status)
    VALUES (p_vehicle_id, c->>'kind', c->>'value', upper(normalize_make(v.make)), p_source_kind, p_source_url, p_source_image_id,
      left(c->>'quote', 400), p_extractor, p_run_id,
      least(1, greatest(0, (c->>'confidence')::numeric + CASE WHEN rr.rule_status = 'in_range' THEN 0.1 WHEN rr.rule_status = 'out_of_range' THEN -0.3 ELSE 0 END)),
      rr.rule_id, CASE WHEN c->>'value' IS NULL THEN 'unchecked' ELSE rr.rule_status END)
    ON CONFLICT DO NOTHING;
    IF c->>'kind' = 'chassis' AND rr.rule_status = 'in_range' THEN v_rule_body := coalesce(v_rule_body, rr.body_style); END IF;
  END LOOP;
  -- Body-style precedence: title, then the chassis rule range, then description text.
  v_body := CASE WHEN p_read->>'body_style_basis' = 'title' THEN p_read->>'body_style'
                 ELSE coalesce(v_rule_body, p_read->>'body_style') END;
  -- Vehicle labels: fill only when empty; never overwrite a human or earlier value.
  UPDATE vehicles SET
    is_replica = coalesce(is_replica, CASE WHEN (p_read->>'is_replica')::boolean THEN true END),
    replica_quote = coalesce(replica_quote, p_read->>'replica_quote'),
    numbers_state = coalesce(numbers_state, p_read->>'numbers_claim'),
    numbers_quote = coalesce(numbers_quote, p_read->>'numbers_quote'),
    numbers_documented_by = coalesce(numbers_documented_by, nullif(ARRAY(SELECT jsonb_array_elements_text(p_read->'documented_by')), '{}')),
    canonical_body_style = coalesce(canonical_body_style, CASE WHEN (p_read->>'is_replica')::boolean THEN NULL ELSE v_body END),
    body_style_quote = coalesce(body_style_quote, p_read->>'body_style_quote')
  WHERE id = p_vehicle_id;
  RETURN jsonb_build_object('status','ok');
END $$;
REVOKE ALL ON FUNCTION public.land_identifier_claims(uuid, jsonb, text, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Dedup candidates: same make + chassis/VIN on >1 live profile. Folding is done by merge_vehicle_into_primary_by_url (supersession
-- into superseded_rows); this view only proposes.
CREATE OR REPLACE VIEW public.identifier_dedup_candidates AS
SELECT make_canonical, kind, value_norm, array_agg(DISTINCT vehicle_id) AS vehicle_ids, count(DISTINCT vehicle_id) AS profiles
FROM vehicle_identifiers WHERE kind IN ('vin','chassis') AND superseded_at IS NULL AND value_norm <> ''
GROUP BY 1,2,3 HAVING count(DISTINCT vehicle_id) > 1;

-- 356 chassis-range seed (see 20261023000100 for citations), once.
DO $seed$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.identifier_rules WHERE make_canonical = 'PORSCHE' AND model_prefix = '356') THEN
    INSERT INTO public.identifier_rules (make_canonical, model_prefix, kind, series, body_style, coachbuilder, model_year_from, model_year_to, pattern, range_lo, range_hi, citation) VALUES
('PORSCHE','356','chassis','pre-A','COUPE','Reutter',1950,1951,'^[0-9]{4,5}$',5001,5600,'[F4E] coupe 5002-5600 incl. Glaser cabrios 5001-5162'),
('PORSCHE','356','chassis','pre-A','COUPE','Reutter',1951,1953,'^[0-9]{5}$',10001,12387,'[F4E] 1951-53 coupe/cabrio 10001-12387'),
('PORSCHE','356','chassis','pre-A','CABRIOLET','Reutter',1952,1953,'^[0-9]{5}$',15001,15116,'[F4E] cabrio 15001-15116'),
('PORSCHE','356','chassis','pre-A','COUPE','Reutter',1953,1955,'^[0-9]{5}$',50001,55000,'[K071] coupe to 55000; [F4E] 50001-54223'),
('PORSCHE','356','chassis','pre-A','CABRIOLET','Reutter',1953,1955,'^[0-9]{5}$',60001,61000,'[K071] cabrio 60395-61000; [F4E] 60001-60923'),
('PORSCHE','356','chassis','pre-A','SPEEDSTER',NULL,1954,1955,'^[0-9]{5}$',80001,81900,'[K071] Speedster 80001-81900'),
('PORSCHE','356','chassis','356A T1','COUPE','Reutter',1956,1957,'^[0-9]{5}$',55001,59099,'[K071][EUR] coupe 55001-59090'),
('PORSCHE','356','chassis','356A','COUPE','Reutter',1957,1959,'^[0-9]{6}$',100001,108917,'[K071] coupe 100001-108917'),
('PORSCHE','356','chassis','356A T1','CABRIOLET','Reutter',1956,1957,'^[0-9]{5}$',61001,61892,'[K071][EUR] cabrio 61001-61892'),
('PORSCHE','356','chassis','356A T2','CABRIOLET','Reutter',1958,1959,'^[0-9]{6}$',150001,152475,'[K071] cabrio 150001-152475'),
('PORSCHE','356','chassis','356A','SPEEDSTER',NULL,1956,1959,'^[0-9]{5}$',81901,84954,'[K071] Speedster 81901-84922; [F4E] to 84954'),
('PORSCHE','356','chassis','356A T2','CONVERTIBLE_D','Drauz',1958,1959,'^[0-9]{5}$',85501,86830,'[K071] Convertible D 85501-86830'),
('PORSCHE','356','chassis','356B','COUPE','Reutter',1960,1963,'^[0-9]{6}$',108918,125239,'[K072] coupe 108918-125239'),
('PORSCHE','356','chassis','356B','CABRIOLET','Reutter',1960,1963,'^[0-9]{6}$',152476,158700,'[K072] cabrio 152476-158700'),
('PORSCHE','356','chassis','356B','ROADSTER','Drauz/D''Ieteren',1960,1962,'^[0-9]{5}$',86831,89849,'[K072] roadster 86831-89800; [F4E] to 89849'),
('PORSCHE','356','chassis','356B T5','HARDTOP','Karmann',1961,1962,'^[0-9]{6}$',200001,202299,'[K072] Karmann hardtop 200001-202299'),
('PORSCHE','356','chassis','356B T6','COUPE','Karmann',1962,1963,'^[0-9]{6}$',210001,214400,'[K072] Karmann coupe 210001-214400'),
('PORSCHE','356','chassis','356C','COUPE','Reutter',1964,1965,'^[0-9]{6}$',126001,131930,'[K072] coupe 126001-131927; [F4E] to 131930'),
('PORSCHE','356','chassis','356C','COUPE','Karmann',1964,1965,'^[0-9]{6}$',215001,222580,'[K072] Karmann coupe 215001-221482 (MY64), 221483- (MY65); [F4E] to 222580'),
('PORSCHE','356','chassis','356C','CABRIOLET','Reutter',1964,1966,'^[0-9]{6}$',159001,162175,'[K072] cabrio 159001-161577 (MY64), 161578- ; [F4E] to 162175'),
('PORSCHE','356','engine',NULL,NULL,NULL,1950,1965,'^[0-9]{4,6}$',NULL,NULL,'[K071][K072] engine numbers 4-6 digits (e.g. 1600C 710001-, SC 810001-)');
  END IF;
END $seed$;

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
$function$;
