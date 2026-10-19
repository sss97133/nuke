// Run: deno test --allow-read=supabase/functions/batch-extract-snapshots supabase/functions/batch-extract-snapshots/aiGate.test.ts
// The AI policy of batch-extract-snapshots. A stand-in for the model records each call; the gate decides when it is made.
import { filledFieldCount, makeAiGate, noAiConflict, readNoAi, terminalQueueStatus } from './aiGate.ts';
import { orphanVehicleIds } from './queueRows.ts';

function equal(actual: unknown, expected: unknown, what = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what} Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const LONG = 'x'.repeat(600);
const SHORT = 'x'.repeat(500);

function stand() {
  const calls: Array<{ content: string; url: string; platform: string }> = [];
  const logs: string[] = [];
  const ai = async (content: string, url: string, platform: string) => {
    calls.push({ content, url, platform });
    return { year: 1969, make: 'Chevrolet' };
  };
  return { calls, logs, ai, log: (l: string) => { logs.push(l); } };
}

Deno.test('readNoAi: only an explicit false-like value leaves the AI on', () => {
  for (const body of [{ no_ai: true }, { no_ai: 'true' }, { no_ai: 1 }, { no_ai: 'yes' }, { no_ai: 'tru' }, { no_ai: {} }]) {
    equal(readNoAi(body), true, JSON.stringify(body));
  }
  for (const body of [{}, { no_ai: false }, { no_ai: 'false' }, { no_ai: 0 }, { no_ai: '0' }, { no_ai: '' }, { no_ai: null }, null, undefined, 'x']) {
    equal(readNoAi(body), false, JSON.stringify(body));
  }
});

Deno.test('default: a row the regex could not read goes to the model once, with the same log line as before', async () => {
  const s = stand();
  const gate = makeAiGate(false, s.ai, s.log);
  const out = await gate.fallback({}, LONG, 'https://example.com/lot/1', 'barrett-jackson', 'veh-1');
  equal(out, { parsed: { year: 1969, make: 'Chevrolet' }, regexEmpty: true });
  equal(s.calls, [{ content: LONG, url: 'https://example.com/lot/1', platform: 'barrett-jackson' }]);
  equal(s.logs, ['[AI-fallback] Regex returned 0 fields for veh-1, trying AI...']);
  equal(gate.counters(), { regex_empty: 1, ai_calls: 1, ai_blocked: 0 });
});

Deno.test('default: a regex parse that found a field never reaches the model', async () => {
  const s = stand();
  const gate = makeAiGate(false, s.ai, s.log);
  const out = await gate.fallback({ vin: null, year: 1969 }, LONG, 'u', 'bat', 'veh-2');
  equal(out, { parsed: { vin: null, year: 1969 }, regexEmpty: false });
  equal(s.calls.length, 0);
  equal(gate.counters(), { regex_empty: 0, ai_calls: 0, ai_blocked: 0 });
});

Deno.test('default: content of 500 characters or fewer is not sent to the model (the existing threshold)', async () => {
  const s = stand();
  const gate = makeAiGate(false, s.ai, s.log);
  equal((await gate.fallback({}, SHORT, 'u', 'bat', 'v')).regexEmpty, true);
  equal((await gate.fallback({}, null, 'u', 'bat', 'v')).regexEmpty, true);
  equal(s.calls.length, 0);
  equal(gate.counters(), { regex_empty: 2, ai_calls: 0, ai_blocked: 0 });
});

Deno.test('default: the model as the parser (mode ai, a platform with no regex parser) is called as before', async () => {
  const s = stand();
  const gate = makeAiGate(false, s.ai, s.log);
  equal(await gate.primary(LONG, 'u', 'gooding'), { year: 1969, make: 'Chevrolet' });
  equal(s.calls.length, 1);
  equal(gate.counters(), { regex_empty: 0, ai_calls: 1, ai_blocked: 0 });
});

Deno.test('no_ai: the model is never called, the row is counted regex-empty, and the log line is not the AI-fallback one', async () => {
  const s = stand();
  const gate = makeAiGate(true, s.ai, s.log);
  const out = await gate.fallback({}, LONG, 'u', 'barrett-jackson', 'veh-3');
  equal(out, { parsed: {}, regexEmpty: true });
  equal(s.calls.length, 0);
  equal(s.logs.length, 1);
  equal(s.logs[0].includes('[no-ai]'), true);
  equal(s.logs.some((l) => l.includes('[AI-fallback]')), false);
  equal(gate.counters(), { regex_empty: 1, ai_calls: 0, ai_blocked: 1 });
});

Deno.test('no_ai: a row the regex read is untouched, and the model-as-parser path returns nothing without a call', async () => {
  const s = stand();
  const gate = makeAiGate(true, s.ai, s.log);
  equal(await gate.fallback({ vin: '1G1YY22G965123456' }, LONG, 'u', 'bat', 'v'), { parsed: { vin: '1G1YY22G965123456' }, regexEmpty: false });
  equal(await gate.primary(LONG, 'u', 'gooding'), {});
  equal(s.calls.length, 0);
  equal(gate.counters(), { regex_empty: 0, ai_calls: 0, ai_blocked: 1 });
});

Deno.test('no_ai over a batch: 10 rows, 3 regex-empty, no model call, and the regex-empty ones are named', async () => {
  const s = stand();
  const gate = makeAiGate(true, s.ai, s.log);
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, parsed: i % 4 === 0 ? {} : { year: 1960 + i } }));
  const statuses: string[] = [];
  for (const r of rows) {
    const out = await gate.fallback(r.parsed, LONG, 'u', 'barrett-jackson', r.id);
    statuses.push(terminalQueueStatus(true, out.regexEmpty));
  }
  equal(statuses.filter((x) => x === 'regex_empty').length, 3);
  equal(statuses.filter((x) => x === 'completed').length, 7);
  equal(s.calls.length, 0);
  equal(gate.counters(), { regex_empty: 3, ai_calls: 0, ai_blocked: 3 });
});

Deno.test('terminalQueueStatus: only a regex-empty row under no_ai is not completed', () => {
  equal(terminalQueueStatus(false, false), 'completed');
  equal(terminalQueueStatus(false, true), 'completed');
  equal(terminalQueueStatus(true, false), 'completed');
  equal(terminalQueueStatus(true, true), 'regex_empty');
});

Deno.test('filledFieldCount counts values, not keys', () => {
  equal(filledFieldCount({}), 0);
  equal(filledFieldCount({ a: null, b: undefined }), 0);
  equal(filledFieldCount({ a: null, b: 0, c: '' }), 2); // 0 and '' are values; the existing fallback test is `!= null`
});

Deno.test('noAiConflict: a request that cannot be honored is refused before any row is claimed', () => {
  equal(noAiConflict(false, 'ai', 'gooding'), null);
  equal(noAiConflict(true, 'sparse', 'barrett-jackson'), null);
  equal(noAiConflict(true, 'sparse', 'bonhams'), null);
  equal(noAiConflict(true, 'ai', 'barrett-jackson')?.includes('mode "ai"'), true);
  equal(noAiConflict(true, 'sparse', 'gooding')?.includes('no regex parser'), true);
});

Deno.test('orphanVehicleIds: claimed rows with no vehicle, in claim order', () => {
  const claimed = ['a', 'b', 'c', 'd'].map((vehicle_id) => ({ vehicle_id }));
  equal(orphanVehicleIds(claimed, [{ id: 'b' }, { id: 'd' }]), ['a', 'c']);
  equal(orphanVehicleIds(claimed, []), ['a', 'b', 'c', 'd']);
  equal(orphanVehicleIds(claimed, claimed.map((c) => ({ id: c.vehicle_id }))), []);
  equal(orphanVehicleIds([], [{ id: 'z' }]), []);
});

// The flag is only as good as the weakest call site. index.ts must reach the model through the gate and nowhere else.
Deno.test('index.ts has no direct call to the model: parseWithAI is defined once and handed to the gate, callTier is called once', async () => {
  const src = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
  equal((src.match(/\bparseWithAI\(/g) ?? []).length, 1, 'parseWithAI( occurrences (its definition):');
  equal((src.match(/\bcallTier\(/g) ?? []).length, 1, 'callTier( occurrences (inside parseWithAI):');
  equal((src.match(/makeAiGate\(noAi, parseWithAI\)/g) ?? []).length, 1, 'gate built once from parseWithAI:');
  equal((src.match(/gate\.primary\(/g) ?? []).length, 2, 'gate.primary call sites (mode ai, unknown platform):');
  equal((src.match(/gate\.fallback\(/g) ?? []).length, 1, 'gate.fallback call sites:');
  equal(src.includes('[AI-fallback]'), false, 'the AI-fallback log string lives only in aiGate.ts:');
  const rowStatuses = src.match(/status: "completed"/g) ?? [];
  equal(rowStatuses.length, 0, 'no row is written "completed" by literal; it goes through terminalQueueStatus:');
});
