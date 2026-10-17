-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_fix_name_dictionary_timeout_and_custom_aliases -f this-file.sql
-- Contract for 20261018068000_fix_name_dictionary_timeout_and_custom_aliases.sql. Synthetic rows only; never production.
-- Verifies that:
-- 1. cron.job `refresh-vehicle-name-dictionary` is updated to include `SET statement_timeout = '300s'`.
-- 2. Catch-all Custom/Deluxe families match standalone "Custom" / "Custom Coupe" via 1-word `'custom'`
--    WITHOUT hijacking `"Corvette Custom Convertible"`, `"Camaro Custom Coupe"`, `"Mustang Custom Convertible"`,
--    or `"Barracuda Custom Coupe"`.
-- 3. Pre-war Harley-Davidson / Indian year bounds widen, GMC K10 / Ducati Paul Smart 1000 / Maserati 5000 GT
--    and 15 specialist marques key cleanly.
-- 4. Applying the migration a second time is idempotent and changes nothing.
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

INSERT INTO cron.job (jobname, schedule, command) VALUES
  ('refresh-vehicle-name-dictionary', '50 3 * * *', 'REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_vehicle_name_dictionary');

CREATE TABLE public.canonical_makes (id uuid PRIMARY KEY, canonical_name text, display_name text, short_name text,
  aliases text[], country_of_origin text, founded_year integer, parent_company text, is_active boolean,
  created_at timestamptz, brand_tier text);
CREATE TABLE public.canonical_models (id uuid PRIMARY KEY, make text, canonical_model text, canonical_series text,
  year_start integer, year_end integer, body_styles text[], aliases text[], generation text, notes text, created_at timestamptz);
CREATE TABLE public.mv_vehicle_name_dictionary (make_l text, model_l text, name_l text, vehicles bigint,
  PRIMARY KEY (make_l, model_l));

INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases) VALUES
  ('10000000-0000-4000-a000-000000000001', 'Chevrolet',       'Corvette',     1953, NULL, ARRAY['corvette']),
  ('10000000-0000-4000-a000-000000000002', 'Chevrolet',       'Camaro',       1966, NULL, ARRAY['camaro']),
  ('10000000-0000-4000-a000-000000000003', 'Chevrolet',       'Nova',         1962, 1979, ARRAY['nova']),
  ('10000000-0000-4000-a000-000000000004', 'Chevrolet',       'Impala',       1958, 2020, ARRAY['impala']),
  ('10000000-0000-4000-a000-000000000005', 'Chevrolet',       'Custom',       1915, NULL, ARRAY['custom', 'custom coupe', 'custom convertible', '4-speed']),
  ('10000000-0000-4000-a000-000000000006', 'Ford',            'Mustang',      1964, NULL, ARRAY['mustang']),
  ('10000000-0000-4000-a000-000000000007', 'Ford',            'Custom',       1920, NULL, ARRAY['custom', 'custom coupe', 'custom convertible']),
  ('10000000-0000-4000-a000-000000000008', 'Plymouth',        'Barracuda',    1964, 1974, ARRAY['barracuda']),
  ('10000000-0000-4000-a000-000000000009', 'Plymouth',        'Deluxe',       1928, NULL, ARRAY['special deluxe', 'deluxe', 'custom', 'custom coupe', '2 door coupe']),
  ('10000000-0000-4000-a000-000000000010', 'GMC',             'K1500',        1973, 1998, ARRAY['k1500']),
  ('10000000-0000-4000-a000-000000000011', 'Harley-Davidson', 'EL',           1936, NULL, ARRAY['el', 'single', 'twin', 'model j']),
  ('10000000-0000-4000-a000-000000000012', 'Indian',          'Four',         1915, NULL, ARRAY['four', 'twin']),
  ('10000000-0000-4000-a000-000000000013', 'Ducati',          'SportClassic', 2001, NULL, ARRAY['sportclassic']),
  ('10000000-0000-4000-a000-000000000014', 'Maserati',        '3500 GT',      1957, NULL, ARRAY['3500 gt']);

INSERT INTO public.mv_vehicle_name_dictionary (make_l, model_l, name_l, vehicles) VALUES
  ('chevrolet',       'corvette custom convertible',      'chevrolet corvette custom convertible',      438),
  ('chevrolet',       'camaro custom coupe',              'chevrolet camaro custom coupe',              321),
  ('chevrolet',       'nova custom coupe',                'chevrolet nova custom coupe',                82),
  ('chevrolet',       'impala custom coupe',              'chevrolet impala custom coupe',              31),
  ('chevrolet',       'custom coupe',                     'chevrolet custom coupe',                     15),
  ('ford',            'mustang custom convertible',       'ford mustang custom convertible',            77),
  ('ford',            'custom coupe',                     'ford custom coupe',                          74),
  ('plymouth',        'barracuda custom coupe',           'plymouth barracuda custom coupe',            18),
  ('plymouth',        '''cuda custom coupe',              'plymouth ''cuda custom coupe',               15),
  ('plymouth',        'special deluxe',                   'plymouth special deluxe',                    17),
  ('gmc',             'k10',                              'gmc k10',                                    8),
  ('ducati',          'paul smart 1000 limited edition',  'ducati paul smart 1000 limited edition',     20),
  ('maserati',        '5000 gt coupe',                    'maserati 5000 gt coupe',                     3),
  ('nash-healey',     'roadster',                         'nash-healey roadster',                       7),
  ('intermeccanica',  'italia spyder',                    'intermeccanica italia spyder',               6),
  ('messerschmitt',   'kr200',                            'messerschmitt kr200',                        23),
  ('noble',           'm400',                             'noble m400',                                 12),
  ('daimler',         'sp250',                            'daimler sp250',                              17);

\ir ../migrations/20261015090000_model_family_names.sql
\ir ../migrations/20261018068000_fix_name_dictionary_timeout_and_custom_aliases.sql
REFRESH MATERIALIZED VIEW public.mv_model_family_names;

SELECT pg_temp.ok('after: cron job refresh-vehicle-name-dictionary sets statement_timeout = 300s',
  (SELECT command FROM cron.job WHERE jobname = 'refresh-vehicle-name-dictionary') LIKE 'SET statement_timeout = ''300s'';%');

SELECT pg_temp.ok('after: Harley-Davidson EL and Indian Four year bounds are widened to pre-war',
  (SELECT year_start FROM public.canonical_models WHERE id = '10000000-0000-4000-a000-000000000011') = 1903
  AND (SELECT year_start FROM public.canonical_models WHERE id = '10000000-0000-4000-a000-000000000012') = 1901);

SELECT pg_temp.ok('after: Corvette, Camaro, Nova, Impala, Mustang, and Barracuda are not hijacked by Custom/Deluxe',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'corvette custom convertible') = 'Corvette'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'camaro custom coupe') = 'Camaro'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'nova custom coupe') = 'Nova'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'impala custom coupe') = 'Impala'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'custom coupe') = 'Custom'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ford' AND model_l = 'mustang custom convertible') = 'Mustang'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ford' AND model_l = 'custom coupe') = 'Custom'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'plymouth' AND model_l = 'barracuda custom coupe') = 'Barracuda'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'plymouth' AND model_l = '''cuda custom coupe') = 'Barracuda'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'plymouth' AND model_l = 'special deluxe') = 'Deluxe'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'gmc' AND model_l = 'k10') = 'K1500'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ducati' AND model_l = 'paul smart 1000 limited edition') = 'SportClassic'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'maserati' AND model_l = '5000 gt coupe') = '3500 GT'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'nash-healey' AND model_l = 'roadster') = 'Roadster'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'intermeccanica' AND model_l = 'italia spyder') = 'Italia'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'messerschmitt' AND model_l = 'kr200') = 'KR200'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'noble' AND model_l = 'm400') = 'M400'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'daimler' AND model_l = 'sp250') = 'SP250');

CREATE TEMP TABLE once AS SELECT id, year_start, year_end, notes, aliases FROM public.canonical_models;
\ir ../migrations/20261018068000_fix_name_dictionary_timeout_and_custom_aliases.sql
SELECT pg_temp.ok('a second apply changes nothing',
  NOT EXISTS (SELECT id, year_start, year_end, notes, aliases FROM public.canonical_models
              EXCEPT SELECT id, year_start, year_end, notes, aliases FROM once)
  AND NOT EXISTS (SELECT id, year_start, year_end, notes, aliases FROM once
                  EXCEPT SELECT id, year_start, year_end, notes, aliases FROM public.canonical_models));
