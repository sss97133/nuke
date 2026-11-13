-- Disposable PG17 only. Proves 20261116001000_photo_gps_location_admission.sql: a public vehicle's eligible photo GPS
-- lands as one area-grain row per (vehicle, UTC day, area) with no point and no ZIP; re-runs are no-ops; a photo
-- marked sensitive, superseded or refiled, or a vehicle made private, withdraws the rows it supported (confidence 0,
-- kept, never deleted) and its return re-admits the same id; private vehicles and photos outside US counties are never
-- admitted; photo rows do not stamp the vehicle row while listing rows still do; only service_role can run the writer.
-- PostGIS is not in this database: photo_gps_area is replaced after the migration by a stub with the same contract.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_location_observations') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable PG17 database required';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.vehicles(id uuid PRIMARY KEY, is_public boolean, deleted_at timestamptz, city text, state text,
  zip_code text, gps_latitude double precision, gps_longitude double precision);
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
INSERT INTO us_states VALUES ('32', 'NV', 'Nevada');
INSERT INTO us_county_boundaries VALUES ('32003', 'Clark', '32');

CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE FUNCTION public.t_refused(q text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_refused(text) TO anon, authenticated, service_role;

\ir ../migrations/20261116001000_photo_gps_location_admission.sql
\ir ../migrations/20261116001000_photo_gps_location_admission.sql

-- The fold trigger as production has it (20261015041500), on the function the migration replaced.
CREATE TRIGGER trg_fold_vehicle_location AFTER INSERT ON public.vehicle_location_observations FOR EACH ROW
  WHEN (NEW.vehicle_id IS NOT NULL AND COALESCE(NEW.confidence, 1) >= 0.5)
  EXECUTE FUNCTION public.fold_vehicle_location_from_observation();

-- Geography stub: latitude 35..37 is Clark County NV; east of -114.9 is near Boulder City, else no city nearby.
CREATE OR REPLACE FUNCTION public.photo_gps_area(p_lon double precision, p_lat double precision)
RETURNS TABLE (county_fips text, county_name text, region_code text, city text) LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_lat BETWEEN 35 AND 37 THEN '32003' END, CASE WHEN p_lat BETWEEN 35 AND 37 THEN 'Clark' END,
         CASE WHEN p_lat BETWEEN 35 AND 37 THEN 'NV' END,
         CASE WHEN p_lat BETWEEN 35 AND 37 AND p_lon > -114.9 THEN 'Boulder City' END $$;

-- a: public vehicle, no place stated. b: private vehicle. Photos of a:
--   1,2 day 1 in Boulder City; 3 day 1 elsewhere in Clark (county only); 4 day 2 Boulder City; 5 abroad (no county);
--   6 sensitive; 7 no taken_at; 8 gated review_needed; 9 mismatch. b: 10 in Boulder City.
INSERT INTO vehicles(id, is_public) VALUES ('a0000000-0000-0000-0000-00000000000a', true), ('b0000000-0000-0000-0000-00000000000b', false);
INSERT INTO vehicle_images(id, vehicle_id, image_url, taken_at, latitude, longitude, is_sensitive, vision_gate_status, image_vehicle_match_status) VALUES
 ('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','u1','2026-10-06 15:00Z',35.97261,-114.85575,false,NULL,NULL),
 ('10000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a','u2','2026-10-06 18:00Z',35.97301,-114.85601,false,'approved',NULL),
 ('10000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-00000000000a','u3','2026-10-06 20:00Z',36.10000,-115.20000,false,NULL,NULL),
 ('10000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-00000000000a','u4','2026-10-07 01:00Z',35.97261,-114.85575,false,NULL,NULL),
 ('10000000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-00000000000a','u5','2026-10-08 01:00Z',48.85000,2.35000,false,NULL,NULL),
 ('10000000-0000-0000-0000-000000000006','a0000000-0000-0000-0000-00000000000a','u6','2026-10-06 16:00Z',35.97261,-114.85575,true,NULL,NULL),
 ('10000000-0000-0000-0000-000000000007','a0000000-0000-0000-0000-00000000000a','u7',NULL,35.97261,-114.85575,false,NULL,NULL),
 ('10000000-0000-0000-0000-000000000008','a0000000-0000-0000-0000-00000000000a','u8','2026-10-06 16:00Z',35.97261,-114.85575,false,'review_needed',NULL),
 ('10000000-0000-0000-0000-000000000009','a0000000-0000-0000-0000-00000000000a','u9','2026-10-06 16:00Z',35.97261,-114.85575,false,NULL,'mismatch'),
 ('10000000-0000-0000-0000-000000000010','b0000000-0000-0000-0000-00000000000b','u10','2026-10-06 16:00Z',35.97261,-114.85575,false,NULL,NULL);
-- A listing row already on file for a: the writer must never touch it.
INSERT INTO vehicle_location_observations(id, vehicle_id, source_type, source_platform, city, region_code, "precision", confidence)
VALUES ('c0000000-0000-0000-0000-00000000000c','b0000000-0000-0000-0000-00000000000b','listing','bat','Reno','NV','city',0.8);
UPDATE vehicles SET city = NULL, state = NULL WHERE id = 'b0000000-0000-0000-0000-00000000000b';

-- Grants: only service_role runs the writer and the area helper.
SELECT t_assert(NOT has_function_privilege('anon','public.admit_photo_gps_locations(uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.admit_photo_gps_locations(uuid)','EXECUTE')
  AND has_function_privilege('service_role','public.admit_photo_gps_locations(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.photo_gps_area(double precision,double precision)','EXECUTE'),
  'writer and area helper: service_role only');

CREATE TEMP TABLE r(step text, out jsonb);
INSERT INTO r SELECT 'first', admit_photo_gps_locations(NULL);
SELECT t_assert((SELECT out->>'photos_eligible' = '5' AND out->>'photos_placed' = '4' AND out->>'photos_unplaced_no_us_county' = '1'
  AND out->>'inserted' = '3' AND out->>'updated' = '0' AND out->>'withdrawn' = '0' FROM r WHERE step = 'first'),
  'first run: 5 eligible photos, 4 placed, 1 abroad; 3 rows (day 1 Boulder City, day 1 county only, day 2 Boulder City)');

CREATE TEMP VIEW exif AS SELECT * FROM vehicle_location_observations WHERE source_type = 'exif';
SELECT t_assert((SELECT count(*) FROM exif WHERE vehicle_id = 'b0000000-0000-0000-0000-00000000000b') = 0, 'private vehicle: nothing admitted');
SELECT t_assert((SELECT bool_and(latitude IS NULL AND longitude IS NULL AND postal_code IS NULL AND zcta IS NULL
    AND county_fips = '32003' AND region_code = 'NV' AND source_platform = 'photo_exif' AND confidence >= 0.5
    AND metadata->>'method' = 'photo_gps_fold_v1'
    AND NOT (metadata ?| ARRAY['latitude','longitude','lat','lng','bbox','point'])) FROM exif),
  'every row: area only (county, state), no point, no ZIP, method stamped');
SELECT t_assert((SELECT city = 'Boulder City' AND "precision" = 'city' AND confidence = 0.7::real AND location_text_clean = 'Boulder City, NV'
    AND (metadata->>'photos')::int = 2 AND observed_at = '2026-10-06 18:00Z' AND metadata->>'utc_day' = '2026-10-06'
    AND (metadata->>'first_taken_at')::timestamptz = '2026-10-06 15:00Z'
    AND metadata->'image_ids' = '["10000000-0000-0000-0000-000000000001","10000000-0000-0000-0000-000000000002"]'::jsonb
  FROM exif WHERE metadata->>'utc_day' = '2026-10-06' AND city IS NOT NULL),
  'day 1 Boulder City: 2 photos, observed_at = last taken_at, ids listed; sensitive, undated, gated and mismatched photos excluded');
SELECT t_assert((SELECT city IS NULL AND "precision" = 'county' AND confidence = 0.8::real AND location_text_clean = 'Clark, NV'
  FROM exif WHERE metadata->>'utc_day' = '2026-10-06' AND city IS NULL), 'day 1 elsewhere in Clark: county grain');
SELECT t_assert((SELECT city IS NULL AND state IS NULL AND zip_code IS NULL AND gps_latitude IS NULL FROM vehicles
  WHERE id = 'a0000000-0000-0000-0000-00000000000a'), 'photo rows do not stamp the vehicle row');
SELECT t_assert((SELECT count(*) FROM write_receipts WHERE writer = 'admit_photo_gps_locations' AND op = 'INSERT' AND rows = 3) = 1,
  'insert receipted');

INSERT INTO r SELECT 'again', admit_photo_gps_locations(NULL);
SELECT t_assert((SELECT out->>'inserted' = '0' AND out->>'updated' = '0' AND out->>'withdrawn' = '0' FROM r WHERE step = 'again')
  AND (SELECT count(*) FROM exif) = 3, 're-run: no change');
INSERT INTO r SELECT 'one', admit_photo_gps_locations('a0000000-0000-0000-0000-00000000000a');
SELECT t_assert((SELECT out->>'inserted' = '0' AND out->>'updated' = '0' AND out->>'withdrawn' = '0' FROM r WHERE step = 'one'),
  'one-vehicle run agrees with the fleet run');

-- Withdrawal: photo 4 (day 2's only photo) marked sensitive; photo 2 superseded (day 1 keeps photo 1).
UPDATE vehicle_images SET is_sensitive = true WHERE id = '10000000-0000-0000-0000-000000000004';
UPDATE vehicle_images SET is_superseded = true WHERE id = '10000000-0000-0000-0000-000000000002';
INSERT INTO r SELECT 'withdraw', admit_photo_gps_locations(NULL);
SELECT t_assert((SELECT out->>'inserted' = '0' AND out->>'updated' = '1' AND out->>'withdrawn' = '1' FROM r WHERE step = 'withdraw'),
  'sensitive + superseded: day 1 updated, day 2 withdrawn');
SELECT t_assert((SELECT confidence = 0 AND metadata ? 'withdrawn_at' AND (metadata->>'prior_confidence')::real = 0.7::real
  FROM exif WHERE metadata->>'utc_day' = '2026-10-07'), 'day 2 kept with confidence 0 and withdrawn_at (below every reader''s 0.5 floor)');
SELECT t_assert((SELECT (metadata->>'photos')::int = 1 AND observed_at = '2026-10-06 15:00Z'
    AND metadata->'image_ids' = '["10000000-0000-0000-0000-000000000001"]'::jsonb
  FROM exif WHERE metadata->>'utc_day' = '2026-10-06' AND city IS NOT NULL), 'day 1 drops the superseded photo');
SELECT t_assert((SELECT count(*) FROM exif) = 3, 'nothing deleted');

-- Re-admission under the same id.
UPDATE vehicle_images SET is_sensitive = false WHERE id = '10000000-0000-0000-0000-000000000004';
INSERT INTO r SELECT 'readmit', admit_photo_gps_locations(NULL);
SELECT t_assert((SELECT out->>'inserted' = '0' AND out->>'updated' = '1' AND out->>'withdrawn' = '0' FROM r WHERE step = 'readmit')
  AND (SELECT confidence = 0.7::real AND NOT metadata ? 'withdrawn_at' AND metadata ? 'readmitted_at'
        AND jsonb_array_length(metadata->'withdrawn_history') = 1 FROM exif WHERE metadata->>'utc_day' = '2026-10-07'),
  'photo returns: same row re-admitted, withdrawal kept in history');
INSERT INTO r SELECT 'stable', admit_photo_gps_locations(NULL);
SELECT t_assert((SELECT out->>'updated' = '0' AND out->>'withdrawn' = '0' FROM r WHERE step = 'stable')
  AND (SELECT metadata ? 'withdrawn_history' FROM exif WHERE metadata->>'utc_day' = '2026-10-07'),
  'after re-admission a re-run is a no-op and history stays');

-- The back-fill fold skips photo rows (a has only photo rows) and still folds listing rows (b's Reno row).
CREATE TEMP TABLE backfill AS SELECT * FROM fold_vehicle_locations_from_observations(NULL, 1000);
SELECT t_assert((SELECT updated FROM backfill) = 1
  AND (SELECT city FROM vehicles WHERE id = 'b0000000-0000-0000-0000-00000000000b') = 'Reno'
  AND (SELECT city IS NULL AND state IS NULL FROM vehicles WHERE id = 'a0000000-0000-0000-0000-00000000000a'),
  'back-fill fold: photo rows skipped, listing rows folded');

-- Vehicle made private: every row withdrawn, none deleted; the listing row untouched.
UPDATE vehicles SET is_public = false WHERE id = 'a0000000-0000-0000-0000-00000000000a';
INSERT INTO r SELECT 'private', admit_photo_gps_locations(NULL);
SELECT t_assert((SELECT out->>'withdrawn' = '3' FROM r WHERE step = 'private')
  AND (SELECT count(*) FROM exif WHERE confidence >= 0.5) = 0 AND (SELECT count(*) FROM exif) = 3,
  'vehicle made private: all rows withdrawn, none deleted');
SELECT t_assert((SELECT confidence = 0.8::real AND metadata = '{}'::jsonb FROM vehicle_location_observations
  WHERE id = 'c0000000-0000-0000-0000-00000000000c'), 'listing row untouched');

-- The fold still serves listing rows.
INSERT INTO vehicle_location_observations(vehicle_id, source_type, source_platform, city, region_code, "precision", confidence)
VALUES ('a0000000-0000-0000-0000-00000000000a','listing','bat','Las Vegas','NV','city',0.8);
SELECT t_assert((SELECT city = 'Las Vegas' AND state = 'NV' FROM vehicles WHERE id = 'a0000000-0000-0000-0000-00000000000a'),
  'listing rows still fold into the vehicle row');
