// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('./OneMap', () => ({ default: ({ focus }: any) => <div data-testid="zip-map" data-zip={focus.selectedZip} data-centroid={focus.centroid?.lat} /> }));
import { ZipOutlineContent } from './ZipOutlineContent';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => document.body.replaceChildren());

it('embeds the exact ZIP polygon map without another dialog or city point', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const location = { key: 'location.map', status: 'reading', value: { zcta: '89005',
    bounds: { county_fips: '32003', geojson: 'map-data/geo/v1/county/32003.geojson' } } };
  await act(async () => root.render(<ZipOutlineContent location={location} />));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(host.querySelector('[data-testid="zip-map"]')?.getAttribute('data-zip')).toBe('89005');
  expect(host.querySelector('[data-testid="zip-map"]')?.getAttribute('data-centroid')).toBeNull();
  expect(host.querySelector('dialog,[role="dialog"]')).toBeNull();
  expect(host.textContent).toContain('Census ZIP Code Tabulation Area outline');
  await act(async () => root.unmount());
});
