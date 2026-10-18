// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../hooks/useVehiclesDashboard', () => ({ useVehiclesDashboard: () => ({}) }));
vi.mock('../components/onboarding/OnboardingSlideshow', () => ({ OnboardingSlideshow: () => null }));
vi.mock('./market/MarketInventory', () => ({ default: () => <div role="region" aria-label="Market screen" /> }));
vi.mock('./market/SourcesBoard', () => ({ default: () => null }));
vi.mock('../feed/components/FeedPage', () => ({ default: () => <div role="region" aria-label="Feed screen" /> }));
vi.mock('../components/garage/GarageTab', () => ({ default: () => <div role="region" aria-label="Garage screen" /> }));
vi.mock('./intake/IntakePage', () => ({ default: () => null }));
const fixture = vi.hoisted(() => ({ client: {} as any }));
vi.mock('../lib/supabase', () => ({ supabase: fixture.client }));

import HomePage, { TreemapHomePage } from './HomePage';
let root: Root, container: HTMLDivElement;

beforeEach(() => {
  for (const key of Object.keys(fixture.client)) delete fixture.client[key];
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  // Node 25 exposes a native storage placeholder to Vitest's worker. Supply
  // browser storage for this navigation test instead of using that host API.
  const saved = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    clear: () => saved.clear(),
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  });
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function render() {
  await act(async () => root.render(<BrowserRouter><HomePage /></BrowserRouter>));
}
async function navigate(url: string) {
  await act(async () => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}
function screen() { return container.querySelector('[role="region"]')?.getAttribute('aria-label'); }

describe('public market navigation', () => {
  it('opens the market on arrival even when a previous session saved Garage', async () => {
    localStorage.setItem('nuke_hub_tab_v2', 'garage');
    await render();
    expect(screen()).toBe('Market screen');
    expect(container.querySelector('a[aria-current="page"]')?.textContent).toBe('Market');
  });
  it('updates the displayed screen for header navigation and history changes', async () => {
    await render();
    await navigate('/?tab=feed&make=Porsche');
    expect(screen()).toBe('Feed screen');
    expect(container.querySelector('a[aria-current="page"]')?.textContent).toBe('Feed');
    await navigate('/?tab=garage');
    expect(screen()).toBe('Garage screen');
    await navigate('/?tab=market&make=Porsche');
    expect(screen()).toBe('Market screen');
    expect(container.querySelectorAll('[role="region"]')).toHaveLength(1);
  });
  it('uses real links on mobile and defaults an unsupported tab to the market', async () => {
    await navigate('/?tab=invalid');
    await render();
    expect(screen()).toBe('Market screen');
    const feed = container.querySelector<HTMLAnchorElement>('a[href="/?tab=feed"]')!;
    await act(async () => feed.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
    expect(screen()).toBe('Feed screen');
    expect(window.location.search).toBe('?tab=feed');
  });
});

function deferredRead() {
  let resolve!: (result: { data: any[]; error: null }) => void;
  const promise = new Promise<{ data: any[]; error: null }>(done => { resolve = done; });
  return { promise, resolve };
}
const brands = [{ name: 'Porsche', count: 20, value: 2_000_000, usd: 2_000_000 }];
const families = [{ family: '911', family_key: '911', models: 2, sold: 20, usd: 2_000_000 }];
function installTreemapReads(overrides: Record<string, unknown> = {}) {
  const query: any = Promise.resolve({ data: [], error: null });
  for (const method of ['select', 'order', 'limit', 'eq', 'gt', 'not', 'is', 'in']) query[method] = () => query;
  fixture.client.from = () => query;
  fixture.client.rpc = vi.fn((name: string) => overrides[name] ?? Promise.resolve({ error: null, data:
    name === 'treemap_by_brand' || name === 'treemap_brand_market' ? brands : name === 'treemap_brand_families' ? families : [] }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON() {} });
}
async function renderTreemap(query = 'tab=market') {
  window.history.replaceState({}, '', '/?' + query);
  await act(async () => root.render(<BrowserRouter><TreemapHomePage embedded onBrowse={() => {}} /></BrowserRouter>));
}
function loadingMessages() { return [...container.querySelectorAll('div')].filter(el => el.childElementCount === 0 && el.textContent === 'LOADING...'); }

describe('map loading belongs to its current level', () => {
  it('shows the initial brand read until its real response arrives', async () => {
    const pending = deferredRead(); installTreemapReads({ treemap_by_brand: pending.promise });
    await renderTreemap(); expect(loadingMessages()).toHaveLength(1);
    await act(async () => pending.resolve({ data: brands, error: null }));
    expect(loadingMessages()).toHaveLength(0);
    expect(container.querySelector('button.market-tile[aria-label="Porsche"]')).not.toBeNull();
  });
  it.each([
    ['fallback models', 'make=Porsche', 'treemap_models_by_brand'],
    ['model years', 'make=Porsche&model=911', 'treemap_years'],
    ['year sales', 'make=Porsche&model=911&year=1974', 'treemap_sales'],
  ])('unblocks ALL MAKES after leaving pending %s', async (_, scope, reader) => {
    const pending = deferredRead();
    installTreemapReads({ [reader]: pending.promise,
      ...(reader === 'treemap_models_by_brand' ? { treemap_brand_families: Promise.resolve({ data: [], error: null }) } : {}) });
    await renderTreemap('tab=market&' + scope);
    expect(fixture.client.rpc).toHaveBeenCalledWith(reader, expect.any(Object));
    expect(loadingMessages()).toHaveLength(1);
    const all = [...container.querySelectorAll<HTMLButtonElement>('button.home-map-crumb')].find(button => button.textContent === 'ALL MAKES')!;
    await act(async () => all.click());
    expect(window.location.search).toBe('?tab=market');
    expect(container.querySelector('button.market-tile[aria-label="Porsche"]')).not.toBeNull();
    expect(loadingMessages()).toHaveLength(0);
  });
  it.each([
    ['brand families', 'make=Porsche', 'treemap_brand_families', families],
    ['family models', 'make=Porsche&family=911', 'treemap_family_models', [{ model: '911', sold: 20, usd: 2_000_000 }]],
  ])('keeps the active %s read visible until it settles', async (_, scope, reader, rows) => {
    const pending = deferredRead(); installTreemapReads({ [reader]: pending.promise });
    await renderTreemap('tab=market&' + scope);
    expect(loadingMessages()).toHaveLength(1);
    await act(async () => pending.resolve({ data: rows as any[], error: null }));
    expect(loadingMessages()).toHaveLength(0);
  });
});

describe('composable Truck map', () => {
  function installTruckRead(fail = false) {
    installTreemapReads();
    const previous = fixture.client.rpc;
    fixture.client.rpc = vi.fn((name: string, args: any) => args?.p_members
      ? Promise.resolve({ error: fail ? { message: 'unavailable' } : null, data: {
        n: args.p_partition === 0 ? 2 : 0, truncated: false, has_more: false, next_cursor: 'b', snapshot: 'fold', as_of: '2026-10-18',
        rows: args.p_partition === 0 ? [ ['a','C10 Custom Pickup',1972,20000,'Mecum','2026-01-01','C10','4WD',null,null,null,null,null,null],
          ['b','K10 Short Bed',1972,30000,'Mecum','2026-01-02','K10','RWD',null,null,null,null,null,null] ] : [],
      } }) : previous(name,args));
  }
  it('preserves a selected drivetrain when changing grouping, with an exact count and removable chip', async () => {
    installTruckRead();
    await renderTreemap('tab=market&make=Chevrolet&family=pickup&family_name=Truck&truck_group=drive');
    const tile = container.querySelector<HTMLElement>('[role="button"][aria-label="4WD"]');
    expect(tile).not.toBeNull();
    await act(async () => tile!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(new URLSearchParams(window.location.search).get('truck_drive')).toBe('4WD');
    const era = [...container.querySelectorAll<HTMLButtonElement>('.truck-facets button')].find(b => b.textContent === 'Era')!;
    await act(async () => era.click());
    expect(new URLSearchParams(window.location.search).get('truck_group')).toBe('era');
    expect(new URLSearchParams(window.location.search).get('truck_drive')).toBe('4WD');
    expect(container.querySelector('.truck-facets__selection')?.textContent).toContain('1 of 2');
    const chip = container.querySelector<HTMLButtonElement>('button[aria-label="Remove Drivetrain filter: 4WD"]')!;
    await act(async () => chip.click());
    expect(new URLSearchParams(window.location.search).has('truck_drive')).toBe(false);
    expect(container.querySelector('.truck-facets__selection')?.textContent).toContain('2 of 2');
    expect(fixture.client.rpc.mock.calls.filter(([,a]: any[]) => a?.p_members)).toHaveLength(4);
  });
  it('shows a reader failure without substituting all-make tiles', async () => {
    installTruckRead(true);
    await renderTreemap('tab=market&make=Chevrolet&family=pickup&family_name=Truck');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Complete truck membership could not be read');
    expect(container.querySelector('button.market-tile[aria-label="Porsche"]')).toBeNull();
  });
  it('reads representative photos only from members of the selected drivetrain', async () => {
    installTruckRead();
    const previousFrom = fixture.client.from;
    const query: any = Promise.resolve({ data: [], error: null });
    for (const method of ['select', 'in', 'not', 'is', 'eq', 'order', 'limit', 'gt']) query[method] = vi.fn(() => query);
    fixture.client.from = (table: string) => table === 'vehicles' ? query : previousFrom(table);
    await renderTreemap('tab=market&make=Chevrolet&family=pickup&family_name=Truck&truck_group=series&truck_drive=4WD');
    expect(query.in).toHaveBeenCalledWith('id', ['a']);
    expect(query.eq).toHaveBeenCalledWith('is_public', true);
    expect(query.eq).not.toHaveBeenCalledWith('make', 'Chevrolet');
  });
});
