-- ============================================================
-- FIX: Mark low-price "sold" vehicles as "bid_not_met"
--
-- Problem: Vehicles from SBX and other auctions where reserve
-- was not met are incorrectly marked as auction_outcome='sold'
-- with their final bid amount (often $1-$100) stored as sale_price.
-- This corrupts portfolio value calculations.
--
-- Solution: Any vehicle marked "sold" with a price under $500
-- is almost certainly a "reserve not met" situation, not a real sale.
-- ============================================================

-- Step 1: Create backup of affected records
CREATE TABLE IF NOT EXISTS _audit_false_sales_backup AS
SELECT
  id,
  year,
  make,
  model,
  high_bid,
  sale_price,
  winning_bid,
  auction_outcome,
  discovery_source,
  NOW() as backed_up_at
FROM vehicles
WHERE auction_outcome = 'sold'
  AND (
    (high_bid IS NOT NULL AND high_bid < 500)
    OR (sale_price IS NOT NULL AND sale_price < 500)
    OR (winning_bid IS NOT NULL AND winning_bid < 500)
  );

-- Step 2: Fix auction_outcome for clearly false sales
UPDATE vehicles
SET
  auction_outcome = 'bid_not_met',
  -- Keep the high_bid as-is (it's useful data)
  -- But clear sale_price since it wasn't actually sold
  sale_price = NULL,
  winning_bid = NULL,
  updated_at = NOW()
WHERE auction_outcome = 'sold'
  AND (
    (high_bid IS NOT NULL AND high_bid < 500)
    OR (sale_price IS NOT NULL AND sale_price < 500)
    OR (winning_bid IS NOT NULL AND winning_bid < 500)
  );

-- Step 3: Also fix vehicles with suspiciously low prices (< $1000)
-- where discovery_source is NULL (likely SBX imports)
UPDATE vehicles
SET
  auction_outcome = 'bid_not_met',
  sale_price = NULL,
  winning_bid = NULL,
  updated_at = NOW()
WHERE auction_outcome = 'sold'
  AND discovery_source IS NULL
  AND (
    (high_bid IS NOT NULL AND high_bid < 1000)
    OR (sale_price IS NOT NULL AND sale_price < 1000)
    OR (winning_bid IS NOT NULL AND winning_bid < 1000)
  );

-- Step 4: Report what was fixed
SELECT
  'Fixed false sales' as action,
  COUNT(*) as vehicles_fixed
FROM _audit_false_sales_backup;
