import "jsr:@supabase/functions-js/edge-runtime.d.ts";
/**
 * GAA Classic Cars Extractor
 *
 * High-volume regional auction house - Greensboro, NC
 * 750+ cars per auction, 3-4 auctions per year
 *
 * Site structure:
 * - Current inventory: /vehicles?q[branch_id_eq]=62
 * - Past results: /vehicles/results?q[branch_id_eq]=59
 * - Individual: /vehicles/{id}/{slug}
 *
 * Extracts: year, make, model, VIN, lot number, sold price, images
 *
 * Deploy: supabase functions deploy extract-gaa-classics --no-verify-jwt
 *
 * Usage:
 *   POST {"url": "https://gaaclassiccars.com/vehicles/44408/..."}  - Extract single listing
 *   POST {"action": "crawl", "type": "inventory"}                  - Crawl current inventory
 *   POST {"action": "crawl", "type": "results"}                    - Crawl past results
 *   POST {"action": "crawl", "type": "all"}                        - Crawl both
 *   POST {"batch_size": 20}                                        - Process pending queue items
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const BASE_URL = "https://www.gaaclassiccars.com";
const INVENTORY_URL = `${BASE_URL}/vehicles?q%5Bbranch_id_eq%5D=62`;
const RESULTS_URL = `${BASE_URL}/vehicles/results?q%5Bbranch_id_eq%5D=59`;

// GAA organization ID (create or lookup)
const GAA_ORG_NAME = "GAA Classic Cars";

interface ExtractedVehicle {
  url: string;
  gaa_vehicle_id: string | null;
  lot_number: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  sub_model: string | null;
  vin: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  body_style: string | null;
  mileage: number | null;
  auction_date: string | null;
  run_day: string | null;
  sale_price: number | null;
  highest_bid: number | null;
  sold: boolean;
  not_sold: boolean;
  description: string | null;
  highlights: string[];
  image_urls: string[];
}

interface ListingItem {
  url: string;
  gaa_vehicle_id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  lot_number: string | null;
  vin: string | null;
  image_url: string | null;
  sale_price: number | null;
  highest_bid: number | null;
  sold: boolean;
  not_sold: boolean;
  auction_date: string | null;
}

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.text();
}

/**
 * Parse listing grid from inventory or results page
 */
function parseListingGrid(html: string): ListingItem[] {
  const items: ListingItem[] = [];

  // Match each vehicle item link
  // Pattern: <a class="gaa-vehicle-item" href="/vehicles/{id}/{slug}">
  const itemRegex = /<a[^>]*class="gaa-vehicle-item"[^>]*href="(\/vehicles\/(\d+)\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match;
  while ((match = itemRegex.exec(html)) !== null) {
    const [, path, vehicleId, content] = match;
    const url = `${BASE_URL}${path}`;

    // Extract VIN from hidden div
    const vinMatch = content.match(/<div[^>]*class=['"]vehicle-vin['"][^>]*style=['"]display:\s*none[^'"]*['"][^>]*>\s*([\w\d]+)\s*<\/div>/i);
    const vin = vinMatch?.[1]?.trim() || null;

    // Extract lot number
    const lotMatch = content.match(/Lot\s*&#?35;?\s*([\w\d]+)/i) || content.match(/Lot\s*#\s*([\w\d]+)/i);
    const lot_number = lotMatch?.[1]?.trim() || null;

    // Extract year, make, model from structure
    // <div class='year-make'><h3>2003</h3><h3>Mercedes-Benz</h3></div>
    // <div class='model'>SL500 </div>
    const yearMatch = content.match(/<div[^>]*class=['"]year-make['"][^>]*>[\s\S]*?<h3>(\d{4})<\/h3>/i);
    const makeMatch = content.match(/<div[^>]*class=['"]year-make['"][^>]*>[\s\S]*?<h3>\d{4}<\/h3>\s*<h3>([^<]+)<\/h3>/i);
    const modelMatch = content.match(/<div[^>]*class=['"]model['"][^>]*>([^<]+)<\/div>/i);

    const year = yearMatch ? parseInt(yearMatch[1]) : null;
    const make = makeMatch?.[1]?.trim() || null;
    const model = modelMatch?.[1]?.trim() || null;

    // Extract image
    const imgMatch = content.match(/<img[^>]*src="(https:\/\/cdn\.dealeraccelerate\.com\/gaa\/[^"]+)"/i);
    const image_url = imgMatch?.[1] || null;

    // Extract sale price
    const priceMatch = content.match(/Sale\s*Price:\s*<\/span>\s*<strong>\s*\$?([\d,]+)/i);
    const sale_price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, "")) : null;

    // Extract highest bid (for not sold)
    const bidMatch = content.match(/Highest\s*Bid:\s*<\/span>\s*<strong>\s*\$?([\d,]+)/i);
    const highest_bid = bidMatch ? parseInt(bidMatch[1].replace(/,/g, "")) : null;

    // Check sold/not sold status
    const sold = content.includes("gaa-inventory-sold-banner") || (sale_price !== null && sale_price > 0);
    const not_sold = content.includes("gaa-not-sold") || content.toLowerCase().includes("not sold");

    // Extract auction date
    const dateMatch = content.match(/<span>\s*(\d{4}\s+\w+)\s*<\/span>/i);
    const auction_date = dateMatch?.[1]?.trim() || null;

    items.push({
      url,
      gaa_vehicle_id: vehicleId,
      year,
      make,
      model,
      lot_number,
      vin,
      image_url,
      sale_price,
      highest_bid,
      sold,
      not_sold,
      auction_date,
    });
  }

  return items;
}

/**
 * Extract full details from individual vehicle page
 */
function extractVehicleDetails(html: string, url: string): ExtractedVehicle {
  // Extract GAA vehicle ID from URL
  const idMatch = url.match(/\/vehicles\/(\d+)\//);
  const gaa_vehicle_id = idMatch?.[1] || null;

  // VIN from meta keywords or hidden div
  const keywordsMatch = html.match(/<meta[^>]*name=['"]keywords['"][^>]*content=['"]([^'"]+)['"][^>]*>/i);
  let vin: string | null = null;
  if (keywordsMatch) {
    const keywords = keywordsMatch[1];
    const vinFromKeywords = keywords.match(/\b([A-HJ-NPR-Z0-9]{17})\b/i) || keywords.match(/\b([A-Z0-9]{11,17})\b/i);
    vin = vinFromKeywords?.[1] || null;
  }

  // Also check hidden div
  const hiddenVinMatch = html.match(/<div[^>]*class=['"]vehicle-vin['"][^>]*style=['"]display:\s*none[^'"]*['"][^>]*>([\s\S]*?)<\/div>/i);
  if (!vin && hiddenVinMatch) {
    const vinText = hiddenVinMatch[1].trim();
    const vinExtract = vinText.match(/^([A-Z0-9]+)/i);
    vin = vinExtract?.[1] || null;
  }

  // Also try the visible VIN field
  const visibleVinMatch = html.match(/<div[^>]*class=['"]vin['"][^>]*>\s*VIN:\s*([A-Z0-9]+)/i);
  if (!vin && visibleVinMatch) {
    vin = visibleVinMatch[1];
  }

  // Lot number
  const lotMatch = html.match(/Lot\s*&#?35;?\s*<span[^>]*>([^<]+)<\/span>/i) ||
                   html.match(/Lot\s*#\s*<span[^>]*>([^<]+)<\/span>/i);
  const lot_number = lotMatch?.[1]?.trim() || null;

  // Year, Make, Model from header
  const yearMakeMatch = html.match(/<h1[^>]*class=['"]vehicle-year-make['"][^>]*>([\s\S]*?)<\/h1>/i);
  let year: number | null = null;
  let make: string | null = null;
  if (yearMakeMatch) {
    const text = yearMakeMatch[1].replace(/<[^>]+>/g, " ").trim();
    const parts = text.split(/\s+/);
    const yearStr = parts[0];
    year = yearStr ? parseInt(yearStr) : null;
    make = parts.slice(1).join(" ") || null;
  }

  const modelMatch = html.match(/<h1[^>]*class=['"]vehicle-name['"][^>]*>([\s\S]*?)<\/h1>/i);
  let model: string | null = null;
  let sub_model: string | null = null;
  if (modelMatch) {
    const modelText = modelMatch[1].replace(/<[^>]+>/g, " ").trim();
    const parts = modelText.split(/\s+/);
    model = parts[0] || null;
    sub_model = parts.length > 1 ? parts.slice(1).join(" ") : null;
  }

  // Specs section
  const specsMatch = html.match(/<div[^>]*class=['"]gaa-specs['"][^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i);
  let exterior_color: string | null = null;
  let interior_color: string | null = null;
  let body_style: string | null = null;

  if (specsMatch) {
    const specsHtml = specsMatch[1];

    const bodyColorMatch = specsHtml.match(/<dt>Body\s*Color<\/dt>\s*<dd>([^<]+)<\/dd>/i);
    exterior_color = bodyColorMatch?.[1]?.trim() || null;

    const interiorMatch = specsHtml.match(/<dt>Interior\s*Color<\/dt>\s*<dd>([^<]+)<\/dd>/i);
    interior_color = interiorMatch?.[1]?.trim() || null;

    const bodyStyleMatch = specsHtml.match(/<dt>Body\s*Style<\/dt>\s*<dd>([^<]+)<\/dd>/i);
    body_style = bodyStyleMatch?.[1]?.trim() || null;
  }

  // Auction date
  const auctionMatch = html.match(/<div[^>]*class=['"]gaa-content-name['"][^>]*>\s*Auction:\s*<\/div>\s*<div[^>]*class=['"]gaa-auction-content['"][^>]*>([^<]+)<\/div>/i);
  const auction_date = auctionMatch?.[1]?.trim() || null;

  // Run day
  const runDayMatch = html.match(/<div[^>]*class=['"]gaa-content-name['"][^>]*>\s*Run\s*Day:\s*<\/div>\s*<div[^>]*class=['"]gaa-auction-content['"][^>]*>([^<]+)<\/div>/i);
  const run_day = runDayMatch?.[1]?.trim() || null;

  // Sale price (on results pages)
  const priceMatch = html.match(/Sale\s*Price:\s*<\/span>\s*<strong>\s*\$?([\d,]+)/i);
  const sale_price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, "")) : null;

  // Highest bid
  const bidMatch = html.match(/Highest\s*Bid:\s*<\/span>\s*<strong>\s*\$?([\d,]+)/i);
  const highest_bid = bidMatch ? parseInt(bidMatch[1].replace(/,/g, "")) : null;

  // Sold/not sold status
  const sold = html.includes("gaa-inventory-sold-banner") || (sale_price !== null && sale_price > 0);
  const not_sold = html.includes("gaa-not-sold") || html.toLowerCase().includes(">not sold<");

  // Description
  const descMatch = html.match(/<div[^>]*class=['"]gaa-about-vehicle['"][^>]*>\s*<h2>([^<]+)<\/h2>/i);
  const description = descMatch?.[1]?.trim() || null;

  // Mileage from highlights
  let mileage: number | null = null;
  const mileageMatch = html.match(/(\d{1,3}(?:,\d{3})*)\s*(?:Actual\s*)?Miles/i);
  if (mileageMatch) {
    mileage = parseInt(mileageMatch[1].replace(/,/g, ""));
  }

  // Highlights
  const highlights: string[] = [];
  const highlightsMatch = html.match(/<ul[^>]*class=['"]gaa-vehicle-highlights['"][^>]*>([\s\S]*?)<\/ul>/i);
  if (highlightsMatch) {
    const liRegex = /<li>([^<]+)<\/li>/gi;
    let li;
    while ((li = liRegex.exec(highlightsMatch[1])) !== null) {
      highlights.push(li[1].trim());
    }
  }

  // Images - from gallery
  const image_urls: string[] = [];
  const galleryMatch = html.match(/<div[^>]*class=['"]gaa-gallery['"][^>]*>([\s\S]*?)<\/div>/i);
  if (galleryMatch) {
    const imgRegex = /data-original="(https:\/\/cdn\.dealeraccelerate\.com\/gaa\/[^"]+\/x\/[^"]+)"/gi;
    let img;
    while ((img = imgRegex.exec(galleryMatch[1])) !== null) {
      // Convert to high-res URL
      const highResUrl = img[1].replace(/\/x\//, "/1920x1440/");
      if (!image_urls.includes(highResUrl)) {
        image_urls.push(highResUrl);
      }
    }
  }

  // Fallback: get from thumbnail hrefs
  if (image_urls.length === 0) {
    const thumbRegex = /<a[^>]*data-original="(https:\/\/cdn\.dealeraccelerate\.com\/gaa\/[^"]+)"/gi;
    let thumb;
    while ((thumb = thumbRegex.exec(html)) !== null) {
      const highResUrl = thumb[1].replace(/\/\d+x\d+\//, "/1920x1440/");
      if (!image_urls.includes(highResUrl)) {
        image_urls.push(highResUrl);
      }
    }
  }

  return {
    url,
    gaa_vehicle_id,
    lot_number,
    year,
    make,
    model,
    sub_model,
    vin,
    exterior_color,
    interior_color,
    body_style,
    mileage,
    auction_date,
    run_day,
    sale_price,
    highest_bid,
    sold,
    not_sold,
    description,
    highlights,
    image_urls,
  };
}

/**
 * Get total page count from listing page
 */
function getPageCount(html: string): number {
  // Pattern: "Page 1 of 54" or "Page 1 of 78"
  const match = html.match(/Page\s*\d+\s*of\s*(\d+)/i);
  return match ? parseInt(match[1]) : 1;
}

/**
 * Crawl all pages of inventory or results
 */
async function crawlListings(
  baseUrl: string,
  maxPages: number = 100,
  delayMs: number = 500
): Promise<ListingItem[]> {
  const allItems: ListingItem[] = [];

  // Fetch first page to get total count
  const firstPageHtml = await fetchPage(baseUrl);
  const totalPages = Math.min(getPageCount(firstPageHtml), maxPages);

  console.log(`[GAA] Found ${totalPages} pages to crawl`);

  // Parse first page
  const firstPageItems = parseListingGrid(firstPageHtml);
  allItems.push(...firstPageItems);
  console.log(`[GAA] Page 1/${totalPages}: ${firstPageItems.length} items`);

  // Crawl remaining pages
  for (let page = 2; page <= totalPages; page++) {
    // Add delay between requests
    await new Promise(resolve => setTimeout(resolve, delayMs));

    const pageUrl = `${baseUrl}&page=${page}`;
    try {
      const pageHtml = await fetchPage(pageUrl);
      const pageItems = parseListingGrid(pageHtml);
      allItems.push(...pageItems);
      console.log(`[GAA] Page ${page}/${totalPages}: ${pageItems.length} items`);
    } catch (error) {
      console.error(`[GAA] Error fetching page ${page}:`, error);
    }
  }

  return allItems;
}

/**
 * Get or create GAA organization
 */
async function getOrCreateGaaOrg(supabase: SupabaseClient): Promise<string | null> {
  // Check if exists
  const { data: existing } = await supabase
    .from("organizations")
    .select("id")
    .eq("name", GAA_ORG_NAME)
    .maybeSingle();

  if (existing) {
    return existing.id;
  }

  // Create new org
  const { data: newOrg, error } = await supabase
    .from("organizations")
    .insert({
      name: GAA_ORG_NAME,
      slug: "gaa-classic-cars",
      org_type: "auction_house",
      website_url: "https://gaaclassiccars.com",
      location: "Greensboro, NC",
      metadata: {
        auctions_per_year: 4,
        avg_cars_per_auction: 750,
        climate_controlled: true,
      },
    })
    .select("id")
    .single();

  if (error) {
    console.error("[GAA] Error creating org:", error);
    return null;
  }

  return newOrg?.id || null;
}

/**
 * Upsert vehicle to database
 */
async function upsertVehicle(
  supabase: SupabaseClient,
  extracted: ExtractedVehicle,
  orgId: string | null
): Promise<{ vehicleId: string | null; created: boolean; error: string | null }> {
  // Check if vehicle already exists by listing_url
  const { data: existing } = await supabase
    .from("vehicles")
    .select("id")
    .eq("listing_url", extracted.url)
    .maybeSingle();

  const vehicleData = {
    year: extracted.year,
    make: extracted.make?.toLowerCase(),
    model: extracted.model?.toLowerCase(),
    trim: extracted.sub_model,
    vin: extracted.vin?.toUpperCase(),
    mileage: extracted.mileage,
    color: extracted.exterior_color,
    interior_color: extracted.interior_color,
    body_style: extracted.body_style,
    description: extracted.description,
    listing_url: extracted.url,
    discovery_url: extracted.url,
    discovery_source: "gaa_classic_cars",
    profile_origin: "gaa_import",
    is_public: true,
    selling_organization_id: orgId,
    sale_price: extracted.sale_price,
    sale_status: extracted.sold ? "sold" : extracted.not_sold ? "not_sold" : "available",
    auction_outcome: extracted.sold ? "sold" : extracted.not_sold ? "reserve_not_met" : null,
    origin_metadata: {
      source: "gaa_import",
      gaa_vehicle_id: extracted.gaa_vehicle_id,
      lot_number: extracted.lot_number,
      auction_date: extracted.auction_date,
      run_day: extracted.run_day,
      highest_bid: extracted.highest_bid,
      highlights: extracted.highlights,
      imported_at: new Date().toISOString(),
    },
  };

  if (existing) {
    const { error: updateError } = await supabase
      .from("vehicles")
      .update(vehicleData)
      .eq("id", existing.id);

    if (updateError) {
      return { vehicleId: null, created: false, error: `Update error: ${updateError.message}` };
    }

    return { vehicleId: existing.id, created: false, error: null };
  } else {
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
 * Save vehicle images
 */
async function saveImages(
  supabase: SupabaseClient,
  vehicleId: string,
  imageUrls: string[]
): Promise<number> {
  if (imageUrls.length === 0) return 0;

  const imageRecords = imageUrls.map((url, i) => ({
    vehicle_id: vehicleId,
    image_url: url,
    position: i,
    source: "gaa_import",
    is_external: true,
  }));

  const { error } = await supabase
    .from("vehicle_images")
    .upsert(imageRecords, {
      onConflict: "vehicle_id,image_url",
      ignoreDuplicates: true,
    });

  if (error) {
    console.error("[GAA] Image save error:", error);
    return 0;
  }

  return imageRecords.length;
}

/**
 * Directly upsert vehicles from grid listing data (fast bulk extraction)
 */
async function upsertVehiclesFromGrid(
  supabase: SupabaseClient,
  items: ListingItem[],
  orgId: string | null
): Promise<{ created: number; updated: number; failed: number }> {
  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const item of items) {
    // Check if vehicle already exists by listing_url
    const { data: existing } = await supabase
      .from("vehicles")
      .select("id")
      .eq("listing_url", item.url)
      .maybeSingle();

    const vehicleData = {
      year: item.year,
      make: item.make?.toLowerCase(),
      model: item.model?.toLowerCase(),
      vin: item.vin?.toUpperCase(),
      listing_url: item.url,
      discovery_url: item.url,
      discovery_source: "gaa_classic_cars",
      profile_origin: "gaa_import",
      is_public: true,
      selling_organization_id: orgId,
      sale_price: item.sale_price,
      sale_status: item.sold ? "sold" : item.not_sold ? "not_sold" : "available",
      auction_outcome: item.sold ? "sold" : item.not_sold ? "reserve_not_met" : null,
      origin_metadata: {
        source: "gaa_grid_import",
        gaa_vehicle_id: item.gaa_vehicle_id,
        lot_number: item.lot_number,
        highest_bid: item.highest_bid,
        auction_date: item.auction_date,
        imported_at: new Date().toISOString(),
      },
    };

    if (existing) {
      const { error: updateError } = await supabase
        .from("vehicles")
        .update(vehicleData)
        .eq("id", existing.id);

      if (updateError) {
        console.error(`[GAA] Update error for ${item.url}:`, updateError);
        failed++;
      } else {
        updated++;
      }
    } else {
      const { error: insertError } = await supabase
        .from("vehicles")
        .insert(vehicleData);

      if (insertError) {
        console.error(`[GAA] Insert error for ${item.url}:`, insertError);
        failed++;
      } else {
        created++;
      }
    }
  }

  return { created, updated, failed };
}

/**
 * Crawl a single page of listings and directly insert/update vehicles
 */
async function crawlAndInsertPage(
  supabase: SupabaseClient,
  pageUrl: string,
  orgId: string | null
): Promise<{ found: number; created: number; updated: number; failed: number }> {
  const html = await fetchPage(pageUrl);
  const items = parseListingGrid(html);

  if (items.length === 0) {
    return { found: 0, created: 0, updated: 0, failed: 0 };
  }

  const result = await upsertVehiclesFromGrid(supabase, items, orgId);
  return { found: items.length, ...result };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { url, action, type, batch_size = 0, max_pages = 100 } = body;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get or create GAA org
    const orgId = await getOrCreateGaaOrg(supabase);

    // Mode 1: Extract single URL
    if (url) {
      if (!url.includes("gaaclassiccars.com")) {
        return okJson({ success: false, error: "Invalid GAA Classic Cars URL" }, 400);
      }

      console.log(`[GAA] Extracting: ${url}`);
      const html = await fetchPage(url);
      const extracted = extractVehicleDetails(html, url);

      // Save to database
      const result = await upsertVehicle(supabase, extracted, orgId);

      if (result.error) {
        return okJson({ success: false, error: result.error }, 500);
      }

      // Save images
      let imageCount = 0;
      if (result.vehicleId && extracted.image_urls.length > 0) {
        imageCount = await saveImages(supabase, result.vehicleId, extracted.image_urls);
      }

      return okJson({
        success: true,
        vehicle_id: result.vehicleId,
        created: result.created,
        extracted: {
          ...extracted,
          image_count: extracted.image_urls.length,
        },
        images_saved: imageCount,
      });
    }

    // Mode 2: Crawl inventory/results - directly inserts to vehicles table
    if (action === "crawl") {
      const crawlType = type || "inventory";
      const pageNum = body.page || 1;  // Single page mode for controlled crawling
      const results: Record<string, unknown> = {};

      // Support single page crawl for better control
      if (body.page) {
        const baseUrl = crawlType === "results" ? RESULTS_URL : INVENTORY_URL;
        const pageUrl = pageNum === 1 ? baseUrl : `${baseUrl}&page=${pageNum}`;

        console.log(`[GAA] Crawling ${crawlType} page ${pageNum}...`);
        const pageResult = await crawlAndInsertPage(supabase, pageUrl, orgId);

        return okJson({
          success: true,
          action: "crawl",
          type: crawlType,
          page: pageNum,
          ...pageResult,
        });
      }

      // Full crawl mode - crawls all pages
      if (crawlType === "inventory" || crawlType === "all") {
        console.log("[GAA] Crawling current inventory...");
        const inventoryItems = await crawlListings(INVENTORY_URL, max_pages, 300);
        const inventoryResult = await upsertVehiclesFromGrid(supabase, inventoryItems, orgId);
        results.inventory = {
          found: inventoryItems.length,
          ...inventoryResult,
        };
      }

      if (crawlType === "results" || crawlType === "all") {
        console.log("[GAA] Crawling past results...");
        const resultsItems = await crawlListings(RESULTS_URL, max_pages, 300);
        const resultsResult = await upsertVehiclesFromGrid(supabase, resultsItems, orgId);
        results.results = {
          found: resultsItems.length,
          ...resultsResult,
        };
      }

      return okJson({
        success: true,
        action: "crawl",
        type: crawlType,
        ...results,
      });
    }

    // Mode 3: Enrich existing vehicles with full details (fetch individual pages)
    if (batch_size > 0) {
      // Find GAA vehicles that need enrichment (no images yet)
      const { data: vehicles, error } = await supabase
        .from("vehicles")
        .select("id, listing_url")
        .eq("discovery_source", "gaa_classic_cars")
        .is("color", null)  // Hasn't been enriched yet
        .limit(batch_size);

      if (error || !vehicles || vehicles.length === 0) {
        return okJson({
          success: true,
          action: "enrich",
          message: "No vehicles need enrichment",
          processed: 0,
        });
      }

      let enriched = 0;
      let failed = 0;

      for (const vehicle of vehicles) {
        try {
          const html = await fetchPage(vehicle.listing_url);
          const extracted = extractVehicleDetails(html, vehicle.listing_url);

          // Update with full details
          await supabase
            .from("vehicles")
            .update({
              trim: extracted.sub_model,
              mileage: extracted.mileage,
              color: extracted.exterior_color,
              interior_color: extracted.interior_color,
              body_style: extracted.body_style,
              description: extracted.description,
              origin_metadata: {
                source: "gaa_enriched",
                gaa_vehicle_id: extracted.gaa_vehicle_id,
                lot_number: extracted.lot_number,
                auction_date: extracted.auction_date,
                run_day: extracted.run_day,
                highlights: extracted.highlights,
                enriched_at: new Date().toISOString(),
              },
            })
            .eq("id", vehicle.id);

          // Save images
          if (extracted.image_urls.length > 0) {
            await saveImages(supabase, vehicle.id, extracted.image_urls);
          }

          enriched++;
          await new Promise(resolve => setTimeout(resolve, 300));
        } catch (err) {
          console.error(`[GAA] Enrich error for ${vehicle.listing_url}:`, err);
          failed++;
        }
      }

      return okJson({
        success: true,
        action: "enrich",
        processed: vehicles.length,
        enriched,
        failed,
      });
    }

    // No valid input
    return okJson({
      success: false,
      error: "Provide url, action (crawl), or batch_size",
      usage: {
        single_url: { url: "https://gaaclassiccars.com/vehicles/44408/..." },
        crawl_inventory: { action: "crawl", type: "inventory" },
        crawl_results: { action: "crawl", type: "results" },
        crawl_all: { action: "crawl", type: "all" },
        process_queue: { batch_size: 20 },
      },
    }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[GAA] Error:", error);
    return okJson({ success: false, error: message }, 500);
  }
});
