// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VehicleSearch from '../VehicleSearch';
import {
  resolveMarketCohortShortcuts,
  resolveVehicleIdentityMarks,
} from '../../lib/market/vehicleTaxonomy';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

const MOCK_VEHICLES = [
  {
    id: 'veh-1978-c10',
    year: 1978,
    make: 'Chevrolet',
    model: 'C10 Silverado',
    series: 'C10',
    trim: 'Silverado',
    body_style: 'Fleetside',
    vin: 'CCL448S123456',
    color: 'Blue',
    mileage: 48000,
    asking_price: 38500,
    is_for_sale: true,
    origin_metadata: { images: ['https://example.com/c10.jpg'] },
  },
  {
    id: 'veh-1965-corvette',
    year: 1965,
    make: 'Chevrolet',
    model: 'Corvette Sting Ray',
    series: 'Sting Ray',
    trim: null,
    body_style: 'Coupe',
    vin: '194375S100001',
    color: 'Red',
    mileage: 31000,
    asking_price: 89000,
    is_for_sale: true,
    origin_metadata: { images: [] },
  },
  {
    id: 'veh-2018-gt3',
    year: 2018,
    make: 'Porsche',
    model: '911 GT3',
    series: 'GT3',
    trim: 'GT3',
    body_style: 'Coupe',
    vin: 'WP0AC2A99JS123456',
    color: 'Chalk',
    mileage: 12000,
    asking_price: 185000,
    is_for_sale: false,
    origin_metadata: { images: [] },
  },
];

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          or: () => ({
            limit: async () => ({
              data: MOCK_VEHICLES,
              error: null,
            }),
          }),
        }),
      }),
    }),
  },
}));

vi.mock('../search/AIModelSelector', () => ({
  default: () => <div data-testid="ai-model-selector" />,
}));

function setInputValue(input: HTMLInputElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  nativeSetter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('VehicleSearch — Market Cohort Shortcuts & Vehicle Result Emblem Preview', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    mockNavigate.mockReset();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it('resolves vetted identity marks and canonical SERIES / TRIM / BODY STYLE facets for major enthusiast queries', () => {
    expect(resolveMarketCohortShortcuts('c')).toEqual([]);

    const representativeQueries: Array<{
      query: string;
      expectedMake: string;
      expectedFamily: string;
      expectedAxis: 'series' | 'trim' | 'body';
      expectedFacetSubstring: string;
    }> = [
      { query: 'Squarebody', expectedMake: 'Chevrolet', expectedFamily: 'Pickup', expectedAxis: 'series', expectedFacetSubstring: 'C10' },
      { query: 'C10', expectedMake: 'Chevrolet', expectedFamily: 'Pickup', expectedAxis: 'series', expectedFacetSubstring: 'C10' },
      { query: 'K10', expectedMake: 'Chevrolet', expectedFamily: 'Pickup', expectedAxis: 'series', expectedFacetSubstring: 'K10' },
      { query: '3100', expectedMake: 'Chevrolet', expectedFamily: 'Pickup', expectedAxis: 'series', expectedFacetSubstring: '3100' },
      { query: 'Silverado', expectedMake: 'Chevrolet', expectedFamily: 'Pickup', expectedAxis: 'trim', expectedFacetSubstring: 'Silverado' },
      { query: 'Cheyenne', expectedMake: 'Chevrolet', expectedFamily: 'Pickup', expectedAxis: 'trim', expectedFacetSubstring: 'Cheyenne' },
      { query: 'Stepside', expectedMake: 'Chevrolet', expectedFamily: 'Pickup', expectedAxis: 'body', expectedFacetSubstring: 'Stepside' },
      { query: 'Fleetside', expectedMake: 'Chevrolet', expectedFamily: 'Pickup', expectedAxis: 'body', expectedFacetSubstring: 'Fleetside' },
      { query: 'FJ40', expectedMake: 'Toyota', expectedFamily: 'Land Cruiser', expectedAxis: 'series', expectedFacetSubstring: 'FJ40' },
      { query: 'FJ60', expectedMake: 'Toyota', expectedFamily: 'Land Cruiser', expectedAxis: 'series', expectedFacetSubstring: 'FJ60' },
      { query: 'FJ80', expectedMake: 'Toyota', expectedFamily: 'Land Cruiser', expectedAxis: 'series', expectedFacetSubstring: 'FJ80' },
      { query: '993', expectedMake: 'Porsche', expectedFamily: '911', expectedAxis: 'series', expectedFacetSubstring: '911 Carrera' },
      { query: '992', expectedMake: 'Porsche', expectedFamily: '911', expectedAxis: 'series', expectedFacetSubstring: '911 Carrera' },
      { query: 'GT3 RS', expectedMake: 'Porsche', expectedFamily: '911', expectedAxis: 'series', expectedFacetSubstring: 'GT3 RS' },
      { query: 'GT3', expectedMake: 'Porsche', expectedFamily: '911', expectedAxis: 'series', expectedFacetSubstring: 'GT3' },
      { query: 'Z06', expectedMake: 'Chevrolet', expectedFamily: 'Corvette', expectedAxis: 'series', expectedFacetSubstring: 'Z06' },
      { query: 'ZR1', expectedMake: 'Chevrolet', expectedFamily: 'Corvette', expectedAxis: 'series', expectedFacetSubstring: 'ZR1' },
      { query: 'Sting Ray', expectedMake: 'Chevrolet', expectedFamily: 'Corvette', expectedAxis: 'series', expectedFacetSubstring: 'Sting Ray' },
      { query: 'Shelby GT350', expectedMake: 'Ford', expectedFamily: 'Mustang', expectedAxis: 'series', expectedFacetSubstring: 'Shelby GT350' },
      { query: 'Boss 429', expectedMake: 'Ford', expectedFamily: 'Mustang', expectedAxis: 'series', expectedFacetSubstring: 'Boss 429' },
      { query: 'Mach 1', expectedMake: 'Ford', expectedFamily: 'Mustang', expectedAxis: 'series', expectedFacetSubstring: 'Mach 1' },
      { query: 'Gullwing', expectedMake: 'Mercedes-Benz', expectedFamily: 'SL', expectedAxis: 'body', expectedFacetSubstring: 'Gullwing' },
      { query: 'Pagoda', expectedMake: 'Mercedes-Benz', expectedFamily: 'SL', expectedAxis: 'series', expectedFacetSubstring: 'Pagoda' },
      { query: 'E-Type', expectedMake: 'Jaguar', expectedFamily: 'E-Type', expectedAxis: 'series', expectedFacetSubstring: 'E-Type' },
      { query: 'Power Wagon', expectedMake: 'Dodge', expectedFamily: 'Pickup', expectedAxis: 'series', expectedFacetSubstring: 'Power Wagon' },
      { query: 'Cummins', expectedMake: 'Dodge', expectedFamily: 'Pickup', expectedAxis: 'series', expectedFacetSubstring: 'Power Wagon' },
      { query: 'Hemi', expectedMake: 'Dodge', expectedFamily: 'Charger', expectedAxis: 'series', expectedFacetSubstring: '426 Hemi' },
      { query: 'R/T', expectedMake: 'Dodge', expectedFamily: 'Charger', expectedAxis: 'trim', expectedFacetSubstring: 'R/T' },
    ];

    for (const item of representativeQueries) {
      const matches = resolveMarketCohortShortcuts(item.query, 3);
      expect(matches.length).toBeGreaterThan(0);
      expect(matches.length).toBeLessThanOrEqual(3);
      const top = matches[0];
      expect(top.make).toBe(item.expectedMake);
      expect(top.family).toBe(item.expectedFamily);
      expect(top.axis).toBe(item.expectedAxis);
      expect(top.facet).toContain(item.expectedFacetSubstring);
      expect(top.svgMarkup).toContain('<svg');
      expect(top.url).toContain(`make=${encodeURIComponent(item.expectedMake)}`);
    }
  });

  it('resolves vetted era/trim SVG identity marks via resolveVehicleIdentityMarks for individual vehicles', () => {
    const squarebodyMarks = resolveVehicleIdentityMarks({
      brand: 'Chevrolet',
      family: 'C10 Silverado',
      year: 1978,
      seriesCode: 'C10',
      trimPackage: 'Silverado',
      bodyStyle: 'Fleetside',
    });
    expect(squarebodyMarks.length).toBeGreaterThan(0);
    expect(squarebodyMarks[0].id).toBe('chevy-silverado-10-75-80');
    expect(squarebodyMarks[0].svgMarkup).toContain('<svg');
    expect(squarebodyMarks[0].provenanceNote).toContain('Silverado 10');

    const corvetteMarks = resolveVehicleIdentityMarks({
      brand: 'Chevrolet',
      family: 'Corvette Sting Ray',
      year: 1965,
      seriesCode: 'Sting Ray',
    });
    expect(corvetteMarks.length).toBeGreaterThan(0);
    expect(corvetteMarks[0].id).toBe('corvette-c2-sting-ray-63-67');

    const gt3Marks = resolveVehicleIdentityMarks({
      brand: 'Porsche',
      family: '911 GT3',
      year: 2018,
      seriesCode: 'GT3',
    });
    expect(gt3Marks.length).toBeGreaterThan(0);
    expect(gt3Marks[0].id).toBe('porsche-911-carrera-rs-73');

    const gtoMarks = resolveVehicleIdentityMarks({
      brand: 'Pontiac',
      family: 'GTO Judge',
      year: 1969,
    });
    expect(gtoMarks.length).toBeGreaterThan(0);
    expect(gtoMarks[0].id).toBe('pontiac-gto-trans-am-64-81');
  });

  it('renders MARKET COHORT SHORTCUTS and inline vetted SVG emblem previews with provenance tooltips on vehicle result rows', async () => {
    vi.useFakeTimers();
    try {
      await act(async () => {
        root.render(<VehicleSearch />);
      });

      const input = host.querySelector('input[type="text"]') as HTMLInputElement;
      expect(input).not.toBeNull();

      await act(async () => {
        setInputValue(input, 'Silverado');
        vi.advanceTimersByTime(350);
      });

      // Allow async performSearch promise to settle
      await act(async () => {
        await Promise.resolve();
      });

      const shortcutsSection = host.querySelector('[data-testid="market-cohort-shortcuts-section"]');
      expect(shortcutsSection).not.toBeNull();

      // Verify inline SVG identity mark emblem rendered on the 1978 Chevrolet C10 Silverado row
      const c10Emblem = host.querySelector(
        '[data-testid="vehicle-search-result-emblem-veh-1978-c10"]',
      ) as HTMLElement;
      expect(c10Emblem).not.toBeNull();
      expect(c10Emblem.innerHTML).toContain('<svg');
      expect(c10Emblem.getAttribute('title')).toContain('SILVERADO 10');
      expect(c10Emblem.getAttribute('title')).toContain('1975–1980 Round-Eye Squarebody Silverado 10');

      // Verify inline SVG identity mark emblem rendered on the 1965 Corvette Sting Ray row
      const corvetteEmblem = host.querySelector(
        '[data-testid="vehicle-search-result-emblem-veh-1965-corvette"]',
      ) as HTMLElement;
      expect(corvetteEmblem).not.toBeNull();
      expect(corvetteEmblem.innerHTML).toContain('Sting Ray');
      expect(corvetteEmblem.getAttribute('title')).toContain('1963–1967 C2 Corvette');

      // Verify inline SVG identity mark emblem rendered on the 2018 Porsche 911 GT3 row
      const gt3Emblem = host.querySelector(
        '[data-testid="vehicle-search-result-emblem-veh-2018-gt3"]',
      ) as HTMLElement;
      expect(gt3Emblem).not.toBeNull();
      expect(gt3Emblem.innerHTML).toContain('Carrera RS');
      expect(gt3Emblem.getAttribute('title')).toContain('GT3');
    } finally {
      vi.useRealTimers();
    }
  });

  it('navigates directly to /?make=...&family=...&axis=...&facet=... and closes the dropdown when a shortcut is clicked', async () => {
    await act(async () => {
      root.render(<VehicleSearch />);
    });

    const input = host.querySelector('input[type="text"]') as HTMLInputElement;

    await act(async () => {
      setInputValue(input, 'FJ40');
    });

    const fj40Card = host.querySelector(
      '[data-testid="market-cohort-shortcut-toyota-land-cruiser-fj40"]',
    ) as HTMLElement;
    expect(fj40Card).not.toBeNull();
    expect(fj40Card.textContent).toContain('Toyota Land Cruiser · SERIES: FJ40 / BJ40 (J40)');

    await act(async () => {
      fj40Card.click();
    });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(
      '/?make=Toyota&family=Land+Cruiser&axis=series&facet=FJ40+%2F+BJ40+%28J40%29',
    );

    expect(host.querySelector('[data-testid="vehicle-search-dropdown"]')).toBeNull();
    expect(input.value).toBe('');
  });
});
