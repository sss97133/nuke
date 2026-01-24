/**
 * BACKFILL COMMENTS (Self-Continuing)
 * Extract comments for vehicles that have bat_auction_url but no comments yet
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

    // Get bat_listings with comments that haven't been extracted yet
    // Use pagination to work through all listings, not just top 200
    const pageSize = 500;
    const offset = ((batchNumber - 1) % 10) * pageSize; // Cycle through pages

    const { data: batListings } = await supabase
      .from("bat_listings")
      .select("id, vehicle_id, bat_listing_url, bat_listing_title, comment_count, sale_price, raw_data")
      .gt("comment_count", 10)
      .not("vehicle_id", "is", null)
      .order("comment_count", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (!batListings || batListings.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: "No bat_listings with comments found",
        processed: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Filter to listings that haven't been processed (no comments_extracted_at in raw_data)
    const listingsToProcess = batListings
      .filter((bl: any) => {
        const rawData = bl.raw_data || {};
        return !rawData.comments_extracted_at;
      })
      .slice(0, batchSize);

    const alreadyDone = batListings.length - listingsToProcess.length;
    console.log(`[Batch ${batchNumber}] Page ${Math.floor(offset/pageSize)+1}: ${batListings.length} listings checked, ${listingsToProcess.length} to process, ${alreadyDone} already done`);

    // Convert to vehicle format for processing, keeping bat_listing_id for marking as done
    const vehiclesToProcess = listingsToProcess.map((bl: any) => ({
      id: bl.vehicle_id,
      bat_listing_id: bl.id,
      bat_auction_url: bl.bat_listing_url,
      year: null,
      make: null,
      model: bl.bat_listing_title,
      sale_price: bl.sale_price,
      raw_data: bl.raw_data || {},
    }));

    if (vehiclesToProcess.length === 0) {
      // Check if there are more pages to scan
      const currentPage = Math.floor(offset / pageSize);
      if (currentPage < 9 && batListings.length === pageSize) {
        // More pages exist, continue to next page
        console.log(`Page ${currentPage + 1} fully extracted, moving to next page...`);

        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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
        }).catch(e => console.error("Failed to trigger next batch:", e.message));

        await new Promise(resolve => setTimeout(resolve, 100));

        return new Response(JSON.stringify({
          success: true,
          message: `Page ${currentPage + 1} complete, continuing to next page`,
          processed: 0,
          batch_number: batchNumber,
          page: currentPage + 1,
          continuing: true,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({
        success: true,
        message: "✅ BACKFILL COMPLETE - All listings have comments extracted",
        processed: 0,
        batch_number: batchNumber,
        listings_checked: batListings.length,
        already_extracted: alreadyDone,
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
          }
        );

        const result = await response.json();

        if (result.success) {
          results.success++;

          // Mark bat_listing as processed
          await supabase
            .from("bat_listings")
            .update({
              raw_data: {
                ...vehicle.raw_data,
                comments_extracted_at: new Date().toISOString(),
                comments_extracted_count: result.comments_extracted,
              },
            })
            .eq("id", vehicle.bat_listing_id);

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
    const totalRemaining = batListings.filter((bl: any) => {
      const rawData = bl.raw_data || {};
      return !rawData.comments_extracted_at;
    }).length - results.processed;

    const hasMoreWork = totalRemaining > 0;

    // Self-invoke for next batch if there's more work
    if (hasMoreWork && results.success > 0) {
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
      }).catch(e => console.error("Failed to trigger next batch:", e.message));

      // Small delay to ensure the request is sent
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return new Response(JSON.stringify({
      success: true,
      ...results,
      batch_number: batchNumber,
      listings_checked: batListings.length,
      already_extracted: alreadyDone,
      remaining_estimate: totalRemaining,
      continuing: hasMoreWork && results.success > 0,
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
