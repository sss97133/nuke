/**
 * API v1 - Market Trends Endpoint
 *
 * Price trends by make/model/year range/time period.
 * GET /v1/market/trends?make=Porsche&model=911&period=90d
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { authenticateRequest, logApiUsage } from "../_shared/apiKeyAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const VALID_PERIODS = ['30d', '90d', '1y', '3y'];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Authenticate
    const auth = await authenticateRequest(req, supabase, { endpoint: 'market-trends' });
    if (auth.error || !auth.userId) {
      return jsonResponse({ error: auth.error || "Authentication required" }, auth.status || 401);
    }
    const userId = auth.userId;

    const url = new URL(req.url);
    const make = url.searchParams.get("make");
    const model = url.searchParams.get("model") || null;
    const yearFrom = url.searchParams.get("year_from") ? parseInt(url.searchParams.get("year_from")!, 10) : null;
    const yearTo = url.searchParams.get("year_to") ? parseInt(url.searchParams.get("year_to")!, 10) : null;
    const period = url.searchParams.get("period") || "90d";

    if (!make) {
      return jsonResponse({ error: "Parameter 'make' is required" }, 400);
    }

    if (!VALID_PERIODS.includes(period)) {
      return jsonResponse({ error: `Invalid period. Must be one of: ${VALID_PERIODS.join(', ')}` }, 400);
    }

    // Call the RPC function
    const { data: trends, error: rpcError } = await supabase.rpc("get_market_trends", {
      p_make: make,
      p_model: model,
      p_year_from: yearFrom,
      p_year_to: yearTo,
      p_period: period,
    });

    if (rpcError) {
      console.error("Market trends RPC error:", JSON.stringify(rpcError));
      return jsonResponse({ error: "Failed to fetch market trends", details: rpcError.message || JSON.stringify(rpcError) }, 500);
    }

    // Compute summary stats across all periods
    const nonEmptyPeriods = (trends || []).filter((t: any) => t.sale_count > 0);
    const totalSales = nonEmptyPeriods.reduce((sum: number, t: any) => sum + Number(t.sale_count), 0);

    let summary = null;
    if (totalSales > 0) {
      const allAvgs = nonEmptyPeriods.map((t: any) => Number(t.avg_price));
      const firstAvg = allAvgs[0];
      const lastAvg = allAvgs[allAvgs.length - 1];
      const priceChange = lastAvg && firstAvg ? ((lastAvg - firstAvg) / firstAvg * 100) : 0;

      summary = {
        total_sales: totalSales,
        periods_with_data: nonEmptyPeriods.length,
        overall_avg_price: Math.round(nonEmptyPeriods.reduce((s: number, t: any) => s + Number(t.avg_price) * Number(t.sale_count), 0) / totalSales),
        price_change_pct: Math.round(priceChange * 100) / 100,
        trend_direction: priceChange > 2 ? 'rising' : priceChange < -2 ? 'falling' : 'stable',
      };
    }

    const response = {
      data: {
        query: {
          make,
          model,
          year_from: yearFrom,
          year_to: yearTo,
          period,
        },
        summary,
        periods: trends || [],
      },
    };

    await logApiUsage(supabase, userId, "market-trends", "get");

    return jsonResponse(response);

  } catch (error: any) {
    console.error("API error:", error);
    const details = error instanceof Error ? error.message : (typeof error === 'object' ? JSON.stringify(error) : String(error));
    return jsonResponse({ error: "Internal server error", details }, 500);
  }
});

// authenticateRequest, logApiUsage imported from _shared/apiKeyAuth.ts
