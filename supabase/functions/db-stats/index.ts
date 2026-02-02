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
      obsTotalRes,
      // Legacy auction_comments (for reference)
      legacyCommentsRes,
      // BaT listings
      batListingsRes,
      batWithCommentsRes,
      // BaT identity seeds
      batIdentitiesRes,
      // Discoveries (AI analysis)
      commentDiscRes,
      descDiscRes,
      // Organizations
      orgsRes,
      // Active users
      activeUsersRes,
      // Identity claims
      externalIdentitiesRes,
      claimedIdentitiesRes,
      pendingClaimsRes,
      approvedClaimsRes,
      pendingVerificationsRes,
    ] = await Promise.all([
      supabase.from("vehicles").select("id", { count: "exact", head: true }),
      supabase.from("vehicle_images").select("id", { count: "exact", head: true }),
      // Observations - the actual data source
      supabase.from("vehicle_observations").select("id", { count: "exact", head: true }).eq("kind", "comment"),
      supabase.from("vehicle_observations").select("id", { count: "exact", head: true }).eq("kind", "bid"),
      supabase.from("vehicle_observations").select("vehicle_id").eq("kind", "comment").limit(50000),
      supabase.from("vehicle_observations").select("id", { count: "exact", head: true }),
      // Legacy table
      supabase.from("auction_comments").select("id", { count: "exact", head: true }),
      // BaT
      supabase.from("bat_listings").select("id", { count: "exact", head: true }),
      supabase.from("bat_listings").select("id", { count: "exact", head: true }).gt("comment_count", 0),
      // Identity seeds (BaT users with activity data)
      supabase.from("bat_user_profiles").select("id", { count: "exact", head: true }),
      // AI discoveries
      supabase.from("comment_discoveries").select("id", { count: "exact", head: true }),
      supabase.from("description_discoveries").select("id", { count: "exact", head: true }),
      // Orgs
      supabase.from("businesses").select("id", { count: "exact", head: true }),
      // Active users (profiles with email)
      supabase.from("profiles").select("id", { count: "exact", head: true }).not("email", "is", null),
      // Identity claims system
      supabase.from("external_identities").select("id", { count: "exact", head: true }),
      supabase.from("external_identities").select("id", { count: "exact", head: true }).not("claimed_by_user_id", "is", null),
      supabase.from("external_identity_claims").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("external_identity_claims").select("id", { count: "exact", head: true }).eq("status", "approved"),
      supabase.from("identity_verification_methods").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);

    // Calculate distinct vehicles with comment observations
    const vehicleIds = new Set(
      (obsVehiclesRes.data || []).map((r: any) => r.vehicle_id)
    );

    const stats = {
      // Top-level fields for dashboard consumption
      vehicles: vehiclesRes.count || 0,
      images: imagesRes.count || 0,
      comments: legacyCommentsRes.count || 0,
      observations: obsTotalRes.count || 0,
      bat_identities: batIdentitiesRes.count || 0,
      active_users: activeUsersRes.count || 0,
      generated_at: new Date().toISOString(),

      // Detailed breakdowns
      details: {
        // Core counts
        total_vehicles: vehiclesRes.count || 0,
        total_images: imagesRes.count || 0,
        total_organizations: orgsRes.count || 0,

        // Observations (current system - this is the source of truth)
        observations: {
          comments: obsCommentsRes.count || 0,
          bids: obsBidsRes.count || 0,
          total: obsTotalRes.count || 0,
          vehicles_with_comments: vehicleIds.size,
        },

        // Identity seeds (claimable profiles)
        identity_seeds: {
          bat_users: batIdentitiesRes.count || 0,
          businesses: orgsRes.count || 0,
          total: (batIdentitiesRes.count || 0) + (orgsRes.count || 0),
        },

        // Identity claims system
        identity_claims: {
          total_external_identities: externalIdentitiesRes.count || 0,
          claimed_identities: claimedIdentitiesRes.count || 0,
          unclaimed_identities: (externalIdentitiesRes.count || 0) - (claimedIdentitiesRes.count || 0),
          pending_claims: pendingClaimsRes.count || 0,
          approved_claims: approvedClaimsRes.count || 0,
          pending_verifications: pendingVerificationsRes.count || 0,
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
