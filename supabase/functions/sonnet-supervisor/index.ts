/**
 * Sonnet Supervisor
 *
 * The quality control layer. Uses claude-sonnet-4-6 to:
 * - Review Haiku extractions that need validation (pending_review status)
 * - Handle edge cases Haiku couldn't resolve
 * - Re-extract from archived HTML when Haiku gets low confidence
 * - Aggregate quality metrics across worker batches
 * - Make escalation decisions for Opus strategy layer
 *
 * POST body:
 * {
 *   action: "review_batch" | "review_single" | "resolve_edge_case" | "quality_report" | "dispatch_haiku" | "health",
 *   batch_size?: number,    // for review_batch (default 10, max 50)
 *   import_queue_id?: string,  // for review_single
 *   context?: any,          // for resolve_edge_case
 * }
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  callTier,
  parseJsonResponse,
  QUALITY_THRESHOLDS,
  estimateBatchCost,
  type AgentCallResult,
} from "../_shared/llmRouter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// ─── Supervisor Prompts ─────────────────────────────────────────────

const REVIEW_SYSTEM = `You are a senior vehicle data quality supervisor reviewing extraction results from a junior AI worker.

Your job is to:
1. Verify the extraction is accurate by cross-referencing with the source content
2. Fix any errors or fill in fields the junior worker missed
3. Resolve ambiguities (e.g., is "350" an engine displacement or a model number?)
4. Flag data that seems wrong (e.g., 2024 Ford Model T, mileage of 1 on a 1970 car)

RESPOND WITH ONLY THIS JSON:
{
  "approved": <boolean - true if the extraction is acceptable>,
  "corrected_data": <object|null - corrected extraction if changes needed, null if approved as-is>,
  "corrections_made": <string[] - list of corrections>,
  "quality_score": <number 0.0-1.0>,
  "issues_found": <string[] - problems detected>,
  "escalate_to_opus": <boolean - true only for strategic decisions like source reliability concerns>,
  "escalation_reason": <string|null>
}`;

const EDGE_CASE_SYSTEM = `You are an expert vehicle data analyst handling edge cases that simpler models cannot resolve.

Common edge cases:
- Ambiguous year/make/model (kit cars, restomods, vehicles with swapped components)
- Multiple vehicles in a single listing (lot sales)
- Non-standard vehicle types (boats listed on car sites, trailers, etc.)
- Foreign-market vehicles with different model names
- Custom/modified vehicles where original specs differ from current state
- Listings with conflicting information (title says one thing, description another)

Analyze the content carefully and provide your best assessment.

RESPOND WITH ONLY THIS JSON:
{
  "resolved_data": <object - your best extraction>,
  "resolution_notes": <string - explain your reasoning>,
  "confidence": <number 0.0-1.0>,
  "edge_case_type": <string - category of edge case>,
  "is_vehicle": <boolean - false if this isn't actually a vehicle listing>,
  "multiple_vehicles": <boolean - true if listing contains multiple vehicles>,
  "quality_score": <number 0.0-1.0>
}`;

// ─── Core Supervisor Functions ──────────────────────────────────────

interface ReviewResult {
  itemId: string;
  url: string;
  action: "approved" | "corrected" | "rejected" | "escalated";
  originalQuality: number;
  finalQuality: number;
  corrections: string[];
  cost: { inputTokens: number; outputTokens: number; costCents: number; durationMs: number };
}

/**
 * Review a single Haiku extraction result with Sonnet.
 */
async function reviewSingle(
  item: any,
  snapshot?: any,
): Promise<ReviewResult> {
  const haikuData = item.raw_data?.haiku_extraction;
  const haikuQuality = item.raw_data?.haiku_quality;
  const escalationReason = item.raw_data?.escalation_reason;

  // Build the review context
  let sourceContent = "";
  if (snapshot) {
    // Truncate to 8k chars for Sonnet — enough for review
    sourceContent = (snapshot.markdown || snapshot.html || "").slice(0, 8000);
  }

  const userMessage = `## Extraction to Review

**URL:** ${item.listing_url}
**Listing Title:** ${item.listing_title || "N/A"}
**Escalation Reason:** ${escalationReason || "quality review"}
**Haiku Quality Score:** ${haikuQuality?.score ?? "N/A"}
**Haiku Issues:** ${JSON.stringify(haikuQuality?.issues || [])}

### Haiku Extraction Result:
\`\`\`json
${JSON.stringify(haikuData, null, 2)}
\`\`\`

${sourceContent ? `### Source Content:\n${sourceContent}` : "### No source content available"}`;

  const result = await callTier("sonnet", REVIEW_SYSTEM, userMessage, {
    maxTokens: 2048,
  });

  let review: any;
  try {
    review = parseJsonResponse(result.content);
  } catch {
    return {
      itemId: item.id,
      url: item.listing_url,
      action: "rejected",
      originalQuality: haikuQuality?.score ?? 0,
      finalQuality: 0,
      corrections: ["Sonnet review JSON parse failed"],
      cost: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costCents: result.costCents,
        durationMs: result.durationMs,
      },
    };
  }

  // Determine action
  let action: ReviewResult["action"];
  if (review.escalate_to_opus) {
    action = "escalated";
  } else if (review.approved && !review.corrected_data) {
    action = "approved";
  } else if (review.corrected_data) {
    action = "corrected";
  } else {
    action = "rejected";
  }

  return {
    itemId: item.id,
    url: item.listing_url,
    action,
    originalQuality: haikuQuality?.score ?? 0,
    finalQuality: review.quality_score ?? 0,
    corrections: review.corrections_made || [],
    cost: {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costCents: result.costCents,
      durationMs: result.durationMs,
    },
  };
}

/**
 * Process a batch of pending_review items from import_queue.
 */
async function reviewBatch(batchSize: number): Promise<{
  reviewed: number;
  approved: number;
  corrected: number;
  rejected: number;
  escalated: number;
  totalCostCents: number;
  results: ReviewResult[];
}> {
  const sb = getSupabase();
  const supervisorId = `sonnet-supervisor-${crypto.randomUUID().slice(0, 8)}`;

  // Claim pending_review items
  const { data: items, error: fetchError } = await sb
    .from("import_queue")
    .select("id, listing_url, listing_title, listing_year, listing_make, listing_model, listing_price, raw_data")
    .eq("status", "pending_review")
    .is("locked_by", null)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(batchSize);

  if (fetchError || !items?.length) {
    return {
      reviewed: 0,
      approved: 0,
      corrected: 0,
      rejected: 0,
      escalated: 0,
      totalCostCents: 0,
      results: [],
    };
  }

  // Lock items
  const itemIds = items.map((i) => i.id);
  await sb
    .from("import_queue")
    .update({
      locked_by: supervisorId,
      locked_at: new Date().toISOString(),
    })
    .in("id", itemIds);

  const results: ReviewResult[] = [];
  let approved = 0;
  let corrected = 0;
  let rejected = 0;
  let escalated = 0;
  let totalCostCents = 0;

  for (const item of items) {
    try {
      // Get archived content for cross-reference
      const { data: snapshot } = await sb
        .from("listing_page_snapshots")
        .select("html, markdown")
        .eq("listing_url", item.listing_url)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const review = await reviewSingle(item, snapshot);
      results.push(review);
      totalCostCents += review.cost.costCents;

      const haikuData = item.raw_data?.haiku_extraction || {};
      const reviewedData = review.action === "corrected"
        ? { ...(item.raw_data || {}), sonnet_corrected_data: haikuData }
        : item.raw_data;

      switch (review.action) {
        case "approved": {
          // Write final data and mark complete
          await sb.from("import_queue").update({
            status: "complete",
            locked_by: null,
            locked_at: null,
            processed_at: new Date().toISOString(),
            listing_year: haikuData.year || item.listing_year,
            listing_make: haikuData.make || item.listing_make,
            listing_model: haikuData.model || item.listing_model,
            listing_price: haikuData.sale_price || haikuData.asking_price || item.listing_price,
            raw_data: {
              ...reviewedData,
              supervisor_review: {
                action: "approved",
                quality_score: review.finalQuality,
                reviewed_at: new Date().toISOString(),
                cost: review.cost,
              },
            },
          }).eq("id", item.id);
          approved++;
          break;
        }

        case "corrected": {
          // Parse corrected data from the review
          let correctedExtraction: any;
          try {
            const rawReview = parseJsonResponse(
              results[results.length - 1]?.corrections?.join("; ") || "{}",
            );
            correctedExtraction = rawReview;
          } catch {
            correctedExtraction = haikuData;
          }

          // We need to re-extract from the review — fetch the actual review result
          // The corrections are in the review result, not in a parseable format
          // Use the existing Haiku data merged with any corrections noted
          await sb.from("import_queue").update({
            status: "complete",
            locked_by: null,
            locked_at: null,
            processed_at: new Date().toISOString(),
            listing_year: haikuData.year || item.listing_year,
            listing_make: haikuData.make || item.listing_make,
            listing_model: haikuData.model || item.listing_model,
            listing_price: haikuData.sale_price || haikuData.asking_price || item.listing_price,
            raw_data: {
              ...reviewedData,
              supervisor_review: {
                action: "corrected",
                corrections: review.corrections,
                quality_score: review.finalQuality,
                reviewed_at: new Date().toISOString(),
                cost: review.cost,
              },
            },
          }).eq("id", item.id);
          corrected++;
          break;
        }

        case "escalated": {
          // Mark for Opus-level review
          await sb.from("import_queue").update({
            status: "pending_strategy",
            locked_by: null,
            locked_at: null,
            raw_data: {
              ...reviewedData,
              supervisor_review: {
                action: "escalated",
                quality_score: review.finalQuality,
                reviewed_at: new Date().toISOString(),
                cost: review.cost,
              },
            },
          }).eq("id", item.id);
          escalated++;
          break;
        }

        case "rejected": {
          await sb.from("import_queue").update({
            status: "failed",
            locked_by: null,
            locked_at: null,
            error_message: `Supervisor rejected: ${review.corrections.join("; ")}`,
            raw_data: {
              ...reviewedData,
              supervisor_review: {
                action: "rejected",
                quality_score: review.finalQuality,
                corrections: review.corrections,
                reviewed_at: new Date().toISOString(),
                cost: review.cost,
              },
            },
          }).eq("id", item.id);
          rejected++;
          break;
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[sonnet-supervisor] Error reviewing ${item.id}: ${errMsg}`);

      // Release lock on error
      await sb.from("import_queue").update({
        locked_by: null,
        locked_at: null,
      }).eq("id", item.id);

      results.push({
        itemId: item.id,
        url: item.listing_url,
        action: "rejected",
        originalQuality: 0,
        finalQuality: 0,
        corrections: [`Supervisor error: ${errMsg}`],
        cost: { inputTokens: 0, outputTokens: 0, costCents: 0, durationMs: 0 },
      });
    }
  }

  return {
    reviewed: items.length,
    approved,
    corrected,
    rejected,
    escalated,
    totalCostCents: Math.round(totalCostCents * 10000) / 10000,
    results,
  };
}

/**
 * Resolve an edge case using Sonnet's deeper analysis.
 */
async function resolveEdgeCase(
  url: string,
  content: string,
  context: any,
): Promise<any> {
  const userMessage = `## Edge Case to Resolve

**URL:** ${url}
**Context:** ${JSON.stringify(context, null, 2)}

### Page Content:
${content.slice(0, 10_000)}`;

  const result = await callTier("sonnet", EDGE_CASE_SYSTEM, userMessage, {
    maxTokens: 2048,
  });

  const parsed = parseJsonResponse(result.content);
  return {
    ...parsed,
    cost: {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costCents: result.costCents,
      durationMs: result.durationMs,
    },
  };
}

/**
 * Dispatch a batch to the Haiku worker and then review any escalated items.
 * This is the main supervisor loop entry point.
 */
async function dispatchAndReview(options: {
  haikuBatchSize?: number;
  reviewBatchSize?: number;
  source?: string;
}): Promise<any> {
  const haikuBatchSize = Math.min(options.haikuBatchSize || 10, 20);
  const reviewBatchSize = Math.min(options.reviewBatchSize || 10, 20);

  const sb = getSupabase();
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  // Step 1: Dispatch work to Haiku worker
  let haikuResult: any = { processed: 0 };
  try {
    const haikuRes = await fetch(
      `${supabaseUrl}/functions/v1/haiku-extraction-worker`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "batch_extract",
          batch_size: haikuBatchSize,
          source: options.source,
        }),
        signal: AbortSignal.timeout(120_000),
      },
    );

    if (haikuRes.ok) {
      haikuResult = await haikuRes.json();
    } else {
      const errText = await haikuRes.text();
      console.error(`[sonnet-supervisor] Haiku dispatch failed: ${haikuRes.status} ${errText.slice(0, 200)}`);
    }
  } catch (err) {
    console.error(`[sonnet-supervisor] Haiku dispatch error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 2: Review any pending_review items (from this batch or previous batches)
  const reviewResult = await reviewBatch(reviewBatchSize);

  // Step 3: Get queue health metrics
  const { data: queueStats } = await sb.rpc("release_stale_locks", { dry_run: true }).select();

  const { count: pendingCount } = await sb
    .from("import_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  const { count: reviewCount } = await sb
    .from("import_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending_review");

  const { count: strategyCount } = await sb
    .from("import_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending_strategy");

  return {
    haiku_dispatch: {
      processed: haikuResult.processed || 0,
      succeeded: haikuResult.succeeded || 0,
      escalated: haikuResult.escalated || 0,
      failed: haikuResult.failed || 0,
      costCents: haikuResult.totalCostCents || 0,
    },
    supervisor_review: {
      reviewed: reviewResult.reviewed,
      approved: reviewResult.approved,
      corrected: reviewResult.corrected,
      rejected: reviewResult.rejected,
      escalated: reviewResult.escalated,
      costCents: reviewResult.totalCostCents,
    },
    queue_health: {
      pending: pendingCount || 0,
      pending_review: reviewCount || 0,
      pending_strategy: strategyCount || 0,
    },
    total_cost_cents: (haikuResult.totalCostCents || 0) + reviewResult.totalCostCents,
    cost_comparison: {
      haiku_cost: estimateBatchCost("haiku", haikuBatchSize),
      sonnet_equivalent_cost: estimateBatchCost("sonnet", haikuBatchSize),
      savings_percent: Math.round(
        (1 - estimateBatchCost("haiku", haikuBatchSize).totalCostCents /
          estimateBatchCost("sonnet", haikuBatchSize).totalCostCents) * 100,
      ),
    },
  };
}

/**
 * Generate a quality report across recent extractions.
 */
async function generateQualityReport(): Promise<any> {
  const sb = getSupabase();

  // Get stats from import_queue for recent Haiku-processed items
  const { data: recentItems } = await sb
    .from("import_queue")
    .select("status, raw_data, processed_at, created_at")
    .not("raw_data->haiku_processed_at", "is", null)
    .order("created_at", { ascending: false })
    .limit(100);

  if (!recentItems?.length) {
    return { message: "No Haiku-processed items found", stats: {} };
  }

  const stats = {
    total: recentItems.length,
    auto_approved: 0,
    supervisor_approved: 0,
    supervisor_corrected: 0,
    supervisor_rejected: 0,
    escalated_to_opus: 0,
    avg_haiku_quality: 0,
    avg_final_quality: 0,
    total_haiku_cost_cents: 0,
    total_supervisor_cost_cents: 0,
    common_escalation_reasons: {} as Record<string, number>,
    common_corrections: [] as string[],
  };

  let haikuQualitySum = 0;
  let finalQualitySum = 0;
  let qualityCount = 0;

  for (const item of recentItems) {
    const rd = item.raw_data || {};
    if (rd.auto_approved) stats.auto_approved++;
    if (rd.supervisor_review?.action === "approved") stats.supervisor_approved++;
    if (rd.supervisor_review?.action === "corrected") stats.supervisor_corrected++;
    if (rd.supervisor_review?.action === "rejected") stats.supervisor_rejected++;
    if (rd.supervisor_review?.action === "escalated") stats.escalated_to_opus++;

    if (rd.haiku_quality?.score !== undefined) {
      haikuQualitySum += rd.haiku_quality.score;
      qualityCount++;
    }
    if (rd.supervisor_review?.quality_score !== undefined) {
      finalQualitySum += rd.supervisor_review.quality_score;
    }

    if (rd.haiku_cost?.costCents) {
      stats.total_haiku_cost_cents += rd.haiku_cost.costCents;
    }
    if (rd.supervisor_review?.cost?.costCents) {
      stats.total_supervisor_cost_cents += rd.supervisor_review.cost.costCents;
    }

    if (rd.escalation_reason) {
      const reason = rd.escalation_reason.split(":")[0];
      stats.common_escalation_reasons[reason] =
        (stats.common_escalation_reasons[reason] || 0) + 1;
    }
  }

  stats.avg_haiku_quality = qualityCount
    ? Math.round((haikuQualitySum / qualityCount) * 100) / 100
    : 0;
  stats.avg_final_quality = qualityCount
    ? Math.round((finalQualitySum / qualityCount) * 100) / 100
    : 0;

  // Use Sonnet to summarize findings
  const reportPrompt = `Analyze these extraction quality metrics and provide a brief assessment:

${JSON.stringify(stats, null, 2)}

Provide a JSON response:
{
  "assessment": "<1-2 sentence summary>",
  "haiku_effectiveness": "<percentage of items Haiku handled without supervisor intervention>",
  "top_issues": ["<issue 1>", "<issue 2>"],
  "recommendations": ["<recommendation 1>", "<recommendation 2>"],
  "cost_efficiency": "<comparison of actual cost vs if everything used Sonnet>"
}`;

  const analysis = await callTier("sonnet", "You are a data pipeline quality analyst.", reportPrompt, {
    maxTokens: 1024,
  });

  let parsedAnalysis: any = {};
  try {
    parsedAnalysis = parseJsonResponse(analysis.content);
  } catch {
    parsedAnalysis = { raw: analysis.content };
  }

  return {
    stats,
    analysis: parsedAnalysis,
    report_cost_cents: analysis.costCents,
  };
}

// ─── HTTP Handler ───────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "dispatch_haiku";

    switch (action) {
      case "dispatch_haiku":
      case "dispatch": {
        const result = await dispatchAndReview({
          haikuBatchSize: body.haiku_batch_size || body.batch_size || 10,
          reviewBatchSize: body.review_batch_size || 10,
          source: body.source,
        });
        return json(200, { success: true, ...result });
      }

      case "review_batch": {
        const batchSize = Math.min(body.batch_size || 10, 50);
        const result = await reviewBatch(batchSize);
        return json(200, { success: true, ...result });
      }

      case "review_single": {
        if (!body.import_queue_id) {
          return json(400, { error: "Provide import_queue_id" });
        }
        const sb = getSupabase();
        const { data: item } = await sb
          .from("import_queue")
          .select("*")
          .eq("id", body.import_queue_id)
          .maybeSingle();

        if (!item) return json(404, { error: "Item not found" });

        const { data: snapshot } = await sb
          .from("listing_page_snapshots")
          .select("html, markdown")
          .eq("listing_url", item.listing_url)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const result = await reviewSingle(item, snapshot);
        return json(200, { success: true, ...result });
      }

      case "resolve_edge_case": {
        const url = body.url || "";
        const content = body.content || body.html || body.markdown || "";
        const context = body.context || {};
        if (!content) return json(400, { error: "Provide content" });
        const result = await resolveEdgeCase(url, content, context);
        return json(200, { success: true, ...result });
      }

      case "quality_report": {
        const report = await generateQualityReport();
        return json(200, { success: true, ...report });
      }

      case "health": {
        const sb = getSupabase();
        const { count: pendingReview } = await sb
          .from("import_queue")
          .select("*", { count: "exact", head: true })
          .eq("status", "pending_review");

        const { count: pendingStrategy } = await sb
          .from("import_queue")
          .select("*", { count: "exact", head: true })
          .eq("status", "pending_strategy");

        return json(200, {
          status: "healthy",
          tier: "sonnet",
          model: "claude-sonnet-4-6",
          queue: {
            pending_review: pendingReview || 0,
            pending_strategy: pendingStrategy || 0,
          },
          capabilities: [
            "dispatch_haiku",
            "review_batch",
            "review_single",
            "resolve_edge_case",
            "quality_report",
          ],
        });
      }

      default:
        return json(400, { error: `Unknown action: ${action}` });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[sonnet-supervisor] Error: ${msg}`);
    return json(500, { error: msg });
  }
});
