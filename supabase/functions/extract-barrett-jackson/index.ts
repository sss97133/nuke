/**
 * EXTRACT BARRETT-JACKSON
 *
 * Firecrawl-based extractor for Barrett-Jackson auction pages.
 * Parses structured data directly from markdown + HTML — no AI needed.
 *
 * BJ pages have clean labeled fields in the markdown:
 *   1966Year, CHEVROLETMake, EL CAMINOModel, etc.
 *
 * Images come from Azure CDN URLs in the raw HTML:
 *   https://BarrettJacksonCDN.azureedge.net/staging/carlist/items/fullsize/cars/{id}/{id}_*.jpg
 *
 * Actions:
 *   POST { "url": "..." }                  — Extract single URL
 *   POST { "action": "batch_from_queue", "limit": 10 }  — Process queue items
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

// --- Parsing helpers ---

interface BJVehicle {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  style: string | null;
  vin: string | null;
  transmission: string | null;
  engine: string | null;
  cylinders: number | null;
  exterior_color: string | null;
  interior_color: string | null;
  mileage: number | null;
  sale_price: number | null;
  description: string | null;
  auction_name: string | null;
  lot_number: string | null;
  status: string | null;
  image_urls: string[];
}

function titleCase(s: string): string {
  // Preserve known uppercase abbreviations (BMW, AMG, GT, SS, etc.)
  const preserveUpper = new Set([
    'BMW', 'AMG', 'GT', 'SS', 'RS', 'GTS', 'GTO', 'GTI', 'GTR',
    'SL', 'SLK', 'SLS', 'CLS', 'CLK', 'SUV', 'TDI', 'TSI',
    'V6', 'V8', 'V10', 'V12', 'I4', 'I6', 'W12', 'HP', 'RPM',
    'AWD', 'FWD', 'RWD', '4WD', 'CVT', 'DSG', 'PDK',
    'SC', 'SE', 'LE', 'LT', 'LS', 'LTZ', 'SRT', 'TRD',
    'XJ', 'XK', 'XF', 'DB', 'DB5', 'DB9', 'DB11',
    'M3', 'M4', 'M5', 'M6', 'Z3', 'Z4', 'X3', 'X5', 'X6',
    'F1', 'F40', 'F50', 'II', 'III', 'IV', 'VI',
  ]);
  return s
    .split(/\s+/)
    .map(word => {
      const upper = word.toUpperCase();
      if (preserveUpper.has(upper)) return upper;
      // Preserve alphanumeric codes like "F150", "C10", "E30"
      if (/^[A-Z]\d+$/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

function parseMarkdown(markdown: string, url: string): BJVehicle {
  const vehicle: BJVehicle = {
    url,
    title: null,
    year: null,
    make: null,
    model: null,
    style: null,
    vin: null,
    transmission: null,
    engine: null,
    cylinders: null,
    exterior_color: null,
    interior_color: null,
    mileage: null,
    sale_price: null,
    description: null,
    auction_name: null,
    lot_number: null,
    status: null,
    image_urls: [],
  };

  // Extract title: "# 1966 CHEVROLET EL CAMINO PICKUP"
  const titleMatch = markdown.match(
    /^#\s+(\d{4}\s+[A-Z][A-Z\s\-\/\d]+?)$/m
  );
  if (titleMatch) {
    vehicle.title = titleCase(titleMatch[1].trim());
  }

  // Extract labeled fields from the Details section
  // Pattern: "1966Year", "CHEVROLETMake", "EL CAMINOModel", etc.
  const fieldPatterns: [RegExp, keyof BJVehicle][] = [
    [/(\d{4})Year/m, "year"],
    [/([A-Z][A-Z\s\-\.\/]+?)Make/m, "make"],
    [/([A-Z][A-Z\s\-\.\/\d]+?)Model/m, "model"],
    [/([A-Z][A-Z\s\-\.\/]+?)Style/m, "style"],
    [/(\d+)Cylinders?/m, "cylinders"],
    [/([A-Z][A-Z\s\-\.\/\d]+?)Transmission/m, "transmission"],
    [/([A-Z\d][A-Z\s\-\.\/\d]+?)Engine Size/m, "engine"],
    [/([A-Z][A-Z\s\-\.\/]+?)Exterior Color/m, "exterior_color"],
    [/([A-Z][A-Z\s\-\.\/]+?)Interior Color/m, "interior_color"],
    [/([A-Z0-9]+)Vin/m, "vin"],
  ];

  for (const [pattern, field] of fieldPatterns) {
    const match = markdown.match(pattern);
    if (match) {
      const val = match[1].trim();
      if (field === "year") {
        vehicle.year = parseInt(val, 10);
      } else if (field === "cylinders") {
        vehicle.cylinders = parseInt(val, 10);
      } else if (
        field === "make" ||
        field === "model" ||
        field === "style" ||
        field === "exterior_color" ||
        field === "interior_color" ||
        field === "transmission"
      ) {
        vehicle[field] = titleCase(val);
      } else if (field === "engine" || field === "vin") {
        vehicle[field] = val;
      }
    }
  }

  // Extract sale price — BJ often requires login to view price
  // Look for specific patterns near "Sold for" or "Hammer Price"
  const pricePatterns = [
    /Sold\s+for\s+\$([0-9,]+)/i,
    /Hammer\s+Price[:\s]+\$([0-9,]+)/i,
    /Final\s+Price[:\s]+\$([0-9,]+)/i,
    /Sale\s+Price[:\s]+\$([0-9,]+)/i,
  ];
  for (const pattern of pricePatterns) {
    const priceMatch = markdown.match(pattern);
    if (priceMatch) {
      const price = parseInt(priceMatch[1].replace(/,/g, ""), 10);
      if (price >= 1000 && price < 100_000_000) {
        vehicle.sale_price = price;
        break;
      }
    }
  }

  // Extract auction name from URL or page content
  const auctionMatch = url.match(
    /barrett-jackson\.com\/([a-z\-]+-\d{4})\//i
  );
  if (auctionMatch) {
    vehicle.auction_name = titleCase(auctionMatch[1].replace(/-/g, " "));
  }

  // Extract status: "Sold", "No Sale", etc.
  const statusMatch = markdown.match(
    /Status:\s*(Sold|No Sale|Upcoming|Withdrawn)/i
  );
  if (statusMatch) {
    vehicle.status = statusMatch[1];
  }

  // Lot number from URL slug
  const lotMatch = url.match(/-(\d{4,})$/);
  if (lotMatch) {
    vehicle.lot_number = lotMatch[1];
  }

  // Extract description
  const descMatch = markdown.match(
    /### Description[\s\S]*?## Details\s+([\s\S]+?)(?=\n##|\n###|!\[|$)/
  );
  if (descMatch) {
    vehicle.description = descMatch[1].trim().slice(0, 5000);
  } else {
    // Try alternate pattern
    const altDesc = markdown.match(
      /## Details\s+(This \d{4}[\s\S]+?)(?=\n##|\n###|\n!\[|$)/
    );
    if (altDesc) {
      vehicle.description = altDesc[1].trim().slice(0, 5000);
    }
  }

  // Extract mileage from description/summary text (BJ has no structured mileage field)
  const textForMileage = (vehicle.description || '') + ' ' + markdown;
  const mileagePatterns = [
    /(\d[\d,]*)\s*(?:actual|original|documented|indicated)\s*miles/i,
    /mileage\s*(?:of|:)?\s*(\d[\d,]*)/i,
    /odometer\s*(?:reads?|shows?|indicates?|:)?\s*(\d[\d,]*)/i,
    /(\d[\d,]*)\s*miles\s*(?:on\s*(?:the\s*)?(?:odometer|clock))/i,
    /only\s*(\d[\d,]*)\s*miles/i,
    /(\d[\d,]*)\s*total\s*miles/i,
    /(\d[\d,]*)\s*actual\s*miles/i,
  ];
  for (const pattern of mileagePatterns) {
    const mileMatch = textForMileage.match(pattern);
    if (mileMatch) {
      const miles = parseInt(mileMatch[1].replace(/,/g, ''), 10);
      if (miles > 0 && miles < 1_000_000) {
        vehicle.mileage = miles;
        break;
      }
    }
  }

  return vehicle;
}

function extractImageUrls(html: string): string[] {
  const urls = new Set<string>();
  // Azure CDN image URLs
  const cdnRegex =
    /https:\/\/BarrettJacksonCDN\.azureedge\.net\/staging\/carlist\/items\/fullsize\/cars\/[^"'\s]+\.(jpg|jpeg|png|webp)/gi;
  let m;
  while ((m = cdnRegex.exec(html)) !== null) {
    urls.add(m[0]);
  }
  return [...urls];
}

// Extract embedded JSON from BJ HTML for sale price and other data
function extractEmbeddedJson(html: string): Record<string, unknown> | null {
  // BJ embeds vehicle data as escaped JSON in the page
  const patterns = [
    /\{"title":\s*"[^"]*",\s*"full_description"/,
    /\\?"title\\?":\s*\\?"[^"]*\\?",\s*\\?"full_description\\?"/,
  ];
  for (const pattern of patterns) {
    const idx = html.search(pattern);
    if (idx === -1) continue;
    // Find a reasonable end boundary
    let depth = 0;
    let end = idx;
    const isEscaped = html[idx] === '\\';
    for (let i = idx; i < Math.min(idx + 5000, html.length); i++) {
      if (isEscaped) {
        if (html.substring(i, i + 2) === '\\{') depth++;
        if (html.substring(i, i + 2) === '\\}') { depth--; if (depth <= 0) { end = i + 2; break; } }
      } else {
        if (html[i] === '{') depth++;
        if (html[i] === '}') { depth--; if (depth <= 0) { end = i + 1; break; } }
      }
    }
    try {
      let raw = html.substring(idx, end);
      if (isEscaped) raw = raw.replace(/\\"/g, '"').replace(/\\{/g, '{').replace(/\\}/g, '}');
      return JSON.parse(raw);
    } catch { continue; }
  }
  return null;
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
      formats: ["markdown", "rawHtml"],
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
  vehicle: BJVehicle
): Promise<{ vehicleId: string; isNew: boolean }> {
  // Check if vehicle already exists by URL
  const { data: existing } = await supabase
    .from("vehicles")
    .select("id")
    .or(
      `vin.eq.${vehicle.vin && vehicle.vin.length >= 5 ? String(vehicle.vin).replace(/[",().\\]/g, '') : "IMPOSSIBLE"},` +
      `make.eq.${vehicle.make ? String(vehicle.make).replace(/[",().\\]/g, '') : "IMPOSSIBLE"}`
    )
    .eq("year", vehicle.year || 0)
    .limit(1)
    .maybeSingle();

  // Also check import_queue for existing vehicle_id
  const { data: queueEntry } = await supabase
    .from("import_queue")
    .select("vehicle_id")
    .eq("listing_url", vehicle.url)
    .not("vehicle_id", "is", null)
    .limit(1)
    .maybeSingle();

  const existingId = queueEntry?.vehicle_id || existing?.id;

  const vehicleData: Record<string, unknown> = {
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    vin: vehicle.vin && vehicle.vin.length >= 5 ? vehicle.vin : null,
    transmission: vehicle.transmission,
    engine_type: vehicle.engine,
    color: vehicle.exterior_color,
    interior_color: vehicle.interior_color,
    mileage: vehicle.mileage,
    sale_price: vehicle.sale_price,
    description: vehicle.description,
    discovery_url: vehicle.url,
    discovery_source: "barrett-jackson",
    ...(vehicle.style ? { body_style: vehicle.style } : {}),
  };

  // Remove null values for updates (don't overwrite existing data with null)
  const cleanData: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(vehicleData)) {
    if (v !== null && v !== undefined) cleanData[k] = v;
  }

  let vehicleId: string;
  let isNew = false;

  if (existingId) {
    // Update existing
    await supabase
      .from("vehicles")
      .update(cleanData)
      .eq("id", existingId);
    vehicleId = existingId;
  } else {
    // Insert new
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
    .eq("source", "barrett-jackson")
    .eq("source_url", vehicle.url)
    .limit(1)
    .maybeSingle();
  if (!existingEvent) {
    await supabase.from("auction_events").insert({
      vehicle_id: vehicleId,
      source: "barrett-jackson",
      source_url: vehicle.url,
      outcome: vehicle.status?.toLowerCase() === "sold" ? "sold" : "listed",
      winning_bid: vehicle.sale_price || null,
      lot_number: vehicle.lot_number || null,
    });
  }

  return { vehicleId, isNew };
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
      if (!url.includes("barrett-jackson.com")) {
        return okJson({ success: false, error: "Not a Barrett-Jackson URL" }, 400);
      }

      console.log(`[BJ] Extracting: ${url}`);
      const { markdown, html } = await scrapeWithFirecrawl(url);

      // Detect removed/unavailable pages
      if (markdown.includes('no longer available') || markdown.includes('is no longer available')) {
        return okJson({ success: false, error: 'Page no longer available (removed by Barrett-Jackson)' }, 410);
      }

      const vehicle = parseMarkdown(markdown, url);
      vehicle.image_urls = extractImageUrls(html);

      // Bail if we couldn't parse basic vehicle data
      if (!vehicle.year && !vehicle.make) {
        return okJson({ success: false, error: 'Could not parse vehicle data from page' }, 422);
      }

      // Try embedded JSON for sale price (BJ hides price behind login in UI)
      const embedded = extractEmbeddedJson(html);
      if (embedded) {
        if (!vehicle.sale_price && typeof embedded.price === 'string') {
          const priceStr = (embedded.price as string).replace(/[$,]/g, '');
          const price = parseFloat(priceStr);
          if (Number.isFinite(price) && price >= 1000) {
            vehicle.sale_price = Math.round(price);
          }
        }
        if (typeof embedded.is_sold === 'boolean' && embedded.is_sold && !vehicle.status) {
          vehicle.status = 'Sold';
        }
      }

      console.log(
        `[BJ] Parsed: ${vehicle.year} ${vehicle.make} ${vehicle.model}, ` +
          `price=${vehicle.sale_price}, mileage=${vehicle.mileage}, ${vehicle.image_urls.length} images`
      );

      const { vehicleId, isNew } = await saveVehicle(supabase, vehicle);

      // Update queue entry if exists
      await supabase
        .from("import_queue")
        .update({
          status: "complete",
          vehicle_id: vehicleId,
          error_message: null,
        })
        .eq("listing_url", url);

      return okJson({
        success: true,
        vehicle_id: vehicleId,
        is_new: isNew,
        vehicle: {
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          vin: vehicle.vin,
          sale_price: vehicle.sale_price,
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
        Number.isFinite(rawLimit) && rawLimit > 0
          ? Math.floor(rawLimit)
          : 10,
        50
      );

      // Claim pending BJ items
      const { data: items, error: claimErr } = await supabase
        .from("import_queue")
        .select("id, listing_url")
        .eq("status", "pending")
        .like("listing_url", "%barrett-jackson.com%")
        .order("created_at", { ascending: true })
        .limit(limit);

      if (claimErr) throw claimErr;
      if (!items?.length) {
        return okJson({ success: true, message: "No BJ items in queue", processed: 0 });
      }

      // Mark as processing
      const ids = items.map((i: { id: string }) => i.id);
      await supabase
        .from("import_queue")
        .update({ status: "processing", locked_at: new Date().toISOString() })
        .in("id", ids);

      const results = {
        total: items.length,
        success: 0,
        failed: 0,
        created: 0,
        updated: 0,
        errors: [] as string[],
      };

      for (const item of items) {
        try {
          const { markdown, html } = await scrapeWithFirecrawl(
            item.listing_url
          );

          // Detect removed/unavailable pages
          if (markdown.includes('no longer available') || markdown.includes('is no longer available')) {
            await supabase
              .from("import_queue")
              .update({ status: "failed", error_message: "Page no longer available (removed)" })
              .eq("id", item.id);
            results.failed++;
            continue;
          }

          const vehicle = parseMarkdown(markdown, item.listing_url);
          vehicle.image_urls = extractImageUrls(html);

          // Try embedded JSON for sale price
          const embedded = extractEmbeddedJson(html);
          if (embedded) {
            if (!vehicle.sale_price && typeof embedded.price === 'string') {
              const priceStr = (embedded.price as string).replace(/[$,]/g, '');
              const price = parseFloat(priceStr);
              if (Number.isFinite(price) && price >= 1000) vehicle.sale_price = Math.round(price);
            }
            if (typeof embedded.is_sold === 'boolean' && embedded.is_sold && !vehicle.status) vehicle.status = 'Sold';
          }

          if (!vehicle.year && !vehicle.make) {
            // Couldn't parse - mark as failed
            await supabase
              .from("import_queue")
              .update({
                status: "failed",
                error_message: "Could not parse vehicle data from page",
                attempts: 1,
              })
              .eq("id", item.id);
            results.failed++;
            continue;
          }

          const { vehicleId, isNew } = await saveVehicle(supabase, vehicle);

          await supabase
            .from("import_queue")
            .update({
              status: "complete",
              vehicle_id: vehicleId,
              error_message: null,
            })
            .eq("id", item.id);

          results.success++;
          if (isNew) results.created++;
          else results.updated++;

          // Small delay between Firecrawl calls
          await new Promise((r) => setTimeout(r, 1000));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          results.failed++;
          if (results.errors.length < 5) {
            results.errors.push(`${item.listing_url}: ${msg}`);
          }

          await supabase
            .from("import_queue")
            .update({
              status: "failed",
              error_message: msg.slice(0, 500),
            })
            .eq("id", item.id);
        }
      }

      return okJson({ success: true, ...results });
    }

    // Re-enrich existing vehicles — CONCURRENT processing for speed
    if (action === "re_enrich") {
      const rawLimit = Number(body.limit);
      const limit = Math.min(
        Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 15,
        100
      );
      const concurrency = Math.min(Number(body.concurrency) || 3, 10);

      const { data: candidates, error: candErr } = await supabase
        .rpc("get_enrichment_candidates", {
          p_source: "barrett-jackson",
          p_limit: limit,
          p_offset: 0,
          p_min_missing: 2,
        });

      if (candErr) throw new Error(`RPC error: ${candErr.message}`);
      if (!candidates?.length) {
        return okJson({ success: true, message: "No BJ candidates to enrich", processed: 0 });
      }

      const results = {
        total: candidates.length,
        success: 0,
        failed: 0,
        fields_added: 0,
        field_counts: {} as Record<string, number>,
        errors: [] as string[],
      };

      async function processOne(cand: typeof candidates[0]) {
        await supabase.from("vehicles").update({ last_enrichment_attempt: new Date().toISOString() }).eq("id", cand.id);
        try {
          const { markdown, html } = await scrapeWithFirecrawl(cand.discovery_url);

          if (markdown.includes('no longer available') || markdown.includes('is no longer available')) {
            await supabase.from("vehicles").update({ enrichment_failures: 3 }).eq("id", cand.id);
            results.failed++;
            if (results.errors.length < 5) results.errors.push(`${cand.discovery_url}: page removed`);
            return;
          }

          const vehicle = parseMarkdown(markdown, cand.discovery_url);
          vehicle.image_urls = extractImageUrls(html);

          const embedded = extractEmbeddedJson(html);
          if (embedded) {
            if (!vehicle.sale_price && typeof embedded.price === 'string') {
              const priceStr = (embedded.price as string).replace(/[$,]/g, '');
              const price = parseFloat(priceStr);
              if (Number.isFinite(price) && price >= 1000) vehicle.sale_price = Math.round(price);
            }
            if (typeof embedded.is_sold === 'boolean' && embedded.is_sold && !vehicle.status) vehicle.status = 'Sold';
          }

          if (!vehicle.year && !vehicle.make) {
            await supabase.from("vehicles").update({ enrichment_failures: (cand.enrichment_failures || 0) + 1 }).eq("id", cand.id);
            results.failed++;
            return;
          }

          const { vehicleId } = await saveVehicle(supabase, vehicle);

          const { data: updated } = await supabase
            .from("vehicles")
            .select("vin,sale_price,color,mileage,description,transmission,body_style")
            .eq("id", vehicleId)
            .maybeSingle();

          if (updated) {
            const fieldsAdded: string[] = [];
            if (!cand.vin && updated.vin) fieldsAdded.push('vin');
            if (!cand.sale_price && updated.sale_price) fieldsAdded.push('price');
            if (!cand.color && updated.color) fieldsAdded.push('color');
            if (!cand.mileage && updated.mileage) fieldsAdded.push('mileage');
            if (!cand.description && updated.description) fieldsAdded.push('description');
            if (!cand.transmission && updated.transmission) fieldsAdded.push('transmission');
            if (!cand.body_style && updated.body_style) fieldsAdded.push('body_style');
            results.fields_added += fieldsAdded.length;
            for (const f of fieldsAdded) {
              results.field_counts[f] = (results.field_counts[f] || 0) + 1;
            }
          }

          results.success++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : (typeof err === 'object' && err !== null ? JSON.stringify(err) : String(err));
          await supabase.from("vehicles").update({
            enrichment_failures: (cand.enrichment_failures || 0) + 1,
          }).eq("id", cand.id);
          results.failed++;
          if (results.errors.length < 5) results.errors.push(`${cand.discovery_url}: ${msg.slice(0, 100)}`);
        }
      }

      // Process in concurrent chunks
      for (let i = 0; i < candidates.length; i += concurrency) {
        const chunk = candidates.slice(i, i + concurrency);
        await Promise.all(chunk.map(processOne));
      }

      return okJson({ success: true, ...results });
    }

    // Stats action
    if (action === "stats") {
      const { data: stats } = await supabase.rpc("execute_sql", {
        query: `
          SELECT
            count(*) FILTER (WHERE status = 'pending') as pending,
            count(*) FILTER (WHERE status = 'complete') as complete,
            count(*) FILTER (WHERE status = 'failed') as failed,
            count(*) FILTER (WHERE status = 'processing') as processing
          FROM import_queue
          WHERE listing_url LIKE '%barrett-jackson.com%'
        `,
      });

      return okJson({
        success: true,
        stats: Array.isArray(stats) ? stats[0] : {},
      });
    }

    return okJson(
      {
        success: false,
        error: "Provide url or action (extract, batch_from_queue, stats)",
      },
      400
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : (typeof e === 'object' && e !== null ? JSON.stringify(e) : String(e));
    console.error("[BJ] Error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
