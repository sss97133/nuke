// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../hooks/useVehiclesDashboard', () => ({ useVehiclesDashboard: () => ({}) }));
vi.mock('../components/onboarding/OnboardingSlideshow', () => ({ OnboardingSlideshow: () => null }));
vi.mock('./market/MarketInventory', () => ({ default: () => {
  if (fixture.pendingPanel === 'market') throw fixture.pending;
  return <div role="region" aria-label="Market screen" />;
} }));
vi.mock('./market/SourcesBoard', () => ({ default: () => {
  if (fixture.pendingPanel === 'sources') throw fixture.pending;
  return <div data-testid="sources-screen" />;
} }));
vi.mock('../feed/components/FeedPage', () => ({ default: () => <div role="region" aria-label="Feed screen" /> }));
vi.mock('../components/garage/GarageTab', () => ({ default: () => <div role="region" aria-label="Garage screen" /> }));
vi.mock('./intake/IntakePage', () => ({ default: () => null }));
const fixture = vi.hoisted(() => ({ client: {} as any, pendingPanel: null as 'sources' | 'market' | null, pending: new Promise<never>(() => {}) }));
vi.mock('../lib/supabase', () => ({ supabase: fixture.client }));

import HomePage, { TreemapHomePage } from './HomePage';
import { clearFamilySalesReads } from './market/FamilySalesChart';
let root: Root, container: HTMLDivElement;

beforeEach(() => {
  fixture.pendingPanel = null;
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
    expect(document.title).toBe('Feed | Nuke');
    expect(container.querySelector('a[aria-current="page"]')?.textContent).toBe('Feed');
    await navigate('/?tab=garage');
    expect(screen()).toBe('Garage screen');
    expect(document.title).toBe('Garage | Nuke');
    await navigate('/?tab=market&make=Porsche');
    expect(screen()).toBe('Market screen');
    expect(container.querySelectorAll('[role="region"]')).toHaveLength(1);
    expect(document.title).toBe('Market | Nuke');
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
          ['b','K10 Short Bed',1972,30000,'Mecum','2026-01-02','K10','2WD',null,null,null,null,null,null] ] : [],
      } }) : previous(name,args));
  }
  it('preserves a selected drivetrain when changing grouping, with an exact count and removable chip', async () => {
    installTruckRead();
    await renderTreemap('tab=market&make=Chevrolet&family=pickup&family_name=Truck&truck_group=drive');
    const tile = container.querySelector<HTMLElement>('[role="button"][aria-label="4WD"]');
    expect(tile).not.toBeNull();
    expect(container.querySelector('[role="button"][aria-label="2WD"]')).not.toBeNull();
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
  it('keeps truck partition filters when a phone uses the direct choice picker and switches to the map', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(max-width: 640px)' || query === '(hover: none)', media: query,
      addEventListener() {}, removeEventListener() {},
    })));
    installTruckRead();
    await renderTreemap('tab=market&make=Chevrolet&family=pickup&family_name=Truck');
    const picker = container.querySelector<HTMLSelectElement>('select[aria-label="Choose a drivetrain"]')!;
    expect(picker).not.toBeNull();
    await act(async () => { picker.value = '4WD'; picker.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(new URLSearchParams(window.location.search).get('truck_drive')).toBe('4WD');
    expect(new URLSearchParams(window.location.search).has('model')).toBe(false);
    expect(container.querySelector('[aria-label="Browse wheelbase choices"]')).not.toBeNull();
    const map = [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Map')!;
    await act(async () => map.click());
    expect(container.querySelector('.home-phone-browse-list')).toBeNull();
    expect(container.querySelector('.truck-facets__selection')?.textContent).toContain('1 of 2');
    expect(container.querySelector<HTMLDetailsElement>('.home-family-history')?.open).toBe(false);
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

it('opens family sales history directly from a market-change finding', async () => {
  clearFamilySalesReads();
  const mover = { brand: 'Porsche', family_key: '911', family: '911', sold_12m: 60, sold_prior_12m: 40,
    usd_12m: 3_000_000, usd_prior_12m: 2_000_000, share_move: .3, share_lo: .1, share_hi: .5, se: .1, avg_price_move: -.1 };
  installTreemapReads({ treemap_family_sales: Promise.resolve({ error: null, data: { rows: [['00000000-0000-4000-8000-000000000001', '2026-08-01', 50000, 'Bring a Trailer', 1970, '911']], n: 1, truncated: false } }), treemap_family_share_movers: Promise.resolve({ error: null, data: {
    as_of: '2026-10-22T00:00:00Z', min_sales: 30, families: 10, eligible: 5, significant: 1,
    bat: { sold_12m: 1100, sold_prior_12m: 1000, usd_12m: 1_100_000, usd_prior_12m: 1_000_000 }, gaining: [mover], losing: [],
  } }) });
  await renderTreemap();
  const finding = container.querySelector<HTMLButtonElement>('button.map-movers2__row')!;
  expect(finding.textContent).toContain('Inspect sales');
  await act(async () => finding.click());
  expect(window.location.search).toContain('make=Porsche');
  expect(window.location.search).toContain('family=911');
  expect(window.location.search).toContain('family_view=sales');
  expect([...container.querySelectorAll('.family-view__option[aria-pressed="true"]')].some(button => button.textContent === 'Sales')).toBe(true);
  expect(container.querySelector('.family-sales')).not.toBeNull();
  expect(fixture.client.rpc).toHaveBeenCalledWith('treemap_family_sales', expect.objectContaining({ p_brand: 'Porsche', p_family_key: '911' }));
});

it('restores the sales investigation from its URL and records a switch back to names', async () => {
  installTreemapReads();
  await renderTreemap('tab=market&make=Porsche&family=911&family_view=sales');
  const active = () => [...container.querySelectorAll('.family-view__option[aria-pressed="true"]')].map(button => button.textContent);
  expect(active()).toContain('Sales');
  const names = [...container.querySelectorAll<HTMLButtonElement>('.family-view__option')].find(button => button.textContent === 'Names')!;
  await act(async () => names.click());
  expect(window.location.search).not.toContain('family_view');
  expect(active()).toContain('Names');
  await navigate('/?tab=market&make=Porsche&family=911&family_view=sales');
  expect(active()).toContain('Sales');
});

it('keeps map amounts and benchmark together until the requested period succeeds', async () => {
  vi.resetModules();
  const { TreemapHomePage: FreshHome } = await import('./HomePage');
  installTreemapReads();
  const originalRpc = fixture.client.rpc;
  let finishDay!: (result: any) => void;
  const dayRead = new Promise(resolve => { finishDay = resolve; });
  const answer = (day: boolean) => ({
    as_of: '2026-10-22T00:00:00Z', min_sales: 1, families: 10, eligible: 5, significant: 1,
    bat: { sold_12m: day ? 20 : 1100, sold_prior_12m: day ? 10 : 1000, usd_12m: 100000, usd_prior_12m: 100000 },
    brand_moves: { Porsche: { sold_12m: 8, sold_prior_12m: 2, usd_12m: 80000, usd_prior_12m: 20000 } },
    gaining: [], losing: [],
  });
  fixture.client.rpc = vi.fn((name: string, args: any) => name === 'treemap_family_share_movers'
    ? args?.p_horizon === '1d' ? dayRead : Promise.resolve({ data: answer(false), error: null })
    : originalRpc(name, args));
  await act(async () => root.render(<BrowserRouter><FreshHome embedded onBrowse={() => {}} /></BrowserRouter>));
  const windowButtons = container.querySelector('[aria-label="Relativity time horizon"]')!;
  const day = [...windowButtons.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '1D')!;
  await act(async () => day.click());
  expect(container.querySelector('.map-legend__prose')?.textContent ?? container.querySelector('.map-legend')?.textContent).toContain('1,000 → 1,100');
  expect(container.querySelector('.map-movers2__rel-window')?.textContent).toBe('LAST 1Y VS PRIOR 1Y');
  await act(async () => finishDay({ data: answer(true), error: null }));
  expect(container.querySelector('.map-legend')?.textContent).toContain('10 → 20');
  expect(container.querySelector('.map-movers2__rel-window')?.textContent).toBe('LAST 24H VS PRIOR 24H');
});

describe('independent market loading', () => {
  it.each([
    ['sources', 'Loading sources', '[aria-label="Market screen"]'],
    ['market', 'Loading live auctions', '[data-testid="sources-screen"]'],
  ] as const)('keeps the map and sibling visible while %s is loading', async (panel, label, sibling) => {
    installTreemapReads();
    fixture.pendingPanel = panel;
    await render();
    expect(container.querySelector('button.market-tile[aria-label="Porsche"]')).not.toBeNull();
    expect(container.querySelector(sibling)).not.toBeNull();
    expect(container.querySelector(`[role="status"][aria-label="${label}"]`)).not.toBeNull();
    expect(container.querySelector('[aria-label="Loading view"]')).toBeNull();
    fixture.pendingPanel = null;
    await render();
    expect(container.querySelector(`[role="status"][aria-label="${label}"]`)).toBeNull();
    expect(container.querySelector('[aria-label="Market screen"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="sources-screen"]')).not.toBeNull();
  });
});
