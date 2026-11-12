import { exifDateToIso, wallTimeInZoneToUtcIso, parseExif } from "./exif.ts";

function equal(actual: unknown, expected: unknown, msg?: string) {
  if (actual !== expected) throw new Error(`${msg ?? "equal"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("OffsetTimeOriginal -07:00 pins the instant (the drop-folder bug case)", () => {
  // DTO 2026:03:12 08:47:06 with -07:00 (PDT) is 15:47Z, not 08:47Z.
  equal(exifDateToIso("2026:03:12 08:47:06", "-07:00"), "2026-03-12T15:47:06.000Z");
  equal(exifDateToIso("2026:01:15 08:47:06", "-08:00"), "2026-01-15T16:47:06.000Z");
  equal(exifDateToIso("2026:03:12 08:47:06", "+00:00"), "2026-03-12T08:47:06.000Z");
});

Deno.test("a naive DateTimeOriginal is America/Los_Angeles, never UTC", () => {
  // 2026-03-12 is PDT (DST started March 8). Same wall clock as the live bug: 08:47:06 -> 15:47Z, not 08:47Z.
  equal(exifDateToIso("2026:03:12 08:47:06"), "2026-03-12T15:47:06.000Z");
  equal(exifDateToIso("2026:01:15 08:47:06"), "2026-01-15T16:47:06.000Z");
  const naiveAsUtc = "2026-03-12T08:47:06.000Z";
  if (exifDateToIso("2026:03:12 08:47:06") === naiveAsUtc) {
    throw new Error("naive camera clock was treated as UTC");
  }
});

Deno.test("blank or zero dates are refused", () => {
  equal(exifDateToIso("0000:00:00 00:00:00"), null);
  equal(exifDateToIso("not a date"), null);
  equal(exifDateToIso(""), null);
});

Deno.test("wallTimeInZoneToUtcIso agrees with known LA instants", () => {
  equal(wallTimeInZoneToUtcIso(2026, 3, 12, 8, 47, 6), "2026-03-12T15:47:06.000Z");
  equal(wallTimeInZoneToUtcIso(2026, 1, 15, 8, 47, 6), "2026-01-15T16:47:06.000Z");
});

Deno.test("parseExif reads OffsetTimeOriginal from a minimal JPEG APP1", () => {
  const bytes = buildJpegWithExif({
    DateTimeOriginal: "2026:03:12 08:47:06",
    OffsetTimeOriginal: "-07:00",
    Make: "Apple",
  });
  const ex = parseExif(bytes);
  if (!ex) throw new Error("parseExif returned null");
  equal(ex.dateTimeOriginal, "2026:03:12 08:47:06");
  equal(ex.offsetTimeOriginal, "-07:00");
  equal(ex.raw.OffsetTimeOriginal, "-07:00");
  equal(exifDateToIso(ex.dateTimeOriginal!, ex.offsetTimeOriginal), "2026-03-12T15:47:06.000Z");
});

Deno.test("parseExif without an offset leaves offset unset so exifDateToIso uses LA", () => {
  const bytes = buildJpegWithExif({ DateTimeOriginal: "2026:03:12 08:47:06", Make: "Canon" });
  const ex = parseExif(bytes);
  if (!ex) throw new Error("parseExif returned null");
  equal(ex.offsetTimeOriginal, undefined);
  equal(exifDateToIso(ex.dateTimeOriginal!, ex.offsetTimeOriginal), "2026-03-12T15:47:06.000Z");
});

/** Minimal little-endian TIFF EXIF in a JPEG SOI/APP1/EOI wrapper. */
function buildJpegWithExif(tags: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  // IFD0: ExifIFD pointer only. ExifIFD: the ASCII tags. Strings live after both IFDs.
  const ifd0Count = 1;
  const ascii = Object.entries(tags);
  const ifd1Count = ascii.length;
  const tiffHeader = 8;
  const ifd0 = tiffHeader;
  const ifd0Size = 2 + ifd0Count * 12 + 4;
  const ifdExif = ifd0 + ifd0Size;
  const ifdExifSize = 2 + ifd1Count * 12 + 4;
  let strAt = ifdExif + ifdExifSize;

  const tagId: Record<string, number> = {
    DateTimeOriginal: 0x9003,
    OffsetTimeOriginal: 0x9011,
    Make: 0x010f,
    Model: 0x0110,
  };
  // Make lives in IFD0 in real files, but the reader walks ExifIFD and we also accept it there via the same ASCII branch
  // after we recurse; we put every tag in ExifIFD for the test fixture. The Make tag is ASCII and will be read there.
  const strings: { tag: number; bytes: Uint8Array; off: number }[] = [];
  for (const [k, v] of ascii) {
    const b = enc.encode(v + "\0");
    strings.push({ tag: tagId[k], bytes: b, off: strAt });
    strAt += b.length;
  }

  const tiff = new Uint8Array(strAt);
  const dv = new DataView(tiff.buffer);
  tiff[0] = 0x49; tiff[1] = 0x49; // II
  dv.setUint16(2, 0x2a, true);
  dv.setUint32(4, ifd0, true);
  dv.setUint16(ifd0, ifd0Count, true);
  // ExifIFD pointer tag 0x8769, type LONG, count 1, value = ifdExif
  const e0 = ifd0 + 2;
  dv.setUint16(e0, 0x8769, true);
  dv.setUint16(e0 + 2, 4, true);
  dv.setUint32(e0 + 4, 1, true);
  dv.setUint32(e0 + 8, ifdExif, true);
  dv.setUint32(ifd0 + 2 + 12, 0, true);
  dv.setUint16(ifdExif, ifd1Count, true);
  strings.forEach((s, i) => {
    const e = ifdExif + 2 + i * 12;
    dv.setUint16(e, s.tag, true);
    dv.setUint16(e + 2, 2, true); // ASCII
    dv.setUint32(e + 4, s.bytes.length, true);
    if (s.bytes.length <= 4) {
      tiff.set(s.bytes, e + 8);
    } else {
      dv.setUint32(e + 8, s.off, true);
      tiff.set(s.bytes, s.off);
    }
  });
  dv.setUint32(ifdExif + 2 + ifd1Count * 12, 0, true);

  const app1Len = 2 + 6 + tiff.length; // length bytes + Exif\0\0 + tiff
  const jpeg = new Uint8Array(2 + 2 + app1Len + 2);
  jpeg[0] = 0xff; jpeg[1] = 0xd8;
  jpeg[2] = 0xff; jpeg[3] = 0xe1;
  jpeg[4] = (app1Len >> 8) & 0xff;
  jpeg[5] = app1Len & 0xff;
  jpeg.set(enc.encode("Exif\0\0"), 6);
  // "Exif\0\0" is 6 bytes starting at 6; tiff follows at 12
  jpeg.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 6);
  jpeg.set(tiff, 12);
  jpeg[12 + tiff.length] = 0xff;
  jpeg[13 + tiff.length] = 0xd9;
  return jpeg;
}
