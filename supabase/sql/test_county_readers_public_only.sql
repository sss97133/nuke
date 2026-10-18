-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_county_readers -f this-file.sql
-- Proves the county readers' visibility hole and its fix. With the 2026-10-14 definitions of get_county_vehicles and
-- get_county_detail (owner-run, executable by anon), a logged-out caller receives private vehicles located in a county:
-- their ids, and their year, make, model, prices and image in the detail. After the migration both answer with public,
-- undeleted vehicles only, keep their return shapes and anon's EXECUTE, and pin search_path to public.
-- PostGIS is not in the CI image, so geometry is stubbed: a county is a "minlon minlat maxlon maxlat" box and a point is
-- "lon lat". The stubs carry PostGIS's names and argument types so the live SQL resolves unchanged.
-- The rows below are a disposable test database's rows, never production testimony.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon;

-- Geometry stubs.
CREATE DOMAIN public.geometry AS text;
CREATE FUNCTION public.st_makepoint(double precision, double precision) RETURNS public.geometry
  LANGUAGE sql IMMUTABLE AS $$ SELECT ($1::text || ' ' || $2::text)::public.geometry $$;
CREATE FUNCTION public.st_setsrid(public.geometry, integer) RETURNS public.geometry
  LANGUAGE sql IMMUTABLE AS $$ SELECT $1 $$;
CREATE FUNCTION public.st_contains(public.geometry, public.geometry) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT split_part($2, ' ', 1)::float8 BETWEEN split_part($1, ' ', 1)::float8 AND split_part($1, ' ', 3)::float8
     AND split_part($2, ' ', 2)::float8 BETWEEN split_part($1, ' ', 2)::float8 AND split_part($1, ' ', 4)::float8 $$;

-- The shapes the readers touch.
CREATE TABLE public.us_county_boundaries (fips text PRIMARY KEY, name text, state_fips text, geom public.geometry);
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, year integer, make text, model text, sale_price numeric, sold_price numeric,
  primary_image_url text, status text, is_public boolean, deleted_at timestamptz);
CREATE TABLE public.vehicle_location_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid,
  latitude double precision, longitude double precision, county_fips text, source_platform text);

-- Clark County as a box. P1 and P2 are public (P2 located only by coordinates), X1 is private, D1 is deleted.
INSERT INTO public.us_county_boundaries (fips, name, state_fips, geom) VALUES ('32003', 'Clark', '32', '-116 35 -114 37');
INSERT INTO public.vehicles (id, year, make, model, sale_price, sold_price, primary_image_url, status, is_public, deleted_at) VALUES
 ('70000000-0000-0000-0000-0000000000a1', 1977, 'Chevrolet', 'K5 Blazer', 30000, NULL, 'https://x/p1.jpg', 'sold', true,  NULL),
 ('70000000-0000-0000-0000-0000000000a2', 1972, 'Ford', 'Bronco', NULL, 45000, 'https://x/p2.jpg', 'sold', true,  NULL),
 ('70000000-0000-0000-0000-0000000000b1', 1985, 'Toyota', 'Land Cruiser', 52000, NULL, 'https://x/private.jpg', 'owned', false, NULL),
 ('70000000-0000-0000-0000-0000000000c1', 1990, 'Jeep', 'Wrangler', 9000, NULL, 'https://x/deleted.jpg', 'sold', true, '2026-01-01');
INSERT INTO public.vehicle_location_observations (vehicle_id, latitude, longitude, county_fips, source_platform) VALUES
 ('70000000-0000-0000-0000-0000000000a1', 36.1, -115.1, '32003', 'bat'),
 ('70000000-0000-0000-0000-0000000000a2', 36.2, -115.2, NULL,    'craigslist'),
 ('70000000-0000-0000-0000-0000000000b1', 36.0, -115.0, '32003', 'iphoto'),
 ('70000000-0000-0000-0000-0000000000c1', 36.3, -115.3, '32003', 'bat');

-- The functions as production has them on 2026-10-14, with anon's EXECUTE.
\ir helpers/county_readers_live_20261014.sql
GRANT EXECUTE ON FUNCTION public.get_county_detail(text), public.get_county_vehicles(text) TO anon;
SELECT encode(sha256(prosrc::bytea), 'base64') = 'VIo4f6qOjKMOKu39N44eAHqrDy5JXt+48FDHb/4lns4=' AS detail_is_live FROM pg_proc WHERE oid = 'public.get_county_detail(text)'::regprocedure \gset
SELECT encode(sha256(prosrc::bytea), 'base64') = 'FePXGobe7hSRDGu8GOWOVe8CScyhlAlloWR8GQ4J3t0=' AS vehicles_is_live FROM pg_proc WHERE oid = 'public.get_county_vehicles(text)'::regprocedure \gset

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO anon;
SELECT public.t_assert(:'detail_is_live'::boolean AND :'vehicles_is_live'::boolean, 'the fixture is the live source');

-- 1. Before the fix: a logged-out caller receives the private vehicle.
SET ROLE anon;
DO $$
DECLARE d jsonb := public.get_county_detail('32003');
BEGIN
  PERFORM public.t_assert((SELECT count(*) FROM public.get_county_vehicles('32003')) = 4, 'before: every located id, private and deleted included');
  PERFORM public.t_assert((d->>'vehicle_count')::int = 3, format('before: the detail counts the private vehicle; got %s', d->>'vehicle_count'));
  PERFORM public.t_assert(d->'vehicles' @> '[{"make": "Toyota", "primary_image_url": "https://x/private.jpg"}]',
    'before: the detail returns the private vehicle with its image');
END $$;
RESET ROLE;

-- 2. The fix.
\ir ../migrations/20261014024500_county_readers_public_only.sql

-- 3. After the fix: public, undeleted vehicles only, same shapes, anon still executes.
SET ROLE anon;
DO $$
DECLARE d jsonb := public.get_county_detail('32003');
BEGIN
  PERFORM public.t_assert((SELECT array_agg(vehicle_id ORDER BY vehicle_id) FROM public.get_county_vehicles('32003'))
    = ARRAY['70000000-0000-0000-0000-0000000000a1', '70000000-0000-0000-0000-0000000000a2']::uuid[], 'after: the two public ids only');
  PERFORM public.t_assert((d->>'vehicle_count')::int = 2, format('after: the detail counts two; got %s', d->>'vehicle_count'));
  PERFORM public.t_assert((d->>'total_value')::bigint = 75000, format('after: the total sums public prices only; got %s', d->>'total_value'));
  PERFORM public.t_assert(NOT d->'vehicles' @> '[{"make": "Toyota"}]' AND jsonb_array_length(d->'vehicles') = 2, 'after: no private vehicle in the list');
  PERFORM public.t_assert(NOT d->'makes' @> '[{"make": "Toyota"}]', 'after: no private make');
  PERFORM public.t_assert(NOT d->'platforms' @> '[{"platform": "iphoto"}]' AND d->'platforms' @> '[{"platform": "bat", "count": 1}]',
    format('after: platforms count public vehicles only; got %s', d->'platforms'));
  PERFORM public.t_assert(d ?& ARRAY['fips', 'county_name', 'state_fips', 'vehicle_count', 'total_value', 'vehicles', 'makes', 'platforms', 'generated_at'],
    'after: the detail keeps its shape');
END $$;
RESET ROLE;
SELECT public.t_assert((SELECT bool_and(proconfig::text LIKE '%search_path=public%') FROM pg_proc
  WHERE oid IN ('public.get_county_detail(text)'::regprocedure, 'public.get_county_vehicles(text)'::regprocedure)), 'both pin search_path');

-- 4. A second run is a no-op that passes the guard.
\ir ../migrations/20261014024500_county_readers_public_only.sql

-- 5. A drifted source stops the migration and is left as found.
CREATE OR REPLACE FUNCTION public.get_county_vehicles(p_fips text) RETURNS TABLE(vehicle_id uuid) LANGUAGE sql STABLE SECURITY DEFINER
  AS $f$ SELECT NULL::uuid WHERE false $f$;
\echo 'Expected: the source guard ERROR below, then the aborted transaction ignoring the rest of the file.'
\set ON_ERROR_STOP off
\ir ../migrations/20261014024500_county_readers_public_only.sql
\set ON_ERROR_STOP on
SELECT public.t_assert((SELECT prosrc FROM pg_proc WHERE oid = 'public.get_county_vehicles(text)'::regprocedure) LIKE '%WHERE false%',
  'a drifted function is not replaced');
SELECT 'county readers public-only contract: PASS' AS result;
