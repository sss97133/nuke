/**
 * API v1 - Signal Score Endpoint
 *
 * Returns market signal scores for a vehicle — the "is this a good deal?" answer.
 * Combines comparable sales, pricing position, heat, and auction sentiment into a
 * single 0-100 deal score with confidence-weighted signal breakdown.
 *
 * Supports lookup by vehicle_id or VIN.
 * When no estimate exists, triggers on-demand valuation (adds ~1-3s, but returns data).
 *
 * Authentication: Bearer token (Supabase JWT) or API key (nk_live_...)
 *
 * GET /api-v1-signal?vehicle_id=<uuid>
 * GET /api-v1-signal?vin=<vin>
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Label translation ──────────────────────────────────────────────────────
// Internal DB labels → consumer-facing SDK labels

const DEAL_LABEL_MAP: Record<string, string> = {
  plus_3: "strong_buy",
  plus_2: "buy",
  plus_1: "buy",
  fair:   "hold",
  minus_1: "pass",
  minus_2: "overpriced",
  minus_3: "overpriced",
};

function toDealLabel(raw: string | null): string | null {
  if (!raw) return null;
  return DEAL_LABEL_MAP[raw] ?? raw;
}

// ── Signal weight extraction ───────────────────────────────────────────────

interface SignalWeights {
  comp_coverage: number | null;
  condition_signal: number | null;
  auction_sentiment: number | null;
  listing_velocity: number | null;
  price_position: number | null;
}

function extractSignalWeights(raw: Record<string, any> | null): SignalWeights {
  if (!raw) {
    return {
      comp_coverage: null,
      condition_signal: null,
      auction_sentiment: null,
      listing_velocity: null,
      price_position: null,
    };
  }
  return {
    comp_coverage:    raw.comps?.weight      ?? null,
    condition_signal: raw.condition?.weight  ?? null,
    auction_sentiment: raw.sentiment?.weight ?? null,
    listing_velocity: raw.market_trend?.weight ?? null,
    price_position:   raw.bid_curve?.weight  ?? null,
  };
}

// ── Price vs market computation ────────────────────────────────────────────
// Returns % relative to estimated value.
// Negative = vehicle price is BELOW estimated value (better deal)
// Positive = vehicle price is ABOVE estimated value (overpriced)

function computePriceVsMarket(
  vehiclePrice: number | null,
  estimatedValue: number | null
): number | null {
  if (!vehiclePrice || !estimatedValue || estimatedValue === 0) return null;
  return Math.round(((vehiclePrice - estimatedValue) / estimatedValue) * 10000) / 100;
}

// ── Comp count extraction ──────────────────────────────────────────────────

function extractCompCount(raw: Record<string, any> | null): number | null {
  if (!raw?.comps?.sourceCount && raw?.comps?.sourceCount !== 0) return null;
  return raw.comps.sourceCount;
}

// ── On-demand valuation trigger ────────────────────────────────────────────
// When no estimate exists, calls compute-vehicle-valuation inline.
// Returns the freshly computed estimate row, or null if computation fails.

async function triggerOnDemandValuation(
  vehicleId: string,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<any | null> {
  try {
    const resp = await fetch(
      `${supabaseUrl}/functions/v1/compute-vehicle-valuation`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ vehicle_id: vehicleId }),
      }
    );

    if (!resp.ok) return null;

    const result = await resp.json();
    // compute-vehicle-valuation returns { results: [...] } or error details
    if (result.error) return null;

    // Now fetch the freshly written estimate from nuke_estimates
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: estimate } = await supabase
      .from("nuke_estimates")
      .select("*")
      .eq("vehicle_id", vehicleId)
      .maybeSingle();

    return estimate ?? null;
  } catch {
    return null;
  }
}

// ── Main handler ──────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { userId, error: authError } = await authenticateRequest(req, supabase);
    if (authError || !userId) {
      return jsonResponse({ error: authError || "Authentication required" }, 401);
    }

    const url = new URL(req.url);
    const vehicleId = url.searchParams.get("vehicle_id");
    const vin = url.searchParams.get("vin");

    if (!vehicleId && !vin) {
      return jsonResponse({ error: "Either vehicle_id or vin is required" }, 400);
    }

    // Resolve vehicle_id from VIN
    let resolvedVehicleId = vehicleId;
    if (!resolvedVehicleId && vin) {
      const { data: vehicle } = await supabase
        .from("vehicles")
        .select("id")
        .eq("vin", vin.toUpperCase())
        .maybeSingle();

      if (!vehicle) {
        return jsonResponse({ error: `Vehicle not found for VIN: ${vin}` }, 404);
      }
      resolvedVehicleId = vehicle.id;
    }

    // Fetch vehicle pricing (for price_vs_market calculation)
    const { data: vehicle } = await supabase
      .from("vehicles")
      .select("id, year, make, model, sale_price, asking_price")
      .eq("id", resolvedVehicleId!)
      .maybeSingle();

    if (!vehicle) {
      return jsonResponse({ error: "Vehicle not found" }, 404);
    }

    // Effective listing price: prefer asking_price, fall back to sale_price
    const vehiclePrice = vehicle.asking_price ?? vehicle.sale_price ?? null;

    // Fetch nuke_estimates
    let { data: estimate, error: estError } = await supabase
      .from("nuke_estimates")
      .select("*")
      .eq("vehicle_id", resolvedVehicleId!)
      .maybeSingle();

    if (estError && !estError.message?.includes("does not exist")) {
      throw estError;
    }

    // On-demand valuation: if no estimate exists, compute it now
    let computedOnDemand = false;
    if (!estimate) {
      estimate = await triggerOnDemandValuation(resolvedVehicleId!, supabaseUrl, supabaseKey);
      if (estimate) {
        computedOnDemand = true;
      }
    }

    if (!estimate) {
      // Vehicle has no price data to work from — cannot compute
      return jsonResponse({
        error: "No signal score available for this vehicle. Insufficient price data.",
        vehicle_id: resolvedVehicleId,
        hint: "Vehicle needs sale_price, asking_price, or comparable sales data before a signal can be computed.",
      }, 404);
    }

    const signalWeights = extractSignalWeights(estimate.signal_weights);
    const compCount = extractCompCount(estimate.signal_weights);
    const priceVsMarket = computePriceVsMarket(vehiclePrice, estimate.estimated_value);
    const dealScoreLabel = toDealLabel(estimate.deal_score_label);

    return jsonResponse({
      data: {
        vehicle_id: estimate.vehicle_id,

        // Core scores
        deal_score: estimate.deal_score !== null ? Number(estimate.deal_score) : null,
        deal_score_label: dealScoreLabel,
        heat_score: estimate.heat_score !== null ? Number(estimate.heat_score) : null,
        heat_score_label: estimate.heat_score_label ?? null,

        // Valuation
        estimated_value: estimate.estimated_value !== null ? Number(estimate.estimated_value) : null,
        value_low: estimate.value_low !== null ? Number(estimate.value_low) : null,
        value_high: estimate.value_high !== null ? Number(estimate.value_high) : null,

        // Market positioning
        price_vs_market: priceVsMarket,
        comp_count: compCount,

        // Signal breakdown
        signal_weights: signalWeights,

        // Metadata
        confidence: estimate.confidence_score !== null ? estimate.confidence_score / 100 : null,
        model_version: estimate.model_version ?? null,
        calculated_at: estimate.calculated_at ?? null,
        is_stale: estimate.is_stale ?? null,
        computed_on_demand: computedOnDemand,
      },
    });
  } catch (err) {
    console.error("[api-v1-signal] Error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});

// ── Auth helper ────────────────────────────────────────────────────────────

async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function authenticateRequest(
  req: Request,
  supabase: any
): Promise<{ userId: string | null; error?: string }> {
  const authHeader = req.headers.get("Authorization");
  const apiKey = req.headers.get("X-API-Key");

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const altServiceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
    if (
      (serviceRoleKey && token === serviceRoleKey) ||
      (altServiceRoleKey && token === altServiceRoleKey)
    ) {
      return { userId: "service-role" };
    }
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);
    if (user && !error) return { userId: user.id };
  }

  if (apiKey) {
    const rawKey = apiKey.startsWith("nk_live_") ? apiKey.slice(8) : apiKey;
    const keyHash = await hashApiKey(rawKey);
    const { data: keyData, error } = await supabase
      .from("api_keys")
      .select("user_id, is_active, rate_limit_remaining, expires_at")
      .eq("key_hash", keyHash)
      .eq("is_active", true)
      .maybeSingle();

    if (keyData && !error) {
      if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
        return { userId: null, error: "API key has expired" };
      }
      if (keyData.rate_limit_remaining !== null && keyData.rate_limit_remaining <= 0) {
        return { userId: null, error: "Rate limit exceeded" };
      }
      await supabase
        .from("api_keys")
        .update({
          rate_limit_remaining:
            keyData.rate_limit_remaining !== null
              ? keyData.rate_limit_remaining - 1
              : null,
          last_used_at: new Date().toISOString(),
        })
        .eq("key_hash", keyHash);
      return { userId: keyData.user_id };
    }
  }

  return { userId: null, error: "Invalid or missing authentication" };
}
