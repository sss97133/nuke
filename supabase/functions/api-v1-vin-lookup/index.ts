/**
 * API v1 - VIN Lookup Endpoint
 *
 * One-call vehicle profile by VIN: core fields + valuation + counts + images.
 * GET /v1/vin/{vin}
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { authenticateRequest, logApiUsage } from "../_shared/apiKeyAuth.ts";
import { decodeOneVin } from "../_shared/nhtsa-vin.ts";
import { decodeVin as decodeVinLocally } from "../_shared/vin-decoder.ts";

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

    // Resolve VIN → id through find_vehicle_by_vin (SQL, STABLE), which
    // filters on upper(btrim(vin)) and so uses idx_vehicles_vin_norm_trim.
    // A plain vin = $1 has no usable index (every vin index is partial or an
    // expression), so both ilike and eq sequential-scanned ~1.1M rows and a
    // miss hit the 10 s statement_timeout. Measured 2026-10-06, EXPLAIN:
    // eq → statement timeout; upper(vin) = $1 → Index Scan, 0.5 ms.
    const { data: vehicleId, error: resolveError } = await supabase
      .rpc("find_vehicle_by_vin", { p_vin: vin });

    if (resolveError || !vehicleId) {
      // Nuke holds no record for this VIN. Answer with a cited factory decode
      // instead of a bare 404: NHTSA vPIC for 17-character VINs, the local
      // WMI/year-code decoder for pre-1981 VINs or when NHTSA is unreachable.
      // held:false tells the caller these are reference facts, not testimony.
      const cleanVin = vin.trim().toUpperCase();
      if (cleanVin.length === 17) {
        try {
          const nhtsa = await decodeOneVin(cleanVin);
          if (nhtsa) {
            return jsonResponse({
              data: null,
              held: false,
              vin: cleanVin,
              decode: nhtsa.fields,
              source: { ...nhtsa.source, error_code: nhtsa.error_code, error_text: nhtsa.error_text, trust: "T1 reference (manufacturer filing)" },
            });
          }
        } catch (e) {
          console.warn("[vin-lookup] NHTSA decode failed:", e instanceof Error ? e.message : String(e));
        }
      }
      const local = decodeVinLocally(cleanVin);
      if (local.year || local.make || local.manufacturer) {
        const { is_pre_1981, ...fields } = local;
        return jsonResponse({
          data: null,
          held: false,
          vin: cleanVin,
          decode: Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== "")),
          source: { name: "Nuke vin-decoder", method: is_pre_1981 ? "pre-1981 WMI/year-code tables" : "WMI/year-code tables", trust: "T3 heuristic" },
        });
      }
      return jsonResponse({ error: "Vehicle not found for VIN", vin }, 404);
    }

    const { data: vehicle, error: vehicleError } = await supabase
      .from("vehicles")
      .select(`
        id, year, make, model, trim, series, vin, mileage,
        color, interior_color, transmission, engine_type, engine_displacement,
        drivetrain, body_style, sale_price, purchase_price, description,
        is_public, created_at, updated_at, primary_image_url
      `)
      .eq("id", vehicleId)
      .maybeSingle();

    if (vehicleError || !vehicle) {
      return jsonResponse({ error: "Vehicle not found for VIN", vin }, 404);
    }

    // Run parallel queries for FULL intelligence
    const [
      valuationResult,
      listingCountResult,
      observationsResult,
      imagesResult,
      commentDiscoveriesResult,
      descriptionDiscoveriesResult,
      imageCountResult,
    ] = await Promise.all([
      // Valuation (nuke_estimates) — full row including signal_weights
      supabase
        .from("nuke_estimates")
        .select("*")
        .eq("vehicle_id", vehicle.id)
        .maybeSingle(),

      // Listing count (vehicle_events)
      supabase
        .from("vehicle_events")
        .select("id", { count: "exact", head: true })
        .eq("vehicle_id", vehicle.id),

      // All observations — the full intelligence layer
      supabase
        .from("vehicle_observations")
        .select("kind, structured_data, confidence, confidence_score, observed_at, source_url")
        .eq("vehicle_id", vehicle.id)
        .eq("is_superseded", false)
        .order("observed_at", { ascending: false }),

      // First 5 images
      supabase
        .from("vehicle_images")
        .select("id, image_url, image_type, category, is_primary")
        .eq("vehicle_id", vehicle.id)
        .order("is_primary", { ascending: false })
        .order("position", { ascending: true })
        .limit(5),

      // Comment discoveries — community intelligence
      supabase
        .from("comment_discoveries")
        .select("overall_sentiment, sentiment_score, comment_count, total_fields, raw_extraction, data_quality_score")
        .eq("vehicle_id", vehicle.id)
        .order("discovered_at", { ascending: false })
        .limit(1)
        .maybeSingle(),

      // Description discoveries — extracted specs
      supabase
        .from("description_discoveries")
        .select("raw_extraction, keys_found, total_fields")
        .eq("vehicle_id", vehicle.id)
        .order("discovered_at", { ascending: false })
        .limit(1)
        .maybeSingle(),

      // Total image count
      supabase
        .from("vehicle_images")
        .select("id", { count: "exact", head: true })
        .eq("vehicle_id", vehicle.id),
    ]);

    // Build observations index by kind
    const observations: Record<string, any> = {};
    for (const obs of (observationsResult.data || [])) {
      if (!observations[obs.kind]) {
        observations[obs.kind] = obs;
      }
    }

    const response = {
      data: {
        ...vehicle,
        valuation: valuationResult.data || null,
        counts: {
          listings: listingCountResult.count || 0,
          observations: (observationsResult.data || []).length,
          images: imageCountResult.count || 0,
          comments: commentDiscoveriesResult.data?.comment_count || 0,
        },
        images: imagesResult.data || [],
        // The full intelligence layer
        intelligence: {
          observations,
          community: commentDiscoveriesResult.data ? {
            sentiment: commentDiscoveriesResult.data.overall_sentiment,
            sentiment_score: commentDiscoveriesResult.data.sentiment_score,
            comment_count: commentDiscoveriesResult.data.comment_count,
            data_quality: commentDiscoveriesResult.data.data_quality_score,
            insights: commentDiscoveriesResult.data.raw_extraction,
          } : null,
          description: descriptionDiscoveriesResult.data?.raw_extraction || null,
        },
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
