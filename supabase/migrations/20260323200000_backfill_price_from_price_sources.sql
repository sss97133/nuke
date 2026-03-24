-- Backfill vehicles.price from available price sources
-- Priority: canonical_sold_price → bat_sold_price → asking_price → high_bid → sold_price
-- Only updates rows where price IS NULL or price = 0
-- canonical_sold_price, bat_sold_price, asking_price are NUMERIC → cast to INT
-- high_bid and sold_price are already INTEGER

UPDATE vehicles
SET price = COALESCE(
  NULLIF(canonical_sold_price::int, 0),
  NULLIF(bat_sold_price::int, 0),
  NULLIF(asking_price::int, 0),
  NULLIF(high_bid, 0),
  NULLIF(sold_price, 0)
)
WHERE (price IS NULL OR price = 0)
  AND COALESCE(
    NULLIF(canonical_sold_price::int, 0),
    NULLIF(bat_sold_price::int, 0),
    NULLIF(asking_price::int, 0),
    NULLIF(high_bid, 0),
    NULLIF(sold_price, 0)
  ) IS NOT NULL;
