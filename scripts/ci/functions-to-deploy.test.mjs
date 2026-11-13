import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { functionsToDeploy, specifiers } from './functions-to-deploy.mjs';

function tree(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'fn-deploy-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  }
  return root;
}

const fixture = () => tree({
  '_shared/leaf.ts': 'export const x = 1;\n',
  '_shared/mid.ts': 'import { x } from "./leaf.ts";\nexport const y = x;\n',
  '_shared/other.ts': 'export const z = 2;\n',
  '_shared/leaf.test.ts': 'import { x } from "./leaf.ts";\n',
  'direct/index.ts': 'import { x } from "../_shared/leaf.ts";\n',
  'through/index.ts': 'import { helper } from "./helper.ts";\n',
  'through/helper.ts': "export { y as helper } from '../_shared/mid.ts';\n",
  'dynamic/index.ts': 'const m = await import("../_shared/mid.ts");\n',
  'url/index.ts': 'const t = await Deno.readTextFile(new URL("../_shared/page.html", import.meta.url));\n',
  'unrelated/index.ts': 'import { z } from "../_shared/other.ts";\nimport "https://esm.sh/x@1";\n',
  'tested/index.ts': 'export const a = 1;\n',
  'tested/index.test.ts': 'import { x } from "../_shared/leaf.ts";\n',
  '_template/index.ts': 'import { x } from "../_shared/leaf.ts";\n',
});

const run = (root, changed) => functionsToDeploy(changed.map((c) => `fns/${c}`), { root, prefix: 'fns/' }).functions;

test('a shared file deploys its direct and transitive importers, not unrelated functions', () => {
  const root = fixture();
  assert.deepEqual(run(root, ['_shared/leaf.ts']), ['direct', 'dynamic', 'through']);
});

test('test files and underscore folders are not deployed importers', () => {
  const root = fixture();
  const fns = run(root, ['_shared/leaf.ts']);
  assert.ok(!fns.includes('tested'));
  assert.ok(!fns.includes('_template'));
});

test('a function folder change deploys that function; a non-entry file reaches its own function', () => {
  const root = fixture();
  assert.deepEqual(run(root, ['unrelated/index.ts']), ['unrelated']);
  assert.deepEqual(run(root, ['through/helper.ts']), ['through']);
});

test('a non-code file named by new URL(…, import.meta.url) deploys its reader', () => {
  const root = fixture();
  assert.deepEqual(run(root, ['_shared/page.html']), ['url']);
});

test('a deleted function folder is still listed (the deploy step skips folders that are gone)', () => {
  const root = fixture();
  assert.deepEqual(run(root, ['removed/index.ts']), ['removed']);
});

test('paths outside the functions tree are ignored', () => {
  const root = fixture();
  assert.deepEqual(functionsToDeploy(['supabase/migrations/x.sql', 'README.md'], { root, prefix: 'fns/' }).functions, []);
});

test('specifiers: relative only, every import form', () => {
  assert.deepEqual(specifiers([
    'import a from "./a.ts";',
    "import type { B } from '../b.ts';",
    'import {\n  c,\n  d,\n} from "./cd.ts";',
    'export * from "./e.ts";',
    'import "./side.ts";',
    'await import("./f.ts");',
    'import j from "./j.json" with { type: "json" };',
    'new URL("./g.html", import.meta.url);',
    'import x from "https://esm.sh/x@1";',
    'import y from "npm:y@1";',
  ].join('\n')).sort(), ['../b.ts', './a.ts', './cd.ts', './e.ts', './f.ts', './g.html', './j.json', './side.ts']);
});
