// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rows: [] as any[], calls: [] as any[][] }));
// A query builder that applies the filters it is given, and records them.
vi.mock('../../lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    let rows = table === 'organization_vehicles' ? fixture.rows : [];
    const q: any = { then: (fn: any) => Promise.resolve({ data: rows, error: null }).then(fn) };
    q.select = () => q;
    q.eq = (key: string, value: any) => { fixture.calls.push(['eq', key, value]); rows = rows.filter(r => r[key] === value); return q; };
    q.in = (key: string, values: any[]) => { fixture.calls.push(['in', key, values]); rows = rows.filter(r => values.includes(r[key])); return q; };
    q.not = (key: string, op: string, value: any) => {
      fixture.calls.push(['not', key, op, value]);
      if (op === 'is') rows = rows.filter(r => r[key] !== value);
      return q;
    };
    return q;
  },
} }));

import LinkedOrganizations from './LinkedOrganizations';

const link = (id: string, name: string, changes: Record<string, unknown> = {}) => ({
  id, organization_id: `org-${id}`, vehicle_id: 'car', relationship_type: 'service_provider', auto_tagged: true,
  gps_match_confidence: 80, status: 'active', user_rejected: false,
  businesses: { id: `org-${id}`, business_name: name, business_type: 'shop', city: 'Las Vegas', state: 'NV', logo_url: null },
  ...changes,
});

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.calls = [];
  fixture.rows = [
    link('a', 'Confirmed Shop'),
    link('p', 'Guessed Shop', { status: 'pending' }),
    link('r', 'Rejected Shop', { status: 'pending', user_rejected: true }),
  ];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const render = async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(
    <QueryClientProvider client={client}><MemoryRouter><LinkedOrganizations vehicleId="car" /></MemoryRouter></QueryClientProvider>,
  ));
  // react-query notifies on a timer, not a microtask
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
};

it('leaves out links the owner rejected', async () => {
  await render();
  expect(fixture.calls).toContainEqual(['not', 'user_rejected', 'is', true]);
  expect(host.textContent).toContain('Confirmed Shop');
  expect(host.textContent).toContain('Guessed Shop');
  expect(host.textContent).not.toContain('Rejected Shop');
});

it('labels a pending link unconfirmed and an active one not', async () => {
  await render();
  const rows = [...host.querySelectorAll('a')];
  const pending = rows.find(a => a.textContent?.includes('Guessed Shop'))!;
  const active = rows.find(a => a.textContent?.includes('Confirmed Shop'))!;
  expect(pending.querySelector('.k-caption')?.textContent).toBe('unconfirmed');
  expect(active.textContent).not.toContain('unconfirmed');
});
