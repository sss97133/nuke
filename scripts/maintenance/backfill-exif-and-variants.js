#!/usr/bin/env node
/*
  Backfill EXIF dateTaken and regenerate low-res variants with correct orientation for existing images.
  - Reads vehicle_images rows in batches
  - Downloads original image
  - Extracts EXIF (date/time + orientation) with exifr
  - Uses sharp to auto-rotate and create thumbnail (150w) and medium (400w)
  - Uploads variants back to Supabase storage (vehicle-data)
  - Updates vehicle_images.exif_data and variant URLs

  Usage:
    node scripts/maintenance/backfill-exif-and-variants.js [--vehicle <vehicleId>] [--limit 500]
*/
// Load environment variables from common files
try {
  // Prefer local overrides if present
  require('dotenv').config();
  require('dotenv').config({ path: '.env.local' });
  require('dotenv').config({ path: '.env.supabase' });
} catch {}

const { createClient } = require('@supabase/supabase-js');
const sharp = require('sharp');

const argv = parseArgs();
// Prefer project conventions from .env.supabase
const SUPABASE_URL = argv.url
  || process.env.VITE_SUPABASE_URL
  || process.env.SUPABASE_URL
  || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = argv.key
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_ROLE
  || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_SERVICE_ROLE || !SUPABASE_URL) {
  console.error('Missing SUPABASE_SERVICE_ROLE or SUPABASE_URL. Provide via --url/--key or set in .env/.env.local/.env.supabase');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { vehicle: null, limit: 500, url: null, key: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--vehicle') out.vehicle = args[++i];
    if (args[i] === '--limit') out.limit = parseInt(args[++i] || '500', 10);
    if (args[i] === '--url') out.url = args[++i];
    if (args[i] === '--key') out.key = args[++i];
  }
  return out;
}

async function downloadImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}`);
  const buf = await res.arrayBuffer();
  return Buffer.from(buf);
}

async function uploadToStorage(path, buffer, contentType = 'image/jpeg') {
  const { data, error } = await supabase.storage
    .from('vehicle-data')
    .upload(path, buffer, { contentType, upsert: true });
  if (error) throw error;
  const { data: urlData } = supabase.storage.from('vehicle-data').getPublicUrl(path);
  return urlData.publicUrl;
}

function isoFromExif(dateCandidate) {
  if (!dateCandidate) return null;
  try {
    const d = new Date(dateCandidate);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

async function processRow(row) {
  const { id, vehicle_id, image_url } = row;
  const fileName = image_url.split('/').pop() || `${id}.jpg`;
  const basePath = `vehicles/${vehicle_id}/images`;
  const thumbPath = `${basePath}/thumbnail/${fileName}`;
  const mediumPath = `${basePath}/medium/${fileName}`;

  const original = await downloadImage(image_url);

  // Extract EXIF
  let dateTakenIso = null;
  try {
    const { default: exifr } = await import('exifr');
    const exif = await exifr.parse(original, { tiff: true, exif: true });
    const dt = exif?.DateTimeOriginal || exif?.CreateDate || exif?.ModifyDate;
    const iso = isoFromExif(dt);
    if (iso) dateTakenIso = iso;
  } catch (e) {
    // continue without EXIF
  }

  // Generate variants with auto-rotate
  const thumbBuf = await sharp(original).rotate().resize({ width: 150 }).jpeg({ quality: 70 }).toBuffer();
  const mediumBuf = await sharp(original).rotate().resize({ width: 400 }).jpeg({ quality: 80 }).toBuffer();

  const [thumbUrl, mediumUrl] = await Promise.all([
    uploadToStorage(thumbPath, thumbBuf),
    uploadToStorage(mediumPath, mediumBuf)
  ]);

  // Update DB
  const patch = {
    thumbnail_url: thumbUrl,
    medium_url: mediumUrl,
    // keep large_url as-is for now
  };
  if (dateTakenIso) {
    patch.exif_data = Object.assign({}, row.exif_data || {}, { dateTaken: dateTakenIso.slice(0, 10) });
  }

  const { error: upErr } = await supabase
    .from('vehicle_images')
    .update(patch)
    .eq('id', id);
  if (upErr) throw upErr;
}

async function main() {
  const { vehicle, limit } = argv;
  console.log('Backfill EXIF + variants', { vehicle, limit });

  let query = supabase
    .from('vehicle_images')
    .select('id, vehicle_id, image_url, exif_data')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (vehicle) query = query.eq('vehicle_id', vehicle);

  const { data: rows, error } = await query;
  if (error) throw error;
  if (!rows || rows.length === 0) {
    console.log('No images found');
    return;
  }

  let ok = 0, fail = 0;
  for (const row of rows) {
    try {
      await processRow(row);
      ok++;
      process.stdout.write('.');
    } catch (e) {
      fail++;
      console.warn(`\nRow ${row.id} failed:`, e.message);
    }
  }
  console.log(`\nDone. Updated=${ok} Failed=${fail}`);
}

if (require.main === module) {
  main().catch(e => {
    console.error('Backfill failed:', e);
    process.exit(1);
  });
}
