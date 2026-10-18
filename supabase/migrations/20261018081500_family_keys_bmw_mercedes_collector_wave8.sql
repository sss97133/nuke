-- Slice 24: Fix BMW Motorrad spaceless model codes + BMW E36/E28/E24/E9/2000CS aliases,
-- expand Mercedes-Benz W123/W124/W126/W111/Ponton/SUV model codes, expand Austin, BSA,
-- Kawasaki, Husqvarna, John Deere, Morris, and Ford tractor/classic families, and key 95
-- zero-family collector, brass-era, cyclecar, racing, and vintage motorcycle marques.

-- 1. Update Mercedes-Benz families with missing chassis/model codes
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['230e', '230c', '230te', '280te', '260e', '200e', '200', 'e290', 'e300d', 'e280', 'e220']
  )
WHERE lower(make) = 'mercedes-benz'
  AND canonical_model = 'E-Class';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['230s', '220sb', '350sd', '350se', '400se', '400sel', '500se', '500s', '600se', 's55']
  )
WHERE lower(make) = 'mercedes-benz'
  AND canonical_model = 'S-Class';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['180', '180b', '180d', '190c', '190db', '190dc', '219', 'o319', '207d', '308', 'gazelle', '170b']
  )
WHERE lower(make) = 'mercedes-benz'
  AND canonical_model = '220';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['c220', 'c63s', 'cla250', 'a160', 'b250e']
  )
WHERE lower(make) = 'mercedes-benz'
  AND canonical_model = 'C-Class';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['cl55'])
WHERE lower(make) = 'mercedes-benz'
  AND canonical_model = 'CL';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['r320'])
WHERE lower(make) = 'mercedes-benz'
  AND canonical_model = 'R-Class';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['gl320', 'glc300', 'gle43', 'gle300d'])
WHERE lower(make) = 'mercedes-benz'
  AND canonical_model = 'GL';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['ml250', 'ml450', 'ml58', 'ml'])
WHERE lower(make) = 'mercedes-benz'
  AND canonical_model = 'M-Class';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['cls63', 'cls'])
WHERE lower(make) = 'mercedes-benz'
  AND canonical_model = 'CLS-Class';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['320sl', 'sl500r', 'sl560', 'sl72', 'sl73'])
WHERE lower(make) = 'mercedes-benz'
  AND canonical_model = 'SL';

-- 2. Update BMW car families with missing compact/touring/coupe/Motorrad codes
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['323ti', '318ti', '318tds', '324td', '316'])
WHERE lower(make) = 'bmw'
  AND canonical_model = '318ti';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['525tds', '525it', '520i'])
WHERE lower(make) = 'bmw'
  AND canonical_model = '525i';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['m535i', 'm540i'])
WHERE lower(make) = 'bmw'
  AND canonical_model = '535i';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['630csi', '635', '650', 'b6'])
WHERE lower(make) = 'bmw'
  AND canonical_model = '635CSi';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['1502', '2000c', '2000cs', '3200 cs', 'klasse'])
WHERE lower(make) = 'bmw'
  AND canonical_model = '2002';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['740ld', '735il', '733', '728i', '745'])
WHERE lower(make) = 'bmw'
  AND canonical_model = '740i';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['128ci', '128', '135', 'i3s'])
WHERE lower(make) = 'bmw'
  AND canonical_model = '128i';

-- 3. Insert new canonical_models rows for BMW Motorrad + major-marque expansions + 95 collector marques
INSERT INTO public.canonical_models (
  id, make, canonical_model, year_start, year_end, aliases
)
VALUES
  -- BMW Motorrad spaceless + spaced aliases
  (
    '00000000-0000-4000-f000-000000000736'::uuid,
    'BMW',
    'R100',
    NULL,
    NULL,
    ARRAY['r100s', 'r100rt', 'r100cs', 'r100r', 'r100t', 'r100rs', 'r100gs', 'r100', 'r80rt', 'r80st', 'r80gs', 'r65', 'r65ls', 'r60us', 'r 60 2', 'r68', 'r67', 'r50s', 'r51 3', 'r51', 'r25', 'r11']
  ),
  (
    '00000000-0000-4000-f000-000000000737'::uuid,
    'BMW',
    'R1200',
    NULL,
    NULL,
    ARRAY['r1200s', 'r1200rt', 'r1200c', 'r1200cl', 'r1200r', 'r1200rs', 'r1200st', 'r1200gs', 'r1100s', 'r1100rt', 'r1100rs', 'r1100r', 'r1100gs', 'r1150gs', 'r1150rt', 'r1150r', 'r1150rs', 'r18', 'r nine t', 'rninet']
  ),
  (
    '00000000-0000-4000-f000-000000000738'::uuid,
    'BMW',
    'K1200',
    NULL,
    NULL,
    ARRAY['k1200s', 'k1200rs', 'k1200gt', 'k1200lt', 'k1200r', 'k1300s', 'k1300r', 'k1300gt', 'k1600', 'k1600gt', 'k1600gtl', 'k100rs', 'k100rt', 'k100lt', 'k100', 'k1100lt', 'k1100rs', 'k1100', 'k75rt', 'k75c', 'k75s', 'k75']
  ),
  (
    '00000000-0000-4000-f000-000000000739'::uuid,
    'BMW',
    'F650GS',
    NULL,
    NULL,
    ARRAY['f650gs', 'f650 gs', 'f650', 'f650cs', 'f700gs', 'f750gs', 'f800gs', 'f800gt', 'f800r', 'f800s', 'f800st', 'f850gs', 'f900r', 'f900xr', 'g650', 'g650gs', 'g450x', 'g310gs', 'g310r', 's1000rr', 's1000xr', 's1000 xr', 's1000r', 'm1000r']
  ),
  -- Austin, BSA, Kawasaki, Husqvarna, John Deere, Morris, Ford expansions
  (
    '00000000-0000-4000-f000-000000000740'::uuid,
    'Austin',
    'A30',
    NULL,
    NULL,
    ARRAY['a30', 'a35', 'a40', 'a50', 'a55', 'a60', 'a70', 'a90', 'a95', 'a99', 'a105', 'a125', 'a135', 'america', 'minivan', '1100', '1300', '1800', 'princess', 'allegro', 'maestro', 'montego', 'champ', 'gipsy', 'fx3', 'fx4', 'taxicab', '12 4', '16 6', '10 4', '10hp', '12hp', '16hp', '7', 'seven']
  ),
  (
    '00000000-0000-4000-f000-000000000741'::uuid,
    'BSA',
    'A65 Lightning',
    NULL,
    NULL,
    ARRAY['a65', 'a50', 'a7', 'a7s', 'a10', 'shooting star', 'royal star', 'lightning', 'thunderbolt', 'spitfire', 'firebird', 'hornet', 'rocket 3', 'a75', 'b50', 'b50mx', 'b44', 'b40', 'b25', 'b31', 'b33', 'c15', 'starfire', 'victor', 'bantam', 'd1', 'd7', 'm20', 'm21', 'c11', 'c12', 'sloper', '10hp', 'scout']
  ),
  (
    '00000000-0000-4000-f000-000000000742'::uuid,
    'Kawasaki',
    'KZ1000',
    NULL,
    NULL,
    ARRAY['kz1000', 'kz900', 'kz750', 'kz650', 'kz550', 'kz440', 'kz400', 'kz1300', 'z1', 'z1r', 'z900', 'z1000', 'gpz550', 'gpz750', 'gpz900r', 'gpz1100', 'zr1100', 'zephyr', 'zrx1100', 'zrx1200', 'w1', 'w2', 'w650', 'w800', 'vulcan', 'concours', 'eliminator']
  ),
  (
    '00000000-0000-4000-f000-000000000743'::uuid,
    'Kawasaki',
    'KX250',
    NULL,
    NULL,
    ARRAY['kx250', 'kx125', 'kx500', 'kx400', 'kx420', 'kx80', 'kx60', 'kdx200', 'kdx250', 'kdx175', 'kdx80', 'klx250', 'klx300', 'klx650', 'klr650', 'klr250', 'kt250', 'f7', 'f9', 'f81m', 'f11', 'f5', 'f6', 'bighorn', 'centurion', 'g31m', 'g3tr', 'g 4', 'g4tr', 'g5', 'ke100', 'ke175', 'ke250', 'kd100', 'kd80', 'kv75', 'mt1', 'ar50', 'ar80', 'ae50', 'c2ss', 'kh250b', 'kh400', 'kh500', 's1', 's2', 's3', 'h1', 'a1', 'a7', 'kxf', 'tecate']
  ),
  (
    '00000000-0000-4000-f000-000000000744'::uuid,
    'Husqvarna',
    '250 CR',
    NULL,
    NULL,
    ARRAY['360', '400cr', '430cr', '450cr', '250cr', '125cr', '500cr', 'wr400', 'wr250', 'wr360', 'wr430', 'xc250', 'xc400', 'xc500', 'cr250', 'cr390', 'cr400', 'cr430', 'cr500', 'or390', '701', 'svartpilen', 'vitpilen', 'te300', 'fe501', 'mx', 'silverpilen']
  ),
  (
    '00000000-0000-4000-f000-000000000745'::uuid,
    'John Deere',
    'Model B',
    NULL,
    NULL,
    ARRAY['620', '530', '430', '420', '320', '720', '730', '820', '830', '70', '60', '50', '40', '40v', 'a', 'b', 'd', 'g', 'h', 'm', 'mt', 'r', 'li', 'bo', 'br', 'ar', 'ao', 'bwh', 'bw', 'hn', '1010', '2010', '3010', '3020', '4010', '4020', 'gator', 'buck', 'patio']
  ),
  (
    '00000000-0000-4000-f000-000000000746'::uuid,
    'Morris',
    'Cowley',
    NULL,
    NULL,
    ARRAY['cowley', 'oxford', 'eight', 'ten', 'twelve', 'fourteen', 'six', 'isis', 'major', 'marina', 'ital', 'mini', 'commercial', 'j type', 'j2', 'j4', '11 9hp', '17 7hp']
  ),
  (
    '00000000-0000-4000-f000-000000000747'::uuid,
    'Ford',
    '8N Tractor',
    NULL,
    NULL,
    ARRAY['8n', '9n', '2n', 'naa', 'golden jubilee', '860 tractor', '600 tractor', '800 tractor', '2000 tractor', '3000 tractor', '4000 tractor', '5000 tractor', 'fordson']
  ),
  (
    '00000000-0000-4000-f000-000000000748'::uuid,
    'Ford',
    'Prefect',
    NULL,
    NULL,
    ARRAY['prefect', 'popular', 'consul', 'zephyr', 'zodiac', 'corsair', 'taunus', 'v8 pilot', 'capri mkiii', 'elite', 'f3', 'f 3']
  ),
  -- 95 Zero-Family Collector, Racing, Brass-Era & Motorcycle Marques
  (
    '00000000-0000-4000-f000-000000000749'::uuid,
    'Batmobile',
    '1966 Lincoln Futura Replica',
    NULL,
    NULL,
    ARRAY['replica', 're creation', '1966', '1989', 'batmobile']
  ),
  (
    '00000000-0000-4000-f000-000000000750'::uuid,
    'George',
    'Pierce Great Arrow',
    NULL,
    NULL,
    ARRAY['pierce', 'great arrow', 'arrow']
  ),
  (
    '00000000-0000-4000-f000-000000000751'::uuid,
    'John',
    'Deere Model B',
    NULL,
    NULL,
    ARRAY['deere', 'player norton commando']
  ),
  (
    '00000000-0000-4000-f000-000000000752'::uuid,
    'Dynamax',
    'DynaQuest XL',
    NULL,
    NULL,
    ARRAY['dynaquest', 'grand sport']
  ),
  (
    '00000000-0000-4000-f000-000000000753'::uuid,
    'Diehard',
    'Replica Dragster',
    NULL,
    NULL,
    ARRAY['battery powered', 'dragster']
  ),
  (
    '00000000-0000-4000-f000-000000000754'::uuid,
    'Indy',
    'Roadster Race Car',
    NULL,
    NULL,
    ARRAY['race car', 'roadster', 'irl']
  ),
  (
    '00000000-0000-4000-f000-000000000755'::uuid,
    'Coach',
    'House Platinum',
    NULL,
    NULL,
    ARRAY['house platinum', 'transit trolley']
  ),
  (
    '00000000-0000-4000-f000-000000000756'::uuid,
    'Holiday',
    'Rambler Imperial',
    NULL,
    NULL,
    ARRAY['rambler']
  ),
  (
    '00000000-0000-4000-f000-000000000757'::uuid,
    'Baja',
    'Boot Off-Road Racer',
    NULL,
    NULL,
    ARRAY['boot', 'warrior']
  ),
  (
    '00000000-0000-4000-f000-000000000758'::uuid,
    'Coachmen',
    'Galleria',
    NULL,
    NULL,
    ARRAY['galleria', 'motorhome']
  ),
  (
    '00000000-0000-4000-f000-000000000759'::uuid,
    'Featherlite',
    'Vantare',
    NULL,
    NULL,
    ARRAY['vantare', '26 stacker', 'custom trailer', '45 semi trailer']
  ),
  (
    '00000000-0000-4000-f000-000000000760'::uuid,
    'Jawa',
    '350 Californian',
    NULL,
    NULL,
    ARRAY['isdt', '250', '350', '350cc', '500', '890', '895', '897', 'speedway', 'californian', '175', '356', '354', '656', 'rikscha', '344cc', '49cc']
  ),
  (
    '00000000-0000-4000-f000-000000000761'::uuid,
    'Rickman',
    'Metisse',
    NULL,
    NULL,
    ARRAY['metisse', 'hodaka', 'cr900', 'rickman cr', 'honda 900', 'yamaha', '250 motocross', 'zundapp', 'montesa']
  ),
  (
    '00000000-0000-4000-f000-000000000762'::uuid,
    'De Dion-Bouton',
    '4½ HP Vis-à-Vis',
    NULL,
    NULL,
    ARRAY['4 1 2 hp', 'type dy', 'type tks', 'tonneau', 'tourer']
  ),
  (
    '00000000-0000-4000-f000-000000000763'::uuid,
    'Crown',
    'Supercoach',
    NULL,
    NULL,
    ARRAY['imperial', 'supercoach', 'firecoach']
  ),
  (
    '00000000-0000-4000-f000-000000000764'::uuid,
    'Lambretta',
    'Li 150',
    NULL,
    NULL,
    ARRAY['li150', 'li 150', 'li 125', 'li 175', 'sx200', 'tv200', 'tv175', 'tv 175', 'ld 150', 'ld150', '125ld', 'ld125', 'c 125', 'j50', 'cento']
  ),
  (
    '00000000-0000-4000-f000-000000000765'::uuid,
    'Panther',
    'J72',
    NULL,
    NULL,
    ARRAY['six', 'j72', 'kallista', 'lima', 'de ville', 'm120', 'm100', '650', 'model 120', 'model 20', 'model 100r', 'sports car']
  ),
  (
    '00000000-0000-4000-f000-000000000766'::uuid,
    'Greyhound',
    'Model 48',
    NULL,
    NULL,
    ARRAY['model 48', 'escorter', 'wagon']
  ),
  (
    '00000000-0000-4000-f000-000000000767'::uuid,
    'Hodaka',
    'Ace 100',
    NULL,
    NULL,
    ARRAY['ace 90', 'ace 100', 'ace 100b', 'ace 100mx', 'super rat', 'wombat', 'combat wombat', 'super combat', 'road toad', 'dirt squirt', 'thunderdog', 'bonanza', 'steen']
  ),
  (
    '00000000-0000-4000-f000-000000000768'::uuid,
    'Berliet',
    'Type AM',
    NULL,
    NULL,
    ARRAY['40hp', '22hp', 'type am', 'super six']
  ),
  (
    '00000000-0000-4000-f000-000000000769'::uuid,
    'Fiberfab',
    'Avenger GT',
    NULL,
    NULL,
    ARRAY['avenger', 'jamaican', 'aztec gt', 'gazelle', '356 speedster']
  ),
  (
    '00000000-0000-4000-f000-000000000770'::uuid,
    'Ajs',
    'Model 18',
    NULL,
    NULL,
    ARRAY['16m', '16ms', '16mct', 'model 16', '7r', 'model d', '18cs', '18s', 'model 18s', 'model 18', 'stormer', 'm6', 'g9a', 'model 20', 'model r6', 'model 31', 'model b']
  ),
  (
    '00000000-0000-4000-f000-000000000771'::uuid,
    'Mitchell Model',
    'Model F Touring',
    NULL,
    NULL,
    ARRAY['f touring', '5 4', 'e 20hp', 'two seater', 't five passenger']
  ),
  (
    '00000000-0000-4000-f000-000000000772'::uuid,
    'Stewart & Stevenson',
    'M1078 LMTV',
    NULL,
    NULL,
    ARRAY['m1085a1', 'monterra', 'm1078']
  ),
  (
    '00000000-0000-4000-f000-000000000773'::uuid,
    'Classic Roadsters',
    '427 Cobra',
    NULL,
    NULL,
    ARRAY['427', '302', '500k']
  ),
  (
    '00000000-0000-4000-f000-000000000774'::uuid,
    'Boss Hoss',
    'BHC-3 ZZ4',
    NULL,
    NULL,
    ARRAY['bhc 9', 'hoss trike', '383']
  ),
  (
    '00000000-0000-4000-f000-000000000775'::uuid,
    'Manta',
    'Mirage',
    NULL,
    NULL,
    ARRAY['mirage', 'montage']
  ),
  (
    '00000000-0000-4000-f000-000000000776'::uuid,
    'Merlyn',
    'Mk 6A',
    NULL,
    NULL,
    ARRAY['mk6a', 'mk 11a', 'mk 29', 'mk 24', 'formula ford']
  ),
  (
    '00000000-0000-4000-f000-000000000777'::uuid,
    'Oakland',
    'All-American Six',
    NULL,
    NULL,
    ARRAY['model 301', '301', 'all american six', 'model 40', '4 door sedan', '6 4 door sedan']
  ),
  (
    '00000000-0000-4000-f000-000000000778'::uuid,
    'Standard',
    'Flying Eight',
    NULL,
    NULL,
    ARRAY['eight', 'flying 8', 'flying eight', 'super eight', 'nine', 'flying nine', 'ten', '10hp', '9hp', '12 24hp', '14hp', '11 4hp', 'vanguard', 'pennant', 'bs500']
  ),
  (
    '00000000-0000-4000-f000-000000000779'::uuid,
    'Sears Model',
    'Model P Motor Buggy',
    NULL,
    NULL,
    ARRAY['p', 'g runabout', 'k 14hp']
  ),
  (
    '00000000-0000-4000-f000-000000000780'::uuid,
    'George Barris',
    'Barrister',
    NULL,
    NULL,
    ARRAY['barrister', 'fire bug', 'snakepit', 'sidewinder']
  ),
  (
    '00000000-0000-4000-f000-000000000781'::uuid,
    'Victoria',
    'KR 25',
    NULL,
    NULL,
    ARRAY['spoetnik', 'kr6', 'bergmeister', '155', '115', 'avanti', 'v98l', '123cc']
  ),
  (
    '00000000-0000-4000-f000-000000000782'::uuid,
    'Oakland Model',
    'Model 40',
    NULL,
    NULL,
    ARRAY['30', '40', '20', '38', '34b']
  ),
  (
    '00000000-0000-4000-f000-000000000783'::uuid,
    'Renegade',
    'Vienna',
    NULL,
    NULL,
    ARRAY['vienna', 'stacker trailer', '24 enclosed']
  ),
  (
    '00000000-0000-4000-f000-000000000784'::uuid,
    'Berkeley',
    'SE492',
    NULL,
    NULL,
    ARRAY['se492', 'se328', 'sports', 'special']
  ),
  (
    '00000000-0000-4000-f000-000000000785'::uuid,
    'Zenos',
    'E10 S',
    NULL,
    NULL,
    ARRAY['e10s', 'e10 s', 'e10 r', 'e10']
  ),
  (
    '00000000-0000-4000-f000-000000000786'::uuid,
    'Sbarro',
    '328 Replica',
    NULL,
    NULL,
    ARRAY['bmw', '328', 'testa rossa', 'a trailer']
  ),
  (
    '00000000-0000-4000-f000-000000000787'::uuid,
    'Reliant',
    'Scimitar GTE',
    NULL,
    NULL,
    ARRAY['scimitar', 'regal', 'rialto', 'sabre', 'bond bug', 'fox', 'kitten', 'robin']
  ),
  (
    '00000000-0000-4000-f000-000000000788'::uuid,
    'Queen Model',
    'Model E',
    NULL,
    NULL,
    ARRAY['e light touring', 'k touring', 'b runabout']
  ),
  (
    '00000000-0000-4000-f000-000000000789'::uuid,
    'Hurtu',
    '3½ HP Quadricycle',
    NULL,
    NULL,
    ARRAY['3 1 2hp', '4½ hp', '3½hp', 'tonneau', 'quadricycle']
  ),
  (
    '00000000-0000-4000-f000-000000000790'::uuid,
    'Gilera',
    'Saturno',
    NULL,
    NULL,
    ARRAY['saturno', 'giubileo', 'rossa', 'b300', 'lte500', '150', '125', '175', '124', '98', 'racer', 'extra', 'motorcycle']
  ),
  (
    '00000000-0000-4000-f000-000000000791'::uuid,
    'Campagna',
    'T-Rex',
    NULL,
    NULL,
    ARRAY['t rex', 'v13r']
  ),
  (
    '00000000-0000-4000-f000-000000000792'::uuid,
    'Humberette',
    '5 HP Voiturette',
    NULL,
    NULL,
    ARRAY['royal beeston', '5hp', '8hp']
  ),
  (
    '00000000-0000-4000-f000-000000000793'::uuid,
    'Tritan',
    'A2 Aero Car',
    NULL,
    NULL,
    ARRAY['a2']
  ),
  (
    '00000000-0000-4000-f000-000000000794'::uuid,
    'Everett Morrison',
    '427 Cobra',
    NULL,
    NULL,
    ARRAY['gen iv', '427', 'cobra replica']
  ),
  (
    '00000000-0000-4000-f000-000000000795'::uuid,
    'Montesa',
    'Cota 247',
    NULL,
    NULL,
    ARRAY['cota', 'cappra', 'capra', 'impala', 'king scorpion', 'enduro', '250', '360', '125']
  ),
  (
    '00000000-0000-4000-f000-000000000796'::uuid,
    'Essex Super',
    'Super Six',
    NULL,
    NULL,
    ARRAY['six']
  ),
  (
    '00000000-0000-4000-f000-000000000797'::uuid,
    'Salsbury',
    'Model 85',
    NULL,
    NULL,
    ARRAY['model 85', '85', 'model 72']
  ),
  (
    '00000000-0000-4000-f000-000000000798'::uuid,
    'Osi',
    '20M TS',
    NULL,
    NULL,
    ARRAY['20m ts']
  ),
  (
    '00000000-0000-4000-f000-000000000799'::uuid,
    'Owen Magnetic',
    'Model M-25',
    NULL,
    NULL,
    ARRAY['tourer', 'roadster', 'chassis']
  ),
  (
    '00000000-0000-4000-f000-000000000800'::uuid,
    'Oreion',
    'Reeper',
    NULL,
    NULL,
    ARRAY['beach buggy', 'reeper']
  ),
  (
    '00000000-0000-4000-f000-000000000801'::uuid,
    'Rochet-Schneider',
    '15 HP',
    NULL,
    NULL,
    ARRAY['20hp', '18hp', '15hp', '12hp']
  ),
  (
    '00000000-0000-4000-f000-000000000802'::uuid,
    'Byers',
    'SR-100',
    NULL,
    NULL,
    ARRAY['sr 100', 'sr']
  ),
  (
    '00000000-0000-4000-f000-000000000803'::uuid,
    'Seagrave',
    'Model 6WT Pumper',
    NULL,
    NULL,
    ARRAY['6 w t', 'rb44', 'hb 40dh', '12 litre', 'pumper', 'b 900']
  ),
  (
    '00000000-0000-4000-f000-000000000804'::uuid,
    'Merryweather',
    'Steam Fire Engine',
    NULL,
    NULL,
    ARRAY['fire engine', 'greenwich gem', 'hatfield']
  ),
  (
    '00000000-0000-4000-f000-000000000805'::uuid,
    'Tempo',
    'Matador',
    NULL,
    NULL,
    ARRAY['matador', 'e200', 'hanseat']
  ),
  (
    '00000000-0000-4000-f000-000000000806'::uuid,
    'Italia',
    '2000 GT',
    NULL,
    NULL,
    ARRAY['roadster']
  ),
  (
    '00000000-0000-4000-f000-000000000807'::uuid,
    'Adler',
    'Trumpf Junior',
    NULL,
    NULL,
    ARRAY['12hp', '9hp', '5 13ps', 'monoposto', 'primus', 'mb', 'm200', 'rs250']
  ),
  (
    '00000000-0000-4000-f000-000000000808'::uuid,
    'Borgward',
    'Isabella',
    NULL,
    NULL,
    ARRAY['isabella', 'hansa']
  ),
  (
    '00000000-0000-4000-f000-000000000809'::uuid,
    'Acadian',
    'Canso',
    NULL,
    NULL,
    ARRAY['canso', 'beaumont', 'convertible']
  ),
  (
    '00000000-0000-4000-f000-000000000810'::uuid,
    'Mustang',
    'Pony',
    NULL,
    NULL,
    ARRAY['pony', 'stallion', 'thoroughbred', 'type 4']
  ),
  (
    '00000000-0000-4000-f000-000000000811'::uuid,
    'Crestmobile Model',
    'Model D',
    NULL,
    NULL,
    ARRAY['d', 'b']
  ),
  (
    '00000000-0000-4000-f000-000000000812'::uuid,
    'Fuji',
    'Go-Devil',
    NULL,
    NULL,
    ARRAY['go devil', 'rabbit']
  ),
  (
    '00000000-0000-4000-f000-000000000813'::uuid,
    'Unimog',
    '404',
    NULL,
    NULL,
    ARRAY['500', '419', '404', '406', 'u1300']
  ),
  (
    '00000000-0000-4000-f000-000000000814'::uuid,
    'Palatov',
    'D2',
    NULL,
    NULL,
    ARRAY['d2', 'd4', 'd1']
  ),
  (
    '00000000-0000-4000-f000-000000000815'::uuid,
    'E-One',
    'Titan Fire Truck',
    NULL,
    NULL,
    ARRAY['one titan', '110 aerial', 'protector', 'cyclone']
  ),
  (
    '00000000-0000-4000-f000-000000000816'::uuid,
    'Hrg',
    '1500',
    NULL,
    NULL,
    ARRAY['1500', 'maserati', '1100']
  ),
  (
    '00000000-0000-4000-f000-000000000817'::uuid,
    'Lloyd',
    'Alexander LP 600',
    NULL,
    NULL,
    ARRAY['alexander', 'lt 600', 'lp 600', 'lp 400']
  ),
  (
    '00000000-0000-4000-f000-000000000818'::uuid,
    'Columbus',
    '10 HP Autobuggy',
    NULL,
    NULL,
    ARRAY['10hp', 'autobuggy']
  ),
  (
    '00000000-0000-4000-f000-000000000819'::uuid,
    'Scott',
    'Flying Squirrel',
    NULL,
    NULL,
    ARRAY['flying squirrel', 'squirrel', 'red squirrel', '596cc']
  ),
  (
    '00000000-0000-4000-f000-000000000820'::uuid,
    'Railton Eight',
    'Fairmile Drophead',
    NULL,
    NULL,
    ARRAY['mkii', 'drophead', 'fairmile', 'special saloon', 'carrington']
  ),
  (
    '00000000-0000-4000-f000-000000000821'::uuid,
    'Glenn Pray',
    '856 Speedster',
    NULL,
    NULL,
    ARRAY['auburn', 'cord', '856']
  ),
  (
    '00000000-0000-4000-f000-000000000822'::uuid,
    'Chalmers-Detroit-Model',
    'Model K 30',
    NULL,
    NULL,
    ARRAY['k 30', 'thirty']
  ),
  (
    '00000000-0000-4000-f000-000000000823'::uuid,
    'Frazer',
    'Manhattan',
    NULL,
    NULL,
    ARRAY['manhattan', 'vagabond', 'nash']
  ),
  (
    '00000000-0000-4000-f000-000000000824'::uuid,
    'Turner',
    '950 Sports',
    NULL,
    NULL,
    ARRAY['950 sports', 'mk ii', 'mk iii', 'mk i']
  ),
  (
    '00000000-0000-4000-f000-000000000825'::uuid,
    'Stohr',
    'WF1',
    NULL,
    NULL,
    ARRAY['01d', 'wf1', '1d']
  ),
  (
    '00000000-0000-4000-f000-000000000826'::uuid,
    'Kougar',
    'Sports',
    NULL,
    NULL,
    ARRAY['sports']
  ),
  (
    '00000000-0000-4000-f000-000000000827'::uuid,
    'Bmy',
    'M923A2 6x6',
    NULL,
    NULL,
    ARRAY['m931a2', 'm925a2', 'm923a2']
  ),
  (
    '00000000-0000-4000-f000-000000000828'::uuid,
    'Dukw',
    '353 Amphibious',
    NULL,
    NULL,
    ARRAY['6x6', 'amphibious']
  ),
  (
    '00000000-0000-4000-f000-000000000829'::uuid,
    'American Austin',
    'Series 75',
    NULL,
    NULL,
    ARRAY['roadster', 'bantam', 'coupe', 'station wagon', 'tudor', 'pickup', 'panel truck']
  ),
  (
    '00000000-0000-4000-f000-000000000830'::uuid,
    'Birkin',
    'S3 Roadster',
    NULL,
    NULL,
    ARRAY['s3']
  ),
  (
    '00000000-0000-4000-f000-000000000831'::uuid,
    'Victory',
    'Vegas',
    NULL,
    NULL,
    ARRAY['cross country', 'magnum', 'v92c', 'vision', 'vegas', 'kingpin', 'electric', 'hammer', 'octane']
  ),
  (
    '00000000-0000-4000-f000-000000000832'::uuid,
    'Huffaker',
    'Formula Junior',
    NULL,
    NULL,
    ARRAY['bmc', 'bmcd', 'formula junior']
  ),
  (
    '00000000-0000-4000-f000-000000000833'::uuid,
    'Mazdaspeed3',
    'Mazdaspeed3',
    NULL,
    NULL,
    ARRAY['touring', 'sport', 'grand touring']
  ),
  (
    '00000000-0000-4000-f000-000000000834'::uuid,
    'Overland Model',
    'Model 46',
    NULL,
    NULL,
    ARRAY['46', '60', '41', '59', '69', '69r']
  ),
  (
    '00000000-0000-4000-f000-000000000835'::uuid,
    'Iveco',
    'VM90',
    NULL,
    NULL,
    ARRAY['90 16', 'vm90', 'eurocargo']
  ),
  (
    '00000000-0000-4000-f000-000000000836'::uuid,
    'Dolphin',
    'America Sports Racer',
    NULL,
    NULL,
    ARRAY['america', 'international', 'd 3']
  ),
  (
    '00000000-0000-4000-f000-000000000837'::uuid,
    'Corbin',
    'Sparrow',
    NULL,
    NULL,
    ARRAY['sparrow']
  ),
  (
    '00000000-0000-4000-f000-000000000838'::uuid,
    'Rochet',
    '4½ HP Vis-à-Vis',
    NULL,
    NULL,
    ARRAY['4 1 2hp', '4½hp', 'model m1', 'single']
  ),
  (
    '00000000-0000-4000-f000-000000000839'::uuid,
    'Club Car',
    'Precedent',
    NULL,
    NULL,
    ARRAY['golfin garage', 'golf cart', 'custom', 'precedent', '1966 mustang', 'ds', 'bentley']
  ),
  (
    '00000000-0000-4000-f000-000000000840'::uuid,
    'Bean',
    '14 HP',
    NULL,
    NULL,
    ARRAY['14hp', '11 9hp', '18 50hp', '12hp']
  ),
  (
    '00000000-0000-4000-f000-000000000841'::uuid,
    'Hupmobile Model',
    'Model 20',
    NULL,
    NULL,
    ARRAY['20', '32', 'n', 's sedan']
  ),
  (
    '00000000-0000-4000-f000-000000000842'::uuid,
    'Bliss',
    'Surrey',
    NULL,
    NULL,
    ARRAY['surrey']
  ),
  (
    '00000000-0000-4000-f000-000000000843'::uuid,
    'Maxton',
    'Rollerskate',
    NULL,
    NULL,
    ARRAY['rollerskate']
  )
ON CONFLICT (id) DO UPDATE
SET
  make = EXCLUDED.make,
  canonical_model = EXCLUDED.canonical_model,
  year_start = EXCLUDED.year_start,
  year_end = EXCLUDED.year_end,
  aliases = EXCLUDED.aliases;
