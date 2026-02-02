import "jsr:@supabase/functions-js/edge-runtime.d.ts";
/**
 * Collecting Cars Simple Extractor
 *
 * Extracts vehicle data from Collecting Cars raw_data (from Typesense API)
 * WITHOUT requiring any AI/OpenAI calls. Pure data transformation.
 *
 * The raw_data in import_queue already contains structured data like:
 * {
 *   "stage": "sold",
 *   "features": {"mileage": "78,163 Km", "fuelType": "Petrol", ...},
 *   "location": "Hong Kong",
 *   "auction_id": 84605,
 *   "collecting_cars_slug": "2008-porsche-911-997-turbo-15"
 * }
 *
 * Deploy: supabase functions deploy extract-collecting-cars-simple --no-verify-jwt
 *
 * Usage:
 *   POST {"listing_url": "https://collectingcars.com/..."}
 *   POST {"import_queue_id": "uuid"}
 *   POST {"batch_size": 10}  // Process pending items in batch
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RawData {
  stage?: string;
  region?: string;
  country?: string;
  currency?: string;
  features?: {
    mileage?: string;
    fuelType?: string;
    driveSide?: string;
    modelYear?: string;
    transmission?: string;
  };
  location?: string;
  bid_count?: number;
  auction_id?: number;
  no_reserve?: boolean;
  reserve_met?: boolean;
  auction_end_date?: string;
  collecting_cars_slug?: string;
  makeName?: string;
  modelName?: string;
}

interface QueueItem {
  id: string;
  listing_url: string;
  listing_title: string | null;
  listing_year: number | null;
  listing_make: string | null;
  listing_model: string | null;
  raw_data: RawData | null;
  status: string;
  attempts: number;
}

interface ExtractedData {
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  mileage: number | null;
  transmission: string | null;
  fuel_type: string | null;
  drivetrain: string | null;
  listing_url: string;
  listing_title: string | null;
  listing_location: string | null;
  country: string | null;
  auction_source: string;
  bid_count: number | null;
  reserve_status: string | null;
  sale_status: string | null;
  auction_status: string | null;
}

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Parse mileage string like "78,163 Km" or "25,360 Miles (Approx)"
 */
function parseMileage(mileageStr: string | null | undefined): number | null {
  if (!mileageStr) return null;

  // Extract numbers, removing commas
  const match = mileageStr.match(/[\d,]+/);
  if (!match) return null;

  const value = parseInt(match[0].replace(/,/g, ""), 10);
  if (isNaN(value)) return null;

  // Convert km to miles if needed (store in miles)
  const isKm = mileageStr.toLowerCase().includes("km");
  return isKm ? Math.round(value * 0.621371) : value;
}

/**
 * Parse make/model from title like "2008 Porsche 911 (997) Turbo - Manual"
 */
function parseTitle(title: string): { make: string | null; model: string | null; trim: string | null } {
  if (!title) return { make: null, model: null, trim: null };

  // Remove year prefix if present
  const withoutYear = title.replace(/^\d{4}\s+/, "");

  // Common patterns:
  // "Porsche 911 (997) Turbo - Manual - One Owner"
  // "Mercedes-Benz (C215) CL65 AMG"
  // "Aston Martin DB9 Volante"

  // Split on " - " to get main title part
  const mainPart = withoutYear.split(/\s+-\s+/)[0].trim();

  // Try to identify make (first word or compound like Mercedes-Benz, Aston Martin)
  const knownMakes = [
    "Alfa Romeo", "Aston Martin", "Mercedes-Benz", "Land Rover", "Range Rover",
    "Rolls-Royce", "De Tomaso", "Porsche", "Ferrari", "Lamborghini", "BMW",
    "Audi", "Ford", "Chevrolet", "Dodge", "Plymouth", "Pontiac", "Cadillac",
    "Lincoln", "Buick", "Jaguar", "Bentley", "Maserati", "McLaren", "Lotus",
    "Nissan", "Toyota", "Honda", "Mazda", "Subaru", "Mitsubishi", "Lexus",
    "Acura", "Infiniti", "Volkswagen", "Mini", "Fiat", "Lancia", "Triumph",
    "MG", "Austin-Healey", "AC", "TVR", "Morgan", "Datsun", "Volvo", "Saab"
  ];

  let make: string | null = null;
  let rest = mainPart;

  for (const knownMake of knownMakes) {
    if (mainPart.toLowerCase().startsWith(knownMake.toLowerCase())) {
      make = knownMake;
      rest = mainPart.substring(knownMake.length).trim();
      break;
    }
  }

  // If no known make found, take first word
  if (!make) {
    const words = mainPart.split(/\s+/);
    make = words[0];
    rest = words.slice(1).join(" ");
  }

  // Remove parenthetical chassis codes like (997), (C215), (E30)
  const withoutChassis = rest.replace(/\s*\([A-Z0-9]+\)\s*/gi, " ").trim();

  // Model is usually the next word(s), trim is the rest
  const modelParts = withoutChassis.split(/\s+/);
  const model = modelParts[0] || null;
  const trim = modelParts.length > 1 ? modelParts.slice(1).join(" ") : null;

  return { make, model, trim };
}

/**
 * Determine reserve status from raw_data
 */
function getReserveStatus(rawData: RawData): string | null {
  if (rawData.no_reserve) return "no_reserve";
  if (rawData.reserve_met) return "reserve_met";
  if (rawData.reserve_met === false) return "reserve_not_met";
  return null;
}

/**
 * Map stage to sale_status and auction_status
 */
function getStatusFromStage(stage: string | undefined): { sale_status: string | null; auction_status: string | null } {
  switch (stage) {
    case "sold":
      return { sale_status: "sold", auction_status: "ended" };
    case "live":
      return { sale_status: "available", auction_status: "active" };
    case "upcoming":
      return { sale_status: "available", auction_status: "upcoming" };
    case "ended":
      return { sale_status: "not_sold", auction_status: "ended" };
    default:
      return { sale_status: null, auction_status: null };
  }
}

/**
 * Extract vehicle data from queue item's raw_data
 */
function extractFromQueueItem(item: QueueItem): ExtractedData {
  const rawData = item.raw_data || {};
  const features = rawData.features || {};

  // Get year from features.modelYear, listing_year, or title
  let year: number | null = null;
  if (features.modelYear) {
    year = parseInt(features.modelYear, 10);
    if (isNaN(year)) year = null;
  }
  if (!year && item.listing_year) {
    year = item.listing_year;
  }

  // Parse title for make/model/trim
  const titleParsed = parseTitle(item.listing_title || "");

  // Prefer listing_make/model from import_queue if available
  const make = item.listing_make || rawData.makeName || titleParsed.make;
  const model = item.listing_model || rawData.modelName || titleParsed.model;
  const trim = titleParsed.trim;

  // Parse mileage
  const mileage = parseMileage(features.mileage);

  // Map transmission
  let transmission: string | null = null;
  if (features.transmission) {
    const trans = features.transmission.toLowerCase();
    if (trans.includes("manual")) transmission = "Manual";
    else if (trans.includes("auto")) transmission = "Automatic";
    else if (trans.includes("semi")) transmission = "Semi-Automatic";
    else if (trans.includes("cvt")) transmission = "CVT";
    else transmission = features.transmission;
  }

  // Map drivetrain from driveSide (RHD/LHD is not drivetrain but we store what we have)
  // Actually driveSide is steering position, not drivetrain. Leave drivetrain null.
  const drivetrain: string | null = null;

  // Get statuses
  const { sale_status, auction_status } = getStatusFromStage(rawData.stage);
  const reserve_status = getReserveStatus(rawData);

  return {
    year,
    make,
    model,
    trim,
    mileage,
    transmission,
    fuel_type: features.fuelType || null,
    drivetrain,
    listing_url: item.listing_url,
    listing_title: item.listing_title,
    listing_location: rawData.location || null,
    country: rawData.country || null,
    auction_source: "collecting_cars",
    bid_count: rawData.bid_count ?? null,
    reserve_status,
    sale_status,
    auction_status,
  };
}

/**
 * Upsert vehicle to database
 */
async function upsertVehicle(
  supabase: SupabaseClient,
  extracted: ExtractedData,
  queueItemId: string
): Promise<{ vehicleId: string | null; created: boolean; error: string | null }> {
  // Check if vehicle already exists by listing_url
  const { data: existing, error: findError } = await supabase
    .from("vehicles")
    .select("id")
    .eq("listing_url", extracted.listing_url)
    .maybeSingle();

  if (findError) {
    return { vehicleId: null, created: false, error: `Find error: ${findError.message}` };
  }

  const vehicleData = {
    year: extracted.year,
    make: extracted.make,
    model: extracted.model,
    trim: extracted.trim,
    mileage: extracted.mileage,
    transmission: extracted.transmission,
    fuel_type: extracted.fuel_type,
    drivetrain: extracted.drivetrain,
    listing_url: extracted.listing_url,
    listing_title: extracted.listing_title,
    listing_location: extracted.listing_location,
    country: extracted.country,
    auction_source: extracted.auction_source,
    bid_count: extracted.bid_count,
    reserve_status: extracted.reserve_status,
    sale_status: extracted.sale_status,
    auction_status: extracted.auction_status,
    import_queue_id: queueItemId,
    extractor_version: "collecting-cars-simple-v1",
  };

  if (existing) {
    // Update existing vehicle
    const { error: updateError } = await supabase
      .from("vehicles")
      .update(vehicleData)
      .eq("id", existing.id);

    if (updateError) {
      return { vehicleId: null, created: false, error: `Update error: ${updateError.message}` };
    }

    return { vehicleId: existing.id, created: false, error: null };
  } else {
    // Insert new vehicle
    const { data: newVehicle, error: insertError } = await supabase
      .from("vehicles")
      .insert(vehicleData)
      .select("id")
      .single();

    if (insertError) {
      return { vehicleId: null, created: false, error: `Insert error: ${insertError.message}` };
    }

    return { vehicleId: newVehicle?.id || null, created: true, error: null };
  }
}

/**
 * Mark import_queue item as complete
 */
async function markComplete(
  supabase: SupabaseClient,
  queueItemId: string,
  vehicleId: string | null
): Promise<void> {
  await supabase
    .from("import_queue")
    .update({
      status: "complete",
      vehicle_id: vehicleId,
      processed_at: new Date().toISOString(),
      extractor_version: "collecting-cars-simple-v1",
    })
    .eq("id", queueItemId);
}

/**
 * Mark import_queue item as failed
 */
async function markFailed(
  supabase: SupabaseClient,
  queueItemId: string,
  errorMessage: string,
  attempts: number
): Promise<void> {
  await supabase
    .from("import_queue")
    .update({
      status: "failed",
      error_message: errorMessage,
      attempts: attempts + 1,
    })
    .eq("id", queueItemId);
}

/**
 * Process a single queue item
 */
async function processQueueItem(
  supabase: SupabaseClient,
  item: QueueItem
): Promise<{ success: boolean; vehicleId: string | null; created: boolean; error?: string }> {
  // Check if raw_data exists
  if (!item.raw_data) {
    await markFailed(supabase, item.id, "No raw_data in queue item", item.attempts);
    return { success: false, vehicleId: null, created: false, error: "No raw_data in queue item" };
  }

  // Extract data
  const extracted = extractFromQueueItem(item);

  // Validate minimum required fields
  if (!extracted.make || !extracted.model) {
    await markFailed(supabase, item.id, "Could not extract make/model from raw_data", item.attempts);
    return { success: false, vehicleId: null, created: false, error: "Could not extract make/model" };
  }

  // Upsert to vehicles table
  const { vehicleId, created, error } = await upsertVehicle(supabase, extracted, item.id);

  if (error) {
    await markFailed(supabase, item.id, error, item.attempts);
    return { success: false, vehicleId: null, created: false, error };
  }

  // Mark as complete
  await markComplete(supabase, item.id, vehicleId);

  return { success: true, vehicleId, created };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { listing_url, import_queue_id, batch_size = 0 } = body;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Mode 1: Process by URL
    if (listing_url) {
      const { data: item, error: findError } = await supabase
        .from("import_queue")
        .select("*")
        .eq("listing_url", listing_url)
        .single();

      if (findError || !item) {
        return okJson({
          success: false,
          error: `Queue item not found for URL: ${listing_url}`,
        }, 404);
      }

      const result = await processQueueItem(supabase, item as QueueItem);
      return okJson({
        success: result.success,
        vehicle_id: result.vehicleId,
        created: result.created,
        error: result.error,
        url: listing_url,
      });
    }

    // Mode 2: Process by import_queue_id
    if (import_queue_id) {
      const { data: item, error: findError } = await supabase
        .from("import_queue")
        .select("*")
        .eq("id", import_queue_id)
        .single();

      if (findError || !item) {
        return okJson({
          success: false,
          error: `Queue item not found for ID: ${import_queue_id}`,
        }, 404);
      }

      const result = await processQueueItem(supabase, item as QueueItem);
      return okJson({
        success: result.success,
        vehicle_id: result.vehicleId,
        created: result.created,
        error: result.error,
        import_queue_id,
      });
    }

    // Mode 3: Batch process pending Collecting Cars items
    if (batch_size > 0) {
      const { data: items, error: batchError } = await supabase
        .from("import_queue")
        .select("*")
        .eq("status", "pending")
        .ilike("listing_url", "%collectingcars.com%")
        .limit(batch_size);

      if (batchError) {
        return okJson({ success: false, error: `Batch query failed: ${batchError.message}` }, 500);
      }

      if (!items || items.length === 0) {
        return okJson({
          success: true,
          message: "No pending Collecting Cars items found",
          processed: 0,
          results: [],
        });
      }

      const results = [];
      let successCount = 0;
      let createdCount = 0;

      for (const item of items) {
        const result = await processQueueItem(supabase, item as QueueItem);
        results.push({
          id: item.id,
          url: item.listing_url,
          success: result.success,
          vehicle_id: result.vehicleId,
          created: result.created,
          error: result.error,
        });
        if (result.success) successCount++;
        if (result.created) createdCount++;
      }

      return okJson({
        success: true,
        message: `Processed ${items.length} items`,
        processed: items.length,
        successful: successCount,
        created: createdCount,
        updated: successCount - createdCount,
        results,
      });
    }

    // No valid input provided
    return okJson({
      success: false,
      error: "Provide listing_url, import_queue_id, or batch_size > 0",
      usage: {
        single_url: { listing_url: "https://collectingcars.com/..." },
        single_id: { import_queue_id: "uuid" },
        batch: { batch_size: 10 },
      },
    }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return okJson({ success: false, error: message }, 500);
  }
});
