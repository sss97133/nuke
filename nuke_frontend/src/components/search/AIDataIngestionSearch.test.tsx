// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), getUser: vi.fn(), ingest: vi.fn(), extract: vi.fn(),
  lookup: { data: [{ id: 'recorded-vehicle' }], error: null } as any,
  queries: [] as Array<{ fields: string; filters: Array<[string, ...unknown[]]> }>,
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/' }),
}));
vi.mock('../../lib/supabase', () => ({
  getCurrentUserId: mocks.getUser,
  supabase: {
    from: () => {
      const query = { fields: '', filters: [] as Array<[string, ...unknown[]]> };
      mocks.queries.push(query);
      const builder: any = {
        select: (fields: string) => { query.fields = fields; return builder; },
        limit: () => Promise.resolve(query.fields.includes('deleted_at') ? mocks.lookup : { data: [], error: null }),
      };
      for (const method of ['is', 'ilike', 'in', 'eq', 'or']) {
        builder[method] = (...args: unknown[]) => { query.filters.push([method, ...args]); return builder; };
      }
      return builder;
    },
  },
}));
vi.mock('../../services/aiDataIngestion', () => ({
  aiDataIngestion: { extractData: mocks.extract }, ingestVehicle: mocks.ingest,
}));
vi.mock('../../services/dataRouter', () => ({ dataRouter: {} }));
vi.mock('../../services/universalSearchService', () => ({
  universalSearchService: { search: vi.fn().mockResolvedValue({ results: [], total_count: 0 }) },
}));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('./VehicleCritiqueMode', () => ({ default: () => null }));
vi.mock('../SmartInvoiceUploader', () => ({ SmartInvoiceUploader: () => null }));

import AIDataIngestionSearch from './AIDataIngestionSearch';

describe('public exact lookup through the search input', () => {
  let host: HTMLDivElement;
  let root: Root;
  const input = () => host.querySelector('input[type="text"]') as HTMLInputElement;

  async function type(text: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), text);
      input().dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  async function enter() {
    await act(async () => {
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
  }
  async function paste(text: string) {
    await act(async () => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { getData: () => text, items: [] } });
      input().dispatchEvent(event);
    });
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.queries.length = 0;
    mocks.lookup = { data: [{ id: 'recorded-vehicle' }], error: null };
    mocks.getUser.mockResolvedValue(null);
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<AIDataIngestionSearch />));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it('Enter opens a recorded VIN anonymously without creating or enriching anything', async () => {
    await type('wdbsk75f03f029278');
    await enter();
    expect(mocks.navigate).toHaveBeenCalledWith('/vehicle/recorded-vehicle');
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.ingest).not.toHaveBeenCalled();
    expect(mocks.extract).not.toHaveBeenCalled();
    const lookup = mocks.queries.find(q => q.fields.includes('deleted_at'))!;
    expect(lookup.filters).toContainEqual(['ilike', 'vin', 'WDBSK75F03F029278']);
    expect(lookup.fields).toContain('merged_into_vehicle_id');
    expect(lookup.filters).not.toContainEqual(['is', 'deleted_at', null]);
  });

  it('opens an existing BaT listing URL with tracking parameters and a fragment', async () => {
    await type('https://www.bringatrailer.com/listing/2003-mercedes-benz-sl500-418/?utm_source=share#comments');
    await enter();
    expect(mocks.navigate).toHaveBeenCalledWith('/vehicle/recorded-vehicle');
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.ingest).not.toHaveBeenCalled();
    const urls = mocks.queries.find(q => q.fields.includes('deleted_at'))!.filters.find(f => f[0] === 'in')![2];
    expect(urls).toContain('https://bringatrailer.com/listing/2003-mercedes-benz-sl500-418');
    expect(urls).toContain('https://bringatrailer.com/listing/2003-mercedes-benz-sl500-418/');
  });

  it('does not discard identity-bearing query parameters on other platforms', async () => {
    await type('https://example.com/vehicle/view?id=123#photos');
    await enter();
    const urls = mocks.queries.find(q => q.fields.includes('deleted_at'))!.filters.find(f => f[0] === 'in')![2] as string[];
    expect(urls).toContain('https://example.com/vehicle/view?id=123');
    expect(urls).not.toContain('https://example.com/vehicle/view');
  });

  it('keeps an unrecorded VIN behind the existing sign-in gate for ingestion', async () => {
    mocks.lookup = { data: [], error: null };
    await type('WDBSK75F03F029278');
    await enter();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('Please log in to use this feature');
    expect(mocks.ingest).not.toHaveBeenCalled();
  });

  it('a failed read does not proceed to ingestion', async () => {
    mocks.lookup = { data: null, error: { message: 'unavailable' } };
    await type('WDBSK75F03F029278');
    await enter();
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.ingest).not.toHaveBeenCalled();
    expect(mocks.extract).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Could not check for an existing vehicle');
  });

  it('pasting a listing prepares it; Enter opens the recorded vehicle without ingestion', async () => {
    await paste('bringatrailer.com/listing/2003-mercedes-benz-sl500-418/');
    expect(input().value).toBe('https://bringatrailer.com/listing/2003-mercedes-benz-sl500-418/');
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.ingest).not.toHaveBeenCalled();
    expect(mocks.queries.filter(q => q.fields.includes('deleted_at'))).toHaveLength(0);
    await enter();
    expect(mocks.navigate).toHaveBeenCalledWith('/vehicle/recorded-vehicle');
    expect(mocks.ingest).not.toHaveBeenCalled();
  });

  it('pasting an organization URL does not create an organization', async () => {
    await paste('example.com');
    expect(input().value).toBe('https://example.com');
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.ingest).not.toHaveBeenCalled();
  });

  it('does not open or ingest a retired VIN record', async () => {
    mocks.lookup = { data: [{ id: 'old-record', merged_into_vehicle_id: 'current-record' }], error: null };
    await type('WDBSK75F03F029278');
    await enter();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(host.textContent).toContain('This vehicle record has been retired');
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.ingest).not.toHaveBeenCalled();
  });
});
