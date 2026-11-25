// node --test scripts/guardrails/cron-notice-prefix.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cronCommands, statementCount, noticePath, warnings, functionIndex } from './cron-notice-prefix.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const idx = new Map([
  ['dominoes_begin', { body: "create function dominoes_begin() as $$ begin DROP TABLE IF EXISTS pg_temp._dom; end $$" }],
  ['fold_outer', { body: "create function fold_outer() as $$ begin perform fold_inner(); end $$" }],
  ['fold_inner', { body: "create function fold_inner() as $$ begin create temp table if not exists x (a int); end $$" }],
  ['quiet', { body: "create function quiet() as $$ begin if exists (select 1) then return; end if; end $$" }],
]);

test('the 526 shape warns: SET then a function that drops a temp table if it exists', () => {
  const sql = `SELECT cron.schedule('snapshot-stack-dominoes', '25 4 * * *', $$SET statement_timeout = '120s'; SELECT public.dominoes_begin('x'); SELECT 1;$$);`;
  const w = warnings(sql, idx);
  assert.equal(w.length, 1);
  assert.equal(w[0].via, 'cron.schedule');
  assert.match(w[0].path.join('>'), /dominoes_begin: drop table if exists/);
});

test('a notice two calls deep warns (the 646 shape), through cron.alter_job command :=', () => {
  const sql = `SELECT cron.alter_job(job_id := 646, command := 'SET statement_timeout = ''25min''; SELECT public.fold_outer();');`;
  const w = warnings(sql, idx);
  assert.equal(w.length, 1);
  assert.deepEqual(w[0].path, ['fold_outer', 'fold_inner: create temp table if not exists']);
});

test('the prefix, a single statement, a plpgsql IF EXISTS test and an unknown function do not warn', () => {
  assert.equal(warnings(`select cron.schedule('a', '* * * * *', $$SET client_min_messages = error; SET statement_timeout = '1s'; SELECT dominoes_begin();$$);`, idx).length, 0);
  assert.equal(warnings(`select cron.schedule('a', '* * * * *', 'SELECT public.dominoes_begin()');`, idx).length, 0);
  assert.equal(warnings(`select cron.schedule('a', '* * * * *', 'SET statement_timeout = ''5s''; SELECT quiet()');`, idx).length, 0);
  assert.equal(warnings(`select cron.schedule('a', '* * * * *', 'SET statement_timeout = ''5s''; SELECT not_in_repo()');`, idx).length, 0);
});

test('the literal reader handles doubled quotes, dollar tags and the two-argument schedule', () => {
  const c = cronCommands(`select cron.schedule('j', '*/5 * * * *', 'SET a = ''x;y''; SELECT f()'); select cron.schedule('* * * * *', $t$SELECT g()$t$);`);
  assert.deepEqual(c.map((x) => x.command), ["SET a = 'x;y'; SELECT f()", 'SELECT g()']);
  assert.equal(statementCount(c[0].command), 2);
  assert.equal(statementCount(c[1].command), 1);
});

test('the shipped fixes pass and the live 526 command, unprefixed, would have warned', () => {
  const real = functionIndex();
  for (const f of ['20261125041500_cron_526_no_client_notices.sql', '20261125051500_cron_646_no_client_notices.sql']) {
    const p = path.join(ROOT, 'supabase/migrations', f);
    if (fs.existsSync(p)) assert.equal(warnings(fs.readFileSync(p, 'utf8'), real).length, 0, f);
  }
  const old526 = `select cron.schedule('snapshot-stack-dominoes', '25 4 * * *', $$SET statement_timeout = '120s'; SELECT public.snapshot_stack_coverage('cron'); SELECT public.snapshot_stack_dominoes_begin('cron'); SELECT public.snapshot_stack_dominoes_finish();$$);`;
  const w = warnings(old526, real);
  assert.equal(w.length, 1);
  assert.match(w[0].path.join('>'), /snapshot_stack_dominoes_begin: drop table if exists/);
});

test('a guardrail-allow(cron-notice) marker naming the first called function lets one command through', () => {
  const sql = `-- guardrail-allow(cron-notice): dominoes_begin: the drop notice is read by the operator on purpose
select cron.schedule('a', '* * * * *', $$SET statement_timeout = '1s'; SELECT dominoes_begin(); SELECT 1;$$);
select cron.schedule('b', '* * * * *', $$SET statement_timeout = '1s'; SELECT fold_outer();$$);`;
  const w = warnings(sql, idx);
  assert.equal(w.length, 1);
  assert.equal(w[0].path[0], 'fold_outer');
});
