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
 *   5. consumable consumption decrement (NEW — requires consumables table)
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
 *     "consumables_used": [
 *       { "consumable_id": null, "name": "nitrile gloves", "quantity_inferred": 1 }
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
      area: classification.area || classification.scene_class,
      part: Array.isArray(classification.parts_visible) ? classification.parts_visible.join(', ').slice(0, 200) : null,
      operation: classification.action,
      fabrication_stage: classification.fabrication_stage,
      image_type: classification.scene_class,
      category: classification.scene_class,
      caption: classification.caption,
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

// ─── ARM 5: consumable consumption decrement (NEW) ───
async function armConsumables() {
  if (!Array.isArray(classification.consumables_used) || classification.consumables_used.length === 0) return;
  if (!(await tableExists('consumables'))) {
    if (VERBOSE) console.log('[skip] consumables table not present');
    return;
  }
  for (const c of classification.consumables_used) {
    if (!c.consumable_id) {
      if (VERBOSE) console.log(`[skip] consumable "${c.name}" has no consumable_id`);
      continue;
    }
    if (DRY_RUN) { cascade.consumables.push(`dry-run-${c.name}`); continue; }
    const { error } = await supabase.rpc('decrement_consumable_stock', {
      p_consumable_id: c.consumable_id,
      p_quantity: c.quantity_inferred || 1,
    });
    if (error) {
      // Fallback: simple UPDATE if RPC doesn't exist
      const { error: e2 } = await supabase
        .from('consumables')
        .update({ current_stock_estimate: supabase.sql`current_stock_estimate - ${c.quantity_inferred || 1}` })
        .eq('id', c.consumable_id);
      if (e2) { errors.push(`consumable ${c.name}: ${e2.message}`); continue; }
    }
    cascade.consumables.push(c.consumable_id);
  }
}

// ─── Run all arms in order ───
const imageId = await armVehicleImageAndObservation();
if (imageId) {
  await armTechnicianEvidence(imageId);
  await armEquipmentEvidence(imageId);
  await armConsumables();
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
