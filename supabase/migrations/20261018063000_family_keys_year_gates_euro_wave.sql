-- Family key coverage for year-gated collector models, Ferrari 250 / Bugatti Type 57 / Duesenberg Model J
-- consolidation, European & pre-war icons (Mercedes W113/W111/W201/W123/G320/SLK, BMW E9 3.0CS/M635CSi,
-- Volvo P1800/V70R/122S, Alfa GTV/Montreal, Maserati A6G/MC12/Tipo 61/Bora/3500 GT, Lancia Stratos/Flaminia,
-- Fiat 8V/Dino/600, Ruf CTR/Turbo R/RGT, Talbot-Lago T150-C-SS, Packard 734/Twelve/Caribbean/Deluxe Eight,
-- Land Rover Defender 110/90), Dodge trucks/muscle (Ram TRX/3500, D100/Lil Red Express, Dart Demon, M37),
-- Lexus unspaced model codes (LS430/LS400/LC500), and EV marques (Tesla, Rivian).
--
-- Measured 2026-10-16 on mv_family_market:
--   * Year-gate rejections ($150M+):
--       - Rolls-Royce 40/50 HP Silver Ghost (1907-1926, 72 sold, $56.32M) matched the 2009+ Ghost unigram and
--         failed year_start = 2009. Giving Silver Ghost its own canonical_models row reclaims $56.32M.
--       - Chevrolet Corvette had year_end = 2024, rejecting 26 2026 Corvettes ($10.87M). Clearing year_end = NULL
--         on active models (Corvette, Camaro, Suburban, Sierra, GT40, Countach, Huayra, C-Type, D-Type, F-Type,
--         Cherokee, Dawn, Wraith, NSX, Speedtail, Dodge Ram, Dodge Viper) prevents newer lots from failing year_end + 1.
--       - Porsche 718 had year_start = 2016, rejecting 1959-1960 718 RSK / RS 60 Spyders (8 sold, $21.80M).
--         Widening 718 year_start to 1957 and adding 'rs60' / '718 rsk' reclaims $21.80M.
--       - Mercedes-Benz CL (1996-2014) held '560sec'/'500sec'/'sec', hijacking 257 W126 SEC coupes ($7.96M) from
--         S-Class and rejecting them on year_start = 1996; S-Class (year_start = 1972) rejected 173 W111/W112/W108
--         280SE/220SE/300SE cars ($10.77M). Removing SEC aliases from CL and widening S-Class year_start to 1951
--         reclaims $18.73M+.
--       - Jaguar XK8 had year_end = 2006, rejecting 245 2007-2015 XKR/XK cars ($7.69M).
--       - Catalogue lots where vehicle year carries the auction year (2010-2026) were rejected on Aston Martin
--         DB4 ($20.06M, 24 sold) & DB6 ($2.84M), Ferrari Dino 246 ($8.47M, including 1966 Dino 206 S), Ferrari 599
--         ($4.95M), Ferrari FF ($2.65M), and Lamborghini Miura ($4.47M) & 350 GT ($2.36M).
--   * Ferrari 250, Bugatti Type 57 & Duesenberg Model J consolidation ($185M+):
--       - Ultra-rare Ferrari 250 variants with 1-2 sales each (250 GTO $38.65M, 250 LM $34.88M, 250 P $18.71M,
--         250 Testa Rossa $17.19M, 250 MM $8.92M, 250 GT/L $4.65M, 250 GTE $2.72M, 250 Europa $1.97M) fell below
--         the 3-sale threshold when split into standalone micro-families. Folding their aliases into 250 GT and
--         removing the standalone 1-2 sale rows surfaces every 250 variant under Ferrari 250 GT.
--       - Duesenberg Model J / SJ / SSJ / JN ($45.04M) consolidated into Model J.
--   * European, Pre-War, Japanese, American & EV family gaps ($350M+):
--       - Maserati A6G ($25.53M), MC12 ($16.71M), Tipo 61 Birdcage ($13.27M), Bora ($2.90M), 3500 GT ($6.00M+).
--       - Packard 734 Speedster ($16.28M), Twelve ($16.20M), Deluxe Eight ($7.37M), Caribbean ($4.12M), 120 ($1.46M).
--       - Talbot-Lago T150-C-SS ($32.79M), Ruf CTR ($27.69M), Turbo R ($6.72M), RGT ($1.25M).
--       - Fiat 8V ($8.75M), Dino ($2.30M), 600 ($1.37M), 500 ($1.00M).
--       - Mercedes-Benz SL (230SL, 250SL, SL63 — $11.49M+), 190 (190E, Evolution II — $6.5M+), 300 (300TD, 300SD,
--         300D, 300E, 300CE, 300SC — $12M+), G-Class (G320 — $3.53M+), SLK-Class (SLK55 AMG — $4.5M+).
--       - BMW 3.0 CS / CSi / CSL (E9, $12.38M+) & M6 (M635CSi, $2.44M).
--       - Volvo P1800 (390 sold, $10.38M), V70 (V70R, $2.46M), 122S ($1.74M), S60 (S60R), PV544, 850 Series.
--       - Tesla (726 sold, $35.56M: Roadster, Model S, Model 3, Model X, Model Y, Cybertruck) and Rivian
--         (172 sold, $14.21M: R1S, R1T).
--       - Land Rover Defender (110, 90, 130, 'er 110' — $6.65M+), Lexus (LS430, LS400, LC500 — $8.12M+),
--         Porsche 356 (356SC, Speedster, 356 A — $8.54M+), Audi (RS3, RS7 — $4.96M), McLaren MP4-12C (12C — $4.5M+),
--         Alfa Romeo (GTV, Montreal — $6.21M+), Lancia (Flaminia, Stratos — $6.79M+), Shelby Series 1 ($6.56M),
--         Sunbeam Tiger ($4.85M), Meyers Manx ($3.44M), Morgan Plus 4 / Plus 8 ($3.88M+), Saleen S7 ($2.67M),
--         Dodge Ram (1500 TRX, 3500 — $3.09M+), D-Series (D100, D200, Lil Red Express — $2.13M+), Dart (Demon — $0.97M).
--
-- Contract: supabase/sql/test_family_keys_year_gates_euro_wave.sql.

DO $$
BEGIN
  IF to_regclass('public.canonical_models') IS NULL OR to_regclass('public.canonical_makes') IS NULL THEN
    RAISE EXCEPTION 'canonical_models / canonical_makes must exist before 20261018063000_family_keys_year_gates_euro_wave.sql';
  END IF;
END
$$;

-- 1. Ensure canonical_makes exist for all target marques
INSERT INTO public.canonical_makes (id, canonical_name, display_name, aliases, is_active)
SELECT v.id, v.canonical_name, v.display_name, v.aliases, true
FROM (VALUES
  ('00000000-0000-4000-b000-000000000001'::uuid, 'ROLLS-ROYCE', 'Rolls-Royce', ARRAY['rolls-royce', 'rolls royce']),
  ('00000000-0000-4000-b000-000000000002'::uuid, 'VOLVO',       'Volvo',       ARRAY['volvo']),
  ('00000000-0000-4000-b000-000000000003'::uuid, 'TESLA',       'Tesla',       ARRAY['tesla']),
  ('00000000-0000-4000-b000-000000000004'::uuid, 'RIVIAN',      'Rivian',      ARRAY['rivian']),
  ('00000000-0000-4000-b000-000000000005'::uuid, 'LAND ROVER',  'Land Rover',  ARRAY['land rover', 'landrover']),
  ('00000000-0000-4000-b000-000000000006'::uuid, 'LEXUS',       'Lexus',       ARRAY['lexus']),
  ('00000000-0000-4000-b000-000000000007'::uuid, 'ALFA ROMEO',  'Alfa Romeo',  ARRAY['alfa romeo', 'alfa']),
  ('00000000-0000-4000-b000-000000000008'::uuid, 'MASERATI',    'Maserati',    ARRAY['maserati']),
  ('00000000-0000-4000-b000-000000000009'::uuid, 'SUNBEAM',     'Sunbeam',     ARRAY['sunbeam']),
  ('00000000-0000-4000-b000-000000000010'::uuid, 'MEYERS',      'Meyers',      ARRAY['meyers', 'meyers manx']),
  ('00000000-0000-4000-b000-000000000011'::uuid, 'MORGAN',      'Morgan',      ARRAY['morgan']),
  ('00000000-0000-4000-b000-000000000012'::uuid, 'BUGATTI',     'Bugatti',     ARRAY['bugatti']),
  ('00000000-0000-4000-b000-000000000013'::uuid, 'SALEEN',      'Saleen',      ARRAY['saleen']),
  ('00000000-0000-4000-b000-000000000014'::uuid, 'PACKARD',     'Packard',     ARRAY['packard']),
  ('00000000-0000-4000-b000-000000000015'::uuid, 'TALBOT-LAGO', 'Talbot-Lago', ARRAY['talbot-lago', 'talbot lago']),
  ('00000000-0000-4000-b000-000000000016'::uuid, 'DUESENBERG',  'Duesenberg',  ARRAY['duesenberg']),
  ('00000000-0000-4000-b000-000000000017'::uuid, 'RUF',         'Ruf',         ARRAY['ruf']),
  ('00000000-0000-4000-b000-000000000018'::uuid, 'FIAT',        'Fiat',        ARRAY['fiat']),
  ('00000000-0000-4000-b000-000000000019'::uuid, 'DODGE',       'Dodge',       ARRAY['dodge'])
) AS v(id, canonical_name, display_name, aliases)
WHERE NOT EXISTS (
  SELECT 1 FROM public.canonical_makes cm WHERE lower(cm.canonical_name) = lower(v.canonical_name)
)
ON CONFLICT (id) DO NOTHING;

-- 2. Clear restrictive year_end / year_start gates that rejected $150M+ of valid vehicles
UPDATE public.canonical_models
SET year_end = NULL
WHERE year_end >= 2022
   OR (lower(make) = 'aston martin' AND canonical_model IN ('DB4', 'DB5', 'DB6'))
   OR (lower(make) = 'lamborghini'  AND canonical_model IN ('Miura', '350 GT'))
   OR (lower(make) = 'ferrari'      AND canonical_model IN ('Dino 246', '599', 'FF', '550', '365'))
   OR (lower(make) = 'porsche'      AND canonical_model IN ('356', '550'))
   OR (lower(make) = 'jaguar'       AND canonical_model IN ('XK8', 'E-Type', 'XK120'))
   OR (lower(make) = 'dodge'        AND canonical_model IN ('Ram', 'Viper', 'Power Wagon'));

UPDATE public.canonical_models
SET year_start = 1965
WHERE lower(make) = 'ferrari' AND canonical_model = 'Dino 246' AND (year_start IS NULL OR year_start > 1965);

UPDATE public.canonical_models
SET year_start = 1957
WHERE lower(make) = 'porsche' AND canonical_model = '718' AND (year_start IS NULL OR year_start > 1957);

UPDATE public.canonical_models
SET year_start = 1951
WHERE lower(make) = 'mercedes-benz' AND canonical_model = 'S-Class' AND (year_start IS NULL OR year_start > 1951);

UPDATE public.canonical_models
SET year_start = 1940
WHERE lower(make) = 'dodge' AND canonical_model = 'Power Wagon' AND (year_start IS NULL OR year_start > 1940);

-- Remove W126 SEC aliases from Mercedes-Benz CL (1996-2014) so S-Class (1951+) owns 560SEC / 500SEC
UPDATE public.canonical_models
SET aliases = ARRAY(
  SELECT x
  FROM unnest(COALESCE(aliases, '{}'::text[])) AS x
  WHERE lower(x) NOT IN ('560sec', '500sec', 'sec', '560 sec', '500 sec')
)
WHERE lower(make) = 'mercedes-benz' AND canonical_model = 'CL';

-- 3. Consolidate ultra-rare Ferrari 250 variants into '250 GT', Bugatti Type 57 variants into 'Type 57',
--    and Duesenberg Model SJ into 'Model J' so 1-2 sale variants aren't dropped by the <3 sale micro-family filter
DELETE FROM public.canonical_models m
WHERE lower(m.make) = 'ferrari'
  AND m.canonical_model IN ('250 GTO', '250 LM', '250 P', '250 Testa Rossa', '250 MM', '250 GT/L', '250 Monza', '250 S', '250 Europa')
  AND (to_regclass('public.make_model_profiles') IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.make_model_profiles p WHERE p.canonical_model_id = m.id));

DELETE FROM public.canonical_models m
WHERE lower(m.make) = 'bugatti'
  AND m.canonical_model IN ('Type 57C', 'Type 57S', 'Type 57SC')
  AND (to_regclass('public.make_model_profiles') IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.make_model_profiles p WHERE p.canonical_model_id = m.id));

DELETE FROM public.canonical_models m
WHERE lower(m.make) = 'duesenberg'
  AND m.canonical_model = 'Model SJ'
  AND (to_regclass('public.make_model_profiles') IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.make_model_profiles p WHERE p.canonical_model_id = m.id));

-- 4. Insert missing canonical_models families
INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases)
SELECT v.id, v.make, v.canonical_model, v.year_start, v.year_end, v.aliases
FROM (VALUES
  ('00000000-0000-4000-e000-000000001907'::uuid, 'Rolls-Royce', 'Silver Ghost', 1906, NULL::int,
    ARRAY['silver ghost', '40/50 hp silver ghost', '40/50hp silver ghost', '40/50 silver ghost']),
  ('00000000-0000-4000-e000-000000002005'::uuid, 'Ferrari', 'FXX', 2005, NULL::int,
    ARRAY['fxx', 'fxx evo', 'fxx k', 'fxx k evo', 'fxx-k', 'fxx-k evo']),
  ('00000000-0000-4000-e000-000000001955'::uuid, 'Ferrari', '857 S', 1955, NULL::int,
    ARRAY['857 s', '857 sport', '857 sport spider', '857']),
  ('00000000-0000-4000-e000-000000001800'::uuid, 'Volvo', 'P1800', 1961, NULL::int,
    ARRAY['p1800', 'p 1800', 'p1800s', 'p1800e', 'p1800es', '1800', '1800s', '1800e', '1800es', '1800 s', '1800 e', '1800 es']),
  ('00000000-0000-4000-e000-000000000122'::uuid, 'Volvo', '122S', 1956, NULL::int,
    ARRAY['122s', '122', '123gt', 'amazon']),
  ('00000000-0000-4000-e000-000000000544'::uuid, 'Volvo', 'PV544', 1947, NULL::int,
    ARRAY['pv544', '544', 'pv444', '444']),
  ('00000000-0000-4000-e000-000000002008'::uuid, 'Tesla', 'Roadster', 2008, NULL::int,
    ARRAY['roadster', 'roadster sport', 'roadster 2.5', 'roadster 2.5 sport']),
  ('00000000-0000-4000-e000-000000002012'::uuid, 'Tesla', 'Model S', 2012, NULL::int,
    ARRAY['model s', 'model s plaid', 'model s long range', 'model s performance', 'model s p100d', 'model s p90d', 'model s p85d']),
  ('00000000-0000-4000-e000-000000002017'::uuid, 'Tesla', 'Model 3', 2017, NULL::int,
    ARRAY['model 3', 'model 3 performance', 'model 3 long range']),
  ('00000000-0000-4000-e000-000000002015'::uuid, 'Tesla', 'Model X', 2015, NULL::int,
    ARRAY['model x', 'model x plaid', 'model x long range', 'model x p100d']),
  ('00000000-0000-4000-e000-000000002020'::uuid, 'Tesla', 'Model Y', 2020, NULL::int,
    ARRAY['model y', 'model y performance', 'model y long range']),
  ('00000000-0000-4000-e000-000000002023'::uuid, 'Tesla', 'Cybertruck', 2023, NULL::int,
    ARRAY['cybertruck', 'cybertruck cyberbeast', 'cybertruck foundation series', 'cybertruck awd']),
  ('00000000-0000-4000-e000-000000002021'::uuid, 'Rivian', 'R1T', 2021, NULL::int,
    ARRAY['r1t', 'r1t launch edition', 'r1t adventure edition']),
  ('00000000-0000-4000-e000-000000002022'::uuid, 'Rivian', 'R1S', 2022, NULL::int,
    ARRAY['r1s', 'r1s launch edition', 'r1s adventure edition']),
  ('00000000-0000-4000-e000-000000001999'::uuid, 'Shelby', 'Series 1', 1999, NULL::int,
    ARRAY['series 1', 'series 1 convertible']),
  ('00000000-0000-4000-e000-000000001967'::uuid, 'Alfa Romeo', 'GTV', 1963, NULL::int,
    ARRAY['gtv', 'gtv 1750', 'gtv 2000', '1750 gtv', '2000 gtv', 'gt 1300 junior', 'gt junior', 'step-nose']),
  ('00000000-0000-4000-e000-000000001970'::uuid, 'Alfa Romeo', 'Montreal', 1970, NULL::int,
    ARRAY['montreal']),
  ('00000000-0000-4000-e000-000000001971'::uuid, 'Maserati', 'Bora', 1971, NULL::int,
    ARRAY['bora', 'bora 4.7', 'bora 4.9']),
  ('00000000-0000-4000-e000-000000003500'::uuid, 'Maserati', '3500 GT', 1957, NULL::int,
    ARRAY['3500 gt', '3500gt', '3500 gti', '3500gt spider', '3500 gt spider']),
  ('00000000-0000-4000-e000-000000001954'::uuid, 'Maserati', 'A6G', 1947, NULL::int,
    ARRAY['a6g', 'a6g 54', 'a6g/54', 'a6gcs', 'a6gcs 53', 'a6gcs/53', 'a6g 2000', 'a6g/2000']),
  ('00000000-0000-4000-e000-000000002004'::uuid, 'Maserati', 'MC12', 2004, NULL::int,
    ARRAY['mc12', 'mc12 versione corse', 'mc12 versione corsa']),
  ('00000000-0000-4000-e000-000000000061'::uuid, 'Maserati', 'Tipo 61 Birdcage', 1959, NULL::int,
    ARRAY['tipo 61', 'tipo 61 birdcage', 'birdcage', 'tipo 60']),
  ('00000000-0000-4000-e000-000000001957'::uuid, 'Lancia', 'Flaminia', 1957, NULL::int,
    ARRAY['flaminia', 'flaminia sport', 'flaminia gt', 'flaminia super sport', 'flaminia touring', 'flaminia zagato']),
  ('00000000-0000-4000-e000-000000001973'::uuid, 'Lancia', 'Stratos', 1973, NULL::int,
    ARRAY['stratos', 'stratos hf', 'stratos hf stradale']),
  ('00000000-0000-4000-e000-000000000002'::uuid, 'Lamborghini', 'LM002', 1986, NULL::int,
    ARRAY['lm002', 'lm 002']),
  ('00000000-0000-4000-e000-000000001981'::uuid, 'Lamborghini', 'Jalpa', 1981, NULL::int,
    ARRAY['jalpa', 'jalpa p350']),
  ('00000000-0000-4000-e000-000000000220'::uuid, 'Jaguar', 'XJ220', 1992, NULL::int,
    ARRAY['xj220', 'xj 220']),
  ('00000000-0000-4000-e000-000000001964'::uuid, 'Sunbeam', 'Tiger', 1964, NULL::int,
    ARRAY['tiger', 'tiger mk i', 'tiger mk 1a', 'tiger mk ia', 'tiger mk ii']),
  ('00000000-0000-4000-e000-000000001965'::uuid, 'Meyers', 'Manx', 1964, NULL::int,
    ARRAY['manx', 'meyers manx']),
  ('00000000-0000-4000-e000-000000001950'::uuid, 'Morgan', 'Plus 4', 1950, NULL::int,
    ARRAY['plus 4', 'plus four', '+4']),
  ('00000000-0000-4000-e000-000000001968'::uuid, 'Morgan', 'Plus 8', 1968, NULL::int,
    ARRAY['plus 8', 'plus eight', '+8']),
  ('00000000-0000-4000-e000-000000002000'::uuid, 'Saleen', 'S7', 2000, NULL::int,
    ARRAY['s7', 's7 twin turbo']),
  ('00000000-0000-4000-e000-000000000734'::uuid, 'Packard', '734 Speedster', 1929, NULL::int,
    ARRAY['734', '734 speedster', '734 speedster runabout', '734 speedster phaeton']),
  ('00000000-0000-4000-e000-000000001108'::uuid, 'Packard', 'Twelve', 1932, NULL::int,
    ARRAY['twelve', '1108', '1006', '1005', '1107', '1207', '1208', '1407', '1408', '1507', '1508', '1607', '1608', '1707', '1708', 'twin six']),
  ('00000000-0000-4000-e000-000000000904'::uuid, 'Packard', 'Deluxe Eight', 1924, NULL::int,
    ARRAY['deluxe eight', '904', 'model 904', '840', '845', '740', '745', '640', '645', 'super eight']),
  ('00000000-0000-4000-e000-000000001953'::uuid, 'Packard', 'Caribbean', 1953, NULL::int,
    ARRAY['caribbean', 'caribbean convertible']),
  ('00000000-0000-4000-e000-000000000120'::uuid, 'Packard', '120', 1935, NULL::int,
    ARRAY['120', 'one twenty', 'one-twenty']),
  ('00000000-0000-4000-e000-000000000150'::uuid, 'Talbot-Lago', 'T150-C-SS', 1936, NULL::int,
    ARRAY['t150', 't150c', 't150 c', 't150 c ss', 't150-c-ss', 'teardrop coupe', 'tear drop coupe']),
  ('00000000-0000-4000-e000-000000001987'::uuid, 'Ruf', 'CTR', 1987, NULL::int,
    ARRAY['ctr', 'ctr1', 'ctr2', 'ctr3', 'ctr anniversary', 'ctr3 clubsport', 'yellowbird']),
  ('00000000-0000-4000-e000-000000001998'::uuid, 'Ruf', 'Turbo R', 1998, NULL::int,
    ARRAY['turbo r', 'turbo r limited', 'turbo r cabriolet']),
  ('00000000-0000-4000-e000-000000002001'::uuid, 'Ruf', 'RGT', 2000, NULL::int,
    ARRAY['rgt', 'rgt-8']),
  ('00000000-0000-4000-e000-000000001952'::uuid, 'Fiat', '8V', 1952, NULL::int,
    ARRAY['8v', '8v supersonic', '8v berlinetta', '8v elaborata', 'otto vu']),
  ('00000000-0000-4000-e000-000000001966'::uuid, 'Fiat', 'Dino', 1966, NULL::int,
    ARRAY['dino', 'dino spider', 'dino coupe', 'dino 2400', 'dino 2000']),
  ('00000000-0000-4000-e000-000000000600'::uuid, 'Fiat', '600', 1955, NULL::int,
    ARRAY['600', '600 jolly', '600d', '600 multipla', 'multipla'])
) AS v(id, make, canonical_model, year_start, year_end, aliases)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.canonical_models m
  WHERE lower(m.make) = lower(v.make)
    AND lower(m.canonical_model) = lower(v.canonical_model)
)
ON CONFLICT (id) DO NOTHING;

-- 5. Expand aliases on existing canonical_models rows (idempotent)
WITH additions(make_l, model_l, add_aliases) AS (
  VALUES
    -- Ferrari 250 GT consolidated family + 275 + 365 + 400 Superamerica
    ('ferrari', '250 gt', ARRAY[
      '250', '250 gt', '250 gto', '250 lm', '250 p', '250 testa rossa', '250 tr',
      '250 mm', '250 gt/l', '250 gtl', '250 gt l', '250 gte', '250 gte 2+2',
      '250 europa', '250 monza', '250 s', '250 california', '250 swb', '250 lusso'
    ]),
    ('ferrari', '275', ARRAY['275', '275 gtb', '275 gts', '275 gtb/4', '275 gtb/2', '275 gtb/6c', '275 gtb 4', '275 gtb 6c']),
    ('ferrari', '365', ARRAY['365 gts/4', '365 gts 4', '365 gt4 bb', '365 gt4', '365 california']),
    ('ferrari', '400 superamerica', ARRAY['superamerica', '400 superamerica']),

    -- Bugatti Type 57 consolidated family
    ('bugatti', 'type 57', ARRAY['type 57', 'type 57c', 'type 57s', 'type 57sc', '57', '57c', '57s', '57sc']),

    -- Duesenberg Model J consolidated family
    ('duesenberg', 'model j', ARRAY['model j', 'j', 'sj', 'ssj', 'jn', 'model jn', 'model sj', 'model ssj', 'dual cowl phaeton']),

    -- Fiat 500 Jolly variants
    ('fiat', '500', ARRAY['500', '500f', '500l', '500d', '500n', '500 jolly', '500f jolly', 'nuova 500', 'topolino']),

    -- Mercedes-Benz SL, S-Class, E-Class, G-Class, 190, 300, SLK-Class
    ('mercedes-benz', 'sl', ARRAY[
      '230sl', '230 sl', '250sl', '250 sl', 'sl63', 'sl55', 'sl65', 'sl500', 'sl550', 'sl600',
      'sl320', 'sl280', '560sl', '500sl', '450sl', '380sl', '350sl', '280sl', '300sl', '190sl'
    ]),
    ('mercedes-benz', 's-class', ARRAY[
      '220se', '220 se', '220se cabriolet', '220se coupe', '250se', '280se', '280se 3.5',
      '280se cabriolet', '280se coupe', '300se', '300sel', '300sel 6.3', '300sel 4.5', '300sel 3.5',
      '450sel', '450sel 6.9', '450se', '380sel', '380se', '500sel', '560sel', '420sel',
      '560sec', '500sec', '420sec', '380sec'
    ]),
    ('mercedes-benz', 'e-class', ARRAY[
      'e63 s wagon', 'e63 s amg wagon', 'amg e63 s wagon', 'amg e63 s', 'e63 amg wagon',
      'e55 amg wagon', 'e63', 'e55', '500e', '500 e', 'e500', 'e320', 'e350', 'e430', 'e420', 'e300'
    ]),
    ('mercedes-benz', 'g-class', ARRAY[
      'g320', 'g320 cabriolet', 'g300', 'g350', 'g500', 'g550', 'g55', 'g63', 'g65',
      '230ge', '280ge', '300gd', '300ge', '290gd', '250gd', '240gd'
    ]),
    ('mercedes-benz', '190', ARRAY[
      '190', '190e', '190d', '190e 2.3-16', '190e 2.5-16', '190e 2.5-16 evolution ii', '190e 2.3', '190e 2.6'
    ]),
    ('mercedes-benz', '300', ARRAY[
      '300', '300td', '300td turbo', '300sd', '300d', '300cd', '300e', '300ce', '300te', '300sc', '300s', '300b', '300c'
    ]),
    ('mercedes-benz', 'slk-class', ARRAY[
      'slk', 'slk55 amg', 'slk55', 'slk32 amg', 'slk32', 'slk350', 'slk320', 'slk230', 'slk280', 'slk300', 'slk250'
    ]),

    -- BMW E9 3.0 CS / CSi / CSL & E24 M635CSi
    ('bmw', '3.0 csl', ARRAY[
      '3.0 csl', '3.0csl', '3.0cs', '3.0 cs', '3.0csi', '3.0 csi', '3.0s', '2800cs', '2800 cs', 'e9'
    ]),
    ('bmw', 'm6', ARRAY['m635csi', 'm635 csi']),

    -- Land Rover Defender 110 / 90 / 130 (plus ETL-truncated 'er 110' / 'er 90')
    ('land rover', 'defender', ARRAY[
      'defender', 'defender 90', 'defender 110', 'defender 130', '90', '110', '130', 'er 110', 'er 90'
    ]),

    -- Lexus unspaced model codes
    ('lexus', 'ls', ARRAY['ls', 'ls400', 'ls 400', 'ls430', 'ls 430', 'ls460', 'ls 460', 'ls500', 'ls 500', 'ls600h']),
    ('lexus', 'lc', ARRAY['lc', 'lc500', 'lc 500', 'lc500h', 'lc 500h']),
    ('lexus', 'is', ARRAY['is', 'is300', 'is 300', 'is250', 'is 250', 'is350', 'is 350', 'is500', 'is 500', 'isf', 'is f']),
    ('lexus', 'gs', ARRAY['gs', 'gs300', 'gs 300', 'gs400', 'gs 400', 'gs430', 'gs 430', 'gs350', 'gs 350', 'gsf', 'gs f']),

    -- Porsche 356SC / Speedster / 356 A + 550A + 718 RS60 / RSK
    ('porsche', '356', ARRAY['356sc', '356 sc', '356sc coupe', '356sc cabriolet', '356 a', '356 b', '356 c', 'speedster']),
    ('porsche', '550', ARRAY['550', '550 spyder', '550a', '550a spyder', '550 rs spyder']),
    ('porsche', '718', ARRAY['718 rsk', '718 rs 60', '718 rs 60 spyder', 'rs60', 'rs 60']),

    -- Audi unspaced RS codes
    ('audi', 'rs 3', ARRAY['rs 3', 'rs3']),
    ('audi', 'rs 5', ARRAY['rs 5', 'rs5']),
    ('audi', 'rs 7', ARRAY['rs 7', 'rs7']),
    ('audi', 'rs q8', ARRAY['rs q8', 'rsq8']),

    -- McLaren 12C (renamed from MP4-12C in 2013)
    ('mclaren', 'mp4-12c', ARRAY['mp4-12c', '12c', '12c spider', 'mp4-12c spider']),

    -- Volvo V70R, S60R, 850R
    ('volvo', 'v70', ARRAY['v70', 'v70r', 'v70 r']),
    ('volvo', 's60', ARRAY['s60', 's60r', 's60 r']),
    ('volvo', '850 series', ARRAY['850 series', '850', '850r', '850 r', '850 t-5r', '850 turbo']),

    -- Dodge Ram TRX / 3500, D-Series (D100/D200/Lil Red Express), W-Series, Power Wagon (M37/WC), Dart (Demon)
    ('dodge', 'ram', ARRAY['1500', '2500', '3500', '1500 trx', 'ram 1500 trx', 'trx', 'ram srt-10', 'srt-10']),
    ('dodge', 'd-series', ARRAY['d-series', 'd100', 'd150', 'd200', 'd250', 'd300', 'd350', 'lil red express', 'li l red express']),
    ('dodge', 'w-series', ARRAY['w-series', 'w100', 'w150', 'w200', 'w250', 'w300', 'w350']),
    ('dodge', 'power wagon', ARRAY['power wagon', 'powerwagon', 'm37', 'wc', 'wc52', 'wc53', 'wc54', 'wc26', 'wm300']),
    ('dodge', 'dart', ARRAY['demon', 'demon 340', 'hemi dart']),

    -- Buick GSX
    ('buick', 'gs', ARRAY['gsx', 'gsx stage 1'])
)
UPDATE public.canonical_models m
SET aliases = (
  SELECT array_agg(DISTINCT x ORDER BY x)
  FROM unnest(array_cat(COALESCE(m.aliases, '{}'::text[]), a.add_aliases)) AS x
)
FROM additions a
WHERE lower(m.make) = a.make_l
  AND lower(m.canonical_model) = a.model_l;
