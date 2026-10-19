-- Slice 29: Expand sub-model alias coverage across 98 collector, luxury, racing, and
-- top-volume marques (Continental, Westfield, Meyers, AC, Avanti, Caterham, Factory Five,
-- Intermeccanica, Mack, Morgan, Pierce-Arrow, Polaris, Alpine, Zundapp, Bentley, Lola,
-- Rolls-Royce, Bugatti, DeLorean, Lexus, Hummer, Indian, Allard, Pierce, Yamaha,
-- Aston Martin, Airstream, Suzuki, Desoto, Excelsior, Hyundai, Lea-Francis, McLaren,
-- Armstrong Siddeley, Auburn, De Tomaso, Rudge, Spartan, Delahaye, Alvis, Velocette,
-- Graham, Radical, Tatra, Willys, Hodaka, Invicta, Kurtis Kraft, Steyr, Amilcar,
-- Amphicar, Autocar, Imperial, Cord, Benz, Fisker, Excalibur, Moke, Willys-Overland,
-- Panhard, Peterbilt, Pininfarina, Lamborghini, Ram, Checker, plus Ford, Chevrolet,
-- Mercedes-Benz, BMW, Dodge, Cadillac, Volkswagen, Porsche, Buick, Nissan,
-- Harley-Davidson, Land Rover, Pontiac, Plymouth, GMC, Oldsmobile, Toyota, Ferrari,
-- Chrysler, Jeep, Alfa Romeo, Jaguar, MG, Mazda, Lincoln, Volvo, Mini, Mercury,
-- Lotus, Saab, Subaru, Maserati, Audi, Austin-Healey, Kawasaki).

-- 1. Continental
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['mkii', 'mk ii', 'mark iii', 'mark vii', '1956']
  )
WHERE lower(make) = 'continental'
  AND canonical_model = 'Mark II';

-- 2. Westfield
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'seven', '7', 'lotus 11', 'lotus eleven', 's3i', 'seiw', 'super seven',
      'sport', '1800i', 'supersport'
    ]
  )
WHERE lower(make) = 'westfield'
  AND canonical_model = 'Eleven';

-- 3. Meyers
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['manxter', 'manx', 'nmg', 'towd', 'tow dster']
  )
WHERE lower(make) = 'meyers'
  AND canonical_model = 'Manx';

-- 4. AC
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['2 7 litre', '3000 me', '427', 'roadster', 'six tourer']
  )
WHERE lower(make) = 'ac'
  AND canonical_model = 'Ace';

-- 5. Avanti
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'touring sedan', 'anniversary edition', 'avanti', '904 gts', 'rbk',
      'sedan', '904 replica'
    ]
  )
WHERE lower(make) = 'avanti'
  AND canonical_model = 'II';

-- 6. Caterham
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'superlite', 'super', 'ct03', 'slr', 'superlight', 'r300', '360s',
      'super sprint', '360 s'
    ]
  )
WHERE lower(make) = 'caterham'
  AND canonical_model = 'Seven';

-- 7. Factory Five
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'ford', 'five racing', 'mark 2', 'mk2', 'hot rod', 'roadster', 'custom'
    ]
  )
WHERE lower(make) = 'factory five'
  AND canonical_model = 'Mk4 Roadster';

-- 8. Intermeccanica
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'omega', 'squire', 'ss100', 'ss 100', 'indra', '356 replica', 'roadster',
      'convertible d'
    ]
  )
WHERE lower(make) = 'intermeccanica'
  AND canonical_model = 'Italia';

-- 9. Mack
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'lj', 'cf', 'ds 600', 'ehx', 'l series', 'mini mack', 'r600', 'tractor',
      'b 61t'
    ]
  )
WHERE lower(make) = 'mack'
  AND canonical_model = 'B61';

-- 10. Morgan
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'all new super', 'convertible', 'f4', 'three wheeler', 'f sport',
      'monoposto', 'm3w', 'roadster', 're creation', 'supersport'
    ]
  )
WHERE lower(make) = 'morgan'
  AND canonical_model = 'Plus 4';

-- 11. Pierce-Arrow
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '5 passenger sedan', 'limousine', 'club brougham', 'deluxe 8',
      'door convertible', 'fire truck', 'le baron', 'm715', 'r 8', 'tow truck'
    ]
  )
WHERE lower(make) = 'pierce-arrow'
  AND canonical_model = 'Model 48';

-- 12. Polaris
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '650 indy', 'indy 500', 'outlaw 110', 'razor', 'scrambler', 'sportsman',
      'trail blazer', 'tx340', 'victory'
    ]
  )
WHERE lower(make) = 'polaris'
  AND canonical_model = 'RZR';

-- 13. Alpine
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['a310', 'a 110', 'a440', 'a', 'v6']
  )
WHERE lower(make) = 'alpine'
  AND canonical_model = 'A110';

-- 14. Zundapp
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '250s', 'combinette', 'db204', 'db200', 'k500', 'ks601', 'mc125', 'r203'
    ]
  )
WHERE lower(make) = 'zundapp'
  AND canonical_model = 'K800';

-- 15. Bentley
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'arange', 'brookland', 'custom', 'gt', 'serie t', 'sl saloon', 'pedal car'
    ]
  )
WHERE lower(make) = 'bentley'
  AND canonical_model = 'Continental';

-- 16. Lola
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'b07', 'beasley', 't91 50', 'race car', 't 342', 't360', 't540e',
      't 9000', 't94 00'
    ]
  )
WHERE lower(make) = 'lola'
  AND canonical_model = 'T70';

-- 17. Rolls-Royce
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'silver wriath', 'custom', 'doctor s coupe', 'six light saloon', 'station wagon'
    ]
  )
WHERE lower(make) = 'rolls-royce'
  AND canonical_model = 'Silver Cloud';

-- 18. Bugatti
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '55 junior', 'avio 8c', 'bugatti type', 'tony upson', 'replica',
      '35c', 're creation'
    ]
  )
WHERE lower(make) = 'bugatti'
  AND canonical_model = 'Chiron';

-- 19. DeLorean
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['gullwing coupe', 'dmc12', 'back to the future', 'unknown']
  )
WHERE lower(make) = 'delorean'
  AND canonical_model = 'DMC-12';

-- 20. Lexus
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['rc300', 'gs460', 'hs250h', 'concept car', 'rx450', 'sl430', 'ls500h']
  )
WHERE lower(make) = 'lexus'
  AND canonical_model = 'LS';

-- 21. Hummer
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '2 door pickup', 'alpha', 'hard top pickup', 'humvee', 'm998', 'n a',
      'two door hardtop', 'wagon'
    ]
  )
WHERE lower(make) = 'hummer'
  AND canonical_model = 'H1';

-- 22. Indian
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['motor', 'bicycle', 'bambino', 'sidecar', 'motorcycle']
  )
WHERE lower(make) = 'indian'
  AND canonical_model = 'Chief';

-- 23. Allard
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['m1', 'p2', 'palm beach']
  )
WHERE lower(make) = 'allard'
  AND canonical_model = 'J2';

-- 24. Pierce
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['dash', 'aerothrust', 'quantum tak', 'shaft drive']
  )
WHERE lower(make) = 'pierce'
  AND canonical_model = 'Four';

-- 25. Yamaha
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'concierge', 'custom motorcycle', '650 streettracker', 'short tracker',
      'twin motor'
    ]
  )
WHERE lower(make) = 'yamaha'
  AND canonical_model = 'RD350';

-- 26. Aston Martin
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['volante', 'cropmaster', 'martin', 'gravity racer']
  )
WHERE lower(make) = 'aston martin'
  AND canonical_model = 'DB7';

-- 27. Airstream
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['28 motorhome', '290', '345', 'camper', '22fb', 'victorinox']
  )
WHERE lower(make) = 'airstream'
  AND canonical_model = 'Interstate';

-- 28. Suzuki
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['340 nomad', 'a 100', 'indian custom', 'race bike', 'x']
  )
WHERE lower(make) = 'suzuki'
  AND canonical_model = 'GSX-R';

-- 29. Excelsior
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['replica', 'adex c', 'autobyk', 'big x', 'hillclimber']
  )
WHERE lower(make) = 'excelsior'
  AND canonical_model = 'Super X';

-- 30. Hyundai
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['azera', 'elantra gt', 'santa cruz', 'stellar', 'xg 350', 'xg350l']
  )
WHERE lower(make) = 'hyundai'
  AND canonical_model = 'Equus';

-- 31. Lea-Francis
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['12 40hp', 'p type', 'w type', '12hp', '14 estate', '14 hp']
  )
WHERE lower(make) = 'lea-francis'
  AND canonical_model = '2 1/2 Litre';

-- 32. McLaren
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['540c', 'm4a', 'karts', 'm4b']
  )
WHERE lower(make) = 'mclaren'
  AND canonical_model = '570S';

-- 33. Armstrong Siddeley
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['12hp', '12 6', '14hp', 'fourteen', 'twelve plus']
  )
WHERE lower(make) = 'armstrong siddeley'
  AND canonical_model = 'Star Sapphire';

-- 34. Auburn
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '6 80', '852 speedster', 'convertible sedan', 'custom', 'dick tracy',
      '6 38', 'chummy'
    ]
  )
WHERE lower(make) = 'auburn'
  AND canonical_model = '851';

-- 35. De Tomaso
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['convertible', 'custom coupe', 'gt5 s', 'station wagon']
  )
WHERE lower(make) = 'de tomaso'
  AND canonical_model = 'Pantera';

-- 36. Rudge
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['250 sports', 'jap', 'multi', 'special', 'sport special']
  )
WHERE lower(make) = 'rudge'
  AND canonical_model = 'Ulster';

-- 37. Spartan
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['2 2', 'fmc pumper', 'ii', 'custom chopper', 'travel supreme']
  )
WHERE lower(make) = 'spartan'
  AND canonical_model = 'Manor';

-- 38. Delahaye
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['type 28', 'fire engine', 'perkins', 'type 102', 'type 87']
  )
WHERE lower(make) = 'delahaye'
  AND canonical_model = '135';

-- 39. Alvis
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['drophead coupe', 'four place tourer', 'fv103', 'sa 16 95', 'te']
  )
WHERE lower(make) = 'alvis'
  AND canonical_model = 'Speed 25';

-- 40. Velocette
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['valiant', '500 scrambler', 'scrambler', 'tt scrambler']
  )
WHERE lower(make) = 'velocette'
  AND canonical_model = 'Thruxton';

-- 41. Graham
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['brothers', 'custom 2 door', 'series 97', 'series 116']
  )
WHERE lower(make) = 'graham'
  AND canonical_model = 'Hollywood';

-- 42. Radical
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['prosport', 'sr4', 'sr1']
  )
WHERE lower(make) = 'radical'
  AND canonical_model = 'SR3';

-- 43. Tatra
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['75 convertible', 't603', 't613', 'type t600', 't600']
  )
WHERE lower(make) = 'tatra'
  AND canonical_model = 'T87';

-- 44. Hodaka
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['100', '100 mx', 'ace', 'ed250']
  )
WHERE lower(make) = 'hodaka'
  AND canonical_model = 'Ace 100';

-- 45. Invicta
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['12 45hp', '4 1 2 litre']
  )
WHERE lower(make) = 'invicta'
  AND canonical_model = '4 1/2 Litre';

-- 46. Kurtis Kraft
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['4000', '500g', '500h', 'leader card', 'novi']
  )
WHERE lower(make) = 'kurtis kraft'
  AND canonical_model = '500S';

-- 47. Steyr
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['55', '280ge', 'puch maxi', 'type 45']
  )
WHERE lower(make) = 'steyr'
  AND canonical_model = 'Pinzgauer';

-- 48. Amilcar
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['c6', 'n7', 'pegase', 'sports project', 'torpedo roadster']
  )
WHERE lower(make) = 'amilcar'
  AND canonical_model = 'CGS';

-- 49. Amphicar
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['convertible']
  )
WHERE lower(make) = 'amphicar'
  AND canonical_model = '770';

-- 50. Autocar
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['27ks', 'c 50', 'model 21u']
  )
WHERE lower(make) = 'autocar'
  AND canonical_model = 'Type VIII';

-- 51. Imperial
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['2 door hardtop', '40', 'four door sedan', 'hardtop']
  )
WHERE lower(make) = 'imperial'
  AND canonical_model = 'Crown';

-- 52. Cord
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['812sc', 'beverly', 'phaeton', 'samco royale']
  )
WHERE lower(make) = 'cord'
  AND canonical_model = '810';

-- 53. Benz
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['3 1 2hp', '60hp', 'motorwagon', 'victoria']
  )
WHERE lower(make) = 'benz'
  AND canonical_model = 'Patent-Motorwagen';

-- 54. Fisker
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['gs 6', 'latigo', 'revero']
  )
WHERE lower(make) = 'fisker'
  AND canonical_model = 'Karma';

-- 55. Excalibur
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['1 roadster', '4 passenger convertible', 'iv 2 2', 'series iii']
  )
WHERE lower(make) = 'excalibur'
  AND canonical_model = 'Phaeton';

-- 56. Moke
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['007', 'cruise', 'emoke', 'lsv']
  )
WHERE lower(make) = 'moke'
  AND canonical_model = 'Electric';

-- 57. Willys-Overland & Willys
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['cj3a', 'm38a1', 'sedan delivery', 'utility wagon', 'agrijeep', '6 90']
  )
WHERE lower(make) = 'willys-overland'
  AND canonical_model = 'Jeepster';

-- 58. Panhard
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['17 bt', '17bt', '24 ct', 'x76', 'dynamic']
  )
WHERE lower(make) = 'panhard'
  AND canonical_model = 'Levassor';

-- 59. Peterbilt
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['289', '352m', '372', 'truck engine trike']
  )
WHERE lower(make) = 'peterbilt'
  AND canonical_model = '359';

-- 60. Pininfarina
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['spider', 'azzura', 'gravity racer']
  )
WHERE lower(make) = 'pininfarina'
  AND canonical_model = 'Azzurra';

-- 61. Lamborghini
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['1ctl', 'countache', 'dino 308', 'dla 35']
  )
WHERE lower(make) = 'lamborghini'
  AND canonical_model = 'Countach';

-- 62. Ram
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['d250', 'laramie', 'pro master', 'quad cab']
  )
WHERE lower(make) = 'ram'
  AND canonical_model = '1500';

-- 63. Checker
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY['a11', 'cab', 'superba']
  )
WHERE lower(make) = 'checker'
  AND canonical_model = 'Marathon';

-- 64. Alfa Romeo
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'project', '1600 gta', 'gsm dart', '164s', '166', '2000gtv', '2 3l',
      '5 speed', '750 series', '8c2300', 'alfasud', 'giardinetta', 'ar 51',
      'ar51', 'matta', 'by touring', 'cabriolet'
    ]
  )
WHERE lower(make) = 'alfa romeo'
  AND canonical_model = 'Spider';

-- 65. Audi
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'fox', '5000s', 'sedan', 'a2', 'avant', 'convertible', 'diesel', '5000cs',
      'e tron sportback', 's1e2', 'etron gt', '50ls', '5 speed'
    ]
  )
WHERE lower(make) = 'audi'
  AND canonical_model = '5000';

-- 66. Austin-Healey
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'replica', '2 2', 'project', 'mk iia', 'mkiii', 'model 18',
      'mx reproduction', 'princess limousine', 'race car', 'resto mod',
      'sebring 5000', '100bn2', 'vanden plas', '5 speed'
    ]
  )
WHERE lower(make) = 'austin-healey'
  AND canonical_model = '3000';

-- 67. BMW
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '5 speed', 'm', 'coupe', '4 speed', 'project', '328ic', 'k75rt', '330',
      'door sedan', '330e', '735 i', '735il', 'car', 'r', '30 cs', '3 0sa',
      '315', '3 15', '318 touring', '319', '320 6'
    ]
  )
WHERE lower(make) = 'bmw'
  AND canonical_model = '3 Series';

-- 68. Buick
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'coupe', 'convertible', 'apollo', 'custom roadster', 'sport wagon',
      'business', 'street rod', 'model 67', 'rumble seat coupe', 'turbo t',
      '121 coupe', 'rainier', '46c', '4 door sedan', 'blackhawk', 'black hawk',
      'cascada', 'centieme', 'custom speedster', 'cutlass', 'd 4 34'
    ]
  )
WHERE lower(make) = 'buick'
  AND canonical_model = 'Special';

-- 69. Cadillac
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'custom', 'convertible', 'topless roadster', 'sedan', 'custom coupe',
      'coupe', 'racer', 'hardtop station wagon', 'topless sedan', 'allante',
      'convertible coupe', 'convertible sedan', 'five passenger touring',
      'stretch limousine', 'custom roadster', 'custom wagon',
      'woody station wagon', 'del caballero', 'dual cowl', 'esv platinum'
    ]
  )
WHERE lower(make) = 'cadillac'
  AND canonical_model = 'DeVille';

-- 70. Chevrolet
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '4 speed', 'coupe', 'deluxe', 'sedan', 'truck', 'roadster', 'street rod',
      'business coupe', 'van', 'wagon', '5 speed', 'n a', 'cabriolet',
      '3 speed', 'flatbed', '2 door hardtop', 'sprint turbo', 'stake bed',
      'station wagon', 'laguna s3', '2 door coupe', 'convertible'
    ]
  )
WHERE lower(make) = 'chevrolet'
  AND canonical_model = 'Bel Air';

-- 71. Chrysler
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'maserati', 'convertible', 'coupe', 'sno rabbit', 'g70', '70 tourer',
      '72 tourer', '75 roadster', '8 door limousine', 'california', 'cd eight',
      'cm roadster', 'conqueror', 'crown', 'csx', 'custom', 'sport wagon',
      'e class', 'rumble seat coupe', 'model 50'
    ]
  )
WHERE lower(make) = 'chrysler'
  AND canonical_model = 'New Yorker';

-- 72. Dodge
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'touring', 'sedan', 'd1500', '2500', 'business', 'c 3 d8', 'w400',
      'shelby', 'business coupe', 'coupe', 'hot rod', 'journey', '5 window',
      'suburban wagon', 'n a', '100', 'b 100', 'b 108', 'b1500', 'b1b 108',
      'b1b', 'b 1 b', 'b 2'
    ]
  )
WHERE lower(make) = 'dodge'
  AND canonical_model = 'D-Series';

-- 73. Ferrari
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '412gt', '308gt', '365gt4', '308gt4', '308gtbi', '312 f1',
      '355 berlinetta', '400gti', '456gta', '750'
    ]
  )
WHERE lower(make) = 'ferrari'
  AND canonical_model = '308';

-- 74. Ford
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'hot rod', 'street rod', 'convertible', 'sedan', 'sedan delivery',
      '1 2 ton', 'n a', 'f', '2 door sedan', 'station wagon', 'panel truck',
      'jeep', 'flatbed truck', 'tow truck', 'convertible sedan', 'e450',
      'stake bed', 'f600', '2 door', 'business', 'model 68', 'flatbed',
      'model 76'
    ]
  )
WHERE lower(make) = 'ford'
  AND canonical_model = 'Deluxe';

-- 75. GMC
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'n a', 'fleetside', 'armored truck', 'tow truck', 'handi van', 'b4000',
      'conversion van', 'hummer', 'wrecker truck', '370', '4000', '453',
      '5000 series', '5500', '650', '9300', 'ac 101', 'a team replica',
      'c100', 'c 10', 'c6500'
    ]
  )
WHERE lower(make) = 'gmc'
  AND canonical_model = 'Pickup';

-- 76. Harley-Davidson
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'motor', 'golf cart', 'custom', 'replica', 'board track', 'bobber',
      'bobtail', 'bourget', 'bt', 'classic 95th', 'classic liberty',
      'covington', 'crs 250', 'cse', 'm50s', 'tour glide', 'y440', 'ers 350',
      'flhtk'
    ]
  )
WHERE lower(make) = 'harley-davidson'
  AND canonical_model = 'FL';

-- 77. Jaguar
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'xjsc', 'project', 'sovereign', 'xjr100', 'xjr575', 'e pace', 'mkx',
      'xkr175', '3 8s', '4 door saloon', 'convertible', 'coupe', 'double six',
      'r1', 'ft coupe', 'hwm', 'kit race car', 'mark iv'
    ]
  )
WHERE lower(make) = 'jaguar'
  AND canonical_model = 'XJ';

-- 78. Jeep
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'm38a1', 'wagoneer s', 'willys', 'm715', 'laredo', 'cj2a', 'dj 3a',
      'dj 5a', 'dj 5d', 'dj 5e', 'fc150', 'fj 3', 'fleetvan', 'gpw', 'j2000',
      'j4000', 'jeep pickup'
    ]
  )
WHERE lower(make) = 'jeep'
  AND canonical_model = 'CJ-5';

-- 79. Kawasaki
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '454 ltd', '85 j1l', 'g3ss', 'g5100', 'gt750', 'kd 100', 'kdx', 'kfx50',
      'km100', 'kubotasaki', 'kx450f', 'ltd550', 'mc1', 'tr120', 'voyager',
      'z250a', 'zg1000', 'zx 600r', 'zx750r', 'zxr750'
    ]
  )
WHERE lower(make) = 'kawasaki'
  AND canonical_model = 'KZ1000';

-- 80. Land Rover
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'ries ii', 'hunter edition', 'tdi', 'bodiesel', 'vogue se', 'ies i',
      'ii', '81 prototype', 'suv', 'one ten', 'tana', 'great divide',
      'unknown', 'convertible', 'custom', 'dormobile', 'discovery sport',
      'door', 'er', 'ery', '200tdi'
    ]
  )
WHERE lower(make) = 'land rover'
  AND canonical_model = 'Series';

-- 81. Lincoln
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'mark ii', 'mk ii', 'coupe', 'convertible coupe', '46h', '6 passenger coupe',
      '9el', 'cabriolet', 'contenental', 'convertible', 'corsair',
      'custom 2 door', 'four door', 'sport sedan', 'mkt', 'mkz', 'model 144b',
      'model 66h'
    ]
  )
WHERE lower(make) = 'lincoln'
  AND canonical_model = 'Continental';

-- 82. Lotus
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'sport coupe', '61', '61m', '6 tribute', '77 replica', '7 replica',
      'caterham', 'locost', 'climax', 'espirit', 'mark ix', 'type 51r',
      'jim clark', 'lotus', 'lx', 'm250', 'mark viii', 'mk6', 'omega',
      'r27', 's3', 'six', 'super 7'
    ]
  )
WHERE lower(make) = 'lotus'
  AND canonical_model = 'Seven';

-- 83. Maserati
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'spider', 'q39', '222 4v', '222 se', '2 24v', '250', 'bi turbo',
      'gran turismo', 'emilio zegna', 'm138', 'project', 'series i',
      'tipo 160', 'bellagio', '160 turismo'
    ]
  )
WHERE lower(make) = 'maserati'
  AND canonical_model = 'Biturbo';

-- 84. Mazda
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'mx', 'roadster', 'az 1', '6 wagon', '808', 'az offroad', 'b1600',
      'b2300', 'b2500', 'b3000', 'catfish', 'eunos presso', 'eunos',
      'formula mazda', 'gravity racer', 'luce'
    ]
  )
WHERE lower(make) = 'mazda'
  AND canonical_model = 'MX-5 Miata';

-- 85. Mercedes-Benz
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'cabriolet', 'e', 'slc300', 'sedan', 'glc 43', '240td', 'replica',
      'convertible', 'benz', '230a', '230slk', '240 d', '250d', '250t',
      '280cew', '300sl', '309d', '310 tn', '319', '320ce', '320ml'
    ]
  )
WHERE lower(make) = 'mercedes-benz'
  AND canonical_model = 'E-Class';

-- 86. Mercury
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '114x', '224', '6 passenger wagon', 'asc mclaren', 'california girls',
      'high wheel', 'ln7', 'lynx', 'm 1', 'm1', 'm 100', 'm68', 'm74',
      'milan', 'molinari', 'n a', 'street rod', 'sun valley', 'topaz'
    ]
  )
WHERE lower(make) = 'mercury'
  AND canonical_model = 'Custom';

-- 87. MG
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'convertible', '1500', '1600', 'mgf', '1600cc', 'bgt', 'c', 'devin',
      'maestro', 'metro', 'mk i', 'racecar', 'racer', 'roadster', 'sebring'
    ]
  )
WHERE lower(make) = 'mg'
  AND canonical_model = 'MGB';

-- 88. Mini
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '10', '1275gt', '1 3i', '2', '25th anniversary', '30 limited edition',
      '850', 'canvas top', 'clubman', 'clubvan', '2 door hardtop', 'estate',
      'hle', 'goodwood', 'iv', 'marcos', 'margrave', 'mark iv', 'mini'
    ]
  )
WHERE lower(make) = 'mini'
  AND canonical_model = 'Cooper';

-- 89. Nissan
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '5 speed', 'project', 'se', 'juke', 'race car', 'racer', 'cube',
      '2 door', '300z', '310', '350zx', '411', 'avenir', 'b210', 'b210gx',
      'caravan'
    ]
  )
WHERE lower(make) = 'nissan'
  AND canonical_model = 'Sentra';

-- 90. Oldsmobile
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'coupe', 'custom coupe', 'custom', 'runabout', 'special', 'dynamic',
      'sedan delivery', 'club coupe', 'aerotech', 'calais', 'ciera',
      'club sedan', 'convertible', '2 door hardtop', 'deluxe coupe', 'f31'
    ]
  )
WHERE lower(make) = 'oldsmobile'
  AND canonical_model = 'Cutlass';

-- 91. Plymouth
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'coupe', '2 door coupe', 'roadster', 'hot rod', 'street rod',
      'convertible', 'hemi coupe', 'pickup', 'sedan', 'convertible coupe',
      'clone', 'hemi', 'dirt track', 'gran fury', 'half ton pickup',
      'hardtop', 'horizon'
    ]
  )
WHERE lower(make) = 'plymouth'
  AND canonical_model = 'Deluxe';

-- 92. Pontiac
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'street rod', 'wagon', 'custom', 'roadster', 'big six', 'custom coupe',
      '4 door sedan', '5 window coupe', 'grand lemans', 'convertible', 'coupe',
      'astre', 'cabriolet', 'chieftian', 'custom pickup', 'station wagon',
      'deluxe', 'deluxe 6', 'fiero gt'
    ]
  )
WHERE lower(make) = 'pontiac'
  AND canonical_model = 'Chieftain';

-- 93. Porsche
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '217', 'spyder', '238', 'convertible', 'boxter s', 'junior 108k',
      '218', '111', 'tractor', '318', '356t6b', '429', '909', '911targa',
      '928gt', 'a111', 'a122'
    ]
  )
WHERE lower(make) = 'porsche'
  AND canonical_model = '356';

-- 94. Saab
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '5 speed', '9 3x', '900se', '92b', '9 2 x', '932', '93b', '96l',
      '99e', '99l', '99le', 'aero', 'monte carlo', 'saabo', 'sonnet iii',
      'sports racer', 'viggen', '850 monte carlo'
    ]
  )
WHERE lower(make) = 'saab'
  AND canonical_model = '900';

-- 95. Subaru
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'vivio', '2 5rs', '4wd wagon', 'b9 tribeca', 'domingo', 'e12', 'gl 10',
      'glf', 'jolly', 'libero', 'rex', 'wagon custom', 'xt6', 'xv crosstrek',
      '1600'
    ]
  )
WHERE lower(make) = 'subaru'
  AND canonical_model = 'Sambar';

-- 96. Toyota
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'dlx', 'deluxe', '4wd pickups', '4x4 pick up', '700 deluxe', 'alphard',
      'cal camper', 'cami', 'camroad', 'cargo van', 'carina', 'coaster',
      'coms', 'corolla im', 'corsa', 'custom', 'deliboy', 'dolphin', 'dually'
    ]
  )
WHERE lower(make) = 'toyota'
  AND canonical_model = 'Pickup';

-- 97. Volkswagen
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      'custom', 'wombat', 'type', 'deluxe', 'bugatti replica', 'td replica',
      'split window', 'single cab', 'type i', 'puma gt', 'gol ls', 'empi',
      'window', 'saveiro', '1600', 'buggy', '411', 'boatswagon', 'bora',
      'boss buggy', 'bradley gt', 'brasilia', 'caribe'
    ]
  )
WHERE lower(make) = 'volkswagen'
  AND canonical_model = 'Beetle';

-- 98. Volvo
UPDATE public.canonical_models
SET
  year_start = NULL,
  year_end = NULL,
  aliases = array_cat(
    coalesce(aliases, '{}'::text[]),
    ARRAY[
      '121', '244dl', 'bertone', 'c202', 'laplander', 'gravity racer',
      '244gl', '245dl', '245gl', '262c', '264gl', '3450', '480 gt', '480',
      'vnl 780', 'vnl', 'dl', 'e1800', 'xl90'
    ]
  )
WHERE lower(make) = 'volvo'
  AND canonical_model = '240 Series';
