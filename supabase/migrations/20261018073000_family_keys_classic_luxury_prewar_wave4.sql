-- Slice 20: Key remaining pre-war, brass-era, coachbuilt, and performance sub-models
-- across Cadillac, Packard, Lincoln, Buick, Chrysler, Plymouth, Dodge, Pontiac, Oldsmobile,
-- Willys, Shelby, GMC, Land Rover, Maserati, Aston Martin, Bugatti, Bentley, Alfa Romeo,
-- Jaguar, Lamborghini, Ferrari, Mercedes-Benz, BMW, Porsche, Ford, Chevrolet, Toyota,
-- Volkswagen, International, and Studebaker.

-- 1) Re-home single-car stub rows in canonical_models into their active parent families
UPDATE public.canonical_models
SET
  canonical_model = '500 TRC',
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
WHERE lower(make) = 'ferrari'
  AND lower(canonical_model) IN (
    '159 s', '196 sp', '225 europa', '225 s', '246 sp', '248 sp', '268 sp', '290 mm',
    '315 s', '335 s', '340 mexico', '400 superfast ii', '410 speciale', '410 sport',
    '412 p', '4.9 superfast', '625 lm', '625 tf', '625 trc', '735 s', '860 monza'
  );

UPDATE public.canonical_models
SET
  canonical_model = '312T',
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
WHERE lower(make) = 'ferrari'
  AND lower(canonical_model) IN (
    '212 f1', '248 f1', '375 f1', '412 t1', '412 t2', '512 f1', '639', '640', '643'
  );

UPDATE public.canonical_models
SET
  canonical_model = 'F12 Berlinetta',
  year_start = NULL,
  year_end = NULL,
  aliases = ARRAY['f12 berlinetta', 'f12', 'f12 tdf', 'f12tdf', 'f12 special series', 'f60 america', 'br20']
WHERE lower(make) = 'ferrari'
  AND lower(canonical_model) IN ('f12 special series', 'f12 tdf (tour de france)', 'f60 america', 'br20');

UPDATE public.canonical_models
SET
  canonical_model = 'Daytona SP3',
  year_start = NULL,
  year_end = NULL,
  aliases = ARRAY['daytona sp3', 'monza sp1', 'monza sp2', 'monza sp1 sp2', '499p', '599xx']
WHERE lower(make) = 'ferrari'
  AND lower(canonical_model) IN ('monza sp1/sp2', '499p', '599xx');

UPDATE public.canonical_models
SET
  canonical_model = 'Type 35',
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
WHERE lower(make) = 'bugatti'
  AND lower(canonical_model) IN (
    'type 10', 'type 16', 'type 18', 'type 19', 'type 2', 'type 21', 'type 24',
    'type 25', 'type 251', 'type 252', 'type 253', 'type 26', 'type 28', 'type 32',
    'type 36', 'type 41', 'type 45', 'type 47', 'type 53', 'type 56', 'type 64',
    'type 68', 'type 73', 'atlantic'
  );

UPDATE public.canonical_models
SET
  canonical_model = '8C',
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
WHERE lower(make) = 'alfa romeo'
  AND lower(canonical_model) IN (
    '8c 2900', 'p2', 'p3', 'bimotore', '158', '159', 'tipo 512', '6c 3000',
    'bat', 'disco volante', 'rz', 'scarabeo', 'scarabeo ii'
  );

-- 2) Clear overly narrow year_start / year_end gates on all families touched below
UPDATE public.canonical_models
SET year_start = NULL, year_end = NULL
WHERE (lower(make), lower(canonical_model)) IN (
  ('alfa romeo', '8c'),
  ('alfa romeo', '6c'),
  ('alfa romeo', '1900'),
  ('alfa romeo', 'giulia'),
  ('aston martin', 'ulster'),
  ('aston martin', 'db2/4'),
  ('aston martin', 'db4'),
  ('aston martin', 'db5'),
  ('aston martin', 'db6'),
  ('aston martin', 'v12 vantage'),
  ('bentley', '3 1/2 litre'),
  ('bentley', 'continental gt'),
  ('bmw', 'r90s'),
  ('bmw', '3.0 csl'),
  ('bmw', '2002'),
  ('bmw', '503'),
  ('bugatti', 'type 35'),
  ('bugatti', 'type 57'),
  ('bugatti', 'eb110'),
  ('buick', 'limited'),
  ('buick', 'special'),
  ('buick', 'roadmaster'),
  ('cadillac', 'series 62'),
  ('cadillac', 'eldorado'),
  ('cadillac', 'fleetwood'),
  ('chevrolet', 'pickup'),
  ('chevrolet', 'bel air'),
  ('chevrolet', 'corvair'),
  ('chrysler', 'imperial'),
  ('chrysler', '300'),
  ('chrysler', 'town & country'),
  ('dodge', 'polara'),
  ('dodge', 'power wagon'),
  ('dodge', 'd-series'),
  ('ferrari', '312t'),
  ('ferrari', '275'),
  ('ferrari', 'f355'),
  ('ferrari', '360'),
  ('ferrari', '512 tr'),
  ('ferrari', '575m'),
  ('ford', 'model t'),
  ('ford', 'model a'),
  ('ford', 'custom'),
  ('ford', 'f-150'),
  ('ford', 'f-550'),
  ('ford', 'escort'),
  ('ford', 'torino'),
  ('gmc', 'pickup'),
  ('gmc', 'sierra'),
  ('gmc', 'caballero'),
  ('harley-davidson', 'el'),
  ('honda', 'cb750'),
  ('honda', 'z50'),
  ('international', 'scout'),
  ('jaguar', 'e-type'),
  ('jaguar', 'ss100'),
  ('jaguar', 'mark ix'),
  ('jaguar', 'c-type'),
  ('lamborghini', 'huracan'),
  ('lamborghini', 'gallardo'),
  ('lamborghini', '350 gt'),
  ('land rover', 'series'),
  ('land rover', 'defender'),
  ('land rover', 'range rover'),
  ('land rover', 'range rover sport'),
  ('lincoln', 'model k'),
  ('lincoln', 'continental'),
  ('lincoln', 'premiere'),
  ('maserati', 'tipo 61 birdcage'),
  ('maserati', '3500 gt'),
  ('maserati', 'granturismo'),
  ('mercedes-benz', 'amg gt'),
  ('mercedes-benz', 'g-class'),
  ('mercedes-benz', 's-class'),
  ('mercedes-benz', 'e-class'),
  ('mercedes-benz', 'sl'),
  ('mercedes-benz', '300'),
  ('mercedes-benz', '280'),
  ('mercedes-benz', '220'),
  ('mercedes-benz', '190'),
  ('nissan', 'roadster'),
  ('nissan', '510'),
  ('nissan', 'pickup'),
  ('nissan', '240sx'),
  ('oldsmobile', '88'),
  ('oldsmobile', '98'),
  ('packard', 'twelve'),
  ('packard', 'super eight'),
  ('packard', 'deluxe eight'),
  ('packard', 'caribbean'),
  ('packard', '120'),
  ('plymouth', 'fury'),
  ('plymouth', 'deluxe'),
  ('pontiac', 'star chief'),
  ('pontiac', 'catalina'),
  ('pontiac', 'chieftain'),
  ('pontiac', 'firebird'),
  ('pontiac', 'lemans'),
  ('porsche', '356'),
  ('porsche', '911'),
  ('porsche', '550'),
  ('rolls-royce', 'silver ghost'),
  ('rolls-royce', 'phantom'),
  ('shelby', 'cobra'),
  ('shelby', 'gt500'),
  ('shelby', 'gt350'),
  ('shelby', 'series 1'),
  ('studebaker', 'commander'),
  ('studebaker', 'hawk'),
  ('toyota', 'land cruiser'),
  ('toyota', 'camry solara'),
  ('toyota', 'pickup'),
  ('volkswagen', 'type 2'),
  ('volkswagen', 'dune buggy'),
  ('willys', 'americar'),
  ('willys', 'jeep wagon'),
  ('willys', 'cj')
);

-- 3) Append 1-to-4 word aliases to existing families across the 30 marques
WITH target_additions(make, canonical_model, add_aliases) AS (
  VALUES
    (
      'Alfa Romeo',
      '8C',
      ARRAY[
        'rls',
        'rl',
        'rl sport'
      ]
    ),
    (
      'Alfa Romeo',
      '6C',
      ARRAY[
        '6c2500',
        '6c2500 ss',
        'gran sport quattroruote'
      ]
    ),
    (
      'Alfa Romeo',
      '1900',
      ARRAY[
        '1900cs',
        '1900l',
        'romeo 1900l',
        't10',
        'autotutto',
        'f12',
        'romeo f12',
        'a12'
      ]
    ),
    (
      'Alfa Romeo',
      'Giulia',
      ARRAY[
        'gta r',
        'gta 1600',
        '1300 gta',
        '1300 gta junior',
        'guilia',
        'guilia sprint gta',
        'gt 1300',
        'tz',
        'tz berlinetta'
      ]
    ),
    (
      'Aston Martin',
      'Ulster',
      ARRAY[
        '1½ litre',
        '1½ litre mark ii',
        '1½ litre sports',
        '15 98',
        '2 0 litre',
        'two litre sports',
        'db1',
        'side valve',
        'db team car',
        'dbr2',
        'martin dbr2'
      ]
    ),
    (
      'Aston Martin',
      'DB2/4',
      ARRAY[
        'db 2 4',
        'db 2',
        '2 4'
      ]
    ),
    (
      'Aston Martin',
      'DB4',
      ARRAY[
        'db 4',
        'dp214'
      ]
    ),
    (
      'Aston Martin',
      'DB6',
      ARRAY[
        'db 6',
        'dbsc',
        'volante lwb',
        'lwb volante'
      ]
    ),
    (
      'Aston Martin',
      'V12 Vantage',
      ARRAY[
        'v12 zagato',
        'valour',
        'valiant'
      ]
    ),
    (
      'Bentley',
      '3 1/2 Litre',
      ARRAY[
        '3 5 liter',
        '3 5l',
        '4¼',
        '4 25 litre',
        '41 2 litre',
        '3 0 litre',
        's 1',
        's 2',
        'vanvooren',
        'zer green'
      ]
    ),
    (
      'Bentley',
      'Continental GT',
      ARRAY[
        'gtc',
        'gtc first edition',
        'continenetal gtc',
        'continential',
        'supersport',
        'bentaga'
      ]
    ),
    (
      'BMW',
      'R90S',
      ARRAY[
        'r32',
        'r37',
        'r62',
        'r63',
        'r17',
        'rs 54',
        'r1200gs'
      ]
    ),
    (
      'BMW',
      '3.0 CSL',
      ARRAY[
        '3 5 csl',
        'csl',
        '3 0',
        '2000ca',
        '2000cs',
        '3200cs',
        'glas 3000'
      ]
    ),
    (
      'BMW',
      '2002',
      ARRAY[
        '2000tii',
        '1600ti',
        '1600',
        '1800',
        '315 1'
      ]
    ),
    (
      'BMW',
      '503',
      ARRAY[
        '501',
        '501 a',
        '501 8'
      ]
    ),
    (
      'Bugatti',
      'Type 35',
      ARRAY[
        'type 23',
        'type 27',
        'type 22',
        'type 22 style',
        'type 38a',
        'type 40a',
        'type 46s',
        'type 73c',
        'type 52',
        'baby ii',
        'brescia'
      ]
    ),
    (
      'Bugatti',
      'EB110',
      ARRAY[
        'eb 110',
        'eb110gt',
        'eb110ss'
      ]
    ),
    (
      'Buick',
      'Limited',
      ARRAY[
        'series 90',
        'model 91',
        '96c',
        'model 96c',
        'series 80'
      ]
    ),
    (
      'Buick',
      'Roadmaster',
      ARRAY[
        'series 60',
        '60 series',
        'series 66c',
        '56s',
        '56c',
        'series 50',
        'estate',
        'estate wagon',
        'sedanette',
        'blackhawk'
      ]
    ),
    (
      'Buick',
      'Special',
      ARRAY[
        'series 40',
        '46s',
        'model 40',
        'model 40 c',
        '44',
        'model 10',
        'model 16',
        'model 17',
        'model 26',
        'model 27',
        'model 24',
        'model 38',
        'model 39',
        'model 43',
        'model 64',
        'model f',
        'model c',
        'model g',
        'model s',
        'master six',
        'standard six'
      ]
    ),
    (
      'Cadillac',
      'Series 62',
      ARRAY[
        '355a',
        '355b',
        '355c',
        '355d',
        'model 355d',
        '353',
        'series 353',
        'model 353',
        '341',
        '341a',
        '341 a',
        '341b',
        'series 341',
        'series 341 b',
        'model 314b',
        'series 85',
        'model 85',
        'series 63',
        'series 70',
        'model 61',
        'model 62',
        'série 62',
        'model 30',
        'model a',
        'model b',
        'model f',
        'model k',
        'model m',
        'model 51',
        'type 55',
        'type 57',
        'v12',
        'calais',
        'mirage',
        'la salle',
        'lasalle'
      ]
    ),
    (
      'Cadillac',
      'Eldorado',
      ARRAY[
        'biarritz',
        'biarritz convertible',
        'castilian',
        'jacqueline'
      ]
    ),
    (
      'Cadillac',
      'Fleetwood',
      ARRAY[
        'miller meteor',
        'broadmoor skyview',
        'parkway'
      ]
    ),
    (
      'Chevrolet',
      'Pickup',
      ARRAY[
        '3200',
        '5700',
        '6400',
        'c60',
        'c50',
        'c5500',
        'k3500',
        'k2500',
        'cst 10',
        'cst10',
        'cst',
        'scottsdale',
        'thriftmaster',
        'napco',
        'coe',
        '1 2 ton',
        'panel truck',
        'panel'
      ]
    ),
    (
      'Chevrolet',
      'Bel Air',
      ARRAY[
        'el morocco',
        'townsman',
        'brookwood',
        'handyman',
        'yeoman',
        'delray',
        'independence'
      ]
    ),
    (
      'Chevrolet',
      'Corvair',
      ARRAY[
        'cosworth vega',
        'vega',
        'monza'
      ]
    ),
    (
      'Chrysler',
      'Imperial',
      ARRAY[
        'ghia',
        'ghia streamline x',
        'ghia super dart',
        'ghia l6 4',
        'cp8',
        'cp',
        'model 70',
        'model 77',
        'cm 6',
        'cm6',
        'ci',
        'b 70',
        'model cd',
        'airstream',
        'st regis'
      ]
    ),
    (
      'Chrysler',
      'Town & Country',
      ARRAY[
        't c woody',
        'woody',
        'own country'
      ]
    ),
    (
      'Dodge',
      'Polara',
      ARRAY[
        'brothers model 30',
        'brothers series 126',
        '30 35',
        'standard six',
        'six',
        'six sedan',
        'royal',
        'royal 500',
        'dr',
        'd24',
        'd2',
        'sierra',
        'aspen'
      ]
    ),
    (
      'Dodge',
      'Power Wagon',
      ARRAY[
        '4dpw',
        'power',
        'wdx',
        'wc56',
        'vc',
        'pilot house',
        'humpback',
        'sweptside',
        'd 100 sweptside',
        'warlock',
        'k20',
        'le 31',
        'b series',
        'coe',
        'travco',
        'travato',
        'solis'
      ]
    ),
    (
      'Ferrari',
      '312T',
      ARRAY[
        'f1 87',
        'f310b',
        'f1'
      ]
    ),
    (
      'Ferrari',
      '275',
      ARRAY[
        '275gts',
        'lusso berlinetta'
      ]
    ),
    (
      'Ferrari',
      'F355',
      ARRAY[
        '355',
        '355 gtb',
        'f 355',
        '355 berlinetta'
      ]
    ),
    (
      'Ferrari',
      '360',
      ARRAY[
        'f360',
        'modena',
        'spider f1'
      ]
    ),
    (
      'Ferrari',
      '512 TR',
      ARRAY[
        '512m',
        'bb'
      ]
    ),
    (
      'Ferrari',
      '575M',
      ARRAY[
        '575gtc',
        '50 maranello'
      ]
    ),
    (
      'Ford',
      'Model T',
      ARRAY[
        'model tt',
        'model k',
        'model b',
        'model c',
        'model r',
        'model n',
        'track t',
        '8n tractor',
        'gpa'
      ]
    ),
    (
      'Ford',
      'Model A',
      ARRAY[
        'model aa',
        'slantback',
        'fordor',
        'phaeton',
        'vicky',
        'deuce',
        'model 67',
        'b100'
      ]
    ),
    (
      'Ford',
      'Custom',
      ARRAY[
        '300',
        'parklane',
        'crestliner',
        'xl',
        'ranch',
        'pinto',
        'anglia'
      ]
    ),
    (
      'Ford',
      'Torino',
      ARRAY[
        'talladega',
        'cobra',
        'cobra hardtop'
      ]
    ),
    (
      'Ford',
      'F-150',
      ARRAY[
        'raptor',
        'raptor r',
        'svt lightning',
        'hennessey venom 775'
      ]
    ),
    (
      'Ford',
      'F-550',
      ARRAY[
        'f550',
        'f650',
        'f 750',
        'cab over',
        'motor coach',
        'minnie winnie'
      ]
    ),
    (
      'Ford',
      'Escort',
      ARRAY[
        'sierra rs500',
        'sierra rs cosworth',
        'lotus cortina',
        'capri rs2600',
        'capri rs 2600',
        'cosworth 95i'
      ]
    ),
    (
      'GMC',
      'Sierra',
      ARRAY[
        '2500',
        '2500hd',
        '2500 hd',
        '3500',
        'denali',
        'denali ultimate',
        'denali xl'
      ]
    ),
    (
      'GMC',
      'Pickup',
      ARRAY[
        'c 10',
        '3100',
        '3800',
        '1000',
        '5 window',
        'carryall',
        'k 20',
        'v3500',
        'r15',
        's15',
        'topkick',
        'kodiak',
        'c7500',
        '4500',
        'g3500',
        'p100',
        'pb2500',
        'napco',
        'coe hauler',
        'stake truck',
        'stakeside truck',
        'motorhome',
        'eleganza ii',
        'birchaven',
        'dukw',
        '4108'
      ]
    ),
    (
      'GMC',
      'Caballero',
      ARRAY[
        'sprint'
      ]
    ),
    (
      'Harley-Davidson',
      'EL',
      ARRAY[
        'e',
        've',
        'kr',
        'model d',
        'model c',
        '16j',
        '7b',
        '8',
        'fltc',
        'fatboy',
        'motorcycle'
      ]
    ),
    (
      'Honda',
      'CB750',
      ARRAY[
        'rc174',
        'rc 500',
        'cb1100r',
        'cb350g',
        'cb77',
        'cb450d',
        'rvf750r',
        'rc45',
        'cr110',
        'cr93',
        'ns750',
        'gb 500',
        'gl 1000',
        'dream'
      ]
    ),
    (
      'Honda',
      'Z50',
      ARRAY[
        'qa50',
        'mr50',
        'zb50',
        's90',
        'sl70',
        'sl100',
        'tr200',
        'trx250r',
        'trx',
        'cr125',
        'cr500',
        'xl250',
        'vamos',
        'ra106'
      ]
    ),
    (
      'International',
      'Scout',
      ARRAY[
        'pangea',
        'gm515',
        'cv515',
        '405',
        '4000',
        '7400',
        'terrastar',
        '3200',
        'm5 half track',
        'model a',
        'model f',
        'charette',
        'd 2',
        'd 300',
        'c 1',
        'a110',
        'b 100',
        'ma1200',
        '856',
        '1468',
        '1206',
        '1256',
        '826'
      ]
    ),
    (
      'Jaguar',
      'E-Type',
      ARRAY[
        'type e',
        'e types',
        'ke series 1 coupe',
        'x ke',
        'series 1',
        'v12 2 2'
      ]
    ),
    (
      'Jaguar',
      'Mark IX',
      ARRAY[
        'mk5',
        'mkv',
        'mk iv',
        'mark iv',
        'mark x',
        'mark viim',
        '2½ litre',
        'ss 2 1 2',
        'ss 2½ litre',
        'ssi'
      ]
    ),
    (
      'Jaguar',
      'C-Type',
      ARRAY[
        'xj13',
        'xk120c',
        'xk15o',
        'kougar',
        'ol yaller'
      ]
    ),
    (
      'Lamborghini',
      '350 GT',
      ARRAY[
        '2r',
        '2r tractor',
        '1r',
        '1r tractor',
        'model 1r',
        'dl25',
        'lamborghinetta',
        '2241r',
        '230r',
        '5c',
        'tractor',
        'silhouette'
      ]
    ),
    (
      'Lamborghini',
      'Huracan',
      ARRAY[
        'huracán',
        'sterrato'
      ]
    ),
    (
      'Lamborghini',
      'Gallardo',
      ARRAY[
        'lp560',
        'edizione tecnica',
        'gallado'
      ]
    ),
    (
      'Land Rover',
      'Series',
      ARRAY[
        'ries iia',
        'ies ii',
        'ries iii',
        'santana'
      ]
    ),
    (
      'Land Rover',
      'Defender',
      ARRAY[
        '5 speed',
        'speed',
        'peed',
        'turbodiesel 5 speed',
        'bodiesel 5 speed',
        '0tdi',
        'tdi 5 speed',
        'ckup',
        '127',
        'county',
        '4x4',
        '2 door 5 speed',
        '2 door turbodiesel'
      ]
    ),
    (
      'Land Rover',
      'Range Rover',
      ARRAY[
        'classic',
        'classic 5 speed',
        'rover supercharged',
        'rover hse',
        '4x4 estate',
        'chamois'
      ]
    ),
    (
      'Land Rover',
      'Range Rover Sport',
      ARRAY[
        'rover sport supercharged',
        'rover sport hse'
      ]
    ),
    (
      'Lincoln',
      'Model K',
      ARRAY[
        'k',
        'l',
        'l series',
        '523',
        '207a',
        'indianapolis'
      ]
    ),
    (
      'Lincoln',
      'Continental',
      ARRAY[
        'mark ii',
        'mk ii',
        'continential',
        'batmobile',
        'versailles',
        'lido',
        'club coupe',
        'limousine',
        'towncar'
      ]
    ),
    (
      'Maserati',
      'Tipo 61 Birdcage',
      ARRAY[
        '6cm',
        'tipo 6cm',
        '4cm',
        'tipo 4cm',
        '8c 3000',
        '8c 26m',
        '4cs 1100 1500',
        '350s',
        '151'
      ]
    ),
    (
      'Maserati',
      '3500 GT',
      ARRAY[
        '5000gt',
        '3500gti'
      ]
    ),
    (
      'Maserati',
      'Granturismo',
      ARRAY[
        'granturisimo',
        'mc sportline',
        'gt'
      ]
    ),
    (
      'Mercedes-Benz',
      'AMG GT',
      ARRAY[
        'gt63',
        'gt63 s',
        'gt63 pro',
        'gt63c4',
        'gt53',
        'amg gt63',
        'amg gt53',
        'amg gtr',
        'gts edition 1',
        'amg'
      ]
    ),
    (
      'Mercedes-Benz',
      'G-Class',
      ARRAY[
        'g580',
        'g350d',
        '350gd',
        '200ge',
        'w463',
        'brabus 800'
      ]
    ),
    (
      'Mercedes-Benz',
      'S-Class',
      ARRAY[
        'maybach s680',
        'maybach gls',
        'maybach s',
        'maybach',
        's650',
        's450',
        '600sec',
        'cl63'
      ]
    ),
    (
      'Mercedes-Benz',
      'E-Class',
      ARRAY[
        'e60',
        'e60 amg',
        'e63s',
        '230ce'
      ]
    ),
    (
      'Mercedes-Benz',
      'SL',
      ARRAY[
        '600sl',
        'sl680',
        'sl43',
        '450 slc',
        '350slc',
        'amg slc43'
      ]
    ),
    (
      'Mercedes-Benz',
      'GL',
      ARRAY[
        'gle63',
        'gle 63',
        'amg gle63',
        'amg gle53',
        'amg gle43',
        'gle350',
        'glc 63',
        'glc63',
        'amg glc 63',
        'amg glc 43',
        'cla45'
      ]
    ),
    (
      'Mercedes-Benz',
      '280',
      ARRAY[
        '280s',
        '250',
        '250s',
        '250 se',
        '350sdl'
      ]
    ),
    (
      'Mercedes-Benz',
      '220',
      ARRAY[
        '220d',
        '200d',
        '190b',
        '170vs',
        '170a',
        '230b',
        '230n',
        '200 w21',
        '200b',
        '300a',
        '10 40 65hp',
        '22 50hp',
        'ideal 7hp',
        'o 319 b',
        '0319b'
      ]
    ),
    (
      'Mercedes-Benz',
      '190',
      ARRAY[
        'e190'
      ]
    ),
    (
      'Nissan',
      'Roadster',
      ARRAY[
        '2000',
        '1600'
      ]
    ),
    (
      'Nissan',
      '510',
      ARRAY[
        'bluebird',
        's cargo'
      ]
    ),
    (
      'Nissan',
      'Pickup',
      ARRAY[
        '720',
        'hardbody',
        'atlas',
        'nv 3500'
      ]
    ),
    (
      'Nissan',
      '240SX',
      ARRAY[
        'silvia',
        'stagea'
      ]
    ),
    (
      'Oldsmobile',
      '88',
      ARRAY[
        'french front',
        'model n',
        'model t',
        '5hp',
        'model 46',
        'l37',
        'f 40',
        'series 60',
        'series 66',
        'series 70',
        'series 76',
        '76',
        'futuramic',
        'holiday',
        'holiday j2'
      ]
    ),
    (
      'Oldsmobile',
      '98',
      ARRAY[
        '98 starfire',
        'series 90'
      ]
    ),
    (
      'Packard',
      'Twelve',
      ARRAY[
        '12',
        '1106',
        'twin 6',
        '1401',
        '1601'
      ]
    ),
    (
      'Packard',
      'Super Eight',
      ARRAY[
        '1 38',
        '1 48',
        '3 38',
        'model g',
        'model ud',
        'model s',
        'model e',
        '30hp',
        '443',
        '1101',
        '900',
        '902',
        '236',
        'model 223',
        'model 243',
        'single six',
        '8 roadster',
        'third series',
        'series 22',
        '22nd series',
        'town car'
      ]
    ),
    (
      'Packard',
      'Caribbean',
      ARRAY[
        'carribbean'
      ]
    ),
    (
      'Packard',
      '120',
      ARRAY[
        '120c'
      ]
    ),
    (
      'Plymouth',
      'Fury',
      ARRAY[
        'belmont',
        'volare'
      ]
    ),
    (
      'Plymouth',
      'Deluxe',
      ARRAY[
        'pt105',
        'pt 50',
        'pt 57',
        'pd',
        'pb',
        'model pb',
        'pa',
        '5 window coupe',
        'business coupe'
      ]
    ),
    (
      'Pontiac',
      'Chieftain',
      ARRAY[
        'sky chief',
        'chieftan',
        'strato chief',
        'series 601',
        'series 603',
        'model 302',
        'eight',
        'club de mer'
      ]
    ),
    (
      'Pontiac',
      'Catalina',
      ARRAY[
        '2 2',
        '22',
        'catalina 22',
        'executive',
        'bonnevile',
        'starfire'
      ]
    ),
    (
      'Pontiac',
      'Firebird',
      ARRAY[
        'firehawk',
        'mera',
        'soltice'
      ]
    ),
    (
      'Pontiac',
      'LeMans',
      ARRAY[
        'beaumont',
        'acadian',
        'custom s'
      ]
    ),
    (
      'Porsche',
      '356',
      ARRAY[
        '356a',
        '356b',
        'super 90',
        'convertible d',
        '597',
        '597 jagdwagen',
        'junior',
        'junior 108',
        'diesel junior'
      ]
    ),
    (
      'Porsche',
      '911',
      ARRAY[
        '901',
        '911swb',
        '911gt3',
        'gt 3 rs',
        'turbo s',
        'turbo 3 6',
        '36 turbo',
        '930s',
        'm491',
        'ruf ctr2',
        'ruf rgt',
        'ruf btr',
        'rgt',
        '969',
        'gembella',
        'gt america'
      ]
    ),
    (
      'Rolls-Royce',
      'Silver Ghost',
      ARRAY[
        '40 50cv',
        'p 1',
        'newmarket',
        'roadster brewster',
        'speed wagon'
      ]
    ),
    (
      'Shelby',
      'Cobra',
      ARRAY[
        'dragon snake',
        'corbra',
        '427 super snake',
        '427 sc',
        'mkiii',
        'mk3',
        'five racing mk3',
        'five racing mk4',
        'five mk4',
        'five racing type 65',
        'superformance mkii',
        'gt40 mkii',
        'gt40 mk2',
        'aurora v8'
      ]
    ),
    (
      'Shelby',
      'GT500',
      ARRAY[
        'exp500',
        'gt500e',
        'gt500c',
        'gte',
        'f 150',
        'f150'
      ]
    ),
    (
      'Shelby',
      'GT350',
      ARRAY[
        'gt350sr',
        'group ii'
      ]
    ),
    (
      'Shelby',
      'Series 1',
      ARRAY[
        'series one'
      ]
    ),
    (
      'Studebaker',
      'Commander',
      ARRAY[
        'special indy car',
        'gardner special',
        'garford g7',
        'j5',
        'coupe express',
        'transtar',
        'starlight',
        'starliner',
        'skyhawk',
        'land cruiser',
        'model e',
        'model g',
        'model 54',
        'ice princess'
      ]
    ),
    (
      'Toyota',
      'Land Cruiser',
      ARRAY[
        'mega cruiser',
        'fj 45lv'
      ]
    ),
    (
      'Toyota',
      'Camry Solara',
      ARRAY[
        'solara',
        'sera',
        'tf102'
      ]
    ),
    (
      'Toyota',
      'Pickup',
      ARRAY[
        'stout'
      ]
    ),
    (
      'Volkswagen',
      'Type 2',
      ARRAY[
        'double cab',
        'camper',
        'campmobile',
        'pickup'
      ]
    ),
    (
      'Volkswagen',
      'Dune Buggy',
      ARRAY[
        'speedster replica',
        'porsche speedster replica',
        '356 replica',
        'type 166',
        'schwimmwagen',
        'beutler'
      ]
    ),
    (
      'Willys',
      'Americar',
      ARRAY[
        'custom',
        'street rod',
        'pro street',
        '6 90',
        'model six',
        '38',
        'roadster'
      ]
    ),
    (
      'Willys',
      'Jeep Wagon',
      ARRAY[
        'wagon',
        'panel delivery',
        'dj 3a'
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
