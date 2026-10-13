// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc, from: fixture.from } }));
import { assertPulseColumns, fetchPulse, PULSE_COLUMNS, readInventoryTaxonomy, useMarketPulse } from './useMarketPulse';

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('recorded bid pulse lifetime', () => {
  it('baselines the initial response, expires the pulse, and does not replay an unchanged read', async () => {
    vi.useFakeTimers();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    const row = (bid: number) => ['fixture', 1995, 'Ford', 'Mustang', bid, '2026-10-20T00:00:00Z', '2026-10-10T00:00:00Z', '2026-10-09T00:00:00Z', null, false, 'https://bringatrailer.com/listing/fixture/'];
    let latest: ReturnType<typeof useMarketPulse>;
    function Probe() { latest = useMarketPulse(); return <span>{[...latest.risenIds].join(',')}</span>; }
    fixture.rpc.mockResolvedValue({ data: { auctions: [row(100)] }, error: null });
    try {
      await act(async () => { root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(container.textContent).toBe('');
      fixture.rpc.mockResolvedValue({ data: { auctions: [row(200)] }, error: null });
      await act(async () => { await latest!.refetch(); await vi.advanceTimersByTimeAsync(1); });
      expect(container.textContent).toBe('fixture');
      await act(async () => { await vi.advanceTimersByTimeAsync(1800); });
      expect(container.textContent).toBe('');
      await act(async () => { await latest!.refetch(); await vi.advanceTimersByTimeAsync(1); });
      expect(container.textContent).toBe('');
    } finally { await act(async () => root.unmount()); client.clear(); container.remove(); }
  });
});

describe('bounded public taxonomy reader', () => {
  it('repeats public eligibility for every bounded batch and refuses partial failures', async () => {
    const queries: any[] = [];
    fixture.from.mockImplementation(() => {
      const query: any = { select: vi.fn(), in: vi.fn(), eq: vi.fn(), is: vi.fn(), or: vi.fn(), limit: vi.fn() };
      for (const fn of Object.values(query) as any[]) fn.mockReturnValue(query);
      query.then = (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve);
      queries.push(query); return query;
    });
    await readInventoryTaxonomy(Array.from({ length: 205 }, (_, i) => String(i)));
    expect(queries).toHaveLength(3);
    expect(queries.map(q => q.in.mock.calls[0][1].length)).toEqual([100, 100, 5]);
    for (const q of queries) {
      expect(q.eq).toHaveBeenCalledWith('is_public', true);
      expect(q.is).toHaveBeenCalledWith('deleted_at', null);
      expect(q.or).toHaveBeenCalledWith('listing_kind.is.null,listing_kind.neq.non_vehicle_item');
      expect(q.limit).toHaveBeenCalledWith(100);
    }
    fixture.from.mockImplementationOnce(() => {
      const query = queries[0]; query.then = (resolve: any) => Promise.resolve({ data: null, error: new Error('reader unavailable') }).then(resolve); return query;
    });
    await expect(readInventoryTaxonomy(['a'])).rejects.toThrow('reader unavailable');
  });
});

describe('the payload names its slots', () => {
  const row = ['lot-1', 1973, 'Porsche', '911', 650000, '2026-10-14T17:05:00Z', '2026-10-13T23:00:00Z', '2026-10-07T00:00:00Z',
    null, true, 'https://bringatrailer.com/listing/lot-1/', '1973 Porsche 911', 478000, 552000, 700000, 'd', 15];
  it('decodes a v2 payload whose columns are the ones it reads by position', async () => {
    fixture.rpc.mockResolvedValue({ data: { v: 2, columns: [...PULSE_COLUMNS], auctions: [row] }, error: null });
    const pulse = await fetchPulse();
    expect(pulse.auctions).toHaveLength(1);
    expect(pulse.auctions[0]).toMatchObject({ id: 'lot-1', year: 1973, currentBid: 650000, noReserve: true, band: { p50: 552000, tier: 'd', comps: 15 } });
  });
  it('refuses a payload whose slots moved, instead of reading a bid as a year', async () => {
    const moved = [...PULSE_COLUMNS]; moved.splice(4, 0, 'reserve_met'); moved.pop();
    fixture.rpc.mockResolvedValue({ data: { v: 3, columns: moved, auctions: [row] }, error: null });
    await expect(fetchPulse()).rejects.toThrow(/names its slots \[id, year, make, model, reserve_met, current_bid/);
    expect(() => assertPulseColumns(PULSE_COLUMNS.slice(0, 16))).toThrow(/this reader expects/);
  });
  it('still decodes a v1 payload that names nothing', async () => {
    fixture.rpc.mockResolvedValue({ data: { auctions: [row] }, error: null });
    const pulse = await fetchPulse();
    expect(pulse.auctions[0].currentBid).toBe(650000);
    expect(() => assertPulseColumns(undefined)).not.toThrow();
  });
});
