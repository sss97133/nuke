/**
 * HAMMER PRICE PREDICTION ENGINE
 *
 * Predicts final hammer price for live BaT auctions using:
 * - Bid curve multipliers (trained from historical data by price tier + time window)
 * - Bid velocity (bids/hour)
 * - Engagement ratios (bid/watcher, watcher/view)
 * - Comparable sales data
 * - Sniper premium adjustment
 *
 * Modes:
 * - predict_one: predict hammer for a single vehicle
 * - predict_all: predict hammer for all active auctions
 * - paper_trade: make a virtual buy call on a vehicle
 * - dashboard: prediction accuracy + paper trade P&L
 *
 * POST /functions/v1/predict-hammer-price
 * Body: { "mode": "predict_one" | "predict_all" | "paper_trade" | "dashboard", ... }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type PredictionInput,
  type PredictionOutput,
  loadCoefficients,
  loadMakeCorrections,
  computePrediction,
  calculateBaTBuyerFee,
  CURRENT_MODEL_VERSION,
} from "../_shared/predictionEngine.ts";

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
    const mode = body.mode || "predict_all";

    switch (mode) {
      case "predict_one":
        return jsonResponse(await predictOne(supabase, body));
      case "predict_all":
        return jsonResponse(await predictAll(supabase, body));
      case "paper_trade":
        return jsonResponse(await paperTrade(supabase, body));
      case "dashboard":
        return jsonResponse(await dashboard(supabase));
      default:
        return jsonResponse({ error: `Unknown mode: ${mode}` }, 400);
    }
  } catch (e: unknown) {
    console.error("[predict-hammer-price] Error:", e);
    return jsonResponse(
      { error: e instanceof Error ? e.message : String(e) },
      500
    );
  }
});

// ─── MODES ───

async function predictOne(supabase: ReturnType<typeof createClient>, body: { vehicle_id?: string }) {
  const vehicleId = body.vehicle_id;
  if (!vehicleId) throw new Error("vehicle_id is required");

  const [coefficients, makeCorrections] = await Promise.all([
    loadCoefficients(supabase),
    loadMakeCorrections(supabase),
  ]);
  const input = await gatherPredictionInput(supabase, vehicleId);
  const prediction = computePrediction(input, coefficients, makeCorrections);

  // Store prediction
  await storePrediction(supabase, input, prediction);

  return {
    success: true,
    vehicle: input.vehicle_info,
    prediction: {
      current_bid: input.current_bid,
      hours_remaining: Math.round(input.hours_remaining * 10) / 10,
      ...prediction,
    },
    comps: {
      median: input.comp_median,
      count: input.comp_count,
    },
  };
}

async function predictAll(supabase: ReturnType<typeof createClient>, body: { limit?: number; max_hours?: number; dedup_minutes?: number }) {
  const limit = body.limit || 100;
  const maxHours = body.max_hours || 48; // Default 48h, pass 2 for final-hours cron
  const dedupMinutes = body.dedup_minutes || 25; // Default 25 min dedup window
  const PREDICT_TIME_BUDGET_MS = 50_000; // 50s budget (edge function max ~60s)
  const PARALLEL_BATCH = 5;
  const predictStart = Date.now();

  // Get all active BaT auctions
  const { data: activeListings, error: listErr } = await supabase
    .from("vehicle_events")
    .select("id, vehicle_id, current_price, bid_count, view_count, watcher_count, ended_at")
    .eq("source_platform", "bat")
    .eq("event_status", "active")
    .gt("current_price", 0)
    .gt("ended_at", new Date().toISOString())
    .order("ended_at", { ascending: true })
    .limit(limit);

  if (listErr) throw listErr;
  if (!activeListings || activeListings.length === 0) {
    return { success: true, predictions: [], message: "No active auctions found" };
  }

  // Filter to <=maxHours before ending, before loading coefficients
  const eligible = activeListings.filter(l => {
    const hoursLeft = Math.max(0, (new Date(l.ended_at).getTime() - Date.now()) / (1000 * 60 * 60));
    return hoursLeft <= maxHours;
  });
  const skippedTooEarly = activeListings.length - eligible.length;

  if (eligible.length === 0) {
    return {
      success: true, total_active: activeListings.length,
      predictions_made: 0, skipped_too_early: skippedTooEarly,
      skipped_dedup: 0, predictions_scored: 0, predictions: [],
    };
  }

  const [coefficients, makeCorrections] = await Promise.all([
    loadCoefficients(supabase),
    loadMakeCorrections(supabase),
  ]);

  const predictions: Array<Record<string, unknown>> = [];
  let skippedDedup = 0;
  let skippedTimeBudget = 0;

  // Process in parallel batches of PARALLEL_BATCH
  for (let i = 0; i < eligible.length; i += PARALLEL_BATCH) {
    // Time budget check
    if (Date.now() - predictStart > PREDICT_TIME_BUDGET_MS) {
      skippedTimeBudget = eligible.length - i;
      console.log(`[predict] Time budget exceeded at ${Date.now() - predictStart}ms, skipping ${skippedTimeBudget} remaining`);
      break;
    }

    const batch = eligible.slice(i, i + PARALLEL_BATCH);
    const results = await Promise.allSettled(batch.map(async (listing) => {
      const input = await gatherPredictionInput(supabase, listing.vehicle_id, listing);
      const prediction = computePrediction(input, coefficients, makeCorrections);

      // Dedup: skip if same vehicle + time_window predicted within dedup window
      const { count: recentCount } = await supabase
        .from("hammer_predictions")
        .select("*", { count: "exact", head: true })
        .eq("vehicle_id", input.vehicle_id)
        .eq("time_window", prediction.time_window)
        .gte("predicted_at", new Date(Date.now() - dedupMinutes * 60 * 1000).toISOString());
      if (recentCount && recentCount > 0) {
        return { type: "dedup" as const };
      }

      await storePrediction(supabase, input, prediction);
      return {
        type: "predicted" as const,
        vehicle_id: listing.vehicle_id,
        vehicle: input.vehicle_info,
        current_bid: input.current_bid,
        hours_remaining: Math.round(input.hours_remaining * 10) / 10,
        predicted_hammer: prediction.predicted_hammer,
        predicted_range: `${prediction.predicted_low.toLocaleString()} - ${prediction.predicted_high.toLocaleString()}`,
        confidence: prediction.confidence_score,
        buy_recommendation: prediction.buy_recommendation,
        adjustment_factor: prediction.factors.adjustment_factor,
        engagement: prediction.factors.engagement_level,
        competition: prediction.factors.competition_level,
        predicted_margin: prediction.predicted_margin,
      };
    }));

    for (const result of results) {
      if (result.status === "rejected") {
        console.error(`[predict] Batch item failed:`, result.reason);
      } else if (result.value.type === "dedup") {
        skippedDedup++;
      } else {
        predictions.push(result.value);
      }
    }
  }

  // Sort: strong_buy first, then buy, then by confidence
  const recOrder: Record<string, number> = { strong_buy: 0, buy: 1, hold: 2, pass: 3 };
  predictions.sort((a, b) => {
    const orderDiff = (recOrder[a.buy_recommendation as string] ?? 4) - (recOrder[b.buy_recommendation as string] ?? 4);
    if (orderDiff !== 0) return orderDiff;
    return (b.confidence as number) - (a.confidence as number);
  });

  // Auto-score any closed predictions while we're here
  let scored = 0;
  try {
    const { data } = await supabase.rpc("score_closed_predictions");
    scored = data ?? 0;
  } catch { /* scoring is best-effort */ }

  return {
    success: true,
    total_active: activeListings.length,
    predictions_made: predictions.length,
    skipped_too_early: skippedTooEarly,
    skipped_dedup: skippedDedup,
    skipped_time_budget: skippedTimeBudget,
    predictions_scored: scored,
    duration_ms: Date.now() - predictStart,
    predictions,
  };
}

async function paperTrade(
  supabase: ReturnType<typeof createClient>,
  body: { vehicle_id?: string; rationale?: string }
) {
  const vehicleId = body.vehicle_id;
  if (!vehicleId) throw new Error("vehicle_id is required");

  const [coefficients, makeCorrections] = await Promise.all([
    loadCoefficients(supabase),
    loadMakeCorrections(supabase),
  ]);
  const input = await gatherPredictionInput(supabase, vehicleId);
  const prediction = computePrediction(input, coefficients, makeCorrections);

  // Store prediction
  const predictionId = await storePrediction(supabase, input, prediction);

  // Calculate fees
  const buyerFee = calculateBaTBuyerFee(prediction.predicted_hammer);

  // Create paper trade
  const { data: trade, error: tradeErr } = await supabase
    .from("paper_trades")
    .insert({
      vehicle_id: vehicleId,
      prediction_id: predictionId,
      entry_price: input.current_bid,
      predicted_hammer: prediction.predicted_hammer,
      predicted_flip_profit: prediction.predicted_hammer - input.current_bid - buyerFee,
      estimated_buyer_fee: buyerFee,
      estimated_seller_fee: 99, // BaT classic
      rationale: body.rationale || `Auto: ${prediction.buy_recommendation} at ${prediction.confidence_score}% confidence`,
      platform: "bat",
    })
    .select("id")
    .single();

  if (tradeErr) throw tradeErr;

  return {
    success: true,
    trade_id: trade.id,
    vehicle: input.vehicle_info,
    entry: {
      current_bid: input.current_bid,
      buyer_fee: buyerFee,
      total_cost: input.current_bid + buyerFee,
    },
    prediction: {
      predicted_hammer: prediction.predicted_hammer,
      predicted_range: `${prediction.predicted_low.toLocaleString()} - ${prediction.predicted_high.toLocaleString()}`,
      confidence: prediction.confidence_score,
      predicted_profit: prediction.predicted_hammer - input.current_bid - buyerFee,
    },
    rationale: body.rationale || `Auto: ${prediction.buy_recommendation}`,
  };
}

async function dashboard(supabase: ReturnType<typeof createClient>) {
  // Score any closed predictions first
  const { data: scoreResult } = await supabase.rpc("score_closed_predictions");

  // 1. All predictions with vehicle info, grouped by auction
  const { data: allPreds } = await supabase.rpc("execute_sql", {
    query: `
      SELECT hp.vehicle_id, hp.time_window, hp.current_bid, hp.predicted_hammer,
        hp.predicted_low, hp.predicted_high, hp.confidence_score, hp.buy_recommendation,
        hp.hours_remaining, hp.price_tier, hp.actual_hammer, hp.prediction_error_pct,
        hp.predicted_at, hp.scored_at, hp.unique_bidders,
        v.year, v.make, v.model,
        ve.event_status, ve.ended_at, ve.current_price as live_bid, ve.final_price
      FROM hammer_predictions hp
      JOIN vehicles v ON v.id = hp.vehicle_id
      LEFT JOIN LATERAL (
        SELECT ve2.event_status, ve2.ended_at, ve2.current_price, ve2.final_price
        FROM vehicle_events ve2
        WHERE ve2.vehicle_id = hp.vehicle_id AND ve2.source_platform = 'bat'
        ORDER BY ve2.ended_at DESC NULLS LAST LIMIT 1
      ) ve ON true
      ORDER BY hp.predicted_at DESC
      LIMIT 50
    `,
  });

  // Group predictions by vehicle
  const byVehicle: Record<string, {
    vehicle: string; vehicle_id: string; listing_status: string;
    end_date: string; live_bid: number | null; final_price: number | null;
    predictions: Array<Record<string, unknown>>;
  }> = {};
  for (const p of allPreds ?? []) {
    const vid = p.vehicle_id;
    if (!byVehicle[vid]) {
      byVehicle[vid] = {
        vehicle: `${p.year} ${p.make} ${p.model}`,
        vehicle_id: vid,
        listing_status: p.listing_status ?? "unknown",
        end_date: p.end_date,
        live_bid: p.live_bid ? Number(p.live_bid) : null,
        final_price: p.final_price ? Number(p.final_price) : null,
        predictions: [],
      };
    }
    byVehicle[vid].predictions.push({
      time_window: p.time_window,
      current_bid: Number(p.current_bid),
      predicted_hammer: Number(p.predicted_hammer),
      predicted_range: `$${Number(p.predicted_low).toLocaleString()}-$${Number(p.predicted_high).toLocaleString()}`,
      confidence: p.confidence_score,
      recommendation: p.buy_recommendation,
      hours_remaining: Math.round(Number(p.hours_remaining) * 10) / 10,
      predicted_at: p.predicted_at,
      ...(p.actual_hammer ? {
        actual_hammer: Number(p.actual_hammer),
        error_pct: Number(p.prediction_error_pct),
        scored_at: p.scored_at,
      } : {}),
    });
  }

  // 2. Scored prediction accuracy summary
  const { data: scoredStats } = await supabase.rpc("execute_sql", {
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

  // 3. Latest backtest metrics
  const { data: latestBacktest } = await supabase.rpc("execute_sql", {
    query: `
      SELECT id, mode, created_at,
        mape as backtest_mape,
        bias_pct as backtest_bias,
        auction_count as backtest_auctions,
        within_10pct_rate as backtest_w10
      FROM backtest_runs
      WHERE mode = 'full_backtest' AND status = 'completed'
      ORDER BY created_at DESC
      LIMIT 1
    `,
  });

  // 4. Pipeline status (pg_cron recent runs)
  const { data: cronStatus } = await supabase.rpc("execute_sql", {
    query: `
      SELECT j.jobname,
        jrd.status as last_status,
        jrd.start_time as last_run,
        jrd.return_message
      FROM cron.job j
      LEFT JOIN LATERAL (
        SELECT jrd2.status, jrd2.start_time, jrd2.return_message
        FROM cron.job_run_details jrd2
        WHERE jrd2.jobid = j.jobid
        ORDER BY jrd2.start_time DESC
        LIMIT 1
      ) jrd ON true
      WHERE j.jobname LIKE 'hammer%'
      ORDER BY j.jobid
    `,
  });

  // 5. Prediction volume stats
  const { data: volumeStats } = await supabase.rpc("execute_sql", {
    query: `
      SELECT
        COUNT(*) as total_predictions,
        COUNT(DISTINCT vehicle_id) as unique_vehicles,
        COUNT(CASE WHEN scored_at IS NOT NULL THEN 1 END) as scored,
        COUNT(CASE WHEN scored_at IS NULL THEN 1 END) as unscored,
        COUNT(CASE WHEN predicted_at > NOW() - INTERVAL '24 hours' THEN 1 END) as last_24h,
        MIN(predicted_at) as first_prediction,
        MAX(predicted_at) as latest_prediction
      FROM hammer_predictions
    `,
  });

  // 6. Open paper trades with vehicle info
  const { data: openTrades } = await supabase.rpc("execute_sql", {
    query: `
      SELECT pt.vehicle_id, pt.entry_price, pt.predicted_hammer,
        pt.predicted_flip_profit, pt.rationale, pt.created_at,
        v.year, v.make, v.model
      FROM paper_trades pt
      JOIN vehicles v ON v.id = pt.vehicle_id
      WHERE pt.closed_at IS NULL
      ORDER BY pt.created_at DESC
      LIMIT 20
    `,
  });

  const scored = scoredStats?.[0];
  const backtest = latestBacktest?.[0];
  const volume = volumeStats?.[0];

  return {
    success: true,
    newly_scored: scoreResult ?? 0,

    model_health: {
      backtest_mape: backtest ? Number(backtest.backtest_mape) : null,
      backtest_bias: backtest ? Number(backtest.backtest_bias) : null,
      backtest_auctions: backtest ? Number(backtest.backtest_auctions) : null,
      last_backtest: backtest?.created_at ?? null,
      live_mape: scored?.total_scored > 0 ? Number(scored.live_mape) : null,
      live_bias: scored?.total_scored > 0 ? Number(scored.live_bias) : null,
      live_scored: Number(scored?.total_scored ?? 0),
      live_within_10pct: scored?.total_scored > 0
        ? `${scored.within_10pct}/${scored.total_scored}`
        : null,
      model_version: CURRENT_MODEL_VERSION,
    },

    prediction_volume: {
      total: Number(volume?.total_predictions ?? 0),
      unique_vehicles: Number(volume?.unique_vehicles ?? 0),
      scored: Number(volume?.scored ?? 0),
      unscored: Number(volume?.unscored ?? 0),
      last_24h: Number(volume?.last_24h ?? 0),
      first_prediction: volume?.first_prediction ?? null,
      latest_prediction: volume?.latest_prediction ?? null,
    },

    pipeline_status: (cronStatus ?? []).map((j: Record<string, unknown>) => ({
      job: j.jobname,
      last_status: j.last_status,
      last_run: j.last_run,
      message: j.return_message,
    })),

    auctions: Object.values(byVehicle),

    open_paper_trades: (openTrades ?? []).map((t: Record<string, unknown>) => ({
      vehicle: `${t.year} ${t.make} ${t.model}`,
      entry_price: Number(t.entry_price),
      predicted_hammer: Number(t.predicted_hammer),
      predicted_profit: Number(t.predicted_flip_profit),
      rationale: t.rationale,
      created_at: t.created_at,
    })),
  };
}

// ─── HELPERS ───

async function gatherPredictionInput(
  supabase: ReturnType<typeof createClient>,
  vehicleId: string,
  listingData?: {
    id: string;
    current_bid: number;
    bid_count: number;
    view_count: number;
    watcher_count: number;
    end_date: string;
  }
): Promise<PredictionInput> {
  // Get vehicle info
  const { data: vehicle, error: vErr } = await supabase
    .from("vehicles")
    .select("id, year, make, model")
    .eq("id", vehicleId)
    .single();
  if (vErr) throw new Error(`Vehicle not found: ${vehicleId}`);

  // Get listing data if not provided
  let listing = listingData;
  if (!listing) {
    const { data: el, error: elErr } = await supabase
      .from("vehicle_events")
      .select("id, current_price, bid_count, view_count, watcher_count, ended_at")
      .eq("vehicle_id", vehicleId)
      .eq("source_platform", "bat")
      .eq("event_status", "active")
      .single();
    if (elErr || !el) throw new Error(`No active listing for vehicle ${vehicleId}`);
    listing = el;
  }

  const now = new Date();
  const endDate = new Date(listing.end_date);
  const hoursRemaining = Math.max(0, (endDate.getTime() - now.getTime()) / (1000 * 60 * 60));

  // Get bid stats from bat_bids (excluding bid_snapshot sync entries for accurate staleness)
  const { data: bidStats, error: bsErr } = await supabase.rpc("execute_sql", {
    query: `
      SELECT
        COUNT(*) FILTER (WHERE bat_username != 'bid_snapshot') as total_bids,
        COUNT(DISTINCT bat_username) FILTER (WHERE bat_username != 'bid_snapshot') as unique_bidders,
        EXTRACT(EPOCH FROM (
          MAX(bid_timestamp) FILTER (WHERE bat_username != 'bid_snapshot') -
          MIN(bid_timestamp) FILTER (WHERE bat_username != 'bid_snapshot')
        )) / 3600.0 as duration_hours,
        MAX(bid_timestamp) FILTER (WHERE bat_username != 'bid_snapshot') as last_bid_ts
      FROM bat_bids
      WHERE vehicle_id = '${vehicleId}'
        AND bid_amount > 0
    `,
  });

  let uniqueBidders = 0;
  let bidVelocity = 0;
  let hoursSinceLastBid: number | null = null;
  if (!bsErr && bidStats?.[0]) {
    uniqueBidders = Number(bidStats[0].unique_bidders) || 0;
    const durationHours = Number(bidStats[0].duration_hours) || 1;
    const totalBids = Number(bidStats[0].total_bids) || 0;
    bidVelocity = durationHours > 0 ? totalBids / durationHours : totalBids;
    // Compute hours since last bid for staleness-conditional bid blend (v24)
    if (bidStats[0].last_bid_ts) {
      const lastBidTime = new Date(bidStats[0].last_bid_ts).getTime();
      hoursSinceLastBid = Math.max(0, (now.getTime() - lastBidTime) / (1000 * 60 * 60));
    }
  }

  // Compute bid_velocity_pct: % growth from prior window bid (v25 momentum alpha)
  let bidVelocityPct: number | null = null;
  const PRIOR_WINDOW_HOURS: Record<string, number> = {
    "2m": 0.5, "30m": 2, "2h": 6, "6h": 12, "12h": 24, "24h": 48,
  };
  const currentWindow = hoursRemaining > 36 ? "48h" : hoursRemaining > 18 ? "24h"
    : hoursRemaining > 9 ? "12h" : hoursRemaining > 4 ? "6h"
    : hoursRemaining > 1 ? "2h" : hoursRemaining > 0.25 ? "30m" : "2m";
  const priorHours = PRIOR_WINDOW_HOURS[currentWindow];
  if (priorHours && listing.current_bid > 0) {
    const priorCutoff = new Date(endDate.getTime() - priorHours * 3600 * 1000).toISOString();
    const { data: priorBid } = await supabase.rpc("execute_sql", {
      query: `SELECT MAX(bid_amount) as prior_bid FROM bat_bids
              WHERE vehicle_id = '${vehicleId}' AND bid_timestamp <= '${priorCutoff}' AND bid_amount > 0`,
    });
    if (priorBid?.[0]?.prior_bid && Number(priorBid[0].prior_bid) > 0) {
      bidVelocityPct = (Number(listing.current_bid) - Number(priorBid[0].prior_bid)) / Number(priorBid[0].prior_bid);
    }
  }

  // Get comment count for engagement signal
  const { count: commentCount } = await supabase
    .from("auction_comments")
    .select("*", { count: "exact", head: true })
    .eq("vehicle_id", vehicleId);

  // Get comparable sales — improved matching (v14):
  // 1. Same make, similar model (first 2 words for precision)
  // 2. Year band (+/- 5 years) to avoid era mismatches
  // 3. Exclude parts/accessories listings
  // 4. Falls back to make-only if no specific model matches
  const safeMake = (vehicle.make || "").replace(/'/g, "''");
  const modelWords = (vehicle.model || "").replace(/'/g, "''").split(/\s+/).filter(Boolean);
  // Use first 2 words for tighter matching (e.g., "911 Carrera" not just "911")
  const modelMatch = modelWords.slice(0, 2).join(" ");
  const yearMin = (vehicle.year || 1900) - 5;
  const yearMax = (vehicle.year || 2100) + 5;

  const { data: comps, error: compErr } = await supabase.rpc("execute_sql", {
    query: `
      WITH specific_comps AS (
        SELECT ve.final_price
        FROM vehicle_events ve
        JOIN vehicles v ON v.id = ve.vehicle_id
        WHERE UPPER(v.make) = UPPER('${safeMake}')
          AND v.model ILIKE '%${modelMatch}%'
          AND v.year BETWEEN ${yearMin} AND ${yearMax}
          AND v.is_public = true
          AND ve.source_platform = 'bat'
          AND ve.event_status = 'sold'
          AND ve.final_price > 0
          AND ve.ended_at >= NOW() - INTERVAL '12 months'
          AND LOWER(COALESCE(v.model, '')) NOT SIMILAR TO '%(parts|engine|seats|wheels|door|hood|trunk|bumper|fender|transmission)%'
      )
      SELECT
        COUNT(*) as comp_count,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY final_price) as comp_median
      FROM specific_comps
    `,
  });

  let compMedian: number | null = null;
  let compCount = 0;
  if (!compErr && comps?.[0]) {
    compMedian = comps[0].comp_median ? Number(comps[0].comp_median) : null;
    compCount = Number(comps[0].comp_count) || 0;
  }

  // Fallback to broader make-only matching if too few specific comps
  if (compCount < 3 && safeMake) {
    const { data: broadComps } = await supabase.rpc("execute_sql", {
      query: `
        SELECT
          COUNT(*) as comp_count,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ve.final_price) as comp_median
        FROM vehicle_events ve
        JOIN vehicles v ON v.id = ve.vehicle_id
        WHERE UPPER(v.make) = UPPER('${safeMake}')
          AND v.model ILIKE '%${modelWords[0] || ""}%'
          AND v.year BETWEEN ${yearMin} AND ${yearMax}
          AND v.is_public = true
          AND ve.source_platform = 'bat'
          AND ve.event_status = 'sold'
          AND ve.final_price > 0
          AND ve.ended_at >= NOW() - INTERVAL '12 months'
          AND LOWER(COALESCE(v.model, '')) NOT SIMILAR TO '%(parts|engine|seats|wheels|door|hood|trunk|bumper|fender|transmission)%'
      `,
    });
    if (broadComps?.[0]) {
      const broadCount = Number(broadComps[0].comp_count) || 0;
      if (broadCount >= 3) {
        compMedian = broadComps[0].comp_median ? Number(broadComps[0].comp_median) : null;
        compCount = broadCount;
      }
    }
  }

  return {
    vehicle_id: vehicleId,
    vehicle_event_id: listing.id,
    current_bid: Number(listing.current_price || listing.current_bid),
    bid_count: Number(listing.bid_count) || 0,
    view_count: Number(listing.view_count) || 0,
    watcher_count: Number(listing.watcher_count) || 0,
    unique_bidders: uniqueBidders,
    hours_remaining: hoursRemaining,
    bid_velocity: bidVelocity,
    comp_median: compMedian,
    comp_count: compCount,
    comment_count: commentCount ?? 0,
    hours_since_last_bid: hoursSinceLastBid,
    bid_velocity_pct: bidVelocityPct,
    vehicle_info: { year: vehicle.year, make: vehicle.make, model: vehicle.model },
  };
}

async function storePrediction(
  supabase: ReturnType<typeof createClient>,
  input: PredictionInput,
  prediction: PredictionOutput
): Promise<string> {
  const bidToWatcherRatio =
    input.watcher_count > 0 ? input.bid_count / input.watcher_count : null;
  const watcherToViewRatio =
    input.view_count > 0 ? input.watcher_count / input.view_count : null;

  const { data, error } = await supabase
    .from("hammer_predictions")
    .insert({
      vehicle_id: input.vehicle_id,
      vehicle_event_id: input.vehicle_event_id,
      current_bid: input.current_bid,
      bid_count: input.bid_count,
      view_count: input.view_count,
      watcher_count: input.watcher_count,
      unique_bidders: input.unique_bidders,
      hours_remaining: input.hours_remaining,
      time_window: prediction.time_window,
      price_tier: prediction.price_tier,
      model_version: CURRENT_MODEL_VERSION,
      bid_velocity: input.bid_velocity,
      bid_to_watcher_ratio: bidToWatcherRatio,
      watcher_to_view_ratio: watcherToViewRatio,
      comp_median: input.comp_median,
      comp_count: input.comp_count,
      predicted_hammer: prediction.predicted_hammer,
      predicted_low: prediction.predicted_low,
      predicted_high: prediction.predicted_high,
      multiplier_used: prediction.multiplier_used,
      confidence_score: prediction.confidence_score,
      predicted_margin: prediction.predicted_margin,
      predicted_flip_margin: prediction.predicted_flip_margin,
      buy_recommendation: prediction.buy_recommendation,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}
