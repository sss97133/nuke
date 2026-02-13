/**
 * API v1 - Market Trends Endpoint
 *
 * Price trends by make/model/year range/time period.
 * GET /v1/market/trends?make=Porsche&model=911&period=90d
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

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
    const { userId, error: authError } = await authenticateRequest(req, supabase);
    if (authError || !userId) {
      return jsonResponse({ error: authError || "Authentication required" }, 401);
    }

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

async function authenticateRequest(req: Request, supabase: any): Promise<{ userId: string | null; isServiceRole?: boolean; error?: string }> {
  const authHeader = req.headers.get("Authorization");
  const apiKey = req.headers.get("X-API-Key");

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const altServiceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
    if ((serviceRoleKey && token === serviceRoleKey) || (altServiceRoleKey && token === altServiceRoleKey)) {
      return { userId: "service-role", isServiceRole: true };
    }
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (user && !error) {
      return { userId: user.id };
    }
  }

  if (apiKey) {
    const rawKey = apiKey.startsWith('nk_live_') ? apiKey.slice(8) : apiKey;
    const keyHash = await hashApiKey(rawKey);
    const { data: keyData, error } = await supabase
      .from("api_keys")
      .select("user_id, scopes, is_active, rate_limit_remaining, expires_at")
      .eq("key_hash", keyHash)
      .eq("is_active", true)
      .maybeSingle();

    if (keyData && !error) {
      if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
        return { userId: null, error: "API key has expired" };
      }
      if (keyData.rate_limit_remaining !== null && keyData.rate_limit_remaining <= 0) {
        return { userId: null, error: "Rate limit exceeded" };
      }
      await supabase
        .from("api_keys")
        .update({
          rate_limit_remaining: keyData.rate_limit_remaining !== null ? keyData.rate_limit_remaining - 1 : null,
          last_used_at: new Date().toISOString(),
        })
        .eq("key_hash", keyHash);
      return { userId: keyData.user_id };
    }
  }

  return { userId: null, error: "Invalid or missing authentication" };
}

async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return 'sha256_' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function logApiUsage(supabase: any, userId: string, resource: string, action: string, resourceId?: string) {
  try {
    await supabase.from("api_usage_logs").insert({
      user_id: userId,
      resource,
      action,
      resource_id: resourceId,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Failed to log API usage:", e);
  }
}
