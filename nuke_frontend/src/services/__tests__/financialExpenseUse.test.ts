import { expect, it, vi } from 'vitest';
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
import { expenseUseCorrection, type ExpenseSnapshot, type ExpenseUse } from '../financialExpenseUse';
const key = 'a'.repeat(64), run = '11111111-1111-4111-8111-111111111111';
const snapshot = (amount = '100.00'): ExpenseSnapshot => ({
  document: { owner_id: run, content_sha256: 'b'.repeat(64), storage_path: `${run}/source.csv`, source_filename: 'source.csv', source_kind: 'bank_export' },
  fields: [{ field_key: 'prior', value_raw: 'Retained', value_type: 'text', value_normalized: { value: { source: 'original' }, evidence: { quote: 'Retained source' } } }],
  lines: [{ attributes: { accounting_record: { source_key: key, amount, local_id: 'expense', year: '2025', currency: 'USD' } } }, { attributes: { staging: { source_line_key: 'c'.repeat(64), amount: '40' } } }],
  record: { source_key: key, amount, local_id: 'expense', year: '2025', currency: 'USD' }, runId: run, use: null,
});
const use = (amount = '40.01'): ExpenseUse => ({ source_key: key, use_type: 'shop', vehicle_id: null, destination_label: 'Shop', allocated_amount: amount, unallocated_amount: '', basis: 'Shared shop supplies per receipt' });
it('carries all prior fields, item lines and accounting decisions while naming the exact current revision', () => {
  const before = snapshot(), copy = structuredClone(before), result = expenseUseCorrection(before, use(), 'one');
  expect(before).toEqual(copy);
  expect(result.action).toBe('correct'); expect(result.owner_user_id).toBe(run);
  expect(result.revision.supersedes_run_id).toBe(run);
  expect(result.revision.accounting_records).toEqual([before.lines[0].attributes.accounting_record]);
  expect(result.revision.lines).toEqual([before.lines[1].attributes.staging]);
  expect(result.revision.fields[0].value_normalized).toEqual({ source: 'original' });
  expect(result.revision.fields[1].value_normalized).toMatchObject({ allocated_amount: '40.010000', unallocated_amount: '59.990000', new_expense: false });
  expect(result).not.toHaveProperty('actor_user_id');
});
it('carries unresolved current source questions instead of making them disappear after an edit', () => {
  const source = snapshot(); source.concerns = [
    { concern_type: 'montant_non_corrobore', priority: 'high', status: 'pending', detail: 'Payment needs support', resolver: 'accounting', is_current_revision: true },
    { concern_type: 'cut_off', priority: 'low', status: 'pending', detail: 'Old question', resolver: 'accounting', is_current_revision: false, confidence_factors: { extraction_run_id: 'older' } },
  ];
  expect(expenseUseCorrection(source, use(), 'questions').revision.concerns).toEqual([{ concern_type: 'montant_non_corrobore', priority: 'high', detail: 'Payment needs support', resolver: 'accounting' }]);
});
it('supports a partial refund without reversing the expense sign or using floating point arithmetic', () => {
  const result = expenseUseCorrection(snapshot('-0.30'), use('-0.10'), 'refund');
  expect(result.revision.fields.at(-1)?.value_normalized).toMatchObject({ allocated_amount: '-0.100000', unallocated_amount: '-0.200000' });
  expect(() => expenseUseCorrection(snapshot('-10'), use('1'), 'bad')).toThrow('expense sign');
  expect(() => expenseUseCorrection(snapshot('10'), use('11'), 'bad')).toThrow('cannot exceed');
});
it('refuses unsupported vehicle IDs, source replacement and missing reasons', () => {
  expect(() => expenseUseCorrection(snapshot(), { ...use(), use_type: 'vehicle', vehicle_id: null }, 'bad')).toThrow('recipient');
  expect(() => expenseUseCorrection(snapshot(), { ...use(), source_key: 'd'.repeat(64) }, 'bad')).toThrow('destination');
  expect(() => expenseUseCorrection(snapshot(), { ...use(), basis: '' }, 'bad')).toThrow('reason');
  const source = snapshot(); source.fields[0].field_key = 'redacted_source';
  expect(() => expenseUseCorrection(source, use(), 'bad')).toThrow('specialized');
});
it('can withdraw an assignment while keeping the entire recognized expense unassigned', () => {
  const result = expenseUseCorrection(snapshot(), { ...use(), use_type: 'unassigned', allocated_amount: null, destination_label: 'Unassigned' }, 'withdraw');
  expect(result.revision.fields.at(-1)?.value_normalized).toMatchObject({ allocated_amount: '0.000000', unallocated_amount: '100.000000' });
});
