#!/usr/bin/env node
/**
 * pull-day.mjs — chronological timeline day-walker, PULL step (read-only).
 *
 * Gathers ALL of a user's photos for one calendar date across EVERY vehicle
 * they're currently (mis)attributed to — the day is the context unit, not the
 * vehicle. Downloads contain-resized thumbnails + one trusted reference shot
 * per candidate vehicle, and writes a manifest the (human/agent) vision engine
 * reads to decide per-photo attribution. Emits nothing to the DB.
 *
 * Usage:
 *   dotenvx run -- node scripts/timeline/pull-day.mjs --date 2016-04-23 \
 *     [--user-id <uuid>] [--anchor-vehicle a90c008a-...] [--width 512]
 *
 * Output: /tmp/day/<date>/  (thumbnails + reference/<vehicle>.jpg + manifest.json)
 */
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync, createWriteStream, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, KEY);

const args = process.argv.slice(2);
const arg = (n, d = null) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : d; };
const DATE = arg('--date');
const ANCHOR = arg('--anchor-vehicle', 'a90c008a-3379-41d8-9eb2-b4eda365d74c');
let USER_ID = arg('--user-id');
const WIDTH = arg('--width', '512');
if (!DATE) { console.error('--date YYYY-MM-DD required'); process.exit(1); }

const OUT = `/tmp/day/${DATE}`;
mkdirSync(join(OUT, 'reference'), { recursive: true });

// contain-resized render URL (never crop portrait iPhone shots — see memory)
const thumb = (publicUrl) =>
  publicUrl?.includes('/object/public/')
    ? publicUrl.replace('/object/public/', '/render/image/public/') + `?width=${WIDTH}&resize=contain`
    : publicUrl;

async function dl(url, dest) {
  try {
    const r = await fetch(url);
    if (!r.ok) return false;
    await pipeline(r.body, createWriteStream(dest));
    return true;
  } catch { return false; }
}

// 1. Resolve user
if (!USER_ID) {
  const { data } = await supabase.from('vehicles').select('user_id').eq('id', ANCHOR).single();
  USER_ID = data?.user_id;
}
if (!USER_ID) { console.error('could not resolve user_id'); process.exit(2); }

// 2. The user's vehicle ids (candidate homes)
const { data: vehs } = await supabase
  .from('vehicles')
  .select('id, year, make, model, vin, primary_image_url, image_count')
  .eq('user_id', USER_ID);
const vehIds = vehs.map(v => v.id);

// 3. The day's photos across ALL those vehicles (paginated; live rows only)
let day = [], from = 0;
for (;;) {
  const { data, error } = await supabase
    .from('vehicle_images')
    .select('id, vehicle_id, source, vision_gate_status, image_url, caption, taken_at')
    .in('vehicle_id', vehIds)
    .gte('taken_at', `${DATE}T00:00:00+00:00`)
    .lt('taken_at', `${DATE}T23:59:59.999+00:00`)
    .not('is_superseded', 'is', true)
    .order('taken_at', { ascending: true })
    .range(from, from + 499);
  if (error) { console.error('photos query:', error.message); process.exit(3); }
  day.push(...data);
  if (data.length < 500) break;
  from += 500;
}
if (day.length === 0) { console.log(`No photos on ${DATE}.`); process.exit(0); }

// 4. Candidates = the operator's ACTIVE BUILDS (cached /tmp/active-builds.json,
//    top vehicles by image density) UNION the vehicles touched today. This keeps
//    the candidate set tractable (~50) and relevant for rehoming, instead of the
//    full 210-entity roster (most of which are scraped listings, not builds).
//    References cached globally in /tmp/refs and reused across days.
const REFCACHE = '/tmp/refs';
mkdirSync(REFCACHE, { recursive: true });
const touched = new Set(day.map(p => p.vehicle_id));
// Cap active-build candidates to the top ~12 (by image density) so agents read a
// small reference set — 50 refs/agent blew context on dense days (the overnight
// failure mode). touched-today vehicles are always included.
let activeIds = [];
try { activeIds = JSON.parse(readFileSync('/tmp/active-builds.json','utf8')).slice(0, 12).map(b => b.vehicle_id); } catch {}
const poolIds = new Set([...activeIds, ...touched]);
const pool = vehs.filter(v => poolIds.has(v.id));
const candidates = [];
for (const v of pool) {
  const cached = join(REFCACHE, `${v.id}.jpg`);
  if (!existsSync(cached)) {
    let ref = null;
    const { data: anchorImg } = await supabase
      .from('vehicle_images')
      .select('image_url')
      .eq('vehicle_id', v.id)
      .eq('source', 'bat_import_mirrored')
      .not('is_superseded', 'is', true)
      .limit(1).maybeSingle();
    ref = anchorImg?.image_url || v.primary_image_url;
    if (ref) await dl(thumb(ref), cached);
  }
  candidates.push({
    vehicle_id: v.id,
    label: `${v?.year ?? '?'} ${v?.make ?? ''} ${v?.model ?? ''}`.trim(),
    vin: v?.vin || null,
    reference_image: existsSync(cached) ? `/tmp/refs/${v.id}.jpg` : null,
    touched_today: touched.has(v.id),
  });
}

// 5. Download the day's photo thumbnails
let i = 0, ok = 0;
const photos = [];
for (const p of day) {
  const fn = `p${String(i).padStart(3, '0')}.jpg`;
  const got = await dl(thumb(p.image_url), join(OUT, fn));
  if (got) ok++;
  photos.push({
    file: fn,
    id: p.id,
    current_vehicle_id: p.vehicle_id,
    source: p.source,
    vision_gate_status: p.vision_gate_status,
    caption: p.caption,
  });
  i++;
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({
  date: DATE, user_id: USER_ID, photo_count: day.length, downloaded: ok,
  candidates, photos,
}, null, 2));

console.log(`${DATE}: ${day.length} photos (${ok} downloaded) across ${touched.length} vehicle(s) → ${OUT}`);
console.log(`candidates: ${candidates.map(c => `${c.label} [${c.vehicle_id.slice(0, 8)}]`).join(' | ')}`);
