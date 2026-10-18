// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveSearchResultFacets, HeaderSearchFacetPills } from './HeaderSearch';
import { SearchOverlay } from './layout/SearchOverlay';

describe('HeaderSearch facet classification & period-exact emblems', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('derives orthogonal Series, Trim, and Body Style facets and period-exact SVG badges for Squarebody Chevrolet pickups', () => {
    const k10CheyenneSuper1973 = deriveSearchResultFacets({
      title: '1973 Chevrolet K10 Cheyenne Super Stepside',
    });
    expect(k10CheyenneSuper1973.year).toBe(1973);
    expect(k10CheyenneSuper1973.make).toBe('Chevrolet');
    expect(k10CheyenneSuper1973.familyLabel).toBe('Pickup');
    expect(k10CheyenneSuper1973.series).toBe('K10 (1/2-Ton 4x4)');
    expect(k10CheyenneSuper1973.trim).toBe('Cheyenne Super');
    expect(k10CheyenneSuper1973.body).toBe('Stepside / Flareside');
    expect(k10CheyenneSuper1973.badgeSvg).toContain('CHEYENNE');
    expect(k10CheyenneSuper1973.badgeSvg).toContain('SUPER');

    // 1978 Round-Eye Silverado ('75-'80 script badge) vs 1985 Slant-Nose Silverado ('81-'87 block badge)
    const c10Silverado1978 = deriveSearchResultFacets({
      year: 1978,
      make: 'Chevrolet',
      model: 'C10',
      trim: 'Silverado',
      bodyStyle: 'Fleetside',
    });
    expect(c10Silverado1978.series).toBe('C10 (1/2-Ton 2WD)');
    expect(c10Silverado1978.trim).toBe('Silverado');
    expect(c10Silverado1978.body).toBe('Fleetside / Styleside');
    expect(c10Silverado1978.badgeSvg).toContain('>Silverado<');

    const c10Silverado1985 = deriveSearchResultFacets({
      year: 1985,
      make: 'Chevrolet',
      model: 'C10 Silverado Short Bed',
    });
    expect(c10Silverado1985.series).toBe('C10 (1/2-Ton 2WD)');
    expect(c10Silverado1985.trim).toBe('Silverado');
    expect(c10Silverado1985.body).toBe('Short Bed (SWB)');
    expect(c10Silverado1985.badgeSvg).toContain('>SILVERADO<');
    expect(c10Silverado1985.badgeSvg).not.toBe(c10Silverado1978.badgeSvg);
  });

  it('distinguishes GMC 1973-1974 two-digit SIERRA 15 from 1975-1987 four-digit SIERRA GRANDE 1500', () => {
    const gmc1974 = deriveSearchResultFacets({
      title: '1974 GMC C1500 Sierra Fleetside',
    });
    expect(gmc1974.make).toBe('GMC');
    expect(gmc1974.trim).toBe('Sierra');
    expect(gmc1974.badgeSvg).toContain('>15<');

    const gmc1979 = deriveSearchResultFacets({
      title: '1979 GMC K1500 Sierra Grande Short Bed',
    });
    expect(gmc1979.make).toBe('GMC');
    expect(gmc1979.series).toBe('K1500 (1/2-Ton 4x4)');
    expect(gmc1979.trim).toBe('Sierra Grande');
    expect(gmc1979.body).toBe('Short Bed (SWB)');
    expect(gmc1979.badgeSvg).toContain('SIERRA');
    expect(gmc1979.badgeSvg).toContain('GRANDE');
    expect(gmc1979.badgeSvg).toContain('1500');
  });

  it('derives Ford Mustang, Chevrolet Corvette C2/C3, Porsche 911 Targa, Dodge R/T, and Mercedes 300SL facets and badges', () => {
    const mach1 = deriveSearchResultFacets({
      title: '1969 Ford Mustang Mach 1 Fastback',
    });
    expect(mach1.series).toBe('Mach 1');
    expect(mach1.body).toBe('Fastback');
    expect(mach1.badgeSvg).toContain('MACH 1');

    const splitWindow = deriveSearchResultFacets({
      title: '1963 Chevrolet Corvette Sting Ray Coupe',
    });
    expect(splitWindow.series).toBe('Sting Ray (C2)');
    expect(splitWindow.body).toBe('Split-Window Coupe');
    expect(splitWindow.badgeSvg).toContain('Sting Ray');

    const targa = deriveSearchResultFacets({
      title: '1973 Porsche 911 Carrera RS Targa',
    });
    expect(targa.series).toBe('Carrera RS');
    expect(targa.body).toBe('Targa / T-Top');
    expect(targa.badgeSvg).toContain('targa');

    const chargerRt = deriveSearchResultFacets({
      title: '1968 Dodge Charger R/T 426 Hemi Hardtop',
    });
    expect(chargerRt.series).toBe('R/T (Road/Track)');
    expect(chargerRt.trim).toBe('R/T (Road/Track)');
    expect(chargerRt.body).toBe('Coupe / Hardtop');
    expect(chargerRt.badgeSvg).toContain('R/T');

    const gullwing = deriveSearchResultFacets({
      title: '1955 Mercedes-Benz 300SL Gullwing Coupe',
    });
    expect(gullwing.series).toBe('300SL (W198)');
    expect(gullwing.body).toBe('Gullwing Coupe');
    expect(gullwing.badgeSvg).toContain('300 SL');
  });

  it('renders HeaderSearchFacetPills with SERIES, TRIM, BODY pills and SVG emblem', async () => {
    await act(async () => {
      root.render(
        <HeaderSearchFacetPills
          year={1974}
          make="Chevrolet"
          model="K10"
          trim="Cheyenne Super"
          bodyStyle="Stepside"
        />,
      );
    });

    const facetsEl = container.querySelector('[data-testid="header-search-facets"]');
    const emblemEl = container.querySelector('[data-testid="header-search-facet-emblem"]');
    const seriesEl = container.querySelector('[data-testid="header-search-facet-series"]');
    const trimEl = container.querySelector('[data-testid="header-search-facet-trim"]');
    const bodyEl = container.querySelector('[data-testid="header-search-facet-body"]');

    expect(facetsEl).not.toBeNull();
    expect(emblemEl?.innerHTML).toContain('CHEYENNE');
    expect(seriesEl?.textContent).toContain('SERIES');
    expect(seriesEl?.textContent).toContain('K10 (1/2-Ton 4x4)');
    expect(trimEl?.textContent).toContain('TRIM');
    expect(trimEl?.textContent).toContain('Cheyenne Super');
    expect(bodyEl?.textContent).toContain('BODY');
    expect(bodyEl?.textContent).toContain('Stepside / Flareside');
  });

  it('renders period-exact facet pills inside SearchOverlay vehicle and model suggestions', async () => {
    await act(async () => {
      root.render(
        <SearchOverlay
          isOpen={true}
          onClose={vi.fn()}
          autocompleteResults={[
            {
              category: 'vehicle',
              value: 'veh-1',
              label: '1978 Chevrolet C10 Silverado Stepside',
              count: 1,
            },
          ]}
          autocompleteLoading={false}
          compsData={null}
          recentItems={[]}
          onSelect={vi.fn()}
          onRecentSelect={vi.fn()}
          onRecentRemove={vi.fn()}
          onRecentClear={vi.fn()}
          query="1978 c10 silverado"
        />,
      );
    });

    const seriesEl = container.querySelector('[data-testid="header-search-facet-series"]');
    const trimEl = container.querySelector('[data-testid="header-search-facet-trim"]');
    const bodyEl = container.querySelector('[data-testid="header-search-facet-body"]');
    const emblemEl = container.querySelector('[data-testid="header-search-facet-emblem"]');

    expect(seriesEl?.textContent).toContain('C10 (1/2-Ton 2WD)');
    expect(trimEl?.textContent).toContain('Silverado');
    expect(bodyEl?.textContent).toContain('Stepside / Flareside');
    expect(emblemEl?.innerHTML).toContain('Silverado');
  });
});
