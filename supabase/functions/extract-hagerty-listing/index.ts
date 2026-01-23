/**
 * HAGERTY MARKETPLACE EXTRACTOR
 *
 * Extracts ALL available data from a Hagerty Marketplace auction listing.
 * Hagerty uses Next.js with __NEXT_DATA__ containing the full auction state.
 *
 * Data sources:
 * - props.pageProps.auction - Main auction object
 * - props.pageProps.auction.auctionItems[0] - Vehicle details
 * - props.pageProps.auction.profile - Seller info
 *
 * Prices are stored in CENTS - we convert to dollars.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { firecrawlScrape } from '../_shared/firecrawl.ts';
import { normalizeListingUrlKey } from '../_shared/listingUrl.ts';

// ============================================================================
// TYPES
// ============================================================================

interface HagertyExtracted {
  // Source
  url: string;
  listing_uuid: string;

  // Vehicle basics
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;

  // Specs
  mileage: number | null;
  mileage_unit: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  transmission: string | null;
  engine: string | null;
  drivetrain: string | null;
  body_style: string | null;
  vehicle_type: string | null;

  // Auction data
  status: 'active' | 'ended' | 'sold' | 'unsold' | 'unknown';
  current_bid: number | null;
  next_min_bid: number | null;
  sale_price: number | null;
  bid_count: number;
  view_count: number;
  comment_count: number;
  like_count: number;
  has_reserve: boolean;
  reserve_met: boolean | null;
  auction_start: string | null;
  auction_end: string | null;

  // Seller
  seller_id: string | null;
  seller_username: string | null;
  seller_slug: string | null;
  seller_verified: boolean;
  seller_is_specialist: boolean;

  // Buyer (if sold)
  buyer_id: string | null;
  buyer_username: string | null;

  // Content
  description: string | null;
  highlights: string[];
  image_urls: string[];

  // Hagerty-specific
  hagerty_condition_rating: number | null;
  hagerty_valuation: number | null;
  lot_number: string | null;

  // Location & Origin
  location: string | null;
  origin: string | null;  // "American", "European", etc.
  decade: string | null;  // "1950", "1960", etc.

  // Media
  video_urls: { url: string; caption: string | null }[];
  document_urls: string[];

  // Real-time
  websocket_channel: string | null;

  // Timestamps
  listing_created_at: string | null;
  listing_updated_at: string | null;

  // Internal
  vehicle_id?: string;
  raw_auction_data?: any;
}

// ============================================================================
// VIN EXTRACTION (reused patterns)
// ============================================================================

const VIN_PATTERNS = [
  /\b([1-5][A-HJ-NPR-Z0-9]{16})\b/g,
  /\b(J[A-HJ-NPR-Z0-9]{16})\b/g,
  /\b(K[A-HJ-NPR-Z0-9]{16})\b/g,
  /\b(L[A-HJ-NPR-Z0-9]{16})\b/g,
  /\b(S[A-HJ-NPR-Z0-9]{16})\b/g,
  /\b(W[A-HJ-NPR-Z0-9]{16})\b/g,
  /\b(Y[A-HJ-NPR-Z0-9]{16})\b/g,
  /\b(Z[A-HJ-NPR-Z0-9]{16})\b/g,
  /\b(WP0[A-Z0-9]{14})\b/g,
  /\b(WDB[A-Z0-9]{14})\b/g,
  /\b(WVW[A-Z0-9]{14})\b/g,
  /\b(WBA[A-Z0-9]{14})\b/g,
  /\b(WAU[A-Z0-9]{14})\b/g,
  /\b(ZFF[A-Z0-9]{14})\b/g,
  /\b(ZAM[A-Z0-9]{14})\b/g,
  /\b(SCFZ[A-Z0-9]{13})\b/g,
  /\b(SAJ[A-Z0-9]{14})\b/g,
  /\b(SAL[A-Z0-9]{14})\b/g,
];

function extractVinFromText(text: string): string | null {
  for (const pattern of VIN_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      const counts: Record<string, number> = {};
      for (const m of matches) {
        counts[m] = (counts[m] || 0) + 1;
      }
      return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    }
  }
  return null;
}

// ============================================================================
// NEXT.JS DATA EXTRACTION
// ============================================================================

function extractNextData(html: string): any | null {
  // Try multiple patterns for __NEXT_DATA__ (attribute order can vary)
  const patterns = [
    /<script\s+id="__NEXT_DATA__"\s+type="application\/json"[^>]*>([\s\S]+?)<\/script>/i,
    /<script\s+type="application\/json"\s+id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/i,
    /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      try {
        const data = JSON.parse(match[1].trim());
        console.log(`[hagerty] Successfully parsed __NEXT_DATA__ (${match[1].length} chars)`);
        return data;
      } catch (e) {
        console.error('[hagerty] Failed to parse __NEXT_DATA__ JSON:', e);
        // Continue to next pattern
      }
    }
  }

  console.error('[hagerty] __NEXT_DATA__ not found in HTML');

  // Debug: log a snippet of the HTML to help diagnose
  const scriptTags = html.match(/<script[^>]*>/gi) || [];
  console.log(`[hagerty] Found ${scriptTags.length} script tags`);
  const nextDataTag = scriptTags.find(t => t.includes('__NEXT_DATA__'));
  if (nextDataTag) {
    console.log(`[hagerty] Found __NEXT_DATA__ tag: ${nextDataTag}`);
  }

  return null;
}

// ============================================================================
// CONTENT EXTRACTION (Contentful rich text)
// ============================================================================

function extractPlainText(contentfulNode: any): string {
  if (!contentfulNode) return '';

  if (typeof contentfulNode === 'string') return contentfulNode;

  if (contentfulNode.nodeType === 'text') {
    return contentfulNode.value || '';
  }

  if (contentfulNode.content && Array.isArray(contentfulNode.content)) {
    return contentfulNode.content.map(extractPlainText).join('\n');
  }

  return '';
}

// ============================================================================
// MAIN EXTRACTION LOGIC
// ============================================================================

function extractFromNextData(nextData: any, url: string): HagertyExtracted {
  // Hagerty has nested pageProps - try both paths
  let auction = nextData?.props?.pageProps?.pageProps?.auction;
  if (!auction) {
    auction = nextData?.props?.pageProps?.auction;
  }

  if (!auction) {
    // Log available paths for debugging
    const keys = Object.keys(nextData?.props?.pageProps || {});
    console.error(`[hagerty] No auction data. Available keys in pageProps: ${keys.join(', ')}`);
    throw new Error('No auction data found in __NEXT_DATA__');
  }

  const item = auction?.auctionItems?.[0];
  const profile = auction?.profile;
  const winner = auction?.winner;

  // Extract UUID from URL or auction data
  const listingUuid = auction.id || url.split('/').pop() || '';

  // Status mapping
  let status: HagertyExtracted['status'] = 'unknown';
  const rawStatus = (auction.status || '').toUpperCase();
  if (rawStatus === 'ACTIVE' || rawStatus === 'LIVE') {
    status = 'active';
  } else if (rawStatus === 'ENDED' || rawStatus === 'CLOSED') {
    status = auction.soldPrice ? 'sold' : 'unsold';
  } else if (rawStatus === 'SOLD') {
    status = 'sold';
  }

  // Price extraction (Hagerty stores in cents)
  const currentBid = auction.currentHighestBid?.amount
    ? Math.round(auction.currentHighestBid.amount / 100)
    : null;
  const nextMinBid = auction.nextBidMinimumValue?.amount
    ? Math.round(auction.nextBidMinimumValue.amount / 100)
    : null;
  const salePrice = auction.soldPrice?.amount
    ? Math.round(auction.soldPrice.amount / 100)
    : (status === 'sold' && currentBid ? currentBid : null);

  // Vehicle specs from item
  const year = item?.year ? parseInt(item.year, 10) : null;
  const make = item?.make || null;
  const model = item?.model || null;

  // Build title
  const title = [year, make, model].filter(Boolean).join(' ') || auction.title || null;

  // VIN - check multiple locations
  let vin = item?.vin || null;
  if (!vin && item?.description) {
    vin = extractVinFromText(extractPlainText(item.description));
  }

  // Mileage
  const mileage = item?.mileage?.mileage ? parseInt(item.mileage.mileage, 10) : null;
  const mileageUnit = item?.mileage?.mileageUnit || 'MILES';

  // Colors
  const exteriorColor = item?.exteriorColor || item?.color || null;
  const interiorColor = item?.interiorColor || null;

  // Drivetrain/Transmission/Engine
  const transmission = item?.transmission || null;
  const engine = item?.engine || null;
  const drivetrain = item?.drivetrain || null;

  // Body style and type
  const bodyStyle = Array.isArray(item?.bodyStyle) ? item.bodyStyle[0] : (item?.bodyStyle || null);
  const vehicleType = Array.isArray(item?.type) ? item.type[0] : (item?.type || null);

  // Reserve status
  // hasReserve can be true, false, or null (unknown)
  const hasReserve = auction.hasReserve ?? false;  // Default to no reserve if null
  const reserveMet = auction.reserveMet ?? null;

  // Counts
  const bidCount = auction.successfulBidCount || auction.bidCount || 0;
  const viewCount = auction.pageViews || 0;
  const commentCount = auction.comments || 0;
  const likeCount = auction.likes || 0;

  // Dates
  const auctionStart = auction.startDateTime || null;
  const auctionEnd = auction.endDateTime || null;

  // Seller info
  const sellerId = profile?.id || null;
  const sellerUsername = profile?.displayName || null;
  const sellerSlug = profile?.slug || null;
  const sellerVerified = profile?.verified === true;
  const sellerIsSpecialist = profile?.isSpecialist === true;

  // Buyer info (if sold)
  const buyerId = winner?.id || null;
  const buyerUsername = winner?.displayName || null;

  // Description
  const description = item?.description ? extractPlainText(item.description) : null;

  // Highlights (often in a separate field)
  const highlights: string[] = [];
  if (item?.highlights && Array.isArray(item.highlights)) {
    for (const h of item.highlights) {
      const text = typeof h === 'string' ? h : extractPlainText(h);
      if (text) highlights.push(text);
    }
  }

  // Images
  const imageUrls: string[] = [];
  if (item?.images && Array.isArray(item.images)) {
    for (const img of item.images) {
      const imgUrl = img?.url || img?.src || img;
      if (typeof imgUrl === 'string' && imgUrl.includes('imgix.net')) {
        // Remove any resize params to get full resolution
        const cleanUrl = imgUrl.split('?')[0];
        if (!imageUrls.includes(cleanUrl)) {
          imageUrls.push(cleanUrl);
        }
      }
    }
  }

  // Also check for gallery images
  if (auction.gallery && Array.isArray(auction.gallery)) {
    for (const img of auction.gallery) {
      const imgUrl = img?.url || img?.src || img;
      if (typeof imgUrl === 'string' && !imageUrls.includes(imgUrl.split('?')[0])) {
        imageUrls.push(imgUrl.split('?')[0]);
      }
    }
  }

  // Location
  const location = item?.location || auction.location || null;

  // Origin & classification
  const origin = Array.isArray(item?.origin) ? item.origin[0] : (item?.origin || null);
  const decade = Array.isArray(item?.decade) ? item.decade[0] : (item?.decade || null);

  // Hagerty-specific data
  const hagertyConditionRating = item?.conditionRating || auction.conditionRating || null;
  const hagertyValuation = auction.hagertyValue?.amount
    ? Math.round(auction.hagertyValue.amount / 100)
    : null;
  const lotNumber = auction.lotNumber || auction.lotId || null;

  // Videos - IMPORTANT for cross-platform identity linking
  const videoUrls: { url: string; caption: string | null }[] = [];
  if (item?.videoGallery && Array.isArray(item.videoGallery)) {
    for (const video of item.videoGallery) {
      if (video?.url) {
        videoUrls.push({
          url: video.url,
          caption: video.caption || null,
        });
      }
    }
  }

  // Documents
  const documentUrls: string[] = [];
  if (item?.documents && Array.isArray(item.documents)) {
    for (const doc of item.documents) {
      const docUrl = doc?.url || doc;
      if (typeof docUrl === 'string') {
        documentUrls.push(docUrl);
      }
    }
  }

  // Real-time WebSocket channel
  const websocketChannel = auction.channelName || null;

  // Timestamps
  const listingCreatedAt = item?.createdAt || null;
  const listingUpdatedAt = item?.updatedAt || null;

  return {
    url,
    listing_uuid: listingUuid,
    title,
    year,
    make,
    model,
    vin,
    mileage,
    mileage_unit: mileageUnit,
    exterior_color: exteriorColor,
    interior_color: interiorColor,
    transmission,
    engine,
    drivetrain,
    body_style: bodyStyle,
    vehicle_type: vehicleType,
    status,
    current_bid: currentBid,
    next_min_bid: nextMinBid,
    sale_price: salePrice,
    bid_count: bidCount,
    view_count: viewCount,
    comment_count: commentCount,
    like_count: likeCount,
    has_reserve: hasReserve,
    reserve_met: reserveMet,
    auction_start: auctionStart,
    auction_end: auctionEnd,
    seller_id: sellerId,
    seller_username: sellerUsername,
    seller_slug: sellerSlug,
    seller_verified: sellerVerified,
    seller_is_specialist: sellerIsSpecialist,
    buyer_id: buyerId,
    buyer_username: buyerUsername,
    description,
    highlights,
    image_urls: imageUrls,
    hagerty_condition_rating: hagertyConditionRating,
    hagerty_valuation: hagertyValuation,
    lot_number: lotNumber,
    location,
    origin,
    decade,
    video_urls: videoUrls,
    document_urls: documentUrls,
    websocket_channel: websocketChannel,
    listing_created_at: listingCreatedAt,
    listing_updated_at: listingUpdatedAt,
  };
}

// ============================================================================
// FETCH PAGE
// ============================================================================

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

async function fetchHagertyPage(url: string): Promise<{ html: string; source: string }> {
  // Try direct fetch first (FREE) - Hagerty SSRs their pages, no JS needed
  console.log(`[hagerty] Trying direct fetch: ${url}`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const html = await response.text();
      // Verify we got the __NEXT_DATA__
      if (html.includes('__NEXT_DATA__')) {
        console.log(`[hagerty] Direct fetch SUCCESS (${html.length} bytes)`);
        return { html, source: 'direct' };
      }
      console.log(`[hagerty] Direct fetch missing __NEXT_DATA__, trying Firecrawl...`);
    } else if (response.status === 403 || response.status === 429) {
      console.log(`[hagerty] Rate limited (HTTP ${response.status}), trying Firecrawl...`);
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.log(`[hagerty] Direct fetch timeout, trying Firecrawl...`);
    } else {
      console.log(`[hagerty] Direct fetch failed: ${err.message}, trying Firecrawl...`);
    }
  }

  // Fallback to Firecrawl
  console.log(`[hagerty] Fetching via Firecrawl: ${url}`);

  const result = await firecrawlScrape({
    url,
    formats: ['html'],
    onlyMainContent: false,
    waitFor: 3000,
  });

  if (!result.data.html) {
    throw new Error(`Firecrawl failed: ${result.error || 'No HTML returned'}`);
  }

  return { html: result.data.html, source: 'firecrawl' };
}

// ============================================================================
// MAIN EXTRACTION FUNCTION
// ============================================================================

async function extractHagertyListing(url: string): Promise<{ extracted: HagertyExtracted; fetchSource: string }> {
  // Validate URL
  if (!url.includes('hagerty.com/marketplace')) {
    throw new Error('Invalid Hagerty Marketplace URL');
  }

  // Fetch page
  const { html, source } = await fetchHagertyPage(url);

  // Extract __NEXT_DATA__
  const nextData = extractNextData(html);
  if (!nextData) {
    throw new Error('Failed to extract __NEXT_DATA__ from page');
  }

  // Parse auction data
  const extracted = extractFromNextData(nextData, url);

  // Store raw data for debugging (optional, can be disabled)
  // extracted.raw_auction_data = nextData?.props?.pageProps?.auction;

  return { extracted, fetchSource: source };
}

// ============================================================================
// HTTP HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url, save_to_db, vehicle_id, include_raw } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[hagerty] Extracting: ${url}`);
    const { extracted, fetchSource } = await extractHagertyListing(url);

    // Log results
    console.log(`=== HAGERTY EXTRACTION RESULTS ===`);
    console.log(`Title: ${extracted.title}`);
    console.log(`Year/Make/Model: ${extracted.year} ${extracted.make} ${extracted.model}`);
    console.log(`VIN: ${extracted.vin || 'NOT FOUND'}`);
    console.log(`Status: ${extracted.status}`);
    console.log(`Current Bid: $${extracted.current_bid?.toLocaleString() || 'N/A'}`);
    console.log(`Sale Price: $${extracted.sale_price?.toLocaleString() || 'N/A'}`);
    console.log(`Bids: ${extracted.bid_count} | Views: ${extracted.view_count}`);
    console.log(`Seller: @${extracted.seller_username || 'N/A'} (verified: ${extracted.seller_verified})`);
    console.log(`Reserve: ${extracted.has_reserve ? 'Yes' : 'No Reserve'}`);
    console.log(`Images: ${extracted.image_urls.length}`);
    console.log(`Fetch source: ${fetchSource}`);

    // Track DB operation results
    const dbErrors: string[] = [];
    let imagesSaved = 0;
    let externalListingSaved = false;
    let identitiesSaved: string[] = [];

    // Save to database if requested
    if (save_to_db || vehicle_id) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );

      let targetVehicleId = vehicle_id;

      if (vehicle_id) {
        // Update existing vehicle
        const { error: updateError } = await supabase
          .from('vehicles')
          .update({
            year: extracted.year,
            make: extracted.make,
            model: extracted.model,
            vin: extracted.vin || undefined,
            mileage: extracted.mileage,
            color: extracted.exterior_color,
            interior_color: extracted.interior_color,
            transmission: extracted.transmission,
            engine_type: extracted.engine,
            drivetrain: extracted.drivetrain,
            body_style: extracted.body_style,
            description: extracted.description,
            sale_price: extracted.sale_price,
            high_bid: extracted.current_bid,
            sale_status: extracted.status === 'sold' ? 'sold' : (extracted.status === 'active' ? 'available' : 'ended'),
          })
          .eq('id', vehicle_id);

        if (updateError) throw new Error(`Failed to update vehicle: ${updateError.message}`);
        console.log(`[hagerty] Updated vehicle: ${vehicle_id}`);
        extracted.vehicle_id = vehicle_id;
      } else {
        // Insert new vehicle
        const { data, error } = await supabase
          .from('vehicles')
          .insert({
            year: extracted.year,
            make: extracted.make,
            model: extracted.model,
            vin: extracted.vin,
            mileage: extracted.mileage,
            color: extracted.exterior_color,
            interior_color: extracted.interior_color,
            transmission: extracted.transmission,
            engine_type: extracted.engine,
            drivetrain: extracted.drivetrain,
            body_style: extracted.body_style,
            description: extracted.description,
            sale_price: extracted.sale_price,
            high_bid: extracted.current_bid,
            listing_source: 'hagerty_extract',
            profile_origin: 'hagerty_import',
            discovery_url: extracted.url,
            discovery_source: 'hagerty',
            is_public: true,
            sale_status: extracted.status === 'sold' ? 'sold' : (extracted.status === 'active' ? 'available' : 'ended'),
          })
          .select()
          .single();

        if (error) throw new Error(`Failed to insert vehicle: ${error.message}`);
        console.log(`[hagerty] Created vehicle: ${data.id}`);
        extracted.vehicle_id = data.id;
        targetVehicleId = data.id;
      }

      // Save images - must satisfy vehicle_images_attribution_check
      // Use source='external_import' and include required fields
      if (extracted.image_urls.length > 0 && targetVehicleId) {
        const imageRecords = extracted.image_urls.slice(0, 100).map((img_url, i) => ({
          vehicle_id: targetVehicleId,
          image_url: img_url,
          source: 'external_import',  // Required for attribution check
          source_url: img_url,
          is_external: true,
          approval_status: 'auto_approved',
          is_approved: true,
          redaction_level: 'none',
          position: i,
          display_order: i,
          is_primary: i === 0,
          exif_data: {
            source_url: extracted.url,
            discovery_url: extracted.url,
            imported_from: 'hagerty',
          },
        }));

        // Delete existing external_import images for this vehicle to avoid duplicates
        await supabase
          .from('vehicle_images')
          .delete()
          .eq('vehicle_id', targetVehicleId)
          .eq('source', 'external_import');

        const { data: insertedImages, error: imgError } = await supabase
          .from('vehicle_images')
          .insert(imageRecords)
          .select('id');

        if (imgError) {
          console.error('[hagerty] Image save error:', JSON.stringify(imgError));
          dbErrors.push(`images: ${imgError.message || JSON.stringify(imgError)}`);
        } else {
          imagesSaved = insertedImages?.length || 0;
          console.log(`[hagerty] Saved ${imagesSaved} images for vehicle ${targetVehicleId}`);
        }
      }

      // Create/update external_listings record
      if (targetVehicleId) {
        const listingUrlKey = normalizeListingUrlKey(extracted.url);
        console.log(`[hagerty] Creating external_listing with url_key: ${listingUrlKey}`);

        const { data: listingData, error: listingError } = await supabase
          .from('external_listings')
          .insert({
            vehicle_id: targetVehicleId,
            platform: 'hagerty',
            listing_url: extracted.url,
            listing_url_key: listingUrlKey,
            listing_id: extracted.listing_uuid,
            listing_status: extracted.status,
            end_date: extracted.auction_end ? extracted.auction_end.split('T')[0] : null,
            final_price: extracted.sale_price,
            bid_count: extracted.bid_count,
            view_count: extracted.view_count,
            sold_at: extracted.status === 'sold' && extracted.auction_end ? extracted.auction_end : null,
            metadata: {
              lot_number: extracted.lot_number,
              seller_username: extracted.seller_username,
              seller_slug: extracted.seller_slug,
              seller_verified: extracted.seller_verified,
              buyer_username: extracted.buyer_username,
              has_reserve: extracted.has_reserve,
              reserve_met: extracted.reserve_met,
              hagerty_valuation: extracted.hagerty_valuation,
              like_count: extracted.like_count,
              comment_count: extracted.comment_count,
              video_urls: extracted.video_urls,
              websocket_channel: extracted.websocket_channel,
            },
          })
          .select()
          .single();

        if (listingError) {
          console.error('[hagerty] External listing save error:', JSON.stringify(listingError));
          dbErrors.push(`external_listing: ${listingError.message || JSON.stringify(listingError)}`);
        } else {
          externalListingSaved = true;
          console.log(`[hagerty] Created external_listings record: ${listingData?.id}`);
        }
      }

      // Save seller/buyer to external_identities
      if (extracted.seller_username || extracted.buyer_username) {
        const nowIso = new Date().toISOString();
        const identitiesToUpsert = [];

        // Seller identity
        if (extracted.seller_username) {
          identitiesToUpsert.push({
            platform: 'hagerty',
            handle: extracted.seller_username,
            display_name: extracted.seller_username,
            profile_url: extracted.seller_slug
              ? `https://www.hagerty.com/marketplace/profile/${extracted.seller_slug}`
              : null,
            metadata: {
              seller_id: extracted.seller_id,
              slug: extracted.seller_slug,
              is_specialist: extracted.seller_is_specialist,
              is_verified: extracted.seller_verified,
              first_seen_listing: extracted.url,
            },
            first_seen_at: nowIso,
            last_seen_at: nowIso,
            updated_at: nowIso,
          });
        }

        // Buyer identity (if sold)
        if (extracted.buyer_username && extracted.status === 'sold') {
          identitiesToUpsert.push({
            platform: 'hagerty',
            handle: extracted.buyer_username,
            display_name: extracted.buyer_username,
            profile_url: null,
            metadata: {
              buyer_id: extracted.buyer_id,
              first_seen_as_buyer: extracted.url,
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
            console.error('[hagerty] External identity save error:', JSON.stringify(identityError));
            dbErrors.push(`external_identities: ${identityError.message || JSON.stringify(identityError)}`);
          } else {
            for (const id of upsertedIdentities || []) {
              identitiesSaved.push(id.handle);
            }
            console.log(`[hagerty] Saved ${identitiesSaved.length} external identities: ${identitiesSaved.join(', ')}`);
          }
        }
      }

      // Add timeline events
      if (targetVehicleId && extracted.auction_end) {
        const events = [];

        // Listing event
        if (extracted.auction_start) {
          events.push({
            vehicle_id: targetVehicleId,
            event_type: 'auction_listed',
            event_date: extracted.auction_start.split('T')[0],
            title: `Listed on Hagerty Marketplace`,
            description: `Listed by @${extracted.seller_username || 'seller'}. ${!extracted.has_reserve ? 'No Reserve.' : ''}`,
            source: 'hagerty_import',
            metadata: {
              lot_number: extracted.lot_number,
              seller: extracted.seller_username,
              listing_uuid: extracted.listing_uuid,
            },
          });
        }

        // Sold event
        if (extracted.status === 'sold' && extracted.sale_price) {
          events.push({
            vehicle_id: targetVehicleId,
            event_type: 'auction_sold',
            event_date: extracted.auction_end.split('T')[0],
            title: `Sold for $${extracted.sale_price.toLocaleString()}`,
            description: `Won by @${extracted.buyer_username || 'unknown'} with ${extracted.bid_count} bids. ${extracted.view_count.toLocaleString()} views.`,
            source: 'hagerty_import',
            metadata: {
              lot_number: extracted.lot_number,
              buyer: extracted.buyer_username,
              sale_price: extracted.sale_price,
              bid_count: extracted.bid_count,
              view_count: extracted.view_count,
            },
          });
        }

        if (events.length > 0) {
          await supabase.from('timeline_events').insert(events);
          console.log(`[hagerty] Created ${events.length} timeline events`);
        }
      }
    }

    // Build response
    const response: any = {
      success: true,
      extracted,
      _fetch: { source: fetchSource },
      _db: (save_to_db || vehicle_id) ? {
        vehicle_saved: !!extracted.vehicle_id,
        images_saved: imagesSaved,
        external_listing_saved: externalListingSaved,
        identities_saved: identitiesSaved || [],
        errors: dbErrors,
      } : null,
    };

    if (include_raw) {
      response.raw = extracted.raw_auction_data;
    }

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[hagerty] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
