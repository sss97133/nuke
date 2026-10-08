/**
 * BATCH VIN DECODE
 *
 * Decodes VINs via NHTSA vPIC API (free, no key required) and fills factory specs.
 * NHTSA bulk decode endpoint handles 50 VINs at a time.
 *
 * POST /functions/v1/batch-vin-decode
 * Body: {
 *   "batch_size": number,     // vehicles per run (default 50, max 500)
 *   "dry_run": boolean,
 *   "source_filter": string,  // only decode vehicles from this source
 *   "offset": number          // skip first N candidates
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireWriteAuth, authenticateWriter } from "../_shared/writeGuard.ts";
import { drainRetainedReferenceQueue } from "./retainedReferenceQueue.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

import { NHTSA_FIELD_MAP, decodeVinsBatch } from "../_shared/nhtsa-vin.ts";

interface VinDecodeResult {
  vin: string;
  vehicleId: string;
  status: string;
  fieldsUpdated: string[];
  nhtsa_error?: string;
}

Deno.serve(async (req) => {
  // Writes are never anonymous: service key, signed-in user, or nothing (P0.2, 2026-09-27).
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
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
    if (body.use_retained_reference_queue !== undefined) {
      const writer = await authenticateWriter(req);
      if (!writer.ok || writer.caller.kind !== "service_role") {
        return okJson({ error: "Retained reference queue requires service role" }, 403);
      }
      return await drainRetainedReferenceQueue(supabase, body);
    }
    const batchSize = Math.min(Math.max(Number(body.batch_size) || 50, 1), 500);
    const dryRun = body.dry_run === true;
    const sourceFilter = body.source_filter || null;
    const offset = Number(body.offset) || 0;

    console.log(`[vin-decode] batch=${batchSize} dry=${dryRun} source=${sourceFilter} offset=${offset}`);

    // Find vehicles with VINs but missing factory specs using PostgREST
    let query = supabase
      .from("vehicles")
      .select("id, vin, year, make, model, horsepower, engine_type, engine_liters, engine_displacement, drivetrain, body_style, fuel_type, doors, seats, weight_lbs, trim, series, transmission_type, transmission_speeds, wheelbase_inches")
      .not("vin", "is", null)
      .is("deleted_at", null)
      .or("horsepower.is.null,engine_type.is.null,drivetrain.is.null,body_style.is.null,fuel_type.is.null,doors.is.null")
      .order("created_at", { ascending: false })
      .range(offset, offset + batchSize - 1);

    const { data: candidates, error: cErr } = await query;
    if (cErr) throw new Error(`Query failed: ${cErr.message}`);

    // Filter to VINs >= 11 chars in JS (PostgREST can't do length checks)
    const vehicles: any[] = (candidates || []).filter((v: any) => v.vin && v.vin.length >= 11);
    if (vehicles.length === 0) {
      return okJson({ success: true, message: "No vehicles need VIN decode", processed: 0, duration_ms: Date.now() - startTime });
    }

    console.log(`[vin-decode] Found ${vehicles.length} vehicles to decode`);

    const results: VinDecodeResult[] = [];
    let totalDecoded = 0;
    let totalFieldsFilled = 0;
    let errors = 0;

    // Process in chunks of 50 (NHTSA batch limit)
    for (let i = 0; i < vehicles.length; i += 50) {
      const chunk = vehicles.slice(i, i + 50);
      const vins = chunk.map((v: any) => v.vin);

      let nhtsaResults: Map<string, Record<string, string>>;
      try {
        nhtsaResults = await decodeVinsBatch(vins);
      } catch (e: any) {
        console.error(`[vin-decode] NHTSA batch error: ${e?.message}`);
        for (const v of chunk) {
          results.push({ vin: v.vin, vehicleId: v.id, status: `nhtsa_error: ${e?.message}`, fieldsUpdated: [], nhtsa_error: e?.message });
          errors++;
        }
        continue;
      }

      for (const vehicle of chunk) {
        try {
          const nhtsaData = nhtsaResults.get(vehicle.vin);
          if (!nhtsaData || Object.keys(nhtsaData).length === 0) {
            results.push({ vin: vehicle.vin, vehicleId: vehicle.id, status: "no_nhtsa_data", fieldsUpdated: [] });
            continue;
          }

          // Build update payload - only fill missing fields
          const updatePayload: Record<string, any> = {};
          const fieldsUpdated: string[] = [];

          for (const [nhtsaKey, rawVal] of Object.entries(nhtsaData)) {
            const mapping = NHTSA_FIELD_MAP[nhtsaKey];
            if (!mapping) continue;

            const existingVal = vehicle[mapping.col];
            // Only fill if currently empty
            if (existingVal !== null && existingVal !== undefined && String(existingVal).trim() !== "") continue;

            const transformedVal = mapping.transform ? mapping.transform(rawVal) : rawVal;
            if (transformedVal === null || transformedVal === undefined) continue;

            updatePayload[mapping.col] = transformedVal;
            fieldsUpdated.push(mapping.col);
          }

          if (fieldsUpdated.length === 0) {
            results.push({ vin: vehicle.vin, vehicleId: vehicle.id, status: "no_new_fields", fieldsUpdated: [] });
            continue;
          }

          if (!dryRun) {
            updatePayload.updated_at = new Date().toISOString();
            updatePayload.vin_source = "nhtsa_decode";
            updatePayload.vin_confidence = 100;

            const { error: uErr } = await supabase
              .from("vehicles")
              .update(updatePayload)
              .eq("id", vehicle.id);

            if (uErr) {
              results.push({ vin: vehicle.vin, vehicleId: vehicle.id, status: `update_error: ${uErr.message}`, fieldsUpdated: [] });
              errors++;
              continue;
            }
          }

          totalDecoded++;
          totalFieldsFilled += fieldsUpdated.length;
          results.push({ vin: vehicle.vin, vehicleId: vehicle.id, status: dryRun ? "dry_run" : "decoded", fieldsUpdated });
        } catch (e: any) {
          results.push({ vin: vehicle.vin, vehicleId: vehicle.id, status: `error: ${e?.message}`, fieldsUpdated: [] });
          errors++;
        }
      }

      // Small delay between NHTSA batches
      if (i + 50 < vehicles.length) {
        await new Promise(r => setTimeout(r, 500));
      }

      console.log(`[vin-decode] Progress: ${Math.min(i + 50, vehicles.length)}/${vehicles.length}`);
    }

    return okJson({
      success: true,
      dry_run: dryRun,
      batch_size: batchSize,
      offset,
      candidates_found: vehicles.length,
      decoded: totalDecoded,
      fields_filled: totalFieldsFilled,
      errors,
      sample_results: results.slice(0, 10),
      duration_ms: Date.now() - startTime,
      next_offset: offset + batchSize,
    });
  } catch (e: any) {
    console.error("[vin-decode] Error:", e);
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
