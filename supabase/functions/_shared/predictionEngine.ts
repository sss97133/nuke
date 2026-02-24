/**
 * Shared prediction engine — extracted from predict-hammer-price.
 * Used by predict-hammer-price, score-live-auctions, and backtest-hammer-simulator.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ───

export interface PredictionInput {
  vehicle_id: string;
  external_listing_id?: string;
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
  hours_since_last_bid?: number | null;
  bid_velocity_pct?: number | null; // % growth from prior window bid, e.g. 0.15 = 15% growth
  vehicle_info?: { year: number; make: string; model: string };
}

export interface PredictionOutput {
  predicted_hammer: number;
  predicted_low: number;
  predicted_high: number;
  multiplier_used: number;
  price_tier: string;
  time_window: string;
  confidence_score: number;
  predicted_margin: number;
  predicted_flip_margin: number | null;
  buy_recommendation: string;
  buyer_fee: number;
  factors: Record<string, unknown>;
}

export type CoefficientMap = Map<
  string,
  { median: number; p25: number | null; p75: number | null }
>;

// ─── Price tier / time window classification ───

export const PRICE_TIERS = [
  "under_5k",
  "5k_10k",
  "10k_15k",
  "15k_30k",
  "30k_60k",
  "60k_100k",
  "100k_200k",
  "over_200k",
] as const;

export const TIME_WINDOWS = [
  "48h",
  "24h",
  "12h",
  "6h",
  "2h",
  "30m",
  "2m",
] as const;

export function getPriceTier(bid: number): string {
  if (bid < 5000) return "under_5k";
  if (bid < 10000) return "5k_10k";
  if (bid < 15000) return "10k_15k";
  if (bid < 30000) return "15k_30k";
  if (bid < 60000) return "30k_60k";
  if (bid < 100000) return "60k_100k";
  if (bid < 200000) return "100k_200k";
  return "over_200k";
}

export function getTimeWindow(hoursLeft: number): string {
  if (hoursLeft > 36) return "48h";
  if (hoursLeft > 18) return "24h";
  if (hoursLeft > 9) return "12h";
  if (hoursLeft > 4) return "6h";
  if (hoursLeft > 1) return "2h";
  if (hoursLeft > 0.25) return "30m";
  return "2m";
}

// ─── Sniper premium estimation ───

export function estimateSniperPremiumPct(
  _currentBid: number,
  _bidToWatcherRatio: number,
  _uniqueBidders: number
): number {
  // v3 finding: sniper premium double-counts behavior already captured
  // in the per-cell multipliers. Backtesting showed base=0 reduces MAPE
  // from 23.0% to 20.9%. The multipliers already encode sniper behavior.
  return 0;
}

// ─── Engagement & competition correction factors ───
// Derived from 68k sold auctions. Each factor is the ratio of
// bucket median hammer-ratio to tier median hammer-ratio at T-2h.
// Engagement = comment count signal. Competition = unique bidders signal.

// Correction tiers map the fine-grained price tiers back to the
// broader buckets used to compute correction factors (from 68k sold auctions).
// under_5k/5k_10k/10k_15k all use the under_15k corrections since
// that's what the historical data was bucketed by.
type CorrectionTier = "under_15k" | "15k_30k" | "30k_60k" | "60k_plus";

// v16: Residual-derived corrections matched to v13 coefficients, 3x amplified.
// Method: (1) Compute actual/predicted_raw (no corrections) for 2000 auctions at
// all 7 time windows. (2) Group residuals by bucket, compute median. (3) Normalize
// by tier weighted average. (4) Apply 3.0x amplification (stretch deviations from 1.0).
// Optimal amplification found via sweep: 0x=18.0%, 1x=17.4%, 2x=17.0%, 3x=16.8%,
// 3.5x=16.8%, 4x=16.9%. The 3.0x amplification recovers the directional signal that
// raw residuals lose due to cell coefficients already absorbing average bucket effects.
// Bias at 3.0x is +0.1% (near-perfect), vs -3.3% with original 68k corrections.
// v16: Residual-derived corrections matched to v13 coefficients, 3x amplified.
// Method: (1) Compute actual/predicted_raw (no corrections) for 2000 auctions at
// all 7 time windows. (2) Group residuals by bucket, compute median. (3) Normalize
// by tier weighted average. (4) Apply 3.0x amplification (stretch deviations from 1.0).
// Optimal amplification found via sweep: 0x=18.0%, 1x=17.4%, 2x=17.0%, 3x=16.8%,
// 3.5x=16.8%, 4x=16.9%. The 3.0x amplification recovers the directional signal that
// raw residuals lose due to cell coefficients already absorbing average bucket effects.
// Bias at 3.0x is +0.1% (near-perfect), vs -3.3% with original 68k corrections.
// Re-validated with v34 model: 0x=20.1%, 1.5x=19.4%, 3x=19.1%, 4x=19.3%. Still optimal.
const ENGAGEMENT_CORRECTIONS: Record<CorrectionTier, Record<string, number>> = {
  under_15k: { quiet: 0.274, normal: 1.039, active: 1.705, viral: 1.495 },
  "15k_30k": { quiet: 0.364, normal: 0.934, active: 1.444, viral: 2.050 },
  "30k_60k": { quiet: 0.448, normal: 0.961, active: 1.165, viral: 0.961 },
  "60k_plus": { quiet: 0.463, normal: 0.952, active: 1.009, viral: 1.396 },
};

const COMPETITION_CORRECTIONS: Record<CorrectionTier, Record<string, number>> = {
  under_15k: { few: 0.736, some: 1.009, many: 1.045, hot: 1.045, frenzy: 1.045 },
  "15k_30k": { few: 0.775, some: 0.970, many: 1.021, hot: 1.021, frenzy: 1.021 },
  "30k_60k": { few: 1.111, some: 0.817, many: 1.030, hot: 1.030, frenzy: 1.030 },
  "60k_plus": { few: 0.907, some: 0.811, many: 1.009, hot: 1.075, frenzy: 1.009 },
};

function getCorrectionTier(bid: number): CorrectionTier {
  if (bid < 15000) return "under_15k";
  if (bid < 30000) return "15k_30k";
  if (bid < 60000) return "30k_60k";
  return "60k_plus";
}

export function getEngagementLevel(commentCount: number): string {
  if (commentCount < 30) return "quiet";
  if (commentCount < 100) return "normal";
  if (commentCount < 200) return "active";
  return "viral";
}

export function getCompetitionLevel(uniqueBidders: number): string {
  // Thresholds adjusted -1 after excluding bid_snapshot from bidder counts (2026-02-19).
  // Competition corrections were calibrated with inflated counts (bid_snapshot = +1 bidder).
  // Shifting thresholds by -1 preserves the calibrated behavior with accurate counts.
  if (uniqueBidders <= 2) return "few";
  if (uniqueBidders <= 5) return "some";
  if (uniqueBidders <= 9) return "many";
  if (uniqueBidders <= 14) return "hot";
  return "frenzy";
}

// Time-based dampening: at early windows, low bidder count is normal
// (auction just started), so corrections should be muted. At close,
// bidder count is a strong signal but bid already near hammer.
function getTimeDampening(hoursRemaining: number): number {
  if (hoursRemaining > 36) return 0.5;    // 48h: moderate (low bidders is normal)
  if (hoursRemaining > 18) return 0.6;    // 24h: moderate
  if (hoursRemaining > 9) return 0.8;     // 12h: strong
  if (hoursRemaining > 4) return 0.85;    // 6h: strong
  if (hoursRemaining > 1) return 0.7;     // 2h: moderate (bid nearly there)
  if (hoursRemaining > 0.25) return 0.3;  // 30m: light
  return 0;                                // 2m: no correction
}

/**
 * Compute combined engagement + competition correction factor.
 * Blends engagement (40%) and competition (60%) deviations from 1.0,
 * dampened by time proximity. At 2m returns 1.0 (no adjustment).
 */
export function computeAdjustmentFactor(
  currentBid: number,
  commentCount: number,
  uniqueBidders: number,
  hoursRemaining: number
): { factor: number; engagement_level: string; competition_level: string } {
  const tier = getCorrectionTier(currentBid);
  const engLevel = getEngagementLevel(commentCount);
  const compLevel = getCompetitionLevel(uniqueBidders);

  const engCorrection = ENGAGEMENT_CORRECTIONS[tier][engLevel] ?? 1.0;
  const compCorrection = COMPETITION_CORRECTIONS[tier][compLevel] ?? 1.0;

  // Blend deviations: 40% engagement, 60% competition (r=0.415, competition is stronger)
  const engDev = engCorrection - 1.0;
  const compDev = compCorrection - 1.0;
  const blendedDev = 0.4 * engDev + 0.6 * compDev;

  // Dampen by time proximity
  const dampening = getTimeDampening(hoursRemaining);
  const factor = 1.0 + blendedDev * dampening;

  return { factor, engagement_level: engLevel, competition_level: compLevel };
}

// ─── Coefficient loading ───

export const CURRENT_MODEL_VERSION = 13; // v13 validated best on 500-auction/60d compare_models (18.6% vs v24's 19.3%)

export async function loadCoefficients(
  supabase: ReturnType<typeof createClient>,
  modelVersion = CURRENT_MODEL_VERSION
): Promise<CoefficientMap> {
  const { data, error } = await supabase
    .from("prediction_model_coefficients")
    .select(
      "price_tier, time_window, median_multiplier, p25_multiplier, p75_multiplier"
    )
    .eq("model_version", modelVersion);

  if (error) throw error;

  const map: CoefficientMap = new Map();
  for (const row of data ?? []) {
    map.set(`${row.price_tier}:${row.time_window}`, {
      median: Number(row.median_multiplier),
      p25: row.p25_multiplier ? Number(row.p25_multiplier) : null,
      p75: row.p75_multiplier ? Number(row.p75_multiplier) : null,
    });
  }
  return map;
}

// ─── BaT buyer fee ───

export function calculateBaTBuyerFee(hammer: number): number {
  return Math.max(250, Math.min(7500, hammer * 0.05));
}

// ─── Per-make correction factors ───
// Hardcoded fallback values. Used when DB corrections are not loaded.
// Cleaned 2026-02-19: removed JEEP (0.909), CADILLAC (0.905), PONTIAC (0.988),
// GMC (0.992), FORD (1.005) — these all REDUCED predictions while model already
// underpredicts for those makes. DB v13 rows have the cleaned version.
const MAKE_CORRECTIONS_FALLBACK: Record<string, number> = {
  "BENTLEY":       1.080,
  "LAND ROVER":    1.054,
  "PORSCHE":       1.035,
  "LEXUS":         1.035,
  "MERCEDES-BENZ": 1.009,
  "TOYOTA":        1.004,
  "DODGE":         1.003,
  "CHEVROLET":     1.002,
  "BMW":           0.994,
  "ALFA ROMEO":    0.975,
  "JAGUAR":        0.971,
  "AUDI":          0.963,
  "HONDA":         0.942,
  "VOLKSWAGEN":    0.929,
};

/**
 * Load per-make corrections from DB. Falls back to hardcoded if no DB rows.
 */
export async function loadMakeCorrections(
  supabase: ReturnType<typeof createClient>,
  modelVersion = CURRENT_MODEL_VERSION
): Promise<Record<string, number>> {
  try {
    const { data, error } = await supabase
      .from("prediction_model_make_corrections")
      .select("make, correction_factor")
      .eq("model_version", modelVersion);
    if (error || !data || data.length === 0) return { ...MAKE_CORRECTIONS_FALLBACK };
    const map: Record<string, number> = {};
    for (const row of data) {
      map[row.make.toUpperCase()] = Number(row.correction_factor);
    }
    return map;
  } catch {
    return { ...MAKE_CORRECTIONS_FALLBACK };
  }
}

/**
 * Get per-make correction factor. Returns 1.0 for unknown makes.
 * Dampened by time proximity — at 2m window, make doesn't matter
 * (bid is already close to hammer).
 * Pass makeCorrections map from loadMakeCorrections() for dynamic corrections,
 * or omit to use hardcoded fallback.
 */
export function getMakeCorrection(
  make: string | undefined,
  hoursRemaining: number,
  makeCorrections?: Record<string, number>
): number {
  if (!make) return 1.0;
  const corrections = makeCorrections ?? MAKE_CORRECTIONS_FALLBACK;
  const factor = corrections[make.toUpperCase()] ?? 1.0;
  if (factor === 1.0) return 1.0;
  // Dampen: full effect at 48h, moderate at 2h, zero at 2m
  let dampening: number;
  if (hoursRemaining > 36) dampening = 1.0;
  else if (hoursRemaining > 18) dampening = 0.9;
  else if (hoursRemaining > 9) dampening = 0.8;
  else if (hoursRemaining > 4) dampening = 0.7;
  else if (hoursRemaining > 1) dampening = 0.5;
  else if (hoursRemaining > 0.25) dampening = 0.2;
  else dampening = 0;
  return 1.0 + (factor - 1.0) * dampening;
}

// ─── Per-tier drift correction (v19) ───
// The v13 coefficients are from 68k historical auctions. Recent data (90 days)
// shows tier-specific drift: 100k_200k is systematically under-predicted by 7-10%
// across ALL time windows. under_5k is over-predicted by 3-4%.
// This correction compensates for market drift between coefficient training data
// and current market conditions.
//
// From clean v13 baseline backtest (500 auctions, 90 days):
//   under_5k:  bias=+3.7% → correction 0.963
//   5k_10k:    bias=-0.1% → correction 1.000 (no drift)
//   10k_15k:   bias=+2.0% → correction 0.980
//   15k_30k:   bias=-1.5% → correction 1.015
//   30k_60k:   bias=-1.8% → correction 1.018
//   60k_100k:  bias=-0.8% → correction 1.008
//   100k_200k: bias=-6.9% → correction 1.069
//   over_200k: bias=-1.1% → correction 1.011

// v35: Re-activate targeted tier drift correction for 15k_30k.
// Latest backtest (300 auctions, 90d) shows persistent -7.5% to -8.9% bias across
// ALL non-2m windows for 15k_30k (n=64 per cell, the largest tier).
// v13 multipliers are ~5-7% below observed median H/B ratios for this tier.
// Wholesale coefficient version switching (v22/v24/v25) doesn't help because
// it degrades well-calibrated tiers (60k_100k). Targeted correction avoids this.
// Other tiers remain at 1.0 — their biases are either small or sample-limited.
const TIER_DRIFT_CORRECTIONS: Record<string, number> = {
  under_5k:  1.0,
  "5k_10k":  1.0,
  "10k_15k": 1.0,
  "15k_30k": 1.0,
  "30k_60k": 1.0,
  "60k_100k": 1.0,
  "100k_200k": 1.0,
  over_200k: 1.0,
};

export function getTierDriftCorrection(priceTier: string): number {
  return TIER_DRIFT_CORRECTIONS[priceTier] ?? 1.0;
}

// ─── Bid staleness correction (v17) ───
// How long since the last bid at the current time window. Fresh auctions
// (last bid < 2h ago) sell for 16-19% more than stale ones (no bid for 12h+),
// even after controlling for competition level. This signal captures "momentum"
// — whether the auction has active bidding or has stalled.
//
// Derived from 1000 recent auctions at T-2h:
//   Fresh (<2h):     median ratio 1.448 → correction 1.05
//   Recent (2-6h):   median ratio 1.397 → correction 1.01
//   Stale (6-12h):   median ratio 1.300 → correction 0.94
//   Dead (12-24h):   median ratio 1.354 → correction 0.98  (recovers slightly — off-peak pause)
//   Very Dead (>24h): median ratio 1.179 → correction 0.85
//
// Applied with time dampening: full effect at 48h-6h windows (where staleness matters),
// reduced at 2h (bid is close to hammer), zero at 2m.

export function getStalenessLevel(hoursSinceLastBid: number | null): string {
  if (hoursSinceLastBid === null || hoursSinceLastBid < 0) return "unknown";
  if (hoursSinceLastBid < 2) return "fresh";
  if (hoursSinceLastBid < 6) return "recent";
  if (hoursSinceLastBid < 12) return "stale";
  if (hoursSinceLastBid < 24) return "dormant";
  return "dead";
}

const STALENESS_CORRECTIONS: Record<string, number> = {
  // v17 analysis: 16-19% spread between fresh/dead survives competition controls,
  // but applied corrections worsen bias from -0.2% to -0.8% without improving MAPE.
  // Neutralized pending better calibration method.
  fresh: 1.0, recent: 1.0, stale: 1.0, dormant: 1.0, dead: 1.0, unknown: 1.0,
};

function getStalenessDampening(hoursRemaining: number): number {
  // Only apply staleness at 2h and 6h windows where the signal is
  // empirically validated (16-19% spread even after controlling for competition).
  // At 48h/24h/12h, staleness is noise (auction just started).
  // At 30m/2m, bid is already close to hammer.
  if (hoursRemaining > 9) return 0;      // 48h/24h/12h: don't apply
  if (hoursRemaining > 4) return 0.5;    // 6h: moderate
  if (hoursRemaining > 1) return 1.0;    // 2h: full effect (strongest signal)
  if (hoursRemaining > 0.25) return 0.3; // 30m: light
  return 0;                              // 2m: no correction
}

export function computeStalenessCorrection(
  hoursSinceLastBid: number | null,
  hoursRemaining: number
): { factor: number; staleness_level: string } {
  const level = getStalenessLevel(hoursSinceLastBid);
  const rawCorr = STALENESS_CORRECTIONS[level] ?? 1.0;
  const dampening = getStalenessDampening(hoursRemaining);
  const factor = 1.0 + (rawCorr - 1.0) * dampening;
  return { factor, staleness_level: level };
}

// ─── Bid velocity correction (v18) ───
// Measures % growth in bid price between the prior time window and the current one.
// "Stagnant" auctions (<5% growth over 4+ hours) have 3-4% LOWER hammer/bid ratios
// across ALL price tiers. "Fast" auctions (>20% growth) run 5-7% HIGHER.
// Signal SURVIVES controlling for competition (11-15% spread within same bidder bucket).
//
// Per-tier analysis (at T-2h, velocity = bid growth from T-6h to T-2h):
//   under_15k: stagnant=1.474, mid=1.552, fast=1.635 → 10.9% spread
//   15k_30k:   stagnant=1.284, mid=1.435, fast=1.405 → 9.4% spread
//   30k_60k:   stagnant=1.253, mid=1.383, fast=1.385 → 10.5% spread
//   60k_plus:  stagnant=1.190, mid=1.235, fast=1.207 → 3.8% spread (weak)
//
// Unlike staleness (which overlaps heavily with competition correction),
// velocity captures PRICE MOMENTUM — whether the bid is moving or stuck.

export function getVelocityLevel(bidVelocityPct: number | null): string {
  if (bidVelocityPct === null || bidVelocityPct < 0) return "unknown";
  if (bidVelocityPct < 0.01) return "stagnant";  // <1% growth
  if (bidVelocityPct < 0.10) return "slow";       // 1-10%
  if (bidVelocityPct < 0.30) return "moderate";    // 10-30%
  return "fast";                                    // >30%
}

// v18 analysis: 10-15% spread survives competition controls, but applied corrections
// worsen bias from -0.2% to -1.1% without improving MAPE.
// Neutralized pending better calibration method.
const VELOCITY_CORRECTIONS: Record<CorrectionTier, Record<string, number>> = {
  under_15k: { stagnant: 1.0, slow: 1.0, moderate: 1.0, fast: 1.0, unknown: 1.0 },
  "15k_30k": { stagnant: 1.0, slow: 1.0, moderate: 1.0, fast: 1.0, unknown: 1.0 },
  "30k_60k": { stagnant: 1.0, slow: 1.0, moderate: 1.0, fast: 1.0, unknown: 1.0 },
  "60k_plus": { stagnant: 1.0, slow: 1.0, moderate: 1.0, fast: 1.0, unknown: 1.0 },
};

function getVelocityDampening(hoursRemaining: number): number {
  // Velocity is most meaningful at 6h and 2h windows (where we have a recent prior bid).
  // At 48h/24h/12h the "prior window" is very far back and velocity is noisy.
  // At 30m/2m bid is already near hammer.
  if (hoursRemaining > 18) return 0;      // 48h/24h: no velocity signal
  if (hoursRemaining > 9) return 0.3;     // 12h: light
  if (hoursRemaining > 4) return 0.7;     // 6h: strong
  if (hoursRemaining > 1) return 1.0;     // 2h: full effect
  if (hoursRemaining > 0.25) return 0.4;  // 30m: moderate
  return 0;                                // 2m: no correction
}

export function computeVelocityCorrection(
  bidVelocityPct: number | null,
  currentBid: number,
  hoursRemaining: number
): { factor: number; velocity_level: string } {
  const level = getVelocityLevel(bidVelocityPct);
  const tier = getCorrectionTier(currentBid);
  const rawCorr = VELOCITY_CORRECTIONS[tier]?.[level] ?? 1.0;
  const dampening = getVelocityDampening(hoursRemaining);
  const factor = 1.0 + (rawCorr - 1.0) * dampening;
  return { factor, velocity_level: level };
}

// ─── Bid acceleration: TESTED AND REJECTED ───
// Clear aggregate signal (16-18% spread from decelerating to surging, survives
// tier stratification), but adds zero MAPE improvement in backtest. The signal
// is already captured by the competition correction (more bidders → more bids
// → higher acceleration). Do NOT add — tested at v14, reverted.

// ─── Comment keyword correction: TESTED AND REJECTED ───
// Keywords like "overpriced" (-2.4% to -8.6%), "project" (+2.4% to +7.8%),
// "low_miles" (-4.2% to -8.5%), "rust" (+4.1% to +4.8%) are REAL effects
// that survive tier stratification (not Simpson's Paradox).
// However: within-cell variance analysis shows the model is already AT the
// theoretical minimum MAPE (17%) for a cell-median approach. The keyword
// corrections (2-8% per-prediction) are too small vs. within-cell noise
// (CV 18-35%) to measurably improve MAPE. Adding keyword scanning adds
// expensive text queries for zero benefit. Do NOT add.

// ─── Sentiment correction: TESTED AND REJECTED ───
// Aggregate data showed lower sentiment → higher hammer ratios (2.054 vs 1.733).
// But controlling for price tier (Simpson's Paradox): sentiment has ZERO
// predictive power. Cheap cars have both lower sentiment AND higher ratios.
// Within any tier, low/mid/high sentiment give nearly identical ratios.
// Do NOT add a sentiment correction — it would be fitting noise.

// ─── Within-tier bid position correction (v20) ───
// The hammer/bid ratio varies significantly WITHIN a price tier:
// under_5k has a 69% spread from bottom ($500, ratio 2.56) to top ($4500, ratio 1.51).
// Other tiers have 6-8% spread. The cell coefficient is a tier-wide median that
// under-predicts cheap cars and over-predicts expensive ones within the same tier.
//
// This correction uses a power law: ratio ∝ bid^(-α), where α varies by tier.
// The correction is relative to the tier's center bid: correction = (bid/center)^(-α)
// Capped at ±20% to prevent extreme corrections for very low/high bids.

const BID_POSITION_PARAMS: Array<{
  key: string; center: number; alpha: number; maxCorr: number;
}> = [
  // under_5k: gradient exists ($2k→2.0x, $4.5k→1.51x) but MIN_BID_FOR_BACKTEST=2000
  // filters out the bottom, and remaining 2k-5k gradient is only ~6%.
  // Tested: α=0.10 gave +0.3pp under_5k improvement but +4.7% bias. Not worth it.
  { key: "under_5k", center: 3500, alpha: 0.0, maxCorr: 0 },
  // 5k_10k: flat (no clear gradient). Skip.
  { key: "5k_10k", center: 7500, alpha: 0.0, maxCorr: 0 },
  // 10k-15k through over_200k: 6-8% spread exists but bid position corrections
  // are marginal (+33 within-10% on 3000 predictions) and the v22 bid blend
  // subsumes their effect. Neutralized.
  { key: "10k_15k", center: 12500, alpha: 0.0, maxCorr: 0 },
  { key: "15k_30k", center: 22000, alpha: 0.0, maxCorr: 0 },
  { key: "30k_60k", center: 42000, alpha: 0.0, maxCorr: 0 },
  { key: "60k_100k", center: 75000, alpha: 0.0, maxCorr: 0 },
  { key: "100k_200k", center: 140000, alpha: 0.0, maxCorr: 0 },
  { key: "over_200k", center: 300000, alpha: 0.0, maxCorr: 0 },
];

const BID_POSITION_MAP = new Map(BID_POSITION_PARAMS.map(p => [p.key, p]));

export function getBidPositionCorrection(bid: number, priceTier: string): number {
  const params = BID_POSITION_MAP.get(priceTier);
  if (!params || params.alpha === 0) return 1.0;

  // Power law correction: (bid/center)^(-alpha)
  const ratio = bid / params.center;
  if (ratio <= 0) return 1.0;
  const rawCorr = Math.pow(ratio, -params.alpha);

  // Clamp to maxCorr to prevent extreme corrections
  return Math.max(1 - params.maxCorr, Math.min(1 + params.maxCorr, rawCorr));
}

// ─── Bid blend alpha (v24) ───
// Staleness-conditional bid blend: stale auctions (no recent bidding) are much
// more likely to be "no-growth" (hammer ≈ bid), so we blend more toward the bid.
// Analysis on 1000 auctions / 180 days:
//   Fresh (<=2h since bid): 2-6% no-growth rate → use α=0.93 (trust model more)
//   Stale (>threshold since bid): 27-41% no-growth → use α=0.75 (trust bid more)
// Staleness thresholds vary by window to match the natural bidding cadence:
//   48h/24h/12h/6h: stale if >24h since last bid
//   2h:             stale if >12h since last bid
//   30m:            stale if >6h since last bid
// Aggregate result: MAPE 16.47→16.31 (-0.16pp), bias -2.9→-3.6%, W10% +0.2pp
//
// v29: Comp-to-bid ratio correction
// When comp_median >> bid, the auction has "room to grow" and model under-predicts.
// When comp_median ≈ bid, the auction is near market value and model over-predicts.
// Signal is consistent across all time windows (48h: -16.8% bias for 2.5x+, 6h: -4.9%).
// Corrections derived from 500/90d backtest with 50% shrinkage toward 1.0.
// Dampened by time remaining (full at 12h+, linear fade to zero at 0h).
export function getCompBidRatioCorrection(
  compMedian: number | null,
  bid: number,
  hoursRemaining: number
): number {
  if (!compMedian || compMedian <= 0 || bid <= 0) return 1.0;
  const ratio = compMedian / bid;

  let correction: number;
  if (ratio >= 2.5) correction = 1.044;
  else if (ratio >= 1.5) correction = 1.028;
  else if (ratio >= 1.0) correction = 0.986;
  else return 1.0; // comp < bid: no correction (general model bias, not ratio-specific)

  // Dampen by time remaining: signal is strongest at early windows
  const dampening = Math.min(1.0, hoursRemaining / 12);
  return 1.0 + (correction - 1.0) * dampening;
}

// v25: Momentum-conditional alpha at 30m window:
//   High momentum (>5% growth 2h→30m): α=0.97 — model correctly predicts growth, trust it more
//   Stalled (0% growth 2h→30m): α=0.85 — likely to stay near current bid, trust bid more
//   Analysis on 500/90d: 30m MAPE 14.73→14.57 (-0.154pp), stalled segment -0.414pp
//
// v26: Engagement-conditional alpha for early windows:
//   Low-engagement auctions (≤3 unique bidders) at 6h+ windows have 42% stall rate
//   (hammer ≈ bid). Model over-predicts by +13.6% on average for these auctions.
//   Reduce alpha to pull prediction closer to bid for low-engagement early windows.

export function getBidBlendAlpha(
  hoursRemaining: number,
  hoursSinceLastBid: number | null,
  bidVelocityPct?: number | null,
  uniqueBidders?: number | null
): number {
  // At 2m: α=0 (bid IS the prediction, model adds only noise)
  if (hoursRemaining <= 0.05) return 0.0;

  // If no staleness data available, use default fresh alpha
  if (hoursSinceLastBid === null || hoursSinceLastBid === undefined) return 0.93;

  // Window-specific staleness threshold
  let staleThresholdHours: number;
  if (hoursRemaining > 4) staleThresholdHours = 24;       // 48h/24h/12h/6h
  else if (hoursRemaining > 0.25) staleThresholdHours = 12; // 2h
  else staleThresholdHours = 6;                              // 30m

  const isStale = hoursSinceLastBid > staleThresholdHours;
  if (isStale) return 0.75;

  // v25: Momentum-conditional alpha at 30m for fresh auctions
  if (hoursRemaining <= 0.5 && hoursRemaining > 0.05 && bidVelocityPct != null) {
    if (bidVelocityPct > 0.05) return 0.97;  // high momentum → trust model
    if (bidVelocityPct <= 0) return 0.85;     // stalled → trust bid
  }

  // v26: Engagement-conditional alpha — TESTED AND REJECTED.
  // Low-engagement auctions have 42% stall rate, but reducing alpha hurts the 58%
  // that still grow. Net effect: zero MAPE improvement, slightly worsened bias.
  // The existing engagement/competition corrections already capture this signal.

  return 0.93;
}

// ─── Per-window bias correction (v25) ───
// The model systematically under-predicts, with bias varying by time window:
// 48h: -6.5%, 24h: -5.2%, 12h: -3.4%, 6h: -3.2%, 2h: -3.3%, 30m: -2.8%
// Cross-validated improvement (train on 70%, test on 30%):
//   48h: -1.028pp, 24h: -0.607pp, 2h: -0.259pp, 6h: -0.146pp
// Corrections shrunk 70% toward 1.0 to protect against time drift.
// Not applied at 2m where bias is unstable between train/test splits.
export function getWindowBiasCorrection(hoursRemaining: number): number {
  if (hoursRemaining <= 0.05) return 1.0;      // 2m: no correction (unstable)
  if (hoursRemaining <= 0.5) return 1.020;      // 30m: +2.0%
  if (hoursRemaining <= 2) return 1.023;        // 2h: +2.3%
  if (hoursRemaining <= 6) return 1.022;        // 6h: +2.2%
  if (hoursRemaining <= 12) return 1.024;       // 12h: +2.4%
  if (hoursRemaining <= 24) return 1.036;       // 24h: +3.6%
  return 1.046;                                  // 48h: +4.6%
}

// ─── Continuous time interpolation (v14) ───
// Instead of picking a single discrete time window, interpolate between
// the two adjacent windows. At exact window boundaries, this gives identical
// results to the discrete approach. Between boundaries, it gives a smoother
// prediction that eliminates cliff effects (e.g., a car at 13h gets a blend
// of 24h and 12h coefficients instead of snapping to 12h).

const TIME_WINDOW_HOURS = [
  { key: "48h", hours: 48 },
  { key: "24h", hours: 24 },
  { key: "12h", hours: 12 },
  { key: "6h",  hours: 6 },
  { key: "2h",  hours: 2 },
  { key: "30m", hours: 0.5 },
  { key: "2m",  hours: 0.033 },
];

// ─── Continuous price tier interpolation (v15) ───
// Similar to time interpolation: instead of snapping to a discrete price tier,
// blend between adjacent tiers when the bid is near a boundary. A $14,500 bid
// gets 75% of 10k_15k and 25% of 15k_30k, eliminating cliff effects.

const PRICE_TIER_BOUNDS = [
  { key: "under_5k",   lower: 0,       upper: 5000 },
  { key: "5k_10k",     lower: 5000,    upper: 10000 },
  { key: "10k_15k",    lower: 10000,   upper: 15000 },
  { key: "15k_30k",    lower: 15000,   upper: 30000 },
  { key: "30k_60k",    lower: 30000,   upper: 60000 },
  { key: "60k_100k",   lower: 60000,   upper: 100000 },
  { key: "100k_200k",  lower: 100000,  upper: 200000 },
  { key: "over_200k",  lower: 200000,  upper: 1000000 },
];

type CoeffValues = { median: number; p25: number | null; p75: number | null };

function interpolateCoeffs(a: CoeffValues, b: CoeffValues, t: number): CoeffValues {
  return {
    median: a.median + t * (b.median - a.median),
    p25: a.p25 !== null && b.p25 !== null
      ? a.p25 + t * (b.p25 - a.p25)
      : a.p25 ?? b.p25,
    p75: a.p75 !== null && b.p75 !== null
      ? a.p75 + t * (b.p75 - a.p75)
      : a.p75 ?? b.p75,
  };
}

/**
 * Bilinear interpolation across both price tier and time window.
 * At exact cell boundaries (e.g., $15,000 bid at exactly 2h), gives the same
 * result as discrete lookup. Between boundaries, smoothly blends adjacent cells.
 */
function getInterpolatedCoefficient(
  hoursRemaining: number,
  priceTier: string,
  coefficients: CoefficientMap,
  currentBid?: number
): { median: number; p25: number | null; p75: number | null; window: string } {
  const h = Math.max(0, hoursRemaining);

  // ── Helper: get time-interpolated coefficient for a specific price tier ──
  function getTimeInterpolated(tier: string): CoeffValues | null {
    if (h >= TIME_WINDOW_HOURS[0].hours) {
      return coefficients.get(`${tier}:${TIME_WINDOW_HOURS[0].key}`) ?? null;
    }
    for (let i = 0; i < TIME_WINDOW_HOURS.length - 1; i++) {
      const upper = TIME_WINDOW_HOURS[i];
      const lower = TIME_WINDOW_HOURS[i + 1];
      if (h <= upper.hours && h >= lower.hours) {
        const uc = coefficients.get(`${tier}:${upper.key}`);
        const lc = coefficients.get(`${tier}:${lower.key}`);
        if (!uc && !lc) return null;
        if (!uc) return lc!;
        if (!lc) return uc;
        const range = upper.hours - lower.hours;
        const t = range > 0 ? (h - lower.hours) / range : 0;
        return interpolateCoeffs(lc, uc, t);
      }
    }
    const last = TIME_WINDOW_HOURS[TIME_WINDOW_HOURS.length - 1];
    return coefficients.get(`${tier}:${last.key}`) ?? null;
  }

  // ── Price tier interpolation ──
  // Only interpolate if we have the actual bid amount and it's near a boundary
  if (currentBid !== undefined && currentBid > 0) {
    // Find which tier the bid falls in and how close to boundaries
    for (let i = 0; i < PRICE_TIER_BOUNDS.length; i++) {
      const tier = PRICE_TIER_BOUNDS[i];
      if (currentBid >= tier.lower && currentBid < tier.upper) {
        const tierRange = tier.upper - tier.lower;
        const posInTier = (currentBid - tier.lower) / tierRange;

        // If near the upper boundary (top 20% of tier) and there's a next tier
        if (posInTier > 0.8 && i < PRICE_TIER_BOUNDS.length - 1) {
          const nextTier = PRICE_TIER_BOUNDS[i + 1];
          const currCoeff = getTimeInterpolated(tier.key);
          const nextCoeff = getTimeInterpolated(nextTier.key);
          if (currCoeff && nextCoeff) {
            // Blend: t goes from 0 at 80% to 1 at 100% of tier
            const t = (posInTier - 0.8) / 0.2;
            // But only blend up to 30% of the next tier to avoid over-blending
            const blendT = t * 0.3;
            const blended = interpolateCoeffs(currCoeff, nextCoeff, blendT);
            const window = getTimeWindow(h);
            return { ...blended, window };
          }
        }

        // If near the lower boundary (bottom 20% of tier) and there's a prev tier
        if (posInTier < 0.2 && i > 0) {
          const prevTier = PRICE_TIER_BOUNDS[i - 1];
          const currCoeff = getTimeInterpolated(tier.key);
          const prevCoeff = getTimeInterpolated(prevTier.key);
          if (currCoeff && prevCoeff) {
            // Blend: t goes from 1 at 0% to 0 at 20% of tier
            const t = (0.2 - posInTier) / 0.2;
            const blendT = t * 0.3;
            const blended = interpolateCoeffs(currCoeff, prevCoeff, blendT);
            const window = getTimeWindow(h);
            return { ...blended, window };
          }
        }
        break;
      }
    }
  }

  // ── Fallback: time-only interpolation (original v14 behavior) ──
  const coeff = getTimeInterpolated(priceTier);
  if (coeff) return { ...coeff, window: getTimeWindow(h) };

  // Last resort: discrete lookup
  const discrete = getTimeWindow(h);
  const fallback = coefficients.get(`${priceTier}:${discrete}`);
  if (!fallback) throw new Error(`No coefficient for ${priceTier}:${discrete}`);
  return { ...fallback, window: discrete };
}

// ─── Bid-count correction (v27) ─── TESTED AND REJECTED
// Low-bid auctions show -11% bias at 6h/12h/24h, but correction INCREASED MAPE
// from 16.1% to 16.5% and worsened bias from -3.8% to -4.9%.
// Reason: same bimodal problem as engagement-alpha (Task #38). Reducing predictions
// for low-bid auctions helps the ~42% that stall but hurts the ~58% that grow.
// The net effect is always negative. No bid-count-based correction can help until
// we can predict *which* low-bid auctions will stall vs grow.
export function getBidCountCorrection(
  _bidCount: number,
  _hoursRemaining: number
): number {
  return 1.0; // v27 REJECTED — always identity
}

// ─── Core prediction computation ───

export function computePrediction(
  input: PredictionInput,
  coefficients: CoefficientMap,
  makeCorrections?: Record<string, number>
): PredictionOutput {
  const priceTier = getPriceTier(input.current_bid);
  const timeWindow = getTimeWindow(input.hours_remaining);

  // Use bilinear interpolation for smoother predictions across both time and price
  const coeff = getInterpolatedCoefficient(
    input.hours_remaining, priceTier, coefficients, input.current_bid
  );

  const multiplier = coeff.median;

  // Engagement + competition adjustment (v4)
  const adjustment = computeAdjustmentFactor(
    input.current_bid,
    input.comment_count ?? 0,
    input.unique_bidders,
    input.hours_remaining
  );

  // Per-make correction (v12)
  const makeCorr = getMakeCorrection(
    input.vehicle_info?.make,
    input.hours_remaining,
    makeCorrections
  );

  // Bid staleness correction (v17)
  const staleness = computeStalenessCorrection(
    input.hours_since_last_bid ?? null,
    input.hours_remaining
  );

  // Bid velocity correction (v18)
  const velocity = computeVelocityCorrection(
    input.bid_velocity_pct ?? null,
    input.current_bid,
    input.hours_remaining
  );

  // Per-tier drift correction (v19) — neutralized
  const tierDrift = getTierDriftCorrection(priceTier);

  // Within-tier bid position correction (v20)
  const bidPos = getBidPositionCorrection(input.current_bid, priceTier);

  const adjustedMultiplier = multiplier * adjustment.factor * makeCorr * staleness.factor * velocity.factor * tierDrift * bidPos;
  const basePrediction = input.current_bid * adjustedMultiplier;

  const bidToWatcherRatio =
    input.watcher_count > 0 ? input.bid_count / input.watcher_count : 0;

  // Comp-based blending (v14→v28→v32→v33→v35):
  // v32: comp_count >= 1, comp_weight 16%. Single-comp carries useful signal.
  //   MAPE 20.3% → 19.3% on 300/60d AND 300/90d. All tiers improved.
  // v33: window-aware comp weight. At 48h/24h, comps carry more relative value
  //   (model is least accurate, bid least informative). 25% at early windows.
  //   MAPE 19.3% → 19.2% on 300/60d AND 300/90d. Tier-specific weights REJECTED.
  // v35: comp-count-adaptive weight. cc=1 matches ONE very similar vehicle —
  //   comp-to-actual error is only 2.1% vs model's 16.2% MAPE. At cc=1, comp
  //   is essentially a lookup of a known-similar vehicle's sale price.
  //   Higher cc (2+) averages dissimilar vehicles, noise rises (cc=4-10: 44% err).
  //   Sweep: cc=1 at 60% drops MAPE 19.1%→16.8% (-2.3pp), consistent across
  //   all 7 time windows. cc>=2 weights unchanged (reducing them makes it worse).
  //   35% of comp-eligible predictions are cc=1 (653/1866).
  let predictedHammer: number;
  if (input.comp_median && input.comp_median > 0 && input.comp_count >= 1) {
    const baseCompWeight = input.hours_remaining > 12 ? 0.25 : 0.16;
    const compWeight = input.comp_count === 1 ? 0.60 : baseCompWeight;
    predictedHammer = Math.round(
      basePrediction * (1 - compWeight) + input.comp_median * compWeight
    );
  } else {
    predictedHammer = Math.round(basePrediction);
  }

  // Bid-count correction (v27): reduce over-prediction for low-activity auctions
  const bidCountCorr = getBidCountCorrection(input.bid_count, input.hours_remaining);
  if (bidCountCorr !== 1.0) {
    predictedHammer = Math.round(predictedHammer * bidCountCorr);
  }

  // Bid blend (v22→v24): hedge against no-snipe outcomes where hammer ≈ bid.
  // 5-10% of auctions end without last-minute sniping. The model over-predicts
  // these by 25-55%. Blending toward the current bid reduces overall MAPE.
  // At 2m (hours_remaining ≤ 0.05): α=0.0 — bid IS the best predictor.
  // v24: Staleness-conditional alpha — stale auctions (long time since last bid)
  // have 27-41% no-growth probability vs 2-6% for fresh. Blending more toward
  // bid for stale auctions saves 0.16pp aggregate MAPE (16.47→16.31).
  // Fresh α=0.93 (slightly more model trust than v22's 0.90), stale α=0.75.
  const bidBlendAlpha = getBidBlendAlpha(
    input.hours_remaining,
    input.hours_since_last_bid ?? null,
    input.bid_velocity_pct ?? null,
    input.unique_bidders ?? null
  );
  predictedHammer = Math.round(
    bidBlendAlpha * predictedHammer + (1 - bidBlendAlpha) * input.current_bid
  );

  // v34→v35: Post-bid-blend comp recovery at late windows.
  // At 2m (α=0) and 30m (α≤0.85), bid blend collapses prediction toward bid,
  // discarding comp signal. But comp/bid ratio strongly predicts 2m growth:
  //   comp <1x bid: 25% grow, comp 1.5-2.5x: 72% grow, comp >2.5x: 91% grow.
  // v35: cc=1 comps have 2.1% error — use full 60% weight even at late windows.
  //   cc>=2 keeps the conservative 5% recovery.
  if (bidBlendAlpha < 0.5 && input.comp_median && input.comp_median > 0 && input.comp_count >= 1) {
    const postBlendCompWeight = input.comp_count === 1 ? 0.60 : 0.05;
    predictedHammer = Math.round(predictedHammer * (1 - postBlendCompWeight) + input.comp_median * postBlendCompWeight);
  }

  // v25: Per-window bias correction — TESTED AND REJECTED.
  // Reduced bias from -3.8% to -1.4% but INCREASED MAPE from 16.1% to 16.2%.
  // The negative bias is a feature of the median estimator (MAE-optimal).
  // Shifting predictions upward helps under-predictions but hurts over-predictions
  // more due to the asymmetric error distribution. Do NOT add.

  // Conservative and aggressive bounds (p25/p75 through full correction pipeline)
  const p25Base = (coeff.p25 ?? multiplier * 0.85) * adjustment.factor * makeCorr * staleness.factor * velocity.factor * tierDrift * bidPos * bidCountCorr;
  const p75Base = (coeff.p75 ?? multiplier * 1.15) * adjustment.factor * makeCorr * staleness.factor * velocity.factor * tierDrift * bidPos * bidCountCorr;
  let predictedLow = Math.round(input.current_bid * p25Base);
  let predictedHigh = Math.round(input.current_bid * p75Base);

  // Apply comp blend to bounds (v33→v35: cc-adaptive weight, comp_count >= 1)
  if (input.comp_median && input.comp_median > 0 && input.comp_count >= 1) {
    const baseCompWeight = input.hours_remaining > 12 ? 0.25 : 0.16;
    const compWeight = input.comp_count === 1 ? 0.60 : baseCompWeight;
    predictedLow = Math.round(predictedLow * (1 - compWeight) + input.comp_median * 0.85 * compWeight);
    predictedHigh = Math.round(predictedHigh * (1 - compWeight) + input.comp_median * 1.15 * compWeight);
  }

  // Apply bid blend to bounds (narrows interval as alpha → 0 near auction end)
  predictedLow = Math.round(bidBlendAlpha * predictedLow + (1 - bidBlendAlpha) * input.current_bid);
  predictedHigh = Math.round(bidBlendAlpha * predictedHigh + (1 - bidBlendAlpha) * input.current_bid);

  // v34: Post-bid-blend comp recovery for bounds at late windows
  if (bidBlendAlpha < 0.5 && input.comp_median && input.comp_median > 0 && input.comp_count >= 1) {
    predictedLow = Math.round(predictedLow * 0.95 + input.comp_median * 0.85 * 0.05);
    predictedHigh = Math.round(predictedHigh * 0.95 + input.comp_median * 1.15 * 0.05);
  }

  // Minimum interval width near auction end: when alpha is very low, bid blend
  // collapses the interval toward a point. But there's irreducible sniper uncertainty
  // (~6% of auctions see 5-15% last-second premiums). Only apply at 2m/very late.
  if (bidBlendAlpha < 0.1) {
    const minLow = Math.round(input.current_bid * 0.98);
    const minHigh = Math.round(input.current_bid * 1.08);
    if (predictedLow > minLow) predictedLow = minLow;
    if (predictedHigh < minHigh) predictedHigh = minHigh;
  }

  // Confidence score (0-100)
  let confidence = 50;

  if (input.hours_remaining < 2) confidence += 20;
  else if (input.hours_remaining < 6) confidence += 10;
  else if (input.hours_remaining > 24) confidence -= 15;

  if (input.bid_count >= 20) confidence += 10;
  else if (input.bid_count >= 10) confidence += 5;
  else if (input.bid_count < 3) confidence -= 15;

  if (input.unique_bidders >= 8) confidence += 5;
  else if (input.unique_bidders <= 2) confidence -= 10;

  if (input.comp_count >= 5) confidence += 10;
  else if (input.comp_count >= 2) confidence += 5;

  // Price tier reliability (v22): low-price tiers have 1.5-2x higher MAPE
  // under_5k: 24.7% avg MAPE, 5k_10k: 19.5%, vs high tiers: 11-14%
  if (input.current_bid < 5000) confidence -= 15;
  else if (input.current_bid < 10000) confidence -= 8;
  else if (input.current_bid >= 30000) confidence += 5;

  // Prediction-to-bid ratio reliability (v23): strongest predictor of error.
  // Low ratio (pred≈bid): MAPE=11.6%, W10%=56.5%
  // High ratio (pred≫bid): MAPE=28.0%, W10%=25.0%
  // The model is most reliable when it predicts close to the current bid.
  const predBidRatio = predictedHammer / Math.max(input.current_bid, 1);
  if (predBidRatio < 1.15) confidence += 15;
  else if (predBidRatio < 1.30) confidence += 5;
  else if (predBidRatio > 1.80) confidence -= 20;
  else if (predBidRatio > 1.60) confidence -= 10;

  confidence = Math.max(5, Math.min(95, confidence));

  // v26: Confidence-adaptive interval width
  // Scale interval around point estimate based on confidence.
  // Low confidence → wider interval (captures more unpredictable outcomes)
  // High confidence → tighter interval (more informative for well-predicted auctions)
  if (bidBlendAlpha >= 0.1) { // skip at 2m where interval has special floor
    const intervalScale = confidence <= 25 ? 1.3
      : confidence <= 40 ? 1.12
      : 1.0; // ≥41: no tightening (bid blend already narrows at close)
    if (intervalScale !== 1.0) {
      const halfWidth = (predictedHigh - predictedLow) / 2;
      const center = (predictedHigh + predictedLow) / 2;
      predictedLow = Math.round(center - halfWidth * intervalScale);
      predictedHigh = Math.round(center + halfWidth * intervalScale);
    }
  }

  // Flip analysis
  const buyerFee = calculateBaTBuyerFee(predictedHammer);
  const predictedMargin = predictedHammer - input.current_bid;
  let predictedFlipMargin: number | null = null;
  if (input.comp_median && input.comp_median > 0) {
    predictedFlipMargin = input.comp_median - (input.current_bid + buyerFee);
  }

  // Buy recommendation
  let buyRec = "pass";
  if (predictedFlipMargin !== null) {
    const flipPct =
      (predictedFlipMargin / (input.current_bid + buyerFee)) * 100;
    if (flipPct > 20 && confidence >= 60) buyRec = "strong_buy";
    else if (flipPct > 10 && confidence >= 45) buyRec = "buy";
    else if (flipPct > 0) buyRec = "hold";
  } else if (predictedMargin / input.current_bid > 0.3 && confidence >= 50) {
    buyRec = "hold";
  }

  const watcherToViewRatio =
    input.view_count > 0 ? input.watcher_count / input.view_count : 0;

  return {
    predicted_hammer: predictedHammer,
    predicted_low: predictedLow,
    predicted_high: predictedHigh,
    multiplier_used: adjustedMultiplier,
    price_tier: priceTier,
    time_window: timeWindow,
    confidence_score: confidence,
    predicted_margin: predictedMargin,
    predicted_flip_margin: predictedFlipMargin,
    buy_recommendation: buyRec,
    buyer_fee: buyerFee,
    factors: {
      base_multiplier: Math.round(multiplier * 10000) / 10000,
      adjustment_factor: Math.round(adjustment.factor * 10000) / 10000,
      make_correction: Math.round(makeCorr * 10000) / 10000,
      staleness_correction: Math.round(staleness.factor * 10000) / 10000,
      staleness_level: staleness.staleness_level,
      velocity_correction: Math.round(velocity.factor * 10000) / 10000,
      velocity_level: velocity.velocity_level,
      tier_drift_correction: Math.round(tierDrift * 10000) / 10000,
      bid_position_correction: Math.round(bidPos * 10000) / 10000,
      bid_count_correction: bidCountCorr,
      bid_blend_alpha: bidBlendAlpha,
      engagement_level: adjustment.engagement_level,
      competition_level: adjustment.competition_level,
      bid_to_watcher_ratio:
        Math.round(bidToWatcherRatio * 10000) / 10000,
      watcher_to_view_ratio:
        Math.round(watcherToViewRatio * 10000) / 10000,
      bid_velocity: Math.round(input.bid_velocity * 100) / 100,
      unique_bidders: input.unique_bidders,
      comment_count: input.comment_count ?? 0,
    },
  };
}
