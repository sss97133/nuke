-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_map_state_region -f this-file.sql
-- Proves 20261021130000 on synthetic rows: a listing or vehicle observation that names a US state and has no county lands
-- in that state and still in "no county" and "no ZIP"; a county-keyed observation keeps its county's state; a non-US
-- region (country CA) or an unknown code stays "no state"; each entity lands once per level; the migration is idempotent.
-- PostGIS is not in the CI image: a county is a "minlon minlat maxlon maxlat" box. Every row is synthetic seed data.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS
$$ INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command) ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(p_jobid bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = p_jobid RETURNING true $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
SET TIME ZONE 'UTC';
CREATE FUNCTION fixture_assert(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %', label; END IF;
  RAISE NOTICE 'ok: %', label;
END $$;

CREATE DOMAIN public.geometry AS text;
CREATE FUNCTION public.st_makepoint(double precision, double precision) RETURNS public.geometry
  LANGUAGE sql IMMUTABLE AS $$ SELECT ($1::text || ' ' || $2::text)::public.geometry $$;
CREATE FUNCTION public.st_setsrid(public.geometry, integer) RETURNS public.geometry LANGUAGE sql IMMUTABLE AS $$ SELECT $1 $$;
CREATE FUNCTION public.st_covers(public.geometry, public.geometry) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT split_part($2, ' ', 1)::float8 BETWEEN split_part($1, ' ', 1)::float8 AND split_part($1, ' ', 3)::float8
     AND split_part($2, ' ', 2)::float8 BETWEEN split_part($1, ' ', 2)::float8 AND split_part($1, ' ', 4)::float8 $$;

CREATE TABLE public.us_states (fips text PRIMARY KEY, usps text NOT NULL UNIQUE, name text NOT NULL UNIQUE, kind text NOT NULL);
INSERT INTO public.us_states VALUES ('32', 'NV', 'Nevada', 'state'), ('06', 'CA', 'California', 'state'), ('48', 'TX', 'Texas', 'state');
CREATE TABLE public.us_county_boundaries (fips text PRIMARY KEY, name text, state_fips text, geom public.geometry);
INSERT INTO public.us_county_boundaries VALUES ('32003', 'Clark', '32', '-116 35 -114 37'), ('06037', 'Los Angeles', '06', '-119 33 -117 35');
CREATE TABLE public.zip_to_fips (zip text PRIMARY KEY, fips text);
CREATE TABLE public.us_zctas (zcta text PRIMARY KEY, county_fips text);
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean, deleted_at timestamptz, asking_price numeric);
CREATE TABLE public.vehicle_location_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source_type text NOT NULL, source_platform text, source_url text,
  observed_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), county_fips text, zcta text,
  region_code text, country_code text, latitude double precision, longitude double precision);
CREATE TABLE public.vehicle_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, event_status text,
  sold_at timestamptz, ended_at timestamptz GENERATED ALWAYS AS (sold_at) STORED, final_price numeric, source_url text, source_platform text);
CREATE TABLE public.organizations (id uuid PRIMARY KEY, is_public boolean, status text, latitude double precision,
  longitude double precision, zip_code text);
CREATE TABLE public.organization_locations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, is_primary boolean,
  latitude double precision, longitude double precision, zip_code text, geocode_confidence real);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, is_approved boolean,
  taken_at timestamptz, latitude double precision, longitude double precision, source text);
CREATE TABLE public.write_receipts (id bigserial PRIMARY KEY, tbl text, op text, rows integer, writer text, db_role text,
  app_name text, txid bigint, at timestamptz DEFAULT now());
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Six public vehicles listed yesterday on ebay_motors:
--   1 county-keyed in Clark NV; 2 state only NV; 3 state only TX with a NULL country;
--   4 region 'ON' with country CA; 5 region 'ZZ' (no such state); 6 county-keyed in Los Angeles but region_code 'NV'
--   (the county decides). A private vehicle 7 states NV and never counts.
INSERT INTO public.vehicles SELECT md5('sr' || g)::uuid, g <> 7, NULL, 1000 * g FROM generate_series(1, 7) g;
INSERT INTO public.vehicle_location_observations (vehicle_id, source_type, source_platform, observed_at, county_fips, region_code, country_code)
VALUES (md5('sr1')::uuid, 'listing', 'ebay_motors', now() - interval '1 day', '32003', 'NV', 'US'),
       (md5('sr2')::uuid, 'listing', 'ebay_motors', now() - interval '1 day', NULL, 'NV', 'US'),
       (md5('sr3')::uuid, 'listing', 'ebay_motors', now() - interval '1 day', NULL, 'TX', NULL),
       (md5('sr4')::uuid, 'listing', 'ebay_motors', now() - interval '1 day', NULL, 'ON', 'CA'),
       (md5('sr5')::uuid, 'listing', 'ebay_motors', now() - interval '1 day', NULL, 'ZZ', 'US'),
       (md5('sr6')::uuid, 'listing', 'ebay_motors', now() - interval '1 day', '06037', 'NV', 'US'),
       (md5('sr7')::uuid, 'listing', 'ebay_motors', now() - interval '1 day', NULL, 'NV', 'US');

\ir ../migrations/20261020193000_map_layers.sql
\ir ../migrations/20261020220000_map_facts.sql

-- Before: the fold takes state from the county only.
SELECT public.fold_map_facts_listing(current_date - 3, current_date, clock_timestamp());
SELECT fixture_assert((SELECT coalesce(sum(entities), 0) = 4 FROM public.map_facts WHERE layer = 'listing' AND level = 'state' AND area_key IS NULL),
  'before: four stated-state listings with no county are no state');

\ir ../migrations/20261021130000_map_facts_state_from_region.sql
\ir ../migrations/20261021130000_map_facts_state_from_region.sql

SELECT public.fold_map_facts_listing(current_date - 3, current_date, clock_timestamp());
SELECT fixture_assert((SELECT sum(entities) = 2 FROM public.map_facts WHERE layer = 'listing' AND level = 'state' AND area_key = '32'),
  'state NV: the Clark listing and the state-only NV listing (the LA-county listing keeps its county''s state)');
SELECT fixture_assert((SELECT sum(entities) = 1 FROM public.map_facts WHERE layer = 'listing' AND level = 'state' AND area_key = '06'),
  'state CA: the county decides over a disagreeing region_code');
SELECT fixture_assert((SELECT sum(entities) = 1 FROM public.map_facts WHERE layer = 'listing' AND level = 'state' AND area_key = '48'),
  'state TX from region_code with NULL country');
SELECT fixture_assert((SELECT sum(entities) = 2 FROM public.map_facts WHERE layer = 'listing' AND level = 'state' AND area_key IS NULL),
  'a Canadian province and an unknown code stay no state');
SELECT fixture_assert((SELECT sum(entities) = 4 FROM public.map_facts WHERE layer = 'listing' AND level = 'county' AND area_key IS NULL),
  'state-only listings are still no county');
SELECT fixture_assert((SELECT sum(entities) = 6 FROM public.map_facts WHERE layer = 'listing' AND level = 'zcta' AND area_key IS NULL),
  'and no ZIP');
SELECT fixture_assert((SELECT count(DISTINCT s) = 1 FROM (SELECT level, sum(entities) s FROM public.map_facts WHERE layer = 'listing' GROUP BY 1) x),
  'each listing lands once per level (6 public of 7)');

SELECT public.fold_map_facts_vehicle(current_date - 3, current_date, clock_timestamp());
SELECT fixture_assert((SELECT sum(entities) = 2 FROM public.map_facts WHERE layer = 'vehicle' AND level = 'state' AND area_key = '32')
  AND (SELECT sum(entities) = 1 FROM public.map_facts WHERE layer = 'vehicle' AND level = 'state' AND area_key = '48'),
  'the vehicle layer places a state-only latest observation in its state');
SELECT fixture_assert((SELECT geography LIKE '%region_code%' AND since_migration = '20261021130000' FROM public.map_layers WHERE layer = 'listing')
  AND (SELECT geography LIKE '%region_code%' FROM public.map_layers WHERE layer = 'vehicle'), 'map_layers says where state comes from');
SELECT fixture_assert(NOT has_function_privilege('anon', 'public.fold_map_facts_listing(date, date, timestamptz, interval)', 'execute'),
  'anon cannot run the fold');
SELECT public.refresh_map_facts(3);
SELECT fixture_assert((SELECT count(*) = 1 FROM public.write_receipts WHERE writer = 'refresh_map_facts'), 'the recent refresher still runs whole');
