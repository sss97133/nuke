/**
 * GOODING & COMPANY AUCTION EXTRACTOR
 *
 * Premium collector car auction house - official Pebble Beach auctioneer.
 * Auctions: Pebble Beach, Scottsdale, Amelia Island, Retromobile Paris
 *
 * Data source: Gatsby static site with Contentful CMS
 * - Direct fetch of /page-data/lot/{slug}/page-data.json (NO Firecrawl needed!)
 * - All structured data in JSON format
 * - Images via Cloudinary CDN
 *
 * Supports:
 * - Single lot extraction: POST { url: "https://goodingco.com/lot/..." }
 * - Batch extraction: POST { action: "batch", limit: 100 }
 * - Sitemap discovery: POST { action: "discover" }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { normalizeListingUrlKey } from '../_shared/listingUrl.ts';

// ============================================================================
// TYPES
// ============================================================================

interface GoodingExtracted {
  // Source
  url: string;
  slug: string;
  contentful_id?: string;
  salesforce_id?: string;

  // Vehicle basics
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;

  // Auction data
  lot_number: number | null;
  auction_name: string | null;
  auction_date: string | null;
  auction_location: string | null;
  currency: string;

  // Pricing
  estimate_low: number | null;
  estimate_high: number | null;
  sale_price: number | null;
  has_reserve: boolean;

  // Status
  status: 'upcoming' | 'active' | 'sold' | 'unsold' | 'unknown';

  // Content
  highlights: string[];
  specifications: string[];
  description: string | null;
  vehicle_type: string | null;

  // Images
  image_urls: string[];

  // Metadata
  online_bidding_available: boolean;
  auction_mobility_id: string | null;
}

interface GoodingPageData {
  result: {
    data: {
      contentfulLot: {
        __typename: string;
        lotNumber: number | null;
        lowEstimate: number | null;
        highEstimate: number | null;
        uniqueEstimate: number | null;
        hasReservePrice: boolean | null;
        salePrice: number | null;
        auctionMobilityId: string | null;
        askingPrice: number | null;
        onlineBiddingAvailable: boolean | null;
        title: string | null;
        slug: string;
        description: { raw: string } | null;
        auction: {
          name: string;
          contentful_id: string;
          auctionMobilityId: string | null;
          currency: string;
          subEvents: Array<{
            __typename: string;
            startDate?: string;
          }>;
          activeAuction: boolean;
          location?: {
            address?: {
              addressCountry?: string;
            };
          };
          webpage__auction?: Array<{ slug: string }>;
        };
        item: {
          __typename: string;
          title: string;
          highlights: string[] | null;
          specifications: string[] | null;
          salesForceId: string | null;
          type: string | null;
          make: { name: string } | null;
          modelYear: number | null;
          model: string | null;
          note: string | null;
          cloudinaryImagesCombined: Array<{
            public_id: string;
            height: number;
            width: number;
          }> | null;
          cloudinaryImages1?: Array<{ public_id: string }> | null;
          cloudinaryImages2?: Array<{ public_id: string }> | null;
          cloudinaryImages3?: Array<{ public_id: string }> | null;
        } | null;
      } | null;
    };
  };
}

// ============================================================================
// VIN EXTRACTION
// ============================================================================

const VIN_PATTERNS = [
  /\b([1-5][A-HJ-NPR-Z0-9]{16})\b/g,
  /\b(J[A-HJ-NPR-Z0-9]{16})\b/g,
  /\b(K[A-HJ-NPR-Z0-9]{16})\b/g,
  /\b(S[A-HJ-NPR-Z0-9]{16})\b/g,
  /\b(W[A-HJ-NPR-Z0-9]{16})\b/g,
  /\b(Y[A-HJ-NPR-Z0-9]{16})\b/g,
  /\b(Z[A-HJ-NPR-Z0-9]{16})\b/g,
  /\b(WP0[A-Z0-9]{14})\b/g,
  /\b(WDB[A-Z0-9]{14})\b/g,
  /\b(ZFF[A-Z0-9]{14})\b/g,
];

function extractVinFromText(text: string): string | null {
  for (const pattern of VIN_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      return matches[0];
    }
  }
  return null;
}

// ============================================================================
// CLOUDINARY URL BUILDER
// ============================================================================

const CLOUDINARY_BASE = 'https://media.goodingco.com/image/upload';

function buildCloudinaryUrl(publicId: string, width: number = 1800): string {
  // URL encode the public_id since it may contain spaces
  const encodedId = publicId.split('/').map(encodeURIComponent).join('/');
  return `${CLOUDINARY_BASE}/c_fill,g_auto,q_90,w_${width}/v1/${encodedId}`;
}

// ============================================================================
// EXTRACT FROM PAGE DATA
// ============================================================================

function extractFromPageData(pageData: GoodingPageData, url: string): GoodingExtracted {
  const lot = pageData.result?.data?.contentfulLot;
  if (!lot) {
    throw new Error('No lot data found in page-data.json');
  }

  const item = lot.item;
  const auction = lot.auction;

  // Extract slug from URL
  const slug = url.split('/lot/')[1]?.split('/')[0]?.split('?')[0] || lot.slug;

  // Determine status
  let status: GoodingExtracted['status'] = 'unknown';
  if (lot.salePrice && lot.salePrice > 0) {
    status = 'sold';
  } else if (auction?.activeAuction) {
    status = 'active';
  } else if (auction?.subEvents?.some(e => e.__typename === 'ContentfulSubEventAuction' && e.startDate)) {
    const auctionDate = auction.subEvents.find(e => e.__typename === 'ContentfulSubEventAuction')?.startDate;
    if (auctionDate) {
      const auctionTime = new Date(auctionDate).getTime();
      const now = Date.now();
      if (auctionTime > now) {
        status = 'upcoming';
      } else {
        // Auction passed but no sale price - likely unsold
        status = 'unsold';
      }
    }
  }

  // Collect all images from different cloudinary arrays
  const allImages: string[] = [];
  const seenIds = new Set<string>();

  const addImages = (images: Array<{ public_id: string }> | null | undefined) => {
    if (!images) return;
    for (const img of images) {
      if (img.public_id && !seenIds.has(img.public_id)) {
        seenIds.add(img.public_id);
        allImages.push(buildCloudinaryUrl(img.public_id, 1800));
      }
    }
  };

  addImages(item?.cloudinaryImagesCombined);
  addImages(item?.cloudinaryImages1);
  addImages(item?.cloudinaryImages2);
  addImages(item?.cloudinaryImages3);

  // Get auction date
  let auctionDate: string | null = null;
  const auctionEvent = auction?.subEvents?.find(e => e.__typename === 'ContentfulSubEventAuction');
  if (auctionEvent?.startDate) {
    auctionDate = auctionEvent.startDate.split('T')[0];
  }

  // Strip HTML from highlights
  const cleanHighlights = (item?.highlights || []).map(h =>
    h.replace(/<[^>]+>/g, '').trim()
  ).filter(Boolean);

  // Try to extract VIN from highlights or specifications
  let vin: string | null = null;
  const textToSearch = [
    ...(item?.highlights || []),
    ...(item?.specifications || []),
    item?.note || '',
  ].join(' ');
  vin = extractVinFromText(textToSearch);

  return {
    url: `https://www.goodingco.com/lot/${slug}`,
    slug,
    contentful_id: auction?.contentful_id,
    salesforce_id: item?.salesForceId || undefined,

    title: item?.title || null,
    year: item?.modelYear || null,
    make: item?.make?.name || null,
    model: item?.model || null,
    vin,

    lot_number: lot.lotNumber,
    auction_name: auction?.name || null,
    auction_date: auctionDate,
    auction_location: auction?.location?.address?.addressCountry || null,
    currency: auction?.currency || 'USD',

    estimate_low: lot.lowEstimate,
    estimate_high: lot.highEstimate,
    sale_price: lot.salePrice,
    has_reserve: lot.hasReservePrice ?? true,

    status,

    highlights: cleanHighlights,
    specifications: item?.specifications || [],
    description: item?.note || null,
    vehicle_type: item?.type || null,

    image_urls: allImages,

    online_bidding_available: lot.onlineBiddingAvailable ?? false,
    auction_mobility_id: lot.auctionMobilityId,
  };
}

// ============================================================================
// FETCH PAGE DATA
// ============================================================================

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json,text/html,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function fetchGoodingPageData(url: string): Promise<GoodingPageData> {
  // Extract slug from URL
  let slug = url;
  if (url.includes('goodingco.com')) {
    slug = url.split('/lot/')[1]?.split('/')[0]?.split('?')[0] || '';
  }

  if (!slug) {
    throw new Error('Could not extract lot slug from URL');
  }

  // Fetch the Gatsby page-data.json directly
  const pageDataUrl = `https://www.goodingco.com/page-data/lot/${slug}/page-data.json`;
  console.log(`[gooding] Fetching: ${pageDataUrl}`);

  const response = await fetch(pageDataUrl, {
    headers: BROWSER_HEADERS,
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching page-data.json`);
  }

  const data = await response.json();
  return data as GoodingPageData;
}

// ============================================================================
// SITEMAP DISCOVERY
// ============================================================================

async function discoverLotsFromSitemap(): Promise<string[]> {
  console.log('[gooding] Fetching sitemap...');

  const response = await fetch('https://www.goodingco.com/sitemap.xml', {
    headers: BROWSER_HEADERS,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching sitemap`);
  }

  const xml = await response.text();

  // Extract lot URLs
  const lotUrls: string[] = [];
  const matches = xml.matchAll(/https:\/\/www\.goodingco\.com\/lot\/([^<\s]+)/g);
  for (const match of matches) {
    lotUrls.push(`https://www.goodingco.com/lot/${match[1]}`);
  }

  console.log(`[gooding] Found ${lotUrls.length} lot URLs in sitemap`);
  return lotUrls;
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

async function saveToDatabase(
  supabase: any,
  extracted: GoodingExtracted
): Promise<{ vehicle_id: string; images_saved: number; is_new: boolean }> {
  // Check if we already have this lot
  const listingUrlKey = normalizeListingUrlKey(extracted.url);

  const { data: existingListing } = await supabase
    .from('external_listings')
    .select('vehicle_id')
    .eq('platform', 'gooding')
    .eq('listing_url_key', listingUrlKey)
    .single();

  let vehicleId: string;
  let isNew = false;

  if (existingListing?.vehicle_id) {
    // Update existing vehicle
    vehicleId = existingListing.vehicle_id;

    const { error: updateError } = await supabase
      .from('vehicles')
      .update({
        year: extracted.year,
        make: extracted.make,
        model: extracted.model,
        vin: extracted.vin || undefined,
        sale_price: extracted.sale_price,
        sale_status: extracted.status === 'sold' ? 'sold' : (extracted.status === 'active' ? 'available' : extracted.status),
        updated_at: new Date().toISOString(),
      })
      .eq('id', vehicleId);

    if (updateError) {
      console.error(`[gooding] Failed to update vehicle: ${updateError.message}`);
    }
  } else {
    // Insert new vehicle
    isNew = true;
    const { data: newVehicle, error: insertError } = await supabase
      .from('vehicles')
      .insert({
        year: extracted.year,
        make: extracted.make,
        model: extracted.model,
        vin: extracted.vin,
        sale_price: extracted.sale_price,
        sale_status: extracted.status === 'sold' ? 'sold' : (extracted.status === 'active' ? 'available' : extracted.status),
        listing_source: 'gooding_extract',
        profile_origin: 'gooding_import',
        discovery_url: extracted.url,
        discovery_source: 'gooding',
        is_public: true,
        auction_source: 'gooding',
        notes: extracted.highlights.slice(0, 5).join('\n'),
      })
      .select('id')
      .single();

    if (insertError) {
      throw new Error(`Failed to insert vehicle: ${insertError.message}`);
    }

    vehicleId = newVehicle.id;
  }

  // Update/insert external_listings
  const { error: listingError } = await supabase
    .from('external_listings')
    .upsert({
      vehicle_id: vehicleId,
      platform: 'gooding',
      listing_url: extracted.url,
      listing_url_key: listingUrlKey,
      listing_id: extracted.slug,
      listing_status: extracted.status === 'upcoming' ? 'pending' :
                      extracted.status === 'active' ? 'active' :
                      extracted.status === 'sold' ? 'sold' :
                      extracted.status === 'unsold' ? 'unsold' : 'ended',
      end_date: extracted.auction_date ? new Date(extracted.auction_date).toISOString() : null,
      final_price: extracted.sale_price,
      sold_at: extracted.status === 'sold' && extracted.auction_date
        ? new Date(extracted.auction_date).toISOString()
        : null,
      metadata: {
        lot_number: extracted.lot_number,
        auction_name: extracted.auction_name,
        currency: extracted.currency,
        estimate_low: extracted.estimate_low,
        estimate_high: extracted.estimate_high,
        has_reserve: extracted.has_reserve,
        highlights: extracted.highlights.slice(0, 10),
        specifications: extracted.specifications.slice(0, 20),
        online_bidding: extracted.online_bidding_available,
        auction_mobility_id: extracted.auction_mobility_id,
        salesforce_id: extracted.salesforce_id,
        contentful_id: extracted.contentful_id,
      },
    }, { onConflict: 'platform,listing_url_key' });

  if (listingError) {
    console.error(`[gooding] Failed to upsert external_listing: ${listingError.message}`);
  }

  // Save images
  let imagesSaved = 0;
  if (extracted.image_urls.length > 0) {
    // Delete existing gooding images for this vehicle
    await supabase
      .from('vehicle_images')
      .delete()
      .eq('vehicle_id', vehicleId)
      .eq('source', 'gooding');

    const imageRecords = extracted.image_urls.slice(0, 100).map((imgUrl, i) => ({
      vehicle_id: vehicleId,
      image_url: imgUrl,
      source: 'gooding',
      source_url: imgUrl,
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
        imported_from: 'gooding',
        auction_name: extracted.auction_name,
        lot_number: extracted.lot_number,
      },
    }));

    const { data: insertedImages, error: imgError } = await supabase
      .from('vehicle_images')
      .insert(imageRecords)
      .select('id');

    if (imgError) {
      console.error(`[gooding] Image save error: ${imgError.message}`);
    } else {
      imagesSaved = insertedImages?.length || 0;
    }
  }

  return { vehicle_id: vehicleId, images_saved: imagesSaved, is_new: isNew };
}

// ============================================================================
// BATCH PROCESSING
// ============================================================================

async function processBatch(
  supabase: any,
  urls: string[],
  limit: number
): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  new_vehicles: number;
  errors: Array<{ url: string; error: string }>;
}> {
  const results = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    new_vehicles: 0,
    errors: [] as Array<{ url: string; error: string }>,
  };

  const toProcess = urls.slice(0, limit);
  console.log(`[gooding] Processing ${toProcess.length} lots...`);

  for (const url of toProcess) {
    results.processed++;

    try {
      // Small delay to be respectful
      if (results.processed > 1) {
        await new Promise(r => setTimeout(r, 200));
      }

      const pageData = await fetchGoodingPageData(url);
      const extracted = extractFromPageData(pageData, url);

      // Skip non-vehicle items (memorabilia, signs, etc.)
      if (!extracted.year && !extracted.make) {
        console.log(`[gooding] Skipping non-vehicle: ${url}`);
        continue;
      }

      const dbResult = await saveToDatabase(supabase, extracted);
      results.succeeded++;
      if (dbResult.is_new) {
        results.new_vehicles++;
      }

      console.log(`[gooding] [${results.processed}/${toProcess.length}] ${extracted.year} ${extracted.make} ${extracted.model} - ${extracted.status}`);
    } catch (err: any) {
      results.failed++;
      results.errors.push({ url, error: err.message });
      console.error(`[gooding] Failed: ${url} - ${err.message}`);
    }
  }

  return results;
}

// ============================================================================
// HTTP HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const body = await req.json().catch(() => ({}));
    const { url, action, limit = 50, save_to_db = true, offset = 0 } = body;

    // Single URL extraction
    if (url) {
      console.log(`[gooding] Extracting: ${url}`);

      const pageData = await fetchGoodingPageData(url);
      const extracted = extractFromPageData(pageData, url);

      let dbResult = null;
      if (save_to_db) {
        dbResult = await saveToDatabase(supabase, extracted);
      }

      console.log(`=== GOODING EXTRACTION RESULTS ===`);
      console.log(`Title: ${extracted.title}`);
      console.log(`Year/Make/Model: ${extracted.year} ${extracted.make} ${extracted.model}`);
      console.log(`Lot: ${extracted.lot_number} | Auction: ${extracted.auction_name}`);
      console.log(`Estimate: ${extracted.currency} ${extracted.estimate_low?.toLocaleString()} - ${extracted.estimate_high?.toLocaleString()}`);
      console.log(`Sale Price: ${extracted.sale_price ? `${extracted.currency} ${extracted.sale_price.toLocaleString()}` : 'N/A'}`);
      console.log(`Status: ${extracted.status}`);
      console.log(`Images: ${extracted.image_urls.length}`);

      return new Response(
        JSON.stringify({
          success: true,
          extracted,
          _db: dbResult ? {
            vehicle_id: dbResult.vehicle_id,
            images_saved: dbResult.images_saved,
            is_new: dbResult.is_new,
          } : null,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Sitemap discovery
    if (action === 'discover') {
      const urls = await discoverLotsFromSitemap();
      return new Response(
        JSON.stringify({
          success: true,
          total_lots: urls.length,
          sample: urls.slice(0, 20),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Batch processing
    if (action === 'batch') {
      const urls = await discoverLotsFromSitemap();

      // Apply offset and limit
      const offsetUrls = urls.slice(offset);
      const results = await processBatch(supabase, offsetUrls, limit);

      return new Response(
        JSON.stringify({
          success: true,
          total_in_sitemap: urls.length,
          offset,
          limit,
          results,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Stats
    if (action === 'stats') {
      const { data: stats } = await supabase.rpc('count_vehicles_by_source', {
        source_name: 'gooding',
      }).single();

      const { count: listingCount } = await supabase
        .from('external_listings')
        .select('*', { count: 'exact', head: true })
        .eq('platform', 'gooding');

      return new Response(
        JSON.stringify({
          success: true,
          vehicles_in_db: stats?.count || 0,
          external_listings: listingCount || 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        error: 'Invalid request. Use { url: "..." } for single extraction, { action: "discover" } for sitemap, or { action: "batch", limit: N } for batch processing.',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[gooding] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
