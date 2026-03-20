/**
 * BATCH REPAIR VEHICLES FROM SNAPSHOTS
 *
 * Finds vehicles with missing specs that have archived HTML snapshots,
 * re-extracts data using AI. Works across ALL platforms (not just BaT).
 *
 * POST /functions/v1/batch-repair-vehicles
 * Body: {
 *   "batch_size": number,       // vehicles per run (default 20, max 100)
 *   "platform": string,         // target platform: "bat", "bonhams", "mecum", "barrett-jackson", "all"
 *   "dry_run": boolean,
 *   "min_missing_fields": number, // min missing fields to qualify (default 3)
 *   "offset": number
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ENRICHMENT_VERSION = "batch-repair-vehicles:1.0.0";

const EXTRACT_FIELDS = [
  "trim", "body_style", "transmission", "drivetrain", "engine_type",
  "engine_displacement", "horsepower", "torque", "color", "color_primary",
  "interior_color", "vin", "mileage", "description",
] as const;

// Platform-specific content extraction
function extractContent(html: string, platform: string): string {
  if (platform === "bat") return extractBatContent(html);
  if (platform === "bonhams") return extractBonhamsContent(html);
  if (platform === "mecum") return extractMecumContent(html);
  if (platform === "barrett-jackson") return extractBarrettJacksonContent(html);
  return htmlToText(html);
}

function extractBatContent(html: string): string {
  const sections: string[] = [];
  const h1 = html.match(/<h1[^>]*class=["'][^"']*post-title[^"']*["'][^>]*>([^<]+)<\/h1>/i);
  if (h1?.[1]) sections.push(`TITLE: ${h1[1].trim()}`);

  const detailsMatch = html.match(/<strong>Listing Details<\/strong>[\s\S]*?<ul>([\s\S]*?)<\/ul>/i);
  if (detailsMatch?.[1]) {
    const items: string[] = [];
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let m: RegExpExecArray | null;
    while ((m = liRe.exec(detailsMatch[1])) !== null) {
      const t = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (t) items.push(t);
    }
    if (items.length) sections.push(`LISTING DETAILS:\n${items.map(i => `• ${i}`).join("\n")}`);
  }

  const excerptMatch =
    html.match(/<div[^>]*class=["'][^"']*post-excerpt[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
    html.match(/<div[^>]*class=["'][^"']*post-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (excerptMatch?.[1]) {
    const text = excerptMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text.length > 40) sections.push(`DESCRIPTION:\n${text.slice(0, 6000)}`);
  }

  const resultMatch = html.match(/<div[^>]*class=["'][^"']*listing-available-actions[\s\S]*?<\/div>/i) ||
    html.match(/<div[^>]*class=["'][^"']*auction-result[\s\S]*?<\/div>/i);
  if (resultMatch?.[0]) {
    const text = resultMatch[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text.length > 10) sections.push(`AUCTION RESULT: ${text.slice(0, 500)}`);
  }

  return sections.join("\n\n") || htmlToText(html);
}

function extractBonhamsContent(html: string): string {
  const sections: string[] = [];
  // JSON-LD
  const jsonLdMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLdMatch?.[1]) {
    try {
      const ld = JSON.parse(jsonLdMatch[1]);
      if (ld.name) sections.push(`TITLE: ${ld.name}`);
      if (ld.description) sections.push(`DESCRIPTION: ${ld.description.slice(0, 6000)}`);
      if (ld.offers?.price) sections.push(`PRICE: ${ld.offers.priceCurrency || ""} ${ld.offers.price}`);
    } catch { /* ignore */ }
  }
  // Meta description fallback
  const metaDesc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  if (metaDesc?.[1] && sections.length < 2) sections.push(`META DESCRIPTION: ${metaDesc[1]}`);

  return sections.join("\n\n") || htmlToText(html);
}

function extractMecumContent(html: string): string {
  // Try __NEXT_DATA__ first
  const nextData = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextData?.[1]) {
    try {
      const nd = JSON.parse(nextData[1]);
      const post = nd?.props?.pageProps?.post || nd?.props?.pageProps?.lot;
      if (post) {
        const parts: string[] = [];
        if (post.title) parts.push(`TITLE: ${post.title}`);
        if (post.content) parts.push(`DESCRIPTION: ${post.content.replace(/<[^>]+>/g, " ").slice(0, 6000)}`);
        if (post.vinSerial) parts.push(`VIN: ${post.vinSerial}`);
        if (post.transmission) parts.push(`TRANSMISSION: ${post.transmission}`);
        if (post.color) parts.push(`EXTERIOR COLOR: ${post.color}`);
        if (post.interior) parts.push(`INTERIOR COLOR: ${post.interior}`);
        if (post.lotSeries) parts.push(`ENGINE: ${post.lotSeries}`);
        return parts.join("\n");
      }
    } catch { /* fallback */ }
  }
  return htmlToText(html);
}

function extractBarrettJacksonContent(html: string): string {
  const sections: string[] = [];
  // JSON-LD
  const jsonLdMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLdMatch?.[1]) {
    try {
      const ld = JSON.parse(jsonLdMatch[1]);
      if (ld.name) sections.push(`TITLE: ${ld.name}`);
      if (ld.description) sections.push(`DESCRIPTION: ${ld.description.slice(0, 6000)}`);
    } catch { /* ignore */ }
  }
  // og:title fallback
  const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (ogTitle?.[1]) sections.push(`OG TITLE: ${ogTitle[1]}`);

  return sections.join("\n\n") || htmlToText(html);
}

function htmlToText(html: string, maxLen = 12000): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<h[1-6][^>]*>/gi, "\n## ")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return text.length > maxLen ? text.slice(0, maxLen) + "\n...[truncated]" : text;
}

const SYSTEM_PROMPT = `You are a vehicle data extraction specialist. Given auction listing content, extract vehicle specs.

RULES:
- Return ONLY valid JSON, no markdown fencing
- Use null for any field you cannot confidently determine
- trim: Specific trim/package only (e.g., "SS", "GT", "Limited"). NOT the full title. Max 40 chars.
- body_style: One of: Coupe, Convertible, Roadster, Sedan, Wagon, Hatchback, Truck, SUV, Van, Targa, Speedster, Motorcycle
- transmission: Short form like "5-Speed Manual", "4-Speed Automatic", "PDK"
- drivetrain: ONLY one of: RWD, FWD, AWD, 4WD
- engine_type: Short like "5.0L V8", "2.5L Flat-4", "Turbocharged 3.0L I6"
- engine_displacement: Just displacement like "5.0L", "3.8L", "2494cc"
- horsepower: Integer only. Factory spec or commonly known value.
- torque: Integer lb-ft only. Factory spec or commonly known value.
- color: Actual exterior color. Short, clean. e.g., "Silver", "Guards Red"
- interior_color: Interior color/material. e.g., "Black Leather", "Tan Vinyl"
- vin: Only real VINs (11-17 chars, no I/O/Q). If uncertain, null.
- mileage: Integer miles only. If shown in km, convert.
- description: 1-2 sentence summary of the vehicle from the listing.`;

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
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${provider.key}` },
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
        lastError = `${provider.name} ${resp.status}`;
        continue;
      }

      const data = await resp.json();
      const content = data?.choices?.[0]?.message?.content ?? "";
      if (content) return content;
    } catch (e: any) {
      lastError = `${provider.name}: ${e?.message || e}`;
    }
  }
  throw new Error(`All AI providers failed. Last: ${lastError}`);
}

function isBatBoilerplate(s: string): boolean {
  const t = (s || "").toLowerCase();
  return t.includes("for sale on bat") || t.includes("bring a trailer") || t.includes("lot #") || t.includes("|");
}

function shouldUpdate(field: string, existing: any, newVal: any): boolean {
  if (newVal === null || newVal === undefined) return false;
  if (typeof newVal === "string" && newVal.trim() === "") return false;
  if (existing === null || existing === undefined || String(existing).trim() === "") return true;
  const existStr = String(existing);
  if (isBatBoilerplate(existStr)) return true;
  if (field === "trim" && existStr.length > 40) return true;
  if (field === "color" && (existStr.length > 50 || /\b(during|aforementioned|powered by|details include)\b/i.test(existStr))) return true;
  if (field === "transmission" && existStr.length > 60) return true;
  if (field === "body_style" && (existStr === "Door Coupe" || existStr === "Truck & 4x4")) return true;
  return false;
}

Deno.serve(async (req) => {
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
    const batchSize = Math.min(Math.max(Number(body.batch_size) || 20, 1), 100);
    const platform = body.platform || "bat";
    const dryRun = body.dry_run === true;
    const minMissing = Math.max(Number(body.min_missing_fields) || 3, 1);
    const offset = Number(body.offset) || 0;

    console.log(`[batch-repair] batch=${batchSize} platform=${platform} dry=${dryRun} minMissing=${minMissing} offset=${offset}`);

    // Find vehicles with snapshots that are missing specs
    // Join vehicles to listing_page_snapshots via multiple URL columns
    const urlJoin = platform === "bat"
      ? `lps.listing_url = v.bat_auction_url OR lps.listing_url = v.discovery_url OR lps.listing_url = v.listing_url`
      : `lps.listing_url = v.discovery_url OR lps.listing_url = v.listing_url OR lps.listing_url = v.platform_url`;

    const platformFilter = platform === "all" ? "" : `AND lps.platform = '${platform.replace(/'/g, "''")}'`;

    const missingScore = EXTRACT_FIELDS.map(f => {
      if (["horsepower", "torque", "mileage"].includes(f)) {
        return `CASE WHEN v.${f} IS NULL THEN 1 ELSE 0 END`;
      }
      return `CASE WHEN v.${f} IS NULL OR v.${f} = '' THEN 1 ELSE 0 END`;
    }).join(" + ");

    const findSql = `
      SELECT DISTINCT ON (v.id)
        v.id as vehicle_id,
        v.year, v.make, v.model,
        v.trim, v.body_style, v.transmission, v.drivetrain, v.engine_type,
        v.engine_displacement, v.horsepower, v.torque, v.color, v.color_primary,
        v.interior_color, v.vin, v.mileage, v.description,
        lps.listing_url as snapshot_url,
        lps.platform as snapshot_platform,
        (${missingScore}) as missing_count
      FROM vehicles v
      JOIN listing_page_snapshots lps ON (${urlJoin})
      WHERE lps.html IS NOT NULL AND length(lps.html) > 500
        AND lps.success = true
        ${platformFilter}
        AND v.deleted_at IS NULL
        AND (${missingScore}) >= ${minMissing}
        AND (v.extractor_version IS NULL OR v.extractor_version <> '${ENRICHMENT_VERSION}')
      ORDER BY v.id, lps.fetched_at DESC
      OFFSET ${offset}
      LIMIT ${batchSize}
    `;

    const { data: candidates, error: cErr } = await supabase.rpc("execute_sql", { query: findSql });
    if (cErr) throw new Error(`Find query failed: ${cErr.message}`);

    // execute_sql returns {"error": "..."} on internal errors (timeout etc) instead of an array
    if (candidates && !Array.isArray(candidates) && candidates.error) {
      throw new Error(`SQL error: ${candidates.error}`);
    }
    const vehicles: any[] = Array.isArray(candidates) ? candidates : [];
    if (vehicles.length === 0) {
      return okJson({ success: true, message: "No vehicles need snapshot repair", processed: 0, duration_ms: Date.now() - startTime });
    }

    console.log(`[batch-repair] Found ${vehicles.length} vehicles to repair`);

    let enriched = 0;
    let skipped = 0;
    let errors = 0;
    const results: any[] = [];

    for (const vehicle of vehicles) {
      try {
        // Fetch the snapshot HTML
        const { data: snapshot } = await supabase
          .from("listing_page_snapshots")
          .select("html")
          .eq("listing_url", vehicle.snapshot_url)
          .eq("success", true)
          .order("fetched_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!snapshot?.html || snapshot.html.length < 500) {
          results.push({ vehicle_id: vehicle.vehicle_id, status: "no_html", fields_updated: [] });
          skipped++;
          continue;
        }

        const content = extractContent(snapshot.html, vehicle.snapshot_platform);
        const ctx = `${vehicle.year || ""} ${vehicle.make || ""} ${vehicle.model || ""}`.trim();
        const prompt = `Extract vehicle specs from this ${vehicle.snapshot_platform} listing for a ${ctx}:\n\n${content}\n\nReturn JSON with fields: ${EXTRACT_FIELDS.join(", ")}`;

        let llmResponse: string;
        try {
          llmResponse = await callLLM(prompt, SYSTEM_PROMPT);
        } catch (e: any) {
          results.push({ vehicle_id: vehicle.vehicle_id, status: `llm_error: ${e?.message}`, fields_updated: [] });
          errors++;
          continue;
        }

        // Parse
        let parsed: Record<string, any>;
        try {
          let jsonStr = llmResponse.trim();
          if (jsonStr.startsWith("```")) jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
          parsed = JSON.parse(jsonStr);
        } catch {
          results.push({ vehicle_id: vehicle.vehicle_id, status: "parse_error", fields_updated: [] });
          errors++;
          continue;
        }

        // Build update
        const updatePayload: Record<string, any> = {};
        const fieldsUpdated: string[] = [];

        for (const field of EXTRACT_FIELDS) {
          const newVal = parsed[field];
          const existingVal = vehicle[field];
          if (shouldUpdate(field, existingVal, newVal)) {
            updatePayload[field] = newVal;
            fieldsUpdated.push(field);
          }
        }

        if (fieldsUpdated.length === 0) {
          results.push({ vehicle_id: vehicle.vehicle_id, status: "no_changes", fields_updated: [] });
          skipped++;
          continue;
        }

        if (!dryRun) {
          updatePayload.extractor_version = ENRICHMENT_VERSION;
          updatePayload.updated_at = new Date().toISOString();

          const { error: uErr } = await supabase
            .from("vehicles")
            .update(updatePayload)
            .eq("id", vehicle.vehicle_id);

          if (uErr) {
            results.push({ vehicle_id: vehicle.vehicle_id, status: `update_error: ${uErr.message}`, fields_updated: [] });
            errors++;
            continue;
          }
        }

        enriched++;
        results.push({ vehicle_id: vehicle.vehicle_id, status: dryRun ? "dry_run" : "repaired", fields_updated: fieldsUpdated });

        // Rate limit protection
        if (vehicles.length > 1) await new Promise(r => setTimeout(r, 300));
      } catch (e: any) {
        results.push({ vehicle_id: vehicle.vehicle_id, status: `error: ${e?.message}`, fields_updated: [] });
        errors++;
      }
    }

    return okJson({
      success: true,
      dry_run: dryRun,
      platform,
      batch_size: batchSize,
      offset,
      candidates_found: vehicles.length,
      enriched,
      skipped,
      errors,
      results,
      duration_ms: Date.now() - startTime,
      next_offset: offset + batchSize,
    });
  } catch (e: any) {
    console.error("[batch-repair] Error:", e);
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
