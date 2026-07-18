/**
 * LIVING-STATE REPORT — a derived rollup over already-extracted image atoms.
 *
 * Image-as-island → images-as-groups. This reads the saturated verdicts (no new vision,
 * no new tables) and answers: what shoots exist and how good are they, what is the vehicle's
 * CURRENT state (with a decay clock), and what GAPS remain (defects to fix, systems gone stale,
 * coverage holes). It is the "living report that decays" — recomputes free off the atoms.
 *
 * Decay principle: STATE facts (paint_state, completeness, a defect) age and can be superseded;
 * HISTORY facts (a component was present, a weld happened) accumulate and don't decay. Defects
 * and coverage are read from the NEWEST shoots — an old defect may already be fixed.
 *
 * Usage: dotenvx run -- node scripts/daily-receipt/living-state-report.mjs --vehicle-id <uuid> [--json out.json]
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing SUPABASE env'); process.exit(1); }
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const VEHICLE_ID = arg('--vehicle-id');
if (!VEHICLE_ID) { console.error('--vehicle-id required'); process.exit(1); }

const DAY = 86400e3;
const SHOOT_GAP_MS = 3 * 3600e3;        // >3h between frames ⇒ a new shoot
const STALE_MONTHS = 6;                  // a system unseen this long ⇒ state knowledge decayed
const now = Date.now();
const ageDays = (ts) => Math.round((now - new Date(ts).getTime()) / DAY);
const fmt = (ts) => new Date(ts).toISOString().slice(0, 10);
const EXPECTED_SCENES = ['engine_bay', 'body_exterior', 'body_interior', 'undercarriage', 'wheel_assembly', 'paint_booth'];

// ── pull vehicle + analyzed verdicts (paginated past the 1000-row cap)
const { data: v } = await sb.from('vehicles').select('year, make, model, trim, color').eq('id', VEHICLE_ID).maybeSingle();
const name = v ? `${v.year} ${v.make} ${v.model}${v.trim ? ' ' + v.trim : ''}` : VEHICLE_ID;

const rows = [];
for (let off = 0; ; off += 1000) {
  const { data, error } = await sb.from('vehicle_images')
    .select('id, taken_at, created_at, ai_scan_metadata')
    .eq('vehicle_id', VEHICLE_ID)
    .not('ai_scan_metadata->byok_deep_analysis', 'is', null)
    .range(off, off + 999);
  if (error) { console.error(error.message); process.exit(1); }
  if (!data?.length) break;
  rows.push(...data);
  if (data.length < 1000) break;
}

// ── normalize into fact-carrying frames, sorted by capture time
const frames = rows.map((r) => {
  const d = r.ai_scan_metadata?.byok_deep_analysis || {};
  return {
    id: r.id,
    ts: new Date(r.taken_at || r.created_at || d.analyzed_at || 0).getTime(),
    scene: d.scene_type || 'unknown',
    phase: d.build_phase_guess || null,
    state: d.state_observations || {},
    defects: Array.isArray(d.damage_localized) ? d.damage_localized : [],
    saturated: d.saturation?.saturated === true,
  };
}).filter((f) => f.ts > 0).sort((a, b) => a.ts - b.ts);

if (!frames.length) { console.error('no analyzed frames'); process.exit(1); }

// ── 1. sessionize into shoots, grade each
const shoots = [];
let cur = null;
for (const f of frames) {
  if (!cur || f.ts - cur.end > SHOOT_GAP_MS) {
    cur = { start: f.ts, end: f.ts, frames: [], scenes: new Set(), defects: [] };
    shoots.push(cur);
  }
  cur.end = f.ts;
  cur.frames.push(f);
  cur.scenes.add(f.scene);
  for (const dm of f.defects) cur.defects.push({ ...dm, date: fmt(f.ts), image_id: f.id });
}
const grade = (s) => (s.frames.length >= 15 && s.scenes.size >= 3) ? 'A·thorough'
  : (s.frames.length >= 5) ? 'B·session' : 'C·snapshot';

// ── 2/3. currency + current state (latest non-empty state facts)
const latestState = {};
for (const f of frames) for (const k of ['completeness', 'paint_state', 'rust_severity']) {
  const val = f.state?.[k];
  if (val && val !== 'unknown') latestState[k] = { value: val, date: fmt(f.ts) };
}
const newest = frames[frames.length - 1].ts;
const oldest = frames[0].ts;

// ── per-system currency (decay): last time each scene/system was documented
const lastSeen = {};
for (const f of frames) lastSeen[f.scene] = Math.max(lastSeen[f.scene] || 0, f.ts);
const staleSystems = Object.entries(lastSeen)
  .filter(([, ts]) => (now - ts) > STALE_MONTHS * 30 * DAY)
  .map(([scene, ts]) => ({ scene, last: fmt(ts), months: Math.round((now - ts) / (30 * DAY)) }))
  .sort((a, b) => b.months - a.months);
const coverageGaps = EXPECTED_SCENES.filter((s) => !lastSeen[s]);

// ── 4. defects from the NEWEST shoots (current issues; old defects may be fixed → decayed)
const recentShoots = shoots.slice(-3);
const currentDefects = recentShoots.flatMap((s) => s.defects)
  .sort((a, b) => (a.severity === 'perforation' ? -1 : 1) - (b.severity === 'perforation' ? -1 : 1));

// ── render
const L = [];
L.push(`\n━━━ LIVING-STATE REPORT · ${name} · as of ${fmt(now)} ━━━`);
L.push(`\nCURRENCY  newest data ${fmt(newest)} (${ageDays(newest)}d ago) · span ${fmt(oldest)}→${fmt(newest)} · ${shoots.length} shoots · ${frames.length} analyzed frames`);

L.push(`\nCURRENT STATE (latest observed):`);
for (const [k, o] of Object.entries(latestState)) L.push(`  · ${k.padEnd(13)} ${o.value}   (as of ${o.date}, ${ageDays(new Date(o.date).getTime())}d)`);

L.push(`\nRECENT SHOOTS (newest 6):`);
for (const s of shoots.slice(-6).reverse()) {
  const scenes = [...s.scenes].filter((x) => x !== 'unknown').slice(0, 5).join(', ');
  L.push(`  · ${fmt(s.end)} · ${String(s.frames.length).padStart(3)} frames · ${grade(s)} · ${scenes}`);
}

L.push(`\n▓▓ GAP LIST (ranked) ▓▓`);
L.push(`\n  DEFECTS — current issues from the newest shoots (the paint-bubble class):`);
if (currentDefects.length) for (const d of currentDefects.slice(0, 12))
  L.push(`    ⚠ ${d.label || 'defect'}${d.severity ? ` [${d.severity}]` : ''} — seen ${d.date}`);
else L.push(`    (none logged in the last ${recentShoots.length} shoots)`);

L.push(`\n  STALE SYSTEMS — state knowledge decayed (>${STALE_MONTHS}mo since last documented):`);
if (staleSystems.length) for (const s of staleSystems) L.push(`    ○ ${s.scene} — last seen ${s.last} (${s.months}mo ago) → re-document to confirm current state`);
else L.push(`    (all systems documented recently)`);

L.push(`\n  COVERAGE GAPS — expected systems never captured:`);
L.push(coverageGaps.length ? `    ● ${coverageGaps.join(', ')}` : `    (all expected systems covered)`);

L.push(`\n  MISSING PARTS — expected-but-absent (e.g. the antenna):`);
L.push(`    ⧗ not computable yet — needs the expected-complete-state reference (build spec / roster).`);
L.push(`      This report proves the DEFECT + STALENESS gaps from atoms; the MISSING-PART gap is what`);
L.push(`      the reciprocal spec layer must add (expected − observed). That's the next brick.`);
L.push('');

const report = L.join('\n');
console.log(report);

const jsonOut = arg('--json');
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({
    vehicle: name, as_of: fmt(now), currency: { newest: fmt(newest), oldest: fmt(oldest), shoots: shoots.length, frames: frames.length },
    current_state: latestState,
    shoots: shoots.map((s) => ({ date: fmt(s.end), frames: s.frames.length, grade: grade(s), scenes: [...s.scenes] })),
    gaps: { defects: currentDefects, stale_systems: staleSystems, coverage_gaps: coverageGaps },
  }, null, 2));
  console.log(`(json → ${jsonOut})`);
}
