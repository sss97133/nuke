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
// Ordering guard (x1<x2, y1<y2) added 2026-07-11: a degenerate/inverted box is geometry noise —
// it can't crop, can't overlay, can't project to (x,y,z) — reject it like a missing box.
const isBbox = (b) => Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === "number" && n >= 0 && n <= 999) && b[0] < b[2] && b[1] < b[3];

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

// ─── EXTRACTION LEDGER — saturation-driven passes. A pass pays only for the DELTA.
// An image is SATURATED when the agent has extracted everything gettable at the CURRENT schema
// version; a saturated image is SKIPPED (zero tokens). "Capped" facts (illegible / occluded /
// bad angle) count as best-effort-reached — they do NOT keep an image open, so we never re-burn
// tokens re-failing the unreadable. Schema growth (append a new version below with new fact-keys)
// re-opens ONLY images stamped at an older version, for just the delta → cost is a convergent series.
const SCHEMA_VERSIONS = [
  { version: 'byok_v3_camera_pose_2026-05-23',
    facts: ['scene_type', 'build_phase_guess', 'camera_pose', 'components_seen', 'text_regions',
            'damage_localized', 'state_observations', 'workshop_signals', 'presence', 'intent',
            'narrative_one_line'] },
  // v4 — geometry re-emission (audit 2026-07-11: 7/7 sampled K5 2024-10-03 frames carried wrong
  // bboxes in per-frame-inconsistent encodings; the v1→annotate→teacher loop was never wired into
  // the batch harness, so verdicts shipped as unchecked v1). The delta re-opened on v3 frames is
  // GEOMETRY (the three bbox arrays) + state_observations (same audit: paint_state='aged' template
  // bleed from a background truck onto a fresh chassis). Semantic fields are preserved at ingest
  // (--merge-mode geometry); only rehash callers re-open — the steady fleet drain never rehashes.
  { version: 'byok_v4_bbox_teacher_2026-07-11',
    facts: ['components_seen', 'text_regions', 'damage_localized', 'state_observations'] },
  // To evolve: append { version, facts:[...new keys...] }. Only images stamped at an older
  // version re-open, and only for the new keys.
];
const CURRENT_SCHEMA_VERSION = SCHEMA_VERSIONS[SCHEMA_VERSIONS.length - 1].version;

// Open-questions split two ways: RESOLVABLE-LATER (an adjacent frame / a receipt / more context
// will close them → keep the image open) vs CAPPED (nothing in THIS pixel will ever close them →
// best-effort reached, never retry).
const CAPPED_QUESTION_RE = /illegible|can'?t read|cannot read|too (blurry|dark|small|far)|occlud|out of frame|cut off|bad angle|resolution|glare|obscur|not visible|cannot make out|blurry|motion blur/i;
function classifyOpenQuestions(qs) {
  const open = [], capped = [];
  for (const q of (Array.isArray(qs) ? qs : [])) {
    (CAPPED_QUESTION_RE.test(String(q)) ? capped : open).push(q);
  }
  return { open, capped };
}

// A fingerprint of the material facts in a verdict — used to detect a DRY pass (a re-analysis
// that produced nothing new). Scene/phase + the counts of the accumulating arrays + the open-set.
function factFingerprint(d) {
  if (!d) return '';
  const n = (x) => (Array.isArray(x) ? x.length : 0);
  const oq = Array.isArray(d.open_questions) ? d.open_questions.slice().sort().join('|') : '';
  return [d.scene_type, d.build_phase_guess, n(d.components_seen), n(d.text_regions), n(d.damage_localized), oq].join('~');
}
const DRY_PASS_LIMIT = 2; // after this many fruitless re-runs, saturate even a nominally-open frame

// The saturation marker stored inside the verdict. saturated=true ⇒ zero-cost to look at again.
// The agent's OWN declaration is the per-fact truth (absence of text is a valid answer, not a gap).
// `prior` is the previously-stored byok_deep_analysis (for the dry-pass counter); null on first pass.
function computeSaturation(v, prior, nowIso) {
  const { open, capped } = classifyOpenQuestions(v?.open_questions);
  // needs_clarification is the OWNER-confirm queue's flag (the $410 intent gate) — it is
  // NOT agent-unsaturation. The sanitizer forces it true whenever intent_confidence<0.6,
  // so counting it here kept every owner-gated frame in the re-vision queue forever: the
  // model would re-read pixels it had fully extracted, waiting on a signature no re-pass
  // can produce (caught live on the 2024-10-03 closure pass: 15/15 fully-closed verdicts
  // re-queued). Saturation = "nothing more the MODEL can extract at this schema version";
  // the clarification flag rides to the confirm UI on its own lane.
  const stillOpen = v?.context_complete === false || open.length > 0;
  const priorSat = (prior && prior.saturation) || {};
  const passes = (priorSat.passes || 0) + 1;
  // Dry pass = re-analysis that yielded materially the SAME facts. If the resolving context hasn't
  // arrived, re-running gains nothing — count it dry and, at DRY_PASS_LIMIT, saturate anyway. Further
  // gain then requires an EVENT (new receipt / adjacent frame) to explicitly re-open, not a blind re-run.
  // This is what makes the OPEN bucket converge — the "gradual passes reduce token" guarantee.
  let dry = priorSat.dry_passes || 0;
  if (prior && stillOpen) dry = (factFingerprint(v) === factFingerprint(prior)) ? dry + 1 : 0;
  const saturated = !stillOpen || dry >= DRY_PASS_LIMIT;
  return {
    version: CURRENT_SCHEMA_VERSION,
    saturated,
    open_facts: saturated ? [] : open,   // resolvable-later — re-pass when more context exists
    capped,                              // best-effort reached — never re-queue for these
    passes,
    dry_passes: dry,
    resolved_at: saturated ? (nowIso || null) : null,
  };
}

// Is a row's verdict saturated at the CURRENT schema version? Used by the worklist to SKIP it.
function isSaturatedRow(r) {
  const d = (r?.ai_scan_metadata || {}).byok_deep_analysis;
  const s = d && d.saturation;
  return !!(s && s.saturated === true && s.version === CURRENT_SCHEMA_VERSION);
}

// ─── ENTITY CONFIRMATION — the reciprocal seam: receipt = CLAIM, image = CONFIRMATION.
// A verdict's components_seen are free-text labels until they LAND as component_identifications
// rows anchored to an image_analysis_records row (tier 2 = deep pass). A component whose PN
// evidence (model roster-guess or OCR'd text region) matches a receipt_items part number lands
// status='confirmed' with a citation to the receipt item — "bought AND seen", the defensible-worth
// unit. Everything else lands status='inferred'. Never forced: no PN evidence → no match.

// PN normalization: uppercase alphanumerics only; needs ≥4 chars AND a digit so pure words
// ("BOLT") never match. Comparison: exact, or containment at ≥5 chars (catches
// "ACDelco 08831PFP52" vs "08831PFP52" and OCR prefix/suffix noise).
export function normalizePartNumber(s) {
  if (typeof s !== 'string') return null;
  const n = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return n.length >= 4 && /\d/.test(n) ? n : null;
}

function pnEquals(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.length >= 5 && b.length >= 5 && (a.includes(b) || b.includes(a));
}

// Does a text region plausibly belong to a component? (TWVP bboxes, 0–999.)
// Text center inside the component box, or ≥30% of the text area overlapping it.
function bboxAttaches(textBox, compBox) {
  if (!isBbox(textBox) || !isBbox(compBox)) return false;
  const [tx1, ty1, tx2, ty2] = textBox, [cx1, cy1, cx2, cy2] = compBox;
  const cx = (tx1 + tx2) / 2, cy = (ty1 + ty2) / 2;
  if (cx >= cx1 && cx <= cx2 && cy >= cy1 && cy <= cy2) return true;
  const ox = Math.max(0, Math.min(tx2, cx2) - Math.max(tx1, cx1));
  const oy = Math.max(0, Math.min(ty2, cy2) - Math.max(ty1, cy1));
  const tArea = Math.max(1, (tx2 - tx1) * (ty2 - ty1));
  return (ox * oy) / tArea >= 0.3;
}

// Match ONE component against the receipt roster. Two bases, strongest first:
//   ocr_text          — a text region ATTACHED to this component's bbox transcribes a roster PN
//                       (the pixels literally show the part number)
//   part_number_guess — the model resolved the component to a roster PN (the prompt directs it
//                       to only use roster PNs, so a guess IS a roster claim)
export function matchComponentToRoster(comp, textRegions, rosterIndex) {
  if (!comp || !Array.isArray(rosterIndex) || rosterIndex.length === 0) return null;
  for (const tr of Array.isArray(textRegions) ? textRegions : []) {
    if (!bboxAttaches(tr?.bbox, comp?.bbox)) continue;
    const tokens = String(tr?.text || '').split(/\s+/).map(normalizePartNumber).filter(Boolean);
    const whole = normalizePartNumber(String(tr?.text || ''));
    if (whole) tokens.push(whole);
    for (const item of rosterIndex) {
      const hit = tokens.find((t) => pnEquals(t, item.pnNorm));
      // matched_token makes every confirm drillable to the exact text that matched —
      // the audit trail for the rare OCR collision (a dollar amount / order number
      // that normalizes into a roster PN).
      if (hit) return { item, basis: 'ocr_text', token: hit };
    }
  }
  const guess = normalizePartNumber(comp.part_number_guess);
  if (guess) {
    for (const item of rosterIndex) {
      if (pnEquals(guess, item.pnNorm)) return { item, basis: 'part_number_guess', token: guess };
    }
  }
  return null;
}

// Receipt-confirmed confidence bump — documented, not vibed:
//   ocr_text          → the PN is readable in the pixels: max(base, 0.95)
//   part_number_guess → model-resolved roster match: +0.2, capped 0.95 (one inference away)
export function bumpConfidence(base, basis) {
  const b = typeof base === 'number' ? base : 0.5;
  if (basis === 'ocr_text') return Math.max(b, 0.95);
  if (basis === 'part_number_guess') return Math.min(0.95, b + 0.2);
  return b;
}

// ─── RECEIPT-CONTEXT BRIDGE (day-context pass) — Skylar 2026-06-16: "contextual squares
// showing the receipt — often the extract of the group of images." The day is the context
// unit: when the SAME day (same vehicle, same taken_at UTC date) contains a receipt_document
// frame whose OCR literally transcribed a roster PN (i.e. that frame landed a component with
// match_basis='ocr_text'), the receipt items proven on-paper that day become SOFT context for
// the day's labor frames. A labor component whose label shares >=2 significant tokens with
// such an item's description lands status='day_context' (NOT 'confirmed' — the PN was never
// read in the labor pixels), confidence +0.1 capped 0.85, citing the receipt frame + item.
// "Never force", in rule form:
//   - anchor: scene_type='receipt_document' AND basis='ocr_text' only — part_number_guess
//     confirms are NOT day anchors (one inference away is too weak to radiate context);
//   - targets: intent='labor' frames on the same vehicle + same UTC date only;
//   - only components with NO roster match of their own are eligible (a real confirm is never
//     downgraded; an inferred is only softly lifted);
//   - token gate: >=2 significant description tokens (>=4 chars, positional/generic words
//     stripped). The day_context row carries NO part_number — no PN invention; the receipt
//     item id/PN live only in the citation + source_references;
//   - anchors are discovered WITHIN the landing batch: the entities day-batch path (--date)
//     bridges; single-frame ingest calls don't (cross-call bridging would need a same-day DB
//     query — deliberately out of scope for this conservative v1).
const DAY_CONTEXT_STOP_TOKENS = new Set([
  'with', 'from', 'type', 'pair', 'pack', 'left', 'right', 'front', 'rear', 'inner', 'outer',
  'upper', 'lower', 'assembly', 'replacement', 'original', 'style', 'requires', 'required',
]);
export function significantTokens(s) {
  return [...new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !DAY_CONTEXT_STOP_TOKENS.has(t)))];
}
// >=2 significant description tokens must appear in the component label → matched tokens;
// otherwise null. Descriptions with <2 significant tokens can never anchor (too thin).
export function dayContextTokenMatch(label, description) {
  const want = significantTokens(description);
  if (want.length < 2) return null;
  const have = new Set(significantTokens(label));
  const hit = want.filter((t) => have.has(t));
  return hit.length >= 2 ? hit : null;
}
// Soft lift, documented: +0.1 capped at 0.85 — deliberately below every 'confirmed' bump.
export function dayContextBump(base) {
  const b = typeof base === 'number' ? base : 0.5;
  return Math.min(0.85, b + 0.1);
}
const frameDay = (it) => (it && it.taken_at ? String(it.taken_at).slice(0, 10) : null);
// entries: [{ it, matches }] as built in landEntityPage. Returns Map `${vehicle}|${day}` →
// [{ receipt_image_id, item }] (deduped by receipt item id).
export function buildDayAnchors(entries) {
  const byDay = new Map();
  for (const e of entries) {
    if (e.it?.verdict?.scene_type !== 'receipt_document') continue;
    const day = frameDay(e.it);
    if (!day) continue;
    for (const m of e.matches || []) {
      if (m.match?.basis !== 'ocr_text') continue;
      const key = `${e.it.vehicle_id}|${day}`;
      const arr = byDay.get(key) || [];
      if (!arr.some((a) => a.item.id === m.match.item.id)) arr.push({ receipt_image_id: e.it.image_id, item: m.match.item });
      byDay.set(key, arr);
    }
  }
  return byDay;
}
// Mutates entries: sets m.dayContext on eligible components and e.dayContextKey (a stable,
// sorted anchor fingerprint — the idempotency key stored in reference_coverage_snapshot).
export function annotateDayContext(entries, anchors) {
  for (const e of entries) {
    const day = frameDay(e.it);
    if (!day || e.it?.verdict?.intent !== 'labor') continue;
    const dayAnchors = anchors.get(`${e.it.vehicle_id}|${day}`);
    if (!dayAnchors || !dayAnchors.length) continue;
    const used = new Set();
    for (const m of e.matches || []) {
      if (m.match) continue; // a real receipt confirm outranks context — never touched
      for (const a of dayAnchors) {
        const hit = dayContextTokenMatch(m.comp?.label, a.item.description);
        if (hit) {
          m.dayContext = { receipt_image_id: a.receipt_image_id, item: a.item, day, matched_tokens: hit };
          used.add(`${a.receipt_image_id}:${a.item.id}`);
          break;
        }
      }
    }
    if (used.size) e.dayContextKey = [...used].sort().join(',');
  }
}

// Coarse family for component_identifications.component_type (existing rows use snake_case
// families). Form, not fact — the verbatim label is preserved in `identification`. First hit wins.
const COMPONENT_FAMILIES = [
  ['brake', /brake|rotor|caliper|master cylinder|booster|brake drum|brake pad/i],
  ['engine', /engine|intake|throttle|damper|pulley|alternator|distributor|valve cover|header|manifold|piston|crank|camshaft|\bls[0-9]\b|\bv8\b|short block|long block|oil pan|starter|flexplate|flywheel/i],
  ['cooling', /radiator|cooling fan|water pump|thermostat|coolant|fan shroud/i],
  ['fuel', /fuel|gas tank|injector|carburetor|carb\b/i],
  ['exhaust', /exhaust|muffler|tailpipe|downpipe|catalytic/i],
  ['transmission_drivetrain', /transmission|clutch|driveshaft|transfer case|differential|axle|\bdana\b|gearbox|shifter|torque converter|u-joint/i],
  ['suspension_steering', /suspension|shock|spring|control arm|sway bar|steering|tie rod|leaf pack|coilover|spindle|ball joint/i],
  ['wheel_tire', /wheel|tire|\brim\b|hubcap|lug nut/i],
  ['electrical', /wiring|harness|battery|fuse|relay|switch|gauge|headlight|taillight|light|bulb|\becu\b|\bpdm\b|ignition coil/i],
  ['body_exterior', /fender|door|hood|tailgate|bumper|grille|quarter panel|bed side|rocker|windshield|glass|mirror|emblem|badge|body trim|paint/i],
  ['interior', /seat|dash|console|carpet|headliner|door panel|upholstery|steering wheel|seat belt/i],
  ['fastener_hardware', /bolt|nut\b|washer|screw|clamp|bracket|fastener|rivet|grommet/i],
  ['fluid_consumable', /\boil\b|fluid|grease|sealant|primer|filter/i],
];
export function componentFamily(label) {
  const s = String(label || '');
  for (const [fam, re] of COMPONENT_FAMILIES) if (re.test(s)) return fam;
  return 'unclassified';
}

// ─── ATTRIBUTION DOUBT — the verdict's reading must be OBEYED, not just stored.
// A frame whose own reading contradicts its vehicle attribution (screen material or
// acquisition reference landing on a concrete build) gets flagged structurally and
// evented for the confirm queue — never silently headlined as the vehicle.
// (Skylar 2026-07-02: a marketplace screenshot of a candidate K5 rendered as
// "1977 CHEVROLET K5 BLAZER" in the feed while its own verdict said "not obviously
// the subject K5". The reading was right; nothing acted on it.)
export function attributionDoubt(v) {
  const scene = v?.scene_type;
  if (scene === 'product_screenshot' || scene === 'spreadsheet') {
    return `scene_type=${scene} — screen material (saved listing / document), not a frame of the attributed vehicle`;
  }
  if (scene === 'cross_reference' && v?.intent === 'acquisition') {
    return 'cross_reference + acquisition — reference material for a candidate purchase, not the attributed build';
  }
  return null;
}

// The vehicle's PN-bearing receipt items (the CLAIM side), normalized for matching.
// Cached per vehicle for the life of the process — both ingest and the entities backfill reuse it.
const rosterCacheByVehicle = new Map();
async function getReceiptRoster(vehicleId) {
  if (rosterCacheByVehicle.has(vehicleId)) return rosterCacheByVehicle.get(vehicleId);
  const out = [];
  try {
    const { data, error } = await sb.from('receipt_items')
      .select('id, description, part_number, receipts!inner(vehicle_id)')
      .eq('receipts.vehicle_id', vehicleId)
      .not('part_number', 'is', null)
      .limit(500);
    if (error) throw new Error(error.message);
    for (const r of data || []) {
      const pnNorm = normalizePartNumber(r.part_number);
      if (!pnNorm) continue;
      out.push({ id: r.id, pn: r.part_number.trim(), pnNorm, description: (r.description || '').trim() });
    }
  } catch (e) { console.error(`entity roster ${vehicleId}: ${e.message}`); }
  rosterCacheByVehicle.set(vehicleId, out);
  return out;
}

const ENTITY_WRITER_NOTE = 'byok_deep_analysis entity landing';

// Land one page of verdicts' components as component_identifications rows, each frame anchored
// by ONE new image_analysis_records row. Idempotent by verdict identity: a frame whose current
// non-superseded byok record already carries this verdict's analyzed_at is skipped; a NEWER
// verdict lands fresh and CHAINS the prior record via superseded_by (never deleted — its
// component children stay attached to it as history).
async function landEntityPage(items, rosterIndex, { dryRun = false } = {}) {
  const res = { frames: 0, components: 0, confirmed: 0, day_context: 0, skipped: 0 };
  const withComponents = items.filter((it) => Array.isArray(it.verdict?.components_seen) && it.verdict.components_seen.length > 0);
  if (!withComponents.length) return res;

  // Chunked: a 400-uuid `in` list builds a ~14KB GET URL and the fetch dies at the
  // transport level (observed: TypeError fetch failed on most pages). 100 ids ≈ 4KB.
  const ids = withComponents.map((it) => it.image_id);
  const priorByImage = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const { data: priors, error: pErr } = await sb.from('image_analysis_records')
      .select('id, image_id, reference_coverage_snapshot')
      .in('image_id', ids.slice(i, i + 100))
      .is('superseded_by', null)
      .ilike('handoff_notes', `${ENTITY_WRITER_NOTE}%`)
      .order('created_at', { ascending: false });
    if (pErr) { console.error(`entity priors: ${pErr.message}`); return res; }
    // Newest-first + first-wins: if a crash between insert and supersede ever left two
    // non-superseded records for one image, the NEWEST is the live prior we chain from.
    for (const p of priors || []) if (!priorByImage.has(p.image_id)) priorByImage.set(p.image_id, p);
  }

  const now = new Date().toISOString();
  // Match every candidate frame BEFORE any skip decision: day-context anchors must be
  // discovered across the whole batch, including frames whose own landing will be skipped.
  const entries = withComponents.map((it) => ({
    it,
    prior: priorByImage.get(it.image_id) || null,
    matches: (it.verdict.components_seen || []).map((comp) => ({
      comp, match: matchComponentToRoster(comp, it.verdict.text_regions, rosterIndex),
    })),
  }));
  annotateDayContext(entries, buildDayAnchors(entries));

  const toLand = [];
  for (const e of entries) {
    const priorSnap = e.prior?.reference_coverage_snapshot;
    const sameVerdict = e.prior && priorSnap?.verdict_analyzed_at === (e.it.verdict?.analyzed_at || null);
    // An already-landed frame re-lands ONLY when a day-context anchor it has never seen
    // appears (supersede-never-overwrite: the prior record is chained, not lost). Second
    // run with the same anchors → keys equal → skip: idempotent.
    const anchorNews = !!e.dayContextKey && priorSnap?.day_context_anchor_key !== e.dayContextKey;
    if (sameVerdict && !anchorNews) { res.skipped++; continue; }
    e.supersededReason = sameVerdict && anchorNews ? 'day-context receipt anchor landed' : 'newer byok verdict landed';
    toLand.push(e);
  }
  if (!toLand.length) return res;

  res.frames = toLand.length;
  res.components = toLand.reduce((n, e) => n + e.matches.length, 0);
  res.confirmed = toLand.reduce((n, e) => n + e.matches.filter((m) => m.match).length, 0);
  res.day_context = toLand.reduce((n, e) => n + e.matches.filter((m) => !m.match && m.dayContext).length, 0);

  if (dryRun) {
    for (const { it, matches } of toLand) {
      for (const { comp, match, dayContext } of matches) {
        const tag = match ? 'CONFIRMED' : dayContext ? 'DAY-CTX  ' : 'inferred ';
        const cite = match ? ` ⇐ ${match.item.pn} (${match.basis})`
          : dayContext ? ` ⇐ same-day receipt ${String(dayContext.receipt_image_id).slice(0, 8)} ${dayContext.item.pn} [${dayContext.matched_tokens.join(',')}]` : '';
        console.log(`  DRY ${String(it.image_id).slice(0, 8)} ${tag} "${comp.label}"${cite}`);
      }
    }
    return res;
  }

  const records = toLand.map(({ it, prior, matches, dayContextKey }) => ({
    image_id: it.image_id,
    vehicle_id: it.vehicle_id,
    analysis_tier: 2,
    analyzed_at: it.verdict.analyzed_at || now,
    analyzed_by_model: it.verdict.agent_model || 'byok_claude_print',
    confirmed_findings: matches.filter((m) => m.match).map((m) => ({
      label: m.comp.label, part_number: m.match.item.pn, receipt_item_id: m.match.item.id, basis: m.match.basis })),
    inferred_findings: matches.filter((m) => !m.match).map((m) => ({
      label: m.comp.label,
      ...(m.dayContext ? { day_context: { receipt_image_id: m.dayContext.receipt_image_id, receipt_item_id: m.dayContext.item.id } } : {}),
    })),
    citation_count: matches.filter((m) => m.match).length,
    inference_count: matches.filter((m) => !m.match).length,
    overall_confidence: typeof it.verdict.confidence === 'number'
      ? Math.max(0, Math.min(1, it.verdict.confidence)) : null,
    reference_coverage_snapshot: {
      verdict_analyzed_at: it.verdict.analyzed_at || null,
      prompt_version: it.verdict.prompt_version || CURRENT_SCHEMA_VERSION,
      roster_size: rosterIndex.length,
      ...(dayContextKey ? { day_context_anchor_key: dayContextKey } : {}),
    },
    handoff_notes: `${ENTITY_WRITER_NOTE}; verdict at vehicle_images.ai_scan_metadata.byok_deep_analysis`,
    supersedes: prior?.id ?? null,
  }));
  const { data: recRows, error: rErr } = await sb.from('image_analysis_records')
    .insert(records).select('id, image_id');
  if (rErr) { console.error(`entity records insert: ${rErr.message}`); return { ...res, frames: 0, components: 0, confirmed: 0, day_context: 0 }; }
  const recByImage = new Map((recRows || []).map((r) => [r.image_id, r.id]));

  const compRows = [];
  for (const { it, matches } of toLand) {
    const recId = recByImage.get(it.image_id);
    if (!recId) continue;
    for (const { comp, match, dayContext } of matches) {
      const dc = !match && dayContext ? dayContext : null;
      compRows.push({
        analysis_record_id: recId,
        image_id: it.image_id,
        vehicle_id: it.vehicle_id,
        component_type: componentFamily(comp.label),
        identification: comp.label,
        // day_context carries NO part_number — the PN was never read in THESE pixels
        // (no PN invention; the receipt item's PN lives in the citation only).
        part_number: match ? match.item.pn : null,
        status: match ? 'confirmed' : dc ? 'day_context' : 'inferred',
        // Clamped: legacy pre-gate verdicts can carry out-of-range confidence; the DB
        // CHECK (0–1) would reject the whole insert chunk over one bad value.
        confidence: Math.max(0, Math.min(1, Math.round(
          (dc ? dayContextBump(comp.confidence) : bumpConfidence(comp.confidence, match?.basis)) * 100) / 100)),
        inference_method: match ? `byok_vision+receipt_pn_${match.basis}` : dc ? 'byok_vision+day_context_receipt' : 'byok_vision',
        citation_text: match ? `Receipt item ${match.item.id}: ${match.item.pn} — ${match.item.description}`
          : dc ? `Day-context ${dc.day}: same-day receipt frame ${dc.receipt_image_id} OCR-matched receipt item ${dc.item.id}: ${dc.item.pn} — ${dc.item.description}; label shares tokens [${dc.matched_tokens.join(', ')}]`
          : null,
        bounding_box: isBbox(comp.bbox) ? { x1: comp.bbox[0], y1: comp.bbox[1], x2: comp.bbox[2], y2: comp.bbox[3], scale: 999 } : null,
        source_references: {
          writer: 'byok_deep_analysis',
          image_id: it.image_id,
          observation_id: it.observation_id ?? null,
          verdict_path: 'vehicle_images.ai_scan_metadata.byok_deep_analysis',
          part_number_guess: comp.part_number_guess ?? null,
          // A confirm on a receipt_document frame links the PAPER trail (invoice photographed);
          // a confirm on a physical scene is the part itself seen. Downstream must not conflate.
          scene_type: it.verdict.scene_type ?? null,
          ...(match ? { receipt_item_id: match.item.id, match_basis: match.basis, matched_token: match.token ?? null } : {}),
          ...(dc ? { day_context: { receipt_image_id: dc.receipt_image_id, receipt_item_id: dc.item.id, matched_tokens: dc.matched_tokens, day: dc.day } } : {}),
        },
      });
    }
  }
  for (let i = 0; i < compRows.length; i += 500) {
    const { error } = await sb.from('component_identifications').insert(compRows.slice(i, i + 500));
    if (error) { console.error(`entity components insert: ${error.message}`); return { ...res, components: i, confirmed: 0, day_context: 0 }; }
  }

  for (const { it, prior, supersededReason } of toLand) {
    if (!prior) continue;
    const recId = recByImage.get(it.image_id);
    if (!recId) continue;
    const { error } = await sb.from('image_analysis_records')
      .update({ superseded_by: recId, superseded_at: now, superseded_reason: supersededReason || 'newer byok verdict landed' })
      .eq('id', prior.id);
    if (error) console.error(`  (non-fatal) entity supersede ${prior.id}: ${error.message}`);
  }
  return res;
}

// entities — backfill the entity layer from ALREADY-LANDED verdicts (no vision cost: the
// 11k+ component claims sitting in ai_scan_metadata become queryable identification rows).
//   node scripts/deep-image-analysis-byok.mjs entities --vehicle-id <id> [--limit N] [--date YYYY-MM-DD] [--dry-run]
// --date scopes to one UTC day AND makes that day land as one batch — required for the
// day-context pass to see a receipt anchor and its labor frames together (pages are
// otherwise id-ordered, which scatters a day across batches).
async function entities() {
  const VEHICLE_ID = arg('--vehicle-id');
  const LIMIT = parseInt(arg('--limit', '0')) || Infinity;
  const DATE = arg('--date');
  const DRY = args.includes('--dry-run');
  if (!VEHICLE_ID) { console.error('entities: --vehicle-id required'); process.exit(1); }
  if (DATE && !/^\d{4}-\d{2}-\d{2}$/.test(DATE)) { console.error('entities: --date must be YYYY-MM-DD'); process.exit(1); }
  const roster = await getReceiptRoster(VEHICLE_ID);
  console.log(`entities: roster ${roster.length} PN-bearing receipt items for ${VEHICLE_ID}${DATE ? ` day ${DATE}` : ''}${DRY ? ' (DRY RUN)' : ''}`);
  const PAGE = 400;
  const totals = { frames: 0, components: 0, confirmed: 0, day_context: 0, skipped: 0 };
  let processed = 0;
  for (let offset = 0; processed < LIMIT; offset += PAGE) {
    let q = sb.from('vehicle_images')
      .select('id, vehicle_id, taken_at, ai_scan_metadata')
      .eq('vehicle_id', VEHICLE_ID)
      // Duplicates carry verdicts too (analyzed before being marked) — landing their
      // components would double-count every part on the day.
      .not('is_duplicate', 'is', true)
      .not('is_superseded', 'is', true)
      .not('ai_scan_metadata->byok_deep_analysis', 'is', null);
    if (DATE) {
      const next = new Date(Date.parse(`${DATE}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
      q = q.gte('taken_at', DATE).lt('taken_at', next);
    }
    const { data, error } = await q.order('id', { ascending: true }).range(offset, offset + PAGE - 1);
    if (error) { console.error(`entities: ${error.message}`); process.exit(1); }
    if (!data || !data.length) break;
    const items = data
      .map((r) => ({ image_id: r.id, vehicle_id: r.vehicle_id, taken_at: r.taken_at, verdict: r.ai_scan_metadata?.byok_deep_analysis }))
      .filter((it) => Array.isArray(it.verdict?.components_seen) && it.verdict.components_seen.length > 0)
      .slice(0, Math.max(0, LIMIT - processed));
    processed += items.length;
    const r = await landEntityPage(items, roster, { dryRun: DRY });
    for (const k of Object.keys(totals)) totals[k] += r[k];
    console.log(`entities: page@${offset} → frames ${r.frames}, components ${r.components}, confirmed ${r.confirmed}, day-context ${r.day_context}, skipped ${r.skipped}`);
    if (data.length < PAGE) break;
    await new Promise((s) => setTimeout(s, 100)); // breathe between pages (db-safety)
  }
  console.log(`entities: TOTAL frames ${totals.frames}, components ${totals.components}, receipt-CONFIRMED ${totals.confirmed}, day-CONTEXT ${totals.day_context}, already-landed skipped ${totals.skipped}`);
}

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
      .select('id, user_id, image_url, file_name, taken_at, created_at, source, ai_scan_metadata, apple_ml_labels, latitude, longitude, location_name, exif_data, stale')
      .eq('vehicle_id', VEHICLE_ID)
      // Match the GALLERY whitelist (null OR approved), not just approved. The vision gate
      // stalled and left ~12k frames at null/pending — null-gate frames are SHOWN in the
      // gallery but were never analyzed (browse → image with no data). Analyze what the
      // gallery displays. Explicit rejects (rejected_personal/misattributed) stay excluded.
      .or('vision_gate_status.is.null,vision_gate_status.eq.approved')
      // Duplicate/superseded rows never enter the worklist: the same capture moment was
      // re-ingested by up to 4 library sweeps as different exports (see migration
      // 20260711210000_cross_sweep_moment_duplicates) — analyzing them re-reads the same
      // pixels. The keeper row carries the moment; the coverage RPCs exclude these too.
      .not('is_duplicate', 'is', true)
      .not('is_superseded', 'is', true)
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

  // Two queues, saturation-driven (the extraction ledger):
  //   default  → frames with NO verdict yet (first pass).
  //   --rehash → frames that HAVE a verdict but are NOT saturated at the CURRENT schema version.
  //              That means resolvable-open facts (more context now exists) OR an older schema
  //              version (a new fact-key was added → extract just the delta). A SATURATED verdict
  //              — including one whose only gaps are CAPPED (illegible/occluded) — is skipped and
  //              costs zero. This kills the old bug where any open question re-failed forever.
  const REHASH = args.includes('--rehash');
  let pendingAll = REHASH
    ? all.filter((r) => ((r.ai_scan_metadata || {}).byok_deep_analysis) && !isSaturatedRow(r))
    : all.filter((r) => !((r.ai_scan_metadata || {}).byok_deep_analysis));

  // --date YYYY-MM-DD: target ONE specific day (resolution passes re-run a chosen day
  // with enriched context instead of whatever day sorts earliest). Composes with
  // --rehash: "re-open this day's unsaturated frames" is the closure-pass shape.
  const DATE = arg('--date');
  if (DATE) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE)) { console.error('prepare: --date must be YYYY-MM-DD'); process.exit(1); }
    pendingAll = pendingAll.filter((r) => dayOf(r) === DATE);
  }

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
  // Rehash worklists carry the PRIOR verdict's semantic reading: the closure pass sees what
  // it already established, and the geometry re-emission pass (BYOK_GEOMETRY=1) gets the exact
  // element roster to re-localize — labels/PNs/texts verbatim, only the boxes re-drawn.
  const priorOf = (r) => {
    const d = (r.ai_scan_metadata || {}).byok_deep_analysis;
    if (!d) return null;
    return {
      scene_type: d.scene_type ?? null,
      narrative: d.narrative_one_line ?? null,
      components: (d.components_seen || []).map((c) => ({ label: c.label, pn: c.part_number_guess ?? null })),
      text_regions: (d.text_regions || []).map((t) => ({ text: t.text, confidence: t.confidence ?? null })),
      damage: (d.damage_localized || []).map((x) => ({ label: x.label, severity: x.severity ?? null })),
      state_observations: d.state_observations || {},
      open_questions: d.open_questions || [],
    };
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
      // T0 prior: the FREE on-device Apple Vision tags already computed at capture. Noisy hints
      // (a truck can read as "airplane"), NEVER truth — the detective uses them to orient/confirm
      // or override. This is the cheap foundation layer feeding the expensive pass.
      apple_hints: Array.isArray(r.apple_ml_labels) ? r.apple_ml_labels.slice(0, 12) : [],
      ...(REHASH ? { prior: priorOf(r) } : {}),
    }),
  );
  writeFileSync(WORKLIST, lines.join('\n') + '\n');
  // Live feed: these frames are now in flight — emit an 'analyzing' stage per frame so
  // the pipeline visualizer (analysis_events → get_pipeline_events) shows the journey as
  // it happens, not after. Guarded: telemetry must never block the drain.
  try {
    const analyzingEvents = pending.map((r) => ({
      user_id: r.user_id ?? null,
      vehicle_id: VEHICLE_ID,
      image_id: r.id,
      stage: 'analyzing',
      detail: { day: dayOf(r), source: r.source ?? null },
    }));
    if (analyzingEvents.length) {
      const { error: aerr } = await sb.from('analysis_events').insert(analyzingEvents);
      if (aerr) console.error(`  (non-fatal) analysis_events analyzing insert: ${aerr.message}`);
    }
  } catch (e) { console.error(`  (non-fatal) analyzing emit: ${e.message}`); }
  if (chosenDay) {
    writeFileSync(`${WORKLIST}.date`, chosenDay + '\n');
    const remaining = (pendingAll.filter((r) => dayOf(r) === chosenDay).length) - pending.length;
    console.log(`prepare: DAY ${chosenDay} — ${pending.length} of this day's frames → ${WORKLIST} (${remaining} more frames left in this day)`);
  } else {
    console.log(`prepare: ${pending.length} rows → ${WORKLIST}`);
  }
  console.log(`         pool total = ${all.length}, pending = ${all.length - pending.length} not in this batch`);
}

// GEOMETRY MERGE (--merge-mode geometry) — the v4 re-emission contract: the incoming line is a
// PARTIAL verdict carrying only re-localized geometry ({image_id, components_seen, text_regions,
// damage_localized, state_observations, geometry_notes}) and the stored prior verdict supplies
// every semantic field unchanged. Semantic labels/PNs were pixel-honest in the audit — only the
// boxes (and the subject-vs-background state read) re-open. The merged object then flows through
// the NORMAL landing path: full validation, supersession chain, entity re-landing, saturation.
function mergeGeometry(nv, prior) {
  const note = `geometry re-emission ${CURRENT_SCHEMA_VERSION}${nv.geometry_notes ? ` — ${nv.geometry_notes}` : ''}`;
  return {
    image_id: nv.image_id,
    vehicle_id: nv.vehicle_id,
    taken_at: nv.taken_at,
    created_at: nv.created_at,
    scene_type: prior.scene_type,
    build_phase_guess: prior.build_phase_guess,
    intent: prior.intent,
    intent_confidence: prior.intent_confidence,
    needs_clarification: prior.needs_clarification ?? false,
    needs_review: prior.needs_review ?? false,
    camera_pose: prior.camera_pose,
    components_seen: nv.components_seen ?? [],
    text_regions: nv.text_regions ?? [],
    damage_localized: nv.damage_localized ?? [],
    state_observations: nv.state_observations ?? prior.state_observations ?? {},
    workshop_signals: prior.workshop_signals ?? {},
    presence: prior.presence ?? {},
    narrative_one_line: prior.narrative_one_line,
    confidence: prior.confidence,
    context_complete: prior.context_complete ?? null,
    open_questions: prior.open_questions ?? [],
    agent_notes: [prior.agent_notes, note].filter(Boolean).join(' | '),
    provenance: nv.provenance, // the re-emission run's source DNA, not the prior's
  };
}

async function ingest() {
  const SINK = arg('--sink');
  const MERGE_MODE = arg('--merge-mode'); // 'geometry' → partial verdicts merged over the prior
  if (!SINK || !existsSync(SINK)) {
    console.error('ingest: --sink required and file must exist');
    process.exit(1);
  }
  if (MERGE_MODE && MERGE_MODE !== 'geometry') {
    console.error(`ingest: unknown --merge-mode ${MERGE_MODE} (only 'geometry')`);
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
  const landedEvents = []; // live pipeline feed (analysis_events) — collected, inserted once, guarded

  for (const line of lines) {
    let v;
    try { v = JSON.parse(line); } catch { failed++; continue; }
    if (!v.image_id || !v.vehicle_id) { failed++; continue; }

    // Fetched BEFORE validation: geometry mode needs the prior verdict to build the
    // full object the validator judges.
    const { data: imgRow } = await sb
      .from('vehicle_images')
      .select('ai_scan_metadata, user_id')
      .eq('id', v.image_id)
      .maybeSingle();
    const existingMeta = (imgRow?.ai_scan_metadata) || {};

    if (MERGE_MODE === 'geometry') {
      const prior = existingMeta.byok_deep_analysis;
      if (!prior) {
        console.error(`  REJECT ${String(v.image_id).slice(0,8)}: geometry merge but no prior verdict — run a full pass instead`);
        failed++;
        continue;
      }
      v = mergeGeometry(v, prior);
    }

    // Schema-as-DNA gate: reject non-conforming verdicts before they can land.
    const verdictErrs = validateVerdict(v);
    if (verdictErrs.length) {
      console.error(`  REJECT ${String(v.image_id).slice(0,8)}: ${verdictErrs.join("; ")}`);
      failed++;
      continue;
    }
    const sat = computeSaturation(v, existingMeta.byok_deep_analysis || null, now);
    // Doubt gate: a reading that contradicts the attribution forces the clarification
    // flag (the app's doubt UI reads it) and lands an attribution_doubt event below.
    const doubt = attributionDoubt(v);
    if (doubt) v.needs_clarification = true;
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
        attribution_doubt: doubt,
        context_complete: v.context_complete ?? null,
        open_questions: v.open_questions ?? [],
        agent_notes: v.agent_notes ?? null,
        analyzed_at: now,
        prompt_version: CURRENT_SCHEMA_VERSION,
        saturation: sat,
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

    // Saturation model (replaces the crude "any open question ⇒ stale" that re-failed the
    // unreadable on every rehash): re-queue ONLY when there are RESOLVABLE-LATER open facts.
    // A verdict whose only gaps are CAPPED (illegible/occluded) is saturated → stale=false →
    // never re-queued. Schema growth re-opens it via the version check in prepare, not via stale.
    const { error: upErr } = await sb
      .from('vehicle_images')
      .update({ ai_scan_metadata: updatedMeta, stale: !sat.saturated, last_rerun_at: now, vision_model_version: v.provenance?.agent_model ?? 'byok_v3_opus48' })
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

    // ENTITY LANDING — the reciprocal-confirmation seam made queryable: this verdict's
    // components land as component_identifications rows (receipt-PN matches → 'confirmed').
    // Non-fatal: an entity-landing failure never blocks the verdict itself.
    try {
      if (Array.isArray(v.components_seen) && v.components_seen.length) {
        const landed = await landEntityPage(
          [{ image_id: v.image_id, vehicle_id: v.vehicle_id, observation_id: obsRow.id, taken_at: v.taken_at || null, verdict: updatedMeta.byok_deep_analysis }],
          await getReceiptRoster(v.vehicle_id));
        if (landed.components) console.log(`  entities: ${landed.components} components landed (${landed.confirmed} receipt-confirmed)`);
      }
    } catch (e) { console.error(`  (non-fatal) entity landing ${v.image_id}: ${e.message}`); }

    // Doubt event: the confirm queue's worklist entry, carrying the evidence.
    if (doubt) {
      landedEvents.push({
        user_id: imgRow?.user_id ?? null,
        vehicle_id: v.vehicle_id,
        image_id: v.image_id,
        stage: 'attribution_doubt',
        detail: { reason: doubt, scene_type: v.scene_type ?? null, intent: v.intent ?? null,
                  narrative: v.narrative_one_line ?? null },
      });
    }

    wrote++;
    // Live feed: this frame's verdict just landed — the "money hitting the account"
    // moment. Record it for the pipeline visualizer (analysis_events).
    landedEvents.push({
      user_id: imgRow?.user_id ?? null,
      vehicle_id: v.vehicle_id,
      image_id: v.image_id,
      stage: 'verdict_landed',
      detail: {
        scene_type: v.scene_type ?? null,
        build_phase: v.build_phase_guess ?? null,
        narrative: v.narrative_one_line ?? null,
        component_count: Array.isArray(v.components_seen) ? v.components_seen.length : 0,
        ocr_count: Array.isArray(v.text_regions) ? v.text_regions.length : 0,
        confidence: v.confidence ?? null,
      },
    });
  }

  // One guarded batch insert of the landed events — telemetry, never fatal to ingest.
  if (landedEvents.length) {
    const { error: evErr } = await sb.from('analysis_events').insert(landedEvents);
    if (evErr) console.error(`  (non-fatal) analysis_events insert: ${evErr.message}`);
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
        { headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY }, signal: AbortSignal.timeout(50000) });
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

  // RESOLVED LOCATION ENTITIES — known_places is the CURATED resolver substrate
  // (name + GPS + radius, optionally bridged to an organizations row via
  // metadata.organization_id). These are answers, not hints: a frame whose GPS falls
  // inside a radius IS at that place — the detective must use the canonical name and
  // never open a "where is this?" question the legend already closes.
  let knownPlaces = [];
  try {
    const { data: kps } = await sb.from('known_places')
      .select('name, place_type, latitude, longitude, radius_m, address, metadata');
    if (kps && kps.length) {
      const orgIds = kps.map((p) => p.metadata?.organization_id).filter(Boolean);
      const orgById = new Map();
      if (orgIds.length) {
        const { data: orgs } = await sb.from('organizations')
          .select('id, name, business_type').in('id', orgIds);
        for (const o of (orgs || [])) orgById.set(o.id, o);
      }
      knownPlaces = kps.map((p) => {
        const org = orgById.get(p.metadata?.organization_id);
        return {
          name: p.name, type: p.place_type,
          lat: Number(p.latitude), lon: Number(p.longitude), radius_m: Number(p.radius_m),
          address: p.address || null,
          org: org ? `${org.name}${org.business_type ? ` (${org.business_type})` : ''}` : null,
        };
      });
    }
  } catch { /* optional — legend falls back to GPS clusters below */ }

  // LOCATION LEGEND (fallback) — GPS clusters → most-seen location_name. Covers
  // coordinates OUTSIDE every known_places radius.
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

  // ROSTER — the vehicle's KNOWN PARTS from receipts (the CLAIM side). The detective
  // confirms components against THIS list instead of authoring them open-ended, and
  // resolves part_number_guess to a real receipt PN when a component matches. This is
  // the reciprocal-confirmation seam: receipt = claim, image = confirmation. Honesty
  // guard is in the prompt block below — never force a match, an as-found/old part is
  // NOT the new rostered part.
  let roster = [];
  try {
    const { data } = await sb.from('receipt_items')
      .select('description, part_number, category, receipts!inner(vehicle_id)')
      .eq('receipts.vehicle_id', VEHICLE_ID)
      .not('part_number', 'is', null)
      .limit(400);
    if (data && data.length) {
      const seen = new Set();
      for (const r of data) {
        const pn = (r.part_number || '').trim();
        if (!pn || pn.toLowerCase() === 'null' || seen.has(pn)) continue;
        seen.add(pn);
        roster.push({ cat: r.category || 'other', desc: (r.description || '').trim(), pn });
      }
      roster.sort((a, b) => a.cat.localeCompare(b.cat) || a.desc.localeCompare(b.desc));
    }
  } catch { /* optional — a vehicle with no receipts just gets no roster */ }

  // USER GARAGE — the owner's OWNED builds, via get_user_garage (ownership relations), NOT image
  // authorship. The user photographs the whole shop (Viva lot, shows), so keying off vehicle_images.
  // user_id pulls 100+ non-owned cars and would POISON attribution. Ownership is the right roster.
  // A capture/library frame may show any owned build, a bench part, or an off-subject/shop car;
  // injecting the owned garage cures the "this is NOT the subject Mustang" negation failure — the
  // detective ATTRIBUTES the frame to the right build, or flags it off-roster.
  let garage = [];
  try {
    const { data: owner } = await sb.from('vehicle_images')
      .select('user_id').eq('vehicle_id', VEHICLE_ID).not('user_id', 'is', null).limit(1).maybeSingle();
    if (owner?.user_id) {
      const { data: g } = await sb.rpc('get_user_garage', { p_user_id: owner.user_id });
      if (g?.length) {
        const ids = g.map((r) => r.vehicle_id).filter(Boolean);
        const colorById = new Map();
        if (ids.length) {
          const { data: cols } = await sb.from('vehicles').select('id, color').in('id', ids);
          for (const c of (cols || [])) colorById.set(c.id, c.color || null);
        }
        const seen = new Map();
        for (const r of g) {
          if (!r.vehicle_id || seen.has(r.vehicle_id)) continue;
          seen.set(r.vehicle_id, {
            label: `${r.year || ''} ${r.make || ''} ${r.model || ''}${r.trim_name ? ' ' + r.trim_name : ''}`.replace(/\s+/g, ' ').trim(),
            color: colorById.get(r.vehicle_id) || null,
            rel: r.relationship || 'owner',
            subject: r.vehicle_id === VEHICLE_ID });
        }
        garage = [...seen.values()].sort((a, b) => (b.subject ? 1 : 0) - (a.subject ? 1 : 0));
      }
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
  if (knownPlaces.length) {
    lines.push(`\n**RESOLVED LOCATION ENTITIES (known_places — canonical, use these names verbatim):**`);
    for (const p of knownPlaces) {
      lines.push(`- ${p.lat.toFixed(5)},${p.lon.toFixed(5)} r=${p.radius_m}m → **${p.name}** (${p.type})${p.org ? ` — org: ${p.org}` : ''}${p.address ? ` — ${p.address}` : ''}`);
    }
    lines.push(`A frame whose GPS falls within a radius above IS at that place. Set \`presence.place_hint\` to the canonical name EXACTLY as written (no suffixes like "(lot)" or "(workbench)" — put sub-location detail in agent_notes). NEVER emit an open question asking to identify a location this legend resolves; an address is never an answer when the entity is known.`);
  }
  if (locLegend.length) {
    lines.push(`\n**Location legend (GPS cluster fallback — for coordinates outside every radius above):**`);
    for (const l of locLegend) lines.push(`- ${l}`);
    lines.push(`Each frame below carries its GPS — resolve it against the entities first, then this fallback. A frame shot away from the main shop is off_property work (and tells you WHO/WHERE: e.g. upholstery shop, a vendor, the owner's dad's lot).`);
  }
  lines.push(`\n**RESOLVE, DON'T PUNT:** before writing any \`open_questions\` entry, check whether THIS briefing (location entities, parts roster, timeline, the day's other frames) already answers it. A question the briefing answers gets CLOSED — state the answer in the verdict (agent_notes with its citation), don't re-ask it. Only two kinds of question may survive: pixel-capped (illegible/occluded — say so) and genuinely graph-dry (say what you'd need). An owner-signature item (labor value / intent confirmation) is \`needs_clarification\`, not an open question.`);
  if (lifecycle) lines.push(`\n**Already deep-analyzed (day:phases):** ${lifecycle}`);
  if (roster.length) {
    lines.push(`\n**KNOWN PARTS ON THIS BUILD — ${roster.length} parts bought for it (from receipts, the CLAIM side).**`);
    lines.push(`This is the roster to CONFIRM against. When a component in the frame matches one of these, set that component's \`part_number_guess\` to the exact PN listed here, and note the confirmation in \`agent_notes\`. Two hard rules: (1) NEVER invent a part number that isn't on this list — a component with no roster match keeps \`part_number_guess: null\`. (2) NEVER force a match — an as-found, rusty, or old part is NOT the new rostered part; lifecycle matters. A rostered part not yet installed in this frame is a future install, not a confirmation. Honest non-confirmation is correct; a false PN is a failure.`);
    let curCat = '';
    for (const r of roster) {
      if (r.cat !== curCat) { curCat = r.cat; lines.push(`  · _${curCat}_`); }
      lines.push(`    - ${r.desc} — \`${r.pn}\``);
    }
  }
  if (garage.length > 1) {
    lines.push(`\n**THE OWNER'S GARAGE — ${garage.length} vehicles. A frame from this owner's library may show ANY of these, a bench part, or an off-subject car (a friend's, a car at a show) — do NOT assume it is the subject vehicle. ATTRIBUTE the frame to the right vehicle by visual evidence (body style, color, badges, interior, engine family) cross-checked with GPS + the EXIF capture date. Naming WHICH garage vehicle a frame belongs to is the high-value output; negating against the subject ("this is not the Mustang") is a wasted verdict. If a frame is a bench part or off-subject, say so plainly. When unsure between two of the owner's vehicles, name both as candidates with your reasoning — never force one.**`);
    for (const v of garage) {
      lines.push(`    - ${v.label}${v.color ? ` · ${v.color}` : ''} · ${v.rel}${v.subject ? '  ◀── the subject vehicle this drain is keyed to' : ''}`);
    }
  }
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
  // Pass 1: all eligible frames per vehicle (gallery whitelist: null OR approved — see
  // prepare()). Pass 2: the subset already analyzed.
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb
      .from('vehicle_images')
      .select('vehicle_id')
      .eq('user_id', VEHICLE_USER)
      .or('vision_gate_status.is.null,vision_gate_status.eq.approved')
      .not('is_duplicate', 'is', true)
      .not('is_superseded', 'is', true)
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
      .or('vision_gate_status.is.null,vision_gate_status.eq.approved')
      .not('is_duplicate', 'is', true)
      .not('is_superseded', 'is', true)
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

// Pure ledger functions exported for unit tests (importing does not run the pipeline — see isMain).
export { computeSaturation, classifyOpenQuestions, factFingerprint, isSaturatedRow, mergeGeometry, CURRENT_SCHEMA_VERSION, DRY_PASS_LIMIT };

const isMain = process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (!['prepare', 'ingest', 'context', 'queue', 'resolve', 'entities'].includes(mode)) {
    console.error('mode must be "prepare", "ingest", "context", "queue", "resolve", or "entities"');
    process.exit(1);
  }
  if (mode === 'prepare') await prepare();
  else if (mode === 'context') await buildContext();
  else if (mode === 'queue') await queue();
  else if (mode === 'resolve') await resolve();
  else if (mode === 'entities') await entities();
  else await ingest();
}
