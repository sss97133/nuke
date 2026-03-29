-- Performance: batch treemap RPC + missing indexes + missing image RPC
-- Addresses: Browse page 20 RPC calls → 1, feed-query 15s image fallback,
-- and missing indexes on organizations.business_type and vehicle_images partial.

-- 1. Batch treemap models RPC — replaces 20 individual calls from BrowseVehicles.tsx
CREATE OR REPLACE FUNCTION treemap_models_batch(p_makes text[], p_limit int DEFAULT 3)
RETURNS TABLE(
  brand_name text,
  name text,
  count bigint,
  value bigint,
  median_price bigint,
  min_price bigint,
  max_price bigint,
  sold_count bigint,
  auction_count bigint,
  avg_bids int,
  avg_watchers int
)
LANGUAGE sql STABLE
AS $$
  SELECT brand_name, name, count, value, median_price, min_price, max_price,
         sold_count, auction_count, avg_bids, avg_watchers
  FROM (
    SELECT brand_name, name, count, value, median_price, min_price, max_price,
           sold_count, auction_count, avg_bids, avg_watchers,
           ROW_NUMBER() OVER (PARTITION BY brand_name ORDER BY value DESC) AS rn
    FROM mv_treemap_models_by_brand
    WHERE brand_name = ANY(p_makes)
  ) ranked
  WHERE rn <= p_limit
  ORDER BY brand_name, value DESC;
$$;

-- 2. Missing RPC for feed-query image fallback (was undefined, causing hangs)
CREATE OR REPLACE FUNCTION get_first_images_for_vehicles(vehicle_ids uuid[])
RETURNS TABLE(
  vehicle_id uuid,
  image_url text,
  thumbnail_url text,
  medium_url text,
  variants jsonb
)
LANGUAGE sql STABLE
AS $$
  SELECT DISTINCT ON (vi.vehicle_id)
    vi.vehicle_id, vi.image_url, vi.thumbnail_url, vi.medium_url, vi.variants
  FROM vehicle_images vi
  WHERE vi.vehicle_id = ANY(vehicle_ids)
    AND vi.is_document IS NOT TRUE
    AND vi.is_duplicate IS NOT TRUE
  ORDER BY vi.vehicle_id, vi.is_primary DESC NULLS LAST, vi.photo_quality_score DESC NULLS LAST, vi.created_at DESC;
$$;

-- 3. Index: organizations.business_type (dealer lookup in feed-query scans 5K+ rows)
CREATE INDEX IF NOT EXISTS idx_organizations_business_type
  ON organizations(business_type);

-- 4. Partial index: vehicle_images primary flag (feed-query pass 1 scans 1M+ rows)
CREATE INDEX IF NOT EXISTS idx_vehicle_images_primary_lookup
  ON vehicle_images(vehicle_id)
  WHERE is_primary = true;

-- 5. Partial index: vehicle_images for orphan check (Browse page 503 errors)
CREATE INDEX IF NOT EXISTS idx_vehicle_images_orphan_check
  ON vehicle_images(vehicle_id)
  WHERE vehicle_id IS NULL;
