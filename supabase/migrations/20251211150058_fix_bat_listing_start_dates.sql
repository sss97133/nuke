-- Fix BAT Listing Start Dates
-- Recalculates start_date from end_date for all BAT auctions
-- BAT auctions run for 7 days, so start_date = end_date - 7 days

-- Update all BAT listings that have an end_date but missing or incorrect start_date
UPDATE external_listings
SET 
  start_date = end_date - INTERVAL '7 days',
  updated_at = NOW()
WHERE 
  platform = 'bat'
  AND end_date IS NOT NULL
  AND (
    -- Case 1: start_date is NULL
    start_date IS NULL
    -- Case 2: start_date is suspiciously close to created_at (likely set incorrectly)
    OR (start_date - created_at) < INTERVAL '1 hour'
    -- Case 3: start_date is after end_date (invalid)
    OR start_date > end_date
    -- Case 4: start_date is not approximately 7 days before end_date (more than 1 day off)
    OR ABS(EXTRACT(EPOCH FROM (end_date - start_date)) / 86400 - 7) > 1
  );

-- Log how many records were updated
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated % BAT listing start_dates', updated_count;
END $$;

