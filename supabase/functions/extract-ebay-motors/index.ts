/**
 * extract-ebay-motors
 *
 * eBay Motors extractor with AGGRESSIVE quality filters.
 *
 * eBay is an "ugly source" - full of:
 * - Parts-only listings
 * - Project/non-running vehicles
 * - Scams and pricing errors
 * - Low-quality sellers
 * - Stock images
 * - Classified ads (no actual sale)
 *
 * This extractor applies strict filtering to only import quality listings.
 * Base confidence is LOW (0.6) due to source quality issues.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { firecrawlScrape } from '../_shared/firecrawl.ts';
import { normalizeListingUrlKey } from '../_shared/listingUrl.ts';
import { ExtractionLogger, validateVin, parsePrice, parseMileage } from '../_shared/extractionHealth.ts';

// ============================================================================
// TYPES
// ============================================================================

interface EbayExtracted {
  url: string;
  item_id: string | null;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  vin: string | null;
  mileage: number | null;
  exterior_color: string | null;
  interior_color: string | null;
  transmission: string | null;
  drivetrain: string | null;
  engine: string | null;
  body_style: string | null;
  fuel_type: string | null;
  // Pricing
  price: number | null;
  price_type: 'buy_it_now' | 'current_bid' | 'starting_bid' | null;
  bid_count: number;
  // Location
  location: string | null;
  // Seller
  seller_username: string | null;
  seller_feedback_score: number | null;
  seller_feedback_percent: number | null;
  // Listing metadata
  condition: string | null;
  listing_type: 'auction' | 'buy_it_now' | 'classified' | null;
  end_date: string | null;
  description: string | null;
  image_urls: string[];
  // Quality assessment
  quality_score: number;
  quality_flags: string[];
  skip_reason: string | null;
}

interface SkipReason {
  skip: boolean;
  reason: string | null;
  flags: string[];
}

// ============================================================================
// SKIP FILTERS - Aggressive filtering for ugly source
// ============================================================================

// Title keywords that indicate non-vehicle or problem listings
const SKIP_TITLE_KEYWORDS = [
  // Parts only
  'parts only', 'for parts', 'parts car', 'parts vehicle',
  'parting out', 'part out', 'salvage title',
  // Project / Non-running
  'project', 'not running', 'does not run', 'doesn\'t run',
  'non running', 'nonrunning', 'no start', 'no-start',
  'needs work', 'needs repair', 'barn find',
  'roller', 'no engine', 'no motor', 'no transmission',
  // Scam indicators
  'test listing', 'do not bid', 'don\'t bid',
  // Parts & accessories
  'wheels for', 'wheel for', 'rims for', 'tires for',
  'seats for', 'seat for', 'bumper for', 'hood for',
  'engine for', 'motor for', 'transmission for',
  'door for', 'fender for', 'mirror for',
  'headlight', 'taillight', 'grille for',
  'emblem', 'badge', 'key', 'manual for', 'brochure',
  // Other non-vehicles
  'poster', 'model car', 'diecast', 'scale model',
  'memorabilia', 'sign', 'literature',
];

// Categories that are NOT vehicles (by category ID patterns)
const SKIP_CATEGORY_PATTERNS = [
  /parts/i,
  /accessories/i,
  /apparel/i,
  /tools/i,
  /manuals/i,
  /literature/i,
  /memorabilia/i,
];

// VIN patterns for validation
const VIN_PATTERNS = [
  /\b([1-5][A-HJ-NPR-Z0-9]{16})\b/g,       // US/Canada/Mexico
  /\b(J[A-HJ-NPR-Z0-9]{16})\b/g,           // Japan
  /\b(K[A-HJ-NPR-Z0-9]{16})\b/g,           // Korea
  /\b(L[A-HJ-NPR-Z0-9]{16})\b/g,           // China
  /\b(S[A-HJ-NPR-Z0-9]{16})\b/g,           // UK
  /\b(W[A-HJ-NPR-Z0-9]{16})\b/g,           // Germany
  /\b(Y[A-HJ-NPR-Z0-9]{16})\b/g,           // Sweden/Belgium
  /\b(Z[A-HJ-NPR-Z0-9]{16})\b/g,           // Italy
];

// Make patterns for VIN validation (first 3 chars = WMI)
const VIN_MAKE_MAP: Record<string, string[]> = {
  'porsche': ['WP0', 'WP1'],
  'mercedes': ['WDB', 'WDC', 'WDD', '4JG'],
  'bmw': ['WBA', 'WBS', 'WBY', '5UX'],
  'audi': ['WAU', 'WA1'],
  'volkswagen': ['WVW', 'WVG', '3VW'],
  'ferrari': ['ZFF'],
  'lamborghini': ['ZHW'],
  'maserati': ['ZAM'],
  'alfa romeo': ['ZAR'],
  'jaguar': ['SAJ'],
  'land rover': ['SAL'],
  'aston martin': ['SCF'],
  'bentley': ['SCB'],
  'rolls-royce': ['SCA'],
  'toyota': ['JT', '4T', '5T'],
  'honda': ['JHM', '1HG', '2HG', '5FN'],
  'nissan': ['JN', '1N4', '1N6', '5N1'],
  'mazda': ['JM1', '1YV'],
  'subaru': ['JF1', '4S3', '4S4'],
  'ford': ['1FA', '1FT', '2FA', '3FA', '1FM'],
  'chevrolet': ['1G1', '1GC', '2G1', '3G1'],
  'dodge': ['1B3', '1C3', '2B3', '2C3'],
  'jeep': ['1C4', '1J4', '1J8'],
};

// ============================================================================
// SKIP LOGIC
// ============================================================================

function shouldSkipListing(extracted: Partial<EbayExtracted>): SkipReason {
  const flags: string[] = [];

  // 1. Title contains skip keywords
  const titleLower = (extracted.title || '').toLowerCase();
  for (const keyword of SKIP_TITLE_KEYWORDS) {
    if (titleLower.includes(keyword)) {
      return {
        skip: true,
        reason: `Title contains "${keyword}"`,
        flags: [...flags, 'SKIP_KEYWORD_IN_TITLE'],
      };
    }
  }

  // 2. Seller feedback < 95%
  if (extracted.seller_feedback_percent !== null && extracted.seller_feedback_percent < 95) {
    return {
      skip: true,
      reason: `Seller feedback ${extracted.seller_feedback_percent}% is below 95% threshold`,
      flags: [...flags, 'LOW_SELLER_FEEDBACK'],
    };
  }

  // 3. Price < $1,000 or > $2,000,000 (likely scam or error)
  if (extracted.price !== null) {
    if (extracted.price < 1000) {
      return {
        skip: true,
        reason: `Price $${extracted.price} is below $1,000 minimum (likely incomplete or scam)`,
        flags: [...flags, 'PRICE_TOO_LOW'],
      };
    }
    if (extracted.price > 2000000) {
      return {
        skip: true,
        reason: `Price $${extracted.price} exceeds $2,000,000 (likely error)`,
        flags: [...flags, 'PRICE_TOO_HIGH'],
      };
    }
  }

  // 4. No actual photos (check for stock images)
  if (extracted.image_urls.length === 0) {
    return {
      skip: true,
      reason: 'No photos found - listing may have stock images only',
      flags: [...flags, 'NO_PHOTOS'],
    };
  }

  // Check for eBay stock image patterns
  const stockImagePatterns = [
    /placeholder/i,
    /no[_-]?image/i,
    /stock[_-]?photo/i,
    /generic/i,
  ];
  const hasOnlyStockImages = extracted.image_urls.every(url =>
    stockImagePatterns.some(pattern => pattern.test(url))
  );
  if (hasOnlyStockImages && extracted.image_urls.length < 3) {
    flags.push('POSSIBLE_STOCK_IMAGES');
  }

  // 5. VIN doesn't match year/make/model
  if (extracted.vin && extracted.year && extracted.make) {
    const vinYear = decodeVinYear(extracted.vin);
    if (vinYear && Math.abs(vinYear - extracted.year) > 1) {
      // Allow 1 year difference for model year vs calendar year
      return {
        skip: true,
        reason: `VIN year (${vinYear}) doesn't match listing year (${extracted.year})`,
        flags: [...flags, 'VIN_YEAR_MISMATCH'],
      };
    }

    // Check VIN WMI matches make
    const makeLower = extracted.make.toLowerCase();
    const wmi = extracted.vin.substring(0, 3).toUpperCase();
    const expectedWmis = VIN_MAKE_MAP[makeLower] || [];
    if (expectedWmis.length > 0) {
      const matches = expectedWmis.some(prefix => wmi.startsWith(prefix.substring(0, 2)));
      if (!matches) {
        flags.push('VIN_MAKE_MISMATCH');
        // Don't skip - just flag it, some makes have many WMIs
      }
    }
  }

  // 6. Classified Ad format (not auction/BIN)
  if (extracted.listing_type === 'classified') {
    return {
      skip: true,
      reason: 'Classified Ad format - no actual transaction data',
      flags: [...flags, 'CLASSIFIED_AD'],
    };
  }

  // 7. Missing year/make/model - can't identify vehicle
  if (!extracted.year || !extracted.make) {
    return {
      skip: true,
      reason: 'Missing year or make - cannot identify vehicle',
      flags: [...flags, 'MISSING_IDENTITY'],
    };
  }

  return { skip: false, reason: null, flags };
}

// ============================================================================
// VIN UTILITIES
// ============================================================================

function decodeVinYear(vin: string): number | null {
  if (!vin || vin.length < 10) return null;

  // 10th character is year code
  const yearChar = vin.charAt(9).toUpperCase();
  const yearCodes: Record<string, number> = {
    'A': 2010, 'B': 2011, 'C': 2012, 'D': 2013, 'E': 2014,
    'F': 2015, 'G': 2016, 'H': 2017, 'J': 2018, 'K': 2019,
    'L': 2020, 'M': 2021, 'N': 2022, 'P': 2023, 'R': 2024,
    'S': 2025, 'T': 2026,
    // 1980-2000 cycle
    'Y': 2000, '1': 2001, '2': 2002, '3': 2003, '4': 2004,
    '5': 2005, '6': 2006, '7': 2007, '8': 2008, '9': 2009,
  };

  return yearCodes[yearChar] || null;
}

function extractVin(text: string): string | null {
  for (const pattern of VIN_PATTERNS) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      // Return most common VIN
      const counts: Record<string, number> = {};
      for (const m of matches) {
        counts[m] = (counts[m] || 0) + 1;
      }
      return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    }
  }
  return null;
}

// ============================================================================
// QUALITY SCORING
// ============================================================================

function calculateQualityScore(extracted: Partial<EbayExtracted>): { score: number; reasons: string[] } {
  // Base score for ugly source
  let score = 0.6;
  const reasons: string[] = ['Base: 0.6 (ugly source)'];

  // Seller feedback score: +0.2 if > 99%
  if (extracted.seller_feedback_percent !== null && extracted.seller_feedback_percent > 99) {
    score += 0.2;
    reasons.push(`+0.2: Seller feedback ${extracted.seller_feedback_percent}% > 99%`);
  } else if (extracted.seller_feedback_percent !== null && extracted.seller_feedback_percent > 98) {
    score += 0.1;
    reasons.push(`+0.1: Seller feedback ${extracted.seller_feedback_percent}% > 98%`);
  }

  // Photos count: +0.1 per photo (max +0.3)
  const photoBonus = Math.min(0.3, (extracted.image_urls?.length || 0) * 0.1);
  if (photoBonus > 0) {
    score += photoBonus;
    reasons.push(`+${photoBonus.toFixed(1)}: ${extracted.image_urls?.length || 0} photos`);
  }

  // Item specifics completeness: +0.2 if VIN + mileage present
  if (extracted.vin && extracted.mileage !== null) {
    score += 0.2;
    reasons.push('+0.2: VIN and mileage present');
  } else if (extracted.vin || extracted.mileage !== null) {
    score += 0.1;
    reasons.push('+0.1: VIN or mileage present');
  }

  // Description length: +0.1 if > 500 chars
  if (extracted.description && extracted.description.length > 500) {
    score += 0.1;
    reasons.push(`+0.1: Description length ${extracted.description.length} > 500`);
  }

  // High seller feedback score (actual number, not percentage)
  if (extracted.seller_feedback_score !== null && extracted.seller_feedback_score > 1000) {
    score += 0.05;
    reasons.push(`+0.05: Seller score ${extracted.seller_feedback_score} > 1000`);
  }

  // Cap at 1.0
  score = Math.min(1.0, score);

  return { score, reasons };
}

// ============================================================================
// EXTRACTION FUNCTIONS
// ============================================================================

function extractTitle(html: string): string | null {
  // eBay title is in <h1 class="x-item-title__mainTitle">
  const match = html.match(/<h1[^>]*class="[^"]*x-item-title[^"]*"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/i) ||
                html.match(/<h1[^>]*id="itemTitle"[^>]*>([^<]+)</i) ||
                html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);

  if (!match) return null;

  let title = match[1].trim();

  // Clean eBay-specific suffixes
  title = title
    .replace(/\s*\|\s*eBay.*$/i, '')
    .replace(/\s*-\s*eBay.*$/i, '')
    .replace(/\s+for sale$/i, '')
    .trim();

  return title || null;
}

function parseYearMakeModel(title: string): { year: number | null; make: string | null; model: string | null; trim: string | null } {
  if (!title) return { year: null, make: null, model: null, trim: null };

  // Try to extract year from title
  const yearMatch = title.match(/\b(19[0-9]{2}|20[0-2][0-9])\b/);
  const year = yearMatch ? parseInt(yearMatch[1]) : null;

  if (!year) return { year: null, make: null, model: null, trim: null };

  // Get everything after year
  const afterYear = title.slice(title.indexOf(yearMatch![0]) + yearMatch![0].length).trim();
  const parts = afterYear.split(/\s+/);

  const make = parts[0] || null;
  const model = parts.slice(1, 3).join(' ') || null;
  const trim = parts.length > 3 ? parts.slice(3).join(' ') : null;

  return { year, make, model, trim };
}

function extractItemSpecifics(html: string): Record<string, string> {
  const specs: Record<string, string> = {};

  // eBay item specifics are in a structured format
  // Pattern: <dt>Label</dt><dd>Value</dd> or similar
  const specPatterns = [
    // Modern eBay format
    /<div[^>]*class="[^"]*ux-labels-values[^"]*"[^>]*>[\s\S]*?<span[^>]*class="[^"]*ux-textspans[^"]*"[^>]*>([^<]+)<\/span>[\s\S]*?<span[^>]*class="[^"]*ux-textspans[^"]*"[^>]*>([^<]+)<\/span>/gi,
    // Legacy format
    /<th[^>]*>([^<]+)<\/th>\s*<td[^>]*>([^<]+)<\/td>/gi,
    // Alternative format
    /<dt[^>]*>([^<]+)<\/dt>\s*<dd[^>]*>([^<]+)<\/dd>/gi,
  ];

  for (const pattern of specPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const key = match[1].trim().toLowerCase().replace(/[:\s]+$/, '');
      const value = match[2].trim();
      if (key && value && value !== '--' && value !== 'N/A') {
        specs[key] = value;
      }
    }
  }

  // Also try JSON-LD data
  const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  if (jsonLdMatch) {
    for (const jsonScript of jsonLdMatch) {
      try {
        const jsonStr = jsonScript.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
        const data = JSON.parse(jsonStr);
        if (data['@type'] === 'Product' || data['@type'] === 'Car') {
          if (data.vehicleIdentificationNumber) specs['vin'] = data.vehicleIdentificationNumber;
          if (data.mileageFromOdometer?.value) specs['mileage'] = String(data.mileageFromOdometer.value);
          if (data.color) specs['exterior color'] = data.color;
          if (data.vehicleTransmission) specs['transmission'] = data.vehicleTransmission;
          if (data.driveWheelConfiguration) specs['drive type'] = data.driveWheelConfiguration;
          if (data.fuelType) specs['fuel type'] = data.fuelType;
          if (data.vehicleEngine?.name) specs['engine'] = data.vehicleEngine.name;
          if (data.bodyType) specs['body type'] = data.bodyType;
          if (data.vehicleInteriorColor) specs['interior color'] = data.vehicleInteriorColor;
        }
      } catch { /* ignore parse errors */ }
    }
  }

  return specs;
}

function extractPrice(html: string): { price: number | null; price_type: 'buy_it_now' | 'current_bid' | 'starting_bid' | null; bid_count: number } {
  let price: number | null = null;
  let price_type: 'buy_it_now' | 'current_bid' | 'starting_bid' | null = null;
  let bid_count = 0;

  // Buy It Now price
  const binMatch = html.match(/Buy\s*It\s*Now[^$]*\$([0-9,]+(?:\.[0-9]{2})?)/i) ||
                   html.match(/itemprop="price"[^>]*content="([0-9.]+)"/i) ||
                   html.match(/<span[^>]*class="[^"]*x-price-primary[^"]*"[^>]*>[\s\S]*?\$([0-9,]+(?:\.[0-9]{2})?)/i);

  if (binMatch) {
    price = parseFloat(binMatch[1].replace(/,/g, ''));
    price_type = 'buy_it_now';
  }

  // Current bid (for auctions)
  const bidMatch = html.match(/Current\s*bid[^$]*\$([0-9,]+(?:\.[0-9]{2})?)/i) ||
                   html.match(/Winning\s*bid[^$]*\$([0-9,]+(?:\.[0-9]{2})?)/i);

  if (bidMatch && !price) {
    price = parseFloat(bidMatch[1].replace(/,/g, ''));
    price_type = 'current_bid';
  }

  // Starting bid
  const startMatch = html.match(/Starting\s*bid[^$]*\$([0-9,]+(?:\.[0-9]{2})?)/i);
  if (startMatch && !price) {
    price = parseFloat(startMatch[1].replace(/,/g, ''));
    price_type = 'starting_bid';
  }

  // Bid count
  const bidCountMatch = html.match(/(\d+)\s*bids?/i);
  if (bidCountMatch) {
    bid_count = parseInt(bidCountMatch[1]);
  }

  return { price, price_type, bid_count };
}

function extractSeller(html: string): { username: string | null; feedback_score: number | null; feedback_percent: number | null } {
  let username: string | null = null;
  let feedback_score: number | null = null;
  let feedback_percent: number | null = null;

  // Seller username
  const usernameMatch = html.match(/Seller:\s*<[^>]*>([^<]+)<\/a>/i) ||
                        html.match(/class="[^"]*seller-info[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i) ||
                        html.match(/data-testid="x-seller-member-link"[^>]*>([^<]+)</i);

  if (usernameMatch) {
    username = usernameMatch[1].trim();
  }

  // Feedback score (number)
  const scoreMatch = html.match(/feedback\s*score[:\s]*([0-9,]+)/i) ||
                     html.match(/\(([0-9,]+)\s*\)/);

  if (scoreMatch) {
    feedback_score = parseInt(scoreMatch[1].replace(/,/g, ''));
  }

  // Feedback percentage
  const percentMatch = html.match(/([0-9.]+)%\s*positive/i) ||
                       html.match(/positive\s*feedback[:\s]*([0-9.]+)%/i);

  if (percentMatch) {
    feedback_percent = parseFloat(percentMatch[1]);
  }

  return { username, feedback_score, feedback_percent };
}

function extractLocation(html: string): string | null {
  const match = html.match(/Item\s*location[:\s]*([^<]+)</i) ||
                html.match(/Located\s*in[:\s]*([^<]+)</i) ||
                html.match(/<span[^>]*itemprop="availableAtOrFrom"[^>]*>([^<]+)<\/span>/i);

  if (match) {
    return match[1].trim().replace(/,\s*United States$/i, '');
  }
  return null;
}

function extractCondition(html: string): string | null {
  const match = html.match(/Condition[:\s]*<[^>]*>([^<]+)<\/span>/i) ||
                html.match(/itemprop="itemCondition"[^>]*content="([^"]+)"/i);

  return match ? match[1].trim() : null;
}

function extractListingType(html: string): 'auction' | 'buy_it_now' | 'classified' | null {
  if (html.includes('Classified Ad') || html.includes('classifiedAd')) {
    return 'classified';
  }
  if (html.includes('Buy It Now') || html.includes('BIN')) {
    return 'buy_it_now';
  }
  if (html.includes('Place bid') || html.includes('Current bid') || html.includes('auction')) {
    return 'auction';
  }
  return null;
}

function extractEndDate(html: string): string | null {
  // eBay end date formats vary
  const match = html.match(/data-endtime="(\d+)"/i) ||
                html.match(/endTime['":\s]+(\d{13})/i);

  if (match) {
    const timestamp = parseInt(match[1]);
    // Handle both seconds and milliseconds
    const ts = timestamp > 9999999999 ? timestamp : timestamp * 1000;
    return new Date(ts).toISOString();
  }

  // Try text format
  const textMatch = html.match(/ends?\s+(?:on\s+)?([A-Za-z]+\s+\d+,?\s+\d{4})/i);
  if (textMatch) {
    const date = new Date(textMatch[1]);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return null;
}

function extractDescription(html: string): string | null {
  // eBay descriptions are often in iframes, but markdown conversion should capture it
  const match = html.match(/<div[^>]*id="viTabs_0_is"[^>]*>([\s\S]*?)<\/div>/i) ||
                html.match(/<div[^>]*class="[^"]*item-description[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

  if (match) {
    // Strip HTML tags
    return match[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 10000);
  }
  return null;
}

function extractImages(html: string): string[] {
  const images: string[] = [];
  const seen = new Set<string>();

  // Image gallery patterns
  const patterns = [
    /"image":\s*"(https:\/\/[^"]+\.(?:jpg|jpeg|png|webp))"/gi,
    /data-zoom-src="(https:\/\/[^"]+\.(?:jpg|jpeg|png|webp))"/gi,
    /<img[^>]*src="(https:\/\/i\.ebayimg\.com\/images\/[^"]+)"/gi,
    /"enlargeUrl":\s*"(https:\/\/[^"]+)"/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const url = match[1].replace(/\\\//g, '/');
      // Skip thumbnails and small images
      if (!url.includes('s-l64') && !url.includes('s-l96') && !url.includes('s-l140') && !seen.has(url)) {
        seen.add(url);
        // Try to get largest version
        const largeUrl = url.replace(/s-l\d+/, 's-l1600');
        images.push(largeUrl);
      }
    }
  }

  return images;
}

function extractItemId(url: string): string | null {
  const match = url.match(/\/itm\/(\d+)/i) ||
                url.match(/item=(\d+)/i) ||
                url.match(/\/(\d{12,})/);

  return match ? match[1] : null;
}

// ============================================================================
// MAIN EXTRACTION
// ============================================================================

async function extractEbayListing(url: string): Promise<EbayExtracted> {
  console.log(`Scraping eBay listing: ${url}`);

  // Use Firecrawl for JS-heavy eBay pages
  const scrapeResult = await firecrawlScrape({
    url,
    formats: ['html', 'markdown'],
    waitFor: 3000,
    timeout: 30000,
  });

  if (!scrapeResult.ok || !scrapeResult.data.html) {
    throw new Error(`Failed to scrape eBay listing: ${scrapeResult.error || 'No HTML returned'}`);
  }

  const html = scrapeResult.data.html;
  const markdown = scrapeResult.data.markdown || '';

  // Extract basic info
  const title = extractTitle(html);
  const { year, make, model, trim } = parseYearMakeModel(title || '');
  const itemId = extractItemId(url);

  // Extract item specifics
  const specs = extractItemSpecifics(html);

  // Extract VIN from specs or description
  let vin = specs['vin'] || specs['vehicle identification number'] || null;
  if (!vin) {
    vin = extractVin(html) || extractVin(markdown);
  }

  // Extract mileage
  let mileage: number | null = null;
  const mileageStr = specs['mileage'] || specs['odometer'] || null;
  if (mileageStr) {
    const parsed = parseMileage(mileageStr);
    mileage = parsed.value;
  }

  // Extract other specs
  const exterior_color = specs['exterior color'] || specs['color'] || null;
  const interior_color = specs['interior color'] || null;
  const transmission = specs['transmission'] || null;
  const drivetrain = specs['drive type'] || specs['drivetrain'] || null;
  const engine = specs['engine'] || specs['engine size'] || null;
  const body_style = specs['body type'] || specs['body style'] || null;
  const fuel_type = specs['fuel type'] || null;

  // Extract pricing
  const { price, price_type, bid_count } = extractPrice(html);

  // Extract seller info
  const seller = extractSeller(html);

  // Extract other fields
  const location = extractLocation(html);
  const condition = extractCondition(html);
  const listing_type = extractListingType(html);
  const end_date = extractEndDate(html);
  const description = extractDescription(html) || markdown.slice(0, 10000);
  const image_urls = extractImages(html);

  // Build extracted object
  const extracted: EbayExtracted = {
    url,
    item_id: itemId,
    title,
    year,
    make,
    model,
    trim,
    vin,
    mileage,
    exterior_color,
    interior_color,
    transmission,
    drivetrain,
    engine,
    body_style,
    fuel_type,
    price,
    price_type,
    bid_count,
    location,
    seller_username: seller.username,
    seller_feedback_score: seller.feedback_score,
    seller_feedback_percent: seller.feedback_percent,
    condition,
    listing_type,
    end_date,
    description,
    image_urls,
    quality_score: 0.6,
    quality_flags: [],
    skip_reason: null,
  };

  // Check skip conditions
  const skipCheck = shouldSkipListing(extracted);
  if (skipCheck.skip) {
    extracted.skip_reason = skipCheck.reason;
    extracted.quality_flags = skipCheck.flags;
    return extracted;
  }

  // Calculate quality score
  const quality = calculateQualityScore(extracted);
  extracted.quality_score = quality.score;
  extracted.quality_flags = [...skipCheck.flags, ...quality.reasons];

  return extracted;
}

// ============================================================================
// HTTP HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url, save_to_db = false } = await req.json();

    // Validate URL
    if (!url || (!url.includes('ebay.com/itm/') && !url.includes('ebay.com/p/'))) {
      return new Response(
        JSON.stringify({ error: 'Invalid eBay Motors URL. Expected format: ebay.com/itm/...' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`=== EBAY MOTORS EXTRACTION ===`);
    console.log(`URL: ${url}`);

    // Extract listing data
    const extracted = await extractEbayListing(url);

    // Log results
    console.log(`Title: ${extracted.title}`);
    console.log(`Year/Make/Model: ${extracted.year} ${extracted.make} ${extracted.model}`);
    console.log(`VIN: ${extracted.vin || 'NOT FOUND'}`);
    console.log(`Price: $${extracted.price?.toLocaleString() || 'N/A'} (${extracted.price_type || 'unknown'})`);
    console.log(`Mileage: ${extracted.mileage?.toLocaleString() || 'N/A'}`);
    console.log(`Seller: ${extracted.seller_username} (${extracted.seller_feedback_percent}% / ${extracted.seller_feedback_score})`);
    console.log(`Images: ${extracted.image_urls.length}`);
    console.log(`Quality Score: ${extracted.quality_score.toFixed(2)}`);
    console.log(`Quality Flags: ${extracted.quality_flags.join(', ')}`);

    // Check if should skip
    if (extracted.skip_reason) {
      console.log(`SKIPPED: ${extracted.skip_reason}`);
      return new Response(
        JSON.stringify({
          success: true,
          skipped: true,
          skip_reason: extracted.skip_reason,
          quality_flags: extracted.quality_flags,
          title: extracted.title,
          url: extracted.url,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Save to database if requested
    let vehicle_id: string | null = null;

    if (save_to_db) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );

      // Initialize health logger
      const healthLogger = new ExtractionLogger(supabase, {
        source: 'ebay-motors',
        extractorName: 'extract-ebay-motors',
        extractorVersion: '1.0',
        sourceUrl: url,
      });

      // Log extraction health
      healthLogger.logField('title', extracted.title, 0.9);
      healthLogger.logField('year', extracted.year, extracted.year ? 0.9 : 0);
      healthLogger.logField('make', extracted.make, extracted.make ? 0.85 : 0);
      healthLogger.logField('model', extracted.model, extracted.model ? 0.8 : 0);

      if (extracted.vin) {
        const vinValidation = validateVin(extracted.vin);
        if (vinValidation.valid) {
          healthLogger.logField('vin', extracted.vin, 0.9);
        } else {
          healthLogger.logValidationFail('vin', extracted.vin, vinValidation.errorCode!, vinValidation.errorDetails);
        }
      } else {
        healthLogger.logField('vin', null, 0);
      }

      healthLogger.logField('mileage', extracted.mileage, extracted.mileage ? 0.8 : 0);
      healthLogger.logField('price', extracted.price, extracted.price ? 0.85 : 0);
      healthLogger.logField('exterior_color', extracted.exterior_color, extracted.exterior_color ? 0.7 : 0);
      healthLogger.logField('seller_username', extracted.seller_username, extracted.seller_username ? 0.9 : 0);
      healthLogger.logField('images', extracted.image_urls.length > 0 ? extracted.image_urls.length : null, 0.9);

      // Check for existing vehicle by VIN
      let existingVehicle: { id: string } | null = null;

      if (extracted.vin && extracted.vin.length >= 11) {
        const { data: vinMatch } = await supabase
          .from('vehicles')
          .select('id')
          .eq('vin', extracted.vin)
          .limit(1)
          .single();

        if (vinMatch) {
          existingVehicle = vinMatch;
        }
      }

      if (existingVehicle) {
        // Update existing vehicle
        const { error: updateError } = await supabase
          .from('vehicles')
          .update({
            mileage: extracted.mileage || undefined,
            color: extracted.exterior_color || undefined,
            interior_color: extracted.interior_color || undefined,
            transmission: extracted.transmission || undefined,
            drivetrain: extracted.drivetrain || undefined,
            engine_type: extracted.engine || undefined,
            body_style: extracted.body_style || undefined,
            sale_price: extracted.price,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingVehicle.id);

        if (updateError) {
          throw new Error(`Failed to update vehicle: ${updateError.message}`);
        }

        vehicle_id = existingVehicle.id;
        console.log(`Updated existing vehicle: ${vehicle_id}`);
      } else {
        // Create new vehicle
        const { data: newVehicle, error: insertError } = await supabase
          .from('vehicles')
          .insert({
            year: extracted.year,
            make: extracted.make,
            model: extracted.model,
            trim: extracted.trim,
            vin: extracted.vin,
            mileage: extracted.mileage,
            color: extracted.exterior_color,
            interior_color: extracted.interior_color,
            transmission: extracted.transmission,
            drivetrain: extracted.drivetrain,
            engine_type: extracted.engine,
            body_style: extracted.body_style,
            sale_price: extracted.price,
            description: extracted.description,
            listing_source: 'ebay_motors_extract',
            profile_origin: 'ebay_import',
            discovery_url: extracted.url,
            discovery_source: 'ebay-motors',
            is_public: true,
            status: 'active',
          })
          .select()
          .single();

        if (insertError) {
          throw new Error(`Failed to create vehicle: ${insertError.message}`);
        }

        vehicle_id = newVehicle.id;
        console.log(`Created new vehicle: ${vehicle_id}`);
      }

      healthLogger.setVehicleId(vehicle_id);

      // Save images
      if (extracted.image_urls.length > 0 && vehicle_id) {
        const imageRecords = extracted.image_urls.map((img_url, i) => ({
          vehicle_id,
          image_url: img_url,
          position: i,
          source: 'ebay_import',
          is_external: true,
        }));

        const { error: imgError } = await supabase
          .from('vehicle_images')
          .insert(imageRecords);

        if (imgError) {
          console.error('Image save error:', imgError);
        } else {
          console.log(`Saved ${imageRecords.length} images`);
        }
      }

      // Create external_listings record
      if (vehicle_id) {
        const listingUrlKey = normalizeListingUrlKey(extracted.url);

        const { error: listingError } = await supabase
          .from('external_listings')
          .upsert({
            vehicle_id,
            platform: 'ebay-motors',
            listing_url: extracted.url,
            listing_url_key: listingUrlKey,
            listing_id: extracted.item_id || listingUrlKey,
            listing_status: extracted.listing_type === 'buy_it_now' ? 'active' : (extracted.bid_count > 0 ? 'active' : 'unknown'),
            end_date: extracted.end_date,
            final_price: extracted.price,
            bid_count: extracted.bid_count,
            metadata: {
              item_id: extracted.item_id,
              listing_type: extracted.listing_type,
              price_type: extracted.price_type,
              condition: extracted.condition,
              seller_username: extracted.seller_username,
              seller_feedback_score: extracted.seller_feedback_score,
              seller_feedback_percent: extracted.seller_feedback_percent,
              quality_score: extracted.quality_score,
              quality_flags: extracted.quality_flags,
            },
          }, {
            onConflict: 'platform,listing_url_key'
          });

        if (listingError) {
          console.error('External listing save error:', listingError);
        } else {
          console.log(`Created/updated external_listings record`);
        }
      }

      // Flush health logs
      await healthLogger.flush();
    }

    return new Response(
      JSON.stringify({
        success: true,
        skipped: false,
        vehicle_id,
        extracted: {
          ...extracted,
          // Don't return full description in response
          description: extracted.description ? `${extracted.description.slice(0, 200)}...` : null,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
