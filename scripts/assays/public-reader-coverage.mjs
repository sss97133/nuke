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
const SPEC_FIELDS = new Set(['vin', 'mileage', 'transmission', 'drivetrain', 'body_style', 'color', 'interior_color', 'engine_type', 'fuel_type', 'engine_size']);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const present = x => x !== null && x !== undefined && (typeof x !== 'string' || x.trim() !== '');
const number = x => present(x) && (typeof x === 'number' || typeof x === 'string') && Number.isFinite(Number(x)) ? Number(x) : null;
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const date = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) &&
  Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x;
class AssayError extends Error { constructor(code) { super(code); this.code = code; } }

export function options(args, now = Date.now()) {
  const o = { family: 'price', scope: 'sold', pageSize: 200, maxPages: 10000, after: ZERO, until: now + 15 * 60_000 };
  const seen = new Set();
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i];
    if (!['--out', '--env', '--scope', '--page-size', '--max-pages', '--after', '--until', '--family', '--subjects'].includes(name) ||
      seen.has(name) || !args[i + 1] || args[i + 1].startsWith('--')) throw new AssayError('invalid_arguments');
    seen.add(name);
    const v = args[i + 1];
    if (name === '--page-size') o.pageSize = /^\d+$/.test(v) ? Number(v) : NaN;
    else if (name === '--max-pages') o.maxPages = /^\d+$/.test(v) ? Number(v) : NaN;
    else if (name === '--until') o.until = Date.parse(v);
    else o[name.slice(2)] = v;
  }
  if (!o.out || !['price', 'specifications'].includes(o.family) ||
    (o.family === 'specifications') !== Boolean(o.subjects) ||
    !['sold', 'all'].includes(o.scope) || !UUID.test(o.after) ||
    !Number.isInteger(o.pageSize) || o.pageSize < 20 || o.pageSize > 1000 ||
    !Number.isInteger(o.maxPages) || o.maxPages < 1 || o.maxPages > 10000 ||
    !Number.isFinite(o.until) || o.until <= now || o.until > now + 14 * 60 * 60_000) throw new AssayError('invalid_scope');
  o.after = o.after.toLowerCase();
  if (o.family === 'specifications') {
    if (['--scope', '--after', '--page-size'].some(key => seen.has(key))) throw new AssayError('manifest_scope_has_no_price_cursor');
    o.scope = 'explicit_manifest';
  }
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
      if (Number(r.headers.get('content-length')) > 2_000_000) {
        await r.body?.cancel();
        return { ok: false, code: 'response_byte_limit', status: r.status };
      }
      // Enforce the cap while consuming chunked responses, before accumulating
      // a potentially unbounded provenance body. No raw error/body is emitted.
      const reader = r.body?.getReader(), chunks = [];
      let bytes = 0;
      if (reader) for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 2_000_000) { await reader.cancel(); return { ok: false, code: 'response_byte_limit', status: r.status }; }
        chunks.push(chunk.value);
      }
      const body = Buffer.concat(chunks).toString('utf8');
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
    subjects(ids) {
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 200 || !ids.every(id => UUID.test(id))) throw new AssayError('invalid_reader_scope');
      const q = new URLSearchParams({ select: 'id,is_public,deleted_at,listing_kind', is_public: 'eq.true', deleted_at: 'is.null',
        or: '(listing_kind.is.null,listing_kind.neq.non_vehicle_item)', id: `in.(${ids.join(',')})`, order: 'id.asc', limit: String(ids.length) });
      return request(`vehicles?${q}`);
    },
    rpc(name, args) {
      if (!READERS.has(name)) throw new AssayError('reader_not_allowed');
      if (name === 'vehicle_price_facts' && (!Array.isArray(args?.p_vehicle_ids) || args.p_vehicle_ids.length < 1 ||
        args.p_vehicle_ids.length > 1000 || !args.p_vehicle_ids.every(id => UUID.test(id)))) throw new AssayError('invalid_reader_scope');
      if (name !== 'vehicle_price_facts' && (!UUID.test(args?.p_vehicle_id ?? '') ||
        name === 'get_field_provenance' && !SPEC_FIELDS.has(args?.p_field))) throw new AssayError('invalid_reader_scope');
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

export function lineageSubjects(input) {
  if (!object(input) || input.schemaVersion !== 'public_reader_lineage_subjects_v1' ||
    !object(input.population) || !/^[a-z0-9_.-]{1,80}$/.test(input.population.key ?? '') ||
    typeof input.population.basis !== 'string' || input.population.basis.length < 1 || input.population.basis.length > 500 ||
    typeof input.population.complete !== 'boolean' || !Array.isArray(input.vehicleIds) ||
    input.vehicleIds.length < 1 || input.vehicleIds.length > 10000 || !input.vehicleIds.every(id => UUID.test(id))) throw new AssayError('invalid_lineage_subjects');
  const ids = input.vehicleIds.map(id => id.toLowerCase()).sort();
  if (new Set(ids).size !== ids.length) throw new AssayError('duplicate_lineage_subjects');
  return { population: input.population, ids, sha256: hash(input) };
}

// Preserve PostgreSQL's microsecond clock precision and compare offsets rather
// than rounding a fold-boundary event into the same JavaScript millisecond.
function instant(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  const seconds = m ? Date.parse(m[1] + m[3]) : NaN;
  return Number.isFinite(seconds) ? BigInt(seconds) * 1000n + BigInt((m[2] ?? '').padEnd(6, '0')) : null;
}

export function inspectSpecification(value) {
  const result = { fields: 0, selectedReports: 0, canonicalUnknownWithReport: 0, conflicts: 0,
    canonicalWithoutSelectedReport: 0, unrecognizedFields: 0, failures: {}, gaps: {}, reports: [], safe: true };
  const issue = (group, key) => { result[group][key] = (result[group][key] ?? 0) + 1; };
  if (!Array.isArray(value) || value.length > 32) { issue('failures', 'specification_shape_invalid'); result.safe = false; return result; }
  const seen = new Set();
  for (const s of value) {
    if (!object(s) || typeof s.field !== 'string' || seen.has(s.field)) { issue('failures', 'specification_field_invalid_or_duplicate'); result.safe = false; continue; }
    seen.add(s.field);
    if (!SPEC_FIELDS.has(s.field)) { result.unrecognizedFields++; continue; }
    result.fields++;
    if (s.reported_conflict === true) result.conflicts++;
    if (!present(s.source_observation_id)) {
      if (present(s.value)) result.canonicalWithoutSelectedReport++;
      if (present(s.reported_value)) issue('failures', 'reported_value_without_source_observation');
      continue;
    }
    if (!UUID.test(s.source_observation_id)) { issue('failures', 'selected_observation_id_invalid'); result.safe = false; continue; }
    result.selectedReports++;
    if (!present(s.value) && present(s.reported_value)) result.canonicalUnknownWithReport++;
    const observed = instant(s.reported_observed_at), ingested = instant(s.reported_ingested_at), cutoff = instant(s.as_of_at);
    if (observed === null || ingested === null || cutoff === null) issue('gaps', 'selected_report_clock_unknown');
    else if (observed > cutoff || ingested > cutoff) issue('failures', 'selected_report_after_fold_cutoff');
    if (!present(s.reported_method)) issue('gaps', 'selected_report_method_unknown');
    if (!present(s.reported_source)) issue('gaps', 'selected_report_source_slug_unknown');
    if (!present(s.reported_confidence)) issue('gaps', 'selected_report_confidence_unknown');
    else if (number(s.reported_confidence) === null || number(s.reported_confidence) < 0 || number(s.reported_confidence) > 1) issue('failures', 'selected_report_confidence_invalid');
    // The reader explicitly marks only the new listed engine phrase. Absence
    // of a binding on another field is unmeasured, never proof of installation.
    issue('gaps', s.sale_episode_binding === 'unestablished' ? 'selected_report_sale_episode_unestablished' : 'selected_report_sale_episode_binding_unmeasured');
    result.reports.push(s);
  }
  return result;
}

export function inspectProvenance(id, report, value) {
  const result = { failures: {}, gaps: {}, selectedObservationFound: false, lineageMatches: false };
  const fail = key => { result.failures[key] = 1; };
  if (!object(value) || value.vehicle_id !== id || value.field !== report.field || !Array.isArray(value.observations)) {
    fail('provenance_shape_or_subject_invalid'); return result;
  }
  const observations = value.observations.filter(o => object(o) && o.id === report.source_observation_id);
  if (observations.length !== 1) { fail(observations.length ? 'selected_observation_duplicated_in_drill' : 'selected_observation_missing_from_current_drill'); return result; }
  result.selectedObservationFound = true;
  const observation = observations[0];
  for (const [source, drilled, issue] of [
    ['reported_observed_at', 'observed_at', 'selected_observation_event_clock_mismatch'],
    ['reported_ingested_at', 'ingested_at', 'selected_observation_ingest_clock_mismatch'],
    ['reported_method', 'extraction_method', 'selected_observation_method_mismatch'],
    ['reported_confidence', 'confidence', 'selected_observation_confidence_mismatch'],
    ['reported_source', 'source_slug', 'selected_observation_source_slug_mismatch'],
  ]) if (present(report[source]) && report[source] !== observation[drilled]) fail(issue);
  if (present(report.reported_value) && report.reported_value !== observation.value) fail('selected_observation_reported_value_mismatch');
  result.lineageMatches = Object.keys(result.failures).length === 0;
  return result;
}

export async function runSpecificationLineage(client, o, subjects, { now = Date.now, emit = async () => {}, progress = () => {} } = {}) {
  const summary = { stage: 'read_only_public_specification_provenance_lineage_assay', startedAt: new Date(now()).toISOString(),
    requestedParents: subjects.ids.length, manifestSha256: subjects.sha256, population: subjects.population,
    gatedParents: 0, eligibleParents: 0, absentOrIneligibleParents: 0, inspectedParents: 0, completedParents: 0,
    selectedReports: 0, drilledReports: 0, matchingReports: 0, canonicalUnknownWithReport: 0, conflicts: 0,
    canonicalWithoutSelectedReport: 0, failures: {}, gaps: {}, samples: {}, databaseWrites: 0, modelCalls: 0, recordRepairs: 0,
    sourceQualification: 'unmeasured', conditionAtSale: 'unmeasured', comparableCohort: 'unmeasured',
    boundary: 'Explicit manifest, current anonymous public/undeleted real-vehicle gate. Selected core specification reports only; not all testimony, condition, image analysis or historical sale-time configuration. Separate RPCs are not an immutable snapshot. Provenance owner is unbounded; client time/body caps refuse unmeasured reads.' };
  let consecutiveFailures = 0;
  const merge = (part, id) => {
    for (const group of ['failures', 'gaps']) for (const [key, count] of Object.entries(part[group])) {
      summary[group][key] = (summary[group][key] ?? 0) + count;
      if (id) { summary.samples[key] ??= []; if (summary.samples[key].length < 10 && !summary.samples[key].includes(id)) summary.samples[key].push(id); }
    }
  };
  outer: for (let offset = 0, pages = 0; offset < subjects.ids.length; offset += 200, pages++) {
    if (now() >= o.until || pages >= o.maxPages) { summary.stopReason = now() >= o.until ? 'time_budget_reached' : 'page_budget_reached'; break; }
    const batch = subjects.ids.slice(offset, offset + 200), gate = await client.subjects(batch);
    if (!gate.ok || !Array.isArray(gate.value)) { merge({ failures: { lineage_parent_reader_failed: 1 }, gaps: {} }); summary.stopReason = 'lineage_parent_reader_failed'; break; }
    const eligible = new Set();
    for (const p of gate.value) {
      if (!object(p) || !batch.includes(p.id) || eligible.has(p.id) || p.is_public !== true || p.deleted_at !== null || p.listing_kind === 'non_vehicle_item') {
        merge({ failures: { lineage_parent_gate_invalid: 1 }, gaps: {} }); summary.stopReason = 'lineage_parent_gate_invalid'; break outer;
      }
      eligible.add(p.id);
    }
    // Do not invoke any child reader for a denied/absent parent. The private
    // receipt keeps only aggregate denials, never an alleged private payload.
    summary.gatedParents += batch.length; summary.eligibleParents += eligible.size; summary.absentOrIneligibleParents += batch.length - eligible.size;
    await emit({ type: 'lineage_gate', requested: batch.length, eligible: eligible.size, absentOrIneligible: batch.length - eligible.size, responseSha256: hash(gate.value), durationMs: gate.durationMs });
    for (const id of batch.filter(id => eligible.has(id))) {
      if (now() >= o.until) { summary.stopReason = 'time_budget_reached'; break outer; }
      const specs = await client.rpc('get_vehicle_specs', { p_vehicle_id: id });
      summary.inspectedParents++;
      if (!specs.ok) {
        merge({ failures: { specification_reader_failed: 1 }, gaps: { specification_parents_unmeasured: 1 } }, id);
        consecutiveFailures++;
        await emit({ type: 'lineage_reader_failure', reader: 'get_vehicle_specs', vehicleId: id, status: specs.status, code: specs.code });
      } else {
        const inspected = inspectSpecification(specs.value); merge(inspected, id);
        summary.canonicalUnknownWithReport += inspected.canonicalUnknownWithReport; summary.conflicts += inspected.conflicts;
        summary.canonicalWithoutSelectedReport += inspected.canonicalWithoutSelectedReport; summary.selectedReports += inspected.selectedReports;
        if (!inspected.safe) { summary.stopReason = 'unsafe_specification_output'; break outer; }
        let complete = true;
        const drills = [];
        for (const report of inspected.reports) {
          if (now() >= o.until) { summary.stopReason = 'time_budget_reached'; complete = false; break; }
          const drill = await client.rpc('get_field_provenance', { p_vehicle_id: id, p_field: report.field });
          if (!drill.ok) {
            complete = false; consecutiveFailures++;
            merge({ failures: { provenance_reader_failed: 1 }, gaps: { selected_report_drill_unmeasured: 1 } }, id);
            drills.push({ field: report.field, status: drill.status, code: drill.code, durationMs: drill.durationMs });
          } else {
            consecutiveFailures = 0; summary.drilledReports++;
            const result = inspectProvenance(id, report, drill.value); merge(result, id);
            if (result.lineageMatches) summary.matchingReports++;
            drills.push({ field: report.field, sourceObservationId: report.source_observation_id, responseSha256: hash(drill.value), durationMs: drill.durationMs, ...result });
          }
          if (consecutiveFailures >= 2) { summary.stopReason = 'two_consecutive_lineage_reader_failures_inspect_cause'; break; }
        }
        if (complete) summary.completedParents++;
        await emit({ type: 'lineage_parent', vehicleId: id, measuredAt: new Date(now()).toISOString(), specsSha256: hash(specs.value), specsDurationMs: specs.durationMs,
          fields: inspected.fields, selectedReports: inspected.selectedReports, canonicalUnknownWithReport: inspected.canonicalUnknownWithReport,
          conflicts: inspected.conflicts, failures: inspected.failures, gaps: inspected.gaps, drills });
        if (summary.stopReason) break outer;
        if (!inspected.reports.length) consecutiveFailures = 0;
      }
      if (consecutiveFailures >= 2) { summary.stopReason = 'two_consecutive_lineage_reader_failures_inspect_cause'; break outer; }
      if (summary.inspectedParents % 25 === 0) progress({ inspectedParents: summary.inspectedParents, selectedReports: summary.selectedReports, matchingReports: summary.matchingReports, failures: summary.failures });
    }
  }
  summary.stopReason ??= 'manifest_exhausted';
  summary.finishedAt = new Date(now()).toISOString(); summary.networkRequests = client.requests;
  summary.status = Object.keys(summary.failures).length ? 'failed' : summary.stopReason === 'manifest_exhausted' && summary.inspectedParents > 0 ? 'passed_selected_current_lineage_in_manifest' : 'incomplete';
  summary.exitCode = summary.status === 'failed' ? 1 : summary.status === 'incomplete' ? 2 : 0;
  await emit({ type: 'summary', ...summary });
  return summary;
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
    const subjects = o.family === 'specifications' ? lineageSubjects(JSON.parse(await readFile(o.subjects, 'utf8'))) : null;
    file = await privateOutput(o.out);
    const emit = value => file.writeFile(JSON.stringify(value) + '\n');
    await emit({ type: 'manifest', schemaVersion: 'public_reader_coverage_v2',
      assaySourceSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
      options: { ...o, env: undefined, out: undefined, subjects: undefined },
      anonymous: true, readers: subjects ? ['vehicles', 'get_vehicle_specs', 'get_field_provenance'] : ['vehicles', 'vehicle_price_facts'],
      parentFields: subjects ? 'id,is_public,deleted_at,listing_kind' : PARENT_FIELDS,
      outputContains: 'response/page hashes, scope, clocks, counts and bounded public failure UUIDs; no raw source/comment bodies or credentials' });
    const report = subjects ? await runSpecificationLineage(client, o, subjects, { ...deps, emit, progress: value => print(JSON.stringify(value)) })
      : await runCoverage(client, o, { ...deps, emit, progress: value => print(JSON.stringify(value)) });
    print(JSON.stringify({ status: report.status, stopReason: report.stopReason, inspectedRecords: report.inspectedRecords,
      measuredFoldRecords: report.measuredFoldRecords, recordsPerSecond: report.recordsPerSecond, failures: report.failures,
      inspectedParents: report.inspectedParents, selectedReports: report.selectedReports, matchingReports: report.matchingReports,
      diagnostics: report.diagnostics, gaps: report.gaps, recordRepairs: 0, verifiedRepairs: 0, databaseWrites: 0, modelCalls: 0 }));
    return report.exitCode;
  } catch (e) { print(JSON.stringify({ status: 'failed', error: e instanceof AssayError ? e.code : 'assay_initialization_or_output_failed' })); return 1; }
  finally { await file?.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
