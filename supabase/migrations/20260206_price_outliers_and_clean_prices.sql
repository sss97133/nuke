-- Migration: Price outlier flagging + clean vehicle prices materialized view
-- Adds outlier columns to vehicles, creates a resolved best_price view

-- 1) Add outlier columns to vehicles
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS price_is_outlier BOOLEAN DEFAULT false;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS price_outlier_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_vehicles_price_outlier ON vehicles(price_is_outlier) WHERE price_is_outlier = true;

-- 2) Materialized view: clean_vehicle_prices
-- Resolves the 8+ price fields into one best_price via COALESCE priority
-- Joins canonical_makes for normalized make names
-- Excludes outliers and unreasonable prices

DROP MATERIALIZED VIEW IF EXISTS clean_vehicle_prices;

CREATE MATERIALIZED VIEW clean_vehicle_prices AS
SELECT
  v.id AS vehicle_id,
  v.year,
  COALESCE(cm.canonical_name, v.make) AS make,
  v.model,
  v.canonical_make_id,
  -- Resolved best price: sale_price > winning_bid > high_bid > bat_sold_price > asking_price > current_value
  COALESCE(
    NULLIF(v.sale_price, 0)::numeric,
    NULLIF(v.winning_bid, 0)::numeric,
    NULLIF(v.high_bid, 0)::numeric,
    NULLIF(v.bat_sold_price, 0),
    NULLIF(v.asking_price, 0),
    NULLIF(v.current_value, 0)
  ) AS best_price,
  -- Which field the price came from
  CASE
    WHEN v.sale_price IS NOT NULL AND v.sale_price != 0 THEN 'sale_price'
    WHEN v.winning_bid IS NOT NULL AND v.winning_bid != 0 THEN 'winning_bid'
    WHEN v.high_bid IS NOT NULL AND v.high_bid != 0 THEN 'high_bid'
    WHEN v.bat_sold_price IS NOT NULL AND v.bat_sold_price != 0 THEN 'bat_sold_price'
    WHEN v.asking_price IS NOT NULL AND v.asking_price != 0 THEN 'asking_price'
    WHEN v.current_value IS NOT NULL AND v.current_value != 0 THEN 'current_value'
    ELSE NULL
  END AS price_source,
  -- Whether this was a completed sale
  CASE
    WHEN v.sale_price IS NOT NULL AND v.sale_price > 0 THEN true
    WHEN v.winning_bid IS NOT NULL AND v.winning_bid > 0 THEN true
    WHEN v.bat_sold_price IS NOT NULL AND v.bat_sold_price > 0 THEN true
    ELSE false
  END AS is_sold,
  v.created_at,
  v.updated_at
FROM vehicles v
LEFT JOIN canonical_makes cm ON v.canonical_make_id = cm.id
WHERE v.deleted_at IS NULL
  AND v.price_is_outlier IS NOT true
  AND COALESCE(
    NULLIF(v.sale_price, 0)::numeric,
    NULLIF(v.winning_bid, 0)::numeric,
    NULLIF(v.high_bid, 0)::numeric,
    NULLIF(v.bat_sold_price, 0),
    NULLIF(v.asking_price, 0),
    NULLIF(v.current_value, 0)
  ) IS NOT NULL
  AND COALESCE(
    NULLIF(v.sale_price, 0)::numeric,
    NULLIF(v.winning_bid, 0)::numeric,
    NULLIF(v.high_bid, 0)::numeric,
    NULLIF(v.bat_sold_price, 0),
    NULLIF(v.asking_price, 0),
    NULLIF(v.current_value, 0)
  ) BETWEEN 100 AND 25000000;

-- Indexes on the materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_cvp_vehicle_id ON clean_vehicle_prices(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_cvp_make ON clean_vehicle_prices(make);
CREATE INDEX IF NOT EXISTS idx_cvp_year ON clean_vehicle_prices(year);
CREATE INDEX IF NOT EXISTS idx_cvp_make_model ON clean_vehicle_prices(make, model);
CREATE INDEX IF NOT EXISTS idx_cvp_best_price ON clean_vehicle_prices(best_price);
CREATE INDEX IF NOT EXISTS idx_cvp_make_year_price ON clean_vehicle_prices(make, year, best_price);

COMMENT ON MATERIALIZED VIEW clean_vehicle_prices IS 'Resolved best_price per vehicle, excluding outliers and unreasonable values. Refresh with: REFRESH MATERIALIZED VIEW CONCURRENTLY clean_vehicle_prices';

-- Grant read access
GRANT SELECT ON clean_vehicle_prices TO authenticated, anon, service_role;
