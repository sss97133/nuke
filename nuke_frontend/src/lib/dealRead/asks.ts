/**
 * Live asks — the cohort's marketplace listings, read from `vehicles` rows that
 * carry an asking price and no sale, plus each row's latest `listing`
 * observation (the seller's claims with source URL and observed_at).
 *
 * Asks and sales are opposite species (THEORY.md): a cleared price is a floor
 * of reality, an ask is where a seller stands today, and an ask that rots is
 * evidence of where reality isn't. So an ask is shown with the day it was
 * first seen and how long the seller says it has been listed, never averaged
 * into the sales record.
 */

import { classifyEngine, type EngineClass } from './batComps';

export interface AskVehicleRow {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  asking_price: number | null;
  price: number | null;
  sale_price: number | null;
  sale_status: string | null;
  listing_url: string | null;
  listing_source: string | null;
  source: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  mileage: number | null;
  transmission: string | null;
  engine_type: string | null;
  engine_size: string | null;
  color: string | null;
  created_at: string | null;
}

export interface ListingObservationRow {
  id: string;
  vehicle_id: string | null;
  observed_at: string;
  source_url: string | null;
  structured_data: Record<string, unknown> | null;
}

export interface Ask {
  vehicleId: string;
  title: string;
  year: number | null;
  price: number;
  previousPrice: number | null;
  firm: boolean;
  location: string | null;
  listingUrl: string | null;
  venue: string;
  /** when Nuke first held the row (ISO date) */
  firstSeen: string | null;
  /** when the listing was read for the observation (ISO date-time) */
  observedAt: string | null;
  observationId: string | null;
  /** the seller's "listed N weeks", as days, when the observation carries it */
  listedDays: number | null;
  roadReady: boolean | null;
  runs: string | null;
  rust: string | null;
  engineText: string;
  engine: EngineClass;
  mileage: number | null;
  sameSellerAsItem: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);

/** The marketplace item id in a listing URL (Facebook / Craigslist), for "same seller" cross-references. */
export function listingItemId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /marketplace\/item\/(\d+)/.exec(url) ?? /\/(\d+)\.html/.exec(url);
  return m ? m[1] : null;
}

export function buildAsks(rows: AskVehicleRow[], observations: ListingObservationRow[]): Ask[] {
  const latest = new Map<string, ListingObservationRow>();
  for (const o of observations) {
    if (!o.vehicle_id) continue;
    const prev = latest.get(o.vehicle_id);
    if (!prev || o.observed_at > prev.observed_at) latest.set(o.vehicle_id, o);
  }
  const asks: Ask[] = [];
  for (const v of rows) {
    const price = v.asking_price ?? null;
    if (price == null || price <= 0) continue;
    if ((v.sale_price ?? 0) > 0 || v.sale_status === 'sold') continue; // a sale is not an ask
    const o = latest.get(v.id) ?? null;
    const sd = (o?.structured_data ?? {}) as Record<string, unknown>;
    const engineText = v.engine_size || v.engine_type || str(sd.engine) || '';
    asks.push({
      vehicleId: v.id,
      title: [v.year, v.make, v.model, v.trim].filter(Boolean).join(' '),
      year: v.year,
      price,
      previousPrice: num(sd.asking_price_previous),
      firm: sd.firm === true,
      location: v.location ?? [v.city, v.state].filter(Boolean).join(', ') ?? null,
      listingUrl: v.listing_url,
      venue: (v.listing_source || v.source || 'listing').replace(/[_-]/g, ' '),
      firstSeen: v.created_at ? v.created_at.slice(0, 10) : null,
      observedAt: o?.observed_at ?? null,
      observationId: o?.id ?? null,
      listedDays: num(sd.listed_for_approx_days),
      roadReady: typeof sd.road_ready === 'boolean' ? (sd.road_ready as boolean) : null,
      runs: str(sd.runs),
      rust: str(sd.rust) ?? str(sd.body),
      engineText,
      engine: classifyEngine(engineText, v.model),
      mileage: v.mileage,
      sameSellerAsItem: str(sd.same_seller_as_item),
    });
  }
  asks.sort((a, b) => a.price - b.price);
  return asks;
}
