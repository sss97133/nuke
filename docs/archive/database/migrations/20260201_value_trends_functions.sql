-- Value Trends SQL Functions
-- Time series aggregations for dashboard value charts

-- =============================================================================
-- DAILY VALUE TRENDS (cumulative by created_at)
-- Returns daily totals for mark, ask, realized, cost values
-- =============================================================================

CREATE OR REPLACE FUNCTION get_daily_value_trends(days_back int DEFAULT 30)
RETURNS TABLE (
  date date,
  cumulative_mark_value numeric,
  cumulative_ask_value numeric,
  cumulative_realized_value numeric,
  cumulative_cost_value numeric,
  cumulative_total_value numeric,
  daily_mark_value numeric,
  daily_ask_value numeric,
  daily_realized_value numeric,
  daily_cost_value numeric,
  daily_total_value numeric,
  vehicle_count bigint
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
  daily_aggregates AS (
    SELECT
      created_at::date AS day,
      SUM(COALESCE(current_value, 0)) FILTER (WHERE current_value > 0) AS mark_value,
      SUM(COALESCE(asking_price, 0)) FILTER (WHERE is_for_sale = true AND asking_price > 0) AS ask_value,
      SUM(COALESCE(sale_price, 0)) FILTER (WHERE sale_price > 0) AS realized_value,
      SUM(COALESCE(purchase_price, 0)) FILTER (WHERE purchase_price > 0) AS cost_value,
      SUM(
        COALESCE(
          NULLIF(sale_price, 0),
          NULLIF(asking_price, 0),
          NULLIF(current_value, 0),
          NULLIF(purchase_price, 0),
          0
        )
      ) AS total_value,
      COUNT(*) AS cnt
    FROM vehicles
    WHERE is_public = true
      AND status != 'pending'
      AND created_at::date >= CURRENT_DATE - (days_back || ' days')::interval
    GROUP BY created_at::date
  )
  SELECT
    ds.date,
    -- Cumulative values (running sum)
    SUM(COALESCE(da.mark_value, 0)) OVER (ORDER BY ds.date)::numeric AS cumulative_mark_value,
    SUM(COALESCE(da.ask_value, 0)) OVER (ORDER BY ds.date)::numeric AS cumulative_ask_value,
    SUM(COALESCE(da.realized_value, 0)) OVER (ORDER BY ds.date)::numeric AS cumulative_realized_value,
    SUM(COALESCE(da.cost_value, 0)) OVER (ORDER BY ds.date)::numeric AS cumulative_cost_value,
    SUM(COALESCE(da.total_value, 0)) OVER (ORDER BY ds.date)::numeric AS cumulative_total_value,
    -- Daily values
    COALESCE(da.mark_value, 0)::numeric AS daily_mark_value,
    COALESCE(da.ask_value, 0)::numeric AS daily_ask_value,
    COALESCE(da.realized_value, 0)::numeric AS daily_realized_value,
    COALESCE(da.cost_value, 0)::numeric AS daily_cost_value,
    COALESCE(da.total_value, 0)::numeric AS daily_total_value,
    COALESCE(da.cnt, 0) AS vehicle_count
  FROM date_series ds
  LEFT JOIN daily_aggregates da ON ds.date = da.day
  ORDER BY ds.date;
END;
$$;

GRANT EXECUTE ON FUNCTION get_daily_value_trends(int) TO authenticated;
GRANT EXECUTE ON FUNCTION get_daily_value_trends(int) TO service_role;

-- =============================================================================
-- DAILY SALES TRENDS (by sale_date)
-- Returns daily sales volume and count
-- =============================================================================

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
      AND sale_price > 500  -- Exclude bad data
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

-- =============================================================================
-- DAILY IMPORT TRENDS (by created_at)
-- Returns import velocity - how much value is being added
-- =============================================================================

CREATE OR REPLACE FUNCTION get_daily_import_trends(days_back int DEFAULT 30)
RETURNS TABLE (
  date date,
  import_count bigint,
  import_value numeric,
  avg_import_value numeric,
  cumulative_import_count bigint,
  cumulative_import_value numeric
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
  daily_imports AS (
    SELECT
      created_at::date AS day,
      COUNT(*) AS cnt,
      SUM(
        COALESCE(
          NULLIF(sale_price, 0),
          NULLIF(asking_price, 0),
          NULLIF(current_value, 0),
          NULLIF(purchase_price, 0),
          0
        )
      ) AS value,
      AVG(
        COALESCE(
          NULLIF(sale_price, 0),
          NULLIF(asking_price, 0),
          NULLIF(current_value, 0),
          NULLIF(purchase_price, 0),
          0
        )
      ) FILTER (WHERE COALESCE(sale_price, asking_price, current_value, purchase_price) > 0) AS avg_value
    FROM vehicles
    WHERE is_public = true
      AND status != 'pending'
      AND created_at::date >= CURRENT_DATE - (days_back || ' days')::interval
    GROUP BY created_at::date
  )
  SELECT
    ds.date,
    COALESCE(da.cnt, 0) AS import_count,
    COALESCE(da.value, 0)::numeric AS import_value,
    COALESCE(da.avg_value, 0)::numeric AS avg_import_value,
    SUM(COALESCE(da.cnt, 0)) OVER (ORDER BY ds.date)::bigint AS cumulative_import_count,
    SUM(COALESCE(da.value, 0)) OVER (ORDER BY ds.date)::numeric AS cumulative_import_value
  FROM date_series ds
  LEFT JOIN daily_imports da ON ds.date = da.day
  ORDER BY ds.date;
END;
$$;

GRANT EXECUTE ON FUNCTION get_daily_import_trends(int) TO authenticated;
GRANT EXECUTE ON FUNCTION get_daily_import_trends(int) TO service_role;

-- =============================================================================
-- AUCTION OUTCOME TRENDS
-- Returns daily sold vs unsold (reserve_not_met) counts
-- =============================================================================

CREATE OR REPLACE FUNCTION get_auction_outcome_trends(days_back int DEFAULT 30)
RETURNS TABLE (
  date date,
  sold_count bigint,
  sold_value numeric,
  unsold_count bigint,
  unsold_high_bid_value numeric,
  sold_ratio numeric
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
  daily_outcomes AS (
    SELECT
      COALESCE(sale_date::date, created_at::date) AS day,
      COUNT(*) FILTER (WHERE auction_outcome = 'sold' OR (sale_price > 500 AND auction_outcome IS NULL)) AS sold,
      SUM(sale_price) FILTER (WHERE auction_outcome = 'sold' OR (sale_price > 500 AND auction_outcome IS NULL)) AS sold_val,
      COUNT(*) FILTER (WHERE auction_outcome = 'reserve_not_met') AS unsold,
      SUM(high_bid) FILTER (WHERE auction_outcome = 'reserve_not_met' AND high_bid > 0) AS unsold_bid_val
    FROM vehicles
    WHERE is_public = true
      AND status != 'pending'
      AND auction_outcome IS NOT NULL
      AND COALESCE(sale_date::date, created_at::date) >= CURRENT_DATE - (days_back || ' days')::interval
    GROUP BY COALESCE(sale_date::date, created_at::date)
  )
  SELECT
    ds.date,
    COALESCE(da.sold, 0) AS sold_count,
    COALESCE(da.sold_val, 0)::numeric AS sold_value,
    COALESCE(da.unsold, 0) AS unsold_count,
    COALESCE(da.unsold_bid_val, 0)::numeric AS unsold_high_bid_value,
    CASE
      WHEN COALESCE(da.sold, 0) + COALESCE(da.unsold, 0) > 0
      THEN (COALESCE(da.sold, 0)::numeric / (COALESCE(da.sold, 0) + COALESCE(da.unsold, 0))::numeric)
      ELSE NULL
    END AS sold_ratio
  FROM date_series ds
  LEFT JOIN daily_outcomes da ON ds.date = da.day
  ORDER BY ds.date;
END;
$$;

GRANT EXECUTE ON FUNCTION get_auction_outcome_trends(int) TO authenticated;
GRANT EXECUTE ON FUNCTION get_auction_outcome_trends(int) TO service_role;

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON FUNCTION get_daily_value_trends(int) IS
'Returns daily and cumulative value breakdowns (mark, ask, realized, cost) for charting.';

COMMENT ON FUNCTION get_daily_sales_trends(int) IS
'Returns daily sales counts and volumes by sale_date for sales trend charting.';

COMMENT ON FUNCTION get_daily_import_trends(int) IS
'Returns daily import counts and values by created_at for velocity charting.';

COMMENT ON FUNCTION get_auction_outcome_trends(int) IS
'Returns daily sold vs unsold counts for auction outcome ratio charting.';
