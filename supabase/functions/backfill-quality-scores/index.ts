/**
 * BACKFILL QUALITY SCORES
 *
 * Calls calculate_vehicle_quality_score(v.*) in batch for all vehicles
 * that don't have a quality score yet.
 *
 * The SQL function takes a FULL vehicles row (not a UUID), so we use
 * execute_sql to call it with v.* syntax, then upsert the result via
 * the supabase client.
 *
 * POST /functions/v1/backfill-quality-scores
 * Body: {
 *   "batch_size"?: number,   // default 500
 *   "force_all"?: boolean    // re-evaluate even existing scores
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
    const batchSize = Math.min(body.batch_size ?? 500, 2000);
    const forceAll = body.force_all ?? false;

    console.log(`[backfill-quality-scores] batch=${batchSize}, force=${forceAll}`);

    // Step 1: Get vehicle IDs that need scoring via execute_sql
    const findQuery = forceAll
      ? `SELECT id FROM vehicles WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ${batchSize}`
      : `SELECT v.id FROM vehicles v LEFT JOIN vehicle_quality_scores qs ON qs.vehicle_id = v.id WHERE v.deleted_at IS NULL AND qs.vehicle_id IS NULL ORDER BY v.created_at DESC LIMIT ${batchSize}`;

    const { data: vehicleIds, error: vErr } = await supabase.rpc("execute_sql", {
      query: findQuery,
    });

    if (vErr) throw vErr;

    const ids: { id: string }[] = Array.isArray(vehicleIds) ? vehicleIds : [];
    console.log(`[backfill-quality-scores] Found ${ids.length} vehicles to score`);

    let processed = 0;
    let errors = 0;

    // Step 2 & 3: For each vehicle, calculate score via execute_sql then upsert via client
    for (const row of ids) {
      try {
        // calculate_vehicle_quality_score takes a full vehicles row (v.*)
        const scoreQuery = `SELECT calculate_vehicle_quality_score(v.*) as score FROM vehicles v WHERE v.id = '${row.id}'`;

        const { data: scoreResult, error: scoreErr } = await supabase.rpc("execute_sql", {
          query: scoreQuery,
        });

        if (scoreErr) {
          errors++;
          if (errors <= 5) console.error(`Score calc error for ${row.id}:`, scoreErr.message);
          continue;
        }

        // scoreResult is an array like [{ score: 75 }]
        const scoreRow = Array.isArray(scoreResult) ? scoreResult[0] : null;
        const score = scoreRow?.score ?? 0;

        // Upsert the score into vehicle_quality_scores via supabase client
        const { error: upsertErr } = await supabase
          .from("vehicle_quality_scores")
          .upsert(
            {
              vehicle_id: row.id,
              overall_score: score,
              last_checked_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "vehicle_id" }
          );

        if (upsertErr) {
          errors++;
          if (errors <= 5) console.error(`Upsert error for ${row.id}:`, upsertErr.message);
        } else {
          processed++;
        }
      } catch (e: unknown) {
        errors++;
        if (errors <= 5) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`Unexpected error for ${row.id}:`, msg);
        }
      }
    }

    // Get stats on overall scoring
    const { data: stats } = await supabase.rpc("execute_sql", {
      query: `SELECT count(*) as total_scored, ROUND(avg(overall_score)::numeric, 1) as avg_score, count(*) FILTER (WHERE overall_score >= 80) as good, count(*) FILTER (WHERE overall_score >= 40 AND overall_score < 80) as fair, count(*) FILTER (WHERE overall_score < 40) as poor FROM vehicle_quality_scores`,
    });

    const { data: remaining } = await supabase.rpc("execute_sql", {
      query: `SELECT count(*) as cnt FROM vehicles v LEFT JOIN vehicle_quality_scores qs ON qs.vehicle_id = v.id WHERE v.deleted_at IS NULL AND qs.vehicle_id IS NULL`,
    });

    return new Response(
      JSON.stringify({
        success: true,
        batch_size: batchSize,
        found: ids.length,
        processed,
        errors,
        remaining: Array.isArray(remaining) ? remaining[0]?.cnt ?? 0 : 0,
        overall_stats: Array.isArray(stats) ? stats[0] ?? {} : {},
      }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    console.error("[backfill-quality-scores] Error:", e);
    return new Response(JSON.stringify({ error: msg, stack }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
