// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ client: null as any }));
vi.mock('../../lib/supabase', () => ({ get supabase() { return fixture.client; } }));
import { WatchersPopup } from './WatchersPopup';

let root: Root, host: HTMLDivElement, reads: { url: URL; resolve: (response: Response) => void }[];
const main = () => host.firstElementChild as HTMLElement;
const rank = () => [...main().querySelectorAll('div')].find(div => /^(?:\d+th percentile|Top \d+% most-watched|Bottom \d+% in attention)$/.test(div.textContent ?? '')) ?? null;
const spans = () => [...main().querySelectorAll('span')].map(span => span.textContent);
const bars = () => [...main().querySelectorAll<HTMLElement>('div[style*="transition: width"]')].map(div => div.style.width);
const hero = '50PEOPLE WATCHED THIS AUCTION1,234 page views';
async function draw(watcherCount = 50) {
  await act(async () => root.render(<WatchersPopup vehicleId="synthetic-watchers" watcherCount={watcherCount} viewCount={1234} make="Synthetic" model="Coupe" />));
}
async function settle(values: number[] = [10, 20, 30, 100], status = 200) {
  const rows = values.map(bat_watchers => ({ bat_watchers })), raw = structuredClone(rows);
  await act(async () => reads[0].resolve(new Response(JSON.stringify(status === 200 ? rows : { message: 'Synthetic refused peer read' }),
    { status, headers: { 'Content-Type': 'application/json' } })));
  expect(rows).toEqual(raw);
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; reads = [];
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden'); }));
  fixture.client = createClient('https://watchers-range.test', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'synthetic-watchers-range' },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(init?.method ?? 'GET').toBe('GET'); expect(url.pathname).toBe('/rest/v1/vehicles');
      expect([...url.searchParams.entries()]).toEqual([['select', 'bat_watchers'], ['make', 'eq.Synthetic'], ['model', 'eq.Coupe'],
        ['bat_watchers', 'not.is.null'], ['bat_watchers', 'gt.0'], ['limit', '500']]);
      return new Promise<Response>(resolve => reads.push({ url, resolve }));
    } },
  });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

it.each([
  { name: 'low interior distribution', values: [10, 20, 30, 100], current: 50 },
  { name: 'high interior distribution with the same bounds', values: [10, 80, 90, 100], current: 50 },
  { name: 'held maximum', values: [10, 20, 30, 100], current: 100 },
  { name: 'all tied', values: [50, 50, 50, 50], current: 50 },
])('withholds a distribution-rank caption for $name', async ({ values, current }) => {
  await draw(current); expect(main().textContent).toContain('Loading comparisons...'); expect(rank()).toBeNull();
  await settle(values); expect(reads).toHaveLength(1); expect(bars()).toHaveLength(4);
  // Min/max interpolation cannot establish an empirical percentile or population top/bottom rank.
  expect(rank()).toBeNull();
});
it('preserves the complete single-member result without a rank caption', async () => {
  await draw(); await settle([50]);
  expect(main().textContent).toBe(`${hero}VS SYNTHETIC COUPE (1 AUCTIONS)THIS VEHICLE50MEDIAN50AVERAGE50MAX500% vs medianTypical interest level`);
  expect(bars()).toEqual(['100%', '100%', '100%', '100%']); expect(rank()).toBeNull(); expect(reads).toHaveLength(1);
});
it('preserves the complete empty-read result and its existing demand', async () => {
  await draw(); await settle([]); expect(main().textContent).toBe(`${hero}No comparable watcher counts in this read.`);
  expect(spans()).toEqual(['No comparable watcher counts in this read.']); expect(bars()).toEqual([]); expect(rank()).toBeNull(); expect(reads).toHaveLength(1);
});
it('preserves all held statistics, numeric bars, hero and verdict independently of rank', async () => {
  await draw(); await settle(); expect(main().firstElementChild!.textContent).toBe(hero);
  expect(spans()).toEqual(['THIS VEHICLE', '50', 'MEDIAN', '25', 'AVERAGE', '40', 'MAX', '100', '+100% vs median', 'Exceptionally high interest']);
  expect(bars()).toEqual(['50%', '25%', '40%', '100%']); expect(reads).toHaveLength(1);
});
it('preserves the current API-error presentation and one-read boundary', async () => {
  await draw(); await settle([], 403); expect(main().textContent).toBe(`${hero}Watcher comparisons unavailable.`);
  expect(bars()).toEqual([]); expect(reads).toHaveLength(1);
});
it('preserves one pending current peer read when only the supplied watcher count rerenders', async () => {
  await draw(); await draw(40); expect(reads).toHaveLength(1); await settle();
  expect(main().firstElementChild!.textContent).toBe('40PEOPLE WATCHED THIS AUCTION1,234 page views');
  expect(spans()).toEqual(['THIS VEHICLE', '40', 'MEDIAN', '25', 'AVERAGE', '40', 'MAX', '100', '+60% vs median', 'Exceptionally high interest']);
  expect(bars()).toEqual(['40%', '25%', '40%', '100%']); expect(reads).toHaveLength(1);
});
it('preserves cancellation when the popup closes before its peer reply', async () => {
  await draw(); await act(async () => root.render(null)); await settle(); expect(host.textContent).toBe(''); expect(reads).toHaveLength(1);
});
