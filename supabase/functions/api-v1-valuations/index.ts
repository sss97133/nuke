/**
 * API v1 - Valuations Endpoint
 *
 * Returns Nuke Estimates (vehicle valuations) with confidence scoring.
 * Supports lookup by vehicle_id or VIN.
 *
 * Authentication: Bearer token (Supabase JWT) or API key
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
      return jsonResponse({ error: "Either vehicle_id or vin parameter is required" }, 400);
    }

    // Resolve vehicle ID from VIN if needed
    let resolvedVehicleId = vehicleId;
    if (!resolvedVehicleId && vin) {
      const { data: vehicle } = await supabase
        .from("vehicles")
        .select("id")
        .eq("vin", vin.toUpperCase())
        .maybeSingle();

      if (!vehicle) {
        return jsonResponse({ error: "Vehicle not found for VIN: " + vin }, 404);
      }
      resolvedVehicleId = vehicle.id;
    }

    // Check if nuke_estimates table exists and has data
    const { data: estimate, error: estError } = await supabase
      .from("nuke_estimates")
      .select("*")
      .eq("vehicle_id", resolvedVehicleId)
      .order("calculated_at", { ascending: false })
      .maybeSingle();

    if (estError) {
      // Table might not exist yet — fall back to vehicle pricing fields
      const { data: vehicle } = await supabase
        .from("vehicles")
        .select("id, year, make, model, sale_price, asking_price, current_value, nuke_estimate, nuke_estimate_confidence, deal_score, deal_score_label, heat_score")
        .eq("id", resolvedVehicleId)
        .maybeSingle();

      if (!vehicle) {
        return jsonResponse({ error: "Vehicle not found" }, 404);
      }

      return jsonResponse({
        data: {
          vehicle_id: vehicle.id,
          estimated_value: vehicle.nuke_estimate || vehicle.current_value || vehicle.sale_price,
          confidence_score: vehicle.nuke_estimate_confidence || null,
          deal_score: vehicle.deal_score || null,
          deal_score_label: vehicle.deal_score_label || null,
          heat_score: vehicle.heat_score || null,
          source: "vehicle_fields",
          vehicle_summary: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        },
      });
    }

    if (!estimate) {
      // No estimate exists — return what we have from the vehicle record
      const { data: vehicle } = await supabase
        .from("vehicles")
        .select("id, year, make, model, sale_price, asking_price, current_value, nuke_estimate, nuke_estimate_confidence, deal_score, deal_score_label, heat_score")
        .eq("id", resolvedVehicleId)
        .maybeSingle();

      if (!vehicle) {
        return jsonResponse({ error: "Vehicle not found" }, 404);
      }

      return jsonResponse({
        data: {
          vehicle_id: vehicle.id,
          estimated_value: vehicle.nuke_estimate || vehicle.current_value || vehicle.sale_price,
          confidence_score: vehicle.nuke_estimate_confidence || null,
          deal_score: vehicle.deal_score || null,
          deal_score_label: vehicle.deal_score_label || null,
          heat_score: vehicle.heat_score || null,
          source: "vehicle_fields",
          vehicle_summary: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        },
      });
    }

    return jsonResponse({
      data: {
        vehicle_id: estimate.vehicle_id,
        estimated_value: estimate.estimated_value,
        value_low: estimate.value_low,
        value_high: estimate.value_high,
        confidence_score: estimate.confidence_score,
        price_tier: estimate.price_tier,
        deal_score: estimate.deal_score,
        deal_score_label: estimate.deal_score_label,
        heat_score: estimate.heat_score,
        heat_score_label: estimate.heat_score_label,
        signal_weights: estimate.signal_weights,
        model_version: estimate.model_version,
        calculated_at: estimate.calculated_at,
        is_stale: estimate.is_stale,
        source: "nuke_estimates",
      },
    });
  } catch (err) {
    console.error("Valuations API error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});

// --- Auth helper (same pattern as api-v1-vehicles) ---

async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function authenticateRequest(req: Request, supabase: any): Promise<{ userId: string | null; isServiceRole?: boolean; error?: string }> {
  const authHeader = req.headers.get("Authorization");
  const apiKey = req.headers.get("X-API-Key");

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const altServiceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
    if ((serviceRoleKey && token === serviceRoleKey) || (altServiceRoleKey && token === altServiceRoleKey)) {
      return { userId: "service-role", isServiceRole: true };
    }
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (user && !error) return { userId: user.id };
  }

  if (apiKey) {
    const rawKey = apiKey.startsWith("nk_live_") ? apiKey.slice(8) : apiKey;
    const keyHash = await hashApiKey(rawKey);
    const { data: keyData, error } = await supabase
      .from("api_keys")
      .select("user_id, scopes, is_active, rate_limit_remaining, expires_at")
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
      await supabase.from("api_keys").update({
        rate_limit_remaining: keyData.rate_limit_remaining !== null ? keyData.rate_limit_remaining - 1 : null,
        last_used_at: new Date().toISOString(),
      }).eq("key_hash", keyHash);
      return { userId: keyData.user_id };
    }
  }

  return { userId: null, error: "Invalid or missing authentication" };
}
