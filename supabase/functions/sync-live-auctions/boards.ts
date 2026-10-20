/**
 * Pure readers for the board-synced houses (no I/O): PCarMarket's server-rendered auction board and lot bid history,
 * Bonhams' Typesense sale and lot documents and its bidding platform's lot states, Broad Arrow's timed sales on its
 * bidding site, and Mecum's public lot index around a sale's run days. sync-live-auctions fetches; these parse.
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

// ── Mecum: its public lot index (Algolia wp_posts_lot), the index the site's own search reads ──
//
// Mecum sells on the block during a sale's run days; bidding on a car is open on its run day until it crosses the block,
// and the index records each result within minutes of the hammer (Nashville 2026, 24 Sep: rows changed in docket order
// through the day, lot T1 first). Some lots also take online pre-bids before their day (has_prebidding_meta). The live
// bid on the block itself is published only to signed-in bidders (bidnow.mecum.com), so a lot's current bid here is the
// one the index states.

/** A sale on Mecum's calendar: the index facet value "Name|startEpoch|endEpoch" (00:00 UTC of its first and last run dates). */
export interface MecumSale { value: string; name: string; startEpoch: number; endEpoch: number; lots: number }

/**
 * The sales whose run days hold now: from 00:00 UTC of the first run date (a US run day starts at local midnight, 04:00 to
 * 10:00 UTC) to 12:00 UTC of the day after the last (every US run day has closed by then).
 */
export function mecumSalesToRead(facet: Record<string, number>, nowMs: number): MecumSale[] {
  const now = nowMs / 1000;
  return Object.entries(facet ?? {}).flatMap(([value, lots]) => {
    const [name, s, e] = value.split("|");
    const startEpoch = Number(s), endEpoch = Number(e);
    if (!name || !Number.isFinite(startEpoch) || !Number.isFinite(endEpoch)) return [];
    return now >= startEpoch && now < endEpoch + 36 * 3600 ? [{ value, name, startEpoch, endEpoch, lots }] : [];
  });
}

/**
 * The run dates (YYYY-MM-DD) of a sale to read at nowMs, inside the sale's dates: today's UTC date, and yesterday's until
 * 12:00 UTC (its lots stay open until their local midnight and are then read once more as closed).
 */
export function mecumRunDatesToRead(sale: MecumSale, nowMs: number): string[] {
  const first = new Date(sale.startEpoch * 1000).toISOString().slice(0, 10);
  const last = new Date(sale.endEpoch * 1000).toISOString().slice(0, 10);
  const days = new Date(nowMs).getUTCHours() < 12 ? [-1, 0] : [0];
  return days.map((d) => new Date(nowMs + d * 86_400_000).toISOString().slice(0, 10)).filter((d) => d >= first && d <= last);
}

/** The fields of one index record the live reader asks for (attributesToRetrieve). */
export interface MecumIndexHit {
  post_title?: string;
  permalink?: string;
  lot_number_meta?: string | null;
  auction_day_start_meta?: string | null;
  current_bid_meta?: number | null;
  has_prebidding_meta?: boolean | null;
  sold?: number | null;
  bid_goes_on?: number | null;
  highest_bid_or_price?: number | null;
  images_meta?: { url?: string }[] | null;
  taxonomies?: Record<string, { name?: string | number; slug?: string }[] | undefined>;
}

/** open: bidding is open now; crossed: the index states a result; closed: its run day ended with none stated; upcoming. */
export type MecumLotState = "open" | "crossed" | "closed" | "upcoming";

export interface MecumLot {
  url: string;
  lot_id: string;
  title: string;
  lot_number: string | null;
  sale: string | null;
  run_day: string | null;
  opens: string | null; // the run day's start as the index states it (auction_day_start_meta: local midnight, in UTC)
  closes: string | null; // 24 hours later: bidding on the lot cannot outlast its run day
  state: MecumLotState;
  result: "sold" | "bid-goes-on" | null;
  current_bid: number | null; // an open lot's bid as the index states it; null when none
  closing_bid: number | null; // a crossed lot's hammer bid when stated, the standing high bid of a bid-goes-on lot
  price_with_premium: number | null; // a sold lot's highest_bid_or_price: the sale price, buyer's premium included
  prebid: boolean;
  no_reserve: boolean;
  image: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
}

// The lot types Mecum's lander treats as vehicles (extract-mecum INDEX_VEHICLE_TYPES); Road Art is automobilia.
const MECUM_VEHICLE_TYPES = new Set(["Auto", "Motorcycle", "Tractor", "Boat"]);
const term = (h: MecumIndexHit, key: string, field: "name" | "slug" = "name"): string | null => {
  const v = h.taxonomies?.[key]?.[0]?.[field];
  return v === undefined || v === null || v === "" ? null : String(v);
};

/** One index record as a lot with its live state at nowMs; null for a lot that is not a vehicle or has no lot page. */
export function mecumLot(hit: MecumIndexHit, nowMs: number): MecumLot | null {
  const type = term(hit, "lot_type");
  if (!type || !MECUM_VEHICLE_TYPES.has(type)) return null;
  const permalink = typeof hit.permalink === "string" ? hit.permalink : "";
  const lotId = permalink.match(/^\/lots\/([A-Za-z0-9-]+)\//)?.[1];
  if (!lotId) return null;
  const dayStart = typeof hit.auction_day_start_meta === "string" ? Date.parse(`${hit.auction_day_start_meta.replace(" ", "T")}Z`) : NaN;
  const opens = Number.isFinite(dayStart) ? dayStart : null;
  const closes = opens === null ? null : opens + 86_400_000;
  const result = hit.sold === 1 ? "sold" : hit.bid_goes_on === 1 ? "bid-goes-on" : null;
  const prebid = hit.has_prebidding_meta === true;
  const state: MecumLotState = result ? "crossed"
    : closes !== null && nowMs >= closes ? "closed"
    : (opens !== null && nowMs >= opens) || (prebid && (closes === null || nowMs < closes)) ? "open"
    : "upcoming";
  const stated = positive(hit.current_bid_meta);
  const year = Number(term(hit, "lot_year"));
  return {
    url: `https://www.mecum.com${permalink}`,
    lot_id: lotId,
    title: (hit.post_title ?? "").trim() || lotId,
    lot_number: hit.lot_number_meta || null,
    sale: term(hit, "auction_tax")?.split("|")[0] ?? null,
    run_day: term(hit, "run_date"),
    opens: opens === null ? null : new Date(opens).toISOString(),
    closes: closes === null ? null : new Date(closes).toISOString(),
    state,
    result,
    current_bid: state === "open" ? stated : null,
    closing_bid: result ? (stated ?? (result === "bid-goes-on" ? positive(hit.highest_bid_or_price) : null))
      : state === "closed" ? stated : null,
    price_with_premium: result === "sold" ? positive(hit.highest_bid_or_price) : null,
    prebid,
    no_reserve: (hit.taxonomies?.lot_status ?? []).some((s) => s?.slug === "no-reserve"),
    image: hit.images_meta?.find((i) => typeof i?.url === "string" && i.url.startsWith("http"))?.url ?? null,
    year: Number.isInteger(year) && year >= 1885 && year <= 2100 ? year : null,
    make: term(hit, "make"),
    model: term(hit, "model"),
  };
}
