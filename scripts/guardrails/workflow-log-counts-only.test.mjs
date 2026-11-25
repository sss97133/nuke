// node --test scripts/guardrails/workflow-log-counts-only.test.mjs
// The public-log guard for reader steps: the live workflows pass, and every leak in the deliberately bad fixture
// (scripts/guardrails/fixtures/workflow-log-leaks.yml, `# BAD: <words>` before each bad statement) is reported on its line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkWorkflow, filterLeak } from './workflow-log-counts-only.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOWS = join(ROOT, '.github', 'workflows');

test('every workflow in the repository passes, and photo-keys.yml has its three reader steps checked', () => {
  let readers = 0;
  for (const f of readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f))) {
    const r = checkWorkflow(readFileSync(join(WORKFLOWS, f), 'utf8'));
    assert.deepEqual(r.violations, [], f);
    readers += r.readers;
  }
  const pk = checkWorkflow(readFileSync(join(WORKFLOWS, 'photo-keys.yml'), 'utf8'));
  assert.equal(pk.readers, 3, 'keys lane, project-cached and the stage reader are each found (a guard that finds none checks nothing)');
  assert.ok(readers >= 3);
});

test('the bad fixture: each marked statement is reported with its reason, and nothing else is', () => {
  const yaml = readFileSync(join(ROOT, 'scripts', 'guardrails', 'fixtures', 'workflow-log-leaks.yml'), 'utf8');
  const lines = yaml.split('\n');
  const expected = new Map();
  lines.forEach((t, i) => {
    const m = t.match(/^\s*# BAD: (.+)$/);
    if (m) expected.set(i + 2, m[1].trim());   // the statement on the next line (1-based)
  });
  assert.ok(expected.size >= 12, 'the fixture covers the cases');
  const { violations } = checkWorkflow(yaml);
  for (const [n, words] of expected) {
    const hit = violations.filter((v) => v.n === n);
    assert.ok(hit.some((v) => v.why.includes(words)), `line ${n} (${lines[n - 1].trim()}) should be reported as "${words}"; got ${JSON.stringify(hit)}`);
  }
  const stray = violations.filter((v) => v.n !== 0 && !expected.has(v.n));
  assert.deepEqual(stray, [], 'no statement outside the marked ones is reported');
  assert.ok(violations.some((v) => v.n === 0 && /named 2 times/.test(v.why)), 'the secret named in two steps is reported');
});

test('the filter probe: counts and lowercase words pass, row text does not', () => {
  assert.equal(filterLeak('objects | with_entries(select((.key | test("^[a-z_]{1,40}$")) and (.value | type) == "number"))', false), null);
  assert.match(filterLeak('objects | with_entries(select((.value | type) == "number"))', false), /canary/, 'a key is text too');
  assert.match(filterLeak('objects | {error_text}', false), /canary/);
  assert.match(filterLeak('objects | .stages.deep_reading', false), /canary/, 'three levels down is probed');
  assert.match(filterLeak('objects | .by_type | keys', false), /canary/, 'a key that is not a lowercase word is probed');
  assert.equal(filterLeak('select(test("^[a-z ]+$"))', true), null);
  assert.match(filterLeak('select(test("^result: "))', true), /canary/);
});
