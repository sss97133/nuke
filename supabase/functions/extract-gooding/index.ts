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
import { resolveExistingVehicleId, discoveryUrlIlikePattern } from '../_shared/resolveVehicleForListing.ts';
import { qualityGate } from '../_shared/extractionQualityGate.ts';
import { cleanVehicleFields, stripHtmlTags } from '../_shared/pollutionDetector.ts';

const EXTRACTOR_VERSION = '2.1.0';

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
  chassis: string | null;       // Classic car chassis (used as VIN when no 17-char VIN)
  coachwork: string | null;     // e.g. "Scaglietti"

  // Auction data
  lot_number: number | null;
  auction_name: string | null;
  auction_date: string | null;
  auction_location: string | null;
  auction_calendar_position: string | null;  // e.g. "2025 Pebble Beach Auctions (Lot 38)"
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
  saleroom_addendum: string | null;  // SRA note HTML or plain text

  // Parsed structured fields
  engine_size: string | null;
  transmission: string | null;
  mileage: number | null;

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
        sraNote?: { childMarkdownRemark?: { html?: string } } | null;
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
          chassis?: string | null;
          coachwork?: string | null;
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
          cloudinaryImages4?: Array<{ public_id: string }> | null;
          cloudinaryImages5?: Array<{ public_id: string }> | null;
          cloudinaryImages6?: Array<{ public_id: string }> | null;
        } | null;
      } | null;
    };
  };
}

// ============================================================================
// ENGINE / TRANSMISSION / MILEAGE PARSERS
// ============================================================================

/**
 * Parse engine_size from Gooding specifications array.
 * Examples: "331 CID OHV V-8 Engine", "2,418 CC DOHC V-6 Engine",
 *           "1,076 CC Inline Four Cylinder", "260 CID SOHC Inline 8-Cylinder Engine"
 */
function parseEngineFromSpecs(specs: string[]): string | null {
  const engineKeywords = [
    /\bEngine\b/i,
    /\bCylinder(s)?\b/i,
    /\bV-\d+\b/i,
    /\bInline[-\s]\d+\b/i,
    /\bInline[-\s](Four|Six|Eight|Three|Five|Twelve)\b/i,
    /\bFlat[-\s](Four|Six|Eight)\b/i,
    /\bBHP\b/i,
    /\b\d+\s*(?:CC|CID|ci)\b/i,
  ];
  const excludeKeywords = [
    /Carburetor/i, /Injection/i, /Brakes?/i, /Suspension/i,
    /Wheelbase/i, /Gearbox/i, /Transmission/i, /Axle/i,
    /Spring/i, /Shock/i, /Chassis/i,
  ];

  for (const spec of specs) {
    const trimmed = spec.trim();
    if (!trimmed) continue;
    if (excludeKeywords.some(p => p.test(trimmed))) continue;
    if (engineKeywords.some(p => p.test(trimmed))) {
      return trimmed.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
    }
  }
  return null;
}

/**
 * Parse transmission from Gooding specifications array.
 * Examples: "4-Speed Hydra-Matic Transmission", "3-Speed Manual Gearbox"
 */
function parseTransmissionFromSpecs(specs: string[]): string | null {
  for (const spec of specs) {
    const trimmed = spec.trim();
    if (!trimmed) continue;
    if (/\b(Transmission|Gearbox|Transaxle)\b/i.test(trimmed)) {
      return trimmed.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
    }
  }
  return null;
}

/**
 * Parse mileage from highlight/note prose.
 * Examples: "Driven No More Than 500 Miles Since Restoration" → 500
 *           "Showing Less than 19,300 Miles" → 19300
 */
function parseMileageFromText(text: string): number | null {
  if (!text) return null;
  const milesPatterns = [
    /(\d{1,3}(?:,\d{3})*)\s*[-\s]?miles?\b/i,
    /(\d{1,3}(?:,\d{3})*)\s*-mile\b/i,
    /showing\s+(?:less\s+than\s+|approximately\s+|just\s+)?([0-9,]+)\s*miles?/i,
    /driven\s+(?:no\s+more\s+than\s+|only\s+|just\s+)?([0-9,]+)\s*miles?/i,
    /odometer\s+(?:shows?|reads?|indicates?)\s+([0-9,]+)\s*miles?/i,
    /approximately\s+([0-9,]+)\s*miles?/i,
    /only\s+([0-9,]+)\s*miles?/i,
    /fewer\s+than\s+([0-9,]+)\s*miles?/i,
    /less\s+than\s+([0-9,]+)\s*miles?/i,
    /([0-9,]+)\s*miles?\s+(?:from\s+new|since\s+new|since\s+(?:restoration|rebuild|new))/i,
  ];
  for (const pattern of milesPatterns) {
    const match = text.match(pattern);
    if (match) {
      const numStr = match[match.length - 1] || match[1];
      const miles = parseInt(numStr.replace(/,/g, ''), 10);
      if (miles > 0 && miles < 5_000_000) return miles;
    }
  }
  // KM → miles
  const kmPatterns = [
    /(\d{1,3}(?:,\d{3})*)\s*[-\s]?km\b/i,
    /(\d{1,3}(?:,\d{3})*)\s*k(?:ilo)?m(?:etres?|eters?)/i,
  ];
  for (const pattern of kmPatterns) {
    const match = text.match(pattern);
    if (match) {
      const km = parseInt(match[1].replace(/,/g, ''), 10);
      if (km > 0 && km < 5_000_000) return Math.round(km * 0.621371);
    }
  }
  return null;
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
// DESCRIPTION BUILDER
// ============================================================================

/**
 * Build a rich description from Gooding's two content sources:
 *   - item.note: typically a short collection credit ("From the John Doe Collection")
 *                or a 1-2 sentence provenance note. Sometimes null.
 *   - highlights: array of 3-8 bullet-point facts about the car (the primary content).
 *
 * Strategy:
 *   - Join highlights as the main body (they carry the substantive content).
 *   - Prepend the note if it's a meaningful provenance statement (> 20 chars).
 *   - Return null only if both are empty.
 */
function buildGoodingDescription(note: string | null, highlights: string[]): string | null {
  const parts: string[] = [];

  // Add note if it has meaningful content (not just whitespace or single word)
  const cleanNote = (note || '').replace(/<[^>]+>/g, '').trim();
  if (cleanNote.length > 20) {
    parts.push(cleanNote);
  }

  // Add highlights as the main description body
  const cleanHighlights = highlights
    .map(h => h.replace(/<[^>]+>/g, '').trim())
    .filter(h => h.length > 5);
  if (cleanHighlights.length > 0) {
    parts.push(cleanHighlights.join('\n'));
  }

  if (parts.length === 0) return null;
  return parts.join('\n\n').slice(0, 5000);
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
  addImages(item?.cloudinaryImages4);
  addImages(item?.cloudinaryImages5);
  addImages(item?.cloudinaryImages6);

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

  // Chassis (classic car ID) and coachwork from Contentful
  const chassis = (item?.chassis ?? '').trim() || null;
  const coachwork = (item?.coachwork ?? '').trim() || null;

  // Try to extract 17-char VIN from highlights or specifications; fall back to chassis for classics
  let vin: string | null = null;
  const textToSearch = [
    ...(item?.highlights || []),
    ...(item?.specifications || []),
    item?.note || '',
  ].join(' ');
  vin = extractVinFromText(textToSearch);
  if (!vin && chassis) {
    vin = chassis;
  }

  // Parse engine/transmission from structured specifications array
  const specs = item?.specifications || [];
  const engineSize = parseEngineFromSpecs(specs);
  const transmissionStr = parseTransmissionFromSpecs(specs);

  // Parse mileage from prose in highlights + note
  const proseText = [
    ...cleanHighlights,
    item?.note || '',
  ].join('\n');
  const mileage = parseMileageFromText(proseText);

  // Salesroom addendum (SRA note) – strip HTML for plain text
  let saleroom_addendum: string | null = null;
  const sraHtml = lot.sraNote?.childMarkdownRemark?.html;
  if (sraHtml && sraHtml.trim()) {
    saleroom_addendum = sraHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Auction calendar position: "2025 Pebble Beach Auctions (Lot 38)"
  let auction_calendar_position: string | null = null;
  const auctionSlug = auction?.webpage__auction?.[0]?.slug;
  const yearFromSlug = auctionSlug ? auctionSlug.match(/(\d{4})$/)?.[1] : null;
  if (auction?.name && lot.lotNumber != null) {
    auction_calendar_position = yearFromSlug
      ? `${yearFromSlug} ${auction.name} (Lot ${lot.lotNumber})`
      : `${auction.name} (Lot ${lot.lotNumber})`;
  }

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
    chassis,
    coachwork,

    lot_number: lot.lotNumber,
    auction_name: auction?.name || null,
    auction_date: auctionDate,
    auction_location: auction?.location?.address?.addressCountry || null,
    auction_calendar_position,

    currency: auction?.currency || 'USD',

    estimate_low: lot.lowEstimate,
    estimate_high: lot.highEstimate,
    sale_price: lot.salePrice,
    has_reserve: lot.hasReservePrice ?? true,

    status,

    highlights: cleanHighlights,
    specifications: item?.specifications || [],
    description: buildGoodingDescription(item?.note || null, cleanHighlights),
    vehicle_type: item?.type || null,
    saleroom_addendum,

    engine_size: engineSize,
    transmission: transmissionStr,
    mileage,

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

async function fetchGoodingPageData(url: string, supabase?: any): Promise<GoodingPageData> {
  // Extract slug from URL
  let slug = url;
  if (url.includes('goodingco.com')) {
    slug = url.split('/lot/')[1]?.split('/')[0]?.split('?')[0] || '';
  }

  if (!slug) {
    throw new Error('Could not extract lot slug from URL');
  }

  // Fetch the Gatsby page-data.json directly (ZERO Firecrawl cost)
  const pageDataUrl = `https://www.goodingco.com/page-data/lot/${slug}/page-data.json`;
  console.log(`[gooding] Fetching: ${pageDataUrl}`);

  const response = await fetch(pageDataUrl, {
    headers: BROWSER_HEADERS,
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching page-data.json`);
  }

  const text = await response.text();
  const data = JSON.parse(text);

  // Archive JSON to listing_page_snapshots (non-blocking)
  if (supabase) {
    try {
      const hashData = new TextEncoder().encode(text);
      const hashBuffer = await crypto.subtle.digest('SHA-256', hashData);
      const sha256 = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

      await supabase.from('listing_page_snapshots').insert({
        platform: 'gooding',
        listing_url: url,
        fetched_at: new Date().toISOString(),
        fetch_method: 'direct',
        http_status: response.status,
        success: true,
        html: text, // Store JSON as "html" for consistency
        html_sha256: sha256,
        content_length: text.length,
        metadata: { caller: 'extract-gooding', format: 'json', page_data_url: pageDataUrl },
      });
      console.log(`[gooding] Archived JSON snapshot (${text.length} bytes)`);
    } catch (e: any) {
      // 23505 = duplicate content hash — fine
      if (!String(e?.code || e?.message || '').includes('23505')) {
        console.warn(`[gooding] Snapshot archive failed (non-fatal): ${e?.message}`);
      }
    }
  }

  return data as GoodingPageData;
}

// ============================================================================
// SITEMAP DISCOVERY
// ============================================================================

async function discoverLotsFromSitemap(): Promise<string[]> {
  console.log('[gooding] Fetching sitemap...');

  // NOTE: raw fetch acceptable here — sitemap.xml is used only for URL discovery (extracting lot slugs).
  // The XML content is parsed for URLs but never stored. archiveFetch is intended for listing pages
  // that we want to re-extract later, not for sitemap census data.
  // Decision recorded: 2026-02-27 — acceptable exception, URL-discovery-only pattern.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const response = await fetch('https://www.goodingco.com/sitemap.xml', {
    headers: BROWSER_HEADERS,
    signal: controller.signal,
  });
  clearTimeout(timeout);

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
  const listingUrlKey = normalizeListingUrlKey(extracted.url);

  // Resolve existing vehicle (listing key, discovery_url exact, or URL pattern) to avoid duplicate
  const { vehicleId: resolvedId } = await resolveExistingVehicleId(supabase, {
    url: extracted.url,
    platform: 'gooding',
    discoveryUrlIlikePattern: extracted.slug
      ? `%goodingco.com/lot/${extracted.slug}%`
      : discoveryUrlIlikePattern(extracted.url),
  });
  let vehicleId: string | null = resolvedId;

  // Also check by VIN (ILIKE pattern may timeout on 1M+ row table)
  if (!vehicleId && extracted.vin && extracted.vin.length >= 5) {
    const { data: byVin } = await supabase
      .from('vehicles')
      .select('id')
      .eq('vin', extracted.vin)
      .limit(1)
      .maybeSingle();
    if (byVin?.id) vehicleId = byVin.id;
  }

  let isNew = false;

  // Description is already built by buildGoodingDescription() in extractFromPageData
  // (note + highlights merged). Strip any residual HTML and truncate.
  let description: string | null = extracted.description;
  if (description) {
    description = stripHtmlTags(description).trim().slice(0, 5000) || null;
  }
  // Final fallback: if extractFromPageData returned null (pre-2.1 callers), use highlights
  if (!description && extracted.highlights.length > 0) {
    description = extracted.highlights
      .map(h => h.replace(/<[^>]+>/g, '').trim())
      .filter(h => h.length > 5)
      .join('\n')
      .slice(0, 5000) || null;
  }

  // Quality gate
  const rawVehicleData: Record<string, any> = {
    year: extracted.year,
    make: extracted.make,
    model: extracted.model,
    vin: extracted.vin,
    sale_price: extracted.sale_price,
    description,
    color: null, // Gooding doesn't provide color directly
    transmission: extracted.transmission,
  };
  const cleanedData = cleanVehicleFields(rawVehicleData, { platform: 'gooding' });
  const gate = qualityGate(cleanedData, { source: 'gooding', sourceType: 'auction' });

  if (gate.action === 'reject') {
    console.warn(`[gooding] Quality gate REJECTED ${extracted.url}: ${gate.issues.join(', ')}`);
    throw new Error(`Quality gate rejected (score=${gate.score}): ${gate.issues.slice(0, 3).join(', ')}`);
  }
  if (gate.action === 'flag_for_review') {
    console.warn(`[gooding] Quality gate FLAGGED ${extracted.url} (score=${gate.score}): ${gate.issues.join(', ')}`);
  }

  if (vehicleId) {
    // Update existing vehicle (vehicleId from listing, discovery_url, or slug match)

    const vehicleUpdate: Record<string, unknown> = {
      year: extracted.year,
      make: extracted.make,
      model: extracted.model,
      vin: extracted.vin || undefined,
      sale_price: extracted.sale_price,
      description: description || undefined,
      sale_status: extracted.status === 'sold' ? 'sold' : (extracted.status === 'active' ? 'available' : extracted.status),
      status: 'active',
      updated_at: new Date().toISOString(),
      extractor_version: EXTRACTOR_VERSION,
    };
    // Only fill engine/transmission/mileage if extracted and currently empty
    if (extracted.engine_size) vehicleUpdate.engine_size = extracted.engine_size;
    if (extracted.transmission) vehicleUpdate.transmission = extracted.transmission;
    if (extracted.mileage) vehicleUpdate.mileage = extracted.mileage;
    if (extracted.coachwork || extracted.saleroom_addendum || extracted.auction_calendar_position) {
      const { data: existingVehicle } = await supabase
        .from('vehicles')
        .select('origin_metadata')
        .eq('id', vehicleId)
        .maybeSingle();
      const existingMeta = (existingVehicle?.origin_metadata as Record<string, unknown>) || {};
      vehicleUpdate.origin_metadata = {
        ...existingMeta,
        gooding_coachwork: extracted.coachwork,
        gooding_saleroom_addendum: extracted.saleroom_addendum,
        gooding_auction_calendar: extracted.auction_calendar_position,
      };
    }
    const { error: updateError } = await supabase
      .from('vehicles')
      .update(vehicleUpdate)
      .eq('id', vehicleId);

    if (updateError) {
      console.error(`[gooding] Failed to update vehicle: ${updateError.message}`);
    }
  } else {
    // Insert new vehicle
    isNew = true;
    const notesParts: string[] = [];
    if (extracted.coachwork) notesParts.push(`Coachwork by ${extracted.coachwork}`);
    notesParts.push(...extracted.highlights.slice(0, 8));
    if (extracted.auction_calendar_position) notesParts.push(extracted.auction_calendar_position);
    const insertPayload: Record<string, unknown> = {
      year: extracted.year,
      make: extracted.make,
      model: extracted.model,
      vin: extracted.vin,
      sale_price: extracted.sale_price,
      sale_status: extracted.status === 'sold' ? 'sold' : (extracted.status === 'active' ? 'available' : extracted.status),
      status: 'active', // so feed shows vehicle (feed filters out status = 'pending')
      listing_source: 'gooding_extract',
      profile_origin: 'gooding_import',
      discovery_url: extracted.url,
      discovery_source: 'gooding',
      is_public: true,
      auction_source: 'gooding',
      description: description || undefined,
      source: 'gooding',
      extractor_version: EXTRACTOR_VERSION,
      notes: notesParts.join('\n'),
      engine_size: extracted.engine_size || undefined,
      transmission: extracted.transmission || undefined,
      mileage: extracted.mileage || undefined,
    };
    if (extracted.coachwork || extracted.saleroom_addendum || extracted.auction_calendar_position) {
      insertPayload.origin_metadata = {
        gooding_coachwork: extracted.coachwork,
        gooding_saleroom_addendum: extracted.saleroom_addendum,
        gooding_auction_calendar: extracted.auction_calendar_position,
      };
    }
    const { data: newVehicle, error: insertError } = await supabase
      .from('vehicles')
      .insert(insertPayload)
      .select('id')
      .maybeSingle();

    if (insertError) {
      // Handle unique constraint violation (e.g. www vs non-www URL)
      if (insertError.code === '23505' && insertError.message?.includes('discovery_url')) {
        const normalizedUrl = extracted.url.replace('://www.', '://');
        const { data: byUrl } = await supabase
          .from('vehicles')
          .select('id')
          .or(`discovery_url.eq.${normalizedUrl},discovery_url.eq.${extracted.url}`)
          .limit(1)
          .maybeSingle();
        if (byUrl?.id) {
          vehicleId = byUrl.id;
          isNew = false;
          // Update instead
          await supabase.from('vehicles').update(insertPayload).eq('id', vehicleId);
        } else {
          throw new Error(`Failed to insert vehicle: ${insertError.message}`);
        }
      } else {
        throw new Error(`Failed to insert vehicle: ${insertError?.message || insertError}`);
      }
    } else {
      vehicleId = newVehicle?.id;
    }
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
        auction_calendar_position: extracted.auction_calendar_position,
        currency: extracted.currency,
        estimate_low: extracted.estimate_low,
        estimate_high: extracted.estimate_high,
        has_reserve: extracted.has_reserve,
        highlights: extracted.highlights,
        specifications: extracted.specifications,
        coachwork: extracted.coachwork,
        chassis: extracted.chassis,
        saleroom_addendum: extracted.saleroom_addendum,
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
    const { error: deleteError } = await supabase
      .from('vehicle_images')
      .delete()
      .eq('vehicle_id', vehicleId)
      .eq('source', 'gooding');
    if (deleteError) console.error('Failed to delete from vehicle_images:', deleteError.message);

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

      const pageData = await fetchGoodingPageData(url, supabase);
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

      const pageData = await fetchGoodingPageData(url, supabase);
      const extracted = extractFromPageData(pageData, url);

      let dbResult = null;
      if (save_to_db) {
        dbResult = await saveToDatabase(supabase, extracted);
      }

      console.log(`=== GOODING EXTRACTION RESULTS ===`);
      console.log(`Title: ${extracted.title}`);
      console.log(`Year/Make/Model: ${extracted.year} ${extracted.make} ${extracted.model}`);
      console.log(`VIN/Chassis: ${extracted.vin || 'N/A'} | Coachwork: ${extracted.coachwork || 'N/A'}`);
      console.log(`Lot: ${extracted.lot_number} | Auction: ${extracted.auction_name}`);
      console.log(`Calendar: ${extracted.auction_calendar_position || 'N/A'}`);
      console.log(`Estimate: ${extracted.currency} ${extracted.estimate_low?.toLocaleString()} - ${extracted.estimate_high?.toLocaleString()}`);
      console.log(`Sale Price: ${extracted.sale_price ? `${extracted.currency} ${extracted.sale_price.toLocaleString()}` : 'N/A'}`);
      console.log(`Status: ${extracted.status}`);
      console.log(`Highlights: ${extracted.highlights.length} | Specs: ${extracted.specifications.length}`);
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

    // Backfill: re-extract specific URLs and save (fixes missing chassis, coachwork, estimate, etc.)
    if (action === 'backfill' && Array.isArray(body.urls) && body.urls.length > 0) {
      const urls = body.urls as string[];
      const limit = Math.min(urls.length, typeof body.limit === 'number' ? body.limit : 100);
      const results = await processBatch(supabase, urls, limit);
      return new Response(
        JSON.stringify({
          success: true,
          action: 'backfill',
          requested: urls.length,
          limit,
          results,
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

    // Discover and enqueue — stores sitemap URLs in import_queue once, avoids re-fetching sitemap
    if (action === 'discover_and_enqueue') {
      const urls = await discoverLotsFromSitemap();
      console.log(`[gooding] Enqueuing ${urls.length} lot URLs...`);

      let enqueued = 0;
      let skipped = 0;

      // Insert in batches of 100
      for (let i = 0; i < urls.length; i += 100) {
        const batch = urls.slice(i, i + 100).map(url => ({
          listing_url: url,
          status: 'pending' as const,
          attempts: 0,
          priority: 0,
        }));

        const { data, error } = await supabase
          .from('import_queue')
          .upsert(batch, { onConflict: 'listing_url', ignoreDuplicates: true })
          .select('id');

        if (error) {
          console.error(`[gooding] Enqueue error: ${error.message}`);
        }
        enqueued += data?.length || 0;
      }

      skipped = urls.length - enqueued;

      return new Response(
        JSON.stringify({
          success: true,
          action: 'discover_and_enqueue',
          total_in_sitemap: urls.length,
          enqueued,
          skipped_duplicates: skipped,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Batch from queue — processes Gooding URLs from import_queue instead of re-fetching sitemap
    if (action === 'batch_from_queue') {
      const { data: queueItems, error: claimErr } = await supabase.rpc('claim_import_queue_batch', {
        p_batch_size: limit,
        p_max_attempts: 3,
        p_worker_id: 'gooding-batch',
        p_lock_ttl_seconds: 600,
      });

      if (claimErr || !queueItems?.length) {
        return new Response(
          JSON.stringify({ success: true, message: 'No items in queue', processed: 0 }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Filter to gooding URLs only
      const goodingItems = queueItems.filter((item: any) =>
        item.listing_url?.includes('goodingco.com')
      );

      // Release non-gooding items
      const otherItems = queueItems.filter((item: any) =>
        !item.listing_url?.includes('goodingco.com')
      );
      if (otherItems.length > 0) {
        await supabase.from('import_queue').update({
          status: 'pending',
          locked_at: null,
          locked_by: null,
        }).in('id', otherItems.map((i: any) => i.id));
      }

      const urls = goodingItems.map((item: any) => item.listing_url);
      const results = await processBatch(supabase, urls, urls.length);

      // Mark queue items
      for (const item of goodingItems) {
        const succeeded = !results.errors.find(e => e.url === item.listing_url);
        await supabase.from('import_queue').update({
          status: succeeded ? 'complete' : 'failed',
          processed_at: new Date().toISOString(),
          locked_at: null,
          locked_by: null,
          error_message: results.errors.find(e => e.url === item.listing_url)?.error || null,
        }).eq('id', item.id);
      }

      return new Response(
        JSON.stringify({
          success: true,
          action: 'batch_from_queue',
          claimed: goodingItems.length,
          results,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Batch processing (legacy — re-fetches sitemap each time)
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
      }).maybeSingle();

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
        error: 'Invalid request. Use { url: "..." } for single extraction; { action: "backfill", urls: ["..."] } to re-extract and save; { action: "discover" } for sitemap; or { action: "batch", limit: N } for batch.',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[gooding] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
