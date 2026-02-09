-- Sold Today Analytics: daily stats, history for temperature, and top buyers (whales).
-- Data-driven: no hardcoded thresholds; algorithms use whatever history exists (grows as data is ingested).

-- Optional: ensure get_daily_sales_trends exists (used for backfill/consistency). If already in DB, this is a no-op.
CREATE OR REPLACE FUNCTION get_daily_sales_trends(days_back int DEFAULT 30)
RETURNS TABLE (
  date date,
  sales_count bigint,
  sales_volume numeric,
  avg_sale_price numeric,
  cumulative_sales_count bigint,
  cumulative_sales_volume numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH date_series AS (
    SELECT generate_series(
      CURRENT_DATE - (days_back || ' days')::interval,
      CURRENT_DATE,
      '1 day'::interval
    )::date AS date
  ),
  daily_sales AS (
    SELECT
      sale_date::date AS day,
      COUNT(*) AS cnt,
      SUM(sale_price) AS volume,
      AVG(sale_price) AS avg_price
    FROM vehicles
    WHERE is_public = true
      AND status != 'pending'
      AND sale_price > 500
      AND sale_date IS NOT NULL
      AND sale_date::date >= CURRENT_DATE - (days_back || ' days')::interval
      AND (auction_outcome IS NULL OR auction_outcome NOT IN ('reserve_not_met'))
    GROUP BY sale_date::date
  )
  SELECT
    ds.date,
    COALESCE(da.cnt, 0) AS sales_count,
    COALESCE(da.volume, 0)::numeric AS sales_volume,
    COALESCE(da.avg_price, 0)::numeric AS avg_sale_price,
    SUM(COALESCE(da.cnt, 0)) OVER (ORDER BY ds.date)::bigint AS cumulative_sales_count,
    SUM(COALESCE(da.volume, 0)) OVER (ORDER BY ds.date)::numeric AS cumulative_sales_volume
  FROM date_series ds
  LEFT JOIN daily_sales da ON ds.date = da.day
  ORDER BY ds.date;
END;
$$;

GRANT EXECUTE ON FUNCTION get_daily_sales_trends(int) TO authenticated;
GRANT EXECUTE ON FUNCTION get_daily_sales_trends(int) TO service_role;

-- Single RPC that returns everything needed for Sold Today popup: today's stats, daily history, and whales.
-- Frontend computes "temperature" and "good day" from daily_history (rolling avg, percentiles) so logic grows with data.
CREATE OR REPLACE FUNCTION get_sold_today_analytics(
  p_date date DEFAULT CURRENT_DATE,
  p_days_back int DEFAULT 30,
  p_whales_limit int DEFAULT 10
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_today_count bigint;
  v_today_volume numeric;
  v_today_avg numeric;
  v_daily jsonb;
  v_whales jsonb;
  v_result jsonb;
BEGIN
  -- Today's aggregates (sale_date = p_date)
  SELECT
    COUNT(*),
    COALESCE(SUM(sale_price), 0),
    COALESCE(AVG(sale_price), 0)
  INTO v_today_count, v_today_volume, v_today_avg
  FROM vehicles
  WHERE is_public = true
    AND status != 'pending'
    AND sale_price > 500
    AND sale_date IS NOT NULL
    AND sale_date::date = p_date
    AND (auction_outcome IS NULL OR auction_outcome NOT IN ('reserve_not_met'));

  -- Daily history for last p_days_back days (for temperature / good-day algorithms)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'date', d.date,
      'sales_count', d.sales_count,
      'sales_volume', d.sales_volume,
      'avg_sale_price', d.avg_sale_price
    ) ORDER BY d.date
  ), '[]'::jsonb)
  INTO v_daily
  FROM get_daily_sales_trends(p_days_back) d;

  -- Whales: top buyers by total spend on p_date (buyer from bat_buyer or origin_metadata)
  WITH buyer_totals AS (
    SELECT
      COALESCE(NULLIF(TRIM(v.bat_buyer), ''), NULLIF(TRIM(v.origin_metadata->>'bat_buyer'), ''), NULLIF(TRIM(v.origin_metadata->>'buyer'), ''), 'Unknown') AS buyer_display,
      SUM(v.sale_price) AS total_spend,
      COUNT(*) AS vehicle_count
    FROM vehicles v
    WHERE v.is_public = true
      AND v.status != 'pending'
      AND v.sale_price > 500
      AND v.sale_date IS NOT NULL
      AND v.sale_date::date = p_date
      AND (v.auction_outcome IS NULL OR v.auction_outcome NOT IN ('reserve_not_met'))
    GROUP BY 1
    ORDER BY total_spend DESC NULLS LAST
    LIMIT p_whales_limit
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'buyer_display', buyer_display,
    'total_spend', total_spend,
    'vehicle_count', vehicle_count
  )), '[]'::jsonb)
  INTO v_whales
  FROM buyer_totals;

  v_result := jsonb_build_object(
    'today', jsonb_build_object(
      'date', p_date,
      'sales_count', COALESCE(v_today_count, 0),
      'sales_volume', COALESCE(v_today_volume, 0),
      'avg_sale_price', COALESCE(v_today_avg, 0)
    ),
    'daily_history', COALESCE(v_daily, '[]'::jsonb),
    'whales', COALESCE(v_whales, '[]'::jsonb)
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_sold_today_analytics(date, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION get_sold_today_analytics(date, int, int) TO service_role;

COMMENT ON FUNCTION get_sold_today_analytics IS 'Returns today stats, daily history for market temperature, and top buyers (whales). No hardcoded thresholds; frontend derives good-day/temperature from daily_history.';
