-- Portfolio Analytics RPC Functions
-- Server-side aggregations for accurate analytics (no row limits)
--
-- Deploy: Run this in Supabase SQL Editor or via migration

-- =============================================================================
-- CORE PORTFOLIO VALUE CALCULATION
-- Uses the same price priority as frontend: sale > winning_bid > high_bid > asking > current_value > purchase > msrp
-- =============================================================================

CREATE OR REPLACE FUNCTION calculate_portfolio_value_server()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH vehicle_values AS (
    SELECT
      id,
      -- For "reserve_not_met" auctions, only use non-sale prices (current_value, purchase_price)
      -- Don't count their high_bid as portfolio value since the sale didn't happen
      CASE
        WHEN auction_outcome = 'reserve_not_met' OR auction_outcome = 'reserve_not_met' THEN
          COALESCE(
            NULLIF(current_value, 0),
            NULLIF(purchase_price, 0),
            0
          )
        ELSE
          COALESCE(
            NULLIF(sale_price, 0),
            NULLIF(winning_bid, 0),
            NULLIF(high_bid, 0),
            NULLIF(asking_price, 0),
            NULLIF(current_value, 0),
            NULLIF(purchase_price, 0),
            NULLIF(msrp, 0),
            0
          )
      END as best_price,
      is_for_sale,
      sale_date,
      created_at,
      current_value,
      purchase_price,
      asking_price,
      sale_price,
      auction_outcome
    FROM vehicles
    WHERE is_public = true
      AND status != 'pending'
      -- Exclude vehicles with suspiciously low "sale" prices (likely bad data)
      AND NOT (
        auction_outcome = 'sold'
        AND COALESCE(sale_price, winning_bid, high_bid, 0) > 0
        AND COALESCE(sale_price, winning_bid, high_bid) < 500
      )
  ),
  stats AS (
    SELECT
      COUNT(*) as total_vehicles,
      COUNT(*) FILTER (WHERE best_price > 0) as vehicles_with_value,
      SUM(best_price) FILTER (WHERE best_price > 0) as total_value,
      AVG(best_price) FILTER (WHERE best_price > 0) as avg_value,
      COUNT(*) FILTER (WHERE is_for_sale = true) as for_sale_count,
      SUM(current_value) FILTER (WHERE current_value > 0) as value_mark_total,
      SUM(purchase_price) FILTER (WHERE purchase_price > 0) as value_cost_total,
      SUM(asking_price) FILTER (WHERE is_for_sale = true AND asking_price > 0) as value_ask_total,
      SUM(sale_price) FILTER (WHERE sale_price > 0) as value_realized_total,
      -- Today's metrics
      COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) as vehicles_added_today,
      SUM(best_price) FILTER (WHERE created_at >= CURRENT_DATE AND best_price > 0) as value_imported_today,
      -- 24h metrics
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') as vehicles_added_24h,
      SUM(best_price) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours' AND best_price > 0) as value_imported_24h,
      -- 7d metrics
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as vehicles_added_7d,
      SUM(best_price) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days' AND best_price > 0) as value_imported_7d
    FROM vehicle_values
  ),
  sales_today AS (
    SELECT
      COUNT(*) as sales_count,
      COALESCE(SUM(sale_price), 0) as sales_volume
    FROM vehicles
    WHERE is_public = true
      AND status != 'pending'
      AND sale_date >= CURRENT_DATE
      AND sale_price > 0
      -- Exclude bad data: "sold" with prices under $500 are likely reserve-not-met
      AND sale_price >= 500
      -- Only count actual sales, not reserve_not_met
      AND (auction_outcome IS NULL OR auction_outcome NOT IN ('reserve_not_met', 'reserve_not_met'))
  ),
  active_auctions AS (
    SELECT COUNT(DISTINCT vehicle_id) as count
    FROM external_listings
    WHERE end_date > NOW()
  )
  SELECT jsonb_build_object(
    'total_vehicles', s.total_vehicles,
    'vehicles_with_value', s.vehicles_with_value,
    'total_value', COALESCE(s.total_value, 0),
    'avg_value', COALESCE(ROUND(s.avg_value::numeric, 2), 0),
    'for_sale_count', s.for_sale_count,
    'active_auctions', COALESCE(a.count, 0),
    'sales_count_today', st.sales_count,
    'sales_volume_today', st.sales_volume,
    'vehicles_added_today', s.vehicles_added_today,
    'value_imported_today', COALESCE(s.value_imported_today, 0),
    'vehicles_added_24h', s.vehicles_added_24h,
    'value_imported_24h', COALESCE(s.value_imported_24h, 0),
    'vehicles_added_7d', s.vehicles_added_7d,
    'value_imported_7d', COALESCE(s.value_imported_7d, 0),
    'value_mark_total', COALESCE(s.value_mark_total, 0),
    'value_cost_total', COALESCE(s.value_cost_total, 0),
    'value_ask_total', COALESCE(s.value_ask_total, 0),
    'value_realized_total', COALESCE(s.value_realized_total, 0),
    'calculated_at', NOW()
  ) INTO result
  FROM stats s
  CROSS JOIN sales_today st
  LEFT JOIN active_auctions a ON true;

  RETURN result;
END;
$$;

-- Grant execute to authenticated users and service role
GRANT EXECUTE ON FUNCTION calculate_portfolio_value_server() TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_portfolio_value_server() TO service_role;

-- =============================================================================
-- ORGANIZATION PORTFOLIO VALUE (fixes the INNER JOIN bug)
-- =============================================================================

CREATE OR REPLACE FUNCTION calculate_organization_value(org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH org_vehicles AS (
    SELECT
      ov.relationship_type,
      v.id as vehicle_id,
      COALESCE(
        NULLIF(v.sale_price, 0),
        NULLIF(v.winning_bid, 0),
        NULLIF(v.high_bid, 0),
        NULLIF(v.asking_price, 0),
        NULLIF(v.current_value, 0),
        NULLIF(v.purchase_price, 0),
        NULLIF(v.msrp, 0),
        0
      ) as best_price
    FROM organization_vehicles ov
    LEFT JOIN vehicles v ON v.id = ov.vehicle_id  -- LEFT JOIN, not INNER!
    WHERE ov.organization_id = org_id
  )
  SELECT jsonb_build_object(
    'vehicle_count', COUNT(*),
    'in_stock_count', COUNT(*) FILTER (WHERE relationship_type = 'in_stock'),
    'sold_count', COUNT(*) FILTER (WHERE relationship_type = 'sold'),
    'total_value', COALESCE(SUM(best_price), 0),
    'vehicles_with_value', COUNT(*) FILTER (WHERE best_price > 0),
    'avg_value', COALESCE(ROUND(AVG(best_price) FILTER (WHERE best_price > 0)::numeric, 2), 0),
    'calculated_at', NOW()
  ) INTO result
  FROM org_vehicles;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_organization_value(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_organization_value(uuid) TO service_role;

-- =============================================================================
-- ANALYTICS AUDIT LOG TABLE (for Ralph to store learnings)
-- =============================================================================

CREATE TABLE IF NOT EXISTS analytics_audit_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT NOW(),
  audit_type text NOT NULL,
  passed_count int DEFAULT 0,
  failed_count int DEFAULT 0,
  critical_issues jsonb DEFAULT '[]'::jsonb,
  warnings jsonb DEFAULT '[]'::jsonb,
  recommendations jsonb DEFAULT '[]'::jsonb,
  raw_results jsonb DEFAULT '{}'::jsonb
);

-- Index for querying recent audits
CREATE INDEX IF NOT EXISTS idx_analytics_audit_log_created_at ON analytics_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_audit_log_audit_type ON analytics_audit_log(audit_type);

-- Enable RLS
ALTER TABLE analytics_audit_log ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role can manage analytics_audit_log"
  ON analytics_audit_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- MATERIALIZED VIEW FOR DASHBOARD STATS (optional - refreshed periodically)
-- =============================================================================

-- Drop if exists to allow clean recreation
DROP MATERIALIZED VIEW IF EXISTS portfolio_stats_mv;

CREATE MATERIALIZED VIEW portfolio_stats_mv AS
SELECT
  COUNT(*) as total_vehicles,
  COUNT(*) FILTER (WHERE is_public = true AND status != 'pending') as public_vehicles,
  SUM(
    CASE
      -- For reserve_not_met, only use ownership-based values (not auction bids)
      WHEN auction_outcome IN ('reserve_not_met', 'reserve_not_met') THEN
        COALESCE(NULLIF(current_value, 0), NULLIF(purchase_price, 0), 0)
      -- For suspicious "sold" with low prices, exclude from value
      WHEN auction_outcome = 'sold' AND COALESCE(sale_price, winning_bid, high_bid, 0) < 500 THEN 0
      -- Normal case
      ELSE
        COALESCE(
          NULLIF(sale_price, 0),
          NULLIF(winning_bid, 0),
          NULLIF(high_bid, 0),
          NULLIF(asking_price, 0),
          NULLIF(current_value, 0),
          NULLIF(purchase_price, 0),
          NULLIF(msrp, 0),
          0
        )
    END
  ) FILTER (WHERE is_public = true AND status != 'pending') as total_value,
  COUNT(*) FILTER (WHERE is_for_sale = true AND is_public = true) as for_sale_count,
  COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE AND is_public = true) as added_today,
  -- Track bad data for monitoring
  COUNT(*) FILTER (
    WHERE auction_outcome = 'sold'
    AND COALESCE(sale_price, winning_bid, high_bid, 0) < 500
    AND is_public = true
  ) as suspicious_sales_count,
  NOW() as refreshed_at
FROM vehicles;

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_stats_mv_singleton ON portfolio_stats_mv((1));

-- Function to refresh the materialized view
CREATE OR REPLACE FUNCTION refresh_portfolio_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY portfolio_stats_mv;
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_portfolio_stats() TO service_role;

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON FUNCTION calculate_portfolio_value_server() IS
'Server-side portfolio value calculation. No row limits. Uses same price priority as frontend.';

COMMENT ON FUNCTION calculate_organization_value(uuid) IS
'Calculate organization portfolio value using LEFT JOIN (fixes the INNER JOIN bug that excluded vehicles without current_value).';

COMMENT ON TABLE analytics_audit_log IS
'Stores results from ralph-analytics-auditor for hypothesis-test-learn loop.';

COMMENT ON MATERIALIZED VIEW portfolio_stats_mv IS
'Pre-computed portfolio stats. Refresh with refresh_portfolio_stats() or REFRESH MATERIALIZED VIEW CONCURRENTLY portfolio_stats_mv;';
