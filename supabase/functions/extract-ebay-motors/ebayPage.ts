/**
 * eBay Motors public pages -> data. Pure functions over Firecrawl's html/markdown; no network, no database.
 *
 * Search page (https://www.ebay.com/sch/i.html, read 2026-10-15): 240 `li.s-card` cards per page, newest first with _sop=10. Each card
 * is a run of text nodes: title, subtitle, condition, price, format (Buy It Now | N bids | Classified Ad | or Best Offer),
 * "Located in", a start time ("Oct-14 20:18", site time, no year, zone unstated), "Year: ", "Miles: ", "Brand: ", the seller
 * username and "98.7% positive (1.3K)". The facets that filter it are aspect params with DOUBLE-encoded names:
 * Model%2520Year=1964%7C1965..., For%2520Sale%2520By=Private%2520Seller (also Dealer, Not%2520Specified), plus _dcat=6001.
 * A plain Model%20Year is silently ignored. "For Sale By" is a seller-declared item specific that eBay shows and filters on.
 *
 * Item page: the markdown carries "## Item specifics" as alternating label / value paragraphs, the description under
 * "## Item description from the seller", "Located in: City, State, United States", "eBay item number:", and the seller block
 * (username link /sch/<user>/m.html, "(count)", "N% positive"). Gallery photos are the distinct data-zoom-src URLs (s-l1600).
 */
import type { EbayItem } from "./browseMap.ts";

export const FOR_SALE_BY = { private: "Private%2520Seller", dealer: "Dealer", unspecified: "Not%2520Specified" } as const;
export type Facet = keyof typeof FOR_SALE_BY;

export function searchUrl(years: number[], facet: Facet, page = 1): string {
  return `https://www.ebay.com/sch/i.html?_sacat=6001&_sop=10&_ipg=240&rt=nc&Model%2520Year=${years.join("%7C")}`
    + `&For%2520Sale%2520By=${FOR_SALE_BY[facet]}&_dcat=6001${page > 1 ? `&_pgn=${page}` : ""}`;
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (w, n: string) => {
    if (n[0] === "#") {
      const c = n[1].toLowerCase() === "x" ? parseInt(n.slice(2), 16) : parseInt(n.slice(1), 10);
      return Number.isFinite(c) && c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : w;
    }
    return ENT[n.toLowerCase()] ?? w;
  });

// ---- search cards ----------------------------------------------------------------------------------------------

export interface Card {
  itemId: string; url: string; title: string | null; subtitle: string | null; condition: string | null;
  price: number | null; priceText: string | null; format: "auction" | "buy_it_now" | "classified" | "best_offer" | "unknown";
  bids: number | null; listedLabel: string | null; year: number | null; miles: number | null; brand: string | null;
  sellerUsername: string | null; sellerFeedbackPct: number | null; sellerFeedbackCount: number | null;
  newListing: boolean; rows: string[];
}

const CONDITION = /^(Pre-Owned|Brand New|Used|Certified|For parts|Open box)\b/;
const TIME_LABEL = /^[A-Z][a-z]{2}-\d{1,2} \d{1,2}:\d{2}$/;
const count = (n: string, suf: string) => Math.round(parseFloat(n.replace(/,/g, "")) * ({ "": 1, K: 1e3, M: 1e6 } as Record<string, number>)[suf.toUpperCase()]);

export function parseSearchCards(html: string): Card[] {
  const out: Card[] = [];
  const seen = new Set<string>();
  for (const part of html.split(/(?=<li class="s-card )/).slice(1)) {
    const id = part.match(/href="https:\/\/(?:www\.)?ebay\.com\/itm\/(\d{6,})/)?.[1];
    if (!id || id === "123456" || seen.has(id)) continue;                      // the first card on every page is eBay's own placeholder (itm/123456)
    seen.add(id);
    const rows = [...part.matchAll(/>([^<>]+)</g)].map((m) => decode(m[1]).replace(/\s+/g, " ").trim()).filter(Boolean);
    const at = (re: RegExp) => rows.find((r) => re.test(r)) ?? null;
    const fb = at(/% positive/);
    const fbm = fb?.match(/([\d.]+)% positive \(([\d.,]+)([KMkm]?)\)/);
    const fbIdx = fb ? rows.indexOf(fb) : -1;
    const titleIdx = rows.findIndex((r) => r === "Opens in a new window or tab") - 1;
    const priceText = at(/^\$[\d,]+(\.\d\d)?$/) ?? at(/^(US )?\$[\d,]+/);
    const bidsRow = at(/^\d+ bids?$/);
    const fmt: Card["format"] = rows.some((r) => /^Classified Ad/.test(r)) ? "classified" : bidsRow || rows.includes("0 bids") ? "auction"
      : rows.includes("Buy It Now") ? "buy_it_now" : rows.includes("or Best Offer") ? "best_offer" : "unknown";
    const year = at(/^Year: \d{4}$/)?.slice(6);
    const miles = at(/^Miles: [\d,]+$/)?.slice(7);
    out.push({
      itemId: id, url: `https://www.ebay.com/itm/${id}`, title: titleIdx >= 0 ? rows[titleIdx] : null,
      subtitle: titleIdx >= 0 && rows[titleIdx + 2] && !CONDITION.test(rows[titleIdx + 2]) && !/^(Located|\$)| ·$/.test(rows[titleIdx + 2]) ? rows[titleIdx + 2] : null,
      condition: at(CONDITION)?.replace(/\s*·\s*$/, "") ?? null,
      price: priceText ? Number(priceText.replace(/[^\d.]/g, "")) : null, priceText, format: fmt,
      bids: bidsRow ? Number(bidsRow.split(" ")[0]) : null, listedLabel: at(TIME_LABEL),
      year: year ? Number(year) : null, miles: miles ? Number(miles.replace(/,/g, "")) : null, brand: at(/^Brand: /)?.slice(7) ?? null,
      sellerUsername: fbIdx > 0 ? rows[fbIdx - 1].trim() : null,
      sellerFeedbackPct: fbm ? Number(fbm[1]) : null, sellerFeedbackCount: fbm ? count(fbm[2], fbm[3]) : null,
      newListing: rows.includes("New Listing"), rows: rows.slice(0, 40),
    });
  }
  return out;
}

export function resultCount(html: string): number | null {
  const m = html.match(/srp-controls__count-heading[^>]*>(?:<!--[^>]*-->)*(?:<span[^>]*>)?([\d,]+)\+?(?:<\/span>)?/);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

// ---- item page --------------------------------------------------------------------------------------------------

export interface ItemPage {
  itemId: string | null; title: string | null; specifics: Record<string, string>; priceText: string | null; price: number | null;
  format: "auction" | "buy_it_now" | "classified" | "best_offer" | "unknown"; bids: number | null; location: string | null;
  sellerUsername: string | null; sellerFeedbackPct: number | null; sellerFeedbackCount: number | null;
  description: string; images: string[]; timeLeft: string | null; forSaleBy: string | null;
}

function section(md: string, head: RegExp): string {
  const m = md.match(head);
  if (!m || m.index == null) return "";
  const rest = md.slice(m.index + m[0].length);
  const next = rest.search(/\n## /);
  return next < 0 ? rest : rest.slice(0, next);
}

export function parseItemPage(html: string, md: string): ItemPage {
  const specifics: Record<string, string> = {};
  const lines = section(md, /\n## Item specifics\n/).split(/\n\s*\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const k = lines[i].replace(/\s+/g, " ");
    if (k.length > 60 || /^(Category)$/i.test(k)) break;
    specifics[k] = lines[i + 1].replace(/\s+/g, " ").replace(/\s*Read more.*$/, "").slice(0, 400);
  }
  const title = md.match(/\n# ([^\n]+)\n/)?.[1]?.trim() ?? null;
  const itemId = md.match(/eBay item number:\s*(\d{6,})/)?.[1] ?? null;
  const priceText = md.match(/\n(?:US )?(\$[\d,]+(?:\.\d\d)?)(?=\s|or |\n|$)/)?.[1] ?? md.match(/\nUS (\$[\d,]+(?:\.\d\d)?)/)?.[1] ?? null;
  const head = md.slice(0, md.indexOf("## Item specifics") > 0 ? md.indexOf("## Item specifics") : 6000);
  const isAuction = /Place bid|Current bid|Starting bid/i.test(head);
  const bids = isAuction ? head.match(/\b(\d+) bids?\b/)?.[1] : undefined;
  const format: ItemPage["format"] = /Classified Ad/i.test(head) ? "classified" : isAuction ? "auction"
    : /Buy It Now/i.test(head) ? (/Make offer|or Best Offer/i.test(head) ? "best_offer" : "buy_it_now") : "unknown";
  const sellerBlock = md.slice(md.indexOf("\n# "), md.indexOf("\n# ") + 2500);
  const user = sellerBlock.match(/\]\(https:\/\/www\.ebay\.com\/sch\/([A-Za-z0-9._\-]+)\/m\.html/)?.[1] ?? md.match(/\/sch\/([A-Za-z0-9._\-]+)\/m\.html/)?.[1] ?? null;
  const fbPct = sellerBlock.match(/([\d.]+)% positive/)?.[1];
  const fbCount = sellerBlock.match(/\n\(([\d.,]+)([KMkm]?)\)\n/);
  const desc = section(md, /\n## Item description from the seller\n/).split("\n").filter((l) => !/^!\[[^\]]*\]\(/.test(l.trim()) && l.trim() !== "eBay").join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const zoom = [...new Set([...html.matchAll(/data-zoom-src="(https:\/\/i\.ebayimg\.com\/[^"]+)"/g)].map((m) => decode(m[1])))];
  return {
    itemId, title, specifics, priceText, price: priceText ? Number(priceText.replace(/[^\d.]/g, "")) : null, format,
    bids: bids !== undefined ? Number(bids) : null, location: md.match(/Located in:\s*([^\n]+)/)?.[1]?.replace(/,\s*United States$/, "").trim() ?? null,
    sellerUsername: user, sellerFeedbackPct: fbPct ? Number(fbPct) : null, sellerFeedbackCount: fbCount ? count(fbCount[1], fbCount[2]) : null,
    description: desc, images: zoom, timeLeft: md.match(/Time left:\s*([^\n]+)/)?.[1]?.replace(/\\\|/g, " | ") ?? null,
    forSaleBy: specifics["For Sale By"] ?? null,
  };
}

/** The page in the shape the Browse mapping (toLanding) already takes, so both doors land through one mapping. */
export function pageToItem(p: ItemPage, card?: Card | null): EbayItem {
  const id = p.itemId ?? card?.itemId ?? null;
  const [city, state] = (p.location ?? "").split(",").map((s) => s.trim());
  const buying = p.format === "auction" ? ["AUCTION"] : p.format === "classified" ? ["CLASSIFIED_AD"]
    : p.format === "best_offer" ? ["FIXED_PRICE", "BEST_OFFER"] : p.format === "buy_it_now" ? ["FIXED_PRICE"] : [];
  const price = p.price ?? card?.price ?? null;
  return {
    itemId: id ? `v1|${id}|0` : undefined, legacyItemId: id ?? undefined, title: p.title ?? card?.title ?? undefined, description: p.description,
    price: price != null ? { value: String(price), currency: "USD" } : undefined,
    currentBidPrice: p.format === "auction" && price != null ? { value: String(price), currency: "USD" } : undefined,
    bidCount: p.bids ?? card?.bids ?? undefined, buyingOptions: buying,
    itemLocation: city ? { city, stateOrProvince: state } : undefined,
    image: p.images[0] ? { imageUrl: p.images[0] } : undefined, additionalImages: p.images.slice(1).map((u) => ({ imageUrl: u })),
    localizedAspects: Object.entries(p.specifics).map(([name, value]) => ({ name, value })),
    seller: { username: p.sellerUsername ?? card?.sellerUsername ?? undefined, feedbackScore: p.sellerFeedbackCount ?? card?.sellerFeedbackCount ?? undefined,
      feedbackPercentage: (p.sellerFeedbackPct ?? card?.sellerFeedbackPct)?.toString() },
    itemEndDate: undefined, condition: p.specifics["Condition"]?.split(":")[0],
  };
}
