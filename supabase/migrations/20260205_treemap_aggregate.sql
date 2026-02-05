-- Fast treemap aggregation functions
-- Returns pre-aggregated data for treemap visualization

-- Source-level aggregation
CREATE OR REPLACE FUNCTION treemap_by_source()
RETURNS TABLE(name text, count bigint, value bigint)
LANGUAGE sql STABLE
AS $$
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
$$;

-- Brand-level aggregation (all makes)
CREATE OR REPLACE FUNCTION treemap_by_brand()
RETURNS TABLE(name text, count bigint, value bigint)
LANGUAGE sql STABLE
AS $$
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
$$;

-- Make aggregation for a specific source
CREATE OR REPLACE FUNCTION treemap_makes_by_source(p_source text)
RETURNS TABLE(name text, count bigint, value bigint)
LANGUAGE sql STABLE
AS $$
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
      AND LOWER(auction_source) = ANY(
        CASE LOWER(p_source)
          WHEN 'bring a trailer' THEN ARRAY['bat', 'bringatrailer', 'bring a trailer']
          WHEN 'gooding & co' THEN ARRAY['gooding', 'gooding & co']
          WHEN 'rm sotheby''s' THEN ARRAY['rm sothebys', 'rm sotheby''s']
          WHEN 'cars & bids' THEN ARRAY['cars & bids', 'cars-and-bids']
          WHEN 'collecting cars' THEN ARRAY['collecting_cars', 'collecting cars']
          ELSE ARRAY[LOWER(p_source)]
        END
      )
  )
  SELECT normalized_make as name, COUNT(*)::bigint as count, SUM(price)::bigint as value
  FROM make_agg
  GROUP BY normalized_make
  ORDER BY value DESC;
$$;

-- Model aggregation for a specific source + make
CREATE OR REPLACE FUNCTION treemap_models(p_source text, p_make text)
RETURNS TABLE(name text, count bigint, value bigint)
LANGUAGE sql STABLE
AS $$
  SELECT
    model as name,
    COUNT(*)::bigint as count,
    SUM(COALESCE(sale_price, sold_price))::bigint as value
  FROM vehicles
  WHERE deleted_at IS NULL
    AND (sale_price > 0 OR sold_price > 0)
    AND COALESCE(sale_price, sold_price) < 100000000
    AND model IS NOT NULL
    AND LOWER(make) = LOWER(p_make)
    AND (
      p_source IS NULL OR
      LOWER(auction_source) = ANY(
        CASE LOWER(p_source)
          WHEN 'bring a trailer' THEN ARRAY['bat', 'bringatrailer', 'bring a trailer']
          WHEN 'gooding & co' THEN ARRAY['gooding', 'gooding & co']
          WHEN 'rm sotheby''s' THEN ARRAY['rm sothebys', 'rm sotheby''s']
          WHEN 'cars & bids' THEN ARRAY['cars & bids', 'cars-and-bids']
          WHEN 'collecting cars' THEN ARRAY['collecting_cars', 'collecting cars']
          ELSE ARRAY[LOWER(p_source)]
        END
      )
    )
  GROUP BY model
  ORDER BY value DESC
  LIMIT 200;
$$;

-- Model aggregation for brand view (no source filter)
CREATE OR REPLACE FUNCTION treemap_models_by_brand(p_make text)
RETURNS TABLE(name text, count bigint, value bigint)
LANGUAGE sql STABLE
AS $$
  SELECT
    model as name,
    COUNT(*)::bigint as count,
    SUM(COALESCE(sale_price, sold_price))::bigint as value
  FROM vehicles
  WHERE deleted_at IS NULL
    AND (sale_price > 0 OR sold_price > 0)
    AND COALESCE(sale_price, sold_price) < 100000000
    AND model IS NOT NULL
    AND LOWER(make) = LOWER(p_make)
  GROUP BY model
  ORDER BY value DESC
  LIMIT 200;
$$;

-- Year aggregation
CREATE OR REPLACE FUNCTION treemap_years(p_source text, p_make text, p_model text)
RETURNS TABLE(name text, count bigint, value bigint)
LANGUAGE sql STABLE
AS $$
  SELECT
    year::text as name,
    COUNT(*)::bigint as count,
    SUM(COALESCE(sale_price, sold_price))::bigint as value
  FROM vehicles
  WHERE deleted_at IS NULL
    AND (sale_price > 0 OR sold_price > 0)
    AND COALESCE(sale_price, sold_price) < 100000000
    AND year IS NOT NULL
    AND LOWER(make) = LOWER(p_make)
    AND LOWER(model) = LOWER(p_model)
    AND (
      p_source IS NULL OR
      LOWER(auction_source) = ANY(
        CASE LOWER(p_source)
          WHEN 'bring a trailer' THEN ARRAY['bat', 'bringatrailer', 'bring a trailer']
          WHEN 'gooding & co' THEN ARRAY['gooding', 'gooding & co']
          WHEN 'rm sotheby''s' THEN ARRAY['rm sothebys', 'rm sotheby''s']
          WHEN 'cars & bids' THEN ARRAY['cars & bids', 'cars-and-bids']
          WHEN 'collecting cars' THEN ARRAY['collecting_cars', 'collecting cars']
          ELSE ARRAY[LOWER(p_source)]
        END
      )
    )
  GROUP BY year
  ORDER BY value DESC;
$$;

COMMENT ON FUNCTION treemap_by_source() IS 'Fast aggregation for treemap source-level view';
COMMENT ON FUNCTION treemap_by_brand() IS 'Fast aggregation for treemap brand-level view';
