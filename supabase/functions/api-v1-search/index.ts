/**
 * API v1 - Search
 *
 * Full-text search across 921K+ vehicles with enrichment indicators.
 * GET /v1/search?q=porsche+911&limit=50&page=1&make=Porsche&year_from=1990&year_to=2000
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

  const t0 = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { userId, error: authError } = await authenticateRequest(req, supabase);
    if (authError || !userId) {
      return jsonResponse({ error: authError || "Authentication required" }, 401);
    }

    const url = new URL(req.url);
    const q = url.searchParams.get("q") || "";
    const make = url.searchParams.get("make");
    const model = url.searchParams.get("model");
    const yearFrom = parseInt(url.searchParams.get("year_from") || "", 10);
    const yearTo = parseInt(url.searchParams.get("year_to") || "", 10);
    const hasVin = url.searchParams.get("has_vin");
    const sort = url.searchParams.get("sort") || "relevance"; // relevance, price_desc, price_asc, year_desc, year_asc
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const limit = Math.max(1, Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200));
    const offset = (page - 1) * limit;

    if (!q && !make && !model) {
      return jsonResponse({ error: "Provide 'q' (search query), 'make', or 'model'" }, 400);
    }

    // Build query — filter stubs (no year/make/model) from inventory
    let query = supabase
      .from("vehicles")
      .select("id, vin, year, make, model, trim, color, interior_color, sale_price, mileage, transmission, engine_size, body_style, auction_source, created_at", { count: "estimated" })
      .eq("is_public", true)
      .not("year", "is", null)
      .not("make", "is", null)
      .not("model", "is", null);

    // Full-text search
    if (q) {
      // Try tsquery first
      const tokens = q.trim().split(/\s+/).filter(Boolean);
      if (tokens.length > 0) {
        const tsq = tokens.map(t => t.replace(/[^a-zA-Z0-9]/g, '')).filter(Boolean).join(' & ');
        if (tsq) {
          query = query.textSearch("search_vector", tsq, { type: "plain", config: "english" });
        }
      }
    }

    // Filters
    if (make) query = query.ilike("make", make);
    if (model) query = query.ilike("model", `%${model}%`);
    if (!isNaN(yearFrom)) query = query.gte("year", yearFrom);
    if (!isNaN(yearTo)) query = query.lte("year", yearTo);
    if (hasVin === "true") query = query.not("vin", "is", null).neq("vin", "");

    // Sort
    switch (sort) {
      case "price_desc": query = query.order("sale_price", { ascending: false, nullsFirst: false }); break;
      case "price_asc": query = query.order("sale_price", { ascending: true, nullsFirst: false }); break;
      case "year_desc": query = query.order("year", { ascending: false, nullsFirst: false }); break;
      case "year_asc": query = query.order("year", { ascending: true, nullsFirst: false }); break;
      default: query = query.order("sale_price", { ascending: false, nullsFirst: false }); break;
    }

    query = query.range(offset, offset + limit - 1);

    const { data: vehicles, error: dbError, count } = await query;

    if (dbError) {
      const details = typeof dbError === "object" ? JSON.stringify(dbError) : String(dbError);
      throw new Error(`Database error: ${details}`);
    }

    // Enrich with valuations in batch
    const vehicleIds = (vehicles || []).map((v: any) => v.id);
    let valuations: Record<string, any> = {};

    if (vehicleIds.length > 0) {
      const { data: valData } = await supabase
        .from("nuke_estimates")
        .select("vehicle_id, estimated_value, confidence_score")
        .in("vehicle_id", vehicleIds);

      if (valData) {
        for (const v of valData) {
          valuations[v.vehicle_id] = { estimated_value: v.estimated_value, confidence_score: v.confidence_score };
        }
      }
    }

    const results = (vehicles || []).map((v: any) => ({
      id: v.id,
      vin: v.vin || null,
      year: v.year,
      make: v.make,
      model: v.model,
      trim: v.trim || null,
      title: [v.year, v.make, v.model, v.trim].filter(Boolean).join(" "),
      sale_price: v.sale_price || null,
      mileage: v.mileage || null,
      color: v.color || null,
      interior_color: v.interior_color || null,
      transmission: v.transmission || null,
      engine_size: v.engine_size || null,
      body_style: v.body_style || null,
      auction_source: v.auction_source || null,
      valuation: valuations[v.id] || null,
      data_density: {
        has_vin: !!(v.vin && v.vin.length > 0),
        has_valuation: !!valuations[v.id],
        has_price: !!v.sale_price,
      },
    }));

    const totalCount = count || 0;
    const totalPages = Math.ceil(totalCount / limit);

    await logApiUsage(supabase, userId, "search", "query");

    return jsonResponse({
      data: results,
      query: { q: q || null, make, model, year_from: isNaN(yearFrom) ? null : yearFrom, year_to: isNaN(yearTo) ? null : yearTo, sort },
      pagination: { page, limit, total_count: totalCount, total_pages: totalPages },
      search_time_ms: Date.now() - t0,
    });

  } catch (error: any) {
    console.error("API error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
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
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return "sha256_" + hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
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
