// Contract for scripts/ci/function-drift-check.mjs, offline: no database, no network.
//   node --test scripts/ci/function-drift-check.test.mjs   (run by scripts/ci/verify.sh)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compare, countArgs, exitCode, formatReport, latestDefinitions, parseMigration } from './function-drift-check.mjs';

const M1 = `
-- CREATE OR REPLACE FUNCTION public.commented_out(a int) RETURNS int AS $$ select 1 $$;
create or replace function public.f(a int, b text default 'x,y') returns int language sql as $$ select 1 $$;
CREATE OR REPLACE FUNCTION public.g(numeric(10,2)) RETURNS int LANGUAGE sql AS $fn$ select 2 $fn$;
create function h() returns int language sql as $$ select 3 $$;
`;
const M2 = `
CREATE OR REPLACE FUNCTION public.f(a int, b text DEFAULT 'x,y')
 RETURNS int LANGUAGE sql AS $function$
  select   42
$function$;
drop function if exists public.h();
`;
const defs = latestDefinitions([{ file: 'a.sql', sql: M1 }, { file: 'b.sql', sql: M2 }]);

test('argument counting respects nested parens and quoted commas', () => {
  assert.equal(countArgs(''), 0);
  assert.equal(countArgs("a int, b text default 'x,y'"), 2);
  assert.equal(countArgs('numeric(10,2)'), 1);
});

test('comments never define a function; drops remove one; the latest file wins', () => {
  assert.deepEqual([...defs.keys()].sort(), ['f/2', 'g/1']);
  assert.equal(defs.get('f/2').file, 'b.sql');
  assert.equal(parseMigration(M1).filter((e) => e.name === 'commented_out').length, 0);
});

test('whitespace differences are not drift; a changed body, an extra live function and a missing one are reported', () => {
  const live = [
    { name: 'f', nargs: 2, body: ' select 42 ' },
    { name: 'g', nargs: 1, body: 'select 999' },
    { name: 'hot_patched', nargs: 1, body: 'select 7' },
  ];
  const r = compare(defs, live);
  assert.deepEqual(r.drifted.map((d) => d.name), ['g']);
  assert.deepEqual(r.unmigrated.map((d) => d.name), ['hot_patched']);
  assert.deepEqual(r.dropped, []);
  assert.equal(exitCode(r, false), 1);
  assert.equal(exitCode(compare(defs, [live[0], { name: 'g', nargs: 1, body: 'select 2' }, live[2]]), false), 0);
  assert.equal(exitCode(compare(defs, [live[0], { name: 'g', nargs: 1, body: 'select 2' }, live[2]]), true), 1);
  assert.equal(compare(defs, [live[0]]).dropped.map((d) => d.name).join(), 'g');
});

test('the report names functions and digests, never a body', () => {
  const r = compare(defs, [{ name: 'f', nargs: 2, body: 'select SECRET_BODY_TEXT' }]);
  const text = formatReport(r);
  assert.match(text, /f\/2\s+b\.sql\s+live=[0-9a-f]{12} migration=[0-9a-f]{12}/);
  assert.doesNotMatch(text, /SECRET_BODY_TEXT/);
});

test('offline CLI: --live-json against a migrations dir exits 1 on drift, 0 when clean, 2 without a live source', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'drift-'));
  writeFileSync(path.join(dir, '20260101000000_a.sql'), M1);
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), 'function-drift-check.mjs');
  const run = (live, extra = []) => {
    const file = path.join(dir, 'live.json'); writeFileSync(file, JSON.stringify(live));
    return spawnSync('node', [cli, '--migrations', dir, '--live-json', file, ...extra], { encoding: 'utf8' });
  };
  assert.equal(run([{ name: 'f', nargs: 2, body: 'select 1' }, { name: 'g', nargs: 1, body: 'select 2' }, { name: 'h', nargs: 0, body: 'select 3' }]).status, 0);
  assert.equal(run([{ name: 'f', nargs: 2, body: 'select 5' }]).status, 1);
  const noSource = spawnSync('node', [cli, '--migrations', dir], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(noSource.status, 2);
});
