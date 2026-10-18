-- Slice 14: Specialist British sports cars, pre-war brass/coachbuilt icons,
-- Datsun-under-Nissan rollups, classic American customs/woodies, and JDM/moto families.
--
-- Remember:
-- 1. mv_model_family_names only extracts 1-to-4 alphanumeric word n-grams, so every
--    alias must be 1 to 4 alphanumeric words.
-- 2. Run INSERT ... WHERE NOT EXISTS first, then year_fixes and target_additions
--    after so pre-existing stub rows in canonical_models also get widened year bounds
--    and merged aliases.

BEGIN;

-- 1. Insert brand-new canonical_models families where no row exists yet for (make, canonical_model)
WITH new_families(id, make, canonical_model, year_start, year_end, aliases) AS (
  VALUES
    ('00000000-0000-4000-f000-000000000196'::uuid, 'Locomobile', 'Model 48', 1905, NULL::integer,
      ARRAY['model 48', 'type i', 'sportif', '48']),
    ('00000000-0000-4000-f000-000000000197'::uuid, 'Crane-Simplex', 'Model 5', 1912, NULL::integer,
      ARRAY['model 5', '5']),
    ('00000000-0000-4000-f000-000000000198'::uuid, 'Lister-Chevrolet', 'Sports Racer', 1954, NULL::integer,
      ARRAY['sports racer', 'knobbly', 'costin']),
    ('00000000-0000-4000-f000-000000000199'::uuid, 'Delage', 'D8', 1920, NULL::integer,
      ARRAY['d8', 'd8 120', 'd8-120', 'd6', 'gl', 'gl skiff torpedo', 'skiff torpedo']),
    ('00000000-0000-4000-f000-000000000200'::uuid, 'Stutz', 'Bearcat', 1911, NULL::integer,
      ARRAY['bearcat', 'series k', 'series k bearcat', 'model bb', 'vertical eight', 'dv 32', 'dv-32', 'sv 16', 'sv-16', 'blackhawk', 'eight']),
    ('00000000-0000-4000-f000-000000000201'::uuid, 'Jensen', 'Interceptor', 1950, NULL::integer,
      ARRAY['interceptor', 'interceptor iii', 'interceptor mk iii', 'ff', 'c v8', 'c-v8', 'healey', 'jensen healey', 'jensen-healey', '541']),
    ('00000000-0000-4000-f000-000000000202'::uuid, 'Panoz', 'Esperante', 1990, NULL::integer,
      ARRAY['esperante', 'aiv roadster', 'aiv', 'roadster']),
    ('00000000-0000-4000-f000-000000000203'::uuid, 'Caterham', 'Seven', 1973, NULL::integer,
      ARRAY['seven', 'super seven', 'super 7', 'seven sv', '7', 'seven 420r', 'seven 360', 'seven 620r', 'roadsport', 'csr']),
    ('00000000-0000-4000-f000-000000000204'::uuid, 'TVR', 'Griffith', 1958, NULL::integer,
      ARRAY['griffith', 'griffith 200', 'griffith 400', '2500m', 'cerbera', 'chimaera', 'tuscany', 'tuscan', 'vixen', 'grantura', 'taimar', '280i', 'sagaris', '3000m']),
    ('00000000-0000-4000-f000-000000000205'::uuid, 'Saturn', 'Sky', 1991, NULL::integer,
      ARRAY['sky', 'sky red line', 'ion', 'ion red line', 'sc2', 'sl2', 'vue']),
    ('00000000-0000-4000-f000-000000000206'::uuid, 'Fisker', 'Karma', 2008, NULL::integer,
      ARRAY['karma', 'karma ecosport', 'ocean', 'ocean one']),
    ('00000000-0000-4000-f000-000000000207'::uuid, 'Edsel', 'Corsair', 1957, NULL::integer,
      ARRAY['corsair', 'citation', 'pacer', 'ranger', 'villager', 'bermuda', 'roundup']),
    ('00000000-0000-4000-f000-000000000208'::uuid, 'Morris', 'Minor', 1928, NULL::integer,
      ARRAY['minor', 'minor 1000', 'minor traveller', 'traveller', 'mini minor', 'mini-minor', 'mini', 'mini cooper', 'mini moke', 'oxford']),
    ('00000000-0000-4000-f000-000000000209'::uuid, 'Chevrolet', 'Custom', 1915, NULL::integer,
      ARRAY['custom', 'custom coupe', 'custom convertible', 'coupe', 'sedan', 'deluxe', '4 speed', '4-speed', 'street rod', 'hot rod', 'confederate', 'eagle', 'standard']),
    ('00000000-0000-4000-f000-000000000210'::uuid, 'Mercury', 'Eight', 1938, NULL::integer,
      ARRAY['eight', 'eight coupe', 'eight convertible', 'coupe', 'convertible', 'woody', 'woody wagon', 'woodie wagon', 'lead sled', '99a', 'sedan']),
    ('00000000-0000-4000-f000-000000000211'::uuid, 'Mercury', 'Grand Marquis', 1955, NULL::integer,
      ARRAY['grand marquis', 'colony park', 'turnpike cruiser', 'marquis', 'breezeway']),
    ('00000000-0000-4000-f000-000000000212'::uuid, 'Plymouth', 'Deluxe', 1928, NULL::integer,
      ARRAY['special deluxe', 'deluxe', 'custom', 'custom coupe', '2 door coupe', 'convertible', 'valiant', 'cranbrook', 'cambridge', 'concord', 'plaza', 'suburban', 'vip']),
    ('00000000-0000-4000-f000-000000000213'::uuid, 'Datsun', '260Z', 1973, NULL::integer,
      ARRAY['260z', '260 z', '300zx', '200sx']),
    ('00000000-0000-4000-f000-000000000214'::uuid, 'Datsun', 'Roadster', 1959, NULL::integer,
      ARRAY['roadster', '1600 roadster', '2000 roadster', '1500 roadster', '1600', '2000', '1500', 'fairlady', 'fair lady']),
    ('00000000-0000-4000-f000-000000000215'::uuid, 'Datsun', 'Pickup', 1955, NULL::integer,
      ARRAY['pickup', 'truck', '620', '620 pickup', '520', '520 pickup', '720', '320', '320 pickup', '1200', '710', 'l210']),
    ('00000000-0000-4000-f000-000000000216'::uuid, 'Suzuki', 'Carry', 1961, NULL::integer,
      ARRAY['carry', 'carry pickup', 'carry dump truck', 'carry truck', 'every']),
    ('00000000-0000-4000-f000-000000000217'::uuid, 'Suzuki', 'Jimny', 1970, NULL::integer,
      ARRAY['jimny', 'jimny turbo', 'lj80', 'sidekick', 'x-90', 'x90', 'cappuccino']),
    ('00000000-0000-4000-f000-000000000218'::uuid, 'Suzuki', 'GSX-R', 1965, NULL::integer,
      ARRAY['gsx1300r hayabusa', 'hayabusa', 'gsx-r750', 'gsxr 750', 'gsx-r1000', 'gsx r1100', 'gsx-r 1100', 'gsx-r1100', 'rg500 gamma', 'rg500', 'gt750', 'gt550', 'gt380', 'gs1100e', 'gs1000s', 'gs1000', 're5', 't500', 'rm125', 'rm250', 'tm400', 'jr50']),
    ('00000000-0000-4000-f000-000000000219'::uuid, 'Yamaha', 'RD350', 1960, NULL::integer,
      ARRAY['rd350', 'rd400', 'rd 400', 'rd400c', 'rd250', 'rd60', 'rz350', 'rz500', 'tz750', 'tz250', 'yzf-r1', 'r1 le', 'yzf-r7', 'xs650', 'xs1100', 'sr500', 'v-max', 'star vmax', 'ysr50', 'r5']),
    ('00000000-0000-4000-f000-000000000220'::uuid, 'Yamaha', 'Banshee', 1968, NULL::integer,
      ARRAY['banshee', 'banshee 350', 'yz250', 'yz125', 'yz80', 'yz465', 'tt500', 'xt500', 'dt1', 'dt250', 'enduro dt125', 'at1', 'jt1']),
    ('00000000-0000-4000-f000-000000000221'::uuid, 'Isuzu', 'VehiCROSS', 1980, NULL::integer,
      ARRAY['vehicross', 'trooper', 'trooper ii', 'trooper s', 'trooper ls', 'elf', 'impulse', 'rodeo', 'pickup', 'nrr']),
    ('00000000-0000-4000-f000-000000000222'::uuid, 'Peugeot', '205', 1910, NULL::integer,
      ARRAY['205', '205 gti', '205 t16', '205 rallye', '402', '403', '404', '405', '405 mi16', '504', '505', '106', '309', '103', 'bebe']),
    ('00000000-0000-4000-f000-000000000223'::uuid, 'Renault', 'Dauphine', 1945, NULL::integer,
      ARRAY['dauphine', 'clio', 'caravelle', 'alpine gta', 'le car', '4cv', '4', '8', '10', 'alliance', 'fuego']),
    ('00000000-0000-4000-f000-000000000224'::uuid, 'BMW', 'Bavaria', 1962, NULL::integer,
      ARRAY['bavaria', '2000cs', '2000', '1600', '1800', '3 0s', '3.0s', '3.0si', '600', '700']),
    ('00000000-0000-4000-f000-000000000225'::uuid, 'Chrysler', 'Windsor', 1924, NULL::integer,
      ARRAY['windsor', 'airflow', 'saratoga', 'royal', 'crown imperial', 'fifth avenue'])
)
INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases)
SELECT nf.id, nf.make, nf.canonical_model, nf.year_start, nf.year_end, nf.aliases
FROM new_families nf
WHERE NOT EXISTS (
  SELECT 1
  FROM public.canonical_models cm
  WHERE lower(cm.make) = lower(nf.make)
    AND lower(cm.canonical_model) = lower(nf.canonical_model)
);

-- 2. Widen restrictive year_start / year_end on existing canonical_models rows
WITH year_fixes(make, canonical_model, new_year_start, clear_year_end) AS (
  VALUES
    ('Alfa Romeo', 'Spider', 1955, true),
    ('Aston Martin', 'DB7', 1993, true),
    ('BMW', 'M Coupe', 1997, true),
    ('BMW', 'M Roadster', 1996, true),
    ('BMW', '2002', 1966, true),
    ('BMW', '3 Series', 1975, true),
    ('BMW', 'R90S', 1923, true),
    ('Buick', 'GS', 1964, true),
    ('Buick', 'Super', 1930, true),
    ('Cadillac', 'Series 62', 1930, true),
    ('Chevrolet', 'Bel Air', 1949, true),
    ('Chevrolet', 'Impala', 1956, true),
    ('Chevrolet', 'Camaro', 1966, true),
    ('Chevrolet', 'Custom', 1915, true),
    ('Datsun', '510', 1967, true),
    ('Dodge', 'Polara', 1948, true),
    ('Ford', 'Deluxe', 1930, true),
    ('Ford', 'Galaxie', 1952, true),
    ('Ford', 'Model A', 1927, true),
    ('Ford', 'Model T', 1908, true),
    ('Ford', 'Thunderbird', 1954, true),
    ('Ford', 'Custom', 1920, true),
    ('GMC', 'Suburban', 1935, true),
    ('GMC', 'C10', 1960, true),
    ('Honda', 'CB450', 1960, true),
    ('Honda', 'CR250R', 1970, true),
    ('Honda', 'Z50R', 1967, true),
    ('Honda', 'Odyssey', 1977, true),
    ('International', 'Travelall', 1907, true),
    ('Kawasaki', 'H2', 1965, true),
    ('Lincoln', 'Continental', 1939, true),
    ('Lincoln', 'Premiere', 1949, true),
    ('Lincoln', 'Zephyr', 1935, true),
    ('Maserati', '3500 GT', 1957, true),
    ('Maserati', 'Coupe', 1998, true),
    ('Maserati', 'Quattroporte', 1963, true),
    ('Mercury', 'Custom', 1938, true),
    ('MG', 'MGB', 1962, true),
    ('MG', 'MGC', 1967, true),
    ('MG', 'TC', 1935, true),
    ('Packard', 'Deluxe Eight', 1920, true),
    ('Packard', 'Super Eight', 1906, true),
    ('Pontiac', 'Chieftain', 1935, true),
    ('Pontiac', 'LeMans', 1961, true),
    ('Shelby', 'Cobra', 1961, true),
    ('Suzuki', 'Samurai', 1980, true)
)
UPDATE public.canonical_models cm
SET
  year_start = CASE
    WHEN cm.year_start IS NULL THEN yf.new_year_start
    ELSE LEAST(cm.year_start, yf.new_year_start)
  END,
  year_end = CASE
    WHEN yf.clear_year_end THEN NULL
    ELSE cm.year_end
  END
FROM year_fixes yf
WHERE lower(cm.make) = lower(yf.make)
  AND lower(cm.canonical_model) = lower(yf.canonical_model);

-- 3. Append 1-to-4 word aliases to canonical_models rows
WITH target_additions(make, canonical_model, add_aliases) AS (
  VALUES
    ('Austin', 'Mini', ARRAY['healey 3000', 'healey', 'healey sprite', 'healey bugeye', 'a35', 'a40', 'seven', 'fx4']),
    ('AM General', 'Hummer', ARRAY['humvee', 'general humvee', 'm35a3', 'm35a2', 'm923']),
    ('Ram', '1500', ARRAY['trx', 'crew cab 4x4', '4x4', 'pickup', 'promaster']),
    ('Alfa Romeo', 'Spider', ARRAY['veloce', 'duetto', '1600 duetto', '2000 spider veloce']),
    ('Alfa Romeo', 'Giulia', ARRAY['gt 1600 junior', 'zagato', 'junior z', 'gtv', 'gtv6', '1750 berlina', 'berlina', 'super']),
    ('Aston Martin', 'DB2/4', ARRAY['db mkiii', 'db mkiii sports saloon', 'mkiii']),
    ('Aston Martin', 'DB7', ARRAY['db 7', 'db 7 volante', 'db 7 convertible']),
    ('Shelby', 'Cobra', ARRAY['roadster', 'cobra 4000 roadster', 'five racing mk4 roadster', 'daytona coupe', 'daytona', 'csx']),
    ('Dodge', 'Polara', ARRAY['330', '440', 'custom', 'custom 880', 'matador', 'wayfarer', 'coronet']),
    ('GMC', 'Suburban', ARRAY['suburban', 'yukon', 'yukon xl', 'yukon denali', 'jimmy']),
    ('GMC', 'C10', ARRAY['k10', 'k15', 'k20', 'k25', 'c15', 'c20', 'c25']),
    ('Cadillac', 'Series 62', ARRAY['series 61', 'v-12', 'v-16', '355', '370']),
    ('Lincoln', 'Zephyr', ARRAY['zephyr custom', 'custom']),
    ('Lincoln', 'Premiere', ARRAY['premier', 'premier convertible', 'capri', 'cosmopolitan', 'batmobile replica']),
    ('Ford', 'Custom', ARRAY['hot rod', 'street rod', 'dearborn deuce', 'model 40', 'standard', 'coe', 'convertible', 'sedan', 'station wagon', 'gpw']),
    ('Ford', 'Galaxie', ARRAY['starliner', 'sunliner', 'country squire', 'ranch wagon', 'country sedan', 'crestline', 'mainline', 'victoria', 'skyliner']),
    ('Chevrolet', 'Camaro', ARRAY['copo', 'copo camaro', 'yenko', 'z28', 'z/28', 'iroc-z']),
    ('Buick', 'GS', ARRAY['gs455', 'gs455 convertible', 'gs400', 'gs400 convertible', 'gs 455', 'gs 400', 'gs 350', 'gsx']),
    ('Buick', 'Super', ARRAY['custom', 'custom coupe', 'convertible', 'coupe', 'sedan']),
    ('Packard', 'Deluxe Eight', ARRAY['eight', 'custom eight', 'custom', 'sedan', 'convertible', 'woody wagon', 'eight convertible coupe']),
    ('Packard', 'Super Eight', ARRAY['super 8', 'super 8 convertible', 'super eight convertible']),
    ('Pontiac', 'Chieftain', ARRAY['streamliner', 'silver streak', 'torpedo']),
    ('Pontiac', 'LeMans', ARRAY['can am', 'can-am']),
    ('Maserati', '3500 GT', ARRAY['mistral', 'mistral spyder']),
    ('Maserati', 'Coupe', ARRAY['cambiocorsa', 'cambio corsa', 'cambio corsa convertible']),
    ('Maserati', 'Quattroporte', ARRAY['quattro porte', 'quattro porte sedan']),
    ('MG', 'MGB', ARRAY['rv8', 'mg rv8']),
    ('MG', 'MGC', ARRAY['c gt', 'mgc gt']),
    ('MG', 'TC', ARRAY['ta', 'tb', 'pb', 'pa', 'j2', 'midget']),
    ('BMW', '2002', ARRAY['2002ti', '2002tii', '2002 turbo', '1602']),
    ('BMW', '3 Series', ARRAY['316i', '325es', '325e', '325', '318i', '320i', '323i', '328i', '330i', 'cabriolet']),
    ('BMW', 'R90S', ARRAY['r27', 'r12', 'r50', 'r60', 'r69', 'r75', 'r80', 'r100', 'r100rs', 'r100gs']),
    ('Datsun', '510', ARRAY['510', '1600 sss', 'bluebird']),
    ('Land Rover', 'Series', ARRAY['ies iii', 'county lwb', 'rover']),
    ('International', 'Travelall', ARRAY['harvester', '1210', '1200', '1200c', '1110', 'l-112', 'l-122', 'l-132', 'r-110', 'r-112', 'kb1', 'kb2', 'kb-2', 'd2', 'auto wagon', 'rxt', '4700', '4400', 'c900', 'farmall 300', 'cub lo-boy']),
    ('Kawasaki', 'H2', ARRAY['h1', 'h1 mach iii', 's2', 's3', 's3 mach ii', 'z2 750', 'z2', 'z1r', 'z1b', 'z900', 'zrx1100', 'zrx1200r', 'kz650', 'kz900b', 'kz400', 'gpz750', 'gpz1100', 'kx250', 'kx500', 'kx125', 'ninja', 'zx-14', 'w1 650', 'kv75', 'ke100', 'klr650']),
    ('Honda', 'CB450', ARRAY['cl450', 'cl350', 'cl350 scrambler', 'cb350', 'cb350f', 'cb1100f', 'cl77', 'ca77', 'dream', 'st90']),
    ('Honda', 'CR250R', ARRAY['cr250', 'cr250m', 'cr250m elsinore', 'elsinore']),
    ('Honda', 'Z50R', ARRAY['z50j', 'z50rd', 'z50', 'z50a']),
    ('Honda', 'Odyssey', ARRAY['odyssey fl350r', 'fl350r', 'fl250']),
    ('Indian', 'Four', ARRAY['twin', 'single', 'daytona', 'camelback']),
    ('Harley-Davidson', 'EL', ARRAY['wla', 'ul', 'vl', 'vld', 'jd', 'jdh', 'model j', 'single', 'twin', '8 valve', 'board track racer']),
    ('Harley-Davidson', 'FL', ARRAY['road king', 'electra glide', 'sportster', 'xr750', 'xr1000', 'v-rod', 'cvo', 'captain america replica']),
    ('Suzuki', 'Samurai', ARRAY['samuari', 'sj410', 'sj413'])
)
UPDATE public.canonical_models cm
SET aliases = (
  SELECT array_agg(DISTINCT x ORDER BY x)
  FROM unnest(coalesce(cm.aliases, '{}'::text[]) || ta.add_aliases) AS x
)
FROM target_additions ta
WHERE lower(cm.make) = lower(ta.make)
  AND lower(cm.canonical_model) = lower(ta.canonical_model);

COMMIT;
