/**
 * _shared/craigslistAttributes.ts
 *
 * The attribute block of a Craigslist vehicle post, read from the page the pipeline already fetched.
 * Pure: no I/O and no Deno APIs (the clock is read only to refuse a date in the future). Imported by extract-craigslist (reads it), extract-vehicle-data-ai
 * (carries it), ingest (lands it) and poll-listing-feeds (keeps it on the queue ledger).
 *
 * The page (2026-10-06, 643 stored detail pages) is:
 *   <div class="attrgroup">
 *     <div class="attr important"><span class="valu year">1975</span> <span class="valu makemodel"><a>chevy k10</a></span></div>
 *   </div>
 *   <div class="attrgroup">
 *     <div class="attr auto_vin"><span class="labl">VIN:</span> <span class="valu">CKY145Z123456</span></div>
 *     <div class="attr auto_miles"><span class="labl">odometer:</span> <span class="valu">96,213</span></div>
 *     <div class="attr auto_title_status"><span class="labl">title status:</span> <span class="valu"><a href="...">clean</a></span></div>
 *     ...
 *   </div>
 *   <div class="attrgroup">   <!-- flags: no label -->
 *     <div class="attr odometer_broken"><span class="valu">odometer broken</span></div>
 *   </div>
 *   ... <p class="postinginfo">post id: 7000000001</p>
 *       <p class="postinginfo reveal">posted: <time class="date timeago" datetime="2026-01-02T03:04:05-0800">..</time></p>
 * The rows are keyed by Craigslist's own class (auto_vin, auto_miles, ...), which does not change with the display
 * language. The older pages used <p class="attrgroup"><span>VIN: <b>..</b></span></p>; that form is read too.
 *
 * What a VIN row is worth. The seller types it, so the text is kept exactly (vin_raw) and `vin` is set only when the
 * text is identity-grade, by the same rules the database already applies to a VIN:
 *   - enforce_vin_uniqueness treats under 11 characters as "not a real VIN";
 *   - flag_vin_structurally_suspect: a modern VIN (17 characters, or year >= 1981) must be 17 characters with a valid
 *     ISO 3779 check digit; a classic VIN is 5 to 16 characters;
 *   - extract-bat-core v4.3.0 (2026-10-04): a 17-character VIN that fails its check digit is a receipt, never the VIN.
 * Anything else stays in vin_raw with the reason in vin_rejected. Nothing here guesses a VIN from the description.
 */

import { decodeHtmlEntities } from "./normalizeVehicle.ts";
import { vinCheckDigitOk } from "./batAuctionRecord.ts";

/** Same cut-off as public.enforce_vin_uniqueness(): under 11 characters is not an identity. */
export const MIN_IDENTITY_VIN_LENGTH = 11;

// The block is a dozen short rows. These bounds only stop a malformed page from bloating the queue ledger and the observation.
const MAX_RAW_ROWS = 40;
const MAX_RAW_VALUE = 300;

export interface CraigslistAttributes {
  /** Identity-grade VIN (see judgeVin), else null. */
  vin: string | null;
  /** The VIN row exactly as the seller typed it (whitespace collapsed), else null when the post has no VIN row. */
  vin_raw: string | null;
  /** Why vin_raw was not accepted as the VIN; null when accepted or when there is no VIN row. */
  vin_rejected: string | null;
  /** Odometer in miles, whole number; null when the row is absent or not a plain number. */
  odometer: number | null;
  odometer_raw: string | null;
  /** The two disclosure rows Craigslist shows beside the odometer. */
  odometer_broken: boolean;
  odometer_rolled_over: boolean;
  title_status: string | null;
  condition: string | null;
  transmission: string | null;
  drive: string | null;
  fuel: string | null;
  cylinders: string | null;
  paint_color: string | null;
  type: string | null;
  /** Every row on the page, verbatim, keyed by Craigslist's class (auto_vin, auto_miles, odometer_broken, year, makemodel, ...). */
  raw: Record<string, string>;
}

/**
 * Where the post says the vehicle is: JSON-LD offers.availableAtOrFrom, else the map element's point. The street line
 * is never read. Craigslist's map point is approximate (it moves the pin), so it is a city-grain place, not an address.
 */
export interface CraigslistPlace {
  locality: string | null;
  /** Two-letter US state, DC, PR or Canadian province. */
  region: string | null;
  postal_code: string | null;
  /** Two-letter country. */
  country: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** The seller class the page states: its breadcrumb links back to the search it belongs to, with purveyor=owner or dealer. */
export interface CraigslistSellerClass {
  value: "owner" | "dealer";
  field: "purveyor";
  /** The search link the page carries, a short quote. */
  text: string;
}

export function parseSellerClass(html: string): CraigslistSellerClass | null {
  const m = /search\/[^"'<>\s]*?[?&]purveyor=(owner|dealer)\b[^"'<>\s]*/i.exec(html);
  if (!m) return null;
  return { value: m[1].toLowerCase() as "owner" | "dealer", field: "purveyor", text: m[0].replace(/&amp;/g, "&").slice(0, 120) };
}

export interface CraigslistCapture {
  /** Craigslist's own post id (digits), read from the page. Not the share token. */
  post_id: string | null;
  /** The post's own clocks, ISO 8601 UTC. */
  posted_at: string | null;
  updated_at: string | null;
  attributes: CraigslistAttributes;
  place?: CraigslistPlace;
  /** Archive receipt, carried only by the fetching extractor. Not the processing clock. */
  source_capture?: { snapshot_id: string; observed_at: string };
  asking_price?: number | null;
  seller_class?: CraigslistSellerClass;
}

// ─── text helpers ────────────────────────────────────────────────────────

/**
 * Remove tags by scanning for `<` ... `>`, not with a regex replace: the output can never contain a `<` that a
 * previous removal left behind (`<scr<script>ipt>` becomes `ipt>`). An unclosed `<` is kept as text.
 */
export function stripTags(fragment: string, replacement = ""): string {
  let out = "";
  let i = 0;
  for (;;) {
    const open = fragment.indexOf("<", i);
    if (open < 0) return out + fragment.slice(i);
    const close = fragment.indexOf(">", open + 1);
    if (close < 0) return out + fragment.slice(i);
    out += fragment.slice(i, open) + replacement;
    i = close + 1;
  }
}

/** Remove HTML comments by scanning. An unterminated comment runs to the end of the page, as a browser reads it. */
function withoutComments(html: string): string {
  let out = "";
  let i = 0;
  for (;;) {
    const open = html.indexOf("<!--", i);
    if (open < 0) return out + html.slice(i);
    out += html.slice(i, open);
    const close = html.indexOf("-->", open + 4);
    if (close < 0) return out;
    i = close + 3;
  }
}

function cleanText(fragment: string): string {
  return (decodeHtmlEntities(stripTags(fragment, " ")) ?? "").replace(/\s+/g, " ").trim();
}

// ─── rows ────────────────────────────────────────────────────────────────

interface Row {
  key: string;
  value: string;
}

/** Display label (lower case, colon removed) -> Craigslist class, for the paragraph markup and for unknown classes. */
const LABEL_KEYS: Record<string, string> = {
  "vin": "auto_vin",
  "odometer": "auto_miles",
  "title status": "auto_title_status",
  "condition": "condition",
  "transmission": "auto_transmission",
  "drive": "auto_drivetrain",
  "fuel": "auto_fuel_type",
  "cylinders": "auto_cylinders",
  "paint color": "auto_paint",
  "type": "auto_bodytype",
  "size": "auto_size",
};

const FLAG_PHRASES: Record<string, string> = {
  "odometer broken": "odometer_broken",
  "odometer rolled over": "odometer_rolled_over",
};

function readDivRows(head: string): Row[] {
  const start = head.search(/<div\b[^>]*\bclass="[^"]*\battrgroup\b[^"]*"/i);
  if (start < 0) return [];
  const region = head.slice(start);
  const rows: Row[] = [];
  const rowRe = /<div\b[^>]*\bclass="attr\s+([^"]*)"[^>]*>([\s\S]*?)<\/div>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(region)) !== null) {
    const rowKey = m[1].trim().split(/\s+/)[0];
    const inner = m[2];
    const label = inner.match(/<span\b[^>]*\bclass="[^"]*\blabl\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const labelKey = label ? LABEL_KEYS[cleanText(label[1]).replace(/:\s*$/, "").toLowerCase()] : undefined;
    // `important` is the one row that carries two value spans (valu year, valu makemodel): each keeps its own key.
    const valueRe = /<span\b[^>]*\bclass="([^"]*\bvalu\b[^"]*)"[^>]*>([\s\S]*?)<\/span>/gi;
    let v: RegExpExecArray | null;
    let found = false;
    while ((v = valueRe.exec(inner)) !== null) {
      found = true;
      const extra = v[1].trim().split(/\s+/).filter((t) => t && t !== "valu");
      const key = extra[0] ?? (rowKey === "important" ? "important" : (labelKey ?? rowKey));
      rows.push({ key, value: cleanText(v[2]) });
    }
    if (!found) {
      const rest = inner.replace(/<span\b[^>]*\bclass="[^"]*\blabl\b[^"]*"[^>]*>[\s\S]*?<\/span>/i, "");
      const text = cleanText(rest);
      if (text) rows.push({ key: labelKey ?? rowKey, value: text });
    }
  }
  return rows;
}

/** The pre-redesign markup: <p class="attrgroup"><span>VIN: <b>..</b></span>... Only the labelled form is read. */
function readParagraphRows(head: string): Row[] {
  const rows: Row[] = [];
  const groupRe = /<p\b[^>]*\bclass="[^"]*\battrgroup\b[^"]*"[^>]*>([\s\S]*?)<\/p>/gi;
  let g: RegExpExecArray | null;
  while ((g = groupRe.exec(head)) !== null) {
    const spanRe = /<span\b[^>]*>([\s\S]*?)<\/span>/gi;
    let s: RegExpExecArray | null;
    while ((s = spanRe.exec(g[1])) !== null) {
      const text = cleanText(s[1]);
      if (!text) continue;
      const flag = FLAG_PHRASES[text.toLowerCase()];
      if (flag) {
        rows.push({ key: flag, value: text });
        continue;
      }
      const colon = text.indexOf(":");
      if (colon > 0) {
        const label = text.slice(0, colon).trim().toLowerCase();
        const key = LABEL_KEYS[label];
        if (key) rows.push({ key, value: text.slice(colon + 1).trim() });
      } else if (!rows.some((r) => r.key === "makemodel")) {
        // the title line, "2008 ford f250": the year and the make-and-model, as the new markup gives them
        const t = text.match(/^(\d{4})\s+(.+)$/);
        if (t) rows.push({ key: "year", value: t[1] }, { key: "makemodel", value: t[2] });
        else rows.push({ key: "makemodel", value: text });
      }
    }
  }
  return rows;
}

// ─── odometer ────────────────────────────────────────────────────────────

export function parseOdometer(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, "");
  if (!/^\d{1,3}(,\d{3})+$/.test(t) && !/^\d+$/.test(t)) return null;
  const n = parseInt(t.replace(/,/g, ""), 10);
  return Number.isFinite(n) && n >= 0 && n < 10_000_000 ? n : null;
}

// ─── VIN ─────────────────────────────────────────────────────────────────

export interface VinJudgement {
  vin: string | null;
  raw: string | null;
  rejected: string | null;
}

/**
 * Decide whether the seller's VIN text may be used as the vehicle's identity.
 * `year` is the post's own model year (the `important` row); a modern vehicle (year >= 1981) must carry 17 characters.
 */
export function judgeVin(rawText: string | null | undefined, year: number | null): VinJudgement {
  const raw = rawText ? rawText.replace(/\s+/g, " ").trim() : "";
  if (!raw) return { vin: null, raw: null, rejected: null };
  const reject = (reason: string): VinJudgement => ({ vin: null, raw, rejected: reason });

  const compact = raw.toUpperCase().replace(/[\s\-._]/g, "");
  if (!/^[A-Z0-9]+$/.test(compact)) return reject("not_vin_shaped");
  // I, O and Q are not VIN characters; the shared normalizer would drop them silently and change the number.
  if (/[IOQ]/.test(compact)) return reject("illegal_letters");
  if (compact.length < MIN_IDENTITY_VIN_LENGTH) return reject("too_short");
  if (compact.length > 17) return reject("too_long");
  if (/^(.)\1+$/.test(compact)) return reject("placeholder");
  if (compact.replace(/\D/g, "").length < 4) return reject("not_enough_digits");
  if (/0{6}$/.test(compact)) return reject("masked_serial");

  if (compact.length === 17) {
    if (vinCheckDigitOk(compact) === false) return reject("check_digit_failed");
  } else {
    if (year === null) return reject("year_unknown");
    if (year >= 1981) return reject("length_vs_year");
  }
  return { vin: compact, raw, rejected: null };
}

// ─── the post's own clocks ───────────────────────────────────────────────

function toIsoUtc(datetime: string | null | undefined): string | null {
  if (!datetime) return null;
  // Craigslist writes the offset without a colon (datetime="2026-01-02T03:04:05-0800"); V8 reads that form.
  const t = Date.parse(datetime.trim());
  if (!Number.isFinite(t)) return null;
  if (t < Date.parse("2000-01-01T00:00:00Z") || t > Date.now() + 2 * 86_400_000) return null;
  return new Date(t).toISOString();
}

export function parsePostInfo(
  html: string,
  url?: string | null,
): { post_id: string | null; posted_at: string | null; updated_at: string | null } {
  // Each is read from its own <p class="postinginfo"> line, so a seller who types "post id: 123456" in the text
  // cannot become the post's id.
  const info = (label: string) => new RegExp(`<p\\b[^>]*\\bclass="[^"]*\\bpostinginfo\\b[^"]*"[^>]*>\\s*${label}:\\s*`, "i");
  const afterLabel = (label: string): string | null => {
    const m = html.match(info(label));
    return m && m.index !== undefined ? html.slice(m.index + m[0].length, m.index + m[0].length + 200) : null;
  };
  const postId = afterLabel("post id")?.match(/^(\d{6,})/)?.[1] ??
    (url ? url.match(/\/(\d{8,})\.html(?:[?#].*)?$/)?.[1] : undefined) ?? null;
  const stamp = (label: string) => afterLabel(label)?.match(/^<time\b[^>]*\bdatetime="([^"]+)"/i)?.[1] ?? null;
  return { post_id: postId, posted_at: toIsoUtc(stamp("posted")), updated_at: toIsoUtc(stamp("updated")) };
}

// ─── the block ───────────────────────────────────────────────────────────

function asYear(text: string | undefined): number | null {
  const n = text && /^\d{4}$/.test(text.trim()) ? parseInt(text.trim(), 10) : NaN;
  return Number.isFinite(n) && n >= 1885 && n <= new Date().getFullYear() + 2 ? n : null;
}

/** The page above the seller's text, comments removed: the only place the attribute rows are read from. */
function aboveThePostingBody(html: string): string {
  const doc = withoutComments(html);
  const bodyAt = doc.indexOf('id="postingbody"');
  return bodyAt > 0 ? doc.slice(0, bodyAt) : doc;
}

export function parseAttributes(html: string): CraigslistAttributes {
  const head = aboveThePostingBody(html);
  let rows = readDivRows(head);
  if (rows.length === 0) rows = readParagraphRows(head);

  const raw: Record<string, string> = {};
  for (const r of rows) {
    if (r.key in raw || Object.keys(raw).length >= MAX_RAW_ROWS) continue;
    raw[r.key] = r.value.slice(0, MAX_RAW_VALUE);
  }
  const str = (k: string): string | null => (raw[k] ? raw[k] : null);

  const vin = judgeVin(raw["auto_vin"], asYear(raw["year"]));
  return {
    vin: vin.vin,
    vin_raw: vin.raw,
    vin_rejected: vin.rejected,
    odometer: parseOdometer(raw["auto_miles"]),
    odometer_raw: str("auto_miles"),
    odometer_broken: "odometer_broken" in raw,
    odometer_rolled_over: "odometer_rolled_over" in raw,
    title_status: str("auto_title_status"),
    condition: str("condition"),
    transmission: str("auto_transmission"),
    drive: str("auto_drivetrain"),
    fuel: str("auto_fuel_type"),
    cylinders: str("auto_cylinders"),
    paint_color: str("auto_paint"),
    type: str("auto_bodytype"),
    raw,
  };
}

// ─── the post's place ────────────────────────────────────────────────────

const REGIONS = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "PR",
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT",
]);

function placeText(v: unknown, re: RegExp): string | null {
  return typeof v === "string" && re.test(v.trim()) ? v.trim() : null;
}

function placeCoord(v: unknown, max: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d{1,3}(\.\d{1,8})?$/.test(v.trim()) ? parseFloat(v) : NaN;
  return Number.isFinite(n) && Math.abs(n) <= max ? n : null;
}

/** Validate a place field by field, wherever it came from. Null when nothing usable is left. */
export function cleanPlace(src: Record<string, unknown> | null | undefined): CraigslistPlace | null {
  if (!src) return null;
  const region = placeText(src.region, /^[A-Z]{2}$/);
  const postal = placeText(src.postal_code, /^(\d{5}(-\d{4})?|[A-Z]\d[A-Z] ?\d[A-Z]\d)$/i);
  let latitude = placeCoord(src.latitude, 90);
  let longitude = placeCoord(src.longitude, 180);
  // 0,0 is a placeholder, not a place; a point needs both halves.
  if (latitude === null || longitude === null || (latitude === 0 && longitude === 0)) latitude = longitude = null;
  const place: CraigslistPlace = {
    locality: placeText(src.locality, /^[\p{L}\p{N} .,'&()\/-]{1,80}$/u),
    region: region && REGIONS.has(region) ? region : null,
    postal_code: postal && !/^0{5}/.test(postal) ? postal.toUpperCase() : null,
    country: placeText(src.country, /^[A-Z]{2}$/),
    latitude,
    longitude,
  };
  return place.locality || place.region || place.postal_code || place.latitude !== null ? place : null;
}

/** JSON-LD offers.availableAtOrFrom (address and geo), else the map element. The street line is never read. */
export function parsePlace(html: string): CraigslistPlace | null {
  let at: Record<string, any> | null = null;
  const ld = html.match(/<script type="application\/ld\+json" id="ld_posting_data"\s*>([\s\S]*?)<\/script>/);
  if (ld) {
    try {
      const v = JSON.parse(ld[1])?.offers?.availableAtOrFrom;
      at = v && typeof v === "object" ? v : null;
    } catch { at = null; }
  }
  const address = at?.address && typeof at.address === "object" ? at.address : {};
  const map = html.match(/<div\b[^>]*\bid="map"[^>]*>/)?.[0] ?? "";
  const mapAttr = (name: string) => map.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
  return cleanPlace({
    locality: address.addressLocality,
    region: address.addressRegion,
    postal_code: address.postalCode,
    country: address.addressCountry,
    latitude: at?.geo?.latitude ?? mapAttr("data-latitude"),
    longitude: at?.geo?.longitude ?? mapAttr("data-longitude"),
  });
}

export function parseCapture(html: string, url?: string | null): CraigslistCapture {
  const place = parsePlace(html);
  const sellerClass = parseSellerClass(html);
  return { ...parsePostInfo(html, url), attributes: parseAttributes(html), ...(place ? { place } : {}), ...(sellerClass ? { seller_class: sellerClass } : {}) };
}

/** A page that is not a post (blocked, expired, search results) parses to nothing; nothing is then recorded. */
export function captureHasContent(c: CraigslistCapture | null | undefined): boolean {
  if (!c) return false;
  return Object.keys(c.attributes.raw).length > 0;
}

// ─── carrying it between functions ───────────────────────────────────────

const STRING_FIELDS = [
  "vin", "vin_raw", "vin_rejected", "odometer_raw", "title_status", "condition", "transmission", "drive", "fuel",
  "cylinders", "paint_color", "type",
] as const;

const nullableString = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
// The clocks end up in timestamptz columns, where one malformed value would fail the whole gap-fill UPDATE.
const isoUtcOrNull = (v: unknown): string | null =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(v) && Number.isFinite(Date.parse(v)) ? v : null;

/**
 * Re-read a capture that travelled as JSON (extractor response, ingest response). Anything that is not the shape
 * parseAttributes produces is dropped field by field, so one extractor cannot put a malformed object on a vehicle.
 * Returns null when the object is not a Craigslist capture (no `attributes.raw` map), which is the case for every
 * other source.
 */
export function pickCapture(obj: unknown): CraigslistCapture | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const a = o.attributes;
  if (!a || typeof a !== "object") return null;
  const src = a as Record<string, unknown>;
  if (!src.raw || typeof src.raw !== "object" || Array.isArray(src.raw)) return null;

  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(src.raw as Record<string, unknown>)) {
    if (typeof v === "string" && Object.keys(raw).length < MAX_RAW_ROWS) raw[k.slice(0, 60)] = v.slice(0, MAX_RAW_VALUE);
  }

  const attributes: CraigslistAttributes = {
    vin: null, vin_raw: null, vin_rejected: null, odometer: null, odometer_raw: null,
    odometer_broken: src.odometer_broken === true, odometer_rolled_over: src.odometer_rolled_over === true,
    title_status: null, condition: null, transmission: null, drive: null, fuel: null, cylinders: null,
    paint_color: null, type: null, raw,
  };
  for (const f of STRING_FIELDS) attributes[f] = nullableString(src[f]);
  attributes.odometer = typeof src.odometer === "number" && Number.isInteger(src.odometer) && src.odometer >= 0 ? src.odometer : null;

  const capture: CraigslistCapture = {
    post_id: typeof o.post_id === "string" && /^\d{6,}$/.test(o.post_id) ? o.post_id : null,
    posted_at: isoUtcOrNull(o.posted_at),
    updated_at: isoUtcOrNull(o.updated_at),
    attributes,
  };
  const receipt = o.source_capture as Record<string, unknown> | undefined;
  const clock = receipt && isoUtcOrNull(receipt.observed_at);
  if (receipt && typeof receipt.snapshot_id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(receipt.snapshot_id) && clock) {
    capture.source_capture = { snapshot_id: receipt.snapshot_id, observed_at: clock };
  }
  const price = o.asking_price ?? o.price;
  if (typeof price === "number" && Number.isFinite(price) && price >= 0) capture.asking_price = price;
  const place = o.place && typeof o.place === "object" ? cleanPlace(o.place as Record<string, unknown>) : null;
  if (place) capture.place = place;
  return captureHasContent(capture) ? capture : null;
}

/**
 * The keys a capture adds to a response or a queue row. Empty for anything that is not a Craigslist capture, so a
 * source that never produced one is returned byte-for-byte as before.
 */
export function captureFields(obj: unknown): Record<string, unknown> {
  const c = pickCapture(obj);
  return c ? { post_id: c.post_id, posted_at: c.posted_at, updated_at: c.updated_at, attributes: c.attributes,
    ...(c.source_capture ? { source_capture: c.source_capture } : {}),
    ...(c.asking_price !== undefined ? { asking_price: c.asking_price } : {}),
    ...(c.place ? { place: c.place } : {}) } : {};
}
