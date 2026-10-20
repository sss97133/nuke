-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_map_facts -f this-file.sql
-- Proves map_facts (20261020220000) on synthetic rows: every layer folds by its map_layers rule; each entity lands once
-- per level, in an area or the NULL area, so sums agree across levels; private and deleted vehicles never count; the
-- listing fold reproduces vehicle_map_county_listings (20261020004000) over a 3-day window; the sale fold ignores
-- bid-goes-on rows and places a sale by its listing's observation; organization is a snapshot that replaces itself;
-- photo lands undated rows, has no ZIP level and is never a point; the recent and nightly refreshers leave receipts and
-- fail when a listing fold lands nothing; the assay reads; roles read and never write; the crons are scheduled; the
-- migration is idempotent. PostGIS is not in the CI image: a county is a "minlon minlat maxlon maxlat" box.
-- Every row below is synthetic seed data in a throwaway database, not testimony.
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
CREATE FUNCTION fixture_reject(stmt text, label text, want text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = want OR SQLERRM LIKE want THEN RAISE NOTICE 'ok: %', label; RETURN; END IF;
    RAISE EXCEPTION 'assertion failed: % (got % %)', label, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'assertion failed: % (statement succeeded)', label;
END $$;

-- Geometry stubs: a county is a box, a point is "lon lat".
CREATE DOMAIN public.geometry AS text;
CREATE FUNCTION public.st_makepoint(double precision, double precision) RETURNS public.geometry
  LANGUAGE sql IMMUTABLE AS $$ SELECT ($1::text || ' ' || $2::text)::public.geometry $$;
CREATE FUNCTION public.st_setsrid(public.geometry, integer) RETURNS public.geometry LANGUAGE sql IMMUTABLE AS $$ SELECT $1 $$;
CREATE FUNCTION public.st_covers(public.geometry, public.geometry) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT split_part($2, ' ', 1)::float8 BETWEEN split_part($1, ' ', 1)::float8 AND split_part($1, ' ', 3)::float8
     AND split_part($2, ' ', 2)::float8 BETWEEN split_part($1, ' ', 2)::float8 AND split_part($1, ' ', 4)::float8 $$;

-- The shapes the folds read.
CREATE TABLE public.us_county_boundaries (fips text PRIMARY KEY, name text, state_fips text, geom public.geometry);
INSERT INTO public.us_county_boundaries VALUES ('32003', 'Clark', '32', '-116 35 -114 37'), ('06037', 'Los Angeles', '06', '-119 33 -117 35');
CREATE TABLE public.zip_to_fips (zip text PRIMARY KEY, fips text);
INSERT INTO public.zip_to_fips VALUES ('89101', '32003'), ('90001', '06037');
CREATE TABLE public.us_zctas (zcta text PRIMARY KEY, county_fips text);
INSERT INTO public.us_zctas VALUES ('89101', '32003'), ('90001', '06037');
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean, deleted_at timestamptz, asking_price numeric);
CREATE TABLE public.vehicle_location_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source_type text NOT NULL, source_platform text, source_url text,
  observed_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), county_fips text, zcta text,
  latitude double precision, longitude double precision);
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

-- 600 vehicles: every tenth private, every fifteenth deleted, every seventh unpriced.
INSERT INTO public.vehicles SELECT md5('mf' || g)::uuid, g % 10 <> 0, CASE WHEN g % 15 = 0 THEN now() END,
  CASE WHEN g % 7 = 0 THEN NULL ELSE 1000 * g END FROM generate_series(1, 600) g;
-- Listings: vehicle v first seen (v % 12) days ago, again every 12 hours; every fifth also 20 days ago; counties by v,
-- a third with no county, a quarter with a ZCTA, platforms with NULL.
INSERT INTO public.vehicle_location_observations (vehicle_id, source_type, source_platform, source_url, observed_at, county_fips, zcta)
SELECT md5('mf' || v)::uuid, 'listing', (ARRAY['bat', 'craigslist', NULL, 'facebook_marketplace'])[1 + v % 4],
       'https://x/' || v, now() - (v % 12) * interval '1 day' - interval '6 hours' + r * interval '12 hours',
       CASE WHEN v % 3 = 0 THEN NULL WHEN v % 2 = 0 THEN '32003' ELSE '06037' END,
       CASE WHEN v % 4 = 1 THEN '89101' WHEN v % 4 = 2 THEN '90001' END
FROM generate_series(1, 600 * 10) g, LATERAL (SELECT 1 + g % 600 AS v, g / 600 AS r) x
WHERE now() - (v % 12) * interval '1 day' - interval '6 hours' + r * interval '12 hours' <= now();
INSERT INTO public.vehicle_location_observations (vehicle_id, source_type, source_platform, observed_at, county_fips)
SELECT md5('mf' || v)::uuid, 'listing', 'bat', now() - interval '20 days', '32003' FROM generate_series(1, 600) v WHERE v % 5 = 0;
-- A future-dated row: a bad clock, excluded.
INSERT INTO public.vehicle_location_observations (vehicle_id, source_type, source_platform, observed_at, county_fips)
VALUES (md5('mf1')::uuid, 'listing', 'bat', now() + interval '3000 days', '32003');
-- Sales: vehicles 1..100 sold 2 days ago (every other on bat, with the listing URL), 101..120 bid-goes-on (excluded),
-- vehicle 7 sold twice (once counts), vehicle 999 (unknown) sold.
INSERT INTO public.vehicle_events (vehicle_id, event_status, sold_at, final_price, source_url, source_platform)
SELECT md5('mf' || v)::uuid, 'sold', now() - interval '2 days', 500 * v, CASE WHEN v % 2 = 0 THEN 'https://x/' || v END,
       CASE WHEN v % 2 = 0 THEN 'bat' ELSE 'mecum' END FROM generate_series(1, 100) v;
INSERT INTO public.vehicle_events (vehicle_id, event_status, sold_at, final_price, source_platform)
SELECT md5('mf' || v)::uuid, 'bid-goes-on', now() - interval '2 days', 1, 'mecum' FROM generate_series(101, 120) v;
INSERT INTO public.vehicle_events (vehicle_id, event_status, sold_at, final_price, source_platform)
VALUES (md5('mf7')::uuid, 'sold', now() - interval '1 day', 9, 'mecum'), (md5('mf999')::uuid, 'sold', now() - interval '1 day', 9, 'mecum');
-- Organizations: 40 public active (half by point in Clark, a quarter by a primary location in LA, a quarter by ZIP,
-- one nowhere), 5 private, 5 inactive.
INSERT INTO public.organizations SELECT md5('org' || g)::uuid, g <= 40, CASE WHEN g <= 45 THEN 'active' ELSE 'inactive' END,
  CASE WHEN g % 4 IN (0, 1) THEN 36.1 END, CASE WHEN g % 4 IN (0, 1) THEN -115.1 END,
  CASE WHEN g % 4 = 3 AND g <> 39 THEN '90001' END FROM generate_series(1, 50) g;
INSERT INTO public.organization_locations (organization_id, is_primary, latitude, longitude, zip_code, geocode_confidence)
SELECT md5('org' || g)::uuid, true, 34.0, -118.2, NULL, 0.9 FROM generate_series(1, 50) g WHERE g % 4 = 2;
-- Photos: 320 with GPS on public vehicles (half in Clark, half in LA): the first 50 undated, the first 20 unapproved;
-- 20 on a private vehicle; 10 outside every county.
INSERT INTO public.vehicle_images (vehicle_id, is_approved, taken_at, latitude, longitude, source)
SELECT md5('mf' || (1 + g % 50))::uuid, g > 20, CASE WHEN g <= 50 THEN NULL ELSE now() - (g % 30) * interval '1 day' END,
       CASE WHEN g % 2 = 0 THEN 36.1 ELSE 34.0 END, CASE WHEN g % 2 = 0 THEN -115.1 ELSE -118.2 END,
       (ARRAY['iphoto', 'user_upload', NULL])[1 + g % 3]
FROM generate_series(1, 320) g;
INSERT INTO public.vehicle_images (vehicle_id, is_approved, taken_at, latitude, longitude, source)
SELECT md5('mf10')::uuid, true, now() - interval '1 day', 36.1, -115.1, 'iphoto' FROM generate_series(1, 20) g; -- vehicle 10 is private
INSERT INTO public.vehicle_images (vehicle_id, is_approved, taken_at, latitude, longitude, source)
SELECT md5('mf1')::uuid, true, now() - interval '1 day', 48.0, -100.0, 'iphoto' FROM generate_series(1, 10) g;

\ir ../migrations/20261020004000_vehicle_map_county_listings.sql
\ir ../migrations/20261020193000_map_layers.sql
\ir ../migrations/20261020220000_map_facts.sql
\ir ../migrations/20261020220000_map_facts.sql

-- Shape and access.
SELECT fixture_assert(obj_description('public.map_facts'::regclass, 'pg_class') IS NOT NULL
  AND (SELECT count(*) = 0 FROM pg_attribute a WHERE a.attrelid = 'public.map_facts'::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND col_description(a.attrelid, a.attnum) IS NULL), 'table and every column described');
SELECT fixture_assert((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.map_facts'::regclass)
  AND has_table_privilege('anon', 'public.map_facts', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.map_facts', 'INSERT,UPDATE,DELETE,TRUNCATE')
  AND NOT has_table_privilege('authenticated', 'public.map_facts', 'INSERT,UPDATE,DELETE,TRUNCATE')
  AND NOT has_table_privilege('service_role', 'public.map_facts', 'INSERT,UPDATE,DELETE,TRUNCATE'), 'every role reads, none writes through the API');
SELECT fixture_assert(NOT has_function_privilege('anon', 'refresh_map_facts(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'rebuild_map_facts(interval)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'fold_map_facts_listing(date, date, timestamptz, interval)', 'EXECUTE')
  AND has_function_privilege('service_role', 'refresh_map_facts(integer)', 'EXECUTE'), 'folds are service_role only');
SELECT fixture_assert((SELECT count(*) = 2 FROM cron.job WHERE jobname IN ('map-facts-recent', 'map-facts-nightly')), 'two crons scheduled');
SELECT fixture_assert((SELECT bool_and(fold = 'map_facts') FROM public.map_layers), 'every layer names map_facts as its fold');
SELECT fixture_assert((SELECT (assay_map_facts()->>'status') = 'empty'), 'assay: empty before the first fold');

-- The nightly fold.
SELECT refresh_vehicle_map_county_listings();
SET ROLE service_role;
CREATE TEMP TABLE nightly AS SELECT rebuild_map_facts() AS r;
RESET ROLE;
SELECT fixture_assert((SELECT (r->>'rows_landed')::int > 0 AND r->>'writer' = 'rebuild_map_facts' AND jsonb_array_length(r->'layers') = 5 FROM nightly), 'nightly receipt names five layers');
SELECT fixture_assert((SELECT count(*) = 1 FROM public.write_receipts WHERE writer = 'rebuild_map_facts' AND tbl = 'map_facts'), 'nightly write receipt');
SELECT fixture_assert((SELECT count(DISTINCT layer) = 5 FROM public.map_facts), 'all five layers landed');
SELECT fixture_assert((SELECT (assay_map_facts()->>'status') = 'ok'), 'assay: ok after the fold');

-- Level invariant: for every (layer, source, day) the entities at each computed level agree.
SELECT fixture_assert((SELECT count(*) = 0 FROM (
  SELECT layer, source_platform, day FROM (SELECT layer, source_platform, day, level, sum(entities) s FROM public.map_facts GROUP BY 1, 2, 3, 4) x
  GROUP BY 1, 2, 3 HAVING count(DISTINCT s) > 1) bad), 'levels agree for every layer, source and day');

-- Listing: reproduces vehicle_map_county_listings over three complete days, county by county.
CREATE TEMP TABLE win AS SELECT current_date - 3 AS d0, current_date - 1 AS d1;
SELECT fixture_assert((SELECT count(*) = 0 FROM (
  SELECT fips, source_platform, day, sum(listings) l, sum(priced) p, sum(asking_sum) s FROM public.vehicle_map_county_listings, win WHERE day BETWEEN d0 AND d1 GROUP BY 1, 2, 3
  EXCEPT
  SELECT area_key, source_platform, day, sum(entities), sum(priced), sum(value_sum) FROM public.map_facts, win
  WHERE layer = 'listing' AND level = 'county' AND area_key IS NOT NULL AND day BETWEEN d0 AND d1 GROUP BY 1, 2, 3) diff),
  'listing county rows equal the #2215 fold for the window');
SELECT fixture_assert((SELECT sum(listings) FROM public.vehicle_map_county_listings, win WHERE day BETWEEN d0 AND d1)
  = (SELECT sum(entities) FROM public.map_facts, win WHERE layer = 'listing' AND level = 'county' AND area_key IS NOT NULL AND day BETWEEN d0 AND d1),
  'listing keyed total equals the #2215 fold');
SELECT fixture_assert((SELECT sum(entities) > 0 FROM public.map_facts WHERE layer = 'listing' AND level = 'county' AND area_key IS NULL), 'vehicles with no county are kept as no-county rows');
SELECT fixture_assert((SELECT sum(entities) FROM public.map_facts WHERE layer = 'listing' AND level = 'zcta' AND area_key IS NOT NULL)
  < (SELECT sum(entities) FROM public.map_facts WHERE layer = 'listing' AND level = 'zcta'), 'listing ZIP level has keyed and no-ZIP rows');
SELECT fixture_assert((SELECT count(*) = 0 FROM public.map_facts WHERE day > current_date), 'a future clock never lands');
SELECT fixture_assert((SELECT sum(entities) FROM public.map_facts WHERE layer = 'listing' AND level = 'state')
  = (SELECT count(*) FROM public.vehicles v WHERE v.is_public AND v.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM public.vehicle_location_observations o WHERE o.vehicle_id = v.id AND o.source_type = 'listing' AND o.observed_at <= now())),
  'listing counts every public listed vehicle exactly once');

-- Vehicle: every public vehicle with an observation, once, on its latest day.
SELECT fixture_assert((SELECT sum(entities) FROM public.map_facts WHERE layer = 'vehicle' AND level = 'state')
  = (SELECT count(*) FROM public.vehicles v WHERE v.is_public AND v.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM public.vehicle_location_observations o WHERE o.vehicle_id = v.id AND o.observed_at <= now())),
  'vehicle counts every public located vehicle once');
SELECT fixture_assert((SELECT max(day) FROM public.map_facts WHERE layer = 'vehicle')
  = (SELECT max((o.observed_at AT TIME ZONE 'UTC')::date) FROM public.vehicle_location_observations o JOIN public.vehicles v ON v.id = o.vehicle_id AND v.is_public AND v.deleted_at IS NULL WHERE o.observed_at <= now()),
  'vehicle lands on the latest observation day');

-- Sale: sold rows only, one per vehicle, placed by the listing, priced.
SELECT fixture_assert((SELECT sum(entities) FROM public.map_facts WHERE layer = 'sale' AND level = 'county')
  = (SELECT count(*) FROM public.vehicles v WHERE v.is_public AND v.deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.vehicle_events e WHERE e.vehicle_id = v.id AND e.event_status = 'sold')),
  'sale counts each publicly sold vehicle once; bid-goes-on and unknown vehicles excluded');
SELECT fixture_assert((SELECT sum(priced) = sum(entities) AND sum(value_sum) > 0 FROM public.map_facts WHERE layer = 'sale' AND level = 'state'), 'every sale carries its price');
SELECT fixture_assert((SELECT sum(entities) FROM public.map_facts WHERE layer = 'sale' AND level = 'county' AND area_key IS NOT NULL)
  = (SELECT count(*) FROM public.vehicles v WHERE v.is_public AND v.deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.vehicle_events e WHERE e.vehicle_id = v.id AND e.event_status = 'sold')
     AND EXISTS (SELECT 1 FROM public.vehicle_location_observations o WHERE o.vehicle_id = v.id AND o.county_fips IS NOT NULL)),
  'a sale is placed when any observation of the vehicle has a county');
SELECT fixture_assert((SELECT sum(entities) = 1 AND sum(value_sum) = 9 FROM public.map_facts WHERE layer = 'sale' AND level = 'state' AND day = current_date - 1),
  'a vehicle sold twice counts once, on its latest sale, at that price');

-- Organization: a snapshot of today, placed by point, primary location or ZIP; one nowhere.
SELECT fixture_assert((SELECT sum(entities) = 40 AND min(day) = current_date AND max(day) = current_date FROM public.map_facts WHERE layer = 'organization' AND level = 'state'),
  'organization snapshot holds the 40 public active organizations on today');
SELECT fixture_assert((SELECT sum(entities) = 39 FROM public.map_facts WHERE layer = 'organization' AND level = 'county' AND area_key IS NOT NULL)
  AND (SELECT sum(entities) = 1 FROM public.map_facts WHERE layer = 'organization' AND level = 'county' AND area_key IS NULL),
  'organizations place by point, primary location or ZIP; the one with none is no-county');
UPDATE public.map_facts SET day = current_date - 1 WHERE layer = 'organization';
SELECT fold_map_facts_organization();  -- internal fold, run as the owner
SELECT fixture_assert((SELECT count(*) FILTER (WHERE day <> current_date) = 0 FROM public.map_facts WHERE layer = 'organization'), 'a new snapshot replaces the old');

-- Photo: approved GPS images of public vehicles, county and state only, undated rows kept, never zcta.
SELECT fixture_assert((SELECT count(*) = 0 FROM public.map_facts WHERE layer = 'photo' AND level = 'zcta'), 'photo has no ZIP level');
SELECT fixture_assert((SELECT sum(entities) FROM public.map_facts WHERE layer = 'photo' AND level = 'county')
  = (SELECT count(*) FROM public.vehicle_images i JOIN public.vehicles v ON v.id = i.vehicle_id AND v.is_public AND v.deleted_at IS NULL WHERE i.is_approved AND i.latitude IS NOT NULL),
  'photo counts every approved located image of a public vehicle once');
SELECT fixture_assert((SELECT sum(entities) FROM public.map_facts WHERE layer = 'photo' AND level = 'county' AND day IS NULL)
  = (SELECT count(*) FROM public.vehicle_images i JOIN public.vehicles v ON v.id = i.vehicle_id AND v.is_public AND v.deleted_at IS NULL WHERE i.is_approved AND i.latitude IS NOT NULL AND i.taken_at IS NULL),
  'undated photos land with a NULL day');
SELECT fixture_assert((SELECT sum(entities) = 10 FROM public.map_facts WHERE layer = 'photo' AND level = 'county' AND area_key IS NULL), 'photos outside every county are no-county');
SELECT fixture_assert((SELECT NOT points_allowed FROM public.map_layers WHERE layer = 'photo'), 'photos are still never points');

-- The recent fold rewrites only its days and leaves the rest.
CREATE TEMP TABLE before_recent AS SELECT layer, level, area_key, source_platform, day, entities, priced, value_sum FROM public.map_facts;
SET ROLE service_role;
CREATE TEMP TABLE recent AS SELECT refresh_map_facts(3) AS r;
RESET ROLE;
SELECT fixture_assert((SELECT jsonb_array_length(r->'layers') = 3 AND r->>'writer' = 'refresh_map_facts' FROM recent), 'recent receipt names listing, vehicle, sale');
SELECT fixture_assert((SELECT count(*) = 0 FROM (
  SELECT layer, level, area_key, source_platform, day, entities, priced, value_sum FROM public.map_facts
  EXCEPT SELECT * FROM before_recent) d), 'recent fold changes no number: the same rules give the same rows');
SELECT fixture_assert((SELECT count(*) = 0 FROM (SELECT * FROM before_recent EXCEPT
  SELECT layer, level, area_key, source_platform, day, entities, priced, value_sum FROM public.map_facts) d), 'recent fold drops no row');
SELECT fixture_assert((SELECT max(as_of) FROM public.map_facts WHERE layer = 'listing' AND day >= current_date - 3)
  > (SELECT max(as_of) FROM public.map_facts WHERE layer = 'photo'), 'recent rows carry the new as_of');
SELECT fixture_reject($q$SELECT refresh_map_facts(0)$q$, 'p_days below 1 refused', '22023');

-- Rows landed is the test of success: with every vehicle made private the listing fold lands nothing and fails.
UPDATE public.vehicles SET is_public = false;
SET ROLE service_role;
SELECT fixture_reject($q$SELECT refresh_map_facts(3)$q$, 'a fold that lands nothing while rows exist fails its run', '%landed no entities%');
RESET ROLE;
SELECT fixture_assert((SELECT count(*) > 0 FROM public.map_facts WHERE layer = 'listing'), 'a failed fold leaves the previous rows (the transaction rolled back)');

-- The one-area read the reader will make: one county, one layer, a day range.
SELECT fixture_assert((SELECT count(*) > 0 FROM public.map_facts WHERE layer = 'listing' AND level = 'county' AND area_key = '32003' AND day BETWEEN current_date - 7 AND current_date), 'one-area read answers');

-- Retirement (20261021050000): the #2215 fold and its cron go; map_facts and its crons stay whole.
\ir ../migrations/20261021050000_retire_vehicle_map_county_listings.sql
\ir ../migrations/20261021050000_retire_vehicle_map_county_listings.sql
SELECT fixture_assert(to_regclass('public.vehicle_map_county_listings') IS NULL, 'the county listing fold is gone');
SELECT fixture_assert((SELECT count(*) = 0 FROM cron.job WHERE jobname = 'vehicle-map-county-listings'), 'its cron is gone');
SELECT fixture_assert((SELECT count(*) = 2 FROM cron.job WHERE jobname LIKE 'map-facts%'), 'the map_facts crons remain');
SELECT fixture_assert((SELECT count(*) > 0 FROM public.map_facts WHERE layer = 'listing'), 'map_facts listing rows remain');
