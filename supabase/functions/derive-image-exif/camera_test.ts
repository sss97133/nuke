import { bootSession, completeFields, findTiff, readCamera, readRunTimePlist } from "./camera.ts";

function equal(actual: unknown, expected: unknown, msg?: string) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg ?? "equal"}: expected ${e}, got ${a}`);
}

const enc = new TextEncoder();

/** bplist00 dict {flags, value, epoch, timescale} with 8-byte ints, as iOS writes RunTime. */
function runTimePlist(flags: number, value: number, epoch: number, scale: number): Uint8Array {
  const keys = ["flags", "value", "epoch", "timescale"], vals = [flags, value, epoch, scale];
  const objs: Uint8Array[] = [];
  objs.push(new Uint8Array([0xd4, 1, 2, 3, 4, 5, 6, 7, 8]));                 // dict of 4: key refs 1..4, value refs 5..8
  for (const k of keys) objs.push(new Uint8Array([0x50 | k.length, ...enc.encode(k)]));
  for (const v of vals) {
    const b = new Uint8Array(9); b[0] = 0x13;
    new DataView(b.buffer).setBigUint64(1, BigInt(v));
    objs.push(b);
  }
  const head = enc.encode("bplist00");
  const offsets: number[] = []; let at = head.length;
  for (const o of objs) { offsets.push(at); at += o.length; }
  const tableAt = at;
  const trailer = new Uint8Array(32);
  trailer[6] = 1; trailer[7] = 1;
  const dv = new DataView(trailer.buffer);
  dv.setBigUint64(8, BigInt(objs.length)); dv.setBigUint64(16, 0n); dv.setBigUint64(24, BigInt(tableAt));
  const out = new Uint8Array(tableAt + offsets.length + 32);
  out.set(head, 0); let p = head.length;
  for (const o of objs) { out.set(o, p); p += o.length; }
  out.set(offsets, tableAt);
  out.set(trailer, tableAt + offsets.length);
  return out;
}

/** Apple MakerNote: "Apple iOS\0" 0x0001 "MM", big-endian IFD; offsets from the note's start. */
function appleMakerNote(contentId: string, runtime: Uint8Array): Uint8Array {
  const cid = enc.encode(contentId + "\0");
  const n = 2, ifdAt = 14, dataAt = ifdAt + 2 + n * 12 + 4;
  const out = new Uint8Array(dataAt + runtime.length + cid.length);
  out.set(enc.encode("Apple iOS\0"), 0); out[10] = 0; out[11] = 1; out[12] = 0x4d; out[13] = 0x4d;
  const dv = new DataView(out.buffer);
  dv.setUint16(ifdAt, n);
  dv.setUint16(16, 0x0003); dv.setUint16(18, 7); dv.setUint32(20, runtime.length); dv.setUint32(24, dataAt);
  dv.setUint16(28, 0x0011); dv.setUint16(30, 2); dv.setUint32(32, cid.length); dv.setUint32(36, dataAt + runtime.length);
  out.set(runtime, dataAt); out.set(cid, dataAt + runtime.length);
  return out;
}

/** Little-endian TIFF: IFD0 {Make, Model, Software, ExifIFD}, ExifIFD {DTO, OffsetTimeOriginal, LensModel, MakerNote}. */
function tiff(makerNote: Uint8Array): Uint8Array {
  const ifd0 = [[0x010f, 2, "Apple"], [0x0110, 2, "iPhone 7"], [0x0131, 2, "11.0"], [0x8769, 4, 0]] as [number, number, string | number][];
  const exif = [[0x9003, 2, "2017:10:11 01:29:16"], [0x9011, 2, "-07:00"], [0xa434, 2, "iPhone 7 back camera 3.99mm f/1.8"], [0x927c, 7, makerNote]] as [number, number, string | number | Uint8Array][];
  const ifd0At = 8, exifAt = ifd0At + 2 + ifd0.length * 12 + 4;
  let dataAt = exifAt + 2 + exif.length * 12 + 4;
  const blobs: [number, Uint8Array][] = [];
  const out = new Uint8Array(4096);
  const dv = new DataView(out.buffer);
  out[0] = 0x49; out[1] = 0x49; dv.setUint16(2, 0x2a, true); dv.setUint32(4, ifd0At, true);
  const write = (at: number, entries: [number, number, string | number | Uint8Array][]) => {
    dv.setUint16(at, entries.length, true);
    entries.forEach(([tag, type, v], i) => {
      const e = at + 2 + i * 12;
      dv.setUint16(e, tag, true); dv.setUint16(e + 2, type, true);
      if (tag === 0x8769) { dv.setUint32(e + 4, 1, true); dv.setUint32(e + 8, exifAt, true); return; }
      const b = typeof v === "string" ? enc.encode(v + "\0") : v as Uint8Array;
      dv.setUint32(e + 4, b.length, true);
      if (b.length <= 4) out.set(b, e + 8); else { dv.setUint32(e + 8, dataAt, true); blobs.push([dataAt, b]); dataAt += b.length; }
    });
  };
  write(ifd0At, ifd0); write(exifAt, exif);
  for (const [at, b] of blobs) out.set(b, at);
  return out.subarray(0, dataAt);
}

function jpeg(t: Uint8Array): Uint8Array {
  const len = 2 + 6 + t.length;
  const out = new Uint8Array(4 + len + 2);
  out.set([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255]); out.set(enc.encode("Exif\0\0"), 6); out.set(t, 12);
  out.set([0xff, 0xd9], 12 + t.length);
  return out;
}

/** ftyp + meta{iinf{infe v2 item 1 "Exif"}, iloc v0 {item 1 -> mdat offset}} + mdat{u32 6, "Exif\0\0", tiff}. */
function heic(t: Uint8Array): Uint8Array {
  const box = (type: string, body: Uint8Array) => {
    const b = new Uint8Array(8 + body.length); new DataView(b.buffer).setUint32(0, b.length); b.set(enc.encode(type), 4); b.set(body, 8); return b;
  };
  const cat = (...xs: Uint8Array[]) => { const o = new Uint8Array(xs.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of xs) { o.set(x, p); p += x.length; } return o; };
  const ftyp = box("ftyp", enc.encode("heicmif1heic"));
  const infe = box("infe", new Uint8Array([2, 0, 0, 0, 0, 1, 0, 0, ...enc.encode("Exif"), 0]));
  const iinf = box("iinf", cat(new Uint8Array([0, 0, 0, 0, 0, 1]), infe));
  const ilocFor = (off: number) => box("iloc", new Uint8Array([0, 0, 0, 0, 0x44, 0x00, 0, 1, 0, 1, 0, 0, 0, 1,
    off >>> 24, (off >> 16) & 255, (off >> 8) & 255, off & 255, 0, 0, 0, 0]));
  const metaLen = 8 + 4 + iinf.length + ilocFor(0).length;
  const exifAt = ftyp.length + metaLen + 8;
  const meta = box("meta", cat(new Uint8Array([0, 0, 0, 0]), iinf, ilocFor(exifAt)));
  const payload = cat(new Uint8Array([0, 0, 0, 6]), enc.encode("Exif\0\0"), t);
  return cat(ftyp, meta, box("mdat", payload));
}

const RT = runTimePlist(1, 8156691884708, 0, 1_000_000_000);
const NOTE = appleMakerNote("3083D92A-C756-4206-A3D0-A16E0B7104B5", RT);

Deno.test("RunTime binary plist reads flags, value, epoch and timescale", () => {
  equal(readRunTimePlist(RT), { flags: 1, value: 8156691884708, epoch: 0, timescale: 1000000000 });
});

Deno.test("a JPEG yields camera, lens, software, ContentIdentifier, RunTime and the boot session", () => {
  const r = readCamera(jpeg(tiff(NOTE)));
  if (!r) throw new Error("null read");
  equal(r.container, "jpeg");
  equal(completeFields(r), {
    Make: "Apple", Model: "iPhone 7", Software: "11.0", LensModel: "iPhone 7 back camera 3.99mm f/1.8",
    RunTimeFlags: 1, RunTimeValue: 8156691884708, RunTimeEpoch: 0, RunTimeScale: 1000000000,
    ContentIdentifier: "3083D92A-C756-4206-A3D0-A16E0B7104B5",
    // 2017-10-11 01:29:16 -07:00 = 08:29:16Z, minus 8156.69 s of uptime
    capture_session: { anchor_at: "2017-10-11T06:13:19.000Z", uptime_s: 8157, basis: "DateTimeOriginal - RunTimeValue/RunTimeScale; RunTime pauses in sleep" },
  });
});

Deno.test("a HEIC finds its Exif item through iinf/iloc and reads the same fields", () => {
  const h = heic(tiff(NOTE));
  if (findTiff(h)?.container !== "heic") throw new Error("not found as heic");
  equal(completeFields(readCamera(h)!), completeFields(readCamera(jpeg(tiff(NOTE)))!));
});

Deno.test("no clock key and no GPS key is ever handed on", () => {
  const f = completeFields(readCamera(jpeg(tiff(NOTE)))!);
  for (const k of Object.keys(f)) if (/date|time.*original|offset|gps|latitude|longitude/i.test(k)) throw new Error(`leaked ${k}`);
});

Deno.test("no boot session without a valid RunTime", () => {
  const bad = readCamera(jpeg(tiff(appleMakerNote("3083D92A-C756-4206-A3D0-A16E0B7104B5", runTimePlist(0, 5, 0, 1_000_000_000)))))!;
  equal(bootSession(bad), null);
  equal("capture_session" in completeFields(bad), false);
});

Deno.test("bytes that are neither JPEG nor HEIC read as nothing", () => {
  equal(readCamera(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), null);
});
