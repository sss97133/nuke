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
      commentsRes,
      distinctVehiclesRes,
      batListingsRes,
      batExtractedRes,
      commentDiscRes,
      descDiscRes,
      imagesRes,
    ] = await Promise.all([
      supabase.from("vehicles").select("id", { count: "exact", head: true }),
      supabase.from("auction_comments").select("id", { count: "exact", head: true }),
      supabase.from("auction_comments").select("vehicle_id").not("vehicle_id", "is", null).limit(100000),
      supabase.from("bat_listings").select("id", { count: "exact", head: true }).gt("comment_count", 0),
      supabase.from("bat_listings").select("id,raw_data").gt("comment_count", 10).not("vehicle_id", "is", null).order("comment_count", { ascending: false }).limit(500),
      supabase.from("comment_discoveries").select("id", { count: "exact", head: true }),
      supabase.from("description_discoveries").select("id", { count: "exact", head: true }),
      supabase.from("vehicle_images").select("id", { count: "exact", head: true }),
    ]);

    // Calculate distinct vehicles with comments
    const vehicleIds = new Set(
      (distinctVehiclesRes.data || []).map((r: any) => r.vehicle_id)
    );

    // Calculate extracted bat_listings
    const extracted = (batExtractedRes.data || []).filter(
      (r: any) => r.raw_data?.comments_extracted_at
    ).length;
    const pending = (batExtractedRes.data || []).filter(
      (r: any) => !r.raw_data?.comments_extracted_at
    ).length;

    const stats = {
      // Core counts
      total_vehicles: vehiclesRes.count || 0,
      total_comments: commentsRes.count || 0,
      vehicles_with_comments: vehicleIds.size,
      total_images: imagesRes.count || 0,

      // BaT extraction progress (top 500 by comment_count, which is backfill order)
      bat_listings_with_comments: batListingsRes.count || 0,
      bat_top500_extracted: extracted,
      bat_top500_pending: pending,
      bat_top500_progress_pct: Math.round(100 * extracted / Math.max(extracted + pending, 1)),

      // Discovery progress
      comment_discoveries: commentDiscRes.count || 0,
      description_discoveries: descDiscRes.count || 0,

      // Helpful context
      _note: "Use these numbers to understand data distribution before querying individual tables",
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
