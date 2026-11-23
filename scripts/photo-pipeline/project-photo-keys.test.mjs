import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SIGNATURE, parseArgs, imageIsEligible, unmappedFindings, planFromProjection, refuseApply, assertNoGps, applyRun,
} from './project-photo-keys.mjs';

const IMAGE = {
  id: '11111111-0000-4000-8000-000000000001',
  vehicle_id: '22222222-0000-4000-8000-000000000001',
  image_url: 'https://example.invalid/ok.jpg',
  is_sensitive: false, is_superseded: false, is_duplicate: false, is_document: false,
  vision_gate_status: 'approved',
};

const observation = (over = {}, state = {}) => ({
  id: '33333333-0000-4000-8000-000000000001',
  kind: 'condition', is_superseded: false, vehicle_id: IMAGE.vehicle_id,
  confidence: 'medium', confidence_score: 0.82,
  agent_model: 'fixture-model', agent_tier: 'reviewed',
  extraction_method: 'reviewed_image_analysis_v1',
  observed_at: '2026-11-01T00:00:00.000Z', ingested_at: '2026-11-01T00:00:01.000Z',
  structured_data: {
    analysis_kind: 'image_deep_byok', image_id: IMAGE.id, intent: 'unknown', needs_clarification: false,
    state_observations: { rust_severity: 'none', paint_state: 'primer', completeness: 'partial', ...state },
    narrative_one_line: 'Primered shell, no rust in frame.',
  },
  ...over,
});

test('parseArgs is dry by default, caps at 50, and requires uuids', () => {
  const a = parseArgs(['--user', IMAGE.vehicle_id, '--granted-by', IMAGE.vehicle_id, '--vehicle-id', IMAGE.vehicle_id]);
  assert.equal(a.dry, true);
  assert.equal(a.apply, false);
  assert.equal(a.cap, 50);
  assert.throws(() => parseArgs(['--cap', '51']), /cap/);
  assert.throws(() => parseArgs(['--user', 'nope']), /uuid/);
});

test('eligibility skips unfiled, empty URL, sensitive, rejected, and the hold-out prefix', () => {
  assert.equal(imageIsEligible(IMAGE), true);
  assert.equal(imageIsEligible({ ...IMAGE, vehicle_id: null }), false);
  assert.equal(imageIsEligible({ ...IMAGE, image_url: '' }), false);
  assert.equal(imageIsEligible({ ...IMAGE, is_sensitive: true }), false);
  assert.equal(imageIsEligible({ ...IMAGE, vision_gate_status: 'rejected_personal' }), false);
  assert.equal(imageIsEligible({ ...IMAGE, id: '9cf5b7a4-0000-4000-8000-000000000099' }), false);
});

test('unmapped findings stay counted; unknown is not a finding; only registered values are planned', () => {
  assert.deepEqual(unmappedFindings({ rust_severity: 'flaking', paint_state: 'unknown', completeness: 'assembled' }),
    [{ source_key: 'rust_severity', value: 'flaking' }]);
  const plan = planFromProjection(observation({}, { rust_severity: 'none', paint_state: 'primer', completeness: 'partial' }), IMAGE);
  assert.equal(plan.deferred, null);
  assert.deepEqual(plan.claims.map((c) => [c.property_key, c.value, c.confidence_score]), [
    ['image_visible_rust_severity', 'none', 0.6],
    ['image_visible_paint_stage', 'primer', 0.6],
    ['image_visible_assembly_state', 'partial', 0.6],
  ]);
  const flaking = planFromProjection(observation({}, { rust_severity: 'flaking', paint_state: 'unknown', completeness: 'assembled' }), IMAGE);
  assert.deepEqual(flaking.claims.map((c) => [c.property_key, c.value]), [['image_visible_assembly_state', 'assembled']]);
  assert.deepEqual(flaking.unmapped, [{ source_key: 'rust_severity', value: 'flaking' }]);
});

test('automatic tier is copied; GPS on a claim is refused; apply is refused without the env flag', () => {
  const auto = planFromProjection(observation({ agent_tier: 'subscription automatic' }), IMAGE);
  assert.ok(auto.claims.every((c) => c.agent_tier === 'subscription automatic'));
  assert.throws(() => assertNoGps({ image_id: IMAGE.id, gps: { lat: 34 } }), /GPS/);
  assert.match(refuseApply({}), /NUKE_PHOTO_KEYS_APPLY=1/);
  assert.equal(refuseApply({ NUKE_PHOTO_KEYS_APPLY: '1' }), null);
  assert.match(SIGNATURE, /dry run by default/);
  assert.match(SIGNATURE, /9cf5b7a4/);
});

test('applyRun refuses without the env flag and records ingest receipts when allowed', async () => {
  const sb = { rpc: async () => ({ data: { recorded: 1 }, error: null }) };
  const group = { vehicleId: IMAGE.vehicle_id, imageIds: [IMAGE.id] };
  await assert.rejects(() => applyRun(sb, { runId: IMAGE.id, user: IMAGE.vehicle_id, grantedBy: IMAGE.vehicle_id, groups: [group] }, { env: {} }), /NUKE_PHOTO_KEYS_APPLY=1/);
  const project = async () => ({
    exitCode: 0,
    receipt: {
      inserted: 1,
      observations: [{
        image_id: IMAGE.id, vehicle_id: IMAGE.vehicle_id,
        source_observation_id: '33333333-0000-4000-8000-000000000001',
        property_key: 'image_visible_rust_severity', value: 'none',
        confidence_score: 0.6,
        observation_id: '44444444-0000-4000-8000-000000000001',
        witness_id: '55555555-0000-4000-8000-000000000001',
      }],
    },
  });
  const result = await applyRun(sb, { runId: IMAGE.id, user: IMAGE.vehicle_id, grantedBy: IMAGE.vehicle_id, groups: [group] }, { env: { NUKE_PHOTO_KEYS_APPLY: '1' }, project });
  assert.equal(result.recorded, 1);
  assert.equal(result.receipts[0].receipt.inserted, 1);
});
