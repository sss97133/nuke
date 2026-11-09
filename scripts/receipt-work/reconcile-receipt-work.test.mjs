import test from 'node:test';
import assert from 'node:assert/strict';
import { judgmentFor, DEPARTMENT, QUESTION } from './reconcile-receipt-work.mjs';
import { fromReceiptWorkLine } from '../garage/derivation-evidence.mjs';

const row = { vehicle_id: '20d21fb0-4651-4469-a0ba-e751309a1e54', user_id: '0b9f107a-d124-49de-9ded-94698f63c1c4', receipt_id: '11111111-1111-1111-1111-111111111111',
  item_id: '22222222-2222-2222-2222-222222222222', link_id: '33333333-3333-3333-3333-333333333333', description: '70-76 SHAKER HOOD', part_number: '15136',
  total_price: 652.99, line_kind: 'part', zone: 'exterior', end_hint: 'front', anchor_date: '2024-09-12', anchor_source: 'page_date',
  conclusion: 'photographed_after_window', confidence: 0.36, image_ids: ['44444444-4444-4444-4444-444444444444'], judgment_needed: true, logic_version: 'receipt_work_lines/20261111210000' };
const RUN = '55555555-5555-5555-5555-555555555555';

test('evidence row is signed and subject-keyed by the line', () => {
  const ev = fromReceiptWorkLine(row, { runId: RUN }, { version: 'abc:scripts/receipt-work/reconcile-receipt-work.mjs' });
  assert.equal(ev.kind, 'receipt_work_correlation');
  assert.equal(ev.subject_key, 'receipt_item:22222222-2222-2222-2222-222222222222');
  assert.equal(ev.producer_version, 'abc:scripts/receipt-work/reconcile-receipt-work.mjs');
  assert.deepEqual(ev.image_ids, row.image_ids);
});

test('trigger raises one parameterized judgment, idempotent across runs', () => {
  const ev = fromReceiptWorkLine(row, { runId: RUN }, { version: 'v' });
  const a = judgmentFor(row, ev, { runId: RUN, version: 'v' });
  const b = judgmentFor(row, ev, { runId: '66666666-6666-6666-6666-666666666666', version: 'v2' });
  assert.equal(a.department, DEPARTMENT); assert.equal(a.question_kind, QUESTION);
  assert.deepEqual(a.params.candidate_image_ids, row.image_ids);
  assert.equal(a.priority, 653);
  assert.equal(a.dedupe_key, b.dedupe_key);
});

test('no judgment without a need, a line, or a frame', () => {
  const ev = fromReceiptWorkLine(row, { runId: RUN }, { version: 'v' });
  assert.equal(judgmentFor({ ...row, judgment_needed: false }, ev, { runId: RUN, version: 'v' }), null);
  assert.equal(judgmentFor({ ...row, item_id: null }, ev, { runId: RUN, version: 'v' }), null);
  assert.equal(judgmentFor({ ...row, image_ids: [] }, ev, { runId: RUN, version: 'v' }), null);
});
