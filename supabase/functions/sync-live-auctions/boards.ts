/**
 * Pure readers for the board-synced houses (no I/O): PCarMarket's server-rendered auction board and lot bid history,
 * and Bonhams' Typesense lot documents. sync-live-auctions fetches; these parse.
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
  title?: string;
  slug?: string;
  status?: string;
  hammerTime?: { datetime?: string };
  auctionEndDate?: { datetime?: string };
  currency?: { iso_code?: string };
  price?: Record<string, unknown>;
  flags?: { isAuctionEnded?: boolean };
}

/** A Bonhams lot as a board row: its page url (the spelling vehicles already hold), close time, estimate, currency. */
export function bonhamsLot(doc: BonhamsLotDoc) {
  const sale = doc.auctionId ?? doc.id.split("-")[0];
  const lot = doc.lotId ?? doc.id.split("-")[1];
  const cur = doc.currency?.iso_code ?? null;
  const p = doc.price ?? {};
  const low = cur ? Number(p[`${cur}LowEstimate`]) : NaN;
  const high = cur ? Number(p[`${cur}HighEstimate`]) : NaN;
  const hammer = Number(p.hammerPrice ?? p[`${cur}HammerPrice`]);
  return {
    external_id: doc.id,
    url: `https://www.bonhams.com/auction/${sale}/lot/${lot}/${doc.slug ?? ""}`.replace(/\/$/, ""),
    title: doc.title ?? "",
    ends: doc.hammerTime?.datetime ?? doc.auctionEndDate?.datetime ?? null,
    currency: cur,
    estimate_low: Number.isFinite(low) && low > 0 ? low : null,
    estimate_high: Number.isFinite(high) && high > 0 ? high : null,
    hammer: Number.isFinite(hammer) && hammer > 0 ? hammer : null,
    status: doc.status ?? null,
  };
}
