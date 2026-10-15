/**
 * Parse a Barn Finds post (WordPress article) into everything the page exposes.
 *
 * A Barn Finds post is an editorial write-up of a car listed elsewhere (eBay, Craigslist, Facebook...), not a listing of
 * its own. So: the price is the seller's price quoted in the prose, the place is where the seller listed it, the "Barn
 * Finder" credited is the tipster (not the seller), and the post date is not the listing's start. Each is kept as
 * attributed testimony; nothing is invented when the prose does not say.
 */

export interface BarnFindsComment {
  id: string;
  author: string | null;
  member: boolean;
  postedText: string | null; // as shown, e.g. "Feb 1, 2026 9:49pm"
  postedAtAssumedUtc: string | null; // the shown time read as UTC: the site does not state its zone, so this can be hours off
  likes: number | null;
  depth: number;
  text: string;
  html: string;
}

export interface BarnFindsPost {
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  articleText: string;
  askingPrice: number | null;
  priceText: string | null;
  obo: boolean;
  location: string | null;
  listingPlatform: string | null;
  tipster: string | null;
  publishedAt: string | null;
  modifiedAt: string | null;
  imageUrls: string[];
  comments: BarnFindsComment[];
}

const TWO_WORD_MAKES = ["Alfa Romeo", "Land Rover", "Aston Martin", "Rolls Royce", "Rolls-Royce", "Austin Healey", "Austin-Healey", "De Tomaso", "Mercedes Benz", "Mercedes-Benz", "Am General", "AM General", "International Harvester", "Shelby American"];

const ENTITIES: Record<string, string> = { amp: "&", nbsp: " ", quot: '"', apos: "'", lt: "<", gt: ">", ldquo: '"', rdquo: '"', lsquo: "'", rsquo: "'", ndash: "-", mdash: "-", hellip: "..." };

export function decodeEntities(s: string): string {
  // One pass, so "&amp;lt;" cannot become "<".
  return s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, dec, hex, name) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return ENTITIES[String(name).toLowerCase()] ?? m;
  });
}

/** Remove tags until none remain, so a nested fragment cannot reassemble one. */
export function stripTags(input: string): string {
  let out = input;
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out.replace(/<[^>]*>/g, " ");
  }
  return out.replace(/[<>]/g, "");
}

function stripScripts(input: string): string {
  let out = input;
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  }
  return out;
}

/** Site widgets that sit among the paragraphs, e.g. "1971 Chevrolet Corvette Convertible Bid Now 6 days $100" (an auction teaser). */
export function isWidgetText(t: string): boolean {
  return /\bBid Now\b|Auctions Ending Soon|View All Auctions|\bAdvertisement\b/i.test(t);
}

const clean = (s: string) => decodeEntities(stripTags(s)).replace(/\s+/g, " ").trim();

/** Year, make and model from a headline such as "Mild Build 350 V8: 1989 Chevrolet C1500". */
export function identityFromTitle(title: string | null): { year: number | null; make: string | null; model: string | null } {
  if (!title) return { year: null, make: null, model: null };
  const m = title.match(/(?<!\d)((?:18|19|20)\d{2})(?!\d)\s*(.*)$/);
  if (!m) return { year: null, make: null, model: null };
  const year = Number(m[1]);
  const rest = m[2].replace(/^[-:,\s]+/, "").trim();
  if (!rest) return { year, make: null, model: null };
  const two = TWO_WORD_MAKES.find((mk) => rest.toLowerCase().startsWith(mk.toLowerCase() + " ") || rest.toLowerCase() === mk.toLowerCase());
  const make = two ?? rest.split(/\s+/)[0];
  const model = rest.slice(make.length).trim() || null;
  return { year, make, model };
}

/** The seller's price quoted in the prose: "set their price at $107,000 OBO", "asking $12,500". */
export function priceFromText(text: string): { price: number | null; priceText: string | null; obo: boolean } {
  const m = text.match(/\b(?:price|asking|asks?|listed (?:for|at))\b[^$.]{0,50}\$\s?(\d{1,3}(?:,\d{3})+|\d{3,7})(?!\d)([^.]{0,12})/i);
  if (!m) return { price: null, priceText: null, obo: false };
  const price = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(price) || price < 100) return { price: null, priceText: null, obo: false };
  return { price, priceText: `$${m[1]}${m[2] ?? ""}`.trim(), obo: /\bOBO\b|or best offer/i.test(m[2] ?? "") };
}

/** "listed here on eBay in Concord, North Carolina": the platform and the place the seller gave. */
export function listingFromText(text: string): { platform: string | null; location: string | null } {
  const platform = text.match(/\b(?:on|via|through)\s+(eBay|Craigslist|Facebook(?: Marketplace)?|Hemmings|Bring a Trailer|BaT|Cars? ?& ?Bids|AutoTrader|ClassicCars\.com|OfferUp|Hagerty Marketplace|Copart|IAA)\b/i)?.[1] ?? null;
  const loc = text.match(/\b(?:listed|located|offered|advertised|for sale)\b[^.]{0,80}?\bin ([A-Z][A-Za-z.'’ -]{1,30}, (?:[A-Z]{2}\b|[A-Z][a-z]+(?: [A-Z][a-z]+)?))/);
  return { platform, location: loc ? loc[1].trim() : null };
}

function jsonLd(html: string): Record<string, any>[] {
  const out: Record<string, any>[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const v = JSON.parse(m[1]);
      for (const n of Array.isArray(v) ? v : (v["@graph"] ?? [v])) if (n && typeof n === "object") out.push(n);
    } catch { /* not JSON */ }
  }
  return out;
}

function entryContent(html: string): string {
  const start = html.search(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>/i);
  if (start < 0) return "";
  const rest = html.slice(start);
  const end = rest.search(/<div[^>]*(?:id="comments"|class="[^"]*(?:post-tags|sharing|author-box)[^"]*")|<\/article>/i);
  return end > 0 ? rest.slice(0, end) : rest;
}

export function imageUrls(content: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of content.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = tag.match(/\bdata-(?:lazy-)?src=["']([^"']+)["']/i)?.[1] ?? tag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
    if (!src || !/\/wp-content\/uploads\//.test(src) || /avatar|thumb\.gif|\/emoji|logo/i.test(src)) continue;
    const full = decodeEntities(src).replace(/-\d{2,4}x\d{2,4}(?=\.\w+(?:\?|$))/, "").replace(/-e\d{10,}(?=\.\w+(?:\?|$))/, "");
    if (!seen.has(full)) { seen.add(full); out.push(full); }
  }
  return out;
}

export function shownTimeAsUtc(text: string | null): string | null {
  const m = text?.match(/([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2})\s*([ap]m)/i);
  if (!m) return null;
  const mon = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[1].toLowerCase());
  if (mon < 0) return null;
  let h = Number(m[4]) % 12;
  if (m[6].toLowerCase() === "pm") h += 12;
  return new Date(Date.UTC(Number(m[3]), mon, Number(m[2]), h, Number(m[5]))).toISOString();
}

export function parseComments(html: string): BarnFindsComment[] {
  const area = html.slice(Math.max(html.indexOf('<div id="comments"'), 0));
  const out: BarnFindsComment[] = [];
  const re = /<div id="comment-(\d+)" class="comment[^"]*?depth-(\d+)[^"]*"[^>]*>([\s\S]*?)<div class="comment-content">([\s\S]*?)<div class="cld-like-dislike-wrap/gi;
  for (const m of area.matchAll(re)) {
    const head = m[3];
    const body = m[4];
    const text = clean(body);
    if (!text) continue;
    const tail = area.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 600);
    const postedText = clean(head.match(/class="comment-meta[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "") || null;
    const likes = tail.match(/cld-count-wrap">\s*(\d+)/)?.[1];
    out.push({
      id: m[1],
      author: clean(head.match(/<cite[^>]*>([\s\S]*?)<\/cite>/i)?.[1] ?? "") || null,
      member: /member-tag/.test(head),
      postedText,
      postedAtAssumedUtc: shownTimeAsUtc(postedText),
      likes: likes != null ? Number(likes) : null,
      depth: Number(m[2]),
      text,
      html: m[0],
    });
  }
  return out;
}

export function parseBarnFindsPost(htmlRaw: string): BarnFindsPost {
  const html = htmlRaw;
  const ld = jsonLd(html);
  const article = ld.find((n) => String(n["@type"]).includes("Article")) ?? {};
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = clean(String(article.headline ?? h1 ?? "")) || null;
  const content = entryContent(stripScripts(html));
  const paragraphs = [...content.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((p) => clean(p[1])).filter((t) => t && !/^Disclosure:/i.test(t) && !isWidgetText(t));
  const articleText = paragraphs.join("\n\n");
  const id = identityFromTitle(title);
  const { price, priceText, obo } = priceFromText(articleText);
  const { platform, location } = listingFromText(articleText);
  const vin = articleText.match(/\b(?:VIN|chassis|serial)(?:\s*(?:#|number|no\.?))?\s*[:#]?\s*([A-HJ-NPR-Z0-9]{17})\b/i)?.[1]?.toUpperCase() ?? null;
  const tipster = articleText.match(/Barn Finder\s+([A-Z][\w.'-]+)/)?.[1] ?? null;
  return {
    title, ...id, vin, articleText, askingPrice: price, priceText, obo, location, listingPlatform: platform, tipster,
    publishedAt: article.datePublished ?? html.match(/article:published_time" content="([^"]+)"/)?.[1] ?? null,
    modifiedAt: article.dateModified ?? html.match(/article:modified_time" content="([^"]+)"/)?.[1] ?? null,
    imageUrls: imageUrls(content),
    comments: parseComments(html),
  };
}
