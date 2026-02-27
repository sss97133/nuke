/**
 * API v1 - Comparables Endpoint
 *
 * Returns comparable vehicle sales for valuation context.
 * Query by year/make/model, vehicle_id, or VIN to find similar sold vehicles.
 *
 * Data sources (in priority order):
 *   1. auction_events (platform, date, winning_bid, image, listing URL)
 *   2. vehicles.sale_price (fallback for non-auction records)
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

const PLATFORM_LABELS: Record<string, string> = {
  bat: "Bring a Trailer",
  "bring-a-trailer": "Bring a Trailer",
  "cars-and-bids": "Cars & Bids",
  carsandbids: "Cars & Bids",
  mecum: "Mecum",
  "barrett-jackson": "Barrett-Jackson",
  barrettjackson: "Barrett-Jackson",
  "rm-sothebys": "RM Sotheby's",
  rmsothebys: "RM Sotheby's",
  bonhams: "Bonhams",
  gooding: "Gooding & Company",
  pcarmarket: "PCarMarket",
  "hagerty-marketplace": "Hagerty Marketplace",
  hagerty: "Hagerty Marketplace",
  ebay: "eBay Motors",
  craigslist: "Craigslist",
  facebook: "Facebook Marketplace",
};

function platformLabel(source: string | null): string {
  if (!source) return "";
  const key = source.toLowerCase().replace(/[_\s]/g, "-");
  return PLATFORM_LABELS[key] || PLATFORM_LABELS[source.toLowerCase()] || source;
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

    // --- Auth ---
    const { userId, error: authError } = await authenticateRequest(req, supabase);
    if (authError || !userId) {
      return jsonResponse({ error: authError || "Authentication required" }, 401);
    }

    // --- Parse params ---
    const url = new URL(req.url);
    const vehicleId = url.searchParams.get("vehicle_id");
    const vin = url.searchParams.get("vin");
    const makeParam = url.searchParams.get("make");
    const modelParam = url.searchParams.get("model");
    const yearParam = url.searchParams.get("year");
    const yearRange = parseInt(url.searchParams.get("year_range") || "2", 10);
    const minPrice = url.searchParams.get("min_price");
    const maxPrice = url.searchParams.get("max_price");
    const rawLimit = parseInt(url.searchParams.get("limit") || "20", 10);
    const limit = Math.max(1, Math.min(isNaN(rawLimit) ? 20 : rawLimit, 100));

    // --- Resolve canonical make/model/year ---
    let resolvedMake: string | null = null;
    let resolvedModel: string | null = null;
    let resolvedYear: number | null = yearParam ? parseInt(yearParam, 10) : null;
    let excludeVehicleId: string | null = null;

    if (vehicleId) {
      // vehicle_id → canonical make/model/year (fast pk lookup)
      const { data: v } = await supabase
        .from("vehicles")
        .select("id, year, make, model")
        .eq("id", vehicleId)
        .maybeSingle();
      if (v) {
        resolvedMake = v.make;
        resolvedModel = v.model;
        resolvedYear = resolvedYear ?? v.year;
        excludeVehicleId = v.id;
      }
    } else if (vin) {
      const { data: v } = await supabase
        .from("vehicles")
        .select("id, year, make, model")
        .eq("vin", vin.toUpperCase())
        .maybeSingle();
      if (v) {
        resolvedMake = v.make;
        resolvedModel = v.model;
        resolvedYear = resolvedYear ?? v.year;
        excludeVehicleId = v.id;
      }
    } else if (makeParam) {
      resolvedMake = makeParam;
      resolvedModel = modelParam ?? null;
    }

    if (!resolvedMake) {
      return jsonResponse({ error: "make parameter is required (or provide vehicle_id or vin)" }, 400);
    }

    const minYear = resolvedYear ? resolvedYear - yearRange : null;
    const maxYear = resolvedYear ? resolvedYear + yearRange : null;

    // --- Source 1: auction_events via DB function (single join query, indexed) ---
    // Uses get_auction_comps() which joins vehicles + auction_events using make/model index
    // Called via direct fetch to PostgREST (faster than JS client for SECURITY DEFINER functions)
    let auctionComps: any[] = [];
    try {
      const rpcBody = {
        p_make: resolvedMake,
        p_model: resolvedModel ?? null,
        p_year_min: minYear,
        p_year_max: maxYear,
        p_min_price: minPrice ? parseFloat(minPrice) : null,
        p_max_price: maxPrice ? parseFloat(maxPrice) : null,
        p_exclude_vehicle_id: excludeVehicleId ?? null,
        p_limit: limit,
      };

      const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/get_auction_comps`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseKey}`,
          "apikey": supabaseKey,
        },
        body: JSON.stringify(rpcBody),
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      if (rpcRes.ok) {
        const rpcData = await rpcRes.json();
        if (Array.isArray(rpcData)) {
          auctionComps = rpcData.map((row: any) => ({
            vehicle_id: row.vehicle_id ?? null,
            year: row.yr ?? null,
            make: row.mk ?? null,
            model: row.mdl ?? null,
            trim: row.tr ?? null,
            vin: row.vi ?? null,
            sale_price: row.sale_price,
            mileage: row.miles ?? null,
            color: row.clr ?? null,
            image_url: row.image_url ?? null,
            location: row.loc ?? null,
            listing_url: row.listing_url ?? null,
            platform: platformLabel(row.platform) || null,
            platform_raw: row.platform,
            sold_date: row.sold_date ?? null,
            source_type: "auction_event",
          }));
        } else {
          console.error("get_auction_comps returned non-array:", JSON.stringify(rpcData).slice(0, 200));
        }
      } else {
        const errText = await rpcRes.text();
        console.error("get_auction_comps RPC failed:", rpcRes.status, errText.slice(0, 200));
      }
    } catch (rpcErr) {
      console.error("get_auction_comps fetch error:", rpcErr);
    }

    // --- Source 2: vehicles with sale_price (fallback for non-auction records) ---
    const seenVehicleIds = new Set(auctionComps.map((c: any) => c.vehicle_id).filter(Boolean));

    let vehicleComps: any[] = [];
    try {
      let vehicleQuery = supabase
        .from("vehicles")
        .select("id, year, make, model, trim, vin, sale_price, mileage, color, primary_image_url, location, listing_url, created_at")
        .eq("make", resolvedMake)
        .eq("status", "active")
        .not("sale_price", "is", null)
        .gt("sale_price", 0)
        .order("created_at", { ascending: false })
        .limit(limit * 2);

      if (resolvedModel) vehicleQuery = vehicleQuery.eq("model", resolvedModel);
      if (minYear !== null) vehicleQuery = vehicleQuery.gte("year", minYear);
      if (maxYear !== null) vehicleQuery = vehicleQuery.lte("year", maxYear);
      if (minPrice) vehicleQuery = vehicleQuery.gte("sale_price", parseInt(minPrice, 10));
      if (maxPrice) vehicleQuery = vehicleQuery.lte("sale_price", parseInt(maxPrice, 10));
      if (excludeVehicleId) vehicleQuery = vehicleQuery.neq("id", excludeVehicleId);

      const { data: vehicleData } = await vehicleQuery;
      vehicleComps = (vehicleData || [])
        .filter((v: any) => !seenVehicleIds.has(v.id))
        .map((v: any) => ({
          vehicle_id: v.id,
          year: v.year,
          make: v.make,
          model: v.model,
          trim: v.trim,
          vin: v.vin,
          sale_price: v.sale_price,
          mileage: v.mileage,
          color: v.color,
          image_url: v.primary_image_url,
          location: v.location,
          listing_url: v.listing_url ?? null,
          platform: null,
          platform_raw: null,
          sold_date: null,
          source_type: "vehicle_record",
        }));
    } catch (vErr) {
      console.error("vehicles fallback query error:", vErr);
    }

    // --- Merge & stats ---
    const allComps = [...auctionComps, ...vehicleComps].slice(0, limit);
    const prices = allComps.map((c: any) => c.sale_price).filter(Boolean) as number[];
    const sortedPrices = [...prices].sort((a, b) => a - b);
    const summary = prices.length > 0 ? {
      count: prices.length,
      avg_price: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
      median_price: sortedPrices[Math.floor(sortedPrices.length / 2)],
      min_price: Math.min(...prices),
      max_price: Math.max(...prices),
      auction_event_count: auctionComps.length,
    } : null;

    return jsonResponse({
      data: allComps,
      summary,
      query: {
        make: resolvedMake,
        model: resolvedModel,
        year: resolvedYear,
        year_range: yearRange,
        excluded_vehicle_id: excludeVehicleId,
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
