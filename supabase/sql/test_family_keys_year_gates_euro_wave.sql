-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_family_keys_year_gates_euro_wave -f this-file.sql
-- Contract for 20261018063000_family_keys_year_gates_euro_wave.sql. Synthetic rows only; never production.
-- Verifies that year-gated models (Silver Ghost, 2026 Corvette, 1959 Porsche 718 RSK, 1989 Mercedes 560SEC),
-- consolidated Ferrari 250 / Duesenberg Model J variants, and newly added European/Pre-War/Japanese/EV families
-- (Mercedes 230SL/190E/300TD, BMW 3.0CS, Volvo P1800/V70R, Land Rover Defender 110, Lexus LS430, Porsche 356SC,
-- Audi RS3, McLaren 12C, Tesla Roadster/Model S, Rivian R1T/R1S, Maserati A6G/MC12, Packard 734 Speedster,
-- Talbot-Lago T150-C-SS, Ruf CTR, Fiat 8V, Dodge Ram 1500 TRX / D100) resolve cleanly in mv_model_family_names
-- and that a second apply changes nothing.
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
CREATE TABLE public.make_model_profiles (id uuid PRIMARY KEY, canonical_model_id uuid REFERENCES public.canonical_models(id));
CREATE TABLE public.mv_vehicle_name_dictionary (make_l text, model_l text, name_l text, vehicles bigint,
  PRIMARY KEY (make_l, model_l));

INSERT INTO public.canonical_makes (id, canonical_name, display_name, aliases) VALUES
  ('00000000-0000-4000-a000-000000000001', 'CHEVROLET',     'Chevrolet',     ARRAY['chevrolet', 'chevy']),
  ('00000000-0000-4000-a000-000000000002', 'FERRARI',       'Ferrari',       ARRAY['ferrari']),
  ('00000000-0000-4000-a000-000000000003', 'PORSCHE',       'Porsche',       ARRAY['porsche']),
  ('00000000-0000-4000-a000-000000000004', 'MERCEDES-BENZ', 'Mercedes-Benz', ARRAY['mercedes-benz', 'mercedes']),
  ('00000000-0000-4000-a000-000000000005', 'BMW',           'BMW',           ARRAY['bmw']),
  ('00000000-0000-4000-a000-000000000006', 'AUDI',          'Audi',          ARRAY['audi']),
  ('00000000-0000-4000-a000-000000000007', 'MCLAREN',       'McLaren',       ARRAY['mclaren']);

INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases) VALUES
  ('10000000-0000-4000-a000-000000000001', 'CHEVROLET',     'Corvette', 1953, 2024, ARRAY['corvette']),
  ('10000000-0000-4000-a000-000000000002', 'Rolls-Royce',   'Ghost',    2009, NULL, ARRAY['ghost']),
  ('10000000-0000-4000-a000-000000000003', 'Ferrari',       '250 GT',   NULL, NULL, ARRAY['250 gt']),
  ('10000000-0000-4000-a000-000000000004', 'Ferrari',       '250 GTO',  NULL, NULL, ARRAY['250 gto']),
  ('10000000-0000-4000-a000-000000000005', 'Ferrari',       '250 LM',   NULL, NULL, ARRAY['250 lm']),
  ('10000000-0000-4000-a000-000000000006', 'Ferrari',       'Dino 246', 1969, 1974, ARRAY['dino 246', 'dino']),
  ('10000000-0000-4000-a000-000000000007', 'Porsche',       '718',      2016, NULL, ARRAY['718']),
  ('10000000-0000-4000-a000-000000000008', 'Porsche',       '356',      1948, 1965, ARRAY['356', '356a', '356b', '356c']),
  ('10000000-0000-4000-a000-000000000009', 'Mercedes-Benz', 'SL',       1954, NULL, ARRAY['280sl', '300sl', '560sl']),
  ('10000000-0000-4000-a000-000000000010', 'Mercedes-Benz', 'S-Class',  1972, NULL, ARRAY['560sec', '500sec', '280se']),
  ('10000000-0000-4000-a000-000000000011', 'Mercedes-Benz', 'CL',       1996, 2014, ARRAY['cl500', 'cl600', '560sec', '500sec', 'sec']),
  ('10000000-0000-4000-a000-000000000012', 'Mercedes-Benz', '190',      NULL, NULL, ARRAY['190']),
  ('10000000-0000-4000-a000-000000000013', 'Mercedes-Benz', '300',      NULL, NULL, ARRAY['300']),
  ('10000000-0000-4000-a000-000000000014', 'BMW',           '3.0 CSL',  NULL, NULL, ARRAY['3.0 csl']),
  ('10000000-0000-4000-a000-000000000015', 'Land Rover',    'Defender', NULL, NULL, ARRAY['defender']),
  ('10000000-0000-4000-a000-000000000016', 'Lexus',         'LS',       NULL, NULL, ARRAY['ls']),
  ('10000000-0000-4000-a000-000000000017', 'Audi',          'RS 3',     NULL, NULL, ARRAY['rs 3']),
  ('10000000-0000-4000-a000-000000000018', 'McLaren',       'MP4-12C',  NULL, NULL, ARRAY['mp4-12c']),
  ('10000000-0000-4000-a000-000000000019', 'Volvo',         'V70',      NULL, NULL, ARRAY['v70']),
  ('10000000-0000-4000-a000-000000000020', 'Duesenberg',    'Model J',  NULL, NULL, ARRAY['model j']),
  ('10000000-0000-4000-a000-000000000021', 'Duesenberg',    'Model SJ', NULL, NULL, ARRAY['model sj']),
  ('10000000-0000-4000-a000-000000000022', 'Dodge',         'Ram',      1981, 2010, ARRAY['ram', 'ram 1500']),
  ('10000000-0000-4000-a000-000000000023', 'Dodge',         'D-Series', NULL, NULL, ARRAY['d-series']);

INSERT INTO public.mv_vehicle_name_dictionary (make_l, model_l, name_l, vehicles) VALUES
  ('rolls-royce',   '40/50 hp silver ghost limousine',   'rolls-royce 40/50 hp silver ghost limousine',   5),
  ('ferrari',       '250 gto',                           'ferrari 250 gto',                               2),
  ('ferrari',       '250 lm by scaglietti',              'ferrari 250 lm by scaglietti',                  1),
  ('ferrari',       '250 gte series i',                  'ferrari 250 gte series i',                      6),
  ('mercedes-benz', '230sl 4-speed',                     'mercedes-benz 230sl 4-speed',                   89),
  ('mercedes-benz', '190e 2.5-16 evolution ii',          'mercedes-benz 190e 2.5-16 evolution ii',        14),
  ('mercedes-benz', '300td turbo',                       'mercedes-benz 300td turbo',                     126),
  ('mercedes-benz', '560sec',                            'mercedes-benz 560sec',                          138),
  ('bmw',           '3.0cs 5-speed',                     'bmw 3.0cs 5-speed',                             39),
  ('bmw',           '3.0csi 5-speed',                    'bmw 3.0csi 5-speed',                            17),
  ('volvo',         '1800s',                             'volvo 1800s',                                   67),
  ('volvo',         'p1800e',                            'volvo p1800e',                                  15),
  ('volvo',         'v70r',                              'volvo v70r',                                    111),
  ('land rover',    'er 110',                            'land rover er 110',                             33),
  ('land rover',    '110',                               'land rover 110',                                49),
  ('lexus',         'ls430',                             'lexus ls430',                                   198),
  ('porsche',       '356sc coupe',                       'porsche 356sc coupe',                           26),
  ('porsche',       'rs60',                              'porsche rs60',                                  3),
  ('audi',          'rs3',                               'audi rs3',                                      54),
  ('mclaren',       '12c spider',                        'mclaren 12c spider',                            23),
  ('tesla',         'roadster',                          'tesla roadster',                                48),
  ('tesla',         'model s plaid',                     'tesla model s plaid',                           29),
  ('rivian',        'r1s launch edition',                'rivian r1s launch edition',                     23),
  ('rivian',        'r1t adventure edition',             'rivian r1t adventure edition',                  25),
  ('duesenberg',    'ssj',                               'duesenberg ssj',                                1),
  ('maserati',      'a6g/54 berlinetta',                 'maserati a6g/54 berlinetta',                    5),
  ('maserati',      'mc12',                              'maserati mc12',                                 2),
  ('packard',       '734 speedster runabout',            'packard 734 speedster runabout',                6),
  ('talbot-lago',   't150-c-ss teardrop coupe',          'talbot-lago t150-c-ss teardrop coupe',          2),
  ('ruf',           'ctr anniversary',                   'ruf ctr anniversary',                           3),
  ('fiat',          '8v supersonic',                     'fiat 8v supersonic',                            1),
  ('dodge',         '1500 trx crew cab 4×4',             'dodge 1500 trx crew cab 4×4',                   22),
  ('dodge',         'd100',                              'dodge d100',                                    40);

\ir ../migrations/20261015090000_model_family_names.sql
\ir ../migrations/20261018063000_family_keys_year_gates_euro_wave.sql
CREATE TEMP TABLE once AS SELECT id, year_start, year_end, notes, aliases FROM public.canonical_models;
\ir ../migrations/20261018063000_family_keys_year_gates_euro_wave.sql
REFRESH MATERIALIZED VIEW public.mv_model_family_names;

SELECT pg_temp.ok('Rolls-Royce 40/50 HP Silver Ghost resolves to Silver Ghost (not 2009+ Ghost)',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'rolls-royce' AND model_l = '40/50 hp silver ghost limousine') = 'Silver Ghost');

SELECT pg_temp.ok('Ferrari 250 GTO, 250 LM, and 250 GTE resolve to consolidated 250 GT family',
  (SELECT count(*) FROM public.mv_model_family_names
   WHERE make_l = 'ferrari'
     AND model_l IN ('250 gto', '250 lm by scaglietti', '250 gte series i')
     AND family = '250 GT') = 3);

SELECT pg_temp.ok('Chevrolet Corvette year_end is cleared and Porsche 718 year_start is widened to 1957',
  (SELECT year_end IS NULL FROM public.canonical_models WHERE make = 'CHEVROLET' AND canonical_model = 'Corvette')
  AND (SELECT year_start = 1957 FROM public.canonical_models WHERE make = 'Porsche' AND canonical_model = '718')
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'porsche' AND model_l = 'rs60') = '718');

SELECT pg_temp.ok('Mercedes-Benz 560SEC resolves to S-Class (1951+) and 230SL/190E/300TD resolve to SL/190/300',
  (SELECT family = 'S-Class' AND year_start = 1951 FROM public.mv_model_family_names WHERE make_l = 'mercedes-benz' AND model_l = '560sec')
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mercedes-benz' AND model_l = '230sl 4-speed') = 'SL'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mercedes-benz' AND model_l = '190e 2.5-16 evolution ii') = '190'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mercedes-benz' AND model_l = '300td turbo') = '300');

SELECT pg_temp.ok('BMW 3.0CS/CSi, Volvo P1800/V70R, Land Rover Defender 110, Lexus LS430, Porsche 356SC, Audi RS3, McLaren 12C, Tesla, Rivian resolve cleanly',
  (SELECT count(*) FROM public.mv_model_family_names WHERE make_l = 'bmw' AND model_l IN ('3.0cs 5-speed', '3.0csi 5-speed') AND family = '3.0 CSL') = 2
  AND (SELECT count(*) FROM public.mv_model_family_names WHERE make_l = 'volvo' AND model_l IN ('1800s', 'p1800e') AND family = 'P1800') = 2
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'volvo' AND model_l = 'v70r') = 'V70'
  AND (SELECT count(*) FROM public.mv_model_family_names WHERE make_l = 'land rover' AND model_l IN ('110', 'er 110') AND family = 'Defender') = 2
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'lexus' AND model_l = 'ls430') = 'LS'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'porsche' AND model_l = '356sc coupe') = '356'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'audi' AND model_l = 'rs3') = 'RS 3'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mclaren' AND model_l = '12c spider') = 'MP4-12C'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'tesla' AND model_l = 'roadster') = 'Roadster'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'tesla' AND model_l = 'model s plaid') = 'Model S'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'rivian' AND model_l = 'r1s launch edition') = 'R1S'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'rivian' AND model_l = 'r1t adventure edition') = 'R1T');

SELECT pg_temp.ok('Pre-war & Italian icons (Duesenberg SSJ, Maserati A6G/MC12, Packard 734, Talbot-Lago T150-C-SS, Ruf CTR, Fiat 8V, Dodge TRX/D100) resolve cleanly',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'duesenberg' AND model_l = 'ssj') = 'Model J'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'maserati' AND model_l = 'a6g/54 berlinetta') = 'A6G'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'maserati' AND model_l = 'mc12') = 'MC12'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'packard' AND model_l = '734 speedster runabout') = '734 Speedster'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'talbot-lago' AND model_l = 't150-c-ss teardrop coupe') = 'T150-C-SS'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ruf' AND model_l = 'ctr anniversary') = 'CTR'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'fiat' AND model_l = '8v supersonic') = '8V'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'dodge' AND model_l = '1500 trx crew cab 4×4') = 'Ram'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'dodge' AND model_l = 'd100') = 'D-Series');

SELECT pg_temp.ok('a second apply changes nothing',
  NOT EXISTS (SELECT 1 FROM public.canonical_models m JOIN once o USING (id)
              WHERE m.year_start IS DISTINCT FROM o.year_start
                 OR m.year_end IS DISTINCT FROM o.year_end
                 OR m.notes IS DISTINCT FROM o.notes
                 OR m.aliases IS DISTINCT FROM o.aliases));
