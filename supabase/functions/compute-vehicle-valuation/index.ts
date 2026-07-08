/**
 * COMPUTE VEHICLE VALUATION — The Nuke Estimate
 *
 * Confidence-weighted multi-signal valuation engine.
 * Computes estimated value, deal score, and heat score for vehicles.
 *
 * POST /functions/v1/compute-vehicle-valuation
 * Body: {
 *   "vehicle_id": "uuid",           // Single vehicle
 *   "vehicle_ids": ["uuid", ...],   // Batch mode (max 100)
 *   "force": false                  // Re-compute even if not stale
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ============================================================================
// PRICE TIER DEFINITIONS
// ============================================================================
type PriceTier = "budget" | "mainstream" | "enthusiast" | "collector" | "trophy";

function getPriceTier(price: number): PriceTier {
  if (price < 15000) return "budget";
  if (price < 50000) return "mainstream";
  if (price < 150000) return "enthusiast";
  if (price < 500000) return "collector";
  return "trophy";
}

// ============================================================================
// TIER-DEPENDENT WEIGHTS
// ============================================================================
const TIER_WEIGHTS: Record<PriceTier, {
  comps: number;
  condition: number;
  rarity: number;
  sentiment: number;
  bid_curve: number;
  market_trend: number;
  survival: number;
  originality: number;
  confidence_interval: number;
}> = {
  budget:     { comps: 0.45, condition: 0.18, rarity: 0.02, sentiment: 0.05, bid_curve: 0.10, market_trend: 0.10, survival: 0.02, originality: 0.08, confidence_interval: 0.08 },
  mainstream: { comps: 0.40, condition: 0.15, rarity: 0.05, sentiment: 0.08, bid_curve: 0.10, market_trend: 0.10, survival: 0.04, originality: 0.08, confidence_interval: 0.12 },
  enthusiast: { comps: 0.30, condition: 0.12, rarity: 0.10, sentiment: 0.12, bid_curve: 0.08, market_trend: 0.08, survival: 0.08, originality: 0.12, confidence_interval: 0.18 },
  collector:  { comps: 0.25, condition: 0.10, rarity: 0.15, sentiment: 0.13, bid_curve: 0.05, market_trend: 0.07, survival: 0.10, originality: 0.15, confidence_interval: 0.25 },
  trophy:     { comps: 0.20, condition: 0.08, rarity: 0.18, sentiment: 0.12, bid_curve: 0.04, market_trend: 0.06, survival: 0.12, originality: 0.20, confidence_interval: 0.35 },
};

// ============================================================================
// SIGNAL MULTIPLIER RANGES
// ============================================================================
function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ============================================================================
// MODEL NORMALIZATION — Strip noise from model strings for comp matching
// ============================================================================
function normalizeModelForComps(model: string): string {
  let m = model.toLowerCase();
  // Strip chassis/registration/engine/VIN metadata (common in Bonhams, Gooding, RM)
  m = m.replace(/\b(chassis|registration|engine|vin|see text|lot|ref)\b.*$/i, "");
  m = m.replace(/\bno\.\s*\S+/gi, "");
  // Strip parenthetical notes
  m = m.replace(/\(.*?\)/g, "");
  // Normalize accented characters
  m = m.replace(/[éèëê]/g, "e");
  m = m.replace(/[àáâä]/g, "a");
  m = m.replace(/[ùúûü]/g, "u");
  m = m.replace(/[ìíîï]/g, "i");
  m = m.replace(/[òóôö]/g, "o");
  m = m.replace(/[ñ]/g, "n");
  // Strip non-alphanumeric except spaces and hyphens
  m = m.replace(/[^a-z0-9 -]/g, " ");
  // Collapse whitespace
  m = m.replace(/\s+/g, " ").trim();
  return m;
}

/**
 * Extract the core model identifier (first 1-3 meaningful tokens).
 * E.g., "911 carrera 4 gts coupe 6-speed" -> "911 carrera"
 *        "f40"                             -> "f40"
 *        "model a roadster"                -> "model a"
 */
function extractCoreModel(normalizedModel: string): string {
  const tokens = normalizedModel.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "";

  // Body-style and trim words that don't help identify the model
  const stopWords = new Set([
    "coupe", "cabriolet", "convertible", "roadster", "sedan", "saloon",
    "targa", "spyder", "spider", "speedster", "berlinetta", "estate",
    "wagon", "touring", "sport", "sports", "super", "special", "custom",
    "limousine", "landaulet", "drophead", "fixedhead", "tourer",
    "6-speed", "7-speed", "5-speed", "4-speed", "3-speed", "automatic",
    "manual", "lwb", "swb", "rhd", "lhd", "recreation", "replica",
    "lightweight", "competition", "rally", "race", "racing",
  ]);

  // Take the first significant tokens (model identifiers, not body styles)
  const coreTokens: string[] = [];
  for (const token of tokens) {
    if (coreTokens.length >= 3) break;
    // Skip displacement-only tokens like "2-litre", "30-litre"
    if (/^\d+-?litre$/.test(token) || /^\d+-?liter$/.test(token)) continue;
    if (/^\d+hp$/.test(token)) continue;
    if (stopWords.has(token)) {
      // If we already have at least one token, stop at body style words
      if (coreTokens.length > 0) break;
      // If first token is a stop word, keep it (e.g., "Super" in "Super Bee")
      continue;
    }
    coreTokens.push(token);
  }

  return coreTokens.join(" ");
}

// ============================================================================
// STEP 1: BASE PRICE FROM COMPARABLES (multi-tier matching)
// ============================================================================
// Build class from the subject's OWN evidence (vehicle_condition_scores.descriptor_summary).
// A frame-off resto-mod must not be priced on the stock-comp median — it belongs to the
// upper tail of its make/model/year distribution (where built examples actually sell).
async function getBuildClass(supabase: any, vehicleId: string): Promise<string> {
  const { data } = await supabase
    .from("vehicle_condition_scores")
    .select("descriptor_summary, condition_tier, observation_count")
    .eq("vehicle_id", vehicleId)
    .limit(1);
  if (!data || data.length === 0) return "unknown";
  const r = data[0];
  const ds = r.descriptor_summary || {};
  const obs = r.observation_count || 1;
  const mods = Object.keys(ds)
    .filter((k) => /aftermarket|non_original|forced_induction|lifted|restored|swap|modification/.test(k))
    .reduce((s, k) => s + ((ds[k] && ds[k].count) || 0), 0);
  const modDensity = mods / Math.max(obs, 1);
  if (modDensity >= 0.15) return "restomod";       // heavy documented modification
  if (r.condition_tier === "project") return "project";
  if (["concours", "show", "excellent", "survivor"].includes(r.condition_tier)) return "survivor";
  return "unknown";
}

// Class-aware anchor: pick the percentile of the comp pool that matches the subject's
// build class, instead of always taking the stock-dominated median. Unknown class →
// the prior recency-weighted median (no behavior change).
function classAwareAnchor(rows: any[], buildClass: string, subjectYear: number | null = null): number {
  if (buildClass === "unknown") return recencyWeightedMedian(rows, subjectYear);
  const prices = rows.map((r) => r.best_price).filter((p) => p > 0).sort((a, b) => a - b);
  if (prices.length === 0) return 0;
  const pct = (p: number) => prices[Math.min(prices.length - 1, Math.max(0, Math.round((p / 100) * (prices.length - 1))))];
  switch (buildClass) {
    case "restomod": return pct(82);   // documented high-end build → upper tail
    case "survivor": return pct(55);
    case "project":  return pct(30);
    default:         return recencyWeightedMedian(rows, subjectYear);
  }
}

async function getBasePrice(supabase: any, vehicle: any): Promise<{
  basePrice: number;
  compCount: number;
  method: string;
}> {
  const make = vehicle.make;
  const model = vehicle.model;
  const year = vehicle.year;

  if (!make || !year) {
    return { basePrice: 0, compCount: 0, method: "none" };
  }

  // Subject build class → which percentile of the comp pool anchors the estimate.
  const buildClass = await getBuildClass(supabase, vehicle.id);
  // Subject body class → hard mismatch filter on the comp pool (Stage-2-lite).
  const bodyClass = subjectBodyClass(vehicle);
  const anchor = (rows: any[]) => classAwareAnchor(rows, buildClass, year);
  const label = (tier: string, stratified = false) => {
    const base = buildClass !== "unknown" ? "class_stratified" : tier;
    return stratified ? `${base}_bodied` : base;
  };

  // ---- Tier 1: Canonical model aliases (best quality match) ----
  if (model) {
    const normalizedModel = normalizeModelForComps(model);
    const { data: canonMatch } = await supabase
      .from("canonical_models")
      .select("canonical_model, aliases")
      .ilike("make", make)
      .or(`canonical_model.ilike.%${normalizedModel}%`)
      .limit(5);

    // Also check if the model string matches any alias
    let bestCanonical: string | null = null;
    if (canonMatch && canonMatch.length > 0) {
      for (const cm of canonMatch) {
        if (cm.aliases && Array.isArray(cm.aliases)) {
          for (const alias of cm.aliases) {
            if (normalizedModel.includes(alias.toLowerCase()) || alias.toLowerCase().includes(normalizedModel)) {
              bestCanonical = cm.canonical_model;
              break;
            }
          }
        }
        if (bestCanonical) break;
        // Direct match on canonical_model
        if (normalizedModel.includes(cm.canonical_model.toLowerCase())) {
          bestCanonical = cm.canonical_model;
        }
      }
    }

    if (!bestCanonical && model) {
      // Try matching with core model extracted
      const coreModel = extractCoreModel(normalizedModel);
      if (coreModel) {
        const { data: coreMatch } = await supabase
          .from("canonical_models")
          .select("canonical_model, aliases")
          .ilike("make", make)
          .limit(50);

        if (coreMatch) {
          for (const cm of coreMatch) {
            const cmLower = cm.canonical_model.toLowerCase();
            if (cmLower === coreModel || coreModel.startsWith(cmLower + " ") || cmLower.startsWith(coreModel + " ")) {
              bestCanonical = cm.canonical_model;
              break;
            }
            if (cm.aliases && Array.isArray(cm.aliases)) {
              for (const alias of cm.aliases) {
                const aliasLower = alias.toLowerCase();
                if (aliasLower === coreModel || coreModel.startsWith(aliasLower) || aliasLower.startsWith(coreModel)) {
                  bestCanonical = cm.canonical_model;
                  break;
                }
              }
            }
            if (bestCanonical) break;
          }
        }
      }
    }

    // If we found a canonical model, use it for comp lookup
    if (bestCanonical) {
      const { data: canonComps } = await supabase
        .from("clean_vehicle_prices")
        .select("vehicle_id, year, model, best_price, is_sold, updated_at, price_source")
        .ilike("make", make)
        .ilike("model", `%${bestCanonical}%`)
        .gte("year", year - 5)
        .lte("year", year + 5)
        .gt("best_price", 0)
        .order("updated_at", { ascending: false })
        .limit(300);

      if (canonComps && canonComps.length >= 3) {
        const s = await stratifyByBody(supabase, canonComps, bodyClass);
        return { basePrice: anchor(s.rows), compCount: s.rows.length, method: label("canonical", s.stratified) };
      }
    }
  }

  // ---- Tier 2: Exact model string match (original logic) ----
  if (model) {
    const { data: compRows } = await supabase
      .from("clean_vehicle_prices")
      .select("vehicle_id, year, model, best_price, is_sold, updated_at, price_source")
      .ilike("make", make)
      .ilike("model", `%${model}%`)
      .gte("year", year - 5)
      .lte("year", year + 5)
      .gt("best_price", 0)
      .order("updated_at", { ascending: false })
      .limit(300);

    if (compRows && compRows.length >= 3) {
      const s = await stratifyByBody(supabase, compRows, bodyClass);
      return { basePrice: anchor(s.rows), compCount: s.rows.length, method: label("exact", s.stratified) };
    }
  }

  // ---- Tier 3: Normalized model match (strips chassis/VIN/accents) ----
  if (model) {
    const normalizedModel = normalizeModelForComps(model);
    if (normalizedModel && normalizedModel !== model.toLowerCase()) {
      const { data: normComps } = await supabase
        .from("clean_vehicle_prices")
        .select("vehicle_id, year, model, best_price, is_sold, updated_at, price_source")
        .ilike("make", make)
        .ilike("model", `%${normalizedModel}%`)
        .gte("year", year - 5)
        .lte("year", year + 5)
        .gt("best_price", 0)
        .order("updated_at", { ascending: false })
        .limit(300);

      if (normComps && normComps.length >= 3) {
        const s = await stratifyByBody(supabase, normComps, bodyClass);
        return { basePrice: anchor(s.rows), compCount: s.rows.length, method: label("normalized", s.stratified) };
      }
    }
  }

  // ---- Tier 4: Core model match (first 1-3 significant tokens) ----
  if (model) {
    const coreModel = extractCoreModel(normalizeModelForComps(model));
    if (coreModel && coreModel.length >= 2) {
      const { data: coreComps } = await supabase
        .from("clean_vehicle_prices")
        .select("vehicle_id, year, model, best_price, is_sold, updated_at, price_source")
        .ilike("make", make)
        .ilike("model", `%${coreModel}%`)
        .gte("year", year - 5)
        .lte("year", year + 5)
        .gt("best_price", 0)
        .order("updated_at", { ascending: false })
        .limit(300);

      if (coreComps && coreComps.length >= 3) {
        const s = await stratifyByBody(supabase, coreComps, bodyClass);
        return { basePrice: anchor(s.rows), compCount: s.rows.length, method: label("core_model", s.stratified) };
      }
    }
  }

  // ---- Tier 5: Make-only fallback with wider year range ----
  const { data: makeComps } = await supabase
    .from("clean_vehicle_prices")
    .select("year, best_price, is_sold, updated_at, price_source")
    .ilike("make", make)
    .gte("year", year - 10)
    .lte("year", year + 10)
    .gt("best_price", 0)
    .order("updated_at", { ascending: false })
    .limit(200);

  if (makeComps && makeComps.length > 0) {
    // Make-only is too coarse to trust a class anchor → keep the median even when classed.
    return { basePrice: recencyWeightedMedian(makeComps, year), compCount: makeComps.length, method: "make_fallback" };
  }

  return { basePrice: 0, compCount: 0, method: "none" };
}

// ============================================================================
// STAGE-2-LITE SIMILARITY — body-style stratification + year proximity
// (valuation-methodology.md Part II §2.2). Without this, a C-code coupe gets
// priced against fastback/convertible/Shelby money: the raw first-gen Mustang
// pool medians ~$42K while the coupe-only slice medians ~$24K (2026-07-07).
// Body style is a hard mismatch filter (mismatched comps dropped), unknown
// bodies stay at half weight; year distance becomes a weight per the paper.
// ============================================================================
const BODY_TOKEN_CLASSES: [RegExp, string][] = [
  [/fastback|sportsroof|liftback/i, "FASTBACK"],
  [/convertible|cabriolet|drophead|roadster|spyder|spider/i, "CONVERTIBLE"],
  [/coupe|hardtop|notchback/i, "COUPE"],
  [/wagon|estate/i, "WAGON"],
  [/pickup|stepside|fleetside/i, "PICKUP"],
];

function bodyClassFromStrings(...parts: (string | null | undefined)[]): string | null {
  const hay = parts.filter(Boolean).join(" ");
  for (const [re, cls] of BODY_TOKEN_CLASSES) if (re.test(hay)) return cls;
  return null;
}

function subjectBodyClass(vehicle: any): string | null {
  if (vehicle.canonical_body_style) return String(vehicle.canonical_body_style).toUpperCase();
  return bodyClassFromStrings(vehicle.body_style, vehicle.model, vehicle.trim, vehicle.series);
}

// Comps come from clean_vehicle_prices, which has no body columns — enrich from
// vehicles in batched .in() queries, fall back to body tokens in the model string.
async function stratifyByBody(supabase: any, rows: any[], subjectBody: string | null): Promise<{ rows: any[]; stratified: boolean }> {
  if (!subjectBody || !rows?.length) return { rows: rows || [], stratified: false };
  const ids = rows.map((r) => r.vehicle_id).filter(Boolean);
  const bodyById = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("vehicles")
      .select("id, canonical_body_style, body_style, model, trim")
      .in("id", ids.slice(i, i + 200));
    if (error) console.error("[valuation] body enrich error:", error.message);
    for (const v of data || []) {
      const body = v.canonical_body_style
        ? String(v.canonical_body_style).toUpperCase()
        : bodyClassFromStrings(v.body_style, v.model, v.trim);
      bodyById.set(v.id, body);
    }
  }
  const kept = rows
    .map((r) => {
      const body = bodyById.get(r.vehicle_id) ?? bodyClassFromStrings(r.model);
      if (!body) return { ...r, sim_weight: 0.5 }; // unknown body — half weight (§3.5 asymmetry spirit)
      return body === subjectBody ? { ...r, sim_weight: 1.0 } : null; // hard mismatch → dropped
    })
    .filter(Boolean);
  // Thin-market guard (§2.5): if stratification starves the pool, fall back unstratified.
  if (kept.length < 3) return { rows: rows.map((r) => ({ ...r, sim_weight: 0.5 })), stratified: false };
  return { rows: kept, stratified: true };
}

// Year proximity weight per the paper's similarity table (±1 → 0.8, ±2 → 0.5, ±5 → 0.2).
function yearProximityWeight(subjectYear: number | null, compYear: number | null): number {
  if (!subjectYear || !compYear) return 0.5;
  const d = Math.abs(subjectYear - compYear);
  if (d === 0) return 1.0;
  if (d <= 1) return 0.8;
  if (d <= 2) return 0.5;
  if (d <= 5) return 0.2;
  return 0.05;
}

// Consecration of a price by its TYPE — the field's authority to confer worth.
// Doctrine: docs/library/intellectual/contemplations/habitus-and-the-exchange.md (Law 2).
// A consummated sale is the supreme consecratory act; an asking price is an ASK,
// not a sale, and should not anchor a valuation the way a hammer price does.
const PRICE_CONSECRATION: Record<string, number> = {
  sale_price: 1.0, // consummated sale — money moved
  bat_sold_price: 1.0, // consummated BaT sale
  winning_bid: 0.9, // auction close
  high_bid: 0.6, // auction high — not necessarily sold
  asking_price: 0.35, // a listing is an ask, not a consecration
  current_value: 0.25, // owner/derived estimate
};

function recencyWeightedMedian(rows: any[], subjectYear: number | null = null): number {
  const now = Date.now();
  const sixMonths = 180 * 24 * 60 * 60 * 1000;
  const oneYear = 365 * 24 * 60 * 60 * 1000;
  const twoYears = 730 * 24 * 60 * 60 * 1000;

  // Apply recency + consecration + similarity weights
  const weighted: { price: number; weight: number }[] = rows.map((r: any) => {
    const age = now - new Date(r.updated_at).getTime();
    let weight = 0.3;
    if (age < sixMonths) weight = 1.0;
    else if (age < oneYear) weight = 0.7;
    else if (age < twoYears) weight = 0.4;
    // Sold vehicles get a boost
    if (r.is_sold) weight *= 1.2;
    // Consecration: weight by how much the price TYPE confers worth (sale >> ask)
    weight *= PRICE_CONSECRATION[r.price_source as string] ?? 0.5;
    // Stage-2-lite similarity: body match (set upstream) and year proximity
    weight *= r.sim_weight ?? 1.0;
    weight *= yearProximityWeight(subjectYear, r.year ?? null);
    return { price: Number(r.best_price), weight };
  });

  // Sort by price
  weighted.sort((a, b) => a.price - b.price);

  // Weighted median: find the price where cumulative weight crosses 50%
  const totalWeight = weighted.reduce((s, w) => s + w.weight, 0);
  const halfWeight = totalWeight / 2;
  let cumWeight = 0;
  for (const w of weighted) {
    cumWeight += w.weight;
    if (cumWeight >= halfWeight) return w.price;
  }
  return weighted[weighted.length - 1]?.price || 0;
}

// ============================================================================
// STEP 2: SIGNAL MULTIPLIERS
// ============================================================================

async function getConditionMultiplier(supabase: any, vehicleId: string): Promise<{
  multiplier: number;
  sourceCount: number;
}> {
  // Real source: vehicle_condition_scores. (`condition_assessments` was a PHANTOM
  // table — the query silently returned null, so this signal read as "no data" for
  // every vehicle.) KEYSTONE: check {error} loudly so a missing relation can never
  // again masquerade as missing data.
  //
  // CRITICAL: condition_score is teardown-INCLUSIVE — built from the as-found/build
  // photos (rust, oxidation, paint-fading) — so it must NOT penalize a FINISHED
  // resto-mod. Until build-class-aware scoring lands, record that condition data is
  // PRESENT (sourceCount) but keep the multiplier NEUTRAL — never a condition-blind cut.
  const { data: scores, error } = await supabase
    .from("vehicle_condition_scores")
    .select("condition_score, observation_count, zone_coverage")
    .eq("vehicle_id", vehicleId)
    .limit(1);

  if (error) console.error("[valuation] condition query error (vehicle_condition_scores):", error.message);
  if (!scores || scores.length === 0) {
    return { multiplier: 1.0, sourceCount: 0 };
  }
  // Neutral multiplier on purpose (class-aware scoring TODO); sourceCount proves the
  // signal is now firing on real data instead of a phantom table.
  return { multiplier: 1.0, sourceCount: scores[0].observation_count || 0 };
}

async function getRarityMultiplier(supabase: any, vehicle: any): Promise<{
  multiplier: number;
  sourceCount: number;
}> {
  if (!vehicle.make || !vehicle.model || !vehicle.year) {
    return { multiplier: 1.0, sourceCount: 0 };
  }

  const { data: prodData } = await supabase
    .from("vehicle_production_data")
    .select("total_produced, rarity_level, collector_demand_score")
    .ilike("make", vehicle.make)
    .ilike("model", vehicle.model)
    .eq("year", vehicle.year)
    .limit(1);

  if (!prodData || prodData.length === 0) {
    return { multiplier: 1.0, sourceCount: 0 };
  }

  const prod = prodData[0];
  const rarityMap: Record<string, number> = {
    ULTRA_RARE: 1.20,
    RARE: 1.12,
    UNCOMMON: 1.05,
    COMMON: 1.00,
    MASS_PRODUCTION: 0.98,
  };

  const multiplier = rarityMap[prod.rarity_level] || 1.0;
  return { multiplier: clamp(multiplier, 0.98, 1.20), sourceCount: 1 };
}

async function getSentimentMultiplier(supabase: any, vehicleId: string): Promise<{
  multiplier: number;
  sourceCount: number;
}> {
  const { data: discoveries } = await supabase
    .from("comment_discoveries")
    .select("sentiment_score, comment_count")
    .eq("vehicle_id", vehicleId)
    .limit(1);

  if (!discoveries || discoveries.length === 0) {
    return { multiplier: 1.0, sourceCount: 0 };
  }

  const d = discoveries[0];
  const score = d.sentiment_score || 0;
  // sentiment_score typically -1 to 1
  // Positive sentiment = slight premium, negative = slight discount
  const multiplier = 1.0 + (score * 0.08);
  return { multiplier: clamp(multiplier, 0.95, 1.08), sourceCount: d.comment_count || 1 };
}

async function getBidCurveMultiplier(supabase: any, vehicle: any): Promise<{
  multiplier: number;
  sourceCount: number;
}> {
  if (!vehicle.make || !vehicle.model) {
    return { multiplier: 1.0, sourceCount: 0 };
  }

  // Check auction_comments for bid data
  const { data: bids } = await supabase
    .from("auction_comments")
    .select("bid_amount")
    .eq("vehicle_id", vehicle.id)
    .not("bid_amount", "is", null)
    .gt("bid_amount", 0)
    .order("bid_amount", { ascending: false })
    .limit(50);

  if (!bids || bids.length < 3) {
    return { multiplier: 1.0, sourceCount: 0 };
  }

  // High bid velocity (many bids) = premium
  const bidCount = bids.length;
  let multiplier = 1.0;
  if (bidCount >= 30) multiplier = 1.05;
  else if (bidCount >= 15) multiplier = 1.03;
  else if (bidCount >= 5) multiplier = 1.01;

  return { multiplier: clamp(multiplier, 0.98, 1.05), sourceCount: bidCount };
}

async function getMarketTrendMultiplier(supabase: any, vehicle: any): Promise<{
  multiplier: number;
  sourceCount: number;
}> {
  if (!vehicle.make || !vehicle.model) {
    return { multiplier: 1.0, sourceCount: 0 };
  }

  const { data: stats } = await supabase
    .from("market_segment_stats")
    .select("price_trend_30d, price_trend_90d, sample_size")
    .ilike("make", vehicle.make)
    .ilike("model", `%${vehicle.model}%`)
    .limit(1);

  if (!stats || stats.length === 0) {
    return { multiplier: 1.0, sourceCount: 0 };
  }

  const s = stats[0];
  // price_trend is typically a percentage change
  const trend30 = s.price_trend_30d || 0;
  const trend90 = s.price_trend_90d || 0;

  // Blend: 60% weight on 30d, 40% on 90d
  const blended = trend30 * 0.6 + trend90 * 0.4;
  // Convert to multiplier: +10% trend = 1.03x, -10% trend = 0.97x
  const multiplier = 1.0 + (blended / 100) * 0.3;
  return { multiplier: clamp(multiplier, 0.97, 1.03), sourceCount: s.sample_size || 1 };
}

async function getSurvivalMultiplier(supabase: any, vehicle: any): Promise<{
  multiplier: number;
  sourceCount: number;
}> {
  if (!vehicle.make || !vehicle.model || !vehicle.year) {
    return { multiplier: 1.0, sourceCount: 0 };
  }

  const { data: survival } = await supabase
    .from("survival_rate_estimates")
    .select("survival_rate, estimated_surviving, confidence_score")
    .ilike("make", vehicle.make)
    .ilike("model", vehicle.model)
    .lte("year_start", vehicle.year)
    .gte("year_end", vehicle.year)
    .limit(1);

  if (!survival || survival.length === 0) {
    return { multiplier: 1.0, sourceCount: 0 };
  }

  const sr = survival[0];
  const rate = sr.survival_rate || 0.5;

  // Very low survival = premium
  let multiplier = 1.0;
  if (rate < 0.01) multiplier = 1.10;      // < 1% surviving
  else if (rate < 0.05) multiplier = 1.06;  // < 5% surviving
  else if (rate < 0.10) multiplier = 1.03;  // < 10% surviving
  else if (rate < 0.20) multiplier = 1.01;  // < 20% surviving

  return { multiplier: clamp(multiplier, 1.0, 1.10), sourceCount: 1 };
}

async function getRecordProximityEffect(supabase: any, vehicle: any, basePrice: number): Promise<{
  widenInterval: number; // Additional percentage to add to confidence interval
  sourceCount: number;
}> {
  if (!vehicle.make || !vehicle.model || !vehicle.year) {
    return { widenInterval: 0, sourceCount: 0 };
  }

  const { data: records } = await supabase
    .from("record_prices")
    .select("record_price")
    .ilike("make", vehicle.make)
    .ilike("model", vehicle.model)
    .lte("year_start", vehicle.year)
    .gte("year_end", vehicle.year)
    .limit(1);

  if (!records || records.length === 0) {
    return { widenInterval: 0, sourceCount: 0 };
  }

  const recordPrice = Number(records[0].record_price);
  if (recordPrice <= 0) return { widenInterval: 0, sourceCount: 0 };

  // If base price is within 30% of the record, widen the confidence interval
  const proximity = basePrice / recordPrice;
  let widenInterval = 0;
  if (proximity > 0.7) widenInterval = 0.10; // Within 30% of record
  if (proximity > 0.85) widenInterval = 0.15; // Within 15% of record
  if (proximity > 0.95) widenInterval = 0.20; // Within 5% of record

  return { widenInterval, sourceCount: 1 };
}

async function getOriginalityMultiplier(supabase: any, vehicleId: string): Promise<{
  multiplier: number;
  sourceCount: number;
}> {
  // Real source: vehicle_condition_scores.descriptor_summary. (`vehicle_condition_profiles`
  // was a PHANTOM table.) KEYSTONE: check {error} loudly.
  //
  // CRITICAL: for a RESTO-MOD, modifications are VALUE, not a penalty. The old logic
  // (less original → lower multiplier) would punish a documented build. Until build-
  // class-aware scoring lands, record the build-evidence is PRESENT (sourceCount of
  // mod atoms) but keep the multiplier NEUTRAL — never penalize documented mods.
  const { data: scores, error } = await supabase
    .from("vehicle_condition_scores")
    .select("descriptor_summary")
    .eq("vehicle_id", vehicleId)
    .limit(1);

  if (error) console.error("[valuation] originality query error (vehicle_condition_scores):", error.message);
  if (!scores || scores.length === 0) {
    return { multiplier: 1.0, sourceCount: 0 };
  }
  const ds = scores[0].descriptor_summary || {};
  // Build-evidence atoms: aftermarket / non-original / forced-induction / lifted / restored.
  const modCount = Object.keys(ds)
    .filter((k) => /aftermarket|non_original|forced_induction|lifted|restored|modification/.test(k))
    .reduce((s, k) => s + ((ds[k] && ds[k].count) || 0), 0);
  return { multiplier: 1.0, sourceCount: modCount };
}

// ============================================================================
// STEP 4: DEAL SCORE
// ============================================================================
function computeDealScore(estimatedValue: number, askingPrice: number | null, createdAt: string | null): {
  dealScore: number | null;
  dealScoreLabel: string | null;
} {
  if (!askingPrice || askingPrice <= 0 || estimatedValue <= 0) {
    return { dealScore: null, dealScoreLabel: null };
  }

  const rawDeal = ((estimatedValue - askingPrice) / estimatedValue) * 100;

  // Freshness decay
  let freshnessDecay = 0.30;
  if (createdAt) {
    const ageMs = Date.now() - new Date(createdAt).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    if (ageHours < 24) freshnessDecay = 1.0;
    else if (ageHours < 72) freshnessDecay = 0.95;
    else if (ageHours < 168) freshnessDecay = 0.85;
    else if (ageHours < 720) freshnessDecay = 0.50;
  }

  const dealScore = rawDeal * freshnessDecay;

  let dealScoreLabel: string;
  if (dealScore >= 25) dealScoreLabel = "plus_3";
  else if (dealScore >= 15) dealScoreLabel = "plus_2";
  else if (dealScore >= 5) dealScoreLabel = "plus_1";
  else if (dealScore >= -5) dealScoreLabel = "fair";
  else if (dealScore >= -15) dealScoreLabel = "minus_1";
  else if (dealScore >= -25) dealScoreLabel = "minus_2";
  else dealScoreLabel = "minus_3";

  return {
    dealScore: Math.round(dealScore * 100) / 100,
    dealScoreLabel,
  };
}

// ============================================================================
// STEP 5: HEAT SCORE
// ============================================================================
async function computeHeatScore(supabase: any, vehicle: any, dealScore: number | null): Promise<{
  heatScore: number;
  heatScoreLabel: string;
}> {
  let heat = 0;

  // Live auction: +30
  if (vehicle.sale_status === "live" || vehicle.sale_status === "active") {
    heat += 30;
  }

  // Sold within 7d: +25
  if (vehicle.sale_date) {
    const saleAge = Date.now() - new Date(vehicle.sale_date).getTime();
    if (saleAge < 7 * 24 * 60 * 60 * 1000) heat += 25;
  }

  // Strong deal: +15
  if (dealScore && dealScore > 15) heat += 15;

  // High bid velocity: +10
  const { count: bidCount } = await supabase
    .from("auction_comments")
    .select("id", { count: "exact", head: true })
    .eq("vehicle_id", vehicle.id)
    .not("bid_amount", "is", null);
  if (bidCount && bidCount > 20) heat += 10;

  // Community buzz: +10
  const { count: commentCount } = await supabase
    .from("auction_comments")
    .select("id", { count: "exact", head: true })
    .eq("vehicle_id", vehicle.id);
  if (commentCount && commentCount > 100) heat += 10;

  // Ultra-rare: +10
  const { data: prodData } = await supabase
    .from("vehicle_production_data")
    .select("rarity_level")
    .ilike("make", vehicle.make || "")
    .ilike("model", vehicle.model || "")
    .eq("year", vehicle.year || 0)
    .limit(1);
  if (prodData?.[0]?.rarity_level === "ULTRA_RARE") heat += 10;

  // New listing (< 48hr): +5
  if (vehicle.created_at) {
    const age = Date.now() - new Date(vehicle.created_at).getTime();
    if (age < 48 * 60 * 60 * 1000) heat += 5;
  }

  heat = Math.min(heat, 100);

  let heatScoreLabel: string;
  if (heat >= 80) heatScoreLabel = "volcanic";
  else if (heat >= 60) heatScoreLabel = "fire";
  else if (heat >= 40) heatScoreLabel = "hot";
  else if (heat >= 20) heatScoreLabel = "warm";
  else heatScoreLabel = "cold";

  return { heatScore: heat, heatScoreLabel };
}

// ============================================================================
// MAIN VALUATION COMPUTATION
// ============================================================================
async function computeValuation(supabase: any, vehicleId: string): Promise<any> {
  // Fetch vehicle data
  const { data: vehicle, error: vErr } = await supabase
    .from("vehicles")
    .select("id, year, make, model, series, trim, vin, mileage, body_style, canonical_body_style, sale_price, asking_price, current_value, sale_status, sale_date, created_at, updated_at, discovery_url, profile_origin")
    .eq("id", vehicleId)
    .maybeSingle();

  if (vErr) {
    return { error: `Vehicle lookup failed for ${vehicleId}: ${vErr.message || String(vErr)}`, vehicleId };
  }
  if (!vehicle) {
    return { error: `Vehicle not found: ${vehicleId}`, vehicleId };
  }

  // Step 1: Base price from comparables
  let { basePrice, compCount, method: compMethod } = await getBasePrice(supabase, vehicle);
  if (basePrice <= 0) {
    // No independent comps found. If vehicle already sold, skip — using its own
    // sale_price as the "estimate" is circular and meaningless.
    if (vehicle.sale_price && vehicle.sale_price > 0) {
      return { error: "no_independent_comps", vehicleId };
    }
    // No independent comps AND no sale price. Do NOT fall back to the vehicle's own
    // asking_price / current_value: deriving the estimate from the ask is circular — it
    // produces a fixed asking×~1.8 "estimate" and a meaningless (constant) deal score, which
    // is exactly the contamination that made the deal output untrustworthy. Leave
    // nuke_estimate NULL. "Not enough comps to value this" is a truthful, meaningful state.
    return { error: "no_independent_comps", vehicleId };
  }

  if (basePrice <= 0) {
    return { error: "No comparable sales data available and no fallback price", vehicleId };
  }

  // Determine price tier
  const priceTier = getPriceTier(basePrice);
  const weights = TIER_WEIGHTS[priceTier];

  // Step 2: Get all signal multipliers
  const [
    condition,
    rarity,
    sentiment,
    bidCurve,
    marketTrend,
    survival,
    recordProx,
    originality,
  ] = await Promise.all([
    getConditionMultiplier(supabase, vehicleId),
    getRarityMultiplier(supabase, vehicle),
    getSentimentMultiplier(supabase, vehicleId),
    getBidCurveMultiplier(supabase, vehicle),
    getMarketTrendMultiplier(supabase, vehicle),
    getSurvivalMultiplier(supabase, vehicle),
    getRecordProximityEffect(supabase, vehicle, basePrice),
    getOriginalityMultiplier(supabase, vehicleId),
  ]);

  // Step 3: Apply weighted multipliers
  const signals = {
    comps: { weight: weights.comps, multiplier: 1.0, sourceCount: compCount },
    condition: { weight: weights.condition, multiplier: condition.multiplier, sourceCount: condition.sourceCount },
    rarity: { weight: weights.rarity, multiplier: rarity.multiplier, sourceCount: rarity.sourceCount },
    sentiment: { weight: weights.sentiment, multiplier: sentiment.multiplier, sourceCount: sentiment.sourceCount },
    bid_curve: { weight: weights.bid_curve, multiplier: bidCurve.multiplier, sourceCount: bidCurve.sourceCount },
    market_trend: { weight: weights.market_trend, multiplier: marketTrend.multiplier, sourceCount: marketTrend.sourceCount },
    survival: { weight: weights.survival, multiplier: survival.multiplier, sourceCount: survival.sourceCount },
    originality: { weight: weights.originality, multiplier: originality.multiplier, sourceCount: originality.sourceCount },
  };

  // Compute weighted composite multiplier
  let compositeMultiplier = 0;
  let totalWeight = 0;
  for (const [, sig] of Object.entries(signals)) {
    compositeMultiplier += sig.weight * sig.multiplier;
    totalWeight += sig.weight;
  }
  if (totalWeight > 0) compositeMultiplier /= totalWeight;
  else compositeMultiplier = 1.0;

  const estimatedValue = Math.round(basePrice * compositeMultiplier * 100) / 100;

  // Confidence interval — widen for less precise comp methods
  const baseInterval = weights.confidence_interval;
  const recordWiden = recordProx.widenInterval;
  const methodWiden = compMethod === "core_model" ? 0.05
    : compMethod === "make_fallback" ? 0.10
    : compMethod === "self_price_fallback" ? 0.15
    : 0;
  const totalInterval = baseInterval + recordWiden + methodWiden;

  const valueLow = Math.round(estimatedValue * (1 - totalInterval) * 100) / 100;
  const valueHigh = Math.round(estimatedValue * (1 + totalInterval) * 100) / 100;

  // Confidence score: based on input count and comp quality
  const inputCount = Object.values(signals).reduce((s, sig) => s + (sig.sourceCount > 0 ? 1 : 0), 0);
  let confidence = 30 + inputCount * 8 + Math.min(compCount, 20) * 1.5;
  // Comp method quality bonus: exact/canonical are best, normalized/core are good
  if (compMethod === "exact") confidence += 10;
  else if (compMethod === "canonical") confidence += 9;
  else if (compMethod === "normalized") confidence += 7;
  else if (compMethod === "core_model") confidence += 5;
  else if (compMethod === "make_fallback") confidence += 0;
  // self_price_fallback gets no bonus (already in base 30)
  confidence = Math.min(Math.round(confidence), 100);

  // Cap confidence for self_price_fallback (no independent data)
  if (compMethod === "self_price_fallback") {
    confidence = Math.min(confidence, 25);
  }

  // Step 4: Deal score — null for self_price_fallback (no independent baseline)
  const askingPrice = vehicle.asking_price || vehicle.current_value;
  const { dealScore: rawDealScore, dealScoreLabel: rawDealScoreLabel } = computeDealScore(estimatedValue, askingPrice, vehicle.created_at);
  const dealScore = compMethod === "self_price_fallback" ? null : rawDealScore;
  const dealScoreLabel = compMethod === "self_price_fallback" ? null : rawDealScoreLabel;

  // Step 5: Heat score
  const { heatScore, heatScoreLabel } = await computeHeatScore(supabase, vehicle, dealScore);

  // Build result
  const result = {
    vehicle_id: vehicleId,
    estimated_value: estimatedValue,
    value_low: valueLow,
    value_high: valueHigh,
    confidence_score: confidence,
    price_tier: priceTier,
    confidence_interval_pct: Math.round(totalInterval * 10000) / 100,
    signal_weights: signals,
    deal_score: dealScore,
    deal_score_label: dealScoreLabel,
    heat_score: heatScore,
    heat_score_label: heatScoreLabel,
    model_version: "v1",
    input_count: inputCount,
    calculated_at: new Date().toISOString(),
    is_stale: false,
    comp_method: compMethod,
    is_circular: false,
  };

  // Upsert to nuke_estimates
  const { error: upsertErr } = await supabase
    .from("nuke_estimates")
    .upsert(result, { onConflict: "vehicle_id" });

  if (upsertErr) {
    console.error(`[compute-valuation] Upsert error for ${vehicleId}:`, upsertErr);
    return { error: upsertErr.message, vehicleId };
  }

  // Denormalize to vehicles table
  const { error: denormErr } = await supabase
    .from("vehicles")
    .update({
      nuke_estimate: estimatedValue,
      nuke_estimate_confidence: confidence,
      deal_score: dealScore,
      heat_score: heatScore,
      valuation_calculated_at: result.calculated_at,
    })
    .eq("id", vehicleId);

  if (denormErr) {
    console.error(`[compute-valuation] Denormalization error for ${vehicleId}:`, denormErr);
  }

  // Log to projection_outcomes for feedback loop
  if (estimatedValue > 0) {
    try {
      await supabase.from("projection_outcomes").insert({
        vehicle_id: vehicleId,
        projection_type: "nuke_estimate",
        projected_value: estimatedValue,
        projected_at: result.calculated_at,
        projection_horizon: "spot",
        model_version: "v1",
        model_metadata: { price_tier: priceTier, input_count: inputCount, comp_count: compCount },
      });
    } catch {
      // Non-critical: projection logging can fail silently
    }
  }

  return result;
}

// ============================================================================
// SERVE
// ============================================================================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Require service role key authentication
    const authHeader = req.headers.get("Authorization");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const altServiceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
    const token = authHeader?.replace("Bearer ", "") ?? "";
    if (!authHeader?.startsWith("Bearer ") || (token !== serviceRoleKey && token !== altServiceRoleKey)) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      serviceRoleKey
    );

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const force = body.force || false;

    // Determine vehicle IDs
    let vehicleIds: string[] = [];
    if (body.vehicle_id) {
      vehicleIds = [body.vehicle_id];
    } else if (body.vehicle_ids && Array.isArray(body.vehicle_ids)) {
      vehicleIds = body.vehicle_ids.slice(0, 100); // Max 100
    } else if (body.batch_size) {
      // Auto-discover vehicles that need valuation
      const batchSize = Math.min(body.batch_size || 50, 100);
      const { data: candidates, error: candErr } = await supabase
        .from("vehicles")
        .select("id")
        .not("year", "is", null)
        .not("make", "is", null)
        .is("nuke_estimate", null)
        .gt("year", 1900)
        .limit(batchSize);

      if (candErr) {
        return new Response(
          JSON.stringify({ error: `Failed to find candidates: ${candErr.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      vehicleIds = (candidates || []).map((v: any) => v.id);
      if (vehicleIds.length === 0) {
        return new Response(
          JSON.stringify({ success: true, computed: 0, errors: 0, message: "No unvalued vehicles with year+make found" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      return new Response(
        JSON.stringify({ error: "Provide vehicle_id, vehicle_ids, or batch_size" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Filter out already-computed (unless force)
    let cachedResults: any[] = [];
    if (!force) {
      const { data: existing } = await supabase
        .from("nuke_estimates")
        .select("*")
        .in("vehicle_id", vehicleIds)
        .eq("is_stale", false);

      if (existing?.length) {
        cachedResults = existing;
        const existingIds = new Set(existing.map((e: any) => e.vehicle_id));
        vehicleIds = vehicleIds.filter((id) => !existingIds.has(id));

        // Re-denormalize cached results to vehicles table in case previous
        // denormalization failed (prevents infinite cron retry loop where
        // vehicles.nuke_estimate stays NULL while nuke_estimates has a row)
        for (const cached of existing) {
          await supabase
            .from("vehicles")
            .update({
              nuke_estimate: cached.estimated_value,
              nuke_estimate_confidence: cached.confidence_score,
              deal_score: cached.deal_score,
              heat_score: cached.heat_score,
              valuation_calculated_at: cached.calculated_at,
            })
            .eq("id", cached.vehicle_id)
            .is("nuke_estimate", null);
        }
      }
    }

    if (vehicleIds.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          computed: 0,
          cached: cachedResults.length,
          results: cachedResults.length <= 5 ? cachedResults : undefined,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Compute valuations in parallel batches of 10
    const results: any[] = [];
    const errors: any[] = [];
    const BATCH_SIZE = 10;
    for (let i = 0; i < vehicleIds.length; i += BATCH_SIZE) {
      const batch = vehicleIds.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (vid) => {
          try {
            const result = await computeValuation(supabase, vid);
            return { result, vid };
          } catch (e: unknown) {
            return { error: e instanceof Error ? e.message : String(e), vid };
          }
        })
      );
      for (const br of batchResults) {
        if ("error" in br && !("result" in br)) {
          errors.push({ vehicleId: br.vid, error: br.error });
        } else if (br.result.error) {
          errors.push(br.result);
        } else {
          results.push(br.result);
        }
      }
    }

    const allResults = [...cachedResults, ...results];

    return new Response(
      JSON.stringify({
        success: true,
        computed: results.length,
        cached: cachedResults.length,
        errors: errors.length,
        results: allResults.length <= 5 ? allResults : undefined, // Only include details for small batches
        error_details: errors.length > 0 ? errors : undefined,
      }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("[compute-vehicle-valuation] Error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
