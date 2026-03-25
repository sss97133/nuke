/**
 * BACKFILL COMMENTS (Self-Continuing)
 * Extract comments for vehicles that have BaT vehicle_events but no comments yet
 *
 * Automatically continues processing until all listings are done.
 * Uses Supabase background invocation to chain batches.
 *
 * POST /functions/v1/backfill-comments
 * Body: {
 *   "batch_size": 10,      // Items per batch (max 50)
 *   "delay_ms": 2000,      // Delay between items
 *   "max_batches": 500,    // Safety limit (0 = unlimited)
 *   "batch_number": 1,     // Current batch (auto-incremented)
 *   "stop": false          // Set true to stop the chain
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(body.batch_size || 10, 50);
    const delayMs = Math.max(body.delay_ms || 2000, 1000);
    const maxBatches = body.max_batches ?? 500; // Safety limit
    const batchNumber = body.batch_number || 1;
    const shouldStop = body.stop === true;

    if (shouldStop) {
      return new Response(JSON.stringify({
        success: true,
        message: "Backfill stopped by request",
        batch_number: batchNumber,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (maxBatches > 0 && batchNumber > maxBatches) {
      return new Response(JSON.stringify({
        success: true,
        message: `Reached max batches limit (${maxBatches})`,
        batch_number: batchNumber,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`=== BATCH ${batchNumber} ===`);

    // Strategy: Use SQL RPC to find unextracted events directly in DB
    // This avoids the old approach of fetching 500 events and filtering client-side,
    // which could only scan 5,000 events total (10 pages × 500) out of 130K+.
    //
    // The RPC returns events WHERE metadata->>'comments_extracted_at' IS NULL,
    // ordered by comment_count DESC, limited to batchSize.
    // If the RPC doesn't exist, fall back to the PostgREST approach with a random offset.

    let vehicleEvents: any[] = [];
    let alreadyDone = 0;
    let eventsToProcess: any[] = [];
    let queryMethod = "rpc";

    try {
      const { data: rpcResult, error: rpcErr } = await supabase.rpc(
        "get_unextracted_comment_events",
        { p_batch_size: batchSize }
      );
      if (rpcErr) throw rpcErr;
      vehicleEvents = rpcResult || [];
      eventsToProcess = vehicleEvents;
      console.log(`[Batch ${batchNumber}] RPC returned ${eventsToProcess.length} unextracted events`);
    } catch (rpcError: any) {
      // RPC doesn't exist yet — fall back to PostgREST with random page
      queryMethod = "postgrest_random";
      console.log(`[Batch ${batchNumber}] RPC unavailable (${rpcError?.message || "unknown"}), using random-page fallback`);

      // Use a random offset to spread coverage across the full 130K+ events
      // instead of cycling through only the first 5,000
      const maxOffset = 130000; // approximate total events
      const randomOffset = Math.floor(Math.random() * maxOffset);
      const pageSize = Math.max(batchSize * 5, 200); // Fetch more than needed to find unextracted ones

      const { data: events } = await supabase
        .from("vehicle_events")
        .select("id, vehicle_id, source_url, metadata, comment_count, final_price")
        .eq("source_platform", "bat")
        .gt("comment_count", 10)
        .not("vehicle_id", "is", null)
        .order("comment_count", { ascending: false })
        .range(randomOffset, randomOffset + pageSize - 1);

      vehicleEvents = events || [];

      eventsToProcess = vehicleEvents
        .filter((ve: any) => {
          const meta = ve.metadata || {};
          return !meta.comments_extracted_at;
        })
        .slice(0, batchSize);

      alreadyDone = vehicleEvents.length - eventsToProcess.length;
      console.log(`[Batch ${batchNumber}] Random offset ${randomOffset}: ${vehicleEvents.length} checked, ${eventsToProcess.length} to process, ${alreadyDone} already done`);
    }

    if (!vehicleEvents || vehicleEvents.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: "No vehicle_events with comments found",
        processed: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Convert to vehicle format for processing, keeping event_id for marking as done
    const vehiclesToProcess = eventsToProcess.map((ve: any) => ({
      id: ve.vehicle_id,
      event_id: ve.id,
      bat_auction_url: ve.source_url,
      year: null,
      make: null,
      model: (ve.metadata || {}).title || null,
      sale_price: ve.final_price,
      metadata: ve.metadata || {},
    }));

    if (vehiclesToProcess.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: queryMethod === "rpc"
          ? "BACKFILL COMPLETE - No unextracted events found by RPC"
          : "No unextracted events found on this random page (will retry on next cron)",
        processed: 0,
        batch_number: batchNumber,
        events_checked: vehicleEvents.length,
        already_extracted: alreadyDone,
        query_method: queryMethod,
        continuing: false,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const results = {
      processed: 0,
      success: 0,
      errors: 0,
      samples: [] as any[],
    };

    // Process each vehicle
    for (const vehicle of vehiclesToProcess) {
      try {
        console.log(`Extracting comments: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
        console.log(`  URL: ${vehicle.bat_auction_url}`);

        const response = await fetch(
          `${supabaseUrl}/functions/v1/extract-auction-comments`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({
              auction_url: vehicle.bat_auction_url,
              vehicle_id: vehicle.id,
            }),
            signal: AbortSignal.timeout(120000),
          }
        );

        let result: any;
        try {
          result = await response.json();
        } catch {
          result = { success: false, error: `Non-JSON response (${response.status})` };
        }

        if (result.success) {
          results.success++;

          // Mark vehicle_event as processed
          await supabase
            .from("vehicle_events")
            .update({
              metadata: {
                ...vehicle.metadata,
                comments_extracted_at: new Date().toISOString(),
                comments_extracted_count: result.comments_extracted,
              },
            })
            .eq("id", vehicle.event_id);

          if (results.samples.length < 3) {
            results.samples.push({
              vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
              comments_extracted: result.comments_extracted,
            });
          }
        } else {
          console.error(`Failed: ${result.error}`);
          results.errors++;
        }

        results.processed++;

        // Delay between requests to avoid rate limiting
        if (vehiclesToProcess.indexOf(vehicle) < vehiclesToProcess.length - 1) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      } catch (e: any) {
        console.error(`Error processing ${vehicle.id}: ${e.message}`);
        results.errors++;
        results.processed++;
      }
    }

    // Calculate remaining work
    // With RPC mode, we know there are more if we got a full batch
    // With random mode, there are always more until RPC says otherwise
    const totalRemaining = queryMethod === "rpc"
      ? (eventsToProcess.length >= batchSize ? batchSize : 0) // More if we got a full batch
      : vehicleEvents.filter((ve: any) => {
          const meta = ve.metadata || {};
          return !meta.comments_extracted_at;
        }).length - results.processed;

    const hasMoreWork = totalRemaining > 0 || results.processed > 0;

    // Self-invoke for next batch if there's more work
    // Continue even with some errors, as long as we processed something
    if (hasMoreWork && (results.success > 0 || results.errors < results.processed)) {
      console.log(`Triggering batch ${batchNumber + 1}, ~${totalRemaining} remaining...`);

      // Fire-and-forget: trigger next batch without waiting
      fetch(`${supabaseUrl}/functions/v1/backfill-comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          batch_size: batchSize,
          delay_ms: delayMs,
          max_batches: maxBatches,
          batch_number: batchNumber + 1,
        }),
        signal: AbortSignal.timeout(15000),
      }).catch(e => console.error("Failed to trigger next batch:", e.message));

      // Small delay to ensure the request is sent
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return new Response(JSON.stringify({
      success: true,
      ...results,
      batch_number: batchNumber,
      events_checked: vehicleEvents.length,
      already_extracted: alreadyDone,
      remaining_estimate: totalRemaining,
      query_method: queryMethod,
      continuing: hasMoreWork && (results.success > 0 || results.errors < results.processed),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("Error:", e);
    return new Response(JSON.stringify({
      success: false,
      error: e.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
