/**
 * ENRICH FACTORY SPECS
 *
 * Uses LLM training data to recall factory-published specifications for vehicles
 * based on their identity (year/make/model/engine). No HTML needed.
 *
 * Targets ~39 spec columns: dimensions, performance, fuel economy, mechanical details.
 *
 * POST /functions/v1/enrich-factory-specs
 * Body: {
 *   "vehicle_id": string,        // single vehicle
 *   "vehicle_ids": string[],     // batch mode
 *   "business_id": string,       // all vehicles for a business
 *   "dry_run": boolean,          // default false
 *   "force": boolean             // re-enrich even if already done
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ENRICHMENT_VERSION = "enrich-factory-specs:1.0.0";

// ─── Vehicle type classification ─────────────────────────────────────
type VehicleType = "standard_production" | "rv_motorhome" | "utv_offroad" | "engine_part" | "kit_car";

function classifyVehicle(v: { make?: string; model?: string; body_style?: string; bat_listing_title?: string; listing_title?: string }): VehicleType {
  const text = `${v.make || ""} ${v.model || ""} ${v.body_style || ""} ${v.bat_listing_title || ""} ${v.listing_title || ""}`.toLowerCase();

  if (/\bengine\b.*\b(part|only|crate|long.?block|short.?block)\b|\bpart\b/i.test(text) && !/vehicle|car|truck/i.test(text)) return "engine_part";
  if (/\brv\b|motorhome|class\s*[abc]\b|winnebago|thor\b|fleetwood|coachmen|hurricane|four winds|itasca|jayco/i.test(text)) return "rv_motorhome";
  if (/\butv\b|side.?by.?side|rzr|ranger\s+xp|polaris|can.?am|yamaha\s+yxz|kawasaki\s+mule|arctic\s+cat/i.test(text)) return "utv_offroad";
  if (/kit\s*car|replica|factory\s*five|superformance|backdraft/i.test(text)) return "kit_car";
  return "standard_production";
}

// ─── Validation ranges ───────────────────────────────────────────────
const VALIDATION: Record<string, { min: number; max: number }> = {
  weight_lbs: { min: 500, max: 20000 },
  wheelbase_inches: { min: 50, max: 250 },
  length_inches: { min: 60, max: 500 },
  width_inches: { min: 40, max: 110 },
  height_inches: { min: 30, max: 140 },
  zero_to_sixty: { min: 1.5, max: 30.0 },
  quarter_mile: { min: 8.0, max: 25.0 },
  top_speed_mph: { min: 40, max: 280 },
  braking_60_0_ft: { min: 80, max: 250 },
  lateral_g: { min: 0.4, max: 1.5 },
  mpg_city: { min: 3, max: 80 },
  mpg_highway: { min: 4, max: 100 },
  mpg_combined: { min: 3, max: 90 },
  compression_ratio: { min: 4.0, max: 18.0 },
  bore_mm: { min: 40, max: 130 },
  stroke_mm: { min: 40, max: 130 },
  redline_rpm: { min: 3000, max: 12000 },
  rear_axle_ratio: { min: 1.5, max: 7.0 },
  doors: { min: 0, max: 6 },
  seats: { min: 1, max: 15 },
  msrp: { min: 500, max: 5000000 },
};

function validateNumeric(field: string, value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : parseFloat(String(value));
  if (isNaN(num)) return null;
  const range = VALIDATION[field];
  if (range && (num < range.min || num > range.max)) return null;
  return num;
}

// ─── LLM caller (same pattern as enrich-vehicle-profile-ai) ─────────
async function callLLM(prompt: string, systemPrompt: string): Promise<string> {
  const providers = [
    { key: Deno.env.get("XAI_API_KEY"), url: "https://api.x.ai/v1/chat/completions", model: "grok-3-mini", name: "xAI" },
    { key: Deno.env.get("VITE_OPENAI_API_KEY"), url: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini", name: "OpenAI-proj" },
    { key: Deno.env.get("OPENAI_API_KEY"), url: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini", name: "OpenAI-svc" },
  ].filter(p => p.key);

  if (providers.length === 0) throw new Error("No AI API keys available (need XAI_API_KEY or OPENAI_API_KEY)");

  let lastError = "";
  for (const provider of providers) {
    try {
      const resp = await fetch(provider.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${provider.key}`,
        },
        body: JSON.stringify({
          model: provider.model,
          max_tokens: 2048,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
          temperature: 0.05,
          ...(provider.name !== "xAI" ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: AbortSignal.timeout(45000),
      });

      if (!resp.ok) {
        const err = await resp.text().catch(() => "unknown");
        lastError = `${provider.name} ${resp.status}: ${err}`;
        console.warn(`[factory-specs] ${provider.name} failed: ${resp.status}`);
        continue;
      }

      const data = await resp.json();
      const content = data?.choices?.[0]?.message?.content ?? "";
      if (content) {
        console.log(`[factory-specs] Using ${provider.name} (${provider.model})`);
        return content;
      }
    } catch (e: any) {
      lastError = `${provider.name}: ${e?.message || e}`;
      console.warn(`[factory-specs] ${provider.name} error: ${lastError}`);
    }
  }

  throw new Error(`All AI providers failed. Last: ${lastError}`);
}

// ─── System prompt for factory spec recall ───────────────────────────
function buildSystemPrompt(vehicleType: VehicleType): string {
  const base = `You are a vehicle specifications database. Given a vehicle's identity, recall its FACTORY-PUBLISHED specifications from your training data.

RULES:
- Return ONLY valid JSON, no markdown fencing, no explanation
- Use null for any spec you are NOT confident about (better to skip than guess)
- All values must be factory-published specs for the EXACT year/model/engine combination
- Do NOT infer or estimate — only return values you are confident are correct
- Numeric fields must be plain numbers (no units in the value)`;

  if (vehicleType === "rv_motorhome") {
    return base + `

VEHICLE TYPE: RV/Motorhome
- Focus on: weight, dimensions, fuel economy, engine specs, transmission, frame
- Skip performance fields (zero_to_sixty, quarter_mile, lateral_g, braking_60_0_ft) — use null
- RVs have GVWR (use for weight_lbs), are typically very long/wide/tall
- Fuel economy will be low (6-12 mpg typical)`;
  }

  if (vehicleType === "utv_offroad") {
    return base + `

VEHICLE TYPE: UTV/Off-road
- Focus on: weight, dimensions, engine specs, drivetrain
- Skip highway performance and fuel economy — use null
- UTVs are typically 1000-2500 lbs, 100-200 inches long`;
  }

  return base;
}

function buildUserPrompt(v: Record<string, any>, vehicleType: VehicleType): string {
  const identity = [
    v.year && `Year: ${v.year}`,
    v.make && `Make: ${v.make}`,
    v.model && `Model: ${v.model}`,
    v.trim && `Trim: ${v.trim}`,
    v.series && `Series: ${v.series}`,
    v.engine_type && `Engine: ${v.engine_type}`,
    v.engine_displacement && `Displacement: ${v.engine_displacement}`,
    v.body_style && `Body Style: ${v.body_style}`,
    v.drivetrain && `Drivetrain: ${v.drivetrain}`,
    v.transmission && `Transmission: ${v.transmission}`,
    v.horsepower && `Horsepower: ${v.horsepower}`,
    v.torque && `Torque: ${v.torque} lb-ft`,
  ].filter(Boolean).join("\n");

  const perfFields = vehicleType === "rv_motorhome" || vehicleType === "utv_offroad"
    ? ""
    : `
  "zero_to_sixty": number|null (seconds, e.g. 5.2),
  "quarter_mile": number|null (seconds, e.g. 13.5),
  "top_speed_mph": number|null (integer),
  "braking_60_0_ft": number|null (feet),
  "lateral_g": number|null (g-force on skidpad),`;

  return `Recall factory specifications for this vehicle:

${identity}

Return JSON with these fields:
{
  "weight_lbs": number|null (curb weight in pounds),
  "wheelbase_inches": number|null (integer),
  "length_inches": number|null (integer),
  "width_inches": number|null (integer, excluding mirrors),
  "height_inches": number|null (integer),
${perfFields}
  "mpg_city": number|null (integer),
  "mpg_highway": number|null (integer),
  "mpg_combined": number|null (integer),
  "fuel_type": string|null ("Gasoline", "Diesel", "Electric", "Hybrid", "E85/Flex"),
  "compression_ratio": number|null (e.g. 10.5),
  "bore_mm": number|null,
  "stroke_mm": number|null,
  "redline_rpm": number|null (integer),
  "rear_axle_ratio": number|null (e.g. 3.73),
  "suspension_front": string|null (e.g. "MacPherson strut", "Double wishbone"),
  "suspension_rear": string|null (e.g. "Multi-link", "Live axle with leaf springs"),
  "brake_type_front": string|null (e.g. "Ventilated disc, 13.0in"),
  "brake_type_rear": string|null (e.g. "Solid disc, 12.0in", "Drum"),
  "steering_type": string|null (e.g. "Rack and pinion, power-assisted"),
  "frame_type": string|null ("Unibody", "Body-on-frame", "Space frame", "Monocoque"),
  "transmission_type": string|null (e.g. "6-speed manual", "4-speed automatic"),
  "rear_axle_type": string|null (e.g. "Independent", "Live axle", "De Dion"),
  "transfer_case": string|null (only if 4WD/AWD, e.g. "BorgWarner 4484"),
  "engine_code": string|null (e.g. "S54", "LS3", "M96.05"),
  "cam_type": string|null ("SOHC", "DOHC", "OHV/Pushrod"),
  "intake_type": string|null (e.g. "Multi-port fuel injection", "Single carburetor"),
  "exhaust_type": string|null (e.g. "Dual exhaust", "Single exhaust with catalytic converter"),
  "fuel_system_type": string|null (e.g. "Sequential multi-port injection", "Weber carburetors"),
  "tire_spec_front": string|null (e.g. "225/40R18"),
  "tire_spec_rear": string|null (e.g. "255/35R18"),
  "abs_equipped": boolean|null,
  "doors": number|null (integer),
  "seats": number|null (integer),
  "series": string|null (e.g. "E46", "C5", "996"),
  "msrp": number|null (original MSRP in USD, base price for the trim)
}`;
}

// ─── Select columns for factory spec enrichment ──────────────────────
const FACTORY_SPEC_COLUMNS = [
  "weight_lbs", "wheelbase_inches", "length_inches", "width_inches", "height_inches",
  "zero_to_sixty", "quarter_mile", "top_speed_mph", "braking_60_0_ft", "lateral_g",
  "mpg_city", "mpg_highway", "mpg_combined", "fuel_type",
  "compression_ratio", "bore_mm", "stroke_mm", "redline_rpm", "rear_axle_ratio",
  "suspension_front", "suspension_rear", "brake_type_front", "brake_type_rear",
  "steering_type", "frame_type", "transmission_type", "rear_axle_type", "transfer_case",
  "engine_code", "cam_type", "intake_type", "exhaust_type", "fuel_system_type",
  "tire_spec_front", "tire_spec_rear", "abs_equipped",
  "doors", "seats", "series", "msrp",
];

const NUMERIC_FIELDS = new Set([
  "weight_lbs", "wheelbase_inches", "length_inches", "width_inches", "height_inches",
  "zero_to_sixty", "quarter_mile", "top_speed_mph", "braking_60_0_ft", "lateral_g",
  "mpg_city", "mpg_highway", "mpg_combined",
  "compression_ratio", "bore_mm", "stroke_mm", "redline_rpm", "rear_axle_ratio",
  "doors", "seats", "msrp",
]);

const BOOLEAN_FIELDS = new Set(["abs_equipped"]);

// ─── Enrich a single vehicle ─────────────────────────────────────────
async function enrichVehicle(
  supabase: any,
  vehicleId: string,
  dryRun: boolean,
  force: boolean,
): Promise<{ vehicle_id: string; status: string; fields_updated: string[]; vehicle_type: string; before: any; after: any }> {
  // Fetch vehicle identity + all target columns
  const selectCols = [
    "id", "year", "make", "model", "trim", "body_style", "drivetrain",
    "engine_type", "engine_displacement", "horsepower", "torque",
    "transmission", "bat_listing_title", "listing_title", "series",
    "origin_metadata",
    ...FACTORY_SPEC_COLUMNS,
  ];

  const { data: vehicle, error: vErr } = await supabase
    .from("vehicles")
    .select(selectCols.join(", "))
    .eq("id", vehicleId)
    .maybeSingle();

  if (vErr || !vehicle) {
    return { vehicle_id: vehicleId, status: "not_found", fields_updated: [], vehicle_type: "unknown", before: null, after: null };
  }

  // Check if already enriched
  if (!force && vehicle.origin_metadata?.factory_specs_enriched) {
    return { vehicle_id: vehicleId, status: "already_enriched", fields_updated: [], vehicle_type: "unknown", before: vehicle, after: null };
  }

  // Classify vehicle type
  const vehicleType = classifyVehicle(vehicle);

  // Skip engine parts
  if (vehicleType === "engine_part") {
    return { vehicle_id: vehicleId, status: "skipped_engine_part", fields_updated: [], vehicle_type: vehicleType, before: vehicle, after: null };
  }

  // Check if there are any null columns to fill
  const nullCols = FACTORY_SPEC_COLUMNS.filter(col => vehicle[col] === null || vehicle[col] === undefined);
  if (nullCols.length === 0) {
    return { vehicle_id: vehicleId, status: "all_columns_filled", fields_updated: [], vehicle_type: vehicleType, before: vehicle, after: null };
  }

  // Call LLM
  const systemPrompt = buildSystemPrompt(vehicleType);
  const userPrompt = buildUserPrompt(vehicle, vehicleType);

  let llmResponse: string;
  try {
    llmResponse = await callLLM(userPrompt, systemPrompt);
  } catch (e: any) {
    return { vehicle_id: vehicleId, status: `llm_error: ${e?.message || e}`, fields_updated: [], vehicle_type: vehicleType, before: vehicle, after: null };
  }

  // Parse JSON
  let specs: Record<string, any>;
  try {
    let jsonStr = llmResponse.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }
    specs = JSON.parse(jsonStr);
  } catch (e: any) {
    return { vehicle_id: vehicleId, status: `parse_error: ${e?.message}`, fields_updated: [], vehicle_type: vehicleType, before: vehicle, after: { raw: llmResponse.slice(0, 500) } };
  }

  // Build update payload — only write to NULL columns
  const updatePayload: Record<string, any> = {};
  const fieldsUpdated: string[] = [];

  for (const col of FACTORY_SPEC_COLUMNS) {
    // Only fill NULL columns
    if (vehicle[col] !== null && vehicle[col] !== undefined) continue;

    const newVal = specs[col];
    if (newVal === null || newVal === undefined) continue;

    if (BOOLEAN_FIELDS.has(col)) {
      if (typeof newVal === "boolean") {
        updatePayload[col] = newVal;
        fieldsUpdated.push(col);
      }
    } else if (NUMERIC_FIELDS.has(col)) {
      const validated = validateNumeric(col, newVal);
      if (validated !== null) {
        updatePayload[col] = validated;
        fieldsUpdated.push(col);
      }
    } else {
      // Text field
      const strVal = String(newVal).trim();
      if (strVal && strVal.toLowerCase() !== "null" && strVal.toLowerCase() !== "n/a" && strVal.length <= 500) {
        updatePayload[col] = strVal;
        fieldsUpdated.push(col);
      }
    }
  }

  // Compute power_to_weight if we now have both hp and weight
  const hp = vehicle.horsepower || updatePayload.horsepower;
  const weight = vehicle.weight_lbs || updatePayload.weight_lbs;
  if (hp && weight && vehicle.power_to_weight === null) {
    const ptw = Math.round((hp / weight) * 1000) / 1000;
    if (ptw > 0 && ptw < 1.0) {
      updatePayload.power_to_weight = ptw;
      fieldsUpdated.push("power_to_weight");
    }
  }

  // Mark enrichment in origin_metadata
  updatePayload.origin_metadata = {
    ...(vehicle.origin_metadata || {}),
    factory_specs_enriched: true,
    factory_specs_version: ENRICHMENT_VERSION,
    factory_specs_at: new Date().toISOString(),
    factory_specs_fields: fieldsUpdated.length,
    factory_specs_vehicle_type: vehicleType,
  };
  updatePayload.updated_at = new Date().toISOString();

  const afterState = { specs_returned: specs, fields_updated: fieldsUpdated, vehicle_type: vehicleType };

  if (fieldsUpdated.length === 0) {
    // Still mark as enriched so we don't re-process
    if (!dryRun) {
      await supabase.from("vehicles").update({
        origin_metadata: updatePayload.origin_metadata,
        updated_at: updatePayload.updated_at,
      }).eq("id", vehicleId);
    }
    return { vehicle_id: vehicleId, status: "no_valid_specs", fields_updated: [], vehicle_type: vehicleType, before: vehicle, after: afterState };
  }

  if (dryRun) {
    return { vehicle_id: vehicleId, status: "dry_run", fields_updated: fieldsUpdated, vehicle_type: vehicleType, before: vehicle, after: afterState };
  }

  const { error: updateErr } = await supabase
    .from("vehicles")
    .update(updatePayload)
    .eq("id", vehicleId);

  if (updateErr) {
    return { vehicle_id: vehicleId, status: `update_error: ${updateErr.message}`, fields_updated: [], vehicle_type: vehicleType, before: vehicle, after: afterState };
  }

  return { vehicle_id: vehicleId, status: "enriched", fields_updated: fieldsUpdated, vehicle_type: vehicleType, before: vehicle, after: afterState };
}

// ─── Main handler ────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim();
    const serviceRoleKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing env vars");

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json().catch(() => ({}));

    const dryRun = body.dry_run === true;
    const force = body.force === true;
    let vehicleIds: string[] = [];

    if (body.vehicle_id) {
      vehicleIds = [String(body.vehicle_id)];
    } else if (body.vehicle_ids && Array.isArray(body.vehicle_ids)) {
      vehicleIds = body.vehicle_ids.map(String);
    } else if (body.business_id) {
      const { data: listings } = await supabase
        .from("external_listings")
        .select("vehicle_id")
        .eq("organization_id", body.business_id);
      vehicleIds = (listings || []).map((l: any) => String(l.vehicle_id)).filter(Boolean);
    } else {
      return new Response(JSON.stringify({ error: "Provide vehicle_id, vehicle_ids[], or business_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    vehicleIds = [...new Set(vehicleIds)];
    console.log(`[enrich-factory-specs] Processing ${vehicleIds.length} vehicles (dry_run=${dryRun}, force=${force})`);

    // Process vehicles concurrently (up to 10 at a time)
    const CONCURRENCY = 10;
    const results: any[] = [];
    let enriched = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = 0; i < vehicleIds.length; i += CONCURRENCY) {
      const chunk = vehicleIds.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map(async (vid) => {
          try {
            const result = await enrichVehicle(supabase, vid, dryRun, force);
            console.log(`[factory-specs] ${vid.slice(0, 8)}: ${result.status} (${result.fields_updated.length} fields, type=${result.vehicle_type})`);
            return result;
          } catch (e: any) {
            console.error(`[factory-specs] ${vid.slice(0, 8)}: error: ${e?.message || e}`);
            return { vehicle_id: vid, status: `error: ${e?.message || e}`, fields_updated: [], vehicle_type: "unknown", before: null, after: null };
          }
        })
      );
      for (const result of chunkResults) {
        results.push(result);
        if (result.status === "enriched" || result.status === "dry_run") enriched++;
        else if (result.status.startsWith("skip") || result.status === "already_enriched" || result.status === "all_columns_filled" || result.status === "no_valid_specs") skipped++;
        else errors++;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      dry_run: dryRun,
      total: vehicleIds.length,
      enriched,
      skipped,
      errors,
      results,
    }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    console.error("[enrich-factory-specs] Error:", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
