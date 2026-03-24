/**
 * Prediction Engine — Shared module for hammer price predictions
 *
 * Provides bid-curve-based price prediction using trained coefficients
 * from prediction_model_coefficients and make corrections.
 */

export const CURRENT_MODEL_VERSION = 24;

export interface PredictionInput {
  vehicle_id: string;
  vehicle_event_id: string;
  current_bid: number;
  bid_count: number;
  view_count: number;
  watcher_count: number;
  unique_bidders: number;
  hours_remaining: number;
  bid_velocity: number;
  comp_median: number | null;
  comp_count: number;
  comment_count: number;
  hours_since_last_bid: number | null;
  bid_velocity_pct: number | null;
  vehicle_info: { year: number | null; make: string | null; model: string | null };
}

export interface PredictionOutput {
  predicted_hammer: number;
  predicted_low: number;
  predicted_high: number;
  confidence_score: number;
  buy_recommendation: "strong_buy" | "buy" | "hold" | "pass";
  predicted_margin: number;
  predicted_flip_margin: number;
  time_window: string;
  price_tier: string;
  multiplier_used: number;
  factors: {
    adjustment_factor: number;
    engagement_level: string;
    competition_level: string;
    make_correction: number;
  };
}

interface Coefficient {
  price_tier: string;
  time_window: string;
  median_multiplier: number;
  p25_multiplier: number | null;
  p75_multiplier: number | null;
  sample_size: number;
}

interface MakeCorrection {
  make: string;
  correction_factor: number;
}

type CoeffMap = Map<string, Coefficient>;
type MakeCorrMap = Map<string, number>;

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export async function loadCoefficients(supabase: SupabaseClient): Promise<CoeffMap> {
  const { data, error } = await supabase
    .from("prediction_model_coefficients")
    .select("price_tier, time_window, median_multiplier, p25_multiplier, p75_multiplier, sample_size")
    .eq("model_version", CURRENT_MODEL_VERSION)
    .limit(500);

  if (error) throw new Error(`Failed to load coefficients: ${error.message}`);

  const map = new Map<string, Coefficient>();
  for (const row of data ?? []) {
    const key = `${row.price_tier}:${row.time_window}`;
    map.set(key, {
      price_tier: row.price_tier,
      time_window: row.time_window,
      median_multiplier: Number(row.median_multiplier),
      p25_multiplier: row.p25_multiplier ? Number(row.p25_multiplier) : null,
      p75_multiplier: row.p75_multiplier ? Number(row.p75_multiplier) : null,
      sample_size: row.sample_size,
    });
  }

  // Fallback: if no v24 coefficients, try loading latest version
  if (map.size === 0) {
    const { data: fallback } = await supabase
      .from("prediction_model_coefficients")
      .select("price_tier, time_window, median_multiplier, p25_multiplier, p75_multiplier, sample_size")
      .order("model_version", { ascending: false })
      .limit(500);

    for (const row of fallback ?? []) {
      const key = `${row.price_tier}:${row.time_window}`;
      if (!map.has(key)) {
        map.set(key, {
          price_tier: row.price_tier,
          time_window: row.time_window,
          median_multiplier: Number(row.median_multiplier),
          p25_multiplier: row.p25_multiplier ? Number(row.p25_multiplier) : null,
          p75_multiplier: row.p75_multiplier ? Number(row.p75_multiplier) : null,
          sample_size: row.sample_size,
        });
      }
    }
  }

  return map;
}

export async function loadMakeCorrections(supabase: SupabaseClient): Promise<MakeCorrMap> {
  const { data, error } = await supabase
    .from("prediction_model_make_corrections")
    .select("make, correction_factor")
    .eq("model_version", CURRENT_MODEL_VERSION)
    .limit(200);

  if (error) throw new Error(`Failed to load make corrections: ${error.message}`);

  const map = new Map<string, number>();
  for (const row of data ?? []) {
    map.set(row.make.toUpperCase(), Number(row.correction_factor));
  }
  return map;
}

function getPriceTier(currentBid: number): string {
  if (currentBid < 2000) return "under_2k";
  if (currentBid < 5000) return "under_5k";
  if (currentBid < 10000) return "5k_10k";
  if (currentBid < 15000) return "10k_15k";
  if (currentBid < 30000) return "15k_30k";
  if (currentBid < 60000) return "30k_60k";
  if (currentBid < 100000) return "60k_100k";
  if (currentBid < 200000) return "100k_200k";
  return "over_200k";
}

function getTimeWindow(hoursRemaining: number): string {
  if (hoursRemaining <= 0.033) return "2m";    // 2 minutes
  if (hoursRemaining <= 0.5) return "30m";
  if (hoursRemaining <= 2) return "2h";
  if (hoursRemaining <= 6) return "6h";
  if (hoursRemaining <= 12) return "12h";
  if (hoursRemaining <= 24) return "24h";
  return "48h";
}

export function computePrediction(
  input: PredictionInput,
  coefficients: CoeffMap,
  makeCorrections: MakeCorrMap,
): PredictionOutput {
  const priceTier = getPriceTier(input.current_bid);
  const timeWindow = getTimeWindow(input.hours_remaining);
  const key = `${priceTier}:${timeWindow}`;

  // Look up coefficient for this tier+window
  const coeff = coefficients.get(key);
  let multiplier = coeff?.median_multiplier ?? 1.2; // Default 20% growth if no data

  // Apply make correction
  const makeName = (input.vehicle_info.make || "").toUpperCase();
  const makeCorr = makeCorrections.get(makeName) ?? 1.0;
  multiplier *= makeCorr;

  // Bid velocity adjustment: faster bidding → higher final price
  if (input.bid_velocity > 2) {
    multiplier *= 1 + Math.min(input.bid_velocity * 0.01, 0.15);
  }

  // Bid velocity % (momentum alpha v25): recent acceleration premium
  if (input.bid_velocity_pct !== null && input.bid_velocity_pct > 0.1) {
    multiplier *= 1 + Math.min(input.bid_velocity_pct * 0.05, 0.10);
  }

  // Engagement adjustment: high unique bidders → competitive auction
  if (input.unique_bidders >= 5) {
    multiplier *= 1 + Math.min((input.unique_bidders - 4) * 0.005, 0.05);
  }

  // Staleness penalty: no bids in many hours → cooling off
  if (input.hours_since_last_bid !== null && input.hours_since_last_bid > 6) {
    multiplier *= Math.max(0.85, 1 - (input.hours_since_last_bid - 6) * 0.01);
  }

  // Sniper premium: very close to end, add spike factor
  if (input.hours_remaining <= 0.5 && input.hours_remaining > 0) {
    multiplier *= 1.02 + (0.5 - input.hours_remaining) * 0.08;
  }

  const predictedHammer = Math.round(input.current_bid * multiplier);

  // Confidence range
  const p25Mult = coeff?.p25_multiplier ?? multiplier * 0.85;
  const p75Mult = coeff?.p75_multiplier ?? multiplier * 1.15;
  const predictedLow = Math.round(input.current_bid * p25Mult * makeCorr);
  const predictedHigh = Math.round(input.current_bid * p75Mult * makeCorr);

  // Confidence score (0-100)
  let confidence = 30; // Base
  if (coeff && coeff.sample_size >= 10) confidence += 15;
  if (coeff && coeff.sample_size >= 50) confidence += 10;
  if (input.comp_count >= 3) confidence += 15;
  if (input.comp_count >= 10) confidence += 10;
  if (input.hours_remaining <= 6) confidence += 10;
  if (input.hours_remaining <= 1) confidence += 10;
  confidence = Math.min(confidence, 95);

  // Comp-anchored confidence boost: if prediction aligns with comps
  if (input.comp_median && input.comp_count >= 3) {
    const compRatio = predictedHammer / input.comp_median;
    if (compRatio >= 0.7 && compRatio <= 1.3) confidence += 5;
  }
  confidence = Math.min(confidence, 95);

  // Compute factor labels for reporting
  const engagementLevel = input.unique_bidders >= 10 ? "high" : input.unique_bidders >= 5 ? "medium" : "low";
  const competitionLevel = input.bid_velocity > 5 ? "intense" : input.bid_velocity > 2 ? "moderate" : "light";

  // Predicted margins
  const buyerFee = calculateBaTBuyerFee(predictedHammer);
  const predictedMargin = predictedHammer - input.current_bid;
  const predictedFlipMargin = predictedHammer - input.current_bid - buyerFee;

  // Buy recommendation
  let recommendation: PredictionOutput["buy_recommendation"];
  const marginPct = input.current_bid > 0 ? predictedMargin / input.current_bid : 0;
  if (marginPct >= 0.25 && confidence >= 60) recommendation = "strong_buy";
  else if (marginPct >= 0.15 && confidence >= 45) recommendation = "buy";
  else if (marginPct >= 0.05) recommendation = "hold";
  else recommendation = "pass";

  return {
    predicted_hammer: predictedHammer,
    predicted_low: predictedLow,
    predicted_high: predictedHigh,
    confidence_score: confidence,
    buy_recommendation: recommendation,
    predicted_margin: predictedMargin,
    predicted_flip_margin: predictedFlipMargin,
    time_window: timeWindow,
    price_tier: priceTier,
    multiplier_used: Math.round(multiplier * 1000) / 1000,
    factors: {
      adjustment_factor: Math.round(multiplier * 1000) / 1000,
      engagement_level: engagementLevel,
      competition_level: competitionLevel,
      make_correction: makeCorr,
    },
  };
}

export function calculateBaTBuyerFee(hammerPrice: number): number {
  // BaT charges 5% buyer premium, capped at $5,000 (changed from $7,500 in 2024)
  return Math.min(hammerPrice * 0.05, 5000);
}
