/**
 * A BaT auction as its real sequence — pure functions over the rows Nuke holds.
 *
 * An auction's interactions are timestamped to the moment, so the timeline can
 * show each week as it happened: the listing opens, every bid and comment lands
 * at its time, the auction closes with its result, and comments keep arriving
 * after the close. A car that ran on BaT more than once gets one sequence per
 * listing (91% of lots ran once; the rest ran two, three or more times), keyed
 * by the listing URL every row carries. Nothing here reads created_at: an
 * import time is when Nuke copied the record, not when anything happened to
 * the car.
 *
 * Sources: auction_comments (bids are comments with comment_type 'bid'),
 * auction_events (lot, outcome, counts), vehicle_events (start / end when the
 * extractor recorded them), timeline_events (auction_listed / auction_sold),
 * vehicle_images (capture time, or its absence; the BaT upload path carries the
 * month the photos were published).
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
  description?: string | null;
  image_urls?: string[] | null;
  cost_amount?: number | null;
  source?: string | null;
  data_source?: string | null;
}

export interface ImageStampRow {
  id: string;
  taken_at: string | null;
  source: string | null;
  /** where the file came from — a BaT upload path carries the month it was published */
  source_url?: string | null;
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
  /** the listing this item belongs to (normalized lot key) */
  listingKey: string;
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
  /** normalized lot key — one per listing */
  key: string;
  lotUrl: string;
  lotNumber: string | null;
  /** 1 = the car's first BaT listing */
  ordinal: number;
  listingCount: number;
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
  /** true when auction_comments holds nothing for the listing — the sequence is not extracted, not empty */
  activityExtracted: boolean;
  photos: {
    /** photos published with this listing (no capture time in Nuke) */
    publishedWithListing: number;
    /** true when the photos could not be tied to a listing and sit here as the car's current listing */
    attributionUncertain: boolean;
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

const BAT_LOT = /bringatrailer\.com\/listing\/([^/?#]+)/i;

/** One key per BaT listing, whatever the URL's scheme, host prefix, query or trailing slash. */
export function lotKey(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = BAT_LOT.exec(url);
  return m ? m[1].toLowerCase() : null;
}

export function lotUrlFor(key: string): string {
  return `https://bringatrailer.com/listing/${key}/`;
}

export function commentPermalink(lotUrl: string, batCommentId: number | null): string {
  const base = lotUrl.replace(/\/+$/, '');
  return batCommentId ? `${base}/#comment-${batCommentId}` : `${base}/`;
}

/** The month a BaT-hosted photo was published, from its upload path (…/uploads/2018/07/…). */
export function uploadMonth(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl) return null;
  const m = /bringatrailer\.com\/wp-content\/uploads\/(\d{4})\/(\d{2})\//i.exec(sourceUrl);
  return m ? `${m[1]}-${m[2]}` : null;
}

/** A BaT-imported photo carries no capture time: the importer stamped its own run time. */
export function isBatHosted(im: ImageStampRow): boolean {
  return /bat/i.test(im.source ?? '') || /bringatrailer\.com/i.test(im.source_url ?? '');
}

export interface SequenceInput {
  comments: AuctionCommentRow[];
  auctionEvents: AuctionEventRow[];
  vehicleEvents: VehicleEventRow[];
  timelineEvents: TimelineEventLike[];
  images: ImageStampRow[];
  /** the vehicle's own BaT URL — the listing rows with no URL of their own belong to it */
  lotUrlHint?: string | null;
}

export interface SequencesResult {
  /** newest listing first */
  sequences: AuctionSequence[];
  /** local days whose photo stamps are import times, not capture times */
  importStampedDays: string[];
}

const DAY = 86400e3;
const WINDOW_SLACK = 14 * DAY;

function timelineMatchesKey(t: TimelineEventLike, key: string, lotNumber: string | null): boolean {
  if ((t.image_urls ?? []).some(u => lotKey(u) === key)) return true;
  if (lotNumber) {
    const text = `${t.title ?? ''} ${t.description ?? ''}`;
    if (new RegExp(`#\\s*${lotNumber}\\b`).test(text) || new RegExp(`\\blot\\s*#?\\s*${lotNumber}\\b`, 'i').test(text)) return true;
  }
  return false;
}

export function buildAuctionSequences(input: SequenceInput): SequencesResult {
  // every listing the rows know about
  const keys = new Set<string>();
  const hintKey = lotKey(input.lotUrlHint);
  if (hintKey) keys.add(hintKey);
  for (const c of input.comments) { const k = lotKey(c.source_url); if (k) keys.add(k); }
  for (const e of input.auctionEvents) { const k = lotKey(e.source_url); if (k) keys.add(k); }
  for (const v of input.vehicleEvents) { const k = lotKey(v.source_url); if (k) keys.add(k); }
  if (keys.size === 0) return { sequences: [], importStampedDays: [] };

  // items per listing; rows with no listing URL of their own go to the car's own listing
  const itemsByKey = new Map<string, AuctionItem[]>();
  for (const k of keys) itemsByKey.set(k, []);
  const pending: AuctionCommentRow[] = [];
  for (const c of input.comments) {
    const k = lotKey(c.source_url);
    if (k) pushItem(itemsByKey.get(k)!, c, k); else pending.push(c);
  }
  for (const list of itemsByKey.values()) sortItems(list);

  // the default listing: the hint, else the listing with the latest activity
  let defaultKey = hintKey ?? null;
  if (!defaultKey) {
    let latest = '';
    for (const [k, list] of itemsByKey) {
      const last = list.length ? list[list.length - 1].at : '';
      if (last >= latest) { latest = last; defaultKey = k; }
    }
    if (!defaultKey) defaultKey = Array.from(keys)[0];
  }
  for (const c of pending) pushItem(itemsByKey.get(defaultKey)!, c, defaultKey);
  sortItems(itemsByKey.get(defaultKey)!);

  // one sequence per listing
  const drafts = Array.from(keys).map(key => buildOne(key, itemsByKey.get(key)!, input));

  // timeline events that name no listing belong to the car's own listing (once)
  const unmatched = input.timelineEvents.filter(t => /^auction_/.test(String(t.event_type ?? '')) && !drafts.some(d => timelineMatchesKey(t, d.key, d.lotNumber)));
  const def = drafts.find(d => d.key === defaultKey);
  if (def && unmatched.length) applyTimelineFallbacks(def, unmatched);

  // order: newest first
  const when = (s: AuctionSequence) => s.open?.at ?? s.close?.at ?? (s.items[0]?.at ?? '');
  drafts.sort((a, b) => (when(a) < when(b) ? 1 : when(a) > when(b) ? -1 : 0));
  drafts.forEach((s, i) => { s.ordinal = drafts.length - i; s.listingCount = drafts.length; });

  // photos: a BaT-hosted photo has no capture time in Nuke; its upload month names its listing
  const stamped = new Set<string>();
  for (const im of input.images) {
    if (!isBatHosted(im)) continue;
    const t = isoOrNull(im.taken_at);
    if (t) stamped.add(localDate(t));
    const target = listingForPhoto(im, drafts);
    if (!target) continue;
    if (!uploadMonth(im.source_url) && drafts.length > 1) target.photos.attributionUncertain = true;
    target.photos.publishedWithListing += 1;
  }

  return { sequences: drafts, importStampedDays: Array.from(stamped).sort() };
}

/** The month a listing's photos were published: the month it opened, or the one before. */
function publishMonths(s: AuctionSequence): string[] {
  const at = s.open?.at ?? s.items[0]?.at ?? s.close?.at;
  if (!at) return [];
  const d = new Date(at);
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  const fmt = (x: Date) => `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`;
  return [fmt(d), fmt(prev)];
}

/**
 * Which listing a BaT-hosted photo was published with: the listing whose opening month
 * matches the photo's upload path; a photo with no path sits on the car's own (newest)
 * listing. Null for a photo that is not BaT-hosted (it has its own capture time).
 */
export function listingForPhoto(im: ImageStampRow, sequences: AuctionSequence[]): AuctionSequence | null {
  if (!isBatHosted(im) || sequences.length === 0) return null;
  const month = uploadMonth(im.source_url);
  if (month) {
    const hit = sequences.find(s => publishMonths(s).includes(month));
    if (hit) return hit;
  }
  return sequences.find(s => s.ordinal === s.listingCount) ?? sequences[0];
}

function pushItem(list: AuctionItem[], c: AuctionCommentRow, key: string): void {
  const at = isoOrNull(c.posted_at);
  if (!at) return;
  const isBid = c.comment_type === 'bid' || c.bid_amount != null;
  const isSeller = c.is_seller === true || c.comment_type === 'seller_response';
  list.push({
    id: c.id,
    kind: isBid ? 'bid' : isSeller ? 'seller' : 'comment',
    at,
    amount: isBid ? c.bid_amount : null,
    author: c.author_username ?? 'unknown',
    text: c.comment_text ?? '',
    url: commentPermalink(lotUrlFor(key), c.bat_comment_id),
    likes: c.comment_likes ?? 0,
    seq: c.sequence_number,
    postClose: false,
    listingKey: key,
  });
}

function sortItems(list: AuctionItem[]): void {
  list.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : (a.seq ?? 0) - (b.seq ?? 0)));
}

function buildOne(key: string, items: AuctionItem[], input: SequenceInput): AuctionSequence {
  const ev = input.auctionEvents.find(e => lotKey(e.source_url) === key) ?? null;
  const vevs = input.vehicleEvents.filter(v => lotKey(v.source_url) === key);
  const tl = input.timelineEvents.filter(t => /^auction_/.test(String(t.event_type ?? '')) && timelineMatchesKey(t, key, ev?.lot_number ?? null));
  const bids = items.filter(i => i.kind === 'bid');
  const firstAt = items[0]?.at ?? null;
  const lastAt = items.length ? items[items.length - 1].at : null;
  // a recorded moment that lies far outside the listing's own activity is another listing's
  const plausible = (iso: string): boolean => {
    if (!firstAt || !lastAt) return true;
    const t = new Date(iso).getTime();
    return t >= new Date(firstAt).getTime() - WINDOW_SLACK && t <= new Date(lastAt).getTime() + WINDOW_SLACK;
  };

  let open: Moment | null = null;
  const started = vevs.map(v => isoOrNull(v.started_at)).find((s): s is string => !!s && plausible(s));
  const listed = tl.find(t => t.event_type === 'auction_listed' && t.event_date);
  if (started) open = { at: started, basis: 'listing start recorded by the extractor', exact: hasClock(started) };
  else if (listed?.event_date) open = { at: new Date(`${listed.event_date.slice(0, 10)}T12:00:00`).toISOString(), basis: 'listing day; time not recorded', exact: false };
  else if (items.length) open = { at: items[0].at, basis: `first activity — ${items[0].kind === 'bid' ? 'first bid' : 'first comment'}; the listing opened some hours before`, exact: false };

  let close: Moment | null = null;
  const ended = vevs.map(v => isoOrNull(v.ended_at) ?? isoOrNull(v.sold_at)).find((s): s is string => !!s && plausible(s));
  const finalBid = bids.length ? bids[bids.length - 1] : null;
  if (ended && hasClock(ended)) close = { at: ended, basis: 'auction end recorded by the extractor', exact: true };
  else if (finalBid) close = { at: finalBid.at, basis: 'final bid — BaT closes within two minutes of the last bid; the exact end is not recorded', exact: false };
  else if (ended) close = { at: ended, basis: 'sale day; time not recorded', exact: false };
  else {
    const sold = tl.find(t => (t.event_type === 'auction_sold' || t.event_type === 'auction_ended') && t.event_date);
    if (sold?.event_date) close = { at: new Date(`${sold.event_date.slice(0, 10)}T12:00:00`).toISOString(), basis: 'sale day; time not recorded', exact: false };
  }
  if (close) for (const i of items) i.postClose = i.at > close.at && i.kind !== 'bid';

  const statusText = `${ev?.outcome ?? ''} ${vevs.map(v => v.event_status ?? '').join(' ')}`.toLowerCase();
  const outcome: AuctionSequence['outcome'] =
    /sold/.test(statusText) ? 'sold'
      : /reserve_not_met|reserve not met/.test(statusText) ? 'reserve_not_met'
        : /no_sale|unsold/.test(statusText) ? 'no_sale'
          : /withdrawn/.test(statusText) ? 'withdrawn'
            : /active|live/.test(statusText) ? 'live'
              : 'unknown';
  const price = ev?.winning_bid ?? vevs.map(v => v.final_price).find((p): p is number => p != null) ?? (finalBid?.amount ?? null);

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

  return {
    key, lotUrl: lotUrlFor(key), lotNumber: ev?.lot_number ?? null,
    ordinal: 1, listingCount: 1,
    open, close, outcome, price,
    buyer: ev?.winning_bidder ?? null,
    seller: ev?.seller_name ?? null,
    bidCount: ev?.total_bids ?? (bids.length || null),
    commentCount: items.length ? items.length : (ev?.comments_count ?? null),
    watchers: ev?.watchers ?? null,
    views: ev?.page_views ?? null,
    items,
    days: Array.from(dayMap.values()).sort((a, b) => (a.date < b.date ? -1 : 1)),
    activityExtracted: items.length > 0,
    photos: { publishedWithListing: 0, attributionUncertain: false },
  };
}

/** Unnamed listed/sold day events fill the car's own listing only where it has no better moment. */
function applyTimelineFallbacks(seq: AuctionSequence, events: TimelineEventLike[]): void {
  if (!seq.open) {
    const listed = events.find(t => t.event_type === 'auction_listed' && t.event_date);
    if (listed?.event_date) seq.open = { at: new Date(`${listed.event_date.slice(0, 10)}T12:00:00`).toISOString(), basis: 'listing day; time not recorded', exact: false };
  }
  if (!seq.close) {
    const sold = events.find(t => (t.event_type === 'auction_sold' || t.event_type === 'auction_ended') && t.event_date);
    if (sold?.event_date) seq.close = { at: new Date(`${sold.event_date.slice(0, 10)}T12:00:00`).toISOString(), basis: 'sale day; time not recorded', exact: false };
  }
}

/** The single newest sequence, for callers that only want the car's latest listing. */
export function buildAuctionSequence(input: SequenceInput): AuctionSequence | null {
  return buildAuctionSequences(input).sequences[0] ?? null;
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
