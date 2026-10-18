// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc,
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../hooks/usePageTitle', () => ({ usePageTitle: () => {} }));
vi.mock('../hooks/useInterests', () => ({ useInterests: () => ({ recordInterest: () => {} }) }));

import {
  applyDrillStackToSearchParams,
  drillStackFromSearchParams,
  TreemapHomePage,
} from './HomePage';

function UrlProbe({ onSearch }: { onSearch: (search: string) => void }) {
  const loc = useLocation();
  React.useEffect(() => {
    onSearch(loc.search);
  }, [loc.search, onSearch]);
  return <div data-testid="location-search">{loc.search}</div>;
}

describe('HomePage facet axis & selected facet URL synchronization', () => {
  it('syncs activeFacetAxis and selectedFacetValue into ?axis=...&facet=... and clears them on raw or family change', () => {
    const familyStack = [
      { label: 'ALL MAKES' },
      { label: 'Chevrolet', make: 'Chevrolet' },
      { label: 'Pickup', make: 'Chevrolet', family: 'Pickup', names: 48 },
    ];

    // Selecting TRIM axis at family level sets ?axis=trim without ?facet
    const atTrimAxis = applyDrillStackToSearchParams(new URLSearchParams('make=Chevrolet&family=Pickup'), familyStack, 'trim');
    expect(atTrimAxis.get('make')).toBe('Chevrolet');
    expect(atTrimAxis.get('family')).toBe('Pickup');
    expect(atTrimAxis.get('axis')).toBe('trim');
    expect(atTrimAxis.get('facet')).toBeNull();
    expect(atTrimAxis.get('model')).toBeNull();

    // Selecting a facet tile or pill (e.g. Silverado) sets ?axis=trim&facet=Silverado and omits ?model
    const silveradoStack = [
      ...familyStack,
      { label: 'Silverado', make: 'Chevrolet', family: 'Pickup', model: 'Silverado' },
    ];
    const atSilverado = applyDrillStackToSearchParams(atTrimAxis, silveradoStack, 'trim');
    expect(atSilverado.get('axis')).toBe('trim');
    expect(atSilverado.get('facet')).toBe('Silverado');
    expect(atSilverado.get('model')).toBeNull();

    // Drilling further into a year under a facet preserves ?axis=trim&facet=Silverado&year=1978
    const silveradoYearStack = [
      ...silveradoStack,
      { label: '1978', make: 'Chevrolet', family: 'Pickup', model: 'Silverado', year: 1978 },
    ];
    const atSilveradoYear = applyDrillStackToSearchParams(atSilverado, silveradoYearStack, 'trim');
    expect(atSilveradoYear.get('axis')).toBe('trim');
    expect(atSilveradoYear.get('facet')).toBe('Silverado');
    expect(atSilveradoYear.get('year')).toBe('1978');
    expect(atSilveradoYear.get('model')).toBeNull();

    // Restoring drillStack from ?make=Chevrolet&family=Pickup&axis=trim&facet=Silverado&year=1978 round-trips cleanly
    const restored = drillStackFromSearchParams(
      atSilveradoYear,
      [{ name: 'Chevrolet', count: 18500, value: 890_000_000 }],
      [{ name: 'Pickup', count: 3200, value: 145_000_000, familyKey: 'Pickup', models: 48 }],
    );
    expect(restored).toEqual(silveradoYearStack);

    // Switching back to 'raw' axis clears ?axis and ?facet
    const backToRaw = applyDrillStackToSearchParams(atSilverado, familyStack, 'raw');
    expect(backToRaw.get('axis')).toBeNull();
    expect(backToRaw.get('facet')).toBeNull();
    expect(backToRaw.get('model')).toBeNull();

    // Switching to another family clears stale ?axis and ?facet
    const corvetteStack = [
      { label: 'ALL MAKES' },
      { label: 'Chevrolet', make: 'Chevrolet' },
      { label: 'Corvette', make: 'Chevrolet', family: 'Corvette', names: 32 },
    ];
    const switchedFamily = applyDrillStackToSearchParams(atSilverado, corvetteStack, 'trim');
    expect(switchedFamily.get('family')).toBe('Corvette');
    expect(switchedFamily.get('axis')).toBeNull();
    expect(switchedFamily.get('facet')).toBeNull();
  });

  it('updates URL query params (?axis=...&facet=...) when clicking the 4-way axis tabs and facet pills in TreemapHomePage', async () => {
    rpc.mockImplementation(async (fnName: string) => {
      if (fnName === 'treemap_by_brand') {
        return {
          data: [{ name: 'Chevrolet', count: 18500, value: 890_000_000, median_price: 42_000 }],
          error: null,
        };
      }
      if (fnName === 'treemap_brand_market') {
        return {
          data: [{ name: 'Chevrolet', usd: 890_000_000, sold_any: 18500, offered: 22000, dated: 16000, sold_12m: 2400, sold_prior_12m: 2100 }],
          error: null,
        };
      }
      if (fnName === 'treemap_brand_families') {
        return {
          data: [{ family_key: 'Pickup', family_name: 'Pickup', models: 12, sold: 1580, usd: 72_000_000, sold_any: 1580, offered: 1900, dated: 1400, sold_12m: 310, sold_prior_12m: 275 }],
          error: null,
        };
      }
      if (fnName === 'treemap_family_models') {
        return {
          data: [
            { model: 'C10 Silverado', sold: 420, usd: 19_320_000, sold_any: 420, offered: 480, dated: 390, sold_12m: 96, sold_prior_12m: 80 },
            { model: 'K10 Cheyenne Super', sold: 180, usd: 9_900_000, sold_any: 180, offered: 210, dated: 165, sold_12m: 44, sold_prior_12m: 38 },
            { model: '3100 5-Window Pickup', sold: 260, usd: 11_700_000, sold_any: 260, offered: 300, dated: 240, sold_12m: 55, sold_prior_12m: 50 },
          ],
          error: null,
        };
      }
      if (fnName === 'treemap_family_sales') {
        return { data: [], error: null };
      }
      return { data: [], error: null };
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let latestSearch = '';

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/?make=Chevrolet&family=Pickup']}>
          <UrlProbe onSearch={(s) => { latestSearch = s; }} />
          <TreemapHomePage embedded onBrowse={() => {}} />
        </MemoryRouter>,
      );
    });

    // Wait for async RPC hooks to resolve
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    const trimTab = host.querySelector('[data-testid="facet-axis-trim"]') as HTMLButtonElement | null;
    expect(trimTab).not.toBeNull();

    // 1. Click TRIM axis tab -> URL gets ?axis=trim
    await act(async () => {
      trimTab!.click();
    });
    const paramsAfterAxis = new URLSearchParams(latestSearch);
    expect(paramsAfterAxis.get('make')).toBe('Chevrolet');
    expect(paramsAfterAxis.get('family')).toBe('Pickup');
    expect(paramsAfterAxis.get('axis')).toBe('trim');
    expect(paramsAfterAxis.get('facet')).toBeNull();

    // 2. Click Silverado facet pill -> URL gets ?axis=trim&facet=Silverado
    const silveradoPill = host.querySelector('[data-facet-pill="Silverado"]') as HTMLButtonElement | null;
    expect(silveradoPill).not.toBeNull();
    await act(async () => {
      silveradoPill!.click();
    });
    const paramsAfterFacet = new URLSearchParams(latestSearch);
    expect(paramsAfterFacet.get('axis')).toBe('trim');
    expect(paramsAfterFacet.get('facet')).toBe('Silverado');
    expect(paramsAfterFacet.get('model')).toBeNull();

    // 3. Click SERIES axis tab while a facet is active -> resets active facet and updates ?axis=series without stale ?facet
    const seriesTab = host.querySelector('[data-testid="facet-axis-series"]') as HTMLButtonElement | null;
    expect(seriesTab).not.toBeNull();
    await act(async () => {
      seriesTab!.click();
    });
    const paramsAfterSeriesSwitch = new URLSearchParams(latestSearch);
    expect(paramsAfterSeriesSwitch.get('axis')).toBe('series');
    expect(paramsAfterSeriesSwitch.get('facet')).toBeNull();

    // 4. Click C10 (1/2-Ton 2WD) series pill -> URL gets ?axis=series&facet=C10 (1/2-Ton 2WD)
    const c10Pill = host.querySelector('[data-facet-pill="C10 (1/2-Ton 2WD)"]') as HTMLButtonElement | null;
    expect(c10Pill).not.toBeNull();
    await act(async () => {
      c10Pill!.click();
    });
    const paramsAfterSeriesFacet = new URLSearchParams(latestSearch);
    expect(paramsAfterSeriesFacet.get('axis')).toBe('series');
    expect(paramsAfterSeriesFacet.get('facet')).toBe('C10 (1/2-Ton 2WD)');

    // 5. Click SUB-MODELS (raw) tab -> clears ?axis and ?facet
    const rawTab = host.querySelector('[data-testid="facet-axis-raw"]') as HTMLButtonElement | null;
    expect(rawTab).not.toBeNull();
    await act(async () => {
      rawTab!.click();
    });
    const paramsAfterRaw = new URLSearchParams(latestSearch);
    expect(paramsAfterRaw.get('axis')).toBeNull();
    expect(paramsAfterRaw.get('facet')).toBeNull();

    act(() => root.unmount());
    host.remove();
  });
});
