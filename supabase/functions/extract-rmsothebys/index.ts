/**
 * RM Sotheby's Data Extractor
 *
 * Extracts premium auction data from rmsothebys.com - the world's top collector car auction house.
 * Home of world record sales including the $143M Mercedes 300 SLR.
 *
 * API discovered: POST /api/search/SearchLots
 * - Returns: id, publicName, lot, value, valueType, link, crop (image), sold, isStillForSale
 *
 * Usage:
 *   POST {"action": "list", "auction": "PA26"} - List lots from a specific auction
 *   POST {"action": "list_all"} - List all available auctions and their lots
 *   POST {"action": "extract", "url": "https://rmsothebys.com/auctions/pa26/lots/..."} - Extract single lot
 *   POST {"action": "process", "auction": "PA26", "save_to_db": true} - Process all lots from auction
 *   POST {"action": "auctions"} - List available auctions
 *
 * Deploy: supabase functions deploy extract-rmsothebys --no-verify-jwt
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizeListingUrlKey } from '../_shared/listingUrl.ts';
import { resolveExistingVehicleId, discoveryUrlIlikePattern } from '../_shared/resolveVehicleForListing.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// RM Sotheby's - we'll store metadata in origin_metadata instead of linking to org table
const RM_SOTHEBYS_NAME = "RM Sotheby's";
const RM_SOTHEBYS_WEBSITE = 'https://rmsothebys.com';

interface RMSLotItem {
  id: string;
  auctionId: string;
  header: string;
  publicName: string;
  lot: string;
  collection: string;
  value: string;
  valueType: string;
  preSaleEstimate: string;
  canViewLotDetails: boolean;
  link: string;
  styleClass: string;
  auctionStyleName: string;
  isRecentlyPosted: boolean;
  auctioned: boolean;
  canDisplayCurrentBid: boolean;
  sold: boolean;
  crop: string;
  alt: string;
  isStillForSale: boolean;
  locationFlag: string;
  biddingLotId: string;
  biddingAuctionId: string;
  biddingType: string;
  newWindow: boolean;
  specialist: string;
  referenceId: string;
  isFavourite: boolean;
  won: boolean | null;
}

interface ExtractedVehicle {
  url: string;
  title: string;
  year: number | null;
  make: string | null;
  model: string | null;
  lot_number: string;
  auction_name: string;
  auction_code: string;
  estimate_text: string | null;
  sold_price: number | null;
  sold_price_text: string | null;
  currency: string | null;
  sold: boolean;
  is_still_for_sale: boolean;
  image_url: string | null;
  rms_lot_id: string;
  rms_auction_id: string;
  bidding_type: string;
  collection: string | null;
}

// Parse title like "1997 Ferrari F310 B" into year/make/model
function parseTitle(title: string): { year: number | null; make: string | null; model: string | null } {
  const yearMatch = title.match(/^(\d{4})\s+/);
  const year = yearMatch ? parseInt(yearMatch[1]) : null;

  if (!year) {
    // Try to find year anywhere
    const anyYear = title.match(/\b(19|20)\d{2}\b/);
    if (anyYear) {
      const y = parseInt(anyYear[0]);
      const afterYear = title.slice(title.indexOf(anyYear[0]) + 4).trim();
      const parts = afterYear.split(/\s+/);
      return {
        year: y,
        make: parts[0]?.toLowerCase() || null,
        model: parts.slice(1).join(' ')?.toLowerCase() || null,
      };
    }
    return { year: null, make: null, model: null };
  }

  const afterYear = title.slice(4).trim();
  const parts = afterYear.split(/\s+/);
  const make = parts[0]?.toLowerCase() || null;
  const model = parts.slice(1).join(' ')?.toLowerCase() || null;

  return { year, make, model };
}

// Parse value like "EUR 5,500,000" or "Sold For EUR 1,200,000"
function parseValue(value: string, valueType: string): {
  amount: number | null;
  currency: string | null;
  text: string;
} {
  const text = value.trim();
  if (!text) return { amount: null, currency: null, text: '' };

  // Extract currency
  let currency: string | null = null;
  if (text.includes('EUR') || text.includes('\u20ac')) currency = 'EUR';
  else if (text.includes('USD') || text.includes('$')) currency = 'USD';
  else if (text.includes('GBP') || text.includes('\u00a3')) currency = 'GBP';
  else if (text.includes('CHF')) currency = 'CHF';

  // Extract numeric value
  const numMatch = text.match(/([0-9,]+(?:\.[0-9]+)?)/);
  const amount = numMatch ? parseInt(numMatch[1].replace(/,/g, '')) : null;

  return { amount, currency, text };
}

// Fetch lots from RM Sotheby's API
async function fetchAuctionLots(auctionCode: string, pageSize = 200): Promise<RMSLotItem[]> {
  const allItems: RMSLotItem[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const response = await fetch(
      `https://rmsothebys.com/api/search/SearchLots?page=${page}&pageSize=${pageSize}`,
      {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Referer': `https://rmsothebys.com/auctions/${auctionCode.toLowerCase()}/lots/`,
        },
        body: JSON.stringify({
          SearchTerm: '',
          Auction: auctionCode.toUpperCase(),
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`RM Sotheby's API error: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    const items: RMSLotItem[] = data.items || [];

    allItems.push(...items);

    // Check if there are more pages
    if (items.length < pageSize) {
      hasMore = false;
    } else {
      page++;
      // Safety limit
      if (page > 20) {
        console.warn('[RMS] Reached page limit, stopping pagination');
        break;
      }
    }
  }

  return allItems;
}

// Get available auctions (from known codes - there's no public API for this)
function getKnownAuctions(): { code: string; name: string; date: string }[] {
  return [
    // 2026 auctions
    { code: 'PA26', name: 'Paris 2026', date: '2026-01-28' },
    { code: 'AZ26', name: 'Arizona 2026', date: '2026-01-23' },
    { code: 'CC26', name: 'Cavallino Palm Beach 2026', date: '2026-02-14' },
    { code: 'MI26', name: 'Miami 2026', date: '2026-02-27' },
    { code: 'S0226', name: 'Sealed February 2026', date: '2026-02-02' },
    // 2025 auctions (historical)
    { code: 'PA25', name: 'Paris 2025', date: '2025-01-29' },
    { code: 'AZ25', name: 'Arizona 2025', date: '2025-01-24' },
    { code: 'MO25', name: 'Monaco 2025', date: '2025-05-10' },
    { code: 'MI25', name: 'Miami 2025', date: '2025-02-20' },
    { code: 'MT25', name: 'Monterey 2025', date: '2025-08-15' },
    // 2024 auctions
    { code: 'PA24', name: 'Paris 2024', date: '2024-02-01' },
    { code: 'AZ24', name: 'Arizona 2024', date: '2024-01-25' },
    { code: 'MO24', name: 'Monaco 2024', date: '2024-05-11' },
    { code: 'MT24', name: 'Monterey 2024', date: '2024-08-16' },
  ];
}

// Transform API item to extracted vehicle
function transformLotItem(item: RMSLotItem, auctionCode: string): ExtractedVehicle {
  const { year, make, model } = parseTitle(item.publicName);
  const { amount, currency, text: valueText } = parseValue(item.value, item.valueType);

  // Determine if this is a sold price or estimate
  const isSold = item.sold || item.valueType?.toLowerCase().includes('sold');
  const soldPrice = isSold ? amount : null;
  const estimateText = !isSold ? valueText : item.preSaleEstimate || null;

  return {
    url: `https://rmsothebys.com${item.link}`,
    title: item.publicName,
    year,
    make,
    model,
    lot_number: item.lot,
    auction_name: item.header,
    auction_code: auctionCode.toUpperCase(),
    estimate_text: estimateText,
    sold_price: soldPrice,
    sold_price_text: isSold ? valueText : null,
    currency,
    sold: item.sold,
    is_still_for_sale: item.isStillForSale,
    image_url: item.crop || null,
    rms_lot_id: item.biddingLotId,
    rms_auction_id: item.biddingAuctionId,
    bidding_type: item.biddingType,
    collection: item.collection || null,
  };
}


// Save extracted vehicle to database
async function saveVehicle(
  supabase: any,
  vehicle: ExtractedVehicle
): Promise<{ vehicleId: string; isNew: boolean }> {
  const listingUrlKey = normalizeListingUrlKey(vehicle.url);

  // Resolve existing vehicle (listing key, discovery_url exact, or URL pattern) to avoid duplicate
  const { vehicleId: resolvedId } = await resolveExistingVehicleId(supabase, {
    url: vehicle.url,
    platform: 'rmsothebys',
    discoveryUrlIlikePattern: discoveryUrlIlikePattern(vehicle.url),
  });

  if (resolvedId) {
    await supabase
      .from('vehicles')
      .update({
        sale_price: vehicle.sold_price,
        sale_status: vehicle.sold ? 'sold' : (vehicle.is_still_for_sale ? 'available' : 'ended'),
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', resolvedId);
    return { vehicleId: resolvedId, isNew: false };
  }

  // Create new vehicle
  const { data: newVehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .insert({
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      sale_price: vehicle.sold_price,
      sale_status: vehicle.sold ? 'sold' : (vehicle.is_still_for_sale ? 'available' : 'ended'),
      listing_url: vehicle.url,
      discovery_url: vehicle.url,
      discovery_source: 'rmsothebys',
      profile_origin: 'rmsothebys_import',
      is_public: true,
      status: 'active',
      origin_metadata: {
        source: 'rmsothebys',
        auction_house: RM_SOTHEBYS_NAME,
        lot_number: vehicle.lot_number,
        auction_name: vehicle.auction_name,
        auction_code: vehicle.auction_code,
        estimate_text: vehicle.estimate_text,
        sold_price_text: vehicle.sold_price_text,
        currency: vehicle.currency,
        collection: vehicle.collection,
        rms_lot_id: vehicle.rms_lot_id,
        rms_auction_id: vehicle.rms_auction_id,
        bidding_type: vehicle.bidding_type,
        imported_at: new Date().toISOString(),
      },
    })
    .select('id')
    .single();

  if (vehicleError) {
    throw new Error(`Failed to create vehicle: ${vehicleError.message}`);
  }

  const vehicleId = newVehicle.id;

  // Save image
  if (vehicle.image_url) {
    await supabase
      .from('vehicle_images')
      .insert({
        vehicle_id: vehicleId,
        image_url: vehicle.image_url,
        position: 0,
        source: 'rmsothebys_import',
        is_external: true,
      });
  }

  // Create external_listings record
  await supabase
    .from('external_listings')
    .upsert(
      {
        vehicle_id: vehicleId,
        platform: 'rmsothebys',
        listing_url: vehicle.url,
        listing_url_key: listingUrlKey,
        listing_id: vehicle.lot_number,
        listing_status: vehicle.sold ? 'sold' : (vehicle.is_still_for_sale ? 'active' : 'ended'),
        final_price: vehicle.sold_price,
        sold_at: vehicle.sold ? new Date().toISOString() : null,
        metadata: {
          lot_number: vehicle.lot_number,
          auction_name: vehicle.auction_name,
          auction_code: vehicle.auction_code,
          estimate_text: vehicle.estimate_text,
          currency: vehicle.currency,
          collection: vehicle.collection,
          bidding_type: vehicle.bidding_type,
        },
      },
      {
        onConflict: 'platform,listing_url_key',
      }
    );

  // Create timeline event
  if (vehicle.sold && vehicle.sold_price) {
    await supabase.from('timeline_events').insert({
      vehicle_id: vehicleId,
      event_type: 'auction_sold',
      event_date: new Date().toISOString().split('T')[0],
      title: `Sold at ${vehicle.auction_name} (Lot ${vehicle.lot_number})`,
      description: `Sold for ${vehicle.sold_price_text || vehicle.sold_price.toLocaleString()} at RM Sotheby's ${vehicle.auction_name}`,
      source: 'rmsothebys_import',
      metadata: {
        lot_number: vehicle.lot_number,
        auction_code: vehicle.auction_code,
        sold_price: vehicle.sold_price,
        currency: vehicle.currency,
      },
    });
  }

  return { vehicleId, isNew: true };
}

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { action = 'auctions', auction, url, save_to_db = false, limit } = body;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    console.log(`[RMS] Action: ${action}, Auction: ${auction || 'N/A'}`);

    // List available auctions
    if (action === 'auctions') {
      const auctions = getKnownAuctions();
      return okJson({
        success: true,
        auctions,
        count: auctions.length,
        usage: {
          list: 'POST {"action": "list", "auction": "PA26"} - List lots from auction',
          process: 'POST {"action": "process", "auction": "PA26", "save_to_db": true} - Extract and save',
        },
      });
    }

    // List lots from a specific auction
    if (action === 'list') {
      if (!auction) {
        return okJson({ success: false, error: 'Auction code required (e.g., PA26)' }, 400);
      }

      console.log(`[RMS] Fetching lots for auction: ${auction}`);
      const items = await fetchAuctionLots(auction);
      const vehicles = items.map((item) => transformLotItem(item, auction));

      const applied = limit ? vehicles.slice(0, limit) : vehicles;

      return okJson({
        success: true,
        auction,
        total: vehicles.length,
        returned: applied.length,
        sold_count: vehicles.filter((v) => v.sold).length,
        still_for_sale_count: vehicles.filter((v) => v.is_still_for_sale).length,
        vehicles: applied,
      });
    }

    // Process and save vehicles from an auction
    if (action === 'process') {
      if (!auction) {
        return okJson({ success: false, error: 'Auction code required' }, 400);
      }

      console.log(`[RMS] Processing auction: ${auction}`);
      const items = await fetchAuctionLots(auction);
      const vehicles = items.map((item) => transformLotItem(item, auction));

      const applied = limit ? vehicles.slice(0, limit) : vehicles;

      if (!save_to_db) {
        return okJson({
          success: true,
          auction,
          message: 'Dry run - no data saved. Set save_to_db: true to save.',
          total: vehicles.length,
          would_process: applied.length,
          sample: applied.slice(0, 5),
        });
      }

      // Process each vehicle
      const results = {
        created: 0,
        updated: 0,
        errors: [] as string[],
      };

      for (const vehicle of applied) {
        try {
          const { vehicleId, isNew } = await saveVehicle(supabase, vehicle);
          if (isNew) {
            results.created++;
          } else {
            results.updated++;
          }
          console.log(`[RMS] ${isNew ? 'Created' : 'Updated'}: ${vehicle.title} (${vehicleId})`);
        } catch (err: any) {
          results.errors.push(`${vehicle.title}: ${err.message}`);
          console.error(`[RMS] Error processing ${vehicle.title}:`, err);
        }
      }

      return okJson({
        success: true,
        auction,
        total_lots: vehicles.length,
        processed: applied.length,
        created: results.created,
        updated: results.updated,
        errors: results.errors.length,
        error_details: results.errors.slice(0, 10),
      });
    }

    // List all auctions and their lot counts
    if (action === 'list_all') {
      const auctions = getKnownAuctions();
      const results: any[] = [];

      for (const auc of auctions.slice(0, 5)) {
        // Limit to recent auctions
        try {
          const items = await fetchAuctionLots(auc.code);
          results.push({
            code: auc.code,
            name: auc.name,
            date: auc.date,
            lot_count: items.length,
            sold_count: items.filter((i) => i.sold).length,
          });
        } catch (err: any) {
          results.push({
            code: auc.code,
            name: auc.name,
            date: auc.date,
            error: err.message,
          });
        }
      }

      return okJson({
        success: true,
        auctions: results,
      });
    }

    // Extract single URL (for future expansion)
    if (action === 'extract') {
      if (!url || !url.includes('rmsothebys.com')) {
        return okJson({ success: false, error: 'Valid RM Sotheby\'s URL required' }, 400);
      }

      // Extract auction code from URL: /auctions/pa26/lots/...
      const auctionMatch = url.match(/\/auctions\/([a-z0-9]+)\//i);
      if (!auctionMatch) {
        return okJson({ success: false, error: 'Could not extract auction code from URL' }, 400);
      }

      const auctionCode = auctionMatch[1].toUpperCase();
      const items = await fetchAuctionLots(auctionCode);

      // Find the specific lot
      const targetPath = new URL(url).pathname;
      const item = items.find((i) => i.link === targetPath || url.includes(i.link));

      if (!item) {
        return okJson({ success: false, error: 'Lot not found in auction data' }, 404);
      }

      const vehicle = transformLotItem(item, auctionCode);

      if (save_to_db) {
        const { vehicleId, isNew } = await saveVehicle(supabase, vehicle);
        return okJson({
          success: true,
          vehicle,
          vehicle_id: vehicleId,
          is_new: isNew,
        });
      }

      return okJson({
        success: true,
        vehicle,
      });
    }

    return okJson({
      success: false,
      error: `Unknown action: ${action}`,
      valid_actions: ['auctions', 'list', 'process', 'list_all', 'extract'],
    }, 400);

  } catch (error: any) {
    console.error('[RMS] Error:', error);
    return okJson(
      { success: false, error: error.message },
      500
    );
  }
});
