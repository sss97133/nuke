import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { computeSaturation, factFingerprint, CURRENT_SCHEMA_VERSION, DRY_PASS_LIMIT } from './deep-image-analysis-byok.mjs';
import { projectImageProperties } from './lib/image-property-projection.mjs';

const now = '2026-10-30T20:00:00Z';
function prior() {
  return {
    scene_type: 'engine_bay', build_phase_guess: 'mechanical_assembly',
    intent: 'inspection', intent_confidence: 0.8,
    components_seen: [{ label: 'alternator', part_number_guess: null, confidence: 0.7, bbox: [10, 20, 100, 200] }],
    text_regions: [{ text: '1234', bbox: [12, 22, 60, 80] }],
    damage_localized: [{ label: 'corrosion', severity: 'surface', bbox: [30, 40, 130, 140] }],
    state_observations: { completeness: 'partial', paint_state: 'primer', damage_callouts: ['surface rust', 'scratch'] },
    workshop_signals: { fixturing: 'lift', tools_visible: ['ratchet', 'wrench'] },
    presence: { person: false, dog: false }, camera_pose: { azimuth_deg: 30, elevation_deg: 10 },
    narrative_one_line: 'An alternator is visible beside the engine.',
    open_questions: ['Need an adjacent frame to identify the mounting bracket', 'Need receipt context for the component'],
    context_complete: false,
    saturation: { version: CURRENT_SCHEMA_VERSION, passes: 2, dry_passes: DRY_PASS_LIMIT - 1 },
  };
}

for (const [name, correct] of [
  ['component identity', v => { v.components_seen[0].label = 'starter motor'; }],
  ['part number', v => { v.components_seen[0].part_number_guess = 'ALT-1234'; }],
  ['OCR reading', v => { v.text_regions[0].text = '1284'; }],
  ['localized damage', v => { v.damage_localized[0].severity = 'perforation'; }],
  ['assembly state', v => { v.state_observations.completeness = 'assembled'; }],
  ['intent', v => { v.intent = 'parts_sourcing'; }],
  ['camera coordinates', v => { v.camera_pose.azimuth_deg = 120; }],
  ['evidence region', v => { v.components_seen[0].bbox = [20, 10, 200, 100]; }],
]) {
  test(`a corrected ${name} is progress even with unchanged output counts`, () => {
    const before = prior(), candidate = structuredClone(before); correct(candidate);
    assert.notEqual(factFingerprint(candidate), factFingerprint(before));
    const result = computeSaturation(candidate, before, now);
    assert.equal(result.dry_passes, 0);
    assert.equal(result.saturated, false);
    assert.equal(result.resolved_at, null);
    assert.deepEqual(result.open_facts, candidate.open_questions);
    assert.equal(before.saturation.dry_passes, DRY_PASS_LIMIT - 1, 'the prior interpretation must remain unchanged');
  });
}

test('equivalent output converges despite ordering, caption, confidence and run metadata changes', () => {
  const before = prior(), candidate = structuredClone(before);
  candidate.open_questions.reverse();
  candidate.components_seen[0] = { bbox: [10, 20, 100, 200], confidence: 0.9, part_number_guess: null, label: 'alternator' };
  candidate.state_observations = { damage_callouts: ['scratch', 'surface rust'], paint_state: 'primer', completeness: 'partial' };
  candidate.workshop_signals.tools_visible.reverse();
  candidate.narrative_one_line = 'The frame shows an alternator next to an engine.';
  candidate.agent_notes = 'Another look'; candidate.analyzed_at = now;
  candidate.confidence = 0.99; candidate.intent_confidence = 0.9;
  candidate.provenance = { run_id: 'synthetic-new-run', agent_duration_ms: 2000 };
  assert.equal(factFingerprint(candidate), factFingerprint(before));
  const result = computeSaturation(candidate, before, now);
  assert.equal(result.dry_passes, DRY_PASS_LIMIT);
  assert.equal(result.saturated, true);
  assert.deepEqual(result.open_facts, []);
});

test('reordered component, text and damage collections do not create progress', () => {
  const before = prior();
  before.components_seen.push({ label: 'battery', confidence: 0.8, bbox: [50, 60, 100, 200] });
  before.text_regions.push({ text: 'XYZ', bbox: [30, 40, 100, 200] });
  before.damage_localized.push({ label: 'scratch', severity: 'minor', bbox: [40, 50, 100, 200] });
  const candidate = structuredClone(before);
  for (const key of ['components_seen', 'text_regions', 'damage_localized']) candidate[key].reverse();
  assert.equal(factFingerprint(candidate), factFingerprint(before));
  assert.equal(computeSaturation(candidate, before, now).saturated, true);
});

test('a new schema starts a fresh progress comparison', () => {
  const before = prior(); before.saturation.version = 'previous-schema';
  const result = computeSaturation(structuredClone(before), before, now);
  assert.equal(result.version, CURRENT_SCHEMA_VERSION);
  assert.equal(result.dry_passes, 0);
  assert.equal(result.saturated, false);
});

test('duplicate detections and absent optional collections do not create progress', () => {
  const before = prior(), candidate = structuredClone(before);
  candidate.components_seen.push(structuredClone(candidate.components_seen[0]));
  candidate.open_questions.push(candidate.open_questions[0]);
  assert.equal(factFingerprint(candidate), factFingerprint(before));
  assert.equal(computeSaturation(candidate, before, now).saturated, true);
  before.damage_localized = []; delete candidate.damage_localized;
  assert.equal(factFingerprint(candidate), factFingerprint(before));
});

test('capped evidence and owner clarification do not require repeated inference', () => {
  const candidate = prior(); candidate.context_complete = true;
  candidate.open_questions = ['Part number is illegible because of glare'];
  candidate.needs_clarification = true; candidate.intent = 'unknown'; candidate.intent_confidence = 0.2;
  const result = computeSaturation(candidate, null, now);
  assert.equal(result.saturated, true);
  assert.deepEqual(result.capped, candidate.open_questions);
  assert.deepEqual(result.open_facts, []);
});

test('a condition correction survives refinement and changes the existing projection without changing its prior', () => {
  const before = prior(), candidate = structuredClone(before);
  candidate.state_observations.completeness = 'assembled';
  assert.equal(computeSaturation(candidate, before, now).saturated, false);
  const image = { id: '10000000-0000-4000-8000-000000000001', vehicle_id: '10000000-0000-4000-8000-000000000002',
    is_sensitive: false, is_superseded: false, is_duplicate: false, vision_gate_status: 'approved' };
  const observation = (verdict, id) => ({ id, vehicle_id: image.vehicle_id, kind: 'condition', is_superseded: false,
    observed_at: now, ingested_at: now, confidence: 'medium', confidence_score: 0.8,
    agent_model: 'synthetic-vision-model', extraction_method: 'synthetic-image-method',
    structured_data: { analysis_kind: 'image_deep_byok', image_id: image.id, state_observations: verdict.state_observations } });
  const earlier = observation(before, '10000000-0000-4000-8000-000000000003');
  const corrected = observation(candidate, '10000000-0000-4000-8000-000000000004');
  const oldResult = projectImageProperties(earlier, image);
  const newResult = projectImageProperties(corrected, image);
  assert.equal(oldResult.deferred, null);
  assert.equal(newResult.deferred, null);
  const assembly = result => result.claims.find(claim => claim.property_key === 'image_visible_assembly_state');
  assert.equal(assembly(oldResult).structured_data.image_visible_assembly_state, 'partial');
  assert.equal(assembly(newResult).structured_data.image_visible_assembly_state, 'assembled');
  assert.notEqual(assembly(oldResult).source_identifier, assembly(newResult).source_identifier);
  assert.deepEqual(projectImageProperties(earlier, image), oldResult);
});

test('offline refinement import needs neither Supabase credentials nor network access', () => {
  const env = { ...process.env };
  for (const key of ['SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) delete env[key];
  const moduleUrl = new URL('./deep-image-analysis-byok.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `let calls = 0; globalThis.fetch = () => { calls++; throw Error('offline only'); }; await import(${JSON.stringify(moduleUrl)}); if (calls) process.exit(1);`],
  { env, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
});
