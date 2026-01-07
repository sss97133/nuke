// BaT Complete Extractor v1 - Orchestrator
// Single trigger that calls proven extractors internally:
// 1. extract-premium-auction (core vehicle data: VIN, specs, images)
// 2. extract-auction-comments (comments and bids)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const startTime = performance.now();

  try {
    const { url, vehicle_id, apply = true } = await req.json();
    
    if (!url) {
      return new Response(JSON.stringify({ success: false, error: "url required" }), { status: 400 });
    }

    console.log(`[bat-extract-complete-v1] Orchestrating extraction for: ${url}`);

    const results = {
      step1_core_data: null as any,
      step2_comments_bids: null as any,
      vehicle_id: vehicle_id || null,
      errors: [] as string[],
    };

    // STEP 1: Extract core vehicle data (VIN, specs, images, metadata)
    console.log(`[bat-extract-complete-v1] Step 1: Extracting core vehicle data...`);
    try {
      // Use direct HTTP fetch with service role key for function-to-function calls
      const coreResponse = await fetch(`${SUPABASE_URL}/functions/v1/extract-premium-auction`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url,
          max_vehicles: 1,
        }),
      });

      if (!coreResponse.ok) {
        const errorText = await coreResponse.text();
        throw new Error(`extract-premium-auction HTTP ${coreResponse.status}: ${errorText}`);
      }

      const coreResult = await coreResponse.json();

      if (!coreResult?.success) {
        throw new Error(`extract-premium-auction returned failure: ${coreResult?.error || "Unknown error"}`);
      }

      results.step1_core_data = coreResult;
      
      // Extract vehicle_id from result if not provided
      if (!results.vehicle_id) {
        results.vehicle_id = coreResult.created_vehicle_ids?.[0] || coreResult.updated_vehicle_ids?.[0] || null;
      }

      console.log(`[bat-extract-complete-v1] Step 1 complete: Vehicle ID ${results.vehicle_id}`);
      console.log(`  VIN: ${coreResult.debug_extraction?.vin || "N/A"}`);
      console.log(`  Images: ${coreResult.debug_extraction?.images_count || 0}`);
    } catch (e: any) {
      const errorMsg = `Step 1 (core data) failed: ${e.message}`;
      console.error(`[bat-extract-complete-v1] ${errorMsg}`);
      results.errors.push(errorMsg);
      
      // Core data extraction is critical - fail if it fails
      return new Response(JSON.stringify({
        success: false,
        error: errorMsg,
        step: "core_data_extraction",
        results,
      }), { status: 500 });
    }

    // STEP 2: Extract comments and bids (requires vehicle_id from Step 1)
    if (results.vehicle_id) {
      console.log(`[bat-extract-complete-v1] Step 2: Extracting comments and bids...`);
      try {
        // Use direct HTTP fetch with service role key for function-to-function calls
        const commentResponse = await fetch(`${SUPABASE_URL}/functions/v1/extract-auction-comments`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${SERVICE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            auction_url: url,
            vehicle_id: results.vehicle_id,
          }),
        });

        if (!commentResponse.ok) {
          const errorText = await commentResponse.text();
          // Comments extraction failure is non-critical - log but don't fail
          const errorMsg = `extract-auction-comments HTTP ${commentResponse.status}: ${errorText}`;
          console.warn(`[bat-extract-complete-v1] ${errorMsg}`);
          results.errors.push(errorMsg);
        } else {
          const commentResult = await commentResponse.json();
          results.step2_comments_bids = commentResult;
          console.log(`[bat-extract-complete-v1] Step 2 complete:`);
          console.log(`  Comments: ${commentResult?.comments_extracted || 0}`);
          console.log(`  Bids: ${commentResult?.bids_extracted || 0}`);
        }
      } catch (e: any) {
        // Comments extraction failure is non-critical - log but don't fail
        const errorMsg = `Step 2 (comments/bids) failed: ${e.message}`;
        console.warn(`[bat-extract-complete-v1] ${errorMsg}`);
        results.errors.push(errorMsg);
      }
    } else {
      console.warn(`[bat-extract-complete-v1] Skipping Step 2: No vehicle_id available`);
      results.errors.push("Step 2 skipped: vehicle_id not available");
    }

    // Record extraction attempt
    if (results.vehicle_id) {
      try {
        await supabase.rpc("record_extraction_attempt", {
          p_vehicle_id: results.vehicle_id,
          p_source_url: url,
          p_source_type: "bat",
          p_extractor_name: "bat-extract-complete",
          p_extractor_version: "v1",
          p_status: results.errors.length === 0 ? "success" : "partial",
          p_metrics: {
            timing: { total_ms: performance.now() - startTime },
            step1_success: !!results.step1_core_data,
            step2_success: !!results.step2_comments_bids,
            errors: results.errors.length,
          },
          p_extracted_data: {
            core_data: results.step1_core_data?.debug_extraction,
            comments_extracted: results.step2_comments_bids?.comments_extracted || 0,
            bids_extracted: results.step2_comments_bids?.bids_extracted || 0,
          },
        });
      } catch (e: any) {
        console.warn(`[bat-extract-complete-v1] Failed to record extraction attempt: ${e.message}`);
      }
    }

    // Return unified result
    return new Response(JSON.stringify({
      success: true,
      status: results.errors.length === 0 ? "complete" : "partial",
      vehicle_id: results.vehicle_id,
      url,
      results: {
        core_data: {
          vin: results.step1_core_data?.debug_extraction?.vin,
          mileage: results.step1_core_data?.debug_extraction?.mileage,
          color: results.step1_core_data?.debug_extraction?.color,
          transmission: results.step1_core_data?.debug_extraction?.transmission,
          images_count: results.step1_core_data?.debug_extraction?.images_count,
        },
        comments_bids: {
          comments_extracted: results.step2_comments_bids?.comments_extracted || 0,
          bids_extracted: results.step2_comments_bids?.bids_extracted || 0,
        },
      },
      errors: results.errors,
      timing_ms: Math.round(performance.now() - startTime),
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (e: any) {
    console.error("[bat-extract-complete-v1] Error:", e);
    return new Response(JSON.stringify({
      success: false,
      error: e.message,
      stack: e.stack,
    }), { status: 500 });
  }
});
