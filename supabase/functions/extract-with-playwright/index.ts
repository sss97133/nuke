/**
 * extract-with-playwright
 *
 * Universal fallback extractor for vehicle listings when all other methods fail.
 * Uses Firecrawl for JavaScript rendering (Playwright-style browser rendering),
 * then applies comprehensive regex-based parsing to extract vehicle data.
 *
 * This is the LAST RESORT - slow but works on any URL.
 * No OpenAI/Anthropic API dependencies - pure regex parsing.
 *
 * Deploy: supabase functions deploy extract-with-playwright --no-verify-jwt
 *
 * Usage:
 *   POST { "url": "https://example.com/vehicle-listing" }
 *   POST { "url": "...", "queue_id": "uuid", "save_to_db": true }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EXTRACTOR_VERSION = "extract-with-playwright:1.1.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Low confidence score for fallback extraction
const BASE_CONFIDENCE = 0.35;

interface ExtractedVehicle {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  mileage: number | null;
  price: number | null;
  exterior_color: string | null;
  interior_color: string | null;
  transmission: string | null;
  drivetrain: string | null;
  engine: string | null;
  body_style: string | null;
  location: string | null;
  description: string | null;
  image_urls: string[];
  confidence: number;
  extraction_method: string;
  fields_extracted: string[];
  fields_missing: string[];
}

// Common vehicle makes for matching
const COMMON_MAKES = [
  "Acura", "Alfa Romeo", "Aston Martin", "Audi", "Bentley", "BMW", "Buick",
  "Cadillac", "Chevrolet", "Chevy", "Chrysler", "Citro\u00ebn", "Datsun", "Dodge",
  "Ferrari", "Fiat", "Ford", "Genesis", "GMC", "Honda", "Hummer", "Hyundai",
  "Infiniti", "Isuzu", "Jaguar", "Jeep", "Kia", "Lamborghini", "Land Rover",
  "Lexus", "Lincoln", "Lotus", "Maserati", "Maybach", "Mazda", "McLaren",
  "Mercedes-Benz", "Mercedes", "Mercury", "Mini", "Mitsubishi", "Nissan",
  "Oldsmobile", "Opel", "Pagani", "Peugeot", "Plymouth", "Pontiac", "Porsche",
  "Ram", "Renault", "Rivian", "Rolls-Royce", "Saab", "Saturn", "Scion", "Shelby",
  "Smart", "Subaru", "Suzuki", "Tesla", "Toyota", "Triumph", "Volkswagen", "VW",
  "Volvo", "AMC", "American Motors", "Austin", "Austin-Healey", "DeLorean",
  "DeSoto", "Edsel", "Hudson", "International", "Kaiser", "Nash", "Packard",
  "Studebaker", "Willys", "Tucker"
];

// Common transmission types
const TRANSMISSION_PATTERNS = [
  /\b(automatic|auto)\b/i,
  /\b(manual)\b/i,
  /\b(\d[-\s]?speed)\s*(manual|auto|automatic)?\b/i,
  /\b(CVT|continuously\s*variable)\b/i,
  /\b(DCT|dual[-\s]?clutch)\b/i,
  /\b(PDK|Tiptronic|SMG|DSG)\b/i,
];

// Drivetrain patterns
const DRIVETRAIN_PATTERNS = [
  /\b(AWD|all[-\s]?wheel\s*drive)\b/i,
  /\b(4WD|4x4|four[-\s]?wheel\s*drive)\b/i,
  /\b(FWD|front[-\s]?wheel\s*drive)\b/i,
  /\b(RWD|rear[-\s]?wheel\s*drive)\b/i,
];

// Body style patterns
const BODY_STYLE_PATTERNS = [
  /\b(sedan)\b/i,
  /\b(coupe|coup\u00e9)\b/i,
  /\b(convertible|cabriolet|roadster|spyder|spider)\b/i,
  /\b(hatchback|liftback)\b/i,
  /\b(wagon|estate|touring|avant)\b/i,
  /\b(SUV|sport\s*utility)\b/i,
  /\b(crossover|CUV)\b/i,
  /\b(pickup|truck)\b/i,
  /\b(van|minivan)\b/i,
];

// Color patterns
const COLOR_WORDS = [
  "black", "white", "silver", "gray", "grey", "red", "blue", "green", "yellow",
  "orange", "brown", "beige", "tan", "gold", "burgundy", "maroon", "navy",
  "purple", "cream", "ivory", "bronze", "champagne", "pearl", "metallic",
  "matte", "satin", "midnight", "arctic", "alpine", "carbon", "graphite",
  "charcoal", "onyx", "obsidian", "pewter", "titanium", "platinum"
];

/**
 * Fetch page content using Firecrawl (handles JS rendering)
 */
async function fetchWithFirecrawl(url: string): Promise<{ html: string; markdown: string; screenshot?: string }> {
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!firecrawlKey) {
    console.error("[extract-with-playwright] FIRECRAWL_API_KEY not found in environment");
    throw new Error("FIRECRAWL_API_KEY not configured");
  }

  console.log(`[extract-with-playwright] Fetching via Firecrawl: ${url}`);
  console.log(`[extract-with-playwright] Firecrawl key present: ${firecrawlKey.slice(0, 8)}...`);

  const requestBody = {
    url,
    formats: ["html", "markdown"],
    onlyMainContent: false,
    waitFor: 5000, // Wait for JS to render
    timeout: 30000,
    actions: [
      { type: "wait", milliseconds: 3000 },
      { type: "scroll", direction: "down", amount: 500 },
    ],
  };

  console.log(`[extract-with-playwright] Request body: ${JSON.stringify(requestBody).slice(0, 300)}`);

  const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${firecrawlKey}`,
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(90000),
  });

  console.log(`[extract-with-playwright] Firecrawl response status: ${response.status}`);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[extract-with-playwright] Firecrawl error: ${errorText.slice(0, 500)}`);
    throw new Error(`Firecrawl failed: ${response.status} - ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  console.log(`[extract-with-playwright] Firecrawl success: ${data.success}`);

  if (!data.success) {
    console.error(`[extract-with-playwright] Firecrawl returned success=false: ${JSON.stringify(data).slice(0, 300)}`);
    throw new Error(`Firecrawl returned no data: ${JSON.stringify(data).slice(0, 200)}`);
  }

  const html = data.data?.html || "";
  const markdown = data.data?.markdown || "";

  console.log(`[extract-with-playwright] HTML length: ${html.length}, Markdown length: ${markdown.length}`);

  return {
    html,
    markdown,
    screenshot: undefined, // Not requesting screenshots to save bandwidth
  };
}

/**
 * Fallback: Direct fetch for simple pages
 */
async function fetchDirect(url: string): Promise<{ html: string; markdown: string }> {
  console.log(`[extract-with-playwright] Fallback direct fetch: ${url}`);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Direct fetch failed: ${response.status}`);
  }

  const html = await response.text();
  return { html, markdown: "" };
}

/**
 * Extract title from HTML
 */
function extractTitle(html: string, markdown: string): string | null {
  // Try OG title first
  const ogMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (ogMatch?.[1]) return cleanText(ogMatch[1]);

  // Try regular title tag
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch?.[1]) return cleanText(titleMatch[1]);

  // Try H1
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1Match?.[1]) return cleanText(h1Match[1]);

  // Try first heading from markdown
  const mdHeading = markdown.match(/^#\s+(.+)$/m);
  if (mdHeading?.[1]) return cleanText(mdHeading[1]);

  return null;
}

/**
 * Extract year (4-digit number between 1885 and current year + 1)
 */
function extractYear(text: string, title: string | null): number | null {
  const currentYear = new Date().getFullYear() + 1;
  const minYear = 1885; // First automobile

  // Try title first (most reliable)
  if (title) {
    const titleYearMatch = title.match(/\b(19\d{2}|20[0-2]\d)\b/);
    if (titleYearMatch) {
      const year = parseInt(titleYearMatch[1], 10);
      if (year >= minYear && year <= currentYear) return year;
    }
  }

  // Look for year patterns in specific contexts
  const yearPatterns = [
    /\byear[:\s]+(\d{4})\b/i,
    /\b(19\d{2}|20[0-2]\d)\s+(Acura|Alfa|Aston|Audi|Bentley|BMW|Buick|Cadillac|Chev|Chrysler|Dodge|Ferrari|Fiat|Ford|GMC|Honda|Hyundai|Infiniti|Jaguar|Jeep|Kia|Lamborghini|Land|Lexus|Lincoln|Lotus|Maserati|Mazda|McLaren|Mercedes|Mercury|Mini|Mitsubishi|Nissan|Oldsmobile|Plymouth|Pontiac|Porsche|Ram|Subaru|Tesla|Toyota|Volkswagen|VW|Volvo)\b/i,
    /\b(19\d{2}|20[0-2]\d)\s+[A-Z][a-z]+\s+[A-Z]/,
  ];

  for (const pattern of yearPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const year = parseInt(match[1], 10);
      if (year >= minYear && year <= currentYear) return year;
    }
  }

  // Generic 4-digit year (less reliable)
  const genericYears = text.match(/\b(19\d{2}|20[0-2]\d)\b/g);
  if (genericYears) {
    // Prefer years that look like vehicle years
    for (const y of genericYears) {
      const year = parseInt(y, 10);
      if (year >= 1950 && year <= currentYear) return year;
    }
  }

  return null;
}

/**
 * Extract make from text
 */
function extractMake(text: string, title: string | null): string | null {
  const searchText = `${title || ""} ${text}`.toLowerCase();

  // Sort by length descending to match longer makes first (e.g., "Land Rover" before "Land")
  const sortedMakes = [...COMMON_MAKES].sort((a, b) => b.length - a.length);

  for (const make of sortedMakes) {
    const pattern = new RegExp(`\\b${make.replace(/[-\s]/g, "[-\\s]?")}\\b`, "i");
    if (pattern.test(searchText)) {
      // Normalize some makes
      if (make.toLowerCase() === "chevy") return "Chevrolet";
      if (make.toLowerCase() === "vw") return "Volkswagen";
      if (make.toLowerCase() === "mercedes") return "Mercedes-Benz";
      return make;
    }
  }

  return null;
}

/**
 * Extract model from text (after year and make)
 */
function extractModel(text: string, title: string | null, year: number | null, make: string | null): string | null {
  if (!year || !make) return null;

  const searchText = title || text;
  const makePattern = make.replace(/[-\s]/g, "[-\\s]?");

  // Pattern: year make model
  const pattern = new RegExp(`\\b${year}\\s+${makePattern}\\s+([A-Za-z0-9][A-Za-z0-9\\s-]{1,30})`, "i");
  const match = searchText.match(pattern);

  if (match?.[1]) {
    // Clean up model name (remove common suffixes)
    let model = match[1].trim();
    model = model.replace(/\s+(for\s+sale|listing|auction|price|buy|sold).*$/i, "").trim();
    model = model.replace(/\s*[-|].*$/, "").trim();
    if (model.length >= 2 && model.length <= 40) return model;
  }

  return null;
}

/**
 * Extract VIN (17 alphanumeric characters, excluding I, O, Q)
 */
function extractVin(text: string): string | null {
  // Standard 17-char VIN
  const vinPatterns = [
    /\bVIN[:\s#]*([A-HJ-NPR-Z0-9]{17})\b/i,
    /\bVehicle\s*Identification[:\s]*([A-HJ-NPR-Z0-9]{17})\b/i,
    /\b([A-HJ-NPR-Z0-9]{17})\b/g, // Generic 17-char match
  ];

  for (const pattern of vinPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      // For the generic pattern, validate more strictly
      for (const match of Array.isArray(matches) ? matches : [matches[1]]) {
        const vin = (match || "").toUpperCase().trim();
        if (vin.length === 17 && isValidVin(vin)) {
          return vin;
        }
      }
    }
  }

  // Also check for shorter pre-1981 VINs (11-17 chars)
  const shortVinMatch = text.match(/\bVIN[:\s#]*([A-HJ-NPR-Z0-9]{11,17})\b/i);
  if (shortVinMatch?.[1]) {
    const vin = shortVinMatch[1].toUpperCase();
    if (vin.length >= 11 && !vin.includes("O") && !vin.includes("I") && !vin.includes("Q")) {
      return vin;
    }
  }

  return null;
}

/**
 * Basic VIN validation
 */
function isValidVin(vin: string): boolean {
  if (vin.length !== 17) return false;
  if (/[IOQ]/.test(vin)) return false;

  // Check for common false positives (all same char, sequential)
  if (/^(.)\1+$/.test(vin)) return false;
  if (/^0123456789/.test(vin)) return false;

  return true;
}

/**
 * Extract mileage
 */
function extractMileage(text: string): number | null {
  const mileagePatterns = [
    /\b(\d{1,3}(?:,\d{3})*|\d{1,7})\s*(?:miles?|mi\.?)\b/i,
    /\bmileage[:\s]*(\d{1,3}(?:,\d{3})*|\d{1,7})\b/i,
    /\bodometer[:\s]*(\d{1,3}(?:,\d{3})*|\d{1,7})\b/i,
    /\b(\d{1,3}(?:,\d{3})+)\s*(?:actual|indicated|showing)\s*miles?\b/i,
    /\b(\d+(?:\.\d+)?)\s*k\s*miles?\b/i, // 45k miles
  ];

  for (const pattern of mileagePatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      let mileage: number;

      // Handle "k miles" format
      if (/k\s*miles?/i.test(match[0])) {
        mileage = Math.round(parseFloat(match[1]) * 1000);
      } else {
        mileage = parseInt(match[1].replace(/,/g, ""), 10);
      }

      // Reasonable range for vehicle mileage
      if (mileage > 0 && mileage < 1000000) {
        return mileage;
      }
    }
  }

  return null;
}

/**
 * Extract price
 */
function extractPrice(text: string): number | null {
  // Skip "Call for Price" etc
  if (/call\s+(for\s+)?price/i.test(text)) return null;
  if (/price\s+on\s+request/i.test(text)) return null;

  const pricePatterns = [
    /\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\b/, // $XX,XXX.XX
    /\bprice[:\s]*\$?\s*(\d{1,3}(?:,\d{3})*)\b/i,
    /\basking[:\s]*\$?\s*(\d{1,3}(?:,\d{3})*)\b/i,
    /\b(?:buy\s+(?:it\s+)?now|sold\s+for|final\s+price)[:\s]*\$?\s*(\d{1,3}(?:,\d{3})*)\b/i,
    /\bUSD\s*(\d{1,3}(?:,\d{3})*)\b/i,
  ];

  for (const pattern of pricePatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const price = parseInt(match[1].replace(/,/g, ""), 10);
      // Reasonable price range for vehicles
      if (price >= 500 && price <= 50000000) {
        return price;
      }
    }
  }

  return null;
}

/**
 * Extract colors
 */
function extractColors(text: string): { exterior: string | null; interior: string | null } {
  let exterior: string | null = null;
  let interior: string | null = null;

  // Exterior color patterns
  const exteriorPatterns = [
    /\b(?:exterior|ext\.?|outside|body)\s*(?:color)?[:\s]+([A-Za-z][A-Za-z\s/-]{2,30})/i,
    /\bpainted?\s+(?:in\s+)?([A-Za-z][A-Za-z\s/-]{2,30})/i,
    /\bfinished\s+in\s+([A-Za-z][A-Za-z\s/-]{2,30})/i,
    /\b([A-Za-z]+\s*(?:metallic|pearl|matte|satin)?)\s+(?:exterior|paint|body)/i,
  ];

  for (const pattern of exteriorPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const color = cleanColorName(match[1]);
      if (color) {
        exterior = color;
        break;
      }
    }
  }

  // Interior color patterns
  const interiorPatterns = [
    /\b(?:interior|int\.?|inside)\s*(?:color)?[:\s]+([A-Za-z][A-Za-z\s/-]{2,30})/i,
    /\b([A-Za-z]+)\s*(?:leather|vinyl|cloth|fabric)\s*interior/i,
    /\bupholstery[:\s]+([A-Za-z][A-Za-z\s/-]{2,30})/i,
  ];

  for (const pattern of interiorPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const color = cleanColorName(match[1]);
      if (color) {
        interior = color;
        break;
      }
    }
  }

  return { exterior, interior };
}

/**
 * Clean and validate color name
 */
function cleanColorName(raw: string): string | null {
  const color = raw.trim().toLowerCase();

  // Check if any color word is present
  const hasColorWord = COLOR_WORDS.some(c => color.includes(c));
  if (!hasColorWord) return null;

  // Title case
  return color
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Extract transmission
 */
function extractTransmission(text: string): string | null {
  for (const pattern of TRANSMISSION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const trans = match[0].trim();
      // Normalize
      if (/automatic|auto/i.test(trans)) return "Automatic";
      if (/manual/i.test(trans)) return trans.replace(/manual/i, "Manual");
      if (/cvt/i.test(trans)) return "CVT";
      if (/dct|dual[-\s]?clutch/i.test(trans)) return "Dual-Clutch";
      return trans;
    }
  }
  return null;
}

/**
 * Extract drivetrain
 */
function extractDrivetrain(text: string): string | null {
  for (const pattern of DRIVETRAIN_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const drive = match[1].toUpperCase().replace(/\s+/g, "");
      if (drive.includes("ALL") || drive === "AWD") return "AWD";
      if (drive.includes("FOUR") || drive === "4WD" || drive === "4X4") return "4WD";
      if (drive.includes("FRONT") || drive === "FWD") return "FWD";
      if (drive.includes("REAR") || drive === "RWD") return "RWD";
    }
  }
  return null;
}

/**
 * Extract engine info
 */
function extractEngine(text: string): string | null {
  const enginePatterns = [
    /\b(\d+(?:\.\d+)?[-\s]?(?:liter|L|litre))\s*([A-Za-z0-9-]+)?/i,
    /\b([VI]\d{1,2})\b/i, // V6, V8, I4
    /\b(\d+(?:\.\d+)?L)\s*(turbo|turbocharged|supercharged|twin[-\s]?turbo)?/i,
    /\bengine[:\s]+([A-Za-z0-9\s.-]{5,50})/i,
  ];

  for (const pattern of enginePatterns) {
    const match = text.match(pattern);
    if (match) {
      const engine = match[0].trim();
      if (engine.length >= 2 && engine.length <= 60) {
        return engine;
      }
    }
  }

  return null;
}

/**
 * Extract body style
 */
function extractBodyStyle(text: string): string | null {
  for (const pattern of BODY_STYLE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const style = match[1].toLowerCase();
      if (style === "coupe" || style === "coup\u00e9") return "Coupe";
      if (style.includes("convert") || style.includes("cabriolet") ||
          style.includes("roadster") || style.includes("spyder") || style.includes("spider")) {
        return "Convertible";
      }
      if (style.includes("wagon") || style.includes("estate") ||
          style.includes("touring") || style.includes("avant")) {
        return "Wagon";
      }
      if (style === "suv" || style.includes("sport utility")) return "SUV";
      if (style.includes("crossover") || style === "cuv") return "Crossover";
      if (style.includes("pickup") || style === "truck") return "Truck";
      if (style.includes("van")) return "Van";
      if (style.includes("hatch")) return "Hatchback";
      return style.charAt(0).toUpperCase() + style.slice(1);
    }
  }
  return null;
}

/**
 * Extract location
 */
function extractLocation(text: string): string | null {
  const locationPatterns = [
    /\blocation[:\s]+([A-Za-z][A-Za-z\s,.-]{5,60})/i,
    /\blocated\s+(?:in|at)[:\s]+([A-Za-z][A-Za-z\s,.-]{5,60})/i,
    /\b([A-Z][a-z]+(?:,\s*[A-Z]{2}))\b/, // City, ST format
    /\b([A-Z][a-z]+,\s*[A-Z][a-z]+)\b/, // City, State format
  ];

  for (const pattern of locationPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const loc = match[1].trim();
      if (loc.length >= 3 && loc.length <= 60) {
        return loc;
      }
    }
  }

  return null;
}

/**
 * Extract description
 */
function extractDescription(html: string, markdown: string): string | null {
  // Try OG description
  const ogMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
  if (ogMatch?.[1] && ogMatch[1].length >= 40) {
    return cleanText(ogMatch[1]).slice(0, 2000);
  }

  // Try meta description
  const metaMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  if (metaMatch?.[1] && metaMatch[1].length >= 40) {
    return cleanText(metaMatch[1]).slice(0, 2000);
  }

  // Use markdown excerpt if available
  if (markdown && markdown.length > 100) {
    // Remove headers and clean up
    const cleaned = markdown
      .replace(/^#+\s+.+$/gm, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();

    if (cleaned.length >= 50) {
      return cleaned.slice(0, 2000);
    }
  }

  return null;
}

/**
 * Extract image URLs
 */
function extractImages(html: string): string[] {
  const images: Set<string> = new Set();

  // OG image
  const ogMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
  if (ogMatch?.[1] && isValidImageUrl(ogMatch[1])) {
    images.add(ogMatch[1]);
  }

  // Image tags
  const imgMatches = html.matchAll(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi);
  for (const match of imgMatches) {
    if (match[1] && isValidImageUrl(match[1])) {
      images.add(match[1]);
    }
  }

  // srcset images
  const srcsetMatches = html.matchAll(/srcset=["']([^"']+)["']/gi);
  for (const match of srcsetMatches) {
    const urls = match[1].split(",").map(s => s.trim().split(" ")[0]);
    for (const url of urls) {
      if (url && isValidImageUrl(url)) {
        images.add(url);
      }
    }
  }

  // Background images in style
  const bgMatches = html.matchAll(/background(?:-image)?:\s*url\(['"]?([^'")\s]+)['"]?\)/gi);
  for (const match of bgMatches) {
    if (match[1] && isValidImageUrl(match[1])) {
      images.add(match[1]);
    }
  }

  // Filter and return
  return Array.from(images)
    .filter(url => {
      // Skip tiny images, icons, logos
      if (/icon|logo|sprite|favicon|pixel|tracking|badge|button/i.test(url)) return false;
      // Skip SVGs (usually not photos)
      if (/\.svg(\?|$)/i.test(url)) return false;
      return true;
    })
    .slice(0, 50);
}

/**
 * Validate image URL
 */
function isValidImageUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith("data:")) return false;
  if (!/\.(jpg|jpeg|png|webp|gif)/i.test(url) && !url.includes("/image")) return false;
  return url.startsWith("http://") || url.startsWith("https://") || url.startsWith("//");
}

/**
 * Clean text
 */
function cleanText(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Calculate confidence score based on extracted fields
 */
function calculateConfidence(extracted: Partial<ExtractedVehicle>): number {
  let confidence = BASE_CONFIDENCE;

  // Core fields boost confidence
  if (extracted.year) confidence += 0.1;
  if (extracted.make) confidence += 0.1;
  if (extracted.model) confidence += 0.08;
  if (extracted.vin) confidence += 0.15; // VIN is high value
  if (extracted.price) confidence += 0.08;
  if (extracted.mileage) confidence += 0.06;

  // Additional fields provide smaller boosts
  if (extracted.exterior_color) confidence += 0.03;
  if (extracted.interior_color) confidence += 0.02;
  if (extracted.transmission) confidence += 0.03;
  if (extracted.drivetrain) confidence += 0.02;
  if (extracted.engine) confidence += 0.02;
  if (extracted.location) confidence += 0.02;
  if ((extracted.image_urls?.length || 0) > 0) confidence += 0.04;

  return Math.min(0.85, confidence); // Cap at 85% for fallback extractor
}

/**
 * Main extraction function
 */
async function extractVehicleData(url: string): Promise<ExtractedVehicle> {
  let html = "";
  let markdown = "";
  let screenshot: string | undefined;
  let extractionMethod = "firecrawl";

  // Try Firecrawl first (handles JS), fallback to direct fetch
  try {
    const result = await fetchWithFirecrawl(url);
    html = result.html;
    markdown = result.markdown;
    screenshot = result.screenshot;
  } catch (firecrawlError) {
    console.error(`[extract-with-playwright] Firecrawl failed: ${firecrawlError}`);
    try {
      const result = await fetchDirect(url);
      html = result.html;
      markdown = result.markdown;
      extractionMethod = "direct_fetch";
    } catch (directError) {
      throw new Error(`Both Firecrawl and direct fetch failed: ${directError}`);
    }
  }

  // Combine HTML and markdown for text search
  const bodyText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const searchText = `${bodyText} ${markdown}`;

  // Extract all fields
  const title = extractTitle(html, markdown);
  const year = extractYear(searchText, title);
  const make = extractMake(searchText, title);
  const model = extractModel(searchText, title, year, make);
  const vin = extractVin(searchText);
  const mileage = extractMileage(searchText);
  const price = extractPrice(searchText);
  const colors = extractColors(searchText);
  const transmission = extractTransmission(searchText);
  const drivetrain = extractDrivetrain(searchText);
  const engine = extractEngine(searchText);
  const bodyStyle = extractBodyStyle(searchText);
  const location = extractLocation(searchText);
  const description = extractDescription(html, markdown);
  const imageUrls = extractImages(html);

  // Track what we extracted vs missed
  const allFields = ["year", "make", "model", "vin", "mileage", "price",
                     "exterior_color", "interior_color", "transmission",
                     "drivetrain", "engine", "body_style", "location"];

  const extracted: Partial<ExtractedVehicle> = {
    url,
    title,
    year,
    make,
    model,
    vin,
    mileage,
    price,
    exterior_color: colors.exterior,
    interior_color: colors.interior,
    transmission,
    drivetrain,
    engine,
    body_style: bodyStyle,
    location,
    description,
    image_urls: imageUrls,
  };

  const fieldsExtracted = allFields.filter(f => (extracted as any)[f] !== null && (extracted as any)[f] !== undefined);
  const fieldsMissing = allFields.filter(f => (extracted as any)[f] === null || (extracted as any)[f] === undefined);

  const confidence = calculateConfidence(extracted);

  // Log extraction results
  console.log(`[extract-with-playwright] Extracted ${fieldsExtracted.length}/${allFields.length} fields`);
  console.log(`[extract-with-playwright] Fields: ${fieldsExtracted.join(", ")}`);
  console.log(`[extract-with-playwright] Missing: ${fieldsMissing.join(", ")}`);
  console.log(`[extract-with-playwright] Confidence: ${(confidence * 100).toFixed(1)}%`);

  return {
    ...extracted,
    confidence,
    extraction_method: extractionMethod,
    fields_extracted: fieldsExtracted,
    fields_missing: fieldsMissing,
  } as ExtractedVehicle;
}

/**
 * Save to database
 */
async function saveToDatabase(
  supabase: any,
  queueId: string | null,
  extracted: ExtractedVehicle
): Promise<{ vehicleId: string | null; success: boolean; error?: string }> {
  try {
    // Create vehicle record
    const vehicleData: any = {
      listing_url: extracted.url,
      discovery_url: extracted.url,
      listing_source: new URL(extracted.url).hostname,
      title: extracted.title,
      year: extracted.year,
      make: extracted.make,
      model: extracted.model,
      vin: extracted.vin,
      vin_source: extracted.vin ? "playwright_fallback" : null,
      vin_confidence: extracted.vin ? Math.round(extracted.confidence * 100) : null,
      mileage: extracted.mileage,
      asking_price: extracted.price,
      exterior_color: extracted.exterior_color,
      interior_color: extracted.interior_color,
      transmission: extracted.transmission,
      drivetrain: extracted.drivetrain,
      engine: extracted.engine,
      body_style: extracted.body_style,
      description: extracted.description?.slice(0, 5000),
      primary_image_url: extracted.image_urls[0] || null,
      status: "pending",
      is_public: false,
      profile_origin: "playwright_fallback",
      platform_source: "fallback_extraction",
      origin_metadata: {
        extractor_version: EXTRACTOR_VERSION,
        confidence: extracted.confidence,
        extraction_method: extracted.extraction_method,
        fields_extracted: extracted.fields_extracted,
        fields_missing: extracted.fields_missing,
        image_count: extracted.image_urls.length,
        extracted_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    };

    // Check if vehicle already exists by URL
    const { data: existing } = await supabase
      .from("vehicles")
      .select("id")
      .eq("discovery_url", extracted.url)
      .maybeSingle();

    let vehicleId: string;

    if (existing?.id) {
      vehicleId = existing.id;
      await supabase.from("vehicles").update(vehicleData).eq("id", vehicleId);
      console.log(`[extract-with-playwright] Updated existing vehicle: ${vehicleId}`);
    } else {
      const { data: created, error: createError } = await supabase
        .from("vehicles")
        .insert({
          ...vehicleData,
          import_queue_id: queueId,
        })
        .select("id")
        .single();

      if (createError) {
        throw new Error(`Vehicle insert failed: ${createError.message}`);
      }

      vehicleId = created.id;
      console.log(`[extract-with-playwright] Created new vehicle: ${vehicleId}`);
    }

    // Insert images
    if (extracted.image_urls.length > 0) {
      const imageRecords = extracted.image_urls.slice(0, 50).map((url, idx) => ({
        vehicle_id: vehicleId,
        image_url: url,
        source_url: extracted.url,
        is_external: true,
        source: "playwright_fallback",
        is_primary: idx === 0,
        position: idx,
        display_order: idx,
        approval_status: "pending",
        is_approved: false,
        created_at: new Date().toISOString(),
      }));

      // Upsert to avoid duplicates
      await supabase
        .from("vehicle_images")
        .upsert(imageRecords, { onConflict: "vehicle_id,image_url", ignoreDuplicates: true });
    }

    // Update import_queue if queueId provided
    if (queueId) {
      await supabase.from("import_queue").update({
        status: "complete",
        vehicle_id: vehicleId,
        processed_at: new Date().toISOString(),
        error_message: null,
        locked_at: null,
        locked_by: null,
        raw_data: {
          playwright_fallback: {
            confidence: extracted.confidence,
            fields_extracted: extracted.fields_extracted,
            fields_missing: extracted.fields_missing,
            extraction_method: extracted.extraction_method,
            processed_at: new Date().toISOString(),
          },
        },
      }).eq("id", queueId);
    }

    return { vehicleId, success: true };
  } catch (error: any) {
    console.error(`[extract-with-playwright] Database save error: ${error.message}`);

    // Mark queue item as failed if queueId provided
    if (queueId) {
      await supabase.from("import_queue").update({
        status: "failed",
        error_message: `Playwright fallback save failed: ${error.message}`,
        locked_at: null,
        locked_by: null,
      }).eq("id", queueId);
    }

    return { vehicleId: null, success: false, error: error.message };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { url, queue_id, save_to_db = false } = body;

    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: "URL is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[extract-with-playwright] Processing: ${url}`);
    console.log(`[extract-with-playwright] Queue ID: ${queue_id || "none"}`);
    console.log(`[extract-with-playwright] Save to DB: ${save_to_db}`);

    // Extract vehicle data
    const extracted = await extractVehicleData(url);

    let dbResult: { vehicleId: string | null; success: boolean; error?: string } | null = null;

    // Save to database if requested
    if (save_to_db) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );

      dbResult = await saveToDatabase(supabase, queue_id || null, extracted);
    }

    return new Response(
      JSON.stringify({
        success: true,
        extracted,
        database: dbResult,
        extractor_version: EXTRACTOR_VERSION,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error(`[extract-with-playwright] Error: ${error.message}`);

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
