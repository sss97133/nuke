/**
 * Discover Description Data
 *
 * LEARNING PHASE extractor - unconstrained LLM extraction.
 * Captures EVERYTHING the LLM finds, not limited to predefined schema.
 * Used to discover what data exists before committing to final schema.
 *
 * Also extracts discrete CONDITION observations and ingests them via ingest-observation.
 *
 * POST /functions/v1/discover-description-data
 * Body: { "vehicle_id": "uuid" } or { "batch_size": 10 } or { "mode": "condition_backfill" }
 * Service-only { "mode": "preview", "vehicle_id": "uuid" } reads preserved evidence without mining.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateWriter, requireWriteAuth } from "../_shared/writeGuard.ts";
import { conditionObservationInput, descriptionPreview, descriptionSourceMetadata,
  loadDescriptionInput, requireCompleteInput, type DescriptionInput } from "./descriptionInput.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Open-ended discovery prompt - let the LLM find everything
const DISCOVERY_PROMPT = `You are analyzing a vehicle auction listing. Extract ALL factual information you can find.

VEHICLE: {year} {make} {model}
SALE PRICE: {sale_price}

LISTING DESCRIPTION:
---
{description}
---

Extract EVERYTHING factual from this description. Be thorough. Include:
- Any dates, years, timeframes mentioned
- Any numbers (mileage, production numbers, prices, measurements)
- Any people mentioned (owners, shops, dealers, celebrities)
- Any locations mentioned (cities, states, countries)
- Any work done (service, repairs, restoration, modifications)
- Any parts mentioned (replaced, original, aftermarket)
- Any documentation mentioned (records, manuals, certificates)
- Any condition notes (issues, wear, damage, preservation)
- Any awards or certifications
- Any claims about originality or authenticity
- Any rarity claims
- Any provenance information
- ANYTHING ELSE that seems notable

Return a JSON object. Create whatever keys make sense for the data you find.
Group related information logically. Use snake_case for keys.
For arrays of items, use descriptive objects not just strings.

Example structure (adapt as needed):
{
  "acquisition": {...},
  "ownership_history": [...],
  "service_history": [...],
  "modifications": [...],
  "parts_mentioned": [...],
  "documentation": {...},
  "condition": {...},
  "authenticity": {...},
  "provenance": {...},
  "awards": [...],
  "rarity": {...},
  "notable_claims": [...],
  "numbers_mentioned": {...},
  "people_mentioned": [...],
  "locations_mentioned": [...],
  "dates_mentioned": [...],
  "other": {...}
}

Preserve uncertainty and distinguish offered parts from installed parts. Do not infer dates,
originality, ownership, or a positive condition that the source does not assert.
Be exhaustive. Capture everything. Return ONLY valid JSON.`;

// Condition-specific extraction prompt
const CONDITION_EXTRACTION_PROMPT = `You are a vehicle condition assessor analyzing an auction listing description. Extract EVERY discrete condition observation.

VEHICLE: {year} {make} {model}

LISTING DESCRIPTION:
---
{description}
---

Extract individual condition observations. Look for:
- Known imperfections (dents, scratches, chips, cracks, wear marks)
- Modifications from factory spec (aftermarket parts, swaps, upgrades, deletions)
- Paint condition (repainted, original, patina, touch-ups, color changes)
- Rust or corrosion (surface rust, bubbling, rust-free claims, undercoating)
- Mechanical state (running condition, known issues, recent repairs, noises)
- Interior condition (tears, wear, re-upholstery, cracks, stains, originality)
- Missing or replaced parts (original parts absent, reproduction parts used)
- Documentation state (service records, ownership history docs, build sheet, window sticker)

For each observation, determine:
- category: one of "imperfection", "modification", "paint", "rust", "mechanical", "interior", "missing_part", "documentation", "structural", "electrical", "glass", "trim", "wheels_tires", "general"
- severity: "info" (neutral fact), "minor" (cosmetic/small), "moderate" (notable but not critical), "major" (significant concern), "positive" (explicitly good condition)
- component: the specific part or area (e.g., "driver door", "engine", "dashboard", "frame rails")
- is_positive: true if this is a GOOD condition note (e.g., "rust-free", "original paint in excellent condition")
- quote: the EXACT text from the description that supports this observation (copy verbatim)

Return a JSON array of condition items. Each item:
{
  "category": "...",
  "severity": "...",
  "component": "...",
  "is_positive": true/false,
  "summary": "one-sentence plain English summary",
  "quote": "exact quote from description"
}

Preserve uncertainty: an offered part is not an installed part, and needing repair is not completed work.
Be thorough — extract every condition-relevant statement. Include both positive and negative observations.
Return ONLY a valid JSON array. If no conditions found, return [].`;

// Multi-LLM fallback: Kimi (fast, cheap) → Grok → Gemini → Haiku
async function callLLM(prompt: string): Promise<{ content: string; model: string }> {
  const errors: string[] = [];

  // 1. Kimi k2-turbo (OpenAI-compatible, fast ~2s, good JSON)
  const kimiKey = Deno.env.get("KIMI_API_KEY") || "";
  if (kimiKey) {
    try {
      const resp = await fetch("https://api.moonshot.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${kimiKey}` },
        body: JSON.stringify({
          model: "kimi-k2-turbo-preview",
          temperature: 0.1,
          max_tokens: 2048,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.choices?.[0]?.finish_reason === "length") throw new Error("Kimi output truncated");
        const content = data.choices?.[0]?.message?.content || "";
        if (content) return { content, model: data.model || "kimi-k2-turbo-preview" };
      } else {
        const errBody = await resp.text().catch(() => "");
        errors.push(`Kimi ${resp.status}: ${errBody.slice(0, 100)}`);
      }
    } catch (e: any) { errors.push(`Kimi: ${e.message}`); }
  }

  // 2. xAI Grok-3-Mini (cheap, uses reasoning tokens = slower ~10-40s)
  const xaiKey = Deno.env.get("XAI_API_KEY") || "";
  if (xaiKey) {
    try {
      const resp = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${xaiKey}` },
        body: JSON.stringify({
          model: "grok-3-mini",
          temperature: 0.1,
          max_tokens: 2048,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.choices?.[0]?.finish_reason === "length") throw new Error("Grok output truncated");
        const content = data.choices?.[0]?.message?.content || "";
        if (content) return { content, model: data.model || "grok-3-mini" };
      } else {
        const errBody = await resp.text().catch(() => "");
        errors.push(`Grok ${resp.status}: ${errBody.slice(0, 100)}`);
      }
    } catch (e: any) { errors.push(`Grok: ${e.message}`); }
  }

  // 3. Gemini 2.5 Flash Lite (free tier)
  const googleKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY") || "";
  if (googleKey) {
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${googleKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
          }),
        }
      );
      if (resp.ok) {
        const data = await resp.json();
        if (data.candidates?.[0]?.finishReason === "MAX_TOKENS") throw new Error("Gemini output truncated");
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (content) return { content, model: data.modelVersion || "gemini-2.5-flash-lite" };
      } else {
        const errBody = await resp.text().catch(() => "");
        errors.push(`Gemini ${resp.status}: ${errBody.slice(0, 100)}`);
      }
    } catch (e: any) { errors.push(`Gemini: ${e.message}`); }
  }

  // 3. Anthropic Haiku (fallback)
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") || "";
  if (anthropicKey) {
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-3-5-haiku-latest",
          max_tokens: 2048,
          temperature: 0.1,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.stop_reason === "max_tokens") throw new Error("Anthropic output truncated");
        const content = data.content?.[0]?.text || "";
        if (content) return { content, model: data.model || "claude-3-5-haiku-latest" };
      } else {
        const errBody = await resp.text().catch(() => "");
        errors.push(`Anthropic ${resp.status}: ${errBody.slice(0, 100)}`);
      }
    } catch (e: any) { errors.push(`Anthropic: ${e.message}`); }
  }

  throw new Error(`All LLMs failed: ${errors.join("; ")}`);
}

// Strip markdown code blocks (Kimi wraps JSON in ```json ... ```)
function stripCodeBlocks(text: string): string {
  return text.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();
}

// Repair common LLM JSON errors: trailing commas, single-line comments
function repairJson(text: string): string {
  // Remove single-line comments (// ...)
  let fixed = text.replace(/\/\/[^\n]*/g, "");
  // Remove trailing commas before } or ]
  fixed = fixed.replace(/,\s*([}\]])/g, "$1");
  return fixed;
}

async function discoverWithLLM(
  description: string,
  vehicle: { year: number; make: string; model: string; sale_price: number },
): Promise<{ data: any; model: string }> {
  const prompt = DISCOVERY_PROMPT
    .replace("{year}", String(vehicle.year || "Unknown"))
    .replace("{make}", vehicle.make || "Unknown")
    .replace("{model}", vehicle.model || "Unknown")
    .replace("{sale_price}", vehicle.sale_price ? `$${vehicle.sale_price.toLocaleString()}` : "Unknown")
    .replace("{description}", () => requireCompleteInput({ text: description } as DescriptionInput).text);

  const { content: raw, model } = await callLLM(prompt);
  const content = stripCodeBlocks(raw);

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return { data: JSON.parse(jsonMatch[0]), model };
    } catch {
      // Try repairing common JSON errors
      const repaired = repairJson(jsonMatch[0]);
      return { data: JSON.parse(repaired), model };
    }
  }

  throw new Error("Discovery returned no JSON object; not cached");
}

async function extractConditionsWithLLM(
  description: string,
  vehicle: { year: number; make: string; model: string },
): Promise<{ conditions: any[]; model: string }> {
  const prompt = CONDITION_EXTRACTION_PROMPT
    .replace("{year}", String(vehicle.year || "Unknown"))
    .replace("{make}", vehicle.make || "Unknown")
    .replace("{model}", vehicle.model || "Unknown")
    .replace("{description}", () => requireCompleteInput({ text: description } as DescriptionInput).text);

  const { content: raw, model } = await callLLM(prompt);
  const content = stripCodeBlocks(raw);

  const arrayMatch = content.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (!Array.isArray(parsed)) throw new Error("Condition extraction returned no array");
      return { conditions: parsed, model };
    } catch {
      const repaired = repairJson(arrayMatch[0]);
      const parsed = JSON.parse(repaired);
      if (!Array.isArray(parsed)) throw new Error("Condition extraction returned no array");
      return { conditions: parsed, model };
    }
  }

  throw new Error("Condition extraction returned no JSON array");
}

async function ingestConditionObservations(
  vehicleId: string,
  conditions: any[],
  supabaseUrl: string,
  serviceKey: string,
  modelUsed: string,
  input: DescriptionInput,
): Promise<{ ingested: number; errors: number }> {
  let ingested = 0;
  let errors = 0;

  for (const condition of conditions) {
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/ingest-observation`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(conditionObservationInput(vehicleId, condition, input, modelUsed)),
      });

      const result = await resp.json().catch(() => null);
      if (resp.ok && result?.success === true && result?.observation_id) {
        ingested++;
      } else {
        errors++;
        console.error(`[discover-desc] Ingest refused condition for ${vehicleId} (HTTP ${resp.status})`);
      }
    } catch (e: any) {
      errors++;
      console.error(`[discover-desc] Ingest error for ${vehicleId}: ${e.message}`);
    }
  }

  return { ingested, errors };
}

Deno.serve(async (req) => {
  // Writes are never anonymous: service key, signed-in user, or nothing (P0.2, 2026-09-27).
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const vehicleId = body.vehicle_id;
    const batchSize = Math.max(1, Math.min(body.batch_size || 10, 50));
    const minPrice = body.min_price ?? 0;
    const mode = body.mode as string | undefined;
    if (vehicleId !== undefined && (typeof vehicleId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(vehicleId))) {
      throw new Error("Invalid vehicle_id");
    }

    // A private operator preview uses stored evidence only: no model, writes or
    // continuation. It makes the exact input/refusal verifiable after deployment.
    if (mode === "preview") {
      const writer = await authenticateWriter(req);
      if (!writer.ok || writer.caller.kind !== "service_role") {
        return new Response(JSON.stringify({ error: "Description preview requires service role" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (!vehicleId) {
        throw new Error("Description preview requires one vehicle_id");
      }
      const { data: vehicle, error } = await supabase.from("vehicles")
        .select("id,listing_url,discovery_url").eq("id", vehicleId)
        .is("deleted_at", null).or("listing_kind.is.null,listing_kind.neq.non_vehicle_item").single();
      if (error || !vehicle) throw new Error("Preview vehicle unavailable");
      const input = await loadDescriptionInput(supabase, vehicle);
      return new Response(JSON.stringify({ success: true, mode, vehicle_id: vehicleId,
        ...descriptionPreview(input), model_calls: 0, writes: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Existing discovery is retained. A repeat request never overwrites it or
    // spends inference again just because a newer full text is now readable.
    if (vehicleId && mode !== "condition_backfill") {
      const { data: cached, error } = await supabase.from("description_discoveries")
        .select("id,discovered_at,keys_found").eq("vehicle_id", vehicleId).maybeSingle();
      if (error) throw new Error("Discovery cache lookup failed");
      if (cached) return new Response(JSON.stringify({ success: true, cached: true,
        discovered: 0, conditions_ingested: 0, discovery_id: cached.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const hasAnyKey = Deno.env.get("KIMI_API_KEY") || Deno.env.get("XAI_API_KEY") || Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY") || Deno.env.get("ANTHROPIC_API_KEY");
    if (!hasAnyKey) {
      throw new Error("No LLM API key configured (need KIMI_API_KEY, XAI_API_KEY, GEMINI_API_KEY, or ANTHROPIC_API_KEY)");
    }

    // --- CONDITION BACKFILL MODE ---
    if (mode === "condition_backfill") {
      const backfillBatch = Math.max(1, Math.min(body.batch_size || 20, 50));
      // Summary length only admits candidates; the preserved input must be >=500.
      const { data: rows, error } = vehicleId
        ? await supabase.from("vehicles").select("id,year,make,model,listing_url,discovery_url")
          .eq("id", vehicleId).is("deleted_at", null)
          .or("listing_kind.is.null,listing_kind.neq.non_vehicle_item")
        : await supabase.rpc("execute_sql", {
        query: `SELECT v.id, v.year, v.make, v.model, v.description, v.listing_url, v.discovery_url
                FROM vehicles v
                WHERE v.description IS NOT NULL
                  AND length(v.description) >= 100
                  AND v.deleted_at IS NULL
                  AND coalesce(v.listing_kind,'') <> 'non_vehicle_item'
                  AND NOT EXISTS (
                    SELECT 1 FROM vehicle_observations vo
                    WHERE vo.vehicle_id = v.id AND vo.kind = 'condition'
                  )
                ORDER BY length(v.description) DESC
                LIMIT ${backfillBatch}`
      });

      if (error) throw new Error(`Backfill query failed: ${JSON.stringify(error)}`);
      const backfillVehicles = Array.isArray(rows) ? rows : [];

      if (backfillVehicles.length === 0) {
        return new Response(JSON.stringify({
          success: true,
          mode: "condition_backfill",
          message: "No vehicles need condition backfill",
          processed: 0,
          remaining: 0,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      console.log(`[discover-desc] Condition backfill: ${backfillVehicles.length} vehicles`);

      let totalIngested = 0;
      let totalErrors = 0;
      const errorDetails: string[] = [];
      const startTime = Date.now();

      for (const vehicle of backfillVehicles) {
        if (Date.now() - startTime > 50000) break;
        try {
          const input = await loadDescriptionInput(supabase, vehicle);
          if (input.text.length < 500) throw new Error("Preserved source too short for condition backfill");
          const { conditions, model: condModel } = await extractConditionsWithLLM(input.text, vehicle);
          console.log(`[discover-desc] ${vehicle.id}: LLM=${condModel}, ${conditions.length} conditions, input=${input.text.length} chars`);
          const { ingested, errors: errs } = await ingestConditionObservations(
            vehicle.id, conditions, supabaseUrl, serviceKey, condModel, input
          );
          totalIngested += ingested;
          totalErrors += errs;
          console.log(`[discover-desc] Backfill ${vehicle.year} ${vehicle.make} ${vehicle.model}: ${ingested} ingested, ${errs} errors`);
        } catch (e: any) {
          totalErrors++;
          errorDetails.push(`${vehicle.id}: ${e.message}`);
          console.error(`[discover-desc] Backfill error ${vehicle.id}: ${e.message}`);
        }
      }

      // Check if more work exists (fast: just check if 1 more vehicle exists, not full count)
      const { data: remData } = vehicleId ? { data: [] } : await supabase.rpc("execute_sql", {
        query: `SELECT EXISTS(
                  SELECT 1 FROM vehicles v
                  WHERE v.description IS NOT NULL AND length(v.description) >= 100
                  AND v.deleted_at IS NULL
                  AND coalesce(v.listing_kind,'') <> 'non_vehicle_item'
                  AND NOT EXISTS (
                    SELECT 1 FROM vehicle_observations vo
                    WHERE vo.vehicle_id = v.id AND vo.kind = 'condition'
                  ) LIMIT 1
                ) AS has_more`
      });
      const hasMore = Array.isArray(remData) ? (remData[0]?.has_more === true) : false;
      const remaining = hasMore ? -1 : 0; // -1 = more work exists, exact count too expensive

      // Self-chain if requested
      const shouldContinue = !vehicleId && (body.continue ?? false);
      // An all-refused batch must not self-chain indefinitely.
      if (shouldContinue && hasMore && totalIngested > 0) {
        fetch(`${supabaseUrl}/functions/v1/discover-description-data`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ mode: "condition_backfill", batch_size: backfillBatch, continue: true }),
        }).catch(e => console.error("[discover-desc] Backfill chain failed:", e));
      }

      return new Response(JSON.stringify({
        success: true,
        mode: "condition_backfill",
        processed: backfillVehicles.length,
        conditions_ingested: totalIngested,
        condition_errors: totalErrors,
        error_details: errorDetails,
        remaining,
        continued: shouldContinue && hasMore && totalIngested > 0,
        elapsed_ms: Date.now() - startTime,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- NORMAL DISCOVERY MODE ---
    let vehicles: any[] = [];

    if (vehicleId) {
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, year, make, model, description, sale_price, listing_url, discovery_url")
        .eq("id", vehicleId)
        .is("deleted_at", null).or("listing_kind.is.null,listing_kind.neq.non_vehicle_item")
        .single();
      if (error) throw error;
      if (data) vehicles = [data];
    } else {
      // Anti-join: get vehicles with descriptions NOT yet discovered
      // Uses primary key ordering (fast) instead of sale_price sort (slow full scan)
      const { data: rows, error } = await supabase.rpc("execute_sql", {
        query: `SELECT v.id, v.year, v.make, v.model, v.description, v.listing_url, v.discovery_url,
                  COALESCE(v.sale_price, v.winning_bid, v.high_bid, v.bat_sold_price) AS sale_price
                FROM vehicles v
                WHERE v.description IS NOT NULL
                  AND length(v.description) >= 100
                  AND v.deleted_at IS NULL
                  AND coalesce(v.listing_kind,'') <> 'non_vehicle_item'
                  AND NOT EXISTS (SELECT 1 FROM description_discoveries dd WHERE dd.vehicle_id = v.id)
                LIMIT ${batchSize}`
      });

      if (error) throw new Error(`Vehicle query failed: ${JSON.stringify(error)}`);
      vehicles = Array.isArray(rows) ? rows : [];
    }

    const shouldContinue = !vehicleId && (body.continue ?? false);
    const startTime = Date.now();

    if (vehicles.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: "No vehicles to discover",
        discovered: 0,
        remaining: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`[discover-desc] Processing ${vehicles.length} vehicles`);

    const PARALLEL = 5;
    const results = {
      discovered: 0,
      errors: 0,
      error_details: [] as string[],
      samples: [] as any[],
      conditions_ingested: 0,
      condition_errors: 0,
    };

    for (let i = 0; i < vehicles.length; i += PARALLEL) {
      // Time budget: leave 10s for cleanup
      if (Date.now() - startTime > 50000) {
        console.log(`[discover-desc] Time budget exceeded at vehicle ${i}, stopping`);
        break;
      }

      const chunk = vehicles.slice(i, i + PARALLEL);
      const promises = chunk.map(async (vehicle: any) => {
        const input = await loadDescriptionInput(supabase, vehicle);
        if (input.text.length < 100) throw new Error("Preserved listing text too short");

        // --- Pass 1: Open-ended discovery (existing) ---
        const { data: discovered, model: discModel } = await discoverWithLLM(input.text, vehicle);
        const keysFound = Object.keys(discovered).length;
        const totalFields = countFields(discovered);

        // --- Pass 2: Condition extraction (new) ---
        let conditionResult = { ingested: 0, errors: 0 };
        try {
          const { conditions, model: condModel2 } = await extractConditionsWithLLM(input.text, vehicle);
          conditionResult = await ingestConditionObservations(
            vehicle.id, conditions, supabaseUrl, serviceKey, condModel2, input
          );
          console.log(`[discover-desc] ${vehicle.year} ${vehicle.make} ${vehicle.model}: ${conditionResult.ingested} conditions extracted`);
        } catch (condErr: any) {
          // Condition extraction failure should not fail the whole vehicle
          console.error(`[discover-desc] Condition extraction failed for ${vehicle.id}: ${condErr.message}`);
          conditionResult.errors = 1;
        }

        // Await the sanctioned observation writer. The old bridge independently
        // gap-filled canonical vehicle fields; mining only produces cited reports.
        const { error: observationError, data: observationResult } = await supabase.functions.invoke("ingest-observation", {
          body: { vehicle_id: vehicle.id, source_slug: "ai-description-extraction", kind: "specification",
            source_url: input.sourceUrl, raw_source_ref: input.sourceRef,
            observed_at: input.observedAt || input.ingestedAt,
            structured_data: { ...discovered, is_inferred: true, ...descriptionSourceMetadata(input) },
            extraction_metadata: { inference_at: new Date().toISOString(), ...descriptionSourceMetadata(input) },
            citation: { excerpt: input.text }, extraction_method: "description_discovery_v2_full_source",
            agent_model: discModel, agent_inferred: true, defer_analysis: true },
        });
        if (observationError || observationResult?.success !== true || !observationResult?.observation_id) {
          throw new Error("Sanctioned discovery observation intake failed");
        }

        const { error: insertError } = await supabase
          .from("description_discoveries")
          .insert({
            vehicle_id: vehicle.id,
            discovered_at: new Date().toISOString(),
            raw_extraction: discovered,
            keys_found: keysFound,
            total_fields: totalFields,
            description_length: input.text.length,
            model_used: discModel,
            prompt_version: "full-preserved-source-v1",
            sale_price: vehicle.sale_price,
          });

        if (insertError) throw new Error(`Insert: ${insertError.message}`);

        // Recompute realization plan with new condition data
        try {
          await supabase.rpc('persist_realization_plan', { p_vehicle_id: vehicle.id });
        } catch (rpErr: any) {
          console.error(`[discover-desc] realization plan failed for ${vehicle.id}: ${rpErr.message}`);
        }

        return {
          success: true,
          conditionResult,
          sample: {
            vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
            price: vehicle.sale_price,
            keys_found: keysFound,
            total_fields: totalFields,
            conditions_ingested: conditionResult.ingested,
          },
        };
      });

      const settled = await Promise.allSettled(promises);
      for (let j = 0; j < settled.length; j++) {
        const r = settled[j];
        if (r.status === "fulfilled" && r.value.success) {
          results.discovered++;
          results.conditions_ingested += r.value.conditionResult?.ingested || 0;
          results.condition_errors += r.value.conditionResult?.errors || 0;
          if (results.samples.length < 3) results.samples.push(r.value.sample);
        } else {
          results.errors++;
          const msg = r.status === "rejected" ? r.reason?.message : r.value?.error;
          results.error_details.push(`${chunk[j]?.id}: ${msg}`);
          // Refusal/intake failure remains retryable and visible in error_details.
          // A fake cached discovery would suppress the missing work forever.

        }
      }
    }

    // Check if more work exists (fast EXISTS, not expensive count)
    const { data: remData } = vehicleId ? { data: [] } : await supabase.rpc("execute_sql", {
      query: `SELECT EXISTS(
                SELECT 1 FROM vehicles v
                WHERE v.description IS NOT NULL AND length(v.description) >= 100
                AND v.deleted_at IS NULL
                AND coalesce(v.listing_kind,'') <> 'non_vehicle_item'
                AND NOT EXISTS (SELECT 1 FROM description_discoveries dd WHERE dd.vehicle_id = v.id)
              ) AS has_more`
    });
    const hasMore = Array.isArray(remData) ? (remData[0]?.has_more === true) : false;
    const remaining = hasMore ? -1 : 0; // -1 = more work exists, exact count too expensive

    // Self-continue if requested
    if (shouldContinue && hasMore && results.discovered > 0) {
      fetch(`${supabaseUrl}/functions/v1/discover-description-data`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ batch_size: batchSize, min_price: minPrice, continue: true }),
      }).catch(e => console.error("[discover-desc] Continue chain failed:", e));
    }

    return new Response(JSON.stringify({
      success: true,
      ...results,
      remaining,
      elapsed_ms: Date.now() - startTime,
      continued: shouldContinue && hasMore && results.discovered > 0,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    return new Response(JSON.stringify({
      success: false,
      error: e.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

// Count total fields recursively
function countFields(obj: any, depth = 0): number {
  if (depth > 5) return 0;
  if (obj === null || obj === undefined) return 0;
  if (typeof obj !== "object") return 1;
  if (Array.isArray(obj)) {
    return obj.reduce((sum, item) => sum + countFields(item, depth + 1), 0);
  }
  return Object.values(obj).reduce((sum: number, val) => sum + countFields(val, depth + 1), 0);
}
