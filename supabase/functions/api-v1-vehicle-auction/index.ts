/**
 * API v1 - Vehicle Auction Endpoint
 *
 * Auction results + bid counts + comment sentiment for a vehicle by VIN.
 * GET /v1/vehicles/{vin}/auction
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
    const auth = await authenticateRequest(req, supabase, { endpoint: 'vehicle-auction' });
    if (auth.error || !auth.userId) {
      return jsonResponse({ error: auth.error || "Authentication required" }, auth.status || 401);
    }
    const userId = auth.userId;

    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const vin = pathParts[pathParts.length - 1];

    if (!vin || vin === 'api-v1-vehicle-auction' || vin.length < 5) {
      return jsonResponse({ error: "VIN is required. Use GET /api-v1-vehicle-auction/{vin}" }, 400);
    }

    // Resolve VIN → vehicle
    const { data: vehicle, error: vehicleError } = await supabase
      .from("vehicles")
      .select("id, year, make, model, vin, sale_price")
      .ilike("vin", vin)
      .limit(1)
      .maybeSingle();

    if (vehicleError || !vehicle) {
      return jsonResponse({ error: "Vehicle not found for VIN", vin }, 404);
    }

    // Run parallel queries
    const [listingsResult, commentCountResult, recentCommentsResult, sentimentResult] = await Promise.all([
      // Vehicle events (auction/listing records)
      supabase
        .from("vehicle_events")
        .select(`
          id, source_platform, source_url, source_listing_id, event_status,
          started_at, ended_at, current_price, reserve_price, buy_now_price,
          bid_count, view_count, watcher_count, final_price, sold_at,
          created_at, updated_at
        `)
        .eq("vehicle_id", vehicle.id)
        .order("created_at", { ascending: false }),

      // Comment count
      supabase
        .from("auction_comments")
        .select("id", { count: "exact", head: true })
        .eq("vehicle_id", vehicle.id),

      // Latest 10 comments
      supabase
        .from("auction_comments")
        .select(`
          id, comment_text, author_name, posted_at, comment_type,
          platform, source_url
        `)
        .eq("vehicle_id", vehicle.id)
        .order("posted_at", { ascending: false })
        .limit(10),

      // AI sentiment from comment_discoveries
      supabase
        .from("comment_discoveries")
        .select(`
          overall_sentiment, sentiment_score, comment_count,
          total_fields, raw_extraction, discovered_at
        `)
        .eq("vehicle_id", vehicle.id)
        .order("discovered_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const response = {
      data: {
        vehicle: {
          id: vehicle.id,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          vin: vehicle.vin,
          sale_price: vehicle.sale_price,
        },
        listings: listingsResult.data || [],
        comments: {
          total_count: commentCountResult.count || 0,
          recent: recentCommentsResult.data || [],
        },
        sentiment: sentimentResult.data ? {
          overall: sentimentResult.data.overall_sentiment,
          score: sentimentResult.data.sentiment_score,
          comment_count_analyzed: sentimentResult.data.comment_count,
          fields_extracted: sentimentResult.data.total_fields,
          details: sentimentResult.data.raw_extraction,
          analyzed_at: sentimentResult.data.discovered_at,
        } : null,
      },
    };

    await logApiUsage(supabase, userId, "vehicle-auction", "get", vehicle.id);

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
