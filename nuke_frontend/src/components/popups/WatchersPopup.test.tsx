// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ ops: [] as { op: string; args: unknown[] }[], rows: [] as any[] }));
vi.mock('../../lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    fixture.ops.push({ op: 'from', args: [table] });
    const q: any = new Proxy({}, {
      get: (_t, prop: string) => {
        if (prop === 'then') return (resolve: any, reject: any) => Promise.resolve({ data: fixture.rows, error: null }).then(resolve, reject);
        return (...args: unknown[]) => { fixture.ops.push({ op: prop, args }); return q; };
      },
    });
    return q;
  },
} }));
import { WatchersPopup } from './WatchersPopup';

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.ops.length = 0; fixture.rows = [];
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('WatchersPopup peer read', () => {
  it('matches the stored make and model by equality, which an index can serve under row security', async () => {
    fixture.rows = [{ bat_watchers: 10 }, { bat_watchers: 30 }, { bat_watchers: 50 }];
    await act(async () => root.render(<WatchersPopup vehicleId="v1" watcherCount={40} make="Ford" model="Mustang" />));
    const ops = fixture.ops.map((o) => `${o.op}:${o.args.join(',')}`);
    expect(ops).toContain('eq:make,Ford');
    expect(ops).toContain('eq:model,Mustang');
    expect(fixture.ops.some((o) => o.op === 'ilike')).toBe(false);
    expect(container.textContent).toContain('30');
  });
  it('reads nothing without a make and model', async () => {
    await act(async () => root.render(<WatchersPopup vehicleId="v1" watcherCount={40} make={null} model={null} />));
    expect(fixture.ops).toHaveLength(0);
  });
});
