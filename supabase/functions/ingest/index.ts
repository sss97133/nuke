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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { normalizeVehicleFields, normalizeMake } from "../_shared/normalizeVehicle.ts";
import { qualityGate } from "../_shared/extractionQualityGate.ts";
import { validateVINChecksum } from "../_shared/intelligence-layer.ts";
import { decodeVin } from "../_shared/vin-decoder.ts";

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

// Title-parsing make list — includes common aliases for matching.
// normalizeMake() from normalizeVehicle.ts handles canonical form conversion.
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
  "Aston Martin", "Rolls-Royce", "Bentley", "McLaren", "Bugatti",
  "Tesla", "Rivian", "Hummer", "International Harvester",
];

interface ParsedVehicle {
  year: number | null;
  make: string | null;
  model: string | null;
}

// Models/sub-brands that unambiguously identify a make when the title omits it.
// Improves title parsing for facebook-saved and other sources with informal titles.
const MODEL_IMPLIES_MAKE: Record<string, string> = {
  // Chevrolet
  "corvette": "Chevrolet", "camaro": "Chevrolet", "chevelle": "Chevrolet",
  "nova": "Chevrolet", "el camino": "Chevrolet", "impala": "Chevrolet",
  "bel air": "Chevrolet", "monte carlo": "Chevrolet", "blazer": "Chevrolet",
  "silverado": "Chevrolet", "suburban": "Chevrolet",
  "c10": "Chevrolet", "c-10": "Chevrolet", "c20": "Chevrolet", "c-20": "Chevrolet",
  "c30": "Chevrolet", "c-30": "Chevrolet", "k10": "Chevrolet", "k-10": "Chevrolet",
  "k20": "Chevrolet", "k-20": "Chevrolet", "k5": "Chevrolet",
  "square body": "Chevrolet", "squarebody": "Chevrolet",
  "stingray": "Chevrolet",
  // GMC
  "k15": "GMC", "k-15": "GMC",
  // Ford
  "mustang": "Ford", "bronco": "Ford", "thunderbird": "Ford",
  "f-100": "Ford", "f100": "Ford", "f-150": "Ford", "f150": "Ford",
  "f-250": "Ford", "f250": "Ford", "f-350": "Ford", "f350": "Ford",
  "fairlane": "Ford", "galaxie": "Ford", "falcon": "Ford",
  // Dodge / Plymouth
  "charger": "Dodge", "challenger": "Dodge", "coronet": "Dodge",
  "roadrunner": "Plymouth", "road runner": "Plymouth",
  "barracuda": "Plymouth", "'cuda": "Plymouth", "cuda": "Plymouth",
  "duster": "Plymouth", "satellite": "Plymouth", "gtx": "Plymouth",
  // Pontiac
  "firebird": "Pontiac", "trans am": "Pontiac", "gto": "Pontiac",
  // Misc
  "scout": "International Harvester",
  "moke": "MINI",
};

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
      return { year, make: normalizeMake(make) || make, model };
    }
  }

  // No explicit make found — check if a known model name implies the make
  for (const [keyword, impliedMake] of Object.entries(MODEL_IMPLIES_MAKE)) {
    const re = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(lower)) {
      // Extract model as the text starting from the keyword
      const modelStart = lower.indexOf(keyword.toLowerCase());
      const modelText = afterYear.slice(modelStart).split(/[\s·•|—,\-$]+/)
        .filter(w => w && !/^\d+$/.test(w) && !/^\$/.test(w))
        .slice(0, 3)
        .join(" ")
        .trim() || keyword;
      return { year, make: impliedMake, model: modelText };
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
  parsed: ParsedVehicle & VehicleEnrichment,
  platform?: string | null,
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
    source: platform && platform !== "unknown" ? platform : null,
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
    bring_a_trailer: "complete-bat-import",
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
  _source?: string; // source hint from caller (e.g. "facebook_saved")
  sold?: boolean; // sold status from caller
}

interface IngestResult {
  status: "created" | "matched" | "duplicate" | "rejected" | "error";
  vehicle_id?: string | null;
  discovery_id?: string | null;
  is_new_vehicle?: boolean;
  source?: string | null;
  external_id?: string | null;
  error?: string;
  // Validation gate fields (present when status=rejected or flagged)
  quality_score?: number;
  issues?: string[];
  suggestions?: Record<string, string>;
  needs_review?: boolean;
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

    // Source hint override (e.g. from facebook_saved connector)
    if (input._source === "facebook_saved") {
      platform = "facebook-saved";
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

    // ── VALIDATION GATE ─────────────────────────────────────────────
    // Normalize + validate before writing to DB. Catches: wrong make from
    // VIN, RPO codes in body_style, impossible fuel/year combos, garbage.
    const candidateData: Record<string, any> = {
      year: parsed.year ?? input.year,
      make: parsed.make ?? input.make,
      model: parsed.model ?? input.model,
      vin: input.vin ?? null,
      price: input.price ?? null,
      asking_price: input.price ?? null,
      description: input.description || input.notes || null,
      mileage: input.mileage ?? null,
      engine: input.engine ?? null,
      transmission: input.transmission ?? null,
      color: input.color ?? null,
      body_style: (input as any).body_style ?? null,
      fuel_type: (input as any).fuel_type ?? null,
      condition: input.condition ?? null,
    };

    // 1) Normalize fields (make aliases, VIN cleanup, RPO→trim, etc.)
    normalizeVehicleFields(candidateData);

    // 2) VIN cross-check: if VIN present, verify make against VIN prefix
    // Handles both modern 17-char and pre-1981 shorter VINs
    const vinIssues: string[] = [];
    const suggestions: Record<string, string> = {};
    if (candidateData.vin && typeof candidateData.vin === "string" && candidateData.vin.length >= 6) {
      const decoded = decodeVin(candidateData.vin);
      if (decoded.make && candidateData.make) {
        const vinMake = normalizeMake(decoded.make);
        const claimedMake = normalizeMake(candidateData.make);
        if (vinMake && claimedMake && vinMake !== claimedMake) {
          vinIssues.push(`vin_make_mismatch: VIN prefix indicates ${vinMake}, claimed ${claimedMake}`);
          suggestions.make = `VIN indicates ${vinMake}, not ${claimedMake}`;
        }
      }
      // Pre-1981: if VIN decoded a model, cross-check against claimed model
      if (decoded.is_pre_1981 && decoded.model && candidateData.model) {
        const vinModel = decoded.model.toLowerCase();
        const claimedModel = String(candidateData.model).toLowerCase();
        // Only flag if models are clearly different vehicle lines
        // e.g. VIN says Corvette but claim says Camaro (or vice versa)
        const conflictingModels = [
          ['corvette', 'camaro'], ['corvette', 'chevelle'], ['corvette', 'nova'],
          ['camaro', 'chevelle'], ['camaro', 'nova'], ['camaro', 'corvette'],
        ];
        for (const [a, b] of conflictingModels) {
          if (vinModel.includes(a) && claimedModel.includes(b)) {
            vinIssues.push(`vin_model_mismatch: VIN indicates ${decoded.model}, claimed ${candidateData.model}`);
            suggestions.model = `VIN indicates ${decoded.model}, not ${candidateData.model}`;
            break;
          }
        }
      }
    }

    // 3) Cross-field sanity checks
    const crossFieldIssues: string[] = [];
    const yr = Number(candidateData.year) || 0;
    if (yr > 0 && yr < 1990 && candidateData.fuel_type &&
        /^electric$/i.test(String(candidateData.fuel_type))) {
      crossFieldIssues.push(`anachronistic_fuel: Electric fuel_type on ${yr} vehicle`);
      suggestions.fuel_type = `Electric vehicles did not exist in ${yr}`;
    }

    // 4) Quality gate (uses normalizeVehicleFields internally, scores identity/specs/cleanliness)
    const sourceType = platform === "facebook_marketplace" ? "marketplace" as const
      : ["bring_a_trailer", "cars_and_bids", "hagerty"].includes(platform) ? "auction" as const
      : "other" as const;

    const gateResult = qualityGate(candidateData, {
      source: platform,
      sourceType,
    });

    // Merge VIN + cross-field issues into gate result
    gateResult.issues.push(...vinIssues, ...crossFieldIssues);

    // Determine if we should reject
    if (gateResult.action === "reject" || vinIssues.some(i => i.startsWith("vin_make_mismatch"))) {
      // VIN-make mismatch is a hard reject — the data is verifiably wrong
      if (vinIssues.some(i => i.startsWith("vin_make_mismatch"))) {
        gateResult.action = "reject";
      }
      return {
        status: "rejected",
        quality_score: gateResult.score,
        issues: gateResult.issues,
        suggestions: Object.keys(suggestions).length > 0 ? suggestions : undefined,
        source: platform,
        external_id: externalId,
      };
    }

    // Apply cleaned/normalized data back to parsed + input
    parsed = {
      year: gateResult.cleaned.year ?? parsed.year,
      make: gateResult.cleaned.make ?? parsed.make,
      model: gateResult.cleaned.model ?? parsed.model,
    };
    if (gateResult.cleaned.vin) input.vin = gateResult.cleaned.vin;
    if (gateResult.cleaned.transmission) input.transmission = gateResult.cleaned.transmission;
    if (gateResult.cleaned.color) input.color = gateResult.cleaned.color;
    if (gateResult.cleaned.engine) input.engine = gateResult.cleaned.engine;

    const needsReview = gateResult.action === "flag_for_review";

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
    }, platform);

    // Facebook Saved: set status based on sold flag
    if (platform === "facebook-saved" && match.vehicleId) {
      const isSold = !!(input as any).sold;
      const fbUpdates: Record<string, any> = {
        source: "facebook-saved",
        discovery_source: "facebook-saved",
        status: isSold ? "sold" : "discovered",
        auction_status: isSold ? "ended" : null,
        is_for_sale: !isSold,
      };
      if (input.seller_name) {
        fbUpdates.seller_name = input.seller_name;
      }
      await supabaseAdmin.from("vehicles")
        .update(fbUpdates)
        .eq("id", match.vehicleId);

      // Create observation in the ontology layer
      try {
        const title = [parsed.year, parsed.make, parsed.model].filter(Boolean).join(" ");
        const structuredData: Record<string, unknown> = {
          year: parsed.year, make: parsed.make, model: parsed.model,
          sold: isSold, is_for_sale: !isSold,
        };
        if (input.price) structuredData.price = input.price;
        if (input.mileage) structuredData.mileage = input.mileage;
        if (input.transmission) structuredData.transmission = input.transmission;
        if (input.color) structuredData.color = input.color;
        if (input.seller_name) structuredData.seller_name = input.seller_name;
        if (input.location) structuredData.location = input.location;

        const contentText = [title, input.price ? `$${input.price}` : null, input.location].filter(Boolean).join(" ");

        // Look up source_id for facebook-saved
        const { data: srcRow } = await supabaseAdmin
          .from("observation_sources")
          .select("id")
          .eq("slug", "facebook-saved")
          .single();

        if (srcRow) {
          await supabaseAdmin.from("vehicle_observations").upsert({
            vehicle_id: match.vehicleId,
            vehicle_match_confidence: 1.0,
            observed_at: new Date().toISOString(),
            source_id: srcRow.id,
            source_url: input.url || null,
            source_identifier: `fb-saved-${match.vehicleId}`,
            kind: "listing",
            content_text: contentText,
            content_hash: await crypto.subtle.digest("SHA-256",
              new TextEncoder().encode(`facebook-saved:listing:${match.vehicleId}:${contentText}`)
            ).then(buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("")),
            structured_data: structuredData,
          }, { onConflict: "source_id,source_identifier,kind,content_hash", ignoreDuplicates: true });

          // Create field_evidence for each non-null spec
          const evidenceRows: Array<Record<string, unknown>> = [];
          const specs: Array<[string, unknown, string]> = [
            ["asking_price", input.price, "FB Marketplace listing price"],
            ["mileage", input.mileage, "Seller-reported mileage on FB listing"],
            ["transmission", input.transmission, "Seller-reported transmission on FB listing"],
            ["color", input.color, "Seller-reported color on FB listing"],
            ["year", parsed.year, "Year from FB listing title"],
            ["make", parsed.make, "Make from FB listing title"],
            ["model", parsed.model, "Model from FB listing title"],
            ["seller_name", input.seller_name, "FB Marketplace seller profile name"],
          ];
          for (const [field, val, ctx] of specs) {
            if (val) {
              evidenceRows.push({
                vehicle_id: match.vehicleId,
                field_name: field,
                proposed_value: String(val),
                source_type: "fb_marketplace_listing",
                source_confidence: 55,
                extraction_context: ctx,
                status: "accepted",
              });
            }
          }
          if (evidenceRows.length > 0) {
            await supabaseAdmin.from("field_evidence")
              .upsert(evidenceRows, {
                onConflict: "vehicle_id,field_name,source_type,proposed_value",
                ignoreDuplicates: true,
              });
          }
        }
      } catch (obsErr: any) {
        console.error("Observation creation error (non-fatal):", obsErr.message);
      }
    }

    // If flagged for review, mark the vehicle
    if (needsReview && match.vehicleId) {
      await supabaseAdmin.from("vehicles")
        .update({ needs_review: true })
        .eq("id", match.vehicleId);
    }

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
      quality_score: gateResult.score,
      issues: gateResult.issues.length > 0 ? gateResult.issues : undefined,
      needs_review: needsReview || undefined,
    };
  } catch (err: any) {
    return {
      status: "error",
      error: err.message,
    };
  }
}

// ── Serve ───────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // GET → return schema documentation for agent self-discovery
  if (req.method === "GET") {
    return new Response(JSON.stringify({
      name: "nuke.ingest",
      description: "Universal vehicle ingestion endpoint. Accepts structured data, URLs, or free text.",
      methods: { POST: "Ingest vehicle(s)", GET: "This schema documentation" },
      fields: {
        url:          { type: "string",   required: false, example: "https://facebook.com/marketplace/item/123456", description: "Source listing URL — auto-detects platform" },
        text:         { type: "string",   required: false, example: "1980 Chevy C10 $27,500 Greeneville TN", description: "Free-text vehicle description — parsed for year/make/model/price/location" },
        year:         { type: "number",   required: false, example: 1978, description: "Model year (1885–current+2)" },
        make:         { type: "string",   required: false, example: "Chevrolet", description: "Manufacturer. Aliases normalized: Chevy→Chevrolet, VW→Volkswagen, etc." },
        model:        { type: "string",   required: false, example: "Caprice Classic", description: "Model name" },
        vin:          { type: "string",   required: false, example: "1GCEK14L9EJ147915", description: "VIN — checksum validated, cross-checked against make" },
        price:        { type: "number",   required: false, example: 10500, description: "Asking or sale price in USD" },
        location:     { type: "string",   required: false, example: "Sun City, AZ", description: "Seller location (City, ST)" },
        mileage:      { type: "number",   required: false, example: 83000, description: "Odometer reading in miles" },
        engine:       { type: "string",   required: false, example: "5.7L V8", description: "Engine description" },
        transmission: { type: "string",   required: false, example: "TH350 Automatic", description: "Normalized: auto→Automatic, 4x4→4WD, etc." },
        color:        { type: "string",   required: false, example: "White", description: "Exterior color" },
        condition:    { type: "string",   required: false, example: "Good", description: "Condition notes" },
        title_status: { type: "string",   required: false, example: "clean", description: "Title status: clean, salvage, rebuilt, none" },
        description:  { type: "string",   required: false, example: "Original paint, matching numbers 350", description: "Full listing description" },
        image_url:    { type: "string",   required: false, description: "Primary image URL" },
        image_urls:   { type: "string[]", required: false, description: "Array of image URLs" },
        seller_name:  { type: "string",   required: false, description: "Seller display name" },
        notes:        { type: "string",   required: false, description: "User notes about the vehicle" },
        tags:         { type: "string[]", required: false, example: ["project", "barn find"], description: "User-defined tags" },
        enrich:       { type: "boolean",  required: false, default: true, description: "Auto-enrich from source URL extractors" },
        batch:        { type: "array",    required: false, description: "Array of up to 50 items (each an object with fields above)" },
        user_id:      { type: "string",   required: false, description: "Explicit user ID (service role only)" },
      },
      validation: {
        description: "All submissions pass through a quality gate before DB write",
        checks: [
          "Make normalization (107 aliases: Chevy→Chevrolet, merc→Mercedes-Benz, etc.)",
          "VIN checksum validation (MOD11 for 17-char VINs)",
          "VIN-make cross-check (rejects Corvette VIN filed as Camaro)",
          "Year bounds (< 1885 or > currentYear+2 rejected)",
          "RPO codes in body_style moved to trim (L79 Pickup → body_style=Pickup, trim=L79)",
          "Transmission normalization (auto→Automatic, 4x4→4WD)",
          "HTML/pollution detection in text fields",
          "Cross-field sanity (year < 1990 + Electric fuel → flagged)",
          "Quality score 0-1 (reject < 0.2, review < 0.5, accept ≥ 0.5)",
        ],
      },
      responses: {
        created:  { description: "New vehicle created", fields: ["vehicle_id", "quality_score", "issues"] },
        matched:  { description: "Matched existing vehicle (enriched)", fields: ["vehicle_id", "quality_score"] },
        duplicate:{ description: "Same user+URL already ingested", fields: ["vehicle_id", "discovery_id"] },
        rejected: { description: "Failed validation gate", fields: ["quality_score", "issues", "suggestions"] },
        error:    { description: "Server error", fields: ["error"] },
      },
      example_curl: 'curl -X POST .../functions/v1/ingest -H "Authorization: Bearer <key>" -H "Content-Type: application/json" -d \'{"year":1978,"make":"Chevrolet","model":"Caprice Classic","price":10500,"location":"Sun City, AZ"}\'',
    }, null, 2), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "GET or POST only" }), {
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

  const httpStatus = result.status === "error" ? 500
    : result.status === "rejected" ? 422
    : 200;

  return new Response(JSON.stringify(result), {
    status: httpStatus,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
