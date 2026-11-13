import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { computeRetainedWidget, retainedWorkLimits } from './retainedWork.ts';
import { dispatchRetainedAnalysis } from '../derive-dispatch/retainedAnalysis.ts';
const receipt = { method_revision: 'registered_source_state_v1', assessment_status: 'not_assessed', score: null,
  severity: 'info', details: { claims_in_page: 1 }, evidence: { record_ids: [{ observation_id: 'source' }] }, reasons: ['retained state'] };
Deno.test('service retained limits preserve the small auxiliary wake and bound dedicated capacity', () => {
  assertEquals(retainedWorkLimits({}), { batchSize: 2, budgetMs: 15000 });
  assertEquals(retainedWorkLimits({ batch_size: 20000, time_budget_ms: 3600000 }), { batchSize: 20, budgetMs: 45000 });
  assertEquals(retainedWorkLimits({ batch_size: -1, time_budget_ms: -1 }), { batchSize: 0, budgetMs: 10000 });
  assertEquals(retainedWorkLimits({ batch_size: 'invalid', time_budget_ms: 'invalid' }), { batchSize: 0, budgetMs: 15000 });
});
Deno.test('registered retained calculation uses only its bounded RPC and preserves unscored evidence', async () => {
  let calls = 0;
  const db = { rpc(name: string, args: unknown) { calls++; assertEquals(name, 'compute_retained_analysis_widget');
    assertEquals(args, { p_vehicle_id: 'car', p_widget_slug: 'data-quality', p_method: 'registered_source_state_v1' });
    return { abortSignal(signal: AbortSignal) { assertEquals(signal instanceof AbortSignal, true);
      return Promise.resolve({ data: receipt, error: null }); } }; } };
  const result = await computeRetainedWidget(db, 'car', 'data-quality', 'registered_source_state_v1');
  assertEquals(calls, 1); assertEquals(result.score, null); assertEquals(result.value_json, receipt);
  assertEquals(result.evidence, receipt.evidence);
  await assertRejects(() => computeRetainedWidget(db, 'car', 'paid-reader', 'unregistered'), Error, 'Unregistered');
  assertEquals(calls, 1);
});
Deno.test('failed, scored or missing retained receipts cannot publish an assessment', async () => {
  for (const output of [null, {}, { ...receipt, score: 100 }, { ...receipt, assessment_status: 'proven' }]) {
    await assertRejects(() => computeRetainedWidget({ rpc: () => ({ abortSignal: () => Promise.resolve({ data: output, error: null }) }) },
      'car', 'data-quality', 'registered_source_state_v1'), Error, 'receipt missing');
  }
});
Deno.test('periodic wake never sweeps, changes compute identity or overrides a targeted user scope', async () => {
  const calls: any[] = [];
  const fetcher: typeof fetch = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({
    method: 'retained_analysis_dispatch_v1', processed: 0, total_failed: 0, results: [] })); };
  assertEquals(await dispatchRetainedAnalysis('https://db.test', 'secret', 'owner', 2, fetcher), null);
  assertEquals(await dispatchRetainedAnalysis('https://db.test', 'secret', null, 0, fetcher), null);
  await dispatchRetainedAnalysis('https://db.test', 'secret', null, 20, fetcher);
  assertEquals(calls.length, 1); assertEquals(calls[0].url, 'https://db.test/functions/v1/analysis-engine-coordinator');
  assertEquals(JSON.parse(calls[0].init.body), { action: 'compute_retained', batch_size: 2 });
  await assertRejects(() => dispatchRetainedAnalysis('https://db.test', 'secret', null, 2,
    async () => new Response(JSON.stringify({ method: 'retained_analysis_dispatch_v1', processed: 1, total_failed: 1, results: [] }))), Error, 'failed');
});
