// EXIF clock helpers for derive-image-exif.
// DateTimeOriginal is a naive camera clock. Prefer OffsetTimeOriginal; otherwise interpret
// the wall time in America/Los_Angeles. Never treat a missing offset as UTC.

export const DEFAULT_EXIF_ZONE = "America/Los_Angeles";

export interface Exif {
  dateTimeOriginal?: string;
  offsetTimeOriginal?: string;
  make?: string;
  model?: string;
  raw: Record<string, unknown>;
}

export const TAG_MAKE = 0x010f;
export const TAG_MODEL = 0x0110;
export const TAG_EXIF_IFD = 0x8769;
export const TAG_DATETIME_ORIGINAL = 0x9003;
export const TAG_DATETIME_DIGITIZED = 0x9004;
export const TAG_DATETIME = 0x0132;
export const TAG_OFFSET_TIME = 0x9010;
export const TAG_OFFSET_TIME_ORIGINAL = 0x9011;
export const TAG_OFFSET_TIME_DIGITIZED = 0x9012;

const OFFSET_RE = /^[+-]\d{2}:\d{2}$/;

/** Convert a zoned wall time to a UTC ISO instant using Intl (no invented offset). */
export function wallTimeInZoneToUtcIso(
  y: number, mo: number, d: number, h: number, mi: number, se: number,
  zone = DEFAULT_EXIF_ZONE,
): string | null {
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const wanted = Date.UTC(y, mo - 1, d, h, mi, se);
  if (Number.isNaN(wanted)) return null;
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const wallMs = (ms: number) => {
    const parts = Object.fromEntries(
      dtf.formatToParts(new Date(ms)).filter((x) => x.type !== "literal").map((x) => [x.type, x.value]),
    );
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  };
  const asWall = wallMs(wanted);
  if (Number.isNaN(asWall)) return null;
  let utc = wanted + (wanted - asWall);
  const check = wallMs(utc);
  if (check !== wanted) utc = utc + (wanted - check);
  if (wallMs(utc) !== wanted) return null; // DST gap: the wall time does not exist
  const iso = new Date(utc).toISOString();
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/**
 * EXIF dates are "YYYY:MM:DD HH:MM:SS". When OffsetTimeOriginal (or a sibling offset) is
 * present, use it. Otherwise read the wall time in `zone` (America/Los_Angeles). Never UTC.
 */
export function exifDateToIso(s: string, offset?: string | null, zone = DEFAULT_EXIF_ZONE): string | null {
  const m = s.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], se = +m[6];
  if (m[1] === "0000" || !Number.isFinite(y) || mo < 1 || mo > 12 || d < 1) return null;
  const off = (offset ?? "").trim();
  if (OFFSET_RE.test(off)) {
    const sign = off[0] === "+" ? 1 : -1;
    const [oh, om] = off.slice(1).split(":").map(Number);
    const utc = Date.UTC(y, mo - 1, d, h, mi, se) - sign * (oh * 60 + om) * 60_000;
    const iso = new Date(utc).toISOString();
    return Number.isNaN(Date.parse(iso)) ? null : iso;
  }
  return wallTimeInZoneToUtcIso(y, mo, d, h, mi, se, zone);
}

export function parseExif(b: Uint8Array): Exif | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null; // not a JPEG
  let p = 2;
  while (p + 4 < b.length) {
    if (b[p] !== 0xff) { p++; continue; }
    const marker = b[p + 1];
    if (marker === 0xda) break;                    // start of scan: pixels from here
    const len = (b[p + 2] << 8) | b[p + 3];
    if (marker === 0xe1) {                         // APP1
      const s = p + 4;
      if (b[s] === 0x45 && b[s + 1] === 0x78 && b[s + 2] === 0x69 && b[s + 3] === 0x66) {
        return readTiff(b, s + 6);                 // skip "Exif\0\0"
      }
    }
    p += 2 + len;
  }
  return null;
}

function readTiff(b: Uint8Array, base: number): Exif | null {
  if (base + 8 > b.length) return null;
  const le = b[base] === 0x49 && b[base + 1] === 0x49;   // "II" little-endian, "MM" big
  const u16 = (o: number) => le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1];
  const u32 = (o: number) => le
    ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
    : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

  if (u16(base + 2) !== 0x2a) return null;
  const out: Exif = { raw: {} };

  const readIfd = (off: number) => {
    const at = base + off;
    if (at + 2 > b.length) return;
    const n = u16(at);
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12;
      if (e + 12 > b.length) return;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      const valOff = (type === 2 && count > 4) ? base + u32(e + 8) : e + 8;

      if (type === 2 && valOff + count <= b.length) {                 // ASCII
        const s = new TextDecoder().decode(b.subarray(valOff, valOff + count)).replace(/\0+$/, "").trim();
        if (tag === TAG_DATETIME_ORIGINAL) { out.dateTimeOriginal = s; out.raw.DateTimeOriginal = s; }
        else if (tag === TAG_DATETIME_DIGITIZED) out.raw.CreateDate = s;
        else if (tag === TAG_DATETIME && !out.dateTimeOriginal) out.raw.ModifyDate = s;
        else if (tag === TAG_MAKE) { out.make = s; out.raw.Make = s; }
        else if (tag === TAG_MODEL) { out.model = s; out.raw.Model = s; }
        else if (tag === TAG_OFFSET_TIME_ORIGINAL) { out.offsetTimeOriginal = s; out.raw.OffsetTimeOriginal = s; }
        else if (tag === TAG_OFFSET_TIME) out.raw.OffsetTime = s;
        else if (tag === TAG_OFFSET_TIME_DIGITIZED) out.raw.OffsetTimeDigitized = s;
      } else if (tag === TAG_EXIF_IFD) {
        readIfd(u32(e + 8));                                          // recurse into ExifIFD
      }
    }
  };

  readIfd(u32(base + 4));
  // Prefer DateTimeOriginal; accept DateTimeDigitized rather than inventing a clock.
  if (!out.dateTimeOriginal && typeof out.raw.CreateDate === "string") out.dateTimeOriginal = out.raw.CreateDate as string;
  if (!out.offsetTimeOriginal) {
    const fallback = (out.raw.OffsetTime || out.raw.OffsetTimeDigitized) as string | undefined;
    if (fallback && OFFSET_RE.test(fallback)) out.offsetTimeOriginal = fallback;
  }
  return out.dateTimeOriginal || out.make ? out : null;
}
