-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_county_index -f this-file.sql
-- Proves 20261014040400_county_readers_index_backed.sql: get_county_detail keeps its answer and its public-only rule while
-- reading the county from a covering index and its vehicles in one bitmap sweep.
--   * on the same rows the new function returns the same document as the 2026-10-14 production function (count, summed price,
--     top 20, makes, platforms, shape) for a county, a second county, an empty county and an unknown one;
--   * anon keeps EXECUTE and sees no private or deleted vehicle; the function keeps its security and settings;
--   * the two partial indexes exist, are valid, and the county read is an index-only scan of the covering one;
--   * the bitmap setting is restored after a call; a second run is a no-op; a drifted source stops the migration.
-- PostGIS is not in the CI image, so geometry is stubbed: a county is a "minlon minlat maxlon maxlat" box and a point is
-- "lon lat". The stubs carry PostGIS's names and argument types so the live SQL resolves unchanged.
-- The rows below are a disposable test database's rows, never production testimony.
-- ALLOW_RAW_TESTIMONY_WRITE: a disposable test database; the stub tables below carry production's names and none of its rows.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Geometry stubs.
CREATE DOMAIN public.geometry AS text;
CREATE FUNCTION public.st_makepoint(double precision, double precision) RETURNS public.geometry
  LANGUAGE sql IMMUTABLE AS $$ SELECT ($1::text || ' ' || $2::text)::public.geometry $$;
CREATE FUNCTION public.st_setsrid(public.geometry, integer) RETURNS public.geometry
  LANGUAGE sql IMMUTABLE AS $$ SELECT $1 $$;
CREATE FUNCTION public.st_contains(public.geometry, public.geometry) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT split_part($2, ' ', 1)::float8 BETWEEN split_part($1, ' ', 1)::float8 AND split_part($1, ' ', 3)::float8
     AND split_part($2, ' ', 2)::float8 BETWEEN split_part($1, ' ', 2)::float8 AND split_part($1, ' ', 4)::float8 $$;
CREATE FUNCTION public.st_xmin(public.geometry) RETURNS double precision LANGUAGE sql IMMUTABLE AS $$ SELECT split_part($1, ' ', 1)::float8 $$;
CREATE FUNCTION public.st_ymin(public.geometry) RETURNS double precision LANGUAGE sql IMMUTABLE AS $$ SELECT split_part($1, ' ', 2)::float8 $$;
CREATE FUNCTION public.st_xmax(public.geometry) RETURNS double precision LANGUAGE sql IMMUTABLE AS $$ SELECT split_part($1, ' ', 3)::float8 $$;
CREATE FUNCTION public.st_ymax(public.geometry) RETURNS double precision LANGUAGE sql IMMUTABLE AS $$ SELECT split_part($1, ' ', 4)::float8 $$;

-- The shapes the readers touch, with the live indexes.
CREATE TABLE public.us_county_boundaries (fips text PRIMARY KEY, name text, state_fips text, geom public.geometry);
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, year integer, make text, model text, sale_price numeric, sold_price numeric,
  primary_image_url text, status text, is_public boolean, deleted_at timestamptz);
CREATE TABLE public.vehicle_location_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid,
  latitude double precision, longitude double precision, county_fips text, source_platform text, observed_at timestamptz DEFAULT now());
CREATE INDEX idx_vlo_county_fips ON public.vehicle_location_observations (county_fips) WHERE county_fips IS NOT NULL;
CREATE INDEX idx_vlo_bbox ON public.vehicle_location_observations (latitude, longitude) WHERE latitude IS NOT NULL;
CREATE INDEX idx_vehicle_location_observations_vehicle_time ON public.vehicle_location_observations (vehicle_id, observed_at DESC);

-- Counties as boxes. A = Clark-like, B = Maricopa-like, C = a county with no located vehicle, D = holds 300 public vehicles.
INSERT INTO public.us_county_boundaries (fips, name, state_fips, geom) VALUES
  ('32003', 'Clark', '32', '-116 35 -114 37'),
  ('04013', 'Maricopa', '04', '-113 32 -111 34'),
  ('99001', 'Empty', '99', '10 10 11 11'),
  ('06037', 'Big', '06', '-119 33 -117 35');

CREATE FUNCTION public.t_vid(p_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('70000000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid $$;
-- 30 public vehicles in A (ids 1..30), 10 private (101..110), 3 deleted (201..203), 5 public in B (301..305),
-- 3 unstamped inside A (401..403), 1 unstamped outside every box (501), 1 stamped A with no coordinates (601).
INSERT INTO public.vehicles (id, year, make, model, sale_price, sold_price, primary_image_url, status, is_public, deleted_at)
SELECT public.t_vid(g), 1960 + g, (ARRAY['Chevrolet', 'Ford', 'Toyota'])[1 + g % 3], 'M' || g,
       CASE WHEN g % 4 = 0 THEN NULL ELSE 1000 * g END, CASE WHEN g % 4 = 0 THEN 500 * g END, 'https://x/' || g || '.jpg', 'sold', true, NULL
FROM generate_series(1, 30) g;
INSERT INTO public.vehicles (id, year, make, model, sale_price, primary_image_url, status, is_public)
SELECT public.t_vid(g), 1985, 'Toyota', 'Private' || g, 90000, 'https://x/private' || g || '.jpg', 'owned', false FROM generate_series(101, 110) g;
INSERT INTO public.vehicles (id, year, make, model, sale_price, primary_image_url, status, is_public, deleted_at)
SELECT public.t_vid(g), 1990, 'Jeep', 'Gone' || g, 7000, 'https://x/gone' || g || '.jpg', 'sold', true, '2026-01-01' FROM generate_series(201, 203) g;
INSERT INTO public.vehicles (id, year, make, model, sale_price, primary_image_url, status, is_public)
SELECT public.t_vid(g), 1970, 'Ford', 'B' || g, 2000 * g, 'https://x/b' || g || '.jpg', 'sold', true FROM generate_series(301, 305) g;
INSERT INTO public.vehicles (id, year, make, model, sale_price, primary_image_url, status, is_public)
SELECT public.t_vid(g), 1999, 'Honda', 'Loose' || g, 4000, 'https://x/loose' || g || '.jpg', 'active', true FROM generate_series(401, 403) g;
INSERT INTO public.vehicles (id, year, make, model, sale_price, primary_image_url, status, is_public)
VALUES (public.t_vid(501), 2001, 'Subaru', 'Far', 5000, 'https://x/far.jpg', 'active', true),
       (public.t_vid(601), 2002, 'Mazda', 'NoCoords', 6000, 'https://x/nocoords.jpg', 'active', true);
-- 300 public vehicles for the 200 cap, in county D.
INSERT INTO public.vehicles (id, year, make, model, sale_price, status, is_public)
SELECT public.t_vid(1000 + g), 1975, 'Ford', 'D' || g, 100 * g, 'sold', true FROM generate_series(1, 300) g;

-- One stamped observation per A vehicle (bat 1-10, craigslist 11-20, cars_and_bids 21-30); vehicles 1-5 also on craigslist.
INSERT INTO public.vehicle_location_observations (vehicle_id, latitude, longitude, county_fips, source_platform)
SELECT public.t_vid(g), 36.0 + g / 100.0, -115.0 - g / 100.0, '32003',
       CASE WHEN g <= 10 THEN 'bat' WHEN g <= 20 THEN 'craigslist' ELSE 'cars_and_bids' END
FROM generate_series(1, 30) g;
INSERT INTO public.vehicle_location_observations (vehicle_id, latitude, longitude, county_fips, source_platform)
SELECT public.t_vid(g), 36.5, -115.5, '32003', 'craigslist' FROM generate_series(1, 5) g;
INSERT INTO public.vehicle_location_observations (vehicle_id, latitude, longitude, county_fips, source_platform)
SELECT public.t_vid(g), 36.2, -115.2, '32003', 'iphoto' FROM generate_series(101, 110) g;
INSERT INTO public.vehicle_location_observations (vehicle_id, latitude, longitude, county_fips, source_platform)
SELECT public.t_vid(g), 36.3, -115.3, '32003', 'bat' FROM generate_series(201, 203) g;
INSERT INTO public.vehicle_location_observations (vehicle_id, latitude, longitude, county_fips, source_platform)
SELECT public.t_vid(g), 33.0 + (g - 300) / 10.0, -112.0, '04013', 'bat' FROM generate_series(301, 305) g;
-- Unstamped, with coordinates inside A.
INSERT INTO public.vehicle_location_observations (vehicle_id, latitude, longitude, county_fips, source_platform)
SELECT public.t_vid(g), 36.6, -114.5, NULL, 'craigslist' FROM generate_series(401, 403) g;
-- Unstamped, outside every box; stamped A with no coordinates.
INSERT INTO public.vehicle_location_observations (vehicle_id, latitude, longitude, county_fips, source_platform)
VALUES (public.t_vid(501), 50.0, 5.0, NULL, 'bat'), (public.t_vid(601), NULL, NULL, '32003', 'bat');
-- County D.
INSERT INTO public.vehicle_location_observations (vehicle_id, latitude, longitude, county_fips, source_platform)
SELECT public.t_vid(1000 + g), 34.0, -118.0, '06037', 'bat' FROM generate_series(1, 300) g;
-- Filler so the planner prefers the indexes: 30,000 observations elsewhere, 3,000 unstamped with coordinates outside the boxes.
INSERT INTO public.vehicle_location_observations (vehicle_id, latitude, longitude, county_fips, source_platform)
SELECT gen_random_uuid(), 40.0 + (g % 100) / 10.0, -90.0 - (g % 100) / 10.0, 'F' || lpad((g % 500)::text, 4, '0'), 'bat'
FROM generate_series(1, 30000) g;
INSERT INTO public.vehicle_location_observations (vehicle_id, latitude, longitude, county_fips, source_platform)
SELECT gen_random_uuid(), 60.0 + (g % 100) / 10.0, 20.0 + (g % 100) / 10.0, NULL, 'bat' FROM generate_series(1, 3000) g;
VACUUM (ANALYZE) public.vehicle_location_observations;
ANALYZE public.vehicles;

-- The functions as production has them on 2026-10-14 (after #1109), with production's grants.
\ir helpers/get_county_detail_live_20261014.sql
GRANT EXECUTE ON FUNCTION public.get_county_detail(text) TO anon, authenticated, service_role;
CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO anon;
SELECT public.t_assert(md5(pg_get_functiondef('public.get_county_detail(text)'::regprocedure)) = 'a9ca0c546e3c6053314cdcc84b3848bf', 'the fixture is the live source');
-- A copy of the live function under another name, to compare against after the replacement.
SELECT replace(pg_get_functiondef('public.get_county_detail(text)'::regprocedure), 'public.get_county_detail(', 'public.detail_before(') AS ddl \gexec
CREATE TEMP TABLE original_contract AS
  SELECT p.proowner, p.proacl, p.prosecdef, p.provolatile, p.proconfig, pg_get_function_result(p.oid) AS result
  FROM pg_proc p WHERE p.oid = 'public.get_county_detail(text)'::regprocedure;
CREATE TABLE public.t_before (k text PRIMARY KEY, j jsonb);
INSERT INTO public.t_before
  SELECT 'detail ' || f, public.detail_before(f) FROM unnest(ARRAY['32003', '04013', '99001', '12345']) f;
SELECT public.t_assert((SELECT (j ->> 'vehicle_count')::int FROM public.t_before WHERE k = 'detail 32003') = 33,
  'the fixture: A has 30 public vehicles and 3 unstamped inside it');

-- 1. The migration (CREATE INDEX CONCURRENTLY runs outside a transaction block, so psql's autocommit is required).
\ir ../migrations/20261014040400_county_readers_index_backed.sql
ANALYZE public.vehicle_location_observations;

SELECT public.t_assert((SELECT bool_and(i.indisvalid AND i.indisready) AND count(*) = 2 FROM pg_index i
    WHERE i.indexrelid IN ('public.idx_vlo_county_cover'::regclass, 'public.idx_vlo_unstamped_coords'::regclass)), 'both indexes are valid and ready');
SELECT public.t_assert((SELECT pg_get_expr(indpred, indrelid) FROM pg_index WHERE indexrelid = 'public.idx_vlo_unstamped_coords'::regclass)
  LIKE '%county_fips IS NULL%', 'the unstamped index is partial on county_fips IS NULL');
SELECT public.t_assert((SELECT ROW(p.proowner, p.proacl, p.prosecdef, p.provolatile, p.proconfig, pg_get_function_result(p.oid))
    IS NOT DISTINCT FROM ROW(o.proowner, o.proacl, o.prosecdef, o.provolatile, o.proconfig, o.result)
  FROM pg_proc p CROSS JOIN original_contract o WHERE p.oid = 'public.get_county_detail(text)'::regprocedure),
  'owner, grants, security, volatility, settings and return shape are unchanged');

-- 2. The same documents (apart from generated_at) and the same ids.
CREATE FUNCTION public.t_core(j jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT j - 'generated_at' $$;
SELECT public.t_assert(public.t_core(public.get_county_detail('32003')) = public.t_core((SELECT j FROM public.t_before WHERE k = 'detail 32003')),
  format('county A: the same document; got %s', public.get_county_detail('32003')));
SELECT public.t_assert(public.t_core(public.get_county_detail('04013')) = public.t_core((SELECT j FROM public.t_before WHERE k = 'detail 04013')), 'county B: the same document');
SELECT public.t_assert(public.t_core(public.get_county_detail('99001')) = public.t_core((SELECT j FROM public.t_before WHERE k = 'detail 99001')), 'an empty county: the same document');
SELECT public.t_assert(public.t_core(public.get_county_detail('12345')) = public.t_core((SELECT j FROM public.t_before WHERE k = 'detail 12345'))
  AND public.get_county_detail('12345') ->> 'error' = 'County not found', 'an unknown county: the same error document');

-- 3. Anon still executes it and sees no private or deleted vehicle.
SET ROLE anon;
DO $$
DECLARE d jsonb := public.get_county_detail('32003');
BEGIN
  PERFORM public.t_assert((d ->> 'vehicle_count')::int = 33, format('anon: 33 public vehicles; got %s', d ->> 'vehicle_count'));
  PERFORM public.t_assert(NOT d -> 'vehicles' @> '[{"model": "Private101"}]' AND NOT (d::text LIKE '%Private1%') AND NOT (d::text LIKE '%Gone2%'), 'anon: no private or deleted vehicle');
  PERFORM public.t_assert(NOT d -> 'platforms' @> '[{"platform": "iphoto"}]', 'anon: no platform that only private vehicles use');
  PERFORM public.t_assert(jsonb_array_length(d -> 'vehicles') = 20, 'anon: the top 20');
  PERFORM public.t_assert(d ?& ARRAY['fips', 'county_name', 'state_fips', 'vehicle_count', 'total_value', 'vehicles', 'makes', 'platforms', 'generated_at'], 'anon: the document keeps its shape');
END $$;
RESET ROLE;

-- 4. The setting the detail flips for its vehicle sweep is restored (checked in one transaction).
DO $$
DECLARE before_setting text := current_setting('enable_indexscan');
BEGIN
  PERFORM public.get_county_detail('32003');
  PERFORM public.t_assert(current_setting('enable_indexscan') = before_setting AND before_setting = 'on', 'enable_indexscan is restored after the call');
END $$;

-- 5. The county's observations come from the covering index alone (no heap fetch needed once the table is vacuumed).
CREATE FUNCTION public.t_plan_uses(p_sql text, p_node text, p_index text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE plan jsonb;
BEGIN
  EXECUTE 'EXPLAIN (FORMAT JSON, COSTS OFF) ' || p_sql INTO plan;
  RETURN EXISTS (SELECT 1 FROM jsonb_path_query(plan, 'strict $.**') n WHERE jsonb_typeof(n) = 'object'
                 AND n ->> 'Node Type' = p_node AND n ->> 'Index Name' = p_index);
END $$;
SELECT public.t_assert(public.t_plan_uses($q$SELECT vlo.source_platform, vlo.vehicle_id FROM public.vehicle_location_observations vlo
    WHERE vlo.county_fips = '32003' AND vlo.latitude IS NOT NULL AND vlo.longitude IS NOT NULL$q$, 'Index Only Scan', 'idx_vlo_county_cover'),
  'the stamped read is an index-only scan of idx_vlo_county_cover');
SELECT public.t_assert(public.t_plan_uses($q$SELECT vlo.source_platform, vlo.vehicle_id FROM public.vehicle_location_observations vlo
    WHERE vlo.county_fips IS NULL AND vlo.latitude IS NOT NULL AND vlo.longitude IS NOT NULL AND vlo.latitude BETWEEN 35 AND 37
      AND vlo.longitude BETWEEN -116 AND -114$q$, 'Index Only Scan', 'idx_vlo_unstamped_coords'),
  'the unstamped bounding-box read is an index-only scan of idx_vlo_unstamped_coords');

-- 6. A second run is a no-op that passes the guard; a drifted function stops the migration and is left as found.
\ir ../migrations/20261014040400_county_readers_index_backed.sql
CREATE OR REPLACE FUNCTION public.get_county_detail(p_fips text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
  AS $f$ SELECT '{"drifted": true}'::jsonb WHERE true $f$;
\echo 'Expected: the source guard ERROR below, then the aborted transaction ignoring the rest of the file.'
\set ON_ERROR_STOP off
\ir ../migrations/20261014040400_county_readers_index_backed.sql
\set ON_ERROR_STOP on
SELECT public.t_assert(public.get_county_detail('32003') = '{"drifted": true}'::jsonb, 'a drifted function is not replaced');
SELECT 'county readers index-backed contract: PASS' AS result;
