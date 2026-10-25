// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ invoke: vi.fn(), from: vi.fn(), classify: vi.fn(), listener: null as null | ((event: string) => void) }));
vi.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: fixture.invoke }, from: fixture.from, auth: {
  onAuthStateChange(listener: (event: string) => void) { fixture.listener = listener; return { data: { subscription: { unsubscribe() {} } } }; },
} } }));
vi.mock('../../services/financialRecordClassification', async importOriginal => ({ ...await importOriginal<object>(), classifyRecords: fixture.classify }));
import FinancialWorkpapers, { yearOverview, recordDescription, searchPattern } from './FinancialWorkpapers';
import { forgetAccountingCategories } from './RecordClassifier';
import { AccountingBookContext } from './AccountingBookContext';
let container: HTMLDivElement; let root: Root;
const empty = () => ({ records: [], total_rows: 0, next_after: null, controls_valid: true, controls: [] });
const response = (data: unknown) => ({ data: { data }, error: null });
const record = (id = 'row1', description = 'Retained part') => ({ id, document_id: 'doc', record: {
  record_kind: 'retained_ledger_decision', local_id: id, year: '2024', date: '2024-01-01', account: 'Account',
  section: 'Expense', category: 'Parts', amount: '12.50', currency: 'USD', description,
} });
// A PostgREST query builder stand-in: every filter returns the builder, awaiting it yields the table result.
type Query = { calls: [string, unknown[]][]; then: (resolve: (value: unknown) => unknown) => Promise<unknown> } & Record<string, unknown>;
const table = (result: { data?: unknown; count?: number | null; error?: unknown }) => {
  const query = { calls: [] } as unknown as Query;
  for (const method of ['select', 'eq', 'is', 'or', 'order', 'range', 'limit', 'in']) query[method] = (...args: unknown[]) => { query.calls.push([method, args]); return query; };
  query.then = resolve => Promise.resolve({ data: [], count: 0, error: null, ...result }).then(resolve);
  return query;
};
const queries = () => fixture.from.mock.results.map(r => r.value as Query);
const filters = (query: Query, method: string) => query.calls.filter(([m]: [string, unknown[]]) => m === method).map(([, args]: [string, unknown[]]) => args);
const book = (ui: React.ReactNode) => <AccountingBookContext.Provider value={{ ownerId: 'owner', shared: false, canCorrect: true, liveRevision: '0' }}>{ui}</AccountingBookContext.Provider>;
beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; fixture.invoke.mockReset(); fixture.from.mockReset(); fixture.classify.mockReset(); forgetAccountingCategories();
  fixture.invoke.mockResolvedValue(response(empty()));
  fixture.from.mockImplementation(() => table({}));
  // Node's own experimental localStorage global shadows jsdom's and is undefined here; give the page a plain one.
  const stored = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, String(value)); }, removeItem: (key: string) => { stored.delete(key); }, clear: () => stored.clear() } });
  window.history.replaceState(null, '', '/accounting');
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
it('remembers the chosen year for the next visit and reads it back from the address', async () => {
  const control = { record_kind: 'retained_ledger_decision', year: '2024', account: 'Account', section: 'Expense', currency: 'USD', retained_amount: '12.50', rows: 1 };
  fixture.invoke.mockResolvedValue(response({ ...empty(), total_rows: 2, controls: [control, { ...control, year: '2025' }] }));
  window.localStorage.setItem('accounting.year', '2024');
  await act(async () => root.render(book(<FinancialWorkpapers revision={0} onOpen={() => {}} />)));
  const year = container.querySelector('select')!;
  expect(year.value).toBe('2024');
  await act(async () => { year.value = '2025'; year.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(window.localStorage.getItem('accounting.year')).toBe('2025');
  expect(new URL(window.location.href).searchParams.get('year')).toBe('2025');
  await act(async () => root.unmount()); root = createRoot(container);
  window.localStorage.setItem('accounting.year', '2024'); window.history.replaceState(null, '', '/accounting?year=2025');
  await act(async () => root.render(book(<FinancialWorkpapers revision={0} onOpen={() => {}} />)));
  expect(container.querySelector('select')!.value).toBe('2025');
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
it('reads records from the server view for the book and year, pages by 100 and opens the retained source document', async () => {
  const open = vi.fn();
  const control = { record_kind: 'retained_ledger_decision', year: '2024', account: 'Account', section: 'Expense', currency: 'USD', retained_amount: '12.50', rows: 1 };
  fixture.invoke.mockResolvedValue(response({ ...empty(), total_rows: 151, controls: [control] }));
  fixture.from.mockImplementationOnce(() => table({ data: [record('row1'), ...Array.from({ length: 100 }, (_, i) => record(`row${i + 2}`, `Record ${i + 2}`))] })).mockImplementationOnce(() => table({ data: [record('row2', 'Second page')] }));
  await act(async () => root.render(book(<FinancialWorkpapers revision={0} onOpen={open} />)));
  expect(fixture.invoke.mock.calls[0][1].body).toEqual({ mode: 'financial_evidence_v1', action: 'tax_read', limit: 1 });
  expect(fixture.from).not.toHaveBeenCalled();
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Records')!.click());
  expect(fixture.from).toHaveBeenCalledWith('v_financial_accounting_records');
  expect(filters(queries()[0], 'eq')).toEqual([['owner_id', 'owner'], ['year', '2024']]);
  expect(filters(queries()[0], 'select')).toEqual([['id, document_id, record']]);
  expect(filters(queries()[0], 'range')).toEqual([[0, 100]]);
  expect(filters(queries()[0], 'order')[0]).toEqual(['record_date', { ascending: false, nullsFirst: false }]);
  expect(filters(queries()[0], 'or')).toEqual([]);
  expect(container.textContent).toContain('Showing 1–100 records; more available');
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'View evidence')!.click()); expect(open).toHaveBeenCalledWith('doc', record().record);
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Next 100')!.click());
  expect(filters(queries()[1], 'range')).toEqual([[100, 200]]);
  expect(container.textContent).toContain('Second page'); expect(container.textContent).toContain('Showing 101–101 records');
});
it('sends filters and the search term to the server instead of filtering a loaded page', async () => {
  const control = { record_kind: 'retained_bank_movement', year: '2025', account: 'AFCU 8288', section: null, currency: 'USD', retained_amount: '1', rows: 3 };
  fixture.invoke.mockResolvedValue(response({ ...empty(), total_rows: 3, controls: [control] }));
  await act(async () => root.render(book(<FinancialWorkpapers revision={0} onOpen={() => {}} />)));
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Inspect unclassified movements')!.click());
  expect(filters(queries()[0], 'eq')).toEqual([['owner_id', 'owner'], ['year', '2025'], ['record_kind', 'retained_bank_movement'], ['record_kind', 'retained_bank_movement']]);
  expect(filters(queries()[0], 'is')).toEqual([['section', null]]);
  expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toBe('Unclassified');
  const search = container.querySelector('input[type="search"]') as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setValue.call(search, 'pay,pal (test)'); search.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(queries()).toHaveLength(1);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
  expect(filters(queries()[1], 'or')).toEqual([['description.ilike.*pay pal test*,category.ilike.*pay pal test*,decision.ilike.*pay pal test*,status.ilike.*pay pal test*,amount.ilike.*pay pal test*,account.ilike.*pay pal test*']]);
  expect(searchPattern(' 45.99 ')).toBe('*45 99*');
  expect(searchPattern('')).toBe('**');
  // Sorting is a server order: tapping a heading flips it, amounts sort numerically, and paging restarts.
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent?.startsWith('Amount'))!.click());
  expect(filters(queries()[2], 'order')[0]).toEqual(['amount_value', { ascending: false, nullsFirst: false }]);
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent?.startsWith('Amount'))!.click());
  expect(filters(queries()[3], 'order')[0]).toEqual(['amount_value', { ascending: true, nullsFirst: false }]);
  expect(container.querySelector('th[aria-sort]')?.getAttribute('aria-sort')).toBe('ascending');
});
it('a row is tappable and opens the same retained evidence as its button, once', async () => {
  const open = vi.fn();
  fixture.invoke.mockResolvedValue(response({ ...empty(), total_rows: 1, controls: [{ record_kind: 'retained_ledger_decision', year: '2024', account: 'Account', section: 'Expense', currency: 'USD', retained_amount: '12.50', rows: 1 }] }));
  fixture.from.mockImplementation(() => table({ data: [record()], count: 1 }));
  await act(async () => root.render(book(<FinancialWorkpapers revision={0} onOpen={open} />)));
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Records')!.click());
  await act(async () => (container.querySelector('tbody tr') as HTMLElement).click());
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'View evidence')!.click());
  expect(open).toHaveBeenCalledTimes(2); expect(open).toHaveBeenLastCalledWith('doc', record().record);
});
it('a failed record read says so and never shows an empty ledger', async () => {
  fixture.invoke.mockResolvedValue(response({ ...empty(), total_rows: 1, controls: [{ record_kind: 'retained_ledger_decision', year: '2024', account: 'A', section: 'Expense', currency: 'USD', retained_amount: '1', rows: 1 }] }));
  fixture.from.mockImplementation(() => table({ data: null, count: null, error: new Error('unavailable') }));
  await act(async () => root.render(book(<FinancialWorkpapers revision={0} onOpen={() => {}} />)));
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Records')!.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Saved records could not load');
  expect(container.querySelector('table')).toBeNull(); expect(container.textContent).toContain('Matches unavailable');
  expect(container.textContent).not.toContain('No saved records match');
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
  fixture.invoke.mockResolvedValue(response({ ...empty(), total_rows: 3, controls: [control, {...control,year:'2025'}, {...control,year:'2026',record_kind:'retained_bank_movement',section:null,rows:530}] }));
  fixture.from.mockImplementation(() => table({ data: [] }));
  await act(async () => root.render(book(<FinancialWorkpapers revision={0} onOpen={() => {}} />)));
  const year = container.querySelector('select')!;
  expect(year.value).toBe('2025');
  expect(container.textContent).toContain('0 unclassified bank movements');
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Records')!.click());
  expect(filters(queries()[0], 'eq')).toContainEqual(['year', '2025']);
  await act(async () => { year.value = '2024'; year.dispatchEvent(new Event('change', {bubbles:true})); });
  expect(filters(queries()[1], 'eq')).toContainEqual(['year', '2024']);
  expect(container.textContent).toContain('No saved records match these filters for 2024');
});
it('shows one server page of 100 and withholds partial account sums', async () => {
  fixture.invoke.mockResolvedValue(response({...empty(),total_rows:7767,controls:[{record_kind:'retained_ledger_decision',year:'2024',account:'Account',section:'Expense',currency:'USD',retained_amount:'98765.43',missing_amounts:1,rows:60}]}));
  fixture.from.mockImplementation(() => table({ data: Array.from({length:101},(_,i)=>record(`r${i}`,`Record ${i}`)) }));
  await act(async () => root.render(book(<FinancialWorkpapers revision={0} onOpen={()=>{}}/>)));
  expect(container.querySelector('table')).toBeNull();
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Records')!.click());
  expect(container.querySelectorAll('tbody tr')).toHaveLength(100);
  expect(container.textContent).toContain('Showing 1–100 records; more available');
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
  fixture.invoke.mockResolvedValue(response({...empty(),total_rows:1,controls:[{record_kind:'retained_ledger_decision',year:'2024',account:'Account',section:'Expense',currency:'USD',retained_amount:'12.50',rows:1}]}));
  fixture.from.mockImplementation(() => table({ data: [saved], count: 1 }));
  const open = vi.fn();
  await act(async () => root.render(book(<FinancialWorkpapers revision={0} onOpen={open}/>)));
  await act(async () => Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='Records')!.click());
  expect(container.querySelector('.accounting-record-description')?.textContent).toBe(recordDescription(original));
  await act(async () => Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='View evidence')!.click());
  expect(open.mock.calls[0][1].description).toBe(original);
  expect(saved.record.description).toBe(original);
});

it('select mode: tap rows to select them, classify the selection in one sheet, and the rows change at once', async () => {
  const movement = (id: string, key: string) => ({ id, document_id: 'doc', record: { record_kind: 'retained_bank_movement', local_id: `bank:${key}`, year: '2025', date: '2025-03-01', account: 'Checking', section: null, category: '', amount: '-9.99', currency: 'USD', description: `SHOP ${key}`, source_key: key.repeat(64) } });
  fixture.invoke.mockResolvedValue(response({ ...empty(), total_rows: 2, controls: [{ record_kind: 'retained_bank_movement', year: '2025', account: 'Checking', section: null, currency: 'USD', retained_amount: '-19.98', rows: 2 }] }));
  fixture.from.mockImplementation((name: string) => name === 'v_financial_accounting_records' ? table({ data: [movement('r1', 'a'), movement('r2', 'b')], count: 2 }) : table({ data: [{ section: 'Owner', category: 'Personal - not deductible', records: 527 }] }));
  fixture.classify.mockImplementation(async (_owner: string, _document: string, targets: { source_key: string }[]) => ({ saved: targets.map(t => t.source_key), unchanged: [], conflicts: [], records: targets.map(t => ({ ...movement('x', t.source_key[0]).record, section: 'Owner', category: 'Personal - not deductible' })) }));
  const open = vi.fn();
  await act(async () => root.render(book(<FinancialWorkpapers revision={0} onOpen={open} />)));
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Records')!.click());
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Select')!.click());
  expect(container.textContent).toContain('Tap records to select them');
  await act(async () => (container.querySelector('tbody tr') as HTMLElement).click());
  expect(open).not.toHaveBeenCalled(); expect(container.textContent).toContain('1 selected');
  await act(async () => (container.querySelector('thead input[type="checkbox"]') as HTMLInputElement).click());
  expect(container.textContent).toContain('2 selected');
  expect(container.querySelectorAll('tbody tr[aria-selected="true"]')).toHaveLength(2);
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Classify…')!.click());
  const sheet = container.querySelector('dialog[aria-label="Classify selected records"]')!;
  expect(sheet.querySelector('h2')?.textContent).toBe('Classify 2 records');
  expect(sheet.querySelectorAll('.accounting-selection-list li')).toHaveLength(2);
  await act(async () => Array.from(sheet.querySelectorAll('button')).find(b => b.textContent === 'Owner')!.click());
  await act(async () => Array.from(sheet.querySelectorAll('button')).find(b => b.textContent === 'Personal - not deductible')!.click());
  await act(async () => Array.from(sheet.querySelectorAll('button')).find(b => b.textContent === 'Classify 2 records')!.click());
  expect(fixture.classify).toHaveBeenCalledTimes(1);
  expect(fixture.classify.mock.calls[0][2]).toEqual([{ source_key: 'a'.repeat(64), section: null, category: '' }, { source_key: 'b'.repeat(64), section: null, category: '' }]);
  expect(sheet.textContent).toContain('Saved 2 records as Owner · Personal - not deductible.');
  expect(container.querySelector('tbody')?.textContent).toContain('Personal - not deductible');
  expect(container.textContent).toContain('Tap records to select them');
  await act(async () => Array.from(sheet.querySelectorAll('button')).find(b => b.textContent === 'Close')!.click());
  expect(container.querySelector('dialog[aria-label="Classify selected records"]')).toBeNull();
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Done')!.click());
  await act(async () => (container.querySelector('tbody tr') as HTMLElement).click());
  expect(open).toHaveBeenCalledTimes(1);
});

it('drills an expense subtotal into its exact year, currency and ledger classification', async () => {
  fixture.invoke.mockResolvedValue(response({ ...empty(), total_rows: 3, controls: [
    { record_kind: 'retained_ledger_decision', year: '2025', account: 'Checking', section: 'Expense', currency: 'USD', retained_amount: '40', rows: 1 },
    { record_kind: 'retained_ledger_decision', year: '2025', account: 'Checking', section: 'Expense', currency: 'EUR', retained_amount: '12', rows: 1 },
    { record_kind: 'retained_bank_movement', year: '2025', account: 'Checking', section: null, currency: 'USD', retained_amount: '-40', rows: 1 },
  ] }));
  await act(async () => root.render(book(<FinancialWorkpapers revision={0} onOpen={() => {}} />)));
  await act(async () => (container.querySelector('[aria-label="Inspect recorded expenses for 2025 USD"]') as HTMLButtonElement).click());
  const request = queries().find(query => filters(query, 'select').some(args => args[0] === 'id, document_id, record'))!;
  expect(filters(request, 'eq')).toEqual(expect.arrayContaining([['owner_id', 'owner'], ['year', '2025'], ['record_kind', 'retained_ledger_decision'], ['section', 'Expense'], ['currency', 'USD']]));
});

it('keeps unknown currency and account controls scoped when opening their entries', async () => {
  fixture.invoke.mockResolvedValue(response({ ...empty(), total_rows: 1, controls: [
    { record_kind: 'retained_ledger_decision', year: '2025', account: null, section: 'Expense', currency: null, retained_amount: null, rows: 1 },
  ] }));
  await act(async () => root.render(book(<FinancialWorkpapers revision={0} onOpen={() => {}} />)));
  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Accounts')!.click());
  await act(async () => (container.querySelector('tbody button') as HTMLButtonElement).click());
  const request = queries().find(query => filters(query, 'select').some(args => args[0] === 'id, document_id, record'))!;
  expect(filters(request, 'is')).toEqual(expect.arrayContaining([['currency', null], ['account', null]]));
});

it('shows unresolved accounts when the account filter requests unknown', async () => {
  fixture.invoke.mockResolvedValue(response({ ...empty(), total_rows: 2, controls: [
    { record_kind: 'retained_ledger_decision', year: '2025', account: null, section: 'Expense', currency: 'USD', retained_amount: '15', rows: 1 },
    { record_kind: 'retained_ledger_decision', year: '2025', account: 'Checking', section: 'Expense', currency: 'USD', retained_amount: '20', rows: 1 },
  ] }));
  await act(async () => root.render(book(<FinancialWorkpapers revision={0} onOpen={() => {}} />)));
  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Accounts')!.click());
  const account = Array.from(container.querySelectorAll('label')).find(label => label.textContent?.startsWith('Account '))!.querySelector('select')!;
  await act(async () => { account.value = '__unknown'; account.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(container.querySelector('tbody')?.textContent).toContain('Unresolved');
  expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
  expect(container.textContent).not.toContain('No account classifications match');
});

it('replaces the unclassified constraint when choosing a classification', async () => {
  fixture.invoke.mockResolvedValue(response({ ...empty(), total_rows: 2, controls: [
    { record_kind: 'retained_ledger_decision', year: '2025', account: 'Checking', section: 'Expense', currency: 'USD', retained_amount: '20', rows: 1 },
    { record_kind: 'retained_bank_movement', year: '2025', account: 'Checking', section: null, currency: 'USD', retained_amount: '-20', rows: 1 },
  ] }));
  await act(async () => root.render(book(<FinancialWorkpapers revision={0} onOpen={() => {}} />)));
  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Inspect unclassified movements')!.click());
  const classification = Array.from(container.querySelectorAll('label')).find(label => label.textContent?.startsWith('Classification '))!.querySelector('select')!;
  await act(async () => { classification.value = 'Expense'; classification.dispatchEvent(new Event('change', { bubbles: true })); });
  const request = queries().at(-1)!;
  expect(filters(request, 'eq')).toContainEqual(['section', 'Expense']);
  expect(filters(request, 'is')).not.toContainEqual(['section', null]);
});
