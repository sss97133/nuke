#!/usr/bin/env node
/**
 * Current public parent -> existing sale/price fold coverage assay.
 * Keyset pages, anonymous credentials, bounded requests, append-only PRIVATE receipt.
 * No counts over the store, raw testimony reconstruction, intake, writes or inference.
 * Example: bash scripts/check-ingestion-health.sh --public-readers --env /private/env
 *   --out /private/new-receipt.jsonl --until 2026-10-05T13:28:04Z --scope sold
 */
import { open, realpath, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROJECT = 'https://qkgaybvrernstplzjaam.supabase.co';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO = '00000000-0000-0000-0000-000000000000';
const PARENT_FIELDS = 'id,is_public,deleted_at,listing_kind,sale_status,auction_outcome,canonical_outcome,canonical_sold_price,canonical_platform,year,make,model,listing_url,discovery_url,condition_rating,body_style,engine_type,transmission,mileage';
const READERS = new Set(['vehicle_price_facts', 'get_vehicle_specs', 'get_field_provenance', 'popup_vehicle_intel']);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const present = x => x !== null && x !== undefined && (typeof x !== 'string' || x.trim() !== '');
const number = x => present(x) && (typeof x === 'number' || typeof x === 'string') && Number.isFinite(Number(x)) ? Number(x) : null;
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const date = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) &&
  Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x;
class AssayError extends Error { constructor(code) { super(code); this.code = code; } }

export function options(args, now = Date.now()) {
  const o = { scope: 'sold', pageSize: 200, maxPages: 10000, after: ZERO, until: now + 15 * 60_000 };
  const seen = new Set();
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i];
    if (!['--out', '--env', '--scope', '--page-size', '--max-pages', '--after', '--until'].includes(name) ||
      seen.has(name) || !args[i + 1] || args[i + 1].startsWith('--')) throw new AssayError('invalid_arguments');
    seen.add(name);
    const v = args[i + 1];
    if (name === '--page-size') o.pageSize = /^\d+$/.test(v) ? Number(v) : NaN;
    else if (name === '--max-pages') o.maxPages = /^\d+$/.test(v) ? Number(v) : NaN;
    else if (name === '--until') o.until = Date.parse(v);
    else o[name.slice(2)] = v;
  }
  if (!o.out || !['sold', 'all'].includes(o.scope) || !UUID.test(o.after) ||
    !Number.isInteger(o.pageSize) || o.pageSize < 20 || o.pageSize > 1000 ||
    !Number.isInteger(o.maxPages) || o.maxPages < 1 || o.maxPages > 10000 ||
    !Number.isFinite(o.until) || o.until <= now || o.until > now + 14 * 60 * 60_000) throw new AssayError('invalid_scope');
  o.after = o.after.toLowerCase();
  return o;
}

export function anonymousConfiguration(env) {
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || PROJECT).replace(/\/$/, '');
  const key = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (url !== PROJECT || typeof key !== 'string') throw new AssayError('anonymous_configuration_required');
  // Never fall back to a service key or let a privileged JWT turn this into a
  // successful "public" assay. This runner uses the deployed legacy anon JWT.
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
    if (key.split('.').length !== 3 || payload.role !== 'anon') throw new Error();
  } catch { throw new AssayError('anonymous_configuration_required'); }
  return { url, key };
}

export function publicClient(config, fetcher = fetch) {
  let requests = 0;
  async function request(route, init = {}) {
    const start = Date.now();
    requests++;
    try {
      const r = await fetcher(`${config.url}/rest/v1/${route}`, { ...init, redirect: 'error',
        signal: AbortSignal.timeout(10_000), headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' } });
      if (Number(r.headers.get('content-length')) > 2_000_000) return { ok: false, code: 'response_byte_limit', status: r.status };
      const body = await r.text();
      if (Buffer.byteLength(body) > 2_000_000) return { ok: false, code: 'response_byte_limit', status: r.status };
      const value = JSON.parse(body);
      const meta = { status: r.status, durationMs: Date.now() - start };
      if (!r.ok) return { ...meta, ok: false, code: typeof value?.code === 'string' && /^[A-Z0-9_]{1,16}$/.test(value.code) ? value.code : 'reader_http_failure' };
      return { ...meta, ok: true, value };
    } catch { return { ok: false, code: 'reader_transport_or_json_failure', durationMs: Date.now() - start }; }
  }
  return {
    get requests() { return requests; },
    parents(after, size, scope) {
      if (!UUID.test(after) || !Number.isInteger(size) || size < 1 || size > 1000 || !['sold', 'all'].includes(scope)) throw new AssayError('invalid_reader_scope');
      const q = new URLSearchParams({ select: PARENT_FIELDS, is_public: 'eq.true', deleted_at: 'is.null',
        or: '(listing_kind.is.null,listing_kind.neq.non_vehicle_item)', id: `gt.${after}`, order: 'id.asc', limit: String(size) });
      if (scope === 'sold') q.set('sale_status', 'eq.sold');
      return request(`vehicles?${q}`);
    },
    rpc(name, args) {
      if (!READERS.has(name)) throw new AssayError('reader_not_allowed');
      if (name === 'vehicle_price_facts' && (!Array.isArray(args?.p_vehicle_ids) || args.p_vehicle_ids.length < 1 ||
        args.p_vehicle_ids.length > 1000 || !args.p_vehicle_ids.every(id => UUID.test(id)))) throw new AssayError('invalid_reader_scope');
      return request(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
    },
  };
}

export function inspectPage(parents, facts, { after = ZERO, scope = 'sold' } = {}) {
  const failures = {}, diagnostics = {}, gaps = {}, samples = {};
  const add = (group, key, id) => { group[key] = (group[key] || 0) + 1; if (id && UUID.test(id)) { samples[key] ??= []; if (samples[key].length < 10) samples[key].push(id); } };
  const result = { inspected: 0, factRows: 0, failures, diagnostics, gaps, samples,
    denominators: { supportedSaleBasis: 0, soldAmount: 0, datedSoldAmount: 0, canonicalSold: 0 },
    currentMetadata: { condition: 0, body: 0, engine: 0, transmission: 0, mileage: 0 }, safe: true };
  if (!Array.isArray(parents)) { failures.parent_shape_invalid = 1; result.safe = false; return result; }
  const map = new Map();
  let last = after;
  for (const p of parents) {
    if (!object(p) || !UUID.test(p.id ?? '') || p.is_public !== true || p.deleted_at !== null || p.listing_kind === 'non_vehicle_item' ||
      (scope === 'sold' && p.sale_status !== 'sold')) { add(failures, 'ineligible_parent_returned'); result.safe = false; continue; }
    const id = p.id.toLowerCase();
    if (id <= last) { add(failures, 'parent_cursor_not_strictly_increasing', id); result.safe = false; }
    last = id; map.set(id, p); result.inspected++;
    for (const [metric, field] of Object.entries({ condition: 'condition_rating', body: 'body_style', engine: 'engine_type', transmission: 'transmission', mileage: 'mileage' })) {
      if (present(p[field])) result.currentMetadata[metric]++;
    }
    if (!present(p.year) || !present(p.make) || !present(p.model)) add(gaps, 'current_identity_incomplete', id);
  }
  if (!Array.isArray(facts)) { failures.fold_shape_invalid = 1; gaps.fold_records_unmeasured = map.size; result.safe = false; return result; }
  const seen = new Set();
  for (const f of facts) {
    const id = typeof f?.vehicle_id === 'string' ? f.vehicle_id.toLowerCase() : '';
    if (!object(f) || !map.has(id)) { add(failures, 'fold_returned_unrequested_parent'); result.safe = false; continue; }
    if (seen.has(id)) { add(failures, 'duplicate_fold_row', id); continue; }
    seen.add(id); result.factRows++;
    const p = map.get(id);
    if (!['sold', 'ask', 'bid', 'estimate', null].includes(f.price_kind) || typeof f.price_live !== 'boolean' ||
      !Object.hasOwn(f, 'sold_amount') || !Object.hasOwn(f, 'sold_basis') || !Object.hasOwn(f, 'outcome')) add(failures, 'fold_shape_invalid', id);
    const sale = number(f.sold_amount), price = number(f.price_amount);
    if (present(f.sold_basis)) result.denominators.supportedSaleBasis++;
    if (sale > 0) result.denominators.soldAmount++;
    if (sale > 0 && date(f.sold_on)) result.denominators.datedSoldAmount++;
    if (p.canonical_outcome === 'sold') result.denominators.canonicalSold++;
    if (present(f.sold_amount) && (sale === null || sale <= 0)) add(failures, 'sold_amount_not_positive', id);
    if (present(f.sold_on) && !date(f.sold_on)) add(failures, 'sold_date_invalid', id);
    if (f.sold_basis !== null && (['no_sale', 'reserve_not_met'].includes(p.auction_outcome) || ['not_sold', 'unsold', 'bid_to'].includes(p.sale_status))) add(failures, 'explicit_no_sale_promoted', id);
    if (f.price_kind === 'sold' && (!present(f.sold_basis) || f.outcome !== 'sold' || price !== sale)) add(failures, 'sold_fold_inconsistent', id);
    if (present(f.sold_basis) && !present(f.sold_amount)) add(gaps, 'sold_amount_unknown', id);
    if (present(f.sold_basis) && !present(f.sold_on)) add(gaps, 'sold_date_unknown', id);
    if (present(f.sold_basis) && !present(f.source_url)) {
      add(gaps, 'sold_source_unknown', id);
      if (present(p.discovery_url)) add(diagnostics, 'sale_fold_source_missing_with_discovery_locator', id);
    }
    if (p.sale_status === 'sold' && !present(f.sold_basis)) add(diagnostics, 'sold_status_without_supported_basis', id);
    if (p.sale_status === 'sold' && ['no_sale', 'reserve_not_met'].includes(p.auction_outcome)) add(diagnostics, 'stored_sale_outcome_conflict', id);
    if (f.price_live && present(f.sold_basis)) add(diagnostics, 'live_and_sold_context', id);
    const canonical = number(p.canonical_sold_price);
    // This misleadingly named column also stores asks/bids/estimates. Compare
    // only a canonical sold context, and do not choose which amount is true.
    if (p.canonical_outcome === 'sold' && canonical > 0 && sale !== canonical) add(diagnostics, 'canonical_amount_differs_from_sale_fold', id);
    if (present(f.sold_basis) && p.canonical_outcome !== 'sold') add(diagnostics, 'supported_sale_basis_without_canonical_sold_context', id);
  }
  for (const id of map.keys()) if (!seen.has(id)) add(failures, 'public_parent_missing_fold_row', id);
  return result;
}

async function privateOutput(file) {
  const directory = await realpath(path.dirname(path.resolve(file)));
  const relative = path.relative(ROOT, directory);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new AssayError('private_output_outside_checkout_required');
  return open(path.join(directory, path.basename(file)), 'wx', 0o600);
}

export async function runCoverage(client, o, { now = Date.now, emit = async () => {}, progress = () => {} } = {}) {
  const start = now();
  const report = { stage: 'read_only_public_parent_sale_fold_assay', scope: o.scope === 'sold' ? 'current_public_real_vehicles_with_recorded_sale_status_sold' : 'current_public_real_vehicles',
    startedAt: new Date(start).toISOString(), after: o.after, lastFetchedId: o.after, lastFullyMeasuredId: o.after,
    pages: 0, inspectedRecords: 0, measuredFoldRecords: 0, failures: {}, diagnostics: {}, gaps: {}, denominators: {}, currentMetadata: {}, samples: {},
    recordRepairs: 0, verifiedRepairs: 0, databaseWrites: 0, modelCalls: 0, sourceQualification: 'unmeasured', saleTimeFeatureMatching: 'unmeasured',
    boundary: 'Current anonymous parent and canonical sale/price fold only. Metadata presence is not sale-time condition, source truth or peer matching. No immutable historical snapshot or fleet health claim.' };
  let cursor = o.after, failuresInARow = 0, completePrefix = true;
  for (; report.pages < o.maxPages && now() < o.until;) {
    const p = await client.parents(cursor, o.pageSize, o.scope);
    if (!p.ok || !Array.isArray(p.value)) { report.failures.parent_reader_failure = 1; report.stopReason = 'parent_reader_failure'; await emit({ type: 'reader_failure', reader: 'vehicles', status: p.status, code: p.code }); break; }
    if (!p.value.length) { report.stopReason = 'current_scope_exhausted'; break; }
    // Validate eligibility/cursor BEFORE calling a child reader.
    const gate = inspectPage(p.value, [], { after: cursor, scope: o.scope });
    if (!gate.safe || p.value.length > o.pageSize) { report.failures.parent_scope_or_cursor_invalid = 1; report.stopReason = 'parent_scope_or_cursor_invalid'; break; }
    const f = await client.rpc('vehicle_price_facts', { p_vehicle_ids: p.value.map(v => v.id) });
    const result = f.ok ? inspectPage(p.value, f.value, { after: cursor, scope: o.scope }) : { ...gate, factRows: 0, failures: { fold_reader_failure: 1 }, gaps: { ...gate.gaps, fold_records_unmeasured: p.value.length }, samples: {} };
    failuresInARow = f.ok ? 0 : failuresInARow + 1;
    cursor = p.value.at(-1).id.toLowerCase(); report.lastFetchedId = cursor; report.pages++;
    report.inspectedRecords += result.inspected; report.measuredFoldRecords += result.factRows;
    for (const key of ['failures', 'diagnostics', 'gaps', 'denominators', 'currentMetadata']) for (const [k, v] of Object.entries(result[key])) report[key][k] = (report[key][k] || 0) + v;
    for (const [k, ids] of Object.entries(result.samples)) report.samples[k] = [...new Set([...(report.samples[k] || []), ...ids])].slice(0, 10);
    if (!f.ok || Object.keys(result.failures).length) completePrefix = false;
    if (completePrefix) report.lastFullyMeasuredId = cursor;
    await emit({ type: 'page', page: report.pages, after: p.value[0].id, through: cursor, measuredAt: new Date(now()).toISOString(),
      parentStatus: p.status, foldStatus: f.status, parentDurationMs: p.durationMs, foldDurationMs: f.durationMs, foldError: f.code,
      inputSha256: hash({ parents: p.value, facts: f.ok && result.safe ? f.value : null }), result });
    if (report.pages % 10 === 0) progress({ pages: report.pages, inspectedRecords: report.inspectedRecords, measuredFoldRecords: report.measuredFoldRecords,
      recordsPerSecond: +(report.inspectedRecords / Math.max(1, (now() - start) / 1000)).toFixed(1), failureKinds: Object.keys(report.failures) });
    if (!result.safe) { report.stopReason = 'unsafe_fold_output'; break; }
    if (failuresInARow >= 2) { report.stopReason = 'two_consecutive_fold_failures_inspect_cause_before_resuming'; break; }
    // A short page can be a server row cap. Only an empty subsequent keyset
    // page establishes exhaustion of the currently readable scope.
  }
  report.stopReason ??= report.pages >= o.maxPages ? 'page_budget_reached' : 'time_budget_reached';
  report.finishedAt = new Date(now()).toISOString(); report.networkRequests = client.requests;
  report.recordsPerSecond = +(report.inspectedRecords / Math.max(1, (now() - start) / 1000)).toFixed(1);
  report.status = Object.keys(report.failures).length ? 'failed' : report.stopReason === 'current_scope_exhausted' && report.inspectedRecords > 0 ? 'passed_operating_invariants_in_current_scope' : 'incomplete';
  report.exitCode = report.status === 'failed' ? 1 : report.status === 'incomplete' ? 2 : 0;
  await emit({ type: 'summary', ...report });
  return report;
}

export async function main(args = process.argv.slice(2), deps = {}) {
  const print = deps.print ?? console.log;
  let file;
  try {
    const o = options(args);
    if (o.env) { const require = createRequire(path.join(ROOT, 'nuke_frontend/package.json')); require('dotenv').config({ path: o.env, quiet: true }); }
    const config = anonymousConfiguration(deps.env ?? process.env);
    const client = deps.client ?? publicClient(config);
    file = await privateOutput(o.out);
    const emit = value => file.writeFile(JSON.stringify(value) + '\n');
    await emit({ type: 'manifest', schemaVersion: 'public_reader_coverage_v2',
      assaySourceSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
      options: { ...o, env: undefined, out: undefined },
      anonymous: true, readers: ['vehicles', 'vehicle_price_facts'], parentFields: PARENT_FIELDS, outputContains: 'page hashes, counts and bounded public failure UUIDs; no raw source/comment bodies or credentials' });
    const report = await runCoverage(client, o, { ...deps, emit, progress: value => print(JSON.stringify(value)) });
    print(JSON.stringify({ status: report.status, stopReason: report.stopReason, inspectedRecords: report.inspectedRecords,
      measuredFoldRecords: report.measuredFoldRecords, recordsPerSecond: report.recordsPerSecond, failures: report.failures,
      diagnostics: report.diagnostics, gaps: report.gaps, recordRepairs: 0, verifiedRepairs: 0, databaseWrites: 0, modelCalls: 0 }));
    return report.exitCode;
  } catch (e) { print(JSON.stringify({ status: 'failed', error: e instanceof AssayError ? e.code : 'assay_initialization_or_output_failed' })); return 1; }
  finally { await file?.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
