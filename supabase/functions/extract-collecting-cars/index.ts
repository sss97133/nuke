import "jsr:@supabase/functions-js/edge-runtime.d.ts";
/**
 * Collecting Cars Detail-Page Extractor
 *
 * Fetches the individual listing page (not catalog) and extracts:
 *   description, mileage, transmission, exterior_color, interior_color, engine, VIN, images
 *
 * Uses archiveFetch() — pages are archived to listing_page_snapshots automatically.
 *
 * Actions:
 *   POST {"url": "https://collectingcars.com/for-sale/..."}          → extract single URL
 *   POST {"action": "backfill", "batch_size": 10, "concurrency": 3}  → process vehicles missing data
 *
 * Deploy: supabase functions deploy extract-collecting-cars --no-verify-jwt
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { archiveFetch } from "../_shared/archiveFetch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Markdown parser — pulls structured fields from the Firecrawl markdown
// ---------------------------------------------------------------------------

interface ParsedListing {
  year: number | null;
  make: string | null;
  model: string | null;
  mileage: number | null;
  mileage_unit: string | null;
  transmission: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  engine: string | null;
  drive_side: string | null;
  description: string | null;
  vin: string | null;
  image_urls: string[];
}

function parseCCMarkdown(markdown: string): ParsedListing {
  const result: ParsedListing = {
    year: null,
    make: null,
    model: null,
    mileage: null,
    mileage_unit: null,
    transmission: null,
    exterior_color: null,
    interior_color: null,
    engine: null,
    drive_side: null,
    description: null,
    vin: null,
    image_urls: [],
  };

  // --- Title: e.g. "# 1993 Mercedes-Benz (W124) 300 CE-24 Cabriolet" ---
  const titleMatch = markdown.match(/^#+\s+(\d{4})\s+(.+)$/m);
  if (titleMatch) {
    result.year = parseInt(titleMatch[1], 10);
    // Best-effort make/model from title — actual DB values from import_queue are authoritative
    const titleBody = titleMatch[2].trim();
    // Remove chassis code like "(W124)", "(997)", "(E30)"
    const cleaned = titleBody.replace(/\s*\([^)]+\)\s*/g, " ").trim();
    const parts = cleaned.split(/\s+/);
    result.make = parts[0] || null;
    result.model = parts.slice(1).join(" ") || null;
  }

  // --- Spec icons ---
  // Pattern: icon-mileage.svg)47,507 Km (Indicated)
  const mileageMatch = markdown.match(/icon-mileage\.svg\)([^\n]+)/i);
  if (mileageMatch) {
    const mStr = mileageMatch[1].trim();
    const num = parseInt(mStr.replace(/,/g, ""), 10);
    if (num > 0 && num < 10_000_000) {
      result.mileage = num;
      result.mileage_unit = /mile/i.test(mStr) ? "miles" : "km";
    }
  }

  const transMatch = markdown.match(/icon-transmission\.svg\)([^\n]+)/i);
  if (transMatch) {
    const t = transMatch[1].trim();
    if (/manual/i.test(t)) result.transmission = "Manual";
    else if (/auto/i.test(t)) result.transmission = "Automatic";
    else if (/semi/i.test(t)) result.transmission = "Semi-Automatic";
    else if (/cvt/i.test(t)) result.transmission = "CVT";
    else result.transmission = t;
  }

  const paintMatch = markdown.match(/icon-paint\.svg\)([^\n]+)/i);
  if (paintMatch) result.exterior_color = paintMatch[1].trim();

  const interiorMatch = markdown.match(/icon-interior\.svg\)([^\n]+)/i);
  if (interiorMatch) result.interior_color = interiorMatch[1].trim();

  const engineMatch = markdown.match(/icon-engine\.svg\)([^\n]+)/i);
  if (engineMatch) result.engine = engineMatch[1].trim();

  const directionMatch = markdown.match(/icon-direction\.svg\)([^\n]+)/i);
  if (directionMatch) result.drive_side = directionMatch[1].trim();

  // --- Description: **KEY FACTS** block (English only — stop at other language headers) ---
  // The page repeats the block in 8+ languages. Grab the English one first.
  const keyFactsMatch = markdown.match(
    /\*\*KEY FACTS\*\*\s*([\s\S]+?)(?=\*\*(?:HECHOS CLAVE|FAITS MARQUANTS|FAKTEN|FATTI CHIAVE|BELANGRIJKSTE FEITEN|KLUCZOWE FAKTY|FACTS CHAVE|WICHTIGSTE FAKTEN|ОСНОВНЫЕ ФАКТЫ|主要事实|主な特徴|If you purchase|Classic and collectible|Descriptions are provided)\*\*|$)/i
  );
  if (keyFactsMatch) {
    result.description = keyFactsMatch[1].trim().slice(0, 8000);
  }

  // --- VIN: sometimes mentioned in KEY FACTS as "VIN", "chassis number", or "chassis no." ---
  const vinPatterns = [
    /\bVIN[:\s#]+([A-HJ-NPR-Z0-9]{17})\b/i,
    /\bchassis\s+(?:number|no\.?)[:\s]+([A-HJ-NPR-Z0-9]{17})\b/i,
    /\bchassis\s+(?:number|no\.?)[:\s]+([A-Z0-9]{6,20})\b/i,
    /\bserial\s+(?:number|no\.?)[:\s]+([A-HJ-NPR-Z0-9]{17})\b/i,
  ];
  const searchText = result.description ?? markdown.slice(0, 10000);
  for (const pat of vinPatterns) {
    const m = searchText.match(pat);
    if (m) {
      result.vin = m[1].toUpperCase();
      break;
    }
  }

  // --- Images ---
  const imageSet = new Set<string>();
  // Match images.collectingcars.com URLs (strip query params for dedup, keep originals)
  const imgRegex = /https:\/\/images\.collectingcars\.com\/[^)\s"'<>]+\.(?:jpg|jpeg|png|webp)[^)\s"'<>]*/gi;
  let imgM;
  while ((imgM = imgRegex.exec(markdown)) !== null) {
    // Strip resize params to get clean URL
    const cleanUrl = imgM[0].split("?")[0];
    imageSet.add(cleanUrl);
  }
  result.image_urls = [...imageSet];

  return result;
}

// ---------------------------------------------------------------------------
// Core: fetch + parse a single Collecting Cars listing URL
// ---------------------------------------------------------------------------

async function fetchAndParseListing(url: string): Promise<{
  parsed: ParsedListing | null;
  error: string | null;
  cached: boolean;
}> {
  const { markdown, error, cached } = await archiveFetch(url, {
    platform: "collectingcars",
    useFirecrawl: true,
    waitForJs: 5000,
    includeMarkdown: true,
    callerName: "extract-collecting-cars",
  });

  if (error) {
    return { parsed: null, error, cached };
  }

  if (!markdown || markdown.length < 200) {
    return { parsed: null, error: "Empty or too-short response from Collecting Cars page", cached };
  }

  // Detect 404 / removed pages
  if (/this\s+(?:listing\s+)?(?:has\s+been\s+removed|was\s+not\s+found|does\s+not\s+exist|404)/i.test(markdown)) {
    return { parsed: null, error: "Page not found / listing removed", cached };
  }

  const parsed = parseCCMarkdown(markdown);
  return { parsed, error: null, cached };
}

// ---------------------------------------------------------------------------
// Write parsed data back to vehicles + vehicle_images
// ---------------------------------------------------------------------------

async function persistToDb(
  supabase: ReturnType<typeof createClient>,
  vehicleId: string,
  parsed: ParsedListing,
  currentData: Record<string, unknown>,
): Promise<{ fieldsAdded: string[] }> {
  const update: Record<string, unknown> = {};
  const fieldsAdded: string[] = [];

  // Only fill nulls — never overwrite existing values
  if (!currentData.mileage && parsed.mileage) {
    update.mileage = parsed.mileage;
    fieldsAdded.push("mileage");
  }
  if (!currentData.transmission && parsed.transmission) {
    update.transmission = parsed.transmission;
    fieldsAdded.push("transmission");
  }
  if (!currentData.color && parsed.exterior_color) {
    update.color = parsed.exterior_color;
    fieldsAdded.push("color");
  }
  if (!currentData.interior_color && parsed.interior_color) {
    update.interior_color = parsed.interior_color;
    fieldsAdded.push("interior_color");
  }
  if (!currentData.engine_type && parsed.engine) {
    update.engine_type = parsed.engine;
    fieldsAdded.push("engine");
  }
  if (!currentData.description && parsed.description) {
    update.description = parsed.description;
    fieldsAdded.push("description");
  }
  if (!currentData.vin && parsed.vin) {
    update.vin = parsed.vin;
    fieldsAdded.push("vin");
  }

  update.last_enrichment_attempt = new Date().toISOString();

  if (Object.keys(update).length > 1) {
    await supabase.from("vehicles").update(update).eq("id", vehicleId);
  }

  // Save images (up to 60, skip duplicates)
  const imgUrls = parsed.image_urls.slice(0, 60);
  for (let idx = 0; idx < imgUrls.length; idx++) {
    const imgUrl = imgUrls[idx];
    const { data: existingImg } = await supabase
      .from("vehicle_images")
      .select("id")
      .eq("vehicle_id", vehicleId)
      .eq("image_url", imgUrl)
      .limit(1)
      .maybeSingle();
    if (!existingImg) {
      await supabase.from("vehicle_images").insert({
        vehicle_id: vehicleId,
        image_url: imgUrl,
        source: "external_import",
        is_external: true,
        position: idx,
      });
    }
  }

  return { fieldsAdded };
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "extract";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // -----------------------------------------------------------------------
    // ACTION: backfill — process N vehicles missing description/color/mileage
    // -----------------------------------------------------------------------
    if (action === "backfill") {
      const rawLimit = Number(body.batch_size ?? body.limit);
      const limit = Math.min(
        Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 10,
        50
      );
      const concurrency = Math.min(Number(body.concurrency) || 3, 8);

      // Query vehicles with collecting_cars auction_source that are missing fields
      const { data: candidates, error: candErr } = await supabase
        .from("vehicles")
        .select("id, listing_url, year, make, model, mileage, transmission, color, interior_color, engine_type, description, vin, enrichment_failures")
        .in("auction_source", ["collecting_cars", "Collecting Cars"])
        .not("listing_url", "is", null)
        .or("description.is.null,color.is.null,mileage.is.null")
        .lt("enrichment_failures", 3)
        .or("last_enrichment_attempt.is.null,last_enrichment_attempt.lt." + new Date(Date.now() - 24 * 3600_000).toISOString())
        .limit(limit);

      if (candErr) throw new Error(`Query error: ${candErr.message}`);
      if (!candidates?.length) {
        return okJson({ success: true, message: "No Collecting Cars candidates to backfill", processed: 0 });
      }

      const results = {
        total: candidates.length,
        success_count: 0,
        failed: 0,
        fields_added: 0,
        field_counts: {} as Record<string, number>,
        errors: [] as string[],
      };

      async function processOne(cand: Record<string, unknown>) {
        const listingUrl = cand.listing_url as string;
        try {
          const { parsed, error } = await fetchAndParseListing(listingUrl);

          if (error || !parsed) {
            // Mark failure
            await supabase.from("vehicles").update({
              enrichment_failures: ((cand.enrichment_failures as number) || 0) + 1,
              last_enrichment_attempt: new Date().toISOString(),
            }).eq("id", cand.id);
            results.failed++;
            if (results.errors.length < 10) results.errors.push(`${listingUrl}: ${error}`);
            return;
          }

          if (!parsed.year && !parsed.mileage && !parsed.description) {
            await supabase.from("vehicles").update({
              enrichment_failures: ((cand.enrichment_failures as number) || 0) + 1,
              last_enrichment_attempt: new Date().toISOString(),
            }).eq("id", cand.id);
            results.failed++;
            if (results.errors.length < 10) results.errors.push(`${listingUrl}: no useful data extracted`);
            return;
          }

          const { fieldsAdded } = await persistToDb(supabase, cand.id as string, parsed, cand);
          results.success_count++;
          results.fields_added += fieldsAdded.length;
          for (const f of fieldsAdded) {
            results.field_counts[f] = (results.field_counts[f] || 0) + 1;
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          await supabase.from("vehicles").update({
            enrichment_failures: ((cand.enrichment_failures as number) || 0) + 1,
            last_enrichment_attempt: new Date().toISOString(),
          }).eq("id", cand.id);
          results.failed++;
          if (results.errors.length < 10) results.errors.push(`${listingUrl}: ${msg.slice(0, 120)}`);
        }
      }

      // Process in concurrent chunks
      for (let i = 0; i < candidates.length; i += concurrency) {
        const chunk = candidates.slice(i, i + concurrency);
        await Promise.all(chunk.map((c) => processOne(c as Record<string, unknown>)));
      }

      return okJson({ success: true, ...results });
    }

    // -----------------------------------------------------------------------
    // ACTION: extract — single URL, return parsed data (optionally save)
    // -----------------------------------------------------------------------
    const { url, save_to_db = false } = body;

    if (!url) {
      return okJson({ success: false, error: "Provide url or action=backfill" }, 400);
    }

    const { parsed, error, cached } = await fetchAndParseListing(url);

    if (error || !parsed) {
      return okJson({ success: false, error: error ?? "Parse failed", cached }, 400);
    }

    if (save_to_db) {
      // Multiple vehicles may share the same listing_url (duplicates) — update all of them
      const { data: vehicles, error: findErr } = await supabase
        .from("vehicles")
        .select("id, mileage, transmission, color, interior_color, engine_type, description, vin, enrichment_failures")
        .eq("listing_url", url)
        .limit(20);

      if (findErr) {
        return okJson({ success: false, error: `Vehicle lookup failed: ${findErr.message}` }, 500);
      }

      if (!vehicles || vehicles.length === 0) {
        return okJson({ success: false, error: "No vehicle found with that listing_url. Import first via extract-collecting-cars-simple." }, 404);
      }

      // Update the first vehicle fully; for duplicates just stamp last_enrichment_attempt
      const primary = vehicles[0];
      const { fieldsAdded } = await persistToDb(supabase, primary.id, parsed, primary);

      // Stamp remaining duplicates without re-inserting images
      for (const v of vehicles.slice(1)) {
        const updateDupe: Record<string, unknown> = { last_enrichment_attempt: new Date().toISOString() };
        if (!v.description && parsed.description) updateDupe.description = parsed.description;
        if (!v.mileage && parsed.mileage) updateDupe.mileage = parsed.mileage;
        if (!v.color && parsed.exterior_color) updateDupe.color = parsed.exterior_color;
        if (!v.transmission && parsed.transmission) updateDupe.transmission = parsed.transmission;
        await supabase.from("vehicles").update(updateDupe).eq("id", v.id);
      }

      return okJson({
        success: true,
        vehicle_id: primary.id,
        vehicles_updated: vehicles.length,
        fields_added: fieldsAdded,
        parsed,
        cached,
      });
    }

    return okJson({ success: true, parsed, cached });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return okJson({ success: false, error: message }, 500);
  }
});
