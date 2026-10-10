import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from '../nuke_frontend/node_modules/typescript/lib/typescript.js';
import { boundedRead, readIntakeSection, COVERAGE_SQL, MODEL_SQL, CONFIG_SQL, HEALTH_SQL,
  INTAKE_TABLES, INTAKE_JOBS, HEALTH_JOBS } from '../supabase/functions/db-stats/intakeStatus.ts';

const clock = '2026-10-10T12:00:00Z';
function connection(results = {}) {
  const calls = [];
  return { calls, async queryObject(sql, args) {
    calls.push({ sql, args });
    const result = results[sql];
    if (result instanceof Error) throw result;
    return { rows: result ?? [] };
  } };
}

test('each read is read-only, bounded and rolls back before returning', async () => {
  const db = connection({ [COVERAGE_SQL]: [{ measured_at: clock, rows: [] }] });
  assert.equal((await boundedRead(db, COVERAGE_SQL)).status, 'measured');
  assert.deepEqual(db.calls.map(c => c.sql), ['BEGIN READ ONLY', "SET LOCAL statement_timeout = '5s'",
    "SET LOCAL lock_timeout = '1s'", COVERAGE_SQL, 'ROLLBACK']);
});
test('timeout/refusal loses only that reading and never exposes private SQL error bodies', async () => {
  const db = connection({ [CONFIG_SQL]: [{ measured_at: clock, rows: [{ jobname: 'synthetic-job', active: false }] }],
    [HEALTH_SQL]: new Error('PRIVATE_SQL_COMMAND_AND_CREDENTIAL') });
  const result = await readIntakeSection(db, 'jobs');
  assert.equal(result.config.status, 'measured'); assert.equal(result.health.status, 'unavailable');
  assert.equal(result.config.rows[0].active, false);
  assert.equal(result.health.measured_at, null); assert.deepEqual(result.health.rows, []);
  assert(!JSON.stringify(result).includes('PRIVATE_'));
  assert.equal(db.calls.filter(c => c.sql === 'ROLLBACK').length, 2);
  assert.deepEqual(result.scope, INTAKE_JOBS); assert.deepEqual(result.health_scope, HEALTH_JOBS);
});
test('coverage preserves known-target queue counts and refuses totals after source overflow', async () => {
  const rows = Array.from({ length: 31 }, (_, i) => ({ source_slug: `source-${i}`, total_targets: 100, extracted: 0 }));
  const db = connection({ [COVERAGE_SQL]: [{ measured_at: clock, rows }] });
  const result = await readIntakeSection(db, 'coverage');
  assert.equal(result.rows.length, 30); assert.equal(result.complete, false);
  assert.equal(result.rows[0].extracted, 0); assert.equal(result.rows[0].total_targets, 100);
  assert.equal(result.scope.basis, 'known_target_url_queue_status');
});
test('relationship slice is explicit and uses fixed parameterized table scope', async () => {
  const db = connection({ [MODEL_SQL]: [{ measured_at: clock, rows: [], links: Array.from({ length: 501 }, () => ({ validated: false })) }] });
  const result = await readIntakeSection(db, 'model');
  assert.equal(result.links.length, 500); assert.equal(result.links_complete, false);
  assert.deepEqual(db.calls.find(c => c.sql === MODEL_SQL).args, [INTAKE_TABLES]);
  assert.equal(result.receipt_limit_per_table, 32); assert.equal(result.receipt_window_days, 30);
  assert(MODEL_SQL.includes('LIMIT 33')); assert(!MODEL_SQL.includes('writers_30d'));
});

function handler({ verdict, admin = false } = {}) {
  let serve, pools = 0, queries = 0, reads = 0;
  const exports = {};
  const source = readFileSync(new URL('../supabase/functions/db-stats/index.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const queryCalls = [];
  const context = {
    exports, Request, Response, URL, console: { error() {} },
    Deno: { env: { get: () => 'configured' }, serve(fn) { serve = fn; } },
    require(name) {
      if (name.endsWith('/cors.ts')) return { corsHeaders: { 'Access-Control-Allow-Origin': '*' } };
      if (name.endsWith('/writeGuard.ts')) return { authenticateWriter: async () => verdict ?? { ok: false } };
      if (name.endsWith('/intakeStatus.ts')) return { readIntakeSection: async (_db, section) => { reads++; return { contract: 'intake_status_v1', section }; } };
      if (name.includes('postgres@')) return { Pool: class {
        constructor() { pools++; }
        async connect() { return { async queryObject(sql, args) { queries++; queryCalls.push({ sql, args }); return { rows: [{ allowed: admin }] }; }, release() {} }; }
        async end() {}
      } };
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  vm.runInNewContext(code, context);
  return { request: (section = 'coverage', method = 'GET') => serve(new Request(`https://synthetic.invalid/db-stats?intake=${section}`, { method })),
    counts: () => ({ pools, queries, reads }), queryCalls };
}
test('anonymous/forged callers are refused before opening a database pool', async () => {
  const h = handler(); const response = await h.request();
  assert.equal(response.status, 401); assert.deepEqual(h.counts(), { pools: 0, queries: 0, reads: 0 });
});
test('signed-in non-admin gets no privileged metadata; membership is parameterized', async () => {
  const h = handler({ verdict: { ok: true, caller: { kind: 'user', userId: 'synthetic-user' } } });
  assert.equal((await h.request()).status, 403);
  assert.equal(h.counts().reads, 0);
  assert.equal(h.queryCalls[0].sql.includes('user_id = $1::uuid AND is_active'), true);
  assert.deepEqual(Array.from(h.queryCalls[0].args), ['synthetic-user']);
});
test('active admins and service callers receive only the requested read-only section without caching', async () => {
  for (const caller of [{ kind: 'user', userId: 'synthetic-admin' }, { kind: 'service_role' }]) {
    const h = handler({ verdict: { ok: true, caller }, admin: true }); const response = await h.request('model');
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await response.json(), { contract: 'intake_status_v1', section: 'model' });
    assert.equal(h.counts().reads, 1);
  }
});
test('arbitrary sections, POSTs and API-key callers cannot choose a privileged query', async () => {
  const h = handler({ verdict: { ok: true, caller: { kind: 'api_key', userId: 'synthetic-admin' } }, admin: true });
  assert.equal((await h.request('private-table')).status, 400);
  assert.equal((await h.request('jobs', 'POST')).status, 405);
  assert.equal((await h.request()).status, 403);
  assert.deepEqual(h.counts(), { pools: 0, queries: 0, reads: 0 });
});
