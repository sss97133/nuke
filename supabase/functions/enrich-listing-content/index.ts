/**
 * ENRICH LISTING CONTENT
 *
 * Reads archived BaT HTML from listing_page_snapshots and uses LLM to extract
 * listing-specific content: highlights, equipment, modifications, known_flaws,
 * recent_service_history, title_status, and condition_rating.
 *
 * POST /functions/v1/enrich-listing-content
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

const ENRICHMENT_VERSION = "enrich-listing-content:1.0.0";

// ─── HTML extraction (from enrich-vehicle-profile-ai) ────────────────
function htmlToCleanText(html: string, maxLen = 15000): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "")
    .replace(/<h[1-6][^>]*>/gi, "\n## ")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<(?:strong|b)[^>]*>/gi, "**")
    .replace(/<\/(?:strong|b)>/gi, "**")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr)>/gi, "\n")
    .replace(/<td[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#038;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (text.length > maxLen) {
    text = text.slice(0, maxLen) + "\n...[truncated]";
  }
  return text;
}

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
    if (items.length > 0) sections.push(`LISTING DETAILS:\n${items.map(i => `- ${i}`).join("\n")}`);
  }

  // Description/excerpt — get more of it for content extraction
  const excerptMatch =
    html.match(/<div[^>]*class=["'][^"']*post-excerpt[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
    html.match(/<div[^>]*class=["'][^"']*post-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (excerptMatch?.[1]) {
    const text = excerptMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text.length > 40) sections.push(`DESCRIPTION:\n${text.slice(0, 8000)}`);
  }

  // Auction result
  const resultMatch = html.match(/<div[^>]*class=["'][^"']*listing-available-actions[\s\S]*?<\/div>/i) ||
    html.match(/<div[^>]*class=["'][^"']*auction-result[\s\S]*?<\/div>/i);
  if (resultMatch?.[0]) {
    const text = resultMatch[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text.length > 10) sections.push(`AUCTION RESULT: ${text.slice(0, 500)}`);
  }

  // Category
  const catMatch = html.match(/<strong[^>]*>Category<\/strong>\s*([^<]+)/i);
  if (catMatch?.[1]) sections.push(`CATEGORY: ${catMatch[1].trim()}`);

  return sections.join("\n\n") || htmlToCleanText(html);
}

// ─── LLM caller ──────────────────────────────────────────────────────
async function callLLM(prompt: string, systemPrompt: string): Promise<string> {
  const providers = [
    { key: Deno.env.get("XAI_API_KEY"), url: "https://api.x.ai/v1/chat/completions", model: "grok-3-mini", name: "xAI" },
    { key: Deno.env.get("VITE_OPENAI_API_KEY"), url: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini", name: "OpenAI-proj" },
    { key: Deno.env.get("OPENAI_API_KEY"), url: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini", name: "OpenAI-svc" },
  ].filter(p => p.key);

  if (providers.length === 0) throw new Error("No AI API keys available");

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
          temperature: 0.1,
          ...(provider.name !== "xAI" ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: AbortSignal.timeout(45000),
      });

      if (!resp.ok) {
        const err = await resp.text().catch(() => "unknown");
        lastError = `${provider.name} ${resp.status}: ${err}`;
        console.warn(`[listing-content] ${provider.name} failed: ${resp.status}`);
        continue;
      }

      const data = await resp.json();
      const content = data?.choices?.[0]?.message?.content ?? "";
      if (content) {
        console.log(`[listing-content] Using ${provider.name} (${provider.model})`);
        return content;
      }
    } catch (e: any) {
      lastError = `${provider.name}: ${e?.message || e}`;
      console.warn(`[listing-content] ${provider.name} error: ${lastError}`);
    }
  }

  throw new Error(`All AI providers failed. Last: ${lastError}`);
}

// ─── System prompt ───────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a vehicle listing content analyst. Given an auction listing page, extract specific content fields from what is EXPLICITLY stated in the listing text.

RULES:
- Return ONLY valid JSON, no markdown fencing, no explanation
- Extract ONLY information explicitly stated in the listing — do NOT infer or assume
- Use null for any field where information is not clearly stated
- Keep text fields concise but complete — use semicolons to separate multiple items
- Do NOT include generic boilerplate or marketing language

FIELD GUIDELINES:
- highlights: Key selling points explicitly mentioned (e.g., "Numbers-matching engine; Low mileage; Recent repaint in original color; Factory AC"). 2-6 bullet items joined by semicolons.
- equipment: Notable factory and aftermarket equipment explicitly listed (e.g., "Power steering; AM/FM radio; Kelsey-Hayes disc brakes; Magnaflow exhaust"). Include both factory options and additions.
- modifications: Any changes from stock configuration (e.g., "Edelbrock intake manifold; MSD ignition; Upgraded to electronic fuel injection"). Use null if described as "stock" or "unmodified".
- known_flaws: Any disclosed issues, damage, wear, or imperfections (e.g., "Rust bubbles on rear quarter; AC not functional; Small dent on driver door"). Use null if none mentioned.
- recent_service_history: Maintenance, repairs, or restoration work mentioned (e.g., "Engine rebuilt 2023; New clutch 5k miles ago; Full respray 2022"). Use null if none mentioned.
- title_status: One of: "Clean", "Salvage", "Rebuilt", "Lien", "Export", "Bill of Sale", "Bonded". Default to "Clean" if the listing says "clean title" or doesn't mention title issues.
- condition_rating: Integer 1-10 based on overall impression:
  1-2: Non-running, major damage/rust
  3-4: Running but needs significant work
  5-6: Driver quality, moderate wear, some issues
  7-8: Good to excellent, well-maintained, minor imperfections
  9-10: Concours/show quality, exceptional/restored`;

// ─── Target columns ──────────────────────────────────────────────────
const CONTENT_COLUMNS = [
  "highlights", "equipment", "modifications", "known_flaws",
  "recent_service_history", "title_status", "condition_rating",
];

// ─── Enrich a single vehicle ─────────────────────────────────────────
async function enrichVehicle(
  supabase: any,
  vehicleId: string,
  dryRun: boolean,
  force: boolean,
): Promise<{ vehicle_id: string; status: string; fields_updated: string[]; before: any; after: any }> {
  const { data: vehicle, error: vErr } = await supabase
    .from("vehicles")
    .select("id, year, make, model, trim, body_style, discovery_url, listing_url, bat_auction_url, bat_listing_title, listing_title, highlights, equipment, modifications, known_flaws, recent_service_history, title_status, condition_rating, origin_metadata")
    .eq("id", vehicleId)
    .maybeSingle();

  if (vErr || !vehicle) {
    return { vehicle_id: vehicleId, status: "not_found", fields_updated: [], before: null, after: null };
  }

  // Check if already enriched
  if (!force && vehicle.origin_metadata?.listing_content_enriched) {
    return { vehicle_id: vehicleId, status: "already_enriched", fields_updated: [], before: vehicle, after: null };
  }

  // Check if there are any null columns to fill
  const nullCols = CONTENT_COLUMNS.filter(col => vehicle[col] === null || vehicle[col] === undefined);
  if (nullCols.length === 0) {
    return { vehicle_id: vehicleId, status: "all_columns_filled", fields_updated: [], before: vehicle, after: null };
  }

  // Find archived HTML (same lookup as enrich-vehicle-profile-ai)
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

  const prompt = `Extract listing content from this BaT auction listing for a ${vehicleContext}:

${listingContent}

Return JSON with these fields (only extract what's stated in the listing):
{
  "highlights": string|null,
  "equipment": string|null,
  "modifications": string|null,
  "known_flaws": string|null,
  "recent_service_history": string|null,
  "title_status": string|null,
  "condition_rating": number|null
}`;

  let llmResponse: string;
  try {
    llmResponse = await callLLM(prompt, SYSTEM_PROMPT);
  } catch (e: any) {
    return { vehicle_id: vehicleId, status: `llm_error: ${e?.message || e}`, fields_updated: [], before: vehicle, after: null };
  }

  // Parse JSON
  let content: Record<string, any>;
  try {
    let jsonStr = llmResponse.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }
    content = JSON.parse(jsonStr);
  } catch (e: any) {
    return { vehicle_id: vehicleId, status: `parse_error: ${e?.message}`, fields_updated: [], before: vehicle, after: { raw: llmResponse.slice(0, 500) } };
  }

  // Build update payload — only write to NULL columns
  const updatePayload: Record<string, any> = {};
  const fieldsUpdated: string[] = [];

  for (const col of CONTENT_COLUMNS) {
    if (vehicle[col] !== null && vehicle[col] !== undefined) continue;

    const newVal = content[col];
    if (newVal === null || newVal === undefined) continue;

    if (col === "condition_rating") {
      const rating = typeof newVal === "number" ? newVal : parseInt(String(newVal), 10);
      if (!isNaN(rating) && rating >= 1 && rating <= 10) {
        updatePayload[col] = rating;
        fieldsUpdated.push(col);
      }
    } else if (col === "title_status") {
      const valid = ["Clean", "Salvage", "Rebuilt", "Lien", "Export", "Bill of Sale", "Bonded"];
      const strVal = String(newVal).trim();
      // Normalize
      const matched = valid.find(v => v.toLowerCase() === strVal.toLowerCase());
      if (matched) {
        updatePayload[col] = matched;
        fieldsUpdated.push(col);
      }
    } else {
      // Text field
      const strVal = String(newVal).trim();
      if (strVal && strVal.toLowerCase() !== "null" && strVal.toLowerCase() !== "n/a" && strVal.length > 3 && strVal.length <= 5000) {
        updatePayload[col] = strVal;
        fieldsUpdated.push(col);
      }
    }
  }

  // Mark enrichment
  updatePayload.origin_metadata = {
    ...(vehicle.origin_metadata || {}),
    listing_content_enriched: true,
    listing_content_version: ENRICHMENT_VERSION,
    listing_content_at: new Date().toISOString(),
    listing_content_fields: fieldsUpdated.length,
  };
  updatePayload.updated_at = new Date().toISOString();

  const afterState = { content_returned: content, fields_updated: fieldsUpdated };

  if (fieldsUpdated.length === 0) {
    if (!dryRun) {
      await supabase.from("vehicles").update({
        origin_metadata: updatePayload.origin_metadata,
        updated_at: updatePayload.updated_at,
      }).eq("id", vehicleId);
    }
    return { vehicle_id: vehicleId, status: "no_valid_content", fields_updated: [], before: vehicle, after: afterState };
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
    console.log(`[enrich-listing-content] Processing ${vehicleIds.length} vehicles (dry_run=${dryRun}, force=${force})`);

    // Process vehicles concurrently (up to 25 at a time)
    const CONCURRENCY = 25;
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
            console.log(`[listing-content] ${vid.slice(0, 8)}: ${result.status} (${result.fields_updated.length} fields)`);
            return result;
          } catch (e: any) {
            console.error(`[listing-content] ${vid.slice(0, 8)}: error: ${e?.message || e}`);
            return { vehicle_id: vid, status: `error: ${e?.message || e}`, fields_updated: [], before: null, after: null };
          }
        })
      );
      for (const result of chunkResults) {
        results.push(result);
        if (result.status === "enriched" || result.status === "dry_run") enriched++;
        else if (result.status === "already_enriched" || result.status === "all_columns_filled" || result.status === "no_snapshot" || result.status === "no_valid_content") skipped++;
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
    console.error("[enrich-listing-content] Error:", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
