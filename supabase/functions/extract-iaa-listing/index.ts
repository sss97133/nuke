/**
 * IAA (INSURANCE AUTO AUCTIONS) LISTING EXTRACTOR
 *
 * Extracts vehicle data from iaai.com auction listings.
 * IAA is a major salvage/insurance auction platform.
 *
 * URL patterns:
 * - https://www.iaai.com/VehicleDetail?itemId=12345678
 * - https://www.iaai.com/vehicle?itemId=12345678&uId=...
 *
 * Data extraction approach:
 * 1. Try direct fetch first (FREE)
 * 2. Fallback to Firecrawl if needed (handles JS rendering)
 * 3. Parse HTML for vehicle details, specs, auction data, images
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { firecrawlScrape } from '../_shared/firecrawl.ts';
import { normalizeListingUrlKey } from '../_shared/listingUrl.ts';

// ============================================================================
// TYPES
// ============================================================================

interface IAAExtracted {
  // Source
  url: string;
  stock_number: string | null;
  item_id: string | null;

  // Vehicle basics
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;

  // Specs
  mileage: number | null;
  exterior_color: string | null;
  interior_color: string | null;
  transmission: string | null;
  engine: string | null;
  drivetrain: string | null;
  body_style: string | null;
  fuel_type: string | null;
  cylinders: number | null;

  // Damage/Condition (IAA-specific)
  primary_damage: string | null;
  secondary_damage: string | null;
  loss_type: string | null;
  title_state: string | null;
  title_type: string | null;
  odometer_status: string | null;
  keys_available: boolean | null;
  airbags: string | null;

  // Auction data
  sale_date: string | null;
  sale_time: string | null;
  sale_status: 'upcoming' | 'live' | 'sold' | 'ended' | 'unknown';
  sale_price: number | null;
  high_bid: number | null;
  buy_now_price: number | null;
  lane: string | null;
  grid_row: string | null;

  // Seller
  seller_name: string | null;
  branch_name: string | null;
  branch_number: string | null;

  // Location
  location: string | null;
  yard_name: string | null;
  yard_number: string | null;

  // Content
  image_urls: string[];

  // Timestamps
  listing_created_at: string | null;

  // Internal
  vehicle_id?: string;
}

// ============================================================================
// VIN EXTRACTION
// ============================================================================

const VIN_PATTERNS = [
  /\b([1-5][A-HJ-NPR-Z0-9]{16})\b/g,       // US/Canada/Mexico (1-5)
  /\b(J[A-HJ-NPR-Z0-9]{16})\b/g,           // Japan
  /\b(K[A-HJ-NPR-Z0-9]{16})\b/g,           // Korea
  /\b(L[A-HJ-NPR-Z0-9]{16})\b/g,           // China
  /\b(S[A-HJ-NPR-Z0-9]{16})\b/g,           // UK
  /\b(W[A-HJ-NPR-Z0-9]{16})\b/g,           // Germany
  /\b(Y[A-HJ-NPR-Z0-9]{16})\b/g,           // Sweden/Belgium
  /\b(Z[A-HJ-NPR-Z0-9]{16})\b/g,           // Italy
  /\b(WP0[A-Z0-9]{14})\b/g,                // Porsche
  /\b(WDB[A-Z0-9]{14})\b/g,                // Mercedes
  /\b(WVW[A-Z0-9]{14})\b/g,                // VW
  /\b(WBA[A-Z0-9]{14})\b/g,                // BMW
  /\b(WAU[A-Z0-9]{14})\b/g,                // Audi
  /\b(ZFF[A-Z0-9]{14})\b/g,                // Ferrari
  /\b(ZAM[A-Z0-9]{14})\b/g,                // Maserati
];

function extractVinFromText(text: string): string | null {
  for (const pattern of VIN_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      // Return the most common VIN (in case of duplicates)
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
// HTML PARSING HELPERS
// ============================================================================

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/&#x([a-fA-F0-9]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'");
}

function cleanText(text: string | null | undefined): string | null {
  if (!text) return null;
  const cleaned = decodeHtmlEntities(text)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || null;
}

function extractNumber(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = text.replace(/[^0-9.]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function extractInt(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = text.replace(/[^0-9]/g, '');
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? null : num;
}

// ============================================================================
// IAA-SPECIFIC EXTRACTION
// ============================================================================

function extractTitle(html: string): { title: string | null; year: number | null; make: string | null; model: string | null } {
  // IAA title patterns:
  // <h1 class="heading-title">2019 FORD FUSION</h1>
  // <span class="heading-title">2019 FORD FUSION</span>
  // Or in meta tags
  const titleMatch = html.match(/<h1[^>]*class="[^"]*heading-title[^"]*"[^>]*>([^<]+)</i) ||
                     html.match(/<span[^>]*class="[^"]*heading-title[^"]*"[^>]*>([^<]+)</i) ||
                     html.match(/<title[^>]*>([^|<]+)/i) ||
                     html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i);

  let title = titleMatch?.[1]?.trim() || null;
  if (!title) return { title: null, year: null, make: null, model: null };

  title = decodeHtmlEntities(title)
    .replace(/\s*[-|].*IAA.*$/i, '')
    .replace(/\s*[-|].*Insurance Auto Auctions.*$/i, '')
    .trim();

  // Parse year from title (e.g., "2019 FORD FUSION")
  const yearMatch = title.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? parseInt(yearMatch[0]) : null;

  // Parse make and model
  let make: string | null = null;
  let model: string | null = null;

  if (year) {
    const afterYear = title.slice(title.indexOf(yearMatch![0]) + yearMatch![0].length).trim();
    const parts = afterYear.split(/\s+/);
    make = parts[0] || null;
    model = parts.slice(1).join(' ') || null;
  }

  return { title, year, make, model };
}

function extractVin(html: string): string | null {
  // IAA has VIN in multiple places:
  // 1. Explicit VIN label: "VIN: 1FAHP3F26CL123456"
  // 2. In data attributes
  // 3. In JSON-LD or structured data

  // Pattern 1: Explicit VIN label
  const vinLabelMatch = html.match(/VIN[:\s]*<[^>]*>([A-HJ-NPR-Z0-9]{17})<\/[^>]+>/i) ||
                        html.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i) ||
                        html.match(/"vin"[:\s]*"([A-HJ-NPR-Z0-9]{17})"/i) ||
                        html.match(/data-vin="([A-HJ-NPR-Z0-9]{17})"/i);

  if (vinLabelMatch) {
    return vinLabelMatch[1].toUpperCase();
  }

  // Pattern 2: General VIN search
  return extractVinFromText(html);
}

function extractStockNumber(html: string): string | null {
  // Stock # or Lot #: "Stock#: 12345678" or "Lot #: 12345678"
  const stockMatch = html.match(/Stock\s*#?\s*:?\s*<[^>]*>([A-Z0-9-]+)<\/[^>]+>/i) ||
                     html.match(/Stock\s*#?\s*:?\s*([A-Z0-9-]+)/i) ||
                     html.match(/Lot\s*#?\s*:?\s*<[^>]*>([A-Z0-9-]+)<\/[^>]+>/i) ||
                     html.match(/Lot\s*#?\s*:?\s*([A-Z0-9-]+)/i) ||
                     html.match(/"stockNumber"[:\s]*"([^"]+)"/i) ||
                     html.match(/"lotNumber"[:\s]*"([^"]+)"/i);

  return stockMatch?.[1]?.trim() || null;
}

function extractItemId(url: string, html: string): string | null {
  // From URL: itemId=12345678
  const urlMatch = url.match(/itemId=(\d+)/i);
  if (urlMatch) return urlMatch[1];

  // From HTML
  const htmlMatch = html.match(/"itemId"[:\s]*"?(\d+)"?/i) ||
                    html.match(/data-item-id="(\d+)"/i);
  return htmlMatch?.[1] || null;
}

function extractDamageInfo(html: string): {
  primary_damage: string | null;
  secondary_damage: string | null;
  loss_type: string | null;
} {
  // Primary Damage: "Front End", "Rear End", "Water/Flood", etc.
  const primaryMatch = html.match(/Primary\s*Damage[:\s]*<[^>]*>([^<]+)<\/[^>]+>/i) ||
                       html.match(/Primary\s*Damage[:\s]*([A-Za-z\s\/]+)/i) ||
                       html.match(/"primaryDamage"[:\s]*"([^"]+)"/i);

  const secondaryMatch = html.match(/Secondary\s*Damage[:\s]*<[^>]*>([^<]+)<\/[^>]+>/i) ||
                         html.match(/Secondary\s*Damage[:\s]*([A-Za-z\s\/]+)/i) ||
                         html.match(/"secondaryDamage"[:\s]*"([^"]+)"/i);

  const lossMatch = html.match(/Loss\s*Type[:\s]*<[^>]*>([^<]+)<\/[^>]+>/i) ||
                    html.match(/Loss\s*Type[:\s]*([A-Za-z\s]+)/i) ||
                    html.match(/"lossType"[:\s]*"([^"]+)"/i);

  return {
    primary_damage: cleanText(primaryMatch?.[1]),
    secondary_damage: cleanText(secondaryMatch?.[1]),
    loss_type: cleanText(lossMatch?.[1]),
  };
}

function extractSpecs(html: string): {
  mileage: number | null;
  exterior_color: string | null;
  interior_color: string | null;
  transmission: string | null;
  engine: string | null;
  drivetrain: string | null;
  body_style: string | null;
  fuel_type: string | null;
  cylinders: number | null;
  odometer_status: string | null;
  keys_available: boolean | null;
  airbags: string | null;
} {
  // Mileage/Odometer
  const mileageMatch = html.match(/Odometer[:\s]*<[^>]*>([0-9,]+)\s*(?:mi|miles)?/i) ||
                       html.match(/Mileage[:\s]*<[^>]*>([0-9,]+)/i) ||
                       html.match(/"odometer"[:\s]*"?([0-9,]+)"?/i) ||
                       html.match(/([0-9,]+)\s*(?:mi|miles)/i);
  const mileage = mileageMatch ? extractInt(mileageMatch[1]) : null;

  // Odometer status (Actual, Not Actual, Exempt, etc.)
  const odometerStatusMatch = html.match(/Odometer\s*Status[:\s]*<[^>]*>([^<]+)</i) ||
                              html.match(/Odometer\s*Status[:\s]*([A-Za-z\s]+)/i);
  const odometer_status = cleanText(odometerStatusMatch?.[1]);

  // Colors
  const extColorMatch = html.match(/(?:Exterior\s*)?Color[:\s]*<[^>]*>([^<]+)</i) ||
                        html.match(/"exteriorColor"[:\s]*"([^"]+)"/i) ||
                        html.match(/Color[:\s]*([A-Za-z\s]+)/i);
  const exterior_color = cleanText(extColorMatch?.[1]);

  const intColorMatch = html.match(/Interior\s*Color[:\s]*<[^>]*>([^<]+)</i) ||
                        html.match(/"interiorColor"[:\s]*"([^"]+)"/i);
  const interior_color = cleanText(intColorMatch?.[1]);

  // Transmission
  const transMatch = html.match(/Transmission[:\s]*<[^>]*>([^<]+)</i) ||
                     html.match(/"transmission"[:\s]*"([^"]+)"/i) ||
                     html.match(/Transmission[:\s]*([A-Za-z\s]+)/i);
  const transmission = cleanText(transMatch?.[1]);

  // Engine
  const engineMatch = html.match(/Engine[:\s]*<[^>]*>([^<]+)</i) ||
                      html.match(/"engine"[:\s]*"([^"]+)"/i) ||
                      html.match(/Engine\s*Type[:\s]*([^<\n]+)/i);
  const engine = cleanText(engineMatch?.[1]);

  // Drivetrain/Drive
  const driveMatch = html.match(/(?:Drive|Drivetrain)[:\s]*<[^>]*>([^<]+)</i) ||
                     html.match(/"drivetrain"[:\s]*"([^"]+)"/i) ||
                     html.match(/Drive[:\s]*([A-Za-z0-9\s]+)/i);
  const drivetrain = cleanText(driveMatch?.[1]);

  // Body Style
  const bodyMatch = html.match(/Body\s*Style[:\s]*<[^>]*>([^<]+)</i) ||
                    html.match(/"bodyStyle"[:\s]*"([^"]+)"/i) ||
                    html.match(/Vehicle\s*Type[:\s]*<[^>]*>([^<]+)</i);
  const body_style = cleanText(bodyMatch?.[1]);

  // Fuel Type
  const fuelMatch = html.match(/Fuel[:\s]*<[^>]*>([^<]+)</i) ||
                    html.match(/"fuelType"[:\s]*"([^"]+)"/i) ||
                    html.match(/Fuel\s*Type[:\s]*([A-Za-z\s]+)/i);
  const fuel_type = cleanText(fuelMatch?.[1]);

  // Cylinders
  const cylMatch = html.match(/Cylinders[:\s]*<[^>]*>(\d+)</i) ||
                   html.match(/"cylinders"[:\s]*"?(\d+)"?/i) ||
                   html.match(/(\d+)\s*(?:cyl|cylinder)/i);
  const cylinders = cylMatch ? extractInt(cylMatch[1]) : null;

  // Keys
  const keysMatch = html.match(/Keys[:\s]*<[^>]*>(Yes|No|Available|Not Available)/i) ||
                    html.match(/"hasKeys"[:\s]*(true|false)/i) ||
                    html.match(/Keys[:\s]*(Yes|No)/i);
  let keys_available: boolean | null = null;
  if (keysMatch) {
    const keyVal = keysMatch[1].toLowerCase();
    keys_available = keyVal === 'yes' || keyVal === 'true' || keyVal === 'available';
  }

  // Airbags
  const airbagMatch = html.match(/Airbags[:\s]*<[^>]*>([^<]+)</i) ||
                      html.match(/"airbags"[:\s]*"([^"]+)"/i);
  const airbags = cleanText(airbagMatch?.[1]);

  return {
    mileage,
    exterior_color,
    interior_color,
    transmission,
    engine,
    drivetrain,
    body_style,
    fuel_type,
    cylinders,
    odometer_status,
    keys_available,
    airbags,
  };
}

function extractTitleInfo(html: string): {
  title_state: string | null;
  title_type: string | null;
} {
  const stateMatch = html.match(/Title\s*State[:\s]*<[^>]*>([A-Z]{2})</i) ||
                     html.match(/"titleState"[:\s]*"([A-Z]{2})"/i) ||
                     html.match(/Title\s*State[:\s]*([A-Z]{2})/i);

  const typeMatch = html.match(/Title\s*(?:Type|Code)[:\s]*<[^>]*>([^<]+)</i) ||
                    html.match(/"titleType"[:\s]*"([^"]+)"/i) ||
                    html.match(/Title\s*(?:Type|Code)[:\s]*([A-Za-z\s]+)/i);

  return {
    title_state: stateMatch?.[1]?.toUpperCase() || null,
    title_type: cleanText(typeMatch?.[1]),
  };
}

function extractAuctionData(html: string): {
  sale_date: string | null;
  sale_time: string | null;
  sale_status: IAAExtracted['sale_status'];
  sale_price: number | null;
  high_bid: number | null;
  buy_now_price: number | null;
  lane: string | null;
  grid_row: string | null;
} {
  // Sale Date
  const saleDateMatch = html.match(/Sale\s*Date[:\s]*<[^>]*>([^<]+)</i) ||
                        html.match(/"saleDate"[:\s]*"([^"]+)"/i) ||
                        html.match(/Auction\s*Date[:\s]*<[^>]*>([^<]+)</i);
  let sale_date: string | null = null;
  if (saleDateMatch) {
    const dateStr = saleDateMatch[1].trim();
    // Try to parse various date formats
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      sale_date = parsed.toISOString().split('T')[0];
    } else {
      sale_date = dateStr;
    }
  }

  // Sale Time
  const saleTimeMatch = html.match(/Sale\s*Time[:\s]*<[^>]*>([^<]+)</i) ||
                        html.match(/"saleTime"[:\s]*"([^"]+)"/i);
  const sale_time = cleanText(saleTimeMatch?.[1]);

  // Sale Status
  let sale_status: IAAExtracted['sale_status'] = 'unknown';
  const statusLower = html.toLowerCase();
  if (statusLower.includes('sold') || statusLower.includes('sale complete')) {
    sale_status = 'sold';
  } else if (statusLower.includes('live') || statusLower.includes('bidding now')) {
    sale_status = 'live';
  } else if (statusLower.includes('upcoming') || statusLower.includes('future sale')) {
    sale_status = 'upcoming';
  } else if (statusLower.includes('ended') || statusLower.includes('auction ended')) {
    sale_status = 'ended';
  }

  // Sale Price (if sold)
  const salePriceMatch = html.match(/(?:Sold|Sale)\s*(?:Price|For)[:\s]*\$?<[^>]*>([0-9,]+)</i) ||
                         html.match(/"salePrice"[:\s]*"?\$?([0-9,]+)"?/i) ||
                         html.match(/Sold\s*For[:\s]*\$([0-9,]+)/i);
  const sale_price = salePriceMatch ? extractInt(salePriceMatch[1]) : null;

  // High Bid (current bid)
  const highBidMatch = html.match(/(?:Current|High)\s*Bid[:\s]*\$?<[^>]*>([0-9,]+)</i) ||
                       html.match(/"currentBid"[:\s]*"?\$?([0-9,]+)"?/i) ||
                       html.match(/"highBid"[:\s]*"?\$?([0-9,]+)"?/i);
  const high_bid = highBidMatch ? extractInt(highBidMatch[1]) : null;

  // Buy Now Price
  const buyNowMatch = html.match(/Buy\s*(?:Now|It\s*Now)[:\s]*\$?<[^>]*>([0-9,]+)</i) ||
                      html.match(/"buyNowPrice"[:\s]*"?\$?([0-9,]+)"?/i);
  const buy_now_price = buyNowMatch ? extractInt(buyNowMatch[1]) : null;

  // Lane
  const laneMatch = html.match(/Lane[:\s]*<[^>]*>([^<]+)</i) ||
                    html.match(/"lane"[:\s]*"([^"]+)"/i);
  const lane = cleanText(laneMatch?.[1]);

  // Grid Row
  const gridMatch = html.match(/(?:Grid|Row)[:\s]*<[^>]*>([^<]+)</i) ||
                    html.match(/"gridRow"[:\s]*"([^"]+)"/i);
  const grid_row = cleanText(gridMatch?.[1]);

  return {
    sale_date,
    sale_time,
    sale_status,
    sale_price,
    high_bid,
    buy_now_price,
    lane,
    grid_row,
  };
}

function extractSellerInfo(html: string): {
  seller_name: string | null;
  branch_name: string | null;
  branch_number: string | null;
} {
  const sellerMatch = html.match(/Seller[:\s]*<[^>]*>([^<]+)</i) ||
                      html.match(/"sellerName"[:\s]*"([^"]+)"/i);

  const branchNameMatch = html.match(/(?:Branch|Yard)\s*Name[:\s]*<[^>]*>([^<]+)</i) ||
                          html.match(/(?:Branch|Yard)[:\s]*<[^>]*>([^<]+)</i) ||
                          html.match(/"branchName"[:\s]*"([^"]+)"/i);

  const branchNumMatch = html.match(/(?:Branch|Yard)\s*(?:#|Number)[:\s]*<[^>]*>([^<]+)</i) ||
                         html.match(/"branchNumber"[:\s]*"([^"]+)"/i);

  return {
    seller_name: cleanText(sellerMatch?.[1]),
    branch_name: cleanText(branchNameMatch?.[1]),
    branch_number: cleanText(branchNumMatch?.[1]),
  };
}

function extractLocation(html: string): {
  location: string | null;
  yard_name: string | null;
  yard_number: string | null;
} {
  const locationMatch = html.match(/Location[:\s]*<[^>]*>([^<]+)</i) ||
                        html.match(/"location"[:\s]*"([^"]+)"/i) ||
                        html.match(/Yard\s*Location[:\s]*<[^>]*>([^<]+)</i);

  const yardNameMatch = html.match(/Yard\s*Name[:\s]*<[^>]*>([^<]+)</i) ||
                        html.match(/"yardName"[:\s]*"([^"]+)"/i);

  const yardNumMatch = html.match(/Yard\s*(?:#|Number)[:\s]*<[^>]*>([^<]+)</i) ||
                       html.match(/"yardNumber"[:\s]*"([^"]+)"/i);

  return {
    location: cleanText(locationMatch?.[1]),
    yard_name: cleanText(yardNameMatch?.[1]),
    yard_number: cleanText(yardNumMatch?.[1]),
  };
}

function extractImages(html: string): string[] {
  const imageUrls: string[] = [];
  const seen = new Set<string>();

  // Pattern 1: IAA image gallery URLs
  // Often in format: https://vis.iaai.com/resizer?imageKeys=...
  const iaaImagePattern = /https?:\/\/(?:vis|cdn|images?)\.iaai\.com[^"'\s<>]+/gi;
  const iaaMatches = html.match(iaaImagePattern) || [];
  for (const url of iaaMatches) {
    const cleanUrl = url.split('?')[0];
    if (!seen.has(cleanUrl) && !cleanUrl.includes('logo') && !cleanUrl.includes('icon')) {
      seen.add(cleanUrl);
      imageUrls.push(cleanUrl);
    }
  }

  // Pattern 2: data-gallery or gallery items
  const galleryMatch = html.match(/data-gallery[^>]*=["']([^"']+)["']/i);
  if (galleryMatch) {
    try {
      const decoded = decodeHtmlEntities(galleryMatch[1]);
      const items = JSON.parse(decoded);
      if (Array.isArray(items)) {
        for (const item of items) {
          const imgUrl = item?.url || item?.src || item?.full || item;
          if (typeof imgUrl === 'string' && !seen.has(imgUrl)) {
            seen.add(imgUrl);
            imageUrls.push(imgUrl);
          }
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Pattern 3: Standard img tags with vehicle images
  const imgTagPattern = /<img[^>]+src=["']([^"']+(?:vehicle|veh|car|image)[^"']*\.(jpg|jpeg|png|webp))["']/gi;
  let imgMatch;
  while ((imgMatch = imgTagPattern.exec(html)) !== null) {
    const url = imgMatch[1];
    const cleanUrl = url.split('?')[0];
    if (!seen.has(cleanUrl) && !cleanUrl.includes('logo') && !cleanUrl.includes('icon') && !cleanUrl.includes('thumbnail')) {
      seen.add(cleanUrl);
      imageUrls.push(cleanUrl.startsWith('http') ? cleanUrl : `https://www.iaai.com${cleanUrl}`);
    }
  }

  // Pattern 4: JSON-embedded images
  const jsonImagePattern = /"(?:imageUrl|image|fullUrl|largeUrl)"[:\s]*"(https?:\/\/[^"]+)"/gi;
  let jsonMatch;
  while ((jsonMatch = jsonImagePattern.exec(html)) !== null) {
    const url = jsonMatch[1];
    if (!seen.has(url) && url.includes('iaai')) {
      seen.add(url);
      imageUrls.push(url);
    }
  }

  return imageUrls;
}

// ============================================================================
// FETCH PAGE
// ============================================================================

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

async function fetchIAAPage(url: string): Promise<{ html: string; source: string }> {
  // Try direct fetch first (FREE)
  console.log(`[iaa] Trying direct fetch: ${url}`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const html = await response.text();
      // Verify we got actual vehicle content (not a blocked page)
      if (html.includes('VIN') || html.includes('Stock') || html.includes('vehicle')) {
        console.log(`[iaa] Direct fetch SUCCESS (${html.length} bytes)`);
        return { html, source: 'direct' };
      }
      console.log(`[iaa] Direct fetch missing vehicle content, trying Firecrawl...`);
    } else if (response.status === 403 || response.status === 429) {
      console.log(`[iaa] Rate limited (HTTP ${response.status}), trying Firecrawl...`);
    } else {
      console.log(`[iaa] Direct fetch failed (HTTP ${response.status}), trying Firecrawl...`);
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.log(`[iaa] Direct fetch timeout, trying Firecrawl...`);
    } else {
      console.log(`[iaa] Direct fetch error: ${err.message}, trying Firecrawl...`);
    }
  }

  // Don't auto-fallback to Firecrawl - it burns credits
  // Return error with instructions instead
  throw new Error(JSON.stringify({
    error: "IAA has bot protection. Direct fetch failed.",
    instructions: {
      option_1: "Use Playwright MCP to fetch with browser automation",
      option_2: "Save page HTML manually and POST with 'html' in body",
      option_3: "NMVTIS ($10k) provides official salvage records without scraping"
    }
  }));
}

// ============================================================================
// MAIN EXTRACTION FUNCTION
// ============================================================================

async function extractIAAListing(url: string): Promise<{ extracted: IAAExtracted; fetchSource: string }> {
  // Validate URL
  if (!url.includes('iaai.com')) {
    throw new Error('Invalid IAA URL - must be from iaai.com');
  }

  // Fetch page
  const { html, source } = await fetchIAAPage(url);

  // Extract all data
  const titleData = extractTitle(html);
  const damageData = extractDamageInfo(html);
  const specs = extractSpecs(html);
  const titleInfo = extractTitleInfo(html);
  const auctionData = extractAuctionData(html);
  const sellerInfo = extractSellerInfo(html);
  const locationInfo = extractLocation(html);

  const extracted: IAAExtracted = {
    url,
    stock_number: extractStockNumber(html),
    item_id: extractItemId(url, html),
    ...titleData,
    vin: extractVin(html),
    ...specs,
    ...damageData,
    ...titleInfo,
    ...auctionData,
    ...sellerInfo,
    ...locationInfo,
    image_urls: extractImages(html),
    listing_created_at: new Date().toISOString(),
  };

  return { extracted, fetchSource: source };
}

// ============================================================================
// HTTP HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url, save_to_db, vehicle_id } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[iaa] Extracting: ${url}`);
    const { extracted, fetchSource } = await extractIAAListing(url);

    // Log results
    console.log(`=== IAA EXTRACTION RESULTS ===`);
    console.log(`Title: ${extracted.title}`);
    console.log(`Year/Make/Model: ${extracted.year} ${extracted.make} ${extracted.model}`);
    console.log(`VIN: ${extracted.vin || 'NOT FOUND'}`);
    console.log(`Stock #: ${extracted.stock_number || 'NOT FOUND'}`);
    console.log(`Primary Damage: ${extracted.primary_damage || 'N/A'}`);
    console.log(`Sale Date: ${extracted.sale_date || 'N/A'}`);
    console.log(`Sale Status: ${extracted.sale_status}`);
    console.log(`Sale Price: $${extracted.sale_price?.toLocaleString() || 'N/A'}`);
    console.log(`Mileage: ${extracted.mileage?.toLocaleString() || 'N/A'}`);
    console.log(`Location: ${extracted.location || 'N/A'}`);
    console.log(`Images: ${extracted.image_urls.length}`);
    console.log(`Fetch source: ${fetchSource}`);

    // Track DB operation results
    const dbErrors: string[] = [];
    let imagesSaved = 0;
    let externalListingSaved = false;

    // Save to database if requested
    if (save_to_db || vehicle_id) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );

      let targetVehicleId = vehicle_id;

      if (vehicle_id) {
        // Update existing vehicle
        const { error: updateError } = await supabase
          .from('vehicles')
          .update({
            year: extracted.year,
            make: extracted.make,
            model: extracted.model,
            vin: extracted.vin || undefined,
            mileage: extracted.mileage,
            color: extracted.exterior_color,
            interior_color: extracted.interior_color,
            transmission: extracted.transmission,
            engine_type: extracted.engine,
            drivetrain: extracted.drivetrain,
            body_style: extracted.body_style,
            sale_price: extracted.sale_price,
            high_bid: extracted.high_bid,
            sale_status: extracted.sale_status === 'sold' ? 'sold' :
                         extracted.sale_status === 'upcoming' ? 'available' : 'ended',
          })
          .eq('id', vehicle_id);

        if (updateError) throw new Error(`Failed to update vehicle: ${updateError.message}`);
        console.log(`[iaa] Updated vehicle: ${vehicle_id}`);
        extracted.vehicle_id = vehicle_id;
      } else {
        // Insert new vehicle
        const { data, error } = await supabase
          .from('vehicles')
          .insert({
            year: extracted.year,
            make: extracted.make,
            model: extracted.model,
            vin: extracted.vin,
            mileage: extracted.mileage,
            color: extracted.exterior_color,
            interior_color: extracted.interior_color,
            transmission: extracted.transmission,
            engine_type: extracted.engine,
            drivetrain: extracted.drivetrain,
            body_style: extracted.body_style,
            sale_price: extracted.sale_price,
            high_bid: extracted.high_bid,
            listing_source: 'iaa_extract',
            profile_origin: 'iaa_import',
            discovery_url: extracted.url,
            discovery_source: 'iaa',
            is_public: true,
            sale_status: extracted.sale_status === 'sold' ? 'sold' :
                         extracted.sale_status === 'upcoming' ? 'available' : 'ended',
          })
          .select()
          .single();

        if (error) throw new Error(`Failed to insert vehicle: ${error.message}`);
        console.log(`[iaa] Created vehicle: ${data.id}`);
        extracted.vehicle_id = data.id;
        targetVehicleId = data.id;
      }

      // Save images
      if (extracted.image_urls.length > 0 && targetVehicleId) {
        const imageRecords = extracted.image_urls.slice(0, 100).map((img_url, i) => ({
          vehicle_id: targetVehicleId,
          image_url: img_url,
          source: 'iaa',
          source_url: img_url,
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
            imported_from: 'iaa',
          },
        }));

        // Delete existing iaa images for this vehicle to avoid duplicates
        await supabase
          .from('vehicle_images')
          .delete()
          .eq('vehicle_id', targetVehicleId)
          .eq('source', 'iaa');

        const { data: insertedImages, error: imgError } = await supabase
          .from('vehicle_images')
          .insert(imageRecords)
          .select('id');

        if (imgError) {
          console.error('[iaa] Image save error:', JSON.stringify(imgError));
          dbErrors.push(`images: ${imgError.message || JSON.stringify(imgError)}`);
        } else {
          imagesSaved = insertedImages?.length || 0;
          console.log(`[iaa] Saved ${imagesSaved} images for vehicle ${targetVehicleId}`);
        }
      }

      // Create/update external_listings record
      if (targetVehicleId) {
        const listingUrlKey = normalizeListingUrlKey(extracted.url);
        console.log(`[iaa] Creating external_listing with url_key: ${listingUrlKey}`);

        const { error: listingError } = await supabase
          .from('external_listings')
          .upsert({
            vehicle_id: targetVehicleId,
            platform: 'iaa',
            listing_url: extracted.url,
            listing_url_key: listingUrlKey,
            listing_id: extracted.stock_number || extracted.item_id || listingUrlKey,
            listing_status: extracted.sale_status,
            end_date: extracted.sale_date,
            final_price: extracted.sale_price,
            metadata: {
              stock_number: extracted.stock_number,
              item_id: extracted.item_id,
              primary_damage: extracted.primary_damage,
              secondary_damage: extracted.secondary_damage,
              loss_type: extracted.loss_type,
              title_state: extracted.title_state,
              title_type: extracted.title_type,
              keys_available: extracted.keys_available,
              airbags: extracted.airbags,
              branch_name: extracted.branch_name,
              yard_name: extracted.yard_name,
              lane: extracted.lane,
              grid_row: extracted.grid_row,
            },
          }, { onConflict: 'platform,listing_url_key' });

        if (listingError) {
          console.error('[iaa] External listing save error:', JSON.stringify(listingError));
          dbErrors.push(`external_listing: ${listingError.message || JSON.stringify(listingError)}`);
        } else {
          externalListingSaved = true;
          console.log(`[iaa] Created external_listings record`);
        }
      }

      // Add timeline events
      if (targetVehicleId && extracted.sale_date && extracted.sale_status === 'sold' && extracted.sale_price) {
        const events = [{
          vehicle_id: targetVehicleId,
          event_type: 'auction_sold',
          event_date: extracted.sale_date,
          title: `Sold at IAA for $${extracted.sale_price.toLocaleString()}`,
          description: `${extracted.primary_damage ? `Primary damage: ${extracted.primary_damage}. ` : ''}` +
                       `${extracted.location ? `Location: ${extracted.location}` : ''}`,
          source: 'iaa_import',
          metadata: {
            stock_number: extracted.stock_number,
            sale_price: extracted.sale_price,
            primary_damage: extracted.primary_damage,
            loss_type: extracted.loss_type,
          },
        }];

        await supabase.from('timeline_events').insert(events);
        console.log(`[iaa] Created timeline event`);
      }
    }

    // Build response
    const response: any = {
      success: true,
      extracted,
      _fetch: { source: fetchSource },
      _db: (save_to_db || vehicle_id) ? {
        vehicle_saved: !!extracted.vehicle_id,
        images_saved: imagesSaved,
        external_listing_saved: externalListingSaved,
        errors: dbErrors,
      } : null,
    };

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[iaa] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
