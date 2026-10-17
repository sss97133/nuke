-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_family_keys_weight_words -f this-file.sql
-- Contract for 20261017061000_family_keys_weight_drive_words.sql. Synthetic rows only; never production.
-- Builds mv_model_family_names from its own migration over Chevrolet truck rows shaped as production's on 2026-10-15
-- (after the body-word migration), then requires: a name made only of weight, dually or drive words ("4x4", "dually",
-- "1 ton", "3/4 ton 4x4", ...) keys no Chevrolet series, and "k3500 4x4" no longer keys the 1960-87 K10; a name with a
-- series in it ("k10 4x4", "1500 4x4", "c20", "c30 dually") keys as before with the same family id; the "3 ton" family
-- and another make's "4x4" spelling are untouched; notes record each change after any earlier note; a second apply
-- changes nothing.
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
-- Chevrolet's truck rows as production holds them after 20261017001000 (a second K10 row written in capitals).
INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases, notes) VALUES
  ('00000000-0000-4000-b000-000000000020', 'Chevrolet', 'C20', 1960, 1987, '{c20,c-20,"three quarter ton"}', NULL),
  ('00000000-0000-4000-b000-000000000030', 'Chevrolet', 'C30', 1960, 1987, '{c30,c-30,"1 ton",dually}', NULL),
  ('00000000-0000-4000-b000-000000003500', 'Chevrolet', 'C3500', 1988, 1998, '{c3500,dually}', NULL),
  ('00000000-0000-4000-b000-000000000110', 'Chevrolet', 'K10', 1960, 1987, '{k10,k-10,"k10 4x4","k-10 4x4",4x4,4wd}', 'earlier note.'),
  ('00000000-0000-4000-b000-000000000111', 'CHEVROLET', 'K10', 1960, 1987, '{"c/k 10 4x4"}', NULL),
  ('00000000-0000-4000-b000-000000000120', 'Chevrolet', 'K20', 1960, 1987, '{k20,"k20 4x4","3/4 ton 4x4"}', NULL),
  ('00000000-0000-4000-b000-000000000130', 'Chevrolet', 'K30', 1960, 1987, '{k30,"k30 4x4","1 ton 4x4"}', NULL),
  ('00000000-0000-4000-b000-000000001500', 'Chevrolet', 'K1500', 1988, 1998, '{k1500,"1500 4x4"}', NULL),
  ('00000000-0000-4000-b000-0000000003a0', 'Chevrolet', '3 ton', NULL, NULL, '{"3 ton"}', NULL),
  ('00000000-0000-4000-b000-0000000000b1', 'Ford', 'Bronco', 1966, 1996, '{bronco,4x4}', NULL);
INSERT INTO public.mv_vehicle_name_dictionary (make_l, model_l, name_l, vehicles) VALUES
  ('chevrolet', '4x4', 'chevrolet 4x4', 6), ('chevrolet', 'k3500 4x4', 'chevrolet k3500 4x4', 4),
  ('chevrolet', 'cheyenne 4x4', 'chevrolet cheyenne 4x4', 4), ('chevrolet', 'dually', 'chevrolet dually', 4),
  ('chevrolet', '1 ton', 'chevrolet 1 ton', 2), ('chevrolet', 'three quarter ton', 'chevrolet three quarter ton', 1),
  ('chevrolet', '3/4 ton 4x4', 'chevrolet 3/4 ton 4x4', 4), ('chevrolet', '1 ton 4x4', 'chevrolet 1 ton 4x4', 1),
  ('chevrolet', '4wd', 'chevrolet 4wd', 1), ('chevrolet', 'k10 4x4', 'chevrolet k10 4x4', 50),
  ('chevrolet', '1500 4x4', 'chevrolet 1500 4x4', 20), ('chevrolet', 'c20', 'chevrolet c20', 300),
  ('chevrolet', 'c30 dually', 'chevrolet c30 dually', 10), ('chevrolet', '3 ton', 'chevrolet 3 ton', 3),
  ('ford', '4x4', 'ford 4x4', 2);

\ir ../migrations/20261015090000_model_family_names.sql

CREATE TEMP TABLE before AS SELECT make_l, model_l, family_id, family FROM public.mv_model_family_names;
SELECT pg_temp.ok('before: weight and drive words key a Chevrolet series, and k3500 4x4 keys the 1960-87 K10',
  (SELECT family FROM before WHERE make_l = 'chevrolet' AND model_l = '4x4') = 'K10'
  AND (SELECT family FROM before WHERE make_l = 'chevrolet' AND model_l = 'k3500 4x4') = 'K10'
  AND (SELECT family FROM before WHERE make_l = 'chevrolet' AND model_l = 'dually') = 'C30'
  AND (SELECT family FROM before WHERE make_l = 'chevrolet' AND model_l = '3/4 ton 4x4') = 'K20');

\ir ../migrations/20261017061000_family_keys_weight_drive_words.sql
CREATE TEMP TABLE once AS SELECT id, notes, aliases FROM public.canonical_models;
\ir ../migrations/20261017061000_family_keys_weight_drive_words.sql
REFRESH MATERIALIZED VIEW public.mv_model_family_names;

SELECT pg_temp.ok('a name made only of weight, dually or drive words keys no Chevrolet series',
  NOT EXISTS (SELECT 1 FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND family IS NOT NULL
              AND model_l IN ('4x4', 'k3500 4x4', 'cheyenne 4x4', 'dually', '1 ton', 'three quarter ton', '3/4 ton 4x4',
                              '1 ton 4x4', '4wd')));
SELECT pg_temp.ok('a name with a series in it keys as before, with the same family id',
  NOT EXISTS (SELECT 1 FROM before b JOIN public.mv_model_family_names n USING (make_l, model_l)
              WHERE b.make_l = 'chevrolet' AND b.model_l IN ('k10 4x4', '1500 4x4', 'c20', 'c30 dually')
                AND (n.family_id IS DISTINCT FROM b.family_id OR n.family IS NULL))
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'c30 dually') = 'C30');
SELECT pg_temp.ok('each truck family keeps its series spellings and nothing else changes',
  (SELECT aliases FROM public.canonical_models WHERE id = '00000000-0000-4000-b000-000000000020') = '{c20,c-20}'
  AND (SELECT aliases FROM public.canonical_models WHERE id = '00000000-0000-4000-b000-000000000030') = '{c30,c-30}'
  AND (SELECT aliases FROM public.canonical_models WHERE id = '00000000-0000-4000-b000-000000003500') = '{c3500}'
  AND (SELECT aliases FROM public.canonical_models WHERE id = '00000000-0000-4000-b000-000000000110') = '{k10,k-10,"k10 4x4","k-10 4x4"}'
  AND (SELECT aliases FROM public.canonical_models WHERE id = '00000000-0000-4000-b000-000000000120') = '{k20,"k20 4x4"}'
  AND (SELECT aliases FROM public.canonical_models WHERE id = '00000000-0000-4000-b000-000000000130') = '{k30,"k30 4x4"}'
  AND (SELECT aliases FROM public.canonical_models WHERE id = '00000000-0000-4000-b000-000000000111') = '{"c/k 10 4x4"}'
  AND (SELECT aliases FROM public.canonical_models WHERE id = '00000000-0000-4000-b000-000000001500') = '{k1500,"1500 4x4"}');
SELECT pg_temp.ok('the 3 ton family and another make''s 4x4 spelling are untouched',
  (SELECT aliases FROM public.canonical_models WHERE id = '00000000-0000-4000-b000-0000000003a0') = '{"3 ton"}'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = '3 ton') = '3 ton'
  AND (SELECT aliases FROM public.canonical_models WHERE id = '00000000-0000-4000-b000-0000000000b1') = '{bronco,4x4}'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ford' AND model_l = '4x4') = 'Bronco');
SELECT pg_temp.ok('notes record each change after any earlier note, and untouched rows keep theirs',
  (SELECT notes FROM public.canonical_models WHERE id = '00000000-0000-4000-b000-000000000110')
     = 'earlier note. 2026-10-15: weight, dually and drive words (4x4, 4wd, three quarter ton, 1 ton, dually, 3/4 ton 4x4, 1 ton 4x4) removed from the spellings; they do not name the series.'
  AND (SELECT notes LIKE '2026-10-15: weight, dually and drive words%' FROM public.canonical_models WHERE id = '00000000-0000-4000-b000-000000003500')
  AND (SELECT notes IS NULL FROM public.canonical_models WHERE id = '00000000-0000-4000-b000-000000001500'));
SELECT pg_temp.ok('a second apply changes nothing',
  NOT EXISTS (SELECT 1 FROM public.canonical_models m JOIN once o USING (id)
              WHERE m.notes IS DISTINCT FROM o.notes OR m.aliases IS DISTINCT FROM o.aliases));
