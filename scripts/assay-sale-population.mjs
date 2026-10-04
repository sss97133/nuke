#!/usr/bin/env node
/**
 * Audit saved sale-event reader inputs with the existing deal-read selector.
 * No network, source intake, database writes, inference or profile-price updates.
 * Input: { schemaVersion: 'sale_event_population_v1', rows, options }.
 * Run: node scripts/assay-sale-population.mjs --input /private/input.json --out /private/receipt.json
 * Requires Node 22.18+ for the project's erasable TypeScript module.
 */
import { open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
    if (!['--input', '--out'].includes(flag) || options[flag.slice(2)] || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new AssayError('invalid_arguments');
    }
    options[flag.slice(2)] = args[++index];
  }
  if (!options.input || !options.out) throw new AssayError('input_and_out_required');
  return options;
}

export function validateInput(input) {
  if (!record(input) || input.schemaVersion !== 'sale_event_population_v1' || !Array.isArray(input.rows) || !record(input.options)) {
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
    const { input, sha256 } = await readInput(argsParsed.input);
    const select = deps.select ?? (await import('../nuke_frontend/src/lib/dealRead/batComps.ts')).selectSourceSalePopulation;
    const result = select(input.rows, input.options);
    const target = await outputPath(argsParsed.out);
    try { output = await open(target, 'wx', 0o600); } catch { throw new AssayError('output_exists_or_unwritable'); }
    const report = {
      stage: 'local_read_only_sale_population_assay',
      source: { inputSha256: sha256, schemaVersion: input.schemaVersion },
      boundary: 'Saved reader inputs are audited; this run admits no source evidence and installs no production reader.',
      databaseWrites: 0, modelCalls: 0, networkCalls: 0,
      result,
    };
    await output.writeFile(JSON.stringify(report, null, 2) + '\n');
    print(JSON.stringify({ stage: report.stage, inputSha256: sha256, counts: result.counts, reasons: result.reasons,
      repeatSalePairs: result.repeatSales.length, databaseWrites: 0, modelCalls: 0, networkCalls: 0 }));
    return 0;
  } catch (error) {
    print(JSON.stringify({ success: false, error: error instanceof AssayError ? error.code : 'assay_failed' }));
    return 1;
  } finally { await output?.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
