-- Search composite indexes for browse/filter queries
-- Each CREATE INDEX CONCURRENTLY is a separate statement (cannot be inside a transaction)

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_make_year
  ON vehicles (make, year DESC)
  WHERE is_public = true AND make IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_make_status
  ON vehicles (make, status)
  WHERE is_public = true AND make IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_make_source
  ON vehicles (make, source)
  WHERE is_public = true AND make IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_make_sold_price
  ON vehicles (make, sold_price DESC NULLS LAST)
  WHERE sold_price > 0 AND is_public = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_era
  ON vehicles (era)
  WHERE era IS NOT NULL AND is_public = true;
