/**
 * API v1 - Vehicle History Endpoint
 *
 * Paginated observation timeline for a vehicle by VIN.
 * GET /v1/vehicles/{vin}/history
 */

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

Deno.serve(async (req) => {
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
    const auth = await authenticateRequest(req, supabase, { endpoint: 'vehicle-history' });
    if (auth.error || !auth.userId) {
      return jsonResponse({ error: auth.error || "Authentication required" }, auth.status || 401);
    }
    const userId = auth.userId;

    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const vin = pathParts[pathParts.length - 1];

    if (!vin || vin === 'api-v1-vehicle-history' || vin.length < 5) {
      return jsonResponse({ error: "VIN is required. Use GET /api-v1-vehicle-history/{vin}" }, 400);
    }

    // Pagination
    const rawPage = parseInt(url.searchParams.get("page") || "1", 10);
    const rawLimit = parseInt(url.searchParams.get("limit") || "50", 10);
    const page = Math.max(1, isNaN(rawPage) ? 1 : rawPage);
    const limit = Math.max(1, Math.min(isNaN(rawLimit) ? 50 : rawLimit, 100));
    const offset = (page - 1) * limit;
    const kindFilter = url.searchParams.get("kind");

    // Resolve VIN → vehicle_id
    const { data: vehicle, error: vehicleError } = await supabase
      .from("vehicles")
      .select("id, year, make, model, vin")
      .ilike("vin", vin)
      .limit(1)
      .maybeSingle();

    if (vehicleError || !vehicle) {
      return jsonResponse({ error: "Vehicle not found for VIN", vin }, 404);
    }

    // Query observations
    let query = supabase
      .from("vehicle_observations")
      .select(`
        id, vehicle_id, source_id, kind, observed_at,
        structured_data, confidence, content_text,
        source_url, ingested_at
      `, { count: "exact" })
      .eq("vehicle_id", vehicle.id);

    if (kindFilter) {
      query = query.eq("kind", kindFilter);
    }

    const { data: observations, error: obsError, count } = await query
      .order("observed_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (obsError) {
      console.error("Observations query error:", JSON.stringify(obsError));
      return jsonResponse({ error: "Failed to fetch observations", details: obsError.message || JSON.stringify(obsError) }, 500);
    }

    const response = {
      data: {
        vehicle: {
          id: vehicle.id,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          vin: vehicle.vin,
        },
        observations: observations || [],
      },
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil((count || 0) / limit),
      },
    };

    await logApiUsage(supabase, userId, "vehicle-history", "list", vehicle.id);

    return jsonResponse(response);

  } catch (error: any) {
    console.error("API error:", error);
    const details = error instanceof Error ? error.message : (typeof error === 'object' ? JSON.stringify(error) : String(error));
    return jsonResponse({ error: "Internal server error", details }, 500);
  }
});

// authenticateRequest and logApiUsage imported from _shared/apiKeyAuth.ts
