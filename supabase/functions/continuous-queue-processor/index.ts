/**
 * Continuous Queue Processor
 *
 * Multi-source batch queue processor for continuous extraction.
 * - Claims items by domain for efficient routing
 * - Routes to appropriate extractor (BaT, C&B, Craigslist, etc.)
 * - Stealth delays to avoid rate limits
 * - Metrics tracking for items/hour
 *
 * POST /functions/v1/continuous-queue-processor
 * Body: {
 *   batch_size?: number,      // Items per batch (default 10, max 50)
 *   source?: string,          // Optional: 'bat', 'carsandbids', 'craigslist', 'all'
 *   continuous?: boolean,     // Run until timeout (default false)
 *   max_runtime_seconds?: number  // Max runtime (default 270, edge function limit ~300)
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SourceConfig {
  pattern: string;
  extractor: string;
  minDelay: number;
  maxDelay: number;
}

const SOURCE_CONFIGS: Record<string, SourceConfig> = {
  bat: {
    pattern: "%bringatrailer.com/listing/%",
    extractor: "extract-bat-core",
    minDelay: 2000,
    maxDelay: 5000,
  },
  carsandbids: {
    pattern: "%carsandbids.com%",
    extractor: "extract-cars-and-bids-core",
    minDelay: 1500,
    maxDelay: 3000,
  },
  collectingcars: {
    pattern: "%collectingcars.com%",
    extractor: "extract-collecting-cars",
    minDelay: 1500,
    maxDelay: 3000,
  },
  craigslist: {
    pattern: "%craigslist.org%",
    extractor: "extract-craigslist",
    minDelay: 1000,
    maxDelay: 2000,
  },
  pcarmarket: {
    pattern: "%pcarmarket.com%",
    extractor: "import-pcarmarket-listing",
    minDelay: 1500,
    maxDelay: 3000,
  },
  hagerty: {
    pattern: "%hagerty.com%",
    extractor: "extract-hagerty-listing",
    minDelay: 1500,
    maxDelay: 3000,
  },
  classic: {
    pattern: "%classic.com%",
    extractor: "import-classic-auction",
    minDelay: 1500,
    maxDelay: 3000,
  },
};

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function detectSource(url: string): string | null {
  if (url.includes("bringatrailer.com/listing/")) return "bat";
  if (url.includes("carsandbids.com")) return "carsandbids";
  if (url.includes("collectingcars.com")) return "collectingcars";
  if (url.includes("craigslist.org")) return "craigslist";
  if (url.includes("pcarmarket.com")) return "pcarmarket";
  if (url.includes("hagerty.com")) return "hagerty";
  if (url.includes("classic.com")) return "classic";
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();
  const workerId = `cqp-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  const metrics = {
    total_processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    by_source: {} as Record<string, { processed: number; succeeded: number; failed: number }>,
    vehicle_ids: [] as string[],
    errors: [] as string[],
  };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceKey);
    const authHeader = `Bearer ${serviceKey}`;

    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(body.batch_size || 10, 50);
    const source = body.source || "all";
    const continuous = body.continuous || false;
    const maxRuntimeSeconds = Math.min(body.max_runtime_seconds || 270, 290);
    const maxRuntimeMs = maxRuntimeSeconds * 1000;

    // Determine which sources to process
    const sourcesToProcess = source === "all"
      ? Object.keys(SOURCE_CONFIGS)
      : [source];

    // Initialize metrics for each source
    for (const s of sourcesToProcess) {
      metrics.by_source[s] = { processed: 0, succeeded: 0, failed: 0 };
    }

    let iteration = 0;
    const maxIterations = continuous ? 1000 : 1;

    while (iteration < maxIterations) {
      iteration++;

      // Check runtime limit
      if (Date.now() - startTime > maxRuntimeMs) {
        console.log(`Runtime limit reached (${maxRuntimeSeconds}s), stopping`);
        break;
      }

      let processedThisIteration = 0;

      // Process each source in round-robin fashion
      for (const sourceName of sourcesToProcess) {
        const config = SOURCE_CONFIGS[sourceName];
        if (!config) continue;

        // Check runtime again before each source
        if (Date.now() - startTime > maxRuntimeMs) break;

        // Claim batch for this specific domain
        const { data: claimed, error: claimError } = await supabase.rpc(
          "claim_import_queue_batch_by_domain",
          {
            p_domain_pattern: config.pattern,
            p_batch_size: batchSize,
            p_max_attempts: 5,
            p_worker_id: workerId,
            p_lock_ttl_seconds: 600,
          }
        );

        if (claimError) {
          console.error(`Claim error for ${sourceName}: ${claimError.message}`);
          continue;
        }

        if (!claimed || claimed.length === 0) {
          continue; // No items for this source
        }

        console.log(`Processing ${claimed.length} ${sourceName} items`);

        // Process each item
        for (const item of claimed) {
          // Check runtime
          if (Date.now() - startTime > maxRuntimeMs) break;

          metrics.total_processed++;
          processedThisIteration++;
          metrics.by_source[sourceName].processed++;

          try {
            // Stealth delay
            await randomDelay(config.minDelay, config.maxDelay);

            // Call extractor
            const extractResponse = await fetch(
              `${supabaseUrl}/functions/v1/${config.extractor}`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: authHeader,
                },
                body: JSON.stringify({
                  url: item.listing_url,
                  save_to_db: true,
                  max_vehicles: 1,
                }),
              }
            );

            const extractResult = await extractResponse.json().catch(() => ({ success: false, error: "Invalid JSON response" }));

            if (extractResult.success) {
              const vehicleId =
                extractResult.vehicle_id ||
                extractResult.created_vehicle_ids?.[0] ||
                extractResult.updated_vehicle_ids?.[0];

              // Mark complete
              await supabase
                .from("import_queue")
                .update({
                  status: "complete",
                  vehicle_id: vehicleId,
                  processed_at: new Date().toISOString(),
                  locked_at: null,
                  locked_by: null,
                })
                .eq("id", item.id);

              metrics.succeeded++;
              metrics.by_source[sourceName].succeeded++;
              if (vehicleId) metrics.vehicle_ids.push(vehicleId);

              // For BaT, also extract comments (non-blocking)
              if (sourceName === "bat" && vehicleId) {
                fetch(`${supabaseUrl}/functions/v1/extract-auction-comments`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: authHeader,
                  },
                  body: JSON.stringify({
                    auction_url: item.listing_url,
                    vehicle_id: vehicleId,
                  }),
                }).catch(() => {});
              }
            } else {
              throw new Error(extractResult.error || "Extraction failed");
            }
          } catch (e: any) {
            const errorMsg = e.message || String(e);

            // Determine if should retry or fail
            const shouldFail = item.attempts >= 5;

            await supabase
              .from("import_queue")
              .update({
                status: shouldFail ? "failed" : "pending",
                error_message: errorMsg,
                processed_at: new Date().toISOString(),
                locked_at: null,
                locked_by: null,
                // Backoff: 5min * 2^attempts, max 2 hours
                next_attempt_at: shouldFail
                  ? null
                  : new Date(
                      Date.now() +
                        Math.min(2 * 60 * 60 * 1000, 5 * 60 * 1000 * Math.pow(2, item.attempts || 0))
                    ).toISOString(),
              })
              .eq("id", item.id);

            metrics.failed++;
            metrics.by_source[sourceName].failed++;
            metrics.errors.push(`${sourceName}:${item.id.slice(0, 8)}: ${errorMsg.slice(0, 100)}`);
          }
        }
      }

      // If no items processed in this iteration, break (queue empty)
      if (processedThisIteration === 0) {
        console.log("No items to process, stopping");
        break;
      }
    }

    const elapsedSeconds = (Date.now() - startTime) / 1000;
    const itemsPerHour = metrics.total_processed > 0
      ? Math.round((metrics.total_processed / elapsedSeconds) * 3600)
      : 0;

    return new Response(
      JSON.stringify({
        success: true,
        worker_id: workerId,
        ...metrics,
        elapsed_seconds: Math.round(elapsedSeconds * 10) / 10,
        items_per_hour: itemsPerHour,
        iterations: iteration,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({
        success: false,
        worker_id: workerId,
        error: e.message,
        ...metrics,
        elapsed_seconds: Math.round((Date.now() - startTime) / 100) / 10,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
