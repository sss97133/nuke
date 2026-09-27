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
