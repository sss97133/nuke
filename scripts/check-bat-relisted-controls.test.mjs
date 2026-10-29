import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('canonical native receipts retire relisted locator monitors without hiding unresolved or historical failures', () => {
  const host = process.env.PGHOST;
  assert(['localhost', '127.0.0.1'].includes(host) || host?.startsWith('/private/tmp/nuke-native-owner-'),
    'this contract requires the disposable local PostgreSQL service');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const database = 'nuke_soft_close_test';
  // Each assay starts from a fresh database; an earlier assay in the same job leaves one behind.
  const dropped = spawnSync('dropdb', ['--if-exists', database], { cwd: root, encoding: 'utf8' });
  assert(dropped.status === 0, dropped.stderr);
  const created = spawnSync('createdb', [database], { cwd: root, encoding: 'utf8' });
  assert(created.status === 0, created.stderr);
  const fixture = execFileSync('deno', ['run', '--cached-only', '--node-modules-dir=none',
    'supabase/sql/prepare_bat_public_live_fixture.ts', '--stdout'], { cwd: root, encoding: 'utf8' }).trim();
  const read = path => readFileSync(root + path, 'utf8');
  const existing = read('supabase/sql/test_bat_live_relisted_lot_fold.sql');
  const first = existing.indexOf('-- 1. The incident:');
  const firstBegin = existing.indexOf('BEGIN;', first);
  const firstEnd = existing.indexOf('\nRESET ROLE;', firstBegin) + '\nRESET ROLE;'.length;
  assert(first > 0 && firstBegin > first && firstEnd > firstBegin);
  const setup = existing.slice(0, first);
  // Reuse the established guarded fixture and its actual six-frame intake.
  // New scenarios below change only derived monitor/entity controls.
  const intake = existing.slice(firstBegin, firstEnd);
  const second = existing.indexOf('-- 2. A lot held by two vehicles');
  const duplicateBegin = existing.indexOf('BEGIN;', second) + 'BEGIN;'.length;
  const duplicateEnd = existing.indexOf('SET LOCAL ROLE service_role;', duplicateBegin);
  assert(second > firstEnd && duplicateEnd > duplicateBegin);
  const duplicates = existing.slice(duplicateBegin, duplicateEnd);
  const definition = (path, signature) => {
    const source = read(path);
    const start = source.indexOf('CREATE OR REPLACE FUNCTION public.' + signature);
    assert(start >= 0, signature);
    const tail = source.slice(start);
    const opening = /\bAS\s+(\$[a-zA-Z_0-9]*\$)/i.exec(tail);
    assert(opening, signature);
    const close = tail.indexOf(opening[1] + ';', opening.index + opening[0].length);
    assert(close > opening.index, signature);
    return tail.slice(0, close + opening[1].length + 1);
  };
  const current = [
    definition('supabase/migrations/20261016000100_bat_live_pull_stable_lock_order.sql', 'bat_live_pull_run('),
    definition('supabase/migrations/20261014090000_job_health_run_digest_and_assay_readings.sql', 'get_live_auction_health(p_day date)'),
    definition('supabase/migrations/20261004225710_bat_daily_close_reconciliation.sql', 'get_live_auction_health()'),
  ].join('\n');
  const assay = read('supabase/sql/test_bat_relisted_controls.sql')
    .replace('-- EXISTING_DUPLICATE_HOLDER_FIXTURE', duplicates);
  const input = [setup,
    'ALTER TABLE cron.job_run_details ADD COLUMN runid bigint DEFAULT 1;',
    'ALTER TABLE public.vehicle_observations ADD COLUMN is_superseded boolean DEFAULT false;',
    "ALTER TABLE public.vehicle_events ADD COLUMN event_type text DEFAULT 'auction';",
    current, intake, 'COMMIT;', assay].join('\n');
  const psql = sql => spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-v',
    'bat_fixture_json=' + fixture, '-d', database],
  { cwd: root + 'supabase/sql', input: sql, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  const result = psql(input);
  assert.equal(result.status, 0, result.stderr);
  for (const receipt of ['relisted monitor control and health contracts passed',
    'unqualified and conflicting native receipts remain visible',
    'historical lateness and function authority preserved']) assert(result.stdout.includes(receipt), receipt);

  // A changed reviewed predicate must refuse the whole migration. Closing the
  // failed connection rolls this disposable function edit back.
  const reviewed = psql("SELECT md5(pg_get_functiondef('public.get_live_auction_health(date)'::regprocedure));");
  assert.equal(reviewed.status, 0, reviewed.stderr);
  const drift = psql([
    'BEGIN;',
    'DO $drift$ DECLARE body text; BEGIN',
    "SELECT pg_get_functiondef('public.get_live_auction_health(date)'::regprocedure) INTO body;",
    "EXECUTE replace(body,'native_receipt.kind=''sale_result''','native_receipt.kind=''comment''');",
    'END $drift$;',
    '\\ir ../migrations/20261021231915_bat_relisted_control_receipts.sql',
  ].join('\n'));
  assert.notEqual(drift.status, 0);
  assert.match(drift.stderr, /Refusing drifted function/);
  const after = psql("SELECT md5(pg_get_functiondef('public.get_live_auction_health(date)'::regprocedure));");
  assert.equal(after.status, 0, after.stderr);
  assert.equal(after.stdout, reviewed.stdout, 'failed drift transaction leaves the reviewed function intact');
});
