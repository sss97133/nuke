#!/usr/bin/env node
/**
 * Re-land the phone's stranded frames: objects in vehicle-photos/users/<uid>/capture-relay/ that never got their
 * vehicle_images row because the phone's insert was refused from 2026-06-21 until PR #1105 (2026-10-14).
 *
 * For each object without a row (public.capture_relay_orphans), it downloads the bytes, computes their SHA-256, reads
 * EXIF from them (exifr), and calls public.reland_capture_relay_frame, which writes the phone's own row shape,
 * idempotent by storage path. No pixels are uploaded, moved or changed; rows only.
 *
 * Run only after the phone's next sync (its own retry may land some of these first), and dry-run first:
 *   dotenvx run -f .env --quiet -- node scripts/photos/reland-capture-relay.mjs --limit 50            # dry run
 *   dotenvx run -f .env --quiet -- node scripts/photos/reland-capture-relay.mjs --write --limit 200   # bounded write
 * The service role key is read from the environment and never printed or logged.
 * Without OffsetTimeOriginal in a frame's EXIF, the wall-clock time is read in RELAND_TZ_OFFSET (default -07:00,
 * the phone's Las Vegas summer offset for June–July 2026, the months these frames were taken).
 */
import { createClient } from '@supabase/supabase-js';
import exifr from 'exifr';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { frameFromExif, parseArgs, takenAt } from './relandFrame.mjs';

const args = parseArgs(process.argv.slice(2));
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (run it through dotenvx)');
  process.exit(2);
}
const fallbackOffset = process.env.RELAND_TZ_OFFSET || '-07:00';
const logPath = args.log || join(homedir(), 'nuke-logs', 'reland-capture-relay-20261014', `run-${new Date().toISOString().replace(/[:.]/g, '')}.jsonl`);
mkdirSync(dirname(logPath), { recursive: true });
const sb = createClient(url, key, { auth: { persistSession: false } });

const tally = { mode: args.write ? 'write' : 'dry-run', seen: 0, landed: 0, exists: 0, refused: 0, error: 0, would_land: 0, bytes: 0, with_time: 0, with_gps: 0 };
const log = (rec) => appendFileSync(logPath, JSON.stringify(rec) + '\n');

async function one(o) {
  tally.seen++;
  try {
    const { data: blob, error } = await sb.storage.from('vehicle-photos').download(o.storage_path);
    if (error) throw new Error(`download: ${error.message}`);
    const buf = Buffer.from(await blob.arrayBuffer());
    tally.bytes += buf.length;
    const hash = createHash('sha256').update(buf).digest('hex');
    const exif = await exifr.parse(buf, { tiff: true, exif: true, gps: true, reviveValues: false }).catch(() => null);
    const frame = frameFromExif(o.storage_path, hash, exif);
    if (!frame.taken_at && exif?.DateTimeOriginal) {
      const t = takenAt(exif.DateTimeOriginal, null, fallbackOffset);
      if (t) frame.taken_at = t;
    }
    if (frame.taken_at) tally.with_time++;
    if (frame.latitude != null) tally.with_gps++;
    if (!args.write) {
      tally.would_land++;
      log({ path: o.storage_path, status: 'dry-run', frame });
      return;
    }
    const { data: r, error: e2 } = await sb.rpc('reland_capture_relay_frame', { p_frame: frame });
    if (e2) throw new Error(`rpc: ${e2.message}`);
    tally[r.status] = (tally[r.status] || 0) + 1;
    log({ path: o.storage_path, ...r });
  } catch (e) {
    tally.error++;
    log({ path: o.storage_path, status: 'error', error: String(e.message || e) });
  }
}

let after = args.after;
while (tally.seen < args.limit) {
  const { data: page, error } = await sb.rpc('capture_relay_orphans', { p_after: after, p_limit: Math.min(100, args.limit - tally.seen) });
  if (error) { console.error(`capture_relay_orphans: ${error.message}`); process.exit(1); }
  if (!page || page.length === 0) break;
  for (let i = 0; i < page.length; i += args.concurrency) {
    await Promise.all(page.slice(i, i + args.concurrency).map(one));
  }
  after = page[page.length - 1].storage_path;
  console.log(`${new Date().toISOString()} ${JSON.stringify(tally)} next_after=${after}`);
}
console.log(JSON.stringify({ ...tally, log: logPath, next_after: after }));
