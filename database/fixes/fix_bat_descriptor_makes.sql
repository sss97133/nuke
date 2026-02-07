-- Fix BaT records where descriptor (e.g. "13k-Mile") was parsed as make
-- and the real make is embedded in the model field ("2015 BMW M4 Convertible")
SET statement_timeout = '120s';
SET session_replication_role = replica;

-- Step 1: Fix records where model starts with "YEAR MAKE MODEL"
-- Extract real make (first word after year) and real model (rest)
WITH bad_makes AS (
  SELECT id, make as old_make, model as old_model,
    -- Extract everything after the year
    SUBSTRING(model FROM '^\d{4}\s+(.+)$') as after_year,
    -- First word after year = real make
    split_part(SUBSTRING(model FROM '^\d{4}\s+(.+)$'), ' ', 1) as real_make
  FROM vehicles
  WHERE discovery_url LIKE '%bringatrailer.com%'
    AND status = 'active' AND listing_kind = 'vehicle'
    AND (make ~ '^\d+k' OR make ~ '^\d+-' OR make LIKE '%Mile%' OR make LIKE '%Owner%'
      OR make LIKE '%Year%' OR make LIKE '%Powered%' OR make LIKE '%Speed%'
      OR make LIKE '%Matching%' OR make ~ '^\d+$')
    AND model ~ '^\d{4}\s+[A-Z]'
)
UPDATE vehicles v SET 
  make = bm.real_make,
  model = TRIM(SUBSTRING(bm.after_year FROM POSITION(' ' IN bm.after_year) + 1))
FROM bad_makes bm
WHERE v.id = bm.id AND bm.real_make IS NOT NULL AND LENGTH(bm.real_make) > 1;

-- Step 2: Fix records where make is a number (bid count leaked as make)
-- e.g. make="255", model="Flathead-Powered 1939 Ford Deluxe Coupe 5-Speed"
-- These need the descriptor stripped and make/model re-parsed
WITH numeric_makes AS (
  SELECT id, model,
    -- Try to find "YEAR MAKE" pattern in model after stripping descriptor
    SUBSTRING(model FROM '\d{4}\s+([A-Z][a-z]+)') as probable_make
  FROM vehicles
  WHERE discovery_url LIKE '%bringatrailer.com%'
    AND status = 'active' AND listing_kind = 'vehicle'
    AND make ~ '^\d+$' AND LENGTH(make) <= 4
    AND model ~ '\d{4}\s+[A-Z]'
)
UPDATE vehicles v SET
  make = nm.probable_make,
  model = TRIM(SUBSTRING(nm.model FROM POSITION(nm.probable_make IN nm.model) + LENGTH(nm.probable_make) + 1))
FROM numeric_makes nm
WHERE v.id = nm.id AND nm.probable_make IS NOT NULL AND LENGTH(nm.probable_make) > 2;

SET session_replication_role = DEFAULT;
