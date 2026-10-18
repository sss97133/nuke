// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ vehicle: null as any, depth: [] as { dimension: string; value: unknown }[], depthLoads: 0,
  media: [] as string[], photoOpens: [] as unknown[], leadImageUrl: null as string | null,
  vehicleImages: [{ id: 'synthetic-unscreened', image_url: 'https://images.test/unscreened-gallery.jpg' }] }));
vi.mock('./VehicleProfileContext', () => ({ useVehicleProfile: () => ({ vehicle: fixture.vehicle, vehicleId: 'synthetic-spec-card', leadImageUrl: fixture.leadImageUrl, heroMeta: null, vehicleImages: fixture.vehicleImages }) }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../../components/image/MobileImageGallery', () => ({ __esModule: true, default: () => { fixture.media.push('mobile'); return null; } }));
vi.mock('./VehicleMediaKit', () => ({ __esModule: true, default: () => { fixture.media.push('media-kit'); return null; } }));
vi.mock('./VehiclePhotoLightbox', () => ({ openVehiclePhoto: (id: unknown) => fixture.photoOpens.push(id), openVehiclePhotoByUrl: (url: unknown) => fixture.photoOpens.push(url) }));
vi.mock('../../components/badges/useBadgeDepth', () => ({ useBadgeDepth: (dimension: string, value: unknown) => {
  fixture.depth.push({ dimension, value }); return { data: null, loading: false, load: () => { fixture.depthLoads++; } };
} }));
vi.mock('../../components/badges/BadgeClusterPanel', () => ({ BadgeClusterPanel: () => null }));
vi.mock('../../components/popups/PopupStack', async () => { const { createContext } = await import('react'); return { PopupStackContext: createContext(null) }; });
vi.mock('../../components/popups/MakePopup', () => ({ MakePopup: () => null }));
vi.mock('../../components/popups/ModelPopup', () => ({ ModelPopup: () => null }));
vi.mock('../../components/popups/SourcePopup', () => ({ SourcePopup: () => null }));
import VehicleHeroImage from './VehicleHeroImage';

let root: Root | null, host: HTMLDivElement | null;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = null; host = null; fixture.leadImageUrl = null;
  fixture.vehicle = Object.freeze({ year: 1976, make: 'Synthetic', model: 'Specimen', body_style: 'Coupe', transmission: 'Manual' });
  fixture.depth = []; fixture.depthLoads = 0; fixture.media = []; fixture.photoOpens = [];
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden'); }));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

it.each([
  { name: 'reported uncertainty', value: 'Unknown', label: 'UNKNOWN' },
  { name: 'unclassified four speed', value: '4-Speed', label: '4-SPEED' },
  { name: 'literal manual', value: 'Manual', label: 'MANUAL' },
  { name: 'literal auto', value: 'AUTO', label: 'AUTO' },
  { name: 'complete automatic wording', value: '3-Speed Automatic', label: '3-SPEED AUTOMATIC' },
  { name: 'complete manual wording', value: '5-Speed Manual', label: '5-SPEED MANUAL' },
  { name: 'null absent', value: null, label: null },
  { name: 'undefined absent', value: undefined, label: null },
  { name: 'empty absent', value: '', label: null },
])('shows $name without classifying the reported transmission and preserves its raw badge contract', ({ value, label }) => {
  fixture.vehicle = Object.freeze({ year: 1976, make: 'Synthetic', model: 'Specimen', body_style: 'Coupe', transmission: value });
  const raw = { ...fixture.vehicle }, host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(<VehicleHeroImage />);
  const buttons = [...host.querySelectorAll<HTMLElement>('[role="button"]')];
  const expectedDepth = [{ dimension: 'year', value: 1976 }, { dimension: 'make', value: 'Synthetic' },
    { dimension: 'model', value: 'Specimen' }, { dimension: 'body_style', value: 'Coupe' }, ...(label ? [{ dimension: 'transmission', value }] : [])];
  // Prerequisites identify the actual BadgePortal by ordered depth/role pairing, not an invented selector.
  expect(fixture.depth).toEqual(expectedDepth); expect(buttons).toHaveLength(expectedDepth.length);
  expect(buttons.every(button => button.getAttribute('tabindex') === '0')).toBe(true);
  const transmission = buttons[4];
  if (label) {
    expect(transmission.getAttribute('style')).toContain('color:var(--text-secondary)');
    expect(transmission.getAttribute('style')).toContain('background:transparent');
  }
  expect({ text: host.textContent, badges: buttons.map(button => ({ text: button.textContent, title: button.title })) }).toEqual({
    text: `1976 Synthetic Specimen1976SYNTHETICSPECIMENCOUPE${label ?? ''}NO PHOTO · EXPLORE BY BADGE`,
    badges: ['1976', 'SYNTHETIC', 'SPECIMEN', 'COUPE', ...(label ? [label] : [])].map(text => ({ text, title: text })),
  });
  expect(fixture.vehicle).toEqual(raw); expect(fixture.depthLoads).toBe(0); expect(fixture.media).toEqual([]); expect(fixture.photoOpens).toEqual([]);
  expect(host.querySelectorAll('img')).toHaveLength(0);
});


const chosen = 'https://images.test/chosen-screened.jpg', replacement = 'https://images.test/replacement-screened.jpg';
async function client(lead: string | null) {
  fixture.leadImageUrl = lead;
  if (!root) { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); }
  await act(async () => root!.render(<VehicleHeroImage />));
}
const actualImage = () => host!.querySelector<HTMLImageElement>('img:not([aria-hidden])')!;
async function imageEvent(type: 'load' | 'error') { const image = actualImage(); expect(image).not.toBeNull(); await act(async () => image.dispatchEvent(new Event(type))); }
const photoView = () => ({ text: host!.textContent, images: [...host!.querySelectorAll('img')].map(image => ({ src: image.getAttribute('src'), srcset: image.getAttribute('srcset') })),
  badges: [...host!.querySelectorAll<HTMLElement>('[role="button"]')].map(badge => ({ text: badge.textContent, title: badge.title })),
  controls: [...host!.querySelectorAll('button')].map(button => button.textContent) });
const fallbackView = (caption: string) => ({ text: `1976 Synthetic Specimen1976SYNTHETICSPECIMENCOUPEMANUAL${caption} · EXPLORE BY BADGE`, images: [],
  badges: ['1976', 'SYNTHETIC', 'SPECIMEN', 'COUPE', 'MANUAL'].map(text => ({ text, title: text })), controls: [] });
const chosenView = (url: string) => ({ text: 'FILL', images: [{ src: url, srcset: null }], badges: [], controls: ['FILL'] });
function expectBadgeFacts() {
  expect(fixture.depth.slice(-5)).toEqual([{ dimension: 'year', value: 1976 }, { dimension: 'make', value: 'Synthetic' },
    { dimension: 'model', value: 'Specimen' }, { dimension: 'body_style', value: 'Coupe' }, { dimension: 'transmission', value: 'Manual' }]);
  expect(host!.querySelectorAll('[role="button"]')).toHaveLength(5); expect(fixture.depthLoads).toBe(0);
}
it('photo-read-status preserves a truly absent selection and refuses the unscreened gallery', async () => {
  await client(null); expect(photoView()).toEqual(fallbackView('NO PHOTO')); expectBadgeFacts();
  expect(fixture.vehicleImages).toEqual([{ id: 'synthetic-unscreened', image_url: 'https://images.test/unscreened-gallery.jpg' }]);
  expect(fixture.media).toEqual([]); expect(fixture.photoOpens).toEqual([]);
});
it('photo-read-status qualifies a failed current screened image without dropping its retained source or promoting gallery', async () => {
  await client(chosen); expect(photoView()).toEqual(chosenView(chosen)); await imageEvent('error');
  expect(photoView()).toEqual(fallbackView('PHOTO UNAVAILABLE')); expectBadgeFacts(); expect(fixture.leadImageUrl).toBe(chosen);
  expect(host!.querySelectorAll('img')).toHaveLength(0); expect(fixture.photoOpens).toEqual([]);
});
it('photo-read-status preserves loaded chosen rendering, current desktop open callback and fit toggle', async () => {
  await client(chosen); await imageEvent('load'); expect(photoView()).toEqual(chosenView(chosen)); expect(fixture.depth).toEqual([]);
  await act(async () => actualImage().dispatchEvent(new MouseEvent('click', { bubbles: true }))); expect(fixture.photoOpens).toEqual([chosen]);
  await act(async () => host!.querySelector<HTMLButtonElement>('button')!.click());
  expect(host!.textContent).toBe('FIT'); expect(fixture.photoOpens).toEqual([chosen]);
});
it('photo-read-status preserves a valid replacement after failure', async () => {
  await client(chosen); await imageEvent('error'); await client(replacement); await imageEvent('load');
  expect(photoView()).toEqual(chosenView(replacement)); expect(fixture.leadImageUrl).toBe(replacement);
});
it.each([null, 'undefined', 'null', '   '])('photo-read-status preserves current empty or screened-out selection %s despite old failures', async lead => {
  await client(chosen); await imageEvent('error'); await client(lead);
  expect(photoView()).toEqual(fallbackView('NO PHOTO')); expectBadgeFacts(); expect(fixture.leadImageUrl).toBe(lead);
});
it('photo-read-status retains failed URL eligibility on reselect without retry or gallery substitution', async () => {
  await client(chosen); await imageEvent('error'); await client(replacement); await client(chosen);
  expect(photoView()).toEqual(fallbackView('PHOTO UNAVAILABLE')); expectBadgeFacts();
  expect(host!.querySelectorAll('img')).toHaveLength(0); expect(fixture.photoOpens).toEqual([]);
});
it('photo-read-status preserves existing render srcset, full-image load and original chosen URL callback', async () => {
  const url = 'https://storage.test/storage/v1/object/public/vehicle-images/synthetic.jpg?public=1';
  const render = 'https://storage.test/storage/v1/render/image/public/vehicle-images/synthetic.jpg';
  await client(url); expect(host!.querySelectorAll('img')).toHaveLength(2);
  expect(actualImage().getAttribute('src')).toBe(`${render}?width=840&quality=90&resize=contain`);
  expect(actualImage().getAttribute('srcset')).toBe([420, 840, 1260].map(width => `${render}?width=${width}&quality=90&resize=contain ${width}w`).join(', '));
  await imageEvent('load'); expect(host!.querySelectorAll('img')).toHaveLength(1); expect(host!.textContent).toBe('FILL');
  await act(async () => actualImage().dispatchEvent(new MouseEvent('click', { bubbles: true }))); expect(fixture.photoOpens).toEqual([url]);
});
