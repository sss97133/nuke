-- Slice 23: Key 70+ zero-family collector, JDM, microcar, racing, and motorcycle marques
-- plus expand motorcycle, JDM, and vintage model families across Honda, Yamaha, Suzuki,
-- Ducati, Triumph, Harley-Davidson, Indian, Henderson, International, Studebaker, Auburn,
-- Lola, Iso, AC, Mini, Willys, Citroen, Renault, Toyota, Volvo, Lincoln, Mercury, and Volkswagen.

-- 1. Re-home 1-2 sale Honda stubs into >=3 sale families
UPDATE public.canonical_models
SET
  canonical_model = 'CB750',
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['cb900', 'cb900c', 'cb900f', 'cb1000', 'cb 1'])
WHERE lower(make) = 'honda'
  AND canonical_model IN ('CB900', 'CB1000', 'CB-1', '919');

UPDATE public.canonical_models
SET
  canonical_model = 'Valkyrie',
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['valkyrie tourer', 'f6c'])
WHERE lower(make) = 'honda'
  AND canonical_model = 'Valkyrie Tourer';

UPDATE public.canonical_models
SET
  canonical_model = 'Gold Wing',
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['gl1200', 'gl1000', 'gl1100', 'gl1500', 'gl1800', 'gl500', 'gl650'])
WHERE lower(make) = 'honda'
  AND canonical_model = 'GL1200 (GOLDWING)';

UPDATE public.canonical_models
SET
  canonical_model = 'Africa Twin',
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['africa twin', 'crf1000l', 'crf1000l2', 'crf1100l', 'xrv750', 'xrv650'])
WHERE lower(make) = 'honda'
  AND canonical_model = 'Africa Twin Adventure Sports';

UPDATE public.canonical_models
SET
  canonical_model = 'CBR900RR',
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['fireblade', 'cbr929rr', 'cbr900rr'])
WHERE lower(make) = 'honda'
  AND canonical_model IN ('Fireblade', 'CBR929RR');

UPDATE public.canonical_models
SET
  canonical_model = 'PC800',
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['pc800', 'pacific coast'])
WHERE lower(make) = 'honda'
  AND canonical_model IN ('PC800 (PACIFIC COAST)', 'Pacific Coast');

UPDATE public.canonical_models
SET
  canonical_model = 'CBR250R',
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['cbr250', 'cbr250r', 'cbr250rr', 'mc19', 'mc22'])
WHERE lower(make) = 'honda'
  AND canonical_model IN ('CBR250', 'CBR250R');

-- 2. Re-home Lincoln Mark stubs into Continental so Mark II / III / IV / V resolve
UPDATE public.canonical_models
SET
  canonical_model = 'Continental',
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['mark ii', 'mk ii', 'mark iii', 'mark iv', 'mark v', 'mark vi', 'continental'])
WHERE lower(make) = 'lincoln'
  AND canonical_model IN ('Mark', 'Mark III', 'Mark IV', 'Mark V');

-- 3. Insert new canonical_models rows for 71 zero-family marques + expanded major-marque families
INSERT INTO public.canonical_models (
  id, make, canonical_model, year_start, year_end, aliases
)
VALUES
  (
    '00000000-0000-4000-f000-000000000620'::uuid,
    'Alta',
    '2-Litre',
    NULL,
    NULL,
    ARRAY['2 litre', '1½ litre', 'redshift', 'redshift exr', 'sports']
  ),
  (
    '00000000-0000-4000-f000-000000000621'::uuid,
    'Gladiator',
    '10 HP',
    NULL,
    NULL,
    ARRAY['10hp', '12 14hp', 'type p', 'tonneau']
  ),
  (
    '00000000-0000-4000-f000-000000000622'::uuid,
    'Haynes',
    'Model 27',
    NULL,
    NULL,
    ARRAY['model 27', 'model o', '50 hp', 'runabout', 'touring']
  ),
  (
    '00000000-0000-4000-f000-000000000623'::uuid,
    'Decauville',
    '5 HP Voiturelle',
    NULL,
    NULL,
    ARRAY['5hp', '8 1 2 hp', 'roadster', 'tonneau', 'voiturelle']
  ),
  (
    '00000000-0000-4000-f000-000000000624'::uuid,
    'Vintage Speedsters',
    '356 Speedster',
    NULL,
    NULL,
    ARRAY['speedster', 'speedsters', '356', '550 spyder']
  ),
  (
    '00000000-0000-4000-f000-000000000625'::uuid,
    'Gar Wood',
    'Triple Cockpit Runabout',
    NULL,
    NULL,
    ARRAY['28', '20', 'type b5', 'runabout', 'roadster']
  ),
  (
    '00000000-0000-4000-f000-000000000626'::uuid,
    'Aprilia',
    'RSV4',
    NULL,
    NULL,
    ARRAY['rsv4', 'rsv1000', 'rsv1000r', 'rsv 1000', 'rsv mille', 'rsv', 'tuono', 'rs250', 'rs 250', 'rs 125', 'rs125', 'rs50', 'rx50', 'sxv 550', 'rxv 550', 'tuareg', 'moto 6 5', 'dorsoduro', 'shiver', 'scarabeo', 'scarabero']
  ),
  (
    '00000000-0000-4000-f000-000000000627'::uuid,
    'Benelli',
    '750 Sei',
    NULL,
    NULL,
    ARRAY['750 sei', 'sei 750', '900 sei', '900', '500 gp', 'quattro 500', '254', '250 four', '250', '650s', 'tnt 1130', 'tornado', 'tre k', 'leoncino', 'single', 'buzzer', '65 enduro', '175 enduro', '125', 'sport 50', 'mini 50', 'fireball 50', 'riverside', 'hurricane']
  ),
  (
    '00000000-0000-4000-f000-000000000628'::uuid,
    'Royal',
    'Enfield Interceptor',
    NULL,
    NULL,
    ARRAY['enfield', 'pioneer', 'ruby']
  ),
  (
    '00000000-0000-4000-f000-000000000629'::uuid,
    'Mmc',
    '6 HP Charette',
    NULL,
    NULL,
    ARRAY['10hp', '8hp', '6hp', '6 hp', 'tonneau']
  ),
  (
    '00000000-0000-4000-f000-000000000630'::uuid,
    'Chris',
    'Craft Barrel Back',
    NULL,
    NULL,
    ARRAY['craft', 'sportsman', 'capri', 'continental', 'barrel back', 'runabout', 'riviera', 'lancer']
  ),
  (
    '00000000-0000-4000-f000-000000000631'::uuid,
    'Stewart',
    'Stevenson M1078 LMTV',
    NULL,
    NULL,
    ARRAY['stevenson', 'm1078', 'm1078a1', 'm1079', 'm1087', 'm1088', 'lmtv']
  ),
  (
    '00000000-0000-4000-f000-000000000632'::uuid,
    'Quadro',
    'Sherp Pro',
    NULL,
    NULL,
    ARRAY['sherp', 'sherp pro', 'sherp n']
  ),
  (
    '00000000-0000-4000-f000-000000000633'::uuid,
    'G-Force',
    'GF01 Indy Car',
    NULL,
    NULL,
    ARRAY['gf01', 'force gf01']
  ),
  (
    '00000000-0000-4000-f000-000000000634'::uuid,
    'Hacker Craft',
    'Triple Cockpit Runabout',
    NULL,
    NULL,
    ARRAY['30', '26', '24', 'triple cockpit', 'runabout']
  ),
  (
    '00000000-0000-4000-f000-000000000635'::uuid,
    'Midwest',
    'Automotive Designs Sprinter',
    NULL,
    NULL,
    ARRAY['automotive designs', 'sprinter', 'daycruiser', 'heritage']
  ),
  (
    '00000000-0000-4000-f000-000000000636'::uuid,
    'Cretors',
    'Model C',
    NULL,
    NULL,
    ARRAY['model c', 'popcorn wagon']
  ),
  (
    '00000000-0000-4000-f000-000000000637'::uuid,
    'Tv Tommy Ivo',
    'Showboat Dragster',
    NULL,
    NULL,
    ARRAY['wagonmaster', 'top fuel', 'front engine', 'dragster']
  ),
  (
    '00000000-0000-4000-f000-000000000638'::uuid,
    'Twin',
    'Coach Helms Bakery',
    NULL,
    NULL,
    ARRAY['coach', 'delivery truck', 'pulsejet', 'engine']
  ),
  (
    '00000000-0000-4000-f000-000000000639'::uuid,
    'Junior',
    'Classic',
    NULL,
    NULL,
    ARRAY['classic', 'dragster']
  ),
  (
    '00000000-0000-4000-f000-000000000640'::uuid,
    'Atc',
    'Quest Stacker Trailer',
    NULL,
    NULL,
    ARRAY['stacker', 'game changer', 'quest', '24', 'custom trailer']
  ),
  (
    '00000000-0000-4000-f000-000000000641'::uuid,
    'Cruise',
    'Car eMoke',
    NULL,
    NULL,
    ARRAY['car emoke', 'car electric moke', 'car moke', 'moke']
  ),
  (
    '00000000-0000-4000-f000-000000000642'::uuid,
    'Zeal',
    'Fat Truck 2.8C',
    NULL,
    NULL,
    ARRAY['motor', 'fat truck']
  ),
  (
    '00000000-0000-4000-f000-000000000643'::uuid,
    'Moretti',
    '750 Gran Sport',
    NULL,
    NULL,
    ARRAY['750s', '850 sportiva', '500', 'midimaxi']
  ),
  (
    '00000000-0000-4000-f000-000000000644'::uuid,
    'Mahindra',
    'Roxor',
    NULL,
    NULL,
    ARRAY['roxor', 'cj 340', 'cj500']
  ),
  (
    '00000000-0000-4000-f000-000000000645'::uuid,
    'Aerovault',
    'Mk II Trailer',
    NULL,
    NULL,
    ARRAY['mkii', 'mk ii', 'mk i', 'trailer']
  ),
  (
    '00000000-0000-4000-f000-000000000646'::uuid,
    'Emw',
    '327',
    NULL,
    NULL,
    ARRAY['327', '327 sport', 'cabriolet']
  ),
  (
    '00000000-0000-4000-f000-000000000647'::uuid,
    'Reynard',
    '98I Indy Car',
    NULL,
    NULL,
    ARRAY['98i', '96i', '903', 'sf 84', 'sf84', '83sf', 'formula atlantic', 'formula ford', 'championship car']
  ),
  (
    '00000000-0000-4000-f000-000000000648'::uuid,
    'Bourget',
    'Fat Daddy',
    NULL,
    NULL,
    ARRAY['fat daddy', 'python', 'black jack', 'low blow', 'dragon', 'protrak', 'custom chopper', 'diamond anniversary', 'custom sand car']
  ),
  (
    '00000000-0000-4000-f000-000000000649'::uuid,
    'Oliver',
    'Super 88',
    NULL,
    NULL,
    ARRAY['1900', '1950', '1800', '1600', '2255', '990', '880', '770', '77', '88', '70', '66', 'super', 'super 88', 'super 55', 'hg68']
  ),
  (
    '00000000-0000-4000-f000-000000000650'::uuid,
    'Sharp Arrow',
    'Runabout',
    NULL,
    NULL,
    ARRAY['runabout']
  ),
  (
    '00000000-0000-4000-f000-000000000651'::uuid,
    'Fleetwood',
    'Discovery',
    NULL,
    NULL,
    ARRAY['discovery', 'pulse', 'revolution', 'expedition']
  ),
  (
    '00000000-0000-4000-f000-000000000652'::uuid,
    'Gaz',
    '69',
    NULL,
    NULL,
    ARRAY['69', 'volga', 'chaika', 'm20', '24']
  ),
  (
    '00000000-0000-4000-f000-000000000653'::uuid,
    'Malibu',
    'Corvette Z06 Boat',
    NULL,
    NULL,
    ARRAY['corvette', 'wakesetter']
  ),
  (
    '00000000-0000-4000-f000-000000000654'::uuid,
    'Jensen-Healey',
    'Mk II',
    NULL,
    NULL,
    ARRAY['mk ii', 'mkii', 'mk i', 'jh5', 'convertible', 'roadster']
  ),
  (
    '00000000-0000-4000-f000-000000000655'::uuid,
    'Mazdaspeed',
    'MX-5 Miata',
    NULL,
    NULL,
    ARRAY['mx 5', 'miata', 'proteg']
  ),
  (
    '00000000-0000-4000-f000-000000000656'::uuid,
    'Buell',
    'XB12R Firebolt',
    NULL,
    NULL,
    ARRAY['1125r', '1125cr', '1125', 'xb12r', 'xb12x', 'xb9r', 'firebolt', 'ulysses', 's1', 'x1', 'm2', 'lightning', 'cyclone', 'rs1200', 'rr1200', 'rss1200', 'ronin', 'hammerhead', 'blast']
  ),
  (
    '00000000-0000-4000-f000-000000000657'::uuid,
    'Puma',
    'GTE 1600',
    NULL,
    NULL,
    ARRAY['gte', 'gts', 'gtc', 'gti']
  ),
  (
    '00000000-0000-4000-f000-000000000658'::uuid,
    'Case',
    'Model 40',
    NULL,
    NULL,
    ARRAY['model 40', 'touring', '7 passenger', 'orchard 400', '440', '1194', 'master', '611', 'sc']
  ),
  (
    '00000000-0000-4000-f000-000000000659'::uuid,
    'Gordon-Keeble',
    'GK1',
    NULL,
    NULL,
    ARRAY['coup', 'coupe', 'gk1', 'gt']
  ),
  (
    '00000000-0000-4000-f000-000000000660'::uuid,
    'Ginetta',
    'G4',
    NULL,
    NULL,
    ARRAY['g4', 'g15', 'g20', 'g56', 'dare tg', 'all models']
  ),
  (
    '00000000-0000-4000-f000-000000000661'::uuid,
    'Overland',
    'Model 79',
    NULL,
    NULL,
    ARRAY['model 79', 'model 79t', 'model 49', 'model 69', 'model 90', 'model 75b', '82', 'touring', 'roadster', 'covered wagon']
  ),
  (
    '00000000-0000-4000-f000-000000000662'::uuid,
    'Fmc',
    '2900R',
    NULL,
    NULL,
    ARRAY['2900r', '2900 r', 'm59']
  ),
  (
    '00000000-0000-4000-f000-000000000663'::uuid,
    'Douglas',
    'Dragonfly',
    NULL,
    NULL,
    ARRAY['dragonfly', 'greyhound', 't6', 't35', 'model d', '2 3 4 hp', 'mkiii', '348cc']
  ),
  (
    '00000000-0000-4000-f000-000000000664'::uuid,
    'Bedelia',
    'BD2 Cyclecar',
    NULL,
    NULL,
    ARRAY['bd2', 'type 8', '10cv']
  ),
  (
    '00000000-0000-4000-f000-000000000665'::uuid,
    'De Havilland',
    'DH.89 Dragon Rapide',
    NULL,
    NULL,
    ARRAY['rapide', 'dh87', 'chipmunk']
  ),
  (
    '00000000-0000-4000-f000-000000000666'::uuid,
    'Zastava',
    '750',
    NULL,
    NULL,
    ARRAY['750', '750z', 'yugo']
  ),
  (
    '00000000-0000-4000-f000-000000000667'::uuid,
    'Paige',
    '6-66 Daytona',
    NULL,
    NULL,
    ARRAY['6 66', 'model 6 55']
  ),
  (
    '00000000-0000-4000-f000-000000000668'::uuid,
    'Jowett',
    'Jupiter',
    NULL,
    NULL,
    ARRAY['jupiter', 'javelin', '7 17', '7hp']
  ),
  (
    '00000000-0000-4000-f000-000000000669'::uuid,
    'Dual',
    'Ghia',
    NULL,
    NULL,
    ARRAY['ghia']
  ),
  (
    '00000000-0000-4000-f000-000000000670'::uuid,
    'Proteus',
    'C-Type',
    NULL,
    NULL,
    ARRAY['c type', 'd type']
  ),
  (
    '00000000-0000-4000-f000-000000000671'::uuid,
    'Jordan',
    '199',
    NULL,
    NULL,
    ARRAY['ej13', '199', 'f1']
  ),
  (
    '00000000-0000-4000-f000-000000000672'::uuid,
    'Trojan',
    '200',
    NULL,
    NULL,
    ARRAY['200', 'trobike', 'mini motor']
  ),
  (
    '00000000-0000-4000-f000-000000000673'::uuid,
    'Magni',
    'Sfida',
    NULL,
    NULL,
    ARRAY['750 mv agusta', 'sfida', 'sfida 1100ie', 'australia']
  ),
  (
    '00000000-0000-4000-f000-000000000674'::uuid,
    'Hillman',
    'Minx',
    NULL,
    NULL,
    ARRAY['minx', 'super minx', 'aero minx', 'husky', 'imp', 'tourer']
  ),
  (
    '00000000-0000-4000-f000-000000000675'::uuid,
    'Gardner',
    '140 Roadster',
    NULL,
    NULL,
    ARRAY['140', 'model 5', 'roadster', 'aero cruiser']
  ),
  (
    '00000000-0000-4000-f000-000000000676'::uuid,
    'Bantam',
    'Model 60',
    NULL,
    NULL,
    ARRAY['model 65', 'roadster', 'boulevard delivery', 'panel truck', 'pickup', 'speedster']
  ),
  (
    '00000000-0000-4000-f000-000000000677'::uuid,
    'Lada',
    'Niva',
    NULL,
    NULL,
    ARRAY['niva', 'vaz 2101', '2101', '2105', '2106', '2107', '1200', '1300s', 'car']
  ),
  (
    '00000000-0000-4000-f000-000000000678'::uuid,
    'Oshkosh',
    'MK48 Dragon Wagon',
    NULL,
    NULL,
    ARRAY['m1000', 'm1070', 'mk48', 't']
  ),
  (
    '00000000-0000-4000-f000-000000000679'::uuid,
    'Reading Standard',
    'V-Twin',
    NULL,
    NULL,
    ARRAY['v twin', 'x1 02', 'single', 'rs twin']
  ),
  (
    '00000000-0000-4000-f000-000000000680'::uuid,
    'Ural',
    'Gear Up',
    NULL,
    NULL,
    ARRAY['gear up', 'patrol', 'tourist', 'troyka', 'm63', 't']
  ),
  (
    '00000000-0000-4000-f000-000000000681'::uuid,
    'Albion',
    '8 HP Dogcart',
    NULL,
    NULL,
    ARRAY['8hp', '16hp', '16 hp']
  ),
  (
    '00000000-0000-4000-f000-000000000682'::uuid,
    'Wills Sainte Claire',
    'A-68',
    NULL,
    NULL,
    ARRAY['a 68', 'b 68', 'w6', 'roadster']
  ),
  (
    '00000000-0000-4000-f000-000000000683'::uuid,
    'Ahrens-Fox',
    'Model N-S-4',
    NULL,
    NULL,
    ARRAY['m x 4', 'model v', 'n s 4', 'pumper']
  ),
  (
    '00000000-0000-4000-f000-000000000684'::uuid,
    'Autocar Type',
    'Type X Runabout',
    NULL,
    NULL,
    ARRAY['10', 'viii', 'runabout', 'tonneau']
  ),
  (
    '00000000-0000-4000-f000-000000000685'::uuid,
    'Pulse',
    'Autocycle',
    NULL,
    NULL,
    ARRAY['autocycle', 'litestar']
  ),
  (
    '00000000-0000-4000-f000-000000000686'::uuid,
    'Merkur',
    'XR4Ti',
    NULL,
    NULL,
    ARRAY['xr4ti', 'scorpio']
  ),
  (
    '00000000-0000-4000-f000-000000000687'::uuid,
    'Tiffin',
    'Allegro Bus',
    NULL,
    NULL,
    ARRAY['allegro', 'allegro bus']
  ),
  (
    '00000000-0000-4000-f000-000000000688'::uuid,
    'Ossa',
    '250 Pioneer',
    NULL,
    NULL,
    ARRAY['pioneer', 'super pioneer', 'phantom', '250', '175', '350', 'yankee', 'palillos', 'explorer', 'six day', 'tr77', 'tr280i', 'mick andrews', 'stiletto', 'dmr']
  ),
  (
    '00000000-0000-4000-f000-000000000689'::uuid,
    'Woodill',
    'Wildfire',
    NULL,
    NULL,
    ARRAY['wildfire']
  ),
  (
    '00000000-0000-4000-f000-000000000690'::uuid,
    'James',
    'Comet',
    NULL,
    NULL,
    ARRAY['browne', 'model d2', 'b3', 'comet', 'ml', 'cadet', 'single', 'superswift', 'captain', 'superplus', 'superlux', '226cc']
  ),
  -- Expanded Honda families
  (
    '00000000-0000-4000-f000-000000000691'::uuid,
    'Honda',
    'CT110',
    NULL,
    NULL,
    ARRAY['ct110', 'trail 110']
  ),
  (
    '00000000-0000-4000-f000-000000000692'::uuid,
    'Honda',
    'CT90',
    NULL,
    NULL,
    ARRAY['ct90', 'trail 90', 'ct200', 'trail 55', 'c100', 'c102', 'c105', 'c110', 'c200', 's65', 's90', 'cl90', 'ca95', 'ca160', 'dream', 'benly']
  ),
  (
    '00000000-0000-4000-f000-000000000693'::uuid,
    'Honda',
    'CT70',
    NULL,
    NULL,
    ARRAY['ct70', 'trail 70', 'st70', 'dax']
  ),
  (
    '00000000-0000-4000-f000-000000000694'::uuid,
    'Honda',
    'Z50',
    NULL,
    NULL,
    ARRAY['z50', 'z50a', 'z50m', 'z50r', 'mini trail', 'mini trail 50', 'monkey', 'qr50', 'mr 50', 'mr50']
  ),
  (
    '00000000-0000-4000-f000-000000000695'::uuid,
    'Honda',
    'CB350',
    NULL,
    NULL,
    ARRAY['cb350', 'cb350f', 'cl350', 'sl350', 'cb360', 'cb360t', 'cl360', 'cb400', 'cb400f', 'cb400t', 'cm400']
  ),
  (
    '00000000-0000-4000-f000-000000000696'::uuid,
    'Honda',
    'CB175',
    NULL,
    NULL,
    ARRAY['cb175', 'cl175', 'sl175', 'cb160', 'cl160', 'cb200', 'cb200t', 'cl200', 'cb125', 'cb125s', 'cl125', 'cl125a', 'sl125', 'tl125', 'cb100', 'cl100', 'sl100', 'cb72', 'cb77', 'cl72', 'cl77', 'cb50v']
  ),
  (
    '00000000-0000-4000-f000-000000000697'::uuid,
    'Honda',
    'CB750',
    NULL,
    NULL,
    ARRAY['cb750', 'cb750c', 'cb750f', 'cb750k', 'cb750a', 'cb550f', 'cb500t', 'ft500', 'cr750']
  ),
  (
    '00000000-0000-4000-f000-000000000698'::uuid,
    'Honda',
    'XR75',
    NULL,
    NULL,
    ARRAY['xr75', 'xr 75', 'xr80', 'xr100', 'xr200', 'xr250', 'xr350', 'xr400', 'xr500', 'xr600', 'xr650l', 'xl70', 'xl75', 'xl80', 'xl100', 'xl125', 'xl175', 'xl250', 'xl350', 'xl350r', 'xl500s', 'xl600v', 'trans alp', 'transalp']
  ),
  (
    '00000000-0000-4000-f000-000000000699'::uuid,
    'Honda',
    'CR250R',
    NULL,
    NULL,
    ARRAY['cr250r', 'cr250', 'cr250m', 'cr125m', 'cr125', 'cr480r', 'cr450r', 'mt125r', 'mt250', 'mr175', 'mr250']
  ),
  (
    '00000000-0000-4000-f000-000000000700'::uuid,
    'Honda',
    'NSR250R',
    NULL,
    NULL,
    ARRAY['nsr250r', 'nsr250', 'ns400r', 'nsr400r', 'nsr50', 'nsr50r', 'nsr 50r', 'ns50f', 'nsf100', 'mb5']
  ),
  (
    '00000000-0000-4000-f000-000000000701'::uuid,
    'Honda',
    'VFR750F',
    NULL,
    NULL,
    ARRAY['vfr750f', 'vfr750', 'vfr 750', 'vfr400', 'vfr400r', 'vfr800', 'vf700s', 'vf750s', 'sabre']
  ),
  (
    '00000000-0000-4000-f000-000000000702'::uuid,
    'Honda',
    'CBR1100XX',
    NULL,
    NULL,
    ARRAY['cbr1100xx', 'super blackbird']
  ),
  (
    '00000000-0000-4000-f000-000000000703'::uuid,
    'Honda',
    'Stepwgn',
    NULL,
    NULL,
    ARRAY['stepwgn', 'city turbo', 'life', 'today', 'vamos']
  ),
  (
    '00000000-0000-4000-f000-000000000704'::uuid,
    'Honda',
    'ATC',
    NULL,
    NULL,
    ARRAY['atc', 'atc70', 'atc90', 'atc110', 'atc125m', 'atc185', 'atc200', 'atc200x', 'atc250r', 'atc350x', 'trx70', 'trx90', 'trx250r', 'fl250', 'fl350r', 'fl400r', 'gyro', 'express', 'hobbit', 'motocompo']
  ),
  -- Expanded Yamaha, Suzuki, Ducati, Triumph, Harley-Davidson, Indian, Henderson
  (
    '00000000-0000-4000-f000-000000000705'::uuid,
    'Yamaha',
    'RD350',
    NULL,
    NULL,
    ARRAY['rd350', 'rd400', 'rd400f', 'rd250', 'rd200', 'rd125', 'rd60', 'rz350', 'rz500', 'rzv500', 'rzv 500r', 'tz250', 'tz250a', 'tz350', 'tz350b', 'tz750', 'td2', 'td3', 'tr2', 'tr3', 'ta125', 'r5', 'ds7', 'yr1', 'yr2']
  ),
  (
    '00000000-0000-4000-f000-000000000706'::uuid,
    'Yamaha',
    'YZ250',
    NULL,
    NULL,
    ARRAY['yz250', 'yz125', 'yz490', 'yz465', 'yz400', 'yz100', 'yz80', 'yz60', 'yz50', 'it490', 'it465', 'it400', 'it250', 'it200', 'it175', 'mx400', 'mx360', 'mx250', 'mx175', 'mx100', 'mx80', 'sc500', 'ty250', 'ty175', 'ty80', 'pw80', 'pw50']
  ),
  (
    '00000000-0000-4000-f000-000000000707'::uuid,
    'Yamaha',
    'DT-1 Enduro',
    NULL,
    NULL,
    ARRAY['dt 1', 'dt1', 'dt400', 'dt360', 'dt250', 'dt175', 'dt125', 'dt100', 'dt80', 'dt50', 'rt1', 'rt2', 'rt3', 'ct1', 'ct2', 'ct3', 'at1', 'at2', 'at3', 'ht1', 'gt80', 'gt1', 'xt500', 'xt500d', 'xt250', 'xt350', 'xt600', 'tt500', 'tt600', 'bw200', 'bw80', 'big wheel 350']
  ),
  (
    '00000000-0000-4000-f000-000000000708'::uuid,
    'Yamaha',
    'XS650',
    NULL,
    NULL,
    ARRAY['xs650', 'xs750', 'xs850', 'xs1100', 'xs400', 'tx650', 'tx500', 'tx750', 'sr500', 'sr400', 'xj650', 'xj750', 'vmax', 'v max', 'rx50']
  ),
  (
    '00000000-0000-4000-f000-000000000709'::uuid,
    'Yamaha',
    'Banshee',
    NULL,
    NULL,
    ARRAY['banshee', 'yfz350', 'yt60', 'ytm200', 'ytm200ern', 'ytm225', 'tri moto', 'tri z', 'yxz1000r', 'blaster', 'raptor', 'warrior']
  ),
  (
    '00000000-0000-4000-f000-000000000710'::uuid,
    'Suzuki',
    'GSX-R',
    NULL,
    NULL,
    ARRAY['gsx r', 'gsxr', 'gs1000', 'gs1000s', 'gs1000sz', 'gs100sz', 'gs1100', 'gs1150', 'gs850g', 'gs750', 'gs550', 'katana', 'hayabusa', 'rg500', 'rg400', 'rgv250', 'gt750', 'gt550', 'gt500', 'gt380', 'gt250', 'gt185', 't500', 't350', 't250', 't20', 're5', 'xn85']
  ),
  (
    '00000000-0000-4000-f000-000000000711'::uuid,
    'Suzuki',
    'RM250',
    NULL,
    NULL,
    ARRAY['rm250', 'rm125', 'rm400', 'rm370', 'rm500', 'rm80', 'tm400', 'tm250', 'tm125', 'tm100', 'tm75', 'ts400', 'ts250', 'ts185', 'ts125', 'ts100', 'ts90', 'ts 90r', 'ts50', 'tc125', 'tc90', 'rv90', 'rv125', 'pe250', 'pe175', 'dr350', 'dr650', 'jr50', 'lt500r', 'lt250r']
  ),
  (
    '00000000-0000-4000-f000-000000000712'::uuid,
    'Suzuki',
    'Samurai',
    NULL,
    NULL,
    ARRAY['samurai', 'sidekick', 'vitara', 'grand vitara', 'x 90', 'x90', 'lj10', 'lj20', 'lj50', 'lj80', 'sj410', 'sj413']
  ),
  (
    '00000000-0000-4000-f000-000000000713'::uuid,
    'Ducati',
    'SuperSport',
    NULL,
    NULL,
    ARRAY['900ss', '750ss', '900sl', '900sd', 'darmah', '851', '888', '907', 'paso', '748', '748l', '800ss', 'leggero', 'st2', 'st3', 'st4', 'st4s', '450 r t', '350 desmo', '250', '175', '125 sport', 'cucciolo']
  ),
  (
    '00000000-0000-4000-f000-000000000714'::uuid,
    'Triumph',
    'Bonneville',
    NULL,
    NULL,
    ARRAY['bonneville', 't120', 't120r', 't120c', 't120tt', 't140', 't140v', 't140e', 't140d', 't110', 't100', 'tr6r', 'tr6c', 'tr5c', 'tr5t', 'twenty one', '3ta', '5ta', 'x 75', 'x75', 'trx75', 'hurricane', '675r', 'bobber tfc', 'dio ambro']
  ),
  (
    '00000000-0000-4000-f000-000000000715'::uuid,
    'Harley-Davidson',
    'FL',
    NULL,
    NULL,
    ARRAY['fl', 'flh', 'flht', 'flhtc', 'flhtcu', 'flhx', 'flhxse', 'flhr', 'flst', 'flstf', 'flstn', 'flstc', 'fx', 'fxr', 'fxrt', 'fxs', 'fxwg', 'fxst', 'fxd', 'xl', 'xlh', 'xlch', 'xr750', 'xr1000', 'wl', 'wla', 'wr', 'wr45', 'ul', 'vl', 'jd', 'je', 'model j', 'model 11f', '9a', '8a', 'ba', 'model ba', 'z90', 'mx 250', 'crtt', 'sprint', 'hummer', 'topper', 'servi car', 'ultra classic', 'arlen ness', 'easyrider']
  ),
  (
    '00000000-0000-4000-f000-000000000716'::uuid,
    'Indian',
    'Chief',
    NULL,
    NULL,
    ARRAY['chief', 'chieftain', 'scout', 'sport scout', '741', '841', 'model 841', 'powerplus', 'hendee', 'camelback', 'single', 'twin', 'board track', 'belt drive', 'model c', 'model k', '8hp', 'me100', 'jc 54', 'mm5a']
  ),
  (
    '00000000-0000-4000-f000-000000000717'::uuid,
    'Henderson',
    'Four',
    NULL,
    NULL,
    ARRAY['four', '4 cylinder', 'deluxe', 'kj', 'kl', 'model e', 'c model', 'model c', 'model g', 'f2', 'b', 'k1000']
  ),
  -- Expanded Classic & JDM Car Marques
  (
    '00000000-0000-4000-f000-000000000718'::uuid,
    'International',
    'Travelall',
    NULL,
    NULL,
    ARRAY['travelall', 'travelette', 'pickup', 'k 1', 'k 2', 'k 3', 'k 5', 'kb 1', 'kb 2', 'kb 3', 'kb 5', 'l 110', 'l 111', 'l 120', 'r 110', 'r110', 'r 120', 's 120', 'c 900', 'c35', 'd 2', 'd2', 'm 2', 'mw', 'metro', 'loadstar', 'fleetstar', 'transtar', 'paystar', 'lonestar', 'cxt', 'mxt', 'coe', 'pangea', 'auto wagon', 'highwheeler']
  ),
  (
    '00000000-0000-4000-f000-000000000719'::uuid,
    'Studebaker',
    'Commander',
    NULL,
    NULL,
    ARRAY['commander', 'president', 'dictator', 'champion', 'lark', 'starlight', 'starliner', 'starlite', 'scotsman', 'wagonaire', 'provincial', 'cruiser', 'daytona', 'gran tourismo', '2r', '3r', '5r', 'e series', 'm series', 'm5', 'm15', 'm16', 'transtar', 'champ', 'zip van', 'model el', 'sf', 'special six', 'big six', 'light six']
  ),
  (
    '00000000-0000-4000-f000-000000000720'::uuid,
    'Auburn',
    '851',
    NULL,
    NULL,
    ARRAY['851', '852', '8 88', '8 90', '8 95', '8 98', '8 100', '8 101', '8 105', '8 115', '8 120', '8 125', '8 125a', '850y', '6 654', '12 160', '12 161', '12 165', 'model 125', 'cabriolet', 'speedster', 'boattail', 'phaeton', 'fooserati']
  ),
  (
    '00000000-0000-4000-f000-000000000721'::uuid,
    'Lola',
    'T70',
    NULL,
    NULL,
    ARRAY['t70', 'mk1', 'mark i', 'mark 1', 't62', 't86 90', 't 86 90', 't92 00', 't96 70', 't97 20', 't100', 't140', 't142', 't160', 't162', 't163', 't165', 't190', 't192', 't210', 't212', 't290', 't292', 't294', 't298', 't330', 't332', 't340', 't342', 't440', 't492', 't540', 't590', 't592', 't594', 't598', 't640', 't644', 'b2k 40', 'b02 00', 'b03 51', '390']
  ),
  (
    '00000000-0000-4000-f000-000000000722'::uuid,
    'Iso',
    'Grifo',
    NULL,
    NULL,
    ARRAY['grifo', 'rivolta', 'lele', 'fidia', 'isetta', 'tipo 8a', 'tta fraschini']
  ),
  (
    '00000000-0000-4000-f000-000000000723'::uuid,
    'AC',
    'Ace',
    NULL,
    NULL,
    ARRAY['ace', 'aceca', 'greyhound', '2 litre', '2 liter', '16 60hp', '16 70hp', '16 80', '16 90hp', '16hp', '10hp', 'sociable', 'brooklands', 'royal', '3000me', 'ura nsx', 'ura integra', 'nsx type s']
  ),
  (
    '00000000-0000-4000-f000-000000000724'::uuid,
    'Mini',
    'Cooper',
    NULL,
    NULL,
    ARRAY['cooper', 'john cooper works', 'jcw', 'moke', 'clubman', 'countryman', 'paceman', 'traveller', 'countryman', 'pickup', 'van', 'mk i', 'mk ii', 'mk iii', 'mk iv', 'mk v', 'mayfair', 'city', 'deluxe', 'ima', 'iii', '5 speed', '4 speed']
  ),
  (
    '00000000-0000-4000-f000-000000000725'::uuid,
    'Willys',
    'CJ',
    NULL,
    NULL,
    ARRAY['cj', 'cj 2a', 'cj2a', 'cj 3a', 'cj3a', 'cj 3b', 'cj3b', 'cj 5', 'cj5', 'mb', 'm38', 'm38a1', 'jeep', 'fc 150', 'fc150', 'fc 170', 'fc170', 'commando', 'j20', '6 90', 'model six', 'knight', 'interlagos']
  ),
  (
    '00000000-0000-4000-f000-000000000726'::uuid,
    'Citroen',
    'DS',
    NULL,
    NULL,
    ARRAY['ds', 'ds19', 'ds20', 'ds21', 'ds23', 'id19', 'id20', 'id20f', 'd super', 'cx', 'cx2200', 'cx2400', 'cx25', 'xm', 'gs', 'gsa', 'bx', 'ami 6', 'ami 8', 'dyane', 'acadiane', 'aks400', '5cv', 'b2', 'b12', 'b14', 'c4', 'c6', 'h van', 'hy', 'deux chaveaux']
  ),
  (
    '00000000-0000-4000-f000-000000000727'::uuid,
    'Renault',
    'R5 Turbo',
    NULL,
    NULL,
    ARRAY['r5 turbo', '5 turbo', '5 gt turbo', 'le car', 'clio v6', 'spider', 'alpine', 'gta', 'r8', '8 gordini', 'r10', 'r12', 'r15', 'r16', 'r17', 'caravelle', 'floride', '4cv', '4l', 'r4', '6cv', '15cv', '16hp', '14 20hp', '1400 kg', 'master', 'dg', 'type jp', 'type pg', 'type cc', 'kj1', 'model pi18']
  ),
  (
    '00000000-0000-4000-f000-000000000728'::uuid,
    'Toyota',
    'ToyoAce',
    NULL,
    NULL,
    ARRAY['toyoace', 'townace', 'liteace', 'dyna', 'stout', 'chinook']
  ),
  (
    '00000000-0000-4000-f000-000000000729'::uuid,
    'Toyota',
    'Soarer',
    NULL,
    NULL,
    ARRAY['soarer', 'celsior', 'aristo', 'altezza', 'chaser', 'mark ii', 'cresta', 'caldina', 'sera', 'will vi', 'classic']
  ),
  (
    '00000000-0000-4000-f000-000000000730'::uuid,
    'Volvo',
    '140 Series',
    NULL,
    NULL,
    ARRAY['142', '142s', '144', '144s', '145', '145s', '164', '164e']
  ),
  (
    '00000000-0000-4000-f000-000000000731'::uuid,
    'Volvo',
    '940 Series',
    NULL,
    NULL,
    ARRAY['940', '960', '740', '760', '780', '240dl', '240gl', 'vnl']
  ),
  (
    '00000000-0000-4000-f000-000000000732'::uuid,
    'Mercury',
    'Sable',
    NULL,
    NULL,
    ARRAY['sable']
  ),
  (
    '00000000-0000-4000-f000-000000000733'::uuid,
    'Volkswagen',
    'Type 181 Thing',
    NULL,
    NULL,
    ARRAY['kubelwagen', 'kübelwagen', 'type 82', 'schwimmwagen', 'type 166', 'iltis', 'type 147', 'fridolin', 'sp2', 'brasilia', 'xl1', 'caddy', 'polo', 't3 doka']
  ),
  (
    '00000000-0000-4000-f000-000000000734'::uuid,
    'Dodge',
    'Shelby Charger',
    NULL,
    NULL,
    ARRAY['shelby charger', 'shelby glhs', 'shelby csx', 'shelby csx vnt', 'omni glh', 'omni glhs', 'turbo charger']
  ),
  (
    '00000000-0000-4000-f000-000000000735'::uuid,
    'Dodge',
    'Series 116',
    NULL,
    NULL,
    ARRAY['series 116', 'standard six', 'victory six', 'senior six', 'brothers', '30 35']
  )
ON CONFLICT (id) DO UPDATE
SET
  make = EXCLUDED.make,
  canonical_model = EXCLUDED.canonical_model,
  year_start = EXCLUDED.year_start,
  year_end = EXCLUDED.year_end,
  aliases = EXCLUDED.aliases;
