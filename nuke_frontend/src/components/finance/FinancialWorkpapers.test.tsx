// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ invoke: vi.fn(), listener: null as null | ((event: string) => void) }));
vi.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: fixture.invoke }, auth: {
  onAuthStateChange(listener: (event: string) => void) { fixture.listener = listener; return { data: { subscription: { unsubscribe() {} } } }; },
} } }));
import FinancialWorkpapers from './FinancialWorkpapers';
let container: HTMLDivElement; let root: Root;
const empty = () => ({ records: [], total_rows: 0, next_after: null, controls_valid: true, controls: [] });
const response = (data: unknown) => ({ data: { data }, error: null });
const record = (id = 'row1', description = 'Retained part') => ({ id, document_id: 'doc', record: {
  record_kind: 'retained_ledger_decision', local_id: id, year: '2024', date: '2024-01-01', account: 'Account',
  section: 'Expense', category: 'Parts', amount: '12.50', currency: 'USD', description,
} });
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; fixture.invoke.mockReset();
  fixture.invoke.mockResolvedValue(response(empty()));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it('failed reads remain unknown and never display zero records', async () => {
  fixture.invoke.mockResolvedValue({ data: null, error: new Error('unavailable') });
  await act(async () => root.render(<FinancialWorkpapers revision={0} onOpen={() => {}} />));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('totals are unknown');
  expect(container.textContent).not.toContain('0 saved records');
  expect(container.textContent).not.toContain('No bookkeeping records');
});
it('only ledger controls become subtotals; currencies remain partitioned with unknown explicit', async () => {
  fixture.invoke.mockResolvedValue(response({ ...empty(), total_rows: 4, controls: [
    { record_kind: 'retained_ledger_decision', year: '2024', account: 'A', section: 'Expense', currency: 'USD', retained_amount: '20.01', rows: 1 },
    { record_kind: 'retained_ledger_decision', year: '2024', account: 'A', section: 'Expense', currency: 'EUR', retained_amount: '30.02', rows: 1 },
    { record_kind: 'retained_ledger_decision', year: '2024', account: 'B', section: 'Expense', currency: null, retained_amount: null, rows: 1 },
    { record_kind: 'retained_bank_movement', year: '2024', account: 'A', section: null, currency: 'USD', retained_amount: '99999.99', rows: 1 },
  ] }));
  await act(async () => root.render(<FinancialWorkpapers revision={0} onOpen={() => {}} />));
  const rows = Array.from(container.querySelectorAll('tbody tr'));
  expect(rows).toHaveLength(3); expect(rows[0].textContent).toContain('20.01USD'); expect(rows[1].textContent).toContain('30.02EUR');
  expect(rows[2].textContent).toContain('UnknownUnresolved'); expect(container.textContent).not.toContain('99999.99');
});
it('invalid duplicate controls withhold subtotals', async () => {
  fixture.invoke.mockResolvedValue(response({ ...empty(), total_rows: 2, controls_valid: false, controls: [{ record_kind: 'retained_ledger_decision', retained_amount: '999.99' }] }));
  await act(async () => root.render(<FinancialWorkpapers revision={0} onOpen={() => {}} />));
  expect(container.textContent).toContain('subtotals are withheld'); expect(container.textContent).not.toContain('999.99');
});
it('pages with server cursors and opens the retained source document', async () => {
  const open = vi.fn(); fixture.invoke.mockResolvedValueOnce(response({ ...empty(), total_rows: 101, records: [record()], next_after: 'cursor1' }))
    .mockResolvedValueOnce(response({ ...empty(), total_rows: 101, records: [record('row2', 'Second page')], next_after: 'cursor2' }))
    .mockResolvedValueOnce(response({ ...empty(), total_rows: 101, records: [record()], next_after: 'cursor1' }));
  await act(async () => root.render(<FinancialWorkpapers revision={0} onOpen={open} />));
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'View evidence')!.click()); expect(open).toHaveBeenCalledWith('doc');
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Next records')!.click());
  expect(fixture.invoke.mock.calls[1][1].body).toEqual({ mode: 'financial_evidence_v1', action: 'tax_read', limit: 100, after: 'cursor1' });
  expect(container.textContent).toContain('Second page'); expect(container.textContent).toContain('Page 2');
  expect(Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Next records')!.disabled).toBe(true);
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Previous records')!.click());
  expect(fixture.invoke.mock.calls[2][1].body.after).toBeUndefined();
});
it('account switch synchronously invalidates late prior-account response before effect cleanup', async () => {
  let finish!: (value: unknown) => void;
  fixture.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(response(empty()));
  await act(async () => root.render(<FinancialWorkpapers revision={0} onOpen={() => {}} />));
  await act(async () => {
    fixture.listener!('SIGNED_IN');
    finish(response({ ...empty(), total_rows: 1, records: [record('old', 'PRIVATE OLD ACCOUNT')] }));
    await Promise.resolve();
  });
  expect(container.textContent).not.toContain('PRIVATE OLD ACCOUNT');
  expect(container.textContent).toContain('No bookkeeping records have been recovered');
});
