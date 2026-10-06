// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ params: new URLSearchParams(), requests: [] as any[], navigate: vi.fn() }));
vi.mock('react-router-dom', () => ({ useSearchParams: () => [fixture.params], useNavigate: () => fixture.navigate }));
vi.mock('../lib/track', () => ({ track: vi.fn() }));
vi.mock('../services/aiDataIngestion', () => ({ ingestVehicle: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: {
  rpc: async () => ({ data: null }),
  functions: { invoke: async (_name: string, request: any) => {
    fixture.requests.push(request.body);
    return { error: null, data: { results: [
      { id: 'under', type: 'vehicle', metadata: { sale_price: 12000 } },
      { id: 'over', type: 'vehicle', metadata: { sale_price: 77000 } },
      { id: 'ask-over', type: 'vehicle', metadata: { asking_price: 204000 } },
      { id: 'unknown', type: 'vehicle', metadata: {} },
      { id: 'estimate-under', type: 'vehicle', metadata: { current_value: 14000 } },
    ], meta: { total_count: 5, offset: request.body.offset || 0, limit: 100, has_more: !request.body.offset } } };
  } },
} }));
import { useSearchPage } from './useSearchPage';
let state: ReturnType<typeof useSearchPage>; let root: Root; let container: HTMLDivElement;
function Harness() { state = useSearchPage(); return <div>{state.displayResults.map(r => <span key={r.id}>{r.id}</span>)}</div>; }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.params = new URLSearchParams({ q: 'cool cars under $30,000' }); fixture.requests = [];
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it('constrains a direct natural-language budget query and excludes unknown/over-budget displayed prices', async () => {
  await act(async () => root.render(<Harness />));
  expect(state.filters.priceMax).toBe('30000');
  expect(state.displayResults.map(r => r.id)).toEqual(['under','estimate-under']);
  expect(fixture.requests[0].includeAI).toBe(false);
  expect(state.vehicleCount).toBe(5); expect(state.displayVehicleCount).toBe(2);
});
it('keeps the budget on loaded pages and clears it when the user changes to an unbounded query', async () => {
  await act(async () => root.render(<Harness />));
  await act(async () => state.handleLoadMore());
  expect(fixture.requests[1]).toMatchObject({ offset: 100, includeAI: false });
  expect(state.displayResults.map(r => r.id)).toEqual(['under','estimate-under']);
  fixture.params = new URLSearchParams({ q: 'Jeep Cherokee' });
  await act(async () => root.render(<Harness />));
  expect(state.filters.priceMax).toBe(''); expect(state.displayResults).toHaveLength(5);
});
it('uses explicit URL price filters and never lets absent sale prices bypass an upper bound', async () => {
  fixture.params = new URLSearchParams({ q: 'Jeep Cherokee', priceMax: '13000' });
  await act(async () => root.render(<Harness />));
  expect(state.displayResults.map(r => r.id)).toEqual(['under']);
});
