-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_map_photo_location -f this-file.sql
-- Proves 20261116005000 on synthetic rows: an admitted photo-GPS row (source_type exif, confidence >= 0.50) places a
-- vehicle like any latest observation; a withdrawn one (confidence 0) neither places the vehicle nor hides its earlier
-- place; a sale is placed by its listing before any photo row, and never by a withdrawn row; the migration is
-- idempotent. Then 20261116010000: no photo row places a sale at all. The fixture is the one test_map_facts_state_from_region.sql builds, with a confidence column.
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
  region_code text, country_code text, latitude double precision, longitude double precision, confidence real);
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

\ir ../migrations/20261020193000_map_layers.sql
\ir ../migrations/20261020220000_map_facts.sql
\ir ../migrations/20261021130000_map_facts_state_from_region.sql
\ir ../migrations/20261021143000_map_facts_county_code_guard.sql

-- Public vehicles a, b, c, d, each listed 10 days ago on mecum in Los Angeles (06037).
--   a: an admitted photo row yesterday in Clark (32003). b: a withdrawn photo row yesterday in Clark.
--   c: sold yesterday on bat (no URL); an admitted photo row in Clark is newer than its listing.
--   d: sold yesterday on bat; a withdrawn photo row in Clark is newer than its listing.
INSERT INTO public.vehicles SELECT md5('pl' || g)::uuid, true, NULL, 1000 FROM unnest(ARRAY['a','b','c','d']) g;
INSERT INTO public.vehicle_location_observations (vehicle_id, source_type, source_platform, observed_at, county_fips, region_code, country_code, confidence)
SELECT md5('pl' || g)::uuid, 'listing', 'mecum', now() - interval '10 days', '06037', 'CA', 'US', 0.8 FROM unnest(ARRAY['a','b','c','d']) g;
INSERT INTO public.vehicle_location_observations (vehicle_id, source_type, source_platform, observed_at, county_fips, region_code, country_code, confidence)
VALUES (md5('pla')::uuid, 'exif', 'photo_exif', now() - interval '1 day', '32003', 'NV', 'US', 0.7),
       (md5('plb')::uuid, 'exif', 'photo_exif', now() - interval '1 day', '32003', 'NV', 'US', 0),
       (md5('plc')::uuid, 'exif', 'photo_exif', now() - interval '1 day', '32003', 'NV', 'US', 0.7),
       (md5('pld')::uuid, 'exif', 'photo_exif', now() - interval '1 day', '32003', 'NV', 'US', 0);
INSERT INTO public.vehicle_events (vehicle_id, event_status, sold_at, final_price, source_platform)
VALUES (md5('plc')::uuid, 'sold', now() - interval '1 day', 5000, 'bat'), (md5('pld')::uuid, 'sold', now() - interval '1 day', 7000, 'bat');

-- Before: withdrawn rows place b and d in Clark, and newer photo rows place both sales in Clark.
SELECT public.fold_map_facts_vehicle(current_date - 12, current_date, clock_timestamp());
SELECT fixture_assert((SELECT sum(entities) = 4 FROM public.map_facts WHERE layer = 'vehicle' AND level = 'county' AND area_key = '32003'),
  'before: all four vehicles placed in Clark, two by withdrawn rows');
SELECT public.fold_map_facts_sale(current_date - 3, current_date, clock_timestamp());
SELECT fixture_assert((SELECT sum(entities) = 2 FROM public.map_facts WHERE layer = 'sale' AND level = 'county' AND area_key = '32003'),
  'before: both sales placed in Clark by photo rows');

\ir ../migrations/20261116005000_map_facts_location_confidence_floor.sql
\ir ../migrations/20261116005000_map_facts_location_confidence_floor.sql

SELECT public.fold_map_facts_vehicle(current_date - 12, current_date, clock_timestamp());
SELECT fixture_assert((SELECT sum(entities) = 2 FROM public.map_facts WHERE layer = 'vehicle' AND level = 'county' AND area_key = '32003')
  AND (SELECT sum(entities) = 2 FROM public.map_facts WHERE layer = 'vehicle' AND level = 'county' AND area_key = '06037'),
  'after: admitted photo rows (a, c) place their vehicles; withdrawn ones (b, d) leave them at their listing');
SELECT fixture_assert((SELECT sum(entities) = 2 FROM public.map_facts WHERE layer = 'vehicle' AND level = 'county'
  AND area_key = '32003' AND source_platform = 'photo_exif'), 'the photo facet names photo_exif');
SELECT public.fold_map_facts_sale(current_date - 3, current_date, clock_timestamp());
SELECT fixture_assert((SELECT sum(entities) = 2 FROM public.map_facts WHERE layer = 'sale' AND level = 'county' AND area_key = '06037')
  AND (SELECT coalesce(sum(entities), 0) = 0 FROM public.map_facts WHERE layer = 'sale' AND level = 'county' AND area_key = '32003'),
  'after: both sales placed by their listing, not by a photo row');
SELECT fixture_assert(NOT has_function_privilege('anon', 'public.fold_map_facts_vehicle(date, date, timestamptz)', 'execute')
  AND NOT has_function_privilege('anon', 'public.fold_map_facts_sale(date, date, timestamptz)', 'execute'), 'anon cannot run the folds');
SELECT public.rebuild_map_facts();
SELECT fixture_assert((SELECT count(*) = 1 FROM public.write_receipts WHERE writer = 'rebuild_map_facts'), 'the nightly rebuild runs whole');

-- 20261116010000: e is sold yesterday on bat and has only an admitted photo row in Clark, no listing place.
-- Under 005000 the photo row places the sale in Clark under platform bat; after 010000 no photo row places a sale.
INSERT INTO public.vehicles VALUES (md5('ple')::uuid, true, NULL, 1000);
INSERT INTO public.vehicle_location_observations (vehicle_id, source_type, source_platform, observed_at, county_fips, region_code, country_code, confidence)
VALUES (md5('ple')::uuid, 'exif', 'photo_exif', now() - interval '2 days', '32003', 'NV', 'US', 0.7);
INSERT INTO public.vehicle_events (vehicle_id, event_status, sold_at, final_price, source_platform)
VALUES (md5('ple')::uuid, 'sold', now() - interval '1 day', 9000, 'bat');
SELECT public.fold_map_facts_sale(current_date - 3, current_date, clock_timestamp());
SELECT fixture_assert((SELECT sum(entities) = 1 FROM public.map_facts WHERE layer = 'sale' AND level = 'county'
  AND area_key = '32003' AND source_platform = 'bat'), 'before 010000: a photo row places a bat sale in Clark');
\ir ../migrations/20261116010000_map_facts_sale_without_photo_gps.sql
\ir ../migrations/20261116010000_map_facts_sale_without_photo_gps.sql
SELECT public.fold_map_facts_sale(current_date - 3, current_date, clock_timestamp());
SELECT fixture_assert((SELECT coalesce(sum(entities), 0) = 0 FROM public.map_facts WHERE layer = 'sale' AND level = 'county' AND area_key = '32003')
  AND (SELECT sum(entities) = 2 FROM public.map_facts WHERE layer = 'sale' AND level = 'county' AND area_key = '06037'),
  'after 010000: no sale is placed by a photo row; listed sales keep their listing place');
SELECT public.fold_map_facts_vehicle(current_date - 12, current_date, clock_timestamp());
SELECT fixture_assert((SELECT sum(entities) = 3 FROM public.map_facts WHERE layer = 'vehicle' AND level = 'county'
  AND area_key = '32003' AND source_platform = 'photo_exif'), 'the vehicle layer still places e under the photo_exif facet');
SELECT fixture_assert(NOT has_function_privilege('anon', 'public.fold_map_facts_sale(date, date, timestamptz)', 'execute'),
  'anon cannot run the sale fold');
