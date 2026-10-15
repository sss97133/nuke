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
 *   6. Upsert to vehicles + vehicle_events
 *
 * Modes:
 *   - { url, save_to_db? } — single lot extraction
 *   - { catalog_url, save_to_db? } — catalog page (JSON-LD AggregateOffer)
 *   - { action: "re_enrich", limit? } — batch re-enrich existing vehicles
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { archiveFetch } from "../_shared/archiveFetch.ts";
import { firecrawlScrape } from "../_shared/firecrawl.ts";
import { cleanVehicleFields, stripHtmlTags, containsHtml } from "../_shared/pollutionDetector.ts";
import { qualityGate } from "../_shared/extractionQualityGate.ts";
import { normalizeListingUrlKey } from "../_shared/listingUrl.ts";
import { resolveExistingVehicleId, discoveryUrlIlikePattern } from "../_shared/resolveVehicleForListing.ts";
import { writeObservation } from "../_shared/observationWriter.ts";
import { writeVehicleEventByKey } from "../_shared/vehicleEventWrite.ts";
import { fillOnlyIdentity, identityConflict } from "../_shared/identityMatch.ts";
import { recordRevision } from "../_shared/revision.ts";
import { mustWrite, softWrite } from "../_shared/writeResult.ts";
import { type LotPage, parseLotPage } from "./lotPage.ts";
import { requireWriteAuth } from "../_shared/writeGuard.ts";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";

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

  // Strip "Coachwork by ..." (common in Bonhams titles for coachbuilt cars)
  const coachworkInName = cleanTitle.match(/\s+coachwork\s+by\s+.*/i);
  if (coachworkInName) {
    cleanTitle = cleanTitle.slice(0, cleanTitle.indexOf(coachworkInName[0])).trim();
  }

  // Strip "Registration no. ..."
  const regInName = cleanTitle.match(/\s+registration\s+no\.?\s*.*/i);
  if (regInName) {
    cleanTitle = cleanTitle.slice(0, cleanTitle.indexOf(regInName[0])).trim();
  }

  // Strip "Serial no. ..." or "Body no. ..."
  const serialInName = cleanTitle.match(/\s+(?:serial|body)\s+no\.?\s*.*/i);
  if (serialInName) {
    cleanTitle = cleanTitle.slice(0, cleanTitle.indexOf(serialInName[0])).trim();
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
  /** Set by the Typesense lander: the lot's own key (auctionId-lotId) and the retained source document. */
  event_key?: string;
  hammer_price?: number | null;
  hammer_premium?: number | null;
  raw_document?: unknown;
  /** Typesense page this lot came from; the lander's cursor reads it back from vehicle_events.metadata.ts_page. */
  ts_page?: number;
  /** Calendar and depth keys merged into the event metadata (session days, sale key, engine/registration numbers). */
  extra_metadata?: Record<string, unknown>;
}

interface SaveOptions {
  /** Typesense lander: resolve by exact keys only (no leading-% ILIKE scan), await the observation write. */
  fast?: boolean;
  observedAt?: string;
  method?: string;
  onObservationIssue?: (msg: string) => void;
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

  // The direct fetch returns a React shell (~120KB) with JSON-LD metadata but
  // no lot descriptions. Extract JSON-LD now as a baseline (year/make/model/price).
  // We'll try Firecrawl for the rich content (description, specs, images).
  const directJsonLd = html.length > 500 ? extractJsonLd(html) : null;
  if (directJsonLd) {
    console.log(`[Bonhams] JSON-LD from direct fetch: ${directJsonLd.name?.slice(0, 80)}`);
  }

  // Check if we got meaningful content.
  // Bonhams uses client-side React rendering — the direct fetch returns a bare
  // React shell (~120KB) with NO lot data visible in the HTML. We need Firecrawl
  // (JS rendering) to extract lot descriptions and specs.
  // Skip Firecrawl only when we already have rich markdown (from a prior Firecrawl run).
  const hasLotContent = markdown && markdown.length > 5000; // Rich markdown means we already have JS-rendered content
  const needsFirecrawl = !hasLotContent; // Always Firecrawl unless we already have good markdown

  if (needsFirecrawl) {
    console.log(`[Bonhams] No cached/JS-rendered content (html=${html.length}b, md=${markdown?.length || 0}b) — trying Firecrawl`);
    try {
      fetchResult = await archiveFetch(url, {
        platform: "bonhams",
        callerName: "extract-bonhams",
        useFirecrawl: true,
        includeMarkdown: true,
        waitForJs: 4000,
        skipCache: true, // Force fresh Firecrawl render (not cached direct-fetch HTML)
      });
      if (fetchResult.html && fetchResult.html.length > 500) {
        html = fetchResult.html;
        markdown = fetchResult.markdown || null;
      } else if (directJsonLd) {
        // Firecrawl returned nothing useful but we have JSON-LD from direct fetch
        console.log(`[Bonhams] Firecrawl returned insufficient HTML, using JSON-LD from direct fetch`);
      }
    } catch (fcError: any) {
      // Firecrawl failed (likely credits exhausted) — fall back to JSON-LD from direct fetch
      console.warn(`[Bonhams] Firecrawl failed: ${fcError?.message}. Using JSON-LD from direct fetch.`);
    }
  }

  if ((!html || html.length < 500) && !directJsonLd) {
    console.warn(`[Bonhams] Insufficient HTML (${html.length} bytes) and no JSON-LD for ${url}`);
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

/** The same lot under any host or slug: .../auction/{sale}/lot/{lot}/ (the trigram index on discovery_url serves it). */
function lotIlikePattern(url: string): string | null {
  const m = url.match(/\/auction\/(\d+)\/lot\/([^/?#]+)/i);
  return m ? `%bonhams.com/auction/${m[1]}/lot/${m[2]}/%` : null;
}

/**
 * Add a lot's photos to a vehicle. vehicle_images has no unique key on (vehicle_id, image_url), so the old
 * upsert(onConflict: "vehicle_id,image_url") failed every time and its error was only logged: lots landed with no
 * photos. This reads what the vehicle has, inserts the rest, and marks a primary only where the vehicle has none
 * (one primary per vehicle is a unique index).
 */
async function addVehicleImages(
  supabase: ReturnType<typeof createClient>,
  vehicleId: string,
  images: Array<{ url: string; primary?: boolean }>,
  context: { source_url: string; lot_number?: string | null },
): Promise<number> {
  if (images.length === 0) return 0;
  const { data: have, error: readErr } = await supabase
    .from("vehicle_images").select("image_url, is_primary").eq("vehicle_id", vehicleId).limit(500);
  if (readErr) throw new Error(`images read: ${readErr.message}`);
  const urls = new Set((have ?? []).map((r: { image_url: string }) => r.image_url));
  let hasPrimary = (have ?? []).some((r: { is_primary: boolean | null }) => r.is_primary === true);
  const fresh = images.slice(0, 100).filter((img) => !urls.has(img.url));
  if (fresh.length === 0) return 0;
  const rows = fresh.map((img, i) => {
    const primary = !hasPrimary && (img.primary || i === 0);
    if (primary) hasPrimary = true;
    return {
      vehicle_id: vehicleId, image_url: img.url, source_url: img.url, position: urls.size + i, display_order: urls.size + i,
      source: "bonhams_import", is_external: true, is_primary: primary,
      approval_status: "auto_approved", is_approved: true, redaction_level: "none",
      exif_data: { source_url: context.source_url, imported_from: "bonhams", lot_number: context.lot_number ?? null },
    };
  });
  const { error } = await supabase.from("vehicle_images").insert(rows);
  if (error) throw new Error(`images: ${error.message}`);
  return rows.length;
}

/** Write what one lot page holds: gallery, observation (full text + raw data), description lengthened, episode metadata. */
async function landLotPage(
  supabase: ReturnType<typeof createClient>,
  ev: { vehicle_id: string; source_url: string; source_listing_id: string },
  page: LotPage,
  observedAt: string,
): Promise<number> {
  let imagesWritten = 0;
  imagesWritten += await addVehicleImages(supabase, ev.vehicle_id, page.images, { source_url: ev.source_url });
  const fullText = [page.catalog_text, page.footnotes].filter(Boolean).join("\n\n").slice(0, 30000);
  await writeObservation(supabase, {
    vehicleId: ev.vehicle_id,
    source: { platform: "bonhams", url: ev.source_url, trustScore: 0.9, sourceIdentifier: ev.source_listing_id },
    fields: page.hammer_price ? { sale_price: page.hammer_price } : { lot_page: "read" },
    observationKind: page.hammer_price ? "sale_result" : "listing",
    extractionMethod: "lot_page_next_data",
    observedAt,
    contentText: fullText || undefined,
    rawData: page.raw,
  }).then((r) => { if (r.errors.length) throw new Error(`observation: ${r.errors.join("; ").slice(0, 160)}`); });
  // The index landed the description cut at 8,000 characters; the page's text is whole. Never shortened.
  if (fullText) {
    const { data: cur } = await supabase.from("vehicles").select("description").eq("id", ev.vehicle_id).maybeSingle();
    if (cur && fullText.length > (cur.description?.length ?? 0)) {
      const { error: dErr } = await supabase.from("vehicles").update({ description: fullText }).eq("id", ev.vehicle_id);
      if (dErr) throw new Error(`description: ${dErr.message}`);
    }
  }
  const w = await writeVehicleEventByKey(supabase, {
    vehicle_id: ev.vehicle_id, source_platform: "bonhams", source_listing_id: ev.source_listing_id, event_type: "auction",
    source_url: ev.source_url,
    metadata: {
      deep_at: observedAt, deep_status: "ok", image_count: page.images.length,
      auction_name: page.sale_name, sale_venue: page.sale_venue, sale_starts_on: page.sale_starts_on, sale_ends_on: page.sale_ends_on,
      number_of_lots: page.number_of_lots, footnotes: page.footnotes, condition_report_url: page.condition_report_url,
      ...(page.engine_number ? { engine_number: page.engine_number } : {}), ...(page.registration ? { registration: page.registration } : {}),
    },
  });
  if (w.action === "error") throw new Error(`event: ${w.error}`);
  return imagesWritten;
}

// ─── Save to database ───────────────────────────────────────────────────────

async function saveVehicle(
  supabase: ReturnType<typeof createClient>,
  extracted: ExtractionResult,
  vehicleId?: string,
  opts: SaveOptions = {},
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
        discoveryUrlIlikePattern: opts.fast ? lotIlikePattern(extracted.url) : discoveryUrlIlikePattern(extracted.url),
      });
      if (resolvedId) targetId = resolvedId;
    } catch (e: any) {
      console.warn(`[Bonhams] resolveExistingVehicleId failed (non-fatal): ${e.message}`);
    }
  }

  // Also check by VIN
  // Fast path: a chassis number is not unique across makes, so only a full 17-character VIN may join two lots.
  const fullVin = [extracted.vin, extracted.chassis_number].find((v) => v && /^[A-HJ-NPR-Z0-9]{17}$/i.test(v)) ?? null;
  const lookupVin = opts.fast ? fullVin : extracted.vin;
  if (!targetId && lookupVin) {
    try {
      const { data: byVin } = await supabase
        .from("vehicles")
        .select("id")
        .eq("vin", lookupVin.toUpperCase())
        .limit(1)
        .maybeSingle();
      if (byVin?.id) targetId = byVin.id;
    } catch (e: any) {
      console.warn(`[Bonhams] VIN lookup failed (non-fatal): ${e.message}`);
    }
  }

  let action: string;

  // Fast path (Typesense lander): a VIN/chassis that another vehicle already holds is resolved, not thrown.
  // A full 17-character VIN names the same car, so the lot links to that vehicle; a short chassis number is not
  // unique across makes, so the lot keeps its own vehicle without the vin column (the chassis stays in origin_metadata).
  const vinClash = (msg: string): string | null => {
    const m = msg.match(/VIN .* already exists on vehicle ([0-9a-f-]{36})/i);
    return opts.fast && m ? m[1] : null;
  };
  action = "updated";
  // Identity guard: a lot may only update the vehicle it is (same sale and lot), or one whose identity does not contradict
  // it. A different car is refused before anything is written and raised as a revision item; on another lot's vehicle the
  // identity fields are fill-only.
  const lotKey = (u: string | null | undefined) => (u ?? "").match(/\/auction\/(\d+)\/lot\/([^/?#]+)/i)?.slice(1, 3).join("/") ?? null;
  const guardTarget = async (id: string): Promise<{ refused: string | null; update: Record<string, any> }> => {
    const { data: row } = await supabase.from("vehicles").select("year,make,model,vin,discovery_url").eq("id", id).maybeSingle();
    if (!row) return { refused: null, update: vehicleData };
    const same = lotKey(row.discovery_url) !== null && lotKey(row.discovery_url) === lotKey(extracted.url);
    if (same) return { refused: null, update: vehicleData };
    const conflict = identityConflict(row, { year: vehicleData.year, make: vehicleData.make, model: vehicleData.model, vin: vehicleData.vin });
    if (conflict) return { refused: conflict, update: vehicleData };
    return { refused: null, update: fillOnlyIdentity(vehicleData, row) };
  };
  const refuse = async (id: string, why: string) => {
    await recordRevision(supabase, { url: extracted.url, missing: ["identity_match"], reason: "bad_data", next_action: "relink", raised_by: "extract-bonhams", vehicle_id: id, detail: { reason: "different_car", detail: why } });
    return { vehicleId: null, action: "refused", qualityScore: gateResult.score, issues: [`different_car: ${why}`] };
  };
  if (targetId) {
    const g0 = await guardTarget(targetId);
    if (g0.refused) return await refuse(targetId, g0.refused);
    let { error } = await supabase.from("vehicles").update(g0.update).eq("id", targetId);
    const other = error ? vinClash(error.message) : null;
    if (error && other) {
      if (fullVin) {
        const g1 = await guardTarget(other);
        if (g1.refused) return await refuse(other, g1.refused);
        targetId = other; action = "linked_by_vin"; error = null;
      } else { ({ error } = await supabase.from("vehicles").update({ ...g0.update, vin: null }).eq("id", targetId)); }
    }
    if (error) throw new Error(`Vehicle update failed: ${error.message}`);
    console.log(`[Bonhams] ${action} vehicle: ${targetId}`);
  } else {
    let ins = await supabase.from("vehicles").insert(vehicleData).select("id").maybeSingle();
    const other = ins.error ? vinClash(ins.error.message) : null;
    if (ins.error && other) {
      if (fullVin) {
        const g2 = await guardTarget(other);
        if (g2.refused) return await refuse(other, g2.refused);
        ins = { data: { id: other }, error: null } as typeof ins; action = "linked_by_vin";
      }
      else ins = await supabase.from("vehicles").insert({ ...vehicleData, vin: null }).select("id").maybeSingle();
    }
    if (ins.error) throw new Error(`Vehicle insert failed: ${ins.error.message}`);
    targetId = ins.data?.id || null;
    if (action !== "linked_by_vin") action = "created";
    console.log(`[Bonhams] ${action} vehicle: ${targetId}`);
  }

  if (!targetId) {
    return { vehicleId: null, action: "failed", qualityScore: gateResult.score, issues: ["no_vehicle_id"] };
  }

  // Fire-and-forget observation write
  {
    const obsFields: Record<string, any> = {};
    // Fast path: the vehicles row keeps the full description; on the observation it rides as content_text, because
    // idx_vobs_specs_covering includes structured_data and a btree entry over 2.7 KB is refused.
    const obsSkip = new Set([...(opts.fast ? ["description"] : []), "discovery_url", "discovery_source", "source", "listing_source", "profile_origin", "status", "is_public", "origin_metadata", "extractor_version"]);
    for (const [k, v] of Object.entries(vehicleData)) {
      if (v != null && !obsSkip.has(k)) obsFields[k] = v;
    }
    const obsPromise = writeObservation(supabase, {
      vehicleId: targetId,
      source: { platform: "bonhams", url: extracted.url, trustScore: 0.9, sourceIdentifier: extracted.event_key },
      fields: obsFields,
      observationKind: extracted.sale_price ? "sale_result" : "listing",
      extractionMethod: opts.method ?? "json_ld_parse",
      observedAt: opts.observedAt,
      rawData: extracted.raw_document,
      contentText: opts.fast ? (vehicleData.description ?? undefined) : undefined,
    }).catch((e: any) => {
      console.warn(`[BONHAMS] observationWriter error for ${targetId}: ${e?.message}`);
      return null;
    });
    if (opts.fast) {
      const r = await obsPromise;
      if (!r?.observationId || r.errors.length) {
        opts.onObservationIssue?.(`${extracted.event_key}: ${(r?.errors ?? ["no result"]).join("; ").slice(0, 200)}`);
      }
    }
  }

  // Save images (non-fatal)
  try {
    if (extracted.image_urls.length > 0) {
      const n = await addVehicleImages(supabase, targetId, extracted.image_urls.slice(0, 50).map((url) => ({ url })), { source_url: extracted.url, lot_number: extracted.lot_number });
      console.log(`[Bonhams] Saved ${n} images`);
    }
  } catch (e: any) {
    console.warn(`[Bonhams] Image save failed (non-fatal): ${e.message}`);
  }

  // Create vehicle_events record (non-fatal)
  try {
    const listingUrlKey = normalizeListingUrlKey(extracted.url);
    const res = await writeVehicleEventByKey(supabase, {
      vehicle_id: targetId,
      source_platform: "bonhams",
      event_type: "auction",
      source_url: extracted.url,
      source_listing_id: extracted.event_key || listingUrlKey || extracted.lot_number || extracted.sale_id,
      event_status: extracted.auction_status === "sold" ? "sold" : (extracted.auction_status === "upcoming" ? "active" : "ended"),
      ended_at: extracted.sale_date,
      final_price: extracted.sale_price,
      starting_price: extracted.estimate_low,
      sold_at: extracted.auction_status === "sold" ? extracted.sale_date : null,
      extracted_at: opts.observedAt ?? new Date().toISOString(),
      extraction_method: opts.method ?? "json_ld_parse",
      extraction_source: opts.fast ? "bonhams-typesense" : "bonhams-lot-page",
      extractor_version: EXTRACTOR_VERSION,
      metadata: {
        lot_number: extracted.lot_number,
        sale_id: extracted.sale_id,
        sale_name: extracted.sale_name,
        sale_location: extracted.sale_location,
        estimate_low: extracted.estimate_low,
        estimate_high: extracted.estimate_high,
        estimate_currency: extracted.estimate_currency,
        currency: extracted.price_currency,
        hammer_price: extracted.hammer_price ?? null,
        hammer_premium: extracted.hammer_premium ?? null,
        ...(extracted.ts_page ? { ts_page: extracted.ts_page } : {}),
        ...(extracted.extra_metadata ?? {}),
        chassis_number: extracted.chassis_number,
        quality_score: gateResult.score,
      },
    });
    if (res.action === "error") console.warn(`[Bonhams] Vehicle event save error (non-fatal): ${res.error}`);
    else console.log(`[Bonhams] vehicle_events ${res.action}`);
  } catch (e: any) {
    console.warn(`[Bonhams] Vehicle event creation failed (non-fatal): ${e.message}`);
  }

  return { vehicleId: targetId, action, qualityScore: gateResult.score, issues: gateResult.issues };
}

// ─── HTTP Handler ───────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Writes are never anonymous: service key, signed-in user, or nothing (P0.2, 2026-09-27).
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { url, save_to_db, vehicle_id, catalog_url } = body;
    const action = body.action || "extract";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      projectSecretKey()!,
    );

    // ── Land lots mapped from Bonhams' own search index (extract-bonhams-typesense, mode "land") ──
    // No page is fetched here: the caller already holds the structured documents. At most 100 lots, small concurrency,
    // and a time budget under the 150 s edge limit.
    if (action === "land_lots") {
      const lots: ExtractionResult[] = Array.isArray(body.lots) ? body.lots.slice(0, 100) : [];
      const observedAt: string | undefined = body.observed_at;
      const results = {
        received: lots.length, created: 0, updated: 0, rejected: 0, failed: 0, obs_issues: 0,
        retried_ok: 0, failure_reasons: {} as Record<string, number>, failures: [] as Array<{ key: string; reason: string; message: string }>,
        errors: [] as string[],
      };
      const started = Date.now();
      const BUDGET_MS = 100_000;
      // Every lot that does not land gets a reason. A lock timeout is transient, so those are tried once more at the end.
      const reasonOf = (msg: string) =>
        /lock timeout|statement timeout/i.test(msg) ? "lock_timeout"
        : /already exists on vehicle|duplicate key|unique constraint/i.test(msg) ? "duplicate_key"
        : /quality gate|rejected/i.test(msg) ? "quality_gate" : "other";
      const note = (key: string, reason: string, message: string) => {
        results.failure_reasons[reason] = (results.failure_reasons[reason] ?? 0) + 1;
        if (results.failures.length < 20) results.failures.push({ key, reason, message: message.slice(0, 160) });
      };
      const retry: ExtractionResult[] = [];
      const count = (r: { action: string }) => {
        if (r.action === "created") results.created++;
        else if (r.action === "updated" || r.action === "linked_by_vin") results.updated++;
        else return false;
        return true;
      };
      let next = 0;
      async function worker() {
        while (next < lots.length && Date.now() - started < BUDGET_MS) {
          const lot = lots[next++];
          try {
            const r = await saveVehicle(supabase, lot, undefined, {
              fast: true, observedAt, method: "typesense_api",
              onObservationIssue: (m) => { results.obs_issues++; if (results.errors.length < 8) results.errors.push(`obs ${m}`); },
            });
            if (count(r)) continue;
            if (r.action === "rejected") { results.rejected++; note(String(lot.event_key), "quality_gate", r.issues.join(", ")); await recordRevision(supabase, { url: lot.url, missing: ["vehicle_link", "landing"], reason: "quality_gate", next_action: "reparse_retained", raised_by: "extract-bonhams", detail: { issues: r.issues.slice(0, 5) } }); }
            else if (r.action === "refused") { results.rejected++; note(String(lot.event_key), "identity", r.issues.join(", ")); }
            else { results.failed++; note(String(lot.event_key), "other", r.action); }
          } catch (e: any) {
            const msg = String(e?.message ?? e);
            if (reasonOf(msg) === "lock_timeout") retry.push(lot);
            else {
              results.failed++; note(String(lot.event_key), reasonOf(msg), msg);
              const why = reasonOf(msg);
              await recordRevision(supabase, { url: lot.url, missing: ["vehicle_link", "landing"], reason: why === "duplicate_key" ? "duplicate_key" : "other", next_action: why === "duplicate_key" ? "relink" : "retry", raised_by: "extract-bonhams", detail: { message: msg.slice(0, 200) } });
            }
          }
        }
      }
      await Promise.all([worker(), worker()]);
      for (const lot of retry) {
        if (Date.now() - started > BUDGET_MS + 20_000) { results.failed++; note(String(lot.event_key), "lock_timeout", "not retried: out of time"); continue; }
        await new Promise((r) => setTimeout(r, 1500));
        try {
          const r = await saveVehicle(supabase, lot, undefined, { fast: true, observedAt, method: "typesense_api" });
          if (count(r)) results.retried_ok++;
          else { results.failed++; note(String(lot.event_key), "other", r.action); }
        } catch (e: any) {
          results.failed++; note(String(lot.event_key), reasonOf(String(e?.message ?? e)), String(e?.message ?? e));
          await recordRevision(supabase, { url: lot.url, missing: ["vehicle_link", "landing"], reason: "lock_timeout", next_action: "retry", raised_by: "extract-bonhams", detail: { message: String(e?.message ?? e).slice(0, 200) } });
        }
      }
      return new Response(
        JSON.stringify({ success: true, ...results, not_attempted: lots.length - next, elapsed_ms: Date.now() - started }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Revision worker: claim reparse_retained items for Bonhams, run the current lot-page parser on the retained Firecrawl
    // capture and land it; resolve landed_whole. No retained capture: release for refetch.
    if (action === "revise_retained") {
      const n = Math.min(Number(body.limit) || 10, 25);
      const { data: items, error: cErr } = await supabase.rpc("claim_revision_items", { p_source_slug: "bonhams", p_worker: "extract-bonhams", p_limit: n, p_actions: ["reparse_retained"] });
      if (cErr) throw new Error(`claim failed: ${cErr.message}`);
      const out = { claimed: items?.length ?? 0, resolved: 0, released_refetch: 0, errors: [] as string[] };
      for (const it of items ?? []) {
        try {
          const norm = String(it.listing_url).replace(/\/?$/, "/");
          const { data: snaps } = await supabase.from("listing_page_snapshots").select("id, html, html_storage_path")
            .eq("platform", "bonhams").eq("success", true).in("listing_url", [norm, String(it.listing_url)]).order("fetched_at", { ascending: false }).limit(1);
          const snap = snaps?.[0];
          let html: string | null = snap?.html ?? null;
          if (!html && snap?.html_storage_path) {
            const { data: blob } = await supabase.storage.from("listing-snapshots").download(snap.html_storage_path);
            html = blob ? await blob.text() : null;
          }
          const page = html ? parseLotPage(html) : null;
          const { data: evs } = it.vehicle_id
            ? await supabase.from("vehicle_events").select("vehicle_id, source_url, source_listing_id").eq("source_platform", "bonhams").eq("vehicle_id", it.vehicle_id).limit(1)
            : { data: null };
          if (!page || !evs?.length) {
            await supabase.rpc("release_revision_item", { p_id: it.id, p_next_action: "refetch", p_detail: { why: !page ? "no parsable retained capture" : "no episode to land on" } });
            out.released_refetch++;
            continue;
          }
          await landLotPage(supabase, evs[0], page, new Date().toISOString());
          await supabase.rpc("resolve_revision_item", { p_id: it.id, p_outcome: "landed_whole", p_detail: { by: "extract-bonhams revise_retained", snapshot_id: snap?.id } });
          out.resolved++;
        } catch (e: any) {
          await supabase.rpc("release_revision_item", { p_id: it.id, p_next_action: "refetch", p_detail: { message: String(e?.message ?? e).slice(0, 200) } });
          out.released_refetch++;
          if (out.errors.length < 5) out.errors.push(`${it.listing_url}: ${String(e?.message ?? e).slice(0, 120)}`);
        }
      }
      return new Response(JSON.stringify({ success: true, action, ...out }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Deep pass: the lot page for lots the search index landed (gallery, sale, footnotes, condition report) ──
    // One page request per `spacing_ms` (at least 2000), at most 20 lots, newest sales first. 403/429 or a page that is
    // not a lot page (a challenge) ends the run at once and marks nothing. Each lot's raw page data is kept on the
    // observation; the episode's metadata is merged, never replaced.
    if (action === "deep_lots") {
      const limit = Math.min(Number(body.limit) || 20, 20);
      const spacing = Math.max(Number(body.spacing_ms) || 2000, 2000);
      const started = Date.now();
      const BUDGET_MS = 110_000;
      const { data: todo, error: todoErr } = await supabase
        .from("vehicle_events")
        .select("id, vehicle_id, source_url, source_listing_id")
        .eq("source_platform", "bonhams")
        .eq("extraction_source", "bonhams-typesense")
        .is("metadata->>deep_at", null)
        .order("ended_at", { ascending: false, nullsFirst: false })
        .limit(limit);
      if (todoErr) throw new Error(`deep_lots queue read failed: ${todoErr.message}`);
      const out = { picked: todo?.length ?? 0, done: 0, gone: 0, images: 0, credits_used: 0, backoff: null as string | null, failed: 0, errors: [] as string[] };
      // Credit floor: Cars & Bids keeps 5,000 and the eBay private backfill needs the rest. Stop when what is left would cut into it.
      const floor = Number(body.credit_floor) || 6700; // C&B 5,000 + eBay tier-1 private 588 + 68 a day (lead, 2026-10-15); raise only with a larger plan
      let credits = 0;
      {
        const usage = await fetch("https://api.firecrawl.dev/v1/team/credit-usage", { headers: { Authorization: `Bearer ${Deno.env.get("FIRECRAWL_API_KEY") ?? ""}` } }).then((r) => r.json()).catch(() => null); // guardrail-allow: raw-fetch
        const left = Number(usage?.data?.remaining_credits);
        if (!Number.isFinite(left) || left - (todo?.length ?? 0) < floor) {
          return new Response(JSON.stringify({ success: true, picked: todo?.length ?? 0, done: 0, stopped: "credit_floor", remaining_credits: Number.isFinite(left) ? left : null, floor }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
      let first = true;
      for (const ev of todo ?? []) {
        if (Date.now() - started > BUDGET_MS) break;
        if (!first) await new Promise((r) => setTimeout(r, spacing));
        first = false;
        const url = String(ev.source_url).replace(/\/?$/, "/");
        // Bonhams answers 403 to this function's address, so the page is read through Firecrawl (rawHtml, 1 credit a page).
        // Every response is retained first: the body goes to the listing-snapshots bucket and a listing_page_snapshots row
        // points at it (the table's own convention for large pages), then the page is parsed and landed.
        const fc = await firecrawlScrape({ url, formats: ["rawHtml"], onlyMainContent: false, waitFor: 0 });
        credits++;
        const status = Number(fc.raw?.data?.metadata?.statusCode ?? fc.httpStatus ?? 0);
        const rawHtml: string | null = typeof fc.raw?.data?.rawHtml === "string" ? fc.raw.data.rawHtml : fc.data.html;
        if (fc.httpStatus === 402 || fc.httpStatus === 429) { out.backoff = `Firecrawl HTTP ${fc.httpStatus}`; break; }
        if (rawHtml) {
          try {
            const bytes = new TextEncoder().encode(rawHtml);
            const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((b) => b.toString(16).padStart(2, "0")).join("");
            const path = `bonhams/lot-pages/${sha}.html`;
            await supabase.storage.from("listing-snapshots").upload(path, bytes, { contentType: "text/html", upsert: true });
            const snapRes = await supabase.from("listing_page_snapshots").insert({
              platform: "bonhams", listing_url: url, fetched_at: new Date().toISOString(), fetch_method: "firecrawl", http_status: status || null,
              success: status === 200, html: null, html_storage_path: path, html_sha256: sha, content_length: bytes.length,
              metadata: { caller: "extract-bonhams-deep", listing_key: ev.source_listing_id, credits: 1 },
            });
            if (snapRes.error && snapRes.error.code !== "23505") softWrite("listing_page_snapshots insert", snapRes); // 23505: same page already retained
          } catch (_) { /* a duplicate or a storage hiccup must not lose the parse; the page is parsed below */ }
        }
        const observedAt = new Date().toISOString();
        if (status === 404 || status === 410) {
          // Not terminal: a preview lot (lot 0) of an unopened sale opens later. The revision queue owns the retry.
          await writeVehicleEventByKey(supabase, {
            vehicle_id: ev.vehicle_id, source_platform: "bonhams", source_listing_id: ev.source_listing_id, event_type: "auction",
            source_url: ev.source_url, metadata: { deep_at: observedAt, deep_status: "revision_not_found", http_status: status },
          });
          await recordRevision(supabase, { url: ev.source_url, missing: ["photos", "description"], reason: "not_found", next_action: "refetch", raised_by: "extract-bonhams", vehicle_id: ev.vehicle_id, detail: { http_status: status, preview_lot: /\/lot\/0\//.test(ev.source_url) } });
          out.gone++;
          continue;
        }
        if (status !== 200 || !rawHtml) { out.failed++; if (out.errors.length < 5) out.errors.push(`${ev.source_listing_id}: HTTP ${status} ${fc.error ?? ""}`.trim()); continue; }
        const page = parseLotPage(rawHtml);
        if (!page) { out.backoff = "not a lot page (challenge or changed shape)"; break; }

        try {
          out.images += await landLotPage(supabase, ev, page, observedAt);
          out.done++;
        } catch (e: any) {
          out.failed++; if (out.errors.length < 5) out.errors.push(`${ev.source_listing_id}: ${String(e?.message ?? e).slice(0, 160)}`);
        }
      }
      return new Response(JSON.stringify({ success: true, ...out, credits_used: credits, elapsed_ms: Date.now() - started }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

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
        // Fallback: query directly — find vehicles missing key fields (price, description, or year)
        const { data } = await supabase
          .from("vehicles")
          .select("id, discovery_url, vin, color, mileage, description, transmission, body_style, sale_price, enrichment_failures")
          .eq("discovery_source", "bonhams")
          .or("year.is.null,sale_price.is.null,description.is.null")
          .or("enrichment_failures.is.null,enrichment_failures.lt.3")
          .not("discovery_url", "is", null)
          .order("updated_at", { ascending: true })
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
          softWrite("vehicles enrichment attempt", await supabase.from("vehicles").update({ last_enrichment_attempt: new Date().toISOString() }).eq("id", cand.id));

          const extracted = await extractBonhamsLot(cand.discovery_url);

          if (!extracted.year && !extracted.make && !extracted.title) {
            softWrite("vehicles enrichment_failures", await supabase.from("vehicles").update({ enrichment_failures: 3 }).eq("id", cand.id));
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
            softWrite("vehicles enrichment_failures", await supabase.from("vehicles").update({ enrichment_failures: (cand.enrichment_failures || 0) + 1 }).eq("id", cand.id));
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
              mustWrite("vehicles update (catalog lot)", await supabase.from("vehicles").update(vehicleData).eq("id", existing.id));
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

              // Create vehicle_events (non-fatal)
              if (newId) {
                try {
                  const evWrite = await writeVehicleEventByKey(supabase, {
                    vehicle_id: newId,
                    source_platform: "bonhams",
                    event_type: "auction",
                    source_url: lot.url,
                    source_listing_id: listingUrlKey || lot.lotNumber || catalog.auctionId,
                    event_status: lot.availability?.includes("OutOfStock") ? "sold" : "active",
                    ended_at: catalog.auctionDate,
                    final_price: lot.price,
                    sold_at: lot.availability?.includes("OutOfStock") ? catalog.auctionDate : null,
                    metadata: {
                      lot_number: lot.lotNumber,
                      sale_id: catalog.auctionId,
                      sale_name: catalog.auctionName,
                      price_currency: lot.priceCurrency,
                    },
                  });
                  if (evWrite.action === "error") console.warn(`[Bonhams] vehicle_events error (non-fatal): ${evWrite.error}`);
                } catch (e: any) {
                  console.warn(`[Bonhams] vehicle_events error (non-fatal): ${e.message}`);
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
