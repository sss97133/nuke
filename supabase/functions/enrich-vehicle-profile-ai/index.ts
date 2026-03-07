/**
 * ENRICH VEHICLE PROFILE AI
 *
 * Reads archived HTML from listing_page_snapshots and uses an LLM to extract
 * clean, validated vehicle spec fields. Designed to fix data quality issues
 * from regex-only extraction (polluted trim, wrong body_style, missing hp/torque).
 *
 * POST /functions/v1/enrich-vehicle-profile-ai
 * Body: {
 *   "vehicle_id": string,        // single vehicle
 *   "vehicle_ids": string[],     // batch mode
 *   "business_id": string,       // all vehicles for a business/seller
 *   "dry_run": boolean,          // default false - preview without writing
 *   "force": boolean             // re-enrich even if already enriched
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ENRICHMENT_VERSION = "enrich-vehicle-profile-ai:1.0.0";

/** Strip HTML to clean text, keeping structure hints */
function htmlToCleanText(html: string, maxLen = 12000): string {
  let text = html
    // Remove scripts, styles
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    // Convert list items to bullets
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/li>/gi, "")
    // Convert headings to emphasis
    .replace(/<h[1-6][^>]*>/gi, "\n## ")
    .replace(/<\/h[1-6]>/gi, "\n")
    // Convert <strong>/<b> to emphasis markers
    .replace(/<(?:strong|b)[^>]*>/gi, "**")
    .replace(/<\/(?:strong|b)>/gi, "**")
    // Convert <br> and block elements to newlines
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr)>/gi, "\n")
    .replace(/<td[^>]*>/gi, " | ")
    // Strip remaining tags
    .replace(/<[^>]+>/g, " ")
    // Decode entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#038;/g, "&")
    // Normalize whitespace
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (text.length > maxLen) {
    text = text.slice(0, maxLen) + "\n...[truncated]";
  }
  return text;
}

/** Extract just the listing content section from BaT HTML */
function extractListingContent(html: string): string {
  const sections: string[] = [];

  // Title
  const h1 = html.match(/<h1[^>]*class=["'][^"']*post-title[^"']*["'][^>]*>([^<]+)<\/h1>/i);
  if (h1?.[1]) sections.push(`TITLE: ${h1[1].trim()}`);

  // Listing Details section
  const detailsMatch = html.match(/<strong>Listing Details<\/strong>[\s\S]*?<ul>([\s\S]*?)<\/ul>/i);
  if (detailsMatch?.[1]) {
    const items: string[] = [];
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let m: RegExpExecArray | null;
    while ((m = liRe.exec(detailsMatch[1])) !== null) {
      const t = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (t) items.push(t);
    }
    if (items.length > 0) sections.push(`LISTING DETAILS:\n${items.map(i => `• ${i}`).join("\n")}`);
  }

  // Description/excerpt
  const excerptMatch =
    html.match(/<div[^>]*class=["'][^"']*post-excerpt[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
    html.match(/<div[^>]*class=["'][^"']*post-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (excerptMatch?.[1]) {
    const text = excerptMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text.length > 40) sections.push(`DESCRIPTION:\n${text.slice(0, 4000)}`);
  }

  // Auction result table
  const resultMatch = html.match(/<div[^>]*class=["'][^"']*listing-available-actions[\s\S]*?<\/div>/i) ||
    html.match(/<div[^>]*class=["'][^"']*auction-result[\s\S]*?<\/div>/i);
  if (resultMatch?.[0]) {
    const text = resultMatch[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text.length > 10) sections.push(`AUCTION RESULT: ${text.slice(0, 500)}`);
  }

  // Category
  const catMatch = html.match(/<strong[^>]*>Category<\/strong>\s*([^<]+)/i);
  if (catMatch?.[1]) sections.push(`CATEGORY: ${catMatch[1].trim()}`);

  // Stats table (bids, comments, views)
  const statsMatch = html.match(/listing-stats[\s\S]*?<\/div>/i);
  if (statsMatch?.[0]) {
    const text = statsMatch[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    sections.push(`STATS: ${text.slice(0, 300)}`);
  }

  return sections.join("\n\n") || htmlToCleanText(html);
}

interface EnrichedFields {
  trim: string | null;
  body_style: string | null;
  transmission: string | null;
  drivetrain: string | null;
  engine_type: string | null;
  engine_displacement: string | null;
  horsepower: number | null;
  torque: number | null;
  color: string | null;
  color_primary: string | null;
  interior_color: string | null;
  vin: string | null;
  condition_notes: string | null;
}

async function callLLM(prompt: string, systemPrompt: string): Promise<string> {
  // Try providers in order: xAI (Grok), OpenAI (project key), OpenAI (service key)
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
          max_tokens: 1024,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
          temperature: 0.1,
          ...(provider.name !== "xAI" ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!resp.ok) {
        const err = await resp.text().catch(() => "unknown");
        lastError = `${provider.name} ${resp.status}: ${err}`;
        console.warn(`[enrich] ${provider.name} failed: ${resp.status}`);
        continue;
      }

      const data = await resp.json();
      const content = data?.choices?.[0]?.message?.content ?? "";
      if (content) {
        console.log(`[enrich] Using ${provider.name} (${provider.model})`);
        return content;
      }
    } catch (e: any) {
      lastError = `${provider.name}: ${e?.message || e}`;
      console.warn(`[enrich] ${provider.name} error: ${lastError}`);
    }
  }

  throw new Error(`All AI providers failed. Last: ${lastError}`);
}

const SYSTEM_PROMPT = `You are a vehicle data extraction specialist. Given a BaT (Bring a Trailer) listing page content, extract precise vehicle specification fields.

RULES:
- Return ONLY valid JSON, no markdown fencing, no explanation
- Use null for any field you cannot confidently determine
- For trim: Use the SPECIFIC trim/package level only (e.g., "SS", "GT", "SLT", "Limited", "Sport", "4x4"). Do NOT include the full vehicle title. Do NOT include year/make/model. If no specific trim level exists, use null.
- For body_style: Use one of: Coupe, Convertible, Roadster, Sedan, Wagon, Hatchback, Truck, SUV, Van, RV, Motorcycle, Targa, Speedster. Pick the most specific accurate option.
- For transmission: Use a clean short form like "5-Speed Manual", "4-Speed Automatic", "6-Speed Sequential", "CVT", "PDK". Strip redundant words like "Transmission" or "Gearbox".
- For drivetrain: Use ONLY one of: RWD, FWD, AWD, 4WD. If the vehicle has 4x4/four-wheel drive, use 4WD.
- For engine_type: Short description like "5.0L V8", "2.5L Flat-4", "Turbocharged 3.0L Inline-6"
- For engine_displacement: Just the displacement like "5.0L", "3.8L", "2,494cc"
- For horsepower: Integer number only (e.g., 350). Factory spec if listed, or commonly known value for the exact year/model/engine.
- For torque: Integer number in lb-ft only (e.g., 295). Same rules as horsepower.
- For color/color_primary: The ACTUAL exterior color name. Short, clean. e.g., "Silver", "Guards Red", "Grabber Blue". Not sentence fragments.
- For interior_color: The interior color/material. e.g., "Black Leather", "Tan Vinyl", "Saddle"
- For vin: Only a real VIN (11-17 characters, no I/O/Q). If uncertain, use null.
- For condition_notes: 1-2 sentence summary of vehicle condition/modifications if apparent from listing.

IMPORTANT: If this is a non-vehicle item (engine only, parts, etc.), set body_style to "Part" and leave vehicle-specific fields as null.`;

async function enrichVehicle(
  supabase: any,
  vehicleId: string,
  dryRun: boolean,
): Promise<{ vehicle_id: string; status: string; fields_updated: string[]; before: any; after: any }> {
  // Get vehicle and its listing URL
  const { data: vehicle, error: vErr } = await supabase
    .from("vehicles")
    .select("id, year, make, model, trim, body_style, transmission, drivetrain, engine_type, engine_displacement, horsepower, torque, color, color_primary, interior_color, vin, condition_rating, discovery_url, listing_url, bat_auction_url, bat_listing_title, listing_title")
    .eq("id", vehicleId)
    .maybeSingle();

  if (vErr || !vehicle) {
    return { vehicle_id: vehicleId, status: "not_found", fields_updated: [], before: null, after: null };
  }

  // Find archived HTML
  const urls = [vehicle.discovery_url, vehicle.listing_url, vehicle.bat_auction_url].filter(Boolean);
  const urlVariants: string[] = [];
  for (const u of urls) {
    urlVariants.push(u);
    if (u.endsWith("/")) urlVariants.push(u.slice(0, -1));
    else urlVariants.push(u + "/");
  }

  const { data: snapshot } = await supabase
    .from("listing_page_snapshots")
    .select("html")
    .eq("platform", "bat")
    .eq("success", true)
    .in("listing_url", [...new Set(urlVariants)])
    .order("fetched_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (!snapshot?.html || String(snapshot.html).length < 1000) {
    return { vehicle_id: vehicleId, status: "no_snapshot", fields_updated: [], before: vehicle, after: null };
  }

  // Extract listing content for LLM
  const listingContent = extractListingContent(snapshot.html);
  const vehicleContext = `${vehicle.year || ""} ${vehicle.make || ""} ${vehicle.model || ""}`.trim();

  const prompt = `Extract vehicle specs from this BaT listing for a ${vehicleContext}:\n\n${listingContent}\n\nReturn JSON with these fields: trim, body_style, transmission, drivetrain, engine_type, engine_displacement, horsepower, torque, color, color_primary, interior_color, vin, condition_notes`;

  let llmResponse: string;
  try {
    llmResponse = await callLLM(prompt, SYSTEM_PROMPT);
  } catch (e: any) {
    return { vehicle_id: vehicleId, status: `llm_error: ${e?.message || e}`, fields_updated: [], before: vehicle, after: null };
  }

  // Parse JSON from LLM response
  let enriched: EnrichedFields;
  try {
    // Handle potential markdown fencing
    let jsonStr = llmResponse.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }
    enriched = JSON.parse(jsonStr);
  } catch (e: any) {
    return { vehicle_id: vehicleId, status: `parse_error: ${e?.message}`, fields_updated: [], before: vehicle, after: { raw: llmResponse.slice(0, 500) } };
  }

  // Build update payload - only overwrite fields that are missing, wrong, or clearly polluted
  const updatePayload: Record<string, any> = {};
  const fieldsUpdated: string[] = [];

  const isBatBoilerplate = (s: string): boolean => {
    const t = (s || "").toLowerCase();
    return t.includes("for sale on bat") || t.includes("bring a trailer") || t.includes("lot #") || t.includes("|");
  };

  const shouldUpdate = (field: string, existing: any, newVal: any): boolean => {
    if (newVal === null || newVal === undefined) return false;
    if (existing === null || existing === undefined || String(existing).trim() === "") return true;
    // Overwrite if existing is polluted
    const existStr = String(existing);
    const existLower = existStr.toLowerCase();
    if (isBatBoilerplate(existStr)) return true;
    if (field === "trim" && existStr.length > 40) return true;
    if (field === "color" && (existStr.length > 50 || /\b(during|aforementioned|powered by|details include)\b/i.test(existStr))) return true;
    if (field === "transmission" && existStr.length > 60) return true;
    if (field === "body_style" && (existStr === "Door Coupe" || existStr === "Truck & 4x4")) return true;
    if (field === "body_style" && existStr === "Convertible" && (newVal === "Truck" || newVal === "SUV")) return true;
    if (field === "vin" && (existStr.length < 11 || /[a-z]/.test(existStr.slice(0, 17)))) return true;
    if (field === "drivetrain" && existLower === "awd" && (newVal === "4WD" || newVal === "RWD")) return true;
    if (field === "drivetrain" && existLower === "fwd" && (newVal === "RWD" || newVal === "AWD" || newVal === "4WD")) return true;
    // Keep existing if it looks reasonable
    return false;
  };

  // Map enriched fields to DB columns
  const fieldMappings: [string, keyof EnrichedFields, string][] = [
    ["trim", "trim", "trim"],
    ["body_style", "body_style", "body_style"],
    ["transmission", "transmission", "transmission"],
    ["drivetrain", "drivetrain", "drivetrain"],
    ["engine_type", "engine_type", "engine_type"],
    ["engine_displacement", "engine_displacement", "engine_displacement"],
    ["horsepower", "horsepower", "horsepower"],
    ["torque", "torque", "torque"],
    ["color", "color", "color"],
    ["color_primary", "color_primary", "color_primary"],
    ["interior_color", "interior_color", "interior_color"],
    ["vin", "vin", "vin"],
  ];

  for (const [dbCol, enrichedKey, fieldName] of fieldMappings) {
    const newVal = enriched[enrichedKey];
    const existingVal = (vehicle as any)[dbCol];
    if (shouldUpdate(fieldName, existingVal, newVal)) {
      updatePayload[dbCol] = newVal;
      fieldsUpdated.push(fieldName);
    }
  }

  // Condition notes are informational only - stored in the response but not written to DB
  // (no condition_description column exists; condition_rating is numeric)

  // Mark enrichment
  updatePayload.extractor_version = ENRICHMENT_VERSION;
  updatePayload.updated_at = new Date().toISOString();

  const afterState = { ...enriched, fields_updated: fieldsUpdated };

  if (fieldsUpdated.length === 0) {
    return { vehicle_id: vehicleId, status: "no_changes_needed", fields_updated: [], before: vehicle, after: afterState };
  }

  if (dryRun) {
    return { vehicle_id: vehicleId, status: "dry_run", fields_updated: fieldsUpdated, before: vehicle, after: afterState };
  }

  const { error: updateErr } = await supabase
    .from("vehicles")
    .update(updatePayload)
    .eq("id", vehicleId);

  if (updateErr) {
    return { vehicle_id: vehicleId, status: `update_error: ${updateErr.message}`, fields_updated: [], before: vehicle, after: afterState };
  }

  return { vehicle_id: vehicleId, status: "enriched", fields_updated: fieldsUpdated, before: vehicle, after: afterState };
}

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
      // Get all vehicles for this business via vehicle_events
      const { data: listings } = await supabase
        .from("vehicle_events")
        .select("vehicle_id")
        .eq("source_organization_id", body.business_id);
      vehicleIds = (listings || []).map((l: any) => String(l.vehicle_id)).filter(Boolean);
    } else {
      return new Response(JSON.stringify({ error: "Provide vehicle_id, vehicle_ids[], or business_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Deduplicate
    vehicleIds = [...new Set(vehicleIds)];
    console.log(`[enrich-vehicle-profile-ai] Processing ${vehicleIds.length} vehicles (dry_run=${dryRun})`);

    const results = [];
    let enriched = 0;
    let skipped = 0;
    let errors = 0;

    for (const vid of vehicleIds) {
      try {
        const result = await enrichVehicle(supabase, vid, dryRun);
        results.push(result);

        if (result.status === "enriched" || result.status === "dry_run") enriched++;
        else if (result.status === "no_changes_needed" || result.status === "no_snapshot") skipped++;
        else errors++;

        console.log(`[enrich] ${vid}: ${result.status} (${result.fields_updated.length} fields)`);
      } catch (e: any) {
        console.error(`[enrich] ${vid}: error: ${e?.message || e}`);
        results.push({ vehicle_id: vid, status: `error: ${e?.message || e}`, fields_updated: [], before: null, after: null });
        errors++;
      }

      // Small delay between LLM calls to avoid rate limits
      if (vehicleIds.length > 1) {
        await new Promise(r => setTimeout(r, 500));
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
    console.error("[enrich-vehicle-profile-ai] Error:", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
