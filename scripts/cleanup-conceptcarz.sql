-- ConceptCarz data cleanup (runs with triggers ON; use batches to avoid timeouts)
-- Run this file once for "safe" steps; run the BATCH sections repeatedly until 0 rows affected.
-- Conceptcarz rows: auction-result cross-reference (make/model/VIN → auction house, price, date).
-- discovery_url points to the conceptcarz event results page (notes->>'source_url').

SET statement_timeout = '300s';

-- ============================================================
-- STEP 2: Clean model names - strip "Chassis#:..." suffix
-- ============================================================
UPDATE vehicles v
SET model = trim(regexp_replace(v.model, '\s*Chassis#:.*$', '', 'i'))
FROM (
  SELECT id FROM vehicles
  WHERE listing_url LIKE 'conceptcarz://%' AND model ILIKE '%Chassis#%'
  LIMIT 500
) batch
WHERE v.id = batch.id;

UPDATE vehicles v
SET model = trim(regexp_replace(v.model, '\s*chassis#:.*$', '', 'i'))
FROM (
  SELECT id FROM vehicles
  WHERE listing_url LIKE 'conceptcarz://%' AND model ILIKE '%chassis#%'
  LIMIT 500
) batch
WHERE v.id = batch.id;

-- ============================================================
-- STEP 3: Delete garbage rows where make is an auction house
-- BATCH: run repeatedly until 0 rows deleted.
-- ============================================================
WITH batch AS (
  SELECT id FROM vehicles
  WHERE listing_url LIKE 'conceptcarz://%'
    AND (
      make IN ('Rm','Bonhams','Barrett-Jackson','Gooding','Mecum','Worldwide','Artcurial',
               'Barrett','Auctions','Sothebys','Dorotheum','H&H','Bonhams,','-63','Kruse',
               'Silverstone','Coys','Shannons','Brightwells','Russo','Leake',
               'Rm Sothebys','Rm Auctions','Rétromobile')
      OR make ILIKE '%auction%'
      OR make ILIKE '%sotheby%'
    )
  LIMIT 500
)
DELETE FROM vehicles WHERE id IN (SELECT id FROM batch);

-- ============================================================
-- STEP 4: Move source_url from notes JSON into discovery_url
-- BATCH: run repeatedly until 0 rows updated.
-- ============================================================
UPDATE vehicles v
SET discovery_url = v.notes::jsonb->>'source_url',
    discovery_source = 'conceptcarz'
FROM (
  SELECT id FROM vehicles
  WHERE listing_url LIKE 'conceptcarz://%'
    AND (discovery_url IS NULL OR discovery_url = '')
    AND notes IS NOT NULL
    AND notes::jsonb->>'source_url' IS NOT NULL
  LIMIT 500
) batch
WHERE v.id = batch.id;

-- ============================================================
-- STEP 5: Fix make names
-- ============================================================
UPDATE vehicles SET make = 'Aston Martin'
WHERE listing_url LIKE 'conceptcarz://%' AND make = 'Aston-Martin';

UPDATE vehicles SET make = 'DeSoto'
WHERE listing_url LIKE 'conceptcarz://%' AND make = 'Desoto';

UPDATE vehicles SET make = 'Aston Martin',
  model = trim(regexp_replace(model, '^Martin\s*', ''))
WHERE listing_url LIKE 'conceptcarz://%' AND make = 'Aston' AND model ILIKE 'Martin%';

UPDATE vehicles SET make = 'Alfa Romeo',
  model = trim(regexp_replace(model, '^Romeo\s*', ''))
WHERE listing_url LIKE 'conceptcarz://%' AND make = 'Alfa' AND model ILIKE 'Romeo%';

-- ============================================================
-- STEP 1a: Extract 17-char VINs into vin column
-- BATCH: run repeatedly until 0 rows updated.
-- ============================================================
WITH chassis_extracted AS (
  SELECT id,
    trim(regexp_replace(
      regexp_replace(listing_url, '.*Chassis#:?\s*', ''),
      '\s*$', '')
    ) as chassis_num
  FROM vehicles
  WHERE listing_url LIKE 'conceptcarz://%'
    AND listing_url ILIKE '%chassis#%'
    AND (vin IS NULL OR vin = '')
  LIMIT 500
),
ranked AS (
  SELECT id, chassis_num,
    row_number() OVER (PARTITION BY chassis_num ORDER BY id) as rn
  FROM chassis_extracted
  WHERE length(chassis_num) = 17
),
non_dup AS (
  SELECT r.id, r.chassis_num
  FROM ranked r
  WHERE r.rn = 1
    AND NOT EXISTS (SELECT 1 FROM vehicles v2 WHERE v2.vin = r.chassis_num AND v2.id != r.id)
)
UPDATE vehicles v SET vin = nd.chassis_num FROM non_dup nd WHERE v.id = nd.id;

-- ============================================================
-- STEP 1b: Extract shorter chassis numbers (4-16 chars)
-- BATCH: run repeatedly until 0 rows updated.
-- ============================================================
WITH chassis_extracted AS (
  SELECT id,
    trim(regexp_replace(
      regexp_replace(listing_url, '.*Chassis#:?\s*', ''),
      '\s*$', '')
    ) as chassis_num
  FROM vehicles
  WHERE listing_url LIKE 'conceptcarz://%'
    AND listing_url ILIKE '%chassis#%'
    AND (vin IS NULL OR vin = '')
  LIMIT 500
),
ranked AS (
  SELECT id, chassis_num,
    row_number() OVER (PARTITION BY chassis_num ORDER BY id) as rn
  FROM chassis_extracted
  WHERE length(chassis_num) BETWEEN 4 AND 16
),
non_dup AS (
  SELECT r.id, r.chassis_num
  FROM ranked r
  WHERE r.rn = 1
    AND NOT EXISTS (SELECT 1 FROM vehicles v2 WHERE v2.vin = r.chassis_num AND v2.id != r.id)
)
UPDATE vehicles v SET vin = nd.chassis_num FROM non_dup nd WHERE v.id = nd.id;

-- ============================================================
-- STEP 6: Deduplicate (keep best record per year/make/model/price)
-- BATCH: run repeatedly until 0 rows deleted.
-- ============================================================
WITH dupes AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY year, lower(make), lower(model), sale_price
      ORDER BY
        (CASE WHEN vin IS NOT NULL AND vin != '' THEN 1 ELSE 0 END) DESC,
        (CASE WHEN discovery_url IS NOT NULL THEN 1 ELSE 0 END) DESC,
        created_at ASC
    ) as rn
  FROM vehicles
  WHERE listing_url LIKE 'conceptcarz://%'
    AND sale_price IS NOT NULL
),
to_delete AS (
  SELECT id FROM dupes WHERE rn > 1
  LIMIT 500
)
DELETE FROM vehicles WHERE id IN (SELECT id FROM to_delete);

-- Final stats (run after all batches complete)
SELECT
  count(*) as remaining_total,
  count(*) FILTER (WHERE vin IS NOT NULL AND vin != '') as has_vin,
  count(*) FILTER (WHERE length(vin) = 17) as has_full_vin,
  count(*) FILTER (WHERE discovery_url IS NOT NULL) as has_discovery_url,
  count(*) FILTER (WHERE sale_price IS NOT NULL AND sale_price >= 500) as has_real_price,
  count(DISTINCT make) as distinct_makes
FROM vehicles
WHERE listing_url LIKE 'conceptcarz://%';

RESET statement_timeout;
