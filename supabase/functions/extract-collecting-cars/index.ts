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

  const year = parseInt(features.modelYear || item.listing_year || 0) || null;
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
    .single();

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { url, save_to_db = false } = body;

    if (!url) {
      return okJson({ success: false, error: "URL required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

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
          .single();

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
