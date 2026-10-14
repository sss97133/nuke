// Run: deno test supabase/functions/extract-rmsothebys/
import { forEachConcurrent, readConcurrency } from './concurrency.ts';

function equal(actual: unknown, expected: unknown, what = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what} Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

Deno.test('every item is processed exactly once, and never more than `limit` at a time', async () => {
  let inFlight = 0;
  let peak = 0;
  const seen: number[] = [];
  await forEachConcurrent([...Array(40).keys()], 4, async (n) => {
    inFlight++; peak = Math.max(peak, inFlight);
    await sleep(1 + (n % 3));
    seen.push(n);
    inFlight--;
  });
  equal(seen.length, 40);
  equal([...seen].sort((a, b) => a - b), [...Array(40).keys()]);
  equal(peak, 4);
});

Deno.test('a limit of 1 is the old behavior: in order, one at a time', async () => {
  const order: number[] = [];
  let inFlight = 0; let peak = 0;
  await forEachConcurrent([5, 3, 9, 1], 1, async (n) => { inFlight++; peak = Math.max(peak, inFlight); await sleep(2); order.push(n); inFlight--; });
  equal(order, [5, 3, 9, 1]);
  equal(peak, 1);
});

Deno.test('fewer items than the limit, and no items', async () => {
  const seen: string[] = [];
  await forEachConcurrent(['a', 'b'], 8, async (x) => { seen.push(x); });
  equal(seen.sort(), ['a', 'b']);
  await forEachConcurrent([], 4, async () => { throw new Error('never called'); });
});

Deno.test('wall-clock falls with the limit: 12 items of 20 ms take about a quarter of the time at 4', async () => {
  const run = async (limit: number) => { const t0 = performance.now(); await forEachConcurrent([...Array(12).keys()], limit, () => sleep(20)); return performance.now() - t0; };
  const one = await run(1); const four = await run(4);
  equal(one > 200, true, `limit 1 took ${one.toFixed(0)} ms:`);
  equal(four < one / 2.5, true, `limit 4 took ${four.toFixed(0)} ms, limit 1 took ${one.toFixed(0)} ms:`);
});

Deno.test('an error that escapes is thrown after the other workers finish; the other items still run', async () => {
  const done: number[] = [];
  let threw = '';
  try {
    await forEachConcurrent([...Array(10).keys()], 3, async (n) => { if (n === 4) throw new Error('boom'); await sleep(1); done.push(n); });
  } catch (e) { threw = (e as Error).message; }
  equal(threw, 'boom');
  equal(done.includes(4), false);
  equal(done.length >= 6, true, `${done.length} others completed:`);
});

Deno.test('readConcurrency: an integer from 1 to 8, else the default', () => {
  equal(readConcurrency(undefined, 4), 4);
  equal(readConcurrency(1, 4), 1);
  equal(readConcurrency(6, 4), 6);
  equal(readConcurrency(50, 4), 8);
  equal(readConcurrency('3', 4), 3);
  for (const bad of [0, -2, 2.5, NaN, '', 'x', null, {}, true]) equal(readConcurrency(bad, 4), 4, String(bad));
});
