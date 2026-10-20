/**
 * Pure readers for the board-synced houses (no I/O): PCarMarket's server-rendered auction board and lot bid history,
 * Bonhams' Typesense sale and lot documents and its bidding platform's lot states. sync-live-auctions fetches; these parse.
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
