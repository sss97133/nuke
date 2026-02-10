-- Add partial index for api-v1-vehicles list endpoint
-- Without this, ORDER BY created_at DESC with WHERE is_public = true
-- scans 792K+ rows (1.67s) instead of using index (0.37s)

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_public_created_at
  ON vehicles(created_at DESC) WHERE is_public = true;
