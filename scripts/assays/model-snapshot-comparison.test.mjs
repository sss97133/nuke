import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildCaseContract, compareModelSnapshots } from './model-snapshot-comparison.mjs';
import { options, runMonitor } from './data-model-coverage.mjs';

const cases = () => ({ asOf: '2026-10-05T00:00:00Z', requests: [
  { key: 'claim', field: 'engine_size', observationId: 'private-source-id' },
] });
const snapshot = (minute = '00') => {
  const at = `2026-10-05T00:${minute}:00Z`, completed = `2026-10-05T00:${minute}:01Z`;
  return { version: 'data_model_coverage_v1',
    database: { scope: { tables: ['vehicle_observations'], jobs: ['metric-fold'] } },
    evidence: { caseContract: buildCaseContract(cases()), healthSQLSha256: 'a'.repeat(64),
      jobHealthSQLSha256: 'b'.repeat(64), reconciliationSQLSha256: 'c'.repeat(64),
      sections: Object.fromEntries(['metadata', 'jobHealth', 'sourceToReader'].map((name, i) => [name, {
        status: i === 2 ? 'returned' : 'measured', startedAt: at, completedAt: completed,
        sqlSha256: ['a', 'b', 'c'][i].repeat(64), ...(i === 2 ? { cutoffAt: at } : {}),
      }])) },
    sourceToReader: { schemaVersion: 'intake_reader_reconciliation_v1', status: 'measured_request_set',
      requestedItems: 1, readerBasis: 'bounded current reader', executionRole: 'postgres', scope: 'explicit requests', asOf: at,
      items: [{ key: 'claim', field: 'engine_size', stage: 'exposed', clocks: { observationState: 'within_cutoff' },
        retention: { originalObservation: true }, reader: { specsReference: true, specsValueCurrent: true, foldAfterCutoff: false },
        requestedRelations: { basis: 'explicit_requested_relations_only', checks: { vehicle: 'passed', capture: 'passed',
          episode: 'not_requested', property: 'not_requested', sourceRole: 'not_requested', captureClock: 'passed', sourceHeaderDigest: 'passed' } },
      }] },
  };
};
const item = receipt => receipt.sourceToReader.items[0];
const pair = () => [snapshot(), snapshot('05')];

test('same frozen inputs ignore only advancing cutoff and object/request order', () => {
  const first = cases(); first.requests.push({ key: 'other', field: 'mileage' });
  const second = { requests: [...first.requests].reverse(), asOf: '2026-10-05T00:05:00Z' };
  assert.deepEqual(buildCaseContract(first), buildCaseContract(second));
  const result = compareModelSnapshots(...pair());
  assert.equal(result.status, 'unchanged'); assert.equal(result.counts.unchanged, 6);
  assert.equal(result.causationEstablished, false); assert.equal(result.engineeringDeliveryVerified, false);
});

test('an observed failed check becoming passed is improvement only for the bound acceptance cases', () => {
  const [before, after] = pair(); item(before).requestedRelations.checks.capture = 'failed';
  const result = compareModelSnapshots(before, after);
  assert.equal(result.status, 'improved'); assert.equal(result.scope, 'fixed_source_case_acceptance');
  assert.equal(result.counts.improved, 1); assert.equal(result.counts.coverageGained, 0);
  assert.equal(JSON.stringify(result).includes('private-source-id'), false);
});

test('known regressions survive other unknown checks and unavailable metadata', () => {
  const [before, after] = pair();
  after.database = null; after.evidence.sections.metadata.status = 'unavailable';
  item(after).requestedRelations.checks.capture = 'failed'; item(after).reader.specsValueCurrent = null;
  const result = compareModelSnapshots(before, after);
  assert.equal(result.status, 'regressed'); assert.equal(result.counts.regressed, 1);
  assert.ok(result.counts.uncomparable > 0); assert.ok(result.reasons.includes('database_scope_unavailable'));
});

test('unavailable sections never yield an overall improvement verdict', () => {
  for (const section of ['metadata', 'jobHealth', 'sourceToReader']) {
    const [before, after] = pair(); item(before).requestedRelations.checks.capture = 'failed';
    after.evidence.sections[section].status = 'unavailable';
    assert.equal(compareModelSnapshots(before, after).status, 'uncomparable');
  }
});

test('unknown to measured passed is coverage gained, never repaired', () => {
  const [before, after] = pair(); item(before).requestedRelations.checks.capture = 'unmeasured';
  const result = compareModelSnapshots(before, after);
  assert.equal(result.status, 'uncomparable'); assert.equal(result.counts.improved, 0); assert.equal(result.counts.coverageGained, 1);
  item(before).requestedRelations.checks.capture = 'not_requested';
  assert.equal(compareModelSnapshots(before, after).counts.coverageGained, 0);
});

test('missing, forged, duplicated and replaced case fingerprints refuse comparison', () => {
  const mutations = [
    value => { delete value.evidence.caseContract; },
    value => { value.evidence.caseContract.members[0].requestSha256 = 'd'.repeat(64); },
    value => { value.evidence.caseContract.members.push({ ...value.evidence.caseContract.members[0] }); },
    value => { const doc = cases(); doc.requests[0].observationId = 'different'; value.evidence.caseContract = buildCaseContract(doc); },
    value => { const doc = cases(); doc.policy = 'changed'; value.evidence.caseContract = buildCaseContract(doc); },
  ];
  for (const mutate of mutations) {
    const [before, after] = pair(); item(before).requestedRelations.checks.capture = 'failed'; mutate(after);
    const result = compareModelSnapshots(before, after);
    assert.equal(result.status, 'uncomparable'); assert.equal(result.counts.improved, 0);
  }
  const duplicate = cases(); duplicate.requests.push({ ...duplicate.requests[0] });
  assert.equal(buildCaseContract(duplicate), null);
});

test('missing, duplicated and substituted returned cases cannot look repaired', () => {
  for (const mutate of [
    value => { value.sourceToReader.items = []; },
    value => { value.sourceToReader.items.push(structuredClone(item(value))); },
    value => { item(value).key = 'replacement'; },
  ]) {
    const [before, after] = pair(); item(before).requestedRelations.checks.capture = 'failed'; mutate(after);
    const result = compareModelSnapshots(before, after);
    assert.equal(result.status, 'uncomparable'); assert.equal(result.counts.improved, 0);
  }
});

test('changed scopes, SQL, execution policy or source section digest cannot pass', () => {
  for (const mutate of [
    value => { value.database.scope.tables = ['other_table']; },
    value => { value.evidence.reconciliationSQLSha256 = 'd'.repeat(64); },
    value => { value.evidence.sections.sourceToReader.sqlSha256 = 'd'.repeat(64); },
    value => { value.sourceToReader.executionRole = 'anon'; },
    value => { value.sourceToReader.readerBasis = 'different reader'; },
  ]) {
    const [before, after] = pair(); mutate(after);
    assert.equal(compareModelSnapshots(before, after).status, 'uncomparable');
  }
});

test('backward cutoffs, reversed snapshot order and missing clocks refuse improvement', () => {
  for (const mutate of [
    value => { value.sourceToReader.asOf = '2026-10-04T00:00:00Z'; },
    value => { value.evidence.sections.sourceToReader.completedAt = null; },
    value => { value.evidence.sections.metadata.startedAt = '2026-10-04T00:00:00Z'; },
  ]) {
    const [before, after] = pair(); item(before).requestedRelations.checks.capture = 'failed'; mutate(after);
    assert.equal(compareModelSnapshots(before, after).status, 'uncomparable');
  }
});

test('reader exposure outside the admissible observation clock or retention is unknown', () => {
  for (const mutate of [
    value => { item(value).clocks.observationState = 'after_cutoff'; },
    value => { item(value).retention.originalObservation = false; },
    value => { item(value).reader.foldAfterCutoff = true; },
    value => { item(value).stage = 'retention_unestablished'; },
  ]) {
    const [before, after] = pair(); mutate(after);
    const result = compareModelSnapshots(before, after);
    assert.equal(result.status, 'uncomparable'); assert.equal(result.counts.regressed, 0);
  }
});

test('offline runner makes no live calls, writes exclusively/private and returns bounded verdicts', () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'nuke-comparison-'));
  try {
    const beforePath = join(dir, 'before.json'), afterPath = join(dir, 'after.json');
    const [before, after] = pair();
    const dependencies = { query: () => assert.fail('no live query'), inspect: () => assert.fail('no agent inspection') };
    for (const [state, code] of [['passed', 0], ['failed', 1], ['unknown', 2]]) {
      item(after).requestedRelations.checks.capture = state;
      writeFileSync(beforePath, JSON.stringify(before)); writeFileSync(afterPath, JSON.stringify(after));
      const out = join(dir, `${state}.json`), args = ['--before', beforePath, '--after', afterPath, '--out', out];
      assert.equal(runMonitor(args, dependencies).exitCode, code);
      assert.equal(statSync(out).mode & 0o777, 0o600);
      const bytes = readFileSync(out, 'utf8');
      assert.throws(() => runMonitor(args, dependencies), /EEXIST/); assert.equal(readFileSync(out, 'utf8'), bytes);
      if (code === 0) {
        const summary = JSON.parse(execFileSync('bash', ['scripts/check-ingestion-health.sh', '--data-model',
          '--before', beforePath, '--after', afterPath, '--out', join(dir, 'cli.json')], { encoding: 'utf8' }));
        assert.equal(summary.status, 'unchanged');
        assert.equal(summary.version, 'model_snapshot_comparison_v1');
        assert.equal(JSON.stringify(summary).includes('private-source-id'), false);
      }
    }
  } finally { rmSync(dir, { recursive: true }); }
});

test('offline inputs reject links, linked parents, oversized files and raw private errors', () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'nuke-comparison-boundary-'));
  try {
    const valid = join(dir, 'valid.json'); writeFileSync(valid, JSON.stringify(snapshot()));
    const broken = join(dir, 'broken.json'); writeFileSync(broken, 'Bearer private-credential');
    const large = join(dir, 'large.json'); writeFileSync(large, ' '.repeat(2 * 1024 * 1024 + 1));
    const link = join(dir, 'link.json'); symlinkSync(valid, link);
    const parentLink = join(dir, 'linked-parent'); symlinkSync(dir, parentLink);
    for (const [index, path] of [broken, large, link, dir, join(parentLink, 'valid.json')].entries()) {
      const out = join(dir, `out-${index}.json`);
      const { report, exitCode } = runMonitor(['--before', path, '--after', valid, '--out', out]);
      assert.equal(exitCode, 2); assert.ok(report.reasons.includes('before_receipt_unavailable'));
      const bytes = readFileSync(out, 'utf8');
      assert.equal(bytes.includes('private-credential'), false); assert.equal(bytes.includes(dir), false);
    }
    const outputLink = join(dir, 'output-link.json'); symlinkSync(valid, outputLink);
    assert.throws(() => runMonitor(['--before', valid, '--after', valid, '--out', outputLink]), /EEXIST/);
    const result = execFileSync('bash', ['scripts/check-ingestion-health.sh', '--data-model', '--help'], { encoding: 'utf8' });
    assert.match(result, /Offline comparison/);
  } finally { rmSync(dir, { recursive: true }); }
});

test('comparison flags cannot be combined with live monitor flags or a missing side', () => {
  for (const args of [ ['--before', 'before'], ['--after', 'after'],
    ['--before', 'before', '--after', 'after', '--cases', 'cases'],
    ['--before', 'before', '--after', 'after', '--lanes', 'lanes'],
    ['--before', 'before', '--after', 'after', '--worker-state', 'worker'],
  ]) assert.throws(() => options(['--out', 'out', ...args]));
});
