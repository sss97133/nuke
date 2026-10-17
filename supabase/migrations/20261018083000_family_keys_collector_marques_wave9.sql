-- Slice 25: Key 114 zero-family collector, brass-era, cyclecar, racing, and vintage motorcycle
-- marques in public.canonical_models, plus expand Yamaha, Suzuki, Mazda, Nissan, Toyota,
-- Mercury, and AMC model families.

-- 1. Expand Toyota, Mazda, Nissan, Mercury, AMC, Yamaha, and Suzuki families
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['fj', 'hj45', 'fj 75', 'fj 80', 'blizzard']
  )
WHERE lower(make) = 'toyota'
  AND canonical_model = 'Land Cruiser';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['tacoma sr5'])
WHERE lower(make) = 'toyota'
  AND canonical_model = 'Tacoma';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['4 runner'])
WHERE lower(make) = 'toyota'
  AND canonical_model = '4Runner';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['mr s'])
WHERE lower(make) = 'toyota'
  AND canonical_model = 'MR2';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['estima', 'himedic'])
WHERE lower(make) = 'toyota'
  AND canonical_model = 'Previa';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['town ace'])
WHERE lower(make) = 'toyota'
  AND canonical_model = 'ToyoAce';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['b2600i', 'b2200', 'b2000', 'porter cab', 'bongo'])
WHERE lower(make) = 'mazda'
  AND canonical_model = 'B-Series';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['proteg', 'proteg 5', 'familia', 'mazdaspeed proteg'])
WHERE lower(make) = 'mazda'
  AND canonical_model = 'Protege';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['rx8'])
WHERE lower(make) = 'mazda'
  AND canonical_model = 'RX-8';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['mazdaspeed 6', 'mazdaspeed6'])
WHERE lower(make) = 'mazda'
  AND canonical_model = 'Mazda6';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['3', 'mazdaspeed 3', 'mazdaspeed3'])
WHERE lower(make) = 'mazda'
  AND canonical_model = 'Mazda3';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['710', '620', 'sunny', 'laurel', 'cedric', 'gloria', 'cima', 'nx2000', 'f 10', '8100'])
WHERE lower(make) = 'nissan'
  AND canonical_model = '510';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['be 1', 'pao', 's cargo', 'cube', 'march', 'juke'])
WHERE lower(make) = 'nissan'
  AND canonical_model = 'Figaro';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['s 55', 'mountaineer', 'bobcat', 'zephyr'])
WHERE lower(make) = 'mercury'
  AND canonical_model = 'Monterey';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['concord', 'spirit'])
WHERE lower(make) = 'amc'
  AND canonical_model = 'Hornet';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['rd400g', 'yds3', 'yds3c', 'ym2c', 'ym 1', 'yas1c', 'tz125h', 'ysr80', 'ysr50']
  )
WHERE lower(make) = 'yamaha'
  AND canonical_model = 'RD350';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['yz250c', 'yz250f', 'yz400e', 'mx125 b', 'mx400b', 'sc 500', 'jt2', 'dt2', 'tw200', '175']
  )
WHERE lower(make) = 'yamaha'
  AND canonical_model = 'YZ250';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['xs 650', 'xsr900', 'xj550', 'fzr1000r', 'fzr1000', 'fzr 600', 'fjr1300', 'v star', 'majesty', 'zuma', 'moped']
  )
WHERE lower(make) = 'yamaha'
  AND canonical_model = 'XS650';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['tl1000r', 'rg250', 'rg 250', 't10', 'x6', 'gv700gl', 'gt 500', 'gr650', 'gs550e', 'a100']
  )
WHERE lower(make) = 'suzuki'
  AND canonical_model = 'GSX-R';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['tc 185', 'tc 90r', 'rm465', 'rl250', 'rb50', 'lt', 'lt50', 'alt50']
  )
WHERE lower(make) = 'suzuki'
  AND canonical_model = 'RM250';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['sx4', 'alto'])
WHERE lower(make) = 'suzuki'
  AND canonical_model = 'Samurai';

-- 2. Insert 114 zero-family collector, brass-era, cyclecar, racing, and vintage motorcycle marques
INSERT INTO public.canonical_models (
  id, make, canonical_model, year_start, year_end, aliases
)
VALUES
  (
    '00000000-0000-4000-f000-000000000844'::uuid,
    'Panzer',
    'Captain America Chopper',
    NULL,
    NULL,
    ARRAY['captain america']
  ),
  (
    '00000000-0000-4000-f000-000000000845'::uuid,
    'Yugo',
    'GV',
    NULL,
    NULL,
    ARRAY['gv', 'gvl', 'gvc', 'cabrio']
  ),
  (
    '00000000-0000-4000-f000-000000000846'::uuid,
    'Waverly',
    'Electric Stanhope',
    NULL,
    NULL,
    ARRAY['electric', 'single racer']
  ),
  (
    '00000000-0000-4000-f000-000000000847'::uuid,
    'Cmc',
    'Tiffany Classic',
    NULL,
    NULL,
    ARRAY['tiffany', 'roadster', 'speedster', 'captain america', 'c3500']
  ),
  (
    '00000000-0000-4000-f000-000000000848'::uuid,
    'Ultra',
    'Van Motorhome',
    NULL,
    NULL,
    ARRAY['van motorhome', 'motorhome', 'american convertible', 'shadow', 'ground pounder']
  ),
  (
    '00000000-0000-4000-f000-000000000849'::uuid,
    'Alldays',
    '10/12 HP Tonneau',
    NULL,
    NULL,
    ARRAY['onions', 'matchless']
  ),
  (
    '00000000-0000-4000-f000-000000000850'::uuid,
    'Zink',
    'Z-10 Formula Ford',
    NULL,
    NULL,
    ARRAY['z 8', 'z 10c', 'c 4', 'z 19']
  ),
  (
    '00000000-0000-4000-f000-000000000851'::uuid,
    'Fruehauf',
    'Semi Trailer',
    NULL,
    NULL,
    ARRAY['trailer', 'dual axle', 'tandem axle', 'twin 20']
  ),
  (
    '00000000-0000-4000-f000-000000000852'::uuid,
    'Fn Type',
    'Type 2400',
    NULL,
    NULL,
    ARRAY['2400', '2700', '2100']
  ),
  (
    '00000000-0000-4000-f000-000000000853'::uuid,
    'Royale',
    'RP16 Formula Ford',
    NULL,
    NULL,
    ARRAY['rp4', 'rp 16', 'rp16']
  ),
  (
    '00000000-0000-4000-f000-000000000854'::uuid,
    'Metropolitan',
    '1500',
    NULL,
    NULL,
    ARRAY['convertible', 'hardtop', '1500']
  ),
  (
    '00000000-0000-4000-f000-000000000855'::uuid,
    'King',
    'Midget',
    NULL,
    NULL,
    ARRAY['midget', 'fuldamobil', 'kart']
  ),
  (
    '00000000-0000-4000-f000-000000000856'::uuid,
    'Sizaire',
    'Berwick 25/50 HP',
    NULL,
    NULL,
    ARRAY['berwick', 'naudin']
  ),
  (
    '00000000-0000-4000-f000-000000000857'::uuid,
    'Vanden Plas',
    'Princess 4-Litre R',
    NULL,
    NULL,
    ARRAY['princess', 'tourer']
  ),
  (
    '00000000-0000-4000-f000-000000000858'::uuid,
    'Classic Motor Carriages',
    'Gazelle',
    NULL,
    NULL,
    ARRAY['shelby cobra', 'gazelle', 'classic 359', 'custom']
  ),
  (
    '00000000-0000-4000-f000-000000000859'::uuid,
    'Hanomag',
    '2/10 PS Kommissbrot',
    NULL,
    NULL,
    ARRAY['2 10ps', '2 10 ps', '3 16']
  ),
  (
    '00000000-0000-4000-f000-000000000860'::uuid,
    'Phillips',
    'Berlina',
    NULL,
    NULL,
    ARRAY['berlina']
  ),
  (
    '00000000-0000-4000-f000-000000000861'::uuid,
    'Legrand',
    'Mk 3B Formula B',
    NULL,
    NULL,
    ARRAY['mk3b', 'mkii', 'mk 1', 'mk3']
  ),
  (
    '00000000-0000-4000-f000-000000000862'::uuid,
    'Franklin Airman',
    'Series 12 Airman',
    NULL,
    NULL,
    ARRAY['sport tourer', 'limousine']
  ),
  (
    '00000000-0000-4000-f000-000000000863'::uuid,
    'Excelsior-Henderson',
    'Super X',
    NULL,
    NULL,
    ARRAY['long tank', 'super x']
  ),
  (
    '00000000-0000-4000-f000-000000000864'::uuid,
    'Graham-Paige',
    'Model 837',
    NULL,
    NULL,
    ARRAY['sport roadster', 'sport phaeton', 'custom coupe', 'model 837']
  ),
  (
    '00000000-0000-4000-f000-000000000865'::uuid,
    'Kaiser-Jeep',
    'M715',
    NULL,
    NULL,
    ARRAY['m715', 'm35a2', 'm725']
  ),
  (
    '00000000-0000-4000-f000-000000000866'::uuid,
    'Ferves',
    'Ranger',
    NULL,
    NULL,
    ARRAY['ranger']
  ),
  (
    '00000000-0000-4000-f000-000000000867'::uuid,
    'Arcimoto',
    'FUV',
    NULL,
    NULL,
    ARRAY['fuv', 'deliverator']
  ),
  (
    '00000000-0000-4000-f000-000000000868'::uuid,
    'Penton',
    '125 Six Days',
    NULL,
    NULL,
    ARRAY['125', '125cc', 'berkshire', 'six days', '250', '175', 'jackpiner', 'trials', 'mint 400', 'gs6', '100 125']
  ),
  (
    '00000000-0000-4000-f000-000000000869'::uuid,
    'Grumman',
    'Kurbvan',
    NULL,
    NULL,
    ARRAY['aa 1a', 'kubvan', 'olson']
  ),
  (
    '00000000-0000-4000-f000-000000000870'::uuid,
    'Cxc',
    'Motion Pro II',
    NULL,
    NULL,
    ARRAY['motion pro ii']
  ),
  (
    '00000000-0000-4000-f000-000000000871'::uuid,
    'Marquette',
    'Series 30',
    NULL,
    NULL,
    ARRAY['model 25', 'series 30', 'porto fast']
  ),
  (
    '00000000-0000-4000-f000-000000000872'::uuid,
    'Junior Classic',
    '250 GT California',
    NULL,
    NULL,
    ARRAY['ferrari', '289 cobra', 'aston martin']
  ),
  (
    '00000000-0000-4000-f000-000000000873'::uuid,
    'Salmson',
    '2300 S',
    NULL,
    NULL,
    ARRAY['2300', 's4 61']
  ),
  (
    '00000000-0000-4000-f000-000000000874'::uuid,
    'Gurney Aar',
    'Eagle Indy Car',
    NULL,
    NULL,
    ARRAY['eagle', 'alligator']
  ),
  (
    '00000000-0000-4000-f000-000000000875'::uuid,
    'Ralt',
    'RT5',
    NULL,
    NULL,
    ARRAY['rt5', 'beasley']
  ),
  (
    '00000000-0000-4000-f000-000000000876'::uuid,
    'Greeves',
    '250 Challenger',
    NULL,
    NULL,
    ARRAY['anglian', 'hawkstone', 'scottish', 'challenger', 'griffon', 'ranger', '360', '250', '380', '246cc', '197cc', 'mds', 'moto cross']
  ),
  (
    '00000000-0000-4000-f000-000000000877'::uuid,
    'Fusconeta',
    'Volkspod',
    NULL,
    NULL,
    ARRAY['volkspod', 'custom']
  ),
  (
    '00000000-0000-4000-f000-000000000878'::uuid,
    'Brunton',
    'Stalker',
    NULL,
    NULL,
    ARRAY['stalker', 'stalkerv6', 'super stalker']
  ),
  (
    '00000000-0000-4000-f000-000000000879'::uuid,
    'Crossley',
    '20/25 HP',
    NULL,
    NULL,
    ARRAY['20 25 hp', '20 9hp', '19 6hp']
  ),
  (
    '00000000-0000-4000-f000-000000000880'::uuid,
    'Allis Chalmers',
    'WD45',
    NULL,
    NULL,
    ARRAY['d10', 'd14', 'd17', 'xt190', 'wd', 'wd45', 'wd 45', 'wc', 'c', 'model b', 'monarch 35']
  ),
  (
    '00000000-0000-4000-f000-000000000881'::uuid,
    'Ansaldo',
    'Tipo 6AN',
    NULL,
    NULL,
    ARRAY['6an', '4cs']
  ),
  (
    '00000000-0000-4000-f000-000000000882'::uuid,
    'Laforza',
    'Magnum',
    NULL,
    NULL,
    ARRAY['laforza', '3', 'rayton fissore', '4 door suv', 'project']
  ),
  (
    '00000000-0000-4000-f000-000000000883'::uuid,
    'Velocity',
    'Exo Roadster',
    NULL,
    NULL,
    ARRAY['exo', 'exo contour']
  ),
  (
    '00000000-0000-4000-f000-000000000884'::uuid,
    'Big Dog',
    'Pitbull',
    NULL,
    NULL,
    ARRAY['wolf', 'pitbull', 'pro sport', 'softail', 'mastiff', 'vintage classic']
  ),
  (
    '00000000-0000-4000-f000-000000000885'::uuid,
    'Carter',
    'Brothers Mini Monster',
    NULL,
    NULL,
    ARRAY['brothers']
  ),
  (
    '00000000-0000-4000-f000-000000000886'::uuid,
    'Reo Model',
    'Model ST-5 The Fifth',
    NULL,
    NULL,
    ARRAY['b', 'st 5', 'm touring', 'st5']
  ),
  (
    '00000000-0000-4000-f000-000000000887'::uuid,
    'Essex Challenger',
    'Super Six',
    NULL,
    NULL,
    ARRAY['super six', 'phaeton', 'six coupe']
  ),
  (
    '00000000-0000-4000-f000-000000000888'::uuid,
    'Holsman',
    'Model 10-K High-Wheeler',
    NULL,
    NULL,
    ARRAY['model 10 k', '10hp']
  ),
  (
    '00000000-0000-4000-f000-000000000889'::uuid,
    'Epic',
    'E60',
    NULL,
    NULL,
    ARRAY['golf cart', 'e60']
  ),
  (
    '00000000-0000-4000-f000-000000000890'::uuid,
    'Dax',
    '427 Tojeiro',
    NULL,
    NULL,
    ARRAY['gt40', 'ac cobra']
  ),
  (
    '00000000-0000-4000-f000-000000000891'::uuid,
    'Mitsuoka',
    'Le-Seyde',
    NULL,
    NULL,
    ARRAY['zero1', 'le seyde', 'viewt', 'galue']
  ),
  (
    '00000000-0000-4000-f000-000000000892'::uuid,
    'London Taxi',
    'TXII',
    NULL,
    NULL,
    ARRAY['taxi', 'txii']
  ),
  (
    '00000000-0000-4000-f000-000000000893'::uuid,
    'Bar-Honda',
    '003',
    NULL,
    NULL,
    ARRAY['003', '005', 'formula 1']
  ),
  (
    '00000000-0000-4000-f000-000000000894'::uuid,
    'Vixen',
    '21 TD',
    NULL,
    NULL,
    ARRAY['21 td', 'motorhome']
  ),
  (
    '00000000-0000-4000-f000-000000000895'::uuid,
    'Henry',
    'J Corsair',
    NULL,
    NULL,
    ARRAY['j corsair', 'j pro street', 'j project', 'lauterbach']
  ),
  (
    '00000000-0000-4000-f000-000000000896'::uuid,
    'Schwinn',
    'Sting-Ray Krate',
    NULL,
    NULL,
    ARRAY['sting ray', 'whizzer', 'grey ghost', 'black phantom', 'pea picker', 'orange krate', 'apple krate', 'rams horn']
  ),
  (
    '00000000-0000-4000-f000-000000000897'::uuid,
    'Boss',
    'Hoss',
    NULL,
    NULL,
    ARRAY['hoss']
  ),
  (
    '00000000-0000-4000-f000-000000000898'::uuid,
    'Glen',
    'L Monaco',
    NULL,
    NULL,
    ARRAY['l monaco', 'l torpedo', 'l zip']
  ),
  (
    '00000000-0000-4000-f000-000000000899'::uuid,
    'Little',
    'Four',
    NULL,
    NULL,
    ARRAY['car company', 'four', 'gem']
  ),
  (
    '00000000-0000-4000-f000-000000000900'::uuid,
    'Detroit',
    'Electric Model 68',
    NULL,
    NULL,
    ARRAY['electric', 'lubricator']
  ),
  (
    '00000000-0000-4000-f000-000000000901'::uuid,
    'Phoenix',
    '4½ HP Tricar',
    NULL,
    NULL,
    ARRAY['4½hp', 'f1000', '10hp', '11 9hp']
  ),
  (
    '00000000-0000-4000-f000-000000000902'::uuid,
    'Whizzer',
    'Pacemaker',
    NULL,
    NULL,
    ARRAY['sportsman', 'pacemaker', 'motor bike', 'motorbike', 'schwinn', 'ambassador', 'model h', 'moped', 'ne5']
  ),
  (
    '00000000-0000-4000-f000-000000000903'::uuid,
    'Rumi',
    '125 Gobbetto',
    NULL,
    NULL,
    ARRAY['gobbetto', '125', 'turismo', 'junior']
  ),
  (
    '00000000-0000-4000-f000-000000000904'::uuid,
    'Ez-Go',
    'RXV',
    NULL,
    NULL,
    ARRAY['rxv', 'express l6', 'txt', 'custom', 's4']
  ),
  (
    '00000000-0000-4000-f000-000000000905'::uuid,
    'Allgaier',
    'AP22 Porsche-Diesel',
    NULL,
    NULL,
    ARRAY['ap22', 'porsche ap']
  ),
  (
    '00000000-0000-4000-f000-000000000906'::uuid,
    'Rokon',
    'Trail-Breaker',
    NULL,
    NULL,
    ARRAY['trail breaker', 'trailbreaker', 'rt2', 'ranger', 'rt340mx', 'rt340']
  ),
  (
    '00000000-0000-4000-f000-000000000907'::uuid,
    'Triking',
    'Type 4 Cyclecar',
    NULL,
    NULL,
    ARRAY['cycle car', 'type 4', 'custom cyclecar']
  ),
  (
    '00000000-0000-4000-f000-000000000908'::uuid,
    'Emf Model',
    'Model 30',
    NULL,
    NULL,
    ARRAY['30']
  ),
  (
    '00000000-0000-4000-f000-000000000909'::uuid,
    'Shasta',
    'Airflyte 1500',
    NULL,
    NULL,
    ARRAY['1500', 'trailer', 'travel trailer']
  ),
  (
    '00000000-0000-4000-f000-000000000910'::uuid,
    'Boston',
    'Whaler Montauk',
    NULL,
    NULL,
    ARRAY['whaler']
  ),
  (
    '00000000-0000-4000-f000-000000000911'::uuid,
    'Minneapolis Moline',
    'Jet Star',
    NULL,
    NULL,
    ARRAY['m670', 'r cab', 'jet star', 'waterloo', '4 star', 'uts', 'utc', 'ztu']
  ),
  (
    '00000000-0000-4000-f000-000000000912'::uuid,
    'Beardmore',
    'Mk 7 Paramount Taxi',
    NULL,
    NULL,
    ARRAY['taxi', 'mk 7', '12 30hp', 'london taxi']
  ),
  (
    '00000000-0000-4000-f000-000000000913'::uuid,
    'Emf',
    'Model 30',
    NULL,
    NULL,
    ARRAY['model 30', '30', '30hp']
  ),
  (
    '00000000-0000-4000-f000-000000000914'::uuid,
    'Trailex',
    'CTE-84180',
    NULL,
    NULL,
    ARRAY['enclosed trailer', 'cte 84180t', 'cte 1741']
  ),
  (
    '00000000-0000-4000-f000-000000000915'::uuid,
    'Bonanza',
    'BC1300',
    NULL,
    NULL,
    ARRAY['bc1300', 'bc 1300', 'mx1510', 'cr500', 'cr400', 'mini cross', 'mini bike']
  ),
  (
    '00000000-0000-4000-f000-000000000916'::uuid,
    'Orient',
    'Buckboard',
    NULL,
    NULL,
    ARRAY['buckboard', '4hp']
  ),
  (
    '00000000-0000-4000-f000-000000000917'::uuid,
    'Brian James',
    'Race Shuttle',
    NULL,
    NULL,
    ARRAY['motor shuttle', 'race shuttle', 'rs5', 'rt5', 'sprint', 'a4', 'minnomax']
  ),
  (
    '00000000-0000-4000-f000-000000000918'::uuid,
    'Shamrock',
    'Cobra',
    NULL,
    NULL,
    ARRAY['cobra', 'ac cobra', 'vs']
  ),
  (
    '00000000-0000-4000-f000-000000000919'::uuid,
    'Samco',
    'Cord Warrior',
    NULL,
    NULL,
    ARRAY['cord']
  ),
  (
    '00000000-0000-4000-f000-000000000920'::uuid,
    'Kaiser Deluxe',
    'Dragon',
    NULL,
    NULL,
    ARRAY['jade dragon', 'virginian', '2 door sedan']
  ),
  (
    '00000000-0000-4000-f000-000000000921'::uuid,
    'Grinnall',
    'Scorpion III',
    NULL,
    NULL,
    ARRAY['scorpion']
  ),
  (
    '00000000-0000-4000-f000-000000000922'::uuid,
    'Wagner',
    'Single',
    NULL,
    NULL,
    ARRAY['single', 'motor']
  ),
  (
    '00000000-0000-4000-f000-000000000923'::uuid,
    'Taylor-Dunn',
    'Trident',
    NULL,
    NULL,
    ARRAY['trident']
  ),
  (
    '00000000-0000-4000-f000-000000000924'::uuid,
    'Holden',
    'Ute',
    NULL,
    NULL,
    ARRAY['ute', 'race car', 'hsv']
  ),
  (
    '00000000-0000-4000-f000-000000000925'::uuid,
    'Tiga',
    'SC84',
    NULL,
    NULL,
    ARRAY['sc84', 'sc 84', 'sc85']
  ),
  (
    '00000000-0000-4000-f000-000000000926'::uuid,
    'Imme',
    'R100',
    NULL,
    NULL,
    ARRAY['r100']
  ),
  (
    '00000000-0000-4000-f000-000000000927'::uuid,
    'Allis',
    'Chalmers Model B',
    NULL,
    NULL,
    ARRAY['chalmers']
  ),
  (
    '00000000-0000-4000-f000-000000000928'::uuid,
    'Terraplane',
    'Series 71',
    NULL,
    NULL,
    ARRAY['challenger', 'coupe', 'series 71']
  ),
  (
    '00000000-0000-4000-f000-000000000929'::uuid,
    'Rotus',
    'Seven',
    NULL,
    NULL,
    ARRAY['7', 'super 7', 'seven']
  ),
  (
    '00000000-0000-4000-f000-000000000930'::uuid,
    'Peerless',
    'Model 6-81',
    NULL,
    NULL,
    ARRAY['4 door touring', 'model 6 81', '6 61']
  ),
  (
    '00000000-0000-4000-f000-000000000931'::uuid,
    'Mazdaspeed6',
    'Mazdaspeed6',
    NULL,
    NULL,
    ARRAY['grand touring', 'sport']
  ),
  (
    '00000000-0000-4000-f000-000000000932'::uuid,
    'Allstate',
    'Puch 250 SGS',
    NULL,
    NULL,
    ARRAY['custom', 'puch', 'scooter', 'sprint', 'cushman', 'sgs250', 'sgs', 'mo ped']
  ),
  (
    '00000000-0000-4000-f000-000000000933'::uuid,
    'Bombardier',
    'Iltis',
    NULL,
    NULL,
    ARRAY['iltis', 'ski doo']
  ),
  (
    '00000000-0000-4000-f000-000000000934'::uuid,
    'Skoda',
    'Felicia',
    NULL,
    NULL,
    ARRAY['felicia', 's100', 'forman', '120l', '105l', '120', '130l', 'estelle']
  ),
  (
    '00000000-0000-4000-f000-000000000935'::uuid,
    'Dnepr',
    'MT-11',
    NULL,
    NULL,
    ARRAY['mt 11', 'mt10', 'mt10 36', 'twin', 'k 750']
  ),
  (
    '00000000-0000-4000-f000-000000000936'::uuid,
    'Brush Model',
    'Model E Runabout',
    NULL,
    NULL,
    ARRAY['e runabout', 'a runabout']
  ),
  (
    '00000000-0000-4000-f000-000000000937'::uuid,
    'Stirling',
    '5 HP Dogcart',
    NULL,
    NULL,
    ARRAY['5hp', 'moss']
  ),
  (
    '00000000-0000-4000-f000-000000000938'::uuid,
    'Chandler',
    'Special Six',
    NULL,
    NULL,
    ARRAY['special six', 'standard 6', 'six']
  ),
  (
    '00000000-0000-4000-f000-000000000939'::uuid,
    'Comet',
    'Single',
    NULL,
    NULL,
    ARRAY['single', 'sedan', 'scooter']
  ),
  (
    '00000000-0000-4000-f000-000000000940'::uuid,
    'Panther J72',
    'J72 Roadster',
    NULL,
    NULL,
    ARRAY['roadster']
  ),
  (
    '00000000-0000-4000-f000-000000000941'::uuid,
    'Margay',
    'Cheetah',
    NULL,
    NULL,
    ARRAY['new breed', 'cheetah', 'panther x', 'expert', 'pro x', 'prox', 'ampac']
  ),
  (
    '00000000-0000-4000-f000-000000000942'::uuid,
    'Sebring',
    'MX 5000',
    NULL,
    NULL,
    ARRAY['austin healey', 'mx 5000', 'commutacar', 'comuta car']
  ),
  (
    '00000000-0000-4000-f000-000000000943'::uuid,
    'Tiffany',
    'Classic Coupe',
    NULL,
    NULL,
    ARRAY['custom', 'classic coupe']
  ),
  (
    '00000000-0000-4000-f000-000000000944'::uuid,
    'Redneck',
    'Rocket Lowlife',
    NULL,
    NULL,
    ARRAY['rocket lowlife', 'custom motorcycle', 'chopper']
  ),
  (
    '00000000-0000-4000-f000-000000000945'::uuid,
    'Otas',
    '820 Grand Prix',
    NULL,
    NULL,
    ARRAY['820', 'grand prix']
  ),
  (
    '00000000-0000-4000-f000-000000000946'::uuid,
    'Nuffield',
    'Oxford Taxi',
    NULL,
    NULL,
    ARRAY['oxford', '3 42']
  ),
  (
    '00000000-0000-4000-f000-000000000947'::uuid,
    'Ebr',
    '1190RS',
    NULL,
    NULL,
    ARRAY['1190rs', '1190rx', '1190sx']
  ),
  (
    '00000000-0000-4000-f000-000000000948'::uuid,
    'Dennis',
    'F8 Fire Engine',
    NULL,
    NULL,
    ARRAY['fire engine', '30cwt', '2½ ton', 'f8', 'pax']
  ),
  (
    '00000000-0000-4000-f000-000000000949'::uuid,
    'Graham-Paige-Model',
    'Model 113 Hollywood',
    NULL,
    NULL,
    ARRAY['113', '97']
  ),
  (
    '00000000-0000-4000-f000-000000000950'::uuid,
    'Massey-Harris',
    'Model 44',
    NULL,
    NULL,
    ARRAY['44', 'pony']
  ),
  (
    '00000000-0000-4000-f000-000000000951'::uuid,
    'Seat',
    '600',
    NULL,
    NULL,
    ARRAY['600d', '600']
  ),
  (
    '00000000-0000-4000-f000-000000000952'::uuid,
    'Midget',
    'Race Car',
    NULL,
    NULL,
    ARRAY['race car', 'racecar', 'king midget']
  ),
  (
    '00000000-0000-4000-f000-000000000953'::uuid,
    'Yatian',
    'LY08N',
    NULL,
    NULL,
    ARRAY['ly08n', 'lyo5b', 'lz5b', 'curved dash']
  ),
  (
    '00000000-0000-4000-f000-000000000954'::uuid,
    'Borgward Isabella',
    'Isabella Coupé',
    NULL,
    NULL,
    ARRAY['coup', 'coupe', 'saloon']
  ),
  (
    '00000000-0000-4000-f000-000000000955'::uuid,
    'Mgc',
    'GT',
    NULL,
    NULL,
    ARRAY['gt', 'sebring', 'roadster']
  ),
  (
    '00000000-0000-4000-f000-000000000956'::uuid,
    'Arlen Ness',
    'Highliner',
    NULL,
    NULL,
    ARRAY['lowliner', 'highliner', 'chopper']
  )
ON CONFLICT (id) DO UPDATE
SET
  make = EXCLUDED.make,
  canonical_model = EXCLUDED.canonical_model,
  year_start = EXCLUDED.year_start,
  year_end = EXCLUDED.year_end,
  aliases = EXCLUDED.aliases;
