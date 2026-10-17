// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifyVehicleFacet,
  resolveVehicleIdentityMark,
} from './vehicleTaxonomy';
import {
  OrganizationFacetStrip,
  computeOrganizationFacetBreakdown,
  filterOrganizationVehiclesByFacet,
  type OrganizationFacetAxis,
  type OrganizationVehicleFacetInput,
} from '../components/organization/OrganizationFacetStrip';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const SAMPLE_ORG_VEHICLES: OrganizationVehicleFacetInput[] = [
  {
    id: 'ov-1',
    vehicle_id: 'v-1',
    vehicle_year: 1972,
    vehicle_make: 'Chevrolet',
    vehicle_model: 'C10 Cheyenne Fleetside',
    sale_price: 42000,
    is_sold: true,
    vehicles: {
      year: 1972,
      make: 'Chevrolet',
      model: 'C10 Cheyenne',
      series: 'C10',
      trim: 'Cheyenne',
      body_style: 'Fleetside',
    },
  },
  {
    id: 'ov-2',
    vehicle_id: 'v-2',
    vehicle_year: 1971,
    vehicle_make: 'Chevrolet',
    vehicle_model: 'C10 Cheyenne Stepside',
    sale_price: 38000,
    is_sold: true,
  },
  {
    id: 'ov-3',
    vehicle_id: 'v-3',
    vehicle_year: 1985,
    vehicle_make: 'Chevrolet',
    vehicle_model: 'K10 Silverado 4x4 Fleetside',
    vehicle_asking_price: 29500,
    is_sold: false,
  },
  {
    id: 'ov-4',
    vehicle_id: 'v-4',
    vehicle_year: 1995,
    vehicle_make: 'Porsche',
    vehicle_model: '911 Carrera RS Coupe',
    sale_price: 310000,
    is_sold: true,
  },
];

describe('vehicleTaxonomy helpers & OrganizationFacetStrip', () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  afterEach(() => {
    if (root) {
      act(() => {
        root!.unmount();
      });
      root = null;
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  it('classifies SERIES, TRIM, and BODY STYLE and resolves inline SVG identity marks via vehicleTaxonomy.ts', () => {
    const facets = classifyVehicleFacet({
      year: 1972,
      make: 'Chevrolet',
      model: 'C10 Cheyenne Fleetside',
      series: 'C10',
      trim: 'Cheyenne',
      body_style: 'Fleetside',
    });

    expect(facets.series).toBe('C10 (1/2-Ton 2WD)');
    expect(facets.trim).toBe('Cheyenne');
    expect(facets.body).toBe('Fleetside / Styleside');

    const cheyenneMark = resolveVehicleIdentityMark({
      make: 'Chevrolet',
      facetLabel: 'Cheyenne',
      year: 1972,
    });
    expect(cheyenneMark).not.toBeNull();
    expect(cheyenneMark?.svgMarkup).toContain('<svg');
    expect(cheyenneMark?.svgMarkup).toContain('CHEYENNE');
  });

  it('computes organization multi-axis facet breakdown and filters organization vehicles by selected pill', () => {
    const breakdown = computeOrganizationFacetBreakdown(SAMPLE_ORG_VEHICLES);
    expect(breakdown.totalVehicles).toBe(4);

    // SERIES buckets
    expect(breakdown.series.map((b) => b.name)).toContain('C10 (1/2-Ton 2WD)');
    const c10Bucket = breakdown.series.find((b) => b.name === 'C10 (1/2-Ton 2WD)')!;
    expect(c10Bucket.count).toBe(2);
    expect(c10Bucket.soldCount).toBe(2);
    expect(c10Bucket.medianUsd).toBe(40000);
    expect(c10Bucket.badgeSvg).toContain('<svg');

    // TRIM buckets
    const cheyenneBucket = breakdown.trim.find((b) => b.name === 'Cheyenne')!;
    expect(cheyenneBucket.count).toBe(2);
    expect(cheyenneBucket.badgeSvg).toContain('CHEYENNE');

    // BODY STYLE buckets
    expect(breakdown.body.map((b) => b.name)).toContain('Fleetside / Styleside');
    expect(breakdown.body.map((b) => b.name)).toContain('Stepside / Flareside');

    // Filtering
    const filteredC10 = filterOrganizationVehiclesByFacet(
      SAMPLE_ORG_VEHICLES,
      'series',
      'C10 (1/2-Ton 2WD)',
    );
    expect(filteredC10.map((v) => v.vehicle_id)).toEqual(['v-1', 'v-2']);

    const filteredStepside = filterOrganizationVehiclesByFacet(
      SAMPLE_ORG_VEHICLES,
      'body',
      'Stepside / Flareside',
    );
    expect(filteredStepside.map((v) => v.vehicle_id)).toEqual(['v-2']);
  });

  it('renders the Multi-Axis Inventory & Sales Facet Strip and filters the vehicle grid when clicking pills', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    const Harness: React.FC = () => {
      const [axis, setAxis] = React.useState<OrganizationFacetAxis>('series');
      const [facet, setFacet] = React.useState<string | null>(null);
      const breakdown = React.useMemo(
        () => computeOrganizationFacetBreakdown(SAMPLE_ORG_VEHICLES),
        [],
      );
      const visibleVehicles = React.useMemo(
        () => filterOrganizationVehiclesByFacet(SAMPLE_ORG_VEHICLES, axis, facet),
        [axis, facet],
      );

      return (
        <div>
          <OrganizationFacetStrip
            breakdown={breakdown}
            activeAxis={axis}
            selectedFacet={facet}
            onSelectAxis={setAxis}
            onSelectFacet={setFacet}
          />
          <ul data-testid="org-vehicle-grid">
            {visibleVehicles.map((v) => (
              <li key={v.vehicle_id} data-testid={`vehicle-row-${v.vehicle_id}`}>
                {v.vehicle_year} {v.vehicle_make} {v.vehicle_model}
              </li>
            ))}
          </ul>
        </div>
      );
    };

    act(() => {
      root!.render(<Harness />);
    });

    const strip = container.querySelector('[data-testid="org-facet-strip"]');
    expect(strip).not.toBeNull();

    // Initially all 4 vehicles are shown
    expect(container.querySelectorAll('[data-testid^="vehicle-row-"]').length).toBe(4);

    // Inline SVG mark is rendered on the C10 series pill
    const c10Pill = container.querySelector(
      '[data-testid="org-facet-pill-C10 (1/2-Ton 2WD)"]',
    ) as HTMLButtonElement | null;
    expect(c10Pill).not.toBeNull();
    expect(c10Pill!.querySelector('svg')).not.toBeNull();

    // Click C10 pill -> filters grid to 2 vehicles
    act(() => {
      c10Pill!.click();
    });
    expect(container.querySelectorAll('[data-testid^="vehicle-row-"]').length).toBe(2);

    // Switch to TRIM axis -> resets active facet filter and shows Cheyenne & Silverado pills
    const trimTab = container.querySelector(
      '[data-testid="org-facet-axis-trim"]',
    ) as HTMLButtonElement | null;
    expect(trimTab).not.toBeNull();
    act(() => {
      trimTab!.click();
    });
    expect(container.querySelectorAll('[data-testid^="vehicle-row-"]').length).toBe(4);

    const silveradoPill = container.querySelector(
      '[data-testid="org-facet-pill-Silverado"]',
    ) as HTMLButtonElement | null;
    expect(silveradoPill).not.toBeNull();
    act(() => {
      silveradoPill!.click();
    });
    expect(container.querySelectorAll('[data-testid^="vehicle-row-"]').length).toBe(1);
    expect(container.querySelector('[data-testid="vehicle-row-v-3"]')).not.toBeNull();
  });
});
