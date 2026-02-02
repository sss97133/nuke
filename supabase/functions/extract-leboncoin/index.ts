/**
 * extract-leboncoin
 *
 * Extracts vehicle data from Leboncoin.fr - France's largest classified ads site.
 * Supports both search URL crawling (with pagination) and single listing extraction.
 *
 * Leboncoin uses DataDome anti-bot protection, requiring Firecrawl for JS rendering.
 *
 * French field mappings:
 * - Année (annee) = Year
 * - Marque = Make
 * - Modèle = Model
 * - Prix = Price
 * - Kilométrage = Mileage
 * - Boîte de vitesse = Transmission
 * - Carburant = Fuel type
 * - Puissance fiscale = Fiscal horsepower
 * - Puissance DIN = DIN horsepower
 * - Couleur = Color
 * - Nombre de places = Seats
 * - Nombre de portes = Doors
 *
 * Deploy: supabase functions deploy extract-leboncoin --no-verify-jwt
 *
 * Usage:
 *   POST { "url": "https://www.leboncoin.fr/ad/voitures/..." }
 *   POST { "url": "https://www.leboncoin.fr/recherche?category=2&regdate=min-1991", "crawl_search": true }
 *   POST { "url": "...", "save_to_db": true }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { firecrawlScrape } from "../_shared/firecrawl.ts";
import { normalizeListingUrlKey } from "../_shared/listingUrl.ts";
import { ExtractionLogger, validateVin, parsePrice, parseMileage } from "../_shared/extractionHealth.ts";

const EXTRACTOR_VERSION = "extract-leboncoin:1.1.0";

// ============================================================================
// FETCH UTILITIES
// ============================================================================

/**
 * Direct fetch with browser-like headers as fallback when Firecrawl is unavailable
 */
async function directFetch(url: string): Promise<{ html: string; success: boolean; error?: string }> {
  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
  ];
  const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": userAgent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Sec-Ch-Ua": '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"macOS"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
      signal: AbortSignal.timeout(30000),
      redirect: "follow",
    });

    if (!response.ok) {
      return { html: "", success: false, error: `HTTP ${response.status}` };
    }

    const html = await response.text();

    // Check for DataDome/bot detection
    if (
      html.includes("captcha-delivery.com") ||
      html.includes("datadome") ||
      html.includes("geo.captcha-delivery") ||
      html.includes("Please enable JS and disable any ad blocker")
    ) {
      console.log("[extract-leboncoin] DataDome CAPTCHA detected in response");
      return { html: "", success: false, error: "DataDome CAPTCHA detected - Firecrawl required" };
    }

    return { html, success: true };
  } catch (err: any) {
    return { html: "", success: false, error: err.message };
  }
}

/**
 * Try Firecrawl first, fall back to direct fetch
 */
async function fetchPage(url: string): Promise<{ html: string; markdown: string; method: string; error?: string }> {
  // Try Firecrawl first (handles JS rendering)
  let firecrawlError: string | null = null;
  try {
    const scrapeResult = await firecrawlScrape({
      url,
      formats: ["html", "markdown"],
      waitFor: 5000,
      timeout: 45000,
      headers: {
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      },
    });

    if (scrapeResult.ok && (scrapeResult.data.html || scrapeResult.data.markdown)) {
      console.log(`[extract-leboncoin] Firecrawl succeeded for: ${url}`);
      return {
        html: scrapeResult.data.html || "",
        markdown: scrapeResult.data.markdown || "",
        method: "firecrawl",
      };
    }

    firecrawlError = scrapeResult.error || "Unknown Firecrawl error";
    console.log(`[extract-leboncoin] Firecrawl failed: ${firecrawlError}`);

    // Check for credits exhausted
    if (firecrawlError.includes("Insufficient credits")) {
      console.warn("[extract-leboncoin] Firecrawl credits exhausted!");
    }
  } catch (err: any) {
    firecrawlError = err.message;
    console.log(`[extract-leboncoin] Firecrawl exception: ${firecrawlError}`);
  }

  // Fall back to direct fetch
  console.log(`[extract-leboncoin] Falling back to direct fetch for: ${url}`);
  const directResult = await directFetch(url);

  if (directResult.success) {
    return {
      html: directResult.html,
      markdown: "",
      method: "direct_fetch",
    };
  }

  // Provide helpful error message
  let errorMsg = directResult.error || "Unknown error";
  if (directResult.error?.includes("CAPTCHA") && firecrawlError?.includes("Insufficient credits")) {
    errorMsg = "Leboncoin requires Firecrawl for anti-bot bypass, but Firecrawl credits are exhausted. Please add Firecrawl credits to continue.";
  } else if (directResult.error?.includes("CAPTCHA")) {
    errorMsg = "Leboncoin blocked direct fetch with DataDome CAPTCHA. Firecrawl is required for this site.";
  }

  return {
    html: "",
    markdown: "",
    method: "failed",
    error: errorMsg,
  };
}

// ============================================================================
// TYPES
// ============================================================================

interface LeboncoinExtracted {
  url: string;
  listing_id: string | null;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  vin: string | null;
  mileage: number | null;
  mileage_unit: "km" | "miles";
  exterior_color: string | null;
  transmission: string | null;
  fuel_type: string | null;
  engine: string | null;
  horsepower: number | null;
  fiscal_horsepower: number | null;
  doors: number | null;
  seats: number | null;
  price: number | null;
  currency: "EUR";
  location: string | null;
  postal_code: string | null;
  department: string | null;
  seller_type: "private" | "professional" | null;
  seller_name: string | null;
  seller_siren: string | null;
  description: string | null;
  image_urls: string[];
  published_at: string | null;
  condition: string | null;
  first_registration: string | null;
  quality_score: number;
  quality_flags: string[];
}

interface SearchResult {
  listing_url: string;
  title: string | null;
  price: number | null;
  year: number | null;
  thumbnail_url: string | null;
  location: string | null;
}

// ============================================================================
// FRENCH TO ENGLISH FIELD MAPPINGS
// ============================================================================

const FRENCH_MAKES: Record<string, string> = {
  "alfa romeo": "Alfa Romeo",
  "aston martin": "Aston Martin",
  "audi": "Audi",
  "bentley": "Bentley",
  "bmw": "BMW",
  "bugatti": "Bugatti",
  "cadillac": "Cadillac",
  "chevrolet": "Chevrolet",
  "chrysler": "Chrysler",
  "citroën": "Citroen",
  "citroen": "Citroen",
  "dacia": "Dacia",
  "daewoo": "Daewoo",
  "daihatsu": "Daihatsu",
  "dodge": "Dodge",
  "ds": "DS",
  "ferrari": "Ferrari",
  "fiat": "Fiat",
  "ford": "Ford",
  "honda": "Honda",
  "hummer": "Hummer",
  "hyundai": "Hyundai",
  "infiniti": "Infiniti",
  "isuzu": "Isuzu",
  "jaguar": "Jaguar",
  "jeep": "Jeep",
  "kia": "Kia",
  "lada": "Lada",
  "lamborghini": "Lamborghini",
  "lancia": "Lancia",
  "land rover": "Land Rover",
  "lexus": "Lexus",
  "lotus": "Lotus",
  "maserati": "Maserati",
  "mazda": "Mazda",
  "mclaren": "McLaren",
  "mercedes-benz": "Mercedes-Benz",
  "mercedes": "Mercedes-Benz",
  "mg": "MG",
  "mini": "Mini",
  "mitsubishi": "Mitsubishi",
  "nissan": "Nissan",
  "opel": "Opel",
  "peugeot": "Peugeot",
  "pontiac": "Pontiac",
  "porsche": "Porsche",
  "renault": "Renault",
  "rolls-royce": "Rolls-Royce",
  "rover": "Rover",
  "saab": "Saab",
  "seat": "SEAT",
  "skoda": "Skoda",
  "smart": "Smart",
  "ssangyong": "SsangYong",
  "subaru": "Subaru",
  "suzuki": "Suzuki",
  "tesla": "Tesla",
  "toyota": "Toyota",
  "triumph": "Triumph",
  "volkswagen": "Volkswagen",
  "volvo": "Volvo",
  "alpine": "Alpine",
  "simca": "Simca",
  "panhard": "Panhard",
  "talbot": "Talbot",
  "de tomaso": "De Tomaso",
  "iso": "ISO",
  "facel vega": "Facel Vega",
  "matra": "Matra",
  "ligier": "Ligier",
  "venturi": "Venturi",
};

const FRENCH_FUEL_TYPES: Record<string, string> = {
  "essence": "Gasoline",
  "diesel": "Diesel",
  "électrique": "Electric",
  "electrique": "Electric",
  "hybride": "Hybrid",
  "hybride rechargeable": "Plug-in Hybrid",
  "gpl": "LPG",
  "gnv": "CNG",
  "bioéthanol": "E85",
  "bioethanol": "E85",
  "hydrogène": "Hydrogen",
  "hydrogene": "Hydrogen",
};

const FRENCH_TRANSMISSIONS: Record<string, string> = {
  "manuelle": "Manual",
  "automatique": "Automatic",
  "semi-automatique": "Semi-automatic",
  "robotisée": "Automated Manual",
  "robotisee": "Automated Manual",
  "cvt": "CVT",
};

const FRENCH_COLORS: Record<string, string> = {
  "noir": "Black",
  "blanc": "White",
  "gris": "Gray",
  "argent": "Silver",
  "argenté": "Silver",
  "bleu": "Blue",
  "rouge": "Red",
  "vert": "Green",
  "jaune": "Yellow",
  "orange": "Orange",
  "marron": "Brown",
  "beige": "Beige",
  "bordeaux": "Burgundy",
  "violet": "Purple",
  "rose": "Pink",
  "or": "Gold",
  "doré": "Gold",
  "bronze": "Bronze",
  "champagne": "Champagne",
  "ivoire": "Ivory",
  "crème": "Cream",
  "creme": "Cream",
  "anthracite": "Anthracite",
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function normalizeFrenchMake(make: string | null): string | null {
  if (!make) return null;
  const lower = make.toLowerCase().trim();
  return FRENCH_MAKES[lower] || (make.charAt(0).toUpperCase() + make.slice(1).toLowerCase());
}

function normalizeFrenchFuel(fuel: string | null): string | null {
  if (!fuel) return null;
  const lower = fuel.toLowerCase().trim();
  return FRENCH_FUEL_TYPES[lower] || fuel;
}

function normalizeFrenchTransmission(trans: string | null): string | null {
  if (!trans) return null;
  const lower = trans.toLowerCase().trim();
  return FRENCH_TRANSMISSIONS[lower] || trans;
}

function normalizeFrenchColor(color: string | null): string | null {
  if (!color) return null;
  const lower = color.toLowerCase().trim();
  return FRENCH_COLORS[lower] || color;
}

function extractListingId(url: string): string | null {
  // Format: /ad/voitures/1234567890.htm or /voitures/1234567890.htm
  const match = url.match(/\/(\d{7,12})(?:\.htm)?(?:\?|$)/);
  return match ? match[1] : null;
}

function parseEurPrice(priceStr: string | null): number | null {
  if (!priceStr) return null;
  // Remove € symbol, spaces, and thousands separators
  const cleaned = priceStr.replace(/[€\s\u00a0]/g, "").replace(/\./g, "").replace(/,/g, ".");
  const value = parseFloat(cleaned);
  return isNaN(value) ? null : Math.round(value);
}

function parseKilometers(kmStr: string | null): number | null {
  if (!kmStr) return null;
  // Remove "km", spaces, and thousands separators
  const cleaned = kmStr.replace(/km/gi, "").replace(/[\s\u00a0]/g, "").replace(/\./g, "").replace(/,/g, ".");
  const value = parseInt(cleaned, 10);
  return isNaN(value) ? null : value;
}

// ============================================================================
// SINGLE LISTING EXTRACTION
// ============================================================================

async function extractSingleListing(url: string): Promise<LeboncoinExtracted> {
  console.log(`[extract-leboncoin] Scraping single listing: ${url}`);

  const fetchResult = await fetchPage(url);

  if (fetchResult.method === "failed" || (!fetchResult.html && !fetchResult.markdown)) {
    throw new Error(`Failed to scrape Leboncoin listing: ${fetchResult.error || "No content returned"}`);
  }

  const html = fetchResult.html;
  const markdown = fetchResult.markdown;
  const text = `${html} ${markdown}`;

  console.log(`[extract-leboncoin] Fetch method: ${fetchResult.method}, HTML length: ${html.length}`);

  const listingId = extractListingId(url);
  const qualityFlags: string[] = [];

  // Extract title from og:title or h1
  let title: string | null = null;
  const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (ogTitleMatch) {
    title = ogTitleMatch[1].trim();
  } else {
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1Match) {
      title = h1Match[1].trim();
    }
  }

  // Extract price
  let price: number | null = null;
  const pricePatterns = [
    /<span[^>]*data-qa-id=["']adview_price["'][^>]*>([^<]+)<\/span>/i,
    /"price":\s*(\d+)/i,
    /(\d{1,3}(?:[\s\u00a0]\d{3})*)\s*€/,
  ];
  for (const pattern of pricePatterns) {
    const match = text.match(pattern);
    if (match) {
      price = parseEurPrice(match[1]);
      if (price) break;
    }
  }

  // Extract year (Année / Année-modèle)
  let year: number | null = null;
  const yearPatterns = [
    /Ann[eé]e[^:]*:\s*(\d{4})/i,
    /Ann[eé]e-mod[eè]le[^:]*:\s*(\d{4})/i,
    /"regdate":\s*"?(\d{4})/i,
    /Mise en circulation[^:]*:\s*(\d{2}\/)?(\d{4})/i,
  ];
  for (const pattern of yearPatterns) {
    const match = text.match(pattern);
    if (match) {
      const yearStr = match[2] || match[1];
      year = parseInt(yearStr, 10);
      if (year >= 1900 && year <= new Date().getFullYear() + 1) break;
      year = null;
    }
  }

  // Extract make (Marque)
  let make: string | null = null;
  const makePatterns = [
    /Marque[^:]*:\s*([A-Za-zÀ-ÿ\s-]+?)(?:\s*<|$|\n)/i,
    /"brand":\s*"([^"]+)"/i,
  ];
  for (const pattern of makePatterns) {
    const match = text.match(pattern);
    if (match) {
      make = normalizeFrenchMake(match[1].trim());
      if (make) break;
    }
  }

  // Extract model (Modèle)
  let model: string | null = null;
  const modelPatterns = [
    /Mod[eè]le[^:]*:\s*([A-Za-zÀ-ÿ0-9\s-]+?)(?:\s*<|$|\n)/i,
    /"model":\s*"([^"]+)"/i,
  ];
  for (const pattern of modelPatterns) {
    const match = text.match(pattern);
    if (match) {
      model = match[1].trim();
      if (model) break;
    }
  }

  // Extract mileage (Kilométrage)
  let mileage: number | null = null;
  const mileagePatterns = [
    /Kilom[eé]trage[^:]*:\s*([0-9\s.]+)\s*km/i,
    /"mileage":\s*"?(\d+)/i,
    /(\d{1,3}(?:[\s.]\d{3})*)\s*km/i,
  ];
  for (const pattern of mileagePatterns) {
    const match = text.match(pattern);
    if (match) {
      mileage = parseKilometers(match[1]);
      if (mileage !== null && mileage > 0 && mileage < 2000000) break;
      mileage = null;
    }
  }

  // Extract transmission (Boîte de vitesse)
  let transmission: string | null = null;
  const transPatterns = [
    /Bo[îi]te de vitesse[^:]*:\s*([A-Za-zÀ-ÿ\s-]+?)(?:\s*<|$|\n)/i,
    /"gearbox":\s*"([^"]+)"/i,
  ];
  for (const pattern of transPatterns) {
    const match = text.match(pattern);
    if (match) {
      transmission = normalizeFrenchTransmission(match[1].trim());
      if (transmission) break;
    }
  }

  // Extract fuel type (Carburant)
  let fuelType: string | null = null;
  const fuelPatterns = [
    /Carburant[^:]*:\s*([A-Za-zÀ-ÿ\s-]+?)(?:\s*<|$|\n)/i,
    /"fuel":\s*"([^"]+)"/i,
  ];
  for (const pattern of fuelPatterns) {
    const match = text.match(pattern);
    if (match) {
      fuelType = normalizeFrenchFuel(match[1].trim());
      if (fuelType) break;
    }
  }

  // Extract color (Couleur)
  let exteriorColor: string | null = null;
  const colorPatterns = [
    /Couleur[^:]*:\s*([A-Za-zÀ-ÿ\s-]+?)(?:\s*<|$|\n)/i,
    /"color":\s*"([^"]+)"/i,
  ];
  for (const pattern of colorPatterns) {
    const match = text.match(pattern);
    if (match) {
      exteriorColor = normalizeFrenchColor(match[1].trim());
      if (exteriorColor) break;
    }
  }

  // Extract horsepower (Puissance DIN)
  let horsepower: number | null = null;
  const hpPatterns = [
    /Puissance DIN[^:]*:\s*(\d+)\s*ch/i,
    /(\d+)\s*ch\s*DIN/i,
    /(\d+)\s*cv/i,
  ];
  for (const pattern of hpPatterns) {
    const match = text.match(pattern);
    if (match) {
      horsepower = parseInt(match[1], 10);
      if (horsepower > 0 && horsepower < 3000) break;
      horsepower = null;
    }
  }

  // Extract fiscal horsepower (Puissance fiscale)
  let fiscalHorsepower: number | null = null;
  const fiscalHpMatch = text.match(/Puissance fiscale[^:]*:\s*(\d+)/i);
  if (fiscalHpMatch) {
    fiscalHorsepower = parseInt(fiscalHpMatch[1], 10);
  }

  // Extract doors (Nombre de portes)
  let doors: number | null = null;
  const doorsMatch = text.match(/Nombre de portes[^:]*:\s*(\d+)/i) ||
                     text.match(/(\d+)\s*portes/i);
  if (doorsMatch) {
    doors = parseInt(doorsMatch[1], 10);
  }

  // Extract seats (Nombre de places)
  let seats: number | null = null;
  const seatsMatch = text.match(/Nombre de places[^:]*:\s*(\d+)/i) ||
                     text.match(/(\d+)\s*places/i);
  if (seatsMatch) {
    seats = parseInt(seatsMatch[1], 10);
  }

  // Extract location
  let location: string | null = null;
  let postalCode: string | null = null;
  let department: string | null = null;

  const locationPatterns = [
    /<span[^>]*data-qa-id=["']adview_location["'][^>]*>([^<]+)<\/span>/i,
    /Localisation[^:]*:\s*([A-Za-zÀ-ÿ\s-]+)/i,
    /"city":\s*"([^"]+)"/i,
  ];
  for (const pattern of locationPatterns) {
    const match = text.match(pattern);
    if (match) {
      location = match[1].trim();
      if (location) break;
    }
  }

  const postalMatch = text.match(/(\d{5})/);
  if (postalMatch) {
    postalCode = postalMatch[1];
    department = postalCode.substring(0, 2);
  }

  // Extract seller info
  let sellerType: "private" | "professional" | null = null;
  let sellerName: string | null = null;
  let sellerSiren: string | null = null;

  if (/professionnel/i.test(text) || /SIREN/i.test(text)) {
    sellerType = "professional";
    const sirenMatch = text.match(/SIREN[:\s]*(\d{9})/i);
    if (sirenMatch) {
      sellerSiren = sirenMatch[1];
    }
  } else if (/particulier/i.test(text)) {
    sellerType = "private";
  }

  const sellerNameMatch = text.match(/Vendeur[^:]*:\s*([A-Za-zÀ-ÿ\s]+?)(?:\s*<|$|\n)/i);
  if (sellerNameMatch) {
    sellerName = sellerNameMatch[1].trim();
  }

  // Extract description
  let description: string | null = null;
  const descPatterns = [
    /<div[^>]*data-qa-id=["']adview_description_container["'][^>]*>([\s\S]*?)<\/div>/i,
    /<section[^>]*class="[^"]*Description[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
  ];
  for (const pattern of descPatterns) {
    const match = html.match(pattern);
    if (match) {
      description = match[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 5000);
      if (description && description.length > 20) break;
    }
  }

  // Fallback to markdown description
  if (!description && markdown) {
    const mdLines = markdown.split("\n").filter(line => line.length > 50);
    if (mdLines.length > 0) {
      description = mdLines.slice(0, 10).join("\n").slice(0, 5000);
    }
  }

  // Extract images
  const imageUrls: string[] = [];
  const imagePatterns = [
    /<img[^>]*src="(https:\/\/img\.leboncoin\.fr\/[^"]+)"/gi,
    /"image":\s*"(https:\/\/img\.leboncoin\.fr\/[^"]+)"/gi,
    /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/gi,
  ];

  const seenImages = new Set<string>();
  for (const pattern of imagePatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const imgUrl = match[1];
      if (!seenImages.has(imgUrl) && !imgUrl.includes("logo") && !imgUrl.includes("icon")) {
        seenImages.add(imgUrl);
        // Get high-res version
        const highRes = imgUrl.replace(/\/ad-image\//, "/ad-large/").replace(/\/ad-thumb\//, "/ad-large/");
        imageUrls.push(highRes);
      }
    }
  }

  // Extract published date
  let publishedAt: string | null = null;
  const datePatterns = [
    /"first_publication_date":\s*"([^"]+)"/i,
    /Mise en ligne le[^:]*:\s*(\d{2}\/\d{2}\/\d{4})/i,
  ];
  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      try {
        // Handle DD/MM/YYYY format
        const dateStr = match[1];
        if (dateStr.includes("/")) {
          const [day, month, yearPart] = dateStr.split("/");
          publishedAt = new Date(`${yearPart}-${month}-${day}`).toISOString();
        } else {
          publishedAt = new Date(dateStr).toISOString();
        }
        break;
      } catch {
        // Ignore parse errors
      }
    }
  }

  // Extract VIN (rare but possible)
  let vin: string | null = null;
  const vinMatch = text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
  if (vinMatch) {
    const candidate = vinMatch[1].toUpperCase();
    if (!/[IOQ]/.test(candidate)) {
      vin = candidate;
    }
  }

  // Extract first registration date
  let firstRegistration: string | null = null;
  const regMatch = text.match(/Mise en circulation[^:]*:\s*(\d{2}\/\d{4}|\d{4})/i);
  if (regMatch) {
    firstRegistration = regMatch[1];
  }

  // Extract condition
  let condition: string | null = null;
  if (/neuf/i.test(text)) {
    condition = "New";
  } else if (/occasion/i.test(text)) {
    condition = "Used";
  }

  // Calculate quality score
  let qualityScore = 0.6; // Base for classified site

  if (year) qualityScore += 0.1;
  if (make) qualityScore += 0.08;
  if (model) qualityScore += 0.05;
  if (price) qualityScore += 0.05;
  if (mileage) qualityScore += 0.05;
  if (imageUrls.length > 0) qualityScore += 0.05;
  if (imageUrls.length > 5) qualityScore += 0.05;
  if (description && description.length > 100) qualityScore += 0.03;
  if (vin) qualityScore += 0.1;
  if (sellerType === "professional") qualityScore += 0.02;

  qualityScore = Math.min(0.95, qualityScore);

  // Add quality flags
  if (!year) qualityFlags.push("MISSING_YEAR");
  if (!make) qualityFlags.push("MISSING_MAKE");
  if (!model) qualityFlags.push("MISSING_MODEL");
  if (!price) qualityFlags.push("MISSING_PRICE");
  if (imageUrls.length === 0) qualityFlags.push("NO_IMAGES");
  if (fetchResult.method === "direct_fetch") qualityFlags.push("DIRECT_FETCH_USED");
  if (fetchResult.error?.includes("CAPTCHA")) qualityFlags.push("POSSIBLE_BOT_BLOCK");

  return {
    url,
    listing_id: listingId,
    title,
    year,
    make,
    model,
    trim: null,
    vin,
    mileage,
    mileage_unit: "km",
    exterior_color: exteriorColor,
    transmission,
    fuel_type: fuelType,
    engine: null,
    horsepower,
    fiscal_horsepower: fiscalHorsepower,
    doors,
    seats,
    price,
    currency: "EUR",
    location,
    postal_code: postalCode,
    department,
    seller_type: sellerType,
    seller_name: sellerName,
    seller_siren: sellerSiren,
    description,
    image_urls: imageUrls.slice(0, 50),
    published_at: publishedAt,
    condition,
    first_registration: firstRegistration,
    quality_score: qualityScore,
    quality_flags: qualityFlags,
  };
}

// ============================================================================
// SEARCH RESULTS CRAWLING
// ============================================================================

async function crawlSearchResults(
  searchUrl: string,
  options: { maxPages?: number; maxListings?: number } = {}
): Promise<{ listings: SearchResult[]; totalFound: number; pagesProcessed: number; error?: string }> {
  const maxPages = options.maxPages || 5;
  const maxListings = options.maxListings || 100;

  const listings: SearchResult[] = [];
  let pagesProcessed = 0;
  let currentUrl = searchUrl;
  let lastError: string | undefined;

  console.log(`[extract-leboncoin] Crawling search: ${searchUrl}`);

  for (let page = 1; page <= maxPages && listings.length < maxListings; page++) {
    console.log(`[extract-leboncoin] Processing page ${page}: ${currentUrl}`);

    const fetchResult = await fetchPage(currentUrl);

    if (fetchResult.method === "failed" || !fetchResult.html) {
      lastError = fetchResult.error || "Failed to fetch page";
      console.error(`[extract-leboncoin] Failed to scrape page ${page}: ${lastError}`);
      break;
    }

    console.log(`[extract-leboncoin] Page ${page} fetch method: ${fetchResult.method}, HTML length: ${fetchResult.html.length}`);

    const html = fetchResult.html;
    pagesProcessed++;

    // Extract listing cards from search results
    // Leboncoin uses data-test-id or data-qa-id attributes
    const listingPatterns = [
      // Modern React-based listing cards
      /<a[^>]*href="(\/ad\/voitures\/\d+\.htm)"[^>]*>([\s\S]*?)<\/a>/gi,
      // Older format
      /<a[^>]*href="(\/voitures\/\d+\.htm)"[^>]*>([\s\S]*?)<\/a>/gi,
    ];

    const seenUrls = new Set<string>();

    for (const pattern of listingPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const path = match[1];
        const cardHtml = match[2];
        const fullUrl = `https://www.leboncoin.fr${path}`;

        if (seenUrls.has(fullUrl)) continue;
        seenUrls.add(fullUrl);

        // Extract title from card
        let title: string | null = null;
        const titleMatch = cardHtml.match(/<p[^>]*>([^<]{10,100})<\/p>/i) ||
                          cardHtml.match(/title=["']([^"']+)["']/i);
        if (titleMatch) {
          title = titleMatch[1].trim();
        }

        // Extract price from card
        let price: number | null = null;
        const priceMatch = cardHtml.match(/(\d{1,3}(?:[\s\u00a0]\d{3})*)\s*€/);
        if (priceMatch) {
          price = parseEurPrice(priceMatch[1]);
        }

        // Extract year from title
        let year: number | null = null;
        const yearMatch = (title || "").match(/\b(19[0-9]{2}|20[0-2][0-9])\b/);
        if (yearMatch) {
          year = parseInt(yearMatch[1], 10);
        }

        // Extract thumbnail
        let thumbnailUrl: string | null = null;
        const thumbMatch = cardHtml.match(/src="(https:\/\/img\.leboncoin\.fr[^"]+)"/i);
        if (thumbMatch) {
          thumbnailUrl = thumbMatch[1];
        }

        // Extract location
        let location: string | null = null;
        const locMatch = cardHtml.match(/<p[^>]*>([A-Za-zÀ-ÿ\s]+\s+\d{5})<\/p>/i);
        if (locMatch) {
          location = locMatch[1].trim();
        }

        listings.push({
          listing_url: fullUrl,
          title,
          price,
          year,
          thumbnail_url: thumbnailUrl,
          location,
        });

        if (listings.length >= maxListings) break;
      }
      if (listings.length >= maxListings) break;
    }

    // Find next page link
    const nextPageMatch = html.match(/<a[^>]*href="([^"]*page=(\d+)[^"]*)"[^>]*>(?:Suivant|>)/i);
    if (nextPageMatch && parseInt(nextPageMatch[2], 10) === page + 1) {
      currentUrl = nextPageMatch[1].startsWith("http")
        ? nextPageMatch[1]
        : `https://www.leboncoin.fr${nextPageMatch[1]}`;
    } else {
      // Try constructing next page URL
      const url = new URL(currentUrl);
      const currentPage = parseInt(url.searchParams.get("page") || "1", 10);
      url.searchParams.set("page", String(currentPage + 1));
      currentUrl = url.toString();
    }
  }

  console.log(`[extract-leboncoin] Found ${listings.length} listings across ${pagesProcessed} pages`);

  return {
    listings,
    totalFound: listings.length,
    pagesProcessed,
    error: pagesProcessed === 0 ? lastError : undefined,
  };
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

async function saveToDatabase(
  supabase: any,
  extracted: LeboncoinExtracted
): Promise<{ vehicleId: string | null; queueId: string | null; success: boolean; error?: string }> {
  try {
    const listingUrlKey = normalizeListingUrlKey(extracted.url);

    // Check for existing vehicle by URL
    const { data: existingQueue } = await supabase
      .from("import_queue")
      .select("id, vehicle_id")
      .eq("listing_url", extracted.url)
      .maybeSingle();

    if (existingQueue?.vehicle_id) {
      console.log(`[extract-leboncoin] Found existing vehicle via URL: ${existingQueue.vehicle_id}`);

      // Update the vehicle with new data
      await supabase
        .from("vehicles")
        .update({
          year: extracted.year,
          make: extracted.make,
          model: extracted.model,
          mileage: extracted.mileage,
          transmission: extracted.transmission,
          fuel_type: extracted.fuel_type,
          exterior_color: extracted.exterior_color,
          asking_price: extracted.price,
          horsepower: extracted.horsepower,
          doors: extracted.doors,
          seats: extracted.seats,
          description: extracted.description,
          city: extracted.location,
          zip_code: extracted.postal_code,
          country: "France",
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingQueue.vehicle_id);

      // Update import_queue
      await supabase
        .from("import_queue")
        .update({
          status: "complete",
          processed_at: new Date().toISOString(),
          extractor_version: EXTRACTOR_VERSION,
          raw_data: {
            ...extracted,
            extracted_at: new Date().toISOString(),
          },
        })
        .eq("id", existingQueue.id);

      return {
        vehicleId: existingQueue.vehicle_id,
        queueId: existingQueue.id,
        success: true,
      };
    }

    // Insert into import_queue first (for deduplication)
    const { data: queueItem, error: queueError } = await supabase
      .from("import_queue")
      .upsert(
        {
          listing_url: extracted.url,
          listing_title: extracted.title,
          listing_price: extracted.price,
          listing_year: extracted.year,
          listing_make: extracted.make,
          listing_model: extracted.model,
          thumbnail_url: extracted.image_urls[0] || null,
          raw_data: {
            ...extracted,
            extracted_at: new Date().toISOString(),
          },
          status: "pending",
          extractor_version: EXTRACTOR_VERSION,
        },
        { onConflict: "listing_url" }
      )
      .select()
      .single();

    if (queueError) {
      throw new Error(`Queue insert failed: ${queueError.message}`);
    }

    // Create vehicle record
    const { data: vehicle, error: vehicleError } = await supabase
      .from("vehicles")
      .insert({
        year: extracted.year,
        make: extracted.make,
        model: extracted.model,
        vin: extracted.vin,
        mileage: extracted.mileage,
        transmission: extracted.transmission,
        fuel_type: extracted.fuel_type,
        exterior_color: extracted.exterior_color,
        asking_price: extracted.price,
        horsepower: extracted.horsepower,
        doors: extracted.doors,
        seats: extracted.seats,
        description: extracted.description,
        city: extracted.location,
        zip_code: extracted.postal_code,
        country: "France",
        discovery_url: extracted.url,
        discovery_source: "leboncoin",
        profile_origin: "leboncoin_import",
        platform_source: "leboncoin",
        is_public: true,
        status: "active",
        import_queue_id: queueItem.id,
        origin_metadata: {
          listing_id: extracted.listing_id,
          seller_type: extracted.seller_type,
          seller_name: extracted.seller_name,
          seller_siren: extracted.seller_siren,
          fiscal_horsepower: extracted.fiscal_horsepower,
          department: extracted.department,
          condition: extracted.condition,
          first_registration: extracted.first_registration,
          published_at: extracted.published_at,
          quality_score: extracted.quality_score,
          quality_flags: extracted.quality_flags,
          extractor_version: EXTRACTOR_VERSION,
        },
        title: extracted.title,
        primary_image_url: extracted.image_urls[0] || null,
      })
      .select()
      .single();

    if (vehicleError) {
      // Mark queue as failed
      await supabase
        .from("import_queue")
        .update({
          status: "failed",
          error_message: vehicleError.message,
        })
        .eq("id", queueItem.id);

      throw new Error(`Vehicle insert failed: ${vehicleError.message}`);
    }

    // Update queue with vehicle ID
    await supabase
      .from("import_queue")
      .update({
        status: "complete",
        vehicle_id: vehicle.id,
        processed_at: new Date().toISOString(),
      })
      .eq("id", queueItem.id);

    // Save images
    if (extracted.image_urls.length > 0) {
      const imageRecords = extracted.image_urls.map((imgUrl, idx) => ({
        vehicle_id: vehicle.id,
        image_url: imgUrl,
        source_url: extracted.url,
        is_external: true,
        source: "leboncoin_import",
        is_primary: idx === 0,
        position: idx,
        display_order: idx,
        approval_status: "pending",
        is_approved: false,
        created_at: new Date().toISOString(),
      }));

      await supabase
        .from("vehicle_images")
        .upsert(imageRecords, { onConflict: "vehicle_id,image_url", ignoreDuplicates: true });
    }

    console.log(`[extract-leboncoin] Created vehicle: ${vehicle.id}`);

    return {
      vehicleId: vehicle.id,
      queueId: queueItem.id,
      success: true,
    };
  } catch (error: any) {
    console.error(`[extract-leboncoin] Database error: ${error.message}`);
    return {
      vehicleId: null,
      queueId: null,
      success: false,
      error: error.message,
    };
  }
}

async function queueSearchResults(
  supabase: any,
  listings: SearchResult[]
): Promise<{ queued: number; duplicates: number; errors: number }> {
  let queued = 0;
  let duplicates = 0;
  let errors = 0;

  for (const listing of listings) {
    try {
      const { data, error } = await supabase
        .from("import_queue")
        .upsert(
          {
            listing_url: listing.listing_url,
            listing_title: listing.title,
            listing_price: listing.price,
            listing_year: listing.year,
            thumbnail_url: listing.thumbnail_url,
            raw_data: {
              location: listing.location,
              source: "leboncoin_search",
              crawled_at: new Date().toISOString(),
            },
            status: "pending",
            extractor_version: EXTRACTOR_VERSION,
          },
          { onConflict: "listing_url", ignoreDuplicates: true }
        )
        .select();

      if (error) {
        if (error.code === "23505") {
          // Unique constraint violation = duplicate
          duplicates++;
        } else {
          errors++;
          console.error(`[extract-leboncoin] Queue error: ${error.message}`);
        }
      } else if (data && data.length > 0) {
        queued++;
      } else {
        duplicates++;
      }
    } catch (err: any) {
      errors++;
      console.error(`[extract-leboncoin] Queue exception: ${err.message}`);
    }
  }

  console.log(`[extract-leboncoin] Queued: ${queued}, Duplicates: ${duplicates}, Errors: ${errors}`);

  return { queued, duplicates, errors };
}

// ============================================================================
// HTTP HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const {
      url,
      crawl_search = false,
      save_to_db = false,
      max_pages = 5,
      max_listings = 100,
    } = body;

    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: "URL is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate URL is Leboncoin
    if (!url.includes("leboncoin.fr")) {
      return new Response(
        JSON.stringify({ success: false, error: "URL must be from leboncoin.fr" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isSearchUrl = url.includes("/recherche") || url.includes("category=");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Handle search URL crawling
    if (isSearchUrl || crawl_search) {
      console.log(`[extract-leboncoin] Crawling search URL: ${url}`);

      const { listings, totalFound, pagesProcessed, error: crawlError } = await crawlSearchResults(url, {
        maxPages: max_pages,
        maxListings: max_listings,
      });

      let queueResult = { queued: 0, duplicates: 0, errors: 0 };
      if (save_to_db && listings.length > 0) {
        queueResult = await queueSearchResults(supabase, listings);
      }

      // Return error if crawl failed completely
      if (pagesProcessed === 0 && crawlError) {
        return new Response(
          JSON.stringify({
            success: false,
            mode: "search_crawl",
            url,
            error: crawlError,
            message: "Leboncoin uses DataDome anti-bot protection. Firecrawl with sufficient credits is required to extract from this site.",
            extractor_version: EXTRACTOR_VERSION,
          }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: totalFound > 0,
          mode: "search_crawl",
          url,
          total_found: totalFound,
          pages_processed: pagesProcessed,
          listings: listings.slice(0, 20), // Return first 20 for preview
          queue_result: save_to_db ? queueResult : null,
          warning: crawlError || undefined,
          extractor_version: EXTRACTOR_VERSION,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle single listing extraction
    console.log(`[extract-leboncoin] Extracting single listing: ${url}`);

    const extracted = await extractSingleListing(url);

    let dbResult = null;
    if (save_to_db) {
      dbResult = await saveToDatabase(supabase, extracted);
    }

    // Log extraction results
    console.log(`[extract-leboncoin] === EXTRACTION RESULTS ===`);
    console.log(`Title: ${extracted.title}`);
    console.log(`Year/Make/Model: ${extracted.year} ${extracted.make} ${extracted.model}`);
    console.log(`Price: ${extracted.price}€`);
    console.log(`Mileage: ${extracted.mileage} km`);
    console.log(`Location: ${extracted.location} (${extracted.postal_code})`);
    console.log(`Seller: ${extracted.seller_type} - ${extracted.seller_name || "N/A"}`);
    console.log(`Images: ${extracted.image_urls.length}`);
    console.log(`Quality Score: ${(extracted.quality_score * 100).toFixed(1)}%`);
    console.log(`Quality Flags: ${extracted.quality_flags.join(", ") || "none"}`);

    return new Response(
      JSON.stringify({
        success: true,
        mode: "single_listing",
        extracted: {
          ...extracted,
          // Truncate description in response
          description: extracted.description
            ? `${extracted.description.slice(0, 300)}...`
            : null,
        },
        database: dbResult,
        extractor_version: EXTRACTOR_VERSION,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error(`[extract-leboncoin] Error: ${error.message}`);
    console.error(error.stack);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        extractor_version: EXTRACTOR_VERSION,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
