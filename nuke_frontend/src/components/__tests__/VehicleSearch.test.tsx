// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VehicleSearch from '../VehicleSearch';
import { resolveMarketCohortShortcuts } from '../../lib/market/vehicleTaxonomy';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          or: () => ({
            limit: async () => ({
              data: [
                {
                  id: 'veh-1978-c10',
                  year: 1978,
                  make: 'Chevrolet',
                  model: 'C10 Silverado',
                  vin: 'CCL448S123456',
                  color: 'Blue',
                  mileage: 48000,
                  asking_price: 38500,
                  is_for_sale: true,
                  origin_metadata: { images: ['https://example.com/c10.jpg'] },
                },
              ],
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

describe('VehicleSearch — Market Cohort Shortcuts & Facet Drilldowns', () => {
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
    // 1-char query returns empty
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

  it('renders MARKET COHORT SHORTCUTS at the top of the dropdown with inline SVG badge, era range, and MARKET MAP ↗ pill', async () => {
    await act(async () => {
      root.render(<VehicleSearch />);
    });

    const input = host.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input).not.toBeNull();

    await act(async () => {
      setInputValue(input, 'Silverado');
    });

    const shortcutsSection = host.querySelector('[data-testid="market-cohort-shortcuts-section"]');
    expect(shortcutsSection).not.toBeNull();
    expect(shortcutsSection?.textContent).toContain('MARKET COHORT SHORTCUTS');

    const shortcutCard = host.querySelector(
      '[data-testid="market-cohort-shortcut-chevy-pickup-silverado"]',
    ) as HTMLElement;
    expect(shortcutCard).not.toBeNull();
    expect(shortcutCard.textContent).toContain('Chevrolet Pickup · TRIM: Silverado');
    expect(shortcutCard.textContent).toContain('1975–1987');
    expect(shortcutCard.textContent).toContain('MARKET MAP ↗');

    const svgHolder = shortcutCard.querySelector('[data-testid="market-cohort-shortcut-svg"]');
    expect(svgHolder?.innerHTML).toContain('<svg');
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

    // Dropdown closes and search term resets after navigation
    expect(host.querySelector('[data-testid="vehicle-search-dropdown"]')).toBeNull();
    expect(input.value).toBe('');
  });
});
