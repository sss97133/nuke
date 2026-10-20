// The source level of /browse: what one source holds, read the way browse_source_read sends it, and the plain
// words a visitor reads over it. One typed read, one clock: as_of dates the page, holdings.folded_at dates the
// daily count under every number, and landed_24h and last_landed are live. Decoding is tolerant (a missing list is
// [], a number sent as text is a number, a null never throws) and it enforces the median floor a second time, at five
// or the reader's own if that is higher, so a median under the floor cannot reach a screen even if a reader sends one
// or lowers the floor. Species choose every word: no source is named in this file.
import { supabase } from '../../lib/supabase';

export type SourceBrowseStatus = 'ok' | 'not_folded' | 'unknown_source';
export type SourceBrowseLevel = 'makes' | 'models' | 'listings';
export type ListingStatus = 'active' | 'upcoming' | 'sold' | 'ended' | 'unknown';
export type SourceSort = 'newest' | 'price_desc' | 'price_asc' | 'year_desc' | 'year_asc';

export type SourceIdentity = {
  slug: string;
  name: string;
  category: string | null;
  species: string | null;
  species_label: string | null;
  /** The species group's unit as the registry words it, e.g. "listings held". */
  unit: string | null;
  logo_url: string | null;
  base_url: string | null;
};

/**
 * What a group of listings holds, by status. A median is null under the floor, and each *_n is the count of priced
 * listings behind its median. The page shows no median; the decoder still reads and floors every one.
 */
export type Tally = {
  episodes: number;
  vehicles: number;
  active: number;
  upcoming: number;
  sold: number;
  ended: number;
  with_image: number;
  shown_n: number;
  shown_median: number | null;
  active_n: number;
  active_median: number | null;
  ended_n: number;
  ended_median: number | null;
  sold_n: number;
  sold_median: number | null;
  year_min: number | null;
  year_max: number | null;
};

/**
 * The Sources board's own count for a source: the lots it matched to Nuke's own collection list (a coverage measure, not the
 * number of listings on public vehicles), the board's day, and the source's own total when one is known. `day` is the
 * board's calendar day as sent.
 */
export type SourceBoard = {
  day: string;
  lots: number;
  landed_at: string | null;
  population: number | null;
  population_method: string | null;
  /** A share from 0 to 1; anything else the reader sends is unknown. */
  population_confidence: number | null;
  population_at: string | null;
};

export type SourceHoldings = Tally & {
  unknown: number;
  makes: number;
  models: number;
  /** Listings read from a saved copy of the page (they carry an archive_url). */
  archived: number;
  /** The earliest and latest listing clock (end, else start) among the source's listings. */
  dated_min: string | null;
  dated_max: string | null;
  first_seen: string | null;
  last_seen: string | null;
  folded_at: string | null;
  landed_24h: number;
  last_landed: string | null;
  board: SourceBoard | null;
};

export type TopModel = { model: string; episodes: number };
export type MakeRow = Tally & { make: string; top_models: TopModel[] };
export type ModelRow = Tally & { model: string };

export type ListingRow = {
  vehicle_id: string;
  /** The id of the event row this listing is: the exact key of a row, when the reader sends one. */
  event_id: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  status: ListingStatus;
  status_raw: string | null;
  shown_price: number | null;
  sold_price: number | null;
  price_kind: string | null;
  /** The source's own word for the price, when the reader sends one ("Starting bid", "Current bid"); null when it sent none. */
  price_label: string | null;
  /** Bids the capture recorded; null or 0 means none recorded, never "none were made". */
  bids: number | null;
  /** The seller's own listing date; null when the source gave none. */
  listed_at: string | null;
  /** When Nuke first recorded the row: ours, never the seller's. */
  recorded_at: string | null;
  /** When Nuke last wrote the row. For a listing alive by the source's word with no end clock it is the only evidence the listing was still alive. */
  checked_at: string | null;
  ends_at: string | null;
  location: string | null;
  image_url: string | null;
  listing_url: string | null;
  /** The saved copy of the page this listing was read from, when it was read from one. */
  archive_url: string | null;
};

export type ListingsPage = { total: number; page: number; page_size: number; rows: ListingRow[] };

export type SourceBrowseRead = {
  as_of: string | null;
  status: SourceBrowseStatus;
  median_floor: number;
  source: SourceIdentity;
  holdings: SourceHoldings;
  level: SourceBrowseLevel;
  scope: { make: string | null; model: string | null; status: ListingStatus | null };
  makes: MakeRow[];
  models: ModelRow[];
  listings: ListingsPage;
};

export type SourceBrowseParams = {
  source: string;
  make?: string | null;
  model?: string | null;
  page?: number;
  pageSize?: number;
  sort?: SourceSort;
  /** Narrows the listings level to one status; the reader is asked only when this is given. */
  status?: ListingStatus | null;
};

export const PAGE_SIZE = 60;
export const DEFAULT_FLOOR = 5;

export const SORTS: Array<{ value: SourceSort; label: string }> = [
  { value: 'newest', label: 'Newest' },
  { value: 'price_desc', label: 'Price high' },
  { value: 'price_asc', label: 'Price low' },
  { value: 'year_desc', label: 'Year new' },
  { value: 'year_asc', label: 'Year old' },
];

// MARK: - Tolerant decoding

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const real = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const whole = (v: unknown): number => Math.max(0, Math.round(real(v) ?? 0));
const money = (v: unknown): number | null => {
  const n = real(v);
  return n !== null && n > 0 ? n : null;
};
const yearOf = (v: unknown): number | null => {
  const n = real(v);
  return n !== null && n >= 1800 && n <= 2100 ? Math.round(n) : null;
};
/** A median needs `floor` values behind it; under the floor it is unknown, whatever the reader sent. */
const floored = (median: unknown, n: number, floor: number): number | null => (n >= floor ? money(median) : null);
const given = (v: unknown): boolean => v !== undefined && v !== null;
const STATUSES: readonly ListingStatus[] = ['active', 'upcoming', 'sold', 'ended', 'unknown'];
const statusOf = (v: unknown): ListingStatus | null => STATUSES.find(s => s === v) ?? null;

/** A clock every browser reads: "2026-09-28 17:00" gets its T (Safari refuses the space) and a bare "+00" offset its ":00"; anything unreadable is unknown. */
const clock = (v: unknown): string | null => {
  const s = text(v)?.trim();
  if (!s) return null;
  const iso = s.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/, '$1T$2').replace(/(T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)([+-]\d{2})$/, '$1$2:00');
  return Number.isFinite(Date.parse(iso)) ? iso : null;
};

/** The calendar year of a clock, in UTC as the page prints its days; null when the clock is missing or unreadable. */
export function yearOfClock(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? yearOf(new Date(t).getUTCFullYear()) : null;
}

/** Only a web address is a link. */
export function httpUrl(v: unknown): string | null {
  const s = text(v)?.trim();
  return s && /^https?:\/\//i.test(s) ? s : null;
}
const photoUrl = (v: unknown): string | null => {
  const s = text(v)?.trim();
  return s && (/^https?:\/\//i.test(s) || s.startsWith('/')) ? s : null;
};
// The registry stores the hosted mark under the site's own origin; the app serves the same file from its root.
const logoUrl = (v: unknown): string | null => text(v)?.replace(/^https:\/\/nuke\.ag\/source-logos\//, '/source-logos/') ?? null;

function parseTally(o: Json, floor: number): Tally {
  const sold = whole(o.sold);
  const sold_n = given(o.sold_n) ? Math.min(sold, whole(o.sold_n)) : sold;
  const shown_n = whole(o.shown_n);
  // A reader built to the first contract sends only shown_*, the price of what is alive; the per-status keys then repeat it.
  const activeSent = given(o.active_n);
  const active_n = activeSent ? whole(o.active_n) : shown_n;
  const ended_n = whole(o.ended_n);
  return {
    episodes: whole(o.episodes),
    vehicles: whole(o.vehicles),
    active: whole(o.active),
    upcoming: whole(o.upcoming),
    sold,
    ended: whole(o.ended),
    with_image: whole(o.with_image),
    shown_n,
    shown_median: floored(o.shown_median, shown_n, floor),
    active_n,
    active_median: floored(activeSent ? o.active_median : o.shown_median, active_n, floor),
    ended_n,
    ended_median: floored(o.ended_median, ended_n, floor),
    sold_n,
    sold_median: floored(o.sold_median, sold_n, floor),
    year_min: yearOf(o.year_min),
    year_max: yearOf(o.year_max),
  };
}

/** The board's count, or null when the reader sent none (a board with no lots figure has nothing to show). */
function parseBoard(v: unknown): SourceBoard | null {
  const b = obj(v);
  const lots = real(b.lots);
  if (lots === null || lots < 0) return null;
  const population = real(b.population);
  const confidence = real(b.population_confidence);
  return {
    day: clock(b.day) ?? '',
    lots: Math.round(lots),
    landed_at: clock(b.landed_at),
    population: population !== null && population > 0 ? Math.round(population) : null,
    population_method: text(b.population_method)?.trim() ?? null,
    population_confidence: confidence !== null && confidence >= 0 && confidence <= 1 ? confidence : null,
    population_at: clock(b.population_at),
  };
}

function parseListing(v: unknown): ListingRow | null {
  const o = obj(v);
  const vehicle_id = text(o.vehicle_id);
  if (vehicle_id === null) return null;
  return {
    vehicle_id,
    event_id: text(o.event_id)?.trim() ?? null,
    year: yearOf(o.year),
    make: text(o.make),
    model: text(o.model),
    trim: text(o.trim),
    status: statusOf(o.status) ?? 'unknown',
    status_raw: text(o.status_raw),
    shown_price: money(o.shown_price),
    sold_price: money(o.sold_price),
    price_kind: text(o.price_kind),
    price_label: text(o.price_label)?.trim() ?? null,
    bids: real(o.bids),
    listed_at: clock(o.listed_at),
    recorded_at: clock(o.recorded_at) ?? clock(o.first_seen_at),
    checked_at: clock(o.checked_at),
    ends_at: clock(o.ends_at),
    location: text(o.location),
    image_url: photoUrl(o.image_url),
    listing_url: httpUrl(o.listing_url),
    archive_url: httpUrl(o.archive_url),
  };
}

/** Decode the reader's jsonb. `fallbackSlug` names the source when the reader sent none (an unknown source). */
export function parseSourceBrowse(json: unknown, fallbackSlug = ''): SourceBrowseRead {
  const root = obj(json);
  const rawStatus = text(root.status);
  const status: SourceBrowseStatus = rawStatus === 'not_folded' || rawStatus === 'unknown_source' ? rawStatus
    : Object.keys(root).length === 0 ? 'unknown_source' : 'ok';
  // The reader may raise the floor; it can never lower it under the five the page promises.
  const floor = Math.max(DEFAULT_FLOOR, Math.round(real(root.median_floor) ?? DEFAULT_FLOOR));

  const s = obj(root.source);
  const slug = text(s.slug) ?? fallbackSlug;
  const source: SourceIdentity = {
    slug,
    name: text(s.name) ?? slug,
    category: text(s.category),
    species: text(s.species),
    species_label: text(s.species_label),
    unit: text(s.unit) ?? text(obj(root.holdings).unit),
    logo_url: logoUrl(s.logo_url),
    base_url: text(s.base_url),
  };

  const h = obj(root.holdings);
  const holdings: SourceHoldings = {
    ...parseTally(h, floor),
    unknown: whole(h.unknown),
    makes: whole(h.makes),
    models: whole(h.models),
    archived: whole(h.archived),
    dated_min: clock(h.dated_min),
    dated_max: clock(h.dated_max),
    first_seen: clock(h.first_seen),
    last_seen: clock(h.last_seen),
    folded_at: clock(h.folded_at),
    landed_24h: whole(h.landed_24h),
    last_landed: clock(h.last_landed),
    board: parseBoard(h.board),
  };

  const scopeIn = obj(root.scope);
  const scope = { make: text(scopeIn.make), model: text(scopeIn.model), status: statusOf(scopeIn.status) };
  const rawLevel = text(root.level);
  const level: SourceBrowseLevel = rawLevel === 'makes' || rawLevel === 'models' || rawLevel === 'listings' ? rawLevel
    : scope.make && scope.model ? 'listings' : scope.make ? 'models' : 'makes';

  const makes: MakeRow[] = [];
  for (const item of list(root.makes)) {
    const o = obj(item);
    const make = text(o.make);
    if (make === null) continue;
    const top_models: TopModel[] = [];
    for (const t of list(o.top_models)) {
      const m = obj(t);
      const model = text(m.model);
      if (model !== null) top_models.push({ model, episodes: whole(m.episodes) });
    }
    makes.push({ make, ...parseTally(o, floor), top_models });
  }
  const models: ModelRow[] = [];
  for (const item of list(root.models)) {
    const o = obj(item);
    const model = text(o.model);
    if (model !== null) models.push({ model, ...parseTally(o, floor) });
  }

  const l = obj(root.listings);
  const rows = list(l.rows).map(parseListing).filter((r): r is ListingRow => r !== null);
  const listings: ListingsPage = {
    total: Math.max(whole(l.total), rows.length),
    page: Math.max(1, whole(l.page)),
    page_size: Math.max(1, whole(l.page_size) || PAGE_SIZE),
    rows,
  };

  return { as_of: clock(root.as_of), status, median_floor: floor, source, holdings, level, scope, makes, models, listings };
}

/** One read of the source, one scope, one page. Rejects when the reader or the network fails. */
export async function readSourceBrowse(params: SourceBrowseParams): Promise<SourceBrowseRead> {
  const { data, error } = await supabase.rpc('browse_source_read', {
    p_source: params.source,
    p_make: params.make ?? null,
    p_model: params.model ?? null,
    p_page: params.page ?? 1,
    p_page_size: params.pageSize ?? PAGE_SIZE,
    p_sort: params.sort ?? 'newest',
    ...(params.status ? { p_status: params.status } : {}),
  });
  if (error) throw new Error(error.message || 'Source holdings could not be read.');
  return parseSourceBrowse(data, params.source);
}

// MARK: - Plain words, chosen by species

/** The timed and block auction species show only bids as their price; every other species mixes asking prices, buy-it-now prices and bids. */
const AUCTION_SPECIES = new Set(['timed_auction', 'block_house']);

export type SourceLabels = {
  /** What one row's price is called when the source gave it no kind of its own: "High bid" for an auction species, "Asking" for the rest. */
  shown: 'High bid' | 'Asking';
  /**
   * What an aggregate over many rows' prices is called, lower case ("high bid", "shown price"). An auction species shows
   * only bids. Every other species mixes asking prices, buy-it-now prices and bids, so a figure taken over them is of the
   * neutral "shown price", never of an ask. The page shows no median; this is the aggregate's word, not the lower case of `shown`.
   */
  shownLower: 'high bid' | 'shown price';
  /** What one row of this source is, plural: lots, vehicles, posts, listings, or pages for an aggregator. */
  noun: string;
  /** The headline's label: "lots held", or the registry's own unit when that is not one plain word held ("pages read, not listings held"). */
  held: string;
  /** True when the shown price is a bid. */
  bidding: boolean;
};

/** The registry's own unit for the aggregator species, for a read that sends none: its rows are pages read, and they are not listings held. */
const AGGREGATOR_UNIT = 'pages read, not listings held';

/** What one row is called and what the headline says it is, from the registry's unit where it is plain and from the species where it is not. */
function wordsFor(species: string | null, unit: string | null): { noun: string; held: string } {
  const own = unit?.trim() ?? '';
  // The registry's own unit ("lots held") wins when it is one plain word held.
  const fromUnit = /^([a-z]+) held$/i.exec(own)?.[1]?.toLowerCase();
  if (fromUnit) return { noun: fromUnit, held: `${fromUnit} held` };
  const noun = species === 'aggregator' ? 'pages'
    : species !== null && AUCTION_SPECIES.has(species) ? 'lots'
      : species === 'dealer' ? 'vehicles'
        : species === 'classifieds' ? 'posts' : 'listings';
  // Any other unit is the registry's own words for what is counted, and the headline says them as they are: an aggregator
  // reads pages, which are not listings held, and a page that called them listings would say the opposite of the Sources board.
  return { noun, held: own || (species === 'aggregator' ? AGGREGATOR_UNIT : `${noun} held`) };
}

/** The words for one source's read, by its species group and never by its name. */
export function labelsFor(read: { source: Pick<SourceIdentity, 'species' | 'unit'> }): SourceLabels {
  const species = read.source.species;
  const bidding = species !== null && AUCTION_SPECIES.has(species);
  const { noun, held } = wordsFor(species, read.source.unit);
  return { shown: bidding ? 'High bid' : 'Asking', shownLower: bidding ? 'high bid' : 'shown price', noun, held, bidding };
}

/** How a source's own total was measured, in a visitor's words. A count says where it came from; an estimate says that it is one and is not a count. */
const TOTAL_HOW = new Map<string, { count: boolean; words: string }>([
  ['enumerated', { count: true, words: 'counted from its own listings' }],
  ['api_count', { count: true, words: 'from the total it reports' }],
  ['search_index', { count: true, words: 'from its search results' }],
  ['sitemap', { count: true, words: 'from its sitemap' }],
  ['docket_and_broadcast_census', { count: true, words: 'counted from its sale catalogues and broadcasts' }],
  ['owner_reference', { count: false, words: 'a reference figure, not a count' }],
  ['catalogue_estimate', { count: false, words: 'from its catalogue, not a count' }],
  ['estimate', { count: false, words: 'an earlier figure, not a count' }],
  ['bounded', { count: false, words: 'somewhere within a range, not a count' }],
  ['window_extrapolated', { count: false, words: 'extrapolated from its recent listings, not a count' }],
  ['turnover_model', { count: false, words: 'modeled from its live listings and daily turnover, not a count' }],
  ['capture_model', { count: false, words: 'modeled from how fast Nuke records its listings, not a count' }],
]);

/**
 * The plain words for a method the Sources board recorded, or null when none was recorded or this page has no words for
 * it: the method's own name is never printed, and a total of unknown method is never worded as a count.
 */
export function totalHow(method: string | null): { count: boolean; words: string } | null {
  return TOTAL_HOW.get(method?.trim().toLowerCase().replace(/[\s-]+/g, '_') ?? '') ?? null;
}

/** The noun agrees with its count: "listing" for 1, "listings" otherwise. */
export function agree(n: number, noun: string): string {
  return n === 1 && noun.endsWith('s') ? noun.slice(0, -1) : noun;
}

/** "1 listing", "3 listings". */
export function counted(n: number, noun: string): string {
  return `${n.toLocaleString('en-US')} ${agree(n, noun)}`;
}

/** Whole dollars, except under $100 where the cents show: a $7.99 starting price is not "$8". */
export function usd(n: number): string {
  const cents = n < 100 ? Math.round(n * 100) / 100 : n;
  if (cents < 100 && !Number.isInteger(cents)) return `$${cents.toFixed(2)}`;
  return `$${Math.round(cents).toLocaleString('en-US')}`;
}

/** The word for a status bucket. */
const STATUS_WORD: Record<ListingStatus, string> = {
  active: 'Live', upcoming: 'Upcoming', sold: 'Sold', ended: 'Ended', unknown: 'Status not recorded',
};
export const statusWord = (status: ListingStatus): string => STATUS_WORD[status];

/** The source's own word for how an ended listing ended, as a visitor reads it. Keyed by the word lower case with runs of space, "_" and "-" as one "_". */
const ENDED_WORD = new Map<string, string>([
  ['bid_goes_on', 'Bid goes on'], ['reserve_not_met', 'Reserve not met'], ['unsold', 'Unsold'],
  ['withdrawn', 'Withdrawn'], ['cancelled', 'Cancelled'], ['canceled', 'Cancelled'], ['expired', 'Expired'],
]);

/**
 * The status as a card says it: the bucket word, except that an ended listing says the source's own word when that
 * word says more than "ended" ("Bid goes on", "Reserve not met", "Unsold", "Withdrawn", "Cancelled", "Expired").
 * Any other word the source used is just "Ended".
 */
export function statusLabel(row: Pick<ListingRow, 'status' | 'status_raw'>): string {
  if (row.status !== 'ended') return STATUS_WORD[row.status];
  const word = row.status_raw?.trim().toLowerCase().replace(/[\s_-]+/g, '_') ?? '';
  return ENDED_WORD.get(word) ?? STATUS_WORD.ended;
}

/**
 * The one price line of a listing: what it sold for, else the price as the source showed it, in the source's own words.
 * A price the source called a bid says what stands behind it: the source's own word for it when the reader sends one
 * ("Starting bid" for a listing nobody bid on), else "6 bids", or, when the capture carried no count (null or 0), that
 * the count was not recorded: a starting price is not a bid anyone made, and "a bid" beside "no bids" says two things.
 * A count of 0 alone never becomes "Starting bid": a capture can record 0 where the listing drew bids. A listing that
 * is over (ended, or sold with no price recorded) shows its last bid, so it never reads like a bid that is still open.
 */
export function priceLine(
  row: Pick<ListingRow, 'sold_price' | 'shown_price' | 'price_kind' | 'bids'> & { price_label?: string | null; status?: ListingStatus },
  labels: SourceLabels,
): string | null {
  if (row.sold_price !== null) return `Sold ${usd(row.sold_price)}`;
  if (row.shown_price === null) return null;
  const price = usd(row.shown_price);
  if (row.price_kind === 'buy_it_now') return `Buy it now ${price}`;
  const bids = row.bids !== null ? Math.round(row.bids) : 0;
  const behind = bids > 0 ? ` · ${counted(bids, 'bids')}` : '';
  if (row.price_kind === 'current_bid') {
    if (row.price_label) return `${row.price_label} ${price}${behind}`;
    const over = row.status === 'ended' || row.status === 'sold';
    if (bids > 0) return `${over ? 'Last bid' : 'Bid'} ${price}${behind}`;
    return `${over ? 'Last bid shown' : 'Bid shown'} ${price} · bid count not recorded`;
  }
  return `${labels.shown} ${price}${labels.bidding ? behind : ''}`;
}

/** The years a group spans: "1969", "1932–2024", or null when none is recorded. */
export function yearSpan(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  if (min === null || max === null || min === max) return String(min ?? max);
  return `${min}–${max}`;
}

// The reader sends the id of the event row a listing is, and that is its key. A row from a reader that sends none is told from
// another by the vehicle, its address, the day it was listed and how it ended: two episodes of one vehicle with no address and
// no listed day still differ by their end and their word.
const rowKey = (r: ListingRow): string => r.event_id ?? [r.vehicle_id, r.listing_url ?? '', r.listed_at ?? '', r.ends_at ?? '', r.status_raw ?? ''].join('\u0001');

/** The next page after the rows already shown. New arrivals shift a page boundary, so a row seen twice is kept once. */
export function appendRows(shown: ListingRow[], next: ListingRow[]): ListingRow[] {
  const seen = new Set(shown.map(rowKey));
  return [...shown, ...next.filter(r => !seen.has(rowKey(r)))];
}
