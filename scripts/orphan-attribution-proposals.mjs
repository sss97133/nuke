#!/usr/bin/env node
/**
 * Orphan attribution PROPOSALS — propose, never land.
 *
 * ~10K of the user's images have vehicle_id NULL. This script builds
 * evidence-based attribution proposals from three legs:
 *
 *   (a) temporal adjacency — orphan shot within N minutes of frames
 *       already attributed to vehicle V (same shoot session)
 *   (b) GPS cluster — orphan taken at the same site as a confirmed
 *       (vehicle, day) session; same-day site matches score high,
 *       different-day site matches are heavily discounted (the shop
 *       hosts many vehicles)
 *   (c) apple_ml_labels vehicle-type consistency — a PRIOR only;
 *       modifies the score, never proposes alone
 *
 * A proposal requires the temporal OR gps leg. Output is additive
 * telemetry: analysis_events rows with stage='attribution_proposal'.
 * This script NEVER writes vehicle_images.vehicle_id — the confirm
 * queue / in-app agent consumes proposals later.
 *
 * Usage:
 *   npm run ops:orphan-proposals                   # full run
 *   npm run ops:orphan-proposals -- --dry-run      # score, don't insert
 *   npm run ops:orphan-proposals -- --limit=100    # cap inserted proposals
 *   npm run ops:orphan-proposals -- --window=45    # temporal window (min)
 *   npm run ops:orphan-proposals -- --radius=200   # gps radius (meters)
 *   npm run ops:orphan-proposals -- --min-score=0.4
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------- config
const USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4'; // Skylar
const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : dflt;
};
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(arg('limit', '0'), 10); // 0 = no cap
const WINDOW_MIN = parseFloat(arg('window', '30')); // temporal window, minutes
const RADIUS_M = parseFloat(arg('radius', '150')); // gps radius, meters
const MIN_SCORE = parseFloat(arg('min-score', '0.35'));
const PAGE = 1000;
const INSERT_BATCH = 500;
const METHOD = 'orphan_attribution_heuristics_v1';

// Apple ML labels that indicate vehicle content (normalized form).
const VEHICLE_LABELS = new Set([
  'vehicle', 'car', 'truck', 'automobile', 'pickup_truck', 'jeep', 'suv',
  'sedan', 'coupe', 'convertible', 'sportscar', 'sports_car', 'van',
  'motorcycle', 'off_road_vehicle', 'wheel', 'tire', 'rim', 'bumper',
  'vehicle_engine', 'dashboard', 'license_plate', 'engine', 'land_vehicle',
  'auto_part', 'headlight', 'windshield', 'grille',
]);

const normLabel = (l) =>
  String(l).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

// ---------------------------------------------------------------- helpers
const clamp01 = (x) => Math.max(0, Math.min(1, x));

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

async function pageAll(build) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(`page fetch failed at ${from}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

// ---------------------------------------------------------------- load
async function loadOrphans() {
  return pageAll(() =>
    supabase
      .from('vehicle_images')
      .select(
        'id, taken_at, latitude, longitude, apple_ml_labels, camera_model:exif_data->>camera_model'
      )
      .is('vehicle_id', null)
      .eq('user_id', USER_ID)
      .order('id', { ascending: true })
  );
}

async function loadReferenceFrames() {
  return pageAll(() =>
    supabase
      .from('vehicle_images')
      .select(
        'id, vehicle_id, taken_at, latitude, longitude, apple_ml_labels, camera_model:exif_data->>camera_model'
      )
      .not('vehicle_id', 'is', null)
      .eq('user_id', USER_ID)
      .not('taken_at', 'is', null)
      .order('id', { ascending: true })
  );
}

async function loadAlreadyProposed() {
  const rows = await pageAll(() =>
    supabase
      .from('analysis_events')
      .select('image_id')
      .eq('stage', 'attribution_proposal')
      .eq('user_id', USER_ID)
      .order('id', { ascending: true })
  );
  return new Set(rows.map((r) => r.image_id).filter(Boolean));
}

// ---------------------------------------------------------------- indexes
function buildTemporalIndex(refs) {
  const idx = refs
    .filter((r) => r.taken_at)
    .map((r) => ({ ...r, t: Date.parse(r.taken_at) }))
    .sort((a, b) => a.t - b.t);
  return idx;
}

/** binary search: first index with t >= target */
function lowerBound(idx, target) {
  let lo = 0, hi = idx.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (idx[mid].t < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** (vehicle_id, utc-day) GPS sessions with centroid; drops sprawling drive-day clusters */
function buildGpsSessions(refs) {
  const groups = new Map();
  for (const r of refs) {
    if (r.latitude == null || r.longitude == null || !r.taken_at) continue;
    const key = `${r.vehicle_id}|${utcDay(Date.parse(r.taken_at))}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const sessions = [];
  for (const [key, frames] of groups) {
    if (frames.length < 2) continue; // a lone GPS frame is not a session
    const [vehicle_id, day] = key.split('|');
    const lat = frames.reduce((s, f) => s + Number(f.latitude), 0) / frames.length;
    const lon = frames.reduce((s, f) => s + Number(f.longitude), 0) / frames.length;
    const spread = Math.max(
      ...frames.map((f) => haversineM(lat, lon, Number(f.latitude), Number(f.longitude)))
    );
    if (spread > 1000) continue; // driving day, not a site session
    sessions.push({ vehicle_id, day, lat, lon, frames: frames.length });
  }
  return sessions;
}

/** per-vehicle normalized-label frequency profile */
function buildLabelProfiles(refs) {
  const profiles = new Map();
  for (const r of refs) {
    if (!Array.isArray(r.apple_ml_labels) || r.apple_ml_labels.length === 0) continue;
    if (!profiles.has(r.vehicle_id)) profiles.set(r.vehicle_id, new Map());
    const p = profiles.get(r.vehicle_id);
    for (const raw of r.apple_ml_labels) {
      const l = normLabel(raw);
      p.set(l, (p.get(l) || 0) + 1);
    }
  }
  return profiles;
}

// ---------------------------------------------------------------- scoring
function scoreOrphan(orphan, ctx) {
  const { temporalIdx, gpsSessions, labelProfiles } = ctx;
  const t = orphan.taken_at ? Date.parse(orphan.taken_at) : null;
  const candidates = new Map(); // vehicle_id -> { temporal, gps }

  // --- leg (a): temporal adjacency
  if (t != null) {
    const windowMs = WINDOW_MIN * 60 * 1000;
    let i = lowerBound(temporalIdx, t - windowMs);
    for (; i < temporalIdx.length && temporalIdx[i].t <= t + windowMs; i++) {
      const ref = temporalIdx[i];
      const deltaMin = Math.abs(ref.t - t) / 60000;
      const c = candidates.get(ref.vehicle_id) || {};
      if (!c.temporal || deltaMin < c.temporal.delta_minutes) {
        c.temporal = {
          ...(c.temporal || {}),
          delta_minutes: Math.round(deltaMin * 100) / 100,
          nearest_image_id: ref.id,
          nearest_camera_model: ref.camera_model || null,
        };
      }
      c.temporal.frames_in_window = (c.temporal.frames_in_window || 0) + 1;
      candidates.set(ref.vehicle_id, c);
    }
  }

  // --- leg (b): gps session cluster
  if (orphan.latitude != null && orphan.longitude != null) {
    const oLat = Number(orphan.latitude);
    const oLon = Number(orphan.longitude);
    const oDay = t != null ? utcDay(t) : null;
    for (const s of gpsSessions) {
      // cheap prefilter: ~0.01 deg ≈ 1.1km
      if (Math.abs(s.lat - oLat) > 0.01 || Math.abs(s.lon - oLon) > 0.02) continue;
      const dist = haversineM(oLat, oLon, s.lat, s.lon);
      if (dist > RADIUS_M) continue;
      const sameDay = oDay != null && s.day === oDay;
      const c = candidates.get(s.vehicle_id) || {};
      const better =
        !c.gps ||
        (sameDay && !c.gps.same_day) ||
        (sameDay === !!c.gps.same_day && dist < c.gps.distance_m);
      if (better) {
        c.gps = {
          distance_m: Math.round(dist),
          same_day: sameDay,
          session_day: s.day,
          session_frames: s.frames,
        };
        candidates.set(s.vehicle_id, c);
      }
    }
  }

  if (candidates.size === 0) return null;

  // --- leg (c): label prior + camera prior, then combine
  const orphanLabels = Array.isArray(orphan.apple_ml_labels)
    ? orphan.apple_ml_labels.map(normLabel)
    : [];
  const orphanVehicleLabels = orphanLabels.filter((l) => VEHICLE_LABELS.has(l));
  const hasLabels = orphanLabels.length > 0;

  const scored = [];
  for (const [vehicleId, legs] of candidates) {
    const evidence = [];
    let tScore = 0;
    let gScore = 0;

    if (legs.temporal) {
      const supportMult =
        legs.temporal.frames_in_window >= 3 ? 1 : legs.temporal.frames_in_window === 2 ? 0.9 : 0.8;
      tScore = clamp01(1 - legs.temporal.delta_minutes / WINDOW_MIN) * supportMult;
      evidence.push({ type: 'temporal_adjacency', ...legs.temporal, window_minutes: WINDOW_MIN });
    }
    if (legs.gps) {
      const proximity = clamp01(1 - legs.gps.distance_m / RADIUS_M);
      gScore = proximity * (legs.gps.same_day ? 1 : 0.3);
      evidence.push({ type: 'gps_session_match', ...legs.gps, radius_m: RADIUS_M });
    }

    // label prior (never proposes alone — only modifies temporal/gps evidence)
    let labelBonus = 0;
    let labelDampener = 1;
    if (hasLabels) {
      const profile = labelProfiles.get(vehicleId);
      if (orphanVehicleLabels.length > 0 && profile) {
        const shared = orphanVehicleLabels.filter((l) => profile.has(l));
        if (shared.length > 0) {
          labelBonus = 0.1 * (shared.length / orphanVehicleLabels.length);
          evidence.push({
            type: 'label_consistency',
            orphan_vehicle_labels: orphanVehicleLabels,
            shared_with_candidate: shared,
          });
        }
      } else if (orphanVehicleLabels.length === 0) {
        labelDampener = 0.85; // labeled content, none of it vehicle-shaped
        evidence.push({
          type: 'label_inconsistency',
          note: 'apple_ml_labels present but contain no vehicle-type labels',
          orphan_labels_sample: orphanLabels.slice(0, 8),
        });
      }
    }

    // camera continuity prior
    let cameraBonus = 0;
    if (
      orphan.camera_model &&
      legs.temporal?.nearest_camera_model &&
      orphan.camera_model === legs.temporal.nearest_camera_model
    ) {
      cameraBonus = 0.05;
      evidence.push({ type: 'camera_match', camera_model: orphan.camera_model });
    }

    const score = clamp01((0.7 * tScore + 0.45 * gScore + labelBonus + cameraBonus) * labelDampener);
    scored.push({ vehicleId, score, evidence, legs });
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const runnerUp = scored[1];

  // ambiguity penalty: multiple vehicles with comparable evidence
  let finalScore = best.score;
  if (runnerUp && best.score > 0) {
    const ratio = runnerUp.score / best.score;
    finalScore = best.score * (1 - 0.4 * ratio);
    best.evidence.push({
      type: 'ambiguity',
      runner_up_vehicle_id: runnerUp.vehicleId,
      runner_up_score: Math.round(runnerUp.score * 1000) / 1000,
      candidates_considered: scored.length,
    });
  }
  finalScore = Math.round(finalScore * 1000) / 1000;

  if (finalScore < MIN_SCORE) return null;
  // hard gate: temporal OR gps leg required (labels/camera alone never propose)
  if (!best.legs.temporal && !best.legs.gps) return null;

  const basisParts = [];
  if (best.legs.temporal) basisParts.push('temporal');
  if (best.legs.gps) basisParts.push('gps');
  if (best.evidence.some((e) => e.type === 'label_consistency')) basisParts.push('labels');

  return {
    image_id: orphan.id,
    candidate_vehicle_id: best.vehicleId,
    score: finalScore,
    basis: basisParts.join('+'),
    evidence: best.evidence,
  };
}

// ---------------------------------------------------------------- main
async function main() {
  console.log(
    `orphan-attribution-proposals ${DRY_RUN ? '(DRY RUN) ' : ''}window=${WINDOW_MIN}m radius=${RADIUS_M}m min_score=${MIN_SCORE}`
  );

  const [orphans, refs, alreadyProposed] = await Promise.all([
    loadOrphans(),
    loadReferenceFrames(),
    loadAlreadyProposed(),
  ]);
  console.log(
    `loaded: ${orphans.length} orphans, ${refs.length} attributed reference frames, ${alreadyProposed.size} already proposed`
  );

  const ctx = {
    temporalIdx: buildTemporalIndex(refs),
    gpsSessions: buildGpsSessions(refs),
    labelProfiles: buildLabelProfiles(refs),
  };
  console.log(`indexes: ${ctx.gpsSessions.length} gps sessions, ${ctx.labelProfiles.size} vehicle label profiles`);

  const proposals = [];
  let scanned = 0;
  let skippedExisting = 0;
  for (const orphan of orphans) {
    scanned++;
    if (alreadyProposed.has(orphan.id)) {
      skippedExisting++;
      continue;
    }
    const p = scoreOrphan(orphan, ctx);
    if (p) proposals.push(p);
    if (LIMIT && proposals.length >= LIMIT) break;
  }

  const byBasis = {};
  for (const p of proposals) byBasis[p.basis] = (byBasis[p.basis] || 0) + 1;

  const observedAt = new Date().toISOString();
  const rows = proposals.map((p) => ({
    user_id: USER_ID,
    vehicle_id: p.candidate_vehicle_id, // event context only — vehicle_images.vehicle_id is NEVER written
    image_id: p.image_id,
    stage: 'attribution_proposal',
    detail: {
      candidate_vehicle_id: p.candidate_vehicle_id,
      score: p.score,
      basis: p.basis,
      evidence: p.evidence,
      source: 'scripts/orphan-attribution-proposals.mjs',
      method: METHOD,
      observed_at: observedAt,
      trust: 'proposal_unconfirmed',
    },
  }));

  let inserted = 0;
  if (!DRY_RUN) {
    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      const batch = rows.slice(i, i + INSERT_BATCH);
      const { error } = await supabase.from('analysis_events').insert(batch);
      if (error) {
        console.error(`insert failed at batch ${i / INSERT_BATCH}: ${error.message}`);
        process.exit(1);
      }
      inserted += batch.length;
      process.stdout.write(`\rinserted ${inserted}/${rows.length}`);
    }
    if (rows.length) process.stdout.write('\n');
  }

  // top-5 report with vehicle names
  const top5 = [...proposals].sort((a, b) => b.score - a.score).slice(0, 5);
  const vehicleIds = [...new Set(top5.map((p) => p.candidate_vehicle_id))];
  let names = new Map();
  if (vehicleIds.length) {
    const { data } = await supabase
      .from('vehicles')
      .select('id, year, make, model')
      .in('id', vehicleIds);
    names = new Map((data || []).map((v) => [v.id, `${v.year ?? '?'} ${v.make ?? ''} ${v.model ?? ''}`.trim()]));
  }

  console.log('\n=== SUMMARY ===');
  console.log(`orphans scanned:        ${scanned}`);
  console.log(`skipped (already proposed): ${skippedExisting}`);
  console.log(`proposals emitted:      ${proposals.length}${DRY_RUN ? ' (dry run — not written)' : ` (${inserted} inserted)`}`);
  console.log('by basis:');
  for (const [basis, n] of Object.entries(byBasis).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${basis.padEnd(24)} ${n}`);
  }
  console.log('\ntop 5 by confidence:');
  for (const p of top5) {
    console.log(
      `  image ${p.image_id}  →  ${names.get(p.candidate_vehicle_id) || p.candidate_vehicle_id}  score=${p.score} basis=${p.basis}`
    );
    for (const e of p.evidence) {
      const { type, ...rest } = e;
      console.log(`      ${type}: ${JSON.stringify(rest)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
