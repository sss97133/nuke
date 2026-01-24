// High-quality Bonhams auction extractor
// Handles lot pages, catalogs, and department pages with full gallery support

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { firecrawlScrape } from '../_shared/firecrawl.ts';
import { normalizeListingUrlKey } from '../_shared/listingUrl.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BonhamsExtracted {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  chassis_number: string | null;

  // Pricing (multi-currency support)
  estimate_low: number | null;
  estimate_high: number | null;
  estimate_currency: string | null;
  hammer_price: number | null;
  buyers_premium: number | null;
  total_price: number | null;
  price_currency: string | null;

  // Auction metadata
  lot_number: string | null;
  sale_id: string | null;
  sale_name: string | null;
  sale_date: string | null;
  sale_location: string | null;
  auction_status: 'sold' | 'unsold' | 'withdrawn' | 'upcoming' | null;

  // Vehicle specs
  mileage: number | null;
  engine: string | null;
  transmission: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  body_style: string | null;

  // Content
  description: string | null;
  condition_report: string | null;
  provenance: string | null;
  history: string | null;
  literature: string | null;

  // Images (30-80+ in Bonhams galleries)
  image_urls: string[];

  // Metadata
  vehicle_id?: string;
  scrape_source: 'firecrawl';
  scrape_cost_cents: number;
}

// VIN patterns (17-character modern + chassis numbers for classics)
const VIN_PATTERNS = [
  /\b([1-5][A-HJ-NPR-Z0-9]{16})\b/g,       // US/Canada/Mexico
  /\b(J[A-HJ-NPR-Z0-9]{16})\b/g,           // Japan
  /\b(K[A-HJ-NPR-Z0-9]{16})\b/g,           // Korea
  /\b(S[A-HJ-NPR-Z0-9]{16})\b/g,           // UK
  /\b(W[A-HJ-NPR-Z0-9]{16})\b/g,           // Germany
  /\b(Z[A-HJ-NPR-Z0-9]{16})\b/g,           // Italy
  /\b(WP0[A-Z0-9]{14})\b/g,                // Porsche
  /\b(WDB[A-Z0-9]{14})\b/g,                // Mercedes
  /\b(WBA[A-Z0-9]{14})\b/g,                // BMW
  /\b(ZFF[A-Z0-9]{14})\b/g,                // Ferrari
];

// Chassis number patterns (pre-VIN era, various formats)
const CHASSIS_PATTERNS = [
  /chassis\s*(?:number|no\.?|#)?\s*:?\s*([A-Z0-9\-\/]+)/i,
  /chassis\s+([A-Z0-9\-\/]{5,20})/i,
  /frame\s*(?:number|no\.?|#)?\s*:?\s*([A-Z0-9\-\/]+)/i,
];

function extractVinOrChassis(html: string): { vin: string | null; chassis: string | null } {
  let vin: string | null = null;
  let chassis: string | null = null;

  // Try VIN first (modern vehicles)
  for (const pattern of VIN_PATTERNS) {
    const matches = html.match(pattern);
    if (matches && matches.length > 0) {
      vin = matches[0];
      break;
    }
  }

  // Try chassis number (classic vehicles)
  for (const pattern of CHASSIS_PATTERNS) {
    const match = html.match(pattern);
    if (match && match[1]) {
      const candidate = match[1].trim();
      // Validate: 5-20 chars, alphanumeric with hyphens/slashes
      if (candidate.length >= 5 && candidate.length <= 20 && /^[A-Z0-9\-\/]+$/i.test(candidate)) {
        chassis = candidate;
        break;
      }
    }
  }

  return { vin, chassis };
}

function extractTitle(html: string): { title: string | null; year: number | null; make: string | null; model: string | null } {
  // Bonhams uses <h1> for lot titles
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) ||
                  html.match(/<title[^>]*>([^<]+)<\/title>/i);

  let title = h1Match?.[1]?.trim() || null;
  if (!title) return { title: null, year: null, make: null, model: null };

  // Clean HTML entities
  title = title
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();

  // Parse year (4 digits)
  const yearMatch = title.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? parseInt(yearMatch[0]) : null;

  // Parse make/model after year
  if (year) {
    const afterYear = title.slice(title.indexOf(yearMatch![0]) + yearMatch![0].length).trim();
    const parts = afterYear.split(/\s+/);
    const make = parts[0] || null;
    const model = parts.slice(1).join(' ') || null;
    return { title, year, make, model };
  }

  return { title, year: null, make: null, model: null };
}

// Parse Bonhams money format: "£25,000 - 35,000", "$50,000-70,000", "€100,000"
function parseMoney(raw: string | null): number | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase()
    .replace(/,/g, '')
    .replace(/\s+/g, '');

  const match = s.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return null;

  const num = parseFloat(match[1]);
  return Number.isFinite(num) && num > 0 ? Math.round(num) : null;
}

// Extract currency symbol from price string
function extractCurrency(raw: string | null): string | null {
  if (!raw) return null;
  if (raw.includes('£') || raw.toLowerCase().includes('gbp')) return 'GBP';
  if (raw.includes('$') || raw.toLowerCase().includes('usd')) return 'USD';
  if (raw.includes('€') || raw.toLowerCase().includes('eur')) return 'EUR';
  if (raw.includes('¥') || raw.toLowerCase().includes('jpy')) return 'JPY';
  if (raw.includes('CHF') || raw.toLowerCase().includes('chf')) return 'CHF';
  return null;
}

// Bonhams uses tiered buyer's premium (typically 27.5% up to £500k, then 21%, then 15%)
function calculateBuyersPremium(hammerPrice: number, currency: string = 'GBP'): number {
  // Standard Bonhams premium structure (2024)
  // Tier 1: 27.5% on first £500,000 (or equivalent)
  // Tier 2: 21% on £500,001-£1,000,000
  // Tier 3: 15% above £1,000,000

  const tier1Limit = 500000;
  const tier2Limit = 1000000;

  let premium = 0;

  if (hammerPrice <= tier1Limit) {
    premium = hammerPrice * 0.275;
  } else if (hammerPrice <= tier2Limit) {
    premium = (tier1Limit * 0.275) + ((hammerPrice - tier1Limit) * 0.21);
  } else {
    premium = (tier1Limit * 0.275) + ((tier2Limit - tier1Limit) * 0.21) + ((hammerPrice - tier2Limit) * 0.15);
  }

  return Math.round(premium);
}

function extractAuctionData(html: string): {
  lot_number: string | null;
  sale_id: string | null;
  sale_name: string | null;
  sale_date: string | null;
  sale_location: string | null;
  auction_status: 'sold' | 'unsold' | 'withdrawn' | 'upcoming' | null;
  estimate_low: number | null;
  estimate_high: number | null;
  estimate_currency: string | null;
  hammer_price: number | null;
  buyers_premium: number | null;
  total_price: number | null;
  price_currency: string | null;
} {
  // Lot number
  const lotMatch = html.match(/Lot\s+(\d+)/i) ||
                   html.match(/lot-number[^>]*>(\d+)/i);
  const lot_number = lotMatch?.[1] || null;

  // Sale ID (from URL or data attributes)
  const saleIdMatch = html.match(/sale[\/\-](\d+)/i) ||
                      html.match(/data-sale-id="(\d+)"/i);
  const sale_id = saleIdMatch?.[1] || null;

  // Sale name
  const saleNameMatch = html.match(/<h2[^>]*sale[^>]*>([^<]+)<\/h2>/i) ||
                        html.match(/sale-title[^>]*>([^<]+)</i);
  const sale_name = saleNameMatch?.[1]?.trim() || null;

  // Sale date
  const saleDateMatch = html.match(/(\d{1,2}\s+[A-Z][a-z]+\s+\d{4})/i) ||
                        html.match(/(\d{4}-\d{2}-\d{2})/);
  let sale_date: string | null = null;
  if (saleDateMatch) {
    try {
      sale_date = new Date(saleDateMatch[1]).toISOString().split('T')[0];
    } catch {}
  }

  // Sale location
  const locationMatch = html.match(/location[^>]*>([^<]+)</i) ||
                        html.match(/(London|New York|Los Angeles|Paris|Monaco|Hong Kong|Geneva)/i);
  const sale_location = locationMatch?.[1]?.trim() || null;

  // Auction status
  let auction_status: 'sold' | 'unsold' | 'withdrawn' | 'upcoming' | null = null;
  if (html.match(/\bsold\b/i) && html.match(/\$|£|€/)) {
    auction_status = 'sold';
  } else if (html.match(/unsold|not sold|reserve not met/i)) {
    auction_status = 'unsold';
  } else if (html.match(/withdrawn/i)) {
    auction_status = 'withdrawn';
  } else if (html.match(/upcoming|forthcoming/i)) {
    auction_status = 'upcoming';
  }

  // Estimate (low-high range)
  const estimateMatch = html.match(/estimate[^:]*:?\s*([£$€¥]?\s*[\d,]+(?:\s*-\s*[\d,]+)?)/i);
  let estimate_low: number | null = null;
  let estimate_high: number | null = null;
  let estimate_currency: string | null = null;

  if (estimateMatch) {
    estimate_currency = extractCurrency(estimateMatch[1]);
    const parts = estimateMatch[1].split(/\s*-\s*/);
    estimate_low = parseMoney(parts[0]);
    estimate_high = parts.length > 1 ? parseMoney(parts[1]) : estimate_low;
  }

  // Hammer price (sold price before premium)
  const hammerMatch = html.match(/(?:hammer|sold for|final bid)[^:]*:?\s*([£$€¥]?\s*[\d,]+)/i);
  let hammer_price: number | null = null;
  let buyers_premium: number | null = null;
  let total_price: number | null = null;
  let price_currency: string | null = null;

  if (hammerMatch) {
    price_currency = extractCurrency(hammerMatch[1]);
    hammer_price = parseMoney(hammerMatch[1]);

    if (hammer_price) {
      buyers_premium = calculateBuyersPremium(hammer_price, price_currency || 'GBP');
      total_price = hammer_price + buyers_premium;
    }
  }

  // Alternative: total price directly stated
  const totalMatch = html.match(/total[^:]*:?\s*([£$€¥]?\s*[\d,]+)/i);
  if (totalMatch && !total_price) {
    total_price = parseMoney(totalMatch[1]);
    price_currency = extractCurrency(totalMatch[1]);
  }

  return {
    lot_number,
    sale_id,
    sale_name,
    sale_date,
    sale_location,
    auction_status,
    estimate_low,
    estimate_high,
    estimate_currency,
    hammer_price,
    buyers_premium,
    total_price,
    price_currency,
  };
}

function extractSpecs(html: string): {
  mileage: number | null;
  engine: string | null;
  transmission: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  body_style: string | null;
} {
  // Mileage
  let mileage: number | null = null;
  const mileagePatterns = [
    /(\d{1,3}(?:,\d{3})*)\s*(?:miles|km|kms)/i,
    /mileage[^:]*:?\s*(\d{1,3}(?:,\d{3})*)/i,
    /odometer[^:]*:?\s*(\d{1,3}(?:,\d{3})*)/i,
  ];
  for (const pattern of mileagePatterns) {
    const match = html.match(pattern);
    if (match) {
      const num = parseInt(match[1].replace(/,/g, ''));
      if (num > 0 && num < 10000000) {
        mileage = num;
        break;
      }
    }
  }

  // Engine
  let engine: string | null = null;
  const engineMatch = html.match(/(\d+(?:\.\d+)?)[- ]?(?:liter|litre|L)\s+([A-Z0-9\-]+(?:\s+[A-Z0-9\-]+)?)\s+engine/i) ||
                      html.match(/engine[^:]*:?\s*([^<\n]{10,100})/i);
  if (engineMatch) {
    engine = engineMatch[1]?.trim().slice(0, 100) || null;
  }

  // Transmission
  let transmission: string | null = null;
  const transMatch = html.match(/(\d+)[- ]speed\s+(manual|automatic|PDK|DSG|sequential)/i) ||
                     html.match(/transmission[^:]*:?\s*([^<\n]{5,50})/i);
  if (transMatch) {
    transmission = transMatch[0]?.trim().slice(0, 50) || null;
  }

  // Exterior color
  let exterior_color: string | null = null;
  const exteriorMatch = html.match(/(?:exterior|color|colour|paint)[^:]*:?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i) ||
                        html.match(/finished in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
  if (exteriorMatch) {
    exterior_color = exteriorMatch[1]?.trim() || null;
  }

  // Interior color
  let interior_color: string | null = null;
  const interiorMatch = html.match(/interior[^:]*:?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:leather|vinyl|cloth)/i) ||
                        html.match(/upholstered in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
  if (interiorMatch) {
    interior_color = interiorMatch[1]?.trim() || null;
  }

  // Body style
  let body_style: string | null = null;
  const titleLower = html.toLowerCase();
  if (titleLower.includes('coupe') || titleLower.includes('coupé')) body_style = 'Coupe';
  else if (titleLower.includes('convertible') || titleLower.includes('cabriolet') || titleLower.includes('roadster') || titleLower.includes('spider') || titleLower.includes('spyder')) body_style = 'Convertible';
  else if (titleLower.includes('sedan') || titleLower.includes('saloon')) body_style = 'Sedan';
  else if (titleLower.includes('wagon') || titleLower.includes('estate') || titleLower.includes('touring')) body_style = 'Wagon';
  else if (titleLower.includes('suv')) body_style = 'SUV';
  else if (titleLower.includes('pickup') || titleLower.includes('truck')) body_style = 'Truck';

  return {
    mileage,
    engine,
    transmission,
    exterior_color,
    interior_color,
    body_style,
  };
}

function extractContent(html: string): {
  description: string | null;
  condition_report: string | null;
  provenance: string | null;
  history: string | null;
  literature: string | null;
} {
  // Description (main lot description)
  let description: string | null = null;
  const descMatch = html.match(/<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]{100,10000}?)<\/div>/i);
  if (descMatch) {
    description = descMatch[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 5000);
  }

  // Condition report
  let condition_report: string | null = null;
  const conditionMatch = html.match(/condition\s+report[^<]*<[^>]*>([\s\S]{50,5000}?)<\/(?:div|section|p)>/i);
  if (conditionMatch) {
    condition_report = conditionMatch[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000);
  }

  // Provenance
  let provenance: string | null = null;
  const provMatch = html.match(/provenance[^<]*<[^>]*>([\s\S]{50,3000}?)<\/(?:div|section|p|ul)>/i);
  if (provMatch) {
    provenance = provMatch[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2000);
  }

  // History
  let history: string | null = null;
  const historyMatch = html.match(/(?:history|ownership)[^<]*<[^>]*>([\s\S]{50,3000}?)<\/(?:div|section|p|ul)>/i);
  if (historyMatch) {
    history = historyMatch[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2000);
  }

  // Literature
  let literature: string | null = null;
  const litMatch = html.match(/literature[^<]*<[^>]*>([\s\S]{50,2000}?)<\/(?:div|section|p|ul)>/i);
  if (litMatch) {
    literature = litMatch[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1000);
  }

  return {
    description,
    condition_report,
    provenance,
    history,
    literature,
  };
}

function extractImages(html: string): string[] {
  const images: string[] = [];

  // Bonhams image patterns (various CDN formats)
  const patterns = [
    // High-res images
    /<img[^>]*src="(https?:\/\/[^"]*bonhams[^"]*\/(?:images|media|lot-images)[^"]+\.(?:jpg|jpeg|png))"/gi,
    // Data attributes
    /data-src="(https?:\/\/[^"]*bonhams[^"]+\.(?:jpg|jpeg|png))"/gi,
    // Background images
    /background-image:\s*url\(['"]?(https?:\/\/[^'"]*bonhams[^'"]+\.(?:jpg|jpeg|png))['"]?\)/gi,
    // Gallery JSON
    /"(?:image|url|src)":\s*"(https?:\/\/[^"]*bonhams[^"]+\.(?:jpg|jpeg|png))"/gi,
  ];

  for (const pattern of patterns) {
    const matches = html.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        // Clean URL: remove resize params to get full resolution
        const cleanUrl = match[1]
          .replace(/[?&]width=\d+/gi, '')
          .replace(/[?&]height=\d+/gi, '')
          .replace(/[?&]quality=\d+/gi, '')
          .replace(/\/thumb\//gi, '/original/')
          .replace(/\/small\//gi, '/large/')
          .split('?')[0];

        if (!images.includes(cleanUrl)) {
          images.push(cleanUrl);
        }
      }
    }
  }

  // Deduplicate and return
  return [...new Set(images)];
}

async function extractBonhamsListing(url: string): Promise<BonhamsExtracted> {
  console.log(`[Bonhams] Fetching: ${url}`);

  // Use Firecrawl for JS rendering (Bonhams requires it)
  const result = await firecrawlScrape({
    url,
    formats: ['html', 'markdown'],
    waitFor: 5000,  // Wait for JS to load images
    onlyMainContent: false,
  });

  if (!result.success || !result.data.html) {
    throw new Error(`Firecrawl failed: ${result.error || 'No HTML returned'}`);
  }

  const html = result.data.html;
  const markdown = result.data.markdown || '';
  const costCents = 1; // Standard Firecrawl cost

  console.log(`[Bonhams] Firecrawl returned ${html.length} bytes HTML, ${markdown.length} bytes markdown`);

  // Try markdown extraction first for cleaner data (cars.bonhams.com returns good markdown)
  let titleData = { title: null as string | null, year: null as number | null, make: null as string | null, model: null as string | null };

  // Markdown title pattern: "# _description_ 1981 Lamborghini Countach..." or "# 1981 Lamborghini..."
  const mdTitleMatch = markdown.match(/^#\s+(?:_[^_]+_\s+)?(\d{4}\s+[^\n]+)/m);
  if (mdTitleMatch) {
    const rawTitle = mdTitleMatch[1].trim();
    const yearMatch = rawTitle.match(/^(\d{4})/);
    const year = yearMatch ? parseInt(yearMatch[1]) : null;
    if (year) {
      const afterYear = rawTitle.slice(4).trim();
      const parts = afterYear.split(/\s+/);
      titleData = {
        title: rawTitle,
        year,
        make: parts[0] || null,
        model: parts.slice(1).join(' ') || null,
      };
    }
  }

  // Fall back to HTML extraction if markdown didn't work
  if (!titleData.title) {
    titleData = extractTitle(html);
  }

  // Extract chassis from markdown first: "Chassis no. 1121412"
  let vinData = extractVinOrChassis(html);
  const mdChassisMatch = markdown.match(/Chassis\s+no\.?\s*([A-Z0-9]+)/i);
  if (mdChassisMatch) {
    vinData.chassis = mdChassisMatch[1];
  }
  // Also try "Engine no. 1638115"
  const mdEngineMatch = markdown.match(/Engine\s+no\.?\s*([A-Z0-9]+)/i);

  // Try markdown for sold price first: "Sold for £546,250 inc. premium"
  let auctionData = extractAuctionData(html);
  const mdSoldMatch = markdown.match(/Sold for\s*([£€$])([\d,]+)/i);
  if (mdSoldMatch) {
    const currencySymbol = mdSoldMatch[1];
    const currency = currencySymbol === '£' ? 'GBP' : currencySymbol === '€' ? 'EUR' : 'USD';
    auctionData.total_price = parseInt(mdSoldMatch[2].replace(/,/g, ''));
    auctionData.price_currency = currency;
    auctionData.auction_status = 'sold';
    // Clear bad hammer_price/buyers_premium if we got markdown price
    auctionData.hammer_price = null;
    auctionData.buyers_premium = null;
  }

  // Extract estimate from markdown: "Estimate:€580,000 - €700,000" or "£450,000 - £550,000"
  const mdEstimateMatch = markdown.match(/Estimate[:\s]*([£€$])([\d,]+)\s*[-–]\s*([£€$])?([\d,]+)/i);
  if (mdEstimateMatch) {
    const currency = mdEstimateMatch[1] === '£' ? 'GBP' : mdEstimateMatch[1] === '€' ? 'EUR' : 'USD';
    auctionData.estimate_low = parseInt(mdEstimateMatch[2].replace(/,/g, ''));
    auctionData.estimate_high = parseInt(mdEstimateMatch[4].replace(/,/g, ''));
    auctionData.estimate_currency = currency;
  }

  // Extract lot number from markdown "LOT 104"
  const mdLotMatch = markdown.match(/^LOT\s+(\d+)/m);
  if (mdLotMatch) {
    auctionData.lot_number = mdLotMatch[1];
  }

  const specs = extractSpecs(html);
  const content = extractContent(html);

  // Extract images from markdown first (format: ![...](https://cars.bonhams.com/_next/image...))
  let images = [...markdown.matchAll(/!\[[^\]]*\]\((https:\/\/(?:cars\.)?bonhams\.com\/_next\/image[^)]+)\)/gi)]
    .map(m => m[1])
    .filter(url => url.includes('.jpg') || url.includes('.png') || url.includes('.webp'));

  // Dedupe and add HTML images if needed
  if (images.length < 5) {
    const htmlImages = extractImages(html);
    images = [...new Set([...images, ...htmlImages])];
  } else {
    images = [...new Set(images)];
  }

  console.log(`[Bonhams] Extracted: ${titleData.title}`);
  console.log(`[Bonhams] Year/Make/Model: ${titleData.year} ${titleData.make} ${titleData.model}`);
  console.log(`[Bonhams] VIN: ${vinData.vin || 'N/A'} | Chassis: ${vinData.chassis || 'N/A'}`);
  console.log(`[Bonhams] Lot: ${auctionData.lot_number} | Status: ${auctionData.auction_status}`);
  console.log(`[Bonhams] Estimate: ${auctionData.estimate_currency}${auctionData.estimate_low?.toLocaleString()} - ${auctionData.estimate_high?.toLocaleString()}`);
  console.log(`[Bonhams] Sold: ${auctionData.price_currency}${auctionData.total_price?.toLocaleString()} (hammer: ${auctionData.hammer_price?.toLocaleString()} + premium: ${auctionData.buyers_premium?.toLocaleString()})`);
  console.log(`[Bonhams] Images: ${images.length}`);

  return {
    url,
    ...titleData,
    vin: vinData.vin,
    chassis_number: vinData.chassis,
    ...auctionData,
    ...specs,
    ...content,
    image_urls: images,
    scrape_source: 'firecrawl',
    scrape_cost_cents: costCents,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url, save_to_db, vehicle_id } = await req.json();

    if (!url || !url.includes('bonhams.com')) {
      return new Response(
        JSON.stringify({ error: 'Invalid Bonhams URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    console.log(`[Bonhams] Extracting: ${url}`);
    const extracted = await extractBonhamsListing(url);

    // Log Firecrawl cost
    await supabase.from('api_usage_logs').insert({
      user_id: null,
      provider: 'firecrawl',
      function_name: 'extract-bonhams',
      cost_cents: extracted.scrape_cost_cents,
      success: true,
      metadata: {
        url,
        lot_number: extracted.lot_number,
        image_count: extracted.image_urls.length,
      },
    });

    // Optionally save to database
    if (save_to_db || vehicle_id) {
      let targetVehicleId = vehicle_id;

      // Upsert vehicle (by VIN or discovery_url)
      if (!targetVehicleId && extracted.vin) {
        const { data: existing } = await supabase
          .from('vehicles')
          .select('id')
          .eq('vin', extracted.vin.toUpperCase())
          .maybeSingle();
        if (existing) targetVehicleId = existing.id;
      }

      if (!targetVehicleId) {
        const { data: existing } = await supabase
          .from('vehicles')
          .select('id')
          .eq('discovery_url', extracted.url)
          .maybeSingle();
        if (existing) targetVehicleId = existing.id;
      }

      const vehicleData = {
        year: extracted.year,
        make: extracted.make?.toLowerCase(),
        model: extracted.model?.toLowerCase(),
        // Store chassis number in VIN field for vintage vehicles if no modern VIN
        vin: extracted.vin ? extracted.vin.toUpperCase() : (extracted.chassis_number ? extracted.chassis_number.toUpperCase() : null),
        mileage: extracted.mileage,
        exterior_color: extracted.exterior_color,
        interior_color: extracted.interior_color,
        transmission: extracted.transmission,
        engine_type: extracted.engine,
        body_style: extracted.body_style,
        description: extracted.description,
        sale_price: extracted.total_price,
        sale_date: extracted.sale_date,
        sale_status: extracted.auction_status === 'sold' ? 'sold' : 'available',
        auction_end_date: extracted.sale_date,
        auction_outcome: extracted.auction_status === 'sold' ? 'sold' : extracted.auction_status === 'unsold' ? 'reserve_not_met' : null,
        listing_url: extracted.url,
        discovery_url: extracted.url,
        discovery_source: 'bonhams',
        profile_origin: 'bonhams_import',
        is_public: true,
        origin_metadata: {
          source: 'bonhams_import',
          lot_number: extracted.lot_number,
          sale_id: extracted.sale_id,
          sale_name: extracted.sale_name,
          sale_location: extracted.sale_location,
          chassis_number: extracted.chassis_number,
          estimate_low: extracted.estimate_low,
          estimate_high: extracted.estimate_high,
          estimate_currency: extracted.estimate_currency,
          hammer_price: extracted.hammer_price,
          buyers_premium: extracted.buyers_premium,
          condition_report: extracted.condition_report,
          provenance: extracted.provenance,
          history: extracted.history,
          literature: extracted.literature,
          imported_at: new Date().toISOString(),
        },
      };

      if (targetVehicleId) {
        await supabase
          .from('vehicles')
          .update(vehicleData)
          .eq('id', targetVehicleId);
        console.log(`[Bonhams] Updated vehicle: ${targetVehicleId}`);
      } else {
        const { data: newVehicle, error: vehicleError } = await supabase
          .from('vehicles')
          .insert(vehicleData)
          .select()
          .single();

        if (vehicleError) {
          throw new Error(`Failed to save vehicle: ${vehicleError.message}`);
        }

        targetVehicleId = newVehicle.id;
        console.log(`[Bonhams] Created vehicle: ${targetVehicleId}`);
      }

      extracted.vehicle_id = targetVehicleId;

      // Save images
      if (extracted.image_urls.length > 0 && targetVehicleId) {
        const imageRecords = extracted.image_urls.map((img_url, i) => ({
          vehicle_id: targetVehicleId,
          image_url: img_url,
          position: i,
          source: 'bonhams_import',
          is_external: true,
        }));

        const { error: imgError } = await supabase
          .from('vehicle_images')
          .upsert(imageRecords, {
            onConflict: 'vehicle_id,image_url',
            ignoreDuplicates: false,
          });

        if (imgError) {
          console.error('[Bonhams] Image save error:', imgError);
        } else {
          console.log(`[Bonhams] Saved ${imageRecords.length} images`);
        }
      }

      // Create external_listings record
      if (targetVehicleId) {
        const listingUrlKey = normalizeListingUrlKey(extracted.url);
        const { error: listingError } = await supabase
          .from('external_listings')
          .upsert({
            vehicle_id: targetVehicleId,
            platform: 'bonhams',
            listing_url: extracted.url,
            listing_url_key: listingUrlKey,
            listing_id: extracted.lot_number || extracted.sale_id || listingUrlKey,
            listing_status: extracted.auction_status === 'sold' ? 'sold' : extracted.auction_status === 'upcoming' ? 'active' : 'ended',
            end_date: extracted.sale_date,
            final_price: extracted.total_price,
            sold_at: extracted.auction_status === 'sold' ? extracted.sale_date : null,
            metadata: {
              lot_number: extracted.lot_number,
              sale_id: extracted.sale_id,
              sale_name: extracted.sale_name,
              sale_location: extracted.sale_location,
              estimate_low: extracted.estimate_low,
              estimate_high: extracted.estimate_high,
              estimate_currency: extracted.estimate_currency,
              hammer_price: extracted.hammer_price,
              buyers_premium: extracted.buyers_premium,
              chassis_number: extracted.chassis_number,
            },
          }, {
            onConflict: 'platform,listing_url_key',
          });

        if (listingError) {
          console.error('[Bonhams] External listing save error:', listingError);
        } else {
          console.log('[Bonhams] Created/updated external_listings record');
        }
      }

      // Create auction_events for timeline
      if (targetVehicleId && extracted.sale_date) {
        const events = [];

        if (extracted.auction_status === 'sold' && extracted.total_price) {
          events.push({
            vehicle_id: targetVehicleId,
            event_type: 'auction_sold',
            event_date: extracted.sale_date,
            title: `Sold at ${extracted.sale_name || 'Bonhams'} (Lot ${extracted.lot_number || 'N/A'})`,
            description: `Hammer price: ${extracted.price_currency}${extracted.hammer_price?.toLocaleString()} + premium: ${extracted.buyers_premium?.toLocaleString()} = total: ${extracted.total_price.toLocaleString()}. ${extracted.sale_location || ''}`,
            source: 'bonhams_import',
            metadata: {
              lot_number: extracted.lot_number,
              sale_id: extracted.sale_id,
              sale_name: extracted.sale_name,
              hammer_price: extracted.hammer_price,
              buyers_premium: extracted.buyers_premium,
              total_price: extracted.total_price,
            },
          });
        } else if (extracted.auction_status === 'upcoming') {
          events.push({
            vehicle_id: targetVehicleId,
            event_type: 'auction_listed',
            event_date: extracted.sale_date,
            title: `Listed at ${extracted.sale_name || 'Bonhams'} (Lot ${extracted.lot_number || 'N/A'})`,
            description: `Estimate: ${extracted.estimate_currency}${extracted.estimate_low?.toLocaleString()} - ${extracted.estimate_high?.toLocaleString()}. ${extracted.sale_location || ''}`,
            source: 'bonhams_import',
            metadata: {
              lot_number: extracted.lot_number,
              sale_id: extracted.sale_id,
              estimate_low: extracted.estimate_low,
              estimate_high: extracted.estimate_high,
            },
          });
        }

        if (events.length > 0) {
          await supabase.from('timeline_events').insert(events);
          console.log(`[Bonhams] Created ${events.length} timeline events`);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        extracted,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[Bonhams] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
