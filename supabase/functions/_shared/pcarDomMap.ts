/**
 * PCARMARKET DOM/JSON EXTRACTION MAP
 *
 * PCarMarket embeds all listing data as JSON in the page.
 * This is MUCH easier than HTML parsing - just find and parse the JSON object.
 *
 * Key insight: The JSON contains EVERYTHING - vehicle specs, auction data,
 * images, comments, seller info. No need to scrape HTML elements.
 */

// ============================================================================
// JSON SCHEMA - Complete listing data structure
// ============================================================================

export interface PCarMarketListingJSON {
  // Core identifiers
  id: number;                          // Auction ID: 63888
  title: string;                       // "1970 Mercedes-Benz 280SL"
  slug: string;                        // "1970-mercedes-benz-280sl-1"
  lot_number: string;                  // "V-0063888" (V=vehicle, M=memorabilia)

  // Vehicle data (null for memorabilia)
  vehicle: {
    id: number;
    make: string;                      // "Mercedes-Benz"
    model: string;                     // "280SL"
    year: number;                      // 1970
    slug_model: string;                // "280sl"
  } | null;

  // Categories (for non-vehicle items)
  categories?: Array<{
    slug: string;                      // "memorabilia"
    name: string;                      // "Art & Memorabilia"
  }>;

  // VIN/Chassis (can be short for pre-1981)
  vin: string;                         // "11304412013245" or "WP0AB29947S730343"

  // Mileage
  mileage_body: number | null;         // 38569
  mileage_engine: number | null;       // null or different if engine swapped
  odometer_type: 'mi' | 'km';          // Usually "mi"
  tmu: boolean;                        // True Mileage Unknown
  five_digit_odo: boolean;             // Odometer rollover possible

  // Auction type
  auction_type: number;                // 1 = standard
  auction_subtype: number;             // 1 = standard
  is_marketplace: boolean;             // false for auctions, true for fixed-price
  marketplace_listing_slug: string | null;

  // Pricing
  current_bid: string;                 // "$74,000" (formatted)
  high_bid: number;                    // 74000.0 (numeric)
  reserve_price: number | null;        // null if no reserve
  reserve_status: 'met' | 'not_met' | null;
  minimum_bid: string;                 // "$74,250"
  msrp: number | null;                 // Original MSRP if known
  retail_value: number | null;         // Estimated retail value
  dealer_fee_amount: string;           // "0"

  // Auction lifecycle
  start_date: string;                  // "2026-01-16T17:14:00-05:00" (ISO with TZ)
  end_date: string;                    // "2026-01-23T15:00:00-05:00"
  time_remaining: number;              // Seconds remaining (negative if ended)
  last_chance: boolean;                // Extended bidding active
  last_chance_end_date: string | null;

  // Status
  status: 'Live' | 'Sold' | 'Unsold' | 'Coming Soon';
  status_class: 'live' | 'sold' | 'unsold' | 'coming_soon';
  sold: boolean;
  finalized: boolean;
  accepted_offer: boolean;             // Post-auction offer accepted
  hide_sell_price: boolean;
  auction_final_bid: number | null;
  is_draft: boolean;

  // Engagement metrics
  bid_count: number;                   // 14
  view_count: number;                  // 4611
  watch_count: number;                 // 76
  is_saved: boolean;                   // User has saved (requires auth)

  // Location
  location: string;                    // "San Luis Obispo, CA"
  zip_code: string;                    // "93401"
  country: string;                     // "United States of America"

  // Seller
  seller_username: string;             // "smithvolvo"
  seller_user_id: number;              // 1330
  seller_date_joined: string;          // "March 2019"
  seller_follower_count: number;       // 4
  user_follows_seller: boolean;        // Requires auth

  // Inspection
  inspection_completed: boolean;

  // Content
  description: string;                 // Full HTML description
  promo_text: string;                  // Promotional text if any
  featured_image_url: string;          // Thumbnail
  featured_image_large_url: string;    // Hero image

  // Gallery - array of image objects
  gallery_images: PCarMarketImage[];

  // Comments/bids (may be in separate field)
  comments?: PCarMarketComment[];
}

export interface PCarMarketImage {
  id: number;
  url: string;                         // 380px thumbnail
  hero_url: string;                    // 2048px hero
  full_url: string;                    // 2048px full
  original_url: string;                // Original uncompressed
  caption?: string;
  position: number;
}

export interface PCarMarketComment {
  id: number;
  user_id: number;
  username: string;
  content: string;
  created_at: string;
  is_bid: boolean;
  bid_amount?: number;
  is_seller: boolean;
  reply_to?: number;
  likes: number;
}

// ============================================================================
// EXTRACTION PATTERNS
// ============================================================================

/**
 * Find the JSON data in the page HTML
 * PCarMarket embeds data in a script tag or window variable
 */
export const JSON_EXTRACTION_PATTERNS = {
  // Pattern 1: __NEXT_DATA__ (Next.js apps)
  nextData: /<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/,

  // Pattern 2: Window variable assignment
  windowData: /window\.__AUCTION_DATA__\s*=\s*(\{[\s\S]+?\});/,

  // Pattern 3: Inline JSON in script
  inlineJson: /<script[^>]*type="application\/json"[^>]*>(\{[\s\S]+?\})<\/script>/,

  // Pattern 4: Data attribute
  dataAttribute: /data-auction="([^"]+)"/,
};

/**
 * Parse the embedded JSON from HTML
 */
export function extractListingJSON(html: string): PCarMarketListingJSON | null {
  // Try each pattern
  for (const [name, pattern] of Object.entries(JSON_EXTRACTION_PATTERNS)) {
    const match = html.match(pattern);
    if (match?.[1]) {
      try {
        const data = JSON.parse(match[1]);
        // __NEXT_DATA__ has nested structure
        if (name === 'nextData' && data.props?.pageProps?.auction) {
          return data.props.pageProps.auction;
        }
        return data;
      } catch {
        continue;
      }
    }
  }
  return null;
}

// ============================================================================
// FIELD MAPPINGS: PCarMarket → Nuke vehicles table
// ============================================================================

export const FIELD_MAPPINGS = {
  // Core vehicle identity
  year: (json: PCarMarketListingJSON) => json.vehicle?.year ?? null,
  make: (json: PCarMarketListingJSON) => json.vehicle?.make?.toLowerCase() ?? null,
  model: (json: PCarMarketListingJSON) => json.vehicle?.model?.toLowerCase() ?? null,
  vin: (json: PCarMarketListingJSON) => json.vin?.toUpperCase() || null,

  // Mileage
  mileage: (json: PCarMarketListingJSON) => json.mileage_body ?? json.mileage_engine ?? null,

  // Pricing
  sale_price: (json: PCarMarketListingJSON) =>
    json.sold ? (json.auction_final_bid ?? json.high_bid ?? null) : null,

  // Dates
  auction_end_date: (json: PCarMarketListingJSON) => json.end_date ?? null,
  sale_date: (json: PCarMarketListingJSON) =>
    json.sold ? json.end_date : null,

  // Status
  auction_outcome: (json: PCarMarketListingJSON) => {
    if (json.sold) return 'sold';
    if (json.status === 'Unsold') return 'reserve_not_met';
    return null;
  },

  // Location
  location: (json: PCarMarketListingJSON) =>
    json.location ? `${json.location} ${json.zip_code}`.trim() : null,

  // Description
  description: (json: PCarMarketListingJSON) => json.description ?? null,

  // Origin tracking
  profile_origin: () => 'PCARMARKET_IMPORT',
  discovery_source: () => 'PCARMARKET',
  discovery_url: (json: PCarMarketListingJSON) =>
    `https://www.pcarmarket.com/auction/${json.slug}`,
  listing_url: (json: PCarMarketListingJSON) =>
    `https://www.pcarmarket.com/auction/${json.slug}`,

  // Origin metadata
  origin_metadata: (json: PCarMarketListingJSON) => ({
    source: 'PCARMARKET_IMPORT',
    pcarmarket_url: `https://www.pcarmarket.com/auction/${json.slug}`,
    pcarmarket_listing_title: json.title,
    pcarmarket_auction_id: String(json.id),
    pcarmarket_auction_slug: json.slug,
    pcarmarket_lot_number: json.lot_number,
    pcarmarket_seller_username: json.seller_username,
    pcarmarket_seller_id: json.seller_user_id,
    bid_count: json.bid_count,
    view_count: json.view_count,
    watch_count: json.watch_count,
    reserve_status: json.reserve_status,
    sold_status: json.sold ? 'sold' : 'unsold',
    is_memorabilia: json.vehicle === null,
    categories: json.categories?.map(c => c.name) ?? [],
    imported_at: new Date().toISOString(),
  }),
};

// ============================================================================
// CATEGORY DETECTION
// ============================================================================

export function isVehicleListing(json: PCarMarketListingJSON): boolean {
  // Check if vehicle object exists and is not null
  if (json.vehicle !== null && json.vehicle !== undefined) {
    return true;
  }

  // Check lot number prefix (V=vehicle, M=memorabilia)
  if (json.lot_number?.startsWith('V-')) {
    return true;
  }

  // Check categories
  if (json.categories?.some(c => c.slug === 'memorabilia')) {
    return false;
  }

  return true; // Default to vehicle
}

export function getListingCategory(json: PCarMarketListingJSON): string {
  if (json.categories?.length) {
    return json.categories[0].name;
  }
  if (json.vehicle) {
    return 'Vehicle';
  }
  return 'Unknown';
}

// ============================================================================
// IMAGE EXTRACTION
// ============================================================================

export function extractImages(json: PCarMarketListingJSON): string[] {
  const images: string[] = [];

  // Add featured image first
  if (json.featured_image_large_url) {
    images.push(json.featured_image_large_url);
  } else if (json.featured_image_url) {
    images.push(json.featured_image_url);
  }

  // Add gallery images (prefer full resolution)
  if (json.gallery_images?.length) {
    for (const img of json.gallery_images) {
      const url = img.original_url || img.full_url || img.hero_url || img.url;
      if (url && !images.includes(url)) {
        images.push(url);
      }
    }
  }

  return images;
}

/**
 * Get best quality image URL
 */
export function getBestImageUrl(img: PCarMarketImage): string {
  return img.original_url || img.full_url || img.hero_url || img.url;
}

// ============================================================================
// VIN HANDLING (including pre-1981 chassis numbers)
// ============================================================================

/**
 * Validate and normalize VIN
 * Pre-1981 VINs can be 11-17 characters
 * Post-1981 VINs are exactly 17 characters
 */
export function normalizeVin(vin: string | null | undefined): string | null {
  if (!vin) return null;

  // Clean the VIN
  const cleaned = vin.trim().toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');

  // Reject if too short (< 6 chars probably not valid)
  if (cleaned.length < 6) return null;

  // Accept 6-17 characters for chassis/VIN
  if (cleaned.length <= 17) {
    return cleaned;
  }

  return null;
}

// ============================================================================
// URL PATTERNS
// ============================================================================

export const URL_PATTERNS = {
  // Auction listing
  auction: /^https?:\/\/(?:www\.)?pcarmarket\.com\/auction\/([a-z0-9-]+)\/?$/i,

  // Listing index pages
  soldIndex: /^https?:\/\/(?:www\.)?pcarmarket\.com\/auctions\?auctionType=sold/i,
  unsoldIndex: /^https?:\/\/(?:www\.)?pcarmarket\.com\/auctions\?auctionType=unsold/i,
  noReserveIndex: /^https?:\/\/(?:www\.)?pcarmarket\.com\/auctions\?auctionType=no_reserve/i,
  reserveIndex: /^https?:\/\/(?:www\.)?pcarmarket\.com\/auctions\?auctionType=reserve/i,
  liveIndex: /^https?:\/\/(?:www\.)?pcarmarket\.com\/auctions\?auctionType=live/i,

  // Member profile
  member: /^https?:\/\/(?:www\.)?pcarmarket\.com\/member\/([a-z0-9_-]+)\/?$/i,
  seller: /^https?:\/\/(?:www\.)?pcarmarket\.com\/seller\/([a-z0-9_-]+)\/?$/i,

  // Image CDN
  image: /^https?:\/\/d2niwqq19lf86s\.cloudfront\.net\//,
};

export function parseAuctionSlug(url: string): string | null {
  const match = url.match(URL_PATTERNS.auction);
  return match?.[1] ?? null;
}

// ============================================================================
// LISTING INDEX PAGINATION
// ============================================================================

export const PAGINATION = {
  // Page parameter
  pageParam: 'page',

  // Items per page (observed)
  itemsPerPage: 24,

  // Auction type values
  auctionTypes: {
    sold: 'sold',
    unsold: 'unsold',
    no_reserve: 'no_reserve',
    reserve: 'reserve',
    live: 'live',
  },

  // Build paginated URL
  buildUrl: (type: keyof typeof PAGINATION.auctionTypes, page: number) =>
    `https://www.pcarmarket.com/auctions?auctionType=${type}&page=${page}`,
};

// ============================================================================
// EXTRACTION SUMMARY
// ============================================================================

/**
 * PCarMarket Data Availability Summary
 *
 * ALWAYS AVAILABLE:
 * - Title, slug, lot number, auction ID
 * - Auction dates (start, end)
 * - Status (sold/unsold/live)
 * - Bid count, view count, watch count
 * - Seller username
 * - Location (city, state, zip)
 * - Description (HTML)
 * - Featured image + gallery
 *
 * USUALLY AVAILABLE:
 * - Year, make, model (from vehicle object)
 * - VIN (but may be short for classics)
 * - Mileage
 * - Final/high bid price
 *
 * SOMETIMES MISSING:
 * - Engine specs (in description, not structured)
 * - Transmission (in description)
 * - Colors (in description)
 * - Buyer username (only for sold)
 * - MSRP, retail value
 *
 * FOR MEMORABILIA:
 * - vehicle: null
 * - categories: [{ slug: 'memorabilia', name: 'Art & Memorabilia' }]
 * - lot_number: 'M-XXXXX' (M prefix)
 */

export const DATA_AVAILABILITY = {
  alwaysPresent: [
    'id', 'title', 'slug', 'lot_number', 'status', 'status_class',
    'start_date', 'end_date', 'bid_count', 'view_count', 'watch_count',
    'seller_username', 'location', 'description', 'featured_image_url',
  ],
  usuallyPresent: [
    'vehicle.year', 'vehicle.make', 'vehicle.model', 'vin',
    'mileage_body', 'high_bid', 'current_bid', 'gallery_images',
  ],
  sometimesMissing: [
    'mileage_engine', 'msrp', 'retail_value', 'auction_final_bid',
    'reserve_price', 'dealer_fee_amount',
  ],
};
