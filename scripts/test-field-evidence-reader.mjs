import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const require = createRequire(resolve('nuke_frontend/package.json'));
const ts = require('typescript');
const file = 'supabase/functions/mcp-connector/index.ts';
const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
const declaration = ast.statements.filter(s => ts.isFunctionDeclaration(s) && s.name?.text === 'handleQueryFieldEvidence');
assert.equal(declaration.length, 1);
const isolated = ts.createPrinter().printFile(ts.factory.updateSourceFile(ast, declaration));
const code = ts.transpileModule(isolated, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function reader(rows, { failFlagCheck = false } = {}) {
  const calls = [];
  const db = { from(table) {
    const call = { table, filters: [], limit: Infinity };
    calls.push(call);
    const q = {
      select(columns) { call.columns = columns; return q; },
      eq(key, value) { call.filters.push([key, value]); return q; },
      order() { return q; },
      limit(n) { call.limit = n; return q; },
      single() { return Promise.resolve({ data: { engine_type: 'recorded', engine_type_source: 'existing' }, error: null }); },
      then(done, fail) {
        const blocked = failFlagCheck && call.filters.some(([k, v]) => k === 'flagged_as_incorrect' && v === true);
        const data = rows.filter(r => call.filters.every(([k, v]) => r[k] === v)).slice(0, call.limit);
        return Promise.resolve({ data: blocked ? null : data, error: blocked ? { message: 'read failed' } : null }).then(done, fail);
      },
    };
    return q;
  } };
  const context = { sb: () => db, toolOk: value => ({ value }), toolErr: error => ({ error }) };
  runInNewContext(code + '\nglobalThis.handler=handleQueryFieldEvidence;', context);
  return { call: field => context.handler({ vehicle_id: 'synthetic-vehicle', field_name: field }), calls };
}
const row = (flagged, field = 'market_value_low') => ({ id: String(flagged), vehicle_id: 'synthetic-vehicle', field_name: field, flagged_as_incorrect: flagged });

test('flagged-only field returns empty evidence without querying nonexistent vehicle columns', async () => {
  const r = reader([row(true)]);
  const result = await r.call('market_value_low');
  assert.equal(result.value.evidence_count, 0);
  assert.equal(result.value.evidence.length, 0);
  assert.match(result.value.note, /withheld/);
  assert.equal(r.calls.some(c => c.table === 'vehicles'), false);
  assert.equal(r.calls[1].columns, 'id');
  assert.equal(r.calls[1].limit, 1);
});
test('mixed evidence returns only the existing unflagged rows', async () => {
  const r = reader([row(true), row(false)]);
  const result = await r.call('market_value_low');
  assert.equal(result.value.evidence_count, 1);
  assert.equal(result.value.evidence[0].flagged_as_incorrect, false);
  assert.equal(r.calls.length, 1);
});
test('unrecorded field keeps the existing scalar fallback', async () => {
  const r = reader([]);
  const result = await r.call('engine_type');
  assert.equal(result.value.current_value, 'recorded');
  assert.equal(r.calls.at(-1).table, 'vehicles');
});
test('a failed flag lookup cannot revive a rejected scalar', async () => {
  const r = reader([row(true)], { failFlagCheck: true });
  const result = await r.call('market_value_low');
  assert.equal(result.error, 'read failed');
  assert.equal(r.calls.some(c => c.table === 'vehicles'), false);
});
test('flags for a different field do not suppress the requested field fallback', async () => {
  const r = reader([row(true)]);
  const result = await r.call('engine_type');
  assert.equal(result.value.current_value, 'recorded');
});
