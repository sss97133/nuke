/**
 * Facebook Marketplace Bot Scraper
 *
 * Uses search engine bot user agents to access Facebook Marketplace
 * without authentication. Facebook serves full listing data to bots for SEO.
 *
 * DISCOVERY: Using Bingbot/Googlebot user agents returns:
 * - marketplace_listing_title
 * - amount_with_offset_in_currency (price in cents)
 * - listing IDs
 * - Location data
 *
 * This is our primary extraction vector!
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Use Bingbot - tested and working
const BOT_USER_AGENT = "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)";

interface ExtractedListing {
  external_id: string;
  title: string;
  price: number | null;
  price_raw: string;
  location_city: string | null;
  image_url: string | null;
  url: string;
  year: number | null;
  make: string | null;
  model: string | null;
}

interface ScrapeResult {
  location: string;
  listings_found: number;
  vintage_count: number;
  new_insertions: number;
  price_updates: number;
  listings: ExtractedListing[];
  error?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, ...params } = await req.json();

    switch (action) {
      case "scrape_location":
        return await scrapeLocation(params.location, params.year_min, params.year_max);
      case "scrape_multiple":
        return await scrapeMultipleLocations(params.locations, params.year_min, params.year_max);
      case "test":
        return await testScraper(params.location || "austin");
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    console.error("Scraper error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
});

/**
 * Scrape a single location
 */
async function scrapeLocation(
  location: string,
  yearMin = 1960,
  yearMax = 1999
): Promise<Response> {
  console.log(`Scraping ${location} for vehicles ${yearMin}-${yearMax}`);

  const url = buildMarketplaceUrl(location, yearMin, yearMax);
  console.log(`URL: ${url}`);

  try {
    const html = await fetchWithBot(url);
    console.log(`Fetched ${(html.length / 1024).toFixed(1)}KB`);

    const listings = extractListings(html);
    console.log(`Extracted ${listings.length} listings`);

    // Filter to requested year range
    const filtered = listings.filter((l) => {
      if (!l.year) return true; // Include if we couldn't parse year
      return l.year >= yearMin && l.year <= yearMax;
    });

    console.log(`After year filter: ${filtered.length} listings`);

    // Upsert to database
    const { newCount, updateCount } = await upsertListings(filtered, location);

    return jsonResponse({
      success: true,
      location,
      year_range: [yearMin, yearMax],
      total_extracted: listings.length,
      filtered_count: filtered.length,
      new_insertions: newCount,
      price_updates: updateCount,
      sample: filtered.slice(0, 5).map((l) => ({
        title: l.title,
        price: l.price,
        year: l.year,
        make: l.make,
      })),
    });
  } catch (error: any) {
    console.error(`Scrape failed for ${location}:`, error);
    return jsonResponse({
      success: false,
      location,
      error: error.message,
    });
  }
}

/**
 * Scrape multiple locations in sequence
 */
async function scrapeMultipleLocations(
  locations: string[],
  yearMin = 1960,
  yearMax = 1999
): Promise<Response> {
  const results: ScrapeResult[] = [];

  for (const location of locations) {
    console.log(`\nProcessing: ${location}`);

    try {
      const url = buildMarketplaceUrl(location, yearMin, yearMax);
      const html = await fetchWithBot(url);
      const listings = extractListings(html);

      const filtered = listings.filter((l) => {
        if (!l.year) return true;
        return l.year >= yearMin && l.year <= yearMax;
      });

      const { newCount, updateCount } = await upsertListings(filtered, location);

      results.push({
        location,
        listings_found: listings.length,
        vintage_count: filtered.length,
        new_insertions: newCount,
        price_updates: updateCount,
        listings: filtered.slice(0, 3), // Sample only
      });

      // Rate limit
      await sleep(3000);
    } catch (error: any) {
      results.push({
        location,
        listings_found: 0,
        vintage_count: 0,
        new_insertions: 0,
        price_updates: 0,
        listings: [],
        error: error.message,
      });
    }
  }

  const totals = results.reduce(
    (acc, r) => ({
      locations: acc.locations + 1,
      listings: acc.listings + r.listings_found,
      vintage: acc.vintage + r.vintage_count,
      new: acc.new + r.new_insertions,
      updates: acc.updates + r.price_updates,
    }),
    { locations: 0, listings: 0, vintage: 0, new: 0, updates: 0 }
  );

  return jsonResponse({
    success: true,
    totals,
    results,
  });
}

/**
 * Test the scraper with a single location
 */
async function testScraper(location: string): Promise<Response> {
  console.log(`Testing scraper on: ${location}`);

  const url = buildMarketplaceUrl(location, 1960, 2025);

  try {
    const html = await fetchWithBot(url);

    // Extract raw patterns to verify data access
    const titleMatches = html.match(/"marketplace_listing_title":"[^"]+"/g) || [];
    const priceMatches = html.match(/"amount_with_offset_in_currency":"[0-9]+"/g) || [];
    const idMatches = html.match(/"id":"[0-9]{10,}"/g) || [];

    const listings = extractListings(html);
    const vintage = listings.filter((l) => l.year && l.year >= 1960 && l.year <= 1999);

    return jsonResponse({
      success: true,
      location,
      html_size_kb: (html.length / 1024).toFixed(1),
      raw_patterns: {
        titles: titleMatches.length,
        prices: priceMatches.length,
        ids: idMatches.length,
      },
      parsed_listings: listings.length,
      vintage_count: vintage.length,
      sample_listings: listings.slice(0, 10).map((l) => ({
        id: l.external_id,
        title: l.title,
        price: l.price,
        year: l.year,
        make: l.make,
        model: l.model,
      })),
      vintage_sample: vintage.slice(0, 5),
    });
  } catch (error: any) {
    return jsonResponse({
      success: false,
      location,
      error: error.message,
    });
  }
}

/**
 * Build marketplace URL with year filters
 */
function buildMarketplaceUrl(location: string, yearMin: number, yearMax: number): string {
  // Facebook marketplace URL format
  const baseUrl = `https://www.facebook.com/marketplace/${location}/vehicles`;

  // Add year filters as query params
  const params = new URLSearchParams({
    minYear: yearMin.toString(),
    maxYear: yearMax.toString(),
    sortBy: "creation_time_descend",
  });

  return `${baseUrl}?${params.toString()}`;
}

/**
 * Fetch page using bot user agent
 */
async function fetchWithBot(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": BOT_USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      Connection: "keep-alive",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.text();
}

/**
 * Extract listings from HTML response
 * Uses context-aware matching: for each title, finds the nearest ID and price
 * in the surrounding HTML to avoid positional misalignment.
 */
function extractListings(html: string): ExtractedListing[] {
  const listings: ExtractedListing[] = [];
  const seenIds = new Set<string>();

  const titleRegex = /"marketplace_listing_title":"([^"]+)"/g;
  let match;

  while ((match = titleRegex.exec(html)) !== null) {
    const rawTitle = match[1];
    const titlePos = match.index;

    // Search for ID and price within a reasonable window around the title
    // FB JSON blocks keep these fields within ~2000 chars of each other
    const windowStart = Math.max(0, titlePos - 2000);
    const windowEnd = Math.min(html.length, titlePos + 2000);
    const contextBlock = html.substring(windowStart, windowEnd);

    // Find the nearest listing ID (10+ digit number) in context
    const idMatch = contextBlock.match(/"id":"(\d{10,})"/);
    const id = idMatch ? idMatch[1] : `unknown-${listings.length}`;

    if (seenIds.has(id)) continue;
    seenIds.add(id);

    // Find the nearest price in context
    const priceMatch = contextBlock.match(/"amount_with_offset_in_currency":"(\d+)"/);
    // Read the offset from FB's JSON (defaults to 100 for USD = cents)
    const offsetMatch = contextBlock.match(/"offset":(\d+)/);
    const offset = offsetMatch ? parseInt(offsetMatch[1], 10) : 100;
    let price = priceMatch ? parseInt(priceMatch[1], 10) / offset : null;

    // Price sanity check: skip clearly invalid prices
    if (price !== null && (price < 1 || price > 1000000)) {
      console.warn(`Suspicious price $${price} for "${rawTitle}" - nullifying`);
      price = null;
    }

    const title = decodeUnicodeEscapes(rawTitle);
    const parsed = parseVehicleTitle(title);

    listings.push({
      external_id: id,
      title,
      price,
      price_raw: price ? `$${price.toLocaleString()}` : "N/A",
      location_city: null,
      image_url: null,
      url: `https://www.facebook.com/marketplace/item/${id}`,
      year: parsed.year,
      make: parsed.make,
      model: parsed.model,
    });
  }

  console.log(`Extracted ${listings.length} listings from HTML`);
  return listings;
}

/**
 * Parse vehicle year/make/model from listing title
 */
function parseVehicleTitle(title: string): { year: number | null; make: string | null; model: string | null } {
  // Common pattern: "YEAR Make Model Details"
  const yearMatch = title.match(/^(\d{4})\s+/);
  if (!yearMatch) {
    return { year: null, make: null, model: null };
  }

  const year = parseInt(yearMatch[1]);
  const rest = title.substring(5).trim();

  // Common vehicle makes
  const makes = [
    "Toyota", "Ford", "Chevrolet", "Chevy", "Honda", "Nissan", "BMW", "Mercedes",
    "Mercedes-Benz", "Audi", "Porsche", "Volkswagen", "VW", "Dodge", "Ram", "Jeep",
    "GMC", "Cadillac", "Lincoln", "Buick", "Pontiac", "Oldsmobile", "Plymouth",
    "Chrysler", "Mazda", "Subaru", "Lexus", "Acura", "Infiniti", "Hyundai", "Kia",
    "Volvo", "Jaguar", "Land Rover", "Range Rover", "Mini", "Fiat", "Alfa Romeo",
    "Ferrari", "Lamborghini", "Maserati", "Bentley", "Rolls-Royce", "Aston Martin",
    "McLaren", "Lotus", "Tesla", "Rivian", "Lucid", "Genesis", "Mitsubishi",
    "Suzuki", "Isuzu", "Datsun", "AMC", "International", "Studebaker", "Hudson",
    "Nash", "Packard", "DeSoto", "Edsel", "Kaiser", "Willys", "Triumph", "MG",
    "Austin-Healey", "Sunbeam", "Jensen", "TVR", "Morgan", "Shelby", "Saab",
    "Peugeot", "Renault", "Citroen", "Opel", "Vauxhall", "Holden", "Daihatsu",
  ];

  const lowerRest = rest.toLowerCase();

  for (const make of makes) {
    if (lowerRest.startsWith(make.toLowerCase())) {
      const afterMake = rest.substring(make.length).trim();
      // Get first 2-3 words as model
      const modelParts = afterMake.split(/\s+/).slice(0, 3);
      const model = modelParts.join(" ").replace(/[·•|].*$/, "").trim();

      return {
        year,
        make: make === "Chevy" ? "Chevrolet" : make,
        model: model || null,
      };
    }
  }

  // Fallback: first word is make, rest is model
  const words = rest.split(/\s+/);
  if (words.length >= 1) {
    return {
      year,
      make: words[0],
      model: words.slice(1, 3).join(" ") || null,
    };
  }

  return { year, make: null, model: null };
}

/**
 * Decode unicode escapes in strings
 */
function decodeUnicodeEscapes(str: string): string {
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

/**
 * Upsert listings to marketplace_listings table
 */
async function upsertListings(
  listings: ExtractedListing[],
  sourceLocation: string
): Promise<{ newCount: number; updateCount: number }> {
  let newCount = 0;
  let updateCount = 0;

  for (const listing of listings) {
    if (!listing.external_id || listing.external_id.startsWith("unknown")) {
      continue;
    }

    // Check if exists
    const { data: existing } = await supabase
      .from("marketplace_listings")
      .select("id, current_price, status")
      .eq("external_id", listing.external_id)
      .eq("platform", "facebook_marketplace")
      .single();

    if (!existing) {
      // Insert new
      const { error } = await supabase.from("marketplace_listings").insert({
        external_id: listing.external_id,
        platform: "facebook_marketplace",
        url: listing.url,
        title: listing.title,
        asking_price: listing.price,
        current_price: listing.price,
        first_price: listing.price,
        extracted_year: listing.year,
        extracted_make: listing.make?.toLowerCase(),
        extracted_model: listing.model?.toLowerCase(),
        thumbnail_url: listing.image_url,
        status: "active",
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        raw_scrape_data: { source_location: sourceLocation, ...listing },
      });

      if (!error) newCount++;
    } else {
      // Update existing
      const updates: any = {
        last_seen_at: new Date().toISOString(),
        status: "active",
      };

      if (listing.price && existing.current_price !== listing.price) {
        updates.current_price = listing.price;
        updateCount++;
      }

      await supabase
        .from("marketplace_listings")
        .update(updates)
        .eq("id", existing.id);
    }
  }

  return { newCount, updateCount };
}

// Helpers
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
