-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_family_keys_body_words -f this-file.sql
-- Contract for 20261017001000_family_keys_body_words.sql. Synthetic rows only; never production.
-- Builds mv_model_family_names from its own migration over Chevrolet rows shaped as production's on 2026-10-15, then
-- requires: a name made only of body or weight words ("pickup", "truck", "custom pickup", "3/4 ton", "one ton") no
-- longer keys a 1960-87 C-series family; a name with a series in it ("c10 pickup", "c20", "3100 pickup") keys as before
-- and its family id does not change; the 3100 and 3600 run to 1959; the dictionary's own body-word families of other
-- makes (Ford Pickup) are untouched; notes record each change; a second apply changes nothing.
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
  ('00000000-0000-4000-a000-000000000004', 'Chevrolet', 'Chevrolet', 'Chevy', '{}'),
  ('00000000-0000-4000-a000-000000000002', 'Ford', 'Ford', NULL, '{}');
-- Chevrolet's C-series and 3100/3600 rows as production holds them (two C10 rows, one written in capitals).
INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases, notes) VALUES
  ('00000000-0000-4000-b000-000000000010', 'Chevrolet', 'C10', 1960, 1987,
   '{c10,c-10,"c 10",truck,pickup,"1/2 ton","half ton","c10 pickup","c-10 pickup"}', NULL),
  ('00000000-0000-4000-b000-000000000011', 'CHEVROLET', 'C10', 1960, 1987, '{c10,C-10,"c/k 10",Truck}', NULL),
  ('00000000-0000-4000-b000-000000000020', 'Chevrolet', 'C20', 1960, 1987, '{c20,c-20,"3/4 ton"}', NULL),
  ('00000000-0000-4000-b000-000000000030', 'Chevrolet', 'C30', 1960, 1987, '{c30,c-30,"one ton"}', NULL),
  ('00000000-0000-4000-b000-000000003100', 'Chevrolet', '3100', 1947, 1955, '{3100,"3100 pickup","3100 truck"}', 'earlier note.'),
  ('00000000-0000-4000-b000-000000003600', 'Chevrolet', '3600', 1947, 1955, '{3600,"3600 pickup"}', NULL),
  ('00000000-0000-4000-b000-0000000000f1', 'Ford', 'Pickup', 1917, 1983, '{pickup}', NULL);
INSERT INTO public.mv_vehicle_name_dictionary (make_l, model_l, name_l, vehicles) VALUES
  ('chevrolet', 'pickup', 'chevrolet pickup', 707), ('chevrolet', 'truck', 'chevrolet truck', 127),
  ('chevrolet', 'custom pickup', 'chevrolet custom pickup', 66), ('chevrolet', '3/4 ton', 'chevrolet 3/4 ton', 9),
  ('chevrolet', 'one ton', 'chevrolet one ton', 4), ('chevrolet', 'c10 pickup', 'chevrolet c10 pickup', 738),
  ('chevrolet', 'c20', 'chevrolet c20', 300), ('chevrolet', '3100 pickup', 'chevrolet 3100 pickup', 270),
  ('ford', 'pickup', 'ford pickup', 500);

\ir ../migrations/20261015090000_model_family_names.sql

CREATE TEMP TABLE before AS SELECT make_l, model_l, family_id, family, year_start, year_end FROM public.mv_model_family_names;
SELECT pg_temp.ok('before: body and weight words key the 1960-87 C-series',
  (SELECT family FROM before WHERE make_l = 'chevrolet' AND model_l = 'pickup') = 'C10'
  AND (SELECT family FROM before WHERE make_l = 'chevrolet' AND model_l = 'truck') = 'C10'
  AND (SELECT family FROM before WHERE make_l = 'chevrolet' AND model_l = '3/4 ton') = 'C20');

\ir ../migrations/20261017001000_family_keys_body_words.sql
CREATE TEMP TABLE notes_once AS SELECT id, notes, aliases, year_end FROM public.canonical_models;
\ir ../migrations/20261017001000_family_keys_body_words.sql
REFRESH MATERIALIZED VIEW public.mv_model_family_names;

SELECT pg_temp.ok('a name made only of body or weight words keys no Chevrolet series',
  NOT EXISTS (SELECT 1 FROM public.mv_model_family_names WHERE make_l = 'chevrolet'
              AND model_l IN ('pickup', 'truck', 'custom pickup', '3/4 ton', 'one ton') AND family IS NOT NULL));
SELECT pg_temp.ok('a name with a series in it keys as before, with the same family id',
  NOT EXISTS (SELECT 1 FROM before b JOIN public.mv_model_family_names n USING (make_l, model_l)
              WHERE b.model_l IN ('c10 pickup', 'c20', '3100 pickup') AND (n.family_id IS DISTINCT FROM b.family_id OR n.family IS NULL)));
SELECT pg_temp.ok('the 3100 and 3600 run to 1959 (Task Force), and the 3100 pickup reads it',
  (SELECT year_end FROM public.canonical_models WHERE id = '00000000-0000-4000-b000-000000003100') = 1959
  AND (SELECT year_end FROM public.canonical_models WHERE id = '00000000-0000-4000-b000-000000003600') = 1959
  AND (SELECT year_end FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = '3100 pickup') = 1959);
SELECT pg_temp.ok('the C-series keep their series spellings',
  (SELECT aliases FROM public.canonical_models WHERE id = '00000000-0000-4000-b000-000000000010') = '{c10,c-10,"c 10","c10 pickup","c-10 pickup"}'
  AND (SELECT aliases FROM public.canonical_models WHERE id = '00000000-0000-4000-b000-000000000011') = '{c10,C-10,"c/k 10"}'
  AND (SELECT aliases FROM public.canonical_models WHERE id = '00000000-0000-4000-b000-000000000020') = '{c20,c-20}');
SELECT pg_temp.ok('another make''s body-word family is untouched',
  (SELECT aliases FROM public.canonical_models WHERE id = '00000000-0000-4000-b000-0000000000f1') = '{pickup}'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ford' AND model_l = 'pickup') = 'Pickup');
SELECT pg_temp.ok('notes record each change, after any earlier note',
  (SELECT notes FROM public.canonical_models WHERE id = '00000000-0000-4000-b000-000000003100')
     = 'earlier note. 2026-10-15: year_end 1955 -> 1959; Task Force trucks (1955.5-1959) kept the series number.'
  AND (SELECT notes LIKE '2026-10-15: body and weight words%' FROM public.canonical_models WHERE id = '00000000-0000-4000-b000-000000000030'));
SELECT pg_temp.ok('a second apply changes nothing',
  NOT EXISTS (SELECT 1 FROM public.canonical_models m JOIN notes_once o USING (id)
              WHERE m.notes IS DISTINCT FROM o.notes OR m.aliases IS DISTINCT FROM o.aliases OR m.year_end IS DISTINCT FROM o.year_end));
