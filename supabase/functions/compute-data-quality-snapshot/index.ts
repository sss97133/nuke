/**
 * COMPUTE DATA QUALITY SNAPSHOT
 *
 * Samples 3% of vehicles, computes field completion rates, stores in data_quality_snapshots.
 * Called every 10 minutes by pg_cron.
 *
 * POST /functions/v1/compute-data-quality-snapshot
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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Get field stats via the DB function (TABLESAMPLE 3%)
    const { data: fieldStatsData, error: fieldStatsError } = await supabase
      .rpc("get_data_quality_field_stats");

    if (fieldStatsError) {
      throw new Error(`Field stats query failed: ${fieldStatsError.message}`);
    }

    const sampleSize = fieldStatsData?.sample_size ?? 0;
    const totalVehicles = fieldStatsData?.total_vehicles ?? null;
    const fieldStats: Record<string, number> = {};

    // Extract all fields except sample_size and total_vehicles
    for (const [key, val] of Object.entries(fieldStatsData || {})) {
      if (key !== "sample_size" && key !== "total_vehicles") {
        fieldStats[key] = Number(val) || 0;
      }
    }

    // 3. Get pipeline stats from cron job run details via get_pipeline_cron_stats()
    // Returns jobname, active, schedule, last_start_time, last_status, etc.
    let pipelineStats: {
      active_jobs: Array<{
        jobname: string;
        active: boolean;
        schedule: string;
        last_start_time: string | null;
        last_end_time: string | null;
        last_status: string | null;
        last_return_message: string | null;
      }>;
    } = { active_jobs: [] };

    try {
      const { data: cronJobs, error: cronError } = await supabase
        .rpc("get_pipeline_cron_stats");
      if (!cronError && cronJobs) {
        pipelineStats.active_jobs = cronJobs;
      } else if (cronError) {
        console.warn("Could not fetch cron stats:", cronError.message);
      }
    } catch (e) {
      // cron schema not accessible — pipeline_stats will be sparse
      console.warn("Could not fetch cron stats:", e);
    }

    // 4. Compute workforce strategy list (static config, reflects enrichment priority order)
    const workforceStatus = {
      strategies: [
        { name: "batch-vin-decode", priority: 1, cost: "free", description: "NHTSA VIN decode → 12 fields" },
        { name: "batch-ymm-propagate", priority: 2, cost: "free", description: "Propagate specs to YMM siblings" },
        { name: "enrich-bulk:mine_descriptions", priority: 3, cost: "free", description: "Regex harvest from listing text" },
        { name: "enrich-bulk:derive_fields", priority: 4, cost: "free", description: "Compute decade/country/body_style" },
        { name: "enrich-factory-specs", priority: 5, cost: "llm", description: "LLM factory spec recall → 39 fields" },
        { name: "enrich-vehicle-profile-ai", priority: 6, cost: "llm", description: "LLM from archived listing HTML" },
        { name: "compute-vehicle-valuation", priority: 7, cost: "free", description: "Nuke estimate + deal/heat/signal scores" },
      ],
      captured_at: new Date().toISOString(),
    };

    // 5. Insert snapshot row
    const { data: snapshot, error: insertError } = await supabase
      .from("data_quality_snapshots")
      .insert({
        sample_size: sampleSize,
        total_vehicles: totalVehicles,
        field_stats: fieldStats,
        pipeline_stats: pipelineStats,
        workforce_status: workforceStatus,
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Failed to insert snapshot: ${insertError.message}`);
    }

    // 6. Clean up old snapshots (>7 days)
    const { error: cleanupError } = await supabase
      .rpc("cleanup_old_quality_snapshots");
    if (cleanupError) {
      // Non-fatal — log and continue
      console.warn("Cleanup error:", cleanupError.message);
    }

    // 7. Get 1-hour-ago snapshot for delta comparison
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: oldSnapshots } = await supabase
      .from("data_quality_snapshots")
      .select("field_stats, captured_at")
      .lt("captured_at", oneHourAgo)
      .order("captured_at", { ascending: false })
      .limit(1);

    let delta1h: Record<string, number> = {};
    if (oldSnapshots && oldSnapshots.length > 0) {
      const oldStats = oldSnapshots[0].field_stats as Record<string, number>;
      for (const [field, pct] of Object.entries(fieldStats)) {
        const oldPct = oldStats?.[field] ?? pct;
        delta1h[field] = Math.round((pct - oldPct) * 10) / 10;
      }
    }

    return new Response(
      JSON.stringify({
        snapshot,
        delta_1h: delta1h,
        message: `Snapshot captured. Sample: ${Number(sampleSize).toLocaleString()} vehicles. Total: ${(totalVehicles || 0).toLocaleString()}.`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("compute-data-quality-snapshot error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
