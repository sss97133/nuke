-- Disposable PG17 only. Proves 20261116021000_geo_cell_zcta_keyer.sql on its own: pending cells ask for their county's
-- ZCTA file once; a 200 keys each cell (one ZCTA, none, two = ambiguous); a 404 fails the county and its cells, old and
-- new, become no_source; a timeout or no response is retried, at most 3 requests, then fails; a loaded county is
-- fetched again when a new cell appears; an unreadable body fails the county; the tables and functions are
-- service_role only. The writer that calls the keyer is proven in test_photo_gps_zcta.sql.
-- Stand-ins: geo_zcta_key_cells (PostGIS) is replaced by a rectangle test with the same contract; pg_net is a queue
-- table plus a response table filled by hand.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.geo_cell_zcta') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable PG17 database required';
  END IF;
END $$;
SET statement_timeout = '30s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE FUNCTION public.get_service_url() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'https://project.invalid'::text $$;
CREATE SCHEMA net;
CREATE TABLE net.http_request_queue(id bigserial PRIMARY KEY, url text NOT NULL, timeout_milliseconds integer);
CREATE TABLE net._http_response(id bigint PRIMARY KEY, status_code integer, content text, timed_out boolean,
  error_msg text, created timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION net.http_get(url text, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds integer DEFAULT 5000) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO net.http_request_queue(url, timeout_milliseconds) VALUES (url, timeout_milliseconds) RETURNING id $$;
CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;

\ir ../migrations/20261116021000_geo_cell_zcta_keyer.sql
\ir ../migrations/20261116021000_geo_cell_zcta_keyer.sql
CREATE OR REPLACE FUNCTION public.geo_zcta_key_cells(p_county_fips text, p_features jsonb)
RETURNS TABLE (k_lat numeric, k_lng numeric, k_zctas text[]) LANGUAGE sql STABLE AS $$
  WITH shp AS (
    SELECT f->'properties'->>'GEOID' AS zcta,
           (SELECT min((pt->>0)::numeric) FROM jsonb_array_elements(f->'geometry'->'coordinates'->0) pt) AS w,
           (SELECT max((pt->>0)::numeric) FROM jsonb_array_elements(f->'geometry'->'coordinates'->0) pt) AS e,
           (SELECT min((pt->>1)::numeric) FROM jsonb_array_elements(f->'geometry'->'coordinates'->0) pt) AS s,
           (SELECT max((pt->>1)::numeric) FROM jsonb_array_elements(f->'geometry'->'coordinates'->0) pt) AS n
    FROM jsonb_array_elements(p_features) f)
  SELECT c.cell_lat, c.cell_lng,
         (SELECT array_agg(DISTINCT s.zcta ORDER BY s.zcta) FROM shp s
           WHERE c.cell_lng BETWEEN s.w AND s.e AND c.cell_lat BETWEEN s.s AND s.n)
  FROM public.geo_cell_zcta c WHERE c.county_fips = p_county_fips AND c.status = 'pending' $$;
-- County 55555 stands for an error while keying (here a lock timeout); it must be retried, not failed.
ALTER FUNCTION public.geo_zcta_key_cells(text, jsonb) RENAME TO geo_zcta_key_cells_box;
CREATE FUNCTION public.geo_zcta_key_cells(p_county_fips text, p_features jsonb)
RETURNS TABLE (k_lat numeric, k_lng numeric, k_zctas text[]) LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_county_fips = '55555' THEN RAISE EXCEPTION 'canceling statement due to lock timeout' USING ERRCODE = '55P03'; END IF;
  RETURN QUERY SELECT * FROM public.geo_zcta_key_cells_box(p_county_fips, p_features);
END $$;

SELECT t_assert(NOT has_table_privilege('anon', 'public.geo_cell_zcta', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.geo_cell_zcta', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.geo_zcta_county_loads', 'SELECT')
  AND NOT has_function_privilege('anon', 'public.key_geo_cells_zcta(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.key_geo_cells_zcta(integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.key_geo_cells_zcta(integer)', 'EXECUTE'),
  'service_role only');
SELECT t_assert((SELECT count(*) FROM pg_policies WHERE tablename IN ('geo_cell_zcta', 'geo_zcta_county_loads')) = 0
  AND (SELECT bool_and(relrowsecurity) FROM pg_class WHERE relname IN ('geo_cell_zcta', 'geo_zcta_county_loads')),
  'RLS on, no policy');

-- Cells: three in county 11111 (one ZCTA, none, two), one in 22222 (file missing), one in 33333 (times out),
-- one in 44444 (unreadable body).
INSERT INTO geo_cell_zcta(cell_lat, cell_lng, county_fips) VALUES
  (10.005, 20.005, '11111'), (10.050, 20.050, '11111'), (10.015, 20.025, '11111'),
  (30.000, 40.000, '22222'), (50.000, 60.000, '33333'), (70.000, 80.000, '44444');
CREATE TEMP TABLE r(step text, out jsonb);
INSERT INTO r SELECT 'k1', key_geo_cells_zcta(2);
SELECT t_assert((SELECT out->>'counties_requested' = '2' AND out->>'cells_pending' = '6' FROM r WHERE step = 'k1')
  AND (SELECT count(*) FROM net.http_request_queue) = 2, 'k1: at most p_max_requests counties asked');
INSERT INTO r SELECT 'k2', key_geo_cells_zcta(25);
SELECT t_assert((SELECT out->>'counties_requested' = '2' FROM r WHERE step = 'k2')
  AND (SELECT count(*) FROM net.http_request_queue) = 4
  AND (SELECT count(*) FROM geo_zcta_county_loads WHERE status = 'requested') = 4, 'k2: the rest asked, none asked twice');
SELECT t_assert((SELECT array_agg(url ORDER BY url) FROM net.http_request_queue) = ARRAY(
    SELECT 'https://project.invalid/storage/v1/object/public/map-data/geo/v1/county/' || f || '.geojson'
    FROM unnest(ARRAY['11111','22222','33333','44444']) f ORDER BY 1), 'GET the county file from public storage');

INSERT INTO r SELECT 'k3', key_geo_cells_zcta(25);
SELECT t_assert((SELECT out->>'counties_requested' = '0' AND out->>'counties_loaded' = '0' FROM r WHERE step = 'k3'),
  'k3: in flight, nothing re-asked');

CREATE FUNCTION pg_temp.req(f text) RETURNS bigint LANGUAGE sql AS
  $$ SELECT request_id FROM public.geo_zcta_county_loads WHERE county_fips = f $$;
INSERT INTO net._http_response(id, status_code, content) VALUES
 (pg_temp.req('11111'), 200, '{"type":"FeatureCollection","features":[
   {"properties":{"GEOID":"00001"},"geometry":{"type":"Polygon","coordinates":[[[20.00,10.00],[20.01,10.00],[20.01,10.01],[20.00,10.01],[20.00,10.00]]]}},
   {"properties":{"GEOID":"00002"},"geometry":{"type":"Polygon","coordinates":[[[20.02,10.01],[20.03,10.01],[20.03,10.02],[20.02,10.02],[20.02,10.01]]]}},
   {"properties":{"GEOID":"00003"},"geometry":{"type":"Polygon","coordinates":[[[20.02,10.01],[20.04,10.01],[20.04,10.03],[20.02,10.03],[20.02,10.01]]]}}]}'),
 (pg_temp.req('22222'), 404, 'not found'),
 (pg_temp.req('33333'), NULL, NULL),
 (pg_temp.req('44444'), 200, '<html>not json</html>');
UPDATE net._http_response SET timed_out = true, error_msg = 'Timeout was reached' WHERE id = pg_temp.req('33333');
INSERT INTO r SELECT 'k4', key_geo_cells_zcta(25);
SELECT t_assert((SELECT out->>'counties_loaded' = '1' AND out->>'cells_keyed' = '3' AND out->>'counties_failed' = '2'
    AND out->>'counties_retry' = '1' AND out->>'cells_no_source' = '2' AND out->>'counties_requested' = '1'
    AND out->>'cells_pending' = '1' FROM r WHERE step = 'k4'),
  'k4: one loaded, two failed, one retried and asked again');
SELECT t_assert((SELECT jsonb_object_agg(county_fips || ':' || cell_lat, jsonb_build_array(status, zcta, candidates)) FROM geo_cell_zcta)
  = '{"11111:10.005":["keyed","00001",1],"11111:10.050":["no_zcta",null,0],"11111:10.015":["ambiguous",null,2],
      "22222:30.000":["no_source",null,null],"33333:50.000":["pending",null,null],"44444:70.000":["no_source",null,null]}'::jsonb,
  'k4: each cell''s answer');
SELECT t_assert((SELECT jsonb_object_agg(county_fips, jsonb_build_array(status, attempts, http_status, features)) FROM geo_zcta_county_loads)
  = '{"11111":["loaded",1,200,3],"22222":["failed",1,404,null],"33333":["requested",2,null,null],"44444":["failed",1,200,null]}'::jsonb
  AND (SELECT error LIKE 'unreadable body:%' FROM geo_zcta_county_loads WHERE county_fips = '44444')
  AND (SELECT error IS NULL FROM geo_zcta_county_loads WHERE county_fips = '33333'),
  'k4: the ledger');

-- 33333 times out twice more: failed after the third request, its cell no_source.
INSERT INTO net._http_response(id, status_code, timed_out) VALUES (pg_temp.req('33333'), NULL, true);
SELECT key_geo_cells_zcta(25);
SELECT t_assert((SELECT status = 'requested' AND attempts = 3 FROM geo_zcta_county_loads WHERE county_fips = '33333'), 'third request');
INSERT INTO net._http_response(id, status_code, timed_out) VALUES (pg_temp.req('33333'), NULL, true);
INSERT INTO r SELECT 'k6', key_geo_cells_zcta(25);
SELECT t_assert((SELECT out->>'counties_failed' = '1' AND out->>'counties_requested' = '0' AND out->>'cells_pending' = '0'
    AND out->>'counties_failed_total' = '3' FROM r WHERE step = 'k6')
  AND (SELECT status = 'no_source' FROM geo_cell_zcta WHERE county_fips = '33333'), 'after 3 requests: failed, no_source');

-- A new cell in a failed county is no_source at once; in a loaded county it re-asks the file.
INSERT INTO geo_cell_zcta(cell_lat, cell_lng, county_fips) VALUES (30.001, 40.001, '22222'), (10.006, 20.006, '11111');
INSERT INTO r SELECT 'k7', key_geo_cells_zcta(25);
SELECT t_assert((SELECT out->>'cells_no_source' = '1' AND out->>'counties_requested' = '1' FROM r WHERE step = 'k7')
  AND (SELECT status = 'requested' AND attempts = 1 FROM geo_zcta_county_loads WHERE county_fips = '11111'),
  'k7: failed county → no_source; loaded county → fetched again');

-- No response at all within 2 hours counts as a failed attempt.
UPDATE geo_zcta_county_loads SET requested_at = now() - interval '3 hours' WHERE county_fips = '11111';
INSERT INTO r SELECT 'k8', key_geo_cells_zcta(25);
SELECT t_assert((SELECT out->>'counties_retry' = '1' AND out->>'counties_requested' = '1' FROM r WHERE step = 'k8')
  AND (SELECT attempts = 2 FROM geo_zcta_county_loads WHERE county_fips = '11111'), 'k8: no response in 2 h → retried');

-- An error while keying (county 55555: a lock timeout) is a failed attempt, retried; the cell stays pending.
INSERT INTO geo_cell_zcta(cell_lat, cell_lng, county_fips) VALUES (60.000, 70.000, '55555');
SELECT key_geo_cells_zcta(25);
INSERT INTO net._http_response(id, status_code, content) VALUES (pg_temp.req('55555'), 200, '{"type":"FeatureCollection","features":[]}');
INSERT INTO r SELECT 'k9', key_geo_cells_zcta(25);
SELECT t_assert((SELECT out->>'counties_retry' = '1' AND out->>'counties_failed' = '0' FROM r WHERE step = 'k9')
  AND (SELECT status = 'requested' AND attempts = 2 FROM geo_zcta_county_loads WHERE county_fips = '55555')
  AND (SELECT status = 'pending' FROM geo_cell_zcta WHERE county_fips = '55555'),
  'k9: an error while keying is retried, not final');

DO $$ BEGIN
  PERFORM public.key_geo_cells_zcta(500);
  RAISE EXCEPTION 'p_max_requests 500 accepted';
EXCEPTION WHEN invalid_parameter_value THEN NULL;
END $$;
SELECT t_assert(true, 'p_max_requests out of range is refused');
SELECT 'PASS: geo_cell_zcta keyer' AS result;
