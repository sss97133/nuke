/**
 * BACKFILL COMMENTS
 * Extract comments for vehicles that have bat_auction_url but no comments yet
 *
 * POST /functions/v1/backfill-comments
 * Body: { "batch_size": 10, "delay_ms": 2000 }
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

    // Get bat_listings with comments that haven't been extracted yet
    // Use a raw_data flag to track extraction status
    const { data: batListings } = await supabase
      .from("bat_listings")
      .select("id, vehicle_id, bat_listing_url, bat_listing_title, comment_count, sale_price, raw_data")
      .gt("comment_count", 10)
      .not("vehicle_id", "is", null)
      .order("comment_count", { ascending: false })
      .limit(200);

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
    console.log(`${batListings.length} bat_listings with >10 comments, ${listingsToProcess.length} need extraction, ${alreadyDone} already done`);

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
      return new Response(JSON.stringify({
        success: true,
        message: "All listings in batch already have comments extracted",
        processed: 0,
        listings_checked: batListings.length,
        already_extracted: alreadyDone,
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

    // Return stats
    const remaining = listingsToProcess.length - results.processed;

    return new Response(JSON.stringify({
      success: true,
      ...results,
      listings_checked: batListings.length,
      already_extracted: alreadyDone,
      remaining_in_batch: remaining,
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
