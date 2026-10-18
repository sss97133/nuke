// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ ops: [] as { op: string; args: unknown[] }[] }));
vi.mock('react-router-dom', () => ({ Link: ({ children }: any) => children }));
vi.mock('../VehicleThumbnail', () => ({ default: () => null }));
vi.mock('../../styles/unified-design-system.css', () => ({}));
vi.mock('../../lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    fixture.ops.push({ op: 'from', args: [table] });
    const q: any = new Proxy({}, {
      get: (_t, prop: string) => {
        if (prop === 'then') return (resolve: any, reject: any) => Promise.resolve({ data: [], error: null }).then(resolve, reject);
        return (...args: unknown[]) => { fixture.ops.push({ op: prop, args }); return q; };
      },
    });
    return q;
  },
} }));
import DataContextModal from './DataContextModal';

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.ops.length = 0;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const open = (contextType: 'make' | 'model' | 'year', contextValue: string | number) =>
  act(async () => root.render(<DataContextModal isOpen onClose={() => {}} contextType={contextType} contextValue={contextValue} />));
const ops = () => fixture.ops.map((o) => `${o.op}:${o.args.join(',')}`);

describe('DataContextModal similar-vehicle read', () => {
  it('matches a make by equality, not ilike', async () => {
    await open('make', 'Lotus');
    expect(ops()).toContain('eq:make,Lotus');
    expect(fixture.ops.some((o) => o.op === 'ilike')).toBe(false);
  });
  it('matches a model by equality, not ilike', async () => {
    await open('model', 'Elan');
    expect(ops()).toContain('eq:model,Elan');
    expect(fixture.ops.some((o) => o.op === 'ilike')).toBe(false);
  });
  it('still matches a year by equality', async () => {
    await open('year', 1977);
    expect(ops()).toContain('eq:year,1977');
  });
});
