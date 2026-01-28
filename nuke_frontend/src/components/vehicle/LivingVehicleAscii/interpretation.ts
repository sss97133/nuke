/**
 * Maps vehicle + pulse + intelligence → display state, shape, identity, pulse line.
 * See docs/design/LIVING_ASCII_VEHICLE_PROFILE.md.
 */

import type {
  VehicleAsciiSlice,
  VehicleIntelligenceSlice,
  AuctionPulseSlice,
  DisplayState,
  ShapeKey,
} from './types';

const BODY_KEYWORDS: Record<string, ShapeKey> = {
  pickup: 'truck',
  truck: 'truck',
  suv: 'suv',
  coupe: 'coupe',
  cabriolet: 'coupe',
  convertible: 'coupe',
  sedan: 'sedan',
};

function inferShapeKey(v: VehicleAsciiSlice): ShapeKey {
  const raw = [v.series, v.model, v.make]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  for (const [kw, key] of Object.entries(BODY_KEYWORDS)) {
    if (raw.includes(kw)) return key;
  }
  // Heuristics by model name
  if (/\b(f-?150|silverado|ram|tacoma|tundra|c-?10|square ?body)\b/i.test(raw))
    return 'truck';
  if (/\b(911|cayman|boxster|corvette|camaro|mustang|challenger)\b/i.test(raw))
    return 'coupe';
  return 'default';
}

export function getDisplayState(
  v: VehicleAsciiSlice,
  pulse?: AuctionPulseSlice | null
): DisplayState {
  const endDate = pulse?.end_date ?? v.auction_end_date;
  const now = new Date();
  const isEnded = endDate ? new Date(endDate) <= now : false;
  const outcome = v.auction_outcome;

  if (v.is_for_sale && !endDate) return 'for_sale';
  if (outcome === 'sold' || (outcome === 'ended' && (v.high_bid ?? v.sale_price))) return 'sold';
  if (outcome === 'reserve_not_met' || outcome === 'no_sale') return 'auction_ended';
  if (endDate && !isEnded && (pulse?.listing_status === 'active' || pulse?.current_bid != null))
    return 'live_auction';
  if (outcome === 'ended' || isEnded) return 'auction_ended';
  return 'unlisted';
}

export function getShapeKey(v: VehicleAsciiSlice): ShapeKey {
  return inferShapeKey(v);
}

export function getIdentityLine(v: VehicleAsciiSlice): string {
  const y = v.year ?? '';
  const mk = (v.make ?? '').trim();
  const md = (v.model ?? '').trim();
  return [y, mk, md].filter(Boolean).join(' ');
}

export function getPulseLine(
  v: VehicleAsciiSlice,
  state: DisplayState,
  pulse?: AuctionPulseSlice | null,
  formatCurrency?: (n: number | null | undefined) => string
): string {
  const fmt = formatCurrency ?? ((n: number | null | undefined) => (n != null ? `$${Number(n).toLocaleString()}` : '—'));

  if (state === 'live_auction') {
    const bid = pulse?.current_bid ?? v.current_bid;
    const bids = pulse?.bid_count ?? v.bid_count ?? 0;
    if (bid != null) return `LIVE · ${fmt(bid)} · ${bids} bid${bids !== 1 ? 's' : ''}`;
    return 'LIVE';
  }
  if (state === 'sold') {
    const amt = v.high_bid ?? v.sale_price;
    if (amt != null) return `SOLD · ${fmt(amt)}`;
    return 'SOLD';
  }
  if (state === 'auction_ended') {
    const amt = v.high_bid ?? v.sale_price;
    if (v.auction_outcome === 'reserve_not_met') return 'Reserve not met';
    if (amt != null) return `Ended · ${fmt(amt)}`;
    return 'Ended';
  }
  if (state === 'for_sale' && (v.asking_price ?? 0) > 0) {
    return fmt(v.asking_price);
  }
  return '';
}

/** One short line from vehicle_intelligence when no price/pulse dominates */
export function getIntelligenceLine(intel?: VehicleIntelligenceSlice | null): string {
  if (!intel) return '';
  if (intel.matching_numbers) return 'matching #s';
  if (intel.is_restored) return 'restored';
  if (
    intel.production_number != null &&
    intel.total_production != null &&
    intel.total_production > 0
  )
    return `${intel.production_number}/${intel.total_production}`;
  if (intel.owner_count === 1) return 'single family';
  if (intel.has_service_records) return 'service history';
  return '';
}
