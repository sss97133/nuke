-- Isolated PostgreSQL 17 contract for 20261008010000_vin_decoded_data_registry_and_policy.sql. Synthetic rows only.
--   createdb dm_refinement_vin_policy_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_vin_policy_ci -f supabase/sql/test_vin_decoded_data_policy.sql
-- Fixtures: vin_decoded_data with RLS and the two live policies as prod carried them (both for PUBLIC), the API roles with
-- Supabase's default grants, pipeline_registry. Covered: the write policy ends up service_role only, the read policy stays
-- public, anon can read but not insert or delete under RLS, service_role still writes, the registry row exists once, a
-- re-apply changes nothing.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vin_decoded_data') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
CREATE FUNCTION pg_temp.fails(label text, stmt text, want_state text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text;
BEGIN
  BEGIN EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    got := SQLSTATE;
    IF got <> want_state THEN RAISE EXCEPTION 'Contract failed: % raised % (%), wanted %', label, got, SQLERRM, want_state; END IF;
    RAISE NOTICE 'PASS % (refused %)', label, got; RETURN;
  END;
  RAISE EXCEPTION 'Contract failed: % was admitted', label;
END $$;

CREATE TABLE public.vin_decoded_data (vin text PRIMARY KEY, make text, model text, year integer, body_type text, vehicle_type text, provider text, confidence integer, decoded_at timestamptz DEFAULT now());
ALTER TABLE public.vin_decoded_data ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON public.vin_decoded_data TO anon, authenticated, service_role;
CREATE POLICY "Anyone can view decoded VINs" ON public.vin_decoded_data FOR SELECT USING (true);
CREATE POLICY "Service role manages decoded VINs" ON public.vin_decoded_data FOR ALL USING (true) WITH CHECK (true);
INSERT INTO public.vin_decoded_data (vin, make, model, year) VALUES ('1HGCM82633A004352', 'HONDA', 'Accord', 2003);
CREATE TABLE public.pipeline_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, column_name text,
  owned_by text NOT NULL, description text NOT NULL, valid_values text[],
  do_not_write_directly boolean NOT NULL DEFAULT false, write_via text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_name, column_name));

-- Before: anon can write under the all-roles policy.
SET ROLE anon;
INSERT INTO public.vin_decoded_data (vin, make) VALUES ('WP0AA2A99KS000001', 'PORSCHE');
RESET ROLE;
SELECT pg_temp.ok('fixture reproduces the exposure: anon inserted a decode before the migration',
  (SELECT count(*) FROM public.vin_decoded_data) = 2);

\ir ../migrations/20261008010000_vin_decoded_data_registry_and_policy.sql

SELECT pg_temp.ok('the write policy applies to service_role only; the read policy stays public',
  (SELECT roles = ARRAY['service_role']::name[] FROM pg_policies WHERE tablename = 'vin_decoded_data' AND policyname = 'Service role manages decoded VINs')
  AND (SELECT roles = ARRAY['public']::name[] AND cmd = 'SELECT' FROM pg_policies WHERE tablename = 'vin_decoded_data' AND policyname = 'Anyone can view decoded VINs'));
SET ROLE anon;
SELECT pg_temp.ok('anon still reads every decode', (SELECT count(*) FROM public.vin_decoded_data) = 2);
SELECT pg_temp.fails('anon can no longer insert a decode', $q$INSERT INTO public.vin_decoded_data (vin, make) VALUES ('WP0AA2A99KS000002', 'PORSCHE')$q$, '42501');
RESET ROLE;
SET ROLE authenticated;
DELETE FROM public.vin_decoded_data;
RESET ROLE;
SELECT pg_temp.ok('authenticated DELETE under RLS removed nothing', (SELECT count(*) FROM public.vin_decoded_data) = 2);
SET ROLE service_role;
INSERT INTO public.vin_decoded_data (vin, make) VALUES ('WP0AA2A99KS000003', 'PORSCHE');
RESET ROLE;
SELECT pg_temp.ok('service_role still writes (the loaders'' path)', (SELECT count(*) FROM public.vin_decoded_data) = 3);
SELECT pg_temp.ok('the registry row names the loader and forbids direct writes',
  (SELECT owned_by = 'scripts/mass-vin-decode.ts' AND do_not_write_directly FROM public.pipeline_registry WHERE table_name = 'vin_decoded_data' AND column_name IS NULL));
\ir ../migrations/20261008010000_vin_decoded_data_registry_and_policy.sql
SELECT pg_temp.ok('re-apply changes nothing: one registry row, the same two policies',
  (SELECT count(*) FROM public.pipeline_registry WHERE table_name = 'vin_decoded_data') = 1
  AND (SELECT count(*) FROM pg_policies WHERE tablename = 'vin_decoded_data') = 2);
\echo 'vin_decoded_data policy contract: all checks passed'
