-- Slice 18: Key 50+ remaining collector marques with >= $1M confirmed-sale volume
-- (Osca, Miller, Pope-Hartford, Dallara, March, Cooper, Williams, Brabham, Scarab, Matra,
-- Kurtis, Kurtis-Kraft, Watson, Radical, Rover, Tatra, Opel, Ghia, Monteverdi, Healey,
-- Excalibur, Devin, Norton, BSA, Bultaco, MV Agusta, Moto Guzzi, Excelsior, Winnebago,
-- Prevost, Peterbilt, Kenworth, Mack, John Deere, Daihatsu, Hyundai, Willys-Overland,
-- Benz, Voisin, Isotta, Panhard-Levassor, Panhard Et Levassor, Thomas Flyer, De Dion Bouton,
-- Stanley, Winton, Darracq, Stevens-Duryea, Lorraine-Dietrich, Speedwell, Rambler, Pierce,
-- REO, Wolseley, Crosley, Napier, Knox, Delaunay-Belleville, Kissel, Ruxton, Factory,
-- Era, Kirkham, Eagle, Mercedes-Simplex, Stearns) and expand existing families.

-- 1) Insert new canonical families first (idempotent on make + canonical_model)
WITH new_families(id, make, canonical_model, year_start, year_end, aliases) AS (
  VALUES
    (
      '00000000-0000-4000-f000-000000000289'::uuid,
      'Osca',
      '1600 GT',
      1947,
      NULL::integer,
      ARRAY[
        '1600 gt',
        '1600 gt2',
        'mt4',
        'tipo s 273',
        'coupe fl26',
        'fl26',
        'special',
        '750'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000290'::uuid,
      'Miller',
      'Model 91',
      1915,
      NULL::integer,
      ARRAY[
        'model 91',
        '91',
        '183',
        '183 convertible',
        'tnt',
        'tribute',
        'wilbur shaw special',
        '122',
        'indy'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000291'::uuid,
      'Pope-Hartford',
      'Model 29',
      1900,
      NULL::integer,
      ARRAY[
        'model 29',
        'model w',
        'model w 50 hp',
        'model 33',
        'model 31',
        'model b',
        'portola roadster',
        '50 hp'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000292'::uuid,
      'Isotta',
      'Tipo 8A',
      1900,
      NULL::integer,
      ARRAY[
        'fraschini tipo 8a',
        'fraschini tipo 8a s',
        'fraschini tipo cabriolet',
        'fraschini lebaron 8a s',
        'fraschini 8a ss',
        'fraschini tipo fenc',
        'tipo 8a',
        '8a'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000293'::uuid,
      'Dallara',
      'DW12',
      1972,
      NULL::integer,
      ARRAY[
        'dw12',
        'dw12 honda',
        'mps',
        'exp',
        'exp barchetta',
        'ir 00',
        'oldsmobile ir 00',
        'oldsmobile aurora',
        'ip3',
        'ir2',
        'indycar',
        'stradale',
        'sp1',
        'f189',
        'f190',
        'f191',
        'f192'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000294'::uuid,
      'March',
      '86C',
      1969,
      NULL::integer,
      ARRAY[
        '86c',
        '85g',
        '82g',
        '73a',
        '84g',
        '84c',
        '87c',
        '88c',
        '83c',
        '81c',
        '83s',
        '87b',
        '722',
        '741',
        '742',
        '752',
        'cosworth',
        'formula'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000295'::uuid,
      'Cooper',
      'Monaco',
      1946,
      NULL::integer,
      ARRAY[
        'monaco',
        'climax monaco',
        't 49',
        't49',
        't61',
        'type 61',
        't55',
        't39',
        'type 51',
        't51',
        'type 45',
        't45',
        'type 59',
        't59',
        'zerex oldsmobile',
        'chevrolet',
        'climax'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000296'::uuid,
      'Williams',
      'FW14B',
      1977,
      NULL::integer,
      ARRAY[
        'fw14b',
        'renault fw14b',
        'fw20',
        'fw13b',
        'renault fw13b',
        'fw21',
        'supertec renault fw21'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000297'::uuid,
      'Brabham',
      'BT33',
      1961,
      NULL::integer,
      ARRAY[
        'bt33',
        'cosworth ford bt33',
        'bt5',
        'bt8',
        'bt11',
        'bt19',
        'bt20',
        'bt23',
        'bt24',
        'bt26',
        'bt30',
        'bt44',
        'bt45',
        'bt46',
        'bt49',
        'bt52'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000298'::uuid,
      'Scarab',
      'Mk I',
      1958,
      NULL::integer,
      ARRAY[
        'mk1',
        'mk 1',
        'mk i',
        'formula 1',
        'recreation',
        'sports racer'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000299'::uuid,
      'Matra',
      'MS670',
      1964,
      NULL::integer,
      ARRAY[
        'ms670b',
        'simca ms670b',
        'ms640',
        'djet',
        'jet 6',
        'sports jet 6',
        'murena',
        'bagheera'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000300'::uuid,
      'Kurtis',
      '500S',
      1938,
      NULL::integer,
      ARRAY[
        '500s',
        '500 ss',
        '500kk',
        'kk2000',
        'kraft kk2000',
        'sports car',
        'tommy lee speedster',
        'midget',
        'midget race car',
        'open race car'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000301'::uuid,
      'Kurtis-Kraft',
      '500S',
      1938,
      NULL::integer,
      ARRAY[
        'midget racer',
        'midget',
        'k4000',
        '500c',
        '500s',
        'sports racer',
        'indy car',
        'offenhauser'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000302'::uuid,
      'Watson',
      'Indy Roadster',
      1950,
      NULL::integer,
      ARRAY[
        'offenhauser',
        'indianapolis roadster',
        'bob estes special',
        'roadster custom',
        'coral harbour special',
        'two seater replica roadster'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000303'::uuid,
      'Radical',
      'SR3',
      1997,
      NULL::integer,
      ARRAY[
        'sr3',
        'sr3 xx',
        'sr3xx',
        'sr3 rsx',
        'sr3 rs',
        'sr3 xxr',
        'sr3 supersport',
        'sr8',
        'sr8 rx',
        'sr10',
        'rxc',
        'rxc gt3',
        'rxc 600r',
        'rxc v6',
        'rapture'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000304'::uuid,
      'Rover',
      'Mini',
      1904,
      NULL::integer,
      ARRAY[
        'mini',
        'mini cooper',
        'mini cabriolet',
        'mini moke',
        'mini mayfair',
        'mini sprite',
        'mini city',
        '3500',
        '3500s',
        '2000',
        '2000tc',
        '2000 tc',
        '2200tc',
        'p4',
        'p5',
        'p5b',
        'p6',
        'sd1',
        '3 litre',
        '75',
        '90',
        '100',
        '105s',
        '110'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000305'::uuid,
      'Tatra',
      'T87',
      1920,
      NULL::integer,
      ARRAY[
        't87',
        't77a',
        't77',
        't97',
        '2 603',
        '603',
        't 600',
        'tatraplan',
        'ot 810'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000306'::uuid,
      'Opel',
      'GT',
      1900,
      NULL::integer,
      ARRAY[
        'gt',
        'kadett',
        'manta',
        'speedster',
        'lotus omega',
        'omega',
        'neander',
        '14 38 ps'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000307'::uuid,
      'Ghia',
      '450 SS',
      1950,
      NULL::integer,
      ARRAY[
        '450 ss',
        '450ss',
        'l6 4',
        '1500 gt'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000308'::uuid,
      'Monteverdi',
      'High Speed 375',
      1967,
      NULL::integer,
      ARRAY[
        'high speed 375 l',
        '375 s',
        '375s',
        '375 4',
        '375 l',
        '375l',
        'hai 450 ss'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000309'::uuid,
      'Healey',
      'Silverstone',
      1946,
      NULL::integer,
      ARRAY[
        'silverstone',
        'elliott',
        'tickford',
        'abbott',
        'duncan',
        'westland'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000310'::uuid,
      'Excalibur',
      'Phaeton',
      1965,
      NULL::integer,
      ARRAY[
        'phaeton',
        'roadster',
        'series ii',
        'series iii',
        'series iv',
        'series v',
        'ssk',
        'ss',
        'rs',
        'cobra'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000311'::uuid,
      'Devin',
      'SS',
      1954,
      NULL::integer,
      ARRAY[
        'ss',
        'c',
        'd',
        'z',
        'triumph tr3 devin'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000312'::uuid,
      'Norton',
      'Commando',
      1920,
      NULL::integer,
      ARRAY[
        'commando',
        'commando 850',
        '850 commando',
        'commando 750',
        'combat commando',
        'commando 961',
        'manx',
        'manx 40m',
        'manx 30m',
        'manx 500',
        'dominator',
        'dominator 88',
        'dominator 99',
        'atlas',
        'atlas 750',
        'international',
        'model 30',
        'p11',
        'p11a',
        'es2',
        'commander'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000313'::uuid,
      'BSA',
      'Gold Star',
      1910,
      NULL::integer,
      ARRAY[
        'gold star',
        'rocket gold star',
        'a10',
        'a10 super rocket',
        'a65',
        'spitfire',
        'spitfire scrambler',
        'lightning',
        'thunderbolt',
        '441',
        '441 victor',
        'victor',
        'b44',
        'b50',
        'b31',
        'b33',
        'm20'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000314'::uuid,
      'Bultaco',
      'Pursang',
      1958,
      NULL::integer,
      ARRAY[
        'pursang',
        'pursang 250',
        'pursang 360',
        'sherpa',
        'matador',
        'astro',
        'metralla',
        'frontera',
        'alpina'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000315'::uuid,
      'MV Agusta',
      '750 S',
      1945,
      NULL::integer,
      ARRAY[
        '750 sport',
        '750 s',
        '750 s america',
        'agusta f4',
        'f4',
        'agusta brutale',
        'brutale',
        '175 css',
        '350',
        '125'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000316'::uuid,
      'Moto Guzzi',
      'V7 Sport',
      1921,
      NULL::integer,
      ARRAY[
        'v7',
        'v7 sport',
        'c2v',
        'sport 13',
        'sport 14',
        'sport 15',
        'falcone',
        'le mans',
        '850 le mans',
        'california',
        'ambassador',
        'eldorado',
        'mgx 21',
        '500gt'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000317'::uuid,
      'Excelsior',
      'Super X',
      1907,
      NULL::integer,
      ARRAY[
        'super x',
        'twin',
        'single',
        'auto cycle',
        'aerothrust',
        'board track racer',
        'model 19',
        'v twin',
        'manxman'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000318'::uuid,
      'Winnebago',
      'Revel',
      1966,
      NULL::integer,
      ARRAY[
        'revel',
        'revel 4x4',
        'minnie winnie',
        '26t minnie winnie',
        'view',
        'navion',
        'era',
        'paseo',
        'solis',
        'vista',
        'itasca',
        'adventurer',
        'aspect',
        'brave',
        'chieftain',
        'd22',
        'lesharo'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000319'::uuid,
      'Prevost',
      'H3-45',
      1960,
      NULL::integer,
      ARRAY[
        'h3 45',
        'h3',
        'marathon',
        'liberty',
        'liberty xlii',
        'xl 40',
        'x3 45'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000320'::uuid,
      'Peterbilt',
      '359',
      1939,
      NULL::integer,
      ARRAY[
        '359',
        '379',
        '389',
        '350',
        '351',
        '352',
        '352h',
        '352a',
        '362',
        '348',
        '335',
        '330',
        '579',
        '281',
        '210',
        'custom pickup'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000321'::uuid,
      'Kenworth',
      'W900',
      1923,
      NULL::integer,
      ARRAY[
        'w900',
        'w900a',
        'w925',
        'bullnose',
        'k100',
        'k125',
        'k825',
        't2000',
        't700',
        't270',
        'coe',
        'fire truck'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000322'::uuid,
      'Mack',
      'B61',
      1900,
      NULL::integer,
      ARRAY[
        'b61',
        'b 61',
        'model b61',
        'b53s',
        'b95',
        'ltl',
        'lft',
        'lf',
        'ab',
        'ac',
        'model ac',
        'fire truck'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000323'::uuid,
      'John Deere',
      '4020',
      1918,
      NULL::integer,
      ARRAY[
        '4020',
        '4230',
        '4320',
        '4240',
        '4030',
        '4620',
        '5020',
        '6030',
        '3020',
        '630',
        '730',
        'styled l',
        'la',
        'g',
        'a',
        'b',
        '62',
        'ao',
        'aos',
        'gpwt'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000324'::uuid,
      'Daihatsu',
      'Hijet',
      1960,
      NULL::integer,
      ARRAY[
        'hijet',
        'midget ii',
        'midget',
        'rocky',
        'taft',
        'copen',
        'mira',
        'charade'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000325'::uuid,
      'Hyundai',
      'Equus',
      1986,
      NULL::integer,
      ARRAY[
        'equus',
        'genesis',
        'genesis coupe',
        'veloster n',
        'veloster',
        'ioniq 5 n',
        'ioniq 5',
        'tiburon',
        'sonata',
        'santa fe'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000326'::uuid,
      'Willys-Overland',
      'Jeepster',
      1908,
      NULL::integer,
      ARRAY[
        'jeepster',
        'cj 2a',
        'cj 3a',
        'pickup',
        'station wagon',
        'whippet',
        'knight'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000327'::uuid,
      'Benz',
      'Patent-Motorwagen',
      1886,
      NULL::integer,
      ARRAY[
        'patent motorwagen replica',
        'patent motorwagen',
        '75 105hp',
        'prinz heinrich',
        '50hp victoria',
        '5hp victoria',
        'velo',
        '18 45',
        '10hp',
        'ideal',
        '8 20 hp',
        '82 200 hp'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000328'::uuid,
      'Voisin',
      'C25',
      1919,
      NULL::integer,
      ARRAY[
        'c20',
        'c25',
        'c25 clairiere',
        'c14',
        'c23',
        'c24'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000329'::uuid,
      'Panhard-Levassor',
      'Type X',
      1890,
      NULL::integer,
      ARRAY[
        'm4e',
        'type x',
        'type q',
        'type a',
        'type b',
        'dynamic',
        '24 ct'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000330'::uuid,
      'Panhard Et Levassor',
      'Type Q',
      1890,
      NULL::integer,
      ARRAY[
        'type q',
        'type x',
        'type a',
        'type b',
        'm4e',
        'dynamic',
        '10hp',
        '15hp',
        '16hp',
        '24hp'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000331'::uuid,
      'Thomas Flyer',
      'Model 36',
      1902,
      NULL::integer,
      ARRAY[
        'model 36',
        '50hp',
        'model k',
        'model f',
        'model mc',
        'flyabout',
        '6 70',
        '4 60hp'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000332'::uuid,
      'De Dion Bouton',
      'Motorette',
      1895,
      NULL::integer,
      ARRAY[
        'motorette',
        '5hp motorette',
        'type ax',
        '6hp',
        '8hp',
        '4 1 2hp',
        'type y',
        'type v',
        'type g',
        'type dx',
        'model v',
        'model y',
        'model z',
        'model r',
        'model q',
        'model g',
        'vis a vis',
        'tricycle'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000333'::uuid,
      'Stanley',
      'Steamer',
      1899,
      NULL::integer,
      ARRAY[
        'steamer',
        'model m',
        'model r',
        'model 810',
        'model f',
        'model z',
        'model 60',
        'model 61',
        'model 63',
        'model ex',
        'model k',
        'model 262',
        'steam runabout',
        'mountain wagon',
        'special 30hp'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000334'::uuid,
      'Winton',
      'Six',
      1897,
      NULL::integer,
      ARRAY[
        'model 17 b',
        '17b',
        'model 17 c',
        'model 17a',
        'model 33',
        'model six 33',
        'six',
        '20hp',
        '22hp',
        'model 15',
        '2 cylinder',
        'runabout 8hp',
        'seven passenger touring'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000335'::uuid,
      'Darracq',
      '12 HP',
      1898,
      NULL::integer,
      ARRAY[
        '24hp',
        'model jj',
        'model 40 60',
        'model h',
        '12hp',
        'flying fifteen',
        '9hp',
        '8hp',
        '6 1 2hp',
        't120',
        'perfecta',
        'model c',
        'model g',
        '200 hp'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000336'::uuid,
      'Stevens-Duryea',
      'Model Y',
      1901,
      NULL::integer,
      ARRAY[
        'model y',
        'model x',
        'model u',
        'aa',
        'model xxx',
        'model l',
        'model r'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000337'::uuid,
      'Lorraine-Dietrich',
      'B3-6',
      1900,
      NULL::integer,
      ARRAY[
        'b3 6',
        'model b3 6',
        '16 4 liter',
        'cr2',
        'fj 24'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000338'::uuid,
      'Speedwell',
      'Model 12',
      1907,
      NULL::integer,
      ARRAY[
        'model 12 h',
        '12 j',
        'speed car',
        'morris mini cooper'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000339'::uuid,
      'Rambler',
      'American',
      1902,
      NULL::integer,
      ARRAY[
        'american',
        'classic',
        'marlin',
        'ambassador',
        'rebel',
        'model 65',
        'model 83',
        'model c',
        'model 1',
        'type 3',
        '7hp',
        'model h'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000340'::uuid,
      'Pierce',
      'Four',
      1901,
      NULL::integer,
      ARRAY[
        'four',
        '696 cc four',
        'great arrow',
        'model 8m',
        'motorette',
        'single',
        'arrow',
        'arrow model 42',
        'arrow 1240a'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000341'::uuid,
      'REO',
      'Speedwagon',
      1905,
      NULL::integer,
      ARRAY[
        'model a',
        'royale',
        'flying cloud',
        'speedwagon',
        'speed wagon',
        'five passenger',
        'gentleman'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000342'::uuid,
      'Wolseley',
      '10 HP',
      1899,
      NULL::integer,
      ARRAY[
        '10hp',
        '7 1 2hp',
        '12 hp',
        '6hp',
        'siddeley',
        'hornet',
        '1500',
        '4 44',
        '6 80'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000343'::uuid,
      'Crosley',
      'Hotshot',
      1939,
      NULL::integer,
      ARRAY[
        'hotshot',
        'hot shot',
        'super',
        'super station wagon',
        'station wagon',
        'convertible',
        'sedan',
        'pickup',
        'farm o road',
        'hook and ladder',
        'fire',
        'le mans',
        'skorpion'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000344'::uuid,
      'Napier',
      'Type 23',
      1900,
      NULL::integer,
      ARRAY[
        '15hp',
        '45hp',
        'type 23',
        'type 44',
        '30 35hp',
        '40 50hp',
        't75',
        'blue bird'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000345'::uuid,
      'Knox',
      'Tudor',
      1900,
      NULL::integer,
      ARRAY[
        '16 18hp',
        'tudor',
        'touraine',
        'type o',
        'model r',
        'raceabout'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000346'::uuid,
      'Delaunay-Belleville',
      'Type O6',
      1904,
      NULL::integer,
      ARRAY[
        'type o6',
        '25hp',
        'hb6',
        'omnibus',
        '1a4',
        'type h4',
        'model baa'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000347'::uuid,
      'Kissel',
      'Gold Bug',
      1906,
      NULL::integer,
      ARRAY[
        '8 75',
        '6 55',
        'gold bug',
        'kar model d 11',
        'kar model d 10',
        'model 6 45',
        '8 126',
        'model 8 95',
        'white eagle'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000348'::uuid,
      'Ruxton',
      'Model C',
      1929,
      NULL::integer,
      ARRAY[
        'model c',
        'prototype muller',
        '4 door sedan',
        'roadster'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000349'::uuid,
      'Factory',
      'Five Mk4',
      1995,
      NULL::integer,
      ARRAY[
        'five racing gtm',
        'five gtm',
        'five racing mk4',
        'five mk4',
        'five mkiv',
        'five mkiii',
        'five mkii',
        'five mk2',
        'five racing mk2',
        'five racing mk3',
        'five type 65',
        'five racing type 65',
        'five 818s',
        'five 818c',
        'five 818',
        'five 818r',
        'five racing 818c',
        'five racing 818s',
        'five cobra',
        'five racing cobra',
        'five shelby cobra',
        'five racing shelby daytona',
        'five racing daytona',
        'five 33 ford',
        'five roadster',
        'five racing roadster'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000350'::uuid,
      'Era',
      '427 S/C',
      1962,
      NULL::integer,
      ARRAY[
        'cobra replica',
        'cobra',
        'cobra 427',
        'shelby 427 cobra',
        'shelby cobra replica',
        '1965 cobra',
        'gt',
        'gt gulf',
        'a type',
        'b type',
        'd type',
        'e type'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000351'::uuid,
      'Kirkham',
      '427 KMS/SC',
      1962,
      NULL::integer,
      ARRAY[
        '427 kms sc',
        '427 s c cobra',
        'roadster 427sc',
        'shelby 427 cobra replica',
        'shelby daytona replica',
        'motorsports cobra replica',
        'cobra'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000352'::uuid,
      'Eagle',
      'Talon',
      1966,
      NULL::integer,
      ARRAY[
        'talon',
        'talon tsi',
        'offenhauser',
        'chevrolet indy car',
        '70',
        'model 10',
        'summit',
        'vision',
        'premier'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000353'::uuid,
      'Land',
      'Rover Defender',
      1948,
      NULL::integer,
      ARRAY[
        'rover defender 90',
        'rover defender 110',
        'rover defender 130',
        'rover defender ut',
        'rover range rover',
        'rover series iia',
        'rover 109 series iia',
        'rover 88 series iii',
        'rover 110 v8',
        'rover discovery ii',
        'rover lr4'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000354'::uuid,
      'Fiat',
      'Abarth 750',
      1950,
      NULL::integer,
      ARRAY[
        'abarth 750',
        'abarth 750 gt',
        'abarth 750 zagato',
        'abarth 750 record monza',
        'abarth 750 ss',
        'abarth 750s',
        'abarth double bubble',
        'abarth 1000',
        'abarth 1000sp',
        'abarth 1000 tc',
        'abarth 1000 otr',
        'abarth monomille',
        'abarth tc',
        'abarth 695',
        'abarth 595',
        'abarth',
        'siata 750',
        'stanguellini'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000355'::uuid,
      'Mercury',
      'Capri',
      1970,
      NULL::integer,
      ARRAY[
        'capri',
        'capri xr2',
        'capri asc mclaren',
        'montego',
        'monarch',
        'meteor'
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

-- 2) Re-home single-car stub rows in Brabham, Cooper, Dallara, Benz, Darracq, ERA, Excalibur,
-- AMC, and Daimler into their active parent family so they don't split <3 sales into 'other'.
WITH stub_merges(make, stub_model, target_model) AS (
  VALUES
    ('Benz', '82/200 hp ''Blitzen Benz''', 'Patent-Motorwagen'),
    ('Darracq', '200 hp', '12 HP'),
    ('Excalibur', 'RS', 'Phaeton'),
    ('AMC', 'AMX/3', 'AMX'),
    ('Daimler', '45 HP', 'SP250'),
    ('Daimler', 'Corsica', 'SP250'),
    ('Daimler', 'DK400', 'SP250'),
    ('Daimler', 'Double Six', 'SP250'),
    ('Dallara', '3087', 'DW12'),
    ('Dallara', 'EXP', 'DW12'),
    ('Dallara', 'F188', 'DW12'),
    ('Dallara', 'F189', 'DW12'),
    ('Dallara', 'F190', 'DW12'),
    ('Dallara', 'F191', 'DW12'),
    ('Dallara', 'F192', 'DW12'),
    ('Dallara', 'SP1', 'DW12'),
    ('Dallara', 'SP1000', 'DW12'),
    ('Dallara', 'Stradale', 'DW12')
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

-- Merge all Brabham BT* stubs into BT33 and Cooper T* stubs into Monaco
UPDATE public.canonical_models
SET
  canonical_model = 'BT33',
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
WHERE lower(make) = 'brabham'
  AND lower(canonical_model) LIKE 'bt%';

UPDATE public.canonical_models
SET
  canonical_model = 'Monaco',
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
WHERE lower(make) = 'cooper'
  AND lower(canonical_model) LIKE 't%';

UPDATE public.canonical_models
SET
  canonical_model = '427 S/C',
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
WHERE lower(make) = 'era';

-- 3) Widen year bounds on existing families in AMC, Daimler, Ducati, Indian, Marmon
WITH year_fixes(make, canonical_model, new_start, new_end) AS (
  VALUES
    ('AMC', 'Rambler', 1900, NULL::integer),
    ('AMC', 'AMX', 1966, NULL::integer),
    ('AMC', 'Javelin', 1966, NULL::integer),
    ('AMC', 'Eagle', 1970, NULL::integer),
    ('AMC', 'Gremlin', 1970, NULL::integer),
    ('AMC', 'Hornet', 1950, NULL::integer),
    ('AMC', 'Matador', 1970, NULL::integer),
    ('AMC', 'Pacer', 1975, NULL::integer),
    ('AMC', 'Rebel', 1957, NULL::integer),
    ('AMC', 'Ambassador', 1932, NULL::integer),
    ('Daimler', 'SP250', 1896, NULL::integer),
    ('Ducati', 'SuperSport', 1950, NULL::integer),
    ('Ducati', 'SportClassic', 1960, NULL::integer),
    ('Ducati', '916', 1990, NULL::integer),
    ('Ducati', 'Panigale', 2005, NULL::integer),
    ('Indian', 'Four', 1901, NULL::integer),
    ('Indian', 'Chief', 1915, NULL::integer),
    ('Marmon', 'Sixteen', 1902, NULL::integer)
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
      'Lamborghini',
      'Sian',
      ARRAY[
        'sián',
        'sián fkp 37',
        'sian fkp 37',
        '5 95 zagato'
      ]
    ),
    (
      'Lamborghini',
      'Huracan',
      ARRAY[
        'huracn',
        'huracn tecnica',
        'huracan tecnica',
        'huracan sto',
        'huracan performante',
        'huracan evo'
      ]
    ),
    (
      'Bentley',
      '3 1/2 Litre',
      ARRAY[
        '4½ liter',
        '4½ liter supercharged',
        '6½ liter',
        '6½ litre',
        '4¼ liter',
        '8 liter',
        '4 5 liter'
      ]
    ),
    (
      'Alfa Romeo',
      '8C',
      ARRAY[
        'tipo b',
        'tipo b grand prix',
        'monoposto'
      ]
    ),
    (
      'Ford',
      'GT',
      ARRAY[
        'gtx1',
        'rs200',
        'rs200 evolution',
        'rs 200',
        'rs 200 evolution'
      ]
    ),
    (
      'Ford',
      'Mustang',
      ARRAY[
        'gt350'
      ]
    ),
    (
      'Mercedes-Benz',
      'G-Class',
      ARRAY[
        'amg g 63',
        'amg g 63 6x6',
        'g 63 6x6'
      ]
    ),
    (
      'Mercedes-Benz',
      '540K',
      ARRAY[
        '630 k',
        '290',
        '290 cabriolet a',
        'ideal 7hp'
      ]
    ),
    (
      'Mercedes-Benz',
      'SL-Class',
      ARRAY[
        'sl72',
        'sl72 amg',
        'sl73',
        'sl73 amg'
      ]
    ),
    (
      'Porsche',
      '356',
      ARRAY[
        '356a',
        '356b',
        '356c',
        'typ 540',
        'sport roadster typ 540'
      ]
    ),
    (
      'Porsche',
      '911',
      ARRAY[
        'gt2rs',
        'gt2rs weissach',
        'gt2',
        'gt2 rs',
        'gt3rs'
      ]
    ),
    (
      'Maserati',
      'A6G',
      ARRAY[
        '4cm',
        '4cs',
        'tipo 6cm'
      ]
    ),
    (
      'Lotus',
      'Type 18',
      ARRAY[
        'type 34',
        'type 49b',
        'cosworth ford type 49b',
        'type 16',
        'climax type 16',
        'type 12',
        'climax type 12',
        'type 19',
        '19 monte carlo',
        'type 125',
        't125',
        'type 30',
        '47 gt',
        'type 47',
        'type 59',
        'type 107c',
        'e21',
        'turbine powered indy'
      ]
    ),
    (
      'Daimler',
      'SP250',
      ARRAY[
        '48 hp',
        'de 36',
        'type tp 45',
        '4hp',
        'db18',
        '57 hp',
        'ferret',
        'ds 420',
        'limousine',
        'conquest',
        'ts38',
        'v26',
        '15hp'
      ]
    ),
    (
      'Ducati',
      'SuperSport',
      ARRAY[
        '750 super sport',
        'supermono',
        '125 grand prix',
        '750 gt',
        '900',
        'tt2',
        '250 mach 1',
        'monster s4rs',
        'monster s4r',
        'monster',
        'hypermotard 1100',
        'hypermotard',
        'multistrada',
        'scrambler'
      ]
    ),
    (
      'Ducati',
      'SportClassic',
      ARRAY[
        'paul smart 1000le',
        'paul smart'
      ]
    ),
    (
      'Ducati',
      '916',
      ARRAY[
        '996sps'
      ]
    ),
    (
      'Ducati',
      'Panigale',
      ARRAY[
        'streetfighter',
        'streetfighter v4s',
        'xdiavel s',
        'xdiavel',
        'diavel'
      ]
    ),
    (
      'Harley-Davidson',
      'EL',
      ARRAY[
        'model 9e',
        'cac',
        'vr1000',
        '10f',
        'model 10f',
        '61',
        'model 7d',
        '6 a',
        'krtt',
        'xrtt',
        'xrtt 750',
        'ta',
        'x8e',
        'fhad',
        'model 8d',
        'davidson xr 750',
        'xa',
        'vlh',
        'rl 45',
        'jdl',
        'jdca',
        'model 10e',
        'tri glide',
        'flhxs',
        'flf',
        'model 11f',
        'model 4',
        'peashooter',
        '7a'
      ]
    ),
    (
      'Indian',
      'Four',
      ARRAY[
        'ace',
        '8 valve',
        'model 401',
        '402',
        '438',
        'model 440',
        'big base',
        'roadmaster',
        'springfield',
        'bobber',
        'board track racer',
        'board track racing',
        'mm5a',
        '741',
        'dispatch tow'
      ]
    ),
    (
      'AMC',
      'Rambler',
      ARRAY[
        'napier 60 hp',
        'underslung',
        'la france speedster',
        'tourist',
        'bantam',
        'bantam roadster',
        'bantam pickup',
        'jeep cj 7',
        'motors jeep cj7',
        'motors jeep cj 7',
        'grand wagoneer',
        'hurst'
      ]
    ),
    (
      'Marmon',
      'Sixteen',
      ARRAY[
        '41 speedster',
        '34b',
        'big eight',
        '34c',
        '57p64',
        'model 78',
        'model 68'
      ]
    ),
    (
      'Mercury',
      'Custom',
      ARRAY[
        'sportsman',
        'station wagon',
        '29a',
        '79m',
        '79 m',
        'model 79m',
        'model 19a',
        '69m',
        '9cm',
        'm100',
        'm 47',
        'm47',
        'tiffany'
      ]
    ),
    (
      'Studebaker',
      'President',
      ARRAY[
        'special indy car',
        'gardner special',
        'garford g7',
        'j5',
        'transtar',
        'starlight',
        'lark',
        'commander'
      ]
    ),
    (
      'Fiat',
      '500',
      ARRAY[
        'spiaggetta',
        '519s',
        '509 s',
        'tipo 55',
        'model 56',
        '1400',
        'barchetta',
        '1600s',
        '131',
        'shellette',
        'michelotti shellette',
        'multipla',
        'gamine'
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
