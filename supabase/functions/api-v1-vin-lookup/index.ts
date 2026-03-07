/**
 * API v1 - VIN Lookup Endpoint
 *
 * One-call vehicle profile by VIN: core fields + valuation + counts + images.
 * GET /v1/vin/{vin}
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function jsonResponse(data: any, status = 200) {
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

    // Authenticate
    const { userId, error: authError } = await authenticateRequest(req, supabase);
    if (authError || !userId) {
      return jsonResponse({ error: authError || "Authentication required" }, 401);
    }

    // Extract VIN from URL path
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const vin = pathParts[pathParts.length - 1];

    if (!vin || vin === 'api-v1-vin-lookup' || vin.length < 5) {
      return jsonResponse({ error: "VIN is required. Use GET /api-v1-vin-lookup/{vin}" }, 400);
    }

    // Look up vehicle by VIN
    const { data: vehicle, error: vehicleError } = await supabase
      .from("vehicles")
      .select(`
        id, year, make, model, trim, series, vin, mileage,
        color, interior_color, transmission, engine_type, engine_displacement,
        drivetrain, body_style, sale_price, purchase_price, description,
        is_public, created_at, updated_at, primary_image_url
      `)
      .ilike("vin", vin)
      .limit(1)
      .maybeSingle();

    if (vehicleError || !vehicle) {
      return jsonResponse({ error: "Vehicle not found for VIN", vin }, 404);
    }

    // Run parallel queries for enrichment
    const [valuationResult, listingCountResult, observationCountResult, imagesResult] = await Promise.all([
      // Valuation (nuke_estimates)
      supabase
        .from("nuke_estimates")
        .select("estimated_value, value_low, value_high, confidence_score, deal_score, deal_score_label, heat_score, heat_score_label, price_tier, model_version, calculated_at, is_stale")
        .eq("vehicle_id", vehicle.id)
        .maybeSingle(),

      // Listing count (vehicle_events)
      supabase
        .from("vehicle_events")
        .select("id", { count: "exact", head: true })
        .eq("vehicle_id", vehicle.id),

      // Observation count (vehicle_observations)
      supabase
        .from("vehicle_observations")
        .select("id", { count: "exact", head: true })
        .eq("vehicle_id", vehicle.id),

      // First 5 images
      supabase
        .from("vehicle_images")
        .select("id, image_url, image_type, category, is_primary")
        .eq("vehicle_id", vehicle.id)
        .order("is_primary", { ascending: false })
        .order("position", { ascending: true })
        .limit(5),
    ]);

    const response = {
      data: {
        ...vehicle,
        valuation: valuationResult.data || null,
        counts: {
          listings: listingCountResult.count || 0,
          observations: observationCountResult.count || 0,
          images: (imagesResult.data || []).length,
        },
        images: imagesResult.data || [],
      },
    };

    // Log API usage
    await logApiUsage(supabase, userId, "vin-lookup", "get", vehicle.id);

    return jsonResponse(response);

  } catch (error: any) {
    console.error("API error:", error);
    return jsonResponse(
      { error: "Internal server error", details: error instanceof Error ? error.message : String(error) },
      500
    );
  }
});

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
    if (user && !error) {
      return { userId: user.id };
    }
  }

  if (apiKey) {
    const rawKey = apiKey.startsWith('nk_live_') ? apiKey.slice(8) : apiKey;
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
      await supabase
        .from("api_keys")
        .update({
          rate_limit_remaining: keyData.rate_limit_remaining !== null ? keyData.rate_limit_remaining - 1 : null,
          last_used_at: new Date().toISOString(),
        })
        .eq("key_hash", keyHash);
      return { userId: keyData.user_id };
    }
  }

  return { userId: null, error: "Invalid or missing authentication" };
}

async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return 'sha256_' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function logApiUsage(supabase: any, userId: string, resource: string, action: string, resourceId?: string) {
  try {
    await supabase.from("api_usage_logs").insert({
      user_id: userId,
      resource,
      action,
      resource_id: resourceId,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Failed to log API usage:", e);
  }
}
