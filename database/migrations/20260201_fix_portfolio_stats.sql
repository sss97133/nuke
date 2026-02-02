-- Fix portfolio stats calculation
-- for_sale_count: Include vehicles with asking_price > 0 (not just is_for_sale=true)
-- active_auctions: Use sale_status='auction_live' from vehicles table

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
      asking_price,
      sale_status,
      sale_date,
      created_at,
      current_value,
      purchase_price,
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
      -- FIX: Count for sale as is_for_sale=true OR (asking_price > 0 AND not sold)
      COUNT(*) FILTER (WHERE
        is_for_sale = true
        OR (asking_price > 0 AND COALESCE(auction_outcome, '') != 'sold' AND COALESCE(sale_status, '') != 'sold')
      ) as for_sale_count,
      -- FIX: Count active auctions using sale_status='auction_live'
      COUNT(*) FILTER (WHERE sale_status = 'auction_live') as active_auctions,
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
  )
  SELECT jsonb_build_object(
    'total_vehicles', s.total_vehicles,
    'vehicles_with_value', s.vehicles_with_value,
    'total_value', COALESCE(s.total_value, 0),
    'avg_value', COALESCE(ROUND(s.avg_value::numeric, 2), 0),
    'for_sale_count', s.for_sale_count,
    'active_auctions', s.active_auctions,
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
  CROSS JOIN sales_today st;

  RETURN result;
END;
$$;

-- Grant execute to authenticated users and service role
GRANT EXECUTE ON FUNCTION calculate_portfolio_value_server() TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_portfolio_value_server() TO service_role;
