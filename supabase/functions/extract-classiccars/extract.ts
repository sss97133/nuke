// Pure parser for classiccars.com listing pages. No LLM. The page carries a schema.org "car" block (its JSON has raw
// newlines inside strings, so it is parsed leniently), an attribute panel of label/value spans, the title with the
// place ("For Sale: 1991 Chevrolet 1500 in Preston, Mississippi") and the photo folder of the listing.

export interface ClassicCarsExtracted {
  listing_id: string;
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  price: number | null;
  mileage: number | null;
  location: string | null;
  description: string | null;
  transmission: string | null;
  engine: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  body_style: string | null;
  title_status: string | null;
  seller_type: string | null;
  image_urls: string[];
  attributes: Record<string, string>;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const unescapeHtml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
const text = (html: string) => unescapeHtml(html.replace(/<(br|\/p|\/li)\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t ]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const numeric = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

function carBlock(html: string): Record<string, any> | null {
  for (const m of html.matchAll(/<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    if (!/"@type"\s*:\s*"car"/i.test(m[1])) continue;
    // Raw control characters inside JSON strings are what make the block invalid.
    const lenient = m[1].replace(/[\u0000-\u001f]+/g, " ");
    try { return JSON.parse(lenient); } catch { /* try the next block */ }
  }
  return null;
}

export function extractFromHtml(html: string, url: string): ClassicCarsExtracted {
  const car = carBlock(html);
  const canonical = clean(html.match(/<meta property="og:url" content="([^"]+)"/)?.[1]) ?? url;
  const listing_id = canonical.match(/\/listings\/view\/(\d+)/)?.[1] ?? url.match(/\/listings\/view\/(\d+)/)?.[1] ?? "";
  if (!car || !listing_id) throw new Error("no ClassicCars listing block on the page");

  const attributes: Record<string, string> = {};
  for (const m of html.matchAll(/<span class="w40 [^"]*">([^<:]{2,40}):<\/span>\s*<span class="[^"]*gray[^"]*">([\s\S]*?)<\/span>/g)) {
    const v = text(m[2]);
    if (v) attributes[m[1].trim()] = v;
  }

  const listedBy = clean(html.match(/<b>Listed By:<\/b>\s*<div[^>]*aria-label="Seller or Company Name"[^>]*>([^<]+)</)?.[1]);
  const ogTitle = html.match(/<meta property="og:title" content="For Sale: [^"]* in ([^"]+)"/)?.[1];
  const place = clean(ogTitle ? unescapeHtml(ogTitle) : null);

  // Photos: the listing's own folder (e.g. /listing/211/8864/), full-size "-std" images, in page order.
  const first = html.match(/<meta property="og:image" content="(https:\/\/photos\.classiccars\.com\/[^"]*\/listing\/\d+\/\d+\/)/)?.[1];
  const images: string[] = [];
  if (first) for (const m of html.matchAll(/https:\/\/photos\.classiccars\.com\/[^"'\s<>]+-std\.(?:jpg|jpeg|png)/g)) {
    if (m[0].startsWith(first) && !images.includes(m[0])) images.push(m[0]);
  }

  const offers = car.offers ?? {};
  const year = Number.parseInt(String(car.productionDate ?? ""), 10);
  return {
    listing_id,
    url: canonical,
    title: clean(car.name),
    year: Number.isFinite(year) ? year : null,
    make: clean(car.brand),
    model: clean(car.model),
    vin: clean(car.vehicleIdentificationNumber) ?? clean(attributes["VIN"]),
    price: numeric(offers.price),
    mileage: numeric(car.mileageFromOdometer?.value ?? attributes["Odometer"]),
    location: place,
    description: clean(text(unescapeHtml(String(car.description ?? "")))),
    transmission: clean(attributes["Transmission"]),
    engine: clean(attributes["Engine Size"]),
    exterior_color: clean(car.color) ?? clean(attributes["Exterior Color"]),
    interior_color: clean(car.vehicleInteriorColor) ?? clean(attributes["Interior Color"]),
    body_style: clean(car.bodyType) ?? clean(attributes["Body Style"]),
    title_status: clean(attributes["Title Status"]),
    seller_type: listedBy ? unescapeHtml(listedBy) : null,
    image_urls: images,
    attributes,
  };
}
