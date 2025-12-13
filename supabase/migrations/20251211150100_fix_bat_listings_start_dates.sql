-- Fix BAT Listings Start Dates (bat_listings table)
-- Recalculates auction_start_date from auction_end_date for all BAT auctions
-- BAT auctions run for 7 days, so auction_start_date = auction_end_date - 7 days

-- Update all BAT listings that have an auction_end_date but missing or incorrect auction_start_date
UPDATE bat_listings
SET 
  auction_start_date = (auction_end_date::timestamp - INTERVAL '7 days')::date,
  updated_at = NOW()
WHERE 
  auction_end_date IS NOT NULL
  AND (
    -- Case 1: auction_start_date is NULL
    auction_start_date IS NULL
    -- Case 2: auction_start_date is after auction_end_date (invalid)
    OR auction_start_date > auction_end_date
    -- Case 3: auction_start_date is not approximately 7 days before auction_end_date (more than 1 day off)
    OR ABS(EXTRACT(EPOCH FROM (auction_end_date::timestamp - auction_start_date::timestamp)) / 86400 - 7) > 1
  );

-- Log how many records were updated
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated % bat_listings auction_start_dates', updated_count;
END $$;














