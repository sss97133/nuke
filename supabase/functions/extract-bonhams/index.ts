/**
 * BONHAMS EXTRACTOR v3 — Quality-gated, archive-aware extraction.
 *
 * Handles both cars.bonhams.com and bonhams.com lot pages.
 *
 * Data strategy:
 *   1. archiveFetch the URL (cache-first, archives to listing_page_snapshots)
 *   2. Parse JSON-LD @type:Product (always present in Bonhams SSR HTML)
 *   3. Enrich from HTML/markdown (description sections, images, specs)
 *   4. cleanVehicleFields() — strip HTML, reject polluted values
 *   5. qualityGate() — score and decide upsert/flag/reject
 *   6. Upsert to vehicles + external_listings
 *
 * Modes:
 *   - { url, save_to_db? } — single lot extraction
 *   - { catalog_url, save_to_db? } — catalog page (JSON-LD AggregateOffer)
 *   - { action: "re_enrich", limit? } — batch re-enrich existing vehicles
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { archiveFetch } from "../_shared/archiveFetch.ts";
import { cleanVehicleFields, stripHtmlTags, containsHtml } from "../_shared/pollutionDetector.ts";
import { qualityGate } from "../_shared/extractionQualityGate.ts";
import { normalizeListingUrlKey } from "../_shared/listingUrl.ts";
import { resolveExistingVehicleId, discoveryUrlIlikePattern } from "../_shared/resolveVehicleForListing.ts";

const EXTRACTOR_VERSION = "bonhams-v3";

// ─── Known makes for title parsing ──────────────────────────────────────────

const KNOWN_MAKES = [
  "Alfa Romeo", "Aston Martin", "Austin-Healey", "Mercedes-Benz", "Rolls-Royce",
  "Land Rover", "De Tomaso", "Facel Vega", "Hispano-Suiza", "Brough Superior",
  "Pierce-Arrow", "Harley-Davidson", "Porsche", "Ferrari", "Lamborghini",
  "Bugatti", "McLaren", "Maserati", "Bentley", "Jaguar", "BMW", "Audi",
  "Ford", "Chevrolet", "Dodge", "Plymouth", "Pontiac", "Cadillac", "Lincoln",
  "Chrysler", "Shelby", "AC", "Lancia", "Iso", "Bizzarrini", "Delahaye",
  "Delage", "Duesenberg", "Packard", "Stutz", "Cord", "Auburn", "Tucker",
  "Indian", "Vincent", "Norton", "Triumph", "MG", "Lotus", "TVR", "Jensen",
  "Sunbeam", "Riley", "Alvis", "Lagonda", "Singer", "Standard", "Wolseley",
  "Humber", "Vauxhall", "Rover", "Daimler", "Armstrong Siddeley", "Bristol",
  "Frazer Nash", "HRG", "Lea-Francis", "Morgan", "Talbot", "Invicta",
  "Fiat", "Lola", "March", "Brabham", "Cooper", "BRM", "ERA", "Connaught",
  "Toyota", "Honda", "Nissan", "Mazda", "Subaru", "Mitsubishi", "Datsun",
  "Volkswagen", "Opel", "Peugeot", "Citroen", "Renault", "Volvo", "Saab",
  "Koenigsegg", "Pagani", "Rimac", "Tesla", "Rivian",
];

// ─── VIN & Chassis Patterns ─────────────────────────────────────────────────

const VIN_REGEX = /\b([A-HJ-NPR-Z0-9]{17})\b/g;

const CHASSIS_PATTERNS = [
  /(?:chassis|frame)\s*(?:number|no\.?|#)?\s*:?\s*([A-Z0-9\-\/]{5,20})/i,
  /(?:chassis|frame)\s+([A-Z0-9\-\/]{5,20})/i,
];

// ─── JSON-LD Parsing ────────────────────────────────────────────────────────

interface JsonLdProduct {
  name: string;
  description?: string;
  image?: string;
  offers?: {
    "@type"?: string;
    price?: number;
    priceCurrency?: string;
    availability?: string;
  };
}

function extractJsonLd(html: string): JsonLdProduct | null {
  // Bonhams uses data-next-head attribute on the script tag
  const patterns = [
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        if (parsed["@type"] === "Product" && parsed.name) {
          return parsed as JsonLdProduct;
        }
        // Handle array of JSON-LD objects
        if (Array.isArray(parsed)) {
          const product = parsed.find((p: any) => p["@type"] === "Product");
          if (product) return product as JsonLdProduct;
        }
      } catch {
        // Malformed JSON-LD, try next match
      }
    }
  }

  return null;
}

// ─── Title/Name Parsing ─────────────────────────────────────────────────────

interface ParsedTitle {
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  chassis: string | null;
  cleanTitle: string;
}

function parseBonhamsName(name: string): ParsedTitle {
  let cleanTitle = name.trim();
  let vin: string | null = null;
  let chassis: string | null = null;

  // Extract VIN from "VIN. XXXXX" or "VIN: XXXXX" in name
  const vinInName = cleanTitle.match(/VIN[.:]\s*([A-HJ-NPR-Z0-9]{17})/i);
  if (vinInName) {
    vin = vinInName[1].toUpperCase();
    cleanTitle = cleanTitle.replace(vinInName[0], "").trim();
  }

  // Extract chassis from "Chassis no. XXXXX" or "Chassis no XXXXX"
  const chassisInName = cleanTitle.match(/(?:chassis|frame)\s*no\.?\s*([A-Z0-9\-\/]{3,25})/i);
  if (chassisInName) {
    chassis = chassisInName[1].toUpperCase();
    cleanTitle = cleanTitle.slice(0, cleanTitle.indexOf(chassisInName[0])).trim();
  }

  // Extract engine no. to clean title further
  const engineInName = cleanTitle.match(/engine\s*no\.?\s*[A-Z0-9\-\/]+/i);
  if (engineInName) {
    cleanTitle = cleanTitle.slice(0, cleanTitle.indexOf(engineInName[0])).trim();
  }

  // Extract year (4 digits 1880-2030)
  const yearMatch = cleanTitle.match(/\b(1[89]\d{2}|20[0-3]\d)\b/);
  const year = yearMatch ? parseInt(yearMatch[0], 10) : null;

  // Parse make/model from what follows the year
  let make: string | null = null;
  let model: string | null = null;

  if (year) {
    const afterYear = cleanTitle.slice(cleanTitle.indexOf(String(year)) + 4).trim();

    // Try known multi-word makes first
    for (const knownMake of KNOWN_MAKES) {
      if (afterYear.toLowerCase().startsWith(knownMake.toLowerCase())) {
        make = knownMake;
        model = afterYear.slice(knownMake.length).trim() || null;
        break;
      }
    }

    // If no known make found, take first word
    if (!make && afterYear.length > 0) {
      const parts = afterYear.split(/\s+/);
      make = parts[0] || null;
      model = parts.slice(1).join(" ") || null;
    }
  } else {
    // No year — try to parse make/model from full title
    for (const knownMake of KNOWN_MAKES) {
      if (cleanTitle.toLowerCase().includes(knownMake.toLowerCase())) {
        make = knownMake;
        const idx = cleanTitle.toLowerCase().indexOf(knownMake.toLowerCase());
        model = cleanTitle.slice(idx + knownMake.length).trim() || null;
        break;
      }
    }
  }

  // Clean up model: remove trailing noise like "(see text)" or "See footnote"
  if (model) {
    model = model
      .replace(/\s*\(see\s+text\)/i, "")
      .replace(/\s*see\s+(?:text|footnote)\s*$/i, "")
      .trim();
    if (!model) model = null;
  }

  return { year, make, model, vin, chassis, cleanTitle };
}

// ─── Price Helpers ──────────────────────────────────────────────────────────

function extractCurrency(raw: string | null): string | null {
  if (!raw) return null;
  if (raw.includes("\u00A3") || raw.toLowerCase().includes("gbp")) return "GBP";
  if (raw.includes("$") || raw.toLowerCase().includes("usd")) return "USD";
  if (raw.includes("\u20AC") || raw.toLowerCase().includes("eur")) return "EUR";
  if (raw.includes("CHF")) return "CHF";
  return null;
}

// ─── Spec Extraction from Markdown/HTML ─────────────────────────────────────

function extractSpecsFromContent(text: string): {
  mileage: number | null;
  engine: string | null;
  transmission: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  body_style: string | null;
} {
  let mileage: number | null = null;
  let engine: string | null = null;
  let transmission: string | null = null;
  let exterior_color: string | null = null;
  let interior_color: string | null = null;
  let body_style: string | null = null;

  // Mileage
  const mileagePatterns = [
    /(\d{1,3}(?:,\d{3})*)\s*(?:miles|mi)\b/i,
    /mileage[^:]*:?\s*(\d{1,3}(?:,\d{3})*)/i,
    /odometer[^:]*:?\s*(\d{1,3}(?:,\d{3})*)/i,
    /(\d{1,3}(?:,\d{3})*)\s*km\b/i,
  ];
  for (const p of mileagePatterns) {
    const m = text.match(p);
    if (m) {
      const num = parseInt(m[1].replace(/,/g, ""));
      if (num > 0 && num < 10_000_000) { mileage = num; break; }
    }
  }

  // Engine from description (first line often has "XXXci OHV V8" or "X.XL Turbo")
  const enginePatterns = [
    /(\d+(?:\.\d+)?)\s*(?:cu\.?\s*in\.?|ci)\s+(?:OHV\s+)?(?:V\d+|[Ii]nline[-\s]?\d|[Ff]lat[-\s]?\d|[Ss]traight[-\s]?\d)/i,
    /(\d+(?:\.\d+)?)\s*(?:liter|litre|L)\s+(?:[A-Za-z0-9\-]+\s+)?(?:V\d+|[Ii]nline[-\s]?\d|[Ff]lat[-\s]?\d)/i,
    /(\d+(?:\.\d+)?)\s*(?:cc)\s+(?:[A-Za-z0-9\-]+\s+)?(?:engine)/i,
    /(\d+(?:\.\d+)?)\s*(?:liter|litre|L)\s+([A-Za-z0-9\-\s]+?)\s+engine/i,
  ];
  for (const p of enginePatterns) {
    const m = text.match(p);
    if (m) {
      engine = m[0].trim().slice(0, 80);
      break;
    }
  }

  // Transmission
  const transPatterns = [
    /(\d+)[- ]speed\s+(manual|automatic|PDK|DSG|sequential|gearbox|transaxle)/i,
    /(manual|automatic)\s+(transmission|transaxle|gearbox)/i,
  ];
  for (const p of transPatterns) {
    const m = text.match(p);
    if (m) { transmission = m[0].trim().slice(0, 60); break; }
  }

  // Exterior color — be careful not to match words like "and", "with", "equipped" as part of color
  const stopWords = /\b(and|with|equipped|the|was|has|is|are|were|over|on|in|for|by|at|of|a|an)\b/i;
  const colorPatterns = [
    /refinished in[^.]*?(?:colors? of|iconic colors? of)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/i,
    /finished in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    /(?:painted|repainted|color|colour)[^.]{0,20}?:\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
  ];
  for (const p of colorPatterns) {
    const m = text.match(p);
    if (m && m[1]) {
      // Trim the color at the first stop word
      let color = m[1].trim();
      const stopMatch = color.match(stopWords);
      if (stopMatch && stopMatch.index && stopMatch.index > 0) {
        color = color.slice(0, stopMatch.index).trim();
      }
      if (color.length >= 3 && color.length <= 40 && !stopWords.test(color)) {
        exterior_color = color;
        break;
      }
    }
  }

  // Interior color
  const intPatterns = [
    /interior[^.]*?(?:in|of|with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:leather|vinyl|cloth|hide)/i,
    /upholstered in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    /([A-Z][a-z]+)\s+(?:leather|vinyl|cloth|hide)\s+(?:interior|upholstery|seats)/i,
  ];
  for (const p of intPatterns) {
    const m = text.match(p);
    if (m && m[1]) {
      const color = m[1].trim();
      if (color.length <= 40) { interior_color = color; break; }
    }
  }

  // Body style from title/description
  const lowerText = text.toLowerCase();
  if (lowerText.includes("coup\u00E9") || lowerText.includes("coupe")) body_style = "Coupe";
  else if (lowerText.includes("convertible") || lowerText.includes("cabriolet") || lowerText.includes("roadster") || lowerText.includes("spider") || lowerText.includes("spyder")) body_style = "Convertible";
  else if (lowerText.includes("sedan") || lowerText.includes("saloon")) body_style = "Sedan";
  else if (lowerText.includes("wagon") || lowerText.includes("estate") || lowerText.includes("shooting brake")) body_style = "Wagon";
  else if (lowerText.includes("pickup") || lowerText.includes("truck")) body_style = "Truck";
  else if (lowerText.includes("limousine")) body_style = "Limousine";
  else if (lowerText.includes("targa")) body_style = "Targa";
  else if (lowerText.includes("berlinetta") || lowerText.includes("fastback")) body_style = "Fastback";

  return { mileage, engine, transmission, exterior_color, interior_color, body_style };
}

// ─── Image Extraction ───────────────────────────────────────────────────────

function extractImages(html: string, markdown: string | null): string[] {
  const images: string[] = [];
  const seen = new Set<string>();

  function addImage(url: string) {
    // Clean URL: remove resize params for full resolution
    let clean = url
      .replace(/[?&]width=\d+/gi, "")
      .replace(/[?&]height=\d+/gi, "")
      .replace(/[?&]quality=\d+/gi, "")
      .replace(/\/thumb\//gi, "/original/")
      .replace(/\/small\//gi, "/large/");
    // Remove trailing query string if only params were removed
    clean = clean.replace(/\?$/, "");
    if (!seen.has(clean)) {
      seen.add(clean);
      images.push(clean);
    }
  }

  // From markdown: ![...](https://...bonhams.com/...)
  if (markdown) {
    const mdImages = [...markdown.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)]+bonhams[^)]+)\)/gi)];
    for (const m of mdImages) {
      if (m[1] && /\.(jpg|jpeg|png|webp)/i.test(m[1])) {
        addImage(m[1]);
      }
    }
  }

  // From HTML: img src, data-src, background-image, JSON image refs
  const htmlPatterns = [
    /<img[^>]*src="(https?:\/\/[^"]*(?:bonhams|img2\.bonhams)[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi,
    /data-src="(https?:\/\/[^"]*(?:bonhams|img2\.bonhams)[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi,
    /"(?:image|url|src)":\s*"(https?:\/\/[^"]*(?:bonhams|img2\.bonhams)[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi,
  ];
  for (const p of htmlPatterns) {
    let m;
    while ((m = p.exec(html)) !== null) {
      if (m[1]) addImage(m[1]);
    }
  }

  return images;
}

// ─── Auction Metadata from Markdown/HTML ────────────────────────────────────

interface AuctionMeta {
  lot_number: string | null;
  sale_id: string | null;
  sale_name: string | null;
  sale_date: string | null;
  sale_location: string | null;
  auction_status: "sold" | "unsold" | "withdrawn" | "upcoming" | null;
  estimate_low: number | null;
  estimate_high: number | null;
  estimate_currency: string | null;
  total_price: number | null;
  price_currency: string | null;
}

function extractAuctionMeta(
  html: string,
  markdown: string | null,
  url: string,
  jsonLd: JsonLdProduct | null,
): AuctionMeta {
  const result: AuctionMeta = {
    lot_number: null,
    sale_id: null,
    sale_name: null,
    sale_date: null,
    sale_location: null,
    auction_status: null,
    estimate_low: null,
    estimate_high: null,
    estimate_currency: null,
    total_price: null,
    price_currency: null,
  };

  const text = markdown || stripHtmlTags(html);

  // Lot number from URL: /lot/123/
  const urlLotMatch = url.match(/\/lot\/(\d+)\//);
  if (urlLotMatch) result.lot_number = urlLotMatch[1];

  // Lot number from text: "LOT 123"
  if (!result.lot_number) {
    const lotMatch = text.match(/^LOT\s+(\d+)/m) || text.match(/Lot\s+(\d+)/i);
    if (lotMatch) result.lot_number = lotMatch[1];
  }

  // Sale ID from URL: /auction/12345/
  const urlSaleMatch = url.match(/\/auction\/(\d+)\//);
  if (urlSaleMatch) result.sale_id = urlSaleMatch[1];

  // Price from JSON-LD offers
  if (jsonLd?.offers?.price && jsonLd.offers.price > 0) {
    result.total_price = jsonLd.offers.price;
    result.price_currency = jsonLd.offers.priceCurrency || null;

    // Availability indicates sold status
    const avail = jsonLd.offers.availability || "";
    if (avail.includes("OutOfStock")) {
      result.auction_status = "sold";
    } else if (avail.includes("InStock")) {
      result.auction_status = "upcoming";
    }
  }

  // Sold price from markdown: "Sold for $61,600 inc. premium"
  const soldMatch = text.match(/Sold for\s*([£€$CHF]*)\s*([\d,]+)/i);
  if (soldMatch) {
    result.total_price = parseInt(soldMatch[2].replace(/,/g, ""));
    result.price_currency = extractCurrency(soldMatch[1]) || result.price_currency;
    result.auction_status = "sold";
  }

  // Estimate from markdown: "Estimate:$50,000 - $70,000" or "£450,000 - £550,000"
  const estMatch = text.match(/Estimate[:\s]*([£€$CHF]*)\s*([\d,]+)\s*[-\u2013]\s*([£€$CHF]*)?\s*([\d,]+)/i);
  if (estMatch) {
    result.estimate_currency = extractCurrency(estMatch[1]) || extractCurrency(estMatch[3]) || result.price_currency;
    result.estimate_low = parseInt(estMatch[2].replace(/,/g, ""));
    result.estimate_high = parseInt(estMatch[4].replace(/,/g, ""));
  }

  // Unsold detection
  if (text.match(/unsold|not sold|reserve not met/i)) {
    result.auction_status = "unsold";
  } else if (text.match(/withdrawn/i)) {
    result.auction_status = "withdrawn";
  }

  // Sale date: "17 September 2024" or ISO dates
  const datePatterns = [
    /(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i,
    /(\d{4}-\d{2}-\d{2})/,
  ];
  for (const p of datePatterns) {
    const m = text.match(p);
    if (m) {
      try {
        result.sale_date = new Date(m[1]).toISOString().split("T")[0];
        break;
      } catch { /* ignore bad dates */ }
    }
  }

  // Sale location
  const locMatch = text.match(/(London|New York|Los Angeles|Paris|Monaco|Hong Kong|Geneva|Scottsdale|Monterey|Amelia Island|Goodwood|Greenwich|Quail Lodge|Philadelphia|Bonhams)/i);
  if (locMatch) result.sale_location = locMatch[1];

  return result;
}

// ─── VIN/Chassis from full text ─────────────────────────────────────────────

function extractVinFromText(text: string): { vin: string | null; chassis: string | null } {
  let vin: string | null = null;
  let chassis: string | null = null;

  // Modern 17-char VIN
  const vinMatches = text.match(VIN_REGEX);
  if (vinMatches) {
    vin = vinMatches[0].toUpperCase();
  }

  // Chassis number
  for (const p of CHASSIS_PATTERNS) {
    const m = text.match(p);
    if (m && m[1] && m[1].length >= 5 && m[1].length <= 20) {
      chassis = m[1].toUpperCase();
      break;
    }
  }

  // Also check: "Chassis no. ABC123" in markdown
  const mdChassis = text.match(/Chassis\s+no\.?\s*([A-Z0-9\-\/]+)/i);
  if (mdChassis && !chassis) {
    chassis = mdChassis[1].toUpperCase();
  }

  return { vin, chassis };
}

// ─── Main extraction function ───────────────────────────────────────────────

interface ExtractionResult {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  chassis_number: string | null;
  mileage: number | null;
  engine: string | null;
  transmission: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  body_style: string | null;
  description: string | null;
  sale_price: number | null;
  price_currency: string | null;
  auction_status: string | null;
  lot_number: string | null;
  sale_id: string | null;
  sale_name: string | null;
  sale_date: string | null;
  sale_location: string | null;
  estimate_low: number | null;
  estimate_high: number | null;
  estimate_currency: string | null;
  image_urls: string[];
  fetch_source: string;
  cost_cents: number;
}

async function extractBonhamsLot(url: string): Promise<ExtractionResult> {
  console.log(`[Bonhams] Extracting: ${url}`);

  // Try direct fetch first (free), fall back to Firecrawl if blocked
  let fetchResult = await archiveFetch(url, {
    platform: "bonhams",
    callerName: "extract-bonhams",
    useFirecrawl: false,
    includeMarkdown: true,
    maxAgeSec: 86400 * 7, // 7-day cache for auction pages (content doesn't change)
  });

  let html = fetchResult.html || "";
  let markdown = fetchResult.markdown || null;

  // Check if we got meaningful content.
  // Bonhams uses client-side React rendering — the direct fetch returns a bare
  // React shell (~120KB) with NO lot data visible in the HTML. We need Firecrawl
  // (JS rendering) to extract lot descriptions and specs.
  // Skip Firecrawl only when we already have rich markdown (from a prior Firecrawl run).
  // NOTE: The React shell always has JSON-LD site metadata AND is 120KB+, so we cannot
  // use hasJsonLd or html.length as indicators of meaningful content — both are misleading.
  const hasLotContent = markdown && markdown.length > 5000; // Rich markdown means we already have JS-rendered content
  const needsFirecrawl = !hasLotContent; // Always Firecrawl unless we already have good markdown

  if (needsFirecrawl) {
    console.log(`[Bonhams] No cached/JS-rendered content (html=${html.length}b, md=${markdown?.length || 0}b) — using Firecrawl`);
    fetchResult = await archiveFetch(url, {
      platform: "bonhams",
      callerName: "extract-bonhams",
      useFirecrawl: true,
      includeMarkdown: true,
      waitForJs: 4000,
      skipCache: true, // Force fresh Firecrawl render (not cached direct-fetch HTML)
    });
    html = fetchResult.html || "";
    markdown = fetchResult.markdown || null;
  }

  if (!html || html.length < 500) {
    console.warn(`[Bonhams] Insufficient HTML (${html.length} bytes) for ${url}`);
    return emptyResult(url, fetchResult.source, fetchResult.costCents);
  }

  console.log(`[Bonhams] Fetched ${html.length} bytes (source: ${fetchResult.source}, cached: ${fetchResult.cached})`);

  // 1. Parse JSON-LD (primary data source)
  const jsonLd = extractJsonLd(html);
  if (jsonLd) {
    console.log(`[Bonhams] JSON-LD found: ${jsonLd.name?.slice(0, 80)}`);
  } else {
    console.log(`[Bonhams] No JSON-LD found, falling back to HTML parsing`);
  }

  // 2. Parse title/name into year/make/model/vin/chassis
  const nameStr = jsonLd?.name || "";
  const titleData = parseBonhamsName(nameStr);

  // If JSON-LD didn't have name, try HTML <title> or og:title
  if (!titleData.year && !titleData.make) {
    const ogTitle = html.match(/property="og:title"\s+content="([^"]+)"/i)?.[1] ||
                    html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
    if (ogTitle) {
      const fromTitle = parseBonhamsName(stripHtmlTags(ogTitle));
      if (fromTitle.year) Object.assign(titleData, fromTitle);
    }
  }

  // Fallback: parse title from markdown heading or h1 in markdown
  // Bonhams markdown has "# 1989 Jaguar XJ-S V12 Convertible" or
  // "## **1989 Jaguar XJ-S V12 Convertible**  Registration no. F493..."
  if (!titleData.year && !titleData.make && markdown) {
    const mdHeadings = [
      markdown.match(/^#{1,3}\s+\**([12][0-9]{3}\s+[A-Za-z][^\n*]+)/m)?.[1],
      markdown.match(/Lot\s+\d+\s*\n+\n*([12][0-9]{3}\s+[A-Za-z][^\n*\[]+)/m)?.[1],
    ].filter(Boolean);
    for (const heading of mdHeadings) {
      if (heading) {
        const fromMd = parseBonhamsName(heading.trim().replace(/Registration.*$/i, "").trim());
        if (fromMd.year) { Object.assign(titleData, fromMd); break; }
      }
    }
  }

  // 3. Description — try multiple sources, prefer richest

  let description: string | null = null;

  // A. Markdown Footnotes section (richest source — Bonhams stores lot description here)
  if (markdown) {
    const footnotesMatch = markdown.match(/###?\s*Footnotes?\s*\n+([\s\S]+?)(?=\n#{1,3}\s|\n---|\n\*{3}|$)/i);
    if (footnotesMatch?.[1]) {
      const text = footnotesMatch[1]
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Strip markdown links
        .replace(/_([^_]+)_/g, "$1")              // Strip italic markers
        .replace(/\*\*([^*]+)\*\*/g, "$1")        // Strip bold markers
        .replace(/\n{3,}/g, "\n\n")               // Normalize whitespace
        .trim();
      if (text.length > 100) {
        description = text.slice(0, 10000);
      }
    }
  }

  // B. Inline body text: paragraphs between lot-title H2 and "## Additional information".
  // Covers lots that don't use a Footnotes section (common in older Bonhams auctions).
  // Pattern: "## **{Year} {Make} {Model}**  Chassis no. ...\n\n{description paragraphs}\n\n## Additional information"
  if (!description && markdown) {
    const bodyMatch = markdown.match(
      /##\s+\*?\*?[12][0-9]{3}[^\n]+\n{1,4}([\s\S]+?)(?=##\s+Additional\s+information|###\s+Footnotes|$)/i
    );
    if (bodyMatch?.[1]) {
      const raw = bodyMatch[1]
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")   // strip links, keep text
        .replace(/!\[[^\]]*\]\([^)]+\)/g, "")        // strip images
        .replace(/^(DetailsPhotos|Share|Follow|Previous Lot|Next Lot|VIEW ALL PHOTOS.*)$/gm, "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")           // strip bold
        .replace(/_([^_]+)_/g, "$1")                 // strip italic
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      // Reject if it looks like navigation/boilerplate rather than vehicle description
      const boilerplatePatterns = /^(this sale is now finished|auction information|buyer|payment|shipping)/i;
      if (raw.length > 150 && !boilerplatePatterns.test(raw)) {
        description = raw.slice(0, 10000);
      }
    }
  }

  // C. JSON-LD description (often generic site description, lower priority)
  if (!description && jsonLd?.description) {
    const jsonLdDesc = stripHtmlTags(jsonLd.description).trim();
    // Only use JSON-LD description if it looks like actual lot content (not generic "View X at Bonhams")
    if (jsonLdDesc.length > 150 && !jsonLdDesc.toLowerCase().startsWith("view ")) {
      description = jsonLdDesc.length > 10000 ? jsonLdDesc.slice(0, 10000) : jsonLdDesc;
    }
  }

  // D. Meta description (last resort — usually generic)
  // Skip: meta description on Bonhams is typically "View [title] at [sale]" — not useful

  // 4. Extract specs from description text
  const specSource = description || markdown || stripHtmlTags(html.slice(0, 50000));
  const specs = extractSpecsFromContent(specSource);

  // Also try body_style from title
  if (!specs.body_style && nameStr) {
    const titleSpecs = extractSpecsFromContent(nameStr);
    if (titleSpecs.body_style) specs.body_style = titleSpecs.body_style;
  }

  // 5. Extract VIN/chassis from full text (supplement what's in the title)
  const textVin = extractVinFromText(markdown || stripHtmlTags(html.slice(0, 50000)));
  const vin = titleData.vin || textVin.vin;
  const chassis = titleData.chassis || textVin.chassis;

  // 6. Auction metadata
  const auctionMeta = extractAuctionMeta(html, markdown, url, jsonLd);

  // 7. Images
  const images = extractImages(html, markdown);
  // Add JSON-LD image if not already present
  if (jsonLd?.image && !images.includes(jsonLd.image)) {
    images.unshift(jsonLd.image);
  }

  const result: ExtractionResult = {
    url,
    title: nameStr || null,
    year: titleData.year,
    make: titleData.make,
    model: titleData.model,
    vin,
    chassis_number: chassis,
    mileage: specs.mileage,
    engine: specs.engine,
    transmission: specs.transmission,
    exterior_color: specs.exterior_color,
    interior_color: specs.interior_color,
    body_style: specs.body_style,
    description,
    sale_price: auctionMeta.total_price,
    price_currency: auctionMeta.price_currency,
    auction_status: auctionMeta.auction_status,
    lot_number: auctionMeta.lot_number,
    sale_id: auctionMeta.sale_id,
    sale_name: auctionMeta.sale_name,
    sale_date: auctionMeta.sale_date,
    sale_location: auctionMeta.sale_location,
    estimate_low: auctionMeta.estimate_low,
    estimate_high: auctionMeta.estimate_high,
    estimate_currency: auctionMeta.estimate_currency,
    image_urls: images,
    fetch_source: fetchResult.source,
    cost_cents: fetchResult.costCents,
  };

  console.log(`[Bonhams] Parsed: ${result.year} ${result.make} ${result.model} | VIN: ${vin || "N/A"} | Chassis: ${chassis || "N/A"} | Price: ${result.price_currency}${result.sale_price?.toLocaleString() || "N/A"} | Images: ${images.length}`);

  return result;
}

function emptyResult(url: string, source: string, costCents: number): ExtractionResult {
  return {
    url, title: null, year: null, make: null, model: null, vin: null,
    chassis_number: null, mileage: null, engine: null, transmission: null,
    exterior_color: null, interior_color: null, body_style: null,
    description: null, sale_price: null, price_currency: null,
    auction_status: null, lot_number: null, sale_id: null, sale_name: null,
    sale_date: null, sale_location: null, estimate_low: null, estimate_high: null,
    estimate_currency: null, image_urls: [], fetch_source: source, cost_cents: costCents,
  };
}

// ─── Build vehicle record (maps extraction to vehicles table columns) ───────

function buildVehicleRecord(extracted: ExtractionResult): Record<string, any> {
  return {
    year: extracted.year,
    make: extracted.make?.toLowerCase() || null,
    model: extracted.model?.toLowerCase() || null,
    // Store chassis in VIN field for vintage vehicles if no modern VIN
    vin: extracted.vin
      ? extracted.vin.toUpperCase()
      : (extracted.chassis_number ? extracted.chassis_number.toUpperCase() : null),
    mileage: extracted.mileage,
    color: extracted.exterior_color,
    interior_color: extracted.interior_color,
    transmission: extracted.transmission,
    engine_type: extracted.engine,
    body_style: extracted.body_style,
    description: extracted.description,
    sale_price: extracted.sale_price,
    sale_date: extracted.sale_date,
    sale_status: extracted.auction_status === "sold" ? "sold"
      : extracted.auction_status === "upcoming" ? "available"
      : extracted.auction_status === "unsold" ? "not_sold"
      : extracted.auction_status === "withdrawn" ? "ended"
      : "ended",
    auction_end_date: extracted.sale_date,
    auction_outcome: extracted.auction_status === "sold"
      ? "sold"
      : extracted.auction_status === "unsold" ? "reserve_not_met" : null,
    listing_url: extracted.url,
    discovery_url: extracted.url,
    discovery_source: "bonhams",
    profile_origin: "bonhams_import",
    is_public: true,
    status: "active",
    extractor_version: EXTRACTOR_VERSION,
    origin_metadata: {
      source: "bonhams_import",
      lot_number: extracted.lot_number,
      sale_id: extracted.sale_id,
      sale_name: extracted.sale_name,
      sale_location: extracted.sale_location,
      chassis_number: extracted.chassis_number,
      estimate_low: extracted.estimate_low,
      estimate_high: extracted.estimate_high,
      estimate_currency: extracted.estimate_currency,
      price_currency: extracted.price_currency,
      imported_at: new Date().toISOString(),
    },
  };
}

// ─── Catalog extraction (JSON-LD AggregateOffer) ────────────────────────────

interface CatalogLot {
  name: string;
  url: string;
  price: number | null;
  priceCurrency: string | null;
  lotNumber: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  availability: string | null;
}

async function extractCatalog(catalogUrl: string): Promise<{
  auctionId: string;
  auctionName: string;
  auctionDate: string | null;
  auctionLocation: string | null;
  lots: CatalogLot[];
} | null> {
  const fetchResult = await archiveFetch(catalogUrl, {
    platform: "bonhams",
    callerName: "extract-bonhams-catalog",
    maxAgeSec: 86400 * 30, // 30-day cache for catalogs
  });

  const html = fetchResult.html || "";
  if (!html || html.length < 500) {
    console.warn(`[Bonhams] Catalog: insufficient HTML for ${catalogUrl}`);
    return null;
  }

  // Extract JSON-LD
  const scriptPattern = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let jsonLd: any = null;
  let match;
  while ((match = scriptPattern.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      // Look for Event or AggregateOffer containing lots
      if (parsed.offers || parsed["@type"] === "Event") {
        jsonLd = parsed;
        break;
      }
    } catch { /* skip malformed */ }
  }

  if (!jsonLd) {
    console.warn("[Bonhams] No catalog JSON-LD found");
    return null;
  }

  const auctionIdMatch = catalogUrl.match(/\/auction\/(\d+)\//);
  const auctionId = auctionIdMatch?.[1] || "unknown";
  const auctionName = jsonLd.name || jsonLd.description || "Unknown Auction";

  let auctionDate: string | null = null;
  if (jsonLd.startDate) {
    try { auctionDate = new Date(jsonLd.startDate).toISOString().split("T")[0]; } catch {}
  }
  const auctionLocation = jsonLd.location?.name || jsonLd.location?.address?.addressLocality || null;

  const offers = jsonLd.offers?.offers || jsonLd.offers || [];
  const lots: CatalogLot[] = [];

  for (const offer of (Array.isArray(offers) ? offers : [])) {
    if (offer["@type"] !== "Offer") continue;

    const name = offer.name || "";
    const url = offer.url || "";
    const price = typeof offer.price === "number" ? offer.price : null;
    const priceCurrency = offer.priceCurrency || null;
    const availability = offer.availability || null;

    const lotMatch = url.match(/\/lot\/(\d+)\//);
    const lotNumber = lotMatch?.[1] || null;
    const parsed = parseBonhamsName(name);

    // Skip non-vehicle lots (no year usually means memorabilia/automobilia)
    if (!parsed.year && !name.match(/\d{4}/)) continue;

    lots.push({
      name,
      url,
      price,
      priceCurrency,
      lotNumber,
      year: parsed.year,
      make: parsed.make,
      model: parsed.model,
      vin: parsed.vin,
      availability,
    });
  }

  console.log(`[Bonhams] Catalog: ${lots.length} vehicle lots from ${auctionName}`);
  return { auctionId, auctionName, auctionDate, auctionLocation, lots };
}

// ─── Save to database ───────────────────────────────────────────────────────

async function saveVehicle(
  supabase: ReturnType<typeof createClient>,
  extracted: ExtractionResult,
  vehicleId?: string,
): Promise<{ vehicleId: string | null; action: string; qualityScore: number; issues: string[] }> {
  // Build the vehicle record
  let vehicleData = buildVehicleRecord(extracted);

  // Strip HTML from all text fields
  vehicleData = cleanVehicleFields(vehicleData, { platform: "bonhams" });

  // Quality gate
  const gateResult = qualityGate(vehicleData, {
    source: "bonhams",
    sourceType: "auction",
  });

  console.log(`[Bonhams] Quality gate: score=${gateResult.score}, action=${gateResult.action}, issues=${gateResult.issues.join(", ") || "none"}`);

  if (gateResult.action === "reject") {
    console.warn(`[Bonhams] REJECTED: ${extracted.url} — ${gateResult.issues.join(", ")}`);
    return { vehicleId: null, action: "rejected", qualityScore: gateResult.score, issues: gateResult.issues };
  }

  // Use cleaned data from quality gate
  vehicleData = gateResult.cleaned;

  if (gateResult.action === "flag_for_review") {
    vehicleData.requires_improvement = true;
    vehicleData.quality_issues = gateResult.issues;
  }

  vehicleData.data_quality_score = Math.round(gateResult.score * 100);

  // Resolve existing vehicle
  let targetId = vehicleId || null;

  if (!targetId) {
    try {
      const { vehicleId: resolvedId } = await resolveExistingVehicleId(supabase, {
        url: extracted.url,
        platform: "bonhams",
        discoveryUrlIlikePattern: discoveryUrlIlikePattern(extracted.url),
      });
      if (resolvedId) targetId = resolvedId;
    } catch (e: any) {
      console.warn(`[Bonhams] resolveExistingVehicleId failed (non-fatal): ${e.message}`);
    }
  }

  // Also check by VIN
  if (!targetId && extracted.vin) {
    try {
      const { data: byVin } = await supabase
        .from("vehicles")
        .select("id")
        .eq("vin", extracted.vin.toUpperCase())
        .limit(1)
        .maybeSingle();
      if (byVin?.id) targetId = byVin.id;
    } catch (e: any) {
      console.warn(`[Bonhams] VIN lookup failed (non-fatal): ${e.message}`);
    }
  }

  let action: string;

  if (targetId) {
    // Update existing vehicle
    const { error } = await supabase.from("vehicles").update(vehicleData).eq("id", targetId);
    if (error) throw new Error(`Vehicle update failed: ${error.message}`);
    action = "updated";
    console.log(`[Bonhams] Updated vehicle: ${targetId}`);
  } else {
    // Insert new vehicle
    const { data: newVehicle, error } = await supabase
      .from("vehicles")
      .insert(vehicleData)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`Vehicle insert failed: ${error.message}`);
    targetId = newVehicle?.id || null;
    action = "created";
    console.log(`[Bonhams] Created vehicle: ${targetId}`);
  }

  if (!targetId) {
    return { vehicleId: null, action: "failed", qualityScore: gateResult.score, issues: ["no_vehicle_id"] };
  }

  // Save images (non-fatal)
  try {
    if (extracted.image_urls.length > 0) {
      const imageRecords = extracted.image_urls.slice(0, 50).map((img_url, i) => ({
        vehicle_id: targetId,
        image_url: img_url,
        position: i,
        source: "bonhams_import",
        is_external: true,
      }));

      const { error: imgErr } = await supabase
        .from("vehicle_images")
        .upsert(imageRecords, { onConflict: "vehicle_id,image_url", ignoreDuplicates: true });
      if (imgErr) console.warn(`[Bonhams] Image save error (non-fatal): ${imgErr.message}`);
      else console.log(`[Bonhams] Saved ${imageRecords.length} images`);
    }
  } catch (e: any) {
    console.warn(`[Bonhams] Image save failed (non-fatal): ${e.message}`);
  }

  // Create external_listings record (non-fatal)
  try {
    const listingUrlKey = normalizeListingUrlKey(extracted.url);
    const { error: listErr } = await supabase.from("external_listings").upsert({
      vehicle_id: targetId,
      platform: "bonhams",
      listing_url: extracted.url,
      listing_url_key: listingUrlKey,
      listing_id: extracted.lot_number || extracted.sale_id || listingUrlKey,
      listing_status: extracted.auction_status === "sold" ? "sold" : (extracted.auction_status === "upcoming" ? "active" : "ended"),
      end_date: extracted.sale_date,
      final_price: extracted.sale_price,
      sold_at: extracted.auction_status === "sold" ? extracted.sale_date : null,
      metadata: {
        lot_number: extracted.lot_number,
        sale_id: extracted.sale_id,
        sale_name: extracted.sale_name,
        sale_location: extracted.sale_location,
        estimate_low: extracted.estimate_low,
        estimate_high: extracted.estimate_high,
        estimate_currency: extracted.estimate_currency,
        chassis_number: extracted.chassis_number,
        quality_score: gateResult.score,
      },
    }, { onConflict: "vehicle_id,platform,listing_id" });

    if (listErr) console.warn(`[Bonhams] External listing save error (non-fatal): ${listErr.message}`);
    else console.log("[Bonhams] Created/updated external_listings record");
  } catch (e: any) {
    console.warn(`[Bonhams] External listing creation failed (non-fatal): ${e.message}`);
  }

  return { vehicleId: targetId, action, qualityScore: gateResult.score, issues: gateResult.issues };
}

// ─── HTTP Handler ───────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { url, save_to_db, vehicle_id, catalog_url } = body;
    const action = body.action || "extract";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Re-enrich action ─────────────────────────────────────────────────
    if (action === "re_enrich") {
      const rawLimit = Number(body.limit);
      const limit = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 15, 100);
      const concurrency = Math.min(Number(body.concurrency) || 3, 10);

      let candidates: any[] = [];
      try {
        const { data, error } = await supabase.rpc("get_enrichment_candidates", {
          p_source: "bonhams",
          p_limit: limit,
          p_offset: 0,
          p_min_missing: 2,
        });
        if (error) throw new Error(error.message);
        candidates = data || [];
      } catch (e: any) {
        console.warn(`[Bonhams] RPC get_enrichment_candidates failed: ${e.message}`);
        // Fallback: query directly
        const { data } = await supabase
          .from("vehicles")
          .select("id, discovery_url, vin, color, mileage, description, transmission, body_style, sale_price, enrichment_failures")
          .eq("discovery_source", "bonhams")
          .is("year", null)
          .or("enrichment_failures.is.null,enrichment_failures.lt.3")
          .order("created_at", { ascending: false })
          .limit(limit);
        candidates = data || [];
      }

      if (!candidates.length) {
        return new Response(
          JSON.stringify({ success: true, message: "No Bonhams candidates to enrich", processed: 0 }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const results = { total: candidates.length, success_count: 0, failed: 0, fields_added: 0, errors: [] as string[] };

      async function processOne(cand: any) {
        try {
          await supabase.from("vehicles").update({ last_enrichment_attempt: new Date().toISOString() }).eq("id", cand.id);

          const extracted = await extractBonhamsLot(cand.discovery_url);

          if (!extracted.year && !extracted.make && !extracted.title) {
            await supabase.from("vehicles").update({ enrichment_failures: 3 }).eq("id", cand.id);
            results.failed++;
            if (results.errors.length < 5) results.errors.push(`${cand.discovery_url}: page empty/removed`);
            return;
          }

          const saveResult = await saveVehicle(supabase, extracted, cand.id);
          if (saveResult.action === "rejected") {
            results.failed++;
            if (results.errors.length < 5) results.errors.push(`${cand.discovery_url}: rejected (score=${saveResult.qualityScore})`);
          } else {
            results.success_count++;
          }
        } catch (err: any) {
          const msg = err instanceof Error ? err.message : String(err);
          try {
            await supabase.from("vehicles").update({ enrichment_failures: (cand.enrichment_failures || 0) + 1 }).eq("id", cand.id);
          } catch { /* ignore */ }
          results.failed++;
          if (results.errors.length < 5) results.errors.push(`${cand.discovery_url}: ${msg.slice(0, 100)}`);
        }
      }

      // Process in concurrent chunks
      for (let i = 0; i < candidates.length; i += concurrency) {
        const chunk = candidates.slice(i, i + concurrency);
        await Promise.all(chunk.map(processOne));
      }

      return new Response(
        JSON.stringify({ success: true, ...results }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Catalog extraction ───────────────────────────────────────────────
    if (catalog_url) {
      const catalog = await extractCatalog(catalog_url);
      if (!catalog) {
        return new Response(
          JSON.stringify({ error: "Failed to extract catalog" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const lotResults: any[] = [];
      let created = 0;
      let updated = 0;

      if (save_to_db) {
        for (const lot of catalog.lots) {
          try {
            let vehicleData: Record<string, any> = {
              year: lot.year,
              make: lot.make?.toLowerCase() || null,
              model: lot.model?.toLowerCase() || null,
              vin: lot.vin?.toUpperCase() || null,
              sale_price: lot.price,
              listing_url: lot.url,
              discovery_url: lot.url,
              discovery_source: "bonhams",
              profile_origin: "bonhams_catalog_import",
              is_public: true,
              status: "active",
              sale_status: lot.availability?.includes("OutOfStock") ? "sold" : "available",
              auction_outcome: lot.availability?.includes("OutOfStock") ? "sold" : null,
              auction_end_date: catalog.auctionDate,
              extractor_version: EXTRACTOR_VERSION,
              origin_metadata: {
                source: "bonhams_catalog_import",
                lot_number: lot.lotNumber,
                sale_id: catalog.auctionId,
                sale_name: catalog.auctionName,
                sale_location: catalog.auctionLocation,
                price_currency: lot.priceCurrency,
                imported_at: new Date().toISOString(),
              },
            };

            // Clean and gate
            vehicleData = cleanVehicleFields(vehicleData, { platform: "bonhams" });
            const gate = qualityGate(vehicleData, { source: "bonhams", sourceType: "auction" });
            if (gate.action === "reject") {
              lotResults.push({ lot: lot.lotNumber, url: lot.url, action: "rejected", score: gate.score });
              continue;
            }
            vehicleData = gate.cleaned;
            vehicleData.data_quality_score = Math.round(gate.score * 100);

            // Check existing
            const listingUrlKey = normalizeListingUrlKey(lot.url);
            const { data: existing } = await supabase
              .from("vehicles")
              .select("id")
              .eq("discovery_url", lot.url)
              .maybeSingle();

            if (existing) {
              await supabase.from("vehicles").update(vehicleData).eq("id", existing.id);
              updated++;
              lotResults.push({ lot: lot.lotNumber, url: lot.url, vehicle_id: existing.id, action: "updated" });
            } else {
              const { data: newVehicle, error: insertError } = await supabase
                .from("vehicles")
                .insert(vehicleData)
                .select("id")
                .maybeSingle();

              if (insertError) {
                lotResults.push({ lot: lot.lotNumber, url: lot.url, error: insertError.message });
                continue;
              }

              created++;
              const newId = newVehicle?.id;
              lotResults.push({ lot: lot.lotNumber, url: lot.url, vehicle_id: newId, action: "created" });

              // Create external_listings (non-fatal)
              if (newId) {
                try {
                  await supabase.from("external_listings").upsert({
                    vehicle_id: newId,
                    platform: "bonhams",
                    listing_url: lot.url,
                    listing_url_key: listingUrlKey,
                    listing_id: lot.lotNumber || catalog.auctionId,
                    listing_status: lot.availability?.includes("OutOfStock") ? "sold" : "active",
                    end_date: catalog.auctionDate,
                    final_price: lot.price,
                    sold_at: lot.availability?.includes("OutOfStock") ? catalog.auctionDate : null,
                    metadata: {
                      lot_number: lot.lotNumber,
                      sale_id: catalog.auctionId,
                      sale_name: catalog.auctionName,
                      price_currency: lot.priceCurrency,
                    },
                  }, { onConflict: "vehicle_id,platform,listing_id" });
                } catch (e: any) {
                  console.warn(`[Bonhams] external_listings error (non-fatal): ${e.message}`);
                }
              }
            }
          } catch (e: any) {
            lotResults.push({ lot: lot.lotNumber, url: lot.url, error: e.message });
          }
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          catalog: {
            auction_id: catalog.auctionId,
            auction_name: catalog.auctionName,
            auction_date: catalog.auctionDate,
            auction_location: catalog.auctionLocation,
            total_lots: catalog.lots.length,
          },
          lots: save_to_db ? lotResults : catalog.lots,
          summary: save_to_db ? { created, updated, total: catalog.lots.length } : undefined,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Single URL extraction ────────────────────────────────────────────
    if (url) {
      if (!url.includes("bonhams.com")) {
        return new Response(
          JSON.stringify({ error: "Invalid Bonhams URL" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const extracted = await extractBonhamsLot(url);

      let saveResult: { vehicleId: string | null; action: string; qualityScore: number; issues: string[] } | null = null;

      if (save_to_db || vehicle_id) {
        saveResult = await saveVehicle(supabase, extracted, vehicle_id);
      }

      return new Response(
        JSON.stringify({
          success: true,
          // vehicle_id at top level for CQP compatibility
          vehicle_id: saveResult?.vehicleId || undefined,
          extracted: {
            ...extracted,
            vehicle_id: saveResult?.vehicleId || undefined,
          },
          quality: saveResult
            ? { score: saveResult.qualityScore, action: saveResult.action, issues: saveResult.issues }
            : undefined,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── No valid input ───────────────────────────────────────────────────
    return new Response(
      JSON.stringify({
        error: "Provide url (lot page) or catalog_url (auction page)",
        usage: {
          single_lot: { url: "https://cars.bonhams.com/auction/28012/lot/48/...", save_to_db: true },
          catalog: { catalog_url: "https://cars.bonhams.com/auction/28012/...", save_to_db: true },
          re_enrich: { action: "re_enrich", limit: 15, concurrency: 3 },
        },
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[Bonhams] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
