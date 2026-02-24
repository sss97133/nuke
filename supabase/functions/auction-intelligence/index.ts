/**
 * AUCTION INTELLIGENCE
 *
 * Real-time auction analysis combining predictions, comp data, and value signals.
 * Powers deal alerts, paper trading, and live auction monitoring.
 *
 * GET  /functions/v1/auction-intelligence                → live dashboard (all active auctions)
 * POST /functions/v1/auction-intelligence
 *   { "action": "dashboard" }                           → same as GET
 *   { "action": "vehicle", "vehicle_id": "..." }       → deep dive on one auction
 *   { "action": "paper_portfolio" }                     → paper trading portfolio status
 *   { "action": "alerts" }                              → current deal alerts
 *   { "action": "leaderboard" }                         → prediction accuracy leaderboard
 *   { "action": "war_room" }                            → real-time war room for closing auctions
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeArray(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data;
  console.error("[auction-intelligence] Expected array, got:", JSON.stringify(data)?.substring(0, 200));
  return [];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const action = body.action || "dashboard";

  try {
    switch (action) {
      case "dashboard":
        return json(await dashboard(supabase));
      case "vehicle":
        return json(await vehicleDeepDive(supabase, body.vehicle_id));
      case "paper_portfolio":
        return json(await paperPortfolio(supabase));
      case "alerts":
        return json(await dealAlerts(supabase));
      case "leaderboard":
        return json(await predictionLeaderboard(supabase));
      case "war_room":
        return json(await warRoom(supabase));
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e: unknown) {
    console.error("[auction-intelligence]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ─── DASHBOARD ───

async function dashboard(supabase: ReturnType<typeof createClient>) {
  const { data: auctions } = await supabase.rpc("execute_sql", {
    query: `
      WITH latest_pred AS (
        SELECT DISTINCT ON (vehicle_id)
          vehicle_id, predicted_hammer, current_bid as pred_bid,
          comp_median, comp_count, confidence_score, time_window,
          predicted_at, predicted_low, predicted_high
        FROM hammer_predictions
        ORDER BY vehicle_id, predicted_at DESC
      ),
      bid_velocity AS (
        SELECT
          vehicle_id,
          COUNT(*) as bid_count_24h,
          MAX(bid_amount) - MIN(bid_amount) as bid_range_24h,
          CASE WHEN COUNT(*) > 1
            THEN (MAX(bid_amount) - MIN(bid_amount))::float / NULLIF(MIN(bid_amount), 0) * 100
            ELSE 0
          END as bid_momentum_pct
        FROM bat_bids
        WHERE bid_timestamp > NOW() - INTERVAL '24 hours'
        GROUP BY vehicle_id
      )
      SELECT
        el.vehicle_id,
        v.year, v.make, v.model,
        el.current_bid::int as bid,
        el.listing_url,
        to_char(el.end_date, 'YYYY-MM-DD"T"HH24:MI"Z"') as end_date,
        ROUND(EXTRACT(EPOCH FROM (el.end_date - NOW())) / 3600, 1) as hours_left,
        lp.predicted_hammer::int as predicted_hammer,
        lp.comp_median::int as comp_median,
        lp.comp_count,
        lp.confidence_score,
        lp.time_window,
        lp.predicted_low::int as pred_low,
        lp.predicted_high::int as pred_high,
        bv.bid_count_24h,
        bv.bid_momentum_pct,
        -- Value signals
        CASE WHEN lp.predicted_hammer IS NOT NULL AND el.current_bid > 0
          THEN ROUND(((lp.predicted_hammer - el.current_bid)::float / el.current_bid * 100)::numeric, 1)
          ELSE NULL
        END as upside_pct,
        CASE WHEN lp.comp_median IS NOT NULL AND el.current_bid > 0
          THEN ROUND(((lp.comp_median - el.current_bid)::float / el.current_bid * 100)::numeric, 1)
          ELSE NULL
        END as comp_upside_pct,
        -- Deal score: composite of upside, confidence, comp quality
        CASE WHEN lp.predicted_hammer IS NOT NULL AND el.current_bid > 0 AND lp.comp_count > 0
          THEN ROUND((
            -- Upside component (0-40 points)
            LEAST(40, GREATEST(0,
              ((lp.predicted_hammer - el.current_bid)::float / NULLIF(el.current_bid, 0) * 100)
            )) +
            -- Confidence component (0-30 points)
            LEAST(30, COALESCE(lp.confidence_score, 0) * 0.3) +
            -- Comp quality component (0-30 points)
            LEAST(30, lp.comp_count * 1.5)
          )::numeric, 0)
          ELSE NULL
        END as deal_score
      FROM external_listings el
      JOIN vehicles v ON v.id = el.vehicle_id
      LEFT JOIN latest_pred lp ON lp.vehicle_id = el.vehicle_id
      LEFT JOIN bid_velocity bv ON bv.vehicle_id = el.vehicle_id
      WHERE el.platform = 'bat'
        AND el.listing_status = 'active'
        AND el.end_date > NOW()
        AND el.current_bid > 0
      ORDER BY
        CASE WHEN lp.predicted_hammer IS NOT NULL
          THEN ((lp.predicted_hammer - el.current_bid)::float / NULLIF(el.current_bid, 0))
          ELSE -1
        END DESC
    `,
  });

  // Classify each auction
  const classified = safeArray(auctions).map((a: Record<string, unknown>) => {
    const hoursLeft = Number(a.hours_left) || 999;
    const upside = Number(a.upside_pct) || 0;
    const compUpside = Number(a.comp_upside_pct) || 0;
    const compCount = Number(a.comp_count) || 0;
    const confidence = Number(a.confidence_score) || 0;

    // Signal classification
    let signal = "WATCH";
    let emoji = "👀";
    if (upside >= 30 && compCount >= 3 && confidence >= 40) {
      signal = "STRONG BUY"; emoji = "🔥";
    } else if (upside >= 20 && compCount >= 1) {
      signal = "BUY"; emoji = "📈";
    } else if (upside >= 10) {
      signal = "INTERESTING"; emoji = "💡";
    } else if (upside < -10) {
      signal = "OVERPRICED"; emoji = "⚠️";
    } else if (!a.predicted_hammer) {
      signal = "NO PREDICTION"; emoji = "⏳";
    }

    // Phase classification
    let phase = "EARLY";
    if (hoursLeft <= 0.033) phase = "CLOSING"; // <2m
    else if (hoursLeft <= 0.5) phase = "FINAL MINUTES";
    else if (hoursLeft <= 2) phase = "FINAL HOURS";
    else if (hoursLeft <= 6) phase = "HEATING UP";
    else if (hoursLeft <= 24) phase = "ACTIVE";
    else if (hoursLeft <= 48) phase = "WARMING UP";

    // Compute snipe surge prediction
    const bid = Number(a.bid) || 0;
    const surge = computeSnipeSurgeInline(bid, hoursLeft,
      a.bid_momentum_pct ? Number(a.bid_momentum_pct) : null,
      a.comp_upside_pct ? Number(a.comp_upside_pct) : null
    );

    return {
      vehicle: `${a.year} ${a.make} ${a.model}`,
      vehicle_id: a.vehicle_id,
      bid: a.bid,
      predicted_hammer: a.predicted_hammer,
      comp_median: a.comp_median,
      upside_pct: a.upside_pct,
      comp_upside_pct: a.comp_upside_pct,
      deal_score: a.deal_score,
      signal: `${emoji} ${signal}`,
      phase,
      hours_left: hoursLeft,
      end_date: a.end_date,
      listing_url: a.listing_url,
      comp_count: compCount,
      confidence: confidence,
      bid_momentum: a.bid_momentum_pct ? `${Number(a.bid_momentum_pct).toFixed(1)}%` : null,
      prediction_range: a.pred_low && a.pred_high
        ? `$${Number(a.pred_low).toLocaleString()} - $${Number(a.pred_high).toLocaleString()}`
        : null,
      snipe_surge: {
        expected_bump_pct: surge.expectedSurgePct,
        expected_hammer: surge.expectedHammer,
        intensity: surge.intensity,
      },
    };
  });

  const withPredictions = classified.filter((a: Record<string, unknown>) => a.predicted_hammer);
  const strongBuys = classified.filter((a: Record<string, unknown>) => (a.signal as string).includes("STRONG BUY"));
  const buys = classified.filter((a: Record<string, unknown>) => (a.signal as string).includes("📈"));

  return {
    timestamp: new Date().toISOString(),
    total_auctions: classified.length,
    with_predictions: withPredictions.length,
    signals: {
      strong_buy: strongBuys.length,
      buy: buys.length,
    },
    auctions: classified,
  };
}

// ─── VEHICLE DEEP DIVE ───

async function vehicleDeepDive(supabase: ReturnType<typeof createClient>, vehicleId: string) {
  if (!vehicleId) return { error: "vehicle_id required" };

  // Get all predictions for this vehicle
  const { data: predictions } = await supabase.rpc("execute_sql", {
    query: `
      SELECT
        predicted_hammer::int as predicted,
        current_bid::int as bid,
        comp_median::int as comp_med,
        comp_count,
        confidence_score,
        time_window,
        to_char(predicted_at, 'MM-DD HH24:MI') as predicted_at,
        predicted_low::int as pred_low,
        predicted_high::int as pred_high
      FROM hammer_predictions
      WHERE vehicle_id = '${vehicleId}'
      ORDER BY predicted_at ASC
    `,
  });

  // Get vehicle info
  const { data: vehicle } = await supabase.rpc("execute_sql", {
    query: `
      SELECT v.year, v.make, v.model, v.vin,
        el.current_bid::int as bid, el.listing_url,
        to_char(el.end_date, 'YYYY-MM-DD"T"HH24:MI"Z"') as end_date,
        el.listing_status
      FROM vehicles v
      JOIN external_listings el ON el.vehicle_id = v.id AND el.platform = 'bat'
      WHERE v.id = '${vehicleId}'
      ORDER BY el.end_date DESC
      LIMIT 1
    `,
  });

  // Get bid history
  const { data: bids } = await supabase.rpc("execute_sql", {
    query: `
      SELECT bid_amount::int as amount,
        to_char(bid_timestamp, 'MM-DD HH24:MI') as timestamp,
        source
      FROM bat_bids
      WHERE vehicle_id = '${vehicleId}'
      ORDER BY bid_timestamp ASC
    `,
  });

  const veh = vehicle?.[0];
  const preds = safeArray(predictions);
  const latestPred = preds[preds.length - 1];

  // Prediction trajectory
  const trajectory = preds.map((p: Record<string, unknown>) => ({
    time: p.predicted_at,
    window: p.time_window,
    predicted: p.predicted,
    bid: p.bid,
    spread: `${(((Number(p.predicted) - Number(p.bid)) / Number(p.bid)) * 100).toFixed(1)}%`,
  }));

  return {
    vehicle: veh ? `${veh.year} ${veh.make} ${veh.model}` : "Unknown",
    vehicle_id: vehicleId,
    listing_url: veh?.listing_url,
    end_date: veh?.end_date,
    status: veh?.listing_status,
    current_bid: veh?.bid,
    latest_prediction: latestPred ? {
      predicted_hammer: latestPred.predicted,
      upside_pct: `${(((Number(latestPred.predicted) - Number(latestPred.bid)) / Number(latestPred.bid)) * 100).toFixed(1)}%`,
      comp_median: latestPred.comp_med,
      comp_count: latestPred.comp_count,
      confidence: latestPred.confidence_score,
      range: latestPred.pred_low && latestPred.pred_high
        ? `$${Number(latestPred.pred_low).toLocaleString()} - $${Number(latestPred.pred_high).toLocaleString()}`
        : null,
    } : null,
    prediction_count: preds.length,
    prediction_trajectory: trajectory,
    bid_history: safeArray(bids),
  };
}

// ─── DEAL ALERTS ───

async function dealAlerts(supabase: ReturnType<typeof createClient>) {
  const { data: alerts } = await supabase.rpc("execute_sql", {
    query: `
      WITH latest_pred AS (
        SELECT DISTINCT ON (vehicle_id)
          vehicle_id, predicted_hammer, current_bid as pred_bid,
          comp_median, comp_count, confidence_score, time_window
        FROM hammer_predictions
        ORDER BY vehicle_id, predicted_at DESC
      )
      SELECT
        el.vehicle_id,
        v.year, v.make, v.model,
        el.current_bid::int as bid,
        el.listing_url,
        ROUND(EXTRACT(EPOCH FROM (el.end_date - NOW())) / 3600, 1) as hours_left,
        lp.predicted_hammer::int as predicted,
        lp.comp_median::int as comp_med,
        lp.comp_count,
        lp.confidence_score,
        ROUND(((lp.predicted_hammer - el.current_bid)::float / NULLIF(el.current_bid, 0) * 100)::numeric, 1) as upside_pct
      FROM external_listings el
      JOIN vehicles v ON v.id = el.vehicle_id
      JOIN latest_pred lp ON lp.vehicle_id = el.vehicle_id
      WHERE el.platform = 'bat'
        AND el.listing_status = 'active'
        AND el.end_date > NOW()
        AND el.current_bid > 0
        AND lp.predicted_hammer > el.current_bid * 1.15
        AND lp.comp_count >= 1
      ORDER BY
        ((lp.predicted_hammer - el.current_bid)::float / NULLIF(el.current_bid, 0)) DESC
    `,
  });

  return {
    timestamp: new Date().toISOString(),
    alert_count: safeArray(alerts).length,
    alerts: safeArray(alerts).map((a: Record<string, unknown>) => ({
      vehicle: `${a.year} ${a.make} ${a.model}`,
      vehicle_id: a.vehicle_id,
      bid: a.bid,
      predicted: a.predicted,
      upside_pct: a.upside_pct,
      comp_median: a.comp_med,
      comp_count: a.comp_count,
      confidence: a.confidence_score,
      hours_left: a.hours_left,
      listing_url: a.listing_url,
      alert_type: Number(a.upside_pct) >= 30 ? "STRONG_VALUE" :
                  Number(a.upside_pct) >= 20 ? "VALUE" : "POTENTIAL",
    })),
  };
}

// ─── PAPER PORTFOLIO ───

async function paperPortfolio(supabase: ReturnType<typeof createClient>) {
  // Get scored predictions to simulate paper trades
  const { data: scored } = await supabase.rpc("execute_sql", {
    query: `
      WITH scored_preds AS (
        SELECT DISTINCT ON (hp.vehicle_id)
          hp.vehicle_id, v.year, v.make, v.model,
          hp.current_bid::int as entry_bid,
          hp.predicted_hammer::int as our_prediction,
          hp.actual_hammer::int as actual_hammer,
          hp.prediction_error_pct,
          hp.comp_median::int as comp_med,
          hp.comp_count,
          hp.time_window,
          hp.scored_at
        FROM hammer_predictions hp
        JOIN vehicles v ON v.id = hp.vehicle_id
        WHERE hp.scored_at IS NOT NULL
          AND hp.actual_hammer IS NOT NULL
        ORDER BY hp.vehicle_id, hp.predicted_at DESC
      )
      SELECT * FROM scored_preds ORDER BY scored_at DESC
    `,
  });

  // For active predictions (unscored), show open positions
  const { data: open } = await supabase.rpc("execute_sql", {
    query: `
      WITH latest_pred AS (
        SELECT DISTINCT ON (vehicle_id)
          vehicle_id, predicted_hammer::int as predicted,
          current_bid::int as bid, comp_median::int as comp_med,
          comp_count, confidence_score, time_window, predicted_at
        FROM hammer_predictions
        WHERE scored_at IS NULL
        ORDER BY vehicle_id, predicted_at DESC
      )
      SELECT
        lp.vehicle_id, v.year, v.make, v.model,
        lp.bid, lp.predicted, lp.comp_med, lp.comp_count,
        lp.confidence_score,
        ROUND(((lp.predicted - lp.bid)::float / NULLIF(lp.bid, 0) * 100)::numeric, 1) as upside_pct,
        el.listing_url,
        ROUND(EXTRACT(EPOCH FROM (el.end_date - NOW())) / 3600, 1) as hours_left
      FROM latest_pred lp
      JOIN vehicles v ON v.id = lp.vehicle_id
      JOIN external_listings el ON el.vehicle_id = lp.vehicle_id AND el.platform = 'bat'
      WHERE el.listing_status = 'active' AND el.end_date > NOW()
      ORDER BY upside_pct DESC
    `,
  });

  const closedTrades = safeArray(scored).map((s: Record<string, unknown>) => {
    const pnl = Number(s.actual_hammer) - Number(s.entry_bid);
    const pnlPct = (pnl / Number(s.entry_bid) * 100);
    return {
      vehicle: `${s.year} ${s.make} ${s.model}`,
      entry_bid: s.entry_bid,
      predicted: s.our_prediction,
      actual: s.actual_hammer,
      pnl,
      pnl_pct: `${pnlPct.toFixed(1)}%`,
      prediction_error: `${s.prediction_error_pct}%`,
    };
  });

  const openPositions = safeArray(open).map((o: Record<string, unknown>) => ({
    vehicle: `${o.year} ${o.make} ${o.model}`,
    vehicle_id: o.vehicle_id,
    current_bid: o.bid,
    predicted_hammer: o.predicted,
    upside_pct: o.upside_pct,
    comp_median: o.comp_med,
    hours_left: o.hours_left,
    listing_url: o.listing_url,
  }));

  return {
    timestamp: new Date().toISOString(),
    closed_trades: closedTrades.length,
    open_positions: openPositions.length,
    portfolio: {
      closed: closedTrades,
      open: openPositions,
    },
  };
}

// ─── PREDICTION LEADERBOARD ───

async function predictionLeaderboard(supabase: ReturnType<typeof createClient>) {
  const { data: stats } = await supabase.rpc("execute_sql", {
    query: `
      SELECT
        COUNT(*) as total_predictions,
        COUNT(DISTINCT vehicle_id) as unique_vehicles,
        COUNT(*) FILTER (WHERE scored_at IS NOT NULL) as scored,
        ROUND(AVG(ABS(prediction_error_pct)) FILTER (WHERE scored_at IS NOT NULL)::numeric, 1) as live_mape,
        ROUND(AVG(prediction_error_pct) FILTER (WHERE scored_at IS NOT NULL)::numeric, 1) as live_bias,
        COUNT(*) FILTER (WHERE scored_at IS NOT NULL AND ABS(prediction_error_pct) <= 5) as within_5pct,
        COUNT(*) FILTER (WHERE scored_at IS NOT NULL AND ABS(prediction_error_pct) <= 10) as within_10pct,
        MIN(predicted_at) as first_prediction,
        MAX(predicted_at) as latest_prediction
      FROM hammer_predictions
    `,
  });

  // Backtest performance
  const { data: backtest } = await supabase.rpc("execute_sql", {
    query: `
      SELECT mape, bias_pct, within_10pct_rate, within_20pct_rate, auction_count,
        to_char(created_at, 'YYYY-MM-DD HH24:MI') as run_date
      FROM backtest_runs
      WHERE mode = 'full_backtest' AND status = 'completed' AND auction_count >= 100
      ORDER BY created_at DESC LIMIT 1
    `,
  });

  const s = stats?.[0] ?? {};
  const b = backtest?.[0] ?? {};

  return {
    timestamp: new Date().toISOString(),
    model_version: "v35 (cc-count-adaptive)",
    live_stats: {
      total_predictions: s.total_predictions,
      unique_vehicles: s.unique_vehicles,
      scored: s.scored,
      live_mape: s.live_mape ? `${s.live_mape}%` : "No scored predictions yet",
      live_bias: s.live_bias ? `${s.live_bias}%` : null,
      within_5pct: s.within_5pct,
      within_10pct: s.within_10pct,
    },
    backtest_stats: {
      mape: `${b.mape}%`,
      bias: `${b.bias_pct}%`,
      within_10pct: `${b.within_10pct_rate}%`,
      within_20pct: `${b.within_20pct_rate}%`,
      auctions_tested: b.auction_count,
      last_run: b.run_date,
    },
  };
}

// ─── SNIPE SURGE MODEL (inline) ───
// Median final bump by price tier × time window, from 280+ auction backtest
const SNIPE_TABLE: Record<string, Record<string, number>> = {
  under_5k:   { "2h": 56.4, "30m": 48.0, "2m": 18.8 },
  "5k_15k":   { "2h": 48.9, "30m": 44.9, "2m": 9.6 },
  "15k_30k":  { "2h": 40.1, "30m": 30.3, "2m": 0 },
  "30k_60k":  { "2h": 25.2, "30m": 23.3, "2m": 0 },
  "60k_100k": { "2h": 13.6, "30m": 13.8, "2m": 8.6 },
  "100k_plus": { "2h": 26.5, "30m": 16.7, "2m": 1.6 },
};

function computeSnipeSurgeInline(bid: number, hoursLeft: number, momentum: number | null, compUpside: number | null) {
  const tier = bid < 5000 ? "under_5k" : bid < 15000 ? "5k_15k" : bid < 30000 ? "15k_30k"
    : bid < 60000 ? "30k_60k" : bid < 100000 ? "60k_100k" : "100k_plus";
  const window = hoursLeft <= 0.033 ? "2m" : hoursLeft <= 0.5 ? "30m" : "2h";
  let median = SNIPE_TABLE[tier]?.[window] ?? 20;

  if (momentum !== null) {
    if (momentum > 50) median *= 1.15;
    else if (momentum < 5) median *= 0.85;
  }
  if (compUpside !== null) {
    if (compUpside > 100) median *= 1.20;
    else if (compUpside < -20) median *= 0.80;
  }

  const expectedSurgePct = Math.round(median * 10) / 10;
  const expectedHammer = Math.round(bid * (1 + expectedSurgePct / 100));
  const intensity = expectedSurgePct >= 50 ? "EXPLOSIVE" : expectedSurgePct >= 30 ? "HIGH"
    : expectedSurgePct >= 15 ? "MODERATE" : expectedSurgePct >= 5 ? "LOW" : "MINIMAL";

  return { expectedSurgePct, expectedHammer, intensity };
}

// ─── WAR ROOM ───
// Real-time view of auctions closing within 6 hours — the action zone

async function warRoom(supabase: ReturnType<typeof createClient>) {
  const { data: closing } = await supabase.rpc("execute_sql", {
    query: `
      WITH latest_pred AS (
        SELECT DISTINCT ON (vehicle_id)
          vehicle_id, predicted_hammer, current_bid as pred_bid,
          comp_median, comp_count, confidence_score, time_window,
          predicted_low, predicted_high
        FROM hammer_predictions
        ORDER BY vehicle_id, predicted_at DESC
      ),
      bid_activity AS (
        SELECT
          vehicle_id,
          COUNT(*) as bids_last_hour,
          MAX(bid_amount)::int as max_bid_1h,
          COUNT(DISTINCT bidder_name) FILTER (WHERE bidder_name IS NOT NULL) as unique_bidders_1h
        FROM bat_bids
        WHERE bid_timestamp > NOW() - INTERVAL '1 hour'
        GROUP BY vehicle_id
      ),
      paper_pos AS (
        SELECT vehicle_id, entry_price::int as entry, predicted_hammer::int as pt_predicted
        FROM paper_trades
        WHERE closed_at IS NULL
      )
      SELECT
        el.vehicle_id,
        v.year, v.make, v.model,
        el.current_bid::int as bid,
        el.listing_url,
        to_char(el.end_date, 'HH24:MI') as closes_at,
        ROUND(EXTRACT(EPOCH FROM (el.end_date - NOW())) / 60) as minutes_left,
        lp.predicted_hammer::int as predicted,
        lp.comp_median::int as comp_med,
        lp.comp_count,
        lp.confidence_score::int as confidence,
        lp.predicted_low::int as pred_low,
        lp.predicted_high::int as pred_high,
        ba.bids_last_hour,
        ba.unique_bidders_1h,
        pp.entry as paper_entry,
        pp.pt_predicted as paper_predicted,
        CASE WHEN lp.predicted_hammer IS NOT NULL AND el.current_bid > 0
          THEN ROUND(((lp.predicted_hammer - el.current_bid)::float / el.current_bid * 100)::numeric, 1)
        END as upside_pct
      FROM external_listings el
      JOIN vehicles v ON v.id = el.vehicle_id
      LEFT JOIN latest_pred lp ON lp.vehicle_id = el.vehicle_id
      LEFT JOIN bid_activity ba ON ba.vehicle_id = el.vehicle_id
      LEFT JOIN paper_pos pp ON pp.vehicle_id = el.vehicle_id
      WHERE el.platform = 'bat'
        AND el.listing_status = 'active'
        AND el.end_date > NOW()
        AND el.end_date < NOW() + INTERVAL '6 hours'
        AND el.current_bid > 0
      ORDER BY el.end_date ASC
    `,
  });

  const auctions = safeArray(closing).map(a => {
    const bid = Number(a.bid) || 0;
    const minutesLeft = Number(a.minutes_left) || 0;
    const hoursLeft = minutesLeft / 60;
    const surge = computeSnipeSurgeInline(bid, hoursLeft,
      null, // don't have 24h momentum here, but it's fine
      a.comp_med ? ((Number(a.comp_med) - bid) / bid * 100) : null
    );

    // Urgency level
    let urgency: string;
    if (minutesLeft <= 2) urgency = "NOW NOW NOW";
    else if (minutesLeft <= 10) urgency = "IMMINENT";
    else if (minutesLeft <= 30) urgency = "CLOSING SOON";
    else if (minutesLeft <= 120) urgency = "APPROACHING";
    else urgency = "ON DECK";

    // Activity heat
    const bidsLastHour = Number(a.bids_last_hour) || 0;
    const heat = bidsLastHour >= 10 ? "ON FIRE" : bidsLastHour >= 5 ? "HOT"
      : bidsLastHour >= 2 ? "WARM" : bidsLastHour >= 1 ? "TEPID" : "COLD";

    return {
      vehicle: `${a.year} ${a.make} ${a.model}`,
      vehicle_id: a.vehicle_id,
      bid: bid,
      closes_at: a.closes_at,
      minutes_left: minutesLeft,
      urgency,
      predicted_hammer: a.predicted,
      upside_pct: a.upside_pct,
      prediction_range: a.pred_low && a.pred_high
        ? `$${Number(a.pred_low).toLocaleString()} - $${Number(a.pred_high).toLocaleString()}`
        : null,
      snipe_surge: {
        expected_bump_pct: surge.expectedSurgePct,
        expected_hammer: surge.expectedHammer,
        intensity: surge.intensity,
      },
      activity: {
        bids_last_hour: bidsLastHour,
        unique_bidders_1h: a.unique_bidders_1h,
        heat,
      },
      paper_trade: a.paper_entry ? {
        entry_price: a.paper_entry,
        predicted_at_entry: a.paper_predicted,
        unrealized_pnl: bid - Number(a.paper_entry),
      } : null,
      listing_url: a.listing_url,
    };
  });

  return {
    timestamp: new Date().toISOString(),
    closing_within_6h: auctions.length,
    closing_within_1h: auctions.filter(a => a.minutes_left <= 60).length,
    closing_within_10m: auctions.filter(a => a.minutes_left <= 10).length,
    auctions,
  };
}
