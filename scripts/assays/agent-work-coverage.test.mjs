import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectAgentWork, AGENT_WORK_LIMITS } from './agent-work-coverage.mjs';

const NOW = Date.parse('2026-10-05T02:00:00Z');
const RUN = '20261005T010000Z';
const STAGES = { implemented: true, tested: true, merged: true, deployed: true, runtime_verified: true };
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'nuke-agent-work-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function write(directory, name, value, age = 60) {
  const file = join(directory, name);
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  utimesSync(file, new Date(NOW - age * 1000), new Date(NOW - age * 1000));
}
function completed(directory, overrides = {}, processOverrides = {}) {
  const report = { run_id: RUN, process_exit_code: 0, receipt_valid: true, reported_stages: STAGES,
    commit: 'a'.repeat(40), pr_url: 'https://github.com/sss97133/nuke/pull/584', ...overrides };
  write(directory, 'latest-process.json', { run_id: RUN, mode: 'code-refinement', state: 'exited', process_exit_code: 0, ...processOverrides });
  write(directory, 'latest-report.json', report);
  write(directory, `${RUN}.report.json`, report);
}

test('unconfigured, missing and empty lanes remain unknown', t => {
  assert.equal(inspectAgentWork({ now: NOW }).lanes.status, 'unknown');
  assert.equal(inspectAgentWork({ now: NOW }).worker.status, 'unknown');
  const directory = fixture(t);
  assert.deepEqual(inspectAgentWork({ lanesDirectory: directory, now: NOW }).lanes.reasons, ['no_lane_declarations']);
  assert.equal(inspectAgentWork({ workerStateDirectory: directory, now: NOW }).worker.status, 'unknown');
});

test('fresh and stale named lanes report declarations without asserting a live process', t => {
  const directory = fixture(t);
  write(directory, 'codex-current.md', 'Private task and proof text');
  write(directory, 'codex-completed.md', 'Completed yesterday', 10000);
  const result = inspectAgentWork({ lanesDirectory: directory, now: NOW });
  assert.equal(result.lanes.status, 'observed');
  assert.deepEqual(result.lanes.items.map(x => x.freshness), ['stale', 'fresh']);
  assert.ok(result.lanes.items.every(x => x.processIdentity === 'unknown'));
  assert.equal(JSON.stringify(result).includes('Private task'), false);
});

test('caps, empty files and symlinks cannot appear as healthy empty lanes', t => {
  const directory = fixture(t);
  write(directory, 'large.md', 'x'.repeat(AGENT_WORK_LIMITS.bytes + 1));
  write(directory, 'empty.md', '');
  symlinkSync(join(directory, 'empty.md'), join(directory, 'linked.md'));
  let result = inspectAgentWork({ lanesDirectory: directory, now: NOW });
  assert.equal(result.lanes.status, 'unknown');
  assert.ok(result.lanes.items.every(x => x.status === 'unknown'));
  for (let i = 0; i < 51; i++) write(directory, `lane-${i}.md`, 'task');
  result = inspectAgentWork({ lanesDirectory: directory, now: NOW });
  assert.deepEqual(result.lanes.reasons, ['file_count_cap_exceeded']);
});

test('a matching successful receipt retains reported stages but never independently verifies them', t => {
  const directory = fixture(t);
  completed(directory);
  const result = inspectAgentWork({ workerStateDirectory: directory, now: NOW }).worker;
  assert.equal(result.status, 'reported_completed');
  assert.deepEqual(result.reportedStages, STAGES);
  assert.equal(result.reportCopiesMatch, true);
  assert.equal(result.independentVerification, 'not_performed');
});

test('failed worker exits cannot retain claimed completion stages', t => {
  const directory = fixture(t);
  completed(directory, { process_exit_code: 124 }, { process_exit_code: 124 });
  const result = inspectAgentWork({ workerStateDirectory: directory, now: NOW }).worker;
  assert.equal(result.status, 'reported_failed');
  assert.equal(result.reportedStages, null);
});

test('different run, mismatching archive, invalid JSON and nonmonotonic stages stay unknown', t => {
  const directory = fixture(t);
  completed(directory, { run_id: '20261004T010000Z' });
  assert.deepEqual(inspectAgentWork({ workerStateDirectory: directory, now: NOW }).worker.reasons, ['run_or_exit_mismatch']);
  completed(directory);
  write(directory, `${RUN}.report.json`, '{}');
  assert.deepEqual(inspectAgentWork({ workerStateDirectory: directory, now: NOW }).worker.reasons, ['report_hash_mismatch']);
  write(directory, 'latest-process.json', '{broken');
  assert.deepEqual(inspectAgentWork({ workerStateDirectory: directory, now: NOW }).worker.reasons, ['invalid_json']);
  completed(directory, { reported_stages: { ...STAGES, tested: false } });
  assert.equal(inspectAgentWork({ workerStateDirectory: directory, now: NOW }).worker.status, 'unknown');
});

test('running PID existence is qualified, and an old running declaration is unknown', t => {
  const directory = fixture(t);
  const running = { run_id: RUN, mode: 'code-refinement', state: 'running', pid: process.pid };
  write(directory, 'latest-process.json', running);
  let result = inspectAgentWork({ workerStateDirectory: directory, now: NOW }).worker;
  assert.equal(result.status, 'reported_running');
  assert.equal(result.processExists, true);
  assert.equal(result.processIdentity, 'unknown');
  write(directory, 'latest-process.json', running, 10000);
  result = inspectAgentWork({ workerStateDirectory: directory, now: NOW }).worker;
  assert.equal(result.status, 'unknown');
  assert.deepEqual(result.reasons, ['stale_running_declaration']);
});

test('future file clocks and directories posing as artifacts remain unknown', t => {
  const directory = fixture(t);
  completed(directory);
  write(directory, 'latest-process.json', { run_id: RUN, mode: 'code-refinement' }, -10);
  assert.deepEqual(inspectAgentWork({ workerStateDirectory: directory, now: NOW }).worker.reasons, ['future_artifact_clock']);
  const other = fixture(t);
  mkdirSync(join(other, 'latest-process.json'));
  assert.equal(inspectAgentWork({ workerStateDirectory: other, now: NOW }).worker.status, 'unknown');
  assert.throws(() => inspectAgentWork({ now: 'invalid' }), /measurement time/);
});
