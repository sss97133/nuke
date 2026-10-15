-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_live_auction_health -f this-file.sql
-- Proves that after 20261014170000_live_auction_health_execute_owner_only.sql anon and authenticated can no longer
-- EXECUTE public.get_live_auction_health(), the service role still can, and the owner-run view that reads it keeps
-- resolving. A stub stands in for the real function (the migration only changes its grants, not its body); the
-- before-state grants anon and authenticated EXECUTE exactly as production did on 2026-10-14.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regprocedure('public.get_live_auction_health()') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'health_owner') THEN CREATE ROLE health_owner NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, health_owner;
GRANT CREATE ON SCHEMA public TO health_owner;

-- The function as production grants it, owned by a non-superuser: SECURITY DEFINER, and EXECUTE held by PUBLIC (the
-- default a new function gets), anon, authenticated and service_role; live proacl on 2026-10-14 was
-- {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}. Plus the
-- owner-run view v_job_health that reads it. A function's EXECUTE is checked against whoever queries the view.
SET ROLE health_owner;
CREATE FUNCTION public.get_live_auction_health() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
  AS $fn$ SELECT jsonb_build_object('status', 'passed', 'total_monitored', 0) $fn$;
GRANT EXECUTE ON FUNCTION public.get_live_auction_health() TO anon, authenticated, service_role;
CREATE VIEW public.v_job_health AS SELECT (public.get_live_auction_health() -> 'status') AS auction_status;
REVOKE ALL ON public.v_job_health FROM PUBLIC;
-- As production grants it: only postgres and service_role read v_job_health (not anon, not authenticated).
GRANT SELECT ON public.v_job_health TO service_role;
RESET ROLE;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
CREATE FUNCTION public.t_refused(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN false;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_refused(text) TO anon, authenticated, service_role;

-- 1. Before: anon and authenticated can execute it.
SELECT public.t_assert(has_function_privilege('public', 'public.get_live_auction_health()', 'EXECUTE'), 'before: PUBLIC executes, as in production');
SELECT public.t_assert(has_function_privilege('anon', 'public.get_live_auction_health()', 'EXECUTE'), 'before: anon executes');
SELECT public.t_assert(has_function_privilege('authenticated', 'public.get_live_auction_health()', 'EXECUTE'), 'before: authenticated executes');
SET ROLE anon;
SELECT public.t_assert(public.get_live_auction_health() ? 'status', 'before: anon gets the health object');
RESET ROLE;

-- 2. Apply the migration as the function owner, twice (the second run is a no-op).
SET ROLE health_owner;
\ir ../migrations/20261014170000_live_auction_health_execute_owner_only.sql
\ir ../migrations/20261014170000_live_auction_health_execute_owner_only.sql
RESET ROLE;

-- 3. After: anon and authenticated are refused; the service role still executes.
SELECT public.t_assert(NOT has_function_privilege('public', 'public.get_live_auction_health()', 'EXECUTE'), 'after: PUBLIC cannot execute');
SELECT public.t_assert(NOT has_function_privilege('anon', 'public.get_live_auction_health()', 'EXECUTE'), 'after: anon cannot execute');
SELECT public.t_assert(NOT has_function_privilege('authenticated', 'public.get_live_auction_health()', 'EXECUTE'), 'after: authenticated cannot execute');
SELECT public.t_assert(has_function_privilege('service_role', 'public.get_live_auction_health()', 'EXECUTE'), 'after: service role still executes');
SET ROLE anon;
SELECT public.t_assert(public.t_refused($q$SELECT public.get_live_auction_health()$q$), 'after: anon execution refused');
RESET ROLE;
SET ROLE authenticated;
SELECT public.t_assert(public.t_refused($q$SELECT public.get_live_auction_health()$q$), 'after: authenticated execution refused');
-- A non-security_invoker view checks function EXECUTE against the reader, not the view owner, so authenticated
-- cannot reach the function through v_job_health either — and production grants that view to no one but postgres
-- and service_role, so nothing authenticated relies on it.
SELECT public.t_assert(NOT has_table_privilege('authenticated', 'public.v_job_health', 'SELECT'), 'after: authenticated cannot even read v_job_health');
RESET ROLE;
SET ROLE service_role;
SELECT public.t_assert(public.get_live_auction_health() ? 'status', 'after: service role still gets the health object');
-- The service role reads v_job_health, and the function runs for it (service_role kept EXECUTE).
SELECT public.t_assert((SELECT auction_status FROM public.v_job_health) = to_jsonb('passed'::text), 'after: v_job_health still resolves for the service role');
RESET ROLE;

SELECT 'live auction health execute contract: all checks passed' AS result;
