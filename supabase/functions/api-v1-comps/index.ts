/**
 * API v1 - Comparables Endpoint
 *
 * Returns comparable vehicle sales for valuation context.
 * Query by year/make/model or VIN to find similar sold vehicles.
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
    const vin = url.searchParams.get("vin");
    const make = url.searchParams.get("make");
    const model = url.searchParams.get("model");
    const yearParam = url.searchParams.get("year");
    const yearRange = parseInt(url.searchParams.get("year_range") || "3", 10);
    const minPrice = url.searchParams.get("min_price");
    const maxPrice = url.searchParams.get("max_price");
    const rawLimit = parseInt(url.searchParams.get("limit") || "20", 10);
    const limit = Math.max(1, Math.min(isNaN(rawLimit) ? 20 : rawLimit, 100));

    // If VIN provided, resolve make/model/year from the vehicle
    let resolvedMake = make;
    let resolvedModel = model;
    let resolvedYear = yearParam ? parseInt(yearParam, 10) : null;

    if (vin) {
      const { data: vehicle } = await supabase
        .from("vehicles")
        .select("year, make, model")
        .eq("vin", vin.toUpperCase())
        .maybeSingle();

      if (vehicle) {
        resolvedMake = resolvedMake || vehicle.make;
        resolvedModel = resolvedModel || vehicle.model;
        resolvedYear = resolvedYear || vehicle.year;
      }
    }

    if (!resolvedMake) {
      return jsonResponse({ error: "make parameter is required (or provide vin)" }, 400);
    }

    // Build query for comparable sold vehicles
    let query = supabase
      .from("vehicles")
      .select(
        "id, year, make, model, trim, vin, sale_price, mileage, transmission, color, condition_rating, primary_image_url, location, created_at"
      )
      .ilike("make", resolvedMake)
      .not("sale_price", "is", null)
      .gt("sale_price", 0)
      .order("created_at", { ascending: false });

    if (resolvedModel) {
      query = query.ilike("model", resolvedModel);
    }

    if (resolvedYear) {
      const minYear = resolvedYear - yearRange;
      const maxYear = resolvedYear + yearRange;
      query = query.gte("year", minYear).lte("year", maxYear);
    }

    if (minPrice) {
      query = query.gte("sale_price", parseInt(minPrice, 10));
    }

    if (maxPrice) {
      query = query.lte("sale_price", parseInt(maxPrice, 10));
    }

    query = query.limit(limit);

    const { data, error } = await query;

    if (error) {
      console.error("Comps query error:", JSON.stringify(error));
      return jsonResponse({ error: "Failed to fetch comparables" }, 500);
    }

    const comps = (data || []).map((v: any) => ({
      vehicle_id: v.id,
      year: v.year,
      make: v.make,
      model: v.model,
      trim: v.trim,
      vin: v.vin,
      sale_price: v.sale_price,
      mileage: v.mileage,
      transmission: v.transmission,
      color: v.color,
      condition_rating: v.condition_rating,
      image_url: v.primary_image_url,
      location: v.location,
    }));

    // Compute summary stats
    const prices = comps.map((c: any) => c.sale_price).filter(Boolean);
    const summary = prices.length > 0 ? {
      count: prices.length,
      avg_price: Math.round(prices.reduce((a: number, b: number) => a + b, 0) / prices.length),
      median_price: Math.round(prices.sort((a: number, b: number) => a - b)[Math.floor(prices.length / 2)]),
      min_price: Math.min(...prices),
      max_price: Math.max(...prices),
    } : null;

    return jsonResponse({
      data: comps,
      summary,
      query: {
        make: resolvedMake,
        model: resolvedModel,
        year: resolvedYear,
        year_range: yearRange,
      },
    });
  } catch (err) {
    console.error("Comps API error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});

// --- Auth helper ---

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
