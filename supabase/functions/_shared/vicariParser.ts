import { htmlToText } from "./htmlToText.ts";

export const VICARI_PARSER = "vicari_html_v1";

/** ahid, not the WordPress path or auction lot number, identifies one source listing. */
export function vicariListingId(raw: string): string | null {
  try {
    const u = new URL(raw);
    const ids = u.searchParams.getAll("ahid");
    if (!/^https?:$/.test(u.protocol) || !/^(www\.)?vicariauction\.com$/i.test(u.hostname)
      || u.username || u.password || u.port || !/^\/auction-house(?:\/\d+)?\/?$/.test(u.pathname)
      || ids.length !== 1 || !/^[1-9]\d{0,9}$/.test(ids[0])) return null;
    return ids[0];
  } catch { return null; }
}

export const vicariUrl = (id: string): string => `https://vicariauction.com/auction-house?ahid=${id}`;
const clean = (s: string): string => htmlToText(s).replace(/[ \t]+/g, " ").trim();
const known = (s?: string): string | null => s && !/^(?:n\/?a|unknown|none|-+)$/i.test(s.trim()) ? s.trim() : null;

// Repeat removal so malformed nested markup cannot reassemble a comment/script around fake lot claims.
function visibleMarkup(html: string): string {
  let previous: string;
  do {
    previous = html;
    html = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  } while (html !== previous);
  return html;
}

function meta(body: string, property: string): string | null {
  for (const m of body.matchAll(/<meta\b[^>]*>/gi)) {
    if (m[0].match(/\bproperty=["']([^"']+)["']/i)?.[1] !== property) continue;
    return clean(m[0].match(/\bcontent="([^"]*)"/i)?.[1] ?? m[0].match(/\bcontent='([^']*)'/i)?.[1] ?? "");
  }
  return null;
}

export interface VicariListing {
  source_id: string;
  source_url: string;
  title: string;
  lot_number: string | null;
  auction_name: string | null;
  raw_fields: Record<string, string>;
  year: number | null;
  make: string | null;
  model: string | null;
  description: string;
  image_urls: string[];
  presentation: "archive" | "for_sale_after_auction" | "unknown";
  high_bid: { amount: number; currency_symbol: "$"; currency: null; basis: "source_high_bid" } | null;
  sale_price: null;
  sale_date: null;
}

/** Literal source claims only. The Status field also contains title/no-reserve disclosures, not a sale result. */
export function parseVicariListing(html: string, url: string): VicariListing {
  const id = vicariListingId(url);
  if (!id) throw new Error("invalid_vicari_listing_url");
  const body = visibleMarkup(html);
  const declaredUrl = meta(body, "og:url");
  if (declaredUrl && vicariListingId(declaredUrl) !== id) throw new Error("vicari_page_listing_mismatch");
  const fields: Record<string, string> = {};
  for (const block of body.matchAll(/<ul\b[^>]*class=["'][^"']*\bdetail\b[^"']*["'][^>]*>([\s\S]*?)<\/ul>/gi)) {
    for (const item of block[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
      const text = clean(item[1]), colon = text.indexOf(":");
      if (colon < 0) continue;
      const label = text.slice(0, colon).trim(), value = text.slice(colon + 1).trim();
      if (label in fields && fields[label] !== value) throw new Error("conflicting_vicari_field");
      fields[label] = value;
    }
  }
  if (!["Year", "Make", "Model"].every(k => k in fields)) throw new Error("vicari_attribute_block_missing");
  const headings = [...body.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)].map(m => clean(m[1]));
  const identity = clean([fields.Year, fields.Make, fields.Model].join(" "));
  // Older archives omit the lot prefix from their heading, but retain the same labeled identity fields.
  const title = headings.find(t => /^Lot\s+\S+\s*[–—-]/i.test(t))
    ?? headings.find(t => t.toLowerCase() === identity.toLowerCase());
  if (!title) throw new Error("vicari_lot_heading_missing");
  const lot = title.match(/^Lot\s+(\S+)\s*[–—-]/i)?.[1]
    ?? meta(body, "og:description")?.match(/\bLot:\s*([^\s–—]+)\s*[–—-]/i)?.[1] ?? null;
  const images = new Set<string>();
  for (const tag of body.matchAll(/<img\b[^>]*>/gi)) {
    const src = tag[0].match(/\bsrc=["']([^"']+)["']/i)?.[1];
    if (!src) continue;
    try {
      const u = new URL(src.replace(/&amp;/g, "&"), url);
      if (!/^(www\.)?vicariauction\.com$/i.test(u.hostname) || !/^https?:$/.test(u.protocol)) continue;
      const photo = u.pathname.match(/^\/car_images\/inventory\/(\d+)\/([^/]+\.(?:jpe?g|png|webp|gif))$/i);
      if (!photo) continue;
      if (photo[1] !== id) throw new Error("vicari_image_listing_mismatch");
      images.add(u.href);
    } catch (e) { if (e instanceof Error && e.message === "vicari_image_listing_mismatch") throw e; }
  }
  const auction = body.match(/<h2\b[^>]*>\s*(?:Lot\s+[^<]*)?<a\b[^>]*>([\s\S]*?)<\/a>/i);
  const text = clean(body);
  const archive = /This is an ARCHIVE listing/i.test(text);
  const forSale = /This Car is Still\s*(?:For\s*Sale|FOR SALE)/i.test(text);
  const bid = text.match(/Note:\s*the High bid was:\s*\$\s*(\d[\d,]*(?:\.\d{2})?)/i);
  const amount = bid ? Number(bid[1].replace(/,/g, "")) : null;
  const year = /^\d{4}$/.test(fields.Year) ? Number(fields.Year) : null;
  return {
    source_id: id, source_url: vicariUrl(id), title, lot_number: lot,
    auction_name: auction ? clean(auction[1]) : null, raw_fields: fields,
    year: year && year >= 1886 && year <= 2100 ? year : null,
    make: known(fields.Make), model: known(fields.Model),
    description: clean(body.match(/<div\b[^>]*class=["']car_detail["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? ""),
    image_urls: [...images], presentation: forSale ? "for_sale_after_auction" : archive ? "archive" : "unknown",
    high_bid: amount && amount > 0 ? { amount, currency_symbol: "$", currency: null, basis: "source_high_bid" } : null,
    // Archive, no-reserve, an offer form and a high bid never establish a sale.
    sale_price: null, sale_date: null,
  };
}

/** Follow only links actually advertised by the public catalog; never enumerate numeric ahid guesses. */
export function vicariCatalogLinks(html: string, base: string): { lots: string[]; catalogs: string[] } {
  html = visibleMarkup(html);
  const lots = new Set<string>(), catalogs = new Set<string>();
  const current = new URL(base);
  const lastLink = [...html.matchAll(/<a\b[^>]*>/gi)]
    .find(m => /\bclass=["'][^"']*\b(?:OFF)?pagination_far_right\b/.test(m[0]))?.[0];
  const lastHref = lastLink?.match(/\bhref=["']([^"']+)["']/i)?.[1];
  const lastPage = lastHref ? Number(new URL(lastHref.replace(/&amp;/g, "&"), base).searchParams.get("page")) : null;
  for (const m of html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)) {
    try {
      const u = new URL(m[1].replace(/&amp;/g, "&"), base);
      if (!/^(www\.)?vicariauction\.com$/i.test(u.hostname) || !/^https?:$/.test(u.protocol) || u.username || u.password || u.port) continue;
      const id = vicariListingId(u.href);
      if (id) { lots.add(vicariUrl(id)); continue; }
      if (!/^\/auction-house(?:\/\d+)?\/?$/.test(u.pathname) || !u.searchParams.has("ahcode") || u.searchParams.has("soldpa")) continue;
      const page = Number(u.searchParams.get("page") || "1");
      if (!Number.isInteger(page) || page < 1) continue;
      // Vicari emits a next-page anchor even beyond its declared final page.
      if (u.searchParams.get("ahcode") === current.searchParams.get("ahcode") && lastPage && page > lastPage) continue;
      const out = new URL("https://www.vicariauction.com/auction-house/");
      out.searchParams.set("ahcode", u.searchParams.get("ahcode")!);
      out.searchParams.set("page", u.searchParams.get("page") || "1");
      catalogs.add(out.href);
    } catch { /* A malformed or external navigation link is not a source target. */ }
  }
  return { lots: [...lots], catalogs: [...catalogs] };
}
