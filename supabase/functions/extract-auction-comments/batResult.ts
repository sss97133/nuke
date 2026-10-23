/**
 * The listing's own result banner on a BaT page: "Sold for <strong>USD $85,000</strong>" or "Bid to <strong>USD $85,000</strong>".
 * The banner, not comment prose, decides whether a listing sold. 214 events were stored as sold at $5-$98 on 2026-10-23
 * because a user comment saying "...sold for $95k" was typed as the sale comment and its "$95" became the price.
 */
export type BatPageResult = { kind: "sold" | "bid_to"; amount: number } | null;

export function parseBatPageResult(html: string | null | undefined): BatPageResult {
  const m = String(html ?? "").match(/(Sold for|Bid to)\s*<strong>\s*(?:USD\s*)?\$([0-9,]+)\s*<\/strong>/i);
  if (!m) return null;
  const amount = Number(m[2].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { kind: m[1].toLowerCase().startsWith("sold") ? "sold" : "bid_to", amount };
}

/** BaT's system sale line ("Sold on 2/27/22 for $85,000 to user"); prose like "should have sold for" is not one. */
export function isBatSystemSoldComment(text: string | null | undefined): boolean {
  return /\bSold on\b/.test(String(text ?? ""));
}

/** A sale price under 100 is never a car's hammer on BaT; it is a misread fragment ($95k read as $95). */
export function plausibleBatSalePrice(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) && n >= 100 ? Math.floor(n) : null;
}
