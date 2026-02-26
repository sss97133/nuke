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
  sourceIds?: string[]; // UUID source_ids for fast claiming via index
}

const SOURCE_CONFIGS: Record<string, SourceConfig> = {
  bat: {
    pattern: "%bringatrailer.com/listing/%",
    extractor: "extract-bat-core",
    minDelay: 2000,
    maxDelay: 5000,
    sourceIds: ["2bf675bd-4cb4-4e6f-8e14-2abd6d00098a", "db9ff20a-15b6-41f1-ae09-dd31975a77c0"],
  },
  carsandbids: {
    pattern: "%carsandbids.com%",
    extractor: "extract-cars-and-bids-core",
    minDelay: 1500,
    maxDelay: 3000,
    sourceIds: ["3422b660-3233-47a4-b44e-97e23bf9e9cb"],
  },
  collectingcars: {
    pattern: "%collectingcars.com%",
    extractor: "extract-collecting-cars",
    minDelay: 1500,
    maxDelay: 3000,
    sourceIds: ["509ec9f8-fd66-4bde-8e07-a0aa198a6506"],
  },
  craigslist: {
    pattern: "%craigslist.org%",
    extractor: "extract-craigslist",
    minDelay: 1000,
    maxDelay: 2000,
    sourceIds: ["7573f45d-868e-45bb-acd6-ade46126fc45"],
  },
  pcarmarket: {
    pattern: "%pcarmarket.com%",
    extractor: "import-pcarmarket-listing",
    minDelay: 1500,
    maxDelay: 3000,
    sourceIds: ["7de1f62c-ffcf-42d5-a15a-074abdbeb46e", "d338952e-e559-4a2b-aa84-1aadf6a5bb71"],
  },
  hagerty: {
    pattern: "%hagerty.com%",
    extractor: "extract-hagerty-listing",
    minDelay: 1500,
    maxDelay: 3000,
    sourceIds: ["3c195228-5553-45fa-a5fe-bc620eb0ebd9"],
  },
  classic: {
    pattern: "%classic.com%",
    extractor: "import-classic-auction",
    minDelay: 1500,
    maxDelay: 3000,
  },
  barnfinds: {
    pattern: "%barnfinds.com%",
    extractor: "extract-barn-finds-listing",
    minDelay: 1000,
    maxDelay: 2000,
  },
  mecum: {
    pattern: "%mecum.com%",
    extractor: "extract-mecum",
    minDelay: 1500,
    maxDelay: 3000,
    sourceIds: ["5bb6b479-9eaf-4e06-ba35-4d0ff86b9b7c", "aacb688b-41d4-407c-8d5e-348ce7f02a18"],
  },
  barrettjackson: {
    pattern: "%barrett-jackson.com%",
    extractor: "extract-barrett-jackson",
    minDelay: 2000,
    maxDelay: 4000,
    sourceIds: ["23b5bd94-bbe3-441e-8688-3ab1aec30680", "ce74e304-d190-4041-9cce-cb950652b9c4"],
  },
  broadarrow: {
    pattern: "%broadarrowauctions.com%",
    extractor: "extract-broad-arrow",
    minDelay: 1500,
    maxDelay: 3000,
    sourceIds: ["b1e0d050-ca10-46b9-abdc-e8fb55e6a439"],
  },
  ksl: {
    pattern: "%ksl.com%",
    extractor: "extract-vehicle-data-ai",
    minDelay: 1000,
    maxDelay: 2000,
    sourceIds: ["a7c3c539-487d-4af4-8395-9e5bc1d2a795", "b894cdf1-a3f5-4124-b960-898372805ae8", "c466bffc-552b-46b6-baa6-ca3de323b930"],
  },
  bonhams: {
    pattern: "%bonhams.com%",
    extractor: "extract-bonhams",
    minDelay: 2000,
    maxDelay: 4000,
    sourceIds: ["c1c826d8-6bc1-4a98-b2dc-6e679f00dcfb", "e1b07ace-09c9-4d3f-b572-74f01044c335"],
  },
  rmsothebys: {
    pattern: "%rmsothebys.com%",
    extractor: "extract-rmsothebys",
    minDelay: 2000,
    maxDelay: 4000,
    sourceIds: ["d3bcf955-d901-4be9-a933-b7cee8a70b8d"],
  },
  gooding: {
    pattern: "%goodingco.com%",
    extractor: "extract-gooding",
    minDelay: 2000,
    maxDelay: 4000,
    sourceIds: ["92411068-c4e6-45a6-ac96-61f51f944cac", "3b7d5507-1d97-4b43-a2aa-58522d86e06c", "ce74e304-d190-4041-9cce-cb950652b9c4"],
  },
  gaa: {
    pattern: "%gaaclassiccars.com%",
    extractor: "extract-gaa-classics",
    minDelay: 1500,
    maxDelay: 3000,
  },
  ebay: {
    pattern: "%ebay.com%",
    extractor: "extract-ebay-motors",
    minDelay: 1500,
    maxDelay: 3000,
  },
  ecr: {
    // ECR /details/ pages — vehicle-level pages, JS-rendered, login-gated for most fields.
    // extract-vehicle-data-ai uses Firecrawl + AI and can pull make/model/color/location from
    // URL structure and og: meta tags even without login.
    // NOTE: /collection/, /profile/, /dealer/ URLs are NOT vehicle listings and should never
    // reach this processor — they should be routed to scrape-ecr-collection-inventory.
    pattern: "%exclusivecarregistry.com/details/%",
    extractor: "extract-vehicle-data-ai",
    minDelay: 2000,
    maxDelay: 4000,
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
  if (url.includes("barnfinds.com")) return "barnfinds";
  if (url.includes("mecum.com")) return "mecum";
  if (url.includes("barrett-jackson.com")) return "barrettjackson";
  if (url.includes("broadarrowauctions.com")) return "broadarrow";
  if (url.includes("ksl.com")) return "ksl";
  if (url.includes("bonhams.com")) return "bonhams";
  if (url.includes("rmsothebys.com")) return "rmsothebys";
  if (url.includes("goodingco.com")) return "gooding";
  if (url.includes("gaaclassiccars.com")) return "gaa";
  if (url.includes("ebay.com")) return "ebay";
  if (url.includes("exclusivecarregistry.com/details/")) return "ecr";
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
    errors_truncated: false,
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

        // Claim batch — use fast source_id path when available, fall back to LIKE pattern
        let claimed: any[] | null = null;
        let claimError: any = null;

        if (config.sourceIds && config.sourceIds.length > 0) {
          // Fast path: use indexed source_id claim (avoids full table LIKE scan)
          for (const sourceId of config.sourceIds) {
            const { data, error } = await supabase.rpc(
              "claim_import_queue_batch_by_source_id",
              {
                p_source_id: sourceId,
                p_batch_size: batchSize,
                p_max_attempts: 5,
                p_worker_id: workerId,
                p_lock_ttl_seconds: 600,
              }
            );
            if (error) {
              claimError = error;
              break;
            }
            if (data && data.length > 0) {
              claimed = data;
              break; // Got items from this source_id
            }
          }
          // Fallback to LIKE if source_id claim found nothing (items may have NULL source_id)
          if (!claimed || claimed.length === 0) {
            const result = await supabase.rpc(
              "claim_import_queue_batch_by_domain",
              {
                p_domain_pattern: config.pattern,
                p_batch_size: batchSize,
                p_max_attempts: 5,
                p_worker_id: workerId,
                p_lock_ttl_seconds: 600,
              }
            );
            if (!claimError) {
              claimed = result.data;
              claimError = result.error;
            }
          }
        } else {
          // No source_ids configured: LIKE pattern matching only
          const result = await supabase.rpc(
            "claim_import_queue_batch_by_domain",
            {
              p_domain_pattern: config.pattern,
              p_batch_size: batchSize,
              p_max_attempts: 5,
              p_worker_id: workerId,
              p_lock_ttl_seconds: 600,
            }
          );
          claimed = result.data;
          claimError = result.error;
        }

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
                signal: AbortSignal.timeout(120_000),
              }
            );

            const extractResult = await extractResponse.json().catch(() => ({ success: false, error: "Invalid JSON response" }));

            if (extractResult.success) {
              const vehicleId =
                extractResult.vehicle_id ||
                extractResult.vehicleId ||
                extractResult.created_vehicle_ids?.[0] ||
                extractResult.updated_vehicle_ids?.[0] ||
                null;

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
              if (vehicleId && metrics.vehicle_ids.length < 500) metrics.vehicle_ids.push(vehicleId);

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
                  signal: AbortSignal.timeout(120000),
                }).catch((e: any) => console.warn(`[queue] Comment extraction trigger failed for ${item.id}:`, e instanceof Error ? e.message : String(e)));
              }
            } else {
              // Propagate the real error from the extractor
              const errDetail = typeof extractResult.error === 'string'
                ? extractResult.error
                : extractResult.error ? JSON.stringify(extractResult.error) : null;
              const httpNote = extractResponse.ok ? '' : ` (HTTP ${extractResponse.status})`;
              throw new Error(errDetail || `Extraction failed${httpNote}`);
            }
          } catch (e: any) {
            const errorMsg = e.message || String(e);

            // Categorize the failure for triage
            const category = errorMsg.includes('RATE_LIMITED') || errorMsg.includes('429') ? 'rate_limited'
              : errorMsg.includes('BLOCKED') || errorMsg.includes('403') || errorMsg.includes('Cloudflare') ? 'blocked'
              : errorMsg.includes('REDIRECT') ? 'redirect'
              : errorMsg.includes('timeout') || errorMsg.includes('Timeout') || errorMsg.includes('TIMEOUT') ? 'timeout'
              : errorMsg.includes('INVALID_PAGE') ? 'invalid_page'
              : errorMsg.includes('duplicate key') ? 'duplicate'
              : errorMsg.includes('Missing required') ? 'missing_fields'
              : 'extraction_failed';

            // Rate-limited and blocked errors should retry more aggressively
            const isTransient = category === 'rate_limited' || category === 'blocked' || category === 'timeout';

            // Determine if should retry or fail
            const attempts = item.attempts ?? 0;
            const maxAttempts = isTransient ? 8 : 5;
            const shouldFail = attempts >= maxAttempts;

            await supabase
              .from("import_queue")
              .update({
                status: shouldFail ? "failed" : "pending",
                error_message: errorMsg,
                failure_category: category,
                processed_at: new Date().toISOString(),
                locked_at: null,
                locked_by: null,
                // Transient errors: longer backoff (10min base). Others: 5min base. Max 2 hours.
                next_attempt_at: shouldFail
                  ? null
                  : new Date(
                      Date.now() +
                        Math.min(2 * 60 * 60 * 1000, (isTransient ? 10 : 5) * 60 * 1000 * Math.pow(2, attempts))
                    ).toISOString(),
              })
              .eq("id", item.id);

            metrics.failed++;
            metrics.by_source[sourceName].failed++;
            if (metrics.errors.length < 100) {
              metrics.errors.push(`${sourceName}:${item.id.slice(0, 8)}: ${errorMsg.slice(0, 100)}`);
            } else {
              metrics.errors_truncated = true;
            }
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
        error: e?.message || String(e),
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
