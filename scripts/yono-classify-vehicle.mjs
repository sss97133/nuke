#!/usr/bin/env node
/**
 * Classify all unzoned images for a vehicle via YONO sidecar.
 * Sends batches of 10, writes results back to vehicle_images.
 *
 * Usage:
 *   dotenvx run -- node scripts/yono-classify-vehicle.mjs --vehicle-id <uuid>
 */

import { createClient } from '@supabase/supabase-js';
import dns from 'dns';

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

const SIDECAR_URL = process.env.YONO_SIDECAR_URL;
const SIDECAR_TOKEN = process.env.MODAL_SIDECAR_TOKEN || '';
const BATCH_SIZE = 10;

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };
const vehicleId = arg('--vehicle-id');
if (!vehicleId) { console.error('--vehicle-id required'); process.exit(1); }

// Count unzoned images
const { count } = await supabase
  .from('vehicle_images')
  .select('*', { count: 'exact', head: true })
  .eq('vehicle_id', vehicleId)
  .is('vehicle_zone', null)
  .like('image_url', '%supabase%');

console.log(`${count} images need zone classification for ${vehicleId}`);
if (count === 0) { console.log('Done.'); process.exit(0); }

let classified = 0, errors = 0, offset = 0;

while (true) {
  // Fetch batch of unzoned images
  const { data: batch } = await supabase
    .from('vehicle_images')
    .select('id, image_url')
    .eq('vehicle_id', vehicleId)
    .is('vehicle_zone', null)
    .like('image_url', '%supabase%')
    .limit(BATCH_SIZE);

  if (!batch || batch.length === 0) break;

  // Call YONO sidecar
  const payload = { images: batch.map(b => ({ id: b.id, image_url: b.image_url })) };
  let results;
  try {
    const resp = await nodeFetch(`${SIDECAR_URL}/analyze/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SIDECAR_TOKEN}`,
      },
      body: JSON.stringify(payload),
      timeout: 180000,
    });
    const data = await resp.json();
    results = data.results || [];
  } catch (e) {
    console.error(`\nSidecar error: ${e.message}`);
    errors += batch.length;
    continue;
  }

  // Write results back
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const img = batch[i];
    if (!img || !r || r.error) { errors++; continue; }

    const update = {
      vehicle_zone: r.vehicle_zone,
      zone_confidence: r.zone_confidence,
      zone_source: r.zone_source || 'zone_classifier_v1',
      condition_score: r.condition_score,
      damage_flags: r.damage_flags || [],
      modification_flags: r.modification_flags || [],
      photo_quality_score: r.photo_quality,
      vision_analyzed_at: new Date().toISOString(),
      vision_model_version: r.model || 'finetuned_v2',
      ai_processing_status: 'completed',
    };
    if (r.interior_quality != null) update.interior_quality = r.interior_quality;

    const { error } = await supabase
      .from('vehicle_images')
      .update(update)
      .eq('id', img.id);

    if (error) { errors++; } else { classified++; }
  }

  process.stdout.write(`\r  ${classified + errors}/${count} (${classified} classified, ${errors} errors)  `);
}

process.stdout.write('\n');
console.log(`Done: ${classified} classified, ${errors} errors`);
