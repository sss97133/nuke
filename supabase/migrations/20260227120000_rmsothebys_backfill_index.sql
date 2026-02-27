-- Index to support backfill-rmsothebys-descriptions and similar per-source queries.
-- Allows fast lookup of vehicles by discovery_source without a full table scan.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_discovery_source
  ON vehicles(discovery_source)
  WHERE discovery_source IS NOT NULL;

-- Composite index for the backfill query pattern:
--   WHERE discovery_source = 'rmsothebys' AND description IS NULL
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_rmsothebys_needs_desc
  ON vehicles(created_at DESC)
  WHERE discovery_source = 'rmsothebys' AND description IS NULL;
