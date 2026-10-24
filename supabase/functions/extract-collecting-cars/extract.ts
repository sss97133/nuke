// Pure parser for collectingcars.com lot pages. No LLM: the Next.js flight payload carries the whole lot object
// (identity, VIN, odometer, colours, engine, publish/stage clocks, the full image list and the lot description).
// The page is fetched through Firecrawl (rawHtml: the site refuses datacenter addresses and the "html" format strips
// the script payload), so every parsed page costs one credit; archiveFetch keeps the page in listing_page_snapshots.

export interface CollectingCarsExtracted {
  listing_id: string;
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  vin: string | null;
  /** Price in the lot's own currency; `price` is set only when that currency is USD. */
  price: number | null;
  price_amount: number | null;
  currency: string | null;
  /** sold: hammer (stage sold); high_bid: the last bid of an ended lot that did not sell; current_bid: a live lot. */
  price_kind: "current_bid" | "high_bid" | "sold" | null;
  /** What the page says happened: sold, unsold, sealed_unsold (sealed-bid lot, no sale), live, or null. */
  sale_outcome: "sold" | "unsold" | "sealed_unsold" | "live" | null;
  sold_at: string | null;
  mileage: number | null;
  mileage_unit: "mi" | "km" | null;
  mileage_raw: string | null;
  location: string | null;
  description: string | null;
  transmission: string | null;
  engine: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  body_style: string | null;
  seller_name: string | null;
  lot_type: string | null;
  stage: string | null;
  bid_count: number | null;
  image_urls: string[];
  posted_at: string | null;
  auction_end_at: string | null;
}

export function flightText(html: string): string {
  let out = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try { out += JSON.parse(m[1]); } catch { /* skip a chunk that is not a JSON string */ }
  }
  return out;
}

function balanced(s: string, start: number): string | null {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

/** A flight row `3f:Taa1,text` is a text chunk of 0xaa1 UTF-8 bytes; a field holds "$3f" to point at it. */
function resolveRef(flight: string, ref: string): string | null {
  const id = ref.slice(1);
  const m = new RegExp(`(?:^|\\n)${id}:T([0-9a-f]+),`).exec(flight);
  if (!m) return null;
  const bytes = parseInt(m[1], 16);
  const body = flight.slice(m.index + m[0].length);
  return new TextDecoder().decode(new TextEncoder().encode(body.slice(0, bytes * 2)).slice(0, bytes));
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** Drop everything between "<" and ">" with a scan, not a regex: a stray "<" inside text cannot leave a tag behind. */
const stripTags = (html: string): string => {
  let out = "", depth = 0;
  for (const ch of html) {
    if (ch === "<") depth++;
    else if (ch === ">" && depth > 0) depth--;
    else if (depth === 0) out += ch;
  }
  return out;
};
const plain = (html: string) =>
  stripTags(html.replace(/<\/(p|li|h\d)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n"))
    .replace(/&(#\d+|[a-z]+);/gi, (m, e: string) => e[0] === "#" ? String.fromCodePoint(parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()] ?? m)
    .replace(/[ \t\u00a0]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

const clean = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const int = (v: unknown): number | null => { const n = Number.parseInt(String(v ?? ""), 10); return Number.isFinite(n) ? n : null; };
const iso = (v: unknown): string | null => {
  const m = typeof v === "string" ? v.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/) : null;
  return m ? `${m[1]}T${m[2]}.000Z` : null;
};

export function extractFromHtml(html: string, url: string): CollectingCarsExtracted {
  const flight = flightText(html);
  const at = flight.search(/\{"auctionId":"\d+","stage":/);
  const raw = at >= 0 ? balanced(flight, at) : null;
  if (!raw) throw new Error("no Collecting Cars lot payload on the page");
  const L = JSON.parse(raw);

  const ref = (v: unknown) => typeof v === "string" && /^\$[0-9a-f]+$/.test(v) ? resolveRef(flight, v) : clean(v);
  const english = (L.descriptions ?? []).find((d: any) => d?.languageCode === "en");
  const descRaw = ref(english?.description) ?? ref(L.description);

  const mileageRaw = clean(L.mileage);
  const mileageNum = mileageRaw ? int(mileageRaw.replace(/,/g, "").match(/\d+/)?.[0]) : null;
  const unit = mileageRaw ? (/km|kilomet/i.test(mileageRaw) ? "km" : /mi/i.test(mileageRaw) ? "mi" : null) : null;

  // The backfilled Collecting Cars sales (488 rows, audited 2026-10-23) were wrong in all three ways this guards: a bid read
  // mid-auction kept as the price, an unsold or sealed-bid lot called sold, and a native-currency amount stored as dollars.
  // A sale is the page's stage "sold" with priceSold; an ended lot without it is a high bid, never a price.
  const stage = clean(L.stage)?.toLowerCase() ?? null;
  const sold = (stage === null || stage === "sold") && L.priceSold != null && Number(L.priceSold) > 0;
  const ended = stage !== null && stage !== "live" && stage !== "comingsoon" && !sold;
  const amount = sold ? Number(L.priceSold) : Number(L.currentBid) > 0 ? Number(L.currentBid) : null;
  const sealed = clean(L.saleFormat)?.toLowerCase() === "sealed";
  const outcome: CollectingCarsExtracted["sale_outcome"] = sold ? "sold" : ended ? (sealed ? "sealed_unsold" : "unsold") : stage === "live" ? "live" : null;
  const kind: CollectingCarsExtracted["price_kind"] = amount === null ? null : sold ? "sold" : ended ? "high_bid" : "current_bid";
  const currency = clean(L.currencyCode)?.toUpperCase() ?? null;

  const images: string[] = [];
  for (const img of L.images ?? []) {
    const u = clean(img?.url);
    if (u && !images.includes(u)) images.push(u);
  }
  const slug = url.match(/\/for-sale\/([^/?#]+)/)?.[1];
  const place = [clean(L.areaName), clean(L.countryName)].filter(Boolean).join(", ") || null;
  const bodyStyle = (L.productAttributes ?? []).find((a: any) => a?.attributeName === "bodyStyle")?.attributeValue;

  return {
    listing_id: String(L.auctionId),
    url: slug ? `https://collectingcars.com/for-sale/${slug}` : url,
    title: clean(L.title),
    year: int(L.modelYear),
    make: clean(L.makeName) ?? clean(L.productMake),
    model: clean(L.modelName),
    trim: clean(L.variantName),
    vin: clean(L.vin),
    price: currency === "USD" && kind !== "high_bid" ? amount : null,
    price_amount: amount,
    currency,
    price_kind: kind,
    sale_outcome: outcome,
    sold_at: sold ? iso(L.dtSoldUTC) : null,
    mileage: mileageNum && unit === "mi" ? mileageNum : mileageNum && unit === "km" ? Math.round(mileageNum * 0.621371) : null,
    mileage_unit: unit,
    mileage_raw: mileageRaw,
    location: place,
    description: descRaw ? clean(plain(descRaw)) : null,
    transmission: clean(L.transmission),
    engine: clean(L.engineSize),
    exterior_color: clean(L.colourExterior),
    interior_color: clean(L.colourInterior),
    body_style: clean(bodyStyle),
    seller_name: clean(L.vendorNickName),
    lot_type: clean(L.lotType),
    stage: clean(L.stage),
    bid_count: int(L.noBids),
    image_urls: images,
    posted_at: iso(L.dtPublishedUTC),
    auction_end_at: iso(L.dtAuctionEndUTC),
  };
}
