/**
 * Facebook Marketplace Listing Extractor
 *
 * Extracts vehicle listing data from FB Marketplace URLs.
 * Uses Firecrawl because FB blocks direct scraping.
 *
 * Key difference from auction extractors:
 * - No VIN guarantee (private sellers rarely include)
 * - Focus on price tracking and sale outcomes
 * - User verification encouraged but not required
 *
 * POST /functions/v1/extract-facebook-marketplace
 * Body: { url: string, user_id?: string, is_owner?: boolean }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");

interface ExtractedListing {
  external_id: string;
  url: string;
  title: string | null;
  asking_price: number | null;
  description: string | null;
  location_city: string | null;
  location_state: string | null;
  seller_name: string | null;
  extracted_year: number | null;
  extracted_make: string | null;
  extracted_model: string | null;
  extracted_vin: string | null;
  extracted_mileage: number | null;
  image_urls: string[];
  raw_scrape_data: any;
}

// Extract FB item ID from URL
function extractFacebookItemId(url: string): string | null {
  // Patterns:
  // https://www.facebook.com/marketplace/item/123456789/
  // https://facebook.com/marketplace/item/123456789
  // https://m.facebook.com/marketplace/item/123456789
  const match = url.match(/marketplace\/item\/(\d+)/);
  return match ? match[1] : null;
}

// Normalize FB Marketplace URL
function normalizeUrl(url: string): string {
  const itemId = extractFacebookItemId(url);
  if (!itemId) throw new Error("Invalid Facebook Marketplace URL");
  return `https://www.facebook.com/marketplace/item/${itemId}/`;
}

// Extract year from title/description
function extractYear(text: string): number | null {
  // Look for 4-digit year between 1900-2030
  const match = text.match(/\b(19[0-9]{2}|20[0-2][0-9])\b/);
  if (match) {
    const year = parseInt(match[1], 10);
    if (year >= 1900 && year <= new Date().getFullYear() + 1) {
      return year;
    }
  }
  return null;
}

// Common makes for matching
const MAKES = [
  "Acura", "Alfa Romeo", "AMC", "Aston Martin", "Audi", "Bentley", "BMW",
  "Buick", "Cadillac", "Chevrolet", "Chevy", "Chrysler", "Datsun", "DeLorean",
  "Dodge", "Ferrari", "Fiat", "Ford", "Genesis", "GMC", "Honda", "Hummer",
  "Hyundai", "Infiniti", "Jaguar", "Jeep", "Kia", "Lamborghini", "Land Rover",
  "Lexus", "Lincoln", "Lotus", "Maserati", "Mazda", "McLaren", "Mercedes",
  "Mercedes-Benz", "Mercury", "Mini", "Mitsubishi", "Nissan", "Oldsmobile",
  "Plymouth", "Pontiac", "Porsche", "Ram", "Rivian", "Rolls-Royce", "Saab",
  "Saturn", "Scion", "Subaru", "Suzuki", "Tesla", "Toyota", "Triumph",
  "Volkswagen", "VW", "Volvo"
];

// Extract make from title
function extractMake(text: string): string | null {
  const upper = text.toUpperCase();
  for (const make of MAKES) {
    if (upper.includes(make.toUpperCase())) {
      // Normalize some variants
      if (make === "Chevy") return "Chevrolet";
      if (make === "VW") return "Volkswagen";
      if (make === "Mercedes") return "Mercedes-Benz";
      return make;
    }
  }
  return null;
}

// Extract VIN (17 chars, no I/O/Q)
function extractVin(text: string): string | null {
  const match = text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/i);
  if (match) {
    const vin = match[1].toUpperCase();
    // Basic check digit validation could go here
    return vin;
  }
  return null;
}

// Extract mileage
function extractMileage(text: string): number | null {
  // Patterns: "45,000 miles", "45000mi", "45k miles"
  const patterns = [
    /(\d{1,3}(?:,\d{3})*)\s*(?:miles?|mi)\b/i,
    /(\d+)k\s*(?:miles?|mi)?\b/i,
    /mileage[:\s]*(\d{1,3}(?:,\d{3})*)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      let num = match[1].replace(/,/g, "");
      if (match[0].toLowerCase().includes("k")) {
        return parseInt(num, 10) * 1000;
      }
      return parseInt(num, 10);
    }
  }
  return null;
}

// Extract price from text
function extractPrice(text: string): number | null {
  // Patterns: "$15,000", "$15000", "15,000", "asking 15000"
  const match = text.match(/\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
  if (match) {
    const price = parseFloat(match[1].replace(/,/g, ""));
    // Sanity check: vehicles typically $500 - $10M
    if (price >= 500 && price <= 10000000) {
      return price;
    }
  }
  return null;
}

// Extract location (City, State pattern)
function extractLocation(text: string): { city: string | null; state: string | null } {
  const stateAbbrevs = [
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID",
    "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
    "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
    "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
    "WI", "WY"
  ];

  // Pattern: "City, ST" or "City, State"
  for (const state of stateAbbrevs) {
    const pattern = new RegExp(`([A-Za-z\\s]+),\\s*${state}\\b`, "i");
    const match = text.match(pattern);
    if (match) {
      return {
        city: match[1].trim(),
        state: state,
      };
    }
  }

  return { city: null, state: null };
}

// Scrape using Firecrawl
async function scrapeWithFirecrawl(url: string): Promise<any> {
  if (!FIRECRAWL_API_KEY) {
    throw new Error("FIRECRAWL_API_KEY not configured");
  }

  const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify({
      url,
      formats: ["markdown", "html"],
      includeTags: ["meta", "title", "img"],
      waitFor: 3000, // FB is slow
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Firecrawl error: ${response.status} - ${error}`);
  }

  return response.json();
}

// Parse scraped data into structured listing
function parseScrapedData(url: string, scrapeResult: any): ExtractedListing {
  const data = scrapeResult.data || scrapeResult;
  const markdown = data.markdown || "";
  const html = data.html || "";
  const metadata = data.metadata || {};

  // Combine all text sources
  const allText = [
    metadata.title || "",
    metadata.description || "",
    metadata["og:title"] || "",
    metadata["og:description"] || "",
    markdown,
  ].join(" ");

  // Extract og:image or find images in content
  const imageUrls: string[] = [];
  if (metadata["og:image"]) {
    imageUrls.push(metadata["og:image"]);
  }
  // Could parse more images from HTML here

  const location = extractLocation(allText);

  return {
    external_id: extractFacebookItemId(url)!,
    url: normalizeUrl(url),
    title: metadata["og:title"] || metadata.title || null,
    asking_price: extractPrice(allText),
    description: metadata["og:description"] || null,
    location_city: location.city,
    location_state: location.state,
    seller_name: null, // Would need to parse from page structure
    extracted_year: extractYear(allText),
    extracted_make: extractMake(allText),
    extracted_model: null, // Hard to extract reliably without AI
    extracted_vin: extractVin(allText),
    extracted_mileage: extractMileage(allText),
    image_urls: imageUrls,
    raw_scrape_data: {
      metadata,
      markdown_preview: markdown.substring(0, 1000),
      scraped_at: new Date().toISOString(),
    },
  };
}

// Use AI to extract model and clean up data
async function enhanceWithAI(listing: ExtractedListing): Promise<ExtractedListing> {
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey || !listing.title) {
    return listing;
  }

  const prompt = `Extract vehicle details from this Facebook Marketplace listing:

Title: ${listing.title}
Description: ${listing.description || "N/A"}
Already extracted: Year=${listing.extracted_year}, Make=${listing.extracted_make}

Return JSON only:
{
  "year": 2015,
  "make": "Ford",
  "model": "Mustang GT",
  "trim": "Premium",
  "mileage": 45000,
  "confidence": 0.9
}

Use null for unknown fields. Be conservative.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const result = await response.json();
    const text = result.content?.[0]?.text || "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.confidence >= 0.7) {
        listing.extracted_year = parsed.year || listing.extracted_year;
        listing.extracted_make = parsed.make || listing.extracted_make;
        listing.extracted_model = parsed.model || listing.extracted_model;
        listing.extracted_mileage = parsed.mileage || listing.extracted_mileage;
      }
    }
  } catch (e) {
    console.error("AI enhancement failed:", e);
  }

  return listing;
}

// Find or create vehicle record
async function linkToVehicle(listing: ExtractedListing): Promise<string | null> {
  // Try VIN first
  if (listing.extracted_vin) {
    const { data: byVin } = await supabase
      .from("vehicles")
      .select("id")
      .eq("vin", listing.extracted_vin)
      .single();

    if (byVin) return byVin.id;
  }

  // Try year/make/model match (fuzzy)
  if (listing.extracted_year && listing.extracted_make) {
    const { data: byYMM } = await supabase
      .from("vehicles")
      .select("id")
      .eq("year", listing.extracted_year)
      .ilike("make", listing.extracted_make)
      .ilike("model", listing.extracted_model || "%")
      .limit(1)
      .single();

    // Only link if high confidence match
    // For now, don't auto-link without VIN - let user verify
  }

  // Don't auto-create vehicle for marketplace listings
  // User should verify and create if they want
  return null;
}

// Main handler
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, user_id, is_owner } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ error: "URL required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate URL
    const itemId = extractFacebookItemId(url);
    if (!itemId) {
      return new Response(
        JSON.stringify({ error: "Invalid Facebook Marketplace URL" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const normalizedUrl = normalizeUrl(url);

    // Check if already exists
    const { data: existing } = await supabase
      .from("marketplace_listings")
      .select("*")
      .eq("external_id", itemId)
      .single();

    if (existing) {
      // Update last_seen and return existing
      await supabase
        .from("marketplace_listings")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", existing.id);

      return new Response(
        JSON.stringify({
          success: true,
          listing_id: existing.id,
          vehicle_id: existing.vehicle_id,
          is_new: false,
          message: "Listing already tracked",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Scrape with Firecrawl
    console.log(`Scraping FB Marketplace: ${normalizedUrl}`);
    const scrapeResult = await scrapeWithFirecrawl(normalizedUrl);

    // Parse scraped data
    let listing = parseScrapedData(normalizedUrl, scrapeResult);

    // Enhance with AI
    listing = await enhanceWithAI(listing);

    // Try to link to existing vehicle
    const vehicleId = await linkToVehicle(listing);

    // Insert listing
    const { data: inserted, error: insertError } = await supabase
      .from("marketplace_listings")
      .insert({
        external_id: listing.external_id,
        platform: "facebook_marketplace",
        url: listing.url,
        title: listing.title,
        asking_price: listing.asking_price,
        first_price: listing.asking_price,
        current_price: listing.asking_price,
        description: listing.description,
        location_city: listing.location_city,
        location_state: listing.location_state,
        seller_name: listing.seller_name,
        extracted_year: listing.extracted_year,
        extracted_make: listing.extracted_make,
        extracted_model: listing.extracted_model,
        extracted_vin: listing.extracted_vin,
        extracted_mileage: listing.extracted_mileage,
        image_urls: listing.image_urls,
        thumbnail_url: listing.image_urls[0] || null,
        vehicle_id: vehicleId,
        contributed_by: user_id || null,
        ownership_verified: is_owner === true,
        raw_scrape_data: listing.raw_scrape_data,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // Award points to contributor
    if (user_id) {
      await supabase.rpc("award_discovery_points", {
        p_user_id: user_id,
        p_action: "marketplace_import",
        p_points: is_owner ? 15 : 5,
      }).catch(() => {}); // Don't fail if points function doesn't exist
    }

    return new Response(
      JSON.stringify({
        success: true,
        listing_id: inserted.id,
        vehicle_id: vehicleId,
        is_new: true,
        extracted: {
          year: listing.extracted_year,
          make: listing.extracted_make,
          model: listing.extracted_model,
          price: listing.asking_price,
          location: listing.location_city && listing.location_state
            ? `${listing.location_city}, ${listing.location_state}`
            : null,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("FB Marketplace extraction error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
