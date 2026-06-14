#!/usr/bin/env node
/**
 * classify-unfiled-day.mjs — BYOK day-level ATTRIBUTION.
 *
 * THE GAP it closes: capture-relay photos upload with vehicle_id NULL and nothing
 * files them (the BYOK per-frame analysis reads the WORK, not which build). So new
 * photos surface on no vehicle profile and the lead can't update from them.
 *
 * THE FIX (this file): the DAY is the unit — a day's photos are almost always ONE
 * vehicle's session. One BYOK text pass reasons over the day's already-extracted
 * atoms (ai_scan_metadata.byok_deep_analysis) + the owner's candidate builds and
 * decides which build, with confidence. ATOMS ONLY — no image download, no vision
 * re-call ($0 BYOK, same architecture as synthesize-day.mjs). claude --print makes
 * NO network call (sandbox-safe); the Supabase reads/writes happen in node here.
 *
 * THE RULE (Skylar's, the K10 incident): NEVER guess. Confident (>= threshold) ->
 * file the whole day + recompute the build's lead. 0.5..threshold -> store a
 * suggested_vehicle_id for the owner-confirm flow, do NOT file. < 0.5 -> leave fully
 * unfiled. A wrong guess corrupts the record and is worse than null.
 *
 * Usage:
 *   dotenvx run -- node scripts/daily-receipt/classify-unfiled-day.mjs \
 *     --user-id <uuid> --date YYYY-MM-DD [--model claude-opus-4-8] [--threshold 0.8] [--dry-run]
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : d; };
const has = (n) => args.includes(n);
const USER_ID = arg('--user-id');
const DATE = arg('--date');
const MODEL = arg('--model', 'claude-opus-4-8');
const THRESHOLD = parseFloat(arg('--threshold', '0.8'));
const DRY = has('--dry-run');
if (!USER_ID || !DATE) { console.error('Required: --user-id --date'); process.exit(1); }

const IMSG = /__kIM|kIMFileTransfer|NSKeyedArchiver|attributedBody/;
const byok = (p) => (p.ai_scan_metadata && p.ai_scan_metadata.byok_deep_analysis) || null;

// 1. The day's UNFILED capture photos + atoms.
const { data: rawPhotos, error: pErr } = await supabase
  .from('vehicle_images')
  .select('id, taken_at, caption, ai_scan_metadata')
  .eq('user_id', USER_ID).is('vehicle_id', null)
  .in('source', ['capture_relay_ios', 'capture_relay'])
  .gte('taken_at', `${DATE}T00:00:00+00:00`).lt('taken_at', `${DATE}T23:59:59.999+00:00`)
  .not('is_superseded', 'is', true)
  .order('taken_at', { ascending: true });
if (pErr) { console.error('photos:', pErr.message); process.exit(2); }
const photos = (rawPhotos || []).filter((p) => !(p.caption && IMSG.test(p.caption)));
if (photos.length === 0) { console.log(`No unfiled photos for ${DATE}.`); process.exit(0); }
const analyzed = photos.filter((p) => byok(p));
if (analyzed.length === 0) { console.log(`${DATE}: ${photos.length} photos, none analyzed yet — skip (need atoms).`); process.exit(0); }

const frames = analyzed.map((p) => {
  const b = byok(p);
  return {
    image_id: p.id, hhmm: (p.taken_at || '').slice(11, 16),
    scene_type: b.scene_type ?? null, narrative: b.narrative_one_line ?? null,
    components: Array.isArray(b.components_seen) ? b.components_seen.slice(0, 8).map((c) => c?.label).filter(Boolean) : [],
    text: Array.isArray(b.text_regions) ? b.text_regions.slice(0, 8).map((t) => (typeof t === 'string' ? t : t?.text)).filter(Boolean) : [],
    state: b.state_observations ?? null, presence: b.presence ?? null, agent_notes: b.agent_notes ?? null,
  };
});

// 2. Candidate builds = the owner's DOCUMENTED vehicles (have work_sessions), with
//    distinguishing fields. Near-identical trucks stay ambiguous on purpose.
// Documented builds first (the real candidate set ~30), then their fields — never
// a limit() over his 300+ associated/reference vehicles (that dropped real builds).
const { data: docRows } = await supabase
  .from('work_sessions').select('vehicle_id').eq('user_id', USER_ID).not('vehicle_id', 'is', null);
const docIds = [...new Set((docRows || []).map((r) => r.vehicle_id))];
if (docIds.length === 0) { console.error('No documented builds to match against.'); process.exit(2); }
const { data: builds } = await supabase
  .from('vehicles')
  .select('id, year, make, model, trim, color, vin, engine_type, description')
  .in('id', docIds);
const candidates = (builds || []).map((b) => ({
  build_id: b.id, label: [b.year, b.make, b.model, b.trim].filter(Boolean).join(' '),
  color: b.color || null, vin: b.vin || null, engine: b.engine_type || null,
  note: (b.description || '').slice(0, 140) || null,
}));
if (candidates.length === 0) { console.error('No documented builds to match against.'); process.exit(2); }

// 3. The classification prompt (atoms only).
const prompt = [
  'You attribute a DAY of an owner\'s shop photos to ONE of his vehicle builds, using ONLY the already-extracted per-frame analysis atoms below (you never see pixels). A day\'s photos are almost always ONE vehicle\'s work session, so pick one build for the whole day.',
  '',
  'HARD RULE — NEVER GUESS. Only choose a build if the atoms carry real identifying evidence that points to exactly ONE candidate: a visible whole vehicle whose year/make/model/color matches one build, a readable VIN/plate, or a distinctive feature (a specific engine swap, body style, unique mod) that matches one build and no other. This fleet has near-identical trucks (multiple same-make/model). If two candidates could both fit, or the day is only close-up component/wiring shots with no vehicle identity, output build_id=null with low confidence. A wrong attribution corrupts the record and is far worse than null — the owner will confirm uncertain days himself.',
  '',
  'CANDIDATE BUILDS (the ONLY valid targets — build_id must be one of these or null):',
  '```json', JSON.stringify(candidates), '```',
  '',
  `THIS DAY — ${DATE}, ${frames.length} analyzed frames, time-ordered:`,
  '```json', JSON.stringify(frames), '```',
  '',
  'Output ONLY this JSON object, nothing else:',
  '{"build_id": "<one candidate build_id, or null>", "confidence": 0.0-1.0, "label": "<chosen build label or null>", "evidence": "<the specific atom evidence that identifies it, or why it is uncertain>"}',
].join('\n');

const dir = mkdtempSync(join(tmpdir(), 'classifyday-'));
try { writeFileSync(join(dir, 'prompt.txt'), prompt); } catch { /* best effort */ }
const env = { ...process.env }; delete env.CLAUDE_EFFORT;
const t0 = Date.now();
const res = spawnSync('claude', ['--print', '--model', MODEL, '--permission-mode', 'bypassPermissions'],
  { input: prompt, env, timeout: 240000, maxBuffer: 64 * 1024 * 1024, encoding: 'utf-8' });
const ms = Date.now() - t0;
if (res.error) { console.error(`spawn error: ${res.error.message}`); process.exit(3); }
const out = (res.stdout || '').trim();
let parsed = null;
const fence = out.match(/```(?:json)?\s*([\s\S]*?)```/);
const cand = fence ? fence[1].trim() : out;
try { parsed = JSON.parse(cand); } catch {
  const s = cand.indexOf('{'), e = cand.lastIndexOf('}');
  if (s !== -1 && e > s) { try { parsed = JSON.parse(cand.slice(s, e + 1)); } catch { /* */ } }
}
if (!parsed || typeof parsed !== 'object') { console.error('unparseable:', out.slice(0, 300)); process.exit(4); }

const validId = parsed.build_id && candidates.some((c) => c.build_id === parsed.build_id);
const conf = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
console.log(`\n── DAY ${DATE} · ${photos.length} photos (${analyzed.length} analyzed) · ${ms}ms ──`);
console.log(`verdict:    ${validId ? parsed.label : 'UNCERTAIN'} · confidence ${conf}`);
console.log(`evidence:   ${parsed.evidence}`);

const ids = photos.map((p) => p.id);

if (validId && conf >= THRESHOLD) {
  if (DRY) { console.log(`[dry-run] would FILE ${ids.length} photos → ${parsed.label}`); process.exit(0); }
  const { error: upErr } = await supabase.from('vehicle_images')
    .update({ vehicle_id: parsed.build_id, auto_suggestion_confidence: conf, auto_suggestion_reasons: [`day-classifier: ${parsed.evidence}`] })
    .in('id', ids);
  if (upErr) { console.error('file error:', upErr.message); process.exit(5); }
  console.log(`[FILED] ${ids.length} photos → ${parsed.label} (${parsed.build_id})`);
  await supabase.rpc('recompute_vehicle_primary_image', { p_vehicle_id: parsed.build_id });
  console.log(`[lead] recomputed for ${parsed.build_id}`);
} else if (validId && conf >= 0.5) {
  if (DRY) { console.log(`[dry-run] would SUGGEST (not file) ${ids.length} photos → ${parsed.label} for owner-confirm`); process.exit(0); }
  await supabase.from('vehicle_images')
    .update({ suggested_vehicle_id: parsed.build_id, auto_suggestion_confidence: conf, auto_suggestion_reasons: [`day-classifier: ${parsed.evidence}`] })
    .in('id', ids);
  console.log(`[suggest] ${ids.length} photos → ${parsed.label} (conf ${conf}) — held for owner-confirm, NOT filed`);
} else {
  console.log(`[hold] no confident build → left UNFILED (owner-confirm).`);
}
