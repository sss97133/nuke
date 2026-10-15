/**
 * Browse API item -> the shapes Nuke's writers take. Pure: no network, no database.
 *
 * What eBay does and does not say (Buy API Field Filters and the Browse OpenAPI spec, read 2026-10-15):
 * on EBAY_US/EBAY_MOTORS_US there is NO private-vs-dealer filter or field. `sellerAccountTypes` and
 * `seller.sellerAccountType` exist only on EBAY_AT/BE/CH/DE/ES/FR/GB/IE/IT/PL. So the seller class here is a
 * CLAIM made by Nuke from stated signals, stored beside those signals; it is never an eBay fact.
 */

export type SellerClass = "likely_private" | "unknown" | "likely_dealer";

export interface Tier { id: 1 | 2 | 3 | 4; label: string; years: number[] }
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
/** Owner's order (2026-10-15): private sellers 1964-1973, then 1974-1991, then the rest. */
export const TIERS: Tier[] = [
  { id: 1, label: "1964-1973", years: range(1964, 1973) },
  { id: 2, label: "1974-1991", years: range(1974, 1991) },
  { id: 3, label: "1930-1963", years: range(1930, 1963) },
  { id: 4, label: "1992-2005", years: range(1992, 2005) },
];
export const tierOfYear = (y: number | null | undefined): number | null =>
  y == null ? null : (TIERS.find((t) => t.years.includes(y))?.id ?? null);

// ---- raw API shapes (only the fields read) -------------------------------------------------------------------

export interface EbaySeller { username?: string; feedbackPercentage?: string; feedbackScore?: number; sellerAccountType?: string }
export interface EbayMoney { value?: string; currency?: string }
export interface EbayItem {
  itemId?: string; legacyItemId?: string; title?: string; itemWebUrl?: string; description?: string; shortDescription?: string;
  price?: EbayMoney; currentBidPrice?: EbayMoney; bidCount?: number; buyingOptions?: string[];
  itemLocation?: { city?: string; stateOrProvince?: string; postalCode?: string; country?: string };
  image?: { imageUrl?: string }; additionalImages?: { imageUrl?: string }[];
  localizedAspects?: { type?: string; name?: string; value?: string }[];
  seller?: EbaySeller; itemCreationDate?: string; itemOriginDate?: string; itemEndDate?: string;
  condition?: string; categoryPath?: string; categoryId?: string; listingMarketplaceId?: string;
  [k: string]: unknown;
}

// ---- helpers --------------------------------------------------------------------------------------------------

/** eBay image URLs carry their size as s-l<N>; s-l1600 is the largest eBay serves. */
export function fullSizeImage(url: string): string {
  return url.replace(/\/s-l\d+(\.\w+)?(?=$|\?)/i, "/s-l1600$1");
}

export function imagesOf(item: EbayItem): string[] {
  const out: string[] = [];
  for (const u of [item.image?.imageUrl, ...(item.additionalImages ?? []).map((i) => i.imageUrl)]) {
    if (!u) continue;
    const big = fullSizeImage(u);
    if (!out.includes(big)) out.push(big);
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/\s*\(.*?\)\s*/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

/** Item specifics by normalized name ("VIN (Vehicle Identification Number)" -> "vin"). Keeps the raw list on the capture. */
export function aspectsOf(item: EbayItem): Record<string, string> {
  const m: Record<string, string> = {};
  for (const a of item.localizedAspects ?? []) {
    if (!a?.name || a.value == null) continue;
    const k = norm(a.name);
    if (k && !(k in m)) m[k] = String(a.value).trim();
  }
  return m;
}

export function canonicalUrl(item: EbayItem): string | null {
  const id = item.legacyItemId || item.itemId?.split("|")[1];
  return id && /^\d+$/.test(id) ? `https://www.ebay.com/itm/${id}` : null;
}
export const listingKey = (item: EbayItem): string | null => canonicalUrl(item)?.split("/").pop() ?? null;

export function priceOf(item: EbayItem): { amount: number | null; kind: "buy_it_now" | "current_bid" | "unknown"; currency: string | null } {
  const bid = item.buyingOptions?.includes("AUCTION") && item.currentBidPrice?.value;
  const src = bid ? item.currentBidPrice : item.price;
  const n = src?.value != null ? Number(src.value) : NaN;
  return { amount: Number.isFinite(n) && n > 0 ? n : null, kind: src ? (bid ? "current_bid" : "buy_it_now") : "unknown", currency: src?.currency ?? null };
}

export function locationOf(item: EbayItem): string | null {
  const l = item.itemLocation;
  const s = [l?.city, l?.stateOrProvince].filter(Boolean).join(", ");
  return s || l?.postalCode || null;
}

const YEAR_IN_TITLE = /\b(19[0-9]{2}|20[0-2][0-9])\b/;
export function yearOf(item: EbayItem, a = aspectsOf(item)): number | null {
  const fromAspect = a["year"] && /^\d{4}$/.test(a["year"]) ? Number(a["year"]) : null;
  if (fromAspect) return fromAspect;
  const t = item.title?.match(YEAR_IN_TITLE);
  return t ? Number(t[1]) : null;
}

export function mileageOf(a: Record<string, string>): number | null {
  const raw = a["mileage"] ?? a["odometer"];
  if (!raw) return null;
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

const VIN17 = /^[A-HJ-NPR-Z0-9]{17}$/i;
/** Pre-1981 VINs run 5-13 characters; keep what the seller typed, flag whether it is a 17-character modern VIN. */
export function vinOf(a: Record<string, string>): { vin: string | null; modern: boolean } {
  const raw = (a["vin"] ?? a["vehicle identification number"] ?? "").replace(/[\s-]/g, "").toUpperCase();
  if (!raw || /^(NA|N\/A|NONE|UNKNOWN|NOVIN)$/.test(raw)) return { vin: null, modern: false };
  return { vin: raw, modern: VIN17.test(raw) };
}

// ---- seller class ----------------------------------------------------------------------------------------------

const DEALER_NAME = /(motors|motorcars|motorsports|automotive|autosales|autogroup|automall|dealer|llc$|_inc$|wholesale|exotics|showroom|broker|consign|carsales|carlot|usedcars)/i;
const DEALER_TEXT = /\b(dealer(ship)?|our (showroom|lot|inventory|team|staff|sales)|we (are|offer|have|ship|finance|specialize)|financing (available|options)|stock\s?(#|number|no)|dealer (fee|license)|licensed (dealer|and bonded)|bonded|consignment|trade[- ]ins? (welcome|accepted)|call (our|us) (today|now)|visit our)\b/i;
const PRIVATE_TEXT = /\b(my (father|dad|grandfather|husband|wife|uncle|brother|son)|i('| a)?m the (second|third|fourth|2nd|3rd|original|only) owner|selling (my|this) (car|truck|vehicle)|i bought (it|this)|i have owned|owned (it|her|him) (for|since)|private (seller|party|sale)|not a dealer|no dealer)\b/i;

export function classifySeller(item: EbayItem, descriptionText = ""): { class: SellerClass; reasons: string[]; signals: Record<string, unknown> } {
  const reasons: string[] = [];
  const name = item.seller?.username ?? "";
  const score = item.seller?.feedbackScore ?? null;
  const pct = item.seller?.feedbackPercentage != null ? Number(item.seller.feedbackPercentage) : null;
  const text = `${item.title ?? ""} ${descriptionText}`;
  const classified = item.buyingOptions?.includes("CLASSIFIED_AD") ?? false;
  let dealer = 0, priv = 0;
  if (name && DEALER_NAME.test(name)) { dealer += 2; reasons.push("username reads as a business"); }
  if (DEALER_TEXT.test(text)) { dealer += 2; reasons.push("text uses dealer wording"); }
  if (score != null && score >= 1000) { dealer += 1; reasons.push(`feedback score ${score} (>= 1000)`); }
  if (PRIVATE_TEXT.test(text)) { priv += 2; reasons.push("text uses private-seller wording"); }
  if (score != null && score < 100) { priv += 1; reasons.push(`feedback score ${score} (< 100)`); }
  if (classified && score != null && score < 500) { priv += 1; reasons.push("classified ad from a low-volume seller"); }
  const cls: SellerClass = dealer >= 2 && dealer > priv ? "likely_dealer" : priv >= 2 && priv > dealer ? "likely_private" : "unknown";
  return { class: cls, reasons, signals: { username: name || null, feedback_score: score, feedback_percentage: pct, buying_options: item.buyingOptions ?? [], dealer_points: dealer, private_points: priv } };
}

/** Private first: the order getItem calls are spent in when the day's quota is short. */
export const CLASS_RANK: Record<SellerClass, number> = { likely_private: 0, unknown: 1, likely_dealer: 2 };

// ---- what the writers take -------------------------------------------------------------------------------------

export interface Landing {
  listingKey: string;
  url: string;
  year: number | null; make: string | null; model: string | null;
  ingestInput: Record<string, unknown> | null;     // null when identity is incomplete (a blip)
  obsFields: Record<string, unknown>;
  eventMetadata: Record<string, unknown>;
  price: ReturnType<typeof priceOf>;
  postedAt: string | null; endsAt: string | null;
  images: string[]; descriptionText: string;
  seller: { class: SellerClass; reasons: string[]; signals: Record<string, unknown> };
  vin: { vin: string | null; modern: boolean };
}

export function toLanding(item: EbayItem, htmlToText: (h: string) => string): Landing | null {
  const url = canonicalUrl(item);
  const key = listingKey(item);
  if (!url || !key) return null;
  const a = aspectsOf(item);
  const description = htmlToText(item.description ?? item.shortDescription ?? "").trim();
  const year = yearOf(item, a);
  const make = a["make"] ?? a["brand"] ?? null;
  const model = a["model"] ?? null;
  const price = priceOf(item);
  const seller = classifySeller(item, description);
  const images = imagesOf(item);
  const vin = vinOf(a);
  const mileage = mileageOf(a);
  const trim = a["trim"] ?? null;
  const color = a["exterior color"] ?? a["color"] ?? null;
  const engine = a["engine"] ?? a["engine size"] ?? null;
  const transmission = a["transmission"] ?? null;
  const posted = item.itemOriginDate ?? item.itemCreationDate ?? null;
  const location = locationOf(item);

  const obsFields: Record<string, unknown> = {};
  const put = (k: string, v: unknown) => { if (v != null && v !== "") obsFields[k] = v; };
  put("year", year); put("make", make); put("model", model); put("trim", trim);
  if (vin.vin && vin.modern) put("vin", vin.vin);
  put("mileage", mileage); put("color", color); put("interior_color", a["interior color"]);
  put("transmission", transmission); put("drivetrain", a["drive type"] ?? a["drivetrain"]);
  put("engine_size", engine); put("body_style", a["body type"] ?? a["body style"]); put("fuel_type", a["fuel type"]);

  const ingestInput = year && make && model
    ? {
      url, year, make, model, enrich: false,
      price: price.amount ?? undefined, description: description || item.title || "(no description)",
      image_urls: images, vin: vin.modern ? vin.vin : undefined, mileage: mileage ?? undefined,
      engine: engine ?? undefined, transmission: transmission ?? undefined, color: color ?? undefined,
      body_style: a["body type"] ?? undefined, title_status: a["vehicle title"] ?? undefined,
      location: location ?? undefined, seller_name: item.seller?.username ?? undefined,
    }
    : null;

  return {
    listingKey: key, url, year, make, model, ingestInput, obsFields, price,
    postedAt: posted, endsAt: item.itemEndDate ?? null, images, descriptionText: description, seller, vin,
    eventMetadata: {
      source: "ebay-browse-api", item_id: item.itemId ?? null, listing_posted_at: posted, listing_ends_at: item.itemEndDate ?? null,
      buying_options: item.buyingOptions ?? [], price_kind: price.kind, currency: price.currency, bid_count: item.bidCount ?? null,
      seller_username: item.seller?.username ?? null, seller_feedback_score: item.seller?.feedbackScore ?? null,
      seller_feedback_percentage: item.seller?.feedbackPercentage ?? null,
      seller_class_claim: { value: seller.class, reasons: seller.reasons, basis: "nuke heuristic; eBay US exposes no seller account type" },
      tier: tierOfYear(year), image_count: images.length, location, listing_vin: vin.vin, listing_vin_modern: vin.modern,
    },
  };
}
