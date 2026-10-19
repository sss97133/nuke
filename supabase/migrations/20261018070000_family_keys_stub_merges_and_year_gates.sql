-- Slice 17: Merge 1-to-2 sale stub rows into parent factory families, widen year gates on
-- existing canonical_models rows that were rejecting early/late-year examples, and add
-- missing race/pre-war families (Ferrari 312T, Aston Martin Valkyrie, Aston Martin Ulster,
-- McLaren MP4, Lamborghini Sian, Alfa Romeo Tipo 33, Lancia Lambda, Lancia 037, Lotus Type 18,
-- MG Magnette, Packard Clipper, Sunbeam 90).

-- 1) Insert new canonical families first (idempotent on make + canonical_model)
WITH new_families(id, make, canonical_model, year_start, year_end, aliases) AS (
  VALUES
    (
      '00000000-0000-4000-f000-000000000277'::uuid,
      'Ferrari',
      '312T',
      1950,
      NULL::integer,
      ARRAY[
        '312t',
        '312 t',
        '312b',
        'f2002',
        'f300',
        'f1 2000',
        'tipo 555',
        '642',
        '641',
        '641 2',
        '126',
        '126 c2',
        '246 f1'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000278'::uuid,
      'Aston Martin',
      'Valkyrie',
      2009,
      NULL::integer,
      ARRAY[
        'valkyrie',
        'martin valkyrie',
        'valkyrie spider',
        'martin valkyrie spider',
        'valhalla',
        'one 77',
        'vulcan',
        'martin vulcan'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000279'::uuid,
      'Aston Martin',
      'Ulster',
      1920,
      NULL::integer,
      ARRAY[
        'ulster',
        'db mk ii',
        'martin db mk ii',
        'mk ii',
        'international',
        'le mans',
        '2 litre',
        '1 5 litre'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000280'::uuid,
      'McLaren',
      'MP4',
      1966,
      NULL::integer,
      ARRAY[
        'mp4',
        'mp4 8a',
        'cosworth ford mp4 8a',
        'mp4 21',
        'mercedes benz mp4 21',
        'mp4 17a',
        'mp4 3',
        'mp4 12c',
        'tv 6',
        'm16c',
        'm23',
        'm1b',
        'm6b',
        'm8f'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000281'::uuid,
      'Lamborghini',
      'Sian',
      2008,
      NULL::integer,
      ARRAY[
        'sian',
        'sian fkp 37',
        'essenza scv12',
        '63 1 of 63',
        'temerario',
        'centenario',
        'veneno',
        'reventon'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000282'::uuid,
      'Alfa Romeo',
      'Tipo 33',
      1967,
      NULL::integer,
      ARRAY[
        'tipo 33',
        'tipo 33 2',
        'tipo 33 3',
        'tipo 33 tt 12',
        'tipo 33sc12',
        'tipo 33tt 3',
        't33 2',
        '179c'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000283'::uuid,
      'Lancia',
      'Lambda',
      1922,
      NULL::integer,
      ARRAY[
        'lambda',
        'lambda 8th series',
        'lambda 3rd series',
        'lambda 7th series',
        'astura',
        'aprilia',
        'artena',
        'dilambda',
        'appia',
        'flavia'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000284'::uuid,
      'Lancia',
      '037',
      1982,
      NULL::integer,
      ARRAY[
        '037',
        'rally 037',
        '037 stradale',
        'delta s4',
        'hyena'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000285'::uuid,
      'Lotus',
      'Type 18',
      1956,
      NULL::integer,
      ARRAY[
        'type 18',
        '18 formula junior',
        '20 formula junior',
        'type 14',
        'type 20',
        'type 22',
        'type 51',
        'type 61',
        'type 72',
        'excel'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000286'::uuid,
      'MG',
      'Magnette',
      1930,
      NULL::integer,
      ARRAY[
        'magnette',
        'magnette zb',
        'magnette za',
        'magnette k3',
        'sa tourer',
        'va tourer',
        'f type magna',
        'l type magna',
        'ya',
        'yb',
        'yt'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000287'::uuid,
      'Packard',
      'Clipper',
      1937,
      NULL::integer,
      ARRAY[
        'clipper',
        'patrician',
        '400',
        '250',
        '300',
        'mayfair',
        '115c',
        '115',
        '160',
        '180',
        '200',
        'six'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000288'::uuid,
      'Sunbeam',
      '90',
      1912,
      NULL::integer,
      ARRAY[
        'tourist trophy',
        '12 16hp',
        '16hp',
        'talbot 90',
        '90 mkii',
        '90 mkiia',
        'mkiii',
        'rapier',
        'imp',
        's7',
        '489cc s7',
        's8',
        'model 9'
      ]
    )
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

-- 2) Re-home pre-existing 1-to-2 sale stub rows in canonical_models into their parent factory
-- family so mv_model_family_names groups them under the parent family (and preserves their own
-- model phrase in aliases).
WITH stub_merges(make, stub_model, target_model) AS (
  VALUES
    ('Bugatti', 'Type 59', 'Type 35'),
    ('Bugatti', 'Type 54', 'Type 35'),
    ('Bugatti', 'Type 51', 'Type 35'),
    ('Bugatti', 'Type 39', 'Type 35'),
    ('Bugatti', 'Type 37', 'Type 35'),
    ('Bugatti', 'Type 29', 'Type 35'),
    ('Bugatti', 'Type 13 / 15 / 17 / 22 / 23', 'Type 35'),
    ('Bugatti', 'Type 101', 'Type 57'),
    ('Bugatti', 'Type 55', 'Type 57'),
    ('Bugatti', 'Type 50', 'Type 57'),
    ('Bugatti', 'Type 49', 'Type 57'),
    ('Bugatti', 'Type 46', 'Type 57'),
    ('Bugatti', 'Type 44', 'Type 57'),
    ('Bugatti', 'Type 43', 'Type 57'),
    ('Bugatti', 'Type 40', 'Type 57'),
    ('Bugatti', 'Mistral', 'Chiron'),
    ('Bugatti', 'W16 Mistral', 'Chiron'),
    ('Bugatti', 'Divo', 'Chiron'),
    ('Bugatti', 'Chiron Pur Sport', 'Chiron'),
    ('Bugatti', 'Chiron Supersport', 'Chiron'),
    ('Bugatti', 'Centodieci', 'Chiron'),
    ('Bugatti', 'Bolide', 'Chiron'),
    ('Bugatti', 'La Voiture Noire', 'Chiron'),
    ('Bugatti', 'EB 112', 'EB110'),
    ('Bugatti', 'Veyron 16.4', 'Veyron'),
    ('Porsche', '956', '917'),
    ('Ferrari', '642', '312T'),
    ('Ferrari', '641', '312T'),
    ('Ferrari', '126', '312T'),
    ('Ferrari', '246 F1', '312T'),
    ('Ferrari', '340 MM', '500 TRC'),
    ('Ferrari', '195 Inter', '500 TRC'),
    ('Ferrari', '342 America', '500 TRC'),
    ('Ferrari', '412 Prototipo Scaglietti Roadster', '500 TRC'),
    ('Ferrari', '575', '575M'),
    ('Ferrari', '575M Maranello', '575M'),
    ('Ferrari', '612', '612 Scaglietti'),
    ('Ferrari', '612 Can Am', '612 Scaglietti'),
    ('Ferrari', 'Challenge Stradale', '360'),
    ('Ferrari', '12Cilindri', '812'),
    ('Alfa Romeo', 'Tipo 256', '6C'),
    ('Alfa Romeo', 'Tipo 308', '8C'),
    ('Alfa Romeo', 'Tipo C', '8C'),
    ('Alfa Romeo', '8C Competizione Spider', '8C'),
    ('Alfa Romeo', 'Tipo 33/TT/12', 'Tipo 33'),
    ('Alfa Romeo', 'Tipo 33/3', 'Tipo 33'),
    ('Alfa Romeo', 'Tipo 33/2', 'Tipo 33'),
    ('Alfa Romeo', 'Tipo 33SC12', 'Tipo 33'),
    ('Alfa Romeo', 'Tipo 33TT/3', 'Tipo 33'),
    ('Alfa Romeo', '179C', 'Tipo 33'),
    ('Aston Martin', 'Valhalla', 'Valkyrie'),
    ('Aston Martin', 'DB12', 'DB11'),
    ('Delahaye', '145', '135'),
    ('Delahaye', '165', '135'),
    ('Delahaye', '178', '135'),
    ('Delahaye', '235', '135'),
    ('Delage', 'D8-105', 'D8'),
    ('Facel Vega', 'FV', 'HK500'),
    ('Facel Vega', 'FV2', 'HK500'),
    ('Facel Vega', 'FV3', 'HK500'),
    ('Chevrolet', 'CERV', 'Corvette'),
    ('Chevrolet', 'Corvette GTP', 'Corvette'),
    ('Chevrolet', 'Manta Ray', 'Corvette'),
    ('Chevrolet', 'C8', 'Corvette'),
    ('Chrysler', 'Diablo', '300'),
    ('Chrysler', 'Viper', '300'),
    ('Chrysler', 'ST Special', '300'),
    ('Chrysler', 'GS-1', '300'),
    ('Chrysler', 'Styling Special', '300'),
    ('De Tomaso', 'P70', 'Mangusta'),
    ('De Tomaso', 'Sport 5000 Spyder', 'Mangusta'),
    ('Bentley', 'Speed 8', '3 1/2 Litre'),
    ('Bentley', 'EXP Speed 8', '3 1/2 Litre'),
    ('Bentley', 'Speed Six', '3 1/2 Litre'),
    ('Bentley', '3 Litre', '3 1/2 Litre'),
    ('Bentley', '4 1/2 Litre', '3 1/2 Litre'),
    ('Bentley', '4 1/4 Litre', '3 1/2 Litre'),
    ('Bentley', '6 1/2 Litre', '3 1/2 Litre'),
    ('Bentley', '8 Litre', '3 1/2 Litre'),
    ('Bentley', 'Mark VI', '3 1/2 Litre'),
    ('Bentley', 'R-Type', '3 1/2 Litre'),
    ('Bentley', 'S1', '3 1/2 Litre'),
    ('Bentley', 'S2', '3 1/2 Litre'),
    ('Bentley', 'S3', '3 1/2 Litre'),
    ('McLaren', '620R', '570S'),
    ('McLaren', 'GTS', 'GT'),
    ('Lamborghini', 'Temerario', 'Sian'),
    ('Rolls-Royce', 'Spectre', 'Wraith'),
    ('BMW', 'XM', 'X5'),
    ('Audi', 'RS 6 Avant', 'RS 6'),
    ('Audi', 'RS e-tron GT', 'RS 6'),
    ('Cadillac', 'Northstar LMP', 'CTS-V'),
    ('Cadillac', 'Lyriq', 'Escalade'),
    ('Cadillac', 'Escalade IQ', 'Escalade'),
    ('Lotus', '340R', 'Elise'),
    ('Lotus', '2-Eleven', 'Elise')
)
UPDATE public.canonical_models cm
SET
  canonical_model = sm.target_model,
  year_start = NULL,
  year_end = NULL,
  aliases = (
    SELECT array_agg(DISTINCT a ORDER BY a)
    FROM unnest(
      coalesce(cm.aliases, ARRAY[]::text[]) ||
      ARRAY[lower(btrim(regexp_replace(cm.canonical_model, '[^a-zA-Z0-9]+', ' ', 'g')))]
    ) AS a
    WHERE a IS NOT NULL AND btrim(a) <> ''
  )
FROM stub_merges sm
WHERE lower(cm.make) = lower(sm.make)
  AND lower(cm.canonical_model) = lower(sm.stub_model);

-- 3) Widen year bounds on existing canonical families so early/late/continuation examples
-- that already match mv_model_family_names are not rejected by mv_family_market.
WITH year_fixes(make, canonical_model, new_start, new_end) AS (
  VALUES
    ('Pontiac', 'Bonneville', 1954, NULL::integer),
    ('Shelby', 'GT500', 1962, NULL::integer),
    ('BMW', '3 Series', 1930, NULL::integer),
    ('BMW', '8 Series', 1989, NULL::integer),
    ('BMW', 'Bavaria', 1950, NULL::integer),
    ('Packard', 'Twelve', 1915, NULL::integer),
    ('Packard', 'Super Eight', 1899, NULL::integer),
    ('Ford', 'Roadster', 1903, NULL::integer),
    ('Ford', 'GT', 1964, NULL::integer),
    ('Ford', 'Model A', 1903, NULL::integer),
    ('Ford', 'F-1', 1948, NULL::integer),
    ('Ford', 'F-100', 1948, NULL::integer),
    ('Ford', 'F-150', 1948, NULL::integer),
    ('Ford', 'Pickup', 1903, NULL::integer),
    ('Ford', 'Fairlane', 1950, NULL::integer),
    ('Ford', 'Falcon', 1955, NULL::integer),
    ('Ford', 'Galaxie', 1949, NULL::integer),
    ('Austin', 'Mini', 1922, NULL::integer),
    ('Mini', 'Cooper', 1959, NULL::integer),
    ('Dodge', 'Polara', 1914, NULL::integer),
    ('Dodge', 'Challenger', 1958, NULL::integer),
    ('Dodge', 'Ram', 1970, NULL::integer),
    ('Chevrolet', 'Pickup', 1918, NULL::integer),
    ('Chevrolet', 'C1500', 1947, NULL::integer),
    ('Chevrolet', 'C2500', 1960, NULL::integer),
    ('Chevrolet', 'K1500', 1960, NULL::integer),
    ('Chevrolet', 'Blazer', 1965, NULL::integer),
    ('Chevrolet', 'Apache', 1950, NULL::integer),
    ('GMC', 'Pickup', 1912, NULL::integer),
    ('Mercedes-Benz', '300 SL', 1952, NULL::integer),
    ('Mercedes-Benz', '300D', 1950, NULL::integer),
    ('Mercedes-Benz', '540K', 1886, NULL::integer),
    ('Mercedes-Benz', 'S-Class', 1949, NULL::integer),
    ('Mercedes-Benz', 'SLS AMG', 2009, NULL::integer),
    ('MG', 'Midget', 1929, NULL::integer),
    ('MG', 'MGA', 1925, NULL::integer),
    ('MG', 'TC', 1925, NULL::integer),
    ('Ferrari', '458', 2009, NULL::integer),
    ('Ferrari', '330', 1960, NULL::integer),
    ('Ferrari', '360', 1998, NULL::integer),
    ('Ferrari', 'Testarossa', 1957, NULL::integer),
    ('Ferrari', '575M', 2000, NULL::integer),
    ('Ferrari', '456', 1990, NULL::integer),
    ('Porsche', 'Boxster', 1996, NULL::integer),
    ('Porsche', '930', 1973, NULL::integer),
    ('Porsche', '911', 1963, NULL::integer),
    ('Porsche', '928', 1976, NULL::integer),
    ('Porsche', '917', 1968, NULL::integer),
    ('Porsche', 'Carrera GT', 2003, NULL::integer),
    ('Porsche', '550', 1953, NULL::integer),
    ('Fiat', '124 Spider', 1900, NULL::integer),
    ('Fiat', 'X1/9', 1950, NULL::integer),
    ('Auburn', '851', 1900, NULL::integer),
    ('Alfa Romeo', 'Spider', 1930, NULL::integer),
    ('Lincoln', 'Mark VII', 1968, NULL::integer),
    ('Lincoln', 'Town Car', 1922, NULL::integer),
    ('Rolls-Royce', 'Silver Cloud', 1950, NULL::integer),
    ('Rolls-Royce', 'Silver Seraph', 1995, NULL::integer),
    ('Rolls-Royce', 'Ghost', 1906, NULL::integer),
    ('Nash', 'Metropolitan', 1918, NULL::integer),
    ('Morgan', 'Roadster', 1930, NULL::integer),
    ('Morgan', 'Plus 4', 1935, NULL::integer),
    ('Meyers', 'Manx', 1960, NULL::integer),
    ('Lancia', 'Aurelia', 1945, NULL::integer),
    ('Plymouth', 'Road Runner', 1965, NULL::integer),
    ('Willys', 'Jeep Wagon', 1940, NULL::integer),
    ('Willys', 'Jeepster', 1940, NULL::integer),
    ('Willys', 'CJ', 1940, NULL::integer),
    ('Willys', 'Americar', 1915, NULL::integer),
    ('Vincent', 'Black Shadow', 1928, NULL::integer),
    ('Honda', 'CB450', 1955, NULL::integer),
    ('Buick', 'Riviera', 1949, NULL::integer),
    ('Buick', 'Special', 1905, NULL::integer),
    ('Jeep', 'Grand Wagoneer', 1962, NULL::integer),
    ('Land Rover', 'Series', 1948, NULL::integer),
    ('Cadillac', 'Eldorado', 1950, NULL::integer),
    ('Morris', 'Minor', 1920, NULL::integer),
    ('DeSoto', 'Adventurer', 1928, NULL::integer),
    ('Volkswagen', 'Dune Buggy', 1950, NULL::integer),
    ('De Tomaso', 'Mangusta', 1959, NULL::integer),
    ('De Tomaso', 'Pantera', 1970, NULL::integer)
)
UPDATE public.canonical_models cm
SET
  year_start = LEAST(coalesce(cm.year_start, yf.new_start), yf.new_start),
  year_end = yf.new_end
FROM year_fixes yf
WHERE lower(cm.make) = lower(yf.make)
  AND lower(cm.canonical_model) = lower(yf.canonical_model);

-- 4) Append aliases to existing families (1-to-4 alphanumeric words per phrase)
WITH target_additions(make, canonical_model, add_aliases) AS (
  VALUES
    (
      'Avions Voisin',
      'C25',
      ARRAY[
        'c25',
        'c23',
        'c24',
        'c14',
        'c28',
        'c30',
        'c31',
        'c11',
        'c7',
        'c6',
        'c4s',
        'c3',
        'c1',
        'oc1'
      ]
    ),
    (
      'Bugatti',
      'Type 35',
      ARRAY[
        'type 59',
        'type 59 sports',
        'type 54',
        'type 51',
        'type 39',
        'type 39a',
        'type 37',
        'type 37a',
        'type 29',
        'type 29 30',
        'type 30',
        'type 13'
      ]
    ),
    (
      'Bugatti',
      'Chiron',
      ARRAY[
        'mistral',
        'w16 mistral',
        'divo',
        'divo vin vf9sd3v34lm795015',
        'chiron pur sport',
        'chiron supersport',
        'centodieci',
        'bolide',
        'la voiture noire'
      ]
    ),
    (
      'Bugatti',
      'EB110',
      ARRAY[
        'eb110',
        'eb110 gt',
        'eb110 ss',
        'eb112',
        'eb 112'
      ]
    ),
    (
      'Porsche',
      '917',
      ARRAY[
        '917',
        '917k',
        '917 10',
        '917 30',
        '956',
        '962',
        '908',
        '906',
        '904',
        '910'
      ]
    ),
    (
      'Porsche',
      '550',
      ARRAY[
        'rs 61',
        'rs61',
        'rs 60',
        'rs60',
        '718 rsk'
      ]
    ),
    (
      'Porsche',
      '911',
      ARRAY[
        'rt12',
        'rt12 s',
        'turbo s 900r',
        'turbo s 900'
      ]
    ),
    (
      'Ferrari',
      '500 TRC',
      ARRAY[
        '500 trc',
        '500 mondial',
        '340 mm',
        '340 mm spider',
        '340 america',
        '342 america',
        '195 inter',
        '195 s inter',
        '212 inter',
        '212 export',
        '166 mm',
        '166 inter',
        '412 prototipo'
      ]
    ),
    (
      'Ferrari',
      '275',
      ARRAY[
        '275gtb',
        '275gtb 4',
        '275 gtb',
        '275 gtb 4',
        '275 gts'
      ]
    ),
    (
      'Ferrari',
      '599',
      ARRAY[
        'sa aperta',
        '599 sa aperta'
      ]
    ),
    (
      'Ferrari',
      '512 TR',
      ARRAY[
        'f512',
        'f512 m',
        'f512m'
      ]
    ),
    (
      'McLaren',
      'P1',
      ARRAY[
        'p1vin',
        'p1 gtr',
        'p1 lm'
      ]
    ),
    (
      'McLaren',
      '675LT',
      ARRAY[
        'mso hs',
        '675lt',
        '675lt spider'
      ]
    ),
    (
      'Mercedes-Benz',
      '540K',
      ARRAY[
        'typ s',
        'typ s 26 120',
        '50 hp',
        '50 hp tourer',
        '630k',
        '24 100 140',
        'model k',
        'patent motorwagen',
        '320b',
        '320 cabriolet',
        '320'
      ]
    ),
    (
      'Mercedes-Benz',
      'G-Class',
      ARRAY[
        'g650',
        'g650 landaulet',
        'maybach g650',
        'maybach g650 landaulet'
      ]
    ),
    (
      'Jaguar',
      'D-Type',
      ARRAY[
        'e2a',
        'xkss',
        'xkss continuation',
        'costin lister',
        'lister'
      ]
    ),
    (
      'Maserati',
      'A6G',
      ARRAY[
        'tipo 151',
        'tipo 26',
        '6cm',
        '8c 3000',
        '4cl',
        '4clt',
        '250f'
      ]
    ),
    (
      'Rolls-Royce',
      'Silver Ghost',
      ARRAY[
        '40 50hp',
        '40 50 hp'
      ]
    ),
    (
      'BMW',
      '8 Series',
      ARRAY[
        '8 series',
        '840ci',
        '850i',
        '850ci',
        '850csi',
        'm8',
        'm850i',
        'alpina b8'
      ]
    ),
    (
      'Stutz',
      'Bearcat',
      ARRAY[
        'model 4f',
        'model aa',
        'model 4e',
        'speedway four',
        'model g',
        'black hawk',
        'bulldog'
      ]
    ),
    (
      'Willys',
      'Americar',
      ARRAY[
        'custom coupe',
        'coupe',
        'coupe street rod',
        'custom 2 door coupe',
        'swoopster',
        'whippet',
        'overland whippet',
        'overland'
      ]
    ),
    (
      'Packard',
      'Super Eight',
      ARRAY[
        'sport phaeton',
        '905',
        '3 48',
        'atd',
        'model f',
        'model c',
        '1204',
        'model 18',
        '633',
        '626',
        '726',
        'model 226'
      ]
    ),
    (
      'Bentley',
      '3 1/2 Litre',
      ARRAY[
        '4 1 4 liter',
        'b special speed 8',
        '3 liter',
        '6 1 2 litre',
        'mk vi',
        '3 1 2 liter',
        's type'
      ]
    ),
    (
      'Chrysler',
      '300',
      ARRAY[
        'gs special',
        'cd 8',
        'series 75',
        'model 75',
        'series 70',
        'model 72',
        '72 series',
        '300m',
        'le baron',
        'sno runner',
        'sno runners'
      ]
    ),
    (
      'Ruf',
      'CTR',
      ARRAY[
        'rt12',
        'rt 12',
        'btr',
        'rct',
        'scr'
      ]
    ),
    (
      'Alfa Romeo',
      'GTV',
      ARRAY[
        'gta 1300 junior',
        'romeo gta 1300 junior',
        '1750gtv',
        'alfetta',
        'romeo alfetta',
        '164ls',
        'romeo 164ls',
        '164l',
        'romeo 164l',
        'romeo 164s',
        'brera'
      ]
    ),
    (
      'Auburn',
      '851',
      ARRAY[
        'model 88',
        '12 161a',
        'boattail',
        '8 98a',
        'speedster replica',
        'speedster',
        '653',
        '8 100',
        'boattail replica'
      ]
    )
)
UPDATE public.canonical_models cm
SET aliases = (
  SELECT array_agg(DISTINCT a ORDER BY a)
  FROM unnest(coalesce(cm.aliases, ARRAY[]::text[]) || ta.add_aliases) AS a
  WHERE a IS NOT NULL AND btrim(a) <> ''
)
FROM target_additions ta
WHERE lower(cm.make) = lower(ta.make)
  AND lower(cm.canonical_model) = lower(ta.canonical_model);
