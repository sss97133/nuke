/**
 * Historics Auctioneers (UK) Extractor
 *
 * UK premier collector car auction house - Ascot, Brooklands, Farnborough venues
 * URL: historics.co.uk
 *
 * Extracts: year, make, model, estimate (GBP), sold price (GBP), lot number, images
 * Converts GBP to USD for consistency
 *
 * Deploy: supabase functions deploy extract-historics-uk --no-verify-jwt
 *
 * Usage:
 *   POST {"url": "https://historics.co.uk/auction/lot/...", "save_to_db": true}
 *   POST {"action": "scrape_auction", "auction_id": 105}
 *   POST {"action": "list_auctions"}
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { firecrawlScrape } from '../_shared/firecrawl.ts';
import { normalizeListingUrlKey } from '../_shared/listingUrl.ts';
import { resolveExistingVehicleId, discoveryUrlIlikePattern } from '../_shared/resolveVehicleForListing.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Direct HTTP fetch for Historics (no Cloudflare protection)
async function directFetch(url: string): Promise<{ html: string; success: boolean }> {
  // Ensure we use www subdomain (but don't double it)
  let fetchUrl = url;
  if (!url.includes('www.historics.co.uk')) {
    fetchUrl = url.replace('historics.co.uk', 'www.historics.co.uk');
  }

  const response = await fetch(fetchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const html = await response.text();
  return { html, success: true };
}

// GBP to USD exchange rate (updated periodically)
const GBP_TO_USD_RATE = 1.27;

interface HistoricsExtracted {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;

  // Pricing in GBP (original)
  estimate_low_gbp: number | null;
  estimate_high_gbp: number | null;
  sold_price_gbp: number | null;

  // Pricing in USD (converted)
  estimate_low_usd: number | null;
  estimate_high_usd: number | null;
  sold_price_usd: number | null;

  // Auction metadata
  lot_number: string | null;
  auction_id: string | null;
  auction_name: string | null;
  auction_date: string | null;
  venue: string | null;
  auction_status: 'sold' | 'unsold' | 'upcoming' | null;
  no_reserve: boolean;

  // Vehicle specs
  registration: string | null;
  chassis_number: string | null;
  engine_number: string | null;
  mileage: number | null;
  mileage_unit: string | null;

  // Content
  description: string | null;

  // Images
  image_urls: string[];

  // Metadata
  vehicle_id?: string;
  scrape_source: 'firecrawl' | 'direct';
  scrape_cost_cents: number;
}

interface AuctionInfo {
  auction_id: string;
  name: string;
  date: string;
  venue: string;
  url: string;
  lot_count?: number;
}

// Parse GBP amounts: "£9,000", "9000", "Sold £18,876"
function parseGBP(raw: string | null): number | null {
  if (!raw) return null;
  const cleaned = String(raw)
    .replace(/[£,\s]/g, '')
    .replace(/sold/gi, '')
    .trim();
  const match = cleaned.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const num = parseFloat(match[1]);
  return Number.isFinite(num) && num > 0 ? Math.round(num) : null;
}

// Convert GBP to USD
function gbpToUsd(gbp: number | null): number | null {
  if (gbp === null) return null;
  return Math.round(gbp * GBP_TO_USD_RATE);
}

// Parse title to extract year, make, model
function parseTitle(title: string | null): { year: number | null; make: string | null; model: string | null } {
  if (!title) return { year: null, make: null, model: null };

  // Clean the title
  const cleaned = title
    .replace(/^lot\s*\d+\s*[-:.]?\s*/i, '')  // Remove "Lot 123 - " prefix
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim();

  // Extract year (4 digits starting with 19 or 20)
  const yearMatch = cleaned.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? parseInt(yearMatch[0]) : null;

  if (!year) return { year: null, make: null, model: null };

  // Get text after year
  const yearIndex = cleaned.indexOf(yearMatch![0]);
  const afterYear = cleaned.slice(yearIndex + 4).trim();

  // Split by spaces, first word is make, rest is model
  const parts = afterYear.split(/\s+/);
  const make = parts[0] || null;
  const model = parts.slice(1).join(' ') || null;

  return { year, make, model };
}

// Extract lot number from URL or content
function extractLotNumber(url: string, html: string): string | null {
  // From URL: /auction/lot/210-1971-george-barris...
  const urlMatch = url.match(/\/lot\/(\d+)-/);
  if (urlMatch) return urlMatch[1];

  // From URL query: ?lot=18363
  const queryMatch = url.match(/[?&]lot=(\d+)/);
  if (queryMatch) return queryMatch[1];

  // From HTML: "Lot 210" or "LOT 210"
  const htmlMatch = html.match(/Lot\s+(\d+)/i);
  if (htmlMatch) return htmlMatch[1];

  return null;
}

// Extract auction ID from URL
function extractAuctionId(url: string): string | null {
  const match = url.match(/[?&]au=(\d+)/);
  return match ? match[1] : null;
}

// Extract estimate range: "£9,000 - £13,000" or "Estimate: £9,000 - £13,000"
function extractEstimate(html: string, markdown: string): { low: number | null; high: number | null } {
  // Decode HTML entities first
  const decoded = html
    .replace(/&#163;/g, '£')
    .replace(/&pound;/g, '£')
    .replace(/&#8211;/g, '-')
    .replace(/&#8212;/g, '-');
  const combined = `${decoded}\n${markdown}`;

  // Pattern: Estimate £X,XXX - £Y,YYY (more specific to avoid false matches)
  const estimateMatch = combined.match(/Estimate[:\s]*£\s*([\d,]+)\s*[-–]\s*£\s*([\d,]+)/i);
  if (estimateMatch) {
    return {
      low: parseGBP(estimateMatch[1]),
      high: parseGBP(estimateMatch[2]),
    };
  }

  // Fallback: £X,XXX - £Y,YYY near "estimate" word
  const match = combined.match(/estimate[^£]*£\s*([\d,]+)\s*[-–]\s*£?\s*([\d,]+)/i);
  if (match) {
    return {
      low: parseGBP(match[1]),
      high: parseGBP(match[2]),
    };
  }

  return { low: null, high: null };
}

// Extract sold price: "Sold £18,876" or "**Sold £18,876**"
function extractSoldPrice(html: string, markdown: string): number | null {
  const combined = `${html}\n${markdown}`;

  // Pattern: "Sold £X,XXX" or "Sold for £X,XXX"
  const match = combined.match(/sold(?:\s+for)?\s*[£]\s*([\d,]+)/i);
  if (match) {
    return parseGBP(match[1]);
  }

  return null;
}

// Extract vehicle specs from HTML/markdown
function extractSpecs(html: string, markdown: string): {
  registration: string | null;
  chassis_number: string | null;
  engine_number: string | null;
  mileage: number | null;
  mileage_unit: string | null;
} {
  const combined = `${html}\n${markdown}`;

  // Historics uses pattern: <strong>Registration: </strong>EOT 3D
  // Registration (UK format)
  let registration: string | null = null;
  const regMatch = combined.match(/<strong>Registration[:\s]*<\/strong>\s*([A-Z0-9\s]+?)(?:<|$)/i) ||
                   combined.match(/Registration[:\s]*<\/strong>\s*([A-Z0-9\s]+?)(?:<br|$)/i) ||
                   combined.match(/\*\*Registration[:\s]*\*\*\s*([A-Z0-9\s]+)/i);
  if (regMatch) {
    registration = regMatch[1].trim().toUpperCase();
  }

  // Chassis number: <strong>Chassis No: </strong>11101422081348
  let chassis_number: string | null = null;
  const chassisMatch = combined.match(/<strong>Chassis\s*(?:No|Number)?[:\s]*<\/strong>\s*([A-Z0-9\-\/]+)/i) ||
                       combined.match(/\*\*Chassis\s*(?:No|Number)?[:\s]*\*\*\s*([A-Z0-9\-\/]+)/i) ||
                       combined.match(/Chassis\s*(?:No|Number)?[:\s]+([A-Z0-9]{5,20})/i);
  if (chassisMatch) {
    chassis_number = chassisMatch[1].trim().toUpperCase();
  }

  // Engine number
  let engine_number: string | null = null;
  const engineMatch = combined.match(/<strong>Engine\s*(?:No|Number)?[:\s]*<\/strong>\s*([A-Z0-9\-\/]+)/i) ||
                      combined.match(/\*\*Engine\s*(?:No|Number)?[:\s]*\*\*\s*([A-Z0-9\-\/]+)/i);
  if (engineMatch) {
    engine_number = engineMatch[1].trim().toUpperCase();
  }

  // Mileage: <strong>Odometer: </strong>85,168
  let mileage: number | null = null;
  let mileage_unit: string | null = 'miles'; // UK default
  const odometerMatch = combined.match(/<strong>Odometer[:\s]*<\/strong>\s*([\d,]+)/i) ||
                        combined.match(/\*\*Odometer[:\s]*\*\*\s*([\d,]+)/i) ||
                        combined.match(/Odometer[:\s]+([\d,]+)/i);
  if (odometerMatch) {
    mileage = parseInt(odometerMatch[1].replace(/,/g, ''));
  }

  // Fallback: look for mileage with units
  if (!mileage) {
    const mileageMatch = combined.match(/(\d{1,3}(?:,\d{3})*)\s*(miles|km)/i);
    if (mileageMatch) {
      mileage = parseInt(mileageMatch[1].replace(/,/g, ''));
      mileage_unit = mileageMatch[2].toLowerCase();
    }
  }

  return { registration, chassis_number, engine_number, mileage, mileage_unit };
}

// Extract auction info from page
function extractAuctionInfo(html: string, markdown: string): {
  auction_name: string | null;
  auction_date: string | null;
  venue: string | null;
} {
  const combined = `${html}\n${markdown}`;

  // Auction name - look for common patterns
  let auction_name: string | null = null;
  const namePatterns = [
    /Symphony of Spring/i,
    /Flight of Elegance/i,
    /Summer Serenade/i,
    /Pace of Autumn/i,
    /Brooklands Velocity/i,
    /The ([A-Za-z\s]+);?\s*(?:Ascot|Brooklands|Farnborough|Windsor|Mercedes-Benz)/i,
  ];
  for (const pattern of namePatterns) {
    const match = combined.match(pattern);
    if (match) {
      auction_name = match[0].replace(/[;,].*$/, '').trim();
      break;
    }
  }

  // Auction date
  let auction_date: string | null = null;
  const dateMatch = combined.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s*,?\s*(\d{4})/i);
  if (dateMatch) {
    try {
      const date = new Date(`${dateMatch[2]} ${dateMatch[1]}, ${dateMatch[3]}`);
      if (!isNaN(date.getTime())) {
        auction_date = date.toISOString().split('T')[0];
      }
    } catch {}
  }

  // Venue
  let venue: string | null = null;
  const venuePatterns = [
    /Ascot Racecourse/i,
    /Brooklands/i,
    /Mercedes-Benz World/i,
    /Farnborough International/i,
    /Windsorview Lakes/i,
  ];
  for (const pattern of venuePatterns) {
    const match = combined.match(pattern);
    if (match) {
      venue = match[0];
      break;
    }
  }

  return { auction_name, auction_date, venue };
}

// Extract images from HTML
function extractImages(html: string, markdown: string): string[] {
  const images: string[] = [];
  const seenIds = new Set<string>();

  const combined = `${html}\n${markdown}`;

  // Historics uses storagegohistorics.bidpath.cloud for lot images
  // Pattern: stock/XXXXX-N.jpg (full resolution) or stock/XXXXX-N-medium.jpg
  const stockPattern = /https:\/\/storagegohistorics\.bidpath\.cloud\/stock\/(\d+-\d+)(?:-(?:small|medium))?\.jpg/gi;
  const matches = combined.matchAll(stockPattern);

  for (const match of matches) {
    const imageId = match[1]; // e.g., "18682-0"

    // Only add unique images, and prefer full resolution
    if (!seenIds.has(imageId)) {
      seenIds.add(imageId);
      // Use full resolution URL (without -small or -medium)
      const fullResUrl = `https://storagegohistorics.bidpath.cloud/stock/${imageId}.jpg`;
      images.push(fullResUrl);
    }
  }

  // Sort by image number for consistent ordering
  images.sort((a, b) => {
    const numA = parseInt(a.match(/-(\d+)\.jpg/)?.[1] || '0');
    const numB = parseInt(b.match(/-(\d+)\.jpg/)?.[1] || '0');
    return numA - numB;
  });

  return images;
}

// Extract description
function extractDescription(html: string, markdown: string): string | null {
  // Look for the lot description in HTML
  // It's typically in a series of <p> tags after the specs
  const descParagraphs: string[] = [];

  // Find paragraphs that contain vehicle description content
  const paragraphPattern = /<p>([^<]{50,})<\/p>/gi;
  const matches = html.matchAll(paragraphPattern);

  for (const match of matches) {
    const text = match[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Skip boilerplate/legal text
    if (text.includes('registration form') ||
        text.includes('Terms and Conditions') ||
        text.includes('privacy policy') ||
        text.includes('HISTORIC AUCTIONEERS LIMITED') ||
        text.includes("Seller's fee") ||
        text.includes('Bidder') ||
        text.includes('BidPath')) {
      continue;
    }

    // Skip short text that's likely not description
    if (text.length < 80) continue;

    descParagraphs.push(text);
  }

  if (descParagraphs.length > 0) {
    return descParagraphs.slice(0, 5).join('\n\n').slice(0, 5000);
  }

  // Try markdown fallback
  if (markdown) {
    const paragraphs = markdown.split(/\n\n+/).filter(p =>
      p.length > 100 &&
      !p.includes('registration form') &&
      !p.includes('Terms and Conditions')
    );
    if (paragraphs.length > 0) {
      return paragraphs.slice(0, 3).join('\n\n').slice(0, 5000);
    }
  }

  return null;
}

// Main extraction function for a single lot
async function extractHistoricsLot(url: string, useDirectFetch = false): Promise<HistoricsExtracted> {
  console.log(`[Historics] Fetching: ${url}`);

  let html = '';
  let markdown = '';
  let costCents = 0;
  let scrapeSource: 'firecrawl' | 'direct' = 'direct';

  if (useDirectFetch) {
    // Use direct HTTP fetch (no Cloudflare on Historics)
    console.log(`[Historics] Using direct HTTP fetch`);
    const directResult = await directFetch(url);
    html = directResult.html;
    scrapeSource = 'direct';
    costCents = 0;
    console.log(`[Historics] Direct fetch returned ${html.length} bytes HTML`);
  } else {
    // Try Firecrawl first, fall back to direct fetch
    try {
      const result = await firecrawlScrape({
        url,
        formats: ['html', 'markdown'],
        waitFor: 3000,
        onlyMainContent: false,
      });

      if (result.success || result.data.html || result.data.markdown) {
        html = result.data.html || '';
        markdown = result.data.markdown || '';
        costCents = 1;
        scrapeSource = 'firecrawl';
        console.log(`[Historics] Firecrawl returned ${html.length} bytes HTML, ${markdown.length} bytes markdown`);
      } else {
        throw new Error(result.error || 'Firecrawl returned no content');
      }
    } catch (firecrawlError: any) {
      // Fallback to direct fetch
      console.log(`[Historics] Firecrawl failed (${firecrawlError.message}), falling back to direct fetch`);
      const directResult = await directFetch(url);
      html = directResult.html;
      scrapeSource = 'direct';
      costCents = 0;
      console.log(`[Historics] Direct fetch returned ${html.length} bytes HTML`);
    }
  }

  // Extract title from <title> tag or <h1>
  let title: string | null = null;
  const titleTagMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleTagMatch) {
    title = titleTagMatch[1].trim();
  }
  if (!title) {
    const mdTitleMatch = markdown.match(/^#\s+(?:\d+\s+)?(.+?)$/m);
    if (mdTitleMatch) {
      title = mdTitleMatch[1].trim();
    }
  }
  if (!title) {
    const h1Match = html.match(/<h1[^>]*class="lot-title[^"]*"[^>]*>[\s\S]*?<\/h1>/i);
    if (h1Match) {
      // Extract text content from h1
      title = h1Match[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  const { year, make, model } = parseTitle(title);
  const lotNumber = extractLotNumber(url, html);
  const auctionId = extractAuctionId(url);
  const { low: estimateLow, high: estimateHigh } = extractEstimate(html, markdown);
  const soldPrice = extractSoldPrice(html, markdown);
  const specs = extractSpecs(html, markdown);
  const auctionInfo = extractAuctionInfo(html, markdown);
  const images = extractImages(html, markdown);
  const description = extractDescription(html, markdown);

  // Determine auction status
  let auctionStatus: 'sold' | 'unsold' | 'upcoming' | null = null;
  if (soldPrice) {
    auctionStatus = 'sold';
  } else if (html.toLowerCase().includes('unsold') || markdown.toLowerCase().includes('unsold')) {
    auctionStatus = 'unsold';
  } else if (auctionInfo.auction_date) {
    const auctionDate = new Date(auctionInfo.auction_date);
    if (auctionDate > new Date()) {
      auctionStatus = 'upcoming';
    }
  }

  // Check for no reserve
  const noReserve = /(?:no reserve|offered without reserve)/i.test(html) || /(?:no reserve|offered without reserve)/i.test(markdown);

  console.log(`[Historics] Extracted: ${title}`);
  console.log(`[Historics] Year/Make/Model: ${year} ${make} ${model}`);
  console.log(`[Historics] Lot: ${lotNumber} | Auction: ${auctionId} | Status: ${auctionStatus}`);
  console.log(`[Historics] Estimate: £${estimateLow?.toLocaleString()} - £${estimateHigh?.toLocaleString()}`);
  console.log(`[Historics] Sold: ${soldPrice ? `£${soldPrice.toLocaleString()}` : 'N/A'}`);
  console.log(`[Historics] Images: ${images.length}`);

  return {
    url,
    title,
    year,
    make,
    model,

    // GBP prices
    estimate_low_gbp: estimateLow,
    estimate_high_gbp: estimateHigh,
    sold_price_gbp: soldPrice,

    // USD conversions
    estimate_low_usd: gbpToUsd(estimateLow),
    estimate_high_usd: gbpToUsd(estimateHigh),
    sold_price_usd: gbpToUsd(soldPrice),

    lot_number: lotNumber,
    auction_id: auctionId,
    auction_name: auctionInfo.auction_name,
    auction_date: auctionInfo.auction_date,
    venue: auctionInfo.venue,
    auction_status: auctionStatus,
    no_reserve: noReserve,

    registration: specs.registration,
    chassis_number: specs.chassis_number,
    engine_number: specs.engine_number,
    mileage: specs.mileage,
    mileage_unit: specs.mileage_unit,

    description,
    image_urls: images,

    scrape_source: scrapeSource as any,
    scrape_cost_cents: costCents,
  };
}

// Get list of all lots from an auction page
async function getAuctionLots(auctionId: string): Promise<string[]> {
  // Use the auction details page with all lots
  const baseUrl = `https://www.historics.co.uk/auction/details/auction?au=${auctionId}&pp=200`;

  console.log(`[Historics] Fetching auction lot list: ${baseUrl}`);

  // Use direct fetch (no Cloudflare)
  const { html } = await directFetch(baseUrl);
  const lotUrls: string[] = [];

  // Find lot URLs: /auction/lot/xxx-title/?lot=123&au=96
  const pattern = /href="(\/auction\/lot\/[^"]+\?lot=\d+[^"]*)"/gi;
  const matches = html.matchAll(pattern);

  for (const match of matches) {
    const path = match[1];
    const fullUrl = `https://www.historics.co.uk${path}`;
    if (!lotUrls.includes(fullUrl)) {
      lotUrls.push(fullUrl);
    }
  }

  console.log(`[Historics] Found ${lotUrls.length} lots in auction ${auctionId}`);
  return lotUrls;
}

// List available auctions
async function listAuctions(): Promise<AuctionInfo[]> {
  const auctions: AuctionInfo[] = [];

  // Upcoming auctions - use direct fetch
  const { html } = await directFetch('https://www.historics.co.uk/upcoming-auctions');

  // Extract auction links: /auction/details/a073-xxx?au=105
  const pattern = /href="(\/auction\/details\/[^"]+\?au=(\d+))"/gi;
  const matches = html.matchAll(pattern);

  for (const match of matches) {
    const url = `https://www.historics.co.uk${match[1]}`;
    const auctionId = match[2];

    // Get auction name from URL slug
    const nameMatch = match[1].match(/\/auction\/details\/a\d+-([^?]+)/);
    const name = nameMatch
      ? nameMatch[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      : `Auction ${auctionId}`;

    auctions.push({
      auction_id: auctionId,
      name,
      date: 'Upcoming',
      venue: name.includes('Ascot') ? 'Ascot Racecourse' :
             name.includes('Brooklands') ? 'Mercedes-Benz World' :
             name.includes('Farnborough') ? 'Farnborough International' : 'TBD',
      url,
    });
  }

  return auctions;
}

// Save extracted data to database
async function saveToDatabase(
  supabase: any,
  extracted: HistoricsExtracted
): Promise<string> {
  // Try to find existing vehicle by URL
  let vehicleId: string | null = null;

  const { data: existing } = await supabase
    .from('vehicles')
    .select('id')
    .eq('discovery_url', extracted.url)
    .maybeSingle();

  if (existing) {
    vehicleId = existing.id;
  }

  const vehicleData = {
    year: extracted.year,
    make: extracted.make?.toLowerCase(),
    model: extracted.model?.toLowerCase(),
    vin: extracted.chassis_number?.toUpperCase() || null,
    mileage: extracted.mileage,
    description: extracted.description,
    sale_price: extracted.sold_price_usd, // Store USD for consistency
    sale_date: extracted.auction_date,
    sale_status: extracted.auction_status === 'sold' ? 'sold' : 'available',
    auction_end_date: extracted.auction_date,
    auction_outcome: extracted.auction_status === 'sold' ? 'sold' :
                     extracted.auction_status === 'unsold' ? 'reserve_not_met' : null,
    listing_url: extracted.url,
    discovery_url: extracted.url,
    discovery_source: 'historics',
    profile_origin: 'historics_import',
    is_public: true,
    origin_metadata: {
      source: 'historics_import',
      lot_number: extracted.lot_number,
      auction_id: extracted.auction_id,
      auction_name: extracted.auction_name,
      venue: extracted.venue,
      registration: extracted.registration,
      chassis_number: extracted.chassis_number,
      engine_number: extracted.engine_number,
      estimate_low_gbp: extracted.estimate_low_gbp,
      estimate_high_gbp: extracted.estimate_high_gbp,
      estimate_low_usd: extracted.estimate_low_usd,
      estimate_high_usd: extracted.estimate_high_usd,
      sold_price_gbp: extracted.sold_price_gbp,
      sold_price_usd: extracted.sold_price_usd,
      no_reserve: extracted.no_reserve,
      mileage_unit: extracted.mileage_unit,
      imported_at: new Date().toISOString(),
      gbp_to_usd_rate: GBP_TO_USD_RATE,
    },
  };

  if (vehicleId) {
    await supabase
      .from('vehicles')
      .update(vehicleData)
      .eq('id', vehicleId);
    console.log(`[Historics] Updated vehicle: ${vehicleId}`);
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
    console.log(`[Historics] Created vehicle: ${vehicleId}`);
  }

  // Save images
  if (extracted.image_urls.length > 0 && vehicleId) {
    const imageRecords = extracted.image_urls.map((img_url, i) => ({
      vehicle_id: vehicleId,
      image_url: img_url,
      position: i,
      source: 'historics_import',
      is_external: true,
    }));

    const { error: imgError } = await supabase
      .from('vehicle_images')
      .upsert(imageRecords, {
        onConflict: 'vehicle_id,image_url',
        ignoreDuplicates: false,
      });

    if (imgError) {
      console.error('[Historics] Image save error:', imgError);
    } else {
      console.log(`[Historics] Saved ${imageRecords.length} images`);
    }
  }

  // Create external_listings record
  const listingUrlKey = normalizeListingUrlKey(extracted.url);
  const { error: listingError } = await supabase
    .from('external_listings')
    .upsert({
      vehicle_id: vehicleId,
      platform: 'historics',
      listing_url: extracted.url,
      listing_url_key: listingUrlKey,
      listing_id: extracted.lot_number || listingUrlKey,
      listing_status: extracted.auction_status === 'sold' ? 'sold' :
                     extracted.auction_status === 'upcoming' ? 'active' : 'ended',
      end_date: extracted.auction_date,
      final_price: extracted.sold_price_usd,
      sold_at: extracted.auction_status === 'sold' ? extracted.auction_date : null,
      metadata: {
        lot_number: extracted.lot_number,
        auction_id: extracted.auction_id,
        auction_name: extracted.auction_name,
        venue: extracted.venue,
        estimate_low_gbp: extracted.estimate_low_gbp,
        estimate_high_gbp: extracted.estimate_high_gbp,
        estimate_low_usd: extracted.estimate_low_usd,
        estimate_high_usd: extracted.estimate_high_usd,
        sold_price_gbp: extracted.sold_price_gbp,
        no_reserve: extracted.no_reserve,
        chassis_number: extracted.chassis_number,
      },
    }, {
      onConflict: 'platform,listing_url_key',
    });

  if (listingError) {
    console.error('[Historics] External listing save error:', listingError);
  }

  // Create timeline event
  if (extracted.auction_date) {
    const eventType = extracted.auction_status === 'sold' ? 'auction_sold' : 'auction_listed';
    const eventTitle = extracted.auction_status === 'sold'
      ? `Sold at ${extracted.auction_name || 'Historics'} (Lot ${extracted.lot_number || 'N/A'})`
      : `Listed at ${extracted.auction_name || 'Historics'} (Lot ${extracted.lot_number || 'N/A'})`;
    const eventDesc = extracted.auction_status === 'sold'
      ? `Sold for £${extracted.sold_price_gbp?.toLocaleString()} (~$${extracted.sold_price_usd?.toLocaleString()}) at ${extracted.venue || 'UK'}`
      : `Estimate: £${extracted.estimate_low_gbp?.toLocaleString()} - £${extracted.estimate_high_gbp?.toLocaleString()} at ${extracted.venue || 'UK'}`;

    await supabase.from('timeline_events').insert({
      vehicle_id: vehicleId,
      event_type: eventType,
      event_date: extracted.auction_date,
      title: eventTitle,
      description: eventDesc,
      source: 'historics_import',
      metadata: {
        lot_number: extracted.lot_number,
        auction_id: extracted.auction_id,
        auction_name: extracted.auction_name,
        sold_price_gbp: extracted.sold_price_gbp,
        sold_price_usd: extracted.sold_price_usd,
      },
    });
    console.log(`[Historics] Created timeline event`);
  }

  return vehicleId!;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { url, action, auction_id, save_to_db = true, batch_size = 10, use_direct_fetch = true } = body;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Action: List available auctions
    if (action === 'list_auctions') {
      const auctions = await listAuctions();
      return new Response(
        JSON.stringify({ success: true, auctions }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Action: Scrape an entire auction
    if (action === 'scrape_auction' && auction_id) {
      const lotUrls = await getAuctionLots(auction_id);
      const results: { url: string; vehicle_id?: string; error?: string }[] = [];

      // Process in batches - use direct fetch for bulk processing
      for (let i = 0; i < Math.min(lotUrls.length, batch_size); i++) {
        const lotUrl = lotUrls[i];
        try {
          const extracted = await extractHistoricsLot(lotUrl, true); // Use direct fetch

          if (save_to_db) {
            const vehicleId = await saveToDatabase(supabase, extracted);
            extracted.vehicle_id = vehicleId;
          }

          // Log API usage
          await supabase.from('api_usage_logs').insert({
            user_id: null,
            provider: 'firecrawl',
            function_name: 'extract-historics-uk',
            cost_cents: extracted.scrape_cost_cents,
            success: true,
            metadata: {
              url: lotUrl,
              lot_number: extracted.lot_number,
              auction_id,
              image_count: extracted.image_urls.length,
            },
          });

          results.push({ url: lotUrl, vehicle_id: extracted.vehicle_id });
        } catch (error: any) {
          console.error(`[Historics] Error extracting ${lotUrl}:`, error);
          results.push({ url: lotUrl, error: error.message });
        }

        // Small delay between requests
        if (i < lotUrls.length - 1) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          auction_id,
          total_lots: lotUrls.length,
          processed: results.length,
          results,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Single URL extraction
    if (!url || !url.includes('historics.co.uk')) {
      return new Response(
        JSON.stringify({ error: 'Invalid Historics URL. Provide a historics.co.uk lot URL.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Historics] Extracting: ${url}`);
    const extracted = await extractHistoricsLot(url, use_direct_fetch);

    // Log API usage
    await supabase.from('api_usage_logs').insert({
      user_id: null,
      provider: 'firecrawl',
      function_name: 'extract-historics-uk',
      cost_cents: extracted.scrape_cost_cents,
      success: true,
      metadata: {
        url,
        lot_number: extracted.lot_number,
        image_count: extracted.image_urls.length,
      },
    });

    // Save to database if requested
    if (save_to_db) {
      const vehicleId = await saveToDatabase(supabase, extracted);
      extracted.vehicle_id = vehicleId;
    }

    return new Response(
      JSON.stringify({
        success: true,
        extracted,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[Historics] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
