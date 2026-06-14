#!/usr/bin/env node
/**
 * build-day.mjs — per-day rollup step of the daily-receipt loop.
 *
 * For one (vehicle_id, date), computes or updates a `work_sessions` row from
 * the day's vehicle_images, then calls get_daily_work_receipt RPC and prints
 * the human-readable billable receipt.
 *
 * Idempotent — re-running for a day refreshes the work_session stats.
 *
 * Usage:
 *   dotenvx run -- node scripts/daily-receipt/build-day.mjs \
 *     --vehicle-id eeb9fa61-01e8-49a6-8eab-a7cc0e23d30f \
 *     --date 2026-04-14 \
 *     --title "Pickup + initial teardown and inspection" \
 *     --labor-rate 85
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, KEY);

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : null; };

const VEHICLE_ID = arg('--vehicle-id');
const DATE = arg('--date');
const TITLE = arg('--title') || 'Shop work';
const LABOR_RATE = parseFloat(arg('--labor-rate') || '85');
const WORK_TYPE = arg('--work-type') || 'general';
// Multi-factor equation knobs (defaults = identity, set explicitly to enrich the value statement)
const TIER_MULT = parseFloat(arg('--tier') || '1.0');           // 0.7 apprentice / 1.0 journeyman / 1.4 master
const QUALITY_MULT = parseFloat(arg('--quality') || '1.0');     // 0.7 driver / 1.0 resto / 2.5 concours
const SPEED_MULT = parseFloat(arg('--speed') || '1.0');         // book_hrs / actual_hrs (capped 0.5..2.0)
const PARTS_COST = parseFloat(arg('--parts-cost') || '0');      // sum of receipts attributed to day
const PARTS_MARKUP = parseFloat(arg('--parts-markup') || '0.30'); // shop markup %, default 30
const ENABLEMENT = parseFloat(arg('--enablement') || '0');      // post_market_value - pre_market_value (day's unlock)
const RISK_CARRY = parseFloat(arg('--risk') || '0');            // documented future obligations weight
const OPPORTUNITY = parseFloat(arg('--opportunity') || '0');    // subtract: same-day work on other vehicles
const SHOP_NAME = arg('--shop') || 'Boulder City shop (707 Yucca St)';

if (!VEHICLE_ID || !DATE) {
  console.error('Required: --vehicle-id --date');
  process.exit(1);
}

// 1. Get this date's vehicle_images for the vehicle
const { data: rawPhotos, error: pErr } = await supabase
  .from('vehicle_images')
  .select('id, taken_at, area, part, operation, image_type, caption, vision_gate_status, source, ai_scan_metadata')
  .eq('vehicle_id', VEHICLE_ID)
  .gte('taken_at', `${DATE}T00:00:00+00:00`)
  .lt('taken_at', `${DATE}T23:59:59.999+00:00`)
  .not('is_superseded', 'is', true)
  .order('taken_at', { ascending: true });
if (pErr) { console.error('photos query:', pErr.message); process.exit(2); }

// PUBLISH GATE (added 2026-05-30 after the private-text/family-photo incident):
// work_description is public. Build it ONLY from vetted, approved photos that
// still live on THIS vehicle — never superseded/reattributed rows, never
// rejected/personal content, never leaked iMessage NSArchiver junk.
const IMSG_ARTIFACT = /__kIM|kIMFileTransfer|NSKeyedArchiver|attributedBody/;
const photos = (rawPhotos || []).filter(p =>
  p.vision_gate_status === 'approved' &&
  p.source !== 'imessage' &&
  !(p.caption && IMSG_ARTIFACT.test(p.caption))
);
if (!photos || photos.length === 0) {
  console.log(`No photos for ${VEHICLE_ID} on ${DATE} — work_session not created.`);
  process.exit(0);
}

// 2. Compute time bounds (the whole day's photo span — used for the session window)
const times = photos.map(p => new Date(p.taken_at).getTime()).sort((a, b) => a - b);
const startTime = new Date(times[0]).toISOString();
const endTime = new Date(times[times.length - 1]).toISOString();
const spanMinutes = Math.round((times[times.length - 1] - times[0]) / 60000);

// 2.0 INTENT GATE — the $410 guard, enforced at rollup (added 2026-06-14).
// Labor value accrues ONLY from frames whose BYOK deep-analysis intent is `labor`
// at confidence >= 0.6. A day of acquisition/documentation/inspection/parts_sourcing
// /communication screenshots is NOT shop labor and must roll up to $0 labor, no matter
// how long the photo timespan is. Before this gate, 12 KSL-listing screenshots
// (intent=acquisition) billed $221 of phantom labor — exactly the false-positive the
// per-image intent guard exists to prevent. Legacy frames with NO byok verdict yet keep
// the old timespan behavior (we don't zero out an un-analyzed day).
const INTENT_LABOR_THRESHOLD = 0.6;
const byok = (p) => (p.ai_scan_metadata && p.ai_scan_metadata.byok_deep_analysis) || null;
const isLaborFrame = (p) => {
  const b = byok(p);
  if (!b) return null; // unknown — not yet analyzed
  const conf = typeof b.intent_confidence === 'number' ? b.intent_confidence : 0;
  return b.intent === 'labor' && conf >= INTENT_LABOR_THRESHOLD;
};
const analyzed = photos.filter(p => byok(p));
const laborFrames = photos.filter(p => isLaborFrame(p) === true);
const unanalyzed = photos.filter(p => byok(p) === null);
// Intent mix (for the value statement + session typing)
const intentCounts = {};
for (const p of analyzed) {
  const it = (byok(p).intent || 'unknown');
  intentCounts[it] = (intentCounts[it] || 0) + 1;
}
// The day is "labor" if any labor-intent frame exists, OR it's entirely legacy/unanalyzed.
const dayHasLabor = laborFrames.length > 0 || (analyzed.length === 0);
// Labor window: span of the labor-intent frames (fallback to full span for legacy days).
let laborMinutes;
if (laborFrames.length > 0) {
  const lt = laborFrames.map(p => new Date(p.taken_at).getTime()).sort((a, b) => a - b);
  const laborSpan = Math.round((lt[lt.length - 1] - lt[0]) / 60000);
  laborMinutes = Math.max(30, Math.round(laborSpan * 0.7)); // 70% idle discount
} else if (analyzed.length === 0) {
  laborMinutes = Math.max(30, Math.round(spanMinutes * 0.7)); // legacy: no verdicts yet
} else {
  laborMinutes = 0; // analyzed, but zero labor-intent frames → no shop labor today
}

// 2a. Compute specialty mix from per-photo `operation` field
const opCounts = {};
for (const p of photos) {
  const op = (p.operation || 'general').toLowerCase();
  opCounts[op] = (opCounts[op] || 0) + 1;
}
const SPECIALTY_MULTIPLIERS = {
  wiring_install_or_trace: 1.30, harness_fabrication: 1.40, interior_wiring_session: 1.25,
  steering_column_cable_inspection: 1.10, exhaust_install: 1.20,
  underbody_prep: 1.15, masking_for_paint: 1.10, sound_deadener_install: 1.05, sound_deadener_install_continued: 1.05,
  wheel_removal_inspection: 1.00, gauge_cluster_removal: 1.10, wiring_inspection: 1.10,
  hood_removed_engine_access: 1.10, hood_up_engine_inspection: 1.05, underbody_engine_inspection: 1.10,
  parts_layout_review: 0.90, part_documentation: 0.85, delivery_transaction: 0.50,
  inspection_on_lift: 1.00, received_at_shop: 0.80, general: 1.00,
};
const totalPhotos = photos.length || 1;
let specialty_mult = 0;
for (const [op, n] of Object.entries(opCounts)) {
  specialty_mult += (SPECIALTY_MULTIPLIERS[op] ?? 1.0) * (n / totalPhotos);
}

// 2b. Multi-factor labor value (zero when the intent gate found no labor-intent frames)
const labor_base = (laborMinutes / 60) * LABOR_RATE;
const labor_value = labor_base * TIER_MULT * QUALITY_MULT * SPEED_MULT * specialty_mult;
// Session type reflects the day's real character: a non-labor day is typed by its
// dominant intent (acquisition / documentation / inspection / parts_sourcing) so the
// ledger reads honestly instead of "Shop work, $221".
const dominantIntent = Object.entries(intentCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
const computedTitle = (!dayHasLabor && dominantIntent)
  ? ({ acquisition: 'Acquisition research / listing capture',
       documentation: 'Documentation / photo records',
       inspection: 'Inspection (no billable labor)',
       parts_sourcing: 'Parts sourcing / research',
       communication: 'Communication / coordination' }[dominantIntent] || 'Non-labor documentation')
  : TITLE;
const computedWorkType = (!dayHasLabor && dominantIntent) ? dominantIntent : WORK_TYPE;
const parts_value = PARTS_COST * (1 + PARTS_MARKUP);
const day_value = labor_value + parts_value + ENABLEMENT + RISK_CARRY - OPPORTUNITY;
// `total_job_cost` in DB stores the cost-side (labor + parts), not the unlock-value
const laborCost = Math.round(labor_value * 100) / 100;

// 3. Build the day's work_description — each frame's best narrative, in order.
// Prefer the legacy/human caption; fall back to the BYOK deep-analysis
// narrative_one_line (the detective's per-frame read), then agent_notes, so
// EVERY analyzed day tells its story — not just the ~20% that happen to carry a
// caption. (Pre-fix: built from `caption` only, which the current BYOK pass does
// not write — it lands the narrative in ai_scan_metadata.byok_deep_analysis — so
// freshly-analyzed days rolled up with an empty work_description.) The photos are
// already publish-gated above (approved, non-imessage, non-artifact); the byok
// narrative describes the approved on-vehicle frame, safe to publish.
const frameNarrative = (p) => {
  if (p.caption && !IMSG_ARTIFACT.test(p.caption)) return p.caption;
  const b = byok(p);
  const n = b && (b.narrative_one_line || b.agent_notes);
  return (n && typeof n === 'string' && !IMSG_ARTIFACT.test(n)) ? n : null;
};
const summary = photos
  .map(p => { const n = frameNarrative(p); return n ? `${p.taken_at.slice(11, 16)} ${n}` : null; })
  .filter(Boolean)
  .join(' | ')
  .slice(0, 1000);

// 4. Upsert work_session row
const sessionRow = {
  vehicle_id: VEHICLE_ID,
  user_id: '0b9f107a-d124-49de-9ded-94698f63c1c4',
  session_date: DATE,
  title: (TITLE === 'Shop work') ? computedTitle : TITLE,
  start_time: startTime,
  end_time: endTime,
  duration_minutes: laborMinutes,
  work_type: (WORK_TYPE === 'general') ? computedWorkType : WORK_TYPE,
  work_description: summary,
  status: 'completed',
  total_parts_cost: Number(parts_value.toFixed(2)),
  total_labor_cost: Number(laborCost.toFixed(2)),
  total_job_cost: Number((laborCost + parts_value).toFixed(2)),
  image_count: photos.length,
};

// Check if exists
const { data: existing } = await supabase
  .from('work_sessions')
  .select('id')
  .eq('vehicle_id', VEHICLE_ID)
  .eq('session_date', DATE)
  .limit(1);

let sessionId;
if (existing && existing.length > 0) {
  sessionId = existing[0].id;
  const upd = await supabase.from('work_sessions').update(sessionRow).eq('id', sessionId);
  if (upd.error) { console.error('update:', upd.error.message); process.exit(3); }
  console.log(`[update] work_session ${sessionId} for ${DATE}`);
} else {
  const ins = await supabase.from('work_sessions').insert(sessionRow).select('id').single();
  if (ins.error) { console.error('insert:', ins.error.message); process.exit(3); }
  sessionId = ins.data.id;
  console.log(`[insert] work_session ${sessionId} for ${DATE}`);
}

// 5. Call get_daily_work_receipt to verify the receipt now materializes
const rpcResp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_daily_work_receipt`, {
  method: 'POST',
  headers: {
    'apikey': KEY, 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json',
  },
  body: JSON.stringify({ p_vehicle_id: VEHICLE_ID, p_date: DATE }),
});
const receipt = await rpcResp.json();

console.log('\n─── DAILY VALUE STATEMENT ────────────────────────────────');
console.log(`Date:           ${DATE}`);
console.log(`Vehicle:        ${receipt.vehicle?.year} ${receipt.vehicle?.make} ${receipt.vehicle?.model}`);
console.log(`Shop:           ${SHOP_NAME}`);
console.log(`Session:        ${TITLE}`);
console.log(`Time:           ${startTime.slice(11,16)} → ${endTime.slice(11,16)} UTC (${spanMinutes} min span)`);
console.log('─── INTENT GATE ($410 guard) ─────────────────────────────');
console.log(`  frames:       ${photos.length} total · ${analyzed.length} analyzed · ${laborFrames.length} labor-intent · ${unanalyzed.length} not-yet-analyzed`);
console.log(`  intent mix:   ${Object.entries(intentCounts).map(([k,v]) => `${k}:${v}`).join(', ') || '(none analyzed)'}`);
console.log(`  verdict:      ${dayHasLabor ? (laborFrames.length ? 'LABOR DAY — billing labor-intent frames only' : 'LEGACY DAY — not yet analyzed, full-span estimate') : `NON-LABOR DAY (${dominantIntent}) — $0 labor`}`);
console.log('─── LABOR ────────────────────────────────────────────────');
console.log(`  base:         ${laborMinutes} min × $${LABOR_RATE.toFixed(2)}/hr      = $${labor_base.toFixed(2)}`);
console.log(`  × tier:       ${TIER_MULT.toFixed(2)}    (apprentice 0.7 / journey 1.0 / master 1.4)`);
console.log(`  × quality:    ${QUALITY_MULT.toFixed(2)}    (driver 0.7 / resto 1.0 / concours 2.5)`);
console.log(`  × speed:      ${SPEED_MULT.toFixed(2)}    (book hrs / actual hrs)`);
console.log(`  × specialty:  ${specialty_mult.toFixed(3)}  (weighted from photo operations: ${Object.entries(opCounts).map(([k,v]) => `${k}:${v}`).join(', ')})`);
console.log(`  ─────────────────────────────────────────────`);
console.log(`  labor value:                              = $${labor_value.toFixed(2)}`);
console.log('─── PARTS ────────────────────────────────────────────────');
console.log(`  receipts:     $${PARTS_COST.toFixed(2)}  × (1 + markup ${(PARTS_MARKUP*100).toFixed(0)}%)  = $${parts_value.toFixed(2)}`);
console.log('─── VALUE ADJUSTMENTS ────────────────────────────────────');
console.log(`  enablement unlock (market post − pre):    + $${ENABLEMENT.toFixed(2)}`);
console.log(`  risk carry (documented future obligs):    + $${RISK_CARRY.toFixed(2)}`);
console.log(`  opportunity cost (other vehicles today):  − $${OPPORTUNITY.toFixed(2)}`);
console.log('─────────────────────────────────────────────────────────');
console.log(`DAY'S VALUE:                                  $${day_value.toFixed(2)}`);
console.log(`  (cost-side total stored in DB: $${(laborCost + parts_value).toFixed(2)})`);
console.log(`Photos: ${photos.length}    Activity: ${receipt.summary?.activity_level || 'unknown'}`);
console.log('─────────────────────────────────────────────────────────');
console.log('Photo timeline:');
for (const p of photos.slice(0, 20)) {
  const t = p.taken_at.slice(11, 16);
  console.log(`  ${t}  [${p.image_type || '?'}] ${(p.caption || '').slice(0, 100)}`);
}
if (photos.length > 20) console.log(`  ... + ${photos.length - 20} more`);
console.log('─────────────────────────────────────────────────────────');
console.log(`work_session_id: ${sessionId}`);
