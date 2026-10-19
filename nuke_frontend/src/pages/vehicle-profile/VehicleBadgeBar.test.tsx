// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigateMock = vi.hoisted(() => vi.fn());
const fixture = vi.hoisted(() => ({
  vehicle: {} as Record<string, unknown>,
  auctionPulse: null as Record<string, unknown> | null,
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('./VehicleProfileContext', () => ({
  useVehicleProfile: () => ({
    vehicle: fixture.vehicle,
    vehicleId: fixture.vehicle.id,
    canEdit: false,
    isVerifiedOwner: false,
    isMobile: false,
    setGalleryFilter: vi.fn(),
    auctionPulse: fixture.auctionPulse,
  }),
}));

vi.mock('../../hooks/useAuctionComments', () => ({
  useAuctionCommentStats: () => ({ data: { commentCount: 0 } }),
}));
vi.mock('../../components/popups/CommentsPopup', () => ({ CommentsPopup: () => null }));
vi.mock('../../components/popups/BidsPopup', () => ({ BidsPopup: () => null }));
vi.mock('../../components/popups/WatchersPopup', () => ({ WatchersPopup: () => null }));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: null, loading: false }),
}));
vi.mock('../../hooks/useVehiclesDashboard', () => ({
  useVehiclesDashboard: () => ({ vehicles: [], isLoading: false }),
}));
vi.mock('../market/SourcesBoard', () => ({ default: () => null }));
vi.mock('../market/MarketInventory', () => ({ default: () => null }));

const rpcMock = vi.hoisted(() => vi.fn());
vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: rpcMock,
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
}));

import VehicleBadgeBar, {
  buildFacetDrilldownUrl,
  resolveIdentityMarkFacetTarget,
  resolveVehicleMarketFamily,
} from './VehicleBadgeBar';
import HomePage from '../HomePage';
import { classifyVehicleFacets, resolveVettedIdentityMarks } from '../familyFacetsAndEmblems';

describe('VehicleBadgeBar facet chips & era identity mark drilldown links', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    rpcMock.mockImplementation(async (fnName: string) => {
      if (fnName === 'treemap_by_brand') {
        return {
          data: [
            { name: 'Chevrolet', count: 18500, value: 890000000, median_price: 42000 },
            { name: 'Ford', count: 29489, value: 1479400000, median_price: 46000 },
          ],
          error: null,
        };
      }
      if (fnName === 'treemap_brand_families') {
        return {
          data: [
            { name: 'Pickup', family_key: 'Pickup', count: 3200, value: 145000000, models: 48 },
            { name: 'Corvette', family_key: 'Corvette', count: 5100, value: 380000000, models: 64 },
            { name: 'Mustang', family_key: 'Mustang', count: 6400, value: 390000000, models: 55 },
          ],
          error: null,
        };
      }
      if (fnName === 'treemap_family_models') {
        return {
          data: [
            { name: 'C10 Cheyenne Fleetside Short Bed', count: 85, value: 3800000, median_price: 44000 },
            { name: 'K10 Silverado Stepside Short Bed', count: 64, value: 3100000, median_price: 48000 },
            { name: 'C20 Custom Deluxe Long Bed', count: 42, value: 1600000, median_price: 36000 },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it('resolves canonical Market HomePage families for pickups and distinct model lines', () => {
    expect(
      resolveVehicleMarketFamily({
        make: 'Chevrolet',
        model: 'C10 Cheyenne Short Bed',
        normalized_model: 'C10',
      }),
    ).toBe('Pickup');
    expect(
      resolveVehicleMarketFamily({
        make: 'Chevrolet',
        model: 'K5 Blazer Cheyenne',
        normalized_model: 'K5 Blazer',
      }),
    ).toBe('Blazer');
    expect(
      resolveVehicleMarketFamily({
        make: 'Ford',
        model: 'Mustang Mach 1 Fastback',
        normalized_model: 'Mustang',
      }),
    ).toBe('Mustang');
  });

  it('renders SERIES, TRIM, and BODY chips and era identity marks as clickable links that navigate to Market HomePage', async () => {
    fixture.vehicle = {
      id: 'veh-c10-cheyenne-1976',
      year: 1976,
      make: 'Chevrolet',
      model: 'C10 Cheyenne Fleetside Short Bed',
      normalized_model: 'C10',
      series: 'C10',
      trim: 'Cheyenne',
      body_style: 'Fleetside Short Bed',
      listing_title: '1976 Chevrolet C10 Cheyenne Fleetside Short Bed',
    };

    await act(async () => {
      root.render(<VehicleBadgeBar />);
    });

    const seriesChip = host.querySelector<HTMLAnchorElement>('[data-testid="vehicle-facet-series"]');
    const trimChip = host.querySelector<HTMLAnchorElement>('[data-testid="vehicle-facet-trim"]');
    const bodyChip = host.querySelector<HTMLAnchorElement>('[data-testid="vehicle-facet-body"]');

    expect(seriesChip).not.toBeNull();
    expect(trimChip).not.toBeNull();
    expect(bodyChip).not.toBeNull();

    const expectedSeriesUrl = buildFacetDrilldownUrl({
      make: 'Chevrolet',
      family: 'Pickup',
      axis: 'series',
      facet: 'C10 (1/2-Ton 2WD)',
    });
    const expectedTrimUrl = buildFacetDrilldownUrl({
      make: 'Chevrolet',
      family: 'Pickup',
      axis: 'trim',
      facet: 'Cheyenne',
    });
    const expectedBodyUrl = buildFacetDrilldownUrl({
      make: 'Chevrolet',
      family: 'Pickup',
      axis: 'body',
      facet: 'Fleetside / Styleside',
    });

    expect(seriesChip?.getAttribute('href')).toBe(expectedSeriesUrl);
    expect(trimChip?.getAttribute('href')).toBe(expectedTrimUrl);
    expect(bodyChip?.getAttribute('href')).toBe(expectedBodyUrl);

    await act(async () => {
      seriesChip!.click();
    });
    expect(navigateMock).toHaveBeenLastCalledWith(expectedSeriesUrl);

    await act(async () => {
      trimChip!.click();
    });
    expect(navigateMock).toHaveBeenLastCalledWith(expectedTrimUrl);

    await act(async () => {
      bodyChip!.click();
    });
    expect(navigateMock).toHaveBeenLastCalledWith(expectedBodyUrl);

    // Era identity mark badges also navigate to the corresponding family + axis + facet pill
    const cheyenneMark = host.querySelector<HTMLAnchorElement>(
      '[data-testid="vehicle-identity-mark-chevy-cheyenne-10-73-81"]',
    );
    expect(cheyenneMark).not.toBeNull();
    expect(cheyenneMark?.getAttribute('href')).toBe(expectedTrimUrl);

    await act(async () => {
      cheyenneMark!.click();
    });
    expect(navigateMock).toHaveBeenLastCalledWith(expectedTrimUrl);
  });

  it('pre-selects the exact family, facet axis tab, and facet pill on HomePage when navigating from a VehicleBadgeBar chip URL', async () => {
    const facets = classifyVehicleFacets(
      'Chevrolet',
      'Pickup',
      'C10 Cheyenne Fleetside Short Bed',
      1976,
    );
    const marks = resolveVettedIdentityMarks({
      make: 'Chevrolet',
      familyLabel: 'Pickup',
      model: 'C10 Cheyenne Fleetside Short Bed',
      year: 1976,
    });
    const cheyenneMark = marks.find((m) => m.id === 'chevy-cheyenne-10-73-81')!;
    const markTarget = resolveIdentityMarkFacetTarget(
      cheyenneMark,
      facets,
      'Chevrolet',
      'Pickup',
      1976,
    );
    const targetUrl = buildFacetDrilldownUrl({
      make: 'Chevrolet',
      family: markTarget.family,
      axis: markTarget.axis,
      facet: markTarget.facet,
    });

    expect(targetUrl).toBe('/?make=Chevrolet&family=Pickup&axis=trim&facet=Cheyenne');

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[targetUrl]}>
          <HomePage />
        </MemoryRouter>,
      );
    });

    // Wait a tick for async RPC mocks to settle
    await act(async () => {
      await Promise.resolve();
    });

    const trimAxisTab = host.querySelector<HTMLButtonElement>('[data-testid="facet-axis-trim"]');
    expect(trimAxisTab).not.toBeNull();
    expect(trimAxisTab?.getAttribute('aria-selected')).toBe('true');

    const cheyennePill = host.querySelector<HTMLButtonElement>('[data-facet-pill="Cheyenne"]');
    expect(cheyennePill).not.toBeNull();
    expect(cheyennePill?.getAttribute('aria-pressed')).toBe('true');
  });

  it('pre-selects SERIES and BODY facet axes and pills on HomePage when navigating from SERIES or BODY chips', async () => {
    const seriesUrl = buildFacetDrilldownUrl({
      make: 'Chevrolet',
      family: 'Pickup',
      axis: 'series',
      facet: 'C10 (1/2-Ton 2WD)',
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[seriesUrl]}>
          <HomePage />
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    const seriesAxisTab = host.querySelector<HTMLButtonElement>('[data-testid="facet-axis-series"]');
    expect(seriesAxisTab).not.toBeNull();
    expect(seriesAxisTab?.getAttribute('aria-selected')).toBe('true');

    const c10Pill = host.querySelector<HTMLButtonElement>('[data-facet-pill="C10 (1/2-Ton 2WD)"]');
    expect(c10Pill).not.toBeNull();
    expect(c10Pill?.getAttribute('aria-pressed')).toBe('true');
  });
});
