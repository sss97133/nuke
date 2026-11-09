/**
 * Christie's lots from the site's own results JSON, mapped to the `record_asset_lots` writer's input (the same record the
 * Bonhams art walk writes, see ../extract-bonhams-typesense/artLot.ts). Pure: no network, no database.
 *
 * Reads (verified 2026-11-08, public, no key):
 *   calendar  GET https://www.christies.com/api/discoverywebsite/auctioncalendar/auctionresults?language=en&month=M&year=Y
 *             -> events[] { event_id, filter_ids "|category_7|location_36|event_0||event_live|", title_txt,
 *                subtitle_txt "Live Auction 24260 | CLOSED", landing_url, location_txt, sale_total_value_txt }
 *   lots      GET https://www.christies.com/api/discoverywebsite/auctionpages/lotsearch?action=paging&language=en&page=N
 *                 &pagesize=100&saleid={event_id}&salenumber={sale number}&saletype=Sale&sortby=LotNumber
 *             -> lots[] + total_hits_filtered
 *
 * Every field is the house's claim, kept as printed.
 *
 * Price realised: hammer price plus buyer's premium. Christie's 2025 year-end release (17 December 2025), Notes to Editors:
 * "Estimates do not include buyer's premium. Sales totals are hammer price plus buyer's premium."
 *   https://press.christies.com/62b-projected-global-sales-in-2025/
 *   https://press.christies.com/wp-content/uploads/2025/12/e711cb9b6180e212a569ebb6e3f3045f.pdf
 * The release states it for totals; the per-lot "Price realised" on the saved lot pages (lot-6609192.html GBP 588,800,
 * lot-6609196.html GBP 3,262,000) is exactly a whole hammer under the printed 1 September 2026 London schedule (460,000 and
 * 2,600,000), which the tests check. So the figure is carried in the writer's hammer_premium slot (hammer plus premium) with
 * price_semantics citing the release, never in hammer_price; no hammer is backed out or stored. Whether a guarantor's financing
 * fee is netted from it is not stated by the release (not claimed).
 * The premium schedule in force is attached as printed (premium_schedule) when the sale site and date fall under a schedule
 * saved from the house's own page (financial-information.html, effective 1 September 2026); older sales carry none.
 *
 * NEEDS SOURCE PROOF (still open): whether a closed lot with a printed price realised is "sold" (result stays
 * unresolved:PRICE_REALISED) and whether an unpriced closed lot is unsold or price-withheld (result unknown). The lot header
 * JSON carries an is_unsold flag; it is not yet proven against a house statement and is not used.
 */

import { type LotHeader, type PrintedSymbol, symbolLabels } from "./christiesPage.ts";

/** Christie's calendar categories that hold artworks, in the order a sale with several takes its department. */
export const ART_CATEGORIES: Record<string, string> = {
  category_7: "Fine Art",
  category_11: "Photographs & Prints",
  category_5: "Asian Art",
};

export const CHRISTIES_LOT_METHOD = "christies_results_json_v1";

export const PRICE_SEMANTICS = {
  label_as_printed: "Price realised",
  reading: "hammer_plus_buyers_premium",
  source_url: "https://press.christies.com/62b-projected-global-sales-in-2025/",
  source_pdf: "https://press.christies.com/wp-content/uploads/2025/12/e711cb9b6180e212a569ebb6e3f3045f.pdf",
  source_date: "2025-12-17",
  source_quote: "Sales totals are hammer price plus buyer's premium.",
} as const;

/**
 * Buyer's premium schedules as printed by the house, newest first. Each is the parse of a saved public page
 * (christiesPage.premiumScheduleRows; the test re-parses the saved page and requires equality). Rates apply to the hammer
 * price in bands, excluding local sales taxes. Wine and Gooding have their own schedules and are not art slices here.
 */
export const PREMIUM_SCHEDULES = [{
  schedule: "all_collecting_categories_except_wine_and_gooding",
  effective_from: "2026-09-01",
  effective_txt: "1 September 2026",
  source_url: "https://www.christies.com/en/help/buying-guide-important-information/financial-information",
  read_at: "2026-11-09",
  rows: [
    { site: "London", rates: ["28.0%", "22.0%", "15.0%"], thresholds: ["Up to £1,500,000", "£1,500,001 to £6,000,000", "£6,000,001 and Above"] },
    { site: "New York", rates: ["28.0%", "22.0%", "15.0%"], thresholds: ["Up to $2,000,000", "$2,000,001 to $8,000,000", "$8,000,001 and Above"] },
    { site: "Hong Kong", rates: ["28.0%", "22.0%", "15.0%"], thresholds: ["Up to HK$15,000,000", "HK$15,000,001 to HK$60,000,000", "HK$60,000,001 and Above"] },
    { site: "Paris", rates: ["28.0%", "22.0%", "15.0%"], thresholds: ["Up to €1,750,000", "€1,750,001 to €7,000,000", "€7,000,001 and Above"] },
    { site: "Geneva", rates: ["28.0%", "22.0%", "15.0%"], thresholds: ["Up to CHF 1,600,000", "CHF 1,600,001 to CHF 7,000,000", "CHF 7,000,001 and Above"] },
    { site: "Shanghai", rates: ["28.0%", "22.0%", "15.0%"], thresholds: ["Up to CNY 10,000,000", "CNY 10,000,001 to CNY 50,000,000", "CNY 50,000,001 and Above"] },
    { site: "Dubai", rates: ["28.0%", "22.0%", "15.0%"], thresholds: ["Up to $2,000,000", "$2,000,001 to $8,000,000", "$8,000,001 and Above"] },
    { site: "Abu Dhabi", rates: ["28.0%", "22.0%", "15.0%"], thresholds: ["Up to $2,000,000", "$2,000,001 to $8,000,000", "$8,000,001 and Above"] },
  ],
}] as const;

export interface PremiumScheduleApplied {
  schedule: string; effective_from: string; effective_txt: string; site: string; rates: string[]; thresholds: string[];
  basis: "on_hammer_price_in_bands_excluding_local_taxes"; source_url: string; read_at: string;
}

/** The printed schedule in force for a sale site on a sale date, or null (site not printed, or before every saved schedule). */
export function premiumScheduleFor(site: string | undefined, saleDate: string | null): PremiumScheduleApplied | null {
  if (!site || !saleDate) return null;
  for (const s of PREMIUM_SCHEDULES) {
    if (saleDate.slice(0, 10) < s.effective_from) continue;
    const row = s.rows.find((r) => r.site === site.trim());
    if (!row) return null;
    return { schedule: s.schedule, effective_from: s.effective_from, effective_txt: s.effective_txt, site: row.site, rates: [...row.rates],
      thresholds: [...row.thresholds], basis: "on_hammer_price_in_bands_excluding_local_taxes", source_url: s.source_url, read_at: s.read_at };
  }
  return null;
}

export interface ChristiesEvent {
  event_id: string;
  filter_ids?: string;
  landing_url?: string;
  title_txt?: string;
  subtitle_txt?: string;
  location_txt?: string;
  sale_total_value_txt?: string;
}

export interface ChristiesLot {
  object_id: string;
  lot_id_txt?: string;
  analytics_id?: string;
  start_date?: string;
  end_date?: string;
  url?: string;
  is_auction_over?: boolean;
  is_in_progress?: boolean;
  title_primary_txt?: string;
  title_secondary_txt?: string;
  description_txt?: string;
  image?: { image_src?: string };
  estimate_low?: string;
  estimate_high?: string;
  estimate_txt?: string;
  lot_withdrawn?: boolean;
  price_realised?: string;
  price_realised_txt?: string;
  current_bid?: string;
  current_bid_txt?: string;
}

/** The same record shape artLot.ts produces for Bonhams (record_asset_lots reads these keys). */
export interface ChristiesLotRecord {
  identity_key: string;
  asset_type: "artwork";
  title: string;
  source_identifier: string;
  source_url: string;
  observed_at: string;
  observed_at_basis: "sale_end" | "index_read";
  department_code: string;
  department_name: string;
  house_group: "christies";
  lot_number: string | null;
  sale_key: string | null;
  sale_name: string | null;
  sale_ends_at: string | null;
  result: "withdrawn" | "upcoming" | "unknown" | "unresolved:PRICE_REALISED";
  price_basis: "price_realised" | null;
  /** What the printed price is, with the house statement it rests on; null when no price is printed. */
  price_semantics: typeof PRICE_SEMANTICS | null;
  /** The buyer's premium schedule in force for this sale, as printed; null when not saved for the sale's site and date. */
  premium_schedule: PremiumScheduleApplied | null;
  hammer_price: null;
  hammer_premium: number | null;
  high_bid: number | null;
  estimate_low: number | null;
  estimate_high: number | null;
  currency: string | null;
  lines: string[];
  /** From the lot page only (gated read, see withLotPage): display labels, the printed objects, and where they came from. */
  symbols?: string[];
  symbols_printed?: PrintedSymbol[];
  symbols_basis?: "lot_page_symbols_list";
  catalog_text: string | null;
  image_url: string | null;
  country: string | null;
  extraction_method: string;
  ts_page: number;
  ts_pass: number;
}

/** The sale number printed in the subtitle ("Live Auction 24260 | CLOSED" -> "24260"). */
export function saleNumber(ev: ChristiesEvent): string | null {
  const m = (ev.subtitle_txt ?? "").match(/\b(\d{4,6})\b/);
  return m ? m[1] : null;
}

/** The artwork department of a sale, or null when the sale holds no art category (wine, jewels, handbags). */
export function artDepartment(ev: ChristiesEvent): { code: string; name: string } | null {
  const ids = (ev.filter_ids ?? "").split("|").filter(Boolean);
  for (const [id, name] of Object.entries(ART_CATEGORIES)) {
    if (ids.includes(id)) return { code: `CHR-${id.replace("category_", "")}`, name };
  }
  return null;
}

function stripHtml(html: string): string {
  let text = html.replace(/<br\s*\/?>/gi, "\n");
  let before: string;
  do {
    before = text;
    text = text.replace(/<[^<>]*>/g, "");
  } while (text !== before);
  text = text.replace(/&(#(\d{1,6})|amp|lt|gt|quot|apos|nbsp);/gi, (_m, name: string, num?: string) => {
    if (num) { const n = Number(num); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; }
    switch (name.toLowerCase()) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
      default: return " ";
    }
  });
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The catalogue lines as printed. Christie's prints the artist and dates on one line ("JOSEF ALBERS (1888-1976)"); the
 * creation fold reads the Bonhams layout (name, then "(qualifier)"), so a first line that ends in a parenthesised group with
 * a four-digit year is split into those two lines. Only in artist-led departments (Fine Art, Photographs & Prints), and
 * never for an object line ("A GILT-COPPER FIGURE ... (1650)"): an object description must not become a creator claim.
 * Nothing else is reordered or parsed.
 */
export function catalogueLines(lot: ChristiesLot, artistLed = false): string[] {
  const lines = stripHtml(lot.description_txt ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 12);
  if (!lines.length) return lines;
  const m = lines[0].match(/^(.{2,120}?)\s*(\([^()]*\b\d{4}\b[^()]*\))$/);
  if (artistLed && m && !/^(A|AN|THE|PAIR|SET)\s/i.test(m[1])) lines.splice(0, 1, m[1].trim(), m[2]);
  return lines;
}

function num(s: string | undefined): number | null {
  const n = Number(String(s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function isoOrNull(s: string | undefined): string | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** A sale end more than three years past the read is a placeholder (same rule as Bonhams); stored raw, withheld from derivations. */
function isPlaceholderEnd(iso: string | null, readAt: string): boolean {
  return iso !== null && Date.parse(iso) > Date.parse(readAt) + 3 * 365 * 86_400_000;
}

/** ISO currency from the printed estimate or price ("GBP 250,000 - 350,000"). */
export function currencyOf(lot: ChristiesLot): string | null {
  for (const t of [lot.estimate_txt, lot.price_realised_txt, lot.current_bid_txt]) {
    const m = (t ?? "").trim().match(/^([A-Z]{3})\s/);
    if (m) return m[1];
  }
  return null;
}

/**
 * One lot to one writer record, or null when the sale is outside the art slice or the lot has no id or title.
 * Status: withdrawn when the house's lot_withdrawn flag says so; before or during the sale, upcoming (an in-progress online
 * lot carries its current bid as high_bid). is_auction_over is a sale clock, never an outcome. After the sale the outcome
 * stays explicit and unresolved: a printed price realised -> unresolved:PRICE_REALISED (the lot page read 2026-11-09 does
 * not state what the figure includes or that it means sold: NEEDS SOURCE PROOF); no price -> unknown (unsold or withheld).
 */
export function christiesLotRecord(
  lot: ChristiesLot, ev: ChristiesEvent, ctx: { readAt: string; page: number; pass: number },
): ChristiesLotRecord | null {
  const dept = artDepartment(ev);
  const id = String(lot.object_id ?? "").trim();
  const primary = (lot.title_primary_txt ?? "").trim();
  const secondary = (lot.title_secondary_txt ?? "").trim();
  const title = [primary, secondary].filter(Boolean).join(" ").slice(0, 500);
  if (!dept || !/^[0-9]{1,12}$/.test(id) || title.length < 3) return null;

  const over = lot.is_auction_over === true;
  const price = num(lot.price_realised);
  const result: ChristiesLotRecord["result"] = lot.lot_withdrawn ? "withdrawn"
    : over ? (price ? "unresolved:PRICE_REALISED" : "unknown")
    : "upcoming";
  const saleEnds = isoOrNull(lot.end_date);
  const usableEnd = saleEnds && !isPlaceholderEnd(saleEnds, ctx.readAt) ? saleEnds : null;
  const observedAt = over && usableEnd ? usableEnd : ctx.readAt;
  const sn = saleNumber(ev);
  const lines = catalogueLines(lot, dept.code === "CHR-7" || dept.code === "CHR-11");
  return {
    identity_key: `christies:${id}`,
    asset_type: "artwork",
    title,
    source_identifier: id,
    source_url: (lot.url ?? `https://www.christies.com/en/lot/lot-${id}`).split("?")[0],
    observed_at: observedAt,
    observed_at_basis: over && usableEnd ? "sale_end" : "index_read",
    department_code: dept.code,
    department_name: dept.name,
    house_group: "christies",
    lot_number: lot.lot_id_txt?.trim() || null,
    sale_key: sn ? `christies-${sn}` : null,
    sale_name: (ev.title_txt ?? "").trim() || null,
    sale_ends_at: saleEnds,
    result,
    price_basis: price ? "price_realised" : null,
    price_semantics: price ? PRICE_SEMANTICS : null,
    premium_schedule: premiumScheduleFor(ev.location_txt, lot.start_date ?? saleEnds),
    hammer_price: null,
    hammer_premium: price,
    high_bid: !over && lot.is_in_progress ? num(lot.current_bid) : null,
    estimate_low: num(lot.estimate_low),
    estimate_high: num(lot.estimate_high),
    currency: currencyOf(lot),
    lines,
    catalog_text: lines.length ? lines.join("\n").slice(0, 8000) : null,
    image_url: lot.image?.image_src?.startsWith("http") ? lot.image.image_src.split("?")[0] : null,
    // location_txt is a sale city ("London", "Hong Kong"), not a country; the writer has no city slot, so nothing is claimed.
    country: null,
    extraction_method: CHRISTIES_LOT_METHOD,
    ts_page: ctx.page,
    ts_pass: ctx.pass,
  };
}

/**
 * Attach the symbols a lot page printed (lotHeader). Only when the page is this lot's (object_id matches) and carried a
 * symbols_list; [] is kept as "printed none". Otherwise the record is returned unchanged.
 */
export function withLotPage(rec: ChristiesLotRecord, header: LotHeader | null): ChristiesLotRecord {
  if (!header || header.object_id !== rec.source_identifier || header.symbols_printed === null) return rec;
  return { ...rec, symbols: symbolLabels(header.symbols_printed), symbols_printed: header.symbols_printed, symbols_basis: "lot_page_symbols_list" };
}

/**
 * Walk position, stored in source_walk_cursors (source christies, walk results_by_month): last_page encodes the month
 * offset back from the walk's start month and the sale index inside that month, as month_offset * 1000 + sale_index.
 */
export function encodePosition(monthOffset: number, saleIndex: number): number {
  return monthOffset * 1000 + saleIndex;
}
export function decodePosition(lastPage: number): { monthOffset: number; saleIndex: number } {
  const p = Math.max(0, Math.floor(lastPage));
  return { monthOffset: Math.floor(p / 1000), saleIndex: p % 1000 };
}
/** Year and month for an offset back from a start (offset 0 = the start month). */
export function monthAt(start: { year: number; month: number }, offset: number): { year: number; month: number } {
  const idx = start.year * 12 + (start.month - 1) - offset;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}
/** Christie's results reach back to January 1998 (the calendar's min_date). */
export const EARLIEST = { year: 1998, month: 1 };
