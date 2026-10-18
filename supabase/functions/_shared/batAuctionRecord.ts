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

// ─── the lot's own end ─────────────────────────────────────────────
// A running lot's page states its end on its own countdown: data-ends="<unix>" data-ends-id="<post id>" in the stats
// table, and data-auction-ends="YYYY-MM-DD-hh-mm-ss" data-auction-ends-id="<post id>" beside it. A closed page has no
// countdown of its own; its "Sold for USD $X on 5/26/26" / "Bid to … on …" line stamps the close (data-timestamp).
// Every page also carries the "Current BaT Auctions" widget, one data-auction-ends per OTHER running lot (50 on a
// closed page read 2026-10-15). Taking the first data-auction-ends on the page dated lots sold in April and May 2026
// as ending 2026-10-15. So a countdown counts only when it carries the page's own post id (the shortlink ?p=).

export interface BatOwnAuctionEnd {
  /** the page's post id: the shortlink's ?p=, else the result line's data-listing-currently */
  postId: string | null;
  /** a running lot's end from its own countdown (moves as late bids extend it), ISO UTC; null on a closed page */
  endsAt: string | null;
  /** the day of endsAt, or the countdown's day when its time is not readable */
  endsDate: string | null;
  /** which own countdown gave the end: the stats table's data-ends, or the data-auction-ends countdown */
  endsFrom: "data-ends" | "countdown" | null;
  /** a closed page's result stamp ("Sold for … on 5/26/26", "Withdrawn on 10/5/26"), ISO UTC; null while the lot runs */
  closedAt: string | null;
  /** the result line says "Withdrawn on <date>": BaT pulled the lot, so there is no sale and no reserve result */
  withdrawn: boolean;
}

const attrOf = (tag: string, name: string): string | null =>
  tag.match(new RegExp(`\\s${name}=["']([^"']*)["']`, "i"))?.[1] ?? null;

/** The lot's own end on a BaT listing page; never another lot's countdown. */
export function readOwnAuctionEnd(html: string): BatOwnAuctionEnd {
  const h = String(html || "");
  const info = h.match(/<div class="listing-available-info">([\s\S]{0,2000}?)<\/div>/i)?.[1] ?? "";
  const postId =
    h.match(/<link[^>]*rel=['"]shortlink['"][^>]*href=['"][^'"]*[?&]p=(\d+)/i)?.[1] ??
    h.match(/<link[^>]*href=['"][^'"]*[?&]p=(\d+)['"][^>]*rel=['"]shortlink['"]/i)?.[1] ??
    info.match(/data-listing-currently="(\d+)"/i)?.[1] ??
    null;
  const own = (id: string | null) => id === null || postId === null || id === postId;

  let endsAt: string | null = null;
  let endsDate: string | null = null;
  let endsFrom: BatOwnAuctionEnd["endsFrom"] = null;
  for (const m of h.matchAll(/<[^>]*\sdata-ends="(\d+)"[^>]*>/gi)) {
    if (!own(attrOf(m[0], "data-ends-id"))) continue;
    endsAt = isoOf(m[1]);
    if (endsAt) { endsFrom = "data-ends"; break; }
  }
  // the countdown fallback: only the one keyed to this page (the widget's entries carry other lots' ids)
  if (!endsAt && postId) {
    for (const m of h.matchAll(/<[^>]*\sdata-auction-ends="(\d{4}-\d{2}-\d{2})-\d{2}-\d{2}-\d{2}"[^>]*>/gi)) {
      if (attrOf(m[0], "data-auction-ends-id") !== postId) continue;
      endsAt = isoOf(attrOf(m[0], "data-timestamp"));
      endsDate = m[1];
      endsFrom = "countdown";
      break;
    }
  }
  if (endsAt) endsDate = endsAt.slice(0, 10);

  const infoId = info.match(/data-listing-currently="(\d+)"/i)?.[1] ?? null;
  // the stamp's span: "date date-localize" after "Sold for" / "Bid to", "info-value noborder-tiny date-localize" after
  // "Withdrawn on" (six lots withdrawn 10-05..08 read as running until 2026-10-15: the old pattern wanted class="date…")
  const closedAt = info && !/\sdata-until=/i.test(info) && own(infoId)
    ? isoOf(info.match(/<span[^>]*\sclass="[^"]*\bdate-localize\b[^"]*"[^>]*\sdata-timestamp="(\d+)"/i)?.[1])
    : null;
  const withdrawn = closedAt !== null && /<span class="info-label">\s*Withdrawn on\s*<\/span>/i.test(info);
  return { postId, endsAt, endsDate, endsFrom, closedAt, withdrawn };
}

/** ISO 3779 check digit for a 17-character VIN (pre-1981 VINs have none and are not judged here). */
/**
 * The countdown end date ("2025-12-16-19-08-57" -> "2025-12-16") of a LIVE lot page, or null.
 * A closed page has no countdown of its own, but its sidebar lists other live lots with data-auction-ends: the first
 * match there is another lot's end (2026-10-15: repeat "-2" lots sold on 10/14 were stamped with a sidebar lot's date).
 * A page that carries a closing record is closed, so it never reads a countdown.
 */
export function countdownEndDate(html: string): string | null {
  if (summarizeAuction(html).recordAt) return null;
  const m = html.match(/data-auction-ends="(\d{4}-\d{2}-\d{2})-\d{2}-\d{2}-\d{2}"/i);
  return m?.[1] ?? null;
}

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

export type AuctionCommentPlatform = "bat" | "cars_and_bids";

export interface AuctionCommentRow {
  auction_event_id: string | null;
  vehicle_id: string;
  platform: AuctionCommentPlatform;
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
  /** The platform's own comment id where it has a stable text one (Cars & Bids); BaT's stays in bat_comment_id. */
  source_comment_id?: string | null;
  /** Handles the comment addresses: its reply target and any @handle in the text (Cars & Bids). */
  mentions?: string[] | null;
  /** The platform flagged, hid or deleted the comment (Cars & Bids). */
  is_flagged?: boolean;
}

export interface BatCommentIdentityStore<P extends AuctionCommentPlatform = "bat"> {
  /** Exact (platform, handle) lookup for the rows' platform; no case folding or fuzzy person matching. */
  find(handles: string[]): Promise<Array<{ id: string; handle: string }>>;
  /** Insert only, on conflict (platform,handle) do nothing. Never reset an existing identity. */
  insertMissing(rows: Array<{ platform: P; handle: string; profile_url: string }>): Promise<void>;
}

const PROFILE_URL: Record<AuctionCommentPlatform, (handle: string) => string> = {
  bat: (handle) => `https://bringatrailer.com/member/${encodeURIComponent(handle)}`,
  cars_and_bids: (handle) => `https://carsandbids.com/user/${encodeURIComponent(handle)}`,
};

/** Link fresh comments before INSERT, so the profile-queue trigger receives the identity too.
 * Repeated authors cost one lookup per batch, not one request per comment. Existing identity
 * claims/metadata/clocks are untouched. A read after insert resolves concurrent insert winners.
 * Failures propagate: the writer can retry instead of silently inserting disconnected comments.
 */
export async function linkAuctionCommentIdentities<P extends AuctionCommentPlatform = "bat">(
  rows: AuctionCommentRow[], store: BatCommentIdentityStore<P>, platform: P = "bat" as P,
): Promise<Array<AuctionCommentRow & { external_identity_id: string | null }>> {
  if (rows.some((r) => r.platform !== platform)) throw new Error(`Comment identity link expects ${platform} rows only`);
  // Same rule as trg_key_auction_comment_author and key_auction_comment_authors (20261006090000):
  // an author named anonymous (any case) is never keyed, whatever its bat_author_id. Different anonymous
  // posters are not one (bat, 'anonymous') identity; NULL means unresolved.
  const identifiable = (r: AuctionCommentRow) => r.author_username !== "Unknown" &&
    r.author_username.trim() !== "" &&
    r.author_username.toLowerCase() !== "anonymous";
  const handles = [...new Set(rows.filter(identifiable).map((r) => r.author_username))];
  const ids = new Map<string, string>();
  for (let offset = 0; offset < handles.length; offset += 200) {
    const batch = handles.slice(offset, offset + 200);
    for (const identity of await store.find(batch)) ids.set(identity.handle, identity.id);
    const missing = batch.filter((handle) => !ids.has(handle));
    if (missing.length) {
      await store.insertMissing(missing.map((handle) => ({
        platform, handle, profile_url: PROFILE_URL[platform](handle),
      })));
      for (const identity of await store.find(missing)) ids.set(identity.handle, identity.id);
    }
    if (batch.some((handle) => !ids.has(handle))) {
      throw new Error(`${platform === "bat" ? "BaT" : "Cars & Bids"} comment identity lookup incomplete after insert; retry comments`);
    }
  }
  return rows.map((row) => ({
    ...row, external_identity_id: identifiable(row) ? ids.get(row.author_username)! : null,
  }));
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

// ─── Cars & Bids auction_comments rows ─────────────────────────────
// Same row shape and rules as the BaT builder. A C&B comment carries a stable site-wide id, so its identity is the
// id itself, as the BaT live stream keys native comments: content_hash = sha256('cars_and_bids|native-comment:' + id),
// with the id kept in source_comment_id. trg_key_cab_auction_comment computes the same hash in the database for every
// writer and keeps a comment held under the legacy 'cab_<vehicle>_<id>' key on that key, so a re-read never forks.
export interface CabCommentInput {
  id: string;
  author: string;
  postedAt: string | null;
  text: string;
  likes: number;
  bidAmount: number | null;
  isSeller: boolean;
  /** The platform's own result line, comments API type 5: "Sold to <buyer> for $X" or "Reserve not met, bid to $X". */
  isResult?: boolean;
  /** Full URLs of the comment's attachments. */
  mediaUrls?: string[];
  /** Handle the comment replies to. */
  replyTo?: string | null;
  /** Flagged, system-flagged or deleted on the platform. */
  flagged?: boolean;
}

export function cabCommentContentHash(commentId: string): Promise<string> {
  return sha256Hex(`cars_and_bids|native-comment:${commentId}`);
}

/** The C&B comment id inside a legacy 'cab_<vehicle uuid>_<id>' content_hash; null for any other hash. */
export function legacyCabCommentId(contentHash: string | null | undefined): string | null {
  const m = /^cab_[0-9a-f-]{36}_(.+)$/i.exec(contentHash ?? "");
  return m ? m[1] : null;
}

export async function buildCabAuctionCommentRows(args: {
  comments: CabCommentInput[];
  listingUrlNorm: string;
  vehicleId: string;
  auctionEventId: string | null;
  endAt: Date | null;
}): Promise<AuctionCommentRow[]> {
  const { listingUrlNorm, vehicleId, auctionEventId, endAt } = args;
  // sequence_number is the position in the thread, 1 = first; the comments API lists newest first.
  const at = (c: CabCommentInput) => {
    const t = c.postedAt ? new Date(c.postedAt).getTime() : NaN;
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
  };
  const comments = args.comments.map((c, i) => ({ c, i })).sort((a, b) => at(a.c) - at(b.c) || a.i - b.i).map((x) => x.c);
  const rows: AuctionCommentRow[] = [];
  for (let i = 0; i < comments.length; i++) {
    const c = comments[i];
    const id = String(c.id ?? "").trim();
    if (!id) throw new Error(`Cars & Bids comment ${i + 1} has no comment id; refusing an unkeyed row`);
    const author = String(c.author ?? "").trim() || "Unknown";
    const ts = c.postedAt ? new Date(c.postedAt) : null;
    const postedAt = ts && !Number.isNaN(ts.getTime()) ? ts : endAt ?? new Date();
    const text = String(c.text ?? "").replace(/\s+/g, " ").trim();
    const bidAmount = Number(c.bidAmount) > 0 ? Number(c.bidAmount) : null;
    const hoursUntilClose = endAt && ts ? (endAt.getTime() - postedAt.getTime()) / 3600000 : 0;
    const media = (c.mediaUrls ?? []).filter(Boolean);
    const mentions = [...new Set([c.replyTo, ...[...text.matchAll(/@([A-Za-z0-9_.-]+)/g)].map((m) => m[1])]
      .map((h) => String(h ?? "").trim()).filter(Boolean))];
    const comment_type = bidAmount ? "bid"
      : c.isResult && /^sold\b/i.test(text) ? "sold"
      : c.isSeller ? "seller_response"
      : text.includes("?") ? "question"
      : "observation";
    rows.push({
      auction_event_id: auctionEventId,
      vehicle_id: vehicleId,
      platform: "cars_and_bids",
      source_url: listingUrlNorm,
      content_hash: await cabCommentContentHash(id),
      sequence_number: i + 1,
      posted_at: postedAt.toISOString(),
      hours_until_close: Math.max(0, hoursUntilClose),
      author_username: author,
      is_seller: Boolean(c.isSeller),
      author_total_likes: 0,
      comment_type,
      comment_text: text,
      word_count: text ? text.split(/\s+/).length : 0,
      has_question: text.includes("?"),
      has_media: media.length > 0,
      media_urls: media.length > 0 ? media : null,
      bid_amount: bidAmount,
      comment_likes: typeof c.likes === "number" ? c.likes : 0,
      bat_author_id: null,
      bat_comment_id: null,
      bat_author_likes: null,
      likers_count: null,
      source_comment_id: id,
      mentions: mentions.length > 0 ? mentions : null,
      is_flagged: Boolean(c.flagged),
    });
  }
  return rows;
}
