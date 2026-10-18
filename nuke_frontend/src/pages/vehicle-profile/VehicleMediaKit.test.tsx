// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ client: null as any, vehicleId: 'synthetic-a', lead: '', mobile: false,
  opens: [] as string[], urlOpens: [] as string[] }));
vi.mock('../../lib/supabase', () => ({ get supabase() { return fixture.client; } }));
vi.mock('./VehicleProfileContext', () => ({ useVehicleProfile: () => ({ vehicleId: fixture.vehicleId,
  leadImageUrl: fixture.lead, heroMeta: null, vehicle: { year: 1970, make: 'Synthetic', model: 'Specimen', transmission: 'Manual' } }) }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => fixture.mobile }));
vi.mock('../../components/image/MobileImageGallery', () => ({ __esModule: true, default: () => <div data-mobile-gallery /> }));
vi.mock('./VehiclePhotoLightbox', () => ({ openVehiclePhoto: (id: string) => fixture.opens.push(id),
  openVehiclePhotoByUrl: (url: string) => fixture.urlOpens.push(url) }));
vi.mock('../../components/badges/useBadgeDepth', () => ({ useBadgeDepth: () => ({ data: null, loading: false, load: () => {} }) }));
vi.mock('../../components/badges/BadgeClusterPanel', () => ({ BadgeClusterPanel: () => null }));
vi.mock('../../components/popups/PopupStack', async () => { const { createContext } = await import('react'); return { PopupStackContext: createContext(null) }; });
vi.mock('../../components/popups/MakePopup', () => ({ MakePopup: () => null }));
vi.mock('../../components/popups/ModelPopup', () => ({ ModelPopup: () => null }));
vi.mock('../../components/popups/SourcePopup', () => ({ SourcePopup: () => null }));
import VehicleHeroImage from './VehicleHeroImage';

const projection = 'id,image_url,large_url,taken_at,created_at,scene_type:ai_scan_metadata->byok_deep_analysis->>scene_type,build_phase_guess:ai_scan_metadata->byok_deep_analysis->>build_phase_guess';
type Row = { id: string; image_url: string; large_url: string | null; taken_at: string | null; created_at: string;
  scene_type: string | null; build_phase_guess: string | null };
type RequestReceipt = { vehicle: string; url: URL; resolve: (response: Response) => void };
let host: HTMLDivElement, root: Root, requests: RequestReceipt[], frames: ReturnType<typeof view>[], reduced: boolean;
const image = (vehicle: string, name: string, scene_type: string | null): Row => ({ id: `${vehicle}-${name}`,
  image_url: `https://images.test/${vehicle}-${name}.jpg`, large_url: null, scene_type, build_phase_guess: 'retained phase',
  taken_at: '2026-09-12T13:00:00Z', created_at: '2026-09-13T10:00:00Z' });
const deck = (vehicle: string) => [image(vehicle, 'recent', 'other'), image(vehicle, 'interior', 'body_interior'),
  image(vehicle, 'under', 'undercarriage'), image(vehicle, 'engine', 'engine_bay'), image(vehicle, 'exterior', 'body_exterior')];
const lead = (vehicle: string) => `https://images.test/${vehicle}-screened-lead.jpg`;
const region = () => host.querySelector<HTMLElement>('[role="region"][aria-label="Vehicle media kit slideshow"]');
function view() { return { vehicle: fixture.vehicleId, text: host.textContent,
  images: [...host.querySelectorAll('img')].map(img => img.getAttribute('src')), region: !!region() }; }
const expectedStatic = (vehicle: string) => ({ vehicle, text: 'FILL', images: [lead(vehicle)], region: false });
async function render(vehicle = fixture.vehicleId, leadUrl = lead(vehicle)) {
  fixture.vehicleId = vehicle; fixture.lead = leadUrl;
  await act(async () => root.render(<React.Profiler id="media-subject" onRender={() => frames.push(view())}><VehicleHeroImage /></React.Profiler>));
}
async function settle(index: number, rows: Row[] | null = deck(requests[index].vehicle), status = 200) {
  await act(async () => requests[index].resolve(new Response(JSON.stringify(status === 200 ? rows : { message: 'Private synthetic refusal text' }),
    { status, headers: { 'Content-Type': 'application/json' } })));
}
async function click(label: string) {
  await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.vehicleId = 'synthetic-a'; fixture.lead = lead(fixture.vehicleId); fixture.mobile = false; fixture.opens = []; fixture.urlOpens = [];
  requests = []; frames = []; reduced = true;
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden'); }));
  vi.stubGlobal('matchMedia', () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }));
  fixture.client = createClient('https://media-subject.test', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'synthetic-media-subject' },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(init?.method ?? 'GET').toBe('GET'); expect(url.pathname).toBe('/rest/v1/vehicle_images');
      const vehicle = url.searchParams.get('vehicle_id')!.slice(3);
      expect(Object.fromEntries(url.searchParams)).toEqual({ select: projection, vehicle_id: `eq.${vehicle}`,
        'ai_scan_metadata->byok_deep_analysis': 'not.is.null', order: 'taken_at.desc.nullslast', limit: '200' });
      return new Promise<Response>(resolve => requests.push({ vehicle, url, resolve }));
    } },
  });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.useRealTimers(); vi.unstubAllGlobals();
});

it('keeps the screened static lead usable during the first current-vehicle read', async () => {
  await render(); expect(frames[0]).toEqual(expectedStatic('synthetic-a')); expect(view()).toEqual(frames[0]);
  await act(async () => host.querySelector<HTMLElement>('.hero-media-slot > div')!.click());
  expect(fixture.urlOpens).toEqual([lead('synthetic-a')]); expect(fixture.opens).toEqual([]); expect(requests).toHaveLength(1);
});
it('preserves scene picks, recorded date, source render/srcset, navigation and exact callback IDs', async () => {
  const rows = deck('synthetic-a'), raw = structuredClone(rows);
  rows[4].large_url = 'https://storage.test/storage/v1/object/public/photos/exterior.jpg';
  raw[4].large_url = rows[4].large_url;
  await render(); await settle(0, rows); expect(requests).toHaveLength(1);
  expect(region()!.textContent).toBe('EXTERIOR · 2026-09-12<>');
  const exterior = region()!.querySelector<HTMLImageElement>('img[alt="EXTERIOR"]')!;
  expect(exterior.getAttribute('src')).toBe('https://storage.test/storage/v1/render/image/public/photos/exterior.jpg?width=840&quality=85&resize=contain');
  expect(exterior.getAttribute('srcset')).toContain('width=420&quality=85&resize=contain 420w');
  await act(async () => region()!.click()); expect(fixture.opens).toEqual(['synthetic-a-exterior']);
  for (const [n, name, label] of [[2, 'engine', 'ENGINE BAY'], [3, 'under', 'UNDERBODY'], [4, 'interior', 'INTERIOR'], [5, 'recent', 'CURRENT STATE']] as const) {
    await click(`Show image ${n} of 5`); expect(region()!.querySelector(`img[alt="${label}"]`)!.getAttribute('src')).toBe(`https://images.test/synthetic-a-${name}.jpg`);
  }
  await click('Next image'); expect(region()!.textContent).toContain('EXTERIOR');
  await click('Previous image'); expect(region()!.textContent).toContain('CURRENT STATE');
  expect(rows).toEqual(raw); expect(fixture.urlOpens).toEqual([]); expect(requests).toHaveLength(1);
});
it.each(['empty', 'two-scenes'])('preserves static fallback for a successful $name result', async kind => {
  await render(); await settle(0, kind === 'empty' ? [] : deck('synthetic-a').slice(3));
  expect(view()).toEqual(expectedStatic('synthetic-a')); expect(requests).toHaveLength(1);
});
it.each(['error', 'null'])('preserves the existing $name read fallback without exposing error text', async kind => {
  await render(); await settle(0, null, kind === 'error' ? 403 : 200);
  expect(view()).toEqual(expectedStatic('synthetic-a')); expect(requests).toHaveLength(1);
});
it('withholds the ended A deck and activation on the very first B pending commit and uses B click context', async () => {
  await render(); await settle(0); expect(region()).not.toBeNull(); frames = [];
  await render('synthetic-b'); expect(frames[0]).toEqual(expectedStatic('synthetic-b')); expect(view()).toEqual(frames[0]);
  await act(async () => host.querySelector<HTMLElement>('.hero-media-slot > div')!.click());
  expect(fixture.urlOpens).toEqual([lead('synthetic-b')]); expect(fixture.opens).toEqual([]); expect(requests.map(r => r.vehicle)).toEqual(['synthetic-a', 'synthetic-b']);
});
it('upgrades B only after its own curation resolves and uses only B frame callbacks', async () => {
  await render(); await settle(0); await render('synthetic-b'); await settle(1);
  expect(view().images).toEqual(['https://images.test/synthetic-b-exterior.jpg']); expect(view().text).not.toContain('FILL');
  await act(async () => region()!.click()); expect(fixture.opens).toEqual(['synthetic-b-exterior']); expect(requests).toHaveLength(2);
});
it('keeps B screened lead after its own refused curation without reviving the A deck', async () => {
  await render(); await settle(0); await render('synthetic-b'); await settle(1, null, 403);
  expect(view()).toEqual(expectedStatic('synthetic-b')); expect(requests).toHaveLength(2);
});
it('does not revive completed A1 curation during the existing fresh A2 read after A to B to A', async () => {
  await render(); await settle(0); await render('synthetic-b'); await settle(1); frames = [];
  await render('synthetic-a'); expect(frames[0]).toEqual(expectedStatic('synthetic-a')); expect(view()).toEqual(frames[0]);
  expect(requests.map(r => r.vehicle)).toEqual(['synthetic-a', 'synthetic-b', 'synthetic-a']);
  await settle(2); expect(region()).not.toBeNull(); expect(requests).toHaveLength(3);
});
it('preserves cancellation of an old A read after a current B result', async () => {
  await render(); await render('synthetic-b'); await settle(1); const before = view();
  await settle(0); expect(view()).toEqual(before); expect(requests).toHaveLength(2);
  await act(async () => region()!.click()); expect(fixture.opens).toEqual(['synthetic-b-exterior']);
});
it('preserves a pending same-vehicle read across ordinary rerenders with one read', async () => {
  await render(); await render(); await render(); expect(requests).toHaveLength(1);
  await settle(0); const loaded = view(); await render(); expect(view()).toEqual(loaded); expect(requests).toHaveLength(1);
});
it('retains useful pending curation when only the same vehicle screened lead changes', async () => {
  await render(); await render(fixture.vehicleId, 'https://images.test/revised-screened-lead.jpg'); expect(view().images).toEqual([fixture.lead]);
  await settle(0); expect(region()).not.toBeNull(); expect(requests).toHaveLength(1);
});
it('preserves within-vehicle failed-frame eligibility, scene gate and static fallback without another read', async () => {
  await render(); await settle(0, deck('synthetic-a').slice(2));
  await act(async () => region()!.querySelector('img[alt="EXTERIOR"]')!.dispatchEvent(new Event('error')));
  expect(view()).toEqual(expectedStatic('synthetic-a')); expect(requests).toHaveLength(1);
});
it('starts a new subject deck at its own first frame rather than inheriting the A navigation index', async () => {
  await render(); await settle(0); await click('Show image 4 of 5'); expect(region()!.textContent).toContain('INTERIOR');
  await render('synthetic-b'); await settle(1); expect(region()!.textContent).toContain('EXTERIOR'); expect(requests).toHaveLength(2);
});
it('preserves the existing five-second auto advance, pause and cleanup within the current subject', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); reduced = false; await render(); await settle(0);
  await render('synthetic-b'); await settle(1);
  await act(async () => vi.advanceTimersByTime(5000)); expect(region()!.textContent).toContain('ENGINE BAY');
  await act(async () => region()!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  await act(async () => vi.advanceTimersByTime(10000)); expect(region()!.textContent).toContain('ENGINE BAY');
  await act(async () => root.render(null)); expect(vi.getTimerCount()).toBe(0); expect(requests).toHaveLength(2);
});
it('preserves mobile gallery activation instead of desktop image callbacks', async () => {
  fixture.mobile = true; await render(); await settle(0); await act(async () => region()!.click());
  expect(host.querySelector('[data-mobile-gallery]')).not.toBeNull(); expect(fixture.opens).toEqual([]); expect(fixture.urlOpens).toEqual([]);
  expect(requests).toHaveLength(1);
});
