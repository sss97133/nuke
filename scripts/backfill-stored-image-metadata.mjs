#!/usr/bin/env node
/**
 * Backfill missing image metadata from the stored image binary.
 *
 * Examples:
 *   node --env-file=.env scripts/backfill-stored-image-metadata.mjs --vehicle-id <uuid> --source hd_archive
 *   node --env-file=.env scripts/backfill-stored-image-metadata.mjs --source hd_archive --limit 50 --dry-run
 */

import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';

function parseArgs(argv) {
  const args = {
    limit: 0,
    concurrency: 4,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--vehicle-id') args.vehicleId = argv[++i];
    else if (arg === '--source') args.source = argv[++i];
    else if (arg === '--limit') args.limit = Number(argv[++i] || 0);
    else if (arg === '--concurrency') args.concurrency = Math.max(1, Number(argv[++i] || 4));
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }

  return args;
}

function usage() {
  console.log(`
Backfill stored image metadata

Usage:
  node --env-file=.env scripts/backfill-stored-image-metadata.mjs --vehicle-id <uuid> [--source <name>] [--limit <n>] [--concurrency <n>] [--dry-run]
  node --env-file=.env scripts/backfill-stored-image-metadata.mjs --source <name> [--limit <n>] [--concurrency <n>] [--dry-run]
  `);
}

function env(...names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  return null;
}

function parseExifDate(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(
    /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/
  );
  if (!match) return null;

  const [, y, m, d, hh, mm, ss] = match;
  const date = new Date(
    Number(y),
    Number(m) - 1,
    Number(d),
    Number(hh),
    Number(mm),
    Number(ss)
  );
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildMergedExif(existingExif, extracted, row) {
  const merged = { ...(existingExif || {}) };

  if (extracted.date) {
    merged.DateTimeOriginal ??= extracted.date;
    merged.CreateDate ??= extracted.createDate || extracted.date;
  }

  if (extracted.make || extracted.model) {
    merged.camera = {
      ...(merged.camera || {}),
      ...(extracted.make ? { make: extracted.make } : {}),
      ...(extracted.model ? { model: extracted.model } : {}),
    };
  }

  const technical = {
    ...(merged.technical || {}),
    ...(normalizeNumber(extracted.iso) !== null ? { iso: extracted.iso } : {}),
    ...(normalizeNumber(extracted.fNumber) !== null ? { fNumber: extracted.fNumber } : {}),
    ...(normalizeNumber(extracted.exposureTime) !== null ? { exposureTime: extracted.exposureTime } : {}),
    ...(normalizeNumber(extracted.focalLength) !== null ? { focalLength: extracted.focalLength } : {}),
  };
  if (Object.keys(technical).length > 0) {
    merged.technical = technical;
    merged.iso ??= technical.iso;
    merged.fNumber ??= technical.fNumber;
    merged.exposureTime ??= technical.exposureTime;
    merged.focalLength ??= technical.focalLength;
  }

  if (normalizeNumber(extracted.width) !== null && normalizeNumber(extracted.height) !== null) {
    merged.dimensions = {
      ...(merged.dimensions || {}),
      width: extracted.width,
      height: extracted.height,
    };
  }

  if (normalizeNumber(extracted.latitude) !== null && normalizeNumber(extracted.longitude) !== null) {
    merged.gps = {
      ...(merged.gps || {}),
      latitude: extracted.latitude,
      longitude: extracted.longitude,
    };
    merged.location = {
      ...(merged.location || {}),
      latitude: extracted.latitude,
      longitude: extracted.longitude,
    };
  }

  if (row.storage_path && !merged.storage_path) {
    merged.storage_path = row.storage_path;
  }

  merged.metadata_backfill = {
    source: 'stored_binary_exif',
    backfilled_at: new Date().toISOString(),
  };

  return merged;
}

function readExif(filePath) {
  const raw = execFileSync(
    'exiftool',
    [
      '-json',
      '-n',
      '-DateTimeOriginal',
      '-CreateDate',
      '-GPSLatitude',
      '-GPSLongitude',
      '-Make',
      '-Model',
      '-ImageWidth',
      '-ImageHeight',
      '-ISO',
      '-FNumber',
      '-ExposureTime',
      '-FocalLength',
      filePath,
    ],
    { encoding: 'utf8' }
  );

  const parsed = JSON.parse(raw)?.[0] || {};
  return {
    date: parsed.DateTimeOriginal || null,
    createDate: parsed.CreateDate || null,
    latitude: normalizeNumber(parsed.GPSLatitude),
    longitude: normalizeNumber(parsed.GPSLongitude),
    make: parsed.Make || null,
    model: parsed.Model || null,
    width: normalizeNumber(parsed.ImageWidth),
    height: normalizeNumber(parsed.ImageHeight),
    iso: normalizeNumber(parsed.ISO),
    fNumber: normalizeNumber(parsed.FNumber),
    exposureTime: normalizeNumber(parsed.ExposureTime),
    focalLength: normalizeNumber(parsed.FocalLength),
  };
}

async function downloadTemp(url, dir, fallbackName) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const safeName = basename(url.split('?')[0] || fallbackName || 'image.jpg');
  const filePath = join(dir, safeName || `${fallbackName || 'image'}.jpg`);
  writeFileSync(filePath, buf);
  return filePath;
}

function needsBackfill(row) {
  return Boolean(
    !row.exif_data ||
    !row.taken_at ||
    (row.latitude === null && row.longitude === null)
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.vehicleId && !args.source)) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const supabaseUrl = env('VITE_SUPABASE_URL', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
  const supabaseKey = env('SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase environment.');
    process.exit(1);
  }

  try {
    execFileSync('exiftool', ['-ver'], { encoding: 'utf8' });
  } catch {
    console.error('exiftool is required for this script.');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  let query = supabase
    .from('vehicle_images')
    .select('id, vehicle_id, image_url, storage_path, source, file_name, exif_data, taken_at, latitude, longitude, created_at')
    .order('created_at', { ascending: false });

  if (args.vehicleId) query = query.eq('vehicle_id', args.vehicleId);
  if (args.source) query = query.eq('source', args.source);
  if (args.limit > 0) query = query.limit(args.limit);

  const { data: rows, error } = await query;
  if (error) {
    console.error(`Query failed: ${error.message}`);
    process.exit(1);
  }

  const candidates = (rows || []).filter((row) => needsBackfill(row));
  if (!candidates.length) {
    console.log('No candidate rows need backfill.');
    return;
  }

  console.log(`Rows fetched: ${rows.length}`);
  console.log(`Rows needing backfill: ${candidates.length}`);
  if (args.dryRun) console.log('Mode: dry-run');

  const tmpRoot = mkdtempSync(join(tmpdir(), 'nuke-backfill-'));
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  let index = 0;

  async function worker() {
    while (index < candidates.length) {
      const row = candidates[index++];
      let tempPath = null;

      try {
        tempPath = await downloadTemp(row.image_url, tmpRoot, row.id);
        const exif = readExif(tempPath);

        const mergedExif = buildMergedExif(row.exif_data, exif, row);
        const takenAt = parseExifDate(exif.date || exif.createDate);

        const patch = {
          exif_data: mergedExif,
          ...(takenAt ? { taken_at: takenAt } : {}),
          ...(normalizeNumber(exif.latitude) !== null ? { latitude: exif.latitude } : {}),
          ...(normalizeNumber(exif.longitude) !== null ? { longitude: exif.longitude } : {}),
        };

        const patchKeys = Object.keys(patch);
        if (patchKeys.length === 0) {
          skipped++;
          continue;
        }

        if (!args.dryRun) {
          const { error: updateError } = await supabase
            .from('vehicle_images')
            .update(patch)
            .eq('id', row.id);

          if (updateError) {
            throw updateError;
          }
        }

        updated++;
        if (updated <= 5) {
          console.log(`Updated ${row.file_name || row.id}`);
        }
      } catch (err) {
        errors++;
        if (errors <= 10) {
          console.error(`Error on ${row.file_name || row.id}: ${String(err.message || err)}`);
        }
      }
    }
  }

  try {
    const workers = Array.from({ length: args.concurrency }, () => worker());
    await Promise.all(workers);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`Done. updated=${updated} skipped=${skipped} errors=${errors}`);
}

await main();
