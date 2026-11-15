// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ area: vi.fn(), sources: vi.fn() }));
vi.mock('./oneMapService', () => ({
  readArea: mock.area, readAreas: mock.sources, platformName: (source: string) => source,
}));
import { ZipAreaActivity } from './ZipAreaActivity';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { document.body.replaceChildren(); vi.resetAllMocks(); });

it('shows a dated aggregate and an exact source breakdown, with browse labeled separately', async () => {
  mock.area.mockImplementation((_level: string, zip: string, from: string, to: string) => Promise.resolve({
    level: 'zcta', key: zip, from, to, layers: [
      { layer: 'listing', entities: 47, priced: 6, as_of: '2026-11-15 14:29:00+00', latest_day: '2026-11-13' },
      { layer: 'sale', entities: 13, priced: 13, as_of: '2026-11-15 09:20:00+00', latest_day: '2026-10-03' },
    ],
  }));
  mock.sources.mockImplementation((_level: string, _layer: string, from: string, to: string) => Promise.resolve({
    level: 'zcta', layer: 'listing', from, to,
    areas: [{ key: '89005', entities: 47, priced: 6 }],
    by_source: [{ source: 'bat', entities: 40 }, { source: 'carsandbids', entities: 7 }],
    as_of: '2026-11-15 14:29:00+00',
  }));
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root.render(<QueryClientProvider client={client}><ZipAreaActivity zip="89005" /></QueryClientProvider>); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(host.textContent).toContain('47 first-seen listings');
  expect(host.textContent).toContain('13 recorded sold events');
  expect(host.textContent).toContain('6 with asking amounts');
  expect(host.querySelector('select')?.value).toBe('365');
  expect(host.textContent).toContain('bat · 40');
  expect(host.textContent).toContain('not current inventory');
  expect(host.textContent).toContain('record list spans more dates');
  await act(async () => root.unmount());
  client.clear();
});
