import { beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ calls: [] as Array<{ table: string; methods: unknown[][]; select: string }>, responses: [] as unknown[] }));
vi.mock('../../lib/supabase', () => ({ supabase: { from: (table: string) => {
  const call = { table, methods: [] as unknown[][], select: '' }; fixture.calls.push(call);
  const response = fixture.responses.shift() ?? { data: [], error: null };
  const query = { then: (resolve: (v: unknown) => unknown) => Promise.resolve(response).then(resolve) } as Record<string, unknown>;
  for (const name of ['select', 'eq', 'in', 'not', 'order', 'limit']) query[name] = (...args: unknown[]) => {
    call.methods.push([name, ...args]); if (name === 'select') call.select = String(args[0]); return query;
  };
  return query;
} } }));
import { JobReaders, type RetainedWorkRead } from './jobsReaders';
const reports: NonNullable<RetainedWorkRead['responsibility_reports']> = [{ binding_id: 'binding', provider_actor_id: 'actor', provider_label: 'Technician', client_label: 'Client One',
  source_observation_id: 'basis', reported_at: '2026-07-01', payment_state: null, delivery_state: 'reported_owed', assurance: 'report' }];
beforeEach(() => { fixture.calls = []; fixture.responses = []; });

it('reads only the selected vehicle through existing RLS, selects no order amounts and names handoffs only from the evidenced reporting source', async () => {
  fixture.responses = [
    { data: [], error: null }, { data: [], error: null }, { data: [{ id: 'basis', source_id: 'source' }], error: null },
    { data: [{ id: 'included', source_id: 'source', gate: 'Delivery to Client One', blocked_on: ['A question'] },
      { id: 'other-client', source_id: 'source', gate: 'Delivery to Client Ones', blocked_on: [] }], error: null },
  ];
  const result = await JobReaders.workContext('vehicle-a', reports);
  expect(result.handoffs.map(h => h.id)).toEqual(['included']);
  for (const call of fixture.calls) expect(call.methods).toContainEqual(['eq', 'vehicle_id', 'vehicle-a']);
  expect(fixture.calls[0].select).not.toContain('order');
  expect(fixture.calls[3].methods).toContainEqual(['in', 'source_id', ['source']]);
  expect(fixture.calls[3].methods).toContainEqual(['limit', 21]);
});

it('does not convert a failed or partial read into a complete empty work plan', async () => {
  fixture.responses = [{ data: null, error: { message: 'denied' } },
    { data: Array.from({ length: 101 }, (_, id) => ({ id })), error: null }, { data: [], error: null }];
  const result = await JobReaders.workContext('vehicle-a', reports);
  expect(result.errors).toEqual(['Parts evidence could not be read.']);
  expect(result.partial).toBe(true); expect(result.decisions).toHaveLength(100);
  expect(result.handoffs).toEqual([]);
});

it('does not expand vehicle history without an included responsibility basis', async () => {
  expect((await JobReaders.workContext('vehicle-a', [])).proofs).toEqual([]);
  expect(fixture.calls).toHaveLength(0);
});
