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

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
    .replace("{description}", description.substring(0, 6000)); // More context

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-haiku-20240307",
      max_tokens: 2048, // More room for thorough extraction
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const result = await response.json();
  const content = result.content?.[0]?.text || "";

  // Parse JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }

  return { raw_response: content, parse_failed: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const incomingAuth = req.headers.get("authorization") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
    const tokenForClient = incomingAuth.startsWith("Bearer ")
      ? incomingAuth.substring(7)
      : serviceKey;
    const supabase = createClient(supabaseUrl, tokenForClient);

    if (!anthropicKey) {
      throw new Error("ANTHROPIC_API_KEY not configured");
    }

    const body = await req.json().catch(() => ({}));
    const vehicleId = body.vehicle_id;
    const batchSize = Math.min(body.batch_size || 10, 20); // Small batches for learning
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
      // Get vehicles not yet in discovery table
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, year, make, model, description, sale_price")
        .not("description", "is", null)
        .gte("sale_price", minPrice)
        .order("sale_price", { ascending: false })
        .limit(batchSize * 2); // Fetch extra to filter

      if (error) throw error;

      if (data && data.length > 0) {
        // Filter out already discovered
        const ids = data.map((v: any) => v.id);
        const { data: existing } = await supabase
          .from("description_discoveries")
          .select("vehicle_id")
          .in("vehicle_id", ids);

        const existingIds = new Set((existing || []).map((e: any) => e.vehicle_id));
        vehicles = data.filter((v: any) => !existingIds.has(v.id)).slice(0, batchSize);
      }
    }

    if (vehicles.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: "No vehicles to discover",
        discovered: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const results = {
      discovered: 0,
      errors: 0,
      samples: [] as any[],
    };

    for (const vehicle of vehicles) {
      if (!vehicle.description || vehicle.description.length < 100) {
        results.errors++;
        continue;
      }

      try {
        console.log(`Discovering: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);

        const discovered = await discoverWithLLM(vehicle.description, vehicle, anthropicKey);

        // Count keys found (depth 1)
        const keysFound = Object.keys(discovered).length;
        const totalFields = countFields(discovered);

        // Store in discovery table
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

        if (insertError) {
          console.error("Insert error:", insertError);
          results.errors++;
        } else {
          results.discovered++;
          // Keep first 3 as samples
          if (results.samples.length < 3) {
            results.samples.push({
              vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
              price: vehicle.sale_price,
              keys_found: keysFound,
              total_fields: totalFields,
              sample_keys: Object.keys(discovered).slice(0, 10),
            });
          }
        }
      } catch (e: any) {
        console.error("Discovery error:", e);
        results.errors++;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      ...results,
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
