/**
 * AUCTION TRENDS STATS v2 - Market intelligence via SQL aggregation
 *
 * Calls get_auction_trends_v2() which does all aggregation server-side.
 * Fixes: 1000-row limit bug, bid artifact pollution, auction/listing separation.
 * Adds depth: platform sell-through, segment leaders, price distribution,
 *   estimate accuracy, supply/demand balance.
 *
 * GET /functions/v1/auction-trends-stats
 * POST /functions/v1/auction-trends-stats (with optional { days: number })
 */

import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    let days = 30;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        days = body?.days ?? 30;
      } catch {
        // Use default
      }
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data, error } = await supabase.rpc("get_auction_trends_v2", {
      p_lookback_days: days,
    });

    if (error) throw error;

    return new Response(JSON.stringify(data, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("Error in auction-trends-stats:", e);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
