/**
 * BH Auction Extractor - Japanese collector car auctions
 *
 * BH Auction (BINGO Co., Ltd.) runs premium collector car auctions in Japan,
 * partnering with Tokyo Auto Salon. Specialty: JDM legends - Skylines, Supras, NSX, Land Cruisers.
 *
 * URL Patterns:
 * - Results: /en/result/{auction-slug}/lots/{vehicle-slug}
 * - Upcoming: /en/auction/{auction-slug}/lots/{vehicle-slug}
 * - Lots index: /en/result/{auction-slug}/lots/ or /en/auction/{auction-slug}/lots/
 *
 * Usage:
 *   POST {"url": "https://bhauction.com/en/result/jdm-collectible-auction/lots/2000-toyota-supra-gt500"}
 *   POST {"url": "https://bhauction.com/en/result/jdm-collectible-auction/lots/", "batch": true}
 *   POST {"auction_slug": "bh-auction-1-10-cctb", "batch": true}
 *
 * Deploy: supabase functions deploy extract-bh-auction --no-verify-jwt
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizeListingUrlKey } from '../_shared/listingUrl.ts';

// Direct fetch - BH Auction has no Cloudflare/bot protection
async function fetchPage(url: string): Promise<{ html: string; success: boolean; error?: string }> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (!response.ok) {
      return { html: '', success: false, error: `HTTP ${response.status}` };
    }

    const html = await response.text();
    return { html, success: true };
  } catch (error: any) {
    return { html: '', success: false, error: error.message };
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// JPY to USD conversion (approximate, for reference only)
const JPY_TO_USD = 0.0067; // ~150 JPY = 1 USD

interface BHAuctionExtracted {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  chassis_number: string | null;

  // Pricing (Japanese auctions use JPY)
  price_jpy: number | null;
  price_usd: number | null;
  estimate_low_jpy: number | null;
  estimate_high_jpy: number | null;

  // Auction metadata
  lot_number: string | null;
  auction_name: string | null;
  auction_date: string | null;
  auction_status: 'sold' | 'unsold' | 'upcoming' | null;

  // Vehicle specs
  mileage: number | null;
  mileage_unit: 'km' | 'miles' | null;
  engine: string | null;
  transmission: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  body_style: string | null;

  // Content
  description: string | null;

  // Images
  image_urls: string[];

  // Metadata
  vehicle_id?: string;
  scrape_source: 'direct';
}

// Japanese make name normalization
const MAKE_ALIASES: Record<string, string> = {
  'nissan': 'Nissan',
  'toyota': 'Toyota',
  'honda': 'Honda',
  'mazda': 'Mazda',
  'mitsubishi': 'Mitsubishi',
  'subaru': 'Subaru',
  'suzuki': 'Suzuki',
  'daihatsu': 'Daihatsu',
  'isuzu': 'Isuzu',
  'lexus': 'Lexus',
  'infiniti': 'Infiniti',
  'acura': 'Acura',
  'porsche': 'Porsche',
  'ferrari': 'Ferrari',
  'lamborghini': 'Lamborghini',
  'mercedes': 'Mercedes-Benz',
  'mercedes-benz': 'Mercedes-Benz',
  'bmw': 'BMW',
  'audi': 'Audi',
  'volkswagen': 'Volkswagen',
  'alfa': 'Alfa Romeo',
  'alfa romeo': 'Alfa Romeo',
  'jaguar': 'Jaguar',
  'aston': 'Aston Martin',
  'aston martin': 'Aston Martin',
  'chevrolet': 'Chevrolet',
  'ford': 'Ford',
  'dodge': 'Dodge',
  'lancia': 'Lancia',
  'fiat': 'Fiat',
  'alpina': 'Alpina',
  'tommykaira': 'Tommykaira',
  'nismo': 'Nissan',
};

// VIN patterns for various manufacturers
const VIN_PATTERNS = [
  /\b([1-5][A-HJ-NPR-Z0-9]{16})\b/g,       // US/Canada/Mexico
  /\b(J[A-HJ-NPR-Z0-9]{16})\b/g,           // Japan
  /\b(K[A-HJ-NPR-Z0-9]{16})\b/g,           // Korea
  /\b(W[A-HJ-NPR-Z0-9]{16})\b/g,           // Germany
  /\b(Z[A-HJ-NPR-Z0-9]{16})\b/g,           // Italy
  /\b(S[A-HJ-NPR-Z0-9]{16})\b/g,           // UK
];

// Japanese chassis number patterns (Nissan, Toyota, etc.)
const CHASSIS_PATTERNS = [
  // Explicit VIN label in BH Auction pages
  /VIN\s+([A-Z0-9\-]{6,17})/i,
  // Nissan Skyline patterns: BNR32, BNR34, KPGC10, etc.
  /\b(BNR3[24]-\d{6})\b/gi,
  /\b(BCNR33-\d{6})\b/gi,
  /\b(BN[RS]\d{2}-\d{5,6})\b/gi,
  /\b(KPGC10-\d{5,6})\b/gi,
  /\b(KPGC110-\d{5,6})\b/gi,
  // Toyota patterns
  /\b(JZA80-\d{6})\b/gi,
  /\b(MA70-\d{6})\b/gi,
  /\b(A80-\d{6})\b/gi,
  // Honda NSX
  /\b(NA[12]-\d{6})\b/gi,
  // General Japanese chassis: ABC12-123456
  /\b([A-Z]{2,5}\d{2}-\d{5,7})\b/gi,
  // European patterns
  /chassis\s*(?:number|no\.?|#)?\s*:?\s*([A-Z0-9\-\/]{6,20})/i,
];

function parseJPY(raw: string | null): number | null {
  if (!raw) return null;

  // Remove currency symbol and commas: "¥98,346,000" -> "98346000"
  const cleaned = raw.replace(/[¥￥,\s]/g, '');
  const num = parseInt(cleaned, 10);

  return Number.isFinite(num) && num > 0 ? num : null;
}

function extractVinOrChassis(text: string): { vin: string | null; chassis: string | null } {
  let vin: string | null = null;
  let chassis: string | null = null;

  // Try VIN first (17-char modern VINs)
  for (const pattern of VIN_PATTERNS) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      vin = matches[0].toUpperCase();
      break;
    }
  }

  // Try chassis number (Japanese format)
  for (const pattern of CHASSIS_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const candidate = match[1].trim().toUpperCase();
      // Validate: reasonable length, alphanumeric with hyphens
      if (candidate.length >= 6 && candidate.length <= 20 && /^[A-Z0-9\-\/]+$/i.test(candidate)) {
        chassis = candidate;
        break;
      }
    }
  }

  return { vin, chassis };
}

function extractTitle(text: string): { title: string | null; year: number | null; make: string | null; model: string | null } {
  // BH Auction titles: "1999 Tommykaira R-Z" or "2000 Toyota Supra GT500"
  // Look for "VIEW MORE {year} {make} {model}" pattern which is consistent across pages

  const viewMoreMatch = text.match(/VIEW\s+MORE\s+((19|20)\d{2})\s+([A-Za-z][A-Za-z0-9\-]+(?:\s+[A-Za-z0-9\-\[\]()]+)*?)(?=\s*(?:Tommykaira|Maintained|Owned|Retains|Debuting|Based|One\s+of|This|The))/i);

  if (viewMoreMatch) {
    const year = parseInt(viewMoreMatch[1]);
    const fullName = viewMoreMatch[3].trim();

    // Parse make and model from full name
    const parts = fullName.split(/\s+/);
    let make = parts[0];
    const normalized = MAKE_ALIASES[make.toLowerCase()];
    if (normalized) make = normalized;

    const model = parts.slice(1).join(' ') || null;
    const title = `${year} ${make} ${model || ''}`.trim();

    return { title, year, make, model };
  }

  // Fallback: Look for "LOTS {year} {make} {model} VIEW" pattern
  const lotsMatch = text.match(/LOTS\s+((19|20)\d{2})\s+([A-Za-z][A-Za-z0-9\-]+(?:\s+[A-Za-z0-9\-\[\]()]+)*?)\s+VIEW/i);
  if (lotsMatch) {
    const year = parseInt(lotsMatch[1]);
    const fullName = lotsMatch[3].trim();
    const parts = fullName.split(/\s+/);
    let make = parts[0];
    const normalized = MAKE_ALIASES[make.toLowerCase()];
    if (normalized) make = normalized;
    const model = parts.slice(1).join(' ') || null;
    const title = `${year} ${make} ${model || ''}`.trim();
    return { title, year, make, model };
  }

  // Try looking for title in the format "RESULT {year} {make} {model}" at end of page
  const resultMatch = text.match(/RESULT\s+((19|20)\d{2})\s+([A-Za-z][A-Za-z0-9\-]+(?:\s+[A-Za-z0-9\-\[\]()]+)*?)\s+PRIVACY/i);
  if (resultMatch) {
    const year = parseInt(resultMatch[1]);
    const fullName = resultMatch[3].trim();
    const parts = fullName.split(/\s+/);
    let make = parts[0];
    const normalized = MAKE_ALIASES[make.toLowerCase()];
    if (normalized) make = normalized;
    const model = parts.slice(1).join(' ') || null;
    const title = `${year} ${make} ${model || ''}`.trim();
    return { title, year, make, model };
  }

  return { title: null, year: null, make: null, model: null };
}

function extractPrice(text: string): {
  price_jpy: number | null;
  price_usd: number | null;
  estimate_low_jpy: number | null;
  estimate_high_jpy: number | null;
  auction_status: 'sold' | 'unsold' | 'upcoming' | null;
} {
  let price_jpy: number | null = null;
  let estimate_low_jpy: number | null = null;
  let estimate_high_jpy: number | null = null;
  let auction_status: 'sold' | 'unsold' | 'upcoming' | null = null;

  // Look for sold price: "¥98,346,000" or "Sold for ¥..."
  const soldMatch = text.match(/(?:sold\s*(?:for)?|hammer\s*price|final\s*price)[:\s]*[¥￥]?\s*([\d,]+)/i) ||
                    text.match(/[¥￥]\s*([\d,]+(?:,\d{3})*)\s*(?:\(|$|\n)/);

  if (soldMatch) {
    price_jpy = parseJPY(soldMatch[1]);
    if (price_jpy) auction_status = 'sold';
  }

  // Look for estimate range: "¥180,000,000 - ¥220,000,000" or "Estimate: ¥180,000,000–¥220,000,000"
  const estimateMatch = text.match(/[¥￥]\s*([\d,]+)\s*[-–]\s*[¥￥]?\s*([\d,]+)/i);
  if (estimateMatch) {
    estimate_low_jpy = parseJPY(estimateMatch[1]);
    estimate_high_jpy = parseJPY(estimateMatch[2]);
    if (!price_jpy) auction_status = 'upcoming';
  }

  // Check for "not sold" or "reserve not met" indicators
  if (text.match(/not\s*sold|reserve\s*not\s*met|unsold|bid\s*not\s*met/i)) {
    auction_status = 'unsold';
  }

  // Check for "coming soon" indicator
  if (text.match(/coming\s*soon|estimate\s*coming/i)) {
    auction_status = 'upcoming';
  }

  const price_usd = price_jpy ? Math.round(price_jpy * JPY_TO_USD) : null;

  return { price_jpy, price_usd, estimate_low_jpy, estimate_high_jpy, auction_status };
}

function extractLotNumber(text: string): string | null {
  // "LOT NUMBER 7" or "LOT 8" or "Lot #22" or "Lot: 7"
  const match = text.match(/lot\s*(?:number|no\.?|#)?\s*[:\s]*(\d+)/i);
  return match ? match[1] : null;
}

function extractAuctionName(text: string, url: string): { name: string | null; date: string | null } {
  // Try to get from URL path: /bh-auction-1-10-cctb/
  const urlMatch = url.match(/\/(?:result|auction)\/([^\/]+)\//);
  let name = urlMatch ? urlMatch[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : null;

  // Try to get from text: "BH AUCTION 1.10 at City Circuit Tokyo Bay"
  const nameMatch = text.match(/BH\s+AUCTION\s+[\d.]+(?:\s+at\s+[^|<\n]+)?/i) ||
                    text.match(/Collection\s+Car\s+Auction[^|<\n]{0,50}/i) ||
                    text.match(/JDM\s+Collectible\s+Auction[^|<\n]{0,50}/i);
  if (nameMatch) {
    name = nameMatch[0].trim().replace(/\s+/g, ' ');
  }

  // Extract date: "2026/01/09-2026/01/10" or "January 9-10, 2026"
  let date: string | null = null;
  const dateMatch = text.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  if (dateMatch) {
    date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
  }

  return { name, date };
}

function extractSpecs(text: string): {
  mileage: number | null;
  mileage_unit: 'km' | 'miles' | null;
  engine: string | null;
  transmission: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  body_style: string | null;
} {
  let mileage: number | null = null;
  let mileage_unit: 'km' | 'miles' | null = null;
  let engine: string | null = null;
  let transmission: string | null = null;
  let exterior_color: string | null = null;
  let interior_color: string | null = null;
  let body_style: string | null = null;

  // Mileage: "Mileage 69,715 km" or "69,715 km" pattern
  // Look for explicit Mileage label first
  const mileageLabelMatch = text.match(/Mileage\s+(\d{1,3}(?:,\d{3})*)\s*(km|miles?|kms?)/i);
  if (mileageLabelMatch) {
    mileage = parseInt(mileageLabelMatch[1].replace(/,/g, ''), 10);
    mileage_unit = mileageLabelMatch[2].toLowerCase().startsWith('km') ? 'km' : 'miles';
  } else {
    // Fallback: larger number + km (to avoid matching small numbers)
    const mileageMatch = text.match(/(\d{2,3}(?:,\d{3})+)\s*(km|miles?|kms?)/i);
    if (mileageMatch) {
      mileage = parseInt(mileageMatch[1].replace(/,/g, ''), 10);
      mileage_unit = mileageMatch[2].toLowerCase().startsWith('km') ? 'km' : 'miles';
    }
  }

  // Engine: JDM engines are often specific codes
  const enginePatterns = [
    /\b(RB26(?:DETT)?)\b/i,
    /\b(2JZ(?:-GTE|-GE)?)\b/i,
    /\b(SR20DET)\b/i,
    /\b(VQ35DE)\b/i,
    /\b(C30A|F20C|K20A)\b/i,
    /\b(4G63[T]?)\b/i,
    /\b(13B-REW|13B-MSP)\b/i,
    /\b(B16[AB]|B18C)\b/i,
    /\b(1JZ-GTE|1JZ-GE)\b/i,
    /\b(S50B30|S54B32)\b/i,  // BMW M
    /(\d+(?:\.\d+)?)[- ]?(?:liter|litre|L)\s+(V\d+|V-\d+|inline-\d+|flat-\d+|I\d+)/i,
    /mid-mounted\s+(\d+(?:\.\d+)?)[- ]?(?:liter|litre)\s+(V\d+)/i,
  ];

  for (const pattern of enginePatterns) {
    const match = text.match(pattern);
    if (match) {
      engine = match[1] + (match[2] ? ` ${match[2]}` : '');
      engine = engine.trim().slice(0, 100);
      break;
    }
  }

  // Transmission - look for speed + manual/auto
  const transMatch = text.match(/(\d)[- ]speed\s+(manual|automatic)/i);
  if (transMatch) {
    transmission = `${transMatch[1]}-Speed ${transMatch[2].charAt(0).toUpperCase() + transMatch[2].slice(1).toLowerCase()}`;
  } else if (text.match(/\bmanual\s+transmission\b/i)) {
    transmission = 'Manual';
  } else if (text.match(/\bautomatic\s+transmission\b/i)) {
    transmission = 'Automatic';
  }

  // Colors - look for explicit color mentions
  const colorPatterns = [
    /(?:finished in|painted)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    /(?:exterior|color|colour)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
  ];
  for (const pattern of colorPatterns) {
    const match = text.match(pattern);
    if (match && match[1].length < 30 && !/^(the|and|with|from)$/i.test(match[1])) {
      exterior_color = match[1].trim();
      break;
    }
  }

  // Body style from title or text
  const textLower = text.toLowerCase();
  if (textLower.includes('gt-r') || textLower.includes('gtr')) body_style = 'Coupe';
  else if (textLower.includes('supra') || textLower.includes('nsx')) body_style = 'Coupe';
  else if (textLower.includes('coupe') || textLower.includes('gtb')) body_style = 'Coupe';
  else if (textLower.includes('gts') && textLower.includes('spider')) body_style = 'Convertible';
  else if (textLower.includes('convertible') || textLower.includes('roadster') || textLower.includes('spider') || textLower.includes('speedster')) body_style = 'Convertible';
  else if (textLower.includes('sedan') || textLower.includes('saloon')) body_style = 'Sedan';
  else if (textLower.includes('wagon') || textLower.includes('estate') || textLower.includes('avant')) body_style = 'Wagon';
  else if (textLower.includes('suv') || textLower.includes('land cruiser')) body_style = 'SUV';
  else if (textLower.includes('truck') || textLower.includes('pickup')) body_style = 'Truck';

  return { mileage, mileage_unit, engine, transmission, exterior_color, interior_color, body_style };
}

function extractDescription(text: string): string | null {
  // Extract main description - find the main content block
  // Look for description-like content after the title info

  // Try to find content starting with "Debuting" "This" "Owned" "Maintained" etc.
  const descPatterns = [
    /(?:Debuting|This\s+(?:particular|example|car)|Owned\s+by|Maintained\s+by)[^.]+\.(?:[^.]+\.){1,10}/i,
    /(?:produced|manufactured|built)\s+(?:by|in|at)[^.]+\.[^.]+\./i,
  ];

  for (const pattern of descPatterns) {
    const match = text.match(pattern);
    if (match && match[0].length > 100) {
      return match[0].trim().slice(0, 3000);
    }
  }

  // Fallback: find a substantial text block
  const sentences = text.split(/\.(?:\s+|$)/).filter(s => s.length > 50);
  if (sentences.length > 2) {
    const descLines: string[] = [];
    let foundStart = false;

    for (const sentence of sentences) {
      // Skip navigation-like content
      if (sentence.match(/BINGO|HOME|AUCTION|BUY|SELL|PRIVACY|CONTACT/i)) continue;
      if (sentence.match(/^(VIN|Engine|Mileage|LOT)\s/i)) continue;

      // Start capturing after we find descriptive content
      if (!foundStart && sentence.match(/(?:Debuting|This|Owned|Maintained|produced|One of)/i)) {
        foundStart = true;
      }

      if (foundStart) {
        descLines.push(sentence.trim() + '.');
        if (descLines.length > 10) break;
      }
    }

    if (descLines.length > 0) {
      return descLines.join(' ').slice(0, 3000);
    }
  }

  return null;
}

function extractImages(html: string, markdown: string): string[] {
  const images: string[] = [];

  // From markdown: ![...](https://...)
  const mdMatches = markdown.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)]+\.(?:jpg|jpeg|png|webp))/gi);
  for (const match of mdMatches) {
    if (match[1] && !images.includes(match[1])) {
      images.push(match[1]);
    }
  }

  // From HTML: <img src="...">
  const imgMatches = html.matchAll(/<img[^>]*src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp))"/gi);
  for (const match of imgMatches) {
    if (match[1] && !match[1].includes('placeholder') && !match[1].includes('s.png') && !images.includes(match[1])) {
      images.push(match[1]);
    }
  }

  // From HTML: data-src for lazy loaded images
  const dataSrcMatches = html.matchAll(/data-src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp))"/gi);
  for (const match of dataSrcMatches) {
    if (match[1] && !images.includes(match[1])) {
      images.push(match[1]);
    }
  }

  // From HTML: background-image: url(...)
  const bgMatches = html.matchAll(/background-image:\s*url\(['"]?(https?:\/\/[^'")\s]+\.(?:jpg|jpeg|png|webp))['"]?\)/gi);
  for (const match of bgMatches) {
    if (match[1] && !images.includes(match[1])) {
      images.push(match[1]);
    }
  }

  return [...new Set(images)];
}

async function extractBHAuctionListing(url: string): Promise<BHAuctionExtracted> {
  console.log(`[BH Auction] Fetching: ${url}`);

  const result = await fetchPage(url);

  if (!result.success || !result.html) {
    throw new Error(`Fetch failed: ${result.error || 'No content returned'}`);
  }

  const html = result.html;
  // Convert HTML to plain text for extraction
  const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                   .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                   .replace(/<[^>]+>/g, ' ')
                   .replace(/\s+/g, ' ');

  console.log(`[BH Auction] Got ${html.length} bytes HTML`);

  const titleData = extractTitle(text);
  const { vin, chassis } = extractVinOrChassis(text);
  const priceData = extractPrice(text);
  const auctionData = extractAuctionName(text, url);
  const specs = extractSpecs(text);
  const description = extractDescription(text);
  const images = extractImages(html, text);
  const lot_number = extractLotNumber(text);

  console.log(`[BH Auction] Extracted: ${titleData.title}`);
  console.log(`[BH Auction] Year/Make/Model: ${titleData.year} ${titleData.make} ${titleData.model}`);
  console.log(`[BH Auction] Lot: ${lot_number} | VIN: ${vin || 'N/A'} | Chassis: ${chassis || 'N/A'}`);
  console.log(`[BH Auction] Price: ¥${priceData.price_jpy?.toLocaleString() || 'N/A'} (~$${priceData.price_usd?.toLocaleString() || 'N/A'})`);
  console.log(`[BH Auction] Status: ${priceData.auction_status || 'unknown'}`);
  console.log(`[BH Auction] Specs: ${specs.mileage || '?'}${specs.mileage_unit || ''} | ${specs.engine || '?'} | ${specs.transmission || '?'}`);
  console.log(`[BH Auction] Images: ${images.length}`);

  return {
    url,
    ...titleData,
    vin,
    chassis_number: chassis,
    ...priceData,
    lot_number,
    auction_name: auctionData.name,
    auction_date: auctionData.date,
    ...specs,
    description,
    image_urls: images,
    scrape_source: 'direct',
  };
}

async function discoverLotUrls(lotsPageUrl: string): Promise<string[]> {
  console.log(`[BH Auction] Discovering lots from: ${lotsPageUrl}`);

  // Direct fetch to find all lot URLs
  const result = await fetchPage(lotsPageUrl);

  if (!result.success || !result.html) {
    console.log(`[BH Auction] Failed to fetch lots page: ${result.error}`);
    return [];
  }

  // Parse lot links from HTML
  const lotMatches = result.html.matchAll(/href="(\/en\/(?:result|auction)\/[^"]+\/lots\/[^"]+)"/gi);
  const urls: string[] = [];
  for (const match of lotMatches) {
    const fullUrl = `https://bhauction.com${match[1]}`;
    if (!urls.includes(fullUrl) && !fullUrl.endsWith('/lots/')) {
      urls.push(fullUrl);
    }
  }

  console.log(`[BH Auction] Found ${urls.length} lot URLs`);
  return urls;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { url, auction_slug, batch, save_to_db = true, limit = 50 } = body;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Mode 1: Single lot extraction
    if (url && !batch) {
      if (!url.includes('bhauction.com')) {
        return new Response(
          JSON.stringify({ error: 'Invalid BH Auction URL' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const extracted = await extractBHAuctionListing(url);

      // Log API usage
      await supabase.from('api_usage_logs').insert({
        user_id: null,
        provider: 'firecrawl',
        function_name: 'extract-bh-auction',
        cost_cents: 1,
        success: true,
        metadata: { url, lot_number: extracted.lot_number },
      });

      // Save to database if requested
      if (save_to_db && extracted.year && extracted.make) {
        const vehicleData = {
          year: extracted.year,
          make: extracted.make,
          model: extracted.model,
          vin: extracted.vin || extracted.chassis_number,
          mileage: extracted.mileage,
          color: extracted.exterior_color,
          interior_color: extracted.interior_color,
          transmission: extracted.transmission,
          engine_type: extracted.engine,
          body_style: extracted.body_style,
          description: extracted.description,
          sale_price: extracted.price_usd, // Store USD for consistency
          sale_status: extracted.auction_status === 'sold' ? 'sold' : 'available',
          discovery_url: extracted.url,
          discovery_source: 'bh_auction',
          profile_origin: 'bh_auction_import',
          is_public: true,
          origin_metadata: {
            source: 'bh_auction',
            lot_number: extracted.lot_number,
            auction_name: extracted.auction_name,
            auction_date: extracted.auction_date,
            price_jpy: extracted.price_jpy,
            price_usd: extracted.price_usd,
            estimate_low_jpy: extracted.estimate_low_jpy,
            estimate_high_jpy: extracted.estimate_high_jpy,
            chassis_number: extracted.chassis_number,
            mileage_unit: extracted.mileage_unit,
            imported_at: new Date().toISOString(),
          },
        };

        // Check for existing vehicle by URL or VIN
        let vehicleId: string | null = null;

        if (extracted.vin || extracted.chassis_number) {
          const { data: existing } = await supabase
            .from('vehicles')
            .select('id')
            .eq('vin', (extracted.vin || extracted.chassis_number)!.toUpperCase())
            .maybeSingle();
          if (existing) vehicleId = existing.id;
        }

        if (!vehicleId) {
          const { data: existing } = await supabase
            .from('vehicles')
            .select('id')
            .eq('discovery_url', extracted.url)
            .maybeSingle();
          if (existing) vehicleId = existing.id;
        }

        if (vehicleId) {
          await supabase.from('vehicles').update(vehicleData).eq('id', vehicleId);
          console.log(`[BH Auction] Updated vehicle: ${vehicleId}`);
        } else {
          const { data: newVehicle, error: vehicleError } = await supabase
            .from('vehicles')
            .insert(vehicleData)
            .select()
            .single();

          if (vehicleError) {
            throw new Error(`Failed to save vehicle: ${vehicleError.message}`);
          }
          vehicleId = newVehicle.id;
          console.log(`[BH Auction] Created vehicle: ${vehicleId}`);
        }

        extracted.vehicle_id = vehicleId;

        // Save images
        if (extracted.image_urls.length > 0 && vehicleId) {
          const imageRecords = extracted.image_urls.map((img_url, i) => ({
            vehicle_id: vehicleId,
            image_url: img_url,
            position: i,
            source: 'bh_auction_import',
            is_external: true,
          }));

          // Insert images (no unique constraint, just insert)
          const { error: imgError } = await supabase.from('vehicle_images').insert(imageRecords);
          if (imgError) {
            console.error(`[BH Auction] Image save error: ${imgError.message}`);
          } else {
            console.log(`[BH Auction] Saved ${imageRecords.length} images`);
          }
        }

        // Create external_listings record
        if (vehicleId) {
          const listingUrlKey = normalizeListingUrlKey(extracted.url);
          await supabase.from('external_listings').upsert({
            vehicle_id: vehicleId,
            platform: 'bh_auction',
            listing_url: extracted.url,
            listing_url_key: listingUrlKey,
            listing_id: extracted.lot_number || listingUrlKey,
            listing_status: extracted.auction_status === 'sold' ? 'sold' : extracted.auction_status === 'upcoming' ? 'active' : 'ended',
            end_date: extracted.auction_date,
            final_price: extracted.price_usd,
            sold_at: extracted.auction_status === 'sold' ? extracted.auction_date : null,
            metadata: {
              lot_number: extracted.lot_number,
              auction_name: extracted.auction_name,
              price_jpy: extracted.price_jpy,
              estimate_low_jpy: extracted.estimate_low_jpy,
              estimate_high_jpy: extracted.estimate_high_jpy,
            },
          }, {
            onConflict: 'platform,listing_url_key',
          });
          console.log(`[BH Auction] Created/updated external_listings record`);
        }
      }

      return new Response(
        JSON.stringify({ success: true, extracted }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Mode 2: Batch extraction from lots page or auction slug
    if (batch) {
      let lotsPageUrl: string;

      if (url) {
        // URL provided - use it directly
        lotsPageUrl = url.endsWith('/lots/') ? url : `${url}/lots/`;
      } else if (auction_slug) {
        // Build URL from slug - try results first (completed auctions have more data)
        lotsPageUrl = `https://bhauction.com/en/result/${auction_slug}/lots/`;
      } else {
        return new Response(
          JSON.stringify({ error: 'Provide url or auction_slug for batch mode' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const lotUrls = await discoverLotUrls(lotsPageUrl);

      if (lotUrls.length === 0) {
        return new Response(
          JSON.stringify({ success: true, message: 'No lots found', processed: 0, results: [] }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Process lots (with limit)
      const toProcess = lotUrls.slice(0, limit);
      const results: any[] = [];
      let successCount = 0;
      let errorCount = 0;

      for (const lotUrl of toProcess) {
        try {
          const extracted = await extractBHAuctionListing(lotUrl);

          // Save to DB if we have valid data
          if (save_to_db && extracted.year && extracted.make) {
            const vehicleData = {
              year: extracted.year,
              make: extracted.make,
              model: extracted.model,
              vin: extracted.vin || extracted.chassis_number,
              mileage: extracted.mileage,
              color: extracted.exterior_color,
              transmission: extracted.transmission,
              engine_type: extracted.engine,
              body_style: extracted.body_style,
              description: extracted.description,
              sale_price: extracted.price_usd,
              sale_status: extracted.auction_status === 'sold' ? 'sold' : 'available',
              discovery_url: extracted.url,
              discovery_source: 'bh_auction',
              profile_origin: 'bh_auction_import',
              is_public: true,
              origin_metadata: {
                source: 'bh_auction',
                lot_number: extracted.lot_number,
                auction_name: extracted.auction_name,
                price_jpy: extracted.price_jpy,
                imported_at: new Date().toISOString(),
              },
            };

            // Check for existing
            let vehicleId: string | null = null;
            const { data: existing } = await supabase
              .from('vehicles')
              .select('id')
              .eq('discovery_url', extracted.url)
              .maybeSingle();

            if (existing) {
              await supabase.from('vehicles').update(vehicleData).eq('id', existing.id);
              vehicleId = existing.id;
            } else {
              const { data: newVehicle } = await supabase
                .from('vehicles')
                .insert(vehicleData)
                .select()
                .single();
              vehicleId = newVehicle?.id || null;
            }

            extracted.vehicle_id = vehicleId || undefined;

            // Save images
            if (extracted.image_urls.length > 0 && vehicleId) {
              const imageRecords = extracted.image_urls.map((img_url, i) => ({
                vehicle_id: vehicleId,
                image_url: img_url,
                position: i,
                source: 'bh_auction_import',
                is_external: true,
              }));

              // Insert images (no unique constraint)
              await supabase.from('vehicle_images').insert(imageRecords);
            }
          }

          results.push({
            url: lotUrl,
            success: true,
            title: extracted.title,
            year: extracted.year,
            make: extracted.make,
            model: extracted.model,
            price_jpy: extracted.price_jpy,
            vehicle_id: extracted.vehicle_id,
          });
          successCount++;

          // Small delay between requests
          await new Promise(r => setTimeout(r, 500));

        } catch (err: any) {
          results.push({
            url: lotUrl,
            success: false,
            error: err.message,
          });
          errorCount++;
        }
      }

      // Log batch API usage
      await supabase.from('api_usage_logs').insert({
        user_id: null,
        provider: 'firecrawl',
        function_name: 'extract-bh-auction',
        cost_cents: toProcess.length + 1, // +1 for the map call
        success: true,
        metadata: {
          batch: true,
          auction_slug: auction_slug || null,
          lots_found: lotUrls.length,
          lots_processed: toProcess.length,
          success_count: successCount,
        },
      });

      return new Response(
        JSON.stringify({
          success: true,
          message: `Processed ${toProcess.length} lots`,
          total_lots_found: lotUrls.length,
          processed: toProcess.length,
          successful: successCount,
          failed: errorCount,
          results,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        error: 'Provide url for single extraction or batch: true for batch mode',
        usage: {
          single: { url: 'https://bhauction.com/en/result/.../lots/...' },
          batch_by_url: { url: 'https://bhauction.com/en/result/.../lots/', batch: true },
          batch_by_slug: { auction_slug: 'jdm-collectible-auction', batch: true },
        },
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[BH Auction] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
