-- Phase 3: Merge BaT active URL duplicates - exact match, indexed
-- Step 1: Create temp table of dupe URLs and their keeper IDs
CREATE TEMP TABLE bat_keepers AS
WITH ranked AS (
  SELECT id,
    COALESCE(listing_url, platform_url, bat_auction_url) as url,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(listing_url, platform_url, bat_auction_url)
      ORDER BY (
        (CASE WHEN description IS NOT NULL AND description != '' THEN 1 ELSE 0 END) +
        (CASE WHEN vin IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN sale_price IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN primary_image_url IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN bat_comments IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN bat_seller IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN mileage IS NOT NULL THEN 1 ELSE 0 END)
      ) DESC, created_at ASC
    ) as rn
  FROM vehicles
  WHERE auction_source = 'bat' AND status = 'active'
    AND COALESCE(listing_url, platform_url, bat_auction_url) IS NOT NULL
)
SELECT r.id as vehicle_id, r.url,
  (SELECT id FROM ranked r2 WHERE r2.url = r.url AND r2.rn = 1) as keeper_id
FROM ranked r
WHERE r.rn > 1;

-- Show count
SELECT COUNT(*) as rows_to_merge FROM bat_keepers;

-- Step 2: Batch update 1000 at a time
DO $$
DECLARE
  affected INT;
  total INT := 0;
BEGIN
  LOOP
    UPDATE vehicles v
    SET status = 'merged', merged_into_vehicle_id = bk.keeper_id
    FROM (SELECT vehicle_id, keeper_id FROM bat_keepers LIMIT 1000) bk
    WHERE v.id = bk.vehicle_id AND v.status = 'active';

    GET DIAGNOSTICS affected = ROW_COUNT;
    total := total + affected;

    DELETE FROM bat_keepers WHERE vehicle_id IN (
      SELECT vehicle_id FROM bat_keepers LIMIT 1000
    );

    EXIT WHEN affected = 0;
    PERFORM pg_sleep(0.1);
  END LOOP;
  RAISE NOTICE 'Total merged: %', total;
END $$;

DROP TABLE IF EXISTS bat_keepers;
