/**
 * data-quality-monitor
 *
 * Computes per-source data quality metrics and writes snapshots to
 * source_quality_snapshots. Designed to run daily via cron.
 *
 * Actions:
 *   POST { action: "snapshot" }   — compute + store current quality snapshot
 *   POST { action: "report" }     — return current quality without storing
 *   POST { action: "alerts" }     — return only sources below threshold
 *   POST { action: "backfill" }   — run one batch of quality score backfill
 *
 * Quality grades:
 *   A ≥ 95% YMM   B ≥ 85%   C ≥ 70%   D ≥ 50%   F < 50%
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Sources we care about monitoring (skip tiny/test sources)
const MIN_VEHICLES_TO_MONITOR = 50;

// Alert thresholds
const THRESHOLDS = {
  ymm_critical: 50,   // < 50% YMM → critical alert
  ymm_warning: 80,    // < 80% YMM → warning
  bad_vin_pct: 15,    // > 15% bad VINs → alert
  junk_price_pct: 10, // > 10% junk prices → alert
  model_polluted_pct: 5, // > 5% model > 80 chars → alert
};

function gradeFromYmm(ymmPct: number): string {
  if (ymmPct >= 95) return "A";
  if (ymmPct >= 85) return "B";
  if (ymmPct >= 70) return "C";
  if (ymmPct >= 50) return "D";
  return "F";
}

const QUALITY_SQL = `
  SELECT
    COALESCE(discovery_source, '__unknown__') AS source_name,
    COUNT(*) AS total_vehicles,
    -- YMM coverage
    ROUND(100.0 * COUNT(*) FILTER (
      WHERE year IS NOT NULL AND year >= 1885 AND year <= 2027
        AND make IS NOT NULL AND make <> ''
        AND model IS NOT NULL AND model <> '' AND length(model) <= 80
    ) / COUNT(*), 2) AS ymm_coverage_pct,
    -- VIN validity (1981+ only)
    ROUND(100.0 * COUNT(*) FILTER (WHERE vin IS NOT NULL AND length(vin) = 17 AND year >= 1981)
      / NULLIF(COUNT(*) FILTER (WHERE year >= 1981), 0), 2) AS vin_valid_pct,
    -- Price validity
    ROUND(100.0 * COUNT(*) FILTER (WHERE sale_price IS NOT NULL AND sale_price >= 100)
      / COUNT(*), 2) AS price_valid_pct,
    -- Avg quality score
    ROUND(AVG(data_quality_score)::NUMERIC, 3) AS avg_quality_score,
    -- Null counts
    COUNT(*) FILTER (WHERE year IS NULL) AS null_year_count,
    COUNT(*) FILTER (WHERE make IS NULL OR make = '') AS null_make_count,
    COUNT(*) FILTER (WHERE model IS NULL OR model = '' OR length(model) > 80) AS null_or_bad_model_count,
    -- Pollution counts
    COUNT(*) FILTER (WHERE length(model) > 80 AND model IS NOT NULL) AS model_polluted_count,
    COUNT(*) FILTER (WHERE sale_price IS NOT NULL AND sale_price < 100) AS junk_price_count,
    COUNT(*) FILTER (WHERE vin IS NOT NULL AND length(vin) != 17 AND year IS NOT NULL AND year >= 1981) AS bad_vin_count
  FROM vehicles
  WHERE status != 'deleted'
  GROUP BY COALESCE(discovery_source, '__unknown__')
  HAVING COUNT(*) >= ${MIN_VEHICLES_TO_MONITOR}
  ORDER BY total_vehicles DESC
`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const body = await req.json().catch(() => ({}));
  const action = body.action ?? "report";

  try {
    // ── Backfill action — run one batch of quality score computation
    if (action === "backfill") {
      const batchSize = Math.min(body.batch_size ?? 5000, 10000);
      const { data, error } = await supabase.rpc("execute_sql", {
        query: `SELECT backfill_vehicle_quality_scores(${batchSize}) AS updated`,
      });
      if (error) throw error;
      const updated = (data as any[])?.[0]?.updated ?? 0;
      return Response.json({ success: true, action: "backfill", updated, batch_size: batchSize });
    }

    // ── Read latest snapshot per source (pre-computed by pg_cron daily)
    // Falls back to live view query if no snapshots exist yet
    const { data: snapshots, error: snapErr } = await supabase
      .from("source_quality_snapshots")
      .select("*")
      .order("snapshot_at", { ascending: false })
      .limit(500);

    // Find the most recent snapshot_at
    const latestAt = snapshots?.[0]?.snapshot_at;
    const rows = latestAt
      ? snapshots!.filter((s) => s.snapshot_at === latestAt)
      : [];

    if (snapErr || rows.length === 0) {
      return Response.json({
        success: false,
        error: "No quality snapshots found. Run with action: 'snapshot' first, or wait for cron at 2am UTC.",
        hint: "POST { action: 'snapshot' } to trigger immediate snapshot via pg_cron call.",
      }, { status: 404 });
    }

    const error = null;

    const sources = (rows as any[]).map((r) => {
      // Snapshot table columns match what was inserted
      const ymmPct = parseFloat(r.ymm_coverage_pct ?? 0);
      const total = parseInt(r.total_vehicles ?? 0);
      const badVinPct = total > 0 ? parseFloat(r.bad_vin_count ?? 0) / total * 100 : 0;
      const junkPricePct = total > 0 ? parseFloat(r.junk_price_count ?? 0) / total * 100 : 0;
      const modelPollutedPct = total > 0 ? parseFloat(r.model_polluted_count ?? 0) / total * 100 : 0;

      const alerts: { type: string; message: string; count: number }[] = [];

      if (ymmPct < THRESHOLDS.ymm_critical) {
        alerts.push({ type: "critical", message: `YMM coverage critically low: ${ymmPct}%`, count: total - Math.round(total * ymmPct / 100) });
      } else if (ymmPct < THRESHOLDS.ymm_warning) {
        alerts.push({ type: "warning", message: `YMM coverage below 80%: ${ymmPct}%`, count: total - Math.round(total * ymmPct / 100) });
      }

      if (badVinPct > THRESHOLDS.bad_vin_pct) {
        alerts.push({ type: "warning", message: `Bad VIN rate high: ${badVinPct.toFixed(1)}%`, count: parseInt(r.bad_vin_count ?? 0) });
      }

      if (junkPricePct > THRESHOLDS.junk_price_pct) {
        alerts.push({ type: "warning", message: `Junk price rate high: ${junkPricePct.toFixed(1)}%`, count: parseInt(r.junk_price_count ?? 0) });
      }

      if (modelPollutedPct > THRESHOLDS.model_polluted_pct) {
        alerts.push({ type: "warning", message: `Model field polluted (>80 chars): ${modelPollutedPct.toFixed(1)}%`, count: parseInt(r.model_polluted_count ?? 0) });
      }

      return {
        source_name: r.source_name,
        total_vehicles: total,
        ymm_coverage_pct: ymmPct,
        vin_valid_pct: parseFloat(r.vin_valid_pct ?? 0),
        price_valid_pct: parseFloat(r.price_valid_pct ?? 0),
        avg_quality_score: parseFloat(r.avg_quality_score ?? 0),
        null_year_count: parseInt(r.null_year_count ?? 0),
        null_make_count: parseInt(r.null_make_count ?? 0),
        null_model_count: parseInt(r.null_model_count ?? 0),
        model_polluted_count: parseInt(r.model_polluted_count ?? 0),
        junk_price_count: parseInt(r.junk_price_count ?? 0),
        bad_vin_count: parseInt(r.bad_vin_count ?? 0),
        quality_grade: r.quality_grade ?? gradeFromYmm(ymmPct),
        alerts,
      };
    });

    const alertingSources = sources.filter((s) => s.alerts.length > 0);
    const summary = {
      total_sources: sources.length,
      grade_A: sources.filter((s) => s.quality_grade === "A").length,
      grade_B: sources.filter((s) => s.quality_grade === "B").length,
      grade_C: sources.filter((s) => s.quality_grade === "C").length,
      grade_D: sources.filter((s) => s.quality_grade === "D").length,
      grade_F: sources.filter((s) => s.quality_grade === "F").length,
      sources_with_alerts: alertingSources.length,
    };

    // ── Snapshot: persist to DB
    if (action === "snapshot") {
      const inserts = sources.map((s) => ({
        source_name: s.source_name,
        total_vehicles: s.total_vehicles,
        ymm_coverage_pct: s.ymm_coverage_pct,
        vin_valid_pct: s.vin_valid_pct,
        price_valid_pct: s.price_valid_pct,
        avg_quality_score: s.avg_quality_score,
        null_year_count: s.null_year_count,
        null_make_count: s.null_make_count,
        null_model_count: s.null_model_count,
        model_polluted_count: s.model_polluted_count,
        junk_price_count: s.junk_price_count,
        bad_vin_count: s.bad_vin_count,
        quality_grade: s.quality_grade,
        alerts: s.alerts.length > 0 ? s.alerts : null,
      }));

      const { error: insertError } = await supabase
        .from("source_quality_snapshots")
        .insert(inserts);
      if (insertError) throw insertError;

      console.log(`[data-quality-monitor] Stored ${inserts.length} source snapshots`);
    }

    // ── Alerts-only action
    if (action === "alerts") {
      return Response.json({ success: true, action, summary, alerts: alertingSources });
    }

    return Response.json({
      success: true,
      action,
      summary,
      sources,
      alerts: alertingSources,
    });

  } catch (err: any) {
    console.error("[data-quality-monitor] Error:", err);
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
});
