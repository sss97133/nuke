#!/usr/bin/env node
// Producer of fact_doubt questions (kind added by 20261120070000). Derives doubts by code, never by hand:
//   contradiction_check: vehicle_facet_items over the header dimensions; an item whose key is registered and whose status is
//                        reading (one reader), conflict or missing, with photographs that show the part, raises one doubt.
//   simulated_reader:    --from <json> [{property_key, words_ref}] from reader simulations; same frame derivation.
// Idempotent: identity is the evidence state (fact_doubt_trigger_key), so unchanged evidence raises nothing. Doubts whose
// evidence changed are retired (retire_evidence_judgment) and the new state is raised. Writes only through raise_evidence_judgment
// and retire_evidence_judgment.
//   cd ~/nuke && dotenvx run --quiet -- node scripts/doubts/raise-fact-doubts.mjs --vehicle <uuid> [--from file.json] [--dry-run]
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { producerVersion } from '../garage/derivation-evidence.mjs';
import { client, arg } from './db.mjs';
import { HEADER_DIMENSIONS, QUESTION, deriveDoubts, doubtsFromReaderFile, pickFrames, frameTermFilter, buildQuestionRow } from './fact-doubts.mjs';

export const SCRIPT = 'scripts/doubts/raise-fact-doubts.mjs';
const inList = (ids) => `in.(${ids.join(',')})`;
const UUID36 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function candidateFrames(db, vehicleId, d) {
  const cand = new Map(); const add = (id, tier) => { if (UUID36.test(id ?? '') && (!cand.has(id) || cand.get(id).tier > tier)) cand.set(id, { id, tier }); };
  for (const id of d.witness_image_ids) add(id, 'witness');
  if (d.roles.length) {
    const rows = await db.req(`vehicle_observations?select=image_id:structured_data->>image_id&vehicle_id=eq.${vehicleId}&is_superseded=not.is.true&structured_data->>claim_role=${inList(d.roles)}&limit=200`);
    for (const r of rows) add(r.image_id, 'role');
  }
  if (d.terms.length) {
    const or = frameTermFilter(d.terms);
    const rows = await db.req(`vehicle_observations?select=image_id:structured_data->>image_id&vehicle_id=eq.${vehicleId}&is_superseded=not.is.true&or=(${or})&limit=200`);
    for (const r of rows) add(r.image_id, 'text');
  }
  const ids = [...cand.keys()];
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const rows = await db.req(`vehicle_images?select=id,taken_at,vision_gate_status,is_sensitive,is_duplicate,is_superseded,is_document,redaction_level,photo_quality_score,scene_type:ai_scan_metadata->byok_deep_analysis->>scene_type&vehicle_id=eq.${vehicleId}&id=${inList(ids.slice(i, i + 50))}`);
    for (const r of rows) out.push({ ...r, tier: cand.get(r.id).tier });
  }
  return out;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const vehicleId = arg(argv, '--vehicle'); const from = arg(argv, '--from'); const dry = argv.includes('--dry-run');
  if (!vehicleId) throw new Error('--vehicle <uuid> required');
  const db = client(env); const version = producerVersion(SCRIPT); const runId = randomUUID();
  const [vehicle] = await db.req(`vehicles?select=id,user_id&id=eq.${vehicleId}&deleted_at=is.null`);
  if (!vehicle) throw new Error('vehicle not found');
  const reg = new Map((await db.req('observation_properties?select=id,property_key,data_type&ratified_at=not.is.null&deprecated_at=is.null&limit=5000')).map((p) => [p.property_key, p]));
  const doubts = []; const unmapped = [];
  for (const dim of HEADER_DIMENSIONS) {
    const r = deriveDoubts({ [dim]: await db.rpc('vehicle_facet_items', { p_vehicle_id: vehicleId, p_dimension: dim }) }, reg);
    doubts.push(...r.doubts); unmapped.push(...r.unmapped);
  }
  if (from) { const r = doubtsFromReaderFile(JSON.parse(readFileSync(from, 'utf8')), reg); doubts.push(...r.doubts); unmapped.push(...r.unmapped); }
  const summary = { run_id: runId, producer_version: version, vehicle_id: vehicleId, dry_run: dry, doubts: [], skipped_no_frames: [], unmapped, retired: 0, errors: [] };
  const seen = new Set();
  for (const d of doubts) {
    if (seen.has(d.property_key)) continue; seen.add(d.property_key);
    try {
      const imageIds = pickFrames(await candidateFrames(db, vehicleId, d));
      const itemIds = [...new Set(d.receipt_item_ids)];
      if (!imageIds.length && !itemIds.length) { summary.skipped_no_frames.push({ property_key: d.property_key, item_key: d.item_key }); continue; }
      const evidenceDb = await db.rpc('fact_doubt_evidence_state', { p_vehicle_id: vehicleId, p_property_key: d.property_key, p_image_ids: imageIds, p_item_ids: itemIds });
      const triggerKey = await db.rpc('fact_doubt_trigger_key', { p_state: { db: evidenceDb } });
      const row = buildQuestionRow({ doubt: d, vehicle, evidenceDb, triggerKey, imageIds, itemIds, runId, version, script: SCRIPT });
      const existing = await db.req(`evidence_judgment_requests?select=id,status&dedupe_key=eq.${row.dedupe_key}`);
      const live = await db.req(`evidence_judgment_requests?select=id,dedupe_key,status&vehicle_id=eq.${vehicleId}&question_kind=eq.${QUESTION}&subject_id=eq.${d.property_id}&status=in.(pending,claimed,answered)`);
      const stale = live.filter((x) => x.dedupe_key !== row.dedupe_key);
      const line = { property_key: d.property_key, origin: d.origin, form: 'property', status: d.status, trigger: triggerKey.slice(0, 12), frames: imageIds, receipt_items: itemIds,
        action: existing.length ? `exists:${existing[0].status}` : 'would_raise', retires: stale.length };
      if (!dry) {
        const [r] = await db.rpc('raise_evidence_judgment', { p_row: row, p_run_id: runId });
        line.action = r.action; line.id = r.id;
        for (const s of stale) {
          const to = await db.rpc('retire_evidence_judgment', { p_id: s.id, p_run_id: runId, p_kind: 'content_changed', p_reason: `evidence changed; re-asked (run ${runId})`, p_superseded_by: r.id });
          if (to !== 'unchanged') summary.retired++;
        }
      }
      summary.doubts.push(line);
    } catch (e) { summary.errors.push(`${d.property_key}: ${e.message}`); }
  }
  summary.rollback = `select * from rollback_evidence_judgment_run('${runId}', '<reason>', false);`;
  return summary;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((s) => { console.log(JSON.stringify(s, null, 1)); process.exitCode = s.errors.length ? 1 : 0; }).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
