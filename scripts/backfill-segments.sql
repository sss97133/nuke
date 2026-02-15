SET statement_timeout = '0';

-- Vintage & Pre-War (before 1946)
UPDATE vehicles SET segment_slug = 'vintage-prewar'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND year IS NOT NULL AND year < 1946;

-- Sports Cars: Porsche 911/Carrera/GT variants
UPDATE vehicles SET segment_slug = 'sports-cars'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) = 'porsche' AND model ~* '911|carrera|gt3|gt2|speedster|targa';

-- Sports Cars: Corvette
UPDATE vehicles SET segment_slug = 'sports-cars'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) = 'chevrolet' AND LOWER(model) LIKE '%corvette%';

-- Sports Cars: Other sports car makes
UPDATE vehicles SET segment_slug = 'sports-cars'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) IN ('lotus', 'alpine', 'tvr', 'caterham', 'morgan', 'ariel');

-- Sports Cars: Aston Martin Vantage/DB
UPDATE vehicles SET segment_slug = 'sports-cars'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) IN ('aston martin', 'aston') AND model ~* 'vantage|db[0-9]|dbs';

-- Sports Cars: Mazda Miata/MX-5
UPDATE vehicles SET segment_slug = 'sports-cars'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) = 'mazda' AND model ~* 'miata|mx-5|mx5';

-- Sports Cars: Nissan Z
UPDATE vehicles SET segment_slug = 'sports-cars'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) = 'nissan' AND model ~* '370z|350z|300zx';

-- Sports Cars: BMW Z cars
UPDATE vehicles SET segment_slug = 'sports-cars'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) = 'bmw' AND model ~* 'z[0-9]|z3|z4|z8';

-- Muscle Cars: Mustang/Shelby
UPDATE vehicles SET segment_slug = 'muscle-cars'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) IN ('ford', 'mercury') AND model ~* 'mustang|shelby|boss|mach';

-- Muscle Cars: Camaro/Chevelle/Nova
UPDATE vehicles SET segment_slug = 'muscle-cars'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) = 'chevrolet' AND model ~* 'camaro|chevelle|nova|impala ss|el camino';

-- Muscle Cars: Dodge Challenger/Charger
UPDATE vehicles SET segment_slug = 'muscle-cars'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) = 'dodge' AND model ~* 'challenger|charger|dart|super bee|demon';

-- Muscle Cars: Plymouth
UPDATE vehicles SET segment_slug = 'muscle-cars'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) = 'plymouth' AND model ~* 'barracuda|cuda|road runner|gtx|duster';

-- Muscle Cars: Pontiac GTO/Firebird
UPDATE vehicles SET segment_slug = 'muscle-cars'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) = 'pontiac' AND model ~* 'gto|firebird|trans am|judge';

-- Muscle Cars: Buick/Olds/AMC
UPDATE vehicles SET segment_slug = 'muscle-cars'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND (
    (LOWER(make) = 'buick' AND model ~* 'gs|gsx|skylark|riviera')
    OR (LOWER(make) = 'oldsmobile' AND model ~* '442|cutlass|w-30|hurst')
    OR (LOWER(make) = 'amc' AND model ~* 'javelin|amx|machine')
  );

-- Luxury & GT: Entire makes
UPDATE vehicles SET segment_slug = 'luxury-gt'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) IN ('bentley', 'rolls-royce', 'rolls royce', 'maybach', 'maserati');

-- Luxury & GT: Mercedes SL/S-Class
UPDATE vehicles SET segment_slug = 'luxury-gt'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) IN ('mercedes-benz', 'mercedes') AND model ~* 'sl|s-class|s class|amg gt|300sl|gullwing';

-- Luxury & GT: Aston Martin DB/Rapide/Lagonda
UPDATE vehicles SET segment_slug = 'luxury-gt'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) IN ('aston martin', 'aston') AND model ~* 'db[0-9]|rapide|lagonda';

-- Luxury & GT: Cadillac/Lincoln/Jaguar luxury
UPDATE vehicles SET segment_slug = 'luxury-gt'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND (
    (LOWER(make) = 'cadillac' AND model ~* 'eldorado|deville|fleetwood')
    OR (LOWER(make) = 'lincoln' AND model ~* 'continental|mark')
    OR (LOWER(make) = 'jaguar' AND model ~* 'xj|xk|xjs')
  );

-- Off-Road & Trucks: Entire makes
UPDATE vehicles SET segment_slug = 'off-road-trucks'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) IN ('land rover', 'landrover', 'jeep', 'hummer', 'am general', 'international', 'scout', 'international harvester');

-- Off-Road: Toyota trucks
UPDATE vehicles SET segment_slug = 'off-road-trucks'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) = 'toyota' AND model ~* 'land cruiser|fj|4runner|hilux|tacoma|tundra';

-- Off-Road: Ford trucks
UPDATE vehicles SET segment_slug = 'off-road-trucks'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) = 'ford' AND model ~* 'bronco|f-?1[05]0|f-?250|ranger|raptor';

-- Off-Road: Chevy trucks
UPDATE vehicles SET segment_slug = 'off-road-trucks'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) = 'chevrolet' AND model ~* 'blazer|k[0-9]|c[0-9]|suburban|silverado|colorado';

-- Off-Road: GMC/Dodge trucks
UPDATE vehicles SET segment_slug = 'off-road-trucks'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND (
    (LOWER(make) = 'gmc' AND model ~* 'jimmy|sierra|yukon')
    OR (LOWER(make) = 'dodge' AND model ~* 'power wagon|ram|dakota')
    OR (LOWER(make) = 'nissan' AND model ~* 'patrol|frontier')
  );

-- Japanese Classics: Datsun (all)
UPDATE vehicles SET segment_slug = 'japanese-classics'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) = 'datsun';

-- Japanese Classics: Toyota sports
UPDATE vehicles SET segment_slug = 'japanese-classics'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) = 'toyota' AND model ~* 'supra|2000gt|ae86|celica|mr2|corolla';

-- Japanese Classics: Honda sports
UPDATE vehicles SET segment_slug = 'japanese-classics'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) = 'honda' AND model ~* 'nsx|s2000|s600|s800|civic|crx|integra';

-- Japanese Classics: Mazda rotary
UPDATE vehicles SET segment_slug = 'japanese-classics'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) = 'mazda' AND model ~* 'rx-?7|rx-?3|cosmo|rx-?8|rotary';

-- Japanese Classics: Nissan/Subaru/Mitsubishi
UPDATE vehicles SET segment_slug = 'japanese-classics'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND (
    (LOWER(make) = 'nissan' AND model ~* 'skyline|gt-r|gtr|silvia|240z|260z|280z|fairlady|240sx')
    OR (LOWER(make) = 'subaru' AND model ~* 'wrx|sti|impreza|brz')
    OR (LOWER(make) = 'mitsubishi' AND model ~* 'evo|lancer|eclipse|3000gt')
  );

-- German Engineering: Porsche non-911
UPDATE vehicles SET segment_slug = 'german-engineering'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) = 'porsche' AND model !~* '911|carrera|gt3|gt2|speedster|targa';

-- German Engineering: BMW non-Z
UPDATE vehicles SET segment_slug = 'german-engineering'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) = 'bmw' AND model !~* 'z[0-9]|z3|z4|z8';

-- German Engineering: Mercedes non-luxury
UPDATE vehicles SET segment_slug = 'german-engineering'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) IN ('mercedes-benz', 'mercedes') AND model !~* 'sl|s-class|s class|amg gt|300sl|gullwing';

-- German Engineering: Audi/VW/Opel
UPDATE vehicles SET segment_slug = 'german-engineering'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) IN ('audi', 'volkswagen', 'vw', 'opel');

-- British Classics
UPDATE vehicles SET segment_slug = 'british-classics'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND (
    LOWER(make) IN ('triumph', 'austin-healey', 'austin healey', 'mg', 'sunbeam', 'riley', 'wolseley', 'mini')
    OR (LOWER(make) = 'jaguar' AND model ~* 'e-type|xk[0-9]|mk|d-type|c-type')
  );

-- American Classics
UPDATE vehicles SET segment_slug = 'american-classics'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) IN ('studebaker', 'hudson', 'nash', 'packard', 'desoto', 'edsel', 'kaiser', 'willys', 'crosley', 'tucker', 'cord', 'auburn', 'duesenberg', 'pierce-arrow', 'stutz');

-- Convertibles & Roadsters (from model name)
UPDATE vehicles SET segment_slug = 'convertibles'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND model ~* 'convertible|roadster|cabriolet|spider|spyder|drophead|volante';

-- Wagons & Vans
UPDATE vehicles SET segment_slug = 'wagons-vans'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND (
    model ~* 'wagon|estate|avant|touring|van|bus|kombi|microbus|westfalia|sportsmobile'
    OR (LOWER(make) = 'volkswagen' AND model ~* 'bus|van|type 2|transporter')
  );

-- Microcars & Oddities
UPDATE vehicles SET segment_slug = 'microcars-oddities'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND LOWER(make) IN ('isetta', 'messerschmitt', 'goggomobil', 'peel', 'reliant', 'citroen', 'fiat', 'vespa', 'cushman', 'amphicar', 'delorean');

-- Modern Performance (year >= 2000)
UPDATE vehicles SET segment_slug = 'modern-performance'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND year >= 2000
  AND (
    (LOWER(make) = 'dodge' AND model ~* 'viper|hellcat|demon|srt')
    OR (LOWER(make) = 'ford' AND model ~* 'gt$|gt40|focus rs|fiesta st')
    OR (LOWER(make) = 'nissan' AND model ~* 'gt-r|gtr|nismo')
    OR LOWER(make) IN ('tesla', 'rivian', 'lucid')
  );

-- Racing Heritage (from model name)
UPDATE vehicles SET segment_slug = 'racing-heritage'
WHERE segment_slug IS NULL AND deleted_at IS NULL
  AND (sale_price > 0 OR sold_price > 0)
  AND model ~* 'race|rally|competition|group [a-c]|homologation|gt[0-9]|cup|trophy|spec|track';

-- Summary
SELECT segment_slug, COUNT(*) as cnt
FROM vehicles
WHERE segment_slug IS NOT NULL AND deleted_at IS NULL AND (sale_price > 0 OR sold_price > 0)
GROUP BY segment_slug
ORDER BY cnt DESC;

SELECT
  COUNT(*) FILTER (WHERE segment_slug IS NOT NULL) as categorized,
  COUNT(*) as total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE segment_slug IS NOT NULL) / COUNT(*), 1) as coverage_pct
FROM vehicles
WHERE deleted_at IS NULL AND (sale_price > 0 OR sold_price > 0);
