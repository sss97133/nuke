// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

type FixtureLog = { id: string; resource: string; action: string; resource_id: string | null; timestamp: string };
type FixtureKey = { id: string; name: string; last_used_at: string | null; rate_limit_remaining: number | null };
type QueryResult = { count?: number | null; data?: FixtureLog[] | FixtureKey[] | null; error?: { message: string } | null };
type QueryCall = { table: string; filters: Record<string, unknown>; orders: [string, { ascending: boolean }][]; fields?: string; options?: { count?: string; head?: boolean }; limit?: number };
type MockQuery = {
  select(fields: string, options?: QueryCall['options']): MockQuery;
  eq(key: string, value: unknown): MockQuery;
  gte(key: string, value: unknown): MockQuery;
  order(key: string, options: { ascending: boolean }): MockQuery;
  limit(limit: number): MockQuery;
  then(resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown): Promise<unknown>;
};
const fixture = vi.hoisted(() => ({ auth: { user: { id: 'viewer-a' }, loading: false } as { user: { id: string } | null; loading: boolean }, calls: [] as QueryCall[], results: [] as (QueryResult | Promise<QueryResult>)[] }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => fixture.auth }));
vi.mock('../../components/PrefetchLink', () => ({ default: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));
vi.mock('../../lib/supabase', () => ({ supabase: { from: (table: string) => {
  const call: QueryCall = { table, filters: {}, orders: [] }; fixture.calls.push(call);
  const result = fixture.results.shift() ?? { error: { message: 'Unexpected mock read' } };
  const query: MockQuery = {
    select: (fields: string, options?: QueryCall['options']) => { call.fields = fields; call.options = options; return query; },
    eq: (key: string, value: unknown) => { call.filters[key] = value; return query; },
    gte: (key: string, value: unknown) => { call.filters[key] = value; return query; },
    order: (key: string, options: { ascending: boolean }) => { call.orders.push([key, options]); return query; },
    limit: (limit: number) => { call.limit = limit; return query; },
    then: (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  }; return query;
} } }));
import UsageDashboardPage from './UsageDashboardPage';
let root: Root, host: HTMLDivElement;
const success = (logs: FixtureLog[] = [], keys: FixtureKey[] = []): QueryResult[] => [
  { count: 123, error: null }, { count: 0, error: null }, { count: 23, error: null }, { data: logs, error: null }, { data: keys, error: null },
];
const log = (i: number) => ({ id: `request-${i}`, resource: 'vehicles', action: 'read', resource_id: null, timestamp: new Date().toISOString() });
beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.auth = { user: { id: 'viewer-a' }, loading: false }; fixture.calls = []; fixture.results = success();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const mount = () => act(async () => root.render(<UsageDashboardPage />));
async function click(text: string) { await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === text)!.click()); }

it('keeps failed counts and missing readers unknown while showing successful sections', async () => {
  fixture.results = [{ count: null, error: { message: 'denied' } }, { count: 0 }, { count: null }, { data: [log(1)] }, { data: null, error: { message: 'offline' } }];
  await mount();
  expect(host.textContent).toContain('All-time usage could not be read');
  expect(host.textContent).toContain('Past seven days count is unavailable');
  expect(host.textContent).toContain('API key status is unavailable');
  expect(host.textContent).not.toContain('No active API keys');
  expect(host.textContent).toContain('Newest 1 loaded requests');
  expect([...host.querySelectorAll('.text-3xl')].map(node => node.textContent)).toEqual(['0', 'Unavailable', 'Unavailable']);
});
it('uses a sentinel and labels capped charts as a loaded sample, not all traffic', async () => {
  fixture.results = success(Array.from({ length: 101 }, (_, index) => log(index)));
  await mount();
  expect(fixture.calls[3].limit).toBe(101);
  expect(fixture.calls[3].orders.map((order) => order[0])).toEqual(['timestamp', 'id']);
  expect(host.textContent).toContain('Newest 100 loaded requests');
  expect(host.textContent).toContain('More requests exist; these charts are a partial sample');
  expect(host.textContent).toContain('Showing 50 of 100 matching loaded requests');
  expect(host.querySelector('[role="img"][aria-label$="100 loaded requests"]')?.getAttribute('style')).toContain('height: 100%');
});
it('does not call an empty or failed log read proof that no API calls exist', async () => {
  fixture.results = success(); fixture.results[3] = Promise.reject(new Error('offline'));
  // Attach the query's rejection handler during the same act turn.
  await mount();
  expect(host.textContent).toContain('Recent requests could not be loaded');
  expect(host.textContent).toContain('Recent request coverage is unknown');
  expect(host.textContent).not.toContain('No matching requests');
  expect(host.textContent).not.toContain('No API calls yet');
});
it('retries the readers and clears the unknown state on recovery', async () => {
  fixture.results = Array.from({ length: 5 }, () => ({ error: { message: 'offline' } })); await mount();
  fixture.results = success([log(1)]); await click('Retry usage reads');
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain('Newest 1 loaded requests');
  expect(fixture.calls).toHaveLength(10);
});
it('waits for auth and isolates late responses after a viewer changes', async () => {
  fixture.auth.loading = true; await mount(); expect(fixture.calls).toHaveLength(0);
  let resolve!: (value: QueryResult) => void;
  fixture.results = [new Promise(done => { resolve = done; }), ...success().slice(1)];
  fixture.auth.loading = false; await mount();
  fixture.auth.user = { id: 'viewer-b' }; fixture.results = success([log(2)]); await mount();
  await act(async () => resolve({ count: 999999 }));
  expect(host.textContent).not.toContain('999,999');
  expect(fixture.calls.slice(-5).every(call => call.filters.user_id === 'viewer-b')).toBe(true);
  fixture.auth.user = null; await mount(); expect(host.textContent).toContain('Sign in to view');
  expect(host.querySelector('table')).toBeNull();
});
it('uses UTC calendar boundaries for chart scope and preserves same-viewer reads', async () => {
  await mount();
  expect(fixture.calls[1].filters.timestamp).toMatch(/T00:00:00\.000Z$/);
  expect(fixture.calls[3].filters.timestamp).toMatch(/T00:00:00\.000Z$/);
  fixture.auth.user = { id: 'viewer-a' }; await mount(); expect(fixture.calls).toHaveLength(5);
});
