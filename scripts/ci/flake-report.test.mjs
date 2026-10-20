// Contract for scripts/ci/flake-report.mjs: what counts as rerun-passed, and how a failed log becomes a signature.
//   node --test scripts/ci/flake-report.test.mjs   (run by scripts/ci/verify.sh)
// Log lines are shaped like the GitHub job logs read on 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAttempts, failureSignature, normalize, parseArgs, rank } from './flake-report.mjs';

test('a job that failed then succeeded on a later attempt is rerun-passed', () => {
  const rows = classifyAttempts([
    { attempt: 2, jobs: [{ id: 21, name: 'db-contracts', conclusion: 'success' }] },
    { attempt: 1, jobs: [{ id: 11, name: 'db-contracts', conclusion: 'failure' }, { id: 12, name: 'vitest', conclusion: 'success' }] },
  ]);
  assert.deepEqual(rows, [{ job: 'db-contracts', outcome: 'rerun-passed', failedJobId: 11, failedAttempt: 1, passedAttempt: 2 }]);
});

test('a job that failed on every attempt is still-failing, and a job that never failed is not reported', () => {
  const rows = classifyAttempts([
    { attempt: 1, jobs: [{ id: 11, name: 'validate', conclusion: 'failure' }, { id: 12, name: 'vitest', conclusion: 'success' }] },
    { attempt: 2, jobs: [{ id: 21, name: 'validate', conclusion: 'failure' }] },
  ]);
  assert.deepEqual(rows.map(r => [r.job, r.outcome]), [['validate', 'still-failing']]);
});

test('a contract failure is named by its file and the assertion that raised, not by the runner line', () => {
  const log = [
    '2026-10-19T21:15:50.5510643Z psql:supabase/migrations/20261014051500_x.sql:43: ERROR:  expected drift refusal',
    '2026-10-19T21:15:50.5513123Z psql:supabase/sql/test_open_requirements_plan_b_suppliers.sql:74: ERROR:  FAIL: facility_read: no payment amount or id',
    '2026-10-19T21:15:50.5513200Z CONTEXT:  PL/pgSQL function t_assert(boolean,text) line 2 at RAISE',
    '2026-10-19T21:15:50.5542348Z ##[error]test_work_order_activity_read.sql failed (exit 3) after 1.2 s',
  ].join('\n');
  assert.equal(failureSignature(log),
    'test_work_order_activity_read.sql: test_open_requirements_plan_b_suppliers.sql: FAIL: facility_read: no payment amount or id');
});

test('a vitest failure is named by its file; other jobs fall back to their first real annotation', () => {
  assert.equal(failureSignature('2026-10-13T18:11:22.1Z \x1b[41m\x1b[1m FAIL \x1b[22m\x1b[49m src/components/images/ImageGallery.test.tsx > pages all399\n##[error]Error: Test timed out in 5000ms.'),
    'vitest src/components/images/ImageGallery.test.tsx > pages allN');
  assert.equal(failureSignature('##[error]Process completed with exit code 1.\n##[error]getaddrinfo EAI_AGAIN nodejs.org'), 'getaddrinfo EAI_AGAIN nodejs.org');
  assert.equal(failureSignature('nothing failed here'), 'unknown');
});

test('signatures drop ids, numbers and timings so repeats group together', () => {
  assert.equal(normalize('FAIL a3001234-5300-4300-8300-1234567300ab after 12.5 s at deadbeefdeadbeef'), 'FAIL <uuid> after N s at <hex>');
  assert.equal(normalize("PR title must be 'type(scope): lowercase summary', at most 72 characters. Got (80): feat(x): a long one"),
    "PR title must be 'type(scope): lowercase summary', at most N characters. Got (N): <title>");
  const ranked = rank([
    { workflow: 'W', job: 'db-contracts', signature: 's1', runId: 1 },
    { workflow: 'W', job: 'vitest', signature: 's2', runId: 2 },
    { workflow: 'W', job: 'db-contracts', signature: 's1', runId: 3 },
  ]);
  assert.deepEqual(ranked.map(g => [g.job, g.count, g.runs]), [['db-contracts', 2, [1, 3]], ['vitest', 1, [2]]]);
});

test('arguments are explicit; an unknown flag is refused', () => {
  assert.deepEqual(parseArgs(['--hours', '72', '--limit', '500', '--logs', '--repo', 'o/r']), { hours: 72, limit: 500, logs: true, json: false, repo: 'o/r' });
  assert.throws(() => parseArgs(['--days', '3']), /unknown argument/);
  assert.throws(() => parseArgs(['--hours', '0']), /positive/);
});
