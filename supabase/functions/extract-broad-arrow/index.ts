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

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { firecrawlScrape } from '../_shared/firecrawl.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { normalizeListingUrlKey } from '../_shared/listingUrl.ts';
import { resolveExistingVehicleId, discoveryUrlIlikePattern } from '../_shared/resolveVehicleForListing.ts';

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

function parseFromMarkdown(markdown: string, html: string, url: string): BroadArrowExtracted {
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
  const combinedText = markdown + '\n' + (html || '').replace(/<[^>]+>/g, ' ');

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
  const estimatePatterns = [
    /Estimate[:\s]*\$?([\d,]+)\s*[-–—]\s*\$?([\d,]+)/i,
    /Est\.?\s*\$?([\d,]+)\s*[-–—]\s*\$?([\d,]+)/i,
    /\$?([\d,]+)\s*[-–—]\s*\$?([\d,]+)\s*(?:USD\s+)?(?:Estimate|Est\.?)/i,
  ];

  for (const pattern of estimatePatterns) {
    const match = combinedText.match(pattern);
    if (match) {
      const low = parseInt(match[1].replace(/,/g, ''), 10);
      const high = parseInt(match[2].replace(/,/g, ''), 10);
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

  if (vehicleId) {
    // Update existing: only overwrite non-null fields, preserve existing data
    const updates: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(vehicleData)) {
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
      console.error(`[broad-arrow] Failed to update vehicle ${vehicleId}: ${updateError.message}`);
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

  // Upsert external_listings record
  const { error: listingError } = await supabase
    .from('external_listings')
    .upsert({
      vehicle_id: vehicleId,
      platform: 'broad_arrow',
      listing_url: extracted.url,
      listing_url_key: listingUrlKey,
      listing_id: extracted.lot_number || listingUrlKey,
      listing_status: extracted.auction_status === 'sold' ? 'sold' :
                      extracted.auction_status === 'upcoming' ? 'active' :
                      extracted.auction_status === 'not_sold' ? 'unsold' : 'ended',
      end_date: extracted.auction_date ? new Date(extracted.auction_date).toISOString() : null,
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
      },
    }, { onConflict: 'platform,listing_url_key' });

  if (listingError) {
    console.error(`[broad-arrow] External listing upsert error: ${listingError.message}`);
  }

  // Save images
  let imagesSaved = 0;
  if (extracted.image_urls.length > 0 && vehicleId) {
    // Delete existing broad_arrow images for this vehicle to avoid duplicates
    const { error: deleteError } = await supabase
      .from('vehicle_images')
      .delete()
      .eq('vehicle_id', vehicleId)
      .eq('source', 'broad_arrow');
    if (deleteError) {
      console.error(`[broad-arrow] Image delete error: ${deleteError.message}`);
    }

    const imageRecords = extracted.image_urls.slice(0, 80).map((imgUrl, i) => ({
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
      is_primary: i === 0,
      exif_data: {
        source_url: extracted.url,
        discovery_url: extracted.url,
        imported_from: 'broad_arrow',
        auction_name: extracted.auction_name,
        lot_number: extracted.lot_number,
      },
    }));

    const { data: insertedImages, error: imgError } = await supabase
      .from('vehicle_images')
      .insert(imageRecords)
      .select('id');

    if (imgError) {
      console.error(`[broad-arrow] Image save error: ${imgError.message}`);
    } else {
      imagesSaved = insertedImages?.length || 0;
      console.log(`[broad-arrow] Saved ${imagesSaved} images`);
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
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
        await supabase
          .from('import_queue')
          .update({
            status: 'complete',
            vehicle_id: dbResult.vehicle_id,
            error_message: null,
            processed_at: new Date().toISOString(),
          })
          .eq('listing_url', url);
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
      await supabase
        .from('import_queue')
        .update({ status: 'processing', locked_at: new Date().toISOString() })
        .in('id', ids);

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
            await supabase.from('import_queue').update({
              status: 'skipped',
              error_message: 'Non-vehicle lot (memorabilia/collectible)',
              attempts: (item.attempts || 0) + 1,
            }).eq('id', item.id);
            continue;
          }

          if (!extracted.year && !extracted.make) {
            await supabase.from('import_queue').update({
              status: 'failed',
              error_message: 'Could not parse vehicle data from page',
              attempts: (item.attempts || 0) + 1,
            }).eq('id', item.id);
            results.failed++;
            continue;
          }

          const dbResult = await saveToDatabase(supabase, extracted);

          await supabase.from('import_queue').update({
            status: 'complete',
            vehicle_id: dbResult.vehicle_id,
            error_message: null,
            processed_at: new Date().toISOString(),
            attempts: (item.attempts || 0) + 1,
          }).eq('id', item.id);

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

          await supabase.from('import_queue').update({
            status: 'failed',
            error_message: msg.slice(0, 500),
            attempts: (item.attempts || 0) + 1,
          }).eq('id', item.id);
        }
      }

      return okJson({ success: true, ...results });
    }

    // --- Stats ---
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
        .from('external_listings')
        .select('*', { count: 'exact', head: true })
        .eq('platform', 'broad_arrow');

      return okJson({
        success: true,
        stats: {
          queue: {
            pending: pendingCount || 0,
            complete: completeCount || 0,
            failed: failedCount || 0,
          },
          vehicles_in_db: vehicleCount || 0,
          external_listings: listingCount || 0,
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
