/**
 * Facebook Marketplace Listing Extractor
 *
 * "direct" accepts extracted data; "browser_capture" retains bounded browser passes
 * with original source clocks and acknowledged sightings. URL mode is legacy Firecrawl.
 *
 * POST /functions/v1/extract-facebook-marketplace
 *
 * Direct mode body: { mode: "direct", facebook_id, title, price, ... }
 * URL mode body:    { url: string, user_id?: string }
 *
 * Column mapping matches the local scraper (fb-marketplace-local-scraper.mjs).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { writeObservation } from "../_shared/observationWriter.ts";
import { isGarbageMake } from "../_shared/normalizeVehicle.ts";
import { handleDirect as landDirect, type DirectInput } from "./direct.ts";
import { handleBrowserCapture } from "./capture.ts";
import { requireWriteAuth } from "../_shared/writeGuard.ts";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  projectSecretKey()!,
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

const handleDirect = (body: DirectInput) => landDirect(body, { supabase, linkToVehicle, writeObservation });

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

  // Skip leading dimension/engine/spec tokens ("5x8", "22r", "500cc", "115",
  // a doubled year) that FB titles lead with before the real make. (Gate 5.)
  let mi = 0;
  while (mi < words.length && !makeMap[words[mi].toLowerCase()] && isGarbageMake(words[mi])) mi++;
  const makeToken = words[mi] ?? "";
  const rawMake = makeToken.toLowerCase();
  // Reject a still-garbage token outright: unknown make = null, never a
  // number/single-char/year on a live listing.
  const make = makeMap[rawMake]
    ? makeMap[rawMake]
    : (!makeToken || isGarbageMake(makeToken))
    ? null
    : makeToken.charAt(0).toUpperCase() + makeToken.slice(1).toLowerCase();

  const stopWords = [
    "pickup", "truck", "sedan", "coupe", "wagon", "van", "suv",
    "convertible", "hatchback", "cab", "door", "bed", "ton", "series",
    "runs", "drives", "project", "restored", "original", "clean", "rare",
  ];
  const modelParts: string[] = [];
  for (let i = mi + 1; i < Math.min(words.length, mi + 5); i++) {
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

// ── Batch Mode (Saved Items) ─────────────────────────────────────────────────

interface BatchInput {
  mode: "batch";
  batch: Array<{
    facebook_id: string;
    title?: string;
    price?: number;
    seller?: string;
    sold?: boolean;
    url?: string;
    parsed_make?: string;
    parsed_model?: string;
    year?: number;
    location?: string;
    image_url?: string;
    _source?: string;
  }>;
  source?: string;
}

async function handleBatch(body: BatchInput) {
  const items = body.batch;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return jsonResponse({ error: "batch array required" }, 400);
  }

  const source = body.source || "facebook_saved";
  const results = { total: items.length, created: 0, updated: 0, skipped: 0, errors: 0 };

  for (const item of items) {
    try {
      if (!item.facebook_id) {
        results.skipped++;
        continue;
      }

      const directInput: DirectInput = {
        mode: "direct",
        facebook_id: item.facebook_id,
        url: item.url || `https://www.facebook.com/marketplace/item/${item.facebook_id}/`,
        title: item.title,
        price: item.price ?? undefined,
        parsed_year: item.year ?? undefined,
        parsed_make: item.parsed_make ?? undefined,
        parsed_model: item.parsed_model ?? undefined,
        seller_name: item.seller ?? undefined,
        location: item.location ?? undefined,
        image_url: item.image_url ?? undefined,
        status: item.sold ? "sold" : "active",
        agent_context: {
          agent_id: "fb-saved-sync",
          session_type: source,
        },
      };

      const resp = await handleDirect(directInput);
      const respBody = await resp.json();

      if (!resp.ok || !respBody.success) {
        results.errors++;
      } else if (respBody.is_new) {
        results.created++;
      } else {
        results.updated++;
      }
    } catch (e) {
      console.error(`Batch item error (${item.facebook_id}):`, e);
      results.errors++;
    }
  }

  return jsonResponse({
    success: results.errors === 0,
    source,
    ...results,
    message: `Synced ${results.created} new, ${results.updated} existing, ${results.skipped} skipped, ${results.errors} errors`,
  });
}

// ── Main Handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Writes are never anonymous: service key, signed-in user, or nothing (P0.2, 2026-09-27).
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    if (body.mode === "browser_capture") {
      return jsonResponse(await handleBrowserCapture(supabase, body, (item) => landDirect(item, { supabase, linkToVehicle, writeObservation, capturePrepared: true })));
    }

    if (body.mode === "batch") {
      return await handleBatch(body as BatchInput);
    }

    if (body.mode === "direct") {
      return await handleDirect(body as DirectInput);
    }

    return await handleUrlMode(body);
  } catch (error) {
    console.error("FB Marketplace extraction error:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
