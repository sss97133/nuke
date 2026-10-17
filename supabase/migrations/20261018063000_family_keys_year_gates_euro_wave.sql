-- Family key coverage for year-gated collector models, Ferrari 250 / Bugatti Type 57 consolidation,
-- European icons (Mercedes W113/W111/W201/W123/G320/SLK, BMW E9 3.0CS/M635CSi, Volvo P1800/V70R/122S,
-- Alfa GTV/Montreal, Maserati Bora/3500 GT, Lancia Stratos/Flaminia, Land Rover Defender 110/90),
-- Lexus unspaced model codes (LS430/LS400/LC500), and EV marques (Tesla, Rivian).
--
-- Measured 2026-10-16 on mv_family_market:
--   * Year-gate rejections ($150M+):
--       - Rolls-Royce 40/50 HP Silver Ghost (1907-1926, 72 sold, $56.32M) matched the 2009+ Ghost unigram and
--         failed year_start = 2009. Giving Silver Ghost its own canonical_models row reclaims $56.32M.
--       - Chevrolet Corvette had year_end = 2024, rejecting 26 2026 Corvettes ($10.87M). Clearing year_end = NULL
--         on active 2022-2024 models (Corvette, Camaro, Suburban, Sierra, GT40, Countach, Huayra, C-Type, D-Type,
--         F-Type, Cherokee, Dawn, Wraith, NSX, Speedtail) prevents 2025-2026 lots from failing year_end + 1.
--       - Porsche 718 had year_start = 2016, rejecting 1959-1960 718 RSK / RS 60 Spyders (5 sold, $12.54M).
--         Widening 718 year_start to 1957 and 550 year_end to 1960 reclaims $14.54M.
--       - Mercedes-Benz CL (1996-2014) held '560sec'/'500sec'/'sec', hijacking 257 W126 SEC coupes ($7.96M) from
--         S-Class and rejecting them on year_start = 1996; S-Class (year_start = 1972) rejected 173 W111/W112/W108
--         280SE/220SE/300SE cars ($10.77M). Removing SEC aliases from CL and widening S-Class year_start to 1951
--         reclaims $18.73M+.
--       - Jaguar XK8 had year_end = 2006, rejecting 245 2007-2015 XKR/XK cars ($7.69M).
--       - RM Sotheby's / Gooding catalogue lots where vehicle year carries the auction year (2010-2026) were
--         rejected on Aston Martin DB4 ($20.06M, 24 sold) & DB6 ($2.84M), Ferrari Dino 246 ($8.47M, including 1966
--         Dino 206 S), Ferrari 599 ($4.95M), Ferrari FF ($2.65M), and Lamborghini Miura ($4.47M) & 350 GT ($2.36M).
--   * Ferrari 250 & FXX consolidation ($140M+):
--       - Ultra-rare Ferrari 250 variants with 1-2 sales each (250 GTO $38.65M, 250 LM $34.88M, 250 P $18.71M,
--         250 Testa Rossa $17.19M, 250 MM $8.92M, 250 GT/L $4.65M, 250 GTE $2.72M, 250 Europa $1.97M) fell below
--         the 3-sale threshold when split into standalone micro-families. Folding their aliases into 250 GT and
--         removing the standalone 1-2 sale rows surfaces every 250 variant under Ferrari 250 GT.
--       - Ferrari FXX / FXX K / FXX-K Evo (5 sold, $29.92M) and 857 Sport (3 sold, $16.97M) gain families.
--   * European, Japanese & EV family gaps ($180M+):
--       - Mercedes-Benz SL (230SL, 250SL, SL63 — 192+ sold, $11.49M+), 190 (190E, 190E 2.5-16 Evolution II —
--         $6.5M+), 300 (300TD, 300SD, 300D, 300E, 300CE, 300SC — $12M+), G-Class (G320 — $3.53M+), SLK-Class
--         (SLK55 AMG, SLK350, SLK320, SLK230 — $4.5M+).
--       - BMW 3.0 CS / CSi / CSL (E9, 158+ sold, $12.38M+) & M6 (M635CSi, 50 sold, $2.44M).
--       - Volvo P1800 (390 sold, $10.38M), V70 (V70R, 158 sold, $2.46M), 122S (115 sold, $1.74M), S60 (S60R),
--         PV544, 850 Series.
--       - Tesla (726 sold, $35.56M: Roadster, Model S, Model 3, Model X, Model Y, Cybertruck) and Rivian
--         (172 sold, $14.21M: R1S, R1T).
--       - Land Rover Defender (110, 90, 130, 'er 110' — 82+ sold, $6.65M+), Lexus (LS430, LS400, LC500 —
--         349+ sold, $8.12M+), Porsche 356 (356SC — 40 sold, $4.49M), Audi (RS3, RS7 — 93 sold, $4.96M),
--         McLaren MP4-12C (12C, 12C Spider — $4.5M+), Alfa Romeo (GTV, Montreal — $6.21M+), Maserati (Bora,
--         3500 GT — $5.68M+), Lancia (Flaminia, Stratos — $6.79M+), Shelby Series 1 (50 sold, $6.56M),
--         Sunbeam Tiger (86 sold, $4.85M), Meyers Manx (104 sold, $3.44M), Morgan Plus 4 / Plus 8 ($3.88M+).
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
INSERT INTO public.canonical_makes (canonical_name, display_name, aliases, tier, is_active, country)
SELECT v.canonical_name, v.display_name, v.aliases, v.tier, true, v.country
FROM (VALUES
  ('ROLLS-ROYCE', 'Rolls-Royce', ARRAY['rolls-royce', 'rolls royce'], 1, 'UK'),
  ('VOLVO',       'Volvo',       ARRAY['volvo'], 1, 'Sweden'),
  ('TESLA',       'Tesla',       ARRAY['tesla'], 1, 'USA'),
  ('RIVIAN',      'Rivian',      ARRAY['rivian'], 1, 'USA'),
  ('LAND ROVER',  'Land Rover',  ARRAY['land rover', 'landrover'], 1, 'UK'),
  ('LEXUS',       'Lexus',       ARRAY['lexus'], 1, 'Japan'),
  ('ALFA ROMEO',  'Alfa Romeo',  ARRAY['alfa romeo', 'alfa'], 1, 'Italy'),
  ('MASERATI',    'Maserati',    ARRAY['maserati'], 1, 'Italy'),
  ('SUNBEAM',     'Sunbeam',     ARRAY['sunbeam'], 2, 'UK'),
  ('MEYERS',      'Meyers',      ARRAY['meyers', 'meyers manx'], 2, 'USA'),
  ('MORGAN',      'Morgan',      ARRAY['morgan'], 2, 'UK'),
  ('BUGATTI',     'Bugatti',     ARRAY['bugatti'], 1, 'France'),
  ('SALEEN',      'Saleen',      ARRAY['saleen'], 2, 'USA')
) AS v(canonical_name, display_name, aliases, tier, country)
WHERE NOT EXISTS (
  SELECT 1 FROM public.canonical_makes cm WHERE lower(cm.canonical_name) = lower(v.canonical_name)
);

-- 2. Clear restrictive year_end / year_start gates that rejected $150M+ of valid vehicles
UPDATE public.canonical_models
SET year_end = NULL
WHERE year_end >= 2022
   OR (lower(make) = 'aston martin' AND canonical_model IN ('DB4', 'DB5', 'DB6'))
   OR (lower(make) = 'lamborghini'  AND canonical_model IN ('Miura', '350 GT'))
   OR (lower(make) = 'ferrari'      AND canonical_model IN ('Dino 246', '599', 'FF', '550', '365'))
   OR (lower(make) = 'porsche'      AND canonical_model IN ('356', '550'))
   OR (lower(make) = 'jaguar'       AND canonical_model IN ('XK8', 'E-Type', 'XK120'));

UPDATE public.canonical_models
SET year_start = 1965
WHERE lower(make) = 'ferrari' AND canonical_model = 'Dino 246' AND (year_start IS NULL OR year_start > 1965);

UPDATE public.canonical_models
SET year_start = 1957
WHERE lower(make) = 'porsche' AND canonical_model = '718' AND (year_start IS NULL OR year_start > 1957);

UPDATE public.canonical_models
SET year_start = 1951
WHERE lower(make) = 'mercedes-benz' AND canonical_model = 'S-Class' AND (year_start IS NULL OR year_start > 1951);

-- Remove W126 SEC aliases from Mercedes-Benz CL (1996-2014) so S-Class (1951+) owns 560SEC / 500SEC
UPDATE public.canonical_models
SET aliases = ARRAY(
  SELECT x
  FROM unnest(COALESCE(aliases, '{}'::text[])) AS x
  WHERE lower(x) NOT IN ('560sec', '500sec', 'sec', '560 sec', '500 sec')
)
WHERE lower(make) = 'mercedes-benz' AND canonical_model = 'CL';

-- 3. Consolidate ultra-rare Ferrari 250 variants (250 GTO, 250 LM, 250 P, 250 Testa Rossa, 250 MM, 250 GT/L,
--    250 Europa) into '250 GT' and Bugatti Type 57S / 57C / 57SC into 'Type 57' so 1-2 sale variants aren't
--    dropped by the <3 sale micro-family filter
DELETE FROM public.canonical_models m
WHERE lower(m.make) = 'ferrari'
  AND m.canonical_model IN ('250 GTO', '250 LM', '250 P', '250 Testa Rossa', '250 MM', '250 GT/L', '250 Monza', '250 S', '250 Europa')
  AND NOT EXISTS (SELECT 1 FROM public.make_model_profiles p WHERE p.canonical_model_id = m.id);

DELETE FROM public.canonical_models m
WHERE lower(m.make) = 'bugatti'
  AND m.canonical_model IN ('Type 57C', 'Type 57S', 'Type 57SC')
  AND NOT EXISTS (SELECT 1 FROM public.make_model_profiles p WHERE p.canonical_model_id = m.id);

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
    ARRAY['3500 gt', '3500gt', '3500 gti']),
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
    ARRAY['s7', 's7 twin turbo'])
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

    -- Porsche 356SC + 550A
    ('porsche', '356', ARRAY['356sc', '356 sc', '356sc coupe', '356sc cabriolet']),
    ('porsche', '550', ARRAY['550', '550 spyder', '550a', '550a spyder']),
    ('porsche', '718', ARRAY['718 rsk', '718 rs 60', '718 rs 60 spyder']),

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
