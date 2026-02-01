/**
 * BAT Extraction Test
 *
 * Safe test run for parallel extraction from Supabase.
 * - Processes small batch (10 vehicles)
 * - Random delays (2-5 seconds)
 * - Logs everything for analysis
 * - Uses atomic claim to prevent duplicates
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Stealth settings
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

const REFERERS = [
  "https://www.google.com/",
  "https://www.google.com/search?q=bring+a+trailer",
  "https://bringatrailer.com/",
  "https://www.bing.com/",
];

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return new Promise(resolve => setTimeout(resolve, delay));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();
  const logs: string[] = [];
  const log = (msg: string) => {
    const ts = new Date().toISOString();
    logs.push(`[${ts}] ${msg}`);
    console.log(msg);
  };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    // Get the incoming auth header - use this for function-to-function calls
    const incomingAuth = req.headers.get("authorization") ?? "";
    // Prefer incoming auth (full key) over env var (might be truncated)
    const authToUse = incomingAuth || `Bearer ${serviceKey}`;
    // Extract just the token part for Supabase client
    const tokenForClient = incomingAuth.startsWith("Bearer ")
      ? incomingAuth.substring(7)
      : serviceKey;
    const supabase = createClient(supabaseUrl, tokenForClient);

    const body = await req.json().catch(() => ({}));
    const testSize = Math.min(body.size || 10, 20); // Max 20 for test
    const dryRun = body.dry_run ?? false;
    const workerId = `bat-test-${Date.now()}`;

    log(`=== BAT EXTRACTION TEST ===`);
    log(`Test size: ${testSize}`);
    log(`Dry run: ${dryRun}`);
    log(`Worker ID: ${workerId}`);
    log(`Supabase URL: ${supabaseUrl}`);
    log(`Service key present: ${serviceKey ? 'yes (length: ' + serviceKey.length + ')' : 'NO'}`);
    log(`Incoming auth present: ${incomingAuth ? 'yes (length: ' + incomingAuth.length + ')' : 'NO'}`);
    log(`Using incoming auth instead of env var`);

    // Step 1: Claim batch atomically
    log(`Claiming ${testSize} items from import_queue...`);

    const { data: claimed, error: claimError } = await supabase.rpc(
      "claim_import_queue_batch",
      {
        p_batch_size: testSize,
        p_max_attempts: 3,
        p_worker_id: workerId,
        p_lock_ttl_seconds: 600, // 10 min lock
      }
    );

    if (claimError) {
      throw new Error(`Claim failed: ${claimError.message}`);
    }

    if (!claimed || claimed.length === 0) {
      log(`No pending items to process`);
      return new Response(JSON.stringify({
        success: true,
        message: "No pending items",
        logs,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    log(`Claimed ${claimed.length} items`);

    // Filter to BaT URLs only
    const batItems = claimed.filter((item: any) =>
      item.listing_url?.includes("bringatrailer.com/listing/")
    );

    if (batItems.length === 0) {
      log(`No BaT URLs in claimed batch`);
      // Release non-BaT items back to pending
      await supabase.from("import_queue")
        .update({ status: "pending", locked_at: null, locked_by: null })
        .in("id", claimed.map((i: any) => i.id));

      return new Response(JSON.stringify({
        success: true,
        message: "No BaT URLs in batch",
        logs,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    log(`Processing ${batItems.length} BaT URLs`);

    const results = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      details: [] as any[],
    };

    // Step 2: Process each URL
    for (const item of batItems) {
      const url = item.listing_url;
      log(`\n--- Processing: ${url} ---`);

      // Random delay BEFORE request (2-5 seconds)
      const delayMs = 2000 + Math.random() * 3000;
      log(`Waiting ${Math.round(delayMs)}ms...`);
      await randomDelay(delayMs, delayMs);

      if (dryRun) {
        log(`[DRY RUN] Would fetch: ${url}`);
        results.processed++;
        results.succeeded++;
        results.details.push({ url, status: "dry_run" });
        continue;
      }

      try {
        // Call extract-bat-core
        log(`Calling extract-bat-core for: ${url}`);
        const extractResponse = await fetch(
          `${supabaseUrl}/functions/v1/extract-bat-core`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": authToUse,
            },
            body: JSON.stringify({ url, max_vehicles: 1 }),
          }
        );

        log(`Response status: ${extractResponse.status}`);
        const responseText = await extractResponse.text();
        log(`Response body (first 500): ${responseText.substring(0, 500)}`);

        let extractResult;
        try {
          extractResult = JSON.parse(responseText);
        } catch (parseErr) {
          throw new Error(`JSON parse failed: ${responseText.substring(0, 200)}`);
        }

        if (extractResult.success) {
          const vehicleId = extractResult.created_vehicle_ids?.[0] ||
                           extractResult.updated_vehicle_ids?.[0];
          log(`✓ Success: ${vehicleId}`);

          // Mark complete
          await supabase.from("import_queue").update({
            status: "complete",
            vehicle_id: vehicleId,
            processed_at: new Date().toISOString(),
            locked_at: null,
            locked_by: null,
          }).eq("id", item.id);

          results.succeeded++;
          results.details.push({
            url,
            status: "success",
            vehicle_id: vehicleId,
            images: extractResult.debug_extraction?.images_count,
          });

          // Also extract comments (with delay)
          if (vehicleId) {
            await randomDelay(1000, 2000);
            try {
              const commentResponse = await fetch(
                `${supabaseUrl}/functions/v1/extract-auction-comments`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Authorization": authToUse,
                  },
                  body: JSON.stringify({ auction_url: url, vehicle_id: vehicleId }),
                }
              );
              const commentResult = await commentResponse.json();
              log(`  Comments: ${commentResult.comments_extracted || 0}`);
            } catch (e) {
              log(`  Comments failed: ${e}`);
            }
          }
        } else {
          throw new Error(extractResult.error || "Extraction failed");
        }
      } catch (e: any) {
        log(`✗ Failed: ${e.message}`);

        // Mark failed or back to pending for retry
        await supabase.from("import_queue").update({
          status: item.attempts >= 3 ? "failed" : "pending",
          error_message: e.message,
          processed_at: new Date().toISOString(),
          locked_at: null,
          locked_by: null,
        }).eq("id", item.id);

        results.failed++;
        results.details.push({ url, status: "failed", error: e.message });
      }

      results.processed++;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`\n=== TEST COMPLETE ===`);
    log(`Processed: ${results.processed}`);
    log(`Succeeded: ${results.succeeded}`);
    log(`Failed: ${results.failed}`);
    log(`Time: ${elapsed}s`);
    log(`Rate: ${(results.processed / (parseFloat(elapsed) / 60)).toFixed(1)}/min`);

    return new Response(JSON.stringify({
      success: true,
      ...results,
      elapsed_seconds: parseFloat(elapsed),
      rate_per_minute: results.processed / (parseFloat(elapsed) / 60),
      logs,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (e: any) {
    log(`ERROR: ${e.message}`);
    return new Response(JSON.stringify({
      success: false,
      error: e.message,
      logs,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
