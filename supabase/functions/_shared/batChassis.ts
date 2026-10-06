/**
 * _shared/batChassis.ts — the "Chassis:" / "VIN:" line of a Bring a Trailer lot page, read once, for every reader.
 *
 * BaT states the identity of the car in the Listing Details list of the BaT Essentials block:
 *   <li>Chassis: <a href="https://www.google.com/search?q=11111111111111111" target="_blank">11111111111111111</a></li>
 *   <li>Chassis: AB12345</li>
 * (measured 2026-10-06 on 20,000 saved lot pages: 96% state one; 85% of those as the anchor form, 15% as plain text;
 * the label is "Chassis" on all but 23 pages, which say "VIN"). The value is whatever the seller typed: a modern
 * 17-character VIN, or a short chassis number for a pre-1981 car, an import, a motorcycle. Every identifier in this
 * file and its test is invented.
 *
 * Why this exists. extract-bat-core read the line with /^(?:VIN|Chassis)\s*:\s*([A-HJ-NPR-Z0-9]{11,17})\b/i
 * (commit 516a24c53, 2026-02-14: "minimum 11 chars, rejects garbage"; the garbage came from the whole-page chassis
 * regex of parseBaTHTML, not from this list item). On the 20,000 pages that rule turned away 19.8% of the statements
 * (3,789 of 19,144): 94% of those for being shorter than 11 characters, the rest for an I, O or Q in a short chassis
 * (real on old cars; illegal only in a 17-character VIN) or a separator ("XYZ30-12345", "AM300/3/0001", "XYZ30 12345").
 * The copy in _shared/batParser.ts took {3,17}; the SQL and snapshot parsers took other lengths. One reader now.
 *
 * What it accepts (a statement is read from the list item; the value is landed only if it passes):
 *   - 17 characters of the VIN alphabet (no I, O, Q) whose ISO 3779 check digit passes  -> kind "vin17"
 *   - 5 to 16 characters (up to 20 when it has separators), letters and digits with single "-" "/" "." between
 *     groups, at least one digit, whitespace inside the value removed ("XYZ30 12345" -> "XYZ3012345") -> kind "chassis"
 *     (5-16 is the range trg_flag_vin_structurally_suspect calls plausible for a short VIN; of the 5-character
 *     statements on those pages 97% belong to pre-1981 cars, median model year 1959. extractionQualityGate still nulls
 *     a VIN under 6 characters in an INSERT payload; a short chassis never travels in the INSERT, see below)
 * What it refuses, and says why in `rejected` (the statement itself is still returned):
 *   empty, placeholder (N/A, Unknown, XXXXX...), multiple (two identifiers), prose (a word in the value),
 *   bad_chars, no_digit, too_short (<5), too_long (>17, or >20 with separators), vin_illegal_chars (17 characters
 *   with I/O/Q), check_digit (17 characters that fail the ISO 3779 check digit; the caller keeps its receipt).
 *
 * Nothing here decides identity. A short chassis is shared between makes more often than a VIN is, so
 * isIdentityGradeVin() names the region the identity lookups (find_vehicle_by_vin) already trusted before this
 * file existed: 11-17 characters of the VIN alphabet. Callers resolve a lot to an existing vehicle by VIN only
 * inside that region and land everything else on the row without letting it pick the vehicle.
 */
import { vinCheckDigitOk } from "./batAuctionRecord.ts";

export type BatChassisLabel = "Chassis" | "VIN";
export type BatChassisForm = "html-anchor" | "html-plain" | "markdown";
export type BatChassisKind = "vin17" | "chassis";
export type BatChassisRejection =
  | "empty" | "placeholder" | "multiple" | "prose" | "bad_chars" | "no_digit"
  | "too_short" | "too_long" | "vin_illegal_chars" | "check_digit";

export interface BatChassisRead {
  /** label the page used */
  label: BatChassisLabel;
  /** the statement as the page gives it: tags stripped, entities decoded, whitespace collapsed */
  raw: string;
  /** how the page wrote it (set by readBatChassis; chassisFromListItemText leaves it null) */
  form: BatChassisForm | null;
  /** identifier to land: uppercase, whitespace removed. null when the statement was refused */
  value: string | null;
  /**
   * The normalized identifier of a statement refused only for its check digit (17 characters of the VIN alphabet).
   * extract-bat-core keeps its receipt (vinRejected) and the archive loader keeps the value flagged, as before.
   */
  candidate: string | null;
  kind: BatChassisKind | null;
  /** ISO 3779 result; only a 17-character value has one */
  checkDigitOk: boolean | null;
  rejected: BatChassisRejection | null;
}

export interface BatChassisDocument {
  /** the first Chassis/VIN line in the Listing Details list (or null: the page states none) */
  read: BatChassisRead | null;
  /** how many Chassis/VIN lines the list holds; more than one means a pair or a car with a trailer */
  statements: number;
}

const ENTITY: Record<string, string> = { amp: "&", nbsp: " ", quot: '"', apos: "'", lt: "<", gt: ">", ndash: "-", mdash: "-" };

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16) || 32))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10) || 32))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITY[n.toLowerCase()] ?? m);
}

/** visible text of an HTML fragment: tags out, entities decoded, NBSP and zero-width characters to space, collapsed */
function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/[\u00a0\u2007\u202f\u200b-\u200f\u2060\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ITEM = /^(vin|chassis)\s*:\s*(.*)$/i;
// "Chassis: VIN# 123", "Chassis: Chassis: 123"
const REPEATED_LABEL = /^(?:(?:vin|chassis)\s*(?:#|no\.?|number)?\s*[:#]?\s*)+/i;
const PLACEHOLDER = /^(?:n\s*\/?\s*a|none|unknown|unk|tbd|tba|n\.a\.|not\s+(?:available|applicable|provided|listed|known|stated)|no\s+vin|-+|\?+)$/i;
const TWO_IDENTIFIERS = /\s(?:&|and|\+)\s|[;,]/i;
const SHAPE = /^[A-Z0-9]+(?:[-/.][A-Z0-9]+)*$/;

/** Read the value of one Chassis/VIN statement (the text after the label). */
function judge(label: BatChassisLabel, raw: string): BatChassisRead {
  const out: BatChassisRead = { label, raw, form: null, value: null, candidate: null, kind: null, checkDigitOk: null, rejected: null };
  const refuse = (why: BatChassisRejection): BatChassisRead => { out.rejected = why; return out; };

  let v = raw.replace(REPEATED_LABEL, "").trim();
  v = v.replace(/^[\s"'\u201c\u201d\u2018\u2019(\[*_`#]+|[\s"'\u201c\u201d\u2018\u2019)\]*_`.,;:]+$/g, "");
  if (!v) return refuse("empty");
  if (TWO_IDENTIFIERS.test(v)) return refuse("multiple");
  if (PLACEHOLDER.test(v) || /X{5,}/i.test(v) || /^0+$/.test(v)) return refuse("placeholder");

  const tokens = v.split(/\s+/);
  // whitespace is only ever a separator inside an identifier; a word of three letters or more is prose
  if (tokens.length > 1 && tokens.some((t) => /^[A-Za-z]{3,}$/.test(t))) return refuse("prose");
  const compact = tokens.join("").toUpperCase();
  if (!SHAPE.test(compact)) return refuse("bad_chars");
  if (!/\d/.test(compact)) return refuse("no_digit");

  const n = compact.length;
  // a separator marks a chassis number, never a VIN (a 17-character value such as "999.999-99-999999" is a chassis)
  const separated = /[-/.]/.test(compact);
  if (n < 5) return refuse("too_short");
  if (n > (separated ? 20 : 17)) return refuse("too_long");
  if (n === 17 && !separated) {
    if (/[IOQ]/.test(compact)) return refuse("vin_illegal_chars");
    const ok = vinCheckDigitOk(compact);
    out.checkDigitOk = ok;
    if (ok === false) { out.candidate = compact; return refuse("check_digit"); }
    out.value = compact;
    out.kind = "vin17";
    return out;
  }
  out.value = compact;
  out.kind = "chassis";
  return out;
}

/**
 * One Listing Details list item, already reduced to text ("Chassis: AB12345"). Returns null when the item is not a
 * Chassis/VIN line. The reader loops in extract-bat-core and batParser.extractEssentials call this per item.
 */
export function chassisFromListItemText(text: string): BatChassisRead | null {
  const m = ITEM.exec(textOf(text));
  if (!m) return null;
  return judge(m[1].toLowerCase() === "vin" ? "VIN" : "Chassis", m[2]);
}

function readMarkdown(md: string): BatChassisDocument {
  const at = md.search(/listing details/i);
  if (at < 0) return { read: null, statements: 0 };
  // the list starts on the heading's own line ("**Listing Details** Chassis: X") and runs as "- item" lines
  const slice = md.slice(at, at + 2500);
  const lines = slice.split(/\n/);
  const found: BatChassisRead[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && /^\s*(?:#{1,6}\s|\*\*[^*]+\*\*\s*$)/.test(lines[i]) && found.length) break; // next section
    const line = lines[i]
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [text](url) -> text
      .replace(/[*_`]{1,3}/g, " ")
      .replace(/^\s*[-+>\u2022]\s+/, "");
    const m = /(?:^|\s)(vin|chassis)\s*:\s*(.*)$/i.exec(textOf(line));
    if (!m) continue;
    const r = judge(m[1].toLowerCase() === "vin" ? "VIN" : "Chassis", m[2]);
    r.form = "markdown";
    found.push(r);
  }
  return { read: found[0] ?? null, statements: found.length };
}

/**
 * The page's own statement. `source` is a lot page's HTML (the BaT Essentials block is located the way
 * extract-bat-core locates it: a 50 KB window from <div class="essentials"), or its markdown.
 */
export function readBatChassis(source: string): BatChassisDocument {
  const s = String(source || "");
  if (!/<li[\s>]/i.test(s)) return readMarkdown(s);

  const at = s.indexOf('<div class="essentials"');
  const win = at >= 0 ? s.slice(at, at + 50000) : s;
  const ul = win.match(/<strong>Listing Details<\/strong>[\s\S]*?<ul>([\s\S]*?)<\/ul>/i);
  if (!ul?.[1]) return { read: null, statements: 0 };

  const found: BatChassisRead[] = [];
  const li = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = li.exec(ul[1])) !== null) {
    const r = chassisFromListItemText(m[1]);
    if (!r) continue;
    r.form = /<a[\s>]/i.test(m[1]) ? "html-anchor" : "html-plain";
    found.push(r);
  }
  return { read: found[0] ?? null, statements: found.length };
}

/**
 * The region identity lookups trusted before this reader existed: 11-17 characters of the VIN alphabet.
 * Inside it a value is rare enough across makes to pick a vehicle by (find_vehicle_by_vin, VIN-linked relists).
 * Outside it (a 5-10 character chassis, or one with I/O/Q or a separator) the value is landed on the row only.
 */
export function isIdentityGradeVin(value: string | null | undefined): boolean {
  return /^[A-HJ-NPR-Z0-9]{11,17}$/.test(String(value ?? ""));
}
