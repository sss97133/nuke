#!/usr/bin/env node
// Download the day's photo thumbnails with a per-fetch timeout (read-only).
import { createClient } from '@supabase/supabase-js';
import { createWriteStream, existsSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const args = process.argv.slice(2);
const DATE = args[args.indexOf('--date') + 1];
const ANCHOR = 'a90c008a-3379-41d8-9eb2-b4eda365d74c';
const OUT = `/tmp/day/${DATE}`;
const WIDTH = 512;

const thumb = (u) => u?.includes('/object/public/')
  ? u.replace('/object/public/', '/render/image/public/') + `?width=${WIDTH}&resize=contain` : u;

async function dl(url, dest) {
  if (existsSync(dest)) return 'cached';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return `http_${r.status}`;
    await pipeline(r.body, createWriteStream(dest));
    return 'ok';
  } catch (e) { return `err_${e.name}`; }
}

const { data: anchorVeh } = await supabase.from('vehicles').select('user_id').eq('id', ANCHOR).single();
const { data: vehs } = await supabase.from('vehicles').select('id').eq('user_id', anchorVeh.user_id);
const vehIds = vehs.map(v => v.id);
let day = [], from = 0;
for (;;) {
  const { data } = await supabase.from('vehicle_images')
    .select('id, image_url, taken_at')
    .in('vehicle_id', vehIds)
    .gte('taken_at', `${DATE}T00:00:00+00:00`)
    .lt('taken_at', `${DATE}T23:59:59.999+00:00`)
    .not('is_superseded', 'is', true)
    .order('taken_at', { ascending: true })
    .range(from, from + 499);
  day.push(...data);
  if (data.length < 500) break;
  from += 500;
}
let i = 0;
for (const p of day) {
  const fn = `p${String(i++).padStart(3,'0')}.jpg`;
  const status = await dl(thumb(p.image_url), join(OUT, fn));
  console.log(`${fn} ${status} ${p.image_url.slice(0,70)}`);
}
