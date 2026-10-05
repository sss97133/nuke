#!/usr/bin/env node
/**
 * Audit saved sale-event reader inputs with the existing deal-read selector.
 * Offline mode has no network; both modes avoid source intake, database writes,
 * inference and profile-price updates.
 * Input: { schemaVersion: 'sale_event_population_v1', rows, options }.
 * Or: { schemaVersion: 'sale_event_candidate_assay_v1', receipt, options },
 * with the unchanged private sale-event-candidates.sql receipt. This adds an
 * episode repair queue; it does not qualify native claims or fetch source bodies.
 * Run: node scripts/assay-sale-population.mjs --input /private/input.json --out /private/receipt.json
 * Live current context: --subject EXISTING_COHORT_UUID --out /private/receipt.json
 * The live mode uses sanctioned q.sh once, never source fetching or testimony intake.
 * Requires Node 22.18+ for the project's erasable TypeScript module.
 */
import { open, realpath, readFile, lstat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execute = promisify(execFile);
const MAX_INPUT_BYTES = 256 * 1024 * 1024;
const PRICE_BASES = new Set(['published_bid_excluding_fees', 'buyer_total', null]);
const DIMENSIONS = new Set(['make', 'model', 'comparison_group', 'model_year', 'engine', 'transmission', 'body_style', 'condition', 'region', 'provenance']);
class AssayError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const record = value => value != null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string';
const nullableText = value => value === null || text(value);
const refs = value => Array.isArray(value) && value.every(ref => record(ref) && text(ref.table) && text(ref.id));
function relevance(value) {
  return Array.isArray(value) && value.every(claim => record(claim) && DIMENSIONS.has(claim.dimension)
    && ['value', 'sourcePlatform', 'sourceEpisodeKey', 'knownAt', 'basis'].every(key => nullableText(claim[key]))
    && refs(claim.evidenceRefs));
}

export function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!['--input', '--subject', '--out'].includes(flag) || options[flag.slice(2)] || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new AssayError('invalid_arguments');
    }
    options[flag.slice(2)] = args[++index];
  }
  if ((!options.input && !options.subject) || (options.input && options.subject) || !options.out) throw new AssayError('one_input_mode_and_out_required');
  if (options.subject && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.subject)) {
    throw new AssayError('invalid_subject_uuid');
  }
  return options;
}

export function validateInput(input) {
  if (record(input) && input.schemaVersion === 'sale_event_candidate_assay_v1') {
    const r = input.receipt;
    if (!record(r) || r.contract !== 'sale_event_candidates_v1' || r.stage !== 'private_candidate_assay_not_price_comps'
      || !record(r.population) || !Number.isInteger(r.population.eligiblePublicParents) || r.population.eligiblePublicParents < 0
      || !record(r.coverage) || typeof r.coverage.complete !== 'boolean' || typeof r.coverage.validRequest !== 'boolean'
      || typeof r.coverage.captureHeadersComplete !== 'boolean' || !Array.isArray(r.candidates) || !Array.isArray(r.sourceCaptureHeaders)
      || (r.coverage.complete && (!r.coverage.validRequest
        || !Number.isInteger(r.coverage.vehicleEventPresentations) || r.coverage.vehicleEventPresentations < 0
        || !Number.isInteger(r.coverage.batListingPresentations) || r.coverage.batListingPresentations < 0
        || r.coverage.vehicleEventPresentations + r.coverage.batListingPresentations !== r.candidates.length))
      || (!r.coverage.complete && r.candidates.length > 0)
      || new Set(r.candidates.map(c => JSON.stringify([c?.capture?.table, c?.capture?.id]))).size !== r.candidates.length
      || r.candidates.some(c => !record(c) || !['vehicle_events', 'bat_listings'].includes(c.capture?.table)
        || c.qualification?.status !== 'candidate')
      || (r.coverage.complete && (r.candidates.filter(c => c.capture.table === 'vehicle_events').length !== r.coverage.vehicleEventPresentations
        || r.candidates.filter(c => c.capture.table === 'bat_listings').length !== r.coverage.batListingPresentations))
      || new Set(r.candidates.map(c => c.vehicleId).filter(Boolean)).size > r.population.eligiblePublicParents
      || r.sourceCaptureHeaders.some(h => !record(h) || !refs([h.capture]) || h.capture.table !== 'listing_page_snapshots'
        || !['vehicleId', 'sourcePlatform', 'sourceEpisodeKey'].every(key => nullableText(h[key])))) {
      throw new AssayError('invalid_native_receipt');
    }
    input = { ...input, rows: r.candidates };
  }
  if (!record(input) || !['sale_event_population_v1', 'sale_event_candidate_assay_v1'].includes(input.schemaVersion)
    || !Array.isArray(input.rows) || !record(input.options)) {
    throw new AssayError('invalid_population_input');
  }
  for (const row of input.rows) {
    if (!record(row) || !refs([row.capture]) || !['sold', 'not_sold', 'unknown'].includes(row.outcome)
      || !['day', 'instant', null].includes(row.eventGrain) || !PRICE_BASES.has(row.priceBasis)
      || !['listing_claim', 'structured', 'visual', 'unknown'].includes(row.conditionEvidence)
      || !(row.amount === null || (typeof row.amount === 'number' && Number.isFinite(row.amount)))
      || !['vehicleId', 'sourceUrl', 'eventAt', 'knownAt', 'currency', 'unitSource', 'sourcePlatform', 'sourceEpisodeKey', 'eventTimeBasis', 'knownAtEvidence'].every(key => nullableText(row[key]))
      || !record(row.qualification) || !['qualified', 'candidate', 'refused'].includes(row.qualification.status)
      || !nullableText(row.qualification.basis) || !refs(row.qualification.evidenceRefs) || !relevance(row.relevance)) {
      throw new AssayError('invalid_capture_shape');
    }
  }
  const opts = input.options;
  if (!record(opts.population) || !['key', 'label', 'basis'].every(key => text(opts.population[key])) || typeof opts.population.complete !== 'boolean'
    || !record(opts.subject) || !['sourcePlatform', 'sourceEpisodeKey', 'vehicleId', 'currency'].every(key => nullableText(opts.subject[key]))
    || !PRICE_BASES.has(opts.subject.priceBasis) || !relevance(opts.subject.relevance)
    || !record(opts.policy) || !text(opts.policy.key) || !text(opts.policy.basis) || !Array.isArray(opts.policy.requiredDimensions)
    || !opts.policy.requiredDimensions.every(dimension => DIMENSIONS.has(dimension))
    || !['eventFrom', 'eventBefore', 'evidenceAsOf', 'computedAt'].every(key => text(opts[key]))
    || !['retrospective', 'known_at'].includes(opts.knowledgeMode) || !Number.isInteger(opts.minimumMatchedSales)) {
    throw new AssayError('invalid_options_shape');
  }
  return input;
}

function candidateRepairPlan(receipt) {
  if (!receipt.coverage.complete) return { state: 'refused', reason: receipt.coverage.refusal ?? 'native_selection_incomplete',
    counts: null, episodes: [], unresolvedPresentations: [] };
  const groups = new Map(), unresolved = [];
  for (const row of receipt.candidates) {
    if (!row.sourcePlatform || !row.sourceEpisodeKey) { unresolved.push(row.capture); continue; }
    const key = JSON.stringify([row.sourcePlatform, row.sourceEpisodeKey]);
    const group = groups.get(key) ?? []; group.push(row); groups.set(key, group);
  }
  const headers = new Map();
  if (receipt.coverage.captureHeadersComplete) for (const header of receipt.sourceCaptureHeaders) {
    const key = JSON.stringify([header.sourcePlatform, header.sourceEpisodeKey]);
    const group = headers.get(key) ?? []; group.push(header); headers.set(key, group);
  }
  const episodes = [...groups].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, rows]) => {
    const parents = [...new Set(rows.map(r => r.vehicleId).filter(Boolean))].sort();
    const validDay = value => value != null && /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)
      && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value.slice(0, 10))).toISOString().slice(0, 10) === value.slice(0, 10);
    const days = [...new Set(rows.filter(r => validDay(r.eventAt)).map(r => r.eventAt.slice(0, 10)))].sort();
    const sold = rows.some(r => r.outcome === 'sold'), notSold = rows.some(r => r.outcome === 'not_sold');
    const issues = [];
    if (!days.length) issues.push('missing_recorded_date');
    if (days.length > 1) issues.push('conflicting_recorded_days');
    if (sold && notSold) issues.push('conflicting_recorded_outcomes');
    if (!sold && !notSold) issues.push('unknown_recorded_outcome');
    if (sold && !rows.some(r => r.outcome === 'sold' && r.amount > 0)) issues.push('sold_claim_without_positive_amount');
    if (parents.length > 1) issues.push('multiple_parent_pointers');
    const sourceCaptureRefs = (headers.get(key) ?? []).filter(h => parents.includes(h.vehicleId)).map(h => ({
      ...h.capture, vehicleId: h.vehicleId, parentAttested: h.parentAttested === true,
      storedBodyPointer: h.success === true && h.httpStatus === 200 && (h.inlineBodyPresent === true || h.archivedBodyRecorded === true),
      qualification: 'candidate_header_only',
    }));
    return { sourcePlatform: rows[0].sourcePlatform, sourceEpisodeKey: rows[0].sourceEpisodeKey,
      parents, recordedDays: days, issues, nativeRefs: rows.map(r => r.capture).sort((a, b) =>
        `${a.table}:${a.id}` < `${b.table}:${b.id}` ? -1 : `${a.table}:${a.id}` > `${b.table}:${b.id}` ? 1 : 0),
      sourceCaptureRefs: sourceCaptureRefs.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) };
  });
  const count = issue => episodes.filter(e => e.issues.includes(issue)).length;
  return {
    state: 'observed_candidate_gaps', grain: 'recorded_source_platform_x_episode_key',
    knowledgeMode: 'current_native_rows_not_historical_availability', priceQualified: false,
    sourceQualification: 'Source headers are pointers to check; body accessibility, hash, parse, units and public permission remain unverified.',
    population: receipt.population, coverage: receipt.coverage,
    counts: { presentations: receipt.candidates.length, identifiedEpisodes: episodes.length,
      unresolvedPresentations: unresolved.length, missingDateEpisodes: count('missing_recorded_date'),
      dateConflictEpisodes: count('conflicting_recorded_days'), outcomeConflictEpisodes: count('conflicting_recorded_outcomes'),
      unknownOutcomeEpisodes: count('unknown_recorded_outcome'), soldEpisodesWithoutPositiveAmount: count('sold_claim_without_positive_amount'),
      multipleParentEpisodes: count('multiple_parent_pointers'),
      missingDateEpisodesWithStoredBodyPointer: receipt.coverage.captureHeadersComplete
        ? episodes.filter(e => e.issues.includes('missing_recorded_date') && e.sourceCaptureRefs.some(h => h.storedBodyPointer)).length : null },
    episodes, unresolvedPresentations: unresolved,
  };
}

async function readInput(file) {
  let handle;
  try {
    handle = await open(file, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) throw new AssayError('input_not_regular_or_over_byte_limit');
    const bytes = await handle.readFile();
    if (bytes.length > MAX_INPUT_BYTES) throw new AssayError('input_over_byte_limit');
    return { input: validateInput(JSON.parse(bytes.toString('utf8'))), sha256: createHash('sha256').update(bytes).digest('hex') };
  } catch (error) {
    throw error instanceof AssayError ? error : new AssayError('input_unreadable_or_invalid_json');
  } finally { await handle?.close(); }
}

async function readSubject(subject, deps) {
  const sql = await readFile(path.join(REPO_ROOT, 'scripts/discovery/sale-event-candidates.sql'), 'utf8');
  const parents = `(SELECT ARRAY(SELECT v.id FROM public.cohort_members('${subject.toLowerCase()}'::uuid) m
    JOIN public.vehicles v ON v.id=m.vehicle_id WHERE v.is_public IS TRUE AND v.deleted_at IS NULL
    AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item' ORDER BY v.id LIMIT 10001))`;
  const query = sql.replace(/^[ \t]*--.*$/gm, '').replaceAll('$1::uuid[]', parents).replaceAll('$2::timestamptz', 'NULL::timestamptz')
    .replaceAll('$3::timestamptz', 'NULL::timestamptz').replaceAll('$4::integer', '5000::integer').replaceAll('$5::integer', '5000::integer');
  if (/\$[1-5]\b/.test(query) || !query.trimStart().startsWith('WITH request AS MATERIALIZED')
    || /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|CALL|DO)\b/i.test(query)) throw new AssayError('candidate_query_contract_changed');
  let bytes, receipt;
  const started = Date.now();
  try {
    const read = deps.readQuery ?? (async query => (await execute('bash', [path.join(REPO_ROOT, 'scripts/data/q.sh'), query],
      { cwd: REPO_ROOT, timeout: 65000, maxBuffer: 32 * 1024 * 1024 })).stdout);
    bytes = await read(query);
    const result = JSON.parse(bytes);
    if (!Array.isArray(result) || result.length !== 1 || !record(result[0].receipt)) throw new Error('invalid_query_response');
    receipt = result[0].receipt;
  } catch { throw new AssayError('sanctioned_read_failed'); }
  const computedAt = new Date().toISOString();
  const options = {
    population: { key: subject.toLowerCase(), label: 'Registered subject current public parent page',
      basis: 'cohort_members_current_public_undeleted_real_parent_page', complete: false },
    subject: { sourcePlatform: null, sourceEpisodeKey: null, vehicleId: null, currency: null, priceBasis: null, relevance: [] },
    policy: { key: '', basis: '', requiredDimensions: [] }, eventFrom: '1900-01-01T00:00:00Z',
    eventBefore: computedAt, evidenceAsOf: computedAt, computedAt, knowledgeMode: 'retrospective', minimumMatchedSales: 10,
  };
  return { input: validateInput({ schemaVersion: 'sale_event_candidate_assay_v1', receipt, options }),
    sha256: createHash('sha256').update(bytes).digest('hex'), liveRead: {
      subjectId: subject.toLowerCase(), queryTool: 'scripts/data/q.sh',
      querySha256: createHash('sha256').update(query).digest('hex'), readCompletedAt: computedAt,
      requestElapsedMs: Date.now() - started, nativeRowsPerTableLimit: 5000, captureHeaderLimit: 5000,
    } };
}

async function outputPath(file) {
  const parent = await realpath(path.dirname(path.resolve(file)));
  const relative = path.relative(REPO_ROOT, parent);
  if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new AssayError('private_output_outside_checkout_required');
  }
  return path.join(parent, path.basename(file));
}

export async function main(args = process.argv.slice(2), deps = {}) {
  const print = deps.print ?? console.log;
  let output;
  try {
    const argsParsed = parseArgs(args);
    const target = await outputPath(argsParsed.out);
    // An existing file or symlink refuses before a privileged query. The final
    // exclusive open also protects against a file arriving during the read.
    try { await lstat(target); throw new AssayError('output_exists_or_unwritable'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const { input, sha256, liveRead } = argsParsed.subject
      ? await readSubject(argsParsed.subject, deps) : await readInput(argsParsed.input);
    const select = deps.select ?? (await import('../nuke_frontend/src/lib/dealRead/batComps.ts')).selectSourceSalePopulation;
    const nativeReceipt = input.schemaVersion === 'sale_event_candidate_assay_v1' ? input.receipt : null;
    const result = select(input.rows, nativeReceipt && !nativeReceipt.coverage.complete
      ? { ...input.options, population: { ...input.options.population, complete: false } } : input.options);
    const repairPlan = nativeReceipt ? candidateRepairPlan(nativeReceipt) : null;
    try { output = await open(target, 'wx', 0o600); } catch { throw new AssayError('output_exists_or_unwritable'); }
    const report = {
      stage: 'local_read_only_sale_population_assay',
      source: { inputSha256: sha256, schemaVersion: input.schemaVersion },
      boundary: `${liveRead ? 'Current registered-subject reader inputs' : 'Saved reader inputs'} are audited; this run admits no source evidence and installs no production reader.`,
      databaseWrites: 0, modelCalls: 0, networkCalls: liveRead ? 1 : 0,
      ...(liveRead ? { liveRead } : {}),
      ...(liveRead ? { nativeEvidence: nativeReceipt } : {}),
      result,
      ...(repairPlan ? { repairPlan } : {}),
    };
    await output.writeFile(JSON.stringify(report, null, 2) + '\n');
    print(JSON.stringify({ stage: report.stage, inputSha256: sha256, counts: result.counts, reasons: result.reasons,
      repeatSalePairs: result.repeatSales.length, ...(repairPlan ? { repairCounts: repairPlan.counts } : {}),
      databaseWrites: 0, modelCalls: 0, networkCalls: report.networkCalls }));
    return 0;
  } catch (error) {
    print(JSON.stringify({ success: false, error: error instanceof AssayError ? error.code : 'assay_failed' }));
    return 1;
  } finally { await output?.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
