import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { options, boundedDocument, readonlySQL, readQuery, assess, runMonitor } from './data-model-coverage.mjs';

const metadata = () => ({ version: 'data_model_health_v1', measured_at: '2026-10-05T00:00:00Z',
  scope: { tables: ['vehicles'], jobs: ['fold'] },
  tables: [{ table_name: 'vehicles', catalog_present: true, atlas_present: true,
    columns: { total: 1, described: 1 }, registry: { owners: ['fold'] },
    write_receipt: { last_write: '2026-10-05T00:00:00Z' }, constraints: { unvalidated: [] } }],
  jobs: [{ job_name: 'fold', present: true, active: true,
    execution: { last_status: 'succeeded', consecutive_failures: 0 }, assay: { reported_status: null } }] });
const agents = () => ({ lanes: { status: 'observed' }, worker: { status: 'reported_completed' } });
const receipt = () => ({ schemaVersion: 'intake_reader_reconciliation_v1', status: 'measured_request_set',
  requestedItems: 1, items: [{ key: 'claim', stage: 'exposed',
    reader: { specsValueCurrent: true, provenanceMeasurement: 'unmeasured_unbounded_owner' },
    requestedRelations: { status: 'failed' } }] });
const metadataSection = () => ({ ...metadata(), section: 'metadata' });
const healthSection = () => ({ ...metadata(), section: 'jobHealth', measured_at: '2026-10-05T00:00:03Z' });
const isJobRead = sql => sql.includes('LEFT JOIN public.v_job_health');

test('successful job and active agent never substitute for an output assay', () => {
  const result = assess(metadata(), null, agents());
  assert.equal(result.status, 'incomplete');
  assert.ok(result.unmeasured.includes('job_output:fold'));
  assert.ok(result.unmeasured.includes('independent_agent_delivery_verification'));
});

test('failed output is detected even when cron execution succeeded', () => {
  const db = metadata(); db.jobs[0].assay.reported_status = 'failed';
  const result = assess(db, null, agents());
  assert.equal(result.status, 'failed'); assert.deepEqual(result.failures, ['job_output:fold']);
});

test('reader exposure cannot conceal a requested relation failure', () => {
  const result = assess(metadata(), receipt(), agents());
  assert.ok(result.failures.includes('requested_relations:claim'));
  assert.ok(result.unmeasured.includes('provenance_reader:claim'));
});

test('omitted relation checks, paused jobs and missing write receipts are unmeasured', () => {
  const db = metadata(); db.jobs[0].active = false; db.tables[0].write_receipt.last_write = null;
  const cases = receipt(); delete cases.items[0].requestedRelations;
  const result = assess(db, cases, agents());
  assert.deepEqual(result.failures, []);
  for (const code of ['paused_job_output:fold', 'write_receipt:vehicles', 'requested_relations:claim'])
    assert.ok(result.unmeasured.includes(code));
});

test('missing rows, refused cases and malformed database responses cannot pass', () => {
  const db = metadata(); db.tables = [];
  assert.ok(assess(db, null, agents()).unmeasured.includes('table_metadata:vehicles'));
  assert.ok(assess(metadata(), { ...receipt(), status: 'refused' }, agents()).unmeasured.includes('invalid_reconciliation_contract'));
  for (const output of ['{"message":"private server error"}', '[]', '[{"health":null}]'])
    assert.throws(() => readQuery('SELECT 1', 'health', () => output), /database_response/);
});

test('independent observed failures survive missing or malformed sections', () => {
  const db = metadata(); db.tables = []; db.jobs[0].assay.reported_status = 'failed';
  let result = assess(db, { ...receipt(), status: 'refused' }, agents());
  assert.ok(result.failures.includes('job_output:fold'));
  assert.ok(result.unmeasured.includes('invalid_reconciliation_contract'));
  result = assess(null, receipt(), { lanes: { status: 'observed', items: [{ freshness: 'stale' }] },
    worker: { status: 'reported_failed' } });
  assert.ok(result.failures.includes('requested_relations:claim'));
  assert.ok(result.failures.includes('scheduled_agent_execution'));
  assert.ok(result.unmeasured.includes('no_fresh_agent_declaration'));
});

test('stale job health remains a failure even when last execution and output passed', () => {
  const db = metadata(); db.jobs[0].assay.reported_status = 'passed';
  db.jobs[0].reported_health_status = 'failed';
  assert.ok(assess(db, null, agents()).failures.includes('job_operational_health:fold'));
});

test('case input refuses symlinks, directories and oversized files before database work', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nuke-case-boundary-'));
  try {
    writeFileSync(join(dir, 'large'), ' '.repeat(65537));
    symlinkSync(join(dir, 'large'), join(dir, 'link'));
    for (const path of [dir, join(dir, 'large'), join(dir, 'link')]) assert.throws(() => boundedDocument(path));
  } finally { rmSync(dir, { recursive: true }); }
});

test('queries have read-only and finite timeout boundaries and use execFile arguments', () => {
  readQuery('SELECT 1', 'health', (command, args, opts) => {
    assert.equal(command, 'bash'); assert.equal(args.length, 2);
    assert.match(args[1], /^BEGIN READ ONLY;/); assert.match(args[1], /statement_timeout='5s'/);
    assert.match(args[1], /ROLLBACK;$/); assert.equal(opts.timeout, 20000);
    return '[{"health":{"version":"fixture"}}]';
  });
  assert.match(readonlySQL('SELECT 1'), /lock_timeout='1s'/);
});

test('invalid arguments do not execute work', () => {
  for (const args of [[], ['--out'], ['--out', 'x', '--apply', 'yes'], ['--out', 'x', '--out', 'y']])
    assert.throws(() => options(args));
});

test('operator receipt is exclusive/private, retains unavailable evidence, and hides raw errors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nuke-model-monitor-'));
  try {
    const out = join(dir, 'receipt.json');
    const result = runMonitor(['--out', out], { query: () => { throw new Error('Bearer private'); }, inspect: agents });
    assert.equal(result.exitCode, 2);
    assert.ok(result.report.assessment.unmeasured.includes('database_measurement_unavailable'));
    assert.equal(statSync(out).mode & 0o777, 0o600);
    assert.ok(!readFileSync(out, 'utf8').includes('Bearer private'));
    assert.throws(() => runMonitor(['--out', out], { query: metadata, inspect: agents }), /EEXIST/);
  } finally { rmSync(dir, { recursive: true }); }
});

test('job timeout preserves table/config metadata and independent source failures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nuke-monitor-partial-'));
  try {
    const input = join(dir, 'cases.json');
    writeFileSync(input, JSON.stringify({ asOf: '2026-10-05T00:00:00Z', requests: [{ key: 'claim' }] }));
    const result = runMonitor(['--out', join(dir, 'out.json'), '--cases', input], {
      query: (sql, column) => {
        if (column === 'receipt') return receipt();
        if (isJobRead(sql)) return readQuery(sql, column, () => '{"code":"57014","message":"Bearer private error body"}');
        const reading = metadataSection();
        reading.jobs[0].execution = { state: 'unmeasured', last_status: null };
        return reading;
      }, inspect: agents,
    });
    assert.equal(result.report.database.tables.length, 1);
    assert.equal(result.report.database.jobs[0].present, true);
    assert.equal(result.report.database.jobs[0].execution.state, 'unmeasured');
    assert.equal(result.report.database.sections.metadata.status, 'measured');
    assert.equal(result.report.database.sections.jobHealth.status, 'unavailable');
    assert.equal(result.report.evidence.sections.jobHealth.sqlstate, '57014');
    assert.ok(result.report.assessment.failures.includes('requested_relations:claim'));
    assert.ok(result.report.assessment.unmeasured.includes('job_output:fold'));
    assert.ok(result.report.assessment.unmeasured.includes('job_health_measurement_unavailable'));
    assert.equal(result.exitCode, 1);
    assert.equal(readFileSync(join(dir, 'out.json'), 'utf8').includes('Bearer private'), false);
  } finally { rmSync(dir, { recursive: true }); }
});

test('metadata failure preserves independently measured job failures and clocks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nuke-monitor-job-evidence-'));
  try {
    const result = runMonitor(['--out', join(dir, 'out.json')], {
      query: sql => {
        if (!isJobRead(sql)) throw Object.assign(new Error('secret'), { sqlstate: '57014' });
        const health = healthSection(); health.jobs[0].assay.reported_status = 'failed'; return health;
      }, inspect: agents,
    });
    assert.deepEqual(result.report.database.tables, []);
    assert.ok(result.report.assessment.failures.includes('job_output:fold'));
    assert.ok(result.report.assessment.unmeasured.includes('table_metadata:vehicles'));
    assert.ok(result.report.assessment.unmeasured.includes('database_metadata_unavailable'));
    assert.equal(result.report.database.sections.metadata.measured_at, null);
    assert.equal(result.report.database.sections.jobHealth.measured_at, '2026-10-05T00:00:03Z');
    assert.equal(result.report.evidence.sections.metadata.sqlstate, undefined);
    assert.equal(result.report.evidence.sections.jobHealth.sqlSha256.length, 64);
    assert.equal(result.exitCode, 1);
  } finally { rmSync(dir, { recursive: true }); }
});

test('independent successes retain both statement clocks and SQL identities', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nuke-monitor-clocks-'));
  try {
    const result = runMonitor(['--out', join(dir, 'out.json')], {
      query: sql => isJobRead(sql) ? healthSection() : metadataSection(), inspect: agents,
    });
    assert.equal(result.report.database.sections.metadata.measured_at, '2026-10-05T00:00:00Z');
    assert.equal(result.report.database.sections.jobHealth.measured_at, '2026-10-05T00:00:03Z');
    assert.notEqual(result.report.evidence.healthSQLSha256, result.report.evidence.jobHealthSQLSha256);
    assert.equal(result.report.assessment.status, 'incomplete');
  } finally { rmSync(dir, { recursive: true }); }
});

test('case values are quoted as data without dollar replacement expansion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nuke-model-cases-'));
  try {
    const path = join(dir, 'cases.json');
    writeFileSync(path, JSON.stringify({ asOf: '2026-10-05T00:00:00Z', requests: [{ key: "value'$&" }] }));
    let calls = 0;
    runMonitor(['--out', join(dir, 'out.json'), '--cases', path], {
      query: (sql, column) => { calls++; if (column === 'health') return isJobRead(sql) ? healthSection() : metadataSection();
        assert.ok(sql.includes("value''$&")); return receipt(); }, inspect: agents });
    assert.equal(calls, 3);
  } finally { rmSync(dir, { recursive: true }); }
});
