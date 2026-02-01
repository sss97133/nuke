import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";
import { corsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // Get database URL from environment
  const dbUrl = Deno.env.get("SUPABASE_DB_URL") || Deno.env.get("DATABASE_URL");

  if (!dbUrl) {
    return new Response(JSON.stringify({
      success: false,
      error: "No database URL configured. Set SUPABASE_DB_URL in edge function secrets."
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  const sql = postgres(dbUrl, { max: 1 });
  const results: string[] = [];
  const errors: string[] = [];

  try {
    // Create the portfolio value RPC
    await sql`
CREATE OR REPLACE FUNCTION calculate_portfolio_value_server()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
  result jsonb;
BEGIN
  WITH vehicle_values AS (
    SELECT
      id,
      COALESCE(
        NULLIF(sale_price, 0),
        NULLIF(winning_bid, 0),
        NULLIF(high_bid, 0),
        NULLIF(asking_price, 0),
        NULLIF(current_value, 0),
        NULLIF(purchase_price, 0),
        NULLIF(msrp, 0),
        0
      ) as best_price,
      is_for_sale,
      sale_date,
      created_at,
      current_value,
      purchase_price,
      asking_price,
      sale_price
    FROM vehicles
    WHERE is_public = true
      AND status != 'pending'
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
      COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) as vehicles_added_today,
      SUM(best_price) FILTER (WHERE created_at >= CURRENT_DATE AND best_price > 0) as value_imported_today,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') as vehicles_added_24h,
      SUM(best_price) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours' AND best_price > 0) as value_imported_24h,
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
$fn$;
    `;
    results.push("Created calculate_portfolio_value_server()");

    // Grant permissions
    await sql`GRANT EXECUTE ON FUNCTION calculate_portfolio_value_server() TO authenticated`;
    await sql`GRANT EXECUTE ON FUNCTION calculate_portfolio_value_server() TO service_role`;
    results.push("Granted execute permissions");

    // Create organization value function
    await sql`
CREATE OR REPLACE FUNCTION calculate_organization_value(org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
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
    LEFT JOIN vehicles v ON v.id = ov.vehicle_id
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
$fn$;
    `;
    results.push("Created calculate_organization_value(uuid)");

    await sql`GRANT EXECUTE ON FUNCTION calculate_organization_value(uuid) TO authenticated`;
    await sql`GRANT EXECUTE ON FUNCTION calculate_organization_value(uuid) TO service_role`;
    results.push("Granted execute permissions for org function");

    // Create analytics audit log table
    await sql`
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
)
    `;
    results.push("Created analytics_audit_log table");

    // Create platform revenue RPC
    await sql`
CREATE OR REPLACE FUNCTION calculate_platform_revenue()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
  result jsonb;
BEGIN
  WITH platform_sales AS (
    SELECT
      LOWER(REPLACE(REPLACE(platform, '-', '_'), ' ', '_')) as platform_normalized,
      platform as platform_original,
      COUNT(*) as total_listings,
      COUNT(*) FILTER (WHERE listing_status ILIKE '%sold%' OR (final_price > 0 AND listing_status NOT ILIKE '%active%')) as sold_count,
      COALESCE(SUM(final_price) FILTER (WHERE listing_status ILIKE '%sold%' OR (final_price > 0 AND listing_status NOT ILIKE '%active%')), 0) as sales_volume,
      COALESCE(SUM(bid_count), 0) as total_bids,
      COALESCE(AVG(final_price) FILTER (WHERE final_price > 0), 0) as avg_sale_price,
      MAX(final_price) as highest_sale,
      COUNT(*) FILTER (WHERE end_date > NOW()) as live_auctions
    FROM external_listings
    WHERE platform IS NOT NULL
    GROUP BY platform
  ),
  with_revenue AS (
    SELECT
      platform_normalized,
      platform_original,
      total_listings,
      sold_count,
      sales_volume,
      total_bids,
      avg_sale_price,
      highest_sale,
      live_auctions,
      -- CITED COMMISSION RATES (buyer premium only, excludes listing fees)
      -- BaT: 5% buyer premium, $0 seller fee [bringatrailer.com/2024/01/26/bat-site-update]
      -- C&B: 5% buyer premium as of Feb 2025 [theautopian.com/cars-bids-raises-its-buyer-fees]
      -- Note: Listing fees ($99-$2500) not included in percentage calc
      CASE platform_normalized
        WHEN 'bat' THEN 0.05              -- 5% buyer premium only (no seller fee)
        WHEN 'bring_a_trailer' THEN 0.05  -- same as bat
        WHEN 'cars_and_bids' THEN 0.05    -- 5% as of Feb 2025 (was 4.5%)
        WHEN 'pcarmarket' THEN 0.05       -- ~5% buyer premium
        WHEN 'collecting_cars' THEN 0.06  -- 6% buyer premium
        WHEN 'broad_arrow' THEN 0.12      -- 12% buyer premium
        WHEN 'rm_sothebys' THEN 0.13      -- 13% buyer premium + seller negotiated
        WHEN 'rmsothebys' THEN 0.13
        WHEN 'gooding' THEN 0.12          -- 12% buyer premium
        WHEN 'bonhams' THEN 0.15          -- ~15% buyer premium
        WHEN 'mecum' THEN 0.10            -- 10% buyer premium
        WHEN 'barrett_jackson' THEN 0.10  -- 10% buyer premium
        WHEN 'sbx' THEN 0.04              -- 4% buyer premium
        WHEN 'hemmings' THEN 0.00         -- classified, no premium
        WHEN 'ebay_motors' THEN 0.00      -- fees are flat/capped
        ELSE 0.05
      END as commission_rate
    FROM platform_sales
  )
  SELECT jsonb_build_object(
    'platforms', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'platform', platform_original,
          'total_listings', total_listings,
          'sold_count', sold_count,
          'sales_volume', sales_volume,
          'estimated_revenue', ROUND((sales_volume * commission_rate)::numeric, 2),
          'commission_rate', commission_rate,
          'avg_sale_price', ROUND(avg_sale_price::numeric, 2),
          'highest_sale', highest_sale,
          'live_auctions', live_auctions,
          'total_bids', total_bids
        )
        ORDER BY sales_volume * commission_rate DESC
      )
      FROM with_revenue
    ),
    'totals', (
      SELECT jsonb_build_object(
        'total_listings', SUM(total_listings),
        'total_sold', SUM(sold_count),
        'total_volume', SUM(sales_volume),
        'total_estimated_revenue', ROUND(SUM(sales_volume * commission_rate)::numeric, 2),
        'total_bids', SUM(total_bids),
        'total_live_auctions', SUM(live_auctions)
      )
      FROM with_revenue
    ),
    'calculated_at', NOW()
  ) INTO result;
  RETURN result;
END;
$fn$;
    `;
    results.push("Created calculate_platform_revenue()");

    await sql`GRANT EXECUTE ON FUNCTION calculate_platform_revenue() TO authenticated`;
    await sql`GRANT EXECUTE ON FUNCTION calculate_platform_revenue() TO service_role`;
    results.push("Granted execute permissions for platform revenue");

    // Test the functions
    const testResult = await sql`SELECT calculate_portfolio_value_server() as result`;
    results.push(`Portfolio stats: ${JSON.stringify(testResult[0]?.result)}`);

    const platformResult = await sql`SELECT calculate_platform_revenue() as result`;
    results.push(`Platform revenue: ${JSON.stringify(platformResult[0]?.result)}`);

  } catch (e: any) {
    errors.push(e.message || String(e));
  } finally {
    await sql.end();
  }

  return new Response(JSON.stringify({
    success: errors.length === 0,
    results,
    errors: errors.length > 0 ? errors : undefined
  }, null, 2), {
    status: errors.length === 0 ? 200 : 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
});
