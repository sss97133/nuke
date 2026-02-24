/**
 * BACKTEST HAMMER SIMULATOR
 *
 * Replays historical auctions at all 7 time windows, produces a 6x7 accuracy
 * heatmap, and suggests better coefficients.
 *
 * Modes:
 * - full_backtest:        Replay auctions at all time windows → MAPE + accuracy matrix
 * - compare_models:       Run same dataset through 2 model versions, diff the matrices
 * - tune_sniper:          Test sniper premium parameter variations → find min-MAPE set
 * - suggest_coefficients: Compute optimal multiplier per cell via weighted median
 * - cross_validate:       Time-ordered train/test split → overfit gap measurement
 * - auto_retrain:         Train new coefficients, validate on test set, save only if improved
 *
 * POST /functions/v1/backtest-hammer-simulator
 * Body: { mode, limit?, lookback_days?, model_version?, compare_version?, auto_save? }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getPriceTier,
  getTimeWindow,
  estimateSniperPremiumPct,
  computeAdjustmentFactor,
  computeStalenessCorrection,
  computeVelocityCorrection,
  getStalenessLevel,
  getVelocityLevel,
  getTierDriftCorrection,
  getBidPositionCorrection,
  getMakeCorrection,
  getEngagementLevel,
  getCompetitionLevel,
  getBidBlendAlpha,
  getBidCountCorrection,
  getCompBidRatioCorrection,
  loadCoefficients,
  loadMakeCorrections,
  CURRENT_MODEL_VERSION,
  PRICE_TIERS,
  TIME_WINDOWS,
  type CoefficientMap,
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

// 55s hard limit (edge function max is 60s; leave 5s buffer)
const TIME_BUDGET_MS = 55_000;
const DETAIL_BATCH_SIZE = 500;

interface BacktestRow {
  vehicle_id: string;
  final_price: number;
  close_time: string;
  view_count: number;
  watcher_count: number;
  bid_count: number;
  year: number;
  make: string;
  model: string;
  bid_48h: number | null;
  bid_24h: number | null;
  bid_12h: number | null;
  bid_6h: number | null;
  bid_2h: number | null;
  bid_30m: number | null;
  bid_2m: number | null;
  bidders_48h: number;
  bidders_24h: number;
  bidders_12h: number;
  bidders_6h: number;
  bidders_2h: number;
  bidders_30m: number;
  bidders_2m: number;
  bids_48h: number;
  bids_24h: number;
  bids_12h: number;
  bids_6h: number;
  bids_2h: number;
  bids_30m: number;
  bids_2m: number;
  // Last bid timestamp at each window (for staleness calculation)
  last_bid_ts_48h: string | null;
  last_bid_ts_24h: string | null;
  last_bid_ts_12h: string | null;
  last_bid_ts_6h: string | null;
  last_bid_ts_2h: string | null;
  last_bid_ts_30m: string | null;
  last_bid_ts_2m: string | null;
  comment_count: number;
  comp_median: number | null;
  comp_count: number;
}

// Time window metadata: label → { hours remaining for getTimeWindow, interval SQL }
const WINDOW_DEFS = [
  { key: "48h", hours: 48 },
  { key: "24h", hours: 24 },
  { key: "12h", hours: 12 },
  { key: "6h", hours: 6 },
  { key: "2h", hours: 2 },
  { key: "30m", hours: 0.5 },
  { key: "2m", hours: 0.033 },
] as const;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body =
      req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const mode = body.mode || "full_backtest";

    switch (mode) {
      case "full_backtest":
        return jsonResponse(
          await fullBacktest(supabase, body, startTime)
        );
      case "compare_models":
        return jsonResponse(
          await compareModels(supabase, body, startTime)
        );
      case "tune_sniper":
        return jsonResponse(
          await tuneSniper(supabase, body, startTime)
        );
      case "suggest_coefficients":
        return jsonResponse(
          await suggestCoefficients(supabase, body, startTime)
        );
      case "cross_validate":
        return jsonResponse(
          await crossValidate(supabase, body, startTime)
        );
      case "auto_retrain":
        return jsonResponse(
          await autoRetrain(supabase, body, startTime)
        );
      case "derive_corrections":
        return jsonResponse(
          await deriveCorrections(supabase, body, startTime)
        );
      case "health_check":
        return jsonResponse(
          await healthCheck(supabase, body, startTime)
        );
      default:
        return jsonResponse({ error: `Unknown mode: ${mode}` }, 400);
    }
  } catch (e: unknown) {
    console.error("[backtest-hammer-simulator] Error:", e);
    const msg = e instanceof Error
      ? e.message
      : typeof e === "object" && e !== null
        ? JSON.stringify(e)
        : String(e);
    return jsonResponse({ error: msg }, 500);
  }
});

// ─── DATA FETCHING ───

async function fetchBacktestData(
  supabase: ReturnType<typeof createClient>,
  limit: number,
  lookbackDays: number
): Promise<BacktestRow[]> {
  const { data, error } = await supabase.rpc("execute_sql", {
    query: `
      WITH auction_pool AS (
        SELECT
          el.vehicle_id, el.final_price, el.end_date as close_time,
          el.view_count, el.watcher_count, el.bid_count,
          v.year, v.make, v.model
        FROM external_listings el
        JOIN vehicles v ON v.id = el.vehicle_id
        WHERE el.platform = 'bat'
          AND el.listing_status = 'sold'
          AND el.final_price > 0
          AND el.end_date IS NOT NULL
          AND el.end_date >= NOW() - INTERVAL '${lookbackDays} days'
          -- Filter non-vehicle items (signs, parts, memorabilia)
          AND UPPER(v.make) NOT IN ('ILLUMINATED', 'HALF-SCALE', 'NEON', 'ORIGINAL')
          AND LOWER(COALESCE(v.model, '')) NOT SIMILAR TO '%(sign|signs|poster|seats|engine only|wheels only|parts lot)%'
        ORDER BY el.end_date DESC
        LIMIT ${limit}
      ),
      -- Use CROSS JOIN with time offsets to get bid snapshots at all windows in one pass
      time_offsets(label, ivl) AS (
        VALUES
          ('48h', INTERVAL '48 hours'),
          ('24h', INTERVAL '24 hours'),
          ('12h', INTERVAL '12 hours'),
          ('6h',  INTERVAL '6 hours'),
          ('2h',  INTERVAL '2 hours'),
          ('30m', INTERVAL '30 minutes'),
          ('2m',  INTERVAL '2 minutes')
      ),
      bid_snapshots AS (
        SELECT
          ap.vehicle_id, ap.final_price, ap.close_time,
          ap.view_count, ap.watcher_count, ap.bid_count,
          ap.year, ap.make, ap.model,
          MAX(bb.bid_amount) FILTER (WHERE bb.bid_timestamp <= ap.close_time - (SELECT ivl FROM time_offsets WHERE label = '48h')) as bid_48h,
          MAX(bb.bid_amount) FILTER (WHERE bb.bid_timestamp <= ap.close_time - (SELECT ivl FROM time_offsets WHERE label = '24h')) as bid_24h,
          MAX(bb.bid_amount) FILTER (WHERE bb.bid_timestamp <= ap.close_time - (SELECT ivl FROM time_offsets WHERE label = '12h')) as bid_12h,
          MAX(bb.bid_amount) FILTER (WHERE bb.bid_timestamp <= ap.close_time - (SELECT ivl FROM time_offsets WHERE label = '6h')) as bid_6h,
          MAX(bb.bid_amount) FILTER (WHERE bb.bid_timestamp <= ap.close_time - (SELECT ivl FROM time_offsets WHERE label = '2h')) as bid_2h,
          MAX(bb.bid_amount) FILTER (WHERE bb.bid_timestamp <= ap.close_time - (SELECT ivl FROM time_offsets WHERE label = '30m')) as bid_30m,
          MAX(bb.bid_amount) FILTER (WHERE bb.bid_timestamp <= ap.close_time - (SELECT ivl FROM time_offsets WHERE label = '2m')) as bid_2m,
          -- Unique bidders at each window
          COUNT(DISTINCT bb.bat_username) FILTER (WHERE bb.bid_timestamp <= ap.close_time - INTERVAL '48 hours') as bidders_48h,
          COUNT(DISTINCT bb.bat_username) FILTER (WHERE bb.bid_timestamp <= ap.close_time - INTERVAL '24 hours') as bidders_24h,
          COUNT(DISTINCT bb.bat_username) FILTER (WHERE bb.bid_timestamp <= ap.close_time - INTERVAL '12 hours') as bidders_12h,
          COUNT(DISTINCT bb.bat_username) FILTER (WHERE bb.bid_timestamp <= ap.close_time - INTERVAL '6 hours') as bidders_6h,
          COUNT(DISTINCT bb.bat_username) FILTER (WHERE bb.bid_timestamp <= ap.close_time - INTERVAL '2 hours') as bidders_2h,
          COUNT(DISTINCT bb.bat_username) FILTER (WHERE bb.bid_timestamp <= ap.close_time - INTERVAL '30 minutes') as bidders_30m,
          COUNT(DISTINCT bb.bat_username) FILTER (WHERE bb.bid_timestamp <= ap.close_time - INTERVAL '2 minutes') as bidders_2m,
          -- Bid counts at each window
          COUNT(*) FILTER (WHERE bb.bid_timestamp <= ap.close_time - INTERVAL '48 hours') as bids_48h,
          COUNT(*) FILTER (WHERE bb.bid_timestamp <= ap.close_time - INTERVAL '24 hours') as bids_24h,
          COUNT(*) FILTER (WHERE bb.bid_timestamp <= ap.close_time - INTERVAL '12 hours') as bids_12h,
          COUNT(*) FILTER (WHERE bb.bid_timestamp <= ap.close_time - INTERVAL '6 hours') as bids_6h,
          COUNT(*) FILTER (WHERE bb.bid_timestamp <= ap.close_time - INTERVAL '2 hours') as bids_2h,
          COUNT(*) FILTER (WHERE bb.bid_timestamp <= ap.close_time - INTERVAL '30 minutes') as bids_30m,
          COUNT(*) FILTER (WHERE bb.bid_timestamp <= ap.close_time - INTERVAL '2 minutes') as bids_2m,
          -- Last bid timestamp at each window (for staleness calculation)
          MAX(bb.bid_timestamp) FILTER (WHERE bb.bid_timestamp <= ap.close_time - INTERVAL '48 hours') as last_bid_ts_48h,
          MAX(bb.bid_timestamp) FILTER (WHERE bb.bid_timestamp <= ap.close_time - INTERVAL '24 hours') as last_bid_ts_24h,
          MAX(bb.bid_timestamp) FILTER (WHERE bb.bid_timestamp <= ap.close_time - INTERVAL '12 hours') as last_bid_ts_12h,
          MAX(bb.bid_timestamp) FILTER (WHERE bb.bid_timestamp <= ap.close_time - INTERVAL '6 hours') as last_bid_ts_6h,
          MAX(bb.bid_timestamp) FILTER (WHERE bb.bid_timestamp <= ap.close_time - INTERVAL '2 hours') as last_bid_ts_2h,
          MAX(bb.bid_timestamp) FILTER (WHERE bb.bid_timestamp <= ap.close_time - INTERVAL '30 minutes') as last_bid_ts_30m,
          MAX(bb.bid_timestamp) FILTER (WHERE bb.bid_timestamp <= ap.close_time - INTERVAL '2 minutes') as last_bid_ts_2m
        FROM auction_pool ap
        LEFT JOIN bat_bids bb ON bb.vehicle_id = ap.vehicle_id AND bb.bid_amount > 0 AND bb.bat_username != 'bid_snapshot'
        GROUP BY ap.vehicle_id, ap.final_price, ap.close_time,
                 ap.view_count, ap.watcher_count, ap.bid_count,
                 ap.year, ap.make, ap.model
      )
      SELECT * FROM bid_snapshots
    `,
  });

  if (error) throw error;
  const rows = (data ?? []) as BacktestRow[];

  // Fetch comment counts in a separate query (avoids timeout from joining auction_comments)
  if (rows.length > 0) {
    const vehicleIds = rows.map((r) => r.vehicle_id);
    const { data: ccData } = await supabase.rpc("execute_sql", {
      query: `
        SELECT vehicle_id, COUNT(*) as cnt
        FROM auction_comments
        WHERE vehicle_id = ANY(ARRAY[${vehicleIds.map((id) => `'${id}'`).join(",")}]::uuid[])
        GROUP BY vehicle_id
      `,
    });
    if (ccData) {
      const ccMap = new Map<string, number>();
      for (const row of ccData as Array<{ vehicle_id: string; cnt: string }>) {
        ccMap.set(row.vehicle_id, Number(row.cnt));
      }
      for (const row of rows) {
        row.comment_count = ccMap.get(row.vehicle_id) ?? 0;
      }
    }

    // Fetch comp medians using a single efficient JOIN query
    // Build a VALUES table of unique make+model combos, join against sold listings
    const makeModelPairs = new Map<string, { make: string; modelBase: string; year: number }>();
    for (const row of rows) {
      const modelBase = (row.model || "").split(/\s+/).filter(Boolean).slice(0, 2).join(" ");
      const key = `${(row.make || "").toUpperCase()}|${modelBase}`;
      if (!makeModelPairs.has(key)) {
        makeModelPairs.set(key, { make: row.make, modelBase, year: row.year });
      }
    }

    if (makeModelPairs.size > 0) {
      // Batch comp lookups in chunks of 30 to avoid statement timeout
      const allEntries = [...makeModelPairs.entries()];
      const COMP_BATCH_SIZE = 30;
      const compResults: Array<{ make_model_key: string; comp_count: string; comp_median: string | null }> = [];

      for (let bi = 0; bi < allEntries.length; bi += COMP_BATCH_SIZE) {
        const batch = allEntries.slice(bi, bi + COMP_BATCH_SIZE);
        const valueRows = batch.map(([key, { make, modelBase, year }]) => {
          const safeMake = (make || "").replace(/'/g, "''").toLowerCase();
          const safeModel = (modelBase || "").replace(/'/g, "''").toLowerCase();
          const yearMin = (year || 1900) - 5;
          const yearMax = (year || 2100) + 5;
          return `('${key.replace(/'/g, "''")}', '${safeMake}', '%${safeModel}%', ${yearMin}, ${yearMax})`;
        });

        const { data: batchData } = await supabase.rpc("execute_sql", {
          query: `
            WITH targets(make_model_key, make_lower, model_pattern, year_min, year_max) AS (
              VALUES ${valueRows.join(", ")}
            )
            SELECT t.make_model_key,
              COUNT(*) as comp_count,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY el.final_price) as comp_median
            FROM targets t
            JOIN vehicles v ON lower(v.make) = t.make_lower
              AND lower(v.model) LIKE t.model_pattern
              AND v.year BETWEEN t.year_min AND t.year_max
              AND v.is_public = true
            JOIN external_listings el ON el.vehicle_id = v.id
              AND el.platform = 'bat'
              AND el.listing_status = 'sold'
              AND el.final_price > 0
              AND el.end_date >= NOW() - INTERVAL '12 months'
            WHERE lower(v.model) NOT SIMILAR TO '%(parts|engine|seats|wheels|door|hood|trunk|bumper|fender|transmission)%'
            GROUP BY t.make_model_key
          `,
        });
        if (batchData) compResults.push(...(batchData as typeof compResults));
      }

      const compData = compResults;

      const compMap = new Map<string, { median: number | null; count: number }>();
      if (compData) {
        for (const cr of compData as Array<{ make_model_key: string; comp_count: string; comp_median: string | null }>) {
          compMap.set(cr.make_model_key, {
            median: cr.comp_median ? Number(cr.comp_median) : null,
            count: Number(cr.comp_count) || 0,
          });
        }
      }

      for (const row of rows) {
        const modelBase = (row.model || "").split(/\s+/).filter(Boolean).slice(0, 2).join(" ");
        const key = `${(row.make || "").toUpperCase()}|${modelBase}`;
        const comp = compMap.get(key);
        row.comp_median = comp?.median ?? null;
        row.comp_count = comp?.count ?? 0;
      }
    }
  }

  return rows;
}

// ─── HELPERS ───

// Get the bid from the prior (larger) time window for momentum calculation.
// Prior window for 2h is 6h, for 6h is 12h, etc.
const PRIOR_WINDOW: Record<string, string | null> = {
  "2m": "30m",
  "30m": "2h",
  "2h": "6h",
  "6h": "12h",
  "12h": "24h",
  "24h": "48h",
  "48h": null,
};

function getBidAtWindow(
  row: BacktestRow,
  window: string
): { bid: number | null; bidders: number; bids: number; hoursSinceLastBid: number | null; bidVelocityPct: number | null } {
  const w = window as "48h" | "24h" | "12h" | "6h" | "2h" | "30m" | "2m";
  const lastBidTs = row[`last_bid_ts_${w}` as keyof BacktestRow] as string | null;
  const closeTime = new Date(row.close_time).getTime();
  const windowHours = WINDOW_DEFS.find(d => d.key === w)?.hours ?? 0;
  const windowTime = closeTime - windowHours * 3600 * 1000;
  let hoursSinceLastBid: number | null = null;
  if (lastBidTs) {
    const lastBidTime = new Date(lastBidTs).getTime();
    hoursSinceLastBid = (windowTime - lastBidTime) / (3600 * 1000);
    if (hoursSinceLastBid < 0) hoursSinceLastBid = 0;
  }
  const bid = row[`bid_${w}` as keyof BacktestRow] as number | null;

  // Compute velocity: % growth from prior window bid
  let bidVelocityPct: number | null = null;
  const priorKey = PRIOR_WINDOW[w];
  if (priorKey && bid && bid > 0) {
    const priorBid = row[`bid_${priorKey}` as keyof BacktestRow] as number | null;
    if (priorBid && priorBid > 0) {
      bidVelocityPct = (bid - priorBid) / priorBid;
    }
  }

  return {
    bid,
    bidders: Number(row[`bidders_${w}` as keyof BacktestRow]) || 0,
    bids: Number(row[`bids_${w}` as keyof BacktestRow]) || 0,
    hoursSinceLastBid,
    bidVelocityPct,
  };
}

function getBidAtPriorWindow(row: BacktestRow, windowKey: string): number | null {
  const prior = PRIOR_WINDOW[windowKey];
  if (!prior) return null;
  return row[`bid_${prior}` as keyof BacktestRow] as number | null;
}

function predictAtWindow(
  bid: number,
  coefficients: CoefficientMap,
  watcher_count: number,
  bidsAtWindow: number,
  biddersAtWindow: number,
  windowKey: string,
  commentCount: number,
  hoursRemaining: number,
  make?: string,
  sniperOverride?: (bid: number, bwr: number, bidders: number) => number,
  compMedian?: number | null,
  compCount?: number,
  bidAtPriorWindow?: number | null,
  skipCorrections?: boolean,
  hoursSinceLastBid?: number | null,
  bidVelocityPct?: number | null,
  makeCorrections?: Record<string, number>,
  compWeightOverride?: number | null,
  compRatioMax?: number | null,
  compWeightMap?: Record<string, number> | null,
  compCountMin?: number,
  postBlendCompWeight?: number | null
): { predicted: number; multiplier: number; sniperPct: number; adjustmentFactor: number } | null {
  const priceTier = getPriceTier(bid);
  const key = `${priceTier}:${windowKey}`;
  const coeff = coefficients.get(key);
  if (!coeff) return null;

  const bidToWatcher =
    watcher_count > 0 ? bidsAtWindow / watcher_count : 0;
  const sniperPct = sniperOverride
    ? sniperOverride(bid, bidToWatcher, biddersAtWindow)
    : estimateSniperPremiumPct(bid, bidToWatcher, biddersAtWindow);

  // Engagement + competition adjustment (skip for raw prediction during correction derivation)
  const adjFactor = skipCorrections ? 1.0
    : computeAdjustmentFactor(bid, commentCount, biddersAtWindow, hoursRemaining).factor;

  // Per-make correction (uses DB corrections when provided, fallback otherwise)
  const makeCorr = skipCorrections ? 1.0 : getMakeCorrection(make, hoursRemaining, makeCorrections);

  // Bid staleness correction (v17)
  const stalenessCorr = skipCorrections ? 1.0
    : computeStalenessCorrection(hoursSinceLastBid ?? null, hoursRemaining).factor;

  // Bid velocity correction (v18)
  const velCorr = skipCorrections ? 1.0
    : computeVelocityCorrection(bidVelocityPct ?? null, bid, hoursRemaining).factor;

  // Per-tier drift correction (v19)
  const tierDrift = skipCorrections ? 1.0 : getTierDriftCorrection(priceTier);

  // Within-tier bid position correction (v20)
  const bidPos = skipCorrections ? 1.0 : getBidPositionCorrection(bid, priceTier);

  const basePrediction = bid * coeff.median * adjFactor * makeCorr * stalenessCorr * velCorr * tierDrift * bidPos * (1 + sniperPct / 100);

  // Comp-based blending (v32→v33→v35): comp_count >= 1, cc-adaptive weight.
  // v33: 25% at 48h/24h (early windows), 16% elsewhere. MAPE 19.3% → 19.2%.
  // v35: cc=1 gets 60% weight — single-comp matches have 2.1% error vs model's 16.2%.
  let predicted: number;
  const compRatioOk = compRatioMax == null || !compMedian || bid <= 0 || (compMedian / bid) <= compRatioMax;
  if (!skipCorrections && compMedian && compMedian > 0 && (compCount ?? 0) >= (compCountMin ?? 1) && compRatioOk) {
    // v35: cc=1 adaptive weight (60%), otherwise v33 window-aware default
    const baseCompWeight = hoursRemaining > 12 ? 0.25 : 0.16;
    const defaultCompWeight = (compCount === 1) ? 0.60 : baseCompWeight;
    const compWeight = compWeightMap?.[`${priceTier}:${windowKey}`]
      ?? compWeightMap?.[priceTier]
      ?? (compWeightOverride != null ? compWeightOverride : defaultCompWeight);
    predicted = Math.round(basePrediction * (1 - compWeight) + compMedian * compWeight);
  } else {
    predicted = Math.round(basePrediction);
  }

  // Bid-count correction (v27): reduce over-prediction for low-activity auctions
  if (!skipCorrections) {
    const bidCountCorr = getBidCountCorrection(bidsAtWindow, hoursRemaining);
    if (bidCountCorr !== 1.0) {
      predicted = Math.round(predicted * bidCountCorr);
    }
  }

  // Bid blend (v22→v24): staleness-conditional alpha
  // Fresh auctions: α=0.93, stale auctions: α=0.75, 2m: α=0.0
  if (!skipCorrections) {
    const bidBlendAlpha = getBidBlendAlpha(hoursRemaining, hoursSinceLastBid ?? null, bidVelocityPct ?? null, biddersAtWindow ?? null);
    predicted = Math.round(bidBlendAlpha * predicted + (1 - bidBlendAlpha) * bid);
  }

  // v34→v35: Post-bid-blend comp recovery at late windows.
  // At 2m (α=0) and 30m (α≤0.85), bid blend collapses prediction toward bid.
  // v35: cc=1 comps have 2.1% error — use full 60% weight even at late windows.
  //   cc>=2 keeps conservative 5% recovery.
  if (!skipCorrections && compMedian && compMedian > 0 && (compCount ?? 0) >= (compCountMin ?? 1)) {
    const bidBlendAlpha = getBidBlendAlpha(hoursRemaining, hoursSinceLastBid ?? null, bidVelocityPct ?? null, biddersAtWindow ?? null);
    const defaultPostBlendWeight = bidBlendAlpha < 0.5
      ? (compCount === 1 ? 0.60 : 0.05)  // v35: cc=1 gets 60%, cc>=2 gets 5%
      : 0;
    const effectivePostBlendWeight = postBlendCompWeight != null
      ? postBlendCompWeight  // explicit override
      : defaultPostBlendWeight;
    if (effectivePostBlendWeight > 0) {
      predicted = Math.round(predicted * (1 - effectivePostBlendWeight) + compMedian * effectivePostBlendWeight);
    }
  }

  return { predicted, multiplier: coeff.median * adjFactor * makeCorr * stalenessCorr * velCorr * tierDrift * bidPos, sniperPct, adjustmentFactor: adjFactor };
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface CellStats {
  n: number;
  mape: number;
  bias: number;
  within_5pct: number;
  within_10pct: number;
  optimal_multiplier: number | null;
  low_confidence: boolean;
}

function buildMatrix(
  details: Array<{
    price_tier: string;
    time_window: string;
    abs_error_pct: number;
    error_pct: number;
    optimal_multiplier: number | null;
  }>
): Record<string, CellStats> {
  const cells: Record<
    string,
    {
      errors: number[];
      signedErrors: number[];
      optMults: number[];
    }
  > = {};

  for (const d of details) {
    const key = `${d.price_tier}:${d.time_window}`;
    if (!cells[key]) {
      cells[key] = { errors: [], signedErrors: [], optMults: [] };
    }
    cells[key].errors.push(Math.min(d.abs_error_pct, MAX_ERROR_PCT_FOR_MAPE));
    cells[key].signedErrors.push(Math.max(-MAX_ERROR_PCT_FOR_MAPE, Math.min(d.error_pct, MAX_ERROR_PCT_FOR_MAPE)));
    if (d.optimal_multiplier !== null && isFinite(d.optimal_multiplier)) {
      cells[key].optMults.push(d.optimal_multiplier);
    }
  }

  const matrix: Record<string, CellStats> = {};
  for (const [key, cell] of Object.entries(cells)) {
    const n = cell.errors.length;
    matrix[key] = {
      n,
      mape: Math.round((cell.errors.reduce((a, b) => a + b, 0) / n) * 10) / 10,
      bias: Math.round((cell.signedErrors.reduce((a, b) => a + b, 0) / n) * 10) / 10,
      within_5pct: cell.errors.filter((e) => e < 5).length,
      within_10pct: cell.errors.filter((e) => e < 10).length,
      optimal_multiplier:
        cell.optMults.length > 0
          ? Math.round(median(cell.optMults) * 1000) / 1000
          : null,
      low_confidence: n < 10,
    };
  }
  return matrix;
}

async function insertDetails(
  supabase: ReturnType<typeof createClient>,
  runId: string,
  details: Array<Record<string, unknown>>
) {
  // Bulk insert in chunks
  for (let i = 0; i < details.length; i += DETAIL_BATCH_SIZE) {
    const batch = details.slice(i, i + DETAIL_BATCH_SIZE);
    const { error } = await supabase
      .from("backtest_run_details")
      .insert(batch);
    if (error) {
      console.error(
        `[backtest] Detail insert error at batch ${i}:`,
        error.message
      );
    }
  }
}

function timeBudgetExceeded(startTime: number): boolean {
  return Date.now() - startTime > TIME_BUDGET_MS;
}

// Skip predictions where the bid is too low to be meaningful —
// e.g. $100 starting bid on a $200k car. The model uses price-tier
// coefficients trained on cars that SELL in that tier, not on early
// low bids that happen to fall there.
const MIN_BID_FOR_BACKTEST = 2000; // under_2k has 65% CV — inherently unpredictable, poisons coefficients
const MAX_HAMMER_TO_BID_RATIO = 15;
const MIN_HAMMER_TO_BID_RATIO = 0.5; // filter out bogus "sold" where hammer << bid (reserve-not-met, data errors)
const MAX_ERROR_PCT_FOR_MAPE = 500; // cap individual errors so outliers don't destroy MAPE

// ─── MODE: full_backtest ───

async function fullBacktest(
  supabase: ReturnType<typeof createClient>,
  body: {
    limit?: number;
    lookback_days?: number;
    model_version?: number;
    sniper_base_override?: number;
    comp_weight?: number;
    comp_ratio_max?: number;
    comp_weight_map?: Record<string, number>;
    comp_count_min?: number;
    post_blend_comp_weight?: number;
  },
  startTime: number
) {
  const limit = body.limit || 200;
  const lookbackDays = body.lookback_days || 90;
  const modelVersion = body.model_version || CURRENT_MODEL_VERSION;
  const compWeightOverride = body.comp_weight != null ? body.comp_weight : null;
  const compRatioMax = body.comp_ratio_max != null ? body.comp_ratio_max : null;
  const compWeightMap = body.comp_weight_map || null;
  const compCountMin = body.comp_count_min ?? 1; // v32: default to 1 (single-comp OK)
  const postBlendCompWeight = body.post_blend_comp_weight != null ? body.post_blend_comp_weight : null;
  const sniperOverrideFn = body.sniper_base_override !== undefined
    ? (_b: number, _bwr: number, _bidders: number) => Math.max(0, body.sniper_base_override!)
    : undefined;

  // Create run record
  const { data: run, error: runErr } = await supabase
    .from("backtest_runs")
    .insert({
      mode: "full_backtest",
      model_version: modelVersion,
      lookback_days: lookbackDays,
      limit_requested: limit,
      status: "running",
    })
    .select("id")
    .single();
  if (runErr) throw runErr;
  const runId = run.id;

  try {
    const [coefficients, dbMakeCorrections] = await Promise.all([
      loadCoefficients(supabase, modelVersion),
      loadMakeCorrections(supabase, modelVersion),
    ]);
    const rows = await fetchBacktestData(supabase, limit, lookbackDays);

    if (rows.length === 0) {
      await supabase
        .from("backtest_runs")
        .update({
          status: "completed",
          auction_count: 0,
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
        })
        .eq("id", runId);
      return { success: true, run_id: runId, message: "No auction data" };
    }

    const allDetails: Array<Record<string, unknown>> = [];
    const matrixInput: Array<{
      price_tier: string;
      time_window: string;
      abs_error_pct: number;
      error_pct: number;
      optimal_multiplier: number | null;
    }> = [];

    let totalAbsError = 0;
    let totalError = 0;
    let totalPredictions = 0;
    let within5 = 0;
    let within10 = 0;
    let within20 = 0;
    let intervalHits = 0; // actual within p25-p75 range
    let intervalTotal = 0;
    const intervalByWindow: Record<string, { hits: number; total: number; widthSum: number }> = {};
    let partial = false;

    for (const row of rows) {
      if (timeBudgetExceeded(startTime)) {
        partial = true;
        break;
      }

      const actual = Number(row.final_price);

      for (const wDef of WINDOW_DEFS) {
        const snap = getBidAtWindow(row, wDef.key);
        if (!snap.bid || snap.bid <= 0) continue;

        const bid = Number(snap.bid);
        // Skip outliers: low bids, extreme hammer-to-bid ratios, or bogus sold data
        if (bid < MIN_BID_FOR_BACKTEST || actual / bid > MAX_HAMMER_TO_BID_RATIO || actual / bid < MIN_HAMMER_TO_BID_RATIO) continue;
        const priceTier = getPriceTier(bid);
        const pred = predictAtWindow(
          bid,
          coefficients,
          Number(row.watcher_count) || 0,
          snap.bids,
          snap.bidders,
          wDef.key,
          Number(row.comment_count) || 0,
          wDef.hours,
          row.make,
          sniperOverrideFn,
          row.comp_median,
          row.comp_count,
          getBidAtPriorWindow(row, wDef.key),
          false,
          snap.hoursSinceLastBid,
          snap.bidVelocityPct,
          dbMakeCorrections,
          compWeightOverride,
          compRatioMax,
          compWeightMap,
          compCountMin,
          postBlendCompWeight
        );
        if (!pred) continue;

        const errorPct = ((pred.predicted - actual) / actual) * 100;
        const absError = Math.abs(errorPct);

        // Optimal multiplier: actual / (bid * (1 + sniper/100))
        const optMult =
          bid > 0 && pred.sniperPct >= 0
            ? actual / (bid * (1 + pred.sniperPct / 100))
            : null;

        // Interval coverage: check if actual falls within p25-p75 bounds
        const cellKey = `${priceTier}:${wDef.key}`;
        const cellCoeff = coefficients.get(cellKey);
        if (cellCoeff?.p25 != null && cellCoeff?.p75 != null) {
          const corrFactor = pred.adjustmentFactor * (pred.multiplier / (cellCoeff.median * pred.adjustmentFactor));
          const lowBound = bid * cellCoeff.p25 * corrFactor;
          const highBound = bid * cellCoeff.p75 * corrFactor;
          // Apply bid blend to bounds
          const alpha = getBidBlendAlpha(wDef.hours, snap.hoursSinceLastBid ?? null, snap.bidVelocityPct ?? null, snap.bidders ?? null);
          let blendedLow = alpha * lowBound + (1 - alpha) * bid;
          let blendedHigh = alpha * highBound + (1 - alpha) * bid;
          // Minimum interval width at 2m (matches predictionEngine.ts floor)
          if (alpha < 0.1) {
            const minLow = bid * 0.98;
            const minHigh = bid * 1.08;
            if (blendedLow > minLow) blendedLow = minLow;
            if (blendedHigh < minHigh) blendedHigh = minHigh;
          }
          // v26: Confidence-adaptive interval width
          if (alpha >= 0.1) {
            let conf = 50;
            if (wDef.hours < 2) conf += 20;
            else if (wDef.hours < 6) conf += 10;
            else if (wDef.hours > 24) conf -= 15;
            if (snap.bids >= 20) conf += 10;
            else if (snap.bids >= 10) conf += 5;
            else if (snap.bids < 3) conf -= 15;
            if (snap.bidders >= 8) conf += 5;
            else if (snap.bidders <= 2) conf -= 10;
            if (bid < 5000) conf -= 15;
            else if (bid < 10000) conf -= 8;
            else if (bid >= 30000) conf += 5;
            const pbRatio = pred.predicted / Math.max(bid, 1);
            if (pbRatio < 1.15) conf += 15;
            else if (pbRatio < 1.30) conf += 5;
            else if (pbRatio > 1.80) conf -= 20;
            else if (pbRatio > 1.60) conf -= 10;
            conf = Math.max(5, Math.min(95, conf));
            const scale = conf <= 25 ? 1.3 : conf <= 40 ? 1.12 : 1.0;
            if (scale !== 1.0) {
              const hw = (blendedHigh - blendedLow) / 2;
              const center = (blendedHigh + blendedLow) / 2;
              blendedLow = center - hw * scale;
              blendedHigh = center + hw * scale;
            }
          }
          intervalTotal++;
          if (actual >= blendedLow && actual <= blendedHigh) intervalHits++;
          // Per-window interval tracking
          if (!intervalByWindow[wDef.key]) intervalByWindow[wDef.key] = { hits: 0, total: 0, widthSum: 0 };
          intervalByWindow[wDef.key].total++;
          if (actual >= blendedLow && actual <= blendedHigh) intervalByWindow[wDef.key].hits++;
          intervalByWindow[wDef.key].widthSum += (blendedHigh - blendedLow) / ((blendedHigh + blendedLow) / 2) * 100;
        }

        // Cap error contribution for MAPE robustness
        const cappedAbsError = Math.min(absError, MAX_ERROR_PCT_FOR_MAPE);
        const cappedError = Math.max(-MAX_ERROR_PCT_FOR_MAPE, Math.min(errorPct, MAX_ERROR_PCT_FOR_MAPE));
        totalAbsError += cappedAbsError;
        totalError += cappedError;
        totalPredictions++;
        if (absError < 5) within5++;
        if (absError < 10) within10++;
        if (absError < 20) within20++;

        const detail = {
          run_id: runId,
          vehicle_id: row.vehicle_id,
          actual_hammer: actual,
          close_time: row.close_time,
          time_window: wDef.key,
          bid_at_window: bid,
          price_tier: priceTier,
          predicted_hammer: pred.predicted,
          multiplier_used: pred.multiplier,
          sniper_pct_used: Math.round(pred.sniperPct * 10) / 10,
          error_pct: Math.round(errorPct * 10) / 10,
          abs_error_pct: Math.round(absError * 10) / 10,
          optimal_multiplier: optMult
            ? Math.round(optMult * 1000) / 1000
            : null,
          comp_median: row.comp_median ?? null,
          comp_count: row.comp_count ?? null,
        };

        allDetails.push(detail);
        matrixInput.push({
          price_tier: priceTier,
          time_window: wDef.key,
          abs_error_pct: absError,
          error_pct: errorPct,
          optimal_multiplier: optMult,
        });
      }
    }

    // Insert detail rows
    await insertDetails(supabase, runId, allDetails);

    const n = totalPredictions || 1;
    const mape = Math.round((totalAbsError / n) * 10) / 10;
    const matrix = buildMatrix(matrixInput);

    // Update run record
    await supabase
      .from("backtest_runs")
      .update({
        status: partial ? "partial" : "completed",
        auction_count: rows.length,
        mape,
        median_ape: null, // would need sorting all errors
        bias_pct: Math.round((totalError / n) * 10) / 10,
        within_5pct_rate: Math.round((within5 / n) * 1000) / 10,
        within_10pct_rate: Math.round((within10 / n) * 1000) / 10,
        within_20pct_rate: Math.round((within20 / n) * 1000) / 10,
        tier_window_matrix: matrix,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
      })
      .eq("id", runId);

    return {
      success: true,
      run_id: runId,
      status: partial ? "partial" : "completed",
      model_version: modelVersion,
      comp_weight_override: compWeightOverride,
      comp_weight_map: compWeightMap,
      comp_count_min: compCountMin,
      comp_ratio_max: compRatioMax,
      post_blend_comp_weight: postBlendCompWeight,
      auctions: rows.length,
      total_predictions: totalPredictions,
      accuracy: {
        mape,
        bias_pct: Math.round((totalError / n) * 10) / 10,
        within_5pct: `${within5}/${n} (${Math.round((within5 / n) * 1000) / 10}%)`,
        within_10pct: `${within10}/${n} (${Math.round((within10 / n) * 1000) / 10}%)`,
        within_20pct: `${within20}/${n} (${Math.round((within20 / n) * 1000) / 10}%)`,
        interval_coverage: intervalTotal > 0
          ? `${intervalHits}/${intervalTotal} (${Math.round((intervalHits / intervalTotal) * 1000) / 10}%)`
          : "N/A",
        interval_by_window: Object.fromEntries(
          Object.entries(intervalByWindow).map(([w, s]) => [w, {
            coverage: `${s.hits}/${s.total} (${Math.round((s.hits / s.total) * 1000) / 10}%)`,
            avg_width_pct: Math.round(s.widthSum / s.total * 10) / 10,
          }])
        ),
      },
      tier_window_matrix: matrix,
      duration_ms: Date.now() - startTime,
    };
  } catch (e) {
    await supabase
      .from("backtest_runs")
      .update({
        status: "failed",
        error_message: e instanceof Error ? e.message : String(e),
        duration_ms: Date.now() - startTime,
      })
      .eq("id", runId);
    throw e;
  }
}

// ─── MODE: compare_models ───

async function compareModels(
  supabase: ReturnType<typeof createClient>,
  body: {
    limit?: number;
    lookback_days?: number;
    model_version?: number;
    compare_version?: number;
  },
  startTime: number
) {
  const limit = body.limit || 200;
  const lookbackDays = body.lookback_days || 90;
  const versionA = body.model_version || CURRENT_MODEL_VERSION;
  const versionB = body.compare_version || 2;

  const { data: run, error: runErr } = await supabase
    .from("backtest_runs")
    .insert({
      mode: "compare_models",
      model_version: versionA,
      compare_model_version: versionB,
      lookback_days: lookbackDays,
      limit_requested: limit,
      status: "running",
    })
    .select("id")
    .single();
  if (runErr) throw runErr;
  const runId = run.id;

  try {
    const [coeffA, coeffB, dbMakeCorrA, dbMakeCorrB, rows] = await Promise.all([
      loadCoefficients(supabase, versionA),
      loadCoefficients(supabase, versionB),
      loadMakeCorrections(supabase, versionA),
      loadMakeCorrections(supabase, versionB),
      fetchBacktestData(supabase, limit, lookbackDays),
    ]);

    if (rows.length === 0) {
      await supabase
        .from("backtest_runs")
        .update({
          status: "completed",
          auction_count: 0,
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
        })
        .eq("id", runId);
      return { success: true, run_id: runId, message: "No auction data" };
    }

    const errorsA: Array<{
      price_tier: string;
      time_window: string;
      abs_error_pct: number;
      error_pct: number;
      optimal_multiplier: number | null;
    }> = [];
    const errorsB: typeof errorsA = [];
    let mapeA = 0,
      mapeB = 0,
      countA = 0,
      countB = 0;

    for (const row of rows) {
      if (timeBudgetExceeded(startTime)) break;
      const actual = Number(row.final_price);

      for (const wDef of WINDOW_DEFS) {
        const snap = getBidAtWindow(row, wDef.key);
        if (!snap.bid || snap.bid <= 0) continue;
        const bid = Number(snap.bid);
        // Apply same outlier filters as full_backtest
        if (bid < MIN_BID_FOR_BACKTEST || actual / bid > MAX_HAMMER_TO_BID_RATIO || actual / bid < MIN_HAMMER_TO_BID_RATIO) continue;
        const priceTier = getPriceTier(bid);

        for (const [coeffs, errs, side, makeCorr] of [
          [coeffA, errorsA, "A", dbMakeCorrA],
          [coeffB, errorsB, "B", dbMakeCorrB],
        ] as const) {
          const pred = predictAtWindow(
            bid,
            coeffs as CoefficientMap,
            Number(row.watcher_count) || 0,
            snap.bids,
            snap.bidders,
            wDef.key,
            Number(row.comment_count) || 0,
            wDef.hours,
            row.make,
            undefined,
            row.comp_median,
            row.comp_count,
            getBidAtPriorWindow(row, wDef.key),
            false,
            snap.hoursSinceLastBid,
            snap.bidVelocityPct,
            makeCorr as Record<string, number>
          );
          if (!pred) continue;
          const errorPct = ((pred.predicted - actual) / actual) * 100;
          const absError = Math.abs(errorPct);
          (errs as typeof errorsA).push({
            price_tier: priceTier,
            time_window: wDef.key,
            abs_error_pct: absError,
            error_pct: errorPct,
            optimal_multiplier: null,
          });
          if (side === "A") {
            mapeA += absError;
            countA++;
          } else {
            mapeB += absError;
            countB++;
          }
        }
      }
    }

    const matrixA = buildMatrix(errorsA);
    const matrixB = buildMatrix(errorsB);

    // Build comparison diff
    const diff: Record<
      string,
      { mape_a: number; mape_b: number; delta: number; improved: boolean }
    > = {};
    const allKeys = new Set([
      ...Object.keys(matrixA),
      ...Object.keys(matrixB),
    ]);
    let improvedCells = 0;
    let degradedCells = 0;
    for (const key of allKeys) {
      const a = matrixA[key]?.mape ?? null;
      const b = matrixB[key]?.mape ?? null;
      if (a !== null && b !== null) {
        const delta = Math.round((b - a) * 10) / 10;
        diff[key] = { mape_a: a, mape_b: b, delta, improved: delta < 0 };
        if (delta < 0) improvedCells++;
        else if (delta > 0) degradedCells++;
      }
    }

    await supabase
      .from("backtest_runs")
      .update({
        status: "completed",
        auction_count: rows.length,
        mape: countA > 0 ? Math.round((mapeA / countA) * 10) / 10 : null,
        tier_window_matrix: matrixA,
        comparison_diff: {
          version_a: versionA,
          version_b: versionB,
          mape_a:
            countA > 0 ? Math.round((mapeA / countA) * 10) / 10 : null,
          mape_b:
            countB > 0 ? Math.round((mapeB / countB) * 10) / 10 : null,
          improved_cells: improvedCells,
          degraded_cells: degradedCells,
          cells: diff,
        },
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
      })
      .eq("id", runId);

    return {
      success: true,
      run_id: runId,
      auctions: rows.length,
      version_a: {
        model_version: versionA,
        mape: countA > 0 ? Math.round((mapeA / countA) * 10) / 10 : null,
        predictions: countA,
      },
      version_b: {
        model_version: versionB,
        mape: countB > 0 ? Math.round((mapeB / countB) * 10) / 10 : null,
        predictions: countB,
      },
      improved_cells: improvedCells,
      degraded_cells: degradedCells,
      cell_diff: diff,
      duration_ms: Date.now() - startTime,
    };
  } catch (e) {
    await supabase
      .from("backtest_runs")
      .update({
        status: "failed",
        error_message: e instanceof Error ? e.message : String(e),
        duration_ms: Date.now() - startTime,
      })
      .eq("id", runId);
    throw e;
  }
}

// ─── MODE: tune_sniper ───

async function tuneSniper(
  supabase: ReturnType<typeof createClient>,
  body: {
    limit?: number;
    lookback_days?: number;
    model_version?: number;
  },
  startTime: number
) {
  const limit = body.limit || 200;
  const lookbackDays = body.lookback_days || 90;
  const modelVersion = body.model_version || CURRENT_MODEL_VERSION;

  const { data: run, error: runErr } = await supabase
    .from("backtest_runs")
    .insert({
      mode: "tune_sniper",
      model_version: modelVersion,
      lookback_days: lookbackDays,
      limit_requested: limit,
      status: "running",
    })
    .select("id")
    .single();
  if (runErr) throw runErr;
  const runId = run.id;

  try {
    const [coefficients, dbMakeCorrections] = await Promise.all([
      loadCoefficients(supabase, modelVersion),
      loadMakeCorrections(supabase, modelVersion),
    ]);
    const rows = await fetchBacktestData(supabase, limit, lookbackDays);

    if (rows.length === 0) {
      await supabase
        .from("backtest_runs")
        .update({
          status: "completed",
          auction_count: 0,
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
        })
        .eq("id", runId);
      return { success: true, run_id: runId, message: "No auction data" };
    }

    // Test different base sniper premium values
    const baseValues = [0, 1, 2, 3, 4.17, 5, 6, 7, 8, 10];
    const results: Array<{
      sniper_base: number;
      mape: number;
      predictions: number;
    }> = [];

    for (const base of baseValues) {
      if (timeBudgetExceeded(startTime)) break;

      // Create a custom sniper function with this base
      const sniperFn = (
        bid: number,
        bwr: number,
        bidders: number
      ): number => {
        let adj = base;
        if (bid < 15000) adj += 3;
        else if (bid < 30000) adj += 1.5;
        else if (bid < 60000) adj += 0;
        else if (bid < 100000) adj -= 1.5;
        else adj -= 3;
        if (bwr > 0.05) adj += 2;
        else if (bwr > 0.04) adj += 0.5;
        else if (bwr < 0.03) adj -= 1.5;
        if (bidders >= 10) adj += 1.5;
        else if (bidders >= 6) adj += 0.5;
        else if (bidders <= 2) adj -= 2;
        return Math.max(0, adj);
      };

      let totalAbsError = 0;
      let count = 0;

      for (const row of rows) {
        const actual = Number(row.final_price);
        for (const wDef of WINDOW_DEFS) {
          const snap = getBidAtWindow(row, wDef.key);
          if (!snap.bid || snap.bid <= 0) continue;
          const bid = Number(snap.bid);
          // Apply same outlier filters as full_backtest
          if (bid < MIN_BID_FOR_BACKTEST || actual / bid > MAX_HAMMER_TO_BID_RATIO || actual / bid < MIN_HAMMER_TO_BID_RATIO) continue;

          const pred = predictAtWindow(
            bid,
            coefficients,
            Number(row.watcher_count) || 0,
            snap.bids,
            snap.bidders,
            wDef.key,
            Number(row.comment_count) || 0,
            wDef.hours,
            row.make,
            sniperFn,
            row.comp_median,
            row.comp_count,
            getBidAtPriorWindow(row, wDef.key),
            false,
            snap.hoursSinceLastBid,
            snap.bidVelocityPct,
            dbMakeCorrections
          );
          if (!pred) continue;

          const absError = Math.min(
            Math.abs(((pred.predicted - actual) / actual) * 100),
            MAX_ERROR_PCT_FOR_MAPE
          );
          totalAbsError += absError;
          count++;
        }
      }

      results.push({
        sniper_base: base,
        mape: count > 0 ? Math.round((totalAbsError / count) * 10) / 10 : 0,
        predictions: count,
      });
    }

    results.sort((a, b) => a.mape - b.mape);
    const best = results[0];

    await supabase
      .from("backtest_runs")
      .update({
        status: "completed",
        auction_count: rows.length,
        mape: best?.mape ?? null,
        sniper_tuning_results: {
          best_base: best?.sniper_base,
          best_mape: best?.mape,
          current_base: 4.17,
          all_results: results,
        },
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
      })
      .eq("id", runId);

    return {
      success: true,
      run_id: runId,
      auctions: rows.length,
      best_sniper_base: best?.sniper_base,
      best_mape: best?.mape,
      current_base: 4.17,
      current_vs_best: results.find((r) => r.sniper_base === 4.17),
      all_results: results,
      duration_ms: Date.now() - startTime,
    };
  } catch (e) {
    await supabase
      .from("backtest_runs")
      .update({
        status: "failed",
        error_message: e instanceof Error ? e.message : String(e),
        duration_ms: Date.now() - startTime,
      })
      .eq("id", runId);
    throw e;
  }
}

// ─── MODE: suggest_coefficients ───

async function suggestCoefficients(
  supabase: ReturnType<typeof createClient>,
  body: {
    limit?: number;
    lookback_days?: number;
    model_version?: number;
    auto_save?: boolean;
    sniper_base_override?: number;
  },
  startTime: number
) {
  const limit = body.limit || 200;
  const lookbackDays = body.lookback_days || 90;
  const modelVersion = body.model_version || CURRENT_MODEL_VERSION;
  const autoSave = body.auto_save || false;
  const sniperBaseOverride = body.sniper_base_override;

  const { data: run, error: runErr } = await supabase
    .from("backtest_runs")
    .insert({
      mode: "suggest_coefficients",
      model_version: modelVersion,
      lookback_days: lookbackDays,
      limit_requested: limit,
      status: "running",
    })
    .select("id")
    .single();
  if (runErr) throw runErr;
  const runId = run.id;

  try {
    const [coefficients, dbMakeCorrections] = await Promise.all([
      loadCoefficients(supabase, modelVersion),
      loadMakeCorrections(supabase, modelVersion),
    ]);
    const rows = await fetchBacktestData(supabase, limit, lookbackDays);

    if (rows.length === 0) {
      await supabase
        .from("backtest_runs")
        .update({
          status: "completed",
          auction_count: 0,
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
        })
        .eq("id", runId);
      return { success: true, run_id: runId, message: "No auction data" };
    }

    // Collect optimal multipliers per cell
    const cellMults: Record<string, number[]> = {};
    const allDetails: Array<Record<string, unknown>> = [];

    for (const row of rows) {
      if (timeBudgetExceeded(startTime)) break;
      const actual = Number(row.final_price);

      for (const wDef of WINDOW_DEFS) {
        const snap = getBidAtWindow(row, wDef.key);
        if (!snap.bid || snap.bid <= 0) continue;
        const bid = Number(snap.bid);
        // Apply same outlier filters as full_backtest
        if (bid < MIN_BID_FOR_BACKTEST || actual / bid > MAX_HAMMER_TO_BID_RATIO || actual / bid < MIN_HAMMER_TO_BID_RATIO) continue;
        const priceTier = getPriceTier(bid);

        const bidToWatcher =
          Number(row.watcher_count) > 0
            ? snap.bids / Number(row.watcher_count)
            : 0;
        // Use override sniper base if provided (e.g., 0 to bake all premium into multipliers)
        const sniperPct = sniperBaseOverride !== undefined
          ? Math.max(0, sniperBaseOverride) // simplified: just use the base directly
          : estimateSniperPremiumPct(bid, bidToWatcher, snap.bidders);

        // Optimal multiplier: what multiplier would have given exact answer?
        // predicted = bid * mult * (1 + sniper/100) = actual
        // mult = actual / (bid * (1 + sniper/100))
        // Note: we deliberately use raw actual/bid (not dividing by adj_factor) because
        // the adj_factor-aware approach (v10) was tested and added noise to cheap cars.
        // The median of raw ratios already captures the average adjustment behavior.
        const denom = bid * (1 + sniperPct / 100);
        if (denom <= 0) continue;
        const optMult = actual / denom;

        const key = `${priceTier}:${wDef.key}`;
        if (!cellMults[key]) cellMults[key] = [];
        cellMults[key].push(optMult);

        // Also compute current prediction error for detail rows
        const pred = predictAtWindow(
          bid,
          coefficients,
          Number(row.watcher_count) || 0,
          snap.bids,
          snap.bidders,
          wDef.key,
          Number(row.comment_count) || 0,
          wDef.hours,
          row.make,
          undefined,
          row.comp_median,
          row.comp_count,
          getBidAtPriorWindow(row, wDef.key),
          false,
          snap.hoursSinceLastBid,
          snap.bidVelocityPct,
          dbMakeCorrections
        );

        allDetails.push({
          run_id: runId,
          vehicle_id: row.vehicle_id,
          actual_hammer: actual,
          close_time: row.close_time,
          time_window: wDef.key,
          bid_at_window: bid,
          price_tier: priceTier,
          predicted_hammer: pred?.predicted ?? null,
          multiplier_used: pred?.multiplier ?? null,
          sniper_pct_used: pred
            ? Math.round(pred.sniperPct * 10) / 10
            : null,
          error_pct: pred
            ? Math.round(
                (((pred.predicted - actual) / actual) * 100) * 10
              ) / 10
            : null,
          abs_error_pct: pred
            ? Math.round(
                (Math.abs((pred.predicted - actual) / actual) * 100) * 10
              ) / 10
            : null,
          optimal_multiplier: Math.round(optMult * 1000) / 1000,
        });
      }
    }

    await insertDetails(supabase, runId, allDetails);

    // Compute suggested coefficients: median of optimal multipliers per cell
    const suggested: Array<{
      price_tier: string;
      time_window: string;
      current_multiplier: number | null;
      suggested_multiplier: number;
      p25_multiplier: number;
      p75_multiplier: number;
      sample_size: number;
      low_confidence: boolean;
      delta: number | null;
    }> = [];

    for (const tier of PRICE_TIERS) {
      for (const window of TIME_WINDOWS) {
        const key = `${tier}:${window}`;
        const mults = cellMults[key];
        if (!mults || mults.length === 0) continue;

        const sorted = [...mults].sort((a, b) => a - b);
        const med = median(sorted);
        const p25Idx = Math.floor(sorted.length * 0.25);
        const p75Idx = Math.floor(sorted.length * 0.75);
        const p25 = sorted[p25Idx];
        const p75 = sorted[p75Idx];

        const current = coefficients.get(key);

        suggested.push({
          price_tier: tier,
          time_window: window,
          current_multiplier: current?.median ?? null,
          suggested_multiplier: Math.round(med * 1000) / 1000,
          p25_multiplier: Math.round(p25 * 1000) / 1000,
          p75_multiplier: Math.round(p75 * 1000) / 1000,
          sample_size: mults.length,
          low_confidence: mults.length < 10,
          delta: current
            ? Math.round((med - current.median) * 1000) / 1000
            : null,
        });
      }
    }

    // Auto-save as new model version if requested
    let savedVersion: number | null = null;
    if (autoSave && suggested.length > 0) {
      const { data: cv } = await supabase.rpc("execute_sql", {
        query: `SELECT COALESCE(MAX(model_version), 0) + 1 as next_version FROM prediction_model_coefficients`,
      });
      savedVersion = cv?.[0]?.next_version ?? modelVersion + 1;

      const inserts = suggested
        .filter((s) => !s.low_confidence)
        .map((s) => ({
          model_version: savedVersion,
          price_tier: s.price_tier,
          time_window: s.time_window,
          median_multiplier: s.suggested_multiplier,
          p25_multiplier: s.p25_multiplier,
          p75_multiplier: s.p75_multiplier,
          sample_size: s.sample_size,
        }));

      if (inserts.length > 0) {
        const { error: insErr } = await supabase
          .from("prediction_model_coefficients")
          .insert(inserts);
        if (insErr)
          console.error("[backtest] Failed to save coefficients:", insErr);
      }
    }

    await supabase
      .from("backtest_runs")
      .update({
        status: "completed",
        auction_count: rows.length,
        suggested_coefficients: suggested,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
      })
      .eq("id", runId);

    return {
      success: true,
      run_id: runId,
      auctions: rows.length,
      coefficients_suggested: suggested.length,
      low_confidence_cells: suggested.filter((s) => s.low_confidence).length,
      saved_as_version: savedVersion,
      suggested,
      duration_ms: Date.now() - startTime,
    };
  } catch (e) {
    await supabase
      .from("backtest_runs")
      .update({
        status: "failed",
        error_message: e instanceof Error ? e.message : String(e),
        duration_ms: Date.now() - startTime,
      })
      .eq("id", runId);
    throw e;
  }
}

// ─── MODE: cross_validate ───

async function crossValidate(
  supabase: ReturnType<typeof createClient>,
  body: { limit?: number; lookback_days?: number; train_pct?: number },
  startTime: number
) {
  const limit = body.limit || 2000;
  const lookbackDays = body.lookback_days || 365;
  const trainPct = body.train_pct || 70;

  const { data: run, error: runErr } = await supabase
    .from("backtest_runs")
    .insert({ mode: "cross_validate", model_version: 0, lookback_days: lookbackDays, limit_requested: limit, status: "running" })
    .select("id").single();
  if (runErr) throw runErr;
  const runId = run.id;

  try {
    const rows = await fetchBacktestData(supabase, limit, lookbackDays);
    if (rows.length < 20) {
      await supabase.from("backtest_runs").update({ status: "completed", auction_count: rows.length, completed_at: new Date().toISOString(), duration_ms: Date.now() - startTime }).eq("id", runId);
      return { success: true, run_id: runId, message: "Not enough data" };
    }

    rows.sort((a, b) => new Date(a.close_time).getTime() - new Date(b.close_time).getTime());
    const splitIdx = Math.floor(rows.length * (trainPct / 100));
    const trainRows = rows.slice(0, splitIdx);
    const testRows = rows.slice(splitIdx);

    // TRAIN: compute optimal coefficients from training set
    const cellMults: Record<string, number[]> = {};
    for (const row of trainRows) {
      const actual = Number(row.final_price);
      for (const wDef of WINDOW_DEFS) {
        const snap = getBidAtWindow(row, wDef.key);
        if (!snap.bid || snap.bid <= 0) continue;
        const bid = Number(snap.bid);
        if (bid < MIN_BID_FOR_BACKTEST || actual / bid > MAX_HAMMER_TO_BID_RATIO || actual / bid < MIN_HAMMER_TO_BID_RATIO) continue;
        const key = `${getPriceTier(bid)}:${wDef.key}`;
        if (!cellMults[key]) cellMults[key] = [];
        cellMults[key].push(actual / bid);
      }
    }

    const trainedCoeffs: CoefficientMap = new Map();
    for (const [key, mults] of Object.entries(cellMults)) {
      const sorted = [...mults].sort((a, b) => a - b);
      trainedCoeffs.set(key, {
        median: median(sorted),
        p25: sorted[Math.floor(sorted.length * 0.25)],
        p75: sorted[Math.floor(sorted.length * 0.75)],
      });
    }

    // TEST: evaluate on held-out test set
    let totalAbsErr = 0, totalErr = 0, totalPred = 0, w5 = 0, w10 = 0, w20 = 0;
    const matIn: typeof matrixInputType = [];
    type matrixInputType = Array<{ price_tier: string; time_window: string; abs_error_pct: number; error_pct: number; optimal_multiplier: number | null }>;

    for (const row of testRows) {
      if (timeBudgetExceeded(startTime)) break;
      const actual = Number(row.final_price);
      for (const wDef of WINDOW_DEFS) {
        const snap = getBidAtWindow(row, wDef.key);
        if (!snap.bid || snap.bid <= 0) continue;
        const bid = Number(snap.bid);
        if (bid < MIN_BID_FOR_BACKTEST || actual / bid > MAX_HAMMER_TO_BID_RATIO || actual / bid < MIN_HAMMER_TO_BID_RATIO) continue;
        const pred = predictAtWindow(bid, trainedCoeffs, Number(row.watcher_count) || 0, snap.bids, snap.bidders, wDef.key, Number(row.comment_count) || 0, wDef.hours, row.make, undefined, row.comp_median, row.comp_count, getBidAtPriorWindow(row, wDef.key), false, snap.hoursSinceLastBid, snap.bidVelocityPct);
        if (!pred) continue;
        const ep = ((pred.predicted - actual) / actual) * 100;
        const ae = Math.abs(ep);
        totalAbsErr += Math.min(ae, MAX_ERROR_PCT_FOR_MAPE);
        totalErr += Math.max(-MAX_ERROR_PCT_FOR_MAPE, Math.min(ep, MAX_ERROR_PCT_FOR_MAPE));
        totalPred++;
        if (ae < 5) w5++;
        if (ae < 10) w10++;
        if (ae < 20) w20++;
        matIn.push({ price_tier: getPriceTier(bid), time_window: wDef.key, abs_error_pct: ae, error_pct: ep, optimal_multiplier: actual / bid });
      }
    }

    const n = totalPred || 1;
    const oosMape = Math.round((totalAbsErr / n) * 10) / 10;

    // In-sample MAPE for overfit comparison
    let isAE = 0, isN = 0;
    for (const row of trainRows) {
      if (timeBudgetExceeded(startTime)) break;
      const actual = Number(row.final_price);
      for (const wDef of WINDOW_DEFS) {
        const snap = getBidAtWindow(row, wDef.key);
        if (!snap.bid || snap.bid <= 0) continue;
        const bid = Number(snap.bid);
        if (bid < MIN_BID_FOR_BACKTEST || actual / bid > MAX_HAMMER_TO_BID_RATIO || actual / bid < MIN_HAMMER_TO_BID_RATIO) continue;
        const pred = predictAtWindow(bid, trainedCoeffs, Number(row.watcher_count) || 0, snap.bids, snap.bidders, wDef.key, Number(row.comment_count) || 0, wDef.hours, row.make, undefined, row.comp_median, row.comp_count, getBidAtPriorWindow(row, wDef.key), false, snap.hoursSinceLastBid, snap.bidVelocityPct);
        if (!pred) continue;
        isAE += Math.min(Math.abs(((pred.predicted - actual) / actual) * 100), MAX_ERROR_PCT_FOR_MAPE);
        isN++;
      }
    }
    const isMape = isN > 0 ? Math.round((isAE / isN) * 10) / 10 : 0;

    const matrix = buildMatrix(matIn);
    await supabase.from("backtest_runs").update({
      status: "completed", auction_count: rows.length, mape: oosMape,
      bias_pct: Math.round((totalErr / n) * 10) / 10,
      within_10pct_rate: Math.round((w10 / n) * 1000) / 10,
      within_20pct_rate: Math.round((w20 / n) * 1000) / 10,
      tier_window_matrix: matrix,
      completed_at: new Date().toISOString(), duration_ms: Date.now() - startTime,
    }).eq("id", runId);

    const dr = (r: BacktestRow[]) => r.length ? (r[0].close_time?.toString().slice(0, 10) ?? "") + " to " + (r[r.length - 1].close_time?.toString().slice(0, 10) ?? "") : "";

    return {
      success: true, run_id: runId,
      split: { train: trainRows.length, test: testRows.length, train_pct: trainPct, train_dates: dr(trainRows), test_dates: dr(testRows) },
      in_sample: { mape: isMape, predictions: isN },
      out_of_sample: {
        mape: oosMape, bias_pct: Math.round((totalErr / n) * 10) / 10, predictions: totalPred,
        within_5pct: `${w5}/${n} (${Math.round((w5 / n) * 1000) / 10}%)`,
        within_10pct: `${w10}/${n} (${Math.round((w10 / n) * 1000) / 10}%)`,
        within_20pct: `${w20}/${n} (${Math.round((w20 / n) * 1000) / 10}%)`,
      },
      overfit_gap: Math.round((oosMape - isMape) * 10) / 10,
      tier_window_matrix: matrix,
      duration_ms: Date.now() - startTime,
    };
  } catch (e) {
    await supabase.from("backtest_runs").update({ status: "failed", error_message: e instanceof Error ? e.message : String(e), duration_ms: Date.now() - startTime }).eq("id", runId);
    throw e;
  }
}

// ─── MODE: auto_retrain ───
// Trains new coefficients, validates on held-out test set, and only saves
// if the new model improves MAPE by a meaningful margin.

async function autoRetrain(
  supabase: ReturnType<typeof createClient>,
  body: {
    limit?: number;
    lookback_days?: number;
    train_pct?: number;
    min_improvement_pp?: number;
    min_cell_n?: number;
    auto_activate?: boolean;
  },
  startTime: number
) {
  const limit = body.limit || 5000;
  const lookbackDays = body.lookback_days || 365;
  const trainPct = body.train_pct || 70;
  const minImprovementPP = body.min_improvement_pp ?? 0.3; // must beat current by 0.3pp
  const minCellN = body.min_cell_n ?? 5; // every cell needs at least 5 samples
  const autoActivate = body.auto_activate ?? false;

  const { data: run, error: runErr } = await supabase
    .from("backtest_runs")
    .insert({
      mode: "auto_retrain",
      model_version: 0, // will update after training
      lookback_days: lookbackDays,
      limit_requested: limit,
      status: "running",
    })
    .select("id")
    .single();
  if (runErr) throw runErr;
  const runId = run.id;

  try {
    const rows = await fetchBacktestData(supabase, limit, lookbackDays);
    if (rows.length < 50) {
      await supabase.from("backtest_runs").update({
        status: "completed", auction_count: rows.length,
        completed_at: new Date().toISOString(), duration_ms: Date.now() - startTime,
      }).eq("id", runId);
      return { success: false, run_id: runId, message: `Only ${rows.length} auctions — need at least 50` };
    }

    // Time-ordered split
    rows.sort((a, b) => new Date(a.close_time).getTime() - new Date(b.close_time).getTime());
    const splitIdx = Math.floor(rows.length * (trainPct / 100));
    const trainRows = rows.slice(0, splitIdx);
    const testRows = rows.slice(splitIdx);

    // ── STEP 1: Compute optimal coefficients from training set ──
    // Raw coefficient derivation: opt_mult = actual / (bid * (1+sniper))
    // adjFactor-aware derivation was tested at v16 and REJECTED — dividing by
    // adjFactor amplifies noise (MAPE 19.0% vs 18.1%). The raw approach is
    // more stable because individual-level variance overwhelms group corrections.
    const cellMults: Record<string, number[]> = {};
    for (const row of trainRows) {
      const actual = Number(row.final_price);
      for (const wDef of WINDOW_DEFS) {
        const snap = getBidAtWindow(row, wDef.key);
        if (!snap.bid || snap.bid <= 0) continue;
        const bid = Number(snap.bid);
        if (bid < MIN_BID_FOR_BACKTEST || actual / bid > MAX_HAMMER_TO_BID_RATIO || actual / bid < MIN_HAMMER_TO_BID_RATIO) continue;

        const bidToWatcher = Number(row.watcher_count) > 0 ? snap.bids / Number(row.watcher_count) : 0;
        const sniperPct = estimateSniperPremiumPct(bid, bidToWatcher, snap.bidders);
        const denom = bid * (1 + sniperPct / 100);
        if (denom <= 0) continue;

        const optMult = actual / denom;
        const key = `${getPriceTier(bid)}:${wDef.key}`;
        if (!cellMults[key]) cellMults[key] = [];
        cellMults[key].push(optMult);
      }
    }

    // Build new coefficient map from medians
    const newCoeffs: CoefficientMap = new Map();
    const coeffDetails: Array<{
      price_tier: string; time_window: string;
      new_multiplier: number; p25: number; p75: number;
      sample_size: number; low_confidence: boolean;
    }> = [];

    let missingCells: string[] = [];
    let lowConfCells: string[] = [];

    for (const tier of PRICE_TIERS) {
      for (const window of TIME_WINDOWS) {
        const key = `${tier}:${window}`;
        const mults = cellMults[key];
        if (!mults || mults.length === 0) {
          missingCells.push(key);
          continue;
        }

        const sorted = [...mults].sort((a, b) => a - b);
        const med = median(sorted);
        const p25 = sorted[Math.floor(sorted.length * 0.25)];
        const p75 = sorted[Math.floor(sorted.length * 0.75)];

        newCoeffs.set(key, { median: med, p25, p75 });
        const isLowConf = mults.length < minCellN;
        if (isLowConf) lowConfCells.push(key);

        coeffDetails.push({
          price_tier: tier, time_window: window,
          new_multiplier: Math.round(med * 1000) / 1000,
          p25: Math.round(p25 * 1000) / 1000,
          p75: Math.round(p75 * 1000) / 1000,
          sample_size: mults.length,
          low_confidence: isLowConf,
        });
      }
    }

    // ── STEP 1.5: Derive per-make correction factors from training set at T-2h ──
    // For each make, compute median(actual / predicted) at T-2h window using new coefficients.
    // If a make's median ratio is consistently above/below 1.0, it needs a correction factor.
    const makeErrors: Record<string, number[]> = {};
    for (const row of trainRows) {
      const actual = Number(row.final_price);
      const snap = getBidAtWindow(row, "2h");
      if (!snap.bid || snap.bid <= 0) continue;
      const bid = Number(snap.bid);
      if (bid < MIN_BID_FOR_BACKTEST || actual / bid > MAX_HAMMER_TO_BID_RATIO || actual / bid < MIN_HAMMER_TO_BID_RATIO) continue;
      const pred = predictAtWindow(bid, newCoeffs, Number(row.watcher_count) || 0, snap.bids, snap.bidders, "2h", Number(row.comment_count) || 0, 2, undefined /* no make correction yet */, undefined, row.comp_median, row.comp_count, getBidAtPriorWindow(row, "2h"), false, snap.hoursSinceLastBid, snap.bidVelocityPct);
      if (!pred || pred.predicted <= 0) continue;
      const make = (row.make || "").toUpperCase();
      if (!make) continue;
      if (!makeErrors[make]) makeErrors[make] = [];
      // ratio > 1 means model underpredicts, < 1 means overpredicts
      makeErrors[make].push(actual / pred.predicted);
    }

    const MIN_MAKE_N = 8; // need at least 8 auctions per make
    const derivedMakeCorrections: Array<{
      make: string; correction_factor: number; sample_size: number; bias_pct: number;
    }> = [];
    for (const [make, ratios] of Object.entries(makeErrors)) {
      if (ratios.length < MIN_MAKE_N) continue;
      const medRatio = median(ratios);
      // Only add correction if bias > 2% (avoid noise)
      if (Math.abs(medRatio - 1.0) < 0.02) continue;
      // Shrink corrections toward 1.0 — 80% of raw correction to avoid overfitting
      const shrunk = 1.0 + (medRatio - 1.0) * 0.8;
      const biasPct = Math.round((medRatio - 1.0) * 1000) / 10;
      derivedMakeCorrections.push({
        make,
        correction_factor: Math.round(shrunk * 10000) / 10000,
        sample_size: ratios.length,
        bias_pct: biasPct,
      });
    }
    derivedMakeCorrections.sort((a, b) => b.correction_factor - a.correction_factor);

    // ── STEP 2: Evaluate BOTH models on test set ──
    const [currentCoeffs, dbMakeCorrections] = await Promise.all([
      loadCoefficients(supabase),
      loadMakeCorrections(supabase),
    ]);

    function evaluateOnTestSet(coeffs: CoefficientMap, label: string, makeCorr?: Record<string, number>, evalRows?: BacktestRow[]) {
      const rowsToEval = evalRows || testRows;
      let totalAbsErr = 0, totalErr = 0, count = 0, w5 = 0, w10 = 0, w20 = 0;
      for (const row of rowsToEval) {
        if (timeBudgetExceeded(startTime)) break;
        const actual = Number(row.final_price);
        for (const wDef of WINDOW_DEFS) {
          const snap = getBidAtWindow(row, wDef.key);
          if (!snap.bid || snap.bid <= 0) continue;
          const bid = Number(snap.bid);
          if (bid < MIN_BID_FOR_BACKTEST || actual / bid > MAX_HAMMER_TO_BID_RATIO || actual / bid < MIN_HAMMER_TO_BID_RATIO) continue;
          const pred = predictAtWindow(bid, coeffs, Number(row.watcher_count) || 0, snap.bids, snap.bidders, wDef.key, Number(row.comment_count) || 0, wDef.hours, row.make, undefined, row.comp_median, row.comp_count, getBidAtPriorWindow(row, wDef.key), false, snap.hoursSinceLastBid, snap.bidVelocityPct, makeCorr);
          if (!pred) continue;
          const ep = ((pred.predicted - actual) / actual) * 100;
          const ae = Math.abs(ep);
          totalAbsErr += Math.min(ae, MAX_ERROR_PCT_FOR_MAPE);
          totalErr += Math.max(-MAX_ERROR_PCT_FOR_MAPE, Math.min(ep, MAX_ERROR_PCT_FOR_MAPE));
          count++;
          if (ae < 5) w5++;
          if (ae < 10) w10++;
          if (ae < 20) w20++;
        }
      }
      const n = count || 1;
      return {
        label,
        mape: Math.round((totalAbsErr / n) * 10) / 10,
        bias_pct: Math.round((totalErr / n) * 10) / 10,
        predictions: count,
        within_5pct: Math.round((w5 / n) * 1000) / 10,
        within_10pct: Math.round((w10 / n) * 1000) / 10,
        within_20pct: Math.round((w20 / n) * 1000) / 10,
      };
    }

    // Convert derived make corrections to a Record for evaluation
    const derivedMakeCorrMap: Record<string, number> = {};
    for (const mc of derivedMakeCorrections) {
      derivedMakeCorrMap[mc.make] = mc.correction_factor;
    }

    const currentResult = evaluateOnTestSet(currentCoeffs, "current", dbMakeCorrections);
    // Evaluate retrained model with derived make corrections
    const newResult = evaluateOnTestSet(newCoeffs, "retrained", derivedMakeCorrections.length > 0 ? derivedMakeCorrMap : undefined);
    // Also evaluate retrained model with fallback corrections for comparison
    const newWithFallbackResult = evaluateOnTestSet(newCoeffs, "retrained_fallback");
    const improvement = currentResult.mape - newResult.mape;

    // ── STEP 2.5: Full-dataset sanity check ──
    // The test-set evaluation uses only recent 30%. To guard against temporal overfitting,
    // also evaluate on ALL data. If the retrained model can't beat the current model even
    // with a 70% in-sample advantage, it's overfitting.
    const currentFull = evaluateOnTestSet(currentCoeffs, "current_full", dbMakeCorrections, rows);
    const newFull = evaluateOnTestSet(newCoeffs, "retrained_full", derivedMakeCorrections.length > 0 ? derivedMakeCorrMap : undefined, rows);
    const fullImprovement = currentFull.mape - newFull.mape;
    const failsFullValidation = fullImprovement < 0;

    if (failsFullValidation) {
      console.log(`[auto_retrain] Full-dataset validation FAILED: current ${currentFull.mape}% vs retrained ${newFull.mape}% (retrained worse by ${Math.abs(fullImprovement).toFixed(1)}pp despite 70% in-sample advantage)`);
    }

    const shouldSave = improvement >= minImprovementPP && !failsFullValidation && lowConfCells.length === 0 && missingCells.length <= 5;

    // ── STEP 3: Save if improved ──
    let savedVersion: number | null = null;
    if (shouldSave) {
      const { data: cv } = await supabase.rpc("execute_sql", {
        query: `SELECT COALESCE(MAX(model_version), 0) + 1 as next_version FROM prediction_model_coefficients`,
      });
      savedVersion = cv?.[0]?.next_version ?? 14;

      const inserts = coeffDetails
        .filter(c => !c.low_confidence)
        .map(c => ({
          model_version: savedVersion,
          price_tier: c.price_tier,
          time_window: c.time_window,
          median_multiplier: c.new_multiplier,
          p25_multiplier: c.p25,
          p75_multiplier: c.p75,
          sample_size: c.sample_size,
        }));

      if (inserts.length > 0) {
        const { error: insErr } = await supabase
          .from("prediction_model_coefficients")
          .insert(inserts);
        if (insErr) {
          console.error("[auto_retrain] Failed to save coefficients:", insErr);
          savedVersion = null;
        }
      }
    }

    // ── STEP 3.5: Save derived make corrections ONLY if they beat the fallback ──
    // Compare derived corrections vs fallback on test set using the appropriate coefficients.
    const makeCorVersion = savedVersion ?? CURRENT_MODEL_VERSION;
    const coeffsForMakeEval = shouldSave ? newCoeffs : currentCoeffs;
    const derivedMakeResult = evaluateOnTestSet(coeffsForMakeEval, "with_derived_make", derivedMakeCorrMap);
    const fallbackMakeResult = evaluateOnTestSet(coeffsForMakeEval, "with_fallback_make");
    const makeCorrImproved = derivedMakeCorrections.length > 0 && derivedMakeResult.mape < fallbackMakeResult.mape;

    if (makeCorrImproved) {
      // Derived corrections are better — save them
      await supabase.from("prediction_model_make_corrections").delete().eq("model_version", makeCorVersion);
      const makeInserts = derivedMakeCorrections.map(mc => ({
        model_version: makeCorVersion,
        make: mc.make,
        correction_factor: mc.correction_factor,
        sample_size: mc.sample_size,
        bias_pct: mc.bias_pct,
      }));
      const { error: mcErr } = await supabase
        .from("prediction_model_make_corrections")
        .insert(makeInserts);
      if (mcErr) {
        console.error("[auto_retrain] Failed to save make corrections:", mcErr);
      }
    } else if (derivedMakeCorrections.length > 0) {
      console.log(`[auto_retrain] Derived make corrections NOT saved: MAPE ${derivedMakeResult.mape}% vs fallback ${fallbackMakeResult.mape}%`);
    }

    // ── STEP 4: Optionally auto-activate (update the active version marker) ──
    let activated = false;
    if (shouldSave && savedVersion && autoActivate) {
      const { error: actErr } = await supabase.rpc("execute_sql", {
        query: `
          INSERT INTO prediction_model_coefficients (model_version, price_tier, time_window, median_multiplier, sample_size)
          VALUES (${savedVersion}, '_active', '_marker', ${savedVersion}, 0)
          ON CONFLICT DO NOTHING
        `,
      });
      activated = !actErr;
    }

    // ── Store results ──
    const dateRange = (r: BacktestRow[]) => r.length
      ? `${r[0].close_time?.toString().slice(0, 10)} to ${r[r.length - 1].close_time?.toString().slice(0, 10)}`
      : "";

    await supabase.from("backtest_runs").update({
      status: "completed",
      model_version: savedVersion ?? 0,
      auction_count: rows.length,
      mape: newResult.mape,
      bias_pct: newResult.bias_pct,
      within_10pct_rate: newResult.within_10pct,
      within_20pct_rate: newResult.within_20pct,
      suggested_coefficients: coeffDetails,
      comparison_diff: {
        current_mape: currentResult.mape,
        retrained_mape: newResult.mape,
        improvement_pp: Math.round(improvement * 10) / 10,
        full_validation: {
          current_mape: currentFull.mape,
          retrained_mape: newFull.mape,
          improvement_pp: Math.round(fullImprovement * 10) / 10,
          passed: !failsFullValidation,
        },
        saved: shouldSave,
        saved_version: savedVersion,
        activated,
        make_corrections_derived: derivedMakeCorrections.length,
        make_corrections_saved: makeCorrImproved,
        make_corrections_saved_for_version: makeCorrImproved ? makeCorVersion : null,
        make_corrections_mape: { derived: derivedMakeResult.mape, fallback: fallbackMakeResult.mape },
        reason: shouldSave
          ? `Improvement of ${Math.round(improvement * 10) / 10}pp exceeds threshold of ${minImprovementPP}pp`
          : failsFullValidation
            ? `Full-dataset validation FAILED: retrained ${newFull.mape}% worse than current ${currentFull.mape}% on full dataset`
            : improvement < minImprovementPP
              ? `Improvement of ${Math.round(improvement * 10) / 10}pp below threshold of ${minImprovementPP}pp`
              : lowConfCells.length > 0
                ? `${lowConfCells.length} cells have fewer than ${minCellN} samples`
                : `${missingCells.length} cells have no training data`,
      },
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
    }).eq("id", runId);

    return {
      success: true,
      run_id: runId,
      data: {
        total_auctions: rows.length,
        train: { count: trainRows.length, dates: dateRange(trainRows) },
        test: { count: testRows.length, dates: dateRange(testRows) },
      },
      current_model: currentResult,
      retrained_model: newResult,
      improvement_pp: Math.round(improvement * 10) / 10,
      decision: shouldSave ? "SAVED" : "KEPT_CURRENT",
      reason: shouldSave
        ? `New model improves MAPE by ${Math.round(improvement * 10) / 10}pp (full-dataset: +${Math.round(fullImprovement * 10) / 10}pp)`
        : failsFullValidation
          ? `Full-dataset validation FAILED: retrained ${newFull.mape}% vs current ${currentFull.mape}% (Δ${Math.round(fullImprovement * 10) / 10}pp)`
          : improvement < minImprovementPP
            ? `Improvement (${Math.round(improvement * 10) / 10}pp) below threshold (${minImprovementPP}pp)`
            : lowConfCells.length > 0
              ? `${lowConfCells.length} low-confidence cells`
              : `${missingCells.length} missing cells`,
      full_validation: {
        current_full_mape: currentFull.mape,
        retrained_full_mape: newFull.mape,
        improvement_pp: Math.round(fullImprovement * 10) / 10,
        passed: !failsFullValidation,
        note: "Full-dataset includes 70% in-sample data for retrained model — failure here means severe overfitting",
      },
      saved_version: savedVersion,
      activated,
      make_corrections: {
        derived: derivedMakeCorrections.length,
        saved: makeCorrImproved,
        saved_for_version: makeCorrImproved ? makeCorVersion : null,
        derived_mape: derivedMakeResult.mape,
        fallback_mape: fallbackMakeResult.mape,
        corrections: derivedMakeCorrections,
      },
      missing_cells: missingCells.length > 0 ? missingCells : undefined,
      low_confidence_cells: lowConfCells.length > 0 ? lowConfCells : undefined,
      coefficients: coeffDetails,
      duration_ms: Date.now() - startTime,
    };
  } catch (e) {
    await supabase.from("backtest_runs").update({
      status: "failed",
      error_message: e instanceof Error ? e.message : String(e),
      duration_ms: Date.now() - startTime,
    }).eq("id", runId);
    throw e;
  }
}

// ─── MODE: derive_corrections ───
// Derives optimal engagement/competition corrections matched to a specific
// model version's coefficients. Uses raw predictions (no corrections) to
// compute residuals, then groups by bucket to derive the optimal correction.

type CorrectionTier = "under_15k" | "15k_30k" | "30k_60k" | "60k_plus";

function getCorrectionTierLocal(bid: number): CorrectionTier {
  if (bid < 15000) return "under_15k";
  if (bid < 30000) return "15k_30k";
  if (bid < 60000) return "30k_60k";
  return "60k_plus";
}

async function deriveCorrections(
  supabase: ReturnType<typeof createClient>,
  body: {
    limit?: number;
    lookback_days?: number;
    model_version?: number;
  },
  startTime: number
) {
  const limit = body.limit || 3000;
  const lookbackDays = body.lookback_days || 180;
  const modelVersion = body.model_version || CURRENT_MODEL_VERSION;

  const [coefficients, dbMakeCorrections] = await Promise.all([
    loadCoefficients(supabase, modelVersion),
    loadMakeCorrections(supabase, modelVersion),
  ]);
  const rows = await fetchBacktestData(supabase, limit, lookbackDays);
  if (rows.length === 0) return { success: false, message: "No data" };

  // For each auction at each time window, compute raw prediction (no corrections)
  // and collect residual = actual / raw_predicted
  const engResiduals: Record<string, Record<string, number[]>> = {};  // tier → level → residuals[]
  const compResiduals: Record<string, Record<string, number[]>> = {}; // tier → level → residuals[]

  let totalAuctions = 0;
  let totalPredictions = 0;

  for (const row of rows) {
    if (timeBudgetExceeded(startTime)) break;
    const actual = Number(row.final_price);
    totalAuctions++;

    for (const wDef of WINDOW_DEFS) {
      const snap = getBidAtWindow(row, wDef.key);
      if (!snap.bid || snap.bid <= 0) continue;
      const bid = Number(snap.bid);
      if (bid < MIN_BID_FOR_BACKTEST || actual / bid > MAX_HAMMER_TO_BID_RATIO || actual / bid < MIN_HAMMER_TO_BID_RATIO) continue;

      // Raw prediction: no corrections (adjFactor=1, makeCorr=1, no comp blending)
      const pred = predictAtWindow(
        bid, coefficients, Number(row.watcher_count) || 0,
        snap.bids, snap.bidders, wDef.key,
        Number(row.comment_count) || 0, wDef.hours,
        row.make, undefined, row.comp_median, row.comp_count,
        getBidAtPriorWindow(row, wDef.key),
        true  // skipCorrections
      );
      if (!pred || pred.predicted <= 0) continue;

      const residual = actual / pred.predicted;
      // Cap extreme residuals to avoid outlier influence
      if (residual < 0.2 || residual > 5.0) continue;

      const corrTier = getCorrectionTierLocal(bid);
      const engLevel = getEngagementLevel(Number(row.comment_count) || 0);
      const compLevel = getCompetitionLevel(snap.bidders);

      // Collect engagement residuals
      if (!engResiduals[corrTier]) engResiduals[corrTier] = {};
      if (!engResiduals[corrTier][engLevel]) engResiduals[corrTier][engLevel] = [];
      engResiduals[corrTier][engLevel].push(residual);

      // Collect competition residuals
      if (!compResiduals[corrTier]) compResiduals[corrTier] = {};
      if (!compResiduals[corrTier][compLevel]) compResiduals[corrTier][compLevel] = [];
      compResiduals[corrTier][compLevel].push(residual);

      totalPredictions++;
    }
  }

  // Compute optimal corrections: median residual per bucket, normalized by tier average
  const tiers: CorrectionTier[] = ["under_15k", "15k_30k", "30k_60k", "60k_plus"];
  const engLevels = ["quiet", "normal", "active", "viral"];
  const compLevels = ["few", "some", "many", "hot", "frenzy"];

  function computeCorrections(
    residuals: Record<string, Record<string, number[]>>,
    levels: string[]
  ): Record<string, Record<string, { correction: number; n: number; raw_median: number }>> {
    const result: Record<string, Record<string, { correction: number; n: number; raw_median: number }>> = {};

    for (const tier of tiers) {
      result[tier] = {};
      const tierResiduals = residuals[tier] || {};

      // Compute tier-level weighted average median for normalization
      let totalN = 0;
      let totalWeightedMed = 0;
      for (const level of levels) {
        const arr = tierResiduals[level];
        if (!arr || arr.length === 0) continue;
        const med = median(arr);
        totalN += arr.length;
        totalWeightedMed += med * arr.length;
      }
      const tierAvg = totalN > 0 ? totalWeightedMed / totalN : 1.0;

      for (const level of levels) {
        const arr = tierResiduals[level];
        if (!arr || arr.length === 0) {
          result[tier][level] = { correction: 1.0, n: 0, raw_median: 1.0 };
          continue;
        }
        const rawMed = median(arr);
        // Correction = bucket_median / tier_average — how much this bucket deviates from average
        const correction = rawMed / tierAvg;
        result[tier][level] = {
          correction: Math.round(correction * 1000) / 1000,
          n: arr.length,
          raw_median: Math.round(rawMed * 1000) / 1000,
        };
      }
    }
    return result;
  }

  const engCorrections = computeCorrections(engResiduals, engLevels);
  const compCorrections = computeCorrections(compResiduals, compLevels);

  // Sweep amplification factors to find the optimal correction strength.
  // amplification=1.0 → use residual-derived corrections as-is
  // amplification=2.0 → double the deviations from 1.0 (more aggressive)
  // amplification=0.0 → no corrections
  const ampFactors = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0];
  const ampResults: Array<{ amp: number; mape: number; bias: number }> = [];

  // Also track current deployed corrections
  let currentMAE = 0, currentBias = 0, currentN = 0;

  // Pre-compute raw predictions and metadata for each auction/window
  const predCache: Array<{
    actual: number; rawPred: number; corrTier: CorrectionTier;
    engLevel: string; compLevel: string; hours: number;
  }> = [];

  for (const row of rows) {
    if (timeBudgetExceeded(startTime)) break;
    const actual = Number(row.final_price);

    for (const wDef of WINDOW_DEFS) {
      const snap = getBidAtWindow(row, wDef.key);
      if (!snap.bid || snap.bid <= 0) continue;
      const bid = Number(snap.bid);
      if (bid < MIN_BID_FOR_BACKTEST || actual / bid > MAX_HAMMER_TO_BID_RATIO || actual / bid < MIN_HAMMER_TO_BID_RATIO) continue;

      // Current corrections
      const predCurrent = predictAtWindow(
        bid, coefficients, Number(row.watcher_count) || 0,
        snap.bids, snap.bidders, wDef.key,
        Number(row.comment_count) || 0, wDef.hours,
        row.make, undefined, row.comp_median, row.comp_count,
        getBidAtPriorWindow(row, wDef.key), false,
        snap.hoursSinceLastBid, snap.bidVelocityPct
      );
      if (predCurrent) {
        const ep = ((predCurrent.predicted - actual) / actual) * 100;
        currentMAE += Math.min(Math.abs(ep), MAX_ERROR_PCT_FOR_MAPE);
        currentBias += Math.max(-MAX_ERROR_PCT_FOR_MAPE, Math.min(ep, MAX_ERROR_PCT_FOR_MAPE));
        currentN++;
      }

      // Raw (no corrections)
      const predRaw = predictAtWindow(
        bid, coefficients, Number(row.watcher_count) || 0,
        snap.bids, snap.bidders, wDef.key,
        Number(row.comment_count) || 0, wDef.hours,
        row.make, undefined, row.comp_median, row.comp_count,
        getBidAtPriorWindow(row, wDef.key), true
      );
      if (predRaw) {
        predCache.push({
          actual,
          rawPred: predRaw.predicted,
          corrTier: getCorrectionTierLocal(bid),
          engLevel: getEngagementLevel(Number(row.comment_count) || 0),
          compLevel: getCompetitionLevel(snap.bidders),
          hours: wDef.hours,
        });
      }
    }
  }

  // Test each amplification factor
  for (const amp of ampFactors) {
    let totalAE = 0, totalE = 0, n = 0;
    for (const p of predCache) {
      const engCorr = engCorrections[p.corrTier]?.[p.engLevel]?.correction ?? 1.0;
      const compCorr = compCorrections[p.corrTier]?.[p.compLevel]?.correction ?? 1.0;

      // Amplify: stretch deviations from 1.0 by the amp factor
      const engDev = (engCorr - 1.0) * amp;
      const compDev = (compCorr - 1.0) * amp;
      const blendedDev = 0.4 * engDev + 0.6 * compDev;

      // Time dampening
      let dampening = 0;
      if (p.hours > 36) dampening = 0.5;
      else if (p.hours > 18) dampening = 0.6;
      else if (p.hours > 9) dampening = 0.8;
      else if (p.hours > 4) dampening = 0.85;
      else if (p.hours > 1) dampening = 0.7;
      else if (p.hours > 0.25) dampening = 0.3;

      const factor = 1.0 + blendedDev * dampening;
      const pred = p.rawPred * factor;
      const ep = ((pred - p.actual) / p.actual) * 100;
      totalAE += Math.min(Math.abs(ep), MAX_ERROR_PCT_FOR_MAPE);
      totalE += Math.max(-MAX_ERROR_PCT_FOR_MAPE, Math.min(ep, MAX_ERROR_PCT_FOR_MAPE));
      n++;
    }
    ampResults.push({
      amp,
      mape: n > 0 ? Math.round((totalAE / n) * 10) / 10 : 0,
      bias: n > 0 ? Math.round((totalE / n) * 10) / 10 : 0,
    });
  }

  ampResults.sort((a, b) => a.mape - b.mape);
  const globalBestAmp = ampResults[0]?.amp ?? 3.0;

  // ── Per-tier amplification: greedy optimization ──
  // Start from the global best, then optimize each tier individually.
  // This finds cases where e.g. under_15k needs less amplification (volatile)
  // while 60k_plus needs more (stable, corrections are underweighted).
  const tierAmpValues = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0, 6.0];
  const bestPerTierAmp: Record<string, number> = {};
  for (const t of tiers) bestPerTierAmp[t] = globalBestAmp;

  // Helper: evaluate MAPE with per-tier amplification
  function evalPerTierAmp(
    perTierAmp: Record<string, number>,
    cache: typeof predCache,
    engCorr: typeof engCorrections,
    compCorr: typeof compCorrections,
    dampeningProfile?: Record<string, number>,
    blendRatio?: number
  ): { mape: number; bias: number; n: number } {
    let totalAE = 0, totalE = 0, n = 0;
    const engW = blendRatio ?? 0.4;
    const compW = 1.0 - engW;
    for (const p of cache) {
      const ec = engCorr[p.corrTier]?.[p.engLevel]?.correction ?? 1.0;
      const cc = compCorr[p.corrTier]?.[p.compLevel]?.correction ?? 1.0;
      const amp = perTierAmp[p.corrTier] ?? globalBestAmp;
      const engDev = (ec - 1.0) * amp;
      const compDev = (cc - 1.0) * amp;
      const blendedDev = engW * engDev + compW * compDev;
      let dampening = 0;
      if (dampeningProfile) {
        const hKey = p.hours > 36 ? "48h" : p.hours > 18 ? "24h" : p.hours > 9 ? "12h"
          : p.hours > 4 ? "6h" : p.hours > 1 ? "2h" : p.hours > 0.25 ? "30m" : "2m";
        dampening = dampeningProfile[hKey] ?? 0;
      } else {
        if (p.hours > 36) dampening = 0.5;
        else if (p.hours > 18) dampening = 0.6;
        else if (p.hours > 9) dampening = 0.8;
        else if (p.hours > 4) dampening = 0.85;
        else if (p.hours > 1) dampening = 0.7;
        else if (p.hours > 0.25) dampening = 0.3;
      }
      const factor = 1.0 + blendedDev * dampening;
      const pred = p.rawPred * factor;
      const ep = ((pred - p.actual) / p.actual) * 100;
      totalAE += Math.min(Math.abs(ep), MAX_ERROR_PCT_FOR_MAPE);
      totalE += Math.max(-MAX_ERROR_PCT_FOR_MAPE, Math.min(ep, MAX_ERROR_PCT_FOR_MAPE));
      n++;
    }
    return {
      mape: n > 0 ? Math.round((totalAE / n) * 100) / 100 : 0,
      bias: n > 0 ? Math.round((totalE / n) * 100) / 100 : 0,
      n,
    };
  }

  // Greedy per-tier optimization: optimize one tier at a time, 2 passes
  for (let pass = 0; pass < 2; pass++) {
    for (const tier of tiers) {
      let bestMape = Infinity;
      let bestAmp = bestPerTierAmp[tier];
      for (const tryAmp of tierAmpValues) {
        const trial = { ...bestPerTierAmp, [tier]: tryAmp };
        const result = evalPerTierAmp(trial, predCache, engCorrections, compCorrections);
        if (result.mape < bestMape) {
          bestMape = result.mape;
          bestAmp = tryAmp;
        }
      }
      bestPerTierAmp[tier] = bestAmp;
    }
  }
  const perTierResult = evalPerTierAmp(bestPerTierAmp, predCache, engCorrections, compCorrections);

  // ── Dampening profile sweep ──
  // Test variations on the time dampening profile
  const dampeningProfiles: Array<{ name: string; profile: Record<string, number> }> = [
    { name: "current", profile: { "48h": 0.5, "24h": 0.6, "12h": 0.8, "6h": 0.85, "2h": 0.7, "30m": 0.3, "2m": 0 } },
    { name: "flat_high", profile: { "48h": 0.8, "24h": 0.8, "12h": 0.8, "6h": 0.8, "2h": 0.6, "30m": 0.3, "2m": 0 } },
    { name: "early_boost", profile: { "48h": 0.7, "24h": 0.75, "12h": 0.8, "6h": 0.85, "2h": 0.7, "30m": 0.3, "2m": 0 } },
    { name: "late_boost", profile: { "48h": 0.4, "24h": 0.5, "12h": 0.7, "6h": 0.85, "2h": 0.85, "30m": 0.5, "2m": 0 } },
    { name: "aggressive", profile: { "48h": 0.8, "24h": 0.85, "12h": 0.9, "6h": 0.9, "2h": 0.8, "30m": 0.4, "2m": 0 } },
    { name: "conservative", profile: { "48h": 0.3, "24h": 0.4, "12h": 0.6, "6h": 0.7, "2h": 0.5, "30m": 0.2, "2m": 0 } },
  ];
  const dampeningSweep: Array<{ name: string; mape: number; bias: number }> = [];
  for (const dp of dampeningProfiles) {
    const r = evalPerTierAmp(bestPerTierAmp, predCache, engCorrections, compCorrections, dp.profile);
    dampeningSweep.push({ name: dp.name, mape: Math.round(r.mape * 10) / 10, bias: Math.round(r.bias * 10) / 10 });
  }
  dampeningSweep.sort((a, b) => a.mape - b.mape);

  // Use best dampening for blend ratio sweep
  const bestDpName = dampeningSweep[0]?.name;
  const bestDp = dampeningProfiles.find(d => d.name === bestDpName)?.profile;

  // ── Blend ratio sweep (engagement vs competition weight) ──
  const blendRatios = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
  const blendSweep: Array<{ eng_weight: number; mape: number; bias: number }> = [];
  for (const ratio of blendRatios) {
    const r = evalPerTierAmp(bestPerTierAmp, predCache, engCorrections, compCorrections, bestDp, ratio);
    blendSweep.push({ eng_weight: ratio, mape: Math.round(r.mape * 10) / 10, bias: Math.round(r.bias * 10) / 10 });
  }
  blendSweep.sort((a, b) => a.mape - b.mape);

  // Final evaluation with all optimizations
  const bestBlend = blendSweep[0]?.eng_weight ?? 0.4;
  const finalResult = evalPerTierAmp(bestPerTierAmp, predCache, engCorrections, compCorrections, bestDp, bestBlend);

  return {
    success: true,
    model_version: modelVersion,
    auctions: totalAuctions,
    predictions: totalPredictions,
    engagement_corrections: engCorrections,
    competition_corrections: compCorrections,
    evaluation: {
      current_corrections_mape: currentN > 0 ? Math.round((currentMAE / currentN) * 10) / 10 : null,
      current_corrections_bias: currentN > 0 ? Math.round((currentBias / currentN) * 10) / 10 : null,
      predictions: currentN,
    },
    amplification_sweep: ampResults,
    best_amplification: ampResults[0],
    per_tier_amplification: {
      amps: bestPerTierAmp,
      mape: Math.round(perTierResult.mape * 10) / 10,
      bias: Math.round(perTierResult.bias * 10) / 10,
      vs_global: {
        global_amp: globalBestAmp,
        global_mape: ampResults[0]?.mape,
        improvement: Math.round((ampResults[0]?.mape - perTierResult.mape) * 100) / 100,
      },
    },
    dampening_sweep: dampeningSweep,
    blend_ratio_sweep: blendSweep,
    best_config: {
      per_tier_amps: bestPerTierAmp,
      dampening_profile: bestDpName,
      dampening_values: bestDp,
      blend_ratio: bestBlend,
      mape: Math.round(finalResult.mape * 10) / 10,
      bias: Math.round(finalResult.bias * 10) / 10,
    },
    code_update: {
      engagement: Object.fromEntries(
        tiers.map(tier => [
          tier,
          Object.fromEntries(
            engLevels.map(level => [level, engCorrections[tier]?.[level]?.correction ?? 1.0])
          ),
        ])
      ),
      competition: Object.fromEntries(
        tiers.map(tier => [
          tier,
          Object.fromEntries(
            compLevels.map(level => [level, compCorrections[tier]?.[level]?.correction ?? 1.0])
          ),
        ])
      ),
    },
    duration_ms: Date.now() - startTime,
  };
}

// ─── HEALTH CHECK ───
// Quick model health assessment. Runs a small backtest and compares to known baseline.
// Returns: overall health status, per-window/per-tier metrics, drift alerts.
// v24 baseline: MAPE 16.3%, Bias -3.6%, W5% 29.5%, W10% 43.6%

const V24_BASELINE = {
  mape: 16.3,
  bias: -3.6,
  w5: 29.5,
  w10: 43.6,
  per_window: {
    "48h": { mape: 23.7, bias: -6.4 },
    "24h": { mape: 21.3, bias: -5.0 },
    "12h": { mape: 18.7, bias: -3.4 },
    "6h":  { mape: 18.5, bias: -3.3 },
    "2h":  { mape: 16.5, bias: -3.4 },
    "30m": { mape: 14.8, bias: -2.5 },
    "2m":  { mape: 1.7,  bias: -1.1 },
  },
};

async function healthCheck(
  supabase: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  startTime: number
) {
  const limit = Number(body.limit) || 200;
  const lookbackDays = Number(body.lookback_days) || 30;
  const alertThresholdMape = Number(body.alert_threshold_mape) || 3.0; // pp above baseline

  // 1. Run a quick backtest
  const [coefficients, dbMakeCorrections] = await Promise.all([
    loadCoefficients(supabase),
    loadMakeCorrections(supabase),
  ]);
  const rows = await fetchBacktestData(supabase, limit, lookbackDays);
  if (rows.length === 0) {
    return { status: "no_data", message: "No auctions found for health check" };
  }

  // 2. Compute predictions at all windows (matching full_backtest filters)
  const windowMetrics: Record<string, { mape: number; bias: number; n: number; w5: number; w10: number }> = {};
  const tierMetrics: Record<string, { mape: number; bias: number; n: number }> = {};
  let totalAbsErr = 0, totalErr = 0, totalW5 = 0, totalW10 = 0, totalN = 0;

  for (const row of rows) {
    const actual = row.final_price;
    for (const wDef of WINDOW_DEFS) {
      const { bid, bidders, bids, hoursSinceLastBid, bidVelocityPct } = getBidAtWindow(row, wDef.key);
      if (!bid || bid <= 0) continue;
      // Match full_backtest filters: min bid, hammer/bid ratio bounds
      if (bid < MIN_BID_FOR_BACKTEST || actual / bid > MAX_HAMMER_TO_BID_RATIO || actual / bid < MIN_HAMMER_TO_BID_RATIO) continue;

      const result = predictAtWindow(
        bid, coefficients, row.watcher_count, bids, bidders,
        wDef.key, row.comment_count || 0, wDef.hours,
        row.make, undefined, row.comp_median, row.comp_count,
        getBidAtPriorWindow(row, wDef.key), false,
        hoursSinceLastBid, bidVelocityPct
      );
      if (!result) continue;

      const rawAbsErr = Math.abs(result.predicted - actual) / actual * 100;
      const rawErr = (result.predicted - actual) / actual * 100;
      const absErr = Math.min(rawAbsErr, MAX_ERROR_PCT_FOR_MAPE);
      const err = Math.max(-MAX_ERROR_PCT_FOR_MAPE, Math.min(rawErr, MAX_ERROR_PCT_FOR_MAPE));
      const priceTier = getPriceTier(bid);

      totalAbsErr += absErr;
      totalErr += err;
      totalW5 += rawAbsErr <= 5 ? 1 : 0;
      totalW10 += rawAbsErr <= 10 ? 1 : 0;
      totalN++;

      // Per-window
      if (!windowMetrics[wDef.key]) windowMetrics[wDef.key] = { mape: 0, bias: 0, n: 0, w5: 0, w10: 0 };
      const wm = windowMetrics[wDef.key];
      wm.mape += absErr;
      wm.bias += err;
      wm.n++;
      wm.w5 += rawAbsErr <= 5 ? 1 : 0;
      wm.w10 += rawAbsErr <= 10 ? 1 : 0;

      // Per-tier
      if (!tierMetrics[priceTier]) tierMetrics[priceTier] = { mape: 0, bias: 0, n: 0 };
      const tm = tierMetrics[priceTier];
      tm.mape += absErr;
      tm.bias += err;
      tm.n++;
    }
  }

  // 3. Compute averages
  const overallMape = totalN > 0 ? Math.round(totalAbsErr / totalN * 10) / 10 : 0;
  const overallBias = totalN > 0 ? Math.round(totalErr / totalN * 10) / 10 : 0;
  const overallW5 = totalN > 0 ? Math.round(totalW5 / totalN * 1000) / 10 : 0;
  const overallW10 = totalN > 0 ? Math.round(totalW10 / totalN * 1000) / 10 : 0;

  const windowReport: Record<string, { mape: number; bias: number; n: number; w5: number; w10: number; mape_delta: number; status: string }> = {};
  for (const [w, m] of Object.entries(windowMetrics)) {
    const avgMape = Math.round(m.mape / m.n * 10) / 10;
    const avgBias = Math.round(m.bias / m.n * 10) / 10;
    const baseline = V24_BASELINE.per_window[w as keyof typeof V24_BASELINE.per_window];
    const mapeDelta = baseline ? Math.round((avgMape - baseline.mape) * 10) / 10 : 0;
    const status = mapeDelta > alertThresholdMape ? "degraded" : mapeDelta > 1.0 ? "warning" : "ok";
    windowReport[w] = {
      mape: avgMape,
      bias: avgBias,
      n: m.n,
      w5: Math.round(m.w5 / m.n * 1000) / 10,
      w10: Math.round(m.w10 / m.n * 1000) / 10,
      mape_delta: mapeDelta,
      status,
    };
  }

  const tierReport: Record<string, { mape: number; bias: number; n: number }> = {};
  for (const [t, m] of Object.entries(tierMetrics)) {
    tierReport[t] = {
      mape: Math.round(m.mape / m.n * 10) / 10,
      bias: Math.round(m.bias / m.n * 10) / 10,
      n: m.n,
    };
  }

  // 4. Generate alerts
  const alerts: string[] = [];
  const mapeDelta = Math.round((overallMape - V24_BASELINE.mape) * 10) / 10;
  if (mapeDelta > alertThresholdMape) {
    alerts.push(`MAPE degraded ${mapeDelta}pp above v24 baseline (${overallMape}% vs ${V24_BASELINE.mape}%)`);
  }
  for (const [w, r] of Object.entries(windowReport)) {
    if (r.status === "degraded") {
      alerts.push(`Window ${w}: MAPE ${r.mape}% (+${r.mape_delta}pp vs baseline)`);
    }
  }

  // 5. Determine overall health
  const overallStatus = alerts.length > 0 ? "degraded" :
    mapeDelta > 1.0 ? "warning" : "healthy";

  // 6. Store health snapshot
  try {
    await supabase.from("backtest_runs").insert({
      mode: "health_check",
      model_version: CURRENT_MODEL_VERSION,
      auction_count: rows.length,
      lookback_days: lookbackDays,
      mape: overallMape,
      bias_pct: overallBias,
      status: "completed",
    });
  } catch { /* ignore storage errors */ }

  return {
    status: overallStatus,
    sample: { auctions: rows.length, predictions: totalN, lookback_days: lookbackDays },
    overall: {
      mape: overallMape,
      bias: overallBias,
      w5: overallW5,
      w10: overallW10,
      mape_delta_vs_baseline: mapeDelta,
    },
    baseline: { version: "v24", mape: V24_BASELINE.mape, bias: V24_BASELINE.bias },
    per_window: windowReport,
    per_tier: tierReport,
    alerts,
    duration_ms: Date.now() - startTime,
  };
}
