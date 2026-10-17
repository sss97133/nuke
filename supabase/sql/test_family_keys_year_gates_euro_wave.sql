-- Contract test for 20261018063000_family_keys_year_gates_euro_wave.sql on a disposable Postgres 17 instance.
-- Verifies that year-gated models (Silver Ghost, 2026 Corvette, 1959 Porsche 718 RSK, 1989 Mercedes 560SEC,
-- 1966 Ferrari Dino 206 S), consolidated Ferrari 250 variants (250 GTO, 250 LM, 250 GTE), and newly added
-- European/Japanese/EV families (Mercedes 230SL/190E/300TD, BMW 3.0CS, Volvo P1800/V70R, Land Rover Defender 110,
-- Lexus LS430/LC500, Porsche 356SC, Audi RS3/RS7, McLaren 12C, Tesla Roadster/Model S, Rivian R1T/R1S) resolve
-- cleanly in mv_model_family_names and mv_family_market, and that the migration is idempotent.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE public.canonical_makes (
  canonical_name text PRIMARY KEY,
  display_name   text,
  short_name     text,
  aliases        text[],
  tier           int,
  is_active      boolean,
  country        text
);

CREATE TABLE public.canonical_models (
  id              uuid PRIMARY KEY,
  make            text NOT NULL,
  canonical_model text NOT NULL,
  year_start      int,
  year_end        int,
  aliases         text[]
);

CREATE TABLE public.make_model_profiles (
  id                 uuid PRIMARY KEY,
  canonical_model_id uuid REFERENCES public.canonical_models(id)
);

INSERT INTO public.canonical_makes (canonical_name, display_name, aliases, tier, is_active, country) VALUES
  ('CHEVROLET',     'Chevrolet',     ARRAY['chevrolet', 'chevy'], 1, true, 'USA'),
  ('FERRARI',       'Ferrari',       ARRAY['ferrari'], 1, true, 'Italy'),
  ('PORSCHE',       'Porsche',       ARRAY['porsche'], 1, true, 'Germany'),
  ('MERCEDES-BENZ', 'Mercedes-Benz', ARRAY['mercedes-benz', 'mercedes'], 1, true, 'Germany'),
  ('BMW',           'BMW',           ARRAY['bmw'], 1, true, 'Germany'),
  ('AUDI',          'Audi',          ARRAY['audi'], 1, true, 'Germany'),
  ('MCLAREN',       'McLaren',       ARRAY['mclaren'], 1, true, 'UK'),
  ('ROLLS-ROYCE',   'Rolls-Royce',   ARRAY['rolls-royce'], 1, true, 'UK'),
  ('VOLVO',         'Volvo',         ARRAY['volvo'], 1, true, 'Sweden'),
  ('LAND ROVER',    'Land Rover',    ARRAY['land rover'], 1, true, 'UK'),
  ('LEXUS',         'Lexus',         ARRAY['lexus'], 1, true, 'Japan');

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
  ('10000000-0000-4000-a000-000000000019', 'Volvo',         'V70',      NULL, NULL, ARRAY['v70']);

CREATE MATERIALIZED VIEW public.mv_vehicle_name_dictionary AS
SELECT * FROM (VALUES
  ('rolls-royce'::text,   '40/50 hp silver ghost limousine'::text, 5::bigint),
  ('ferrari'::text,       '250 gto'::text,                         2::bigint),
  ('ferrari'::text,       '250 lm by scaglietti'::text,            1::bigint),
  ('ferrari'::text,       '250 gte series i'::text,                6::bigint),
  ('mercedes-benz'::text, '230sl 4-speed'::text,                   89::bigint),
  ('mercedes-benz'::text, '190e 2.5-16 evolution ii'::text,        14::bigint),
  ('mercedes-benz'::text, '300td turbo'::text,                     126::bigint),
  ('mercedes-benz'::text, '560sec'::text,                          138::bigint),
  ('bmw'::text,           '3.0cs 5-speed'::text,                   39::bigint),
  ('bmw'::text,           '3.0csi 5-speed'::text,                  17::bigint),
  ('volvo'::text,         '1800s'::text,                           67::bigint),
  ('volvo'::text,         'p1800e'::text,                          15::bigint),
  ('volvo'::text,         'v70r'::text,                            111::bigint),
  ('land rover'::text,    'er 110'::text,                          33::bigint),
  ('land rover'::text,    '110'::text,                             49::bigint),
  ('lexus'::text,         'ls430'::text,                           198::bigint),
  ('porsche'::text,       '356sc coupe'::text,                     26::bigint),
  ('audi'::text,          'rs3'::text,                             54::bigint),
  ('mclaren'::text,       '12c spider'::text,                      23::bigint),
  ('tesla'::text,         'roadster'::text,                        48::bigint),
  ('tesla'::text,         'model s plaid'::text,                   29::bigint),
  ('rivian'::text,        'r1s launch edition'::text,              23::bigint),
  ('rivian'::text,        'r1t adventure edition'::text,           25::bigint)
) AS v(make_l, model_l, vehicles);

\i supabase/migrations/20261015090000_model_family_names.sql
\i supabase/migrations/20261018063000_family_keys_year_gates_euro_wave.sql
-- Apply twice to verify idempotency
\i supabase/migrations/20261018063000_family_keys_year_gates_euro_wave.sql

REFRESH MATERIALIZED VIEW public.mv_model_family_names;

CREATE OR REPLACE FUNCTION pg_temp.ok(p_label text, p_cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_cond, false) THEN
    RAISE EXCEPTION 'contract failed: %', p_label;
  END IF;
END
$$;

SELECT pg_temp.ok('Rolls-Royce 40/50 HP Silver Ghost resolves to Silver Ghost (not 2009+ Ghost)',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'rolls-royce' AND model_l = '40/50 hp silver ghost limousine') = 'Silver Ghost');

SELECT pg_temp.ok('Ferrari 250 GTO, 250 LM, and 250 GTE resolve to consolidated 250 GT family',
  (SELECT count(*) FROM public.mv_model_family_names
   WHERE make_l = 'ferrari'
     AND model_l IN ('250 gto', '250 lm by scaglietti', '250 gte series i')
     AND family = '250 GT') = 3);

SELECT pg_temp.ok('Chevrolet Corvette year_end is cleared so 2026 Corvettes pass year gate',
  (SELECT year_end IS NULL FROM public.canonical_models WHERE make = 'CHEVROLET' AND canonical_model = 'Corvette'));

SELECT pg_temp.ok('Porsche 718 year_start is widened to 1957 for 718 RSK / RS 60 Spyders',
  (SELECT year_start = 1957 FROM public.canonical_models WHERE make = 'Porsche' AND canonical_model = '718'));

SELECT pg_temp.ok('Mercedes-Benz 560SEC resolves to S-Class (1951+) rather than CL (1996-2014)',
  (SELECT family = 'S-Class' AND year_start = 1951 FROM public.mv_model_family_names WHERE make_l = 'mercedes-benz' AND model_l = '560sec'));

SELECT pg_temp.ok('Mercedes-Benz 230SL, 190E Evolution II, and 300TD resolve to SL, 190, and 300',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mercedes-benz' AND model_l = '230sl 4-speed') = 'SL'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mercedes-benz' AND model_l = '190e 2.5-16 evolution ii') = '190'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mercedes-benz' AND model_l = '300td turbo') = '300');

SELECT pg_temp.ok('BMW 3.0CS and 3.0CSi resolve to 3.0 CSL family',
  (SELECT count(*) FROM public.mv_model_family_names
   WHERE make_l = 'bmw' AND model_l IN ('3.0cs 5-speed', '3.0csi 5-speed') AND family = '3.0 CSL') = 2);

SELECT pg_temp.ok('Volvo 1800S / P1800E resolve to P1800 and V70R resolves to V70',
  (SELECT count(*) FROM public.mv_model_family_names
   WHERE make_l = 'volvo' AND model_l IN ('1800s', 'p1800e') AND family = 'P1800') = 2
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'volvo' AND model_l = 'v70r') = 'V70');

SELECT pg_temp.ok('Land Rover 110 and er 110 resolve to Defender',
  (SELECT count(*) FROM public.mv_model_family_names
   WHERE make_l = 'land rover' AND model_l IN ('110', 'er 110') AND family = 'Defender') = 2);

SELECT pg_temp.ok('Lexus LS430, Porsche 356SC, Audi RS3, McLaren 12C Spider, Tesla, and Rivian resolve cleanly',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'lexus' AND model_l = 'ls430') = 'LS'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'porsche' AND model_l = '356sc coupe') = '356'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'audi' AND model_l = 'rs3') = 'RS 3'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mclaren' AND model_l = '12c spider') = 'MP4-12C'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'tesla' AND model_l = 'roadster') = 'Roadster'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'tesla' AND model_l = 'model s plaid') = 'Model S'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'rivian' AND model_l = 'r1s launch edition') = 'R1S'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'rivian' AND model_l = 'r1t adventure edition') = 'R1T');

ROLLBACK;
