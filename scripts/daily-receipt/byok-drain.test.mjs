import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const source = dirname(fileURLToPath(import.meta.url));
const vehicle = '11111111-1111-4111-8111-111111111111';
// Run the real shell scripts with only their external/network boundaries replaced.
// Exported shell functions take precedence over the production script's PATH.
const mocks = [
  "",
  "sleep(){ :; }",
  "dotenvx(){",
  "  shift 2",
  "  if [ \"${2:-}\" = scripts/classify-image-subjects.mjs ] && [ \"${3:-}\" = prepare ]; then",
  "    echo '{\"frames\":[{\"image_id\":\"22222222-2222-4222-8222-222222222222\"}],\"candidates\":[{\"n\":1,\"label\":\"Synthetic\"}]}'",
  "    return 0",
  "  fi",
  "  if [ \"$1\" = python3 ]; then return 0; fi",
  "  case \"${3:-}\" in",
  "    resolve)",
  "      [ \"${FAKE_RESOLVE_FAIL:-0}\" = 0 ] || return 1",
  "      echo NUKE_ANALYSIS_METHOD=nuke_hosted",
  "      echo NUKE_ANALYSIS_ENABLED=1 ;;",
  "    queue)",
  "      [ \"${FAKE_QUEUE_FAIL:-0}\" = 0 ] || return 1",
  "      [ \"${FAKE_EMPTY:-0}\" = 1 ] || echo \"$FAKE_VEHICLE\" ;;",
  "    prepare)",
  "      [ \"${FAKE_PREP_FAIL:-0}\" = 0 ] || return 1",
  "      local dest=''",
  "      while [ \"$#\" -gt 0 ]; do",
  "        if [ \"$1\" = --worklist ]; then dest=\"$2\"; break; fi",
  "        shift",
  "      done",
  "      [ \"${FAKE_EMPTY:-0}\" = 0 ] || return 0",
  "      echo '{\"image_id\":\"22222222-2222-4222-8222-222222222222\",\"file_name\":\"synthetic.jpg\",\"taken_at\":null,\"created_at\":null}' > \"$dest\"",
  "      if [ \"${FAKE_PREP_TWO:-0}\" = 1 ]; then",
  "        echo '{\"image_id\":\"33333333-3333-4333-8333-333333333333\",\"file_name\":\"synthetic2.jpg\",\"taken_at\":null,\"created_at\":null}' >> \"$dest\"",
  "      fi ;;",
  "    context) return 0 ;;",
  "    ingest)",
  "      echo attempted >> \"$FAKE_INGEST_MARKER\"",
  "      if [ \"${FAKE_MISSING_RECEIPT:-0}\" = 0 ]; then",
  "        echo \"ingest: wrote ${FAKE_WROTE:-1}, failed ${FAKE_FAILED:-0} from synthetic\"",
  "      fi",
  "      return \"${FAKE_INGEST_EXIT:-0}\" ;;",
  "    *)",
  "      # Post-ingest phash/fold boundaries are deliberately inert.",
  "      [ \"${2:-}\" = -e ] || { echo unexpected_mock_command >&2; return 99; } ;;",
  "  esac",
  "}",
  "env(){",
  "  [ \"${1:-}\" = -u ] && [ \"${2:-}\" = CLAUDE_EFFORT ] || return 99",
  "  local dir=''",
  "  while [ \"$#\" -gt 0 ]; do",
  "    if [ \"$1\" = --add-dir ]; then dir=\"$2\"; break; fi",
  "    shift",
  "  done",
  "  cat >/dev/null",
  "  if [ \"${FAKE_VERDICTS:-0}\" = 1 ]; then",
  "    echo '{\"image_id\":\"22222222-2222-4222-8222-222222222222\",\"scene_type\":\"unknown\",\"build_phase_guess\":\"unknown\",\"intent\":\"unknown\"}' > \"$dir/verdicts.jsonl\"",
  "  fi",
  "  printf '%s\\n' \"$FAKE_RESULT\"",
  "  printf '%s\\n' \"${FAKE_STDERR:-}\" >&2",
  "  return \"${FAKE_CLAUDE_EXIT:-0}\"",
  "}",
  "export -f sleep dotenvx env",
  ""
].join("\n");

function run(script, overrides = {}, batchStatuses = '1', args = []) {
  const root = mkdtempSync(join(tmpdir(), 'byok-offline-'));
  const scripts = join(root, 'scripts', 'daily-receipt');
  mkdirSync(scripts, { recursive: true });
  mkdirSync(join(root, 'logs'));
  const init = join(root, 'mocks.sh');
  writeFileSync(init, mocks);
  copyFileSync(join(source, script), join(scripts, script));
  writeFileSync(join(scripts, 'byok-vision-prompt.md'), 'Synthetic offline contract.');
  const attempts = join(root, 'attempts');
  if (script === 'byok-cloud-drain.sh') {
    writeFileSync(join(scripts, 'byok-image-batch.sh'), [
  "#!/bin/bash",
  "n=0",
  "[ ! -f \"$FAKE_ATTEMPTS\" ] || n=$(cat \"$FAKE_ATTEMPTS\")",
  "n=$((n + 1)); echo \"$n\" > \"$FAKE_ATTEMPTS\"",
  "IFS=, read -r -a statuses <<< \"$FAKE_BATCH_STATUSES\"",
  "index=$((n - 1)); [ \"$index\" -lt \"${#statuses[@]}\" ] || index=$((${#statuses[@]} - 1))",
  "exit \"${statuses[$index]}\"",
  ""
].join("\n"));
  }
  try {
    // A test-only shard index isolates the shell lock from real local workers.
    const scriptArgs = script === 'byok-image-batch.sh' ? ['1', String(process.pid)] : args;
    const result = spawnSync('/bin/bash', [join(scripts, script), vehicle, '1', ...scriptArgs], {
      cwd: root, encoding: 'utf8', timeout: 10_000,
      env: {
        PATH: process.env.PATH, HOME: process.env.HOME, BASH_ENV: init,
        NUKE_LOG_DIR: join(root, 'logs'), CLAUDE_CODE_OAUTH_TOKEN: 'offline',
        FAKE_VEHICLE: vehicle, FAKE_INGEST_MARKER: join(root, 'ingest-marker'),
        FAKE_ATTEMPTS: attempts, FAKE_BATCH_STATUSES: batchStatuses,
        FAKE_RESULT: JSON.stringify({ type: 'result', subtype: 'success', is_error: false }),
        GITHUB_STEP_SUMMARY: join(root, 'summary'),
        ...overrides,
      },
    });
    assert.ifError(result.error);
    return {
      status: result.status, output: result.stdout + result.stderr,
      log: existsSync(join(root, 'logs', 'byok-image-batch.log')) ? readFileSync(join(root, 'logs', 'byok-image-batch.log'), 'utf8') : '',
      attempts: existsSync(attempts) ? Number(readFileSync(attempts, 'utf8')) : 0,
      ingested: existsSync(join(root, 'ingest-marker')),
      summary: existsSync(join(root, 'summary')) ? readFileSync(join(root, 'summary'), 'utf8') : '',
    };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('cloud stops after three failing batches, not hundreds, and exits failed', () => {
  const r = run('byok-cloud-drain.sh', {}, '1', ['45']);
  assert.equal(r.status, 1); assert.equal(r.attempts, 3);
  assert.match(r.output, /outcome=failed batches=0 failures=3 attempts=3 remaining=1/);
});

test('empty subject classification aborts once without malformed count or ingest', () => {
  const r = run('subject-classify-batch.sh', { FAKE_CLAUDE_EXIT: '1' });
  assert.equal(r.status, 1);
  assert.match(r.output, /no classifications produced — abort ingest/);
  assert.doesNotMatch(r.output, /integer expression expected|classifications; ingesting/);
  assert.equal(r.ingested, false);
});
test('unexpected nonzero batch exit cannot count as successful work', () => {
  const r = run('byok-cloud-drain.sh', {}, '137', ['45']);
  assert.equal(r.status, 1); assert.equal(r.attempts, 3);
  assert.match(r.output, /batches=0 failures=3/);
});
test('known quota deferral stops after one attempt and never claims completion', () => {
  const r = run('byok-cloud-drain.sh', {}, '4', ['45']);
  assert.equal(r.status, 0); assert.equal(r.attempts, 1);
  assert.match(r.output, /outcome=deferred_quota batches=0 failures=0 attempts=1 remaining=1/);
  assert.doesNotMatch(r.output, /outcome=complete|all vehicles drained/);
  assert.match(r.summary, /quota is unavailable.*analysis remains incomplete/);
});
test('quota deferral after some verified work still leaves remaining work explicit', () => {
  const r = run('byok-cloud-drain.sh', {}, '0,4', ['45']);
  assert.equal(r.status, 0); assert.equal(r.attempts, 2);
  assert.match(r.output, /outcome=deferred_quota batches=1 failures=0 attempts=2 remaining=1/);
});
test('later quota deferral cannot hide an earlier genuine batch failure', () => {
  const r = run('byok-cloud-drain.sh', {}, '1,4', ['45']);
  assert.equal(r.status, 1); assert.equal(r.attempts, 2);
  assert.match(r.output, /outcome=failed batches=0 failures=1 attempts=2 remaining=1/);
});
test('successful batch followed by verified drain completes', () => {
  const r = run('byok-cloud-drain.sh', {}, '0,3', ['45']);
  assert.equal(r.status, 0); assert.equal(r.attempts, 2);
  assert.match(r.output, /outcome=complete batches=1 failures=0/);
});
test('verified empty queue succeeds without invoking a batch', () => {
  const r = run('byok-cloud-drain.sh', { FAKE_EMPTY: '1' }, '1', ['45']);
  assert.equal(r.status, 0); assert.equal(r.attempts, 0);
});
for (const flag of ['FAKE_RESOLVE_FAIL', 'FAKE_QUEUE_FAIL']) {
  test(`${flag} fails instead of masquerading as no work`, () => {
    const r = run('byok-cloud-drain.sh', { [flag]: '1' }, '1', ['45']);
    assert.equal(r.status, 1); assert.equal(r.attempts, 0);
  });
}
test('time budget with eligible work is incomplete, never green', () => {
  const r = run('byok-cloud-drain.sh', {}, '0', ['0']);
  assert.equal(r.status, 2); assert.match(r.output, /outcome=incomplete/);
});
test('failure budget rejects unlimited/invalid values before work', () => {
  const r = run('byok-cloud-drain.sh', { BYOK_MAX_FAILURES: '0' }, '1', ['45']);
  assert.equal(r.status, 1); assert.equal(r.attempts, 0);
});
test('custom failure budget remains finite', () => {
  const r = run('byok-cloud-drain.sh', { BYOK_MAX_FAILURES: '2' }, '1', ['45']);
  assert.equal(r.status, 1); assert.equal(r.attempts, 2);
});
test('a recovered retry still reports the failed attempt honestly', () => {
  const r = run('byok-cloud-drain.sh', {}, '1,0,3', ['45']);
  assert.equal(r.status, 1); assert.equal(r.attempts, 3);
  assert.match(r.output, /outcome=failed batches=1 failures=1 attempts=3 remaining=0/);
});
test('legacy batch invocation stops before model or persistence', () => {
  const r = run('byok-image-batch.sh');
  assert.equal(r.status, 2); assert.equal(r.ingested, false);
  assert.match(r.output, /Legacy raw batch retired; no model or writes started/);
});
