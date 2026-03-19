#!/usr/bin/env node
/**
 * Deep Image Analysis — Reference Catalog-grade vision analysis
 *
 * Uses Gemini 2.0 Flash for forensic vehicle image analysis producing 12+ dimensional
 * output matching the NUKE Reference Catalog schema.
 *
 * Usage:
 *   dotenvx run -- node scripts/deep-image-analysis.mjs --vehicle-id <uuid>
 *   dotenvx run -- node scripts/deep-image-analysis.mjs --vehicle-id <uuid> --dry-run
 *   dotenvx run -- node scripts/deep-image-analysis.mjs --vehicle-id <uuid> --concurrency 10
 *   dotenvx run -- node scripts/deep-image-analysis.mjs --vehicle-id <uuid> --resume
 *   dotenvx run -- node scripts/deep-image-analysis.mjs --vehicle-id <uuid> --sample 10
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

const MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`;

const args = process.argv.slice(2);
const vehicleId = args[args.indexOf('--vehicle-id') + 1];
const dryRun = args.includes('--dry-run');
const resume = args.includes('--resume');
const concurrency = parseInt(args[args.indexOf('--concurrency') + 1]) || 8;
const sampleSize = args.includes('--sample') ? parseInt(args[args.indexOf('--sample') + 1]) : null;

if (!vehicleId) {
  console.error('Usage: dotenvx run -- node scripts/deep-image-analysis.mjs --vehicle-id <uuid>');
  process.exit(1);
}

// ─── The Prompt ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are NUKE's vehicle forensic vision system. You analyze automotive photographs with the depth and precision of a professional appraiser, materials scientist, and automotive historian combined.

You are analyzing images of a specific vehicle. Each image is one photograph from a set documenting this vehicle. Treat each image as a forensic specimen — extract everything visible.

Your analysis must be SPECIFIC to what you see. Never say "appears to be in good condition" — say exactly what you observe: "paint shows orange peel texture on fender, chrome bumper has pitting at lower edge, tire sidewall date code reads 2019."

Return ONLY valid JSON. No markdown, no code blocks, no explanations.`;

const ANALYSIS_PROMPT = `Analyze this vehicle photograph with forensic depth. Return ONLY valid JSON matching this schema exactly:

{
  "zone": "string — the vehicle zone shown. Use: ext_front, ext_front_driver, ext_front_passenger, ext_driver_side, ext_passenger_side, ext_rear, ext_rear_driver, ext_rear_passenger, ext_roof, ext_undercarriage, int_dashboard, int_front_seats, int_rear_seats, int_door_panel, int_headliner, int_cargo, mech_engine_bay, mech_suspension, mech_exhaust, mech_drivetrain, mech_brakes, wheel_fl, wheel_fr, wheel_rl, wheel_rr, detail_badge, detail_trim, detail_glass, detail_light, detail_damage, detail_modification, documentation, environment, other",

  "subject": {
    "primary_focus": "string — what is the main subject (e.g. 'driver side front fender and wheel well', 'engine bay from above', 'VIN plate on door jamb')",
    "components_visible": ["string array — every identifiable component: 'fender', 'wheel', 'tire', 'lug_nuts', 'brake_caliper', 'rotor', 'control_arm', etc."],
    "text_visible": ["string array — any readable text: VIN numbers, part numbers, date codes, stickers, stamps"],
    "hardware_visible": ["string array — fasteners, brackets, clips: 'hex_bolt_10mm', 'hose_clamp', 'cotter_pin', etc."]
  },

  "surface_analysis": {
    "primary_material": "string — dominant material: painted_steel, bare_metal, chrome, rubber, vinyl, fabric, glass, aluminum, plastic, fiberglass",
    "surface_finish": "string — matte, satin, semi_gloss, gloss, mirror, textured, brushed, powder_coated, raw",
    "paint_observations": "string or null — specific paint details: 'single-stage enamel, moderate orange peel, no clearcoat', 'basecoat/clearcoat, fish-eye defects near drip rail'",
    "coating_layers_visible": "string or null — if cross-section or chip visible: 'primer (grey) → basecoat (red) → clearcoat, total ~4mil'"
  },

  "degradation": {
    "lifecycle_state": "string — fresh, worn, weathered, restored, palimpsest, ghost, archaeological",
    "mechanisms": ["string array — specific failure modes observed: 'surface_rust', 'scale_rust', 'perforation_rust', 'paint_checking', 'paint_crazing', 'clearcoat_failure', 'uv_fade', 'stone_chips', 'abrasion', 'impact_damage', 'weld_burn_through', 'galvanic_corrosion', 'stress_cracking', 'delamination', 'moisture_damage', 'rodent_damage', 'adhesive_failure', etc."],
    "degradation_narrative": "string — 2-4 sentences describing exactly what degradation you see and its probable cause/history. Be specific about location and extent. Example: 'Scale rust has perforated the lower 3 inches of the driver side rocker panel, with visible bubbling extending 6 inches forward of the wheel well. The rust pattern follows the pinch weld seam, suggesting moisture trapped between the inner and outer panels. Original factory undercoating is intact above the rust line, creating a clear tide mark.'"
  },

  "color_data": {
    "dominant_colors": ["string array — 3-5 hex codes of dominant colors visible, e.g. '#CC0000', '#1a1a1a', '#D4A017'"],
    "paint_color_name": "string or null — best guess at the paint color name (e.g. 'Crimson Red', 'Hugger Orange', 'Corvette Silver')",
    "color_narrative": "string — 1-2 sentences about the color relationships. Example: 'Original red has UV-shifted toward pink on horizontal surfaces while vertical panels retain deeper crimson. Primer grey shows through stone chips on leading edges.'"
  },

  "condition_detail": {
    "overall_score": "number 1-10 — granular condition score for what's visible in THIS image",
    "structural_integrity": "string — solid, minor_concern, moderate_concern, major_concern, compromised",
    "restoration_state": "string — original_unrestored, partially_restored, fully_restored, modified, project, barn_find, driver_quality, show_quality",
    "condition_notes": "string — 1-2 sentences of specific condition observations unique to this image"
  },

  "fabrication_stage": "string or null — if this shows work in progress: raw, disassembled, media_blasted, stripped, fabricated, welded, primed, blocked, basecoated, clearcoated, assembled, complete",

  "modifications": {
    "detected": ["string array — specific modifications visible: 'aftermarket_lift_kit_4inch', 'led_headlight_conversion', 'custom_roll_cage', 'electric_fan_conversion', 'disc_brake_swap', 'ls_swap', 'aftermarket_bumper', 'winch_mount', etc."],
    "period_correct": "boolean or null — are visible modifications period-correct to the vehicle?",
    "modification_quality": "string or null — professional, quality_amateur, rough, unsafe"
  },

  "light_and_environment": {
    "lighting": "string — natural_direct, natural_diffuse, garage_fluorescent, garage_led, flash, mixed, studio",
    "environment": "string — garage, driveway, field, shop, showroom, outdoor_pavement, trail, junkyard, auction, other",
    "photo_quality_score": "number 1-10",
    "photo_quality_notes": "string — 'sharp focus, good exposure, shows detail well' or 'backlit, shadow obscures damage on lower panel'"
  },

  "forensic_observations": "string — 1-3 sentences of anything else notable that doesn't fit above categories. Tool marks, evidence of previous repairs, unusual features, historical clues. Example: 'MIG weld beads visible on inner fender suggest previous repair — not factory spot welds. Undercoating overspray on brake line indicates coating was applied after assembly, possibly at dealer.'"
}

RULES:
- Be SPECIFIC. Not "some rust" — "scale rust along pinch weld seam, 8 inches long"
- If you can't determine something, use null, don't guess
- Every image has something worth noting in forensic_observations
- components_visible should list EVERY part you can identify, even small ones
- damage mechanisms should be technically precise — "clearcoat_failure" not "paint peeling"
- Hex colors should be actual sampled colors from the image, not guesses`;

// ─── Supabase helpers ─────────────────────────────────────────────────────────

async function supabaseGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    }
  });
  if (!res.ok) throw new Error(`Supabase GET failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function supabasePatch(table, id, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Supabase PATCH failed: ${res.status} ${await res.text()}`);
}

// ─── Fetch image as base64 ───────────────────────────────────────────────────

async function fetchImageBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  return { base64, mimeType: contentType };
}

// ─── Gemini vision call ─────────────────────────────────────────────────────

async function analyzeImage(imageUrl, imageId, vehicle) {
  const vehicleContext = `Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model} (VIN: ${vehicle.vin})`;
  const start = Date.now();

  const { base64, mimeType } = await fetchImageBase64(imageUrl);

  const body = {
    contents: [{
      parts: [
        { inlineData: { mimeType, data: base64 } },
        { text: `${vehicleContext}\n\n${ANALYSIS_PROMPT}` },
      ]
    }],
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
    },
  };

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const ms = Date.now() - start;

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const reason = data.candidates?.[0]?.finishReason;
    throw new Error(`Empty Gemini response, finishReason: ${reason}`);
  }

  let jsonStr = text.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  const analysis = JSON.parse(jsonStr);

  // Gemini Flash: $0.10/1M input, $0.40/1M output
  const inputTokens = data.usageMetadata?.promptTokenCount || 0;
  const outputTokens = data.usageMetadata?.candidatesTokenCount || 0;
  const cost = (inputTokens * 0.10 / 1_000_000) + (outputTokens * 0.40 / 1_000_000);

  return {
    analysis,
    ms,
    model: MODEL,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost,
  };
}

// ─── Batch processor with concurrency control ─────────────────────────────────

async function processWithConcurrency(items, fn, maxConcurrent) {
  const results = [];
  let index = 0;
  let completed = 0;
  const total = items.length;
  const startTime = Date.now();

  async function worker() {
    while (index < items.length) {
      const i = index++;
      try {
        const result = await fn(items[i], i);
        results[i] = { success: true, result };
      } catch (err) {
        results[i] = { success: false, error: err.message };
        // Rate limit: back off on 429
        if (err.message.includes('429')) {
          await new Promise(r => setTimeout(r, 5000));
        }
      }
      completed++;
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = completed / elapsed;
      const remaining = Math.max(0, ((total - completed) / rate)).toFixed(0);
      const spent = results.filter(r => r?.success).reduce((s, r) => s + (r.result?.cost || 0), 0);
      process.stdout.write(`\r  [${completed}/${total}] ${(completed/total*100).toFixed(1)}% | ${remaining}s left | $${spent.toFixed(4)} spent`);
    }
  }

  const workers = Array.from({ length: Math.min(maxConcurrent, items.length) }, () => worker());
  await Promise.all(workers);
  console.log('');
  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n  NUKE DEEP IMAGE ANALYSIS`);
  console.log(`  ═══════════════════════════════════════`);
  console.log(`  Vehicle:     ${vehicleId}`);
  console.log(`  Model:       ${MODEL}`);
  console.log(`  Concurrency: ${concurrency}`);
  if (dryRun)    console.log(`  Mode:        DRY RUN`);
  if (resume)    console.log(`  Mode:        RESUME (skip already-analyzed)`);
  if (sampleSize) console.log(`  Sample:      ${sampleSize} images`);
  console.log('');

  // Get vehicle info
  const [vehicle] = await supabaseGet(`vehicles?id=eq.${vehicleId}&select=id,year,make,model,vin,title`);
  if (!vehicle) { console.error('  Vehicle not found'); process.exit(1); }
  console.log(`  ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.vin})`);

  // Get images
  const allImages = await supabaseGet(
    `vehicle_images?vehicle_id=eq.${vehicleId}&select=id,image_url,position,ai_scan_metadata&order=position.asc&limit=1000`
  );

  let images = allImages;
  if (resume) {
    images = allImages.filter(img => !img.ai_scan_metadata?.deep_analysis);
    console.log(`  Images: ${allImages.length} total, ${allImages.length - images.length} already done, ${images.length} remaining`);
  } else {
    console.log(`  Images: ${images.length}`);
  }

  if (sampleSize && images.length > sampleSize) {
    const step = Math.max(1, Math.floor(images.length / sampleSize));
    images = images.filter((_, i) => i % step === 0).slice(0, sampleSize);
    console.log(`  Sampled: ${images.length}`);
  }

  if (images.length === 0) {
    console.log('  Nothing to analyze.');
    return;
  }

  // Gemini Flash with vision: ~$0.001/image
  const estimatedCost = images.length * 0.001;
  console.log(`  Est. cost: ~$${estimatedCost.toFixed(2)}`);
  console.log('');

  if (dryRun) {
    console.log('  DRY RUN — would analyze:');
    images.slice(0, 8).forEach(img => console.log(`    ${img.id} — ${img.image_url.split('/').pop()}`));
    if (images.length > 8) console.log(`    ... and ${images.length - 8} more`);
    return;
  }

  // Process all images
  const results = await processWithConcurrency(images, async (img, idx) => {
    const result = await analyzeImage(img.image_url, img.id, vehicle);

    // Merge into ai_scan_metadata, preserving existing
    const existingMeta = img.ai_scan_metadata || {};
    const updatedMeta = {
      ...existingMeta,
      deep_analysis: {
        ...result.analysis,
        _meta: {
          model: result.model,
          ms: result.ms,
          input_tokens: result.input_tokens,
          output_tokens: result.output_tokens,
          cost_usd: result.cost,
          analyzed_at: new Date().toISOString(),
          prompt_version: 'ref_catalog_v1',
        }
      }
    };

    // Write back to DB
    await supabasePatch('vehicle_images', img.id, {
      ai_scan_metadata: updatedMeta,
      vehicle_zone: result.analysis.zone,
      condition_score: Math.round(result.analysis.condition_detail?.overall_score / 2) || null,
      damage_flags: result.analysis.degradation?.mechanisms || [],
      modification_flags: result.analysis.modifications?.detected || [],
      fabrication_stage: result.analysis.fabrication_stage || null,
    });

    return result;
  }, concurrency);

  // Tally
  let successCount = 0, failCount = 0, totalCost = 0;
  const errors = [];
  results.forEach((r, i) => {
    if (r.success) { successCount++; totalCost += r.result.cost; }
    else { failCount++; errors.push({ id: images[i].id, error: r.error }); }
  });

  console.log(`\n  ═══════════════════════════════════════`);
  console.log(`  COMPLETE`);
  console.log(`  Success:   ${successCount}/${images.length}`);
  console.log(`  Failed:    ${failCount}`);
  console.log(`  Cost:      $${totalCost.toFixed(4)}`);
  if (successCount > 0) console.log(`  Avg/image: $${(totalCost / successCount).toFixed(5)}`);

  if (errors.length > 0) {
    console.log(`\n  ERRORS (first 10):`);
    errors.slice(0, 10).forEach(e => console.log(`    ${e.id}: ${e.error.slice(0, 120)}`));
    if (errors.length > 10) console.log(`    ... and ${errors.length - 10} more`);
  }

  // Show sample output
  const first = results.find(r => r.success);
  if (first) {
    console.log(`\n  ─── SAMPLE OUTPUT ─────────────────────`);
    const a = first.result.analysis;
    console.log(`  Zone: ${a.zone}`);
    console.log(`  Focus: ${a.subject?.primary_focus}`);
    console.log(`  Components: ${a.subject?.components_visible?.join(', ')}`);
    console.log(`  Material: ${a.surface_analysis?.primary_material} (${a.surface_analysis?.surface_finish})`);
    console.log(`  Paint: ${a.surface_analysis?.paint_observations || 'n/a'}`);
    console.log(`  Lifecycle: ${a.degradation?.lifecycle_state}`);
    console.log(`  Degradation: ${a.degradation?.mechanisms?.join(', ')}`);
    console.log(`  Narrative: ${a.degradation?.degradation_narrative}`);
    console.log(`  Colors: ${a.color_data?.dominant_colors?.join(', ')} — ${a.color_data?.paint_color_name || 'unknown'}`);
    console.log(`  Color story: ${a.color_data?.color_narrative}`);
    console.log(`  Condition: ${a.condition_detail?.overall_score}/10 (${a.condition_detail?.structural_integrity})`);
    console.log(`  State: ${a.condition_detail?.restoration_state}`);
    console.log(`  Notes: ${a.condition_detail?.condition_notes}`);
    console.log(`  Stage: ${a.fabrication_stage || 'n/a'}`);
    console.log(`  Mods: ${a.modifications?.detected?.join(', ') || 'none'}`);
    console.log(`  Forensics: ${a.forensic_observations}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
