/**
 * Parts finder ranking: Browse item summaries -> a ranked, explained shortlist. Pure: no network, no database.
 *
 * The order, and nothing else (owner, 2026-10-20: fit first, then price and shipping, condition, seller feedback):
 *   1. fit: eBay's own compatibility verdict for the vehicle's mapped properties. EXACT before POSSIBLE before unknown.
 *      Nuke never asserts fit: a listing eBay did not match is "unknown fit", not "fits".
 *   2. names the part: a title that names an accessory of the part ("fuel pump block-off plate", "radiator cap") or
 *      does not name the part at all goes after titles that name it, inside the same fit. Two gates on what the listing
 *      is, each stated in the listing's reasons; measured 2026-10-20: the third cheapest exact fit for "fuel pump" on a
 *      1977 K5 Blazer was a block-off plate.
 *   3. usable condition: "For parts or not working" goes after every usable listing of the same fit.
 *   4. delivered price: price plus the cheapest stated shipping, lowest first. A listing whose shipping eBay does not
 *      state goes after those with a stated delivered price (its total is unknown), ordered by its item price.
 *   5. condition: new, new other, refurbished/remanufactured, used, not stated.
 *   6. seller feedback: percentage, then score.
 * Never read: commission, promotion or any paid placement (priorityListing, adId, campaign or affiliate fields, the
 * order eBay returned results in). normalizeSummary copies only the fields in RANK_FIELDS' sources; rankListings reads
 * only RANK_FIELDS. parts.test.ts proves that changing a paid field never changes the order.
 */

export type Fit = "exact" | "possible" | "unknown";

export interface PartListing {
  item_id: string;                     // eBay legacy item id (the number in the item URL)
  title: string;
  item_url: string;                    // https://www.ebay.com/itm/<item_id>, plus eBay's fits= when it gave one
  image_url: string | null;
  price: number | null;
  currency: string | null;
  shipping: number | null;             // cheapest stated shipping cost; null when eBay states none
  shipping_basis: "free" | "stated" | "not_stated";
  total: number | null;                // price + shipping when both are stated in one currency
  condition: string | null;
  condition_id: string | null;
  condition_class: number;             // 0 new, 1 new other, 2 refurbished, 3 used, 4 not stated, 5 for parts
  seller: { username: string | null; feedback_percentage: number | null; feedback_score: number | null };
  item_location: { postal_prefix: string | null; country: string | null };
  fit: Fit;
  fit_properties: { name: string; value: string }[];   // the properties eBay reports it matched
  part_match: PartMatch;
  title_years_other: string | null;    // years the title names when none is the vehicle's (a note; never ranked)
  observed_at: string;
}
/** What the title says the listing is, against the query: the part, an accessory of it, or neither. */
export interface PartMatch { state: "names_part" | "accessory" | "not_named"; word: string; next?: string }

export interface RankedListing extends PartListing { rank: number; why: string[] }

/** The only listing fields the order reads. */
export const RANK_FIELDS = ["fit", "part_match", "condition_class", "total", "price", "feedback_percentage", "feedback_score"] as const;
/** Fields eBay may send that the ranking must never read (promotion, ads, commission, affiliate). */
export const NEVER_RANK_BY = ["priorityListing", "adId", "commission", "commissionRate", "campaignId", "itemAffiliateWebUrl",
  "sponsored", "promoted", "result position"] as const;

const FIT_RANK: Record<Fit, number> = { exact: 0, possible: 1, unknown: 2 };
const CONDITION_WORD = ["New", "New (other)", "Refurbished or remanufactured", "Used", "Condition not stated", "For parts or not working"];

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** eBay condition ids (Browse conditionId), else the condition text. */
export function conditionClass(id: string | null | undefined, text: string | null | undefined): number {
  const n = num(id);
  if (n !== null) {
    if (n === 1000) return 0;
    if (n === 1500 || n === 1750) return 1;
    if (n >= 2000 && n < 2750) return 2;
    if (n >= 2750 && n < 7000) return 3;
    if (n === 7000) return 5;
  }
  const t = (text ?? "").toLowerCase();
  if (!t) return 4;
  if (/for parts|not working/.test(t)) return 5;
  if (/^new$/.test(t.trim())) return 0;
  if (/new/.test(t)) return 1;
  if (/refurb|reman|rebuilt/.test(t)) return 2;
  if (/used|pre-owned/.test(t)) return 3;
  return 4;
}

/** eBay's fits= parameter from the item URL it returned (it names the vehicle the page should confirm), or null. */
export function fitsParam(itemWebUrl: string | undefined): string | null {
  if (!itemWebUrl) return null;
  try { return new URL(itemWebUrl).searchParams.get("fits"); } catch { return null; }
}

export const itemUrl = (itemId: string, fits: string | null) =>
  `https://www.ebay.com/itm/${itemId}${fits ? `?fits=${encodeURIComponent(fits)}` : ""}`;

// deno-lint-ignore no-explicit-any
type Summary = Record<string, any>;

/** Words that, right after the part's name, make the title an accessory of the part rather than the part. */
const ACCESSORY = new Set(["plate", "block", "blockoff", "gasket", "seal", "oring", "rod", "pushrod", "relay", "fuse", "switch", "sensor",
  "cover", "spacer", "bracket", "mount", "bolt", "screw", "nut", "stud", "hose", "line", "fitting", "adapter", "harness", "connector",
  "pigtail", "wire", "wiring", "strap", "insulator", "eccentric", "filter", "sock", "strainer", "clip", "hardware", "shim", "bushing",
  "sticker", "decal", "tool", "wrench", "socket", "puller", "manual", "diagram", "cap", "grommet", "shroud", "fan", "support", "wear",
  "lock", "key", "retainer", "spring", "pin"]);
const words = (s: string) => s.toLowerCase().replace(/[-‐]/g, "").replace(/o-ring/g, "oring").split(/[^a-z0-9]+/).filter(Boolean)
  .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
const compact = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Does the title name the part? With a part number: the number appears in the title. Otherwise the query's last word
 * (its head noun, singular) appears, and at least once it is not immediately followed by an accessory word.
 */
export function partMatch(title: string, query: string, partNumber?: string | null): PartMatch {
  if (partNumber && compact(partNumber).length >= 3) {
    return compact(title).includes(compact(partNumber)) ? { state: "names_part", word: partNumber } : { state: "not_named", word: partNumber };
  }
  const q = words(query);
  const head = q[q.length - 1] ?? "";
  if (!head) return { state: "names_part", word: "" };
  const t = words(title);
  const at = t.flatMap((w, i) => (w === head ? [i] : []));
  if (!at.length) return { state: "not_named", word: head };
  const clean = at.find((i) => !ACCESSORY.has(t[i + 1] ?? ""));
  return clean !== undefined ? { state: "names_part", word: head } : { state: "accessory", word: head, next: t[at[0] + 1] };
}

/**
 * One Browse item summary -> a PartListing, or null when it has no item id or no fixed price.
 * `fitChecked` is true only when the search carried a compatibility_filter; otherwise every listing is unknown fit.
 */
export interface NormalizeContext { observedAt: string; fitChecked: boolean; query?: string; partNumber?: string | null; vehicleYear?: number | null }

/** Model years a title names ("73-87", "1978-1988", "1977"), as [from, to] ranges. */
export function titleYears(title: string): [number, number][] {
  const full = (y: string) => { const n = Number(y); return y.length === 4 ? n : n >= 30 ? 1900 + n : 2000 + n; };
  const out: [number, number][] = [];
  const t = title.replace(/(?:19|20)\d{2}\s*-\s*(?:19|20)\d{2}|\b\d{2}\s*-\s*\d{2}\b(?!\s*(?:psi|amps?|mm|in\b|gph|lph|v\b|w\b|%|°|deg|lbs?|oz|qt|gal))/gi, (m) => {
    const [a, b] = m.split("-").map((x) => x.trim());
    const fa = full(a), fb = full(b);
    if (fa >= 1900 && fb >= fa && fb - fa < 60) out.push([fa, fb]);
    return " ";
  });
  for (const m of t.matchAll(/\b(19[3-9]\d|20[0-3]\d)\b/g)) out.push([Number(m[1]), Number(m[1])]);
  return out;
}

export function normalizeSummary(s: Summary, ctx: NormalizeContext): PartListing | null {
  const { observedAt, fitChecked, query = "", partNumber = null, vehicleYear = null } = ctx;
  const itemId = String(s.legacyItemId ?? String(s.itemId ?? "").split("|")[1] ?? "").trim();
  if (!/^\d{6,20}$/.test(itemId)) return null;
  const price = num(s.price?.value);
  const currency = typeof s.price?.currency === "string" ? s.price.currency : null;
  if (price === null || price <= 0) return null;
  let shipping: number | null = null;
  for (const o of Array.isArray(s.shippingOptions) ? s.shippingOptions : []) {
    const c = num(o?.shippingCost?.value);
    const cur = o?.shippingCost?.currency ?? currency;
    if (c === null || c < 0 || cur !== currency) continue;
    if (shipping === null || c < shipping) shipping = c;
  }
  const match = String(s.compatibilityMatch ?? "").toUpperCase();
  const fit: Fit = !fitChecked ? "unknown" : match === "EXACT" ? "exact" : match === "POSSIBLE" ? "possible" : "unknown";
  const fb = num(s.seller?.feedbackPercentage);
  const image = s.image?.imageUrl ?? s.thumbnailImages?.[0]?.imageUrl ?? null;
  return {
    item_id: itemId,
    title: String(s.title ?? "").slice(0, 300),
    item_url: itemUrl(itemId, fitsParam(s.itemWebUrl)),
    image_url: typeof image === "string" && /^https:\/\//.test(image) ? image : null,
    price, currency, shipping,
    shipping_basis: shipping === null ? "not_stated" : shipping === 0 ? "free" : "stated",
    total: shipping === null ? null : Math.round((price + shipping) * 100) / 100,
    condition: typeof s.condition === "string" ? s.condition : null,
    condition_id: s.conditionId != null ? String(s.conditionId) : null,
    condition_class: conditionClass(s.conditionId, s.condition),
    seller: { username: typeof s.seller?.username === "string" ? s.seller.username : null, feedback_percentage: fb,
      feedback_score: num(s.seller?.feedbackScore) },
    item_location: { postal_prefix: typeof s.itemLocation?.postalCode === "string" ? s.itemLocation.postalCode : null,
      country: typeof s.itemLocation?.country === "string" ? s.itemLocation.country : null },
    fit,
    fit_properties: fit === "unknown" ? [] : (Array.isArray(s.compatibilityProperties) ? s.compatibilityProperties : [])
      .filter((p: Summary) => typeof p?.name === "string" && typeof p?.value === "string")
      .map((p: Summary) => ({ name: p.name, value: p.value })),
    part_match: partMatch(String(s.title ?? ""), query, partNumber),
    title_years_other: (() => {
      if (!vehicleYear) return null;
      const ys = titleYears(String(s.title ?? ""));
      return ys.length && !ys.some(([a, b]) => vehicleYear >= a && vehicleYear <= b) ? ys.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(", ") : null;
    })(),
    observed_at: observedAt,
  };
}

const usable = (l: PartListing) => (l.condition_class === 5 ? 1 : 0);
const names = (l: PartListing) => (l.part_match.state === "names_part" ? 0 : 1);
/** Sort key, compared left to right. Reads only RANK_FIELDS. */
function key(l: PartListing): (number | string)[] {
  return [
    FIT_RANK[l.fit], names(l), usable(l),
    l.total === null ? 1 : 0, l.total ?? l.price ?? Number.MAX_VALUE,
    l.condition_class,
    -(l.seller.feedback_percentage ?? -1), -(l.seller.feedback_score ?? -1),
    l.item_id,                                    // a stable last resort, so equal listings never swap between runs
  ];
}
const cmp = (a: PartListing, b: PartListing) => {
  const ka = key(a), kb = key(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
  return 0;
};

export const money = (v: number | null, cur: string | null) =>
  v === null ? "not stated" : cur === "USD" || cur === null ? `$${v.toFixed(2)}` : `${v.toFixed(2)} ${cur}`;
const ordinal = (n: number) => n === 1 ? "lowest" : `${n}${n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"} lowest`;
const FIT_WORD: Record<Fit, string> = { exact: "exact fits", possible: "possible fits", unknown: "listings of unknown fit" };

/** Rank every listing and explain each position. `limit` keeps the top of the order. */
export function rankListings(listings: PartListing[], limit = 5): RankedListing[] {
  const sorted = [...listings].sort(cmp);
  const out: RankedListing[] = [];
  for (let i = 0; i < Math.min(limit, sorted.length); i++) {
    const l = sorted[i];
    const why: string[] = [];
    const props = l.fit_properties.map((p) => `${p.name} ${p.value}`).join(", ");
    const titleNote = l.fit !== "unknown" && l.title_years_other ? `; the title names ${l.title_years_other}, so check the listing's fitment table` : "";
    why.push(l.fit === "exact" ? `Exact fit: eBay matched ${props || "every property sent"}${titleNote}`
      : l.fit === "possible" ? `Possible fit: eBay matched only part of the vehicle${props ? ` (${props})` : ""}; check the listing's fitment table`
      : "Fit unknown: eBay made no fitment match for this listing; Nuke does not assert that it fits");
    const peers = sorted.filter((x) => x.fit === l.fit && names(x) === names(l) && usable(x) === usable(l));
    if (l.part_match.state === "accessory") why.push(`Title names a ${l.part_match.word} ${l.part_match.next ?? "accessory"}, not a ${l.part_match.word}: ranked after listings that name the part`);
    if (l.part_match.state === "not_named") why.push(`Title does not name "${l.part_match.word}": ranked after listings that name the part`);
    if (usable(l)) why.push("For parts or not working: ranked after every usable listing of the same fit");
    if (l.total !== null) {
      const priced = peers.filter((x) => x.total !== null);
      const pos = priced.findIndex((x) => x.item_id === l.item_id) + 1;
      why.push(`${money(l.total, l.currency)} delivered (${money(l.price, l.currency)} + ${l.shipping === 0 ? "free shipping" : `${money(l.shipping, l.currency)} shipping`}): ` +
        `${ordinal(pos)} of the ${priced.length} ${FIT_WORD[l.fit]} read with a stated delivered price`);
    } else {
      why.push(`${money(l.price, l.currency)} before shipping; eBay states no shipping cost, so it ranks after listings with a stated delivered price`);
    }
    const prev = sorted[i - 1];
    if (prev && FIT_RANK[prev.fit] === FIT_RANK[l.fit] && names(prev) === names(l) && usable(prev) === usable(l) && prev.total === l.total &&
        (prev.total !== null || prev.price === l.price)) {
      const sameFeedback = prev.seller.feedback_percentage === l.seller.feedback_percentage && prev.seller.feedback_score === l.seller.feedback_score;
      why.push(prev.condition_class !== l.condition_class ? `Same price as #${i}; condition decided the order`
        : !sameFeedback ? `Same price and condition as #${i}; seller feedback decided the order`
        : `Same price, condition and seller feedback as #${i}; listed by item number`);
    }
    why.push(`Condition: ${l.condition ?? CONDITION_WORD[l.condition_class]}`);
    why.push(l.seller.feedback_percentage === null ? "Seller feedback not stated"
      : `Seller feedback ${l.seller.feedback_percentage}%${l.seller.feedback_score !== null ? ` of ${l.seller.feedback_score.toLocaleString("en-US")}` : ""}`);
    out.push({ ...l, rank: i + 1, why });
  }
  return out;
}
