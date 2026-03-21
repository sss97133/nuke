-- Cross-vehicle image fingerprinting infrastructure
-- Creates index on vehicle_images.dhash and a hero fingerprints table
-- for fast cross-vehicle perceptual duplicate detection.
--
-- NOTE: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
-- Apply this migration outside of a transaction, e.g.:
--   psql -f this_file.sql
-- or via supabase CLI which runs each statement separately.

-- 1. Index on dhash for fast lookups (partial: only non-null)
-- CONCURRENTLY avoids locking the table during build
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicle_images_dhash
  ON vehicle_images (dhash)
  WHERE dhash IS NOT NULL;

-- 2. Hero fingerprints table: one hash per vehicle for cross-vehicle comparison
CREATE TABLE IF NOT EXISTS vehicle_hero_fingerprints (
  vehicle_id uuid PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
  dhash text NOT NULL,
  image_id uuid REFERENCES vehicle_images(id) ON DELETE SET NULL,
  image_url text,
  computed_at timestamptz DEFAULT now()
);

-- Index on dhash for grouping/lookup during cross-vehicle comparison
CREATE INDEX IF NOT EXISTS idx_hero_fingerprints_dhash
  ON vehicle_hero_fingerprints (dhash);

-- Partial index on first 4 chars of dhash for prefix-based grouping
-- (reduces comparison space from O(n^2) to O(n * group_size))
CREATE INDEX IF NOT EXISTS idx_hero_fingerprints_dhash_prefix
  ON vehicle_hero_fingerprints (left(dhash, 4));

-- Comment for documentation
COMMENT ON TABLE vehicle_hero_fingerprints IS
  'One dHash per vehicle (from hero/primary image) for fast cross-vehicle perceptual duplicate detection. Populated by scripts/compute-hero-fingerprints.mjs';

COMMENT ON COLUMN vehicle_hero_fingerprints.dhash IS
  '16-char hex string (64-bit difference hash). Algorithm: 9x8 grayscale, compare left>right per pixel, produces 64 bits. Matches dedup-vehicle-images edge function.';
