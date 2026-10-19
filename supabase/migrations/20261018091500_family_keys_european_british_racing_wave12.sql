-- Slice 28: Expand sub-model alias coverage across 55 collector, European, British, racing,
-- and JDM marques (AM General, Autobianchi, Bimota, Bristol, Brough Superior, Chevron,
-- Citroen, Citroën, Cooper, Daihatsu, Darracq, De Dion Bouton, Delage, DeSoto, Devin,
-- Diamond T, DKW, Factory, Farmall, Franklin, Freightliner, Humber, Icon, Infiniti,
-- International, Jensen, John Deere, Kaiser, Kenworth, Lanchester, Lancia, Land, LaSalle,
-- Laverda, Locomobile, Maxwell, Messerschmitt, Minerva, Mitsubishi, Moto, Opel, Panoz,
-- Renault, Royal Enfield, Saturn, Sears, Simplex, Stanley, Sterling, Stutz, Sunbeam,
-- TVR, White, Acura, Shelby, MV Agusta).

-- 1. AM General
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'dj 5d', 'dj 5g', 'mail truck', 'm35a2c', 'm997a2', 'm1038', 'm1097',
      'm109a4', 'm1114', 'm35a', 'm915a1', 'm923a', 'm925', 'cj 8', 'm 998'
    ]
  )
WHERE lower(make) = 'am general'
  AND canonical_model = 'Hummer';

-- 2. Autobianchi
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'stellina', 'barchetta', '58 70', 'convertible', 'eden roc', 'jolly',
      'giardiniera', 'panoramica', 'transformable', '500 giardiniera'
    ]
  )
WHERE lower(make) = 'autobianchi'
  AND canonical_model = 'Bianchina';

-- 3. Bimota
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'bb1', 'supermono', 'db1', 'db3', 'mantra', 'db6', 'delirio', 'hb3',
      'sb8k', 'santamonica', 'yb10', 'dieci', 'yb5', 'yb6'
    ]
  )
WHERE lower(make) = 'bimota'
  AND canonical_model = 'Tesi';

-- 4. Bristol
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'beaufighter', '404', '407', '408', '409', '410', '412', 'blenheim',
      'brigand', 'britannia', '406e', 'beutler'
    ]
  )
WHERE lower(make) = 'bristol'
  AND canonical_model = '400';

-- 5. Brough Superior
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '11 50hp', '3 1 2 litre', 'saloon', 'v12', '4 2 litre', 'drophead',
      '6 5hp', '748cc', 'mark ii', '680', '981cc', 'mki', 'overhead 680'
    ]
  )
WHERE lower(make) = 'brough superior'
  AND canonical_model = 'SS80';

-- 6. Chevron
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['b2', 'b23', 'b27', 'b31', 'b39', 'b63', 'b38', 'formula 3', 'formula atlantic']
  )
WHERE lower(make) = 'chevron'
  AND canonical_model = 'B16';

-- 7. Citroen & Citroën
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '11 4hp', '2cv4', 'ami', 'ami buggy', 'ax gt', 'beachcomber', '16 valve',
      '19tzi', 'c3 pluriel', 'pluriel', 'c4 limousine', 'custom sedan',
      'cx2200', 'ds19a', 'd special', 'id 19', 'id19b', 'lomax 223',
      'lomax 224', 'lomax', 'roadster', 'type a', 'type c', '5 hp', 'vanstore',
      'xsara break', 'zx volcane', 'volcane'
    ]
  )
WHERE lower(make) = 'citroen'
  AND canonical_model = 'DS';

UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'ds23ie', 'pallas', 'light fifteen', 'light 15', 'type c', 'cloverleaf',
      '5cv', 'c3', 'trefle', 'c4f', 'child s car', 'cx22rs', 'safari estate',
      'ds20', 'id21', 'kegresse', 'p17e', 'half track', 'type 23r', 'type 7',
      '11b', 'iib', 'visa', 'mille pistes', '11 bl', 'legere', 'xantia',
      'traction', '855cc'
    ]
  )
WHERE lower(make) = 'citroën'
  AND canonical_model = 'DS';

-- 8. Cooper
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      't52', 'formula junior', 't1', 't76', 'formula 3', 'single seater',
      'mark v', 'mark viii', 'mark ix', 'mark xii', 'mkv', 'mark vi',
      'mkvi', '22 5hp', 'monoposto'
    ]
  )
WHERE lower(make) = 'cooper'
  AND canonical_model = 'Monaco';

-- 9. Daihatsu
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'terios kid', 'terios', 'move', 'aero down', 'atrai', 'delta wide',
      'delta', 'naked', 'rugger', 'f55'
    ]
  )
WHERE lower(make) = 'daihatsu'
  AND canonical_model = 'Hijet';

-- 10. Darracq
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '20 28hp', '6 1 2hp', 'voiturette', 'tonneau', 'g11', 'm67', '8 10hp',
      'open tourer', 'project', 'type v14', '16 hp', 'torpedo'
    ]
  )
WHERE lower(make) = 'darracq'
  AND canonical_model = '12 HP';

-- 11. De Dion Bouton
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '12hp', 'type gb', 'town car', 'quadricycle', '275cc', '3 1 2hp',
      'double phaeton', 'voiturette', 'dh', 'two seater', 'engine',
      'fire tender', 'model hd', '15cv', 'charabanc', 'type br', '12 14hp',
      'type cr', 'cabriolet', 'type n', '6cv'
    ]
  )
WHERE lower(make) = 'de dion bouton'
  AND canonical_model = 'Motorette';

-- 12. Delage
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'di tourer', 'di', '10hp', 'voiturette', '14hp', 'dis', 'type ak5',
      'ai skiff', 'd6l', 'de tourer', 'dm', 'skiff', 'type ai', 'type bk',
      'torpedo', 'type f3', '6 1 2hp', 'type r4', 'raceabout', '11cv'
    ]
  )
WHERE lower(make) = 'delage'
  AND canonical_model = 'D8';

-- 13. DeSoto
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '4 door sedan', 'sedan', '9 passenger', 'limo', 'pace car', 'club coupe',
      'woodie', 'station wagon', 'fairwind', 'model k', 'roadster', 'sd',
      'series sa', '6'
    ]
  )
WHERE lower(make) = 'desoto'
  AND canonical_model = 'Adventurer';

-- 14. Devin
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'bodied triumph', 'tr3', 'bodied volkswagen', 'chevrolet', 'custom',
      'mga', 'project', 'roadster', 'special', 'vw'
    ]
  )
WHERE lower(make) = 'devin'
  AND canonical_model = 'SS';

-- 15. Diamond T
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '2 5hp', 'motorcycle', '306', '32 5', '921nt', '990', 'express',
      'one ton', 'model t4d', 't4d', 't', '306h', 'dump truck', 'car hauler',
      'hauler', 'truck'
    ]
  )
WHERE lower(make) = 'diamond t'
  AND canonical_model = '201';

-- 16. DKW
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'hornet', '115', 'sputnik', '36', 'candango', 'f5', 'f5 700', 'front luxus',
      'f7', 'mc125', 'mx 125', 'type 503', 'van', 'violetta'
    ]
  )
WHERE lower(make) = 'dkw'
  AND canonical_model = '3=6';

-- 17. Factory
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'five racing', 'fiver racing', 'hot rod', '818 c', '818s c', '818',
      'mkiii roadster', 'cobra', 'xtf'
    ]
  )
WHERE lower(make) = 'factory'
  AND canonical_model = 'Five Mk4';

-- 18. Farmall
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['504', '560', '460', '706', 'hv', 'md', 'smd', '200', 'w 4']
  )
WHERE lower(make) = 'farmall'
  AND canonical_model = 'Super M';

-- 19. Franklin
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '11 a', '11a', '11b', '145', '5 7 litre', 'club sedan', 'g touring',
      'six 30', 'series 9 b', '9 b'
    ]
  )
WHERE lower(make) = 'franklin'
  AND canonical_model = 'Airman';

-- 20. Freightliner
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'aspire', 'columbia', 'f', 'fl112', 'fla', '10464t', 'mc2', 'mt55',
      'mt 55', 'sl70'
    ]
  )
WHERE lower(make) = 'freightliner'
  AND canonical_model = 'M2';

-- 21. Humber
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '12 saloon', '12 25hp', '16 60hp', '12 25', '14 40', '14 40hp', '15hp',
      '250 wr', '9 20hp', '10hp', 'tricycle'
    ]
  )
WHERE lower(make) = 'humber'
  AND canonical_model = 'Super Snipe';

-- 22. Icon
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['i60l', 'i40', 'i60', 'electric', 'i60 lx', 'old school', 'i60 3']
  )
WHERE lower(make) = 'icon'
  AND canonical_model = 'BR';

-- 23. Infiniti
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'm', 'i30t', 'fx37', 'g20t', 'g35x', 'g37x', 'g37xs', 'i', 'j30t',
      'jx35', 'm56', 'm56 s', 'm56s', 'q40', 'q70l', 'ex', 'qx50', 'ex37'
    ]
  )
WHERE lower(make) = 'infiniti'
  AND canonical_model = 'G35';

-- 24. International (covers International Harvester)
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['1100c', '1200d', '1300d', 'c 1300', 'c 30', 'cargostar']
  )
WHERE lower(make) = 'international'
  AND canonical_model = 'Travelall';

-- 25. Jensen
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'gt', '541s', '541r', 'coupe', 'shooting brake', 'intercept', 'jh5',
      'mkii', '25', 's type'
    ]
  )
WHERE lower(make) = 'jensen'
  AND canonical_model = 'Interceptor';

-- 26. John Deere
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '112', '2520', '330 s', '330 u', '40h', '40s', '425', '435', '4520',
      '45 combine', '5010', '520', '7520', '970', 'buckboard', 'industrial l',
      'unstyled l', 'xuv560e'
    ]
  )
WHERE lower(make) = 'john deere'
  AND canonical_model = '4020';

-- 27. Kaiser
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'deluxe', 'custom coupe', '4 door sedan', 'two door sedan', 'jeep',
      'm725', 'm818', 'm35a2', 'n a', 'traveler'
    ]
  )
WHERE lower(make) = 'kaiser'
  AND canonical_model = 'Darrin';

-- 28. Kenworth
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '125', '2 ton truck', '848', 'bc 825 c', 'cc825c', 'cj 921', 'tcf 521',
      'toter', 'w 900'
    ]
  )
WHERE lower(make) = 'kenworth'
  AND canonical_model = 'W900';

-- 29. Lanchester
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '18hp', '21hp', '23hp', '32hp', 'straight 8', 'eleven', 'ld10', 'type e'
    ]
  )
WHERE lower(make) = 'lanchester'
  AND canonical_model = '40 HP';

-- 30. Lancia
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'thema', '8 32', 'ardea', 'augusta', 'b20', 'belna', 'coupe', 'gamma',
      'montecarlo', 'moretti', 'rallye', 'simplex', 'testarossa', 'y lx',
      '2000', 'zagato', '2000 hf'
    ]
  )
WHERE lower(make) = 'lancia'
  AND canonical_model = 'Delta Integrale';

-- 31. Land
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'rover 88', 'series iia', 'lr2', 'santana', 'series iii', 'speed lakester'
    ]
  )
WHERE lower(make) = 'land'
  AND canonical_model = 'Rover Defender';

-- 32. LaSalle
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'sedan', '345b', '345c', 'phaeton', 'series 328', '328', 'special series',
      '340', 'street rod'
    ]
  )
WHERE lower(make) = 'lasalle'
  AND canonical_model = 'Series 50';

-- 33. Laverda
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '3c', 'jarama', '750s', 'american eagle', '750gt', 'laverdino', 'sf1', 'sf750'
    ]
  )
WHERE lower(make) = 'laverda'
  AND canonical_model = '750 SFC';

-- 34. Locomobile
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'model 5', 'locosurrey', 'model 30 l', 'model 30', '8 80', 'project',
      'steam car', 'steam carriage', 'steamer', 'type 2', 'steam runabout',
      'style 1', 'stanhope', 'spindle seat'
    ]
  )
WHERE lower(make) = 'locomobile'
  AND canonical_model = 'Model 48';

-- 35. Maxwell
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '25', '25 4', 'commercial delivery', 'model aa', 'model lc', 'q',
      'q 4', 'q series', 'touring'
    ]
  )
WHERE lower(make) = 'maxwell'
  AND canonical_model = 'Model H';

-- 36. Messerschmitt
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'kr201', 'kabinenroller', 'tg1400', 'kr 175', 'kr 200', 'tg500', 'microcar'
    ]
  )
WHERE lower(make) = 'messerschmitt'
  AND canonical_model = 'KR200';

-- 37. Minerva
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '26hp', 'type s', '3 1 2hp', '4 1 2hp', 'v twin', 'ag 16hp', '16hp',
      'ak', 'an torpedo', 'c22', 'tt 80', 'model gg', 'type ab', 'type ad',
      '20 hp', 'type f'
    ]
  )
WHERE lower(make) = 'minerva'
  AND canonical_model = 'Type AL';

-- 38. Mitsubishi
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'bravo', 'challenger', 'diamante', 'eclpse', 'expo lrv', 'galloper',
      'gto', 'j 53', 'j54', 'jeep', 'j24', 'j37', 'j53', 'j55', 'j56',
      'legnum', 'minica', 'rosa', 'rvr'
    ]
  )
WHERE lower(make) = 'mitsubishi'
  AND canonical_model = 'Lancer Evolution';

-- 39. Moto
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['morini', 'parilla', 'ski capri', 'moto ski']
  )
WHERE lower(make) = 'moto'
  AND canonical_model = 'Guzzi V7';

-- 40. Opel
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '18c', 'regent', '1900', 'astra', 'calibra', 'kapitan', 'olympia',
      'rekord', 'senator'
    ]
  )
WHERE lower(make) = 'opel'
  AND canonical_model = 'GT';

-- 41. Panoz
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['gts', 'gt wc', 'convertible', 'roadster s', 'styling buck']
  )
WHERE lower(make) = 'panoz'
  AND canonical_model = 'Esperante';

-- 42. Renault
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '1000 kg', '12', '12 routier', '12 ts', '15 gtl', '16 tl', '19 16v',
      '20tx', '5 tse', '6 tl', 'berline', 'coupe', 'ek 9hp', 'goelette',
      'lorry', 'megane', 'midlum', 'monosix', 'petit panel', 'race car',
      'roadster', 'tn4b', 'tn4h', 'vivasix'
    ]
  )
WHERE lower(make) = 'renault'
  AND canonical_model = 'Dauphine';

-- 43. Royal Enfield
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '125cc', 'prince', 'model x', 'model g', '350', 'clipper', 'continental',
      'gt250', 'int650', 're2', 'wd co'
    ]
  )
WHERE lower(make) = 'royal enfield'
  AND canonical_model = 'Interceptor';

-- 44. Saturn
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'l200', 'lw2', 'lw300', 'sc', 'sc1', 'sl', '2 door coupe', 'sl1', 'lw1'
    ]
  )
WHERE lower(make) = 'saturn'
  AND canonical_model = 'Sky';

-- 45. Sears
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '250 sgs', 'campus 50', 'cruisaire', 'drag race', 'free spirit',
      'high wheeler', 'compact d50'
    ]
  )
WHERE lower(make) = 'sears'
  AND canonical_model = 'Motor Buggy';

-- 46. Simplex
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['automatic', 'motorcycle', 'senior sportsman', '125', 'sportsman']
  )
WHERE lower(make) = 'simplex'
  AND canonical_model = '50 HP';

-- 47. Stanley
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'model 725', '725', '20hp', 'sv252 a', 'model cx', '8hp', 'steam roadster',
      'type c', '6 5 hp', 'model 735', '735'
    ]
  )
WHERE lower(make) = 'stanley'
  AND canonical_model = 'Steamer';

-- 48. Sterling
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '825sl', '827sl', 'dw 18 64', 'fcs210', 'gt', 'hws', 'log truck',
      'project', 'st9500', 'stake bed', 'kit car'
    ]
  )
WHERE lower(make) = 'sterling'
  AND canonical_model = 'Acterra';

-- 49. Stutz
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '1800s', 'fire engine', 'model h', 'series 695h', 'series 695',
      'speedway six', 'sportbrohm'
    ]
  )
WHERE lower(make) = 'stutz'
  AND canonical_model = 'Bearcat';

-- 50. Sunbeam
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '14 40hp', '14 40', '16 20', '16 9 hp', '16 9hp', '20 9hp', '20 9 hp',
      '2 3 4 hp', '23 8hp', '250cc', '25 hp', '25hp', 'dawn', 'model 1',
      'model 14', 'model 7', 'sixteen', 'twenty', 'twenty five'
    ]
  )
WHERE lower(make) = 'sunbeam'
  AND canonical_model = 'Alpine';

-- 51. TVR
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '3000s', 's1', '2500', 'convertible', 's3', 's3c', 'tasmin', 'v8s'
    ]
  )
WHERE lower(make) = 'tvr'
  AND canonical_model = 'Griffith';

-- 52. White
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '3000', '4 150', '5 ton', 'freightliner', 'g a touring', 'model 45',
      'model thirty', 'wc 22', 'western star'
    ]
  )
WHERE lower(make) = 'white'
  AND canonical_model = 'Model L';

-- 53. Acura
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '3 2tl', '3 5rl', 'rdx', 'slx', 'tlx', 'ura nsx t', '3 0cl', 'zdx',
      '3 2cl', 'csx'
    ]
  )
WHERE lower(make) = 'acura'
  AND canonical_model = 'TL';

-- 54. Shelby
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'lancer', 're creation', 'dakota', 'mustang', 'omni glhs', 'shadow',
      'can am', 'coupe replica'
    ]
  )
WHERE lower(make) = 'shelby'
  AND canonical_model = 'Cobra';

-- 55. MV Agusta (Dragster & Augusta spelling variants)
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['dragster', 'dragster 800', '800rr', '800rc', 'augusta', '175 cs']
  )
WHERE lower(make) = 'mv agusta'
  AND canonical_model = '750 S';
