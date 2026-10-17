-- =============================================================================
-- Migration: 20261018065000_family_keys_grand_prix_coachbuilt_motos.sql
-- Purpose:   Close remaining high-value family_key = 'other' gaps across
--            Grand Prix & coachbuilt icons (Mercedes-Benz 540K / 500K / 680S,
--            Bugatti Type 35B/35C / Type 43 / Chiron Super Sport, Ferrari 857 S,
--            Ferrari F430 Scuderia Spider 16M, Delahaye 135M/135MS,
--            Hispano-Suiza J12/H6B, Mercer Raceabout, Simplex 50 HP,
--            Auburn 851/852, Cord 810/812, Marmon Sixteen, Dual-Ghia L6.4,
--            Continental Mark II, Aston Martin DB2/4, Austin-Healey 100S),
--            rally & specialist icons (Spyker C8, Audi Quattro, Renault R5 Turbo,
--            Lancia Delta Integrale, AM General Hummer, INEOS Grenadier,
--            Ariel Nomad, Ram 1500, Amphicar 770, Morgan 3 Wheeler / Roadster,
--            Sunbeam Alpine), and vintage motorcycles (Indian Chief / Four,
--            Harley-Davidson FL / EL, Vincent Black Shadow, Henderson Four).
-- =============================================================================

BEGIN;

-- 1. Ensure canonical_makes rows exist for newly keyed brands
INSERT INTO public.canonical_makes (id, canonical_name, display_name, aliases, country_of_origin, is_active, brand_tier)
VALUES
  ('10000000-0000-4000-a000-000000000127'::uuid, 'Mercer', 'Mercer', ARRAY['mercer']::text[], 'USA', false, 'Volume'),
  ('10000000-0000-4000-a000-000000000128'::uuid, 'Simplex', 'Simplex', ARRAY['simplex']::text[], 'USA', false, 'Volume'),
  ('10000000-0000-4000-a000-000000000129'::uuid, 'Spyker', 'Spyker', ARRAY['spyker']::text[], 'Netherlands', true, 'Volume'),
  ('10000000-0000-4000-a000-000000000130'::uuid, 'Auburn', 'Auburn', ARRAY['auburn']::text[], 'USA', false, 'Volume'),
  ('10000000-0000-4000-a000-000000000131'::uuid, 'Dual-Ghia', 'Dual-Ghia', ARRAY['dual-ghia', 'dual ghia']::text[], 'USA', false, 'Volume'),
  ('10000000-0000-4000-a000-000000000132'::uuid, 'Cord', 'Cord', ARRAY['cord']::text[], 'USA', false, 'Volume'),
  ('10000000-0000-4000-a000-000000000133'::uuid, 'Hispano-Suiza', 'Hispano-Suiza', ARRAY['hispano-suiza', 'hispano suiza']::text[], 'France', false, 'Volume'),
  ('10000000-0000-4000-a000-000000000134'::uuid, 'Marmon', 'Marmon', ARRAY['marmon']::text[], 'USA', false, 'Volume'),
  ('10000000-0000-4000-a000-000000000135'::uuid, 'Continental', 'Continental', ARRAY['continental']::text[], 'USA', false, 'Volume'),
  ('10000000-0000-4000-a000-000000000136'::uuid, 'AM General', 'AM General', ARRAY['am general']::text[], 'USA', true, 'Volume'),
  ('10000000-0000-4000-a000-000000000137'::uuid, 'INEOS', 'INEOS', ARRAY['ineos']::text[], 'UK', true, 'Volume'),
  ('10000000-0000-4000-a000-000000000138'::uuid, 'Ariel', 'Ariel', ARRAY['ariel']::text[], 'UK', true, 'Volume'),
  ('10000000-0000-4000-a000-000000000139'::uuid, 'Ram', 'Ram', ARRAY['ram']::text[], 'USA', true, 'Volume'),
  ('10000000-0000-4000-a000-000000000140'::uuid, 'Amphicar', 'Amphicar', ARRAY['amphicar']::text[], 'Germany', false, 'Volume'),
  ('10000000-0000-4000-a000-000000000141'::uuid, 'Indian', 'Indian', ARRAY['indian']::text[], 'USA', true, 'Volume'),
  ('10000000-0000-4000-a000-000000000142'::uuid, 'Harley-Davidson', 'Harley-Davidson', ARRAY['harley-davidson', 'harley davidson']::text[], 'USA', true, 'Volume'),
  ('10000000-0000-4000-a000-000000000143'::uuid, 'Vincent', 'Vincent', ARRAY['vincent']::text[], 'UK', false, 'Volume'),
  ('10000000-0000-4000-a000-000000000144'::uuid, 'Henderson', 'Henderson', ARRAY['henderson']::text[], 'USA', false, 'Volume'),
  ('10000000-0000-4000-a000-000000000145'::uuid, 'Renault', 'Renault', ARRAY['renault']::text[], 'France', true, 'Volume')
ON CONFLICT (canonical_name) DO NOTHING;

-- 2. Add missing variant aliases to existing canonical_models rows
UPDATE public.canonical_models cm
SET aliases = (
  SELECT array_agg(DISTINCT a ORDER BY a)
  FROM unnest(coalesce(cm.aliases, '{}'::text[]) || ARRAY['type 35b', 'type 35c', 'type 35a', 'type 35t']) AS a
)
FROM public.canonical_makes mk
WHERE cm.make_id = mk.id
  AND mk.canonical_name = 'Bugatti'
  AND cm.canonical_name = 'Type 35 (1924)';

UPDATE public.canonical_models cm
SET aliases = (
  SELECT array_agg(DISTINCT a ORDER BY a)
  FROM unnest(coalesce(cm.aliases, '{}'::text[]) || ARRAY['type 43a']) AS a
)
FROM public.canonical_makes mk
WHERE cm.make_id = mk.id
  AND mk.canonical_name = 'Bugatti'
  AND cm.canonical_name = 'Type 43 (1927)';

UPDATE public.canonical_models cm
SET aliases = (
  SELECT array_agg(DISTINCT a ORDER BY a)
  FROM unnest(coalesce(cm.aliases, '{}'::text[]) || ARRAY['chiron super sport', 'chiron supersport', 'chiron pur sport', 'chiron sport']) AS a
)
FROM public.canonical_makes mk
WHERE cm.make_id = mk.id
  AND mk.canonical_name = 'Bugatti'
  AND cm.canonical_name = 'Chiron (2016)';

UPDATE public.canonical_models cm
SET aliases = (
  SELECT array_agg(DISTINCT a ORDER BY a)
  FROM unnest(coalesce(cm.aliases, '{}'::text[]) || ARRAY['857 sport', '857 sport spider', '857s']) AS a
)
FROM public.canonical_makes mk
WHERE cm.make_id = mk.id
  AND mk.canonical_name = 'Ferrari'
  AND cm.canonical_name = '857 S (1955)';

UPDATE public.canonical_models cm
SET aliases = (
  SELECT array_agg(DISTINCT a ORDER BY a)
  FROM unnest(coalesce(cm.aliases, '{}'::text[]) || ARRAY['scuderia spider 16m', '16m']) AS a
)
FROM public.canonical_makes mk
WHERE cm.make_id = mk.id
  AND mk.canonical_name = 'Ferrari'
  AND cm.canonical_name = 'F430 (2004)';

UPDATE public.canonical_models cm
SET aliases = (
  SELECT array_agg(DISTINCT a ORDER BY a)
  FROM unnest(coalesce(cm.aliases, '{}'::text[]) || ARRAY['100s', '100m', '100-4', '100/4']) AS a
)
FROM public.canonical_makes mk
WHERE cm.make_id = mk.id
  AND mk.canonical_name = 'Austin-Healey'
  AND cm.canonical_name = '100 (1953)';

UPDATE public.canonical_models cm
SET aliases = (
  SELECT array_agg(DISTINCT a ORDER BY a)
  FROM unnest(coalesce(cm.aliases, '{}'::text[]) || ARRAY['135m', '135ms']) AS a
)
FROM public.canonical_makes mk
WHERE cm.make_id = mk.id
  AND mk.canonical_name = 'Delahaye'
  AND cm.canonical_name = '135 (1935)';

-- 3. Seed canonical_models rows for newly keyed Grand Prix, coachbuilt, specialist & motorcycle families
WITH seed(id, make_name, canonical_name, display_name, generation_code, year_start, year_end, body_styles, drivetrain, engine_type, transmission_types, market_segment, is_collector_grade, notes, aliases) AS (
  VALUES
    -- Mercedes-Benz 540K / 500K & 680S / SSK
    ('00000000-0000-4000-f000-000000000101'::uuid, 'Mercedes-Benz', '540K (1934)', 'Mercedes-Benz 540K', 'W29', 1930, 1944, ARRAY['Roadster', 'Cabriolet', 'Coupe'], 'RWD', 'Supercharged Inline-8', ARRAY['4-Speed Manual'], 'Pre-War Luxury', true, 'family_name:540K', ARRAY['540k', '540 k', '500k', '500 k', '500/540k']),
    ('00000000-0000-4000-f000-000000000102'::uuid, 'Mercedes-Benz', '680S (1927)', 'Mercedes-Benz 680S', 'W06', 1926, 1934, ARRAY['Tourer', 'Roadster'], 'RWD', 'Supercharged Inline-6', ARRAY['4-Speed Manual'], 'Pre-War Grand Prix', true, 'family_name:680S', ARRAY['680s', '680 s', 's-type', 'ss', 'ssk', 'sskl']),
    -- Mercer & Simplex
    ('00000000-0000-4000-f000-000000000103'::uuid, 'Mercer', 'Raceabout (1910)', 'Mercer Raceabout', NULL, 1910, 1925, ARRAY['Roadster'], 'RWD', 'Inline-4', ARRAY['Manual'], 'Brass Era Sports', true, 'family_name:Raceabout', ARRAY['raceabout', 'type 35-j', 'series 5 raceabout', 'type 35']),
    ('00000000-0000-4000-f000-000000000104'::uuid, 'Simplex', '50 HP (1907)', 'Simplex 50 HP', NULL, 1907, 1918, ARRAY['Tourer', 'Roadster'], 'RWD', 'Inline-4', ARRAY['Manual'], 'Brass Era Sports', true, 'family_name:50 HP', ARRAY['50 hp', 'toy-tonneau', 'speed car']),
    -- Spyker & Audi Quattro
    ('00000000-0000-4000-f000-000000000105'::uuid, 'Spyker', 'C8 (2000)', 'Spyker C8', NULL, 2000, 2025, ARRAY['Roadster', 'Coupe'], 'RWD', 'V8', ARRAY['6-Speed Manual', 'Automatic'], 'Supercar', true, 'family_name:C8', ARRAY['c8', 'c8 spyder', 'c8 laviolette', 'c8 aileron']),
    ('00000000-0000-4000-f000-000000000106'::uuid, 'Audi', 'Quattro (1980)', 'Audi Quattro', 'B2', 1980, 1991, ARRAY['Coupe'], 'AWD', 'Turbo Inline-5', ARRAY['5-Speed Manual'], 'Rally Homologation', true, 'family_name:Quattro', ARRAY['quattro', 'sport quattro', 'ur-quattro']),
    -- Auburn, Dual-Ghia, Cord, Hispano-Suiza, Marmon, Continental, Aston Martin DB2/4
    ('00000000-0000-4000-f000-000000000107'::uuid, 'Auburn', '851 (1934)', 'Auburn 851/852', NULL, 1930, 1937, ARRAY['Speedster', 'Cabriolet', 'Phaeton'], 'RWD', 'Supercharged Inline-8', ARRAY['3-Speed Manual'], 'Pre-War Classic', true, 'family_name:851', ARRAY['851', '852', '852 sc', 'boattail speedster', '8-100a', '12-160a', '12-165']),
    ('00000000-0000-4000-f000-000000000108'::uuid, 'Dual-Ghia', 'L6.4 (1956)', 'Dual-Ghia L6.4', NULL, 1955, 1963, ARRAY['Convertible', 'Coupe'], 'RWD', 'V8', ARRAY['Automatic'], 'Coachbuilt GT', true, 'family_name:L6.4', ARRAY['convertible', 'l6.4', 'dual-ghia']),
    ('00000000-0000-4000-f000-000000000109'::uuid, 'Cord', '810 (1936)', 'Cord 810/812', NULL, 1929, 1938, ARRAY['Convertible', 'Sedan'], 'FWD', 'V8', ARRAY['4-Speed Pre-Selector'], 'Pre-War Classic', true, 'family_name:810', ARRAY['810', '812', '812 s/c', 'l-29']),
    ('00000000-0000-4000-f000-000000000110'::uuid, 'Hispano-Suiza', 'J12 (1919)', 'Hispano-Suiza J12', NULL, 1919, 1938, ARRAY['Cabriolet', 'Sedan', 'Tourer'], 'RWD', 'V12 / Inline-6', ARRAY['3-Speed Manual'], 'Pre-War Luxury', true, 'family_name:J12', ARRAY['j12', 'h6b', 'h6c', 'k6']),
    ('00000000-0000-4000-f000-000000000111'::uuid, 'Marmon', 'Sixteen (1916)', 'Marmon Sixteen', NULL, 1916, 1934, ARRAY['Convertible', 'Sedan', 'Speedster'], 'RWD', 'V16', ARRAY['3-Speed Manual'], 'Pre-War Luxury', true, 'family_name:Sixteen', ARRAY['sixteen', 'model 34', 'e-75']),
    ('00000000-0000-4000-f000-000000000112'::uuid, 'Continental', 'Mark II (1956)', 'Continental Mark II', NULL, 1955, 1958, ARRAY['Coupe'], 'RWD', 'V8', ARRAY['Automatic'], 'Personal Luxury', true, 'family_name:Mark II', ARRAY['mark ii']),
    ('00000000-0000-4000-f000-000000000113'::uuid, 'Aston Martin', 'DB2/4 (1950)', 'Aston Martin DB2/4', NULL, 1950, 1959, ARRAY['Coupe', 'Drophead Coupe'], 'RWD', 'Inline-6', ARRAY['4-Speed Manual'], 'Classic GT', true, 'family_name:DB2/4', ARRAY['db2/4', 'db2', 'db mark iii']),
    -- Rally & Specialist Icons
    ('00000000-0000-4000-f000-000000000114'::uuid, 'AM General', 'Hummer (1984)', 'AM General Hummer', NULL, 1984, 2006, ARRAY['SUV', 'Pickup'], '4WD', 'V8 Diesel', ARRAY['Automatic'], 'Off-Road', true, 'family_name:Hummer', ARRAY['hummer', 'h1', 'hmmwv', 'm998']),
    ('00000000-0000-4000-f000-000000000115'::uuid, 'Renault', 'R5 Turbo (1980)', 'Renault R5 Turbo', NULL, 1978, 1986, ARRAY['Hatchback'], 'RWD', 'Turbo Inline-4', ARRAY['5-Speed Manual'], 'Rally Homologation', true, 'family_name:R5 Turbo', ARRAY['r5 turbo', 'r5 turbo 2', '5 turbo']),
    ('00000000-0000-4000-f000-000000000116'::uuid, 'INEOS', 'Grenadier (2023)', 'INEOS Grenadier', NULL, 2022, 2026, ARRAY['SUV', 'Pickup'], '4WD', 'Turbo Inline-6', ARRAY['8-Speed Automatic'], 'Off-Road', true, 'family_name:Grenadier', ARRAY['grenadier', 'quartermaster']),
    ('00000000-0000-4000-f000-000000000117'::uuid, 'Ariel', 'Nomad (2015)', 'Ariel Nomad', NULL, 2000, 2026, ARRAY['Open-Wheel'], 'RWD', 'Inline-4', ARRAY['6-Speed Manual'], 'Track / Off-Road', true, 'family_name:Nomad', ARRAY['nomad', 'atom', 'atom 3']),
    ('00000000-0000-4000-f000-000000000118'::uuid, 'Ram', '1500 (2010)', 'Ram 1500', NULL, 2009, 2026, ARRAY['Pickup'], '4WD', 'V8', ARRAY['Automatic'], 'Pickup', true, 'family_name:1500', ARRAY['1500', '1500 trx', '2500', '3500', 'power wagon']),
    ('00000000-0000-4000-f000-000000000119'::uuid, 'Amphicar', '770 (1961)', 'Amphicar 770', NULL, 1961, 1968, ARRAY['Convertible'], 'RWD', 'Inline-4', ARRAY['4-Speed Manual'], 'Microcar / Amphibious', true, 'family_name:770', ARRAY['model 770', '770']),
    ('00000000-0000-4000-f000-000000000120'::uuid, 'Lancia', 'Delta Integrale (1979)', 'Lancia Delta Integrale', NULL, 1979, 1995, ARRAY['Hatchback'], 'AWD', 'Turbo Inline-4', ARRAY['5-Speed Manual'], 'Rally Homologation', true, 'family_name:Delta Integrale', ARRAY['delta', 'delta integrale', 'delta integrale evo', 'delta integrale evo 2', 'delta s4']),
    -- Morgan & Sunbeam remaining families
    ('00000000-0000-4000-f000-000000000121'::uuid, 'Morgan', '3 Wheeler (1930)', 'Morgan 3 Wheeler', NULL, 1920, 2026, ARRAY['Roadster'], 'RWD', 'V-Twin / Inline-3', ARRAY['Manual'], 'British Sports', true, 'family_name:3 Wheeler', ARRAY['3-wheeler', '3 wheeler', '3-wheeler 110th anniversary edition', 'super 3']),
    ('00000000-0000-4000-f000-000000000122'::uuid, 'Morgan', 'Roadster (2004)', 'Morgan Roadster', NULL, 2000, 2022, ARRAY['Roadster'], 'RWD', 'V6', ARRAY['Manual'], 'British Sports', true, 'family_name:Roadster', ARRAY['roadster']),
    ('00000000-0000-4000-f000-000000000123'::uuid, 'Sunbeam', 'Alpine (1953)', 'Sunbeam Alpine', NULL, 1953, 1968, ARRAY['Roadster'], 'RWD', 'Inline-4', ARRAY['4-Speed Manual'], 'British Sports', true, 'family_name:Alpine', ARRAY['alpine', 'alpine 5-speed', 'alpine series v', 'alpine series ii', 'alpine project', 'alpine series v roadster']),
    -- Vintage Motorcycles
    ('00000000-0000-4000-f000-000000000124'::uuid, 'Indian', 'Chief (1922)', 'Indian Chief', NULL, 1920, 2025, ARRAY['Motorcycle'], 'RWD', 'V-Twin', ARRAY['Manual'], 'Classic Motorcycle', true, 'family_name:Chief', ARRAY['chief']),
    ('00000000-0000-4000-f000-000000000125'::uuid, 'Indian', 'Four (1928)', 'Indian Four', NULL, 1915, 1945, ARRAY['Motorcycle'], 'RWD', 'Inline-4', ARRAY['Manual'], 'Classic Motorcycle', true, 'family_name:Four', ARRAY['four', 'scout']),
    ('00000000-0000-4000-f000-000000000126'::uuid, 'Harley-Davidson', 'FL (1941)', 'Harley-Davidson FL', NULL, 1936, 2025, ARRAY['Motorcycle'], 'RWD', 'V-Twin', ARRAY['Manual'], 'Classic Motorcycle', true, 'family_name:FL', ARRAY['fl', 'flh', 'flhr', 'knucklehead', 'panhead', 'shovelhead']),
    ('00000000-0000-4000-f000-000000000127'::uuid, 'Harley-Davidson', 'EL (1936)', 'Harley-Davidson EL', NULL, 1936, 1952, ARRAY['Motorcycle'], 'RWD', 'V-Twin', ARRAY['Manual'], 'Classic Motorcycle', true, 'family_name:EL', ARRAY['el', 'wl', 'ul']),
    ('00000000-0000-4000-f000-000000000128'::uuid, 'Vincent', 'Black Shadow (1948)', 'Vincent Black Shadow', NULL, 1946, 1955, ARRAY['Motorcycle'], 'RWD', 'V-Twin', ARRAY['4-Speed Manual'], 'Classic Motorcycle', true, 'family_name:Black Shadow', ARRAY['black shadow', 'rapide', 'black lightning', 'comet']),
    ('00000000-0000-4000-f000-000000000129'::uuid, 'Henderson', 'Four (1912)', 'Henderson Four', NULL, 1912, 1931, ARRAY['Motorcycle'], 'RWD', 'Inline-4', ARRAY['Manual'], 'Classic Motorcycle', true, 'family_name:Four', ARRAY['four', 'kj', 'deluxe'])
)
INSERT INTO public.canonical_models (
  id, make_id, canonical_name, display_name, generation_code,
  year_start, year_end, body_styles, drivetrain, engine_type,
  transmission_types, market_segment, is_collector_grade, notes, aliases
)
SELECT
  s.id,
  mk.id,
  s.canonical_name,
  s.display_name,
  s.generation_code,
  s.year_start,
  s.year_end,
  s.body_styles,
  s.drivetrain,
  s.engine_type,
  s.transmission_types,
  s.market_segment,
  s.is_collector_grade,
  s.notes,
  s.aliases
FROM seed s
JOIN public.canonical_makes mk
  ON lower(mk.canonical_name) = lower(s.make_name)
ON CONFLICT (make_id, canonical_name, COALESCE(generation_code, '')) DO UPDATE
SET
  year_start = LEAST(canonical_models.year_start, EXCLUDED.year_start),
  year_end = GREATEST(canonical_models.year_end, EXCLUDED.year_end),
  notes = COALESCE(canonical_models.notes, EXCLUDED.notes),
  aliases = (
    SELECT array_agg(DISTINCT a ORDER BY a)
    FROM unnest(coalesce(canonical_models.aliases, '{}'::text[]) || coalesce(EXCLUDED.aliases, '{}'::text[])) AS a
  );

COMMIT;
