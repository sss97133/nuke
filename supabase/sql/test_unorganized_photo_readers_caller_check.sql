-- Disposable PG17 only. Random ids, synthetic rows; exercises the actual migration on live's function shapes.
-- Proves get_unorganized_photos_optimized and get_unorganized_photo_count answer only for the caller: another account,
-- a JWT without a user and a session without a JWT get 42501 before the body runs; the owner and the service role
-- read the owner's rows. Live's bodies keep search_path '' over unqualified tables, so with no table they can resolve
-- every call fails 42P01, as it does live. Session temp tables stand in for a repaired search_path: pg_temp is searched
-- first even when search_path is ''.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR to_regprocedure('public.get_unorganized_photo_count(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable database required';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
-- auth.uid() and auth.jwt() as live defines them.
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Live before the migration (pg_get_functiondef and proacl, 2026-10-20): the count verbatim; the inbox reader with live's
-- signature, language and settings (the migration replaces its body whole). Live reached search_path '' through
-- ALTER FUNCTION, which skips body validation; check_function_bodies = off does the same here.
SET check_function_bodies = off;
CREATE FUNCTION public.get_unorganized_photo_count(p_user_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COUNT(*)::INTEGER
  FROM vehicle_images
  WHERE user_id = p_user_id
  AND vehicle_id IS NULL
  AND organization_status = 'unorganized';
$function$;
CREATE FUNCTION public.get_unorganized_photos_optimized(p_user_id uuid, p_limit integer DEFAULT 1000, p_offset integer DEFAULT 0,
  p_filter_status text DEFAULT NULL::text, p_filter_angle text DEFAULT NULL::text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ BEGIN RETURN NULL; END $function$;
RESET check_function_bodies;
REVOKE ALL ON FUNCTION public.get_unorganized_photo_count(uuid),
  public.get_unorganized_photos_optimized(uuid, integer, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_unorganized_photo_count(uuid),
  public.get_unorganized_photos_optimized(uuid, integer, integer, text, text) TO authenticated, service_role;
CREATE TEMP TABLE acl_before AS SELECT proname, proacl::text AS acl FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace AND proname IN ('get_unorganized_photo_count', 'get_unorganized_photos_optimized');

CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE FUNCTION public.t_sqlstate(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_sqlstate(text) TO authenticated, anon, service_role;
SELECT gen_random_uuid() AS owner, gen_random_uuid() AS other \gset
SELECT json_build_object('sub', :'owner', 'role', 'authenticated') AS owner_jwt,
       json_build_object('sub', :'other', 'role', 'authenticated') AS other_jwt \gset
SELECT format('SELECT public.get_unorganized_photo_count(%L)', :'owner') AS count_q,
       format('SELECT public.get_unorganized_photos_optimized(%L)', :'owner') AS inbox_q \gset

-- 1. Before: another account's call runs live's body for the owner's id: 42P01 with no table it can resolve, the
--    owner's count once it can.
SET ROLE authenticated; SET request.jwt.claims = :'other_jwt';
SELECT t_sqlstate(:'count_q') AS before_no_table \gset
RESET ROLE;
CREATE TEMP TABLE vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, image_url text,
  thumbnail_url text, variants jsonb, file_name text, file_size bigint, mime_type text, vehicle_id uuid,
  organization_status text, organized_at timestamptz, ai_processing_status text, ai_processing_started_at timestamptz,
  ai_processing_completed_at timestamptz, ai_suggestions jsonb, ai_detected_vehicle jsonb, ai_detected_angle text,
  ai_detected_angle_confidence real, suggested_vehicle_id uuid, exif_data jsonb, taken_at timestamptz,
  latitude double precision, longitude double precision, created_at timestamptz DEFAULT now(), updated_at timestamptz);
CREATE TEMP TABLE image_set_members (image_id uuid);
INSERT INTO vehicle_images (user_id, organization_status, exif_data, latitude, longitude)
VALUES (:'owner', 'unorganized', '{"Make": "test"}', 36.1, -115.1);
SET ROLE authenticated; SET request.jwt.claims = :'other_jwt';
SELECT public.get_unorganized_photo_count(:'owner') AS before_other_count \gset
RESET ROLE;
SELECT t_assert(:'before_no_table' = '42P01', 'before: live''s body fails 42P01 with no table it can resolve');
SELECT t_assert(:before_other_count = 1, 'before: another account counts the owner''s unfiled photo');

-- 2. The migration.
\ir ../migrations/20261021141000_unorganized_photo_readers_caller_check.sql

-- 3. After: refused before the body runs.
SET ROLE authenticated; SET request.jwt.claims = :'other_jwt';
SELECT t_sqlstate(:'count_q') AS other_count, t_sqlstate(:'inbox_q') AS other_inbox \gset
SET request.jwt.claims = '{"role": "authenticated"}';
SELECT t_sqlstate(:'count_q') AS no_user_count, t_sqlstate(:'inbox_q') AS no_user_inbox \gset
RESET request.jwt.claims;
SELECT t_sqlstate(:'count_q') AS no_jwt_count, t_sqlstate(:'inbox_q') AS no_jwt_inbox \gset
-- 4. The owner and the service role read the owner's rows.
SET request.jwt.claims = :'owner_jwt';
SELECT public.get_unorganized_photo_count(:'owner') AS owner_count,
       public.get_unorganized_photos_optimized(:'owner') -> 'photos' -> 0 ->> 'latitude' AS owner_lat \gset
RESET ROLE;
SET ROLE service_role; SET request.jwt.claims = '{"role": "service_role"}';
SELECT public.get_unorganized_photo_count(:'owner') AS service_count,
       public.get_unorganized_photos_optimized(:'owner') ->> 'total_count' AS service_total \gset
RESET ROLE;
-- 5. The bodies are live's: with no table they can resolve, the owner's call fails 42P01 as it does live.
DROP TABLE pg_temp.vehicle_images, pg_temp.image_set_members;
SET ROLE authenticated; SET request.jwt.claims = :'owner_jwt';
SELECT t_sqlstate(:'count_q') AS owner_no_table_count, t_sqlstate(:'inbox_q') AS owner_no_table_inbox \gset
RESET ROLE;
SELECT t_assert(:'other_count' = '42501' AND :'other_inbox' = '42501', 'after: another account is refused with 42501');
SELECT t_assert(:'no_user_count' = '42501' AND :'no_user_inbox' = '42501', 'after: a JWT without a user is refused');
SELECT t_assert(:'no_jwt_count' = '42501' AND :'no_jwt_inbox' = '42501', 'after: a session without a JWT is refused');
SELECT t_assert(:owner_count = 1 AND :'owner_lat' = '36.1', 'after: the owner reads their own unfiled photo');
SELECT t_assert(:service_count = 1 AND :'service_total' = '1', 'after: the service role reads it');
SELECT t_assert(:'owner_no_table_count' = '42P01' AND :'owner_no_table_inbox' = '42P01',
  'after: the bodies still resolve no table under search_path '''', as live');

-- 6. Security, search_path, volatility and grants are what they were.
SELECT t_assert((SELECT count(*) = 2 AND bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND p.proacl::text = b.acl)
  FROM pg_proc p JOIN acl_before b USING (proname) WHERE p.pronamespace = 'public'::regnamespace),
  'SECURITY DEFINER, search_path '''' and the EXECUTE grants are unchanged');
SELECT t_assert((SELECT string_agg(proname || ':' || provolatile::text, ',' ORDER BY proname) FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace AND proname IN ('get_unorganized_photo_count', 'get_unorganized_photos_optimized'))
  = 'get_unorganized_photo_count:s,get_unorganized_photos_optimized:v', 'volatility is unchanged');
SELECT t_assert(NOT has_function_privilege('anon', 'public.get_unorganized_photo_count(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_unorganized_photos_optimized(uuid,integer,integer,text,text)', 'EXECUTE'),
  'anon still cannot execute either');
SELECT 'unorganized photo readers caller check contract: PASS' AS result;
