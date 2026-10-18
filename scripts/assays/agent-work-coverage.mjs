// Read-only projection of existing private coordination artifacts. Declarations
// and matching files do not independently verify work, tests, or model improvement.
import { constants, openSync, closeSync, fstatSync, readSync, opendirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const AGENT_WORK_LIMITS = Object.freeze({ files: 50, bytes: 65536, staleSeconds: 7200 });
const STAGES = ['implemented', 'tested', 'merged', 'deployed', 'runtime_verified'];
const RUN = /^\d{8}T\d{6}Z$/;
const fail = reason => { throw new Error(reason); };
const unknown = reason => ({ status: 'unknown', reasons: [reason] });

function readArtifact(path, now) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile()) fail('not_regular_file');
    if (stat.size > AGENT_WORK_LIMITS.bytes) fail('file_cap_exceeded');
    const buffer = Buffer.alloc(AGENT_WORK_LIMITS.bytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const n = readSync(fd, buffer, length, buffer.length - length, null);
      if (!n) break;
      length += n;
    }
    if (length > AGENT_WORK_LIMITS.bytes) fail('file_cap_exceeded');
    const after = fstatSync(fd);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) fail('artifact_changed_during_read');
    const ageSeconds = (now - stat.mtimeMs) / 1000;
    return {
      text: buffer.subarray(0, length).toString('utf8'),
      sha256: createHash('sha256').update(buffer.subarray(0, length)).digest('hex'),
      modifiedAt: stat.mtime.toISOString(), ageSeconds: Math.max(0, Math.floor(ageSeconds)),
      freshness: ageSeconds < 0 ? 'unknown' : ageSeconds > AGENT_WORK_LIMITS.staleSeconds ? 'stale' : 'fresh',
    };
  } catch (error) {
    const safe = ['not_regular_file', 'file_cap_exceeded', 'artifact_changed_during_read'];
    fail(safe.includes(error.message) ? error.message : error.code === 'ENOENT' ? 'missing_artifact' : 'unreadable_artifact');
  } finally { if (fd !== undefined) closeSync(fd); }
}

function inspectLanes(directory, now) {
  if (!directory) return { ...unknown('not_configured'), items: [] };
  let stream;
  const names = [];
  try {
    stream = opendirSync(directory);
    for (let entry; (entry = stream.readSync());) {
      if (!entry.name.endsWith('.md')) continue;
      names.push(entry.name);
      if (names.length > AGENT_WORK_LIMITS.files) return { ...unknown('file_count_cap_exceeded'), items: [] };
    }
  } catch { return { ...unknown('directory_unavailable'), items: [] }; }
  finally { stream?.closeSync(); }
  if (!names.length) return { ...unknown('no_lane_declarations'), items: [] };
  const items = names.sort().map(name => {
    try {
      const { text, ...metadata } = readArtifact(join(directory, name), now);
      if (!text.trim()) fail('empty_lane_declaration');
      return { name, ...metadata, activity: 'declaration_only', processIdentity: 'unknown' };
    } catch (error) { return { name, ...unknown(error.message), freshness: 'unknown' }; }
  });
  return { status: items.some(item => item.freshness === 'unknown') ? 'unknown' : 'observed', items,
    reasons: items.some(item => item.freshness === 'unknown') ? ['lane_evidence_incomplete'] : [],
    staleAfterSeconds: AGENT_WORK_LIMITS.staleSeconds, processIdentity: 'unknown' };
}

function parse(artifact) {
  try {
    const value = JSON.parse(artifact.text);
    if (!value || Array.isArray(value) || typeof value !== 'object') fail('invalid_json');
    return value;
  } catch { fail('invalid_json'); }
}

function inspectWorker(directory, now) {
  if (!directory) return unknown('not_configured');
  const result = { status: 'unknown', reasons: [], reportedStages: null, processExists: null,
    processIdentity: 'unknown', independentVerification: 'not_performed', artifactHashes: {} };
  try {
    const processFile = readArtifact(join(directory, 'latest-process.json'), now);
    const state = parse(processFile);
    result.artifactHashes.latestProcess = processFile.sha256;
    if (!RUN.test(state.run_id ?? '') || state.mode !== 'code-refinement') fail('unrecognized_worker_record');
    Object.assign(result, { runId: state.run_id, processModifiedAt: processFile.modifiedAt,
      ageSeconds: processFile.ageSeconds, freshness: processFile.freshness });
    if (processFile.freshness === 'unknown') fail('future_artifact_clock');
    if (state.state === 'running') {
      if (!Number.isSafeInteger(state.pid) || state.pid <= 0) fail('invalid_pid');
      try { process.kill(state.pid, 0); result.processExists = true; }
      catch (error) { result.processExists = error.code === 'ESRCH' ? false : null; }
      if (processFile.freshness === 'stale') fail('stale_running_declaration');
      if (result.processExists !== true) fail(result.processExists === false ? 'reported_process_absent' : 'process_check_unavailable');
      return { ...result, status: 'reported_running', reasons: ['process_identity_and_work_unverified'] };
    }
    if (!['exited', 'login_blocked'].includes(state.state) || !Number.isSafeInteger(state.process_exit_code)) fail('invalid_process_state');
    result.processExitCode = state.process_exit_code;
    const reportFile = readArtifact(join(directory, 'latest-report.json'), now);
    const report = parse(reportFile);
    result.artifactHashes.latestReport = reportFile.sha256;
    if (report.run_id !== state.run_id || report.process_exit_code !== state.process_exit_code) fail('run_or_exit_mismatch');
    const archived = readArtifact(join(directory, `${state.run_id}.report.json`), now);
    result.artifactHashes.archivedReport = archived.sha256;
    if (archived.sha256 !== reportFile.sha256) fail('report_hash_mismatch');
    result.reportCopiesMatch = true;
    const stages = report.reported_stages;
    if (!stages || typeof stages !== 'object' || Object.keys(stages).length !== STAGES.length ||
      !STAGES.every(key => typeof stages[key] === 'boolean') ||
      STAGES.some((key, i) => stages[key] && STAGES.slice(0, i).some(previous => !stages[previous]))) fail('invalid_reported_stages');
    if (typeof report.receipt_valid !== 'boolean') fail('invalid_receipt_flag');
    result.receiptReportedValid = report.receipt_valid;
    if (state.process_exit_code !== 0 || !report.receipt_valid) return { ...result, status: 'reported_failed', reasons: ['execution_or_receipt_failed'] };
    result.reportedStages = Object.fromEntries(STAGES.map(key => [key, stages[key]]));
    result.commit = /^[0-9a-f]{7,40}$/.test(report.commit ?? '') ? report.commit : null;
    result.prUrl = /^https:\/\/github\.com\/sss97133\/nuke\/pull\/\d+$/.test(report.pr_url ?? '') ? report.pr_url : null;
    return { ...result, status: 'reported_completed', reasons: ['reported_stages_not_independently_verified'] };
  } catch (error) { return { ...result, status: 'unknown', reportedStages: null, reasons: [error.message] }; }
}

export function inspectAgentWork({ lanesDirectory, workerStateDirectory, now = Date.now() } = {}) {
  const timestamp = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(timestamp)) throw new Error('invalid measurement time');
  return { schemaVersion: 'agent_work_coverage_v1', measuredAt: new Date(timestamp).toISOString(),
    lanes: inspectLanes(lanesDirectory, timestamp), worker: inspectWorker(workerStateDirectory, timestamp),
    independentVerification: 'not_performed',
    scope: 'Private existing local declarations only. Freshness and file consistency establish neither agent identity nor tested data-model improvement.' };
}
