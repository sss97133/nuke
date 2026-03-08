/**
 * API v1 - VIN Lookup Endpoint
 *
 * One-call vehicle profile by VIN: core fields + valuation + counts + images.
 * GET /v1/vin/{vin}
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { authenticateRequest, logApiUsage } from "../_shared/apiKeyAuth.ts";

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
    const auth = await authenticateRequest(req, supabase, { endpoint: 'vin-lookup' });
    if (auth.error || !auth.userId) {
      return jsonResponse({ error: auth.error || "Authentication required" }, auth.status || 401);
    }
    const userId = auth.userId;

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

// authenticateRequest and logApiUsage imported from _shared/apiKeyAuth.ts
