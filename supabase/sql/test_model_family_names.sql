-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_model_family_names -f this-file.sql
-- Contract for 20261015090000_model_family_names.sql. Synthetic rows only; never production.
-- canonical_makes, canonical_models (their live columns, 2026-10-15) and mv_vehicle_name_dictionary (here a table with
-- the materialized view's columns) feed mv_model_family_names:
--   * a phrase inside the name resolves ("sedan deville" -> DeVille); punctuation is a word break ("f-150 xlt" ->
--     F-150 through "f 150"); the longest phrase wins, then the earliest;
--   * makes match through canonical_makes spellings, without case or punctuation ("mercedes benz", "chevy");
--   * duplicate canonical rows of one family merge: one family_id (the lowest id), the year range is their union, open
--     when any row is open; a phrase two families share goes to the family it names;
--   * an unmatched name stays, family null, with its vehicle count; a name whose make has no families stays too;
--   * anon reads it; it refreshes CONCURRENTLY; the migration applies twice; the refresh job is scheduled once.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.canonical_models') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

-- pg_cron stand-in: the migration registers its refresh job through cron.schedule.
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS
$$ INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command) RETURNING jobid $$;

CREATE TABLE public.canonical_makes (id uuid PRIMARY KEY, canonical_name text, display_name text, short_name text,
  aliases text[], country_of_origin text, founded_year integer, parent_company text, is_active boolean,
  created_at timestamptz, brand_tier text);
CREATE TABLE public.canonical_models (id uuid PRIMARY KEY, make text, canonical_model text, canonical_series text,
  year_start integer, year_end integer, body_styles text[], aliases text[], generation text, notes text, created_at timestamptz);
CREATE TABLE public.mv_vehicle_name_dictionary (make_l text, model_l text, name_l text, vehicles bigint,
  PRIMARY KEY (make_l, model_l));

INSERT INTO public.canonical_makes (id, canonical_name, display_name, short_name, aliases) VALUES
  ('00000000-0000-4000-a000-000000000001', 'Cadillac', 'Cadillac', NULL, '{caddy}'),
  ('00000000-0000-4000-a000-000000000002', 'Ford', 'Ford', NULL, '{}'),
  ('00000000-0000-4000-a000-000000000003', 'Mercedes-Benz', 'Mercedes-Benz', 'Mercedes', '{benz,"mercedes benz"}'),
  ('00000000-0000-4000-a000-000000000004', 'Chevrolet', 'Chevrolet', 'Chevy', '{chevorlet}'),
  ('00000000-0000-4000-a000-000000000005', 'Dodge', 'Dodge', NULL, '{}');
-- Two DeVille rows (one open-ended) merge; Ram and Ram 2500 share the phrase "ram 2500", which goes to the family it
-- names; F-150's aliases are written with a hyphen.
INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases) VALUES
  ('00000000-0000-4000-b000-000000000002', 'Cadillac', 'DeVille', 1959, 2005, '{deville,"sedan deville","coupe de ville"}'),
  ('00000000-0000-4000-b000-000000000001', 'Cadillac', 'DeVille', 1965, NULL, '{"coupe deville"}'),
  ('00000000-0000-4000-b000-000000000003', 'Ford', 'F-150', 1975, NULL, '{f150,f-150,"f-150 xlt"}'),
  ('00000000-0000-4000-b000-000000000004', 'Ford', 'Mustang', 1964, NULL, '{mustang,stang}'),
  ('00000000-0000-4000-b000-000000000005', 'Mercedes-Benz', '280SL', 1968, 1971, '{280sl,"280 sl"}'),
  ('00000000-0000-4000-b000-000000000006', 'Chevrolet', 'Corvette', 1953, NULL, '{corvette,vette}'),
  ('00000000-0000-4000-b000-000000000007', 'Dodge', 'Ram', 1981, NULL, '{ram,"ram 2500"}'),
  ('00000000-0000-4000-b000-000000000008', 'Dodge', 'Ram 2500', 1994, NULL, '{"ram 2500"}');
INSERT INTO public.mv_vehicle_name_dictionary (make_l, model_l, name_l, vehicles) VALUES
  ('cadillac', 'sedan deville', 'cadillac sedan deville', 7),
  ('cadillac', 'coupe deville convertible', 'cadillac coupe deville convertible', 2),
  ('ford', 'f-150 xlt supercab', 'ford f-150 xlt supercab', 4),
  ('ford', 'f150', 'ford f150', 3),
  ('ford', 'mustang gt fastback', 'ford mustang gt fastback', 5),
  ('mercedes benz', '280 sl pagoda', 'mercedes benz 280 sl pagoda', 2),
  ('chevy', 'corvette c3', 'chevy corvette c3', 6),
  ('dodge', 'ram 2500 v10', 'dodge ram 2500 v10', 3),
  ('ford', 'sand rail', 'ford sand rail', 1),
  ('freightliner', 'truck', 'freightliner truck', 2),
  ('ford', '', 'ford', 1);

\ir ../migrations/20261015090000_model_family_names.sql
\ir ../migrations/20261015090000_model_family_names.sql

CREATE FUNCTION pg_temp.fam(p_make text, p_model text) RETURNS public.mv_model_family_names LANGUAGE sql AS
$$ SELECT * FROM public.mv_model_family_names WHERE make_l = p_make AND model_l = p_model $$;

SELECT pg_temp.ok('a phrase inside the name resolves', (pg_temp.fam('cadillac', 'sedan deville')).family = 'DeVille'
  AND (pg_temp.fam('cadillac', 'sedan deville')).matched = 'sedan deville');
SELECT pg_temp.ok('duplicate rows merge: one key, the union of the years, open when one row is open',
  (pg_temp.fam('cadillac', 'sedan deville')).family_id = '00000000-0000-4000-b000-000000000001'
  AND (pg_temp.fam('cadillac', 'coupe deville convertible')).family_id = '00000000-0000-4000-b000-000000000001'
  AND (pg_temp.fam('cadillac', 'sedan deville')).year_start = 1959 AND (pg_temp.fam('cadillac', 'sedan deville')).year_end IS NULL);
SELECT pg_temp.ok('the longest phrase wins', (pg_temp.fam('cadillac', 'coupe deville convertible')).matched = 'coupe deville');
SELECT pg_temp.ok('punctuation is a word break', (pg_temp.fam('ford', 'f-150 xlt supercab')).family = 'F-150'
  AND (pg_temp.fam('ford', 'f-150 xlt supercab')).matched = 'f 150 xlt' AND (pg_temp.fam('ford', 'f150')).family = 'F-150');
SELECT pg_temp.ok('the earliest phrase of a length wins', (pg_temp.fam('ford', 'mustang gt fastback')).family = 'Mustang');
SELECT pg_temp.ok('makes match through canonical spellings', (pg_temp.fam('mercedes benz', '280 sl pagoda')).family = '280SL'
  AND (pg_temp.fam('mercedes benz', '280 sl pagoda')).make = 'Mercedes-Benz'
  AND (pg_temp.fam('chevy', 'corvette c3')).family = 'Corvette' AND (pg_temp.fam('chevy', 'corvette c3')).make = 'Chevrolet');
SELECT pg_temp.ok('a shared phrase goes to the family it names', (pg_temp.fam('dodge', 'ram 2500 v10')).family = 'Ram 2500');
SELECT pg_temp.ok('an unmatched name stays, with its count',
  (pg_temp.fam('ford', 'sand rail')).family IS NULL AND (pg_temp.fam('ford', 'sand rail')).vehicles = 1
  AND (pg_temp.fam('freightliner', 'truck')).family IS NULL AND (pg_temp.fam('freightliner', 'truck')).make IS NULL
  AND (pg_temp.fam('ford', '')).family IS NULL);
SELECT pg_temp.ok('every dictionary name has one row', (SELECT count(*) FROM public.mv_model_family_names) = 11);
SELECT pg_temp.ok('coverage weighted by vehicles', (SELECT sum(vehicles) FILTER (WHERE family_id IS NOT NULL) FROM public.mv_model_family_names) = 32
  AND (SELECT sum(vehicles) FROM public.mv_model_family_names) = 36);

-- A new name and a new alias appear after a concurrent refresh.
INSERT INTO public.mv_vehicle_name_dictionary VALUES ('ford', 'stang convertible', 'ford stang convertible', 1);
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_model_family_names;
SELECT pg_temp.ok('refreshes concurrently', (pg_temp.fam('ford', 'stang convertible')).family = 'Mustang');
SELECT pg_temp.ok('one refresh job, after the dictionary', (SELECT count(*) FROM cron.job WHERE jobname = 'refresh-model-family-names') = 1
  AND (SELECT schedule FROM cron.job WHERE jobname = 'refresh-model-family-names') = '5 4 * * *'
  AND (SELECT command FROM cron.job WHERE jobname = 'refresh-model-family-names') LIKE '%REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_model_family_names%');
SELECT pg_temp.ok('anon reads it; PUBLIC does not', has_table_privilege('anon', 'public.mv_model_family_names', 'select')
  AND NOT has_table_privilege('public', 'public.mv_model_family_names', 'select'));
GRANT EXECUTE ON FUNCTION pg_temp.ok(text, boolean) TO anon;
SET ROLE anon;
SELECT pg_temp.ok('anon: the same row', (SELECT family FROM public.mv_model_family_names WHERE make_l = 'cadillac' AND model_l = 'sedan deville') = 'DeVille');
RESET ROLE;
