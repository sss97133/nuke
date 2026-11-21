-- Contract: 20261121232000. capture_sets_score's reference photos (CTE anc) count a photo the owner filed himself with a
-- tap (attribute_image_session, signal=owner_session_confirm at the end of a first-attribution audit reason) for the car
-- he filed it on while it still sits there, and never count a photo marked rejected_misattributed; attribute_image_session
-- writes the owner's signal only when a signed-in end user made the call and signs work sessions only for the
-- session-confirm act (p_reason 'owner_session_confirm'), not for a ledger answer.
-- Disposable PG17 only, synthetic rows only. Both functions are installed as production's bodies of 2026-11-21 (the revert
-- file carries them) and the scorer runs for real: the fixture types embedding_clip_vitb32 as float8[] with a cosine
-- distance operator <=> standing in for pgvector's. attribute_testimony and user_can_edit_vehicle are production's, loaded
-- as the caller-check contract (test_attribute_image_session_caller_check.sql) loads them.
-- How a reference is read: each case has its own car, one candidate reference photo and one unfiled probe photo whose
-- fingerprint equals that reference's (orthogonal to every other case's). The scorer scores the probe alone
-- (p_only_imgs); its visual leg (signals->>'visual') is above zero for a car only when that car has a reference matching
-- the probe, so "reference" reads as the car with visual > 0 and "not a reference" as none.
-- Measured before the migration, after it, after the revert and after a re-apply; also checked: owner, grants, security,
-- volatility and SET clauses do not move, a replay is a no-op, a moved body of either function is refused and neither
-- function is replaced, and the revert restores both earlier bodies.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
    RAISE EXCEPTION 'Refusing fixtures outside an empty disposable PG17 database';
  END IF;
END $$;
SET statement_timeout = '120s';
SET lock_timeout = '3s';
SET TIME ZONE 'UTC';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
-- auth.uid() and auth.role() as live defines them (the caller-check contract's copies).
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION public.t_assert(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;
CREATE FUNCTION public.t_sqlstate(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;

-- ===== fixture tables: live's enums and the columns the scorer and the filer chain read and write
CREATE TYPE public.vision_gate_status AS ENUM ('pending','approved','rejected_personal','rejected_misattributed','review_needed');
CREATE TYPE public.content_approval_status AS ENUM ('pending','auto_approved','approved','rejected');
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, make text, model text, year integer, color text, vin text, license_plate text,
  owner_id uuid, user_id uuid, uploaded_by uuid, deleted_at timestamptz, merged_into_vehicle_id uuid, status text DEFAULT 'active');
CREATE TABLE public.vehicle_contributors(vehicle_id uuid NOT NULL, user_id uuid NOT NULL, role text NOT NULL,
  status text DEFAULT 'active', can_edit boolean DEFAULT true);
CREATE TABLE public.vehicle_contributor_roles(vehicle_id uuid NOT NULL, user_id uuid NOT NULL, role text NOT NULL, end_date date);
CREATE TABLE public.organization_vehicles(organization_id uuid NOT NULL, vehicle_id uuid NOT NULL, status text DEFAULT 'active');
CREATE TABLE public.organization_contributors(organization_id uuid NOT NULL, user_id uuid, role text NOT NULL, status text DEFAULT 'active');
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, taken_at timestamptz, latitude numeric,
  longitude numeric, vehicle_vin text, vehicle_vin_confidence numeric, is_document boolean DEFAULT false, doc_flag boolean,
  is_duplicate boolean DEFAULT false, is_superseded boolean, is_sensitive boolean NOT NULL DEFAULT false,
  vision_gate_status public.vision_gate_status DEFAULT 'pending', ai_scan_metadata jsonb, ai_processing_status text, source text,
  exif_data jsonb, image_url text, merged_from_vehicle_id uuid, file_hash text, is_primary boolean DEFAULT false,
  is_approved boolean DEFAULT true, approval_status public.content_approval_status NOT NULL DEFAULT 'pending',
  updated_at timestamptz DEFAULT now());
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY, vehicle_id uuid);
CREATE TABLE public.reattribution_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), observation_type text NOT NULL,
  old_observation_id uuid NOT NULL, old_vehicle_id uuid, new_observation_id uuid NOT NULL, new_vehicle_id uuid,
  reason text NOT NULL, actor_user_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.work_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, vehicle_id uuid NOT NULL,
  session_date date, start_time timestamptz, end_time timestamptz, status text, session_type text, metadata jsonb,
  owner_confirmed_at timestamptz, owner_confirmed_by uuid, updated_at timestamptz DEFAULT now());
CREATE TABLE public.image_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid, vehicle_id uuid, observed_by text,
  is_active boolean DEFAULT true, observed_at timestamptz DEFAULT now(), embedding_clip_vitb32 float8[]);
CREATE TABLE public.capture_document_pages(image_id uuid, revoked_at timestamptz);
CREATE TABLE public.capture_set_links(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid, vehicle_id uuid, run_id uuid,
  reverted_at timestamptz);
CREATE TABLE public.filing_run_gate(run_id text, passed boolean);
CREATE TABLE public.auto_filing_audit_queue(id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY, image_id uuid, vehicle_id uuid, status text);
CREATE TABLE public.image_text_reads(image_id uuid, revoked_at timestamptz, lines jsonb, vin_candidates jsonb);
CREATE TABLE public.vehicle_identifier_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid, kind text,
  value_norm text, status text, confidence numeric);
CREATE TABLE public.vehicle_model_aliases(alias_norm text, family text, make_grp text);
-- pgvector's cosine distance, on float8[]
CREATE FUNCTION public.t_cosine_distance(a float8[], b float8[]) RETURNS float8 LANGUAGE sql IMMUTABLE AS
$$ SELECT 1 - sum(x * y) / (sqrt(sum(x * x)) * sqrt(sum(y * y))) FROM unnest(a, b) u(x, y) $$;
CREATE OPERATOR public.<=> (LEFTARG = float8[], RIGHTARG = float8[], FUNCTION = public.t_cosine_distance);

-- The scorer's helpers as production defines them (pg_get_functiondef, 2026-11-21).
CREATE FUNCTION public.capture_set_photo_sources() RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog', 'public' AS $function$
  SELECT ARRAY['capture_relay_ios', 'iphoto', 'iphoto_60d', 'photo_auto_sync', 'library_recovery']
$function$;
CREATE FUNCTION public.capture_set_photo_admits(p_source text, p_vehicle_id uuid, p_exif jsonb) RETURNS boolean
 LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $function$
  SELECT p_source = ANY (public.capture_set_photo_sources())
      OR (p_vehicle_id IS NULL
          AND (p_source = ANY (ARRAY['user_upload', 'owner_upload', 'drop-folder', 'image_intake']) OR p_source LIKE 'direct\_pull_%' ESCAPE '\')
          AND (coalesce(p_exif ? 'DateTimeOriginal', false)
               OR coalesce((p_exif->>'import_session_admit')::boolean, false)))
$function$;
CREATE FUNCTION public.vin_match_key(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp' AS $function$
  SELECT nullif(translate(regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]', '', 'g'), 'OQISBZG', '0015826'), '')
$function$;
CREATE FUNCTION public.vehicle_model_family(p_make text, p_model text) RETURNS text LANGUAGE sql STABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp' AS $function$
  WITH m AS (
    SELECT CASE WHEN lower(btrim(coalesce(p_make,''))) IN ('chevrolet','chevy','gmc','gm') THEN 'gm'
                WHEN lower(btrim(coalesce(p_make,''))) IN ('dodge','ram') THEN 'dodge_ram'
                WHEN lower(btrim(coalesce(p_make,''))) LIKE 'olds%' THEN 'oldsmobile'
                ELSE regexp_replace(lower(coalesce(p_make,'')),'[^a-z0-9]','','g') END grp,
           regexp_replace(lower(coalesce(p_model,'')),'[^a-z0-9]','','g') full_,
           regexp_replace(lower(split_part(btrim(coalesce(p_model,'')),' ',1)),'[^a-z0-9]','','g') first_)
  SELECT a.family FROM m JOIN vehicle_model_aliases a
    ON a.alias_norm IN (m.full_, m.first_) AND (m.grp = '' OR a.make_grp = m.grp)
  ORDER BY (a.alias_norm = m.full_) DESC, length(a.alias_norm) DESC LIMIT 1
$function$;

-- user_can_edit_vehicle and attribute_testimony exactly as the caller-check contract installs them (production's md5s).
\ir ../migrations/20251201000002_fix_user_can_edit_vehicle_function.sql
ALTER FUNCTION public.user_can_edit_vehicle(uuid, uuid) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.user_can_edit_vehicle(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_edit_vehicle(uuid, uuid) TO authenticated, service_role;
SET check_function_bodies = off;
\ir ../migrations/20261018201500_org_chronology_session_confirm_functions.sql
RESET check_function_bodies;
\ir ../migrations/20261021140000_fix_attribute_testimony_gate_cast.sql
SELECT public.t_assert((SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.user_can_edit_vehicle(uuid,uuid)'::regprocedure)
    = '73bef5009e56d9ad7337db1fee9c1ab5' -- gitleaks:allow (function-definition fingerprint, not a secret)
  AND (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.attribute_testimony(text,uuid,uuid,text,uuid,numeric,text)'::regprocedure)
    = '7492c54c97880e31123dcd49d56b0f9c', -- gitleaks:allow (function-definition fingerprint, not a secret)
  'fixture: user_can_edit_vehicle and attribute_testimony are production''s bodies');

-- ===== production's bodies of the two functions, installed by the revert file (a function that is absent is created),
-- then production's grants (proacl read 2026-11-21)
\ir revert_20261121232000_scorer_references_owner_filed_not_pulled.sql
REVOKE ALL ON FUNCTION public.capture_sets_score(uuid, timestamptz, timestamptz, text, uuid[], jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.capture_sets_score(uuid, timestamptz, timestamptz, text, uuid[], jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.attribute_image_session(uuid[], uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attribute_image_session(uuid[], uuid, uuid, text) TO authenticated, service_role;

CREATE FUNCTION public.t_md5s() RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws(',',
    (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.capture_sets_score(uuid,timestamptz,timestamptz,text,uuid[],jsonb)')),
    (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.attribute_image_session(uuid[],uuid,uuid,text)'))) $$;
CREATE FUNCTION public.t_marks() RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(((length(prosrc) - length(replace(prosrc, '(20261121232000)', ''))) / length('(20261121232000)'))::text, ',' ORDER BY proname)
    FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('attribute_image_session', 'capture_sets_score') $$;
-- Everything about the two functions except their bodies: the migration and the revert must leave all of it as it is.
CREATE FUNCTION public.t_attrs() RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(concat_ws('|', p.oid::regprocedure::text, pg_get_userbyid(p.proowner), p.prosecdef, p.provolatile,
           pg_get_function_result(p.oid), p.proconfig, p.proacl, p.proretset, p.prolang), E'\n' ORDER BY p.oid::regprocedure::text)
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('capture_sets_score', 'attribute_image_session') $$;
CREATE TABLE public.t_pins AS SELECT public.t_attrs() AS attrs;
\set was '3fba1c6d2b35d960910c02837fbdf6f3,1960e0ad7d603b701f1c96574977228a'
\set becomes '75096c1e43e63be82fc2d308cf62ee10,734210d4b21dda0e02768d8fd4c680d7'
SELECT public.t_assert(public.t_md5s() = :'was', 'fixture: the scorer and the filer are production''s bodies of 2026-11-21');
SELECT public.t_assert((SELECT count(*) = 2 AND bool_and(prosecdef) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
    AND proname IN ('capture_sets_score', 'attribute_image_session'))
  AND has_function_privilege('authenticated', 'public.attribute_image_session(uuid[],uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.attribute_image_session(uuid[],uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.capture_sets_score(uuid,timestamptz,timestamptz,text,uuid[],jsonb)', 'EXECUTE'),
  'fixture: both are SECURITY DEFINER with production''s grants');

-- ===== rows. The owner U, a stranger S, another account O. Case nn: car t_car(nn), reference photo t_img(nn) (taken in
-- January), probe t_probe(nn) (unfiled, November) with the same fingerprint t_e(dim).
CREATE FUNCTION public.t_car(nn text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('c0000000-0000-4000-8000-0000000000' || nn)::uuid $$;
CREATE FUNCTION public.t_img(nn text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('a0000000-0000-4000-8000-0000000000' || nn)::uuid $$;
CREATE FUNCTION public.t_probe(nn text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('b0000000-0000-4000-8000-0000000000' || nn)::uuid $$;
CREATE FUNCTION public.t_e(dim int) RETURNS float8[] LANGUAGE sql IMMUTABLE AS
$$ SELECT array_agg(CASE WHEN j = dim THEN 1.0 ELSE 0.0 END::float8 ORDER BY j) FROM generate_series(1, 20) j $$;
\set U '''00000000-0000-4000-8000-0000000000aa'''
\set S '''00000000-0000-4000-8000-0000000000bb'''
\set O '''00000000-0000-4000-8000-0000000000cc'''
INSERT INTO public.vehicles(id, owner_id, user_id, uploaded_by)
SELECT public.t_car(nn), :U, :U, :U
  FROM unnest(ARRAY['01','02','03','04','05','06','07','08','09','0a','0b','0c','0d','0e','0f','10','11','12','13','14','15','16','17','18']) nn;
-- one photo: p_on = the car it sits on (null: unfiled), p_named = a car a machine image_observations row names on it,
-- p_dim = its fingerprint (null: none), and a probe with the same fingerprint when p_dim is set
CREATE FUNCTION public.t_photo(nn text, p_dim int, p_source text, p_on text, p_named text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.vehicle_images(id, user_id, vehicle_id, taken_at, source, image_url, vision_gate_status)
  VALUES (public.t_img(nn), '00000000-0000-4000-8000-0000000000aa', CASE WHEN p_on IS NOT NULL THEN public.t_car(p_on) END,
          '2026-01-01 12:00+00'::timestamptz + make_interval(days => coalesce(p_dim, 30)), p_source, 'https://img.example/a' || nn,
          CASE WHEN p_on IS NOT NULL THEN 'approved' ELSE 'pending' END::public.vision_gate_status);
  IF p_named IS NOT NULL THEN
    INSERT INTO public.image_observations(image_id, vehicle_id, observed_by) VALUES (public.t_img(nn), public.t_car(p_named), 'ios_vision_v2');
  END IF;
  IF p_dim IS NOT NULL THEN
    INSERT INTO public.image_observations(image_id, observed_by, embedding_clip_vitb32) VALUES (public.t_img(nn), 'clip_vitb32_v1', public.t_e(p_dim));
    INSERT INTO public.vehicle_images(id, user_id, taken_at, source, image_url)
    VALUES (public.t_probe(nn), '00000000-0000-4000-8000-0000000000aa', '2026-11-01 12:00+00'::timestamptz + make_interval(hours => p_dim),
            'capture_relay_ios', 'https://img.example/b' || nn);
    INSERT INTO public.image_observations(image_id, observed_by, embedding_clip_vitb32) VALUES (public.t_probe(nn), 'clip_vitb32_v1', public.t_e(p_dim));
  END IF;
END $$;
SELECT public.t_photo('01', 1, 'capture_relay_ios', NULL, NULL);   -- 1: the owner files it (below), then the reviewed reader reads it
SELECT public.t_photo('02', 2, 'capture_relay_ios', NULL, '12');   -- 2: the owner files it on 02; it is then moved to 12
SELECT public.t_photo('03', 3, 'capture_relay_ios', '03', '03');   -- 3: a machine filing that records the owner as actor
SELECT public.t_photo('04', 4, 'capture_relay_ios', NULL, '04');   -- 4: owner-filed, then an auditor marks it wrong
SELECT public.t_photo('05', 5, 'user_upload', '05', NULL);         -- 5a: a reference through arm 1, marked rejected_misattributed
SELECT public.t_photo('06', 6, 'capture_relay_ios', '06', NULL);   -- 5b: a reference through arm 2, marked rejected_misattributed
SELECT public.t_photo('07', 7, 'capture_relay_ios', NULL, '07');   -- 5c: owner-filed, marked rejected_misattributed
SELECT public.t_photo('08', 8, 'capture_relay_ios', '08', '08');   -- 7a: the signal mid-reason, another signal at the end
SELECT public.t_photo('09', 9, 'capture_relay_ios', '09', '09');   -- 7b: ends with the signal, not a first attribution
SELECT public.t_photo('0a', 10, 'capture_relay_ios', '0a', '0a');  -- 7c: ownerXsessionXconfirm (the underscores are literal)
SELECT public.t_photo('0b', 11, 'capture_relay_ios', '0b', '0b');  -- 7d: the owner's signal, another account as actor
SELECT public.t_photo('11', 17, 'capture_relay_ios', '11', '11');  -- 7e: the owner's signal on an observation-type row
SELECT public.t_photo('0c', 12, 'user_upload', '0c', NULL);        -- control: arm 1
SELECT public.t_photo('0d', 13, 'capture_relay_ios', '0d', '0d');  -- control: arm 3 (a landing run whose gate passed)
SELECT public.t_photo('0e', 14, 'capture_relay_ios', NULL, '0e');  -- 6a: filed after the migration by the signed-in owner
SELECT public.t_photo('0f', 15, 'capture_relay_ios', NULL, '0f');  -- 6b: filed after the migration by the service role
SELECT public.t_photo('10', NULL, 'capture_relay_ios', NULL, NULL); -- 6: a service-role filing before the migration
SELECT public.t_photo('13', NULL, 'capture_relay_ios', NULL, NULL); -- 6: a filing with no JWT after the migration
SELECT public.t_photo('14', NULL, 'capture_relay_ios', NULL, NULL); -- 6: a stranger's attempts
SELECT public.t_photo('15', NULL, 'capture_relay_ios', NULL, NULL); -- 9: the phone's session confirm before the migration
SELECT public.t_photo('16', NULL, 'capture_relay_ios', NULL, NULL); -- 9: the phone's session confirm after it
SELECT public.t_photo('17', NULL, 'capture_relay_ios', NULL, NULL); -- 10: a ledger answer before the migration
SELECT public.t_photo('18', 18, 'capture_relay_ios', NULL, NULL);   -- 10, 11: a ledger answer after it, then read
-- 9, 10: one unconfirmed work session per car on the photo's local day (start_time null, so no scorer leg reads it)
INSERT INTO public.work_sessions(user_id, vehicle_id, session_date)
SELECT '00000000-0000-4000-8000-0000000000aa', public.t_car(nn),
       (SELECT (taken_at AT TIME ZONE 'America/Los_Angeles')::date FROM public.vehicle_images WHERE id = public.t_img(nn))
  FROM unnest(ARRAY['15','16','17','18']) nn;
CREATE FUNCTION public.t_signed(nn text) RETURNS boolean LANGUAGE sql AS $$
  SELECT owner_confirmed_at IS NOT NULL AND owner_confirmed_by = '00000000-0000-4000-8000-0000000000aa'
    FROM public.work_sessions WHERE vehicle_id = public.t_car(nn) $$;
CREATE FUNCTION public.t_on(nn text) RETURNS boolean LANGUAGE sql AS $$
  SELECT vehicle_id = public.t_car(nn) FROM public.vehicle_images WHERE id = public.t_img(nn) $$;
INSERT INTO public.capture_set_links(image_id, vehicle_id, run_id) VALUES
  (public.t_img('03'), public.t_car('03'), 'e0000000-0000-4000-8000-000000000003'),
  (public.t_img('0d'), public.t_car('0d'), 'e0000000-0000-4000-8000-00000000000d');
INSERT INTO public.filing_run_gate VALUES ('e0000000-0000-4000-8000-000000000003', false), ('e0000000-0000-4000-8000-00000000000d', true);
INSERT INTO public.reattribution_audit(observation_type, old_observation_id, new_observation_id, new_vehicle_id, reason, actor_user_id) VALUES
  ('image', public.t_img('03'), public.t_img('03'), public.t_car('03'),
   'first_attribution: capture_set_scored_session run=e0000000; confidence=0.91; signal=capture_set_scored_session', :U),
  ('image', public.t_img('08'), public.t_img('08'), public.t_car('08'),
   'first_attribution: correction of owner_session_confirm by agent; confidence=1.0; signal=capture_set_manual_visual', :U),
  ('image', public.t_img('09'), public.t_img('09'), public.t_car('09'),
   'correction of owner_session_confirm 2026-10-17; signal=owner_session_confirm', :U),
  ('image', public.t_img('0a'), public.t_img('0a'), public.t_car('0a'),
   'first_attribution: owner_session_confirm; confidence=1.0; signal=ownerXsessionXconfirm', :U),
  ('image', public.t_img('0b'), public.t_img('0b'), public.t_car('0b'),
   'first_attribution: owner_session_confirm; confidence=1.0; signal=owner_session_confirm', :O),
  ('observation', public.t_img('11'), public.t_img('11'), public.t_car('11'),
   'first_attribution: owner_session_confirm; confidence=1.0; signal=owner_session_confirm', :U);

-- The reference measure: for each probe, the car whose visual leg is above zero ('-' for none), by the last two characters.
CREATE FUNCTION public.t_ref(nn text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce((SELECT right(s.vehicle_id::text, 2)
                     FROM public.capture_sets_score('00000000-0000-4000-8000-0000000000aa', NULL, NULL, 'live', ARRAY[public.t_probe(nn)]) s
                    WHERE (s.signals ->> 'visual')::numeric > 0 ORDER BY s.rank LIMIT 1), '-') $$;
CREATE FUNCTION public.t_refs() RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(nn || '=' || public.t_ref(nn), ',' ORDER BY nn)
    FROM unnest(ARRAY['01','02','03','04','05','06','07','08','09','0a','0b','0c','0d','0e','0f','11','18']) nn $$;
-- the reason of the newest audit row for a photo
CREATE FUNCTION public.t_reason(nn text) RETURNS text LANGUAGE sql AS $$
  SELECT reason FROM public.reattribution_audit WHERE new_observation_id = public.t_img(nn) ORDER BY created_at DESC, id LIMIT 1 $$;
CREATE TABLE public.t_got(step text PRIMARY KEY, v text);

-- ===== before. The owner files 01, 02, 04 and 07 by tapping in the phone (signed in); a service-role job files 10 naming him.
SET ROLE authenticated;
SET request.jwt.claims = '{"role": "authenticated", "sub": "00000000-0000-4000-8000-0000000000aa"}';
SELECT public.attribute_image_session(ARRAY[public.t_img('01')], public.t_car('01')) AS n01 \gset
SELECT public.attribute_image_session(ARRAY[public.t_img('02')], public.t_car('02')) AS n02 \gset
SELECT public.attribute_image_session(ARRAY[public.t_img('04')], public.t_car('04')) AS n04 \gset
SELECT public.attribute_image_session(ARRAY[public.t_img('07')], public.t_car('07')) AS n07 \gset
SELECT public.attribute_image_session(ARRAY[public.t_img('15')], public.t_car('15')) AS n15 \gset
SELECT public.attribute_image_session(ARRAY[public.t_img('17')], public.t_car('17'), NULL, 'owner_ledger_answer') AS n17 \gset
SET request.jwt.claims = '{"role": "authenticated", "sub": "00000000-0000-4000-8000-0000000000bb"}';
SELECT public.t_sqlstate(format('select public.attribute_image_session(%L, %L)', ARRAY[public.t_img('14')], public.t_car('14'))) AS stranger_before \gset
SET ROLE service_role;
SET request.jwt.claims = '{"role": "service_role"}';
SELECT public.attribute_image_session(ARRAY[public.t_img('10')], public.t_car('10'), '00000000-0000-4000-8000-0000000000aa') AS n10 \gset
RESET ROLE;
RESET request.jwt.claims;
SELECT public.t_assert(:n01 + :n02 + :n04 + :n07 = 4
  AND (SELECT count(*) FROM public.vehicle_images WHERE id IN (public.t_img('01'), public.t_img('02'), public.t_img('04'), public.t_img('07'))
         AND vehicle_id = public.t_car(right(id::text, 2))) = 4
  AND public.t_reason('01') = 'first_attribution: owner_session_confirm; confidence=1.0; signal=owner_session_confirm',
  'before: the signed-in owner files four photos, each with the owner''s signal');
SELECT public.t_assert(:n15 = 1 AND public.t_on('15') AND public.t_signed('15'),
  'before (9): the phone''s session confirm (default reason) files the photo and signs that car''s work session of the day');
SELECT public.t_assert(:n17 = 1 AND public.t_on('17') AND public.t_signed('17')
  AND public.t_reason('17') = 'first_attribution: owner_ledger_answer; confidence=1.0; signal=owner_session_confirm',
  'before (10, the gap): a ledger answer files the photo and also signs the work session');
SELECT public.t_assert(:'stranger_before' = '42501' AND (SELECT vehicle_id IS NULL FROM public.vehicle_images WHERE id = public.t_img('14')),
  'before: a stranger''s call is refused (42501)');
SELECT public.t_assert(:n10 = 1 AND public.t_reason('10') LIKE '%; signal=owner\_session\_confirm',
  'before (the gap): a service-role call naming the owner files the photo with the owner''s signal');
-- 1: filed by the owner and not yet read, the photo counts through arm 2; the reviewed photo reader then writes its row
-- naming the car (observed_by 'caller-byok ...', as production's deep reader does after a photo is filed), and it stops
SELECT public.t_assert(public.t_ref('01') = '01', 'before: the owner''s filing counts while no reading names the car');
INSERT INTO public.image_observations(image_id, vehicle_id, observed_by, is_active)
VALUES (public.t_img('01'), public.t_car('01'), 'caller-byok subscription', true);
SELECT public.t_assert(public.t_ref('01') = '-', 'before: once a reading names the car, the owner''s own filing is no reference');
-- what happened later to 02, 04 and 07 (fixture stand-ins for relink_testimony, an audit verdict and the vision gate)
UPDATE public.vehicle_images SET vehicle_id = public.t_car('12') WHERE id = public.t_img('02');
INSERT INTO public.auto_filing_audit_queue(image_id, vehicle_id, status) VALUES (public.t_img('04'), public.t_car('04'), 'wrong');
UPDATE public.vehicle_images SET vision_gate_status = 'rejected_misattributed' WHERE id IN (public.t_img('05'), public.t_img('06'), public.t_img('07'));

INSERT INTO public.t_got VALUES ('before', public.t_refs());
SELECT public.t_assert(public.t_ref('0c') = '0c' AND public.t_ref('0d') = '0d', 'fixture: the probe reads a reference through arm 1 and arm 3');
SELECT public.t_assert((SELECT v FROM public.t_got WHERE step = 'before')
  = '01=-,02=-,03=-,04=-,05=05,06=06,07=-,08=-,09=-,0a=-,0b=-,0c=0c,0d=0d,0e=-,0f=-,11=-,18=-',
  'before: an owner-filed photo a reading names is no reference (1); rejected_misattributed photos are (5a, 5b)');

-- ===== the migration
\ir ../migrations/20261121232000_scorer_references_owner_filed_not_pulled.sql
SELECT public.t_assert(public.t_md5s() = :'becomes', 'the two functions are the bodies the migration names');
SELECT public.t_assert(public.t_marks() = '2,3', 'the filer carries two markers, the scorer three');
SELECT public.t_assert(public.t_attrs() = (SELECT attrs FROM public.t_pins),
  'owner, grants, security setting, volatility, SET clauses and return types are unchanged');

-- 6: the filer after the migration
SET ROLE authenticated;
SET request.jwt.claims = '{"role": "authenticated", "sub": "00000000-0000-4000-8000-0000000000aa"}';
SELECT public.attribute_image_session(ARRAY[public.t_img('0e')], public.t_car('0e')) AS n0e \gset
SELECT public.attribute_image_session(ARRAY[public.t_img('16')], public.t_car('16')) AS n16 \gset
SELECT public.attribute_image_session(ARRAY[public.t_img('18')], public.t_car('18'), NULL, 'owner_ledger_answer') AS n18 \gset
SET request.jwt.claims = '{"role": "authenticated", "sub": "00000000-0000-4000-8000-0000000000bb"}';
SELECT public.t_sqlstate(format('select public.attribute_image_session(%L, %L)', ARRAY[public.t_img('14')], public.t_car('14'))) AS stranger_after \gset
SELECT public.t_sqlstate(format('select public.attribute_image_session(%L, %L, %L)', ARRAY[public.t_img('14')], public.t_car('14'),
  '00000000-0000-4000-8000-0000000000aa')) AS stranger_naming_owner \gset
SET ROLE anon;
SET request.jwt.claims = '{"role": "anon"}';
SELECT public.t_sqlstate(format('select public.attribute_image_session(%L, %L, %L)', ARRAY[public.t_img('14')], public.t_car('14'),
  '00000000-0000-4000-8000-0000000000aa')) AS anon_after \gset
SET ROLE service_role;
SET request.jwt.claims = '{"role": "service_role"}';
SELECT public.attribute_image_session(ARRAY[public.t_img('0f')], public.t_car('0f'), '00000000-0000-4000-8000-0000000000aa') AS n0f \gset
RESET ROLE;
RESET request.jwt.claims;
SELECT public.attribute_image_session(ARRAY[public.t_img('13')], public.t_car('13'), '00000000-0000-4000-8000-0000000000aa') AS n13 \gset
SELECT public.t_assert(:n0e = 1 AND (SELECT vehicle_id = public.t_car('0e') FROM public.vehicle_images WHERE id = public.t_img('0e'))
  AND public.t_reason('0e') = 'first_attribution: owner_session_confirm; confidence=1.0; signal=owner_session_confirm'
  AND (SELECT actor_user_id FROM public.reattribution_audit WHERE new_observation_id = public.t_img('0e')) = :U,
  'after: the signed-in owner''s tap files the photo with the owner''s signal, as before');
SELECT public.t_assert(:n0f = 1 AND (SELECT vehicle_id = public.t_car('0f') FROM public.vehicle_images WHERE id = public.t_img('0f'))
  AND public.t_reason('0f') = 'first_attribution: owner_session_confirm; confidence=1.0; signal=service_session_confirm'
  AND (SELECT actor_user_id FROM public.reattribution_audit WHERE new_observation_id = public.t_img('0f')) = :U,
  'after: a service-role call naming the owner still files the photo, with service_session_confirm');
SELECT public.t_assert(:n16 = 1 AND public.t_on('16') AND public.t_signed('16'),
  'after (9): the phone''s session confirm still files the photo and signs the work session, unchanged');
SELECT public.t_assert(:n18 = 1 AND public.t_on('18') AND NOT public.t_signed('18')
  AND (SELECT owner_confirmed_at IS NULL AND owner_confirmed_by IS NULL FROM public.work_sessions WHERE vehicle_id = public.t_car('18')),
  'after (10): a ledger answer files the photo with the same count and leaves the work session unsigned');
SELECT public.t_assert(right(public.t_reason('18'), length('; signal=owner_session_confirm')) = '; signal=owner_session_confirm'
  AND public.t_reason('18') = 'first_attribution: owner_ledger_answer; confidence=1.0; signal=owner_session_confirm',
  'after (11): a signed-in ledger answer writes first_attribution: owner_ledger_answer; ...; signal=owner_session_confirm');
-- 11: the reviewed reader then reads the ledger-answered photo; arm A keeps it a reference (in the after measure below)
INSERT INTO public.image_observations(image_id, vehicle_id, observed_by, is_active)
VALUES (public.t_img('18'), public.t_car('18'), 'caller-byok subscription', true);
SELECT public.t_assert(:n13 = 1 AND public.t_reason('13') LIKE '%; signal=service\_session\_confirm',
  'after: a call with no JWT naming the owner files with service_session_confirm');
SELECT public.t_assert(:'stranger_after' = '42501' AND :'stranger_naming_owner' = '42501' AND :'anon_after' = '42501'
  AND (SELECT vehicle_id IS NULL FROM public.vehicle_images WHERE id = public.t_img('14'))
  AND NOT EXISTS (SELECT 1 FROM public.reattribution_audit WHERE new_observation_id = public.t_img('14')),
  'after: the caller check is unchanged (a stranger, a stranger naming the owner and anon get 42501, nothing written)');

INSERT INTO public.t_got VALUES ('after', public.t_refs());
SELECT public.t_assert((SELECT v FROM public.t_got WHERE step = 'after')
  = '01=01,02=-,03=-,04=-,05=-,06=-,07=-,08=-,09=-,0a=-,0b=-,0c=0c,0d=0d,0e=0e,0f=-,11=-,18=18',
  'after: owner-filed photos keep counting for the car they sit on after a reading (1, 6a, a ledger answer 11); a moved one (2), a machine filing (3), '
  'an audited-wrong one (4), a service-role filing (6b) and look-alike reasons (7a-7e) are not; no rejected_misattributed photo is (5a-5c)');

-- ===== replay: nothing moves
\ir ../migrations/20261121232000_scorer_references_owner_filed_not_pulled.sql
SELECT public.t_assert(public.t_md5s() = :'becomes' AND public.t_attrs() = (SELECT attrs FROM public.t_pins), 'replay: both bodies are left as they are');

-- ===== revert: production's earlier bodies and the earlier measurements
\ir revert_20261121232000_scorer_references_owner_filed_not_pulled.sql
SELECT public.t_assert(public.t_md5s() = :'was' AND public.t_attrs() = (SELECT attrs FROM public.t_pins),
  'revert: the earlier bodies, attributes unchanged');
INSERT INTO public.t_got VALUES ('reverted', public.t_refs());
SELECT public.t_assert((SELECT v FROM public.t_got WHERE step = 'reverted') = (SELECT v FROM public.t_got WHERE step = 'before'),
  'revert: the earlier reference set is back');
\ir revert_20261121232000_scorer_references_owner_filed_not_pulled.sql
SELECT public.t_assert(public.t_md5s() = :'was', 'a second revert changes nothing');

-- ===== refused: a body that moved since the migration was written; the other function is not replaced either
CREATE TABLE public.t_def AS SELECT p.proname, pg_get_functiondef(p.oid) AS def FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('capture_sets_score', 'attribute_image_session');
DO $$ BEGIN EXECUTE replace((SELECT def FROM public.t_def WHERE proname = 'capture_sets_score'), 'return query', 'return  query'); END $$;
CREATE TABLE public.t_moved AS SELECT public.t_md5s() AS m;
SELECT public.t_assert((SELECT m FROM public.t_moved) <> :'was' AND split_part((SELECT m FROM public.t_moved), ',', 2) = split_part(:'was', ',', 2),
  'fixture: the scorer has moved');
\set ON_ERROR_STOP off
\ir ../migrations/20261121232000_scorer_references_owner_filed_not_pulled.sql
\set ON_ERROR_STOP on
SELECT public.t_assert(public.t_md5s() = (SELECT m FROM public.t_moved), 'refused: a moved scorer is not overwritten and the filer is not replaced');
DO $$ BEGIN EXECUTE (SELECT def FROM public.t_def WHERE proname = 'capture_sets_score'); END $$;
DO $$ BEGIN EXECUTE replace((SELECT def FROM public.t_def WHERE proname = 'attribute_image_session'), 'n int := 0;', 'n int := 0; '); END $$;
DELETE FROM public.t_moved;
INSERT INTO public.t_moved SELECT public.t_md5s();
SELECT public.t_assert((SELECT m FROM public.t_moved) <> :'was' AND split_part((SELECT m FROM public.t_moved), ',', 1) = split_part(:'was', ',', 1),
  'fixture: the filer has moved');
\set ON_ERROR_STOP off
\ir ../migrations/20261121232000_scorer_references_owner_filed_not_pulled.sql
\set ON_ERROR_STOP on
SELECT public.t_assert(public.t_md5s() = (SELECT m FROM public.t_moved), 'refused: a moved filer is not overwritten and the scorer is not replaced');
DO $$ BEGIN EXECUTE (SELECT def FROM public.t_def WHERE proname = 'attribute_image_session'); END $$;
SELECT public.t_assert(public.t_md5s() = :'was' AND public.t_attrs() = (SELECT attrs FROM public.t_pins), 'fixture: production''s bodies are back');

-- ===== applied again from the reverted state: the same bodies and the same references
\ir ../migrations/20261121232000_scorer_references_owner_filed_not_pulled.sql
SELECT public.t_assert(public.t_md5s() = :'becomes' AND public.t_attrs() = (SELECT attrs FROM public.t_pins)
  AND public.t_refs() = (SELECT v FROM public.t_got WHERE step = 'after'),
  'applied again from the reverted state: the same bodies and the same references');
\echo 'scorer references owner-filed not pulled contract passed'
