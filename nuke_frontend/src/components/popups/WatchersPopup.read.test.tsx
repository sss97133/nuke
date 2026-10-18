// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ client: null as any }));
vi.mock('../../lib/supabase', () => ({ get supabase() { return fixture.client; } }));
import { WatchersPopup } from './WatchersPopup';

type Read = { resolve: (response: Response) => void; reject: (reason: Error) => void };
let root: Root, host: HTMLDivElement, reads: Read[];
const hero = '50PEOPLE WATCHED THIS AUCTION1,234 page views';
const privateMessage = 'Synthetic private peer error';
const text = () => host.textContent;
async function draw(make: string | null = 'Synthetic', model: string | null = 'Coupe') {
  await act(async () => root.render(<WatchersPopup vehicleId="synthetic-watch-read" watcherCount={50} viewCount={1234} make={make} model={model} />));
}
async function settle(values: number[] = [], status = 200) {
  const rows = values.map(bat_watchers => ({ bat_watchers })), raw = structuredClone(rows);
  await act(async () => reads[0].resolve(new Response(JSON.stringify(status === 200 ? rows : { code: '42501', message: privateMessage }),
    { status, headers: { 'Content-Type': 'application/json' } })));
  expect(rows).toEqual(raw);
}
async function rejectTransport() { await act(async () => reads[0].reject(new Error(privateMessage))); }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; reads = [];
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden'); }));
  fixture.client = createClient('https://watchers-read.test', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'synthetic-watchers-read' },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(init?.method ?? 'GET').toBe('GET'); expect(url.pathname).toBe('/rest/v1/vehicles');
      expect([...url.searchParams.entries()]).toEqual([['select', 'bat_watchers'], ['make', 'eq.Synthetic'], ['model', 'eq.Coupe'],
        ['bat_watchers', 'not.is.null'], ['bat_watchers', 'gt.0'], ['limit', '500']]);
      return new Promise<Response>((resolve, reject) => reads.push({ resolve, reject }));
    } },
  });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

it('watcher-read: reports a current API error without disclosing its raw message', async () => {
  await draw(); expect(text()).toBe(`${hero}Loading comparisons...`); await settle([], 403);
  expect(text()).toBe(`${hero}Watcher comparisons unavailable.`); expect(text()).not.toContain(privateMessage); expect(reads).toHaveLength(1);
});
it('watcher-read: reports a rejected transport through the actual installed client', async () => {
  await draw(); await rejectTransport(); expect(text()).toBe(`${hero}Watcher comparisons unavailable.`);
  expect(text()).not.toContain(privateMessage); expect(reads).toHaveLength(1);
});
it('watcher-read: qualifies a successful bounded empty reply', async () => {
  await draw(); await settle([]); expect(text()).toBe(`${hero}No comparable watcher counts in this read.`); expect(reads).toHaveLength(1);
});
it('watcher-read: preserves the complete successful known count result and bars', async () => {
  await draw(); await settle([50]);
  expect(text()).toBe(`${hero}VS SYNTHETIC COUPE (1 AUCTIONS)THIS VEHICLE50MEDIAN50AVERAGE50MAX500% vs medianTypical interest level`);
  expect([...host.querySelectorAll<HTMLElement>('div[style*="transition: width"]')].map(div => div.style.width)).toEqual(['100%', '100%', '100%', '100%']);
  expect(reads).toHaveLength(1);
});
it.each([
  { name: 'make', make: null, model: 'Coupe' }, { name: 'model', make: 'Synthetic', model: null },
])('watcher-read: preserves no-query behavior when $name is unavailable', async ({ make, model }) => {
  await draw(make, model); expect(text()).toBe(hero); expect(reads).toHaveLength(0);
});
it('watcher-read: preserves a useful pending read and its current loading presentation', async () => {
  await draw(); await draw(); expect(text()).toBe(`${hero}Loading comparisons...`); expect(reads).toHaveLength(1);
});
it('watcher-read: preserves cancellation when the popup closes before a rejected transport', async () => {
  await draw(); await act(async () => root.render(null)); await rejectTransport(); expect(text()).toBe(''); expect(reads).toHaveLength(1);
});
