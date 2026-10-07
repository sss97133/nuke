-- Isolated PostgreSQL 17 contract for 20261007210000_declare_place_entity_us_county_boundaries.sql. Synthetic rows only; never
-- production. Run in an empty, disposable dm_refinement_* database:
--   createdb dm_refinement_place_entity_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_place_entity_ci -f supabase/sql/test_place_entity_declaration.sql
-- Fixtures carry the live shapes read from prod on 2026-10-07: us_county_boundaries (geom as text here; PostGIS is not needed
-- to declare, key or comment), zip_to_fips, the columns of vehicle_location_observations the migration touches,
-- stack_substrates with its declaration-complete check, and pipeline_registry. stack_coverage() is absent on purpose: the
-- migration's NOTICE must skip it without error.
-- Covered: the two validated format checks; both NOT VALID keys with their comments; old orphans kept and still writable on
-- other columns; new or re-keyed orphans refused; a county delete refused while referenced; the declaration row; the two
-- registry rows; the comments; a re-apply that adds nothing and changes nothing.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR to_regclass('public.us_county_boundaries') IS NOT NULL
     OR to_regclass('public.stack_substrates') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';
SET TimeZone = 'UTC';

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
CREATE TABLE public.us_county_boundaries (fips text PRIMARY KEY, name text, state_fips text, geom text);
CREATE INDEX idx_county_boundaries_geom ON public.us_county_boundaries (geom);
COMMENT ON TABLE public.us_county_boundaries IS 'US county boundaries: one row per county FIPS with name, state FIPS and geometry (grain: one county). Reference data; no writer in the repo; read for point-in-county lookups. No row writes since the statistics reset.';
CREATE TABLE public.zip_to_fips (zip text PRIMARY KEY, fips text);
COMMENT ON TABLE public.zip_to_fips IS 'US ZIP code to county FIPS lookup: one row per ZIP (grain: one ZIP code). Reference data; no writer in the repo. A candidate geography key for location text (plan lane K). No row writes since the statistics reset.';
CREATE TABLE public.vehicle_location_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid,
  source_type text,
  observed_at timestamptz,
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
COMMENT ON COLUMN public.vehicle_location_observations.county_fips IS 'US county FIPS code from spatial lookup against us_county_boundaries';
CREATE TABLE public.stack_substrates (
  substrate      text PRIMARY KEY CHECK (btrim(substrate) <> '' AND substrate = btrim(substrate)),
  declared_table text CHECK (declared_table ~ '^[a-z_][a-z0-9_]*$'),
  declared_at    timestamptz,
  declared_by    text,
  note           text NOT NULL,
  source         text NOT NULL,
  registered_at  timestamptz NOT NULL DEFAULT now(),
  registered_by  text NOT NULL,
  CONSTRAINT stack_substrates_declaration_complete
    CHECK ((declared_table IS NULL) = (declared_at IS NULL) AND (declared_table IS NULL) = (declared_by IS NULL)));
CREATE TABLE public.pipeline_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, column_name text,
  owned_by text NOT NULL, description text NOT NULL, valid_values text[],
  do_not_write_directly boolean NOT NULL DEFAULT false, write_via text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_name, column_name));

-- Before: two counties, one crosswalk row onto a retired code, three observations (coded, the '_none' orphan, uncoded) ---
INSERT INTO public.us_county_boundaries (fips, name, state_fips, geom) VALUES
  ('32003', 'Clark', '32', 'g1'), ('06037', 'Los Angeles', '06', 'g2');
INSERT INTO public.zip_to_fips (zip, fips) VALUES ('89101', '32003'), ('33101', '12025');
INSERT INTO public.vehicle_location_observations (id, postal_code, county_fips, county_name) VALUES
  ('00000000-0000-0000-0000-0000000000c1', '89101', '32003', 'Clark'),
  ('00000000-0000-0000-0000-0000000000c2', NULL, '_none', NULL),
  ('00000000-0000-0000-0000-0000000000c3', '90012', NULL, NULL);
INSERT INTO public.stack_substrates (substrate, note, source, registered_by) VALUES
  ('place entity', 'A place keyed from lots, sellers, buyers and dated locations. Live candidates, not declared: us_county_boundaries.', 't', 't'),
  ('text fold', 'The text fold.', 't', 't');

\ir ../migrations/20261007210000_declare_place_entity_us_county_boundaries.sql

-- Format checks ----------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('the county table carries two validated checks',
  (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.us_county_boundaries'::regclass AND contype = 'c' AND convalidated) = 2
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'us_county_boundaries_fips_format_check')
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'us_county_boundaries_state_fips_check'));
SELECT pg_temp.fails('a county with a malformed FIPS is refused',
  $q$INSERT INTO public.us_county_boundaries (fips, name, state_fips) VALUES ('ABCDE', 'x', 'AB')$q$, '23514');
SELECT pg_temp.fails('a county whose state code disagrees with its FIPS is refused',
  $q$INSERT INTO public.us_county_boundaries (fips, name, state_fips) VALUES ('48201', 'Harris', '47')$q$, '23514');
INSERT INTO public.us_county_boundaries (fips, name, state_fips, geom) VALUES ('48201', 'Harris', '48', 'g3');
SELECT pg_temp.ok('a well-formed county is admitted', (SELECT count(*) FROM public.us_county_boundaries) = 3);

-- Keys -------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('vehicle_location_observations.county_fips keys us_county_boundaries(fips), NOT VALID, NO ACTION',
  EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname = 'vehicle_location_observations_county_fips_fkey'
          AND c.conrelid = 'public.vehicle_location_observations'::regclass AND c.confrelid = 'public.us_county_boundaries'::regclass
          AND NOT c.convalidated AND c.confdeltype = 'a'
          AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = c.conrelid AND attname = 'county_fips')]));
SELECT pg_temp.ok('zip_to_fips.fips keys us_county_boundaries(fips), NOT VALID',
  EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname = 'zip_to_fips_fips_fkey'
          AND c.conrelid = 'public.zip_to_fips'::regclass AND c.confrelid = 'public.us_county_boundaries'::regclass AND NOT c.convalidated));
SELECT pg_temp.ok('the county table now has two keys in and none out',
  (SELECT count(*) FROM pg_constraint WHERE confrelid = 'public.us_county_boundaries'::regclass AND contype = 'f') = 2
  AND (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.us_county_boundaries'::regclass AND contype = 'f') = 0);

-- Old orphans kept; other columns of an orphan row still writable; new or re-keyed orphans refused -------------------------
SELECT pg_temp.ok('the migration wrote no row: the _none observation and the retired-code ZIP are kept',
  (SELECT county_fips FROM public.vehicle_location_observations WHERE id = '00000000-0000-0000-0000-0000000000c2') = '_none'
  AND (SELECT fips FROM public.zip_to_fips WHERE zip = '33101') = '12025'
  AND (SELECT count(*) FROM public.vehicle_location_observations) = 3);
UPDATE public.vehicle_location_observations SET county_name = 'none recorded' WHERE id = '00000000-0000-0000-0000-0000000000c2';
SELECT pg_temp.ok('an orphan observation can still be written on other columns while county_fips stays as it was',
  (SELECT county_name FROM public.vehicle_location_observations WHERE id = '00000000-0000-0000-0000-0000000000c2') = 'none recorded');
SELECT pg_temp.fails('a new observation coded to a code that is not a county is refused',
  $q$INSERT INTO public.vehicle_location_observations (postal_code, county_fips) VALUES ('00000', '_none')$q$, '23503');
SELECT pg_temp.fails('re-keying an observation to a code that is not a county is refused',
  $q$UPDATE public.vehicle_location_observations SET county_fips = '99999' WHERE id = '00000000-0000-0000-0000-0000000000c1'$q$, '23503');
SELECT pg_temp.fails('a ZIP onto a code that is not a county is refused',
  $q$INSERT INTO public.zip_to_fips (zip, fips) VALUES ('00001', '99999')$q$, '23503');
INSERT INTO public.vehicle_location_observations (postal_code, county_fips, county_name) VALUES ('77002', '48201', 'Harris');
INSERT INTO public.vehicle_location_observations (postal_code) VALUES ('10001');
INSERT INTO public.zip_to_fips (zip, fips) VALUES ('77002', '48201');
SELECT pg_temp.ok('observations coded to a county or left uncoded, and a ZIP onto a county, are admitted',
  (SELECT count(*) FROM public.vehicle_location_observations) = 5
  AND (SELECT count(*) FROM public.vehicle_location_observations WHERE county_fips IS NULL) = 2
  AND (SELECT count(*) FROM public.zip_to_fips) = 3);
SELECT pg_temp.fails('deleting a county that observations reference is refused (NO ACTION)',
  $q$DELETE FROM public.us_county_boundaries WHERE fips = '32003'$q$, '23503');

-- The declaration --------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('place entity is declared as us_county_boundaries with its clock and author; the note keeps its history',
  (SELECT declared_table = 'us_county_boundaries' AND declared_at IS NOT NULL AND declared_by LIKE 'migration 20261007210000%'
          AND note LIKE 'A place keyed from lots%' AND note LIKE '%Declared 2026-10-07%'
   FROM public.stack_substrates WHERE substrate = 'place entity'));
SELECT pg_temp.ok('the other substrate is untouched',
  (SELECT declared_table IS NULL AND declared_at IS NULL AND declared_by IS NULL AND note = 'The text fold.'
   FROM public.stack_substrates WHERE substrate = 'text fold'));

-- Registry rows and comments ----------------------------------------------------------------------------------------------
SELECT pg_temp.ok('both reference tables have a table-level registry row that forbids direct writes',
  (SELECT count(*) FROM public.pipeline_registry WHERE column_name IS NULL AND do_not_write_directly
   AND table_name IN ('us_county_boundaries', 'zip_to_fips') AND owned_by = 'reference load (loader not in the repo)') = 2);
SELECT pg_temp.ok('the county table and its four columns, the crosswalk and its two columns, are described',
  obj_description('public.us_county_boundaries'::regclass, 'pg_class') LIKE 'The place entity at county grain%'
  AND (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = 'public.us_county_boundaries'::regclass AND a.attnum > 0
       AND NOT a.attisdropped AND col_description(a.attrelid, a.attnum) IS NOT NULL) = 4
  AND obj_description('public.zip_to_fips'::regclass, 'pg_class') LIKE 'ZIP to county crosswalk%'
  AND (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = 'public.zip_to_fips'::regclass AND a.attnum > 0
       AND NOT a.attisdropped AND col_description(a.attrelid, a.attnum) IS NOT NULL) = 2);
SELECT pg_temp.ok('county_fips says it is a key and that coding stopped; the constraints carry comments',
  col_description('public.vehicle_location_observations'::regclass,
    (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.vehicle_location_observations'::regclass AND attname = 'county_fips'))
    LIKE 'County the observation falls in%'
  AND obj_description((SELECT oid FROM pg_constraint WHERE conname = 'vehicle_location_observations_county_fips_fkey'), 'pg_constraint') IS NOT NULL
  AND obj_description((SELECT oid FROM pg_constraint WHERE conname = 'zip_to_fips_fips_fkey'), 'pg_constraint') IS NOT NULL);

-- Re-apply is a no-op -----------------------------------------------------------------------------------------------------
CREATE TEMP TABLE before_reapply AS
  SELECT declared_at, declared_by, note FROM public.stack_substrates WHERE substrate = 'place entity';
\ir ../migrations/20261007210000_declare_place_entity_us_county_boundaries.sql
SELECT pg_temp.ok('re-applying the migration adds no constraint, no registry row and leaves the declaration as it was',
  (SELECT count(*) FROM pg_constraint WHERE confrelid = 'public.us_county_boundaries'::regclass AND contype = 'f') = 2
  AND (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.us_county_boundaries'::regclass AND contype = 'c') = 2
  AND (SELECT count(*) FROM public.pipeline_registry WHERE table_name IN ('us_county_boundaries', 'zip_to_fips')) = 2
  AND (SELECT (s.declared_at, s.declared_by, s.note) = (b.declared_at, b.declared_by, b.note)
       FROM public.stack_substrates s, before_reapply b WHERE s.substrate = 'place entity'));

\echo 'place entity declaration contract: all checks passed'
