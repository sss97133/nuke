/**
 * BATCH YMM SPEC PROPAGATION
 *
 * For each unique (year, make, model), finds the best-filled vehicle
 * and copies factory-level fields to siblings missing them.
 *
 * Uses PostgREST only. Works in small chunks to avoid timeouts.
 *
 * POST /functions/v1/batch-ymm-propagate
 * Body: {
 *   "batch_size": number,     // vehicles to process per run (default 500, max 2000)
 *   "dry_run": boolean,
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Factory-level fields safe to propagate across same YMM
const PROP_FIELDS_TEXT = [
  "engine_type", "engine_size", "engine_displacement", "drivetrain",
  "body_style", "fuel_type", "transmission_type",
] as const;

const PROP_FIELDS_NUM = [
  "horsepower", "torque", "doors", "seats", "weight_lbs",
  "engine_liters", "wheelbase_inches",
] as const;

const ALL_PROP_FIELDS = [...PROP_FIELDS_TEXT, ...PROP_FIELDS_NUM] as const;

function fieldScore(v: any): number {
  let score = 0;
  for (const f of PROP_FIELDS_TEXT) {
    if (v[f] && v[f] !== "") score++;
  }
  for (const f of PROP_FIELDS_NUM) {
    if (v[f] !== null && v[f] !== undefined) score++;
  }
  return score;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const batchSize = Math.min(Math.max(Number(body.batch_size) || 500, 10), 2000);
    const dryRun = body.dry_run === true;

    console.log(`[ymm-propagate] batch=${batchSize} dry=${dryRun}`);

    // Step 1: Fetch a batch of vehicles that are missing specs
    const selectFields = ["id", "year", "make", "model", ...ALL_PROP_FIELDS].join(", ");
    const { data: sparseVehicles, error: sErr } = await supabase
      .from("vehicles")
      .select(selectFields)
      .not("year", "is", null)
      .not("make", "is", null)
      .is("deleted_at", null)
      .or("horsepower.is.null,engine_type.is.null,drivetrain.is.null,body_style.is.null,fuel_type.is.null,doors.is.null,weight_lbs.is.null")
      .order("created_at", { ascending: false })
      .limit(batchSize);

    if (sErr) throw new Error(`Fetch sparse vehicles failed: ${sErr.message}`);
    const sparse = sparseVehicles || [];
    if (sparse.length === 0) {
      return okJson({ success: true, message: "No sparse vehicles found", processed: 0, duration_ms: Date.now() - startTime });
    }

    console.log(`[ymm-propagate] Found ${sparse.length} sparse vehicles`);

    // Step 2: Group by YMM
    const ymmGroups = new Map<string, any[]>();
    for (const v of sparse) {
      const key = `${v.year}|${v.make}|${v.model}`;
      if (!ymmGroups.has(key)) ymmGroups.set(key, []);
      ymmGroups.get(key)!.push(v);
    }

    console.log(`[ymm-propagate] ${ymmGroups.size} unique YMM combos`);

    let totalUpdated = 0;
    let totalFieldsFilled = 0;
    let combosProcessed = 0;
    let combosSkipped = 0;
    const errors: string[] = [];
    const sampleUpdates: string[] = [];

    // Step 3: For each YMM group, find the best donor and propagate
    for (const [key, vehicles] of ymmGroups) {
      try {
        const [year, make, model] = key.split("|");

        // Find the best donor for this YMM (might be in our batch or might need a query)
        let bestInGroup = vehicles.reduce((a, b) => fieldScore(a) > fieldScore(b) ? a : b);

        // Always try to find a better donor from the full DB for this YMM
        const { data: donors } = await supabase
          .from("vehicles")
          .select(selectFields)
          .eq("year", parseInt(year))
          .eq("make", make)
          .eq("model", model)
          .is("deleted_at", null)
          .not("body_style", "is", null)
          .order("horsepower", { ascending: false, nullsFirst: false })
          .limit(5);

        if (donors && donors.length > 0) {
          const bestDonor = donors.reduce((a: any, b: any) => fieldScore(a) > fieldScore(b) ? a : b);
          if (fieldScore(bestDonor) > fieldScore(bestInGroup)) {
            bestInGroup = bestDonor;
          }
        }

        if (fieldScore(bestInGroup) < 1) {
          combosSkipped++;
          continue;
        }

        // For each sparse vehicle in this group, fill missing fields from donor
        for (const vehicle of vehicles) {
          if (vehicle.id === bestInGroup.id) continue;

          const updatePayload: Record<string, any> = {};
          const fieldsToFill: string[] = [];

          for (const f of PROP_FIELDS_TEXT) {
            if ((!vehicle[f] || vehicle[f] === "") && bestInGroup[f] && bestInGroup[f] !== "") {
              updatePayload[f] = bestInGroup[f];
              fieldsToFill.push(f);
            }
          }

          for (const f of PROP_FIELDS_NUM) {
            if ((vehicle[f] === null || vehicle[f] === undefined) && bestInGroup[f] !== null && bestInGroup[f] !== undefined) {
              updatePayload[f] = bestInGroup[f];
              fieldsToFill.push(f);
            }
          }

          if (fieldsToFill.length === 0) continue;

          if (!dryRun) {
            updatePayload.updated_at = new Date().toISOString();
            const { error: uErr } = await supabase
              .from("vehicles")
              .update(updatePayload)
              .eq("id", vehicle.id);

            if (uErr) {
              errors.push(`${vehicle.id}: ${uErr.message}`);
              continue;
            }
          }

          totalUpdated++;
          totalFieldsFilled += fieldsToFill.length;

          if (sampleUpdates.length < 5) {
            sampleUpdates.push(`${year} ${make} ${model} [${vehicle.id.slice(0, 8)}]: +${fieldsToFill.join(", ")}`);
          }
        }

        combosProcessed++;
      } catch (e: any) {
        errors.push(`${key}: ${e?.message || e}`);
      }
    }

    return okJson({
      success: true,
      dry_run: dryRun,
      batch_size: batchSize,
      sparse_vehicles_found: sparse.length,
      ymm_combos: ymmGroups.size,
      combos_processed: combosProcessed,
      combos_skipped: combosSkipped,
      vehicles_updated: totalUpdated,
      fields_filled: totalFieldsFilled,
      errors_count: errors.length,
      errors: errors.slice(0, 10),
      sample_updates: sampleUpdates,
      duration_ms: Date.now() - startTime,
    });
  } catch (e: any) {
    console.error("[ymm-propagate] Error:", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function okJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
