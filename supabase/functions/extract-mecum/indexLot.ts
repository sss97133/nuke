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
  return {
    lot: {
      url: `https://www.mecum.com${permalink}`,
      lot_id: lotId,
      object_id: hit.objectID ?? null,
      title: typeof hit.post_title === "string" ? hit.post_title : null,
      year,
      make,
      model: termName(t, "model"),
      result,
      price: result ? price : null,
      run_day: runDay && /^\d{4}-\d{2}-\d{2}$/.test(runDay) ? runDay : null,
      day_start: dayStart && !isNaN(Date.parse(dayStart.replace(" ", "T") + "Z")) ? new Date(dayStart.replace(" ", "T") + "Z").toISOString() : null,
      lot_number: typeof hit.lot_number_meta === "string" && hit.lot_number_meta ? hit.lot_number_meta : null,
      sale_key: parsed?.sale_key ?? null,
      sale_name: parsed?.auction_name ?? null,
      sale_starts_on: parsed?.sale_starts_on ?? null,
      sale_ends_on: parsed?.sale_ends_on ?? null,
      lot_statuses: (Array.isArray(t.lot_status) ? t.lot_status : []).map((x: any) => x?.slug).filter(Boolean),
    },
  };
}

