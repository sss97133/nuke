-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_discovered_persons -f this-file.sql
-- Proves that after 20261014220000_discovered_persons_owner_only.sql anon and authenticated can no longer read
-- discovered_persons or execute the two contact-search resolvers, while the service role still can. Stubs stand in
-- for the resolvers (the migration changes only their grants, not their bodies); the before-state grants PUBLIC,
-- anon and authenticated EXECUTE and the table SELECT exactly as production did on 2026-10-14.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.discovered_persons') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_role', true), '') $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='dp_owner') THEN CREATE ROLE dp_owner NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role, dp_owner;
GRANT CREATE ON SCHEMA public TO dp_owner;

SET ROLE dp_owner;
CREATE TABLE public.discovered_persons (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text, email text, phone text);
ALTER TABLE public.discovered_persons ENABLE ROW LEVEL SECURITY;
\ir helpers/discovered_persons_live_20261014.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discovered_persons TO anon, authenticated, service_role;
-- Stub resolvers with the live signatures and the live grants (PUBLIC default EXECUTE plus explicit anon,
-- authenticated and service_role, matching the production proacl {=X,postgres,anon,authenticated,service_role}).
CREATE FUNCTION public.resolve_contact_vehicle(p_query text)
  RETURNS TABLE(vehicle_id uuid, vehicle_title text, contact_name text, contact_email text, contact_phone text, match_source text, confidence numeric)
  LANGUAGE sql STABLE AS $fn$ SELECT dp.id, 'x'::text, dp.full_name, dp.email, dp.phone, 'discovered_person'::text, 0.85::numeric FROM public.discovered_persons dp WHERE dp.full_name ILIKE '%' || p_query || '%' $fn$;
CREATE FUNCTION public.resolve_vehicle_from_input(p_query text, p_user uuid)
  RETURNS TABLE(vehicle_id uuid, year integer, make text, model text, match_type text, match_source text, confidence numeric)
  LANGUAGE sql STABLE AS $fn$ SELECT dp.id, NULL::integer, NULL::text, NULL::text, 'x'::text, 'discovered_person'::text, 0.85::numeric FROM public.discovered_persons dp WHERE dp.email ILIKE '%' || p_query || '%' $fn$;
GRANT EXECUTE ON FUNCTION public.resolve_contact_vehicle(text), public.resolve_vehicle_from_input(text, uuid) TO anon, authenticated, service_role;
RESET ROLE;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
CREATE FUNCTION public.t_refused(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean,text), public.t_refused(text) TO anon, authenticated, service_role;

INSERT INTO public.discovered_persons (full_name, email, phone) VALUES ('Jane Doe', 'jane@example.com', '555-0100');

-- 1. Before: anon reads the table and executes a resolver.
SET ROLE anon;
SET test.auth_role = 'anon';
SELECT public.t_assert((SELECT count(*) FROM public.discovered_persons) = 1, 'before: anon reads discovered_persons');
SELECT public.t_assert((SELECT contact_email FROM public.resolve_contact_vehicle('jane')) = 'jane@example.com', 'before: anon searches contacts through the resolver');
RESET ROLE;

-- 2. Apply the migration as the table/function owner, twice.
SET test.auth_role = '';
SET ROLE dp_owner;
\ir ../migrations/20261014220000_discovered_persons_owner_only.sql
\ir ../migrations/20261014220000_discovered_persons_owner_only.sql
RESET ROLE;

-- 3. After: anon and authenticated read nothing and cannot execute either resolver.
SET ROLE anon;
SET test.auth_role = 'anon';
SELECT public.t_assert(public.t_refused($q$SELECT count(*) FROM public.discovered_persons$q$), 'anon: discovered_persons select refused');
SELECT public.t_assert(public.t_refused($q$SELECT * FROM public.resolve_contact_vehicle('jane')$q$), 'anon: resolve_contact_vehicle execute refused');
SELECT public.t_assert(public.t_refused($q$SELECT * FROM public.resolve_vehicle_from_input('jane', NULL)$q$), 'anon: resolve_vehicle_from_input execute refused');
RESET ROLE;
SET ROLE authenticated;
SET test.auth_role = 'authenticated';
SELECT public.t_assert(public.t_refused($q$SELECT count(*) FROM public.discovered_persons$q$), 'authenticated: discovered_persons select refused');
SELECT public.t_assert(public.t_refused($q$SELECT * FROM public.resolve_contact_vehicle('jane')$q$), 'authenticated: resolver execute refused');
RESET ROLE;

-- 4. The service role still reads the table and runs the resolvers.
SET ROLE service_role;
SET test.auth_role = 'service_role';
SELECT public.t_assert((SELECT count(*) FROM public.discovered_persons) = 1, 'service role: reads discovered_persons');
SELECT public.t_assert((SELECT contact_email FROM public.resolve_contact_vehicle('jane')) = 'jane@example.com', 'service role: runs the resolver');
RESET ROLE;

SELECT 'discovered persons owner-only contract: all checks passed' AS result;
