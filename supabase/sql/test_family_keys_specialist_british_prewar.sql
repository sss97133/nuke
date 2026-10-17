-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_family_keys_specialist_british_prewar -f this-file.sql
-- Contract for 20261018067000_family_keys_specialist_british_prewar.sql. Synthetic rows only; never production.
-- Verifies that:
-- 1. Restrictive year bounds on existing canonical_models rows (GMC Suburban, BMW M Coupe, Lincoln Zephyr,
--    Mercury Custom, Shelby Cobra) are widened and cleared where appropriate.
-- 2. Newly inserted pre-war brass/coachbuilt, British specialist, Datsun, classic American, and JDM/moto
--    families (Locomobile Model 48, Crane-Simplex Model 5, Lister-Chevrolet Sports Racer, Delage D8,
--    Stutz Bearcat, Jensen Interceptor, Caterham Seven, TVR Griffith, Chevrolet Custom, Mercury Eight,
--    Plymouth Deluxe, Datsun 260Z / Roadster / Pickup, Suzuki Carry / Jimny / GSX-R, Yamaha RD350 / Banshee,
--    Isuzu VehiCROSS, Peugeot 205, Renault Dauphine, BMW Bavaria) and expanded existing families key cleanly.
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
  ('10000000-0000-4000-a000-000000000001', 'GMC',        'Suburban', 1967, 1999, ARRAY['gmc suburban']),
  ('10000000-0000-4000-a000-000000000002', 'BMW',        'M Coupe',  1998, 2002, ARRAY['m coupe']),
  ('10000000-0000-4000-a000-000000000003', 'Lincoln',    'Zephyr',   1936, 1942, ARRAY['zephyr']),
  ('10000000-0000-4000-a000-000000000004', 'Mercury',    'Custom',   1949, NULL, ARRAY['custom']),
  ('10000000-0000-4000-a000-000000000005', 'Shelby',     'Cobra',    1962, 1967, ARRAY['cobra']),
  ('10000000-0000-4000-a000-000000000006', 'Alfa Romeo', 'Spider',   1966, 1994, ARRAY['spider']),
  ('10000000-0000-4000-a000-000000000007', 'Buick',      'GS',       1965, 1975, ARRAY['gs']),
  ('10000000-0000-4000-a000-000000000008', 'BMW',        '2002',     1968, 1976, ARRAY['2002']);

INSERT INTO public.mv_vehicle_name_dictionary (make_l, model_l, name_l, vehicles) VALUES
  ('locomobile',       'model 48 sportif',                  'locomobile model 48 sportif',                  4),
  ('crane-simplex',    'model 5',                           'crane-simplex model 5',                        4),
  ('lister-chevrolet', 'sports racer',                      'lister-chevrolet sports racer',                3),
  ('delage',           'd8-120',                            'delage d8-120',                                5),
  ('stutz',            'series k bearcat',                  'stutz series k bearcat',                       4),
  ('jensen',           'interceptor mk iii',                'jensen interceptor mk iii',                    19),
  ('caterham',         'super seven',                       'caterham super seven',                         41),
  ('tvr',              '2500m',                             'tvr 2500m',                                    25),
  ('chevrolet',        'custom coupe',                      'chevrolet custom coupe',                       15),
  ('mercury',          'eight coupe',                       'mercury eight coupe',                          14),
  ('mercury',          'grand marquis',                     'mercury grand marquis',                        40),
  ('plymouth',         'special deluxe',                    'plymouth special deluxe',                      17),
  ('datsun',           '260z',                              'datsun 260z',                                  40),
  ('datsun',           '1600 roadster',                     'datsun 1600 roadster',                         21),
  ('datsun',           '620 pickup',                        'datsun 620 pickup',                            12),
  ('suzuki',           'carry pickup 4wd 5-speed',          'suzuki carry pickup 4wd 5-speed',              39),
  ('suzuki',           'jimny',                             'suzuki jimny',                                 18),
  ('suzuki',           'gsx1300r hayabusa',                 'suzuki gsx1300r hayabusa',                     12),
  ('yamaha',           'rd400',                             'yamaha rd400',                                 19),
  ('yamaha',           'banshee',                           'yamaha banshee',                               23),
  ('isuzu',            'vehicross',                         'isuzu vehicross',                              28),
  ('peugeot',          '205 gti 1.9',                       'peugeot 205 gti 1.9',                          7),
  ('renault',          'dauphine 4-speed',                  'renault dauphine 4-speed',                     6),
  ('bmw',              'bavaria',                           'bmw bavaria',                                  29),
  ('bmw',              '2002ti',                            'bmw 2002ti',                                   6),
  ('gmc',              'yukon denali',                      'gmc yukon denali',                             29),
  ('shelby',           'five racing mk4 roadster',          'shelby five racing mk4 roadster',              10),
  ('alfa romeo',       'veloce',                            'alfa romeo veloce',                            27),
  ('buick',            'gs455 convertible',                 'buick gs455 convertible',                      3);

\ir ../migrations/20261015090000_model_family_names.sql
\ir ../migrations/20261018067000_family_keys_specialist_british_prewar.sql
REFRESH MATERIALIZED VIEW public.mv_model_family_names;

SELECT pg_temp.ok('after: GMC Suburban, BMW M Coupe, Lincoln Zephyr, and Mercury Custom year bounds are widened',
  (SELECT year_start FROM public.canonical_models WHERE id = '10000000-0000-4000-a000-000000000001') = 1935
  AND (SELECT year_end FROM public.canonical_models WHERE id = '10000000-0000-4000-a000-000000000001') IS NULL
  AND (SELECT year_end FROM public.canonical_models WHERE id = '10000000-0000-4000-a000-000000000002') IS NULL
  AND (SELECT year_start FROM public.canonical_models WHERE id = '10000000-0000-4000-a000-000000000003') = 1935
  AND (SELECT year_end FROM public.canonical_models WHERE id = '10000000-0000-4000-a000-000000000003') IS NULL
  AND (SELECT year_start FROM public.canonical_models WHERE id = '10000000-0000-4000-a000-000000000004') = 1938);

SELECT pg_temp.ok('after: newly inserted and expanded specialist/classic/moto families key cleanly',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'locomobile' AND model_l = 'model 48 sportif') = 'Model 48'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'crane-simplex' AND model_l = 'model 5') = 'Model 5'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'lister-chevrolet' AND model_l = 'sports racer') = 'Sports Racer'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'delage' AND model_l = 'd8-120') = 'D8'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'stutz' AND model_l = 'series k bearcat') = 'Bearcat'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'jensen' AND model_l = 'interceptor mk iii') = 'Interceptor'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'caterham' AND model_l = 'super seven') = 'Seven'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'tvr' AND model_l = '2500m') = 'Griffith'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'custom coupe') = 'Custom'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mercury' AND model_l = 'eight coupe') = 'Eight'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mercury' AND model_l = 'grand marquis') = 'Grand Marquis'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'plymouth' AND model_l = 'special deluxe') = 'Deluxe'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'datsun' AND model_l = '260z') = '260Z'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'datsun' AND model_l = '1600 roadster') = 'Roadster'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'datsun' AND model_l = '620 pickup') = 'Pickup'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'suzuki' AND model_l = 'carry pickup 4wd 5-speed') = 'Carry'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'suzuki' AND model_l = 'jimny') = 'Jimny'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'suzuki' AND model_l = 'gsx1300r hayabusa') = 'GSX-R'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'yamaha' AND model_l = 'rd400') = 'RD350'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'yamaha' AND model_l = 'banshee') = 'Banshee'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'isuzu' AND model_l = 'vehicross') = 'VehiCROSS'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'peugeot' AND model_l = '205 gti 1.9') = '205'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'renault' AND model_l = 'dauphine 4-speed') = 'Dauphine'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'bmw' AND model_l = 'bavaria') = 'Bavaria'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'bmw' AND model_l = '2002ti') = '2002'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'gmc' AND model_l = 'yukon denali') = 'Suburban'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'shelby' AND model_l = 'five racing mk4 roadster') = 'Cobra'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'alfa romeo' AND model_l = 'veloce') = 'Spider'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'buick' AND model_l = 'gs455 convertible') = 'GS');

CREATE TEMP TABLE once AS SELECT id, year_start, year_end, notes, aliases FROM public.canonical_models;
\ir ../migrations/20261018067000_family_keys_specialist_british_prewar.sql
SELECT pg_temp.ok('a second apply changes nothing',
  NOT EXISTS (SELECT id, year_start, year_end, notes, aliases FROM public.canonical_models
              EXCEPT SELECT id, year_start, year_end, notes, aliases FROM once)
  AND NOT EXISTS (SELECT id, year_start, year_end, notes, aliases FROM once
                  EXCEPT SELECT id, year_start, year_end, notes, aliases FROM public.canonical_models));
