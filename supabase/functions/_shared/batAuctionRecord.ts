/**
 * _shared/batAuctionRecord.ts — the lot page's own auction record, read from the embedded
 * comments JSON. This is the price authority for a BaT lot.
 *
 * BaT writes the outcome of every auction into the comment stream as system comments:
 *   type "bat-bid-reserve"   "Sold on 1/28/23 for $17,000 to Matsu71"        (author = buyer)
 *                            "Reserve not met on 4/11/25 at USD $23,000"     (author = Anonymous)
 *   type "bat-rnm-accepted"  "Sold on 04/11/2025 for $24,000 to nocera76"    — reserve not met,
 *                            seller accepted a post-auction offer; the listings-filter catalog
 *                            keeps the HIGH BID ($23,000) for these lots, the record has the
 *                            price paid ($24,000). Measured 2026-09-26: 2,554 of 256,087 lots.
 *   type "bat-bid"           "$16,750 bid placed by hellyan999"              (bidAmount > 0)
 *   type "bat-bid-canceled"  bids BaT voided; never count them as bids or as the high bid.
 *
 * The array is read with a bracket-matching reader because each comment now carries nested
 * channels/likers/images arrays — a lazy regex stops at the first inner "]" and silently
 * returns nothing on current pages (.claude/ISSUES.md 2026-09-24, scripts/bat-lots-local.ts).
 *
 * Nothing here stores comment text. Counts and the sale record only.
 */

export interface BatAuctionRecord {
  /** a sale record exists on the page ("Sold on … for $X to buyer") */
  sold: boolean;
  /** the sale came from a "bat-rnm-accepted" record: reserve not met, seller accepted afterwards */
  soldAfterReserveNotMet: boolean;
  /** price paid, from the sale record; null unless sold */
  saleAmount: number | null;
  /** buyer username (the sale record's author); null unless sold */
  buyer: string | null;
  /** ISO time of the sale record (or the reserve-not-met record) */
  recordAt: string | null;
  /** a "Reserve not met on …" record exists (the auction closed without a sale) */
  reserveNotMet: boolean;
  /** amount in the reserve-not-met record, i.e. the closing high bid */
  reserveNotMetAmount: number | null;
  /** highest live bid (type bat-bid); canceled bids excluded */
  highBid: number | null;
  /** number of live bids */
  bidCount: number;
  /** distinct live bidders */
  uniqueBidders: number;
  /** all comments on the page, incl. system records (≈ BaT's own comment counter) */
  commentCount: number;
  /** any bat-bid-canceled records present (BaT voided bids on this lot) */
  hadCanceledBids: boolean;
  /** the comments JSON was found and parsed */
  parsed: boolean;
}

const EMPTY: BatAuctionRecord = {
  sold: false, soldAfterReserveNotMet: false, saleAmount: null, buyer: null, recordAt: null,
  reserveNotMet: false, reserveNotMetAmount: null, highBid: null, bidCount: 0, uniqueBidders: 0,
  commentCount: 0, hadCanceledBids: false, parsed: false,
};

/** Returns the array that follows `"comments":` by matching brackets, respecting strings. */
export function readCommentsJson(html: string): any[] | null {
  const key = '"comments":[';
  let at = html.indexOf(key);
  while (at >= 0) {
    const start = at + key.length - 1;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < html.length; i++) {
      const ch = html[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "[") depth++;
      else if (ch === "]" && --depth === 0) {
        try {
          const arr = JSON.parse(html.slice(start, i + 1));
          if (Array.isArray(arr) && arr.length && typeof arr[0] === "object") return arr;
        } catch { /* try the next occurrence */ }
        break;
      }
    }
    at = html.indexOf(key, at + key.length);
  }
  return null;
}

const stripTags = (s: unknown) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function moneyIn(text: string): number | null {
  const m = text.match(/\$\s*([0-9][0-9,]*)/);
  if (!m) return null;
  const n = parseInt(m[1].replace(/,/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isoOf(ts: unknown): string | null {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

/** Summarize the auction from the page's embedded comments. Pass the HTML or an already-parsed array. */
export function summarizeAuction(input: string | any[] | null): BatAuctionRecord {
  const comments = typeof input === "string" ? readCommentsJson(input) : input;
  if (!comments) return { ...EMPTY };

  const out: BatAuctionRecord = { ...EMPTY, parsed: true, commentCount: comments.length };
  const bidders = new Set<string>();

  for (const c of comments) {
    const type = String(c?.type ?? "");
    const text = stripTags(c?.content ?? c?.comment ?? "");

    if (type === "bat-bid") {
      const amt = Number(c?.bidAmount) || moneyIn(text) || 0;
      if (amt > 0) {
        out.bidCount++;
        bidders.add(String(c?.authorName ?? "").trim().toLowerCase());
        if (out.highBid === null || amt > out.highBid) out.highBid = amt;
      }
      continue;
    }
    if (type === "bat-bid-canceled") {
      out.hadCanceledBids = true;
      continue;
    }
    if (type === "bat-rnm-accepted" || (type === "bat-bid-reserve" && /^sold\b/i.test(text))) {
      out.sold = true;
      out.soldAfterReserveNotMet = out.soldAfterReserveNotMet || type === "bat-rnm-accepted";
      out.saleAmount = moneyIn(text) ?? out.saleAmount;
      const to = text.match(/\bto\s+(\S+)\s*$/);
      const author = String(c?.authorName ?? "").replace(/\s*\(The Seller\)\s*$/i, "").trim();
      out.buyer = (author && author.toLowerCase() !== "anonymous" ? author : null) ?? (to?.[1] ?? null);
      out.recordAt = isoOf(c?.timestamp) ?? out.recordAt;
      continue;
    }
    if (type === "bat-bid-reserve" && /reserve not met/i.test(text)) {
      out.reserveNotMet = true;
      out.reserveNotMetAmount = moneyIn(text);
      if (!out.sold) out.recordAt = isoOf(c?.timestamp) ?? out.recordAt;
      continue;
    }
  }

  out.uniqueBidders = bidders.size;
  if (!out.sold) {
    out.saleAmount = null;
    out.buyer = null;
  }
  return out;
}

/** ISO 3779 check digit for a 17-character VIN (pre-1981 VINs have none and are not judged here). */
export function vinCheckDigitOk(vin: string | null | undefined): boolean | null {
  const v = String(vin ?? "").trim().toUpperCase();
  if (v.length !== 17) return null;
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) return false;
  const values: Record<string, number> = {
    A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
    S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
  };
  const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = v[i];
    sum += (/\d/.test(ch) ? Number(ch) : values[ch] ?? 0) * weights[i];
  }
  const r = sum % 11;
  return v[8] === (r === 10 ? "X" : String(r));
}

// ─── auction_comments rows ─────────────────────────────────────────
// The ONE builder of auction_comments rows from a lot page's comments JSON (extract-bat-core v4.1 and the
// archive loader use it, so a row built from a saved page is byte-identical to the row the reader writes).
// Row identity is content_hash = sha256('bat' | normalized url | sequence | posted_at ISO | author | text);
// the reader upserts on (vehicle_id, content_hash) with ignoreDuplicates, so a re-read never duplicates.
// Every comment lands, including one with no text (an image-only or emoji comment is still an interaction
// with an author and a moment — Skylar's rule, 2026-09-27: authentic data, no curation); its media travels in
// has_media + media_urls. A voided bid (bat-bid-canceled) is never a bid on record.
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface AuctionCommentRow {
  auction_event_id: string | null;
  vehicle_id: string;
  platform: "bat";
  source_url: string;
  content_hash: string;
  sequence_number: number;
  posted_at: string;
  hours_until_close: number;
  author_username: string;
  is_seller: boolean;
  author_total_likes: number;
  comment_type: "bid" | "sold" | "seller_response" | "question" | "observation";
  comment_text: string;
  word_count: number;
  has_question: boolean;
  has_media: boolean;
  media_urls: string[] | null;
  bid_amount: number | null;
  comment_likes: number;
  bat_author_id: number | null;
  bat_comment_id: number | null;
  bat_author_likes: number | null;
  likers_count: number | null;
}

export function commentMediaUrls(c: any): string[] {
  const out: string[] = [];
  for (const img of Array.isArray(c?.images) ? c.images : []) {
    const u = img?.large?.url || img?.url || img?.small?.url;
    if (typeof u === "string" && u) out.push(u);
  }
  for (const v of Array.isArray(c?.videos) ? c.videos : []) {
    const src = typeof v?.oembedHtml === "string" ? v.oembedHtml.match(/src="([^"]+)"/)?.[1] : null;
    const u = src || v?.url;
    if (typeof u === "string" && u) out.push(u);
  }
  return out;
}

export async function buildAuctionCommentRows(args: {
  rawComments: any[];
  listingUrlNorm: string;
  vehicleId: string;
  auctionEventId: string | null;
  endAt: Date | null;
}): Promise<AuctionCommentRow[]> {
  const { rawComments, listingUrlNorm, vehicleId, auctionEventId, endAt } = args;
  const rows: AuctionCommentRow[] = [];
  for (let i = 0; i < rawComments.length; i++) {
    const c: any = rawComments[i];
    const authorRaw = String(c?.authorName || c?.author || "").trim();
    const author = authorRaw.replace(/\s*\(The\s+Seller\)/i, "").trim() || "Unknown";
    const isSeller = authorRaw.toLowerCase().includes("(the seller)");
    const ts = typeof c?.timestamp === "number" && c.timestamp > 0 ? new Date(c.timestamp * 1000) : null;
    const postedAt = ts ?? endAt ?? new Date();
    const text = String(c?.content || c?.comment || c?.text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const type = String(c?.type ?? "");
    const voided = type === "bat-bid-canceled";                      // BaT voided it: never a bid on record
    const isBid = !voided && (type === "bat-bid" || /bid\s+placed\s+by/i.test(text));
    const bidAmount = isBid && Number(c?.bidAmount) > 0 ? Number(c.bidAmount) : null;
    const isSaleRecord = (type === "bat-bid-reserve" && /^sold\b/i.test(text)) || type === "bat-rnm-accepted";
    const comment_type = bidAmount ? "bid" : isSaleRecord ? "sold" : isSeller ? "seller_response" : text.includes("?") ? "question" : "observation";
    const hoursUntilClose = endAt && ts ? (endAt.getTime() - postedAt.getTime()) / 3600000 : 0;
    const content_hash = await sha256Hex(["bat", listingUrlNorm, String(i + 1), postedAt.toISOString(), author, text].join("|"));
    const media = commentMediaUrls(c);
    rows.push({
      auction_event_id: auctionEventId,
      vehicle_id: vehicleId,
      platform: "bat",
      source_url: listingUrlNorm,
      content_hash,
      sequence_number: i + 1,
      posted_at: postedAt.toISOString(),
      hours_until_close: Math.max(0, hoursUntilClose),
      author_username: author,
      is_seller: isSeller,
      author_total_likes: typeof c?.likes === "number" ? c.likes : 0,
      comment_type,
      comment_text: text,
      word_count: text ? text.split(/\s+/).length : 0,
      has_question: text.includes("?"),
      has_media: Boolean(c?.hasImage || c?.hasVideo || media.length > 0),
      media_urls: media.length > 0 ? media : null,
      bid_amount: bidAmount,
      comment_likes: typeof c?.commentLikes === "number" ? c.commentLikes : 0,
      bat_author_id: typeof c?.authorId === "number" ? c.authorId : null,
      bat_comment_id: typeof c?.id === "number" ? c.id : null,
      bat_author_likes: typeof c?.authorLikes === "number" ? c.authorLikes : null,
      likers_count: Array.isArray(c?.likers) ? c.likers.length : null,
    });
  }
  return rows;
}
