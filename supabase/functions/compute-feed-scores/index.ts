/**
 * COMPUTE FEED SCORES — Orchestrator
 *
 * Coordinates the Nuke Estimate pipeline:
 * - Every 4hr: batch compute valuations for stale/new vehicles
 * - Every 15min: refresh materialized view (handled by pg_cron directly)
 * - Daily: detect records, estimate survival rates
 *
 * POST /functions/v1/compute-feed-scores
 * Body: {
 *   "action": "batch_valuations" | "detect_records" | "estimate_survival" | "refresh_view" | "full_pipeline",
 *   "batch_size"?: number,  // default 50
 *   "force"?: boolean       // re-compute all
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body.action || "batch_valuations";
    const batchSize = Math.min(body.batch_size ?? 50, 200);
    const force = body.force || false;
    const results: Record<string, any> = { action };

    // ================================================================
    // BATCH VALUATIONS
    // ================================================================
    if (action === "batch_valuations" || action === "full_pipeline") {
      let vehicleIds: string[] = [];

      // Use SQL to efficiently find vehicles needing computation
      const query = force
        ? `SELECT vehicle_id FROM clean_vehicle_prices WHERE best_price > 0 LIMIT ${batchSize}`
        : `(SELECT cvp.vehicle_id FROM clean_vehicle_prices cvp
            LEFT JOIN nuke_estimates ne ON ne.vehicle_id = cvp.vehicle_id
            WHERE cvp.best_price > 0 AND ne.id IS NULL
            LIMIT ${batchSize})
           UNION ALL
           (SELECT vehicle_id FROM nuke_estimates WHERE is_stale = true LIMIT ${Math.floor(batchSize / 5)})`;

      try {
        const { data: rows } = await supabase.rpc("execute_sql", { query });
        if (rows && Array.isArray(rows)) {
          vehicleIds = rows.map((r: any) => r.vehicle_id);
        } else if (rows && typeof rows === "string") {
          // execute_sql may return JSON string
          const parsed = JSON.parse(rows);
          vehicleIds = (Array.isArray(parsed) ? parsed : []).map((r: any) => r.vehicle_id);
        }
      } catch {
        // Fallback: use the client approach but with limit
        const { data: withPrices } = await supabase
          .from("clean_vehicle_prices")
          .select("vehicle_id")
          .gt("best_price", 0)
          .limit(batchSize);

        const ids = (withPrices || []).map((v: any) => v.vehicle_id);
        if (ids.length > 0) {
          const { data: existing } = await supabase
            .from("nuke_estimates")
            .select("vehicle_id")
            .in("vehicle_id", ids);
          const existingSet = new Set((existing || []).map((e: any) => e.vehicle_id));
          vehicleIds = ids.filter((id: string) => !existingSet.has(id));
        }
      }
      vehicleIds = [...new Set(vehicleIds)].slice(0, batchSize);

      if (vehicleIds.length > 0) {
        // Call compute-vehicle-valuation in batches of 20
        const batchResults = [];
        for (let i = 0; i < vehicleIds.length; i += 20) {
          const batch = vehicleIds.slice(i, i + 20);
          const { data, error } = await supabase.functions.invoke("compute-vehicle-valuation", {
            body: { vehicle_ids: batch, force },
          });
          batchResults.push({ batch_index: i / 20, data, error: error?.message });
        }
        results.valuations = {
          total_queued: vehicleIds.length,
          batches: batchResults.length,
          details: batchResults,
        };
      } else {
        results.valuations = { total_queued: 0, message: "All vehicles up to date" };
      }
    }

    // ================================================================
    // DETECT RECORDS
    // ================================================================
    if (action === "detect_records" || action === "full_pipeline") {
      const { data, error } = await supabase.functions.invoke("detect-record-prices", {
        body: { limit: 500 },
      });
      results.records = error ? { error: error.message } : data;
    }

    // ================================================================
    // ESTIMATE SURVIVAL
    // ================================================================
    if (action === "estimate_survival" || action === "full_pipeline") {
      const { data, error } = await supabase.functions.invoke("estimate-survival-rates", {
        body: { limit: 200 },
      });
      results.survival = error ? { error: error.message } : data;
    }

    // ================================================================
    // REFRESH MATERIALIZED VIEW
    // ================================================================
    if (action === "refresh_view" || action === "full_pipeline") {
      // The pg_cron handles this every 15 min, but allow manual trigger
      const { error: refreshErr } = await supabase.rpc("execute_sql", {
        query: "REFRESH MATERIALIZED VIEW CONCURRENTLY vehicle_valuation_feed",
      }).catch(() => ({ error: { message: "RPC not available" } }));

      if (refreshErr) {
        // Fallback: direct query
        results.view_refresh = { status: "deferred_to_cron", note: "pg_cron refreshes every 15 min" };
      } else {
        results.view_refresh = { status: "refreshed" };
      }
    }

    return new Response(
      JSON.stringify({ success: true, ...results }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("[compute-feed-scores] Error:", e);
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
