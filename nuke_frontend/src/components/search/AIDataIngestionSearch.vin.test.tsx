// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => {
  const anything = (): any => new Proxy(function () {}, { get: () => anything(), apply: () => Promise.resolve({ results: [], total: 0 }) });
  return { rpc: vi.fn(), ops: [] as { op: string; args: unknown[] }[], rows: [] as any[], count: 0, anything };
});
const anything = fixture.anything;
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useLocation: () => ({ pathname: '/', search: '', state: null }) }));
vi.mock('../../lib/supabase', () => ({
  getCurrentUserId: () => Promise.resolve(null),
  supabase: {
    rpc: (...args: unknown[]) => fixture.rpc(...args),
    from: (table: string) => {
      fixture.ops.push({ op: 'from', args: [table] });
      const q: any = new Proxy({}, {
        get: (_t, prop: string) => {
          if (prop === 'then') return (resolve: any, reject: any) => Promise.resolve({ data: fixture.rows, error: null, count: fixture.count }).then(resolve, reject);
          return (...args: unknown[]) => { fixture.ops.push({ op: prop, args }); return q; };
        },
      });
      return q;
    },
  },
}));
vi.mock('../../services/aiDataIngestion', () => ({ aiDataIngestion: fixture.anything(), ingestVehicle: vi.fn() }));
vi.mock('../../services/dataRouter', () => ({ dataRouter: fixture.anything() }));
vi.mock('../../services/universalSearchService', () => ({ universalSearchService: fixture.anything() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ showToast: vi.fn(), toast: vi.fn() }) }));
vi.mock('./VehicleCritiqueMode', () => ({ default: () => null }));
vi.mock('../SmartInvoiceUploader', () => ({ SmartInvoiceUploader: () => null }));
vi.mock('../../lib/imageOptimizer', () => ({ optimizeImageUrl: (u: string) => u }));
vi.mock('../../styles/unified-design-system.css', () => ({}));
import AIDataIngestionSearch from './AIDataIngestionSearch';

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.rpc.mockReset(); fixture.ops.length = 0; fixture.rows = []; fixture.count = 0;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function type(text: string, wait = 20) {
  await act(async () => root.render(<AIDataIngestionSearch />));
  const input = container.querySelector('input[type="text"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, wait)); });
}

describe('AIDataIngestionSearch VIN check', () => {
  it('reads the public vehicle a VIN names through vehicle_by_vin_public, never vin ilike', async () => {
    fixture.rpc.mockResolvedValue({ data: [{ id: 'v1', year: 1984, make: 'Chevrolet', model: 'K5 Blazer' }], error: null });
    await type('1gcek14k8ej123456');
    expect(fixture.rpc).toHaveBeenCalledWith('vehicle_by_vin_public', { p_vin: '1GCEK14K8EJ123456' });
    expect(fixture.ops.some((o) => o.op === 'ilike')).toBe(false);
    expect(container.textContent).toContain('1984 Chevrolet K5 Blazer');
  });
  it('offers to decode a VIN that no public vehicle carries', async () => {
    fixture.rpc.mockResolvedValue({ data: [], error: null });
    await type('1GCEK14K8EJ123457');
    expect(container.textContent).toContain('Not in database');
  });
});

describe('AIDataIngestionSearch make browse card', () => {
  it('reads the make by its canonical spelling with equality, never make ilike', async () => {
    fixture.rows = [{ model: 'Mustang' }];
    await type('ford', 450);
    const makeFilters = fixture.ops.filter((o) => o.op === 'eq' && o.args[0] === 'make').map((o) => o.args[1]);
    expect(makeFilters).toEqual(['Ford', 'Ford', 'Ford']);
    expect(fixture.ops.some((o) => o.op === 'ilike')).toBe(false);
  });

  it('asks for an estimated count and labels a planner estimate as approximate', async () => {
    fixture.rows = [{ model: '911' }];
    fixture.count = 50809;
    await type('porsche', 450);
    const countSelect = fixture.ops.find((o) => o.op === 'select' && o.args[0] === 'id');
    expect(countSelect?.args[1]).toEqual({ count: 'estimated', head: true });
    expect(container.textContent).toContain('≈51,000 VEHICLES');
    expect(container.textContent).not.toContain('50,809');
  });

  it('shows a count at or below max-rows as exact', async () => {
    fixture.rows = [{ model: 'Pantera' }];
    fixture.count = 11;
    await type('lotus', 450);
    expect(container.textContent).toContain('11 VEHICLES');
    expect(container.textContent).not.toContain('≈');
  });
});
