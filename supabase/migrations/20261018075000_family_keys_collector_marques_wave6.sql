-- Slice 22: Key 80+ zero-family collector, pre-war, racing, microcar, and motorcycle marques
-- so every genuine collector marque with >= 3 confirmed sales resolves to a named factory family.

INSERT INTO public.canonical_models (
  id, make, canonical_model, year_start, year_end, aliases
)
VALUES
  (
    '00000000-0000-4000-f000-000000000533'::uuid,
    'Peerless Model',
    'Model 60',
    NULL,
    NULL,
    ARRAY['60', '29', '48', '66', 'runabout', 'phaeton', 'town car']
  ),
  (
    '00000000-0000-4000-f000-000000000534'::uuid,
    'Thomas Model',
    'Model 22 Flyer',
    NULL,
    NULL,
    ARRAY['22', '18', 'm 6 40', 'k', 'flyer', 'flyabout', 'runabout']
  ),
  (
    '00000000-0000-4000-f000-000000000535'::uuid,
    'Knox Model',
    'Model A',
    NULL,
    NULL,
    ARRAY['a', 'r', 'c', 'runabout', 'raceabout', 'touring']
  ),
  (
    '00000000-0000-4000-f000-000000000536'::uuid,
    'Mercer Series',
    'Series 5 Raceabout',
    NULL,
    NULL,
    ARRAY['5', '5 raceabout', 'six', '22 70', 'sporting', 'runabout']
  ),
  (
    '00000000-0000-4000-f000-000000000537'::uuid,
    'Donzi',
    'Classic',
    NULL,
    NULL,
    ARRAY['classic', 'classic 18', 'classic 22', 'shelby gt', 'sweet 16', 'sweet', '38 zr', '22 zx', 'minx', 'gt', '16 ski sporter']
  ),
  (
    '00000000-0000-4000-f000-000000000538'::uuid,
    'Stuart',
    'M5A1',
    NULL,
    NULL,
    ARRAY['m5a1', 'light tank', 'taylor seven', 'taylor locost 7', '7hp']
  ),
  (
    '00000000-0000-4000-f000-000000000539'::uuid,
    'Star',
    '3½ HP',
    NULL,
    NULL,
    ARRAY['3½hp', '3 1 2hp', '15hp', '7hp', '16hp', '14 40hp', 'pro formula mazda', 'comet', 'model c', 'model f', 'c series', 'sirius']
  ),
  (
    '00000000-0000-4000-f000-000000000540'::uuid,
    'Cav',
    'GT40',
    NULL,
    NULL,
    ARRAY['gt40', 'gt40 mkii', 'gt']
  ),
  (
    '00000000-0000-4000-f000-000000000541'::uuid,
    'Aster',
    '16/20 HP',
    NULL,
    NULL,
    ARRAY['16 20hp', '16 20 hp', '18 50hp', 'tonneau']
  ),
  (
    '00000000-0000-4000-f000-000000000542'::uuid,
    'Entegra',
    'Cornerstone',
    NULL,
    NULL,
    ARRAY['cornerstone', 'launch', 'qwest', 'qwest 24k', 'qwest 24l']
  ),
  (
    '00000000-0000-4000-f000-000000000543'::uuid,
    'Wolf',
    'GB08 Thunder',
    NULL,
    NULL,
    ARRAY['gb08', 'gb08 thunder', 'gb08 f1', 'gb08sm', 'gb08 sm', 'gb08 tornado', 'gb08 turbo']
  ),
  (
    '00000000-0000-4000-f000-000000000544'::uuid,
    'Minneapolis',
    'Model N',
    NULL,
    NULL,
    ARRAY['model n', 'single', '25 hp', 'moline', 'ztu']
  ),
  (
    '00000000-0000-4000-f000-000000000545'::uuid,
    'Alfa',
    'Spider',
    NULL,
    NULL,
    ARRAY['romeo giulia', 'romeo gtv', 'romeo 1750', 'romeo spider', 'romeo alfetta', 'spider', 'gtv', 'giulia']
  ),
  (
    '00000000-0000-4000-f000-000000000546'::uuid,
    'Jayco',
    'Seneca',
    NULL,
    NULL,
    ARRAY['seneca', 'melbourne']
  ),
  (
    '00000000-0000-4000-f000-000000000547'::uuid,
    'Marmon Model',
    'Model 34',
    NULL,
    NULL,
    ARRAY['34', '34b', '48', '68', 'speedster', 'touring']
  ),
  (
    '00000000-0000-4000-f000-000000000548'::uuid,
    'Stevens-Duryea-Model',
    'Model C-Six',
    NULL,
    NULL,
    ARRAY['u', 'c6', 'l', 'dd', 'touring', 'runabout', 'tourer']
  ),
  (
    '00000000-0000-4000-f000-000000000549'::uuid,
    'Franklin Series',
    'Series 11',
    NULL,
    NULL,
    ARRAY['17 b', '135', '9 a', '11 a', '137', '11b']
  ),
  (
    '00000000-0000-4000-f000-000000000550'::uuid,
    'Premier Model',
    'Model 45',
    NULL,
    NULL,
    ARRAY['f', '45', '6 c', 'tonneau', 'raceabout', 'touring']
  ),
  (
    '00000000-0000-4000-f000-000000000551'::uuid,
    'Matchless',
    'G80',
    NULL,
    NULL,
    ARRAY['g80', 'g80cs', 'g80 cs', 'g85cs', 'g80rr', 'g80l', 'g80s', 'gs80', 'g8cs', 'g50', 'g45', 'g12', 'g15', 'g9', 'g9b', 'g3', 'g3l', 'g3c', 'g2', 'g2cs', 'g11', 'silver hawk', 'silver arrow', 'typhoon', 't3 500', 'model 8b']
  ),
  (
    '00000000-0000-4000-f000-000000000552'::uuid,
    'Geo',
    'Tracker',
    NULL,
    NULL,
    ARRAY['tracker', 'dirt tracker', 'metro', 'storm', 'prizm']
  ),
  (
    '00000000-0000-4000-f000-000000000553'::uuid,
    'Maico',
    '490 Mega 2',
    NULL,
    NULL,
    ARRAY['490', 'mc490', 'mc250', '250', '250mx', '250 mc', 'gp250', 'aw250', '501', '501mx', '500', 'gm500', '440', 'mc440', 'mx 440', '400', 'mc400', 'gs400', 'aw400', 'mx 400', 'aw 450', '125', 'mc125', 'blizzard', 'typhoon', 'sidewinder', 'spider', 'wheelsmith', 'moto crosser', '44']
  ),
  (
    '00000000-0000-4000-f000-000000000554'::uuid,
    'Ss1',
    'SS1',
    NULL,
    NULL,
    ARRAY['ss1', 'tourer', '2½ litre', '20hp', '2 143cc', '3 1 2 litre']
  ),
  (
    '00000000-0000-4000-f000-000000000555'::uuid,
    'Force-India-Mercedes',
    'VJM10',
    NULL,
    NULL,
    ARRAY['vjm10', 'vjm04', 'vjm02', 'formula 1']
  ),
  (
    '00000000-0000-4000-f000-000000000556'::uuid,
    'Osprey',
    'OC90 Defender',
    NULL,
    NULL,
    ARRAY['oc90', 'defender 90', 'defender']
  ),
  (
    '00000000-0000-4000-f000-000000000557'::uuid,
    'Mondial',
    '250 Bialbero',
    NULL,
    NULL,
    ARRAY['250 bialbero', '250cc bialbero', '125 bialbero', '125 monoalbero', '200', '88 sport', '125 sport', '250 sport', '175', '175cc', '160 sogno', 'scugnizzo', 'cross', 'street', 'lady nova']
  ),
  (
    '00000000-0000-4000-f000-000000000558'::uuid,
    'Toj',
    'SC302',
    NULL,
    NULL,
    ARRAY['sc302', 'f201', 'bmw']
  ),
  (
    '00000000-0000-4000-f000-000000000559'::uuid,
    'Ahrens',
    'Fox Fire Engine',
    NULL,
    NULL,
    ARRAY['fox', 'fox bt', 'fox m s 2', 'fox j s 2']
  ),
  (
    '00000000-0000-4000-f000-000000000560'::uuid,
    'Fargo',
    'Power Wagon',
    NULL,
    NULL,
    ARRAY['power wagon', 'w300', 'w100', 'd100', 'fc series', 'flatbed', 'dune buggy']
  ),
  (
    '00000000-0000-4000-f000-000000000561'::uuid,
    'Innocenti',
    'Mini Cooper 1300',
    NULL,
    NULL,
    ARRAY['mini', 'cooper 1300', 'c coupe', 'c coupé', 'spider', 'lambretta']
  ),
  (
    '00000000-0000-4000-f000-000000000562'::uuid,
    'Mcfarlan',
    'TV-6 Twin Valve',
    NULL,
    NULL,
    ARRAY['tv 6', 'boattail', '90 type 127']
  ),
  (
    '00000000-0000-4000-f000-000000000563'::uuid,
    'Rcr',
    'Superlite',
    NULL,
    NULL,
    ARRAY['superlite', 'gt40', 'gt 40']
  ),
  (
    '00000000-0000-4000-f000-000000000564'::uuid,
    'Kaiser-Darrin-Sport',
    'Darrin 161',
    NULL,
    NULL,
    ARRAY['convertible', 'darrin']
  ),
  (
    '00000000-0000-4000-f000-000000000565'::uuid,
    'Niclausse',
    'Type S',
    NULL,
    NULL,
    ARRAY['type s', 'type d']
  ),
  (
    '00000000-0000-4000-f000-000000000566'::uuid,
    'Pope',
    'Hartford',
    NULL,
    NULL,
    ARRAY['hartford', 'single', 'big 4', 'twin']
  ),
  (
    '00000000-0000-4000-f000-000000000567'::uuid,
    'Monaco',
    'Dynasty',
    NULL,
    NULL,
    ARRAY['dynasty', 'diplomat', 'vesta', 'executive']
  ),
  (
    '00000000-0000-4000-f000-000000000568'::uuid,
    'Titan',
    'Mk3',
    NULL,
    NULL,
    ARRAY['mk3', 'xd 4400', 'gecko', '10 20', 'roadrunner']
  ),
  (
    '00000000-0000-4000-f000-000000000569'::uuid,
    'Polestar',
    '2',
    NULL,
    NULL,
    ARRAY['2', '2 dual motor', '2 long range']
  ),
  (
    '00000000-0000-4000-f000-000000000570'::uuid,
    'Polestar',
    '1',
    NULL,
    NULL,
    ARRAY['1']
  ),
  (
    '00000000-0000-4000-f000-000000000571'::uuid,
    'Piaggio',
    'Vespa',
    NULL,
    NULL,
    ARRAY['vespa', '125cc vespa', 'ape', 'auto plus']
  ),
  (
    '00000000-0000-4000-f000-000000000572'::uuid,
    'Bowlus',
    'Road Chief',
    NULL,
    NULL,
    ARRAY['road chief', 'papoose']
  ),
  (
    '00000000-0000-4000-f000-000000000573'::uuid,
    'Essex',
    'Super Six',
    NULL,
    NULL,
    ARRAY['super six', 'super 6', 'six', 'boattail', 'street rod', 'custom', 'rat rod']
  ),
  (
    '00000000-0000-4000-f000-000000000574'::uuid,
    'Kia',
    'Stinger',
    NULL,
    NULL,
    ARRAY['stinger', 'ev6', 'k900', 'telluride', 'soul', 'sorento']
  ),
  (
    '00000000-0000-4000-f000-000000000575'::uuid,
    'Hotchkiss',
    '686',
    NULL,
    NULL,
    ARRAY['686', 'am2', 'am80', '16 20hp', 'type x6', 'af']
  ),
  (
    '00000000-0000-4000-f000-000000000576'::uuid,
    'Columbia',
    'Cavalier',
    NULL,
    NULL,
    ARRAY['cavalier', '2 ton', 'parcar', 'golf cart']
  ),
  (
    '00000000-0000-4000-f000-000000000577'::uuid,
    'Georges Richard',
    'Type H',
    NULL,
    NULL,
    ARRAY['type h', 'type a', '3½hp', '3½ hp', 'unic']
  ),
  (
    '00000000-0000-4000-f000-000000000578'::uuid,
    'Chris-Craft',
    'Cobra',
    NULL,
    NULL,
    ARRAY['cobra', '21 cobra', 'capri', '19 capri', 'super sport', 'model 57', 'sportsman', 'sedan', '16']
  ),
  (
    '00000000-0000-4000-f000-000000000579'::uuid,
    'Clenet',
    'Series I',
    NULL,
    NULL,
    ARRAY['series 1', 'series i', 'series ii', 'series 3', 'roadster']
  ),
  (
    '00000000-0000-4000-f000-000000000580'::uuid,
    'Germain',
    '6 HP',
    NULL,
    NULL,
    ARRAY['6hp', '5 7 litre', 'torpedo']
  ),
  (
    '00000000-0000-4000-f000-000000000581'::uuid,
    'Century',
    'Coronado',
    NULL,
    NULL,
    ARRAY['coronado', '21 coronado', 'tourist', 'sea maid', 'resorter', 'arabian']
  ),
  (
    '00000000-0000-4000-f000-000000000582'::uuid,
    'American Lafrance',
    'Type 75 Fire Engine',
    NULL,
    NULL,
    ARRAY['la bestioni', 'fire engine', 'type 147', 'type 900']
  ),
  (
    '00000000-0000-4000-f000-000000000583'::uuid,
    'Franklin Model',
    'Model D',
    NULL,
    NULL,
    ARRAY['d', 'a', 'g', '11b']
  ),
  (
    '00000000-0000-4000-f000-000000000584'::uuid,
    'Can-Am',
    'Maverick X3',
    NULL,
    NULL,
    ARRAY['maverick', 'maverick x3', 'defender', 'spyder', 'ryker']
  ),
  (
    '00000000-0000-4000-f000-000000000585'::uuid,
    'Can Am',
    'Maverick',
    NULL,
    NULL,
    ARRAY['maverick', 'maverick x3', 'defender', 'spyder', 'ryker', 'mx250', 'mx500']
  ),
  (
    '00000000-0000-4000-f000-000000000586'::uuid,
    'Argyll',
    '5 HP',
    NULL,
    NULL,
    ARRAY['5hp', '8hp', 'tonneau']
  ),
  (
    '00000000-0000-4000-f000-000000000587'::uuid,
    'Farmall',
    'Super M',
    NULL,
    NULL,
    ARRAY['m', 'h', 'super h', 'super m', 'super mta', 'cub', '350', '450', '400', '300', 'a', 'b', 'c', 'super a', 'super c', 'f 20', 'f 12', 'regular']
  ),
  (
    '00000000-0000-4000-f000-000000000588'::uuid,
    'Heinkel',
    'Kabine',
    NULL,
    NULL,
    ARRAY['kabine', 'trojan', '200 coupe', '153', '175cc', 'tourist']
  ),
  (
    '00000000-0000-4000-f000-000000000589'::uuid,
    'Velocette',
    'Thruxton',
    NULL,
    NULL,
    ARRAY['thruxton', 'ktt', 'venom', 'mss', 'viper', 'mac', 'mov', 'le', 'vogue', 'loch ness', 'kss', 'gtp']
  ),
  (
    '00000000-0000-4000-f000-000000000590'::uuid,
    'Sunbeam-Talbot',
    '90',
    NULL,
    NULL,
    ARRAY['90', 'alpine', '2 liter', '10hp']
  ),
  (
    '00000000-0000-4000-f000-000000000591'::uuid,
    'Avions',
    'Voisin C30',
    NULL,
    NULL,
    ARRAY['voisin', 'c30', 'c11', 'c7']
  ),
  (
    '00000000-0000-4000-f000-000000000592'::uuid,
    'Meyers Manx',
    'Dune Buggy',
    NULL,
    NULL,
    ARRAY['dune buggy', 'tow d', 'manx']
  ),
  (
    '00000000-0000-4000-f000-000000000593'::uuid,
    'Kellison',
    'J-6 Panther',
    NULL,
    NULL,
    ARRAY['j6', 'j 4x', 'j 4r', 'j5', 'custom coupe']
  ),
  (
    '00000000-0000-4000-f000-000000000594'::uuid,
    'Flanders',
    '20',
    NULL,
    NULL,
    ARRAY['67 cubic inch', '4 hp', '4', 'model b']
  ),
  (
    '00000000-0000-4000-f000-000000000595'::uuid,
    'Hupmobile',
    'Model 20',
    NULL,
    NULL,
    ARRAY['model 20', 'series 521 j', '527 t', 'series m', '32hp', 'century 6', 'model r', 'series r', 'model n', 'series e']
  ),
  (
    '00000000-0000-4000-f000-000000000596'::uuid,
    'Royal Enfield',
    'Interceptor',
    NULL,
    NULL,
    ARRAY['interceptor', 'bullet', 'continental gt', 'himalayan', 'classic', 'meteor', '4½hp', '2¼hp', '425 cc', 'model 160', '201 a', 'constellation', 'fury']
  ),
  (
    '00000000-0000-4000-f000-000000000597'::uuid,
    'Goggomobil',
    'TS250',
    NULL,
    NULL,
    ARRAY['ts250', 't250', 't400', 'ts400', 'ts 400', 'dart', 'coupe']
  ),
  (
    '00000000-0000-4000-f000-000000000598'::uuid,
    'Rudge',
    'Ulster',
    NULL,
    NULL,
    ARRAY['ulster', 'dirt track', 'sports special', '3 5 hp', 'multi gear', 'jap speedway', '350 radial', 'four valve', 'whitworth']
  ),
  (
    '00000000-0000-4000-f000-000000000599'::uuid,
    'Armstrong Siddeley',
    'Star Sapphire',
    NULL,
    NULL,
    ARRAY['star sapphire', 'sapphire', '30hp', '16hp', '17hp', '18hp', '20hp', 'hurricane', 'lancaster', 'typhoon', 'whitley', 'utility coupe', 'siddeley']
  ),
  (
    '00000000-0000-4000-f000-000000000600'::uuid,
    'Lti',
    'TXII',
    NULL,
    NULL,
    ARRAY['txii', 'tx ii', 'taxi']
  ),
  (
    '00000000-0000-4000-f000-000000000601'::uuid,
    'Unique',
    '427 Cobra',
    NULL,
    NULL,
    ARRAY['motorcars', 'motors', 'motorcar', 'cobra']
  ),
  (
    '00000000-0000-4000-f000-000000000602'::uuid,
    'Regal Underslung',
    'Model N',
    NULL,
    NULL,
    ARRAY['model n', '25hp', 'roadster']
  ),
  (
    '00000000-0000-4000-f000-000000000603'::uuid,
    'Milburn',
    'Model 27L Electric',
    NULL,
    NULL,
    ARRAY['model 27l', 'electric']
  ),
  (
    '00000000-0000-4000-f000-000000000604'::uuid,
    'Emblem',
    'Twin',
    NULL,
    NULL,
    ARRAY['v twin', 'twin', 'single']
  ),
  (
    '00000000-0000-4000-f000-000000000605'::uuid,
    'Stoddard-Dayton',
    'Model K',
    NULL,
    NULL,
    ARRAY['model k', 'model 10 b']
  ),
  (
    '00000000-0000-4000-f000-000000000606'::uuid,
    'Pinzgauer',
    '710M',
    NULL,
    NULL,
    ARRAY['710', '710k', '710m', '712m', '718', 'tbd']
  ),
  (
    '00000000-0000-4000-f000-000000000607'::uuid,
    'Lincoln-Zephyr',
    'Zephyr',
    NULL,
    NULL,
    ARRAY['coupe', 'three window coupe', 'convertible', 'sedan', 'club coupe']
  ),
  (
    '00000000-0000-4000-f000-000000000608'::uuid,
    'Swift',
    'DB1',
    NULL,
    NULL,
    ARRAY['7hp', '12hp', '14 40hp', 'db1', 'db3', 'db4']
  ),
  (
    '00000000-0000-4000-f000-000000000609'::uuid,
    'Wills',
    'Sainte Claire',
    NULL,
    NULL,
    ARRAY['sainte claire', 'ste claire', 'a 68', 'b 68', 'w6']
  ),
  (
    '00000000-0000-4000-f000-000000000610'::uuid,
    'Exomotive',
    'Exocet',
    NULL,
    NULL,
    ARRAY['exocet', 'exocet sport', 'exocet race']
  ),
  (
    '00000000-0000-4000-f000-000000000611'::uuid,
    'Bmc',
    'Race Transporter',
    NULL,
    NULL,
    ARRAY['5 ton', 'race transporter', 'huffaker', 'moke']
  ),
  (
    '00000000-0000-4000-f000-000000000612'::uuid,
    'Cole',
    'Aero Eight',
    NULL,
    NULL,
    ARRAY['aero eight', '863', '870', '8 50', 'speed boat', 'jet boat']
  ),
  (
    '00000000-0000-4000-f000-000000000613'::uuid,
    'Stanguellini Formula',
    'Formula Junior',
    NULL,
    NULL,
    ARRAY['junior', 'jr', 'monoposto']
  ),
  (
    '00000000-0000-4000-f000-000000000614'::uuid,
    'Everett',
    'Morrison 427 Cobra',
    NULL,
    NULL,
    ARRAY['morrison', 'cobra']
  ),
  (
    '00000000-0000-4000-f000-000000000615'::uuid,
    'Genesis',
    'G70',
    NULL,
    NULL,
    ARRAY['g70', 'g80', 'g90', 'gv60', 'gv70', 'gv80']
  ),
  (
    '00000000-0000-4000-f000-000000000616'::uuid,
    'Indian Hedstrom',
    'Board Track Racer',
    NULL,
    NULL,
    ARRAY['4 valve', '8 valve', 'twin']
  ),
  (
    '00000000-0000-4000-f000-000000000617'::uuid,
    'Thornycroft',
    '20 HP',
    NULL,
    NULL,
    ARRAY['20hp', 'type q', 'lorry']
  ),
  (
    '00000000-0000-4000-f000-000000000618'::uuid,
    'Detomaso Pantera',
    'Pantera',
    NULL,
    NULL,
    ARRAY['gts', 'gt5', 'ghia']
  ),
  (
    '00000000-0000-4000-f000-000000000619'::uuid,
    'Siddeley',
    '6 HP',
    NULL,
    NULL,
    ARRAY['6hp', '12hp']
  )
ON CONFLICT (id) DO UPDATE
SET
  make = EXCLUDED.make,
  canonical_model = EXCLUDED.canonical_model,
  year_start = EXCLUDED.year_start,
  year_end = EXCLUDED.year_end,
  aliases = EXCLUDED.aliases;

-- Clear remaining year_start on Runge RS so 1950s-titled Runge builds resolve
UPDATE public.canonical_models
SET year_start = NULL, year_end = NULL
WHERE lower(make) = 'runge';
