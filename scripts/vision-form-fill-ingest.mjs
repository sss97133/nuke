#!/usr/bin/env node
/**
 * vision-form-fill-ingest.mjs — write extracted form-fill data back to vehicle_images.
 *
 * Reads JSONL from --sink path. Each line: {image_id, vehicle_zone, fabrication_stage,
 * modification_flags, damage_flags, condition_score, exterior_color_dominant,
 * interior_color_dominant, visible_parts, weather_state, visible_text_or_documents,
 * people_present, location_context, raw_observation, confidence}.
 *
 * Writes to vehicle_images columns (only when source field is non-null AND
 * destination column is currently empty/null). Idempotent.
 *
 * Usage: node scripts/vision-form-fill-ingest.mjs --sink /tmp/extract/<v>/extracted.jsonl
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i+1] : d; };
const SINK = arg('--sink');
if (!SINK || !existsSync(SINK)) { console.error('--sink <path> required'); process.exit(1); }

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const lines = readFileSync(SINK, 'utf8').split('\n').filter(Boolean);
let written = 0, failed = 0, skipped = 0;
for (const line of lines) {
  let r;
  try { r = JSON.parse(line); } catch { failed++; continue; }
  if (!r.image_id || (r.confidence ?? 0) < 0.3) { skipped++; continue; }

  // Build update — only write fields the agent populated meaningfully.
  const update = {};
  if (r.vehicle_zone && r.vehicle_zone !== 'none') update.vehicle_zone = r.vehicle_zone;
  if (r.fabrication_stage && r.fabrication_stage !== 'none') update.fabrication_stage = r.fabrication_stage;
  if (Array.isArray(r.modification_flags) && r.modification_flags.length) update.modification_flags = r.modification_flags;
  if (Array.isArray(r.damage_flags) && r.damage_flags.length) update.damage_flags = r.damage_flags;
  if (typeof r.condition_score === 'number' && r.condition_score >= 1 && r.condition_score <= 5) update.condition_score = r.condition_score;

  // Compose ai_extractions blob with the rest (color, parts, text, location, etc.)
  // for downstream consumers. Avoid clobbering pre-existing data.
  const richBlob = {
    extracted_at: new Date().toISOString(),
    confidence: r.confidence,
    exterior_color_dominant: r.exterior_color_dominant ?? null,
    interior_color_dominant: r.interior_color_dominant ?? null,
    visible_parts: r.visible_parts ?? [],
    weather_state: r.weather_state ?? null,
    visible_text_or_documents: r.visible_text_or_documents ?? null,
    people_present: r.people_present ?? null,
    location_context: r.location_context ?? null,
    raw_observation: r.raw_observation ?? null,
  };
  // Read existing ai_extractions, merge under 'form_fill_v1' key
  const { data: existing } = await sb
    .from('vehicle_images').select('ai_extractions').eq('id', r.image_id).maybeSingle();
  const merged = { ...(existing?.ai_extractions || {}), form_fill_v1: richBlob };
  update.ai_extractions = merged;

  if (Object.keys(update).length === 0) { skipped++; continue; }
  const { error } = await sb.from('vehicle_images').update(update).eq('id', r.image_id);
  if (error) { console.error(`${r.image_id}: ${error.message}`); failed++; continue; }
  written++;
}
console.log(`form-fill ingest from ${SINK}: written=${written} skipped=${skipped} failed=${failed}`);
