import "jsr:@supabase/functions-js/edge-runtime.d.ts";
/**
 * Collecting Cars Data Extractor
 *
 * Extracts vehicle data from Collecting Cars raw_data (from Typesense API)
 * without requiring AI/OpenAI. Uses structured data already in import_queue.
 *
 * Deploy: supabase functions deploy extract-collecting-cars --no-verify-jwt
 *
 * Usage:
 *   POST {"url": "https://collectingcars.com/...", "save_to_db": true}
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ExtractedVehicle {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  transmission: string | null;
  mileage: number | null;
  mileage_unit: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  engine: string | null;
  fuel_type: string | null;
  drive_type: string | null;
  sale_price: number | null;
  description: string | null;
  image_urls: string[];
  source_data?: {
    region: string | null;
    country: string | null;
    location: string | null;
    auction_id: number | null;
    bid_count: number | null;
    reserve_met: boolean | null;
    no_reserve: boolean | null;
    currency: string | null;
  };
}

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseMileage(mileageStr: string | null): { value: number | null; unit: string | null } {
  if (!mileageStr) return { value: null, unit: null };

  const match = mileageStr.match(/(\d+(?:,\d+)*)\s*(km|miles|km\s*\(indicated\)|miles)/i);
  if (!match) return { value: null, unit: null };

  const value = parseInt(match[1].replace(/,/g, ""), 10);
  const unit = mileageStr.toLowerCase().includes("mile") ? "miles" : "km";

  return { value, unit };
}

function extractFromRawData(item: any): ExtractedVehicle {
  const rawData = item.raw_data || {};
  const features = rawData.features || {};

  // Parse title to extract make and model
  const title = item.listing_title || "";
  const titleMatch = title.match(/(\d+)?\s*([A-Za-z\s]+?)\s+(.+?)(?:\s*[-–]|$)/);

  const year = parseInt(features.modelYear || item.listing_year || 0, 10) || null;
  const { value: mileage, unit: mileageUnit } = parseMileage(features.mileage);

  // Extract make and model from title if not in raw_data
  let make = rawData.makeName || null;
  let model = rawData.modelName || null;

  if (!make && titleMatch) {
    make = titleMatch[2]?.trim() || null;
    model = titleMatch[3]?.trim() || null;
  }

  return {
    url: item.listing_url,
    title,
    year,
    make,
    model,
    transmission: features.transmission || null,
    mileage,
    mileage_unit: mileageUnit,
    exterior_color: null,
    interior_color: null,
    engine: null,
    fuel_type: features.fuelType || null,
    drive_type: features.driveSide || null,
    sale_price: null,
    description: `Collecting Cars Auction ID: ${rawData.auction_id || "N/A"} | Bids: ${rawData.bid_count || 0} | Stage: ${rawData.stage || "unknown"} | Reserve: ${
      rawData.reserve_met
        ? "Met"
        : rawData.no_reserve
          ? "No Reserve"
          : "Not Met"
    }`,
    image_urls: [],
    source_data: {
      region: rawData.region || null,
      country: rawData.country || null,
      location: rawData.location || null,
      auction_id: rawData.auction_id || null,
      bid_count: rawData.bid_count || null,
      reserve_met: rawData.reserve_met || null,
      no_reserve: rawData.no_reserve || null,
      currency: rawData.currency || null,
    },
  };
}

async function processQueue(
  supabase: any,
  url: string
): Promise<{ item: any; extracted: ExtractedVehicle | null; error?: string }> {
  // Find the item in import_queue with this URL
  const { data: queueItems, error: queryError } = await supabase
    .from("import_queue")
    .select("*")
    .ilike("listing_url", url.replace(/\//g, "/"))
    .limit(1)
    .maybeSingle();

  if (queryError) {
    return { item: null, extracted: null, error: `Queue lookup failed: ${queryError.message}` };
  }

  if (!queueItems) {
    return { item: null, extracted: null, error: "No queue item found" };
  }

  // Check if item has raw_data
  if (!queueItems.raw_data) {
    return {
      item: queueItems,
      extracted: null,
      error: "No raw_data in queue item",
    };
  }

  // Extract from raw_data
  const extracted = extractFromRawData(queueItems);

  return { item: queueItems, extracted };
}

// --- Firecrawl helper for page scraping ---

async function scrapeWithFirecrawl(url: string): Promise<string> {
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

  return data.data?.markdown || "";
}

// --- Parse Collecting Cars markdown page ---

function parseCCMarkdown(markdown: string, url: string): Record<string, unknown> {
  const vehicle: Record<string, unknown> = { discovery_url: url, discovery_source: "collecting_cars" };

  // Title: "# 1977 Datsun 260Z"
  const titleMatch = markdown.match(/^# (\d{4})\s+(.+)$/m);
  if (titleMatch) {
    vehicle.year = parseInt(titleMatch[1], 10);
    const rest = titleMatch[2].trim();
    const parts = rest.split(/\s+/);
    vehicle.make = parts[0] || null;
    vehicle.model = parts.slice(1).join(" ") || null;
  }

  // Specs via icon filenames: "icon-mileage.svg)42,083 km"
  const mileageMatch = markdown.match(/icon-mileage\.svg\)([^\n]+)/i);
  if (mileageMatch) {
    const mStr = mileageMatch[1].trim();
    const mNum = parseInt(mStr.replace(/,/g, ""), 10);
    if (mNum > 0 && mNum < 10_000_000) vehicle.mileage = mNum;
  }

  const transMatch = markdown.match(/icon-transmission\.svg\)([^\n]+)/i);
  if (transMatch) vehicle.transmission = transMatch[1].trim();

  const paintMatch = markdown.match(/icon-paint\.svg\)([^\n]+)/i);
  if (paintMatch) vehicle.color = paintMatch[1].trim();

  const interiorMatch = markdown.match(/icon-interior\.svg\)([^\n]+)/i);
  if (interiorMatch) vehicle.interior_color = interiorMatch[1].trim();

  const engineMatch = markdown.match(/icon-engine\.svg\)([^\n]+)/i);
  if (engineMatch) vehicle.engine_type = engineMatch[1].trim();

  const bodyMatch = markdown.match(/icon-body(?:style)?\.svg\)([^\n]+)/i);
  if (bodyMatch) vehicle.body_style = bodyMatch[1].trim();

  // Description: KEY FACTS block (English)
  const descMatch = markdown.match(/\*\*KEY FACTS\*\*\s*([\s\S]+?)(?:\*\*(?:DATOS CLAVE|POINTS CL[ÉE]S|FAKTEN|FATTI CHIAVE)\*\*|$)/i);
  if (descMatch) {
    vehicle.description = (descMatch[1] as string).trim().slice(0, 5000);
  }

  // Images from collectingcars.com
  const imageSet = new Set<string>();
  const imgRegex = /https:\/\/images\.collectingcars\.com\/[^)\s"]+\.(?:jpg|jpeg|png|webp)/gi;
  let imgM;
  while ((imgM = imgRegex.exec(markdown)) !== null) {
    imageSet.add(imgM[0]);
  }
  vehicle.image_urls = [...imageSet];

  return vehicle;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "extract";
    const { url, save_to_db = false } = body;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Re-enrich: concurrent enrichment for cron-driven processing
    if (action === "re_enrich") {
      const rawLimit = Number(body.limit);
      const limit = Math.min(
        Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 15,
        100
      );
      const concurrency = Math.min(Number(body.concurrency) || 3, 10);

      const { data: candidates, error: candErr } = await supabase
        .rpc("get_enrichment_candidates", {
          p_source: "collecting_cars",
          p_limit: limit,
          p_offset: 0,
          p_min_missing: 2,
        });

      if (candErr) throw new Error(`RPC error: ${candErr.message}`);
      if (!candidates?.length) {
        return okJson({ success: true, message: "No Collecting Cars candidates to enrich", processed: 0 });
      }

      const results = {
        total: candidates.length,
        success_count: 0,
        failed: 0,
        fields_added: 0,
        field_counts: {} as Record<string, number>,
        errors: [] as string[],
      };

      async function processOneEnrich(cand: any) {
        await supabase.from("vehicles").update({ last_enrichment_attempt: new Date().toISOString() }).eq("id", cand.id);
        try {
          const markdown = await scrapeWithFirecrawl(cand.discovery_url);

          // Detect 404/removed pages
          if (markdown.includes("404") || markdown.includes("page not found") || markdown.length < 200) {
            await supabase.from("vehicles").update({ enrichment_failures: 3 }).eq("id", cand.id);
            results.failed++;
            if (results.errors.length < 5) results.errors.push(`${cand.discovery_url}: page removed/404`);
            return;
          }

          const vehicle = parseCCMarkdown(markdown, cand.discovery_url);

          if (!vehicle.year && !vehicle.make) {
            await supabase.from("vehicles").update({ enrichment_failures: (cand.enrichment_failures || 0) + 1 }).eq("id", cand.id);
            results.failed++;
            return;
          }

          // Build null-safe update
          const updateData: Record<string, unknown> = {};
          if (vehicle.year) updateData.year = vehicle.year;
          if (vehicle.make) updateData.make = vehicle.make;
          if (vehicle.model) updateData.model = vehicle.model;
          if (vehicle.mileage) updateData.mileage = vehicle.mileage;
          if (vehicle.color) updateData.color = vehicle.color;
          if (vehicle.interior_color) updateData.interior_color = vehicle.interior_color;
          if (vehicle.transmission) updateData.transmission = vehicle.transmission;
          if (vehicle.engine_type) updateData.engine_type = vehicle.engine_type;
          if (vehicle.body_style) updateData.body_style = vehicle.body_style;
          if (vehicle.description) updateData.description = vehicle.description;

          const fieldsAdded: string[] = [];
          if (!cand.color && updateData.color) fieldsAdded.push("color");
          if (!cand.mileage && updateData.mileage) fieldsAdded.push("mileage");
          if (!cand.description && updateData.description) fieldsAdded.push("description");
          if (!cand.transmission && updateData.transmission) fieldsAdded.push("transmission");
          if (!cand.body_style && updateData.body_style) fieldsAdded.push("body_style");

          if (Object.keys(updateData).length > 0) {
            await supabase.from("vehicles").update(updateData).eq("id", cand.id);
          }

          // Save images
          const imgUrls = (vehicle.image_urls as string[]) || [];
          for (let idx = 0; idx < Math.min(imgUrls.length, 50); idx++) {
            const imgUrl = imgUrls[idx];
            const { data: existingImg } = await supabase
              .from("vehicle_images")
              .select("id")
              .eq("vehicle_id", cand.id)
              .eq("image_url", imgUrl)
              .limit(1)
              .maybeSingle();
            if (!existingImg) {
              await supabase.from("vehicle_images").insert({
                vehicle_id: cand.id,
                image_url: imgUrl,
                source: "external_import",
                is_external: true,
                position: idx,
              });
            }
          }

          // Auction event
          const { data: existingEvent } = await supabase
            .from("auction_events")
            .select("id")
            .eq("vehicle_id", cand.id)
            .eq("source", "collecting_cars")
            .eq("source_url", cand.discovery_url)
            .limit(1)
            .maybeSingle();
          if (!existingEvent) {
            await supabase.from("auction_events").insert({
              vehicle_id: cand.id,
              source: "collecting_cars",
              source_url: cand.discovery_url,
              outcome: "listed",
            });
          }

          results.success_count++;
          results.fields_added += fieldsAdded.length;
          for (const f of fieldsAdded) {
            results.field_counts[f] = (results.field_counts[f] || 0) + 1;
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : (typeof err === "object" && err !== null ? JSON.stringify(err) : String(err));
          await supabase.from("vehicles").update({ enrichment_failures: (cand.enrichment_failures || 0) + 1 }).eq("id", cand.id);
          results.failed++;
          if (results.errors.length < 5) results.errors.push(`${cand.discovery_url}: ${msg.slice(0, 100)}`);
        }
      }

      // Process in concurrent chunks
      for (let i = 0; i < candidates.length; i += concurrency) {
        const chunk = candidates.slice(i, i + concurrency);
        await Promise.all(chunk.map(processOneEnrich));
      }

      return okJson({ success: true, ...results });
    }

    if (!url) {
      return okJson({ success: false, error: "URL required" }, 400);
    }

    const { item, extracted, error } = await processQueue(supabase, url);

    if (error) {
      return okJson({ success: false, error, data: {} }, 400);
    }

    if (!extracted) {
      return okJson({
        success: false,
        error: "Could not extract data from raw_data",
        data: {},
      });
    }

    // If save_to_db, insert or link the vehicle
    if (save_to_db && item) {
      // Try to find existing vehicle or create new one
      const { data: existingVehicles, error: searchError } = await supabase
        .from("vehicles")
        .select("id")
        .eq("year", extracted.year)
        .eq("make", extracted.make)
        .eq("model", extracted.model)
        .limit(1);

      let vehicleId = null;

      if (!searchError && existingVehicles && existingVehicles.length > 0) {
        vehicleId = existingVehicles[0].id;
      } else {
        // Create new vehicle
        const { data: newVehicle, error: insertError } = await supabase
          .from("vehicles")
          .insert({
            year: extracted.year,
            make: extracted.make,
            model: extracted.model,
            title: extracted.title,
            description: extracted.description,
            mileage: extracted.mileage,
            transmission: extracted.transmission,
            fuel_type: extracted.fuel_type,
            exterior_color: extracted.exterior_color,
            interior_color: extracted.interior_color,
          })
          .select("id")
          .maybeSingle();

        if (insertError) {
          console.error("Vehicle insert error:", insertError);
        } else if (newVehicle) {
          vehicleId = newVehicle.id;
        }
      }

      // Update queue item as complete
      if (vehicleId) {
        await supabase
          .from("import_queue")
          .update({
            status: "complete",
            vehicle_id: vehicleId,
            processed_at: new Date().toISOString(),
            extraction_method: "collecting-cars-raw-data",
          })
          .eq("id", item.id);
      }

      return okJson({
        success: true,
        extracted,
        vehicle_id: vehicleId,
      });
    }

    return okJson({ success: true, extracted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return okJson(
      { success: false, error: message, data: {} },
      500
    );
  }
});
