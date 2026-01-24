import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

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
    return u.toString();
  } catch {
    return String(raw).split('#')[0].split('?')[0];
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
    const year = parseInt(yearMatch[1]);
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
    result.price = parseInt(priceMatch[1].replace(/,/g, ''));
  }

  // Extract bid count
  const bidMatch = bidText.match(/([\d,]+)\s*Bids?/i);
  if (bidMatch) {
    result.bidCount = parseInt(bidMatch[1].replace(/,/g, ''));
  }

  // Extract views
  const viewMatch = bidText.match(/([\d,]+)\s*Views?/i);
  if (viewMatch) {
    result.viewCount = parseInt(viewMatch[1].replace(/,/g, ''));
  }

  // Extract saves/watches
  const saveMatch = bidText.match(/([\d,]+)\s*Saves?/i);
  if (saveMatch) {
    result.watchCount = parseInt(saveMatch[1].replace(/,/g, ''));
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
    // Pattern: /auction/2002-aston-martin-db7-v12-vantage-2
    const m = u.pathname.match(/\/auction\/(\d{4})-([a-z0-9-]+)-(\d+)\/?$/i);
    if (!m?.[1] || !m?.[2]) return null;

    const year = Number(m[1]);
    if (!Number.isFinite(year) || year < 1885 || year > new Date().getFullYear() + 1) return null;

    const parts = String(m[2]).split('-').filter(Boolean);
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
      // Use Firecrawl if available, otherwise direct fetch
      const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');

      if (FIRECRAWL_API_KEY) {
        console.log('[pcarmarket] Fetching via Firecrawl...');
        const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: url,
            formats: ['rawHtml'],  // rawHtml captures full rendered page with XHR data
            waitFor: 20000,        // Wait 20s for dynamic content to load
            timeout: 60000,
            mobile: false,
          }),
        });

        if (firecrawlResponse.ok) {
          const firecrawlData = await firecrawlResponse.json();
          if (firecrawlData.success === false) {
            console.error('[pcarmarket] Firecrawl error:', firecrawlData.error);
            throw new Error(`Firecrawl error: ${firecrawlData.error || 'Unknown error'}`);
          }
          html = firecrawlData.data?.rawHtml || firecrawlData.data?.html || '';
          console.log(`[pcarmarket] Firecrawl returned ${html.length} chars`);
        } else {
          throw new Error(`Firecrawl HTTP error: ${firecrawlResponse.status}`);
        }
      } else {
        console.log('[pcarmarket] No Firecrawl key, trying direct fetch...');
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
          }
        });
        html = await response.text();
        console.log(`[pcarmarket] Direct fetch returned ${html.length} chars`);

        // Check if we got a JS-required page
        if (html.includes('You need to enable JavaScript')) {
          console.error('[pcarmarket] Page requires JavaScript rendering');
          throw new Error('Page requires JavaScript rendering. Set FIRECRAWL_API_KEY or provide pre-rendered HTML.');
        }
      }
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
        listing.make = jsonData.vehicle.make?.toLowerCase();
        listing.model = jsonData.vehicle.model?.toLowerCase();
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
      listing.salePrice = parseInt(finalBidMatch[1].replace(/,/g, ''));
      listing.auctionOutcome = 'sold';
    } else if (highBidMatch) {
      listing.salePrice = parseInt(highBidMatch[1].replace(/,/g, ''));
      listing.auctionOutcome = null;
    } else if (currentBidMatch) {
      listing.salePrice = parseInt(currentBidMatch[1].replace(/,/g, ''));
      listing.auctionOutcome = null;
    }

    // Extract bid count
    const bidCountMatch = html.match(/([\d,]+)\s+bids?/i) ||
                          html.match(/bid(?:s)?[:\s]*([\d,]+)/i);
    if (bidCountMatch) {
      listing.bidCount = parseInt(bidCountMatch[1].replace(/,/g, ''));
    }

    // Extract view count
    const viewCountMatch = html.match(/([\d,]+)\s+views?/i);
    if (viewCountMatch) {
      listing.viewCount = parseInt(viewCountMatch[1].replace(/,/g, ''));
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

    return listing;
  } catch (error) {
    console.error('Error scraping PCarMarket listing:', error);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { listing_url, html: providedHtml } = body;

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
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get or create scrape source
    const { data: source } = await supabase
      .from('scrape_sources')
      .select('id')
      .eq('domain', 'pcarmarket.com')
      .maybeSingle();

    let sourceId = source?.id;

    if (!sourceId) {
      const { data: newSource } = await supabase
        .from('scrape_sources')
        .insert({
          domain: 'pcarmarket.com',
          source_name: 'PCarMarket',
          source_type: 'auction_house',
          base_url: 'https://www.pcarmarket.com',
          is_active: true,
        })
        .select('id')
        .single();

      if (newSource) {
        sourceId = newSource.id;
      }
    }

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

    // Step 2: Find or create organization
    let orgId: string | null = null;
    const { data: existingOrg } = await supabase
      .from('businesses')
      .select('id')
      .eq('website', 'https://www.pcarmarket.com')
      .maybeSingle();

    if (existingOrg) {
      orgId = existingOrg.id;
    } else {
      const { data: newOrg, error: orgError } = await supabase
        .from('businesses')
        .insert({
          business_name: 'PCarMarket',
          business_type: 'auction_house',
          website: 'https://www.pcarmarket.com',
          description: 'Premium car auction marketplace',
          is_verified: false,
          is_public: true
        })
        .select('id')
        .single();

      if (!orgError && newOrg) {
        orgId = newOrg.id;
      }
    }

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
      const { data: existing } = await supabase
        .from('vehicles')
        .select('id')
        .eq('discovery_url', listing.url)
        .maybeSingle();
      if (existing) vehicleId = existing.id;
    }

    // Step 4: Create or update vehicle
    const vehicleData = {
      year: listing.year,
      make: listing.make!.toLowerCase(),
      model: listing.model!.toLowerCase(),
      trim: listing.trim?.toLowerCase() || null,
      vin: listing.vin ? listing.vin.toUpperCase() : null,
      mileage: listing.mileage || null,
      sale_price: listing.salePrice || null,
      sale_date: listing.saleDate || null,
      auction_end_date: listing.auctionEndDate || null,
      auction_outcome: listing.auctionOutcome || null,
      description: listing.description || listing.title || null,
      profile_origin: 'PCARMARKET_IMPORT',
      discovery_source: 'PCARMARKET',
      discovery_url: listing.url,
      listing_url: listing.url,
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

    if (vehicleId) {
      await supabase
        .from('vehicles')
        .update(vehicleData)
        .eq('id', vehicleId);
      console.log(`Updated existing vehicle: ${vehicleId}`);
    } else {
      const { data: newVehicle, error: vehicleError } = await supabase
        .from('vehicles')
        .insert(vehicleData)
        .select('id')
        .single();

      if (vehicleError) {
        throw vehicleError;
      }

      vehicleId = newVehicle.id;
      console.log(`Created new vehicle: ${vehicleId}`);
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

    // Step 5b: Create/update external_listings record for countdown timer support
    if (vehicleId) {
      const listingStatus = listing.auctionOutcome === 'sold' ? 'sold' : 'active';
      const externalListingData: Record<string, any> = {
        vehicle_id: vehicleId,
        platform: 'pcarmarket',
        listing_url: listing.url,
        listing_id: listing.auctionId || listing.slug || null,
        listing_status: listingStatus,
        current_bid: listing.salePrice || null,
        bid_count: listing.bidCount || null,
        view_count: listing.viewCount || null,
        updated_at: new Date().toISOString(),
      };
      // Only set end_date if we extracted it (don't clear existing)
      if (listing.auctionEndDate) {
        externalListingData.end_date = listing.auctionEndDate;
      }
      if (listing.auctionOutcome === 'sold') {
        externalListingData.final_price = listing.salePrice;
        externalListingData.sold_at = new Date().toISOString();
      }

      // Check if external_listing already exists
      const { data: existingListing } = await supabase
        .from('external_listings')
        .select('id')
        .eq('vehicle_id', vehicleId)
        .eq('platform', 'pcarmarket')
        .maybeSingle();

      if (existingListing) {
        await supabase
          .from('external_listings')
          .update(externalListingData)
          .eq('id', existingListing.id);
        console.log(`Updated external_listing: ${existingListing.id}`);
      } else {
        externalListingData.created_at = new Date().toISOString();
        const { data: newListing, error: listingError } = await supabase
          .from('external_listings')
          .insert(externalListingData)
          .select('id')
          .single();

        if (!listingError && newListing) {
          console.log(`Created external_listing: ${newListing.id}`);
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
        .single();
      
      const userId = vehicle?.user_id || vehicle?.uploaded_by || null;
      
      if (!userId) {
        console.error('Missing user_id for image import');
      } else {
        // Delete existing PCarMarket images first
        await supabase
          .from('vehicle_images')
          .delete()
          .eq('vehicle_id', vehicleId)
          .eq('source', 'pcarmarket_listing');
        
        // Import ALL images (not just 10)
        const imageInserts = listing.images.map((imageUrl, index) => ({
          vehicle_id: vehicleId,
          image_url: imageUrl,
          user_id: userId, // Required field
          category: 'general',
          image_category: 'exterior',
          source: 'pcarmarket_listing',
          is_primary: index === 0,
          filename: `pcarmarket_${index}.jpg`
        }));

        // Insert in batches to avoid timeouts
        const batchSize = 50;
        for (let i = 0; i < imageInserts.length; i += batchSize) {
          const batch = imageInserts.slice(i, i + batchSize);
          await supabase
            .from('vehicle_images')
            .insert(batch);
        }
        
        console.log(`Imported ${listing.images.length} images`);
      }
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
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

