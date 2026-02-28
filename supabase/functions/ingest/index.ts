/**
 * nuke.ingest() — Universal Vehicle Discovery Ingestion
 *
 * POST /functions/v1/ingest
 *
 * Accepts:
 *   { url: "https://facebook.com/marketplace/item/..." }
 *   { text: "1980 Chevy C10 $27,500 Greeneville TN" }
 *   { year: 1980, make: "Chevrolet", model: "C10", price: 27500 }
 *   { batch: [{ url: "..." }, { url: "..." }] }  (up to 50)
 *
 * Auth: Bearer token (user JWT or service role key)
 *
 * Flow:
 *   Input → source detection → parse/extract → match or create vehicle → link to user → return
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ── Source Detection ────────────────────────────────────────────

interface SourceMatch {
  platform: string;
  externalId: string | null;
}

const SOURCE_PATTERNS: Array<{
  platform: string;
  pattern: RegExp;
  extractId: (match: RegExpMatchArray) => string | null;
}> = [
  {
    platform: "facebook_marketplace",
    pattern: /facebook\.com\/marketplace\/item\/(\d+)/,
    extractId: (m) => m[1],
  },
  {
    platform: "facebook_marketplace",
    pattern: /fb\.com\/marketplace\/item\/(\d+)/,
    extractId: (m) => m[1],
  },
  {
    platform: "bring_a_trailer",
    pattern: /bringatrailer\.com\/listing\/([\w-]+)/,
    extractId: (m) => m[1],
  },
  {
    platform: "cars_and_bids",
    pattern: /carsandbids\.com\/auctions\/([\w-]+)/,
    extractId: (m) => m[1],
  },
  {
    platform: "craigslist",
    pattern: /(\w+)\.craigslist\.org\/\w+\/d\/([\w-]+)\/(\d+)\.html/,
    extractId: (m) => m[3],
  },
  {
    platform: "ebay_motors",
    pattern: /ebay\.com\/itm\/(\d+)/,
    extractId: (m) => m[1],
  },
  {
    platform: "hagerty",
    pattern: /hagerty\.com\/marketplace\/([\w-]+)/,
    extractId: (m) => m[1],
  },
  {
    platform: "facebook_group",
    pattern: /facebook\.com\/groups\/(\d+)\/posts\/(\d+)/,
    extractId: (m) => m[2],
  },
  {
    platform: "instagram",
    pattern: /instagram\.com\/p\/([\w-]+)/,
    extractId: (m) => m[1],
  },
];

function detectSource(url: string): SourceMatch {
  for (const { platform, pattern, extractId } of SOURCE_PATTERNS) {
    const match = url.match(pattern);
    if (match) {
      return { platform, externalId: extractId(match) };
    }
  }
  return { platform: "unknown", externalId: null };
}

// ── Vehicle Title Parser ────────────────────────────────────────

const MAKES = [
  "Toyota", "Ford", "Chevrolet", "Chevy", "Honda", "Nissan", "BMW",
  "Mercedes-Benz", "Mercedes", "Audi", "Porsche", "Volkswagen", "VW",
  "Dodge", "Ram", "Jeep", "GMC", "Cadillac", "Lincoln", "Buick",
  "Pontiac", "Oldsmobile", "Plymouth", "Chrysler", "Mazda", "Subaru",
  "Lexus", "Acura", "Infiniti", "Hyundai", "Kia", "Volvo", "Jaguar",
  "Land Rover", "Mini", "AMC", "International", "Studebaker", "Datsun",
  "Triumph", "MG", "Austin-Healey", "Shelby", "Saab", "Peugeot",
  "Fiat", "Alfa Romeo", "Ferrari", "Lamborghini", "Maserati", "Lotus",
  "De Tomaso", "Jensen", "TVR", "Morgan", "Sunbeam", "Opel",
  "Willys", "Kaiser", "Nash", "Hudson", "Packard", "Lancia",
  "DeLorean", "Isuzu", "Mitsubishi", "Suzuki", "Eagle",
];

interface ParsedVehicle {
  year: number | null;
  make: string | null;
  model: string | null;
}

function parseVehicleTitle(text: string): ParsedVehicle {
  if (!text) return { year: null, make: null, model: null };

  // Strip common prefixes
  const cleaned = text
    .replace(/^(SOLD|PENDING|NEW|REDUCED|PRICE DROP)[:\s!-]*/i, "")
    .trim();

  // Extract year
  const yearMatch = cleaned.match(/\b(19\d{2}|20[0-2]\d)\b/);
  const year = yearMatch ? parseInt(yearMatch[1]) : null;
  if (!year) return { year: null, make: null, model: null };

  // Get text after year
  const afterYear = cleaned.slice(cleaned.indexOf(yearMatch[0]) + yearMatch[0].length).trim();
  const lower = afterYear.toLowerCase();

  for (const make of MAKES) {
    if (lower.startsWith(make.toLowerCase())) {
      const afterMake = afterYear.slice(make.length).trim();
      const model = afterMake
        .split(/[\s·•|—,\-$]+/)
        .filter(w => w && !/^\d+$/.test(w) && !/^\$/.test(w))
        .slice(0, 3)
        .join(" ")
        .trim() || null;
      return { year, make: make === "Chevy" ? "Chevrolet" : make, model };
    }
  }

  const words = afterYear.split(/\s+/);
  return {
    year,
    make: words[0] || null,
    model: words.slice(1, 3).join(" ") || null,
  };
}

// ── Price Parser ────────────────────────────────────────────────

function parsePrice(text: string): number | null {
  if (!text) return null;
  const match = text.match(/\$\s*([\d,]+)/);
  if (match) return parseInt(match[1].replace(/,/g, ""));
  const numMatch = text.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
  if (numMatch) {
    const val = parseInt(numMatch[1].replace(/,/g, ""));
    if (val >= 100 && val <= 10000000) return val;
  }
  return null;
}

// ── Location Parser ─────────────────────────────────────────────

function parseLocation(text: string): { city: string | null; state: string | null } {
  if (!text) return { city: null, state: null };
  // "Greeneville, TN" or "Los Angeles CA"
  const match = text.match(/([A-Za-z\s.]+),?\s+([A-Z]{2})\b/);
  if (match) return { city: match[1].trim(), state: match[2] };
  return { city: null, state: null };
}

// ── Match or Create Vehicle ─────────────────────────────────────

interface MatchResult {
  vehicleId: string;
  isNew: boolean;
}

interface VehicleEnrichment {
  vin?: string | null;
  url?: string | null;
  price?: number | null;
  location?: string | null;
  imageUrl?: string | null;
  imageUrls?: string[];
  description?: string | null;
  mileage?: number | null;
  engine?: string | null;
  transmission?: string | null;
  color?: string | null;
  condition?: string | null;
  titleStatus?: string | null;
  sellerName?: string | null;
}

async function matchOrCreateVehicle(
  parsed: ParsedVehicle & VehicleEnrichment
): Promise<MatchResult> {
  // 1. VIN match
  if (parsed.vin) {
    const { data: vinMatch } = await supabaseAdmin
      .from("vehicles")
      .select("id")
      .eq("vin", parsed.vin)
      .limit(1)
      .single();

    if (vinMatch) {
      // Enrich existing vehicle with any new data
      await enrichVehicle(vinMatch.id, parsed);
      return { vehicleId: vinMatch.id, isNew: false };
    }
  }

  // 2. URL match in marketplace_listings
  if (parsed.url) {
    const { data: urlMatch } = await supabaseAdmin
      .from("marketplace_listings")
      .select("vehicle_id")
      .eq("url", parsed.url)
      .not("vehicle_id", "is", null)
      .limit(1)
      .single();

    if (urlMatch?.vehicle_id) {
      await enrichVehicle(urlMatch.vehicle_id, parsed);
      return { vehicleId: urlMatch.vehicle_id, isNew: false };
    }
  }

  // 3. Create new vehicle with ALL available data
  const vehicleData: Record<string, any> = {
    year: parsed.year,
    make: parsed.make,
    model: parsed.model,
    vin: parsed.vin || null,
    status: "discovered",
    primary_image_url: parsed.imageUrl || (parsed.imageUrls?.[0]) || null,
  };

  // Populate everything we have
  if (parsed.description) vehicleData.description = parsed.description;
  if (parsed.mileage) vehicleData.mileage = parsed.mileage;
  if (parsed.engine) vehicleData.engine = parsed.engine;
  if (parsed.transmission) vehicleData.transmission = parsed.transmission;
  if (parsed.color) vehicleData.color = parsed.color;
  if (parsed.price) vehicleData.asking_price = parsed.price;
  if (parsed.location) vehicleData.location = parsed.location;
  if (parsed.condition) vehicleData.condition_notes = parsed.condition;

  const { data: newVehicle, error } = await supabaseAdmin
    .from("vehicles")
    .insert(vehicleData)
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to create vehicle: ${error.message}`);
  }

  // If we have multiple images, insert them to vehicle_images
  const allImages = parsed.imageUrls || (parsed.imageUrl ? [parsed.imageUrl] : []);
  if (allImages.length > 0) {
    const imageRows = allImages.map((url: string, i: number) => ({
      vehicle_id: newVehicle.id,
      image_url: url,
      is_primary: i === 0,
      source: "ingest",
    }));
    await supabaseAdmin.from("vehicle_images").insert(imageRows);
  }

  return { vehicleId: newVehicle.id, isNew: true };
}

// Enrich an existing vehicle with new data (only fill NULLs, don't overwrite)
async function enrichVehicle(vehicleId: string, data: VehicleEnrichment) {
  const { data: existing } = await supabaseAdmin
    .from("vehicles")
    .select("description, mileage, engine, transmission, color, asking_price, primary_image_url, location, vin")
    .eq("id", vehicleId)
    .single();

  if (!existing) return;

  const updates: Record<string, any> = {};

  if (!existing.description && data.description) updates.description = data.description;
  if (!existing.mileage && data.mileage) updates.mileage = data.mileage;
  if (!existing.engine && data.engine) updates.engine = data.engine;
  if (!existing.transmission && data.transmission) updates.transmission = data.transmission;
  if (!existing.color && data.color) updates.color = data.color;
  if (!existing.asking_price && data.price) updates.asking_price = data.price;
  if (!existing.primary_image_url && (data.imageUrl || data.imageUrls?.[0])) {
    updates.primary_image_url = data.imageUrl || data.imageUrls![0];
  }
  if (!existing.location && data.location) updates.location = data.location;
  if (!existing.vin && data.vin) updates.vin = data.vin;

  if (Object.keys(updates).length > 0) {
    await supabaseAdmin.from("vehicles").update(updates).eq("id", vehicleId);
  }

  // Add any new images
  const allImages = data.imageUrls || (data.imageUrl ? [data.imageUrl] : []);
  if (allImages.length > 0) {
    // Check which images already exist
    const { data: existingImages } = await supabaseAdmin
      .from("vehicle_images")
      .select("image_url")
      .eq("vehicle_id", vehicleId);

    const existingUrls = new Set((existingImages || []).map((i: any) => i.image_url));
    const newImages = allImages.filter((url: string) => !existingUrls.has(url));

    if (newImages.length > 0) {
      const hasPrimary = !!existing.primary_image_url;
      const imageRows = newImages.map((url: string, i: number) => ({
        vehicle_id: vehicleId,
        image_url: url,
        is_primary: !hasPrimary && i === 0,
        source: "ingest",
      }));
      await supabaseAdmin.from("vehicle_images").insert(imageRows);

      // Update primary_image_url if vehicle didn't have one
      if (!hasPrimary) {
        await supabaseAdmin.from("vehicles")
          .update({ primary_image_url: newImages[0] })
          .eq("id", vehicleId);
      }
    }
  }
}

// ── Auto-Enrichment via Existing Extractors ──────────────────────

interface EnrichedData {
  year?: number;
  make?: string;
  model?: string;
  price?: number;
  description?: string;
  image_url?: string;
  image_urls?: string[];
  vin?: string;
  mileage?: number;
  engine?: string;
  transmission?: string;
  color?: string;
  location?: string;
  seller_name?: string;
}

async function tryAutoEnrich(url: string, platform: string): Promise<EnrichedData | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Map platform to extractor edge function
  const extractors: Record<string, string> = {
    bring_a_trailer: "bat-simple-extract",
    cars_and_bids: "extract-cars-and-bids-core",
    hagerty: "extract-hagerty-listing",
  };

  const extractorName = extractors[platform];
  if (!extractorName) return null;

  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/${extractorName}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    });

    if (!resp.ok) return null;

    const result = await resp.json();
    if (result.error) return null;

    // Normalize across extractors (they have slightly different schemas)
    const vehicle = result.vehicle || result.extracted || result;

    return {
      year: vehicle.year || null,
      make: vehicle.make || null,
      model: vehicle.model || null,
      price: vehicle.sale_price || vehicle.asking_price || vehicle.price || null,
      description: vehicle.description || vehicle.listing_description || null,
      image_url: vehicle.primary_image_url || vehicle.image_url || vehicle.images?.[0] || null,
      image_urls: vehicle.images || vehicle.image_urls || null,
      vin: vehicle.vin || null,
      mileage: vehicle.mileage || null,
      engine: vehicle.engine || null,
      transmission: vehicle.transmission || null,
      color: vehicle.exterior_color || vehicle.color || null,
      location: vehicle.location || null,
      seller_name: vehicle.seller_username || vehicle.seller_name || null,
    };
  } catch (e) {
    console.error(`Auto-enrich failed for ${platform}:`, e);
    return null;
  }
}

// ── Single Ingestion ────────────────────────────────────────────

interface IngestInput {
  url?: string;
  text?: string;
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  price?: number;
  location?: string;
  seller_name?: string;
  notes?: string;
  tags?: string[];
  image_url?: string;
  image_urls?: string[];
  description?: string;
  mileage?: number;
  engine?: string;
  transmission?: string;
  color?: string;
  condition?: string;
  title_status?: string;
  enrich?: boolean; // attempt to auto-enrich from source URL
}

interface IngestResult {
  status: "created" | "matched" | "duplicate" | "error";
  vehicle_id?: string;
  discovery_id?: string;
  is_new_vehicle?: boolean;
  source?: string;
  external_id?: string;
  error?: string;
}

async function ingestOne(input: IngestInput, userId: string | null): Promise<IngestResult> {
  try {
    // Determine source
    let platform = "manual";
    let externalId: string | null = null;
    let parsed: ParsedVehicle = { year: null, make: null, model: null };

    if (input.url) {
      const source = detectSource(input.url);
      platform = source.platform;
      externalId = source.externalId;
    }

    // Parse vehicle info from available data
    if (input.year && input.make) {
      parsed = { year: input.year, make: input.make, model: input.model || null };
    } else if (input.text) {
      parsed = parseVehicleTitle(input.text);
      if (!input.price) input.price = parsePrice(input.text);
      if (!input.location) {
        const loc = parseLocation(input.text);
        if (loc.city && loc.state) input.location = `${loc.city}, ${loc.state}`;
      }
    } else if (input.url) {
      parsed = {
        year: input.year || null,
        make: input.make || null,
        model: input.model || null,
      };
    }

    // Duplicate check: same user + same source URL = return existing discovery
    if (input.url && userId) {
      const { data: existingDiscovery } = await supabaseAdmin
        .from("user_vehicle_discoveries")
        .select("id, vehicle_id")
        .eq("user_id", userId)
        .eq("source_url", input.url)
        .limit(1)
        .single();

      if (existingDiscovery) {
        return {
          status: "duplicate",
          vehicle_id: existingDiscovery.vehicle_id,
          discovery_id: existingDiscovery.id,
          is_new_vehicle: false,
          source: platform,
          external_id: externalId,
        };
      }
    }

    // Auto-enrich: for BaT/C&B URLs, call existing extractors to get full data
    if (input.enrich !== false && input.url && !input.description) {
      const enriched = await tryAutoEnrich(input.url, platform);
      if (enriched) {
        if (!input.year && enriched.year) input.year = enriched.year;
        if (!input.make && enriched.make) input.make = enriched.make;
        if (!input.model && enriched.model) input.model = enriched.model;
        if (!input.price && enriched.price) input.price = enriched.price;
        if (!input.description && enriched.description) input.description = enriched.description;
        if (!input.image_url && enriched.image_url) input.image_url = enriched.image_url;
        if (!input.image_urls && enriched.image_urls) input.image_urls = enriched.image_urls;
        if (!input.vin && enriched.vin) input.vin = enriched.vin;
        if (!input.mileage && enriched.mileage) input.mileage = enriched.mileage;
        if (!input.engine && enriched.engine) input.engine = enriched.engine;
        if (!input.transmission && enriched.transmission) input.transmission = enriched.transmission;
        if (!input.color && enriched.color) input.color = enriched.color;
        if (!input.location && enriched.location) input.location = enriched.location;
        if (!input.seller_name && enriched.seller_name) input.seller_name = enriched.seller_name;
        // Re-parse if we got new structured data
        if (enriched.year && enriched.make) {
          parsed = { year: enriched.year, make: enriched.make, model: enriched.model || parsed.model };
        }
      }
    }

    // Match or create vehicle with ALL available enrichment data
    const match = await matchOrCreateVehicle({
      ...parsed,
      vin: input.vin,
      url: input.url,
      price: input.price,
      location: input.location,
      imageUrl: input.image_url,
      imageUrls: input.image_urls,
      description: input.description || input.notes,
      mileage: input.mileage,
      engine: input.engine,
      transmission: input.transmission,
      color: input.color,
      condition: input.condition,
      sellerName: input.seller_name,
    });

    // If this is a marketplace listing, upsert it and get the listing ID
    let marketplaceListingId: string | null = null;
    if (input.url && platform === "facebook_marketplace" && externalId) {
      const { data: listingData } = await supabaseAdmin
        .from("marketplace_listings")
        .upsert(
          {
            facebook_id: externalId,
            platform: "facebook_marketplace",
            url: input.url,
            title: parsed.year && parsed.make
              ? `${parsed.year} ${parsed.make} ${parsed.model || ""}`.trim()
              : null,
            price: input.price ? Math.round(input.price) : null,
            current_price: input.price || null,
            location: input.location || null,
            parsed_year: parsed.year,
            parsed_make: parsed.make?.toLowerCase() || null,
            parsed_model: parsed.model?.toLowerCase() || null,
            seller_name: input.seller_name || null,
            description: input.notes || null,
            image_url: input.image_url || null,
            vehicle_id: match.vehicleId,
            status: "active",
            first_seen_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
            scraped_at: new Date().toISOString(),
            search_query: "nuke-ingest",
          },
          { onConflict: "facebook_id" }
        )
        .select("id")
        .single();

      marketplaceListingId = listingData?.id || null;
    }

    // Link discovery to user profile
    let discoveryId: string | null = null;
    if (userId) {
      const discoveryTitle = parsed.year && parsed.make
        ? `${parsed.year} ${parsed.make} ${parsed.model || ""}`.trim()
        : input.text || input.url || "Unknown vehicle";

      const { data: discovery, error: discError } = await supabaseAdmin
        .from("user_vehicle_discoveries")
        .upsert(
          {
            user_id: userId,
            vehicle_id: match.vehicleId,
            source_platform: platform,
            source_url: input.url || null,
            source_external_id: externalId,
            discovered_price: input.price || null,
            discovered_location: input.location || null,
            discovered_seller_name: input.seller_name || null,
            discovered_title: discoveryTitle,
            interaction_status: "discovered",
            notes: input.notes || null,
            tags: input.tags || [],
            marketplace_listing_id: marketplaceListingId,
            discovered_at: new Date().toISOString(),
          },
          {
            onConflict: "user_id,vehicle_id,source_url",
            ignoreDuplicates: false,
          }
        )
        .select("id")
        .single();

      if (discError) {
        console.error("Discovery link error:", discError.message);
      } else {
        discoveryId = discovery?.id || null;
      }
    }

    return {
      status: match.isNew ? "created" : "matched",
      vehicle_id: match.vehicleId,
      discovery_id: discoveryId,
      is_new_vehicle: match.isNew,
      source: platform,
      external_id: externalId,
    };
  } catch (err: any) {
    return {
      status: "error",
      error: err.message,
    };
  }
}

// ── Serve ───────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Auth — determine the acting user
  let userId: string | null = null;
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const { data: { user } } = await supabaseAdmin.auth.getUser(token);
    if (user) userId = user.id;
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Allow service role to specify user_id explicitly
  if (body.user_id && !userId) {
    userId = body.user_id;
  }

  // Batch mode
  if (body.batch && Array.isArray(body.batch)) {
    if (body.batch.length > 50) {
      return new Response(JSON.stringify({ error: "Max 50 per batch" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = await Promise.all(
      body.batch.map((item: IngestInput) => ingestOne(item, userId))
    );

    const summary = {
      total: results.length,
      created: results.filter(r => r.status === "created").length,
      matched: results.filter(r => r.status === "matched").length,
      duplicates: results.filter(r => r.status === "duplicate").length,
      errors: results.filter(r => r.status === "error").length,
    };

    return new Response(
      JSON.stringify({ results, summary }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Single mode
  const result = await ingestOne(body as IngestInput, userId);

  return new Response(JSON.stringify(result), {
    status: result.status === "error" ? 500 : 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
