-- Phase 3: Rewrite all treemap materialized views to use canonical_makes + rich metrics
-- Replaces hardcoded CASE statements with LEFT JOIN canonical_makes
-- Adds median_price, min_price, max_price, sold_count, auction_count, avg_bids, avg_watchers

-- Common filter for valid vehicle data
-- price > 0, price < $100M, non-deleted, has make, not junk make

------------------------------------------------------------
-- 1. Source aggregation (replaces mv_treemap_by_source)
------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_treemap_by_source CASCADE;

CREATE MATERIALIZED VIEW mv_treemap_by_source AS
  WITH source_agg AS (
    SELECT
      CASE
        WHEN LOWER(v.auction_source) IN ('bat', 'bringatrailer', 'bring a trailer') THEN 'Bring a Trailer'
        WHEN LOWER(v.auction_source) IN ('gooding', 'gooding & co') THEN 'Gooding & Co'
        WHEN LOWER(v.auction_source) IN ('rm sothebys', 'rm sotheby''s') THEN 'RM Sotheby''s'
        WHEN LOWER(v.auction_source) IN ('cars & bids', 'cars-and-bids') THEN 'Cars & Bids'
        WHEN LOWER(v.auction_source) = 'mecum' THEN 'Mecum'
        WHEN LOWER(v.auction_source) = 'bonhams' THEN 'Bonhams'
        WHEN LOWER(v.auction_source) = 'broad arrow' THEN 'Broad Arrow'
        WHEN LOWER(v.auction_source) IN ('collecting_cars', 'collecting cars') THEN 'Collecting Cars'
        WHEN LOWER(v.auction_source) = 'sbx cars' THEN 'SBX Cars'
        WHEN LOWER(v.auction_source) = 'pcarmarket' THEN 'PCarMarket'
        WHEN LOWER(v.auction_source) = 'classic.com' THEN 'Classic.com'
        ELSE NULL
      END as src,
      COALESCE(v.sale_price, v.sold_price) as price,
      v.auction_outcome,
      v.bat_bids,
      v.bat_watchers
    FROM vehicles v
    WHERE v.deleted_at IS NULL
      AND (v.sale_price > 0 OR v.sold_price > 0)
      AND COALESCE(v.sale_price, v.sold_price) < 100000000
      AND v.make IS NOT NULL
      AND LENGTH(v.make) > 2
      AND v.make !~* '^[0-9]'
      AND v.make !~* 'mile|owner|reserve|unknown|other|n/a|none|tbd'
  )
  SELECT
    src as name,
    COUNT(*)::bigint as count,
    SUM(price)::bigint as value,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price)::bigint as median_price,
    MIN(price)::bigint as min_price,
    MAX(price)::bigint as max_price,
    COUNT(*) FILTER (WHERE auction_outcome = 'sold')::bigint as sold_count,
    COUNT(*) FILTER (WHERE auction_outcome IS NOT NULL)::bigint as auction_count,
    ROUND(AVG(bat_bids) FILTER (WHERE bat_bids > 0))::int as avg_bids,
    ROUND(AVG(bat_watchers) FILTER (WHERE bat_watchers > 0))::int as avg_watchers
  FROM source_agg
  WHERE src IS NOT NULL
  GROUP BY src
  HAVING SUM(price) >= 1000000
  ORDER BY value DESC;

CREATE UNIQUE INDEX idx_mv_treemap_source_name ON mv_treemap_by_source(name);

------------------------------------------------------------
-- 2. Brand aggregation (replaces mv_treemap_by_brand)
------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_treemap_by_brand CASCADE;

CREATE MATERIALIZED VIEW mv_treemap_by_brand AS
  SELECT
    COALESCE(cm.display_name, INITCAP(v.make)) as name,
    COUNT(*)::bigint as count,
    SUM(COALESCE(v.sale_price, v.sold_price))::bigint as value,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY COALESCE(v.sale_price, v.sold_price))::bigint as median_price,
    MIN(COALESCE(v.sale_price, v.sold_price))::bigint as min_price,
    MAX(COALESCE(v.sale_price, v.sold_price))::bigint as max_price,
    COUNT(*) FILTER (WHERE v.auction_outcome = 'sold')::bigint as sold_count,
    COUNT(*) FILTER (WHERE v.auction_outcome IS NOT NULL)::bigint as auction_count,
    ROUND(AVG(v.bat_bids) FILTER (WHERE v.bat_bids > 0))::int as avg_bids,
    ROUND(AVG(v.bat_watchers) FILTER (WHERE v.bat_watchers > 0))::int as avg_watchers
  FROM vehicles v
  LEFT JOIN canonical_makes cm ON v.canonical_make_id = cm.id
  WHERE v.deleted_at IS NULL
    AND (v.sale_price > 0 OR v.sold_price > 0)
    AND COALESCE(v.sale_price, v.sold_price) < 100000000
    AND v.make IS NOT NULL
    AND LENGTH(v.make) > 2
    AND v.make !~* '^[0-9]'
    AND v.make !~* 'mile|owner|reserve|unknown|other|n/a|none|tbd'
  GROUP BY COALESCE(cm.display_name, INITCAP(v.make))
  HAVING SUM(COALESCE(v.sale_price, v.sold_price)) >= 1000000
  ORDER BY value DESC;

CREATE UNIQUE INDEX idx_mv_treemap_brand_name ON mv_treemap_by_brand(name);

------------------------------------------------------------
-- 3. Segment aggregation (replaces mv_treemap_by_segment)
------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_treemap_by_segment CASCADE;

CREATE MATERIALIZED VIEW mv_treemap_by_segment AS
  SELECT
    vs.display_name as name,
    COUNT(*)::bigint as count,
    SUM(COALESCE(v.sale_price, v.sold_price))::bigint as value,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY COALESCE(v.sale_price, v.sold_price))::bigint as median_price,
    MIN(COALESCE(v.sale_price, v.sold_price))::bigint as min_price,
    MAX(COALESCE(v.sale_price, v.sold_price))::bigint as max_price,
    COUNT(*) FILTER (WHERE v.auction_outcome = 'sold')::bigint as sold_count,
    COUNT(*) FILTER (WHERE v.auction_outcome IS NOT NULL)::bigint as auction_count,
    ROUND(AVG(v.bat_bids) FILTER (WHERE v.bat_bids > 0))::int as avg_bids,
    ROUND(AVG(v.bat_watchers) FILTER (WHERE v.bat_watchers > 0))::int as avg_watchers
  FROM vehicles v
  JOIN vehicle_segments vs ON v.segment_slug = vs.slug
  WHERE v.deleted_at IS NULL
    AND (v.sale_price > 0 OR v.sold_price > 0)
    AND COALESCE(v.sale_price, v.sold_price) < 100000000
    AND v.make IS NOT NULL
    AND LENGTH(v.make) > 2
  GROUP BY vs.display_name
  ORDER BY value DESC;

CREATE UNIQUE INDEX idx_mv_treemap_segment_name ON mv_treemap_by_segment(name);

------------------------------------------------------------
-- 4. Nested segment (segments → makes) with rich metrics
------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_treemap_nested_segment CASCADE;

CREATE MATERIALIZED VIEW mv_treemap_nested_segment AS
  WITH make_data AS (
    SELECT
      v.segment_slug,
      COALESCE(cm.display_name, INITCAP(v.make)) as normalized_make,
      COALESCE(v.sale_price, v.sold_price) as price,
      v.auction_outcome,
      v.bat_bids,
      v.bat_watchers
    FROM vehicles v
    LEFT JOIN canonical_makes cm ON v.canonical_make_id = cm.id
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
      SUM(price)::bigint as make_value,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price)::bigint as median_price,
      COUNT(*) FILTER (WHERE auction_outcome = 'sold')::bigint as sold_count,
      COUNT(*) FILTER (WHERE auction_outcome IS NOT NULL)::bigint as auction_count,
      ROUND(AVG(bat_bids) FILTER (WHERE bat_bids > 0))::int as avg_bids,
      ROUND(AVG(bat_watchers) FILTER (WHERE bat_watchers > 0))::int as avg_watchers
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
                'count', ma.make_count,
                'medianPrice', ma.median_price,
                'soldCount', ma.sold_count,
                'auctionCount', ma.auction_count,
                'avgBids', ma.avg_bids,
                'avgWatchers', ma.avg_watchers
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

CREATE UNIQUE INDEX idx_mv_treemap_nested_segment_id ON mv_treemap_nested_segment(id);

------------------------------------------------------------
-- 5. Nested brand (brands → models) with rich metrics
------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_treemap_nested_brand CASCADE;

CREATE MATERIALIZED VIEW mv_treemap_nested_brand AS
  WITH brand_data AS (
    SELECT
      COALESCE(cm.display_name, INITCAP(v.make)) as normalized_make,
      v.model,
      COALESCE(v.sale_price, v.sold_price) as price,
      v.auction_outcome,
      v.bat_bids,
      v.bat_watchers
    FROM vehicles v
    LEFT JOIN canonical_makes cm ON v.canonical_make_id = cm.id
    WHERE v.deleted_at IS NULL
      AND (v.sale_price > 0 OR v.sold_price > 0)
      AND COALESCE(v.sale_price, v.sold_price) < 100000000
      AND v.make IS NOT NULL
      AND LENGTH(v.make) > 2
      AND v.make !~* '^[0-9]'
      AND v.make !~* 'mile|owner|reserve|unknown|other|n/a|none|tbd'
  ),
  brand_agg AS (
    SELECT
      normalized_make,
      COUNT(*)::bigint as brand_count,
      SUM(price)::bigint as brand_value,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price)::bigint as median_price,
      COUNT(*) FILTER (WHERE auction_outcome = 'sold')::bigint as sold_count,
      COUNT(*) FILTER (WHERE auction_outcome IS NOT NULL)::bigint as auction_count,
      ROUND(AVG(bat_bids) FILTER (WHERE bat_bids > 0))::int as avg_bids,
      ROUND(AVG(bat_watchers) FILTER (WHERE bat_watchers > 0))::int as avg_watchers
    FROM brand_data
    GROUP BY normalized_make
    HAVING SUM(price) >= 1000000
  ),
  model_agg AS (
    SELECT
      normalized_make,
      model,
      COUNT(*)::bigint as model_count,
      SUM(price)::bigint as model_value,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price)::bigint as median_price,
      COUNT(*) FILTER (WHERE auction_outcome = 'sold')::bigint as sold_count,
      COUNT(*) FILTER (WHERE auction_outcome IS NOT NULL)::bigint as auction_count,
      ROUND(AVG(bat_bids) FILTER (WHERE bat_bids > 0))::int as avg_bids,
      ROUND(AVG(bat_watchers) FILTER (WHERE bat_watchers > 0))::int as avg_watchers
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
          'medianPrice', ba.median_price,
          'soldCount', ba.sold_count,
          'auctionCount', ba.auction_count,
          'avgBids', ba.avg_bids,
          'avgWatchers', ba.avg_watchers,
          'children', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'name', ma.model,
                'value', ma.model_value,
                'count', ma.model_count,
                'medianPrice', ma.median_price,
                'soldCount', ma.sold_count,
                'auctionCount', ma.auction_count,
                'avgBids', ma.avg_bids,
                'avgWatchers', ma.avg_watchers
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

CREATE UNIQUE INDEX idx_mv_treemap_nested_brand_id ON mv_treemap_nested_brand(id);

------------------------------------------------------------
-- 6. Makes per source with rich metrics
------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_treemap_makes_by_source CASCADE;

CREATE MATERIALIZED VIEW mv_treemap_makes_by_source AS
  WITH source_make_agg AS (
    SELECT
      CASE
        WHEN LOWER(v.auction_source) IN ('bat', 'bringatrailer', 'bring a trailer') THEN 'Bring a Trailer'
        WHEN LOWER(v.auction_source) IN ('gooding', 'gooding & co') THEN 'Gooding & Co'
        WHEN LOWER(v.auction_source) IN ('rm sothebys', 'rm sotheby''s') THEN 'RM Sotheby''s'
        WHEN LOWER(v.auction_source) IN ('cars & bids', 'cars-and-bids') THEN 'Cars & Bids'
        WHEN LOWER(v.auction_source) = 'mecum' THEN 'Mecum'
        WHEN LOWER(v.auction_source) = 'bonhams' THEN 'Bonhams'
        WHEN LOWER(v.auction_source) = 'broad arrow' THEN 'Broad Arrow'
        WHEN LOWER(v.auction_source) IN ('collecting_cars', 'collecting cars') THEN 'Collecting Cars'
        WHEN LOWER(v.auction_source) = 'sbx cars' THEN 'SBX Cars'
        WHEN LOWER(v.auction_source) = 'pcarmarket' THEN 'PCarMarket'
        WHEN LOWER(v.auction_source) = 'classic.com' THEN 'Classic.com'
        ELSE NULL
      END as source_name,
      COALESCE(cm.display_name, INITCAP(v.make)) as make_name,
      COALESCE(v.sale_price, v.sold_price) as price,
      v.auction_outcome,
      v.bat_bids,
      v.bat_watchers
    FROM vehicles v
    LEFT JOIN canonical_makes cm ON v.canonical_make_id = cm.id
    WHERE v.deleted_at IS NULL
      AND (v.sale_price > 0 OR v.sold_price > 0)
      AND COALESCE(v.sale_price, v.sold_price) < 100000000
      AND v.make IS NOT NULL
      AND LENGTH(v.make) > 2
      AND v.make !~* '^[0-9]'
      AND v.make !~* 'mile|owner|reserve|unknown|other|n/a|none|tbd'
  )
  SELECT
    source_name,
    make_name as name,
    COUNT(*)::bigint as count,
    SUM(price)::bigint as value,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price)::bigint as median_price,
    MIN(price)::bigint as min_price,
    MAX(price)::bigint as max_price,
    COUNT(*) FILTER (WHERE auction_outcome = 'sold')::bigint as sold_count,
    COUNT(*) FILTER (WHERE auction_outcome IS NOT NULL)::bigint as auction_count,
    ROUND(AVG(bat_bids) FILTER (WHERE bat_bids > 0))::int as avg_bids,
    ROUND(AVG(bat_watchers) FILTER (WHERE bat_watchers > 0))::int as avg_watchers
  FROM source_make_agg
  WHERE source_name IS NOT NULL
  GROUP BY source_name, make_name
  ORDER BY source_name, value DESC;

CREATE UNIQUE INDEX idx_mv_makes_by_source ON mv_treemap_makes_by_source(source_name, name);

------------------------------------------------------------
-- 7. Makes per segment with rich metrics
------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_treemap_makes_by_segment CASCADE;

CREATE MATERIALIZED VIEW mv_treemap_makes_by_segment AS
  SELECT
    vs.display_name as segment_name,
    COALESCE(cm.display_name, INITCAP(v.make)) as name,
    COUNT(*)::bigint as count,
    SUM(COALESCE(v.sale_price, v.sold_price))::bigint as value,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY COALESCE(v.sale_price, v.sold_price))::bigint as median_price,
    MIN(COALESCE(v.sale_price, v.sold_price))::bigint as min_price,
    MAX(COALESCE(v.sale_price, v.sold_price))::bigint as max_price,
    COUNT(*) FILTER (WHERE v.auction_outcome = 'sold')::bigint as sold_count,
    COUNT(*) FILTER (WHERE v.auction_outcome IS NOT NULL)::bigint as auction_count,
    ROUND(AVG(v.bat_bids) FILTER (WHERE v.bat_bids > 0))::int as avg_bids,
    ROUND(AVG(v.bat_watchers) FILTER (WHERE v.bat_watchers > 0))::int as avg_watchers
  FROM vehicles v
  LEFT JOIN canonical_makes cm ON v.canonical_make_id = cm.id
  JOIN vehicle_segments vs ON v.segment_slug = vs.slug
  WHERE v.deleted_at IS NULL
    AND (v.sale_price > 0 OR v.sold_price > 0)
    AND COALESCE(v.sale_price, v.sold_price) < 100000000
    AND v.make IS NOT NULL
    AND LENGTH(v.make) > 2
  GROUP BY vs.display_name, COALESCE(cm.display_name, INITCAP(v.make))
  ORDER BY segment_name, value DESC;

CREATE UNIQUE INDEX idx_mv_makes_by_segment ON mv_treemap_makes_by_segment(segment_name, name);

------------------------------------------------------------
-- 8. Models per brand with rich metrics
------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_treemap_models_by_brand CASCADE;

CREATE MATERIALIZED VIEW mv_treemap_models_by_brand AS
  SELECT
    COALESCE(cm.display_name, INITCAP(v.make)) as brand_name,
    v.model as name,
    COUNT(*)::bigint as count,
    SUM(COALESCE(v.sale_price, v.sold_price))::bigint as value,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY COALESCE(v.sale_price, v.sold_price))::bigint as median_price,
    MIN(COALESCE(v.sale_price, v.sold_price))::bigint as min_price,
    MAX(COALESCE(v.sale_price, v.sold_price))::bigint as max_price,
    COUNT(*) FILTER (WHERE v.auction_outcome = 'sold')::bigint as sold_count,
    COUNT(*) FILTER (WHERE v.auction_outcome IS NOT NULL)::bigint as auction_count,
    ROUND(AVG(v.bat_bids) FILTER (WHERE v.bat_bids > 0))::int as avg_bids,
    ROUND(AVG(v.bat_watchers) FILTER (WHERE v.bat_watchers > 0))::int as avg_watchers
  FROM vehicles v
  LEFT JOIN canonical_makes cm ON v.canonical_make_id = cm.id
  WHERE v.deleted_at IS NULL
    AND (v.sale_price > 0 OR v.sold_price > 0)
    AND COALESCE(v.sale_price, v.sold_price) < 100000000
    AND v.model IS NOT NULL
    AND v.make IS NOT NULL
    AND LENGTH(v.make) > 2
  GROUP BY COALESCE(cm.display_name, INITCAP(v.make)), v.model
  ORDER BY brand_name, value DESC;

CREATE UNIQUE INDEX idx_mv_models_by_brand ON mv_treemap_models_by_brand(brand_name, name);

------------------------------------------------------------
-- 9. Models per source+make with rich metrics
------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_treemap_models_by_source_make CASCADE;

CREATE MATERIALIZED VIEW mv_treemap_models_by_source_make AS
  WITH base AS (
    SELECT
      CASE
        WHEN LOWER(v.auction_source) IN ('bat', 'bringatrailer', 'bring a trailer') THEN 'Bring a Trailer'
        WHEN LOWER(v.auction_source) IN ('gooding', 'gooding & co') THEN 'Gooding & Co'
        WHEN LOWER(v.auction_source) IN ('rm sothebys', 'rm sotheby''s') THEN 'RM Sotheby''s'
        WHEN LOWER(v.auction_source) IN ('cars & bids', 'cars-and-bids') THEN 'Cars & Bids'
        WHEN LOWER(v.auction_source) = 'mecum' THEN 'Mecum'
        WHEN LOWER(v.auction_source) = 'bonhams' THEN 'Bonhams'
        WHEN LOWER(v.auction_source) = 'broad arrow' THEN 'Broad Arrow'
        WHEN LOWER(v.auction_source) IN ('collecting_cars', 'collecting cars') THEN 'Collecting Cars'
        WHEN LOWER(v.auction_source) = 'sbx cars' THEN 'SBX Cars'
        WHEN LOWER(v.auction_source) = 'pcarmarket' THEN 'PCarMarket'
        WHEN LOWER(v.auction_source) = 'classic.com' THEN 'Classic.com'
        ELSE NULL
      END as source_name,
      COALESCE(cm.display_name, INITCAP(v.make)) as make_name,
      v.model as name,
      COALESCE(v.sale_price, v.sold_price) as price,
      v.auction_outcome,
      v.bat_bids,
      v.bat_watchers
    FROM vehicles v
    LEFT JOIN canonical_makes cm ON v.canonical_make_id = cm.id
    WHERE v.deleted_at IS NULL
      AND (v.sale_price > 0 OR v.sold_price > 0)
      AND COALESCE(v.sale_price, v.sold_price) < 100000000
      AND v.model IS NOT NULL
      AND v.make IS NOT NULL
      AND LENGTH(v.make) > 2
  )
  SELECT
    source_name,
    make_name,
    name,
    COUNT(*)::bigint as count,
    SUM(price)::bigint as value,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price)::bigint as median_price,
    COUNT(*) FILTER (WHERE auction_outcome = 'sold')::bigint as sold_count,
    COUNT(*) FILTER (WHERE auction_outcome IS NOT NULL)::bigint as auction_count,
    ROUND(AVG(bat_bids) FILTER (WHERE bat_bids > 0))::int as avg_bids,
    ROUND(AVG(bat_watchers) FILTER (WHERE bat_watchers > 0))::int as avg_watchers
  FROM base
  WHERE source_name IS NOT NULL
  GROUP BY source_name, make_name, name;

CREATE UNIQUE INDEX idx_mv_models_by_source_make ON mv_treemap_models_by_source_make(source_name, make_name, name);

------------------------------------------------------------
-- 10. Years aggregation
------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_treemap_years CASCADE;

CREATE MATERIALIZED VIEW mv_treemap_years AS
  SELECT
    CASE
      WHEN LOWER(v.auction_source) IN ('bat', 'bringatrailer', 'bring a trailer') THEN 'Bring a Trailer'
      WHEN LOWER(v.auction_source) IN ('gooding', 'gooding & co') THEN 'Gooding & Co'
      WHEN LOWER(v.auction_source) IN ('rm sothebys', 'rm sotheby''s') THEN 'RM Sotheby''s'
      WHEN LOWER(v.auction_source) IN ('cars & bids', 'cars-and-bids') THEN 'Cars & Bids'
      WHEN LOWER(v.auction_source) = 'mecum' THEN 'Mecum'
      WHEN LOWER(v.auction_source) = 'bonhams' THEN 'Bonhams'
      WHEN LOWER(v.auction_source) = 'broad arrow' THEN 'Broad Arrow'
      WHEN LOWER(v.auction_source) IN ('collecting_cars', 'collecting cars') THEN 'Collecting Cars'
      WHEN LOWER(v.auction_source) = 'sbx cars' THEN 'SBX Cars'
      WHEN LOWER(v.auction_source) = 'pcarmarket' THEN 'PCarMarket'
      WHEN LOWER(v.auction_source) = 'classic.com' THEN 'Classic.com'
      ELSE NULL
    END as source_name,
    LOWER(v.make) as make_lower,
    LOWER(v.model) as model_lower,
    v.year::text as name,
    COUNT(*)::bigint as count,
    SUM(COALESCE(v.sale_price, v.sold_price))::bigint as value,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY COALESCE(v.sale_price, v.sold_price))::bigint as median_price,
    COUNT(*) FILTER (WHERE v.auction_outcome = 'sold')::bigint as sold_count,
    COUNT(*) FILTER (WHERE v.auction_outcome IS NOT NULL)::bigint as auction_count,
    ROUND(AVG(v.bat_bids) FILTER (WHERE v.bat_bids > 0))::int as avg_bids,
    ROUND(AVG(v.bat_watchers) FILTER (WHERE v.bat_watchers > 0))::int as avg_watchers
  FROM vehicles v
  WHERE v.deleted_at IS NULL
    AND (v.sale_price > 0 OR v.sold_price > 0)
    AND COALESCE(v.sale_price, v.sold_price) < 100000000
    AND v.year IS NOT NULL
    AND v.make IS NOT NULL
    AND v.model IS NOT NULL
  GROUP BY source_name, make_lower, model_lower, v.year;

CREATE INDEX idx_mv_years_make_model ON mv_treemap_years(make_lower, model_lower);
CREATE INDEX idx_mv_years_source_make_model ON mv_treemap_years(source_name, make_lower, model_lower);

------------------------------------------------------------
-- 11. Update RPC functions to return new columns
-- Must DROP first since return types changed
------------------------------------------------------------

DROP FUNCTION IF EXISTS treemap_by_source();
DROP FUNCTION IF EXISTS treemap_by_brand();
DROP FUNCTION IF EXISTS treemap_by_segment();
DROP FUNCTION IF EXISTS treemap_makes_by_source(text);
DROP FUNCTION IF EXISTS treemap_makes_by_segment(text);
DROP FUNCTION IF EXISTS treemap_models_by_brand(text);
DROP FUNCTION IF EXISTS treemap_models(text, text);
DROP FUNCTION IF EXISTS treemap_years(text, text, text);

CREATE OR REPLACE FUNCTION treemap_by_source()
RETURNS TABLE(name text, count bigint, value bigint, median_price bigint, min_price bigint, max_price bigint, sold_count bigint, auction_count bigint, avg_bids int, avg_watchers int)
LANGUAGE sql STABLE
AS $$
  SELECT name, count, value, median_price, min_price, max_price, sold_count, auction_count, avg_bids, avg_watchers
  FROM mv_treemap_by_source ORDER BY value DESC;
$$;

CREATE OR REPLACE FUNCTION treemap_by_brand()
RETURNS TABLE(name text, count bigint, value bigint, median_price bigint, min_price bigint, max_price bigint, sold_count bigint, auction_count bigint, avg_bids int, avg_watchers int)
LANGUAGE sql STABLE
AS $$
  SELECT name, count, value, median_price, min_price, max_price, sold_count, auction_count, avg_bids, avg_watchers
  FROM mv_treemap_by_brand ORDER BY value DESC;
$$;

CREATE OR REPLACE FUNCTION treemap_by_segment()
RETURNS TABLE(name text, count bigint, value bigint, median_price bigint, min_price bigint, max_price bigint, sold_count bigint, auction_count bigint, avg_bids int, avg_watchers int)
LANGUAGE sql STABLE
AS $$
  SELECT name, count, value, median_price, min_price, max_price, sold_count, auction_count, avg_bids, avg_watchers
  FROM mv_treemap_by_segment ORDER BY value DESC;
$$;

CREATE OR REPLACE FUNCTION treemap_makes_by_source(p_source text)
RETURNS TABLE(name text, count bigint, value bigint, median_price bigint, min_price bigint, max_price bigint, sold_count bigint, auction_count bigint, avg_bids int, avg_watchers int)
LANGUAGE sql STABLE
AS $$
  SELECT name, count, value, median_price, min_price, max_price, sold_count, auction_count, avg_bids, avg_watchers
  FROM mv_treemap_makes_by_source
  WHERE source_name = p_source
  ORDER BY value DESC;
$$;

CREATE OR REPLACE FUNCTION treemap_makes_by_segment(p_segment text)
RETURNS TABLE(name text, count bigint, value bigint, median_price bigint, min_price bigint, max_price bigint, sold_count bigint, auction_count bigint, avg_bids int, avg_watchers int)
LANGUAGE sql STABLE
AS $$
  SELECT name, count, value, median_price, min_price, max_price, sold_count, auction_count, avg_bids, avg_watchers
  FROM mv_treemap_makes_by_segment
  WHERE segment_name = p_segment
  ORDER BY value DESC;
$$;

CREATE OR REPLACE FUNCTION treemap_models_by_brand(p_make text)
RETURNS TABLE(name text, count bigint, value bigint, median_price bigint, min_price bigint, max_price bigint, sold_count bigint, auction_count bigint, avg_bids int, avg_watchers int)
LANGUAGE sql STABLE
AS $$
  SELECT name, count, value, median_price, min_price, max_price, sold_count, auction_count, avg_bids, avg_watchers
  FROM mv_treemap_models_by_brand
  WHERE brand_name = p_make
  ORDER BY value DESC
  LIMIT 200;
$$;

CREATE OR REPLACE FUNCTION treemap_models(p_source text, p_make text)
RETURNS TABLE(name text, count bigint, value bigint, median_price bigint, sold_count bigint, auction_count bigint, avg_bids int, avg_watchers int)
LANGUAGE sql STABLE
AS $$
  SELECT name, count, value, median_price, sold_count, auction_count, avg_bids, avg_watchers
  FROM mv_treemap_models_by_source_make
  WHERE (p_source IS NULL OR source_name = p_source)
    AND make_name = p_make
  ORDER BY value DESC
  LIMIT 200;
$$;

CREATE OR REPLACE FUNCTION treemap_years(p_source text, p_make text, p_model text)
RETURNS TABLE(name text, count bigint, value bigint, median_price bigint, sold_count bigint, auction_count bigint, avg_bids int, avg_watchers int)
LANGUAGE sql STABLE
AS $$
  SELECT name, SUM(count)::bigint as count, SUM(value)::bigint as value,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY median_price)::bigint as median_price,
    SUM(sold_count)::bigint as sold_count,
    SUM(auction_count)::bigint as auction_count,
    ROUND(AVG(avg_bids))::int as avg_bids,
    ROUND(AVG(avg_watchers))::int as avg_watchers
  FROM mv_treemap_years
  WHERE make_lower = LOWER(p_make)
    AND model_lower = LOWER(p_model)
    AND (p_source IS NULL OR source_name = p_source)
  GROUP BY name
  ORDER BY value DESC;
$$;

-- Keep nested function unchanged - it reads from the MVs which now contain the metrics
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

------------------------------------------------------------
-- 12. Update refresh function
------------------------------------------------------------
CREATE OR REPLACE FUNCTION treemap_refresh_all()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_treemap_by_source;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_treemap_by_brand;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_treemap_by_segment;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_treemap_makes_by_source;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_treemap_makes_by_segment;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_treemap_models_by_brand;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_treemap_models_by_source_make;
  REFRESH MATERIALIZED VIEW mv_treemap_years;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_treemap_nested_segment;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_treemap_nested_brand;
END;
$$;

-- 13. Refresh all views now
SELECT treemap_refresh_all();
