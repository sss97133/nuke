/**
 * Facebook Marketplace Listing Extractor
 *
 * Two modes:
 *   1. "direct" — accepts pre-extracted data from agents (no Firecrawl)
 *   2. URL mode — scrapes via Firecrawl, parses, inserts (legacy)
 *
 * POST /functions/v1/extract-facebook-marketplace
 *
 * Direct mode body: { mode: "direct", facebook_id, title, price, ... }
 * URL mode body:    { url: string, user_id?: string }
 *
 * Column mapping matches the local scraper (fb-marketplace-local-scraper.mjs).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractFacebookItemId(url: string): string | null {
  const match = url.match(/marketplace\/item\/([A-Za-z0-9_]+)/);
  return match ? match[1] : null;
}

function normalizeUrl(facebookId: string): string {
  return `https://www.facebook.com/marketplace/item/${facebookId}/`;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Vehicle Linking ──────────────────────────────────────────────────────────

/**
 * Attempt to link a marketplace listing to an existing vehicle record.
 *
 * Strategy:
 *   1. VIN exact match → vehicle_id (strong link)
 *   2. Year + Make + Model + same state → suggested_vehicle_id (soft link)
 *
 * Returns { vehicle_id, suggested_vehicle_id } — one or both may be null.
 */
async function linkToVehicle(params: {
  vin?: string | null;
  parsed_year?: number | null;
  parsed_make?: string | null;
  parsed_model?: string | null;
  location?: string | null;
  description?: string | null;
}): Promise<{ vehicle_id: string | null; suggested_vehicle_id: string | null }> {
  const out = { vehicle_id: null as string | null, suggested_vehicle_id: null as string | null };

  // Extract VIN from description if not provided directly
  let vin = params.vin ?? null;
  if (!vin && params.description) {
    const vinMatch = params.description.match(/\b([A-HJ-NPR-Z0-9]{17})\b/i);
    if (vinMatch) vin = vinMatch[1].toUpperCase();
  }

  // 1. VIN match — strongest signal
  if (vin) {
    const { data: vinHit } = await supabase
      .from("vehicles")
      .select("id")
      .eq("vin", vin)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (vinHit) {
      out.vehicle_id = vinHit.id;
      return out;
    }
  }

  // 2. YMM + state match — soft link
  const { parsed_year, parsed_make, parsed_model, location } = params;
  if (!parsed_year || !parsed_make) return out;

  // Parse state from "City, ST" format
  const stateMatch = location?.match(/,\s*([A-Z]{2})$/);
  const state = stateMatch ? stateMatch[1] : null;

  let query = supabase
    .from("vehicles")
    .select("id")
    .eq("year", parsed_year)
    .ilike("make", parsed_make)
    .eq("status", "active")
    .limit(5);

  if (parsed_model) {
    query = query.ilike("model", parsed_model);
  }

  if (state) {
    query = query.eq("state", state);
  }

  const { data: ymmHits } = await query;

  if (ymmHits && ymmHits.length === 1) {
    // Single match — high confidence suggestion
    out.suggested_vehicle_id = ymmHits[0].id;
  } else if (ymmHits && ymmHits.length > 1 && ymmHits.length <= 3) {
    // Few matches — suggest the first (caller can review)
    out.suggested_vehicle_id = ymmHits[0].id;
  }
  // 4+ matches = too ambiguous, don't suggest

  return out;
}

// ── Direct Mode ──────────────────────────────────────────────────────────────

interface DirectInput {
  mode: "direct";
  facebook_id?: string;
  url?: string;
  title?: string;
  price?: number;
  current_price?: number;
  description?: string;
  location?: string;
  parsed_year?: number;
  parsed_make?: string;
  parsed_model?: string;
  mileage?: number;
  exterior_color?: string;
  interior_color?: string;
  transmission?: string;
  fuel_type?: string;
  image_url?: string;
  all_images?: string[];
  seller_name?: string;
  contact_info?: Record<string, unknown>;
  status?: string;
  agent_context?: {
    agent_id?: string;
    on_behalf_of?: string | null;
    session_type?: string;
  };
}

async function handleDirect(body: DirectInput) {
  // Resolve facebook_id: from body or URL
  let facebookId = body.facebook_id;
  if (!facebookId && body.url) {
    facebookId = extractFacebookItemId(body.url) ?? undefined;
  }
  if (!facebookId) {
    return jsonResponse({ error: "facebook_id or valid url required" }, 400);
  }

  const url = body.url || `https://www.facebook.com/marketplace/item/${facebookId}/`;

  // Check existing
  const { data: existing } = await supabase
    .from("marketplace_listings")
    .select("id, vehicle_id, submission_count")
    .eq("facebook_id", facebookId)
    .maybeSingle();

  if (existing) {
    // Update: bump submission_count, refresh last_seen_at, merge non-null fields
    const updates: Record<string, unknown> = {
      last_seen_at: new Date().toISOString(),
      submission_count: (existing.submission_count || 1) + 1,
    };

    // Merge any new non-null fields from body
    const mergeFields: Array<[string, unknown]> = [
      ["title", body.title],
      ["price", body.price != null ? Math.round(body.price) : undefined],
      ["current_price", body.current_price ?? body.price],
      ["description", body.description],
      ["location", body.location],
      ["parsed_year", body.parsed_year],
      ["extracted_year", body.parsed_year],
      ["parsed_make", body.parsed_make],
      ["parsed_model", body.parsed_model],
      ["mileage", body.mileage],
      ["exterior_color", body.exterior_color],
      ["interior_color", body.interior_color],
      ["transmission", body.transmission],
      ["fuel_type", body.fuel_type],
      ["image_url", body.image_url],
      ["all_images", body.all_images],
      ["seller_name", body.seller_name],
      ["contact_info", body.contact_info],
      ["status", body.status],
    ];

    for (const [col, val] of mergeFields) {
      if (val != null && val !== undefined) {
        updates[col] = val;
      }
    }

    // Append agent provenance to raw_scrape_data
    if (body.agent_context) {
      updates.raw_scrape_data = {
        agent_context: body.agent_context,
        submitted_at: new Date().toISOString(),
        mode: "direct",
      };
    }

    // Attempt vehicle linking if not already linked
    let vehicleId = existing.vehicle_id;
    if (!vehicleId) {
      const link = await linkToVehicle({
        vin: null,
        parsed_year: body.parsed_year,
        parsed_make: body.parsed_make,
        parsed_model: body.parsed_model,
        location: body.location,
        description: body.description,
      });
      if (link.vehicle_id) {
        updates.vehicle_id = link.vehicle_id;
        vehicleId = link.vehicle_id;
      }
      if (link.suggested_vehicle_id) {
        updates.suggested_vehicle_id = link.suggested_vehicle_id;
      }
    }

    await supabase
      .from("marketplace_listings")
      .update(updates)
      .eq("id", existing.id);

    return jsonResponse({
      success: true,
      listing_id: existing.id,
      vehicle_id: vehicleId,
      is_new: false,
      submission_count: (existing.submission_count || 1) + 1,
    });
  }

  // New listing — attempt vehicle linking before insert
  const link = await linkToVehicle({
    vin: null,
    parsed_year: body.parsed_year,
    parsed_make: body.parsed_make,
    parsed_model: body.parsed_model,
    location: body.location,
    description: body.description,
  });

  const row: Record<string, unknown> = {
    facebook_id: facebookId,
    platform: "facebook_marketplace",
    url: normalizeUrl(facebookId),
    title: body.title || null,
    price: body.price != null ? Math.round(body.price) : null,
    current_price: body.current_price ?? body.price ?? null,
    description: body.description || null,
    location: body.location || null,
    parsed_year: body.parsed_year || null,
    extracted_year: body.parsed_year || null,
    parsed_make: body.parsed_make || null,
    parsed_model: body.parsed_model || null,
    mileage: body.mileage || null,
    exterior_color: body.exterior_color || null,
    interior_color: body.interior_color || null,
    transmission: body.transmission || null,
    fuel_type: body.fuel_type || null,
    image_url: body.image_url || null,
    all_images: body.all_images || null,
    seller_name: body.seller_name || null,
    contact_info: body.contact_info || null,
    status: body.status || "active",
    last_seen_at: new Date().toISOString(),
    raw_scrape_data: {
      agent_context: body.agent_context || null,
      submitted_at: new Date().toISOString(),
      mode: "direct",
    },
  };

  // Apply vehicle linking results
  if (link.vehicle_id) row.vehicle_id = link.vehicle_id;
  if (link.suggested_vehicle_id) row.suggested_vehicle_id = link.suggested_vehicle_id;

  const { data: inserted, error: insertError } = await supabase
    .from("marketplace_listings")
    .insert(row)
    .select("id, vehicle_id")
    .maybeSingle();

  if (insertError) throw insertError;

  return jsonResponse({
    success: true,
    listing_id: inserted!.id,
    vehicle_id: inserted!.vehicle_id,
    is_new: true,
    submission_count: 1,
    linked_via: link.vehicle_id ? "vin" : link.suggested_vehicle_id ? "ymm_match" : null,
  });
}

// ── URL (Legacy) Mode ────────────────────────────────────────────────────────

/**
 * Parse year, make, model from FB Marketplace title.
 * Handles corrupted titles like "$4,5001972 Chevrolet C10".
 */
function parseTitle(title: string): {
  year: number | null;
  make: string | null;
  model: string | null;
  cleanPrice: number | null;
} {
  let cleanPrice: number | null = null;
  const priceMatch = title.match(/^\$?([\d,]+)/);
  if (priceMatch) {
    const priceStr = priceMatch[1].replace(/,/g, "");
    const yearAtEnd = priceStr.match(/((?:19[2-9]\d|20[0-3]\d))$/);
    if (yearAtEnd && priceStr.length > 4) {
      const priceDigits = priceStr.slice(0, -4);
      cleanPrice = priceDigits.length > 0 ? parseInt(priceDigits, 10) : null;
    } else if (priceStr.length <= 7 && !priceStr.match(/^(19|20)\d{2}$/)) {
      cleanPrice = parseInt(priceStr, 10);
    }
  }

  const cleaned = title
    .replace(/[·•—–|]/g, " ")
    .replace(/&#x[0-9a-fA-F]+;/g, " ")
    .replace(/^\$[\d,]+(?=\d{4})/g, "")
    .replace(/^\$[\d,]+\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const yearMatch = cleaned.match(/\b(19[2-9]\d|20[0-3]\d)\b/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

  if (!year) return { year: null, make: null, model: null, cleanPrice };

  const afterYear = cleaned.split(String(year))[1]?.trim() || "";
  const words = afterYear.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return { year, make: null, model: null, cleanPrice };

  const makeMap: Record<string, string> = {
    chevy: "Chevrolet", chevrolet: "Chevrolet", ford: "Ford", dodge: "Dodge",
    gmc: "GMC", toyota: "Toyota", honda: "Honda", nissan: "Nissan",
    mazda: "Mazda", subaru: "Subaru", mitsubishi: "Mitsubishi",
    jeep: "Jeep", ram: "Ram", chrysler: "Chrysler", plymouth: "Plymouth",
    pontiac: "Pontiac", buick: "Buick", oldsmobile: "Oldsmobile",
    cadillac: "Cadillac", lincoln: "Lincoln", mercury: "Mercury",
    amc: "AMC", studebaker: "Studebaker", packard: "Packard",
    hudson: "Hudson", nash: "Nash", international: "International",
    willys: "Willys", kaiser: "Kaiser", datsun: "Datsun",
    volkswagen: "Volkswagen", vw: "Volkswagen", porsche: "Porsche",
    mercedes: "Mercedes-Benz", "mercedes-benz": "Mercedes-Benz",
    bmw: "BMW", audi: "Audi", volvo: "Volvo", saab: "Saab",
    jaguar: "Jaguar", triumph: "Triumph", mg: "MG", austin: "Austin",
    "austin-healey": "Austin-Healey", lotus: "Lotus", tvr: "TVR",
    alfa: "Alfa Romeo", "alfa romeo": "Alfa Romeo", fiat: "Fiat",
    ferrari: "Ferrari", maserati: "Maserati", lamborghini: "Lamborghini",
    lancia: "Lancia", delorean: "DeLorean", "de tomaso": "De Tomaso",
    shelby: "Shelby", ac: "AC", cobra: "AC Cobra",
  };

  const rawMake = words[0].toLowerCase();
  const make =
    makeMap[rawMake] ||
    words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();

  const stopWords = [
    "pickup", "truck", "sedan", "coupe", "wagon", "van", "suv",
    "convertible", "hatchback", "cab", "door", "bed", "ton", "series",
    "runs", "drives", "project", "restored", "original", "clean", "rare",
  ];
  const modelParts: string[] = [];
  for (let i = 1; i < Math.min(words.length, 5); i++) {
    const lower = words[i].toLowerCase();
    if (stopWords.includes(lower)) break;
    if (/^[A-Z][a-z]+,$/.test(words[i])) break;
    modelParts.push(words[i]);
    if (modelParts.length >= 2) break;
  }

  const model = modelParts.length > 0 ? modelParts.join(" ") : null;
  return { year, make, model, cleanPrice };
}

function extractPrice(text: string): number | null {
  const patterns = [
    /\$\s*(\d{1,3}(?:,\d{3})*)/,
    /\$\s*(\d+)(?!\d)/,
    /asking\s*\$?\s*(\d{1,3}(?:,\d{3})*)/i,
    /price[:\s]+\$?\s*(\d{1,3}(?:,\d{3})*)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const price = parseInt(match[1].replace(/,/g, ""), 10);
      if (price >= 100 && price <= 500000) return price;
    }
  }
  return null;
}

function extractMileage(text: string): number | null {
  const patterns = [
    /(\d{1,3}(?:,\d{3})*)\s*(?:miles?|mi)\b/i,
    /(\d+)k\s*(?:miles?|mi)?\b/i,
    /mileage[:\s]*(\d{1,3}(?:,\d{3})*)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const num = match[1].replace(/,/g, "");
      if (match[0].toLowerCase().includes("k")) return parseInt(num, 10) * 1000;
      return parseInt(num, 10);
    }
  }
  return null;
}

function extractVin(text: string): string | null {
  const match = text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/i);
  return match ? match[1].toUpperCase() : null;
}

function extractLocation(text: string): string | null {
  const stateAbbrevs = [
    "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN",
    "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV",
    "NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN",
    "TX","UT","VT","VA","WA","WV","WI","WY",
  ];
  for (const state of stateAbbrevs) {
    const pattern = new RegExp(`([A-Za-z\\s]+),\\s*${state}\\b`, "i");
    const match = text.match(pattern);
    if (match) return `${match[1].trim()}, ${state}`;
  }
  return null;
}

async function scrapeWithFirecrawl(url: string): Promise<any> {
  if (!FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY not configured");
  const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify({
      url,
      formats: ["markdown", "html"],
      includeTags: ["meta", "title", "img"],
      waitFor: 3000,
    }),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Firecrawl error: ${response.status} - ${error}`);
  }
  return response.json();
}

function filterVehicleImages(images: string[]): string[] {
  const result: string[] = [];
  for (const url of images) {
    if (!url.includes("scontent") && !url.includes("fbcdn")) continue;
    if (url.includes("profile") || url.includes("emoji") || url.includes("static")) continue;
    if (url.includes("rsrc.php") || url.includes("messenger") || url.includes("badge") || url.includes("icon")) continue;
    result.push(url);
  }
  return [...new Set(result)];
}

async function handleUrlMode(body: { url: string; user_id?: string }) {
  const { url, user_id } = body;
  if (!url) return jsonResponse({ error: "URL required" }, 400);

  const itemId = extractFacebookItemId(url);
  if (!itemId) return jsonResponse({ error: "Invalid Facebook Marketplace URL" }, 400);

  const normalizedUrl = normalizeUrl(itemId);

  // Check existing by facebook_id
  const { data: existing } = await supabase
    .from("marketplace_listings")
    .select("id, vehicle_id, submission_count")
    .eq("facebook_id", itemId)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("marketplace_listings")
      .update({
        last_seen_at: new Date().toISOString(),
        submission_count: (existing.submission_count || 1) + 1,
      })
      .eq("id", existing.id);

    return jsonResponse({
      success: true,
      listing_id: existing.id,
      vehicle_id: existing.vehicle_id,
      is_new: false,
      submission_count: (existing.submission_count || 1) + 1,
      message: "Listing already tracked",
    });
  }

  // NOTE: Firecrawl blocks facebook.com (403). URL mode only works if a
  // residential proxy is configured. For most use cases, prefer mode: "direct"
  // with pre-extracted data from the DOM (Claude in Chrome, etc.).
  console.log(`Scraping FB Marketplace: ${normalizedUrl}`);
  const scrapeResult = await scrapeWithFirecrawl(normalizedUrl);
  const data = scrapeResult.data || scrapeResult;
  const markdown = data.markdown || "";
  const html = data.html || "";
  const metadata = data.metadata || {};

  const rawTitle = metadata["og:title"] || metadata.title || "";
  const parsed = parseTitle(rawTitle);
  const allText = [metadata.description || "", metadata["og:description"] || "", markdown].join(" ");

  // Extract images
  const imageUrls: string[] = [];
  if (metadata["og:image"]) imageUrls.push(metadata["og:image"]);
  const imgMatches = html.matchAll(/<img[^>]+src="([^"]+scontent[^"]+)"/gi);
  for (const m of imgMatches) imageUrls.push(m[1]);
  const filtered = filterVehicleImages(imageUrls);

  const location = extractLocation(allText);
  const price = parsed.cleanPrice || extractPrice(rawTitle + " " + allText);

  // Build description
  let description = metadata["og:description"] || "";
  const descMatch = markdown.match(/(?:Description|About this item)[:\s]*([^#]+)/i);
  if (descMatch && descMatch[1].length > description.length) {
    description = descMatch[1].trim();
  }

  // Map to actual table columns
  const row: Record<string, unknown> = {
    facebook_id: itemId,
    platform: "facebook_marketplace",
    url: normalizedUrl,
    title: rawTitle || null,
    price: price != null ? Math.round(price) : null,
    current_price: price,
    description: description || null,
    location: location,
    parsed_year: parsed.year,
    extracted_year: parsed.year,
    parsed_make: parsed.make,
    parsed_model: parsed.model,
    mileage: extractMileage(allText),
    image_url: filtered[0] || imageUrls[0] || null,
    all_images: filtered.length > 0 ? filtered : imageUrls.slice(0, 10),
    seller_name: null,
    status: "active",
    last_seen_at: new Date().toISOString(),
    raw_scrape_data: {
      metadata,
      markdown_preview: markdown.substring(0, 2000),
      scraped_at: new Date().toISOString(),
      mode: "url",
      vin: extractVin(allText),
    },
  };

  const { data: inserted, error: insertError } = await supabase
    .from("marketplace_listings")
    .insert(row)
    .select("id, vehicle_id")
    .maybeSingle();

  if (insertError) throw insertError;

  return jsonResponse({
    success: true,
    listing_id: inserted!.id,
    vehicle_id: inserted!.vehicle_id,
    is_new: true,
    submission_count: 1,
    extracted: {
      year: parsed.year,
      make: parsed.make,
      model: parsed.model,
      price,
      location,
    },
  });
}

// ── Main Handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    if (body.mode === "direct") {
      return await handleDirect(body as DirectInput);
    }

    return await handleUrlMode(body);
  } catch (error) {
    console.error("FB Marketplace extraction error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
});
