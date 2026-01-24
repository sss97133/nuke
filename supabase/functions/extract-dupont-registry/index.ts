// ONE function to extract EVERYTHING from a duPont Registry listing
// Handles both marketplace (www) and live auctions (live) with Firecrawl rendering

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { firecrawlScrape } from '../_shared/firecrawl.ts';
import { normalizeListingUrlKey } from '../_shared/listingUrl.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DupontExtracted {
  url: string;
  listing_type: 'marketplace' | 'auction';
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  vin: string | null;
  location: string | null;
  // Specs
  mileage: number | null;
  exterior_color: string | null;
  interior_color: string | null;
  transmission: string | null;
  drivetrain: string | null;
  engine: string | null;
  horsepower: number | null;
  body_style: string | null;
  // Listing data
  asking_price: number | null;
  seller_name: string | null;
  seller_type: 'dealer' | 'private' | null;
  seller_phone: string | null;
  seller_email: string | null;
  seller_website: string | null;
  sale_status: 'available' | 'sold' | 'pending' | null;
  description: string | null;
  features: string[];
  // Auction-specific (live.dupontregistry.com)
  lot_number: string | null;
  current_bid: number | null;
  bid_count: number | null;
  watcher_count: number | null;
  auction_end_date: string | null;
  seller_introduction: string | null;
  known_shortcomings: string | null;
  // Images
  image_urls: string[];
  // Meta
  vehicle_id?: string;
}

// VIN patterns - comprehensive coverage
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
  /\b(SCFZ[A-Z0-9]{13})\b/g,               // Aston Martin
  /\b(SAJ[A-Z0-9]{14})\b/g,                // Jaguar
  /\b(SAL[A-Z0-9]{14})\b/g,                // Land Rover
];

function extractVin(html: string): string | null {
  for (const pattern of VIN_PATTERNS) {
    const matches = html.match(pattern);
    if (matches && matches.length > 0) {
      // Return the most common VIN (in case of noise)
      const counts: Record<string, number> = {};
      for (const m of matches) {
        counts[m] = (counts[m] || 0) + 1;
      }
      return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    }
  }
  return null;
}

function parseMoney(raw: string | null): number | null {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  const normalized = s.replace(/,/g, "").replace(/\s+/g, "");
  const m = normalized.match(/\$?([0-9]+(?:\.[0-9]+)?)([km])?$/i);
  if (!m?.[1]) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const suffix = m[2]?.toLowerCase();
  const multiplier = suffix === "k" ? 1000 : suffix === "m" ? 1_000_000 : 1;
  return Math.round(n * multiplier);
}

function parseTitle(html: string): { title: string | null; year: number | null; make: string | null; model: string | null; trim: string | null } {
  // Try h1 first
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  let title = h1Match?.[1]?.trim() || null;

  if (!title) {
    // Fallback to title tag
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    title = titleMatch?.[1]?.replace(/\s*\|\s*duPont REGISTRY$/i, '').trim() || null;
  }

  if (!title) return { title: null, year: null, make: null, model: null, trim: null };

  // Parse year from title (4-digit year at start)
  const yearMatch = title.match(/^(\d{4})\s+/);
  const year = yearMatch ? parseInt(yearMatch[1]) : null;

  if (!year) return { title, year: null, make: null, model: null, trim: null };

  // Everything after the year
  const afterYear = title.slice(title.indexOf(yearMatch![0]) + yearMatch![0].length).trim();
  const parts = afterYear.split(/\s+/);

  if (parts.length === 0) return { title, year, make: null, model: null, trim: null };

  // Handle compound makes
  const firstLower = parts[0]?.toLowerCase();
  const secondLower = parts[1]?.toLowerCase();

  let make: string | null = null;
  let modelStart = 1;

  if (firstLower === 'mercedes' && secondLower === 'benz') {
    make = 'mercedes-benz';
    modelStart = 2;
  } else if (firstLower === 'aston' && secondLower === 'martin') {
    make = 'aston martin';
    modelStart = 2;
  } else if (firstLower === 'alfa' && secondLower === 'romeo') {
    make = 'alfa romeo';
    modelStart = 2;
  } else if (firstLower === 'land' && secondLower === 'rover') {
    make = 'land rover';
    modelStart = 2;
  } else if (firstLower === 'rolls' && secondLower === 'royce') {
    make = 'rolls-royce';
    modelStart = 2;
  } else {
    make = firstLower;
    modelStart = 1;
  }

  const model = parts.slice(modelStart, modelStart + 2).join(' ') || null;
  const trim = parts.slice(modelStart + 2).join(' ') || null;

  return { title, year, make, model, trim };
}

function extractPrice(html: string): number | null {
  // Try asking price patterns
  const pricePatterns = [
    /asking[^$]*\$([0-9,]+)/i,
    /price[^$]*\$([0-9,]+)/i,
    /current\s+bid[^$]*\$([0-9,]+)/i,
    /\$([0-9,]+)/i,
  ];

  for (const pattern of pricePatterns) {
    const match = html.match(pattern);
    if (match) {
      return parseMoney(match[1]);
    }
  }

  return null;
}

function extractImages(html: string): string[] {
  const images = new Set<string>();

  // Look for dupontregistry CDN images
  const imgMatches = html.matchAll(/(?:src|data-src|data-lazy-src)="([^"]+dupontregistry[^"]+)"/gi);
  for (const match of imgMatches) {
    const url = match[1];
    // Skip tiny images, icons, logos
    if (url.includes('/thumb/') || url.includes('/icon/') || url.includes('/logo/')) continue;
    if (url.includes('?w=') && parseInt(url.match(/\?w=(\d+)/)?.[1] || '0') < 200) continue;
    // Remove query params to get full res
    const cleanUrl = url.split('?')[0];
    images.add(cleanUrl);
  }

  // Also try CSS background images
  const bgMatches = html.matchAll(/background-image:\s*url\(['"]?([^'"()]+dupontregistry[^'"()]+)['"]?\)/gi);
  for (const match of bgMatches) {
    const url = match[1];
    if (!url.includes('/thumb/') && !url.includes('/icon/')) {
      images.add(url.split('?')[0]);
    }
  }

  return Array.from(images);
}

function extractSpecs(html: string): {
  mileage: number | null;
  exterior_color: string | null;
  interior_color: string | null;
  transmission: string | null;
  drivetrain: string | null;
  engine: string | null;
  horsepower: number | null;
  body_style: string | null;
} {
  // Extract plain text content for easier matching
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // Mileage
  let mileage: number | null = null;
  const mileageMatch = text.match(/mileage[:\s]+([0-9,]+)/i) ||
                       text.match(/([0-9,]+)\s+miles/i);
  if (mileageMatch) {
    mileage = parseInt(mileageMatch[1].replace(/,/g, ''));
  }

  // Colors
  let exterior_color: string | null = null;
  const extMatch = text.match(/exterior\s+color[:\s]+([A-Za-z\s-]+?)(?:\s+interior|mileage|vin|transmission|engine|\||$)/i);
  if (extMatch) {
    exterior_color = extMatch[1].trim();
  }

  let interior_color: string | null = null;
  const intMatch = text.match(/interior\s+color[:\s]+([A-Za-z\s-]+?)(?:\s+exterior|mileage|vin|transmission|engine|\||$)/i);
  if (intMatch) {
    interior_color = intMatch[1].trim();
  }

  // Transmission
  let transmission: string | null = null;
  const transMatch = text.match(/transmission[:\s]+([^|]+?)(?:\s+drivetrain|engine|vin|mileage|\||$)/i) ||
                     text.match(/(\d+[- ]speed\s+(?:automatic|manual|pdk|dct))/i);
  if (transMatch) {
    transmission = transMatch[1].trim();
  }

  // Drivetrain
  let drivetrain: string | null = null;
  const driveMatch = text.match(/drivetrain[:\s]+([^|]+?)(?:\s+transmission|engine|vin|mileage|\||$)/i);
  if (driveMatch) {
    drivetrain = driveMatch[1].trim();
  } else if (text.match(/\b(AWD|4WD|RWD|FWD)\b/i)) {
    drivetrain = text.match(/\b(AWD|4WD|RWD|FWD)\b/i)![1].toUpperCase();
  }

  // Engine
  let engine: string | null = null;
  const engineMatch = text.match(/engine[:\s]+([^|]+?)(?:\s+transmission|drivetrain|vin|mileage|\||$)/i) ||
                      text.match(/((?:twin[- ]?turbo(?:charged)?|turbo(?:charged)?|supercharged)?\s*\d+\.\d+[lL]\s+(?:V\d+|I\d+|inline[- ]?\d+|flat[- ]?\d+))/i);
  if (engineMatch) {
    engine = engineMatch[1].trim();
  }

  // Horsepower
  let horsepower: number | null = null;
  const hpMatch = text.match(/(\d+)\s*(?:hp|horsepower)/i);
  if (hpMatch) {
    horsepower = parseInt(hpMatch[1]);
  }

  // Body style
  let body_style: string | null = null;
  const bodyMatch = text.match(/body\s+style[:\s]+([A-Za-z\s/]+?)(?:\s+exterior|interior|mileage|vin|\||$)/i);
  if (bodyMatch) {
    body_style = bodyMatch[1].trim();
  } else {
    // Infer from title/text
    const lowerText = text.toLowerCase();
    if (lowerText.includes('coupe')) body_style = 'Coupe';
    else if (lowerText.includes('convertible') || lowerText.includes('cabriolet') || lowerText.includes('roadster') || lowerText.includes('spyder')) body_style = 'Convertible';
    else if (lowerText.includes('sedan')) body_style = 'Sedan';
    else if (lowerText.includes('wagon') || lowerText.includes('estate')) body_style = 'Wagon';
    else if (lowerText.includes('suv') || lowerText.includes('crossover')) body_style = 'SUV';
    else if (lowerText.includes('truck') || lowerText.includes('pickup')) body_style = 'Truck';
    else if (lowerText.includes('hatchback')) body_style = 'Hatchback';
  }

  return {
    mileage,
    exterior_color,
    interior_color,
    transmission,
    drivetrain,
    engine,
    horsepower,
    body_style,
  };
}

function extractDescription(html: string): string | null {
  // Try description/overview sections
  const descMatch = html.match(/<div[^>]*class="[^"]*(?:description|overview|details)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (descMatch) {
    const text = descMatch[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.slice(0, 10000) || null;
  }
  return null;
}

function extractFeatures(html: string): string[] {
  const features: string[] = [];

  // Look for feature lists
  const featureMatches = html.matchAll(/<li[^>]*>([^<]+)<\/li>/gi);
  for (const match of featureMatches) {
    const feature = match[1].trim();
    if (feature.length > 3 && feature.length < 200) {
      features.push(feature);
    }
  }

  return features;
}

function extractSellerInfo(html: string): {
  seller_name: string | null;
  seller_type: 'dealer' | 'private' | null;
  seller_phone: string | null;
  seller_email: string | null;
  seller_website: string | null;
  location: string | null;
} {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // Seller name
  let seller_name: string | null = null;
  const sellerMatch = text.match(/seller[:\s]+([A-Za-z\s&_.-]+?)(?:\s+seller\s+type|location|phone|email|\||$)/i);
  if (sellerMatch) {
    seller_name = sellerMatch[1].trim();
  }

  // Seller type
  let seller_type: 'dealer' | 'private' | null = null;
  const typeMatch = text.match(/seller\s+type[:\s]+(dealer|private)/i);
  if (typeMatch) {
    seller_type = typeMatch[1].toLowerCase() as 'dealer' | 'private';
  }

  // Phone
  let seller_phone: string | null = null;
  const phoneMatch = html.match(/tel:([0-9+()-]+)/i) ||
                     text.match(/phone[:\s]+([0-9+()-\s]+)/i);
  if (phoneMatch) {
    seller_phone = phoneMatch[1].trim();
  }

  // Email
  let seller_email: string | null = null;
  const emailMatch = html.match(/mailto:([^\s"'<>]+@[^\s"'<>]+)/i);
  if (emailMatch) {
    seller_email = emailMatch[1].trim();
  }

  // Website
  let seller_website: string | null = null;
  const websiteMatch = html.match(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>(?:website|visit|dealer)/i);
  if (websiteMatch) {
    seller_website = websiteMatch[1];
  }

  // Location
  let location: string | null = null;
  const locationMatch = text.match(/location[:\s]+([A-Za-z\s,]+\d{5})/i) ||
                        text.match(/location[:\s]+([A-Za-z\s,]+)(?:\s+vin|mileage|seller|\||$)/i);
  if (locationMatch) {
    location = locationMatch[1].trim();
  }

  return {
    seller_name,
    seller_type,
    seller_phone,
    seller_email,
    seller_website,
    location,
  };
}

function extractAuctionData(html: string): {
  lot_number: string | null;
  current_bid: number | null;
  bid_count: number | null;
  watcher_count: number | null;
  auction_end_date: string | null;
  seller_introduction: string | null;
  known_shortcomings: string | null;
} {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // Lot number
  let lot_number: string | null = null;
  const lotMatch = text.match(/lot\s+number[:\s]+(\d+)/i);
  if (lotMatch) {
    lot_number = lotMatch[1];
  }

  // Current bid
  let current_bid: number | null = null;
  const bidMatch = text.match(/current\s+bid[:\s]*\$([0-9,]+)/i);
  if (bidMatch) {
    current_bid = parseMoney(bidMatch[1]);
  }

  // Bid count
  let bid_count: number | null = null;
  const bidCountMatch = text.match(/bids[:\s]+(\d+)/i) ||
                        text.match(/(\d+)\s+bids/i);
  if (bidCountMatch) {
    bid_count = parseInt(bidCountMatch[1]);
  }

  // Watcher count
  let watcher_count: number | null = null;
  const watchMatch = text.match(/watching[:\s]+(\d+)/i) ||
                     text.match(/(\d+)\s+watching/i);
  if (watchMatch) {
    watcher_count = parseInt(watchMatch[1]);
  }

  // Auction end date
  let auction_end_date: string | null = null;
  const endMatch = text.match(/ending[:\s]+([A-Za-z]+\s+\d{1,2},\s+\d{4}(?:\s+at\s+\d{1,2}:\d{2}\s*[AP]M)?)/i);
  if (endMatch) {
    try {
      const parsed = new Date(endMatch[1]);
      if (!isNaN(parsed.getTime())) {
        auction_end_date = parsed.toISOString().split('T')[0]; // YYYY-MM-DD
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Seller introduction
  let seller_introduction: string | null = null;
  const introMatch = html.match(/<div[^>]*class="[^"]*(?:introduction|seller-intro)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (introMatch) {
    seller_introduction = introMatch[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 5000) || null;
  }

  // Known shortcomings
  let known_shortcomings: string | null = null;
  const shortcomingMatch = html.match(/<div[^>]*class="[^"]*(?:shortcoming|known-issue)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (shortcomingMatch) {
    known_shortcomings = shortcomingMatch[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2000) || null;
  }

  return {
    lot_number,
    current_bid,
    bid_count,
    watcher_count,
    auction_end_date,
    seller_introduction,
    known_shortcomings,
  };
}

async function extractDupontListing(url: string): Promise<DupontExtracted> {
  // Determine listing type from URL
  const isAuction = url.includes('live.dupontregistry.com');
  const listing_type: 'marketplace' | 'auction' = isAuction ? 'auction' : 'marketplace';

  // Use Firecrawl to fetch (handles JS rendering)
  console.log(`Fetching ${listing_type} listing via Firecrawl: ${url}`);
  const result = await firecrawlScrape({
    url: url,
    formats: ['html'],
    waitFor: 5000, // Wait 5s for dynamic content
    timeout: 60000,
    mobile: false,
  });

  if (!result.success || !result.data.html) {
    throw new Error(`Firecrawl failed: ${result.error || 'No HTML returned'}`);
  }

  const html = result.data.html;
  console.log(`Firecrawl returned ${html.length} chars`);

  // Extract all data
  const titleData = parseTitle(html);
  const specs = extractSpecs(html);
  const sellerInfo = extractSellerInfo(html);
  const auctionData = isAuction ? extractAuctionData(html) : {
    lot_number: null,
    current_bid: null,
    bid_count: null,
    watcher_count: null,
    auction_end_date: null,
    seller_introduction: null,
    known_shortcomings: null,
  };

  // Price: current_bid for auctions, asking_price for marketplace
  const asking_price = isAuction ? auctionData.current_bid : extractPrice(html);

  // Status: infer from price and auction data
  let sale_status: 'available' | 'sold' | 'pending' | null = null;
  if (html.toLowerCase().includes('sold')) {
    sale_status = 'sold';
  } else if (isAuction && auctionData.auction_end_date) {
    const endDate = new Date(auctionData.auction_end_date);
    if (endDate < new Date()) {
      sale_status = 'sold';
    } else {
      sale_status = 'available';
    }
  } else {
    sale_status = 'available';
  }

  // Build description from multiple sources
  let description = extractDescription(html);
  if (auctionData.seller_introduction && !description) {
    description = auctionData.seller_introduction;
  } else if (auctionData.seller_introduction && description) {
    description = `${auctionData.seller_introduction}\n\n${description}`;
  }

  return {
    url,
    listing_type,
    ...titleData,
    vin: extractVin(html),
    location: sellerInfo.location,
    ...specs,
    asking_price,
    seller_name: sellerInfo.seller_name,
    seller_type: sellerInfo.seller_type,
    seller_phone: sellerInfo.seller_phone,
    seller_email: sellerInfo.seller_email,
    seller_website: sellerInfo.seller_website,
    sale_status,
    description,
    features: extractFeatures(html),
    ...auctionData,
    image_urls: extractImages(html),
  };
}

// Track Firecrawl cost
async function logApiCost(
  supabase: any,
  functionName: string,
  url: string,
  costCents: number
): Promise<void> {
  try {
    await supabase.from('api_usage_logs').insert({
      function_name: functionName,
      api_provider: 'firecrawl',
      endpoint_used: 'scrape',
      request_url: url,
      cost_cents: costCents,
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to log API cost:', error);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url, save_to_db, vehicle_id } = await req.json();

    if (!url || (!url.includes('dupontregistry.com/autos/listing/') && !url.includes('live.dupontregistry.com/auction/'))) {
      return new Response(
        JSON.stringify({ error: 'Invalid duPont Registry listing URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Always create supabase client for cost logging
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    console.log(`Extracting duPont Registry: ${url}`);
    const extracted = await extractDupontListing(url);

    // Log Firecrawl cost (estimate: 5 cents per scrape with waitFor)
    await logApiCost(supabase, 'extract-dupont-registry', url, 5);

    console.log(`=== EXTRACTION RESULTS ===`);
    console.log(`Type: ${extracted.listing_type}`);
    console.log(`Title: ${extracted.title}`);
    console.log(`Year/Make/Model: ${extracted.year} ${extracted.make} ${extracted.model}`);
    console.log(`VIN: ${extracted.vin || 'NOT FOUND'}`);
    console.log(`Price: $${extracted.asking_price?.toLocaleString() || 'N/A'}`);
    console.log(`Seller: ${extracted.seller_name || 'NOT FOUND'} (${extracted.seller_type || 'unknown'})`);
    console.log(`Location: ${extracted.location || 'NOT FOUND'}`);
    console.log(`Specs: ${extracted.mileage || '?'}mi | ${extracted.exterior_color || '?'} | ${extracted.transmission || '?'} | ${extracted.drivetrain || '?'}`);
    console.log(`Images: ${extracted.image_urls.length} | Features: ${extracted.features.length}`);
    if (extracted.listing_type === 'auction') {
      console.log(`Lot #${extracted.lot_number || '?'} | Bids: ${extracted.bid_count || 0} | Watchers: ${extracted.watcher_count || 0}`);
      console.log(`Ends: ${extracted.auction_end_date || 'unknown'}`);
    }

    // Optionally save to database
    if (save_to_db || vehicle_id) {
      let targetVehicleId = vehicle_id;

      // If vehicle_id provided, update existing vehicle; otherwise create new
      if (vehicle_id) {
        // Update existing vehicle
        const { error: updateError } = await supabase
          .from('vehicles')
          .update({
            year: extracted.year,
            make: extracted.make,
            model: extracted.model,
            trim: extracted.trim,
            vin: extracted.vin || undefined,
            mileage: extracted.mileage,
            color: extracted.exterior_color,
            interior_color: extracted.interior_color,
            transmission: extracted.transmission,
            drivetrain: extracted.drivetrain,
            engine_type: extracted.engine,
            body_style: extracted.body_style,
            description: extracted.description,
            sale_status: extracted.sale_status,
            listing_url: extracted.url,
            discovery_url: extracted.url,
          })
          .eq('id', vehicle_id);

        if (updateError) {
          console.error('Vehicle update error:', updateError);
          throw new Error(`Failed to update vehicle: ${updateError.message}`);
        }

        console.log(`Updated vehicle: ${vehicle_id}`);
        extracted.vehicle_id = vehicle_id;
      } else {
        // Insert new vehicle
        const { data, error } = await supabase
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
            description: extracted.description,
            sale_status: extracted.sale_status || 'available',
            listing_url: extracted.url,
            discovery_url: extracted.url,
            discovery_source: 'dupont_registry',
            profile_origin: 'dupont_registry_import',
            is_public: true,
          })
          .select()
          .single();

        if (error) {
          console.error('DB error:', error);
          throw new Error(`Failed to save vehicle: ${error.message}`);
        }

        console.log(`Saved vehicle: ${data.id}`);
        extracted.vehicle_id = data.id;
      }

      // Save ALL images
      if (extracted.image_urls.length > 0 && extracted.vehicle_id) {
        const imageRecords = extracted.image_urls.map((img_url, i) => ({
          vehicle_id: extracted.vehicle_id,
          image_url: img_url,
          position: i,
          source: 'dupont_registry_import',
          is_external: true,
        }));

        const { error: imgError } = await supabase
          .from('vehicle_images')
          .upsert(imageRecords, {
            onConflict: 'vehicle_id,image_url',
            ignoreDuplicates: false
          });

        if (imgError) {
          console.error('Image save error:', imgError);
        } else {
          console.log(`Saved ${imageRecords.length} images`);
        }
      }

      // Create/update external_listings record
      if (extracted.vehicle_id) {
        const listingUrlKey = normalizeListingUrlKey(extracted.url);
        const listingIdFallback = (() => {
          const trimmed = String(extracted.url || '').trim().replace(/\/+$/, '');
          return trimmed.split('/').filter(Boolean).pop() || null;
        })();

        const { error: listingError } = await supabase
          .from('external_listings')
          .upsert({
            vehicle_id: extracted.vehicle_id,
            platform: 'dupont_registry',
            listing_url: extracted.url,
            listing_url_key: listingUrlKey,
            listing_id: extracted.lot_number || listingIdFallback || listingUrlKey,
            listing_status: extracted.sale_status === 'sold' ? 'sold' : 'active',
            current_bid: extracted.asking_price,
            bid_count: extracted.bid_count,
            watcher_count: extracted.watcher_count,
            end_date: extracted.auction_end_date,
            final_price: extracted.sale_status === 'sold' ? extracted.asking_price : null,
            sold_at: extracted.sale_status === 'sold' ? new Date().toISOString() : null,
            metadata: {
              listing_type: extracted.listing_type,
              lot_number: extracted.lot_number,
              seller_name: extracted.seller_name,
              seller_type: extracted.seller_type,
              features_count: extracted.features.length,
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

      // Create external_identities for seller
      if (extracted.seller_name && extracted.vehicle_id) {
        const nowIso = new Date().toISOString();

        const { error: identityError } = await supabase
          .from('external_identities')
          .upsert({
            platform: 'dupont_registry',
            handle: extracted.seller_name.toLowerCase().replace(/\s+/g, '_'),
            display_name: extracted.seller_name,
            profile_url: extracted.seller_website || null,
            metadata: {
              source: 'dupont_registry_import',
              seller_type: extracted.seller_type,
              phone: extracted.seller_phone,
              email: extracted.seller_email,
              first_seen_listing: extracted.url,
              first_seen_at: nowIso,
            },
            first_seen_at: nowIso,
            last_seen_at: nowIso,
            updated_at: nowIso,
          }, {
            onConflict: 'platform,handle'
          });

        if (identityError) {
          console.error('External identity save error:', identityError);
        } else {
          console.log(`Created/updated external identity for seller: ${extracted.seller_name}`);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        extracted,
        _fetch: {
          source: 'firecrawl',
          cost_cents: 5,
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
