/**
 * An eBay Motors item page as the Wayback Machine kept it (2006-2014), read from the raw capture
 * (https://web.archive.org/web/<timestamp>id_/<original url>, no archive toolbar). Free, and unlike today's public page it
 * states how the listing ended: "Winning bid", "Sold For", "Reserve not met", a bid count and the exact end time with its
 * Pacific zone. Measured 2026-10-19 on ten 1977 car pages captured 2009-2013. Pure; tested in archivePage.test.ts.
 */
import type { EbayItem } from "./browseMap.ts";

export type ArchivedOutcome =
  | "winning_bid"            // auction ended with a winning bid (the page names the price)
  | "sold_for"               // fixed-price or best-offer listing the page says sold, at the price shown
  | "reserve_not_met"        // auction ended under reserve; the high bid is shown
  | "ended_no_bids"          // auction ended with 0 bids
  | "ended_by_seller"        // the seller ended it early
  | "ended"                  // ended, with no stated sale
  | "live";                  // captured while still running

export interface ArchivedItemPage {
  itemId: string | null;
  title: string | null;
  outcome: ArchivedOutcome;
  endedAt: string | null;          // ISO, from "Ended: Jul 18, 2013 14:49:21 PDT"
  endedText: string | null;
  priceShown: number | null;       // the amount next to the outcome label
  priceLabel: string | null;       // "Winning bid" | "Sold For" | "Current bid" | "Starting bid" | "Price"
  bids: number | null;
  reserveNotMet: boolean;
  specifics: Record<string, string>;
  location: string | null;
  sellerUsername: string | null;
  sellerFeedbackCount: number | null;
  description: string;
  images: string[];                // original eBay image URLs, one per photo, largest size seen
  photoSizes: string[][];          // each photo's URLs at the sizes the page names, largest first (images[i] = photoSizes[i][0])
}

const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, k: string) => {
    const key = k.toLowerCase();
    const named: Record<string, string> = { amp: "&", quot: '"', lt: "<", gt: ">", apos: "'", nbsp: " " };
    if (named[key] !== undefined) return named[key];
    const n = key.startsWith("#x") ? parseInt(key.slice(2), 16) : key.startsWith("#") ? parseInt(key.slice(1), 10) : NaN;
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
  });
const textOf = (html: string) =>
  decode(html.replace(/<script[\s\S]*?<\/script[^>]*>|<style[\s\S]*?<\/style[^>]*>/gi, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const money = (s: string | undefined) => (s ? Number(s.replace(/[^\d.]/g, "")) || null : null);

/** The eBay item number in an archived URL: ..._W0QQitemZ<id>QQ..., .../<id>?..., or ?item=<id>. */
export function archiveItemId(url: string): string | null {
  return url.match(/[?&]item=(\d{9,13})/)?.[1] ?? url.match(/QQitemZ(\d{9,13})/)?.[1] ?? url.match(/\/(\d{9,13})(?:[?#]|$)/)?.[1] ?? null;
}

/** The archive URL that serves an image as captured: https://web.archive.org/web/<ts>im_/<original>. */
export const archivedImageUrl = (timestamp: string, url: string) => `https://web.archive.org/web/${timestamp}im_/${url}`;

const MON: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
/** "Jul 18, 2013 14:49:21 PDT" -> ISO; eBay states the Pacific zone (PST -8, PDT -7). */
export function endedAtIso(text: string): string | null {
  const m = text.match(/([A-Z][a-z]{2})[- ](\d{1,2}),?[- ](\d{2,4}) (\d{1,2}):(\d{2}):(\d{2}) (PST|PDT)/);
  if (!m || MON[m[1].toLowerCase()] === undefined) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const off = m[7] === "PDT" ? 7 : 8;
  return new Date(Date.UTC(year, MON[m[1].toLowerCase()], Number(m[2]), Number(m[4]) + off, Number(m[5]), Number(m[6]))).toISOString();
}

// Item-specifics labels as the 2009-2014 pages print them ("Label: value Label: value ..."); a value runs to the next label.
// Pages print them in Title Case (2012+) or sentence case (2010-2011: "Body type:", "Exterior color:"); keys are kept Title Case.
const LABELS = ["Year", "Make", "Model", "Sub Model", "Trim", "Mileage", "VIN", "Body Type", "Exterior Color", "Interior Color",
  "Transmission", "Engine", "Drive Type", "Drivetrain", "Number of Cylinders", "Fuel Type", "Vehicle Title", "Title", "For Sale By",
  "Warranty", "Condition", "Options", "Power Options", "Safety Features", "Disability Equipped", "Vehicle Inspection", "Location",
  "Service Records", "Item condition", "Sells to", "Doors", "Cylinders", "Features", "Certification", "Inspection",
  "Cab Type \\(For Trucks Only\\)", "Bed Length", "Number of Doors", "Number of Owners"];
const LABEL_RE = new RegExp(`(?:^|\\s)(${LABELS.map((l) => l.replace(/ /g, "\\s")).join("|")}):\\s`, "gi");
const KEY = new Map(LABELS.map((l) => [l.replace(/\\/g, "").toLowerCase(), l.replace(/\\/g, "")]));
// A value ends at the next label-like "Words:" or at a "|" separator, whichever is first.
const VALUE_END = /\s\|\s|\s(?:Get the|See the|Read more|Photo Viewer|Share|Description\s)|\s[A-Z][A-Za-z()/-]*(?: [A-Za-z()/-]+){0,4}:\s/;

function specificsOf(text: string): Record<string, string> {
  const start = text.search(/\b(Item specifics|Vehicle Information|Item condition:)/);
  const block = start < 0 ? text : text.slice(start, start + 5000);
  const hits = [...block.matchAll(LABEL_RE)];
  const out: Record<string, string> = {};
  hits.forEach((h, i) => {
    const label = KEY.get(h[1].replace(/\s+/g, " ").toLowerCase()) ?? h[1];
    const from = (h.index ?? 0) + h[0].length, to = i + 1 < hits.length ? hits[i + 1].index ?? block.length : Math.min(block.length, from + 200);
    let value = block.slice(from, to);
    const cut = value.search(VALUE_END);
    if (cut >= 0) value = value.slice(0, cut);
    value = value.trim().slice(0, 300);
    const key = label === "Title" ? "Vehicle Title" : label === "Drivetrain" ? "Drive Type" : label;
    if (value && !(key in out)) out[key] = value;
  });
  return out;
}

/** A typed chassis number worth keeping: letters/digits only, 5-17 long, not masked ("XXXXXXXFJ40255430", "5T09T12****"). */
export function plausibleVin(raw: string | undefined): string | null {
  const v = (raw ?? "").replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z0-9]{5,17}$/.test(v) && /\d{3}/.test(v) && !/X{3,}|\*/.test(v) ? v : null;
}

// An eBay photo URL ends in _<size>.JPG; photo ids may contain ")" ("$(KGrHgoH-CQEkJwwr(3WBKZ)8hTC6w~~").
const PHOTO_URL = /https?:\/\/i\d*\.ebayimg\.com\/[^"'\s<>]+?_(\d+)\.(?:JPG|jpg|jpeg|PNG|png)/g;
const photoKey = (url: string) => url.replace(/_\d+\.(?:JPG|jpg|jpeg|PNG|png)$/, "");
// Largest first: 57 (1600), 3 (800 zoom / supersize), 12 (500), 1 (400), 35 (300 main), 2 (viewport), 0 and 14 (thumbnails).
const SIZE_RANK: Record<number, number> = { 57: 7, 3: 6, 12: 5, 1: 4, 35: 3, 2: 2, 0: 1, 14: 0 };
// Where an item page lists the item's own photos: the 2006-09 slideshow arrays ("ss0ImageUrls = descImageUrls = [[...]]"), the
// 2006-09 photo-hosting block (links to "#ebayphotohosting", and the picture under its anchor), the 2009-14 view selector's
// image data ("imgData", "mnImgData", "thImgData", "hiResImgData") and og:image. A store logo, a seller's description or
// template image and another item's picture sit outside them.
const GALLERY = [
  /ImageUrls\s*=\s*(?:descImageUrls\s*=\s*)?\[\s*\[[\s\S]{0,60000}?\]\s*\]/g,
  /<a[^>]+#ebayphotohosting"[^>]*>[\s\S]{0,600}?<\/a>/g,
  /<a name="ebayphotohosting"><\/a>[\s\S]{0,200}?<img[^>]*>/g,
  /"?(?:mn|th|hiRes)?[iI]mgData"?\s*:\s*(?:\[[^\]]*\]|\{[^}]*\})/g,
  /<meta[^>]+property="og:image"[^>]*>/gi,
];

/** The item's own photos (the photo viewer's), cover first: each photo's URLs at the sizes the page names (thumbnails left
 *  out), largest first. A gallery
 *  block inside the seller's description, or a photo-hosting link naming another item, is another listing's (sellers paste
 *  an earlier listing's description, slideshow and all: item 160078932594's 2007 page carries 250073639703's 24 photos). */
function photosOf(html: string, itemId: string | null): string[][] {
  const descStart = html.search(/<div[^>]+id="ngvi_desc_div"[^>]*>/i);
  const endAt = descStart < 0 ? -1 : html.slice(descStart, descStart + 400_000).search(DESC_END);
  const descEnd = endAt < 0 ? -1 : descStart + endAt; // only a description whose end eBay's next section marks
  const own = new Set<string>();
  for (const re of GALLERY) for (const g of html.matchAll(re)) {
    const at = g.index ?? 0, names = g[0].match(/[?&;]item=(\d{9,13})/)?.[1];
    if ((at >= descStart && at < descEnd) || (names && itemId && names !== itemId)) continue;
    for (const m of g[0].matchAll(PHOTO_URL)) own.add(photoKey(m[0]));
  }
  const sizes = new Map<string, Map<string, number>>();
  for (const m of html.matchAll(PHOTO_URL)) {
    const key = photoKey(m[0]), rank = SIZE_RANK[Number(m[1])] ?? 2; // an unlisted size (2007 "_4", 640x480) is a photo
    if (own.has(key) && rank >= 2) (sizes.get(key) ?? sizes.set(key, new Map()).get(key)!).set(m[0], rank);
  }
  return [...sizes.values()].map((s) => [...s.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u));
}

export interface PhotoProbe { status: number; servedTimestamp: string | null; image: boolean }
const tsDays = (ts: string) => Date.UTC(+ts.slice(0, 4), +ts.slice(4, 6) - 1, +ts.slice(6, 8)) / 86_400_000;

/** Which of a page's photos the Wayback Machine serves (archivedImageUrl), cover first, each photo at up to three of its
 *  sizes, largest first. The archive kept few eBay photos (2 of 98 vehicles' covers probed 2026-10-20, both the 400px size
 *  og:image names), so a cover served at no size ends the check. A photo counts only when an image comes back from a capture
 *  within a year of the page's: the archive answers an uncaptured address with its nearest capture, and one years away is a
 *  later picture at that address. Returns the served URL of each held photo, in page order. */
export async function archivedPhotos(photos: string[][], timestamp: string, probe: (url: string) => Promise<PhotoProbe>, max = 12) {
  const held: string[] = [];
  let checked = 0;
  for (const [i, sizes] of photos.slice(0, max).entries()) {
    let got: string | null = null;
    for (const url of sizes.slice(0, 3)) {
      const r = await probe(archivedImageUrl(timestamp, url)).catch(() => null);
      checked++;
      const near = !!r?.servedTimestamp && Math.abs(tsDays(r.servedTimestamp) - tsDays(timestamp)) <= 366;
      if (r?.image && r.status === 200 && near) { got = url; break; }
    }
    if (got) held.push(got);
    else if (i === 0) break;
  }
  return { held, checked, listed: photos.length };
}

// The seller's description sits inline after ngvi_desc_div, often in a dealer template whose own nested <div>s close early;
// it ends before the first of eBay's following sections (2009, 2011, 2012 and 2013 pages).
const DESC_END = /Questions and answers|Seller assumes all responsibility|id="rtm_html_|Back to home page/;
function descriptionHtml(html: string): string {
  const start = html.search(/<div[^>]+id="ngvi_desc_div"[^>]*>/i);
  if (start < 0) return "";
  const rest = html.slice(start, start + 400_000);
  const end = rest.search(DESC_END);
  return end < 0 ? rest.slice(0, 60_000) : rest.slice(0, end);
}

/** The model year in the archived URL's title slug: "/ebaymotors/1965-65-Barn-Find-...", "/ebaymotors/68-Charger-RT-..."
 *  (two digits, 1920s-1990s), or a four-digit year among the first five words of "Chevrolet-Camaro-1969-RS-...". */
export function slugYear(url: string): string | undefined {
  const words = (url.match(/\/ebaymotors\/([^/?_]+)/)?.[1] ?? "").split("-").filter(Boolean);
  const four = words.slice(0, 5).find((w) => /^(?:19|20)\d\d$/.test(w));
  if (four) return four;
  const two = words[0]?.match(/^'?([2-9]\d)$/)?.[1];
  return two ? `19${two}` : undefined;
}

export function parseArchivedItemPage(html: string, originalUrl = ""): ArchivedItemPage {
  const text = textOf(html);
  const titleTag = decode(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const tagTitle = titleTag.replace(/^eBay Motors:\s*/i, "").replace(/\s*\(item \d+.*$/i, "").replace(/\s*[|:]\s*eBay( Motors)?.*$/i, "").replace(/\s+-\s+eBay( Motors)?$/i, "").replace(/\s+in\s+[^|]+$/, "").trim();
  const title = (h1 ? textOf(h1) : "") || tagTitle || null;
  const itemId = text.match(/Item number:\s*(\d{9,13})/)?.[1] ?? titleTag.match(/\(item (\d{9,13})/)?.[1] ?? null;

  const endedM = text.match(/Ended:\s*([A-Z][a-z]{2}[- ]\d{1,2},?[- ]\d{2,4} \d{1,2}:\d{2}:\d{2} P[SD]T)/)
    ?? titleTag.match(/end time\s+([A-Z][a-z]{2}-\d{1,2}-\d{2} \d{1,2}:\d{2}:\d{2} P[SD]T)/);
  const endedText = endedM?.[1] ?? null;
  const bidsM = text.match(/Bid history:\s*(\d+) bids?/) ?? text.match(/\b(\d+) bids?\b/);
  const bids = bidsM ? Number(bidsM[1]) : null;
  const winning = text.match(/Winning bid:\s*US \$([\d,]+(?:\.\d\d)?)/);
  const soldFor = text.match(/Sold [Ff]or:\s*US \$([\d,]+(?:\.\d\d)?)/);
  const current = text.match(/Current bid:\s*US \$([\d,]+(?:\.\d\d)?)/);
  const starting = text.match(/Starting bid:\s*US \$([\d,]+(?:\.\d\d)?)/);
  const price = text.match(/Price:\s*US \$([\d,]+(?:\.\d\d)?)/);
  const reserveNotMet = /Reserve (price )?not met/i.test(text);
  const ended = !!endedText || /Bidding has ended|This listing has ended|listing was ended/i.test(text);
  const bySeller = /listing was ended by the seller/i.test(text);

  let outcome: ArchivedOutcome, priceShown: number | null = null, priceLabel: string | null = null;
  if (winning) { outcome = "winning_bid"; priceShown = money(winning[1]); priceLabel = "Winning bid"; }
  else if (soldFor) { outcome = "sold_for"; priceShown = money(soldFor[1]); priceLabel = "Sold For"; }
  else if (!ended) { outcome = "live"; const p = current ?? starting ?? price; priceShown = money(p?.[1]); priceLabel = current ? "Current bid" : starting ? "Starting bid" : price ? "Price" : null; }
  else if (bySeller) { outcome = "ended_by_seller"; const p = current ?? price ?? starting; priceShown = money(p?.[1]); priceLabel = current ? "Current bid" : price ? "Price" : starting ? "Starting bid" : null; }
  else if (reserveNotMet && current) { outcome = "reserve_not_met"; priceShown = money(current[1]); priceLabel = "Current bid"; }
  else if (bids === 0) { outcome = "ended_no_bids"; const p = starting ?? price; priceShown = money(p?.[1]); priceLabel = starting ? "Starting bid" : price ? "Price" : null; }
  else { outcome = "ended"; const p = current ?? price ?? starting; priceShown = money(p?.[1]); priceLabel = current ? "Current bid" : price ? "Price" : starting ? "Starting bid" : null; }

  const specifics = specificsOf(text);
  if (specifics["Location"]) specifics["Location"] = specifics["Location"].replace(/\s+Vehicle Information.*$/i, "").trim();
  // 2006-2011 pages print no Year/Make/Model fields: the title tag reads "Make : Model", and the year is in the history
  // summary ("Summary for 1977 International Harvester Scout"), the heading, or the archived URL's title slug.
  const ymm = tagTitle.match(/^([^:|]+?)\s*:\s*([^:|]+)$/);
  if (!specifics["Make"] && ymm) specifics["Make"] = ymm[1].trim();
  if (!specifics["Model"] && ymm) specifics["Model"] = ymm[2].trim();
  if (!specifics["Year"]) {
    const y = text.match(/Summary for ((?:19|20)\d\d) /)?.[1] ?? title?.match(/^((?:19|20)\d\d)\b/)?.[1] ?? slugYear(originalUrl);
    if (y) specifics["Year"] = y;
  }
  // Still no Make/Model: the heading's "1977 Toyota Corolla" (eBay's category word "Other" is not a model).
  const head = title?.match(/^(?:19|20)\d\d\s+(\S+)\s+(?:Other\s+)?(\S+)/);
  if (!specifics["Make"] && head) specifics["Make"] = head[1];
  if (!specifics["Model"] && head && head[2].toLowerCase() !== "other") specifics["Model"] = head[2];
  // Last: the archived URL's title slug ("/ebaymotors/1978-Ferrari-400-GT-Rare-..."), which the seller typed.
  const slug = originalUrl.match(/\/ebaymotors\/((?:19|20)\d\d)-([A-Za-z][A-Za-z]+)-([A-Za-z0-9]+)/);
  if (!specifics["Make"] && slug) specifics["Make"] = slug[2];
  if (!specifics["Model"] && slug && specifics["Make"]?.toLowerCase() === slug[2].toLowerCase()) specifics["Model"] = slug[3];
  for (const k of ["Mileage", "Year"]) {
    const n = specifics[k]?.match(/^[\d,.]+(?:\s*(?:miles?|km))?/i)?.[0];
    if (specifics[k] !== undefined) { if (n) specifics[k] = n; else delete specifics[k]; }
  }
  const seller = text.match(/Seller info\s+(?:Member id\s+)?([A-Za-z0-9._*\-]{2,64})\s*\(\s*(?:Feedback Score Of\s*)?(\d+)\s*\)/);
  const descHtml = descriptionHtml(html), photos = photosOf(html, itemId);
  return {
    itemId, title, outcome, endedAt: endedText ? endedAtIso(endedText) : null, endedText, priceShown, priceLabel, bids,
    reserveNotMet, specifics,
    location: specifics["Location"] ?? text.match(/Item [Ll]ocation:\s*([^:]{3,80}?)(?:,\s*United States)?\s+(?:A reserve|Seller info|Ships to|Shipping|Sells to|Coverage|Start of layer)/)?.[1]?.trim() ?? null,
    sellerUsername: seller?.[1] ?? null, sellerFeedbackCount: seller ? Number(seller[2]) : null,
    description: textOf(descHtml).slice(0, 20000), images: photos.map((s) => s[0]), photoSizes: photos,
  };
}

/** The page in the shape every eBay door lands through (toLanding); photos point at their archived copies, and only the
 *  photos the archive was found to serve (`held`, from archivedPhotos) land. The page's full photo list stays on the page. */
export function archivedPageToItem(p: ArchivedItemPage, timestamp: string, held: string[]): EbayItem {
  const images = held.map((u) => archivedImageUrl(timestamp, u));
  const [city, state] = (p.location ?? "").split(",").map((s) => s.trim());
  const auction = p.bids !== null || /bid/i.test(p.priceLabel ?? "");
  const mileage = p.specifics["Mileage"]?.replace(/\s*miles?$/i, "");
  const vin = plausibleVin(p.specifics["VIN"]);
  const aspects: Record<string, string> = { ...p.specifics, ...(mileage ? { Mileage: mileage } : {}) };
  if (vin) aspects["VIN"] = vin; else delete aspects["VIN"];
  return {
    itemId: p.itemId ? `v1|${p.itemId}|0` : undefined, legacyItemId: p.itemId ?? undefined, title: p.title ?? undefined, description: p.description,
    price: p.priceShown != null ? { value: String(p.priceShown), currency: "USD" } : undefined,
    currentBidPrice: auction && p.priceShown != null ? { value: String(p.priceShown), currency: "USD" } : undefined,
    bidCount: p.bids ?? undefined, buyingOptions: auction ? ["AUCTION"] : ["FIXED_PRICE"],
    itemLocation: city ? { city, stateOrProvince: state } : undefined,
    image: images[0] ? { imageUrl: images[0] } : undefined, additionalImages: images.slice(1).map((u) => ({ imageUrl: u })),
    localizedAspects: Object.entries(aspects).map(([name, value]) => ({ name, value })),
    seller: { username: p.sellerUsername ?? undefined, feedbackScore: p.sellerFeedbackCount ?? undefined },
    itemEndDate: p.endedAt ?? undefined, condition: p.specifics["Item condition"],
  };
}
