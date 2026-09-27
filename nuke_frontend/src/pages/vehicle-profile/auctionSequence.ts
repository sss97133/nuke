/**
 * A BaT auction as its real sequence — pure functions over the rows Nuke holds.
 *
 * An auction's interactions are timestamped to the moment, so the timeline can
 * show the week as it happened: the listing opens, every bid and comment lands
 * at its time, the auction closes with its result, and comments keep arriving
 * after the close. Nothing here reads created_at: an import time is when Nuke
 * copied the record, not when anything happened to the car.
 *
 * Sources: auction_comments (bids are comments with comment_type 'bid'),
 * auction_events (lot, outcome, counts), vehicle_events (start / end when the
 * extractor recorded them), timeline_events (auction_listed / auction_sold),
 * vehicle_images (capture time, or its absence).
 */

export interface AuctionCommentRow {
  id: string;
  posted_at: string | null;
  comment_type: string | null;
  bid_amount: number | null;
  author_username: string | null;
  is_seller: boolean | null;
  comment_text: string | null;
  bat_comment_id: number | null;
  source_url: string | null;
  sequence_number: number | null;
  comment_likes: number | null;
}

export interface AuctionEventRow {
  id: string;
  source: string | null;
  source_url: string | null;
  lot_number: string | null;
  outcome: string | null;
  winning_bid: number | null;
  total_bids: number | null;
  winning_bidder: string | null;
  seller_name: string | null;
  page_views: number | null;
  watchers: number | null;
  comments_count: number | null;
}

export interface VehicleEventRow {
  id: string;
  source_platform: string | null;
  source_url: string | null;
  started_at: string | null;
  ended_at: string | null;
  sold_at: string | null;
  final_price: number | null;
  event_status: string | null;
}

export interface TimelineEventLike {
  event_type?: string | null;
  event_date?: string | null;
  title?: string | null;
  cost_amount?: number | null;
  source?: string | null;
  data_source?: string | null;
}

export interface ImageStampRow {
  id: string;
  taken_at: string | null;
  source: string | null;
}

export type AuctionItemKind = 'bid' | 'comment' | 'seller';

export interface AuctionItem {
  id: string;
  kind: AuctionItemKind;
  at: string;               // ISO
  amount: number | null;    // bids
  author: string;
  text: string;
  url: string;              // the comment on BaT, or the lot when no comment id is held
  likes: number;
  seq: number | null;
  postClose: boolean;
}

export interface Moment {
  at: string;   // ISO
  basis: string; // where the time comes from, in words the page shows
  exact: boolean;
}

export interface AuctionDay {
  date: string;      // local YYYY-MM-DD
  bids: number;
  comments: number;  // non-bid comments, seller's included
  seller: number;
  high: number | null; // running high bid at the end of the day
  postClose: boolean;
}

export interface AuctionSequence {
  lotUrl: string;
  lotNumber: string | null;
  open: Moment | null;
  close: Moment | null;
  outcome: 'sold' | 'reserve_not_met' | 'no_sale' | 'withdrawn' | 'live' | 'unknown';
  price: number | null;
  buyer: string | null;
  seller: string | null;
  bidCount: number | null;
  commentCount: number | null;
  watchers: number | null;
  views: number | null;
  items: AuctionItem[];
  days: AuctionDay[];
  /** true when auction_comments holds nothing for the lot — the sequence is not extracted, not empty */
  activityExtracted: boolean;
  photos: {
    total: number;
    withCaptureTime: number;
    /** no capture time, or a stamp after the close — published with the listing */
    publishedWithListing: number;
    /** local days whose photo stamps are import times, not capture times */
    importStampedDays: string[];
  };
}

/** YYYY-MM-DD in the viewer's timezone — the same convention the timeline grid uses. */
export function localDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA');
}

const isoOrNull = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

/** A timestamp that is exactly midnight UTC came from a date column, not a clock. */
const hasClock = (iso: string): boolean => !/T00:00:00(\.000)?Z$/.test(iso);

export function commentPermalink(lotUrl: string, batCommentId: number | null): string {
  const base = lotUrl.replace(/\/+$/, '');
  return batCommentId ? `${base}/#comment-${batCommentId}` : `${base}/`;
}

export interface SequenceInput {
  comments: AuctionCommentRow[];
  auctionEvents: AuctionEventRow[];
  vehicleEvents: VehicleEventRow[];
  timelineEvents: TimelineEventLike[];
  images: ImageStampRow[];
  /** the vehicle's own BaT URL, used when no event row carries one */
  lotUrlHint?: string | null;
}

export function buildAuctionSequence(input: SequenceInput): AuctionSequence | null {
  const bat = (u: string | null | undefined) => !!u && /bringatrailer\.com\/listing\//i.test(u);
  const ev = input.auctionEvents.find(e => bat(e.source_url) || (e.source ?? '').toLowerCase() === 'bat') ?? null;
  const vevs = input.vehicleEvents.filter(v => bat(v.source_url) || (v.source_platform ?? '').toLowerCase() === 'bat');
  const lotUrl = ev?.source_url || vevs.find(v => v.source_url)?.source_url || input.comments.find(c => bat(c.source_url))?.source_url || input.lotUrlHint || null;
  if (!lotUrl || !bat(lotUrl)) return null;

  // items, in time order
  const items: AuctionItem[] = [];
  for (const c of input.comments) {
    const at = isoOrNull(c.posted_at);
    if (!at) continue;
    const isBid = c.comment_type === 'bid' || c.bid_amount != null;
    const isSeller = c.is_seller === true || c.comment_type === 'seller_response';
    items.push({
      id: c.id,
      kind: isBid ? 'bid' : isSeller ? 'seller' : 'comment',
      at,
      amount: isBid ? c.bid_amount : null,
      author: c.author_username ?? 'unknown',
      text: c.comment_text ?? '',
      url: commentPermalink(lotUrl, c.bat_comment_id),
      likes: c.comment_likes ?? 0,
      seq: c.sequence_number,
      postClose: false,
    });
  }
  items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : (a.seq ?? 0) - (b.seq ?? 0)));
  const bids = items.filter(i => i.kind === 'bid');

  // open: an extractor-recorded start, else the listing event's day, else the first activity
  let open: Moment | null = null;
  const started = vevs.map(v => isoOrNull(v.started_at)).find((s): s is string => !!s);
  const listed = input.timelineEvents.find(t => t.event_type === 'auction_listed' && t.event_date);
  if (started) open = { at: started, basis: 'listing start recorded by the extractor', exact: hasClock(started) };
  else if (listed?.event_date) open = { at: new Date(`${listed.event_date.slice(0, 10)}T12:00:00`).toISOString(), basis: 'listing day; time not recorded', exact: false };
  else if (items.length) open = { at: items[0].at, basis: `first activity — ${items[0].kind === 'bid' ? 'first bid' : 'first comment'}; the listing opened some hours before`, exact: false };

  // close: an extractor-recorded end with a clock, else the final bid (BaT closes within
  // two minutes of the last bid), else the sale day
  let close: Moment | null = null;
  const ended = vevs.map(v => isoOrNull(v.ended_at) ?? isoOrNull(v.sold_at)).find((s): s is string => !!s);
  const finalBid = bids.length ? bids[bids.length - 1] : null;
  if (ended && hasClock(ended)) close = { at: ended, basis: 'auction end recorded by the extractor', exact: true };
  else if (finalBid) close = { at: finalBid.at, basis: 'final bid — BaT closes within two minutes of the last bid; the exact end is not recorded', exact: false };
  else if (ended) close = { at: ended, basis: 'sale day; time not recorded', exact: false };
  else {
    const sold = input.timelineEvents.find(t => t.event_type === 'auction_sold' && t.event_date);
    if (sold?.event_date) close = { at: new Date(`${sold.event_date.slice(0, 10)}T12:00:00`).toISOString(), basis: 'sale day; time not recorded', exact: false };
  }

  if (close) for (const i of items) i.postClose = i.at > close.at && !(i.kind === 'bid');

  // outcome and result
  const statusText = `${ev?.outcome ?? ''} ${vevs.map(v => v.event_status ?? '').join(' ')}`.toLowerCase();
  const outcome: AuctionSequence['outcome'] =
    /sold/.test(statusText) ? 'sold'
      : /reserve_not_met|reserve not met/.test(statusText) ? 'reserve_not_met'
        : /no_sale|unsold/.test(statusText) ? 'no_sale'
          : /withdrawn/.test(statusText) ? 'withdrawn'
            : /active|live/.test(statusText) ? 'live'
              : 'unknown';
  const price = ev?.winning_bid ?? vevs.map(v => v.final_price).find((p): p is number => p != null) ?? (finalBid?.amount ?? null);

  // days
  const dayMap = new Map<string, AuctionDay>();
  let high: number | null = null;
  for (const i of items) {
    const d = localDate(i.at);
    const row = dayMap.get(d) ?? { date: d, bids: 0, comments: 0, seller: 0, high: null, postClose: i.postClose };
    if (i.kind === 'bid') { row.bids += 1; if (i.amount != null && (high == null || i.amount > high)) high = i.amount; }
    else { row.comments += 1; if (i.kind === 'seller') row.seller += 1; }
    row.high = high;
    row.postClose = row.postClose && i.postClose;
    dayMap.set(d, row);
  }
  const days = Array.from(dayMap.values()).sort((a, b) => (a.date < b.date ? -1 : 1));

  // photos: a listing photo cannot have been captured after the auction closed, so a
  // stamp after the close is an import time; no stamp at all is no capture time
  const closeAt = close?.at ?? null;
  let withCaptureTime = 0, published = 0;
  const stamped = new Map<string, number>();
  for (const im of input.images) {
    const t = isoOrNull(im.taken_at);
    if (!t || (closeAt && t > closeAt && (im.source ?? '').toLowerCase().includes('bat'))) {
      published += 1;
      if (t) stamped.set(localDate(t), (stamped.get(localDate(t)) ?? 0) + 1);
    } else {
      withCaptureTime += 1;
    }
  }

  return {
    lotUrl: lotUrl.replace(/\/+$/, '') + '/',
    lotNumber: ev?.lot_number ?? null,
    open, close, outcome, price,
    buyer: ev?.winning_bidder ?? null,
    seller: ev?.seller_name ?? null,
    bidCount: ev?.total_bids ?? (bids.length || null),
    commentCount: items.length ? items.length : (ev?.comments_count ?? null),
    watchers: ev?.watchers ?? null,
    views: ev?.page_views ?? null,
    items, days,
    activityExtracted: items.length > 0,
    photos: { total: input.images.length, withCaptureTime, publishedWithListing: published, importStampedDays: Array.from(stamped.keys()).sort() },
  };
}

export function fmtUsd(n: number | null | undefined): string {
  return n == null || !isFinite(n) ? '' : `$${Math.round(n).toLocaleString('en-US')}`;
}

export function fmtClock(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function fmtDayShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function fmtMoment(m: Moment | null): string {
  if (!m) return 'not recorded';
  const d = new Date(m.at);
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return m.exact || m.basis.startsWith('first activity') || m.basis.startsWith('final bid') ? `${day} ${fmtClock(m.at)}` : day;
}
