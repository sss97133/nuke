-- Isolated PostgreSQL 17 contract for 20261008016000_vlo_sightings_anon_read_and_coder_note.sql. Synthetic rows only.
--   createdb dm_refinement_vlo_sightings_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_vlo_sightings_ci -f supabase/sql/test_vlo_sightings_anon_read.sql
-- Fixtures: the table with the live read policy, the API roles, and an auth.role() stand-in that answers current_user.
-- Covered: before, anon reads a sighting; after, anon reads listings but no sighting, authenticated reads both, service_role
-- reads all, low-confidence rows stay hidden, the county_fips comment names the correction, re-apply a no-op.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicle_location_observations') IS NOT NULL THEN
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
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_user::text $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
CREATE TABLE public.vehicle_location_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source_type text, source_platform text, observed_at timestamptz,
  latitude double precision, longitude double precision, precision text, confidence real, metadata jsonb, created_at timestamptz DEFAULT now(),
  county_fips text, county_name text, postal_code text, region_code text);
COMMENT ON COLUMN public.vehicle_location_observations.county_fips IS 'County the observation falls in (fixture copy of the 20261007213000 text crediting scripts/geocode-backfill.mjs).';
ALTER TABLE public.vehicle_location_observations ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.vehicle_location_observations TO anon, authenticated, service_role;
CREATE POLICY "Public read high confidence observations" ON public.vehicle_location_observations FOR SELECT TO anon, authenticated USING (confidence >= 0.50);
CREATE POLICY "Service role full access" ON public.vehicle_location_observations FOR ALL TO service_role USING (true);
INSERT INTO public.vehicle_location_observations (source_type, precision, latitude, longitude, confidence) VALUES
  ('listing', 'city', 36.17, -115.14, 0.9), ('sighting', 'gps', 36.1699, -115.1398, 0.95), ('listing', 'city', 34.05, -118.24, 0.3);
SET ROLE anon;
SELECT pg_temp.ok('fixture reproduces the exposure: anon reads the photo sighting before the migration',
  (SELECT count(*) FROM public.vehicle_location_observations WHERE source_type = 'sighting') = 1);
RESET ROLE;

\ir ../migrations/20261008016000_vlo_sightings_anon_read_and_coder_note.sql

SET ROLE anon;
SELECT pg_temp.ok('anon reads the high-confidence listing row and no sighting; the low-confidence row stays hidden',
  (SELECT count(*) FROM public.vehicle_location_observations) = 1
  AND (SELECT count(*) FROM public.vehicle_location_observations WHERE source_type = 'sighting') = 0);
RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.ok('a signed-in reader still reads the sighting (and the listing)',
  (SELECT count(*) FROM public.vehicle_location_observations) = 2);
RESET ROLE;
SET ROLE service_role;
SELECT pg_temp.ok('service_role reads every row', (SELECT count(*) FROM public.vehicle_location_observations) = 3);
RESET ROLE;
SELECT pg_temp.ok('the county_fips comment names the correction and no longer credits the script as the coder',
  col_description('public.vehicle_location_observations'::regclass, (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.vehicle_location_observations'::regclass AND attname = 'county_fips'))
    LIKE '%the coder is not recorded%');
\ir ../migrations/20261008016000_vlo_sightings_anon_read_and_coder_note.sql
SELECT pg_temp.ok('re-apply changes nothing', (SELECT count(*) FROM pg_policies WHERE tablename = 'vehicle_location_observations') = 2);
\echo 'vehicle_location_observations sightings read contract: all checks passed'
