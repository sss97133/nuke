-- =============================================================================
-- Migration: 20261018065000_family_keys_grand_prix_coachbuilt_motos.sql
-- Purpose:   Close remaining high-value family_key = 'other' gaps across:
--            1. Year-bound gates on Rolls-Royce Corniche, Silver Wraith, Wraith,
--               Austin-Healey 100, and Ferrari F430.
--            2. Existing family alias additions on Bugatti Type 35 / Type 43 / Chiron,
--               Ferrari 857 S / F430, Austin-Healey 100, Delahaye 135, Citroen 2 CV / DS,
--               Rolls-Royce Corniche, and GMC Pickup / Hummer EV.
--            3. Grand Prix, coachbuilt, specialist, replica & vintage motorcycle families
--               using sequential -f000-0000000001XX UUIDs:
--               Mercedes-Benz 540K / 680S, Mercer Raceabout, Simplex 50 HP, Spyker C8,
--               Audi Quattro, Auburn 851, Dual-Ghia L6.4, Cord 810, Hispano-Suiza J12,
--               Marmon Sixteen, Continental Mark II, Aston Martin DB2/4, AM General Hummer,
--               Renault R5 Turbo, INEOS Grenadier, Ariel Nomad, Ram 1500, Amphicar 770,
--               Lancia Delta Integrale, Morgan 3 Wheeler / Roadster, Sunbeam Alpine,
--               Indian Chief / Four, Harley-Davidson FL / EL, Vincent Black Shadow,
--               Henderson Four, Citroen SM / Mehari / Traction Avant,
--               Factory Five Mk4 Roadster / GTM / Type 65, Superformance MkIII,
--               Backdraft RT4 Roadster, Willys Jeepster / Americar / CJ / Wagon,
--               Studebaker Hawk / Avanti / Commander / Champ, Austin Mini / Healey,
--               DeSoto Adventurer / Fireflite, Imperial Crown, Lucid Air, Maybach 57,
--               Iso Grifo, Kaiser Darrin, Bricklin SV-1, Rossion Q1, Nash Metropolitan,
--               and Lamborghini Islero.
-- Contract:  supabase/sql/test_family_keys_grand_prix_coachbuilt_motos.sql (db-contracts).
-- =============================================================================

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

-- 1. Ensure canonical_makes rows exist for newly keyed brands.
INSERT INTO public.canonical_makes (id, canonical_name, display_name, aliases, country_of_origin, is_active, brand_tier)
VALUES
  ('10000000-0000-4000-a000-000000000127'::uuid, 'Mercer',          'Mercer',          ARRAY['mercer']::text[],          'USA',         false, 'Volume'),
  ('10000000-0000-4000-a000-000000000128'::uuid, 'Simplex',         'Simplex',         ARRAY['simplex']::text[],         'USA',         false, 'Volume'),
  ('10000000-0000-4000-a000-000000000129'::uuid, 'Spyker',          'Spyker',          ARRAY['spyker']::text[],          'Netherlands', true,  'Volume'),
  ('10000000-0000-4000-a000-000000000130'::uuid, 'Auburn',          'Auburn',          ARRAY['auburn']::text[],          'USA',         false, 'Volume'),
  ('10000000-0000-4000-a000-000000000131'::uuid, 'Dual-Ghia',       'Dual-Ghia',       ARRAY['dual-ghia', 'dual ghia']::text[], 'USA',  false, 'Volume'),
  ('10000000-0000-4000-a000-000000000132'::uuid, 'Cord',            'Cord',            ARRAY['cord']::text[],            'USA',         false, 'Volume'),
  ('10000000-0000-4000-a000-000000000133'::uuid, 'Hispano-Suiza',   'Hispano-Suiza',   ARRAY['hispano-suiza', 'hispano suiza']::text[], 'France', false, 'Volume'),
  ('10000000-0000-4000-a000-000000000134'::uuid, 'Marmon',          'Marmon',          ARRAY['marmon']::text[],          'USA',         false, 'Volume'),
  ('10000000-0000-4000-a000-000000000135'::uuid, 'Continental',     'Continental',     ARRAY['continental']::text[],     'USA',         false, 'Volume'),
  ('10000000-0000-4000-a000-000000000136'::uuid, 'AM General',      'AM General',      ARRAY['am general']::text[],      'USA',         true,  'Volume'),
  ('10000000-0000-4000-a000-000000000137'::uuid, 'INEOS',           'INEOS',           ARRAY['ineos']::text[],           'UK',          true,  'Volume'),
  ('10000000-0000-4000-a000-000000000138'::uuid, 'Ariel',           'Ariel',           ARRAY['ariel']::text[],           'UK',          true,  'Volume'),
  ('10000000-0000-4000-a000-000000000139'::uuid, 'Ram',             'Ram',             ARRAY['ram']::text[],             'USA',         true,  'Volume'),
  ('10000000-0000-4000-a000-000000000140'::uuid, 'Amphicar',        'Amphicar',        ARRAY['amphicar']::text[],        'Germany',     false, 'Volume'),
  ('10000000-0000-4000-a000-000000000141'::uuid, 'Indian',          'Indian',          ARRAY['indian']::text[],          'USA',         true,  'Volume'),
  ('10000000-0000-4000-a000-000000000142'::uuid, 'Harley-Davidson', 'Harley-Davidson', ARRAY['harley-davidson', 'harley davidson']::text[], 'USA', true, 'Volume'),
  ('10000000-0000-4000-a000-000000000143'::uuid, 'Vincent',         'Vincent',         ARRAY['vincent']::text[],         'UK',          false, 'Volume'),
  ('10000000-0000-4000-a000-000000000144'::uuid, 'Henderson',       'Henderson',       ARRAY['henderson']::text[],       'USA',         false, 'Volume'),
  ('10000000-0000-4000-a000-000000000145'::uuid, 'Renault',         'Renault',         ARRAY['renault']::text[],         'France',      true,  'Volume'),
  ('10000000-0000-4000-a000-000000000146'::uuid, 'Factory Five',    'Factory Five',    ARRAY['factory five', 'factory five racing']::text[], 'USA', true, 'Volume'),
  ('10000000-0000-4000-a000-000000000147'::uuid, 'Superformance',   'Superformance',   ARRAY['superformance']::text[],   'USA',         true,  'Volume'),
  ('10000000-0000-4000-a000-000000000148'::uuid, 'Backdraft',       'Backdraft',       ARRAY['backdraft', 'backdraft racing']::text[], 'USA', true, 'Volume'),
  ('10000000-0000-4000-a000-000000000149'::uuid, 'Willys',          'Willys',          ARRAY['willys', 'willys-overland']::text[], 'USA', false, 'Volume'),
  ('10000000-0000-4000-a000-000000000150'::uuid, 'Studebaker',      'Studebaker',      ARRAY['studebaker']::text[],      'USA',         false, 'Volume'),
  ('10000000-0000-4000-a000-000000000151'::uuid, 'Austin',          'Austin',          ARRAY['austin']::text[],          'UK',          false, 'Volume'),
  ('10000000-0000-4000-a000-000000000152'::uuid, 'DeSoto',          'DeSoto',          ARRAY['desoto', 'de soto']::text[], 'USA',       false, 'Volume'),
  ('10000000-0000-4000-a000-000000000153'::uuid, 'Imperial',        'Imperial',        ARRAY['imperial', 'chrysler imperial']::text[], 'USA', false, 'Volume'),
  ('10000000-0000-4000-a000-000000000154'::uuid, 'Lucid',           'Lucid',           ARRAY['lucid', 'lucid motors']::text[], 'USA',   true,  'Volume'),
  ('10000000-0000-4000-a000-000000000155'::uuid, 'Maybach',         'Maybach',         ARRAY['maybach']::text[],         'Germany',     true,  'Volume'),
  ('10000000-0000-4000-a000-000000000156'::uuid, 'Iso',             'Iso',             ARRAY['iso', 'iso rivolta']::text[], 'Italy',    false, 'Volume'),
  ('10000000-0000-4000-a000-000000000157'::uuid, 'Kaiser',          'Kaiser',          ARRAY['kaiser', 'kaiser-darrin']::text[], 'USA', false, 'Volume'),
  ('10000000-0000-4000-a000-000000000158'::uuid, 'Bricklin',        'Bricklin',        ARRAY['bricklin']::text[],        'Canada',      false, 'Volume'),
  ('10000000-0000-4000-a000-000000000159'::uuid, 'Rossion',         'Rossion',         ARRAY['rossion']::text[],         'USA',         true,  'Volume'),
  ('10000000-0000-4000-a000-000000000160'::uuid, 'Nash',            'Nash',            ARRAY['nash']::text[],            'USA',         false, 'Volume')
ON CONFLICT (id) DO NOTHING;

-- 2. Widen restrictive year_start / year_end bounds on existing canonical_models rows.
WITH year_fixes(make, canonical_model, new_year_start, clear_year_end) AS (
  VALUES
    ('Rolls-Royce',   'Corniche',      1966, true),
    ('Rolls-Royce',   'Silver Wraith', 1946, true),
    ('Rolls-Royce',   'Wraith',        1938, true),
    ('Austin-Healey', '100',           1952, true),
    ('Ferrari',       'F430',          2004, true)
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
      WHEN coalesce(m.notes, '') LIKE '%[2026-10-18 grand-prix-coachbuilt]%' THEN m.notes
      ELSE concat_ws(' ', m.notes, '[2026-10-18 grand-prix-coachbuilt] widened year bounds for family coverage.')
    END
FROM year_fixes yf
WHERE lower(m.make) = lower(yf.make)
  AND lower(m.canonical_model) = lower(yf.canonical_model)
  AND (
    (yf.new_year_start IS NOT NULL AND (m.year_start IS NULL OR m.year_start > yf.new_year_start))
    OR (yf.clear_year_end AND m.year_end IS NOT NULL)
  );

-- 3. Add missing aliases to existing canonical_models families.
WITH target_additions(make, canonical_model, add_aliases) AS (
  VALUES
    ('Bugatti',       'Type 35',       ARRAY['type 35b', 'type 35c', 'type 35a', 'type 35t']),
    ('Bugatti',       'Type 43',       ARRAY['type 43a', 'type 43 grand sport']),
    ('Bugatti',       'Chiron',        ARRAY['chiron super sport', 'chiron supersport', 'chiron pur sport', 'chiron sport']),
    ('Ferrari',       '857 S',         ARRAY['857 sport', '857 sport spider', '857s']),
    ('Ferrari',       'F430',          ARRAY['scuderia spider 16m', '16m', '430 scuderia']),
    ('Austin-Healey', '100',           ARRAY['100s', '100m', '100-4', '100/4']),
    ('Delahaye',      '135',           ARRAY['135m', '135ms', '135 competition']),
    ('Citroen',       '2 CV',          ARRAY['2cv', '2cv6', '2cv6 charleston', '2cv6 special', '2cv charleston', '2cv fourgonnette', '2cv6 club', 'dyane 6']),
    ('Citroen',       'DS',            ARRAY['ds19', 'ds21', 'ds23', 'id19', 'ds21 pallas', 'ds23 pallas', 'ds19 berline', 'ds23 ie pallas', 'd special']),
    ('Rolls-Royce',   'Corniche',      ARRAY['corniche v', 'corniche ii']),
    ('GMC',           'Pickup',        ARRAY['100', '150', '250', 'custom']),
    ('GMC',           'Hummer EV Pickup', ARRAY['hummer ev', 'hummer ev edition 1'])
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
      WHEN coalesce(m.notes, '') LIKE '%[2026-10-18 grand-prix-coachbuilt]%' THEN m.notes
      ELSE concat_ws(' ', m.notes, '[2026-10-18 grand-prix-coachbuilt] added Grand Prix, coachbuilt, and classic aliases.')
    END
FROM rows_to_update r
WHERE m.id = r.id;

-- 4. Insert missing canonical families using sequential -f000-0000000001XX UUIDs.
INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases, notes)
SELECT nf.id, nf.make, nf.canonical_model, nf.year_start, nf.year_end, nf.aliases, nf.notes
FROM (
  VALUES
    ('00000000-0000-4000-f000-000000000101'::uuid, 'Mercedes-Benz', '540K', 1930, NULL::int,
      ARRAY['540k', '540 k', '500k', '500 k', '500/540k'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Mercedes-Benz 540K / 500K family.'),
    ('00000000-0000-4000-f000-000000000102'::uuid, 'Mercedes-Benz', '680S', 1926, NULL::int,
      ARRAY['680s', '680 s', 's-type', 'ss', 'ssk', 'sskl'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Mercedes-Benz 680S / SSK family.'),
    ('00000000-0000-4000-f000-000000000103'::uuid, 'Mercer', 'Raceabout', 1910, NULL::int,
      ARRAY['raceabout', 'type 35-j', 'series 5 raceabout', 'type 35'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Mercer Raceabout family.'),
    ('00000000-0000-4000-f000-000000000104'::uuid, 'Simplex', '50 HP', 1907, NULL::int,
      ARRAY['50 hp', 'toy-tonneau', 'speed car'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Simplex 50 HP family.'),
    ('00000000-0000-4000-f000-000000000105'::uuid, 'Spyker', 'C8', 2000, NULL::int,
      ARRAY['c8', 'c8 spyder', 'c8 laviolette', 'c8 aileron'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Spyker C8 family.'),
    ('00000000-0000-4000-f000-000000000106'::uuid, 'Audi', 'Quattro', 1980, NULL::int,
      ARRAY['quattro', 'sport quattro', 'ur-quattro'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Audi Quattro / Sport Quattro family.'),
    ('00000000-0000-4000-f000-000000000107'::uuid, 'Auburn', '851', 1930, NULL::int,
      ARRAY['851', '852', '852 sc', 'boattail speedster', '8-100a', '12-160a', '12-165'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Auburn 851 / 852 Speedster family.'),
    ('00000000-0000-4000-f000-000000000108'::uuid, 'Dual-Ghia', 'L6.4', 1955, NULL::int,
      ARRAY['convertible', 'l6.4', 'dual-ghia'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Dual-Ghia Convertible / L6.4 family.'),
    ('00000000-0000-4000-f000-000000000109'::uuid, 'Cord', '810', 1929, NULL::int,
      ARRAY['810', '812', '812 s/c', 'l-29'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Cord 810 / 812 / L-29 family.'),
    ('00000000-0000-4000-f000-000000000110'::uuid, 'Hispano-Suiza', 'J12', 1919, NULL::int,
      ARRAY['j12', 'h6b', 'h6c', 'k6'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Hispano-Suiza J12 / H6B / H6C family.'),
    ('00000000-0000-4000-f000-000000000111'::uuid, 'Marmon', 'Sixteen', 1916, NULL::int,
      ARRAY['sixteen', 'model 34', 'e-75'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Marmon Sixteen / Model 34 family.'),
    ('00000000-0000-4000-f000-000000000112'::uuid, 'Continental', 'Mark II', 1955, NULL::int,
      ARRAY['mark ii'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Continental Mark II family.'),
    ('00000000-0000-4000-f000-000000000113'::uuid, 'Aston Martin', 'DB2/4', 1950, NULL::int,
      ARRAY['db2/4', 'db2', 'db mark iii'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Aston Martin DB2 / DB2/4 family.'),
    ('00000000-0000-4000-f000-000000000114'::uuid, 'AM General', 'Hummer', 1984, NULL::int,
      ARRAY['hummer', 'h1', 'hmmwv', 'm998'],
      '[2026-10-18 grand-prix-coachbuilt] canonical AM General Hummer / H1 family.'),
    ('00000000-0000-4000-f000-000000000115'::uuid, 'Renault', 'R5 Turbo', 1978, NULL::int,
      ARRAY['r5 turbo', 'r5 turbo 2', '5 turbo'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Renault R5 Turbo / Turbo 2 family.'),
    ('00000000-0000-4000-f000-000000000116'::uuid, 'INEOS', 'Grenadier', 2022, NULL::int,
      ARRAY['grenadier', 'quartermaster'],
      '[2026-10-18 grand-prix-coachbuilt] canonical INEOS Grenadier family.'),
    ('00000000-0000-4000-f000-000000000117'::uuid, 'Ariel', 'Nomad', 2000, NULL::int,
      ARRAY['nomad', 'atom', 'atom 3'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Ariel Nomad / Atom family.'),
    ('00000000-0000-4000-f000-000000000118'::uuid, 'Ram', '1500', 2009, NULL::int,
      ARRAY['1500', '1500 trx', '2500', '3500', 'power wagon'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Ram 1500 / TRX / 2500 family.'),
    ('00000000-0000-4000-f000-000000000119'::uuid, 'Amphicar', '770', 1961, NULL::int,
      ARRAY['model 770', '770'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Amphicar 770 family.'),
    ('00000000-0000-4000-f000-000000000120'::uuid, 'Lancia', 'Delta Integrale', 1979, NULL::int,
      ARRAY['delta', 'delta integrale', 'delta integrale evo', 'delta integrale evo 2', 'delta s4'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Lancia Delta Integrale family.'),
    ('00000000-0000-4000-f000-000000000121'::uuid, 'Morgan', '3 Wheeler', 1920, NULL::int,
      ARRAY['3-wheeler', '3 wheeler', '3-wheeler 110th anniversary edition', 'super 3'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Morgan 3 Wheeler / Super 3 family.'),
    ('00000000-0000-4000-f000-000000000122'::uuid, 'Morgan', 'Roadster', 2000, NULL::int,
      ARRAY['roadster'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Morgan Roadster family.'),
    ('00000000-0000-4000-f000-000000000123'::uuid, 'Sunbeam', 'Alpine', 1953, NULL::int,
      ARRAY['alpine', 'alpine 5-speed', 'alpine series v', 'alpine series ii', 'alpine project', 'alpine series v roadster'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Sunbeam Alpine family.'),
    ('00000000-0000-4000-f000-000000000124'::uuid, 'Indian', 'Chief', 1920, NULL::int,
      ARRAY['chief'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Indian Chief motorcycle family.'),
    ('00000000-0000-4000-f000-000000000125'::uuid, 'Indian', 'Four', 1915, NULL::int,
      ARRAY['four', 'scout'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Indian Four / Scout motorcycle family.'),
    ('00000000-0000-4000-f000-000000000126'::uuid, 'Harley-Davidson', 'FL', 1936, NULL::int,
      ARRAY['fl', 'flh', 'flhr', 'knucklehead', 'panhead', 'shovelhead'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Harley-Davidson FL / Knucklehead / Panhead family.'),
    ('00000000-0000-4000-f000-000000000127'::uuid, 'Harley-Davidson', 'EL', 1936, NULL::int,
      ARRAY['el', 'wl', 'ul'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Harley-Davidson EL / WL motorcycle family.'),
    ('00000000-0000-4000-f000-000000000128'::uuid, 'Vincent', 'Black Shadow', 1946, NULL::int,
      ARRAY['black shadow', 'rapide', 'black lightning', 'comet'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Vincent Black Shadow / Rapide motorcycle family.'),
    ('00000000-0000-4000-f000-000000000129'::uuid, 'Henderson', 'Four', 1912, NULL::int,
      ARRAY['four', 'kj', 'deluxe'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Henderson Four motorcycle family.'),
    ('00000000-0000-4000-f000-000000000130'::uuid, 'Citroen', 'SM', 1970, NULL::int,
      ARRAY['sm', 'sm 5-speed', 'sm 3.0l 5-speed', 'sm 3.0l automatique', 'sm automatique', 'sm 5-speed project', 'sm project'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Citroen SM family.'),
    ('00000000-0000-4000-f000-000000000131'::uuid, 'Citroen', 'Mehari', 1968, NULL::int,
      ARRAY['mehari', 'méhari'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Citroen Mehari family.'),
    ('00000000-0000-4000-f000-000000000132'::uuid, 'Citroen', 'Traction Avant', 1934, NULL::int,
      ARRAY['traction avant', 'traction avant 11bl', 'traction avant 11b', 'traction avant 11bl project'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Citroen Traction Avant family.'),
    ('00000000-0000-4000-f000-000000000133'::uuid, 'Factory Five', 'Mk4 Roadster', 1995, NULL::int,
      ARRAY['mk4 roadster', 'five racing mk4 shelby cobra', 'shelby cobra replica', 'shelby cobra', 'five mk4 roadster', 'five cobra re-creation roadster', 'five shelby cobra re-creation roadster', 'five cobra re-creation', 'five cobra', 'five racing mk3 shelby cobra', 'five racing cobra', 'five racing cobra replica'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Factory Five Mk4 Roadster / Cobra family.'),
    ('00000000-0000-4000-f000-000000000134'::uuid, 'Factory Five', 'GTM', 2005, NULL::int,
      ARRAY['gtm', 'five gtm', 'racing gtm', 'shelby daytona replica', 'five racing daytona coupe'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Factory Five GTM / Type 65 Coupe family.'),
    ('00000000-0000-4000-f000-000000000135'::uuid, 'Superformance', 'MkIII', 1995, NULL::int,
      ARRAY['mkiii', 'shelby cobra replica', 'mkiii custom roadster', 'mk3 roadster', 'cobra', 'mark iii cobra', 'cobra re-creation roadster', 'mkiii roadster', 'mkiii cobra replica', 'cobra mkiii'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Superformance MkIII Cobra family.'),
    ('00000000-0000-4000-f000-000000000136'::uuid, 'Backdraft', 'RT4 Roadster', 2001, NULL::int,
      ARRAY['rt4 roadster', 'rt3 roadster', 'roadster', 'shelby cobra replica', 'shelby cobra', 'cobra re-creation roadster', 'racing cobra replica', 'cobra'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Backdraft RT3 / RT4 Cobra Roadster family.'),
    ('00000000-0000-4000-f000-000000000137'::uuid, 'Willys', 'Jeepster', 1948, NULL::int,
      ARRAY['jeepster', '-overland jeepster', 'jeepster convertible', 'jeepster commando', 'overland jeepster', 'jeepster commando v6'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Willys Jeepster / Commando family.'),
    ('00000000-0000-4000-f000-000000000138'::uuid, 'Willys', 'Americar', 1933, NULL::int,
      ARRAY['americar', 'americar custom coupe', 'custom coupe', 'coupe', 'custom', 'custom 2 door coupe', 'gasser', 'street rod'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Willys Americar / Coupe family.'),
    ('00000000-0000-4000-f000-000000000139'::uuid, 'Willys', 'CJ', 1941, NULL::int,
      ARRAY['cj-2a', 'cj2a', 'cj-3a', 'cj-3b', 'cj-5', 'jeep', 'mb', 'm38', 'm38a1', 'jeep cj-5', '-overland cj-2a', 'military jeep', '-overland cj-3a', 'jeep cj2a'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Willys MB / M38 / CJ Jeep family.'),
    ('00000000-0000-4000-f000-000000000140'::uuid, 'Willys', 'Jeep Wagon', 1946, NULL::int,
      ARRAY['station wagon', 'jeep utility wagon 4×4', 'jeep station wagon', 'overland custom wagon', 'jeep station wagon 4×4', 'station wagon 4×4', 'jeep wagon', 'pickup', 'jeep custom pickup', 'custom pickup', 'jeep pickup', 'jeep pickup 4×4', 'overland pickup', '-overland jeep pickup 4×4', 'jeep fc-170', 'jeep fc-150', 'fc150 pickup'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Willys Jeep Wagon & Pickup family.'),
    ('00000000-0000-4000-f000-000000000141'::uuid, 'Studebaker', 'Hawk', 1956, NULL::int,
      ARRAY['golden hawk', 'gran turismo hawk', 'silver hawk', 'hawk', 'gran turismo hawk 4-speed', 'gt hawk', 'gran turismo', 'golden hawk 3-speed'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Studebaker Golden / Silver / GT Hawk family.'),
    ('00000000-0000-4000-f000-000000000142'::uuid, 'Studebaker', 'Avanti', 1962, NULL::int,
      ARRAY['avanti', 'avanti r2', 'avanti r2 4-speed', 'avanti r1'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Studebaker Avanti R1 / R2 family.'),
    ('00000000-0000-4000-f000-000000000143'::uuid, 'Studebaker', 'Commander', 1927, NULL::int,
      ARRAY['commander', 'champion', 'president', 'commander coupe', 'commander starlight coupe', 'commander regal starliner', 'president speedster', 'dictator', 'commander custom coupe', 'lark', 'lark viii', 'lark viii regal convertible', 'daytona', 'wagonaire', 'lark daytona convertible', 'custom', 'pickup', 'custom pickup', 'champ pickup', 'm5 pickup', '2r10 pickup', 'champ', 'champ pickup 3-speed'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Studebaker Commander / Champion / President / Lark / Pickup family.'),
    ('00000000-0000-4000-f000-000000000144'::uuid, 'Austin', 'Mini', 1959, NULL::int,
      ARRAY['mini', 'mini moke', 'mini cooper s', 'mini cooper', 'mini cooper s mk i', 'mini mk i', 'mini countryman', 'mini cooper s mark i', 'mini cooper mk i', 'mini moke 1,275cc', 'mini cooper s mk ii', 'mini cooper s project', 'mini 1000', 'mini mk v', 'mini van', '-healey 3000 bj8 mk iii', '-healey bugeye sprite', '-healey 3000 bt7 mk i', '-healey 3000 bj8 mk iii project', '-healey sprite mk iv'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Austin Mini / Cooper / Moke / Healey family.'),
    ('00000000-0000-4000-f000-000000000145'::uuid, 'DeSoto', 'Adventurer', 1950, NULL::int,
      ARRAY['adventurer', 'adventurer convertible', 'fireflite', 'firedome', 'firedome sportsman 2-door', 'custom'],
      '[2026-10-18 grand-prix-coachbuilt] canonical DeSoto Adventurer / Fireflite / Firedome family.'),
    ('00000000-0000-4000-f000-000000000146'::uuid, 'Imperial', 'Crown', 1955, NULL::int,
      ARRAY['crown', 'crown convertible', 'lebaron', 'newport 2-door hardtop', 'crown hardtop sedan'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Imperial Crown / LeBaron family.'),
    ('00000000-0000-4000-f000-000000000147'::uuid, 'Lucid', 'Air', 2021, NULL::int,
      ARRAY['air', 'air grand touring', 'air dream edition', 'air sapphire', 'air touring', 'air pure'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Lucid Air family.'),
    ('00000000-0000-4000-f000-000000000148'::uuid, 'Maybach', '57', 2002, NULL::int,
      ARRAY['57', '57s', '62', '62s', 'landaulet'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Maybach 57 / 62 family.'),
    ('00000000-0000-4000-f000-000000000149'::uuid, 'Iso', 'Grifo', 1963, NULL::int,
      ARRAY['grifo', 'grifo 7 litri', 'rivolta', 'lele'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Iso Grifo / Rivolta family.'),
    ('00000000-0000-4000-f000-000000000150'::uuid, 'Kaiser', 'Darrin', 1947, NULL::int,
      ARRAY['darrin', 'darrin 161', 'manhattan', 'special', 'virginian'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Kaiser Darrin / Manhattan family.'),
    ('00000000-0000-4000-f000-000000000151'::uuid, 'Bricklin', 'SV-1', 1974, NULL::int,
      ARRAY['sv-1', 'sv1', 'sv-1 4-speed', 'sv 1'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Bricklin SV-1 family.'),
    ('00000000-0000-4000-f000-000000000152'::uuid, 'Rossion', 'Q1', 2008, NULL::int,
      ARRAY['q1'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Rossion Q1 family.'),
    ('00000000-0000-4000-f000-000000000153'::uuid, 'Nash', 'Metropolitan', 1946, NULL::int,
      ARRAY['metropolitan', 'ambassador', 'statesman', 'healey'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Nash Metropolitan / Ambassador family.'),
    ('00000000-0000-4000-f000-000000000154'::uuid, 'Lamborghini', 'Islero', 1968, NULL::int,
      ARRAY['islero', 'islero s', 'jarama', 'espada', 'urraco'],
      '[2026-10-18 grand-prix-coachbuilt] canonical Lamborghini Islero / Espada / Jarama family.')
) AS nf(id, make, canonical_model, year_start, year_end, aliases, notes)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.canonical_models cm
  WHERE lower(cm.make) = lower(nf.make)
    AND lower(cm.canonical_model) = lower(nf.canonical_model)
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
