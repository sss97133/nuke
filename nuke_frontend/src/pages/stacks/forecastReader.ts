import { useQuery } from '@tanstack/react-query';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../../lib/supabase';
import type { LotRow, OrderBookView } from './orderBookReader';

// The Forecast panel's reader (case ledger §13.7, the CLI auction coach, step 4). The reader is
// public.live_lot_temperature_at (PR #771): the 80% band for a live lot's hammer, from comparable sold lots read the same
// time before their own close, with the lot's position among them. EXECUTE is service_role only, so the page does not
// call it. It calls the route that wraps it, GET api-v1-vehicle-auction/forecast (PR #773), the way api-v1-comps is
// called from the app: the signed-in session's access token as the bearer, the public anon key as the apikey. Signed
// out, nothing is called and no number is shown.
//
// The page passes the lot's stored state and the clock that state is as of (the lot row's last write), exactly what
// `nuke lot` does with a lot page's numbers and its render clock. It never reads Bring a Trailer from the browser.
// Pure shaping lives here so the panel and the tests use the same functions.

export const FORECAST_PATH = 'api-v1-vehicle-auction/forecast';

/** The CLI's rule (nuke lot, nuke_lot_forecast): inside the last 10 minutes, state older than 60 s is not the live state. */
export const STALE_WINDOW_S = 600;
export const STALE_AGE_S = 60;
/** A cohort the reader has not read recently takes up to 15 s; the route's own limit is the same, so wait a little longer. */
export const FORECAST_TIMEOUT_MS = 45_000;
/** Inside this many seconds of the close the forecast is read again every minute, so the age of its numbers stays true. */
const REREAD_WITHIN_S = 3600;

// --- What the page asks ----------------------------------------------------------------------------------------------

export interface ForecastRequest {
  lotId: string;
  /** The lot's stored high bid. */
  bid: number;
  /** Distinct bidders, only when the lot's bid rows add up to the bid count the lot row reports; else null. */
  bidders: number | null;
  /** Why bidders is not sent, or null when it is. */
  biddersWhy: string | null;
  /** When the stored state was true: the lot row's last write, ISO 8601 with an offset. */
  at: string;
  /** The close as last read (it moves with soft-close extensions while the lot is live), ISO 8601 with an offset. */
  endsAt: string;
  /** The lot row's own bid count, the denominator of the reader's bid rows. */
  totalBids: number | null;
}

export type ForecastGate =
  | { kind: 'ask'; request: ForecastRequest }
  | { kind: 'closed'; closeAt: number }
  | { kind: 'no_close' }
  | { kind: 'no_bid' }
  | { kind: 'no_state' };

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const time = (v: unknown): number | null => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** Bidders as the CLI sends them: only when the bid rows add up to the lot's own bid count and every bid has an identity. */
export function biddersFor(lot: LotRow, view: OrderBookView): { bidders: number | null; why: string | null } {
  const bids = view.bids;
  const total = lot.total_bids;
  if (total == null) return { bidders: null, why: 'the lot row reports no bid count to check the bid rows against' };
  if (bids.length !== total) return { bidders: null, why: `${bids.length} bid rows held of the ${total} the lot row reports` };
  const unkeyed = bids.filter((b) => !b.identityId).length;
  if (unkeyed > 0) return { bidders: null, why: `${unkeyed} of ${bids.length} bids carry no identity key, so their authors are not unified` };
  return { bidders: new Set(bids.map((b) => b.identityId)).size, why: null };
}

/** Whether to ask, and with what: the lot's stored state, or the reason this lot has no forecast to ask for. */
export function forecastGate(lot: LotRow, view: OrderBookView): ForecastGate {
  const { closeAt, open } = view.window;
  if (closeAt == null) return { kind: 'no_close' };
  if (!open) return { kind: 'closed', closeAt };
  const bid = num(lot.high_bid);
  if (bid == null || bid <= 0) return { kind: 'no_bid' };
  const at = time(lot.updated_at);
  if (at == null) return { kind: 'no_state' };
  const { bidders, why } = biddersFor(lot, view);
  return {
    kind: 'ask',
    request: {
      lotId: lot.id, bid, bidders, biddersWhy: why, at: new Date(at).toISOString(), endsAt: new Date(closeAt).toISOString(),
      totalBids: lot.total_bids,
    },
  };
}

/** The route's query: the lot by id and the stored numbers, and nothing the page does not know (no extensions, no max). */
export function forecastUrl(req: ForecastRequest, base: string = `${SUPABASE_URL}/functions/v1`): string {
  const q = new URLSearchParams({ lot: req.lotId, bid: String(req.bid), at: req.at, ends_at: req.endsAt });
  if (req.bidders != null) q.set('bidders', String(req.bidders));
  return `${base}/${FORECAST_PATH}?${q.toString()}`;
}

// --- What the reader says ---------------------------------------------------------------------------------------------

export interface BandReading {
  low: number; mid: number; high: number;
  /** Comparables the band rests on, and the sold lots they were drawn from. */
  n: number; denominator: number; denominatorIsFloor: boolean;
  rank: number | null; ratioHigh: number | null; coverageIfExchangeable: number | null;
  appliesTo: string | null;
  /** The last-hour reader: which price tier, and how many followed lots were read. */
  pool: { priceTier: string | null; tierAlone: boolean | null; inSample: number | null; read: number | null } | null;
}

export interface CohortReading {
  kind: 'level' | 'miss' | 'pool';
  level: number | null;
  make: string | null; model: string | null;
  /** level 2 only: the model family (vehicles.normalized_model) the cohort is drawn from. */
  family: string | null;
  /** level 2 only: what the exact make and model text held, which was under the reader's minimum. */
  exactText: { sold: number | null; closed: number | null } | null;
  /** level: sold lots in the last 365 days, and those that had a bid at this time and a bid log that reproduces the hammer. */
  denominator: number | null; denominatorIsFloor: boolean; nComparables: number | null;
  funnel: Record<string, number | null> | null;
  /** miss: why, and every denominator the reader counted. */
  missReason: string | null;
  missDenominators: Record<string, number | null> | null;
  familyNote: string | null;
}

export interface Rank { n: number; below: number; same: number; above: number; percentile: number }
export interface PositionReading { price: Rank & { bid: number }; bidders: (Rank & { bidders: number }) | null; secondsLeft: number | null }

export interface CoverageReading {
  bidRows: { n: number; bidders: number | null; maxBid: number | null; firstPostedAt: number | null; lastPostedAt: number | null; rowsInLast15: number | null; agrees: boolean | null } | null;
  frames: { n: number; framesInLast15: number | null; minutesWithFrameOfLast15: number | null; lastObservedAt: number | null } | null;
}

export interface Stale { kind: 'stale' | 'unknown'; ageS: number | null }

export interface ForecastReading {
  /** The reader's own status: ok, or ended, no_bid, no_close, no_time (an answer with a reason and no numbers). */
  status: string;
  reason: string | null;
  /** The clock the numbers are as of. */
  asOf: number | null;
  regime: 'hours' | 'minutes' | null;
  /** Seconds to close as of the clock of the numbers. */
  secondsLeft: number | null;
  cohort: CohortReading | null;
  position: PositionReading | null;
  band: BandReading | null;
  bandUnavailable: { reason: string; n: number | null; minN: number | null } | null;
  coverage: CoverageReading;
  /** The title-only band stored for the lot (model 31), which does not use the live bid. */
  prior: { low: number; mid: number; high: number; compCount: number | null } | null;
  /** The route's own clock when it read, and how old the numbers were then. Null when the route gave no clock. */
  readAt: number | null;
  ageS: number | null;
  /** Seconds to close at the read, which is what the last-10-minutes rule judges. */
  secondsLeftAtRead: number | null;
  stale: Stale | null;
  /** True when the reader answered ok but a number it gave has no denominator or no count, so the page shows none. */
  unreadable: boolean;
}

/** The CLI's staleness rule, judged at the read: time left at the read, and how old the numbers were then. */
export function staleness(secondsLeftAtRead: number | null, ageS: number | null): Stale | null {
  if (secondsLeftAtRead == null || secondsLeftAtRead > STALE_WINDOW_S) return null;
  if (ageS == null) return { kind: 'unknown', ageS: null };
  return ageS > STALE_AGE_S ? { kind: 'stale', ageS } : null;
}

type Rec = Record<string, unknown>;
const record = (v: unknown): Rec | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null);
const counts = (o: Rec | null, keys: string[]): Record<string, number | null> | null => {
  if (!o) return null;
  const out: Record<string, number | null> = {};
  for (const k of keys) out[k] = num(o[k]);
  return out;
};
const rank = (o: Rec | null): Rank | null => {
  if (!o) return null;
  const n = num(o.n), below = num(o.below), same = num(o.same), above = num(o.above), percentile = num(o.percentile);
  return n == null || below == null || same == null || above == null || percentile == null ? null : { n, below, same, above, percentile };
};

function readBand(b: Rec | null): { band: BandReading | null; unreadable: boolean } {
  if (!b) return { band: null, unreadable: false };
  const low = num(b.low), mid = num(b.mid), high = num(b.high), n = num(b.n), denominator = num(b.denominator);
  // a band is never shown without the count it rests on and the denominator of that count
  if (low == null || mid == null || high == null || n == null || denominator == null) return { band: null, unreadable: true };
  const pool = record(b.pool);
  const funnel = record(pool?.funnel);
  return {
    unreadable: false,
    band: {
      low, mid, high, n, denominator, denominatorIsFloor: b.denominator_is_a_floor === true,
      rank: num(b.rank_high), ratioHigh: num(b.ratio_high), coverageIfExchangeable: num(b.coverage_if_exchangeable),
      appliesTo: typeof b.applies_to === 'string' ? b.applies_to : null,
      pool: pool ? { priceTier: typeof pool.price_tier === 'string' ? pool.price_tier : null, tierAlone: typeof pool.tier_alone === 'boolean' ? pool.tier_alone : null, inSample: num(funnel?.in_the_sample), read: num(funnel?.clocked_sold_lots_read) } : null,
    },
  };
}

function readCohort(f: Rec): CohortReading | null {
  const c = record(f.cohort);
  const miss = record(f.cohort_miss);
  const key = record(c?.key);
  const regime = record(f.clock)?.regime;
  const found = regime !== 'minutes' && c != null && num(c.level) != null;
  // the reader reports the exact text's shortfall (cohort_miss) even when the model family then resolves a cohort (level 2):
  // that is a cohort, not a miss. A miss is no cohort at all.
  if (miss && !found) {
    return {
      kind: 'miss', level: null, make: typeof miss.make === 'string' ? miss.make : null, model: typeof miss.model === 'string' ? miss.model : null,
      family: null, exactText: null,
      denominator: null, denominatorIsFloor: false, nComparables: null, funnel: null,
      missReason: typeof miss.reason === 'string' ? miss.reason : null,
      missDenominators: counts(record(miss.denominator), ['closed_lots_with_this_text', 'sold_with_this_text', 'closed_lots_in_the_model_family', 'sold_in_the_model_family', 'vehicles_with_this_make_to_10000']),
      familyNote: typeof miss.family_note === 'string' ? miss.family_note : null,
    };
  }
  if (!c) return null;
  const level = num(c.level);
  const base = { make: typeof key?.make === 'string' ? key.make : null, model: typeof key?.model === 'string' ? key.model : null, missReason: null, missDenominators: null, familyNote: null };
  if (regime === 'minutes' || level == null) {
    return { ...base, kind: 'pool', level: null, family: null, exactText: null, denominator: null, denominatorIsFloor: false, nComparables: null, funnel: null };
  }
  const md = record(miss?.denominator);
  return {
    ...base, kind: 'level', level,
    family: level === 2 && typeof key?.model_family === 'string' ? key.model_family : null,
    exactText: level === 2 && miss ? { sold: num(md?.sold_with_this_text), closed: num(md?.closed_lots_with_this_text) } : null,
    denominator: num(c.denominator), denominatorIsFloor: c.denominator_is_a_floor === true, nComparables: num(c.n_comparables),
    funnel: counts(record(c.funnel), ['closed_lots', 'read', 'sold_with_hammer', 'with_a_bid_at_this_time', 'bid_log_reproduces_hammer', 'no_bid_yet_at_this_time']),
  };
}

function readCoverage(f: Rec): CoverageReading {
  const cov = record(f.coverage);
  const rows = record(cov?.bid_rows);
  const frames = record(cov?.live_frames);
  const rn = num(rows?.n), fn = num(frames?.n);
  return {
    bidRows: rows && rn != null ? {
      n: rn, bidders: num(rows.bidders), maxBid: num(rows.max_bid), firstPostedAt: time(rows.first_posted_at), lastPostedAt: time(rows.last_posted_at),
      rowsInLast15: num(rows.rows_in_last_15_min), agrees: typeof rows.agrees_with_input_bid === 'boolean' ? rows.agrees_with_input_bid : null,
    } : null,
    frames: frames && fn != null ? { n: fn, framesInLast15: num(frames.frames_in_last_15_min), minutesWithFrameOfLast15: num(frames.minutes_with_a_frame_of_last_15), lastObservedAt: time(frames.last_observed_at) } : null,
  };
}

/** The route's body ({ data: { forecast, resolution, clocks, reader } }) as the page reads it; null when it is not one. */
export function readingFrom(body: unknown): ForecastReading | null {
  const data = record(record(body)?.data);
  const f = record(data?.forecast);
  if (!f || typeof f.status !== 'string') return null;
  const clocks = record(data?.clocks);
  const asOf = time(f.as_of) ?? time(clocks?.at);
  const readAt = time(clocks?.server_now);
  const ageS = asOf != null && readAt != null ? Math.max(0, (readAt - asOf) / 1000) : null;
  const clock = record(f.clock);
  const closeAt = time(clock?.ends_at) ?? time(f.ends_at) ?? time(clocks?.ends_at_argument);
  const secondsLeftAtRead = closeAt != null && readAt != null ? (closeAt - readAt) / 1000 : null;
  // a lot that closed more than 10 minutes before the read has nothing left that can move
  const stale = secondsLeftAtRead != null && secondsLeftAtRead < -STALE_WINDOW_S ? null : staleness(secondsLeftAtRead, ageS);

  const { band, unreadable } = readBand(record(f.band));
  const unavailable = record(f.band_unavailable);
  const prior = record(f.prior);
  const price = record(record(f.position)?.price);
  const bidders = record(record(f.position)?.bidders);
  const priceRank = rank(price);
  const biddersRank = rank(bidders);
  const pos = record(f.position);
  const priorBand = prior && num(prior.low) != null && num(prior.mid) != null && num(prior.high) != null
    ? { low: num(prior.low)!, mid: num(prior.mid)!, high: num(prior.high)!, compCount: num(prior.comp_count) } : null;
  return {
    status: f.status,
    reason: typeof f.reason === 'string' ? f.reason : null,
    asOf,
    regime: clock?.regime === 'hours' || clock?.regime === 'minutes' ? clock.regime : null,
    secondsLeft: num(clock?.seconds_left),
    cohort: f.status === 'ok' ? readCohort(f) : null,
    position: pos && priceRank && num(price?.bid) != null ? {
      price: { ...priceRank, bid: num(price?.bid)! },
      bidders: biddersRank && num(bidders?.bidders) != null ? { ...biddersRank, bidders: num(bidders?.bidders)! } : null,
      secondsLeft: num(pos.seconds_left),
    } : null,
    band,
    bandUnavailable: unavailable && typeof unavailable.reason === 'string' ? { reason: unavailable.reason, n: num(unavailable.n), minN: num(unavailable.min_n) } : null,
    coverage: readCoverage(f),
    prior: priorBand,
    readAt, ageS, secondsLeftAtRead, stale,
    unreadable: f.status === 'ok' && unreadable,
  };
}

// --- The call ----------------------------------------------------------------------------------------------------------

export type ForecastResult =
  | { kind: 'ok'; reading: ForecastReading }
  | { kind: 'refused'; status: number; message: string }
  | { kind: 'not_found'; message: string }
  | { kind: 'rate_limited'; message: string; retryAfterS: number | null }
  | { kind: 'bad_request'; message: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'unreadable'; message: string };

const errorText = (body: unknown, fallback: string): string => {
  const e = record(body)?.error;
  return typeof e === 'string' && e.trim() ? e.trim().slice(0, 240) : fallback;
};

/**
 * One call to the route with the signed-in session's token. HTTP answers are returned as results, not thrown, so one
 * refusal is one state and never a retry storm; only a read this page cannot make at all reaches the query's error.
 */
export async function readForecast(req: ForecastRequest, token: string, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<ForecastResult> {
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  if (signal?.aborted) ctl.abort(); else signal?.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, FORECAST_TIMEOUT_MS);
  try {
    const res = await fetcher(forecastUrl(req), {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: ctl.signal,
    });
    let body: unknown = null;
    try { body = await res.json(); } catch { /* an answer that is not JSON is handled below */ }
    if (res.ok) {
      const reading = readingFrom(body);
      return reading ? { kind: 'ok', reading } : { kind: 'unreadable', message: 'the answer is not the forecast route\'s shape' };
    }
    if (res.status === 401 || res.status === 403) return { kind: 'refused', status: res.status, message: errorText(body, 'refused') };
    if (res.status === 404) return { kind: 'not_found', message: errorText(body, 'no such lot') };
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after') ?? errorText(body, '').match(/(\d+) seconds/)?.[1]);
      return { kind: 'rate_limited', message: errorText(body, 'rate limited'), retryAfterS: Number.isFinite(retry) && retry > 0 ? retry : null };
    }
    if (res.status === 400) return { kind: 'bad_request', message: errorText(body, 'the request was refused') };
    return { kind: 'unavailable', message: `HTTP ${res.status}: ${errorText(body, 'the forecast route failed')}` };
  } catch (e) {
    if (signal?.aborted) throw e;
    return { kind: 'unavailable', message: ctl.signal.aborted ? `no answer in ${FORECAST_TIMEOUT_MS / 1000} s` : 'the forecast route could not be reached' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

/**
 * The forecast for one lot's stored state. The key is the state itself, so a new read of the lot row (a new bid, a new close)
 * is a new question and nothing else is: no timer re-asks an unchanged one, except inside the last hour, where the age of the
 * numbers is what matters and a minute-old answer is re-read.
 */
export function useForecast(request: ForecastRequest | null, token: string | null) {
  const nearClose = request != null && Date.parse(request.endsAt) - Date.now() <= REREAD_WITHIN_S * 1000;
  return useQuery({
    queryKey: ['stack-forecast', request?.lotId, request?.bid, request?.bidders, request?.at, request?.endsAt],
    queryFn: ({ signal }) => readForecast(request as ForecastRequest, token as string, signal),
    enabled: Boolean(request && token),
    staleTime: 60_000,
    refetchInterval: nearClose ? 60_000 : false,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
