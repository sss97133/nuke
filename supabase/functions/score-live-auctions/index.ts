/**
 * SCORE LIVE AUCTIONS
 *
 * Runs after auctions close to:
 * 1. Score predictions (compare predicted vs actual hammer)
 * 2. Close paper trades (compute P&L)
 * 3. Report accuracy metrics
 *
 * Modes:
 * - score: score all unscored predictions and paper trades
 * - retrain: [DEPRECATED] → use backtest-hammer-simulator mode=auto_retrain
 * - backtest: [DEPRECATED] → use backtest-hammer-simulator mode=full_backtest
 *
 * POST /functions/v1/score-live-auctions
 * Body: { "mode": "score" }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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
    const mode = body.mode || "score";

    switch (mode) {
      case "score":
        return jsonResponse(await scoreMode(supabase));
      case "retrain":
        return jsonResponse({
          error: "retrain mode has been moved to backtest-hammer-simulator",
          hint: "POST /functions/v1/backtest-hammer-simulator with mode=auto_retrain",
        }, 410);
      case "backtest":
        return jsonResponse({
          error: "backtest mode has been moved to backtest-hammer-simulator",
          hint: "POST /functions/v1/backtest-hammer-simulator with mode=full_backtest",
        }, 410);
      default:
        return jsonResponse({ error: `Unknown mode: ${mode}` }, 400);
    }
  } catch (e: unknown) {
    console.error("[score-live-auctions] Error:", e);
    return jsonResponse(
      { error: e instanceof Error ? e.message : String(e) },
      500
    );
  }
});

// ─── FETCH FINAL PRICES ───

/**
 * For ended auctions with unscored predictions, fetch the BaT listing page
 * to extract the hammer price. This bypasses the 1-3 day lag from enrich-bulk.
 */
async function fetchFinalPrices(supabase: ReturnType<typeof createClient>): Promise<number> {
  // Find ALL recently ended BaT auctions without final_price — not just those with predictions.
  // Include both (active/ended) and (sold with null final_price) so we backfill when something
  // marked the listing sold but never set final_price (e.g. stale data or missed run).
  const { data: unscored } = await supabase.rpc("execute_sql", {
    query: `
      SELECT DISTINCT ON (ve.vehicle_id)
        ve.vehicle_id,
        ve.id as listing_id,
        ve.source_url as listing_url,
        ve.ended_at,
        ve.event_status
      FROM vehicle_events ve
      WHERE ve.source_platform = 'bat'
        AND ve.ended_at < NOW() - INTERVAL '30 minutes'
        AND ve.ended_at > NOW() - INTERVAL '7 days'
        AND ve.final_price IS NULL
        AND (
          ve.event_status IN ('active', 'ended')
          OR (ve.event_status = 'sold')
        )
        AND ve.source_url IS NOT NULL
      ORDER BY ve.vehicle_id, ve.ended_at DESC
      LIMIT 40
    `,
  });

  if (!unscored || unscored.length === 0) return 0;

  const SCORE_TIME_BUDGET_MS = 45_000; // 45s for fetch phase (score RPC is fast, total ~50s)
  const PARALLEL_BATCH = 5; // Fetch 5 BaT pages at once
  const fetchStart = Date.now();
  let updated = 0;

  for (let i = 0; i < (unscored as unknown[]).length; i += PARALLEL_BATCH) {
    if (Date.now() - fetchStart > SCORE_TIME_BUDGET_MS) {
      console.log(`[score] Time budget exceeded after ${updated} fetches, ${(unscored as unknown[]).length - i} remaining`);
      break;
    }

    const batch = (unscored as Array<{ vehicle_id: string; listing_id: string; listing_url: string; event_status?: string }>).slice(i, i + PARALLEL_BATCH);
    const results = await Promise.allSettled(batch.map(async (row) => {
      const resp = await fetch(row.listing_url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; NukeBot/1.0)" },
        redirect: "follow",
      });
      if (!resp.ok) return null;
      const html = await resp.text();

      // Check for reserve not met FIRST — JSON-LD price on unsold listings is the high bid, not a hammer price
      const reserveNotMet = /Reserve\s+Not\s+Met/i.test(html);
      const bidToMatch = html.match(/Bid\s+to\s+\$([\d,]+)/i);
      if (reserveNotMet || bidToMatch) {
        await supabase
          .from("vehicle_events")
          .update({ event_status: "unsold", updated_at: new Date().toISOString() })
          .eq("id", row.listing_id);
        const highBid = bidToMatch?.[1] || html.match(/High\s+Bid[^$]*\$([\d,]+)/)?.[1] || "unknown";
        console.log(`[score] ${row.listing_url}: reserve not met (high bid $${highBid})`);
        return null;
      }

      // Extract hammer price using same patterns as extract-bat-core
      let hammerPrice: number | null = null;

      // Priority 1: "Sold for $X" in stats table (most reliable)
      const soldMatch = html.match(/Sold\s+for\s+\$([\d,]+)/i);
      if (soldMatch) hammerPrice = Number(soldMatch[1].replace(/,/g, ""));

      // Priority 2: Title tag "sold for $X"
      if (!hammerPrice) {
        const titleMatch = html.match(/<title>[^<]*sold\s+for\s+\$([\d,]+)/i);
        if (titleMatch) hammerPrice = Number(titleMatch[1].replace(/,/g, ""));
      }

      // Priority 3: JSON-LD "price" field (only if "Sold" appears on page — avoids high-bid-as-price bug)
      if (!hammerPrice) {
        const jsonLdMatch = html.match(/"price":\s*(\d+)/);
        const pageIndicatesSold = /Sold\s+for/i.test(html) || /sold\s+on/i.test(html);
        if (jsonLdMatch && pageIndicatesSold) hammerPrice = Number(jsonLdMatch[1]);
      }

      if (!hammerPrice || hammerPrice <= 0) {
        console.log(`[score] ${row.listing_url}: no hammer price found`);
        return null;
      }

      // Update vehicle_events
      await supabase
        .from("vehicle_events")
        .update({
          final_price: hammerPrice,
          event_status: "sold",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.listing_id);

      // Update vehicles
      await supabase
        .from("vehicles")
        .update({
          sale_price: hammerPrice,
          sale_status: "sold",
        })
        .eq("id", row.vehicle_id);

      // When listing was already "sold" (e.g. backfill final_price), the vehicle_events
      // trigger won't fire (no status change). Create timeline event so the profile shows the auction result.
      const wasAlreadySold = String(row.event_status || "").toLowerCase() === "sold";
      if (wasAlreadySold) {
        await supabase.rpc("create_auction_timeline_event", {
          p_vehicle_id: row.vehicle_id,
          p_event_type: "auction_sold",
          p_listing_id: row.listing_id,
          p_metadata: { final_price: hammerPrice },
        });
      }

      console.log(`[score] Fetched price for ${row.listing_url}: $${hammerPrice}`);
      return hammerPrice;
    }));

    for (const r of results) {
      if (r.status === "fulfilled" && r.value !== null) updated++;
      if (r.status === "rejected") console.error(`[score] Fetch failed:`, r.reason);
    }
  }

  return updated;
}

// ─── SCORE MODE ───

async function scoreMode(supabase: ReturnType<typeof createClient>) {
  // Step 1: Fetch final prices for ended auctions (bypasses enrich-bulk lag)
  const pricesFetched = await fetchFinalPrices(supabase);

  // Step 2: Call the database function that scores everything
  const { data: scoredCount, error: scoreErr } = await supabase.rpc(
    "score_closed_predictions"
  );
  if (scoreErr) throw scoreErr;

  // Recently scored predictions with vehicle info
  const { data: recentScored } = await supabase.rpc("execute_sql", {
    query: `
      SELECT hp.vehicle_id, hp.current_bid, hp.predicted_hammer, hp.actual_hammer,
        hp.prediction_error_pct, hp.confidence_score, hp.time_window, hp.price_tier,
        hp.scored_at, hp.predicted_at,
        v.year, v.make, v.model
      FROM hammer_predictions hp
      JOIN vehicles v ON v.id = hp.vehicle_id
      WHERE hp.scored_at IS NOT NULL
      ORDER BY hp.scored_at DESC
      LIMIT 20
    `,
  });

  // Accuracy summary across all scored predictions
  const { data: accuracyStats } = await supabase.rpc("execute_sql", {
    query: `
      SELECT
        COUNT(*) as total_scored,
        ROUND(AVG(ABS(prediction_error_pct))::numeric, 1) as live_mape,
        ROUND(AVG(prediction_error_pct)::numeric, 1) as live_bias,
        SUM(CASE WHEN ABS(prediction_error_pct) <= 5 THEN 1 ELSE 0 END) as within_5pct,
        SUM(CASE WHEN ABS(prediction_error_pct) <= 10 THEN 1 ELSE 0 END) as within_10pct,
        SUM(CASE WHEN ABS(prediction_error_pct) <= 20 THEN 1 ELSE 0 END) as within_20pct
      FROM hammer_predictions
      WHERE scored_at IS NOT NULL
    `,
  });

  const stats = accuracyStats?.[0];

  return {
    success: true,
    prices_fetched: pricesFetched,
    predictions_scored: scoredCount ?? 0,
    accuracy: stats?.total_scored > 0 ? {
      total_scored: Number(stats.total_scored),
      live_mape: Number(stats.live_mape),
      live_bias: Number(stats.live_bias),
      within_5pct: `${stats.within_5pct}/${stats.total_scored}`,
      within_10pct: `${stats.within_10pct}/${stats.total_scored}`,
      within_20pct: `${stats.within_20pct}/${stats.total_scored}`,
    } : { message: "No scored predictions yet" },
    recently_scored: (recentScored ?? []).map((r: Record<string, unknown>) => ({
      vehicle: `${r.year} ${r.make} ${r.model}`,
      time_window: r.time_window,
      current_bid: Number(r.current_bid),
      predicted_hammer: Number(r.predicted_hammer),
      actual_hammer: Number(r.actual_hammer),
      error_pct: Number(r.prediction_error_pct),
      confidence: r.confidence_score,
      predicted_at: r.predicted_at,
      scored_at: r.scored_at,
    })),
  };
}
