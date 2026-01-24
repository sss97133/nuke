-- Search Performance Optimization RPCs
-- Replaces client-side aggregations with server-side database functions

-- ============================================================================
-- 1. get_market_pulse_stats()
-- Returns: total_vehicles, avg_price, for_sale_count, new_today
-- Replaces: 4 parallel queries in MarketPulse.tsx
-- ============================================================================
CREATE OR REPLACE FUNCTION get_market_pulse_stats()
RETURNS TABLE (
  total_vehicles BIGINT,
  avg_price NUMERIC,
  for_sale_count BIGINT,
  new_today BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    COUNT(*)::BIGINT AS total_vehicles,
    COALESCE(AVG(current_value) FILTER (WHERE current_value IS NOT NULL AND current_value > 0), 0)::NUMERIC AS avg_price,
    COUNT(*) FILTER (WHERE is_for_sale = true)::BIGINT AS for_sale_count,
    COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::BIGINT AS new_today
  FROM vehicles
  WHERE is_public = true;
$$;

COMMENT ON FUNCTION get_market_pulse_stats() IS 'Returns aggregated market pulse statistics in a single query. Replaces 4 parallel client queries.';

-- ============================================================================
-- 2. get_squarebody_market_stats()
-- Returns: All dashboard statistics in a single query
-- Replaces: Client-side date filtering and price calculations
-- ============================================================================
CREATE OR REPLACE FUNCTION get_squarebody_market_stats()
RETURNS TABLE (
  total_discovered BIGINT,
  discovered_today BIGINT,
  discovered_this_week BIGINT,
  discovered_this_month BIGINT,
  average_price NUMERIC,
  price_min NUMERIC,
  price_max NUMERIC,
  regions_active BIGINT,
  with_images BIGINT,
  processing_rate NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH squarebodies AS (
    SELECT
      v.id,
      v.created_at,
      v.asking_price,
      v.discovery_url
    FROM vehicles v
    WHERE v.discovery_source = 'craigslist_scrape'
      AND v.make IN ('Chevrolet', 'GMC', 'Chevy')
      AND v.year BETWEEN 1973 AND 1991
  ),
  date_bounds AS (
    SELECT
      DATE_TRUNC('day', NOW()) AS today,
      DATE_TRUNC('day', NOW()) - INTERVAL '7 days' AS week_ago,
      DATE_TRUNC('day', NOW()) - INTERVAL '30 days' AS month_ago
  ),
  price_stats AS (
    SELECT
      AVG(asking_price) FILTER (WHERE asking_price > 0) AS avg_price,
      MIN(asking_price) FILTER (WHERE asking_price > 0) AS min_price,
      MAX(asking_price) FILTER (WHERE asking_price > 0) AS max_price
    FROM squarebodies
  ),
  region_count AS (
    SELECT COUNT(DISTINCT
      CASE
        WHEN discovery_url ~ 'https?://([^.]+)\.craigslist\.org'
        THEN SUBSTRING(discovery_url FROM 'https?://([^.]+)\.craigslist\.org')
        ELSE NULL
      END
    ) AS regions
    FROM squarebodies
    WHERE discovery_url IS NOT NULL
  ),
  image_count AS (
    SELECT COUNT(DISTINCT vi.vehicle_id) AS count
    FROM vehicle_images vi
    INNER JOIN squarebodies s ON s.id = vi.vehicle_id
    LIMIT 1
  )
  SELECT
    (SELECT COUNT(*) FROM squarebodies)::BIGINT AS total_discovered,
    (SELECT COUNT(*) FROM squarebodies, date_bounds WHERE created_at >= today)::BIGINT AS discovered_today,
    (SELECT COUNT(*) FROM squarebodies, date_bounds WHERE created_at >= week_ago)::BIGINT AS discovered_this_week,
    (SELECT COUNT(*) FROM squarebodies, date_bounds WHERE created_at >= month_ago)::BIGINT AS discovered_this_month,
    COALESCE(price_stats.avg_price, 0)::NUMERIC AS average_price,
    COALESCE(price_stats.min_price, 0)::NUMERIC AS price_min,
    COALESCE(price_stats.max_price, 0)::NUMERIC AS price_max,
    COALESCE(region_count.regions, 0)::BIGINT AS regions_active,
    COALESCE(image_count.count, 0)::BIGINT AS with_images,
    ((SELECT COUNT(*) FROM squarebodies, date_bounds WHERE created_at >= week_ago)::NUMERIC / 7.0)::NUMERIC AS processing_rate
  FROM price_stats, region_count, image_count;
$$;

COMMENT ON FUNCTION get_squarebody_market_stats() IS 'Returns all squarebody market dashboard statistics in a single query. Replaces client-side date filtering and aggregations.';

-- ============================================================================
-- 3. get_recent_squarebodies(limit_count)
-- Returns: Recent vehicles WITH images (no N+1 queries)
-- Replaces: 24+ sequential queries for 12 vehicles
-- ============================================================================
CREATE OR REPLACE FUNCTION get_recent_squarebodies(limit_count INTEGER DEFAULT 12)
RETURNS TABLE (
  id UUID,
  year INTEGER,
  make TEXT,
  model TEXT,
  asking_price NUMERIC,
  location TEXT,
  image_url TEXT,
  discovered_at TIMESTAMPTZ,
  listing_url TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    v.id,
    v.year,
    v.make,
    v.model,
    v.asking_price,
    CASE
      WHEN v.discovery_url ~ 'https?://([^.]+)\.craigslist\.org'
      THEN SUBSTRING(v.discovery_url FROM 'https?://([^.]+)\.craigslist\.org')
      ELSE NULL
    END AS location,
    (
      SELECT vi.image_url
      FROM vehicle_images vi
      WHERE vi.vehicle_id = v.id
      ORDER BY vi.is_primary DESC NULLS LAST, vi.created_at ASC
      LIMIT 1
    ) AS image_url,
    v.created_at AS discovered_at,
    v.discovery_url AS listing_url
  FROM vehicles v
  WHERE v.discovery_source = 'craigslist_scrape'
    AND v.make IN ('Chevrolet', 'GMC', 'Chevy')
    AND v.year BETWEEN 1973 AND 1991
  ORDER BY v.created_at DESC
  LIMIT limit_count;
$$;

COMMENT ON FUNCTION get_recent_squarebodies(INTEGER) IS 'Returns recent squarebody vehicles with their primary image in a single query. Eliminates N+1 query problem.';

-- ============================================================================
-- 4. get_squarebody_region_activity(limit_count)
-- Returns: Top regions by vehicle count
-- Replaces: Client-side URL parsing and counting
-- ============================================================================
CREATE OR REPLACE FUNCTION get_squarebody_region_activity(limit_count INTEGER DEFAULT 10)
RETURNS TABLE (
  region TEXT,
  count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH regions AS (
    SELECT
      CASE
        WHEN v.discovery_url ~ 'https?://([^.]+)\.craigslist\.org'
        THEN SUBSTRING(v.discovery_url FROM 'https?://([^.]+)\.craigslist\.org')
        ELSE 'unknown'
      END AS region
    FROM vehicles v
    WHERE v.discovery_source = 'craigslist_scrape'
      AND v.make IN ('Chevrolet', 'GMC', 'Chevy')
      AND v.year BETWEEN 1973 AND 1991
      AND v.discovery_url IS NOT NULL
  )
  SELECT
    region,
    COUNT(*)::BIGINT AS count
  FROM regions
  WHERE region != 'unknown'
  GROUP BY region
  ORDER BY count DESC
  LIMIT limit_count;
$$;

COMMENT ON FUNCTION get_squarebody_region_activity(INTEGER) IS 'Returns top Craigslist regions by squarebody vehicle count. Eliminates client-side URL parsing.';

-- ============================================================================
-- 5. get_squarebody_price_trends()
-- Returns: 7-day price trend data
-- Replaces: Client-side date bucketing and price averaging
-- ============================================================================
CREATE OR REPLACE FUNCTION get_squarebody_price_trends()
RETURNS TABLE (
  date DATE,
  count BIGINT,
  avg_price NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH date_series AS (
    SELECT generate_series(
      DATE_TRUNC('day', NOW()) - INTERVAL '6 days',
      DATE_TRUNC('day', NOW()),
      INTERVAL '1 day'
    )::DATE AS date
  ),
  daily_stats AS (
    SELECT
      DATE_TRUNC('day', v.created_at)::DATE AS date,
      COUNT(*) AS count,
      AVG(v.asking_price) FILTER (WHERE v.asking_price > 0) AS avg_price
    FROM vehicles v
    WHERE v.discovery_source = 'craigslist_scrape'
      AND v.make IN ('Chevrolet', 'GMC', 'Chevy')
      AND v.year BETWEEN 1973 AND 1991
      AND v.created_at >= DATE_TRUNC('day', NOW()) - INTERVAL '6 days'
    GROUP BY DATE_TRUNC('day', v.created_at)::DATE
  )
  SELECT
    ds.date,
    COALESCE(daily_stats.count, 0)::BIGINT AS count,
    COALESCE(daily_stats.avg_price, 0)::NUMERIC AS avg_price
  FROM date_series ds
  LEFT JOIN daily_stats ON ds.date = daily_stats.date
  ORDER BY ds.date ASC;
$$;

COMMENT ON FUNCTION get_squarebody_price_trends() IS 'Returns 7-day discovery trend with daily counts and average prices. Eliminates client-side date bucketing.';

-- ============================================================================
-- Create indexes to support these functions
-- ============================================================================

-- Index for is_public filtering (commonly used)
CREATE INDEX IF NOT EXISTS idx_vehicles_is_public ON vehicles(is_public) WHERE is_public = true;

-- Index for squarebody queries (make + year range)
CREATE INDEX IF NOT EXISTS idx_vehicles_squarebody ON vehicles(make, year)
  WHERE discovery_source = 'craigslist_scrape'
    AND make IN ('Chevrolet', 'GMC', 'Chevy')
    AND year BETWEEN 1973 AND 1991;

-- Index for recent discoveries
CREATE INDEX IF NOT EXISTS idx_vehicles_created_at ON vehicles(created_at DESC);

-- Index for vehicle images primary lookup
CREATE INDEX IF NOT EXISTS idx_vehicle_images_vehicle_primary ON vehicle_images(vehicle_id, is_primary DESC NULLS LAST, created_at ASC);

-- ============================================================================
-- Grant execute permissions
-- ============================================================================
GRANT EXECUTE ON FUNCTION get_market_pulse_stats() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_squarebody_market_stats() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_recent_squarebodies(INTEGER) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_squarebody_region_activity(INTEGER) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_squarebody_price_trends() TO authenticated, anon;
