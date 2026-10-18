// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ client: null as any, current: null as any }));
vi.mock('../../lib/supabase', () => ({ get supabase() { return fixture.client; } }));
vi.mock('../../pages/vehicle-profile/VehicleProfileContext', () => ({ useVehicleProfile: () => fixture.current }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }));
vi.mock('../image/MobileImageGallery', () => ({ __esModule: true, default: () => null }));
vi.mock('../../pages/vehicle-profile/VehicleMediaKit', () => ({ __esModule: true, default: () => null }));
vi.mock('../../pages/vehicle-profile/VehiclePhotoLightbox', () => ({ openVehiclePhoto: () => { throw Error('Unexpected photo open'); }, openVehiclePhotoByUrl: () => { throw Error('Unexpected URL open'); } }));
vi.mock('../popups/PopupStack', async () => { const { createContext } = await import('react'); return { PopupStackContext: createContext(null) }; });
vi.mock('../popups/MakePopup', () => ({ MakePopup: () => null }));
vi.mock('../popups/ModelPopup', () => ({ ModelPopup: () => null }));
vi.mock('../popups/SourcePopup', () => ({ SourcePopup: () => null }));
import VehicleHeroImage from '../../pages/vehicle-profile/VehicleHeroImage';
import { BadgePortal } from './BadgePortal';

type Purpose = 'count' | 'preview' | 'aggregate' | 'facet' | 'fill';
type Read = { purpose: Purpose; resolve: (response: Response) => void; reject: (reason: Error) => void };
let root: Root, host: HTMLDivElement, reads: Read[], serial = 0, year: number, source: string;
const privateMessage = 'Synthetic private badge read refused';
const panel = () => host.querySelector<HTMLElement>('div[style*="z-index: 500"]');
function Location() { const loc = useLocation(); return <output data-location>{loc.pathname + loc.search}</output>; }
async function draw(sourceMode = false) {
  await act(async () => root.render(<MemoryRouter><>{sourceMode ? <BadgePortal dimension="source" value={source} label="SYNTHETIC SOURCE" /> : <VehicleHeroImage />}<Location /></></MemoryRouter>));
}
async function remount(sourceMode = false) { await act(async () => root.render(null)); await draw(sourceMode); }
function badge(sourceMode = false) { return [...host.querySelectorAll<HTMLElement>('[role="button"]')].find(node => node.firstChild?.textContent === (sourceMode ? 'SYNTHETIC SOURCE' : String(year)))!; }
async function click(sourceMode = false) { await act(async () => badge(sourceMode).dispatchEvent(new MouseEvent('click', { bubbles: true }))); }
function graph(start = 0, sourceMode = false) { expect(reads.slice(start).map(read => read.purpose).sort()).toEqual(sourceMode ? ['aggregate', 'count', 'facet', 'fill', 'preview'] : ['aggregate', 'count', 'facet', 'preview']); }
function payload(purpose: Purpose, empty = false, sourceMode = false) {
  if (empty) return [];
  if (purpose === 'preview') return [{ id: 'synthetic-preview', year, make: 'Ford', model: 'Coupe', primary_image_url: 'https://images.test/badge.jpg', sale_price: 10000 }];
  if (purpose === 'aggregate') return [{ sale_price: 10000, year: sourceMode ? 1970 : year }, { sale_price: 20000, year: sourceMode ? 1980 : year }];
  if (purpose === 'facet') return [{ make: 'Ford' }, { make: 'Ford' }, { make: 'Chevrolet' }];
  return [{ sale_price: 10000, mileage: 0, vin: 'SYNTHETICVIN', primary_image_url: 'https://images.test/badge.jpg', canonical_body_style: 'Coupe' },
    { sale_price: 20000, mileage: 12000, vin: '', primary_image_url: null, canonical_body_style: null },
    { sale_price: null, mileage: 0, vin: null, primary_image_url: null, canonical_body_style: 'Coupe' }];
}
async function settle({ failed, rejected = false, empty = false, start = 0, sourceMode = false }: { failed?: Purpose; rejected?: boolean; empty?: boolean; start?: number; sourceMode?: boolean } = {}) {
  const current = reads.slice(start); graph(start, sourceMode);
  await act(async () => {
    for (const read of current) {
      if (read.purpose === failed && rejected) { read.reject(new Error(privateMessage)); continue; }
      const error = read.purpose === failed, status = error ? 403 : 200;
      if (read.purpose === 'count') read.resolve(new Response(null, { status, statusText: error ? 'Forbidden' : 'OK', headers: { 'Content-Range': empty ? '*/0' : '0-0/3' } }));
      else read.resolve(new Response(JSON.stringify(error ? { code: '42501', message: privateMessage } : payload(read.purpose, empty, sourceMode)),
        { status, headers: { 'Content-Type': 'application/json', 'Content-Range': empty ? '*/0' : '0-2/3' } }));
    }
  });
}
function unavailable(sourceMode = false) {
  expect(panel()).not.toBeNull(); expect(panel()!.firstElementChild!.textContent).toBe(`${sourceMode ? 'SYNTHETIC SOURCE' : year}UNAVAILABLE`); expect(panel()!.textContent).toContain('Badge details unavailable.');
  expect(panel()!.textContent).not.toMatch(/\d[\d,.]* VEHICLES|NO PREVIEW AVAILABLE|YEARS|TOP MAKES|FILL RATE|Ford|Chevrolet|VIEW ALL/);
  expect(panel()!.querySelectorAll('a,img')).toHaveLength(0); expect(host.textContent).not.toContain(privateMessage);
}
const full = () => `${year}3 VEHICLESYEARS${year}Ford2Chevrolet1${year} Ford Coupe$10,000VIEW ALL 3 →`;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; reads = []; year = 1990 + ++serial; source = `synthetic-badge-source-${serial}`;
  fixture.current = { vehicleId: 'synthetic-badge-hero', leadImageUrl: null, heroMeta: null, vehicle: Object.freeze({ id: 'synthetic-badge-hero', year, make: 'Synthetic', model: 'Specimen' }) };
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Real network forbidden'); }));
  fixture.client = createClient('https://badge-depth.test', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `synthetic-badge-depth-${serial}` },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input)), q = url.searchParams, select = q.get('select'), sourceMode = q.has('platform_source');
      expect(url.pathname).toBe('/rest/v1/vehicles'); expect(init?.method ?? 'GET').toBe(select === 'id' ? 'HEAD' : 'GET');
      const base = [['select', select], ['is_public', 'eq.true'], [sourceMode ? 'platform_source' : 'year', `eq.${sourceMode ? source : year}`]];
      let purpose: Purpose;
      if (select === 'id') { purpose = 'count'; expect(new Headers(init?.headers).get('prefer')).toBe('count=exact'); expect([...q]).toEqual(base); }
      else if (select === 'id,year,make,model,primary_image_url,sale_price') { purpose = 'preview'; expect([...q]).toEqual([...base, ['primary_image_url', 'not.is.null'], ['order', 'feed_rank_score.desc.nullslast'], ['limit', '6']]); }
      else if (select === 'sale_price,year') { purpose = 'aggregate'; expect([...q]).toEqual([...base, ['sale_price', 'not.is.null'], ['sale_price', 'gt.0'], ['limit', '500']]); }
      else if (select === 'make') { purpose = 'facet'; expect([...q]).toEqual([...base, ['make', 'not.is.null'], ['limit', '500']]); }
      else { expect(select).toBe('sale_price,mileage,vin,primary_image_url,canonical_body_style'); purpose = 'fill'; expect(sourceMode).toBe(true); expect(new Headers(init?.headers).get('prefer')).toBe('count=exact'); expect([...q]).toEqual([...base, ['limit', '500']]); }
      return new Promise<Response>((resolve, reject) => reads.push({ purpose, resolve, reject }));
    } },
  });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); expect(globalThis.fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each(['count', 'preview', 'aggregate', 'facet'] as const)('refuses a complete-looking Hero year panel after %s API error', async failed => {
  await draw(); expect(reads).toHaveLength(0); await click(); await settle({ failed }); unavailable(); expect(reads).toHaveLength(4);
});
it('refuses a complete-looking panel after installed SDK normalizes a rejected fetch', async () => {
  await draw(); await click(); await settle({ failed: 'preview', rejected: true }); unavailable(); expect(reads).toHaveLength(4);
});
it('refuses failed fill rates on the legitimate standalone source fallback without popup context', async () => {
  await draw(true); await click(true); await settle({ failed: 'fill', sourceMode: true }); unavailable(true); expect(reads).toHaveLength(5);
});
it('preserves the complete successful Hero year panel, preview and filter links', async () => {
  await draw(); await click(); await settle(); expect(panel()!.textContent).toBe(full());
  expect([...panel()!.querySelectorAll('a')].map(a => [a.textContent, a.getAttribute('href')])).toEqual([[`${year} Ford Coupe$10,000`, '/vehicle/synthetic-preview'], ['VIEW ALL 3 →', `/?year_min=${year}&year_max=${year}`]]);
  expect(panel()!.querySelector('img')!.getAttribute('src')).toBe('https://images.test/badge.jpg'); expect(reads).toHaveLength(4);
});
it('preserves successful zero as zero vehicles and the existing empty-preview caption', async () => {
  await draw(); await click(); await settle({ empty: true }); expect(panel()!.textContent).toBe(`${year}0 VEHICLESNO PREVIEW AVAILABLE`); expect(reads).toHaveLength(4);
});
it('preserves the current pending no-panel behavior and one read graph across a rerender', async () => {
  await draw(); const before = host.textContent; await click(); expect(panel()).toBeNull(); await draw(); expect(host.textContent).toBe(before); graph();
  await settle(); expect(panel()!.textContent).toBe(full()); expect(reads).toHaveLength(4);
});
it('preserves successful same-mount reopen and new-mount cache reuse', async () => {
  await draw(); await click(); await settle(); await click(); expect(panel()).toBeNull(); await click(); expect(panel()!.textContent).toBe(full());
  await remount(); await click(); expect(panel()!.textContent).toBe(full()); expect(reads).toHaveLength(4);
});
it('preserves valid empty cache reuse on a new mount', async () => {
  await draw(); await click(); await settle({ empty: true }); await remount(); await click();
  expect(panel()!.textContent).toBe(`${year}0 VEHICLESNO PREVIEW AVAILABLE`); expect(reads).toHaveLength(4);
});
it('does not automatically retry a failed same-mount read when reopened', async () => {
  await draw(); await click(); await settle({ failed: 'count' }); await click(); await click(); expect(reads).toHaveLength(4); unavailable();
});
it('does not poison a new mount with the prior explicit API-failed combined result', async () => {
  await draw(); await click(); await settle({ failed: 'count' }); await remount(); await click(); expect(reads).toHaveLength(8);
  await settle({ start: 4 }); expect(panel()!.textContent).toBe(full());
});
it('preserves successful standalone source fill-rate/facet output and five-read demand', async () => {
  await draw(true); await click(true); await settle({ sourceMode: true });
  expect(panel()!.textContent).toBe(`SYNTHETIC SOURCE3 VEHICLESFILL RATEPRICE67%BODY67%MILEAGE33%VIN33%PHOTO33%TOP MAKESFord2Chevrolet1${year} Ford Coupe$10,000VIEW ALL 3 →`); expect(reads).toHaveLength(5);
});
it('preserves view-all navigation and closing without another read', async () => {
  await draw(); await click(); await settle(); const anchor = [...panel()!.querySelectorAll('a')].find(a => a.textContent === 'VIEW ALL 3 →')!;
  await act(async () => anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))); expect(panel()).toBeNull();
  expect(host.querySelector('output')!.textContent).toBe(`/?year_min=${year}&year_max=${year}`); expect(reads).toHaveLength(4);
});
it('preserves lazy 200ms hover demand and leave-before-debounce refusal', async () => {
  vi.useFakeTimers(); await draw(); await act(async () => badge().dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  await act(async () => vi.advanceTimersByTime(199)); expect(reads).toHaveLength(0);
  await act(async () => badge().dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })));
  await act(async () => vi.advanceTimersByTime(1)); expect(reads).toHaveLength(0);
  await act(async () => badge().dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  await act(async () => vi.advanceTimersByTime(200)); graph(); expect(panel()).toBeNull();
});
