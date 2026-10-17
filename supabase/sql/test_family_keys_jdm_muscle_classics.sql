-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_family_keys_jdm_muscle_classics -f this-file.sql
-- Contract for 20261018064000_family_keys_jdm_muscle_classics.sql. Synthetic rows only; never production.
-- Verifies that:
-- 1. Year-gated models (1956 Cadillac Coupe de Ville, 1936 Ford Custom Coupe, 1972 Chevrolet Cheyenne)
--    widen their year bounds and resolve cleanly.
-- 2. JDM icons (Toyota 2000GT, FJ-40 -> Land Cruiser, Nissan Figaro, Skyline, 2000 Roadster, 510,
--    Honda CRX Si, Mitsubishi Pajero Evolution) and American muscle/classics (Chrysler 300G,
--    Town & Country, Buick GSX, Buick Super, Mercury Marauder, Mercury Monterey, Pontiac Chieftain,
--    Oldsmobile Vista Cruiser, Chevrolet Yenko Deuce -> Nova, Ford Econoline, BMW 535is -> 5 Series,
--    Maserati A6G/54 Berlinetta) key to their canonical families.
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

INSERT INTO public.canonical_makes (id, canonical_name, display_name, aliases) VALUES
  ('00000000-0000-4000-a000-000000000001', 'Toyota',     'Toyota',     '{}'),
  ('00000000-0000-4000-a000-000000000002', 'Nissan',     'Nissan',     ARRAY['datsun']),
  ('00000000-0000-4000-a000-000000000003', 'Honda',      'Honda',      '{}'),
  ('00000000-0000-4000-a000-000000000004', 'Mitsubishi', 'Mitsubishi', '{}'),
  ('00000000-0000-4000-a000-000000000005', 'Chrysler',   'Chrysler',   '{}'),
  ('00000000-0000-4000-a000-000000000006', 'Mercury',    'Mercury',    '{}'),
  ('00000000-0000-4000-a000-000000000007', 'Buick',      'Buick',      '{}'),
  ('00000000-0000-4000-a000-000000000008', 'Pontiac',    'Pontiac',    '{}'),
  ('00000000-0000-4000-a000-000000000009', 'Oldsmobile', 'Oldsmobile', '{}'),
  ('00000000-0000-4000-a000-000000000010', 'Cadillac',   'Cadillac',   '{}'),
  ('00000000-0000-4000-a000-000000000011', 'Ford',       'Ford',       '{}'),
  ('00000000-0000-4000-a000-000000000012', 'Chevrolet',  'Chevrolet',  '{}'),
  ('00000000-0000-4000-a000-000000000013', 'BMW',        'BMW',        '{}'),
  ('00000000-0000-4000-a000-000000000014', 'Maserati',   'Maserati',   '{}');

INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases) VALUES
  ('10000000-0000-4000-a000-000000000001', 'Toyota',    'Land Cruiser', 1951, NULL, ARRAY['land cruiser', 'fj40']),
  ('10000000-0000-4000-a000-000000000002', 'Chrysler',  '300',          NULL, NULL, ARRAY['300']),
  ('10000000-0000-4000-a000-000000000003', 'Buick',     'GS',           1965, 1972, ARRAY['gs', 'gran sport']),
  ('10000000-0000-4000-a000-000000000004', 'Cadillac',  'DeVille',      1959, 2005, ARRAY['deville', 'coupe deville']),
  ('10000000-0000-4000-a000-000000000005', 'Ford',      'Custom',       1949, 1981, ARRAY['custom', 'custom coupe']),
  ('10000000-0000-4000-a000-000000000006', 'Ford',      'Coupe',        1917, 1940, ARRAY['coupe', '3 window coupe']),
  ('10000000-0000-4000-a000-000000000007', 'CHEVROLET', 'Nova',         1962, 1988, ARRAY['nova', 'chevy ii']),
  ('10000000-0000-4000-a000-000000000008', 'Chevrolet', 'C10',          1960, 1987, ARRAY['c10', 'c-10']),
  ('10000000-0000-4000-a000-000000000009', 'BMW',       '5 Series',     1972, NULL, ARRAY['525i', '535i']);

INSERT INTO public.mv_vehicle_name_dictionary (make_l, model_l, name_l, vehicles) VALUES
  ('toyota',     '2000gt',                    'toyota 2000gt',                    4),
  ('toyota',     'fj-40',                     'toyota fj-40',                     22),
  ('nissan',     'figaro',                    'nissan figaro',                    101),
  ('nissan',     'skyline',                   'nissan skyline',                   24),
  ('nissan',     '2000 roadster',             'nissan 2000 roadster',             54),
  ('nissan',     '510 5-speed',               'nissan 510 5-speed',               33),
  ('honda',      'crx si',                    'honda crx si',                     46),
  ('mitsubishi', 'pajero evolution',          'mitsubishi pajero evolution',      27),
  ('chrysler',   '300g convertible',          'chrysler 300g convertible',        18),
  ('chrysler',   'town & country convertible','chrysler town & country convertible', 18),
  ('buick',      'gsx',                       'buick gsx',                        18),
  ('buick',      'super',                     'buick super',                      45),
  ('mercury',    'marauder',                  'mercury marauder',                 81),
  ('mercury',    'monterey',                  'mercury monterey',                 55),
  ('pontiac',    'chieftain',                 'pontiac chieftain',                31),
  ('oldsmobile', 'vista cruiser',             'oldsmobile vista cruiser',         27),
  ('chevrolet',  'yenko deuce',               'chevrolet yenko deuce',            8),
  ('chevrolet',  'cheyenne',                  'chevrolet cheyenne',               27),
  ('ford',       '5 window',                  'ford 5 window',                    28),
  ('ford',       'econoline',                 'ford econoline',                   41),
  ('bmw',        '535is 5-speed',             'bmw 535is 5-speed',                40),
  ('maserati',   'a6g/54 berlinetta',         'maserati a6g/54 berlinetta',       5);

\ir ../migrations/20261015090000_model_family_names.sql
\ir ../migrations/20261018064000_family_keys_jdm_muscle_classics.sql
REFRESH MATERIALIZED VIEW public.mv_model_family_names;

SELECT pg_temp.ok('after: Cadillac DeVille and Ford Custom year bounds are widened',
  (SELECT year_start FROM public.canonical_models WHERE id = '10000000-0000-4000-a000-000000000004') = 1949
  AND (SELECT year_end FROM public.canonical_models WHERE id = '10000000-0000-4000-a000-000000000004') IS NULL
  AND (SELECT year_start FROM public.canonical_models WHERE id = '10000000-0000-4000-a000-000000000005') = 1920
  AND (SELECT year_end FROM public.canonical_models WHERE id = '10000000-0000-4000-a000-000000000005') IS NULL);

SELECT pg_temp.ok('after: JDM icons (2000GT, FJ-40, Figaro, Skyline, 2000 Roadster, 510, CRX Si, Pajero Evolution) key cleanly',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'toyota' AND model_l = '2000gt') = '2000GT'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'toyota' AND model_l = 'fj-40') = 'Land Cruiser'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'nissan' AND model_l = 'figaro') = 'Figaro'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'nissan' AND model_l = 'skyline') = 'Skyline'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'nissan' AND model_l = '2000 roadster') = 'Roadster'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'nissan' AND model_l = '510 5-speed') = '510'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'honda' AND model_l = 'crx si') = 'CRX'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mitsubishi' AND model_l = 'pajero evolution') = 'Pajero');

SELECT pg_temp.ok('after: American muscle/classics and European icons key cleanly',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chrysler' AND model_l = '300g convertible') = '300'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chrysler' AND model_l = 'town & country convertible') = 'Town & Country'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'buick' AND model_l = 'gsx') = 'GS'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'buick' AND model_l = 'super') = 'Super'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mercury' AND model_l = 'marauder') = 'Marauder'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mercury' AND model_l = 'monterey') = 'Monterey'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'pontiac' AND model_l = 'chieftain') = 'Chieftain'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'oldsmobile' AND model_l = 'vista cruiser') = 'Vista Cruiser'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'yenko deuce') = 'Nova'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'cheyenne') = 'C10'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ford' AND model_l = '5 window') = 'Coupe'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ford' AND model_l = 'econoline') = 'Econoline'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'bmw' AND model_l = '535is 5-speed') = '5 Series'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'maserati' AND model_l = 'a6g/54 berlinetta') = 'A6G');

CREATE TEMP TABLE once AS SELECT id, year_start, year_end, notes, aliases FROM public.canonical_models;
\ir ../migrations/20261018064000_family_keys_jdm_muscle_classics.sql
SELECT pg_temp.ok('a second apply changes nothing',
  NOT EXISTS (SELECT id, year_start, year_end, notes, aliases FROM public.canonical_models
              EXCEPT SELECT id, year_start, year_end, notes, aliases FROM once)
  AND NOT EXISTS (SELECT id, year_start, year_end, notes, aliases FROM once
                  EXCEPT SELECT id, year_start, year_end, notes, aliases FROM public.canonical_models));
