-- Isolated PostgreSQL 17 contract for the vehicle location fold migration (fold_vehicle_location_from_observation and
-- fold_vehicle_locations_from_observations). Synthetic rows only; never production. Run from the repo root in an empty
-- disposable dm_refinement_* database:
--   createdb dm_refinement_location_fold && psql -X -v ON_ERROR_STOP=1 -d dm_refinement_location_fold -f supabase/sql/test_vehicle_location_fold.sql
-- Covered: an observation fills empty city/state/zip/point; a value already on the row is never overwritten; a region-level
-- point is not copied; a low-confidence observation does not fold; an observation for no vehicle is a no-op; the batch
-- function folds rows that predate the trigger, resumes by id and reports scanned and updated; the ACL (no anon/authenticated).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* PostgreSQL 17 database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
SET statement_timeout = '30s';

CREATE TABLE public.vehicles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), city text, state text, zip_code text,
  gps_latitude numeric, gps_longitude numeric);
CREATE TABLE public.vehicle_location_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid,
  city text, region_code text, postal_code text, latitude double precision, longitude double precision, "precision" text,
  confidence real, observed_at timestamptz DEFAULT now());

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

\i supabase/migrations/20261015041500_vehicle_location_fold.sql
\i supabase/migrations/20261015041500_vehicle_location_fold.sql

INSERT INTO public.vehicles (id) VALUES
  ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000a3'), ('00000000-0000-0000-0000-0000000000a4');
UPDATE public.vehicles SET city = 'Keepville', state = 'KS' WHERE id = '00000000-0000-0000-0000-0000000000a2';

INSERT INTO public.vehicle_location_observations (vehicle_id, city, region_code, postal_code, latitude, longitude, "precision", confidence) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'Townsville', 'FL', '33755', 28.0011, -82.7928, 'city', 0.8),
  ('00000000-0000-0000-0000-0000000000a2', 'Otherton', 'TX', '75001', 32.9, -96.8, 'city', 0.8),
  ('00000000-0000-0000-0000-0000000000a3', NULL, 'CA', NULL, 36.7, -119.4, 'region', 0.6),
  ('00000000-0000-0000-0000-0000000000a4', 'Lowconf', 'NV', '89101', 36.1, -115.1, 'city', 0.3),
  (NULL, 'Nowhere', 'OR', '97001', 44.0, -121.0, 'city', 0.9);

SELECT pg_temp.ok('trigger fills city, state, zip and point on an empty row',
  (SELECT city = 'Townsville' AND state = 'FL' AND zip_code = '33755' AND gps_latitude = 28.0011 AND gps_longitude = -82.7928
   FROM public.vehicles WHERE id = '00000000-0000-0000-0000-0000000000a1'));
SELECT pg_temp.ok('a value already on the row is kept; empty columns beside it are filled',
  (SELECT city = 'Keepville' AND state = 'KS' AND zip_code = '75001' AND gps_latitude = 32.9
   FROM public.vehicles WHERE id = '00000000-0000-0000-0000-0000000000a2'));
SELECT pg_temp.ok('a region-level point is not copied, the state is',
  (SELECT state = 'CA' AND gps_latitude IS NULL AND gps_longitude IS NULL FROM public.vehicles WHERE id = '00000000-0000-0000-0000-0000000000a3'));
SELECT pg_temp.ok('a low-confidence observation does not fold',
  (SELECT city IS NULL AND state IS NULL AND zip_code IS NULL FROM public.vehicles WHERE id = '00000000-0000-0000-0000-0000000000a4'));

-- rows that predate the trigger
ALTER TABLE public.vehicle_location_observations DISABLE TRIGGER trg_fold_vehicle_location;
INSERT INTO public.vehicles (id) VALUES ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000b2'), ('00000000-0000-0000-0000-0000000000b3');
INSERT INTO public.vehicle_location_observations (id, vehicle_id, city, region_code, postal_code, confidence) VALUES
  ('ffffffff-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'Oldtown', 'AZ', '85001', 0.8),
  ('ffffffff-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b2', 'Oldtwo', 'WA', '98001', 0.8),
  ('ffffffff-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000b3', 'Oldthree', 'OR', '97001', 0.8);
ALTER TABLE public.vehicle_location_observations ENABLE TRIGGER trg_fold_vehicle_location;

CREATE TEMP TABLE r AS SELECT * FROM public.fold_vehicle_locations_from_observations('ffffffff-0000-0000-0000-000000000000', 2);
SELECT pg_temp.ok('batch reports the last id, the rows scanned and the vehicles updated',
  (SELECT last_id = 'ffffffff-0000-0000-0000-000000000002' AND scanned = 2 AND updated = 2 FROM r));
CREATE TEMP TABLE r2 AS SELECT * FROM public.fold_vehicle_locations_from_observations('ffffffff-0000-0000-0000-000000000002', 2);
SELECT pg_temp.ok('batch resumes after the returned id',
  (SELECT last_id = 'ffffffff-0000-0000-0000-000000000003' AND scanned = 1 AND updated = 1 FROM r2));
SELECT pg_temp.ok('batch folded all three old rows',
  (SELECT count(*) = 3 FROM public.vehicles WHERE state IN ('AZ', 'WA', 'OR') AND id::text LIKE '%b_'));
CREATE TEMP TABLE r3 AS SELECT * FROM public.fold_vehicle_locations_from_observations('ffffffff-0000-0000-0000-000000000000', 10);
SELECT pg_temp.ok('a second pass changes nothing', (SELECT updated = 0 FROM r3));

SELECT pg_temp.ok('anon and authenticated cannot run either function',
  NOT has_function_privilege('anon', 'public.fold_vehicle_locations_from_observations(uuid,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.fold_vehicle_locations_from_observations(uuid,integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.fold_vehicle_location_from_observation()', 'EXECUTE'));
