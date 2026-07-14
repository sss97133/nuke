/**
 * Capture-session detection (step 4: "shot a lot, consistently → likely same subject").
 *
 * Derives photo BURSTS from the cheap free signals alone — taken_at gaps + GPS
 * jumps — with zero inference. A burst (many frames, tight time, one location) is
 * the programmatic expression of a focused shoot, which is overwhelmingly a single
 * subject (validated 2026-06-21: 72% of 5+-shot bursts map to ≤1 vehicle).
 *
 * READ-ONLY. Outputs:
 *   - session summary (count, span, GPS cluster, dominant Apple-ML subject, vehicles)
 *   - attribution candidates: single-subject bursts holding UNASSIGNED frames whose
 *     vehicle can be propagated from their burst-mates (addresses the ~38% of images
 *     with no vehicle_id). It only REPORTS these — assignment stays suggest-only per
 *     the repo's misattribution scar tissue ("102 frames on one truck", resolveVehicle).
 *   - review list: multi-vehicle bursts (likely pollution / genuinely multi-subject).
 *
 * Depends on taken_at being trustworthy — see the exifOf fix in
 * scripts/deep-image-analysis-byok.mjs (taken_at is authoritative, not exif_data).
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/capture-sessions.mjs \
 *     --user-id <uuid> [--gap-min 90] [--gps-jump 0.02] [--min-shots 5]
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const USER_ID = arg('--user-id');
const GAP_MS = parseInt(arg('--gap-min', '90')) * 60 * 1000;
const GPS_JUMP = parseFloat(arg('--gps-jump', '0.02'));
const MIN_SHOTS = parseInt(arg('--min-shots', '5'));
if (!USER_ID) { console.error('--user-id <uuid> required'); process.exit(1); }

// Pull all of the user's dated frames (paginated past the 1000-row cap), ordered by capture time.
async function loadFrames() {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('vehicle_images')
      .select('id, vehicle_id, taken_at, latitude, longitude, apple_ml_labels')
      .eq('user_id', USER_ID)
      .not('taken_at', 'is', null)
      .order('taken_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) { console.error('load:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

function sessionize(frames) {
  const sessions = [];
  let cur = null;
  for (const f of frames) {
    const t = new Date(f.taken_at).getTime();
    const gpsJump = cur && cur.lastLat != null && f.latitude != null &&
      (Math.abs(f.latitude - cur.lastLat) > GPS_JUMP || Math.abs(f.longitude - cur.lastLon) > GPS_JUMP);
    if (!cur || (t - cur.lastT) > GAP_MS || gpsJump) {
      cur = { frames: [], unassignedIds: [], lastT: t, lastLat: f.latitude, lastLon: f.longitude,
              vehicles: new Set(), unassigned: 0, labels: new Map(), startT: t };
      sessions.push(cur);
    }
    cur.frames.push(f.id);
    cur.lastT = t;
    if (f.latitude != null) { cur.lastLat = f.latitude; cur.lastLon = f.longitude; }
    if (f.vehicle_id) cur.vehicles.add(f.vehicle_id); else { cur.unassigned++; cur.unassignedIds.push(f.id); }
    for (const l of (f.apple_ml_labels || [])) cur.labels.set(l, (cur.labels.get(l) || 0) + 1);
  }
  return sessions;
}

const frames = await loadFrames();
const sessions = sessionize(frames).filter((s) => s.frames.length >= MIN_SHOTS);

const attribution = sessions.filter((s) => s.vehicles.size === 1 && s.unassigned > 0);
const orphanBursts = sessions.filter((s) => s.vehicles.size === 0 && s.unassigned > 0);
const review = sessions.filter((s) => s.vehicles.size > 1);

const topLabel = (s) => [...s.labels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
const spanMin = (s) => Math.round((s.lastT - s.startT) / 60000);

console.log(`frames=${frames.length}  sessions(>=${MIN_SHOTS})=${sessions.length}`);
console.log(`single-subject bursts with unassigned frames (propagatable): ${attribution.length} ` +
  `(${attribution.reduce((n, s) => n + s.unassigned, 0)} frames)`);
console.log(`orphan bursts (0 vehicles, all unassigned): ${orphanBursts.length} ` +
  `(${orphanBursts.reduce((n, s) => n + s.unassigned, 0)} frames)`);
console.log(`multi-vehicle bursts to review (likely pollution): ${review.length}`);
console.log('\ntop bursts:');
for (const s of [...sessions].sort((a, b) => b.frames.length - a.frames.length).slice(0, 15)) {
  console.log(`  ${new Date(s.startT).toISOString().slice(0,10)}  shots=${s.frames.length}  span=${spanMin(s)}m  ` +
    `vehicles=${s.vehicles.size}  unassigned=${s.unassigned}  subject=${topLabel(s)}`);
}

// --apply: propagate the burst's vehicle to its unassigned frames as a SUGGESTION
// (never a hard assignment — suggest-only per the misattribution scar tissue). Only
// single-subject bursts; only frames with no existing suggestion. Batched + paced
// because each update fires the per-row valuation-recompute trigger.
if (args.includes('--apply')) {
  let suggested = 0;
  for (const s of attribution) {
    const veh = [...s.vehicles][0];
    for (let i = 0; i < s.unassignedIds.length; i += 200) {
      const batch = s.unassignedIds.slice(i, i + 200);
      const { error } = await sb.from('vehicle_images')
        .update({ suggested_vehicle_id: veh, image_vehicle_match_status: 'ambiguous' })
        .in('id', batch)
        .is('suggested_vehicle_id', null)
        .is('vehicle_id', null);
      if (error) console.error(`  suggest burst ${new Date(s.startT).toISOString().slice(0,10)}: ${error.message}`);
      else suggested += batch.length;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  console.log(`\napplied: ${suggested} suggested_vehicle_id propagations (suggest-only)`);
}
