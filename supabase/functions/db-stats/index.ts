/**
 * DB STATS - Quick database state overview
 *
 * Returns summary stats to understand data distribution before querying.
 * Use this FIRST when exploring the database.
 *
 * GET /functions/v1/db-stats
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Run all counts in parallel
    const [
      vehiclesRes,
      imagesRes,
      // Observations (current system)
      obsCommentsRes,
      obsBidsRes,
      obsVehiclesRes,
      // Legacy auction_comments (for reference)
      legacyCommentsRes,
      // BaT listings
      batListingsRes,
      batWithCommentsRes,
      // Discoveries (AI analysis)
      commentDiscRes,
      descDiscRes,
      // Organizations
      orgsRes,
    ] = await Promise.all([
      supabase.from("vehicles").select("id", { count: "exact", head: true }),
      supabase.from("vehicle_images").select("id", { count: "exact", head: true }),
      // Observations - the actual data source
      supabase.from("vehicle_observations").select("id", { count: "exact", head: true }).eq("kind", "comment"),
      supabase.from("vehicle_observations").select("id", { count: "exact", head: true }).eq("kind", "bid"),
      supabase.from("vehicle_observations").select("vehicle_id").eq("kind", "comment").limit(50000),
      // Legacy table
      supabase.from("auction_comments").select("id", { count: "exact", head: true }),
      // BaT
      supabase.from("bat_listings").select("id", { count: "exact", head: true }),
      supabase.from("bat_listings").select("id", { count: "exact", head: true }).gt("comment_count", 0),
      // AI discoveries
      supabase.from("comment_discoveries").select("id", { count: "exact", head: true }),
      supabase.from("description_discoveries").select("id", { count: "exact", head: true }),
      // Orgs
      supabase.from("organizations").select("id", { count: "exact", head: true }),
    ]);

    // Calculate distinct vehicles with comment observations
    const vehicleIds = new Set(
      (obsVehiclesRes.data || []).map((r: any) => r.vehicle_id)
    );

    const stats = {
      // Core counts
      total_vehicles: vehiclesRes.count || 0,
      total_images: imagesRes.count || 0,
      total_organizations: orgsRes.count || 0,

      // Observations (current system - this is the source of truth)
      observations: {
        comments: obsCommentsRes.count || 0,
        bids: obsBidsRes.count || 0,
        total: (obsCommentsRes.count || 0) + (obsBidsRes.count || 0),
        vehicles_with_comments: vehicleIds.size,
      },

      // BaT listings (metadata, not extracted content)
      bat_listings: {
        total: batListingsRes.count || 0,
        with_comments: batWithCommentsRes.count || 0,
      },

      // AI Analysis progress
      ai_analysis: {
        comment_discoveries: commentDiscRes.count || 0,
        description_discoveries: descDiscRes.count || 0,
        vehicles_analyzed: (commentDiscRes.count || 0) + (descDiscRes.count || 0),
      },

      // Legacy table (for reference only - data migrated to observations)
      _legacy: {
        auction_comments: legacyCommentsRes.count || 0,
        note: "Legacy table - use observations.comments instead",
      },
    };

    return new Response(JSON.stringify(stats, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
