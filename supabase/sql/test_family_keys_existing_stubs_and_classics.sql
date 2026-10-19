-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_family_keys_existing_stubs_and_classics -f this-file.sql
-- Contract for 20261018066000_family_keys_existing_stubs_and_classics.sql. Synthetic rows only; never production.
-- Verifies that:
-- 1. Tribute-year models (Superformance MkIII, Factory Five Mk4 Roadster, Austin-Healey 3000) widen
--    their year_start / year_end bounds.
-- 2. Existing stub rows (Mercedes-Benz CLS-Class / M-Class / GLS-Class / R-Class, Audi A8, Austin-Healey 3000,
--    Fiat 124 Spider, Mazda RX-7, Porsche 924) and newly inserted families (Bentley 3 1/2 Litre,
--    Maserati Sebring, Lotus Seven / Cortina, BMW 6 Series / R90S, Saab 96, Honda S600, Nissan Patrol,
--    Hummer H3, Hudson Hornet, International Travelall, Kawasaki H2, Superformance GT40) key cleanly.
-- 3. Applying the migration a second time is idempotent and changes nothing.
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

INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases) VALUES
  ('10000000-0000-4000-a000-000000000001', 'Mercedes-Benz', 'CLS-Class',    NULL, NULL, ARRAY['cls-class']),
  ('10000000-0000-4000-a000-000000000002', 'Mercedes-Benz', 'M-Class',      NULL, NULL, ARRAY['m-class']),
  ('10000000-0000-4000-a000-000000000003', 'Mercedes-Benz', 'R-Class',      NULL, NULL, ARRAY['r-class']),
  ('10000000-0000-4000-a000-000000000004', 'Audi',          'A8',           NULL, NULL, ARRAY['a8']),
  ('10000000-0000-4000-a000-000000000005', 'Austin-Healey', '3000',         1959, 1967, ARRAY['3000']),
  ('10000000-0000-4000-a000-000000000006', 'Fiat',          '124 Spider',   NULL, NULL, ARRAY['124 spider']),
  ('10000000-0000-4000-a000-000000000007', 'Mazda',         'RX-7',         NULL, NULL, ARRAY['rx-7']),
  ('10000000-0000-4000-a000-000000000008', 'Porsche',       '924',          NULL, NULL, ARRAY['924']),
  ('10000000-0000-4000-a000-000000000009', 'Superformance', 'MkIII',        1995, NULL, ARRAY['mkiii']),
  ('10000000-0000-4000-a000-000000000010', 'Factory Five',  'Mk4 Roadster', 1995, NULL, ARRAY['mk4 roadster']);

INSERT INTO public.mv_vehicle_name_dictionary (make_l, model_l, name_l, vehicles) VALUES
  ('mercedes-benz', 'cls550',                     'mercedes-benz cls550',                     66),
  ('mercedes-benz', 'ml350',                      'mercedes-benz ml350',                      95),
  ('mercedes-benz', 'r63 amg',                    'mercedes-benz r63 amg',                    16),
  ('audi',          'a8l w12',                    'audi a8l w12',                             16),
  ('austin-healey', 'bj8',                        'austin-healey bj8',                        8),
  ('fiat',          '124 sport spider',           'fiat 124 sport spider',                    34),
  ('mazda',         'rx7',                        'mazda rx7',                                12),
  ('porsche',       '924s',                       'porsche 924s',                             41),
  ('bentley',       '3 1/2 litre drophead coupe', 'bentley 3 1/2 litre drophead coupe',       4),
  ('maserati',      'sebring series ii',          'maserati sebring series ii',               5),
  ('lotus',         'cortina mk1',                'lotus cortina mk1',                        12),
  ('lotus',         'super seven',                'lotus super seven',                        11),
  ('bmw',           '633csi 5-speed',             'bmw 633csi 5-speed',                       26),
  ('bmw',           'r90s',                       'bmw r90s',                                 45),
  ('saab',          '96',                         'saab 96',                                  33),
  ('honda',         's600 roadster',              'honda s600 roadster',                      11),
  ('nissan',        'patrol 4×4',                 'nissan patrol 4×4',                        19),
  ('hummer',        'h3t alpha',                  'hummer h3t alpha',                         15),
  ('hudson',        'hornet',                     'hudson hornet',                            17),
  ('international', 'travelall',                  'international travelall',                  18),
  ('kawasaki',      'h2 750',                     'kawasaki h2 750',                          19),
  ('superformance', 'gt40 mki',                   'superformance gt40 mki',                   8);

\ir ../migrations/20261015090000_model_family_names.sql
\ir ../migrations/20261018066000_family_keys_existing_stubs_and_classics.sql
REFRESH MATERIALIZED VIEW public.mv_model_family_names;

SELECT pg_temp.ok('after: Superformance MkIII and Austin-Healey 3000 year bounds are widened',
  (SELECT year_start FROM public.canonical_models WHERE id = '10000000-0000-4000-a000-000000000009') = 1930
  AND (SELECT year_start FROM public.canonical_models WHERE id = '10000000-0000-4000-a000-000000000005') = 1958
  AND (SELECT year_end FROM public.canonical_models WHERE id = '10000000-0000-4000-a000-000000000005') IS NULL);

SELECT pg_temp.ok('after: existing stubs and newly inserted classic families key cleanly',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mercedes-benz' AND model_l = 'cls550') = 'CLS-Class'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mercedes-benz' AND model_l = 'ml350') = 'M-Class'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mercedes-benz' AND model_l = 'r63 amg') = 'R-Class'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'audi' AND model_l = 'a8l w12') = 'A8'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'austin-healey' AND model_l = 'bj8') = '3000'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'fiat' AND model_l = '124 sport spider') = '124 Spider'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mazda' AND model_l = 'rx7') = 'RX-7'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'porsche' AND model_l = '924s') = '924'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'bentley' AND model_l = '3 1/2 litre drophead coupe') = '3 1/2 Litre'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'maserati' AND model_l = 'sebring series ii') = 'Sebring'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'lotus' AND model_l = 'cortina mk1') = 'Cortina'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'lotus' AND model_l = 'super seven') = 'Seven'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'bmw' AND model_l = '633csi 5-speed') = '6 Series'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'bmw' AND model_l = 'r90s') = 'R90S'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'saab' AND model_l = '96') = '96'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'honda' AND model_l = 's600 roadster') = 'S600'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'nissan' AND model_l = 'patrol 4×4') = 'Patrol'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'hummer' AND model_l = 'h3t alpha') = 'H3'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'hudson' AND model_l = 'hornet') = 'Hornet'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'international' AND model_l = 'travelall') = 'Travelall'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'kawasaki' AND model_l = 'h2 750') = 'H2'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'superformance' AND model_l = 'gt40 mki') = 'GT40');

CREATE TEMP TABLE once AS SELECT id, year_start, year_end, notes, aliases FROM public.canonical_models;
\ir ../migrations/20261018066000_family_keys_existing_stubs_and_classics.sql
SELECT pg_temp.ok('a second apply changes nothing',
  NOT EXISTS (SELECT id, year_start, year_end, notes, aliases FROM public.canonical_models
              EXCEPT SELECT id, year_start, year_end, notes, aliases FROM once)
  AND NOT EXISTS (SELECT id, year_start, year_end, notes, aliases FROM once
                  EXCEPT SELECT id, year_start, year_end, notes, aliases FROM public.canonical_models));
