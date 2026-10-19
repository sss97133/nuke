// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => {
  const anything = (): any => new Proxy(function () {}, { get: () => anything(), apply: () => Promise.resolve({ results: [], total: 0 }) });
  return { navigate: vi.fn(), search: vi.fn(), vehicleOps: [] as string[], anything };
});
vi.mock('react-router-dom', () => ({
  useNavigate: () => fixture.navigate,
  useLocation: () => ({ pathname: '/', search: '', state: null }),
}));
vi.mock('../../lib/supabase', () => ({
  getCurrentUserId: () => Promise.resolve(null),
  supabase: {
    rpc: () => Promise.resolve({ data: [], error: null }),
    from: (table: string) => {
      const q: any = new Proxy({}, {
        get: (_t, prop: string) => {
          if (prop === 'then') return (resolve: any, reject: any) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve, reject);
          return (...args: unknown[]) => {
            if (table === 'vehicles') fixture.vehicleOps.push(`${prop}(${args.map(String).join(',')})`);
            return q;
          };
        },
      });
      return q;
    },
  },
}));
vi.mock('../../lib/search/marketScopeResolver', () => ({
  buildMarketScopeUrl: () => '/',
  isOnMarketTab: () => false,
  resolveMarketScopeQuery: () => Promise.resolve(null),
}));
vi.mock('../../services/aiDataIngestion', () => ({ aiDataIngestion: fixture.anything(), ingestVehicle: vi.fn() }));
vi.mock('../../services/dataRouter', () => ({ dataRouter: fixture.anything() }));
vi.mock('../../services/universalSearchService', () => ({ universalSearchService: { search: fixture.search } }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ showToast: vi.fn(), toast: vi.fn() }) }));
vi.mock('./VehicleCritiqueMode', () => ({ default: () => null }));
vi.mock('../SmartInvoiceUploader', () => ({ SmartInvoiceUploader: () => null }));
vi.mock('../../lib/imageOptimizer', () => ({ optimizeImageUrl: (u: string) => u }));
vi.mock('../../styles/unified-design-system.css', () => ({}));
import AIDataIngestionSearch from './AIDataIngestionSearch';

const VEHICLE_RESULTS = [
  {
    id: 'veh-1978-c10',
    type: 'vehicle',
    title: '1978 Chevrolet C10 Silverado',
    relevance_score: 0.9,
    metadata: { year: 1978, make: 'Chevrolet', model: 'C10 Silverado', series: 'C10', trim: 'Silverado', body_style: 'Fleetside' },
  },
  {
    id: 'veh-1965-corvette',
    type: 'vehicle',
    title: '1965 Chevrolet Corvette Sting Ray',
    relevance_score: 0.8,
    metadata: { year: 1965, make: 'Chevrolet', model: 'Corvette Sting Ray', series: 'Sting Ray' },
  },
  {
    id: 'veh-undated',
    type: 'vehicle',
    title: 'Chevrolet Silverado',
    relevance_score: 0.5,
    metadata: { make: 'Chevrolet', model: 'Silverado' },
  },
];

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.navigate.mockReset();
  fixture.search.mockReset();
  fixture.vehicleOps = [];
  fixture.search.mockResolvedValue({ success: true, results: VEHICLE_RESULTS, total_count: 3, query_type: 'text', search_time_ms: 1 });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

async function type(text: string, wait = 0) {
  await act(async () => root.render(<AIDataIngestionSearch />));
  const input = container.querySelector('input[type="text"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  if (wait) await act(async () => { await new Promise((r) => setTimeout(r, wait)); });
  return input;
}

describe('header search market cohort shortcuts', () => {
  it('shows cohort shortcuts as soon as the query is typed, before the search returns, without navigating', async () => {
    await type('FJ40');
    const card = container.querySelector('[data-testid="market-cohort-shortcut-toyota-land-cruiser-fj40"]');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('Toyota Land Cruiser · SERIES: FJ40 / BJ40 (J40)');
    expect(card?.querySelector('svg')).not.toBeNull();
    expect(fixture.navigate).not.toHaveBeenCalled();
  });

  it('navigates to the facet drilldown and clears the box when a shortcut is clicked', async () => {
    const input = await type('FJ40');
    const card = container.querySelector('[data-testid="market-cohort-shortcut-toyota-land-cruiser-fj40"]') as HTMLButtonElement;
    await act(async () => card.click());
    expect(fixture.navigate).toHaveBeenCalledWith('/?make=Toyota&family=Land+Cruiser&axis=series&facet=FJ40+%2F+BJ40+%28J40%29');
    expect(input.value).toBe('');
    expect(container.querySelector('[data-testid="market-cohort-shortcuts-section"]')).toBeNull();
  });

  it('reaches the first shortcut with ArrowDown + Enter', async () => {
    const input = await type('FJ40');
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(container.querySelector('.header-search-cohort--active')).not.toBeNull();
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(fixture.navigate).toHaveBeenCalledWith(expect.stringContaining('/?make=Toyota&family=Land+Cruiser&axis=series'));
  });

  it('shows shortcuts on a make browse query as well', async () => {
    await type('chevy c10');
    expect(container.querySelector('[data-testid="market-cohort-shortcut-chevy-pickup-squarebody-c10"]')).not.toBeNull();
  });

  it('keeps search result rows below the shortcuts once the search returns', async () => {
    await type('1978 chevrolet c10', 400);
    expect(container.querySelector('[data-testid="market-cohort-shortcuts-section"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="header-search-result-veh-1978-c10"]')).not.toBeNull();
  });

  it('shows the edge results without an ilike read of vehicles, even for a facet query', async () => {
    await type('1978 chevrolet c10 stepside', 400);
    expect(container.querySelector('[data-testid="header-search-result-veh-1978-c10"]')).not.toBeNull();
    expect(fixture.vehicleOps.filter((op) => /^(ilike|or)\(/.test(op))).toEqual([]);
  });

  it('shows no shortcuts for a pasted URL', async () => {
    await type('https://bringatrailer.com/listing/1978-chevrolet-c10');
    expect(container.querySelector('[data-testid="market-cohort-shortcuts-section"]')).toBeNull();
  });
});

describe('header search result era marks', () => {
  it('renders the vetted era mark with provenance on dated vehicle rows and none on undated rows', async () => {
    await type('blue chevy', 400);

    const c10Mark = container.querySelector('[data-testid="header-search-result-era-mark-veh-1978-c10"]') as HTMLElement;
    expect(c10Mark).not.toBeNull();
    expect(c10Mark.getAttribute('data-mark-id')).toBe('chevy-silverado-10-75-80');
    expect(c10Mark.innerHTML).toContain('<svg');
    expect(c10Mark.getAttribute('title')).toContain('Silverado 10');

    const corvetteMark = container.querySelector('[data-testid="header-search-result-era-mark-veh-1965-corvette"]') as HTMLElement;
    expect(corvetteMark?.getAttribute('data-mark-id')).toBe('corvette-c2-sting-ray-63-67');

    expect(container.querySelector('[data-testid="header-search-result-veh-undated"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="header-search-result-era-mark-veh-undated"]')).toBeNull();

    const c10Row = container.querySelector('[data-testid="header-search-result-veh-1978-c10"]') as HTMLElement;
    expect(c10Row.querySelectorAll('[data-testid="header-search-facet-emblem"]').length).toBe(0);
    expect(c10Row.querySelector('[data-testid="header-search-facet-trim"]')?.textContent).toContain('Silverado');
  });
});
