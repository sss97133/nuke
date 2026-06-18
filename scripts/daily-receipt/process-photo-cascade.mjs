#!/usr/bin/env node
/**
 * process-photo-cascade.mjs — next-gen per-photo writer that emits THE FULL CASCADE.
 *
 * Where the original `process-photo.mjs` writes 2 atoms per photo (vehicle_images row +
 * vehicle_observation atom), this writer emits up to 6 atom types per photo, populating
 * 5 entity profiles in parallel:
 *
 *   1. vehicle_images row (same as v1)
 *   2. vehicle_observation atom via ingest-observation (same as v1)
 *   3. technician_work_evidence atom (NEW — requires technicians table from migration 20260523080100)
 *   4. equipment_usage_evidence atom (NEW — requires equipment table from migration 20260523080200)
 *   5. consumable_usage_evidence atom — PRESENCE testimony (NEW — consumables + consumable_usage_evidence, migration 20260617093000)
 *   6. parts_observed entry in vehicle_images.ai_scan_metadata (NEW — feeds parts_catalog later)
 *
 * REQUIRES the cascade migrations (20260523080100, 20260523080200) to be applied.
 * Falls back gracefully — if a table is missing, that cascade arm is skipped + logged.
 *
 * Per docs/library/reference/encyclopedia/05-image-as-butterfly-node.md, a single photo
 * has 20+ epistemological consequences. This writer covers the top 6. Future agents
 * can extend to the remaining 14 (vendor_observed, person_present, weather, etc.).
 *
 * Usage:
 *   dotenvx run -- node scripts/daily-receipt/process-photo-cascade.mjs \
 *     --photo /tmp/path/to.jpg \
 *     --vehicle-id <uuid> \
 *     --taken-at 2026-04-14T12:09:33+00:00 \
 *     --source-identifier iphone:IMG_xxxx.HEIC \
 *     --classification-file /tmp/classifications/IMG_xxxx.json
 *
 * Classification JSON shape (EXTENDED from v1):
 *   {
 *     // === v1 fields (still required) ===
 *     "scene_class": "engine_bay",
 *     "area": "engine",
 *     "action": "wiring_install_or_trace",
 *     "parts_visible": ["chrome MUSTANG valve cover", "aftermarket ignition module"],
 *     "fabrication_stage": "wiring",
 *     "caption": "Hand on Mustang valve cover routing red/black power wire",
 *     "confidence": 0.9,
 *
 *     // === cascade fields (NEW, optional — each unlocks an additional atom) ===
 *     "person_visible": {
 *       "technician_id": "<uuid>",   // or null if unknown; resolved by name lookup
 *       "name": "Skylar Williams",
 *       "specialty_inferred": "wiring",
 *       "tier_signal": "master",      // "apprentice" | "journeyman" | "master"
 *       "duration_minutes_estimated": 30
 *     },
 *     "tools_visible": [
 *       { "equipment_id": "<uuid>", "name": "Wire crimper - generic", "use_context": "in_hand" },
 *       { "equipment_id": null, "name": "Yellow two-post lift", "use_context": "vehicle_mounted" }
 *     ],
 *     "ppe_visible": ["nitrile_gloves_purple"],
 *     // consumable_id null is fine — resolve_consumable(name) folds the observed material
 *     // onto a seeded consumable. We record PRESENCE, not a fabricated consumed quantity.
 *     "consumables_used": [
 *       { "consumable_id": null, "name": "masking tape", "use_context": "in_use" }
 *     ]
 *   }
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { basename } from 'path';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) { console.error('Missing env'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, KEY);

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : null; };
const flag = (n) => args.includes(n);

const PHOTO = arg('--photo');
const VEHICLE_ID = arg('--vehicle-id');
const TAKEN_AT = arg('--taken-at');
const SOURCE_ID = arg('--source-identifier') || (PHOTO ? `local:${basename(PHOTO)}` : null);
const CLASSIFICATION_FILE = arg('--classification-file');
const DRY_RUN = flag('--dry-run');
const VERBOSE = flag('--verbose');

if (!PHOTO || !VEHICLE_ID || !TAKEN_AT || !CLASSIFICATION_FILE) {
  console.error('Required: --photo --vehicle-id --taken-at --classification-file');
  process.exit(1);
}

const classification = JSON.parse(readFileSync(CLASSIFICATION_FILE, 'utf-8'));
const USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4'; // Skylar

// ─── Normalize v1 + DEEP (byok-vision-prompt) verdict shapes, derive geometric fields ───
// v1:   scene_class / parts_visible / action / caption / fabrication_stage
// deep: scene_type / components_seen[{label,bbox}] / build_phase_guess / narrative_one_line
//       / camera_pose / state_observations / damage_localized / vehicle_zone
const C = classification;
const sceneType   = C.scene_type || C.scene_class || null;
const caption     = C.narrative_one_line || C.caption || null;
const stage       = C.build_phase_guess || C.fabrication_stage || null;
const operation   = C.action || C.intent || null;
const components  = Array.isArray(C.components_seen) ? C.components_seen : null;
const partsArr    = components ? components.map(c => c.label).filter(Boolean)
                  : (Array.isArray(C.parts_visible) ? C.parts_visible : []);
const SCENE_TO_ZONE = { engine_bay:'engine_bay', body_interior:'interior', undercarriage:'ext_undercarriage',
  wheel_assembly:'wheel', paint_booth:'body', body_exterior:'ext_unknown', fabrication_in_progress:'detail',
  data_plate:'detail_badge', receipt_document:'document' };
const vehicleZone = C.vehicle_zone || SCENE_TO_ZONE[sceneType] || null;
const damageFlags = Array.isArray(C.damage_localized) ? C.damage_localized.map(d => d.label).filter(Boolean) : null;
const st = C.state_observations || {};
const conditionScore = st.rust_severity ? ({none:95,surface:80,pitting:60,perforation:35,unknown:null}[st.rust_severity]) : null;
// Vehicle frame bbox = union of component bboxes = the visible extent of the vehicle (the "visible area").
let vehicleBbox = null;
if (components && components.some(c => Array.isArray(c.bbox))) {
  const bs = components.filter(c => Array.isArray(c.bbox)).map(c => c.bbox);
  vehicleBbox = { x1: Math.min(...bs.map(b=>b[0])), y1: Math.min(...bs.map(b=>b[1])),
                  x2: Math.max(...bs.map(b=>b[2])), y2: Math.max(...bs.map(b=>b[3])), norm:'0-999', frame:'as_shown' };
}

const fileBuf = readFileSync(PHOTO);
const sha = createHash('sha256').update(fileBuf).digest('hex');

// Track cascade arm outcomes
const cascade = { vehicle_image: null, observation: null, tech_evidence: null, equip_evidence: [], consumables: [] };
const errors = [];

// ─── Helper: idempotent table-existence probe ────────────────────────
async function tableExists(table) {
  const { error } = await supabase.from(table).select('id', { head: true, count: 'exact' }).limit(1);
  return !error || !/relation .* does not exist/i.test(error.message || '');
}

// ─── ARM 1+2: vehicle_images row + ingest-observation atom (same as v1) ───
async function armVehicleImageAndObservation() {
  const { data: existing } = await supabase
    .from('vehicle_images')
    .select('id, image_url')
    .eq('vehicle_id', VEHICLE_ID)
    .eq('file_hash', sha)
    .limit(1);

  let imageId, imageUrl;
  if (existing && existing.length > 0) {
    imageId = existing[0].id;
    imageUrl = existing[0].image_url;
    if (VERBOSE) console.log(`[dedup] vehicle_image ${imageId}`);
  } else {
    const ext = PHOTO.split('.').pop().toLowerCase();
    const mime = (ext === 'png') ? 'image/png' : 'image/jpeg';
    const storagePath = `${VEHICLE_ID}/daily-receipt/${sha.slice(0, 12)}_${basename(PHOTO)}`;

    if (!DRY_RUN) {
      const up = await supabase.storage.from('vehicle-photos').upload(storagePath, fileBuf, { contentType: mime, upsert: true });
      if (up.error) { errors.push(`upload: ${up.error.message}`); return; }
    }
    imageUrl = supabase.storage.from('vehicle-photos').getPublicUrl(storagePath).data.publicUrl;

    const row = {
      vehicle_id: VEHICLE_ID,
      image_url: imageUrl,
      storage_path: storagePath,
      file_name: basename(PHOTO),
      file_hash: sha,
      file_size: statSync(PHOTO).size,
      mime_type: mime,
      source: 'daily_receipt_cascade',
      taken_at: TAKEN_AT,
      is_external: false,
      ai_processing_status: 'completed',
      // Do NOT auto-bless. Ingestion must not pre-approve for publish — that
      // bypassed vision-gate-classify.mjs and let personal/private content
      // (family photos, iMessage screenshots) onto public vehicles (2026-05-30).
      // Publish surfaces must filter on vision_gate_status='approved'.
      vision_gate_status: 'review_needed',
      documented_by_user_id: USER_ID,
      area: C.area || sceneType,
      part: partsArr.length ? partsArr.join(', ').slice(0, 200) : null,
      operation,
      fabrication_stage: stage,
      image_type: sceneType,
      category: sceneType,
      caption,
      // DEEP fields promoted into queryable columns (not buried in ai_scan_metadata):
      vehicle_zone: vehicleZone,
      ...(C.camera_pose ? { camera_pose: C.camera_pose } : {}),
      ...(components ? { components } : {}),
      ...(damageFlags && damageFlags.length ? { damage_flags: damageFlags } : {}),
      ...(conditionScore != null ? { condition_score: conditionScore } : {}),
      ai_scan_metadata: {
        classifier: 'caller-byok-cascade',
        classifier_model: 'claude-opus-4-7-1m',
        classified_via: 'caller-vision-Read-tool',
        full_classification: classification,
        cascade_arms_emitted: Object.keys(cascade),
      },
    };
    if (!DRY_RUN) {
      const ins = await supabase.from('vehicle_images').insert(row).select('id').single();
      if (ins.error) { errors.push(`vehicle_images: ${ins.error.message}`); return; }
      imageId = ins.data.id;
    } else {
      imageId = 'dry-run-image-id';
    }
  }
  cascade.vehicle_image = imageId;

  // Observation atom via ingest-observation
  const obsBody = {
    source_slug: 'photo_pipeline',
    kind: 'media',
    observed_at: TAKEN_AT,
    source_identifier: SOURCE_ID,
    vehicle_id: VEHICLE_ID,
    content_text: classification.caption || '',
    structured_data: { ...classification, vehicle_image_id: imageId, file_hash: sha },
    agent_tier: 'caller-byok',
    agent_model: 'claude-opus-4-7-1m',
    extraction_method: 'caller-vision-Read-tool',
    raw_source_ref: PHOTO,
  };
  if (!DRY_RUN) {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/ingest-observation`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(obsBody),
    });
    const j = await r.json();
    if (!j.success) { errors.push(`ingest-observation: ${JSON.stringify(j).slice(0, 200)}`); return; }
    cascade.observation = j.observation_id;
  } else {
    cascade.observation = 'dry-run-obs-id';
  }

  // ─── ARM 2b: the image-analysis ENGINE row (image_observations) ───
  // The tiered, searchable layer. Without this the cascade fed everything EXCEPT
  // the engine that powers visual search + convergence. role/bbox/visual_signature
  // come from the deep verdict. Written through the sanctioned ingest function.
  if (!DRY_RUN && imageId) {
    const role = sceneType === 'data_plate' ? 'vin'
               : (C.intent === 'parts_sourcing' || sceneType === 'product_screenshot') ? 'part'
               : 'subject';
    const vsig = {
      ...(st.paint_state ? { paint_state: st.paint_state } : {}),
      ...(st.rust_severity ? { rust: st.rust_severity } : {}),
      ...(vehicleZone ? { zone: vehicleZone } : {}),
      ...(C.camera_pose?.azimuth_deg != null ? { camera_azimuth_deg: C.camera_pose.azimuth_deg } : {}),
    };
    const { error: ioErr } = await supabase.rpc('ingest_image_observation', {
      p_image_id: imageId, p_vehicle_id: VEHICLE_ID, p_role: role,
      p_confidence: C.confidence ?? 0.7,
      p_observed_by: 'caller-byok-cascade', p_agent_version: 'claude-opus-4-7-1m',
      p_confidence_basis: { source: 'deep_cascade', scene_type: sceneType, intent: C.intent ?? null, narrative: caption },
      p_layer_version: { writer: 'process-photo-cascade-v2' },
    });
    if (ioErr) { errors.push(`image_observations: ${ioErr.message}`); }
    else if (vehicleBbox || Object.keys(vsig).length) {
      await supabase.from('image_observations')
        .update({ ...(vehicleBbox ? { bbox: vehicleBbox } : {}),
                  ...(Object.keys(vsig).length ? { visual_signature: vsig } : {}) })
        .eq('image_id', imageId).eq('observed_by', 'caller-byok-cascade').eq('is_active', true);
    }
  }

  return imageId;
}

// ─── ARM 3: technician_work_evidence (NEW — requires migration 20260523080100) ───
async function armTechnicianEvidence(imageId) {
  if (!classification.person_visible) return;
  if (!(await tableExists('technician_work_evidence'))) {
    if (VERBOSE) console.log('[skip] technician_work_evidence table not present');
    return;
  }
  const pv = classification.person_visible;
  const techId = pv.technician_id;
  if (!techId) {
    if (VERBOSE) console.log('[skip] technician_id not provided in person_visible');
    return;
  }
  const row = {
    technician_id: techId,
    derived_from_image_id: imageId,
    derived_from_observation_id: cascade.observation,
    vehicle_id: VEHICLE_ID,
    observed_at: TAKEN_AT,
    specialty: pv.specialty_inferred,
    operation: classification.action,
    duration_minutes: pv.duration_minutes_estimated,
    tier_signal: pv.tier_signal,
    tools_visible: classification.tools_visible || [],
    ppe_visible: classification.ppe_visible || [],
    notes: classification.caption,
    source_method: 'caller-vision-Read-tool',
    source_model: 'claude-opus-4-7-1m',
    confidence: classification.confidence,
  };
  if (DRY_RUN) { cascade.tech_evidence = 'dry-run-tech-id'; return; }
  const ins = await supabase.from('technician_work_evidence').insert(row).select('id').single();
  if (ins.error) { errors.push(`technician_work_evidence: ${ins.error.message}`); return; }
  cascade.tech_evidence = ins.data.id;
}

// ─── ARM 4: equipment_usage_evidence per tool visible (NEW) ───
async function armEquipmentEvidence(imageId) {
  if (!Array.isArray(classification.tools_visible) || classification.tools_visible.length === 0) return;
  if (!(await tableExists('equipment_usage_evidence'))) {
    if (VERBOSE) console.log('[skip] equipment_usage_evidence table not present');
    return;
  }
  const techId = classification.person_visible?.technician_id;
  for (const tool of classification.tools_visible) {
    if (!tool.equipment_id) {
      if (VERBOSE) console.log(`[skip] tool "${tool.name}" has no equipment_id — register in equipment table first`);
      continue;
    }
    const row = {
      equipment_id: tool.equipment_id,
      derived_from_image_id: imageId,
      vehicle_id: VEHICLE_ID,
      technician_id: techId,
      observed_at: TAKEN_AT,
      use_context: tool.use_context || 'observed_in_frame',
      estimated_use_minutes: tool.estimated_use_minutes || 30,
      visible_state: tool.visible_state || 'in_use',
      notes: `cascade from photo ${basename(PHOTO)}`,
      source_method: 'caller-vision-Read-tool',
      confidence: classification.confidence,
    };
    if (DRY_RUN) { cascade.equip_evidence.push(`dry-run-${tool.name}`); continue; }
    const ins = await supabase.from('equipment_usage_evidence').insert(row).select('id').single();
    if (ins.error) { errors.push(`equipment_usage_evidence[${tool.name}]: ${ins.error.message}`); continue; }
    cascade.equip_evidence.push(ins.data.id);
  }
}

// ─── ARM 5: consumable PRESENCE testimony (per applied-ontology) ───
// A photo can observe that a consumable is PRESENT/in-use — it cannot measure how much was
// consumed. So the atom we write is a consumable_usage_evidence row (presence testimony,
// mirroring equipment_usage_evidence), NOT a fabricated stock decrement. We resolve a null
// consumable_id via resolve_consumable(name) — the same folding the SQL cascade uses — so the
// arm no longer silently drops every observed consumable for lack of an id.
async function armConsumables(imageId) {
  if (!Array.isArray(classification.consumables_used) || classification.consumables_used.length === 0) return;
  if (!(await tableExists('consumables'))) {
    if (VERBOSE) console.log('[skip] consumables table not present');
    return;
  }
  const hasEvidence = await tableExists('consumable_usage_evidence');
  const techId = classification.person_visible?.technician_id;
  for (const c of classification.consumables_used) {
    // Resolve the entity from the observed material name when the caller didn't supply one.
    let consumableId = c.consumable_id;
    if (!consumableId && c.name) {
      const { data: rid } = await supabase.rpc('resolve_consumable', { p_str: c.name });
      consumableId = rid || null;
    }
    if (!consumableId) {
      if (VERBOSE) console.log(`[skip] consumable "${c.name}" unresolved — seed it in consumables first`);
      continue;
    }
    if (DRY_RUN) { cascade.consumables.push(`dry-run-${c.name}`); continue; }

    // Primary atom: PRESENCE testimony. visible_state is 'present_in_frame', never a count.
    if (hasEvidence && imageId) {
      const row = {
        consumable_id: consumableId,
        derived_from_image_id: imageId,
        vehicle_id: VEHICLE_ID,
        technician_id: techId,
        observed_at: TAKEN_AT,
        use_context: c.use_context || 'observed_in_frame',
        visible_state: 'present_in_frame',
        notes: `cascade from photo ${basename(PHOTO)}`,
        source_method: 'caller-vision-Read-tool',
        confidence: classification.confidence,
      };
      // Idempotent on (consumable_id, derived_from_image_id) — swallow the dup-key conflict.
      const ins = await supabase
        .from('consumable_usage_evidence')
        .upsert(row, { onConflict: 'consumable_id,derived_from_image_id', ignoreDuplicates: true })
        .select('id');
      if (ins.error) { errors.push(`consumable_usage_evidence[${c.name}]: ${ins.error.message}`); continue; }
    }
    cascade.consumables.push(consumableId);
  }
}

// ─── Run all arms in order ───
const imageId = await armVehicleImageAndObservation();
if (imageId) {
  await armTechnicianEvidence(imageId);
  await armEquipmentEvidence(imageId);
  await armConsumables(imageId);
}

console.log(JSON.stringify({
  cascade,
  errors: errors.length ? errors : undefined,
  dry_run: DRY_RUN || undefined,
  cascade_completeness: {
    vehicle_image: !!cascade.vehicle_image,
    observation: !!cascade.observation,
    technician_evidence: !!cascade.tech_evidence,
    equipment_evidence_count: cascade.equip_evidence.length,
    consumables_decremented: cascade.consumables.length,
  }
}, null, 2));

if (errors.length > 0) process.exit(2);
