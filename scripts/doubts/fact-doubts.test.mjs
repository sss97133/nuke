import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveDoubts, doubtsFromReaderFile, pickFrames, buildQuestionRow, buildBlindTask, buildExportTask, plainDefinition, validateAnswer, closedAnswer, ITEM_MAP } from './fact-doubts.mjs';
import { requestParams } from './answer-fact-doubts.mjs';

const V = { id: '20d21fb0-4651-4469-a0ba-e751309a1e54', user_id: '0b9f107a-d124-49de-9ded-94698f63c1c4' };
const I1 = '11111111-1111-1111-1111-111111111111'; const I2 = '22222222-2222-2222-2222-222222222222'; const L1 = '33333333-3333-3333-3333-333333333333';
const reg = new Map([
  ['bellhousing_casting', { id: 'a0000000-0000-0000-0000-000000000001', property_key: 'bellhousing_casting', data_type: 'string' }],
  ['engine_block_casting', { id: 'a0000000-0000-0000-0000-000000000002', property_key: 'engine_block_casting', data_type: 'string' }],
  ['transmission_type', { id: 'a0000000-0000-0000-0000-000000000003', property_key: 'transmission_type', data_type: 'enum' }],
]);
const payload = { transmission: [
  { key: 'transmission.current.bellhousing_casting', status: 'reading', sources: [{ kind: 'image', value: '547975', witness: { kind: 'image', id: I1 } }] },
  { key: 'transmission.current.type', status: 'reading', sources: [] },
  { key: 'transmission.current.date_code', status: 'reading', sources: [] },
  { key: 'transmission.current.case_casting', status: 'established', sources: [] },
  { key: 'transmission.current.gear_ratios', status: 'missing', sources: [] },
], engine: [
  { key: 'engine.current.block_casting', status: 'conflict', sources: [{ witness: { kind: 'receipt_item', id: L1 } }] },
  { key: 'engine.current.block_date', status: 'missing', sources: [] },
] };

test('doubts come from reading/conflict/missing items with a registered readable key', () => {
  const { doubts, unmapped } = deriveDoubts(payload, reg);
  assert.deepEqual(doubts.map((d) => d.property_key), ['bellhousing_casting', 'engine_block_casting']);
  assert.deepEqual(doubts[0].witness_image_ids, [I1]);
  assert.deepEqual(doubts[1].receipt_item_ids, [L1]);
  assert.equal(doubts[0].origin, 'contradiction_check');
  assert.ok(unmapped.some((u) => u.item_key === 'transmission.current.type' && /enum/.test(u.why)));
  assert.ok(unmapped.some((u) => u.item_key === 'engine.current.block_date' && u.proposed === 'engine_block_date_code'));
  assert.ok(unmapped.some((u) => u.item_key === 'transmission.current.date_code'));
  assert.ok(!unmapped.some((u) => u.item_key === 'transmission.current.case_casting'), 'established items are not doubted');
});

test('every mapped item key has frame derivation inputs', () => {
  for (const [k, m] of Object.entries(ITEM_MAP)) assert.ok(Array.isArray(m.roles) && Array.isArray(m.terms), k);
});

test('simulated reader doubts keep only the key and a reference to the words', () => {
  const { doubts, unmapped } = doubtsFromReaderFile([{ property_key: 'bellhousing_casting', words_ref: 'sim:42' }, { property_key: 'nope', words_ref: 'x' }, { property_key: 'engine_block_casting' }], reg);
  assert.equal(doubts.length, 1);
  assert.equal(doubts[0].origin, 'simulated_reader'); assert.equal(doubts[0].origin_ref, 'sim:42');
  assert.equal(unmapped.length, 2);
});

const frame = (id, tier, extra = {}) => ({ id, tier, taken_at: '2026-10-28', vision_gate_status: 'approved', ...extra });
test('frames: eligible only, witness first, sharper first, deduped, capped', () => {
  const c = [frame(I2, 'text', { photo_quality_score: 0.9 }), frame(I1, 'witness'), frame('x1', 'role', { photo_quality_score: 0.2 }), frame('x2', 'role', { photo_quality_score: 0.8 }),
    frame('bad', 'role', { is_sensitive: true }), frame('doc', 'role', { is_document: true }), frame('nodate', 'role', { taken_at: null }), frame(I1, 'role')];
  assert.deepEqual(pickFrames(c), [I1, 'x2', 'x1', I2]);
  const many = Array.from({ length: 20 }, (_, i) => frame(`f${String(i).padStart(2, '0')}`, 'role', { photo_quality_score: i }));
  assert.equal(pickFrames(many).length, 8);
  assert.equal(pickFrames(many, 3).length, 3);
});

test('question row: identity is the evidence state, params carry no answer', () => {
  const d = { origin: 'contradiction_check', origin_ref: 'facet_items:k:reading', property_key: 'bellhousing_casting', property_id: 'a0000000-0000-0000-0000-000000000001', status: 'reading' };
  const mk = (t) => buildQuestionRow({ doubt: d, vehicle: V, evidenceDb: { observations: [] }, triggerKey: t, imageIds: [I1], itemIds: [], runId: 'r', version: 'v', script: 's' });
  const a = mk('t1'); const b = mk('t1'); const c = mk('t2');
  assert.equal(a.dedupe_key, b.dedupe_key); assert.notEqual(a.dedupe_key, c.dedupe_key);
  assert.equal(a.question_kind, 'fact_doubt'); assert.equal(a.subject_table, 'observation_properties'); assert.equal(a.subject_id, d.property_id);
  for (const k of ['answer', 'prior_answer', 'previous_answer', 'answer_history', 'value', 'caption']) assert.ok(!(k in a.params), k);
  assert.deepEqual(a.params.cited_image_ids, [I1]);
});

// A request as the store holds it, with everything the blind task must NOT show planted in it.
const SECRET = '547975-PRIOR'; const WORDS = 'ASKER-OPINION-6479775';
const stored = { property_key: 'bellhousing_casting', doubt_form: 'property', origin: 'simulated_reader', origin_ref: WORDS, allowed: null, cited_image_ids: [I1, I2], cited_receipt_item_ids: [L1],
  evidence_state: { db: { observations: [['obs-id', 'hash']] }, readers: [{ reader: 'reader-a', figure: SECRET }] }, answer: { outcome: 'value', value: SECRET }, answer_history: [{ answer: { value: SECRET } }], caption: SECRET, stored_value: SECRET };
test('blind task carries the question, the frames and lines, and nothing earlier', () => {
  const task = buildBlindTask({ params: stored, registryRow: { label: 'Bellhousing casting number', description: 'The casting number cast into the bellhousing.', unit: null }, lines: [{ id: L1, description: 'CLUTCH FORK', part_number: 'A1', line_date: '2025-01-01' }] });
  const wire = JSON.stringify(requestParams('claude-sonnet-5-5', task, new Map([[I1, 'AAA'], [I2, 'BBB']])));
  assert.ok(!wire.includes(SECRET) && !wire.includes(WORDS) && !wire.includes('reader-a') && !wire.includes('obs-id'), 'no earlier value, caption, reader or asker words');
  assert.ok(wire.includes('Bellhousing casting number') && wire.includes(I1) && wire.includes(I2) && wire.includes('CLUTCH FORK'));
  assert.deepEqual(task.evidence.map((e) => e.id), [I1, I2, L1]);
  assert.ok(!/total|price|\$/.test(task.evidence[2].text));
});
test('blind task lists allowed values when the question has them', () => {
  const task = buildBlindTask({ params: { ...stored, allowed: ['A', 'B'] }, registryRow: { label: 'X' } });
  assert.match(task.text, /exactly one of: A \| B/);
});

const P = { doubt_form: 'property', cited_image_ids: [I1, I2], cited_receipt_item_ids: [L1], allowed: null };
test('answer validation mirrors the closed schema', () => {
  assert.deepEqual(validateAnswer(P, { outcome: 'value', value: '6479775', confidence: 0.8, image_ids: [I1], quote: 'cast' }), []);
  assert.deepEqual(validateAnswer(P, { outcome: 'cannot_tell', confidence: 0.3 }), []);
  assert.deepEqual(validateAnswer(P, { outcome: 'not_visible', value: null, confidence: 0.9, image_ids: [] }), []);
  assert.ok(validateAnswer(P, { outcome: 'value', value: 'x', confidence: 0.8 }).some((p) => /witness/.test(p)));
  assert.ok(validateAnswer(P, { outcome: 'value', value: 'x', confidence: 0.8, image_ids: ['zzz'] }).some((p) => /subset/.test(p)));
  assert.ok(validateAnswer(P, { outcome: 'value', confidence: 0.8, image_ids: [I1] }).some((p) => /scalar/.test(p)));
  assert.ok(validateAnswer(P, { outcome: 'value', value: 'x'.repeat(81), confidence: 0.8, image_ids: [I1] }).some((p) => /1\.\.80/.test(p)));
  assert.ok(validateAnswer({ ...P, allowed: ['A'] }, { outcome: 'value', value: 'B', confidence: 0.8, image_ids: [I1] }).some((p) => /allowed/.test(p)));
  assert.ok(validateAnswer(P, { outcome: 'cannot_tell', value: 'x', confidence: 0.3 }).some((p) => /only with outcome value/.test(p)));
  assert.ok(validateAnswer(P, { outcome: 'different_measures', confidence: 0.3, quote: 'q' }).some((p) => /reader_pair/.test(p)));
  assert.ok(validateAnswer(P, { outcome: 'maybe', confidence: 2 }).length >= 2);
  assert.ok(validateAnswer(P, 'text').length);
});
test('closed answer drops fields outside the schema and coerces nothing', () => {
  assert.deepEqual(closedAnswer({ outcome: 'cannot_tell', confidence: 0.5, reasoning: 'long', bbox: [1] }), { outcome: 'cannot_tell', confidence: 0.5 });
  assert.equal(closedAnswer({ outcome: 'value', value: 7, confidence: '0.5' }).confidence, '0.5');
});

test('registry examples never reach the blind reader (they can equal the stored value)', () => {
  assert.equal(plainDefinition('Casting number on the engine block as read (e.g. 9799140), with its casting date when legible. Instance reading of a physical tag, stamp, casting or label, with its photo as witness.'),
    'Casting number on the engine block as read, with its casting date when legible.');
  assert.equal(plainDefinition('Transmission identification stamp as read (e.g. Muncie P0118); format and date decode by the cited serial-format rule. Instance reading of a tag'),
    'Transmission identification stamp as read; format and date decode by the cited serial-format rule.');
  assert.equal(plainDefinition('e.g. V8, I6, flat-6'), '');
  const task = buildBlindTask({ params: stored, registryRow: { label: 'Engine block casting number', description: 'Casting number on the engine block as read (e.g. 9799140). Instance reading of x' } });
  assert.ok(!task.text.includes('9799140'));
});

test('exported task file carries no earlier value, caption, reader or asker words', () => {
  const task = buildBlindTask({ params: stored, registryRow: { label: 'Bellhousing casting number', description: 'Casting number on the bellhousing as read (e.g. 547975). Instance reading of x' }, lines: [{ id: L1, description: 'CLUTCH FORK', part_number: 'A1' }] });
  const text = JSON.stringify(buildExportTask({ task, params: stored, frames: [{ file: 'frame-1.jpg', image_id: I1 }, { file: 'frame-2.jpg', image_id: I2 }] }));
  for (const bad of [SECRET, WORDS, '547975', 'reader-a', 'obs-id', 'simulated_reader', 'origin']) assert.ok(!text.includes(bad), bad);
  assert.ok(text.includes('frame-2.jpg') && text.includes(I2) && text.includes('CLUTCH FORK') && text.includes('cannot_tell'));
});
