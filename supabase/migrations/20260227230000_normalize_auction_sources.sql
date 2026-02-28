-- Normalize duplicate auction_source slugs
-- Standardize to lowercase-hyphenated slugs
-- Applied 2026-02-27

-- Barrett-Jackson: barrettjackson (25,448) + Barrett-Jackson (6,975) → barrett-jackson
UPDATE vehicles SET auction_source = 'barrett-jackson'
WHERE auction_source IN ('barrettjackson', 'Barrett-Jackson');

-- Bonhams: Bonhams (19,809) → bonhams (already has 112 as bonhams)
UPDATE vehicles SET auction_source = 'bonhams'
WHERE auction_source = 'Bonhams';

-- PCarMarket: PCarMarket (3,739) → pcarmarket (already has 2,203 as pcarmarket)
UPDATE vehicles SET auction_source = 'pcarmarket'
WHERE auction_source = 'PCarMarket';

-- Gooding: Gooding (4,653) → gooding (already has 1,726 as gooding)
UPDATE vehicles SET auction_source = 'gooding'
WHERE auction_source = 'Gooding';

-- Broad Arrow: Broad Arrow (149) → broad_arrow (already has 1,824 as broad_arrow)
UPDATE vehicles SET auction_source = 'broad_arrow'
WHERE auction_source = 'Broad Arrow';

-- Collecting Cars: Collecting Cars (5,874) → collecting_cars (already has 321 as collecting_cars)
UPDATE vehicles SET auction_source = 'collecting_cars'
WHERE auction_source = 'Collecting Cars';

-- Beverly Hills Car Club: Beverly Hills Car Club (2,008) → beverly_hills_car_club
UPDATE vehicles SET auction_source = 'beverly_hills_car_club'
WHERE auction_source = 'Beverly Hills Car Club';

-- Tag ConceptCarz records (historical auction data floating as unknown)
-- NULL or 'Unknown Source' with conceptcarz:// listing URLs
UPDATE vehicles SET auction_source = 'conceptcarz'
WHERE (auction_source IS NULL OR auction_source = 'Unknown Source')
  AND listing_url LIKE 'conceptcarz://%';

-- Tag remaining NULL-source records with identifiable URLs
UPDATE vehicles SET auction_source = 'barrett-jackson'
WHERE auction_source IS NULL
  AND listing_url LIKE '%barrett-jackson.com%';

UPDATE vehicles SET auction_source = 'mecum'
WHERE auction_source IS NULL
  AND listing_url LIKE '%mecum.com%';

UPDATE vehicles SET auction_source = 'bat'
WHERE auction_source IS NULL
  AND listing_url LIKE '%bringatrailer.com%';

UPDATE vehicles SET auction_source = 'cars_and_bids'
WHERE auction_source IS NULL
  AND listing_url LIKE '%carsandbids.com%';

-- Zero mileage cleanup (0 is not a valid mileage — means unknown/not recorded)
UPDATE vehicles SET mileage = NULL WHERE mileage = 0;
