/**
 * Pure readers for the board-synced houses (no I/O): PCarMarket's server-rendered auction board and lot bid history,
 * Bonhams' Typesense sale and lot documents and its bidding platform's lot states, and Broad Arrow's timed sales on
 * its bidding site. sync-live-auctions fetches; these parse.
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

// ── Ultimate WooCommerce Auction houses ─────────────────────────────────────────────────────────────────────────
// AllCollectorCars' ACC Auctions and Iconic Motorbike Auctions run the same WordPress plugin ("Ultimate WooCommerce
// Auction"), which server-renders every open lot as a product card: lot id, link, title, image, current or starting
// bid, its close (moved by soft-close extensions) in the house's time zone, and the product's categories and tags.
// A lot page adds the bid history and the reserve state. One parser serves both; a house differs only in its config.

/** A house running Ultimate WooCommerce Auction: where its open lots are listed and how its vehicles are told apart. */
export interface UwaHouse {
  slug: string;              // vehicles.platform_source, and the live_board_houses / live_auction_sources slug
  label: string;
  listUrl: string;           // the server-rendered page listing every open lot
  lotUrl: RegExp;            // a lot page of this house: the only links the reader follows
  currency: string;          // the house's currency, for prices shown with its symbol
  symbol: string;
  nonVehicle: RegExp;        // a product category or tag of items that are not vehicles
  vehicleCategory?: string;  // when set, a vehicle carries this category and one more of its own (its make)
  detailReads: number;       // lot pages read per run, for lots that are new or whose bid moved (bid count, reserve)
}

export const UWA_HOUSES: Record<string, UwaHouse> = {
  allcollectorcars: {
    slug: "allcollectorcars",
    label: "AllCollectorCars ACC Auctions",
    listUrl: "https://www.allcollectorcars.com/classic-car-auctions/auctions/",
    lotUrl: /^https:\/\/www\.allcollectorcars\.com\/classic-car-auctions\/vehicles\/[a-z0-9-]+\/?$/,
    currency: "USD",
    symbol: "$",
    nonVehicle: /^automobilia$/, // kiddie rides, signs, traffic lights
    detailReads: 6, // a lot page answers in under a second
  },
  "iconic-motorbike-auctions": {
    slug: "iconic-motorbike-auctions",
    label: "Iconic Motorbike Auctions",
    listUrl: "https://iconicmotorbikeauctions.com/", // the homepage is the house's "Current auctions" list
    lotUrl: /^https:\/\/iconicmotorbikeauctions\.com\/auction\/[a-z0-9-]+\/?$/,
    currency: "USD",
    symbol: "$",
    nonVehicle: /memorabilia/, // leathers and the like; a signed helmet carries only "motorbikes", a watch not even that
    vehicleCategory: "motorbikes",
    detailReads: 2, // a lot page takes 6-12 s to answer
  },
};

/** One product card on a UWA house's list page. */
export interface UwaCard {
  auction_id: string;
  href: string;                    // the lot page as the list links it
  url: string;                     // the same without its trailing slash (the listing_url spelling)
  title: string;
  subtitle: string | null;
  image: string | null;
  status: string | null;           // the card's uwa_auction_status_*: live, future, expired, ...
  current_bid: number | null;      // a bid placed; null while the card shows a starting bid or "Bidding Open"
  starting_bid: number | null;
  symbol: string | null;
  ends_local: string | null;       // the close as the house states it, in its zone
  zone: string | null;
  ends: string | null;             // the same close in UTC (ISO 8601)
  reserve_met: boolean | null;     // only when the card states it
  no_reserve: boolean;
  categories: string[];            // product_cat-* and product_tag-* slugs
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", hellip: "…", times: "×",
};

/** Text of an HTML fragment: tags dropped, entities decoded, whitespace collapsed. */
export function htmlText(s: string): string {
  return s.replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
        : NAMED_ENTITIES[e.toLowerCase()] ?? all)
    .replace(/\s+/g, " ").trim();
}

/** A wall-clock time in an IANA zone ("2026-10-27 14:00:00", "America/New_York") as UTC ISO 8601, DST included. */
export function zonedTimeToIso(local: string, zone: string): string | null {
  const m = local.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return null;
  }
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  const offset = (t: number) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - t;
  };
  let t = wall - offset(wall);
  const again = wall - offset(t); // the offset at the instant itself, for a wall time near a DST change
  if (again !== t) t = again;
  return new Date(t).toISOString();
}

const attr = (tag: string, name: string): string | null => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;
const money = (s: string | null | undefined): number | null => {
  const n = s ? Number(s.replace(/,/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
/** The attributes of the countdown that belongs to this lot id (a page can carry other lots' countdowns). */
const uwaClock = (html: string, auctionId: string): string | null =>
  [...html.matchAll(/<div class="[^"]*\buwa_auction_product_countdown\b[^"]*"([^>]*)>/g)]
    .map((c) => c[1]).find((a) => attr(a, "data-auction-id") === auctionId) ?? null;

/** Every product card on a UWA list page, once per lot id. */
export function parseUwaBoard(html: string): UwaCard[] {
  const out: UwaCard[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<li class="([^"]*\bproduct-type-auction\b[^"]*)">([\s\S]*?)<\/li>/g)) {
    const cls = m[1];
    const body = m[2];
    const price = body.match(/<span class="woo-ua-auction-price ([a-z-]+)"([^>]*)>([\s\S]*?)<\/span>\s*<\/span>/);
    const id = (price ? attr(price[2], "data-auction-id") : null) ?? body.match(/data-auction-id="(\d+)"/)?.[1] ?? null;
    const href = body.match(/<a href="([^"]+)"[^>]*class="woocommerce-LoopProduct-link/)?.[1] ?? null;
    if (!id || !href || seen.has(id)) continue;
    seen.add(id);
    const amount = price?.[3].match(/woocommerce-Price-currencySymbol"[^>]*>([^<]*)<\/span>\s*(\d[\d,]*(?:\.\d+)?)/);
    const isCurrent = price?.[1] === "current-bid";
    const clock = uwaClock(body, id);
    const endsLocal = clock ? attr(clock, "data-time") : null;
    const zone = clock ? attr(clock, "data-zone") : null;
    const title = htmlText(body.match(/class="woocommerce-loop-product__title">([\s\S]*?)<\/h2>/)?.[1] ?? "");
    const subtitle = htmlText(body.match(/<\/h2>\s*<h3>([\s\S]*?)<\/h3>/)?.[1] ?? "") || null;
    const reserve = htmlText(body.match(/class="front-reserve">([\s\S]*?)<\/span>/)?.[1] ?? "");
    out.push({
      auction_id: id,
      href,
      url: href.replace(/\/+$/, ""),
      title,
      subtitle,
      image: body.match(/<img[^>]*\bsrc="([^"]+)"/)?.[1] ?? null,
      status: cls.match(/\buwa_auction_status_([a-z_]+)/)?.[1] ?? null,
      current_bid: price && isCurrent ? money(attr(price[2], "data-bid")) ?? money(amount?.[2]) : null,
      starting_bid: price && !isCurrent ? money(amount?.[2]) : null,
      symbol: amount ? htmlText(amount[1]) : null,
      ends_local: endsLocal,
      zone,
      ends: endsLocal && zone ? zonedTimeToIso(endsLocal, zone) : null,
      reserve_met: /not met/i.test(reserve) ? false : /\bmet\b/i.test(reserve) ? true : null,
      no_reserve: /\bno reserve\b/i.test(`${title} ${subtitle ?? ""}`),
      categories: [...cls.matchAll(/\bproduct_(?:cat|tag)-([a-z0-9-]+)/g)].map((c) => c[1]),
    });
  }
  return out;
}

const NO_RESERVE_PREFIX = /^\s*no reserve\s*[–—-]\s*/i;

/** The title an identity is read from: the house's "No Reserve – " prefix removed. */
export function uwaIdentityTitle(title: string): string {
  return title.replace(NO_RESERVE_PREFIX, "").trim();
}

/** A vehicle, not memorabilia or a fairground ride: a year-first title and no non-vehicle category. */
export function isUwaVehicle(card: UwaCard, house: UwaHouse): boolean {
  if (!/^(18[89]\d|19\d{2}|20\d{2})\s/.test(uwaIdentityTitle(card.title))) return false;
  if (card.categories.some((c) => house.nonVehicle.test(c))) return false;
  if (!house.vehicleCategory) return true;
  return card.categories.includes(house.vehicleCategory) &&
    card.categories.some((c) => c !== house.vehicleCategory && !house.nonVehicle.test(c));
}

/** The open vehicle lots of one list read: live cards linking to this house's lot pages, closing after now. */
export function uwaOpenLots(cards: UwaCard[], house: UwaHouse, nowMs: number): UwaCard[] {
  return cards.filter((c) =>
    c.status === "live" && c.ends !== null && Date.parse(c.ends) > nowMs && house.lotUrl.test(c.href) && isUwaVehicle(c, house)
  );
}

/** The currency of a card's price: the house's when shown with its symbol (or with no price yet), else unknown. */
export function uwaCurrency(card: UwaCard, house: UwaHouse): string | null {
  return card.symbol === null || card.symbol === house.symbol ? house.currency : null;
}

/**
 * The make as the title spells it, when one of the lot's category or tag slugs names the words right after the year
 * ("mercedes-benz" in "1992 Mercedes-Benz 190E"; the shortest such slug, so "zimmer" wins over "zimmer-golden-spirit").
 * Null when none does; the first word after the year is then the make.
 */
export function uwaKnownMake(title: string, categories: string[]): string | null {
  const rest = title.match(/\b(?:18[89]\d|19\d{2}|20\d{2})\s+(.+)$/)?.[1];
  if (!rest) return null;
  let best: string | null = null;
  for (const slug of categories) {
    if (!/[a-z]/.test(slug)) continue;
    const words = slug.split("-").filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const hit = rest.match(new RegExp(`^${words.join("[\\s-]+")}(?=$|[\\s,])`, "i"));
    if (hit && (best === null || hit[0].length < best.length)) best = hit[0];
  }
  return best;
}

/** What a UWA lot page adds to its card: the bid count (rows of its bid history), the reserve state and the close. */
export interface UwaLotRead {
  bid_count: number | null;
  reserve_met: boolean | null;
  ends_local: string | null;
  zone: string | null;
  ends: string | null;
}

export function parseUwaLot(html: string, auctionId: string): UwaLotRead {
  const table = html.match(new RegExp(`<table id="auction-history-table-${auctionId}"[\\s\\S]*?</table>`))?.[0] ?? null;
  const rows = table ? [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].filter((r) => /class="bid_price/.test(r[1])).length : null;
  const reserve = html.match(/<p class="uwa_auction_reserve_(met|not_met)">/)?.[1] ?? null;
  const clock = uwaClock(html, auctionId);
  const endsLocal = clock ? attr(clock, "data-time") : null;
  const zone = clock ? attr(clock, "data-zone") : null;
  return {
    bid_count: rows,
    reserve_met: reserve === "met" ? true : reserve === "not_met" ? false : null,
    ends_local: endsLocal,
    zone,
    ends: endsLocal && zone ? zonedTimeToIso(endsLocal, zone) : null,
  };
}
