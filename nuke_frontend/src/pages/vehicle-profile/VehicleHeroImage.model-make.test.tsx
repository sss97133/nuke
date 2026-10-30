// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ current: null as any, client: null as any, depth: [] as { dimension: string; value: unknown }[], load: vi.fn() }));
vi.mock('./VehicleProfileContext', () => ({ useVehicleProfile: () => fixture.current }));
vi.mock('../../lib/supabase', () => ({ get supabase() { return fixture.client; } }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }));
vi.mock('../../components/image/MobileImageGallery', () => ({ __esModule: true, default: () => null }));
vi.mock('./VehiclePhotoLightbox', () => ({ openVehiclePhoto: () => { throw Error('Unexpected photo open'); }, openVehiclePhotoByUrl: () => { throw Error('Unexpected URL open'); } }));
vi.mock('../../components/badges/useBadgeDepth', () => ({ useBadgeDepth: (dimension: string, value: unknown) => {
  fixture.depth.push({ dimension, value }); return { data: null, loading: false, load: fixture.load };
} }));
vi.mock('../../components/badges/BadgeClusterPanel', () => ({ BadgeClusterPanel: () => null }));
vi.mock('../../components/popups/PopupStack', async () => { const { createContext } = await import('react'); return { PopupStackContext: createContext(null) }; });
vi.mock('../../components/popups/SourcePopup', () => ({ SourcePopup: () => null }));
vi.mock('../../components/popups/VehiclePopup', () => ({ VehiclePopup: () => null }));
import VehicleHeroImage from './VehicleHeroImage';
import { BadgePortal } from '../../components/badges/BadgePortal';
import { ModelPopup } from '../../components/popups/ModelPopup';
import { MakePopup } from '../../components/popups/MakePopup';
import { PopupStackContext } from '../../components/popups/PopupStack';

type Read = { url: URL; method: string; body: any; resolve: (response: Response) => void };
let root: Root, host: HTMLDivElement, popupRoot: Root | null, popup: HTMLDivElement | null, reads: Read[], serial = 0;
const push = vi.fn(() => 'synthetic-popup');
const context = { stack: [], push, pop: vi.fn(), popTop: vi.fn(), closeAll: vi.fn(), toggleMinimize: vi.fn(), toggleExpanded: vi.fn() };
const empty = { total: 0, for_sale: 0, recent_sales: [], live_now: [], price_scatter: [], year_range: null, sources: [] };
const rowsByMake: Record<string, typeof empty> = Object.freeze({ '': empty, Ford: { ...empty, total: 2 }, Chevrolet: { ...empty, total: 3 }, ' fOrD ': { ...empty, total: 1 } });
function vehicle(make: string | null | undefined) {
  fixture.current = { vehicleId: 'synthetic-hero-model', leadImageUrl: null, heroMeta: null,
    vehicle: Object.freeze({ id: 'synthetic-hero-model', year: 2000, make, model: 'Coupe' }) };
}
async function draw(content: React.ReactNode = <VehicleHeroImage />) {
  await act(async () => root.render(<PopupStackContext.Provider value={context}>{content}</PopupStackContext.Provider>));
}
function view() { return { text: host.textContent, badges: [...host.querySelectorAll<HTMLElement>('[role="button"]')].map(node => ({ text: node.textContent, title: node.title, tabindex: node.getAttribute('tabindex') })) }; }
async function click(label = 'COUPE') {
  const badge = [...host.querySelectorAll('[role="button"]')].find(node => node.textContent === label)!;
  expect(badge).toBeDefined(); await act(async () => badge.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}
async function openModel(expectedMake: string, expectedTotal: number) {
  const before = view(), raw = structuredClone(fixture.current), rows = structuredClone(rowsByMake);
  await click(); expect(view()).toEqual(before); expect(push).toHaveBeenCalledTimes(1); expect(reads).toHaveLength(0);
  const [content, title, width] = push.mock.calls[0] as unknown as [React.ReactElement<any>, string, number];
  expect(content.type).toBe(ModelPopup); expect([title, width]).toEqual(['Coupe', 360]);
  popup = document.createElement('div'); document.body.appendChild(popup); popupRoot = createRoot(popup);
  await act(async () => popupRoot!.render(<PopupStackContext.Provider value={context}>{content}</PopupStackContext.Provider>));
  expect(popup.textContent).toBe('LOADING...'); expect(reads).toHaveLength(1);
  expect(reads[0].method).toBe('POST'); expect(reads[0].url.pathname).toBe('/rest/v1/rpc/popup_model_intel'); expect([...reads[0].url.searchParams]).toEqual([]);
  const result = rowsByMake[reads[0].body.p_make] ?? empty;
  await act(async () => reads[0].resolve(new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  expect(fixture.current).toEqual(raw); expect(rowsByMake).toEqual(rows); expect(reads).toHaveLength(1); expect(fixture.load).not.toHaveBeenCalled();
  expect({ props: content.props, requested: reads[0].body, after: popup.textContent }).toEqual({
    props: { make: expectedMake, model: 'Coupe' }, requested: { p_make: expectedMake, p_model: 'Coupe' }, after: `TOTAL${expectedTotal}TAB`,
  });
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; reads = []; popupRoot = null; popup = null; push.mockClear(); fixture.depth = []; fixture.load.mockClear();
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Real network forbidden'); }));
  fixture.client = createClient('https://hero-model-binding.test', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `synthetic-hero-model-${++serial}` },
    global: { fetch: async (input, init) => new Promise<Response>(resolve => reads.push({
      url: new URL(input instanceof Request ? input.url : String(input)), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null, resolve,
    })) },
  });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  if (popupRoot) await act(async () => popupRoot!.unmount()); popup?.remove(); await act(async () => root.unmount()); host.remove();
  expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});

it.each([{ make: 'Ford', total: 2 }, { make: 'Chevrolet', total: 3 }, { make: ' fOrD ', total: 1 }])('forwards current stored make $make without normalization through the actual Hero model popup read', async ({ make, total }) => {
  vehicle(make); await draw(); expect(view()).toEqual({ text: `2000 ${make} Coupe2000${make.toUpperCase()}COUPENO PHOTO · EXPLORE BY BADGE`,
    badges: ['2000', make.toUpperCase(), 'COUPE'].map(text => ({ text, title: text, tabindex: '0' })) });
  expect(fixture.depth).toEqual([{ dimension: 'year', value: 2000 }, { dimension: 'make', value: make }, { dimension: 'model', value: 'Coupe' }]);
  await openModel(make, total);
});
it('uses revised current make when vehicle/model, depth callback and popup context stay identical', async () => {
  vehicle('Ford'); await draw(); vehicle('Chevrolet'); await draw();
  expect(host.textContent).toBe('2000 Chevrolet Coupe2000CHEVROLETCOUPENO PHOTO · EXPLORE BY BADGE'); await openModel('Chevrolet', 3);
});
it.each([{ name: 'null', make: null }, { name: 'omitted', make: undefined }, { name: 'blank', make: '' }])('preserves the legacy empty-make read for Hero $name make', async ({ make }) => {
  vehicle(make); await draw(); expect(host.textContent).toBe('2000 Coupe2000COUPENO PHOTO · EXPLORE BY BADGE'); await openModel('', 0);
});
it('preserves a generic legacy model badge without newly supplied make context', async () => {
  vehicle('Ford'); await draw(<BadgePortal dimension="model" value="Coupe" label="COUPE" />); await openModel('', 0);
});
it('preserves the existing make badge captured popup and zero automatic requests', async () => {
  vehicle('Ford'); await draw(); const before = view(); await click('FORD'); expect(view()).toEqual(before); expect(push).toHaveBeenCalledTimes(1);
  const [content, title, width] = push.mock.calls[0] as unknown as [React.ReactElement<any>, string, number];
  expect(content.type).toBe(MakePopup); expect(content.props).toEqual({ make: 'Ford' }); expect([title, width]).toEqual(['Ford', 360]); expect(reads).toHaveLength(0); expect(fixture.load).not.toHaveBeenCalled();
});
it('preserves same-current Hero rerenders without opening a popup or making a query', async () => {
  vehicle('Ford'); await draw(); const before = view(); await draw(); expect(view()).toEqual(before); expect(push).not.toHaveBeenCalled(); expect(reads).toHaveLength(0); expect(fixture.load).not.toHaveBeenCalled();
});
