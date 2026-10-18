// Operator mode of check-ingestion-health.sh; output belongs outside the public repo.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, readSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectAgentWork } from './agent-work-coverage.mjs';
import { buildCaseContract, compareModelSnapshots } from './model-snapshot-comparison.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HASH = text => createHash('sha256').update(text).digest('hex');
const TRUSTED_SQLSTATE = Symbol('structured_database_error_code');
const STAGES = new Set(['retained_only', 'retention_locator_only', 'retention_unestablished',
  'parsed_unadmitted', 'privacy_withheld', 'superseded_retained', 'clock_withheld',
  'conflict_withheld', 'extracted_unresolved', 'linked', 'folded', 'exposed']);

export function options(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--out', '--cases', '--lanes', '--worker-state', '--before', '--after'].includes(key) || !args[i + 1]
      || args[i + 1].startsWith('--') || parsed[key]) throw new Error('invalid_arguments');
    parsed[key] = resolve(args[i + 1]);
  }
  if (!parsed['--out']) throw new Error('private_output_required');
  if ((parsed['--before'] || parsed['--after']) && (!parsed['--before'] || !parsed['--after']
    || ['--cases', '--lanes', '--worker-state'].some(key => parsed[key]))) throw new Error('invalid_comparison_arguments');
  return parsed;
}

function boundedJSON(path, limit, rejectParentLinks = false) {
  let fd;
  try {
    // Reject links in both the leaf and its parent path before opening it.
    if (rejectParentLinks && realpathSync(path) !== resolve(path)) throw new Error('symlink_input');
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > limit) throw new Error('invalid_input_file');
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const n = readSync(fd, buffer, length, buffer.length - length, null);
      if (!n) break;
      length += n;
    }
    const after = fstatSync(fd);
    if (length > limit || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new Error('invalid_input_file');
    return JSON.parse(buffer.subarray(0, length).toString('utf8'));
  } finally { if (fd !== undefined) closeSync(fd); }
}

export function boundedDocument(path) {
  const doc = boundedJSON(path, 65536);
  if (!Array.isArray(doc?.requests) || doc.requests.length < 1 || doc.requests.length > 50
    || !Number.isFinite(Date.parse(doc.asOf))) throw new Error('invalid_cases_scope');
  return doc;
}

export function readonlySQL(sql) {
  return `BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='1s';\n${sql}\nROLLBACK;`;
}

export function readQuery(sql, column, run = execFileSync) {
  const output = run('bash', [resolve(ROOT, 'scripts/data/q.sh'), readonlySQL(sql)],
    { cwd: ROOT, encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const rows = JSON.parse(output);
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.[column]
    || typeof rows[0][column] !== 'object') {
    const error = new Error('invalid_database_response');
    // Never extract codes from SQLERRM/body text, shell errors or credentials.
    const code = !Array.isArray(rows) && (rows?.sqlstate ?? rows?.code);
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) error[TRUSTED_SQLSTATE] = code;
    throw error;
  }
  return rows[0][column];
}

export function combineDatabaseSections(metadata, jobHealth) {
  if (!metadata && !jobHealth) return null;
  const scope = metadata?.scope ?? jobHealth.scope;
  return { version: 'data_model_health_v1',
    measured_at: metadata?.measured_at ?? jobHealth.measured_at,
    scope, tables: metadata?.tables ?? [],
    jobs: scope.jobs.map(name => jobHealth?.jobs.find(row => row?.job_name === name)
      ?? metadata?.jobs.find(row => row?.job_name === name)).filter(Boolean),
    sections: Object.fromEntries(Object.entries({ metadata, jobHealth }).map(([name, value]) =>
      [name, { status: value ? 'measured' : 'unavailable', measured_at: value?.measured_at ?? null }])),
    measurement_basis: 'Independent statements and clocks; not one database snapshot.',
    limits: [...(metadata?.limits ?? []), ...(jobHealth?.limits ?? [])] };
}

function validSection(value, section) {
  return value?.version === 'data_model_health_v1' && value.section === section
    && Number.isFinite(Date.parse(value.measured_at))
    && Array.isArray(value.scope?.tables) && value.scope.tables.length > 0
    && Array.isArray(value.scope?.jobs) && value.scope.jobs.length > 0
    && Array.isArray(value.jobs) && (section !== 'metadata' || Array.isArray(value.tables));
}

export function assess(database, reconciliation, agents) {
  const failures = [], unmeasured = [], followups = [];
  if (database?.version !== 'data_model_health_v1' || !Number.isFinite(Date.parse(database.measured_at))
    || !Array.isArray(database.scope?.tables) || !database.scope.tables.length
    || !Array.isArray(database.scope?.jobs) || !database.scope.jobs.length
    || !Array.isArray(database.tables) || !Array.isArray(database.jobs)) {
    unmeasured.push('invalid_database_contract');
  } else {
  for (const name of database.scope.tables) {
    const matches = database.tables.filter(row => row?.table_name === name);
    if (matches.length !== 1) { unmeasured.push(`table_metadata:${name}`); continue; }
    const table = matches[0];
    if (table.catalog_present !== true || table.atlas_present !== true) {
      unmeasured.push(`table_metadata:${name}`); continue;
    }
    if (table.constraints?.unvalidated?.length) followups.push(`constraint_validation_pending:${name}`);
    if (!Number.isInteger(table.columns?.total) || !Number.isInteger(table.columns?.described)
      || table.columns.described < table.columns.total) followups.push(`column_meanings_incomplete:${name}`);
    if (!Array.isArray(table.registry?.owners) || !table.registry.owners.length) followups.push(`owner_unregistered:${name}`);
    if (!table.write_receipt?.last_write) unmeasured.push(`write_receipt:${name}`);
  }
  for (const name of database.scope.jobs) {
    const matches = database.jobs.filter(row => row?.job_name === name);
    if (matches.length !== 1) { unmeasured.push(`job:${name}`); continue; }
    const job = matches[0];
    if (job.present !== true) { unmeasured.push(`job:${name}`); continue; }
    if (job.active !== true) { unmeasured.push(`paused_job_output:${name}`); continue; }
    if (job.execution?.last_status === 'failed' || job.execution?.consecutive_failures > 0)
      failures.push(`job_execution:${name}`);
    if (job.reported_health_status === 'failed') failures.push(`job_operational_health:${name}`);
    if (job.assay?.reported_status === 'failed') failures.push(`job_output:${name}`);
    else if (job.assay?.reported_status !== 'passed') unmeasured.push(`job_output:${name}`);
  }
  }
  if (!reconciliation) unmeasured.push('source_to_reader:no_explicit_cases');
  else {
    if (reconciliation.schemaVersion !== 'intake_reader_reconciliation_v1'
      || reconciliation.status !== 'measured_request_set' || !Array.isArray(reconciliation.items)
      || reconciliation.items.length !== reconciliation.requestedItems || !reconciliation.items.length)
      unmeasured.push('invalid_reconciliation_contract');
    else for (const item of reconciliation.items) {
      if (!item || !STAGES.has(item.stage)) { unmeasured.push('invalid_reconciliation_stage'); continue; }
      // Exposure and typed source relations must both be measured; neither proves source truth.
      if (item.reader?.specsValueCurrent !== true) unmeasured.push(`reader:${item.key}:${item.stage}`);
      if (!item.requestedRelations) unmeasured.push(`requested_relations:${item.key}`);
      else if (item.requestedRelations.status === 'failed') failures.push(`requested_relations:${item.key}`);
      else if (item.requestedRelations.status !== 'passed') unmeasured.push(`requested_relations:${item.key}`);
      if (item.reader?.provenanceMeasurement !== 'measured') unmeasured.push(`provenance_reader:${item.key}`);
    }
  }
  if (agents?.lanes?.status !== 'observed') unmeasured.push('agent_lane_coverage');
  if (!agents?.lanes?.items?.some(item => item.freshness === 'fresh')) unmeasured.push('no_fresh_agent_declaration');
  if (!agents?.worker?.status || agents.worker.status === 'unknown') unmeasured.push('scheduled_agent_activity');
  if (agents?.worker?.status === 'reported_failed') failures.push('scheduled_agent_execution');
  if (agents?.worker?.ageSeconds > 17100) unmeasured.push('scheduled_agent_receipt_overdue');
  // No declaration, successful process, or count of commits verifies the model.
  unmeasured.push('independent_agent_delivery_verification');
  return { status: failures.length ? 'failed' : 'incomplete', failures, unmeasured, followups };
}

export function runMonitor(args, dependencies = {}) {
  const opts = options(args);
  if (opts['--before']) {
    const inputs = {}, unavailable = [];
    for (const side of ['before', 'after']) {
      try { inputs[side] = boundedJSON(opts[`--${side}`], 2 * 1024 * 1024, true); }
      catch { unavailable.push(`${side}_receipt_unavailable`); }
    }
    const report = compareModelSnapshots(inputs.before, inputs.after);
    report.reasons.push(...unavailable);
    writeFileSync(opts['--out'], JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return { report, exitCode: report.status === 'regressed' ? 1 : report.status === 'uncomparable' ? 2 : 0 };
  }
  const query = dependencies.query ?? readQuery;
  const inspect = dependencies.inspect ?? inspectAgentWork;
  const healthSQL = readFileSync(resolve(ROOT, 'scripts/discovery/data-model-health.sql'), 'utf8');
  const jobHealthSQL = readFileSync(resolve(ROOT, 'scripts/discovery/data-model-job-health.sql'), 'utf8');
  const report = { version: 'data_model_coverage_v1', measuredAt: new Date().toISOString(),
    database: null, sourceToReader: null, agentWork: null,
    evidence: { healthSQLSha256: HASH(healthSQL), jobHealthSQLSha256: HASH(jobHealthSQL), sections: {} },
    limits: ['Seven named tables and five named jobs; no fleet completeness or source truth claim.',
      'Constraint validation and descriptions do not establish semantic correctness.',
      'Source cases are explicit operator inventory, not a representative population.',
      'Agent declarations, process existence and reported stages are not independent verification.',
      'Metadata, job health and source cases have independent statement clocks; partial evidence survives other read failures.'] };
  const errors = [];
  const sections = { metadata: null, jobHealth: null };
  for (const [section, sql] of [['metadata', healthSQL], ['jobHealth', jobHealthSQL]]) {
    const evidence = { sqlSha256: HASH(sql), startedAt: new Date().toISOString(), status: 'unavailable', measuredAt: null };
    report.evidence.sections[section] = evidence;
    try {
      const reading = query(sql, 'health');
      if (!validSection(reading, section)) throw new Error('invalid_section_contract');
      sections[section] = reading;
      Object.assign(evidence, { status: 'measured', measuredAt: reading.measured_at });
    } catch (error) {
      errors.push(section === 'metadata' ? 'database_metadata_unavailable' : 'job_health_measurement_unavailable');
      if (error?.[TRUSTED_SQLSTATE]) evidence.sqlstate = error[TRUSTED_SQLSTATE];
    } finally { evidence.completedAt = new Date().toISOString(); }
  }
  report.database = combineDatabaseSections(sections.metadata, sections.jobHealth);
  if (!report.database) errors.push('database_measurement_unavailable');
  if (opts['--cases']) {
    const evidence = { startedAt: new Date().toISOString(), status: 'unavailable' };
    report.evidence.sections.sourceToReader = evidence;
    try {
      const sql = readFileSync(resolve(ROOT, 'scripts/discovery/intake-reader-reconciliation.sql'), 'utf8');
      report.evidence.reconciliationSQLSha256 = evidence.sqlSha256 = HASH(sql);
      const doc = boundedDocument(opts['--cases']);
      report.evidence.casesSha256 = evidence.casesSha256 = HASH(JSON.stringify(doc));
      report.evidence.caseContract = buildCaseContract(doc);
      evidence.cutoffAt = doc.asOf;
      const literal = `'${JSON.stringify(doc).replaceAll("'", "''")}'`;
      // Function replacement preserves literal dollar sequences inside source input.
      report.sourceToReader = query(sql.replace(/\$1\b/g, () => literal), 'receipt');
      evidence.status = 'returned';
    } catch (error) {
      errors.push('source_to_reader_measurement_unavailable');
      if (error?.[TRUSTED_SQLSTATE]) evidence.sqlstate = error[TRUSTED_SQLSTATE];
    } finally { evidence.completedAt = new Date().toISOString(); }
  }
  try { report.agentWork = inspect({ lanesDirectory: opts['--lanes'], workerStateDirectory: opts['--worker-state'] }); }
  catch { errors.push('agent_measurement_unavailable'); }
  try { report.assessment = assess(report.database, report.sourceToReader, report.agentWork); }
  catch { errors.push('measurement_contract_incomplete'); report.assessment = { status: 'incomplete', failures: [], unmeasured: [], followups: [] }; }
  report.assessment.unmeasured.push(...errors);
  // Never overwrite a receipt, follow an output symlink, or print raw database errors.
  writeFileSync(opts['--out'], JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { report, exitCode: report.assessment.failures.length ? 1 : 2 };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--help')) {
    console.log('check-ingestion-health.sh --data-model --out /private/new.json [--cases /private/requests.json] [--lanes /path/to/.claude/agents/active] [--worker-state /path/to/night-shift]\nRead-only. Exit 1: observed failure; 2: incomplete coverage/unavailable. No whole-model pass.\nOffline comparison: --data-model --before /private/before.json --after /private/after.json --out /private/new-comparison.json\nComparison exits: 0 improved/unchanged retained cases, 1 regressed, 2 uncomparable; no agent causation or delivery verification.');
  } else {
    try {
      const { report, exitCode } = runMonitor(process.argv.slice(2));
      console.log(JSON.stringify(report.version === 'model_snapshot_comparison_v1'
        ? { version: report.version, scope: report.scope, status: report.status, counts: report.counts }
        : { status: report.assessment.status, failures: report.assessment.failures.length,
          unmeasured: report.assessment.unmeasured.length, followups: report.assessment.followups.length }));
      process.exitCode = exitCode;
    } catch { console.error('data-model monitor could not record a private receipt; check arguments/output path'); process.exitCode = 2; }
  }
}
