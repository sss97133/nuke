/**
 * Discover Description Data
 *
 * LEARNING PHASE extractor - unconstrained LLM extraction.
 * Captures EVERYTHING the LLM finds, not limited to predefined schema.
 * Used to discover what data exists before committing to final schema.
 *
 * POST /functions/v1/discover-description-data
 * Body: { "vehicle_id": "uuid" } or { "batch_size": 10 }
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

async function discoverWithLLM(
  description: string,
  vehicle: { year: number; make: string; model: string; sale_price: number },
  anthropicKey: string
): Promise<any> {
  const prompt = DISCOVERY_PROMPT
    .replace("{year}", String(vehicle.year || "Unknown"))
    .replace("{make}", vehicle.make || "Unknown")
    .replace("{model}", vehicle.model || "Unknown")
    .replace("{sale_price}", vehicle.sale_price ? `$${vehicle.sale_price.toLocaleString()}` : "Unknown")
    .replace("{description}", description.substring(0, 8000));

  const response = await fetch("https://api.anthropic.com/v1/messages", {
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

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Anthropic ${response.status}: ${errText.slice(0, 200)}`);
  }

  const result = await response.json();
  const content = result.content?.[0]?.text || "";

  // Parse JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }

  return { raw_response: content, parse_failed: true };
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

    if (!anthropicKey) {
      throw new Error("ANTHROPIC_API_KEY not configured");
    }

    const body = await req.json().catch(() => ({}));
    const vehicleId = body.vehicle_id;
    const batchSize = Math.max(1, Math.min(body.batch_size || 10, 50));
    const minPrice = body.min_price ?? 0;

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

        const discovered = await discoverWithLLM(vehicle.description, vehicle, anthropicKey);
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

        return {
          success: true,
          sample: {
            vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
            price: vehicle.sale_price,
            keys_found: keysFound,
            total_fields: totalFields,
          },
        };
      });

      const settled = await Promise.allSettled(promises);
      for (let j = 0; j < settled.length; j++) {
        const r = settled[j];
        if (r.status === "fulfilled" && r.value.success) {
          results.discovered++;
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
