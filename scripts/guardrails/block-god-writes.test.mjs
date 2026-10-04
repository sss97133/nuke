import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const hook = fileURLToPath(new URL('./block-god-writes.sh', import.meta.url));
const run = (tool_name, tool_input) => spawnSync('bash', [hook], {
  input: JSON.stringify({ tool_name, tool_input }), encoding: 'utf8', timeout: 3000,
});

for (const tool of [
  'mcp__supabase__execute_sql',
  'mcp__claude_ai_Supabase__execute_sql',
  'mcp__codex_apps__supabase_execute_sql',
]) {
  test(`${tool} blocks raw testimony mutations and permits reads`, () => {
    for (const query of [
      'INSERT INTO vehicle_observations (id) VALUES (gen_random_uuid());',
      'UPDATE public.vehicle_observations SET vehicle_id = NULL;',
      'DELETE FROM auction_comments WHERE false;',
    ]) {
      const result = run(tool, { query });
      assert.equal(result.status, 2, `${query}: ${result.stderr}`);
      assert.match(result.stderr, /BLOCKED/);
    }
    assert.equal(run(tool, { query: 'BEGIN READ ONLY; SELECT 1; COMMIT;' }).status, 0);
  });
}

test('every Supabase connector blocks hand-applied migrations and deploys', () => {
  for (const prefix of ['mcp__supabase__', 'mcp__claude_ai_Supabase__', 'mcp__codex_apps__supabase_']) {
    for (const action of ['apply_migration', 'deploy_edge_function']) {
      const result = run(prefix + action, {});
      assert.equal(result.status, 2, `${prefix}${action}: ${result.stderr}`);
      assert.match(result.stderr, /skips CI/);
    }
  }
});

test('Bash and unified exec inspect their actual command field', () => {
  for (const [tool, field] of [['Bash', 'command'], ['exec_command', 'cmd'], ['functions.exec_command', 'cmd']]) {
    assert.equal(run(tool, { [field]: 'psql -c "DELETE FROM vehicle_images WHERE false"' }).status, 2);
    assert.equal(run(tool, { [field]: 'node --test scripts/guardrails/block-god-writes.test.mjs' }).status, 0);
  }
});

test('unrelated tools remain usable', () => {
  assert.equal(run('mcp__github__fetch', { query: 'DELETE FROM vehicle_observations' }).status, 0);
});

test('existing deliberate maintenance marker retains its behavior', () => {
  assert.equal(run('mcp__supabase__execute_sql', {
    query: '-- ALLOW_RAW_TESTIMONY_WRITE\nUPDATE vehicle_observations SET is_superseded=true;',
  }).status, 0);
});
