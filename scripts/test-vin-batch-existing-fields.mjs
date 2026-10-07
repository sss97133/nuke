import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const require = createRequire(resolve('nuke_frontend/package.json'));
const ts = require('typescript');
const shared = ts.transpileModule(readFileSync('supabase/functions/_shared/nhtsa-vin.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const mappingContext = { exports: {} };
runInNewContext(shared, mappingContext);
const fieldMap = mappingContext.exports.NHTSA_FIELD_MAP;
const file = 'supabase/functions/batch-vin-decode/index.ts';
const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
const source = ts.createPrinter().printFile(ts.factory.updateSourceFile(ast,
  ast.statements.filter(s => !ts.isImportDeclaration(s))));
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture(existing) {
  const record = { id: 'synthetic-vehicle', vin: 'SYNTHETICVIN000001', engine_displacement: existing };
  const writes = [];
  const selections = [];
  let handler;
  const database = { from(table) {
    assert.equal(table, 'vehicles');
    const query = {
      select(columns) { selections.push(columns.split(',').map(c => c.trim())); return query; },
      not() { return query; }, is() { return query; }, or() { return query; }, order() { return query; },
      range() { return Promise.resolve({ data: [Object.fromEntries(selections.at(-1).map(k => [k, record[k] ?? null]))], error: null }); },
      update(payload) { return { eq(key, value) {
        assert.equal(key, 'id'); assert.equal(value, record.id);
        writes.push(payload); Object.assign(record, payload);
        return Promise.resolve({ error: null });
      } }; },
    };
    return query;
  } };
  runInNewContext(code, {
    Deno: { serve(callback) { handler = callback; }, env: { get() { return 'synthetic-only'; } } },
    createClient: () => database,
    requireWriteAuth: async () => null,
    NHTSA_FIELD_MAP: fieldMap,
    decodeVinsBatch: async () => new Map([[record.vin, { DisplacementCC: '1984' }]]),
    console: { log() {}, error() {} }, Response,
  });
  return { selections, writes, record, async run() {
    const response = await handler(new Request('https://example.invalid/decoder', {
      method: 'POST', body: JSON.stringify({ batch_size: 1 }),
    }));
    assert.equal(response.status, 200);
    return response.json();
  } };
}

test('candidate read includes every column the canonical NHTSA map can fill', async () => {
  const f = fixture('retained factory displacement'); await f.run();
  for (const { col } of Object.values(fieldMap)) assert.ok(f.selections[0].includes(col), `Missing existing value for ${col}`);
});
test('actual batch handler preserves an existing displacement and reports no new fields', async () => {
  const f = fixture('retained factory displacement');
  const result = await f.run();
  assert.equal(result.decoded, 0); assert.equal(result.fields_filled, 0);
  assert.equal(f.writes.length, 0);
  assert.equal(f.record.engine_displacement, 'retained factory displacement');
});
test('missing displacement fills once, and a later candidate retry is a no-op', async () => {
  const f = fixture(null);
  const first = await f.run(); const second = await f.run();
  assert.equal(first.decoded, 1); assert.equal(first.fields_filled, 1);
  assert.equal(f.record.engine_displacement, '1984cc');
  assert.equal(second.decoded, 0); assert.equal(second.fields_filled, 0);
  assert.equal(f.writes.length, 1);
});
