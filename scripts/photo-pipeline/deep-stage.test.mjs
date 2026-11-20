// node --test scripts/photo-pipeline/deep-stage.test.mjs
// The deep-reading and keyed-values stages: how a call is started, how two independent reads become one posted verdict,
// the envelope, and what each answer becomes. No model, no network: the CLI, the orchestrator and PostgREST are stand-ins.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateVerdict } from '../../supabase/functions/_shared/byokImageVerdict.mjs';
import { childCarriesOnlyEnumAndPointers, projectImageProperties } from '../lib/image-property-projection.mjs';
import { stageSchema } from '../lib/byok-stage-schema.mjs';
import {
  AUTOMATIC_METHOD, AUTOMATIC_NOTES, AUTOMATIC_TIER, DEFAULT_MODEL, OPEN_QUESTION_PATTERNS, STATE_STANDARD, admitsFingerprint, admitsFrom, automaticMethod, automaticProvenance, buildEnvelope, countReceipt, deepPrompt, deepReadFrame,
  PRINT_WORDS, REFUSAL_STREAK_STOP, refusalStreak, saysPictureOfPicture, thinNarrative, thinVerdict, thinViolation,
  cliStats, claimAndWork, deepChildEnv, eligibilityHold, intakeShape, keyedValuesForFrame, leanClaudeArgs, newRunId, newStageSummary, readOnce, subscriptionEnv, verdictFromCliOutput, QUESTION_TOKENS, standingReadingHold,
} from './deep-stage.mjs';

const IMAGE = '10000000-0000-4000-8000-000000000001', VEHICLE = '20000000-0000-4000-8000-000000000001';
// The shared cases of the thin-tier rule: the database guard's contract test carries the same ones (contract-tiers Rule 1).
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/automatic-thin-verdicts.json', import.meta.url), 'utf8'));
const ADMITS = admitsFrom({ automatic: { admits: FIXTURE.admits } });
const verdict = (over = {}, state = {}) => ({
  image_id: IMAGE, vehicle_id: VEHICLE, scene_type: 'body_exterior', build_phase_guess: 'final_assembly', intent: 'documentation', intent_confidence: 0.9,
  needs_clarification: false, components_seen: [{ label: 'Front wheel', confidence: 0.8, bbox: [100, 400, 300, 800], part_number_guess: null }],
  text_regions: [], damage_localized: [],
  state_observations: { rust_severity: 'none', paint_state: 'aged', completeness: 'assembled', damage_callouts: [], ...state },
  workshop_signals: { tools_visible: [], fixturing: 'unknown', weld_quality: 'unknown', lighting: 'natural_outdoor' },
  presence: { person: false, dog: false, place_hint: null },
  camera_pose: { method: 'full-frame visual inspection; no calibrated pose', framing: 'whole car', azimuth_deg: null, elevation_deg: null, distance_est: null, exif_present: null },
  narrative_one_line: 'A complete car stands in the frame.', confidence: 0.8, context_complete: true, open_questions: [], agent_notes: '', ...over,
});
const cli = (v, extra = {}) => JSON.stringify({ type: 'result', is_error: false, num_turns: 2, total_cost_usd: 0.0412,
  usage: { input_tokens: 4, cache_creation_input_tokens: 9000, cache_read_input_tokens: 23000, output_tokens: 1300 }, modelUsage: { 'claude-sonnet-5-5': {} },
  structured_output: { verdicts: [v] }, ...extra });

test('every call starts lean: no CLAUDE.md, memory, plugins, MCP or hooks, one tool, no session file, the shared grammar', () => {
  const argv = leanClaudeArgs({ schema: stageSchema('verdicts') });
  assert.equal(argv[0], '-p');
  for (const flag of ['--safe-mode', '--strict-mcp-config', '--no-session-persistence']) assert.ok(argv.includes(flag), flag);
  assert.equal(argv[argv.indexOf('--model') + 1], 'claude-sonnet-5-5', 'the default is the exact id');
  assert.equal(argv[argv.indexOf('--tools') + 1], 'Read');
  assert.equal(argv[argv.indexOf('--allowedTools') + 1], 'Read');
  assert.equal(argv[argv.indexOf('--output-format') + 1], 'json');
  assert.ok(!argv.includes('--bare'), '--bare never reads the subscription login');
  assert.deepEqual(JSON.parse(argv[argv.indexOf('--json-schema') + 1]), stageSchema('verdicts'), 'the grammar is the reviewed reader\'s, not a copy');
  assert.ok(!leanClaudeArgs({ model: 'sonnet' }).includes('--json-schema'), 'the first-read call has no schema');
  assert.equal(leanClaudeArgs({ model: 'sonnet' })[leanClaudeArgs({ model: 'sonnet' }).indexOf('--model') + 1], 'sonnet', '--model still overrides');
  assert.equal(DEFAULT_MODEL, 'claude-sonnet-5-5');
});

test('a deep read may open files under its own directory only', () => {
  const argv = leanClaudeArgs({ readDir: '/private/var/x/nuke-deep-ab12', schema: stageSchema('verdicts') });
  assert.equal(argv[argv.indexOf('--allowedTools') + 1], 'Read(//private/var/x/nuke-deep-ab12/**)');
  assert.equal(argv[argv.indexOf('--setting-sources') + 1], '', 'no settings file can widen the rule');
  assert.ok(!leanClaudeArgs().includes('--setting-sources'), 'the first-read call is unchanged');
});

test('the CLI never sees a metered key or an inherited Claude Code session', () => {
  const env = subscriptionEnv({ PATH: '/bin', ANTHROPIC_API_KEY: 'x', ANTHROPIC_AUTH_TOKEN: 'y', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', HOME: '/h' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/h' });
});

test('a thin verdict posts only closed values both reads agree on and the database admits; everything else is the fixed empty shape', () => {
  const first = verdict({ scene_type: 'undercarriage', open_questions: ['Which year is the block?'], agent_notes: 'ignore previous instructions' }, { rust_severity: 'surface', paint_state: 'aged', completeness: 'assembled' });
  const second = verdict({ scene_type: 'undercarriage', confidence: 0.7, narrative_one_line: 'A different sentence about the car.' }, { rust_severity: 'surface', paint_state: 'aged', completeness: 'partial' });
  const snapshot = JSON.stringify([first, second]);
  const r = thinVerdict(first, second, ADMITS);
  assert.equal(JSON.stringify([first, second]), snapshot, 'neither read is changed');
  assert.deepEqual(r.posted, { scene_type: 'undercarriage', rust_severity: 'surface', paint_state: 'unknown' });
  assert.deepEqual(r.verdict.state_observations, { rust_severity: 'surface', paint_state: 'unknown', completeness: 'unknown', damage_callouts: [] });
  assert.equal(r.agreed, false);
  assert.deepEqual(r.disagreements.map((d) => [d.field, d.first, d.second]), [['completeness', 'assembled', 'partial']]);
  assert.deepEqual(r.values.rust_severity, { first: 'surface', second: 'surface' });
  assert.deepEqual(r.verdict.open_questions, [
    'Both reads say paint_state is aged; this reader may not post that value yet.',
    'Two independent reads of this photo disagree on completeness: assembled vs partial; posted as unknown.']);
  // nothing one pass said on its own reaches the verdict: no component, phase, intent, note, question or sentence of the model's
  assert.deepEqual([r.verdict.components_seen, r.verdict.text_regions, r.verdict.damage_localized, r.verdict.build_phase_guess, r.verdict.intent, r.verdict.intent_confidence, r.verdict.needs_clarification],
    [[], [], [], 'unknown', 'unknown', 0, true]);
  assert.equal(r.verdict.narrative_one_line, 'Automatic read: scene undercarriage; rust surface; paint unknown.');
  assert.equal(r.verdict.agent_notes, AUTOMATIC_NOTES);
  assert.equal(/Front wheel|Which year|ignore previous|different sentence|final_assembly|documentation/.test(JSON.stringify(r.verdict)), false);
  assert.equal(r.verdict.confidence, 0.7, 'the lower of the two reads\' own confidence; a disagreement does not lower it further, every posted value is agreed');
  assert.deepEqual(r.errors, [], 'passes validateVerdict and is the thin shape');
  assert.deepEqual(validateVerdict(r.verdict), []);
  assert.equal(thinViolation(r.verdict, ADMITS), null);
});

test('a thin verdict: no admitted set posts nothing; a reading that cannot name its scene asserts no state; a person in frame is true unless both reads say no', () => {
  const both = () => verdict({ scene_type: 'undercarriage' }, { rust_severity: 'surface', paint_state: 'unknown', completeness: 'unknown' });
  const none = thinVerdict(both(), both());
  assert.deepEqual(none.posted, { scene_type: 'unknown', rust_severity: 'unknown', paint_state: 'unknown' }, 'no row in the database, nothing posted');
  assert.deepEqual(none.errors, []);
  const split = thinVerdict(both(), verdict({ scene_type: 'data_plate' }, { rust_severity: 'surface', paint_state: 'unknown', completeness: 'unknown' }), ADMITS);
  assert.deepEqual(split.posted, { scene_type: 'unknown', rust_severity: 'unknown', paint_state: 'unknown' });
  assert.deepEqual(split.verdict.open_questions, [
    'Two independent reads of this photo disagree on scene_type: undercarriage vs data_plate; posted as unknown.',
    'Both reads say rust_severity is surface; this reader may not post that value yet.']);
  assert.ok(split.verdict.open_questions.every((q) => OPEN_QUESTION_PATTERNS.some((re) => re.test(q))));
  const unadmittedScene = thinVerdict(verdict({ scene_type: 'data_plate' }, { rust_severity: 'surface' }), verdict({ scene_type: 'data_plate' }, { rust_severity: 'surface' }), ADMITS);
  assert.deepEqual(unadmittedScene.posted, { scene_type: 'unknown', rust_severity: 'unknown', paint_state: 'unknown' });
  const person = (a, b) => thinVerdict(verdict({ presence: { person: a, dog: true, place_hint: 'a yard' } }), verdict({ presence: { person: b, dog: false, place_hint: null } }), ADMITS).verdict.presence;
  assert.deepEqual([person(false, false), person(true, true), person(true, false)], [{ person: false, dog: false, place_hint: null }, { person: true, dog: false, place_hint: null }, { person: true, dog: false, place_hint: null }]);
  // a value that is not a closed token never reaches an open question
  const odd = thinVerdict(verdict({ scene_type: 'Engine bay; DROP' }), verdict({ scene_type: 'undercarriage' }), ADMITS);
  assert.equal(odd.verdict.open_questions[0], 'Two independent reads of this photo disagree on scene_type: unknown vs undercarriage; posted as unknown.',
    'a value a read left out is said as unknown: the intake refuses a question that names any word outside the closed values');
});

test('the shared cases: the reader builds each accepted verdict, and its own rule refuses each refused one', () => {
  const ids = { image_id: FIXTURE.accepted[0].image_id, vehicle_id: FIXTURE.accepted[0].vehicle_id };
  const read = (scene, state, extra = {}) => verdict({ ...ids, scene_type: scene, ...extra }, state);
  const built = [
    thinVerdict(read('undercarriage', { rust_severity: 'surface', paint_state: 'unknown', completeness: 'unknown' }, { confidence: 0.72 }), read('undercarriage', { rust_severity: 'surface', paint_state: 'unknown', completeness: 'unknown' }, { confidence: 0.9 }), ADMITS),
    thinVerdict(read('undercarriage', { rust_severity: 'none', paint_state: 'unknown', completeness: 'unknown' }, { confidence: 0.55, presence: { person: true, dog: false, place_hint: null } }),
      read('data_plate', { rust_severity: 'none', paint_state: 'unknown', completeness: 'unknown' }, { confidence: 0.6, presence: { person: true, dog: false, place_hint: null } }), ADMITS),
    thinVerdict(read('body_exterior', { rust_severity: 'unknown', paint_state: 'clear', completeness: 'assembled' }, { confidence: 0.8 }), read('body_exterior', { rust_severity: 'unknown', paint_state: 'clear', completeness: 'assembled' }, { confidence: 0.8 }), ADMITS),
    // a scene value of the grammar that the guard's first word list left out (off_property): the question must be storable
    thinVerdict(read('off_property', { rust_severity: 'unknown', paint_state: 'unknown', completeness: 'partial' }, { confidence: 0.7 }), read('off_property', { rust_severity: 'unknown', paint_state: 'unknown', completeness: 'unknown' }, { confidence: 0.8 }), ADMITS),
  ];
  assert.equal(FIXTURE.accepted.length, built.length);
  built.forEach((b, i) => { assert.deepEqual(b.errors, []); assert.deepEqual(b.verdict, FIXTURE.accepted[i], `accepted case ${i}`); });
  for (const v of FIXTURE.accepted) assert.equal(thinViolation(v, ADMITS), null);
  assert.equal(FIXTURE.refused.length, 26);
  for (const c of FIXTURE.refused) assert.equal(typeof thinViolation(c.verdict, ADMITS), 'string', c.why);
  assert.equal(FIXTURE.agent_notes, AUTOMATIC_NOTES);
  assert.equal(thinNarrative({ scene_type: 'engine_bay', rust_severity: 'unknown', paint_state: 'unknown' }), 'Automatic read: scene engine_bay; rust unknown; paint unknown.');
  // the narrative can never look like a printed sheet to photo_reading_is_print, whatever the values
  assert.equal(/\b(printed|paper|album)\s+(sheet|page)\b|\bprinted\s+(\w+\s+){0,2}(photograph|picture)s?\b/i.test(thinNarrative({ scene_type: 'cross_reference', rust_severity: 'unknown', paint_state: 'unknown' })), false);
});

test('the admitted set is the database row; its fingerprint is part of the method, so a new set is a new reader', () => {
  assert.deepEqual(admitsFrom(null), { scene_type: [], rust_severity: [], paint_state: [] });
  assert.deepEqual(admitsFrom({ automatic: { admits: { scene_type: 'engine_bay', rust_severity: ['surface', 'unknown', 3], completeness: ['assembled'] } } }),
    { scene_type: [], rust_severity: ['surface'], paint_state: [] }, 'not an array admits nothing; unknown and non-strings are dropped; assembly state has no entry');
  const wider = { ...ADMITS, rust_severity: ['surface', 'none'] };
  assert.notEqual(admitsFingerprint(ADMITS), admitsFingerprint(wider));
  assert.equal(admitsFingerprint({ ...ADMITS, scene_type: [...ADMITS.scene_type].reverse() }), admitsFingerprint(ADMITS), 'order does not matter');
  assert.match(automaticMethod(ADMITS), /; pixels only, v2; admits [0-9a-f]{8}$/);
  assert.ok(automaticMethod(ADMITS).length <= 200, 'inside the intake\'s text limit');
});

test('a thin reading keys: the row the intake stores for it projects exactly its posted rust value, through the one-photo route only', () => {
  // the stored row: the verdict plus what the intake adds, the confidence as the writer stores it (the verdict's own, capped at 0.6)
  const stored = (v, over = {}) => ({ id: '30000000-0000-4000-8000-000000000001', kind: 'condition', is_superseded: false, vehicle_id: v.vehicle_id,
    confidence: 'medium', confidence_score: Math.min(v.confidence, 0.6), agent_model: 'claude-sonnet-5-5', agent_tier: AUTOMATIC_TIER, extraction_method: 'reviewed_image_analysis_v1',
    observed_at: '2026-11-20T18:05:00.000Z', ingested_at: '2026-11-20T18:05:03.123456+00:00',
    structured_data: { ...v, analysis_kind: 'image_deep_byok', witness_image_id: v.image_id, is_inferred: true }, ...over });
  const image = (v) => ({ id: v.image_id, vehicle_id: v.vehicle_id, is_sensitive: false, is_superseded: false, is_duplicate: false, is_document: false, vision_gate_status: 'approved', image_vehicle_match_status: 'match' });
  const surface = FIXTURE.accepted[0];
  const withQuestion = { ...surface, open_questions: ['Both reads say paint_state is aged; this reader may not post that value yet.'] };
  for (const v of [surface, withQuestion]) {
    const r = projectImageProperties(stored(v), image(v), { releaseIntentOnlyClarification: true });
    assert.equal(r.deferred, null);
    assert.deepEqual(r.claims.map((c) => [c.property_key, c.structured_data[c.property_key]]), [['image_visible_rust_severity', 'surface']], 'one value, the one both reads agreed on');
    assert.ok(r.claims.every(childCarriesOnlyEnumAndPointers), 'the child carries the value and pointers, no sentence');
    assert.equal(r.claims[0].agent_tier, AUTOMATIC_TIER, 'the keyed value says which kind of reader it came from');
  }
  // every thin reading carries needs_clarification (its intent is unknown by rule): the batch route holds it, as it holds any such reading
  assert.equal(projectImageProperties(stored(surface), image(surface)).deferred, 'source_requires_review');
  // a pair of reads whose own confidence is under 0.6 posts its reading but keys nothing
  const unsure = { ...surface, confidence: 0.55 };
  assert.equal(projectImageProperties(stored(unsure), image(unsure), { releaseIntentOnlyClarification: true }).deferred, 'source_confidence_ineligible');
  // nothing posted, nothing keyed
  assert.equal(projectImageProperties(stored({ ...FIXTURE.accepted[1], confidence: 0.8 }), image(FIXTURE.accepted[1]), { releaseIntentOnlyClarification: true }).deferred, 'no_known_scalar_values');
  assert.equal(projectImageProperties(stored(FIXTURE.accepted[2]), image(FIXTURE.accepted[2]), { releaseIntentOnlyClarification: true }).deferred, 'no_known_scalar_values');
});

test('a picture of a picture posts nothing: either read saying so, by its scene or in its own words, holds the photo', () => {
  const car = (over = {}, state = {}) => verdict({ scene_type: 'body_exterior', narrative_one_line: 'A red coupe stands on a concrete pad.', ...over }, { rust_severity: 'surface', paint_state: 'unknown', completeness: 'unknown', ...state });
  // both passes called a photographed sheet of two printed photos body_exterior (measured 2026-11-20); one of them said "printed"
  const leak = thinVerdict(car(), car({ narrative_one_line: 'Printed page with two photos of a car in body prep.' }), ADMITS);
  assert.equal(leak.held, 'picture_of_picture');
  assert.deepEqual(leak.posted, { scene_type: 'unknown', rust_severity: 'unknown', paint_state: 'unknown' });
  // the hold withholds values this reader may post: "may not post that value yet" would be false, so no question says it
  assert.deepEqual(leak.verdict.open_questions, []);
  assert.deepEqual(leak.errors, []);
  assert.equal(thinViolation(leak.verdict, ADMITS), null);
  assert.equal(/Printed page|red coupe/.test(JSON.stringify(leak.verdict)), false, 'the words that held it are not posted');
  // one read names a reference scene: the disagreement is said (it is true of the reads), the withheld rust value is not
  const split = thinVerdict(car(), car({ scene_type: 'cross_reference' }), ADMITS);
  assert.deepEqual([split.held, split.posted.scene_type, split.posted.rust_severity], ['picture_of_picture', 'unknown', 'unknown']);
  assert.deepEqual(split.verdict.open_questions, ['Two independent reads of this photo disagree on scene_type: body_exterior vs cross_reference; posted as unknown.']);
  // both reads name a scene this reader may not post: that is said, as for any photo
  const both = thinVerdict(car({ scene_type: 'cross_reference' }), car({ scene_type: 'cross_reference' }), ADMITS);
  assert.deepEqual([both.held, both.verdict.open_questions], ['picture_of_picture', ['Both reads say scene_type is cross_reference; this reader may not post that value yet.']]);
  // a real photo is not held
  const real = thinVerdict(car(), car(), ADMITS);
  assert.deepEqual([real.held, real.posted.scene_type, real.posted.rust_severity], [null, 'body_exterior', 'surface']);
  // the words: what a read says about a print, a binder page, a screen...
  for (const s of ['Printed page with two photos of a car in body prep.', 'Binder page holding two printed photos of a red car.', 'A printed sheet pairs a red Firebird with an engine.',
    'Photo of a binder page with two printed photos of a weathered red car.', 'Printed page in a binder holding two photos.',
    'Screenshot of a listing showing a red coupe.', 'Photo of a laptop screen showing a parts diagram.', 'An album page with four photographs.', 'Two prints of the car taped to a wall.',
    'A sheet of paper with a hand-written parts list.', 'Two photographs taped to a board beside the lift.']) {
    assert.ok(PRINT_WORDS.test(s), s);
    assert.ok(saysPictureOfPicture(verdict({ narrative_one_line: s })), s);
  }
  // ...and what it says about a real photo. The brake close-up is a measured false hold of the first, looser pattern.
  for (const s of ['Sheet metal patch welded into the rear quarter panel.', 'Masking paper covers the glass while primer cures.', 'Windscreen and cowl seen from the driver side.',
    'Underside of the car showing the rear axle and leaf springs.', 'Fingerprints on fresh clear coat near the fuel door.', 'Blueprinted engine on a stand.', 'A page of the build: door panel removed.',
    'Dark close-up of a brake rotor, pad backing plate with printed markings and caliper piston, shot sideways through the wheel opening.',
    'A part number is printed on the tag.', 'A chain binder holds the axle on the trailer.', 'Dash with a touchscreen display and a three-spoke wheel.', 'A printed circuit board behind the gauge cluster.']) {
    assert.ok(!PRINT_WORDS.test(s), s);
  }
  // said anywhere a read describes the frame: a component label, the framing, a note, a question
  assert.ok(saysPictureOfPicture(verdict({ components_seen: [{ label: 'Printed photograph of an engine', confidence: 0.7, bbox: [0, 0, 500, 500], part_number_guess: null }] })));
  assert.ok(saysPictureOfPicture(verdict({ camera_pose: { method: 'visual', framing: 'top-down on a binder page', azimuth_deg: null, elevation_deg: null, distance_est: null, exif_present: null } })));
  assert.ok(saysPictureOfPicture(verdict({ agent_notes: 'This appears to be a screenshot.' })));
  assert.ok(!saysPictureOfPicture(verdict()));
});

test('an intake that keeps refusing stops the stage for the fire: a refusal counts, a success resets, anything else leaves the count', () => {
  const refused = { outcome: 'unavailable', error_class: 'review_observation_not_persisted' };
  let n = 0;
  for (const r of [refused, { outcome: 'policy_skip' }, { outcome: 'unavailable', error_class: 'review_projection_refused' }, { outcome: 'unavailable', error_class: 'download_failed' }, refused]) n = refusalStreak(n, r);
  assert.equal(n, REFUSAL_STREAK_STOP);
  assert.equal(refusalStreak(2, { outcome: 'succeeded' }), 0);
  assert.equal(refusalStreak(0, null), 0);
});

test('a thin verdict that cannot be the thin shape is reported, not posted', () => {
  const noIds = thinVerdict({ ...verdict(), image_id: undefined }, { ...verdict(), image_id: undefined }, ADMITS);
  assert.ok(noIds.errors.length > 0);
});

test('provenance tells an automatic reading from the three-pass reviewed one', () => {
  const p = automaticProvenance({ model: 'claude-sonnet-5-5', runId: 'claude-cli-fire-x', durationMs: 41234.6, method: automaticMethod(ADMITS) });
  assert.deepEqual(p, { agent_model: 'claude-sonnet-5-5', agent_tier: 'subscription automatic', extraction_method: automaticMethod(ADMITS),
    run_id: 'claude-cli-fire-x', agent_duration_ms: 41235, agent_cost_cents: null, cost_basis: p.cost_basis });
  assert.match(p.cost_basis, /nothing is billed per photo/);
  assert.equal([AUTOMATIC_TIER, AUTOMATIC_METHOD].join('|'), 'subscription automatic|' + AUTOMATIC_METHOD);
  assert.match(AUTOMATIC_METHOD, /only closed values both passes agree on and the database admits for this reader are posted/, 'the method says what is posted');
  assert.ok(AUTOMATIC_METHOD.length <= 200 && p.cost_basis.length <= 1000, 'inside the intake\'s text limits');
  assert.notEqual(newRunId(new Date('2026-11-20T18:00:00Z'), () => 'a'), newRunId(new Date('2026-11-20T18:10:00Z'), () => 'a'), 'unique per fire');
  assert.match(newRunId(), /^claude-cli-fire-\d{8}T\d{6}Z-[a-z0-9]+$/);
});

test('the envelope is the existing one: verdict, the source as snapshotted and as fetched, the provenance, and nothing else', () => {
  const row = { image_url: 'https://example.test/a.jpg', updated_at: '2026-11-20T18:00:00.123456+00:00' };
  const e = buildEnvelope({ verdict: verdict(), row, reviewedUrl: row.image_url, sha256: 'b'.repeat(64), reviewedAt: '2026-11-20T18:05:00.000Z',
    provenance: automaticProvenance({ model: DEFAULT_MODEL, runId: 'r', durationMs: 1000 }) });
  assert.deepEqual(Object.keys(e), ['action', 'verdict', 'source', 'provenance']);
  assert.equal(e.action, 'record_reviewed_analysis');
  assert.deepEqual(e.source, { image_url: row.image_url, expected_updated_at: row.updated_at, reviewed_url: row.image_url, reviewed_sha256: 'b'.repeat(64), reviewed_at: '2026-11-20T18:05:00.000Z' });
  assert.deepEqual(Object.keys(e.provenance).sort(), ['agent_cost_cents', 'agent_duration_ms', 'agent_model', 'agent_tier', 'cost_basis', 'extraction_method', 'run_id']);
  assert.equal(e.provenance.agent_cost_cents, null);
});

test('a photo that no longer satisfies the intake is not read', () => {
  const ok = { id: IMAGE, vehicle_id: VEHICLE, image_url: 'https://example.test/a.jpg', vision_gate_status: 'approved', image_vehicle_match_status: 'match' };
  assert.equal(eligibilityHold(ok), null);
  assert.equal(eligibilityHold({ ...ok, vision_gate_status: null }), null, 'a missing gate reads as approved, as the SQL does');
  for (const [over, why] of [[{ vehicle_id: null }, 'unfiled'], [{ is_external: true }, 'external'], [{ vision_gate_status: 'pending' }, 'gate_not_approved'],
    [{ is_document: true }, 'document'], [{ doc_flag: true }, 'document'], [{ is_sensitive: true }, 'sensitive'], [{ is_duplicate: true }, 'duplicate'], [{ is_superseded: true }, 'superseded'],
    [{ image_vehicle_match_status: 'mismatch' }, 'vehicle_mismatch'], [{ image_vehicle_match_status: 'unrelated' }, 'vehicle_mismatch'],
    [{ image_url: 'http://example.test/a.jpg' }, 'image_url_not_https'], [{ deep_scene: 'engine_bay' }, 'already_read'],
    [{ deep_scene: 'engine_bay', deep_tier: 'caller-byok subscription' }, 'already_read'], [{ deep_scene: 'engine_bay', deep_tier: 'some other thin reader' }, 'already_read']]) {
    assert.equal(eligibilityHold({ ...ok, ...over }), why, JSON.stringify(over));
  }
  // its own earlier reading: the same method means read (only the receipt is missing); another method means read again
  const mine = { ...ok, deep_scene: 'engine_bay', deep_tier: AUTOMATIC_TIER, deep_method: automaticMethod(ADMITS) };
  assert.equal(eligibilityHold(mine, { method: automaticMethod(ADMITS) }), 'already_read_same_method');
  assert.equal(eligibilityHold(mine, { method: automaticMethod({ ...ADMITS, rust_severity: ['surface', 'none'] }) }), null);
  assert.equal(eligibilityHold(mine), 'already_read_same_method', 'no method given: never read again');
  assert.equal(eligibilityHold(null), 'photo_not_found');
});

test('one CLI answer: valid on its own means the grammar, the identity and validateVerdict', () => {
  const ids = { imageId: IMAGE, vehicleId: VEHICLE };
  assert.equal(verdictFromCliOutput(cli(verdict()), ids).verdict.scene_type, 'body_exterior');
  const inText = JSON.stringify({ is_error: false, result: `Here: ${JSON.stringify({ verdicts: [verdict()] })}` });
  assert.equal(verdictFromCliOutput(inText, ids).verdict.image_id, IMAGE, 'an answer in the result text is read when structured_output is absent');
  for (const [out, why] of [['not json', /no JSON/], [cli(verdict({ image_id: '99999999-0000-4000-8000-000000000009' })), /another photo/],
    [cli(verdict({ components_seen: [{ label: 'x', confidence: 0.5, bbox: [0, 0, 1500, 5], part_number_guess: null }] })), /fails the contract/],
    [JSON.stringify({ structured_output: { verdicts: [verdict(), verdict()] } }), /single verdict/], [JSON.stringify({ result: 'I could not decide.' }), /no JSON/]]) {
    assert.throws(() => verdictFromCliOutput(out, ids), (e) => e.invalidOutput === true && why.test(e.message), String(out).slice(0, 40));
  }
  assert.throws(() => verdictFromCliOutput(JSON.stringify({ is_error: true, api_error_status: 429, result: 'You\'ve hit your 5-hour limit' }), ids), (e) => e.apiStatus === 429);
});

test('a failed read is tried once more; a fault that is the batch\'s is not', async () => {
  const ids = { imageId: IMAGE, vehicleId: VEHICLE };
  let calls = 0;
  const flaky = async () => (++calls === 1 ? 'no json' : cli(verdict()));
  const r = await readOnce({ ask: flaky, ids });
  assert.deepEqual([calls, r.stats.attempts, r.stats.input_tokens, r.stats.output_tokens, r.stats.notional_cost_usd, r.stats.model], [2, 2, 32004, 1300, 0.0412, 'claude-sonnet-5-5']);
  calls = 0;
  await assert.rejects(readOnce({ ask: async () => { calls++; return 'no json'; }, ids }), (e) => e.invalidOutput === true);
  assert.equal(calls, 2, 'one retry, no more');
  calls = 0;
  await assert.rejects(readOnce({ ask: async () => { calls++; return JSON.stringify({ is_error: true, api_error_status: 429, result: 'You\'ve hit your 5-hour limit' }); }, ids }), (e) => e.apiStatus === 429);
  assert.equal(calls, 1, 'a usage limit is not retried');
  calls = 0;
  await assert.rejects(readOnce({ ask: async () => { calls++; throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }); }, ids }), /ENOENT/);
  assert.equal(calls, 1, 'a missing CLI is not retried');
});

// --- a whole photo, with stand-ins ---------------------------------------------------------------------------------

function frameDeps({ row = {}, answers = [], orchestrator = async () => ({ http: 200, success: true, observation_id: '30000000-0000-4000-8000-000000000001' }), download = { ok: true, status: 200 }, snapshotFails = false, readings = [], readingsFail = false } = {}) {
  const calls = { rest: [], ask: [], orchestrator: [], order: [] };
  const base = { id: IMAGE, vehicle_id: VEHICLE, image_url: 'https://example.test/a.jpg', updated_at: '2026-11-20T18:00:00.123456+00:00', file_name: null, deep_scene: null,
    is_sensitive: false, is_superseded: false, is_duplicate: false, is_document: false, doc_flag: null, vision_gate_status: 'approved', image_vehicle_match_status: 'match', ...row };
  let n = 0;
  return { calls, deps: {
    rest: async (q) => {
      calls.rest.push(q);
      // the photo's deep readings, asked of the observations themselves after the stamp says the photo is free
      if (q.startsWith('vehicle_observations?')) { calls.order.push('standing'); if (readingsFail) throw new Error('503'); return readings; }
      calls.order.push('snapshot'); if (snapshotFails) throw new Error('503'); return [base];
    },
    fetchBytes: async (url) => { calls.order.push('download'); return download.ok ? { ok: true, status: 200, bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) } : download; },
    convert: async (raw) => raw.replace(/\.[^.]+$/, '.jpg'),
    ask: async (argv, text, cwd) => { calls.order.push('read'); calls.ask.push({ argv, text, cwd }); const a = answers[n++ % answers.length]; if (a instanceof Error) throw a; return typeof a === 'function' ? a() : a; },
    orchestrator: async (body) => { calls.order.push('post'); calls.orchestrator.push(body); return orchestrator(body); },
  } };
}
const opts = (dir, extra = {}) => ({ dir, contract: 'CONTRACT TEXT', model: DEFAULT_MODEL, runId: 'claude-cli-fire-test', reader: 'claude-cli claude-sonnet-5-5 subscription', now: () => new Date('2026-11-20T18:05:00Z'), admits: ADMITS, ...extra });
const withDir = async (fn) => { const dir = mkdtempSync(join(tmpdir(), 'deep-stage-test-')); try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };
const frame = { id: IMAGE, vehicle_id: VEHICLE, image_url: 'https://example.test/a.jpg' };

test('two agreeing reads: the row is snapshotted before the download, both reads use the lean call, the envelope is posted, the receipt succeeds with the cost in its detail', () => withDir(async (dir) => {
  const { deps, calls } = frameDeps({ answers: [cli(verdict()), cli(verdict())] });
  const r = await deepReadFrame(frame, deps, opts(dir));
  assert.deepEqual(calls.order, ['snapshot', 'standing', 'download', 'read', 'read', 'post'], 'snapshot, the standing-reading check, then bytes, both reads, the intake');
  assert.equal(calls.rest[1], `vehicle_observations?select=id,kind,is_superseded,agent_tier&structured_data->>analysis_kind=eq.image_deep_byok&structured_data->>image_id=eq.${IMAGE}&limit=50`);
  assert.match(calls.rest[0], /select=id,vehicle_id,image_url,updated_at,/);
  assert.match(calls.rest[0], /id=eq\.10000000-0000-4000-8000-000000000001$/);
  assert.equal(calls.ask.length, 2);
  for (const a of calls.ask) {
    assert.equal(a.cwd, dir);
    assert.deepEqual(JSON.parse(a.argv[a.argv.indexOf('--json-schema') + 1]), stageSchema('verdicts'));
    assert.ok(a.argv.includes('--safe-mode'));
    assert.match(a.text, /CONTRACT TEXT/);
    assert.match(a.text, new RegExp(`The image is the file at ${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/${IMAGE}\\.jpg`));
  }
  assert.equal(calls.orchestrator.length, 1);
  const e = calls.orchestrator[0];
  assert.equal(e.action, 'record_reviewed_analysis');
  assert.deepEqual({ ...e.source, reviewed_sha256: undefined }, { image_url: 'https://example.test/a.jpg', expected_updated_at: '2026-11-20T18:00:00.123456+00:00', reviewed_url: 'https://example.test/a.jpg',
    reviewed_sha256: undefined, reviewed_at: '2026-11-20T18:05:00.000Z' });
  assert.equal(e.source.reviewed_sha256, createHash('sha256').update(Buffer.from([0xff, 0xd8, 0xff, 0xd9])).digest('hex'), 'the hash of the bytes fetched');
  assert.equal(e.provenance.agent_tier, 'subscription automatic');
  assert.equal(e.provenance.agent_model, 'claude-sonnet-5-5');
  assert.equal(e.provenance.run_id, 'claude-cli-fire-test');
  assert.equal(e.provenance.extraction_method, automaticMethod(ADMITS));
  assert.equal(thinViolation(e.verdict, ADMITS), null, 'what is posted is the thin shape');
  assert.deepEqual([e.verdict.scene_type, e.verdict.state_observations.rust_severity, e.verdict.components_seen], ['body_exterior', 'unknown', []], 'the scene is admitted; "none" is not');
  assert.deepEqual(r.receipt.detail.posted, { scene_type: 'body_exterior', rust_severity: 'unknown', paint_state: 'unknown' });
  assert.equal(r.receipt.detail.admits.fingerprint, admitsFingerprint(ADMITS));
  assert.equal(r.receipt.outcome, 'succeeded');
  assert.equal(r.receipt.detail.observation_id, '30000000-0000-4000-8000-000000000001');
  assert.equal(r.receipt.detail.agreed, true);
  assert.equal(r.receipt.detail.reads.length, 2);
  assert.deepEqual([r.receipt.detail.reads[0].input_tokens, r.receipt.detail.reads[0].output_tokens, r.receipt.detail.reads[0].notional_cost_usd], [32004, 1300, 0.0412]);
  assert.deepEqual(r.receipt.detail.reads[0].state, { scene_type: 'body_exterior', rust_severity: 'none', paint_state: 'aged', completeness: 'assembled' });
  assert.equal(/input_tokens|output_tokens|total_cost|notional_cost_usd/.test(JSON.stringify(e)), false, 'cost and tokens are in the receipt, not the testimony');
  assert.deepEqual(readdirSync(dir), [], 'the downloaded bytes are removed');
}));

test('two disagreeing reads: the unknown is posted, the receipt keeps both reads\' raw values', () => withDir(async (dir) => {
  const { deps, calls } = frameDeps({ answers: [cli(verdict({ scene_type: 'undercarriage' }, { rust_severity: 'none', paint_state: 'unknown', completeness: 'unknown' })), cli(verdict({ scene_type: 'undercarriage' }, { rust_severity: 'surface', paint_state: 'unknown', completeness: 'unknown' }))] });
  const r = await deepReadFrame(frame, deps, opts(dir));
  const posted = calls.orchestrator[0].verdict;
  assert.equal(posted.state_observations.rust_severity, 'unknown');
  assert.deepEqual(posted.open_questions, ['Two independent reads of this photo disagree on rust_severity: none vs surface; posted as unknown.']);
  assert.equal(r.receipt.outcome, 'succeeded');
  assert.deepEqual([r.receipt.detail.agreed, r.receipt.detail.disagreements], [false, ['rust_severity']]);
  assert.deepEqual(r.receipt.detail.values.rust_severity, { first: 'none', second: 'surface' });
}));

test('two reads that agree on an admitted value post it', () => withDir(async (dir) => {
  const one = () => cli(verdict({ scene_type: 'undercarriage' }, { rust_severity: 'surface', paint_state: 'unknown', completeness: 'unknown' }));
  const { deps, calls } = frameDeps({ answers: [one(), one()] });
  const r = await deepReadFrame(frame, deps, opts(dir));
  assert.deepEqual(calls.orchestrator[0].verdict.state_observations, { rust_severity: 'surface', paint_state: 'unknown', completeness: 'unknown', damage_callouts: [] });
  assert.equal(calls.orchestrator[0].verdict.narrative_one_line, 'Automatic read: scene undercarriage; rust surface; paint unknown.');
  assert.deepEqual(r.receipt.detail.posted, { scene_type: 'undercarriage', rust_severity: 'surface', paint_state: 'unknown' });
}));

test('the reader\'s own earlier reading: the same method closes the stage without a read; another method reads again; anyone else\'s reading is final', () => withDir(async (dir) => {
  const one = () => cli(verdict({ scene_type: 'undercarriage' }, { rust_severity: 'surface' }));
  const same = frameDeps({ row: { deep_scene: 'undercarriage', deep_tier: AUTOMATIC_TIER, deep_method: automaticMethod(ADMITS) }, answers: [one(), one()] });
  const a = await deepReadFrame(frame, same.deps, opts(dir));
  assert.deepEqual([a.receipt.outcome, a.receipt.detail.already_read, same.calls.ask.length, same.calls.orchestrator.length], ['succeeded', 'same_method', 0, 0]);
  const older = frameDeps({ row: { deep_scene: 'undercarriage', deep_tier: AUTOMATIC_TIER, deep_method: 'claude-cli two passes; v1' }, answers: [one(), one()] });
  const b = await deepReadFrame(frame, older.deps, opts(dir));
  assert.deepEqual([b.receipt.outcome, older.calls.ask.length, older.calls.orchestrator.length], ['succeeded', 2, 1]);
  const reviewed = frameDeps({ row: { deep_scene: 'undercarriage', deep_tier: 'caller-byok subscription' }, answers: [one(), one()] });
  const c = await deepReadFrame(frame, reviewed.deps, opts(dir));
  assert.deepEqual([c.receipt.outcome, c.receipt.detail.skipped, reviewed.calls.ask.length], ['policy_skip', 'already_read', 0]);
  assert.match(same.calls.rest[0], /deep_tier:ai_scan_metadata->byok_deep_analysis->>agent_tier,deep_method:ai_scan_metadata->byok_deep_analysis->>extraction_method/);
}));

test('fewer than two valid reads posts nothing and the receipt is a retryable one', () => withDir(async (dir) => {
  // the second read is invalid twice (original and the one retry)
  const bad = cli(verdict({ components_seen: [{ label: 'x', confidence: 0.5, bbox: [0, 0, 1500, 5], part_number_guess: null }] }));
  const { deps, calls } = frameDeps({ answers: [cli(verdict()), bad, bad] });
  const r = await deepReadFrame(frame, deps, opts(dir));
  assert.equal(calls.orchestrator.length, 0, 'nothing posted');
  assert.deepEqual([r.receipt.outcome, r.receipt.error_class, r.receipt.retry_after_seconds], ['unavailable', 'reader_output_invalid', 1800]);
  assert.equal(r.receipt.detail.no_two_valid_reads, true);
  assert.match(r.receipt.detail.why, /^the verdict fails the contract: /, 'the receipt says why the read was refused');
  assert.equal(r.valid, false);
}));

test('one failed read is retried once and the photo still posts', () => withDir(async (dir) => {
  const answers = ['no json', cli(verdict()), cli(verdict())];
  let i = 0;
  const { deps, calls } = frameDeps({ answers: [() => answers[i++]] });
  const r = await deepReadFrame(frame, deps, opts(dir));
  assert.equal(calls.ask.length, 3);
  assert.equal(r.receipt.outcome, 'succeeded');
  assert.deepEqual(r.receipt.detail.reads.map((x) => x.attempts).sort(), [1, 2]);
}));

test('a usage limit mid-photo stops the batch and posts nothing', () => withDir(async (dir) => {
  const limit = JSON.stringify({ is_error: true, api_error_status: 429, result: 'You\'ve hit your 5-hour limit' });
  const { deps, calls } = frameDeps({ answers: [limit] });
  const r = await deepReadFrame(frame, deps, opts(dir));
  assert.deepEqual([r.receipt.outcome, r.receipt.error_class, r.stop, calls.orchestrator.length], ['rate_limited', 'reader_usage_limit', true, 0]);
}));

test('a reading that is not this reader\'s already stands on the photo, by the observation and not the stamp: no read is spent', () => withDir(async (dir) => {
  const reading = (over = {}) => ({ id: '30000000-0000-4000-8000-000000000009', kind: 'condition', is_superseded: false, agent_tier: 'caller-byok subscription', ...over });
  // a reviewed reading whose stamp is missing, one with no tier at all (legacy), one of a tier nobody listed: all stand
  for (const r of [reading(), reading({ agent_tier: null }), reading({ agent_tier: 'interactive' })]) {
    const { deps, calls } = frameDeps({ readings: [r], answers: [cli(verdict())] });
    const got = await deepReadFrame(frame, deps, opts(dir));
    assert.deepEqual([got.receipt.outcome, got.receipt.detail.skipped, calls.order], ['policy_skip', 'already_read', ['snapshot', 'standing']], String(r.agent_tier));
  }
  // this reader's own earlier reading, a superseded reading and a row of another kind do not stand in the way
  for (const r of [reading({ agent_tier: AUTOMATIC_TIER }), reading({ is_superseded: true }), reading({ kind: 'specification' })]) {
    const { deps, calls } = frameDeps({ readings: [r], answers: [cli(verdict())] });
    const got = await deepReadFrame(frame, deps, opts(dir));
    assert.deepEqual([got.receipt.outcome, calls.ask.length, calls.orchestrator.length], ['succeeded', 2, 1], JSON.stringify(r));
  }
  assert.equal(standingReadingHold([]), null);
  assert.equal(standingReadingHold(null), null);
  // the check could not be made: nothing is read, and the batch goes on
  const { deps, calls } = frameDeps({ readingsFail: true, answers: [cli(verdict())] });
  const got = await deepReadFrame(frame, deps, opts(dir));
  assert.deepEqual([got.receipt.outcome, got.receipt.error_class, got.stop, calls.ask.length], ['unavailable', 'review_source_unavailable', false, 0]);
  // a dry run reads the photo all the same (it posts nothing)
  const dry = frameDeps({ readings: [reading()], answers: [cli(verdict())] });
  const d = await deepReadFrame(frame, dry.deps, opts(dir, { post: false }));
  assert.deepEqual([d.valid, dry.calls.ask.length, dry.calls.orchestrator.length], [true, 2, 0]);
}));

test('the database\'s two words for an automatic reading it refuses: a standing reading closes the photo, a wrong shape stops the stage', () => withDir(async (dir) => {
  const over = frameDeps({ answers: [cli(verdict())], orchestrator: async () => ({ http: 409, success: false, error: 'thin_review_over_reviewed' }) });
  const a = await deepReadFrame(frame, over.deps, opts(dir));
  assert.deepEqual([a.receipt.outcome, a.receipt.detail.skipped, a.receipt.detail.intake_error, a.stop], ['policy_skip', 'already_read', 'thin_review_over_reviewed', false]);
  const shape = frameDeps({ answers: [cli(verdict())], orchestrator: async () => ({ http: 409, success: false, error: 'thin_review_asserts_unchecked_field' }) });
  const b = await deepReadFrame(frame, shape.deps, opts(dir));
  assert.deepEqual([b.receipt.outcome, b.receipt.error_class, b.receipt.retry_after_seconds, b.stop], ['unavailable', 'thin_shape_refused', 3600, true]);
  // an orchestrator that does not pass the words on answers as before: an hour's wait, the stage goes on, the streak counts it
  const opaque = frameDeps({ answers: [cli(verdict())], orchestrator: async () => ({ http: 502, success: false, error: 'review_observation_not_persisted' }) });
  const c = await deepReadFrame(frame, opaque.deps, opts(dir));
  assert.deepEqual([c.receipt.outcome, c.receipt.error_class, c.receipt.retry_after_seconds, c.stop, refusalStreak(0, c.receipt)], ['unavailable', 'review_observation_not_persisted', 3600, false, 1]);
}));

test('the words a question may name are the grammar\'s closed values, the list the intake guard holds', () => {
  // c_vocab of image_reading_thin_violation (migration 20261120140000): a value added to the grammar must be added there
  const guard = ['unknown', 'engine_bay', 'body_exterior', 'body_interior', 'undercarriage', 'receipt_document', 'data_plate', 'hand_drawn_diagram',
    'shop_context', 'fabrication_in_progress', 'paint_booth', 'wheel_assembly', 'road_test', 'off_property', 'cross_reference', 'product_screenshot', 'spreadsheet',
    'none', 'surface', 'pitting', 'perforation', 'bare_metal', 'primer', 'sealer', 'base', 'clear', 'aged', 'stripped', 'partial', 'assembled'];
  assert.deepEqual([...QUESTION_TOKENS].sort(), [...guard].sort());
  // every question the merge step can write names only those words, whatever the reads hold
  const odd = thinVerdict(verdict({ scene_type: 'off_property' }, { rust_severity: 'rusty', paint_state: undefined, completeness: 'partial' }), verdict({ scene_type: 'off_property' }, { rust_severity: 'surface', paint_state: 'clear', completeness: 'partial' }), ADMITS);
  for (const q of odd.verdict.open_questions) {
    const words = q.match(/: ([a-z_]+) vs ([a-z_]+); posted as/)?.slice(1) ?? q.match(/ is ([a-z_]+); this reader may not/)?.slice(1) ?? ['no match'];
    assert.ok(words.every((w) => guard.includes(w)), q);
    assert.ok(OPEN_QUESTION_PATTERNS.some((p) => p.test(q)), q);
  }
  assert.ok(odd.verdict.open_questions.includes('Both reads say scene_type is off_property; this reader may not post that value yet.'));
  assert.ok(odd.verdict.open_questions.includes('Two independent reads of this photo disagree on rust_severity: unknown vs surface; posted as unknown.'));
  assert.ok(odd.verdict.open_questions.length <= 8);
});

test('a photo that moved or left is a policy skip and spends no read; bytes that will not download are the download receipts', () => withDir(async (dir) => {
  for (const [row, why] of [[{ is_document: true }, 'document'], [{ vehicle_id: null }, 'unfiled'], [{ is_external: true }, 'external'], [{ is_sensitive: true }, 'sensitive'], [{ deep_scene: 'body_exterior' }, 'already_read']]) {
    const { deps, calls } = frameDeps({ row, answers: [cli(verdict())] });
    const r = await deepReadFrame(frame, deps, opts(dir));
    assert.deepEqual([r.receipt.outcome, r.receipt.detail.skipped, calls.order], ['policy_skip', why, ['snapshot']], why);
  }
  { // a gate that has not passed is a pause the ledger reopens, not a policy skip it never would
    const { deps, calls } = frameDeps({ row: { vision_gate_status: 'review_needed' }, answers: [cli(verdict())] });
    const r = await deepReadFrame(frame, deps, opts(dir));
    assert.deepEqual([r.receipt.outcome, r.receipt.error_class, r.receipt.retry_after_seconds, calls.order], ['unavailable', 'gate_not_approved', 3600, ['snapshot']]);
  }
  let { deps } = frameDeps({ download: { ok: false, status: 404 }, answers: [cli(verdict())] });
  let r = await deepReadFrame(frame, deps, opts(dir));
  assert.deepEqual([r.receipt.outcome, r.receipt.error_class, r.receipt.http_status], ['blocked_input', 'image_http_error', 404]);
  ({ deps } = frameDeps({ snapshotFails: true, answers: [] }));
  r = await deepReadFrame(frame, deps, opts(dir));
  assert.deepEqual([r.receipt.outcome, r.receipt.error_class, r.stop], ['unavailable', 'review_source_unavailable', false], 'a failed snapshot does not end the batch');
}));

test('every answer of the intake becomes a typed receipt', () => withDir(async (dir) => {
  const run = async (intake) => (await deepReadFrame(frame, frameDeps({ answers: [cli(verdict())], orchestrator: async () => intake }).deps, opts(dir)));
  const row = async (intake) => { const r = (await run(intake)).receipt; return [r.outcome, r.error_class ?? r.detail.skipped ?? null, r.retry_after_seconds ?? null, r.stop ?? false]; };
  assert.deepEqual(await row({ http: 200, success: true, observation_id: 'o' }), ['succeeded', null, null, false]);
  for (const code of ['review_source_changed', 'review_projection_not_persisted']) {
    assert.deepEqual(await row({ http: 409, success: false, error: code }), ['unavailable', code, 120, false], code);
  }
  // each attempt costs two reads: a refusal the reader cannot see the reason for waits an hour, and so does a withdrawal
  for (const code of ['review_projection_refused', 'review_source_withdrawn']) assert.deepEqual(await row({ http: 409, success: false, error: code }), ['unavailable', code, 3600, false], code);
  assert.deepEqual(await row({ http: 409, success: false, error: 'review_source_previously_withdrawn' }), ['policy_skip', 'review_source_previously_withdrawn', null, false]);
  for (const code of ['invalid_review_envelope', 'invalid_review_verdict', 'invalid_review_camera', 'invalid_review_regions', 'invalid_review_source', 'review_too_large']) {
    assert.deepEqual(await row({ http: 400, success: false, error: code }), ['unavailable', 'reader_output_invalid', 1800, false], code);
  }
  assert.deepEqual(await row({ http: 403, success: false, error: 'review_requires_service_role' }), ['unavailable', 'orchestrator_unauthorized', 900, true]);
  assert.deepEqual(await row({ http: 401, error: 'unauthorized' }), ['unavailable', 'orchestrator_unauthorized', 900, true]);
  assert.deepEqual(await row({ http: 429 }), ['rate_limited', 'orchestrator_rate_limited', 900, false]);
  for (const [http, code] of [[503, 'review_source_unavailable'], [500, 'review_persistence_failed']]) {
    assert.deepEqual(await row({ http, success: false, error: code }), ['unavailable', code, 900, false], code);
  }
  // not written: the ingest failed or the database's rule for this tier refused the row; each attempt spends two reads, so an hour
  assert.deepEqual(await row({ http: 502, success: false, error: 'review_observation_not_persisted' }), ['unavailable', 'review_observation_not_persisted', 3600, false]);
  assert.deepEqual(await row({ http: 0, error: 'orchestrator_request_error' }), ['unavailable', 'orchestrator_request_error', 900, false]);
}));

test('a dry run does everything but the post, may read a photo that already holds a reading, and hands back the exact envelope', () => withDir(async (dir) => {
  const { deps, calls } = frameDeps({ row: { deep_scene: 'engine_bay' }, answers: [cli(verdict()), cli(verdict())] });
  const r = await deepReadFrame(frame, deps, opts(dir, { post: false }));
  assert.equal(calls.orchestrator.length, 0);
  assert.equal(r.valid, true);
  assert.equal(r.receipt, null);
  assert.equal(r.envelope.action, 'record_reviewed_analysis');
  assert.equal(r.agreement.agreed, true);
}));

// --- keyed values ---------------------------------------------------------------------------------------------------

test('keyed values call the sanctioned projection for exactly this photo\'s current reading and map its receipt', async () => {
  // the photo's current reading is found by the database's rule (its stamp, among its unsuperseded readings on this vehicle);
  // here the reading is gone by the time it is fetched: the projection runs, finds nothing, the receipt says so (retryable)
  const OBS = '30000000-0000-4000-8000-000000000009', OTHER = '30000000-0000-4000-8000-000000000008';
  const queries = [];
  const builder = (table) => { let lookup = false; const b = { select: () => b, eq: (k, v) => { queries.push([table, 'eq', k, v]); return b; }, lt: () => b,
    in: (k, v) => { queries.push([table, 'in', k, v]); if (k === 'structured_data->>image_id') lookup = true; return b; },
    or: () => b, order: () => b, limit: () => b, abortSignal: () => b,
    then: (res, rej) => Promise.resolve({ data: table === 'vehicle_images' ? [{ id: IMAGE, current_observation_id: OBS }]
      : lookup ? [{ id: OTHER, vehicle_id: VEHICLE, kind: 'condition', is_superseded: false, ingested_at: '2026-11-20T19:00:00+00:00', image_id: IMAGE },
        { id: OBS, vehicle_id: VEHICLE, kind: 'condition', is_superseded: false, ingested_at: '2026-11-20T18:00:00+00:00', image_id: IMAGE }] : [], error: null }).then(res, rej) }; return b; };
  const r = await keyedValuesForFrame({ id: IMAGE, vehicle_id: VEHICLE }, { sb: { from: builder }, reader: 'r' });
  assert.ok(queries.some((q) => q[0] === 'vehicle_images' && q[1] === 'in' && q[2] === 'id' && q[3][0] === IMAGE), 'the photo says which reading it points at');
  assert.deepEqual(queries.filter((q) => q[0] === 'vehicle_observations' && q[1] === 'in'), [['vehicle_observations', 'in', 'structured_data->>image_id', [IMAGE]], ['vehicle_observations', 'in', 'id', [OBS]]],
    'the photo\'s readings are looked up, and only the one it points at is read (not the newer second one)');
  assert.ok(queries.some((q) => q[2] === 'vehicle_id' && q[3] === VEHICLE));
  assert.deepEqual([r.receipt.outcome, r.receipt.error_class], ['unavailable', 'reading_not_found']);
  assert.equal(r.projection.model_calls, 0);
  // a photo no reading names: nothing is walked
  const empty = (rows) => { const b = { select: () => b, eq: () => b, in: () => b, limit: () => b, abortSignal: () => b, then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej) }; return b; };
  const none = await keyedValuesForFrame({ id: IMAGE, vehicle_id: VEHICLE }, { sb: { from: (t) => empty(t === 'vehicle_images' ? [{ id: IMAGE, current_observation_id: null }] : []) }, reader: 'r' });
  assert.deepEqual([none.receipt.error_class, none.projection.source_rows, none.projection.pages_walked], ['reading_not_found', 0, 0]);
  // the projection could not even read: retried later, never thrown at the fire
  const down = await keyedValuesForFrame({ id: IMAGE, vehicle_id: VEHICLE }, { sb: { from: () => { throw new Error('boom'); } }, reader: 'r' });
  assert.deepEqual([down.receipt.outcome, down.receipt.error_class], ['unavailable', 'projection_error']);
});

test('a stage summary counts receipts in fixed words only', () => {
  const s = newStageSummary();
  countReceipt(s, { outcome: 'succeeded', detail: {} });
  countReceipt(s, { outcome: 'policy_skip', detail: { skipped: 'receipt_document' } });
  countReceipt(s, { outcome: 'unavailable', error_class: 'reader_output_invalid $(rm -rf /)', detail: {} });
  assert.deepEqual([s.succeeded, s.policy_skip, s.unavailable], [1, 1, 1]);
  assert.deepEqual(s.skip_reasons, { receipt_document: 1 });
  assert.deepEqual(Object.keys(s.error_classes), ['reader_output_invalid___rm_-rf___']);
});

test('what the intake would refuse is left out of a read before it is judged: empty optional text, and camera numbers no source supports', () => {
  const v = verdict({ agent_notes: '', open_questions: ['', 'Which year?'], camera_pose: { method: 'm', framing: 'f', azimuth_deg: 45, elevation_deg: 10, distance_est: 'about 5 meters', exif_present: true },
    workshop_signals: { tools_visible: ['', 'jack'], fixturing: 'unknown', weld_quality: '', lighting: 'good' }, presence: { person: false, dog: false, place_hint: '' } });
  const out = intakeShape(v);
  assert.equal('agent_notes' in out, false);
  assert.deepEqual([out.open_questions, out.workshop_signals.tools_visible, 'weld_quality' in out.workshop_signals, out.presence.place_hint], [['Which year?'], ['jack'], false, null]);
  assert.deepEqual(out.camera_pose, { method: 'm', framing: 'f', azimuth_deg: null, elevation_deg: null, distance_est: null, exif_present: null });
  assert.equal(v.agent_notes, '', 'the input is not changed');
  assert.deepEqual(validateVerdict(out), []);
  assert.deepEqual(verdictFromCliOutput(cli(v), { imageId: IMAGE, vehicleId: VEHICLE }).verdict, out, 'a read is shaped as it is accepted');
});

// --- the findings of the pre-merge review -----------------------------------------------------------------------------

test('a failed read ends its sibling: no model call after the photo\'s receipt, and the files stay until both reads have settled', () => withDir(async (dir) => {
  const limit = JSON.stringify({ is_error: true, api_error_status: 429, result: 'You\'ve hit your 5-hour limit' });
  const { deps, calls } = frameDeps({ answers: [limit] });
  let started = 0, endedAfterReturn = 0, returned = false;
  deps.ask = async (argv, text, cwd, signal) => {
    const n = started++;
    calls.order.push('read');
    if (n === 0) throw Object.assign(new Error('reader error: You\'ve hit your 5-hour limit'), { apiStatus: 429 });
    // the sibling: still running when the first fails; it must be told to stop, and must not start a retry
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, 300);
      signal.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('read aborted'), { aborted: true })); }, { once: true });
    });
    if (returned) endedAfterReturn++;
    return 'no json';   // it would be retried, were it not aborted
  };
  const r = await deepReadFrame(frame, deps, opts(dir)); returned = true;
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.deepEqual([r.receipt.outcome, r.receipt.error_class, r.stop], ['rate_limited', 'reader_usage_limit', true]);
  assert.equal(started, 2, 'two reads began; the sibling was aborted and no retry followed');
  assert.equal(endedAfterReturn, 0, 'the sibling had ended before the photo returned');
}));

test('a halt from another photo ends this one without a receipt (the lease hands it back, no attempt counted)', () => withDir(async (dir) => {
  const halt = new AbortController();
  const { deps } = frameDeps({ answers: [cli(verdict())] });
  deps.ask = (argv, text, cwd, signal) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(Object.assign(new Error('read aborted'), { aborted: true })), { once: true }); setTimeout(() => halt.abort(), 20); });
  const r = await deepReadFrame(frame, deps, opts(dir, { signal: halt.signal }));
  assert.deepEqual([r.receipt, r.aborted, r.stop], [null, true, false]);
  assert.deepEqual(readdirSync(dir), [], 'the bytes are removed');
}));

test('claimAndWork: small claims, each worked before the next; a halt or the deadline strands at most one chunk', async () => {
  const held = Array.from({ length: 10 }, (_, i) => i);
  const claims = [];
  const claim = async (n) => { claims.push(n); const work = held.splice(0, n); return { work, error: null }; };
  const done = [];
  let halted = false;
  const out = await claimAndWork({ claim, work: async (x) => { done.push(x); if (x === 2) halted = true; }, limit: 10, chunk: 4, width: 2, halted: () => halted });
  assert.deepEqual(claims, [4], 'the halt came in the first chunk: nothing further was claimed');
  assert.equal(out.claimed, 4);
  assert.ok(done.length < 4 + 1 && done.includes(2), 'workers stopped pulling photos once halted');
  // the deadline
  held.splice(0, held.length, ...Array.from({ length: 10 }, (_, i) => i)); claims.length = 0;
  let t = 0;
  const out2 = await claimAndWork({ claim, work: async () => { t += 100; }, limit: 10, chunk: 2, width: 1, deadline: 350, now: () => t });
  assert.deepEqual([claims, out2.claimed], [[2, 2], 4], 'no chunk is claimed once the deadline has passed');
  // limit and a short answer
  held.splice(0, held.length, 1, 2, 3); claims.length = 0;
  const out3 = await claimAndWork({ claim, work: async () => {}, limit: 20, chunk: 2, width: 1 });
  assert.deepEqual([claims, out3.claimed], [[2, 2], 3], 'a short claim ends the stage');
  const out4 = await claimAndWork({ claim: async () => ({ work: [], error: 'claim_failed' }), work: async () => {}, limit: 5, chunk: 2, width: 1 });
  assert.equal(out4.error, 'claim_failed');
});

test('a deep read\'s child carries no credentials, only the login', () => {
  const env = deepChildEnv({ PATH: '/bin', HOME: '/h', SUPABASE_SERVICE_ROLE_KEY: 'a', DOTENV_PRIVATE_KEY: 'b', GITHUB_TOKEN: 'c', DB_PASSWORD: 'd', APP_SECRET: 'e', ANTHROPIC_API_KEY: 'f', CLAUDE_CODE_OAUTH_TOKEN: 'login', LANG: 'en_US.UTF-8' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/h', CLAUDE_CODE_OAUTH_TOKEN: 'login', LANG: 'en_US.UTF-8' });
});

test('the model the receipt records is the CLI\'s report: the busiest of several, or "unreported" beside what was requested', () => withDir(async (dir) => {
  assert.equal(cliStats({ modelUsage: { 'claude-haiku': { inputTokens: 10, outputTokens: 2 }, 'claude-sonnet-5-5': { inputTokens: 900, outputTokens: 1200 } } }, 1).model, 'claude-sonnet-5-5');
  const none = (v) => JSON.stringify({ type: 'result', is_error: false, structured_output: { verdicts: [v] } });
  const { deps, calls } = frameDeps({ answers: [none(verdict()), none(verdict())] });
  await deepReadFrame(frame, deps, opts(dir));
  assert.equal(calls.orchestrator[0].provenance.agent_model, 'unreported (requested claude-sonnet-5-5)');
}));

test('the receipt keeps both full reads; the prompt allows its one Read and says no hints are supplied', () => withDir(async (dir) => {
  const { deps, calls } = frameDeps({ answers: [cli(verdict()), cli(verdict({ narrative_one_line: 'Another sentence.' }))] });
  const r = await deepReadFrame(frame, deps, opts(dir));
  assert.deepEqual(r.receipt.detail.reads.map((x) => x.verdict.narrative_one_line).sort(), ['A complete car stands in the frame.', 'Another sentence.']);
  assert.match(calls.ask[0].text, /Read tool is permitted for this one file only; no apple_hints are supplied/);
  assert.ok(calls.ask[0].text.includes(STATE_STANDARD), 'the measured "when to use unknown" text is in the prompt');
  assert.ok(deepPrompt({ contract: 'C', imageId: IMAGE, vehicleId: VEHICLE, imagePath: '/tmp/x.jpg' }).indexOf('C\n' + STATE_STANDARD) > 0, 'after the contract, before the photo');
  // the model's own sentences are kept only here, never in what is posted
  assert.equal(/A complete car stands|Another sentence/.test(JSON.stringify(calls.orchestrator[0])), false);
}));

test('a disagreement on one value does not stop another agreed value from keying: the posted confidence is the lower of the two reads\'', () => withDir(async (dir) => {
  const { deps, calls } = frameDeps({ answers: [cli(verdict({ scene_type: 'undercarriage', confidence: 0.85 }, { rust_severity: 'surface', completeness: 'assembled' })), cli(verdict({ scene_type: 'undercarriage', confidence: 0.75 }, { rust_severity: 'surface', completeness: 'unknown' }))] });
  await deepReadFrame(frame, deps, opts(dir));
  assert.equal(calls.orchestrator[0].verdict.confidence, 0.75);
  assert.equal(calls.orchestrator[0].verdict.state_observations.rust_severity, 'surface');
}));
