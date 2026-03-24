/**
 * API v1 - Comparables Endpoint
 *
 * Returns comparable vehicle sales for valuation context.
 * Query by year/make/model, vehicle_id, or VIN to find similar sold vehicles.
 *
 * Data sources (merged in single DB call via get_comps_combined):
 *   1. auction_events (platform, date, winning_bid, image, listing URL)
 *   2. vehicles.sale_price (fallback for non-auction records)
 *
 * Authentication: Bearer token (Supabase JWT) or API key
 *
 * Perf: Single RPC call via get_comps_combined() — case-insensitive matching
 * using lower() btree index (idx_vehicles_lower_make_model). Auth runs
 * concurrently and doesn't block the response.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { corsHeaders } from "../_shared/cors.ts";
import { authenticateRequest } from "../_shared/apiKeyAuth.ts";

// Extend shared CORS with x-api-key header needed for this endpoint
const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // --- Auth (fire-and-forget for rate-limiting; don't block data query) ---
    // Comps data is public auction results — no auth required for reads.
    const authPromise = authenticateRequest(req, supabase, {
      endpoint: "comps",
    }).catch(() => {});

    // --- Parse params (GET query string or POST JSON body) ---
    const url = new URL(req.url);
    // deno-lint-ignore no-explicit-any
    let body: Record<string, any> = {};
    if (req.method === "POST") {
      try {
        body = await req.json();
      } catch {
        /* empty body ok */
      }
    }
    const p = (key: string) =>
      url.searchParams.get(key) ?? body[key]?.toString() ?? null;

    const vehicleId = p("vehicle_id");
    const vin = p("vin");
    const makeParam = p("make");
    const modelParam = p("model");
    const yearParam = p("year");
    const yearRange = parseInt(p("year_range") || "2", 10);
    const minPrice = p("min_price");
    const maxPrice = p("max_price");
    const rawLimit = parseInt(url.searchParams.get("limit") || "20", 10);
    const limit = Math.max(1, Math.min(isNaN(rawLimit) ? 20 : rawLimit, 100));

    // --- Resolve canonical make/model/year ---
    let resolvedMake: string | null = null;
    let resolvedModel: string | null = null;
    let resolvedYear: number | null = yearParam ? parseInt(yearParam, 10) : null;
    let excludeVehicleId: string | null = null;

    if (vehicleId) {
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
      return jsonResponse(
        { error: "make parameter is required (or provide vehicle_id or vin)" },
        400,
      );
    }

    const minYear = resolvedYear ? resolvedYear - yearRange : null;
    const maxYear = resolvedYear ? resolvedYear + yearRange : null;

    // --- Single combined RPC: auction_events + vehicles fallback in one DB call ---
    // get_comps_combined() uses lower() with idx_vehicles_lower_make_model index
    // for case-insensitive matching. Returns auction comps first, then vehicle
    // fallbacks (already deduplicated), limited to p_limit rows total.
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

    const rpcRes = await fetch(
      `${supabaseUrl}/rest/v1/rpc/get_comps_combined`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseKey}`,
          apikey: supabaseKey,
        },
        body: JSON.stringify(rpcBody),
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!rpcRes.ok) {
      const errText = await rpcRes.text();
      console.error("get_comps_combined RPC failed:", rpcRes.status, errText.slice(0, 300));
      return jsonResponse({ error: "Failed to fetch comparables" }, 502);
    }

    const rpcData = await rpcRes.json();
    if (!Array.isArray(rpcData)) {
      console.error("get_comps_combined returned non-array:", JSON.stringify(rpcData).slice(0, 200));
      return jsonResponse({ error: "Unexpected response format" }, 500);
    }

    // Ensure auth completes in background (non-blocking)
    authPromise.catch(() => {});

    // --- Map rows to API shape ---
    // deno-lint-ignore no-explicit-any
    const allComps = rpcData.map((row: any) => ({
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
      platform_raw: row.platform ?? null,
      sold_date: row.sold_date ?? null,
      source_type: row.source_type ?? "auction_event",
    }));

    const auctionCount = allComps.filter(
      // deno-lint-ignore no-explicit-any
      (c: any) => c.source_type === "auction_event",
    ).length;

    const prices = allComps
      // deno-lint-ignore no-explicit-any
      .map((c: any) => c.sale_price)
      .filter(Boolean) as number[];
    const sortedPrices = [...prices].sort((a, b) => a - b);
    const summary =
      prices.length > 0
        ? {
            count: prices.length,
            avg_price: Math.round(
              prices.reduce((a, b) => a + b, 0) / prices.length,
            ),
            median_price: sortedPrices[Math.floor(sortedPrices.length / 2)],
            min_price: Math.min(...prices),
            max_price: Math.max(...prices),
            auction_event_count: auctionCount,
          }
        : null;

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
