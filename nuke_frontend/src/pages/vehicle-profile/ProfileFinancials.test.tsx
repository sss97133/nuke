// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), tables: {} as Record<string, Record<string, unknown>[]>, user: null as { id: string } | null }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc, from: fixture.from } }));
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: fixture.user, loading: false }) }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
import ProfileFinancials, { summarizeVehicleCosts } from './ProfileFinancials';
import { parseVehicleBookCosts, parseVehicleReceiptRecord } from './hooks/useBuildLedger';

let root: Root, host: HTMLDivElement, client: QueryClient;
let open = false;
const vehicleId = '11111111-1111-4111-8111-111111111111';
const rawCost = (extra = {}) => ({ use_id: 'use-a', book_owner_id: 'owner-a', document_id: 'source-a',
  allocated_amount: 40, book_amount: 40, currency: 'USD', record_date: '2024-06-01', description: 'Synthetic recorded part', basis: 'Source identifies this vehicle', ...extra });
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
      range: (start: number, end: number) => Promise.resolve({ data: rows.slice(start, end + 1), count: rows.length, error: null }) };
    return query;
  });
  fixture.rpc.mockReset().mockImplementation((name: string) => Promise.resolve({ data: name === 'accounting_vehicle_costs' ? [rawCost()] : name === 'owner_working_notes' ? { tables: [] } : [], error: null }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals(); });

it('keeps a permanent financial door without a market price and shows allocated costs by default', async () => {
  await render();
  expect(host.querySelector('[aria-label="Explore vehicle financials"]')?.textContent).toBe('$$$');
  expect(host.textContent).toContain('Booked subtotal$40.00');
  expect(fixture.rpc.mock.calls.map(([name]) => name)).toEqual(['accounting_vehicle_costs']);
  open = true; await render();
  expect(host.textContent).toContain('Booked vehicle costs');
  expect(host.textContent).toContain('1 allocated of 1 visible entries');
  expect(host.querySelector('progress')?.getAttribute('value')).toBe('40');
  await act(async () => host.querySelector<HTMLDetailsElement>('.vp-financial-entry')!.open = true);
  expect(host.textContent).toContain('Source identifies this vehicle');
});

it('separates books, currencies, unallocated amounts and repeated row ids', () => {
  const costs = parseVehicleBookCosts([rawCost(), rawCost(), rawCost({ use_id: 'unsplit', allocated_amount: null }),
    rawCost({ use_id: 'other-book', book_owner_id: 'owner-b' }), rawCost({ use_id: 'other-currency', currency: 'EUR' })]);
  const totals = summarizeVehicleCosts(costs);
  expect(totals).toHaveLength(3);
  expect(totals[0]).toMatchObject({ total: 40, allocated: 1, unallocated: 1 });
  expect(totals.map(total => total.total)).toEqual([40, 40, 40]);
  expect(summarizeVehicleCosts(parseVehicleBookCosts([rawCost({ allocated_amount: null })]))[0].total).toBeNull();
  expect(summarizeVehicleCosts(parseVehicleBookCosts([rawCost({ currency: null })]))[0].total).toBeNull();
  expect(summarizeVehicleCosts(parseVehicleBookCosts([rawCost({ allocated_amount: '' })]))[0].total).toBeNull();
});

it('adds decimal money with the currency minor units and preserves real zero and refunds', () => {
  expect(summarizeVehicleCosts(parseVehicleBookCosts([rawCost({ allocated_amount: 0.1 }), rawCost({ use_id: 'b', allocated_amount: 0.2 })]))[0].total).toBe(0.3);
  expect(summarizeVehicleCosts(parseVehicleBookCosts([rawCost({ allocated_amount: 0 })]))[0].total).toBe(0);
  expect(summarizeVehicleCosts(parseVehicleBookCosts([rawCost({ allocated_amount: -1.5, currency: 'JPY' })]))[0].total).toBe(-2);
});

it('reduces the visible amount deliberately, keeps the door, and remembers the display preference', async () => {
  open = true; await render(<span>Recorded sale</span>);
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Reduce header amount')!.click());
  expect(host.querySelector('.vp-header-money')?.textContent).toBe('$$$');
  expect(localStorage.getItem(`vp:financial-display:v1:owner-a:${vehicleId}`)).toBe('reduced');
  expect(host.textContent).toContain('Show header amount');
});

it('drops another viewer’s amount immediately on account change and logout', async () => {
  await render(); expect(host.textContent).toContain('$40.00');
  let resolve!: (value: unknown) => void;
  fixture.rpc.mockReturnValue(new Promise(done => { resolve = done; }));
  fixture.user = { id: 'owner-b' }; await render();
  expect(host.textContent).not.toContain('$40.00');
  await act(async () => resolve({ data: [rawCost({ book_owner_id: 'owner-b', allocated_amount: 70 })], error: null }));
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
  fixture.rpc.mockImplementation((name: string) => Promise.resolve({ data: name === 'accounting_vehicle_costs' ? [rawCost()] : name === 'owner_working_notes' ? { tables: [] } : [
    { observation_id: 'audit-a', observed_at: '2024-06-01', content_text: 'Unpriced work', structured_data: { event_type: 'labor_payment', direction: 'out' } },
    { observation_id: 'audit-b', observed_at: '2024-06-01', content_text: 'Unscoped financial record', structured_data: { amount_usd: 15 } },
  ], error: null }));
  open = true; await render();
  expect(host.textContent).toContain('Unpriced work'); expect(host.textContent).toContain('Amount unknown');
  expect(host.querySelector('.vp-financial-total')?.textContent).toBe('$40.00');
  expect([...host.querySelectorAll('summary')].find(item => item.textContent?.includes('Unscoped financial record'))?.textContent).toContain('Financial record');
});

it('shows a truncated accounting read as a visible subtotal with its returned denominator', async () => {
  fixture.rpc.mockImplementation((name: string) => Promise.resolve({ data: name === 'accounting_vehicle_costs' ? [rawCost()] : name === 'owner_working_notes' ? { tables: [] } : [], count: 20, error: null }));
  open = true; await render();
  expect(host.textContent).toContain('1 of 20 visible cost entries loaded');
  expect(host.querySelector('.vp-financial-headline')?.textContent).toBe('Booked subtotal$40.00');
});

it('shows public receipt evidence while signed out, retaining the alternate amount field and pagination', async () => {
  fixture.user = null;
  fixture.tables.receipts_public_summary = Array.from({ length: 101 }, (_, index) => ({ id: `receipt-${index}`, vendor_name: `Synthetic receipt ${index}`,
    total: null, total_amount: 12.34, currency: null, transaction_date: '2024-06-01', status: 'processed' }));
  open = true; await render();
  expect(host.querySelector('.vp-header-money')?.textContent).toContain('Receipts101');
  expect(host.textContent).toContain('100 of 101 linked receipt records loaded');
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
  expect(host.textContent).toContain('100 of 101 linked receipt records loaded');
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
  expect(host.querySelector('.vp-financial-total')?.textContent).toBe('$40.00');
});
