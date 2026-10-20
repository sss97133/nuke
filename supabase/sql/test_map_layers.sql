-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_map_layers -f this-file.sql
-- Proves map_layers (20261020193000): five layers, every column described, readable by every role and writable by
-- none through the API; photo never drawn as points; each layer's source table and value column exist; and the
-- listing rule, written out as a query from the row's text, reproduces vehicle_map_county_listings (20261020004000)
-- day for day over a 3-day window: vehicles, priced, asking sum and counties. Seeds are synthetic.
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

-- The tables the five layers read, with the columns the rows name.
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean, deleted_at timestamptz, asking_price numeric);
CREATE TABLE public.vehicle_location_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source_type text NOT NULL, source_platform text,
  source_url text, observed_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  latitude double precision, longitude double precision, county_fips text, county_name text, postal_code text
);
CREATE TABLE public.vehicle_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, event_status text,
  sold_at timestamptz, final_price numeric, source_url text, source_platform text);
CREATE TABLE public.organizations (id uuid PRIMARY KEY, is_public boolean, status text, latitude double precision,
  longitude double precision, zip_code text);
CREATE TABLE public.organization_locations (id uuid PRIMARY KEY, organization_id uuid, is_primary boolean,
  latitude double precision, longitude double precision, geocode_confidence real);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY, vehicle_id uuid, is_approved boolean, taken_at timestamptz,
  latitude double precision, longitude double precision);

-- 2,000 vehicles: every tenth private, every fifteenth deleted, every seventh unpriced.
INSERT INTO public.vehicles SELECT md5('ml' || g)::uuid, g % 10 <> 0, CASE WHEN g % 15 = 0 THEN now() END,
  CASE WHEN g % 7 = 0 THEN NULL ELSE 1000 * g END FROM generate_series(1, 2000) g;
-- Listing observations: vehicle v is first seen (v % 10) days ago and again every 12 hours after, up to now; every
-- fifth vehicle was also listed 20 days ago (inside the fold's 30 days, before the window: not new in the window) and
-- every fourth 35 days ago (outside the fold's 30 days: ignored). 60 counties, some rows with no county or a bad one,
-- NULL platforms, sightings, a few orphan rows with no vehicle.
INSERT INTO public.vehicle_location_observations (vehicle_id, source_type, source_platform, observed_at, county_fips)
SELECT CASE WHEN g % 97 = 0 THEN NULL ELSE md5('ml' || v)::uuid END,
       CASE WHEN g % 13 = 0 THEN 'sighting' ELSE 'listing' END,
       (ARRAY['bat', 'craigslist', NULL, 'facebook_marketplace', 'bat'])[1 + g % 5],
       now() - (v % 10) * interval '1 day' - interval '6 hours' + r * interval '12 hours',
       CASE WHEN g % 9 = 0 THEN NULL WHEN g % 23 = 0 THEN 'XX' ELSE lpad((6000 + (g % 60) * 2 + 1)::text, 5, '0') END
FROM generate_series(1, 2000 * 20) g, LATERAL (SELECT 1 + g % 2000 AS v, g / 2000 AS r) x
WHERE now() - (v % 10) * interval '1 day' - interval '6 hours' + r * interval '12 hours' <= now();
INSERT INTO public.vehicle_location_observations (vehicle_id, source_type, source_platform, observed_at, county_fips)
SELECT md5('ml' || v)::uuid, 'listing', 'bat', now() - interval '20 days', lpad((6000 + (v % 60) * 2 + 1)::text, 5, '0')
FROM generate_series(1, 2000) v WHERE v % 5 = 0;
INSERT INTO public.vehicle_location_observations (vehicle_id, source_type, source_platform, observed_at, county_fips)
SELECT md5('ml' || v)::uuid, 'listing', 'craigslist', now() - interval '35 days', lpad((6000 + (v % 60) * 2 + 1)::text, 5, '0')
FROM generate_series(1, 2000) v WHERE v % 4 = 0;

\ir ../migrations/20261020004000_vehicle_map_county_listings.sql
SELECT public.refresh_vehicle_map_county_listings();
\ir ../migrations/20261020193000_map_layers.sql
\ir ../migrations/20261020193000_map_layers.sql

-- Shape.
SELECT fixture_assert((SELECT count(*) = 5 FROM public.map_layers), 'five layers');
SELECT fixture_assert((SELECT array_agg(layer ORDER BY sort_order) = ARRAY['listing', 'sale', 'vehicle', 'organization', 'photo'] FROM public.map_layers),
  'layers in picker order: listing, sale, vehicle, organization, photo');
SELECT fixture_assert(obj_description('public.map_layers'::regclass, 'pg_class') IS NOT NULL, 'table described');
SELECT fixture_assert((SELECT count(*) = 0 FROM pg_attribute a WHERE a.attrelid = 'public.map_layers'::regclass AND a.attnum > 0
  AND NOT a.attisdropped AND col_description(a.attrelid, a.attnum) IS NULL), 'every column described');
SELECT fixture_assert((SELECT bool_and(to_regclass('public.' || source_table) IS NOT NULL) FROM public.map_layers), 'every source table exists');
SELECT fixture_assert((SELECT bool_and(EXISTS (SELECT 1 FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = split_part(value_column, '.', 1) AND c.column_name = split_part(value_column, '.', 2)))
  FROM public.map_layers WHERE value_column IS NOT NULL), 'every value column exists');
SELECT fixture_assert((SELECT NOT points_allowed FROM public.map_layers WHERE layer = 'photo'), 'photos are never points');
SELECT fixture_assert((SELECT bool_and(points_allowed) FROM public.map_layers WHERE layer <> 'photo'), 'every other layer may be a point');
SELECT fixture_assert((SELECT fold = 'vehicle_map_county_listings' AND to_regclass('public.' || fold) IS NOT NULL FROM public.map_layers WHERE layer = 'listing'),
  'listing names its live fold');
SELECT fixture_assert((SELECT count(*) = 1 FROM public.map_layers WHERE fold IS NOT NULL), 'only the listing layer is folded so far');
SELECT fixture_assert((SELECT bool_and(rule ~ 'is_public' AND rule ~ 'deleted_at') FROM public.map_layers WHERE entity = 'vehicle' OR layer = 'photo'),
  'every vehicle-backed rule states the public test');

-- Access: a reference table every role reads and no API role writes.
SELECT fixture_assert((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.map_layers'::regclass), 'RLS on');
SELECT fixture_assert((SELECT count(*) = 1 FROM pg_policies WHERE tablename = 'map_layers' AND cmd = 'SELECT'), 'one read policy');
SELECT fixture_assert(has_table_privilege('anon', 'public.map_layers', 'SELECT'), 'anon reads');
SELECT fixture_assert(has_table_privilege('authenticated', 'public.map_layers', 'SELECT'), 'signed-in reads');
SELECT fixture_assert(NOT has_table_privilege('anon', 'public.map_layers', 'INSERT,UPDATE,DELETE,TRUNCATE'), 'anon cannot write');
SELECT fixture_assert(NOT has_table_privilege('authenticated', 'public.map_layers', 'INSERT,UPDATE,DELETE,TRUNCATE'), 'signed-in cannot write');
SELECT fixture_assert(NOT has_table_privilege('service_role', 'public.map_layers', 'INSERT,UPDATE,DELETE,TRUNCATE'), 'service_role cannot write: migrations only');
SET ROLE anon;
SELECT fixture_assert((SELECT count(*) = 5 FROM public.map_layers), 'anon sees all five through RLS');
RESET ROLE;

-- The listing rule, written from the row, reproduces the fold over three complete UTC days.
CREATE TEMP TABLE win AS
SELECT (as_of AT TIME ZONE 'UTC')::date - 3 AS d0, (as_of AT TIME ZONE 'UTC')::date - 1 AS d1, as_of
FROM (SELECT max(as_of) AS as_of FROM public.vehicle_map_county_listings) f;
CREATE TEMP TABLE fold AS
SELECT sum(listings) AS listings, sum(priced) AS priced, sum(asking_sum) AS asking_sum, count(DISTINCT fips) AS counties
FROM public.vehicle_map_county_listings m, win WHERE m.day BETWEEN win.d0 AND win.d1;
CREATE TEMP TABLE rule AS
WITH first_listing AS (
  SELECT DISTINCT ON (o.vehicle_id) o.vehicle_id, o.county_fips AS fips, (o.observed_at AT TIME ZONE 'UTC')::date AS d
  FROM public.vehicle_location_observations o, win
  WHERE o.source_type = 'listing' AND o.county_fips ~ '^[0-9]{5}$' AND o.vehicle_id IS NOT NULL
    AND o.observed_at >= win.as_of - interval '30 days' AND o.observed_at <= win.as_of AND o.created_at <= win.as_of
  ORDER BY o.vehicle_id, o.observed_at
)
SELECT count(*) AS listings, count(v.asking_price) AS priced, sum(v.asking_price) AS asking_sum, count(DISTINCT f.fips) AS counties
FROM first_listing f JOIN public.vehicles v ON v.id = f.vehicle_id AND v.is_public AND v.deleted_at IS NULL, win
WHERE f.d BETWEEN win.d0 AND win.d1;
SELECT fixture_assert((SELECT listings > 100 FROM fold), 'the window holds enough rows to mean something');
SELECT fixture_assert((SELECT f.listings = r.listings FROM fold f, rule r), 'listing rule reproduces the fold: vehicles');
SELECT fixture_assert((SELECT f.priced = r.priced AND f.priced < f.listings FROM fold f, rule r), 'listing rule reproduces the fold: priced');
SELECT fixture_assert((SELECT f.asking_sum = r.asking_sum FROM fold f, rule r), 'listing rule reproduces the fold: asking sum');
SELECT fixture_assert((SELECT f.counties = r.counties FROM fold f, rule r), 'listing rule reproduces the fold: counties');
-- A vehicle seen listed before the window and again inside it is not a new listing in the window.
SELECT fixture_assert((SELECT count(*) > 0 FROM public.vehicle_location_observations o, win
  WHERE o.source_type = 'listing' AND o.county_fips ~ '^[0-9]{5}$' AND (o.observed_at AT TIME ZONE 'UTC')::date BETWEEN win.d0 AND win.d1
    AND EXISTS (SELECT 1 FROM public.vehicle_location_observations p WHERE p.vehicle_id = o.vehicle_id AND p.source_type = 'listing'
                AND p.county_fips ~ '^[0-9]{5}$' AND p.observed_at < win.d0::timestamptz AND p.observed_at >= win.as_of - interval '30 days')),
  'the seed has repeat listings the rule must not double count');
