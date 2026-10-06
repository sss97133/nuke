// Run: deno test supabase/functions/_shared/vehicleEventWrite.test.ts
// The writer is tested through a stub PostgREST client that records each call and answers from a script.
import { writeVehicleEventByKey } from './vehicleEventWrite.ts';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

type Answer = { data?: unknown; error?: { message: string; code?: string } | null };
type Call = { table: string; op: 'update' | 'insert'; row: unknown; filters: Array<[string, unknown]> };

function stubClient(answers: Answer[]) {
  const calls: Call[] = [];
  const next = () => {
    const a = answers.shift();
    if (!a) throw new Error('stub: no scripted answer left');
    return { data: a.data ?? null, error: a.error ?? null };
  };
  const client = {
    from(table: string) {
      return {
        update(row: unknown) {
          const call: Call = { table, op: 'update', row, filters: [] };
          calls.push(call);
          const chain = {
            eq(col: string, val: unknown) { call.filters.push([col, val]); return chain; },
            select() { return chain; },
            limit() { return Promise.resolve(next()); },
          };
          return chain;
        },
        insert(row: unknown) {
          calls.push({ table, op: 'insert', row, filters: [] });
          const chain = { select() { return chain; }, limit() { return Promise.resolve(next()); } };
          return chain;
        },
      };
    },
  };
  return { client, calls };
}

const ROW = {
  vehicle_id: 'v-1',
  source_platform: 'gooding',
  source_listing_id: 'goodingco.com/lot/1914-stutz-model-4e-bearcat',
  source_url: 'https://www.goodingco.com/lot/1914-stutz-model-4e-bearcat',
  event_status: 'sold',
};

Deno.test('an existing episode is updated on the three key columns, with no insert', async () => {
  const { client, calls } = stubClient([{ data: [{ id: 'e-1' }] }]);
  equal(await writeVehicleEventByKey(client, ROW), { action: 'updated', id: 'e-1' });
  equal(calls.map((c) => c.op), ['update']);
  equal(calls[0].table, 'vehicle_events');
  equal(calls[0].filters, [['vehicle_id', 'v-1'], ['source_platform', 'gooding'], ['source_listing_id', ROW.source_listing_id]]);
});

Deno.test('a new episode is inserted when the update matched no row', async () => {
  const { client, calls } = stubClient([{ data: [] }, { data: [{ id: 'e-2' }] }]);
  equal(await writeVehicleEventByKey(client, ROW), { action: 'inserted', id: 'e-2' });
  equal(calls.map((c) => c.op), ['update', 'insert']);
  equal(calls[1].row, ROW);
});

Deno.test('an insert that loses a race (23505) updates the row the other writer made', async () => {
  const { client, calls } = stubClient([
    { data: [] },
    { error: { message: 'duplicate key value violates unique constraint "idx_vehicle_events_dedup"', code: '23505' } },
    { data: [{ id: 'e-3' }] },
  ]);
  equal(await writeVehicleEventByKey(client, ROW), { action: 'updated', id: 'e-3' });
  equal(calls.map((c) => c.op), ['update', 'insert', 'update']);
});

Deno.test('any other insert error is returned, not swallowed', async () => {
  const { client } = stubClient([{ data: [] }, { error: { message: 'new row violates check constraint', code: '23514' } }]);
  equal(await writeVehicleEventByKey(client, ROW), { action: 'error', error: 'new row violates check constraint', code: '23514' });
});

Deno.test('an update error stops the write before any insert', async () => {
  const { client, calls } = stubClient([{ error: { message: 'canceling statement due to statement timeout', code: '57014' } }]);
  equal(await writeVehicleEventByKey(client, ROW), { action: 'error', error: 'canceling statement due to statement timeout', code: '57014' });
  equal(calls.map((c) => c.op), ['update']);
});

Deno.test('a row without its full key is skipped with the reason and touches nothing', async () => {
  for (const [patch, reason] of [
    [{ vehicle_id: null }, 'no vehicle_id'],
    [{ source_listing_id: '' }, 'no source_listing_id'],
    [{ source_platform: '' }, 'no source_platform'],
  ] as const) {
    const { client, calls } = stubClient([]);
    equal(await writeVehicleEventByKey(client, { ...ROW, ...patch }), { action: 'skipped', reason });
    equal(calls.length, 0);
  }
});
