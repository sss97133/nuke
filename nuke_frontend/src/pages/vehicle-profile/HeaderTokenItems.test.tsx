// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FacetItem } from '../../kit/types';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../../lib/supabase', () => ({ supabase: { rpc } }));
vi.mock('../../components/map/OneMap', () => ({ default: ({ focus }: any) =>
  <div data-testid="one-map-focus" data-fips={focus.countyFips} data-geojson={focus.geojsonPath} data-lat={focus.centroid?.lat} /> }));
import HeaderTokenItems from './HeaderTokenItems';
import { codeText, equationText, itemLabel, ratioText, valueText } from '../../kit';

// Synthetic items in the shape vehicle_facet_items returns (no real vehicle, image or source).
const transmission: FacetItem[] = [
  { key: 'transmission.as_built.type', facet: 'as_built', value: 'Manual', unit: null, status: 'established', lead: true, needed: null,
    rule: { key: 'example_vin_rule_v1', code: 'X', citation_url: 'https://example.org/vin-chart' }, equation: null,
    sources: [{ kind: 'registry', slug: 'example_chart', label: 'Example VIN chart', observed_at: '2026-01-02T00:00:00Z', witness: { kind: 'observation', id: 'o-1' } }] },
  { key: 'transmission.current.case_casting', facet: 'current', value: '3925661', unit: null, status: 'reading', needed: null, rule: null, equation: null,
    sources: [{ kind: 'image', label: 'photo reading', observed_at: '2026-02-03T00:00:00Z',
      witness: { kind: 'image', id: 'i-1', thumb: 'https://example.supabase.co/storage/v1/object/public/vehicle-images/synthetic/t.jpg' } }] },
  { key: 'transmission.current.gear_ratios', facet: 'decode', value: null, unit: null, status: 'missing', rule: null, equation: null, sources: [],
    needed: 'transmission model identified by its ID stamp, and a cited ratio table for that model' },
  { key: 'transmission.current.model', facet: 'current', value: null, unit: null, status: 'conflict', rule: null, equation: null, needed: null, sources: [],
    sides: [{ value: 'Model A', sources: [{ kind: 'listing', label: 'Seller listing', observed_at: '2025-05-06T00:00:00Z' }] },
      { value: 'Model B', sources: [{ kind: 'image', label: 'photo reading', observed_at: '2026-02-03T00:00:00Z' }] }] },
  { key: 'transmission.derived.rpm_at_60', facet: 'derived', value: 2450, unit: 'rpm', status: 'established', rule: null, needed: null, sources: [],
    equation: { expression: 'mph * top_gear_ratio * axle_ratio * 63360 / (60 * pi() * tire_diameter_in), mph = 60' } },
];

const location: FacetItem[] = [
  { key: 'location.current.area', facet: 'current', status: 'reading', unit: null, rule: null, equation: null, needed: null,
    value: { label: 'Example City, NV', level: 'city', county_fips: '32999' },
    sources: [{ kind: 'image', label: 'photo GPS', observed_at: '2026-03-04T00:00:00Z' }] },
  { key: 'location.sources.photo_gps', facet: 'current', status: 'reading', unit: null, rule: null, equation: null, needed: null, sources: [],
    value: { photos: 12, days: 3, areas: [{ label: 'Example City, NV', photos: 12, days: 3, first_taken_at: '2026-01-01T00:00:00Z', last_taken_at: '2026-03-04T00:00:00Z' }] } },
  { key: 'location.map', facet: 'current', status: 'reading', unit: null, rule: null, equation: null, sources: [], needed: 'the ZCTA of this area',
    value: { label: 'Example City, NV', county_fips: '32999', bounds: { grain: 'county', county_fips: '32999', geojson: 'map-data/geo/v1/county/32999.geojson' },
      centroid: { lat: 36.1, lng: -115.1 } } },
];

let host: HTMLDivElement; let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); rpc.mockReset(); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async (node: React.ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}><React.Suspense fallback={null}>{node}</React.Suspense></QueryClientProvider>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
};

it('names items from their keys and writes values as words', () => {
  expect(itemLabel({ key: 'transmission.current.case_casting', facet: 'current' })).toBe('Case casting');
  expect(itemLabel({ key: 'transmission.axle.as_built.ratio', facet: 'as_built' })).toBe('Axle ratio');
  expect(itemLabel({ key: 'location.sources.photo_gps', facet: 'current' })).toBe('Photo gps');
  expect(valueText([2.52, 1.88, 1.46, 1])).toBe('2.52 / 1.88 / 1.46 / 1');
  expect(valueText(4.1, 'L')).toBe('4.1 L');
  expect(valueText(true)).toBe('Yes');
  expect(valueText({ label: 'Example City, NV', county_fips: '32999' })).toBe('Example City, NV');
});

it('renders every item of a carried token as a row with status, sources, rule, equation and what is needed', async () => {
  await render(<HeaderTokenItems vehicleId="v-1" dimension="transmission" items={{ transmission }} />);
  const rows = host.querySelectorAll('.k-item');
  expect(Array.from(rows).map(r => r.getAttribute('data-key'))).toEqual(transmission.map(i => i.key));
  expect(Array.from(host.querySelectorAll('.k-status')).map(s => s.textContent)).toEqual(['established', 'reading', 'missing', 'conflict', 'established']);
  expect(host.textContent).toContain('Example VIN chart');
  expect(host.querySelector('a[href="https://example.org/vin-chart"]')?.textContent).toBe('example vin rule v1');
  const thumb = host.querySelector('img.k-item__thumb') as HTMLImageElement;
  expect(thumb.getAttribute('src')).toContain('synthetic/t.jpg');
  expect(thumb.getAttribute('width')).toBe('40');
  expect(host.textContent).toContain('Needed: transmission model identified by its ID stamp');
  expect(host.textContent).toContain('Model A');
  expect(host.textContent).toContain('Model B');
  expect(host.textContent).toContain('2,450 rpm');
  expect(host.textContent).toContain('Computed: mph * top gear ratio * axle ratio * 63360 / (60 * π * tire diameter in), mph = 60');
  expect(host.textContent).not.toMatch(/[{}]|\[object/);
  expect(host.querySelector('[style]')).toBeNull();
  expect(rpc).not.toHaveBeenCalled();
});

it('prints the reader\'s labels for codes, ratios to two places, and every cited availability row', async () => {
  expect(codeText('not_original_unit')).toBe('not original unit');
  expect(equationText('gear_ratio[n] * axle_ratio')).toBe('gear ratio[n] * axle ratio');
  expect(equationText('as_built.type <> current.type')).toBe('as built type ≠ current type');
  expect(codeText('Muncie four-speed')).toBe('Muncie four-speed');
  expect(ratioText([2.56, 1.91, 1.48, 1])).toBe('2.56 / 1.91 / 1.48 / 1.00');
  const items: FacetItem[] = [
    { key: 'transmission.as_built.model', facet: 'as_built', value: null, unit: null, status: 'missing', equation: null, sources: [],
      needed: 'build sheet', rule: { key: 'model_availability', label: 'Factory availability by series and engine' },
      examined: [{ result: 'transmission on tag: not_example_code', observed_at: '2026-01-02T00:00:00Z' }],
      availability: [
        { rule_id: 'r-1', market: 'US', available: false, transmission: 'Example 4-speed', quoted: 'Example quote',
          citation_url: 'https://example.org/a', citation_title: 'Example reference A', citation_locator: 'table 1' },
        { rule_id: 'r-2', market: 'Canada', available: 'implied', transmission: 'Example 4-speed', inference: 'Example inference',
          conflicts_with: 'Example reference A', citation_url: 'https://example.org/b', citation_title: 'Example catalogue' }] },
    { key: 'transmission.current.gear_ratios', facet: 'decode', value: null, unit: null, status: 'missing', rule: null, equation: null,
      sources: [], needed: 'unit year', candidates: [{ code: 'X1', gears: [2.2, 1.64, 1.28, 1], reverse: 2.27 }] },
    { key: 'transmission.derived.changed', facet: 'derived', value: 'true', unit: null, status: 'reading', rule: null, equation: null,
      needed: null, sources: [{ kind: 'image', label: 'photo reading', value: 'not_original_unit', observed_at: '2026-01-02T00:00:00Z' },
        { kind: 'image', label: 'photo reading', value: 'not_original_engine', value_label: 'not the original engine', observed_at: '2026-01-02T00:00:00Z' }] },
  ];
  await render(<HeaderTokenItems vehicleId="v-1" dimension="transmission" items={{ transmission: items }} />);
  const text = host.textContent ?? '';
  expect(text).toContain('Rule: Factory availability by series and engine');
  expect(text).toContain('transmission on tag: not example code');
  expect(text).toContain('US · not available · Example 4-speed');
  expect(text).toContain('Canada · available by inference · Example 4-speed');
  expect(text).toContain('Quoted: “Example quote”');
  expect(text).toContain('Inference: Example inference');
  expect(text).toContain('Disagrees with: Example reference A');
  expect(host.querySelector('a[href="https://example.org/a"]')?.textContent).toBe('Example reference A');
  expect(text).toContain('table 1');
  expect(text).toContain('X1 · 2.20 / 1.64 / 1.28 / 1.00 · reverse 2.27');
  expect(text).toContain('not original unit');
  expect(text).toContain('not the original engine');
  expect(text).not.toMatch(/[a-z0-9]_[a-z0-9]/);
});

it('reads location when it opens and draws its county and area centre on the map', async () => {
  rpc.mockResolvedValue({ data: location, error: null });
  await render(<HeaderTokenItems vehicleId="v-1" dimension="location" items={{ transmission }} />);
  expect(rpc).toHaveBeenCalledWith('vehicle_facet_items', { p_vehicle_id: 'v-1', p_dimension: 'location' });
  expect(host.textContent).toContain('Example City, NV');
  expect(host.textContent).toContain('12 photos · 3 days');
  const map = host.querySelector('[data-testid="one-map-focus"]');
  expect(map?.getAttribute('data-fips')).toBe('32999');
  expect(map?.getAttribute('data-geojson')).toBe('map-data/geo/v1/county/32999.geojson');
  expect(map?.closest('.k-item')?.getAttribute('data-key')).toBe('location.map');
});

it('says when the location read fails', async () => {
  rpc.mockResolvedValue({ data: null, error: new Error('timeout') });
  await render(<HeaderTokenItems vehicleId="v-1" dimension="location" />);
  expect(host.textContent).toContain('Location read failed: timeout');
});
