-- Slice 27: Expand sub-model coverage across 36 European, British, American, and motorcycle
-- collector marques (Austin, BSA, Ducati, Fiat, Honda, International, Packard, Triumph, AMC,
-- Rover, Rupp, Norton, Ariel, Cushman, Daimler, Hudson, KTM, Moto Guzzi, MV Agusta, Vespa,
-- Husqvarna, Bultaco, Wolseley, Riley, NSU, Rambler, Peugeot, Puch, Crosley, Isuzu, Singer,
-- REO, Studebaker, Willys, Morris, Nash).

-- 1. Austin
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '20hp', '100 6', 'pickup', 'heavy twelve', 'american', 'k4', 'morris minor',
      'custom pickup', 'six', 'minor', '12 6', 'venturer', 'somerset', '7hp',
      'london', '8cwt', 'westminster', 'a110', 'cambrian', 'morris 1000',
      'chummy', 'junior forty', 'se7en', 'sprite', 'fx 3', 'dorset', 'ten',
      'fx4d', 'vanden plas', 'marina', '14 6', '8hp', 'metro', 'ambassador',
      '18hp', '1300gt'
    ]
  )
WHERE lower(make) = 'austin'
  AND canonical_model = 'A30';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['mini cooper', 'cooper'])
WHERE lower(make) = 'austin'
  AND canonical_model = 'Mini';

-- 2. BSA
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'dbd34', 'q8', 'empire star', 'tw 33 10', 'tw33 1', 'tw32 9', 'rickman',
      'w34 2', 'w34 7', 'm33', 'gs', 'rgs', 'a650', 'golden flash', 'b32',
      'standard', 'b25s', 'b29', 'model k', 'b20', 'q7', '349cc', 'b40fb',
      'c15t', 'cyclone', 'starlite', 'beagle', '441v', '500 single', 'trail bronco',
      'c10l', 'ariel 3', 'dandy'
    ]
  )
WHERE lower(make) = 'bsa'
  AND canonical_model = 'Gold Star';

-- 3. Ducati
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '860', '350 sport', 'mkiii', '350 sebring', '350', 'diana', 'monza junior',
      'cruiser', '200', 'imola', 'elite 200', '200 elite', '955', 'gran sport',
      'walt siegl', 'mark 3', 'desertx', '450 jupiter', 'sport 1000s', '400 f3',
      '100 sport', '200 turismo', 'pantah', 'mach 1', '125s', '350ss', 'sport 48',
      '450', 'sport desmo', '125', '400ss', 'road 350', 'mototrans', 'cafe racer',
      'ts98', 'st3s', 'falcon 50', '600ss'
    ]
  )
WHERE lower(make) = 'ducati'
  AND canonical_model = 'SuperSport';

-- 4. Fiat
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'project', '5 speed', '4 speed', 'siata 750', 'stabilimenti farina',
      'pinin farina', 'roadster', 'multipla', 'bianchina', 'transformable',
      '1100es', 'gipsy', '110', '525n', 'tipo 1a', '1200tv', '1100b', '508',
      'balilla', '127', 'trasformabile', '18p', '2300', 'nuova', 'cabriolet',
      'tipo 2b', 'vetture speciali', 'millecento', '103e', '238'
    ]
  )
WHERE lower(make) = 'fiat'
  AND canonical_model = '500';

-- 5. Honda
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'vtr1000f', 'vtr1000', 'super hawk', 'superhawk', 'firestorm', 'ns50f',
      'nx250', 'nx 250', 'cb450f', 'vfr750r', 'cb125', 'cb 125', 'cb125ss',
      'rs600', 'rc125', 'cbr 1000', '600', '125', 'nc35', 'vfr 400', 'rvf400',
      'cx650t', 'rvt1000r', 'ac15', 'dream50', 'cyb77', 'vf 1000r', 'cb1100rc',
      'cb550p', 'vt500ft', 'cb92', 'cbr900rry', 'cbr900rrx', 'cbr900rrp',
      'k5 750', '750k5', 'ft500c', 'ft 500', 'ascot', '350 sl', 'cl300',
      'hawk 305', 'cmx450c', 'rebel', 'nsr80', 'cb 750', '450', 'dn 01',
      'mb5s', '900 super sport', 'ns250r', 'r550', 'ns1', 'ns 1', 'mvx250f',
      '400f', '400 ss', 'nsf', 'vt1300', 'vt1300cx', 'fury', 'ctx700n',
      'vfr1000', 'st1300a', 'sl 175', 'cbr600f2', 'cbr600fs', 'cbr 600f',
      'cx500tc', 'cx500c', 'cbr400rr', 'four', 'vfr 800', '750 super sport',
      'vfr1200f', 'cb600f', 'c92', 'magna', 'gb400', 'gb500tt', 'v65', 'vf500f',
      '750 four', 'ss125a', 'nt 650', 'cb450sc', 'rs125', '450 hawk', 'nighthawk',
      'v45', 'vf750c', 'vtx1800', 'k1', 'vfr700', 'vt750', 'shadow', 'vt250',
      'vt1100c', '175', 'vtr250', 'cl90l', 'cm 400', 'cb360g', '125s',
      'vt800c', '450 scrambler', 'cj360t', 'scambler', 'race bike'
    ]
  )
WHERE lower(make) = 'honda'
  AND canonical_model = 'CB750';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'xl500s', 'tg50', 'xl125', 'xr100r', 'crf50f', 'zb50s', 'z50rs', 'xl350r',
      'xl 350', 'crf450rx', 'xr 600r', 'cub', 'cub 90', 'c 50', 'ca102',
      'mt 250', 'rtl 300r', 'rtl300r', 'cr80', 'cr85r', 'xr650l', 'trackmaster',
      'xl600v', 'transalp', 'crf 110f', 'cr60', 'cr60r', 'fm', 'sl', 'crf300l',
      'xr200', 'spree', 'tlr250', 'qa 50', 'qa', 'xl80s', 'crf250l', 'ct50',
      'trail 125', 'crf450r', 'xr75k1', 'ruckus', '110 trail', 'super 90',
      'trail 50', 'xr70r', 'ps250', 'ca', 'xr500r', 'xr250r', 'crf230l',
      'tl125s', 'elite 80', 'xl100s', 'custom minibike', 'zook', 'p50',
      'aero 50', 'tb07'
    ]
  )
WHERE lower(make) = 'honda'
  AND canonical_model = 'CT90';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'pilots', 'talon', 'us90', 'atc350x', '350x', '250r', 'trx500r', 'trx250ex',
      '185s', '3 wheeler', '250es', 'rancher', 'trx350', 'atc200e', 'sportrax',
      'trx90'
    ]
  )
WHERE lower(make) = 'honda'
  AND canonical_model = 'ATC';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'acty', 'ra107', 'reynard', 'legend', 'tn360', 'orthia', 'az600', 's mx',
      'vigor', 'city', 'torneo', 'logo', 'horizon', 'concerto', 's'
    ]
  )
WHERE lower(make) = 'honda'
  AND canonical_model = 'Civic';

-- 6. International
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'custom', 'smta', 'pangea', 'armored truck', 'hauler', 'resto mod',
      'rat rod', 'pick up', 'b120', 'b 120', 'freightliner', 'car hauler',
      'dt4700', '4900', '1100', 'b3', '200', '1300d', 'starcraft', '1026',
      '1100a', 'l110', 'panel truck', '1466', '656', '1486', 'series 200',
      'c1200', 'm62', 'r185', '1 5 ton', 'auto buggy', '666', '1100d',
      'wagonmaster', 'high wheeler', '340', '1300b', '1100c', 'l200', 'aw 1',
      'r100', '1724', '1100bb', 'dump truck', 'n a', '560', 'six speed',
      'kb5', '1000a', '766', '350', 'd 1100', 'passenger bus', 'kb3',
      'custom flatbed', 's 160', 'a 100', 'conco', 'l 130', '284', 't 6',
      'd30', 'model h', '4200', 's series', 'sf24'
    ]
  )
WHERE lower(make) = 'international'
  AND canonical_model = 'Travelall';

-- 7. Packard
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'woody', 'coupe', 'street rod', 'standard 8', '833', 'model 426',
      'series 426', '4 door', 'fire engine', 'hearse', '2 door coupe',
      'standard', 'model ec', 'bill miller', '4m 2500', '1402', 'opera coupe',
      'v12', 'carribean', 'supereight', 'model 326', 'sports coupe', 'deluxe 8',
      'series 2301', 'henney', 'truck', 'four hundred'
    ]
  )
WHERE lower(make) = 'packard'
  AND canonical_model = 'Super Eight';

-- 8. Triumph
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'tr25w', 'works tt', 'flat track', 'flat tracker', 'street tracker',
      'tt deluxe', 't150v', 'bobber', '3 5 hp', 'alf hagon', '750',
      'trackmaster', 't20', 't15', 't90', 't140le', '3hw', 'tr100', 't20m',
      'model 21', 't100ss', 't 140', 'tr5mx', 't20s', '3s', 'tt', 'trailblazer',
      'trail blazer', 'xv 1', '850 chopper', 't140es', 't25t', 't25', 'redline',
      'contessa', '4hp', '1200se', '1200 xe', 'american', 't100sr', '225cc',
      '249cc'
    ]
  )
WHERE lower(make) = 'triumph'
  AND canonical_model = 'Bonneville';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'convertible', 'tr 7', 'brooklands', 'formosa', 'resto mod', 'gloria',
      'gtr4', 'tr 3a', 'roadster', 'sports 6', '10 sedan', '1500', 'project',
      'super eight', 'scorpion', 'ferrari replica', 'avenger', '2 5pi', 'special sports'
    ]
  )
WHERE lower(make) = 'triumph'
  AND canonical_model = 'TR6';

-- 9. AMC
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'austin', 'jeep', 'cj 5', 'cj5', 'cj7', 'cj 7', 'ironhorse', 'retro red',
      'revolution', 'patriot', '3 wheeler', 'lafrance', '2 door sedan',
      'general', 'scrambler', 'bantam', 'amjv', 'dream', 'woody', 'custom',
      '65 super', 'metropolitan', 'mini moke', 'e wagon', 'pace', 'roadster'
    ]
  )
WHERE lower(make) = 'amc'
  AND canonical_model = 'Hornet';

-- 10. Rover
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '12hp', '6hp', '95', '14hp', 'twenty', '214gsi', '60', '14 6', '3 5 hp',
      'plas', 'range rover', 'ten', '2 litre', '15hp', '12 14hp', '3 5 litre',
      '10 25hp', '16 50hp', '4 speed', 'maestro', 'sixteen', '220', '16hp',
      '216efi', '820', '80', '827', '105r', 'metro', 'regency', 'streetwise'
    ]
  )
WHERE lower(make) = 'rover'
  AND canonical_model = 'Mini';

-- 11. Rupp
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'enduro', 'dart kart', 'dart', 'dart cart', 'monza', 'super k', 'chevy jr',
      'chevy junior', 'a bone', 'tt', 'tt 500', 'go joe', 'lancer', 'grand a',
      'xl 350', '125 mx', 'goat', 'mean machine', 'd', 'sno sport', 'bandit',
      'mini bike'
    ]
  )
WHERE lower(make) = 'rupp'
  AND canonical_model = 'Roadster';

-- 12. Norton
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'electra', 'hi rider', '750', 'production racer', 'model 20', 'john player',
      'p 11', 'model 18', 'nomad', 'daytona', 'big 4', '500t', '88ss',
      'interstate', 'evan wilcox', '850', '650ss', 'manxman', 'n15cs', 'g15cs',
      'trials'
    ]
  )
WHERE lower(make) = 'norton'
  AND canonical_model = 'Commando';

-- 13. Ariel
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'square 4', 'hs', 'leader', 'model e', 'tourist trophy', 'kha', 'single',
      'ace', 'vha', '4g', 'cyclone', 'huntmaster', '350cc', '249cc', '247cc',
      '3', '49cc', 'pixie'
    ]
  )
WHERE lower(make) = 'ariel'
  AND canonical_model = 'Square Four';

-- 14. Cushman
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'highlander', '765', 'package kar', 'mailster', 'pickup', 'scooter',
      'pop cart', 'haulster', 'trackster', 'package cart', 'stake kar',
      '30 series', 'box kar', 'series 50', 'autoglide', '52', 'series 65',
      'allstate', 'road king', 'golfster', 'minute miser'
    ]
  )
WHERE lower(make) = 'cushman'
  AND canonical_model = 'Eagle';

-- 15. Daimler
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'sovereign', 'majestic', 'einspur', 'tb22', 'el24', 'landaulette', '40hp',
      '4 litre', 'b type', 'light 20', '16hp', '16 55hp', '20 70hp', 'century',
      'special sports', 'ts 6 30', 'empress', 'tl30', 'lq20', 'ck 22', 'type q',
      'de27', 'one o four', 'regency', 'consort', 'v8', 'vanden plas'
    ]
  )
WHERE lower(make) = 'daimler'
  AND canonical_model = 'SP250';

-- 16. Hudson
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'rambler', 'murphy', 'great eight', 'great 8', 'stratton', 'custom eight',
      'deluxe', 'essex', '112', 'super jet', 'model r', 'metropolitan',
      'model t', 'rumble seat', 'model 20', 'jet liner', 'coupe', 'series 20',
      'jet', 'six'
    ]
  )
WHERE lower(make) = 'hudson'
  AND canonical_model = 'Hornet';

-- 17. KTM
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'jackpiner', '200', '1290', '400', '390', '525', '890', '1190', 'rc8r',
      '495', 'adventure', 'super duke', 'rc8', 'super enduro', '520', '420',
      'mc5', 'mc80', 'rc390', 'duke', 'penton', 'superspinne', '640', '505',
      '600', '65'
    ]
  )
WHERE lower(make) = 'ktm'
  AND canonical_model = 'X-Bow';

-- 18. Moto Guzzi
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'lodola', 'v50', 'cardellino', 'zigolo', '498cc', '500', 'normale',
      'astore', 'single', 'gtv', 'gts 500', 'cx100', 'airone', 'daytona',
      'v11', 'v700', '850 t3', 'v750', 'small street', 'centauro', 'v10',
      '254', 'griso', 'v65tt', 'audace', 'lemans', 'stone', 'v1000', 'galletto'
    ]
  )
WHERE lower(make) = 'moto guzzi'
  AND canonical_model = 'V7 Sport';

-- 19. MV Agusta
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'walt siegl', 'f3', '150 rs', '750s', 'superveloce', 'f4cc', 'disco volante',
      '1100', 'scrambler', 'ipotesi', 'rivale', 'super pullman', 'stradale',
      'turismo rapido', 'racer', 'turismo veloce', 'germano', 'cst 175',
      'tr125', 'rapido', 'tre55', '83 sport', '250b', 'mini racer', '175'
    ]
  )
WHERE lower(make) = 'mv agusta'
  AND canonical_model = '750 S';

-- 20. Vespa
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'p200e', 'px150e', 'p150x', 'lx150', 'v31t', 'gts 250', 'gs160', 'vl1',
      'sei giorni', 'vna', 'px150', 'gts 300ie', '150vbb', 'p125x',
      'granturismo', 'gt60', '100 sport', 's150', 'piaggio', 'ciao', 'si', 'gl'
    ]
  )
WHERE lower(make) = 'vespa'
  AND canonical_model = '400';

-- 21. Husqvarna
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'model 180', '450', '175sc', 'cr450', '200gp', 'golden arrow', 'norden',
      '450 wr', '450 cr', 'model 27', '250gp', 'te 610', 'te 450', '510',
      'husqvarna', 'te 310', 'mh', 'cr360', '405', 'cr125', 'mj', '450 tc',
      'mf', '390wr', 'm1'
    ]
  )
WHERE lower(make) = 'husqvarna'
  AND canonical_model = '400 Cross';

-- 22. Bultaco
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'lobito', 'model 23', 'el bandido', 'bandido', 'el bandito', 'metisse',
      'mercurio', 'tss', 'mk7', '350', '250', 'el tigre', 'el montadero',
      '360 tss', 's100'
    ]
  )
WHERE lower(make) = 'bultaco'
  AND canonical_model = 'Pursang';

-- 23. Wolseley
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'tonneau', '8hp', '16 60hp', '16 20', '16 20hp', '24 30hp', '5hp',
      'super six', 'cr type', '20hp', '6 110', 'sixteen', 'ten', 'seven',
      '16 35hp', 'six eighty', '16 60', '21 60hp', 'ii saloon', '18 85',
      '18 80', '16hp', 'six', '1100'
    ]
  )
WHERE lower(make) = 'wolseley'
  AND canonical_model = '10 HP';

-- 24. Riley
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'falcon', '1 5', 'big four', 'special roadster', '15 6', 'treen', 'rm',
      'forecar', 'sprint car', 'drophead coupe', '2 6', 'alvis special',
      '12 6', '11 40', 'saloon', 'nine', 'kestrel', 'imp', 'sprite', '1 5 litre',
      '2 5 litre', 'brooklands', 'lynx', 'pathfinder', 'elf'
    ]
  )
WHERE lower(make) = 'riley'
  AND canonical_model = 'MPH';

-- 25. NSU
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'quickly', 'sportmax', 'prima', 'supermax', 'super max', 'v twin',
      '601 osl', 'ro', '501 osl', 'ro 80', '251 osb', 'max', '1200c', 'quick',
      'super fox', 'fox'
    ]
  )
WHERE lower(make) = 'nsu'
  AND canonical_model = 'Prinz';

-- 26. Rambler
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'cross country', '660', 'model e', 'wagon', 'model 34', 'custom',
      'model 63', 'hurst', 'horseless carriage', 'special', 'country club',
      'station wagon', 'javelin', '330', 'six', 'big six', '220'
    ]
  )
WHERE lower(make) = 'rambler'
  AND canonical_model = 'American';

-- 27. Peugeot
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'quadrilette', 'baby', 'moto legere', 'type 161', 'd4a', '4 door sedan',
      'p 107', '14 18hp', '190s', 't 174', '309gti', '201b', 'p105', 'q3a',
      'p108', '201e', '57', '605', '104', '102', '206', '50cc'
    ]
  )
WHERE lower(make) = 'peugeot'
  AND canonical_model = '205';

-- 28. Puch
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'allstate', 'sport mkii', 'm125', '240gd', '300gd', 'sr 150', 'newport',
      'magnum', 'austro daimler', 'ganna', 'styriette', '125rl', 'mv50', 'm50'
    ]
  )
WHERE lower(make) = 'puch'
  AND canonical_model = '230GE';

-- 29. Crosley
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'firetruck', 'wagon', 'gardner', 'cc', 'hot rod', 'series cc', 'h mod',
      'c21', 'woody', 'ss', 'coupe', 'midget', 'trike'
    ]
  )
WHERE lower(make) = 'crosley'
  AND canonical_model = 'Hotshot';

-- 30. Isuzu
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'bighorn', 'nqr', 'bellett', 'pa nero', 'safari', 'amigo', 'reach',
      'fargo', 'i mark', 'p up', 'pup', 'hombre', 'bellel'
    ]
  )
WHERE lower(make) = 'isuzu'
  AND canonical_model = 'VehiCROSS';

-- 31. Singer
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '10 26hp', 'motorwheel', 'special project', 'le mans', 'series 4a',
      '10hp', '8hp', 'junior', 'sm 1500', 'monarch', 'model 9'
    ]
  )
WHERE lower(make) = 'singer'
  AND canonical_model = 'Nine Le Mans';

-- 32. REO
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'model b', '18 20hp', 'runabout', 't6e', 'racer', '16 20hp', '675l',
      '16hp', 'model h', 'seven passenger', 'model r', 'model m', 'chevron', 'm'
    ]
  )
WHERE lower(make) = 'reo'
  AND canonical_model = 'Speedwagon';

-- 33. Studebaker
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'ii', 'pickup', 'station wagon', 'roadster', 'delivery wagon',
      'street rod', 'model er', 'standard six', '2r16', 'wagon', 'eb',
      'convertible', '20hp', 'r5', 'indy', 'six series', 'model sd', 'hearse',
      'model ec', 'touring', 'erskine', 'police car', '2e 28', 'commando',
      'ed', 'midget', '2r17', 'm29c', 'weasel', 'model 51', 'victoria',
      'm35', 'ed 6'
    ]
  )
WHERE lower(make) = 'studebaker'
  AND canonical_model = 'Commander';

-- 34. Willys
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'jeep', '6 90', 'model six', 'truck', '2 door sedan', 'n a', 'commando',
      'sport', 'utility', 'm201', 'm38', 'm 38a1', 'unknown', 'convertible',
      'aero', 'scooter', 'kias'
    ]
  )
WHERE lower(make) = 'willys'
  AND canonical_model = 'CJ';

-- 35. Morris
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'oxford', '8', 'moke', 'minor', '10 4', 'station wagon', 'panel truck',
      'twenty', '10 6', 't type', '12 4', '10hp', '8hp', '8 series', 'cvf'
    ]
  )
WHERE lower(make) = 'morris'
  AND canonical_model = 'Minor';

-- 36. Nash
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'model 3248', 'custom wagon', 'custom sedan', '482r', 'legion',
      'custom 2 door', 'cross country', 'convertible', 'standard eight',
      '400', 'special', 'touring', '600', 'model 3148', '325', 'light six',
      'coupe', 'metro', 'model 696', 'american', 'taxi', '480'
    ]
  )
WHERE lower(make) = 'nash'
  AND canonical_model = 'Metropolitan';

-- 37. Key 20 additional collector, replica, cyclecar, and powersports marques
INSERT INTO public.canonical_models (
  id, make, canonical_model, year_start, year_end, aliases
)
VALUES
  ('00000000-0000-4000-f000-000000001082'::uuid, 'Classic', 'Sebring', NULL, NULL, ARRAY['sebring', 'sebring mx', 'roadsters', 'classic speedster', 'speedster', 'cobra replica', 'grand duchess', 're creation']),
  ('00000000-0000-4000-f000-000000001083'::uuid, 'Big', 'Dog', NULL, NULL, ARRAY['dog', 'mastiff', 'coyote', 'ridgeback', 'chopper', 'bear sled', 'moon wagon']),
  ('00000000-0000-4000-f000-000000001084'::uuid, 'New', 'Hudson', NULL, NULL, ARRAY['hudson', 'autocycle', 'imperial', 'model 46', 'model 23', 'model d', 'big six', 'holland']),
  ('00000000-0000-4000-f000-000000001085'::uuid, 'Auto', 'Union 1000', NULL, NULL, ARRAY['union 1000', '1000 sp', 'wanderer', 'dkw', 'munga', 'vemaguet', 'sonderklasse', 'union sp', 'red bug']),
  ('00000000-0000-4000-f000-000000001086'::uuid, 'Evolution', 'D5', NULL, NULL, ARRAY['d5', 'd5 ranger', 'forester', 'classic 4', 'maverick', 'golf cart']),
  ('00000000-0000-4000-f000-000000001087'::uuid, 'Thunder', 'Ranch 550 Spyder', NULL, NULL, ARRAY['ranch', '550a spyder', 'rsk spyder', 'speedster', '550 spyder', 'roadster 600']),
  ('00000000-0000-4000-f000-000000001088'::uuid, 'Mobile', 'Steamer', NULL, NULL, ARRAY['steamer', '6hp', 'two seater']),
  ('00000000-0000-4000-f000-000000001089'::uuid, 'Belly', 'Tank Lakester', NULL, NULL, ARRAY['tank lakester', 'lakester', 'drop tank']),
  ('00000000-0000-4000-f000-000000001090'::uuid, 'London', 'Taxi FX4', NULL, NULL, ARRAY['fx4', 'fairway', 'taxi', 'txii', 'sterling limousine', 'limousine']),
  ('00000000-0000-4000-f000-000000001091'::uuid, 'Can', 'Am Spyder', NULL, NULL, ARRAY['spyder', 'spyder rt', 'spyder st', 'defender max', 'maverick x3']),
  ('00000000-0000-4000-f000-000000001092'::uuid, 'Pop', 'Dreyer Midget', NULL, NULL, ARRAY['dreyer midget', 'dryer midget', 'midget', 'sprint car']),
  ('00000000-0000-4000-f000-000000001093'::uuid, 'Spider', 'Veloce', NULL, NULL, ARRAY['veloce', 'spider veloce']),
  ('00000000-0000-4000-f000-000000001094'::uuid, 'Van', 'Diemen', NULL, NULL, ARRAY['diemen', 'formula continental', 'rf01', 'rf94', 'pelt white']),
  ('00000000-0000-4000-f000-000000001095'::uuid, 'Commuter', 'Comuta-Car', NULL, NULL, ARRAY['comuta car', 'vehicles comuta car']),
  ('00000000-0000-4000-f000-000000001096'::uuid, 'Ride', 'Turf Rider', NULL, NULL, ARRAY['turf rider', 'turf rider iv']),
  ('00000000-0000-4000-f000-000000001097'::uuid, 'Correct', 'Craft Ski Tique', NULL, NULL, ARRAY['ski tique', 'compact skier', 'debonnaire', 'craft']),
  ('00000000-0000-4000-f000-000000001098'::uuid, 'Princess', 'DM4 Limousine', NULL, NULL, ARRAY['dm4 limousine', 'dm4', 'vanden plas', '4 litre r']),
  ('00000000-0000-4000-f000-000000001099'::uuid, 'Smith', 'Flyer', NULL, NULL, ARRAY['flyer', 'motorwheel', 'biplane', 'cyclecar']),
  ('00000000-0000-4000-f000-000000001100'::uuid, 'Ski', 'Doo Alpine', NULL, NULL, ARRAY['doo alpine', 'alpine', 'chateau', 'renegade enduro', 'doo']),
  ('00000000-0000-4000-f000-000000001101'::uuid, 'Spirit', 'Wetbike', NULL, NULL, ARRAY['wetbike', 'marine wetbike', 'electric carriage'])
ON CONFLICT (id) DO UPDATE
SET
  make = EXCLUDED.make,
  canonical_model = EXCLUDED.canonical_model,
  year_start = EXCLUDED.year_start,
  year_end = EXCLUDED.year_end,
  aliases = EXCLUDED.aliases;

