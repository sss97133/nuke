#!/usr/bin/env npx tsx
/**
 * Run diagnostic + fix for vehicle 992fb704 (wrong lead image, missing VIN).
 * Uses Supabase client; load env from nuke/.env or nuke_frontend/.env.local.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VEHICLE_ID = '992fb704-85d4-4358-9631-8f11fe9b5f47';

function loadEnv(dir: string) {
  for (const f of ['.env', '.env.local']) {
    const p = resolve(dir, f);
    if (existsSync(p)) {
      const content = readFileSync(p, 'utf8');
      for (const line of content.split('\n')) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
      }
    }
  }
}

const nukeRoot = resolve(__dirname, '..');
loadEnv(nukeRoot);
loadEnv(resolve(nukeRoot, 'nuke_frontend'));

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (set in nuke/.env or nuke_frontend/.env.local)');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log('Diagnostic: vehicle', VEHICLE_ID);
  const { data: vehicle, error: veErr } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, primary_image_url, discovery_url, origin_metadata')
    .eq('id', VEHICLE_ID)
    .single();
  if (veErr) {
    console.error('Vehicle fetch error:', veErr);
    process.exit(1);
  }
  console.log('Vehicle:', {
    year: vehicle?.year,
    make: vehicle?.make,
    model: vehicle?.model,
    vin: vehicle?.vin ?? '(null)',
    primary_image_url: vehicle?.primary_image_url ? vehicle.primary_image_url.slice(0, 80) + '...' : '(null)',
    origin_vin: vehicle?.origin_metadata && typeof vehicle.origin_metadata === 'object' ? (vehicle.origin_metadata as Record<string, unknown>).vin : null,
  });

  const { data: images } = await supabase
    .from('vehicle_images')
    .select('id, is_primary, position, storage_path, image_url')
    .eq('vehicle_id', VEHICLE_ID)
    .eq('is_document', false)
    .eq('is_duplicate', false)
    .order('is_primary', { ascending: false })
    .order('position', { ascending: true, nullsFirst: false })
    .limit(5);
  console.log('Top vehicle_images (is_primary, position):', images?.map((i) => ({ is_primary: i.is_primary, position: i.position, url: i.image_url?.slice(0, 60) })));

  console.log('\nStep 1: repair_bat_vehicle_gallery_images(...)');
  const { data: repairResult, error: repairErr } = await supabase.rpc('repair_bat_vehicle_gallery_images', {
    p_vehicle_id: VEHICLE_ID,
    p_dry_run: false,
  });
  if (repairErr) {
    console.error('Repair RPC error:', repairErr);
    process.exit(1);
  }
  console.log('Repair result:', repairResult);

  console.log('\nStep 1b: Sync vehicles.primary_image_url from is_primary image');
  const { data: primaryImg } = await supabase
    .from('vehicle_images')
    .select('image_url')
    .eq('vehicle_id', VEHICLE_ID)
    .eq('is_document', false)
    .eq('is_duplicate', false)
    .eq('is_primary', true)
    .limit(1)
    .single();
  if (primaryImg?.image_url) {
    const { error: upErr } = await supabase
      .from('vehicles')
      .update({ primary_image_url: primaryImg.image_url, updated_at: new Date().toISOString() })
      .eq('id', VEHICLE_ID);
    if (upErr) console.error('Update primary_image_url error:', upErr);
    else console.log('Updated primary_image_url');
  } else {
    console.log('No is_primary image found; skipping primary_image_url update');
  }

  console.log('\nStep 2: VIN backfill from origin_metadata');
  const meta = vehicle?.origin_metadata as Record<string, unknown> | null;
  const originVin = meta && typeof meta.vin === 'string' ? meta.vin.trim() : null;
  if (originVin && (!vehicle?.vin || !vehicle.vin.trim())) {
    const { error: vinErr } = await supabase
      .from('vehicles')
      .update({ vin: originVin, updated_at: new Date().toISOString() })
      .eq('id', VEHICLE_ID);
    if (vinErr) console.error('VIN update error:', vinErr);
    else console.log('Updated vin from origin_metadata:', originVin);
  } else {
    console.log('VIN already set or no origin_metadata.vin; skipping');
  }

  console.log('\nDone.');
}

main();
