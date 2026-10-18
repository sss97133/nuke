// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ client: null as any, vehicleId: '' }));
vi.mock('../../lib/supabase', () => ({ get supabase() { return fixture.client; } }));
vi.mock('./VehicleProfileContext', () => ({ useVehicleProfile: () => ({ vehicleId: fixture.vehicleId,
  vehicle: { id: fixture.vehicleId, year: 1972, make: 'Synthetic', model: 'Coupe' } }) }));
import VehiclePhotoLightbox, { openVehicleDay, openVehiclePhoto, openVehiclePhotoByUrl, VEHICLE_DAY_OPEN_EVENT } from './VehiclePhotoLightbox';

const at = '2026-09-12T10:25:00Z', date = '2026-09-12', clock = 'Sep 12, 2026, 10:25 AM';
type Photo = { id: string; image_url: string; taken_at: string | null; source: string | null; source_url?: string | null };
let root: Root, host: HTMLDivElement, serial = 0, rows: Photo[], calls: URL[];
let fallbackRows: (Photo & { vehicle_id: string })[], deniedFallback: boolean;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const photo = (name: string, source: string | null = 'bat_import', taken_at: string | null = at): Photo => ({
  id: `synthetic-${serial}-${name}`, image_url: `https://images.test/${serial}-${name}.jpg`, source, taken_at,
});
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubEnv('TZ', 'UTC'); expect(new Date('2026-09-12T00:00:00Z').getHours()).toBe(0);
  fixture.vehicleId = `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`;
  window.history.replaceState({}, '', `/vehicle/${fixture.vehicleId}`);
  rows = [photo('native')]; calls = []; fallbackRows = []; deniedFallback = false;
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden'); }));
  fixture.client = createClient('https://lightbox-clock.test', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `synthetic-lightbox-${serial}` },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(init?.method ?? 'GET').toBe('GET'); expect(url.pathname).toBe('/rest/v1/vehicle_images'); calls.push(url);
      const fields = url.searchParams.get('select')!;
      if (fields === 'id,image_url,taken_at,source') {
        if (url.searchParams.has('id')) {
          expect([...url.searchParams.keys()].sort()).toEqual(url.searchParams.has('vehicle_id') ? ['id', 'select', 'vehicle_id'] : ['id', 'select']);
          if (deniedFallback) return new Response(JSON.stringify({ code: '42501', message: 'Synthetic refused read' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
          const selected = fallbackRows.filter(row => `eq.${row.id}` === url.searchParams.get('id') &&
            (!url.searchParams.has('vehicle_id') || `eq.${row.vehicle_id}` === url.searchParams.get('vehicle_id')));
          return json(selected.map(row => Object.fromEntries(fields.split(',').map(field => [field, row[field as keyof Photo]]))));
        }
        expect(Object.fromEntries(url.searchParams)).toEqual({ select: fields, vehicle_id: `eq.${fixture.vehicleId}`,
          is_duplicate: 'not.is.true', image_url: 'not.is.null', order: 'taken_at.asc.nullslast', limit: '3000' });
        // Return the existing projection only: source_url is intentionally unavailable to the viewer.
        return json(rows.map(row => Object.fromEntries(fields.split(',').map(field => [field, row[field as keyof Photo]]))));
      }
      expect(fields).toBe('ai_scan_metadata'); expect(url.searchParams.get('id')).toMatch(/^eq.synthetic-/);
      expect(Object.keys(Object.fromEntries(url.searchParams))).toEqual(['select', 'id']);
      return json([{ ai_scan_metadata: null }]);
    } },
  });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
});
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Photo viewer"]')!;
const view = () => ({ text: dialog().textContent,
  images: [...dialog().querySelectorAll('img')].map(img => img.getAttribute('src')),
  buttons: [...dialog().querySelectorAll('button')].map(button => ({ label: button.getAttribute('aria-label'), text: button.textContent })),
  original: dialog().querySelector('a')?.getAttribute('href'), photoParam: new URLSearchParams(window.location.search).get('photo') });
async function mount() { await act(async () => root.render(<VehiclePhotoLightbox />)); }
async function open(id = rows[0].id) { await mount(); await act(async () => openVehiclePhoto(id)); }
async function click(label: string) { await act(async () => dialog().querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click()); }
const expectedView = (row: Photo, clockText: string, sourceText: string, hasDay = true) => ({
  text: `1 / 1✕${clockText}SOURCE${sourceText}${hasDay ? `PART OF${date} — 1 PHOTO` : ''}VEHICLE1972 SYNTHETIC COUPEORIGINAL ↗`,
  images: [row.image_url, row.image_url], buttons: [{ label: 'Close photo viewer', text: '✕' }, ...(hasDay ? [{ label: null, text: `${date} — 1 PHOTO` }] : [])],
  original: row.image_url, photoParam: row.id,
});

it.each([
  { source: 'bat_import', label: 'BAT LISTING' },
  { source: 'BAT_IMPORT', label: 'BAT IMPORT' },
  { source: 'combat_archive', label: 'COMBAT ARCHIVE' }, // Preserve the existing canonical /bat/i vocabulary.
])('qualifies known native $source importer clock without changing the rest of the portal', async ({ source, label }) => {
  rows = [photo('native-vocabulary', source)]; const before = structuredClone(rows);
  await open(); expect(view()).toEqual(expectedView(rows[0], `IMPORT CLOCK${clock}Capture time unknown.`, label));
  expect(dialog().textContent).not.toContain('TAKEN'); expect(rows).toEqual(before); expect(calls).toHaveLength(2);
});
it('preserves the complete camera result and its existing two reads', async () => {
  rows = [photo('camera', 'user_upload')]; const before = structuredClone(rows);
  await open(); expect(view()).toEqual(expectedView(rows[0], `TAKEN${clock}`, 'OWNER UPLOAD'));
  expect(rows).toEqual(before); expect(calls).toHaveLength(2);
});
it('keeps native null-clock omission without fabricating an import or capture date', async () => {
  rows = [photo('native-null', 'bat_import', null)]; await open();
  expect(view()).toEqual(expectedView(rows[0], '', 'BAT LISTING', false)); expect(calls).toHaveLength(2);
});
it('does not expand URL-only-native attribution beyond the existing source-only index', async () => {
  rows = [{ ...photo('unavailable-native-url', 'external_import'), source_url: 'https://bringatrailer.com/wp-content/uploads/2026/09/synthetic.jpg' }];
  await open(); expect(view()).toEqual(expectedView(rows[0], `TAKEN${clock}`, 'IMPORT'));
  expect(calls).toHaveLength(2); expect(calls[0].searchParams.get('select')).not.toContain('source_url');
});
it('retains the existing unknown-source presentation without inferring a native clock', async () => {
  rows = [photo('unknown-source', null)]; await open();
  expect(dialog().textContent).toContain(`TAKEN${clock}`); expect(dialog().textContent).not.toMatch(/IMPORT CLOCK|Capture time unknown|SOURCE/);
  expect(calls).toHaveLength(2);
});
it('keeps id/URL opens, index and atoms caches useful across close and remount', async () => {
  rows = [photo('cached-camera', 'owner_upload')]; await open(); const first = view(); expect(calls).toHaveLength(2);
  await click('Close photo viewer'); expect(new URLSearchParams(window.location.search).has('photo')).toBe(false);
  await act(async () => root.render(null)); await mount(); await act(async () => openVehiclePhotoByUrl(rows[0].image_url));
  expect(view()).toEqual(first); expect(calls).toHaveLength(2);
});
it('preserves photo order/counter, arrows/keyboard, per-frame cache and native-null omission', async () => {
  rows = [photo('native'), photo('camera', 'owner_upload'), photo('no-clock', 'bat_import', null)];
  await open(); expect(dialog().textContent).toContain('1 / 3'); expect(calls).toHaveLength(2);
  await click('Next photo'); expect(dialog().textContent).toContain(`2 / 3✕TAKEN${clock}`); expect(calls).toHaveLength(3);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  expect(dialog().textContent).toContain('3 / 3'); expect(dialog().textContent).not.toMatch(/TAKEN|IMPORT CLOCK|Capture time unknown/); expect(calls).toHaveLength(4);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
  expect(dialog().textContent).toContain(`TAKEN${clock}`); expect(calls).toHaveLength(4);
  await click('Previous photo'); expect(dialog().textContent).toContain(`IMPORT CLOCK${clock}Capture time unknown.`); expect(calls).toHaveLength(4);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(dialog()).toBeNull(); expect(window.location.search).toBe('');
});
it('keeps the existing raw-day navigation and count for native and camera rows', async () => {
  rows = [photo('native'), photo('camera', 'owner_upload')]; const received: string[] = [];
  const listener = (event: Event) => received.push((event as CustomEvent).detail.date);
  window.addEventListener(VEHICLE_DAY_OPEN_EVENT, listener);
  try {
    await open(); const button = [...dialog().querySelectorAll('button')].find(b => b.textContent === `${date} — 2 PHOTOS`)!;
    await act(async () => button.click()); expect(received).toEqual([date]); expect(dialog()).toBeNull(); expect(calls).toHaveLength(2);
    await act(async () => openVehicleDay('2026-09-13')); expect(received).toEqual([date, '2026-09-13']);
  } finally { window.removeEventListener(VEHICLE_DAY_OPEN_EVENT, listener); }
});


const fallbackQuery = () => calls.find(url => url.searchParams.get('select') === 'id,image_url,taken_at,source' && url.searchParams.has('id'))!;
const atomsFor = (id: string) => calls.filter(url => url.searchParams.get('select') === 'ai_scan_metadata' && url.searchParams.get('id') === `eq.${id}`);
const foreignVehicle = '00000000-0000-4000-8000-999999999999';
it('subject-binding retains an own missing-index fallback with the same entire result and three requests', async () => {
  const own = { ...photo('own-fallback', 'user_upload'), vehicle_id: fixture.vehicleId }; rows = []; fallbackRows = [own];
  const before = structuredClone(fallbackRows); await open(own.id);
  expect(view()).toEqual(expectedView(own, `TAKEN${clock}`, 'OWNER UPLOAD')); expect(calls).toHaveLength(3);
  expect(fallbackQuery().searchParams.get('id')).toBe(`eq.${own.id}`); expect(atomsFor(own.id)).toHaveLength(1);
  expect(fallbackRows).toEqual(before);
});
it('subject-binding refuses an independently readable foreign fallback before portal, atoms or current index admission', async () => {
  const foreign = { ...photo('foreign-fallback', 'user_upload'), vehicle_id: foreignVehicle }; rows = []; fallbackRows = [foreign];
  await open(foreign.id);
  expect(dialog()).toBeNull(); expect(atomsFor(foreign.id)).toHaveLength(0); expect(calls).toHaveLength(2);
  expect(fallbackQuery().searchParams.get('vehicle_id')).toBe(`eq.${fixture.vehicleId}`);
  expect(fallbackQuery().searchParams.get('id')).toBe(`eq.${foreign.id}`);
});
it('subject-binding keeps preexisting refused foreign fallback absent with two requests and no atoms', async () => {
  const foreign = { ...photo('refused-foreign', 'user_upload'), vehicle_id: foreignVehicle }; rows = []; fallbackRows = [foreign]; deniedFallback = true;
  await open(foreign.id); expect(dialog()).toBeNull(); expect(calls).toHaveLength(2); expect(atomsFor(foreign.id)).toHaveLength(0);
});
it('subject-binding preserves a successful missing fallback without fabricating a viewer or atoms', async () => {
  rows = []; await open(`synthetic-${serial}-missing`); expect(dialog()).toBeNull(); expect(calls).toHaveLength(2);
  expect(calls.some(url => url.searchParams.get('select') === 'ai_scan_metadata')).toBe(false);
});
it('subject-binding prevents foreign cache contamination from changing the later own-photo counter and day count', async () => {
  const own = photo('own-index', 'user_upload'), foreign = { ...photo('foreign-cache', 'user_upload'), vehicle_id: foreignVehicle };
  rows = [own]; fallbackRows = [foreign];
  await open(foreign.id); await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await open(own.id); expect(view()).toEqual(expectedView(own, `TAKEN${clock}`, 'OWNER UPLOAD'));
  expect(atomsFor(foreign.id)).toHaveLength(0); expect(calls).toHaveLength(3);
  await click('Close photo viewer'); await act(async () => root.render(null)); await mount();
  await act(async () => openVehiclePhotoByUrl(own.image_url)); expect(view()).toEqual(expectedView(own, `TAKEN${clock}`, 'OWNER UPLOAD')); expect(calls).toHaveLength(3);
});
