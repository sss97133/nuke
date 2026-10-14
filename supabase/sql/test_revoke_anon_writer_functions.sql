-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_writer_functions -f this-file.sql
-- Proves the writer-function revoke: before it, anon and authenticated may execute all 29 owner-run writers (Supabase
-- grants EXECUTE on new public functions to both); after it, neither may, the service role still may, and the four
-- reviewed public functions keep anon's EXECUTE. A rerun is a no-op, and a signature that no longer exists is skipped.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regprocedure('public.end_live_auctions_absent(text,text[])') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

\ir helpers/writer_function_stubs_20261014.sql
-- As Supabase's default privileges do for new functions in public.
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated, service_role', f);
  END LOOP;
END $$;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
CREATE FUNCTION public.t_count(p_role text, p_kept boolean) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
     AND (p.proname IN ('register_make_model_subject', 'validate_data_room_access_code', 'confirm_photo_intent',
                        'analyze_organization_data_signals')) = p_kept
     AND has_function_privilege(p_role, p.oid, 'EXECUTE') $$;

-- 1. Before: anon and authenticated execute all 29 writers.
SELECT public.t_assert(public.t_count('anon', false) = 29 AND public.t_count('authenticated', false) = 29,
  format('before: 29 writers open to anon (%s) and authenticated (%s)', public.t_count('anon', false), public.t_count('authenticated', false)));

-- 2. The revoke.
\ir ../migrations/20261014031500_revoke_anon_writer_functions.sql

-- 3. After: closed to anon and authenticated, open to the service role, the four reviewed functions untouched.
SELECT public.t_assert(public.t_count('anon', false) = 0 AND public.t_count('authenticated', false) = 0,
  format('after: no writer open to anon (%s) or authenticated (%s)', public.t_count('anon', false), public.t_count('authenticated', false)));
SELECT public.t_assert(public.t_count('service_role', false) = 29, format('after: the service role keeps all 29 (%s)', public.t_count('service_role', false)));
SELECT public.t_assert(public.t_count('anon', true) = 4, format('after: the four reviewed functions stay public (%s)', public.t_count('anon', true)));

-- 4. A rerun is a no-op, and a signature that no longer exists is skipped.
DROP FUNCTION public.refresh_equipment_hours();
\ir ../migrations/20261014031500_revoke_anon_writer_functions.sql
SELECT public.t_assert(public.t_count('anon', false) = 0 AND public.t_count('service_role', false) = 28, 'rerun with one function gone');
SELECT 'writer functions revoke contract: PASS' AS result;
