/**
 * Agent Tier Router
 *
 * Top-level entry point for the agent hierarchy. Routes tasks to the
 * appropriate tier based on complexity, and provides the Opus strategy
 * layer for high-level decisions.
 *
 * Architecture:
 *   agent-tier-router (this function)
 *     -> haiku-extraction-worker  (routine extraction)
 *     -> sonnet-supervisor        (quality review + dispatch)
 *     -> opus strategy            (inline — source prioritization, market intel)
 *
 * POST body:
 * {
 *   action: "route_task" | "run_pipeline" | "strategy" | "status" | "cost_report",
 *   task_type?: string,      // for route_task
 *   task_data?: any,         // for route_task
 *   pipeline_config?: {      // for run_pipeline
 *     haiku_batch_size?: number,
 *     review_batch_size?: number,
 *     source?: string,
 *     max_cycles?: number,   // run multiple dispatch+review cycles
 *   },
 *   strategy_query?: string, // for strategy (Opus)
 * }
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  callTier,
  classifyTaskTier,
  parseJsonResponse,
  estimateBatchCost,
  TIER_CONFIGS,
  QUALITY_THRESHOLDS,
  type AgentTier,
} from "../_shared/agentTiers.ts";

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

async function callFunction(name: string, body: any, timeoutMs = 120_000): Promise<any> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

// ─── Opus Strategy Layer ────────────────────────────────────────────

const OPUS_STRATEGY_SYSTEM = `You are the strategic intelligence layer of a vehicle data extraction platform called Nuke.

Platform context:
- 18,000+ vehicles in the database, 33M+ images, growing daily
- Sources: Bring a Trailer, Cars & Bids, Craigslist, eBay Motors, Mecum, Barrett-Jackson, RM Sotheby's, Facebook Marketplace, and more
- Three-tier agent system: Haiku (cheap extraction), Sonnet (quality review), Opus (you — strategy)
- YONO: Local vision model for vehicle classification (EfficientNet, ONNX)
- Revenue model: SDK-based (@nuke1/sdk) with vehicle intelligence API

Your role:
1. Prioritize which sources to extract from based on data value and cost
2. Identify market intelligence opportunities
3. Decide when YONO needs retraining based on classification accuracy drift
4. Optimize the extraction pipeline for cost/quality tradeoff
5. Identify cross-source deduplication opportunities

Respond with structured JSON including:
{
  "analysis": "<your strategic assessment>",
  "recommendations": [{"priority": "P0|P1|P2", "action": "<what to do>", "rationale": "<why>"}],
  "source_priorities": [{"source": "<name>", "priority": 1-10, "reason": "<why>"}],
  "cost_optimization": {"current_estimate_daily": <cents>, "optimized_estimate_daily": <cents>, "changes": ["<change>"]},
  "yono_recommendation": {"retrain": <boolean>, "reason": "<why>", "dataset_size_needed": <number>}
}`;

async function runStrategy(query: string, contextData?: any): Promise<any> {
  const sb = getSupabase();

  // Gather platform stats for context
  let platformContext = "";
  try {
    // Queue stats
    const { count: pending } = await sb
      .from("import_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");

    const { count: pendingReview } = await sb
      .from("import_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending_review");

    const { count: completed } = await sb
      .from("import_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "complete");

    const { count: failed } = await sb
      .from("import_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "failed");

    // Vehicle counts
    const { count: vehicleCount } = await sb
      .from("vehicles")
      .select("*", { count: "exact", head: true });

    platformContext = `
## Current Platform State
- Vehicles in DB: ${vehicleCount || "unknown"}
- Import queue: ${pending || 0} pending, ${pendingReview || 0} pending review, ${completed || 0} completed, ${failed || 0} failed
- Agent hierarchy: Haiku workers (extraction) -> Sonnet supervisor (quality) -> Opus strategy (you)
- Cost targets: <$50/day for extraction pipeline
`;
  } catch {
    platformContext = "\n## Platform stats unavailable\n";
  }

  const userMessage = `${platformContext}

## Strategic Query
${query}

${contextData ? `## Additional Context\n${JSON.stringify(contextData, null, 2)}` : ""}`;

  const result = await callTier("opus", OPUS_STRATEGY_SYSTEM, userMessage, {
    maxTokens: 4096,
  });

  let parsed: any;
  try {
    parsed = parseJsonResponse(result.content);
  } catch {
    parsed = { raw_analysis: result.content };
  }

  return {
    strategy: parsed,
    cost: {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costCents: result.costCents,
      durationMs: result.durationMs,
      tier: "opus",
    },
  };
}

// ─── Pipeline Runner ────────────────────────────────────────────────

/**
 * Run the full extraction pipeline:
 * 1. Haiku processes pending items
 * 2. Sonnet reviews escalated items
 * 3. Report results
 *
 * Can run multiple cycles for continuous processing.
 */
async function runPipeline(config: {
  haikuBatchSize?: number;
  reviewBatchSize?: number;
  source?: string;
  maxCycles?: number;
}): Promise<any> {
  const maxCycles = Math.min(config.maxCycles || 1, 5);
  const cycles: any[] = [];
  let totalCostCents = 0;
  const startTime = Date.now();

  for (let cycle = 0; cycle < maxCycles; cycle++) {
    console.log(`[agent-tier-router] Pipeline cycle ${cycle + 1}/${maxCycles}`);

    // Dispatch to supervisor, which in turn dispatches to Haiku and then reviews
    const result = await callFunction("sonnet-supervisor", {
      action: "dispatch_haiku",
      haiku_batch_size: config.haikuBatchSize || 10,
      review_batch_size: config.reviewBatchSize || 10,
      source: config.source,
    });

    if (result.ok && result.data) {
      cycles.push({
        cycle: cycle + 1,
        ...result.data,
      });
      totalCostCents += result.data.total_cost_cents || 0;

      // If no work was done in this cycle, stop early
      const haikuProcessed = result.data.haiku_dispatch?.processed || 0;
      const reviewProcessed = result.data.supervisor_review?.reviewed || 0;
      if (haikuProcessed === 0 && reviewProcessed === 0) {
        console.log(`[agent-tier-router] No work in cycle ${cycle + 1}, stopping`);
        break;
      }
    } else {
      cycles.push({
        cycle: cycle + 1,
        error: result.data?.error || `HTTP ${result.status}`,
      });
      break; // Stop on error
    }
  }

  const durationMs = Date.now() - startTime;

  return {
    cycles_run: cycles.length,
    cycles,
    total_cost_cents: Math.round(totalCostCents * 10000) / 10000,
    duration_ms: durationMs,
    items_per_second: cycles.reduce(
      (sum, c) => sum + (c.haiku_dispatch?.processed || 0),
      0,
    ) / (durationMs / 1000),
  };
}

// ─── Task Router ────────────────────────────────────────────────────

async function routeTask(
  taskType: string,
  taskData: any,
  context?: any,
): Promise<any> {
  const tier = classifyTaskTier(taskType, context);

  switch (tier) {
    case "haiku": {
      const result = await callFunction("haiku-extraction-worker", {
        action: taskType === "parse_title" ? "parse_title" : "extract_listing",
        ...taskData,
      });
      return {
        tier: "haiku",
        routed_to: "haiku-extraction-worker",
        result: result.data,
      };
    }

    case "sonnet": {
      if (taskType === "quality_review") {
        const result = await callFunction("sonnet-supervisor", {
          action: "review_single",
          ...taskData,
        });
        return {
          tier: "sonnet",
          routed_to: "sonnet-supervisor",
          result: result.data,
        };
      }

      if (taskType === "edge_case_resolution") {
        const result = await callFunction("sonnet-supervisor", {
          action: "resolve_edge_case",
          ...taskData,
        });
        return {
          tier: "sonnet",
          routed_to: "sonnet-supervisor",
          result: result.data,
        };
      }

      // Default Sonnet task
      const result = await callTier("sonnet", "You are a vehicle data analyst.", JSON.stringify(taskData), {
        maxTokens: 4096,
      });
      return {
        tier: "sonnet",
        routed_to: "inline_sonnet",
        result: { content: result.content, cost: result.costCents },
      };
    }

    case "opus": {
      const result = await runStrategy(
        taskData.query || JSON.stringify(taskData),
        context,
      );
      return {
        tier: "opus",
        routed_to: "inline_opus",
        result,
      };
    }
  }
}

// ─── Status & Cost Reporting ────────────────────────────────────────

async function getSystemStatus(): Promise<any> {
  const sb = getSupabase();

  // Queue breakdown
  const statuses = ["pending", "processing", "pending_review", "pending_strategy", "complete", "failed"];
  const queueStats: Record<string, number> = {};

  for (const status of statuses) {
    const { count } = await sb
      .from("import_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", status);
    queueStats[status] = count || 0;
  }

  // Check tier health
  const [haikuHealth, supervisorHealth] = await Promise.allSettled([
    callFunction("haiku-extraction-worker", { action: "health" }, 10_000),
    callFunction("sonnet-supervisor", { action: "health" }, 10_000),
  ]);

  return {
    queue: queueStats,
    tiers: {
      haiku: {
        status: haikuHealth.status === "fulfilled" && haikuHealth.value.ok
          ? "healthy"
          : "unhealthy",
        details: haikuHealth.status === "fulfilled"
          ? haikuHealth.value.data
          : (haikuHealth as PromiseRejectedResult).reason?.message,
      },
      sonnet: {
        status: supervisorHealth.status === "fulfilled" && supervisorHealth.value.ok
          ? "healthy"
          : "unhealthy",
        details: supervisorHealth.status === "fulfilled"
          ? supervisorHealth.value.data
          : (supervisorHealth as PromiseRejectedResult).reason?.message,
      },
      opus: { status: "available", model: TIER_CONFIGS.opus.model },
    },
    cost_estimates: {
      haiku_per_100_items: estimateBatchCost("haiku", 100),
      sonnet_per_100_items: estimateBatchCost("sonnet", 100),
      opus_per_query: estimateBatchCost("opus", 1, 3000, 1000),
    },
    thresholds: QUALITY_THRESHOLDS,
  };
}

async function getCostReport(): Promise<any> {
  const sb = getSupabase();

  // Get recent items with cost data
  const { data: recentItems } = await sb
    .from("import_queue")
    .select("raw_data, processed_at, status")
    .not("raw_data->haiku_cost", "is", null)
    .order("processed_at", { ascending: false })
    .limit(200);

  if (!recentItems?.length) {
    return { message: "No cost data available yet" };
  }

  let totalHaikuCost = 0;
  let totalSonnetCost = 0;
  let haikuCalls = 0;
  let sonnetCalls = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const item of recentItems) {
    const rd = item.raw_data || {};
    if (rd.haiku_cost) {
      totalHaikuCost += rd.haiku_cost.costCents || 0;
      totalInputTokens += rd.haiku_cost.inputTokens || 0;
      totalOutputTokens += rd.haiku_cost.outputTokens || 0;
      haikuCalls++;
    }
    if (rd.supervisor_review?.cost) {
      totalSonnetCost += rd.supervisor_review.cost.costCents || 0;
      totalInputTokens += rd.supervisor_review.cost.inputTokens || 0;
      totalOutputTokens += rd.supervisor_review.cost.outputTokens || 0;
      sonnetCalls++;
    }
  }

  const totalCost = totalHaikuCost + totalSonnetCost;
  const avgCostPerItem = totalCost / recentItems.length;

  // What it would have cost with Sonnet for everything
  const sonnetOnlyCost = estimateBatchCost(
    "sonnet",
    haikuCalls,
    totalInputTokens / Math.max(haikuCalls, 1),
    totalOutputTokens / Math.max(haikuCalls, 1),
  );

  return {
    period: `Last ${recentItems.length} items`,
    haiku: {
      calls: haikuCalls,
      total_cost_cents: Math.round(totalHaikuCost * 10000) / 10000,
      avg_cost_per_call: Math.round((totalHaikuCost / Math.max(haikuCalls, 1)) * 10000) / 10000,
    },
    sonnet: {
      calls: sonnetCalls,
      total_cost_cents: Math.round(totalSonnetCost * 10000) / 10000,
      avg_cost_per_call: Math.round((totalSonnetCost / Math.max(sonnetCalls, 1)) * 10000) / 10000,
    },
    combined: {
      total_cost_cents: Math.round(totalCost * 10000) / 10000,
      avg_cost_per_item: Math.round(avgCostPerItem * 10000) / 10000,
      total_tokens: {
        input: totalInputTokens,
        output: totalOutputTokens,
      },
    },
    savings: {
      sonnet_only_equivalent_cents: sonnetOnlyCost.totalCostCents,
      actual_cost_cents: Math.round(totalCost * 100) / 100,
      saved_cents: Math.round((sonnetOnlyCost.totalCostCents - totalCost) * 100) / 100,
      saved_percent: Math.round(
        (1 - totalCost / Math.max(sonnetOnlyCost.totalCostCents, 0.01)) * 100,
      ),
    },
  };
}

// ─── HTTP Handler ───────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "status";

    switch (action) {
      case "route_task": {
        if (!body.task_type) {
          return json(400, { error: "Provide task_type" });
        }
        const result = await routeTask(body.task_type, body.task_data || {}, body.context);
        return json(200, { success: true, ...result });
      }

      case "run_pipeline": {
        const config = body.pipeline_config || body;
        const result = await runPipeline({
          haikuBatchSize: config.haiku_batch_size || config.batch_size || 10,
          reviewBatchSize: config.review_batch_size || 10,
          source: config.source,
          maxCycles: config.max_cycles || 1,
        });
        return json(200, { success: true, ...result });
      }

      case "strategy": {
        if (!body.strategy_query) {
          return json(400, { error: "Provide strategy_query" });
        }
        const result = await runStrategy(body.strategy_query, body.context);
        return json(200, { success: true, ...result });
      }

      case "status": {
        const status = await getSystemStatus();
        return json(200, { success: true, ...status });
      }

      case "cost_report": {
        const report = await getCostReport();
        return json(200, { success: true, ...report });
      }

      case "health": {
        return json(200, {
          status: "healthy",
          component: "agent-tier-router",
          tiers: Object.entries(TIER_CONFIGS).map(([name, config]) => ({
            name,
            model: config.model,
            cost_per_1m_input: config.costPerInputMTok,
            cost_per_1m_output: config.costPerOutputMTok,
          })),
          actions: [
            "route_task",
            "run_pipeline",
            "strategy",
            "status",
            "cost_report",
            "health",
          ],
        });
      }

      default:
        return json(400, { error: `Unknown action: ${action}` });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[agent-tier-router] Error: ${msg}`);
    return json(500, { error: msg });
  }
});
