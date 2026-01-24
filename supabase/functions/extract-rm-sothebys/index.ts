/**
 * RM Sotheby's Extractor
 *
 * Extracts comprehensive vehicle and auction data from RM Sotheby's lot pages.
 * RM Sotheby's is a premium auction house requiring JS rendering and CDN image handling.
 *
 * URL Pattern: https://rmsothebys.com/en/auctions/{auction-code}/lots/{lot-slug}/
 * Example: https://rmsothebys.com/en/auctions/az24/lots/r0019-1961-ferrari-250-gt-swb-berlinetta/
 *
 * Data Sources:
 * - Structured JSON-LD data embedded in page
 * - Meta tags and Open Graph data
 * - Gallery images from cdn.rmsothebys.com
 * - Auction metadata and buyer's premium info
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { firecrawlScrape } from '../_shared/firecrawl.ts';
import { normalizeListingUrlKey } from '../_shared/listingUrl.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RMSothebysExtracted {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;

  // Identifiers
  vin: string | null;
  chassis_number: string | null;
  lot_number: string | null;
  auction_code: string | null;
  lot_slug: string | null;

  // Pricing
  estimate_low: number | null;
  estimate_high: number | null;
  hammer_price: number | null;
  buyers_premium_percent: number | null;
  total_price: number | null;
  currency: string | null;

  // Auction data
  auction_status: 'sold' | 'unsold' | 'upcoming' | 'withdrawn' | null;
  auction_event_name: string | null;
  auction_location: string | null;
  auction_date: string | null;
  sale_date: string | null;

  // Vehicle specs
  mileage: number | null;
  mileage_unit: 'miles' | 'kilometers' | null;
  exterior_color: string | null;
  interior_color: string | null;
  engine: string | null;
  transmission: string | null;
  drivetrain: string | null;
  body_style: string | null;

  // Content
  description: string | null;
  provenance: string | null;
  condition_report: string | null;

  // Media
  image_urls: string[];

  // Metadata
  consignor: string | null;
  seller_username: string | null;
  buyer_username: string | null;
}

interface FetchCostLog {
  source: 'firecrawl' | 'direct';
  costCents: number;
  timestamp: string;
}

// Parse title like "1961 Ferrari 250 GT SWB Berlinetta" into year/make/model
function parseTitleToVehicle(title: string): { year: number | null; make: string | null; model: string | null; trim: string | null } {
  const result: { year: number | null; make: string | null; model: string | null; trim: string | null } = {
    year: null,
    make: null,
    model: null,
    trim: null,
  };

  // Remove common suffixes
  const cleanTitle = title
    .replace(/\s*\|\s*RM Sotheby's$/i, '')
    .replace(/\s*-\s*RM Sotheby's$/i, '')
    .trim();

  // Match year at the start
  const yearMatch = cleanTitle.match(/^(\d{4})\s+/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1]);
    if (year >= 1885 && year <= new Date().getFullYear() + 2) {
      result.year = year;
    }
  }

  // Remove year and parse make/model
  const rest = cleanTitle.replace(/^\d{4}\s+/, '').trim();
  const parts = rest.split(/\s+/);

  if (parts.length >= 2) {
    // Handle compound makes
    const firstLower = parts[0]?.toLowerCase();
    const secondLower = parts[1]?.toLowerCase();

    if (firstLower === 'mercedes' && (secondLower === 'benz' || secondLower?.startsWith('benz'))) {
      result.make = 'Mercedes-Benz';
      result.model = parts.slice(2).join(' ');
    } else if (firstLower === 'aston' && secondLower === 'martin') {
      result.make = 'Aston Martin';
      result.model = parts.slice(2).join(' ');
    } else if (firstLower === 'alfa' && secondLower === 'romeo') {
      result.make = 'Alfa Romeo';
      result.model = parts.slice(2).join(' ');
    } else if (firstLower === 'land' && secondLower === 'rover') {
      result.make = 'Land Rover';
      result.model = parts.slice(2).join(' ');
    } else if (firstLower === 'rolls' && (secondLower === 'royce' || secondLower?.startsWith('royce'))) {
      result.make = 'Rolls-Royce';
      result.model = parts.slice(2).join(' ');
    } else {
      // Single-word makes
      result.make = parts[0];
      result.model = parts.slice(1).join(' ');
    }
  }

  return result;
}

// Extract lot number and auction code from URL
function parseRMSothebysUrl(url: string): { auctionCode: string | null; lotSlug: string | null; lotNumber: string | null } {
  try {
    const u = new URL(url);
    // Pattern: /en/auctions/{auction-code}/lots/{lot-slug}/
    const match = u.pathname.match(/\/auctions\/([^\/]+)\/lots\/([^\/]+)/i);
    if (match) {
      const auctionCode = match[1];
      const lotSlug = match[2];
      // Lot number is often the first part of the slug (e.g., "r0019" from "r0019-1961-ferrari-...")
      const lotNumberMatch = lotSlug.match(/^([a-z]?\d+)/i);
      return {
        auctionCode,
        lotSlug,
        lotNumber: lotNumberMatch?.[1]?.toUpperCase() || null,
      };
    }
  } catch {
    // Invalid URL
  }
  return { auctionCode: null, lotSlug: null, lotNumber: null };
}

// VIN/Chassis validation
function isValidVinOrChassis(str: string): boolean {
  if (!str || str.length < 4) return false;

  // Reject obvious placeholders
  if (/^(.)\1+$/.test(str)) return false;
  if (/^(test|none|na|unknown|n\/a|tbd|tba)/i.test(str)) return false;

  return true;
}

// Extract VIN or chassis number from text
function extractVinOrChassis(html: string): { vin: string | null; chassis: string | null } {
  const result = { vin: null as string | null, chassis: null as string | null };

  // Modern VIN patterns (17 characters)
  const vinPatterns = [
    /\b([1-5JKLWXYZ][A-HJ-NPR-Z0-9]{16})\b/g,
    /VIN[:\s#]*([A-HJ-NPR-Z0-9]{17})\b/gi,
  ];

  for (const pattern of vinPatterns) {
    const matches = html.match(pattern);
    if (matches && matches.length > 0) {
      const candidate = matches[0].replace(/VIN[:\s#]*/gi, '').trim();
      if (isValidVinOrChassis(candidate) && candidate.length === 17) {
        result.vin = candidate.toUpperCase();
        break;
      }
    }
  }

  // Chassis number patterns (classic cars, varies widely)
  const chassisPatterns = [
    /Chassis[:\s#]*([A-Z0-9\-]{4,25})\b/gi,
    /Chassis No\.?[:\s#]*([A-Z0-9\-]{4,25})\b/gi,
    /Chassis Number[:\s#]*([A-Z0-9\-]{4,25})\b/gi,
  ];

  for (const pattern of chassisPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      const candidate = match[1].trim();
      if (isValidVinOrChassis(candidate)) {
        result.chassis = candidate.toUpperCase();
        break;
      }
    }
  }

  return result;
}

// Parse currency amount (handles "USD 150,000" or "$150,000" or "150000")
function parseCurrency(text: string): { amount: number | null; currency: string | null } {
  const cleaned = text.replace(/,/g, '').trim();

  // Match currency code + amount
  const currencyMatch = cleaned.match(/([A-Z]{3})\s*[\$€£¥]?\s*([\d.]+)/i);
  if (currencyMatch) {
    return {
      amount: parseFloat(currencyMatch[2]),
      currency: currencyMatch[1].toUpperCase(),
    };
  }

  // Match symbol + amount
  const symbolMatch = cleaned.match(/[\$€£¥]\s*([\d.]+)/);
  if (symbolMatch) {
    return {
      amount: parseFloat(symbolMatch[1]),
      currency: 'USD', // Default assumption
    };
  }

  // Just a number
  const numberMatch = cleaned.match(/^([\d.]+)$/);
  if (numberMatch) {
    return {
      amount: parseFloat(numberMatch[1]),
      currency: null,
    };
  }

  return { amount: null, currency: null };
}

// Extract structured JSON-LD data (RM Sotheby's often embeds schema.org data)
function extractJsonLd(html: string): any[] {
  const jsonLdBlocks: any[] = [];

  const scriptMatches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);

  for (const match of scriptMatches) {
    try {
      const json = JSON.parse(match[1]);
      jsonLdBlocks.push(json);
    } catch {
      // Skip malformed JSON
    }
  }

  return jsonLdBlocks;
}

// Extract all images from gallery (cdn.rmsothebys.com)
function extractImages(html: string): string[] {
  const images = new Set<string>();

  // Match cdn.rmsothebys.com images
  const cdnMatches = html.matchAll(/https?:\/\/cdn\.rmsothebys\.com[^"'\s)]+/gi);
  for (const match of cdnMatches) {
    let url = match[0];
    // Remove query params for cleaner URLs (optional - some sites use these for resizing)
    // url = url.split('?')[0];
    if (url.includes('/lot/') || url.includes('/image/')) {
      images.add(url);
    }
  }

  // Also check for data attributes and JSON
  const dataImageMatches = html.matchAll(/data-[a-z-]*image[a-z-]*=["']([^"']+)["']/gi);
  for (const match of dataImageMatches) {
    if (match[1].includes('cdn.rmsothebys.com')) {
      images.add(match[1]);
    }
  }

  return Array.from(images);
}

// Main extraction function
async function extractRMSothebysListing(url: string): Promise<{ extracted: RMSothebysExtracted; fetchCost: FetchCostLog }> {
  console.log(`[rm-sothebys] Fetching ${url}`);

  // Use Firecrawl for JS-rendered content
  const startTime = Date.now();
  const firecrawlResult = await firecrawlScrape({
    url,
    formats: ['html', 'markdown'],
    waitFor: 5000,
    timeout: 60000,
    mobile: false,
  });

  const fetchDuration = Date.now() - startTime;
  const fetchCost: FetchCostLog = {
    source: 'firecrawl',
    costCents: 1, // Firecrawl v1 pricing: ~1 cent per scrape
    timestamp: new Date().toISOString(),
  };

  if (!firecrawlResult.success || !firecrawlResult.data.html) {
    throw new Error(`Firecrawl failed: ${firecrawlResult.error || 'No HTML returned'}`);
  }

  const html = firecrawlResult.data.html;
  const markdown = firecrawlResult.data.markdown || '';

  console.log(`[rm-sothebys] Fetched ${html.length} chars HTML in ${fetchDuration}ms`);

  // Initialize extracted data
  const extracted: RMSothebysExtracted = {
    url,
    title: null,
    year: null,
    make: null,
    model: null,
    trim: null,
    vin: null,
    chassis_number: null,
    lot_number: null,
    auction_code: null,
    lot_slug: null,
    estimate_low: null,
    estimate_high: null,
    hammer_price: null,
    buyers_premium_percent: null,
    total_price: null,
    currency: null,
    auction_status: null,
    auction_event_name: null,
    auction_location: null,
    auction_date: null,
    sale_date: null,
    mileage: null,
    mileage_unit: null,
    exterior_color: null,
    interior_color: null,
    engine: null,
    transmission: null,
    drivetrain: null,
    body_style: null,
    description: null,
    provenance: null,
    condition_report: null,
    image_urls: [],
    consignor: null,
    seller_username: null,
    buyer_username: null,
  };

  // Parse URL for auction code and lot number
  const urlParts = parseRMSothebysUrl(url);
  extracted.auction_code = urlParts.auctionCode;
  extracted.lot_slug = urlParts.lotSlug;
  extracted.lot_number = urlParts.lotNumber;

  // Extract title from meta tags or h1
  const titleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
                     html.match(/<title[^>]*>([^<]+)<\/title>/i) ||
                     html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (titleMatch) {
    extracted.title = titleMatch[1]
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .trim();
  }

  // Parse title for year/make/model
  if (extracted.title) {
    const titleData = parseTitleToVehicle(extracted.title);
    extracted.year = titleData.year;
    extracted.make = titleData.make;
    extracted.model = titleData.model;
    extracted.trim = titleData.trim;
  }

  // Extract VIN/Chassis
  const vinChassis = extractVinOrChassis(html);
  extracted.vin = vinChassis.vin;
  extracted.chassis_number = vinChassis.chassis;

  // Extract estimate (common patterns: "Estimate: USD 150,000 - 200,000" or "$150,000 - $200,000")
  const estimateMatch = html.match(/Estimate[:\s]*(?:USD|EUR|GBP)?\s*[\$€£¥]?\s*([\d,]+)\s*[-–—]\s*[\$€£¥]?\s*([\d,]+)/i);
  if (estimateMatch) {
    const low = parseCurrency(estimateMatch[1]);
    const high = parseCurrency(estimateMatch[2]);
    extracted.estimate_low = low.amount;
    extracted.estimate_high = high.amount;
    extracted.currency = low.currency || high.currency;
  }

  // Extract hammer price / sold price
  const soldMatch = html.match(/(?:Sold for|Hammer Price|Final Price)[:\s]*(?:USD|EUR|GBP)?\s*[\$€£¥]?\s*([\d,]+)/i);
  if (soldMatch) {
    const price = parseCurrency(soldMatch[1]);
    extracted.hammer_price = price.amount;
    extracted.auction_status = 'sold';
    extracted.currency = extracted.currency || price.currency;
  }

  // Buyer's premium (RM Sotheby's typically charges 12-20%)
  const premiumMatch = html.match(/(?:Buyer'?s? Premium|Premium)[:\s]*([\d.]+)%/i);
  if (premiumMatch) {
    extracted.buyers_premium_percent = parseFloat(premiumMatch[1]);
  }

  // Calculate total price if hammer price and premium available
  if (extracted.hammer_price && extracted.buyers_premium_percent) {
    extracted.total_price = Math.round(extracted.hammer_price * (1 + extracted.buyers_premium_percent / 100));
  }

  // Auction status detection
  if (!extracted.auction_status) {
    if (html.match(/sold/i) && extracted.hammer_price) {
      extracted.auction_status = 'sold';
    } else if (html.match(/unsold|not sold|withdrawn/i)) {
      extracted.auction_status = 'unsold';
    } else if (html.match(/upcoming|forthcoming/i)) {
      extracted.auction_status = 'upcoming';
    }
  }

  // Extract mileage (handles both miles and kilometers)
  const mileagePatterns = [
    /(\d{1,3}(?:,\d{3})*)\s*(miles|mi|kilometers|km|kms)/gi,
    /Mileage[:\s]*(\d{1,3}(?:,\d{3})*)\s*(miles|mi|kilometers|km|kms)?/gi,
  ];

  for (const pattern of mileagePatterns) {
    const match = html.match(pattern);
    if (match) {
      const num = parseInt(match[1].replace(/,/g, ''));
      const unit = (match[2] || 'miles').toLowerCase();
      extracted.mileage = num;
      extracted.mileage_unit = unit.startsWith('km') ? 'kilometers' : 'miles';
      break;
    }
  }

  // Extract colors
  const exteriorMatch = html.match(/(?:Exterior|Paint|Colour|Color)[:\s]*([A-Za-z\s-]{3,30})/i);
  if (exteriorMatch) {
    extracted.exterior_color = exteriorMatch[1].trim();
  }

  const interiorMatch = html.match(/(?:Interior|Upholstery)[:\s]*([A-Za-z\s-]{3,30})/i);
  if (interiorMatch) {
    extracted.interior_color = interiorMatch[1].trim();
  }

  // Extract engine
  const engineMatch = html.match(/Engine[:\s]*([^<\n]{5,100})/i);
  if (engineMatch) {
    extracted.engine = engineMatch[1].trim();
  }

  // Extract transmission
  const transMatch = html.match(/Transmission[:\s]*([^<\n]{3,50})/i);
  if (transMatch) {
    extracted.transmission = transMatch[1].trim();
  }

  // Extract location
  const locationMatch = html.match(/(?:Location|Venue|Auction Location)[:\s]*([^<\n]{3,100})/i);
  if (locationMatch) {
    extracted.auction_location = locationMatch[1].trim();
  }

  // Extract auction date
  const dateMatch = html.match(/(?:Auction Date|Sale Date)[:\s]*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
  if (dateMatch) {
    try {
      extracted.auction_date = new Date(dateMatch[1]).toISOString().split('T')[0];
    } catch {
      // Invalid date
    }
  }

  // Extract description (look for large text blocks)
  const descMatch = html.match(/<div[^>]*class=["'][^"']*description[^"']*["'][^>]*>([\s\S]{100,5000}?)<\/div>/i);
  if (descMatch) {
    extracted.description = descMatch[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 5000);
  }

  // Extract images
  extracted.image_urls = extractImages(html);

  console.log(`[rm-sothebys] Extracted ${extracted.image_urls.length} images`);

  return { extracted, fetchCost };
}

// Database save function
async function saveToDatabase(supabase: any, extracted: RMSothebysExtracted): Promise<string> {
  console.log(`[rm-sothebys] Saving to database...`);

  // Find or create vehicle
  let vehicleId: string | null = null;

  // Try to find existing by VIN/chassis
  if (extracted.vin) {
    const { data } = await supabase
      .from('vehicles')
      .select('id')
      .eq('vin', extracted.vin)
      .maybeSingle();
    if (data) vehicleId = data.id;
  }

  if (!vehicleId && extracted.chassis_number) {
    const { data } = await supabase
      .from('vehicles')
      .select('id')
      .eq('chassis_number', extracted.chassis_number)
      .maybeSingle();
    if (data) vehicleId = data.id;
  }

  // Try to find by discovery URL
  if (!vehicleId) {
    const { data } = await supabase
      .from('vehicles')
      .select('id')
      .eq('discovery_url', extracted.url)
      .maybeSingle();
    if (data) vehicleId = data.id;
  }

  // Prepare vehicle data
  const vehicleData: any = {
    year: extracted.year,
    make: extracted.make?.toLowerCase(),
    model: extracted.model?.toLowerCase(),
    trim: extracted.trim || null,
    vin: extracted.vin,
    chassis_number: extracted.chassis_number,
    mileage: extracted.mileage,
    color: extracted.exterior_color,
    interior_color: extracted.interior_color,
    transmission: extracted.transmission,
    engine_type: extracted.engine,
    body_style: extracted.body_style,
    description: extracted.description,
    sale_price: extracted.hammer_price || extracted.total_price,
    sale_date: extracted.sale_date || extracted.auction_date,
    sale_status: extracted.auction_status === 'sold' ? 'sold' : 'available',
    profile_origin: 'rm_sothebys_import',
    discovery_source: 'rmsothebys',
    discovery_url: extracted.url,
    listing_url: extracted.url,
    is_public: true,
    status: 'active',
  };

  if (vehicleId) {
    // Update existing
    await supabase
      .from('vehicles')
      .update(vehicleData)
      .eq('id', vehicleId);
    console.log(`[rm-sothebys] Updated vehicle ${vehicleId}`);
  } else {
    // Insert new
    const { data, error } = await supabase
      .from('vehicles')
      .insert(vehicleData)
      .select('id')
      .single();

    if (error) throw error;
    vehicleId = data.id;
    console.log(`[rm-sothebys] Created vehicle ${vehicleId}`);
  }

  // Save external listing
  const listingUrlKey = normalizeListingUrlKey(extracted.url);
  await supabase
    .from('external_listings')
    .upsert({
      vehicle_id: vehicleId,
      platform: 'rmsothebys',
      listing_url: extracted.url,
      listing_url_key: listingUrlKey,
      listing_id: extracted.lot_number || extracted.lot_slug,
      listing_status: extracted.auction_status || 'active',
      current_bid: extracted.hammer_price,
      final_price: extracted.hammer_price,
      end_date: extracted.auction_date,
      sold_at: extracted.auction_status === 'sold' ? extracted.sale_date : null,
      metadata: {
        lot_number: extracted.lot_number,
        auction_code: extracted.auction_code,
        estimate_low: extracted.estimate_low,
        estimate_high: extracted.estimate_high,
        buyers_premium_percent: extracted.buyers_premium_percent,
        total_price: extracted.total_price,
        auction_event_name: extracted.auction_event_name,
        auction_location: extracted.auction_location,
      },
    }, {
      onConflict: 'platform,listing_url_key',
    });

  console.log(`[rm-sothebys] Saved external_listings record`);

  // Save images
  if (extracted.image_urls.length > 0) {
    const imageRecords = extracted.image_urls.map((url, i) => ({
      vehicle_id: vehicleId,
      image_url: url,
      position: i,
      source: 'rmsothebys_import',
      is_external: true,
    }));

    await supabase
      .from('vehicle_images')
      .upsert(imageRecords, {
        onConflict: 'vehicle_id,image_url',
        ignoreDuplicates: false,
      });

    console.log(`[rm-sothebys] Saved ${imageRecords.length} images`);
  }

  // Create auction event record
  if (extracted.auction_code && extracted.auction_event_name) {
    await supabase
      .from('auction_events')
      .upsert({
        auction_house: 'rmsothebys',
        event_code: extracted.auction_code,
        event_name: extracted.auction_event_name,
        event_date: extracted.auction_date,
        location: extracted.auction_location,
        metadata: {
          source: 'rm_sothebys_import',
          discovered_from: extracted.url,
        },
      }, {
        onConflict: 'auction_house,event_code',
      });

    console.log(`[rm-sothebys] Saved auction_events record`);
  }

  return vehicleId!;
}

// Main handler
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { url, save_to_db } = body;

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'url is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!url.includes('rmsothebys.com')) {
      return new Response(
        JSON.stringify({ error: 'URL must be from rmsothebys.com' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { extracted, fetchCost } = await extractRMSothebysListing(url);

    // Log extraction results
    console.log(`=== EXTRACTION RESULTS ===`);
    console.log(`Title: ${extracted.title}`);
    console.log(`Year/Make/Model: ${extracted.year} ${extracted.make} ${extracted.model}`);
    console.log(`VIN: ${extracted.vin || 'NOT FOUND'}`);
    console.log(`Chassis: ${extracted.chassis_number || 'NOT FOUND'}`);
    console.log(`Lot: ${extracted.lot_number || 'NOT FOUND'} (${extracted.auction_code})`);
    console.log(`Estimate: ${extracted.currency} ${extracted.estimate_low?.toLocaleString()} - ${extracted.estimate_high?.toLocaleString()}`);
    console.log(`Hammer: ${extracted.currency} ${extracted.hammer_price?.toLocaleString()} (Status: ${extracted.auction_status})`);
    console.log(`Images: ${extracted.image_urls.length}`);
    console.log(`Fetch cost: ${fetchCost.costCents} cents`);

    let vehicleId: string | null = null;

    if (save_to_db) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );

      vehicleId = await saveToDatabase(supabase, extracted);

      // Log fetch cost
      await supabase
        .from('firecrawl_cost_log')
        .insert({
          function_name: 'extract-rm-sothebys',
          url: extracted.url,
          cost_cents: fetchCost.costCents,
          source: fetchCost.source,
          timestamp: fetchCost.timestamp,
        });
    }

    return new Response(
      JSON.stringify({
        success: true,
        vehicle_id: vehicleId,
        extracted,
        _fetch: {
          source: fetchCost.source,
          cost_cents: fetchCost.costCents,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({
        error: error.message,
        stack: error.stack,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
