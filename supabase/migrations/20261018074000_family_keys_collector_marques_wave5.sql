-- Slice 21: Key remaining collector families and sub-model designations across 50 marques
-- (Maserati, Austin-Healey, MG, Triumph, Subaru, Porsche, BMW, Mercedes-Benz, AC, Alpina,
-- Auburn, Cord, Cunningham, Delage, Delahaye, DeSoto, De Tomaso, Facel Vega, Factory,
-- Factory Five, Indian, Infiniti, Jeep, Kaiser, Lancia, LaSalle, Lexus, Locomobile, Lola,
-- Lotus, McLaren, Mercury, Mini, Mitsubishi, Morgan, Nash, Nissan, Peugeot, Ram, Renault,
-- Ruf, Saab, Saleen, Suzuki, Vincent, Volvo, White, Willys, Yamaha, Abarth, Alvis,
-- AM General, BSA, Diamond T, Ducati, Imperial, Kawasaki, Citroen, Citroën, Austin, Beck, AMC).

-- 1) Re-home single-car stub rows in canonical_models into their active parent families
UPDATE public.canonical_models
SET
  canonical_model = '750',
  year_start = NULL,
  year_end = NULL,
  aliases = (
    SELECT array_agg(DISTINCT a ORDER BY a)
    FROM unnest(
      coalesce(aliases, ARRAY[]::text[]) ||
      ARRAY[lower(btrim(regexp_replace(canonical_model, '[^a-zA-Z0-9]+', ' ', 'g')))]
    ) AS a
    WHERE a IS NOT NULL AND btrim(a) <> ''
  )
WHERE lower(make) = 'abarth'
  AND lower(canonical_model) IN (
    '1000', '1000 sp', '1100', '1500', '2000 sport', '204a', '205a berlinetta',
    '207a spyder', '208a spyder', '209a coupé', '500', '695', 'classiche 1000 sp',
    'se 020', 'se 030', 'se 031', 'x1/9'
  );

UPDATE public.canonical_models
SET
  canonical_model = 'Ace',
  year_start = NULL,
  year_end = NULL,
  aliases = (
    SELECT array_agg(DISTINCT a ORDER BY a)
    FROM unnest(
      coalesce(aliases, ARRAY[]::text[]) ||
      ARRAY[lower(btrim(regexp_replace(canonical_model, '[^a-zA-Z0-9]+', ' ', 'g')))]
    ) AS a
    WHERE a IS NOT NULL AND btrim(a) <> ''
  )
WHERE lower(make) = 'ac'
  AND lower(canonical_model) IN (
    'ma-200', '289 sports', '3000me', '378 gt zagato', '428', 'ace-bristol',
    'aceca', 'aceca-bristol', 'ace v8', 'brooklands ace', 'greyhound'
  );

UPDATE public.canonical_models
SET
  canonical_model = 'B7',
  year_start = NULL,
  year_end = NULL,
  aliases = (
    SELECT array_agg(DISTINCT a ORDER BY a)
    FROM unnest(
      coalesce(aliases, ARRAY[]::text[]) ||
      ARRAY[lower(btrim(regexp_replace(canonical_model, '[^a-zA-Z0-9]+', ' ', 'g')))]
    ) AS a
    WHERE a IS NOT NULL AND btrim(a) <> ''
  )
WHERE lower(make) = 'alpina'
  AND lower(canonical_model) IN (
    'b10', 'b12', 'b2.8', 'b3', 'b6', 'b8', 'rle', 'roadster s', 'roadster v8'
  );

UPDATE public.canonical_models
SET
  canonical_model = 'Speed 25',
  year_start = NULL,
  year_end = NULL,
  aliases = (
    SELECT array_agg(DISTINCT a ORDER BY a)
    FROM unnest(
      coalesce(aliases, ARRAY[]::text[]) ||
      ARRAY[lower(btrim(regexp_replace(canonical_model, '[^a-zA-Z0-9]+', ' ', 'g')))]
    ) AS a
    WHERE a IS NOT NULL AND btrim(a) <> ''
  )
WHERE lower(make) = 'alvis'
  AND lower(canonical_model) IN (
    '4.3-litre', 'tc', 'tc 21/100', 'td 21', 'te 21', 'tf 21'
  );

UPDATE public.canonical_models
SET
  canonical_model = 'C-4R',
  year_start = NULL,
  year_end = NULL,
  aliases = (
    SELECT array_agg(DISTINCT a ORDER BY a)
    FROM unnest(
      coalesce(aliases, ARRAY[]::text[]) ||
      ARRAY[lower(btrim(regexp_replace(canonical_model, '[^a-zA-Z0-9]+', ' ', 'g')))]
    ) AS a
    WHERE a IS NOT NULL AND btrim(a) <> ''
  )
WHERE lower(make) = 'cunningham'
  AND lower(canonical_model) IN (
    'c-1', 'c-2r', 'c-3', 'c-5r', 'c-6r', 'corvette', 'series 61'
  );

UPDATE public.canonical_models
SET
  canonical_model = 'D8',
  year_start = NULL,
  year_end = NULL,
  aliases = (
    SELECT array_agg(DISTINCT a ORDER BY a)
    FROM unnest(
      coalesce(aliases, ARRAY[]::text[]) ||
      ARRAY[lower(btrim(regexp_replace(canonical_model, '[^a-zA-Z0-9]+', ' ', 'g')))]
    ) AS a
    WHERE a IS NOT NULL AND btrim(a) <> ''
  )
WHERE lower(make) = 'delage'
  AND lower(canonical_model) IN (
    '15-s-8', '2lcv', 'd12', 'd6-3l', 'd8-120', 'df', 'dh v12'
  );

UPDATE public.canonical_models
SET
  canonical_model = '135',
  year_start = NULL,
  year_end = NULL,
  aliases = (
    SELECT array_agg(DISTINCT a ORDER BY a)
    FROM unnest(
      coalesce(aliases, ARRAY[]::text[]) ||
      ARRAY[lower(btrim(regexp_replace(canonical_model, '[^a-zA-Z0-9]+', ' ', 'g')))]
    ) AS a
    WHERE a IS NOT NULL AND btrim(a) <> ''
  )
WHERE lower(make) = 'delahaye'
  AND lower(canonical_model) IN ('175', '180');

UPDATE public.canonical_models
SET
  canonical_model = 'HK500',
  year_start = NULL,
  year_end = NULL,
  aliases = (
    SELECT array_agg(DISTINCT a ORDER BY a)
    FROM unnest(
      coalesce(aliases, ARRAY[]::text[]) ||
      ARRAY[lower(btrim(regexp_replace(canonical_model, '[^a-zA-Z0-9]+', ' ', 'g')))]
    ) AS a
    WHERE a IS NOT NULL AND btrim(a) <> ''
  )
WHERE lower(make) = 'facel vega'
  AND lower(canonical_model) IN (
    'excellence', 'facel ii', 'fv1', 'fv2b', 'fv3b', 'fv4'
  );

UPDATE public.canonical_models
SET
  canonical_model = 'Pantera',
  year_start = NULL,
  year_end = NULL,
  aliases = (
    SELECT array_agg(DISTINCT a ORDER BY a)
    FROM unnest(
      coalesce(aliases, ARRAY[]::text[]) ||
      ARRAY[lower(btrim(regexp_replace(canonical_model, '[^a-zA-Z0-9]+', ' ', 'g')))]
    ) AS a
    WHERE a IS NOT NULL AND btrim(a) <> ''
  )
WHERE lower(make) = 'de tomaso'
  AND lower(canonical_model) IN (
    '505-38', 'deauville', 'f1', 'guarà', 'longchamp', 'p72', 'sport 1000', 'vallelunga'
  );

-- 2) Clear overly narrow year_start / year_end gates on all families touched below
UPDATE public.canonical_models
SET year_start = NULL, year_end = NULL
WHERE (lower(make), lower(canonical_model)) IN (
  ('abarth', '750'),
  ('ac', 'ace'),
  ('airstream', 'interstate'),
  ('alpina', 'b7'),
  ('alvis', 'speed 25'),
  ('amc', 'rambler'),
  ('am general', 'hummer'),
  ('auburn', '851'),
  ('austin', 'mini'),
  ('austin-healey', '3000'),
  ('austin-healey', '100'),
  ('austin-healey', 'sprite'),
  ('beck', '550 spyder'),
  ('bmw', '6 series'),
  ('bmw', '8 series'),
  ('bmw', 'z8'),
  ('bmw', 'z3'),
  ('bmw', 'r90s'),
  ('bsa', 'gold star'),
  ('citroen', 'traction avant'),
  ('citroen', 'ds'),
  ('citroen', '2 cv'),
  ('citroën', 'traction avant'),
  ('citroën', 'ds'),
  ('citroën', '2cv'),
  ('cord', '810'),
  ('cunningham', 'c-4r'),
  ('de tomaso', 'pantera'),
  ('de tomaso', 'mangusta'),
  ('delage', 'd8'),
  ('delahaye', '135'),
  ('desoto', 'adventurer'),
  ('diamond t', '201'),
  ('ducati', 'supersport'),
  ('ducati', '916'),
  ('facel vega', 'hk500'),
  ('factory', 'five mk4'),
  ('factory five', 'mk4 roadster'),
  ('ford', 'f-1'),
  ('ford', 'f-100'),
  ('imperial', 'crown'),
  ('indian', 'chief'),
  ('indian', 'four'),
  ('infiniti', 'fx35'),
  ('infiniti', 'g37'),
  ('jeep', 'commando'),
  ('jeep', 'wrangler'),
  ('jeep', 'cj-5'),
  ('jeep', 'cj-7'),
  ('jeep', 'cj-8 scrambler'),
  ('jeep', 'gladiator'),
  ('jeep', 'wagoneer'),
  ('jeep', 'grand wagoneer'),
  ('john deere', '4020'),
  ('kaiser', 'darrin'),
  ('kawasaki', 'h2'),
  ('lancia', 'aurelia'),
  ('lancia', '037'),
  ('lancia', 'lambda'),
  ('lasalle', 'series 50'),
  ('lexus', 'gx'),
  ('lexus', 'rx'),
  ('lexus', 'rc'),
  ('lexus', 'lx'),
  ('lexus', 'sc'),
  ('locomobile', 'model 48'),
  ('lola', 't70'),
  ('lotus', 'eleven'),
  ('maserati', 'a6g'),
  ('maserati', 'tipo 61 birdcage'),
  ('maserati', 'quattroporte'),
  ('mclaren', 'mp4'),
  ('mclaren', '720s'),
  ('mclaren', '600lt'),
  ('mclaren', '570s'),
  ('mercedes-benz', 'c-class'),
  ('mercedes-benz', '300 sl'),
  ('mercury', 'capri'),
  ('mercury', 'comet'),
  ('mercury', 'cougar'),
  ('mercury', 'cyclone'),
  ('mercury', 'monterey'),
  ('mg', 'mgb'),
  ('mg', 'magnette'),
  ('mg', 'midget'),
  ('mini', 'cooper'),
  ('mitsubishi', 'lancer evolution'),
  ('mitsubishi', 'pajero'),
  ('morgan', '3 wheeler'),
  ('morgan', 'plus 4'),
  ('nash', 'metropolitan'),
  ('nissan', 'gt-r'),
  ('nissan', '240z'),
  ('nissan', '260z'),
  ('nissan', '280z'),
  ('nissan', '280zx'),
  ('nissan', '300zx'),
  ('peugeot', '205'),
  ('porsche', '911'),
  ('porsche', '356'),
  ('porsche', '912'),
  ('porsche', '914'),
  ('porsche', '944'),
  ('porsche', 'carrera gt'),
  ('ram', '1500'),
  ('renault', '40 cv'),
  ('renault', 'dauphine'),
  ('ruf', 'ctr'),
  ('ruf', 'turbo r'),
  ('saab', '96'),
  ('saab', '900'),
  ('saleen', 's7'),
  ('subaru', 'wrx'),
  ('suzuki', 'gsx-r'),
  ('suzuki', 'carry'),
  ('triumph', 'tr6'),
  ('triumph', 'tr2'),
  ('triumph', 'bonneville'),
  ('triumph', 'stag'),
  ('vincent', 'black shadow'),
  ('volvo', '122s'),
  ('volvo', '240 series'),
  ('volvo', '740 series'),
  ('volvo', '960 series'),
  ('volvo', 'p1800'),
  ('volvo', 'pv544'),
  ('white', 'model l'),
  ('willys', 'jeepster'),
  ('yamaha', 'rd350'),
  ('yamaha', 'banshee')
);

-- 3) Insert new canonical families for Subaru Sambar and Range HSE/Sport mis-parsed make rows
INSERT INTO public.canonical_models (
  id, make, canonical_model, year_start, year_end, aliases
)
VALUES
  (
    '00000000-0000-4000-f000-000000000531'::uuid,
    'Subaru',
    'Sambar',
    NULL,
    NULL,
    ARRAY[
      'sambar',
      'sambar 360',
      'sambar 4wd',
      'sambar pickup',
      '360',
      '360 deluxe',
      '360 sedan',
      '360 super deluxe'
    ]
  ),
  (
    '00000000-0000-4000-f000-000000000532'::uuid,
    'Range',
    'Range Rover',
    NULL,
    NULL,
    ARRAY[
      'rover',
      'rover hse',
      'rover supercharged',
      'rover sport',
      'rover sport hse',
      'rover sport supercharged',
      'rover autobiography',
      'rover county',
      'rover classic',
      'rover vogue',
      'rover velar',
      'rover evoque'
    ]
  )
ON CONFLICT (id) DO UPDATE
SET
  make = EXCLUDED.make,
  canonical_model = EXCLUDED.canonical_model,
  year_start = EXCLUDED.year_start,
  year_end = EXCLUDED.year_end,
  aliases = EXCLUDED.aliases;

-- 4) Append 1-to-4 word aliases to existing families across the 50 marques
WITH target_additions(make, canonical_model, add_aliases) AS (
  VALUES
    (
      'Abarth',
      '750',
      ARRAY[
        '2000 sport',
        '1000 sport',
        '124 spider',
        'spider',
        '750gt',
        'berlina corsa',
        '695 biposto',
        'se025fl'
      ]
    ),
    (
      'AC',
      'Ace',
      ARRAY[
        '16 80',
        '16 80hp',
        '16 70hp',
        '2 litre',
        'mk iv',
        'ma 200'
      ]
    ),
    (
      'Airstream',
      'Interstate',
      ARRAY[
        'argosy',
        'globe trotter',
        'sprinter',
        'caravanner',
        'sport 16',
        'bubble trailer',
        '350le'
      ]
    ),
    (
      'Alpina',
      'B7',
      ARRAY[
        'roadster',
        'v8',
        'z8 roadster',
        'b2s',
        'b12 5 0',
        'c1 2 3',
        'b9 3 5',
        'c2 2 7',
        'a4'
      ]
    ),
    (
      'Alvis',
      'Speed 25',
      ARRAY[
        'speed 20sc',
        'speed 25sc',
        'tb 14',
        'sabre',
        'sb 13 22',
        '12 70',
        '12 60hp',
        '12 50hp',
        'healey'
      ]
    ),
    (
      'AMC',
      'Rambler',
      ARRAY[
        'cj 8',
        'jeep scrambler',
        'm422',
        'm422a1',
        'mighty mite'
      ]
    ),
    (
      'AM General',
      'Hummer',
      ARRAY[
        'm1123',
        'm151a2',
        'm1097a2',
        'm1025a2',
        'm1151a1',
        'm944a1',
        'm36a3',
        'm939',
        '5 ton'
      ]
    ),
    (
      'Auburn',
      '851',
      ARRAY[
        '898 a',
        '8 98',
        '12 161',
        '8 101 a',
        '8 101a',
        'series 88',
        '851sc',
        'boat tail'
      ]
    ),
    (
      'Austin',
      'Mini',
      ARRAY[
        'cooper s',
        'gipsy',
        'fx3',
        '18 24hp',
        '12 ll',
        'atlantic',
        'a 90',
        'princess',
        'bantam',
        'model lx t'
      ]
    ),
    (
      'Austin-Healey',
      '3000',
      ARRAY[
        'bj7',
        'bj 7',
        'i',
        'ii',
        'iii',
        'mkii',
        'convertible',
        'sport'
      ]
    ),
    (
      'Austin-Healey',
      '100',
      ARRAY[
        'bn1',
        'bn2'
      ]
    ),
    (
      'Beck',
      '550 Spyder',
      ARRAY[
        'spyder',
        '550rs',
        '356 replica',
        'lister',
        'roadster'
      ]
    ),
    (
      'BMW',
      '6 Series',
      ARRAY[
        '650ci',
        '645',
        '635 csi'
      ]
    ),
    (
      'BMW',
      '8 Series',
      ARRAY[
        '850 csi',
        'b12 5 0',
        '8 x'
      ]
    ),
    (
      'BMW',
      'Z8',
      ARRAY[
        'z8vin'
      ]
    ),
    (
      'BMW',
      'Z3',
      ARRAY[
        'z3m'
      ]
    ),
    (
      'BMW',
      'R90S',
      ARRAY[
        'r1250gs',
        'r26'
      ]
    ),
    (
      'BSA',
      'Gold Star',
      ARRAY[
        'rocket 3',
        'rocket',
        'super rocket',
        'firebird',
        'goldstar',
        'bluestar',
        's26',
        'b34',
        'minerva'
      ]
    ),
    (
      'Citroen',
      'Traction Avant',
      ARRAY[
        '11b',
        '11bl',
        '7c',
        'type c2',
        'hy78'
      ]
    ),
    (
      'Citroen',
      'DS',
      ARRAY[
        'id21f',
        'id21',
        'cx2200',
        'm35',
        'gs birotor'
      ]
    ),
    (
      'Citroën',
      'DS',
      ARRAY[
        'ds19m',
        '11bl',
        '11 normale',
        '7c',
        'type 7c',
        'type c2',
        'sahara',
        'méhari',
        '2cv6'
      ]
    ),
    (
      'Cord',
      '810',
      ARRAY[
        'l29',
        'westchester',
        'e 300',
        'experimental'
      ]
    ),
    (
      'Cunningham',
      'C-4R',
      ARRAY[
        'c 4r',
        'c3',
        'series v 6',
        'series v 1',
        'series v 4',
        'series v 7',
        'v4'
      ]
    ),
    (
      'Delage',
      'D8',
      ARRAY[
        'd8s',
        'd8c',
        'dmn',
        'dr70',
        'co',
        'co2',
        'type x',
        'type de'
      ]
    ),
    (
      'Delahaye',
      '135',
      ARRAY[
        '135s',
        '148',
        '148l',
        '134n',
        'type 413a',
        'type o',
        'type 43',
        'type 48',
        'whatthehaye'
      ]
    ),
    (
      'DeSoto',
      'Adventurer',
      ARRAY[
        'firesweep',
        'airflow',
        'fire dome'
      ]
    ),
    (
      'De Tomaso',
      'Pantera',
      ARRAY[
        'gt5 s',
        'gts',
        'guara'
      ]
    ),
    (
      'Diamond T',
      '201',
      ARRAY[
        '406',
        't 406',
        '509h',
        'model 80d',
        '931cn',
        '950',
        '951s',
        '222',
        't coe',
        't stake'
      ]
    ),
    (
      'Ducati',
      'SuperSport',
      ARRAY[
        '750 f1',
        'f1 750',
        '750 imola',
        '748rs',
        's4rs',
        '250',
        'ncr'
      ]
    ),
    (
      'Facel Vega',
      'HK500',
      ARRAY[
        'hk 500',
        'ii',
        'fv1',
        'fv3b',
        'facellia',
        'typhoon'
      ]
    ),
    (
      'Factory',
      'Five Mk4',
      ARRAY[
        'five racing mk4',
        'five racing mk2',
        'five shelby',
        'five racing shelby',
        'five racing daytona'
      ]
    ),
    (
      'Factory Five',
      'Mk4 Roadster',
      ARRAY[
        'racing 818c',
        '818c',
        'five racing mkiii',
        'five racing mkii',
        'five gt',
        'five custom',
        'five roadster'
      ]
    ),
    (
      'Imperial',
      'Crown',
      ARRAY[
        'southampton',
        'newport',
        'ch 35',
        'convertible'
      ]
    ),
    (
      'Indian',
      'Chief',
      ARRAY[
        'powerplus',
        'power plus',
        'ftr 750',
        'tri car',
        'motoplane',
        'altoona',
        '440',
        'model 439'
      ]
    ),
    (
      'Infiniti',
      'FX35',
      ARRAY[
        'fx',
        'fx50s'
      ]
    ),
    (
      'Infiniti',
      'G37',
      ARRAY[
        'g37s',
        'g35s',
        'q60s',
        'q50s',
        'q45t',
        'm56'
      ]
    ),
    (
      'Jeep',
      'Commando',
      ARRAY[
        'jeepster'
      ]
    ),
    (
      'Jeep',
      'Wrangler',
      ARRAY[
        'rubicon',
        '392 rubicon',
        '6x6'
      ]
    ),
    (
      'Jeep',
      'CJ-5',
      ARRAY[
        'cj',
        'cj 2a',
        'fc170'
      ]
    ),
    (
      'Kaiser',
      'Darrin',
      ARRAY[
        'jeepster',
        'jeep m715',
        'm715',
        'henry j',
        'dragon',
        'frazer',
        'carabela'
      ]
    ),
    (
      'Kawasaki',
      'H2',
      ARRAY[
        'z1a',
        'kz1000r',
        'h2a',
        'h2b',
        'h2f',
        'kh 500',
        'kx380',
        'kx250a',
        'sr250'
      ]
    ),
    (
      'Lancia',
      'Aurelia',
      ARRAY[
        'b24',
        'b24 s',
        'scorpion',
        'beta montecarlo',
        'beta',
        '2000 coupe',
        'theta'
      ]
    ),
    (
      'LaSalle',
      'Series 50',
      ARRAY[
        '52',
        'model 38',
        'model 345a',
        'series 350',
        'convertible',
        'roadster',
        'business coupe'
      ]
    ),
    (
      'Lexus',
      'GX',
      ARRAY[
        'gx550'
      ]
    ),
    (
      'Lexus',
      'RX',
      ARRAY[
        'rx350',
        'rx330',
        'rx300',
        'rx400h'
      ]
    ),
    (
      'Lexus',
      'RC',
      ARRAY[
        'rcf',
        'rc350'
      ]
    ),
    (
      'Locomobile',
      'Model 48',
      ARRAY[
        'type c',
        'type e',
        'model 38',
        'model m',
        'model h',
        'model e',
        'style 2',
        'style 5'
      ]
    ),
    (
      'Lola',
      'T70',
      ARRAY[
        't260',
        't280',
        't91 00',
        't86 00',
        't500',
        't142',
        't70gt',
        't711',
        'b2k 00',
        'lc89'
      ]
    ),
    (
      'Lotus',
      'Eleven',
      ARRAY[
        'mk iiib',
        'xi',
        '22',
        '311',
        '70',
        'type 81 3',
        'mark 10',
        'stalker'
      ]
    ),
    (
      'McLaren',
      'MP4',
      ARRAY[
        'mp412c',
        'm1a',
        'm1a b',
        'm10b',
        'm12',
        'mso x',
        '720 s',
        '600 lt',
        '570 gt4'
      ]
    ),
    (
      'Mercury',
      'Montclair',
      ARRAY[
        'montego',
        'meteor',
        'monarch',
        'commuter',
        'montery',
        'cylone',
        'pickup',
        'panel truck'
      ]
    ),
    (
      'MG',
      'MGB',
      ARRAY[
        'gt coupé',
        'gt',
        'gt v8',
        'xpower'
      ]
    ),
    (
      'MG',
      'Magnette',
      ARRAY[
        'arnolt',
        'q type',
        'magna',
        'm type',
        'sa',
        'wa',
        'l1'
      ]
    ),
    (
      'MINI',
      'Cooper',
      ARRAY[
        'moke',
        'electric moke',
        'gp',
        '1000',
        '1275 gt',
        'countryman',
        'mk iii',
        'mk vi',
        'mk vii',
        'panel van'
      ]
    ),
    (
      'Mitsubishi',
      'Lancer Evolution',
      ARRAY[
        'evolution',
        'evolution ix',
        'evolution viii',
        'evolution rs'
      ]
    ),
    (
      'Mitsubishi',
      'Pajero',
      ARRAY[
        'delica',
        'minicab',
        'fuso',
        'earthcruiser',
        'asx'
      ]
    ),
    (
      'Morgan',
      '3 Wheeler',
      ARRAY[
        'super sports',
        'sports',
        'f super',
        'mx4',
        'aero',
        'plus'
      ]
    ),
    (
      'Nash',
      'Metropolitan',
      ARRAY[
        'rambler',
        'airflyte',
        'healey',
        'healy',
        'lafayette',
        '697',
        'series 981'
      ]
    ),
    (
      'Nissan',
      'GT-R',
      ARRAY[
        'gtr',
        'pao',
        'president',
        'nv2500',
        'nv3500',
        '1000 l210'
      ]
    ),
    (
      'Peugeot',
      '205',
      ARRAY[
        'bébé',
        'type 99a',
        'type 144a',
        'type 143',
        '407',
        '9hp',
        '2¼hp'
      ]
    ),
    (
      'Porsche',
      '356',
      ARRAY[
        'porsche 356b',
        't 2',
        '3400 s',
        'runge'
      ]
    ),
    (
      'Porsche',
      '911',
      ARRAY[
        'porsche 911',
        'turbo',
        'targa',
        'cabriolet',
        'swb',
        'rsr'
      ]
    ),
    (
      'Ram',
      '1500',
      ARRAY[
        '4500',
        '5500',
        'crew cab',
        'mega cab',
        'mega',
        'havoc'
      ]
    ),
    (
      'Renault',
      '40 CV',
      ARRAY[
        'type c',
        'type bh',
        'type t',
        'type vs',
        'type bx',
        'ax',
        'model jv'
      ]
    ),
    (
      'Ruf',
      'CTR',
      ARRAY[
        'turbo florio',
        'btr2',
        'r turbo',
        'rturbo',
        'rk'
      ]
    ),
    (
      'Saab',
      '900',
      ARRAY[
        '900i',
        '900s',
        'turbo',
        'monte carlo 850',
        '93a',
        '93f',
        '92',
        'ex prototype'
      ]
    ),
    (
      'Saleen',
      'S7',
      ARRAY[
        's281',
        's 281sc',
        'sc281',
        's331',
        'mustang'
      ]
    ),
    (
      'Subaru',
      'WRX',
      ARRAY[
        's209',
        'sti',
        'wrxlimited'
      ]
    ),
    (
      'Suzuki',
      'GSX-R',
      ARRAY[
        'gsxr',
        'rg 500',
        'rgb500',
        'gamma 500',
        't500m',
        't125',
        'bimota sb2'
      ]
    ),
    (
      'Suzuki',
      'Carry',
      ARRAY[
        'da63t',
        'cara'
      ]
    ),
    (
      'Triumph',
      'Bonneville',
      ARRAY[
        'tr6b',
        'tr6ss',
        'trw',
        't100sc',
        'triton',
        'rickman metisse',
        'model h',
        '494 cc'
      ]
    ),
    (
      'Triumph',
      'TR2',
      ARRAY[
        'tr 2'
      ]
    ),
    (
      'Vincent',
      'Black Shadow',
      ARRAY[
        'hrd',
        'black prince',
        'black knight',
        'shadow',
        'series d',
        'grey flash',
        'firefly'
      ]
    ),
    (
      'Volvo',
      '122S',
      ARRAY[
        '123 gt',
        '142e',
        '142s',
        'duett',
        'p210',
        'tp21',
        'c303',
        'c304',
        'vnl',
        '740',
        '960'
      ]
    ),
    (
      'White',
      'Model L',
      ARRAY[
        'm2 half track',
        'model 0 0',
        'model b',
        'model forty',
        'model ga',
        'model tbc',
        'model 702',
        '3000 coe',
        'town car'
      ]
    ),
    (
      'Yamaha',
      'RD350',
      ARRAY[
        'tz700a',
        'rzv500r',
        'dt125',
        'r1',
        'yx600',
        '850',
        'sidewinder',
        'batcycle'
      ]
    )
)
UPDATE public.canonical_models cm
SET
  year_start = NULL,
  year_end = NULL,
  aliases = (
    SELECT array_agg(DISTINCT a ORDER BY a)
    FROM unnest(coalesce(cm.aliases, ARRAY[]::text[]) || ta.add_aliases) AS a
    WHERE a IS NOT NULL AND btrim(a) <> ''
  )
FROM target_additions ta
WHERE lower(cm.make) = lower(ta.make)
  AND lower(cm.canonical_model) = lower(ta.canonical_model);
