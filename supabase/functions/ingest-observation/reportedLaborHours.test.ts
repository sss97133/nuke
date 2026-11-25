import assert from 'node:assert/strict';
import { ingestReportedLabor, ReportedLaborRefusal } from './reportedLaborHours.ts';

const row = '33000000-0000-4000-8000-000000000002';
const q = { labor_scope: 'task', labor_system_key: 'engine', labor_statement_kind: 'actual', labor_time_basis: 'own' };
const ok = { source_table: 'auction_comments', source_row_id: row, quote: 'it took me about 40 hours total', low: 40, qualifiers: q };

Deno.test('one writer call per statement; dispositions and reasons counted', async () => {
  const calls: Record<string, unknown>[] = [];
  const answers = [
    { disposition: 'admitted', observation_id: 'a', duplicate: false, held_reasons: [] },
    { disposition: 'held', observation_id: 'b', duplicate: false, held_reasons: ['no_labor_context'] },
    { disposition: 'refused', reasons: ['quote_time_phrase'], writes: 0 },
    { disposition: 'admitted', observation_id: 'a', duplicate: true },
  ];
  const rpc = async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, ...args }); return { data: answers[calls.length - 1], error: null }; };
  const r = await ingestReportedLabor(rpc, { statements: [ok, ok, ok, { ...ok, high: 60 }], reader: { model: 'x' } });
  assert.equal(calls.length, 4);
  assert.ok(calls.every((c) => c.fn === 'record_reported_labor_statement'));
  assert.equal(calls[0].p_high, null);
  assert.equal(calls[3].p_high, 60);
  assert.deepEqual(calls[0].p_reader, { model: 'x' });
  assert.deepEqual(r.counts, { admitted: 2, held: 1, refused: 1, duplicate: 1 });
  assert.deepEqual(r.reasons, { no_labor_context: 1, quote_time_phrase: 1 });
  assert.equal(r.model_calls, 0);
});

Deno.test('malformed requests are refused before any write', async () => {
  let n = 0;
  const rpc = async () => { n++; return { data: {}, error: null }; };
  for (const bad of [
    {}, { statements: [] }, { statements: Array(26).fill(ok) },
    { statements: [{ ...ok, source_table: 'vehicle_observations' }] },
    { statements: [{ ...ok, source_row_id: 'x' }] },
    { statements: [{ ...ok, quote: '' }] },
    { statements: [{ ...ok, low: '40' }] },
    { statements: [{ ...ok, qualifiers: [] }] },
    { statements: [ok, { ...ok, high: 'sixty' }] },
  ]) {
    await assert.rejects(ingestReportedLabor(rpc, bad as Record<string, unknown>), ReportedLaborRefusal);
  }
  assert.equal(n, 0);
});

Deno.test('a writer error stops the batch as a 500', async () => {
  const rpc = async () => ({ data: null, error: { message: 'boom' } });
  await assert.rejects(ingestReportedLabor(rpc, { statements: [ok] }), (e: unknown) => e instanceof ReportedLaborRefusal && e.status === 500);
});

Deno.test('a writer error after earlier statements landed reports what landed', async () => {
  const answers = [
    { data: { disposition: 'admitted', observation_id: 'a', duplicate: false }, error: null },
    { data: { disposition: 'held', observation_id: 'b', duplicate: false, held_reasons: ['no_labor_context'] }, error: null },
    { data: null, error: { message: 'boom' } },
  ];
  let n = 0;
  const rpc = async () => answers[n++];
  await assert.rejects(ingestReportedLabor(rpc, { statements: [ok, ok, ok, ok] }), (e: unknown) => {
    const r = e as ReportedLaborRefusal;
    return r.status === 500 && r.partial.writes === 2 && r.partial.failed_index === 2
      && (r.partial.results as unknown[]).length === 2;
  });
  assert.equal(n, 3);
});

Deno.test('writes counts landed rows, not replays', async () => {
  const rpc = async () => ({ data: { disposition: 'admitted', observation_id: 'a', duplicate: true }, error: null });
  const r = await ingestReportedLabor(rpc, { statements: [ok] });
  assert.equal(r.writes, 0);
});
