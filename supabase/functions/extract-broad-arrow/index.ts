/**
 * BROAD ARROW AUCTIONS EXTRACTOR
 *
 * Firecrawl-based extractor for broadarrowauctions.com lot pages.
 * Replaces the previous Playwright-based approach that was crashing on 400+ items.
 *
 * Broad Arrow (a Hagerty company) runs live auctions at major events:
 *   - Amelia Island, Monterey, Greenwich, etc.
 *
 * Page structure: Next.js rendered pages with structured lot info.
 * Firecrawl handles JS rendering and returns clean markdown + HTML.
 *
 * Data extracted from markdown (deterministic regex, no AI needed):
 *   - Title, year, make, model from heading
 *   - VIN/chassis from specs section
 *   - Sold price, estimate range
 *   - Lot number, auction name, status
 *   - Engine, transmission, mileage from description
 *   - Exterior/interior color
 *   - Images from HTML img tags
 *   - Full description text
 *
 * Actions:
 *   POST { "url": "..." }                              -- Extract single URL
 *   POST { "url": "...", "save_to_db": true }          -- Extract and persist
 *   POST { "action": "batch_from_queue", "limit": 20 } -- Process queue items
 *   POST { "action": "stats" }                         -- Queue stats
 *
 * Deploy: supabase functions deploy extract-broad-arrow --no-verify-jwt
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { firecrawlScrape } from '../_shared/firecrawl.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { normalizeListingUrlKey } from '../_shared/listingUrl.ts';
import { resolveExistingVehicleId, discoveryUrlIlikePattern } from '../_shared/resolveVehicleForListing.ts';
import { writeObservation } from "../_shared/observationWriter.ts";
import { requireWriteAuth } from '../_shared/writeGuard.ts';
import { projectSecretKey } from "../_shared/supabaseKeys.ts";
import { mustWrite, softWrite } from '../_shared/writeResult.ts';
import { writeVehicleEventByKey } from '../_shared/vehicleEventWrite.ts';
import { archiveFetch } from '../_shared/archiveFetch.ts';
import { fillOnlyIdentity, identityConflict } from '../_shared/identityMatch.ts';
import { recordRevision } from '../_shared/revision.ts';
import { parseEventPage, parseListingCards, type RosterCard } from './roster.ts';
import { parseLotPage } from './lotPage.ts';

// ============================================================================
// TYPES
// ============================================================================

interface BroadArrowExtracted {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  chassis_number: string | null;

  // Pricing
  estimate_low: number | null;
  estimate_high: number | null;
  sale_price: number | null;
  sold_price_text: string | null;

  // Auction metadata
  lot_number: string | null;
  auction_name: string | null;
  auction_date: string | null;
  auction_status: 'sold' | 'not_sold' | 'upcoming' | 'withdrawn' | null;

  // Vehicle specs
  mileage: number | null;
  engine: string | null;
  transmission: string | null;
  drivetrain: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  body_style: string | null;

  // Content
  description: string | null;

  // Images
  image_urls: string[];

  // Meta
  vehicle_id?: string;
  scrape_ms: number;
  /** Calendar keys merged into the episode's metadata (the roster action). */
  extra_metadata?: Record<string, unknown>;
}

// ============================================================================
// HELPERS
// ============================================================================

function okJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ============================================================================
// KNOWN MAKES (for title parsing)
// ============================================================================

const KNOWN_MAKES = [
  'Alfa Romeo', 'Aston Martin', 'Austin-Healey', 'Mercedes-Benz', 'Rolls-Royce',
  'Land Rover', 'De Tomaso', 'Facel Vega', 'Hispano-Suiza',
  'Porsche', 'Ferrari', 'Lamborghini', 'Bugatti', 'McLaren', 'Maserati',
  'Bentley', 'Jaguar', 'BMW', 'Audi', 'Ford', 'Chevrolet', 'Dodge',
  'Plymouth', 'Pontiac', 'Cadillac', 'Lincoln', 'Chrysler', 'Shelby',
  'AC', 'AMC', 'Buick', 'DeLorean', 'DeSoto', 'Duesenberg',
  'Packard', 'Pierce-Arrow', 'Stutz', 'Cord', 'Auburn', 'Tucker',
  'Toyota', 'Honda', 'Nissan', 'Datsun', 'Mazda', 'Subaru', 'Mitsubishi',
  'Volkswagen', 'Volvo', 'Saab', 'Fiat', 'Lancia', 'Lotus',
  'Triumph', 'MG', 'Mini', 'Morgan', 'TVR', 'Sunbeam',
  'Oldsmobile', 'Mercury', 'Jeep', 'GMC', 'Ram', 'International',
  'Iso', 'Bizzarrini', 'Lola', 'March', 'Cooper',
  'Harley-Davidson', 'Indian', 'Vincent', 'Norton', 'BSA', 'Brough Superior',
];

// ============================================================================
// TITLE PARSER
// ============================================================================

function parseTitle(title: string): {
  year: number | null;
  make: string | null;
  model: string | null;
} {
  if (!title) return { year: null, make: null, model: null };

  // Clean up title
  const cleaned = title.replace(/\s+/g, ' ').trim();

  // Extract year (4 digits starting with 19 or 20)
  const yearMatch = cleaned.match(/\b(19\d{2}|20\d{2})\b/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

  if (!year) return { year: null, make: null, model: null };

  // Get the part after the year
  const yearIdx = cleaned.indexOf(yearMatch![0]);
  const afterYear = cleaned.slice(yearIdx + yearMatch![0].length).trim();

  if (!afterYear) return { year, make: null, model: null };

  // Try known multi-word makes first
  for (const knownMake of KNOWN_MAKES) {
    if (afterYear.toLowerCase().startsWith(knownMake.toLowerCase())) {
      const model = afterYear.slice(knownMake.length).trim() || null;
      return { year, make: knownMake, model };
    }
  }

  // Fall back to first word as make
  const parts = afterYear.split(/\s+/);
  const make = titleCase(parts[0]);
  const model = parts.slice(1).join(' ') || null;

  return { year, make, model };
}

// ============================================================================
// VIN EXTRACTION
// ============================================================================

const VIN_17_PATTERN = /\b([A-HJ-NPR-Z0-9]{17})\b/g;

const CHASSIS_PATTERNS = [
  /(?:chassis|vin|serial)\s*(?:number|no\.?|#)?\s*:?\s*([A-Z0-9\-\/]{5,20})/i,
  /(?:chassis|vin|serial)\s+([A-Z0-9\-\/]{5,20})/i,
  /VIN:\s*([A-HJ-NPR-Z0-9]{17})/i,
];

function extractVinAndChassis(text: string): { vin: string | null; chassis: string | null } {
  let vin: string | null = null;
  let chassis: string | null = null;

  // Try 17-char VIN first
  VIN_17_PATTERN.lastIndex = 0;
  const vinMatches = text.match(VIN_17_PATTERN);
  if (vinMatches && vinMatches.length > 0) {
    // Validate it looks like a real VIN (not a random 17-char string)
    const candidate = vinMatches[0];
    if (/[A-Z]/.test(candidate) && /\d/.test(candidate)) {
      vin = candidate;
    }
  }

  // Try chassis/serial patterns
  for (const pattern of CHASSIS_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const candidate = match[1].trim();
      if (candidate.length >= 5 && candidate.length <= 20) {
        // If this is a 17-char VIN, set as vin
        if (candidate.length === 17 && /^[A-HJ-NPR-Z0-9]+$/.test(candidate)) {
          vin = candidate;
        } else {
          chassis = candidate;
        }
        break;
      }
    }
  }

  return { vin, chassis };
}

// ============================================================================
// MARKDOWN PARSER (main extraction logic)
// ============================================================================

export function parseFromMarkdown(markdown: string, html: string, url: string): BroadArrowExtracted {
  const result: BroadArrowExtracted = {
    url,
    title: null,
    year: null,
    make: null,
    model: null,
    vin: null,
    chassis_number: null,
    estimate_low: null,
    estimate_high: null,
    sale_price: null,
    sold_price_text: null,
    lot_number: null,
    auction_name: null,
    auction_date: null,
    auction_status: null,
    mileage: null,
    engine: null,
    transmission: null,
    drivetrain: null,
    exterior_color: null,
    interior_color: null,
    body_style: null,
    description: null,
    image_urls: [],
    scrape_ms: 0,
  };

  // Combine markdown and stripped HTML for searching
  const combinedText = markdown + '\n' + (html || '').replace(/<[^>]+>/g, ' ').replace(/&#39;|&#x27;|&apos;/gi, "'");

  // --- TITLE ---
  // Broad Arrow titles appear as h1 or prominent heading: "1955 Mercedes-Benz 300 SL Gullwing"
  // In markdown: "# 1955 Mercedes-Benz 300 SL Gullwing" or "## Lot 123 - 1955 Mercedes-Benz..."
  const titlePatterns = [
    /^#\s+(?:Lot\s+\d+\s*[-–—]\s*)?(\d{4}\s+[^\n]+)/m,
    /^##\s+(?:Lot\s+\d+\s*[-–—]\s*)?(\d{4}\s+[^\n]+)/m,
    /^###\s+(?:Lot\s+\d+\s*[-–—]\s*)?(\d{4}\s+[^\n]+)/m,
    // Title might be in bold
    /\*\*(\d{4}\s+[A-Z][^\*\n]+)\*\*/m,
  ];

  for (const pattern of titlePatterns) {
    const match = markdown.match(pattern);
    if (match && match[1]) {
      result.title = match[1].trim()
        .replace(/\s*\|.*$/, '') // Remove trailing pipe separators
        .replace(/\s*[-–—]\s*Broad Arrow.*$/i, ''); // Remove "- Broad Arrow" suffix
      break;
    }
  }

  // Also try extracting from HTML title tag
  if (!result.title) {
    const htmlTitleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (htmlTitleMatch) {
      const rawTitle = htmlTitleMatch[1].trim();
      // Clean "Lot 123 - 1955 Mercedes ... | Broad Arrow Auctions"
      const cleaned = rawTitle
        .replace(/\s*\|.*$/, '')
        .replace(/\s*[-–—]\s*Broad Arrow.*$/i, '')
        .replace(/^Lot\s+\d+\s*[-–—]\s*/i, '')
        .trim();
      const yearCheck = cleaned.match(/\b(19|20)\d{2}\b/);
      if (yearCheck) {
        result.title = cleaned;
      }
    }
  }

  // Parse year/make/model from title
  if (result.title) {
    const parsed = parseTitle(result.title);
    result.year = parsed.year;
    result.make = parsed.make;
    result.model = parsed.model;
  }

  // --- URL FALLBACK for year/make/model ---
  // Broad Arrow URLs: /vehicles/gi25/1955-mercedes-benz-300-sl-gullwing
  if (!result.year) {
    const urlSlug = url.match(/\/(\d{4})-([a-z0-9-]+)\/?(?:\?|#|$)/i);
    if (urlSlug) {
      result.year = parseInt(urlSlug[1], 10);
      if (!result.make) {
        const slugParts = urlSlug[2].split('-');
        result.make = titleCase(slugParts[0]);
        if (slugParts.length > 1) {
          result.model = slugParts.slice(1).map(titleCase).join(' ');
        }
      }
    }
  }

  // --- VIN / CHASSIS ---
  const vinData = extractVinAndChassis(combinedText);
  result.vin = vinData.vin;
  result.chassis_number = vinData.chassis;

  // --- SALE PRICE ---
  // Patterns: "Sold for $1,234,567", "Hammer Price: $1,234,567", "Sale Price $1,234,567"
  // Also: "$1,234,567 USD Sold" or "Result: $1,234,567"
  const pricePatterns = [
    /Sold\s+(?:for|@|at)\s+\$?([\d,]+)/i,
    /(?:Hammer|Sale|Winning|Final)\s+(?:Price|Bid)[:\s]*\$?([\d,]+)/i,
    /Result[:\s]*\$?([\d,]+)/i,
    /\$([\d,]+)\s*(?:USD\s+)?(?:Sold|Hammer)/i,
    /Sold[:\s]*\$([\d,]+)/i,
    /(?:Price\s+Realized|Realized)[:\s]*\$?([\d,]+)/i,
  ];

  for (const pattern of pricePatterns) {
    const match = combinedText.match(pattern);
    if (match && match[1]) {
      const price = parseInt(match[1].replace(/,/g, ''), 10);
      if (price >= 100 && price < 100_000_000) {
        result.sale_price = price;
        result.sold_price_text = match[0].trim();
        result.auction_status = 'sold';
        break;
      }
    }
  }

  // --- ESTIMATE ---
  // "Estimate: $800,000 - $1,000,000" or "Est. $800,000-$1,000,000"
  // Zurich lots read "Estimate: CHF 210'000 - CHF 255'000" (apostrophe thousands, currency before each amount).
  const estimatePatterns = [
    /Estimate[:\s]*(?:CHF\s*|[$€£])?([\d,'’]+)\s*[-–—]\s*(?:CHF\s*|[$€£])?([\d,'’]+)/i,
    /Est\.?\s*(?:CHF\s*|[$€£])?([\d,'’]+)\s*[-–—]\s*(?:CHF\s*|[$€£])?([\d,'’]+)/i,
    /\$?([\d,'’]+)\s*[-–—]\s*\$?([\d,'’]+)\s*(?:USD\s+)?(?:Estimate|Est\.?)/i,
  ];

  for (const pattern of estimatePatterns) {
    const match = combinedText.match(pattern);
    if (match) {
      const low = parseInt(match[1].replace(/[,'’]/g, ''), 10);
      const high = parseInt(match[2].replace(/[,'’]/g, ''), 10);
      if (low >= 100 && high >= low && high < 100_000_000) {
        result.estimate_low = low;
        result.estimate_high = high;
        break;
      }
    }
  }

  // --- LOT NUMBER ---
  const lotPatterns = [
    /Lot\s+#?\s*(\d+)/i,
    /^LOT\s+(\d+)/m,
    /"lot(?:Number)?"[:\s]*"?(\d+)"?/i,
  ];

  for (const pattern of lotPatterns) {
    const match = combinedText.match(pattern);
    if (match && match[1]) {
      result.lot_number = match[1];
      break;
    }
  }

  // Also try URL: /vehicles/gi25/lot-123 or similar
  if (!result.lot_number) {
    const urlLotMatch = url.match(/lot[_-]?(\d+)/i);
    if (urlLotMatch) {
      result.lot_number = urlLotMatch[1];
    }
  }

  // --- AUCTION NAME / DATE ---
  // Extract auction code from URL: /vehicles/gi25/ = Greenwich 2025, am25 = Amelia 2025
  const auctionCodeMatch = url.match(/\/vehicles\/([a-z]{2}\d{2})\//i);
  if (auctionCodeMatch) {
    const code = auctionCodeMatch[1].toLowerCase();
    const yearSuffix = code.slice(2);
    const fullYear = parseInt(yearSuffix, 10) < 50 ? `20${yearSuffix}` : `19${yearSuffix}`;

    const auctionMap: Record<string, string> = {
      'am': 'Amelia Island',
      'gi': 'Greenwich',
      've': 'Velocity',
      'mo': 'Monterey',
      'sc': 'Scottsdale',
      'pa': 'Palm Beach',
      'ny': 'New York',
    };

    const prefix = code.slice(0, 2);
    if (auctionMap[prefix]) {
      result.auction_name = `Broad Arrow ${auctionMap[prefix]} ${fullYear}`;
    } else {
      result.auction_name = `Broad Arrow ${code.toUpperCase()}`;
    }
  }

  // Try extracting auction name from page content
  if (!result.auction_name) {
    const auctionNameMatch = combinedText.match(/(?:Auction|Sale)[:\s]*(Amelia Island|Greenwich|Monterey|Scottsdale|Palm Beach|Velocity|New York)[^\n]*/i);
    if (auctionNameMatch) {
      result.auction_name = `Broad Arrow ${auctionNameMatch[1]}`;
    }
  }

  // Extract auction date from page
  const datePatterns = [
    /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i,
    /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i,
  ];

  for (const pattern of datePatterns) {
    const match = combinedText.match(pattern);
    if (match) {
      try {
        const dateStr = match[0];
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) {
          result.auction_date = parsed.toISOString().split('T')[0];
          break;
        }
      } catch { /* ignore */ }
    }
  }

  // --- AUCTION STATUS ---
  if (!result.auction_status) {
    const textLower = combinedText.toLowerCase();
    if (textLower.includes('sold for') || textLower.includes('hammer price') || textLower.includes('winning bid')) {
      result.auction_status = 'sold';
    } else if (textLower.includes('not sold') || textLower.includes('no sale') || textLower.includes('passed') || textLower.includes('reserve not met')) {
      result.auction_status = 'not_sold';
    } else if (textLower.includes('withdrawn')) {
      result.auction_status = 'withdrawn';
    } else if (textLower.includes('upcoming') || textLower.includes('coming soon') || textLower.includes('place bid')) {
      result.auction_status = 'upcoming';
    }
  }

  // --- MILEAGE ---
  const mileagePatterns = [
    /(\d{1,3}(?:,\d{3})*)\s*(?:miles|mi\b)/i,
    /(?:Mileage|Odometer)[:\s]*(\d{1,3}(?:,\d{3})*)/i,
    /(\d{1,3}(?:,\d{3})*)\s*(?:km|kilometers)/i,
  ];

  for (const pattern of mileagePatterns) {
    const match = combinedText.match(pattern);
    if (match && match[1]) {
      const miles = parseInt(match[1].replace(/,/g, ''), 10);
      if (miles > 0 && miles < 10_000_000) {
        result.mileage = miles;
        break;
      }
    }
  }

  // --- ENGINE ---
  const enginePatterns = [
    /(?:Engine|Motor|Powertrain)[:\s]*([^\n]{10,120})/i,
    /(\d+(?:\.\d+)?[- ]?(?:liter|litre|L|cc)\s+[^\n]{5,80})/i,
    /((?:inline|straight|flat|V|W)[- ]?\d+[^\n]{0,80})/i,
  ];

  for (const pattern of enginePatterns) {
    const match = combinedText.match(pattern);
    if (match && match[1]) {
      result.engine = match[1].trim().slice(0, 150);
      break;
    }
  }

  // --- TRANSMISSION ---
  const transPatterns = [
    /(?:Transmission|Gearbox|Trans)[:\s]*([^\n]{5,80})/i,
    /(\d+[- ]speed\s+(?:manual|automatic|sequential|PDK|DSG|dual[- ]clutch|DCT|SMG|tiptronic|CVT)[^\n]{0,40})/i,
    /((?:manual|automatic|sequential|PDK|DSG|dual[- ]clutch|DCT|tiptronic|CVT)\s+(?:transmission|gearbox)?)/i,
  ];

  for (const pattern of transPatterns) {
    const match = combinedText.match(pattern);
    if (match && match[1]) {
      result.transmission = match[1].trim().slice(0, 80);
      break;
    }
  }

  // --- DRIVETRAIN ---
  const driveMatch = combinedText.match(/\b(RWD|FWD|AWD|4WD|rear[- ]wheel[- ]drive|front[- ]wheel[- ]drive|all[- ]wheel[- ]drive|four[- ]wheel[- ]drive)\b/i);
  if (driveMatch) {
    const raw = driveMatch[1].toLowerCase();
    if (raw.includes('rear') || raw === 'rwd') result.drivetrain = 'RWD';
    else if (raw.includes('front') || raw === 'fwd') result.drivetrain = 'FWD';
    else if (raw.includes('all') || raw === 'awd') result.drivetrain = 'AWD';
    else if (raw.includes('four') || raw === '4wd') result.drivetrain = '4WD';
  }

  // --- EXTERIOR COLOR ---
  const extColorPatterns = [
    /(?:Exterior|Color|Colour|Paint|Finish)[:\s]*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?(?:\s+(?:Metallic|Pearl|Matte|Satin))?)/i,
    /(?:finished|painted)\s+in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
  ];

  for (const pattern of extColorPatterns) {
    const match = combinedText.match(pattern);
    if (match && match[1]) {
      const color = match[1].trim();
      // Filter out false positives (common words that aren't colors)
      if (!['Available', 'Original', 'Restored', 'Complete', 'Recent', 'Current'].includes(color)) {
        result.exterior_color = color;
        break;
      }
    }
  }

  // --- INTERIOR COLOR ---
  const intColorPatterns = [
    /(?:Interior)[:\s]*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*(?:leather|vinyl|cloth|fabric|alcantara|suede)?/i,
    /([A-Z][a-z]+)\s+(?:leather|vinyl|cloth|fabric|alcantara)\s+interior/i,
  ];

  for (const pattern of intColorPatterns) {
    const match = combinedText.match(pattern);
    if (match && match[1]) {
      result.interior_color = match[1].trim();
      break;
    }
  }

  // --- BODY STYLE ---
  const textLower = combinedText.toLowerCase();
  if (textLower.includes('coupe') || textLower.includes('coup\u00e9')) result.body_style = 'Coupe';
  else if (textLower.includes('convertible') || textLower.includes('cabriolet') || textLower.includes('roadster') || textLower.includes('spider') || textLower.includes('spyder') || textLower.includes('drop head') || textLower.includes('drophead')) result.body_style = 'Convertible';
  else if (textLower.includes('sedan') || textLower.includes('saloon') || textLower.includes('limousine')) result.body_style = 'Sedan';
  else if (textLower.includes('wagon') || textLower.includes('estate') || textLower.includes('shooting brake')) result.body_style = 'Wagon';
  else if (textLower.includes('suv') || textLower.includes('sport utility')) result.body_style = 'SUV';
  else if (textLower.includes('pickup') || textLower.includes('truck')) result.body_style = 'Truck';
  else if (textLower.includes('targa')) result.body_style = 'Targa';
  else if (textLower.includes('speedster')) result.body_style = 'Speedster';
  else if (textLower.includes('hatchback')) result.body_style = 'Hatchback';

  // --- DESCRIPTION ---
  // Try to extract the main description block from markdown
  // Look for a paragraph that's at least 100 chars and talks about the car
  const descPatterns = [
    /(?:Description|About|Details|Overview|Highlights)[:\s]*\n([\s\S]{100,}?)(?=\n##|\n---|\n\*\*|\n\n\n|$)/i,
    /(?:^|\n)((?:This|The|A|An|Offered|Presented|Featured)\s+\d{4}\s[\s\S]{100,}?)(?=\n##|\n---|\n\*\*|\n\n\n|$)/im,
    /(?:^|\n)((?:This|The|A|An)\s+(?:lot|car|vehicle|automobile)\s[\s\S]{100,}?)(?=\n##|\n---|\n\*\*|\n\n\n|$)/im,
  ];

  for (const pattern of descPatterns) {
    const match = markdown.match(pattern);
    if (match && match[1]) {
      result.description = match[1]
        .replace(/!\[.*?\]\(.*?\)/g, '') // Remove markdown images
        .replace(/\[([^\]]+)\]\(.*?\)/g, '$1') // Convert links to text
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 5000);
      break;
    }
  }

  // Fallback: take the longest paragraph from markdown
  if (!result.description) {
    const paragraphs = markdown.split(/\n\n+/).filter(p => p.length > 100 && !p.startsWith('#') && !p.startsWith('!'));
    if (paragraphs.length > 0) {
      // Pick the longest paragraph that mentions the vehicle
      const vehicleParagraph = paragraphs.find(p =>
        /\d{4}/.test(p) || /vehicle|car|engine|restoration|condition|provenance|history/i.test(p)
      );
      if (vehicleParagraph) {
        result.description = vehicleParagraph
          .replace(/!\[.*?\]\(.*?\)/g, '')
          .replace(/\[([^\]]+)\]\(.*?\)/g, '$1')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 5000);
      }
    }
  }

  // --- IMAGES ---
  result.image_urls = extractImageUrls(markdown, html, url);

  return result;
}

// ============================================================================
// IMAGE EXTRACTION
// ============================================================================

function extractImageUrls(markdown: string, html: string, pageUrl: string): string[] {
  const images = new Set<string>();

  // From markdown: ![alt](url)
  const mdImagePattern = /!\[[^\]]*\]\(([^)]+)\)/g;
  let match;
  while ((match = mdImagePattern.exec(markdown)) !== null) {
    const imgUrl = match[1];
    if (isVehicleImage(imgUrl)) {
      images.add(resolveUrl(imgUrl, pageUrl));
    }
  }

  // From HTML: <img src="..."> and data-src="..."
  const htmlImgPatterns = [
    /<img[^>]*\ssrc="([^"]+)"/gi,
    /<img[^>]*\sdata-src="([^"]+)"/gi,
    /background-image:\s*url\(['"]?([^'")\s]+)['"]?\)/gi,
    /"(?:src|url|image|imageUrl)":\s*"(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp))"/gi,
  ];

  for (const pattern of htmlImgPatterns) {
    while ((match = pattern.exec(html)) !== null) {
      const imgUrl = match[1];
      if (isVehicleImage(imgUrl)) {
        images.add(resolveUrl(imgUrl, pageUrl));
      }
    }
  }

  // From HTML: srcset attributes (pick highest resolution)
  const srcsetPattern = /srcset="([^"]+)"/gi;
  while ((match = srcsetPattern.exec(html)) !== null) {
    const srcset = match[1];
    const entries = srcset.split(',').map(s => s.trim());
    // Get the last entry (typically the highest resolution)
    for (const entry of entries) {
      const parts = entry.split(/\s+/);
      if (parts[0] && isVehicleImage(parts[0])) {
        images.add(resolveUrl(parts[0], pageUrl));
      }
    }
  }

  return [...images].slice(0, 80); // Cap at 80 images
}

function isVehicleImage(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();

  // Must be an image
  if (!/\.(jpg|jpeg|png|webp|avif)/i.test(lower) && !lower.includes('image') && !lower.includes('photo') && !lower.includes('cdn')) {
    return false;
  }

  // Filter out tiny icons, logos, social, and UI images
  const excludePatterns = [
    /favicon/i, /logo/i, /icon/i, /sprite/i, /social/i,
    /twitter|facebook|instagram|linkedin|youtube/i,
    /arrow|chevron|caret|close|menu|search|play/i,
    /placeholder/i, /loading/i, /spinner/i,
    /\d+x\d+.*pixel/i, // tracking pixels
    /badge|button|banner/i,
    /data:image/i, // data URIs (usually tiny)
    /gravatar/i, /avatar/i,
    /google|analytics|tracking/i,
  ];

  for (const pattern of excludePatterns) {
    if (pattern.test(lower)) return false;
  }

  // Broad Arrow uses various CDN patterns
  // Accept images that are reasonably large (by URL hints)
  return true;
}

function resolveUrl(imgUrl: string, pageUrl: string): string {
  if (imgUrl.startsWith('http://') || imgUrl.startsWith('https://')) {
    return imgUrl;
  }
  if (imgUrl.startsWith('//')) {
    return 'https:' + imgUrl;
  }
  try {
    return new URL(imgUrl, pageUrl).href;
  } catch {
    return imgUrl;
  }
}

// ============================================================================
// DATABASE SAVE
// ============================================================================

async function saveToDatabase(
  supabase: ReturnType<typeof createClient>,
  extracted: BroadArrowExtracted,
): Promise<{ vehicle_id: string; images_saved: number; is_new: boolean }> {
  const listingUrlKey = normalizeListingUrlKey(extracted.url);

  // Resolve existing vehicle to avoid duplicates
  const { vehicleId: resolvedId } = await resolveExistingVehicleId(supabase, {
    url: extracted.url,
    platform: 'broad_arrow',
    discoveryUrlIlikePattern: discoveryUrlIlikePattern(extracted.url),
  });
  let vehicleId: string | null = resolvedId;

  // Also check by VIN if available
  if (!vehicleId && extracted.vin && extracted.vin.length >= 11) {
    const { data: byVin } = await supabase
      .from('vehicles')
      .select('id')
      .eq('vin', extracted.vin.toUpperCase())
      .limit(1)
      .maybeSingle();
    if (byVin?.id) {
      vehicleId = byVin.id;
    }
  }

  let isNew = false;

  const vehicleData: Record<string, unknown> = {
    year: extracted.year,
    make: extracted.make,
    model: extracted.model,
    vin: extracted.vin || extracted.chassis_number || null,
    mileage: extracted.mileage,
    color: extracted.exterior_color,
    interior_color: extracted.interior_color,
    transmission: extracted.transmission,
    drivetrain: extracted.drivetrain,
    engine_type: extracted.engine,
    body_style: extracted.body_style,
    description: extracted.description,
    sale_price: extracted.sale_price,
    asking_price: extracted.estimate_high || null,
    sale_status: extracted.auction_status === 'sold' ? 'sold' :
                 extracted.auction_status === 'not_sold' ? 'not_sold' :
                 extracted.auction_status === 'upcoming' ? 'upcoming' : null,
    auction_outcome: extracted.auction_status === 'sold' ? 'sold' :
                     extracted.auction_status === 'not_sold' ? 'reserve_not_met' :
                     extracted.auction_status === 'withdrawn' ? 'no_sale' : null,
    auction_end_date: extracted.auction_date,
    listing_url: extracted.url,
    discovery_url: extracted.url,
    discovery_source: 'broad_arrow',
    profile_origin: 'broad_arrow_import',
    auction_source: 'broad_arrow',
    is_public: true,
    status: 'active',
    extractor_version: 'extract-broad-arrow:1.0',
    origin_metadata: {
      source: 'broad_arrow_import',
      lot_number: extracted.lot_number,
      auction_name: extracted.auction_name,
      auction_date: extracted.auction_date,
      estimate_low: extracted.estimate_low,
      estimate_high: extracted.estimate_high,
      chassis_number: extracted.chassis_number,
      sold_price_text: extracted.sold_price_text,
      scrape_ms: extracted.scrape_ms,
      imported_at: new Date().toISOString(),
    },
  };

  let identityRow: { year: number | null; make: string | null; model: string | null; vin: string | null; discovery_url: string | null } | null = null;
  if (vehicleId) {
    // A lot may update the vehicle it is (same listing key); on any other vehicle a different car is refused before anything is
    // written (revision item identity_match / relink) and the identity fields stay fill-only.
    const { data: idRow } = await supabase.from('vehicles').select('year,make,model,vin,discovery_url').eq('id', vehicleId).maybeSingle();
    if (idRow && normalizeListingUrlKey(idRow.discovery_url) !== listingUrlKey) {
      const conflict = identityConflict(idRow, { year: extracted.year, make: extracted.make, model: extracted.model, vin: extracted.vin });
      if (conflict) {
        await recordRevision(supabase, { url: extracted.url, missing: ['identity_match'], reason: 'bad_data', next_action: 'relink', raised_by: 'extract-broad-arrow', vehicle_id: vehicleId, detail: { reason: 'different_car', detail: conflict } });
        throw new Error(`identity refused: different_car (${conflict})`);
      }
      identityRow = idRow;
    }
  }

  if (vehicleId) {
    // Update existing: only overwrite non-null fields, preserve existing data
    const updates: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(identityRow ? fillOnlyIdentity(vehicleData, identityRow) : vehicleData)) {
      if (val !== null && val !== undefined) {
        updates[key] = val;
      }
    }
    updates.updated_at = new Date().toISOString();

    const { error: updateError } = await supabase
      .from('vehicles')
      .update(updates)
      .eq('id', vehicleId);

    if (updateError) {
      throw new Error(`vehicles update failed for ${vehicleId}: ${updateError.message}`);
    } else {
      console.log(`[broad-arrow] Updated vehicle: ${vehicleId}`);
    }
  } else {
    // Insert new vehicle
    isNew = true;
    const { data: newVehicle, error: insertError } = await supabase
      .from('vehicles')
      .insert(vehicleData)
      .select('id')
      .maybeSingle();

    if (insertError) {
      throw new Error(`Failed to insert vehicle: ${insertError.message}`);
    }
    vehicleId = newVehicle!.id;
    console.log(`[broad-arrow] Created vehicle: ${vehicleId}`);
  }

  // Fire-and-forget observation write
  if (vehicleId) {
    const obsFields: Record<string, any> = {};
    if (extracted.year) obsFields.year = extracted.year;
    if (extracted.make) obsFields.make = extracted.make;
    if (extracted.model) obsFields.model = extracted.model;
    if (extracted.vin) obsFields.vin = extracted.vin;
    if (extracted.sale_price) obsFields.sale_price = extracted.sale_price;
    if (extracted.mileage) obsFields.mileage = extracted.mileage;
    if (extracted.engine) obsFields.engine_size = extracted.engine;
    if (extracted.transmission) obsFields.transmission = extracted.transmission;
    if (extracted.exterior_color) obsFields.color = extracted.exterior_color;
    if (extracted.interior_color) obsFields.interior_color = extracted.interior_color;
    writeObservation(supabase, {
      vehicleId,
      source: { platform: "broad-arrow", url: extracted.url, trustScore: 0.8 },
      fields: obsFields,
      observationKind: extracted.sale_price ? "sale_result" : "listing",
      extractionMethod: "firecrawl_markdown_parse",
    }).catch((e: any) => console.warn(`[BROAD-ARROW] observationWriter error for ${vehicleId}: ${e?.message}`));
  }

  // roster_first_seen_at is the first read of the lot on the house's roster: keep the earlier one.
  if (extracted.extra_metadata?.roster_first_seen_at && listingUrlKey) {
    const { data: prior } = await supabase.from('vehicle_events').select('metadata').eq('source_platform', 'broad_arrow').eq('source_listing_id', listingUrlKey).limit(1);
    const first = prior?.[0]?.metadata?.roster_first_seen_at;
    if (first) extracted.extra_metadata = { ...extracted.extra_metadata, roster_first_seen_at: first };
  }

  // Upsert vehicle_events record
  const eventWrite = await writeVehicleEventByKey(supabase, {
      vehicle_id: vehicleId,
      source_platform: 'broad_arrow',
      event_type: 'auction',
      source_url: extracted.url,
      source_listing_id: listingUrlKey || extracted.lot_number,
      event_status: extracted.auction_status === 'sold' ? 'sold' :
                      extracted.auction_status === 'upcoming' ? (extracted.extra_metadata ? 'upcoming' : 'active') :
                      extracted.auction_status === 'not_sold' ? 'unsold' : 'ended',
      ended_at: extracted.auction_date ? new Date(extracted.auction_date).toISOString() : null,
      final_price: extracted.sale_price,
      sold_at: extracted.auction_status === 'sold' && extracted.auction_date
        ? new Date(extracted.auction_date).toISOString()
        : null,
      metadata: {
        lot_number: extracted.lot_number,
        auction_name: extracted.auction_name,
        estimate_low: extracted.estimate_low,
        estimate_high: extracted.estimate_high,
        chassis_number: extracted.chassis_number,
        ...(extracted.extra_metadata ?? {}),
      },
    });

  if (eventWrite.action === 'error') {
    throw new Error(`vehicle_events write failed: ${eventWrite.error}`);
  }

  // Save images
  let imagesSaved = 0;
  if (extracted.image_urls.length > 0 && vehicleId) {
    // Add only the photos the vehicle does not already hold. Delete-then-insert doubled a gallery whenever the delete did
    // not take (its failure is swallowed); the same defect doubled a Gooding gallery on 2026-10-18.
    const { data: have, error: haveErr } = await supabase
      .from('vehicle_images')
      .select('image_url')
      .eq('vehicle_id', vehicleId)
      .limit(1000);
    if (haveErr) throw new Error(`vehicle_images read failed: ${haveErr.message}`);
    const haveUrls = new Set((have ?? []).map((r: { image_url: string }) => r.image_url));

    const imageRecords = extracted.image_urls.slice(0, 150).map((imgUrl, i) => ({
      vehicle_id: vehicleId,
      image_url: imgUrl,
      source: 'broad_arrow',
      source_url: imgUrl,
      is_external: true,
      approval_status: 'auto_approved',
      is_approved: true,
      redaction_level: 'none',
      position: i,
      display_order: i,
      is_primary: i === 0 && haveUrls.size === 0,
      exif_data: {
        source_url: extracted.url,
        discovery_url: extracted.url,
        imported_from: 'broad_arrow',
        auction_name: extracted.auction_name,
        lot_number: extracted.lot_number,
      },
    })).filter((row) => !haveUrls.has(row.image_url));

    if (imageRecords.length > 0) {
      const { data: insertedImages, error: imgError } = await supabase
        .from('vehicle_images')
        .insert(imageRecords)
        .select('id');

      if (imgError) {
        throw new Error(`vehicle_images insert failed: ${imgError.message}`);
      } else {
        imagesSaved = insertedImages?.length || 0;
        console.log(`[broad-arrow] Saved ${imagesSaved} images`);
      }
    }
  }

  return { vehicle_id: vehicleId!, images_saved: imagesSaved, is_new: isNew };
}

// ============================================================================
// FIRECRAWL SCRAPER
// ============================================================================

async function scrapeWithFirecrawl(url: string): Promise<{
  markdown: string;
  html: string;
  metadata: Record<string, any>;
  scrapeMs: number;
}> {
  const start = Date.now();

  const result = await firecrawlScrape({
    url,
    formats: ['markdown', 'rawHtml'],
    waitFor: 3000, // Broad Arrow uses Next.js, needs JS rendering
    onlyMainContent: false, // Get full page for images and specs
    timeout: 45000,
  }, {
    timeoutMs: 50000,
    maxAttempts: 2,
  });

  const elapsed = Date.now() - start;

  if (!result.success && !result.data.markdown && !result.data.html) {
    throw new Error(result.error || `Firecrawl failed: HTTP ${result.httpStatus}`);
  }

  if (result.blocked) {
    console.warn(`[broad-arrow] Firecrawl reported block signals: ${result.blockedSignals.join(', ')}`);
  }

  return {
    markdown: result.data.markdown || '',
    html: result.data.html || '',
    metadata: result.data.metadata || {},
    scrapeMs: elapsed,
  };
}

// ============================================================================
// HTTP HANDLER
// ============================================================================

if (import.meta.main) Deno.serve(async (req) => {
  // Writes are never anonymous: service key, signed-in user, or nothing (P0.2, 2026-09-27).
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      projectSecretKey() ?? '',
    );

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const { url, action, save_to_db = true, limit = 20 } = body;

    // --- Single URL extraction ---
    if (url || (!action && url)) {
      if (!url) {
        return okJson({ success: false, error: 'URL is required' }, 400);
      }

      if (!url.includes('broadarrowauctions.com') && !url.includes('broad-arrow')) {
        return okJson({ success: false, error: 'Not a Broad Arrow URL' }, 400);
      }

      console.log(`[broad-arrow] Extracting: ${url}`);

      const { markdown, html, metadata, scrapeMs } = await scrapeWithFirecrawl(url);
      console.log(`[broad-arrow] Firecrawl returned ${markdown.length} chars markdown, ${html.length} chars HTML in ${scrapeMs}ms`);

      const extracted = parseFromMarkdown(markdown, html, url);
      extracted.scrape_ms = scrapeMs;

      console.log(`[broad-arrow] Parsed: ${extracted.year} ${extracted.make} ${extracted.model}`);
      console.log(`[broad-arrow] VIN: ${extracted.vin || 'N/A'} | Chassis: ${extracted.chassis_number || 'N/A'}`);
      console.log(`[broad-arrow] Lot: ${extracted.lot_number} | Auction: ${extracted.auction_name}`);
      console.log(`[broad-arrow] Estimate: $${extracted.estimate_low?.toLocaleString()} - $${extracted.estimate_high?.toLocaleString()}`);
      console.log(`[broad-arrow] Sale Price: ${extracted.sale_price ? '$' + extracted.sale_price.toLocaleString() : 'N/A'}`);
      console.log(`[broad-arrow] Status: ${extracted.auction_status}`);
      console.log(`[broad-arrow] Images: ${extracted.image_urls.length}`);

      // Non-vehicle detection
      const titleOrModel = `${extracted.title || ''} ${extracted.model || ''}`;
      const nonVehiclePatterns = /\b(porcelain|neon sign|gas pump|oil can|jukebox|globe|thermometer|clock|letters|pedal car|framed|coin-operated|slot machine|pinball|quilt|memorabilia|poster|banner|flag|tin sign|scale model|diecast)\b/i;
      if (nonVehiclePatterns.test(titleOrModel) && !extracted.vin) {
        return okJson({
          success: false,
          error: 'No vehicle data found - appears to be memorabilia/non-vehicle lot',
          url,
        });
      }

      // Minimum data check
      if (!extracted.year && !extracted.make) {
        return okJson({
          success: false,
          error: 'Could not extract vehicle data from page',
          url,
          debug: {
            markdown_length: markdown.length,
            html_length: html.length,
            title: extracted.title,
            scrape_ms: scrapeMs,
          },
        });
      }

      let dbResult = null;
      if (save_to_db) {
        dbResult = await saveToDatabase(supabase, extracted);
        extracted.vehicle_id = dbResult.vehicle_id;

        // Update import_queue if there's an entry for this URL
        mustWrite('import_queue update', await supabase
          .from('import_queue')
          .update({
            status: 'complete',
            vehicle_id: dbResult.vehicle_id,
            error_message: null,
            processed_at: new Date().toISOString(),
          })
          .eq('listing_url', url));
      }

      return okJson({
        success: true,
        vehicle_id: dbResult?.vehicle_id || null,
        is_new: dbResult?.is_new || false,
        images_saved: dbResult?.images_saved || 0,
        extracted: {
          year: extracted.year,
          make: extracted.make,
          model: extracted.model,
          vin: extracted.vin,
          chassis_number: extracted.chassis_number,
          sale_price: extracted.sale_price,
          estimate_low: extracted.estimate_low,
          estimate_high: extracted.estimate_high,
          auction_status: extracted.auction_status,
          lot_number: extracted.lot_number,
          auction_name: extracted.auction_name,
          mileage: extracted.mileage,
          engine: extracted.engine,
          transmission: extracted.transmission,
          exterior_color: extracted.exterior_color,
          interior_color: extracted.interior_color,
          body_style: extracted.body_style,
          images: extracted.image_urls.length,
          scrape_ms: extracted.scrape_ms,
        },
      });
    }

    // --- Batch from queue ---
    if (action === 'batch_from_queue') {
      const batchLimit = Math.min(typeof limit === 'number' ? limit : 20, 50);

      // Claim pending Broad Arrow items
      const { data: items, error: claimErr } = await supabase
        .from('import_queue')
        .select('id, listing_url, attempts')
        .eq('status', 'pending')
        .like('listing_url', '%broadarrowauctions.com%')
        .lt('attempts', 3)
        .order('created_at', { ascending: true })
        .limit(batchLimit);

      if (claimErr) throw claimErr;
      if (!items?.length) {
        return okJson({ success: true, message: 'No Broad Arrow items in queue', processed: 0 });
      }

      // Mark as processing
      const ids = items.map((i: any) => i.id);
      mustWrite('import_queue update', await supabase
        .from('import_queue')
        .update({ status: 'processing', locked_at: new Date().toISOString() })
        .in('id', ids));

      const results = {
        total: items.length,
        success: 0,
        failed: 0,
        created: 0,
        updated: 0,
        errors: [] as string[],
      };

      for (const item of items) {
        try {
          const { markdown, html, scrapeMs } = await scrapeWithFirecrawl(item.listing_url);
          const extracted = parseFromMarkdown(markdown, html, item.listing_url);
          extracted.scrape_ms = scrapeMs;

          // Non-vehicle check
          const titleOrModel = `${extracted.title || ''} ${extracted.model || ''}`;
          const nonVehiclePatterns = /\b(porcelain|neon sign|gas pump|oil can|jukebox|globe|thermometer|memorabilia|poster|tin sign|scale model|diecast)\b/i;
          if (nonVehiclePatterns.test(titleOrModel) && !extracted.vin) {
            mustWrite('import_queue update', await supabase.from('import_queue').update({
              status: 'skipped',
              error_message: 'Non-vehicle lot (memorabilia/collectible)',
              attempts: (item.attempts || 0) + 1,
            }).eq('id', item.id));
            continue;
          }

          if (!extracted.year && !extracted.make) {
            mustWrite('import_queue update', await supabase.from('import_queue').update({
              status: 'failed',
              error_message: 'Could not parse vehicle data from page',
              attempts: (item.attempts || 0) + 1,
            }).eq('id', item.id));
            results.failed++;
            continue;
          }

          const dbResult = await saveToDatabase(supabase, extracted);

          mustWrite('import_queue update', await supabase.from('import_queue').update({
            status: 'complete',
            vehicle_id: dbResult.vehicle_id,
            error_message: null,
            processed_at: new Date().toISOString(),
            attempts: (item.attempts || 0) + 1,
          }).eq('id', item.id));

          results.success++;
          if (dbResult.is_new) results.created++;
          else results.updated++;

          console.log(`[broad-arrow] [${results.success + results.failed}/${items.length}] ${extracted.year} ${extracted.make} ${extracted.model} - ${extracted.auction_status || 'unknown'}`);

          // Rate limit: 1.5s between Firecrawl calls to be respectful
          if (items.indexOf(item) < items.length - 1) {
            await new Promise((r) => setTimeout(r, 1500));
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          results.failed++;
          if (results.errors.length < 5) {
            results.errors.push(`${item.listing_url}: ${msg}`);
          }

          softWrite('import_queue update', await supabase.from('import_queue').update({
            status: 'failed',
            error_message: msg.slice(0, 500),
            attempts: (item.attempts || 0) + 1,
          }).eq('id', item.id), results.errors);
        }
      }

      return okJson({ success: true, ...results });
    }

    // --- Roster: upcoming sales for the auction calendar (0 credits: plain fetches of the site's own public pages) ---
    // /vehicles (all pages, 10 s apart, the site's Crawl-delay) gives the lot cards; /events/event/<sale> the run day and place. Up to 20 lots not yet landed as
    // upcoming are landed per run through saveToDatabase (event_status upcoming, ended_at the run day, calendar metadata), and a
    // source_census row (house_roster_facet) states the lots listed per sale. A 403/429 or a page without cards ends the run.
    if (action === 'roster') {
      // robots.txt (read 2026-10-16) sets Crawl-delay: 10 for every agent and disallows no path used here (/vehicles?page=N, /events/event/...).
      const CRAWL_DELAY_MS = 10_000;
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const observedAt = new Date().toISOString();
      const cards: RosterCard[] = [];
      const seenUrls = new Set<string>();
      let stoppedBy: string | null = null;
      for (let pg = 1; pg <= 8; pg++) {
        if (pg > 1) await sleep(CRAWL_DELAY_MS);
        const r = await archiveFetch(`https://www.broadarrowauctions.com/vehicles${pg > 1 ? `?page=${pg}` : ''}`, {
          platform: 'broad_arrow', callerName: 'extract-broad-arrow-roster', useFirecrawl: false, skipCache: true, metadata: { source: 'broad-arrow-roster', page: pg },
        });
        if (r.statusCode === 403 || r.statusCode === 429) { stoppedBy = `HTTP ${r.statusCode}`; break; }
        if (!r.html) { stoppedBy = `no page ${pg} (${r.statusCode ?? r.error ?? 'unknown'})`; break; }
        const got = parseListingCards(r.html).filter((c) => !seenUrls.has(c.url));
        if (got.length === 0) break;
        for (const c of got) { seenUrls.add(c.url); cards.push(c); }
      }
      const bySale = new Map<string, RosterCard[]>();
      for (const c of cards) bySale.set(c.code, [...(bySale.get(c.code) ?? []), c]);
      const salesMeta: Record<string, { name: string; starts_on: string | null; ends_on: string | null }> = {};
      const events = new Map<string, ReturnType<typeof parseEventPage>>();
      for (const [code, lots] of bySale) {
        const name = lots[0].sale_name ?? code;
        await sleep(CRAWL_DELAY_MS);
        const ev = await archiveFetch(`https://www.broadarrowauctions.com/events/event/${encodeURIComponent(name.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))}`, {
          platform: 'broad_arrow', callerName: 'extract-broad-arrow-roster', useFirecrawl: false, skipCache: true, metadata: { source: 'broad-arrow-roster', sale: code },
        });
        const parsed = ev.html ? parseEventPage(ev.html, name) : { starts_on: null, ends_on: null, days: [], location: null };
        events.set(code, parsed);
        salesMeta[`broad-arrow-${code}`] = { name, starts_on: parsed.starts_on, ends_on: parsed.ends_on };
      }
      const landedUrls = new Set<string>();
      const keyOf = (u: string) => normalizeListingUrlKey(u) ?? u;
      for (let i = 0; i < cards.length; i += 100) {
        const keys = cards.slice(i, i + 100).map((c) => keyOf(c.url));
        const { data: have } = await supabase.from('vehicle_events').select('source_listing_id').eq('source_platform', 'broad_arrow').eq('event_status', 'upcoming').in('source_listing_id', keys);
        for (const h of have ?? []) landedUrls.add(String(h.source_listing_id));
      }
      const todo = cards.filter((c) => !landedUrls.has(keyOf(c.url)) && events.get(c.code)?.starts_on).slice(0, 20);
      const out = { landed: 0, created: 0, failed: 0, errors: [] as string[] };
      for (const c of todo) {
        const e = events.get(c.code)!;
        const extracted: BroadArrowExtracted = {
          url: c.url, title: [c.year, c.make, c.model].filter(Boolean).join(' ') || null, year: c.year, make: c.make, model: c.model, vin: null, chassis_number: null,
          estimate_low: c.estimate_low, estimate_high: c.estimate_high, sale_price: null, sold_price_text: null,
          lot_number: c.lot_number, auction_name: c.sale_name, auction_date: e.starts_on, auction_status: 'upcoming',
          mileage: null, engine: null, transmission: null, drivetrain: null, exterior_color: null, interior_color: null, body_style: null,
          description: null, image_urls: c.image_urls, scrape_ms: 0,
          extra_metadata: {
            sale_key: `broad-arrow-${c.code}`, auction_name: c.sale_name, auction_session_days: e.days, sale_starts_on: e.starts_on, sale_ends_on: e.ends_on,
            sale_location: e.location, currency: c.currency, roster_first_seen_at: observedAt,
          },
        };
        try {
          const r = await saveToDatabase(supabase, extracted);
          out.landed++;
          if (r.is_new) out.created++;
        } catch (err) {
          out.failed++;
          if (out.errors.length < 5) out.errors.push(`${c.url}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200));
        }
      }
      const census: Record<string, number> = {};
      for (const [code, lots] of bySale) census[`broad-arrow-${code}`] = lots.length;
      let censusWritten = false;
      if (Object.keys(census).length && !stoppedBy) {
        const { data: src } = await supabase.from('observation_sources').select('id').eq('slug', 'broad-arrow').maybeSingle();
        if (src?.id) {
          const total = Object.values(census).reduce((a, b) => a + b, 0);
          const cen = await supabase.from('source_census').insert({
            source_id: src.id, universe_total: total, universe_active: total, census_method: 'house_roster_facet', census_confidence: 0.9,
            census_at: observedAt, census_url: 'https://www.broadarrowauctions.com/vehicles',
            census_notes: 'Broad Arrow /vehicles listing (all pages): vehicle cards per sale; by_category keys are the events\' metadata.sale_key (broad-arrow-<sale code>).',
            by_category: census, raw_response: { sales: salesMeta },
          });
          censusWritten = !cen.error;
          softWrite('source_census insert', cen);
        }
      }
      return okJson({ success: !stoppedBy, action: 'roster', stopped_by: stoppedBy, cards: cards.length, sales: salesMeta, already_upcoming: landedUrls.size, ...out, census_written: censusWritten });
    }

    // --- Stats ---
    // --- Results: land the past lots in source_targets from their own server-rendered pages (0 credits, robots-allowed) ---
    // Walks broad-arrow targets in id order; a target that already has a broad_arrow event or an import_queue row is skipped, and every
    // target tried gets an import_queue row (extractor_version broad-arrow-targets:1, raw_data.target_id) that is also the cursor.
    // Direct fetch only (useFirecrawl false, retained through archiveFetch), 1.5 s apart, stops on 403/429 or 3 failures in a row,
    // and does not start while the database IO gate (firecrawl_io_gate) is closed. A price in a non-USD currency is kept as text:
    // sale_price stays null rather than put euros in a dollar column.
    if (action === 'batch_from_targets') {
      const TAG = 'broad-arrow-targets:1';
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const batchLimit = Math.min(Math.max(Math.floor(Number(body.limit)) || 12, 1), 20);
      const delayMs = Math.max(Math.floor(Number(body.delay_ms)) || 1500, 1500);
      const started = Date.now();
      const { data: gate } = await supabase.rpc('firecrawl_io_gate');
      if (gate && gate.open === false) return okJson({ success: true, skipped: 'io_gate_closed', gate });

      const { data: last } = await supabase.from('import_queue').select('raw_data').eq('extractor_version', TAG).order('created_at', { ascending: false }).limit(1).maybeSingle();
      let cursor = Number(body.after_id) || Number(last?.raw_data?.target_id) || 0;
      const picked: { id: number; listing_url: string }[] = [];
      for (let page = 0; page < 10 && picked.length < batchLimit; page++) {
        const { data: targets, error: tErr } = await supabase.from('source_targets').select('id, listing_url').eq('source_slug', 'broad-arrow').gt('id', cursor).order('id', { ascending: true }).limit(200);
        if (tErr) throw tErr;
        if (!targets?.length) break;
        cursor = targets[targets.length - 1].id;
        const urls = targets.map((t: { listing_url: string }) => t.listing_url);
        const keys = urls.map((u: string) => normalizeListingUrlKey(u) ?? u);
        const [{ data: queued }, { data: landed }] = await Promise.all([
          supabase.from('import_queue').select('listing_url').in('listing_url', urls),
          supabase.from('vehicle_events').select('source_listing_id').eq('source_platform', 'broad_arrow').in('source_listing_id', keys),
        ]);
        const doneUrls = new Set((queued ?? []).map((r: { listing_url: string }) => r.listing_url));
        const doneKeys = new Set((landed ?? []).map((r: { source_listing_id: string }) => r.source_listing_id));
        for (const t of targets) if (picked.length < batchLimit && !doneUrls.has(t.listing_url) && !doneKeys.has(normalizeListingUrlKey(t.listing_url) ?? t.listing_url)) picked.push(t);
      }

      const res = { picked: picked.length, landed: 0, created: 0, updated: 0, sold: 0, not_sold: 0, unknown_result: 0, gone: 0, failed: 0, stopped: null as string | null, errors: [] as string[] };
      const saleDays = new Map<string, { starts_on: string | null; ends_on: string | null }>();
      let streak = 0;
      for (const t of picked) {
        if (Date.now() - started > 110_000) { res.stopped = 'time_budget'; break; }
        const { data: row, error: claimErr } = await supabase.from('import_queue').insert({ listing_url: t.listing_url, status: 'processing', extractor_version: TAG, raw_data: { target_id: t.id }, locked_at: new Date().toISOString() }).select('id').single();
        if (claimErr || !row) continue;
        const finish = async (status: string, error?: string, vehicleId?: string) =>
          softWrite('import_queue update', await supabase.from('import_queue').update({ status, error_message: error?.slice(0, 500) ?? null, vehicle_id: vehicleId ?? null, processed_at: new Date().toISOString() }).eq('id', row.id), res.errors);
        try {
          const page = await archiveFetch(t.listing_url, { platform: 'broad_arrow', useFirecrawl: false, callerName: 'extract-broad-arrow-targets', directFetchOptions: { publicOnly: true, timeout: 25_000 } });
          const st = page.statusCode ?? 0;
          if (st === 403 || st === 429) { await finish('failed', `HTTP ${st}`); res.failed++; res.stopped = 'blocked_by_source'; break; }
          if (st === 404 || st === 410) { await finish('skipped', 'PAGE_NOT_FOUND'); res.gone++; streak = 0; await sleep(delayMs); continue; }
          if (!page.html) throw new Error(page.error || `no html (status ${st})`);
          const lot = parseLotPage(page.html);
          if (!lot.year || !lot.make) { await finish('skipped', 'not_a_vehicle_page'); res.gone++; streak = 0; await sleep(delayMs); continue; }
          // The sale's run days come from its event page, read once per sale per run (retained through archiveFetch).
          let days = lot.saleName ? saleDays.get(lot.saleName) : undefined;
          if (lot.saleName && !days) {
            await sleep(3000);
            const ev = await archiveFetch(`https://www.broadarrowauctions.com/events/event/${encodeURIComponent(lot.saleName.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))}`, { platform: 'broad_arrow', callerName: 'extract-broad-arrow-targets', useFirecrawl: false, directFetchOptions: { publicOnly: true, timeout: 25_000 } });
            const parsed = ev.html ? parseEventPage(ev.html, lot.saleName) : { starts_on: null, ends_on: null };
            days = { starts_on: parsed.starts_on, ends_on: parsed.ends_on };
            saleDays.set(lot.saleName, days);
          }
          const usd = lot.currency === 'USD' || lot.currency === null;
          const extracted: BroadArrowExtracted = {
            url: t.listing_url, title: lot.title, year: lot.year, make: lot.make, model: lot.model,
            vin: lot.vin && lot.vin.length === 17 ? lot.vin : null, chassis_number: lot.vin && lot.vin.length !== 17 ? lot.vin : null,
            estimate_low: null, estimate_high: null,
            sale_price: lot.status === 'sold' && usd ? lot.soldPrice : null, sold_price_text: lot.soldPriceText,
            lot_number: lot.lotNumber, auction_name: lot.saleName, auction_date: days?.starts_on ?? null,
            auction_status: lot.status === 'unknown' ? null : lot.status,
            mileage: lot.odometer ? (lot.odometer.unit === 'km' ? Math.round(lot.odometer.value * 0.621371) : lot.odometer.value) : null,
            engine: null, transmission: null, drivetrain: null, exterior_color: null, interior_color: null, body_style: null,
            description: lot.description, image_urls: lot.imageUrls, scrape_ms: 0,
            extra_metadata: { sale_starts_on: days?.starts_on ?? null, sale_ends_on: days?.ends_on ?? null, currency: lot.currency, sold_amount: lot.status === 'sold' ? lot.soldPrice : null, odometer: lot.odometer, read_by: 'broad-arrow-targets' },
          };
          const saved = await saveToDatabase(supabase, extracted);
          await finish('complete', undefined, saved.vehicle_id);
          res.landed++; if (saved.is_new) res.created++; else res.updated++;
          if (lot.status === 'sold') res.sold++; else if (lot.status === 'not_sold') res.not_sold++; else res.unknown_result++;
          streak = 0;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          await finish('failed', msg);
          res.failed++; streak++;
          if (res.errors.length < 5) res.errors.push(`${t.listing_url}: ${msg.slice(0, 200)}`);
          if (streak >= 3) { res.stopped = '3_failures_in_a_row'; break; }
        }
        await sleep(delayMs);
      }
      return okJson({ success: true, cursor, ...res });
    }

    if (action === 'stats') {
      const { count: pendingCount } = await supabase
        .from('import_queue')
        .select('*', { count: 'exact', head: true })
        .like('listing_url', '%broadarrowauctions.com%')
        .eq('status', 'pending');

      const { count: completeCount } = await supabase
        .from('import_queue')
        .select('*', { count: 'exact', head: true })
        .like('listing_url', '%broadarrowauctions.com%')
        .eq('status', 'complete');

      const { count: failedCount } = await supabase
        .from('import_queue')
        .select('*', { count: 'exact', head: true })
        .like('listing_url', '%broadarrowauctions.com%')
        .eq('status', 'failed');

      const { count: vehicleCount } = await supabase
        .from('vehicles')
        .select('*', { count: 'exact', head: true })
        .eq('discovery_source', 'broad_arrow');

      const { count: listingCount } = await supabase
        .from('vehicle_events')
        .select('*', { count: 'exact', head: true })
        .eq('source_platform', 'broad_arrow');

      return okJson({
        success: true,
        stats: {
          queue: {
            pending: pendingCount || 0,
            complete: completeCount || 0,
            failed: failedCount || 0,
          },
          vehicles_in_db: vehicleCount || 0,
          vehicle_events: listingCount || 0,
        },
      });
    }

    return okJson({
      success: false,
      error: 'Provide url or action (batch_from_queue, stats)',
      usage: {
        single: { url: 'https://broadarrowauctions.com/vehicles/...', save_to_db: true },
        batch: { action: 'batch_from_queue', limit: 20 },
        stats: { action: 'stats' },
      },
    }, 400);

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[broad-arrow] Error:', msg);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
