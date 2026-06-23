/**
 * Deep image analysis — BYOK (Claude Code Agent reads via Read tool).
 *
 * Mirror of scripts/vision-gate-l4.mjs in shape: prepare a worklist for an
 * agent to consume, agent reads each image, writes verdict JSONL, ingest
 * writes structured features back as vehicle_observations.
 *
 * Companion docs: docs/library/technical/engineering-manual/18-deep-image-analysis.md
 *
 * Usage:
 *   prepare: node scripts/deep-image-analysis-byok.mjs prepare \
 *              --vehicle-id <uuid> --limit 20 \
 *              --worklist /tmp/dia/<id>/work.jsonl
 *   ingest:  node scripts/deep-image-analysis-byok.mjs ingest \
 *              --sink /tmp/dia/<id>/verdicts.jsonl
 *
 * Verdict line shape — what the agent writes per image:
 *   {
 *     "image_id": "<uuid>",
 *     "vehicle_id": "<uuid>",
 *     "scene_type": "engine_bay|body_exterior|body_interior|undercarriage|receipt_document|data_plate|hand_drawn_diagram|shop_context|fabrication_in_progress|paint_booth|wheel_assembly|road_test|cross_reference|product_screenshot|spreadsheet|unknown",
 *     "build_phase_guess": "discovery|teardown|metalwork|paint_prep|paint_application|mechanical_assembly|wiring|interior|final_assembly|drivable|show_finish|unknown",
 *     "components_seen": [ { "label": "string", "confidence": 0.0-1.0, "part_number_guess": "string|null" } ],
 *     "state_observations": {
 *        "rust_severity": "none|surface|pitting|perforation|unknown",
 *        "paint_state": "bare_metal|primer|sealer|base|clear|aged|unknown",
 *        "completeness": "stripped|partial|assembled|unknown",
 *        "damage_callouts": ["string", ...]
 *     },
 *     "workshop_signals": {
 *        "tools_visible": ["string", ...],
 *        "fixturing": "freehand|clamped|jig|lift|unknown",
 *        "weld_quality": "none_visible|porous_amateur|clean_consistent|professional|unknown",
 *        "lighting": "natural_outdoor|fluorescent_shop|low|good|unknown"
 *     },
 *     "presence": { "person": false, "dog": false, "place_hint": null },
 *     "narrative_one_line": "what's in this frame in one sentence",
 *     "confidence": 0.0-1.0,
 *     "needs_review": false,
 *     "agent_notes": "string"
 *   }
 *
 * Storage: writes into vehicle_images.ai_scan_metadata.deep_analysis (jsonb
 * merge) AND emits a kind='analysis' vehicle_observation per image with
 * observation_witness linking the image.
 */

import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { dirname } from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'node:url';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

// ─── Schema-as-DNA: a verdict that doesn't meet the contract CANNOT be ingested.
// Dependency-free validator (mirrors scripts/schemas/byok-image-verdict.schema.json).
// This is the gate that makes "fill the schema, granular, like a human" structural
// instead of advisory — a tourist caption fails here and never lands.
const SCENE_TYPES = new Set(["engine_bay","body_exterior","body_interior","undercarriage","receipt_document","data_plate","hand_drawn_diagram","shop_context","fabrication_in_progress","paint_booth","wheel_assembly","road_test","off_property","cross_reference","product_screenshot","spreadsheet","unknown"]);
const BUILD_PHASES = new Set(["discovery","teardown","metalwork","paint_prep","paint_application","mechanical_assembly","wiring","interior","final_assembly","drivable","show_finish","unknown"]);
const RUST = new Set(["none","surface","pitting","perforation","unknown"]);
const PAINT = new Set(["bare_metal","primer","sealer","base","clear","aged","unknown"]);
const COMPLETE = new Set(["stripped","partial","assembled","unknown"]);
const INTENT = new Set(["labor","inspection","parts_sourcing","communication","acquisition","documentation","unknown"]);
const INTENT_CONFIRM_THRESHOLD = 0.6; // below this, intent must be flagged for the ask-the-technician loop
const isBbox = (b) => Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === "number" && n >= 0 && n <= 999);

export function validateVerdict(v) {
  const errs = [];
  for (const f of ["image_id","vehicle_id","scene_type","build_phase_guess","components_seen","state_observations","workshop_signals","presence","camera_pose","narrative_one_line","confidence"]) {
    if (v[f] === undefined || v[f] === null) errs.push(`missing ${f}`);
  }
  if (v.scene_type && !SCENE_TYPES.has(v.scene_type)) errs.push(`scene_type not in enum: ${v.scene_type}`);
  if (v.build_phase_guess && !BUILD_PHASES.has(v.build_phase_guess)) errs.push(`build_phase_guess not in enum: ${v.build_phase_guess}`);
  // intent gate: what the photo is FOR. Only confirmed labor accrues value (the $410 fix).
  if (!v.intent || !INTENT.has(v.intent)) errs.push(`intent missing/not in enum (labor|inspection|parts_sourcing|communication|acquisition|documentation|unknown): ${v.intent}`);
  if (typeof v.intent_confidence !== "number" || v.intent_confidence < 0 || v.intent_confidence > 1) errs.push("intent_confidence must be number 0–1");
  // when intent is unsure, it MUST be flagged for the ask-the-technician loop — never silently assumed
  if ((v.intent === "unknown" || (typeof v.intent_confidence === "number" && v.intent_confidence < INTENT_CONFIRM_THRESHOLD)) && v.needs_clarification !== true)
    errs.push("low-confidence/unknown intent requires needs_clarification:true (ask the technician — don't assume)");
  if (typeof v.confidence !== "number" || v.confidence < 0 || v.confidence > 1) errs.push("confidence must be number 0–1");
  if (typeof v.narrative_one_line === "string" && v.narrative_one_line.length < 12) errs.push("narrative_one_line too short (lazy)");
  // Banned phrase — structured camera_pose only, never "3/4"
  const poseStr = JSON.stringify(v.camera_pose || "");
  if (/3\s*\/\s*4|three[- ]?quarter/i.test(poseStr)) errs.push('camera_pose contains banned "3/4"/"three-quarter" — use structured azimuth/elevation/distance');
  if (typeof v.camera_pose !== "object" || Array.isArray(v.camera_pose)) errs.push("camera_pose must be a structured object");
  // Every localized array element must carry a valid bbox (TWVP 0–999)
  for (const [arr, name] of [[v.components_seen,"components_seen"],[v.damage_localized,"damage_localized"],[v.text_regions,"text_regions"]]) {
    if (arr === undefined) continue;
    if (!Array.isArray(arr)) { errs.push(`${name} must be an array`); continue; }
    arr.forEach((it, i) => {
      if (!isBbox(it?.bbox)) errs.push(`${name}[${i}] missing/invalid bbox (need [x1,y1,x2,y2] 0–999)`);
      if (name === "components_seen" && (typeof it?.confidence !== "number" || it.confidence < 0 || it.confidence > 1)) errs.push(`components_seen[${i}] confidence must be 0–1`);
      // text_regions carry `text`; components/damage carry `label`
      const labelField = name === "text_regions" ? "text" : "label";
      if (typeof it?.[labelField] !== "string" || it[labelField].length < 1) errs.push(`${name}[${i}] missing ${labelField}`);
    });
  }
  const so = v.state_observations || {};
  if (so.rust_severity && !RUST.has(so.rust_severity)) errs.push(`rust_severity not in enum: ${so.rust_severity}`);
  if (so.paint_state && !PAINT.has(so.paint_state)) errs.push(`paint_state not in enum: ${so.paint_state}`);
  if (so.completeness && !COMPLETE.has(so.completeness)) errs.push(`completeness not in enum: ${so.completeness}`);
  if (v.presence && typeof v.presence.person !== "boolean") errs.push("presence.person must be boolean");
  return errs;
}

const args = process.argv.slice(2);
const mode = args[0];
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

async function prepare() {
  const VEHICLE_ID = arg('--vehicle-id');
  const LIMIT = parseInt(arg('--limit', '20'));
  const WORKLIST = arg('--worklist');
  if (!VEHICLE_ID || !WORKLIST) {
    console.error('prepare: --vehicle-id and --worklist required');
    process.exit(1);
  }

  // Paginate so the 1000-row postgrest cap doesn't bite.
  const all = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb
      .from('vehicle_images')
      .select('id, image_url, file_name, taken_at, created_at, source, ai_scan_metadata, latitude, longitude, location_name, exif_data, stale')
      .eq('vehicle_id', VEHICLE_ID)
      .eq('vision_gate_status', 'approved')
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error(`prepare: page query failed: ${error.message}`);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }

  const SHARD_COUNT = parseInt(arg('--shard-count', '1'));
  const SHARD_INDEX = parseInt(arg('--shard-index', '0'));
  const BY_DAY = args.includes('--by-day');
  const hash8 = (s) => parseInt(createHash('md5').update(s).digest('hex').slice(0, 8), 16);
  const dayOf = (r) => (r.taken_at || r.created_at || '').slice(0, 10) || 'unknown';

  // Two queues per the accumulation model:
  //   default  → frames with NO verdict yet (first pass).
  //   --rehash → frames that HAVE a verdict but were marked stale=true because their
  //              first claim was incomplete; re-analyze them now that more context exists
  //              (the new verdict supersedes the old — see ingest).
  const REHASH = args.includes('--rehash');
  const pendingAll = REHASH
    ? all.filter((r) => ((r.ai_scan_metadata || {}).byok_deep_analysis) && r.stale === true)
    : all.filter((r) => !((r.ai_scan_metadata || {}).byok_deep_analysis));

  let pending;
  let chosenDay = null;
  if (BY_DAY) {
    // THE DAY IS THE UNIT OF ANALYSIS. A work session lives in a day's photos
    // read TOGETHER (component lifecycle, before/after, build-phase progression).
    // Parallel workers shard by DAY — a day is NEVER split across workers — and
    // each worker processes its earliest un-drained day, up to LIMIT frames at a
    // time (a 200-photo day takes several passes; build-day rolls them all up).
    const byDay = new Map();
    for (const r of pendingAll) {
      const d = dayOf(r);
      if (SHARD_COUNT > 1 && hash8(d) % SHARD_COUNT !== SHARD_INDEX) continue;
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(r);
    }
    if (byDay.size === 0) {
      console.log(`prepare: no pending days for shard ${SHARD_INDEX}/${SHARD_COUNT} of ${VEHICLE_ID}`);
      return;
    }
    chosenDay = [...byDay.keys()].sort()[0]; // earliest day first
    pending = byDay.get(chosenDay).slice(0, LIMIT);
  } else {
    // Legacy image-hash sharding (used by the steady launchd trickle).
    const inShard = (id) => SHARD_COUNT <= 1 || hash8(id) % SHARD_COUNT === SHARD_INDEX;
    pending = pendingAll.filter((r) => inShard(r.id)).slice(0, LIMIT);
  }

  if (!pending || pending.length === 0) {
    console.log(`prepare: nothing pending for ${VEHICLE_ID} (already-analyzed = ${all.length - pendingAll.length}/${all.length})`);
    return;
  }

  mkdirSync(dirname(WORKLIST), { recursive: true });
  // EXIF is invisible in the (Supabase-stripped) pixels the agent reads — extract it
  // from the row and hand it over: true capture time, GPS, resolved location, camera.
  //
  // CRITICAL: the authoritative capture date is the `taken_at` COLUMN (the iOS capture
  // relay writes asset.creationDate there; see apps/nuke-capture-ios SupabaseService.swift),
  // NOT exif_data. The relay's exif_data carries no date field and stores the camera as
  // flat `camera_make`/`camera_model` keys — so the previous code, which read shot_at
  // from exif_data date fields and the camera from a nested `e.camera.make` object,
  // returned shot_at=null + camera=null for the ENTIRE iOS-synced library. With no
  // temporal anchor the detective inferred a date from image content (a 2017 build photo
  // could land on a 2026 frame). taken_at is primary; exif_data is fallback for
  // exiftool-backfilled storage images only.
  const exifOf = (r) => {
    const e = r.exif_data || {};
    const shotAt = r.taken_at
      || e.dateTaken || e.dateTime || e.DateTimeOriginal || e.technical?.dateTaken || e.CreateDate || null;
    const camMake = e.camera_make || e.Make || (e.camera && typeof e.camera === 'object' ? e.camera.make : null) || null;
    const camModel = e.camera_model || e.Model || (e.camera && typeof e.camera === 'object' ? e.camera.model : null) || null;
    const cam = [camMake, camModel].filter(Boolean).join(' ').trim()
      || (typeof e.camera === 'string' ? e.camera : null) || null;
    const lat = r.latitude ?? e.gps?.latitude ?? e.location?.latitude ?? null;
    const lon = r.longitude ?? e.gps?.longitude ?? e.location?.longitude ?? null;
    return {
      shot_at: shotAt,
      shot_at_source: r.taken_at ? 'taken_at' : (shotAt ? 'exif_data' : null),
      camera: cam,
      gps: (lat != null && lon != null) ? { lat: Number(lat), lon: Number(lon) } : null,
      location_name: r.location_name || null,
      exif_present: !!(cam || shotAt || (lat != null)),
    };
  };
  // file_name can be null (the name lives in the storage URL path) — always derive a
  // safe local filename so the download step has somewhere to write.
  const safeName = (r) => {
    if (r.file_name) return r.file_name;
    const fromUrl = (r.image_url || '').split('/').pop()?.split('?')[0];
    if (fromUrl && /\.(jpe?g|png|heic|webp)$/i.test(fromUrl)) return fromUrl;
    return `${r.id}.jpg`;
  };
  const lines = pending.map((r) =>
    JSON.stringify({
      image_id: r.id,
      vehicle_id: VEHICLE_ID,
      image_url: r.image_url,
      file_name: safeName(r),
      taken_at: r.taken_at,
      created_at: r.created_at,
      source: r.source,
      day: dayOf(r),
      exif: exifOf(r),
    }),
  );
  writeFileSync(WORKLIST, lines.join('\n') + '\n');
  if (chosenDay) {
    writeFileSync(`${WORKLIST}.date`, chosenDay + '\n');
    const remaining = (pendingAll.filter((r) => dayOf(r) === chosenDay).length) - pending.length;
    console.log(`prepare: DAY ${chosenDay} — ${pending.length} of this day's frames → ${WORKLIST} (${remaining} more frames left in this day)`);
  } else {
    console.log(`prepare: ${pending.length} rows → ${WORKLIST}`);
  }
  console.log(`         pool total = ${all.length}, pending = ${all.length - pending.length} not in this batch`);
}

async function ingest() {
  const SINK = arg('--sink');
  if (!SINK || !existsSync(SINK)) {
    console.error('ingest: --sink required and file must exist');
    process.exit(1);
  }

  const { data: src } = await sb
    .from('observation_sources')
    .select('id, slug')
    .eq('slug', 'shop')
    .maybeSingle();
  const shopSourceId = src?.id;
  if (!shopSourceId) {
    console.error('ingest: shop source slug not found');
    process.exit(1);
  }

  const lines = readFileSync(SINK, 'utf-8').split('\n').filter(Boolean);
  let wrote = 0, failed = 0;
  const now = new Date().toISOString();

  for (const line of lines) {
    let v;
    try { v = JSON.parse(line); } catch { failed++; continue; }
    if (!v.image_id || !v.vehicle_id) { failed++; continue; }

    // Schema-as-DNA gate: reject non-conforming verdicts before they can land.
    const verdictErrs = validateVerdict(v);
    if (verdictErrs.length) {
      console.error(`  REJECT ${String(v.image_id).slice(0,8)}: ${verdictErrs.join("; ")}`);
      failed++;
      continue;
    }

    // Merge new analysis into existing ai_scan_metadata.byok_deep_analysis
    const { data: imgRow } = await sb
      .from('vehicle_images')
      .select('ai_scan_metadata')
      .eq('id', v.image_id)
      .maybeSingle();
    const existingMeta = (imgRow?.ai_scan_metadata) || {};
    const updatedMeta = {
      ...existingMeta,
      byok_deep_analysis: {
        scene_type: v.scene_type ?? 'unknown',
        build_phase_guess: v.build_phase_guess ?? 'unknown',
        camera_pose: v.camera_pose ?? null,
        components_seen: v.components_seen ?? [],
        damage_localized: v.damage_localized ?? [],
        text_regions: v.text_regions ?? [],
        state_observations: v.state_observations ?? {},
        workshop_signals: v.workshop_signals ?? {},
        presence: v.presence ?? {},
        narrative_one_line: v.narrative_one_line ?? null,
        confidence: v.confidence ?? null,
        intent: v.intent ?? null,
        intent_confidence: v.intent_confidence ?? null,
        needs_review: v.needs_review ?? false,
        needs_clarification: v.needs_clarification ?? false,
        context_complete: v.context_complete ?? null,
        open_questions: v.open_questions ?? [],
        agent_notes: v.agent_notes ?? null,
        analyzed_at: now,
        prompt_version: 'byok_v3_camera_pose_2026-05-23',
        // Source DNA stamped by the harness (byok-image-batch.sh sanitize stage).
        // A bare verdict without who/how/cost is a schema failure.
        agent_model: v.provenance?.agent_model ?? null,
        agent_tier: v.provenance?.agent_tier ?? null,
        extraction_method: v.provenance?.extraction_method ?? null,
        agent_duration_ms: v.provenance?.agent_duration_ms ?? null,
        agent_cost_cents: v.provenance?.agent_cost_cents ?? null,
        cost_basis: v.provenance?.cost_basis ?? null,
        run_id: v.provenance?.run_id ?? null,
      },
    };

    // Accumulation model: a frame whose claim is incomplete is NOT done — it goes
    // stale=true and re-enters the queue (prepare --rehash) to be re-analyzed once
    // more context exists. Completeness is declared by the agent or inferred from
    // low confidence / open questions.
    const incomplete = v.context_complete === false
      || v.needs_review === true || v.needs_clarification === true
      || (typeof v.confidence === 'number' && v.confidence < 0.55)
      || (Array.isArray(v.open_questions) && v.open_questions.length > 0);

    const { error: upErr } = await sb
      .from('vehicle_images')
      .update({ ai_scan_metadata: updatedMeta, stale: incomplete, last_rerun_at: now, vision_model_version: v.provenance?.agent_model ?? 'byok_v3_opus48' })
      .eq('id', v.image_id);
    if (upErr) {
      console.error(`  fail update image ${v.image_id}: ${upErr.message}`);
      failed++;
      continue;
    }

    // Accumulation, not replacement: if a prior (non-superseded) verdict already exists
    // for this image, this new claim SUPERSEDES it (old one preserved per the trust
    // invariant). The agent never knows the prior id — the harness resolves it.
    let supersedesId = v.supersedes_original_id || null;
    if (!supersedesId) {
      const { data: prior } = await sb
        .from('vehicle_observations')
        .select('id')
        .eq('vehicle_id', v.vehicle_id)
        .eq('structured_data->>analysis_kind', 'image_deep_byok')
        .eq('structured_data->>image_id', v.image_id)
        .eq('is_superseded', false)
        .order('ingested_at', { ascending: false })
        .limit(1);
      supersedesId = prior?.[0]?.id || null;
    }

    // Emit a kind='condition' vehicle_observation summarizing this image so
    // it lights up in timelines + observation routes. structured_data.analysis_kind
    // disambiguates from other condition rows. ('analysis' enum value pending —
    // migration history out of sync as of 2026-05-23.)
    const { data: obsRow, error: obsErr } = await sb
      .from('vehicle_observations')
      .insert({
        vehicle_id: v.vehicle_id,
        kind: 'condition',
        observed_at: v.taken_at || v.created_at || now,
        ingested_at: now,
        source_id: shopSourceId,
        source_url: null,
        confidence: v.needs_review ? 'low' : 'medium',
        confidence_score: v.confidence ?? 0.7,
        content_text: v.narrative_one_line || null,
        // Typed provenance columns — the source DNA the PULSE audit found NULL
        // on 1,074 of 1,074 byok observations. Stamped by the harness.
        agent_model: v.provenance?.agent_model ?? null,
        agent_tier: v.provenance?.agent_tier ?? null,
        extraction_method: v.provenance?.extraction_method ?? null,
        agent_duration_ms: v.provenance?.agent_duration_ms ?? null,
        agent_cost_cents: v.provenance?.agent_cost_cents ?? null,
        structured_data: {
          analysis_kind: 'image_deep_byok',
          image_id: v.image_id,
          scene_type: v.scene_type,
          build_phase_guess: v.build_phase_guess,
          camera_pose: v.camera_pose ?? null,
          components_seen: v.components_seen,
          damage_localized: v.damage_localized ?? [],
          text_regions: v.text_regions ?? [],
          state_observations: v.state_observations,
          workshop_signals: v.workshop_signals,
          presence: v.presence,
          intent: v.intent ?? null,
          intent_confidence: v.intent_confidence ?? null,
          context_complete: v.context_complete ?? null,
          open_questions: v.open_questions ?? [],
          witness_image_id: v.image_id,
          ...(supersedesId ? { supersedes_original_id: supersedesId } : {}),
        },
        is_superseded: false,
      })
      .select('id')
      .maybeSingle();
    if (obsErr || !obsRow) {
      console.error(`  fail obs insert for ${v.image_id}: ${obsErr?.message}`);
      failed++;
      continue;
    }

    await sb.from('observation_witnesses').insert({
      observation_id: obsRow.id,
      image_id: v.image_id,
      witness_role: 'primary',
      capture_method: 'photo_no_exif',
      added_by_agent_key: 'byok_deep_image_analysis_2026-05-23',
      attestation_notes: 'BYOK Claude Code Agent deep analysis; features in vehicle_images.ai_scan_metadata.byok_deep_analysis',
    });

    // Supersession: if this verdict supersedes a prior observation, mark the
    // old row is_superseded + point superseded_by at the new row. Per
    // testimony-immutability invariant we never DELETE — only chain.
    if (supersedesId) {
      const { error: supErr } = await sb
        .from('vehicle_observations')
        .update({ is_superseded: true, superseded_by: obsRow.id })
        .eq('id', supersedesId);
      if (supErr) {
        console.error(`  fail supersede ${supersedesId}: ${supErr.message}`);
      } else {
        console.log(`  superseded ${supersedesId} → ${obsRow.id} (re-hash with fuller context)`);
      }
    }

    wrote++;
  }

  console.log(`ingest: wrote ${wrote}, failed ${failed} from ${SINK}`);
}

// context — assemble the "what the agent must KNOW before analyzing" briefing for a
// vehicle, marking where the day being analyzed sits in the build arc. Sources the
// canonical nuke.dossier/v1 (identity + build_summary + work timeline) so we don't
// rebuild build history, plus a one-line lifecycle summary of what's already been
// deep-analyzed. Written as compact markdown, prepended to the vision prompt.
async function buildContext() {
  const VEHICLE_ID = arg('--vehicle-id');
  const DATE = arg('--date');                 // the day being analyzed (mark it in the arc)
  const OUT = arg('--out');
  if (!VEHICLE_ID || !OUT) { console.error('context: --vehicle-id and --out required'); process.exit(1); }

  let dossier = null;
  // The dossier edge function can cold-start (~30-45s). Be patient: up to 6 tries
  // with a per-request 50s timeout and a 5s backoff so a cold start doesn't fall through to thin.
  for (let t = 0; t < 6 && !dossier; t++) {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/api-v1-vehicle-history/${VEHICLE_ID}?view=dossier`,
        { headers: { Authorization: `Bearer ${KEY}`, apikey: KEY }, signal: AbortSignal.timeout(50000) });
      if (r.ok) { const j = await r.json().catch(() => null); if (j && j.vehicle) { dossier = j; break; } }
    } catch { /* timeout / transient — retry */ }
    await new Promise((s) => setTimeout(s, 5000));
  }

  // Fallback identity + timeline straight from the DB when the dossier edge fn is cold,
  // so the detective ALWAYS gets the vehicle and its work-session arc.
  if (!dossier) {
    try {
      const { data: vrow } = await sb.from('vehicles')
        .select('year, make, model, trim, vin, color').eq('id', VEHICLE_ID).maybeSingle();
      const { data: ws } = await sb.from('work_sessions')
        .select('session_date, title, work_type, documented_hours, photo_count')
        .eq('vehicle_id', VEHICLE_ID).order('session_date', { ascending: true }).limit(60);
      if (vrow) {
        dossier = {
          vehicle: { name: `${vrow.year} ${vrow.make} ${vrow.model}${vrow.trim ? ' ' + vrow.trim : ''}`,
            vin: vrow.vin, color: vrow.color, engine: null, transmission: null },
          timeline: (ws || []).map((w) => ({ date: (w.session_date || '').slice(0, 10), title: w.title,
            work_type: w.work_type, hours: w.documented_hours, photos: w.photo_count })),
          _from: 'db_fallback',
        };
      }
    } catch { /* leave thin */ }
  }

  // Lifecycle: what build phases / components have we already established (from prior byok obs).
  let lifecycle = '';
  try {
    const { data } = await sb.from('vehicle_observations')
      .select('observed_at, structured_data')
      .eq('vehicle_id', VEHICLE_ID)
      .eq('structured_data->>analysis_kind', 'image_deep_byok')
      .order('observed_at', { ascending: true }).limit(2000);
    if (data && data.length) {
      const phaseByDay = new Map();
      for (const o of data) {
        const d = (o.observed_at || '').slice(0, 10);
        const ph = o.structured_data?.build_phase_guess || 'unknown';
        if (!phaseByDay.has(d)) phaseByDay.set(d, new Set());
        phaseByDay.get(d).add(ph);
      }
      lifecycle = [...phaseByDay.entries()].map(([d, s]) => `${d}:${[...s].join(',')}`).join('  ');
    }
  } catch { /* optional */ }

  // LOCATION LEGEND — GPS clusters → known shops/places. Lets the detective resolve a
  // frame's coordinates to "Ernie's Upholstery" vs "Viva Las Vegas (off-property)" etc.
  let locLegend = [];
  try {
    const { data } = await sb.from('vehicle_images')
      .select('latitude, longitude, location_name')
      .eq('vehicle_id', VEHICLE_ID).not('latitude', 'is', null).limit(3000);
    if (data && data.length) {
      const clusters = new Map();
      for (const r of data) {
        const key = `${Number(r.latitude).toFixed(3)},${Number(r.longitude).toFixed(3)}`;
        if (!clusters.has(key)) clusters.set(key, { n: 0, names: new Map() });
        const c = clusters.get(key); c.n++;
        const nm = r.location_name || '(unnamed)';
        c.names.set(nm, (c.names.get(nm) || 0) + 1);
      }
      locLegend = [...clusters.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8)
        .map(([key, c]) => {
          const top = [...c.names.entries()].sort((a, b) => b[1] - a[1])[0][0];
          return `${key} → ${top} (${c.n} photos)`;
        });
    }
  } catch { /* optional */ }

  const lines = [];
  lines.push(`# VEHICLE CONTEXT — know this before you analyze`);
  if (dossier?.vehicle) {
    const v = dossier.vehicle;
    lines.push(`**Vehicle:** ${v.name} — VIN ${v.vin} — ${v.engine || '?'} / ${v.transmission || '?'} — ${v.color || '?'}`);
  }
  if (dossier?.build_summary) {
    const b = dossier.build_summary;
    const wt = b.work_type_breakdown ? Object.entries(b.work_type_breakdown).map(([k, n]) => `${k}:${n}`).join(', ') : '';
    lines.push(`**Build so far:** ${b.work_days ?? '?'} documented work days over ${b.span ?? '?'}, ${b.documented_hours ?? '?'} hrs. Work mix: ${wt}`);
  }
  if (dossier?.valuation) lines.push(`**Valuation:** ${dossier.valuation.amount} (${dossier.valuation.source})`);
  if (Array.isArray(dossier?.timeline) && dossier.timeline.length) {
    lines.push(`\n**Build timeline (where this day sits):**`);
    for (const t of dossier.timeline) {
      const mark = t.date === DATE ? '  ◀── THIS DAY' : '';
      lines.push(`- ${t.date} · ${t.title || 'work'} · ${t.work_type || ''} · ${t.hours ?? '?'}h · ${t.photos ?? 0} photos${mark}`);
    }
    if (DATE && !dossier.timeline.some((t) => t.date === DATE))
      lines.push(`- ${DATE} · **THIS DAY (not yet rolled up — you are analyzing it now)**`);
  }
  if (locLegend.length) {
    lines.push(`\n**Location legend (GPS cluster → place):**`);
    for (const l of locLegend) lines.push(`- ${l}`);
    lines.push(`Each frame below carries its GPS — resolve it against this legend. A frame shot away from the main shop is off_property work (and tells you WHO/WHERE: e.g. upholstery shop, a vendor, the owner's dad's lot).`);
  }
  if (lifecycle) lines.push(`\n**Already deep-analyzed (day:phases):** ${lifecycle}`);
  lines.push(`\nUse this to ground every verdict: recognize THIS build's known parts (e.g. the engine swap, axle, brakes), place the day in the arc (early teardown vs late assembly), track components across days (a part rusty earlier may be the one being installed here), and use each frame's GPS/timestamp/camera as hard evidence of where, when, and on what device it was shot.`);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, lines.join('\n') + '\n');
  console.log(`context: wrote briefing → ${OUT} (dossier=${dossier ? 'yes' : 'THIN'}, timeline=${dossier?.timeline?.length || 0} days)`);
}

// queue — print this user's vehicle_ids that have approved frames, most-first.
// Used by byok-image-drain.sh to self-drive the steady launchd cron across ALL
// vehicles instead of one hardcoded car. Cheap (scoped to approved frames);
// prepare skips already-analyzed frames, so a fully-drained vehicle returns
// instantly and the drain's cursor advances past it.
async function queue() {
  const VEHICLE_USER = arg('--user-id');
  if (!VEHICLE_USER) { console.error('queue: --user-id required'); process.exit(1); }
  const approved = new Map();   // vehicle_id -> approved frame count
  const analyzed = new Map();   // vehicle_id -> frames already carrying a byok verdict
  const PAGE = 1000;
  // Pass 1: all approved frames per vehicle. Pass 2: the subset already analyzed.
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb
      .from('vehicle_images')
      .select('vehicle_id')
      .eq('user_id', VEHICLE_USER)
      .eq('vision_gate_status', 'approved')
      .not('vehicle_id', 'is', null)
      .order('vehicle_id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) { console.error(`queue: ${error.message}`); process.exit(1); }
    if (!data || data.length === 0) break;
    for (const r of data) approved.set(r.vehicle_id, (approved.get(r.vehicle_id) || 0) + 1);
    if (data.length < PAGE) break;
  }
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb
      .from('vehicle_images')
      .select('vehicle_id')
      .eq('user_id', VEHICLE_USER)
      .eq('vision_gate_status', 'approved')
      .not('vehicle_id', 'is', null)
      .not('ai_scan_metadata->byok_deep_analysis', 'is', null)
      .order('vehicle_id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    // Non-fatal: if this filter is rejected, fall back to pending-desc ordering rather
    // than killing the drain (an empty `analyzed` map just means everyone reads as 0).
    if (error) { console.error(`queue: analyzed-count pass skipped (${error.message})`); break; }
    if (!data || data.length === 0) break;
    for (const r of data) analyzed.set(r.vehicle_id, (analyzed.get(r.vehicle_id) || 0) + 1);
    if (data.length < PAGE) break;
  }
  // Coverage-first: vehicles with the FEWEST analyzed frames lead, so zero-coverage cars
  // (empty when browsed) get a verdict before fully-drained ones. Tiebreak by pending desc
  // (more undone work first), then by id for stability. Combined with the drain's round-robin
  // loop, every vehicle gets a batch fast instead of one big car hogging the run.
  const order = [...approved.keys()].sort((a, b) => {
    const da = analyzed.get(a) || 0, db = analyzed.get(b) || 0;
    if (da !== db) return da - db;                       // least-analyzed first
    const pa = (approved.get(a) || 0) - da, pb = (approved.get(b) || 0) - db;
    if (pa !== pb) return pb - pa;                        // most pending first
    return a < b ? -1 : 1;
  });
  for (const vid of order) console.log(vid);
}

// resolve: print the user's chosen compute as shell-exportable lines. This is the
// "broker" — it turns the per-user Settings row (user_analysis_settings) into the env
// the drain needs, so the cloud runner stops being hardwired to one GitHub secret.
//   nuke_hosted      -> NUKE_ANALYSIS_METHOD=nuke_hosted (runner falls back to platform creds)
//   byo_subscription -> CLAUDE_CODE_OAUTH_TOKEN=<decrypted vault secret>
//   byo_api_key      -> ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_API_KEY per provider
// The secret is decrypted server-side via the service-role-only RPC; we never log it.
async function resolve() {
  const VEHICLE_USER = arg('--user-id');
  if (!VEHICLE_USER) { console.error('resolve: --user-id required'); process.exit(1); }
  const { data: row, error } = await sb
    .from('user_analysis_settings')
    .select('method, provider, model, enabled')
    .eq('user_id', VEHICLE_USER)
    .maybeSingle();
  if (error) { console.error(`resolve: ${error.message}`); process.exit(1); }

  // No row yet, or hosted, or disabled → hosted (drain uses whatever the workflow provides).
  const method = row?.method || 'nuke_hosted';
  const enabled = row ? row.enabled : true;
  const out = [`NUKE_ANALYSIS_METHOD=${method}`, `NUKE_ANALYSIS_ENABLED=${enabled ? '1' : '0'}`];
  if (row?.model) out.push(`BYOK_MODEL=${row.model}`);

  if ((method === 'byo_subscription' || method === 'byo_api_key') && enabled) {
    const { data: secret, error: se } = await sb.rpc('get_analysis_credential', { p_user_id: VEHICLE_USER });
    if (se) { console.error(`resolve: credential decrypt failed: ${se.message}`); process.exit(1); }
    if (!secret) { console.error('resolve: method is byo_* but no credential stored — falling back to hosted'); out[0] = 'NUKE_ANALYSIS_METHOD=nuke_hosted'; }
    else if (method === 'byo_subscription') out.push(`CLAUDE_CODE_OAUTH_TOKEN=${secret}`);
    else {
      const env = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', google: 'GOOGLE_API_KEY' }[row.provider || 'anthropic'];
      out.push(`${env}=${secret}`);
    }
  }

  // Fallback to the APP's "Connected accounts" screen. AIProviderSettings.tsx saves the user's
  // key to user_ai_providers with base64 "obfuscation" (btoa) — NOT Vault — and with no method
  // field. That is a separate credential system the broker historically ignored, so a user who
  // set their key in the app got no per-user compute (the drain silently ran on the platform
  // repo secret instead). If the secure Vault path above produced no byo credential, honor the
  // app connection: base64-decode and route by token prefix — sk-ant-oat = Claude subscription
  // (CLAUDE_CODE_OAUTH_TOKEN, flat cost), sk-ant-api = pay-per-token key (ANTHROPIC_API_KEY).
  // SECURITY DEBT: a subscription token stored base64-only is weak; the real fix is to make the
  // app save via set_analysis_credential (Vault) so both systems share one encrypted source.
  if (method === 'nuke_hosted' && enabled) {
    const { data: prov } = await sb.rpc('get_user_api_key_info', { p_user_id: VEHICLE_USER, p_provider: 'anthropic' });
    const r0 = Array.isArray(prov) ? prov[0] : prov;
    if (r0?.api_key_encrypted) {
      let tok = '';
      try { tok = Buffer.from(r0.api_key_encrypted, 'base64').toString('utf8').trim(); } catch { tok = ''; }
      if (tok.startsWith('sk-ant-oat')) {
        out[0] = 'NUKE_ANALYSIS_METHOD=byo_subscription';
        out.push(`CLAUDE_CODE_OAUTH_TOKEN=${tok}`);
      } else if (tok.startsWith('sk-ant-api')) {
        out[0] = 'NUKE_ANALYSIS_METHOD=byo_api_key';
        out.push(`ANTHROPIC_API_KEY=${tok}`);
      }
      if (r0.model_name && !row?.model && tok.startsWith('sk-ant-')) out.push(`BYOK_MODEL=${r0.model_name}`);
    }
  }

  for (const line of out) console.log(line);
}

const isMain = process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (!['prepare', 'ingest', 'context', 'queue', 'resolve'].includes(mode)) {
    console.error('mode must be "prepare", "ingest", "context", "queue", or "resolve"');
    process.exit(1);
  }
  if (mode === 'prepare') await prepare();
  else if (mode === 'context') await buildContext();
  else if (mode === 'queue') await queue();
  else if (mode === 'resolve') await resolve();
  else await ingest();
}
