/**
 * Pure readers for Mecum's public lot index (Algolia wp_posts_lot): the sale named by an auction_tax facet value, and one
 * index record as a lot with the sale facts it states. No request and no write here.
 */

export const saleDay = (epochSeconds: number) => new Date(epochSeconds * 1000).toISOString().slice(0, 10);

/** The sale a facet value "Name|startEpoch|endEpoch" names. The slug comes from the hit's auction_tax term. */
export function parseSaleFacet(value: string, slug: string): { sale_key: string; auction_name: string; sale_starts_on: string; sale_ends_on: string; end_epoch: number } | null {
  const [name, start, end] = value.split("|");
  const startEpoch = Number(start), endEpoch = Number(end);
  if (!name || !slug || !Number.isFinite(startEpoch) || !Number.isFinite(endEpoch)) return null;
  return { sale_key: slug, auction_name: name, sale_starts_on: saleDay(startEpoch), sale_ends_on: saleDay(endEpoch), end_epoch: endEpoch };
}


// ─── Index-sourced thin landing ─────────────────────────────────────────

/** One lot of Mecum's public search index (Algolia wp_posts_lot), reduced to the sale facts it states. */
export interface IndexLot {
  url: string;
  lot_id: string;
  object_id: string | null;
  title: string | null;
  year: number;
  make: string;
  model: string | null;
  result: "sold" | "bid-goes-on" | null;
  price: number | null; // the hammer on a sold lot, the high bid otherwise; null when the index states none
  run_day: string | null;
  day_start: string | null;
  lot_number: string | null;
  sale_key: string | null;
  sale_name: string | null;
  sale_starts_on: string | null;
  sale_ends_on: string | null;
  lot_statuses: string[];
  image_urls: string[];
  exterior_color: string | null;
  interior_color: string | null;
  transmission: string | null;
  engine: string | null;
  collection_name: string | null;
  description: string | null;
}

export const INDEX_VEHICLE_TYPES = new Set(["Auto", "Motorcycle", "Tractor", "Boat"]);

/** First taxonomy term's name (or its slug) from an index record, tolerant of a missing or odd shape. */
export function termName(t: any, key: string, field: "name" | "slug" = "name"): string | null {
  const v = t?.[key];
  const x = Array.isArray(v) ? v[0] : null;
  const out = x && typeof x === "object" ? x[field] : x;
  return out === undefined || out === null || out === "" ? null : String(out);
}

/** An index record as an IndexLot, or the reason it is not one. Pure: no request, no write. */
export function indexLot(hit: any): { lot: IndexLot } | { skip: string; url?: string; title?: string } {
  const t = hit?.taxonomies;
  if (!t || typeof t !== "object") return { skip: "no_taxonomies" };
  const lotType = termName(t, "lot_type");
  if (!lotType || !INDEX_VEHICLE_TYPES.has(lotType)) return { skip: "not_a_vehicle_type" };
  const permalink = typeof hit.permalink === "string" ? hit.permalink : "";
  const lotId = permalink.match(/\/lots\/([A-Za-z0-9-]+)\//)?.[1];
  if (!lotId) return { skip: "no_lot_id" };
  const year = Number(termName(t, "lot_year"));
  const make = termName(t, "make");
  if (!Number.isInteger(year) || year < 1885 || year > 2100 || !make) return { skip: "no_year_make", url: `https://www.mecum.com${permalink}`, title: typeof hit.post_title === "string" ? hit.post_title : undefined };
  const resultName = termName(t, "sale_result", "slug");
  const result = hit.sold === 1 || resultName === "sold" ? "sold" : (hit.bid_goes_on === 1 || resultName === "bid-goes-on" ? "bid-goes-on" : null);
  const rawPrice = Number(hit.highest_bid_or_price);
  const price = Number.isFinite(rawPrice) && rawPrice > 0 ? Math.round(rawPrice) : null;
  const sale = Array.isArray(t.auction_tax) ? t.auction_tax[0] : null;
  const parsed = sale?.name && sale?.slug ? parseSaleFacet(String(sale.name), String(sale.slug)) : null;
  const runDay = termName(t, "run_date");
  const dayStart = typeof hit.auction_day_start_meta === "string" ? hit.auction_day_start_meta : null;
  const title = typeof hit.post_title === "string" && hit.post_title.trim() ? hit.post_title.trim() : null;
  const lotNumber = typeof hit.lot_number_meta === "string" && hit.lot_number_meta ? hit.lot_number_meta : null;
  const imageUrls = Array.isArray(hit.images_meta)
    ? hit.images_meta.map((img: any) => (typeof img?.url === "string" ? img.url.trim() : "")).filter((u: string) => u.startsWith("http"))
    : [];
  const exteriorColor = typeof hit.color_meta === "string" && hit.color_meta.trim() ? hit.color_meta.trim() : null;
  const interiorColor = typeof hit.interior_meta === "string" && hit.interior_meta.trim() ? hit.interior_meta.trim() : null;
  const transmission = typeof hit.transmission_type_meta === "string" && hit.transmission_type_meta.trim() ? hit.transmission_type_meta.trim() : null;
  const engine = typeof hit.lot_series_meta === "string" && hit.lot_series_meta.trim()
    ? hit.lot_series_meta.trim()
    : (typeof hit.engine_configuration_meta === "string" && hit.engine_configuration_meta.trim() ? hit.engine_configuration_meta.trim() : null);
  const collectionRaw = termName(t, "collection_tax");
  const collectionName = collectionRaw ? collectionRaw.split("|")[0].replace(/&amp;/g, "&").trim() || null : null;
  const descParts = [
    title,
    engine ? `Highlights: ${engine}.` : null,
    parsed?.auction_name ? `Offered at Mecum ${parsed.auction_name}${lotNumber ? ` (Lot ${lotNumber})` : ""}.` : null,
    collectionName ? `Collection: ${collectionName}.` : null,
  ].filter(Boolean);
  const description = descParts.length > 1 ? descParts.join(" ") : null;

  return {
    lot: {
      url: `https://www.mecum.com${permalink}`,
      lot_id: lotId,
      object_id: hit.objectID ?? null,
      title,
      year,
      make,
      model: termName(t, "model"),
      result,
      price: result ? price : null,
      run_day: runDay && /^\d{4}-\d{2}-\d{2}$/.test(runDay) ? runDay : null,
      day_start: dayStart && !isNaN(Date.parse(dayStart.replace(" ", "T") + "Z")) ? new Date(dayStart.replace(" ", "T") + "Z").toISOString() : null,
      lot_number: lotNumber,
      sale_key: parsed?.sale_key ?? null,
      sale_name: parsed?.auction_name ?? null,
      sale_starts_on: parsed?.sale_starts_on ?? null,
      sale_ends_on: parsed?.sale_ends_on ?? null,
      lot_statuses: (Array.isArray(t.lot_status) ? t.lot_status : []).map((x: any) => x?.slug).filter(Boolean),
      image_urls: imageUrls,
      exterior_color: exteriorColor,
      interior_color: interiorColor,
      transmission,
      engine,
      collection_name: collectionName,
      description,
    },
  };
}


// ─── Prior sale of a series ─────────────────────────────────────────────

/**
 * A sale's series, so a renamed series still matches its past sales: "Dallas 2024" and "Dallas/Fort Worth 2026" are one series,
 * and so are "Las Vegas Motorcycles 2026" and "LV Motorcycles 2027". The year is dropped and the name is reduced to letters.
 */
export function seriesKey(saleName: string): string {
  return saleName.toLowerCase()
    .replace(/\s+\d{4}$/, "")
    .replace(/\/?\s*fort worth/, "")
    .replace(/^lv\b/, "las vegas")
    .replace(/[^a-z0-9]/g, "");
}

/** The sale facet values ("Name|startEpoch|endEpoch") of the same series that ended before this one started: the latest first. */
export function priorSaleFacet(upcoming: string, all: string[]): string | null {
  const [name, start] = upcoming.split("|");
  const startEpoch = Number(start);
  if (!name || !Number.isFinite(startEpoch)) return null;
  const key = seriesKey(name);
  let best: { value: string; end: number } | null = null;
  for (const value of all) {
    const [n, , e] = value.split("|");
    const end = Number(e);
    if (!n || !Number.isFinite(end) || end >= startEpoch || seriesKey(n) !== key) continue;
    if (!best || end > best.end) best = { value, end };
  }
  return best?.value ?? null;
}

export interface PriorSale {
  sale_key: string | null;
  lots: number;
  vehicle_lots: number;
  sold: number;
  bid_goes_on: number;
  median_price: number | null;
  priced: number;
  ends_on: string;
}

/** Vehicle lots are every lot that is not Road Art. Sold and bid-goes-on count vehicle lots; the median is of sold lots with a stated price. */
export function summarizePriorSale(hits: any[], saleKey: string | null, endsOn: string): PriorSale {
  const vehicle = hits.filter((h) => termName(h?.taxonomies, "lot_type") !== "Road Art");
  const sold = vehicle.filter((h) => h?.sold === 1);
  const prices = sold.map((h) => Number(h?.highest_bid_or_price)).filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  const mid = prices.length >> 1;
  const median = prices.length === 0 ? null : (prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2);
  return {
    sale_key: saleKey,
    lots: hits.length,
    vehicle_lots: vehicle.length,
    sold: sold.length,
    bid_goes_on: vehicle.filter((h) => h?.bid_goes_on === 1).length,
    median_price: median,
    priced: prices.length,
    ends_on: endsOn,
  };
}
