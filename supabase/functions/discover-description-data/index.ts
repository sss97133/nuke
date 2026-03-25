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
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

Be thorough — extract every condition-relevant statement. Include both positive and negative observations.
Return ONLY a valid JSON array. If no conditions found, return [].`;

// Multi-LLM fallback: Gemini (free, fast) → Grok → Haiku
async function callLLM(prompt: string): Promise<{ content: string; model: string }> {
  const errors: string[] = [];

  // 1. Gemini 2.5 Flash Lite (free tier, fastest)
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
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (content) return { content, model: "gemini-2.5-flash-lite" };
      } else {
        const errBody = await resp.text().catch(() => "");
        errors.push(`Gemini ${resp.status}: ${errBody.slice(0, 100)}`);
      }
    } catch (e: any) { errors.push(`Gemini: ${e.message}`); }
  }

  // 2. xAI Grok-3-Mini (cheap but uses reasoning tokens = slow)
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
        const content = data.choices?.[0]?.message?.content || "";
        if (content) return { content, model: "grok-3-mini" };
      } else {
        const errBody = await resp.text().catch(() => "");
        errors.push(`Grok ${resp.status}: ${errBody.slice(0, 100)}`);
      }
    } catch (e: any) { errors.push(`Grok: ${e.message}`); }
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
        const content = data.content?.[0]?.text || "";
        if (content) return { content, model: "claude-3-5-haiku-latest" };
      } else {
        const errBody = await resp.text().catch(() => "");
        errors.push(`Anthropic ${resp.status}: ${errBody.slice(0, 100)}`);
      }
    } catch (e: any) { errors.push(`Anthropic: ${e.message}`); }
  }

  throw new Error(`All LLMs failed: ${errors.join("; ")}`);
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
    .replace("{description}", description.substring(0, 8000));

  const { content, model } = await callLLM(prompt);

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return { data: JSON.parse(jsonMatch[0]), model };
  }

  return { data: { raw_response: content, parse_failed: true }, model };
}

async function extractConditionsWithLLM(
  description: string,
  vehicle: { year: number; make: string; model: string },
): Promise<{ conditions: any[]; model: string }> {
  const prompt = CONDITION_EXTRACTION_PROMPT
    .replace("{year}", String(vehicle.year || "Unknown"))
    .replace("{make}", vehicle.make || "Unknown")
    .replace("{model}", vehicle.model || "Unknown")
    .replace("{description}", description.substring(0, 8000));

  const { content, model } = await callLLM(prompt);

  const arrayMatch = content.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    const parsed = JSON.parse(arrayMatch[0]);
    return { conditions: Array.isArray(parsed) ? parsed : [], model };
  }

  return { conditions: [], model };
}

async function ingestConditionObservations(
  vehicleId: string,
  conditions: any[],
  supabaseUrl: string,
  serviceKey: string,
  modelUsed = "unknown"
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
        body: JSON.stringify({
          source_slug: "ai-description-extraction",
          kind: "condition",
          observed_at: new Date().toISOString(),
          content_text: condition.summary || condition.quote || "Unknown condition",
          structured_data: {
            category: condition.category,
            severity: condition.severity,
            component: condition.component,
            is_positive: condition.is_positive ?? false,
            quote: condition.quote,
          },
          vehicle_id: vehicleId,
          extraction_method: "description_condition_v1",
          agent_model: modelUsed,
        }),
      });

      if (resp.ok) {
        ingested++;
      } else {
        errors++;
        const errText = await resp.text().catch(() => "");
        console.error(`[discover-desc] Ingest failed for ${vehicleId}: ${errText.slice(0, 100)}`);
      }
    } catch (e: any) {
      errors++;
      console.error(`[discover-desc] Ingest error for ${vehicleId}: ${e.message}`);
    }
  }

  return { ingested, errors };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceKey);

    // At least one LLM key is required
    const hasAnyKey = Deno.env.get("XAI_API_KEY") || Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY") || Deno.env.get("ANTHROPIC_API_KEY");
    if (!hasAnyKey) {
      throw new Error("No LLM API key configured (need XAI_API_KEY, GEMINI_API_KEY, or ANTHROPIC_API_KEY)");
    }

    const body = await req.json().catch(() => ({}));
    const vehicleId = body.vehicle_id;
    const batchSize = Math.max(1, Math.min(body.batch_size || 10, 50));
    const minPrice = body.min_price ?? 0;
    const mode = body.mode as string | undefined;

    // --- CONDITION BACKFILL MODE ---
    if (mode === "condition_backfill") {
      const backfillBatch = Math.max(1, Math.min(body.batch_size || 20, 50));
      const { data: rows, error } = await supabase.rpc("execute_sql", {
        query: `SELECT v.id, v.year, v.make, v.model, v.description
                FROM vehicles v
                WHERE v.description IS NOT NULL
                  AND length(v.description) >= 100
                  AND v.deleted_at IS NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM vehicle_observations vo
                    WHERE vo.vehicle_id = v.id AND vo.kind = 'condition'
                  )
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
      const startTime = Date.now();

      for (const vehicle of backfillVehicles) {
        if (Date.now() - startTime > 50000) break;
        try {
          const { conditions, model: condModel } = await extractConditionsWithLLM(vehicle.description, vehicle);
          const { ingested, errors: errs } = await ingestConditionObservations(
            vehicle.id, conditions, supabaseUrl, serviceKey, condModel
          );
          totalIngested += ingested;
          totalErrors += errs;
          console.log(`[discover-desc] Backfill ${vehicle.year} ${vehicle.make} ${vehicle.model}: ${ingested} conditions`);
        } catch (e: any) {
          totalErrors++;
          console.error(`[discover-desc] Backfill error ${vehicle.id}: ${e.message}`);
        }
      }

      // Check remaining
      const { data: remData } = await supabase.rpc("execute_sql", {
        query: `SELECT count(*) AS remaining FROM vehicles v
                WHERE v.description IS NOT NULL AND length(v.description) >= 100
                AND v.deleted_at IS NULL
                AND NOT EXISTS (
                  SELECT 1 FROM vehicle_observations vo
                  WHERE vo.vehicle_id = v.id AND vo.kind = 'condition'
                )`
      });
      const remaining = Array.isArray(remData) ? Number(remData[0]?.remaining || 0) : 0;

      // Self-chain if requested
      const shouldContinue = body.continue ?? false;
      if (shouldContinue && remaining > 0 && totalIngested > 0) {
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
        remaining,
        continued: shouldContinue && remaining > 0,
        elapsed_ms: Date.now() - startTime,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- NORMAL DISCOVERY MODE ---
    let vehicles: any[] = [];

    if (vehicleId) {
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, year, make, model, description, sale_price")
        .eq("id", vehicleId)
        .single();
      if (error) throw error;
      if (data) vehicles = [data];
    } else {
      // Anti-join: get vehicles with descriptions NOT yet discovered
      // Uses primary key ordering (fast) instead of sale_price sort (slow full scan)
      const { data: rows, error } = await supabase.rpc("execute_sql", {
        query: `SELECT v.id, v.year, v.make, v.model, v.description,
                  COALESCE(v.sale_price, v.winning_bid, v.high_bid, v.bat_sold_price) AS sale_price
                FROM vehicles v
                WHERE v.description IS NOT NULL
                  AND length(v.description) >= 100
                  AND v.deleted_at IS NULL
                  AND NOT EXISTS (SELECT 1 FROM description_discoveries dd WHERE dd.vehicle_id = v.id)
                LIMIT ${batchSize}`
      });

      if (error) throw new Error(`Vehicle query failed: ${JSON.stringify(error)}`);
      vehicles = Array.isArray(rows) ? rows : [];
    }

    const shouldContinue = body.continue ?? false;
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
        if (!vehicle.description || vehicle.description.length < 100) {
          return { success: false, error: "Description too short" };
        }

        // --- Pass 1: Open-ended discovery (existing) ---
        const { data: discovered, model: discModel } = await discoverWithLLM(vehicle.description, vehicle);
        const keysFound = Object.keys(discovered).length;
        const totalFields = countFields(discovered);

        const { error: insertError } = await supabase
          .from("description_discoveries")
          .upsert({
            vehicle_id: vehicle.id,
            discovered_at: new Date().toISOString(),
            raw_extraction: discovered,
            keys_found: keysFound,
            total_fields: totalFields,
            description_length: vehicle.description.length,
            sale_price: vehicle.sale_price,
          }, { onConflict: "vehicle_id" });

        if (insertError) throw new Error(`Insert: ${insertError.message}`);

        // --- Pass 2: Condition extraction (new) ---
        let conditionResult = { ingested: 0, errors: 0 };
        try {
          const { conditions, model: condModel2 } = await extractConditionsWithLLM(vehicle.description, vehicle);
          conditionResult = await ingestConditionObservations(
            vehicle.id, conditions, supabaseUrl, serviceKey, condModel2
          );
          console.log(`[discover-desc] ${vehicle.year} ${vehicle.make} ${vehicle.model}: ${conditionResult.ingested} conditions extracted`);
        } catch (condErr: any) {
          // Condition extraction failure should not fail the whole vehicle
          console.error(`[discover-desc] Condition extraction failed for ${vehicle.id}: ${condErr.message}`);
          conditionResult.errors = 1;
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
        }
      }
    }

    // Get remaining count
    const { data: remData } = await supabase.rpc("execute_sql", {
      query: `SELECT count(*) AS remaining FROM vehicles v
              WHERE v.description IS NOT NULL AND length(v.description) >= 100
              AND v.deleted_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM description_discoveries dd WHERE dd.vehicle_id = v.id)`
    });
    const remaining = Array.isArray(remData) ? Number(remData[0]?.remaining || 0) : 0;

    // Self-continue if requested
    if (shouldContinue && remaining > 0 && results.discovered > 0) {
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
      continued: shouldContinue && remaining > 0,
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
