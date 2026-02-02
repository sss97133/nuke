/**
 * BLOCKET.SE EXTRACTOR
 *
 * Extracts vehicle listings from Blocket.se (Swedish car classifieds).
 *
 * Supports:
 * - Search URL crawling with pagination
 * - Single listing extraction
 * - Swedish language fields (mil, SEK)
 *
 * Data sources:
 * - Search pages: JSON-LD seoStructuredData with ItemList
 * - Listing pages: advertising-initial-state JSON with targeting data
 * - HTML meta tags for additional info
 *
 * Swedish conversions:
 * - 1 Swedish "mil" = 10 km = 6.21 miles
 * - Prices in SEK (Swedish Krona)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { firecrawlScrape } from '../_shared/firecrawl.ts';
import { normalizeListingUrlKey } from '../_shared/listingUrl.ts';

// ============================================================================
// TYPES
// ============================================================================

interface BlocketExtracted {
  url: string;
  listing_id: string;

  // Vehicle basics
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  registration_number: string | null;

  // Specs
  mileage_mil: number | null;     // Swedish mil (1 mil = 10 km)
  mileage_km: number | null;      // Converted to km
  mileage_miles: number | null;   // Converted to miles
  fuel_type: string | null;
  transmission: string | null;
  body_style: string | null;
  horsepower: number | null;

  // Pricing
  price_sek: number | null;
  price_usd: number | null;  // Approximate conversion

  // Location
  location: string | null;
  county: string | null;
  municipality: string | null;
  zipcode: string | null;

  // Seller
  seller_type: 'private' | 'professional' | 'unknown';
  seller_id: string | null;
  seller_name: string | null;

  // Content
  description: string | null;
  image_urls: string[];

  // Metadata
  listing_status: 'active' | 'sold' | 'unknown';
  extracted_at: string;

  // Internal
  vehicle_id?: string;
  raw_data?: any;
}

interface SearchResult {
  listings: BlocketExtracted[];
  total_count: number;
  page: number;
  has_more: boolean;
  next_url: string | null;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
};

// Swedish fuel type mapping
const FUEL_TYPE_MAP: Record<string, string> = {
  '1': 'Bensin',        // Gasoline
  '2': 'Diesel',
  '3': 'El',            // Electric
  '4': 'Etanol',        // Ethanol/E85
  '5': 'Hybrid',
  '6': 'Laddhybrid',    // Plug-in Hybrid
  '7': 'Gas',           // Natural gas
  '8': 'Vätgas',        // Hydrogen
};

// Swedish transmission mapping
const TRANSMISSION_MAP: Record<string, string> = {
  '1': 'Manuell',       // Manual
  '2': 'Automat',       // Automatic
};

// Swedish body type mapping
const BODY_TYPE_MAP: Record<string, string> = {
  '1': 'Sedan',
  '2': 'Kombi',         // Station wagon
  '3': 'SUV',
  '4': 'Halvkombi',     // Hatchback
  '5': 'Cab',           // Convertible
  '6': 'Coupe',
  '7': 'Sportvagn',     // Sports car
  '8': 'Pickup',
  '9': 'Minibuss',      // Minivan
  '10': 'Flakbil',      // Flatbed
};

// Approximate SEK to USD rate (should be fetched live in production)
const SEK_TO_USD_RATE = 0.095;

// ============================================================================
// CONVERSION FUNCTIONS
// ============================================================================

/**
 * Convert Swedish "mil" to kilometers
 * 1 Swedish mil = 10 km
 */
function milToKm(mil: number): number {
  return mil * 10;
}

/**
 * Convert kilometers to miles
 */
function kmToMiles(km: number): number {
  return Math.round(km * 0.621371);
}

/**
 * Convert SEK to USD (approximate)
 */
function sekToUsd(sek: number): number {
  return Math.round(sek * SEK_TO_USD_RATE);
}

// ============================================================================
// FETCH FUNCTIONS
// ============================================================================

async function fetchBlocketPage(url: string): Promise<{ html: string; source: string }> {
  console.log(`[blocket] Fetching: ${url}`);

  // Try direct fetch first (FREE)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const html = await response.text();
      // Verify we got valid content
      if (html.includes('blocket.se') && (html.includes('seoStructuredData') || html.includes('advertising-initial-state'))) {
        console.log(`[blocket] Direct fetch SUCCESS (${html.length} bytes)`);
        return { html, source: 'direct' };
      }
      console.log(`[blocket] Direct fetch missing expected data, trying Firecrawl...`);
    } else if (response.status === 403 || response.status === 429) {
      console.log(`[blocket] Rate limited (HTTP ${response.status}), trying Firecrawl...`);
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.log(`[blocket] Direct fetch timeout, trying Firecrawl...`);
    } else {
      console.log(`[blocket] Direct fetch failed: ${err.message}, trying Firecrawl...`);
    }
  }

  // Fallback to Firecrawl
  console.log(`[blocket] Fetching via Firecrawl: ${url}`);

  const result = await firecrawlScrape({
    url,
    formats: ['html'],
    onlyMainContent: false,
    waitFor: 5000,
  });

  if (!result.data.html) {
    throw new Error(`Firecrawl failed: ${result.error || 'No HTML returned'}`);
  }

  return { html: result.data.html, source: 'firecrawl' };
}

// ============================================================================
// EXTRACTION: SEARCH PAGES
// ============================================================================

function extractJsonLd(html: string): any | null {
  // Look for seoStructuredData script tag
  const match = html.match(/<script[^>]*id="seoStructuredData"[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (match && match[1]) {
    try {
      return JSON.parse(match[1].trim());
    } catch (e) {
      console.error('[blocket] Failed to parse JSON-LD:', e);
    }
  }
  return null;
}

function extractSearchResults(html: string, searchUrl: string): SearchResult {
  const jsonLd = extractJsonLd(html);
  const listings: BlocketExtracted[] = [];

  if (jsonLd && jsonLd['@type'] === 'CollectionPage' && jsonLd.mainEntity?.itemListElement) {
    for (const item of jsonLd.mainEntity.itemListElement) {
      const product = item.item;
      if (!product) continue;

      // Parse year/make/model from brand and model fields
      let year: number | null = null;
      let make: string | null = null;
      let model: string | null = null;

      // Brand name often includes "Make Model" like "Ferrari 296 GTB"
      const brandName = product.brand?.name || '';
      const productModel = product.model || '';

      // Extract year from description if present (often has "YYYY" pattern)
      const yearMatch = product.description?.match(/\b(19|20)\d{2}\b/) ||
                       product.name?.match(/\b(19|20)\d{2}\b/);
      if (yearMatch) {
        year = parseInt(yearMatch[0]);
      }

      // Parse make from brand name (first word usually)
      const brandParts = brandName.split(' ');
      make = brandParts[0] || null;

      // Model is either explicit or remaining parts of brand name
      model = productModel || brandParts.slice(1).join(' ') || null;

      // Extract listing ID from URL
      const urlMatch = product.url?.match(/\/item\/(\d+)/);
      const listingId = urlMatch ? urlMatch[1] : '';

      // Parse price
      const priceSek = product.offers?.price ? parseInt(product.offers.price) : null;

      // Extract description
      const description = product.description || null;

      const listing: BlocketExtracted = {
        url: product.url || '',
        listing_id: listingId,
        title: product.name || null,
        year,
        make,
        model,
        vin: null,  // Not available in search results
        registration_number: null,
        mileage_mil: null,  // Need to fetch individual page
        mileage_km: null,
        mileage_miles: null,
        fuel_type: null,
        transmission: null,
        body_style: null,
        horsepower: null,
        price_sek: priceSek,
        price_usd: priceSek ? sekToUsd(priceSek) : null,
        location: null,
        county: null,
        municipality: null,
        zipcode: null,
        seller_type: 'unknown',
        seller_id: null,
        seller_name: null,
        description,
        image_urls: product.image ? [product.image] : [],
        listing_status: product.offers?.availability === 'https://schema.org/InStock' ? 'active' : 'unknown',
        extracted_at: new Date().toISOString(),
      };

      listings.push(listing);
    }
  }

  // Extract total count from page
  const countMatch = html.match(/(\d+)\s*(?:bilar|annonser|result)/i);
  const totalCount = countMatch ? parseInt(countMatch[1]) : listings.length;

  // Check for pagination
  const currentPage = 1; // TODO: Parse from URL
  const hasMore = listings.length >= 40; // Blocket shows ~40 per page
  const nextUrl = hasMore ? null : null; // TODO: Build next page URL

  return {
    listings,
    total_count: totalCount,
    page: currentPage,
    has_more: hasMore,
    next_url: nextUrl,
  };
}

// ============================================================================
// EXTRACTION: SINGLE LISTING
// ============================================================================

function extractAdvertisingData(html: string): any | null {
  // Look for advertising-initial-state script tag
  const match = html.match(/<script[^>]*id="advertising-initial-state"[^>]*>([\s\S]*?)<\/script>/i);
  if (match && match[1]) {
    try {
      return JSON.parse(match[1].trim());
    } catch (e) {
      console.error('[blocket] Failed to parse advertising state:', e);
    }
  }
  return null;
}

function getTargetingValue(targeting: any[], key: string): string | null {
  const item = targeting?.find((t: any) => t.key === key);
  return item?.value?.[0] || null;
}

function getTargetingValues(targeting: any[], key: string): string[] {
  const item = targeting?.find((t: any) => t.key === key);
  return item?.value || [];
}

function extractSingleListing(html: string, url: string): BlocketExtracted {
  const adState = extractAdvertisingData(html);
  const targeting = adState?.config?.adServer?.gam?.targeting || [];

  // Extract listing ID from URL
  const urlMatch = url.match(/\/item\/(\d+)/);
  const listingId = urlMatch ? urlMatch[1] : getTargetingValue(targeting, 'id') || '';

  // Basic info from targeting
  const makeText = getTargetingValue(targeting, 'make_text');
  const modelText = getTargetingValue(targeting, 'model_text');
  const yearStr = getTargetingValue(targeting, 'year');
  const year = yearStr ? parseInt(yearStr) : null;

  // Price
  const priceStr = getTargetingValue(targeting, 'price');
  const priceSek = priceStr ? parseInt(priceStr) : null;

  // Mileage (in mil)
  const mileageStr = getTargetingValue(targeting, 'mileage');
  const mileageMil = mileageStr ? parseInt(mileageStr) : null;
  const mileageKm = mileageMil ? milToKm(mileageMil) : null;
  const mileageMiles = mileageKm ? kmToMiles(mileageKm) : null;

  // Fuel type
  const fuelCode = getTargetingValue(targeting, 'fuel');
  const fuelType = fuelCode ? (FUEL_TYPE_MAP[fuelCode] || `fuel_${fuelCode}`) : null;

  // Transmission
  const transCode = getTargetingValue(targeting, 'transmission');
  const transmission = transCode ? (TRANSMISSION_MAP[transCode] || `trans_${transCode}`) : null;

  // Body type
  const bodyCode = getTargetingValue(targeting, 'body_type');
  const bodyStyle = bodyCode ? (BODY_TYPE_MAP[bodyCode] || `body_${bodyCode}`) : null;

  // Location
  const zipcode = getTargetingValue(targeting, 'zipcode');

  // Seller
  const ownerType = getTargetingValue(targeting, 'owner_type');
  const sellerType: 'private' | 'professional' | 'unknown' =
    ownerType === 'professional' ? 'professional' :
    ownerType === 'private' ? 'private' : 'unknown';
  const sellerId = getTargetingValue(targeting, 'org_id');

  // Registration number
  const regNumber = getTargetingValue(targeting, 'registration_number');

  // Images from targeting
  const imageUrls = getTargetingValues(targeting, 'images');

  // Build title
  const title = `${year || ''} ${makeText || ''} ${modelText || ''}`.trim() || null;

  // Extract description from meta tag
  let description: string | null = null;
  const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
  if (descMatch) {
    description = descMatch[1]
      .replace(/&#43;/g, '+')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .trim();
  }

  // Extract horsepower from title or description
  let horsepower: number | null = null;
  const hpMatch = (title + ' ' + (description || '')).match(/(\d+)\s*(?:hk|hp|hästkrafter)/i);
  if (hpMatch) {
    horsepower = parseInt(hpMatch[1]);
  }

  return {
    url,
    listing_id: listingId,
    title,
    year,
    make: makeText,
    model: modelText,
    vin: null,  // Would need to scrape deeper
    registration_number: regNumber,
    mileage_mil: mileageMil,
    mileage_km: mileageKm,
    mileage_miles: mileageMiles,
    fuel_type: fuelType,
    transmission,
    body_style: bodyStyle,
    horsepower,
    price_sek: priceSek,
    price_usd: priceSek ? sekToUsd(priceSek) : null,
    location: null,
    county: null,
    municipality: null,
    zipcode,
    seller_type: sellerType,
    seller_id: sellerId,
    seller_name: null,
    description,
    image_urls: imageUrls,
    listing_status: 'active',
    extracted_at: new Date().toISOString(),
  };
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

async function findExistingVehicle(
  supabase: any,
  listing: BlocketExtracted
): Promise<{ id: string; matchType: 'url' | 'reg' | 'ymm' } | null> {
  // Match by discovery_url
  const { data: urlMatch } = await supabase
    .from('vehicles')
    .select('id')
    .eq('discovery_url', listing.url)
    .limit(1)
    .single();
  if (urlMatch) return { id: urlMatch.id, matchType: 'url' };

  // Match by registration number (Swedish plates)
  if (listing.registration_number) {
    const { data: regMatch } = await supabase
      .from('vehicles')
      .select('id')
      .eq('license_plate', listing.registration_number)
      .limit(1)
      .single();
    if (regMatch) return { id: regMatch.id, matchType: 'reg' };
  }

  // Match by year/make/model (fuzzy, only if we have all three)
  if (listing.year && listing.make && listing.model) {
    const { data: ymmMatch } = await supabase
      .from('vehicles')
      .select('id')
      .eq('year', listing.year)
      .ilike('make', listing.make)
      .ilike('model', `%${listing.model}%`)
      .is('discovery_url', null)
      .limit(1)
      .single();
    if (ymmMatch) return { id: ymmMatch.id, matchType: 'ymm' };
  }

  return null;
}

async function saveVehicle(
  supabase: any,
  listing: BlocketExtracted,
  vehicleId?: string
): Promise<string> {
  const vehicleData = {
    year: listing.year,
    make: listing.make,
    model: listing.model,
    vin: listing.vin,
    license_plate: listing.registration_number,
    mileage: listing.mileage_km,  // Store in km
    fuel_type: listing.fuel_type,
    transmission: listing.transmission,
    body_style: listing.body_style,
    horsepower: listing.horsepower,
    description: listing.description,
    // Auction/sale data
    sale_price: listing.price_sek ? Math.round(listing.price_sek * SEK_TO_USD_RATE) : null, // Convert to USD
    sale_status: listing.listing_status === 'sold' ? 'sold' : 'available',
    // Discovery metadata
    discovery_url: listing.url,
    discovery_source: 'blocket',
    listing_source: 'blocket_extract',
    profile_origin: 'blocket_import',
    is_public: true,
  };

  if (vehicleId) {
    // Update existing
    const { error } = await supabase
      .from('vehicles')
      .update(vehicleData)
      .eq('id', vehicleId);
    if (error) throw new Error(`Failed to update vehicle: ${error.message}`);
    return vehicleId;
  } else {
    // Insert new
    const { data, error } = await supabase
      .from('vehicles')
      .insert(vehicleData)
      .select('id')
      .single();
    if (error) throw new Error(`Failed to insert vehicle: ${error.message}`);
    return data.id;
  }
}

async function saveImages(
  supabase: any,
  vehicleId: string,
  imageUrls: string[]
): Promise<number> {
  if (imageUrls.length === 0) return 0;

  // Delete existing blocket images for this vehicle
  await supabase
    .from('vehicle_images')
    .delete()
    .eq('vehicle_id', vehicleId)
    .eq('source', 'blocket');

  const imageRecords = imageUrls.slice(0, 50).map((imgUrl, i) => ({
    vehicle_id: vehicleId,
    image_url: imgUrl,
    source: 'blocket',
    source_url: imgUrl,
    is_external: true,
    approval_status: 'auto_approved',
    is_approved: true,
    redaction_level: 'none',
    position: i,
    display_order: i,
    is_primary: i === 0,
  }));

  const { data, error } = await supabase
    .from('vehicle_images')
    .insert(imageRecords)
    .select('id');

  if (error) {
    console.error('[blocket] Image save error:', error);
    return 0;
  }

  return data?.length || 0;
}

async function saveExternalListing(
  supabase: any,
  vehicleId: string,
  listing: BlocketExtracted
): Promise<boolean> {
  const listingUrlKey = normalizeListingUrlKey(listing.url);

  const listingData = {
    vehicle_id: vehicleId,
    platform: 'blocket',
    listing_url: listing.url,
    listing_url_key: listingUrlKey,
    listing_id: listing.listing_id,
    listing_status: listing.listing_status,
    final_price: listing.price_sek,  // Store original SEK price
    metadata: {
      price_sek: listing.price_sek,
      price_usd: listing.price_usd,
      mileage_mil: listing.mileage_mil,
      mileage_km: listing.mileage_km,
      seller_type: listing.seller_type,
      seller_id: listing.seller_id,
      registration_number: listing.registration_number,
      horsepower: listing.horsepower,
      fuel_type: listing.fuel_type,
      transmission: listing.transmission,
      body_style: listing.body_style,
      zipcode: listing.zipcode,
    },
  };

  // Check if exists first
  const { data: existing } = await supabase
    .from('external_listings')
    .select('id')
    .eq('platform', 'blocket')
    .eq('listing_url_key', listingUrlKey)
    .limit(1)
    .single();

  if (existing) {
    // Update existing
    const { error } = await supabase
      .from('external_listings')
      .update(listingData)
      .eq('id', existing.id);

    if (error) {
      console.error('[blocket] External listing update error:', error);
      return false;
    }
  } else {
    // Insert new
    const { error } = await supabase
      .from('external_listings')
      .insert(listingData);

    if (error) {
      console.error('[blocket] External listing insert error:', error);
      return false;
    }
  }

  return true;
}

// ============================================================================
// URL DETECTION
// ============================================================================

function isSearchUrl(url: string): boolean {
  return url.includes('/mobility/search/') || url.includes('?');
}

function isListingUrl(url: string): boolean {
  return url.includes('/mobility/item/') || url.match(/\/item\/\d+/) !== null;
}

// ============================================================================
// MAIN EXTRACTION
// ============================================================================

async function extractBlocket(
  url: string,
  options: {
    save_to_db?: boolean;
    vehicle_id?: string;
    max_pages?: number;
  } = {}
): Promise<{
  type: 'listing' | 'search';
  listing?: BlocketExtracted;
  search_results?: SearchResult;
  fetch_source: string;
}> {
  const { html, source } = await fetchBlocketPage(url);

  if (isSearchUrl(url)) {
    // Search page extraction
    const searchResults = extractSearchResults(html, url);
    console.log(`[blocket] Extracted ${searchResults.listings.length} listings from search`);
    return { type: 'search', search_results: searchResults, fetch_source: source };
  } else {
    // Single listing extraction
    const listing = extractSingleListing(html, url);
    console.log(`[blocket] Extracted listing: ${listing.title}`);
    return { type: 'listing', listing, fetch_source: source };
  }
}

// ============================================================================
// HTTP HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url, save_to_db, vehicle_id, max_pages, extract_details } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate URL
    if (!url.includes('blocket.se')) {
      return new Response(
        JSON.stringify({ error: 'Invalid Blocket.se URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[blocket] Extracting: ${url}`);
    const result = await extractBlocket(url, { save_to_db, vehicle_id, max_pages });

    let dbResults: any = null;

    if (save_to_db || vehicle_id) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );

      if (result.type === 'listing' && result.listing) {
        // Save single listing
        const listing = result.listing;

        // Find existing or use provided vehicle_id
        let targetVehicleId = vehicle_id;
        if (!targetVehicleId) {
          const existing = await findExistingVehicle(supabase, listing);
          if (existing) {
            console.log(`[blocket] Found existing vehicle ${existing.id} via ${existing.matchType}`);
            targetVehicleId = existing.id;
          }
        }

        // Save vehicle
        targetVehicleId = await saveVehicle(supabase, listing, targetVehicleId);
        listing.vehicle_id = targetVehicleId;
        console.log(`[blocket] Saved vehicle: ${targetVehicleId}`);

        // Save images
        const imagesSaved = await saveImages(supabase, targetVehicleId, listing.image_urls);
        console.log(`[blocket] Saved ${imagesSaved} images`);

        // Save external listing
        await saveExternalListing(supabase, targetVehicleId, listing);

        dbResults = {
          vehicle_id: targetVehicleId,
          images_saved: imagesSaved,
          external_listing_saved: true,
        };

      } else if (result.type === 'search' && result.search_results && extract_details) {
        // Optionally extract details for each listing
        const savedListings: string[] = [];

        for (const listing of result.search_results.listings.slice(0, 10)) { // Limit to 10
          try {
            // Fetch full details
            const { listing: fullListing } = await extractBlocket(listing.url, {});
            if (fullListing) {
              // Find existing
              const existing = await findExistingVehicle(supabase, fullListing);
              const targetId = existing?.id;

              const vehicleId = await saveVehicle(supabase, fullListing, targetId);
              await saveImages(supabase, vehicleId, fullListing.image_urls);
              await saveExternalListing(supabase, vehicleId, fullListing);

              savedListings.push(vehicleId);
              console.log(`[blocket] Saved listing ${listing.listing_id} as vehicle ${vehicleId}`);
            }

            // Rate limit
            await new Promise(resolve => setTimeout(resolve, 1500));
          } catch (err: any) {
            console.error(`[blocket] Failed to extract ${listing.url}: ${err.message}`);
          }
        }

        dbResults = {
          vehicles_saved: savedListings.length,
          vehicle_ids: savedListings,
        };
      }
    }

    // Log results
    if (result.type === 'listing' && result.listing) {
      const l = result.listing;
      console.log(`=== BLOCKET EXTRACTION RESULTS ===`);
      console.log(`Title: ${l.title}`);
      console.log(`Year/Make/Model: ${l.year} ${l.make} ${l.model}`);
      console.log(`Price: ${l.price_sek?.toLocaleString()} SEK (~$${l.price_usd?.toLocaleString()} USD)`);
      console.log(`Mileage: ${l.mileage_mil} mil (${l.mileage_km} km / ${l.mileage_miles} mi)`);
      console.log(`Fuel: ${l.fuel_type} | Trans: ${l.transmission} | Body: ${l.body_style}`);
      console.log(`HP: ${l.horsepower || 'N/A'}`);
      console.log(`Reg: ${l.registration_number || 'N/A'}`);
      console.log(`Seller: ${l.seller_type} (ID: ${l.seller_id || 'N/A'})`);
      console.log(`Images: ${l.image_urls.length}`);
    } else if (result.type === 'search' && result.search_results) {
      console.log(`=== BLOCKET SEARCH RESULTS ===`);
      console.log(`Total listings: ${result.search_results.total_count}`);
      console.log(`Extracted: ${result.search_results.listings.length}`);
      console.log(`Has more: ${result.search_results.has_more}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        ...result,
        _db: dbResults,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[blocket] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
