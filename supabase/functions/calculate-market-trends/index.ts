/**
 * CALCULATE MARKET TRENDS
 * Aggregates sentiment, demand signals, and price trends from AI-analyzed comments.
 * Uses canonical makes (post-normalization) and removes limit truncation.
 *
 * POST /functions/v1/calculate-market-trends
 * Body: {
 *   "platform"?: string,  // default 'all'
 *   "make"?: string        // limit to specific make
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const targetPlatform = body.platform || 'all';
    const targetMake = body.make || null;

    // Use dedicated RPC with its own 30s statement timeout (execute_sql hits default 8s timeout).
    // Aggregates 127k+ comment_discoveries by make using only scalar columns (~12s).
    const { data: makeAggregates, error: aggError } = await supabase.rpc(
      'compute_market_trend_aggregates',
      { p_make: targetMake || null }
    );

    if (aggError) throw aggError;

    const aggregates = (makeAggregates || []) as any[];
    console.log(`[calculate-market-trends] Processing ${aggregates.length} makes from server-side aggregation`);

    // Set period_start for proper upsert deduplication
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // Convert server-side aggregates to market_trends records
    const trendRecords = aggregates.map((row: any) => {
      const total = Number(row.total_count);

      return {
        make: row.make,
        model: null,
        platform: targetPlatform,
        vehicle_count: total,
        analysis_count: total,
        // JSONB-based signal percentages skipped (too slow without GIN index on 127k rows)
        demand_high_pct: null,
        demand_moderate_pct: null,
        demand_low_pct: null,
        price_rising_pct: null,
        price_stable_pct: null,
        price_declining_pct: null,
        rarity_rare_pct: null,
        rarity_moderate_pct: null,
        rarity_common_pct: null,
        avg_sentiment_score: row.avg_sentiment != null ? Number(Number(row.avg_sentiment).toFixed(2)) : null,
        sentiment_samples: Number(row.sentiment_samples),
        avg_sale_price: row.avg_price != null ? Number(Number(row.avg_price).toFixed(2)) : null,
        min_sale_price: row.min_price != null ? Number(row.min_price) : null,
        max_sale_price: row.max_price != null ? Number(row.max_price) : null,
        median_sale_price: null, // percentile_cont too expensive at 127k+ rows
        top_discussion_themes: null,
        top_community_concerns: null,
        period_start: periodStart,
        calculated_at: now.toISOString(),
      };
    });

    // Upsert to market_trends
    const { error: upsertError } = await supabase
      .from("market_trends")
      .upsert(trendRecords, {
        onConflict: 'make,model,platform,period_start',
        ignoreDuplicates: false
      });

    if (upsertError) throw upsertError;

    // Get hot makes for response
    const { data: hotMakes } = await supabase
      .from("market_trends")
      .select("make, analysis_count, demand_high_pct, avg_sentiment_score, avg_sale_price")
      .is("model", null)
      .eq("period_start", periodStart)
      .order("demand_high_pct", { ascending: false, nullsFirst: false })
      .limit(10);

    return new Response(JSON.stringify({
      success: true,
      makes_analyzed: aggregates.length,
      total_discoveries: aggregates.reduce((sum: number, r: any) => sum + Number(r.total_count), 0),
      records_upserted: trendRecords.length,
      period_start: periodStart,
      hot_makes: hotMakes,
    }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    console.error("[calculate-market-trends] Error:", e);
    return new Response(JSON.stringify({ error: "Market trend calculation failed", detail: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
