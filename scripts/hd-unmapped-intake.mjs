#!/usr/bin/env node
/**
 * HD Unmapped Image Intake — uploads images from unorganized HD folders.
 *
 * Car-related → vehicle_images (vehicle_id=NULL, for AI sorting later)
 * Personal/other → user_gallery_items
 *
 * Usage:
 *   dotenvx run -- node scripts/hd-unmapped-intake.mjs --list
 *   dotenvx run -- node scripts/hd-unmapped-intake.mjs --all
 *   dotenvx run -- node scripts/hd-unmapped-intake.mjs --folder "CAR/ set 1"
 *   dotenvx run -- node scripts/hd-unmapped-intake.mjs --dry-run --all
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname, basename } from 'path';
import { createHash } from 'crypto';
import dns from 'dns';

// ─── DNS fix ─────────────────────────────────────────────────────────────────
const resolver = new dns.Resolver();
resolver.setServers(['8.8.8.8', '1.1.1.1']);
const origLookup = dns.lookup.bind(dns);
dns.lookup = function(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  resolver.resolve4(hostname, (err, addresses) => {
    if (err || !addresses?.length) return origLookup(hostname, options, callback);
    if (options?.all) callback(null, addresses.map(a => ({ address: a, family: 4 })));
    else callback(null, addresses[0], 4);
  });
};
const nodeFetch = (await import('node-fetch')).default;

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  global: { fetch: nodeFetch }
});

const VEHICLE_BUCKET = 'vehicle-photos';
const GALLERY_BUCKET = 'vehicle-data';
const BATCH_SIZE = 10;
const USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic']);

const HD = '/Volumes/EXTERNAL HD/mac-archive-2026-03-05';

// ─── Folder definitions ────────────────────────────────────────────────────
// type: 'vehicle' → vehicle_images, 'personal' → user_gallery_items
const UNMAPPED_FOLDERS = [
  { path: `${HD}/Desktop-Projects/CAR/set 1`, type: 'vehicle', label: 'Car Set 1 (mixed)' },
  { path: `${HD}/Desktop-Projects/CAR/set 2`, type: 'vehicle', label: 'Car Set 2 (mixed)' },
  { path: `${HD}/Desktop-Projects/CAR/set 3 Iphone`, type: 'vehicle', label: 'Car Set 3 iPhone' },
  { path: `${HD}/Desktop-Projects/CAR/set 4 iphone`, type: 'vehicle', label: 'Car Set 4 iPhone' },
  { path: `${HD}/Desktop-Projects/CAR/POSTED IA`, type: 'vehicle', label: 'Posted to Internet Archive' },
  { path: `${HD}/Desktop-Projects/CAR/ CARchive`, type: 'vehicle', label: 'CARchive' },
  { path: `${HD}/Desktop-Projects/CAR/book`, type: 'vehicle', label: 'Car Book photos' },
  { path: `${HD}/Desktop-Projects/CAR/BOOK 1`, type: 'vehicle', label: 'Car Book 1' },
  { path: `${HD}/Desktop-Projects/CAR/not focus on yet sheet metal parts`, type: 'vehicle', label: 'Sheet metal parts' },
  { path: `${HD}/Desktop-Projects/CAR/Nevada travel`, type: 'personal', label: 'Nevada travel' },
  { path: `${HD}/Desktop-Projects/CAR/100CANON`, type: 'vehicle', label: 'Canon camera dump' },
  { path: `${HD}/Desktop-Projects/corvette_cl`, type: 'vehicle', label: 'Corvette CL research' },
  { path: `${HD}/Desktop-Projects/vegas`, type: 'personal', label: 'Vegas photos' },
  { path: `${HD}/Desktop-Projects/untitled folder`, type: 'personal', label: 'Untitled folder' },
  { path: `${HD}/Desktop-Projects/sccreens`, type: 'personal', label: 'Screenshots' },
  { path: `${HD}/Desktop-Projects/jak jpg`, type: 'personal', label: 'JAK photos' },
  { path: `${HD}/Desktop-Projects/my last dtop folder/dtop/untitled folder`, type: 'personal', label: 'Desktop untitled folder' },
];

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const arg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };
const DRY_RUN = flag('--dry-run');

// ─── Retry helper ────────────────────────────────────────────────────────────
async function withRetry(fn, label = '', retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try { return await fn(); }
    catch (e) {
      if (attempt === retries) throw e;
      const delay = attempt * 2000;
      console.log(`  Retry ${attempt}/${retries} (${label}): ${e.message} — waiting ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ─── Scan folder (recursive up to depth 2) ──────────────────────────────────
function scanFolder(folderPath, depth = 0) {
  const files = [];
  try {
    const entries = readdirSync(folderPath);
    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      const fullPath = join(folderPath, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory() && depth < 2) {
          files.push(...scanFolder(fullPath, depth + 1));
        } else if (!stat.isDirectory()) {
          const ext = extname(entry).toLowerCase();
          if (IMAGE_EXTS.has(ext)) {
            files.push({ path: fullPath, name: entry, size: stat.size, ext });
          }
        }
      } catch { /* skip unreadable */ }
    }
  } catch (e) {
    console.log(`  Warning: cannot read ${folderPath}: ${e.message}`);
  }
  return files;
}

// ─── Load all DB hashes ─────────────────────────────────────────────────────
async function loadAllDbHashes() {
  console.log('Loading existing DB hashes...');
  const hashes = new Set();
  let offset = 0, total = 0;
  const BATCH = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('vehicle_images')
      .select('file_hash')
      .not('file_hash', 'is', null)
      .range(offset, offset + BATCH - 1);
    if (error) { console.error(`  DB error: ${error.message}`); break; }
    if (!data?.length) break;
    for (const r of data) { if (r.file_hash) hashes.add(r.file_hash); }
    total += data.length;
    if (data.length < BATCH) break;
    offset += BATCH;
  }

  // Also check user_gallery_items metadata.file_hash
  offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('user_gallery_items')
      .select('metadata')
      .eq('user_id', USER_ID)
      .range(offset, offset + BATCH - 1);
    if (error) break;
    if (!data?.length) break;
    for (const r of data) {
      if (r.metadata?.file_hash) hashes.add(r.metadata.file_hash);
    }
    total += data.length;
    if (data.length < BATCH) break;
    offset += BATCH;
  }

  console.log(`  Loaded ${hashes.size} unique hashes from DB`);
  return hashes;
}

// ─── Upload one folder ──────────────────────────────────────────────────────
async function uploadFolder(folder, dbHashes) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${folder.label} [${folder.type}]`);
  console.log(`  ${folder.path}`);

  const files = scanFolder(folder.path);
  if (files.length === 0) {
    console.log('  No images found');
    return { uploaded: 0, skipped: 0, errors: 0, total: 0 };
  }
  console.log(`  ${files.length} images found`);

  if (DRY_RUN) {
    console.log('  [DRY RUN] Would upload:');
    for (const f of files.slice(0, 5)) console.log(`    ${f.name} (${(f.size / 1024).toFixed(0)} KB)`);
    if (files.length > 5) console.log(`    ... and ${files.length - 5} more`);
    return { uploaded: 0, skipped: 0, errors: 0, total: files.length };
  }

  let uploaded = 0, skipped = 0, errors = 0;
  const folderSlug = folder.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (file) => {
      try {
        const fileData = readFileSync(file.path);
        const fileHash = createHash('sha256').update(fileData).digest('hex');

        // Skip if already in DB
        if (dbHashes.has(fileHash)) {
          skipped++;
          return;
        }

        const mimeType = file.ext === '.png' ? 'image/png'
          : file.ext === '.heic' ? 'image/heic' : 'image/jpeg';

        // Sanitize filename for Supabase storage (accents, spaces, special chars)
        const safeName = file.name
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // strip accents
          .replace(/[^a-zA-Z0-9._-]/g, '_')                 // replace special chars
          .replace(/_+/g, '_');                               // collapse underscores

        if (folder.type === 'vehicle') {
          // Upload to vehicle-photos bucket, vehicle_images table
          const storagePath = `unsorted/hd-archive/${folderSlug}/${safeName}`;

          const { error: uploadError } = await withRetry(async () => {
            const r = await supabase.storage
              .from(VEHICLE_BUCKET)
              .upload(storagePath, fileData, { contentType: mimeType, upsert: true });
            if (r.error) throw r.error;
            return r;
          }, `upload-${file.name}`);
          if (uploadError) { errors++; return; }

          const { data: { publicUrl } } = supabase.storage.from(VEHICLE_BUCKET).getPublicUrl(storagePath);

          const row = {
            vehicle_id: null,  // unsorted — AI will assign later
            image_url: publicUrl,
            storage_path: storagePath,
            source: 'hd_archive_unsorted',
            mime_type: mimeType,
            file_name: file.name,
            file_size: file.size,
            file_hash: fileHash,
            is_external: false,
            ai_processing_status: 'pending',
            organization_status: 'unorganized',
            documented_by_user_id: USER_ID,
          };

          const { error: insertError } = await supabase.from('vehicle_images').insert(row);
          if (insertError && !insertError.message.includes('duplicate') && !insertError.message.includes('unique')) {
            if (errors < 5) console.error(`\n  Insert error (${file.name}): ${insertError.message.slice(0, 100)}`);
            errors++;
          } else {
            uploaded++;
            dbHashes.add(fileHash);
          }

        } else {
          // Upload to vehicle-data bucket, user_gallery_items table
          const storagePath = `gallery/${USER_ID}/photography/${fileHash.slice(0, 8)}_${safeName}`;

          const { error: uploadError } = await withRetry(async () => {
            const r = await supabase.storage
              .from(GALLERY_BUCKET)
              .upload(storagePath, fileData, { contentType: mimeType, upsert: true });
            if (r.error) throw r.error;
            return r;
          }, `upload-${file.name}`);
          if (uploadError) { errors++; return; }

          const { data: { publicUrl } } = supabase.storage.from(GALLERY_BUCKET).getPublicUrl(storagePath);

          const row = {
            user_id: USER_ID,
            image_url: publicUrl,
            storage_path: storagePath,
            content_type: 'photography',
            tags: [folderSlug],
            metadata: { file_hash: fileHash, original_path: file.path, hd_folder: folder.label },
            is_public: true,
            file_size: file.size,
            mime_type: mimeType,
          };

          const { error: insertError } = await supabase.from('user_gallery_items').insert(row);
          if (insertError) {
            if (errors < 5) console.error(`\n  Insert error (${file.name}): ${insertError.message.slice(0, 100)}`);
            errors++;
          } else {
            uploaded++;
            dbHashes.add(fileHash);
          }
        }
      } catch (e) {
        if (errors < 5) console.error(`\n  Error (${file.name}): ${e.message.slice(0, 100)}`);
        errors++;
      }
    }));
    process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, files.length)}/${files.length} (${uploaded} new, ${skipped} dupe, ${errors} err)  `);
  }
  process.stdout.write('\n');

  console.log(`  Done: ${uploaded} uploaded, ${skipped} hash-dupes, ${errors} errors`);
  return { uploaded, skipped, errors, total: files.length };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

if (flag('--list')) {
  console.log('\nUnmapped HD folders:\n');
  for (const folder of UNMAPPED_FOLDERS) {
    const files = scanFolder(folder.path);
    const typeTag = folder.type === 'vehicle' ? 'CAR' : 'PERSONAL';
    console.log(`  [${typeTag.padEnd(8)}] ${folder.label.padEnd(30)} ${files.length} images`);
  }
  const totalImages = UNMAPPED_FOLDERS.reduce((s, f) => s + scanFolder(f.path).length, 0);
  console.log(`\n  Total: ${totalImages} images`);

} else if (flag('--folder')) {
  const folderName = arg('--folder');
  const folder = UNMAPPED_FOLDERS.find(f =>
    f.label.toLowerCase().includes(folderName.toLowerCase()) ||
    f.path.toLowerCase().includes(folderName.toLowerCase())
  );
  if (!folder) {
    console.error(`No folder matching: ${folderName}`);
    console.error('Use --list to see available folders');
    process.exit(1);
  }
  const dbHashes = await loadAllDbHashes();
  await uploadFolder(folder, dbHashes);

} else if (flag('--all')) {
  console.log('Uploading all unmapped HD folders...\n');
  const dbHashes = await loadAllDbHashes();

  let totalUploaded = 0, totalSkipped = 0, totalErrors = 0, totalFiles = 0;
  for (const folder of UNMAPPED_FOLDERS) {
    const result = await uploadFolder(folder, dbHashes);
    totalUploaded += result.uploaded;
    totalSkipped += result.skipped;
    totalErrors += result.errors;
    totalFiles += result.total;
  }
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TOTAL: ${totalUploaded} uploaded, ${totalSkipped} hash-dupes, ${totalErrors} errors, ${totalFiles} scanned`);

} else {
  console.log(`
HD Unmapped Image Intake

Uploads unorganized images from HD folders not mapped to specific vehicles.
Car-related → vehicle_images (unsorted, for AI assignment later)
Personal → user_gallery_items

Usage:
  dotenvx run -- node scripts/hd-unmapped-intake.mjs --list
  dotenvx run -- node scripts/hd-unmapped-intake.mjs --all
  dotenvx run -- node scripts/hd-unmapped-intake.mjs --folder "set 1"
  dotenvx run -- node scripts/hd-unmapped-intake.mjs --dry-run --all
  `);
}
