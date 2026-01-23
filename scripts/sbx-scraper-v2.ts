/**
 * SBX CARS SCRAPER V2 - PERFECTED
 * ================================
 * Comprehensive extraction of all SBX listing data including:
 * - VIN, price, currency from structured API data
 * - Auction status, reserve status, sale outcome
 * - Comments with bid mentions mined for price data
 * - Proper date parsing (not confused with prices)
 * - Multi-currency support (USD, AED, EUR, etc.)
 */

import { chromium, type Page, type Response } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const CONFIG = {
  BATCH_SIZE: 10,
  DELAY_BETWEEN: 3000,
  DELAY_BETWEEN_BATCHES: 8000,
  MAX_LISTINGS: 0, // 0 = no limit (full scrape)
  HEADLESS: true,
  DRY_RUN: false, // Set true to test without saving
};

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type AuctionOutcome =
  | 'sold_at_auction'      // Reserve met, sold during live auction
  | 'sold_post_auction'    // Sold privately after auction ended
  | 'bid_not_met'          // Ended, highest bid below reserve, no sale
  | 'withdrawn'            // Seller withdrew
  | 'active'               // Currently running
  | 'preview'              // Not started yet
  | 'ended_unknown';       // Ended but outcome unclear

type ReserveStatus =
  | 'no_reserve'
  | 'reserve_met'
  | 'reserve_almost_met'
  | 'reserve_lowered'
  | 'reserve_not_met'
  | 'unknown';

interface SBXListingData {
  // Identifiers
  listingId: number;
  lotNumber: number;
  auctionKey: string;
  slug: string;
  url: string;

  // Vehicle info
  title: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  mileage: number | null;
  mileageUnit: 'miles' | 'kilometers';
  exterior: string | null;
  interior: string | null;
  location: string | null;
  countryCode: string | null;

  // Auction data
  auctionStatus: string; // Raw status from API
  auctionOutcome: AuctionOutcome;
  reserveStatus: ReserveStatus;
  hasReserve: boolean;
  currencyCode: string;

  // Prices
  highestBid: number | null;
  highestBidUSD: number | null; // Converted to USD
  salePrice: number | null;
  salePriceUSD: number | null;
  askingPrice: number | null; // From schema.org
  bidCount: number;

  // Bid data mined from comments
  minedHighBid: number | null;
  minedBidSource: string | null;

  // Dates
  previewTime: string | null;
  startTime: string | null;
  endTime: string | null;
  actualEndTime: string | null;

  // Seller info
  ownerUsername: string | null;
  highestBidderUsername: string | null;

  // Content
  description: string | null;
  highlights: string[];
  carfaxUrl: string | null;
  images: string[];

  // Comments
  comments: SBXComment[];

  // Metadata
  viewCount: number;
  commentCount: number;
  favoriteCount: number;
}

interface SBXComment {
  commentId: number;
  authorUsername: string;
  authorUserId: number;
  isOwner: boolean;
  text: string;
  postedAt: string;
  likes: number;
  replyCount: number;
  mentionedPrice: number | null; // Mined from comment text
}

// Currency conversion rates (approximate, for normalization)
const CURRENCY_TO_USD: Record<string, number> = {
  'USD': 1,
  'AED': 0.27,
  'EUR': 1.08,
  'GBP': 1.26,
  'CAD': 0.74,
  'AUD': 0.65,
  'CHF': 1.12,
  'JPY': 0.0067,
};

// ============================================================================
// LISTING DATA EXTRACTION
// ============================================================================

async function scrapeListing(page: Page, url: string): Promise<SBXListingData | null> {
  try {
    // Data containers
    let commentsData: any[] = [];
    let schemaOrgData: any = null;

    // Set up API interception for comments only
    const responseHandler = async (response: Response) => {
      const responseUrl = response.url();

      // Capture comments
      if (responseUrl.includes('/api/v1/Comments/GetAllListingComments')) {
        try {
          const json = await response.json();
          if (json.Value && Array.isArray(json.Value)) {
            commentsData = json.Value;
            console.log(`   [API] Captured ${commentsData.length} comments`);
          }
        } catch {}
      }
    };

    page.on('response', responseHandler);

    // Navigate to the listing
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Scroll to trigger lazy loading and comments
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
    });
    await page.waitForTimeout(2000);

    // Extract schema.org JSON-LD for VIN
    schemaOrgData = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        try {
          const json = JSON.parse(script.textContent || '');
          if (json['@type'] === 'Car' || json.vehicleIdentificationNumber) {
            return json;
          }
        } catch {}
      }
      return null;
    });

    // Clean up listener
    page.removeListener('response', responseHandler);

    // Extract all data from DOM
    return await extractFromDOM(page, url, schemaOrgData, commentsData);

  } catch (error: any) {
    console.error(`   [ERROR] ${error.message}`);
    return null;
  }
}

async function extractFromDOM(
  page: Page,
  url: string,
  schema: any,
  comments: any[]
): Promise<SBXListingData> {
  // Extract all data from DOM elements using plain JS to avoid transpilation issues
  const domData = await page.evaluate(function() {
    var h1El = document.querySelector('h1');
    var title = (h1El && h1El.textContent) ? h1El.textContent.trim() : document.title.split('|')[0].trim();

    var pageText = document.body.innerText;
    var lowerText = pageText.toLowerCase();

    // Find auction stats
    var viewsMatch = pageText.match(/Auction views[:\s]*([0-9,]+)/i);
    var bidsMatch = pageText.match(/Bids[:\s]*([0-9,]+)/i);
    var watchingMatch = pageText.match(/Watching[:\s]*([0-9,]+)/i);

    // Find current bid - check for main listing bid pattern first (appears at top of page)
    // The main listing shows format like "US$75,000\nCurrent bid by:" or "190,000 AED\nCurrent bid by:"
    var mainBidMatch = pageText.match(/(?:US)?\$?\s*([0-9,]+)\s*(?:AED|USD|EUR|GBP)?\s*\n?\s*Current bid by/i);
    var latestBidMatch = mainBidMatch ||
                         pageText.match(/Current bid[:\s]*(?:US)?\$?\s*([0-9,]+)/i) ||
                         pageText.match(/High bid[:\s]*(?:US)?\$?\s*([0-9,]+)/i) ||
                         pageText.match(/Latest bid[:\s]*(?:US)?\$?\s*([0-9,]+)/i);

    // Find sold price
    var soldMatch = pageText.match(/Sold(?:\s+for)?[:\s]*(?:US)?\$?\s*([0-9,]+)/i);

    // Find reserve status
    var reserveStatus = 'unknown';
    if (lowerText.indexOf('no reserve') !== -1) reserveStatus = 'no_reserve';
    else if (lowerText.indexOf('reserve almost met') !== -1) reserveStatus = 'reserve_almost_met';
    else if (lowerText.indexOf('reserve lowered') !== -1) reserveStatus = 'reserve_lowered';
    else if (lowerText.indexOf('reserve not met') !== -1) reserveStatus = 'reserve_not_met';
    else if (lowerText.indexOf('reserve met') !== -1) reserveStatus = 'reserve_met';

    // Find auction status - order matters!
    var auctionStatus = 'unknown';
    // Most specific first
    if (lowerText.indexOf('sold privately after') !== -1) {
      auctionStatus = 'sold_post_auction';
    }
    // Check for active auction indicators - these take precedence
    else if (lowerText.indexOf('time left') !== -1 && lowerText.indexOf('place a bid') !== -1) {
      auctionStatus = 'active';
    }
    else if (lowerText.indexOf('current bid by') !== -1) {
      auctionStatus = 'active';
    }
    // Explicit sold indicators
    else if (lowerText.indexOf('sold for') !== -1 || soldMatch) {
      auctionStatus = 'sold_at_auction';
    }
    // Explicit ended indicators
    else if (lowerText.indexOf('auction ended') !== -1 || lowerText.indexOf('this auction has ended') !== -1) {
      auctionStatus = 'ended';
    }
    // Preview/coming soon
    else if (lowerText.indexOf('preview') !== -1 || lowerText.indexOf('coming soon') !== -1) {
      auctionStatus = 'preview';
    }

    // Find ending date
    var endingMatch = pageText.match(/Ending[:\s]*([^0-9]*\d+[^,]*,[^-]*)/i);

    // Get mileage
    var mileageMatch = pageText.match(/([0-9,]+)\s*(?:miles|mi\b)/i) ||
                       pageText.match(/Mileage[:\s]*([0-9,]+)/i);
    var kmMatch = pageText.match(/([0-9,]+)\s*(?:kilometers|km\b)/i);

    // Get location
    var locationMatch = pageText.match(/([A-Za-z\s]+,\s*[A-Z]{2},?\s*USA)/i) ||
                        pageText.match(/([A-Za-z\s]+,\s*[A-Za-z\s]+,?\s*[A-Z]{2,3})/i);

    // Get all images
    var images = [];
    var imgEls = document.querySelectorAll('img');
    for (var i = 0; i < imgEls.length; i++) {
      var img = imgEls[i];
      var src = img.src || img.getAttribute('data-src') || '';
      if (src && (src.indexOf('sbxcars.com') !== -1 || src.indexOf('i.sbxcars') !== -1) &&
          src.indexOf('/Assets/') === -1 && src.indexOf('.svg') === -1 && src.indexOf('avatar') === -1) {
        if (images.indexOf(src) === -1) {
          images.push(src);
        }
      }
    }

    // Extract description - the Overview section text
    var description = '';
    // Look for the main description text after "Overview" heading
    var overviewMatch = pageText.match(/Overview\s+([\s\S]*?)(?:Highlights|Equipment|Known Flaws|Modifications|Recent Service|$)/i);
    if (overviewMatch && overviewMatch[1]) {
      description = overviewMatch[1].trim();
      // Clean up - remove extra whitespace
      description = description.replace(/\s+/g, ' ').substring(0, 10000);
    }

    // Extract highlights - bullet points
    var highlights = [];
    var highlightsMatch = pageText.match(/Highlights\s+([\s\S]*?)(?:Overview|Equipment|Known Flaws|Modifications|Recent Service|Car location|View all media|$)/i);
    if (highlightsMatch && highlightsMatch[1]) {
      var highlightText = highlightsMatch[1].trim();
      // Split by newlines and filter empty lines
      var lines = highlightText.split(/\n/).map(function(line) { return line.trim(); }).filter(function(line) { return line.length > 5; });
      highlights = lines.slice(0, 20); // Limit to 20 highlights
    }

    // Extract exterior and interior colors
    var exteriorMatch = pageText.match(/(?:Finished in|Exterior[:\s]+)([A-Za-z\s]+)(?:\s+(?:with|over|on))/i);
    var interiorMatch = pageText.match(/(?:over a|Interior[:\s]+)([A-Za-z\s]+)(?:\s+leather|\s+interior)/i);
    var exterior = exteriorMatch ? exteriorMatch[1].trim() : null;
    var interior = interiorMatch ? interiorMatch[1].trim() : null;

    // Check currency
    var currencyCode = 'USD';
    if (pageText.indexOf('AED') !== -1 || pageText.indexOf('د.إ') !== -1) currencyCode = 'AED';
    else if (pageText.indexOf('EUR') !== -1 || pageText.indexOf('€') !== -1) currencyCode = 'EUR';
    else if (pageText.indexOf('GBP') !== -1 || pageText.indexOf('£') !== -1) currencyCode = 'GBP';

    return {
      title: title,
      pageText: pageText.substring(0, 10000),
      viewCount: viewsMatch ? parseInt(viewsMatch[1].replace(/,/g, '')) : 0,
      bidCount: bidsMatch ? parseInt(bidsMatch[1].replace(/,/g, '')) : 0,
      watchCount: watchingMatch ? parseInt(watchingMatch[1].replace(/,/g, '')) : 0,
      highestBid: latestBidMatch ? parseInt(latestBidMatch[1].replace(/,/g, '')) : null,
      soldPrice: soldMatch ? parseInt(soldMatch[1].replace(/,/g, '')) : null,
      reserveStatus: reserveStatus,
      auctionStatus: auctionStatus,
      endingDate: endingMatch ? endingMatch[1].trim() : null,
      mileage: mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null,
      mileageUnit: kmMatch ? 'kilometers' : 'miles',
      location: locationMatch ? locationMatch[1].trim() : null,
      images: images,
      currencyCode: currencyCode,
      description: description,
      highlights: highlights,
      exterior: exterior,
      interior: interior
    };
  });

  // Parse year/make/model from title or URL
  let year: number | null = null;
  let make: string | null = null;
  let model: string | null = null;

  // Try from title first
  const titleMatch = domData.title.match(/^(\d{4})\s+(.+)$/);
  if (titleMatch) {
    year = parseInt(titleMatch[1]);
    const rest = titleMatch[2];
    const parts = rest.split(/\s+/);
    if (parts.length >= 2) {
      // Handle multi-word makes
      if (parts[0].toLowerCase() === 'rolls' && parts[1]?.toLowerCase() === 'royce') {
        make = 'Rolls-Royce';
        model = parts.slice(2).join(' ');
      } else if (parts[0].toLowerCase() === 'land' && parts[1]?.toLowerCase() === 'rover') {
        make = 'Land Rover';
        model = parts.slice(2).join(' ');
      } else if (parts[0].toLowerCase() === 'aston' && parts[1]?.toLowerCase() === 'martin') {
        make = 'Aston Martin';
        model = parts.slice(2).join(' ');
      } else if (parts[0].toLowerCase() === 'mercedes' || parts[0].toLowerCase() === 'mercedes-benz') {
        make = 'Mercedes-Benz';
        model = parts.slice(1).join(' ').replace(/^benz\s*/i, '');
      } else {
        make = parts[0];
        model = parts.slice(1).join(' ');
      }
    }
  }

  // Fallback to URL parsing
  if (!year) {
    const urlMatch = url.match(/\/listing\/(\d+)\/(\d{4})-(.+)$/);
    if (urlMatch) {
      year = parseInt(urlMatch[2]);
      const slugParts = urlMatch[3].split('-');
      if (slugParts.length >= 2) {
        make = slugParts[0].charAt(0).toUpperCase() + slugParts[0].slice(1);
        model = slugParts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
      }
    }
  }

  // Get lot number from URL
  const lotMatch = url.match(/\/listing\/(\d+)\//);
  const lotNumber = lotMatch ? parseInt(lotMatch[1]) : 0;

  // Determine auction outcome
  const auctionOutcome = determineAuctionOutcomeFromDOM(domData.auctionStatus, domData.pageText, domData.soldPrice);

  // Determine reserve status
  const reserveStatus = domData.reserveStatus as ReserveStatus;
  const hasReserve = reserveStatus !== 'no_reserve';

  // Convert prices to USD if needed
  const rate = CURRENCY_TO_USD[domData.currencyCode] || 1;
  const highestBidUSD = domData.highestBid ? Math.round(domData.highestBid * rate) : null;
  const salePriceUSD = domData.soldPrice ? Math.round(domData.soldPrice * rate) : null;

  // Parse comments and mine for bid mentions
  const parsedComments = parseComments(comments);
  const { minedHighBid, minedBidSource } = mineBidsFromComments(parsedComments);

  // Get VIN from schema
  const vin = schema?.vehicleIdentificationNumber || null;

  // Get asking price from schema
  let askingPrice: number | null = null;
  let schemaCurrency = 'USD';
  if (schema?.offers) {
    askingPrice = schema.offers.price || null;
    schemaCurrency = schema.offers.priceCurrency || 'USD';
  }

  return {
    listingId: 0,
    lotNumber,
    auctionKey: '',
    slug: url.split('/').pop() || '',
    url,

    title: domData.title,
    year,
    make,
    model,
    vin,
    mileage: domData.mileage,
    mileageUnit: domData.mileageUnit as 'miles' | 'kilometers',
    exterior: domData.exterior || null,
    interior: domData.interior || null,
    location: domData.location,
    countryCode: null,

    auctionStatus: domData.auctionStatus,
    auctionOutcome,
    reserveStatus,
    hasReserve,
    currencyCode: domData.currencyCode,

    highestBid: domData.highestBid,
    highestBidUSD,
    salePrice: domData.soldPrice,
    salePriceUSD,
    askingPrice,
    bidCount: domData.bidCount,

    minedHighBid,
    minedBidSource,

    previewTime: null,
    startTime: null,
    endTime: domData.endingDate,
    actualEndTime: null,

    ownerUsername: null,
    highestBidderUsername: null,

    description: domData.description || null,
    highlights: domData.highlights || [],
    carfaxUrl: null,
    images: domData.images,

    comments: parsedComments,

    viewCount: domData.viewCount,
    commentCount: parsedComments.length,
    favoriteCount: domData.watchCount,
  };
}

function determineAuctionOutcomeFromDOM(status: string, pageText: string, soldPrice: number | null): AuctionOutcome {
  const lowerText = pageText.toLowerCase();

  // Check for explicit sold privately text
  if (lowerText.includes('sold privately after')) {
    return 'sold_post_auction';
  }

  // If we have a sold price and the auction ended
  if (soldPrice && (status === 'ended' || status === 'sold_at_auction')) {
    return 'sold_at_auction';
  }

  // Map status to outcome
  switch (status) {
    case 'sold_at_auction':
      return 'sold_at_auction';
    case 'sold_post_auction':
      return 'sold_post_auction';
    case 'active':
      return 'active';
    case 'preview':
      return 'preview';
    case 'ended':
      // Check for reserve not met indicators
      if (lowerText.includes('reserve not met') || lowerText.includes('bid not met')) {
        return 'bid_not_met';
      }
      // If ended but has "sold" text
      if (lowerText.includes('sold')) {
        return 'sold_at_auction';
      }
      return 'ended_unknown';
    default:
      return 'ended_unknown';
  }
}

function parseApiData(
  url: string,
  api: any,
  schema: any,
  comments: any[],
  pageText: string
): SBXListingData {
  const pub = api.Public || {};
  const auction = pub.Auction || {};
  const cache = pub.Cache || {};
  const address = pub.Address || {};

  // Parse year/make/model from title or slug
  let year: number | null = null;
  let make: string | null = null;
  let model: string | null = null;

  const titleMatch = pub.Title?.match(/^(\d{4})\s+(.+)$/);
  if (titleMatch) {
    year = parseInt(titleMatch[1]);
    const rest = titleMatch[2];
    const parts = rest.split(/\s+/);
    if (parts.length >= 2) {
      // Handle multi-word makes
      if (parts[0].toLowerCase() === 'rolls' && parts[1]?.toLowerCase() === 'royce') {
        make = 'Rolls-Royce';
        model = parts.slice(2).join(' ');
      } else if (parts[0].toLowerCase() === 'land' && parts[1]?.toLowerCase() === 'rover') {
        make = 'Land Rover';
        model = parts.slice(2).join(' ');
      } else if (parts[0].toLowerCase() === 'aston' && parts[1]?.toLowerCase() === 'martin') {
        make = 'Aston Martin';
        model = parts.slice(2).join(' ');
      } else if (parts[0].toLowerCase() === 'mercedes' || parts[0].toLowerCase() === 'mercedes-benz') {
        make = 'Mercedes-Benz';
        model = parts.slice(1).join(' ').replace(/^benz\s*/i, '');
      } else {
        make = parts[0];
        model = parts.slice(1).join(' ');
      }
    }
  }

  // Determine auction outcome
  const auctionOutcome = determineAuctionOutcome(auction, cache, pageText);
  const reserveStatus = determineReserveStatus(auction, pageText);

  // Parse mileage
  let mileage: number | null = null;
  let mileageUnit: 'miles' | 'kilometers' = 'miles';
  if (pub.Usage && !pub.Usage.IsEmpty) {
    mileage = pub.Usage.Value;
    mileageUnit = pub.Usage.Unit?.toLowerCase() === 'kilometers' ? 'kilometers' : 'miles';
  }

  // Get currency and prices
  const currencyCode = auction.CurrencyCode || 'USD';
  const highestBid = cache.HighestBid > 0 ? cache.HighestBid : null;
  const salePrice = auction.SalePrice > 0 ? auction.SalePrice : null;

  // Convert to USD
  const rate = CURRENCY_TO_USD[currencyCode] || 1;
  const highestBidUSD = highestBid ? Math.round(highestBid * rate) : null;
  const salePriceUSD = salePrice ? Math.round(salePrice * rate) : null;

  // Get asking price from schema.org
  let askingPrice: number | null = null;
  if (schema?.offers?.price) {
    askingPrice = schema.offers.price;
  }

  // Parse comments and mine for bid mentions
  const parsedComments = parseComments(comments);
  const { minedHighBid, minedBidSource } = mineBidsFromComments(parsedComments);

  // Build location string
  let location: string | null = null;
  if (address.CityName || address.StateName || address.CountryCode) {
    const parts = [address.CityName, address.StateName, address.CountryCode].filter(Boolean);
    location = parts.join(', ');
  }

  // Get images
  const images: string[] = [];
  if (pub.Images) {
    pub.Images.forEach((img: any) => {
      if (img.Path) {
        const imgUrl = img.Path.startsWith('http')
          ? img.Path
          : `https://i.sbxcars.com/${img.Path}`;
        images.push(imgUrl);
      }
    });
  }

  return {
    listingId: api.Id,
    lotNumber: pub.LotNumber || 0,
    auctionKey: api.AuctionKey || '',
    slug: pub.Slug || '',
    url,

    title: pub.Title || '',
    year,
    make,
    model,
    vin: pub.IdentificationNumber || schema?.vehicleIdentificationNumber || null,
    mileage,
    mileageUnit,
    exterior: pub.Exterior || null,
    interior: pub.Interior || null,
    location,
    countryCode: address.CountryCode || null,

    auctionStatus: auction.Status || 'Unknown',
    auctionOutcome,
    reserveStatus,
    hasReserve: auction.HasReservePrice ?? true,
    currencyCode,

    highestBid,
    highestBidUSD,
    salePrice,
    salePriceUSD,
    askingPrice,
    bidCount: cache.BidCount || 0,

    minedHighBid,
    minedBidSource,

    previewTime: auction.PreviewTime || null,
    startTime: auction.StartTime || null,
    endTime: auction.OriginalEndTime || null,
    actualEndTime: auction.ActualEndTime || null,

    ownerUsername: cache.OwnerUsername || null,
    highestBidderUsername: cache.HighestBidderUsername || null,

    description: pub.Description || null,
    highlights: pub.Highlights || [],
    carfaxUrl: pub.CarfaxURL || null,
    images,

    comments: parsedComments,

    viewCount: cache.ViewCount || 0,
    commentCount: cache.CommentCount || 0,
    favoriteCount: cache.FavoriteCount || 0,
  };
}

function determineAuctionOutcome(auction: any, cache: any, pageText: string): AuctionOutcome {
  const status = auction.Status?.toLowerCase() || '';
  const lowerPageText = pageText.toLowerCase();

  // Check for explicit sold privately text
  if (lowerPageText.includes('sold privately after')) {
    return 'sold_post_auction';
  }

  // Check API status
  if (status === 'pending' || status === 'preview') {
    return 'preview';
  }

  if (status === 'live' || status === 'active') {
    return 'active';
  }

  if (status === 'sold' || auction.SalePrice > 0) {
    return 'sold_at_auction';
  }

  if (status === 'ended' || status === 'closed') {
    // Check if it says "Sold" on page
    if (lowerPageText.includes('sold') && !lowerPageText.includes('not sold') && !lowerPageText.includes('unsold')) {
      // But API shows no sale price - likely private sale
      if (!auction.SalePrice || auction.SalePrice === 0) {
        return 'sold_post_auction';
      }
      return 'sold_at_auction';
    }

    // Check reserve status
    if (auction.ReserveStatus === 'ReserveNotMet') {
      return 'bid_not_met';
    }

    return 'ended_unknown';
  }

  if (status === 'withdrawn' || status === 'cancelled') {
    return 'withdrawn';
  }

  return 'ended_unknown';
}

function determineReserveStatus(auction: any, pageText: string): ReserveStatus {
  if (!auction.HasReservePrice) {
    return 'no_reserve';
  }

  const apiStatus = auction.ReserveStatus?.toLowerCase() || '';
  const lowerText = pageText.toLowerCase();

  if (apiStatus.includes('met') && !apiStatus.includes('not')) {
    return 'reserve_met';
  }
  if (apiStatus.includes('almost')) {
    return 'reserve_almost_met';
  }
  if (apiStatus.includes('lowered')) {
    return 'reserve_lowered';
  }
  if (apiStatus.includes('notmet') || apiStatus.includes('not met')) {
    return 'reserve_not_met';
  }

  // Fallback to page text
  if (lowerText.includes('reserve met')) return 'reserve_met';
  if (lowerText.includes('reserve almost met')) return 'reserve_almost_met';
  if (lowerText.includes('reserve lowered')) return 'reserve_lowered';
  if (lowerText.includes('reserve not met')) return 'reserve_not_met';
  if (lowerText.includes('no reserve')) return 'no_reserve';

  return 'unknown';
}

function parseComments(rawComments: any[]): SBXComment[] {
  const comments: SBXComment[] = [];

  for (const c of rawComments) {
    // Extract text from spans
    let text = '';
    if (c.Text?.Spans) {
      text = c.Text.Spans.map((s: any) => s.Text || '').join('').trim();
    }

    // Look for price mentions in text
    const mentionedPrice = extractPriceFromText(text);

    comments.push({
      commentId: c.CommentId,
      authorUsername: c.CachedAuthorUsername || 'Anonymous',
      authorUserId: c.AuthorUserProfileId,
      isOwner: c.CachedAuthorIsListingOwner || false,
      text,
      postedAt: c.CreatedAt,
      likes: c.CachedThumbsUpCount || 0,
      replyCount: c.Replies?.length || 0,
      mentionedPrice,
    });

    // Also process replies
    if (c.Replies && Array.isArray(c.Replies)) {
      for (const reply of c.Replies) {
        let replyText = '';
        if (reply.Text?.Spans) {
          replyText = reply.Text.Spans.map((s: any) => s.Text || '').join('').trim();
        }
        const replyPrice = extractPriceFromText(replyText);

        comments.push({
          commentId: reply.CommentId,
          authorUsername: reply.CachedAuthorUsername || 'Anonymous',
          authorUserId: reply.AuthorUserProfileId,
          isOwner: reply.CachedAuthorIsListingOwner || false,
          text: replyText,
          postedAt: reply.CreatedAt,
          likes: reply.CachedThumbsUpCount || 0,
          replyCount: 0,
          mentionedPrice: replyPrice,
        });
      }
    }
  }

  return comments;
}

function extractPriceFromText(text: string): number | null {
  if (!text) return null;

  // Look for dollar amounts - various formats
  // $1,300,000 or $1,300.000 (European) or $1.3M or 1,300,000 USD
  const patterns = [
    /\$\s*([\d,]+(?:\.\d{3})?)\s*(?:k|m|million)?/gi,  // $1,300,000 or $1,300.000
    /\$\s*([\d.]+)\s*(?:m|million)/gi,                  // $1.3M
    /([\d,]+(?:\.\d{3})?)\s*(?:USD|dollars)/gi,         // 1,300,000 USD
    /(?:bid|offer|price)[:\s]+\$?\s*([\d,]+)/gi,        // bid: 1,300,000
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      let numStr = match[1].replace(/,/g, '');

      // Handle European format (1.300.000 = 1,300,000)
      if (numStr.split('.').length > 2) {
        numStr = numStr.replace(/\./g, '');
      }
      // Handle single decimal that's likely European thousands (1.300 = 1,300)
      else if (numStr.includes('.') && numStr.split('.')[1].length === 3) {
        numStr = numStr.replace('.', '');
      }

      let value = parseFloat(numStr);

      // Handle M/million suffix
      if (text.toLowerCase().includes('m') || text.toLowerCase().includes('million')) {
        if (value < 100) { // Likely shorthand like 1.3M
          value *= 1000000;
        }
      }

      // Sanity check - prices should be > $1000 for these cars
      if (value > 1000 && value < 100000000) {
        return Math.round(value);
      }
    }
  }

  return null;
}

function mineBidsFromComments(comments: SBXComment[]): { minedHighBid: number | null; minedBidSource: string | null } {
  let maxBid = 0;
  let source: string | null = null;

  for (const comment of comments) {
    if (comment.mentionedPrice && comment.mentionedPrice > maxBid) {
      maxBid = comment.mentionedPrice;
      source = `Comment by ${comment.authorUsername}: "${comment.text.substring(0, 50)}..."`;
    }
  }

  return {
    minedHighBid: maxBid > 0 ? maxBid : null,
    minedBidSource: source,
  };
}

// Fallback scraping when API data not available
async function scrapeFromPage(
  page: Page,
  url: string,
  pageText: string,
  schema: any,
  comments: any[]
): Promise<SBXListingData> {
  // Parse from URL slug
  const urlMatch = url.match(/\/listing\/(\d+)\/(\d{4})-(.+)$/);
  let year: number | null = null;
  let make: string | null = null;
  let model: string | null = null;
  let lotNumber = 0;

  if (urlMatch) {
    lotNumber = parseInt(urlMatch[1]);
    year = parseInt(urlMatch[2]);
    const slugParts = urlMatch[3].split('-');
    if (slugParts.length >= 2) {
      make = slugParts[0].charAt(0).toUpperCase() + slugParts[0].slice(1);
      model = slugParts.slice(1).join(' ');
    }
  }

  // Get VIN from schema
  const vin = schema?.vehicleIdentificationNumber || null;

  // Determine status from page text
  const auctionOutcome = determineAuctionOutcome({}, {}, pageText);
  const reserveStatus = determineReserveStatus({}, pageText);

  // Parse comments
  const parsedComments = parseComments(comments);
  const { minedHighBid, minedBidSource } = mineBidsFromComments(parsedComments);

  // Get asking price from schema
  let askingPrice: number | null = null;
  let currencyCode = 'USD';
  if (schema?.offers) {
    askingPrice = schema.offers.price || null;
    currencyCode = schema.offers.priceCurrency || 'USD';
  }

  // Get images
  const images = await page.$$eval('img', imgs => {
    const results: string[] = [];
    imgs.forEach(img => {
      const src = img.src;
      if (src && (src.includes('sbxcars.com') || src.includes('i.sbxcars')) &&
          !src.includes('/Assets/') && !src.includes('.svg')) {
        results.push(src);
      }
    });
    return [...new Set(results)];
  });

  return {
    listingId: 0,
    lotNumber,
    auctionKey: '',
    slug: urlMatch?.[3] || '',
    url,

    title: schema?.name || `${year} ${make} ${model}`,
    year,
    make,
    model,
    vin,
    mileage: null,
    mileageUnit: 'miles',
    exterior: null,
    interior: null,
    location: null,
    countryCode: null,

    auctionStatus: 'Unknown',
    auctionOutcome,
    reserveStatus,
    hasReserve: true,
    currencyCode,

    highestBid: null,
    highestBidUSD: null,
    salePrice: null,
    salePriceUSD: null,
    askingPrice,
    bidCount: 0,

    minedHighBid,
    minedBidSource,

    previewTime: null,
    startTime: null,
    endTime: null,
    actualEndTime: null,

    ownerUsername: null,
    highestBidderUsername: null,

    description: null,
    highlights: [],
    carfaxUrl: null,
    images,

    comments: parsedComments,

    viewCount: 0,
    commentCount: parsedComments.length,
    favoriteCount: 0,
  };
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

async function saveListing(listing: SBXListingData): Promise<{ vehicleId: string | null; isNew: boolean }> {
  if (CONFIG.DRY_RUN) {
    console.log('   [DRY RUN] Would save:', listing.title);
    return { vehicleId: 'dry-run', isNew: true };
  }

  // Check if exists
  const { data: existing } = await supabase
    .from('vehicles')
    .select('id')
    .eq('listing_url', listing.url)
    .maybeSingle();

  const isNew = !existing;
  let vehicleId = existing?.id;

  // Determine best price to store
  const bestPrice = listing.salePriceUSD || listing.highestBidUSD || listing.minedHighBid || listing.askingPrice;

  // Convert mileage to miles if needed
  let mileageInMiles = listing.mileage;
  if (listing.mileage && listing.mileageUnit === 'kilometers') {
    mileageInMiles = Math.round(listing.mileage * 0.621371);
  }

  const vehicleData = {
    year: listing.year,
    make: listing.make,
    model: listing.model,
    vin: listing.vin,
    mileage: mileageInMiles,
    listing_url: listing.url,
    description: listing.description?.substring(0, 5000),
    location: listing.location,
    high_bid: listing.highestBidUSD || listing.minedHighBid,
    sold_price: listing.salePriceUSD,
    auction_outcome: listing.auctionOutcome,
    status: listing.auctionOutcome === 'active' ? 'active' : 'completed',
    discovery_url: listing.url,
    updated_at: new Date().toISOString(),
  };

  if (isNew) {
    const { data: newVehicle, error } = await supabase
      .from('vehicles')
      .insert(vehicleData)
      .select('id')
      .single();

    if (error) {
      console.error('   [DB ERROR] Creating vehicle:', error.message);
      return { vehicleId: null, isNew: false };
    }
    vehicleId = newVehicle.id;
  } else {
    // Only update fields that have values
    const updateData: any = { updated_at: new Date().toISOString() };
    if (listing.vin) updateData.vin = listing.vin;
    if (mileageInMiles) updateData.mileage = mileageInMiles;
    if (listing.description) updateData.description = listing.description.substring(0, 5000);
    if (listing.location) updateData.location = listing.location;
    if (listing.highestBidUSD || listing.minedHighBid) {
      updateData.high_bid = listing.highestBidUSD || listing.minedHighBid;
    }
    if (listing.salePriceUSD) updateData.sold_price = listing.salePriceUSD;
    updateData.auction_outcome = listing.auctionOutcome;

    await supabase.from('vehicles').update(updateData).eq('id', vehicleId);
  }

  // Save to external_listings with full metadata
  await supabase.from('external_listings').upsert({
    vehicle_id: vehicleId,
    source: 'sbx_cars',
    listing_url: listing.url,
    external_id: listing.lotNumber.toString(),
    metadata: {
      listingId: listing.listingId,
      auctionKey: listing.auctionKey,
      slug: listing.slug,
      auctionStatus: listing.auctionStatus,
      auctionOutcome: listing.auctionOutcome,
      reserveStatus: listing.reserveStatus,
      hasReserve: listing.hasReserve,
      currencyCode: listing.currencyCode,
      highestBid: listing.highestBid,
      highestBidUSD: listing.highestBidUSD,
      salePrice: listing.salePrice,
      salePriceUSD: listing.salePriceUSD,
      askingPrice: listing.askingPrice,
      minedHighBid: listing.minedHighBid,
      minedBidSource: listing.minedBidSource,
      bidCount: listing.bidCount,
      viewCount: listing.viewCount,
      favoriteCount: listing.favoriteCount,
      previewTime: listing.previewTime,
      startTime: listing.startTime,
      endTime: listing.endTime,
      actualEndTime: listing.actualEndTime,
      ownerUsername: listing.ownerUsername,
      highestBidderUsername: listing.highestBidderUsername,
      highlights: listing.highlights,
      carfaxUrl: listing.carfaxUrl,
      exterior: listing.exterior,
      interior: listing.interior,
      countryCode: listing.countryCode,
      mileageUnit: listing.mileageUnit,
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'vehicle_id,source' });

  // Save comments
  if (listing.comments.length > 0 && vehicleId) {
    let created = 0;
    let skipped = 0;

    for (const comment of listing.comments) {
      const contentHash = Buffer.from(
        `sbx_cars-${listing.lotNumber}-${comment.commentId}`
      ).toString('base64').substring(0, 64);

      const { data: existingComment } = await supabase
        .from('auction_comments')
        .select('id')
        .eq('content_hash', contentHash)
        .maybeSingle();

      if (existingComment) {
        skipped++;
        continue;
      }

      const { error } = await supabase.from('auction_comments').insert({
        vehicle_id: vehicleId,
        platform: 'sbx_cars',
        author_username: comment.authorUsername,
        comment_text: comment.text?.substring(0, 5000),
        posted_at: comment.postedAt,
        comment_type: 'observation',
        is_seller: comment.isOwner,
        comment_likes: comment.likes,
        reply_count: comment.replyCount,
        bid_amount: comment.mentionedPrice,
        content_hash: contentHash,
        source_url: listing.url,
      });

      if (!error) created++;
    }

    if (created > 0 || skipped > 0) {
      console.log(`   [COMMENTS] ${created} created, ${skipped} skipped`);
    }
  }

  // Save images (skip deletion for speed)
  if (listing.images.length > 0 && vehicleId) {
    const imageRecords = listing.images.map((imageUrl, idx) => ({
      vehicle_id: vehicleId,
      image_url: imageUrl,
      source: 'external_import',
      display_order: idx,
    }));

    for (let i = 0; i < imageRecords.length; i += 50) {
      const batch = imageRecords.slice(i, i + 50);
      await supabase.from('vehicle_images').upsert(batch, {
        onConflict: 'vehicle_id,image_url',
        ignoreDuplicates: true,
      });
    }
  }

  return { vehicleId, isNew };
}

// ============================================================================
// DISCOVERY
// ============================================================================

async function discoverListings(page: Page): Promise<string[]> {
  const listings: Set<string> = new Set();

  const sections = [
    'https://sbxcars.com/auctions',
    'https://sbxcars.com/preview',
    'https://sbxcars.com/results',
  ];

  for (const sectionUrl of sections) {
    console.log(`[DISCOVER] ${sectionUrl}`);

    try {
      await page.goto(sectionUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);

      // Scroll to load all
      for (let i = 0; i < 10; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(800);
      }

      const urls = await page.evaluate(() => {
        const links = document.querySelectorAll('a[href*="/listing/"]');
        return Array.from(links).map(a => (a as HTMLAnchorElement).href);
      });

      urls.forEach(url => {
        if (url.includes('/listing/')) {
          listings.add(url.split('?')[0]);
        }
      });

      console.log(`   Found ${urls.length} listings`);
    } catch (error: any) {
      console.error(`   Error: ${error.message}`);
    }
  }

  console.log(`[DISCOVER] Total unique: ${listings.size}\n`);
  return Array.from(listings);
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  SBX CARS SCRAPER V2 - PERFECTED');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Config: batch=${CONFIG.BATCH_SIZE}, delay=${CONFIG.DELAY_BETWEEN}ms`);
  if (CONFIG.DRY_RUN) console.log('** DRY RUN MODE **');
  console.log('');

  const browser = await chromium.launch({ headless: CONFIG.HEADLESS });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });
  const page = await context.newPage();

  try {
    // Discovery phase
    console.log('[PHASE 1] DISCOVERY');
    console.log('─────────────────────────────────────────────────────────────');
    const listingUrls = await discoverListings(page);

    if (listingUrls.length === 0) {
      console.log('No listings found.');
      return;
    }

    // Limit if configured
    const toProcess = CONFIG.MAX_LISTINGS > 0
      ? listingUrls.slice(0, CONFIG.MAX_LISTINGS)
      : listingUrls;

    // Extraction phase
    console.log('[PHASE 2] EXTRACTION');
    console.log('─────────────────────────────────────────────────────────────');

    let processed = 0;
    let created = 0;
    let updated = 0;
    let errors = 0;

    for (let i = 0; i < toProcess.length; i++) {
      const url = toProcess[i];
      console.log(`\n[${i + 1}/${toProcess.length}] ${url}`);

      const listing = await scrapeListing(page, url);

      if (listing) {
        // Log extracted data summary
        console.log(`   ${listing.year} ${listing.make} ${listing.model}`);
        console.log(`   VIN: ${listing.vin || 'N/A'}`);
        console.log(`   Status: ${listing.auctionOutcome} | Reserve: ${listing.reserveStatus}`);

        const priceInfo = [];
        if (listing.salePriceUSD) priceInfo.push(`Sold: $${listing.salePriceUSD.toLocaleString()}`);
        if (listing.highestBidUSD) priceInfo.push(`Bid: $${listing.highestBidUSD.toLocaleString()}`);
        if (listing.minedHighBid) priceInfo.push(`Mined: $${listing.minedHighBid.toLocaleString()}`);
        if (listing.askingPrice) priceInfo.push(`Ask: $${listing.askingPrice.toLocaleString()}`);
        if (listing.currencyCode !== 'USD') priceInfo.push(`(${listing.currencyCode})`);
        console.log(`   Price: ${priceInfo.join(' | ') || 'N/A'}`);
        console.log(`   Images: ${listing.images.length}, Comments: ${listing.comments.length}`);
        console.log(`   Desc: ${listing.description ? listing.description.length + ' chars' : 'N/A'}, Highlights: ${listing.highlights?.length || 0}`);

        const { vehicleId, isNew } = await saveListing(listing);

        if (vehicleId) {
          processed++;
          if (isNew) {
            created++;
            console.log('   -> CREATED');
          } else {
            updated++;
            console.log('   -> UPDATED');
          }
        } else {
          errors++;
          console.log('   -> FAILED');
        }
      } else {
        errors++;
        console.log('   -> SCRAPE FAILED');
      }

      // Delay
      if (i < toProcess.length - 1) {
        const isEndOfBatch = (i + 1) % CONFIG.BATCH_SIZE === 0;
        await new Promise(r => setTimeout(r, isEndOfBatch ? CONFIG.DELAY_BETWEEN_BATCHES : CONFIG.DELAY_BETWEEN));
      }
    }

    // Summary
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  Processed: ${processed}`);
    console.log(`  Created: ${created}`);
    console.log(`  Updated: ${updated}`);
    console.log(`  Errors: ${errors}`);
    console.log('═══════════════════════════════════════════════════════════════');

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
