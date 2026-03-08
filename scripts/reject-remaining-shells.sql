-- Phase 4b: Reject empty shells across all sources
-- Criteria: active status, no description, no image, no price, no VIN, no mileage
-- These are truly useless records with no data to salvage

-- Count before by source
SELECT COALESCE(auction_source, source, 'NULL') as src, COUNT(*) as empty_active_shells
FROM vehicles
WHERE status = 'active'
  AND (description IS NULL OR description = '')
  AND primary_image_url IS NULL AND image_url IS NULL
  AND sale_price IS NULL AND asking_price IS NULL AND price IS NULL
  AND vin IS NULL
  AND mileage IS NULL
GROUP BY COALESCE(auction_source, source, 'NULL')
HAVING COUNT(*) > 10
ORDER BY COUNT(*) DESC;

-- Batch reject: all sources, 1000 at a time
DO $$
DECLARE affected INT; total INT := 0;
BEGIN
  LOOP
    UPDATE vehicles SET status = 'rejected'
    WHERE id IN (
      SELECT id FROM vehicles
      WHERE status = 'active'
        AND (description IS NULL OR description = '')
        AND primary_image_url IS NULL AND image_url IS NULL
        AND sale_price IS NULL AND asking_price IS NULL AND price IS NULL
        AND vin IS NULL
        AND mileage IS NULL
        -- Only reject if we also have no year/make/model (truly empty)
        AND (year IS NULL OR make IS NULL OR model IS NULL)
      LIMIT 1000
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    total := total + affected;
    EXIT WHEN affected = 0;
    PERFORM pg_sleep(0.1);
  END LOOP;
  RAISE NOTICE 'Total empty shells rejected: %', total;
END $$;
