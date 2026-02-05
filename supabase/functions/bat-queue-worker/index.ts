/**
 * BAT Queue Worker
 *
 * Production worker for processing BaT URLs from import_queue.
 * - Uses atomic claim_import_queue_batch to prevent duplicates
 * - Stealth delays (2-5 sec) to avoid rate limits
 * - Full extraction + comments
 * - Safe for parallel execution via pg_cron
 *
 * POST /functions/v1/bat-queue-worker
 * Body: { "batch_size": 20 }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return new Promise(resolve => setTimeout(resolve, delay));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();
  const workerId = `bat-q-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    // Use incoming auth for function-to-function calls
    const incomingAuth = req.headers.get("authorization") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const authToUse = incomingAuth || `Bearer ${serviceKey}`;
    const tokenForClient = incomingAuth.startsWith("Bearer ")
      ? incomingAuth.substring(7)
      : serviceKey;
    const supabase = createClient(supabaseUrl, tokenForClient);

    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(body.batch_size || 20, 50);

    // Claim batch atomically - this prevents duplicates across workers
    const { data: claimed, error: claimError } = await supabase.rpc(
      "claim_import_queue_batch",
      {
        p_batch_size: batchSize,
        p_max_attempts: 3,
        p_worker_id: workerId,
        p_lock_ttl_seconds: 600,
      }
    );

    if (claimError) {
      throw new Error(`Claim failed: ${claimError.message}`);
    }

    if (!claimed || claimed.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        worker_id: workerId,
        message: "No pending items",
        processed: 0,
        succeeded: 0,
        failed: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Filter to BaT URLs only
    const batItems = claimed.filter((item: any) =>
      item.listing_url?.includes("bringatrailer.com/listing/")
    );

    // Release non-BaT items back to queue
    const nonBatIds = claimed
      .filter((item: any) => !item.listing_url?.includes("bringatrailer.com/listing/"))
      .map((i: any) => i.id);

    if (nonBatIds.length > 0) {
      await supabase.from("import_queue")
        .update({ status: "pending", locked_at: null, locked_by: null })
        .in("id", nonBatIds);
    }

    if (batItems.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        worker_id: workerId,
        message: "No BaT URLs in batch",
        processed: 0,
        succeeded: 0,
        failed: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const results = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      rate_limited: 0,
      vehicle_ids: [] as string[],
      circuit_breaker_triggered: false,
    };

    // Circuit breaker: stop if we hit too many rate limits
    const RATE_LIMIT_THRESHOLD = 3;
    let consecutiveRateLimits = 0;

    // Process each URL
    for (const item of batItems) {
      // Circuit breaker check
      if (consecutiveRateLimits >= RATE_LIMIT_THRESHOLD) {
        results.circuit_breaker_triggered = true;
        // Release remaining items back to queue with delay
        const remainingIds = batItems
          .slice(batItems.indexOf(item))
          .map((i: any) => i.id);
        if (remainingIds.length > 0) {
          const retryAfter = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min
          await supabase.from("import_queue")
            .update({
              status: "pending",
              locked_at: null,
              locked_by: null,
              next_attempt_at: retryAfter,
              error_message: "CIRCUIT_BREAKER: Rate limited, backing off 10 min",
            })
            .in("id", remainingIds);
        }
        break;
      }

      const url = item.listing_url;

      // Adaptive delay: longer if we've seen rate limits
      const baseDelay = consecutiveRateLimits > 0 ? 5000 : 2000;
      const maxDelay = consecutiveRateLimits > 0 ? 10000 : 5000;
      await randomDelay(baseDelay, maxDelay);

      try {
        // Call extract-bat-core
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

        const extractResult = await extractResponse.json();

        if (extractResult.success) {
          consecutiveRateLimits = 0; // Reset on success
          const vehicleId = extractResult.created_vehicle_ids?.[0] ||
                           extractResult.updated_vehicle_ids?.[0];

          // Mark complete
          await supabase.from("import_queue").update({
            status: "complete",
            vehicle_id: vehicleId,
            processed_at: new Date().toISOString(),
            locked_at: null,
            locked_by: null,
            error_message: null,
          }).eq("id", item.id);

          results.succeeded++;
          if (vehicleId) {
            results.vehicle_ids.push(vehicleId);

            // Extract comments (non-critical)
            await randomDelay(1000, 2000);
            try {
              await fetch(
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
            } catch (_) { /* comments optional */ }
          }
        } else {
          throw new Error(extractResult.error || "Extraction failed");
        }
      } catch (e: any) {
        const errorMsg = e.message || String(e);
        const isRateLimit = errorMsg.includes("RATE_LIMITED") ||
                           errorMsg.includes("BLOCKED") ||
                           errorMsg.includes("429") ||
                           errorMsg.includes("login");
        const isGone = errorMsg.includes("410") || errorMsg.includes("Gone") || errorMsg.includes("404");

        if (isRateLimit) {
          consecutiveRateLimits++;
          results.rate_limited++;
          // Don't count against attempts for rate limits - not our fault
          const retryAfter = new Date(Date.now() + 5 * 60 * 1000).toISOString();
          await supabase.from("import_queue").update({
            status: "pending",
            error_message: errorMsg,
            next_attempt_at: retryAfter,
            locked_at: null,
            locked_by: null,
          }).eq("id", item.id);
        } else if (isGone) {
          // Page doesn't exist - mark as skipped, don't retry
          await supabase.from("import_queue").update({
            status: "skipped",
            error_message: errorMsg,
            processed_at: new Date().toISOString(),
            locked_at: null,
            locked_by: null,
          }).eq("id", item.id);
          consecutiveRateLimits = 0;
        } else {
          // Regular failure - count attempts
          consecutiveRateLimits = 0;
          await supabase.from("import_queue").update({
            status: item.attempts >= 3 ? "failed" : "pending",
            error_message: errorMsg,
            processed_at: new Date().toISOString(),
            locked_at: null,
            locked_by: null,
          }).eq("id", item.id);
        }

        results.failed++;
      }

      results.processed++;
    }

    const elapsed = (Date.now() - startTime) / 1000;

    return new Response(JSON.stringify({
      success: true,
      worker_id: workerId,
      ...results,
      elapsed_seconds: Math.round(elapsed * 10) / 10,
      rate_per_minute: Math.round(results.processed / (elapsed / 60) * 10) / 10,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (e: any) {
    return new Response(JSON.stringify({
      success: false,
      worker_id: workerId,
      error: e.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
