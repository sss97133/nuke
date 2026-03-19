#!/usr/bin/env node
/**
 * Audit image rows against the stored binary so we can spot source/provenance gaps.
 *
 * Examples:
 *   dotenvx run -- node scripts/audit-image-source-integrity.mjs --vehicle-id <uuid> --source hd_archive
 *   dotenvx run -- node scripts/audit-image-source-integrity.mjs --source iphoto --limit 10
 */

import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, extname, join } from 'path';

function usage() {
  console.log(`
Image source integrity audit

Usage:
  dotenvx run -- node scripts/audit-image-source-integrity.mjs --vehicle-id <uuid> [--source <name>] [--limit <n>] [--json]
  dotenvx run -- node scripts/audit-image-source-integrity.mjs --source <name> [--limit <n>] [--json]

Notes:
  - Downloads each image temporarily and reads EXIF with exiftool.
  - Non-destructive: reads storage + DB only.
  `);
}

function parseArgs(argv) {
  const out = { limit: 25, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--vehicle-id') out.vehicleId = argv[++i];
    else if (arg === '--source') out.source = argv[++i];
    else if (arg === '--limit') out.limit = Number(argv[++i] || 25);
    else if (arg === '--json') out.json = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

function env(...names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  return null;
}

function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function hasDbDate(row) {
  return Boolean(
    row.taken_at ||
    row.exif_data?.DateTimeOriginal ||
    row.exif_data?.CreateDate ||
    row.exif_data?.dateTaken ||
    row.exif_data?.date
  );
}

function getDbGps(row) {
  const lat = row.latitude ?? row.exif_data?.gps?.latitude ?? row.exif_data?.location?.latitude ?? null;
  const lon = row.longitude ?? row.exif_data?.gps?.longitude ?? row.exif_data?.location?.longitude ?? null;
  return (typeof lat === 'number' && typeof lon === 'number') ? { latitude: lat, longitude: lon } : null;
}

function collectTraceSources(row) {
  const trace = [];
  const push = (label, value) => {
    if (value) trace.push({ label, value });
  };

  push('source_url', row.source_url);
  push('storage_path', row.storage_path);
  push('archive_source_path', row.exif_data?.archive_source_path);
  push('original_url', row.exif_data?.original_url);
  push('original_path', row.exif_data?.original_path);
  push('source_path', row.exif_data?.source_path);
  push('exif.source_url', row.exif_data?.source_url);
  push('listing_context.original_url', row.exif_data?.listing_context?.original_url);
  push('source.original_url', row.exif_data?.source?.original_url);

  return trace;
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
      filePath,
    ],
    { encoding: 'utf8' }
  );

  const parsed = JSON.parse(raw)?.[0] || {};
  return {
    date: parsed.DateTimeOriginal || parsed.CreateDate || null,
    latitude: typeof parsed.GPSLatitude === 'number' ? parsed.GPSLatitude : null,
    longitude: typeof parsed.GPSLongitude === 'number' ? parsed.GPSLongitude : null,
    make: parsed.Make || null,
    model: parsed.Model || null,
    width: parsed.ImageWidth || null,
    height: parsed.ImageHeight || null,
  };
}

async function downloadTemp(url, dir, fallbackName) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const safeBase = basename(url.split('?')[0] || fallbackName || 'image.jpg');
  const filePath = join(dir, safeBase || `${fallbackName || 'image'}.jpg`);
  writeFileSync(filePath, buf);
  return filePath;
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
    console.error('Missing Supabase environment. Expected SUPABASE url + key.');
    process.exit(1);
  }

  try {
    execFileSync('exiftool', ['-ver'], { encoding: 'utf8' });
  } catch {
    console.error('exiftool is required for this audit but was not found.');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  let query = supabase
    .from('vehicle_images')
    .select('id, vehicle_id, image_url, storage_path, source_url, source, file_name, exif_data, taken_at, latitude, longitude, created_at')
    .order('created_at', { ascending: false })
    .limit(args.limit);

  if (args.vehicleId) query = query.eq('vehicle_id', args.vehicleId);
  if (args.source) query = query.eq('source', args.source);

  const { data: rows, error } = await query;
  if (error) {
    console.error(`Query failed: ${error.message}`);
    process.exit(1);
  }

  if (!rows?.length) {
    console.log('No matching vehicle_images rows found.');
    return;
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'nuke-image-audit-'));
  const findings = [];

  try {
    for (const row of rows) {
      if (!row.image_url) {
        findings.push({
          id: row.id,
          source: row.source,
          file_name: row.file_name,
          issues: ['missing_image_url'],
        });
        continue;
      }

      let filePath = null;
      let exif = null;
      const trace = collectTraceSources(row);

      try {
        filePath = await downloadTemp(row.image_url, tmpDir, row.id);
        exif = readExif(filePath);
      } catch (err) {
        findings.push({
          id: row.id,
          source: row.source,
          file_name: row.file_name,
          trace,
          issues: [`exif_read_failed:${String(err.message || err)}`],
        });
        continue;
      }

      const dbGps = getDbGps(row);
      const binaryHasDate = Boolean(exif.date);
      const binaryHasGps = typeof exif.latitude === 'number' && typeof exif.longitude === 'number';
      const issues = [];

      if (binaryHasDate && !hasDbDate(row)) issues.push('binary_has_date_but_db_missing');
      if (binaryHasGps && !dbGps) issues.push('binary_has_gps_but_db_missing');
      if (trace.length === 0) issues.push('no_retraceable_source');
      if (!row.exif_data && (binaryHasDate || binaryHasGps || exif.make || exif.model)) issues.push('binary_has_exif_but_exif_data_null');

      findings.push({
        id: row.id,
        vehicle_id: row.vehicle_id,
        source: row.source,
        file_name: row.file_name,
        db: {
          taken_at: normalizeDate(row.taken_at),
          latitude: row.latitude,
          longitude: row.longitude,
          has_exif_data: Boolean(row.exif_data),
        },
        binary: {
          date: normalizeDate(exif.date),
          latitude: exif.latitude,
          longitude: exif.longitude,
          make: exif.make,
          model: exif.model,
          width: exif.width,
          height: exif.height,
        },
        trace,
        issues,
      });
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  const summary = {
    total_rows: findings.length,
    rows_with_issues: findings.filter((f) => f.issues.length > 0).length,
    binary_has_date_but_db_missing: findings.filter((f) => f.issues.includes('binary_has_date_but_db_missing')).length,
    binary_has_gps_but_db_missing: findings.filter((f) => f.issues.includes('binary_has_gps_but_db_missing')).length,
    binary_has_exif_but_exif_data_null: findings.filter((f) => f.issues.includes('binary_has_exif_but_exif_data_null')).length,
    no_retraceable_source: findings.filter((f) => f.issues.includes('no_retraceable_source')).length,
  };

  if (args.json) {
    console.log(JSON.stringify({ filters: args, summary, findings }, null, 2));
    return;
  }

  console.log('\nImage Source Integrity Audit');
  console.log(`Rows checked: ${summary.total_rows}`);
  console.log(`Rows with issues: ${summary.rows_with_issues}`);
  console.log(`Binary has date but DB missing: ${summary.binary_has_date_but_db_missing}`);
  console.log(`Binary has GPS but DB missing: ${summary.binary_has_gps_but_db_missing}`);
  console.log(`Binary has EXIF but exif_data is null: ${summary.binary_has_exif_but_exif_data_null}`);
  console.log(`No retraceable source pointer: ${summary.no_retraceable_source}`);

  const examples = findings.filter((f) => f.issues.length > 0).slice(0, 10);
  if (!examples.length) {
    console.log('\nNo mismatches found in the sampled rows.');
    return;
  }

  console.log('\nExamples');
  for (const example of examples) {
    console.log(`- ${example.file_name || example.id}`);
    console.log(`  source=${example.source} issues=${example.issues.join(', ')}`);
    console.log(`  db: taken_at=${example.db?.taken_at || 'null'} lat=${example.db?.latitude ?? 'null'} lon=${example.db?.longitude ?? 'null'} exif=${example.db?.has_exif_data ? 'yes' : 'no'}`);
    console.log(`  binary: date=${example.binary?.date || 'null'} lat=${example.binary?.latitude ?? 'null'} lon=${example.binary?.longitude ?? 'null'} camera=${[example.binary?.make, example.binary?.model].filter(Boolean).join(' ') || 'unknown'}`);
    if (example.trace?.length) {
      console.log(`  trace: ${example.trace.map((t) => `${t.label}=${t.value}`).join(' | ')}`);
    }
  }
}

await main();
