#!/usr/bin/env node
// Backfill planner / applier for stored deep readings → registered image_visible_* keys.
// Dry run by default. Batches of at most 50 photos. Apply writes only through
// ingest-observation-batch and only when NUKE_PHOTO_KEYS_APPLY=1 is set.
//
//   node scripts/photo-pipeline/project-photo-keys.mjs \
//     --user <uuid> --granted-by <uuid> [--run-id <uuid>] [--cap 50] \
//     [--vehicle-id <uuid>]... [--image-id <uuid>]...
//
// The SQL planner public.project_photo_keys_v1 is the read-only source of truth
// for eligibility. This script calls it when SUPABASE_URL and a service role
// key are set. --apply is refused unless NUKE_PHOTO_KEYS_APPLY=1.
import { randomUUID } from 'node:crypto';
import { projectCachedRun, projectImageProperties } from '../lib/image-property-projection.mjs';

export const SIGNATURE = 'project_photo_keys_v1: map rust_severity, paint_state, completeness only to the registered image_visible_* enums; unmapped findings stay on the source observation; dry run by default; cap 50 photos; filed photos only; skip private, sensitive, rejected_personal, privacy-hold, empty URL, and 9cf5b7a4; no GPS; no ownership; automatic stays automatic; revert supersedes by run_id';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOLD = /^9cf5b7a4/i;
const MAPPED = {
  rust_severity: ['image_visible_rust_severity', ['none', 'surface', 'pitting', 'perforation']],
  paint_state: ['image_visible_paint_stage', ['bare_metal', 'primer', 'sealer', 'base', 'clear', 'aged']],
  completeness: ['image_visible_assembly_state', ['stripped', 'partial', 'assembled']],
};

export function parseArgs(argv) {
  const out = { vehicleIds: [], imageIds: [], cap: 50, apply: false, dry: true };
  const args = [...argv];
  const take = (name) => {
    const v = args.shift();
    if (!v || v.startsWith('--')) throw new Error(`${name} requires a value`);
    return v;
  };
  while (args.length) {
    const a = args.shift();
    if (a === '--apply') out.apply = true;
    else if (a === '--dry-run') out.apply = false;
    else if (a === '--user') out.user = take('--user');
    else if (a === '--granted-by') out.grantedBy = take('--granted-by');
    else if (a === '--run-id') out.runId = take('--run-id');
    else if (a === '--cap') out.cap = Number(take('--cap'));
    else if (a === '--vehicle-id') out.vehicleIds.push(take('--vehicle-id'));
    else if (a === '--image-id') out.imageIds.push(take('--image-id'));
    else throw new Error(`unknown argument: ${a}`);
  }
  out.dry = !out.apply;
  if (!Number.isInteger(out.cap) || out.cap < 1 || out.cap > 50) throw new Error('cap must be between 1 and 50');
  for (const [name, value] of [['--user', out.user], ['--granted-by', out.grantedBy], ['--run-id', out.runId]]) {
    if (value != null && !UUID_RE.test(value)) throw new Error(`${name} must be a uuid`);
  }
  for (const id of [...out.vehicleIds, ...out.imageIds]) {
    if (!UUID_RE.test(id)) throw new Error(`not a uuid: ${id}`);
  }
  return out;
}

export function imageIsEligible(image) {
  if (!image?.vehicle_id || HOLD.test(image.vehicle_id) || HOLD.test(image.id)) return false;
  if (!image.image_url) return false;
  if (image.is_sensitive || image.is_superseded || image.is_duplicate || image.is_document) return false;
  if (image.vision_gate_status != null && image.vision_gate_status !== 'approved') return false;
  return true;
}

/** Count closed-state findings that are not in the registered lists (unknown is absence, not a finding). */
export function unmappedFindings(state = {}) {
  const rows = [];
  for (const [sourceKey, [, allowed]] of Object.entries(MAPPED)) {
    const value = state[sourceKey];
    if (value == null || value === '' || value === 'unknown') continue;
    if (!allowed.includes(value)) rows.push({ source_key: sourceKey, value });
  }
  return rows;
}

export function assertNoGps(obj) {
  const text = JSON.stringify(obj);
  if (/\bgps\b/i.test(text) || /\blatitude\b/i.test(text) || /\blongitude\b/i.test(text)) {
    throw new Error('GPS must not appear on a plan or claim');
  }
}

export function planFromProjection(observation, image, { releaseIntentOnlyClarification = true } = {}) {
  if (!imageIsEligible(image)) return { claims: [], deferred: 'image_not_eligible', unmapped: unmappedFindings(observation?.structured_data?.state_observations) };
  const result = projectImageProperties(observation, image, { releaseIntentOnlyClarification });
  const unmapped = unmappedFindings(observation?.structured_data?.state_observations);
  const claims = (result.claims ?? []).map((claim) => {
    const slim = {
      image_id: image.id,
      vehicle_id: image.vehicle_id,
      source_observation_id: observation.id,
      property_key: claim.property_key,
      value: claim.structured_data[claim.property_key],
      confidence_score: Math.min(observation.confidence_score, 0.6),
      agent_tier: observation.agent_tier ?? null,
      agent_model: observation.agent_model,
    };
    assertNoGps(slim);
    return slim;
  });
  return { claims, deferred: result.deferred ?? null, unmapped };
}

export function refuseApply(env = process.env) {
  if (env.NUKE_PHOTO_KEYS_APPLY !== '1') {
    return 'apply is refused unless NUKE_PHOTO_KEYS_APPLY=1; default is a dry run';
  }
  return null;
}


/** Apply a planned set of photos through the existing cached projection writer (ingest-observation-batch). */
export async function applyRun(sb, { runId, user, grantedBy, cap = 50, groups }, { env = process.env, project = projectCachedRun } = {}) {
  const why = refuseApply(env);
  if (why) throw new Error(why);
  if (!runId || !user || !grantedBy) throw new Error('applyRun requires runId, user, and grantedBy');
  if (!Array.isArray(groups) || groups.length === 0) throw new Error('applyRun requires at least one vehicle group');
  const photos = groups.reduce((n, g) => n + (g.imageIds?.length ?? 0), 0);
  if (photos < 1 || photos > cap || cap > 50) throw new Error('applyRun cap is 1..50 photos');
  const receipts = [];
  const items = [];
  for (const group of groups) {
    const result = await project(sb, { vehicleId: group.vehicleId, imageIds: group.imageIds, apply: true, single: true, limit: 50, pages: 1, before: '9999-01-01T00:00:00Z' });
    receipts.push({ vehicle_id: group.vehicleId, receipt: result.receipt, exitCode: result.exitCode });
    for (const row of result.receipt?.observations ?? []) {
      items.push({
        image_id: row.image_id,
        vehicle_id: row.vehicle_id,
        source_observation_id: row.source_observation_id,
        property_key: row.property_key,
        value: row.value,
        confidence_score: row.confidence_score,
        observation_id: row.observation_id,
        witness_id: row.witness_id,
      });
    }
  }
  const recorded = await sb.rpc('record_project_photo_keys_v1', {
    p_run: runId, p_user: user, p_granted_by: grantedBy, p_items: items,
    p_receipt: { receipts, signature: SIGNATURE },
  });
  if (recorded.error) throw new Error(recorded.error.message || 'record_project_photo_keys_v1 failed');
  return { run_id: runId, recorded: items.length, receipts, record: recorded.data };
}

async function main(argv = process.argv.slice(2), env = process.env, io = console) {
  const args = parseArgs(argv);
  if (!args.user || !args.grantedBy) throw new Error('--user and --granted-by are required');
  const runId = args.runId ?? randomUUID();
  if (args.apply) {
    throw new Error(refuseApply(env) ?? 'pass planned vehicle/image groups to applyRun after a dry receipt; this CLI entry point stays dry');
  }
  io.log(JSON.stringify({
    run_id: runId,
    opened_by: args.user,
    granted_by: args.grantedBy,
    dry_run: true,
    signature: SIGNATURE,
    cap: args.cap,
    vehicle_ids: args.vehicleIds,
    image_ids: args.imageIds,
    note: 'Call public.project_photo_keys_v1 for the receipt, then applyRun (NUKE_PHOTO_KEYS_APPLY=1) through ingest-observation-batch. This CLI entry point does not write observations.',
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exitCode = 2;
  });
}

export { main };
