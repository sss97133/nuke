-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_fuzzy_owner -f this-file.sql
-- Contract for 20261015020000_search_fuzzy_runs_as_owner.sql. Synthetic rows only; never production.
-- vehicles is built with row security and production's two read policies; the fuzzy reader is installed by
-- 20261015010000 over the live body, then made security definer:
--   * anon, authenticated and the service role get the same rows, which are exactly the public vehicles anon could
--     read itself; a private vehicle with a matching name is never returned;
--   * the function is security definer with search_path pinned to public, pg_temp; the migration refuses any other
--     body and is idempotent.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '120s';
SET lock_timeout = '3s';
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('test.auth_role', true), ''), 'anon') $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS
$$ INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command) RETURNING jobid $$;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, year integer, make text, model text, vin text, primary_image_url text,
  sale_price integer, is_public boolean, user_id uuid);
CREATE INDEX idx_vehicles_lower_make_model ON public.vehicles USING btree (lower(make), lower(model));
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
-- Production's read policies (pg_policies, 2026-10-15; the private one shortened to its owner branch).
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT TO public
  USING ((is_public = true) OR (auth.role() = 'service_role'::text));
CREATE POLICY vehicles_private_select ON public.vehicles FOR SELECT TO public
  USING ((is_public = false) AND ((SELECT auth.uid()) IS NOT NULL) AND ((SELECT auth.uid()) = user_id));
GRANT SELECT ON public.vehicles TO anon, authenticated, service_role;

INSERT INTO public.vehicles (id, year, make, model, vin, primary_image_url, sale_price, is_public, user_id)
SELECT ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 1950 + g % 70,
       (ARRAY['Ford', 'Chevrolet', 'Porsche'])[1 + g % 3], (ARRAY['Mustang', 'Corvette', '911', NULL])[1 + g % 4],
       'VIN' || g, NULL, 1000 + g, g % 5 <> 0, '20000000-0000-0000-0000-000000000001'
FROM generate_series(1, 600) g;

\ir helpers/search_vehicles_fuzzy_live_20261014.sql
\ir ../migrations/20261015010000_search_fuzzy_name_dictionary.sql
\ir ../migrations/20261015020000_search_fuzzy_runs_as_owner.sql
-- A second application changes nothing and passes its own guard.
\ir ../migrations/20261015020000_search_fuzzy_runs_as_owner.sql

SELECT pg_temp.ok('security definer with search_path public, pg_temp',
  (SELECT prosecdef AND proconfig = ARRAY['search_path=public, pg_temp']
   FROM pg_proc WHERE oid = 'public.search_vehicles_fuzzy(text,integer)'::regprocedure));

CREATE TABLE public.answer (who text, vehicle_id uuid, relevance real);
GRANT INSERT ON public.answer TO anon, authenticated, service_role;
SET ROLE anon;
SELECT set_config('test.auth_uid', '', false), set_config('test.auth_role', 'anon', false);
INSERT INTO public.answer SELECT 'anon', vehicle_id, relevance FROM public.search_vehicles_fuzzy('ford mustng', 1000);
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000001', false), set_config('test.auth_role', 'authenticated', false);
INSERT INTO public.answer SELECT 'owner', vehicle_id, relevance FROM public.search_vehicles_fuzzy('ford mustng', 1000);
RESET ROLE;
SET ROLE service_role;
SELECT set_config('test.auth_uid', '', false), set_config('test.auth_role', 'service_role', false);
INSERT INTO public.answer SELECT 'service', vehicle_id, relevance FROM public.search_vehicles_fuzzy('ford mustng', 1000);
RESET ROLE;

SELECT pg_temp.ok('anon gets rows',
  (SELECT count(*) FROM public.answer WHERE who = 'anon') > 50);
SELECT pg_temp.ok('anon, the owner of private rows and the service role get the same rows',
  NOT EXISTS (SELECT vehicle_id, relevance FROM public.answer WHERE who = 'anon'
              EXCEPT SELECT vehicle_id, relevance FROM public.answer WHERE who = 'owner')
  AND NOT EXISTS (SELECT vehicle_id, relevance FROM public.answer WHERE who = 'owner'
                  EXCEPT SELECT vehicle_id, relevance FROM public.answer WHERE who = 'anon')
  AND NOT EXISTS (SELECT vehicle_id, relevance FROM public.answer WHERE who = 'service'
                  EXCEPT SELECT vehicle_id, relevance FROM public.answer WHERE who = 'anon'));
SELECT pg_temp.ok('every row is a public vehicle; the matching private vehicles are never returned',
  NOT EXISTS (SELECT 1 FROM public.answer a JOIN public.vehicles v ON v.id = a.vehicle_id WHERE NOT v.is_public)
  AND (SELECT count(*) FROM public.vehicles WHERE NOT is_public AND make = 'Ford' AND model = 'Mustang') > 0);
