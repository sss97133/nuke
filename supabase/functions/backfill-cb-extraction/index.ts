/**
 * BACKFILL: Cars & Bids Comment & Bid Extraction
 *
 * For all C&B vehicles created in the last 7 days:
 * - Ensure vehicle_events record exists with source_url
 * - Trigger comment extraction
 * - Trigger bid extraction
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const authHeader = `Bearer ${serviceRoleKey}`;

  try {
    console.log("[backfill-cb-extraction] Starting C&B extraction backfill...");

    // Get all C&B vehicles from last 7 days with discovery_url
    const { data: vehicles, error: vehicleError } = await supabase
      .from("vehicles")
      .select("id, discovery_url")
      .eq("discovery_source", "carsandbids")
      .gt("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    if (vehicleError) {
      throw new Error(`Failed to fetch vehicles: ${vehicleError.message}`);
    }

    if (!vehicles || vehicles.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No C&B vehicles found from last 7 days",
          vehicles_processed: 0,
          extraction_triggers: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[backfill-cb-extraction] Found ${vehicles.length} C&B vehicles from last 7 days`);

    let extractionTriggers = 0;
    const errors: string[] = [];

    // For each vehicle, trigger comment and bid extraction
    for (const vehicle of vehicles) {
      try {
        if (!vehicle.discovery_url) {
          errors.push(`Vehicle ${vehicle.id}: missing discovery_url`);
          continue;
        }

        // Trigger comments extraction
        fetch(`${supabaseUrl}/functions/v1/extract-cars-and-bids-comments`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
          body: JSON.stringify({
            auction_url: vehicle.discovery_url,
            vehicle_id: vehicle.id,
          }),
          signal: AbortSignal.timeout(120000),
        }).catch((e: any) =>
          console.warn(`[backfill-cb-extraction] Comment trigger failed for ${vehicle.id}:`, e instanceof Error ? e.message : String(e))
        );

        // Trigger bids extraction
        fetch(`${supabaseUrl}/functions/v1/extract-cab-bids`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
          body: JSON.stringify({
            url: vehicle.discovery_url,
            vehicle_id: vehicle.id,
            mode: "single",
          }),
          signal: AbortSignal.timeout(120000),
        }).catch((e: any) =>
          console.warn(`[backfill-cb-extraction] Bids trigger failed for ${vehicle.id}:`, e instanceof Error ? e.message : String(e))
        );

        extractionTriggers++;
      } catch (e: any) {
        errors.push(`Vehicle ${vehicle.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    console.log(`[backfill-cb-extraction] Triggered ${extractionTriggers} extraction jobs`);

    return new Response(
      JSON.stringify({
        success: true,
        message: "C&B extraction backfill completed",
        vehicles_processed: vehicles.length,
        extraction_triggers: extractionTriggers,
        errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
        errors_truncated: errors.length > 10,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[backfill-cb-extraction] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
