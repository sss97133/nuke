// Pure helpers for scripts/photos/reland-capture-relay.mjs. No I/O here, so node --test covers them.

/** The frame a stranded object gets, from its path, its bytes' SHA-256 and the EXIF read from those bytes. */
export function frameFromExif(storagePath, fileHash, exif) {
  const e = exif || {};
  const frame = { storage_path: storagePath, file_hash: fileHash };
  const taken = takenAt(e.DateTimeOriginal, e.OffsetTimeOriginal ?? e.OffsetTime);
  if (taken) frame.taken_at = taken;
  if (Number.isFinite(e.latitude) && Number.isFinite(e.longitude)) {
    frame.latitude = round6(e.latitude);
    frame.longitude = round6(e.longitude);
  }
  if (typeof e.Make === 'string' && e.Make.trim()) frame.camera_make = e.Make.trim();
  if (typeof e.Model === 'string' && e.Model.trim()) frame.camera_model = e.Model.trim();
  return frame;
}

/**
 * EXIF DateTimeOriginal is a wall-clock string ("2026:06:25 10:58:12") with the offset, when the camera wrote one, in
 * OffsetTimeOriginal ("-07:00"). With an offset the instant is exact. Without one, the phone itself read the wall
 * clock as the device's local time; the caller passes that zone's offset in `fallbackOffset` or gets null.
 */
export function takenAt(raw, offset, fallbackOffset = null) {
  if (typeof raw !== 'string') return null;
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw.trim());
  if (!m) return null;
  const off = normOffset(offset) ?? normOffset(fallbackOffset);
  if (!off) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${off}`;
  return Number.isFinite(Date.parse(iso)) ? new Date(iso).toISOString() : null;
}

function normOffset(o) {
  if (typeof o !== 'string') return null;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(o.trim());
  return m ? `${m[1]}${m[2]}:${m[3]}` : null;
}

const round6 = (x) => Math.round(x * 1e6) / 1e6;

export function parseArgs(argv) {
  const a = { write: false, limit: 50, after: '', concurrency: 3, log: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--write') a.write = true;
    else if (k === '--dry-run') a.write = false;
    else if (k === '--limit') a.limit = clampInt(argv[++i], 1, 5000, 50);
    else if (k === '--after') a.after = String(argv[++i] ?? '');
    else if (k === '--concurrency') a.concurrency = clampInt(argv[++i], 1, 6, 3);
    else if (k === '--log') a.log = String(argv[++i] ?? '');
    else throw new Error(`unknown argument ${k}`);
  }
  return a;
}

function clampInt(v, lo, hi, dflt) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}
