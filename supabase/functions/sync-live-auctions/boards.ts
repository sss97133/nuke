/**
 * Pure readers for the board-synced houses (no I/O): PCarMarket's server-rendered auction board and lot bid history,
 * Bonhams' Typesense sale and lot documents and its bidding platform's lot states, Broad Arrow's timed sales on its
 * bidding site, and Gooding's bidding-platform lots with its catalog's identity. sync-live-auctions fetches; these parse.
 */

/** One open lot on PCarMarket's live board (the Basta query cache the page server-renders). */
export interface PcarBoardItem {
  id: string;
  slug: string;
  url: string;
  title: string;
  status: string;
  currency: string | null;
  current_bid: number | null; // dollars (the board carries cents)
  bid_count: number | null;
  ends: string | null;
  schema: string | null;
  image_count: number | null;
}

const str = (chunk: string, key: string): string | null => {
  const m = chunk.match(new RegExp(`(?:^|[,{])${key}:"((?:[^"\\\\]|\\\\.)*)"`));
  return m ? m[1].replace(/\\"/g, '"').replace(/\\u002F/gi, "/").replace(/\\\\/g, "\\") : null;
};
const int = (chunk: string, key: string): number | null => {
  const m = chunk.match(new RegExp(`(?:^|[,{])${key}:(-?\\d+)`));
  return m ? Number(m[1]) : null;
};

/** Items on one board page, and the page count the board reports. */
export function parsePcarBoard(html: string): { items: PcarBoardItem[]; totalPages: number | null } {
  const chunks = html.split('{__typename:"Item",').slice(1);
  const items: PcarBoardItem[] = [];
  for (const raw of chunks) {
    const chunk = raw.slice(0, 6000);
    const id = str(chunk, "id");
    const path = str(chunk, "slugFullPath");
    const slug = path?.split("/")[1];
    if (!id || !slug) continue;
    const cents = int(chunk, "currentBid");
    items.push({
      id,
      slug,
      url: `https://pcarmarket.com/auction/${slug}`,
      title: str(chunk, "title") ?? slug,
      status: str(chunk, "status") ?? "",
      currency: str(chunk, "currency"),
      current_bid: cents !== null && cents > 0 ? cents / 100 : null,
      bid_count: int(chunk, "totalBids"),
      ends: str(chunk, "closingEnd"),
      schema: str(chunk, "schemaName"),
      image_count: int(chunk, "imageCount"),
    });
  }
  const tp = html.match(/totalPages:(\d+)/);
  return { items, totalPages: tp ? Number(tp[1]) : null };
}

/** One bid in a PCarMarket lot's bid history, with Basta's own id and time. */
export interface PcarBid { id: string; amount: number; at: string; bidder: string | null; status: string | null }

/** The bid history a PCarMarket lot page server-renders: bids:$R[n]=[{id,amount (cents),date,bidStatus,bidderIdentifier}, ...]. */
export function parsePcarBids(html: string): PcarBid[] {
  const start = html.search(/[,{]bids:\$R\[\d+\]=\[/);
  if (start < 0) return [];
  // elements are serialized as $R[n]={id,amount,date,...}; the array closes at the first "]" not opening a $R ref
  const body = html.slice(start, start + 200_000);
  const close = body.slice(body.indexOf("=[") + 2).search(/(?<!\$R\[\d*)\](?!=)/);
  const seg = close >= 0 ? body.slice(0, body.indexOf("=[") + 2 + close + 1) : body;
  const out: PcarBid[] = [];
  const seen = new Set<string>();
  for (const m of seg.matchAll(/\{id:"([0-9a-f-]{36})",amount:(\d+),date:"([^"]+)"([^}]*)\}/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const rest = m[4];
    out.push({
      id: m[1],
      amount: Number(m[2]) / 100,
      at: m[3],
      bidder: rest.match(/bidderIdentifier:"((?:[^"\\]|\\.)*)"/)?.[1] ?? null,
      status: rest.match(/bidStatus:"([A-Z_]+)"/)?.[1] ?? null,
    });
  }
  return out;
}

/** The fields of a Bonhams Typesense lot document the live board uses. */
export interface BonhamsLotDoc {
  id: string;
  lotId?: string;
  auctionId?: string;
  lotAMId?: string; // the lot's id on Bonhams' bidding platform (Auction Mobility, live.bonhams.com)
  auctionAMId?: string;
  title?: string;
  slug?: string;
  status?: string;
  hammerTime?: { datetime?: string };
  auctionEndDate?: { datetime?: string };
  currency?: { iso_code?: string };
  price?: Record<string, unknown>;
  flags?: { isAuctionEnded?: boolean; isWithoutReserve?: boolean };
  image?: { url?: string };
}

const positive = (v: unknown): number | null => {
  const n = Number(v);
  return v !== null && v !== "" && Number.isFinite(n) && n > 0 ? n : null;
};

/** A Bonhams lot as a board row: its page url (the spelling vehicles already hold), close time, estimate, currency. */
export function bonhamsLot(doc: BonhamsLotDoc) {
  const sale = doc.auctionId ?? doc.id.split("-")[0];
  const lot = doc.lotId ?? doc.id.split("-")[1];
  const cur = doc.currency?.iso_code ?? null;
  const p = doc.price ?? {};
  return {
    external_id: doc.id,
    url: `https://www.bonhams.com/auction/${sale}/lot/${lot}/${doc.slug ?? ""}`.replace(/\/$/, ""),
    title: doc.title ?? "",
    ends: doc.hammerTime?.datetime ?? doc.auctionEndDate?.datetime ?? null,
    currency: cur,
    // estimateLow/High are in the lot's own currency; <CUR>LowEstimate is absent for some (a EUR lot carries only GBP*)
    estimate_low: (cur ? positive(p[`${cur}LowEstimate`]) : null) ?? positive(p.estimateLow),
    estimate_high: (cur ? positive(p[`${cur}HighEstimate`]) : null) ?? positive(p.estimateHigh),
    hammer: positive(p.hammerPrice ?? p[`${cur}HammerPrice`]),
    status: doc.status ?? null,
    am_lot_id: doc.lotAMId ?? null,
    am_sale_id: doc.auctionAMId ?? null,
    no_reserve: doc.flags?.isWithoutReserve === true,
    image: doc.image?.url || null,
  };
}

/** The fields of a Bonhams Typesense sale document (collection "auctions") the reader uses. */
export interface BonhamsSaleDoc {
  id: string;
  auctionTitle?: string;
  auctionType?: string; // ONLINE (timed, bid on the site) | PUBLIC (in the room) | EXHIBITION
  biddingStatus?: string; // NS not started | IP in progress | EN ended
  dates?: { end?: { datetime?: string } };
  flags?: { isAuctionEnded?: boolean };
}

/**
 * How a Bonhams sale takes bids, from its own index:
 *   live_bid        an online timed sale with bidding open (ONLINE, IP): every lot has a running bid and its own close;
 *   online_not_open an online sale whose bidding has not opened (ONLINE, NS): estimates only, no bid yet;
 *   catalog         an in-room sale (PUBLIC): estimates and a sale date; bids are taken in the room on the day, so its
 *                   lots are never a live bid (they stay on the auction calendar);
 *   ended           bidding is over.
 */
export type BonhamsSaleKind = "live_bid" | "online_not_open" | "catalog" | "ended";

export function bonhamsSaleKind(sale: BonhamsSaleDoc): BonhamsSaleKind {
  if (sale.flags?.isAuctionEnded || sale.biddingStatus === "EN") return "ended";
  if (sale.auctionType === "ONLINE") return sale.biddingStatus === "IP" ? "live_bid" : "online_not_open";
  return "catalog";
}

/** One lot's bidding state as Bonhams' bidding platform reports it (POST live.bonhams.com/widget/lots/<sale AM id>). */
export interface BonhamsBidState {
  am_lot_id: string;
  status: string | null; // active | sold | reserve_not_met | withdrawn ...
  sale_type: string | null; // timed (online) | live (in the room)
  current_bid: number | null; // the leading bid; null when no bid is placed
  bid_at: string | null; // when the leading bid was placed
  opening_bid: number | null; // the starting price a first bid must meet
  bid_count: number | null;
  ends: string | null; // the lot's own close, moved later by every extension
  currency: string | null;
  image: string | null;
}

/** The lots of a widget/lots answer. Bidder registrations (paddles) in the answer are never read. */
export function parseBonhamsBidStates(body: unknown): BonhamsBidState[] {
  const page = (body as { result_page?: unknown })?.result_page;
  if (!Array.isArray(page)) return [];
  const out: BonhamsBidState[] = [];
  for (const raw of page) {
    // deno-lint-ignore no-explicit-any
    const r = raw as any;
    if (!r || typeof r.row_id !== "string") continue;
    const bid = r.timed_auction_bid && typeof r.timed_auction_bid === "object" ? r.timed_auction_bid : null;
    const count = Number(r.live_bid_timed_count);
    out.push({
      am_lot_id: r.row_id,
      status: typeof r.status === "string" ? r.status : null,
      sale_type: typeof r.auction?.auction_type === "string" ? r.auction.auction_type : null,
      current_bid: positive(bid?.amount),
      bid_at: typeof bid?.created_at === "string" ? bid.created_at : null,
      opening_bid: positive(r.starting_price),
      bid_count: r.live_bid_timed_count === null || r.live_bid_timed_count === undefined || !Number.isFinite(count) ? null : count,
      ends: typeof r.extended_end_time === "string" ? r.extended_end_time : null,
      currency: typeof r.auction?.currency_code === "string" ? r.auction.currency_code : null,
      image: typeof r.cover_thumbnail === "string" && r.cover_thumbnail ? r.cover_thumbnail : null,
    });
  }
  return out;
}

/**
 * Where a lot stands for the live board: 'live' only in a live-bid sale whose bidding platform reports the lot open
 * (timed, active, closing in the future); 'closed' when that lot has ended there; every other lot (in-room catalog,
 * online not yet open, or no state from the platform) is 'upcoming' and never a live bid.
 */
export function bonhamsLotPhase(kind: BonhamsSaleKind, bid: BonhamsBidState | undefined, nowMs: number): "live" | "closed" | "upcoming" {
  if (kind !== "live_bid" || !bid || bid.sale_type !== "timed") return "upcoming";
  const ends = bid.ends ? Date.parse(bid.ends) : NaN;
  if (bid.status !== "active" || (Number.isFinite(ends) && ends <= nowMs)) return "closed";
  return Number.isFinite(ends) ? "live" : "upcoming";
}

// ── Broad Arrow: timed sales on its bidding site (bid.broadarrowauctions.com, an AuctionMobility site) ──────────────

export const BROAD_ARROW_BID = "https://bid.broadarrowauctions.com";

/** A sale as the bidding site lists it (an AuctionMobility auction summary). */
export interface AmSale {
  row_id: string;
  title?: string | null;
  auction_type?: string | null; // "timed" (online, lots close one by one), "live" (in the room), "timed_then_live", "catalog_only"
  time_start?: string | null;
  effective_end_time?: string | null;
  extend_by_auction?: boolean | null;
  extended_end_time?: string | null;
  currency_code?: string | null;
}

/** A lot as the bidding site's lot list returns it (fieldsets timed-auction, reserve-status and summary). */
export interface AmLotDoc {
  row_id: string;
  lot_number?: number | string | null;
  status?: string | null; // "active" until the lot closes; then "sold", "reserve_not_met", "expired" or "withdrawn"
  title?: string | null;
  estimate_low?: string | number | null;
  estimate_high?: string | number | null;
  starting_price?: string | number | null;
  currency_code?: string | null;
  cover_thumbnail?: string | null;
  extended_end_time?: string | null; // the lot's close, pushed back by a late bid
  timed_auction_bid?: { amount?: string | number | null; created_at?: string | null } | null; // the lot's top bid
  reserve_met?: boolean | null;
  _detail_url?: string | null;
}

/** The sales the bidding site's page lists. The page server-renders its state as one line, `viewVars = {...};`. */
export function amSales(html: string): AmSale[] {
  const m = html.match(/\bviewVars = (\{.*\});[ \t]*\r?$/m);
  if (!m) return [];
  try {
    const rows = JSON.parse(m[1])?.auctions?.result_page;
    return Array.isArray(rows) ? rows.filter((r: AmSale) => r && typeof r.row_id === "string") : [];
  } catch {
    return [];
  }
}

const amEnd = (sale: AmSale) => (sale.extend_by_auction ? sale.extended_end_time : null) ?? sale.effective_end_time ?? null;

// The house's online sales also sell memorabilia and art, whose titles can lead with a year ("1992 Original Lotus 107C
// Rear Wing Element"); a vehicle lot leads with its model year and sits in a sale that is not one of those.
const NOT_VEHICLE_SALE = /memorabilia|artwork|automobilia|petroliana/i;

/**
 * The timed sales whose bidding is open at `now` and that sell vehicles: started, and not closed more than six hours ago
 * (the list can be an hour old, and a late bid moves a lot's close past the sale's stated end). Live sales are bid in
 * the room only; memorabilia and art sales are not read at all.
 */
export function amOpenTimedSales(sales: AmSale[], now: number): AmSale[] {
  return sales.filter((s) => {
    if (s.auction_type !== "timed" || !s.time_start || !(Date.parse(s.time_start) <= now)) return false;
    if (NOT_VEHICLE_SALE.test(s.title ?? "")) return false;
    const end = amEnd(s);
    return !end || Date.parse(end) + 6 * 3_600_000 > now;
  });
}

export function amIsVehicleLot(title: string, saleTitle: string): boolean {
  const y = title.match(/^(18[89]\d|19\d\d|20\d\d)\s+\S/);
  return !!y && Number(y[1]) <= new Date().getUTCFullYear() + 1 && !NOT_VEHICLE_SALE.test(saleTitle);
}

const amAmount = (v: unknown): number | null => {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) && n > 0 ? n : null;
};

/** A timed public auction of ISSIMI's listings (the initialAuctions its /listings page server-renders in __NEXT_DATA__). */
export interface IssimiAuction {
  id: number;
  url: string;
  title: string;
  year: number | null;
  make: string | null;
  model: string | null;
  current_bid: number | null; // the top bid, in the lot's own currency
  currency: string | null;
  starts: string;
  ends: string;
  no_reserve: boolean;
  image: string | null;
  open: boolean; // bidding window open at nowMs and the lot not ended
}

/**
 * ISSIMI's timed public auctions (auctionType PublicAuction with a bidding window): an offer listing ("Listed" with no
 * window) and a private sale are not auctions and are left out. ends is the close the house records, moved by its soft
 * close (the last 2026 sale took a bid at 15:44:18 and closed 15:46:18). The lot page is /vehicles/<slug>.
 */
export function parseIssimiAuctions(pageProps: Record<string, unknown>, nowMs: number): IssimiAuction[] {
  // deno-lint-ignore no-explicit-any
  const all = (Array.isArray(pageProps?.initialAuctions) ? pageProps.initialAuctions : []) as any[];
  const out: IssimiAuction[] = [];
  for (const a of all) {
    if (a?.auctionType !== "PublicAuction" || !a.slug || !a.auctionStartDateTime || !a.auctionEndDateTime) continue;
    const starts = Date.parse(a.auctionStartDateTime), ends = Date.parse(a.auctionEndDateTime);
    if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts) continue;
    const bid = Number(a.topBid?.bidAmount);
    const v = a.vehicle ?? {};
    out.push({
      id: a.id,
      url: `https://www.issimi.com/vehicles/${a.slug}`,
      title: v.carDisplayName ?? [v.year, v.make, v.model].filter(Boolean).join(" "),
      year: typeof v.year === "number" ? v.year : null,
      make: v.make ?? null,
      model: v.model ?? null,
      current_bid: Number.isFinite(bid) && bid > 0 ? bid : null,
      currency: a.currency ?? null,
      starts: new Date(starts).toISOString(),
      ends: new Date(ends).toISOString(),
      no_reserve: Number(a.reservePrice) === 0,
      image: a.heroImageUrl ?? v.images?.find?.((i: { isFeatured?: boolean }) => i.isFeatured)?.url ?? v.images?.[0]?.url ?? null,
      open: a.status !== "Ended" && starts <= nowMs && nowMs < ends,
    });
  }
  return out;
}

/** A Broad Arrow timed lot as a board row. */
export interface AmTimedLot {
  external_id: string;
  url: string;
  title: string;
  lot_number: string | null;
  status: string | null;
  open: boolean;
  vehicle: boolean;
  current_bid: number | null;
  bid_at: string | null;
  opening_bid: number | null;
  currency: string | null;
  ends: string | null;
  estimate_low: number | null;
  estimate_high: number | null;
  reserve_met: boolean | null;
  image_url: string | null;
}

/**
 * A lot of a timed sale. It is open while the lot is active, its sale has started and its close is ahead; the close
 * is the lot's extended end (a late bid pushes it back). The current bid is the lot's top timed bid, in the lot's
 * currency; the list states no bid count, and no reserve flag beyond reserve_met.
 */
export function amTimedLot(doc: AmLotDoc, sale: AmSale, now: number): AmTimedLot {
  const ends = doc.extended_end_time ?? amEnd(sale);
  const endT = ends ? Date.parse(ends) : NaN;
  const title = (doc.title ?? "").trim();
  const path = doc._detail_url && doc._detail_url.startsWith("/lots/view/") ? doc._detail_url : `/lots/view/${doc.row_id}`;
  return {
    external_id: doc.row_id,
    url: `${BROAD_ARROW_BID}${path}`,
    title,
    lot_number: doc.lot_number != null ? String(doc.lot_number) : null,
    status: doc.status ?? null,
    open: sale.auction_type === "timed" && doc.status === "active" && !!sale.time_start && Date.parse(sale.time_start) <= now &&
      Number.isFinite(endT) && endT > now,
    vehicle: amIsVehicleLot(title, sale.title ?? ""),
    current_bid: amAmount(doc.timed_auction_bid?.amount),
    bid_at: doc.timed_auction_bid?.created_at ?? null,
    opening_bid: amAmount(doc.starting_price),
    currency: doc.currency_code ?? sale.currency_code ?? null,
    ends,
    estimate_low: amAmount(doc.estimate_low),
    estimate_high: amAmount(doc.estimate_high),
    reserve_met: typeof doc.reserve_met === "boolean" ? doc.reserve_met : null,
    image_url: doc.cover_thumbnail ?? null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Gooding (Gooding Christie's). Bids are taken on its Auction Mobility platform, bid.goodingco.com, whose /ajax/lots/
// endpoint answers the platform's lot documents as JSON: status 'active' is a timed lot open for bidding (the platform's
// own lots controller), timed_auction_bid.amount the standing high bid, extended_end_time the lot's own close with its
// extensions. Broad Arrow and Bonhams bid on the same platform, so a lot is read by amTimedLot and a bid box answer by
// parseBonhamsBidStates; the bid count (live_bid_timed_count) comes only in the widget/lots answer the lot page's bid
// box reads. Identity (slug, year, make, model, item type, reserve, images) is the house catalog's
// (cdn.goodingco.com/graphql getVehicles, the index its /lots page reads), keyed by the platform ids it carries.

/** A lot document of the lot list: the platform's lot, with the sale summary the list embeds in each lot. */
export interface GoodingAmLot extends AmLotDoc {
  hide_estimate?: boolean | null;
  truncated_description?: string | null;
  sold_price?: string | null;
  state_sequence_number?: number | null;
  auction?: (AmSale & { active_lot_count?: number | null }) | null;
}

/** One Gooding lot as the platform states it now. phase 'open' = a timed lot taking bids at this moment. */
export interface GoodingLot {
  am_lot_id: string;
  am_auction_id: string | null;
  sale: string | null;
  auction_type: string | null;
  auction_active_lots: number | null;
  lot_number: number | null;
  title: string;
  status: string;
  phase: "open" | "upcoming" | "closed" | "other";
  current_bid: number | null;
  bid_at: string | null;
  bid_count: number | null; // from the widget/lots answer only; the lot list does not carry it
  opening_bid: number | null;
  sold_price: number | null;
  reserve_met: boolean | null;
  without_reserve: boolean;
  starts: string | null;
  ends: string | null;
  estimate_low: number | null;
  estimate_high: number | null;
  currency: string | null;
  image: string | null;
  bid_url: string | null;
  state_sequence: number | null;
}

const CLOSED_STATUSES = new Set(["sold", "reserve_not_met", "expired", "withdrawn", "passed", "unsold", "pre_sold", "post_sold", "subject_to"]);

/** 'open' = an active lot of a sale that has started, closing after `now` (timed and timed_then_live sales alike). */
function goodingPhase(status: string, starts: string | null, ends: string | null, now: number): GoodingLot["phase"] {
  if (status !== "active") return CLOSED_STATUSES.has(status) ? "closed" : "other";
  if (!(Date.parse(starts ?? "") <= now)) return "upcoming";
  return ends !== null && Date.parse(ends) <= now ? "closed" : "open";
}

/** One platform lot document as a GoodingLot, its phase judged at `now` (ms). */
export function goodingLot(lot: GoodingAmLot, now: number): GoodingLot {
  const sale: AmSale = lot.auction ?? { row_id: "" };
  const t = amTimedLot(lot, sale, now); // the platform's timed-lot reading, shared with Broad Arrow (its url is Broad Arrow's)
  const status = t.status ?? "";
  const n = Number(lot.lot_number);
  return {
    am_lot_id: lot.row_id,
    am_auction_id: lot.auction?.row_id ?? null,
    sale: sale.title ?? null,
    auction_type: sale.auction_type ?? null,
    auction_active_lots: lot.auction?.active_lot_count ?? null,
    lot_number: lot.lot_number != null && Number.isFinite(n) ? n : null,
    title: t.title,
    status,
    phase: goodingPhase(status, sale.time_start ?? null, t.ends, now),
    current_bid: t.current_bid,
    bid_at: t.current_bid !== null ? t.bid_at : null,
    bid_count: null, // only the bid box answer carries it (goodingWithBidState)
    opening_bid: t.opening_bid,
    sold_price: positive(lot.sold_price),
    reserve_met: t.reserve_met,
    without_reserve: /without reserve/i.test(lot.truncated_description ?? ""),
    starts: sale.time_start ?? null,
    ends: t.ends,
    estimate_low: lot.hide_estimate ? null : t.estimate_low,
    estimate_high: lot.hide_estimate ? null : t.estimate_high,
    currency: t.currency,
    image: t.image_url,
    bid_url: lot._detail_url ? `https://bid.goodingco.com${lot._detail_url}` : null,
    state_sequence: lot.state_sequence_number ?? null,
  };
}

/**
 * A lot with the state its lot page's bid box shows (the platform's widget/lots answer, parsed by parseBonhamsBidStates):
 * the leading bid, the bid count and the close each extension moves. Without a state the lot stays as listed.
 */
export function goodingWithBidState(lot: GoodingLot, s: BonhamsBidState | undefined, now: number): GoodingLot {
  if (!s) return lot;
  const status = s.status ?? lot.status;
  const ends = s.ends ?? lot.ends;
  // the widget's bid carries no time (created_at null, 2026-10-20): keep the lot list's time while the bid is the same
  const bid_at = s.current_bid === null ? null : s.bid_at ?? (s.current_bid === lot.current_bid ? lot.bid_at : null);
  return { ...lot, status, ends, phase: goodingPhase(status, lot.starts, ends, now), current_bid: s.current_bid, bid_at, bid_count: s.bid_count };
}

/** One /ajax/lots/ page: its lots, the platform's total, and the next page's offset (null on the last page). */
export function parseGoodingLots(json: unknown, now: number): { lots: GoodingLot[]; total: number | null; next: number | null } {
  const doc = (json ?? {}) as { result_page?: GoodingAmLot[]; query_info?: { next_page?: string | null; page_start_offset?: number; total_num_results?: number } };
  if (!Array.isArray(doc.result_page)) throw new Error("Gooding lots: no result_page in the platform's answer");
  const lots = doc.result_page.filter((l) => l && typeof l.row_id === "string").map((l) => goodingLot(l, now));
  const qi = doc.query_info ?? {};
  return {
    lots,
    total: qi.total_num_results ?? null,
    next: qi.next_page && doc.result_page.length > 0 ? (qi.page_start_offset ?? 0) + doc.result_page.length : null,
  };
}

/** The fields of a Gooding catalog lot (cdn.goodingco.com/graphql getVehicles) the board reads. */
export interface GoodingCatalogLot {
  slug: string;
  title?: string | null;
  itemType?: string | null;
  make?: string | null;
  model?: string | null;
  modelYear?: number | null;
  lotNumber?: number | null;
  hasReservePrice?: boolean | null;
  lotAuctionMobilityId?: string | null;
  auctionAuctionMobilityId?: string | null;
  upcomingAuctionEndDate?: string | null;
  cloudinaryImages?: { public_id: string }[] | null;
}

/** The catalog lot for a platform lot: by the platform lot id it carries, else by its sale id and lot number. */
export function goodingCatalogFor(lot: GoodingLot, catalog: GoodingCatalogLot[]): GoodingCatalogLot | null {
  return catalog.find((c) => c.lotAuctionMobilityId && c.lotAuctionMobilityId === lot.am_lot_id)
    ?? catalog.find((c) => c.auctionAuctionMobilityId && c.auctionAuctionMobilityId === lot.am_auction_id
      && (lot.lot_number ?? 0) > 0 && c.lotNumber === lot.lot_number)
    ?? null;
}

/** The URL spelling vehicles hold for a Gooding lot (canonicalize_vehicle_url: no www, no trailing slash). */
export const goodingLotUrl = (slug: string) => `https://goodingco.com/lot/${slug}`;

/** Every spelling a vehicle may hold for that lot: both hosts, with and without a trailing slash. */
export function goodingUrlVariants(url: string): string[] {
  const slug = url.match(/^https?:\/\/(?:www\.)?goodingco\.com\/lot\/([^/?#]+)/i)?.[1];
  if (!slug) return [url];
  return ["https://goodingco.com", "https://www.goodingco.com"].flatMap((h) => [`${h}/lot/${slug}`, `${h}/lot/${slug}/`]);
}

/** A catalog image as the house serves it, in the spelling extract-gooding writes (its buildCloudinaryUrl). */
export const goodingImageUrl = (publicId: string) =>
  `https://media.goodingco.com/image/upload/c_fill,g_auto,q_90,w_1800/v1/${publicId.split("/").map(encodeURIComponent).join("/")}`;

/**
 * A platform lot as a board row, with its catalog identity when matched: the catalog lot page (where the house shows
 * the live bid) in the spelling vehicles hold, else the platform's lot page. vehicle = the catalog says Cars or
 * Motorcycles, or (unmatched) the title opens with a year.
 */
export function goodingBoardLot(lot: GoodingLot, cat: GoodingCatalogLot | null) {
  const img = cat?.cloudinaryImages?.[0]?.public_id;
  return {
    url: cat ? goodingLotUrl(cat.slug) : lot.bid_url,
    title: cat?.title?.trim() || lot.title,
    year: cat?.modelYear ?? null,
    make: cat?.make?.trim() || null, // the catalog writes some makes with a trailing space ("Ducati ")
    model: cat?.model?.trim() || null,
    image: img ? goodingImageUrl(img) : lot.image,
    no_reserve: cat?.hasReservePrice === false || lot.without_reserve,
    item_type: cat?.itemType ?? null,
    vehicle: cat ? ["Cars", "Motorcycles"].includes(cat.itemType ?? "") : /^(1[89]|20)\d{2}\s/.test(lot.title),
  };
}

/** A vehicles row that may hold a Gooding lot, by either URL column. */
export interface GoodingVehicleRow { id: string; listing_url: string | null; discovery_url: string | null }

/**
 * How a board lot reaches the vehicle that already holds it, so the live upsert (keyed on listing_url) updates that
 * vehicle instead of minting a second one: 'held' = a vehicle's listing_url is a spelling of the lot (write under
 * that spelling); 'claim' = a vehicle holds the lot only as discovery_url, listing_url empty (fill it, then write);
 * 'new' = no vehicle holds it (write, then fill discovery_url so extract-gooding finds the same row); 'other' = the
 * vehicle holding it as discovery_url lists elsewhere now (a later BaT or Mecum sale): the Gooding lot gets its own row.
 */
export function goodingLinkPlan(url: string, rows: GoodingVehicleRow[]): { url: string; link: "held" | "claim" | "new" | "other"; vehicle_id: string | null } {
  const spellings = new Set(goodingUrlVariants(url));
  const held = rows.find((r) => r.listing_url && spellings.has(r.listing_url));
  if (held) return { url: held.listing_url!, link: "held", vehicle_id: held.id };
  const byDiscovery = rows.filter((r) => r.discovery_url && spellings.has(r.discovery_url));
  const claim = byDiscovery.find((r) => !r.listing_url);
  if (claim) return { url, link: "claim", vehicle_id: claim.id };
  return byDiscovery.length ? { url, link: "other", vehicle_id: null } : { url, link: "new", vehicle_id: null };
}
