// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { useVehicleImageEvidence } from './useVehicleImageEvidence';

const fixture = vi.hoisted(() => ({ fail: true, rpc: vi.fn() }));
vi.mock('../../../lib/vehicleImageColumns', () => ({ vehicleImageGallerySource: async () => 'vehicle_images' }));
vi.mock('../../../lib/supabase', () => ({ supabase: {
  rpc: fixture.rpc,
  from: () => {
    const query: any = {};
    for (const method of ['select', 'eq', 'not', 'is', 'or', 'order', 'limit']) query[method] = () => query;
    query.abortSignal = async () => ({ data: [], count: 0, error: fixture.fail ? new Error('inventory unavailable') : null });
    return query;
  },
} }));

it('recovers an unmapped field inventory without calling the disabled facet reader', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement('div');
  const root = createRoot(host);
  let result: ReturnType<typeof useVehicleImageEvidence>;
  function Probe() { result = useVehicleImageEvidence('vehicle-fixture', 'vin'); return null; }
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>); });
    await vi.waitFor(() => expect(result!.isError).toBe(true));
    fixture.fail = false;
    await act(async () => { await result!.refetch(); });
    await vi.waitFor(() => expect(result!.isError).toBe(false));
    expect(result!.data?.complete).toBe(true);
    expect(fixture.rpc).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
