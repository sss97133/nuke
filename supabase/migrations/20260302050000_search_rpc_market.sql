-- Market data RPC: aggregated pricing and sales analysis
-- Returns JSONB with median, avg, distribution, top models, recent sales

CREATE OR REPLACE FUNCTION search_market_data(
  p_make TEXT,
  p_model TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result JSONB;
  v_total_sales BIGINT;
  v_median_price NUMERIC;
  v_avg_price NUMERIC;
  v_min_price NUMERIC;
  v_max_price NUMERIC;
  v_price_distribution JSONB;
  v_by_model JSONB;
  v_recent_sales JSONB;
BEGIN
  -- Handle NULL make gracefully
  IF p_make IS NULL THEN
    RETURN jsonb_build_object('error', 'p_make is required');
  END IF;

  -- ==========================================================================
  -- Core price statistics
  -- ==========================================================================
  SELECT
    count(*),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sold_price),
    round(avg(sold_price), 2),
    min(sold_price),
    max(sold_price)
  INTO v_total_sales, v_median_price, v_avg_price, v_min_price, v_max_price
  FROM vehicles
  WHERE is_public = true
    AND sold_price IS NOT NULL
    AND sold_price > 0
    AND lower(make) = lower(p_make)
    AND (p_model IS NULL OR lower(model) = lower(p_model));

  -- ==========================================================================
  -- Price distribution: 10 buckets
  -- ==========================================================================
  IF v_total_sales > 0 AND v_min_price IS NOT NULL AND v_max_price IS NOT NULL AND v_max_price > v_min_price THEN
    SELECT coalesce(jsonb_agg(row_to_json(d)::jsonb ORDER BY d.bucket), '[]'::jsonb)
    INTO v_price_distribution
    FROM (
      SELECT
        width_bucket(sold_price, v_min_price, v_max_price + 1, 10) AS bucket,
        round(v_min_price + (width_bucket(sold_price, v_min_price, v_max_price + 1, 10) - 1)
              * ((v_max_price - v_min_price) / 10.0), 0) AS range_min,
        round(v_min_price + width_bucket(sold_price, v_min_price, v_max_price + 1, 10)
              * ((v_max_price - v_min_price) / 10.0), 0) AS range_max,
        count(*) AS count
      FROM vehicles
      WHERE is_public = true
        AND sold_price IS NOT NULL
        AND sold_price > 0
        AND lower(make) = lower(p_make)
        AND (p_model IS NULL OR lower(model) = lower(p_model))
      GROUP BY bucket
      ORDER BY bucket
    ) d;
  ELSE
    v_price_distribution := '[]'::jsonb;
  END IF;

  -- ==========================================================================
  -- By model: top 15 with count, avg, median
  -- ==========================================================================
  IF p_model IS NULL THEN
    SELECT coalesce(jsonb_agg(row_to_json(m)::jsonb), '[]'::jsonb)
    INTO v_by_model
    FROM (
      SELECT
        model,
        count(*) AS count,
        round(avg(sold_price), 2) AS avg_price,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sold_price) AS median_price
      FROM vehicles
      WHERE is_public = true
        AND sold_price IS NOT NULL
        AND sold_price > 0
        AND lower(make) = lower(p_make)
        AND model IS NOT NULL
      GROUP BY model
      ORDER BY count DESC
      LIMIT 15
    ) m;
  ELSE
    v_by_model := '[]'::jsonb;
  END IF;

  -- ==========================================================================
  -- Recent sales: last 20
  -- ==========================================================================
  SELECT coalesce(jsonb_agg(row_to_json(r)::jsonb), '[]'::jsonb)
  INTO v_recent_sales
  FROM (
    SELECT
      id,
      year,
      make,
      model,
      sold_price,
      created_at
    FROM vehicles
    WHERE is_public = true
      AND sold_price IS NOT NULL
      AND sold_price > 0
      AND lower(make) = lower(p_make)
      AND (p_model IS NULL OR lower(model) = lower(p_model))
    ORDER BY created_at DESC
    LIMIT 20
  ) r;

  -- ==========================================================================
  -- Assemble result
  -- ==========================================================================
  v_result := jsonb_build_object(
    'make', p_make,
    'model', p_model,
    'total_sales', coalesce(v_total_sales, 0),
    'median_price', v_median_price,
    'avg_price', v_avg_price,
    'min_price', v_min_price,
    'max_price', v_max_price,
    'price_distribution', v_price_distribution,
    'by_model', v_by_model,
    'recent_sales', v_recent_sales
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION search_market_data IS 'Returns JSONB market analysis for a make (optionally model): total_sales, median/avg/min/max price, 10-bucket price distribution, top 15 models, last 20 sales.';
