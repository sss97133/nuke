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

describe('phone vehicle browsing', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(max-width: 640px)' || query === '(hover: none)', media: query,
      addEventListener() {}, removeEventListener() {},
    })));
    installTreemapReads({
      treemap_family_models: Promise.resolve({ error: null, data: [
        { model: '911', sold: 12, usd: 1_200_000 }, { model: '911S', sold: 8, usd: 800_000 },
      ] }),
      treemap_years: Promise.resolve({ error: null, data: [{ name: '1974', count: 12, value: 1_200_000 }] }),
      treemap_sales: Promise.resolve({ error: null, data: [{
        id: '1974-sale', year: 1974, make: 'Porsche', model: '911', sold_amount: 100_000,
      }] }),
    });
  });
  function list() { return container.querySelector('[aria-label^="Browse "][aria-label$=" choices"]')!; }
  async function choose(kind: string, value: string) {
    const picker = container.querySelector<HTMLSelectElement>(`select[aria-label="Choose a ${kind}"]`)!;
    expect(picker.disabled).toBe(false);
    await act(async () => { picker.value = value; picker.dispatchEvent(new Event('change', { bubbles: true })); });
  }
  async function click(text: string) {
    const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent === text)!;
    expect(button).toBeTruthy();
    await act(async () => button.click());
  }

  it('starts with direct choices and leaves the map and refinements optional', async () => {
    await renderTreemap();
    expect(list().getAttribute('aria-label')).toBe('Browse make choices');
    expect(list().textContent).toContain('20 sales');
    expect(container.querySelector('button[aria-label="Browse Porsche"]')).not.toBeNull();
    expect(container.querySelector<HTMLDetailsElement>('.home-map-refine')!.open).toBe(false);
    expect(container.querySelector<HTMLDetailsElement>('.home-family-comparisons')!.open).toBe(false);
    expect(container.querySelector('button.market-tile')).toBeNull();
    expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toBe('List');
  });

  it('does not offer the previous cohort while the chosen make is loading', async () => {
    const pending = deferredRead();
    installTreemapReads({ treemap_brand_families: pending.promise });
    await renderTreemap();
    await choose('make', 'Porsche');
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Choose a family"]')!.disabled).toBe(true);
    expect(container.querySelectorAll('.home-phone-browse-list > button')).toHaveLength(0);
    expect(container.textContent).toContain('Reading sales…');
    await act(async () => pending.resolve({ data: families, error: null }));
    expect(container.querySelector('button[aria-label="Browse 911"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Browse Porsche"]')).toBeNull();
  });

  it('keeps the same cohort through make, family, model, year and vehicle choices on a coarse pointer', async () => {
    await renderTreemap();
    await choose('make', 'Porsche');
    expect(new URLSearchParams(window.location.search).get('make')).toBe('Porsche');
    await choose('family', '911');
    expect(new URLSearchParams(window.location.search).get('family')).toBe('911');
    expect(list().getAttribute('aria-label')).toBe('Browse model choices');
    expect(container.querySelector<HTMLDetailsElement>('.home-family-history')!.open).toBe(false);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await choose('model', '911');
    expect(fixture.client.rpc).toHaveBeenCalledWith('treemap_years', { p_source: null, p_make: 'Porsche', p_model: '911' });
    await choose('year', '1974');
    expect(fixture.client.rpc).toHaveBeenCalledWith('treemap_sales', { p_make: 'Porsche', p_model: '911', p_year: 1974 });
    const sale = container.querySelector<HTMLButtonElement>('button[aria-label="Open 1974 Porsche 911"]')!;
    expect(sale).not.toBeNull();
    await act(async () => sale.click());
    expect(window.location.pathname).toBe('/vehicle/1974-sale');
  });

  it('offers a visible parent action and follows browser history without losing the list', async () => {
    await renderTreemap('tab=market&make=Porsche&family=911&model=911&year=1974');
    await click('← Back to 911');
    expect(new URLSearchParams(window.location.search).has('year')).toBe(false);
    expect(list().getAttribute('aria-label')).toBe('Browse year choices');
    expect(document.activeElement?.textContent).toBe('911');
    await navigate('/?tab=market&make=Porsche');
    expect(list().getAttribute('aria-label')).toBe('Browse family choices');
  });

  it('shows the map only when requested and restores direct model choices after an explicit chart view', async () => {
    await renderTreemap('tab=market&make=Porsche&family=911');
    await click('Map');
    expect(container.querySelector('.home-phone-browse-list')).toBeNull();
    // The existing chart control remains an explicit action inside Refine.
    const sales = [...container.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent === 'Sales')!;
    await act(async () => sales.click());
    expect(container.querySelector('.home-family-history')).toBeNull();
    await click('List');
    expect(list().getAttribute('aria-label')).toBe('Browse model choices');
    expect(container.querySelector('select[aria-label="Choose a model"]')).not.toBeNull();
  });
});
