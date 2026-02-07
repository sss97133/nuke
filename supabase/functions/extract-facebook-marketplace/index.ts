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
  seller_profile_url: string | null;
  extracted_year: number | null;
  extracted_make: string | null;
  extracted_model: string | null;
  extracted_vin: string | null;
  extracted_mileage: number | null;
  listed_days_ago: number | null;
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

/**
 * Parse year, make, model from FB Marketplace title
 * Handles corrupted titles like "$4,5001972 Chevrolet C10"
 */
function parseTitle(title: string): { year: number | null; make: string | null; model: string | null; cleanPrice: number | null } {
  // Extract price - look for year at END of price string (e.g., "$1,9502021" -> price=$1,950, year=2021)
  let cleanPrice: number | null = null;
  const priceMatch = title.match(/^\$?([\d,]+)/);
  if (priceMatch) {
    const priceStr = priceMatch[1].replace(/,/g, '');
    // Look for 4-digit year at the END of the price string
    const yearAtEnd = priceStr.match(/((?:19[2-9]\d|20[0-3]\d))$/);
    if (yearAtEnd && priceStr.length > 4) {
      // Year is at end - extract price from beginning
      const priceDigits = priceStr.slice(0, -4);
      cleanPrice = priceDigits.length > 0 ? parseInt(priceDigits, 10) : null;
    } else if (priceStr.length <= 7 && !priceStr.match(/^(19|20)\d{2}$/)) {
      // No year embedded, reasonable price length, not just a year
      cleanPrice = parseInt(priceStr, 10);
    }
  }

  // Clean up title - remove price prefixes like "$4,500" but keep year
  const cleaned = title.replace(/^\$[\d,]+(?=\d{4})/g, '').replace(/^\$[\d,]+\s*/g, '').trim();

  // Match year (1920-2030)
  const yearMatch = cleaned.match(/\b(19[2-9]\d|20[0-3]\d)\b/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

  if (!year) return { year: null, make: null, model: null, cleanPrice };

  // Get text after year
  const afterYear = cleaned.split(String(year))[1]?.trim() || '';
  const words = afterYear.split(/\s+/).filter(w => w.length > 0);

  if (words.length === 0) return { year, make: null, model: null, cleanPrice };

  // Make normalization map
  const makeMap: Record<string, string> = {
    'chevy': 'Chevrolet', 'chevrolet': 'Chevrolet',
    'ford': 'Ford', 'dodge': 'Dodge', 'gmc': 'GMC',
    'toyota': 'Toyota', 'honda': 'Honda', 'nissan': 'Nissan',
    'mazda': 'Mazda', 'subaru': 'Subaru', 'mitsubishi': 'Mitsubishi',
    'jeep': 'Jeep', 'ram': 'Ram', 'chrysler': 'Chrysler',
    'plymouth': 'Plymouth', 'pontiac': 'Pontiac', 'buick': 'Buick',
    'oldsmobile': 'Oldsmobile', 'cadillac': 'Cadillac', 'lincoln': 'Lincoln',
    'mercury': 'Mercury', 'amc': 'AMC', 'studebaker': 'Studebaker',
    'packard': 'Packard', 'hudson': 'Hudson', 'nash': 'Nash',
    'international': 'International', 'willys': 'Willys', 'kaiser': 'Kaiser',
    'datsun': 'Datsun', 'volkswagen': 'Volkswagen', 'vw': 'Volkswagen',
    'porsche': 'Porsche', 'mercedes': 'Mercedes-Benz', 'mercedes-benz': 'Mercedes-Benz',
    'bmw': 'BMW', 'audi': 'Audi', 'volvo': 'Volvo', 'saab': 'Saab',
    'jaguar': 'Jaguar', 'triumph': 'Triumph', 'mg': 'MG', 'austin': 'Austin',
    'austin-healey': 'Austin-Healey', 'lotus': 'Lotus', 'tvr': 'TVR',
    'alfa': 'Alfa Romeo', 'alfa romeo': 'Alfa Romeo', 'fiat': 'Fiat',
    'ferrari': 'Ferrari', 'maserati': 'Maserati', 'lamborghini': 'Lamborghini',
    'lancia': 'Lancia', 'delorean': 'DeLorean', 'de tomaso': 'De Tomaso',
    'shelby': 'Shelby', 'ac': 'AC', 'cobra': 'AC Cobra',
  };

  const rawMake = words[0].toLowerCase();
  const make = makeMap[rawMake] || words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();

  // Model: next 1-3 words, excluding common suffixes
  const stopWords = ['pickup', 'truck', 'sedan', 'coupe', 'wagon', 'van', 'suv',
    'convertible', 'hatchback', 'cab', 'door', 'bed', 'ton', 'series',
    'runs', 'drives', 'project', 'restored', 'original', 'clean', 'rare'];
  const modelParts: string[] = [];

  for (let i = 1; i < Math.min(words.length, 5); i++) {
    const word = words[i];
    const lower = word.toLowerCase();
    // Stop at common suffixes or location markers
    if (stopWords.includes(lower)) break;
    // Stop at city/state pattern
    if (/^[A-Z][a-z]+,$/.test(word)) break;
    modelParts.push(word);
    if (modelParts.length >= 2) break;
  }

  const model = modelParts.length > 0 ? modelParts.join(' ') : null;
  return { year, make, model, cleanPrice };
}

// Extract year from title/description (fallback)
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

// Extract price from text - avoid grabbing years
function extractPrice(text: string): number | null {
  // Explicit price patterns with $ or keywords
  // Use comma-formatted regex (\d{1,3}(?:,\d{3})*) to avoid grabbing
  // concatenated year digits (e.g. "$4,5001986" → match "$4,500" only)
  const patterns = [
    /\$\s*(\d{1,3}(?:,\d{3})*)/,               // $15,000 (comma-formatted)
    /\$\s*(\d+)(?!\d)/,                          // $15000 (unformatted, word boundary)
    /asking\s*\$?\s*(\d{1,3}(?:,\d{3})*)/i,     // asking $15,000
    /asking\s*\$?\s*(\d+)(?!\d)/i,               // asking 15000
    /price[:\s]+\$?\s*(\d{1,3}(?:,\d{3})*)/i,   // price: 15,000
    /price[:\s]+\$?\s*(\d+)(?!\d)/i,             // price: 15000
    /obo\s*\$?\s*(\d{1,3}(?:,\d{3})*)/i,        // OBO $5,000
    /obo\s*\$?\s*(\d+)(?!\d)/i,                  // OBO 5000
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const price = parseInt(match[1].replace(/,/g, ""), 10);
      // Sanity check: vehicles typically $100 - $500k for FB marketplace
      if (price >= 100 && price <= 500000) {
        return price;
      }
    }
  }
  return null;
}

// Extract days since listed from FB "Listed X days ago" text
function extractListedDaysAgo(text: string): number | null {
  const patterns = [
    /listed\s+(\d+)\s+days?\s+ago/i,           // Listed 3 days ago
    /listed\s+(\d+)\s+weeks?\s+ago/i,          // Listed 2 weeks ago -> convert
    /listed\s+yesterday/i,                      // Listed yesterday
    /listed\s+today/i,                          // Listed today
    /(\d+)\s+days?\s+ago/i,                    // 3 days ago (fallback)
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      if (pattern.source.includes('yesterday')) return 1;
      if (pattern.source.includes('today')) return 0;
      if (pattern.source.includes('weeks?')) {
        return parseInt(match[1], 10) * 7;
      }
      return parseInt(match[1], 10);
    }
  }
  return null;
}

// Extract seller name from FB page content
function extractSellerName(text: string, html: string): { name: string | null; profileUrl: string | null } {
  // Look for seller patterns in text
  const namePatterns = [
    /(?:sold by|seller|listed by)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    /seller[:\s]+([A-Z][a-z]+\s+[A-Z]\.?)/i,
  ];

  let name: string | null = null;
  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (match) {
      name = match[1].trim();
      break;
    }
  }

  // Extract profile URL from HTML
  let profileUrl: string | null = null;
  const profileMatch = html.match(/href="(\/marketplace\/profile\/\d+[^"]*)"/) ||
                       html.match(/href="(https:\/\/www\.facebook\.com\/marketplace\/profile\/\d+[^"]*)"/);
  if (profileMatch) {
    profileUrl = profileMatch[1].startsWith('/')
      ? `https://www.facebook.com${profileMatch[1]}`
      : profileMatch[1];
  }

  return { name, profileUrl };
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

// Filter vehicle images - exclude profile pics, UI elements, icons
function filterVehicleImages(images: string[]): string[] {
  const dominated: string[] = [];

  for (const url of images) {
    // Must be FB content CDN
    if (!url.includes('scontent') && !url.includes('fbcdn')) continue;

    // Exclude profile pictures (common patterns)
    if (url.includes('/v/') && url.includes('_n.')) continue;  // Profile pic pattern
    if (url.match(/\/p\d+x\d+\//)) continue;                   // Small profile format
    if (url.includes('profile')) continue;                      // Explicit profile

    // Exclude tiny images (icons, emojis, thumbnails)
    if (url.includes('_s.') || url.includes('_t.') || url.includes('_q.')) continue;
    if (url.includes('emoji')) continue;
    if (url.includes('static')) continue;
    if (url.includes('rsrc.php')) continue;                    // FB static resources

    // Exclude messenger/UI elements
    if (url.includes('messenger')) continue;
    if (url.includes('badge')) continue;
    if (url.includes('icon')) continue;

    // Prefer larger images
    const sizeMatch = url.match(/_(\d+)_(\d+)_/);
    if (sizeMatch) {
      const width = parseInt(sizeMatch[1], 10);
      const height = parseInt(sizeMatch[2], 10);
      // Skip tiny images (less than 200px on any side)
      if (width < 200 || height < 200) continue;
    }

    dominated.push(url);
  }

  // Deduplicate
  return [...new Set(dominated)];
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

  // Get raw title for structured parsing
  const rawTitle = metadata["og:title"] || metadata.title || "";

  // Use structured title parser FIRST (handles corrupted FB titles)
  const parsed = parseTitle(rawTitle);

  // Combine text for supplementary extraction (not for Y/M/M/price)
  const allText = [
    metadata.description || "",
    metadata["og:description"] || "",
    markdown,
  ].join(" ");

  // Extract images from multiple sources
  const imageUrls: string[] = [];
  if (metadata["og:image"]) {
    imageUrls.push(metadata["og:image"]);
  }
  // Parse img tags from HTML
  const imgMatches = html.matchAll(/<img[^>]+src="([^"]+scontent[^"]+)"/gi);
  for (const match of imgMatches) {
    imageUrls.push(match[1]);
  }
  // Also check markdown for image URLs
  const mdImgMatches = markdown.matchAll(/!\[[^\]]*\]\(([^)]+scontent[^)]+)\)/g);
  for (const match of mdImgMatches) {
    imageUrls.push(match[1]);
  }

  // Filter to vehicle images only
  const filteredImages = filterVehicleImages(imageUrls);

  const location = extractLocation(allText);
  const seller = extractSellerName(allText + " " + markdown, html);

  // Build full description from multiple sources
  let description = metadata["og:description"] || "";
  // Try to get more from markdown (after "See more" content if present)
  const descMatch = markdown.match(/(?:Description|About this item)[:\s]*([^#]+)/i);
  if (descMatch && descMatch[1].length > description.length) {
    description = descMatch[1].trim();
  }
  // Fallback: use markdown content if longer
  if (markdown.length > description.length && markdown.length < 5000) {
    // Clean up markdown - remove nav elements
    const cleanMd = markdown
      .replace(/\[.*?\]\(.*?\)/g, '')  // Remove links
      .replace(/#{1,6}\s+/g, '')       // Remove headers
      .trim();
    if (cleanMd.length > description.length) {
      description = cleanMd.substring(0, 2000);
    }
  }

  return {
    external_id: extractFacebookItemId(url)!,
    url: normalizeUrl(url),
    title: rawTitle || null,
    // Use parsed price first, fallback to text extraction
    asking_price: parsed.cleanPrice || extractPrice(rawTitle + " " + allText),
    description: description || null,
    location_city: location.city,
    location_state: location.state,
    seller_name: seller.name,
    seller_profile_url: seller.profileUrl,
    // Use structured parser for Y/M/M
    extracted_year: parsed.year || extractYear(allText),
    extracted_make: parsed.make || extractMake(allText),
    extracted_model: parsed.model,
    extracted_vin: extractVin(allText),
    extracted_mileage: extractMileage(allText),
    listed_days_ago: extractListedDaysAgo(allText + " " + markdown),
    image_urls: filteredImages.length > 0 ? filteredImages : imageUrls.slice(0, 10),
    raw_scrape_data: {
      metadata,
      markdown_preview: markdown.substring(0, 2000),
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
