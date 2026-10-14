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
 * Only vehicles are written (see lotKind.ts): RM's lot search also lists automobilia, boats and other lots, and
 * those are skipped. Every action that lists lots reports how many it skipped and why (skipped_by_reason), and
 * how many lots RM reported against how many it read (api_reported_total, duplicates_dropped; see lotPaging.ts).
 *
 * Deploy: supabase functions deploy extract-rmsothebys --no-verify-jwt
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveExistingVehicleId } from '../_shared/resolveVehicleForListing.ts';
import { writeObservation } from '../_shared/observationWriter.ts';
import { requireWriteAuth } from '../_shared/writeGuard.ts';
import { getKnownAuctions } from './knownAuctions.ts';
import { writeVehicleEventByKey } from '../_shared/vehicleEventWrite.ts';
import { rmLotLinkMatchesUrl, rmLotUrl } from './lotUrl.ts';
import { projectSecretKey } from "../_shared/supabaseKeys.ts";
import { classifyLot, partitionLots, type LotPartition } from './lotKind.ts';
import { collectLots, type CollectedLots } from './lotPaging.ts';
import { parseTitle } from './lotTitle.ts';
import { forEachConcurrent, readConcurrency } from './concurrency.ts';
import { saveVehicle as saveVehicleWith, type ExtractedVehicle, type SaveDeps } from './saveVehicle.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
  /** RM's category: 1 automobile, 2 automobilia, 3 motorcycle, 4 watercraft (see lotKind.ts). */
  categoryId?: number;
  isFavourite: boolean;
  won: boolean | null;
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
  const amount = numMatch ? parseInt(numMatch[1].replace(/,/g, ''), 10) : null;

  return { amount, currency, text };
}

// Fetch lots from RM Sotheby's API.
// The search pages from 1 (page 0 repeats page 1), caps pageSize at 200 (a larger value falls back to 40), and states
// pager.totalItems / pager.totalPages; lotPaging.ts reads those and returns each lot once. See that file for the
// measurements. 200 is the largest page size the API honors.
const RMS_PAGE_SIZE = 200;

function pagerNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

async function fetchAuctionLots(auctionCode: string): Promise<CollectedLots<RMSLotItem>> {
  return await collectLots<RMSLotItem>(async (page) => {
    const response = await fetch(
      `https://rmsothebys.com/api/search/SearchLots?page=${page}&pageSize=${RMS_PAGE_SIZE}`,
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
    const pager = data?.pager ?? {};
    return {
      items: Array.isArray(data?.items) ? (data.items as RMSLotItem[]) : [],
      // The old response shape put the total at the top level; keep reading it if it returns.
      totalItems: pagerNumber(pager.totalItems) ?? pagerNumber(data?.totalCount) ?? pagerNumber(data?.total),
      totalPages: pagerNumber(pager.totalPages),
    };
  });
}

// Transform API item to extracted vehicle
function transformLotItem(item: RMSLotItem, auctionCode: string): ExtractedVehicle {
  const { year, make, model } = parseTitle(item.publicName);
  const { amount, currency, text: valueText } = parseValue(item.value, item.valueType);

  // Determine if this is a sold price or estimate. "Not Sold" contains "sold": the old includes()
  // test turned unsold lots' low estimates into sale prices (82 rows measured 2026-09-27; lock 1
  // now refuses them). Sold = the API flag, or a value type that starts with "sold".
  const valueTypeLc = String(item.valueType || '').toLowerCase().trim();
  const isSold = item.sold === true || (valueTypeLc.startsWith('sold') && !valueTypeLc.includes('not sold') && !valueTypeLc.includes('unsold'));
  const soldPrice = isSold ? amount : null;
  const estimateText = !isSold ? valueText : item.preSaleEstimate || null;

  return {
    url: rmLotUrl(item.link), // the API returns absolute links since 2026-10; site-relative ones still get the origin
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
    sold: isSold,
    is_still_for_sale: item.isStillForSale,
    image_url: item.crop || null,
    rms_lot_id: item.biddingLotId,
    rms_auction_id: item.biddingAuctionId,
    bidding_type: item.biddingType,
    collection: item.collection || null,
    category_id: typeof item.categoryId === 'number' ? item.categoryId : null,
    auctioned: typeof item.auctioned === 'boolean' ? item.auctioned : null,
  };
}


// The real writers saveVehicle uses; saveVehicle.test.ts passes stand-ins.
const SAVE_DEPS: SaveDeps = {
  resolveExisting: resolveExistingVehicleId,
  writeObservation,
  writeEvent: writeVehicleEventByKey,
};
const saveVehicle = (supabase: any, vehicle: ExtractedVehicle) => saveVehicleWith(supabase, vehicle, SAVE_DEPS);

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// What a run read and what it will (or did not) write, in the response of every action that lists lots:
//   total_lots           lots read, each once (the old count was double: page 0 and page 1 were the same page)
//   api_reported_total   the total RM's pager reported; a difference from total_lots means a short read
//   duplicates_dropped   repeats the paging returned; 0 when the paging is right
//   vehicle_lots         lots the vehicles-only rule writes
//   skipped              lots it does not write, with skipped_by_reason (automobilia, watercraft, no_leading_year,
//                        no_plausible_year, no_make, category_<n>, category_missing) and the first ten as skipped_sample
function lotReport(collected: CollectedLots<RMSLotItem>, part: LotPartition<ExtractedVehicle>) {
  return {
    total_lots: collected.items.length,
    api_reported_total: collected.reported_total,
    duplicates_dropped: collected.duplicates_dropped,
    vehicle_lots: part.writable.length,
    skipped: part.skipped.length,
    skipped_by_reason: part.skipped_by_reason,
    skipped_sample: part.skipped.slice(0, 10),
  };
}

Deno.serve(async (req) => {
  // Writes are never anonymous: service key, signed-in user, or nothing (P0.2, 2026-09-27).
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { action = 'auctions', auction, url, save_to_db = false, limit, offset = 0 } = body;
    // Lots written at once by `process`. A first pass over a large auction took 127 s one lot at a time (see concurrency.ts).
    const concurrency = readConcurrency(body.concurrency, 4);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      projectSecretKey()!
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
      const collected = await fetchAuctionLots(auction);
      const vehicles = collected.items.map((item) => transformLotItem(item, auction));
      const part = partitionLots(vehicles);

      // A read-only listing shows every lot, each marked with what a process run would do with it.
      const applied = (limit ? vehicles.slice(offset, offset + limit) : vehicles.slice(offset)).map((v) => {
        const verdict = classifyLot({ categoryId: v.category_id, title: v.title });
        return { ...v, will_write: verdict.write, skip_reason: verdict.write ? null : verdict.reason };
      });

      return okJson({
        success: true,
        auction,
        total: vehicles.length,
        ...lotReport(collected, part),
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
      const collected = await fetchAuctionLots(auction);
      const vehicles = collected.items.map((item) => transformLotItem(item, auction));

      // Vehicles only. offset and limit bound the lots written, not the lots read, so limit is a write bound.
      const part = partitionLots(vehicles);
      const report = lotReport(collected, part);
      const applied = limit ? part.writable.slice(offset, offset + limit) : part.writable.slice(offset);
      if (part.skipped.length > 0) {
        console.log(`[RMS] ${auction}: skipping ${part.skipped.length} non-vehicle lots ${JSON.stringify(part.skipped_by_reason)}`);
      }

      if (!save_to_db) {
        return okJson({
          success: true,
          auction,
          message: 'Dry run - no data saved. Set save_to_db: true to save.',
          total: vehicles.length,
          ...report,
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

      await forEachConcurrent(applied, concurrency, async (vehicle) => {
        try {
          const saved = await saveVehicle(supabase, vehicle);
          if ('skipped' in saved) {
            // Not reachable for a lot the partition let through; if it happens the two rules disagree, so say so.
            results.errors.push(`${vehicle.title}: refused at write (${saved.skipped})`);
            return;
          }
          const { vehicleId, isNew } = saved;
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
      });

      return okJson({
        success: true,
        auction,
        ...report,
        concurrency,
        processed: applied.length,
        created: results.created,
        updated: results.updated,
        errors: results.errors.length,
        error_details: results.errors.slice(0, 10),
      });
    }

    // Process with HTML fallback — catches lots the API misses
    if (action === 'process_with_fallback') {
      if (!auction) {
        return okJson({ success: false, error: 'Auction code required' }, 400);
      }

      console.log(`[RMS] Process with fallback for: ${auction}`);

      // Step 1: Normal API extraction (vehicles only)
      const collected = await fetchAuctionLots(auction);
      const vehicles = collected.items.map((item) => transformLotItem(item, auction));
      const part = partitionLots(vehicles);
      const apiUrls = new Set(vehicles.map(v => v.url));

      const results = {
        api_lots: vehicles.length,
        html_extra: 0,
        // HTML-only lots carry no RM category, so the vehicles-only rule cannot clear them: they are not written.
        html_skipped: 0,
        created: 0,
        updated: 0,
        errors: [] as string[],
      };

      // Save API results
      for (const vehicle of part.writable) {
        try {
          const saved = await saveVehicle(supabase, vehicle);
          if ('skipped' in saved) {
            results.errors.push(`${vehicle.title}: refused at write (${saved.skipped})`);
            continue;
          }
          if (saved.isNew) results.created++;
          else results.updated++;
        } catch (err: any) {
          results.errors.push(`${vehicle.title}: ${err.message}`);
        }
      }

      // Step 2: Fetch auction HTML page to find lots not in API
      try {
        const htmlUrl = `https://rmsothebys.com/auctions/${auction.toLowerCase()}/lots/`;
        console.log(`[RMS] Fetching HTML fallback: ${htmlUrl}`);
        const htmlRes = await fetch(htmlUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'text/html',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(30000),
        });

        if (htmlRes.ok) {
          const html = await htmlRes.text();
          // Extract lot URLs from HTML: /auctions/{code}/lots/{slug}
          const lotUrlPattern = new RegExp(
            `href="(/auctions/${auction.toLowerCase()}/lots/[^"]+)"`,
            'gi'
          );
          const htmlLotUrls = new Set<string>();
          let match;
          while ((match = lotUrlPattern.exec(html)) !== null) {
            const fullUrl = `https://rmsothebys.com${match[1]}`;
            if (!apiUrls.has(fullUrl)) {
              htmlLotUrls.add(fullUrl);
            }
          }

          console.log(`[RMS] Found ${htmlLotUrls.size} lot URLs in HTML not in API`);

          // For each missing lot, try to extract from individual page
          for (const lotUrl of htmlLotUrls) {
            try {
              const lotRes = await fetch(lotUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                  'Accept': 'text/html',
                },
                redirect: 'follow',
                signal: AbortSignal.timeout(15000),
              });

              if (!lotRes.ok) continue;
              const lotHtml = await lotRes.text();

              // Extract basic data from individual lot page
              const titleMatch = lotHtml.match(/<h1[^>]*>([^<]+)<\/h1>/i);
              const title = titleMatch?.[1]?.trim() || null;
              if (!title) continue;

              const { year, make, model } = parseTitle(title);

              // Try to find lot number
              const lotNumMatch = lotHtml.match(/Lot\s*(\d+)/i);
              const lotNumber = lotNumMatch?.[1] || null;

              // Try to find price
              const priceMatch = lotHtml.match(/(?:Sold\s+For|Hammer\s+Price)[^$€£]*?([\d,]+)/i);
              const soldPrice = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;

              const fallbackVehicle: ExtractedVehicle = {
                url: lotUrl,
                title: title || 'Unknown',
                year,
                make,
                model,
                lot_number: lotNumber || '',
                auction_name: auction,
                auction_code: auction.toUpperCase(),
                estimate_text: null,
                sold_price: soldPrice,
                sold_price_text: null,
                currency: null,
                sold: !!soldPrice,
                is_still_for_sale: false,
                image_url: null,
                rms_lot_id: '',
                rms_auction_id: '',
                bidding_type: '',
                collection: null,
                category_id: null,
                auctioned: null,
              };

              const saved = await saveVehicle(supabase, fallbackVehicle);
              if ('skipped' in saved) {
                results.html_skipped++;
                console.log(`[RMS] HTML fallback skipped (${saved.skipped}): ${title}`);
              } else {
                results.html_extra++;
                if (saved.isNew) results.created++;
                else results.updated++;
                console.log(`[RMS] HTML fallback: ${title}`);
              }
            } catch (err: any) {
              results.errors.push(`HTML fallback ${lotUrl}: ${err.message}`);
            }

            // Small delay between individual page fetches
            await new Promise(r => setTimeout(r, 500));
          }
        }
      } catch (htmlErr: any) {
        console.error(`[RMS] HTML fallback fetch error: ${htmlErr.message}`);
      }

      return okJson({
        success: true,
        auction,
        ...lotReport(collected, part),
        api_lots: results.api_lots,
        html_extra_lots: results.html_extra,
        html_skipped_lots: results.html_skipped,
        total_processed: part.writable.length + results.html_extra,
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
          const { items } = await fetchAuctionLots(auc.code);
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
      const { items } = await fetchAuctionLots(auctionCode);

      // Find the specific lot
      const item = items.find((i) => rmLotLinkMatchesUrl(i.link, url));

      if (!item) {
        return okJson({ success: false, error: 'Lot not found in auction data' }, 404);
      }

      const vehicle = transformLotItem(item, auctionCode);

      // A lot that is not a vehicle is reported the way the callers already read it: ingest takes skipped:true as
      // "not a vehicle listing", and process-import-queue files an error that says "No vehicle data found" as skipped.
      const verdict = classifyLot({ categoryId: vehicle.category_id, title: vehicle.title });
      if (!verdict.write) {
        return okJson({
          success: false,
          skipped: true,
          skip_reason: verdict.reason,
          error: `No vehicle data found: RM Sotheby's lists this lot as ${verdict.reason} (categoryId ${vehicle.category_id ?? 'missing'}), not a vehicle`,
          vehicle,
        });
      }

      if (save_to_db) {
        const saved = await saveVehicle(supabase, vehicle);
        if ('skipped' in saved) {
          return okJson({ success: false, skipped: true, skip_reason: saved.skipped, error: `No vehicle data found: ${saved.skipped}`, vehicle });
        }
        return okJson({
          success: true,
          vehicle,
          vehicle_id: saved.vehicleId,
          is_new: saved.isNew,
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
