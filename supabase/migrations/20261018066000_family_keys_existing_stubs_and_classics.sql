-- =============================================================================
-- Migration: 20261018066000_family_keys_existing_stubs_and_classics.sql
-- Purpose:   Close remaining family_key = 'other' gaps across:
--            1. Tribute-year bounds on Superformance MkIII, Factory Five Mk4 Roadster / GTM,
--               Backdraft RT4 Roadster (often titled as 1965/1933), plus widened year bounds on
--               Austin-Healey 3000 / Sprite, MG MGA / MGB / TC / TD / TF, Triumph TR3 / TR4 /
--               TR6 / TR250 / Spitfire / GT6, Toyota Land Cruiser / Pickup, Ferrari F355 /
--               308 / 328, BMW Z3, Jaguar Mark II / XJ, International Scout, Jeep Wagoneer /
--               Gladiator, Hummer H1 / H2, and Honda CB750 / CBX / CT70 / Z50.
--            2. Existing stub rows in canonical_models (Mercedes-Benz CLS-Class, M-Class,
--               GLS-Class, GLK-Class, R-Class, G-Class, Sprinter; Audi A8 / Quattro;
--               Fiat 124 Spider / 500; Mazda RX-7 / Mazda3; Porsche 924 / 356; Ferrari 208).
--            3. Classic European, British, Japanese, and American families:
--               Bentley 3 1/2 Litre, Maserati Sebring, Lotus Seven / Cortina, BMW 6 Series /
--               R90S, Jaguar Mark IX, MG MGC, Triumph TR2, Saab 96, Honda S600 / XR75,
--               Nissan Patrol, Mazda Cosmo, Hummer H3, Lancia Fulvia, Fiat X1/9,
--               Hudson Hornet, International Travelall, Jeep Commando, Kawasaki H2,
--               Superformance GT40, and Factory Five '33 Hot Rod.
-- Contract:  supabase/sql/test_family_keys_existing_stubs_and_classics.sql (db-contracts).
-- =============================================================================

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

-- 1. Insert any missing canonical families first using sequential -f000-0000000001XX UUIDs.
INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases, notes)
SELECT nf.id, nf.make, nf.canonical_model, nf.year_start, nf.year_end, nf.aliases, nf.notes
FROM (
  VALUES
    ('00000000-0000-4000-f000-000000000173'::uuid, 'Bentley', '3 1/2 Litre', 1930, NULL::int,
      ARRAY['3 1/2 litre', '3 1/2 litre drophead coupe', '4 1/4 litre', 'mark vi', 'r-type', 's1', 's2', 's3'],
      '[2026-10-18 stubs-and-classics] canonical Bentley 3 1/2 Litre / Derby & Crewe family.'),
    ('00000000-0000-4000-f000-000000000174'::uuid, 'Maserati', 'Sebring', 1962, NULL::int,
      ARRAY['sebring', 'sebring series i', 'sebring series ii', 'gransport', 'shamal', 'biturbo', 'karif', 'khamsin', 'indy', 'mexico', 'kyalami'],
      '[2026-10-18 stubs-and-classics] canonical Maserati Sebring / GranSport / Shamal GT family.'),
    ('00000000-0000-4000-f000-000000000175'::uuid, 'Lotus', 'Seven', 1957, NULL::int,
      ARRAY['seven', 'super seven', 'seven series 2', 'seven series 3', 'seven series 4', '23b', '23', 'eleven'],
      '[2026-10-18 stubs-and-classics] canonical Lotus Seven / Super Seven / 23B family.'),
    ('00000000-0000-4000-f000-000000000176'::uuid, 'Lotus', 'Cortina', 1963, NULL::int,
      ARRAY['cortina', 'cortina mk1', 'cortina mk2', 'elan +2'],
      '[2026-10-18 stubs-and-classics] canonical Lotus Cortina family.'),
    ('00000000-0000-4000-f000-000000000177'::uuid, 'BMW', '6 Series', 1976, NULL::int,
      ARRAY['633csi', '633csi 5-speed', '635csi', '635csi 5-speed', '650i', '640i', 'l6', 'm635csi'],
      '[2026-10-18 stubs-and-classics] canonical BMW 6 Series (E24 / E63 / F12) family.'),
    ('00000000-0000-4000-f000-000000000178'::uuid, 'BMW', 'R90S', 1923, NULL::int,
      ARRAY['r90s', 'r90/6', 'r60/2', 'r50/2', 'r75/5', 'r42', 'r80g/s', 'r100rs', 'r100gs', 'r60/5', 'r75/6'],
      '[2026-10-18 stubs-and-classics] canonical BMW Boxer motorcycle (R90S / R60/2 / R50/2 / R75/5) family.'),
    ('00000000-0000-4000-f000-000000000179'::uuid, 'Jaguar', 'Mark IX', 1950, NULL::int,
      ARRAY['mk ix', 'mark ix', 'mk vii', 'mark vii', 'mk viii', 'mk x', '420g'],
      '[2026-10-18 stubs-and-classics] canonical Jaguar Mark VII / VIII / IX / X saloon family.'),
    ('00000000-0000-4000-f000-000000000180'::uuid, 'MG', 'MGC', 1967, NULL::int,
      ARRAY['mgc', 'mgc gt', 'mgc roadster'],
      '[2026-10-18 stubs-and-classics] canonical MG MGC / MGC GT family.'),
    ('00000000-0000-4000-f000-000000000181'::uuid, 'Triumph', 'TR2', 1953, NULL::int,
      ARRAY['tr2', 'tr5', 'tr5 pi', 'tr7', 'tr8', 'stag', 'herald', 'vitesse', 'dolomite'],
      '[2026-10-18 stubs-and-classics] canonical Triumph TR2 / TR5 / Stag / TR8 family.'),
    ('00000000-0000-4000-f000-000000000182'::uuid, 'Saab', '96', 1950, NULL::int,
      ARRAY['96', '95', '95 wagon', '93', '99', '99 turbo', 'sonett', 'sonett ii', 'sonett iii'],
      '[2026-10-18 stubs-and-classics] canonical Saab 96 / 95 / Sonett / 99 family.'),
    ('00000000-0000-4000-f000-000000000183'::uuid, 'Honda', 'S600', 1963, NULL::int,
      ARRAY['s600', 's600 roadster', 's600 coupe', 's800', 's800 coupe', 's800 roadster', 's500'],
      '[2026-10-18 stubs-and-classics] canonical Honda S600 / S800 roadster & coupe family.'),
    ('00000000-0000-4000-f000-000000000184'::uuid, 'Honda', 'XR75', 1960, NULL::int,
      ARRAY['xr75', 'cl77 scrambler', 'gb500', 'motocompo', 'cb400f', 'cb350', 'cb550', 'cr250r', 'cr500r', 'atc250r', 'fl350r odyssey'],
      '[2026-10-18 stubs-and-classics] canonical Honda XR75 / CL77 / GB500 / Motocompo moto family.'),
    ('00000000-0000-4000-f000-000000000185'::uuid, 'Nissan', 'Patrol', 1951, NULL::int,
      ARRAY['patrol', 'patrol 4×4', 'patrol g60', 'safari'],
      '[2026-10-18 stubs-and-classics] canonical Nissan Patrol 4x4 family.'),
    ('00000000-0000-4000-f000-000000000186'::uuid, 'Mazda', 'Cosmo', 1967, NULL::int,
      ARRAY['cosmo', 'cosmo series ii', 'cosmo sport', '110s', 'rx-3', 'rx-2', 'rx-4'],
      '[2026-10-18 stubs-and-classics] canonical Mazda Cosmo / Rotary Coupe family.'),
    ('00000000-0000-4000-f000-000000000187'::uuid, 'Hummer', 'H3', 2005, NULL::int,
      ARRAY['h3', 'h3t', 'h3t alpha', 'h3 alpha'],
      '[2026-10-18 stubs-and-classics] canonical Hummer H3 / H3T family.'),
    ('00000000-0000-4000-f000-000000000188'::uuid, 'Lancia', 'Fulvia', 1963, NULL::int,
      ARRAY['fulvia', 'fulvia coupe', 'fulvia hf', 'fulvia sport zagato'],
      '[2026-10-18 stubs-and-classics] canonical Lancia Fulvia family.'),
    ('00000000-0000-4000-f000-000000000189'::uuid, 'Fiat', 'X1/9', 1968, NULL::int,
      ARRAY['x1/9', 'bertone x1/9', '850 spider', '850 sport spider'],
      '[2026-10-18 stubs-and-classics] canonical Fiat X1/9 / 850 Spider family.'),
    ('00000000-0000-4000-f000-000000000190'::uuid, 'Hudson', 'Hornet', 1929, NULL::int,
      ARRAY['hornet', 'italia', 'commodore', 'super six', 'big boy', 'terraplane'],
      '[2026-10-18 stubs-and-classics] canonical Hudson Hornet / Italia / Commodore family.'),
    ('00000000-0000-4000-f000-000000000191'::uuid, 'International', 'Travelall', 1935, NULL::int,
      ARRAY['travelall', 'mxt', 'cxt', 'travelette', 'pickup', 'metro', 'loadstar'],
      '[2026-10-18 stubs-and-classics] canonical International Travelall / MXT / CXT truck family.'),
    ('00000000-0000-4000-f000-000000000192'::uuid, 'Jeep', 'Commando', 1955, NULL::int,
      ARRAY['commando', 'jeepster commando', 'j10', 'j20', 'honcho', 'fc-150', 'fc-170', 'cj-6'],
      '[2026-10-18 stubs-and-classics] canonical Jeep Commando / J10 / FC truck family.'),
    ('00000000-0000-4000-f000-000000000193'::uuid, 'Kawasaki', 'H2', 1968, NULL::int,
      ARRAY['h2 750', 'h2', 'h1 500', 'z1', 'z1 900', 'kz1000', 'kz900', 'gpz900r', 'zx-7r'],
      '[2026-10-18 stubs-and-classics] canonical Kawasaki H2 750 / Z1 / KZ1000 motorcycle family.'),
    ('00000000-0000-4000-f000-000000000194'::uuid, 'Superformance', 'GT40', 1930, NULL::int,
      ARRAY['gt40', 'gt 40', 'ford gt40', 'gt40 mki', 'gt40 mkii', 'gt40 mk1', 'gt40 mk i', 'gt40 mk ii', 'ford gt40 mki', 'ford gt40 mkii', 'daytona', 'daytona coupe', 'brock daytona coupe recreation', 'shelby daytona coupe', 'shelby daytona replica', 'corvette grand sport', 's1', 's-1'],
      '[2026-10-18 stubs-and-classics] canonical Superformance GT40 / Daytona Coupe / Grand Sport family.'),
    ('00000000-0000-4000-f000-000000000195'::uuid, 'Factory Five', '33 Hot Rod', 1930, NULL::int,
      ARRAY['five 33 hot rod', 'five ’33 hot rod', 'five 1933 ford hot rod', '5 1933 hot rod', '5 hot rod', 'five hot rod pickup', '818', '818s', '818r', 'five 818', 'five 818s', 'five 818r'],
      '[2026-10-18 stubs-and-classics] canonical Factory Five 33 Hot Rod / 818 family.')
) AS nf(id, make, canonical_model, year_start, year_end, aliases, notes)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.canonical_models cm
  WHERE lower(cm.make) = lower(nf.make)
    AND lower(cm.canonical_model) = lower(nf.canonical_model)
)
ON CONFLICT (id) DO NOTHING;

-- 2. Widen restrictive year_start / year_end bounds on existing & newly inserted canonical_models rows.
WITH year_fixes(make, canonical_model, new_year_start, clear_year_end) AS (
  VALUES
    ('Superformance', 'MkIII',        1930, true),
    ('Factory Five',  'Mk4 Roadster', 1930, true),
    ('Factory Five',  'GTM',          1930, true),
    ('Backdraft',     'RT4 Roadster', 1930, true),
    ('Austin-Healey', '3000',         1958, true),
    ('Austin-Healey', 'Sprite',       1958, true),
    ('MG',            'MGA',          1955, true),
    ('MG',            'MGB',          1962, true),
    ('MG',            'TC',           1935, true),
    ('MG',            'TD',           1935, true),
    ('MG',            'TF',           1935, true),
    ('Triumph',       'TR3',          1953, true),
    ('Triumph',       'TR4',          1960, true),
    ('Triumph',       'TR6',          1967, true),
    ('Triumph',       'TR250',        1966, true),
    ('Triumph',       'Spitfire',     1960, true),
    ('Triumph',       'GT6',          1965, true),
    ('Toyota',        'Land Cruiser', 1951, true),
    ('Toyota',        'Pickup',       1964, true),
    ('Ferrari',       'F355',         1994, true),
    ('Ferrari',       '308',          1973, true),
    ('Ferrari',       '328',          1984, true),
    ('BMW',           'Z3',           1995, true),
    ('BMW',           '6 Series',     1975, true),
    ('Jaguar',        'Mark II',      1955, true),
    ('Jaguar',        'XJ',           1968, true),
    ('International', 'Scout',        1960, true),
    ('Jeep',          'Wagoneer',     1962, true),
    ('Jeep',          'Gladiator',    1962, true),
    ('Hummer',        'H1',           1990, true),
    ('Hummer',        'H2',           2000, true),
    ('Hummer',        'H3',           2004, true),
    ('Honda',         'CB750',        1968, true),
    ('Honda',         'CBX',          1977, true),
    ('Honda',         'CT70',         1968, true),
    ('Honda',         'Z50',          1967, true)
)
UPDATE public.canonical_models m
SET year_start = CASE
      WHEN yf.new_year_start IS NOT NULL AND (m.year_start IS NULL OR m.year_start > yf.new_year_start)
      THEN yf.new_year_start
      ELSE m.year_start
    END,
    year_end = CASE
      WHEN yf.clear_year_end THEN NULL
      ELSE m.year_end
    END,
    notes = CASE
      WHEN coalesce(m.notes, '') LIKE '%[2026-10-18 stubs-and-classics]%' THEN m.notes
      ELSE concat_ws(' ', m.notes, '[2026-10-18 stubs-and-classics] widened year bounds for family coverage.')
    END
FROM year_fixes yf
WHERE lower(m.make) = lower(yf.make)
  AND lower(m.canonical_model) = lower(yf.canonical_model)
  AND (
    (yf.new_year_start IS NOT NULL AND (m.year_start IS NULL OR m.year_start > yf.new_year_start))
    OR (yf.clear_year_end AND m.year_end IS NOT NULL)
  );

-- 3. Merge aliases into existing & stub canonical_models rows.
WITH target_additions(make, canonical_model, add_aliases) AS (
  VALUES
    ('Mercedes-Benz', 'CLS-Class',    ARRAY['cls550', 'cls55 amg', 'cls63 amg', 'cls500', 'cls400', 'cls53 amg', 'cls450']),
    ('Mercedes-Benz', 'M-Class',      ARRAY['ml350', 'ml350 4matic', 'ml350 bluetec 4matic', 'ml63 amg', 'ml55 amg', 'ml500', 'ml320', 'ml430']),
    ('Mercedes-Benz', 'GLS-Class',    ARRAY['gls63', 'gls600', 'gls550', 'gls450', 'gls580']),
    ('Mercedes-Benz', 'GLK-Class',    ARRAY['glk350', 'glk350 4matic', 'glk250', 'glk250 bluetec 4matic']),
    ('Mercedes-Benz', 'R-Class',      ARRAY['r63 amg', 'r63', 'r350 4matic', 'r350', 'r500']),
    ('Mercedes-Benz', 'G-Class',      ARRAY['g36 amg', 'g550 4x4²', 'g500 cabriolet']),
    ('Mercedes-Benz', 'Sprinter',     ARRAY['revel 4×4', 'revel 4×4 motorhome', 'sprinter 2500', 'sprinter 3500']),
    ('Audi',          'A8',           ARRAY['a8', 'a8l', 'a8l w12', 'a8l tdi', 'a8 l', 's8']),
    ('Audi',          'Quattro',      ARRAY['rs2 avant', 'rs2']),
    ('Austin-Healey', '3000',         ARRAY['bj8', 'bj-8', 'bt7', 'bn7', 'iii bj8', 'iii bj8 convertible', 'bj8 convertible', 'ii bt7 roadster', 'i bt7', 'i bn7', '3000 bt7 roadster', '3000 bt7 convertible', '3000 mark ii bt7 roadster', '3000 mark i roadster', '4-seat roadster', 'roadster']),
    ('Austin-Healey', 'Sprite',       ARRAY['bugeye sprite', 'mk i sprite', 'sprite mk i', 'sprite mk ii', 'sprite mk iii', 'sprite mk iv']),
    ('MG',            'MGA',          ARRAY['twin-cam roadster', '1500 roadster', '1600 roadster', 'roadster']),
    ('BMW',           '3 Series',     ARRAY['320is', '320is 5-speed', '318i 5-speed', '325ix']),
    ('BMW',           '6 Series',     ARRAY['633csi', '633csi 5-speed', '635csi', '635csi 5-speed', '650i', '640i', 'l6', 'm635csi']),
    ('BMW',           'Z3',           ARRAY['m coupe', 'm roadster']),
    ('Ferrari',       'F355',         ARRAY['355 f1 berlinetta', '355 f1 spider', '355 f1 gts', '355 challenge']),
    ('Ferrari',       '208',          ARRAY['gtb turbo', 'gts turbo', '208 gtb turbo', '208 gts turbo', '208 gt4']),
    ('Porsche',       '924',          ARRAY['924s', '924 turbo', '924 carrera gt']),
    ('Porsche',       '356',          ARRAY['america roadster', '356 america roadster']),
    ('Jaguar',        'XJ',           ARRAY['super v8', 'xj8l', 'xjr-s', 'vanden plas']),
    ('Fiat',          '124 Spider',   ARRAY['124 sport spider', '124 spider', 'spider 2000', 'pininfarina spider']),
    ('Fiat',          '500',          ARRAY['jolly', '500 jolly', '600 jolly']),
    ('Mazda',         'RX-7',         ARRAY['rx7', 'rx-7', 'rx-7 twin turbo', 'rx-7 turbo', 'rx-7 gsl-se', 'fd3s']),
    ('Mazda',         'Mazda3',       ARRAY['mazdaspeed3', 'mazdaspeed 3']),
    ('Toyota',        'Land Cruiser', ARRAY['bandeirante oj55', 'bandeirante oj50', 'bandeirante bj55 5-speed', 'bandeirante']),
    ('Toyota',        'Pickup',       ARRAY['sr5', '4x4', 'xtracab']),
    ('Honda',         'CBX',          ARRAY['cbx1000', 'cbx 1000']),
    ('Hummer',        'H3',           ARRAY['h3', 'h3t', 'h3t alpha', 'h3 alpha']),
    ('Factory Five',  'Mk4 Roadster', ARRAY['cobra', 'cobra mkiii', '5 factory 5 cobra marklll', 'five mk1 roadster', 'five mk2 roadster', 'five mk2 roadster cobra replica', 'five mk3 roadster', 'five mk4 cobra roadster cobra', 'five racing mk1 cobra roadster', 'five racing mk2', 'five racing mk 2 cobra', 'five racing mk2 cobra roadster', 'five racing mk2 roadster', 'five racing mk3', 'five racing mk 3 cobra roadster', 'five racing mk3 roadster', 'five racing mk3 roadster cobra', 'five racing mark 2 roadster', 'five racing mark ii']),
    ('Factory Five',  'GTM',          ARRAY['daytona coupe', 'five daytona coupe', 'type 65', 'type 65 daytona coupe replica', 'shelby daytona', 'five racing daytona spyder']),
    ('Superformance', 'MkIII',        ARRAY['mark iii', 'mk111', 'mki', 'mkii', 'mkii custom roadster', 'mkii slab side', 're-creation', 'shelby']),
    ('Backdraft',     'RT4 Roadster', ARRAY['rt4b', 'racing rt4', 'racing rt3b jach roush edition'])
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
      WHEN coalesce(m.notes, '') LIKE '%[2026-10-18 stubs-and-classics]%' THEN m.notes
      ELSE concat_ws(' ', m.notes, '[2026-10-18 stubs-and-classics] added stub and classic family aliases.')
    END
FROM rows_to_update r
WHERE m.id = r.id;

COMMIT;
