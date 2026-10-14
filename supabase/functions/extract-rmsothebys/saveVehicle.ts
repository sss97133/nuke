// Save one RM Sotheby's lot: find the vehicle it already is, or create it, then write its auction episode.
//
// Moved out of index.ts so it can be tested against a stub client (saveVehicle.test.ts); index.ts supplies the real
// writers. The behavior changes made when it moved:
//   - a lot that is not a vehicle is refused here (see lotKind.ts), so no action can write one;
//   - a vehicle a listing feed wrote, which has a listing_url but no discovery_url and no event, is found by
//     listing_url (with or without RM's trailing slash) instead of being written a second time;
//   - the auction episode (and the timeline row, once) is written for a vehicle that was found, not only one that was
//     created, so an upcoming lot becomes sold after its sale and a feed-written vehicle gets an episode;
//   - an upcoming lot's status is 'upcoming' / 'pending' (see lotStatus.ts) and its re-read is a 'listing' observation;
//   - the timeline row needs a known sale day; the day of extraction is not the day of the sale.
import { normalizeListingUrlKey } from '../_shared/listingUrl.ts';
import { discoveryUrlIlikePattern } from '../_shared/resolveVehicleForListing.ts';
import { normalizeVehicleFields } from '../_shared/normalizeVehicle.ts';
import { getKnownAuctions } from './knownAuctions.ts';
import { classifyLot, type LotSkipReason } from './lotKind.ts';
import { lotStatus } from './lotStatus.ts';
import { rmListingUrlVariants } from './lotUrl.ts';

// RM Sotheby's - we'll store metadata in origin_metadata instead of linking to org table
const RM_SOTHEBYS_NAME = "RM Sotheby's";

export interface ExtractedVehicle {
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
  /** RM's categoryId; null where the lot did not come from the lot search (an HTML page). */
  category_id: number | null;
  /** RM's `auctioned`: true once the lot has been through the sale; null where unknown. */
  auctioned: boolean | null;
}

/** The writers saveVehicle calls, passed in so a test can stand in for them. index.ts passes the real ones. */
export interface SaveDeps {
  resolveExisting: (
    supabase: any,
    options: { url: string; platform: string; discoveryUrlIlikePattern?: string | null },
  ) => Promise<{ vehicleId: string | null }>;
  // `any` parameters: the real writers type their inputs more tightly and are passed here as they are.
  writeObservation: (supabase: any, input: any) => Promise<unknown>;
  writeEvent: (supabase: any, row: any) => Promise<{ action: string; error?: string; reason?: string }>;
}

export type SaveResult = { vehicleId: string; isNew: boolean } | { skipped: LotSkipReason };

// Save extracted vehicle to database.
// The one place a lot becomes a row, so the vehicles-only rule lives here: every action that writes (process,
// process_with_fallback, extract) is held to it, and a lot that is not a vehicle comes back as { skipped: reason }.
export async function saveVehicle(
  supabase: any,
  vehicle: ExtractedVehicle,
  deps: SaveDeps,
): Promise<SaveResult> {
  const verdict = classifyLot({ categoryId: vehicle.category_id, title: vehicle.title });
  if (!verdict.write) return { skipped: verdict.reason };

  const status = lotStatus({ sold: vehicle.sold, auctioned: vehicle.auctioned, is_still_for_sale: vehicle.is_still_for_sale });
  const listingUrlKey = normalizeListingUrlKey(vehicle.url);

  // Resolve existing vehicle (listing key, discovery_url exact, or URL pattern) to avoid duplicate
  let { vehicleId: resolvedId } = await deps.resolveExisting(supabase, {
    url: vehicle.url,
    platform: 'rmsothebys',
    discoveryUrlIlikePattern: discoveryUrlIlikePattern(vehicle.url),
  });

  // The resolver looks at events and discovery_url only. A vehicle a listing feed wrote carries listing_url and neither
  // (37 of the 192 MO26 vehicle lots on 2026-10-14), and RM's link ends in a slash where the stored URL does not. Without
  // this lookup each of them is written a second time, with a listing_url that differs only by the slash.
  if (!resolvedId) {
    const { data: byListingUrl } = await supabase
      .from('vehicles')
      .select('id')
      .in('listing_url', rmListingUrlVariants(vehicle.url))
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();
    resolvedId = byListingUrl?.id ?? null;
  }

  let vehicleId: string;
  let isNew: boolean;

  if (resolvedId) {
    await supabase
      .from('vehicles')
      .update({
        sale_price: vehicle.sold_price,
        sale_status: status.sale_status,
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', resolvedId);

    // Fire-and-forget observation write
    const obsFields: Record<string, any> = {};
    if (vehicle.year) obsFields.year = vehicle.year;
    if (vehicle.make) obsFields.make = vehicle.make;
    if (vehicle.model) obsFields.model = vehicle.model;
    if (vehicle.sold_price) obsFields.sale_price = vehicle.sold_price;
    deps.writeObservation(supabase, {
      vehicleId: resolvedId,
      source: { platform: "rmsothebys", url: vehicle.url, trustScore: 0.85 },
      fields: obsFields,
      // A re-read of an upcoming or unsold lot is a listing, not a sale result (the new-vehicle path already says so).
      observationKind: vehicle.sold ? "sale_result" : "listing",
      extractionMethod: "rmsothebys_api",
    }).catch((e: any) => console.warn(`[RMS] observationWriter error for ${resolvedId}: ${e?.message}`));

    vehicleId = resolvedId;
    isNew = false;
  } else {
    // Normalize before insert
    const normalized = normalizeVehicleFields({ make: vehicle.make, model: vehicle.model, year: vehicle.year });

    // Create new vehicle
    const { data: newVehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .insert({
        year: normalized.year ?? vehicle.year,
        make: normalized.make ?? vehicle.make,
        model: normalized.model ?? vehicle.model,
        sale_price: vehicle.sold_price,
        sale_status: status.sale_status,
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
      .maybeSingle();

    if (vehicleError) {
      throw new Error(`Failed to create vehicle: ${vehicleError.message}`);
    }

    vehicleId = newVehicle.id;
    isNew = true;

    // Fire-and-forget observation write for new vehicle
    {
      const obsFields: Record<string, any> = {};
      if (vehicle.year) obsFields.year = vehicle.year;
      if (vehicle.make) obsFields.make = vehicle.make;
      if (vehicle.model) obsFields.model = vehicle.model;
      if (vehicle.sold_price) obsFields.sale_price = vehicle.sold_price;
      if (vehicle.lot_number) obsFields.lot_number = vehicle.lot_number;
      deps.writeObservation(supabase, {
        vehicleId,
        source: { platform: "rmsothebys", url: vehicle.url, trustScore: 0.85 },
        fields: obsFields,
        observationKind: vehicle.sold ? "sale_result" : "listing",
        extractionMethod: "rmsothebys_api",
      }).catch((e: any) => console.warn(`[RMS] observationWriter error for ${vehicleId}: ${e?.message}`));
    }

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
  }

  // The auction episode is written for a vehicle that was found as well as one that was created. A found vehicle
  // used to get only its price and status, so a lot that was upcoming when first read stayed 'pending' after the sale,
  // and a vehicle a listing feed wrote never got an episode at all.
  // Resolve the real auction (sale) date from the auction code, not extraction time.
  const knownAuctionDate = getKnownAuctions()
    .find(a => a.code === vehicle.auction_code)?.date || null;
  const soldAtIso = vehicle.sold
    ? (knownAuctionDate ? new Date(`${knownAuctionDate}T12:00:00Z`).toISOString() : null)
    : null;

  // Create vehicle_events record by its listing key (see _shared/vehicleEventWrite.ts for why not upsert)
  const episode = await deps.writeEvent(supabase, {
    vehicle_id: vehicleId,
    source_platform: 'rmsothebys',
    event_type: 'auction',
    source_url: vehicle.url,
    source_listing_id: listingUrlKey || vehicle.lot_number,
    event_status: status.event_status,
    final_price: vehicle.sold_price,
    sold_at: soldAtIso,
    metadata: {
      lot_number: vehicle.lot_number,
      auction_name: vehicle.auction_name,
      auction_code: vehicle.auction_code,
      estimate_text: vehicle.estimate_text,
      currency: vehicle.currency,
      collection: vehicle.collection,
      bidding_type: vehicle.bidding_type,
    },
  });
  if (episode.action === 'error' || episode.action === 'skipped') {
    console.error(`[RMS] vehicle_event not written (${episode.action}): ${'error' in episode ? episode.error : episode.reason}`);
  }

  // Create timeline event, once: when this run creates the vehicle or the episode, never on a re-read of a known sale.
  // And only with a known sale day: the day of extraction is not the day of the sale.
  if ((isNew || episode.action === 'inserted') && vehicle.sold && vehicle.sold_price && knownAuctionDate) {
    await supabase.from('timeline_events').insert({
      vehicle_id: vehicleId,
      event_type: 'auction_sold',
      event_date: knownAuctionDate,
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

  return { vehicleId, isNew };
}
