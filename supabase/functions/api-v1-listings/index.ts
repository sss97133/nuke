/**
 * API v1 - Listings Endpoint
 *
 * Returns external listings (auction results, marketplace listings) for vehicles.
 * Supports lookup by vehicle_id, VIN, or platform filter.
 *
 * Authentication: Bearer token (Supabase JWT) or API key
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { authenticateRequest } from "../_shared/apiKeyAuth.ts";

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

    const auth = await authenticateRequest(req, supabase, { endpoint: 'listings' });
    if (auth.error || !auth.userId) {
      return jsonResponse({ error: auth.error || "Authentication required" }, auth.status || 401);
    }
    const userId = auth.userId;

    const url = new URL(req.url);
    const vehicleId = url.searchParams.get("vehicle_id");
    const vin = url.searchParams.get("vin");
    const platform = url.searchParams.get("platform");
    const status = url.searchParams.get("status"); // active, sold, expired
    const rawPage = parseInt(url.searchParams.get("page") || "1", 10);
    const rawLimit = parseInt(url.searchParams.get("limit") || "20", 10);
    const page = Math.max(1, isNaN(rawPage) ? 1 : rawPage);
    const limit = Math.max(1, Math.min(isNaN(rawLimit) ? 20 : rawLimit, 100));
    const offset = (page - 1) * limit;

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

    // Build query
    let query = supabase
      .from("vehicle_events")
      .select(
        "id, vehicle_id, source_platform, source_url, source_listing_id, event_status, started_at, ended_at, current_price, reserve_price, buy_now_price, bid_count, view_count, watcher_count, final_price, sold_at, created_at, updated_at",
        { count: "estimated" }
      );

    if (resolvedVehicleId) {
      query = query.eq("vehicle_id", resolvedVehicleId);
    }

    if (platform) {
      query = query.eq("source_platform", platform);
    }

    if (status) {
      query = query.eq("listing_status", status);
    }

    query = query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error("Listings query error:", error);
      return jsonResponse({ error: "Failed to fetch listings" }, 500);
    }

    return jsonResponse({
      data: data || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        has_more: (count || 0) > offset + limit,
      },
    });
  } catch (err) {
    console.error("Listings API error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});

// authenticateRequest imported from _shared/apiKeyAuth.ts
