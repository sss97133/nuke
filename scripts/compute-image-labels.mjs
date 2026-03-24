#!/usr/bin/env node
/**
 * Compute Mathematical Image Labels from Text Evidence
 *
 * The image's truth is the intersection of all text claims about that vehicle.
 * Labels are computed, not hand-assigned.
 *
 * For each vehicle with rich text data:
 * 1. Gather all text claims (descriptions, comments, field_evidence, RPO codes)
 * 2. Compute per-component labels with confidence
 * 3. Map labels to expected visual features per photo zone
 * 4. Output: training data for YONO retraining
 *
 * Usage:
 *   dotenvx run -- node scripts/compute-image-labels.mjs --vehicle-id <uuid>
 *   dotenvx run -- node scripts/compute-image-labels.mjs --batch 50    # richest 50 vehicles
 *   dotenvx run -- node scripts/compute-image-labels.mjs --stats
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const args = process.argv.slice(2);
const getArg = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const VEHICLE_ID = getArg('vehicle-id', null);
const BATCH = parseInt(getArg('batch', '10'));
const STATS_ONLY = args.includes('--stats');

function log(msg) { console.log(msg); }

// ── Source trust weights (from trust-scoring-methodology.md) ──
const SOURCE_TRUST = {
  bat: 0.85, 'cars-and-bids': 0.80, 'rm-sothebys': 0.90,
  hagerty: 0.70, owner: 0.65, facebook_marketplace: 0.45,
  ai_extraction: 0.60, rpo_decode: 0.95, vin_decode: 0.95,
  comment: 0.55, field_evidence: 0.75,
};

// ── What text claims imply visually ──
const CLAIM_TO_VISUAL = {
  // Engine claims → engine bay expectations
  engine_type: { zone: 'mech_engine_bay', visual: 'engine_block_visible' },
  carburetor: { zone: 'mech_engine_bay', visual: 'carburetor_type' },
  fuel_injection: { zone: 'mech_engine_bay', visual: 'fuel_injection_system' },
  air_cleaner: { zone: 'mech_engine_bay', visual: 'air_cleaner_assembly' },
  valve_covers: { zone: 'mech_engine_bay', visual: 'valve_cover_style' },
  distributor: { zone: 'mech_engine_bay', visual: 'ignition_system' },
  headers: { zone: 'mech_engine_bay', visual: 'exhaust_manifold_type' },

  // Exterior claims → exterior expectations
  paint_color: { zone: 'ext_*', visual: 'body_color' },
  rust: { zone: 'ext_*', visual: 'rust_damage', severity: true },
  dent: { zone: 'ext_*', visual: 'dent_damage', severity: true },
  wheels: { zone: 'wheel_*', visual: 'wheel_type' },
  tires: { zone: 'wheel_*', visual: 'tire_brand_type' },
  bumper: { zone: 'ext_front|ext_rear', visual: 'bumper_style' },
  grille: { zone: 'ext_front', visual: 'grille_type' },
  lights: { zone: 'ext_front|ext_rear', visual: 'light_type' },
  bed: { zone: 'ext_rear|ext_driver_side', visual: 'truck_bed_type' },
  top: { zone: 'ext_*', visual: 'roof_type' },
  removable_top: { zone: 'ext_*', visual: 'removable_top_present' },

  // Interior claims → interior expectations
  seats: { zone: 'int_front_seats|int_rear_seats', visual: 'seat_material' },
  dashboard: { zone: 'int_dashboard', visual: 'dashboard_style' },
  steering_wheel: { zone: 'int_dashboard', visual: 'steering_wheel_type' },
  gauges: { zone: 'int_dashboard', visual: 'gauge_cluster_type' },
  carpet: { zone: 'int_*', visual: 'floor_covering' },
  headliner: { zone: 'int_headliner', visual: 'headliner_condition' },

  // Condition claims → damage expectations
  matching_numbers: { zone: 'mech_engine_bay', visual: 'number_stamp_visible' },
  repaint: { zone: 'ext_*', visual: 'paint_quality_indicators' },
  body_filler: { zone: 'ext_*', visual: 'body_filler_indicators' },
  frame_damage: { zone: 'ext_undercarriage', visual: 'frame_condition' },
  undercoating: { zone: 'ext_undercarriage', visual: 'undercoating_present' },
};

// ── Gather all text claims for a vehicle ──
async function gatherClaims(vehicleId) {
  const claims = [];

  // 1. Vehicle record fields
  const { data: v } = await supabase.from('vehicles').select('*').eq('id', vehicleId).single();
  if (!v) return { vehicle: null, claims };

  // Direct field claims
  if (v.highlights) {
    const items = Array.isArray(v.highlights) ? v.highlights : [v.highlights];
    items.forEach(h => claims.push({ claim: h, source: v.source || 'unknown', trust: SOURCE_TRUST[v.source] || 0.50, type: 'highlight' }));
  }
  if (v.equipment) {
    const items = Array.isArray(v.equipment) ? v.equipment : [v.equipment];
    items.forEach(e => claims.push({ claim: e, source: v.source || 'unknown', trust: SOURCE_TRUST[v.source] || 0.50, type: 'equipment' }));
  }
  if (v.modifications) {
    const items = Array.isArray(v.modifications) ? v.modifications : [v.modifications];
    items.forEach(m => claims.push({ claim: m, source: v.source || 'unknown', trust: SOURCE_TRUST[v.source] || 0.50, type: 'modification' }));
  }
  if (v.known_flaws) {
    const items = Array.isArray(v.known_flaws) ? v.known_flaws : [v.known_flaws];
    items.forEach(f => claims.push({ claim: f, source: v.source || 'unknown', trust: SOURCE_TRUST[v.source] || 0.50, type: 'flaw' }));
  }
  if (v.description) {
    claims.push({ claim: v.description, source: v.source || 'unknown', trust: SOURCE_TRUST[v.source] || 0.50, type: 'description' });
  }

  // 2. Field evidence (highest quality — cited facts)
  const { data: evidence } = await supabase
    .from('field_evidence')
    .select('field_name, proposed_value, source_type, source_confidence')
    .eq('vehicle_id', vehicleId)
    .order('source_confidence', { ascending: false })
    .limit(200);

  for (const ev of (evidence || [])) {
    claims.push({
      claim: `${ev.field_name}: ${ev.proposed_value}`,
      source: ev.source_type || 'field_evidence',
      trust: (ev.source_confidence || 50) / 100,
      type: 'evidence',
      field: ev.field_name,
      value: ev.proposed_value,
    });
  }

  // 3. Description discoveries (AI extractions)
  const { data: descDisc } = await supabase
    .from('description_discoveries')
    .select('raw_extraction, model_used')
    .eq('vehicle_id', vehicleId)
    .limit(3);

  for (const dd of (descDisc || [])) {
    if (dd.raw_extraction && typeof dd.raw_extraction === 'object') {
      for (const [key, val] of Object.entries(dd.raw_extraction)) {
        if (val && val !== 'null' && val !== 'unknown') {
          claims.push({
            claim: `${key}: ${typeof val === 'object' ? JSON.stringify(val) : val}`,
            source: 'ai_extraction',
            trust: SOURCE_TRUST.ai_extraction,
            type: 'ai_extraction',
            field: key,
            value: val,
          });
        }
      }
    }
  }

  return { vehicle: v, claims };
}

// ── Compute visual expectations from claims ──
function computeVisualLabels(claims) {
  const labels = {};

  for (const claim of claims) {
    const text = (typeof claim.claim === 'string' ? claim.claim : '').toLowerCase();

    for (const [keyword, mapping] of Object.entries(CLAIM_TO_VISUAL)) {
      if (text.includes(keyword.replace(/_/g, ' ')) || text.includes(keyword)) {
        const zone = mapping.zone;
        if (!labels[zone]) labels[zone] = [];

        labels[zone].push({
          feature: mapping.visual,
          keyword,
          claim_text: text.slice(0, 100),
          trust: claim.trust,
          source: claim.source,
          is_damage: mapping.severity || false,
        });
      }
    }
  }

  // Aggregate: compute per-zone confidence
  const aggregated = {};
  for (const [zone, features] of Object.entries(labels)) {
    const avgTrust = features.reduce((a, f) => a + f.trust, 0) / features.length;
    const uniqueFeatures = [...new Set(features.map(f => f.feature))];
    aggregated[zone] = {
      expected_features: uniqueFeatures,
      claim_count: features.length,
      avg_trust: parseFloat(avgTrust.toFixed(3)),
      has_damage_claims: features.some(f => f.is_damage),
      details: features,
    };
  }

  return aggregated;
}

// ── Map labels to actual images ──
async function mapLabelsToImages(vehicleId, visualLabels) {
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('id, image_url, vehicle_zone, zone_confidence, condition_score, position')
    .eq('vehicle_id', vehicleId)
    .order('position')
    .limit(50);

  const mappings = [];
  for (const img of (images || [])) {
    const mapping = {
      image_id: img.id,
      position: img.position,
      current_zone: img.vehicle_zone || null,
      current_condition: img.condition_score || null,
      expected_labels: {},
    };

    // If image has a zone, map expected features for that zone
    if (img.vehicle_zone) {
      for (const [zonePattern, labels] of Object.entries(visualLabels)) {
        if (zonePattern.includes('*')) {
          const prefix = zonePattern.replace('*', '');
          if (img.vehicle_zone.startsWith(prefix)) {
            mapping.expected_labels = { ...mapping.expected_labels, ...labels };
          }
        } else if (zonePattern.includes('|')) {
          const zones = zonePattern.split('|');
          if (zones.includes(img.vehicle_zone)) {
            mapping.expected_labels = { ...mapping.expected_labels, ...labels };
          }
        } else if (img.vehicle_zone === zonePattern) {
          mapping.expected_labels = labels;
        }
      }
    }

    // BaT photo ordering heuristic (if no zone classified)
    if (!img.vehicle_zone && img.position != null) {
      const posZone = positionToZoneHeuristic(img.position);
      if (posZone && visualLabels[posZone]) {
        mapping.inferred_zone = posZone;
        mapping.expected_labels = visualLabels[posZone];
      }
    }

    mappings.push(mapping);
  }

  return mappings;
}

// BaT photo ordering → zone heuristic
function positionToZoneHeuristic(pos) {
  if (pos === 0) return 'ext_front_driver';
  if (pos === 1) return 'ext_rear_passenger';
  if (pos >= 2 && pos <= 3) return 'ext_driver_side';
  if (pos >= 4 && pos <= 5) return 'int_dashboard';
  if (pos === 6) return 'mech_engine_bay';
  if (pos >= 7 && pos <= 8) return 'int_front_seats';
  return null; // After position 8, too variable
}

// ── Main ──
async function processVehicle(vehicleId) {
  log(`\n${'═'.repeat(60)}`);
  const { vehicle, claims } = await gatherClaims(vehicleId);
  if (!vehicle) { log(`Vehicle ${vehicleId} not found`); return null; }

  log(`${vehicle.year} ${vehicle.make} ${vehicle.model} — ${claims.length} text claims`);

  // Compute visual expectations
  const visualLabels = computeVisualLabels(claims);
  const zoneCount = Object.keys(visualLabels).length;
  const featureCount = Object.values(visualLabels).reduce((a, z) => a + z.expected_features.length, 0);

  log(`Visual expectations: ${zoneCount} zones, ${featureCount} features`);
  for (const [zone, data] of Object.entries(visualLabels)) {
    log(`  ${zone}: ${data.expected_features.join(', ')} (${data.claim_count} claims, trust ${data.avg_trust})`);
  }

  // Map to images
  const mappings = await mapLabelsToImages(vehicleId, visualLabels);
  const withLabels = mappings.filter(m => Object.keys(m.expected_labels).length > 0);
  log(`\nImages: ${mappings.length} total, ${withLabels.length} with computed labels`);

  // Resolution score
  const claimDiversity = new Set(claims.map(c => c.type)).size;
  const textDepth = Math.min(100, Math.round((claims.length / 50) * 100));
  const visualCoverage = Math.min(100, Math.round((zoneCount / 8) * 100)); // 8 major zones
  const labelDensity = mappings.length > 0 ? Math.round((withLabels.length / mappings.length) * 100) : 0;

  log(`\nLabel Quality Scores:`);
  log(`  Text depth:      ${textDepth}/100 (${claims.length} claims across ${claimDiversity} types)`);
  log(`  Visual coverage:  ${visualCoverage}/100 (${zoneCount} zones with expectations)`);
  log(`  Label density:    ${labelDensity}% of images have computed labels`);

  return {
    vehicle_id: vehicleId,
    ymm: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
    claims: claims.length,
    visual_zones: zoneCount,
    features: featureCount,
    images: mappings.length,
    labeled_images: withLabels.length,
    text_depth: textDepth,
    visual_coverage: visualCoverage,
    label_density: labelDensity,
  };
}

async function main() {
  if (STATS_ONLY) {
    // Show top vehicles by evidence richness
    const { data } = await supabase.rpc('execute_sql', { query: `
      SELECT v.id, v.year, v.make, v.model,
        (SELECT count(*) FROM field_evidence fe WHERE fe.vehicle_id = v.id) as evidence_count,
        CASE WHEN v.highlights IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN v.equipment IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN v.modifications IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN v.known_flaws IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN v.recent_service_history IS NOT NULL THEN 1 ELSE 0 END as rich_field_count
      FROM vehicles v
      WHERE v.status = 'active' AND v.description IS NOT NULL AND length(v.description) > 200
      ORDER BY (SELECT count(*) FROM field_evidence fe WHERE fe.vehicle_id = v.id) DESC
      LIMIT 20
    `});
    log('Top vehicles by evidence richness:');
    for (const r of (data || [])) {
      log(`  ${r.year} ${r.make} ${r.model} — ${r.evidence_count} evidence, ${r.rich_field_count}/5 rich fields`);
    }
    return;
  }

  const targets = [];
  if (VEHICLE_ID) {
    targets.push(VEHICLE_ID);
  } else {
    // Pick richest vehicles
    const { data } = await supabase.rpc('execute_sql', { query: `
      SELECT v.id FROM vehicles v
      WHERE v.status = 'active' AND v.description IS NOT NULL AND length(v.description) > 500
        AND v.highlights IS NOT NULL
      ORDER BY length(v.description) DESC
      LIMIT ${BATCH}
    `});
    for (const r of (data || [])) targets.push(r.id);
  }

  log(`Computing mathematical labels for ${targets.length} vehicles...\n`);
  const results = [];
  for (const vid of targets) {
    const r = await processVehicle(vid);
    if (r) results.push(r);
  }

  if (results.length > 1) {
    log(`\n${'═'.repeat(60)}`);
    log('BATCH SUMMARY');
    log(`${'═'.repeat(60)}`);
    const avgDepth = (results.reduce((a, r) => a + r.text_depth, 0) / results.length).toFixed(0);
    const avgCoverage = (results.reduce((a, r) => a + r.visual_coverage, 0) / results.length).toFixed(0);
    const avgDensity = (results.reduce((a, r) => a + r.label_density, 0) / results.length).toFixed(0);
    const totalLabeled = results.reduce((a, r) => a + r.labeled_images, 0);
    log(`  Vehicles: ${results.length}`);
    log(`  Avg text depth: ${avgDepth}/100`);
    log(`  Avg visual coverage: ${avgCoverage}/100`);
    log(`  Avg label density: ${avgDensity}%`);
    log(`  Total labeled images: ${totalLabeled}`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
