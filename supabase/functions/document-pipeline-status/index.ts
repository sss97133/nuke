/**
 * Document Pipeline Status — Monitoring dashboard for the OCR pipeline
 *
 * Returns queue health, throughput metrics, entity creation counts,
 * cost breakdown, and error reporting.
 *
 * Follows the ralph-wiggum-rlm-extraction-coordinator brief mode pattern.
 *
 * POST /functions/v1/document-pipeline-status
 * { "mode": "brief" | "detailed" | "errors" | "cost" }
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ─── QUEUE COUNTS ──────────────────────────────────────────────────────────

async function getQueueCounts(): Promise<Record<string, number>> {
  const statuses = ["pending", "classifying", "extracting", "linking", "complete", "failed", "skipped"];
  const counts: Record<string, number> = {};

  for (const s of statuses) {
    const { count } = await supabase
      .from("document_ocr_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", s);
    counts[s] = count || 0;
  }

  counts.total = Object.values(counts).reduce((a, b) => a + b, 0);
  return counts;
}

// ─── THROUGHPUT METRICS ────────────────────────────────────────────────────

async function getThroughput(): Promise<any> {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  // Completed in last hour
  const { count: lastHour } = await supabase
    .from("document_ocr_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", "complete")
    .gte("updated_at", oneHourAgo);

  // Completed in last 24 hours
  const { count: last24h } = await supabase
    .from("document_ocr_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", "complete")
    .gte("updated_at", twentyFourHoursAgo);

  // Failed in last hour
  const { count: failedLastHour } = await supabase
    .from("document_ocr_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", "failed")
    .gte("updated_at", oneHourAgo);

  // Stale locks (locked > 5 minutes ago)
  const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  const { count: staleLocks } = await supabase
    .from("document_ocr_queue")
    .select("*", { count: "exact", head: true })
    .not("locked_at", "is", null)
    .lt("locked_at", fiveMinAgo);

  return {
    last_hour: lastHour || 0,
    last_24h: last24h || 0,
    rate_per_hour: lastHour || 0,
    projected_daily: (lastHour || 0) * 24,
    failed_last_hour: failedLastHour || 0,
    stale_locks: staleLocks || 0,
  };
}

// ─── ENTITY CREATION STATS ─────────────────────────────────────────────────

async function getEntityStats(): Promise<any> {
  // Vehicles created by OCR pipeline
  const { count: vehiclesCreated } = await supabase
    .from("vehicles")
    .select("*", { count: "exact", head: true })
    .eq("source", "deal_jacket_ocr");

  // Organizations created by OCR pipeline
  const { count: orgsCreated } = await supabase
    .from("organizations")
    .select("*", { count: "exact", head: true })
    .eq("source", "deal_jacket_ocr");

  // Observations from OCR pipeline
  const { data: ocrSource } = await supabase
    .from("observation_sources")
    .select("id")
    .eq("slug", "deal-jacket-ocr")
    .maybeSingle();

  let observationsCreated = 0;
  if (ocrSource) {
    const { count } = await supabase
      .from("vehicle_observations")
      .select("*", { count: "exact", head: true })
      .eq("source_id", ocrSource.id);
    observationsCreated = count || 0;
  }

  // Documents with linked vehicles
  const { count: vehiclesLinked } = await supabase
    .from("document_ocr_queue")
    .select("*", { count: "exact", head: true })
    .not("linked_vehicle_id", "is", null);

  return {
    vehicles_created: vehiclesCreated || 0,
    vehicles_linked: vehiclesLinked || 0,
    organizations_created: orgsCreated || 0,
    observations_created: observationsCreated,
  };
}

// ─── COST BREAKDOWN ────────────────────────────────────────────────────────

async function getCostBreakdown(): Promise<any> {
  // Total cost from queue
  const { data: queueCosts } = await supabase
    .from("document_ocr_queue")
    .select("extraction_cost_usd, extraction_provider")
    .eq("status", "complete")
    .not("extraction_cost_usd", "is", null);

  const byProvider: Record<string, { count: number; cost: number }> = {};
  let totalCost = 0;

  for (const row of queueCosts || []) {
    const provider = row.extraction_provider || "unknown";
    if (!byProvider[provider]) byProvider[provider] = { count: 0, cost: 0 };
    byProvider[provider].count++;
    byProvider[provider].cost += row.extraction_cost_usd || 0;
    totalCost += row.extraction_cost_usd || 0;
  }

  // Recent daily costs from tracking table
  const { data: dailyCosts } = await supabase
    .from("document_pipeline_cost_summary")
    .select("*")
    .limit(7);

  return {
    total_cost_usd: Math.round(totalCost * 100) / 100,
    by_provider: byProvider,
    avg_cost_per_doc: (queueCosts?.length || 0) > 0
      ? Math.round(totalCost / (queueCosts?.length || 1) * 10000) / 10000
      : 0,
    daily_breakdown: dailyCosts || [],
  };
}

// ─── DOCUMENT TYPE DISTRIBUTION ────────────────────────────────────────────

async function getDocTypeDistribution(): Promise<Record<string, number>> {
  const { data: docs } = await supabase
    .from("document_ocr_queue")
    .select("document_type")
    .in("status", ["complete", "skipped"])
    .not("document_type", "is", null);

  const dist: Record<string, number> = {};
  for (const doc of docs || []) {
    const t = doc.document_type || "unknown";
    dist[t] = (dist[t] || 0) + 1;
  }

  return dist;
}

// ─── TOP ERRORS ────────────────────────────────────────────────────────────

async function getTopErrors(): Promise<any[]> {
  const { data: errors } = await supabase
    .from("document_ocr_queue")
    .select("id, error_message, attempts, storage_path, updated_at")
    .eq("status", "failed")
    .order("updated_at", { ascending: false })
    .limit(20);

  // Group by error message pattern
  const patterns: Record<string, { count: number; latest: string; example_id: string }> = {};
  for (const err of errors || []) {
    const msg = (err.error_message || "unknown").substring(0, 100);
    if (!patterns[msg]) {
      patterns[msg] = { count: 0, latest: err.updated_at, example_id: err.id };
    }
    patterns[msg].count++;
  }

  return Object.entries(patterns)
    .map(([msg, info]) => ({ error: msg, ...info }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

// ─── MAIN HANDLER ──────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body.mode || "brief";

    if (mode === "brief") {
      const [counts, throughput, entities] = await Promise.all([
        getQueueCounts(),
        getThroughput(),
        getEntityStats(),
      ]);

      const progressPct = counts.total > 0
        ? Math.round(((counts.complete + counts.skipped) / counts.total) * 100)
        : 0;

      return json({
        status: "ok",
        progress: `${progressPct}% (${counts.complete + counts.skipped}/${counts.total})`,
        queue: counts,
        throughput: {
          last_hour: throughput.last_hour,
          rate: `${throughput.rate_per_hour}/hr`,
          eta_hours: throughput.rate_per_hour > 0
            ? Math.round(counts.pending / throughput.rate_per_hour)
            : null,
        },
        entities,
        health: {
          stale_locks: throughput.stale_locks,
          failure_rate: throughput.last_hour > 0
            ? `${Math.round(throughput.failed_last_hour / throughput.last_hour * 100)}%`
            : "n/a",
        },
        duration_ms: Date.now() - startTime,
      });
    }

    if (mode === "detailed") {
      const [counts, throughput, entities, costs, docTypes, errors] = await Promise.all([
        getQueueCounts(),
        getThroughput(),
        getEntityStats(),
        getCostBreakdown(),
        getDocTypeDistribution(),
        getTopErrors(),
      ]);

      return json({
        queue: counts,
        throughput,
        entities,
        costs,
        document_types: docTypes,
        top_errors: errors,
        duration_ms: Date.now() - startTime,
      });
    }

    if (mode === "errors") {
      const errors = await getTopErrors();
      return json({ errors, duration_ms: Date.now() - startTime });
    }

    if (mode === "cost") {
      const costs = await getCostBreakdown();
      return json({ ...costs, duration_ms: Date.now() - startTime });
    }

    return json({ error: "Unknown mode. Use: brief, detailed, errors, cost" }, 400);
  } catch (err) {
    console.error("Status error:", err);
    return json({ error: (err as Error).message, duration_ms: Date.now() - startTime }, 500);
  }
});

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
