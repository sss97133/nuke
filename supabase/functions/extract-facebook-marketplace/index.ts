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
import { integrateListings, type IntegrationDeps, type IntegrationReceipt, type LandedResult } from "./integrate.ts";
import { landClassifiedListing } from "../ingest/classifiedEvent.ts";
import { vehicleEventWriterFor } from "../_shared/vehicleEventWrite.ts";
const writeVehicleEventByKey = vehicleEventWriterFor("extract-facebook-marketplace");
import { intakeThrottle } from "../poll-listing-feeds/ledger.ts";
import { requireWriteAuth } from "../_shared/writeGuard.ts";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

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
  /** Browser captures leave year/make/model candidates to ingest's merge proposals; only a VIN links here. */
  vinOnly?: boolean;
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
  if (params.vinOnly || !parsed_year || !parsed_make) return out;

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

// ── Integration (after custody) ──────────────────────────────────────────────

async function ownFunction(name: string, body: unknown, timeoutMs: number): Promise<any> {
  const secret = projectSecretKey() ?? "";
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${name}`, { // guardrail-allow: raw-fetch (our own function)
    method: "POST", headers: { Authorization: `Bearer ${secret}`, apikey: secret, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  return await r.json().catch(() => ({ status: "error", error: `${name} HTTP ${r.status} (non-JSON body)` }));
}

const integrationDeps: IntegrationDeps = {
  supabase, writeObservation,
  callIngest: async (batch) => {
    const out: any[] = [];
    // ingest runs a batch's items concurrently; ten at a time keeps a 40-listing packet to four bounded calls.
    for (let i = 0; i < batch.length; i += 10) {
      const j = await ownFunction("ingest", { batch: batch.slice(i, i + 10) }, 60_000);
      if (!Array.isArray(j?.results)) throw new Error(j?.error ?? "ingest returned no results");
      out.push(...j.results);
    }
    return out;
  },
  landEvent: landClassifiedListing,
  writeEvent: writeVehicleEventByKey,
  promotionLimit: async () => {
    const { data, error } = await supabase.from("platform_config").select("config_value").eq("config_key", "source_intake").maybeSingle();
    if (error) throw new Error("intake throttle unavailable; no listing sent to ingest");
    const t = intakeThrottle(data?.config_value ?? {});
    const own = t.sources["facebook_marketplace"];
    return !t.enabled || own?.enabled === false ? 0 : (own?.max_ingests ?? t.max_ingests);
  },
  persistPhotos: (vehicleId, urls, observedAt) => {
    // Facebook CDN links carry an expiry of a few days; an older sighting's links would only fail.
    if (Date.now() - Date.parse(observedAt) > 72 * 3600_000) return false;
    // run_analysis false: copying photos must not start paid image analysis.
    EdgeRuntime.waitUntil(ownFunction("backfill-images", { vehicle_id: vehicleId, image_urls: urls,
      source: "facebook_marketplace", run_analysis: false, max_images: 20, listed_date: observedAt.slice(0, 10) }, 120_000)
      .catch((e) => console.error(`[fb] photo copy ${vehicleId}: ${e instanceof Error ? e.message : String(e)}`)));
    return true;
  },
};

/**
 * Integration for listings already in custody, read back from their rows: no new source visit, no submission count,
 * no change to the listing's testimony. Bounded: at most 50 rows per call, oldest-unlinked-last by last_seen_at.
 */
async function handleIntegrateReplay(body: { facebook_ids?: string[]; first_seen_since?: string; limit?: number }) {
  const limit = Math.min(Math.max(Number(body.limit ?? 25), 1), 50);
  let q = supabase.from("marketplace_listings").select(
    "id, facebook_id, vehicle_id, title, price, current_price, location, description, mileage, transmission, " +
    "exterior_color, interior_color, fuel_type, image_url, all_images, seller_profile_url, contact_info, status, last_seen_at",
  ).eq("platform", "facebook_marketplace");
  if (Array.isArray(body.facebook_ids) && body.facebook_ids.length) {
    q = q.in("facebook_id", body.facebook_ids.slice(0, 50).map(String));
  } else {
    const since = Date.parse(body.first_seen_since ?? "");
    if (!Number.isFinite(since)) return jsonResponse({ error: "facebook_ids or first_seen_since required" }, 400);
    q = q.is("vehicle_id", null).eq("status", "active").gte("first_seen_at", new Date(since).toISOString())
      .order("last_seen_at", { ascending: false });
  }
  const { data: rows, error } = await q.limit(limit);
  if (error) return jsonResponse({ error: error.message }, 500);
  const items: DirectInput[] = (rows ?? []).map((r: any) => ({
    mode: "direct", facebook_id: r.facebook_id, title: r.title ?? undefined, price: r.price ?? undefined,
    current_price: r.current_price ?? undefined, location: r.location ?? undefined, description: r.description ?? undefined,
    mileage: r.mileage ?? undefined, transmission: r.transmission ?? undefined, exterior_color: r.exterior_color ?? undefined,
    interior_color: r.interior_color ?? undefined, fuel_type: r.fuel_type ?? undefined, image_url: r.image_url ?? undefined,
    all_images: r.all_images ?? undefined, seller_profile_url: r.seller_profile_url ?? undefined,
    contact_info: r.contact_info ?? undefined, status: r.status ?? undefined,
    agent_context: { agent_id: "fb-integrate-replay", session_type: "retained_listing_row" },
  }));
  const seen = new Map((rows ?? []).map((r: any) => [r.facebook_id, r.last_seen_at]));
  const landed: LandedResult[] = (rows ?? []).map((r: any) => ({ facebook_id: r.facebook_id, listing_id: r.id, vehicle_id: r.vehicle_id, listing_landed: true }));
  const integration = await integrateListings(items, landed, integrationDeps,
    (b) => seen.get(b.facebook_id) ?? new Date().toISOString());
  return jsonResponse({ success: integration.errors.length === 0, rows: rows?.length ?? 0, integration });
}

async function integrate(items: DirectInput[], landed: LandedResult[]): Promise<IntegrationReceipt | { error: string }> {
  try {
    return await integrateListings(items, landed, integrationDeps, (b) => b.capture?.observed_at ?? new Date().toISOString());
  } catch (e) {
    console.error("FB integration error:", e);
    return { error: e instanceof Error ? e.message : String(e) };
  }
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
      const landed = await handleBrowserCapture(supabase, body, (item) => landDirect(item, { supabase, linkToVehicle, writeObservation, capturePrepared: true }));
      const integration = await integrate(body.batch.map((i: DirectInput) => ({ ...i, mode: "direct", capture: body.capture })), landed.results);
      // The custody receipt is written; the integration receipt joins it on the same ledger row.
      const run = await supabase.from("fb_sweep_jobs").select("metadata").eq("id", landed.capture_id).maybeSingle();
      if (run.data && !run.data.metadata?.integration) {
        const saved = await supabase.from("fb_sweep_jobs").update({ metadata: { ...run.data.metadata, integration } })
          .eq("id", landed.capture_id);
        if (saved.error) console.error(`[fb] integration receipt ${landed.capture_id}: ${saved.error.message}`);
      }
      return jsonResponse({ ...landed, integration });
    }

    if (body.mode === "batch") {
      return await handleBatch(body as BatchInput);
    }

    if (body.mode === "integrate") {
      return await handleIntegrateReplay(body);
    }

    if (body.mode === "direct") {
      const resp = await handleDirect(body as DirectInput);
      const result = await resp.json();
      const facebookId = body.facebook_id ?? extractFacebookItemId(body.url ?? "");
      if (resp.ok && result.success && facebookId) {
        result.integration = await integrate([{ ...body, facebook_id: facebookId }], [{ ...result, facebook_id: facebookId }]);
      }
      return jsonResponse(result, resp.status);
    }

    return await handleUrlMode(body);
  } catch (error) {
    console.error("FB Marketplace extraction error:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
