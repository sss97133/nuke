// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
vi.mock('../PrefetchLink', () => ({ PrefetchLink: ({ to, children }: any) => <a href={to}>{children}</a> }));
import BuyerMarketEvidence from './BuyerMarketEvidence';
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); fixture.rpc.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function render() {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter>
    <BuyerMarketEvidence year={2008} make="Bentley" model="CONTINENTAL GTC" vehicleId="subject" />
  </MemoryRouter></QueryClientProvider>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
}
it('retains internal acquisition research and explicit failure without manufacturing a price', async () => {
  fixture.rpc.mockResolvedValue({ data: null, error: { code: 'network', message: 'Unavailable' } });
  await render();
  expect(host.textContent).toContain('Sale evidence could not be read');
  expect(host.textContent).not.toContain('$0');
  const link = host.querySelector('a')!;
  expect(link.getAttribute('href')).toContain('/valuation?');
  expect(link.getAttribute('href')).toContain('vehicle_id=subject');
  expect(link.getAttribute('target')).toBeNull();
});
it('refuses a successful response belonging to a different car comparison', async () => {
  fixture.rpc.mockResolvedValue({ error: null, data: { query: { year: 2007, make: 'Bentley', model: 'CONTINENTAL GTC' },
    receipt: { cohort: { complete: true }, eligible: [], currency: 'USD', knowledge_mode: 'retrospective' }, stats: { median: 99000 } } });
  await render();
  expect(host.textContent).toContain('Sale evidence could not be read');
  expect(host.textContent).not.toContain('99,000');
  expect(host.querySelector('[aria-label="Source-qualified sale graph"]')).toBeNull();
});
it('distinguishes an answered empty comparison from zero demand or value', async () => {
  fixture.rpc.mockResolvedValue({ error: null, data: { query: { year: 2008, make: 'Bentley', model: 'CONTINENTAL GTC' },
    receipt: { cohort: { complete: true, key: 'comparison', label: 'Synthetic' }, eligible: [], currency: 'USD', knowledge_mode: 'retrospective',
      event_from: '2023-01-01T00:00:00Z', event_before: '2026-01-01T00:00:00Z', evidence_as_of: '2026-01-01T00:00:00Z', computed_at: '2026-01-01T00:00:00Z', minimum_sales: 10 },
    stats: { median: null }, comparables: [] } });
  await render();
  expect(host.textContent).toContain('No qualified sales');
  expect(host.textContent).toContain('Missing evidence does not establish a low value or low demand');
  expect(fixture.rpc).toHaveBeenCalledWith('valuation_by_ymm', expect.objectContaining({ p_price: null, p_subject_vehicle_id: 'subject' }));
});
