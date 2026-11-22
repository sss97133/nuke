import { beforeEach, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('../lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return {
    supabase: createClient('https://fixture.supabase.co', 'fixture-public-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: transport.fetch },
    }),
  };
});
// Expose each query's options without rendering React.
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: unknown) => options }));
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), useMemo: (fn: () => unknown) => fn() }));

import { useDealRead } from './useDealRead';

const vehicleId = '2e61fa34-c5b4-4709-9636-4823546a5bc4';

beforeEach(() => {
  transport.fetch.mockReset();
  transport.fetch.mockImplementation(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }));
});

it('the deal read lists standing readings only', async () => {
  const captured: Array<{ queryKey: unknown[]; queryFn: () => Promise<unknown> }> = [];
  const mod = await import('@tanstack/react-query');
  vi.spyOn(mod, 'useQuery').mockImplementation(((o: any) => { captured.push(o); return { data: undefined, isLoading: false, isError: false, error: null }; }) as any);
  try { useDealRead(vehicleId); } catch { /* only the captured query options matter here */ }
  const q = captured.find((o) => o.queryKey?.[1] === 'observations');
  expect(q).toBeTruthy();
  await q!.queryFn();
  const url = new URL(String(transport.fetch.mock.calls[0][0]));
  expect(url.pathname).toBe('/rest/v1/vehicle_observations');
  expect(url.searchParams.get('vehicle_id')).toBe(`eq.${vehicleId}`);
  expect(url.searchParams.get('is_superseded')).toBe('not.is.true');
  expect(url.searchParams.get('or')).toBe('(agent_tier.is.null,agent_tier.neq.subscription automatic)');
});
