#!/usr/bin/env node
/**
 * Fixes image contamination for a single vehicle.
 *
 * - Detects contaminated images (shared file_hash across multiple vehicles or bad host).
 * - Prefers canonical images from origin_metadata (gallery/thumbnail) when available.
 * - Dry-run by default; apply with --apply.
 *
 * Usage:
 *   node scripts/fix-vehicle-contamination.js --vehicle-id <uuid> [--apply]
 *
 * ENV:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY)
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or service role key in env.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  const v = args[idx + 1];
  return v && !v.startsWith('--') ? v : null;
};
const hasFlag = (flag) => args.includes(flag);

const vehicleId = getArg('--vehicle-id') || getArg('-v');
const apply = hasFlag('--apply');

if (!vehicleId) {
  console.error('Usage: node scripts/fix-vehicle-contamination.js --vehicle-id <uuid> [--apply]');
  process.exit(1);
}

// Hosts we never want as primary images
const HOST_BLOCKLIST = [
  'facebook.com',
  'px.ads.linkedin.com',
  'addtoany.com',
  'barrett-jackson.com', // placeholder image
];

const isBadHost = (url) => {
  try {
    const u = new URL(url);
    return HOST_BLOCKLIST.some((h) => u.hostname.includes(h));
  } catch {
    return false;
  }
};

const unique = (arr) => Array.from(new Set(arr.filter(Boolean)));

async function fetchVehicle(vehicleId) {
  const { data, error } = await supabase
    .from('vehicles')
    .select(
      `
        id, primary_image_url, image_url, profile_origin, discovery_url,
        origin_metadata, sale_status, auction_outcome, asking_price,
        sale_price, bat_sold_price, bat_sale_date
      `
    )
    .eq('id', vehicleId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Vehicle not found');
  return data;
}

async function fetchVehicleImages(vehicleId) {
  const { data, error } = await supabase
    .from('vehicle_images')
    .select(
      `
        id, vehicle_id, image_url, storage_path, file_hash,
        thumbnail_url, medium_url, large_url, variants, source
      `
    )
    .eq('vehicle_id', vehicleId);
  if (error) throw error;
  return data || [];
}

async function fetchHashUsage(hashes) {
  if (!hashes.length) return {};
  const { data, error } = await supabase
    .from('vehicle_images')
    .select('file_hash, vehicle_id')
    .in('file_hash', hashes);
  if (error) throw error;
  const usage = {};
  for (const row of data || []) {
    const arr = usage[row.file_hash] || new Set();
    arr.add(row.vehicle_id);
    usage[row.file_hash] = arr;
  }
  const counts = {};
  Object.entries(usage).forEach(([hash, set]) => {
    counts[hash] = set.size;
  });
  return counts;
}

function canonicalImagesFromOrigin(origin_metadata) {
  if (!origin_metadata || typeof origin_metadata !== 'object') return [];
  const images = Array.isArray(origin_metadata.images)
    ? origin_metadata.images
    : Array.isArray(origin_metadata.image_urls)
    ? origin_metadata.image_urls
    : [];
  const thumb =
    origin_metadata.thumbnail_url ||
    origin_metadata.thumbnail ||
    null;
  return unique([
    ...(thumb ? [thumb] : []),
    ...images,
  ]).filter((u) => typeof u === 'string' && u.startsWith('http'));
}

function pickPreferredPrimary({ canonical, cleanImages }) {
  if (canonical.length) return canonical[0];
  if (cleanImages.length) return cleanImages[0];
  return null;
}

async function run() {
  console.log(`🔍 Vehicle ${vehicleId} | apply=${apply ? 'YES' : 'no (dry-run)'}`);

  const vehicle = await fetchVehicle(vehicleId);
  const images = await fetchVehicleImages(vehicleId);

  const hashes = unique(images.map((i) => i.file_hash).filter(Boolean));
  const hashUsage = await fetchHashUsage(hashes);

  const contaminated = [];
  const clean = [];

  for (const img of images) {
    const url = img.image_url || img.large_url || img.medium_url || img.thumbnail_url || img.storage_path;
    const hashCount = img.file_hash ? hashUsage[img.file_hash] || 0 : 0;
    const shared = hashCount > 1;
    const badHost = url ? isBadHost(url) : false;
    if (shared || badHost) {
      contaminated.push({ ...img, reason: shared ? `hash shared by ${hashCount} vehicles` : 'bad host' });
    } else {
      clean.push(img);
    }
  }

  const canonical = canonicalImagesFromOrigin(vehicle.origin_metadata);
  const preferredPrimary = pickPreferredPrimary({
    canonical,
    cleanImages: clean.map((c) => c.image_url || c.large_url || c.medium_url || c.thumbnail_url).filter(Boolean),
  });

  console.log(`Images total=${images.length}, contaminated=${contaminated.length}, clean=${clean.length}`);
  if (contaminated.length) {
    console.log('Contaminated examples:', contaminated.slice(0, 5).map((c) => ({
      id: c.id,
      reason: c.reason,
      image_url: c.image_url,
      storage_path: c.storage_path,
      file_hash: c.file_hash,
    })));
  }
  console.log('Canonical (from origin_metadata):', canonical.slice(0, 5));
  console.log('Preferred primary:', preferredPrimary || '(none)');

  if (!apply) {
    console.log('Dry-run complete. Re-run with --apply to perform cleanup.');
    return;
  }

  // Delete contaminated vehicle_images
  if (contaminated.length) {
    const contaminatedIds = contaminated.map((c) => c.id);
    const { error: delErr } = await supabase.from('vehicle_images').delete().in('id', contaminatedIds);
    if (delErr) {
      console.error('Failed to delete contaminated images:', delErr);
      process.exit(1);
    }
    console.log(`Deleted ${contaminatedIds.length} contaminated vehicle_images rows.`);
  }

  // Update primary_image_url and image_url
  if (preferredPrimary && preferredPrimary !== vehicle.primary_image_url) {
    const { error: updErr } = await supabase
      .from('vehicles')
      .update({
        primary_image_url: preferredPrimary,
        image_url: vehicle.image_url || preferredPrimary,
        updated_at: new Date().toISOString(),
      })
      .eq('id', vehicleId);
    if (updErr) {
      console.error('Failed to update vehicle primary/image_url:', updErr);
      process.exit(1);
    }
    console.log('Updated vehicle primary_image_url/image_url.');
  } else {
    console.log('Primary image unchanged (no better candidate found).');
  }

  console.log('✅ Apply complete.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

