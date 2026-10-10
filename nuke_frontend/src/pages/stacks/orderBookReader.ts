import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

// Stack A's reader for one BaT lot (case ledger §13.2): the lot's log, its keys, and the fold computed from them on
// each read. Composed from existing public relations, no new database object:
//   vehicles            public parent gate (is_public, not deleted, not a non-vehicle item); nothing else is read
//                       without it, because auction_comments keeps a legacy broad public policy.
//   auction_events      the vehicle's BaT lots (grain: one lot); counts and outcome as of the lot's last source read.
//   auction_comments    the rows keyed to the chosen lot (auction_event_id), posted_at = event clock,
//                       created_at = ingest clock; plus a count of rows on the lot URL that carry no lot key.
//   external_identities the identities the bids are keyed to (handle only: BaT handles are public).
//   vehicle_observations the lot's public live frames (extraction_method bat_public_live_v1), receipt clock
//                       structured_data.received_at.
// The fold is per bid and point-in-time: the state at a bid uses only bids posted at or before it. One lot is at most a
// few hundred bids, so folding at read time is bounded; there is no stored fold table, and the page says so.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BAT_LOT_URL = /^https:\/\/bringatrailer\.com\/listing\/[^/?#]+\/?$/;

/**
 * A comment keyed to a lot but posted more than this many days before the lot's scheduled close cannot be from that
 * lot's run: it is a key conflict, shown and never folded. Basis (scripts/data/q.sh, read-only, 2026-10-07 00:55Z):
 * on 400 BaT lots closed 2026-10-04 to 10-07, the first comment came 6 to 8 days before close on 389, and 8 to 12 days
 * on 10. On the same read, the live lot with the most keyed bids held 48 of its 50 bids from a sale 14 months earlier.
 */
export const LOT_WINDOW_DAYS = 14;
const DAY_MS = 86_400_000;
const PAGE = 1000;
const MAX_PAGES = 10;

export interface VehicleRow {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  normalized_model?: string | null;
  listing_url: string | null;
  sale_status: string | null;
}

export interface LotRow {
  id: string;
  source: string;
  source_url: string;
  lot_number: string | null;
  outcome: string | null;
  auction_end_date: string | null;
  high_bid: number | null;
  winning_bid: number | null;
  total_bids: number | null;
  seller_name: string | null;
  seller_external_identity_id: string | null;
  winning_bidder: string | null;
  winning_bidder_external_identity_id: string | null;
  /** The lot row's last write by any writer (page read or live frame): the knowledge clock of total_bids and outcome. */
  updated_at: string | null;
}

export interface CommentRow {
  id: string;
  posted_at: string | null;
  created_at: string | null;
  comment_type: string | null;
  bid_amount: number | string | null;
  author_username: string | null;
  external_identity_id: string | null;
  is_seller: boolean | null;
  bat_comment_id: number | null;
  source_url: string | null;
  comment_text: string | null;
}

export interface FrameRow {
  id: string;
  kind: string | null;
  observed_at: string | null;
  received_at: string | null;
  event: string | null;
}

export interface IdentityRow {
  id: string;
  platform: string | null;
  handle: string | null;
}

export interface OrderBookRead {
  vehicle: VehicleRow;
  /** The vehicle's BaT lots, newest close first. */
  lots: LotRow[];
  /** The lot this read is about; null when the vehicle has no BaT lot. */
  lot: LotRow | null;
  /** Every row keyed to the lot, in or out of its window. */
  comments: CommentRow[];
  /** Rows on this vehicle with the lot's URL that carry no lot key. */
  unkeyedOnUrl: number;
  frames: FrameRow[];
  identities: Record<string, IdentityRow>;
  /** When this read completed in the browser. Not source freshness. */
  readAt: string;
}

const LOT_SELECT = [
  'id', 'source', 'source_url', 'lot_number', 'outcome', 'auction_end_date', 'high_bid', 'winning_bid', 'total_bids',
  'seller_name', 'seller_external_identity_id', 'winning_bidder', 'winning_bidder_external_identity_id',
  'updated_at',
].join(',');
const COMMENT_SELECT = 'id,posted_at,created_at,comment_type,bid_amount,author_username,external_identity_id,is_seller,'
  + 'bat_comment_id,source_url,comment_text,vehicles!inner(id)';
const FRAME_SELECT = 'id,kind,observed_at,received_at:structured_data->>received_at,'
  + 'event:structured_data->public_live_frame->>event';

const unreadable = () => new Error('The lot could not be read completely.');
const trimUrl = (url: string) => url.replace(/\/+$/, '');

/** Keyset pages by id until a page comes back empty; refuses a partial collection rather than returning a prefix. */
async function readAll<T extends { id: string }>(
  page: (after: string | null) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  let after: string | null = null;
  for (let n = 0; n < MAX_PAGES; n++) {
    const res = await page(after);
    if (res.error || !Array.isArray(res.data)) throw unreadable();
    const data = res.data as T[];
    if (data.length === 0) return rows;
    for (const row of data) {
      if (!row || typeof row.id !== 'string' || (after != null && row.id <= after)) throw unreadable();
      rows.push(row);
      after = row.id;
    }
  }
  throw unreadable();
}

export function chooseLot(lots: LotRow[], listingUrl: string | null, lotId: string | null): LotRow | null {
  if (lotId === 'latest') return lots[0] ?? null;
  if (lotId) {
    const asked = lots.find((l) => l.id === lotId);
    if (asked) return asked;
  }
  const current = listingUrl ? lots.find((l) => trimUrl(l.source_url) === trimUrl(listingUrl)) : undefined;
  return current ?? lots[0] ?? null;
}

export async function readOrderBook(vehicleId: string, lotId: string | null, signal?: AbortSignal): Promise<OrderBookRead | null> {
  if (!UUID_RE.test(vehicleId)) return null;
  const abort = signal ?? new AbortController().signal;
  const parent = await supabase.from('vehicles')
    .select('id,year,make,model,normalized_model,listing_url,sale_status')
    .eq('id', vehicleId).eq('is_public', true).is('deleted_at', null)
    .or('listing_kind.is.null,listing_kind.neq.non_vehicle_item')
    .abortSignal(abort).maybeSingle();
  if (parent.error) throw unreadable();
  if (!parent.data || parent.data.id !== vehicleId) return null;
  const vehicle = parent.data as VehicleRow;

  const lotsRes = await supabase.from('auction_events').select(LOT_SELECT)
    .eq('vehicle_id', vehicleId).in('source', ['bat', 'bringatrailer'])
    .order('auction_end_date', { ascending: false, nullsFirst: false }).limit(50).abortSignal(abort);
  if (lotsRes.error || !Array.isArray(lotsRes.data)) throw unreadable();
  const lots = (lotsRes.data as unknown as LotRow[]).filter((l) => BAT_LOT_URL.test(l.source_url ?? ''));
  const lot = chooseLot(lots, vehicle.listing_url, lotId);
  const readAt = () => new Date().toISOString();
  if (!lot) return { vehicle, lots, lot: null, comments: [], unkeyedOnUrl: 0, frames: [], identities: {}, readAt: readAt() };

  const url = trimUrl(lot.source_url);
  const [comments, unkeyed, frames] = await Promise.all([
    readAll<CommentRow>((after) => {
      let q = supabase.from('auction_comments').select(COMMENT_SELECT)
        .eq('auction_event_id', lot.id).eq('vehicle_id', vehicleId)
        .eq('vehicles.is_public', true).is('vehicles.deleted_at', null)
        .order('id').limit(PAGE).abortSignal(abort);
      if (after) q = q.gt('id', after);
      return q;
    }),
    supabase.from('auction_comments').select('id', { count: 'exact', head: true })
      .eq('vehicle_id', vehicleId).is('auction_event_id', null).in('source_url', [url, `${url}/`]).abortSignal(abort),
    readAll<FrameRow>((after) => {
      let q = supabase.from('vehicle_observations').select(FRAME_SELECT)
        .eq('vehicle_id', vehicleId).eq('extraction_method', 'bat_public_live_v1').in('source_url', [url, `${url}/`])
        .order('id').limit(PAGE).abortSignal(abort);
      if (after) q = q.gt('id', after);
      return q;
    }),
  ]);
  if (unkeyed.error || typeof unkeyed.count !== 'number') throw unreadable();

  const ids = new Set<string>();
  for (const c of comments) if (c.external_identity_id && UUID_RE.test(c.external_identity_id)) ids.add(c.external_identity_id);
  for (const k of [lot.seller_external_identity_id, lot.winning_bidder_external_identity_id]) if (k && UUID_RE.test(k)) ids.add(k);
  const identities: Record<string, IdentityRow> = {};
  const all = [...ids];
  for (let i = 0; i < all.length; i += 100) {
    const chunk = all.slice(i, i + 100);
    const res = await supabase.from('external_identities').select('id,platform,handle').in('id', chunk).abortSignal(abort);
    if (res.error || !Array.isArray(res.data)) throw unreadable();
    for (const row of res.data as IdentityRow[]) if (chunk.includes(row.id)) identities[row.id] = row;
  }

  return {
    vehicle,
    lots,
    lot,
    comments: comments.map((row) => {
      const copy: CommentRow & { vehicles?: unknown } = { ...row };
      delete copy.vehicles; // the public-parent join, not part of the row
      return copy;
    }),
    unkeyedOnUrl: unkeyed.count,
    frames,
    identities,
    readAt: readAt(),
  };
}

export function useOrderBook(vehicleId: string, lotId: string | null) {
  return useQuery({
    queryKey: ['stack-order-book', vehicleId, lotId],
    queryFn: ({ signal }) => readOrderBook(vehicleId, lotId, signal),
    enabled: UUID_RE.test(vehicleId),
    staleTime: 60_000,
    // A live lot's rows land when bat-live-pull reads it (hourly far from close, every second inside the closing
    // window). Re-read every minute while it is open; a closed lot does not change.
    refetchInterval: (query) => {
      const d = query.state.data as OrderBookRead | null | undefined;
      const close = Date.parse(d?.lot?.auction_end_date ?? '');
      return Number.isFinite(close) && close > Date.now() ? 60_000 : false;
    },
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Shaping. Pure functions over one read; the page and the tests use the same ones.

const time = (v: string | null | undefined): number | null => {
  const t = Date.parse(v ?? '');
  return Number.isFinite(t) ? t : null;
};
const amountOf = (v: number | string | null): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export interface LotWindow {
  /** auction_events.auction_end_date as last read (moves with soft-close extensions while live). */
  closeAt: number | null;
  /** closeAt minus LOT_WINDOW_DAYS; rows keyed to the lot and posted before it are key conflicts. */
  windowStart: number | null;
  /** Earliest posted time among the lot's rows in its window: an observed lower bound on the opening, which BaT
   *  lots do not record (auction_events.auction_start_date is empty for BaT). */
  firstHeldAt: number | null;
  /** The close, or the read time while the lot is still open. */
  liveUntil: number | null;
  minutesLive: number | null;
  open: boolean;
}

export interface WindowPartition {
  inWindow: CommentRow[];
  outside: CommentRow[];
}

export function partitionWindow(comments: CommentRow[], closeAt: number | null): WindowPartition {
  if (closeAt == null) return { inWindow: comments, outside: [] };
  const start = closeAt - LOT_WINDOW_DAYS * DAY_MS;
  const inWindow: CommentRow[] = [];
  const outside: CommentRow[] = [];
  for (const c of comments) {
    const at = time(c.posted_at);
    (at != null && at < start ? outside : inWindow).push(c);
  }
  return { inWindow, outside };
}

export function lotWindow(lot: LotRow, inWindow: CommentRow[], readAt: number): LotWindow {
  const closeAt = time(lot.auction_end_date);
  let first: number | null = null;
  for (const c of inWindow) {
    const at = time(c.posted_at);
    if (at != null && (first == null || at < first)) first = at;
  }
  const open = closeAt != null && closeAt > readAt;
  const liveUntil = closeAt == null ? null : Math.min(closeAt, readAt);
  const minutesLive = first != null && liveUntil != null && liveUntil > first ? Math.floor((liveUntil - first) / 60_000) : null;
  return {
    closeAt,
    windowStart: closeAt == null ? null : closeAt - LOT_WINDOW_DAYS * DAY_MS,
    firstHeldAt: first,
    liveUntil,
    minutesLive,
    open,
  };
}

export interface BidEvent {
  id: string;
  at: number;
  amount: number;
  identityId: string | null;
  /** The identity's handle when keyed, else the handle text as written on the comment (not unified across bids). */
  handle: string;
  keyed: boolean;
  batCommentId: number | null;
  landedAt: number | null;
}

/** The lot's bids in posted order (ties by BaT comment id, then row id). Undated or amountless rows are not bids here. */
export function bidEvents(rows: CommentRow[], identities: Record<string, IdentityRow>): BidEvent[] {
  const out: BidEvent[] = [];
  for (const r of rows) {
    if (r.comment_type !== 'bid') continue;
    const at = time(r.posted_at);
    const amount = amountOf(r.bid_amount);
    if (at == null || amount == null) continue;
    const identity = r.external_identity_id ? identities[r.external_identity_id] : undefined;
    out.push({
      id: r.id,
      at,
      amount,
      identityId: r.external_identity_id ?? null,
      handle: identity?.handle || r.author_username || 'unknown',
      keyed: Boolean(r.external_identity_id),
      batCommentId: r.bat_comment_id ?? null,
      landedAt: time(r.created_at),
    });
  }
  return out.sort((a, b) => a.at - b.at || (a.batCommentId ?? 0) - (b.batCommentId ?? 0) || a.id.localeCompare(b.id));
}

export interface BookEntry {
  /** id:<identity> for a keyed identity, bid:<row> for an unkeyed bid (authors are never unified by handle). */
  key: string;
  identityId: string | null;
  handle: string;
  /** Highest amount this entry has revealed so far. */
  max: number;
  /** When that highest amount was posted. */
  at: number;
  bidId: string;
  bids: number;
}

export interface FoldState {
  index: number;
  bid: BidEvent;
  /** Highest bid posted so far. */
  price: number;
  /** Close as last read minus this bid's posted time; null without a close clock. */
  msToClose: number | null;
  /** Revealed demand as of this bid, highest first: the demand curve is depth(P) = entries with max >= P. */
  book: BookEntry[];
  identities: number;
  unresolved: number;
}

export function foldOrderBook(bids: BidEvent[], closeAt: number | null): FoldState[] {
  const entries = new Map<string, BookEntry>();
  const states: FoldState[] = [];
  let price = 0;
  bids.forEach((bid, index) => {
    const key = bid.identityId ? `id:${bid.identityId}` : `bid:${bid.id}`;
    const prior = entries.get(key);
    if (!prior) {
      entries.set(key, { key, identityId: bid.identityId, handle: bid.handle, max: bid.amount, at: bid.at, bidId: bid.id, bids: 1 });
    } else {
      prior.bids += 1;
      if (bid.amount > prior.max) Object.assign(prior, { max: bid.amount, at: bid.at, bidId: bid.id });
    }
    price = Math.max(price, bid.amount);
    const book = [...entries.values()].map((e) => ({ ...e }))
      .sort((a, b) => b.max - a.max || a.at - b.at || a.key.localeCompare(b.key));
    const identities = book.filter((e) => e.identityId).length;
    states.push({
      index,
      bid,
      price,
      msToClose: closeAt == null ? null : closeAt - bid.at,
      book,
      identities,
      unresolved: book.length - identities,
    });
  });
  return states;
}

/** Revealed demand at price P: book entries whose highest revealed amount is at or above P. */
export function depthAt(book: BookEntry[], price: number): number {
  return book.filter((e) => e.max >= price).length;
}

export interface FrameCoverage {
  frames: number;
  byKind: Array<{ kind: string; count: number }>;
  /** Distinct receipt minutes with at least one frame, inside [firstHeldAt, liveUntil]. */
  minutesWithFrame: number;
  firstReceivedAt: number | null;
  lastReceivedAt: number | null;
}

export function frameCoverage(frames: FrameRow[], win: LotWindow): FrameCoverage {
  const kinds = new Map<string, number>();
  const minutes = new Set<number>();
  let first: number | null = null;
  let last: number | null = null;
  for (const f of frames) {
    const kind = f.kind || 'unknown';
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    const at = time(f.received_at);
    if (at == null) continue;
    if (first == null || at < first) first = at;
    if (last == null || at > last) last = at;
    if (win.firstHeldAt != null && win.liveUntil != null && at >= win.firstHeldAt && at <= win.liveUntil) {
      minutes.add(Math.floor(at / 60_000));
    }
  }
  return {
    frames: frames.length,
    byKind: [...kinds.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
    minutesWithFrame: minutes.size,
    firstReceivedAt: first,
    lastReceivedAt: last,
  };
}

export interface KindCount {
  kind: string;
  count: number;
}

/** Comment kinds as the comment builder wrote them (auction_comments.comment_type), most common first. */
export function commentKinds(rows: CommentRow[]): KindCount[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = r.comment_type || 'unknown';
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

export interface CoverageRow {
  id: 'bids_keyed' | 'bids_held' | 'comments_keyed' | 'frames' | 'key_conflicts';
  label: string;
  /** null when the measure cannot be taken on this lot (then the basis says why). */
  numerator: number | null;
  /** null when the denominator is unknown (then the row says why). */
  denominator: number | null;
  /** What the denominator counts. */
  of: string;
  /** Epoch ms of the clock the numbers are as of, and what that clock is. */
  asOf: number | null;
  asOfBasis: string;
  basis: string;
}

export interface OrderBookView {
  window: LotWindow;
  partition: WindowPartition;
  bids: BidEvent[];
  states: FoldState[];
  frames: FrameCoverage;
  kinds: KindCount[];
  coverage: CoverageRow[];
  /** Latest ingest clock among the lot's rows in its window. */
  landedThrough: number | null;
}

export function shapeOrderBook(read: OrderBookRead): OrderBookView | null {
  const lot = read.lot;
  if (!lot) return null;
  const readAt = time(read.readAt) ?? Date.now();
  const closeAt = time(lot.auction_end_date);
  const partition = partitionWindow(read.comments, closeAt);
  const window = lotWindow(lot, partition.inWindow, readAt);
  const bids = bidEvents(partition.inWindow, read.identities);
  const states = foldOrderBook(bids, closeAt);
  const frames = frameCoverage(read.frames, window);
  const kinds = commentKinds(partition.inWindow);
  let landed: number | null = null;
  for (const c of partition.inWindow) {
    const t = time(c.created_at);
    if (t != null && (landed == null || t > landed)) landed = t;
  }
  const keyedBids = bids.filter((b) => b.keyed).length;

  const coverage: CoverageRow[] = [
    {
      id: 'bids_keyed', label: 'Bids keyed to identities', numerator: keyedBids, denominator: bids.length,
      of: 'bids held for this lot', asOf: landed, asOfBasis: 'latest row landed',
      basis: 'auction_comments.external_identity_id on bid rows keyed to this lot, inside its window',
    },
    {
      id: 'bids_held', label: 'Bids held', numerator: bids.length, denominator: lot.total_bids,
      of: 'bids the source reported', asOf: time(lot.updated_at), asOfBasis: 'lot row last written',
      basis: 'bid rows keyed to this lot vs auction_events.total_bids, set by the page read or the live frames, whichever wrote last',
    },
    {
      id: 'comments_keyed', label: 'Comments keyed to the lot', numerator: read.comments.length,
      denominator: read.comments.length + read.unkeyedOnUrl, of: "comments held on this lot's URL",
      asOf: readAt, asOfBasis: 'database read',
      basis: 'auction_comments.auction_event_id; denominator adds rows on this vehicle with the lot URL and no lot key',
    },
    {
      id: 'frames', label: 'Minutes with a live frame', numerator: frames.minutesWithFrame, denominator: window.minutesLive,
      of: 'minutes live (first comment held to close, or to now while open)', asOf: frames.lastReceivedAt ?? readAt,
      asOfBasis: frames.lastReceivedAt == null ? 'database read; no frame held' : 'last frame received',
      basis: `${frames.frames.toLocaleString('en-US')} public live frames held (vehicle_observations, bat_public_live_v1); the collector subscribes from 15 minutes before close`,
    },
  ];
  if (closeAt == null) {
    // Without a close clock the window cannot judge any row (on 2026-10-07 a quarter of a 0.2% sample of lot-keyed
    // BaT comments sat on lots with no auction_end_date), so the check is reported as not run rather than as zero.
    coverage.push({
      id: 'key_conflicts', label: 'Key conflicts', numerator: null, denominator: read.comments.length,
      of: 'rows keyed to this lot', asOf: readAt, asOfBasis: 'database read',
      basis: `not checked: this lot has no close time (auction_events.auction_end_date), so the ${LOT_WINDOW_DAYS}-day window cannot judge its rows`,
    });
  } else if (partition.outside.length > 0) {
    coverage.push({
      id: 'key_conflicts', label: 'Key conflicts', numerator: partition.outside.length, denominator: read.comments.length,
      of: 'rows keyed to this lot', asOf: readAt, asOfBasis: 'database read',
      basis: `posted more than ${LOT_WINDOW_DAYS} days before the scheduled close; shown in the log, never folded`,
    });
  }
  return {
    window, partition, bids, states, frames, kinds, coverage,
    landedThrough: landed,
  };
}
