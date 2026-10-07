// Synthetic fixtures for the Forecast panel's tests: a live lot read, and the forecast route's body for it. The shapes are the
// reader's (live_lot_temperature_at, PR #771) and the route's (forecast.ts, PR #773), read from their code and a capture of
// the reader on 2026-10-07; every name and number here is made up. Tests only: nothing in the app imports this file.
import { shapeOrderBook, type CommentRow, type LotRow, type OrderBookRead, type OrderBookView } from './orderBookReader';

export const VEHICLE_ID = '00000000-0000-4000-8000-000000000001';
export const LOT_ID = '00000000-0000-4000-8000-0000000000a1';
export const ID_A = '00000000-0000-4000-8000-00000000aaaa';
export const ID_B = '00000000-0000-4000-8000-00000000bbbb';
export const LOT_URL = 'https://bringatrailer.com/listing/synthetic-lot-1';
export const CLOSE = Date.parse('2026-10-12T20:30:00Z');
/** When the stored lot state was true: the lot row's last write. */
export const AS_OF = Date.parse('2026-10-07T06:54:41.400Z');
export const iso = (ms: number) => new Date(ms).toISOString();

let n = 0;
export function bidRow(amount: number, minutesBefore: number, identity: string | null, changes: Partial<CommentRow> = {}): CommentRow {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, posted_at: iso(AS_OF - minutesBefore * 60_000), created_at: iso(AS_OF - minutesBefore * 60_000 + 5_000),
    comment_type: 'bid', bid_amount: amount, author_username: identity ? null : 'unkeyed-handle', external_identity_id: identity, is_seller: false,
    bat_comment_id: 100 + n, source_url: `${LOT_URL}/`, comment_text: null, ...changes,
  };
}

export function liveLot(changes: Partial<LotRow> = {}): LotRow {
  return {
    id: LOT_ID, source: 'bat', source_url: LOT_URL, lot_number: '1', outcome: 'live', auction_end_date: iso(CLOSE),
    high_bid: 11250, winning_bid: null, total_bids: 3, seller_name: 'seller-text', seller_external_identity_id: null,
    winning_bidder: null, winning_bidder_external_identity_id: null, updated_at: iso(AS_OF), ...changes,
  };
}

/** A live lot the way the order-book reader returns it: three bids by two identities, all keyed, read two minutes after its last write. */
export function liveRead(changes: Partial<OrderBookRead> = {}, lot: Partial<LotRow> = {}): OrderBookRead {
  const l = liveLot(lot);
  return {
    vehicle: { id: VEHICLE_ID, year: 2000, make: 'Synthetic', model: 'Coupe', listing_url: LOT_URL, sale_status: 'auction_live' },
    lots: [l], lot: l,
    comments: [bidRow(10000, 600, ID_A), bidRow(10750, 300, ID_B), bidRow(11250, 120, ID_A)],
    unkeyedOnUrl: 0, frames: [], readAt: iso(AS_OF + 120_000),
    identities: { [ID_A]: { id: ID_A, platform: 'bat', handle: 'bidder-a' }, [ID_B]: { id: ID_B, platform: 'bat', handle: 'bidder-b' } },
    ...changes,
  };
}

/** The view the page shapes from a read; a read with no lot has none, and these fixtures always have one. */
export function viewOf(read: OrderBookRead): OrderBookView {
  const view = shapeOrderBook(read);
  if (!view) throw new Error('the fixture read has no lot');
  return view;
}

const BASIS_HOURS = 'comparables are read the same time before their own final close';

/** The reader's ok answer in the hours regime: 36 of 38 sold lots, band 11,250 to 26,291. */
export function hoursForecast(asOf = AS_OF, endsAt = CLOSE, changes: Record<string, unknown> = {}) {
  return {
    status: 'ok', reader: 'live_lot_temperature_at', as_of: iso(asOf),
    lot: { auction_event_id: LOT_ID, vehicle_id: VEHICLE_ID, slug: 'synthetic-lot-1', year: 2000, make: 'Synthetic', model: 'Coupe' },
    input: { at: iso(asOf), bid: 11250, bidders: 2 },
    clock: { basis: BASIS_HOURS, ends_at: iso(endsAt), ends_at_source: 'argument', seconds_left: (endsAt - asOf) / 1000, regime: 'hours', extensions: 0, extensions_basis: '120 s or more left: the close cannot have moved' },
    cohort: {
      level: 1, key: { make: 'Synthetic', model: 'Coupe', model_family: null }, denominator: 38, denominator_is_a_floor: false, n_comparables: 36,
      funnel: { closed_lots: 44, read: 38, sold_with_hammer: 38, no_bid_yet_at_this_time: 0, with_a_bid_at_this_time: 36, bid_log_reproduces_hammer: 36 },
    },
    cohort_miss: null,
    position: {
      basis: 'the lot against the cohort\'s comparables the same time before their own close', seconds_left: (endsAt - asOf) / 1000,
      price: { bid: 11250, n: 36, below: 25, same: 0, above: 11, percentile: 0.6944 },
      bidders: { bidders: 2, n: 36, below: 10, same: 5, above: 21, percentile: 0.3472 },
    },
    band: {
      level: 0.8, n: 36, denominator: 38, denominator_is_a_floor: false, rank_high: 30, ratio_high: 2.337, ratio_mid: 1.6942, ratio_low: 1,
      low: 11250, mid: 19059, high: 26291, bid: 11250, coverage_if_exchangeable: 0.8108, method: 'cohort_ratio_upper_order_statistic', pool: null,
      applies_to: 'the hammer of a lot that sells; every comparable sold, so a lot that ends under its reserve has no hammer to bracket',
    },
    band_unavailable: null,
    coverage: {
      as_of: iso(asOf),
      bid_rows: { n: 3, bidders: 2, max_bid: 11250, first_posted_at: iso(asOf - 600 * 60_000), last_posted_at: iso(asOf - 120 * 60_000), rows_in_last_15_min: 0, agrees_with_input_bid: true },
      live_frames: { n: 0, frames_in_last_15_min: 0, minutes_with_a_frame_of_last_15: 0, first_observed_at: null, last_observed_at: null },
    },
    prior: null,
    ...changes,
  };
}

/** The reader's answer when the lot's make and model have too few sold lots: a cohort miss, with every denominator. */
export function missForecast(asOf = AS_OF, endsAt = CLOSE) {
  return hoursForecast(asOf, endsAt, {
    cohort: { level: null, key: { make: 'Synthetic', model: 'Coupe', model_family: null }, denominator: null, denominator_is_a_floor: null, n_comparables: 0, funnel: { closed_lots: 3, read: 0, sold_with_hammer: 0 } },
    cohort_miss: {
      level: 'exact make and model text', reason: 'fewer than 9 sold BaT lots have this make and model text', make: 'Synthetic', model: 'Coupe', model_family: null,
      denominator: { closed_lots_with_this_text: 3, sold_with_this_text: 2, vehicles_with_this_make_to_10000: 555, closed_lots_in_the_model_family: 0, sold_in_the_model_family: 0 },
      resolved_by: null, family_note: 'the lot\'s vehicle has no normalized_model, so there is no wider level to try',
    },
    position: null, band: null,
    band_unavailable: { reason: 'no cohort: see cohort_miss', n: 0, min_n: 9, sold_lots_found: 2 },
  });
}

/** The reader's ok answer when the exact text is short and the model family resolves the cohort (level 2): a cohort_miss that resolved, and a band. */
export function familyForecast(asOf = AS_OF, endsAt = CLOSE) {
  return hoursForecast(asOf, endsAt, {
    cohort: {
      level: 2, key: { make: 'Synthetic', model: 'Coupe GT', model_family: 'coupe' }, denominator: 35, denominator_is_a_floor: false, n_comparables: 35,
      funnel: { closed_lots: 45, read: 35, sold_with_hammer: 35, no_bid_yet_at_this_time: 0, with_a_bid_at_this_time: 35, bid_log_reproduces_hammer: 35 },
    },
    cohort_miss: {
      level: 'exact make and model text', reason: 'fewer than 9 sold BaT lots have this make and model text', make: 'Synthetic', model: 'Coupe GT', model_family: 'coupe',
      denominator: { closed_lots_with_this_text: 1, sold_with_this_text: 0, vehicles_with_this_make_to_10000: null, closed_lots_in_the_model_family: 45, sold_in_the_model_family: 35 },
      resolved_by: 'make and model family (normalized_model)', family_note: null,
    },
    band: { ...(hoursForecast().band as object), n: 35, denominator: 35, rank_high: 29 },
  });
}

/** The reader's ok answer in the last hour: the band from followed lots across cohorts, with no position. */
export function minutesForecast(asOf: number, endsAt: number) {
  return hoursForecast(asOf, endsAt, {
    clock: { basis: 'comparables are lots with a recorded clock in the same soft-close state', ends_at: iso(endsAt), ends_at_source: 'argument', seconds_left: (endsAt - asOf) / 1000, regime: 'minutes', extensions: 0, extensions_basis: 'argument' },
    cohort: { level: null, key: { make: 'Synthetic', model: 'Coupe', model_family: null }, denominator: null, n_comparables: null, how: 'not read in the minutes regime' },
    position: null,
    band: {
      level: 0.8, n: 92, denominator: 300, denominator_is_a_floor: false, rank_high: 75, ratio_high: 1.3488, low: 11250, mid: 12504, high: 15175, bid: 11250, coverage_if_exchangeable: 0.8065,
      method: 'clocked_lots_ratio_upper_order_statistic', applies_to: 'the hammer of a lot that sells; every comparable sold, so a lot that ends under its reserve has no hammer to bracket',
      pool: { price_tier: 'a', tier_alone: true, extensions: 0, seconds_since_last_bid: null, funnel: { clocked_sold_lots_read: 300, scheduled_close_known: 299, bid_log_reproduces_hammer: 292, in_the_same_state_with_a_bid: 154, in_the_sample: 92 } },
    },
  });
}

/** The route's body around a reader answer. `ageS` is how old the numbers were when the route read them. */
export function routeBody(forecast: Record<string, unknown>, opts: { asOf?: number; ageS?: number; endsAt?: number } = {}) {
  const asOf = opts.asOf ?? AS_OF;
  const serverNow = asOf + (opts.ageS ?? 60) * 1000;
  return {
    data: {
      forecast,
      resolution: { by: 'lot', path: 'auction_events.id', key: null, auction_event_id: LOT_ID, vehicle_id: VEHICLE_ID, source_url: LOT_URL, candidates: 1, rule: 'the id given' },
      clocks: {
        server_now: iso(serverNow), at: iso(asOf), at_source: 'argument', at_minus_server_now_s: -(opts.ageS ?? 60), ends_at_argument: iso(opts.endsAt ?? CLOSE), extensions_argument: null,
        stored_close: iso(opts.endsAt ?? CLOSE), stored_lot_read_at: iso(asOf), stored_outcome: 'live', stored_high_bid: 11250, stored_total_bids: 3,
      },
      reader: { name: 'live_lot_temperature_at', elapsed_ms: 412 },
    },
  };
}
