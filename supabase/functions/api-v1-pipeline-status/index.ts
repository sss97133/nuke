/**
 * API v1 - Pipeline Status Endpoint
 *
 * Returns submission feedback for the authenticated user:
 * what they've submitted and what happened to it.
 *
 * GET only. Scoped to the requesting user's API key.
 *
 * Authentication: Bearer token (Supabase JWT) or API key
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { authenticateRequest } from "../_shared/apiKeyAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Authenticate
    const auth = await authenticateRequest(req, supabase, { endpoint: 'pipeline-status' });
    if (auth.error || !auth.userId) {
      return new Response(
        JSON.stringify({ error: auth.error || "Authentication required" }),
        { status: auth.status || 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userId = auth.userId;

    // Run all queries in parallel
    const [
      vehicleStats,
      orgResults,
      recentApiLogs,
      obsByKind,
    ] = await Promise.all([
      // Vehicles created by this user
      supabase
        .from("vehicles")
        .select("id", { count: "exact" })
        .eq("owner_id", userId)
        .limit(0),

      // Organizations discovered by this user (with status for breakdown)
      supabase
        .from("organizations")
        .select("status")
        .eq("discovered_by", userId)
        .limit(500),

      // Recent API usage logs for this user
      supabase
        .from("api_usage_logs")
        .select("resource, action, resource_id, timestamp")
        .eq("user_id", userId)
        .order("timestamp", { ascending: false })
        .limit(20),

      // Observations where extraction_metadata contains this user
      supabase
        .from("vehicle_observations")
        .select("kind")
        .contains("extraction_metadata", { ingested_by: userId })
        .limit(500),
    ]);

    // Build observation stats
    let obsData: { total: number; by_kind: Record<string, number> } = { total: 0, by_kind: {} };
    if (obsByKind.data) {
      const kindCounts: Record<string, number> = {};
      for (const row of obsByKind.data) {
        kindCounts[row.kind] = (kindCounts[row.kind] || 0) + 1;
      }
      obsData = { total: obsByKind.data.length, by_kind: kindCounts };
    }

    // Org stats by status
    const orgsByStatus: Record<string, number> = {};
    const orgRows = orgResults.data || [];
    for (const row of orgRows) {
      orgsByStatus[row.status || 'unknown'] = (orgsByStatus[row.status || 'unknown'] || 0) + 1;
    }

    const response = {
      user_id: userId,
      summary: {
        vehicles_created: vehicleStats.count || 0,
        organizations_discovered: orgRows.length,
        observations_submitted: obsData?.total || 0,
      },
      observations: obsData ? {
        total: obsData.total || 0,
        by_kind: obsData.by_kind || {},
      } : null,
      organizations: {
        total: orgRows.length,
        by_status: orgsByStatus,
      },
      recent_activity: recentApiLogs.data || [],
    };

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Pipeline status API error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
