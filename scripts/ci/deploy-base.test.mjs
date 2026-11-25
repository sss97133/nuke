import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectBase, isAncestorStatus } from './deploy-base.mjs';

const run = (id, sha, conclusion, extra = {}) => ({ id, head_sha: sha, conclusion, status: 'completed', event: 'push', head_branch: 'main',
  created_at: `2026-11-25T10:${String(id).padStart(2, '0')}:00Z`, ...extra });
const applied = (conclusion = 'success') => [{ name: 'Checkout (with previous commit for diff)', status: 'completed', conclusion: 'success', started_at: 't' },
  { name: 'Apply migrations (psql, in filename order)', status: 'completed', conclusion, started_at: 't' }];
const steps = (map) => async (id) => (id in map ? map[id] : []);

test('a run replaced while pending is skipped, so its commit rides the next run (2026-11-25 #3918)', async () => {
  const runs = [run(3, 'c3', 'cancelled'), run(2, 'c2', 'success')];
  const out = await selectBase(runs, steps({ 2: applied() }), { currentRunId: 4 });
  assert.equal(out.sha, 'c2');
  assert.deepEqual(out.skipped.map((s) => s.id), [3]);
});

test('the newest run that reached its apply step is the base, whatever its conclusion', async () => {
  for (const c of ['success', 'failure', 'cancelled']) {
    const out = await selectBase([run(5, 'c5', c), run(2, 'c2', 'success')], steps({ 5: applied(c), 2: applied() }), { currentRunId: 6 });
    assert.equal(out.sha, 'c5', c);
  }
});

test('a run that failed before its apply step applied nothing and is skipped', async () => {
  const early = [{ name: 'Validate secrets', status: 'completed', conclusion: 'failure', started_at: 't' },
    { name: 'Apply migrations (psql, in filename order)', status: 'completed', conclusion: 'skipped', started_at: null }];
  const out = await selectBase([run(5, 'c5', 'failure'), run(2, 'c2', 'success')], steps({ 5: early, 2: applied() }), { currentRunId: 6 });
  assert.equal(out.sha, 'c2');
});

test('the current run, dispatches, other branches and runs that have not started applying are never the base', async () => {
  const runs = [run(10, 'c10', null, { status: 'pending' }), run(9, 'c9', 'success'), run(8, 'c8', 'success', { event: 'workflow_dispatch' }),
    run(7, 'c7', 'success', { head_branch: 'x' }), run(2, 'c2', 'success')];
  const all = { 10: [], 9: applied(), 8: applied(), 7: applied(), 2: applied() };
  assert.equal((await selectBase(runs, steps(all), { currentRunId: 9 })).sha, 'c2');
});

test('a run the API still lists in progress, with its apply step started, is the base (its files are not re-applied)', async () => {
  const lagging = [{ name: 'Apply migrations (psql, in filename order)', status: 'completed', conclusion: 'success', started_at: 't' }];
  const out = await selectBase([run(5, 'c5', null, { status: 'in_progress' }), run(2, 'c2', 'success')],
    steps({ 5: lagging, 2: applied() }), { currentRunId: 6 });
  assert.equal(out.sha, 'c5');
});

test('unreadable steps or no qualifying run give no base (the caller fails the step)', async () => {
  assert.equal((await selectBase([run(2, 'c2', 'success')], async () => null, { currentRunId: 3 })).sha, null);
  assert.equal((await selectBase([run(2, 'c2', 'cancelled')], steps({}), { currentRunId: 3 })).sha, null);
});

test('a re-run of an old commit diffs from the run created before it, not from newer runs', async () => {
  const runs = [run(9, 'c9', 'success'), run(5, 'c5', 'failure', { run_attempt: 2 }), run(3, 'c3', 'success')];
  const out = await selectBase(runs, steps({ 9: applied(), 5: applied('failure'), 3: applied() }),
    { currentRunId: 5, currentCreatedAt: run(5).created_at });
  assert.equal(out.sha, 'c3');
});

test('a run whose first attempt applied and whose re-run is queued still counts as applied (steps of all attempts)', async () => {
  const attempts = [...applied('failure'), { name: 'Apply migrations (psql, in filename order)', status: 'queued', conclusion: null, started_at: null }];
  const out = await selectBase([run(5, 'c5', null, { status: 'queued', run_attempt: 2 }), run(3, 'c3', 'success')],
    steps({ 5: attempts, 3: applied() }), { currentRunId: 6, currentCreatedAt: run(6).created_at });
  assert.equal(out.sha, 'c5');
});

test('a base is usable only when it is an ancestor of the run commit (compare ahead or identical)', () => {
  assert.equal(isAncestorStatus('ahead'), true);
  assert.equal(isAncestorStatus('identical'), true);
  assert.equal(isAncestorStatus('behind'), false);   // base is a descendant: a re-run would apply nothing and stay green
  assert.equal(isAncestorStatus('diverged'), false);
});

test('a base run that failed while applying is still the base and is reported as not successful', async () => {
  const out = await selectBase([run(5, 'c5', 'failure'), run(2, 'c2', 'success')], steps({ 5: applied('failure'), 2: applied() }), { currentRunId: 6 });
  assert.equal(out.sha, 'c5');
  assert.equal(out.applied, 'failure');
});
