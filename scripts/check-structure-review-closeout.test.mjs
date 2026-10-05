import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('late recovery preserves the stale-read fence and raw comment caches remain service-only', () => {
  assert.equal(process.env.PGHOST, '/private/tmp/nuke-review-closeout-pg',
    'this assay requires its disposable local PostgreSQL service');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const database = 'nuke_soft_close_test';
  const created = spawnSync('createdb', [database], { cwd: root, encoding: 'utf8' });
  assert(created.status === 0 || created.stderr.includes('already exists'), created.stderr);
  const fixture = execFileSync('deno', ['run', 'supabase/sql/prepare_bat_public_live_fixture.ts', '--stdout'],
    { cwd: root, encoding: 'utf8' }).trim();
  const existing = readFileSync(`${root}supabase/sql/test_bat_public_live_events.sql`, 'utf8')
    .replace("pg_read_file('/private/tmp/nuke-bat-prepared-fixture.json')::jsonb", ":'native_fixture'::jsonb");
  const migration = readFileSync(`${root}supabase/migrations/20261005004554_fix_live_watermark_and_comment_cache_readers.sql`, 'utf8');
  const assay = readFileSync(`${root}supabase/sql/test_structure_review_closeout.sql`, 'utf8');
  const boundary = existing.indexOf('SET ROLE service_role;');
  // The existing native intake/fold suite runs against the replacement function.
  // Cache/parent setup recreates the live public-read defect before applying it.
  const split = assay.indexOf('-- Acceptance cases');
  const input = `${existing.slice(0, boundary)}\n${assay.slice(0, split)}\n${migration}\n${existing.slice(boundary)}\n${assay.slice(split)}`;
  const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-v', `native_fixture=${fixture}`, '-d', database],
    { cwd: `${root}supabase/sql`, input, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  for (const receipt of ['bat public live intake/fold/coverage assays passed',
    'late recovery and HTML stale-read assays passed', 'raw cache and parent authorization assays passed']) {
    assert(result.stdout.includes(receipt), receipt);
  }
});
