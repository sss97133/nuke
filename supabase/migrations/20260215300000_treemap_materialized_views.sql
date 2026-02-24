-- Materialized views for treemap aggregations
-- Replaces live full-table scans (8-20s each) with instant reads from pre-computed data
-- Refresh via: SELECT treemap_refresh_all();

-- 1. Source aggregation materialized view
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_treemap_by_source AS
  WITH source_agg AS (
    SELECT
      CASE
        WHEN LOWER(auction_source) IN ('bat', 'bringatrailer', 'bring a trailer') THEN 'Bring a Trailer'
        WHEN LOWER(auction_source) IN ('gooding', 'gooding & co') THEN 'Gooding & Co'
        WHEN LOWER(auction_source) IN ('rm sothebys', 'rm sotheby''s') THEN 'RM Sotheby''s'
        WHEN LOWER(auction_source) IN ('cars & bids', 'cars-and-bids') THEN 'Cars & Bids'
        WHEN LOWER(auction_source) = 'mecum' THEN 'Mecum'
        WHEN LOWER(auction_source) = 'bonhams' THEN 'Bonhams'
        WHEN LOWER(auction_source) = 'broad arrow' THEN 'Broad Arrow'
        WHEN LOWER(auction_source) IN ('collecting_cars', 'collecting cars') THEN 'Collecting Cars'
        WHEN LOWER(auction_source) = 'sbx cars' THEN 'SBX Cars'
        WHEN LOWER(auction_source) = 'pcarmarket' THEN 'PCarMarket'
        WHEN LOWER(auction_source) = 'classic.com' THEN 'Classic.com'
        ELSE NULL
      END as src,
      COALESCE(sale_price, sold_price) as price
    FROM vehicles
    WHERE deleted_at IS NULL
      AND (sale_price > 0 OR sold_price > 0)
      AND COALESCE(sale_price, sold_price) < 100000000
      AND make IS NOT NULL
      AND LENGTH(make) > 2
      AND make !~* '^[0-9]'
      AND make !~* 'mile|owner|reserve|unknown|other|n/a|none|tbd'
  )
  SELECT src as name, COUNT(*)::bigint as count, SUM(price)::bigint as value
  FROM source_agg
  WHERE src IS NOT NULL
  GROUP BY src
  HAVING SUM(price) >= 1000000
  ORDER BY value DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_treemap_source_name ON mv_treemap_by_source(name);

-- 2. Brand aggregation materialized view
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_treemap_by_brand AS
  WITH make_agg AS (
    SELECT
      CASE
        WHEN LOWER(make) = 'bmw' THEN 'BMW'
        WHEN LOWER(make) = 'gmc' THEN 'GMC'
        WHEN LOWER(make) = 'mg' THEN 'MG'
        WHEN LOWER(make) = 'tvr' THEN 'TVR'
        WHEN LOWER(make) IN ('alfa romeo', 'alfa') THEN 'Alfa Romeo'
        WHEN LOWER(make) IN ('aston martin', 'aston') THEN 'Aston Martin'
        WHEN LOWER(make) IN ('mercedes-benz', 'mercedes') THEN 'Mercedes-Benz'
        WHEN LOWER(make) IN ('rolls-royce', 'rolls royce') THEN 'Rolls-Royce'
        WHEN LOWER(make) IN ('land rover', 'land', 'landrover') THEN 'Land Rover'
        WHEN LOWER(make) IN ('mclaren', 'mc laren') THEN 'McLaren'
        WHEN LOWER(make) IN ('de tomaso', 'detomaso') THEN 'De Tomaso'
        WHEN LOWER(make) = 'am general' THEN 'AM General'
        ELSE INITCAP(make)
      END as normalized_make,
      COALESCE(sale_price, sold_price) as price
    FROM vehicles
    WHERE deleted_at IS NULL
      AND (sale_price > 0 OR sold_price > 0)
      AND COALESCE(sale_price, sold_price) < 100000000
      AND make IS NOT NULL
      AND LENGTH(make) > 2
      AND make !~* '^[0-9]'
      AND make !~* 'mile|owner|reserve|unknown|other|n/a|none|tbd'
  )
  SELECT normalized_make as name, COUNT(*)::bigint as count, SUM(price)::bigint as value
  FROM make_agg
  GROUP BY normalized_make
  HAVING SUM(price) >= 1000000
  ORDER BY value DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_treemap_brand_name ON mv_treemap_by_brand(name);

-- 3. Segment aggregation materialized view
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_treemap_by_segment AS
  SELECT
    vs.display_name as name,
    COUNT(*)::bigint as count,
    SUM(COALESCE(v.sale_price, v.sold_price))::bigint as value
  FROM vehicles v
  JOIN vehicle_segments vs ON v.segment_slug = vs.slug
  WHERE v.deleted_at IS NULL
    AND (v.sale_price > 0 OR v.sold_price > 0)
    AND COALESCE(v.sale_price, v.sold_price) < 100000000
    AND v.make IS NOT NULL
    AND LENGTH(v.make) > 2
  GROUP BY vs.display_name
  ORDER BY value DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_treemap_segment_name ON mv_treemap_by_segment(name);

-- 4. Nested segment view (segments + makes) materialized as JSON
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_treemap_nested_segment AS
  WITH make_data AS (
    SELECT
      v.segment_slug,
      CASE
        WHEN LOWER(v.make) = 'bmw' THEN 'BMW'
        WHEN LOWER(v.make) = 'gmc' THEN 'GMC'
        WHEN LOWER(v.make) = 'mg' THEN 'MG'
        WHEN LOWER(v.make) = 'tvr' THEN 'TVR'
        WHEN LOWER(v.make) IN ('alfa romeo', 'alfa') THEN 'Alfa Romeo'
        WHEN LOWER(v.make) IN ('aston martin', 'aston') THEN 'Aston Martin'
        WHEN LOWER(v.make) IN ('mercedes-benz', 'mercedes') THEN 'Mercedes-Benz'
        WHEN LOWER(v.make) IN ('rolls-royce', 'rolls royce') THEN 'Rolls-Royce'
        WHEN LOWER(v.make) IN ('land rover', 'land', 'landrover') THEN 'Land Rover'
        WHEN LOWER(v.make) IN ('mclaren', 'mc laren') THEN 'McLaren'
        WHEN LOWER(v.make) IN ('de tomaso', 'detomaso') THEN 'De Tomaso'
        WHEN LOWER(v.make) = 'am general' THEN 'AM General'
        ELSE INITCAP(v.make)
      END as normalized_make,
      COALESCE(v.sale_price, v.sold_price) as price
    FROM vehicles v
    WHERE v.deleted_at IS NULL
      AND (v.sale_price > 0 OR v.sold_price > 0)
      AND COALESCE(v.sale_price, v.sold_price) < 100000000
      AND v.make IS NOT NULL
      AND LENGTH(v.make) > 2
      AND v.segment_slug IS NOT NULL
  ),
  segment_data AS (
    SELECT
      vs.display_name as seg_name,
      vs.slug as seg_slug,
      SUM(md.price)::bigint as seg_value,
      COUNT(*)::bigint as seg_count
    FROM make_data md
    JOIN vehicle_segments vs ON md.segment_slug = vs.slug
    GROUP BY vs.display_name, vs.slug
    HAVING SUM(md.price) > 0
  ),
  make_agg AS (
    SELECT
      segment_slug,
      normalized_make,
      COUNT(*)::bigint as make_count,
      SUM(price)::bigint as make_value
    FROM make_data
    GROUP BY segment_slug, normalized_make
  )
  SELECT 1 as id, jsonb_build_object(
    'name', 'All Segments',
    'children', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'name', sd.seg_name,
          'value', sd.seg_value,
          'count', sd.seg_count,
          'children', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'name', ma.normalized_make,
                'value', ma.make_value,
                'count', ma.make_count
              ) ORDER BY ma.make_value DESC
            )
            FROM make_agg ma
            WHERE ma.segment_slug = sd.seg_slug
          ), '[]'::jsonb)
        ) ORDER BY sd.seg_value DESC
      )
      FROM segment_data sd
    ), '[]'::jsonb)
  ) as data;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_treemap_nested_segment_id ON mv_treemap_nested_segment(id);

-- 5. Nested brand view (brands + models) materialized as JSON
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_treemap_nested_brand AS
  WITH brand_data AS (
    SELECT
      CASE
        WHEN LOWER(make) = 'bmw' THEN 'BMW'
        WHEN LOWER(make) = 'gmc' THEN 'GMC'
        WHEN LOWER(make) = 'mg' THEN 'MG'
        WHEN LOWER(make) = 'tvr' THEN 'TVR'
        WHEN LOWER(make) IN ('alfa romeo', 'alfa') THEN 'Alfa Romeo'
        WHEN LOWER(make) IN ('aston martin', 'aston') THEN 'Aston Martin'
        WHEN LOWER(make) IN ('mercedes-benz', 'mercedes') THEN 'Mercedes-Benz'
        WHEN LOWER(make) IN ('rolls-royce', 'rolls royce') THEN 'Rolls-Royce'
        WHEN LOWER(make) IN ('land rover', 'land', 'landrover') THEN 'Land Rover'
        WHEN LOWER(make) IN ('mclaren', 'mc laren') THEN 'McLaren'
        WHEN LOWER(make) IN ('de tomaso', 'detomaso') THEN 'De Tomaso'
        WHEN LOWER(make) = 'am general' THEN 'AM General'
        ELSE INITCAP(make)
      END as normalized_make,
      model,
      COALESCE(sale_price, sold_price) as price
    FROM vehicles
    WHERE deleted_at IS NULL
      AND (sale_price > 0 OR sold_price > 0)
      AND COALESCE(sale_price, sold_price) < 100000000
      AND make IS NOT NULL
      AND LENGTH(make) > 2
      AND make !~* '^[0-9]'
      AND make !~* 'mile|owner|reserve|unknown|other|n/a|none|tbd'
  ),
  brand_agg AS (
    SELECT
      normalized_make,
      COUNT(*)::bigint as brand_count,
      SUM(price)::bigint as brand_value
    FROM brand_data
    GROUP BY normalized_make
    HAVING SUM(price) >= 1000000
  ),
  model_agg AS (
    SELECT
      normalized_make,
      model,
      COUNT(*)::bigint as model_count,
      SUM(price)::bigint as model_value
    FROM brand_data
    WHERE model IS NOT NULL
    GROUP BY normalized_make, model
  )
  SELECT 1 as id, jsonb_build_object(
    'name', 'All Brands',
    'children', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'name', ba.normalized_make,
          'value', ba.brand_value,
          'count', ba.brand_count,
          'children', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'name', ma.model,
                'value', ma.model_value,
                'count', ma.model_count
              ) ORDER BY ma.model_value DESC
            )
            FROM model_agg ma
            WHERE ma.normalized_make = ba.normalized_make
          ), '[]'::jsonb)
        ) ORDER BY ba.brand_value DESC
      )
      FROM brand_agg ba
    ), '[]'::jsonb)
  ) as data;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_treemap_nested_brand_id ON mv_treemap_nested_brand(id);

-- 6. Refresh function (supports CONCURRENTLY since we have unique indexes)
CREATE OR REPLACE FUNCTION treemap_refresh_all()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_treemap_by_source;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_treemap_by_brand;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_treemap_by_segment;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_treemap_nested_segment;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_treemap_nested_brand;
END;
$$;

-- 7. Rewrite RPC functions to use materialized views

CREATE OR REPLACE FUNCTION treemap_by_source()
RETURNS TABLE(name text, count bigint, value bigint)
LANGUAGE sql STABLE
AS $$
  SELECT name, count, value FROM mv_treemap_by_source ORDER BY value DESC;
$$;

CREATE OR REPLACE FUNCTION treemap_by_brand()
RETURNS TABLE(name text, count bigint, value bigint)
LANGUAGE sql STABLE
AS $$
  SELECT name, count, value FROM mv_treemap_by_brand ORDER BY value DESC;
$$;

CREATE OR REPLACE FUNCTION treemap_by_segment()
RETURNS TABLE(name text, count bigint, value bigint)
LANGUAGE sql STABLE
AS $$
  SELECT name, count, value FROM mv_treemap_by_segment ORDER BY value DESC;
$$;

CREATE OR REPLACE FUNCTION treemap_nested(p_view text DEFAULT 'segment', p_filter text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  result jsonb;
BEGIN
  IF p_view = 'segment' AND p_filter IS NULL THEN
    SELECT data INTO result FROM mv_treemap_nested_segment WHERE id = 1;
  ELSIF p_view = 'brand' AND p_filter IS NULL THEN
    SELECT data INTO result FROM mv_treemap_nested_brand WHERE id = 1;
  ELSE
    result := jsonb_build_object('name', 'Unknown', 'children', '[]'::jsonb);
  END IF;
  RETURN COALESCE(result, jsonb_build_object('name', 'Empty', 'children', '[]'::jsonb));
END;
$$;

-- 8. Schedule refresh every 30 minutes via pg_cron
SELECT cron.schedule(
  'treemap-refresh',
  '*/30 * * * *',
  $$SELECT treemap_refresh_all()$$
);

COMMENT ON MATERIALIZED VIEW mv_treemap_by_source IS 'Pre-computed treemap source aggregation - refreshed every 30min';
COMMENT ON MATERIALIZED VIEW mv_treemap_by_brand IS 'Pre-computed treemap brand aggregation - refreshed every 30min';
COMMENT ON MATERIALIZED VIEW mv_treemap_by_segment IS 'Pre-computed treemap segment aggregation - refreshed every 30min';
COMMENT ON FUNCTION treemap_refresh_all() IS 'Refresh all treemap materialized views concurrently';
