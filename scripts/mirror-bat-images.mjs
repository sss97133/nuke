/**
 * mirror-bat-images.mjs
 *
 * Downloads all bat_import images for a vehicle from the BaT CDN
 * and stores them in Supabase storage, updating the vehicle_images records.
 *
 * Usage: dotenvx run -- node scripts/mirror-bat-images.mjs
 */

import { createClient } from '@supabase/supabase-js';

const VEHICLE_ID = 'a90c008a-3379-41d8-9eb2-b4eda365d74c';
const BUCKET = 'vehicle-images';
const CONCURRENCY = 4;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function mirrorImage(record) {
  const { id, image_url } = record;

  try {
    // Download from BaT CDN
    const res = await fetch(image_url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://bringatrailer.com/',
      },
    });

    if (!res.ok) {
      console.error(`  ✗ ${id} — HTTP ${res.status} for ${image_url}`);
      return { id, ok: false, reason: `http_${res.status}` };
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpeg';
    const storagePath = `${VEHICLE_ID}/${id}.${ext}`;
    const buffer = await res.arrayBuffer();

    // Upload to Supabase storage
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      console.error(`  ✗ ${id} — upload failed: ${uploadError.message}`);
      return { id, ok: false, reason: uploadError.message };
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(storagePath);

    // Update the record
    const { error: updateError } = await supabase
      .from('vehicle_images')
      .update({
        image_url: publicUrl,
        storage_path: storagePath,
        is_external: false,
        source: 'bat_import_mirrored',
      })
      .eq('id', id);

    if (updateError) {
      console.error(`  ✗ ${id} — db update failed: ${updateError.message}`);
      return { id, ok: false, reason: updateError.message };
    }

    return { id, ok: true, publicUrl };

  } catch (err) {
    console.error(`  ✗ ${id} — error: ${err.message}`);
    return { id, ok: false, reason: err.message };
  }
}

async function runConcurrent(tasks, concurrency) {
  const results = [];
  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(t => t()));
    results.push(...batchResults);
    const done = Math.min(i + concurrency, tasks.length);
    const ok = results.filter(r => r.ok).length;
    process.stdout.write(`\r  ${done}/${tasks.length} — ${ok} mirrored`);
  }
  console.log();
  return results;
}

async function main() {
  console.log(`\nMirroring BaT images → Supabase storage`);
  console.log(`Vehicle: ${VEHICLE_ID}`);
  console.log(`Bucket:  ${BUCKET}\n`);

  // Fetch all bat_import records
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url')
    .eq('vehicle_id', VEHICLE_ID)
    .eq('source', 'bat_import')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to fetch images:', error.message);
    process.exit(1);
  }

  console.log(`Found ${images.length} bat_import images to mirror\n`);

  const tasks = images.map(img => () => mirrorImage(img));
  const results = await runConcurrent(tasks, CONCURRENCY);

  const ok = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok);

  console.log(`\nDone: ${ok}/${images.length} mirrored`);

  if (failed.length > 0) {
    console.log(`\nFailed (${failed.length}):`);
    failed.forEach(f => console.log(`  ${f.id}: ${f.reason}`));
  }
}

main().catch(console.error);
