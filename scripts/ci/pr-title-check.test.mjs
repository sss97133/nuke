// Contract for scripts/ci/pr-title-check.mjs: the same verdict as the PR gate in pre-deploy-check.yml.
//   node --test scripts/ci/pr-title-check.test.mjs   (run by scripts/ci/verify.sh)
// The failing titles are shaped like the ones that failed the gate on 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkTitle, TITLE_RE } from './pr-title-check.mjs';

test('the regex is the one the workflow runs', () => {
  const yml = fs.readFileSync(fileURLToPath(new URL('../../.github/workflows/pre-deploy-check.yml', import.meta.url)), 'utf8');
  assert.equal(yml.match(/re='([^']+)'/)[1], TITLE_RE);
  assert.match(yml, /\(\( \$\{#title\} > 72 \)\)/);
});

test('a conventional title within 72 characters passes', () => {
  for (const t of ['fix(ci): make flaky contracts deterministic and add flake report', 'perf(db): partial index on vehicle_observations.source_vehicle_event_id',
    'feat(extract-gooding)!: parse lots', 'docs: note the gate', 'Revert "feat(x): something with Capitals."']) assert.equal(checkTitle(t).ok, true, t);
});

test('a title over 72 characters fails with the count to cut', () => {
  const t = 'feat(open_requirements): fastener exclusion, steering and trim types, supply corroboration';
  const r = checkTitle(t);
  assert.equal(r.ok, false);
  assert.match(r.problems[0], new RegExp(`^${[...t].length} characters; the limit is 72 \\(cut ${[...t].length - 72}\\)$`));
});

test('format problems are named', () => {
  assert.deepEqual(checkTitle('Fix the thing').problems, ["not 'type(scope): summary'"]);
  assert.deepEqual(checkTitle('feature(ci): add it').problems, ["unknown type 'feature'"]);
  assert.deepEqual(checkTitle('fix(CI): add it').problems, ["scope 'CI' must be lowercase [a-z0-9_./-]"]);
  assert.deepEqual(checkTitle('fix(ci): Add it').problems, ['summary must start lowercase']);
  assert.deepEqual(checkTitle('fix(ci): add it.').problems, ['no trailing period']);
  assert.deepEqual(checkTitle('fix(ci): close §13.3 gap').problems, ["no '§' case numbers"]);
});

test('length counts characters, not UTF-16 units, like bash ${#title} in a UTF-8 runner', () => {
  const t = 'feat(ios): plate \u{1F697} — quotes, ' + 'x'.repeat(43);
  assert.equal([...t].length, 72);
  assert.equal(t.length, 73);
  assert.equal(checkTitle(t).ok, true);
});
