-- Isolated PostgreSQL 17 contract for 20261007213000_key_vehicle_location_county_from_zip.sql. Synthetic rows only; never
-- production. Run in an empty, disposable dm_refinement_* database:
--   createdb dm_refinement_county_key_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_county_key_ci -f supabase/sql/test_key_vehicle_location_county_from_zip.sql
-- Fixtures carry the live shapes read from prod on 2026-10-07 after 20261007210000: us_county_boundaries (geom as text),
-- zip_to_fips with its NOT VALID key, the columns of vehicle_location_observations the writers touch with the NOT VALID key
-- on county_fips, write_receipts and pipeline_registry. Supabase's default function privileges are set first so the
-- migration's REVOKE is exercised.
-- Covered: the trigger keys a US ZIP (and ZIP+4) with name and method; leaves alone a row with a county already, a row with
-- no state code, a non-ZIP postal code, an unknown ZIP and a ZIP onto a retired code (never raising, never writing a code
-- the key refuses); keys an uncoded row when its postal code is set later; the back-fill keys only eligible rows, honours
-- the batch, records one receipt per call under its writer, restores app.writer, refuses a bad batch, is idempotent, and
-- is callable by service_role only; the registry rows and comments; a re-apply that changes nothing.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR to_regclass('public.vehicle_location_observations') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';
SET TimeZone = 'UTC';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
CREATE FUNCTION pg_temp.fails(label text, stmt text, want_state text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text;
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    got := SQLSTATE;
    IF got <> want_state THEN RAISE EXCEPTION 'Contract failed: % raised % (%), wanted %', label, got, SQLERRM, want_state; END IF;
    RAISE NOTICE 'PASS % (refused %: %)', label, got, SQLERRM;
    RETURN;
  END;
  RAISE EXCEPTION 'Contract failed: % was admitted', label;
END $$;

-- Live shapes ------------------------------------------------------------------------------------------------------------
CREATE TABLE public.us_county_boundaries (
  fips text PRIMARY KEY CHECK (fips ~ '^[0-9]{5}$'), name text, state_fips text CHECK (state_fips = left(fips, 2)), geom text);
CREATE TABLE public.zip_to_fips (zip text PRIMARY KEY, fips text);
CREATE TABLE public.vehicle_location_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid,
  source_type text,
  source_platform text,
  observed_at timestamptz,
  location_text_raw text,
  region_code text,
  city text,
  postal_code text,
  latitude double precision,
  longitude double precision,
  precision text,
  confidence real,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  county_fips text,
  county_name text);
CREATE INDEX idx_vlo_county_fips ON public.vehicle_location_observations (county_fips) WHERE county_fips IS NOT NULL;
CREATE TABLE public.write_receipts (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), tbl text NOT NULL, op text NOT NULL, rows integer,
  writer text, db_role text, app_name text, txid bigint);
CREATE TABLE public.pipeline_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, column_name text,
  owned_by text NOT NULL, description text NOT NULL, valid_values text[],
  do_not_write_directly boolean NOT NULL DEFAULT false, write_via text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_name, column_name));
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via) VALUES
  ('vehicle_location_observations', NULL, 'extract-bat-core', 'Dated location testimony per vehicle and source.', true,
   'extract-bat-core, extract-cars-and-bids-core and process-cl-queue insert at read time; scripts/geocode-backfill.mjs upserts geocodes.');

-- Reference rows: three counties, ZIPs onto them, a ZIP+4-able ZIP, and a ZIP onto a retired code ----------------------------
INSERT INTO public.us_county_boundaries (fips, name, state_fips, geom) VALUES
  ('32003', 'Clark', '32', 'g'), ('06037', 'Los Angeles', '06', 'g'), ('48201', 'Harris', '48', 'g');
INSERT INTO public.zip_to_fips (zip, fips) VALUES
  ('89101', '32003'), ('90012', '06037'), ('77002', '48201'), ('33101', '12025');
-- Rows that arrived before the trigger: the back-fill's material -----------------------------------------------------------
INSERT INTO public.vehicle_location_observations (id, source_platform, location_text_raw, region_code, city, postal_code, metadata, created_at) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'bat', 'Las Vegas, Nevada 89101', 'NV', 'Las Vegas', '89101', '{}', '2026-05-01Z'),
  ('00000000-0000-0000-0000-0000000000a2', 'bat', 'Los Angeles, California 90012-1234', 'CA', 'Los Angeles', '90012-1234', NULL, '2026-06-01Z'),
  ('00000000-0000-0000-0000-0000000000a3', 'bat', 'Houston, Texas 77002', 'TX', 'Houston', '77002', '{"k": 1}', '2026-07-01Z'),
  ('00000000-0000-0000-0000-0000000000a4', 'bat', 'Lehre, Wendhausen, Germany 38165', NULL, 'Lehre', '38165', '{}', '2026-07-02Z'),
  ('00000000-0000-0000-0000-0000000000a5', 'bat', 'Miami, Florida 33101', 'FL', 'Miami', '33101', '{}', '2026-07-03Z'),
  ('00000000-0000-0000-0000-0000000000a6', 'bat', 'Nowhere, Ohio 00001', 'OH', 'Nowhere', '00001', '{}', '2026-07-04Z'),
  ('00000000-0000-0000-0000-0000000000a7', 'carsandbids', 'Toronto, ON M5V 1A1', 'ON', 'Toronto', 'M5V 1A1', '{}', '2026-07-05Z');
-- One row coded from coordinates in March (the geocoder's work) and the _none orphan.
INSERT INTO public.vehicle_location_observations (id, source_platform, region_code, postal_code, county_fips, county_name, metadata, created_at) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'bat', 'NV', '89101', '32003', 'Clark', '{}', '2026-03-01Z'),
  ('00000000-0000-0000-0000-0000000000b2', 'bat', NULL, NULL, '_none', NULL, '{}', '2026-03-02Z');
-- The keys 20261007210000 declared, as prod carries them now: the historical orphans above predate them and stay unchecked.
ALTER TABLE public.vehicle_location_observations
  ADD CONSTRAINT vehicle_location_observations_county_fips_fkey FOREIGN KEY (county_fips) REFERENCES public.us_county_boundaries (fips) NOT VALID;
ALTER TABLE public.zip_to_fips
  ADD CONSTRAINT zip_to_fips_fips_fkey FOREIGN KEY (fips) REFERENCES public.us_county_boundaries (fips) NOT VALID;


\ir ../migrations/20261007213000_key_vehicle_location_county_from_zip.sql

-- The migration wrote no row ------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('the migration keyed nothing by itself: the seven uncoded rows are still uncoded',
  (SELECT count(*) FROM public.vehicle_location_observations WHERE county_fips IS NULL) = 7
  AND (SELECT count(*) FROM public.write_receipts) = 0);

-- The trigger at insert --------------------------------------------------------------------------------------------------------
INSERT INTO public.vehicle_location_observations (id, source_platform, location_text_raw, region_code, city, postal_code, metadata) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'bat', 'Henderson, Nevada 89101', 'NV', 'Henderson', '89101', '{}');
SELECT pg_temp.ok('a new US row is keyed at insert: county, name and the method record',
  (SELECT county_fips = '32003' AND county_name = 'Clark'
          AND metadata -> 'county_key' ->> 'method' = 'zip_to_fips'
          AND metadata -> 'county_key' ->> 'zip' = '89101'
          AND metadata -> 'county_key' ->> 'grain' = 'zip'
          AND metadata -> 'county_key' ->> 'writer' = 'trg_key_vehicle_location_county'
          AND (metadata -> 'county_key' ->> 'at')::timestamptz IS NOT NULL
   FROM public.vehicle_location_observations WHERE id = '00000000-0000-0000-0000-0000000000c1'));
INSERT INTO public.vehicle_location_observations (id, region_code, postal_code, metadata) VALUES
  ('00000000-0000-0000-0000-0000000000c2', 'CA', '90012-1234', NULL);
SELECT pg_temp.ok('a ZIP+4 is keyed by its first five digits; NULL metadata becomes the method record alone',
  (SELECT county_fips = '06037' AND metadata -> 'county_key' ->> 'zip' = '90012' AND (SELECT count(*) FROM jsonb_object_keys(metadata)) = 1
   FROM public.vehicle_location_observations WHERE id = '00000000-0000-0000-0000-0000000000c2'));
INSERT INTO public.vehicle_location_observations (id, region_code, postal_code, county_fips, county_name, metadata) VALUES
  ('00000000-0000-0000-0000-0000000000c3', 'TX', '89101', '48201', 'Harris', '{}');
SELECT pg_temp.ok('a row whose writer set county_fips itself is left exactly as written (trigger WHEN false)',
  (SELECT county_fips = '48201' AND county_name = 'Harris' AND metadata = '{}'::jsonb
   FROM public.vehicle_location_observations WHERE id = '00000000-0000-0000-0000-0000000000c3'));
INSERT INTO public.vehicle_location_observations (id, region_code, postal_code, metadata) VALUES
  ('00000000-0000-0000-0000-0000000000c4', NULL, '38165', '{}'),
  ('00000000-0000-0000-0000-0000000000c5', 'ON', 'M5V 1A1', '{}'),
  ('00000000-0000-0000-0000-0000000000c6', 'OH', '00001', '{}'),
  ('00000000-0000-0000-0000-0000000000c7', 'FL', '33101', '{}');
SELECT pg_temp.ok('no state code, a non-ZIP postal code, an unknown ZIP and a ZIP onto a retired code are left uncoded, without error',
  (SELECT count(*) FROM public.vehicle_location_observations
   WHERE id IN ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000c5',
                '00000000-0000-0000-0000-0000000000c6', '00000000-0000-0000-0000-0000000000c7')
     AND county_fips IS NULL AND county_name IS NULL AND metadata = '{}'::jsonb) = 4);
INSERT INTO public.vehicle_location_observations (id, region_code, postal_code, metadata) VALUES
  ('00000000-0000-0000-0000-0000000000c8', 'TX', '77002', '["legacy"]');
SELECT pg_temp.ok('a non-object metadata value is kept under prior beside the method record',
  (SELECT county_fips = '48201' AND metadata -> 'prior' = '["legacy"]'::jsonb AND metadata -> 'county_key' ->> 'method' = 'zip_to_fips'
   FROM public.vehicle_location_observations WHERE id = '00000000-0000-0000-0000-0000000000c8'));

-- The trigger on update of the postal code ---------------------------------------------------------------------------------------
UPDATE public.vehicle_location_observations SET postal_code = '77002', region_code = 'TX' WHERE id = '00000000-0000-0000-0000-0000000000c6';
SELECT pg_temp.ok('an uncoded row is keyed when its postal code is corrected later',
  (SELECT county_fips = '48201' AND county_name = 'Harris' FROM public.vehicle_location_observations WHERE id = '00000000-0000-0000-0000-0000000000c6'));
UPDATE public.vehicle_location_observations SET city = 'Clark County' WHERE id = '00000000-0000-0000-0000-0000000000a1';
SELECT pg_temp.ok('an update of another column does not key an uncoded row (trigger OF list)',
  (SELECT county_fips IS NULL FROM public.vehicle_location_observations WHERE id = '00000000-0000-0000-0000-0000000000a1'));

-- The back-fill writer -------------------------------------------------------------------------------------------------------------
SELECT pg_temp.fails('a batch of 0 is refused', $q$SELECT public.key_vehicle_location_county_from_zip(0)$q$, '22023');
SELECT pg_temp.fails('a batch above 20000 is refused', $q$SELECT public.key_vehicle_location_county_from_zip(20001)$q$, '22023');
SELECT set_config('app.writer', 'contract-caller', false);
CREATE TEMP TABLE r1 AS SELECT public.key_vehicle_location_county_from_zip(2) AS r;
SELECT pg_temp.ok('the back-fill honours the batch: 2 keyed of 3 eligible, one receipt for 2 rows under its writer',
  (SELECT (r ->> 'keyed')::int = 2 AND (r ->> 'batch')::int = 2 AND (r ->> 'ms') IS NOT NULL FROM r1)
  AND (SELECT count(*) FROM public.write_receipts) = 1
  AND (SELECT tbl = 'vehicle_location_observations' AND op = 'UPDATE' AND rows = 2 AND writer = 'key_vehicle_location_county_from_zip'
              AND db_role = current_user AND txid IS NOT NULL FROM public.write_receipts) );
SELECT pg_temp.ok('app.writer is handed back to the caller after the call',
  current_setting('app.writer', true) = 'contract-caller');
CREATE TEMP TABLE r2 AS SELECT public.key_vehicle_location_county_from_zip(5000) AS r;
SELECT pg_temp.ok('the second call keys the last eligible row and no other; a second receipt',
  (SELECT (r ->> 'keyed')::int = 1 FROM r2)
  AND (SELECT count(*) FROM public.write_receipts) = 2
  AND (SELECT count(*) FROM public.vehicle_location_observations
       WHERE id IN ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3')
         AND county_fips IS NOT NULL AND county_name IS NOT NULL
         AND metadata -> 'county_key' ->> 'writer' = 'key_vehicle_location_county_from_zip'
         AND metadata -> 'county_key' ->> 'method' = 'zip_to_fips') = 3);
SELECT pg_temp.ok('the back-fill kept the rows it must not touch: no state, non-ZIP, unknown ZIP, retired code; the March rows; metadata merged not replaced',
  (SELECT count(*) FROM public.vehicle_location_observations
   WHERE id IN ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000a7',
                '00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-0000000000c7')
     AND county_fips IS NULL) = 6
  AND (SELECT county_fips = '32003' AND metadata = '{}'::jsonb FROM public.vehicle_location_observations WHERE id = '00000000-0000-0000-0000-0000000000b1')
  AND (SELECT county_fips = '_none' FROM public.vehicle_location_observations WHERE id = '00000000-0000-0000-0000-0000000000b2')
  AND (SELECT metadata -> 'k' = '1'::jsonb AND metadata -> 'county_key' ->> 'zip' = '77002'
       FROM public.vehicle_location_observations WHERE id = '00000000-0000-0000-0000-0000000000a3'));
CREATE TEMP TABLE r3 AS SELECT public.key_vehicle_location_county_from_zip() AS r;
SELECT pg_temp.ok('a third call finds nothing: idempotent, and no receipt for an empty call',
  (SELECT (r ->> 'keyed')::int = 0 AND (r ->> 'batch')::int = 5000 FROM r3) AND (SELECT count(*) FROM public.write_receipts) = 2);

-- Access -------------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('the back-fill is callable by service_role only',
  has_function_privilege('service_role', 'public.key_vehicle_location_county_from_zip(integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.key_vehicle_location_county_from_zip(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.key_vehicle_location_county_from_zip(integer)', 'EXECUTE'));
SELECT pg_temp.ok('the writer is SECURITY DEFINER with a fixed search_path; the trigger function is not a definer',
  (SELECT prosecdef AND 'search_path=public, pg_temp' = ANY (proconfig) FROM pg_proc WHERE oid = 'public.key_vehicle_location_county_from_zip(integer)'::regprocedure)
  AND (SELECT NOT prosecdef FROM pg_proc WHERE oid = 'public.key_vehicle_location_county()'::regprocedure));

-- Registry rows and comments -------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('registry: county_fips and county_name rows owned by the trigger; the table row names both writers',
  (SELECT count(*) FROM public.pipeline_registry WHERE table_name = 'vehicle_location_observations'
   AND column_name IN ('county_fips', 'county_name') AND owned_by = 'trg_key_vehicle_location_county' AND do_not_write_directly) = 2
  AND (SELECT write_via LIKE '%trg_key_vehicle_location_county%' AND write_via LIKE '%key_vehicle_location_county_from_zip%'
       FROM public.pipeline_registry WHERE table_name = 'vehicle_location_observations' AND column_name IS NULL));
SELECT pg_temp.ok('the trigger, both functions and the two columns carry comments',
  obj_description('public.key_vehicle_location_county()'::regprocedure, 'pg_proc') IS NOT NULL
  AND obj_description('public.key_vehicle_location_county_from_zip(integer)'::regprocedure, 'pg_proc') IS NOT NULL
  AND obj_description((SELECT oid FROM pg_trigger WHERE tgname = 'trg_key_vehicle_location_county'), 'pg_trigger') IS NOT NULL
  AND col_description('public.vehicle_location_observations'::regclass,
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.vehicle_location_observations'::regclass AND attname = 'county_fips')) LIKE '%Two coders%'
  AND col_description('public.vehicle_location_observations'::regclass,
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.vehicle_location_observations'::regclass AND attname = 'county_name')) IS NOT NULL);

-- Re-apply changes nothing -------------------------------------------------------------------------------------------------------
CREATE TEMP TABLE before_reapply AS
  SELECT (SELECT count(*) FROM public.pipeline_registry) AS n_registry,
         (SELECT write_via FROM public.pipeline_registry WHERE table_name = 'vehicle_location_observations' AND column_name IS NULL) AS table_write_via,
         (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.vehicle_location_observations'::regclass AND NOT tgisinternal) AS n_triggers,
         (SELECT count(*) FROM public.write_receipts) AS n_receipts;
\ir ../migrations/20261007213000_key_vehicle_location_county_from_zip.sql
SELECT pg_temp.ok('re-applying the migration adds no registry row, no trigger, no receipt, and appends nothing twice',
  (SELECT n_registry = (SELECT count(*) FROM public.pipeline_registry)
      AND table_write_via = (SELECT write_via FROM public.pipeline_registry WHERE table_name = 'vehicle_location_observations' AND column_name IS NULL)
      AND n_triggers = (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.vehicle_location_observations'::regclass AND NOT tgisinternal)
      AND n_receipts = (SELECT count(*) FROM public.write_receipts)
   FROM before_reapply));

\echo 'county key at intake contract: all checks passed'
