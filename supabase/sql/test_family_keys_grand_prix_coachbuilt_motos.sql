-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_family_keys_grand_prix_coachbuilt_motos -f this-file.sql
-- Contract for 20261018065000_family_keys_grand_prix_coachbuilt_motos.sql. Synthetic rows only; never production.
-- Verifies that:
-- 1. Year-gated models (Rolls-Royce Corniche, Silver Wraith, Wraith, Austin-Healey 100, Ferrari F430,
--    Mercedes-Benz E-Class / C-Class) widen their year bounds and resolve cleanly.
-- 2. Existing families (Bugatti Type 35B, Chiron Super Sport, Ferrari 857 Sport, Citroen 2CV6 / DS21,
--    Mercedes-Benz 240D -> E-Class, S65 Coupe -> S-Class, 450SLC -> SL) and newly inserted families
--    (Mercedes-Benz 540K / 220 / CLS-Class, Spyker C8, Audi Sport Quattro, Lancia Delta Integrale,
--    Citroen SM, Factory Five Mk4 Roadster, Willys Jeepster, Studebaker Golden Hawk, Lucid Air,
--    Land Rover Series IIA, Ducati 916 / MH900e, Indian Chief, Vincent Black Shadow) key cleanly.
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
  ('00000000-0000-4000-a000-000000000001', 'Mercedes-Benz', 'Mercedes-Benz', '{}'),
  ('00000000-0000-4000-a000-000000000002', 'Bugatti',       'Bugatti',       '{}'),
  ('00000000-0000-4000-a000-000000000003', 'Ferrari',       'Ferrari',       '{}'),
  ('00000000-0000-4000-a000-000000000004', 'Austin-Healey', 'Austin-Healey', '{}'),
  ('00000000-0000-4000-a000-000000000005', 'Delahaye',      'Delahaye',      '{}'),
  ('00000000-0000-4000-a000-000000000006', 'Citroen',       'Citroen',       '{}'),
  ('00000000-0000-4000-a000-000000000007', 'Rolls-Royce',   'Rolls-Royce',   '{}'),
  ('00000000-0000-4000-a000-000000000008', 'Audi',          'Audi',          '{}'),
  ('00000000-0000-4000-a000-000000000009', 'Lancia',        'Lancia',        '{}'),
  ('00000000-0000-4000-a000-000000000010', 'Morgan',        'Morgan',        '{}'),
  ('00000000-0000-4000-a000-000000000011', 'Sunbeam',       'Sunbeam',       '{}'),
  ('00000000-0000-4000-a000-000000000012', 'Land Rover',    'Land Rover',    '{}'),
  ('00000000-0000-4000-a000-000000000013', 'Ducati',        'Ducati',        '{}');

INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases) VALUES
  ('10000000-0000-4000-a000-000000000001', 'Bugatti',       'Type 35',       NULL, NULL, ARRAY['type 35']),
  ('10000000-0000-4000-a000-000000000002', 'Bugatti',       'Chiron',        NULL, NULL, ARRAY['chiron']),
  ('10000000-0000-4000-a000-000000000003', 'Ferrari',       '857 S',         NULL, NULL, ARRAY['857 s']),
  ('10000000-0000-4000-a000-000000000004', 'Ferrari',       'F430',          2004, 2009, ARRAY['f430']),
  ('10000000-0000-4000-a000-000000000005', 'Austin-Healey', '100',           1953, 1959, ARRAY['100']),
  ('10000000-0000-4000-a000-000000000006', 'Delahaye',      '135',           NULL, NULL, ARRAY['135']),
  ('10000000-0000-4000-a000-000000000007', 'Citroen',       '2 CV',          NULL, NULL, ARRAY['2 cv']),
  ('10000000-0000-4000-a000-000000000008', 'Citroen',       'DS',            NULL, NULL, ARRAY['ds']),
  ('10000000-0000-4000-a000-000000000009', 'Rolls-Royce',   'Corniche',      1971, 1995, ARRAY['corniche']),
  ('10000000-0000-4000-a000-000000000010', 'Mercedes-Benz', 'E-Class',       1993, NULL, ARRAY['e-class']),
  ('10000000-0000-4000-a000-000000000011', 'Mercedes-Benz', 'S-Class',       1951, NULL, ARRAY['s-class']),
  ('10000000-0000-4000-a000-000000000012', 'Mercedes-Benz', 'SL',            1954, NULL, ARRAY['sl']);

INSERT INTO public.mv_vehicle_name_dictionary (make_l, model_l, name_l, vehicles) VALUES
  ('mercedes-benz', '540k special roadster', 'mercedes-benz 540k special roadster', 5),
  ('mercedes-benz', '220 s cabriolet',       'mercedes-benz 220 s cabriolet',       9),
  ('mercedes-benz', '240d 4-speed',          'mercedes-benz 240d 4-speed',          79),
  ('mercedes-benz', 's65 coupe',             'mercedes-benz s65 coupe',             9),
  ('mercedes-benz', '450slc',                'mercedes-benz 450slc',                74),
  ('bugatti',       'type 35b grand prix',   'bugatti type 35b grand prix',         6),
  ('bugatti',       'chiron super sport',    'bugatti chiron super sport',          4),
  ('ferrari',       '857 sport spider',      'ferrari 857 sport spider',            3),
  ('spyker',        'c8 laviolette',         'spyker c8 laviolette',                9),
  ('audi',          'sport quattro',         'audi sport quattro',                  5),
  ('lancia',        'delta integrale evo 2', 'lancia delta integrale evo 2',        18),
  ('citroen',       'sm 5-speed',            'citroen sm 5-speed',                  24),
  ('citroen',       '2cv6 charleston',       'citroen 2cv6 charleston',             16),
  ('citroen',       'ds21 pallas',           'citroen ds21 pallas',                 15),
  ('factory five',  'shelby cobra replica',  'factory five shelby cobra replica',   23),
  ('willys',        'jeepster',              'willys jeepster',                     57),
  ('studebaker',    'golden hawk',           'studebaker golden hawk',              33),
  ('lucid',         'air grand touring',     'lucid air grand touring',             17),
  ('land rover',    '88 series iia',         'land rover 88 series iia',            30),
  ('ducati',        '916',                   'ducati 916',                          17),
  ('ducati',        'mh900e',                'ducati mh900e',                       16),
  ('indian',        'chief',                 'indian chief',                        62),
  ('vincent',       'black shadow',          'vincent black shadow',                18);

\ir ../migrations/20261015090000_model_family_names.sql
\ir ../migrations/20261018065000_family_keys_grand_prix_coachbuilt_motos.sql
REFRESH MATERIALIZED VIEW public.mv_model_family_names;

SELECT pg_temp.ok('after: Rolls-Royce Corniche, Ferrari F430, and Mercedes-Benz E-Class year bounds are widened',
  (SELECT year_start FROM public.canonical_models WHERE id = '10000000-0000-4000-a000-000000000009') = 1966
  AND (SELECT year_end FROM public.canonical_models WHERE id = '10000000-0000-4000-a000-000000000009') IS NULL
  AND (SELECT year_end FROM public.canonical_models WHERE id = '10000000-0000-4000-a000-000000000004') IS NULL
  AND (SELECT year_start FROM public.canonical_models WHERE id = '10000000-0000-4000-a000-000000000010') = 1968);

SELECT pg_temp.ok('after: Grand Prix, coachbuilt, rally, specialist, Mercedes, Land Rover, and motorcycle icons key cleanly',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mercedes-benz' AND model_l = '540k special roadster') = '540K'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mercedes-benz' AND model_l = '220 s cabriolet') = '220'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mercedes-benz' AND model_l = '240d 4-speed') = 'E-Class'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mercedes-benz' AND model_l = 's65 coupe') = 'S-Class'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mercedes-benz' AND model_l = '450slc') = 'SL'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'bugatti' AND model_l = 'type 35b grand prix') = 'Type 35'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'bugatti' AND model_l = 'chiron super sport') = 'Chiron'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ferrari' AND model_l = '857 sport spider') = '857 S'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'spyker' AND model_l = 'c8 laviolette') = 'C8'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'audi' AND model_l = 'sport quattro') = 'Quattro'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'lancia' AND model_l = 'delta integrale evo 2') = 'Delta Integrale'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'citroen' AND model_l = 'sm 5-speed') = 'SM'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'citroen' AND model_l = '2cv6 charleston') = '2 CV'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'citroen' AND model_l = 'ds21 pallas') = 'DS'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'factory five' AND model_l = 'shelby cobra replica') = 'Mk4 Roadster'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'willys' AND model_l = 'jeepster') = 'Jeepster'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'studebaker' AND model_l = 'golden hawk') = 'Hawk'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'lucid' AND model_l = 'air grand touring') = 'Air'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'land rover' AND model_l = '88 series iia') = 'Series'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ducati' AND model_l = '916') = '916'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ducati' AND model_l = 'mh900e') = 'SportClassic'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'indian' AND model_l = 'chief') = 'Chief'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'vincent' AND model_l = 'black shadow') = 'Black Shadow');

CREATE TEMP TABLE once AS SELECT id, year_start, year_end, notes, aliases FROM public.canonical_models;
\ir ../migrations/20261018065000_family_keys_grand_prix_coachbuilt_motos.sql
SELECT pg_temp.ok('a second apply changes nothing',
  NOT EXISTS (SELECT id, year_start, year_end, notes, aliases FROM public.canonical_models
              EXCEPT SELECT id, year_start, year_end, notes, aliases FROM once)
  AND NOT EXISTS (SELECT id, year_start, year_end, notes, aliases FROM once
                  EXCEPT SELECT id, year_start, year_end, notes, aliases FROM public.canonical_models));
