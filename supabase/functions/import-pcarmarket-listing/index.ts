import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { normalizeMake, normalizeVehicleFields } from '../_shared/normalizeVehicle.ts';
import { writeObservation } from '../_shared/observationWriter.ts';
import { requireWriteAuth } from '../_shared/writeGuard.ts';
import { projectSecretKey } from "../_shared/supabaseKeys.ts";
import { parseSsrPage } from "./ssrPage.ts";
import { fillOnlyIdentity, identityConflict, REVISION_DIFFERENT_CAR } from '../_shared/identityMatch.ts';
import { parseLocation } from "../_shared/parseLocation.ts";
import { batchFromTargets, discoverTargets, revisePcm } from "./targets.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PCarMarketListing {
  url: string;
  title: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  vin?: string;
  mileage?: number;
  salePrice?: number;
  saleDate?: string;
  auctionEndDate?: string;
  auctionOutcome?: 'sold' | 'reserve_not_met' | null;
  description?: string;
  seller?: string;
  sellerUsername?: string;
  sellerId?: number;
  buyer?: string;
  buyerUsername?: string;
  images?: string[];
  slug?: string;
  auctionId?: string;
  lotNumber?: string;
  bidCount?: number;
  viewCount?: number;
  watchCount?: number;
  location?: string;
  reserveStatus?: string;
  isMemorabillia?: boolean;
  color?: string;
  interiorColor?: string;
  engine?: string;
  transmission?: string;
  bids?: { user: string; at: string | null; amount: number; kind: 'bid' | 'sold' | 'offer' }[];
  reserveMet?: boolean;
  photosClaimed?: number;
}

// Validate VIN - reject obvious placeholders
function isValidVin(vin: string): boolean {
  if (!vin || vin.length < 6 || vin.length > 17) return false;

  // Reject all-same-digit VINs like "000000" or "111111"
  if (/^(.)\1+$/.test(vin)) return false;

  // Reject sequential patterns like "123456"
  if (/^(0123456|1234567|12345678|123456789)/.test(vin)) return false;

  // Reject obviously invalid patterns
  if (/^(test|none|na|unknown|n\/a)/i.test(vin)) return false;

  return true;
}

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    u.search = '';
    // Normalize www prefix for consistent matching
    u.hostname = u.hostname.replace(/^www\./, '');
    // Strip trailing slash for consistent matching with existing DB records
    let result = u.toString();
    if (result.endsWith('/')) result = result.slice(0, -1);
    return result;
  } catch {
    const base = String(raw).split('#')[0].split('?')[0];
    return base.endsWith('/') ? base.slice(0, -1) : base;
  }
}

// Parse title like "2007 Porsche 911 Carrera 4S" into year/make/model
function parseTitleToVehicle(title: string): { year?: number; make?: string; model?: string } {
  const result: { year?: number; make?: string; model?: string } = {};

  // Remove site name suffix
  const cleanTitle = title.replace(/\s*\|\s*PCARMARKET$/i, '').trim();

  // Match year at the start
  const yearMatch = cleanTitle.match(/^(\d{4})\s+/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);
    if (year >= 1885 && year <= new Date().getFullYear() + 2) {
      result.year = year;
    }
  }

  // Remove year and parse make/model
  const rest = cleanTitle.replace(/^\d{4}\s+/, '').trim();
  const parts = rest.split(/\s+/);

  if (parts.length >= 1) {
    // Handle compound makes like "Mercedes-Benz", "Aston Martin", etc.
    const firstLower = parts[0]?.toLowerCase();
    const secondLower = parts[1]?.toLowerCase();

    if (firstLower === 'mercedes' && secondLower === 'benz') {
      result.make = 'mercedes-benz';
      result.model = parts.slice(2).join(' ').toLowerCase();
    } else if (firstLower === 'aston' && secondLower === 'martin') {
      result.make = 'aston martin';
      result.model = parts.slice(2).join(' ').toLowerCase();
    } else if (firstLower === 'alfa' && secondLower === 'romeo') {
      result.make = 'alfa romeo';
      result.model = parts.slice(2).join(' ').toLowerCase();
    } else if (firstLower === 'land' && secondLower === 'rover') {
      result.make = 'land rover';
      result.model = parts.slice(2).join(' ').toLowerCase();
    } else if (firstLower === 'rolls' && secondLower === 'royce') {
      result.make = 'rolls-royce';
      result.model = parts.slice(2).join(' ').toLowerCase();
    } else {
      // Single-word makes: Porsche, BMW, Ferrari, etc.
      result.make = firstLower;
      result.model = parts.slice(1).join(' ').toLowerCase();
    }
  }

  return result;
}

// Parse bid field like "SOLD$39,00026 BidsEnded Apr 16, 201917,241 Views • 44 Saves"
function parseBidField(bidText: string): {
  sold: boolean;
  price?: number;
  bidCount?: number;
  viewCount?: number;
  watchCount?: number;
  endDate?: string;
} {
  const result: {
    sold: boolean;
    price?: number;
    bidCount?: number;
    viewCount?: number;
    watchCount?: number;
    endDate?: string;
  } = { sold: false };

  // Check if sold
  if (/sold/i.test(bidText)) {
    result.sold = true;
  }

  // Extract price (handle both "$39,000" and "$39000")
  const priceMatch = bidText.match(/\$?([\d,]+)/);
  if (priceMatch) {
    result.price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
  }

  // Extract bid count
  const bidMatch = bidText.match(/([\d,]+)\s*Bids?/i);
  if (bidMatch) {
    result.bidCount = parseInt(bidMatch[1].replace(/,/g, ''), 10);
  }

  // Extract views
  const viewMatch = bidText.match(/([\d,]+)\s*Views?/i);
  if (viewMatch) {
    result.viewCount = parseInt(viewMatch[1].replace(/,/g, ''), 10);
  }

  // Extract saves/watches
  const saveMatch = bidText.match(/([\d,]+)\s*Saves?/i);
  if (saveMatch) {
    result.watchCount = parseInt(saveMatch[1].replace(/,/g, ''), 10);
  }

  // Extract end date (e.g., "Ended Apr 16, 2019" or "Apr 16, 2019")
  const dateMatch = bidText.match(/(?:Ended\s+)?([A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4})/i);
  if (dateMatch) {
    try {
      const parsed = new Date(dateMatch[1]);
      if (!isNaN(parsed.getTime())) {
        result.endDate = parsed.toISOString();
      }
    } catch {}
  }

  return result;
}

// Parse seller field like "woodardsaMessage SellerFollow Seller..."
function parseSellerField(sellerText: string): string | null {
  // Username is usually at the start before "Message Seller"
  const match = sellerText.match(/^([a-zA-Z0-9_-]+)/);
  return match?.[1] || null;
}

function parsePCarMarketIdentityFromUrl(url: string): { year: number; make: string; model: string } | null {
  try {
    const u = new URL(url);

    // Pattern 1: /auction/YEAR-slug (slug may or may not end with a numeric dedup suffix)
    // Pattern 2: /marketplace-YEAR-make-model... (e.g. /marketplace-2005-land-rover-range-rover)
    let pathMatch = u.pathname.match(/\/auction\/(\d{4})-(.+?)\/?$/i);
    if (!pathMatch) {
      // Try marketplace slug pattern: /marketplace-YEAR-rest-of-slug
      pathMatch = u.pathname.match(/\/marketplace-(\d{4})-(.+?)\/?$/i);
    }
    if (!pathMatch?.[1] || !pathMatch?.[2]) return null;

    const year = Number(pathMatch[1]);
    if (!Number.isFinite(year) || year < 1885 || year > new Date().getFullYear() + 1) return null;

    // Remove trailing numeric dedup suffix (e.g., "-2" at end of "porsche-911-turbo-2")
    let slug = pathMatch[2];
    slug = slug.replace(/-\d+$/, '');

    const parts = slug.split('-').filter(Boolean);
    if (parts.length < 2) return null;

    // Handle compound makes, otherwise single word
    const first = parts[0]?.toLowerCase();
    const second = parts[1]?.toLowerCase();
    let make: string;
    let modelStart: number;

    if (first === 'mercedes' && second === 'benz') {
      make = 'mercedes-benz';
      modelStart = 2;
    } else if (first === 'aston' && second === 'martin') {
      make = 'aston martin';
      modelStart = 2;
    } else if (first === 'alfa' && second === 'romeo') {
      make = 'alfa romeo';
      modelStart = 2;
    } else if (first === 'land' && second === 'rover') {
      make = 'land rover';
      modelStart = 2;
    } else if (first === 'rolls' && second === 'royce') {
      make = 'rolls-royce';
      modelStart = 2;
    } else {
      // Single-word makes: porsche, bmw, ferrari, etc.
      make = first;
      modelStart = 1;
    }

    const model = parts.slice(modelStart).join(' ').toLowerCase();
    return { year, make, model: model || 'unknown' };
  } catch {
    return null;
  }
}

async function scrapePCarMarketListing(url: string, providedHtml?: string): Promise<PCarMarketListing | null> {
  try {
    let html: string;

    // Use provided HTML if available (for pre-scraped content)
    if (providedHtml) {
      console.log('[pcarmarket] Using provided HTML');
      html = providedHtml;
    } else {
      // PCarMarket is a React SPA - needs JS rendering for full data
      // Strategy: Firecrawl first (full JS), direct fetch fallback (meta tags + URL parsing)
      const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
      let firecrawlWorked = false;

      if (FIRECRAWL_API_KEY) {
        try {
          console.log('[pcarmarket] Fetching via Firecrawl (JS rendering)...');
          const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              url: url,
              formats: ['rawHtml', 'markdown', 'extract'],
              extract: {
                schema: {
                  type: 'object',
                  properties: {
                    vin: { type: 'string', description: 'Vehicle VIN or chassis number' },
                    mileage: { type: 'number', description: 'Current mileage/odometer reading' },
                    price: { type: 'number', description: 'Final sale price or current high bid in dollars' },
                    sold: { type: 'boolean', description: 'Whether the auction has sold' },
                    bid_count: { type: 'number', description: 'Number of bids placed' },
                    end_date: { type: 'string', description: 'Auction end date' },
                    seller: { type: 'string', description: 'Seller username' },
                    exterior_color: { type: 'string', description: 'Exterior color' },
                    interior_color: { type: 'string', description: 'Interior color' },
                    transmission: { type: 'string', description: 'Transmission type' },
                    engine: { type: 'string', description: 'Engine description' },
                  },
                },
              },
              waitFor: 10000,
              timeout: 45000,
              mobile: false,
              actions: [
                { type: 'wait', milliseconds: 5000 },
                { type: 'scroll', direction: 'down', pixels: 800 },
                { type: 'wait', milliseconds: 2000 },
                { type: 'scroll', direction: 'down', pixels: 1200 },
                { type: 'wait', milliseconds: 3000 },
              ],
            }),
            signal: AbortSignal.timeout(55_000),
          });

          if (firecrawlResponse.ok) {
            const firecrawlData = await firecrawlResponse.json();
            if (firecrawlData.success && firecrawlData.data?.rawHtml) {
              html = firecrawlData.data.rawHtml;
              // Store LLM extraction for later use
              const llmExtract = firecrawlData.data?.extract;
              if (llmExtract) {
                console.log(`[pcarmarket] LLM extracted: mileage=${llmExtract.mileage}, price=${llmExtract.price}, sold=${llmExtract.sold}`);
                html = JSON.stringify({ llmExtract, html });
              }
              console.log(`[pcarmarket] Firecrawl returned ${html.length} chars`);
              firecrawlWorked = true;
            } else {
              console.warn(`[pcarmarket] Firecrawl returned no data: ${firecrawlData.error || 'empty'}`);
            }
          } else {
            console.warn(`[pcarmarket] Firecrawl HTTP ${firecrawlResponse.status}`);
          }
        } catch (fcErr: any) {
          console.warn(`[pcarmarket] Firecrawl failed: ${fcErr.message}`);
        }
      }

      // Fallback: direct fetch for meta tags + URL-based parsing
      if (!firecrawlWorked) {
        console.log('[pcarmarket] Using direct fetch fallback (meta tags + URL parsing)...');
        try {
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            signal: AbortSignal.timeout(30_000),
          });
          html = await response.text();
          console.log(`[pcarmarket] Direct fetch returned ${html.length} chars`);
        } catch (fetchErr: any) {
          console.warn(`[pcarmarket] Direct fetch also failed: ${fetchErr.message}`);
          html = '';
        }
      }
    }

    // Current pages are server-rendered (Car Details block in the HTML): read them without JS rendering.
    const ssr = parseSsrPage(html);
    if (ssr) {
      const slug = url.match(/\/auction\/([^\/\?]+)/)?.[1];
      return {
        url: normalizeUrl(url),
        title: ssr.title,
        year: ssr.year,
        make: ssr.make,
        model: ssr.model,
        vin: ssr.vin,
        mileage: ssr.mileage,
        salePrice: ssr.salePrice,
        auctionEndDate: ssr.auctionEndDate,
        saleDate: ssr.auctionOutcome === 'sold' ? ssr.auctionEndDate : undefined,
        auctionOutcome: ssr.auctionOutcome === 'sold' ? 'sold' : ssr.auctionOutcome === 'reserve_not_met' ? 'reserve_not_met' : null,
        description: ssr.description,
        images: ssr.images,
        slug,
        auctionId: slug?.split('-').pop() || undefined,
        bidCount: ssr.bidCount,
        viewCount: ssr.viewCount,
        location: ssr.location,
        reserveStatus: ssr.auctionType,
        color: ssr.color,
        interiorColor: ssr.interiorColor,
        transmission: ssr.transmission,
        bids: ssr.bids,
        reserveMet: ssr.reserveMet,
        photosClaimed: ssr.photosClaimed,
        buyerUsername: ssr.bids.find((b) => b.kind === 'sold')?.user,
      };
    }

    // Initialize listing
    const listing: PCarMarketListing = {
      url: normalizeUrl(url),
      title: '',
      images: []
    };

    // Extract slug from URL first
    const slugMatch = url.match(/\/auction\/([^\/\?]+)/);
    if (slugMatch) {
      listing.slug = slugMatch[1];
      listing.auctionId = slugMatch[1].split('-').pop() || undefined;
    }

    // Check if the provided HTML is actually a JSON object from our Playwright scraper
    // Format: { source: "dom", meta: {...}, dom: {...}, images: [...], html: "..." }
    if (html.trim().startsWith('{') && html.includes('"source"')) {
      try {
        const scraperData = JSON.parse(html);

        if (scraperData.source === 'dom' && scraperData.meta) {
          console.log('[pcarmarket] Processing Playwright DOM extraction data');

          // Extract from meta tags
          if (scraperData.meta.title) {
            listing.title = scraperData.meta.title.replace(/\s*\|\s*PCARMARKET$/i, '').trim();
          }

          // Parse title for year/make/model
          const titleData = parseTitleToVehicle(scraperData.meta.title || scraperData.dom?.h1 || '');
          listing.year = titleData.year;
          listing.make = titleData.make;
          listing.model = titleData.model;

          // Parse bid field for price, status, counts, date
          if (scraperData.dom?.bid) {
            const bidData = parseBidField(scraperData.dom.bid);
            listing.salePrice = bidData.price;
            listing.bidCount = bidData.bidCount;
            listing.viewCount = bidData.viewCount;
            listing.watchCount = bidData.watchCount;
            if (bidData.sold) {
              listing.auctionOutcome = 'sold';
              listing.saleDate = bidData.endDate;
            }
            listing.auctionEndDate = bidData.endDate;
          }

          // Parse seller username
          if (scraperData.dom?.seller) {
            listing.sellerUsername = parseSellerField(scraperData.dom.seller);
          }

          // Get images from scraper
          if (scraperData.images?.length) {
            listing.images = scraperData.images;
          }

          // If the scraper also passed the full HTML, extract more data from it
          if (scraperData.html) {
            html = scraperData.html;
            // Continue to the JSON/regex extraction below to fill in any missing data
          } else {
            // No HTML available, use URL parsing as fallback
            if (!listing.year || !listing.make) {
              const urlIdentity = parsePCarMarketIdentityFromUrl(url);
              if (urlIdentity) {
                listing.year = listing.year || urlIdentity.year;
                listing.make = listing.make || urlIdentity.make;
                listing.model = listing.model || urlIdentity.model;
              }
            }
            return listing;
          }
        }
      } catch (e) {
        console.log('[pcarmarket] Input is not valid JSON, treating as HTML');
      }
    }

    // Extract meta tags (available even without JS rendering)
    // PCarMarket uses unquoted attributes: content="..."property=og:title
    const ogTitle = html.match(/content="([^"]+)"[^>]*property=["']?og:title["']?/i)?.[1] ||
                    html.match(/property=["']?og:title["']?[^>]*content="([^"]+)"/i)?.[1];
    const ogDescription = html.match(/content="([^"]+)"[^>]*property=["']?og:description["']?/i)?.[1] ||
                          html.match(/property=["']?og:description["']?[^>]*content="([^"]+)"/i)?.[1];
    const ogImage = html.match(/content="([^"]+)"[^>]*property=["']?og:image["']?/i)?.[1] ||
                    html.match(/property=["']?og:image["']?[^>]*content="([^"]+)"/i)?.[1];
    const pageTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];

    if (ogTitle || pageTitle) {
      const cleanTitle = (ogTitle || pageTitle || '').replace(/\s*\|\s*PCARMARKET$/i, '').trim();
      if (cleanTitle && !listing.title) {
        listing.title = cleanTitle;
        const titleData = parseTitleToVehicle(cleanTitle);
        if (titleData.year) listing.year = listing.year || titleData.year;
        if (titleData.make) listing.make = listing.make || titleData.make;
        if (titleData.model) listing.model = listing.model || titleData.model;
      }
    }
    if (ogDescription && !listing.description) {
      listing.description = ogDescription;
    }
    if (ogImage && (!listing.images || listing.images.length === 0)) {
      listing.images = [ogImage];
    }

    // PRIORITY: Try to extract embedded JSON data (PCarMarket embeds all data as JSON)
    // Look for common patterns where JSON is embedded
    const jsonPatterns = [
      // Next.js __NEXT_DATA__
      /<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/,
      // Window variable
      /window\.__AUCTION_DATA__\s*=\s*(\{[\s\S]+?\});/,
      // Generic auction JSON in script
      /"auction"\s*:\s*(\{[\s\S]+?\})\s*[,}]/,
      // Look for the specific structure we know exists
      /"id"\s*:\s*\d+\s*,\s*"title"\s*:\s*"[^"]+"\s*,\s*"slug"\s*:\s*"[^"]+"/,
    ];

    let jsonData: any = null;
    for (const pattern of jsonPatterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        try {
          const parsed = JSON.parse(match[1]);
          // Check if it's Next.js data with nested auction
          if (parsed.props?.pageProps?.auction) {
            jsonData = parsed.props.pageProps.auction;
            break;
          } else if (parsed.id && parsed.title && parsed.slug) {
            jsonData = parsed;
            break;
          }
        } catch { /* continue to next pattern */ }
      }
    }

    // If we found JSON data, use it (much more complete than regex)
    if (jsonData) {
      console.log('[pcarmarket] Found embedded JSON data');

      listing.title = jsonData.title || '';
      listing.auctionId = String(jsonData.id || '');
      listing.slug = jsonData.slug || listing.slug;
      listing.lotNumber = jsonData.lot_number;

      // Vehicle data
      if (jsonData.vehicle) {
        listing.year = jsonData.vehicle.year;
        listing.make = normalizeMake(jsonData.vehicle.make) ?? jsonData.vehicle.make;
        listing.model = jsonData.vehicle.model?.trim();
      }

      // VIN (accept 6-17 chars for classic cars, validate to avoid placeholders)
      if (jsonData.vin && jsonData.vin.length >= 6 && isValidVin(jsonData.vin)) {
        listing.vin = jsonData.vin.toUpperCase();
      }

      // Mileage
      listing.mileage = jsonData.mileage_body || jsonData.mileage_engine || null;

      // Pricing
      listing.salePrice = jsonData.high_bid || jsonData.auction_final_bid || null;
      listing.reserveStatus = jsonData.reserve_status;

      // Status
      if (jsonData.sold === true || jsonData.status === 'Sold') {
        listing.auctionOutcome = 'sold';
        if (jsonData.end_date) {
          listing.saleDate = jsonData.end_date;
        }
      } else if (jsonData.status === 'Unsold') {
        listing.auctionOutcome = 'reserve_not_met';
      }

      // Dates
      if (jsonData.end_date) {
        listing.auctionEndDate = jsonData.end_date;
      }

      // Engagement
      listing.bidCount = jsonData.bid_count || null;
      listing.viewCount = jsonData.view_count || null;
      listing.watchCount = jsonData.watch_count || null;

      // Location
      if (jsonData.location) {
        listing.location = jsonData.zip_code
          ? `${jsonData.location} ${jsonData.zip_code}`.trim()
          : jsonData.location;
      }

      // Seller
      listing.sellerUsername = jsonData.seller_username || null;
      listing.sellerId = jsonData.seller_user_id || null;

      // Description
      listing.description = jsonData.description || null;

      // Color, engine, transmission (may be in vehicle sub-object or top-level)
      listing.color = jsonData.vehicle?.exterior_color || jsonData.vehicle?.color ||
                      jsonData.exterior_color || jsonData.color || null;
      listing.interiorColor = jsonData.vehicle?.interior_color || jsonData.interior_color || null;
      listing.engine = jsonData.vehicle?.engine || jsonData.vehicle?.engine_description ||
                       jsonData.engine || jsonData.engine_description || null;
      listing.transmission = jsonData.vehicle?.transmission || jsonData.vehicle?.gearbox ||
                             jsonData.transmission || jsonData.gearbox || null;

      // Memorabilia detection
      listing.isMemorabillia = jsonData.vehicle === null ||
                               jsonData.lot_number?.startsWith('M-') ||
                               jsonData.categories?.some((c: any) => c.slug === 'memorabilia');

      // Images from gallery
      if (jsonData.gallery_images?.length) {
        listing.images = jsonData.gallery_images.map((img: any) =>
          img.original_url || img.full_url || img.hero_url || img.url
        ).filter(Boolean);
      }

      // Add featured image if not already included
      const featuredImg = jsonData.featured_image_large_url || jsonData.featured_image_url;
      if (featuredImg && !listing.images?.includes(featuredImg)) {
        listing.images = [featuredImg, ...(listing.images || [])];
      }

      // Extract buyer from comments if sold (look for winning bidder)
      if (jsonData.comments?.length && listing.auctionOutcome === 'sold') {
        const winningBid = jsonData.comments
          .filter((c: any) => c.is_bid)
          .sort((a: any, b: any) => (b.bid_amount || 0) - (a.bid_amount || 0))[0];
        if (winningBid) {
          listing.buyerUsername = winningBid.username;
          listing.buyer = winningBid.username;
        }
      }

      // URL fallback if jsonData.vehicle was null (memorabilia or unusual listings)
      if (!listing.year || !listing.make || !listing.model) {
        const urlIdentity = parsePCarMarketIdentityFromUrl(url);
        if (urlIdentity) {
          listing.year = listing.year || urlIdentity.year;
          listing.make = listing.make || urlIdentity.make;
          listing.model = listing.model || urlIdentity.model;
        }
      }

      return listing;
    }

    // FALLBACK: Use regex parsing if no JSON found
    console.log('[pcarmarket] Falling back to regex parsing');

    // Extract title
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) ||
                      html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      listing.title = titleMatch[1].trim();
    }

    // Extract from URL
    const urlIdentity = parsePCarMarketIdentityFromUrl(url);
    if (urlIdentity) {
      listing.year = urlIdentity.year;
      listing.make = urlIdentity.make;
      listing.model = urlIdentity.model;
    }

    // Extract images
    const imageMatches = html.matchAll(/src="(https:\/\/d2niwqq19lf86s\.cloudfront\.net[^"]+)"/g);
    for (const match of imageMatches) {
      listing.images?.push(match[1]);
    }

    // Extract VIN (6-17 character alphanumeric for classic + modern)
    // Look for VIN in context to avoid false positives
    const vinPatterns = [
      /(?:vin|chassis)[:\s#]*([A-HJ-NPR-Z0-9]{6,17})\b/i,
      /"vin"\s*:\s*"([A-HJ-NPR-Z0-9]{6,17})"/i,
    ];
    for (const pattern of vinPatterns) {
      const vinMatch = html.match(pattern);
      if (vinMatch && isValidVin(vinMatch[1])) {
        listing.vin = vinMatch[1];
        break;
      }
    }

    // Extract sale price (look for "Final bid: $X" or "High bid: $X")
    const finalBidMatch = html.match(/Final bid:\s*\$?([\d,]+)/i);
    const highBidMatch = html.match(/High bid:\s*\$?([\d,]+)/i);
    const currentBidMatch = html.match(/Current bid:\s*\$?([\d,]+)/i);
    if (finalBidMatch) {
      listing.salePrice = parseInt(finalBidMatch[1].replace(/,/g, ''), 10);
      listing.auctionOutcome = 'sold';
    } else if (highBidMatch) {
      listing.salePrice = parseInt(highBidMatch[1].replace(/,/g, ''), 10);
      listing.auctionOutcome = null;
    } else if (currentBidMatch) {
      listing.salePrice = parseInt(currentBidMatch[1].replace(/,/g, ''), 10);
      listing.auctionOutcome = null;
    }

    // Extract bid count
    const bidCountMatch = html.match(/([\d,]+)\s+bids?/i) ||
                          html.match(/bid(?:s)?[:\s]*([\d,]+)/i);
    if (bidCountMatch) {
      listing.bidCount = parseInt(bidCountMatch[1].replace(/,/g, ''), 10);
    }

    // Extract view count
    const viewCountMatch = html.match(/([\d,]+)\s+views?/i);
    if (viewCountMatch) {
      listing.viewCount = parseInt(viewCountMatch[1].replace(/,/g, ''), 10);
    }

    // Extract auction end date from JSON fields in HTML
    const endDateMatch = html.match(/"end_date"\s*:\s*"([^"]+)"/i);
    if (endDateMatch) {
      try {
        listing.auctionEndDate = new Date(endDateMatch[1]).toISOString();
      } catch { /* ignore */ }
    }

    // Extract seller username
    const sellerJsonMatch = html.match(/"seller_username"\s*:\s*"([^"]+)"/i);
    if (sellerJsonMatch) {
      listing.sellerUsername = sellerJsonMatch[1];
    } else {
      const sellerMatch = html.match(/member\/([a-zA-Z0-9_-]+)/i);
      if (sellerMatch) {
        listing.sellerUsername = sellerMatch[1];
      }
    }

    // Check if we have LLM extracted data (from Firecrawl) to fill in gaps
    // The html variable may be JSON-wrapped with { llmExtract, html } format
    try {
      if (html.startsWith('{"llmExtract"')) {
        const wrapped = JSON.parse(html);
        const llm = wrapped.llmExtract;
        if (llm) {
          console.log('[pcarmarket] Applying LLM extraction fallbacks');
          if (!listing.mileage && llm.mileage && typeof llm.mileage === 'number') {
            listing.mileage = llm.mileage;
            console.log(`[pcarmarket] LLM filled mileage: ${llm.mileage}`);
          }
          if (!listing.salePrice && llm.price && typeof llm.price === 'number') {
            listing.salePrice = llm.price;
            console.log(`[pcarmarket] LLM filled price: ${llm.price}`);
          }
          if (!listing.auctionOutcome && llm.sold === true) {
            listing.auctionOutcome = 'sold';
          }
          if (!listing.bidCount && llm.bid_count) {
            listing.bidCount = llm.bid_count;
          }
          if (!listing.sellerUsername && llm.seller) {
            listing.sellerUsername = llm.seller;
          }
          if (!listing.vin && llm.vin && llm.vin.length >= 6 && isValidVin(llm.vin)) {
            listing.vin = llm.vin.toUpperCase();
          }
          if (!listing.color && llm.exterior_color) {
            listing.color = llm.exterior_color;
          }
          if (!listing.interiorColor && llm.interior_color) {
            listing.interiorColor = llm.interior_color;
          }
          if (!listing.engine && llm.engine) {
            listing.engine = llm.engine;
          }
          if (!listing.transmission && llm.transmission) {
            listing.transmission = llm.transmission;
          }
        }
      }
    } catch (e) {
      // Not JSON-wrapped, ignore
    }

    return listing;
  } catch (error) {
    console.error('Error scraping PCarMarket listing:', error);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  // Writes are never anonymous: service key, signed-in user, or nothing (P0.2, 2026-09-27).
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    if (body.action === 'batch_from_targets' || body.action === 'discover_targets' || body.action === 'revise') {
      const sb = createClient(Deno.env.get('SUPABASE_URL')!, projectSecretKey()!, {
        global: { headers: { 'X-Nuke-Writer': 'import-pcarmarket-listing' } },
      });
      const out = body.action === 'discover_targets'
        ? await discoverTargets(sb)
        : body.action === 'revise'
          ? await revisePcm(sb, Deno.env.get('SUPABASE_URL')!, body)
          : await batchFromTargets(sb, Deno.env.get('SUPABASE_URL')!, body);
      return new Response(JSON.stringify(out), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const listing_url = body.listing_url || body.url;
    const providedHtml = body.html;

    if (!listing_url) {
      return new Response(
        JSON.stringify({ error: 'listing_url is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!listing_url.includes('pcarmarket.com')) {
      return new Response(
        JSON.stringify({ error: 'URL must be from pcarmarket.com' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = projectSecretKey()!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { 'X-Nuke-Writer': 'import-pcarmarket-listing' } },
    });

    // Source health row: scrape_sources is keyed by url (it has no domain/source_name/base_url columns).
    const { data: source } = await supabase
      .from('scrape_sources')
      .select('id')
      .ilike('url', '%pcarmarket.com%')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    const sourceId = source?.id;

    console.log(`Importing PCarMarket listing: ${listing_url}`);

    // Step 1: Scrape listing (or use provided HTML)
    const listing = providedHtml
      ? await scrapePCarMarketListing(listing_url, providedHtml)
      : await scrapePCarMarketListing(listing_url);
    if (!listing) {
      return new Response(
        JSON.stringify({ error: 'Failed to scrape listing' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!listing.year || !listing.make || !listing.model) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields (year, make, model)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 2: Use canonical organization ID for PCarMarket
    // This ID matches both organizations and businesses tables
    const orgId = "2a2494ae-cc22-4300-accb-24ed9a054663";

    // Step 3: Find existing vehicle
    let vehicleId: string | null = null;
    
    if (listing.vin) {
      const { data: existing } = await supabase
        .from('vehicles')
        .select('id')
        .eq('vin', listing.vin.toUpperCase())
        .maybeSingle();
      if (existing) vehicleId = existing.id;
    }

    if (!vehicleId) {
      const { data: existing, error: lookupErr } = await supabase
        .from('vehicles')
        .select('id')
        .eq('discovery_url', listing.url)
        .maybeSingle();
      if (lookupErr) console.warn(`[pcarmarket] discovery_url lookup error: ${lookupErr.message}`);
      if (existing) vehicleId = existing.id;
    }

    // Fallback: slug-based ILIKE lookup to handle URL normalization mismatches
    if (!vehicleId && listing.slug) {
      const { data: existing, error: slugErr } = await supabase
        .from('vehicles')
        .select('id')
        .ilike('discovery_url', `%pcarmarket.com/auction/${listing.slug}%`)
        .limit(1)
        .maybeSingle();
      if (slugErr) console.warn(`[pcarmarket] slug lookup error: ${slugErr.message}`);
      if (existing) vehicleId = existing.id;
    }

    // Step 4: Create or update vehicle
    const norm = normalizeVehicleFields({
      make: listing.make!,
      model: listing.model!,
      year: listing.year,
      trim: listing.trim || null,
      vin: listing.vin ? listing.vin.toUpperCase() : null,
      color: listing.color || null,
      interior_color: listing.interiorColor || null,
      transmission: listing.transmission || null,
    });
    const vehicleData = {
      year: norm.year ?? listing.year,
      make: norm.make ?? listing.make!,
      model: norm.model ?? listing.model!,
      trim: norm.trim ?? null,
      vin: norm.vin ?? null,
      mileage: listing.mileage || null,
      // Sale rule (lock 1, 2026-09-27): a bid is never a sale. listing.salePrice is PCarMarket's
      // high bid (high_bid / auction_final_bid); it is the sale price only when the outcome is sold,
      // and the status travels with it. Otherwise it is the high bid.
      sale_price: listing.auctionOutcome === 'sold' ? listing.salePrice || null : null,
      high_bid: listing.salePrice || null,
      ...(listing.auctionOutcome === 'sold' ? { sale_status: 'sold' } : {}),
      ...(listing.auctionOutcome === 'reserve_not_met' ? { sale_status: 'not_sold' } : {}),
      bid_count: listing.bidCount || null,
      ...(listing.location ? (() => { const loc = parseLocation(listing.location); return { listing_location: loc.clean, listing_location_raw: loc.raw, listing_location_source: 'pcarmarket', listing_location_confidence: loc.confidence, listing_location_observed_at: new Date().toISOString() }; })() : {}),
      sale_date: listing.saleDate || null,
      auction_end_date: listing.auctionEndDate || null,
      auction_outcome: listing.auctionOutcome || null,
      description: listing.description || listing.title || null,
      color: norm.color ?? null,
      interior_color: norm.interior_color ?? null,
      engine_type: listing.engine || null,
      transmission: norm.transmission ?? null,
      profile_origin: 'PCARMARKET_IMPORT',
      discovery_source: 'PCARMARKET',
      discovery_url: listing.url,
      listing_url: listing.url,
      listing_source: 'import-pcarmarket-listing', // Extraction receipt
        origin_metadata: {
          source: 'PCARMARKET_IMPORT',
          pcarmarket_url: listing.url,
          pcarmarket_listing_title: listing.title,
          pcarmarket_seller_username: listing.sellerUsername || null,
          pcarmarket_seller_id: listing.sellerId || null,
          pcarmarket_buyer_username: listing.buyerUsername || null,
          pcarmarket_auction_id: listing.auctionId || null,
          pcarmarket_auction_slug: listing.slug || null,
          pcarmarket_lot_number: listing.lotNumber || null,
          bid_count: listing.bidCount || null,
          view_count: listing.viewCount || null,
          watch_count: listing.watchCount || null,
          reserve_status: listing.reserveStatus || null,
          sold_status: listing.auctionOutcome === 'sold' ? 'sold' : 'unsold',
          is_memorabilia: listing.isMemorabillia || false,
          imported_at: new Date().toISOString()
      },
      is_public: true,
      status: 'active'
    };

    // Identity guard: a VIN/URL/slug match is not proof it is the same car. A different car is refused and raised as a
    // revision item (identity_match / different_car / relink); for the same car, year/make/model/vin are fill-only.
    let existingIdentity: { year: number | null; make: string | null; model: string | null; vin: string | null } | null = null;
    if (vehicleId) {
      const { data: idRow } = await supabase.from('vehicles').select('year,make,model,vin').eq('id', vehicleId).maybeSingle();
      existingIdentity = (idRow as typeof existingIdentity) ?? null;
      const conflict = existingIdentity ? identityConflict(existingIdentity, { year: vehicleData.year, make: vehicleData.make, model: vehicleData.model, vin: vehicleData.vin }) : null;
      if (conflict) {
        await supabase.rpc('record_revision_item', {
          p_url: listing.url, p_missing: [REVISION_DIFFERENT_CAR.missing], p_reason: REVISION_DIFFERENT_CAR.reason,
          p_next_action: REVISION_DIFFERENT_CAR.next_action, p_raised_by: 'import-pcarmarket-listing', p_snapshot_id: null,
          p_detail: { vehicle_id: vehicleId, detail: conflict }, p_vehicle_id: vehicleId,
        });
        return new Response(JSON.stringify({ success: false, refused: 'different_car', vehicle_id: vehicleId, detail: conflict }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    if (vehicleId) {
      await supabase
        .from('vehicles')
        .update(existingIdentity ? fillOnlyIdentity(vehicleData, existingIdentity) : vehicleData)
        .eq('id', vehicleId);
      console.log(`Updated existing vehicle: ${vehicleId}`);
    } else {
      const { data: newVehicle, error: vehicleError } = await supabase
        .from('vehicles')
        .insert(vehicleData)
        .select('id')
        .maybeSingle();

      if (vehicleError) {
        // Handle unique constraint violation by finding and updating the existing record
        if (vehicleError.code === '23505' && vehicleError.message?.includes('discovery_url')) {
          console.warn(`[pcarmarket] Duplicate discovery_url, looking up existing: ${listing.url}`);
          // Use exact match first (fast, uses unique index), then fall back to ILIKE
          const { data: dup } = await supabase
            .from('vehicles')
            .select('id')
            .eq('discovery_url', listing.url)
            .maybeSingle();
          const dupId = dup?.id || (listing.slug ? (await supabase
            .from('vehicles')
            .select('id')
            .ilike('discovery_url', `%pcarmarket.com/auction/${listing.slug}%`)
            .limit(1)
            .maybeSingle()).data?.id : null);
          if (dupId) {
            vehicleId = dupId;
            await supabase.from('vehicles').update(fillOnlyIdentity(vehicleData, (await supabase.from('vehicles').select('year,make,model,vin').eq('id', vehicleId).maybeSingle()).data ?? {})).eq('id', vehicleId);
            console.log(`[pcarmarket] Updated existing vehicle after dedup: ${vehicleId}`);
          } else {
            throw vehicleError;
          }
        } else {
          throw vehicleError;
        }
      } else {
        vehicleId = newVehicle.id;
        console.log(`Created new vehicle: ${vehicleId}`);
      }
    }

    // Fire-and-forget observation write
    if (vehicleId) {
      const obsFields: Record<string, any> = {};
      for (const [k, v] of Object.entries(vehicleData)) {
        if (v != null && k !== 'origin_metadata' && k !== 'profile_origin' && k !== 'discovery_source'
            && k !== 'discovery_url' && k !== 'listing_url' && k !== 'listing_source'
            && k !== 'is_public' && k !== 'status') {
          obsFields[k] = v;
        }
      }
      writeObservation(supabase, {
        vehicleId,
        source: { platform: "pcarmarket", url: listing.url, trustScore: 0.8 },
        fields: obsFields,
        observationKind: "listing",
        extractionMethod: "dom_parse",
      }).catch((e: any) => console.warn(`[pcarmarket] observationWriter error for ${vehicleId}: ${e?.message}`));
    }

    // Step 5: Link to organization (FIXED - removed listing_url, listing_status columns)
    if (orgId && vehicleId) {
      const relationshipType = listing.auctionOutcome === 'sold' ? 'sold_by' : 'consigner';
      await supabase
        .from('organization_vehicles')
        .upsert({
          organization_id: orgId,
          vehicle_id: vehicleId,
          relationship_type: relationshipType,
          status: 'active',
          auto_tagged: true,
          notes: `Imported from PCarMarket: ${listing.url}`
        }, {
          onConflict: 'organization_id,vehicle_id,relationship_type'
        });
    }

    // Step 5b: Create/update vehicle_events record for countdown timer support
    if (vehicleId) {
      const endedAlready = !!listing.auctionEndDate && new Date(listing.auctionEndDate).getTime() < Date.now();
      const eventStatus = listing.auctionOutcome === 'sold' ? 'sold'
        : endedAlready ? (listing.auctionOutcome === 'reserve_not_met' ? 'reserve_not_met' : 'ended') : 'active';
      const vehicleEventData: Record<string, any> = {
        vehicle_id: vehicleId,
        source_platform: 'pcarmarket',
        event_type: 'auction',
        source_url: listing.url,
        source_listing_id: listing.auctionId || listing.slug || null,
        event_status: eventStatus,
        extraction_method: 'ssr_parse',
        extractor_version: 'import-pcarmarket-listing:2',
        current_price: listing.salePrice || null,
        bid_count: listing.bidCount || null,
        view_count: listing.viewCount || null,
        buyer_identifier: listing.auctionOutcome === 'sold' ? listing.buyerUsername ?? null : null,
        metadata: {
          reserve_status: listing.reserveMet === true ? 'reserve_met' : listing.auctionOutcome === 'reserve_not_met' ? 'reserve_not_met' : (listing.reserveStatus || 'unknown'),
          auction_type: listing.reserveStatus ?? null,
          location: listing.location ?? null,
          bids_on_page: listing.bids?.length ?? 0,
          bids_claimed: listing.bidCount ?? null,
          photos_on_page: listing.images?.length ?? 0,
          photos_claimed: listing.photosClaimed ?? null,
          seller: 'not_exposed_on_page',
        },
        updated_at: new Date().toISOString(),
      };
      // Only set ended_at if we extracted it (don't clear existing)
      if (listing.auctionEndDate) {
        vehicleEventData.ended_at = listing.auctionEndDate;
      }
      if (listing.auctionOutcome === 'sold') {
        vehicleEventData.final_price = listing.salePrice;
        // Real auction end date (parsed from page), never the scrape time.
        // Fall back to saleDate; only if neither is present do we omit sold_at.
        const soldAt = listing.auctionEndDate || listing.saleDate || null;
        if (soldAt) vehicleEventData.sold_at = soldAt;
      }

      // Check if vehicle_event already exists
      const { data: existingListing } = await supabase
        .from('vehicle_events')
        .select('id')
        .eq('vehicle_id', vehicleId)
        .eq('source_platform', 'pcarmarket')
        .maybeSingle();

      if (existingListing) {
        await supabase
          .from('vehicle_events')
          .update(vehicleEventData)
          .eq('id', existingListing.id);
        console.log(`Updated vehicle_event: ${existingListing.id}`);
      } else {
        vehicleEventData.created_at = new Date().toISOString();
        const { data: newListing, error: listingError } = await supabase
          .from('vehicle_events')
          .insert(vehicleEventData)
          .select('id')
          .maybeSingle();

        if (!listingError && newListing) {
          console.log(`Created vehicle_event: ${newListing.id}`);
        }
      }
    }

    // Step 6: Import ALL images from gallery
    if (listing.images && listing.images.length > 0 && vehicleId) {
      // Get user_id for images (required field)
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('user_id, uploaded_by')
        .eq('id', vehicleId)
        .maybeSingle();
      
      const userId = vehicle?.user_id || vehicle?.uploaded_by || null;
      const nowIso = new Date().toISOString();
      // Rows already held (any earlier run) stay; only gallery photos not yet held are added. A vehicle with no owner
      // user is attributed the way the other auction importers do it: source external_import, no user_id.
      const { data: held } = await supabase.from('vehicle_images').select('image_url').eq('vehicle_id', vehicleId)
        .or('is_superseded.is.null,is_superseded.eq.false').limit(1000);
      const have = new Set((held ?? []).map((r: { image_url: string }) => r.image_url.split('?')[0]));
      const fresh = listing.images.filter((u) => !have.has(u.split('?')[0]));
      const imageInserts = fresh.slice(0, 300).map((imageUrl, index) => ({
        vehicle_id: vehicleId,
        image_url: imageUrl,
        ...(userId ? { user_id: userId, source: 'pcarmarket_listing', category: 'general', image_category: 'exterior' } : {
          source: 'external_import', source_url: imageUrl, is_external: true, approval_status: 'auto_approved', is_approved: true,
          redaction_level: 'none', exif_data: { source_url: listing.url, imported_from: 'pcarmarket', photos_claimed: listing.photosClaimed ?? null },
        }),
        is_primary: have.size === 0 && index === 0,
        position: have.size + index,
        display_order: have.size + index,
        filename: `pcarmarket_${have.size + index}.jpg`,
      }));
      for (let i = 0; i < imageInserts.length; i += 50) {
        const { error: imgErr } = await supabase.from('vehicle_images').insert(imageInserts.slice(i, i + 50));
        if (imgErr) { console.error('[pcarmarket] image insert failed:', imgErr.message); break; }
      }
      console.log(`Imported ${imageInserts.length} of ${listing.images.length} images`);
    }

    // Step 7: Create external_identities for seller and buyer (claimable profiles)
    const identitiesSaved: string[] = [];
    if (listing.sellerUsername || listing.buyerUsername) {
      const nowIso = new Date().toISOString();
      const identitiesToUpsert = [];

      // Seller identity
      if (listing.sellerUsername) {
        identitiesToUpsert.push({
          platform: 'pcarmarket',
          handle: listing.sellerUsername,
          display_name: listing.seller || listing.sellerUsername,
          profile_url: `https://www.pcarmarket.com/member/${listing.sellerUsername}/`,
          metadata: {
            source: 'pcarmarket_import',
            first_seen_listing: listing.url,
            first_seen_at: nowIso,
          },
          first_seen_at: nowIso,
          last_seen_at: nowIso,
          updated_at: nowIso,
        });
      }

      // Buyer identity (if sold)
      if (listing.buyerUsername && listing.auctionOutcome === 'sold') {
        identitiesToUpsert.push({
          platform: 'pcarmarket',
          handle: listing.buyerUsername,
          display_name: listing.buyer || listing.buyerUsername,
          profile_url: `https://www.pcarmarket.com/member/${listing.buyerUsername}/`,
          metadata: {
            source: 'pcarmarket_import',
            first_seen_as_buyer: true,
            first_seen_listing: listing.url,
            first_seen_at: nowIso,
          },
          first_seen_at: nowIso,
          last_seen_at: nowIso,
          updated_at: nowIso,
        });
      }

      if (identitiesToUpsert.length > 0) {
        const { data: upsertedIdentities, error: identityError } = await supabase
          .from('external_identities')
          .upsert(identitiesToUpsert, { onConflict: 'platform,handle' })
          .select('id, handle');

        if (identityError) {
          console.error('[pcarmarket] External identity save error:', JSON.stringify(identityError));
        } else {
          for (const id of upsertedIdentities || []) {
            identitiesSaved.push(id.handle);
          }
          console.log(`[pcarmarket] Saved ${identitiesSaved.length} external identities: ${identitiesSaved.join(', ')}`);
        }
      }
    }

    // Step 8: auction_events row, and the visible bid history as bid rows in auction_comments under bidder identities.
    // PCarMarket renders the last few bids on the page (the rest, and the comment thread, load on demand); the claimed
    // counts go in raw_data so the gap is recorded, not hidden.
    if (vehicleId) {
      const bids = listing.bids ?? [];
      const ids = new Map<string, string>();
      const handles = [...new Set([...bids.map((b) => b.user), ...(listing.buyerUsername ? [listing.buyerUsername] : [])])];
      if (handles.length) {
        const nowIso = new Date().toISOString();
        const { data: idRows, error: idErr } = await supabase.from('external_identities').upsert(
          handles.map((h) => ({ platform: 'pcarmarket', handle: h, profile_url: `https://www.pcarmarket.com/member/${h}/`, last_seen_at: nowIso, updated_at: nowIso })),
          { onConflict: 'platform,handle' },
        ).select('id, handle');
        if (idErr) console.warn(`[pcarmarket] bidder identities failed: ${idErr.message}`);
        for (const r of idRows ?? []) ids.set(r.handle, r.id);
      }
      const auctionEvent: Record<string, any> = {
        vehicle_id: vehicleId, source: 'pcarmarket', source_url: listing.url, source_listing_id: listing.auctionId || listing.slug || null,
        auction_end_date: listing.auctionEndDate ?? null,
        outcome: listing.auctionOutcome === 'sold' ? 'sold' : listing.auctionOutcome === 'reserve_not_met' ? 'reserve_not_met' : (listing.auctionEndDate && new Date(listing.auctionEndDate).getTime() < Date.now() ? 'pending' : 'live'),
        high_bid: listing.salePrice ?? null, winning_bid: listing.auctionOutcome === 'sold' ? listing.salePrice ?? null : null,
        total_bids: listing.bidCount ?? null, winning_bidder: listing.auctionOutcome === 'sold' ? listing.buyerUsername ?? null : null,
        high_bidder: bids.find((b) => b.kind === 'bid')?.user ?? null,
        seller_location: listing.location ?? null, page_views: listing.viewCount ?? null, scraped_at: new Date().toISOString(),
        bid_history: bids.length ? bids : null,
        raw_data: { bids_on_page: bids.length, bids_claimed: listing.bidCount ?? null, photos_on_page: listing.images?.length ?? 0, photos_claimed: listing.photosClaimed ?? null, reserve_met: listing.reserveMet ?? null, auction_type: listing.reserveStatus ?? null, comments: 'not_on_page' },
      };
      Object.keys(auctionEvent).forEach((k) => { if (auctionEvent[k] === null || auctionEvent[k] === undefined) delete auctionEvent[k]; });
      const { data: ae, error: aeErr } = await supabase.from('auction_events').upsert(auctionEvent, { onConflict: 'vehicle_id,source_url' }).select('id').maybeSingle();
      if (aeErr) console.warn(`[pcarmarket] auction_events failed: ${aeErr.message}`);
      if (ae?.id && bids.length) {
        const endMs = listing.auctionEndDate ? new Date(listing.auctionEndDate).getTime() : null;
        const rows = bids.filter((b) => b.at).map((b, i) => ({
          auction_event_id: ae.id, vehicle_id: vehicleId, platform: 'pcarmarket', source_url: listing.url,
          content_hash: `pcm_${vehicleId}_${b.at}_${b.user}_${b.amount}_${b.kind}`, sequence_number: i + 1, posted_at: b.at,
          hours_until_close: endMs ? Math.max(0, (endMs - new Date(b.at!).getTime()) / 3_600_000) : null,
          author_username: b.user, author_external_identity_id: ids.get(b.user) ?? null, external_identity_id: ids.get(b.user) ?? null,
          is_seller: false, comment_type: 'bid', comment_text: `${b.kind === 'sold' ? 'Sold' : b.kind === 'offer' ? 'Offer' : 'Bid'} $${b.amount.toLocaleString('en-US')}`,
          word_count: 2, has_question: false, bid_amount: b.amount,
        }));
        const { error: cErr } = await supabase.from('auction_comments').upsert(rows, { onConflict: 'vehicle_id,content_hash' });
        if (cErr) console.warn(`[pcarmarket] bid rows failed: ${cErr.message}`);
      }
    }

    // Update source health tracking
    if (sourceId) {
      await supabase
        .from('scrape_sources')
        .update({
          last_scraped_at: new Date().toISOString(),
          last_successful_scrape: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', sourceId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        vehicle_id: vehicleId,
        organization_id: orgId,
        source_id: sourceId,
        identities_saved: identitiesSaved,
        listing: {
          title: listing.title,
          url: listing.url,
          year: listing.year,
          make: listing.make,
          model: listing.model,
          vin: listing.vin,
          sale_price: listing.salePrice,
          status: listing.auctionOutcome,
          seller_username: listing.sellerUsername,
          buyer_username: listing.buyerUsername,
          is_memorabilia: listing.isMemorabillia,
          image_count: listing.images?.length || 0,
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error importing PCarMarket listing:', error);
    return new Response(
      JSON.stringify({ error: error?.message || (typeof error === 'object' ? JSON.stringify(error) : String(error || 'Internal server error')) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

