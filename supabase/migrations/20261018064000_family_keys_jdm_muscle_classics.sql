-- Refine canonical_models year bounds, aliases, and missing families for JDM icons,
-- American muscle/classics, Ford/Chevrolet/BMW models, and -f000- sequential UUID rows.
--
-- Why:
-- 1. Year-bound gates on Cadillac DeVille (1959-2005), Cadillac Fleetwood (1947-1996),
--    Ford Custom (1949-1981), Ford Coupe (1917-1940), Ford Victoria (1955-2011),
--    Chevrolet C1500 (1988-1998), and Chevrolet C10 (1960-1987) excluded pre-1959
--    Coupe de Ville ($0.74M), pre-1947 Fleetwood ($0.52M), custom-built Ford Custom
--    coupes/convertibles/woodies ($18.91M+), 1931-1954 Ford Victoria ($0.69M), and
--    Chevrolet Cheyenne / 1500 trucks ($1.87M).
-- 2. JDM collector icons (Toyota 2000GT $6.67M, Land Cruiser FJ-40 $0.70M, Nissan Figaro
--    $1.91M, Skyline $1.59M, Roadster / Fairlady 1600/2000 $2.04M, 510 $0.89M, Z $0.50M,
--    Honda CRX $1.38M, Rune $0.92M, Mitsubishi Pajero Evolution $0.91M) and American
--    muscle/classics (Chrysler 300 Letter Series $3.93M+, Town & Country $3.55M+,
--    Buick GSX $2.82M+, Super $2.48M+, Limited $0.91M, Invicta $0.64M, Caballero $0.53M,
--    Mercury Monterey $2.19M+, Marauder $1.56M, Montclair $2.31M+, Cyclone $1.25M+,
--    Custom $4.61M+, Parklane $0.51M, Pontiac Chieftain $0.89M, Ventura $0.78M,
--    Oldsmobile Vista Cruiser $0.86M, Fiesta $0.60M, Cadillac Series 75 $0.59M,
--    Series 60 $0.59M, Chevrolet Yenko Deuce -> Nova $1.12M, Ford Econoline $1.15M,
--    Tudor $1.06M, Woody $1.05M, Sportsman $1.00M, F-450 $0.76M, BMW 535is -> 5 Series
--    $0.82M, Z1 $0.77M, R69S $0.73M) were falling into "Other models".
-- 3. Six rows from 20261018063000 (Maserati A6G, Fiat Dino, Sunbeam Tiger, Meyers Manx,
--    Morgan Plus 4, Tesla Model Y) shared year-derived -e000- UUIDs with 20261018062000
--    and are inserted here under sequential -f000- UUIDs.
--
-- Contract: supabase/sql/test_family_keys_jdm_muscle_classics.sql (db-contracts).

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

-- 1. Widen restrictive year_start / year_end bounds on existing canonical_models rows.
WITH year_fixes(make, canonical_model, new_year_start, clear_year_end) AS (
  VALUES
    ('Cadillac',  'DeVille',   1949, true),
    ('Cadillac',  'Fleetwood', 1927, true),
    ('Ford',      'Custom',    1920, true),
    ('Ford',      'Coupe',     1908, true),
    ('Ford',      'Victoria',  1930, true),
    ('Ford',      'Model T',   1908, true),
    ('Buick',     'GS',        1965, true),
    ('Chevrolet', 'C1500',     1960, true),
    ('Chevrolet', 'C10',       1947, false)
)
UPDATE public.canonical_models m
SET year_start = CASE
      WHEN yf.new_year_start IS NOT NULL AND (m.year_start IS NULL OR m.year_start > yf.new_year_start)
      THEN yf.new_year_start
      ELSE m.year_start
    END,
    year_end = CASE
      WHEN yf.clear_year_end THEN NULL
      WHEN lower(m.make) = 'chevrolet' AND lower(m.canonical_model) = 'c10' AND (m.year_end IS NULL OR m.year_end < 1998) THEN 1998
      ELSE m.year_end
    END,
    notes = CASE
      WHEN coalesce(m.notes, '') LIKE '%[2026-10-18 jdm-muscle-classics]%' THEN m.notes
      ELSE concat_ws(' ', m.notes, '[2026-10-18 jdm-muscle-classics] widened year bounds for family coverage.')
    END
FROM year_fixes yf
WHERE lower(m.make) = lower(yf.make)
  AND lower(m.canonical_model) = lower(yf.canonical_model)
  AND (
    (yf.new_year_start IS NOT NULL AND (m.year_start IS NULL OR m.year_start > yf.new_year_start))
    OR (yf.clear_year_end AND m.year_end IS NOT NULL)
    OR (lower(m.make) = 'chevrolet' AND lower(m.canonical_model) = 'c10' AND (m.year_end IS NULL OR m.year_end < 1998))
  );

-- 2. Add missing aliases to existing canonical_models families.
WITH target_additions(make, canonical_model, add_aliases) AS (
  VALUES
    ('Toyota',    'Land Cruiser', ARRAY['fj-40', 'fj-43', 'fj-45', 'fj-55', 'fj-60', 'fj-62', 'fzj-80', 'uzj-100', 'bj-40', 'hj-45', 'hj-47', 'hj-60', 'hj-61']),
    ('Chrysler',  '300',          ARRAY['300b', '300c', '300d', '300e', '300f', '300g', '300h', '300j', '300k', '300l', '300s', '300c srt8', '300 srt8']),
    ('Buick',     'GS',           ARRAY['gsx', 'gsx stage 1', 'gs 455 stage 1']),
    ('Ford',      'Coupe',        ARRAY['5 window', '5-window', '3 window', '3-window']),
    ('Ford',      'Custom',       ARRAY['custom woody wagon', 'custom convertible', 'custom 2 door coupe', 'custom cabriolet', 'custom roadster', 'custom 2 door sedan']),
    ('Ford',      'Model T',      ARRAY['t-bucket', 't bucket']),
    ('Ford',      'F-450',        ARRAY['f450', 'f 450']),
    ('Chevrolet', 'Nova',         ARRAY['yenko deuce', 'chevy ii nova', 'nova ss']),
    ('Chevrolet', 'C10',          ARRAY['cheyenne', 'c10 cheyenne', 'c/10']),
    ('Chevrolet', 'Pickup',       ARRAY['5 window', '5-window', '3 window', '3-window', 'window', 'custom pickup']),
    ('BMW',       '5 Series',     ARRAY['535is', '533i', '528e', '524td', '535i/535is'])
),
rows_to_update AS (
  SELECT m.id,
         ARRAY(
           SELECT DISTINCT x
           FROM unnest(coalesce(m.aliases, '{}'::text[]) || t.add_aliases) WITH ORDINALITY AS u(x, ord)
           ORDER BY x
         ) AS next_aliases
  FROM public.canonical_models m
  JOIN target_additions t
    ON lower(m.make) = lower(t.make)
   AND lower(m.canonical_model) = lower(t.canonical_model)
  WHERE NOT (coalesce(m.aliases, '{}'::text[]) @> t.add_aliases)
)
UPDATE public.canonical_models m
SET aliases = r.next_aliases,
    notes = CASE
      WHEN coalesce(m.notes, '') LIKE '%[2026-10-18 jdm-muscle-classics]%' THEN m.notes
      ELSE concat_ws(' ', m.notes, '[2026-10-18 jdm-muscle-classics] added JDM, muscle, and classic model aliases.')
    END
FROM rows_to_update r
WHERE m.id = r.id;

-- 3. Insert missing canonical families using sequential -f000- UUIDs.
INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases, notes)
SELECT nf.id, nf.make, nf.canonical_model, nf.year_start, nf.year_end, nf.aliases, nf.notes
FROM (
  VALUES
    ('00000000-0000-4000-f000-000000000001'::uuid, 'Toyota', '2000GT', 1967, NULL::int,
      ARRAY['2000gt', '2000 gt'],
      '[2026-10-18 jdm-muscle-classics] canonical Toyota 2000GT family.'),
    ('00000000-0000-4000-f000-000000000002'::uuid, 'Nissan', 'Figaro', 1991, NULL::int,
      ARRAY['figaro'],
      '[2026-10-18 jdm-muscle-classics] canonical Nissan Figaro family.'),
    ('00000000-0000-4000-f000-000000000003'::uuid, 'Nissan', 'Skyline', 1957, NULL::int,
      ARRAY['skyline', 'skyline gt-r', 'skyline gtr', 'skyline 2000gt-r', 'hakosuka', 'kenmeri', 'r32', 'r33', 'r34'],
      '[2026-10-18 jdm-muscle-classics] canonical Nissan Skyline family.'),
    ('00000000-0000-4000-f000-000000000004'::uuid, 'Nissan', 'Roadster', 1959, NULL::int,
      ARRAY['roadster', '2000 roadster', '1600 roadster', '1500 roadster', 'fairlady', 'fairlady roadster', 'spl311', 'srl311', 'sp310', 'sp311'],
      '[2026-10-18 jdm-muscle-classics] canonical Nissan / Datsun Fairlady Roadster family.'),
    ('00000000-0000-4000-f000-000000000005'::uuid, 'Nissan', '510', 1968, NULL::int,
      ARRAY['510', 'datsun 510', 'bluebird 510'],
      '[2026-10-18 jdm-muscle-classics] canonical Nissan / Datsun 510 family.'),
    ('00000000-0000-4000-f000-000000000006'::uuid, 'Nissan', 'Z', 1969, NULL::int,
      ARRAY['z', 'fairlady z', '400z'],
      '[2026-10-18 jdm-muscle-classics] canonical Nissan Z family.'),
    ('00000000-0000-4000-f000-000000000007'::uuid, 'Honda', 'CRX', 1984, NULL::int,
      ARRAY['crx', 'cr-x', 'crx si', 'cr-x si', 'crx hf', 'crx dx'],
      '[2026-10-18 jdm-muscle-classics] canonical Honda CRX family.'),
    ('00000000-0000-4000-f000-000000000008'::uuid, 'Honda', 'Rune', 2004, NULL::int,
      ARRAY['rune', 'valkyrie rune', 'nrx1800'],
      '[2026-10-18 jdm-muscle-classics] canonical Honda Valkyrie Rune family.'),
    ('00000000-0000-4000-f000-000000000009'::uuid, 'Mitsubishi', 'Pajero', 1982, NULL::int,
      ARRAY['pajero', 'pajero evolution', 'pajero evo', 'pajero mini'],
      '[2026-10-18 jdm-muscle-classics] canonical Mitsubishi Pajero / Evolution family.'),
    ('00000000-0000-4000-f000-000000000010'::uuid, 'Chrysler', 'Town & Country', 1941, NULL::int,
      ARRAY['town & country', 'town and country', 'town & country convertible', 'town & country sedan', 'town & country wagon'],
      '[2026-10-18 jdm-muscle-classics] canonical Chrysler Town & Country family.'),
    ('00000000-0000-4000-f000-000000000011'::uuid, 'Mercury', 'Monterey', 1950, NULL::int,
      ARRAY['monterey', 'monterey convertible', 'monterey coupe', 'monterey custom', 'monterey sun valley'],
      '[2026-10-18 jdm-muscle-classics] canonical Mercury Monterey family.'),
    ('00000000-0000-4000-f000-000000000012'::uuid, 'Mercury', 'Marauder', 1963, NULL::int,
      ARRAY['marauder', 'marauder s-55', 'marauder x-100'],
      '[2026-10-18 jdm-muscle-classics] canonical Mercury Marauder family.'),
    ('00000000-0000-4000-f000-000000000013'::uuid, 'Mercury', 'Montclair', 1955, NULL::int,
      ARRAY['montclair', 'montclair convertible', 'montclair phaeton', 'montclair sun valley'],
      '[2026-10-18 jdm-muscle-classics] canonical Mercury Montclair family.'),
    ('00000000-0000-4000-f000-000000000014'::uuid, 'Mercury', 'Cyclone', 1964, NULL::int,
      ARRAY['cyclone', 'cyclone gt', 'cyclone spoiler', 'cyclone cj', 'comet cyclone'],
      '[2026-10-18 jdm-muscle-classics] canonical Mercury Cyclone family.'),
    ('00000000-0000-4000-f000-000000000015'::uuid, 'Mercury', 'Custom', 1949, NULL::int,
      ARRAY['custom', 'custom coupe', 'custom convertible', 'custom 2 door coupe', 'custom sedan'],
      '[2026-10-18 jdm-muscle-classics] canonical Mercury Custom family.'),
    ('00000000-0000-4000-f000-000000000016'::uuid, 'Mercury', 'Parklane', 1958, NULL::int,
      ARRAY['parklane', 'park lane', 'parklane convertible', 'park lane convertible'],
      '[2026-10-18 jdm-muscle-classics] canonical Mercury Parklane family.'),
    ('00000000-0000-4000-f000-000000000017'::uuid, 'Buick', 'Super', 1930, NULL::int,
      ARRAY['super', 'super convertible', 'super estate wagon', 'super riviera', 'super 8', 'super eight'],
      '[2026-10-18 jdm-muscle-classics] canonical Buick Super family.'),
    ('00000000-0000-4000-f000-000000000018'::uuid, 'Buick', 'Limited', 1936, NULL::int,
      ARRAY['limited', 'limited convertible', 'series 90 limited'],
      '[2026-10-18 jdm-muscle-classics] canonical Buick Limited family.'),
    ('00000000-0000-4000-f000-000000000019'::uuid, 'Buick', 'Invicta', 1959, NULL::int,
      ARRAY['invicta', 'invicta convertible', 'invicta custom'],
      '[2026-10-18 jdm-muscle-classics] canonical Buick Invicta family.'),
    ('00000000-0000-4000-f000-000000000020'::uuid, 'Buick', 'Caballero', 1957, NULL::int,
      ARRAY['caballero', 'century caballero'],
      '[2026-10-18 jdm-muscle-classics] canonical Buick Caballero family.'),
    ('00000000-0000-4000-f000-000000000021'::uuid, 'Pontiac', 'Chieftain', 1949, NULL::int,
      ARRAY['chieftain', 'chieftain convertible', 'chieftain deluxe', 'chieftain catalina'],
      '[2026-10-18 jdm-muscle-classics] canonical Pontiac Chieftain family.'),
    ('00000000-0000-4000-f000-000000000022'::uuid, 'Pontiac', 'Ventura', 1960, NULL::int,
      ARRAY['ventura', 'ventura ii', 'ventura gto', 'ventura sprint', 'ventura custom'],
      '[2026-10-18 jdm-muscle-classics] canonical Pontiac Ventura family.'),
    ('00000000-0000-4000-f000-000000000023'::uuid, 'Oldsmobile', 'Vista Cruiser', 1964, NULL::int,
      ARRAY['vista cruiser', 'cutlass vista cruiser'],
      '[2026-10-18 jdm-muscle-classics] canonical Oldsmobile Vista Cruiser family.'),
    ('00000000-0000-4000-f000-000000000024'::uuid, 'Oldsmobile', 'Fiesta', 1953, NULL::int,
      ARRAY['fiesta', 'fiesta convertible', '98 fiesta'],
      '[2026-10-18 jdm-muscle-classics] canonical Oldsmobile Fiesta family.'),
    ('00000000-0000-4000-f000-000000000025'::uuid, 'Cadillac', 'Series 75', 1936, NULL::int,
      ARRAY['series 75', '75 fleetwood', 'series 75 limousine', 'series 75 imperial'],
      '[2026-10-18 jdm-muscle-classics] canonical Cadillac Series 75 family.'),
    ('00000000-0000-4000-f000-000000000026'::uuid, 'Cadillac', 'Series 60', 1936, NULL::int,
      ARRAY['series 60', 'sixty special', 'series 60 special', '60 special'],
      '[2026-10-18 jdm-muscle-classics] canonical Cadillac Series 60 Special family.'),
    ('00000000-0000-4000-f000-000000000027'::uuid, 'Ford', 'Econoline', 1961, NULL::int,
      ARRAY['econoline', 'e-100', 'e100', 'e-150', 'e150', 'e-250', 'e250', 'e-350', 'e350', 'club wagon'],
      '[2026-10-18 jdm-muscle-classics] canonical Ford Econoline / E-Series family.'),
    ('00000000-0000-4000-f000-000000000028'::uuid, 'Ford', 'Tudor', 1923, NULL::int,
      ARRAY['tudor', 'tudor sedan', 'deluxe tudor', 'custom tudor'],
      '[2026-10-18 jdm-muscle-classics] canonical Ford Tudor family.'),
    ('00000000-0000-4000-f000-000000000029'::uuid, 'Ford', 'Woody', 1929, NULL::int,
      ARRAY['woody', 'woody wagon', 'woodie', 'woodie wagon'],
      '[2026-10-18 jdm-muscle-classics] canonical Ford Woody Wagon family.'),
    ('00000000-0000-4000-f000-000000000030'::uuid, 'Ford', 'Sportsman', 1946, NULL::int,
      ARRAY['sportsman', 'super deluxe sportsman', 'sportsman convertible'],
      '[2026-10-18 jdm-muscle-classics] canonical Ford Sportsman Woodie Convertible family.'),
    ('00000000-0000-4000-f000-000000000031'::uuid, 'BMW', 'Z1', 1989, NULL::int,
      ARRAY['z1'],
      '[2026-10-18 jdm-muscle-classics] canonical BMW Z1 roadster family.'),
    ('00000000-0000-4000-f000-000000000032'::uuid, 'BMW', 'R69S', 1960, NULL::int,
      ARRAY['r69s', 'r69', 'r69us'],
      '[2026-10-18 jdm-muscle-classics] canonical BMW R69S motorcycle family.'),
    ('00000000-0000-4000-f000-000000000033'::uuid, 'Maserati', 'A6G', 1947, NULL::int,
      ARRAY['a6g', 'a6g/54', 'a6g 54', 'a6g54', 'a6gcs', 'a6gcs/53', 'a6gcs 53', 'a6g/2000', 'a6g 2000'],
      '[2026-10-18 jdm-muscle-classics] canonical Maserati A6G / A6G/54 / A6GCS family.'),
    ('00000000-0000-4000-f000-000000000034'::uuid, 'Fiat', 'Dino', 1966, NULL::int,
      ARRAY['dino', 'dino spider', 'dino coupe', 'dino 2000', 'dino 2400'],
      '[2026-10-18 jdm-muscle-classics] canonical Fiat Dino family.'),
    ('00000000-0000-4000-f000-000000000035'::uuid, 'Sunbeam', 'Tiger', 1964, NULL::int,
      ARRAY['tiger', 'tiger mk i', 'tiger mk ia', 'tiger mk ii', 'tiger mki', 'tiger mkii'],
      '[2026-10-18 jdm-muscle-classics] canonical Sunbeam Tiger family.'),
    ('00000000-0000-4000-f000-000000000036'::uuid, 'Meyers', 'Manx', 1964, NULL::int,
      ARRAY['manx', 'meyers manx', 'manx dune buggy', 'manx sr'],
      '[2026-10-18 jdm-muscle-classics] canonical Meyers Manx family.'),
    ('00000000-0000-4000-f000-000000000037'::uuid, 'Morgan', 'Plus 4', 1950, NULL::int,
      ARRAY['plus 4', '+4', 'plus four'],
      '[2026-10-18 jdm-muscle-classics] canonical Morgan Plus 4 family.'),
    ('00000000-0000-4000-f000-000000000038'::uuid, 'Tesla', 'Model Y', 2020, NULL::int,
      ARRAY['model y', 'model y performance', 'model y long range'],
      '[2026-10-18 jdm-muscle-classics] canonical Tesla Model Y family.')
) AS nf(id, make, canonical_model, year_start, year_end, aliases, notes)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.canonical_models cm
  WHERE lower(cm.make) = lower(nf.make)
    AND lower(cm.canonical_model) = lower(nf.canonical_model)
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
