#!/usr/bin/env node
/**
 * iPhoto / Apple Photos intake for Nuke vehicle data platform
 *
 * Usage:
 *   node scripts/iphoto-intake.mjs --list                          # list all vehicle albums
 *   node scripts/iphoto-intake.mjs --album "1977 K5 Chevrolet Blazer"
 *   node scripts/iphoto-intake.mjs --vehicle-id <uuid> --album "..."
 *   node scripts/iphoto-intake.mjs --all                           # process all unmatched albums
 *
 * Requires: osxphotos, @supabase/supabase-js, dotenvx
 */

import { execSync, spawnSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, statSync, mkdirSync, rmSync } from 'fs';
import { join, basename } from 'path';
import os from 'os';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BUCKET = 'vehicle-photos';
const BATCH_SIZE = 10;

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const arg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };

// ─── Album enumeration ───────────────────────────────────────────────────────

function listAlbums() {
  const raw = execSync('osxphotos albums 2>/dev/null', { encoding: 'utf8' });
  const albums = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/^  '?([\d].*?)'?\s*:\s*(\d+)/);
    if (m) {
      const name = m[1].trim();
      const count = parseInt(m[2]);
      // Only vehicle-ish albums: starts with a year
      if (/^\d{4}\s/.test(name) && count > 0) {
        albums.push({ name, count });
      }
    }
  }
  return albums;
}

function parseAlbumName(name) {
  // Patterns:
  //   "1984 Chevrolet K20 LWB"  → year=1984, make=Chevrolet, model=K20
  //   "1977 K5 Chevrolet Blazer" → year=1977, make=Chevrolet, model=K5 Blazer
  //   "1972 K10 Chevrolet SWB"   → year=1972, make=Chevrolet, model=K10 SWB
  const yearMatch = name.match(/^(\d{4})\s+(.+)$/);
  if (!yearMatch) return null;
  const year = parseInt(yearMatch[1]);
  const rest = yearMatch[2].trim();

  const MAKES = ['Chevrolet', 'GMC', 'Ford', 'Dodge', 'Pontiac', 'Jaguar', 'Porsche',
    'Ferrari', 'Mercedes', 'Nissan', 'Lexus', 'Lincoln', 'Buick'];

  let make = null;
  let modelParts = rest.split(' ');
  for (const m of MAKES) {
    const idx = modelParts.findIndex(p => p.toLowerCase() === m.toLowerCase());
    if (idx !== -1) {
      make = m;
      modelParts.splice(idx, 1);
      break;
    }
  }
  if (!make) {
    // First word might be model series (K5, C10, etc.), second might be make
    make = 'Unknown';
  }
  const model = modelParts.join(' ').replace(/\s+/g, ' ').trim();
  return { year, make, model };
}

// ─── Vehicle matching ────────────────────────────────────────────────────────

async function findVehicle(year, make, model) {
  // Try exact year+make+model first
  const { data: exact } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin')
    .eq('year', year)
    .ilike('make', `%${make}%`)
    .ilike('model', `%${model.split(' ')[0]}%`)
    .limit(5);

  if (exact && exact.length === 1) return exact[0];
  if (exact && exact.length > 1) {
    console.log(`  Multiple matches for ${year} ${make} ${model}:`, exact.map(v => v.model).join(', '));
    return exact[0];
  }
  return null;
}

// ─── Photo export ────────────────────────────────────────────────────────────

function exportAlbum(albumName, destDir) {
  mkdirSync(destDir, { recursive: true });
  console.log(`  Exporting "${albumName}" → ${destDir}`);
  // --download-missing uses AppleScript and can block indefinitely on single missing photos.
  // Since Photos library is fully synced (osxphotos query --missing returns 0-1), skip it.
  // Use --use-photos-export for Photos-native export (handles edited/HDR correctly).
  // Note: --download-missing uses AppleScript and blocks indefinitely on iCloud-only photos.
  // Omitting it means truly missing photos are skipped, which is the desired behavior when
  // the library is already synced locally.
  const result = spawnSync('osxphotos', [
    'export', destDir,
    '--album', albumName,
    '--overwrite',
  ], { encoding: 'utf8', stdio: 'pipe' });

  if (result.status !== 0) {
    console.error('  Export error:', result.stderr?.slice(0, 200));
    return false;
  }
  return true;
}

function convertHeicToJpeg(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  const heicFiles = readdirSync(srcDir).filter(f => /\.heic$/i.test(f));
  let skipped = 0;
  for (const f of heicFiles) {
    const outName = f.replace(/\.heic$/i, '.jpg');
    try {
      execSync(`sips -s format jpeg "${join(srcDir, f)}" --out "${join(destDir, outName)}" -s formatOptions 85 > /dev/null 2>&1`);
    } catch (e) {
      // File may be iCloud-only stub or corrupted — skip silently
      skipped++;
    }
  }
  if (skipped > 0) console.log(`  Skipped ${skipped} HEIC files (iCloud-only or unreadable)`);
  // Copy non-HEIC images
  for (const f of readdirSync(srcDir)) {
    if (/\.(jpg|jpeg|png)$/i.test(f)) {
      execSync(`cp "${join(srcDir, f)}" "${join(destDir, f)}"`);
    }
  }
  return readdirSync(destDir).filter(f => /\.(jpg|jpeg|png)$/i.test(f)).length;
}

// ─── Supabase upload ─────────────────────────────────────────────────────────

async function uploadPhotos(vehicleId, jpegDir) {
  const files = readdirSync(jpegDir).filter(f => /\.(jpg|jpeg|png)$/i.test(f));
  console.log(`  Uploading ${files.length} images for vehicle ${vehicleId}...`);

  // Check existing to skip dupes
  const { data: existing } = await supabase
    .from('vehicle_images')
    .select('file_name')
    .eq('vehicle_id', vehicleId)
    .eq('source', 'iphoto');
  const existingNames = new Set((existing || []).map(r => r.file_name));

  const toUpload = files.filter(f => !existingNames.has(f));
  console.log(`  Skipping ${files.length - toUpload.length} already uploaded`);

  let uploaded = 0, errors = 0;
  for (let i = 0; i < toUpload.length; i += BATCH_SIZE) {
    const batch = toUpload.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (filename) => {
      const filePath = join(jpegDir, filename);
      const fileData = readFileSync(filePath);
      const fileSize = statSync(filePath).size;
      const storagePath = `${vehicleId}/iphoto/${filename}`;
      const mimeType = /\.png$/i.test(filename) ? 'image/png' : 'image/jpeg';

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, fileData, { contentType: mimeType, upsert: true });

      if (uploadError) { errors++; return; }

      const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

      const { error: insertError } = await supabase.from('vehicle_images').insert({
        vehicle_id: vehicleId,
        image_url: publicUrl,
        storage_path: storagePath,
        source: 'iphoto',
        mime_type: mimeType,
        file_name: filename,
        file_size: fileSize,
        is_external: false,
        ai_processing_status: 'pending',
      });
      if (insertError && !insertError.message.includes('duplicate') && !insertError.message.includes('unique')) {
        errors++;
      } else {
        uploaded++;
      }
    }));
    process.stdout.write(`\r  ${i + batch.length}/${toUpload.length} (${uploaded} new, ${errors} err)  `);
  }
  process.stdout.write('\n');

  // Set primary if none exists
  const { count: primaryCount } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .eq('vehicle_id', vehicleId)
    .eq('is_primary', true);

  if (!primaryCount) {
    const { data: first } = await supabase
      .from('vehicle_images')
      .select('id')
      .eq('vehicle_id', vehicleId)
      .eq('source', 'iphoto')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    if (first) {
      await supabase.from('vehicle_images').update({ is_primary: true }).eq('id', first.id);
    }
  }

  return { uploaded, errors, total: files.length };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function processAlbum(albumName, vehicleId = null) {
  console.log(`\nAlbum: "${albumName}"`);

  if (!vehicleId) {
    const parsed = parseAlbumName(albumName);
    if (!parsed) {
      console.log('  Could not parse album name, skipping');
      return null;
    }
    console.log(`  Parsed: ${parsed.year} ${parsed.make} ${parsed.model}`);
    const match = await findVehicle(parsed.year, parsed.make, parsed.model);
    if (!match) {
      console.log(`  No vehicle match found in DB — skipping (add vehicle first or pass --vehicle-id)`);
      return null;
    }
    vehicleId = match.id;
    console.log(`  Matched: ${match.year} ${match.make} ${match.model} (${match.vin || 'no VIN'}) → ${match.id}`);
  }

  const tmpExport = join(os.tmpdir(), `iphoto_export_${Date.now()}`);
  const tmpJpeg = join(os.tmpdir(), `iphoto_jpeg_${Date.now()}`);

  try {
    const ok = exportAlbum(albumName, tmpExport);
    if (!ok) return null;

    const count = convertHeicToJpeg(tmpExport, tmpJpeg);
    console.log(`  Converted: ${count} images`);

    const result = await uploadPhotos(vehicleId, tmpJpeg);
    console.log(`  Done: ${result.uploaded} uploaded, ${result.errors} errors`);
    return result;
  } finally {
    try { rmSync(tmpExport, { recursive: true, force: true }); } catch {}
    try { rmSync(tmpJpeg, { recursive: true, force: true }); } catch {}
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

if (flag('--list')) {
  const albums = listAlbums();
  console.log(`\n${albums.length} vehicle albums:\n`);
  for (const a of albums) {
    const parsed = parseAlbumName(a.name);
    const tag = parsed ? `${parsed.year} ${parsed.make} ${parsed.model}` : '?';
    console.log(`  [${a.count.toString().padStart(4)}] "${a.name}" → ${tag}`);
  }

} else if (flag('--album')) {
  const albumName = arg('--album');
  const vehicleId = arg('--vehicle-id');
  if (!albumName) { console.error('--album requires a value'); process.exit(1); }
  await processAlbum(albumName, vehicleId);

} else if (flag('--all')) {
  const albums = listAlbums();
  console.log(`Processing ${albums.length} vehicle albums...`);
  let matched = 0, skipped = 0;
  for (const a of albums) {
    const result = await processAlbum(a.name);
    if (result) matched++;
    else skipped++;
  }
  console.log(`\nDone: ${matched} matched, ${skipped} skipped`);

} else {
  console.log(`
iPhoto intake for Nuke

Usage:
  node scripts/iphoto-intake.mjs --list
  node scripts/iphoto-intake.mjs --album "1977 K5 Chevrolet Blazer"
  node scripts/iphoto-intake.mjs --album "..." --vehicle-id <uuid>
  node scripts/iphoto-intake.mjs --all
  `);
}
