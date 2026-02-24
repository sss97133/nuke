/**
 * PAPER TRADE AUTO-PILOT
 *
 * Automatically manages paper trades based on prediction signals.
 * Runs on cron (every 15 minutes) to:
 * 1. Open new paper trades when buy signals trigger
 * 2. Close paper trades when auctions end
 * 3. Track P&L and strategy performance
 *
 * Also computes a "snipe surge score" predicting how much
 * each auction's price will jump in the final minutes.
 *
 * POST /functions/v1/paper-trade-autopilot
 *   { "action": "run" }            → run autopilot cycle (cron)
 *   { "action": "status" }         → portfolio status with P&L
 *   { "action": "snipe_scores" }   → snipe surge predictions for all active auctions
 *   { "action": "close_trade", "trade_id": "..." }  → manually close a trade
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
  return [];
}

// ─── SNIPE SURGE MODEL ───
// Based on backtest analysis of 280+ auctions: median final bump by price tier and time window
// These represent "how much does the price typically rise from current bid to hammer"
const SNIPE_PREMIUM_TABLE: Record<string, Record<string, { median: number; p25: number; p75: number }>> = {
  under_5k:  { "2h": { median: 56.4, p25: 20, p75: 120 }, "30m": { median: 48.0, p25: 15, p75: 110 }, "2m": { median: 18.8, p25: 0, p75: 80 } },
  "5k_15k":  { "2h": { median: 48.9, p25: 18, p75: 85 },  "30m": { median: 44.9, p25: 14, p75: 75 },  "2m": { median: 9.6,  p25: 0, p75: 50 } },
  "15k_30k": { "2h": { median: 40.1, p25: 15, p75: 70 },  "30m": { median: 30.3, p25: 10, p75: 60 },  "2m": { median: 0,    p25: 0, p75: 35 } },
  "30k_60k": { "2h": { median: 25.2, p25: 8,  p75: 50 },  "30m": { median: 23.3, p25: 5,  p75: 45 },  "2m": { median: 0,    p25: 0, p75: 18 } },
  "60k_100k":{ "2h": { median: 13.6, p25: 5,  p75: 25 },  "30m": { median: 13.8, p25: 4,  p75: 22 },  "2m": { median: 8.6,  p25: 0, p75: 15 } },
  "100k_plus":{"2h": { median: 26.5, p25: 10, p75: 45 },  "30m": { median: 16.7, p25: 5,  p75: 35 },  "2m": { median: 1.6,  p25: 0, p75: 20 } },
};

function getPriceTierForSnipe(bid: number): string {
  if (bid < 5000) return "under_5k";
  if (bid < 15000) return "5k_15k";
  if (bid < 30000) return "15k_30k";
  if (bid < 60000) return "30k_60k";
  if (bid < 100000) return "60k_100k";
  return "100k_plus";
}

function getEffectiveWindow(hoursLeft: number): string {
  if (hoursLeft <= 0.033) return "2m";
  if (hoursLeft <= 0.5) return "30m";
  return "2h";
}

function computeSnipeSurge(bid: number, hoursLeft: number, bidMomentum: number | null, compUpside: number | null) {
  const tier = getPriceTierForSnipe(bid);
  const window = getEffectiveWindow(hoursLeft);
  const base = SNIPE_PREMIUM_TABLE[tier]?.[window] ?? { median: 20, p25: 5, p75: 40 };

  // Adjustments based on auction characteristics
  let adjustedMedian = base.median;
  let confidence = 50; // baseline confidence

  // Momentum boost: high bid velocity → more likely to surge
  if (bidMomentum !== null) {
    if (bidMomentum > 50) { adjustedMedian *= 1.15; confidence += 10; } // fast bidding
    else if (bidMomentum > 20) { adjustedMedian *= 1.05; confidence += 5; }
    else if (bidMomentum < 5) { adjustedMedian *= 0.85; confidence -= 10; } // stagnant
  }

  // Comp spread boost: if car is undervalued vs comps, more room to surge
  if (compUpside !== null) {
    if (compUpside > 100) { adjustedMedian *= 1.20; confidence += 15; } // huge gap
    else if (compUpside > 50) { adjustedMedian *= 1.10; confidence += 10; }
    else if (compUpside < -20) { adjustedMedian *= 0.80; confidence -= 10; } // overpriced
  }

  // Time proximity boost: closer to end → more confidence in estimate
  if (hoursLeft <= 0.5) confidence += 15;
  else if (hoursLeft <= 2) confidence += 10;
  else if (hoursLeft > 24) confidence -= 15;

  confidence = Math.max(10, Math.min(95, confidence));

  const expectedSurge = Math.round(adjustedMedian * 10) / 10;
  const expectedHammer = Math.round(bid * (1 + expectedSurge / 100));
  const surgeRange = {
    low: Math.round(bid * (1 + base.p25 / 100)),
    high: Math.round(bid * (1 + base.p75 / 100)),
  };

  // Classify surge intensity
  let intensity: string;
  if (expectedSurge >= 50) intensity = "EXPLOSIVE";
  else if (expectedSurge >= 30) intensity = "HIGH";
  else if (expectedSurge >= 15) intensity = "MODERATE";
  else if (expectedSurge >= 5) intensity = "LOW";
  else intensity = "MINIMAL";

  return {
    expected_surge_pct: expectedSurge,
    expected_hammer: expectedHammer,
    surge_range: surgeRange,
    intensity,
    confidence,
    tier,
    window,
  };
}

// ─── TRADE STRATEGIES ───
interface Strategy {
  name: string;
  minUpside: number;   // minimum predicted upside to enter
  minComps: number;     // minimum comp count
  minConfidence: number;// minimum confidence score
  maxBid: number;       // max bid as fraction of predicted hammer
}

const STRATEGIES: Strategy[] = [
  { name: "sniper",       minUpside: 5,  minComps: 0, minConfidence: 0,  maxBid: 0.98 },
  { name: "aggressive",   minUpside: 10, minComps: 0, minConfidence: 20, maxBid: 0.95 },
  { name: "moderate",     minUpside: 15, minComps: 1, minConfidence: 30, maxBid: 0.90 },
  { name: "conservative", minUpside: 20, minComps: 2, minConfidence: 40, maxBid: 0.85 },
];

// BaT buyer's premium is 5%
const BAT_BUYER_PREMIUM = 0.05;
// Estimated seller fee (assume 5% for flipping)
const ESTIMATED_SELLER_FEE = 0.05;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const action = body.action || "run";

  try {
    switch (action) {
      case "run":
        return json(await runAutopilot(supabase));
      case "status":
        return json(await portfolioStatus(supabase));
      case "snipe_scores":
        return json(await snipeScores(supabase));
      case "close_trade":
        return json(await closeTrade(supabase, body.trade_id));
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e: unknown) {
    console.error("[paper-trade-autopilot]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ─── AUTOPILOT CYCLE ───

async function runAutopilot(supabase: ReturnType<typeof createClient>) {
  const startTime = Date.now();
  const log: string[] = [];

  // 1. Get current buy signals (active predictions with upside)
  const { data: signals } = await supabase.rpc("execute_sql", {
    query: `
      WITH latest_pred AS (
        SELECT DISTINCT ON (vehicle_id)
          id as prediction_id, vehicle_id, predicted_hammer, current_bid,
          comp_median, comp_count, confidence_score, time_window,
          predicted_at, predicted_low, predicted_high
        FROM hammer_predictions
        ORDER BY vehicle_id, predicted_at DESC
      )
      SELECT
        lp.prediction_id,
        lp.vehicle_id,
        v.year, v.make, v.model,
        el.current_bid::int as live_bid,
        lp.predicted_hammer::int as predicted,
        lp.comp_median::int as comp_med,
        lp.comp_count,
        lp.confidence_score::int as confidence,
        lp.time_window,
        ROUND(EXTRACT(EPOCH FROM (el.end_date - NOW())) / 3600, 1) as hours_left,
        ROUND(((lp.predicted_hammer - el.current_bid)::float / NULLIF(el.current_bid, 0) * 100)::numeric, 1) as upside_pct,
        el.listing_url
      FROM latest_pred lp
      JOIN vehicles v ON v.id = lp.vehicle_id
      JOIN external_listings el ON el.vehicle_id = lp.vehicle_id AND el.platform = 'bat'
      WHERE el.listing_status = 'active'
        AND el.end_date > NOW()
        AND el.current_bid > 0
        AND lp.predicted_hammer > el.current_bid
    `,
  });

  // 2. Get existing open trades to avoid duplicates
  const { data: openTrades } = await supabase.rpc("execute_sql", {
    query: `SELECT vehicle_id FROM paper_trades WHERE closed_at IS NULL`,
  });
  const openVehicleIds = new Set(safeArray(openTrades).map(t => t.vehicle_id));

  // 3. Open new trades
  let opened = 0;
  const newTrades: Array<Record<string, unknown>> = [];

  for (const sig of safeArray(signals)) {
    if (openVehicleIds.has(sig.vehicle_id)) continue;

    const upside = Number(sig.upside_pct) || 0;
    const comps = Number(sig.comp_count) || 0;
    const conf = Number(sig.confidence) || 0;
    const bid = Number(sig.live_bid) || 0;
    const predicted = Number(sig.predicted) || 0;

    // Find the most conservative strategy this signal qualifies for (auto-pilot safety)
    // Check from conservative → moderate only (skip sniper/aggressive for autopilot)
    let bestStrategy: Strategy | null = null;
    const autoStrategies = STRATEGIES.filter(s => s.name === "conservative" || s.name === "moderate");
    for (const strat of autoStrategies) {
      if (upside >= strat.minUpside && comps >= strat.minComps && conf >= strat.minConfidence) {
        bestStrategy = strat;
        break;
      }
    }

    if (!bestStrategy) continue;

    // Calculate fees and expected profit
    const buyerFee = Math.round(bid * BAT_BUYER_PREMIUM);
    const sellerFee = Math.round(predicted * ESTIMATED_SELLER_FEE);
    const totalCost = bid + buyerFee;
    const expectedProceeds = predicted - sellerFee;
    const expectedProfit = expectedProceeds - totalCost;

    // Only enter if expected profit is positive after fees
    if (expectedProfit <= 0) continue;

    const vehicle = `${sig.year} ${sig.make} ${sig.model}`;
    log.push(`OPEN: ${vehicle} @ $${bid.toLocaleString()} → pred $${predicted.toLocaleString()} (${upside}% upside, ${bestStrategy.name})`);

    // Insert paper trade
    const { error } = await supabase.from("paper_trades").insert({
      vehicle_id: sig.vehicle_id,
      prediction_id: sig.prediction_id,
      entry_price: bid,
      predicted_hammer: predicted,
      predicted_flip_profit: expectedProfit,
      estimated_buyer_fee: buyerFee,
      estimated_seller_fee: sellerFee,
      rationale: `Auto-${bestStrategy.name}: ${upside}% upside, ${comps} comps, ${conf}% conf, window=${sig.time_window}`,
      platform: "bat",
    });

    if (error) {
      log.push(`  ERROR inserting trade: ${error.message}`);
    } else {
      opened++;
      newTrades.push({
        vehicle,
        vehicle_id: sig.vehicle_id,
        entry_price: bid,
        predicted_hammer: predicted,
        upside_pct: upside,
        strategy: bestStrategy.name,
        expected_profit: expectedProfit,
      });
    }
  }

  // 4. Close trades for ended auctions
  const { data: closeable } = await supabase.rpc("execute_sql", {
    query: `
      SELECT
        pt.id as trade_id,
        pt.vehicle_id,
        pt.entry_price::int as entry,
        pt.predicted_hammer::int as predicted,
        el.final_price::int as hammer,
        el.listing_status,
        v.year, v.make, v.model
      FROM paper_trades pt
      JOIN external_listings el ON el.vehicle_id = pt.vehicle_id AND el.platform = 'bat'
      JOIN vehicles v ON v.id = pt.vehicle_id
      WHERE pt.closed_at IS NULL
        AND (el.listing_status IN ('sold', 'unsold', 'ended') OR el.end_date < NOW() - INTERVAL '2 hours')
    `,
  });

  let closed = 0;
  const closedTrades: Array<Record<string, unknown>> = [];

  for (const row of safeArray(closeable)) {
    const hammer = Number(row.hammer) || 0;
    const entry = Number(row.entry) || 0;
    const status = String(row.listing_status);
    const vehicle = `${row.year} ${row.make} ${row.model}`;

    let actualProfit: number;
    let profitable: boolean;

    if (status === "unsold" || hammer === 0) {
      // Reserve not met or no sale — we wouldn't have bought
      actualProfit = 0;
      profitable = false; // neutral, not a loss
      log.push(`CLOSE (no sale): ${vehicle} — reserve not met`);
    } else {
      // Calculate actual P&L
      const buyerFee = Math.round(hammer * BAT_BUYER_PREMIUM);
      const sellerFee = Math.round(hammer * ESTIMATED_SELLER_FEE);
      const totalCost = hammer + buyerFee; // we'd pay hammer + buyer premium
      const proceeds = hammer - sellerFee; // if we flip at same price (conservative)
      // More realistic: we bought at entry price (our bid), car sold for hammer
      // If hammer > entry, we got a deal; if hammer < entry, we overpaid
      actualProfit = hammer - entry; // simple P&L: we entered at entry, value is hammer
      profitable = actualProfit > 0;
      const pnlStr = actualProfit >= 0 ? `+$${actualProfit.toLocaleString()}` : `-$${Math.abs(actualProfit).toLocaleString()}`;
      log.push(`CLOSE: ${vehicle} — hammer $${hammer.toLocaleString()}, P&L: ${pnlStr}`);
    }

    const errorPct = entry > 0 ? Math.round(((Number(row.predicted) - hammer) / hammer) * 1000) / 10 : null;

    const { error } = await supabase
      .from("paper_trades")
      .update({
        actual_hammer: hammer || null,
        actual_profit: actualProfit,
        profitable,
        call_accuracy_pct: errorPct,
        closed_at: new Date().toISOString(),
      })
      .eq("id", row.trade_id);

    if (error) {
      log.push(`  ERROR closing trade: ${error.message}`);
    } else {
      closed++;
      closedTrades.push({
        vehicle,
        entry,
        hammer,
        actual_profit: actualProfit,
        profitable,
      });
    }
  }

  const elapsed = Date.now() - startTime;

  return {
    timestamp: new Date().toISOString(),
    elapsed_ms: elapsed,
    signals_found: safeArray(signals).length,
    already_open: openVehicleIds.size,
    trades_opened: opened,
    trades_closed: closed,
    new_trades: newTrades,
    closed_trades: closedTrades,
    log,
  };
}

// ─── PORTFOLIO STATUS ───

async function portfolioStatus(supabase: ReturnType<typeof createClient>) {
  // Open positions
  const { data: open } = await supabase.rpc("execute_sql", {
    query: `
      SELECT
        pt.id, pt.vehicle_id,
        v.year, v.make, v.model,
        pt.entry_price::int as entry,
        pt.predicted_hammer::int as predicted,
        pt.predicted_flip_profit::int as expected_profit,
        pt.rationale,
        el.current_bid::int as live_bid,
        ROUND(EXTRACT(EPOCH FROM (el.end_date - NOW())) / 3600, 1) as hours_left,
        el.listing_url,
        to_char(pt.entry_time, 'MM-DD HH24:MI') as opened_at
      FROM paper_trades pt
      JOIN vehicles v ON v.id = pt.vehicle_id
      JOIN external_listings el ON el.vehicle_id = pt.vehicle_id AND el.platform = 'bat'
      WHERE pt.closed_at IS NULL
      ORDER BY el.end_date ASC
    `,
  });

  // Closed positions
  const { data: closed } = await supabase.rpc("execute_sql", {
    query: `
      SELECT
        pt.id, pt.vehicle_id,
        v.year, v.make, v.model,
        pt.entry_price::int as entry,
        pt.predicted_hammer::int as predicted,
        pt.actual_hammer::int as hammer,
        pt.actual_profit::int as profit,
        pt.profitable,
        pt.call_accuracy_pct,
        pt.rationale,
        to_char(pt.entry_time, 'MM-DD HH24:MI') as opened_at,
        to_char(pt.closed_at, 'MM-DD HH24:MI') as closed_at
      FROM paper_trades pt
      JOIN vehicles v ON v.id = pt.vehicle_id
      WHERE pt.closed_at IS NOT NULL
      ORDER BY pt.closed_at DESC
    `,
  });

  const openArr = safeArray(open);
  const closedArr = safeArray(closed);

  // Calculate portfolio metrics
  const totalInvested = closedArr.reduce((s, t) => s + (Number(t.entry) || 0), 0);
  const totalProfit = closedArr.reduce((s, t) => s + (Number(t.profit) || 0), 0);
  const wins = closedArr.filter(t => t.profitable === true).length;
  const losses = closedArr.filter(t => t.profitable === false && Number(t.hammer) > 0).length;
  const noSales = closedArr.filter(t => !t.hammer || Number(t.hammer) === 0).length;

  // Open position unrealized P&L
  const openExposure = openArr.reduce((s, t) => s + (Number(t.entry) || 0), 0);
  const expectedProfit = openArr.reduce((s, t) => s + (Number(t.expected_profit) || 0), 0);

  // Live unrealized P&L based on current bids
  const unrealizedPnL = openArr.reduce((s, t) => {
    const liveBid = Number(t.live_bid) || 0;
    const entry = Number(t.entry) || 0;
    return s + (liveBid - entry);
  }, 0);

  return {
    timestamp: new Date().toISOString(),
    summary: {
      open_positions: openArr.length,
      closed_trades: closedArr.length,
      win_rate: closedArr.length > 0 ? `${Math.round(wins / Math.max(wins + losses, 1) * 100)}%` : "N/A",
      wins,
      losses,
      no_sales: noSales,
      total_invested: totalInvested,
      total_profit: totalProfit,
      roi: totalInvested > 0 ? `${(totalProfit / totalInvested * 100).toFixed(1)}%` : "N/A",
      open_exposure: openExposure,
      expected_profit: expectedProfit,
      unrealized_pnl: unrealizedPnL,
    },
    open_positions: openArr.map(t => {
      const liveBid = Number(t.live_bid) || 0;
      const entry = Number(t.entry) || 0;
      const unrealized = liveBid - entry;
      return {
        trade_id: t.id,
        vehicle: `${t.year} ${t.make} ${t.model}`,
        entry_price: entry,
        live_bid: liveBid,
        predicted_hammer: t.predicted,
        unrealized_pnl: unrealized,
        unrealized_pct: entry > 0 ? `${(unrealized / entry * 100).toFixed(1)}%` : "0%",
        hours_left: t.hours_left,
        strategy: t.rationale,
        opened_at: t.opened_at,
        listing_url: t.listing_url,
      };
    }),
    closed_trades: closedArr.map(t => ({
      vehicle: `${t.year} ${t.make} ${t.model}`,
      entry: t.entry,
      predicted: t.predicted,
      hammer: t.hammer,
      profit: t.profit,
      profitable: t.profitable,
      prediction_error: t.call_accuracy_pct ? `${t.call_accuracy_pct}%` : null,
      strategy: t.rationale,
      opened_at: t.opened_at,
      closed_at: t.closed_at,
    })),
  };
}

// ─── SNIPE SCORES ───

async function snipeScores(supabase: ReturnType<typeof createClient>) {
  const { data: auctions } = await supabase.rpc("execute_sql", {
    query: `
      WITH bid_vel AS (
        SELECT
          vehicle_id,
          COUNT(*) as bid_count_24h,
          CASE WHEN COUNT(*) > 1
            THEN (MAX(bid_amount) - MIN(bid_amount))::float / NULLIF(MIN(bid_amount), 0) * 100
            ELSE 0
          END as momentum_pct
        FROM bat_bids
        WHERE bid_timestamp > NOW() - INTERVAL '24 hours'
        GROUP BY vehicle_id
      ),
      latest_pred AS (
        SELECT DISTINCT ON (vehicle_id)
          vehicle_id, comp_median, comp_count, predicted_hammer
        FROM hammer_predictions
        ORDER BY vehicle_id, predicted_at DESC
      )
      SELECT
        el.vehicle_id,
        v.year, v.make, v.model,
        el.current_bid::int as bid,
        ROUND(EXTRACT(EPOCH FROM (el.end_date - NOW())) / 3600, 1) as hours_left,
        el.listing_url,
        bv.momentum_pct,
        lp.comp_median::int as comp_med,
        lp.comp_count,
        lp.predicted_hammer::int as predicted,
        CASE WHEN lp.comp_median IS NOT NULL AND el.current_bid > 0
          THEN ROUND(((lp.comp_median - el.current_bid)::float / NULLIF(el.current_bid, 0) * 100)::numeric, 1)
          ELSE NULL
        END as comp_upside_pct
      FROM external_listings el
      JOIN vehicles v ON v.id = el.vehicle_id
      LEFT JOIN bid_vel bv ON bv.vehicle_id = el.vehicle_id
      LEFT JOIN latest_pred lp ON lp.vehicle_id = el.vehicle_id
      WHERE el.platform = 'bat'
        AND el.listing_status = 'active'
        AND el.end_date > NOW()
        AND el.current_bid > 0
      ORDER BY el.end_date ASC
    `,
  });

  const scored = safeArray(auctions).map(a => {
    const bid = Number(a.bid) || 0;
    const hoursLeft = Number(a.hours_left) || 999;
    const momentum = a.momentum_pct !== null ? Number(a.momentum_pct) : null;
    const compUpside = a.comp_upside_pct !== null ? Number(a.comp_upside_pct) : null;

    const surge = computeSnipeSurge(bid, hoursLeft, momentum, compUpside);

    return {
      vehicle: `${a.year} ${a.make} ${a.model}`,
      vehicle_id: a.vehicle_id,
      current_bid: bid,
      hours_left: hoursLeft,
      predicted_hammer: a.predicted,
      snipe_surge: {
        expected_bump_pct: surge.expected_surge_pct,
        expected_hammer: surge.expected_hammer,
        range: `$${surge.surge_range.low.toLocaleString()} - $${surge.surge_range.high.toLocaleString()}`,
        intensity: surge.intensity,
        confidence: surge.confidence,
        price_tier: surge.tier,
        time_bucket: surge.window,
      },
      listing_url: a.listing_url,
    };
  });

  // Sort by expected surge (most explosive first)
  scored.sort((a, b) =>
    (b.snipe_surge.expected_bump_pct ?? 0) - (a.snipe_surge.expected_bump_pct ?? 0)
  );

  return {
    timestamp: new Date().toISOString(),
    total_auctions: scored.length,
    explosive: scored.filter(s => s.snipe_surge.intensity === "EXPLOSIVE").length,
    high: scored.filter(s => s.snipe_surge.intensity === "HIGH").length,
    auctions: scored,
  };
}

// ─── MANUAL CLOSE ───

async function closeTrade(supabase: ReturnType<typeof createClient>, tradeId: string) {
  if (!tradeId) return { error: "trade_id required" };

  const { error } = await supabase
    .from("paper_trades")
    .update({
      closed_at: new Date().toISOString(),
      rationale: "Manually closed",
    })
    .eq("id", tradeId);

  if (error) return { error: error.message };
  return { success: true, trade_id: tradeId, message: "Trade closed" };
}
