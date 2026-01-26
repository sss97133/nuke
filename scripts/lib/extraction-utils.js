/**
 * Shared Extraction Utilities
 *
 * All extractors should use these instead of rolling their own.
 * This ensures consistent behavior for:
 * - Collection/organization creation
 * - Owner/provenance parsing
 * - Auction event creation
 * - VIN deduplication
 * - Image handling
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Caches
const cache = {
  vinToVehicleId: new Map(),
  collectionSlugToId: new Map(),
  auctionHouseSlugToId: new Map()
};

// ============================================
// ORGANIZATION HANDLING
// ============================================

/**
 * Get or create an organization (collection, auction house, dealer, etc.)
 */
export async function getOrCreateOrganization({ name, slug, type, sourceUrl, metadata = {} }) {
  const cacheKey = `${type}:${slug}`;

  // Check cache
  if (cache.collectionSlugToId.has(cacheKey)) {
    return cache.collectionSlugToId.get(cacheKey);
  }

  // Try to create
  const res = await fetch(`${SUPABASE_URL}/rest/v1/organizations`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation,resolution=ignore-duplicates'
    },
    body: JSON.stringify({
      name,
      slug,
      type,
      discovered_via: metadata.discoveredVia || 'extraction',
      source_url: sourceUrl,
      is_verified: false,
      is_active: true,
      ...metadata
    })
  });

  if (res.ok) {
    const [org] = await res.json();
    if (org) {
      cache.collectionSlugToId.set(cacheKey, org.id);
      return org.id;
    }
  }

  // Fetch existing if insert failed
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/organizations?slug=eq.${encodeURIComponent(slug)}&type=eq.${type}&select=id`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const existing = await checkRes.json();
  if (existing.length > 0) {
    cache.collectionSlugToId.set(cacheKey, existing[0].id);
    return existing[0].id;
  }

  return null;
}

/**
 * Shorthand for collection creation
 */
export async function getOrCreateCollection(name, slug, sourceUrl) {
  return getOrCreateOrganization({
    name,
    slug,
    type: 'collection',
    sourceUrl,
    metadata: { discoveredVia: 'extraction' }
  });
}

// ============================================
// VIN DEDUPLICATION
// ============================================

/**
 * Load existing VINs into cache
 */
export async function loadVinCache() {
  let offset = 0;
  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/vehicles?vin=not.is.null&select=id,vin&limit=1000&offset=${offset}`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const data = await res.json();
    if (data.length === 0) break;
    data.forEach(v => cache.vinToVehicleId.set(v.vin, v.id));
    offset += 1000;
  }
  return cache.vinToVehicleId.size;
}

/**
 * Check if VIN exists, return existing vehicle ID if so
 */
export function getVehicleIdByVin(vin) {
  return vin ? cache.vinToVehicleId.get(vin) : null;
}

/**
 * Register a VIN -> vehicle ID mapping
 */
export function registerVin(vin, vehicleId) {
  if (vin) cache.vinToVehicleId.set(vin, vehicleId);
}

// ============================================
// AUCTION EVENT CREATION
// ============================================

/**
 * Create or update an auction event
 */
export async function upsertAuctionEvent({
  vehicleId,
  source,          // 'mecum', 'bat', 'carsandbids', etc.
  sourceUrl,
  sourceListingId,
  lotNumber,
  auctionDate,
  outcome,         // 'sold', 'not_sold', 'bid_to', 'withdrawn'
  winningBid,
  highBid,
  estimateLow,
  estimateHigh,
  sellerLocation,
  rawData = {}
}) {
  const eventData = {
    vehicle_id: vehicleId,
    source,
    source_url: sourceUrl,
    source_listing_id: sourceListingId?.toString(),
    lot_number: lotNumber,
    auction_start_date: auctionDate,
    auction_end_date: auctionDate,
    outcome,
    winning_bid: winningBid,
    high_bid: highBid,
    estimate_low: estimateLow,
    estimate_high: estimateHigh,
    seller_location: sellerLocation,
    raw_data: rawData
  };

  // Check for existing by source_url
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/auction_events?source_url=eq.${encodeURIComponent(sourceUrl)}&select=id`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const existing = await checkRes.json();

  if (existing.length > 0) {
    // Update existing
    await fetch(`${SUPABASE_URL}/rest/v1/auction_events?id=eq.${existing[0].id}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(eventData)
    });
    return { updated: true, id: existing[0].id };
  }

  // Create new
  const res = await fetch(`${SUPABASE_URL}/rest/v1/auction_events`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(eventData)
  });

  if (res.ok) {
    const [event] = await res.json();
    return { created: true, id: event.id };
  }
  return { error: await res.text() };
}

// ============================================
// IMAGE HANDLING
// ============================================

/**
 * Insert images for a vehicle (with deduplication)
 */
export async function insertVehicleImages(vehicleId, images, source) {
  if (!images?.length) return 0;

  let inserted = 0;
  for (let i = 0; i < images.length; i++) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/vehicle_images`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=ignore-duplicates'
      },
      body: JSON.stringify({
        vehicle_id: vehicleId,
        image_url: images[i],
        source,
        is_primary: i === 0,
        position: i,
        is_external: true
      })
    });
    if (res.ok) inserted++;
  }
  return inserted;
}

// ============================================
// PROVENANCE PARSING
// ============================================

/**
 * Extract owner mentions from text
 */
export function parseOwnershipHistory(text) {
  if (!text) return [];

  const owners = [];
  const patterns = [
    /original owner (?:was )?([A-Z][a-zA-Z\s]+?) of ([^,.]+)/gi,
    /sold to ([A-Z][a-zA-Z\s]+?)(?:,? of ([^,.]+))?(?:,| in \d)/gi,
    /([A-Z][a-zA-Z\s]+?) of ([A-Z][a-zA-Z,\s]+?) owned/gi,
    /owned by ([A-Z][a-zA-Z\s]+)/gi,
    /purchased by ([A-Z][a-zA-Z\s]+)/gi,
    /acquired by ([A-Z][a-zA-Z\s]+)/gi,
    /consigned by ([A-Z][a-zA-Z\s]+)/gi
  ];

  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      owners.push({
        raw: match[0],
        name: match[1]?.trim(),
        location: match[2]?.trim()
      });
    }
  });

  // Deduplicate by name
  const seen = new Set();
  return owners.filter(o => {
    if (!o.name || seen.has(o.name)) return false;
    seen.add(o.name);
    return true;
  });
}

/**
 * Extract restoration/service history mentions
 */
export function parseRestorationHistory(text) {
  if (!text) return [];

  const mentions = [];
  const patterns = [
    /restored by ([A-Z][a-zA-Z\s]+?)(?:,? (?:of|in) ([^,.]+))?/gi,
    /restoration by ([A-Z][a-zA-Z\s]+)/gi,
    /serviced by ([A-Z][a-zA-Z\s]+)/gi,
    /maintained by ([A-Z][a-zA-Z\s]+)/gi
  ];

  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      mentions.push({
        raw: match[0],
        shop: match[1]?.trim(),
        location: match[2]?.trim()
      });
    }
  });

  return mentions;
}

// ============================================
// VEHICLE UPSERT (STANDARD FLOW)
// ============================================

/**
 * Standard vehicle upsert with all the bells and whistles
 */
export async function upsertVehicle({
  vehicleId,
  sourceUrl,
  source,
  data,           // Extracted data object
  skipImages = false
}) {
  // 1. Check VIN deduplication
  const existingVehicleId = getVehicleIdByVin(data.vin);
  const targetVehicleId = existingVehicleId || vehicleId;

  // 2. Handle collection if present
  let collectionId = null;
  if (data.collection_name && data.collection_slug) {
    collectionId = await getOrCreateCollection(
      data.collection_name,
      data.collection_slug,
      sourceUrl
    );
  }

  // 3. Build update object
  const updateData = {
    vin: data.vin,
    year: data.year,
    make: data.make,
    model: data.model,
    transmission: data.transmission,
    color: data.exterior_color,
    interior_color: data.interior_color,
    mileage: data.mileage,
    description: data.description,
    highlights: data.highlights,
    primary_image_url: data.images?.[0],
    image_url: data.images?.[0],
    status: 'active'
  };

  // Price fields
  if (data.sale_price || data.hammer_price) {
    updateData.sale_price = data.sale_price || data.hammer_price;
    updateData.sold_price = data.sale_price || data.hammer_price;
  } else if (data.high_bid) {
    updateData.high_bid = data.high_bid;
  }

  // Collection link
  if (collectionId) {
    updateData.selling_organization_id = collectionId;
  }

  // Remove nulls
  Object.keys(updateData).forEach(k => {
    if (updateData[k] === null || updateData[k] === undefined) delete updateData[k];
  });

  // 4. Update vehicle
  await fetch(`${SUPABASE_URL}/rest/v1/vehicles?id=eq.${targetVehicleId}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updateData)
  });

  // 5. Handle images
  if (!skipImages && data.images?.length) {
    await insertVehicleImages(targetVehicleId, data.images, source);
  }

  // 6. Mark as merged if deduplicated
  if (existingVehicleId && existingVehicleId !== vehicleId) {
    await fetch(`${SUPABASE_URL}/rest/v1/vehicles?id=eq.${vehicleId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'merged', merged_into_vehicle_id: existingVehicleId })
    });
  }

  // 7. Register VIN
  registerVin(data.vin, targetVehicleId);

  // 8. Create auction event
  const event = await upsertAuctionEvent({
    vehicleId: targetVehicleId,
    source,
    sourceUrl,
    sourceListingId: data.source_listing_id,
    lotNumber: data.lot_number,
    auctionDate: data.auction_date || data.run_date,
    outcome: data.sale_result === 'sold' ? 'sold' : data.sale_result,
    winningBid: data.sale_price || data.hammer_price,
    highBid: data.high_bid,
    estimateLow: data.low_estimate,
    estimateHigh: data.high_estimate,
    sellerLocation: data.auction_location,
    rawData: data.raw_data || {}
  });

  return {
    vehicleId: targetVehicleId,
    isNew: !existingVehicleId,
    collectionId,
    event
  };
}

// ============================================
// EXPORTS
// ============================================

export {
  cache,
  SUPABASE_URL,
  SUPABASE_KEY
};
