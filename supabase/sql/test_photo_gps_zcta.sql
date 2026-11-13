-- Disposable PG17 only. Proves 20261116021000_geo_cell_zcta_keyer.sql and 20261116029000_photo_gps_zcta_admission.sql:
-- photo-GPS rows admitted before the change keep standing while their ZIP is fetched; the county file then keys each
-- cell (one ZCTA, none, two = ambiguous, unreadable county = no source); a row that gains a zcta replaces the old one
-- (withdrawn once, reason recorded), a row without one keeps its id; re-runs are no-ops; a new cell re-fetches its
-- county and holds back only its vehicle and county; a timeout is retried; geo_cell_zcta and the keyer are
-- service_role only; rows still carry no point and no postal code; the tied viewer's point is per ZIP area.
-- Stand-ins: PostGIS is not here (photo_gps_area and geo_zcta_key_cells are replaced by rectangle tests with the same
-- contract; the PostGIS body was checked on prod against an independent ray-casting pass, 1,435 of 1,435 cells), and
-- pg_net is a queue table plus a response table filled by hand.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_location_observations') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable PG17 database required';
  END IF;
END $$;
SET statement_timeout = '30s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE public.vehicles(id uuid PRIMARY KEY, is_public boolean, deleted_at timestamptz, city text, state text,
  zip_code text, gps_latitude double precision, gps_longitude double precision, user_id uuid, owner_id uuid, uploaded_by uuid);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, vehicle_id uuid, image_url text, taken_at timestamptz,
  latitude numeric, longitude numeric, is_sensitive boolean DEFAULT false, is_superseded boolean DEFAULT false,
  is_duplicate boolean DEFAULT false, vision_gate_status text, image_vehicle_match_status text);
CREATE TABLE public.vehicle_location_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL,
  source_type text NOT NULL, source_platform text, source_url text, observed_at timestamptz NOT NULL DEFAULT now(),
  location_text_raw text, location_text_clean text, country_code text, region_code text, city text, postal_code text,
  latitude double precision, longitude double precision, "precision" text, confidence real,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  county_fips text, county_name text, zcta text);
CREATE TABLE public.write_receipts(id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), tbl text NOT NULL,
  op text NOT NULL, rows integer NOT NULL, writer text NOT NULL, db_role text NOT NULL, app_name text, txid bigint NOT NULL);
CREATE TABLE public.us_states(fips text PRIMARY KEY, usps text, name text);
CREATE TABLE public.us_county_boundaries(fips text PRIMARY KEY, name text, state_fips text);
CREATE TABLE public.city_geocode_lookup(city text, state text, latitude numeric, longitude numeric, sample_size integer,
  source text, PRIMARY KEY (city, state));
CREATE FUNCTION public.map_point_county(p_lon double precision, p_lat double precision) RETURNS text LANGUAGE sql AS
  $$ SELECT NULL::text $$;
CREATE FUNCTION public.get_service_url() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'https://project.invalid'::text $$;

-- pg_net stand-in: http_get queues and returns an id; responses are written by the test.
CREATE SCHEMA net;
CREATE TABLE net.http_request_queue(id bigserial PRIMARY KEY, url text NOT NULL, timeout_milliseconds integer);
CREATE TABLE net._http_response(id bigint PRIMARY KEY, status_code integer, content text, timed_out boolean,
  error_msg text, created timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION net.http_get(url text, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds integer DEFAULT 5000) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO net.http_request_queue(url, timeout_milliseconds) VALUES (url, timeout_milliseconds) RETURNING id $$;

CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE FUNCTION public.t_refused(q text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_refused(text) TO anon, authenticated, service_role;

\ir ../migrations/20261116001000_photo_gps_location_admission.sql
SELECT t_assert(md5(pg_get_functiondef('public.admit_photo_gps_locations(uuid)'::regprocedure)) = '00b41dab3b68bff3504cbdc9595b123d',
  '029000 guard: the 001000 writer here has the md5 production has');

-- Geography stand-in. Latitude 35..37 is Clark County NV (east of -114.9 near Boulder City); 33..34 is Maricopa AZ.
CREATE OR REPLACE FUNCTION public.photo_gps_area(p_lon double precision, p_lat double precision)
RETURNS TABLE (county_fips text, county_name text, region_code text, city text) LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_lat BETWEEN 35 AND 37 THEN '32003' WHEN p_lat BETWEEN 33 AND 34 THEN '04013' END,
         CASE WHEN p_lat BETWEEN 35 AND 37 THEN 'Clark' WHEN p_lat BETWEEN 33 AND 34 THEN 'Maricopa' END,
         CASE WHEN p_lat BETWEEN 35 AND 37 THEN 'NV' WHEN p_lat BETWEEN 33 AND 34 THEN 'AZ' END,
         CASE WHEN p_lat BETWEEN 35 AND 37 AND p_lon > -114.9 THEN 'Boulder City' END $$;

-- a: public, owned by bbbb…; b: private. Photos of a (cell = point rounded to 0.001):
--   1,2 day 1 Boulder City, cell 35.973/-114.856 (ZCTA 89005); 3 day 1 Boulder City, cell 35.990/-114.850 (89012);
--   4 day 1 elsewhere in Clark, cell 36.100/-115.200 (no ZCTA); 5 day 2, cell 36.020/-114.960 (89011 and 89015 overlap);
--   6 day 3 in Maricopa (its file is missing). b: 7 in Boulder City.
INSERT INTO vehicles(id, is_public, owner_id) VALUES ('a0000000-0000-0000-0000-00000000000a', true, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('b0000000-0000-0000-0000-00000000000b', false, NULL);
INSERT INTO vehicle_images(id, vehicle_id, image_url, taken_at, latitude, longitude) VALUES
 ('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','u1','2026-10-06 15:00Z',35.97261,-114.85575),
 ('10000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a','u2','2026-10-06 18:00Z',35.97301,-114.85601),
 ('10000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-00000000000a','u3','2026-10-06 19:00Z',35.99012,-114.85002),
 ('10000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-00000000000a','u4','2026-10-06 20:00Z',36.10000,-115.20000),
 ('10000000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-00000000000a','u5','2026-10-07 01:00Z',36.02010,-114.96020),
 ('10000000-0000-0000-0000-000000000006','a0000000-0000-0000-0000-00000000000a','u6','2026-10-08 01:00Z',33.50000,-112.00000),
 ('10000000-0000-0000-0000-000000000007','b0000000-0000-0000-0000-00000000000b','u7','2026-10-06 16:00Z',35.97261,-114.85575);

-- Rows on file before the ZIP key: 4 (day 1 Boulder City, day 1 Clark, day 2 Clark, day 3 Maricopa), no zcta.
CREATE TEMP TABLE r(step text, out jsonb);
INSERT INTO r SELECT 'legacy', admit_photo_gps_locations(NULL);
CREATE TEMP TABLE legacy AS SELECT id, metadata->>'utc_day' AS day, county_fips, city FROM vehicle_location_observations WHERE source_type = 'exif';
SELECT t_assert((SELECT count(*) FROM legacy) = 4 AND (SELECT out->>'inserted' FROM r WHERE step = 'legacy') = '4',
  'before: 4 photo rows without zcta');

-- The fold as live is SQL from 20261116012000 (md5 checked in test_field_provenance_photo_location.sql); here a
-- stand-in carrying the 029000 marker lets the guard pass, and 029000 replaces it with the full body.
CREATE FUNCTION public.vehicle_location_fold(p_vehicle_id uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb /* zcta_point_v1 stand-in */ $$;
REVOKE ALL ON FUNCTION public.vehicle_location_fold(uuid) FROM PUBLIC, anon, authenticated;

\ir ../migrations/20261116021000_geo_cell_zcta_keyer.sql
\ir ../migrations/20261116021000_geo_cell_zcta_keyer.sql
-- PostGIS stand-in with the same contract: a feature covers a cell when the cell lies in its outer ring's box.
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
\ir ../migrations/20261116029000_photo_gps_zcta_admission.sql
\ir ../migrations/20261116029000_photo_gps_zcta_admission.sql

SELECT t_assert(NOT has_table_privilege('anon', 'public.geo_cell_zcta', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.geo_cell_zcta', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.geo_zcta_county_loads', 'SELECT')
  AND NOT has_function_privilege('anon', 'public.key_geo_cells_zcta(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.key_geo_cells_zcta(integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.geo_zcta_key_cells(text,jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.key_geo_cells_zcta(integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admit_photo_gps_locations(uuid)', 'EXECUTE'),
  'cells, ledger, keyer: service_role only');

-- Run 1: every cell is new, so both counties are requested and nothing is replaced or withdrawn.
INSERT INTO r SELECT 'run1', admit_photo_gps_locations(NULL);
SELECT t_assert((SELECT out->>'inserted' = '0' AND out->>'withdrawn' = '0' AND out->>'photos_held_zcta_pending' = '6'
    AND out->'zcta_keyer'->>'counties_requested' = '2' FROM r WHERE step = 'run1'),
  'run 1: 6 photos wait for their ZIP; nothing inserted or withdrawn');
SELECT t_assert((SELECT count(*) FROM vehicle_location_observations WHERE source_type = 'exif' AND confidence >= 0.5) = 4,
  'run 1: the 4 rows on file still stand');
SELECT t_assert((SELECT array_agg(url ORDER BY url) FROM net.http_request_queue)
  = ARRAY['https://project.invalid/storage/v1/object/public/map-data/geo/v1/county/04013.geojson',
          'https://project.invalid/storage/v1/object/public/map-data/geo/v1/county/32003.geojson']
  AND (SELECT bool_and(timeout_milliseconds = 30000) FROM net.http_request_queue),
  'run 1: one GET per county from the public map-data files, 30 s');
SELECT t_assert((SELECT count(*) FROM geo_cell_zcta WHERE status = 'pending') = 5
  AND (SELECT count(*) FROM geo_cell_zcta) = 5, 'run 1: 5 cells pending (photos 1 and 2 share one)');

-- The files arrive: Clark with four shapes (89011 and 89015 overlap), Maricopa missing.
INSERT INTO net._http_response(id, status_code, content) SELECT q.id, 200,
 '{"type":"FeatureCollection","features":[
   {"type":"Feature","properties":{"GEOID":"89005"},"geometry":{"type":"Polygon","coordinates":[[[-114.90,35.95],[-114.80,35.95],[-114.80,35.98],[-114.90,35.98],[-114.90,35.95]]]}},
   {"type":"Feature","properties":{"GEOID":"89012"},"geometry":{"type":"Polygon","coordinates":[[[-114.90,35.98],[-114.80,35.98],[-114.80,36.00],[-114.90,36.00],[-114.90,35.98]]]}},
   {"type":"Feature","properties":{"GEOID":"89011"},"geometry":{"type":"Polygon","coordinates":[[[-115.00,36.00],[-114.95,36.00],[-114.95,36.05],[-115.00,36.05],[-115.00,36.00]]]}},
   {"type":"Feature","properties":{"GEOID":"89015"},"geometry":{"type":"Polygon","coordinates":[[[-114.98,36.00],[-114.93,36.00],[-114.93,36.05],[-114.98,36.05],[-114.98,36.00]]]}}]}'
FROM net.http_request_queue q WHERE q.url LIKE '%32003.geojson';
INSERT INTO net._http_response(id, status_code, content)
SELECT q.id, 404, '{"error":"not found"}' FROM net.http_request_queue q WHERE q.url LIKE '%04013.geojson';

-- Run 2: cells keyed; the Boulder City day splits by ZIP and replaces its row; the others keep their ids.
INSERT INTO r SELECT 'run2', admit_photo_gps_locations(NULL);
SELECT t_assert((SELECT out->'zcta_keyer'->>'counties_loaded' = '1' AND out->'zcta_keyer'->>'counties_failed' = '1'
    AND out->'zcta_keyer'->>'cells_keyed' = '4' AND out->'zcta_keyer'->>'cells_no_source' = '1'
    AND out->'zcta_keyer'->>'counties_requested' = '0' AND out->>'photos_held_zcta_pending' = '0' FROM r WHERE step = 'run2'),
  'run 2: Clark loaded (4 cells), Maricopa failed (1 cell no_source), nothing held');
SELECT t_assert((SELECT jsonb_object_agg(cell_lat || '/' || cell_lng, jsonb_build_array(status, zcta, candidates)) FROM geo_cell_zcta)
  = '{"35.973/-114.856":["keyed","89005",1],"35.990/-114.850":["keyed","89012",1],"36.100/-115.200":["no_zcta",null,0],
      "36.020/-114.960":["ambiguous",null,2],"33.500/-112.000":["no_source",null,null]}'::jsonb
  AND (SELECT count(*) FROM geo_cell_zcta WHERE keyed_at IS NULL) = 0
  AND (SELECT status = 'failed' AND http_status = 404 AND error = 'HTTP 404' FROM geo_zcta_county_loads WHERE county_fips = '04013')
  AND (SELECT status = 'loaded' AND features = 4 FROM geo_zcta_county_loads WHERE county_fips = '32003'),
  'run 2: one ZCTA, none, two (ambiguous, no tie-break), and no source; ledger records both counties');
SELECT t_assert((SELECT out->>'inserted' = '2' AND out->>'withdrawn' = '1' AND out->>'rows_with_zcta' = '2'
    AND out->>'rows_current' = '5' FROM r WHERE step = 'run2'),
  'run 2: 2 ZIP rows inserted, the unkeyed Boulder City row withdrawn, 5 rows current');
CREATE TEMP VIEW exif AS SELECT * FROM vehicle_location_observations WHERE source_type = 'exif';
SELECT t_assert((SELECT jsonb_object_agg(zcta, jsonb_build_array(city, (metadata->>'photos')::int, metadata->'image_ids')) FROM exif
    WHERE zcta IS NOT NULL AND confidence >= 0.5)
  = '{"89005":["Boulder City",2,["10000000-0000-0000-0000-000000000001","10000000-0000-0000-0000-000000000002"]],
      "89012":["Boulder City",1,["10000000-0000-0000-0000-000000000003"]]}'::jsonb,
  'run 2: day 1 Boulder City is two ZIP rows with their photos');
SELECT t_assert((SELECT bool_and(id = md5(concat_ws('|', 'photo_gps_fold_v1', vehicle_id, metadata->>'utc_day', county_fips,
    lower(coalesce(city, '')), zcta))::uuid AND metadata->'area_key'->>'zcta' LIKE 'photo_gps_zcta_v1: cell centre (0.001 deg)%')
  FROM exif WHERE zcta IS NOT NULL), 'ZIP rows: id = md5(method, vehicle, day, county, city, zcta); the method is stamped');
SELECT t_assert((SELECT confidence = 0 AND metadata->>'withdrawn_reason' = 'replaced by the rows of the same day and area keyed by ZIP (zcta)'
    AND (metadata->>'prior_confidence')::real = 0.7::real
  FROM exif e JOIN legacy l USING (id) WHERE l.city = 'Boulder City'), 'the replaced row is kept, withdrawn, with the reason');
SELECT t_assert((SELECT count(*) FROM exif e JOIN legacy l USING (id) WHERE l.city IS NULL AND e.confidence >= 0.5 AND e.zcta IS NULL) = 3,
  'rows without a ZCTA (none, ambiguous, no source) keep their ids and stand');
SELECT t_assert((SELECT jsonb_object_agg(metadata->>'utc_day', metadata->'zcta_unkeyed') FROM exif WHERE zcta IS NULL AND confidence >= 0.5)
  = '{"2026-10-06":["no_zcta"],"2026-10-07":["ambiguous"],"2026-10-08":["no_source"]}'::jsonb
  AND (SELECT bool_and(metadata->'area_key' ? 'zcta' AND metadata->'area_key'->'zcta' = 'null'::jsonb) FROM exif WHERE zcta IS NULL AND confidence >= 0.5),
  'rows without a ZCTA say why');
SELECT t_assert((SELECT bool_and(latitude IS NULL AND longitude IS NULL AND postal_code IS NULL) FROM exif)
  AND (SELECT count(*) FROM exif WHERE vehicle_id = 'b0000000-0000-0000-0000-00000000000b') = 0,
  'still no point and no postal code; the private vehicle has nothing');

-- Run 3: a no-op.
INSERT INTO r SELECT 'run3', admit_photo_gps_locations(NULL);
SELECT t_assert((SELECT out->>'inserted' = '0' AND out->>'updated' = '0' AND out->>'withdrawn' = '0'
    AND out->'zcta_keyer'->>'counties_requested' = '0' FROM r WHERE step = 'run3')
  AND (SELECT count(*) FROM net.http_request_queue) = 2, 'run 3: no change, no request');

-- Run 4: a new photo in a new Clark cell (day 4) and photo 3 turns sensitive. Clark is fetched again; vehicle a's Clark
-- rows are held this run (the 89012 row is not yet withdrawn); the new photo waits.
INSERT INTO vehicle_images(id, vehicle_id, image_url, taken_at, latitude, longitude) VALUES
 ('10000000-0000-0000-0000-000000000008','a0000000-0000-0000-0000-00000000000a','u8','2026-10-09 01:00Z',35.96012,-114.85002);
UPDATE vehicle_images SET is_sensitive = true WHERE id = '10000000-0000-0000-0000-000000000003';
INSERT INTO r SELECT 'run4', admit_photo_gps_locations(NULL);
SELECT t_assert((SELECT out->>'inserted' = '0' AND out->>'withdrawn' = '0' AND out->>'photos_held_zcta_pending' = '1'
    AND out->'zcta_keyer'->>'counties_requested' = '1' FROM r WHERE step = 'run4')
  AND (SELECT status = 'requested' AND attempts = 1 FROM geo_zcta_county_loads WHERE county_fips = '32003')
  AND (SELECT confidence >= 0.5 FROM exif WHERE zcta = '89012'),
  'run 4: Clark re-requested; its rows for vehicle a held, nothing withdrawn yet');

-- The re-fetch times out: run 5 retries (attempt 2) and still holds.
INSERT INTO net._http_response(id, status_code, content, timed_out, error_msg)
SELECT max(id), NULL, NULL, true, 'Timeout was reached' FROM net.http_request_queue;
INSERT INTO r SELECT 'run5', admit_photo_gps_locations(NULL);
SELECT t_assert((SELECT out->'zcta_keyer'->>'counties_retry' = '1' AND out->'zcta_keyer'->>'counties_requested' = '1'
    AND out->>'withdrawn' = '0' FROM r WHERE step = 'run5')
  AND (SELECT status = 'requested' AND attempts = 2 FROM geo_zcta_county_loads WHERE county_fips = '32003'),
  'run 5: a timeout is retried (attempt 2)');

-- The file arrives: run 6 keys the new cell, admits day 4, withdraws the 89012 row.
INSERT INTO net._http_response(id, status_code, content)
SELECT (SELECT max(id) FROM net.http_request_queue), 200, h.content FROM net._http_response h WHERE h.status_code = 200 LIMIT 1;
INSERT INTO r SELECT 'run6', admit_photo_gps_locations(NULL);
SELECT t_assert((SELECT out->>'inserted' = '1' AND out->>'withdrawn' = '1' AND out->>'photos_held_zcta_pending' = '0' FROM r WHERE step = 'run6')
  AND (SELECT confidence = 0 AND metadata->>'withdrawn_reason' = 'no eligible photo places the vehicle in this area on this UTC day'
       FROM exif WHERE zcta = '89012')
  AND (SELECT zcta = '89005' AND confidence >= 0.5 FROM exif WHERE metadata->>'utc_day' = '2026-10-09'),
  'run 6: the new cell keyed (day 4 in 89005); the 89012 row withdrawn');

-- The fold: two ZIP areas of one city each get their own point for the tied viewer.
UPDATE vehicle_images SET is_sensitive = false WHERE id = '10000000-0000-0000-0000-000000000003';
INSERT INTO r SELECT 'run7', admit_photo_gps_locations(NULL);
SELECT t_assert((SELECT confidence >= 0.5 FROM exif WHERE zcta = '89012'), 'photo 3 back: the 89012 row re-admitted');
SET test.auth_uid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
SELECT t_assert((SELECT jsonb_object_agg(a->>'zcta', a->'point') FROM jsonb_array_elements(vehicle_location_fold('a0000000-0000-0000-0000-00000000000a')->'areas') a
    WHERE a->>'city' = 'Boulder City')
  = '{"89005":{"lat":35.9686,"lng":-114.8539,"photos":3},"89012":{"lat":35.9901,"lng":-114.8500,"photos":1}}'::jsonb,
  'fold: each Boulder City ZIP area has its own photos'' point');
SET test.auth_uid = '';
SELECT t_assert((SELECT bool_and(a->'point' = 'null'::jsonb) FROM jsonb_array_elements(vehicle_location_fold('a0000000-0000-0000-0000-00000000000a')->'areas') a),
  'fold: no point for a viewer who is not tied');
SELECT 'PASS: photo-GPS ZIP key (geo_cell_zcta keyer and admission)' AS result;
