/**
 * Analyze Vehicle Description
 *
 * Extracts structured intelligence from vehicle descriptions.
 * - Tier 1: Regex patterns (free, fast)
 * - Tier 2: LLM extraction (paid, accurate)
 *
 * POST /functions/v1/analyze-vehicle-description
 * Body: { "vehicle_id": "uuid" } or { "batch_size": 20, "use_llm": false }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================
// TIER 1: REGEX PATTERNS (FREE)
// ============================================================

const TIER1_PATTERNS = {
  // Ownership
  owner_count: [
    { pattern: /\b(?:one|single|1st|first)[- ]?owner\b/i, value: 1 },
    { pattern: /\b(?:two|2nd|second)[- ]?owner\b/i, value: 2 },
    { pattern: /\b(?:three|3rd|third)[- ]?owner\b/i, value: 3 },
    { pattern: /\b(?:four|4th|fourth)[- ]?owner\b/i, value: 4 },
    { pattern: /\b(?:five|5th|fifth)[- ]?owner\b/i, value: 5 },
  ],

  // Acquisition
  acquisition_year: /(?:acquired|purchased|bought)(?: by the seller)?(?: in)? (\d{4})/i,
  previous_bat_sale: /(?:sold|listed|purchased) on (?:BaT|Bring a Trailer)/i,

  // Documentation
  has_service_records: /\b(?:service records?|maintenance records?|service history)\b/i,
  service_records_from_year: /service records?(?: dating)?(?: (?:back )?to| from) (\d{4})/i,
  has_window_sticker: /\b(?:window sticker|monroney)\b/i,
  has_owners_manual: /\b(?:owner'?s? manual|books?)\b/i,
  has_tools: /\b(?:tool (?:roll|kit)|tools)\b/i,
  has_spare_key: /\bspare key\b/i,

  // Condition
  is_running_driving: /\b(?:running[- ]and[- ]driving|runs and drives)\b/i,
  is_project: /\b(?:project|barn find|needs work|non[- ]running|not running)\b/i,
  is_restored: /\b(?:restored|restoration|frame[- ]off|rotisserie)\b/i,

  // Authenticity
  matching_numbers: /\b(?:numbers?[- ]matching|matching[- ]numbers?)\b/i,
  is_repainted: /\b(?:refinished in|repainted|respray|new paint)\b/i,
  is_original_color: /\b(?:original (?:color|paint)|factory (?:color|paint)|born with)\b/i,

  // Provenance
  california_car: /\b(?:california car|CA car|remained (?:registered )?in California)\b/i,
  never_winter: /\b(?:never seen snow|dry climate|never (?:driven|used) in winter|garaged winters?)\b/i,
  rust_free: /\b(?:rust[- ]free|no rust|zero rust)\b/i,

  // Rarity
  one_of_x: /\bone of (?:only )?(\d+)\b/i,
  number_of_total: /#?(\d+)\s*(?:of|\/)\s*(\d+)/i,
  limited_edition: /\b(?:limited edition|special edition|anniversary edition)\b/i,

  // Awards
  ncrs_top_flight: /\bNCRS Top Flight\b/i,
  bloomington_gold: /\bBloomington Gold\b/i,
  pca: /\bPCA\b/i,
  concours: /\bconcours\b/i,
};

function extractTier1(description: string): Record<string, any> {
  const result: Record<string, any> = {};

  if (!description) return result;

  // Owner count
  for (const { pattern, value } of TIER1_PATTERNS.owner_count) {
    if (pattern.test(description)) {
      result.owner_count = value;
      break;
    }
  }

  // Acquisition year
  const acqMatch = description.match(TIER1_PATTERNS.acquisition_year);
  if (acqMatch) {
    result.acquisition_year = parseInt(acqMatch[1]);
  }

  // Previous BaT sale
  result.previous_bat_sale_url = TIER1_PATTERNS.previous_bat_sale.test(description) ? "mentioned" : null;

  // Documentation
  result.has_service_records = TIER1_PATTERNS.has_service_records.test(description) || null;
  const svcYearMatch = description.match(TIER1_PATTERNS.service_records_from_year);
  if (svcYearMatch) {
    result.service_records_from_year = parseInt(svcYearMatch[1]);
    result.has_service_records = true;
  }
  result.has_window_sticker = TIER1_PATTERNS.has_window_sticker.test(description) || null;
  result.has_owners_manual = TIER1_PATTERNS.has_owners_manual.test(description) || null;
  result.has_tools = TIER1_PATTERNS.has_tools.test(description) || null;
  result.has_spare_key = TIER1_PATTERNS.has_spare_key.test(description) || null;

  // Condition
  if (TIER1_PATTERNS.is_running_driving.test(description)) {
    result.is_running = true;
    result.is_driving = true;
  }
  result.is_project = TIER1_PATTERNS.is_project.test(description) || null;
  result.is_restored = TIER1_PATTERNS.is_restored.test(description) || null;

  // Authenticity
  result.matching_numbers = TIER1_PATTERNS.matching_numbers.test(description) || null;
  result.is_repainted = TIER1_PATTERNS.is_repainted.test(description) || null;
  result.is_original_color = TIER1_PATTERNS.is_original_color.test(description) || null;

  // Provenance
  result.is_california_car = TIER1_PATTERNS.california_car.test(description) || null;
  result.never_winter_driven = TIER1_PATTERNS.never_winter.test(description) || null;
  result.is_rust_free = TIER1_PATTERNS.rust_free.test(description) || null;

  // Rarity
  const oneOfMatch = description.match(TIER1_PATTERNS.one_of_x);
  if (oneOfMatch) {
    result.total_production = parseInt(oneOfMatch[1]);
  }
  const numMatch = description.match(TIER1_PATTERNS.number_of_total);
  if (numMatch) {
    result.production_number = parseInt(numMatch[1]);
    result.total_production = parseInt(numMatch[2]);
  }
  result.is_limited_edition = TIER1_PATTERNS.limited_edition.test(description) || null;

  // Awards
  const awards: any[] = [];
  if (TIER1_PATTERNS.ncrs_top_flight.test(description)) {
    awards.push({ name: "NCRS Top Flight", year: null, score: null });
  }
  if (TIER1_PATTERNS.bloomington_gold.test(description)) {
    awards.push({ name: "Bloomington Gold", year: null, score: null });
  }
  if (TIER1_PATTERNS.pca.test(description)) {
    awards.push({ name: "PCA Award", year: null, score: null });
  }
  if (awards.length > 0) {
    result.awards = awards;
    result.is_show_winner = true;
  }
  result.is_concours_quality = TIER1_PATTERNS.concours.test(description) || null;

  // Extract parts replaced (common patterns)
  const partsMatch = description.match(/replaced?\s+(?:the\s+)?([^.]+(?:,\s*[^.]+)*)/gi);
  if (partsMatch) {
    const parts: string[] = [];
    for (const match of partsMatch) {
      const cleaned = match.replace(/replaced?\s+(?:the\s+)?/i, "").trim();
      if (cleaned.length > 3 && cleaned.length < 200) {
        parts.push(cleaned);
      }
    }
    if (parts.length > 0) {
      result.parts_replaced = parts;
    }
  }

  // Clean up null values
  for (const key of Object.keys(result)) {
    if (result[key] === null || result[key] === false) {
      delete result[key];
    }
  }

  return result;
}

// ============================================================
// TIER 2: LLM EXTRACTION (PAID)
// ============================================================

const LLM_SYSTEM_PROMPT = `You are a vehicle listing data extractor. Extract ONLY what is explicitly stated - do NOT infer or assume. Return valid JSON only.`;

const LLM_USER_PROMPT = `Extract structured data from this vehicle listing.

VEHICLE: {year} {make} {model}
DESCRIPTION:
---
{description}
---

Extract this JSON (use null for missing info):
{
  "acquisition": {"year": <int|null>, "source": <string|null>},
  "ownership": {"count": <int|null>, "notable_owner": <string|null>},
  "service_events": [{"date": <string>, "description": <string>, "shop": <string|null>}],
  "modifications": {"is_modified": <bool>, "level": <string|null>, "items": []},
  "condition": {"known_issues": [], "seller_notes": []},
  "authenticity": {"matching_numbers": <bool|null>, "is_repainted": <bool|null>, "replacement_components": []},
  "awards": [{"name": <string>, "year": <int|null>, "score": <float|null>}],
  "rarity": {"production_number": <int|null>, "total_production": <int|null>, "notes": []}
}

Return ONLY JSON.`;

async function extractTier2(
  description: string,
  vehicle: { year: number; make: string; model: string },
  anthropicKey: string
): Promise<Record<string, any> | null> {
  if (!anthropicKey) return null;

  const prompt = LLM_USER_PROMPT
    .replace("{year}", String(vehicle.year || ""))
    .replace("{make}", vehicle.make || "")
    .replace("{model}", vehicle.model || "")
    .replace("{description}", description.substring(0, 4000));

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 1024,
        system: LLM_SYSTEM_PROMPT,
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
  } catch (e) {
    console.error("Tier 2 extraction failed:", e);
  }

  return null;
}

// ============================================================
// MAIN HANDLER
// ============================================================

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

    const body = await req.json().catch(() => ({}));
    const vehicleId = body.vehicle_id;
    const batchSize = Math.min(body.batch_size || 20, 100);
    const useLlm = body.use_llm ?? false;
    const minPrice = body.min_price ?? 0;

    let vehicles: any[] = [];

    if (vehicleId) {
      // Single vehicle
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, year, make, model, description, sale_price")
        .eq("id", vehicleId)
        .single();

      if (error) throw error;
      if (data) vehicles = [data];
    } else {
      // Batch: get vehicles needing analysis
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, year, make, model, description, sale_price")
        .not("description", "is", null)
        .gte("sale_price", minPrice)
        .order("sale_price", { ascending: false, nullsFirst: false })
        .limit(batchSize);

      if (error) throw error;

      // Filter out already analyzed
      if (data && data.length > 0) {
        const ids = data.map((v: any) => v.id);
        const { data: existing } = await supabase
          .from("vehicle_intelligence")
          .select("vehicle_id")
          .in("vehicle_id", ids);

        const existingIds = new Set((existing || []).map((e: any) => e.vehicle_id));
        vehicles = data.filter((v: any) => !existingIds.has(v.id));
      }
    }

    if (vehicles.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: "No vehicles to analyze",
        analyzed: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const results = {
      analyzed: 0,
      tier1_only: 0,
      tier2_used: 0,
      errors: 0,
    };

    for (const vehicle of vehicles) {
      if (!vehicle.description || vehicle.description.length < 50) {
        results.errors++;
        continue;
      }

      try {
        // Tier 1: Regex extraction
        const tier1 = extractTier1(vehicle.description);

        // Tier 2: LLM extraction (optional)
        let tier2 = null;
        if (useLlm && anthropicKey) {
          tier2 = await extractTier2(vehicle.description, vehicle, anthropicKey);
          if (tier2) results.tier2_used++;
        }

        // Merge results (Tier 2 takes precedence where available)
        const merged: Record<string, any> = {
          vehicle_id: vehicle.id,
          extraction_version: "v1.0",
          extraction_method: tier2 ? "hybrid" : "regex",
          extraction_confidence: tier2 ? 0.85 : 0.6,
          raw_tier1_extraction: tier1,
          raw_tier2_extraction: tier2,
        };

        // Apply Tier 1 results
        Object.assign(merged, tier1);

        // Apply Tier 2 results (with mapping)
        if (tier2) {
          if (tier2.acquisition?.year) merged.acquisition_year = tier2.acquisition.year;
          if (tier2.acquisition?.source) merged.acquisition_source = tier2.acquisition.source;
          if (tier2.ownership?.count) merged.owner_count = tier2.ownership.count;
          if (tier2.ownership?.notable_owner) merged.notable_owner = tier2.ownership.notable_owner;
          if (tier2.service_events?.length > 0) merged.service_events = tier2.service_events;
          if (tier2.modifications?.is_modified !== undefined) merged.is_modified = tier2.modifications.is_modified;
          if (tier2.modifications?.level) merged.modification_level = tier2.modifications.level;
          if (tier2.modifications?.items?.length > 0) merged.modifications = tier2.modifications.items;
          if (tier2.condition?.known_issues?.length > 0) merged.known_issues = tier2.condition.known_issues;
          if (tier2.condition?.seller_notes?.length > 0) merged.seller_condition_notes = tier2.condition.seller_notes;
          if (tier2.authenticity?.matching_numbers !== undefined) merged.matching_numbers = tier2.authenticity.matching_numbers;
          if (tier2.authenticity?.is_repainted !== undefined) merged.is_repainted = tier2.authenticity.is_repainted;
          if (tier2.authenticity?.replacement_components?.length > 0) merged.replacement_components = tier2.authenticity.replacement_components;
          if (tier2.awards?.length > 0) merged.awards = tier2.awards;
          if (tier2.rarity?.production_number) merged.production_number = tier2.rarity.production_number;
          if (tier2.rarity?.total_production) merged.total_production = tier2.rarity.total_production;
          if (tier2.rarity?.notes?.length > 0) merged.rarity_notes = tier2.rarity.notes;
        }

        // Upsert to vehicle_intelligence
        const { error: upsertError } = await supabase
          .from("vehicle_intelligence")
          .upsert(merged, { onConflict: "vehicle_id" });

        if (upsertError) {
          console.error("Upsert error:", upsertError);
          results.errors++;
        } else {
          results.analyzed++;
          if (!tier2) results.tier1_only++;
        }
      } catch (e) {
        console.error("Analysis error:", e);
        results.errors++;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      ...results,
      vehicles_processed: vehicles.length,
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
