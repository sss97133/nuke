// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ client: null as any, vehicleId: 'synthetic-a' as string | undefined, lead: '' }));
vi.mock('../../lib/supabase', () => ({ get supabase() { return fixture.client; } }));
vi.mock('../../pages/vehicle-profile/VehicleProfileContext', () => ({ useVehicleProfile: () => ({ vehicleId: fixture.vehicleId,
  leadImageUrl: fixture.lead, heroMeta: null, vehicle: { year: 1970, make: 'Synthetic', model: 'Specimen', transmission: 'Manual' } }) }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }));
vi.mock('../../pages/vehicle-profile/VehicleMediaKit', () => ({ __esModule: true, default: () => null }));
vi.mock('../../pages/vehicle-profile/VehiclePhotoLightbox', () => ({ openVehiclePhoto: vi.fn(), openVehiclePhotoByUrl: vi.fn() }));
vi.mock('../badges/useBadgeDepth', () => ({ useBadgeDepth: () => ({ data: null, loading: false, load: () => {} }) }));
vi.mock('../badges/BadgeClusterPanel', () => ({ BadgeClusterPanel: () => null }));
vi.mock('../popups/PopupStack', async () => { const { createContext } = await import('react'); return { PopupStackContext: createContext(null) }; });
vi.mock('../popups/MakePopup', () => ({ MakePopup: () => null }));
vi.mock('../popups/ModelPopup', () => ({ ModelPopup: () => null }));
vi.mock('../popups/SourcePopup', () => ({ SourcePopup: () => null }));
import VehicleHeroImage from '../../pages/vehicle-profile/VehicleHeroImage';

type Photo = { id: string; image_url: string; large_url?: string; caption: string; angle_tag: string; created_at: string };
type Read = { vehicle: string; url: URL; resolve: (response: Response) => void };
const lead = (vehicle: string) => `https://photos.test/${vehicle}-lead.jpg`;
const photos = (vehicle: string): Photo[] => [
  { id: `${vehicle}-side`, image_url: `https://photos.test/${vehicle}-side.jpg`, caption: `${vehicle} side`, angle_tag: 'SIDE', created_at: '2026-09-11T12:00:00Z' },
  { id: `${vehicle}-lead`, image_url: lead(vehicle), caption: `${vehicle} lead`, angle_tag: 'FRONT', created_at: '2026-09-12T12:00:00Z' },
];
let root: Root, host: HTMLDivElement, reads: Read[], frames: ReturnType<typeof galleryView>[];
const gallery = () => host.querySelector<HTMLElement>('div[style*="position: fixed"]');
function galleryView() { const current = gallery(); return current ? { text: current.textContent,
  images: [...current.querySelectorAll('img')].map(img => ({ src: img.getAttribute('src'), alt: img.getAttribute('alt') })),
  buttons: [...current.querySelectorAll('button')].map(button => button.textContent) } : null; }
const pending = (url = fixture.lead, status = 'Reading gallery…') => ({ text: `${status}×`, images: [{ src: url, alt: 'Vehicle image' }], buttons: ['×'] });
const loaded = (vehicle: string, index = 1) => { const photo = photos(vehicle)[index]; return {
  text: `${index + 1} / 2×‹›${photo.angle_tag}${photo.caption}RECORD DATE ${new Date(photo.created_at).toLocaleDateString()} · CAPTURE DATE UNKNOWNSwipe down to close • Swipe left/right to navigate`,
  images: [{ src: photo.image_url, alt: photo.caption }], buttons: ['×', '‹', '›'],
}; };
async function render(vehicle: string | null = fixture.vehicleId ?? null, path = `/vehicles/${vehicle ?? 'synthetic-b'}`) {
  fixture.vehicleId = vehicle ?? undefined; fixture.lead = lead(vehicle ?? 'current-without-id'); window.history.replaceState({}, '', path);
  await act(async () => root.render(<React.Profiler id="mobile-subject" onRender={() => frames.push(galleryView())}><VehicleHeroImage /></React.Profiler>));
}
async function open() { await act(async () => host.querySelector<HTMLElement>('.hero-media-slot > div')!.click()); }
async function click(text: string) { await act(async () => [...gallery()!.querySelectorAll('button')].find(button => button.textContent === text)!.click()); }
async function settle(index: number, rows: unknown = photos(reads[index].vehicle), status = 200) {
  await act(async () => reads[index].resolve(new Response(JSON.stringify(status === 200 ? rows : { message: 'Private synthetic failure text' }),
    { status, headers: { 'Content-Type': 'application/json' } })));
}
async function swipe(from: [number, number], to: [number, number]) {
  for (const [type, coordinates] of [['touchstart', from], ['touchmove', to], ['touchend', to]] as const) {
    await act(async () => { const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, 'targetTouches', { value: [{ clientX: coordinates[0], clientY: coordinates[1] }] }); gallery()!.dispatchEvent(event); });
  }
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; fixture.vehicleId = 'synthetic-a'; fixture.lead = lead('synthetic-a'); reads = []; frames = [];
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden'); }));
  fixture.client = createClient('https://mobile-subject.test', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'synthetic-mobile-subject' },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(init?.method ?? 'GET').toBe('GET'); expect(url.pathname).toBe('/rest/v1/vehicle_images');
      const vehicle = url.searchParams.get('vehicle_id')!.slice(3);
      expect(Object.fromEntries(url.searchParams)).toEqual({ select: 'id,image_url,large_url,caption,angle_tag,created_at',
        vehicle_id: `eq.${vehicle}`, order: 'is_primary.desc,taken_at.desc.nullslast,created_at.desc' });
      return new Promise<Response>(resolve => reads.push({ vehicle, url, resolve }));
    } },
  });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

it.each([
  { name: 'canonical', path: '/vehicle/synthetic-a' },
  { name: 'canonical subroute', path: '/vehicle/synthetic-a/day/2026-09-12' },
  { name: 'legacy current positive', path: '/vehicles/synthetic-a' },
  { name: 'stale legacy other subject', path: '/vehicles/synthetic-b' },
  { name: 'embedded context', path: '/' },
])('uses current Hero subject on $name', async ({ path }) => {
  await render('synthetic-a', path); await open(); expect(galleryView()).toEqual(pending());
  expect(reads).toHaveLength(1); expect(reads[0].vehicle).toBe('synthetic-a');
  const rows = photos('synthetic-a'), raw = structuredClone(rows); await settle(0, rows);
  expect(galleryView()).toEqual(loaded('synthetic-a')); expect(rows).toEqual(raw); expect(reads).toHaveLength(1);
});
it('binds the first committed switched gallery to B pending then B own result', async () => {
  await render(); await open(); await settle(0); expect(galleryView()).toEqual(loaded('synthetic-a')); frames = [];
  await render('synthetic-b'); expect(frames[0]).toEqual(pending(lead('synthetic-b'))); expect(galleryView()).toEqual(frames[0]);
  expect(reads.map(read => read.vehicle)).toEqual(['synthetic-a', 'synthetic-b']); await settle(1); expect(galleryView()).toEqual(loaded('synthetic-b'));
});
it('ignores a late old subject read after the current B gallery resolves', async () => {
  await render(); await open(); await render('synthetic-b'); expect(reads).toHaveLength(2);
  await settle(1); const before = galleryView(); await settle(0); expect(galleryView()).toEqual(before); expect(before).toEqual(loaded('synthetic-b'));
});
it('retains the same-current pending read across rerenders without another query', async () => {
  await render(); await open(); await render(); await render(); expect(reads).toHaveLength(1);
  await settle(0); const before = galleryView(); await render(); expect(galleryView()).toEqual(before); expect(reads).toHaveLength(1);
});
it('ends a closed pending lifetime and uses only the explicit reopened read', async () => {
  await render(); await open(); await click('×'); expect(gallery()).toBeNull(); await open(); expect(reads).toHaveLength(2);
  await settle(0); expect(galleryView()).toEqual(pending()); await settle(1); expect(galleryView()).toEqual(loaded('synthetic-a')); expect(reads).toHaveLength(2);
});
it('does not take over a legacy pathname when current context has no vehicle ID', async () => {
  await render(null, '/vehicles/synthetic-b'); expect(fixture.vehicleId).toBeUndefined(); await open(); expect(reads).toHaveLength(0); expect(galleryView()).toEqual(pending(fixture.lead, 'Gallery could not be read.'));
});
it('preserves arrows, wrapping, horizontal swipes and swipe-down close', async () => {
  await render(); await open(); await settle(0); await click('›'); expect(galleryView()).toEqual(loaded('synthetic-a', 0));
  await click('‹'); expect(galleryView()).toEqual(loaded('synthetic-a'));
  await swipe([200, 100], [100, 100]); expect(galleryView()).toEqual(loaded('synthetic-a', 0));
  await swipe([100, 100], [200, 100]); expect(galleryView()).toEqual(loaded('synthetic-a'));
  await swipe([100, 100], [100, 200]); expect(gallery()).toBeNull(); expect(reads).toHaveLength(1);
});
it('preserves explicit button close and the existing fresh demand on loaded reopen', async () => {
  await render(); await open(); await settle(0); await click('×'); expect(gallery()).toBeNull();
  await open(); expect(galleryView()).toEqual(pending()); await settle(1); expect(galleryView()).toEqual(loaded('synthetic-a')); expect(reads).toHaveLength(2);
});
it.each(['error', 'empty'])('preserves current $name semantics and screened lead fallback', async kind => {
  await render(); await open(); await settle(0, [], kind === 'error' ? 403 : 200);
  expect(galleryView()).toEqual(pending(fixture.lead, kind === 'error' ? 'Gallery could not be read.' : 'No additional photos in this read.')); expect(reads).toHaveLength(1);
});
it('preserves large-url lead matching while displaying the retained image_url', async () => {
  await render(); fixture.lead = 'https://photos.test/large-screened.jpg';
  await act(async () => root.render(<React.Profiler id="mobile-subject" onRender={() => frames.push(galleryView())}><VehicleHeroImage /></React.Profiler>));
  await open(); const rows = photos('synthetic-a'); rows[0].large_url = fixture.lead; await settle(0, rows);
  expect(galleryView()).toEqual(loaded('synthetic-a', 0)); expect(reads).toHaveLength(1);
});
it('keeps A2 pending during an unresolved B visit and ignores B before A2 own result', async () => {
  await render(); await open(); await settle(0); await render('synthetic-b'); frames = [];
  await render('synthetic-a'); expect(frames[0]).toEqual(pending()); expect(galleryView()).toEqual(frames[0]); expect(reads).toHaveLength(3);
  await settle(1); expect(galleryView()).toEqual(pending()); await settle(2); expect(galleryView()).toEqual(loaded('synthetic-a'));
});
it('withholds ended completed rows after current vehicle ID is cleared without pathname fallback', async () => {
  await render(); await open(); await settle(0); frames = [];
  await render(null, '/vehicles/synthetic-b'); expect(fixture.vehicleId).toBeUndefined(); expect(frames[0]).toEqual(pending(fixture.lead, 'Gallery could not be read.')); expect(galleryView()).toEqual(frames[0]); expect(reads).toHaveLength(1);
});

it('read-status: labels the first committed pending read and keeps the known lead closeable', async () => {
  await render(); frames = []; await open(); expect(frames[0]).toEqual(pending()); expect(galleryView()).toEqual(pending());
  expect(reads).toHaveLength(1); await click('×'); expect(gallery()).toBeNull();
});
it.each([
  { name: 'API refusal', rows: [], code: 403, status: 'Gallery could not be read.' },
  { name: 'successful empty array', rows: [], code: 200, status: 'No additional photos in this read.' },
  { name: 'successful null', rows: null, code: 200, status: 'Gallery could not be read.' },
  { name: 'successful object', rows: { retained: 'unexpected shape' }, code: 200, status: 'Gallery could not be read.' },
  { name: 'successful string', rows: 'unexpected shape', code: 200, status: 'Gallery could not be read.' },
])('read-status: distinguishes $name without claiming the screened lead is absent', async ({ rows, code, status }) => {
  await render(); await open(); const raw = structuredClone(rows); await settle(0, rows, code);
  expect(galleryView()).toEqual(pending(fixture.lead, status)); expect(reads).toHaveLength(1); expect(rows).toEqual(raw);
  expect(gallery()!.textContent).not.toContain('Private synthetic failure'); await click('×'); expect(gallery()).toBeNull();
});
it('read-status: preserves the entire known two-row result and count', async () => {
  await render(); await open(); await settle(0); expect(galleryView()).toEqual(loaded('synthetic-a')); expect(reads).toHaveLength(1);
});
it('read-status: preserves the entire known one-row result and count', async () => {
  await render(); await open(); const row = photos('synthetic-a')[1]; await settle(0, [row]);
  expect(galleryView()).toEqual({ ...loaded('synthetic-a'), text: `1 / 1×${row.angle_tag}${row.caption}RECORD DATE ${new Date(row.created_at).toLocaleDateString()} · CAPTURE DATE UNKNOWNSwipe down to close • Swipe left/right to navigate`, buttons: ['×'] });
  expect(reads).toHaveLength(1);
});
it('read-status: missing current ID is unavailable on its first commit with no pathname query', async () => {
  await render(null, '/vehicles/synthetic-b'); frames = []; await open();
  expect(frames[0]).toEqual(pending(fixture.lead, 'Gallery could not be read.')); expect(reads).toHaveLength(0);
});
it('read-status: late old failure cannot turn current B pending into unavailable', async () => {
  await render(); await open(); await render('synthetic-b'); expect(reads).toHaveLength(2);
  await settle(0, [], 403); expect(galleryView()).toEqual(pending());
  await settle(1, []); expect(galleryView()).toEqual(pending(fixture.lead, 'No additional photos in this read.')); expect(reads).toHaveLength(2);
});
it('read-status: explicit reopen clears a terminal error for the existing fresh read', async () => {
  await render(); await open(); await settle(0, [], 403); await click('×'); await open();
  expect(galleryView()).toEqual(pending()); expect(reads).toHaveLength(2); await settle(1); expect(galleryView()).toEqual(loaded('synthetic-a'));
});
it('read-status: current B error retains its own lead without reviving known A rows or footer', async () => {
  await render(); await open(); await settle(0); await render('synthetic-b'); expect(reads).toHaveLength(2); await settle(1, [], 403);
  expect(galleryView()).toEqual(pending(fixture.lead, 'Gallery could not be read.')); expect(reads).toHaveLength(2);
});

it.each([
  { name: 'zero start X', from: [0, 100], to: [100, 100], index: 0 },
  { name: 'zero end X', from: [100, 100], to: [0, 100], index: 0 },
  { name: 'zero start Y', from: [200, 0], to: [100, 20], index: 0 },
  { name: 'zero end Y', from: [200, 20], to: [100, 0], index: 0 },
  { name: 'ordinary horizontal positive', from: [200, 100], to: [100, 100], index: 0 },
  { name: 'below threshold positive', from: [100, 100], to: [60, 100], index: 1 },
  { name: 'exactly fifty pixels positive', from: [0, 100], to: [50, 100], index: 1 },
  { name: 'equal-axis upward tie stays vertical', from: [100, 100], to: [20, 20], index: 1 },
])('zero-swipe: $name preserves the existing movement rule', async ({ from, to, index }) => {
  await render(); await open(); await settle(0); const before = galleryView(); expect(before).toEqual(loaded('synthetic-a'));
  expect([...from, ...to].every(Number.isFinite)).toBe(true); await swipe(from as [number, number], to as [number, number]);
  expect(galleryView()).toEqual(loaded('synthetic-a', index)); expect(reads).toHaveLength(1);
});
it('zero-swipe: closes downward from a zero origin without changing the known read', async () => {
  await render(); await open(); await settle(0); expect(galleryView()).toEqual(loaded('synthetic-a'));
  await swipe([0, 0], [0, 100]); expect(gallery()).toBeNull(); expect(host.textContent).toBe('FIT'); expect(reads).toHaveLength(1);
});
async function touch(type: string, coordinates: [number, number]) {
  await act(async () => { const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, 'targetTouches', { value: [{ clientX: coordinates[0], clientY: coordinates[1] }] }); gallery()!.dispatchEvent(event); });
}
it('zero-swipe: refuses an unfinished gesture with no move endpoint', async () => {
  await render(); await open(); await settle(0); const before = galleryView();
  await touch('touchstart', [0, 0]); await touch('touchend', [100, 100]);
  expect(galleryView()).toEqual(before); expect(before).toEqual(loaded('synthetic-a')); expect(reads).toHaveLength(1);
});
it('zero-swipe: refuses a move and end without a start coordinate', async () => {
  await render(); await open(); await settle(0); const before = galleryView();
  await touch('touchmove', [0, 0]); await touch('touchend', [100, 100]);
  expect(galleryView()).toEqual(before); expect(reads).toHaveLength(1);
});
it('zero-swipe: preserves touch-start reset instead of reusing a prior endpoint', async () => {
  await render(); await open(); await settle(0); await swipe([200, 100], [100, 100]); expect(galleryView()).toEqual(loaded('synthetic-a', 0));
  await touch('touchstart', [0, 0]); await touch('touchend', [100, 100]);
  expect(galleryView()).toEqual(loaded('synthetic-a', 0)); expect(reads).toHaveLength(1);
});

it.each([
  { name: 'timestamp', created: '2026-10-18T12:34:56Z' },
  { name: 'offset timestamp', created: '2026-09-13T00:15:00+02:00' },
  { name: 'day-grain record', created: '2026-09-12' },
])('gallery-record-clock: qualifies the retained $name without changing its formatted date', async ({ created }) => {
  await render(); await open(); expect(galleryView()).toEqual(pending()); const row = { ...photos('synthetic-a')[1], created_at: created };
  const raw = structuredClone(row); await settle(0, [row]);
  expect(galleryView()).toEqual({ text: `1 / 1×${row.angle_tag}${row.caption}RECORD DATE ${new Date(created).toLocaleDateString()} · CAPTURE DATE UNKNOWNSwipe down to close • Swipe left/right to navigate`,
    images: [{ src: row.image_url, alt: row.caption }], buttons: ['×'] });
  expect(row).toEqual(raw); expect(reads).toHaveLength(1); expect(reads[0].url.searchParams.get('select')!.split(',')).not.toContain('taken_at');
  await click('×'); expect(gallery()).toBeNull();
});
it('gallery-record-clock: preserves the entire pending read without a fabricated footer date', async () => {
  await render(); await open(); expect(galleryView()).toEqual(pending()); expect(reads).toHaveLength(1);
});
it.each(['error', 'empty'])('gallery-record-clock: preserves the entire $name read without a fabricated footer date', async kind => {
  await render(); await open(); await settle(0, [], kind === 'error' ? 403 : 200);
  expect(galleryView()).toEqual(pending(fixture.lead, kind === 'error' ? 'Gallery could not be read.' : 'No additional photos in this read.'));
  expect(reads).toHaveLength(1); await click('×'); expect(gallery()).toBeNull();
});

function navigationView() { return { counter: gallery()!.firstElementChild!.firstElementChild!.textContent,
  images: galleryView()!.images, buttons: galleryView()!.buttons }; }
async function prepareNavigation(matching: boolean) {
  await render();
  if (!matching) {
    fixture.lead = 'https://photos.test/screened-lead-outside-current-result.jpg';
    await act(async () => root.render(<React.Profiler id="mobile-subject" onRender={() => frames.push(galleryView())}><VehicleHeroImage /></React.Profiler>));
  }
  await open(); expect(reads).toHaveLength(1);
}
const navigationResult = (rows: Photo[], index: number) => ({ counter: `${index + 1} / ${rows.length}`,
  images: [{ src: rows[index].image_url, alt: rows[index].caption }], buttons: rows.length > 1 ? ['×', '‹', '›'] : ['×'] });
it.each([
  { name: 'previous pending with unmatched lead', action: 'previous', times: 1, matching: false, count: 2, index: 0 },
  { name: 'repeated previous pending with unmatched lead', action: 'previous', times: 2, matching: false, count: 2, index: 0 },
  { name: 'previous pending with one unmatched row', action: 'previous', times: 1, matching: false, count: 1, index: 0 },
  { name: 'previous pending retains matching lead selection', action: 'previous', times: 1, matching: true, count: 2, index: 1 },
  { name: 'next pending preserves the first unmatched row', action: 'next', times: 1, matching: false, count: 2, index: 0 },
  { name: 'no pending action preserves the first unmatched row', action: 'none', times: 0, matching: false, count: 2, index: 0 },
])('pending-navigation: $name', async ({ action, times, matching, count, index }) => {
  await prepareNavigation(matching); const before = navigationView();
  expect(before).toEqual({ counter: 'Reading gallery…', images: [{ src: fixture.lead, alt: 'Vehicle image' }], buttons: ['×'] });
  for (let i = 0; i < times; i++) await swipe(action === 'previous' ? [100, 100] : [200, 100], action === 'previous' ? [200, 100] : [100, 100]);
  expect(navigationView()).toEqual(before); const rows = photos('synthetic-a').slice(0, count), raw = structuredClone(rows); await settle(0, rows);
  expect(navigationView()).toEqual(navigationResult(rows, index)); expect(rows).toEqual(raw); expect(reads).toHaveLength(1);
});
it('pending-navigation: loaded previous wraps normally from the first retained row', async () => {
  await prepareNavigation(false); const rows = photos('synthetic-a'); await settle(0, rows);
  expect(navigationView()).toEqual(navigationResult(rows, 0)); await click('‹'); expect(navigationView()).toEqual(navigationResult(rows, 1));
  await click('›'); expect(navigationView()).toEqual(navigationResult(rows, 0)); expect(reads).toHaveLength(1);
});
it('pending-navigation: a missing move endpoint leaves a useful pending selection intact', async () => {
  await prepareNavigation(false); const before = navigationView(); await touch('touchstart', [100, 100]); await touch('touchend', [200, 100]);
  expect(navigationView()).toEqual(before); const rows = photos('synthetic-a'); await settle(0, rows);
  expect(navigationView()).toEqual(navigationResult(rows, 0)); expect(reads).toHaveLength(1);
});
