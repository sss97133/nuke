/* eslint-disable no-console */
/**
 * Cleanup a contaminated vehicle profile:
 * - Detach external listing URL(s) (e.g., Bring a Trailer) from `vehicles`
 * - Optionally remove external_listings rows pointing at that URL
 * - Mark duplicate `vehicle_images` rows as duplicates (by file_hash/storage_path/image_url)
 *
 * Usage:
 *   node scripts/cleanup_vehicle_contamination.js <vehicleId> [--dry-run]
 *
 * Env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (service role key required for writes)
 */

const { createClient } = require('@supabase/supabase-js');

function parseArgs(argv) {
  const args = { vehicleId: null, dryRun: false };
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') args.dryRun = true;
    else if (!args.vehicleId) args.vehicleId = a;
  }
  if (!args.vehicleId) {
    throw new Error('Missing vehicleId. Usage: node scripts/cleanup_vehicle_contamination.js <vehicleId> [--dry-run]');
  }
  return args;
}

function keyForImage(img) {
  return (
    img.file_hash ||
    img.storage_path ||
    (img.variants && (img.variants.full || img.variants.large)) ||
    img.image_url ||
    img.id
  );
}

async function main() {
  const { vehicleId, dryRun } = parseArgs(process.argv);
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  console.log(`\n[cleanup] vehicleId=${vehicleId} dryRun=${dryRun}\n`);

  // 1) Load vehicle
  const { data: vehicle, error: vehErr } = await supabase
    .from('vehicles')
    .select('id, discovery_url, listing_url, bat_auction_url, origin_metadata')
    .eq('id', vehicleId)
    .single();

  if (vehErr) throw vehErr;
  if (!vehicle) throw new Error('Vehicle not found');

  const discoveryUrl = vehicle.discovery_url || vehicle.listing_url || vehicle.bat_auction_url || null;
  const isBat = typeof discoveryUrl === 'string' && discoveryUrl.toLowerCase().includes('bringatrailer.com');

  console.log('[cleanup] vehicle discovery/listing URL:', discoveryUrl);

  // 2) Detach listing URLs from vehicle
  const nextMeta = { ...(vehicle.origin_metadata || {}) };
  delete nextMeta.discovery_url;
  delete nextMeta.bat_url;
  delete nextMeta.matched_from;
  delete nextMeta.import_source;

  const vehicleUpdate = {
    discovery_url: null,
    listing_url: null,
    bat_auction_url: null,
    origin_metadata: nextMeta,
    updated_at: new Date().toISOString()
  };

  console.log('[cleanup] vehicle update:', vehicleUpdate);
  if (!dryRun) {
    const { error: updErr } = await supabase.from('vehicles').update(vehicleUpdate).eq('id', vehicleId);
    if (updErr) throw updErr;
  }

  // 3) Optionally remove wrong external_listings row(s)
  if (discoveryUrl) {
    const { data: listings, error: listErr } = await supabase
      .from('external_listings')
      .select('id, platform, listing_url')
      .eq('vehicle_id', vehicleId);
    if (listErr) {
      console.warn('[cleanup] external_listings read failed (continuing):', listErr.message);
    } else {
      const toRemove = (listings || []).filter((l) => {
        if (isBat) return (l.listing_url || '').toLowerCase().includes('bringatrailer.com') || l.platform === 'bat';
        return l.listing_url === discoveryUrl;
      });
      if (toRemove.length) {
        console.log(`[cleanup] external_listings to remove: ${toRemove.length}`);
        if (!dryRun) {
          const ids = toRemove.map((l) => l.id);
          const { error: delErr } = await supabase.from('external_listings').delete().in('id', ids);
          if (delErr) throw delErr;
        }
      } else {
        console.log('[cleanup] no matching external_listings rows to remove');
      }
    }
  }

  // 4) De-dupe vehicle_images rows (mark duplicates)
  const { data: imgs, error: imgErr } = await supabase
    .from('vehicle_images')
    .select('id, file_hash, storage_path, image_url, variants, is_primary, is_duplicate, duplicate_of, created_at, taken_at')
    .eq('vehicle_id', vehicleId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(2000);

  if (imgErr) throw imgErr;

  const groups = new Map();
  for (const img of imgs || []) {
    const k = keyForImage(img);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(img);
  }

  let dupCount = 0;
  const updates = [];

  for (const [k, arr] of groups.entries()) {
    if (!k || !Array.isArray(arr) || arr.length < 2) continue;
    // Keep the primary if present; else keep newest
    const sorted = [...arr].sort((a, b) => {
      if (a.is_primary && !b.is_primary) return -1;
      if (!a.is_primary && b.is_primary) return 1;
      const da = new Date(a.taken_at || a.created_at || 0).getTime();
      const db = new Date(b.taken_at || b.created_at || 0).getTime();
      return db - da;
    });
    const keep = sorted[0];
    const dups = sorted.slice(1);
    for (const d of dups) {
      if (d.is_duplicate === true && d.duplicate_of) continue;
      dupCount += 1;
      updates.push({ id: d.id, is_duplicate: true, duplicate_of: keep.id });
    }
  }

  console.log(`[cleanup] duplicates to mark: ${dupCount}`);
  if (!dryRun && updates.length) {
    // Batch upserts by id (assumes id is PK)
    const chunkSize = 250;
    for (let i = 0; i < updates.length; i += chunkSize) {
      const chunk = updates.slice(i, i + chunkSize);
      const { error } = await supabase.from('vehicle_images').upsert(chunk, { onConflict: 'id' });
      if (error) throw error;
    }
  }

  // 5) Safety: If any ownership verification uploads were mistakenly inserted into vehicle_images,
  // mark them as documents so they don't appear in the public gallery UI.
  // (Ownership uploads live under: vehicle-data/vehicles/<vehicleId>/ownership/...)
  const ownershipMislinked = (imgs || []).filter((img) => {
    const url = (img.image_url || '').toString();
    const path = (img.storage_path || '').toString();
    // Common shapes:
    // - storage_path from vehicle-data might include `vehicles/<id>/ownership/`
    // - public URL might include `/vehicle-data/vehicles/<id>/ownership/`
    // - some scripts store full bucket-prefixed paths
    return (
      url.includes(`/vehicle-data/vehicles/${vehicleId}/ownership/`) ||
      url.includes(`/vehicles/${vehicleId}/ownership/`) ||
      path.includes(`/vehicles/${vehicleId}/ownership/`) ||
      path.includes(`vehicles/${vehicleId}/ownership/`) ||
      path.includes(`/ownership/`)
    );
  });

  if (ownershipMislinked.length) {
    console.log(`[cleanup] ownership docs mislinked into vehicle_images: ${ownershipMislinked.length}`);
    const docUpdates = ownershipMislinked.map((img) => ({
      id: img.id,
      is_document: true,
      document_category: 'title',
      // Extra safety: mark sensitive so SensitiveImageOverlay can protect it if anything still renders it.
      is_sensitive: true,
      sensitive_type: 'ownership_document'
    }));

    if (!dryRun) {
      const chunkSize = 250;
      for (let i = 0; i < docUpdates.length; i += chunkSize) {
        const chunk = docUpdates.slice(i, i + chunkSize);
        const { error } = await supabase.from('vehicle_images').upsert(chunk, { onConflict: 'id' });
        if (error) throw error;
      }
    }
  } else {
    console.log('[cleanup] no mislinked ownership docs found in vehicle_images');
  }

  console.log('\n[cleanup] done\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


