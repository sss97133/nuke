// Contract for the per-route JS budget: the check passes on this tree, and fails when the Leaflet-on-every-page bug
// (Vite's dynamic-import preload helper placed in the 'maps' chunk, found and fixed 2026-10-19 in #2279) comes back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BASELINE, check, measure } from './route-js-budget.mjs';

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));

test('check logic: a never_initial chunk fails even within the size budget', () => {
  const base = { tolerance: 0.1, cap_kb: 450, never_initial: ['maps'], routes: { a: 300 } };
  assert.match(check({ routes: { a: { kb: 300, chunks: ['index', 'maps'] } } }, base).problems[0], /a: loads maps before first paint/);
});

test('check logic: growth over tolerance or cap fails, shrinking only notes', () => {
  const base = { tolerance: 0.1, cap_kb: 450, routes: { a: 300, b: 300, c: 300 } };
  const r = check({ routes: { a: { kb: 331 }, b: { kb: 460 }, c: { kb: 270 } } }, base);
  assert.equal(r.problems.length, 2);
  assert.match(r.problems[0], /a: 331 KB is 10% over/);
  assert.match(r.problems[1], /b: 460 KB is over the 450 KB cap/);
  assert.match(r.notes[0], /c: 270 KB, 10% under/);
});

test('this tree is within budget', async () => {
  const m = await measure();
  const { problems } = check(m, baseline);
  assert.deepEqual(problems, []);
  for (const r of Object.values(m.routes)) assert.ok(!r.chunks.includes('maps'), 'no route loads the maps chunk initially');
});

test('reintroducing the Leaflet-on-every-page chunking fails the budget on every route', async () => {
  const m = await measure({ manualChunks: (id, own) => (id.includes('vite/preload-helper') ? 'maps' : own) });
  const { problems } = check(m, baseline);
  for (const name of Object.keys(baseline.routes)) {
    assert.ok(problems.some(p => p.startsWith(`${name}:`) && /over/.test(p)), `${name} should fail on size: ${JSON.stringify(m.routes[name].kb)}`);
    assert.ok(problems.some(p => p.startsWith(`${name}: loads maps`)), `${name} should fail on never_initial`);
    assert.ok(m.routes[name].chunks.includes('maps'));
  }
});

test('putting clsx back into the charts chunk loads recharts with the vehicle workspace and fails', async () => {
  const m = await measure({ manualChunks: (id, own) => (id.includes('/clsx/') ? 'charts' : own) });
  const { problems } = check(m, baseline);
  assert.ok(m.routes.vehicle_workspace.chunks.includes('charts'));
  assert.ok(problems.some(p => p.startsWith('vehicle_workspace: loads charts')), JSON.stringify(problems));
});
