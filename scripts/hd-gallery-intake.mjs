#!/usr/bin/env node
/**
 * HD Gallery Intake for Nuke — uploads art prints, personal photos, publications
 * to the user_gallery_items table for display on the profile Creative tab.
 *
 * Usage:
 *   dotenvx run -- node scripts/hd-gallery-intake.mjs --list       # preview what will upload
 *   dotenvx run -- node scripts/hd-gallery-intake.mjs --all        # upload everything
 *   dotenvx run -- node scripts/hd-gallery-intake.mjs --type print # upload just BAT prints
 *   dotenvx run -- node scripts/hd-gallery-intake.mjs --type photo # upload just Skylar photos
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

const BUCKET = 'vehicle-data'; // unlimited size, public
const USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';
const BATCH_SIZE = 5; // smaller batches for large files

// ─── Content definitions ─────────────────────────────────────────────────────

const HD_JENNY = '/Volumes/EXTERNAL HD/jenny';
const HD_ARCHIVE = '/Volumes/EXTERNAL HD/mac-archive-2026-03-05';

const BAT_PRINTS = [
  {
    path: `${HD_JENNY}/BAT/ARSHAM_150x100cm.jpg`,
    title: 'Untitled',
    artist_name: 'Daniel Arsham',
    content_type: 'print',
    dimensions: '150x100cm',
    medium: 'Archival pigment print',
    venue: 'Nuke Gallery',
    tags: ['arsham', 'sculpture', 'contemporary'],
  },
  {
    path: `${HD_JENNY}/BAT/BChivers_150x100cm.jpg`,
    title: 'Untitled',
    artist_name: 'Blair Chivers',
    content_type: 'print',
    dimensions: '150x100cm',
    medium: 'Archival pigment print',
    venue: 'Nuke Gallery',
    tags: ['chivers', 'flag', 'contemporary'],
  },
  {
    path: `${HD_JENNY}/BAT/BOURDIN_150X100cm.jpg`,
    title: 'Untitled',
    artist_name: 'Guy Bourdin',
    content_type: 'print',
    dimensions: '150x100cm',
    medium: 'Archival pigment print',
    venue: 'Nuke Gallery',
    tags: ['bourdin', 'fashion', 'photography'],
  },
  {
    path: `${HD_JENNY}/BAT/ESTEVE_150x100cm.jpg`,
    title: 'Untitled',
    artist_name: 'Esteve',
    content_type: 'print',
    dimensions: '150x100cm',
    medium: 'Archival pigment print',
    venue: 'Nuke Gallery',
    tags: ['esteve', 'contemporary'],
  },
  {
    path: `${HD_JENNY}/BAT/JCDC_150x100cm.jpg`,
    title: 'Untitled I',
    artist_name: 'Jean-Charles de Castelbajac',
    content_type: 'print',
    dimensions: '150x100cm',
    medium: 'Archival pigment print',
    venue: 'Nuke Gallery',
    tags: ['jcdc', 'castelbajac', 'contemporary'],
  },
  {
    path: `${HD_JENNY}/BAT/JCDC2_150x100cm.jpg`,
    title: 'Untitled II',
    artist_name: 'Jean-Charles de Castelbajac',
    content_type: 'print',
    dimensions: '150x100cm',
    medium: 'Archival pigment print',
    venue: 'Nuke Gallery',
    tags: ['jcdc', 'castelbajac', 'contemporary'],
  },
  {
    path: `${HD_JENNY}/BAT/RUIZSTEPHINSON_150X100cm.jpg`,
    title: 'Untitled',
    artist_name: 'Ruiz-Stephinson',
    content_type: 'print',
    dimensions: '150x100cm',
    medium: 'Archival pigment print',
    venue: 'Nuke Gallery',
    tags: ['ruiz-stephinson', 'contemporary'],
  },
  {
    path: `${HD_JENNY}/BAT/SULTAN_150X100cm.jpg`,
    title: 'Untitled',
    artist_name: 'Sultan',
    content_type: 'print',
    dimensions: '150x100cm',
    medium: 'Archival pigment print',
    venue: 'Nuke Gallery',
    tags: ['sultan', 'contemporary'],
  },
];

const SKYLAR_PHOTOS_DIR = `${HD_JENNY}/0 SKYLAR PHOTOS`;
const ARTBOOK_PATH = `${HD_ARCHIVE}/Desktop-Projects/skylar artbook CRAIGSLIST.pdf`;

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const arg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };

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

// ─── Upload single file to gallery ──────────────────────────────────────────
async function uploadGalleryItem(filePath, metadata) {
  const fileName = basename(filePath);
  const ext = extname(fileName).toLowerCase();
  const fileData = readFileSync(filePath);
  const fileSize = statSync(filePath).size;
  const fileHash = createHash('sha256').update(fileData).digest('hex');

  const mimeType = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.heic': 'image/heic', '.pdf': 'application/pdf', '.webp': 'image/webp',
  }[ext] || 'application/octet-stream';

  const contentFolder = metadata.content_type || 'artwork';
  const storagePath = `gallery/${USER_ID}/${contentFolder}/${fileHash.slice(0, 8)}_${fileName}`;

  // Upload to storage
  const { error: uploadError } = await withRetry(async () => {
    const r = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, fileData, { contentType: mimeType, upsert: true });
    if (r.error) throw r.error;
    return r;
  }, `upload-${fileName}`);

  if (uploadError) {
    console.error(`  Upload error (${fileName}): ${uploadError.message}`);
    return false;
  }

  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

  // Insert into user_gallery_items
  const row = {
    user_id: USER_ID,
    title: metadata.title || null,
    description: metadata.description || null,
    image_url: publicUrl,
    storage_path: storagePath,
    content_type: metadata.content_type || 'artwork',
    medium: metadata.medium || null,
    dimensions: metadata.dimensions || null,
    artist_name: metadata.artist_name || null,
    exhibition: metadata.exhibition || null,
    venue: metadata.venue || null,
    year_created: metadata.year_created || null,
    tags: metadata.tags || null,
    metadata: { file_hash: fileHash, original_path: filePath },
    is_public: true,
    file_size: fileSize,
    mime_type: mimeType,
  };

  const { error: insertError } = await supabase.from('user_gallery_items').insert(row);
  if (insertError) {
    console.error(`  Insert error (${fileName}): ${insertError.message.slice(0, 100)}`);
    return false;
  }

  return true;
}

// ─── Upload BAT prints ──────────────────────────────────────────────────────
async function uploadBatPrints() {
  console.log('\n--- BAT Prints (Bon a Tirer) ---');
  console.log(`${BAT_PRINTS.length} prints to upload\n`);

  // Check existing
  const { data: existing } = await supabase
    .from('user_gallery_items')
    .select('storage_path')
    .eq('user_id', USER_ID)
    .eq('content_type', 'print');
  const existingPaths = new Set((existing || []).map(r => r.storage_path));

  let uploaded = 0, skipped = 0, errors = 0;
  for (const print of BAT_PRINTS) {
    const fileName = basename(print.path);
    // Quick check: any existing path containing this filename?
    const alreadyExists = [...existingPaths].some(p => p.includes(fileName));
    if (alreadyExists) {
      console.log(`  Skip (exists): ${print.artist_name} — ${fileName}`);
      skipped++;
      continue;
    }

    process.stdout.write(`  Uploading: ${print.artist_name} (${fileName})... `);
    try {
      const ok = await uploadGalleryItem(print.path, print);
      if (ok) { uploaded++; console.log('done'); }
      else { errors++; console.log('FAILED'); }
    } catch (e) {
      errors++;
      console.log(`ERROR: ${e.message.slice(0, 80)}`);
    }
  }

  console.log(`\nBAT prints: ${uploaded} uploaded, ${skipped} skipped, ${errors} errors`);
  return { uploaded, skipped, errors };
}

// ─── Upload Skylar photos ───────────────────────────────────────────────────
async function uploadSkylarPhotos() {
  console.log('\n--- Skylar Photos ---');

  let files;
  try {
    files = readdirSync(SKYLAR_PHOTOS_DIR)
      .filter(f => /\.(jpg|jpeg|png|heic)$/i.test(f));
  } catch (e) {
    console.error(`Cannot read ${SKYLAR_PHOTOS_DIR}: ${e.message}`);
    return { uploaded: 0, skipped: 0, errors: 1 };
  }

  console.log(`${files.length} photos to upload\n`);

  // Check existing
  const { data: existing } = await supabase
    .from('user_gallery_items')
    .select('storage_path')
    .eq('user_id', USER_ID)
    .eq('content_type', 'photography');
  const existingPaths = new Set((existing || []).map(r => r.storage_path));

  let uploaded = 0, skipped = 0, errors = 0;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (fileName) => {
      const alreadyExists = [...existingPaths].some(p => p.includes(fileName));
      if (alreadyExists) { skipped++; return; }

      try {
        const filePath = join(SKYLAR_PHOTOS_DIR, fileName);
        const ok = await uploadGalleryItem(filePath, {
          content_type: 'photography',
          artist_name: 'Skylar Williams',
          tags: ['personal', 'photography'],
        });
        if (ok) uploaded++;
        else errors++;
      } catch (e) {
        errors++;
      }
    }));
    process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, files.length)}/${files.length} (${uploaded} new, ${skipped} skip, ${errors} err)  `);
  }
  process.stdout.write('\n');

  console.log(`\nSkylar photos: ${uploaded} uploaded, ${skipped} skipped, ${errors} errors`);
  return { uploaded, skipped, errors };
}

// ─── Upload artbook ─────────────────────────────────────────────────────────
async function uploadArtbook() {
  console.log('\n--- Skylar Artbook ---');

  // Check existing
  const { data: existing } = await supabase
    .from('user_gallery_items')
    .select('id')
    .eq('user_id', USER_ID)
    .eq('content_type', 'publication')
    .limit(1);

  if (existing?.length) {
    console.log('  Already uploaded — skipping');
    return { uploaded: 0, skipped: 1, errors: 0 };
  }

  const fileSize = statSync(ARTBOOK_PATH).size;
  console.log(`  File: ${ARTBOOK_PATH}`);
  console.log(`  Size: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);

  process.stdout.write('  Uploading... ');
  try {
    const ok = await uploadGalleryItem(ARTBOOK_PATH, {
      title: 'Craigslist Artbook',
      content_type: 'publication',
      artist_name: 'Skylar Williams',
      year_created: 2019,
      medium: 'Digital publication',
      tags: ['artbook', 'craigslist', 'publication'],
    });
    if (ok) { console.log('done'); return { uploaded: 1, skipped: 0, errors: 0 }; }
    else { console.log('FAILED'); return { uploaded: 0, skipped: 0, errors: 1 }; }
  } catch (e) {
    console.log(`ERROR: ${e.message.slice(0, 80)}`);
    return { uploaded: 0, skipped: 0, errors: 1 };
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

if (flag('--list')) {
  console.log('\n--- Content to upload ---\n');
  console.log('BAT Prints:');
  for (const p of BAT_PRINTS) {
    const size = statSync(p.path).size;
    console.log(`  ${p.artist_name.padEnd(35)} ${(size / 1024 / 1024).toFixed(1).padStart(6)} MB  ${basename(p.path)}`);
  }
  console.log(`\nSkylar Photos: ${SKYLAR_PHOTOS_DIR}`);
  try {
    const count = readdirSync(SKYLAR_PHOTOS_DIR).filter(f => /\.(jpg|jpeg|png|heic)$/i.test(f)).length;
    console.log(`  ${count} images`);
  } catch { console.log('  (folder not accessible)'); }
  console.log(`\nArtbook: ${ARTBOOK_PATH}`);
  try {
    const size = statSync(ARTBOOK_PATH).size;
    console.log(`  ${(size / 1024 / 1024).toFixed(1)} MB`);
  } catch { console.log('  (file not accessible)'); }

} else if (flag('--type')) {
  const type = arg('--type');
  if (type === 'print' || type === 'prints' || type === 'bat') {
    await uploadBatPrints();
  } else if (type === 'photo' || type === 'photos' || type === 'skylar') {
    await uploadSkylarPhotos();
  } else if (type === 'artbook' || type === 'publication') {
    await uploadArtbook();
  } else {
    console.error(`Unknown type: ${type}. Valid: print, photo, artbook`);
  }

} else if (flag('--all')) {
  console.log('Uploading all gallery content from external HD...');
  const r1 = await uploadBatPrints();
  const r2 = await uploadSkylarPhotos();
  const r3 = await uploadArtbook();
  const total = {
    uploaded: r1.uploaded + r2.uploaded + r3.uploaded,
    skipped: r1.skipped + r2.skipped + r3.skipped,
    errors: r1.errors + r2.errors + r3.errors,
  };
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TOTAL: ${total.uploaded} uploaded, ${total.skipped} skipped, ${total.errors} errors`);

} else {
  console.log(`
HD Gallery Intake for Nuke

Usage:
  dotenvx run -- node scripts/hd-gallery-intake.mjs --list
  dotenvx run -- node scripts/hd-gallery-intake.mjs --all
  dotenvx run -- node scripts/hd-gallery-intake.mjs --type print
  dotenvx run -- node scripts/hd-gallery-intake.mjs --type photo
  dotenvx run -- node scripts/hd-gallery-intake.mjs --type artbook
  `);
}
