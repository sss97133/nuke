-- Slice 19: Key 85+ remaining specialist, coachbuilt, brass-era, and motorcycle marques
-- and expand existing canonical families (Duesenberg Model A, Hispano-Suiza J12, Hudson Hornet,
-- Hummer H1, Triumph Bonneville, Mazda RX-7, Panhard Et Levassor Type Q, Panhard-Levassor Type X,
-- Devin SS, Stutz Bearcat, Sunbeam 90, Studebaker Commander, International Scout, Benetton B194,
-- Callaway C12, Elva Courier).

-- 1) Insert new canonical families first (idempotent on make + canonical_model)
WITH new_families(id, make, canonical_model, year_start, year_end, aliases) AS (
  VALUES
    (
      '00000000-0000-4000-f000-000000000356'::uuid,
      'Local',
      'Rally Fighter',
      2009,
      NULL::integer,
      ARRAY[
        'motors rally fighter',
        'rally fighter'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000357'::uuid,
      'Pope-Hartford-Model',
      'Model W',
      1900,
      NULL::integer,
      ARRAY[
        'w 50hp',
        '31 portola',
        't 40hp',
        'l 25 30hp',
        '33 50hp',
        'roadster',
        'tourer',
        'racer'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000358'::uuid,
      'Thor',
      'Single',
      1903,
      NULL::integer,
      ARRAY[
        'single',
        'single cylinder',
        'model u',
        'motor coach',
        'outlaw',
        'sequence'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000359'::uuid,
      'Polaris',
      'RZR',
      1985,
      NULL::integer,
      ARRAY[
        'slingshot',
        'rzr',
        'rzr pro r',
        'rzr xp4',
        'rzr xp',
        'rzr pro xp',
        'ranger',
        'xpedition',
        'general',
        'pro ultimate razor'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000360'::uuid,
      'Thomas',
      'Flyer',
      1900,
      NULL::integer,
      ARRAY[
        'flyer',
        'flyer model 36',
        'auto bi',
        'model 36',
        'touring'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000361'::uuid,
      'Iso Grifo',
      'GL',
      1963,
      NULL::integer,
      ARRAY[
        'series i targa',
        '7 litri',
        'gl coupe',
        'gl',
        'targa'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000362'::uuid,
      'Srt',
      'Viper',
      2012,
      NULL::integer,
      ARRAY[
        'viper gts',
        'viper',
        'viper coupe',
        'viper 2 door coupe'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000363'::uuid,
      'Chrisman',
      'Bonneville',
      1950,
      NULL::integer,
      ARRAY[
        'bonneville',
        'bonneville coupe'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000364'::uuid,
      'Modena',
      'GT Spyder',
      1960,
      NULL::integer,
      ARRAY[
        'gt spyder california',
        'gt spyder',
        'spyder',
        'design spyder'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000365'::uuid,
      'Moto',
      'Guzzi V7',
      1921,
      NULL::integer,
      ARRAY[
        'guzzi 850 le mans',
        'guzzi v7 sport',
        'guzzi v7 racer',
        'guzzi v7',
        'guzzi eldorado 850',
        'guzzi ambassador 750',
        'guzzi airone sport',
        'guzzi falcone sport',
        'guzzi'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000366'::uuid,
      'Tyrrell',
      '008',
      1968,
      NULL::integer,
      ARRAY[
        '008',
        '3 litre cosworth 008',
        '020',
        '014',
        'renault 014',
        'p34'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000367'::uuid,
      'Arnolt-Bristol',
      'Bolide',
      1953,
      NULL::integer,
      ARRAY[
        'roadster',
        'bolide',
        'bolide prototype',
        'deluxe roadster'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000368'::uuid,
      'Arnolt-Mg',
      'Coupe',
      1952,
      NULL::integer,
      ARRAY[
        'drophead coupe',
        'drop head coupe',
        'coupe',
        'convertible'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000369'::uuid,
      'Arnolt',
      'Bristol',
      1952,
      NULL::integer,
      ARRAY[
        'bristol bolide prototype',
        'bristol deluxe roadster',
        'bristol convertible',
        'mg coupe',
        'mg convertible'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000370'::uuid,
      'Autokraft',
      'Mk IV',
      1978,
      NULL::integer,
      ARRAY[
        'ac cobra mk iv',
        'ac mk iv',
        'ac mark iv',
        'ac cobra mkiv',
        'roadster'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000371'::uuid,
      'Vespa',
      '400',
      1946,
      NULL::integer,
      ARRAY[
        '400',
        '946',
        'gs 160',
        'gs',
        'sprint',
        'super',
        'rally',
        'primavera',
        '150',
        '125'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000372'::uuid,
      'Vanderhall',
      'Venice',
      2015,
      NULL::integer,
      ARRAY[
        'venice',
        'venice blackjack',
        'carmel',
        'carmel gt',
        'carmel gts',
        'carmel blackjack',
        'motor works carmel',
        'laguna'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000373'::uuid,
      'Lanchester',
      '40 HP',
      1900,
      NULL::integer,
      ARRAY[
        'sporting forty',
        'model 25',
        '40hp',
        '38hp',
        '30hp',
        '28 hp',
        '20hp',
        'ten',
        'fourteen'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000374'::uuid,
      'Divco',
      'Milk Truck',
      1926,
      NULL::integer,
      ARRAY[
        'custom milk truck',
        'milk truck',
        'b100',
        'model 11',
        '300',
        '300d',
        '206c',
        'delivery'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000375'::uuid,
      'Cushman',
      'Eagle',
      1936,
      NULL::integer,
      ARRAY[
        'eagle',
        'eagle scooter',
        'truckster',
        'truckster scooter',
        'pacemaker',
        'pacemaker scooter',
        'husky',
        'silver eagle'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000376'::uuid,
      'Hennessey',
      'Venom GT',
      1991,
      NULL::integer,
      ARRAY[
        'venom gt',
        'venom gt spyder',
        'venom f5',
        'mammoth',
        'velociraptor',
        'exorcist'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000377'::uuid,
      'Rezvani',
      'Tank',
      2014,
      NULL::integer,
      ARRAY[
        'tank',
        'military edition tank',
        'tank military edition',
        'beast',
        'vengeance'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000378'::uuid,
      'Franklin',
      'Airman',
      1902,
      NULL::integer,
      ARRAY[
        'type d',
        'airman',
        'series 153',
        'g touring',
        'model g',
        '10hp',
        '12hp',
        'model 11 b',
        'model 135',
        '135'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000379'::uuid,
      'Amilcar',
      'CGS',
      1921,
      NULL::integer,
      ARRAY[
        'cs',
        'cgs',
        'cgss',
        'cgss style',
        '4 cgs',
        'cgs3',
        'm3',
        'model g'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000380'::uuid,
      'Scion',
      'FR-S',
      2003,
      NULL::integer,
      ARRAY[
        'fr s',
        'iq',
        'xb',
        'tc',
        'xa',
        'xd'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000381'::uuid,
      'Graham',
      'Hollywood',
      1928,
      NULL::integer,
      ARRAY[
        'hollywood',
        'sharknose',
        '108',
        'model 96',
        'combination',
        'paige',
        'blue streak'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000382'::uuid,
      'Humber',
      'Super Snipe',
      1898,
      NULL::integer,
      ARRAY[
        '8 5hp',
        '16 20 hp',
        'pullman',
        'olympia',
        '4½hp olympia',
        'super snipe',
        'snipe',
        'hawk',
        'sceptre',
        'imperial'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000383'::uuid,
      'Pininfarina',
      'Azzurra',
      1960,
      NULL::integer,
      ARRAY[
        'x sedan',
        'azzurra',
        'azzurra spider',
        'spider azzurra',
        'spider europa',
        'europa',
        'battista'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000384'::uuid,
      'Moke',
      'Electric',
      1964,
      NULL::integer,
      ARRAY[
        'america electric moke',
        'usa electric moke',
        'e moke',
        'america emoke',
        'californian',
        'mini moke'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000385'::uuid,
      'Husqvarna',
      '400 Cross',
      1903,
      NULL::integer,
      ARRAY[
        '250 cr',
        '250',
        '360c',
        '400 cross',
        '400',
        'model 200',
        '390',
        '430',
        '500',
        '125'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000386'::uuid,
      'Ss100 Jaguar',
      'SS100',
      1935,
      NULL::integer,
      ARRAY[
        '3½ litre roadster',
        '2½ litre roadster',
        '3 1 2 litre',
        '2 1 2 litre',
        'roadster'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000387'::uuid,
      'Spartan',
      'Manor',
      1945,
      NULL::integer,
      ARRAY[
        'mansion',
        'executive mansion',
        'royal mansion',
        'manor',
        'royal manor',
        'spartanette',
        'gladiator',
        'newmar'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000388'::uuid,
      'Ligier',
      'JS P320',
      1969,
      NULL::integer,
      ARRAY[
        'js p320',
        'js p3',
        'js p4',
        'js2'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000389'::uuid,
      'Simca',
      '8 Sport',
      1934,
      NULL::integer,
      ARRAY[
        'estager barquette',
        '8 sport',
        '9 sport',
        '8 deho',
        '8 1200',
        'aronde',
        '1000',
        '1200s',
        'vedette'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000390'::uuid,
      'Mauck',
      'MSV 1120S',
      1996,
      NULL::integer,
      ARRAY[
        'msv 1120s',
        'msv',
        '1120s'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000391'::uuid,
      'Brewster',
      'Town Car',
      1915,
      NULL::integer,
      ARRAY[
        'coupe roadster',
        'ford town cabriolet',
        'model 91',
        'town brougham',
        'town car'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000392'::uuid,
      'Sears',
      'Motor Buggy',
      1908,
      NULL::integer,
      ARRAY[
        'de luxe',
        'dreadnaught',
        'model k',
        'model h',
        'single',
        'belt drive single',
        'allstate'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000393'::uuid,
      'Griffith',
      'Series 200',
      1964,
      NULL::integer,
      ARRAY[
        'series 200',
        'series 400',
        '200'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000394'::uuid,
      'Mosler',
      'MT900',
      1985,
      NULL::integer,
      ARRAY[
        'mt900s',
        'mt900',
        'consulier gtp',
        'consulier'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000395'::uuid,
      'Mitchell',
      'Model S',
      1903,
      NULL::integer,
      ARRAY[
        'model s',
        'special six'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000396'::uuid,
      'Sterling',
      'Acterra',
      1907,
      NULL::integer,
      ARRAY[
        'jc137',
        'hc115',
        'ec23',
        'rws160h',
        'dd13 65',
        'ta2115d',
        '2 5 ton',
        'acterra',
        'db 8 63',
        '825',
        '827'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000397'::uuid,
      'Ace',
      'Four',
      1919,
      NULL::integer,
      ARRAY[
        'four',
        'sporting solo',
        'xp4'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000398'::uuid,
      'Curtiss',
      'Twin',
      1902,
      NULL::integer,
      ARRAY[
        '5 hp twin',
        'marvel',
        'twin',
        'single'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000399'::uuid,
      'Nsu',
      'Prinz',
      1901,
      NULL::integer,
      ARRAY[
        'sd kfz 2 kettenkrad',
        'kettenkrad',
        'prinz',
        'spider',
        'ro80',
        'tt',
        '1000',
        '1200'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000400'::uuid,
      'Kaiser-Darrin',
      '161',
      1954,
      NULL::integer,
      ARRAY[
        'convertible',
        '161 roadster',
        '161 convertible',
        '161',
        'sports car convertible',
        'roadster'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000401'::uuid,
      'Vector',
      'M12',
      1978,
      NULL::integer,
      ARRAY[
        'm12',
        'm 12',
        'w8'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000402'::uuid,
      'Rupp',
      'Roadster',
      1959,
      NULL::integer,
      ARRAY[
        'roadster',
        'grand prix',
        'brand x',
        'chaparral',
        'black widow',
        'hustler',
        'scrambler',
        'continental'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000403'::uuid,
      'Smart',
      'Fortwo',
      1998,
      NULL::integer,
      ARRAY[
        'crossblade',
        'fortwo',
        'car cabrio fortwo',
        'brabus',
        'roadster'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000404'::uuid,
      'Baker',
      'Electric',
      1899,
      NULL::integer,
      ARRAY[
        'electric model v',
        'model v',
        'electric victoria',
        'electric model da',
        'b26',
        'electric'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000405'::uuid,
      'Checker',
      'Marathon',
      1922,
      NULL::integer,
      ARRAY[
        'marathon',
        'a 11',
        'a 12',
        'taxi',
        'aerobus'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000406'::uuid,
      'Puch',
      '230GE',
      1900,
      NULL::integer,
      ARRAY[
        '230ge',
        '290gd',
        '230g',
        'pinzgauer',
        'haflinger',
        '500',
        '250',
        '175',
        '125',
        'maxi'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000407'::uuid,
      'Mors',
      'Roi des Belges',
      1896,
      NULL::integer,
      ARRAY[
        '24 32 hp',
        'model n',
        '30 hp',
        'roi des belges'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000408'::uuid,
      'Zundapp',
      'K800',
      1917,
      NULL::integer,
      ARRAY[
        'k800',
        'ks750',
        'ks600',
        'ks50',
        'janus',
        'bella',
        'oskar pillenstein',
        'super sabre'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000409'::uuid,
      'Bocar',
      'XP-5',
      1958,
      NULL::integer,
      ARRAY[
        'xp 7r',
        'xp 5',
        'xp5',
        'xp 6'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000410'::uuid,
      'Bimota',
      'Tesi',
      1973,
      NULL::integer,
      ARRAY[
        'tesi 1d',
        'tesi h2',
        'tesi 3d',
        'tesi',
        'db7',
        'db5',
        'db4',
        'db2',
        'sb8r',
        'sb6',
        'sb6r',
        'hb1',
        'kb1',
        'yb4',
        'yb8',
        'yb11'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000411'::uuid,
      'Chalmers',
      'Model 9',
      1908,
      NULL::integer,
      ARRAY[
        'record speedster',
        'model 9',
        'model 18',
        'model 30',
        'detroit'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000412'::uuid,
      'Roush',
      'Mustang',
      1995,
      NULL::integer,
      ARRAY[
        '427ir powered superformance',
        '427r powered backdraft',
        '427 powered 2008 superformance',
        '347 powered factory five',
        '342r powered backdraft',
        'mustang stage',
        'f 150 stage',
        'mustang',
        'f 150'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000413'::uuid,
      'Steyr-Puch',
      'Pinzgauer',
      1950,
      NULL::integer,
      ARRAY[
        'pinzgauer 710m',
        'pinzgauer 712m',
        'pinzgauer 710k',
        'pinzgauer 712k',
        'pinzgauer',
        'haflinger',
        '500',
        '650'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000414'::uuid,
      'Steyr',
      'Pinzgauer',
      1920,
      NULL::integer,
      ARRAY[
        'puch pinzgauer 710m',
        'puch pinzgauer 718',
        'puch haflinger',
        '120s',
        '220',
        '100',
        '50'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000415'::uuid,
      'Richard-Brasier',
      'Type D',
      1902,
      NULL::integer,
      ARRAY[
        'type d',
        '16hp',
        'type o'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000416'::uuid,
      'Superlite',
      'SL-C',
      2008,
      NULL::integer,
      ARRAY[
        'sl c',
        'slc',
        'coupe',
        'gt r'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000417'::uuid,
      'Cheetah',
      'Coupe',
      1963,
      NULL::integer,
      ARRAY[
        'coupe',
        're creation',
        'continuation'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000418'::uuid,
      'American Bantam',
      'Roadster',
      1937,
      NULL::integer,
      ARRAY[
        'roadster',
        'boulevard delivery',
        'convertible coupe',
        'convertible sedan',
        'hollywood',
        'pickup',
        'station wagon',
        'coupe',
        'model 60'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000419'::uuid,
      'Rauch',
      '& Lang Electric',
      1905,
      NULL::integer,
      ARRAY[
        'lang jx 7',
        'lang electric bx7',
        'lang model bx6',
        'lang bx6',
        'lang model j',
        'brougham'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000420'::uuid,
      'Detroit Electric',
      'Brougham',
      1907,
      NULL::integer,
      ARRAY[
        'model 47',
        'model 97b',
        'model 99',
        'model 57',
        'model d',
        'brougham'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000421'::uuid,
      'Marcos',
      '1600 GT',
      1959,
      NULL::integer,
      ARRAY[
        '1600 gt',
        '1500gt',
        '1800 gt',
        'mantula',
        'gt 3 0',
        'gt 3 litre',
        '3 litre',
        'mini marcos',
        'race car'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000422'::uuid,
      'Runge',
      'RS',
      2012,
      NULL::integer,
      ARRAY[
        'rs',
        'rs010',
        'frankfurt flyer 004',
        'frankfurt flyer'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000423'::uuid,
      'Autocar',
      'Type VIII',
      1899,
      NULL::integer,
      ARRAY[
        'type 8',
        '12hp',
        'model viii',
        'm16a1',
        'm3a1',
        'half track'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000424'::uuid,
      'Flying Merkel',
      'Twin',
      1911,
      NULL::integer,
      ARRAY[
        'model 50',
        'twin',
        'single',
        'bicycle'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000425'::uuid,
      'Dkw',
      '3=6',
      1928,
      NULL::integer,
      ARRAY[
        'schnellaster',
        '3 6',
        '1000',
        'junior',
        'munga',
        'hummel',
        'hummel 115',
        'kavalier',
        'rt 125',
        'rt 250'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000426'::uuid,
      'Autozam',
      'AZ-1',
      1990,
      NULL::integer,
      ARRAY[
        'az 1',
        'cara',
        'scrum'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000427'::uuid,
      'Atalanta',
      'Sports',
      1937,
      NULL::integer,
      ARRAY[
        'short chassis',
        'bluebird roadster',
        'sports'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000428'::uuid,
      'Elva',
      'Courier',
      1955,
      NULL::integer,
      ARRAY[
        'mk1 b',
        'mk iv',
        'mk7 ford',
        'mk v',
        'mk viii',
        'courier',
        'gt160',
        'porsche'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000429'::uuid,
      'Icon',
      'BR',
      2006,
      NULL::integer,
      ARRAY[
        'old school br',
        'br',
        'fj40',
        'fj44',
        'thriftmaster',
        'derelict',
        'golf cart'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000430'::uuid,
      'Maxwell',
      'Model H',
      1904,
      NULL::integer,
      ARRAY[
        '16hp',
        'model h',
        'special touring',
        'model l',
        'model a',
        'model q',
        'model 25',
        'ab'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000431'::uuid,
      'Leyland',
      'Mini',
      1968,
      NULL::integer,
      ARRAY[
        'moke',
        'mini van',
        'mini',
        'fv4201',
        'sherpa'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000432'::uuid,
      'Westfield',
      'Eleven',
      1982,
      NULL::integer,
      ARRAY[
        'lotus eleven',
        'lotus 11',
        '1955 lotus 11',
        'xi',
        'seven replica',
        'se',
        'sei',
        'seight'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000433'::uuid,
      'Stoddard Dayton',
      'Model 11K',
      1905,
      NULL::integer,
      ARRAY[
        'model 11k',
        'model 10k',
        'model 11a'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000434'::uuid,
      'Watercar',
      'Panther',
      2013,
      NULL::integer,
      ARRAY[
        'panther'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000435'::uuid,
      'Laverda',
      '750 SFC',
      1949,
      NULL::integer,
      ARRAY[
        '750 sfc',
        '750sfc',
        '750 sf',
        '750',
        '1000',
        'jota',
        '1200',
        'rgs',
        '500'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000436'::uuid,
      'Sherp',
      'Pro',
      2015,
      NULL::integer,
      ARRAY[
        'pro',
        'pro xt',
        'n 1200'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000437'::uuid,
      'Apollo',
      '5000 GT',
      1962,
      NULL::integer,
      ARRAY[
        '5000gt',
        '5000 gt',
        'gt',
        '2 2 prototype',
        'coupe',
        'verona'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000438'::uuid,
      'Cleveland',
      'Four',
      1902,
      NULL::integer,
      ARRAY[
        'four',
        'fowler four',
        'tornado',
        'century',
        'single'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000439'::uuid,
      'Singer',
      'Nine Le Mans',
      1905,
      NULL::integer,
      ARRAY[
        '1½ litre le mans',
        'nine le mans',
        'nine',
        'sm roadster',
        '4ad',
        'gazelle',
        'vogue',
        'chamois',
        'motorwheel'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000440'::uuid,
      'Mercedes-Maybach',
      'S580',
      2015,
      NULL::integer,
      ARRAY[
        's580',
        's580 4matic',
        'gls600',
        's600',
        's650',
        's680'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000441'::uuid,
      'Ktm',
      'X-Bow',
      1953,
      NULL::integer,
      ARRAY[
        'x bow',
        '1190 rc8',
        '1290 super duke',
        '990',
        '950',
        '690',
        '500',
        '450',
        '350',
        '300',
        '250'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000442'::uuid,
      'Swallow',
      'Doretti',
      1954,
      NULL::integer,
      ARRAY[
        'doretti',
        'sidecar',
        'gadabout'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000443'::uuid,
      'Lea-Francis',
      '2 1/2 Litre',
      1903,
      NULL::integer,
      ARRAY[
        '2½ liter sports',
        '1½ litre s type',
        '2 1 2 liter',
        '1 1 2 litre',
        '14hp',
        'hyper'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000444'::uuid,
      'Yale',
      'Twin',
      1902,
      NULL::integer,
      ARRAY[
        'rear entrance tonneau',
        'single',
        'motorcycle',
        'model 27',
        'twin'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000445'::uuid,
      'Asa',
      '1000 GT',
      1962,
      NULL::integer,
      ARRAY[
        '1000 spyder',
        '1000 gt',
        'coupe'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000446'::uuid,
      'Zimmer',
      'Golden Spirit',
      1980,
      NULL::integer,
      ARRAY[
        'golden spirit',
        'quicksilver'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000447'::uuid,
      'Karma',
      'Revero',
      2016,
      NULL::integer,
      ARRAY[
        'revero',
        'revero gt',
        'gs 6'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000448'::uuid,
      'Confederate',
      'Hellcat',
      1994,
      NULL::integer,
      ARRAY[
        'x132 hellcat',
        'f131 hellcat',
        'p120 fighter',
        'b120 wraith',
        'motorcycle hellcat',
        'hellcat',
        'wraith',
        'fighter'
      ]
    ),
    (
      '00000000-0000-4000-f000-000000000449'::uuid,
      'Wanderer',
      'W25K',
      1911,
      NULL::integer,
      ARRAY[
        'w25',
        'w25k',
        '616',
        'puppchen'
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

-- 2) Re-home single-car stub rows in Benetton, Callaway, Elva, Duesenberg, Devin, Triumph
-- into their active parent families so they cross the 3-sale threshold.
UPDATE public.canonical_models
SET
  canonical_model = 'B194',
  year_start = NULL,
  year_end = NULL,
  aliases = (
    SELECT array_agg(DISTINCT a ORDER BY a)
    FROM unnest(
      coalesce(aliases, ARRAY[]::text[]) ||
      ARRAY[
        lower(btrim(regexp_replace(canonical_model, '[^a-zA-Z0-9]+', ' ', 'g'))),
        'cosworth ford b194',
        'ford b193b'
      ]
    ) AS a
    WHERE a IS NOT NULL AND btrim(a) <> ''
  )
WHERE lower(make) = 'benetton';

UPDATE public.canonical_models
SET
  canonical_model = 'C12',
  year_start = NULL,
  year_end = NULL,
  aliases = (
    SELECT array_agg(DISTINCT a ORDER BY a)
    FROM unnest(
      coalesce(aliases, ARRAY[]::text[]) ||
      ARRAY[
        lower(btrim(regexp_replace(canonical_model, '[^a-zA-Z0-9]+', ' ', 'g'))),
        'c7r',
        'c12',
        'supernatural',
        'corvette'
      ]
    ) AS a
    WHERE a IS NOT NULL AND btrim(a) <> ''
  )
WHERE lower(make) = 'callaway';

UPDATE public.canonical_models
SET
  canonical_model = 'Courier',
  year_start = NULL,
  year_end = NULL,
  aliases = (
    SELECT array_agg(DISTINCT a ORDER BY a)
    FROM unnest(
      coalesce(aliases, ARRAY[]::text[]) ||
      ARRAY[
        lower(btrim(regexp_replace(canonical_model, '[^a-zA-Z0-9]+', ' ', 'g'))),
        'mk1 b',
        'mk iv',
        'mk7 ford',
        'courier'
      ]
    ) AS a
    WHERE a IS NOT NULL AND btrim(a) <> ''
  )
WHERE lower(make) = 'elva';

UPDATE public.canonical_models
SET
  canonical_model = 'Model A',
  year_start = NULL,
  year_end = NULL,
  aliases = ARRAY['model a', 'model a y', 'model d', 'model x', 'special', 'ii royalton']
WHERE lower(make) = 'duesenberg'
  AND lower(canonical_model) IN ('model a/y', 'model d', 'model x', 'special');

-- Merge duplicate Devin SS rows so aliases are shared across both
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = ARRAY['ss', 'c', 'd', 'z', 'triumph tr3 devin', 'mg special td']
WHERE lower(make) = 'devin'
  AND lower(canonical_model) = 'ss';

-- 3) Append aliases to existing families (1-to-4 alphanumeric words per phrase)
WITH target_additions(make, canonical_model, add_aliases) AS (
  VALUES
    (
      'Panhard Et Levassor',
      'Type Q',
      ARRAY[
        'rear entrance tonneau',
        'model u2',
        '7cv',
        'x17'
      ]
    ),
    (
      'Panhard-Levassor',
      'Type X',
      ARRAY[
        'x14',
        'x14 20cv',
        '20cv'
      ]
    ),
    (
      'Hispano-Suiza',
      'J12',
      ARRAY[
        '15t',
        '15t alfonso xiii',
        't15',
        'h6',
        't56',
        'type 20',
        '15 20 hp',
        '15 20hp',
        'type 24',
        't49',
        'type 49',
        '27 hp t49',
        '27hp t49',
        '37 2hp',
        '15hp',
        '20cv',
        'truck'
      ]
    ),
    (
      'Hudson',
      'Hornet',
      ARRAY[
        'convertible',
        'martz special',
        'greater eight',
        'boattail',
        'model 33',
        'touring sedan',
        'pickup',
        'model l',
        'sport phaeton',
        'single',
        'dick tracy',
        'wasp',
        'model 37',
        'pacemaker',
        '1 2 ton',
        'speedster',
        'super 6'
      ]
    ),
    (
      'Hummer',
      'H1',
      ARRAY[
        'four door hard top',
        'four door hardtop',
        'wagon',
        'open top',
        'm1123',
        'm1123 hmmwv',
        'hmmwv',
        'hmmwv military',
        'm1165a1',
        'm1152',
        'm1167',
        'm1151a1',
        'hmmwv m998',
        'am general humvee',
        'alpha',
        'ev edition 1',
        'h3r'
      ]
    ),
    (
      'Stutz',
      'Bearcat',
      ARRAY[
        'bear cat',
        'series m',
        '6e',
        'aa',
        'model m',
        'dv32',
        'model mb',
        'bb',
        'series bb',
        'boattail speedster',
        '1800s'
      ]
    ),
    (
      'Sunbeam',
      '90',
      ARRAY[
        '25 30hp',
        '2 litre',
        '10 12hp',
        '12 14hp',
        '20 60hp',
        '3 0 litre',
        '3 litre',
        '16 20hp',
        '24 60',
        'mabley',
        'minx',
        'coupe de l auto'
      ]
    ),
    (
      'Triumph',
      'TR2',
      ARRAY[
        '2000 roadster',
        '2000',
        '1800 roadster',
        '1800',
        'roadster 2000',
        'mayflower',
        'renown'
      ]
    ),
    (
      'Triumph',
      'Bonneville',
      ARRAY[
        't120r',
        't120',
        't100c',
        't100',
        't100r',
        't140',
        't140v',
        't150',
        't160',
        'tr6c',
        'tr6r',
        'tr6sc',
        'x75',
        'x75 hurricane',
        't80',
        '5t',
        '6t',
        '3ta',
        '5ta',
        'cub',
        'terrier'
      ]
    ),
    (
      'Mazda',
      'RX-7',
      ARRAY[
        '767b',
        'rotary pickup',
        'rx',
        'race car',
        'denali',
        'mazdaspeed6',
        'b2200',
        'b2000',
        'b2600'
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
