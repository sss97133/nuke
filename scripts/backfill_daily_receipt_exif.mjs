#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'child_process';
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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
const USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';

function readExif(path) {
  try {
    const out = execFileSync('exiftool', [
      '-j', '-n',
      '-Make', '-Model', '-Software', '-LensModel',
      '-DateTimeOriginal', '-GPSLatitude', '-GPSLongitude',
      '-FocalLength', '-FNumber', '-ISO', '-ExposureTime',
      '-ImageWidth', '-ImageHeight',
      '-SerialNumber',
      path,
    ], { encoding: 'utf-8' });
    const r = JSON.parse(out)[0] || {};
    const exif = {};
    if (r.Make) exif.camera_make = String(r.Make);
    if (r.Model) exif.camera_model = String(r.Model);
    if (r.Software) exif.software = String(r.Software);
    if (r.LensModel) exif.lens_model = String(r.LensModel);
    if (r.FocalLength != null) exif.focal_length = r.FocalLength;
    if (r.FNumber != null) exif.aperture = r.FNumber;
    if (r.ISO != null) exif.iso = r.ISO;
    if (r.ExposureTime != null) exif.shutter_speed = r.ExposureTime;
    if (r.ImageWidth) exif.width = r.ImageWidth;
    if (r.ImageHeight) exif.height = r.ImageHeight;
    if (r.SerialNumber) exif.camera_serial = String(r.SerialNumber);
    if (r.GPSLatitude != null && r.GPSLongitude != null) {
      exif.location = { latitude: Number(r.GPSLatitude), longitude: Number(r.GPSLongitude) };
    }
    return { exif, datetime_original: r.DateTimeOriginal || null };
  } catch (e) {
    return { exif: null, datetime_original: null };
  }
}

const { data: rows, error } = await supabase
  .from('vehicle_images')
  .select('id, image_url, taken_at, vehicle_id')
  .eq('source', 'daily_receipt')
  .not('image_url', 'is', null);
if (error) { console.error(error); process.exit(1); }
console.log(`Found ${rows.length} daily_receipt rows`);

const dir = mkdtempSync(join(tmpdir(), 'dr-backfill-'));
let updated = 0, attribs = 0, no_exif = 0, errors = 0;

for (const r of rows) {
  try {
    const resp = await fetch(r.image_url);
    if (!resp.ok) { errors++; continue; }
    const buf = Buffer.from(await resp.arrayBuffer());
    const tmpPath = join(dir, `${r.id}.jpg`);
    writeFileSync(tmpPath, buf);
    const { exif, datetime_original } = readExif(tmpPath);
    unlinkSync(tmpPath);
    if (!exif?.camera_make) { no_exif++; continue; }

    // Update vehicle_images
    const upd = await supabase.from('vehicle_images').update({
      exif_data: exif,
      user_id: USER_ID,
      ...(exif.location?.latitude != null && { latitude: exif.location.latitude }),
      ...(exif.location?.longitude != null && { longitude: exif.location.longitude }),
    }).eq('id', r.id);
    if (upd.error) { console.error(`vi update ${r.id}: ${upd.error.message}`); errors++; continue; }
    updated++;

    // Insert device_attributions
    const fp = `camera:${exif.camera_make.toLowerCase().replace(/\s+/g,'-')}:${(exif.camera_model||'unknown').toLowerCase().replace(/\s+/g,'-')}`;
    const dt = datetime_original ? new Date(datetime_original.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')).toISOString() : (r.taken_at || null);
    const ins = await supabase.from('device_attributions').insert({
      image_id: r.id,
      camera_make: exif.camera_make,
      camera_model: exif.camera_model || null,
      camera_serial: exif.camera_serial || null,
      device_fingerprint: fp,
      software: exif.software || null,
      attribution_source: 'photos_library_daily_receipt_backfill',
      extraction_method: 'exiftool_storage_passthrough',
      confidence_score: 100,
      actual_contributor_id: USER_ID,
      uploaded_by_user_id: USER_ID,
      datetime_original: dt,
      latitude: exif.location?.latitude ?? null,
      longitude: exif.location?.longitude ?? null,
      raw_exif: exif,
    });
    if (ins.error && !/duplicate|unique/i.test(ins.error.message)) {
      console.error(`attrib insert ${r.id}: ${ins.error.message}`);
    } else if (!ins.error) {
      attribs++;
    }
  } catch (e) {
    errors++;
    console.error(`row ${r.id}: ${e.message}`);
  }
}

console.log(`\nupdated=${updated} attribs=${attribs} no_exif=${no_exif} errors=${errors}`);
