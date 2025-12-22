-- Clear asking_price for sold vehicles
-- Sold vehicles should use sale_price, not asking_price
-- This fixes stale data that was inflating total value calculations

UPDATE vehicles
SET 
  asking_price = NULL,
  updated_at = NOW()
WHERE (sale_status = 'sold' OR auction_outcome = 'sold' OR sale_price > 0)
  AND asking_price > 0
  AND asking_price != sale_price;

-- Verify fix
SELECT 
  COUNT(*) as remaining_sold_with_asking
FROM vehicles
WHERE (sale_status = 'sold' OR auction_outcome = 'sold' OR sale_price > 0)
  AND asking_price > 0
  AND asking_price != sale_price;

