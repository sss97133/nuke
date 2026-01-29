/**
 * extract-copart-listing
 *
 * Extracts vehicle data from Copart auction listings.
 *
 * Copart is a salvage/insurance auto auction platform.
 * Listings contain: VIN, year, make, model, damage type, sale price, images, lot number, sale date
 *
 * Fetching strategy:
 * - Uses Firecrawl to fetch HTML (Copart has bot protection)
 * - Falls back to parsing provided HTML if passed directly
 *
 * Returns data matching ExtractedVehicle pattern used elsewhere in the system.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { firecrawlScrape } from "../_shared/firecrawl.ts";
import { normalizeListingUrlKey } from "../_shared/listingUrl.ts";
import { ExtractionLogger, validateVin, parsePrice, parseMileage } from "../_shared/extractionHealth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Extracted data structure matching system patterns
 */
interface CopartExtractedData {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  lot_number: string | null;
  // Damage/condition info (Copart-specific)
  damage_type: string | null;
  primary_damage: string | null;
  secondary_damage: string | null;
  odometer: number | null;
  odometer_status: string | null;
  // Sale info
  sale_price: number | null;
  high_bid: number | null;
  buy_it_now_price: number | null;
  sale_date: string | null;
  sale_status: string | null;
  // Vehicle details
  exterior_color: string | null;
  engine: string | null;
  transmission: string | null;
  drive_type: string | null;
  fuel_type: string | null;
  body_style: string | null;
  cylinders: string | null;
  keys_available: boolean | null;
  // Location
  location: string | null;
  yard_name: string | null;
  // Images
  image_urls: string[];
  // Raw data for debugging
  description: string | null;
}

/**
 * VIN patterns for extraction
 */
const VIN_PATTERNS = [
  /\b([1-5][A-HJ-NPR-Z0-9]{16})\b/g,       // US/Canada/Mexico (1-5)
  /\b(J[A-HJ-NPR-Z0-9]{16})\b/g,           // Japan
  /\b(K[A-HJ-NPR-Z0-9]{16})\b/g,           // Korea
  /\b(L[A-HJ-NPR-Z0-9]{16})\b/g,           // China
  /\b(S[A-HJ-NPR-Z0-9]{16})\b/g,           // UK
  /\b(W[A-HJ-NPR-Z0-9]{16})\b/g,           // Germany
  /\b(Y[A-HJ-NPR-Z0-9]{16})\b/g,           // Sweden/Belgium
  /\b(Z[A-HJ-NPR-Z0-9]{16})\b/g,           // Italy
];

/**
 * Extract VIN from HTML content
 */
function extractVin(html: string): string | null {
  // Try explicit VIN patterns in page structure first
  const explicitVinPatterns = [
    /VIN[:\s#]*([A-HJ-NPR-Z0-9]{17})/i,
    /data-vin=["']([A-HJ-NPR-Z0-9]{17})["']/i,
    /"vin"[:\s]*["']([A-HJ-NPR-Z0-9]{17})["']/i,
    /class="lot-details-desc"[^>]*>([A-HJ-NPR-Z0-9]{17})</i,
  ];

  for (const pattern of explicitVinPatterns) {
    const match = html.match(pattern);
    if (match && match[1].length === 17) {
      return match[1].toUpperCase();
    }
  }

  // Fall back to generic VIN patterns
  for (const pattern of VIN_PATTERNS) {
    const matches = html.match(pattern);
    if (matches && matches.length > 0) {
      // Return the most common VIN (in case of noise)
      const counts: Record<string, number> = {};
      for (const m of matches) {
        counts[m] = (counts[m] || 0) + 1;
      }
      return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    }
  }

  return null;
}

/**
 * Parse Copart lot number from URL or HTML
 */
function extractLotNumber(url: string, html: string): string | null {
  // From URL: /lot/12345678
  const urlMatch = url.match(/\/lot\/(\d+)/i);
  if (urlMatch) {
    return urlMatch[1];
  }

  // From HTML
  const htmlPatterns = [
    /Lot\s*#?\s*:?\s*(\d{6,10})/i,
    /"lotNumber"[:\s]*["']?(\d+)["']?/i,
    /data-lot(?:-id)?=["'](\d+)["']/i,
  ];

  for (const pattern of htmlPatterns) {
    const match = html.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Extract year, make, model from title/description
 */
function extractYearMakeModel(html: string, url: string): { year: number | null; make: string | null; model: string | null; title: string | null } {
  // Try og:title meta tag first
  const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
                       html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);

  let title = ogTitleMatch?.[1] || null;

  // Try page title
  if (!title) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    title = titleMatch?.[1] || null;
  }

  // Try h1 or main heading
  if (!title) {
    const h1Match = html.match(/<h1[^>]*>([^<]+)</i);
    title = h1Match?.[1] || null;
  }

  if (!title) {
    return { year: null, make: null, model: null, title: null };
  }

  // Clean title
  title = title
    .replace(/Copart\s*[-|]/gi, '')
    .replace(/\s*[-|]\s*Copart.*$/gi, '')
    .replace(/Salvage\s*(Certificate|Title)?/gi, '')
    .trim();

  // Parse year (4 digit number starting with 19 or 20)
  const yearMatch = title.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? parseInt(yearMatch[0]) : null;

  if (year) {
    // Everything after year is make + model
    const afterYear = title.slice(title.indexOf(yearMatch![0]) + yearMatch![0].length).trim();
    const parts = afterYear.split(/\s+/);
    const make = parts[0] || null;
    const model = parts.slice(1).join(' ') || null;
    return { year, make, model, title: `${year} ${make || ''} ${model || ''}`.trim() };
  }

  return { year: null, make: null, model: null, title };
}

/**
 * Extract damage information (Copart-specific)
 */
function extractDamageInfo(html: string): { primary: string | null; secondary: string | null; damageType: string | null } {
  const damagePatterns = [
    { label: /Primary\s*Damage[:\s]*([^<\n]+)/i, key: 'primary' },
    { label: /Secondary\s*Damage[:\s]*([^<\n]+)/i, key: 'secondary' },
    { label: /Damage[:\s]*([^<\n]+)/i, key: 'general' },
  ];

  const result: { primary: string | null; secondary: string | null; damageType: string | null } = {
    primary: null,
    secondary: null,
    damageType: null,
  };

  for (const { label, key } of damagePatterns) {
    const match = html.match(label);
    if (match) {
      const value = match[1].trim()
        .replace(/<[^>]+>/g, '')
        .replace(/^\s*[-:]\s*/, '')
        .trim();

      if (value && value.length < 100) {
        if (key === 'primary') result.primary = value;
        else if (key === 'secondary') result.secondary = value;
        else if (key === 'general' && !result.primary) result.primary = value;
      }
    }
  }

  // Combine for damageType
  if (result.primary || result.secondary) {
    result.damageType = [result.primary, result.secondary].filter(Boolean).join(' / ');
  }

  return result;
}

/**
 * Extract odometer reading
 */
function extractOdometer(html: string): { value: number | null; status: string | null } {
  const patterns = [
    /Odometer[:\s]*([0-9,]+)\s*(Actual|Exempt|Not\s*Actual|Exceeds|Rollback)?/i,
    /Mileage[:\s]*([0-9,]+)\s*(Actual|Exempt|Not\s*Actual|Exceeds|Rollback)?/i,
    /"odometer"[:\s]*["']?([0-9,]+)["']?/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const value = parseInt(match[1].replace(/,/g, ''), 10);
      if (Number.isFinite(value) && value >= 0) {
        return {
          value,
          status: match[2]?.trim() || null,
        };
      }
    }
  }

  return { value: null, status: null };
}

/**
 * Extract sale price / bid information
 */
function extractPriceInfo(html: string): { salePrice: number | null; highBid: number | null; buyItNow: number | null } {
  const result = { salePrice: null as number | null, highBid: null as number | null, buyItNow: null as number | null };

  // Sold price patterns
  const soldPatterns = [
    /Sold\s*(?:for|@|at)?[:\s]*\$?([0-9,]+)/i,
    /Final\s*(?:Bid|Price)[:\s]*\$?([0-9,]+)/i,
    /Winning\s*Bid[:\s]*\$?([0-9,]+)/i,
  ];

  for (const pattern of soldPatterns) {
    const match = html.match(pattern);
    if (match) {
      const price = parsePrice(match[1]).value;
      if (price && price > 0) {
        result.salePrice = price;
        break;
      }
    }
  }

  // Current/High bid patterns
  const bidPatterns = [
    /Current\s*Bid[:\s]*\$?([0-9,]+)/i,
    /High\s*Bid[:\s]*\$?([0-9,]+)/i,
    /Bid\s*to[:\s]*\$?([0-9,]+)/i,
  ];

  for (const pattern of bidPatterns) {
    const match = html.match(pattern);
    if (match) {
      const bid = parsePrice(match[1]).value;
      if (bid && bid > 0) {
        result.highBid = bid;
        break;
      }
    }
  }

  // Buy It Now price
  const binPatterns = [
    /Buy\s*(?:It\s*)?Now[:\s]*\$?([0-9,]+)/i,
    /BIN[:\s]*\$?([0-9,]+)/i,
  ];

  for (const pattern of binPatterns) {
    const match = html.match(pattern);
    if (match) {
      const bin = parsePrice(match[1]).value;
      if (bin && bin > 0) {
        result.buyItNow = bin;
        break;
      }
    }
  }

  return result;
}

/**
 * Extract sale date
 */
function extractSaleDate(html: string): string | null {
  const patterns = [
    /Sale\s*Date[:\s]*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
    /Auction\s*Date[:\s]*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
    /Sale\s*Date[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /Sale\s*Date[:\s]*(\d{4}-\d{2}-\d{2})/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      try {
        const parsed = new Date(match[1]);
        if (!isNaN(parsed.getTime())) {
          return parsed.toISOString().split('T')[0];
        }
      } catch {
        // Continue to next pattern
      }
    }
  }

  return null;
}

/**
 * Extract vehicle details (color, engine, transmission, etc.)
 */
function extractVehicleDetails(html: string): {
  exteriorColor: string | null;
  engine: string | null;
  transmission: string | null;
  driveType: string | null;
  fuelType: string | null;
  bodyStyle: string | null;
  cylinders: string | null;
  keysAvailable: boolean | null;
} {
  const result = {
    exteriorColor: null as string | null,
    engine: null as string | null,
    transmission: null as string | null,
    driveType: null as string | null,
    fuelType: null as string | null,
    bodyStyle: null as string | null,
    cylinders: null as string | null,
    keysAvailable: null as boolean | null,
  };

  // Color
  const colorMatch = html.match(/(?:Color|Exterior)[:\s]*([A-Za-z]+(?:\s+[A-Za-z]+)?)/i);
  if (colorMatch && colorMatch[1].length < 30) {
    result.exteriorColor = colorMatch[1].trim();
  }

  // Engine
  const enginePatterns = [
    /Engine[:\s]*([0-9.]+\s*L?[^<\n]{0,50})/i,
    /Engine\s*Type[:\s]*([^<\n]+)/i,
  ];
  for (const pattern of enginePatterns) {
    const match = html.match(pattern);
    if (match) {
      result.engine = match[1].trim().slice(0, 100);
      break;
    }
  }

  // Transmission
  const transMatch = html.match(/Transmission[:\s]*(Automatic|Manual|CVT|[^<\n]{0,30})/i);
  if (transMatch) {
    result.transmission = transMatch[1].trim();
  }

  // Drive type
  const driveMatch = html.match(/Drive[:\s]*(Front|Rear|All|4WD|AWD|FWD|RWD|4x4)/i);
  if (driveMatch) {
    result.driveType = driveMatch[1].toUpperCase();
  }

  // Fuel type
  const fuelMatch = html.match(/Fuel[:\s]*(Gasoline|Gas|Diesel|Hybrid|Electric|Flex\s*Fuel)/i);
  if (fuelMatch) {
    result.fuelType = fuelMatch[1].trim();
  }

  // Body style
  const bodyMatch = html.match(/Body\s*(?:Style|Type)?[:\s]*(Sedan|Coupe|SUV|Truck|Van|Wagon|Hatchback|Convertible|[^<\n]{0,30})/i);
  if (bodyMatch) {
    result.bodyStyle = bodyMatch[1].trim();
  }

  // Cylinders
  const cylMatch = html.match(/Cylinders?[:\s]*(\d+)/i) || html.match(/(\d+)\s*Cylinders?/i);
  if (cylMatch) {
    result.cylinders = cylMatch[1];
  }

  // Keys
  const keysMatch = html.match(/Keys?[:\s]*(Yes|No|Present|Missing)/i);
  if (keysMatch) {
    result.keysAvailable = /yes|present/i.test(keysMatch[1]);
  }

  return result;
}

/**
 * Extract location information
 */
function extractLocation(html: string): { location: string | null; yardName: string | null } {
  const result = { location: null as string | null, yardName: null as string | null };

  // Yard/Location name
  const yardPatterns = [
    /Yard[:\s]*([^<\n]+)/i,
    /Location[:\s]*([^<\n]+)/i,
    /Facility[:\s]*([^<\n]+)/i,
  ];

  for (const pattern of yardPatterns) {
    const match = html.match(pattern);
    if (match) {
      const value = match[1].trim().replace(/<[^>]+>/g, '').trim();
      if (value && value.length < 100) {
        if (value.match(/\b(CA|TX|FL|NY|IL|PA|OH|GA|NC|MI|NJ|VA|WA|AZ|MA|TN|IN|MO|MD|WI|CO|MN|SC|AL|LA|KY|OR|OK|CT|IA|MS|AR|KS|UT|NV|NM)\b/i)) {
          result.location = value;
        } else {
          result.yardName = value;
        }
        break;
      }
    }
  }

  return result;
}

/**
 * Extract images from Copart listing
 */
function extractImages(html: string): string[] {
  const images: string[] = [];
  const seen = new Set<string>();

  // Copart image patterns - they use various CDN URLs
  const imagePatterns = [
    /https?:\/\/[^"'\s]+copart[^"'\s]+\.(jpg|jpeg|png|webp)/gi,
    /https?:\/\/cs\.copart\.com\/[^"'\s]+\.(jpg|jpeg|png|webp)/gi,
    /https?:\/\/[^"'\s]*cloudfront[^"'\s]*copart[^"'\s]+\.(jpg|jpeg|png|webp)/gi,
    /"(?:imageUrl|src|image)"[:\s]*"(https?:\/\/[^"]+\.(jpg|jpeg|png|webp))"/gi,
  ];

  for (const pattern of imagePatterns) {
    const matches = html.matchAll(pattern);
    for (const match of matches) {
      const url = match[1] || match[0];
      const cleanUrl = url.replace(/['"]/g, '').split('?')[0];

      // Skip thumbnails and small images
      if (cleanUrl.includes('thumb') || cleanUrl.includes('_tn') || cleanUrl.includes('small')) {
        continue;
      }

      if (!seen.has(cleanUrl)) {
        seen.add(cleanUrl);
        images.push(url.replace(/['"]/g, ''));
      }
    }
  }

  // Also look for JSON image arrays
  const jsonImageMatch = html.match(/"images"\s*:\s*\[([^\]]+)\]/i);
  if (jsonImageMatch) {
    try {
      const imgArray = JSON.parse(`[${jsonImageMatch[1]}]`);
      for (const img of imgArray) {
        const url = typeof img === 'string' ? img : img?.url || img?.src;
        if (url && !seen.has(url.split('?')[0])) {
          seen.add(url.split('?')[0]);
          images.push(url);
        }
      }
    } catch {
      // Ignore JSON parse errors
    }
  }

  return images;
}

/**
 * Determine sale status
 */
function extractSaleStatus(html: string, priceInfo: { salePrice: number | null }): string {
  if (priceInfo.salePrice) {
    return 'sold';
  }

  if (/Auction\s*Ended/i.test(html)) {
    return 'ended';
  }

  if (/Buy\s*It\s*Now/i.test(html) || /BIN\s*Available/i.test(html)) {
    return 'buy_it_now';
  }

  if (/Future\s*Sale/i.test(html) || /Upcoming/i.test(html)) {
    return 'upcoming';
  }

  if (/On\s*Sale/i.test(html) || /Bidding/i.test(html)) {
    return 'active';
  }

  return 'unknown';
}

/**
 * Main extraction function
 */
function extractFromCopartHtml(html: string, url: string): CopartExtractedData {
  const ymmData = extractYearMakeModel(html, url);
  const damageInfo = extractDamageInfo(html);
  const odometerInfo = extractOdometer(html);
  const priceInfo = extractPriceInfo(html);
  const details = extractVehicleDetails(html);
  const locationInfo = extractLocation(html);

  return {
    url,
    title: ymmData.title,
    year: ymmData.year,
    make: ymmData.make,
    model: ymmData.model,
    vin: extractVin(html),
    lot_number: extractLotNumber(url, html),
    damage_type: damageInfo.damageType,
    primary_damage: damageInfo.primary,
    secondary_damage: damageInfo.secondary,
    odometer: odometerInfo.value,
    odometer_status: odometerInfo.status,
    sale_price: priceInfo.salePrice,
    high_bid: priceInfo.highBid,
    buy_it_now_price: priceInfo.buyItNow,
    sale_date: extractSaleDate(html),
    sale_status: extractSaleStatus(html, priceInfo),
    exterior_color: details.exteriorColor,
    engine: details.engine,
    transmission: details.transmission,
    drive_type: details.driveType,
    fuel_type: details.fuelType,
    body_style: details.bodyStyle,
    cylinders: details.cylinders,
    keys_available: details.keysAvailable,
    location: locationInfo.location,
    yard_name: locationInfo.yardName,
    image_urls: extractImages(html),
    description: null, // Could parse from page if needed
  };
}

/**
 * Normalize URL for consistency
 */
function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.search = "";
    if (!u.pathname.endsWith("/")) u.pathname = `${u.pathname}/`;
    return u.toString();
  } catch {
    const base = String(raw || "").split("#")[0].split("?")[0];
    return base.endsWith("/") ? base : `${base}/`;
  }
}

/**
 * Canonical URL (without trailing slash)
 */
function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.search = "";
    if (u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    const base = String(raw || "").split("#")[0].split("?")[0];
    return base.endsWith("/") ? base.slice(0, -1) : base;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim();
    const serviceRoleKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
    const firecrawlApiKey = (Deno.env.get("FIRECRAWL_API_KEY") ?? "").trim();

    if (!supabaseUrl) throw new Error("Missing SUPABASE_URL");
    if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const inputUrl = String(body?.url || body?.listing_url || "").trim();
    const providedHtml = body?.html ? String(body.html) : null;
    const providedVehicleId = body?.vehicle_id ? String(body.vehicle_id) : null;
    const saveToDb = body?.save_to_db === true;

    // Validate URL
    if (!inputUrl || !inputUrl.includes("copart.com")) {
      return new Response(JSON.stringify({ error: "Invalid Copart URL" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const listingUrlNorm = normalizeUrl(inputUrl);
    const listingUrlCanonical = canonicalUrl(inputUrl);

    console.log(`extract-copart-listing: Processing ${listingUrlCanonical}`);

    let html: string;

    // Use provided HTML or fetch via Firecrawl
    if (providedHtml && providedHtml.length > 1000) {
      console.log(`Using provided HTML (${providedHtml.length} chars)`);
      html = providedHtml;
    } else if (firecrawlApiKey) {
      console.log("Fetching via Firecrawl...");

      const firecrawlResult = await firecrawlScrape(
        {
          url: listingUrlNorm,
          formats: ['html', 'markdown'],
          onlyMainContent: false,
          waitFor: 5000, // Copart may have JS-rendered content
          actions: [
            { type: 'scroll', direction: 'down', pixels: 2000 },
            { type: 'wait', milliseconds: 2000 },
          ],
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        },
        {
          apiKey: firecrawlApiKey,
          timeoutMs: 45000,
          maxAttempts: 2,
        }
      );

      if (!firecrawlResult.data?.html || firecrawlResult.data.html.length < 1000) {
        throw new Error(
          firecrawlResult.error ||
          `Firecrawl returned insufficient HTML (${firecrawlResult.data?.html?.length || 0} chars)`
        );
      }

      html = firecrawlResult.data.html;
      console.log(`Firecrawl returned ${html.length} chars`);
    } else {
      return new Response(JSON.stringify({
        error: "No HTML provided and FIRECRAWL_API_KEY not configured. Either provide HTML in request body or configure Firecrawl."
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract data
    const extracted = extractFromCopartHtml(html, listingUrlCanonical);

    console.log(`=== COPART EXTRACTION RESULTS ===`);
    console.log(`Title: ${extracted.title}`);
    console.log(`Year/Make/Model: ${extracted.year} ${extracted.make} ${extracted.model}`);
    console.log(`VIN: ${extracted.vin || 'NOT FOUND'}`);
    console.log(`Lot #: ${extracted.lot_number || 'NOT FOUND'}`);
    console.log(`Damage: ${extracted.damage_type || 'N/A'}`);
    console.log(`Odometer: ${extracted.odometer?.toLocaleString() || 'N/A'} ${extracted.odometer_status || ''}`);
    console.log(`Sale Price: $${extracted.sale_price?.toLocaleString() || 'N/A'}`);
    console.log(`High Bid: $${extracted.high_bid?.toLocaleString() || 'N/A'}`);
    console.log(`Sale Date: ${extracted.sale_date || 'N/A'}`);
    console.log(`Status: ${extracted.sale_status}`);
    console.log(`Images: ${extracted.image_urls.length}`);

    // Check minimum viable extraction
    if (!extracted.year && !extracted.make && !extracted.vin) {
      return new Response(JSON.stringify({
        success: false,
        error: "Could not extract vehicle identity (year/make/vin)",
        listing_url: listingUrlCanonical,
        html_length: html.length,
        partial_extraction: extracted,
      }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Set up extraction health logger
    const healthLogger = new ExtractionLogger(supabase, {
      source: 'copart',
      extractorName: 'extract-copart-listing',
      extractorVersion: '1.0',
      sourceUrl: listingUrlCanonical,
      vehicleId: providedVehicleId || undefined,
    });

    // Log field extractions
    healthLogger.logField('title', extracted.title, extracted.title ? 0.90 : 0);
    healthLogger.logField('year', extracted.year, extracted.year ? 0.95 : 0);
    healthLogger.logField('make', extracted.make, extracted.make ? 0.90 : 0);
    healthLogger.logField('model', extracted.model, extracted.model ? 0.85 : 0);
    healthLogger.logField('lot_number', extracted.lot_number, extracted.lot_number ? 0.98 : 0);
    healthLogger.logField('damage_type', extracted.damage_type, extracted.damage_type ? 0.90 : 0);
    healthLogger.logField('odometer', extracted.odometer, extracted.odometer ? 0.90 : 0);
    healthLogger.logField('sale_price', extracted.sale_price, extracted.sale_price ? 0.95 : 0);
    healthLogger.logField('sale_date', extracted.sale_date, extracted.sale_date ? 0.90 : 0);
    healthLogger.logField('images', extracted.image_urls.length > 0 ? extracted.image_urls.length : null,
                          extracted.image_urls.length > 0 ? 0.90 : 0);

    // VIN with validation
    if (extracted.vin) {
      const vinValidation = validateVin(extracted.vin);
      if (vinValidation.valid) {
        healthLogger.logField('vin', extracted.vin, 0.95);
      } else {
        healthLogger.logValidationFail('vin', extracted.vin, vinValidation.errorCode!, vinValidation.errorDetails);
      }
    } else {
      healthLogger.logField('vin', null, 0);
    }

    let vehicleId = providedVehicleId;

    // Optionally save to database
    if (saveToDb || providedVehicleId) {
      // Copart org ID (you may need to create this in the organizations table)
      const COPART_ORG_ID = null; // Set this if you have a Copart org in the database

      const vehicleData: Record<string, any> = {
        year: extracted.year,
        make: extracted.make,
        model: extracted.model,
        vin: extracted.vin,
        mileage: extracted.odometer,
        color: extracted.exterior_color,
        engine_type: extracted.engine,
        transmission: extracted.transmission,
        drivetrain: extracted.drive_type,
        body_style: extracted.body_style,
        sale_price: extracted.sale_price,
        high_bid: extracted.high_bid,
        location: extracted.location || extracted.yard_name,
        discovery_url: listingUrlCanonical,
        discovery_source: "copart",
        listing_source: "extract-copart-listing",
        status: "active",
        sale_status: extracted.sale_status === 'sold' ? 'sold' : 'available',
        import_metadata: {
          platform: "copart",
          lot_number: extracted.lot_number,
          damage_type: extracted.damage_type,
          primary_damage: extracted.primary_damage,
          secondary_damage: extracted.secondary_damage,
          odometer_status: extracted.odometer_status,
          sale_date: extracted.sale_date,
          buy_it_now_price: extracted.buy_it_now_price,
          keys_available: extracted.keys_available,
          fuel_type: extracted.fuel_type,
          cylinders: extracted.cylinders,
          yard_name: extracted.yard_name,
          extracted_at: new Date().toISOString(),
        },
      };

      // Clean null values
      Object.keys(vehicleData).forEach(key => {
        if (vehicleData[key] === null || vehicleData[key] === undefined) {
          delete vehicleData[key];
        }
      });

      if (providedVehicleId) {
        // Update existing vehicle
        const { error: updateError } = await supabase
          .from("vehicles")
          .update({
            ...vehicleData,
            updated_at: new Date().toISOString(),
          })
          .eq("id", providedVehicleId);

        if (updateError) {
          console.error(`Vehicle update failed: ${updateError.message}`);
        } else {
          console.log(`Updated vehicle: ${providedVehicleId}`);
        }
        vehicleId = providedVehicleId;
      } else {
        // Check for existing by VIN or URL
        if (extracted.vin) {
          const { data: existingByVin } = await supabase
            .from("vehicles")
            .select("id")
            .eq("vin", extracted.vin)
            .limit(1)
            .maybeSingle();

          if (existingByVin?.id) {
            vehicleId = existingByVin.id;
            console.log(`Found existing vehicle by VIN: ${vehicleId}`);
          }
        }

        if (!vehicleId) {
          const urlKey = normalizeListingUrlKey(listingUrlCanonical);
          const { data: existingByUrl } = await supabase
            .from("vehicles")
            .select("id")
            .ilike("discovery_url", `%${urlKey}%`)
            .limit(1)
            .maybeSingle();

          if (existingByUrl?.id) {
            vehicleId = existingByUrl.id;
            console.log(`Found existing vehicle by URL: ${vehicleId}`);
          }
        }

        if (vehicleId) {
          // Update existing
          const { error: updateError } = await supabase
            .from("vehicles")
            .update({
              ...vehicleData,
              updated_at: new Date().toISOString(),
            })
            .eq("id", vehicleId);

          if (updateError) {
            console.error(`Vehicle update failed: ${updateError.message}`);
          }
        } else {
          // Insert new
          const { data: insertedVehicle, error: insertError } = await supabase
            .from("vehicles")
            .insert(vehicleData)
            .select("id")
            .single();

          if (insertError) {
            throw new Error(`Vehicle insert failed: ${insertError.message}`);
          }
          vehicleId = insertedVehicle.id;
          console.log(`Created new vehicle: ${vehicleId}`);
        }
      }

      healthLogger.setVehicleId(vehicleId!);

      // Save images
      if (vehicleId && extracted.image_urls.length > 0) {
        const imageRows = extracted.image_urls.slice(0, 50).map((url, idx) => ({
          vehicle_id: vehicleId,
          image_url: url,
          source: "external_import",
          source_url: url,
          is_external: true,
          approval_status: "auto_approved",
          is_approved: true,
          redaction_level: "none",
          position: idx,
          display_order: idx,
          is_primary: idx === 0,
          exif_data: {
            source_url: listingUrlCanonical,
            discovery_url: listingUrlCanonical,
            imported_from: "copart",
          },
        }));

        // Delete existing copart images first
        await supabase
          .from("vehicle_images")
          .delete()
          .eq("vehicle_id", vehicleId)
          .eq("source", "external_import")
          .ilike("exif_data->>imported_from", "copart");

        const { error: imgError } = await supabase
          .from("vehicle_images")
          .insert(imageRows);

        if (imgError) {
          console.error(`Image insert failed: ${imgError.message}`);
        } else {
          console.log(`Saved ${imageRows.length} images`);
        }
      }

      // Upsert external_listing
      const externalListingData: Record<string, any> = {
        platform: "copart",
        listing_url: listingUrlCanonical,
        listing_url_key: normalizeListingUrlKey(listingUrlCanonical),
        listing_id: extracted.lot_number,
        vehicle_id: vehicleId,
        title: extracted.title,
        listing_status: extracted.sale_status,
        final_price: extracted.sale_price,
        end_date: extracted.sale_date,
        metadata: {
          lot_number: extracted.lot_number,
          damage_type: extracted.damage_type,
          primary_damage: extracted.primary_damage,
          secondary_damage: extracted.secondary_damage,
          odometer: extracted.odometer,
          odometer_status: extracted.odometer_status,
          location: extracted.location,
          yard_name: extracted.yard_name,
        },
      };

      Object.keys(externalListingData).forEach(key => {
        if (externalListingData[key] === null || externalListingData[key] === undefined) {
          delete externalListingData[key];
        }
      });

      const { error: listingError } = await supabase
        .from("external_listings")
        .upsert(externalListingData, { onConflict: "platform,listing_url_key" });

      if (listingError) {
        console.warn(`External listing upsert failed: ${listingError.message}`);
      }
    }

    // Flush health logs
    healthLogger.flush().catch(err => console.error('Health log flush error:', err));

    // Build response matching ExtractedVehicle pattern
    const response = {
      success: true,
      source: "Copart",
      site_type: "copart",
      listing_url: listingUrlCanonical,
      vehicle_id: vehicleId,
      extracted: {
        url: extracted.url,
        title: extracted.title,
        year: extracted.year,
        make: extracted.make,
        model: extracted.model,
        vin: extracted.vin,
        mileage: extracted.odometer,
        exterior_color: extracted.exterior_color,
        interior_color: null, // Copart doesn't typically have interior color
        transmission: extracted.transmission,
        engine: extracted.engine,
        sale_price: extracted.sale_price,
        seller_username: null, // Copart doesn't expose seller usernames
        image_urls: extracted.image_urls,
        description: extracted.description,
        // Copart-specific fields
        lot_number: extracted.lot_number,
        damage_type: extracted.damage_type,
        primary_damage: extracted.primary_damage,
        secondary_damage: extracted.secondary_damage,
        odometer_status: extracted.odometer_status,
        high_bid: extracted.high_bid,
        buy_it_now_price: extracted.buy_it_now_price,
        sale_date: extracted.sale_date,
        sale_status: extracted.sale_status,
        drive_type: extracted.drive_type,
        fuel_type: extracted.fuel_type,
        body_style: extracted.body_style,
        cylinders: extracted.cylinders,
        keys_available: extracted.keys_available,
        location: extracted.location,
        yard_name: extracted.yard_name,
      },
      timestamp: new Date().toISOString(),
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("extract-copart-listing error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || String(error),
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
