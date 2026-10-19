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
let reply: ((url: URL) => Response | Promise<Response> | undefined) | null;
let frames: { text: string | null; photoParam: string | null }[];
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const photo = (name: string, source: string | null = 'bat_import', taken_at: string | null = at): Photo => ({
  id: `synthetic-${serial}-${name}`, image_url: `https://images.test/${serial}-${name}.jpg`, source, taken_at,
});
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubEnv('TZ', 'UTC'); expect(new Date('2026-09-12T00:00:00Z').getHours()).toBe(0);
  fixture.vehicleId = `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`;
  window.history.replaceState({}, '', `/vehicle/${fixture.vehicleId}`);
  rows = [photo('native')]; calls = []; fallbackRows = []; deniedFallback = false; reply = null; frames = [];
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden'); }));
  fixture.client = createClient('https://lightbox-clock.test', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `synthetic-lightbox-${serial}` },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(init?.method ?? 'GET').toBe('GET'); expect(url.pathname).toBe('/rest/v1/vehicle_images'); calls.push(url);
      const special = reply?.(url); if (special) return (await special).clone();
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
async function mount() { await act(async () => root.render(<React.Profiler id="lightbox" onRender={() => { frames.push({ text: document.querySelector('[role="dialog"]')?.textContent ?? null,
  photoParam: new URLSearchParams(window.location.search).get('photo') }); }}><VehiclePhotoLightbox /></React.Profiler>)); }
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
  expectReadStatus('No photo available in this read.'); expect(atomsFor(foreign.id)).toHaveLength(0); expect(calls).toHaveLength(2);
  expect(fallbackQuery().searchParams.get('vehicle_id')).toBe(`eq.${fixture.vehicleId}`);
  expect(fallbackQuery().searchParams.get('id')).toBe(`eq.${foreign.id}`);
});
it('subject-binding keeps preexisting refused foreign fallback absent with two requests and no atoms', async () => {
  const foreign = { ...photo('refused-foreign', 'user_upload'), vehicle_id: foreignVehicle }; rows = []; fallbackRows = [foreign]; deniedFallback = true;
  await open(foreign.id); expectReadStatus('Photo could not be read.'); expect(calls).toHaveLength(2); expect(atomsFor(foreign.id)).toHaveLength(0);
});
it('subject-binding preserves a successful missing fallback without fabricating a viewer or atoms', async () => {
  rows = []; await open(`synthetic-${serial}-missing`); expectReadStatus('No photo available in this read.'); expect(calls).toHaveLength(2);
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


const indexRead = (url: URL) => url.searchParams.get('select') === 'id,image_url,taken_at,source' && !url.searchParams.has('id');
const fallbackRead = (url: URL) => url.searchParams.get('select') === 'id,image_url,taken_at,source' && url.searchParams.has('id');
const privateMessage = 'synthetic-private-read-message';
const unavailable = () => new Response(JSON.stringify({ code: '42501', message: privateMessage }), { status: 403, headers: { 'Content-Type': 'application/json' } });
function deferred() { let resolve!: (value: Response) => void; return { promise: new Promise<Response>(done => { resolve = done; }), resolve }; }
function expectReadStatus(text: string) {
  expect(dialog()?.querySelector('[role="status"]')?.textContent).toBe(text);
  expect(dialog().querySelectorAll('img')).toHaveLength(0); expect(dialog().querySelector('a')).toBeNull();
  expect(dialog().textContent).not.toMatch(/TAKEN|IMPORT CLOCK|SOURCE|PART OF|VEHICLE|not found|does not exist|denied/i);
  expect(dialog().textContent).not.toContain(privateMessage); expect(dialog().querySelector('[aria-label="Close photo viewer"]')).not.toBeNull();
}
async function escape() { await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); }
const pendingText = 'Reading photo…', errorText = 'Photo could not be read.', emptyText = 'No photo available in this read.';
it.each(['index', 'fallback', 'empty', 'malformed-index', 'malformed-fallback'])('read-status makes settled %s explicit without fabricating evidence and close clears the param', async kind => {
  const target = photo('read-status-target', 'user_upload'); rows = [];
  reply = url => kind === 'index' && indexRead(url) ? unavailable() : kind === 'fallback' && fallbackRead(url) ? unavailable()
    : kind === 'malformed-index' && indexRead(url) ? json(null) : kind === 'malformed-fallback' && fallbackRead(url) ? json({ unsupported: true }) : undefined;
  await open(target.id); expectReadStatus(kind === 'empty' ? emptyText : errorText);
  expect(calls).toHaveLength(kind.includes('index') ? 1 : 2); expect(atomsFor(target.id)).toHaveLength(0);
  expect(new URLSearchParams(window.location.search).get('photo')).toBe(target.id);
  await click('Close photo viewer'); expect(dialog()).toBeNull(); expect(window.location.search).toBe('');
});
it.each(['index', 'fallback'])('read-status keeps deferred %s pending until the existing read settles successfully', async phase => {
  const target = photo('deferred', 'user_upload'), pending = deferred(); rows = [];
  reply = url => (phase === 'index' ? indexRead(url) : fallbackRead(url)) ? pending.promise : undefined;
  await open(target.id); expectReadStatus(pendingText); expect(calls).toHaveLength(phase === 'index' ? 1 : 2);
  await act(async () => pending.resolve(json([target])));
  expect(view()).toEqual(expectedView(target, `TAKEN${clock}`, 'OWNER UPLOAD')); expect(calls).toHaveLength(phase === 'index' ? 2 : 3);
});
it.each(['index', 'fallback'])('read-status ignores a late old-target %s refusal after a new known photo is selected', async phase => {
  const old = photo('old-target', 'user_upload'), next = photo('new-target', 'user_upload'), pending = deferred(); rows = [];
  fallbackRows = [{ ...next, vehicle_id: fixture.vehicleId }]; let indexAttempts = 0;
  reply = url => phase === 'index' && indexRead(url) ? (++indexAttempts === 1 ? pending.promise : json([next]))
    : phase === 'fallback' && fallbackRead(url) && url.searchParams.get('id') === `eq.${old.id}` ? pending.promise : undefined;
  await open(old.id); await open(next.id); const known = view(); expect(known).toEqual(expectedView(next, `TAKEN${clock}`, 'OWNER UPLOAD'));
  const count = calls.length; await act(async () => pending.resolve(unavailable())); expect(view()).toEqual(known); expect(calls).toHaveLength(count);
});
it.each(['index', 'fallback'])('read-status ignores late %s refusal after close', async phase => {
  const pending = deferred(); rows = []; reply = url => (phase === 'index' ? indexRead(url) : fallbackRead(url)) ? pending.promise : undefined;
  await open(`synthetic-${serial}-closed-pending`); await escape(); expect(window.location.search).toBe(''); const count = calls.length;
  await act(async () => pending.resolve(unavailable())); expect(dialog()).toBeNull(); expect(calls).toHaveLength(count);
});
it.each(['index-error', 'fallback-error', 'empty'])('read-status preserves existing explicit reopen recovery for %s without caching a failure or adding retry', async kind => {
  const target = photo('recovered', 'user_upload'); rows = kind === 'index-error' ? [target] : [];
  reply = url => kind === 'index-error' && indexRead(url) || kind === 'fallback-error' && fallbackRead(url) ? unavailable() : undefined;
  await open(target.id); expect(calls).toHaveLength(kind === 'index-error' ? 1 : 2); await escape();
  reply = null; fallbackRows = [{ ...target, vehicle_id: fixture.vehicleId }]; await open(target.id);
  expect(view()).toEqual(expectedView(target, `TAKEN${clock}`, 'OWNER UPLOAD')); expect(calls).toHaveLength(kind === 'index-error' ? 3 : 4);
});
it('read-status withholds old-target terminal error from the first committed new pending frame', async () => {
  rows = []; reply = url => indexRead(url) ? unavailable() : undefined; await open(photo('old-error').id);
  const target = photo('new-pending', 'user_upload'), pending = deferred(); reply = url => indexRead(url) ? pending.promise : undefined;
  const start = frames.length; await open(target.id);
  expect(frames.slice(start).find(frame => frame.photoParam === target.id)?.text ?? '').toContain(pendingText); expectReadStatus(pendingText);
  await act(async () => pending.resolve(json([target]))); expect(view()).toEqual(expectedView(target, `TAKEN${clock}`, 'OWNER UPLOAD'));
});
it('read-status binds an explicit same-id reopen to its fresh pending request in the first commit', async () => {
  const target = photo('same-id', 'user_upload'), pending = deferred(); rows = [target]; reply = url => indexRead(url) ? unavailable() : undefined;
  await open(target.id); await escape(); reply = url => indexRead(url) ? pending.promise : undefined; const start = frames.length; await open(target.id);
  expect(frames.slice(start).find(frame => frame.photoParam === target.id)?.text ?? '').toContain(pendingText); expectReadStatus(pendingText);
  await act(async () => pending.resolve(json([target]))); expect(view()).toEqual(expectedView(target, `TAKEN${clock}`, 'OWNER UPLOAD')); expect(calls).toHaveLength(3);
});
it('read-status does not carry a former vehicle error into the current vehicle pending frame', async () => {
  rows = []; reply = url => indexRead(url) ? unavailable() : undefined; await open(photo('vehicle-switch').id);
  fixture.vehicleId = `00000000-0000-4000-8001-${String(serial).padStart(12, '0')}`;
  const pending = deferred(); reply = url => indexRead(url) ? pending.promise : undefined; const start = frames.length; await mount();
  expect(frames[start]?.text ?? '').toContain(pendingText); expectReadStatus(pendingText);
  await act(async () => pending.resolve(unavailable())); expectReadStatus(errorText); expect(calls).toHaveLength(2);
});
it.each(['pending', 'unavailable'])('read-status preserves the exact raw-URL minimal viewer while its index is %s', async phase => {
  const url = `https://images.test/${serial}-raw-url.jpg`, pending = deferred(); rows = [];
  reply = request => indexRead(request) ? phase === 'pending' ? pending.promise : unavailable() : undefined;
  await mount(); await act(async () => openVehiclePhotoByUrl(url));
  const expected = { text: '✕VEHICLE1972 SYNTHETIC COUPEORIGINAL ↗', images: [url, url], buttons: [{ label: 'Close photo viewer', text: '✕' }], original: url, photoParam: null };
  expect(view()).toEqual(expected); expect(calls).toHaveLength(1);
  if (phase === 'pending') { await act(async () => pending.resolve(json([]))); expect(view()).toEqual(expected); expect(calls).toHaveLength(1); }
});
it('read-status retains a fresh URL-open resolved to a known photo with exact two-request demand', async () => {
  rows = [photo('known-url', 'user_upload')]; await mount(); await act(async () => openVehiclePhotoByUrl(rows[0].image_url));
  expect(view()).toEqual(expectedView(rows[0], `TAKEN${clock}`, 'OWNER UPLOAD')); expect(calls).toHaveLength(2);
});
