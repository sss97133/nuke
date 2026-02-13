/**
 * API v1 - Vehicle History Endpoint
 *
 * Paginated observation timeline for a vehicle by VIN.
 * GET /v1/vehicles/{vin}/history
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
