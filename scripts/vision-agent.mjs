#!/usr/bin/env node
/**
 * Vision Agent — Context-Aware Image Interrogation
 *
 * Two-pass design (from extraction-vision-strategy.md):
 *   Pass 1 BLIND: No context. What does the model see? Raw observations.
 *   Pass 2 CONTEXTUAL: Compare blind findings against text claims. Verify or contradict.
 *
 * Uses Ollama multimodal (llava, qwen2.5-vl) or YONO Florence-2 for vision.
 * Text context comes from compute-image-labels pipeline.
 *
 * Usage:
 *   dotenvx run -- node scripts/vision-agent.mjs --vehicle-id <uuid>
 *   dotenvx run -- node scripts/vision-agent.mjs --vehicle-id <uuid> --pass blind
 *   dotenvx run -- node scripts/vision-agent.mjs --vehicle-id <uuid> --pass contextual
 *   dotenvx run -- node scripts/vision-agent.mjs --vehicle-id <uuid> --max-images 5
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
const OLLAMA_URL = 'http://127.0.0.1:11434';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const args = process.argv.slice(2);
const getArg = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const VEHICLE_ID = getArg('vehicle-id', null);
const PASS = getArg('pass', 'both'); // blind, contextual, both
const MAX_IMAGES = parseInt(getArg('max-images', '10'));
const MODEL = getArg('model', 'qwen2.5vl:7b'); // multimodal model

function log(msg) { console.log(msg); }
function section(msg) { log(`\n── ${msg} ──`); }

// ── Ollama Vision Call ──

async function visionQuery(imageUrl, prompt) {
  // Download image to base64 (Ollama needs base64 for images)
  let imageBase64;
  try {
    const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
    if (!imgRes.ok) return { error: `Image fetch failed: ${imgRes.status}` };
    const buffer = await imgRes.arrayBuffer();
    imageBase64 = Buffer.from(buffer).toString('base64');
  } catch (err) {
    return { error: `Image download failed: ${err.message}` };
  }

  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{
          role: 'user',
          content: prompt,
          images: [imageBase64],
        }],
        stream: false,
        options: { temperature: 0, num_predict: 2048 },
      }),
      signal: AbortSignal.timeout(120000),
    });
    const data = await res.json();
    return { text: data.message?.content || '', ms: data.total_duration ? Math.round(data.total_duration / 1e6) : 0 };
  } catch (err) {
    return { error: `Ollama failed: ${err.message}` };
  }
}

// ── BLIND PASS: No context, what do you see? ──

const BLIND_PROMPT = `Analyze this vehicle photograph. Describe exactly what you see:

1. ZONE: What part of the vehicle is shown? (front exterior, rear exterior, driver side, passenger side, engine bay, interior dashboard, interior seats, wheel/tire, undercarriage, detail/badge, trunk/cargo, roof)

2. CONDITION: Rate the visible condition 1-5 (1=poor/damaged, 3=fair/worn, 5=excellent/pristine). Explain why.

3. DAMAGE: List any visible damage, rust, dents, scratches, wear, cracks, tears, missing parts. Be specific about location.

4. MODIFICATIONS: List anything that appears non-original, aftermarket, or modified.

5. COMPONENTS: List specific identifiable parts visible (brand names, part types, materials).

6. PHOTO QUALITY: Rate 1-5 (lighting, focus, composition, usefulness for documentation).

Respond as JSON:
{"zone": "...", "condition_score": N, "condition_reason": "...", "damage": ["...", ...], "modifications": ["...", ...], "components": ["...", ...], "photo_quality": N, "notes": "..."}`;

// ── CONTEXTUAL PASS: Verify text claims ──

function buildContextualPrompt(vehicle, claims, blindResult) {
  let prompt = `You are verifying text claims about a vehicle using this photograph.

VEHICLE: ${vehicle.year} ${vehicle.make} ${vehicle.model}
`;

  if (blindResult) {
    prompt += `\nBLIND ANALYSIS (what was seen without context):\n${JSON.stringify(blindResult, null, 2)}\n`;
  }

  prompt += `\nTEXT CLAIMS TO VERIFY:\n`;
  for (const claim of claims.slice(0, 15)) {
    prompt += `- [${claim.source}, trust ${claim.trust}] ${typeof claim.claim === 'string' ? claim.claim.slice(0, 150) : JSON.stringify(claim.claim).slice(0, 150)}\n`;
  }

  prompt += `
For each claim that relates to what's visible in this photo, mark it as:
- CONFIRMED: Visible in photo and matches claim
- CONTRADICTED: Visible in photo but disagrees with claim
- UNVERIFIABLE: Not visible in this photo/angle
- PARTIALLY: Some aspects match, others don't

Also note anything visible in the photo that NO text claim mentions (UNDOCUMENTED features).

Respond as JSON:
{"verifications": [{"claim": "...", "status": "CONFIRMED|CONTRADICTED|UNVERIFIABLE|PARTIALLY", "evidence": "..."}], "undocumented": ["...", ...], "discrepancy_score": N}

discrepancy_score: 0 = text perfectly matches photos, 100 = major contradictions found.`;

  return prompt;
}

// ── Gather vehicle context ──

async function getVehicleContext(vehicleId) {
  const { data: vehicle } = await supabase.from('vehicles').select('*').eq('id', vehicleId).single();
  if (!vehicle) return null;

  const claims = [];

  // Rich fields
  if (vehicle.highlights) {
    const items = Array.isArray(vehicle.highlights) ? vehicle.highlights : [vehicle.highlights];
    items.forEach(h => claims.push({ claim: h, source: vehicle.source || 'listing', trust: 0.85 }));
  }
  if (vehicle.equipment) {
    const items = Array.isArray(vehicle.equipment) ? vehicle.equipment : [vehicle.equipment];
    items.forEach(e => claims.push({ claim: e, source: vehicle.source || 'listing', trust: 0.80 }));
  }
  if (vehicle.modifications) {
    const items = Array.isArray(vehicle.modifications) ? vehicle.modifications : [vehicle.modifications];
    items.forEach(m => claims.push({ claim: `MODIFICATION: ${m}`, source: vehicle.source || 'listing', trust: 0.75 }));
  }
  if (vehicle.known_flaws) {
    const items = Array.isArray(vehicle.known_flaws) ? vehicle.known_flaws : [vehicle.known_flaws];
    items.forEach(f => claims.push({ claim: `KNOWN FLAW: ${f}`, source: vehicle.source || 'listing', trust: 0.90 }));
  }
  if (vehicle.description) {
    // Chunk description into claim-sized pieces
    const sentences = vehicle.description.split(/[.!?\n]+/).filter(s => s.trim().length > 20);
    sentences.slice(0, 20).forEach(s => claims.push({ claim: s.trim(), source: vehicle.source || 'listing', trust: 0.70 }));
  }

  // Field evidence
  const { data: evidence } = await supabase
    .from('field_evidence')
    .select('field_name, proposed_value, source_confidence')
    .eq('vehicle_id', vehicleId)
    .order('source_confidence', { ascending: false })
    .limit(30);

  for (const ev of (evidence || [])) {
    claims.push({ claim: `${ev.field_name}: ${ev.proposed_value}`, source: 'field_evidence', trust: (ev.source_confidence || 50) / 100 });
  }

  return { vehicle, claims };
}

// ── Get images ──

async function getImages(vehicleId) {
  const { data } = await supabase
    .from('vehicle_images')
    .select('id, image_url, vehicle_zone, position, condition_score')
    .eq('vehicle_id', vehicleId)
    .order('position')
    .limit(MAX_IMAGES);

  // Filter to accessible images
  return (data || []).filter(i => i.image_url && (i.image_url.includes('supabase') || i.image_url.startsWith('http')));
}

// ── Store results ──

async function storeVisionResult(imageId, pass, result) {
  const updates = {};

  if (pass === 'blind' && result.zone) {
    // Only update zone if we're confident
    updates.vehicle_zone = result.zone;
    updates.condition_score = result.condition_score;
    updates.photo_quality_score = result.photo_quality;
    if (result.damage?.length) updates.damage_flags = result.damage;
    if (result.modifications?.length) updates.modification_flags = result.modifications;
    updates.vision_analyzed_at = new Date().toISOString();
    updates.vision_model_version = `vision-agent-${MODEL}`;
  }

  if (Object.keys(updates).length > 0) {
    await supabase.from('vehicle_images').update(updates).eq('id', imageId);
  }
}

// ── Main ──

async function main() {
  if (!VEHICLE_ID) {
    console.error('Usage: --vehicle-id <uuid> [--pass blind|contextual|both] [--max-images 10]');
    process.exit(1);
  }

  log('═══════════════════════════════════════════════════════════');
  log('  Vision Agent — Context-Aware Image Interrogation');
  log(`  Vehicle: ${VEHICLE_ID}`);
  log(`  Pass: ${PASS} | Model: ${MODEL} | Max images: ${MAX_IMAGES}`);
  log('═══════════════════════════════════════════════════════════');

  // Load context
  const ctx = await getVehicleContext(VEHICLE_ID);
  if (!ctx) { log('Vehicle not found'); return; }
  log(`\n${ctx.vehicle.year} ${ctx.vehicle.make} ${ctx.vehicle.model}`);
  log(`${ctx.claims.length} text claims available`);

  // Get images
  const images = await getImages(VEHICLE_ID);
  log(`${images.length} images to analyze\n`);

  if (images.length === 0) { log('No accessible images'); return; }

  const blindResults = [];
  const contextualResults = [];

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    log(`━━━ Image ${i + 1}/${images.length} (pos ${img.position}) ━━━`);

    // BLIND PASS
    if (PASS === 'blind' || PASS === 'both') {
      section('PASS 1: BLIND');
      const blind = await visionQuery(img.image_url, BLIND_PROMPT);

      if (blind.error) {
        log(`  ✗ ${blind.error}`);
      } else {
        log(`  (${blind.ms}ms)`);
        // Try parse JSON
        let parsed = null;
        try {
          const jsonMatch = blind.text.match(/\{[\s\S]*\}/);
          if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
        } catch {}

        if (parsed) {
          log(`  Zone: ${parsed.zone}`);
          log(`  Condition: ${parsed.condition_score}/5 — ${parsed.condition_reason || ''}`);
          if (parsed.damage?.length) log(`  Damage: ${parsed.damage.join(', ')}`);
          if (parsed.modifications?.length) log(`  Mods: ${parsed.modifications.join(', ')}`);
          if (parsed.components?.length) log(`  Components: ${parsed.components.slice(0, 5).join(', ')}`);
          log(`  Photo quality: ${parsed.photo_quality}/5`);

          await storeVisionResult(img.id, 'blind', parsed);
          blindResults.push({ image_id: img.id, position: img.position, ...parsed });
        } else {
          log(`  Raw: ${blind.text.slice(0, 200)}`);
          blindResults.push({ image_id: img.id, position: img.position, raw: blind.text });
        }
      }
    }

    // CONTEXTUAL PASS
    if ((PASS === 'contextual' || PASS === 'both') && ctx.claims.length > 0) {
      section('PASS 2: CONTEXTUAL (verifying text claims)');
      const blindForContext = blindResults.find(b => b.image_id === img.id) || null;
      const contextPrompt = buildContextualPrompt(ctx.vehicle, ctx.claims, blindForContext);
      const contextual = await visionQuery(img.image_url, contextPrompt);

      if (contextual.error) {
        log(`  ✗ ${contextual.error}`);
      } else {
        log(`  (${contextual.ms}ms)`);
        let parsed = null;
        try {
          const jsonMatch = contextual.text.match(/\{[\s\S]*\}/);
          if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
        } catch {}

        if (parsed) {
          const confirmed = (parsed.verifications || []).filter(v => v.status === 'CONFIRMED').length;
          const contradicted = (parsed.verifications || []).filter(v => v.status === 'CONTRADICTED').length;
          const unverifiable = (parsed.verifications || []).filter(v => v.status === 'UNVERIFIABLE').length;
          log(`  Verified: ${confirmed} confirmed, ${contradicted} contradicted, ${unverifiable} unverifiable`);
          if (contradicted > 0) {
            for (const v of parsed.verifications.filter(v => v.status === 'CONTRADICTED')) {
              log(`  ⚠ CONTRADICTION: ${v.claim?.slice(0, 80)} — ${v.evidence}`);
            }
          }
          if (parsed.undocumented?.length) {
            log(`  📌 Undocumented: ${parsed.undocumented.join(', ')}`);
          }
          log(`  Discrepancy score: ${parsed.discrepancy_score}/100`);
          contextualResults.push({ image_id: img.id, position: img.position, ...parsed });
        } else {
          log(`  Raw: ${contextual.text.slice(0, 200)}`);
        }
      }
    }

    log('');
  }

  // Summary
  log('═══════════════════════════════════════════════════════════');
  log('  VISION AGENT SUMMARY');
  log('═══════════════════════════════════════════════════════════');

  if (blindResults.length) {
    const zones = blindResults.filter(b => b.zone).map(b => b.zone);
    const avgCondition = blindResults.filter(b => b.condition_score).reduce((a, b) => a + b.condition_score, 0) / (blindResults.filter(b => b.condition_score).length || 1);
    const allDamage = blindResults.flatMap(b => b.damage || []);
    const allMods = blindResults.flatMap(b => b.modifications || []);
    log(`  Blind pass: ${blindResults.length} images analyzed`);
    log(`  Zones found: ${[...new Set(zones)].join(', ')}`);
    log(`  Avg condition: ${avgCondition.toFixed(1)}/5`);
    log(`  Total damage items: ${allDamage.length}`);
    log(`  Total modifications: ${allMods.length}`);
  }

  if (contextualResults.length) {
    const totalConfirmed = contextualResults.reduce((a, r) => a + (r.verifications || []).filter(v => v.status === 'CONFIRMED').length, 0);
    const totalContradicted = contextualResults.reduce((a, r) => a + (r.verifications || []).filter(v => v.status === 'CONTRADICTED').length, 0);
    const allUndocumented = contextualResults.flatMap(r => r.undocumented || []);
    const avgDiscrepancy = contextualResults.filter(r => r.discrepancy_score != null).reduce((a, r) => a + r.discrepancy_score, 0) / (contextualResults.length || 1);
    log(`  Contextual pass: ${contextualResults.length} images verified`);
    log(`  Claims confirmed: ${totalConfirmed}`);
    log(`  Claims contradicted: ${totalContradicted}`);
    log(`  Undocumented features: ${allUndocumented.length}`);
    log(`  Avg discrepancy: ${avgDiscrepancy.toFixed(0)}/100`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
