// A Broad Arrow lot page (/vehicles/<sale>_<lot>/<slug>) read from the server-rendered html alone: no Firecrawl, no markdown.
// Measured 2026-10-16 on four past lots: the title carries "<year make model> | <sale name> | ...", the body carries
// "Sold Price:" with the amount and a currency token (USD|EUR|GBP|CHF), "Lot <n>", and a schema.org Car block with the
// chassis/VIN (vehicleIdentificationNumber) and odometer (value + unitCode SMI|KMT). The block's priceCurrency says USD even
// for a euro sale, so the visible currency token is the one used. Pure; tested in lotPage.test.ts.

export interface BroadArrowLot {
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  saleName: string | null;
  lotNumber: string | null;
  vin: string | null;
  soldPrice: number | null;
  currency: string | null;
  soldPriceText: string | null;
  status: "sold" | "not_sold" | "withdrawn" | "unknown";
  odometer: { value: number; unit: "mi" | "km" } | null;
  description: string | null;
  imageUrls: string[];
}

const GALLERY_RE = /https:\/\/cdn\.dealeraccelerate\.com\/bagauction\/\d+\/\d+\/(\d+)\/([0-9]*x[0-9]*)\/[^"'\s,)<>]+/g;
const sizeRank = (size: string) => (size === "1920x1440" ? 3 : size === "790x1024" ? 2 : size === "x" ? 0 : 1);

/** A vehicles write refused because another vehicle already holds the VIN (the unique index, or the VIN trigger's message). */
export function isVinClash(message: string | null | undefined): boolean {
  return /vehicles_vin_unique|VIN \S+ already exists on vehicle|duplicate key value violates unique constraint "vehicles_vin/i.test(message ?? "");
}

/** The dealeraccelerate image id of a Broad Arrow photo URL (any size, with or without an extension), or null. */
export function galleryImageId(url: string): string | null {
  return url.match(/cdn\.dealeraccelerate\.com\/bagauction\/\d+\/\d+\/(\d+)\//)?.[1] ?? null;
}

/** The lot's photos: one URL per image id in page order, the largest size the page offers. A lot page lists each photo at
 * 790x1024, 1920x1440 and a bare size (110 ids, 775 URLs on am24_r158, 2026-10-18). */
export function lotGallery(html: string): string[] {
  const best = new Map<string, { url: string; rank: number }>();
  for (const m of html.matchAll(GALLERY_RE)) {
    const rank = sizeRank(m[2]);
    const have = best.get(m[1]);
    if (!have || rank > have.rank) best.set(m[1], { url: m[0], rank });
  }
  return [...best.values()].map((v) => v.url);
}

const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, k: string) => {
    const key = k.toLowerCase();
    const named: Record<string, string> = { amp: "&", quot: '"', lt: "<", gt: ">", apos: "'", nbsp: " " };
    if (named[key] !== undefined) return named[key];
    const n = key.startsWith("#x") ? parseInt(key.slice(2), 16) : key.startsWith("#") ? parseInt(key.slice(1), 10) : NaN;
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
  });

const textOf = (html: string) => decode(html.replace(/<script[\s\S]*?<\/script[^>]*>|<style[\s\S]*?<\/style[^>]*>|<svg[\s\S]*?<\/svg[^>]*>/gi, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

/** "123,200" | "51.750" | "1.380.000,50" | "210'000" -> a number; a lone dot followed by three digits is a thousands
 * separator, and so is an apostrophe (Swiss grouping on the Zurich sale). */
export function parseAmount(raw: string): number | null {
  const s = raw.replace(/['’]/g, "").replace(/[^\d.,]/g, "");
  if (!s) return null;
  let t = s;
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) t = s.replace(/[.,]/g, "");
  else if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) t = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(,\d{3})+\.\d{1,2}$/.test(s)) t = s.replace(/,/g, "");
  else t = s.replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** The currency of the page's "Estimate:" amounts (an unsold lot has no "Sold Price:" token), or null. */
export function estimateCurrency(html: string): string | null {
  const m = textOf(html).match(/Estimate:?\s*(CHF|USD|EUR|GBP|[$€£])/i);
  if (!m) return null;
  const t = m[1].toUpperCase();
  return t === "$" ? "USD" : t === "€" ? "EUR" : t === "£" ? "GBP" : t;
}

export function parseLotPage(html: string): BroadArrowLot {
  const titleRaw = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const parts = titleRaw.split(" | ").map((p) => p.trim());
  const title = parts[0] || null;
  const saleName = parts.length >= 3 ? parts[1] : null;
  const ym = title?.match(/^((?:18|19|20)\d{2})\s+(\S+(?:\s+(?:Benz|Martin|Romeo|Rover|Healey|Davidson))?)\s*(.*)$/);

  const body = textOf(html);
  const lot = body.match(/\bLot\s+(\d{1,5}[A-Za-z]?)\b/)?.[1] ?? null;
  const sold = body.match(/Sold Price:\s*([€£$]|CHF\s*)?\s*([\d.,'’]+)\s*(USD|EUR|GBP|CHF)?/i);
  const currency = sold ? (sold[3]?.toUpperCase() ?? (sold[1] === "€" ? "EUR" : sold[1] === "£" ? "GBP" : sold[1]?.trim().toUpperCase() === "CHF" ? "CHF" : sold[1] === "$" ? "USD" : null)) : null;
  const soldPrice = sold ? parseAmount(sold[2]) : null;

  const ld = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script[^>]*>/i)?.[1];
  let car: Record<string, any> | null = null;
  if (ld) { try { car = JSON.parse(ld); } catch { car = null; } }
  const vinRaw = typeof car?.vehicleIdentificationNumber === "string" ? car.vehicleIdentificationNumber.trim() : "";
  const odo = car?.mileageFromOdometer;
  const odoValue = odo?.value != null ? Number(String(odo.value).replace(/[^\d.]/g, "")) : NaN;
  const meta = decode(html.match(/<meta[^>]*name=['"]description['"][^>]*>/i)?.[0] ?? html.match(/<meta[^>]*content=['"]([^'"]*)['"][^>]*name=['"]description['"]/i)?.[1] ?? "");
  const desc = html.match(/<meta[^>]*content=['"]([^'"]*)['"][^>]*name=['"]description['"]/i)?.[1];

  let status: BroadArrowLot["status"] = "unknown";
  if (soldPrice) status = "sold";
  else if (/\b(withdrawn)\b/i.test(body)) status = "withdrawn";
  else if (/\b(not sold|no sale|did not sell|bid to)\b/i.test(body)) status = "not_sold";

  return {
    title,
    year: ym ? Number(ym[1]) : null,
    make: ym ? ym[2] : null,
    model: ym ? ym[3] || null : null,
    saleName,
    lotNumber: lot,
    vin: vinRaw && vinRaw.length >= 4 ? vinRaw : null,
    soldPrice, currency,
    soldPriceText: sold ? sold[0].replace(/\s+/g, " ").trim() : null,
    status,
    odometer: Number.isFinite(odoValue) && odoValue > 0 ? { value: Math.round(odoValue), unit: odo?.unitCode === "KMT" ? "km" : "mi" } : null,
    description: desc ? decode(desc).replace(/&#x000A;/g, "\n").trim() || null : (meta || null),
    imageUrls: lotGallery(html),
  };
}
