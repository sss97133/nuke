import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BUDGET, exitCode, runImagePreflight, stepSummary } from './process-all-3000-images.js';

function client(response) {
  const calls = [];
  const query = {};
  for (const method of ['select', 'eq', 'order', 'limit', 'abortSignal']) {
    query[method] = (...args) => {
      calls.push([method, ...args]);
      return query;
    };
  }
  query.then = (onSuccess, onFailure) => Promise.resolve().then(() => (
    typeof response === 'function' ? response() : response
  )).then(onSuccess, onFailure);
  return {
    calls,
    from(table) { calls.push(['from', table]); return query; },
    functions: { invoke() { assert.fail('Preflight must never invoke an image/model consumer'); } },
  };
}

function noProcessing(result) {
  for (const key of ['processing_images', 'batches', 'retries', 'hosted_calls',
    'confirmed_new_observations', 'confirmed_new_witnesses', 'confirmed_reader_visible_claims']) {
    assert.equal(result[key], 0, key);
  }
  assert.equal(result.remaining_unknown, true);
  assert.equal(result.persistence_status, 'not_attempted');
  assert.notEqual(exitCode(result), 0);
}

test('bounded indexed state query replaces the unbounded JSON count', async () => {
  const db = client({ data: [{ id: 'private-image-id' }], error: null });
  const result = await runImagePreflight(db);
  assert.deepEqual(db.calls.slice(0, 5), [
    ['from', 'vehicle_images'], ['select', 'id'],
    ['eq', 'ai_processing_status', 'pending'],
    ['order', 'created_at', { ascending: true }], ['limit', 50],
  ]);
  assert.equal(db.calls[5][0], 'abortSignal');
  assert.equal(result.pending_sample_rows, 1);
  assert.equal(result.reason, 'consumer_contract_unverified');
  assert.equal(result.status, 'blocked');
  assert.equal(exitCode(result), 2);
  assert.equal(result.sample_at_limit, false);
  assert.equal(JSON.stringify(result).includes('private-image-id'), false);
  assert.equal(stepSummary(result).includes('private-image-id'), false);
  noProcessing(result);
});

test('a real empty query is still blocked, never all-analyzed or healthy processing', async () => {
  const result = await runImagePreflight(client({ data: [], error: null, count: null }));
  assert.equal(result.pending_sample_rows, 0);
  assert.equal(result.candidate_query_status, 'sampled');
  assert.equal(result.status, 'blocked');
  assert.equal(exitCode(result), 2);
  noProcessing(result);
});

test('remaining rows at the cap are reported as a capped sample, not a total', async () => {
  const result = await runImagePreflight(client({
    data: Array.from({ length: 50 }, (_, n) => ({ id: `image-${n}` })), error: null,
  }));
  assert.equal(result.pending_sample_rows, 50);
  assert.equal(result.sample_at_limit, true);
  assert.equal(result.reason, 'consumer_contract_unverified');
  noProcessing(result);
});

for (const [name, response, reason] of [
  ['query error with null count', { data: null, count: null, error: { message: 'secret query text' } }, 'candidate_query_error'],
  ['query error with apparently empty data', { data: [], error: { message: 'secret key' } }, 'candidate_query_error'],
  ['HTTP error without SDK error', { data: [], status: 503 }, 'candidate_query_error'],
  ['null data and zero count', { data: null, count: 0, error: null }, 'candidate_response_invalid'],
  ['missing response', undefined, 'candidate_response_invalid'],
  ['non-array data', { data: {}, error: null }, 'candidate_response_invalid'],
  ['malformed row', { data: [{}], error: null }, 'candidate_response_invalid'],
  ['duplicate sample rows', { data: [{ id: 'same' }, { id: 'same' }], error: null }, 'candidate_response_invalid'],
  ['row budget violation', { data: Array.from({ length: 51 }, (_, n) => ({ id: `${n}` })) }, 'candidate_response_invalid'],
]) {
  test(name, async () => {
    const db = client(response);
    const result = await runImagePreflight(db);
    assert.equal(result.status, 'failed');
    assert.equal(result.reason, reason);
    assert.equal(result.pending_sample_rows, null);
    assert.equal(exitCode(result), 1);
    assert.equal(JSON.stringify(result).includes('secret'), false);
    assert.equal(db.calls.filter(([method]) => method === 'from').length, 1);
    noProcessing(result);
  });
}

test('rejected query fails once with no retries or raw exception leakage', async () => {
  const result = await runImagePreflight(client(() => { throw new Error('private credentials'); }));
  assert.equal(result.reason, 'candidate_query_rejected');
  assert.equal(JSON.stringify(result).includes('private credentials'), false);
  noProcessing(result);
});

test('a stalled query has a finite deadline even if the client ignores abort', async () => {
  const db = client(() => new Promise(() => {}));
  const result = await runImagePreflight(db, { queryMs: 10 });
  assert.equal(result.reason, 'candidate_query_timeout');
  assert.equal(result.candidate_query_status, 'timeout');
  assert.equal(db.calls.at(-1)[1].aborted, true);
  assert.equal(result.budget.query_ms, 10);
  noProcessing(result);
});

test('invalid or expanded time budgets do not query', async () => {
  for (const queryMs of [0, -1, 1.5, Infinity, NaN, BUDGET.query_ms + 1]) {
    const db = client({ data: [] });
    const result = await runImagePreflight(db, { queryMs });
    assert.equal(result.reason, 'invalid_time_budget');
    assert.equal(db.calls.length, 0);
    noProcessing(result);
  }
});

test('zero work budgets cannot be expanded and unknown result states cannot exit healthy', () => {
  assert.throws(() => { BUDGET.batches = 1; }, TypeError);
  assert.deepEqual([BUDGET.processing_images, BUDGET.batches, BUDGET.retries,
    BUDGET.hosted_calls, BUDGET.hosted_spend_usd], [0, 0, 0, 0, 0]);
  for (const status of ['failed', 'incomplete', 'success', 'healthy', undefined]) {
    assert.equal(exitCode({ status }), 1);
  }
});

test('actual CLI returns nonzero and writes the useful summary with offline SDK fixtures', async () => {
  // Copy into an isolated directory so the CLI cannot read local credentials or
  // import a real network client. Only these two fixture packages are available.
  const directory = await mkdtemp(join(tmpdir(), 'image-preflight-test-'));
  try {
    const script = join(directory, 'worker.mjs');
    const summary = join(directory, 'summary.md');
    await copyFile(new URL('./process-all-3000-images.js', import.meta.url), script);
    for (const name of ['dotenv', '@supabase/supabase-js']) {
      const moduleDirectory = join(directory, 'node_modules', name);
      await mkdir(moduleDirectory, { recursive: true });
      await writeFile(join(moduleDirectory, 'package.json'), JSON.stringify({ type: 'module', main: 'index.js' }));
    }
    await writeFile(join(directory, 'node_modules/dotenv/index.js'), 'export default {config() {}};');
    await writeFile(join(directory, 'node_modules/@supabase/supabase-js/index.js'), `
      export function createClient() {
        if (process.env.FIXTURE === 'initialization_error') throw new Error('fixture-secret');
        const response = process.env.FIXTURE === 'query_error'
          ? {data:null, count:null, error:{message:'fixture-secret'}} : {data:[], error:null};
        const query = new Proxy({}, {get: (_, key) => key === 'then'
          ? (resolve) => resolve(response) : () => query});
        return {from: () => query};
      }
    `);
    for (const [fixture, expectedCode, expectedReason] of [
      ['empty', 2, 'consumer_contract_unverified'],
      ['query_error', 1, 'candidate_query_error'],
      ['missing_configuration', 1, 'missing_database_configuration'],
      ['initialization_error', 1, 'preflight_initialization_failed'],
    ]) {
      const run = spawnSync(process.execPath, [script], {
        encoding: 'utf8', timeout: 5_000,
        env: {
          SUPABASE_URL: 'https://example.invalid',
          SUPABASE_SERVICE_ROLE_KEY: fixture === 'missing_configuration' ? '' : 'offline-fixture-key',
          GITHUB_STEP_SUMMARY: summary,
          FIXTURE: fixture,
        },
      });
      assert.equal(run.error, undefined);
      assert.equal(run.status, expectedCode, fixture);
      const result = JSON.parse(run.stdout.trim());
      assert.equal(result.reason, expectedReason);
      assert.equal(run.stdout.includes('fixture-secret'), false);
      assert.equal(run.stderr.includes('fixture-secret'), false);
      assert.match(await readFile(summary, 'utf8'), new RegExp(expectedReason));
      noProcessing(result);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
