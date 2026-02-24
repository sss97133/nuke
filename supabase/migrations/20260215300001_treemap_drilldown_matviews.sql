-- Materialized views for drill-down queries
-- The second-level queries (source→makes, brand→models, segment→makes) also timeout
-- because they scan 1M+ rows. Pre-compute all combinations.

-- 1. Makes per source (all sources, pre-aggregated)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_treemap_makes_by_source AS
  WITH source_make_agg AS (
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
      END as source_name,
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
      END as make_name,
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
  SELECT
    source_name,
    make_name as name,
    COUNT(*)::bigint as count,
    SUM(price)::bigint as value
  FROM source_make_agg
  WHERE source_name IS NOT NULL
  GROUP BY source_name, make_name
  ORDER BY source_name, value DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_makes_by_source ON mv_treemap_makes_by_source(source_name, name);

-- 2. Makes per segment (all segments, pre-aggregated)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_treemap_makes_by_segment AS
  WITH seg_make_agg AS (
    SELECT
      vs.display_name as segment_name,
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
      END as make_name,
      COALESCE(v.sale_price, v.sold_price) as price
    FROM vehicles v
    JOIN vehicle_segments vs ON v.segment_slug = vs.slug
    WHERE v.deleted_at IS NULL
      AND (v.sale_price > 0 OR v.sold_price > 0)
      AND COALESCE(v.sale_price, v.sold_price) < 100000000
      AND v.make IS NOT NULL
      AND LENGTH(v.make) > 2
  )
  SELECT
    segment_name,
    make_name as name,
    COUNT(*)::bigint as count,
    SUM(price)::bigint as value
  FROM seg_make_agg
  GROUP BY segment_name, make_name
  ORDER BY segment_name, value DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_makes_by_segment ON mv_treemap_makes_by_segment(segment_name, name);

-- 3. Models per brand (all brands, pre-aggregated)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_treemap_models_by_brand AS
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
    END as brand_name,
    model as name,
    COUNT(*)::bigint as count,
    SUM(COALESCE(sale_price, sold_price))::bigint as value
  FROM vehicles
  WHERE deleted_at IS NULL
    AND (sale_price > 0 OR sold_price > 0)
    AND COALESCE(sale_price, sold_price) < 100000000
    AND model IS NOT NULL
    AND make IS NOT NULL
    AND LENGTH(make) > 2
  GROUP BY brand_name, model
  ORDER BY brand_name, value DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_models_by_brand ON mv_treemap_models_by_brand(brand_name, name);

-- 4. Models per source+make
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_treemap_models_by_source_make AS
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
    END as source_name,
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
    END as make_name,
    model as name,
    COUNT(*)::bigint as count,
    SUM(COALESCE(sale_price, sold_price))::bigint as value
  FROM vehicles
  WHERE deleted_at IS NULL
    AND (sale_price > 0 OR sold_price > 0)
    AND COALESCE(sale_price, sold_price) < 100000000
    AND model IS NOT NULL
    AND make IS NOT NULL
    AND LENGTH(make) > 2
  GROUP BY source_name, make_name, model
  HAVING CASE
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
  END IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_models_by_source_make ON mv_treemap_models_by_source_make(source_name, make_name, name);

-- 5. Years aggregation (pre-computed for all make+model combinations)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_treemap_years AS
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
    END as source_name,
    LOWER(make) as make_lower,
    LOWER(model) as model_lower,
    year::text as name,
    COUNT(*)::bigint as count,
    SUM(COALESCE(sale_price, sold_price))::bigint as value
  FROM vehicles
  WHERE deleted_at IS NULL
    AND (sale_price > 0 OR sold_price > 0)
    AND COALESCE(sale_price, sold_price) < 100000000
    AND year IS NOT NULL
    AND make IS NOT NULL
    AND model IS NOT NULL
  GROUP BY source_name, make_lower, model_lower, year;

CREATE INDEX IF NOT EXISTS idx_mv_years_make_model ON mv_treemap_years(make_lower, model_lower);
CREATE INDEX IF NOT EXISTS idx_mv_years_source_make_model ON mv_treemap_years(source_name, make_lower, model_lower);

-- 6. Rewrite drill-down functions to use materialized views

CREATE OR REPLACE FUNCTION treemap_makes_by_source(p_source text)
RETURNS TABLE(name text, count bigint, value bigint)
LANGUAGE sql STABLE
AS $$
  SELECT name, count, value
  FROM mv_treemap_makes_by_source
  WHERE source_name = p_source
  ORDER BY value DESC;
$$;

CREATE OR REPLACE FUNCTION treemap_makes_by_segment(p_segment text)
RETURNS TABLE(name text, count bigint, value bigint)
LANGUAGE sql STABLE
AS $$
  SELECT name, count, value
  FROM mv_treemap_makes_by_segment
  WHERE segment_name = p_segment
  ORDER BY value DESC;
$$;

CREATE OR REPLACE FUNCTION treemap_models_by_brand(p_make text)
RETURNS TABLE(name text, count bigint, value bigint)
LANGUAGE sql STABLE
AS $$
  SELECT name, count, value
  FROM mv_treemap_models_by_brand
  WHERE brand_name = p_make
  ORDER BY value DESC
  LIMIT 200;
$$;

CREATE OR REPLACE FUNCTION treemap_models(p_source text, p_make text)
RETURNS TABLE(name text, count bigint, value bigint)
LANGUAGE sql STABLE
AS $$
  SELECT name, count, value
  FROM mv_treemap_models_by_source_make
  WHERE (p_source IS NULL OR source_name = p_source)
    AND make_name = p_make
  ORDER BY value DESC
  LIMIT 200;
$$;

CREATE OR REPLACE FUNCTION treemap_years(p_source text, p_make text, p_model text)
RETURNS TABLE(name text, count bigint, value bigint)
LANGUAGE sql STABLE
AS $$
  SELECT name, SUM(count)::bigint as count, SUM(value)::bigint as value
  FROM mv_treemap_years
  WHERE make_lower = LOWER(p_make)
    AND model_lower = LOWER(p_model)
    AND (p_source IS NULL OR source_name = p_source)
  GROUP BY name
  ORDER BY value DESC;
$$;

-- 7. Update refresh function to include new views
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

-- 8. Add index for vehicle drill-down (deepest level - actual vehicle list by year/make/model)
-- These are selective enough to be fast with indexes
CREATE INDEX IF NOT EXISTS idx_vehicles_treemap_drill
  ON vehicles (year, lower(make), lower(model))
  WHERE deleted_at IS NULL AND (sale_price > 0 OR sold_price > 0);
