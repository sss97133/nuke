// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc: vi.fn(), user: null as { id: string } | null }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: fixture.user, loading: false }) }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
import ProfileFinancials, { summarizeVehicleCosts } from './ProfileFinancials';
import { parseVehicleBookCosts } from './hooks/useBuildLedger';

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
  ], error: null }));
  open = true; await render();
  expect(host.textContent).toContain('Unpriced work'); expect(host.textContent).toContain('Amount unknown');
  expect(host.querySelector('.vp-financial-total')?.textContent).toBe('$40.00');
});

it('shows a truncated accounting read as a visible subtotal with its returned denominator', async () => {
  fixture.rpc.mockImplementation((name: string) => Promise.resolve({ data: name === 'accounting_vehicle_costs' ? [rawCost()] : name === 'owner_working_notes' ? { tables: [] } : [], count: 20, error: null }));
  open = true; await render();
  expect(host.textContent).toContain('1 of 20 visible cost entries loaded');
  expect(host.querySelector('.vp-financial-headline')?.textContent).toBe('Booked subtotal$40.00');
});
