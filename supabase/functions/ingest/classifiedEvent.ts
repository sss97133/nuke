/**
 * ingest/classifiedEvent.ts — the listing projection for classified sources other than Craigslist.
 *
 * Craigslist lands a vehicle_events row (event_type 'listing', current_price = the asking price) through
 * ./craigslistCapture.ts; the classified board (classified_ask_board) reads that row. ClassicCars and KSL landed only
 * vehicles.asking_price, so they never reached the board (skylar-08, 2026-10-15 06:15Z: ClassicCars 10 vehicles, 7
 * priced, no listing event, is_for_sale false). This writes the same projection for them, and marks the vehicle for sale.
 *
 * The event is keyed by (vehicle, source_platform, source_listing_id) and written through writeVehicleEventByKey, so a
 * re-read of the same listing updates the row. event_status stays 'unknown' (preserveEventStatus): a classified is
 * live when read, and its ending is recorded by a removal read, never guessed here.
 */
import { writeVehicleEventByKey, type VehicleEventWriteResult } from "../_shared/vehicleEventWrite.ts";

export type ClassifiedPlatform = "classiccars" | "ksl" | "facebook_marketplace";

export function classifiedPlatform(url: string | null | undefined): ClassifiedPlatform | null {
  try {
    const u = new URL(String(url));
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "classiccars.com" && /^\/listings\/view\/\d+/.test(u.pathname)) return "classiccars";
    if (host === "cars.ksl.com" && /^\/listing\/\d+/.test(u.pathname)) return "ksl";
    if ((host === "facebook.com" || host === "m.facebook.com") && /^\/marketplace\/item\/\d+/.test(u.pathname)) return "facebook_marketplace";
  } catch { /* not a URL */ }
  return null;
}

export function classifiedListingId(url: string | null | undefined): string | null {
  return String(url ?? "").match(/\/listings\/view\/(\d+)|\/listing\/(\d+)|\/marketplace\/item\/(\d+)/)?.slice(1).find(Boolean) ?? null;
}

type Client = { from: (table: string) => any };

export interface ClassifiedLanding {
  event: VehicleEventWriteResult;
  for_sale: "set" | "already" | "error";
}

export async function landClassifiedListing(
  supabase: Client,
  a: {
    vehicleId: string; platform: ClassifiedPlatform; listingUrl: string; listingId: string;
    price: number | null; postedAt: string | null; observedAt: string;
  },
): Promise<ClassifiedLanding> {
  const event = await writeVehicleEventByKey(supabase, {
    vehicle_id: a.vehicleId,
    source_platform: a.platform,
    source_listing_id: a.listingId,
    source_url: a.listingUrl,
    event_type: "listing",
    event_status: "unknown",
    ...(a.price != null && a.price > 0 ? { current_price: a.price } : {}),
    metadata: {
      source: "ingest",
      source_observed_at: a.observedAt,
      ...(a.postedAt ? { listing_posted_at: a.postedAt } : {}),
    },
  }, { preserveEventStatus: true, sourceObservedAt: a.observedAt });

  let for_sale: ClassifiedLanding["for_sale"] = "already";
  try {
    const { data, error } = await supabase.from("vehicles").update({ is_for_sale: true })
      .eq("id", a.vehicleId).not("is_for_sale", "is", true).select("id");
    for_sale = error ? "error" : data?.length ? "set" : "already";
  } catch { for_sale = "error"; }
  return { event, for_sale };
}
