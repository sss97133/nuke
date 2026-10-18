// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ vehicle: null as any, depth: [] as { dimension: string; value: unknown }[], depthLoads: 0,
  media: [] as string[], photoOpens: [] as unknown[] }));
vi.mock('./VehicleProfileContext', () => ({ useVehicleProfile: () => ({ vehicle: fixture.vehicle, vehicleId: 'synthetic-spec-card', leadImageUrl: null, heroMeta: null }) }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../../components/image/MobileImageGallery', () => ({ default: () => { fixture.media.push('mobile'); return null; } }));
vi.mock('./VehicleMediaKit', () => ({ default: () => { fixture.media.push('media-kit'); return null; } }));
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

beforeEach(() => {
  fixture.depth = []; fixture.depthLoads = 0; fixture.media = []; fixture.photoOpens = [];
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden'); }));
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

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
