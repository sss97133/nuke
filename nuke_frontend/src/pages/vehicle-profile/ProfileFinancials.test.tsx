// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), tables: {} as Record<string, Record<string, unknown>[]>, user: null as { id: string } | null }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/synthetic-pdf-worker.mjs' }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => {
  const pending = fixture.rpc(...args);
  return Object.assign(pending, { range: (start: number, end: number) => ({ abortSignal: () => Promise.resolve(pending).then(result => ({ ...result, data: Array.isArray(result.data) ? result.data.slice(start, end + 1) : result.data })) }) });
}, from: fixture.from } }));
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: fixture.user, loading: false }) }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
import ProfileFinancials from './ProfileFinancials';
import { parseVehicleReceiptRecord } from './hooks/useBuildLedger';
import { parseFinancialUse, totalMoney, moneyLabel } from './hooks/useVehicleFinancials';

let root: Root, host: HTMLDivElement, client: QueryClient;
let open = false;
const vehicleId = '11111111-1111-4111-8111-111111111111';
const rawCost = (extra = {}) => ({ use_id: 'use-a', book_owner_id: 'owner-a', document_id: 'source-a',
  allocation_index: 1, record_source_key: 'synthetic-key', phase: 'book_expense', qualification: 'ready', allocated_amount: '40', book_amount: '40', currency: 'USD', record_date: '2024-06-01', description: 'Synthetic recorded part', basis: 'Source identifies this vehicle', ...extra });
const render = async (market: React.ReactNode = null) => {
  await act(async () => root.render(<QueryClientProvider client={client}><ProfileFinancials vehicleId={vehicleId} market={market} open={open}
    onToggle={() => { open = !open; void render(market); }} onClose={() => { open = false; void render(market); }} boundaryRef={{ current: host }} /></QueryClientProvider>));
  for (let index = 0; index < 4; index++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
};
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  open = false; fixture.user = { id: 'owner-a' };
  fixture.tables = {};
  fixture.from.mockReset().mockImplementation((table: string) => {
    const rows = fixture.tables[table] ?? [];
    const query: any = { select: () => query, eq: () => query, or: () => query, order: () => query,
      limit: (size: number) => Promise.resolve({ data: rows.slice(0, size), count: rows.length, error: null }),
      range: (start: number, end: number) => Promise.resolve({ data: rows.slice(start, end + 1), count: null, error: null }) };
    return query;
  });
  fixture.rpc.mockReset().mockImplementation((name: string) => Promise.resolve({ data: name === 'accounting_vehicle_financials' ? [rawCost()] : name === 'owner_working_notes' ? { tables: [] } : [], error: null }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals(); });

it('never substitutes costs for a missing price and reads the books only when opened', async () => {
  await render();
  expect(host.querySelector('[aria-label="Explore vehicle financials"]')?.textContent).toBe('$$$');
  expect(host.querySelector('.vp-header-money')?.textContent).toBe('$$$');
  expect(fixture.rpc).not.toHaveBeenCalled();
  open = true; await render();
  expect(host.textContent).toContain('Booked vehicle costs');
  expect(host.textContent).toContain('1 allocated of 1 visible entries');
  expect(host.querySelector('svg[aria-label="Cumulative booked vehicle costs"]')).not.toBeNull();
  await act(async () => { const item = host.querySelector<HTMLDetailsElement>('.vp-financial-entry')!; item.open = true; item.dispatchEvent(new Event('toggle')); });
  expect(host.textContent).toContain('Source identifies this vehicle');
});

it('sums exact allocations once, retaining phase/book/currency scope and excluding revised sources', () => {
  const rows = (values: Record<string, unknown>[]) => values.map(value => parseFinancialUse(rawCost(value))!);
  expect(totalMoney(rows([{ allocated_amount: '0.005' }, { use_id: 'b', allocated_amount: '0.005' }]))).toBe('0.010000');
  expect(moneyLabel(totalMoney(rows([{ allocated_amount: '0.005' }, { use_id: 'b', allocated_amount: '0.005' }])), 'USD')).toBe('$0.01');
  expect(totalMoney(rows([{}, {}, { use_id: 'unallocated', allocated_amount: null }, { use_id: 'stale', allocated_amount: '100', qualification: 'source_revised' }]))).toBe('40.000000');
  expect(totalMoney(rows([{ allocated_amount: null }]))).toBeNull();
  expect(totalMoney(rows([{}, { use_id: 'other', book_owner_id: 'other' }]))).toBeNull();
  expect(totalMoney(rows([{}, { use_id: 'other', currency: 'EUR' }]))).toBeNull();
  expect(totalMoney(rows([{}, { use_id: 'other', phase: 'customer_receipt' }]))).toBeNull();
  expect(moneyLabel(totalMoney(rows([{ allocated_amount: '0' }])), 'USD')).toBe('$0.00');
  expect(moneyLabel('-1.5', 'JPY')).toMatch(/^-JPY\s2$/);
});

it('keeps customer cash, mixed transfer allocation, book costs and revised rows distinct', async () => {
  fixture.rpc.mockImplementation((name: string) => Promise.resolve({ data: name === 'accounting_vehicle_financials' ? [rawCost(),
    rawCost({ use_id: 'cash', phase: 'customer_receipt', allocated_amount: '60', bank_amount: '100', bank_remainder: '40', bank_date: '2024-07-01', invoice_reference: 'SYNTHETIC-1', bank_document_id: 'bank-source' }),
    rawCost({ use_id: 'stale', phase: 'customer_receipt', allocated_amount: '200', qualification: 'bank_source_revised' }),
  ] : name === 'owner_working_notes' ? { tables: [] } : [], error: null }));
  open = true; await render();
  expect([...host.querySelectorAll('.vp-financial-measures strong')].map(node => node.textContent)).toEqual(['$60.00', '$40.00']);
  expect(host.textContent).toContain('Source needs review');
  const item = [...host.querySelectorAll<HTMLDetailsElement>('.vp-financial-entry')].find(entry => entry.textContent?.includes('SYNTHETIC-1'))!;
  await act(async () => { item.open = true; item.dispatchEvent(new Event('toggle')); });
  expect(item.textContent).toContain('$40.00 of the movement remains outside');
  expect(item.textContent).toContain('Bank source original');
  expect(host.querySelector('a[target="_blank"]')).toBeNull();
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('.vp-financial-measures button')].find(button => button.textContent?.includes('Booked vehicle costs'))!.click());
  expect(host.querySelector('.vp-financial-filter')?.textContent).toContain('Booked vehicle costs');
  expect(host.textContent).not.toContain('SYNTHETIC-1');
});

it('keeps undated allocations in totals without inventing a date or breaking dated history', async () => {
  fixture.rpc.mockImplementation((name: string) => Promise.resolve({ data: name === 'accounting_vehicle_financials' ? [rawCost(),
    rawCost({ use_id: 'undated', allocated_amount: '15', record_date: null }),
    rawCost({ use_id: 'later', allocated_amount: '20', record_date: '2024-07-01' }),
  ] : name === 'owner_working_notes' ? { tables: [] } : [], error: null }));
  open = true; await render();
  expect(host.querySelector('.vp-financial-measures strong')?.textContent).toBe('$75.00');
  expect(host.textContent).toContain('Allocated entries without a usable date: 1');
  expect(host.textContent).toContain('Date not recorded');
  const chart = host.querySelector('svg[aria-label="Cumulative booked vehicle costs"]')!;
  expect([...chart.querySelectorAll('title')].map(node => node.textContent)).toEqual(['2024-06: $40.00', '2024-07: $60.00']);
  const period = host.querySelector<HTMLSelectElement>('.vp-financial-filter select')!;
  await act(async () => { period.value = '2024-07'; period.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(host.textContent).toContain('$20.00 · 2024-07');
  expect(host.textContent).not.toContain('Date not recorded');
});

it('shows only the total and rows when every allocated entry is undated', async () => {
  fixture.rpc.mockImplementation((name: string) => Promise.resolve({ data: name === 'accounting_vehicle_financials' ? [rawCost({ record_date: null })]
    : name === 'owner_working_notes' ? { tables: [] } : [], error: null }));
  open = true; await render();
  expect(host.querySelector('.vp-financial-measures strong')?.textContent).toBe('$40.00');
  expect(host.querySelector('.vp-financial-curve')).toBeNull();
  expect(host.textContent).toContain('Date not recorded');
});

it('reduces the visible amount deliberately, keeps the door, and remembers the display preference', async () => {
  open = true; await render(<span>Recorded sale</span>);
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Reduce header amount')!.click());
  expect(host.querySelector('.vp-header-money')?.textContent).toBe('$$$');
  expect(localStorage.getItem(`vp:financial-display:v1:owner-a:${vehicleId}`)).toBe('reduced');
  expect(host.textContent).toContain('Show header amount');
});

it('treats an exhausted decimal bank remainder as zero while retaining a different book amount', async () => {
  fixture.rpc.mockImplementation((name: string) => Promise.resolve({ data: name === 'accounting_vehicle_financials' ? [rawCost({ phase: 'customer_receipt', allocated_amount: '60.00', book_amount: '60.04', bank_amount: '60.00', bank_remainder: '0.00', bank_date: '2024-07-01' })] : name === 'owner_working_notes' ? { tables: [] } : [], error: null }));
  open = true; await render();
  await act(async () => { const item = host.querySelector<HTMLDetailsElement>('.vp-financial-entry')!; item.open = true; item.dispatchEvent(new Event('toggle')); });
  expect(host.textContent).toContain('Book source amount');
  expect(host.textContent).toContain('$60.04');
  expect(host.textContent).not.toContain('of the movement remains');
});

it('drops another viewer’s financial records immediately on account change and logout', async () => {
  open = true; await render(); expect(host.textContent).toContain('$40.00');
  let resolve!: (value: unknown) => void;
  fixture.rpc.mockImplementation((name: string) => name === 'accounting_vehicle_financials' ? new Promise(done => { resolve = done; })
    : Promise.resolve({ data: name === 'owner_working_notes' ? { tables: [] } : [], error: null }));
  fixture.user = { id: 'owner-b' }; await render();
  expect(host.textContent).not.toContain('$40.00');
  await act(async () => resolve({ data: [rawCost({ book_owner_id: 'owner-b', allocated_amount: '70' })], error: null }));
  await render(); expect(host.textContent).toContain('$70.00');
  fixture.user = null; open = true; await render();
  expect(host.textContent).not.toContain('$70.00');
  expect(host.textContent).toContain('Sign in');
});

it('distinguishes a failed read from no visible entries and never manufactures a zero', async () => {
  fixture.rpc.mockResolvedValue({ data: null, error: { message: 'synthetic private error' } });
  open = true; await render();
  expect(host.textContent).toContain('Some financial records could not load');
  expect(host.textContent).toContain('Retry financial records');
  expect(host.textContent).not.toContain('synthetic private error');
  expect(host.textContent).not.toContain('$0');
});

it('retains an unpriced audit record as unknown rather than zero and never adds it to books', async () => {
  fixture.rpc.mockImplementation((name: string) => Promise.resolve({ data: name === 'accounting_vehicle_financials' ? [rawCost()] : name === 'owner_working_notes' ? { tables: [] } : [
    { observation_id: 'audit-a', observed_at: '2024-06-01', content_text: 'Unpriced work', structured_data: { event_type: 'labor_payment', direction: 'out' } },
    { observation_id: 'audit-b', observed_at: '2024-06-01', content_text: 'Unscoped financial record', structured_data: { amount_usd: 15 } },
  ], error: null }));
  open = true; await render();
  expect(host.textContent).toContain('Unpriced work'); expect(host.textContent).toContain('Amount unknown');
  expect(host.querySelector('.vp-financial-measures strong')?.textContent).toBe('$40.00');
  expect([...host.querySelectorAll('summary')].find(item => item.textContent?.includes('Unscoped financial record'))?.textContent).toContain('Financial record');
});

it('shows an unfinished allocation read as partial rather than a full balance', async () => {
  fixture.rpc.mockImplementation((name: string) => Promise.resolve({ data: name === 'accounting_vehicle_financials' ? Array.from({ length: 200 }, (_, index) => rawCost({ use_id: `cost-${index}` })) : name === 'owner_working_notes' ? { tables: [] } : [], count: 20, error: null }));
  open = true; await render();
  expect(host.textContent).toContain('200 allocation entries loaded · more available');
  expect(host.querySelector('.vp-header-money')?.textContent).toBe('$$$');
});

it('shows public receipt evidence while signed out, retaining the alternate amount field and pagination', async () => {
  fixture.user = null;
  fixture.tables.receipts_public_summary = Array.from({ length: 101 }, (_, index) => ({ id: `receipt-${index}`, vendor_name: `Synthetic receipt ${index}`,
    total: null, total_amount: 12.34, currency: null, transaction_date: '2024-06-01', status: 'processed' }));
  open = true; await render();
  expect(host.querySelector('.vp-header-money')?.textContent).toBe('$$$');
  expect(host.querySelector<HTMLDetailsElement>('.vp-financial-sources')?.open).toBe(false);
  expect(host.textContent).toContain('100 linked receipt records loaded. Total not yet read.');
  expect(host.textContent).toContain('12.34 · currency unrecorded');
  expect(host.textContent).not.toContain('No recorded market price');
  expect(fixture.from.mock.calls.every(([table]) => table === 'receipts_public_summary')).toBe(true);
  expect(fixture.rpc).not.toHaveBeenCalled();
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Load more receipts')!.click());
  await render(); expect(host.textContent).toContain('101 of 101 linked receipt records loaded');
});

it('keeps conflicting receipt amount/date readings unresolved and never invents a currency', () => {
  expect(parseVehicleReceiptRecord({ id: 'receipt', total: '10', total_amount: '12', currency: null,
    receipt_date: '2024-06-01', transaction_date: '2024-06-02' })).toMatchObject({ amount: null, amountConflict: true, currency: null, date: null, dateConflict: true });
});

it('keeps a signed-in public-summary fallback on the same source when loading more receipts', async () => {
  fixture.tables.receipts_public_summary = Array.from({ length: 101 }, (_, index) => ({ id: `public-${index}`, total_amount: 5 }));
  open = true; await render();
  expect(host.textContent).toContain('100 linked receipt records loaded. Total not yet read.');
  const baseReads = fixture.from.mock.calls.filter(([table]) => table === 'receipts').length;
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Load more receipts')!.click());
  await render();
  expect(host.textContent).toContain('101 of 101 linked receipt records loaded');
  expect(fixture.from.mock.calls.filter(([table]) => table === 'receipts')).toHaveLength(baseReads);
});

it('shows authorized work-order charges and recorded payments separately from books and receipts', async () => {
  fixture.tables.work_order_receipt_unified = [{ work_order_id: 'wo', work_order_title: 'Synthetic job', work_order_status: 'in_progress',
    parts_count: 1, labor_count: 0, payment_count: 1, invoice_total: 100, payments_total: 40, balance_due: 60 }];
  fixture.tables.work_orders = [{ id: 'wo', currency: 'USD' }];
  open = true; await render();
  expect(host.textContent).toContain('Synthetic job');
  expect(host.textContent).toContain('Parts and labor charges$100.00');
  expect(host.textContent).toContain('Completed payments$40.00');
  expect(host.querySelector('.vp-financial-measures strong')?.textContent).toBe('$40.00');
});

it('keeps an actual price ahead of expenses and makes source readings a secondary drill', async () => {
  fixture.tables.receipts = [{ id: 'receipt', vendor_name: 'Synthetic vendor', total: 8 }];
  open = true; await render(<span>Asking $900</span>);
  expect(host.querySelector('.vp-header-money')?.textContent).toBe('Asking $900$$$');
  const panel = host.querySelector('.vp-financial-panel')!;
  expect(panel.textContent!.indexOf('Booked vehicle costs')).toBeLessThan(panel.textContent!.indexOf('Receipt sources'));
  expect(panel.querySelector<HTMLDetailsElement>('.vp-financial-sources')?.open).toBe(false);
});
