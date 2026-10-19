-- Slice 26: Key 115 zero-family collector, cyclecar, racing, and vintage motorcycle marques
-- in public.canonical_models, plus expand Harley-Davidson, Kawasaki, Yamaha, Suzuki, Indian,
-- Honda, Fiat, Chaparral, David Brown, and Ferguson model families.

-- 1. Expand Harley-Davidson, Kawasaki, Yamaha, Suzuki, Indian, Honda, Fiat, Chaparral, David Brown, and Ferguson
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'flhp', 'flhtp', 'fltruse', 'fltrx', 'flhtpi', 'flhrsei', 'flhrse', 'fltru',
      'flstfi', 'flhtcse', 'flstsb', 'flstb', 'street bob', 'sturgis', 'fxdr 114',
      'fxdfse', 'pan america', 'night train', 'fxrs', 'low rider', 'fat bob',
      'xlstc', 'softtail', 'freewheeler', 'livewire', 'fxstd', 'fxstsse',
      'duo glide', 'fxrc', 'fxdi', 'fxrd', 'fxdls', 'fxdb', 'fxstsb', 'cross bones',
      'fxstsse3', 'fxcw', 'fxdi35', 'fxsb', 'deuce', 'wide glide', 'super glide',
      'vrxse', 'vrsc', 'vrsxe', 'vrscse2', 'vrscx', 'vrscse', 'vrscf', 'vrscdx'
    ]
  )
WHERE lower(make) = 'harley-davidson'
  AND canonical_model = 'FL';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '45', 'sx175', 'sx 175', 'xl883r', 'xr 1000', 'xl883', 'xl1200c', 'super 10',
      'sr 100', 'sx125', 's125', '125s', 'aermacchi', 'st165', 'xl1200', 'k model',
      'model k', 'model kk', 'khk', 'm50', 'ss250', 'bobcat', 'sx350', 'xlch1000',
      'ss 350', 'x90', 'baja', 'leggero', 'b model', 'model u', 'rr350', 'wldr',
      'ulh', 'vle', 'rr250', 'model w', 'kr750', 'wrtt', 'rld', 'xlr', 'rl',
      'iron 883', 'd model', 'dl', 'wlc', 'nightster', 'xlcr1000', 'xlr1000',
      'mc 65', 'mc 250', 'b21c'
    ]
  )
WHERE lower(make) = 'harley-davidson'
  AND canonical_model = 'EL';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'in line', 'custom motorcycle', 'silver arrow', 'warrior', 'westerner',
      'mm5', 'm5a', 'msa', 'mm5b', 'mm 5a', 'mmsa', 'racer', 'c3', 'sport',
      'model o', 'uprising', 'model 640', 'century', 'trailblazer', 'spirit',
      'junior cross', 'ftr1200', 'mt175', 'cx50r', 'papoose', 'arrow', 'x80r',
      'fire arrow', 'mx 76b', 'se74', 'se 74', 'woodsman', 'mi 175', 'mx125',
      's 70', 'super scrambler', 'mx74', 'me 125', 'me76', 'apache', 'tomahawk',
      'minibike', 'mx75', 'mt125', 'eftrjr', 'replica'
    ]
  )
WHERE lower(make) = 'indian'
  AND canonical_model = 'Chief';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'zr1', 'z2b', 'gpz', 'kz1000d', 'z 1', 'zx 7', 'zx750', 'z1900', 'kz 900',
      'kz1100r', 'zx1400a', 'cr900', 'zx 10r', 'zrx', 'kz1000c', 'zx7r', 'z900rs',
      'zx 6r', 'kz1100', 'kz1000p', 'zzr600', 'zz r600', 'bj250a', 'w2ss', 'zx 11',
      'kz750t', 'meguro', 'kz200', 'ltd 1000', 'sr 250'
    ]
  )
WHERE lower(make) = 'kawasaki'
  AND canonical_model = 'KZ1000';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '500', 'mach iii', 'h1r', 'mach ii', 'mach 3', '500 h 1', 'ari 250',
      'g3m', 'b8t', 'b8s'
    ]
  )
WHERE lower(make) = 'kawasaki'
  AND canonical_model = 'H2';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'f21m', 'klt250', 'klr', 'g4rr', 'teryx', 'trail boss', 'kx100', 'g4trc',
      'ke 100', 'klx110', 'big horn', 'f2 175', 'klx 650', 'kx', '250', 'kl250',
      'kdx400', 'kfx700', 'kdx 250', 'f 11', 'ke125'
    ]
  )
WHERE lower(make) = 'kawasaki'
  AND canonical_model = 'KX250';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'gsxr1100r', 'gt750m', 'gsxr750', 'gs650gl', 'gs650', 'gsx1300r', 'xn 85',
      'tl1000', 'gsxr1100', 'v strom', 'gt550j', 'boulevard', 'rgv250sp', 'gsx r50',
      'gsx1000s', 'colleda', 'hyabusa', 'gt380l', 'gsx', 'gsxr100r', 'gsx 600r',
      's32 2', 's32', 'gsx r600', 'gsk 1100', 'tlr 1000', 'gs1150es', 't500r',
      'tl1000s', 'burgman', 'bandit', 'ls650', 'vx800', 'gsx r400', 'gv1400',
      'gsx r600m', 'titan', 'sv650', 'gs1000e', 'gs750e', 'm15', 'dl1000',
      'gs1100es', 't200', 'gs450t', 'vz800', 'b105p', 'b105', 'gs550t', 'gsf250',
      'gs1150ef', 'gsxr400', 'tu250x', '250 savage', 'intruder', 'vs700gle',
      'gp100', 'gs500e', 'b120p', 'k11p', 'k11', 'gz250', 'm12 2', 'k15',
      'an400y', 'fa50', 'gsx600f', 'gsx550e', 'gs850', 'u50'
    ]
  )
WHERE lower(make) = 'suzuki'
  AND canonical_model = 'GSX-R';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'rh250', 'dsxr', 'rm z450', 'rmz450', 'rm100a', 'rm125a', 'tm125k', 'tm250l',
      'rm125m', 'rm370a', 'tc305', 'tm', 'tc250', 'rm250a', 'ts 125', 'tsr 500',
      'rn125', 'tc 90j', 'sp600', 'rm60', 'rm 60', 'tc200', 'ts 185', 'ts 185j',
      'vanvan', 'rv200', 'tc 125', 'pe250b', 'tm 100', 'dr z400sm', 'dr z',
      'lt50h', 'rm125n', 'tm 400', 'tm400j', 'rm 250', 'tc 120', 'tm 125', 'jr 50',
      'jr50z', 'lt125', 'ds80', 'ts75', 'quadzilla', 'dr100', 'lt450r', 'dr250',
      'tc 100', 'tc100', 'mt50', 'lz 50a', 'quadrunner', 'drm420', '250rm',
      'rm100', 'rl 250'
    ]
  )
WHERE lower(make) = 'suzuki'
  AND canonical_model = 'RM250';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'lj20v', 'mighty boy', 'fronte', 'cervo', 'swift', 'equator', 'wagon r', 'kei'
    ]
  )
WHERE lower(make) = 'suzuki'
  AND canonical_model = 'Samurai';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'ym1', 'tzr250spr', 'rd125bs', 'tz250e', 'yds 3', 'fs1e', 'tr 2', 'td1c',
      'td1 c', 'tzr 250', 'rd 250', 'rd400e', 'yds 250', 'rd350lc', 'tdr250',
      'ysr50s', 'ysr', 'rz 350', 'rd125s', 'tzr250', 'rd400d', 'cs3c', 'tzr',
      'gt50', 'tz250g', 'td2b', 'u5e', 'u5', 'yg5t', 'mj2t', 'r5c', 'hs 1',
      'rz50 2', 'yl1e', 'yds5', 'yd2', 'sdr 200', 'rd 350', 'ycs1', 'qa50',
      'yg1', 'yg 1', 'td1b', 'rs100', 'cs3', 'cs5', 'chappy', 'lb80', 'cs3b',
      'rd60a', '4g5 t', 'qt50', 'rd250b'
    ]
  )
WHERE lower(make) = 'yamaha'
  AND canonical_model = 'RD350';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'fz600', 'r 1', 'fzr750r', 'xv 1700pc', 'fzr 1000', 'xv920', 'yzf r6s',
      'star touring', 'yzf r6', 'sr250', 'fzr400', 'mt 01', '650 turbo',
      'fzr250r', 'yzf', 'xs 2', 'xs2', 'srx600', 'super tenere', 'xs110',
      'raider', '650 heritage', 'xj900', 'fzr400rr', 'fzr250', 'fzr 600r',
      'xs1b', 'xvz12td', 'xv 1900', 'xj650lh', 'xj650rj', 'xj700', 'xtz750',
      'fj1100', 'fj 1100', 'skorpion', 'xv1100', 'srx250', 'sx1100', 'xs1100lh',
      'xv1000', 'xs500', 'fj1200a', 'xs eleven', 'maxim', 'royal star', 'virago',
      'xv', 'seca', 'fzx750', 'xs se', '400 seca'
    ]
  )
WHERE lower(make) = 'yamaha'
  AND canonical_model = 'XS650';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'yz360', 'hl500', 'mx 360', 'wr450fs', 'yz125c', 'yz250a', 'yz250h',
      'wr 450f', 'wr450f', 'at1m', 'yz125a', 'wr250r', 'yz450f', 'lt 3', 'dt 400',
      'jt1l', 'yz400f', 'at1c', 'at 3', 'ascot', '360', 'xt550', 'yz 490',
      'ty 80', 'ty80b', 'big bear', 'yz 250', 'tt500e', 'tt500c', 'track master',
      'atmx', 'ty 250', 'dt400e', 'yz80d', 'yz125b', 'ct1b', 'dt1c', 'lt2',
      '250 mx', 'ty350', 'wr400f', 'mini enduro', 'xt225v', 'yz80k', 'ttr50eb',
      'xt 600', 'pw 50', 'big wheel', 'dt 125', 'yz425', '200', 'ttr 125',
      'yz465h', 'ht2', 'trail 100', 'it175d', 'ttr230', 'hti', '100', 'mx80g',
      'rt100', 'ttr 90', 'ttr90', 'bw350', '80', 'at 1'
    ]
  )
WHERE lower(make) = 'yamaha'
  AND canonical_model = 'YZ250';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'rhino', 'yxz 1000', 'yzf350', 'yxr700', 'yfz450r', 'ytm', 'yfm200', 'superjet'
    ]
  )
WHERE lower(make) = 'yamaha'
  AND canonical_model = 'Banshee';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'vfr1000r', 'vf700c', 'vtr1000f', 'ss125', 'sl90', 'rs125r', 'nx250',
      'goldwing', 'cm440a', 'cl70', 'cbr1000fl', 'cb1000c', 'ns50f', '305 scrambler',
      'ca78'
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
      'z', 'cr', 'dylan', 'zb50j', 'xr 80', 'xl125', 'xr100r', 'xl500s',
      'mt125', 'crf50f', 'tl250', 'c70', 'tg50', 'motocompacto', '200x',
      'cm91', 'crf 150r'
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
    ARRAY['uno', '127a', '1300', '509', 'coupe 16v']
  )
WHERE lower(make) = 'fiat'
  AND canonical_model = '500';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['enduro', '80'])
WHERE lower(make) = 'chaparral'
  AND canonical_model = '2';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['990', '780', 'vak1'])
WHERE lower(make) = 'david brown'
  AND canonical_model = 'Speedback GT';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(coalesce(aliases, '{}'::text[]), ARRAY['special', 'hi 40', 'f'])
WHERE lower(make) = 'ferguson'
  AND canonical_model = 'P99';

-- 2. Insert 115 zero-family collector, cyclecar, racing, and vintage motorcycle marques
INSERT INTO public.canonical_models (
  id, make, canonical_model, year_start, year_end, aliases
)
VALUES
  (
    '00000000-0000-4000-f000-000000000957'::uuid,
    'Aermacchi',
    'Ala d''Oro',
    NULL,
    NULL,
    ARRAY['chimera', 'ala d oro', '250']
  ),
  (
    '00000000-0000-4000-f000-000000000958'::uuid,
    'Ajax',
    'Light Six',
    NULL,
    NULL,
    ARRAY['4 door sedan', 'prowler', 'trailer', 'utility trailer']
  ),
  (
    '00000000-0000-4000-f000-000000000959'::uuid,
    'American Ironhorse',
    'Slammer',
    NULL,
    NULL,
    ARRAY['slammer']
  ),
  (
    '00000000-0000-4000-f000-000000000960'::uuid,
    'Autodynamics',
    'Caldwell D-10',
    NULL,
    NULL,
    ARRAY['caldwell', 'mk 3']
  ),
  (
    '00000000-0000-4000-f000-000000000961'::uuid,
    'Bean Model',
    '12 HP',
    NULL,
    NULL,
    ARRAY['6 short', '4 12hp']
  ),
  (
    '00000000-0000-4000-f000-000000000962'::uuid,
    'Bianchi',
    '500M',
    NULL,
    NULL,
    ARRAY['500m', 'bianchiana', 'bernina', 'falco', '125']
  ),
  (
    '00000000-0000-4000-f000-000000000963'::uuid,
    'Bradley',
    'GT',
    NULL,
    NULL,
    ARRAY['gt', 'gtelectric', 'gt ii']
  ),
  (
    '00000000-0000-4000-f000-000000000964'::uuid,
    'Bremen',
    'Mini Mark',
    NULL,
    NULL,
    ARRAY['citation', 'mp lafer', 'maxi taxi', 'sport mini mark']
  ),
  (
    '00000000-0000-4000-f000-000000000965'::uuid,
    'Bug',
    'Stinger',
    NULL,
    NULL,
    ARRAY['sprint', 'stinger']
  ),
  (
    '00000000-0000-4000-f000-000000000966'::uuid,
    'Cagiva',
    'Mito 125',
    NULL,
    NULL,
    ARRAY['tamanaco', 'mito', 'freccia', '650 alazzura', 'alazzurra', 'grand canyon', 'canyon', 'corse']
  ),
  (
    '00000000-0000-4000-f000-000000000967'::uuid,
    'Calcott',
    '10.5 HP',
    NULL,
    NULL,
    ARRAY['two seater', '11 9hp']
  ),
  (
    '00000000-0000-4000-f000-000000000968'::uuid,
    'Caldwell',
    'D-9 Formula Ford',
    NULL,
    NULL,
    ARRAY['d 9', 'd 13']
  ),
  (
    '00000000-0000-4000-f000-000000000969'::uuid,
    'Checker Marathon',
    'Marathon',
    NULL,
    NULL,
    ARRAY['sedan', 'station wagon', 'taxi']
  ),
  (
    '00000000-0000-4000-f000-000000000970'::uuid,
    'Covered Wagon',
    'Travel Trailer',
    NULL,
    NULL,
    ARRAY['camping trailer', 'enclosed trailer', 'n a']
  ),
  (
    '00000000-0000-4000-f000-000000000971'::uuid,
    'Cz Jawa',
    '250',
    NULL,
    NULL,
    ARRAY['250', 'steel tanker']
  ),
  (
    '00000000-0000-4000-f000-000000000972'::uuid,
    'Dreyer',
    'Midget Racer',
    NULL,
    NULL,
    ARRAY['midget', 'junior racer']
  ),
  (
    '00000000-0000-4000-f000-000000000973'::uuid,
    'Elden',
    'Mk 10 Formula Ford',
    NULL,
    NULL,
    ARRAY['mk10', 'mk 10', 'formula race car']
  ),
  (
    '00000000-0000-4000-f000-000000000974'::uuid,
    'E-Z-Go',
    'RXV',
    NULL,
    NULL,
    ARRAY['rxv', 'txte']
  ),
  (
    '00000000-0000-4000-f000-000000000975'::uuid,
    'Futura',
    'Super Sport',
    NULL,
    NULL,
    ARRAY['sbarro', 'tandem axle', 'super sport']
  ),
  (
    '00000000-0000-4000-f000-000000000976'::uuid,
    'Fwd',
    'Model B',
    NULL,
    NULL,
    ARRAY['lorry', 'fire truck', 'pumper']
  ),
  (
    '00000000-0000-4000-f000-000000000977'::uuid,
    'Gem',
    'e4',
    NULL,
    NULL,
    ARRAY['e825', 'el', 'e4', 'ev']
  ),
  (
    '00000000-0000-4000-f000-000000000978'::uuid,
    'Gwynne',
    'Eight',
    NULL,
    NULL,
    ARRAY['8 brooklands', 'eight']
  ),
  (
    '00000000-0000-4000-f000-000000000979'::uuid,
    'Hercules',
    'W2000',
    NULL,
    NULL,
    ARRAY['w2000', '125 gs', 'gs125 7', '250', 'j bf']
  ),
  (
    '00000000-0000-4000-f000-000000000980'::uuid,
    'Hiawatha',
    'Doodle Bug',
    NULL,
    NULL,
    ARRAY['doodlebug', 'doodle bug']
  ),
  (
    '00000000-0000-4000-f000-000000000981'::uuid,
    'Hmv',
    'Freeway',
    NULL,
    NULL,
    ARRAY['freeway']
  ),
  (
    '00000000-0000-4000-f000-000000000982'::uuid,
    'Indiana',
    'Model 86',
    NULL,
    NULL,
    ARRAY['wrecker', '86']
  ),
  (
    '00000000-0000-4000-f000-000000000983'::uuid,
    'Italjet',
    'Dragster',
    NULL,
    NULL,
    ARRAY['cx80r', 'velocifero', 'dragster', 'buster', 'pack away', 'm5c', '100t', 'ks 50']
  ),
  (
    '00000000-0000-4000-f000-000000000984'::uuid,
    'King Midget',
    'Model III',
    NULL,
    NULL,
    ARRAY['model iii', 'model one', 'km']
  ),
  (
    '00000000-0000-4000-f000-000000000985'::uuid,
    'Legends',
    'Race Car',
    NULL,
    NULL,
    ARRAY['smooth', 'eagle classic', 'mini race car']
  ),
  (
    '00000000-0000-4000-f000-000000000986'::uuid,
    'Massey Ferguson',
    '135',
    NULL,
    NULL,
    ARRAY['135', '98', '90']
  ),
  (
    '00000000-0000-4000-f000-000000000987'::uuid,
    'Mccormick',
    'Farmall Cub',
    NULL,
    NULL,
    ARRAY['deering', 'farmall', 'w 9']
  ),
  (
    '00000000-0000-4000-f000-000000000988'::uuid,
    'Mcculloch',
    'R1 Go-Kart',
    NULL,
    NULL,
    ARRAY['300', 'r1']
  ),
  (
    '00000000-0000-4000-f000-000000000989'::uuid,
    'Metz',
    'Model 22',
    NULL,
    NULL,
    ARRAY['model 22', 'plan roadster', 'runabout']
  ),
  (
    '00000000-0000-4000-f000-000000000990'::uuid,
    'Mev',
    'Rocket',
    NULL,
    NULL,
    ARRAY['rocket', 'e v rocket']
  ),
  (
    '00000000-0000-4000-f000-000000000991'::uuid,
    'Monark',
    '125 MX',
    NULL,
    NULL,
    ARRAY['125mx', 'super deluxe', '125 mx', '125', 'whizzer', 'super twin']
  ),
  (
    '00000000-0000-4000-f000-000000000992'::uuid,
    'Motobecane',
    'Mobylette 50V',
    NULL,
    NULL,
    ARRAY['mobylette', '50v', 'moby', 'mb1', 'bma', 'velosolex']
  ),
  (
    '00000000-0000-4000-f000-000000000993'::uuid,
    'Moto Parilla',
    '175 Lusso Veloce',
    NULL,
    NULL,
    ARRAY['lusso veloce', '175', '250cc', '150 sport', 'electric bike']
  ),
  (
    '00000000-0000-4000-f000-000000000994'::uuid,
    'Moto Rumi',
    '125 Sport',
    NULL,
    NULL,
    ARRAY['sport', 'special']
  ),
  (
    '00000000-0000-4000-f000-000000000995'::uuid,
    'Ner-A-Car',
    'Model A',
    NULL,
    NULL,
    ARRAY['model a', 'motorcycle', 'engine']
  ),
  (
    '00000000-0000-4000-f000-000000000996'::uuid,
    'New Hudson',
    'Autocycle',
    NULL,
    NULL,
    ARRAY['model 88e', 'autocycle']
  ),
  (
    '00000000-0000-4000-f000-000000000997'::uuid,
    'Orient Buckboard',
    '4 HP Buckboard',
    NULL,
    NULL,
    ARRAY['4hp']
  ),
  (
    '00000000-0000-4000-f000-000000000998'::uuid,
    'Polski',
    'Fiat 126p',
    NULL,
    NULL,
    ARRAY['fiat 126p', 'fiat']
  ),
  (
    '00000000-0000-4000-f000-000000000999'::uuid,
    'Republic',
    'Model 10',
    NULL,
    NULL,
    ARRAY['model 10', 'slingshot']
  ),
  (
    '00000000-0000-4000-f000-000000001000'::uuid,
    'Schwinn Sting Ray',
    'Krate',
    NULL,
    NULL,
    ARRAY['grey ghost', 'cotton picker', 'pea picker', 'apple krate', 'orange krate', 'fastback', 'fair lady']
  ),
  (
    '00000000-0000-4000-f000-000000001001'::uuid,
    'Sea-Doo',
    'GTX',
    NULL,
    NULL,
    ARRAY['gtx', 'challenger']
  ),
  (
    '00000000-0000-4000-f000-000000001002'::uuid,
    'Terrot',
    'Motorette',
    NULL,
    NULL,
    ARRAY['motorette', 'single', '247cc', '175 l', 'hct']
  ),
  (
    '00000000-0000-4000-f000-000000001003'::uuid,
    'Think',
    'Neighbor',
    NULL,
    NULL,
    ARRAY['neighbor', 'city']
  ),
  (
    '00000000-0000-4000-f000-000000001004'::uuid,
    'Tomberlin',
    'E-Merge',
    NULL,
    NULL,
    ARRAY['ghosthawk', 'ss', 'emerge']
  ),
  (
    '00000000-0000-4000-f000-000000001005'::uuid,
    'Van Diemen',
    'RF97',
    NULL,
    NULL,
    ARRAY['diemen', 'rf84', 'rf97', 'rf95', 'vd83']
  ),
  (
    '00000000-0000-4000-f000-000000001006'::uuid,
    'Velorex',
    'Oskar 16/350',
    NULL,
    NULL,
    ARRAY['oskar', '16 350', '16350']
  ),
  (
    '00000000-0000-4000-f000-000000001007'::uuid,
    'Volkswagon',
    'Type 2 Microbus',
    NULL,
    NULL,
    ARRAY['microbus', 'beetle', 'type 3']
  ),
  (
    '00000000-0000-4000-f000-000000001008'::uuid,
    'Zündapp',
    'K800',
    NULL,
    NULL,
    ARRAY['k800', 'janus 250', '49cc']
  ),
  (
    '00000000-0000-4000-f000-000000001009'::uuid,
    'Acoma',
    'Mini Comtesse',
    NULL,
    NULL,
    ARRAY['mini comtesse']
  ),
  (
    '00000000-0000-4000-f000-000000001010'::uuid,
    'American Eagle',
    '125 Comanche',
    NULL,
    NULL,
    ARRAY['125', '405', '238']
  ),
  (
    '00000000-0000-4000-f000-000000001011'::uuid,
    'Amf',
    'Roadmaster',
    NULL,
    NULL,
    ARRAY['harley davidson', 'roadmaster']
  ),
  (
    '00000000-0000-4000-f000-000000001012'::uuid,
    'Arctic',
    'Cat Puma',
    NULL,
    NULL,
    ARRAY['cat puma', 'cat panther', 'cat 500']
  ),
  (
    '00000000-0000-4000-f000-000000001013'::uuid,
    'Argyle',
    'Folding Scooter',
    NULL,
    NULL,
    ARRAY['folding scooter', 'scooter']
  ),
  (
    '00000000-0000-4000-f000-000000001014'::uuid,
    'Atk',
    '406',
    NULL,
    NULL,
    ARRAY['560', '406', '600']
  ),
  (
    '00000000-0000-4000-f000-000000001015'::uuid,
    'Beta',
    'ALP 250',
    NULL,
    NULL,
    ARRAY['450', 'alp 250', 'tr32']
  ),
  (
    '00000000-0000-4000-f000-000000001016'::uuid,
    'Blazer Deluxe',
    'Car Hauler',
    NULL,
    NULL,
    ARRAY['car hauler']
  ),
  (
    '00000000-0000-4000-f000-000000001017'::uuid,
    'Bolens',
    'Ride-A-Matic',
    NULL,
    NULL,
    ARRAY['ride a matic']
  ),
  (
    '00000000-0000-4000-f000-000000001018'::uuid,
    'Bridgestone',
    '175 Hurricane Scrambler',
    NULL,
    NULL,
    ARRAY['350', 'sr175', '175', 'sport', 'hs175', '100', 'gp100', 'bs100']
  ),
  (
    '00000000-0000-4000-f000-000000001019'::uuid,
    'Brush',
    'Model D Runabout',
    NULL,
    NULL,
    ARRAY['model d', 'model a']
  ),
  (
    '00000000-0000-4000-f000-000000001020'::uuid,
    'Cheney-Triumph',
    'T110',
    NULL,
    NULL,
    ARRAY['t110', 't100c']
  ),
  (
    '00000000-0000-4000-f000-000000001021'::uuid,
    'Cockshutt',
    'Model 20',
    NULL,
    NULL,
    ARRAY['20', '30']
  ),
  (
    '00000000-0000-4000-f000-000000001022'::uuid,
    'Condor',
    'A580',
    NULL,
    NULL,
    ARRAY['a580 1', 'a580', 'a350']
  ),
  (
    '00000000-0000-4000-f000-000000001023'::uuid,
    'Coventry Eagle',
    'Flying-8',
    NULL,
    NULL,
    ARRAY['model 1', 'model k2', 's29']
  ),
  (
    '00000000-0000-4000-f000-000000001024'::uuid,
    'Doodlebug',
    'Super Special',
    NULL,
    NULL,
    ARRAY['factory scooter', 'super special']
  ),
  (
    '00000000-0000-4000-f000-000000001025'::uuid,
    'Fox',
    'Mak-Kart',
    NULL,
    NULL,
    ARRAY['mak kart', 'super kart', 'flyweight', 'thunderbolt']
  ),
  (
    '00000000-0000-4000-f000-000000001026'::uuid,
    'Francis-Barnett',
    'Falcon',
    NULL,
    NULL,
    ARRAY['falcon', 'fulmar', '249cc', '250cc', '197cc']
  ),
  (
    '00000000-0000-4000-f000-000000001027'::uuid,
    'Haulmark',
    'Edge Race Trailer',
    NULL,
    NULL,
    ARRAY['trailer', 'edge', 'goose neck']
  ),
  (
    '00000000-0000-4000-f000-000000001028'::uuid,
    'Holmquist',
    'Midget Racer',
    NULL,
    NULL,
    ARRAY['midget']
  ),
  (
    '00000000-0000-4000-f000-000000001029'::uuid,
    'Indian/Royal Enfield',
    'Chief',
    NULL,
    NULL,
    ARRAY['tomahawk', 'chief', 'trailblazer', 'woodsman']
  ),
  (
    '00000000-0000-4000-f000-000000001030'::uuid,
    'Janus',
    'Halcyon 250',
    NULL,
    NULL,
    ARRAY['halcyon', 'phoenix 250']
  ),
  (
    '00000000-0000-4000-f000-000000001031'::uuid,
    'Lambretta Li',
    'LI 150',
    NULL,
    NULL,
    ARRAY['150', '50 special']
  ),
  (
    '00000000-0000-4000-f000-000000001032'::uuid,
    'Lorinser',
    '500SL Mini',
    NULL,
    NULL,
    ARRAY['mercedes']
  ),
  (
    '00000000-0000-4000-f000-000000001033'::uuid,
    'Manco',
    'Indy Go-Kart',
    NULL,
    NULL,
    ARRAY['mini kar', 'go kart', 'indy', 'valvoline kart', 'big cat']
  ),
  (
    '00000000-0000-4000-f000-000000001034'::uuid,
    'Mccormick-Deering',
    'O-6 Orchard',
    NULL,
    NULL,
    ARRAY['o 6', 'farmall b', 'corn sheller']
  ),
  (
    '00000000-0000-4000-f000-000000001035'::uuid,
    'Mercedez-Benz',
    '450SL',
    NULL,
    NULL,
    ARRAY['450sl', '380sl', '450slc']
  ),
  (
    '00000000-0000-4000-f000-000000001036'::uuid,
    'Motobi',
    '125 Imperiale',
    NULL,
    NULL,
    ARRAY['125', 'imperial', 'imperiale', 'ardizio', '125cc']
  ),
  (
    '00000000-0000-4000-f000-000000001037'::uuid,
    'Moto Morini',
    '125 Corsaro',
    NULL,
    NULL,
    ARRAY['corsaro', '125']
  ),
  (
    '00000000-0000-4000-f000-000000001038'::uuid,
    'Motoped',
    'Cruzer',
    NULL,
    NULL,
    ARRAY['cruzer', 'pro bike']
  ),
  (
    '00000000-0000-4000-f000-000000001039'::uuid,
    'Murray',
    'Pedal Car',
    NULL,
    NULL,
    ARRAY['jolly roger', 'track 2', 'pedal car']
  ),
  (
    '00000000-0000-4000-f000-000000001040'::uuid,
    'Muskin',
    'Dune Cat',
    NULL,
    NULL,
    ARRAY['el gato', 'dune cat']
  ),
  (
    '00000000-0000-4000-f000-000000001041'::uuid,
    'New Imperial',
    'Model 30',
    NULL,
    NULL,
    ARRAY['model 110', 'model 46', 'model 30']
  ),
  (
    '00000000-0000-4000-f000-000000001042'::uuid,
    'Pannonia',
    '250 TLF',
    NULL,
    NULL,
    ARRAY['csepel 250', '250', 'tlf']
  ),
  (
    '00000000-0000-4000-f000-000000001043'::uuid,
    'Pirsch',
    'Aerial Ladder Truck',
    NULL,
    NULL,
    ARRAY['fire truck', 'aerial']
  ),
  (
    '00000000-0000-4000-f000-000000001044'::uuid,
    'Powell',
    'P-81',
    NULL,
    NULL,
    ARRAY['p81', 'p48', 'sport wagon', 'streamliner']
  ),
  (
    '00000000-0000-4000-f000-000000001045'::uuid,
    'Ridley',
    'Speedster',
    NULL,
    NULL,
    ARRAY['speedster', 'sport', 'the twin']
  ),
  (
    '00000000-0000-4000-f000-000000001046'::uuid,
    'Sachs',
    '125 MX',
    NULL,
    NULL,
    ARRAY['125', '125mx', 'hercules', 'suburban']
  ),
  (
    '00000000-0000-4000-f000-000000001047'::uuid,
    'Saxon',
    'Roadster',
    NULL,
    NULL,
    ARRAY['sceptre', 'roadster']
  ),
  (
    '00000000-0000-4000-f000-000000001048'::uuid,
    'Simson',
    'Spatz',
    NULL,
    NULL,
    ARRAY['425s', 'spatz']
  ),
  (
    '00000000-0000-4000-f000-000000001049'::uuid,
    'Sondors',
    'Metacycle',
    NULL,
    NULL,
    ARRAY['metacycle']
  ),
  (
    '00000000-0000-4000-f000-000000001050'::uuid,
    'Springfield',
    'Roadster',
    NULL,
    NULL,
    ARRAY['roadster']
  ),
  (
    '00000000-0000-4000-f000-000000001051'::uuid,
    'Steen',
    'Taco 100',
    NULL,
    NULL,
    ARRAY['taco', 'alsport']
  ),
  (
    '00000000-0000-4000-f000-000000001052'::uuid,
    'Trabant',
    '601',
    NULL,
    NULL,
    ARRAY['601', '601s']
  ),
  (
    '00000000-0000-4000-f000-000000001053'::uuid,
    'Velosolex',
    'Solex 3800',
    NULL,
    NULL,
    ARRAY['solex', '4600', '50cc']
  ),
  (
    '00000000-0000-4000-f000-000000001054'::uuid,
    'Volkswagen-Powered',
    'Dune Buggy',
    NULL,
    NULL,
    ARRAY['dune buggy', 'bugatti']
  ),
  (
    '00000000-0000-4000-f000-000000001055'::uuid,
    'Wards',
    'Riverside',
    NULL,
    NULL,
    ARRAY['riverside']
  ),
  (
    '00000000-0000-4000-f000-000000001056'::uuid,
    'Waterwitch',
    'Outboard',
    NULL,
    NULL,
    ARRAY['outboard']
  ),
  (
    '00000000-0000-4000-f000-000000001057'::uuid,
    'Weslake',
    'Speedway 500',
    NULL,
    NULL,
    ARRAY['speedway', 'model z']
  ),
  (
    '00000000-0000-4000-f000-000000001058'::uuid,
    'Yankee',
    '500Z',
    NULL,
    NULL,
    ARRAY['z500', '500z']
  ),
  (
    '00000000-0000-4000-f000-000000001059'::uuid,
    'Zero',
    'SR/F',
    NULL,
    NULL,
    ARRAY['sr f', 'dsr', 'srf']
  ),
  (
    '00000000-0000-4000-f000-000000001060'::uuid,
    'Moto Scoot',
    'Solo',
    NULL,
    NULL,
    ARRAY['scooter', 'solo']
  ),
  (
    '00000000-0000-4000-f000-000000001061'::uuid,
    'Ferguson Ted20',
    'TED20',
    NULL,
    NULL,
    ARRAY['tractor']
  ),
  (
    '00000000-0000-4000-f000-000000001062'::uuid,
    'Fantic',
    'Broncco',
    NULL,
    NULL,
    ARRAY['broncco', 'trial 240', 'tx120', '49cc']
  ),
  (
    '00000000-0000-4000-f000-000000001063'::uuid,
    'Lil Indian',
    'Minibike',
    NULL,
    NULL,
    ARRAY['mini bike', 'custom']
  ),
  (
    '00000000-0000-4000-f000-000000001064'::uuid,
    'Daf',
    '750',
    NULL,
    NULL,
    ARRAY['750', 'flatbed trailer', '33 saloon']
  ),
  (
    '00000000-0000-4000-f000-000000001065'::uuid,
    'Tyran',
    '125 MX',
    NULL,
    NULL,
    ARRAY['125mx', '125']
  ),
  (
    '00000000-0000-4000-f000-000000001066'::uuid,
    'Cimatti',
    'Twin Sport',
    NULL,
    NULL,
    ARRAY['bobcat', 'twin sport', 'fifty']
  ),
  (
    '00000000-0000-4000-f000-000000001067'::uuid,
    'Alsport',
    'Tri-Sport',
    NULL,
    NULL,
    ARRAY['tri sport']
  ),
  (
    '00000000-0000-4000-f000-000000001068'::uuid,
    'Garton',
    'Kidillac',
    NULL,
    NULL,
    ARRAY['pedal car', 'kidillac']
  ),
  (
    '00000000-0000-4000-f000-000000001069'::uuid,
    'Daix',
    'Trail 70',
    NULL,
    NULL,
    ARRAY['honda trail 70']
  ),
  (
    '00000000-0000-4000-f000-000000001070'::uuid,
    'Bird',
    'Minibike',
    NULL,
    NULL,
    ARRAY['funny car', 'go kart', 'go cart', 'chopper']
  ),
  (
    '00000000-0000-4000-f000-000000001071'::uuid,
    'Cotton',
    'Cavalier',
    NULL,
    NULL,
    ARRAY['cavalier', 'trials', '250']
  ),
  (
    '00000000-0000-4000-f000-000000001072'::uuid,
    'Swm',
    'RS250 GS',
    NULL,
    NULL,
    ARRAY['rs250', 'rs250gs', 'tl320']
  ),
  (
    '00000000-0000-4000-f000-000000001073'::uuid,
    'Bond',
    'Equipe GT',
    NULL,
    NULL,
    ARRAY['bug 700es', 'equipe']
  ),
  (
    '00000000-0000-4000-f000-000000001074'::uuid,
    'Wheel Horse',
    'C-120',
    NULL,
    NULL,
    ARRAY['d160', 'rd400', 'c100', '314 h', 'bronco 14', 'c 120', '520 h', '800 commando', '16 horse']
  ),
  (
    '00000000-0000-4000-f000-000000001075'::uuid,
    'Brockhouse',
    'Corgi',
    NULL,
    NULL,
    ARRAY['corgi']
  ),
  (
    '00000000-0000-4000-f000-000000001076'::uuid,
    'Neptune',
    'Mighty Mite',
    NULL,
    NULL,
    ARRAY['outboard', 'outboard motor']
  ),
  (
    '00000000-0000-4000-f000-000000001077'::uuid,
    'Evinrude',
    'Skeeter',
    NULL,
    NULL,
    ARRAY['elto', 'skeeter', 'bobcat']
  ),
  (
    '00000000-0000-4000-f000-000000001078'::uuid,
    'Mtd',
    'Trail Flite',
    NULL,
    NULL,
    ARRAY['columbia', 'trail flite']
  ),
  (
    '00000000-0000-4000-f000-000000001079'::uuid,
    'Dot',
    'Demon Trials',
    NULL,
    NULL,
    ARRAY['demon', 'sch', 'dmw']
  ),
  (
    '00000000-0000-4000-f000-000000001080'::uuid,
    'Ferguson Te20',
    'TE20',
    NULL,
    NULL,
    ARRAY['tractor']
  ),
  (
    '00000000-0000-4000-f000-000000001081'::uuid,
    'Cyclemaster',
    'Cyclemotor',
    NULL,
    NULL,
    ARRAY['25cc', '32cc', 'raleigh']
  )
ON CONFLICT (id) DO UPDATE
SET
  make = EXCLUDED.make,
  canonical_model = EXCLUDED.canonical_model,
  year_start = EXCLUDED.year_start,
  year_end = EXCLUDED.year_end,
  aliases = EXCLUDED.aliases;
