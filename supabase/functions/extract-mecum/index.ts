/**
 * EXTRACT MECUM
 *
 * Firecrawl-based extractor for Mecum auction pages.
 * Parses structured data from markdown — no AI needed.
 *
 * Mecum pages have a SPECIFICATIONS block with labeled fields:
 *   ENGINE\n\n**350CI**\n\nTRANSMISSION\n\n**4-Speed Manual**
 *
 * VIN is under "VIN / Serial" heading.
 * Mileage is unstructured — found in subtitle or HIGHLIGHTS bullets.
 * Sale price is NOT in the static HTML (loaded via JS) — skipped here.
 * Images come from images.mecum.com (Cloudinary CDN).
 *
 * Actions:
 *   POST { "url": "..." }                            — Extract single URL
 *   POST { "action": "batch_from_queue", "limit": 10 }  — Process queue items
 *   POST { "action": "re_enrich", "limit": 50 }     — Re-enrich existing vehicles
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function okJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface MecumVehicle {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  engine: string | null;
  transmission: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  body_style: string | null;
  mileage: number | null;
  description: string | null;
  highlights: string | null;
  lot_number: string | null;
  auction_name: string | null;
  auction_date: string | null;
  status: string | null;
  image_urls: string[];
}

function titleCase(s: string): string {
  const preserveUpper = new Set([
    'BMW', 'AMG', 'GT', 'SS', 'RS', 'GTS', 'GTO', 'GTI', 'GTR',
    'SL', 'SLK', 'SLS', 'CLS', 'CLK', 'SUV', 'TDI', 'TSI',
    'V6', 'V8', 'V10', 'V12', 'I4', 'I6', 'W12', 'HP', 'CI',
    'AWD', 'FWD', 'RWD', '4WD', 'CVT', 'DSG', 'PDK', 'SC', 'SE',
    'LE', 'LT', 'LS', 'LTZ', 'SRT', 'TRD', 'SSR',
    'M3', 'M4', 'M5', 'M6', 'Z3', 'Z4', 'X3', 'X5', 'X6',
    'F1', 'F40', 'F50', 'II', 'III', 'IV', 'VI',
  ]);
  return s
    .split(/\s+/)
    .map(word => {
      const upper = word.toUpperCase();
      if (preserveUpper.has(upper)) return upper;
      if (/^[A-Z]\d+$/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

function parseMarkdown(markdown: string, url: string): MecumVehicle {
  const vehicle: MecumVehicle = {
    url,
    title: null,
    year: null,
    make: null,
    model: null,
    vin: null,
    engine: null,
    transmission: null,
    exterior_color: null,
    interior_color: null,
    body_style: null,
    mileage: null,
    description: null,
    highlights: null,
    lot_number: null,
    auction_name: null,
    auction_date: null,
    status: null,
    image_urls: [],
  };

  // Title: "# 1964 Chevrolet Chevelle 300"
  const titleMatch = markdown.match(/^# (\d{4})\s+(.+)$/m);
  if (titleMatch) {
    vehicle.year = parseInt(titleMatch[1], 10);
    vehicle.title = titleMatch[0].replace('# ', '');
    // Split make/model: first word is make, rest is model
    const parts = titleMatch[2].trim().split(/\s+/);
    if (parts.length >= 1) vehicle.make = titleCase(parts[0]);
    if (parts.length >= 2) vehicle.model = titleCase(parts.slice(1).join(' '));
  }

  // Lot info: "Lot F109.8//Friday, January 15th//Kissimmee 2021"
  const lotMatch = markdown.match(/^Lot\s+([\w.]+)\/\/(.+?)\/\/(.+)$/m);
  if (lotMatch) {
    vehicle.lot_number = lotMatch[1];
    vehicle.auction_date = lotMatch[2].trim();
    vehicle.auction_name = lotMatch[3].trim();
  }

  // VIN: "VIN / Serial\n\n1G1AP877XCL133135"
  const vinMatch = markdown.match(/VIN\s*\/\s*Serial\s*\n\n([A-Z0-9]+)/i);
  if (vinMatch) {
    vehicle.vin = vinMatch[1];
  }

  // SPECIFICATIONS block — "ENGINE\n\n**350CI**"
  const specRegex = /^([A-Z][A-Z /]+?)\s*\n\n\*\*(.+?)\*\*/gm;
  const specs: Record<string, string> = {};
  let m;
  while ((m = specRegex.exec(markdown)) !== null) {
    specs[m[1].trim()] = m[2].trim();
  }

  // Map specs to vehicle fields
  if (specs['ENGINE']) vehicle.engine = specs['ENGINE'];
  if (specs['TRANSMISSION']) vehicle.transmission = titleCase(specs['TRANSMISSION']);
  if (specs['EXTERIOR COLOR']) vehicle.exterior_color = titleCase(specs['EXTERIOR COLOR']);
  if (specs['INTERIOR COLOR']) vehicle.interior_color = titleCase(specs['INTERIOR COLOR']);
  if (specs['BODY STYLE']) vehicle.body_style = titleCase(specs['BODY STYLE']);
  // Override make/model from specs if available (more reliable than title parsing)
  if (specs['MAKE']) vehicle.make = titleCase(specs['MAKE']);
  if (specs['MODEL']) vehicle.model = titleCase(specs['MODEL']);

  // Mileage — unstructured, in subtitle or highlights
  // Subtitle line: "6-Speed, 1,700 Miles"
  const subtitleMileage = markdown.match(/^[^#\n].+?([\d,]+)\s*(?:actual\s+)?[Mm]iles/m);
  if (subtitleMileage) {
    const miles = parseInt(subtitleMileage[1].replace(/,/g, ''), 10);
    if (miles > 0 && miles < 1_000_000) vehicle.mileage = miles;
  }
  // Also check highlights bullets
  if (!vehicle.mileage) {
    const highlightsMileage = markdown.match(/^- .*([\d,]+)\s*(?:actual\s+)?[Mm]iles/m);
    if (highlightsMileage) {
      const miles = parseInt(highlightsMileage[1].replace(/,/g, ''), 10);
      if (miles > 0 && miles < 1_000_000) vehicle.mileage = miles;
    }
  }

  // Sold status
  if (/!\[sold\]/i.test(markdown)) {
    vehicle.status = 'sold';
  } else if (/!\[bid goes live\]/i.test(markdown) || /!\[upcoming\]/i.test(markdown)) {
    vehicle.status = 'upcoming';
  }

  // HIGHLIGHTS
  const highlightsMatch = markdown.match(/## HIGHLIGHTS\s*\n\n((?:- .+\n?)+)/);
  if (highlightsMatch) {
    vehicle.highlights = highlightsMatch[1].trim();
  }

  // THE STORY (description)
  const storyMatch = markdown.match(/## THE STORY\s*\n\n([\s\S]+?)(?=\n\nInformation found on the website|$)/);
  if (storyMatch) {
    vehicle.description = storyMatch[1].trim().slice(0, 5000);
  } else if (vehicle.highlights) {
    // Use highlights as fallback description
    vehicle.description = vehicle.highlights.slice(0, 5000);
  }

  // Images from images.mecum.com
  const imageSet = new Set<string>();
  const imgRegex = /https:\/\/images\.mecum\.com\/image\/upload\/[^)\s"]+\.(?:jpg|jpeg|png|webp)\??/gi;
  let imgM;
  while ((imgM = imgRegex.exec(markdown)) !== null) {
    // Deduplicate by image ID (strip cloudinary transforms)
    const imgUrl = imgM[0];
    // Extract the unique part: /v{version}/auctions/...
    const idMatch = imgUrl.match(/\/v\d+\/auctions\/.+/);
    const key = idMatch ? idMatch[0] : imgUrl;
    if (!imageSet.has(key)) {
      imageSet.add(key);
      vehicle.image_urls.push(imgUrl);
    }
  }

  return vehicle;
}

// --- Firecrawl helper ---

async function scrapeWithFirecrawl(
  url: string
): Promise<{ markdown: string; html: string; metadata: Record<string, string> }> {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not set");

  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      waitFor: 5000,
      timeout: 45000,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firecrawl error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.success) {
    throw new Error(`Firecrawl failed: ${JSON.stringify(data).slice(0, 200)}`);
  }

  return {
    markdown: data.data?.markdown || "",
    html: data.data?.rawHtml || "",
    metadata: data.data?.metadata || {},
  };
}

// --- Save vehicle ---

async function saveVehicle(
  supabase: ReturnType<typeof createClient>,
  vehicle: MecumVehicle
): Promise<{ vehicleId: string; isNew: boolean; fieldsUpdated: string[] }> {
  // Check if vehicle already exists by URL or VIN+year
  const { data: byUrl } = await supabase
    .from("vehicles")
    .select("id")
    .eq("discovery_url", vehicle.url)
    .limit(1)
    .maybeSingle();

  const { data: queueEntry } = await supabase
    .from("import_queue")
    .select("vehicle_id")
    .eq("listing_url", vehicle.url)
    .not("vehicle_id", "is", null)
    .limit(1)
    .maybeSingle();

  const existingId = queueEntry?.vehicle_id || byUrl?.id;

  const vehicleData: Record<string, unknown> = {
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    vin: vehicle.vin && vehicle.vin.length >= 5 ? vehicle.vin : null,
    engine_type: vehicle.engine,
    transmission: vehicle.transmission,
    color: vehicle.exterior_color,
    interior_color: vehicle.interior_color,
    body_style: vehicle.body_style,
    mileage: vehicle.mileage,
    description: vehicle.description,
    discovery_url: vehicle.url,
    discovery_source: "mecum",
  };

  // Remove null values for updates (don't overwrite existing data with null)
  const cleanData: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(vehicleData)) {
    if (v !== null && v !== undefined) cleanData[k] = v;
  }

  let vehicleId: string;
  let isNew = false;
  const fieldsUpdated: string[] = [];

  if (existingId) {
    // Track which fields we're updating
    const { data: existing } = await supabase
      .from("vehicles")
      .select("vin,mileage,color,description,transmission,body_style,engine_type")
      .eq("id", existingId)
      .maybeSingle();

    if (existing) {
      if (!existing.vin && cleanData.vin) fieldsUpdated.push('vin');
      if (!existing.mileage && cleanData.mileage) fieldsUpdated.push('mileage');
      if (!existing.color && cleanData.color) fieldsUpdated.push('color');
      if (!existing.description && cleanData.description) fieldsUpdated.push('description');
      if (!existing.transmission && cleanData.transmission) fieldsUpdated.push('transmission');
      if (!existing.body_style && cleanData.body_style) fieldsUpdated.push('body_style');
      if (!existing.engine_type && cleanData.engine_type) fieldsUpdated.push('engine_type');
    }

    await supabase
      .from("vehicles")
      .update(cleanData)
      .eq("id", existingId);
    vehicleId = existingId;
  } else {
    const { data: inserted, error: insertErr } = await supabase
      .from("vehicles")
      .insert({ ...cleanData, status: "active" })
      .select("id")
      .maybeSingle();

    if (insertErr) throw new Error(`Vehicle insert failed: ${insertErr.message} (${insertErr.code})`);
    vehicleId = inserted.id;
    isNew = true;
  }

  // Save images
  if (vehicle.image_urls.length > 0) {
    for (let idx = 0; idx < Math.min(vehicle.image_urls.length, 50); idx++) {
      const imgUrl = vehicle.image_urls[idx];
      // Check if image already exists for this vehicle
      const { data: existing } = await supabase
        .from("vehicle_images")
        .select("id")
        .eq("vehicle_id", vehicleId)
        .eq("image_url", imgUrl)
        .limit(1)
        .maybeSingle();
      if (!existing) {
        await supabase
          .from("vehicle_images")
          .insert({
            vehicle_id: vehicleId,
            image_url: imgUrl,
            source: "external_import",
            source_url: imgUrl,
            is_external: true,
            position: idx,
          });
      }
    }
  }

  // Create auction event (check if exists first)
  const { data: existingEvent } = await supabase
    .from("auction_events")
    .select("id")
    .eq("vehicle_id", vehicleId)
    .eq("source", "mecum")
    .eq("source_url", vehicle.url)
    .limit(1)
    .maybeSingle();
  if (!existingEvent) {
    await supabase.from("auction_events").insert({
      vehicle_id: vehicleId,
      source: "mecum",
      source_url: vehicle.url,
      outcome: vehicle.status || "listed",
      lot_number: vehicle.lot_number || null,
    });
  }

  return { vehicleId, isNew, fieldsUpdated };
}

// --- Main handler ---

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body =
      req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body.action || "extract";
    const url = body.url as string | undefined;

    // Single URL extraction
    if (action === "extract" && url) {
      if (!url.includes("mecum.com")) {
        return okJson({ success: false, error: "Not a Mecum URL" }, 400);
      }

      console.log(`[MECUM] Extracting: ${url}`);
      const { markdown } = await scrapeWithFirecrawl(url);

      // Detect 404 / removed pages
      if (markdown.includes('404 - PAGE NOT FOUND') || markdown.includes('no longer available')) {
        return okJson({ success: false, error: 'Page not found (404 or removed)' }, 410);
      }

      const vehicle = parseMarkdown(markdown, url);

      // Bail if we couldn't parse basic vehicle data
      if (!vehicle.year && !vehicle.make) {
        return okJson({ success: false, error: 'Could not parse vehicle data from page' }, 422);
      }

      console.log(
        `[MECUM] Parsed: ${vehicle.year} ${vehicle.make} ${vehicle.model}, ` +
          `vin=${vehicle.vin}, mileage=${vehicle.mileage}, ${vehicle.image_urls.length} images`
      );

      const { vehicleId, isNew, fieldsUpdated } = await saveVehicle(supabase, vehicle);

      // Update queue entry if exists
      await supabase
        .from("import_queue")
        .update({ status: "complete", vehicle_id: vehicleId, error_message: null })
        .eq("listing_url", url);

      return okJson({
        success: true,
        vehicle_id: vehicleId,
        is_new: isNew,
        fields_updated: fieldsUpdated,
        vehicle: {
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          vin: vehicle.vin,
          mileage: vehicle.mileage,
          images: vehicle.image_urls.length,
          auction: vehicle.auction_name,
          status: vehicle.status,
        },
      });
    }

    // Batch from queue
    if (action === "batch_from_queue") {
      const rawLimit = Number(body.limit);
      const limit = Math.min(
        Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 10,
        50
      );

      const { data: items, error: claimErr } = await supabase
        .from("import_queue")
        .select("id, listing_url")
        .eq("status", "pending")
        .like("listing_url", "%mecum.com%")
        .order("created_at", { ascending: true })
        .limit(limit);

      if (claimErr) throw claimErr;
      if (!items?.length) {
        return okJson({ success: true, message: "No Mecum items in queue", processed: 0 });
      }

      const ids = items.map((i: { id: string }) => i.id);
      await supabase
        .from("import_queue")
        .update({ status: "processing", locked_at: new Date().toISOString() })
        .in("id", ids);

      const results = { total: items.length, success: 0, failed: 0, created: 0, updated: 0, errors: [] as string[] };

      for (const item of items) {
        try {
          const { markdown } = await scrapeWithFirecrawl(item.listing_url);

          // Skip 404/removed pages
          if (markdown.includes('404 - PAGE NOT FOUND') || markdown.includes('no longer available')) {
            await supabase
              .from("import_queue")
              .update({ status: "failed", error_message: "Page removed/404", attempts: 1 })
              .eq("id", item.id);
            results.failed++;
            continue;
          }

          const vehicle = parseMarkdown(markdown, item.listing_url);

          if (!vehicle.year && !vehicle.make) {
            await supabase
              .from("import_queue")
              .update({ status: "failed", error_message: "Could not parse vehicle data", attempts: 1 })
              .eq("id", item.id);
            results.failed++;
            continue;
          }

          const { vehicleId, isNew } = await saveVehicle(supabase, vehicle);

          await supabase
            .from("import_queue")
            .update({ status: "complete", vehicle_id: vehicleId, error_message: null })
            .eq("id", item.id);

          results.success++;
          if (isNew) results.created++;
          else results.updated++;

          await new Promise((r) => setTimeout(r, 1000));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          results.failed++;
          if (results.errors.length < 5) results.errors.push(`${item.listing_url}: ${msg}`);
          await supabase
            .from("import_queue")
            .update({ status: "failed", error_message: msg.slice(0, 500) })
            .eq("id", item.id);
        }
      }

      return okJson({ success: true, ...results });
    }

    // Re-enrich existing vehicles — updates existing records with missing fields
    // Processes CONCURRENTLY for speed (configurable concurrency, default 3)
    if (action === "re_enrich") {
      const rawLimit = Number(body.limit);
      const limit = Math.min(
        Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 15,
        100
      );
      const concurrency = Math.min(Number(body.concurrency) || 3, 10);

      const { data: candidates, error: candErr } = await supabase
        .rpc("get_enrichment_candidates", {
          p_source: "mecum",
          p_limit: limit,
          p_offset: 0,
          p_min_missing: 2,
        });

      if (candErr) throw new Error(`RPC error: ${candErr.message}`);
      if (!candidates?.length) {
        return okJson({ success: true, message: "No Mecum candidates to enrich", processed: 0 });
      }

      const results = {
        total: candidates.length,
        success: 0,
        failed: 0,
        fields_added: 0,
        field_counts: {} as Record<string, number>,
        errors: [] as string[],
      };

      // Process one candidate
      async function processOne(cand: typeof candidates[0]) {
        await supabase.from("vehicles").update({ last_enrichment_attempt: new Date().toISOString() }).eq("id", cand.id);
        try {
          const { markdown } = await scrapeWithFirecrawl(cand.discovery_url);

          if (markdown.includes('404 - PAGE NOT FOUND') || markdown.includes('no longer available')) {
            await supabase.from("vehicles").update({ enrichment_failures: 3 }).eq("id", cand.id);
            results.failed++;
            if (results.errors.length < 5) results.errors.push(`${cand.discovery_url}: page removed/404`);
            return;
          }

          const vehicle = parseMarkdown(markdown, cand.discovery_url);

          if (!vehicle.year && !vehicle.make) {
            await supabase.from("vehicles").update({ enrichment_failures: (cand.enrichment_failures || 0) + 1 }).eq("id", cand.id);
            results.failed++;
            return;
          }

          const { fieldsUpdated } = await saveVehicle(supabase, vehicle);

          results.success++;
          results.fields_added += fieldsUpdated.length;
          for (const f of fieldsUpdated) {
            results.field_counts[f] = (results.field_counts[f] || 0) + 1;
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : (typeof err === 'object' && err !== null ? JSON.stringify(err) : String(err));
          await supabase.from("vehicles").update({ enrichment_failures: (cand.enrichment_failures || 0) + 1 }).eq("id", cand.id);
          results.failed++;
          if (results.errors.length < 5) results.errors.push(`${cand.discovery_url}: ${msg.slice(0, 100)}`);
        }
      }

      // Process in chunks of `concurrency`
      for (let i = 0; i < candidates.length; i += concurrency) {
        const chunk = candidates.slice(i, i + concurrency);
        await Promise.all(chunk.map(processOne));
      }

      return okJson({ success: true, ...results });
    }

    return okJson(
      { success: false, error: "Provide url or action (extract, batch_from_queue, re_enrich)" },
      400
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : (typeof e === 'object' && e !== null ? JSON.stringify(e) : String(e));
    console.error("[MECUM] Error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
