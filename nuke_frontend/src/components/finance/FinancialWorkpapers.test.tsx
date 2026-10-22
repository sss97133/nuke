// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ invoke: vi.fn(), listener: null as null | ((event: string) => void) }));
vi.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: fixture.invoke }, auth: {
  onAuthStateChange(listener: (event: string) => void) { fixture.listener = listener; return { data: { subscription: { unsubscribe() {} } } }; },
} } }));
import FinancialWorkpapers, { yearOverview, recordDescription } from './FinancialWorkpapers';
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
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Accounts')!.click());
  const rows = Array.from(container.querySelectorAll('tbody tr'));
  expect(rows).toHaveLength(3); expect(rows[0].textContent).toContain('20.01 USD'); expect(rows[1].textContent).toContain('30.02 EUR');
  expect(rows[2].textContent).toContain('Unknown'); expect(container.textContent).not.toContain('99999.99');
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
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Records')!.click());
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'View evidence')!.click()); expect(open).toHaveBeenCalledWith('doc', record().record);
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Next records')!.click());
  expect(fixture.invoke.mock.calls[1][1].body).toEqual({ mode: 'financial_evidence_v1', action: 'tax_read', limit: 100, after: 'cursor1' });
  expect(container.textContent).toContain('Second page'); expect(container.textContent).toContain('Source page 2');
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

it('year overview uses all server controls, preserves refunds and unknowns, never bank cashflow', async () => {
  const base = { record_kind: 'retained_ledger_decision', year: '2024', account: 'A', section: 'Expense', currency: 'USD', rows: 1 };
  const controls = [{ ...base, retained_amount: '1234.56' }, { ...base, retained_amount: '-34.56' },
    { ...base, section: 'Revenue', retained_amount: '2000' }, { ...base, currency: 'EUR', retained_amount: '50' },
    { ...base, record_kind: 'retained_bank_movement', retained_amount: '999999' }];
  expect(yearOverview(controls)[0]).toMatchObject({ revenue: 2000000000n, expense: 1200000000n, currency: 'USD' });
  expect(yearOverview([...controls, { ...base, retained_amount: null }])[0].expense).toBeNull();
  expect(yearOverview([{ ...base, retained_amount: '100', missing_amounts: 1 }])[0].expense).toBeNull();
  fixture.invoke.mockResolvedValue(response({ ...empty(), total_rows: 750, records: [record()], controls }));
  await act(async () => root.render(<FinancialWorkpapers revision={0} onOpen={() => {}} />));
  expect(container.textContent).toContain('750 records available');
  expect(container.textContent).toContain('Recovery may be partial');
  expect(container.querySelector('.accounting-years')?.textContent).toContain('1,200.00 USD');
  expect(container.querySelector('.accounting-years')?.textContent).not.toContain('999,999');
  expect(container.textContent).toContain('Bookkeeping difference');
  expect(container.querySelectorAll('details[open]')).toHaveLength(0);
});

it('defaults to the latest book year and scopes records and bank attention to the selected year', async () => {
  const control = { record_kind: 'retained_ledger_decision', year: '2024', account: 'Account', section: 'Expense', currency: 'USD', retained_amount: '12.50', rows: 1 };
  fixture.invoke.mockResolvedValue(response({ ...empty(), records: [record(), {...record('later'),record:{...record().record,year:'2025',description:'Later year record'}}], total_rows: 3, controls: [control, {...control,year:'2025'}, {...control,year:'2026',record_kind:'retained_bank_movement',section:null,rows:530}] }));
  await act(async () => root.render(<FinancialWorkpapers revision={0} onOpen={() => {}} />));
  const year = container.querySelector('select')!;
  expect(year.value).toBe('2025');
  expect(container.textContent).toContain('0 unclassified bank movements');
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Records')!.click());
  expect(container.querySelector('tbody')?.textContent).toContain('Later year record');
  expect(container.querySelector('tbody')?.textContent).not.toContain('Retained part');
  await act(async () => { year.value = '2024'; year.dispatchEvent(new Event('change', {bubbles:true})); });
  expect(container.querySelector('tbody')?.textContent).toContain('Retained part');
  expect(container.querySelector('tbody')?.textContent).not.toContain('Later year record');
});
it('bounds loaded record inspection to 25 and withholds partial account sums', async () => {
  fixture.invoke.mockResolvedValue(response({...empty(),records:Array.from({length:60},(_,i)=>record(`r${i}`,`Record ${i}`)),total_rows:7767,controls:[{record_kind:'retained_ledger_decision',year:'2024',account:'Account',section:'Expense',currency:'USD',retained_amount:'98765.43',missing_amounts:1,rows:60}]}));
  await act(async () => root.render(<FinancialWorkpapers revision={0} onOpen={()=>{}}/>));
  expect(container.querySelector('table')).toBeNull();
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Records')!.click());
  expect(container.querySelectorAll('tbody tr')).toHaveLength(25);
  expect(container.textContent).toContain('not all 7,767 records');
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Next 25')!.click());
  expect(container.querySelector('tbody')?.textContent).toContain('Record 25');
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Accounts')!.click());
  expect(container.querySelector('tbody')?.textContent).toContain('Unknown');
  expect(container.textContent).not.toContain('98,765.43');
});

it('removes full UUID display tokens while preserving source description and ordinary identifiers', async () => {
  const original = 'PayPal | 12345678-1234-1234-1234-123456789abc | 87654321-4321-4321-4321-cba987654321 | Subscription SKU AB-123 VIN 1HGCM82633A004352';
  expect(recordDescription(original)).toBe('PayPal · Subscription SKU AB-123 VIN 1HGCM82633A004352');
  expect(recordDescription('PayPal | Synthetic subscription | 12345678-1234-1234-1234-123456789abc, 87654321-4321-4321-4321-cba987654321')).toBe('PayPal · Synthetic subscription');
  expect(recordDescription('Merchant, Inc. | SKU AB-123')).toBe('Merchant, Inc. · SKU AB-123');
  const saved = record('source-row', original);
  fixture.invoke.mockResolvedValue(response({...empty(),records:[saved],total_rows:1}));
  const open = vi.fn();
  await act(async () => root.render(<FinancialWorkpapers revision={0} onOpen={open}/>));
  await act(async () => Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='Records')!.click());
  expect(container.querySelector('.accounting-record-description')?.textContent).toBe(recordDescription(original));
  await act(async () => Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='View evidence')!.click());
  expect(open.mock.calls[0][1].description).toBe(original);
  expect(saved.record.description).toBe(original);
});
