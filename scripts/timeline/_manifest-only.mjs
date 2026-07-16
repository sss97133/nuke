#!/usr/bin/env node
// Read-only manifest generator (no image downloads — reuses /tmp cache).
// Mirrors pull-day.mjs queries exactly but emits only manifest.json.
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const args = process.argv.slice(2);
const arg = (n, d = null) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : d; };
const DATE = arg('--date');
const ANCHOR = 'a90c008a-3379-41d8-9eb2-b4eda365d74c';
const OUT = `/tmp/day/${DATE}`;
mkdirSync(join(OUT, 'reference'), { recursive: true });

const { data: anchorVeh } = await supabase.from('vehicles').select('user_id').eq('id', ANCHOR).single();
const USER_ID = anchorVeh?.user_id;
if (!USER_ID) { console.error('no user'); process.exit(2); }

const { data: vehs } = await supabase.from('vehicles')
  .select('id, year, make, model, vin, primary_image_url, image_count').eq('user_id', USER_ID);
const vehIds = vehs.map(v => v.id);

let day = [], from = 0;
for (;;) {
  const { data, error } = await supabase.from('vehicle_images')
    .select('id, vehicle_id, source, vision_gate_status, image_url, caption, taken_at')
    .in('vehicle_id', vehIds)
    .gte('taken_at', `${DATE}T00:00:00+00:00`)
    .lt('taken_at', `${DATE}T23:59:59.999+00:00`)
    .not('is_superseded', 'is', true)
    .order('taken_at', { ascending: true })
    .range(from, from + 499);
  if (error) { console.error(error.message); process.exit(3); }
  day.push(...data);
  if (data.length < 500) break;
  from += 500;
}

const touched = new Set(day.map(p => p.vehicle_id));
let activeIds = [];
try { activeIds = JSON.parse((await import('fs')).readFileSync('/tmp/active-builds.json','utf8')).map(b => b.vehicle_id); } catch {}
const poolIds = new Set([...activeIds, ...touched]);
const pool = vehs.filter(v => poolIds.has(v.id));
const candidates = pool.map(v => ({
  vehicle_id: v.id,
  label: `${v?.year ?? '?'} ${v?.make ?? ''} ${v?.model ?? ''}`.trim(),
  vin: v?.vin || null,
  reference_image: existsSync(`/tmp/refs/${v.id}.jpg`) ? `/tmp/refs/${v.id}.jpg` : null,
  touched_today: touched.has(v.id),
  primary_image_url: v.primary_image_url || null,
}));

let i = 0;
const photos = day.map(p => ({
  file: `p${String(i++).padStart(3,'0')}.jpg`,
  id: p.id, current_vehicle_id: p.vehicle_id, source: p.source,
  vision_gate_status: p.vision_gate_status, caption: p.caption,
}));

writeFileSync(join(OUT,'manifest.json'), JSON.stringify({ date: DATE, user_id: USER_ID, photo_count: day.length, candidates, photos }, null, 2));
console.log(`manifest: ${day.length} photos, ${candidates.length} candidates`);
