-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_us_zctas_and_zcta_key -f this-file.sql
-- Proves 20261020210000: us_zctas holds the 33,791 Census 2020 ZCTAs with a five-digit county and a derived state,
-- every column described, read by every role and written by none through the API; a location row keys zcta from its
-- postal code at insert and when the code changes, a non-ZCTA code stays NULL, a keyed row is left alone; the back-fill
-- writer keys only unkeyed ZCTA rows, in bounded batches, with a receipt, and is service_role only; the migration is
-- idempotent and the concurrent index exists.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_location_observations') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION fixture_assert(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %', label; END IF;
  RAISE NOTICE 'ok: %', label;
END $$;
CREATE FUNCTION fixture_reject(stmt text, label text, want_code text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = want_code THEN RAISE NOTICE 'ok: %', label; RETURN; END IF;
    RAISE EXCEPTION 'assertion failed: % (got % %)', label, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'assertion failed: % (statement succeeded)', label;
END $$;

CREATE TABLE public.vehicle_location_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source_type text, postal_code text, region_code text,
  observed_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.write_receipts (id bigserial PRIMARY KEY, tbl text, op text, rows integer, writer text, db_role text,
  app_name text, txid bigint, at timestamptz DEFAULT now());
GRANT ALL ON public.vehicle_location_observations, public.write_receipts TO service_role;
GRANT USAGE ON SEQUENCE public.write_receipts_id_seq TO service_role;

-- Rows before the key exists: ZCTAs, a ZIP+4, a post-office-box ZIP (not a ZCTA), a city with no code, a bad code.
INSERT INTO public.vehicle_location_observations (postal_code, region_code)
SELECT * FROM (VALUES ('89101', 'NV'), ('89101-1234', 'NV'), ('00954', 'PR'), (NULL, 'CA'), ('ABCDE', 'TX'), ('02362', 'MA')) v;
INSERT INTO public.vehicle_location_observations (postal_code, region_code)
SELECT lpad((10000 + g)::text, 5, '0'), 'XX' FROM generate_series(1, 25000) g;

\ir ../migrations/20261020210000_us_zctas_and_zcta_key.sql
\ir ../migrations/20261020210000_us_zctas_and_zcta_key.sql

SELECT fixture_assert((SELECT count(*) = 33791 FROM public.us_zctas), '33,791 ZCTAs');
SELECT fixture_assert((SELECT bool_and(zcta ~ '^[0-9]{5}$' AND county_fips ~ '^[0-9]{5}$' AND state_fips = left(county_fips, 2)) FROM public.us_zctas), 'five-digit keys with a derived state');
SELECT fixture_assert((SELECT county_fips = '32003' FROM public.us_zctas WHERE zcta = '89101'), '89101 rolls up to Clark County');
SELECT fixture_assert((SELECT count(*) = 8 FROM public.us_zctas WHERE county_fips IN ('02063', '02066')), 'the eight 2019 Alaska counties are named, not dropped');
SELECT fixture_assert(NOT EXISTS (SELECT 1 FROM public.us_zctas WHERE zcta IN ('00954', '02362')), 'post-office-box ZIPs are not ZCTAs');
SELECT fixture_assert(obj_description('public.us_zctas'::regclass, 'pg_class') IS NOT NULL, 'table described');
SELECT fixture_assert((SELECT count(*) = 0 FROM pg_attribute a WHERE a.attrelid = 'public.us_zctas'::regclass AND a.attnum > 0
  AND NOT a.attisdropped AND col_description(a.attrelid, a.attnum) IS NULL), 'every column described');
SELECT fixture_assert((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.us_zctas'::regclass)
  AND has_table_privilege('anon', 'public.us_zctas', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.us_zctas', 'INSERT,UPDATE,DELETE,TRUNCATE')
  AND NOT has_table_privilege('authenticated', 'public.us_zctas', 'INSERT,UPDATE,DELETE,TRUNCATE')
  AND NOT has_table_privilege('service_role', 'public.us_zctas', 'INSERT,UPDATE,DELETE,TRUNCATE'), 'every role reads, no API role writes');
SET ROLE anon;
SELECT fixture_assert((SELECT count(*) = 33791 FROM public.us_zctas), 'anon sees every ZCTA through RLS');
RESET ROLE;

-- The key at insert.
SELECT fixture_assert(col_description('public.vehicle_location_observations'::regclass,
  (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.vehicle_location_observations'::regclass AND attname = 'zcta')) IS NOT NULL, 'zcta described');
SELECT fixture_assert((SELECT count(*) = 0 FROM public.vehicle_location_observations WHERE zcta IS NOT NULL), 'existing rows untouched by the migration');
INSERT INTO public.vehicle_location_observations (postal_code, region_code) VALUES ('89101', 'NV'), ('89101-1234', 'NV'), ('00954', 'PR'), (NULL, 'CA'), ('ABCDE', 'TX');
SELECT fixture_assert((SELECT count(*) = 2 FROM public.vehicle_location_observations WHERE zcta = '89101' AND created_at >= now() - interval '1 minute' AND postal_code LIKE '89101%'),
  'a ZCTA code and its ZIP+4 key at insert');
SELECT fixture_assert((SELECT bool_and(zcta IS NULL) FROM public.vehicle_location_observations WHERE postal_code IN ('00954', 'ABCDE') OR postal_code IS NULL), 'a non-ZCTA, bad or missing code stays NULL');
UPDATE public.vehicle_location_observations SET postal_code = '10001' WHERE postal_code = '00954';
SELECT fixture_assert((SELECT bool_and(zcta = '10001') AND count(*) = 2 FROM public.vehicle_location_observations WHERE postal_code = '10001' AND region_code = 'PR'), 'a changed code keys both unkeyed rows');
UPDATE public.vehicle_location_observations SET postal_code = '10002' WHERE postal_code = '10001' AND region_code = 'PR';
SELECT fixture_assert((SELECT bool_and(zcta = '10001') FROM public.vehicle_location_observations WHERE postal_code = '10002' AND region_code = 'PR'), 'a keyed row is left alone: the key fires only when zcta is NULL');

-- The back-fill writer.
SELECT fixture_assert(NOT has_function_privilege('anon', 'key_vehicle_location_zcta(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'key_vehicle_location_zcta(integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'key_vehicle_location_zcta(integer)', 'EXECUTE'), 'writer is service_role only');
SELECT fixture_reject($q$SELECT key_vehicle_location_zcta(0)$q$, 'batch below 1 refused', '22023');
SELECT fixture_reject($q$SELECT key_vehicle_location_zcta(20001)$q$, 'batch above 20000 refused', '22023');
CREATE TEMP TABLE before_walk AS SELECT count(*) AS keyed FROM public.vehicle_location_observations WHERE zcta IS NOT NULL;
SET ROLE service_role;
SELECT fixture_assert((SELECT (key_vehicle_location_zcta(1000)->>'keyed')::int = 1000), 'a batch keys exactly its size');
RESET ROLE;
SELECT fixture_assert((SELECT count(*) = (SELECT keyed + 1000 FROM before_walk) FROM public.vehicle_location_observations WHERE zcta IS NOT NULL), 'the thousand are keyed');
SET ROLE service_role;
SELECT fixture_assert((SELECT count(*) = 1 AND max(rows) = 1000 AND max(writer) = 'key_vehicle_location_zcta' FROM public.write_receipts), 'one receipt for the batch');
CREATE TEMP TABLE drain AS SELECT key_vehicle_location_zcta(20000) AS r;
INSERT INTO drain SELECT key_vehicle_location_zcta(20000);
INSERT INTO drain SELECT key_vehicle_location_zcta(20000);
SELECT fixture_assert((SELECT (r->>'keyed')::int = 0 FROM drain ORDER BY (r->>'keyed')::int LIMIT 1), 'the walk ends at zero');
RESET ROLE;
SELECT fixture_assert((SELECT count(*) = 0 FROM public.vehicle_location_observations o
  WHERE o.zcta IS NULL AND EXISTS (SELECT 1 FROM public.us_zctas z WHERE z.zcta = left(o.postal_code, 5))), 'every ZCTA-coded row is keyed');
SELECT fixture_assert((SELECT count(*) > 0 FROM public.vehicle_location_observations o WHERE o.zcta IS NULL AND o.postal_code ~ '^[0-9]{5}$'), 'non-ZCTA codes remain NULL after the walk');
SELECT fixture_assert((SELECT bool_and(o.zcta = left(o.postal_code, 5)) FROM public.vehicle_location_observations o WHERE o.zcta IS NOT NULL AND o.region_code <> 'PR'), 'a key always equals its code (the PR row kept its first key on purpose)');
SELECT fixture_assert((SELECT indisvalid FROM pg_index WHERE indexrelid = 'public.idx_vehicle_location_observations_zcta'::regclass), 'zcta index built and valid');
