import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTask, closedAnswer, answerProblems, BLIND_FIELDS } from './answer-receipt-parts.mjs';

const params = {
  description: 'Front brake rotor', part_number: 'BR-1', zone: 'front_suspension', end_hint: 'front',
  vendor_name: 'A Vendor', total_price: 140, purchase_date: '2026-01-02', trigger_conclusion: 'photographed_after_window',
  printed_claims: { x: 1 }, context: { y: 2 }, candidate_image_ids: ['a1', 'b2'],
};

test('the blind task carries the whitelisted line words and frames only', () => {
  const t = buildTask(params, [{ file: 'frame-1.jpg', image_id: 'a1' }]);
  assert.deepEqual(Object.keys(t.receipt_line).sort(), [...BLIND_FIELDS].sort());
  const text = JSON.stringify(t);
  for (const leak of ['A Vendor', '140', '2026-01-02', 'photographed_after_window', 'printed_claims', 'context']) assert.ok(!text.includes(leak), leak);
});

test('closedAnswer keeps the schema keys only', () => {
  assert.deepEqual(closedAnswer({ visible: 'yes', installed: 'yes', image_id: 'a1', confidence: '0.8', extra: 'x' }),
    { visible: 'yes', installed: 'yes', image_id: 'a1', confidence: 0.8 });
});

test('answerProblems mirrors the store and refuses an installed part nobody saw', () => {
  assert.deepEqual(answerProblems(params, { visible: 'yes', installed: 'yes', image_id: 'a1', bbox: [1, 2, 300, 400], confidence: 0.7, quote: 'q' }), []);
  assert.deepEqual(answerProblems(params, { visible: 'cannot_tell', installed: 'cannot_tell', image_id: null, confidence: 0.2 }), []);
  assert.ok(answerProblems(params, { visible: 'yes', installed: 'no', confidence: 0.5 }).includes('visible = yes needs image_id'));
  assert.ok(answerProblems(params, { visible: 'yes', installed: 'no', image_id: 'zz', confidence: 0.5 }).includes('image_id must be one of candidate_image_ids'));
  assert.ok(answerProblems(params, { visible: 'no', installed: 'yes', confidence: 0.5 }).includes('installed = yes needs visible = yes'));
  assert.ok(answerProblems(params, { visible: 'no', installed: 'no', confidence: 2 }).length > 0);
  assert.ok(answerProblems(params, { visible: 'yes', installed: 'no', image_id: 'a1', bbox: [5, 5, 1, 1], confidence: 0.5 }).length > 0);
});
