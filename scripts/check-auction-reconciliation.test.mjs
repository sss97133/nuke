import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('actual daily reader reconciles native results and exposes missing known lots', () => {
  const host = process.env.PGHOST;
  assert(host === 'localhost' || host === '127.0.0.1' || host === '/private/tmp/nuke-daily-close-pg',
    'this assay requires a disposable local PostgreSQL service');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const database = 'nuke_soft_close_test';
  const created = spawnSync('createdb', [database], { cwd: root, encoding: 'utf8' });
  assert(created.status === 0 || created.stderr.includes('already exists'), created.stderr);
  const fixture = execFileSync('deno', ['run', 'supabase/sql/prepare_bat_public_live_fixture.ts', '--stdout'],
    { cwd: root, encoding: 'utf8' }).trim();
  const existing = readFileSync(`${root}supabase/sql/test_bat_public_live_events.sql`, 'utf8');
  // Reuse the established offline setup and real captured frames. All new
  // testimony lands through the same private canonical native intake.
  const setup = existing.slice(0, existing.indexOf('SET ROLE service_role;'))
    .replace("pg_read_file('/private/tmp/nuke-bat-prepared-fixture.json')::jsonb", ":'native_fixture'::jsonb");
  const migration = readFileSync(`${root}supabase/migrations/20261004225710_bat_daily_close_reconciliation.sql`, 'utf8');
  const assay = readFileSync(`${root}supabase/sql/test_bat_daily_close_reconciliation.sql`, 'utf8');
  const input = `${setup}\nALTER TABLE public.vehicle_events ADD COLUMN event_type text DEFAULT 'auction';\nGRANT USAGE ON SCHEMA public TO anon;\n${migration}\n${assay}`;
  const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-v', `native_fixture=${fixture}`, '-d', database],
    { cwd: `${root}supabase/sql`, input, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  assert(result.stdout.includes('daily close reconciliation passed'));
});
