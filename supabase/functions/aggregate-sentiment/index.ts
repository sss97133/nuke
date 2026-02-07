/**
 * AGGREGATE SENTIMENT
 *
 * Reads comment_discoveries + bat_comments.sentiment_score to compute
 * weighted sentiment per vehicle, writes to vehicle_sentiment.
 * Also aggregates by make into market_trends.
 *
 * POST /functions/v1/aggregate-sentiment
 * Body: {
 *   "mode": "batch" | "vehicle" | "market_trends",
 *   "vehicle_id"?: string,     // for vehicle mode
 *   "batch_size"?: number,     // for batch mode, default 100
 *   "offset"?: number          // for batch mode pagination
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const mode = body.mode || "batch";

    let result: any;

    switch (mode) {
      case "vehicle":
        result = await vehicleSentiment(supabase, body.vehicle_id);
        break;
      case "batch":
        result = await batchSentiment(supabase, body.batch_size ?? 100, body.offset ?? 0);
        break;
      case "market_trends":
        result = await marketTrendsSentiment(supabase);
        break;
      default:
        return new Response(
          JSON.stringify({ error: `Unknown mode: ${mode}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    return new Response(JSON.stringify({ success: true, mode, ...result }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[aggregate-sentiment] Error:", e);
    return new Response(JSON.stringify({ error: e.message, stack: e.stack }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/**
 * Compute sentiment for a single vehicle and upsert to vehicle_sentiment
 */
async function vehicleSentiment(supabase: any, vehicleId: string) {
  if (!vehicleId) throw new Error("vehicle_id is required");

  // Get comment_discovery for this vehicle
  const { data: discovery, error: dErr } = await supabase
    .from("comment_discoveries")
    .select("*")
    .eq("vehicle_id", vehicleId)
    .order("discovered_at", { ascending: false })
    .limit(1)
    .single();

  if (dErr && dErr.code !== "PGRST116") throw dErr;

  // Get bat_comments sentiment scores for this vehicle
  const { data: commentScores, error: cErr } = await supabase.rpc("execute_sql", {
    query: `
      SELECT
        count(*) AS comment_count,
        count(*) FILTER (WHERE sentiment_score IS NOT NULL) AS scored_count,
        avg(sentiment_score) FILTER (WHERE sentiment_score IS NOT NULL) AS avg_comment_sentiment,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY sentiment_score)
          FILTER (WHERE sentiment_score IS NOT NULL) AS median_comment_sentiment
      FROM bat_comments
      WHERE vehicle_id = '${vehicleId}'
    `,
  });

  if (cErr) throw cErr;

  const cs = commentScores?.[0] ?? {};
  const raw = discovery?.raw_extraction ?? {};

  // Weighted sentiment: 60% discovery score, 40% comment avg (if both available)
  let finalScore: number | null = null;
  if (discovery?.sentiment_score != null && cs.avg_comment_sentiment != null) {
    finalScore =
      0.6 * Number(discovery.sentiment_score) +
      0.4 * Number(cs.avg_comment_sentiment);
  } else if (discovery?.sentiment_score != null) {
    finalScore = Number(discovery.sentiment_score);
  } else if (cs.avg_comment_sentiment != null) {
    finalScore = Number(cs.avg_comment_sentiment);
  }

  // Build the vehicle_sentiment record
  const record = {
    vehicle_id: vehicleId,
    analyzed_at: new Date().toISOString(),
    comment_count: Number(cs.comment_count ?? 0),
    extraction_version: discovery?.model_used ?? "aggregate-v1",
    overall_sentiment: discovery?.overall_sentiment ?? deriveSentimentLabel(finalScore),
    sentiment_score: finalScore != null ? Math.round(finalScore * 100) / 100 : null,
    mood_keywords: raw.mood_keywords ?? [],
    emotional_themes: raw.emotional_themes ?? [],
    market_demand: raw.market_signals?.demand ?? null,
    market_rarity: raw.market_signals?.rarity ?? null,
    price_trend: raw.market_signals?.price_trend ?? null,
    price_sentiment: raw.price_sentiment ?? null,
    expert_insights: raw.expert_insights ?? null,
    seller_disclosures: raw.seller_disclosures ?? null,
    community_concerns: raw.community_concerns ?? null,
    key_quotes: raw.key_quotes ?? [],
    comparable_sales: raw.comparable_sales ?? null,
    discussion_themes: raw.discussion_themes ?? [],
    notable_discussions: raw.notable_discussions ?? null,
    authenticity_discussion: raw.authenticity_discussion ?? null,
    raw_extraction: raw,
    updated_at: new Date().toISOString(),
  };

  // Upsert to vehicle_sentiment
  const { error: uErr } = await supabase
    .from("vehicle_sentiment")
    .upsert(record, { onConflict: "vehicle_id" });

  if (uErr) throw uErr;

  return { vehicle_id: vehicleId, sentiment_score: finalScore, record };
}

/**
 * Batch mode: process all vehicles with comment_discoveries
 */
async function batchSentiment(supabase: any, batchSize: number, offset: number) {
  // Get vehicles with discoveries that need sentiment
  const { data: vehicles, error: vErr } = await supabase.rpc("execute_sql", {
    query: `
      SELECT DISTINCT cd.vehicle_id
      FROM comment_discoveries cd
      LEFT JOIN vehicle_sentiment vs ON cd.vehicle_id = vs.vehicle_id
      WHERE vs.vehicle_id IS NULL
         OR vs.updated_at < cd.discovered_at
      ORDER BY cd.vehicle_id
      LIMIT ${batchSize}
      OFFSET ${offset}
    `,
  });

  if (vErr) throw vErr;

  const processed: string[] = [];
  const errors: any[] = [];

  const vehicleList = Array.isArray(vehicles) ? vehicles : [];
  for (const row of vehicleList) {
    try {
      await vehicleSentiment(supabase, row.vehicle_id);
      processed.push(row.vehicle_id);
    } catch (e: any) {
      errors.push({ vehicle_id: row.vehicle_id, error: e.message });
    }
  }

  // Count remaining
  const { data: remaining } = await supabase.rpc("execute_sql", {
    query: `
      SELECT count(*) as cnt
      FROM comment_discoveries cd
      LEFT JOIN vehicle_sentiment vs ON cd.vehicle_id = vs.vehicle_id
      WHERE vs.vehicle_id IS NULL OR vs.updated_at < cd.discovered_at
    `,
  });

  return {
    processed: processed.length,
    errors: errors.length,
    error_details: errors.slice(0, 10),
    remaining: remaining?.[0]?.cnt ?? "unknown",
    offset,
    batch_size: batchSize,
  };
}

/**
 * Market trends mode: aggregate sentiment by make into market_trends
 */
async function marketTrendsSentiment(supabase: any) {
  // Aggregate from vehicle_sentiment joined with vehicles
  const { data: makeAggs, error: aErr } = await supabase.rpc("execute_sql", {
    query: `
      WITH make_sentiment AS (
        SELECT
          COALESCE(cm.canonical_name, v.make) AS make,
          vs.sentiment_score,
          vs.market_demand,
          vs.market_rarity,
          vs.price_trend,
          v.sale_price
        FROM vehicle_sentiment vs
        JOIN vehicles v ON vs.vehicle_id = v.id AND v.deleted_at IS NULL
        LEFT JOIN canonical_makes cm ON v.canonical_make_id = cm.id
        WHERE vs.sentiment_score IS NOT NULL
      )
      SELECT
        make,
        count(*) AS analysis_count,
        ROUND(avg(sentiment_score)::numeric, 2) AS avg_sentiment_score,
        count(*) AS sentiment_samples,
        ROUND(count(*) FILTER (WHERE market_demand = 'high')::numeric / GREATEST(count(*), 1) * 100, 2) AS demand_high_pct,
        ROUND(count(*) FILTER (WHERE market_demand = 'moderate')::numeric / GREATEST(count(*), 1) * 100, 2) AS demand_moderate_pct,
        ROUND(count(*) FILTER (WHERE market_demand = 'low')::numeric / GREATEST(count(*), 1) * 100, 2) AS demand_low_pct,
        ROUND(count(*) FILTER (WHERE price_trend = 'rising')::numeric / GREATEST(count(*), 1) * 100, 2) AS price_rising_pct,
        ROUND(count(*) FILTER (WHERE price_trend = 'stable')::numeric / GREATEST(count(*), 1) * 100, 2) AS price_stable_pct,
        ROUND(count(*) FILTER (WHERE price_trend = 'declining')::numeric / GREATEST(count(*), 1) * 100, 2) AS price_declining_pct,
        ROUND(count(*) FILTER (WHERE market_rarity = 'rare')::numeric / GREATEST(count(*), 1) * 100, 2) AS rarity_rare_pct,
        ROUND(count(*) FILTER (WHERE market_rarity = 'moderate')::numeric / GREATEST(count(*), 1) * 100, 2) AS rarity_moderate_pct,
        ROUND(count(*) FILTER (WHERE market_rarity = 'common')::numeric / GREATEST(count(*), 1) * 100, 2) AS rarity_common_pct,
        ROUND(avg(sale_price) FILTER (WHERE sale_price > 0)::numeric, 2) AS avg_sale_price,
        ROUND(min(sale_price) FILTER (WHERE sale_price > 0)::numeric, 2) AS min_sale_price,
        ROUND(max(sale_price) FILTER (WHERE sale_price > 0)::numeric, 2) AS max_sale_price
      FROM make_sentiment
      WHERE make IS NOT NULL
      GROUP BY make
      HAVING count(*) >= 2
      ORDER BY analysis_count DESC
    `,
  });

  if (aErr) throw aErr;

  // Upsert each make into market_trends
  let upserted = 0;
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  for (const row of makeAggs || []) {
    const { error: uErr } = await supabase.from("market_trends").upsert(
      {
        make: row.make,
        model: null,
        platform: "all",
        vehicle_count: row.analysis_count,
        analysis_count: row.analysis_count,
        demand_high_pct: row.demand_high_pct,
        demand_moderate_pct: row.demand_moderate_pct,
        demand_low_pct: row.demand_low_pct,
        price_rising_pct: row.price_rising_pct,
        price_stable_pct: row.price_stable_pct,
        price_declining_pct: row.price_declining_pct,
        avg_sentiment_score: row.avg_sentiment_score,
        sentiment_samples: row.sentiment_samples,
        avg_sale_price: row.avg_sale_price,
        min_sale_price: row.min_sale_price,
        max_sale_price: row.max_sale_price,
        rarity_rare_pct: row.rarity_rare_pct,
        rarity_moderate_pct: row.rarity_moderate_pct,
        rarity_common_pct: row.rarity_common_pct,
        period_start: periodStart,
        calculated_at: now.toISOString(),
      },
      { onConflict: "make,model,platform,period_start" }
    );

    if (!uErr) upserted++;
  }

  return {
    makes_aggregated: makeAggs?.length ?? 0,
    upserted,
    period_start: periodStart,
  };
}

function deriveSentimentLabel(score: number | null): string {
  if (score == null) return "unknown";
  if (score >= 0.7) return "very_positive";
  if (score >= 0.4) return "positive";
  if (score >= -0.1) return "neutral";
  if (score >= -0.4) return "negative";
  return "very_negative";
}
