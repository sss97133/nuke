import { beforeEach, expect, it, vi } from 'vitest';
// Revision JSON is shaped and checked by the writer; typed loosely here as in financialExpenseUse.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const fixture = vi.hoisted(() => ({ reads: [] as Json[], corrections: [] as Json[], refuse: [] as boolean[] }));
vi.mock('../lib/supabase', () => ({ supabase: {
  functions: { invoke: async (_name: string, { body }: { body: Json }) => {
    if (body.action === 'read') return { data: { data: fixture.reads[0] }, error: null };
    fixture.corrections.push(body);
    if (fixture.refuse.shift()) { fixture.reads.shift(); return { data: null, error: new Error('409') }; }
    return { data: { data: { expense_posted: false } }, error: null };
  } },
  from() { const q = { select: () => q, eq: () => q, single: async () => ({ data: document, error: null }) }; return q; },
} }));
import { classificationCorrection, classifyRecords, CLASSIFICATION_FIELD } from './financialRecordClassification';
import type { AccountingSnapshot } from './financialExpenseUse';

const owner = '11111111-1111-4111-8111-111111111111', runA = '22222222-2222-4222-8222-222222222222', runB = '33333333-3333-4333-8333-333333333333';
const document = { id: 'doc', owner_id: owner, content_sha256: 'c'.repeat(64), storage_path: `${owner}/batch.csv`, source_filename: 'batch.csv', source_kind: 'upload' };
const movement = (key: string, extra: Json = {}) => ({ record_kind: 'retained_bank_movement', source_key: key.repeat(64), source_sha256: 'e'.repeat(64), source_row: 2, local_id: `bank:${key}`, year: '2025', date: '2025-03-01', account: 'Checking', currency: 'USD', currency_basis: 'USD row', amount: '-12.50', section: null, category: '', description: 'SYNTHETIC SHOP', decision: '', status: '', source_reference: 'r', bank_links: [], recognition_status: 'not_applicable', payment_status: 'unresolved', vehicle_status: 'unresolved', reimbursement_status: 'unresolved', entity_status: 'retained_scope_unallocated', ...extra });
const read = (runId: string, records: Json[]) => ({
  fields: [{ field_key: 'retained_accounting_batch', value_raw: 'Batch', value_type: 'event', extraction_run_id: runId, value_normalized: { value: { record_count: records.length }, evidence: { stage: 'retained' } } }],
  lines: [...records.map(record => ({ attributes: { accounting_record: record } })), { attributes: { staging: { source_line_key: 'f'.repeat(64) } } }],
  concerns: [{ concern_type: 'doublon_suspect', status: 'pending', priority: 'medium', detail: 'Possible repeat', resolver: 'owner', is_current_revision: true, confidence_factors: { extraction_run_id: runId } }],
});
const snapshot = (runId: string, records: Json[]): AccountingSnapshot => ({ document, ...read(runId, records), records, runId } as AccountingSnapshot);
const chosen = { section: 'Expense', category: 'Car restoration — parts & materials', note: 'Invoice checked' };
beforeEach(() => { fixture.reads = []; fixture.corrections = []; fixture.refuse = []; });

it('classifies only the chosen records and carries every other record, line, field and current concern', () => {
  const { written, payload } = classificationCorrection(snapshot(runA, [movement('a'), movement('b')]), ['a'.repeat(64)], chosen, 'request');
  const { revision } = payload;
  expect(payload.action).toBe('correct'); expect(payload.owner_user_id).toBe(owner);
  expect(revision.supersedes_run_id).toBe(runA); expect(revision.method).toBe('authenticated-record-classification'); expect(revision.idempotency_key).toBe('record-classification:request');
  expect(revision.accounting_records).toHaveLength(2);
  expect(revision.accounting_records[0]).toMatchObject({ section: 'Expense', category: chosen.category, status: 'Reviewer classification', recognition_status: 'not_applicable', amount: '-12.50' });
  expect(revision.accounting_records[0].decision).toBe('Invoice checked Reviewer classification: Expense · Car restoration — parts & materials (was Unclassified).');
  expect(revision.accounting_records[1]).toEqual(movement('b'));
  expect(revision.lines).toEqual([{ source_line_key: 'f'.repeat(64) }]);
  expect(revision.concerns).toEqual([{ concern_type: 'doublon_suspect', priority: 'medium', detail: 'Possible repeat', resolver: 'owner' }]);
  expect(revision.fields.map((field: Json) => field.field_key)).toEqual(['retained_accounting_batch', CLASSIFICATION_FIELD]);
  expect(revision.fields[1].value_normalized).toMatchObject({ scope_source_keys: ['a'.repeat(64)], section: 'Expense', note: 'Invoice checked', prior: { 'bank:a': 'Unclassified' } });
  expect(revision.fields[1].evidence).toEqual({ stage: 'record_classification_review', source_kind: 'authenticated_reviewer_decision', prior_run_id: runA, basis: 'Invoice checked' });
  expect(written).toHaveLength(1);
  expect(() => classificationCorrection(snapshot(runA, [movement('a')]), ['a'.repeat(64)], { ...chosen, section: ' ' }, 'r')).toThrow('Choose a classification');
  expect(() => classificationCorrection(snapshot(runA, [movement('a')]), ['b'.repeat(64)], chosen, 'r')).toThrow('no longer in its source');
});

it('re-applies on top of another reviewer’s newer revision and keeps their edit to a different record', async () => {
  fixture.reads = [read(runA, [movement('a'), movement('b')]), read(runB, [movement('a'), movement('b', { section: 'Owner', category: 'Personal' })])];
  fixture.refuse = [true];
  const outcome = await classifyRecords(owner, 'doc', [{ source_key: 'a'.repeat(64), section: null, category: '' }], chosen);
  expect(outcome.saved).toEqual(['a'.repeat(64)]); expect(outcome.conflicts).toEqual([]);
  expect(fixture.corrections).toHaveLength(2);
  expect(fixture.corrections[0].revision.supersedes_run_id).toBe(runA);
  const retried = fixture.corrections[1].revision;
  expect(retried.supersedes_run_id).toBe(runB);
  expect(retried.accounting_records[1]).toMatchObject({ section: 'Owner', category: 'Personal' });
  expect(retried.accounting_records[0]).toMatchObject({ section: 'Expense' });
});

it('never overwrites a record someone else classified after it was seen, and writes nothing for it', async () => {
  fixture.reads = [read(runB, [movement('a', { section: 'Transfer', category: 'Own accounts' })])];
  const outcome = await classifyRecords(owner, 'doc', [{ source_key: 'a'.repeat(64), section: null, category: '' }], chosen);
  expect(outcome.saved).toEqual([]); expect(outcome.conflicts).toEqual([{ source_key: 'a'.repeat(64), section: 'Transfer', category: 'Own accounts' }]);
  expect(fixture.corrections).toHaveLength(0);
  // Seen as theirs (the reviewer chose "use mine"): it is applied.
  const mine = await classifyRecords(owner, 'doc', [{ source_key: 'a'.repeat(64), section: 'Transfer', category: 'Own accounts' }], chosen);
  expect(mine.saved).toEqual(['a'.repeat(64)]); expect(fixture.corrections).toHaveLength(1);
});

it('reports a refusal on an unchanged revision without retrying, and skips records already classified as chosen', async () => {
  fixture.reads = [read(runA, [movement('a')]), read(runA, [movement('a')])];
  fixture.refuse = [true];
  await expect(classifyRecords(owner, 'doc', [{ source_key: 'a'.repeat(64), section: null, category: '' }], chosen)).rejects.toThrow('refused this change and nothing was saved');
  expect(fixture.corrections).toHaveLength(1);
  fixture.reads = [read(runA, [movement('a', { section: 'Expense', category: chosen.category })])]; fixture.corrections = [];
  const outcome = await classifyRecords(owner, 'doc', [{ source_key: 'a'.repeat(64), section: null, category: '' }], { ...chosen, note: '' });
  expect(outcome.unchanged).toEqual(['a'.repeat(64)]); expect(fixture.corrections).toHaveLength(0);
});
