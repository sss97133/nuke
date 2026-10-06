// Run: deno test supabase/functions/_shared/vehicleEventWrite.test.ts
// The writer is tested through a stub PostgREST client that records each call and answers from a script.
import { clocksLocked, writeVehicleEventByKey } from './vehicleEventWrite.ts';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

type Answer = { data?: unknown; error?: { message: string; code?: string } | null };
type Call = { table: string; op: 'select' | 'update' | 'insert'; row: unknown; filters: Array<[string, unknown]> };

function stubClient(answers: Answer[]) {
  const calls: Call[] = [];
  const next = () => {
    const a = answers.shift();
    if (!a) throw new Error('stub: no scripted answer left');
    return { data: a.data ?? null, error: a.error ?? null };
  };
  const chainFor = (call: Call) => {
    const chain = {
      eq(col: string, val: unknown) { call.filters.push([col, val]); return chain; },
      select() { return chain; },
      limit() { return Promise.resolve(next()); },
    };
    return chain;
  };
  const client = {
    from(table: string) {
      return {
        select() { const c: Call = { table, op: 'select', row: null, filters: [] }; calls.push(c); return chainFor(c); },
        update(row: unknown) { const c: Call = { table, op: 'update', row, filters: [] }; calls.push(c); return chainFor(c); },
        insert(row: unknown) { const c: Call = { table, op: 'insert', row, filters: [] }; calls.push(c); return chainFor(c); },
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
  sold_at: '2026-08-14T00:00:00.000Z',
  ended_at: '2026-08-14T00:00:00.000Z',
  final_price: 500000,
  metadata: { source: 'extract-gooding', sold_at_basis: 'single_auction_session', lot_number: 7 },
};
const KEY_FILTERS = [['vehicle_id', 'v-1'], ['source_platform', 'gooding'], ['source_listing_id', ROW.source_listing_id]];

Deno.test('the live row is found on the three key columns and updated by id, with no insert', async () => {
  const { client, calls } = stubClient([{ data: [{ id: 'e-1', metadata: { other_writer: 1 } }] }, { data: [{ id: 'e-1' }] }]);
  equal(await writeVehicleEventByKey(client, ROW), { action: 'updated', id: 'e-1' });
  equal(calls.map((c) => c.op), ['select', 'update']);
  equal(calls[0].table, 'vehicle_events');
  equal(calls[0].filters, KEY_FILTERS);
  equal(calls[1].filters, [['id', 'e-1']]);
  const patch = calls[1].row as Record<string, unknown>;
  equal(patch.sold_at, ROW.sold_at);
  equal(patch.metadata, { other_writer: 1, ...ROW.metadata });  // merged, not replaced
});

Deno.test('on an unlocked live row a clock is filled when NULL, never cleared, never overwritten', async () => {
  const cases: Array<[Record<string, unknown>, Record<string, unknown>, boolean]> = [
    [{ sold_at: null }, { sold_at: '2026-08-14T00:00:00.000Z' }, true],               // fill
    [{ sold_at: '2008-08-01T00:00:00.000Z' }, { sold_at: null }, false],               // never clear
    [{ sold_at: '2008-08-01T00:00:00.000Z' }, { sold_at: '2026-08-14T00:00:00.000Z' }, false], // never overwrite
  ];
  for (const [live, incoming, written] of cases) {
    const { client, calls } = stubClient([{ data: [{ id: 'e-5', metadata: {}, ...live }] }, { data: [{ id: 'e-5' }] }]);
    await writeVehicleEventByKey(client, { ...ROW, ended_at: null, ...incoming });
    const patch = calls[1].row as Record<string, unknown>;
    equal('sold_at' in patch, written);
    equal('ended_at' in patch, false);
  }
});

Deno.test('a row carrying clock_locked_by_supersession keeps its sold_at, ended_at and clock metadata', async () => {
  const live = {
    id: 'e-9',
    metadata: { clock_locked_by_supersession: true, sold_at_method: 'gooding_page_stated_day', sold_at_basis: 'superseded', keep: 'x' },
  };
  const { client, calls } = stubClient([{ data: [live] }, { data: [{ id: 'e-9' }] }]);
  equal(await writeVehicleEventByKey(client, ROW), { action: 'updated_clock_locked', id: 'e-9' });
  const patch = calls[1].row as Record<string, unknown>;
  equal('sold_at' in patch, false);
  equal('ended_at' in patch, false);
  equal(patch.final_price, 500000);  // non-clock fields still refresh
  equal(patch.metadata, {
    clock_locked_by_supersession: true, sold_at_method: 'gooding_page_stated_day', sold_at_basis: 'superseded', keep: 'x',
    source: 'extract-gooding', lot_number: 7,
  });
});

Deno.test('a non-empty episode_supersessions also locks the clocks; an empty one does not', () => {
  equal(clocksLocked({ episode_supersessions: [{ supersedes_event_id: 'e-0' }] }), true);
  equal(clocksLocked({ episode_supersessions: [] }), false);
  equal(clocksLocked({ clock_locked_by_supersession: false }), false);
  equal(clocksLocked(null), false);
});

Deno.test('a locked row drops the lander\'s clock metadata keys the live row lacks', async () => {
  const { client, calls } = stubClient([{ data: [{ id: 'e-8', metadata: { clock_locked_by_supersession: true } }] }, { data: [{ id: 'e-8' }] }]);
  await writeVehicleEventByKey(client, ROW);
  equal('sold_at_basis' in ((calls[1].row as { metadata: Record<string, unknown> }).metadata), false);
});

Deno.test('a new episode is inserted when no live row has the key', async () => {
  const { client, calls } = stubClient([{ data: [] }, { data: [{ id: 'e-2' }] }]);
  equal(await writeVehicleEventByKey(client, ROW), { action: 'inserted', id: 'e-2' });
  equal(calls.map((c) => c.op), ['select', 'insert']);
  equal(calls[1].row, ROW);
});

Deno.test('an insert that loses a race (23505) reads the other writer\'s row and updates it, respecting its lock', async () => {
  const { client, calls } = stubClient([
    { data: [] },
    { error: { message: 'duplicate key value violates unique constraint "idx_vehicle_events_dedup"', code: '23505' } },
    { data: [{ id: 'e-3', metadata: { clock_locked_by_supersession: true } }] },
    { data: [{ id: 'e-3' }] },
  ]);
  equal(await writeVehicleEventByKey(client, ROW), { action: 'updated_clock_locked', id: 'e-3' });
  equal(calls.map((c) => c.op), ['select', 'insert', 'select', 'update']);
  equal('sold_at' in (calls[3].row as Record<string, unknown>), false);
});

Deno.test('any other insert error is returned, not swallowed', async () => {
  const { client } = stubClient([{ data: [] }, { error: { message: 'new row violates check constraint', code: '23514' } }]);
  equal(await writeVehicleEventByKey(client, ROW), { action: 'error', error: 'new row violates check constraint', code: '23514' });
});

Deno.test('a read error stops the write before any update or insert', async () => {
  const { client, calls } = stubClient([{ error: { message: 'canceling statement due to statement timeout', code: '57014' } }]);
  equal(await writeVehicleEventByKey(client, ROW), { action: 'error', error: 'canceling statement due to statement timeout', code: '57014' });
  equal(calls.map((c) => c.op), ['select']);
});

Deno.test('an update error is returned', async () => {
  const { client } = stubClient([{ data: [{ id: 'e-4', metadata: null }] }, { error: { message: 'permission denied', code: '42501' } }]);
  equal(await writeVehicleEventByKey(client, ROW), { action: 'error', error: 'permission denied', code: '42501' });
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
