/**
 * update-exchange-prices
 *
 * Runs the exchange pricing cycle. Called by cron every 15 minutes.
 * Also callable manually for individual steps.
 *
 * POST /functions/v1/update-exchange-prices
 * Body (optional): {
 *   "action": "full_cycle" | "update_prices" | "update_nav" | "mark_to_market"
 * }
 *
 * Cron: every 15 min — supabase/functions/.cron (or pg_cron via SQL)
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

  // Service-role only — no user auth needed
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let action = "full_cycle";
  if (req.method === "POST" && req.headers.get("content-type")?.includes("application/json")) {
    try {
      const body = await req.json();
      if (body?.action) action = body.action;
    } catch {
      // ignore parse errors, default to full_cycle
    }
  }

  try {
    let result: Record<string, unknown> = {};

    if (action === "full_cycle") {
      const { data, error } = await supabase.rpc("run_exchange_pricing_cycle");
      if (error) throw error;
      result = { action, ...(data as object) };

    } else if (action === "update_prices") {
      const { data, error } = await supabase.rpc("update_vehicle_offering_prices");
      if (error) throw error;
      result = { action, rows_updated: Array.isArray(data) ? data.length : 0, updates: data };

    } else if (action === "update_nav") {
      const { data, error } = await supabase.rpc("update_market_nav");
      if (error) throw error;
      result = { action, rows_updated: Array.isArray(data) ? data.length : 0, updates: data };

    } else if (action === "mark_to_market") {
      const { data, error } = await supabase.rpc("mark_to_market");
      if (error) throw error;
      result = { action, rows_updated: Array.isArray(data) ? data.length : 0, updates: data };

    } else {
      return new Response(
        JSON.stringify({ error: `Unknown action: ${action}. Use: full_cycle | update_prices | update_nav | mark_to_market` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, ...result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("update-exchange-prices error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
