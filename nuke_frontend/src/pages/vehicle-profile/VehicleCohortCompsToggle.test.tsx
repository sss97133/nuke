// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildVehicleCohortOptions,
  classifyVehicleFacet,
  computeCohortComparisonStats,
  filterComparableSalesByCohort,
} from '../../lib/market/vehicleTaxonomy';
import { SimilarSalesSection } from '../../components/vehicle/SimilarSalesSection';
import type { SimilarSale } from '../../hooks/useSimilarSales';
import SoldContext from './SoldContext';
import type { CompSale } from './hooks/useVehicleIntel';

vi.mock('../../components/PrefetchLink', () => ({
  PrefetchLink: ({ to, children, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('../../hooks/useSimilarSales', () => ({
  useSimilarSales: () => ({
    data: [],
    isLoading: false,
    error: null,
  }),
}));

const SAMPLE_SIMILAR_SALES: SimilarSale[] = [
  {
    vehicle_id: 'comp-1',
    year: 1972,
    make: 'Chevrolet',
    model: 'C10 Cheyenne Fleetside',
    trim: 'Cheyenne',
    vin: null,
    sale_price: 52000,
    mileage: 41000,
    color: 'Blue',
    image_url: null,
    location: 'Austin, TX',
    listing_url: 'https://bringatrailer.com/listing/1972-chevrolet-c10-1/',
    platform: 'Bring a Trailer',
    platform_raw: 'bat',
    sold_date: '2026-08-15',
    source_type: 'auction_event',
  },
  {
    vehicle_id: 'comp-2',
    year: 1971,
    make: 'Chevrolet',
    model: 'C10 Cheyenne Fleetside',
    trim: 'Cheyenne',
    vin: null,
    sale_price: 48000,
    mileage: 55000,
    color: 'Ochre',
    image_url: null,
    location: 'Phoenix, AZ',
    listing_url: 'https://bringatrailer.com/listing/1971-chevrolet-c10-2/',
    platform: 'Bring a Trailer',
    platform_raw: 'bat',
    sold_date: '2026-07-20',
    source_type: 'auction_event',
  },
  {
    vehicle_id: 'comp-3',
    year: 1972,
    make: 'Chevrolet',
    model: 'C10 Custom Stepside',
    trim: 'Custom',
    vin: null,
    sale_price: 30000,
    mileage: 78000,
    color: 'Red',
    image_url: null,
    location: 'Denver, CO',
    listing_url: 'https://bringatrailer.com/listing/1972-chevrolet-c10-3/',
    platform: 'Bring a Trailer',
    platform_raw: 'bat',
    sold_date: '2026-06-11',
    source_type: 'auction_event',
  },
  {
    vehicle_id: 'comp-4',
    year: 1972,
    make: 'Chevrolet',
    model: 'K20 Custom Camper Stepside',
    trim: 'Custom Camper',
    vin: null,
    sale_price: 32000,
    mileage: 64000,
    color: 'Green',
    image_url: null,
    location: 'Boise, ID',
    listing_url: 'https://bringatrailer.com/listing/1972-chevrolet-k20-4/',
    platform: 'Bring a Trailer',
    platform_raw: 'bat',
    sold_date: '2026-05-03',
    source_type: 'auction_event',
  },
];

describe('Vehicle Profile Cohort Filter Bar & Comparable Sales Taxonomy', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
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

  it('derives SERIES, TRIM, and BODY STYLE facets using classifyVehicleFacet from lib/market/vehicleTaxonomy.ts', () => {
    const { facets, options } = buildVehicleCohortOptions({
      year: 1972,
      make: 'Chevrolet',
      model: 'C10 Cheyenne Fleetside',
      series: 'C10',
      trim: 'Cheyenne',
      body_style: 'Fleetside',
    });

    expect(facets).toEqual({
      series: 'C10 (1/2-Ton 2WD)',
      trim: 'Cheyenne',
      body: 'Fleetside / Styleside',
    });

    expect(options.map((o) => o.label)).toEqual([
      'ALL FAMILY',
      'SERIES: C10 (1/2-Ton 2WD)',
      'TRIM: Cheyenne',
      'BODY: Fleetside / Styleside',
    ]);
  });

  it('filters comparable sales by selected cohort and computes cohort median and premium/discount % vs family median', () => {
    const facets = classifyVehicleFacet({
      year: 1972,
      make: 'Chevrolet',
      model: 'C10 Cheyenne Fleetside',
    });

    // Overall family prices: [30000, 32000, 48000, 52000] -> median = (32000 + 48000) / 2 = 40000
    const cheyenneSales = filterComparableSalesByCohort(
      SAMPLE_SIMILAR_SALES,
      'trim',
      facets,
      'Chevrolet',
    );
    expect(cheyenneSales.map((s) => s.vehicle_id)).toEqual(['comp-1', 'comp-2']);

    const cheyenneStats = computeCohortComparisonStats(SAMPLE_SIMILAR_SALES, cheyenneSales);
    expect(cheyenneStats.familyMedianPrice).toBe(40000);
    expect(cheyenneStats.cohortMedianPrice).toBe(50000);
    expect(cheyenneStats.deltaPctVsFamily).toBe(25);
    expect(cheyenneStats.deltaDirection).toBe('premium');

    // Stepside cohort (discount vs family median)
    const stepsideFacets = classifyVehicleFacet({
      year: 1972,
      make: 'Chevrolet',
      model: 'C10 Custom Stepside',
    });
    const stepsideSales = filterComparableSalesByCohort(
      SAMPLE_SIMILAR_SALES,
      'body',
      stepsideFacets,
      'Chevrolet',
    );
    const stepsideStats = computeCohortComparisonStats(SAMPLE_SIMILAR_SALES, stepsideSales);
    expect(stepsideStats.cohortMedianPrice).toBe(31000);
    expect(stepsideStats.deltaPctVsFamily).toBe(-22.5);
    expect(stepsideStats.deltaDirection).toBe('discount');
  });

  it('renders interactive Cohort Filter bar in SimilarSalesSection and updates filtered sales, median price, and premium % when clicked', async () => {
    await act(async () => {
      root.render(
        <SimilarSalesSection
          vehicleId="subject-c10"
          vehicleYear={1972}
          vehicleMake="Chevrolet"
          vehicleModel="C10 Cheyenne Fleetside"
          vehicleSeries="C10"
          vehicleTrim="Cheyenne"
          vehicleBodyStyle="Fleetside"
          initialSales={SAMPLE_SIMILAR_SALES}
        />,
      );
    });

    const filterBar = host.querySelector('[data-testid="comparable-cohort-filter-bar"]');
    expect(filterBar).not.toBeNull();

    const allBtn = host.querySelector('[data-testid="cohort-filter-all"]') as HTMLButtonElement;
    const seriesBtn = host.querySelector('[data-testid="cohort-filter-series"]') as HTMLButtonElement;
    const trimBtn = host.querySelector('[data-testid="cohort-filter-trim"]') as HTMLButtonElement;
    const bodyBtn = host.querySelector('[data-testid="cohort-filter-body"]') as HTMLButtonElement;

    expect(allBtn.textContent).toBe('ALL FAMILY');
    expect(seriesBtn.textContent).toBe('SERIES: C10 (1/2-Ton 2WD)');
    expect(trimBtn.textContent).toBe('TRIM: Cheyenne');
    expect(bodyBtn.textContent).toBe('BODY: Fleetside / Styleside');

    // Initially ALL FAMILY is active -> 4 comparable sale cards, median $40,000, +0.0% PAR
    expect(host.querySelectorAll('[data-testid="comparable-sale-card"]')).toHaveLength(4);
    expect(host.querySelector('[data-testid="cohort-median-price"]')?.textContent).toContain('$40,000');

    // Click TRIM: Cheyenne -> filters to 2 sales, cohort median $50,000, +25.0% PREMIUM VS FAMILY MEDIAN
    await act(async () => {
      trimBtn.click();
    });
    expect(host.querySelectorAll('[data-testid="comparable-sale-card"]')).toHaveLength(2);
    expect(host.querySelector('[data-testid="cohort-median-price"]')?.textContent).toContain('$50,000');
    expect(host.querySelector('[data-testid="family-median-price"]')?.textContent).toContain('$40,000');
    expect(host.querySelector('[data-testid="cohort-delta-vs-family"]')?.textContent).toContain(
      '+25.0% PREMIUM VS FAMILY MEDIAN',
    );

    // Click SERIES: C10 (1/2-Ton 2WD) -> filters to 3 C10 sales ([52000, 48000, 30000] -> median $48,000, +20.0%)
    await act(async () => {
      seriesBtn.click();
    });
    expect(host.querySelectorAll('[data-testid="comparable-sale-card"]')).toHaveLength(3);
    expect(host.querySelector('[data-testid="cohort-median-price"]')?.textContent).toContain('$48,000');
    expect(host.querySelector('[data-testid="cohort-delta-vs-family"]')?.textContent).toContain(
      '+20.0% PREMIUM VS FAMILY MEDIAN',
    );
  });

  it('supports interactive Cohort Filter toggling inside SoldContext on VehicleProfile', async () => {
    const comps: CompSale[] = [
      { id: 'c1', year: 1972, model: 'C10 Cheyenne Fleetside', sale_price: 52000, sale_date: '2026-08-15', thumbnail: null, mileage: 41000 },
      { id: 'c2', year: 1971, model: 'C10 Cheyenne Fleetside', sale_price: 48000, sale_date: '2026-07-20', thumbnail: null, mileage: 55000 },
      { id: 'c3', year: 1972, model: 'C10 Custom Stepside', sale_price: 30000, sale_date: '2026-06-11', thumbnail: null, mileage: 78000 },
      { id: 'c4', year: 1972, model: 'K20 Custom Stepside', sale_price: 32000, sale_date: '2026-05-03', thumbnail: null, mileage: 64000 },
    ];

    await act(async () => {
      root.render(
        <SoldContext
          comps={comps}
          subject={{
            year: 1972,
            make: 'Chevrolet',
            model: 'C10 Cheyenne Fleetside',
          }}
        />,
      );
    });

    expect(host.querySelectorAll('.vp-sold-context__sale')).toHaveLength(4);
    const trimBtn = host.querySelector('[data-testid="cohort-filter-trim"]') as HTMLButtonElement;
    expect(trimBtn).not.toBeNull();
    expect(trimBtn.textContent).toBe('TRIM: Cheyenne');

    await act(async () => {
      trimBtn.click();
    });

    expect(host.querySelectorAll('.vp-sold-context__sale')).toHaveLength(2);
    expect(host.querySelector('[data-testid="cohort-median-price"]')?.textContent).toContain('$50,000');
    expect(host.querySelector('[data-testid="cohort-delta-vs-family"]')?.textContent).toContain('+25.0% vs family median');
  });
});
