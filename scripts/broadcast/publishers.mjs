/** One entry per auction house whose broadcast overlay we can read.
 * crop: ffmpeg filter selecting the band that holds the lot overlay.
 * parse(lines) -> { lot, title, sale, displayed_bid, displayed_ask, status } | null
 * auctionSource: auction_events.source for that house.
 * eventPlatforms: vehicle_events.source_platform values for that house (lot and sale live in metadata).
 * eventSaleFilter(sale), optional: PostgREST filter selecting that sale's vehicle_events.
 * saleMatches(sale, auctionEvent): does the event belong to the sale named on screen (or by saleFromMeta).
 * saleFromMeta(videoMeta), optional: { sale, basis } named by the video itself, used when the overlay names none.
 */
import { parseMecumOverlay } from './overlay-mecum.mjs';
import { parseBarrettJacksonOverlay, barrettJacksonSaleKey, barrettJacksonSaleFromMeta, barrettJacksonEventSaleKey }
  from './overlay-barrett-jackson.mjs';

const norm = s => String(s ?? '').toLowerCase().replace(/^mecum\s+/, '').replace(/[^a-z0-9]/g, '');

export const PUBLISHERS = {
  mecum: {
    crop: 'crop=iw:ih*0.24:0:0',
    parse: parseMecumOverlay,
    auctionSource: 'mecum',
    eventPlatforms: ['mecum'],
    eventSaleFilter: sale => `metadata->>auction_name=ilike.${encodeURIComponent(sale)}`,
    saleMatches: (sale, event) => Boolean(sale) && norm(sale) === norm(event.raw_data?.auction_name),
  },
  barrett_jackson: {
    // Lower-right box: LOT and bid row at ~0.80 of frame height, title (one or two lines, right-aligned,
    // reaching left to ~0.45 of frame width on the 2025 layout) below it.
    crop: 'crop=iw*0.67:ih*0.24:iw*0.33:ih*0.74',
    parse: parseBarrettJacksonOverlay,
    auctionSource: 'barrett-jackson',
    eventPlatforms: ['barrett-jackson', 'barrettjackson'],
    // Barrett-Jackson events carry the sale only in the docket URL slug (raw_data is empty).
    saleMatches: (sale, event) => {
      const key = barrettJacksonSaleKey(sale);
      return Boolean(key) && key === barrettJacksonEventSaleKey(event);
    },
    saleFromMeta: barrettJacksonSaleFromMeta,
  },
};

export function publisherFor(name) {
  const p = PUBLISHERS[name];
  if (!p) throw new Error(`No overlay reader for publisher "${name}" (have: ${Object.keys(PUBLISHERS).join(', ')})`);
  return p;
}
