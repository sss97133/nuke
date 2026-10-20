/**
 * BaT's own "Private Party or Dealer" line, read from a lot page's essentials block.
 *
 * Live shape (checked on saved snapshots 2026-10-20, 267 of 267 lot pages carry it):
 *   <div class="item additional"><strong>Private Party or Dealer</strong>: Private Party</div>
 *   <div class="item additional"><strong>Private Party or Dealer</strong>: Dealer</div>
 * The colon sits after </strong>. The old batParser regex wanted the colon inside the label, so it never matched.
 *
 * The raw text is testimony and is kept as read. `seller_type` is private | dealer (the values the column already holds for other sources); anything
 * else stays null so a new BaT wording shows up as raw text with no type instead of a guess.
 */

/** the vocabulary auction_events.seller_type already uses (Cars & Bids: 32,850 private, 9,841 dealer, 2026-10-20) and lot_quality_signal uses */
export type BatSellerType = "private" | "dealer";

export interface BatPartyLine {
  /** the line's value as the page states it, whitespace collapsed; null when the page has no such line */
  party_type_raw: string | null;
  seller_type: BatSellerType | null;
}

const LINE_RE = /Private\s+Party\s+or\s+Dealer\s*(?::\s*)?(?:<\/(?:strong|b|span)>)?\s*:?\s*([\s\S]{0,200}?)(?:<\/div>|<\/li>|<\/p>|<br\b)/i;

function decode(s: string): string {
  return s
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#0?39;|&apos;/gi, "'");
}

/** "Private Party" / "Dealer" in any case or spacing; anything else is null. */
export function normalizeBatSellerType(raw: string | null | undefined): BatSellerType | null {
  if (!raw) return null;
  const t = raw.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  if (t === "private party" || t === "private" || t === "private seller") return "private";
  if (t === "dealer" || t === "dealership") return "dealer";
  return null;
}

/** Read the line from lot-page HTML (no fetch). Pass the essentials slice or the whole page. */
export function readBatPartyLine(html: string | null | undefined): BatPartyLine {
  const m = String(html || "").match(LINE_RE);
  if (!m) return { party_type_raw: null, seller_type: null };
  const raw = decode(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 80);
  if (!raw) return { party_type_raw: null, seller_type: null };
  return { party_type_raw: raw, seller_type: normalizeBatSellerType(raw) };
}
