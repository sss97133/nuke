#!/usr/bin/env node
/**
 * synthesize-day.mjs — the ONE model call that turns a day's per-frame sensor
 * readings into ONE coherent day picture. The genetic-flaw fix.
 *
 * THE FLAW it repairs
 *   build-day.mjs built work_description by CONCATENATING each frame's
 *   narrative_one_line in time order (`map → filter → join`), with NO model and NO
 *   day-level reasoning. The image was the unit; the day was just join(). Concatenating
 *   sensor readings is not analysis. On the Mustang's 2024-09-24 (97 frames) the
 *   concatenation truncated at 1000 chars, silently dropping the 13:18–15:32 morning,
 *   and sat "mid-build primer" captions beside a finished show-black car.
 *
 * THE FIX (this file)
 *   The DAY is the unit of analysis. One model pass reads a whole day's frames as a
 *   TIME-ORDERED SET — their byok_deep_analysis atoms + time order + build context +
 *   prior days' arcs — and produces ONE coherent picture: what was accomplished, the
 *   progression (rusty rotor across 3 frames → a brake job, not 3 disc captions),
 *   who/what/where/why, worth. Per-frame atoms become the drill-down evidence, NOT the
 *   product. build-day stays the orchestrator/value-calculator; this is the analyst.
 *
 * ATOMS ONLY — RE-RUNNABLE
 *   Synthesis reads only stored atoms already in `photos`
 *   (vehicle_images.ai_scan_metadata.byok_deep_analysis). NO image download, NO vision
 *   re-call. The cost is one TEXT model call over already-extracted JSON. Days
 *   re-synthesize cheaply as context grows (prior arcs improve, more days land). The
 *   model NEVER sees pixels — only the atom payload this file builds inline.
 *
 * SANDBOX NOTE (same rule as analyze-capture-photos.mjs)
 *   This shells out to `claude --print`, which touches NO network — it only reads the
 *   inline atom payload from stdin and prints JSON. The Bash sandbox can't bite a step
 *   that makes no network calls. The Supabase write happens back in build-day.mjs.
 *
 * THE $410 GUARD (hard invariants, enforced here on the way out)
 *   1. value.total_job_cost stays NULL — synthesis NEVER prices a day.
 *   2. every work_item.value_status is forced to "unconfirmed".
 *   3. value.owner_confirmed is forced false; labor is DESCRIBED, never banked.
 *   Photos prove PRESENCE of work, never VALUE. The seat/trunk-mat install becomes a
 *   confirm_prompt, not $410.
 *
 * Harness owns IDs/timestamps; the model owns analysis only.
 */

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const SYNTH_SCHEMA_VERSION = 'day-synth-1';
const SYNTH_PROMPT_VERSION = 'day-synthesis-2026-06-14';

// Allowed enums for the day-level fields (coerce invented values rather than discard,
// same forgiveness as the per-image sanitize stage).
const WORK_TYPES = new Set(['labor', 'inspection', 'documentation', 'parts_sourcing', 'acquisition', 'mixed']);
const PRIMARY_INTENTS = new Set(['labor', 'inspection', 'documentation', 'parts_sourcing', 'acquisition', 'unknown']);
const LABOR_SIGNALS = new Set(['observed', 'documentation_only', 'ambiguous']);

// Trim a per-frame byok_deep_analysis atom object down to the cross-frame signal the
// synthesis prompt asks for. Keeps the payload compact (97 frames stays well within a
// text prompt) while preserving every field the foreman reasons across.
function frameAtom(p, byok, frameNarrative) {
  const b = byok(p) || {};
  const so = b.state_observations || {};
  return {
    image_id: p.id,
    taken_at: p.taken_at,
    hhmm: (p.taken_at || '').slice(11, 16),
    scene_type: b.scene_type ?? 'unknown',
    build_phase_guess: b.build_phase_guess ?? 'unknown',
    intent: b.intent ?? 'unknown',
    intent_confidence: typeof b.intent_confidence === 'number' ? b.intent_confidence : null,
    components_seen: Array.isArray(b.components_seen)
      ? b.components_seen.slice(0, 12).map((c) => ({
          label: c?.label ?? null,
          bbox: Array.isArray(c?.bbox) ? c.bbox : null,
          part_number_guess: c?.part_number_guess ?? null,
        }))
      : [],
    text_regions: Array.isArray(b.text_regions)
      ? b.text_regions.slice(0, 12).map((t) => (typeof t === 'string' ? t : t?.text)).filter(Boolean)
      : [],
    state_observations: {
      rust_severity: so.rust_severity ?? null,
      paint_state: so.paint_state ?? null,
      completeness: so.completeness ?? null,
      damage_callouts: Array.isArray(so.damage_callouts) ? so.damage_callouts.slice(0, 8) : [],
    },
    workshop_signals: b.workshop_signals ?? null,
    presence: b.presence ?? null,
    narrative_one_line: b.narrative_one_line ?? (frameNarrative ? frameNarrative(p) : null),
    agent_notes: b.agent_notes ?? null,
    open_questions: Array.isArray(b.open_questions) ? b.open_questions.slice(0, 6) : [],
  };
}

// Coerce the model's day-synthesis JSON into the schema's shape and slam the $410
// invariants shut. The harness — not the model — owns IDs, the date, and the cost gate.
function sanitizeSynthesis(s, { VEHICLE_ID, DATE, frameCount }) {
  s = (s && typeof s === 'object') ? s : {};

  // Harness owns these — never trust the model's echo.
  s.schema_version = SYNTH_SCHEMA_VERSION;
  s.vehicle_id = VEHICLE_ID;
  s.session_date = DATE;
  s.frame_count = frameCount;

  if (!WORK_TYPES.has(s.work_type)) s.work_type = 'mixed';
  if (!PRIMARY_INTENTS.has(s.primary_intent)) s.primary_intent = 'unknown';
  s.title = (typeof s.title === 'string' && s.title.trim()) ? s.title.trim() : null;
  s.day_narrative = (typeof s.day_narrative === 'string' && s.day_narrative.trim()) ? s.day_narrative.trim() : null;
  s.day_verdict = (typeof s.day_verdict === 'string') ? s.day_verdict : null;
  s.build_arc_placement = (typeof s.build_arc_placement === 'string') ? s.build_arc_placement : null;
  s.progression_notes = (typeof s.progression_notes === 'string') ? s.progression_notes : null;
  s.confidence = typeof s.confidence === 'number' ? s.confidence : null;
  s.open_questions = Array.isArray(s.open_questions) ? s.open_questions : [];

  // work_items — every one is unconfirmed; never priced.
  s.work_items = Array.isArray(s.work_items) ? s.work_items.map((w) => {
    w = (w && typeof w === 'object') ? w : {};
    if (!LABOR_SIGNALS.has(w.labor_signal)) w.labor_signal = 'ambiguous';
    w.value_status = 'unconfirmed';            // schema-pinned const — INVARIANT
    w.evidence_frame_ids = Array.isArray(w.evidence_frame_ids) ? w.evidence_frame_ids : [];
    w.parts_installed = Array.isArray(w.parts_installed) ? w.parts_installed : [];
    if (w.confirm_prompt != null && typeof w.confirm_prompt !== 'string') w.confirm_prompt = null;
    return w;
  }) : [];

  // value block — the cost gate. Synthesis describes, NEVER banks.
  const v = (s.value && typeof s.value === 'object') ? s.value : {};
  s.value = {
    labor_minutes_estimate: typeof v.labor_minutes_estimate === 'number' ? v.labor_minutes_estimate : 0,
    needs_owner_confirmation: v.needs_owner_confirmation !== false, // default true
    value_reasoning: typeof v.value_reasoning === 'string' ? v.value_reasoning : null,
    total_job_cost: null,    // ALWAYS null from synthesis — only owner confirmation writes cost
    owner_confirmed: false,  // ALWAYS false from synthesis
  };

  // Provenance — source DNA. A bare verdict without who/how is a schema failure.
  s.synthesized_at = new Date().toISOString();
  s.prompt_version = SYNTH_PROMPT_VERSION;
  return s;
}

/**
 * synthesizeDay — the ONE model call. Called by build-day between the value math and
 * the work_session upsert. Reads atoms already in memory; downloads nothing.
 *
 * @returns {{ title, work_type, work_description, metadata }} where:
 *   title           ← synth.title            (the day headline)
 *   work_description ← synth.day_narrative    (the one coherent day story)
 *   work_type       ← synth.work_type
 *   metadata        ← the full synthesis object (drill-down evidence + value reasoning)
 * On any failure returns { ok:false, ... } with the raw_concat fallback so build-day
 * can fall back to the concatenation rather than store an empty narrative.
 */
export async function synthesizeDay({
  photos, byok, frameNarrative, laborFrames,
  intentCounts, dominantIntent, opCounts, spanMinutes, laborMinutes,
  DATE, VEHICLE_ID, priorArcs,
  vehicleLabel, model = 'claude-opus-4-8', timeoutMs,
}) {
  const frames = (photos || []).map((p) => frameAtom(p, byok, frameNarrative));
  const frameCount = frames.length;
  // The old concatenation — kept ONLY as raw material for the model and as a
  // metadata.synthesis.raw_concat fallback input, never as the stored product.
  const rawConcat = (photos || [])
    .map((p) => { const n = frameNarrative ? frameNarrative(p) : null; return n ? `${(p.taken_at || '').slice(11, 16)} ${n}` : null; })
    .filter(Boolean)
    .join(' | ');

  if (frameCount === 0) {
    return { ok: false, reason: 'no_frames', raw_concat: rawConcat };
  }

  const promptMd = readFileSync(join(import.meta.dirname, 'day-synthesis-prompt.md'), 'utf-8');
  const schemaJson = readFileSync(join(import.meta.dirname, 'day-synthesis.schema.json'), 'utf-8');

  // Build the atoms-only payload the model reasons over. No pixels, no file paths.
  const payload = {
    vehicle: {
      vehicle_id: VEHICLE_ID,
      label: vehicleLabel || null,
      prior_day_arcs: Array.isArray(priorArcs) ? priorArcs : [],
    },
    day: {
      session_date: DATE,
      frame_count: frameCount,
      time_span_minutes: spanMinutes ?? null,
      labor_frame_count: Array.isArray(laborFrames) ? laborFrames.length : null,
      labor_minutes_estimate_from_harness: laborMinutes ?? null,
      intent_mix: intentCounts || {},
      dominant_intent: dominantIntent || null,
      operation_mix: opCounts || {},
    },
    frames, // time-ordered (photos arrive ascending by taken_at)
  };

  const prompt = [
    promptMd,
    '',
    '## OUTPUT SCHEMA (emit EXACTLY this shape — one JSON object, nothing else)',
    '```json',
    schemaJson.trim(),
    '```',
    '',
    '## THIS DAY (atoms only — never image pixels)',
    'Reason ACROSS the frame SET below. The frames are time-ordered. Follow components,',
    'collapse near-duplicate bursts, resolve sensor noise against the set, place the day in',
    'the build arc using prior_day_arcs, and honor the $410 guard (describe labor, never price it).',
    '',
    '```json',
    JSON.stringify(payload),
    '```',
    '',
    'Output ONLY the day-synthesis JSON object. No prose, no code fence, no commentary.',
  ].join('\n');

  // Isolate the call in a temp dir; write the prompt for debuggability.
  const dir = mkdtempSync(join(tmpdir(), 'daysynth-'));
  try { writeFileSync(join(dir, 'prompt.txt'), prompt); } catch { /* best effort */ }

  // No --add-dir, no images: this is a TEXT call over the inline atom payload.
  // Never force CLAUDE_EFFORT=high (a per-day agent run would blow the budget); the
  // model arg (opus) is the analysis model. Backstop timeout scales with frame count.
  const env = { ...process.env };
  delete env.CLAUDE_EFFORT;
  const t0 = Date.now();
  const res = spawnSync('claude', [
    '--print', '--model', model, '--permission-mode', 'bypassPermissions',
  ], {
    input: prompt,
    env,
    timeout: timeoutMs ?? Math.min(600_000, 90_000 + frameCount * 1_500),
    maxBuffer: 64 * 1024 * 1024,
    encoding: 'utf-8',
  });
  const ms = Date.now() - t0;

  if (res.error) {
    return { ok: false, reason: `spawn_error: ${res.error.message}`, raw_concat: rawConcat, ms };
  }
  const out = (res.stdout || '').trim();
  if (!out) {
    return { ok: false, reason: `empty_output (exit ${res.status})`, raw_concat: rawConcat, ms };
  }

  // Extract the JSON object — tolerate a stray code fence or leading prose.
  let parsed = null;
  const fence = out.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1].trim() : out;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    const s = candidate.indexOf('{');
    const e = candidate.lastIndexOf('}');
    if (s !== -1 && e > s) {
      try { parsed = JSON.parse(candidate.slice(s, e + 1)); } catch { /* fall through */ }
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'unparseable_json', raw_output: out.slice(0, 500), raw_concat: rawConcat, ms };
  }

  const synth = sanitizeSynthesis(parsed, { VEHICLE_ID, DATE, frameCount });
  // Stash the raw_concat as a fallback-input record (NOT the product).
  synth.raw_concat = rawConcat.slice(0, 2000);
  synth.synthesis_ms = ms;
  synth.synthesis_model = model;

  // Map to the work_sessions fields build-day writes. metadata holds the WHOLE
  // synthesis object → it lands in work_sessions.metadata (jsonb), invisible to today's
  // app but free to populate, and the drill-down evidence map for tomorrow.
  return {
    ok: true,
    title: synth.title,
    work_type: synth.work_type,
    work_description: synth.day_narrative,
    metadata: { synthesis: synth },
    ms,
  };
}

// CLI shim — standalone re-synthesis of ONE (vehicle, date) over stored atoms, no image
// download. Mirrors build-day's photo query + publish gate, computes the same intent
// mixes, runs synthesizeDay, and writes work_description/title/work_type/metadata onto
// the existing work_sessions row WITHOUT touching the owner-confirmed cost gate.
//   dotenvx run -- node scripts/daily-receipt/synthesize-day.mjs \
//     --vehicle-id <uuid> --date YYYY-MM-DD [--model claude-opus-4-8] [--dry-run]
if (import.meta.url === `file://${process.argv[1]}`) {
  const { createClient } = await import('@supabase/supabase-js');
  const argv = process.argv.slice(2);
  const a = (n, d) => { const i = argv.indexOf(n); return i !== -1 ? argv[i + 1] : d; };
  const has = (n) => argv.includes(n);
  const VEHICLE_ID = a('--vehicle-id');
  const DATE = a('--date');
  const MODEL = a('--model', 'claude-opus-4-8');
  const DRY = has('--dry-run');
  if (!VEHICLE_ID || !DATE) { console.error('Required: --vehicle-id --date'); process.exit(1); }

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sb = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

  const IMSG_ARTIFACT = /__kIM|kIMFileTransfer|NSKeyedArchiver|attributedBody/;
  const { data: rawPhotos, error: pErr } = await sb
    .from('vehicle_images')
    .select('id, taken_at, area, part, operation, image_type, caption, vision_gate_status, source, ai_scan_metadata')
    .eq('vehicle_id', VEHICLE_ID)
    .gte('taken_at', `${DATE}T00:00:00+00:00`)
    .lt('taken_at', `${DATE}T23:59:59.999+00:00`)
    .not('is_superseded', 'is', true)
    .order('taken_at', { ascending: true });
  if (pErr) { console.error('photos query:', pErr.message); process.exit(2); }
  const photos = (rawPhotos || []).filter((p) =>
    p.vision_gate_status === 'approved' && p.source !== 'imessage' &&
    !(p.caption && IMSG_ARTIFACT.test(p.caption)));
  if (photos.length === 0) { console.log(`No publish-gated photos for ${VEHICLE_ID} on ${DATE}.`); process.exit(0); }

  const byok = (p) => (p.ai_scan_metadata && p.ai_scan_metadata.byok_deep_analysis) || null;
  const frameNarrative = (p) => {
    if (p.caption && !IMSG_ARTIFACT.test(p.caption)) return p.caption;
    const b = byok(p); const n = b && (b.narrative_one_line || b.agent_notes);
    return (n && typeof n === 'string' && !IMSG_ARTIFACT.test(n)) ? n : null;
  };
  const analyzed = photos.filter((p) => byok(p));
  const laborFrames = photos.filter((p) => { const b = byok(p); return b && b.intent === 'labor' && (typeof b.intent_confidence === 'number' ? b.intent_confidence : 0) >= 0.6; });
  const intentCounts = {};
  for (const p of analyzed) { const it = byok(p).intent || 'unknown'; intentCounts[it] = (intentCounts[it] || 0) + 1; }
  const dominantIntent = Object.entries(intentCounts).sort((x, y) => y[1] - x[1])[0]?.[0] || null;
  const opCounts = {};
  for (const p of photos) { const op = (p.operation || 'general').toLowerCase(); opCounts[op] = (opCounts[op] || 0) + 1; }
  const times = photos.map((p) => new Date(p.taken_at).getTime()).sort((x, y) => x - y);
  const spanMinutes = Math.round((times[times.length - 1] - times[0]) / 60000);

  // Prior arcs: earlier synthesized days for this vehicle, oldest→newest, headline only.
  const { data: priorRows } = await sb
    .from('work_sessions')
    .select('session_date, title, work_description, metadata')
    .eq('vehicle_id', VEHICLE_ID)
    .lt('session_date', DATE)
    .order('session_date', { ascending: true });
  const priorArcs = (priorRows || [])
    .filter((r) => r.metadata?.synthesis || r.work_description)
    .slice(-12)
    .map((r) => ({ date: r.session_date, title: r.title, verdict: r.metadata?.synthesis?.day_verdict || null, arc: r.metadata?.synthesis?.build_arc_placement || null }));

  const { data: veh } = await sb.from('vehicles').select('year, make, model').eq('id', VEHICLE_ID).maybeSingle();
  const vehicleLabel = veh ? `${veh.year ?? ''} ${veh.make ?? ''} ${veh.model ?? ''}`.trim() : null;

  const synth = await synthesizeDay({
    photos, byok, frameNarrative, laborFrames, intentCounts, dominantIntent, opCounts,
    spanMinutes, laborMinutes: null, DATE, VEHICLE_ID, priorArcs, vehicleLabel, model: MODEL,
  });
  if (!synth.ok) { console.error(`synthesis failed: ${synth.reason}`); process.exit(3); }

  console.log(`\n── DAY SYNTHESIS  ${vehicleLabel || VEHICLE_ID}  ${DATE}  (${photos.length} frames, ${synth.ms}ms) ──`);
  console.log(`title:    ${synth.title}`);
  console.log(`type:     ${synth.work_type}`);
  console.log(`verdict:  ${synth.metadata.synthesis.day_verdict}`);
  console.log(`\nnarrative:\n${synth.work_description}\n`);

  if (DRY) { console.log('[dry-run] not writing. Full metadata.synthesis:'); console.log(JSON.stringify(synth.metadata, null, 2)); process.exit(0); }

  // SUPERSESSION — overwrite description/title/work_type/metadata.synthesis on the
  // existing row; NEVER touch total_job_cost / owner_confirmed_at / owner_confirmed_by.
  const { data: existing } = await sb
    .from('work_sessions').select('id, metadata').eq('vehicle_id', VEHICLE_ID).eq('session_date', DATE).limit(1);
  if (!existing || existing.length === 0) {
    console.error(`No work_sessions row for ${VEHICLE_ID} ${DATE}. Run build-day first to create the row, then re-synthesize.`);
    process.exit(4);
  }
  const mergedMeta = { ...(existing[0].metadata || {}), ...synth.metadata };
  const { error: upErr } = await sb.from('work_sessions').update({
    title: synth.title, work_type: synth.work_type, work_description: synth.work_description, metadata: mergedMeta,
  }).eq('id', existing[0].id);
  if (upErr) { console.error('update:', upErr.message); process.exit(5); }
  console.log(`[synthesized] work_session ${existing[0].id} — description/title/work_type/metadata overwritten; cost gate untouched.`);
}
