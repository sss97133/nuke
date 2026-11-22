// Camera fields for derive-image-exif's completeness pass (mode "complete").
//
// The stored file already carries the camera's own account of itself; the row often does not. This reads, from the
// head of a JPEG or HEIC, only these fields:
//   IFD0/ExifIFD: Make, Model, Software, LensMake, LensModel, DateTimeOriginal + OffsetTimeOriginal (read only to
//   place the boot session below; never written as a clock);
//   Apple MakerNote: RunTime (flags, value, epoch, timescale), ContentIdentifier, BurstUUID.
// GPS is never read. Pure function over bytes: no model, no network, no credential.

import { exifDateToIso } from "./exif.ts";

export interface CameraFields {
  Make?: string;
  Model?: string;
  Software?: string;
  LensMake?: string;
  LensModel?: string;
  ContentIdentifier?: string;
  BurstUUID?: string;
  RunTimeFlags?: number;
  RunTimeValue?: number;
  RunTimeEpoch?: number;
  RunTimeScale?: number;
}

export interface CameraRead {
  fields: CameraFields;
  dateTimeOriginal?: string;
  offsetTimeOriginal?: string;
  container: "jpeg" | "heic";
}

const T_MAKE = 0x010f, T_MODEL = 0x0110, T_SOFTWARE = 0x0131, T_EXIF_IFD = 0x8769;
const T_DTO = 0x9003, T_OFFSET_ORIG = 0x9011, T_LENS_MAKE = 0xa433, T_LENS_MODEL = 0xa434, T_MAKERNOTE = 0x927c;
const A_RUNTIME = 0x0003, A_BURST_UUID = 0x000b, A_CONTENT_ID = 0x0011;

/** Find the TIFF header of the Exif block in a JPEG (APP1) or a HEIC (the "Exif" item). */
export function findTiff(b: Uint8Array): { at: number; container: "jpeg" | "heic" } | null {
  if (b[0] === 0xff && b[1] === 0xd8) {
    let p = 2;
    while (p + 4 < b.length) {
      if (b[p] !== 0xff) { p++; continue; }
      const marker = b[p + 1];
      if (marker === 0xda) break;
      const len = (b[p + 2] << 8) | b[p + 3];
      if (marker === 0xe1 && b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66) {
        return { at: p + 10, container: "jpeg" };
      }
      p += 2 + len;
    }
    return null;
  }
  const at = heicExifOffset(b);
  return at == null ? null : { at, container: "heic" };
}

const be32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const be16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const fourcc = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
function beN(b: Uint8Array, o: number, n: number): number {
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + b[o + i];
  return v;
}

/** ISO-BMFF (HEIF): meta → iinf (item of type "Exif") + iloc (its file offset). Returns the TIFF header offset. */
export function heicExifOffset(b: Uint8Array): number | null {
  if (b.length < 16 || fourcc(b, 4) !== "ftyp") return null;
  let p = 0, meta = -1, metaEnd = -1;
  while (p + 8 <= b.length) {
    const size = be32(b, p), type = fourcc(b, p + 4);
    if (size < 8) return null;
    if (type === "meta") { meta = p + 12; metaEnd = Math.min(p + size, b.length); break; }
    p += size;
  }
  if (meta < 0) return null;
  let exifItem = -1;
  const loc = new Map<number, number>();
  for (let q = meta; q + 8 <= metaEnd;) {
    const size = be32(b, q), type = fourcc(b, q + 4);
    if (size < 8) break;
    const end = Math.min(q + size, metaEnd);
    if (type === "iinf") {
      const v = b[q + 8];
      let r = q + 12 + (v === 0 ? 2 : 4);
      while (r + 8 <= end) {
        const isz = be32(b, r);
        if (isz < 8) break;
        if (fourcc(b, r + 4) === "infe") {
          const iv = b[r + 8];
          if (iv >= 2) {
            const id = iv === 2 ? be16(b, r + 12) : be32(b, r + 12);
            const tpos = r + 12 + (iv === 2 ? 2 : 4) + 2;
            if (fourcc(b, tpos) === "Exif") exifItem = id;
          }
        }
        r += isz;
      }
    } else if (type === "iloc") {
      const v = b[q + 8];
      let r = q + 12;
      const offSize = b[r] >> 4, lenSize = b[r] & 15, baseSize = b[r + 1] >> 4, idxSize = v >= 1 ? b[r + 1] & 15 : 0;
      r += 2;
      const n = v < 2 ? be16(b, r) : be32(b, r);
      r += v < 2 ? 2 : 4;
      for (let i = 0; i < n && r < end; i++) {
        const id = v < 2 ? be16(b, r) : be32(b, r);
        r += v < 2 ? 2 : 4;
        let method = 0;
        if (v >= 1) { method = be16(b, r) & 15; r += 2; }
        r += 2; // data_reference_index
        const base = beN(b, r, baseSize); r += baseSize;
        const extents = be16(b, r); r += 2;
        let first = -1;
        for (let e = 0; e < extents; e++) {
          r += idxSize;
          const off = beN(b, r, offSize); r += offSize;
          r += lenSize;
          if (e === 0) first = off;
        }
        if (method === 0 && first >= 0) loc.set(id, base + first);
      }
    }
    q += size;
  }
  if (exifItem < 0 || !loc.has(exifItem)) return null;
  const start = loc.get(exifItem)!;
  if (start + 4 > b.length) return null;
  const at = start + 4 + be32(b, start);
  return at + 8 <= b.length ? at : null;
}

/** Minimal binary plist reader for the RunTime dictionary (ints and ASCII keys only). */
export function readRunTimePlist(b: Uint8Array): Record<string, number> | null {
  if (b.length < 40 || new TextDecoder().decode(b.subarray(0, 8)) !== "bplist00") return null;
  const t = b.length - 32;
  const offSize = b[t + 6], refSize = b[t + 7];
  const nObj = beN(b, t + 8, 8), top = beN(b, t + 16, 8), table = beN(b, t + 24, 8);
  if (nObj > 64 || table + nObj * offSize > b.length) return null;
  const objAt = (i: number) => beN(b, table + i * offSize, offSize);
  const read = (i: number): string | number | null => {
    const o = objAt(i), m = b[o], hi = m >> 4, lo = m & 15;
    if (hi === 0x1) { const n = 1 << lo; return n <= 8 ? beN(b, o + 1, n) : null; }
    if (hi === 0x5 && lo < 15) return new TextDecoder().decode(b.subarray(o + 1, o + 1 + lo));
    return null;
  };
  const o = objAt(top);
  if (b[o] >> 4 !== 0xd) return null;
  const n = b[o] & 15, out: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const k = read(beN(b, o + 1 + i * refSize, refSize));
    const v = read(beN(b, o + 1 + (n + i) * refSize, refSize));
    if (typeof k === "string" && typeof v === "number") out[k] = v;
  }
  return out;
}

export function readCamera(b: Uint8Array): CameraRead | null {
  const hit = findTiff(b);
  if (!hit) return null;
  const base = hit.at;
  if (base + 8 > b.length) return null;
  const le = b[base] === 0x49 && b[base + 1] === 0x49;
  const u16 = (o: number) => le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1];
  const u32 = (o: number) => le
    ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
    : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  if (u16(base + 2) !== 0x2a) return null;
  const out: CameraRead = { fields: {}, container: hit.container };
  const ascii = (o: number, n: number) =>
    o + n <= b.length ? new TextDecoder().decode(b.subarray(o, o + n)).replace(/\0+$/, "").trim() : undefined;
  let makerNote = -1;

  const readIfd = (off: number, depth: number) => {
    const at = base + off;
    if (depth > 2 || at + 2 > b.length) return;
    const n = u16(at);
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12;
      if (e + 12 > b.length) return;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      const valOff = count > 4 ? base + u32(e + 8) : e + 8;
      if (type === 2) {
        const s = ascii(valOff, count);
        if (!s) continue;
        if (tag === T_MAKE) out.fields.Make = s;
        else if (tag === T_MODEL) out.fields.Model = s;
        else if (tag === T_SOFTWARE) out.fields.Software = s;
        else if (tag === T_LENS_MAKE) out.fields.LensMake = s;
        else if (tag === T_LENS_MODEL) out.fields.LensModel = s;
        else if (tag === T_DTO) out.dateTimeOriginal = s;
        else if (tag === T_OFFSET_ORIG) out.offsetTimeOriginal = s;
      } else if (tag === T_EXIF_IFD) {
        readIfd(u32(e + 8), depth + 1);
      } else if (tag === T_MAKERNOTE && count > 14) {
        makerNote = valOff;
      }
    }
  };
  readIfd(u32(base + 4), 0);

  // Apple MakerNote: "Apple iOS\0", version, "MM", then a big-endian IFD; offsets count from the note's start.
  if (makerNote > 0 && makerNote + 16 <= b.length && ascii(makerNote, 9) === "Apple iOS") {
    const mn = makerNote;
    const n = be16(b, mn + 14);
    for (let i = 0; i < n; i++) {
      const e = mn + 16 + i * 12;
      if (e + 12 > b.length) break;
      const tag = be16(b, e), type = be16(b, e + 2), count = be32(b, e + 4);
      const valOff = count > 4 ? mn + be32(b, e + 8) : e + 8;
      if (valOff + count > b.length) continue;
      if (type === 2 && (tag === A_CONTENT_ID || tag === A_BURST_UUID)) {
        const s = ascii(valOff, count);
        if (s && /^[0-9A-Fa-f-]{8,64}$/.test(s)) {
          if (tag === A_CONTENT_ID) out.fields.ContentIdentifier = s; else out.fields.BurstUUID = s;
        }
      } else if (tag === A_RUNTIME && type === 7) {
        const rt = readRunTimePlist(b.subarray(valOff, valOff + count));
        if (rt && typeof rt.value === "number" && typeof rt.timescale === "number" && rt.timescale > 0) {
          out.fields.RunTimeFlags = rt.flags;
          out.fields.RunTimeValue = rt.value;
          out.fields.RunTimeEpoch = rt.epoch;
          out.fields.RunTimeScale = rt.timescale;
        }
      }
    }
  }
  return Object.keys(out.fields).length ? out : null;
}

/**
 * The handset session anchor: the file's own capture clock minus the phone's uptime (RunTimeValue / RunTimeScale;
 * RunTimeFlags bit 0 = valid). iOS's RunTime pauses while the phone sleeps, so within one boot the uptime only grows
 * and the anchor only moves forward (by the time the phone slept); a reboot resets the uptime. Photos whose uptime
 * grows by no more than the clock between them belong to one boot of one phone. Null without a valid RunTime or a
 * readable DateTimeOriginal: nothing is invented.
 */
export function bootSession(r: CameraRead): { anchor_at: string; uptime_s: number } | null {
  const f = r.fields;
  if (!r.dateTimeOriginal || !f.RunTimeValue || !f.RunTimeScale || ((f.RunTimeFlags ?? 0) & 1) !== 1) return null;
  const at = exifDateToIso(r.dateTimeOriginal, r.offsetTimeOriginal);
  if (!at) return null;
  const uptime = f.RunTimeValue / f.RunTimeScale;
  if (!(uptime > 0) || uptime > 400 * 86400) return null;
  const anchor = new Date(Date.parse(at) - Math.round(uptime * 1000));
  anchor.setUTCMilliseconds(0);
  return { anchor_at: anchor.toISOString(), uptime_s: Math.round(uptime) };
}

/** The keys this pass may add to vehicle_images.exif_data (never a clock, never GPS). */
export const COMPLETE_KEYS = [
  "Make", "Model", "Software", "LensMake", "LensModel", "ContentIdentifier", "BurstUUID",
  "RunTimeFlags", "RunTimeValue", "RunTimeEpoch", "RunTimeScale", "capture_session",
] as const;

/** What the pass would hand the database for one photo: the camera fields plus capture_session. */
export function completeFields(r: CameraRead): Record<string, unknown> {
  const out: Record<string, unknown> = { ...r.fields };
  const s = bootSession(r);
  if (s) out.capture_session = { anchor_at: s.anchor_at, uptime_s: s.uptime_s, basis: "DateTimeOriginal - RunTimeValue/RunTimeScale; RunTime pauses in sleep" };
  for (const k of Object.keys(out)) if (!(COMPLETE_KEYS as readonly string[]).includes(k) || out[k] === undefined) delete out[k];
  return out;
}
