/**
 * VALUE TRENDS - Historical time series for value breakdowns
 *
 * Returns daily aggregated data for:
 * - Realized value (sale_price) - cumulative and daily
 * - Ask value (asking_price from active listings)
 * - Mark value (current_value)
 * - Cost value (purchase_price)
 * - Total market value over time
 * - Sold vs unsold auction outcomes
 * - Import velocity (value added per period)
 *
 * Query params:
 *   ?period=30d|90d|1y (default: 30d)
 *
 * GET /functions/v1/value-trends
 * GET /functions/v1/value-trends?period=90d
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const period = url.searchParams.get("period") || "30d";

    // Calculate date range based on period
    let daysBack = 30;
    if (period === "90d") daysBack = 90;
    else if (period === "1y") daysBack = 365;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Run all queries in parallel
    const [
      dailyValueRes,
      dailySalesRes,
      dailyImportsRes,
      auctionOutcomesRes,
      currentTotalsRes,
    ] = await Promise.all([
      // Daily value breakdown by created_at (for cumulative trends)
      supabase.rpc('get_daily_value_trends', { days_back: daysBack }),

      // Daily sales volume (by sale_date)
      supabase.rpc('get_daily_sales_trends', { days_back: daysBack }),

      // Daily imports (by created_at)
      supabase.rpc('get_daily_import_trends', { days_back: daysBack }),

      // Auction outcomes over time
      supabase.rpc('get_auction_outcome_trends', { days_back: daysBack }),

      // Current totals for reference
      supabase.rpc('calculate_portfolio_value_server'),
    ]);

    const result = {
      period,
      days_back: daysBack,
      generated_at: new Date().toISOString(),

      // Current snapshot
      current_totals: currentTotalsRes.data || {},

      // Time series data
      trends: {
        // Daily cumulative values (mark, ask, realized, cost)
        daily_values: dailyValueRes.data || [],

        // Daily sales volume and count
        daily_sales: dailySalesRes.data || [],

        // Import velocity
        daily_imports: dailyImportsRes.data || [],

        // Auction outcomes (sold vs unsold)
        auction_outcomes: auctionOutcomesRes.data || [],
      },
    };

    return new Response(JSON.stringify(result, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    console.error("value-trends error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
