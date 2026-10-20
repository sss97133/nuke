-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_us_states_and_zip_crosswalk_gaps -f this-file.sql
-- Proves 20261020200700: us_states has the 56 Census state codes, every column described, readable by every role and
-- writable by none through the API; us_county_boundaries.state_fips references it and a county with an unknown state
-- is refused; zip_to_fips gains source and 1,693 ZCTA rows that never overwrite an existing ZIP, every one a ZCTA
-- in a state us_states knows; and the migration is idempotent.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.us_county_boundaries') IS NOT NULL THEN
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

-- The live shapes: one county per state code (the live table has 3,231 under the same constraints) and a crosswalk
-- that already holds three of the ZCTAs the migration adds, pointing elsewhere, which it must leave alone.
CREATE TABLE public.us_county_boundaries (
  fips text PRIMARY KEY CHECK (fips ~ '^[0-9]{5}$'), name text, state_fips text CHECK (state_fips = left(fips, 2)));
INSERT INTO public.us_county_boundaries
SELECT c || '001', 'County ' || c, c FROM unnest(ARRAY['01','02','04','05','06','08','09','10','11','12','13','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','44','45','46','47','48','49','50','51','53','54','55','56','60','66','69','72','78']) c;
CREATE TABLE public.zip_to_fips (zip text PRIMARY KEY, fips text);
INSERT INTO public.zip_to_fips VALUES ('00606', '99999'), ('89101', '32003'), ('96799', '99999');

\ir ../migrations/20261020200700_us_states_and_zip_crosswalk_gaps.sql
\ir ../migrations/20261020200700_us_states_and_zip_crosswalk_gaps.sql

SELECT fixture_assert((SELECT count(*) = 56 FROM public.us_states), '56 state codes');
SELECT fixture_assert((SELECT count(*) FILTER (WHERE kind = 'state') = 50 AND count(*) FILTER (WHERE kind = 'district') = 1
  AND count(*) FILTER (WHERE kind = 'territory') = 5 FROM public.us_states), '50 states, DC, 5 territories');
SELECT fixture_assert((SELECT bool_and(EXISTS (SELECT 1 FROM public.us_states s WHERE s.fips = c.state_fips)) FROM public.us_county_boundaries c),
  'every county state code is a state');
SELECT fixture_assert((SELECT usps = 'NV' AND name = 'Nevada' FROM public.us_states WHERE fips = '32'), '32 is Nevada');
SELECT fixture_assert(obj_description('public.us_states'::regclass, 'pg_class') IS NOT NULL, 'table described');
SELECT fixture_assert((SELECT count(*) = 0 FROM pg_attribute a WHERE a.attrelid = 'public.us_states'::regclass AND a.attnum > 0
  AND NOT a.attisdropped AND col_description(a.attrelid, a.attnum) IS NULL), 'every column described');
SELECT fixture_assert((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.us_states'::regclass), 'RLS on');
SELECT fixture_assert(has_table_privilege('anon', 'public.us_states', 'SELECT') AND has_table_privilege('authenticated', 'public.us_states', 'SELECT'), 'every role reads');
SELECT fixture_assert(NOT has_table_privilege('anon', 'public.us_states', 'INSERT,UPDATE,DELETE,TRUNCATE')
  AND NOT has_table_privilege('authenticated', 'public.us_states', 'INSERT,UPDATE,DELETE,TRUNCATE')
  AND NOT has_table_privilege('service_role', 'public.us_states', 'INSERT,UPDATE,DELETE,TRUNCATE'), 'no API role writes');
SET ROLE anon;
SELECT fixture_assert((SELECT count(*) = 56 FROM public.us_states), 'anon sees all 56 through RLS');
RESET ROLE;

-- The state key is enforced on counties.
SELECT fixture_assert((SELECT convalidated FROM pg_constraint WHERE conname = 'us_county_boundaries_state_fips_fkey'), 'county state key validated');
SELECT fixture_reject($q$INSERT INTO public.us_county_boundaries VALUES ('99001', 'Nowhere', '99')$q$, 'a county in no state is refused', '23503');

-- The crosswalk fill.
SELECT fixture_assert((SELECT count(*) = 3 + 1692 FROM public.zip_to_fips), '1,692 new rows beside the 3 seeded (one collided and was kept)');
SELECT fixture_assert((SELECT fips = '99999' FROM public.zip_to_fips WHERE zip = '00606'), 'an existing ZIP is never overwritten');
SELECT fixture_assert((SELECT count(*) = 1692 FROM public.zip_to_fips WHERE source = 'census_2020_zcta_county_rel'), 'new rows carry their source');
SELECT fixture_assert((SELECT bool_and(zip ~ '^[0-9]{5}$' AND fips ~ '^[0-9]{5}$') FROM public.zip_to_fips), 'five-digit keys');
SELECT fixture_assert((SELECT bool_and(EXISTS (SELECT 1 FROM public.us_states s WHERE s.fips = left(z.fips, 2)))
  FROM public.zip_to_fips z WHERE source IS NOT NULL), 'every added county is in a known state');
SELECT fixture_assert((SELECT source IS NULL FROM public.zip_to_fips WHERE zip = '89101'), 'original rows keep a NULL source');
SELECT fixture_assert(col_description('public.zip_to_fips'::regclass, (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.zip_to_fips'::regclass AND attname = 'source')) IS NOT NULL, 'source described');
