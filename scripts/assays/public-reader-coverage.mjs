#!/usr/bin/env node
/**
 * Current public parent -> existing price/specification/comment/bid reader assay.
 * Keyset pages, anonymous credentials, bounded requests, append-only PRIVATE receipt.
 * No counts over the store, raw testimony reconstruction, intake, writes or inference.
 * Typed canonical projection lineage: --family typed-specifications --subjects /private/manifest.json.
 * Publisher-reported work: --family reported-work --subjects /private/manifest.json reads
 * vehicle_build_log_public(p_vehicle_id, p_include_reported:true) and drills each report to its
 * anonymous parent listing row (same vehicle). An absent overload or zero reports is not agreement.
 * The existing public_reader_lineage_subjects_v1 manifest additionally requires
 * properties:[{key:<existing typed property key>,id:<expected registry UUID>}].
 * Compare <=20 parent keys per typed read, then only those declared properties;
 * matching public projections do not certify original-source or physical truth.
 * Example: bash scripts/check-ingestion-health.sh --public-readers --env /private/env
 *   --out /private/new-receipt.jsonl --until 2026-10-05T13:28:04Z --scope sold
 * Offline contract/source-target matrix (no network or environment): same command with
 *   --acceptance-matrix /private/manifest.json --out /private/new-matrix.json
 * Schema public_inventory_acceptance_v1: population, assessments[], targets[], targetPlanComplete.
 * Compiles supplied gate receipts; does not independently verify them or measure fleet readiness.
 * Full dated-population reconciliation (offline, bounded memory):
 *   --reconcile-population /private/config.json --out /private/new-report.jsonl
 * Config: schemaVersion as above, mode: population_reconciliation_v1,
 * population: { key, grain, filter, measuredAt, window: {start,end}, denominator,
 *   fullRetained: {count,grain}, fullPublic: {count,grain}, evidenceStage: cached_census|dated_export,
 *   sourceReceipt: {id,sha256} }, capabilities: [{id,grain,eligibilityRule,eligibleCount}],
 * manifest / assessments: {path,rows,sha256,exhausted:true}. Paths are relative to config.
 * Subject JSONL: {type:subject,key,grain,capabilities:[sorted applicable capability IDs]}.
 * Assessment JSONL: {type:assessment,key,grain,capability,gates,objectives?} (existing gate format).
 * Sort subjects by ASCII key; assessments by key then capability. No duplicate keys/pairs.
 * Both streams end with {type:end,populationKey,grain,measuredAt,window,rows,exhausted:true,
 *   sha256:<digest of all preceding exact JSONL bytes>}. Every line includes its final LF.
 * Descriptor sha256 covers the entire file, including the end receipt. Empty receipts are valid.
 * All input tails/counts/hashes must reconcile before a final summary is emitted. A partial
 * output without its terminal reconciled summary is not a completed population measurement.
 * Compare complete populations without loading either manifest into memory:
 *   --compare-populations /private/comparison.json --out /private/delta.jsonl
 * Config: {schemaVersion: as above, mode: population_comparison_v1,
 *   before: {evaluatedAt, configuration: <full reconciliation config>},
 *   after: {evaluatedAt, configuration: <full reconciliation config>}}.
 * Stream paths are relative to the comparison file. Both sides use the same
 * population filter, grain and capability eligibility rules. Arrivals/departures,
 * prior unknowns and changed objectives remain separate from shared transitions.
 * Operator identity-witness acquisition (existing read-only Management API path):
 *   --identity-evidence /private/config.json --out /private/new-segment.jsonl
 * Config: {mode:public_identity_evidence_v1, configuration:<reconciliation config>,
 *   after?:<exclusive UUID>, through?:<inclusive UUID>,
 *   budget:{batchSize:1..200,maxRequests:1..10000,pauseMs:100..60000,until}}.
 * Each private segment reports its dated full denominator, current read window,
 * exact source-path exhaustion and uninspected population. `after` selects a
 * segment, not proof that earlier segments completed. `through` bounds an exact
 * retry range within the same manifest; it does not shrink the denominator.
 * Terminal hashes certify
 * receipt bytes only. Source support is one gate; anonymous delivery, independent
 * quality, freshness and service remain unassessed. No database or model writes.
 */
import { open, realpath, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { readQuery } from './data-model-coverage.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROJECT = 'https://qkgaybvrernstplzjaam.supabase.co';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO = '00000000-0000-0000-0000-000000000000';
const PARENT_FIELDS = 'id,is_public,deleted_at,listing_kind,sale_status,auction_outcome,canonical_outcome,canonical_sold_price,canonical_platform,year,make,model,listing_url,discovery_url,condition_rating,body_style,engine_type,transmission,mileage';
const READERS = new Set(['vehicle_price_facts', 'get_vehicle_specs', 'get_field_provenance', 'popup_vehicle_intel', 'vehicle_build_log_public']);
// Parent listing identity, supersession, capture metadata, clocks and text only; never the private child.
const REPORT_SOURCE_FIELDS = 'id,vehicle_id,kind,is_superseded,source_id,source_url,observed_at,ingested_at,extraction_method,content_text,' +
  'source_captured_at:structured_data->>source_captured_at,source_capture_sha256:structured_data->>source_capture_sha256,' +
  'source_capture_basis:structured_data->>source_capture_basis,extractor_input_truncated:structured_data->extractor_input_truncated';
const SPEC_FIELDS = new Set(['vin', 'mileage', 'transmission', 'drivetrain', 'body_style', 'color', 'interior_color', 'engine_type', 'fuel_type', 'engine_size']);
// Existing bulk-reader vocabulary, not authority to register or admit a claim.
const TYPED_PROPERTIES = Object.freeze({ year: ['integer', null], make: ['string', null], model: ['string', null],
  vin: ['string', null], interior_color: ['string', null], exterior_color: ['string', null],
  engine_configuration: ['string', null], engine_displacement_l: ['numeric', 'liters'],
  engine_family_label: ['string', null], transmission_type: ['enum', null], drivetrain_layout: ['enum', null],
  mileage_miles: ['integer', 'miles'] });
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
    if (!['--out', '--env', '--scope', '--page-size', '--max-pages', '--after', '--until', '--family', '--subjects', '--comment-limit', '--bid-limit', '--comment-measurements'].includes(name) ||
      seen.has(name) || !args[i + 1] || args[i + 1].startsWith('--')) throw new AssayError('invalid_arguments');
    seen.add(name);
    const v = args[i + 1];
    if (name === '--page-size') o.pageSize = /^\d+$/.test(v) ? Number(v) : NaN;
    else if (name === '--comment-limit') o.commentLimit = /^\d+$/.test(v) ? Number(v) : NaN;
    else if (name === '--bid-limit') o.bidLimit = /^\d+$/.test(v) ? Number(v) : NaN;
    else if (name === '--comment-measurements') { if (v !== 'true') throw new AssayError('invalid_measurement_scope'); o.commentMeasurements = true; }
    else if (name === '--max-pages') o.maxPages = /^\d+$/.test(v) ? Number(v) : NaN;
    else if (name === '--until') o.until = Date.parse(v);
    else o[name.slice(2)] = v;
  }
  if (!o.out || !['price', 'specifications', 'typed-specifications', 'comments', 'bids', 'reported-work'].includes(o.family) ||
    (seen.has('--comment-limit') && o.family !== 'comments') ||
    (seen.has('--comment-measurements') && o.family !== 'comments') ||
    (o.commentLimit !== undefined && (!Number.isInteger(o.commentLimit) || o.commentLimit < 1000 || o.commentLimit > 10000)) ||
    (seen.has('--bid-limit') && o.family !== 'bids') ||
    (o.bidLimit !== undefined && (!Number.isInteger(o.bidLimit) || o.bidLimit < 1000 || o.bidLimit > 10000)) ||
    (o.family !== 'price') !== Boolean(o.subjects) ||
    !['sold', 'all'].includes(o.scope) || !UUID.test(o.after) ||
    !Number.isInteger(o.pageSize) || o.pageSize < 20 || o.pageSize > 1000 ||
    !Number.isInteger(o.maxPages) || o.maxPages < 1 || o.maxPages > 10000 ||
    !Number.isFinite(o.until) || o.until <= now || o.until > now + 14 * 60 * 60_000) throw new AssayError('invalid_scope');
  o.after = o.after.toLowerCase();
  if (o.family === 'comments') o.commentLimit ??= 1000;
  if (o.family === 'bids') o.bidLimit ??= 1000;
  if (o.family !== 'price') {
    if (['--scope', '--after', '--page-size'].some(key => seen.has(key))) throw new AssayError('manifest_scope_has_no_price_cursor');
    o.scope = 'explicit_manifest';
  }
  return o;
}

export function anonymousConfiguration(env) {
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || PROJECT).replace(/\/$/, '');
  const key = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (url !== PROJECT || typeof key !== 'string' || key.trim() !== key) throw new AssayError('anonymous_configuration_required');
  // Never fall back to a service key or let a privileged JWT turn this into a
  // successful "public" assay. Publishable keys carry no user identity. Legacy
  // anon JWTs must name this project; the server still decides key validity.
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return { url, key };
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
    if (key.split('.').length !== 3 || payload.role !== 'anon' ||
      payload.ref !== new URL(PROJECT).hostname.split('.')[0]) throw new Error();
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
        signal: AbortSignal.timeout(10_000), headers: { apikey: config.key,
          ...(config.key.startsWith('sb_publishable_') ? {} : { Authorization: `Bearer ${config.key}` }),
          'Content-Type': 'application/json' } });
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
  function contexts(table, select, ids, vehicleId) {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 200 ||
      !ids.every(id => UUID.test(id)) || new Set(ids).size !== ids.length ||
      vehicleId !== undefined && !UUID.test(vehicleId)) throw new AssayError('invalid_reader_scope');
    const q = new URLSearchParams({ select, id: `in.(${ids.join(',')})`, order: 'id.asc', limit: String(ids.length) });
    if (vehicleId !== undefined) q.set('vehicle_id', `eq.${vehicleId}`);
    return request(`${table}?${q}`);
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
    commentHeaders(id, cursor, measurements = false) {
      if (!UUID.test(id) || typeof measurements !== 'boolean') throw new AssayError('invalid_reader_scope');
      if (cursor !== undefined && (!object(cursor) || !UUID.test(cursor.id ?? '') || !commentClock(cursor.postedAt))) throw new AssayError('invalid_reader_scope');
      const q = new URLSearchParams({
        select: 'id,vehicle_id,auction_event_id,posted_at,platform,external_identity_id,author_external_identity_id,comment_type,is_seller' + (measurements ? ',sentiment_score,analyzed_at,community_stance_score,condition_polarity,stance_scored_at,stance_model,rubric_version' : ''),
        vehicle_id: `eq.${id}`, bid_amount: 'is.null', posted_at: 'not.is.null',
        order: 'posted_at.desc,id.desc', limit: '200',
      });
      if (cursor) q.set('and', `(or(comment_type.is.null,comment_type.neq.bid),or(posted_at.lt."${cursor.postedAt}",and(posted_at.eq."${cursor.postedAt}",id.lt.${cursor.id})))`);
      else q.set('or', '(comment_type.is.null,comment_type.neq.bid)');
      return request(`auction_comments?${q}`);
    },
    bidHeaders(id, after) {
      if (!UUID.test(id) || after !== undefined && !UUID.test(after)) throw new AssayError('invalid_reader_scope');
      const q = new URLSearchParams({
        select: 'comment_id,vehicle_id,observed_at,comment_type,platform,external_identity_id,auction_event_id,source_category,source_slug',
        vehicle_id: `eq.${id}`, bid_amount: 'gt.0', order: 'comment_id.asc', limit: '200',
      });
      if (after) q.set('comment_id', `gt.${after}`);
      return request(`vehicle_comments_unified?${q}`);
    },
    bidOrigins(id, ids) {
      if (!UUID.test(id ?? '')) throw new AssayError('invalid_reader_scope');
      return contexts('auction_comments', 'id,vehicle_id,posted_at,comment_type,platform,external_identity_id,author_external_identity_id,auction_event_id', ids, id);
    },
    bidObservationOrigins(id, ids) {
      if (!UUID.test(id ?? '')) throw new AssayError('invalid_reader_scope');
      return contexts('vehicle_observations', 'id,vehicle_id,observed_at,kind,source_comment_id,confidence_score,is_superseded,extraction_method', ids, id);
    },
    sourceAuctions(id, ids) {
      if (!UUID.test(id ?? '')) throw new AssayError('invalid_reader_scope');
      return contexts('auction_events', 'id,vehicle_id,source', ids, id);
    },
    sourceIdentities(ids) { return contexts('external_identities', 'id,platform', ids); },
    reportSources(id, ids) {
      if (!UUID.test(id ?? '')) throw new AssayError('invalid_reader_scope');
      return contexts('vehicle_observations', REPORT_SOURCE_FIELDS, ids, id);
    },
    rpc(name, args) {
      if (!READERS.has(name)) throw new AssayError('reader_not_allowed');
      if (name === 'vehicle_build_log_public') {
        // The opt-in overload only: the one-argument legacy reader is a different contract.
        if (!object(args) || Object.keys(args).sort().join() !== 'p_include_reported,p_vehicle_id' ||
          args.p_include_reported !== true || !UUID.test(args.p_vehicle_id ?? '')) throw new AssayError('invalid_reader_scope');
        return request(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
      }
      if (name === 'get_vehicle_specs' && Object.hasOwn(args ?? {}, 'p_vehicle_ids')) {
        if (Object.keys(args).some(key => !['p_vehicle_ids', 'p_include_typed_claims'].includes(key)) ||
          args.p_include_typed_claims !== true || !Array.isArray(args.p_vehicle_ids) || args.p_vehicle_ids.length < 1 ||
          args.p_vehicle_ids.length > 20 || !args.p_vehicle_ids.every(id => UUID.test(id)) ||
          new Set(args.p_vehicle_ids.map(id => id.toLowerCase())).size !== args.p_vehicle_ids.length) throw new AssayError('invalid_reader_scope');
        return request(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
      }
      if (name === 'vehicle_price_facts' && (!Array.isArray(args?.p_vehicle_ids) || args.p_vehicle_ids.length < 1 ||
        args.p_vehicle_ids.length > 1000 || !args.p_vehicle_ids.every(id => UUID.test(id)))) throw new AssayError('invalid_reader_scope');
      if (name !== 'vehicle_price_facts' && (!UUID.test(args?.p_vehicle_id ?? '') ||
        name === 'get_field_provenance' && !SPEC_FIELDS.has(args?.p_field) && !Object.hasOwn(TYPED_PROPERTIES, args?.p_field))) throw new AssayError('invalid_reader_scope');
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

export function typedLineageSubjects(input) {
  const subjects = lineageSubjects(input);
  if (!Array.isArray(input.properties) || input.properties.length < 1 || input.properties.length > 12 ||
    !input.properties.every(p => object(p) && Object.keys(p).length === 2 && Object.hasOwn(TYPED_PROPERTIES, p.key) && UUID.test(p.id ?? '')) ||
    new Set(input.properties.map(p => p.key)).size !== input.properties.length ||
    new Set(input.properties.map(p => p.id.toLowerCase())).size !== input.properties.length) throw new AssayError('invalid_typed_lineage_properties');
  return { ...subjects, properties: input.properties.map(p => ({ key: p.key, id: p.id.toLowerCase() })).sort((a, b) => a.key.localeCompare(b.key)) };
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

export function inspectTypedSpecifications(ids, properties, value) {
  const result = { safe: true, failures: {}, gaps: {}, parents: [] }, seen = new Set();
  const fail = key => { result.failures[key] = (result.failures[key] ?? 0) + 1; result.safe = false; };
  if (!Array.isArray(value) || value.length > ids.length) { fail('typed_specification_shape_invalid'); return result; }
  for (const row of value) {
    if (!object(row) || !ids.includes(row.vehicle_id) || seen.has(row.vehicle_id) ||
      row.schema_version !== 'vehicle_data_model_v1' || row.grain !== 'stored_vehicle_record' ||
      row.physical_identity_status !== 'unresolved' || row.typed_claims_status !== 'current_core_scope_read' ||
      instant(row.read_at) === null ||
      !object(row.model_scope) || row.model_scope.complete_vehicle_model !== false ||
      row.model_scope.retained_metadata_is_typed_testimony !== false ||
      row.model_scope.retained_record_fields !== 13 || row.model_scope.record_binding_property_keys !== 11 ||
      ![11, 12].includes(row.model_scope.canonical_property_keys) || row.model_scope.source_event_history !== 'not_reconstructed' ||
      !Array.isArray(row.typed_claims) || row.typed_claims.length > 32) { fail('typed_specification_scope_or_shape_invalid'); continue; }
    seen.add(row.vehicle_id);
    const keys = new Set(), propertyIds = new Set(), claims = [], unavailable = [];
    for (const c of row.typed_claims) {
      if (!object(c) || !Object.hasOwn(TYPED_PROPERTIES, c.property_key) || !UUID.test(c.property_id ?? '') ||
        (c.property_key === 'engine_family_label' && row.model_scope.canonical_property_keys !== 12) ||
        keys.has(c.property_key) || propertyIds.has(c.property_id.toLowerCase())) { fail('typed_property_identity_invalid_or_duplicate'); continue; }
      keys.add(c.property_key); propertyIds.add(c.property_id.toLowerCase());
      const expected = properties.find(p => p.key === c.property_key);
      if (!expected) continue;
      const [dataType, unit] = TYPED_PROPERTIES[c.property_key];
      if (c.property_id.toLowerCase() !== expected.id || c.data_type !== dataType || c.unit !== unit ||
        c.status !== 'current_canonical_claim' || !UUID.test(c.observation_id ?? '') ||
        c.kind !== (c.property_key === 'mileage_miles' ? 'condition' : 'specification') ||
        !(c.source_url === null || typeof c.source_url === 'string') ||
        !(c.extraction_method === null || typeof c.extraction_method === 'string') ||
        !(c.source_id === null || UUID.test(c.source_id ?? '')) ||
        !(c.source_observation_id === null || UUID.test(c.source_observation_id ?? '')) ||
        !object(c.qualifiers) ||
        (dataType === 'integer' ? !Number.isSafeInteger(c.value) : dataType === 'numeric' ? typeof c.value !== 'number' || !Number.isFinite(c.value)
          : typeof c.value !== 'string' || !c.value.trim())) { fail('typed_claim_contract_invalid'); continue; }
      claims.push(c);
    }
    for (const p of properties) if (!keys.has(p.key)) unavailable.push(p.key);
    result.parents.push({ id: row.vehicle_id, readAt: row.read_at, claims, unavailable });
  }
  result.withheldParents = ids.length - seen.size;
  if (result.withheldParents) result.gaps.typed_parent_unavailable_after_gate = result.withheldParents;
  return result;
}

const TYPED_QUALIFIERS = ['claim_role', 'source_profile', 'observed_at_basis', 'source_event_time_status',
  'source_recorded_at', 'source_observed_at', 'source_value', 'normalization_version', 'source_subject_label', 'source_make_label',
  'model_label_scope', 'identity_resolution_status', 'factory_configuration_status', 'current_configuration_status',
  'independent_source', 'reported_precision_miles', 'value_is_approximate', 'reading_role', 'true_mileage_status', 'limitation',
  'label_role', 'engine_identity_status', 'source_capture_sha256', 'source_captured_at', 'source_capture_basis', 'source_witness_version'];
const TYPED_REQUIRED_QUALIFIERS = ['source_value', 'claim_role', 'observed_at_basis', 'source_event_time_status',
  'source_recorded_at', 'source_observed_at', 'normalization_version', 'independent_source',
  'factory_configuration_status', 'current_configuration_status'];
const FAMILY_QUALIFIERS = { claim_role: 'listing_claim', label_role: 'publisher_powering_engine_label', engine_identity_status: 'unverified',
  observed_at_basis: 'source_testimony_recorded_at', source_event_time_status: 'unknown', factory_configuration_status: 'unknown',
  current_configuration_status: 'unknown', independent_source: false, normalization_version: 'retained_engine_family_label_v1',
  source_witness_version: 'retained_description_engine_family_label_v1' };

export function inspectTypedProvenance(id, claim, readAt, value) {
  const result = { failures: {}, gaps: {}, selectedObservationFound: false, projectionMatches: false,
    originalSourceValidation: 'unmeasured', registryRatificationValidation: 'unmeasured' };
  const fail = key => { result.failures[key] = 1; }, gap = key => { result.gaps[key] = 1; };
  if (!object(value) || value.vehicle_id !== id || value.field !== claim.property_key || !Array.isArray(value.observations)) {
    fail('typed_provenance_shape_or_subject_invalid'); return result;
  }
  const matching = value.observations.filter(o => object(o) && o.id === claim.observation_id);
  if (matching.length !== 1) {
    if (matching.length) fail('typed_observation_duplicated_in_drill');
    else gap('typed_observation_unavailable_in_current_drill');
    return result;
  }
  result.selectedObservationFound = true;
  const source = matching[0], q = claim.qualifiers;
  const numeric = ['integer', 'numeric'].includes(claim.data_type);
  const valueMatches = numeric ? typeof source.value === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(source.value) &&
    Number.isFinite(Number(source.value)) && Number(source.value) === claim.value : source.value === claim.value;
  if (!valueMatches) fail('typed_observation_value_mismatch');
  for (const [left, right] of [['source_observation_id', 'source_observation_id'], ['source_url', 'source_url'],
    ['kind', 'kind'], ['extraction_method', 'extraction_method'], ['confidence_score', 'confidence']]) {
    if (!present(claim[left]) || !present(source[right])) gap(`typed_${left}_unmeasured`);
    else if (!isDeepStrictEqual(claim[left], source[right])) fail(`typed_${left}_mismatch`);
  }
  if (present(claim.confidence_score) && (typeof claim.confidence_score !== 'number' || !Number.isFinite(claim.confidence_score) ||
    claim.confidence_score < 0 || claim.confidence_score > 1)) fail('typed_confidence_invalid');
  for (const key of ['property_id', 'source_id']) if (present(source[key]) && source[key] !== claim[key]) fail(`typed_${key}_mismatch`);
  const cutoff = instant(readAt);
  for (const key of ['observed_at', 'ingested_at']) {
    if (instant(claim[key]) === null || instant(source[key]) === null || cutoff === null) gap(`typed_${key}_unmeasured`);
    else {
      if (!sameClock(claim[key], source[key])) fail(`typed_${key}_mismatch`);
      if (instant(claim[key]) > cutoff) fail('typed_observation_after_reader_clock');
    }
  }
  for (const key of TYPED_QUALIFIERS) {
    const left = present(q[key]), right = present(source[key]);
    if (!left && !right) { if (TYPED_REQUIRED_QUALIFIERS.includes(key)) gap(`typed_qualifier_${key}_unmeasured`); continue; }
    if (!left || !right) { gap(`typed_qualifier_${key}_unprojected`); continue; }
    if (['source_recorded_at', 'source_observed_at', 'source_captured_at'].includes(key)) {
      if (instant(q[key]) === null || instant(source[key]) === null) gap(`typed_qualifier_${key}_unmeasured`);
      else if (!sameClock(q[key], source[key])) fail(`typed_qualifier_${key}_mismatch`);
    } else if (!isDeepStrictEqual(q[key], source[key])) fail(`typed_qualifier_${key}_mismatch`);
  }
  if (Object.keys(q).some(key => !TYPED_QUALIFIERS.includes(key))) gap('typed_qualifier_outside_assayed_scope');
  for (const key of ['independent_source', 'value_is_approximate']) if (present(q[key]) && typeof q[key] !== 'boolean') fail(`typed_qualifier_${key}_invalid`);
  if (q.observed_at_basis === 'source_testimony_recorded_at' && instant(q.source_recorded_at) !== null &&
    instant(claim.observed_at) !== null && !sameClock(q.source_recorded_at, claim.observed_at)) fail('typed_source_recording_basis_mismatch');
  if (claim.property_key === 'engine_family_label') {
    for (const [key, expected] of Object.entries(FAMILY_QUALIFIERS)) {
      if (!present(q[key])) gap(`typed_family_${key}_unmeasured`);
      else if (q[key] !== expected) fail(`typed_family_${key}_invalid`);
    }
    if (!/^[a-f0-9]{64}$/.test(q.source_capture_sha256 ?? '') || instant(q.source_captured_at) === null ||
      !present(q.source_capture_basis)) gap('typed_family_capture_witness_unmeasured');
  }
  result.projectionMatches = Object.keys(result.failures).length === 0 && Object.keys(result.gaps).length === 0;
  // Other rows carrying the same listing assertion (page, value and quotation) are
  // repeated captures shown as separate reports, not corroboration. The selected
  // projection can still match; the public answer overstates its support.
  result.repeatedListingAssertions = value.observations.filter(o => object(o) && o.id !== source.id &&
    present(source.source_url) && o.source_url === source.source_url && o.value === source.value &&
    isDeepStrictEqual(o.source_value ?? null, source.source_value ?? null)).length;
  if (result.repeatedListingAssertions) gap('typed_provenance_repeated_listing_assertion');
  // The drill omits these FKs; matching projected custody is not independent
  // registry/source validation, extraction accuracy, or physical truth.
  if (!present(source.property_id) || !present(source.source_id)) gap('typed_provenance_property_and_source_fk_unprojected');
  gap('typed_original_source_and_semantic_quality_unmeasured');
  return result;
}

export function inspectCommentHeaders(id, value, limit = 1000) {
  const result = { safe: true, complete: true, failures: {}, gaps: {}, headers: [], auctionIds: [], identityIds: [] };
  const ids = new Set(), nullableId = x => x === null || typeof x === 'string' && UUID.test(x);
  if (!Number.isInteger(limit) || limit < 1000 || limit > 10000 || !Array.isArray(value) || value.length > limit + 1) result.safe = false;
  else for (const c of value) {
    if (!object(c) || !UUID.test(c.id ?? '') || ids.has(c.id) || c.vehicle_id !== id ||
      !['auction_event_id', 'external_identity_id', 'author_external_identity_id'].every(key => nullableId(c[key])) ||
      typeof c.posted_at !== 'string' || c.comment_type === 'bid' ||
      !(c.comment_type === null || typeof c.comment_type === 'string') ||
      !(c.platform === null || typeof c.platform === 'string') ||
      !(c.is_seller === null || typeof c.is_seller === 'boolean')) { result.safe = false; break; }
    ids.add(c.id);
  }
  if (!result.safe) { result.failures.comment_header_scope_or_shape_invalid = 1; result.complete = false; return result; }
  if (value.length > limit) { result.complete = false; result.gaps.comment_header_cap_unmeasured = 1; return result; }
  result.headers = value;
  result.auctionIds = [...new Set(value.map(c => c.auction_event_id).filter(Boolean))];
  result.identityIds = [...new Set(value.flatMap(c => [c.external_identity_id, c.author_external_identity_id]).filter(Boolean))];
  return result;
}

function commentClock(value) {
  if (/^infinity$/i.test(value)) return { extreme: 1 };
  if (/^-infinity$/i.test(value)) return { extreme: -1 };
  const micros = instant(value);
  return micros === null ? null : { extreme: 0, micros };
}

function commentFollows(previous, current) {
  const a = commentClock(previous.posted_at), b = commentClock(current.posted_at);
  if (!a || !b) return false;
  if (a.extreme !== b.extreme) return a.extreme > b.extreme;
  if (a.extreme === 0 && a.micros !== b.micros) return a.micros > b.micros;
  return previous.id.toLowerCase() > current.id.toLowerCase();
}

async function commentCollection(client, id, until, now, emit, limit, measurements = false) {
  const rows = [], ids = new Set(), hashes = []; let previous;
  for (let page = 0; page < 100; page++) {
    if (now() >= until) return { ok: true, complete: false, gaps: { comment_collection_time_unmeasured: 1 }, stopReason: 'time_budget_reached' };
    const response = await client.commentHeaders(id, previous && { id: previous.id, postedAt: previous.posted_at }, measurements);
    if (!response.ok) return response;
    const checked = inspectCommentHeaders(id, response.value);
    if (!checked.safe || response.value.length > 200) return { ok: true, safe: false, failures: { comment_header_scope_or_shape_invalid: 1 } };
    for (const c of checked.headers) {
      if (!commentClock(c.posted_at)) return { ok: true, complete: false, gaps: { comment_clock_cursor_unmeasured: 1 } };
      if (ids.has(c.id) || previous && !commentFollows(previous, c)) return { ok: true, safe: false, failures: { comment_header_order_or_repeated_id: 1 } };
      ids.add(c.id); rows.push(c); previous = c;
    }
    hashes.push(hash(response.value));
    await emit({ type: 'comment_source_page', vehicleId: id, returned: response.value.length, responseSha256: hashes.at(-1), durationMs: response.durationMs });
    if (rows.length > limit) return { ok: true, safe: true, complete: false, atLeast: rows.length, gaps: { comment_header_cap_unmeasured: 1 }, responseSha256: hash(hashes) };
    // Even a short server-capped page is not proof of exhaustion. The exact
    // PostgreSQL microsecond clock and UUID seek continue until an empty page.
    if (!response.value.length) return { ok: true, safe: true, complete: true, value: rows, responseSha256: hash(hashes) };
  }
  return { ok: true, complete: false, gaps: { comment_collection_page_budget_unmeasured: 1 } };
}

function validContexts(value, ids, parent) {
  return Array.isArray(value) && value.length <= ids.length && new Set(value.map(x => x?.id)).size === value.length &&
    value.every(x => object(x) && ids.includes(x.id) &&
      (parent === undefined ? x.platform === null || typeof x.platform === 'string' : x.vehicle_id === parent && (x.source === null || typeof x.source === 'string')));
}

export function inspectCommentLineage(headers, auctions, identities) {
  const events = new Map(auctions.map(x => [x.id, x])), actors = new Map(identities.map(x => [x.id, x]));
  const result = { commentHeaders: headers.length, matchedAuctionParents: 0, matchingRecordedNamespaces: 0,
    identityStates: { absent: 0, legacyOnly: 0, canonicalOnly: 0, agreeing: 0, conflicting: 0 }, gaps: {}, samples: {} };
  const gap = (key, c) => { result.gaps[key] = (result.gaps[key] ?? 0) + 1;
    result.samples[key] ??= []; if (result.samples[key].length < 10 && !result.samples[key].includes(c.id)) result.samples[key].push(c.id); };
  for (const c of headers) {
    const a = c.external_identity_id, b = c.author_external_identity_id;
    const state = !a && !b ? 'absent' : a && !b ? 'legacyOnly' : !a && b ? 'canonicalOnly' : a === b ? 'agreeing' : 'conflicting';
    result.identityStates[state]++;
    if (state === 'legacyOnly') gap('indexed_author_key_absent_with_legacy_identity', c);
    if (state === 'absent') gap('comment_author_identity_unestablished', c);
    if (state === 'conflicting') gap('retained_author_identity_keys_differ', c);
    if (!Number.isFinite(Date.parse(c.posted_at))) gap('source_post_clock_not_interpretable', c);
    const event = events.get(c.auction_event_id);
    if (event) {
      result.matchedAuctionParents++;
      if (!present(c.platform) || !present(event.source)) gap('auction_source_namespace_unestablished', c);
      else if (c.platform !== event.source) gap('recorded_auction_source_label_differs_unassayed_alias', c);
    } else gap('source_auction_parent_unavailable_or_unlinked', c);
    // Both retained keys are inspected. A conflict has no automatically chosen
    // winner. Exact namespace agreement is not person identity or source truth.
    let matching = false;
    for (const key of new Set([a, b].filter(Boolean))) {
      const identity = actors.get(key);
      if (!identity) gap('reported_identity_context_unavailable', c);
      else if (!present(identity.platform) || !present(c.platform)) gap('identity_source_namespace_unestablished', c);
      else if (identity.platform === c.platform) matching = true;
      else gap('recorded_identity_namespace_differs_unassayed_alias', c);
    }
    if (matching) result.matchingRecordedNamespaces++;
  }
  return result;
}

const nullableUuid = x => x === null || typeof x === 'string' && UUID.test(x);
const nullableString = x => x === null || typeof x === 'string';
const sameClock = (a, b) => a === b || instant(a) !== null && instant(b) !== null && instant(a) === instant(b);

export function inspectBidHeaders(id, value) {
  const seen = new Set();
  return Array.isArray(value) && value.length <= 200 && value.every(x => {
    if (!object(x) || !UUID.test(x.comment_id ?? '') || seen.has(x.comment_id) || x.vehicle_id !== id ||
      !['auction', 'observation'].includes(x.source_category) ||
      !['external_identity_id', 'auction_event_id'].every(key => nullableUuid(x[key])) ||
      !['observed_at', 'comment_type', 'platform'].every(key => nullableString(x[key])) ||
      typeof x.source_slug !== 'string') return false;
    seen.add(x.comment_id); return true;
  });
}

function validBidOrigins(rows, ids, parent, observation = false) {
  return Array.isArray(rows) && rows.length <= ids.length && new Set(rows.map(x => x?.id)).size === rows.length &&
    rows.every(x => object(x) && ids.includes(x.id) && x.vehicle_id === parent && (observation
      ? nullableString(x.observed_at) && ['comment', 'bid'].includes(x.kind) && nullableUuid(x.source_comment_id) &&
        (x.confidence_score === null || number(x.confidence_score) !== null) &&
        (x.is_superseded === null || typeof x.is_superseded === 'boolean') && nullableString(x.extraction_method)
      : ['posted_at', 'comment_type', 'platform'].every(key => nullableString(x[key])) &&
        ['auction_event_id', 'external_identity_id', 'author_external_identity_id'].every(key => nullableUuid(x[key]))));
}

export function inspectBidLineage(headers, origins, observations, sourceComments, auctions, identities) {
  const native = new Map(origins.map(x => [x.id, x])), derived = new Map(observations.map(x => [x.id, x]));
  const sources = new Map(sourceComments.map(x => [x.id, x]));
  const result = { bidHeaders: headers.length, nativeHeaders: 0, observationHeaders: 0,
    nativeOriginsFound: 0, matchingNativeProjections: 0, finiteNativePostClocks: 0,
    observationOriginsFound: 0, matchingObservationClocks: 0, linkedObservationSourceComments: 0,
    failures: {}, gaps: {}, samples: {} };
  const add = (group, key, id) => { group[key] = (group[key] ?? 0) + 1; result.samples[key] ??= [];
    if (result.samples[key].length < 10 && !result.samples[key].includes(id)) result.samples[key].push(id); };
  for (const h of headers) {
    const id = h.comment_id;
    if (h.source_category === 'auction') {
      result.nativeHeaders++;
      const source = native.get(id);
      if (!source) { add(result.gaps, 'native_bid_source_unavailable_in_current_read', id); continue; }
      result.nativeOriginsFound++;
      let matching = true;
      for (const key of ['comment_type', 'platform', 'external_identity_id', 'auction_event_id']) if (h[key] !== source[key]) {
        matching = false; add(result.failures, `native_bid_projection_${key}_mismatch`, id);
      }
      if (!sameClock(h.observed_at, source.posted_at)) { matching = false; add(result.failures, 'native_bid_post_clock_projection_mismatch', id); }
      if (matching) result.matchingNativeProjections++;
      if (instant(source.posted_at) !== null) result.finiteNativePostClocks++;
      else add(result.gaps, 'native_bid_post_clock_unmeasured', id);
      if (source.comment_type !== 'bid') add(result.gaps, 'positive_bid_number_without_bid_type_label', id);
      if (source.platform === null && h.source_slug === 'bat') add(result.gaps, 'source_slug_defaults_bat_without_retained_platform', id);
    } else {
      result.observationHeaders++;
      add(result.gaps, 'observation_bid_source_role_and_episode_unqualified', id);
      const source = derived.get(id);
      if (!source) { add(result.gaps, 'bid_observation_source_unavailable_in_current_read', id); continue; }
      result.observationOriginsFound++;
      if (sameClock(h.observed_at, source.observed_at)) result.matchingObservationClocks++;
      else add(result.failures, 'bid_observation_clock_projection_mismatch', id);
      if (source.is_superseded === true) add(result.gaps, 'superseded_observation_exposed_as_positive_bid', id);
      if (source.source_comment_id && sources.has(source.source_comment_id)) result.linkedObservationSourceComments++;
      else add(result.gaps, 'observation_bid_native_comment_parent_link_unavailable', id);
    }
  }
  // Native source rows keep both author keys. The public view currently projects
  // only the legacy key; matching that projection is not canonical person proof.
  const lineage = inspectCommentLineage(origins, auctions, identities);
  result.nativeAuthorStates = lineage.identityStates;
  result.matchingAuctionParents = lineage.matchedAuctionParents;
  result.matchingRecordedIdentityNamespaces = lineage.matchingRecordedNamespaces;
  for (const [key, count] of Object.entries(lineage.gaps)) result.gaps[key] = (result.gaps[key] ?? 0) + count;
  Object.assign(result.samples, lineage.samples);
  return result;
}

async function bidCollection(client, id, o, now, emit) {
  const rows = [], hashes = [], seen = new Set(); let after;
  for (let page = 0; page < 100; page++) {
    if (now() >= o.until) return { ok: true, complete: false, gaps: { bid_collection_time_unmeasured: 1 }, stopReason: 'time_budget_reached' };
    const r = await client.bidHeaders(id, after);
    if (!r.ok) return r;
    if (!inspectBidHeaders(id, r.value)) return { ok: true, safe: false, failures: { bid_header_scope_or_shape_invalid: 1 } };
    for (const h of r.value) {
      if (seen.has(h.comment_id) || after && h.comment_id <= after) return { ok: true, safe: false, failures: { bid_header_order_or_repeated_id: 1 } };
      seen.add(h.comment_id); rows.push(h); after = h.comment_id;
    }
    hashes.push(hash(r.value));
    await emit({ type: 'bid_source_page', vehicleId: id, returned: r.value.length, responseSha256: hashes.at(-1), durationMs: r.durationMs });
    if (rows.length > (o.bidLimit ?? 1000)) return { ok: true, complete: false, atLeast: rows.length, gaps: { bid_collection_cap_unmeasured: 1 } };
    if (!r.value.length) return { ok: true, complete: true, value: rows, responseSha256: hash(hashes) };
  }
  return { ok: true, complete: false, gaps: { bid_collection_page_budget_unmeasured: 1 } };
}

export async function runBidLineage(client, o, subjects, { now = Date.now, emit = async () => {}, progress = () => {} } = {}) {
  const counters = ['bidHeaders', 'nativeHeaders', 'observationHeaders', 'nativeOriginsFound', 'matchingNativeProjections',
    'finiteNativePostClocks', 'observationOriginsFound', 'matchingObservationClocks', 'linkedObservationSourceComments',
    'matchingAuctionParents', 'matchingRecordedIdentityNamespaces'];
  const summary = { stage: 'read_only_public_positive_bid_header_lineage_assay', startedAt: new Date(now()).toISOString(),
    requestedParents: subjects.ids.length, manifestSha256: subjects.sha256, population: subjects.population,
    gatedParents: 0, eligibleParents: 0, absentOrIneligibleParents: 0, inspectedParents: 0, completedParents: 0,
    measured: Object.fromEntries(counters.map(key => [key, 0])),
    nativeAuthorStates: { absent: 0, legacyOnly: 0, canonicalOnly: 0, agreeing: 0, conflicting: 0 },
    failures: {}, gaps: {}, bidLimit: o.bidLimit ?? 1000, databaseWrites: 0, recordRepairs: 0, modelCalls: 0,
    boundary: 'Explicit current public-parent manifest, existing vehicle_comments_unified rows filtered by recorded bid_amount>0. This reader is not all retained bid history: native presence suppresses the observation branch for a vehicle. UUID pages seek to empty, bounded by the recorded bidLimit, 100 pages and deadline. Completed-collection counters only; separate current reads are not an immutable snapshot. Native posting clocks remain separate from observation clocks. Source/author/auction metadata only: no amounts, quotes, usernames, handles, currency attestation, independent bidders, historical velocity, cohort/condition matching or outcome prediction. Matching projections do not prove an observation is a native bid or an identity is the same person.' };
  const merge = value => { for (const group of ['gaps', 'failures']) for (const [key, count] of Object.entries(value[group] ?? {})) summary[group][key] = (summary[group][key] ?? 0) + count; };
  const readerFailures = {};
  const fail = reader => { readerFailures[reader] = (readerFailures[reader] ?? 0) + 1;
    if (readerFailures[reader] >= 2) summary.stopReason = 'repeated_bid_reader_failure_inspect_cause'; };
  async function context(reader, ids, vehicleId, fetcher, validate) {
    const found = [];
    for (let i = 0; i < ids.length; i += 200) {
      if (now() >= o.until) { summary.stopReason = 'time_budget_reached'; return null; }
      const wanted = ids.slice(i, i + 200), r = await fetcher(wanted);
      if (!r.ok) {
        fail(reader); merge({ failures: { bid_context_reader_failed: 1 } });
        await emit({ type: 'bid_reader_failure', reader, vehicleId, status: r.status, code: r.code, durationMs: r.durationMs });
        return null;
      }
      if (!validate(r.value, wanted)) { merge({ failures: { bid_context_scope_or_shape_invalid: 1 } }); summary.stopReason = 'unsafe_bid_context'; return null; }
      found.push(...r.value);
      await emit({ type: 'bid_context', reader, vehicleId, requested: wanted.length, returned: r.value.length, responseSha256: hash(r.value), durationMs: r.durationMs });
    }
    return found;
  }
  outer: for (let offset = 0, pages = 0; offset < subjects.ids.length; offset += 200, pages++) {
    if (now() >= o.until || pages >= o.maxPages) { summary.stopReason = now() >= o.until ? 'time_budget_reached' : 'page_budget_reached'; break; }
    const ids = subjects.ids.slice(offset, offset + 200), gate = await client.subjects(ids);
    if (!gate.ok || !Array.isArray(gate.value)) { merge({ failures: { bid_parent_reader_failed: 1 } }); summary.stopReason = 'bid_parent_reader_failed'; break; }
    const eligible = new Set();
    for (const p of gate.value) {
      if (!object(p) || !ids.includes(p.id) || eligible.has(p.id) || p.is_public !== true || p.deleted_at !== null || p.listing_kind === 'non_vehicle_item') {
        merge({ failures: { bid_parent_gate_invalid: 1 } }); summary.stopReason = 'bid_parent_gate_invalid'; break outer;
      }
      eligible.add(p.id);
    }
    summary.gatedParents += ids.length; summary.eligibleParents += eligible.size; summary.absentOrIneligibleParents += ids.length - eligible.size;
    await emit({ type: 'bid_gate', requested: ids.length, eligible: eligible.size, absentOrIneligible: ids.length - eligible.size, responseSha256: hash(gate.value), durationMs: gate.durationMs });
    for (const id of ids.filter(id => eligible.has(id))) {
      if (now() >= o.until) { summary.stopReason = 'time_budget_reached'; break outer; }
      const collected = await bidCollection(client, id, o, now, emit); summary.inspectedParents++;
      if (!collected.ok) {
        fail('vehicle_comments_unified'); merge({ failures: { bid_header_reader_failed: 1 }, gaps: { bid_header_parent_unmeasured: 1 } });
        await emit({ type: 'bid_reader_failure', reader: 'vehicle_comments_unified', vehicleId: id, status: collected.status, code: collected.code, durationMs: collected.durationMs });
      } else {
        merge(collected);
        if (collected.safe === false) { summary.stopReason = 'unsafe_bid_headers'; break outer; }
        if (!collected.complete) {
          await emit({ type: 'bid_parent_unmeasured', vehicleId: id, atLeast: collected.atLeast, gaps: collected.gaps });
          if (collected.stopReason) summary.stopReason = collected.stopReason;
        } else {
          const headers = collected.value, nativeIds = headers.filter(x => x.source_category === 'auction').map(x => x.comment_id);
          const observationIds = headers.filter(x => x.source_category === 'observation').map(x => x.comment_id);
          const native = await context('auction_comments', nativeIds, id, ids => client.bidOrigins(id, ids), (rows, ids) => validBidOrigins(rows, ids, id));
          const obs = native && await context('vehicle_observations', observationIds, id, ids => client.bidObservationOrigins(id, ids), (rows, ids) => validBidOrigins(rows, ids, id, true));
          const quoteIds = obs && [...new Set(obs.map(x => x.source_comment_id).filter(Boolean))];
          const source = quoteIds && await context('auction_comments', quoteIds, id, ids => client.bidOrigins(id, ids), (rows, ids) => validBidOrigins(rows, ids, id));
          const auctionIds = native && [...new Set(native.map(x => x.auction_event_id).filter(Boolean))];
          const identityIds = native && [...new Set(native.flatMap(x => [x.external_identity_id, x.author_external_identity_id]).filter(Boolean))];
          const auctions = source && await context('auction_events', auctionIds, id, ids => client.sourceAuctions(id, ids), (rows, ids) => validContexts(rows, ids, id));
          const identities = auctions && await context('external_identities', identityIds, id, ids => client.sourceIdentities(ids), (rows, ids) => validContexts(rows, ids));
          if (!identities) merge({ gaps: { bid_context_parent_unmeasured: 1 } });
          else {
            const measured = inspectBidLineage(headers, native, obs, source, auctions, identities); merge(measured);
            summary.completedParents++;
            for (const key of counters) summary.measured[key] += measured[key];
            for (const [key, count] of Object.entries(measured.nativeAuthorStates)) summary.nativeAuthorStates[key] += count;
            await emit({ type: 'bid_parent', vehicleId: id, measuredAt: new Date(now()).toISOString(), responseSha256: collected.responseSha256, ...measured });
          }
        }
      }
      if (summary.stopReason) break outer;
      if (summary.inspectedParents % 25 === 0) progress({ inspectedParents: summary.inspectedParents, measured: summary.measured, failures: summary.failures });
    }
  }
  summary.stopReason ??= 'manifest_exhausted'; summary.finishedAt = new Date(now()).toISOString(); summary.networkRequests = client.requests;
  summary.status = Object.keys(summary.failures).length ? 'failed' : summary.stopReason === 'manifest_exhausted' && summary.completedParents > 0 && summary.completedParents === summary.eligibleParents ? 'passed_current_bid_reader_lineage_in_manifest' : 'incomplete';
  summary.exitCode = summary.status === 'failed' ? 1 : summary.status === 'incomplete' ? 2 : 0;
  await emit({ type: 'summary', ...summary }); return summary;
}

/** Coverage and provenance of stored measurements; no score means or quality verdicts. */
export function inspectCommentMeasurements(headers) {
  const result = { headers: headers.length, axes: {}, failures: {}, gaps: {},
    boundary: 'Stored per-comment metadata only. NULL is unscored; missing columns are unavailable. Zero is a score. Stance/condition rubric and model strata remain separate; sentiment has no method/version in this projection. Retain at most 64 rubric/model strata per axis; overflow headers are explicitly unretained. Posting and analysis clocks are distinct. No mood, verified condition, source independence, historical cohort or price-effect claim.' };
  const add = (group, key) => { group[key] = (group[key] ?? 0) + 1; };
  for (const [axis, field, low, high] of [
    ['sentiment', 'sentiment_score', -100, 100],
    ['stance', 'community_stance_score', -1, 1],
    ['condition', 'condition_polarity', -1, 1],
  ]) {
    const counts = result.axes[axis] = { unavailable: 0, unscored: 0, validStoredScore: 0, zeroStoredScore: 0, invalidStoredScore: 0,
      sourceClockMissing: 0, analysisClockMissing: 0, methodUnestablished: 0, rubricUnestablished: 0,
      versionedMetadata: 0, strataUnretained: 0, strata: {} };
    for (const row of headers) {
      if (!Object.hasOwn(row, field) || row[field] === undefined) { counts.unavailable++; add(result.gaps, `${axis}_measurement_column_unavailable`); continue; }
      if (row[field] === null) { counts.unscored++; continue; }
      const score = number(row[field]);
      if (score === null || score < low || score > high) { counts.invalidStoredScore++; add(result.failures, `${axis}_stored_score_outside_reader_scale`); continue; }
      counts.validStoredScore++;
      if (score === 0) counts.zeroStoredScore++;
      if (instant(row.posted_at) === null) { counts.sourceClockMissing++; add(result.gaps, `${axis}_source_post_clock_unmeasured`); }
      const clock = axis === 'sentiment' ? row.analyzed_at : row.stance_scored_at;
      if (instant(clock) === null) { counts.analysisClockMissing++; add(result.gaps, `${axis}_analysis_clock_unmeasured`); }
      // The shared rubric/model fields describe stance and condition, not sentiment.
      const model = axis !== 'sentiment' && typeof row.stance_model === 'string' && row.stance_model.trim() ? row.stance_model : null;
      const rubric = axis !== 'sentiment' && Number.isInteger(row.rubric_version) && row.rubric_version > 0 && row.rubric_version <= 32767 ? row.rubric_version : null;
      if (!model) { counts.methodUnestablished++; add(result.gaps, `${axis}_model_unestablished`); }
      if (!rubric) { counts.rubricUnestablished++; add(result.gaps, `${axis}_rubric_unestablished`); }
      if (model && rubric && instant(clock) !== null) counts.versionedMetadata++;
      const key = `${rubric ?? 'unknown'}:${model ? hash(model) : 'unknown'}`;
      if (!Object.hasOwn(counts.strata, key) && Object.keys(counts.strata).length >= 64) {
        counts.strataUnretained++; add(result.gaps, `${axis}_measurement_strata_budget_unmeasured`);
      } else counts.strata[key] = (counts.strata[key] ?? 0) + 1;
    }
  }
  return result;
}

function mergeCommentMeasurements(target, part) {
  target.headers += part.headers;
  for (const group of ['failures', 'gaps']) for (const [key, count] of Object.entries(part[group])) target[group][key] = (target[group][key] ?? 0) + count;
  for (const axis of ['sentiment', 'stance', 'condition']) {
    const to = target.axes[axis], from = part.axes[axis];
    for (const key of Object.keys(to).filter(key => key !== 'strata')) to[key] += from[key];
    for (const [key, count] of Object.entries(from.strata)) {
      if (!Object.hasOwn(to.strata, key) && Object.keys(to.strata).length >= 64) {
        to.strataUnretained += count;
        const gap = `${axis}_measurement_strata_budget_unmeasured`;
        target.gaps[gap] = (target.gaps[gap] ?? 0) + count;
      }
      else to.strata[key] = (to.strata[key] ?? 0) + count;
    }
  }
}

export async function runCommentLineage(client, o, subjects, { now = Date.now, emit = async () => {}, progress = () => {} } = {}) {
  const commentLimit = o.commentLimit ?? 1000;
  const summary = { stage: 'read_only_public_comment_header_lineage_assay', startedAt: new Date(now()).toISOString(),
    requestedParents: subjects.ids.length, manifestSha256: subjects.sha256, population: subjects.population,
    gatedParents: 0, eligibleParents: 0, absentOrIneligibleParents: 0, inspectedParents: 0, completedParents: 0,
    measuredCommentHeaders: 0, matchedAuctionParents: 0, matchingRecordedNamespaces: 0,
    identityStates: { absent: 0, legacyOnly: 0, canonicalOnly: 0, agreeing: 0, conflicting: 0 },
    failures: {}, gaps: {}, commentLimit, databaseWrites: 0, modelCalls: 0, recordRepairs: 0,
    boundary: `Explicit manifest, current anonymous public-parent gate. 200-row microsecond/UUID keyset pages continue until empty, at most 100 pages/${commentLimit} posted non-bid headers per parent; overflow refuses that collection. This is a resource ceiling, not a record target or evidence of exhaustion. Separate current reads are not an immutable snapshot. Header and identity counters cover completed collections only. Metadata only, not quotes, inferred atoms, mood, expertise, independent sources, source publication or historical identity replay. Namespace label differences preserve unresolved aliases. Missing child context is unknown, never zero activity.` };
  if (o.commentMeasurements) summary.commentMeasurements = inspectCommentMeasurements([]);
  let consecutiveFailures = 0;
  const readerFailures = {};
  const failed = reader => {
    readerFailures[reader] = (readerFailures[reader] ?? 0) + 1;
    if (readerFailures[reader] >= 2) summary.stopReason = 'repeated_comment_reader_failure_inspect_cause';
  };
  const merge = part => { for (const group of ['failures', 'gaps']) for (const [key, count] of Object.entries(part[group] ?? {})) summary[group][key] = (summary[group][key] ?? 0) + count; };
  outer: for (let offset = 0, pages = 0; offset < subjects.ids.length; offset += 200, pages++) {
    if (now() >= o.until || pages >= o.maxPages) { summary.stopReason = now() >= o.until ? 'time_budget_reached' : 'page_budget_reached'; break; }
    const batch = subjects.ids.slice(offset, offset + 200), gate = await client.subjects(batch);
    if (!gate.ok || !Array.isArray(gate.value)) { merge({ failures: { comment_parent_reader_failed: 1 } }); summary.stopReason = 'comment_parent_reader_failed'; break; }
    const eligible = new Set();
    for (const p of gate.value) {
      if (!object(p) || !batch.includes(p.id) || eligible.has(p.id) || p.is_public !== true || p.deleted_at !== null || p.listing_kind === 'non_vehicle_item') {
        merge({ failures: { comment_parent_gate_invalid: 1 } }); summary.stopReason = 'comment_parent_gate_invalid'; break outer;
      }
      eligible.add(p.id);
    }
    summary.gatedParents += batch.length; summary.eligibleParents += eligible.size; summary.absentOrIneligibleParents += batch.length - eligible.size;
    await emit({ type: 'comment_gate', requested: batch.length, eligible: eligible.size, absentOrIneligible: batch.length - eligible.size, responseSha256: hash(gate.value), durationMs: gate.durationMs });
    for (const id of batch.filter(id => eligible.has(id))) {
      if (now() >= o.until) { summary.stopReason = 'time_budget_reached'; break outer; }
      const source = await commentCollection(client, id, o.until, now, emit, commentLimit, o.commentMeasurements === true); summary.inspectedParents++;
      if (!source.ok) {
        merge({ failures: { comment_header_reader_failed: 1 }, gaps: { comment_header_parent_unmeasured: 1 } }); consecutiveFailures++;
        failed('auction_comments');
        await emit({ type: 'comment_reader_failure', reader: 'auction_comments', vehicleId: id, status: source.status, code: source.code, durationMs: source.durationMs });
      } else {
        consecutiveFailures = 0;
        merge(source);
        if (source.safe === false) { summary.stopReason = 'unsafe_comment_headers'; break outer; }
        if (!source.complete) {
          await emit({ type: 'comment_parent_unmeasured', vehicleId: id, atLeast: source.atLeast, gaps: source.gaps, responseSha256: source.responseSha256 });
          if (source.stopReason) { summary.stopReason = source.stopReason; break outer; }
          continue;
        }
        const inspected = inspectCommentHeaders(id, source.value, commentLimit);
        const auctions = [], identities = []; let complete = true;
        for (const [reader, ids, target] of [['auction_events', inspected.auctionIds, auctions], ['external_identities', inspected.identityIds, identities]]) {
          for (let i = 0; i < ids.length; i += 200) {
            if (now() >= o.until) { summary.stopReason = 'time_budget_reached'; complete = false; break; }
            const wanted = ids.slice(i, i + 200), response = reader === 'auction_events' ? await client.sourceAuctions(id, wanted) : await client.sourceIdentities(wanted);
            if (!response.ok) {
              complete = false; consecutiveFailures++;
              failed(reader);
              merge({ failures: { comment_context_reader_failed: 1 }, gaps: { comment_context_parent_unmeasured: 1 } });
              await emit({ type: 'comment_reader_failure', reader, vehicleId: id, status: response.status, code: response.code, durationMs: response.durationMs });
            } else {
              consecutiveFailures = 0;
              if (!validContexts(response.value, wanted, reader === 'auction_events' ? id : undefined)) {
                merge({ failures: { comment_context_scope_or_shape_invalid: 1 } }); summary.stopReason = 'unsafe_comment_context'; complete = false; break;
              }
              target.push(...response.value);
              await emit({ type: 'comment_context', reader, vehicleId: id, requested: wanted.length, returned: response.value.length, responseSha256: hash(response.value), durationMs: response.durationMs });
            }
            if (summary.stopReason || consecutiveFailures >= 2) { summary.stopReason ??= 'two_consecutive_comment_reader_failures_inspect_cause'; complete = false; break; }
          }
          if (summary.stopReason) break;
        }
        if (summary.stopReason) break outer;
        if (!complete) continue; // Missing reads do not become missing relations.
        const measured = inspectCommentLineage(inspected.headers, auctions, identities); merge(measured);
        if (o.commentMeasurements) {
          measured.measurements = inspectCommentMeasurements(inspected.headers); merge(measured.measurements);
          mergeCommentMeasurements(summary.commentMeasurements, measured.measurements);
        }
        summary.completedParents++; summary.measuredCommentHeaders += measured.commentHeaders;
        summary.matchedAuctionParents += measured.matchedAuctionParents; summary.matchingRecordedNamespaces += measured.matchingRecordedNamespaces;
        for (const [key, count] of Object.entries(measured.identityStates)) summary.identityStates[key] += count;
        await emit({ type: 'comment_parent', vehicleId: id, measuredAt: new Date(now()).toISOString(), responseSha256: source.responseSha256, ...measured });
      }
      if (summary.stopReason || consecutiveFailures >= 2) { summary.stopReason ??= 'two_consecutive_comment_reader_failures_inspect_cause'; break outer; }
      if (summary.inspectedParents % 25 === 0) progress({ inspectedParents: summary.inspectedParents, measuredCommentHeaders: summary.measuredCommentHeaders, identityStates: summary.identityStates, failures: summary.failures });
    }
  }
  summary.stopReason ??= 'manifest_exhausted'; summary.finishedAt = new Date(now()).toISOString(); summary.networkRequests = client.requests;
  summary.status = Object.keys(summary.failures).length ? 'failed' : summary.stopReason === 'manifest_exhausted' && summary.completedParents > 0 && summary.completedParents === summary.eligibleParents ? 'passed_current_comment_header_lineage_in_manifest' : 'incomplete';
  summary.exitCode = summary.status === 'failed' ? 1 : summary.status === 'incomplete' ? 2 : 0;
  await emit({ type: 'summary', ...summary }); return summary;
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

export async function runTypedSpecificationLineage(client, o, subjects, { now = Date.now, emit = async () => {}, progress = () => {} } = {}) {
  const summary = { stage: 'read_only_public_typed_specification_projection_lineage_assay', startedAt: new Date(now()).toISOString(),
    requestedParents: subjects.ids.length, requestedPairs: subjects.ids.length * subjects.properties.length,
    manifestSha256: subjects.sha256, population: subjects.population, properties: subjects.properties,
    gatedParents: 0, eligibleParents: 0, absentOrIneligibleParents: 0, inspectedParents: 0, completedParents: 0,
    selectedClaims: 0, drilledClaims: 0, matchedProjectionPairs: 0, mismatchedPairs: 0, unavailablePairs: 0,
    claimsWithRepeatedAssertion: 0, repeatedAssertionObservations: 0,
    failures: {}, gaps: {}, databaseWrites: 0, modelCalls: 0, recordRepairs: 0,
    supportedAnswerCoverage: 'unmeasured', sourceQualification: 'unmeasured', physicalTruth: 'unmeasured',
    boundary: 'Explicit record/property manifest, at most20 current public parents per typed bulk read. Manifest property UUIDs are operator-supplied registry expectations, not an independent ratification audit. Current canonical claims only; unavailable does not identify absent evidence, privacy, withdrawal or supersession. Separate public gate/bulk/provenance reads are not a snapshot. Quotation and shared attribution/clock/uncertainty projections are compared without storing their contents. Provenance omits property/source FKs; original-source custody, extraction quality, conflicts outside the selected canonical claim, historical replay, factory/installed truth and fleet readiness remain unmeasured. No inferred metadata bindings count as testimony.' };
  const merge = part => { for (const group of ['failures', 'gaps']) for (const [key, count] of Object.entries(part[group] ?? {})) summary[group][key] = (summary[group][key] ?? 0) + count; };
  const failuresByReader = {};
  const readerFailed = reader => {
    failuresByReader[reader] = (failuresByReader[reader] ?? 0) + 1;
    merge({ failures: { [`typed_${reader}_reader_failed`]: 1 } });
    if (failuresByReader[reader] >= 2) summary.stopReason = 'two_typed_reader_failures_inspect_cause';
  };
  outer: for (let offset = 0, pages = 0; offset < subjects.ids.length; offset += 20, pages++) {
    if (now() >= o.until || pages >= o.maxPages) { summary.stopReason = now() >= o.until ? 'time_budget_reached' : 'page_budget_reached'; break; }
    const batch = subjects.ids.slice(offset, offset + 20), gate = await client.subjects(batch);
    if (!gate.ok || !Array.isArray(gate.value)) { merge({ failures: { typed_parent_reader_failed: 1 } }); summary.stopReason = 'typed_parent_reader_failed'; break; }
    const eligible = new Set();
    for (const p of gate.value) {
      if (!object(p) || !batch.includes(p.id) || eligible.has(p.id) || p.is_public !== true || p.deleted_at !== null || p.listing_kind === 'non_vehicle_item') {
        merge({ failures: { typed_parent_gate_invalid: 1 } }); summary.stopReason = 'typed_parent_gate_invalid'; break outer;
      }
      eligible.add(p.id);
    }
    summary.gatedParents += batch.length; summary.eligibleParents += eligible.size; summary.absentOrIneligibleParents += batch.length - eligible.size;
    await emit({ type: 'typed_lineage_gate', requested: batch.length, eligible: eligible.size, absentOrIneligible: batch.length - eligible.size,
      responseSha256: hash(gate.value), durationMs: gate.durationMs });
    if (!eligible.size) continue;
    if (now() >= o.until) { summary.stopReason = 'time_budget_reached'; break; }
    const ids = batch.filter(id => eligible.has(id)), specs = await client.rpc('get_vehicle_specs', { p_vehicle_ids: ids, p_include_typed_claims: true });
    if (!specs.ok) {
      readerFailed('specification');
      await emit({ type: 'typed_lineage_reader_failure', reader: 'get_vehicle_specs', requested: ids.length, status: specs.status, code: specs.code });
      if (summary.stopReason) break;
      continue;
    }
    const inspected = inspectTypedSpecifications(ids, subjects.properties, specs.value); merge(inspected);
    await emit({ type: 'typed_lineage_bulk', requested: ids.length, responseSha256: hash(specs.value), durationMs: specs.durationMs,
      returnedParents: inspected.safe ? inspected.parents.length : 0, failures: inspected.failures, gaps: inspected.gaps });
    if (!inspected.safe) { summary.stopReason = 'unsafe_typed_specification_output'; break; }
    for (const p of inspected.parents) {
      summary.inspectedParents++; summary.selectedClaims += p.claims.length; summary.unavailablePairs += p.unavailable.length;
      if (p.unavailable.length) merge({ gaps: { requested_typed_property_unavailable: p.unavailable.length } });
      const drills = []; let complete = true;
      for (const claim of p.claims) {
        if (now() >= o.until) { summary.stopReason = 'time_budget_reached'; complete = false; break; }
        const drill = await client.rpc('get_field_provenance', { p_vehicle_id: p.id, p_field: claim.property_key });
        if (!drill.ok) {
          complete = false; readerFailed('provenance');
          drills.push({ propertyKey: claim.property_key, status: drill.status, code: drill.code, durationMs: drill.durationMs });
        } else {
          summary.drilledClaims++;
          const result = inspectTypedProvenance(p.id, claim, p.readAt, drill.value); merge(result);
          if (result.projectionMatches) summary.matchedProjectionPairs++;
          if (Object.keys(result.failures).length) summary.mismatchedPairs++;
          if (result.repeatedListingAssertions) { summary.claimsWithRepeatedAssertion++; summary.repeatedAssertionObservations += result.repeatedListingAssertions; }
          drills.push({ propertyKey: claim.property_key, observationId: claim.observation_id,
            responseSha256: hash(drill.value), durationMs: drill.durationMs, ...result });
        }
        if (summary.stopReason) { complete = false; break; }
      }
      if (complete) summary.completedParents++;
      await emit({ type: 'typed_lineage_parent', vehicleId: p.id, measuredAt: new Date(now()).toISOString(), selectedClaims: p.claims.length,
        unavailableProperties: p.unavailable, drills });
      if (summary.stopReason) break outer;
    }
    progress({ inspectedParents: summary.inspectedParents, selectedClaims: summary.selectedClaims, matchedProjectionPairs: summary.matchedProjectionPairs, failures: summary.failures });
  }
  summary.stopReason ??= 'manifest_exhausted';
  summary.eligiblePairs = summary.eligibleParents * subjects.properties.length;
  summary.unmeasuredPairs = summary.eligiblePairs - summary.matchedProjectionPairs - summary.mismatchedPairs - summary.unavailablePairs;
  summary.ungatedParents = summary.requestedParents - summary.gatedParents;
  summary.finishedAt = new Date(now()).toISOString(); summary.networkRequests = client.requests;
  summary.status = Object.keys(summary.failures).length ? 'failed' : summary.stopReason !== 'manifest_exhausted' || !summary.inspectedParents ? 'incomplete'
    : summary.matchedProjectionPairs > 0 && summary.matchedProjectionPairs === summary.eligiblePairs ? 'matched_current_typed_projections_in_manifest'
      : 'measured_with_unavailable_or_unmeasured_pairs';
  summary.exitCode = summary.status === 'failed' ? 1 : summary.status === 'matched_current_typed_projections_in_manifest' ? 0 : 2;
  await emit({ type: 'summary', ...summary }); return summary;
}

const REPORT_KEYS = ['confidence_score', 'date_precision', 'independent_source', 'ingested_at', 'intent_status', 'kind',
  'observation_id', 'observed_at', 'observed_at_basis', 'occurrence_status', 'performed_clause', 'performer_id', 'performer_status',
  'report_status', 'reported_date', 'reported_date_label', 'source_capture_basis', 'source_capture_sha256', 'source_captured_at',
  'source_id', 'source_observation_id', 'source_recorded_at', 'source_url', 'source_value', 'source_witness_version'].join();
// Fixed uncertainty: a report is a publisher assertion, never confirmed work, a performer or corroboration.
const REPORT_FIXED = Object.freeze({ kind: 'activity', report_status: 'publisher_reported_completion', occurrence_status: 'unverified',
  performer_id: null, performer_status: 'unknown', independent_source: false, intent_status: 'unknown',
  observed_at_basis: 'source_testimony_recorded_at', date_precision: 'month' });
// v2 witnesses one whole passive sentence, so its performed clause is the source sentence itself.
const REPORT_WITNESS_VERSIONS = Object.freeze({ retained_description_reported_work_v1: 'prefix', retained_description_reported_work_v2: 'sentence' });
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The opt-in reader envelope and each report's own contract; no source text is retained. */
export function inspectReportedWork(value) {
  const result = { safe: true, legacyWorkRecords: 0, reports: [], failures: {}, gaps: {} };
  const fail = key => { result.failures[key] = (result.failures[key] ?? 0) + 1; };
  if (!object(value) || Object.keys(value).sort().join() !== 'reported_work,work_records' ||
    !Array.isArray(value.work_records) || !Array.isArray(value.reported_work) || value.reported_work.length > 200) {
    result.safe = false; fail('reported_work_envelope_invalid'); return result;
  }
  result.legacyWorkRecords = value.work_records.length;
  const ids = new Set(), assertions = new Set();
  for (const r of value.reported_work) {
    if (!object(r) || Object.keys(r).sort().join() !== REPORT_KEYS) { fail('reported_work_shape_invalid'); continue; }
    if (![r.observation_id, r.source_observation_id, r.source_id].every(x => UUID.test(x ?? ''))) { fail('reported_work_key_invalid'); continue; }
    if (ids.has(r.observation_id)) { fail('reported_work_observation_duplicated'); continue; }
    ids.add(r.observation_id);
    const before = Object.values(result.failures).reduce((a, b) => a + b, 0);
    for (const [key, expected] of Object.entries(REPORT_FIXED)) if (r[key] !== expected) fail(`reported_work_${key}_invalid`);
    const witness = Object.hasOwn(REPORT_WITNESS_VERSIONS, r.source_witness_version) ? REPORT_WITNESS_VERSIONS[r.source_witness_version] : null;
    if (!witness) fail('reported_work_source_witness_version_invalid');
    const text = x => typeof x === 'string' && x.trim() === x && x.length > 0 && Buffer.byteLength(x) <= 300;
    let url = null; try { url = new URL(r.source_url); } catch {}
    if (url?.protocol !== 'https:' || url.href !== r.source_url) fail('reported_work_source_url_invalid');
    // One sentence on one listing page is one report; a repeat is inflation, not corroboration.
    const assertion = `${r.source_id}\n${r.source_url}\n${r.source_value}`;
    if (assertions.has(assertion)) fail('reported_work_repeated_listing_sentence');
    assertions.add(assertion);
    if (!text(r.source_value) || !text(r.performed_clause)) fail('reported_work_text_invalid');
    else {
      if (/\b(?:recommend\w*|need\w*|require\w*)\b/i.test(r.performed_clause)) fail('reported_work_recommendation_in_performed_clause');
      if (r.source_value !== r.performed_clause && !r.source_value.startsWith(`${r.performed_clause}, `)) fail('reported_work_clause_not_source_prefix');
      else if (witness === 'sentence' && r.source_value !== r.performed_clause) fail('reported_work_v2_clause_not_whole_sentence');
    }
    const m = typeof r.reported_date === 'string' ? /^(\d{4})-(0[1-9]|1[0-2])$/.exec(r.reported_date) : null;
    if (!m) fail('reported_work_month_invalid');
    else if (r.reported_date_label !== `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}`) fail('reported_work_month_label_mismatch');
    else if (text(r.performed_clause) && !r.performed_clause.includes(r.reported_date_label)) fail('reported_work_month_not_in_clause');
    const clocks = ['source_captured_at', 'source_recorded_at', 'observed_at', 'ingested_at'].map(key => instant(r[key]));
    if (clocks.some(x => x === null)) fail('reported_work_clock_invalid');
    else {
      const [captured, recorded, observed, ingested] = clocks;
      if (observed !== recorded) fail('reported_work_observation_clock_basis_mismatch');
      if (captured > recorded) fail('reported_work_capture_after_source_recording');
      if (ingested < observed) fail('reported_work_recorded_before_source');
      if (m && r.reported_date > r.source_captured_at.slice(0, 7)) fail('reported_work_month_after_capture');
    }
    if (!/^[0-9a-f]{64}$/.test(r.source_capture_sha256 ?? '') || !present(r.source_capture_basis)) fail('reported_work_capture_witness_invalid');
    if (typeof r.confidence_score !== 'number' || !(r.confidence_score >= 0 && r.confidence_score <= 0.6)) fail('reported_work_confidence_invalid');
    if (Object.values(result.failures).reduce((a, b) => a + b, 0) === before) result.reports.push(r);
  }
  return result;
}

function reportSentences(text) {
  return text.split(/(?<=[.!?])[ \t\r\n]+/).map(s => s.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, ''));
}

/** Each report against its anonymous parent listing row. Source custody is checked; publisher truth is not. */
export function inspectReportedSources(vehicleId, reports, rows) {
  const result = { safe: true, sourcesFound: 0, matchedReports: 0, failures: {}, gaps: {} };
  const add = (group, key) => { group[key] = (group[key] ?? 0) + 1; };
  const wanted = [...new Set(reports.map(r => r.source_observation_id))];
  if (!Array.isArray(rows) || rows.length > wanted.length || new Set(rows.map(x => x?.id)).size !== rows.length ||
    !rows.every(x => object(x) && wanted.includes(x.id) && x.vehicle_id === vehicleId)) {
    result.safe = false; add(result.failures, 'reported_source_scope_or_shape_invalid'); return result;
  }
  const sources = new Map(rows.map(x => [x.id, x]));
  for (const r of reports) {
    const s = sources.get(r.source_observation_id);
    if (!s) { add(result.gaps, 'reported_source_unavailable_in_current_read'); continue; }
    result.sourcesFound++;
    const before = Object.values(result.failures).reduce((a, b) => a + b, 0);
    if (s.kind !== 'listing' || s.is_superseded !== false || s.extraction_method !== 'html_description_capture') add(result.failures, 'reported_source_not_current_native_listing');
    if (s.source_id !== r.source_id) add(result.failures, 'reported_source_id_mismatch');
    if (s.source_url !== r.source_url) add(result.failures, 'reported_source_url_mismatch');
    if (instant(s.ingested_at) === null || instant(s.ingested_at) !== instant(r.source_recorded_at)) add(result.failures, 'reported_source_recording_clock_mismatch');
    if (instant(s.source_captured_at) === null || instant(s.source_captured_at) !== instant(r.source_captured_at)) add(result.failures, 'reported_source_capture_clock_mismatch');
    if (instant(s.observed_at) !== instant(s.source_captured_at)) add(result.failures, 'reported_source_observation_not_capture_clock');
    if (s.source_capture_sha256 !== r.source_capture_sha256 || s.source_capture_basis !== r.source_capture_basis) add(result.failures, 'reported_source_capture_witness_mismatch');
    if (s.extractor_input_truncated !== false) add(result.failures, 'reported_source_truncated_or_unqualified');
    if (Object.values(result.failures).reduce((a, b) => a + b, 0) !== before) continue;
    if (typeof s.content_text !== 'string' || !s.content_text.length) { add(result.gaps, 'reported_source_text_withheld'); continue; }
    if (Buffer.byteLength(s.content_text) > 32000) { add(result.gaps, 'reported_source_text_oversized'); continue; }
    if (!reportSentences(s.content_text).includes(r.source_value)) { add(result.failures, 'reported_source_sentence_not_found'); continue; }
    result.matchedReports++;
  }
  return result;
}

export async function runReportedWorkLineage(client, o, subjects, { now = Date.now, emit = async () => {}, progress = () => {} } = {}) {
  const summary = { stage: 'read_only_public_reported_work_source_lineage_assay', startedAt: new Date(now()).toISOString(),
    requestedParents: subjects.ids.length, manifestSha256: subjects.sha256, population: subjects.population,
    gatedParents: 0, eligibleParents: 0, absentOrIneligibleParents: 0, inspectedParents: 0, completedParents: 0,
    parentsWithReports: 0, parentsWithoutReports: 0, selectedReports: 0, sourcesFound: 0, matchingReports: 0, legacyWorkRecords: 0,
    failures: {}, gaps: {}, databaseWrites: 0, modelCalls: 0, recordRepairs: 0,
    supportedAnswerCoverage: 'unmeasured', sourceCapability: 'reader_asserted', childAdmission: 'reader_asserted',
    captureAuthenticity: 'unmeasured', publisherTruth: 'unmeasured', physicalOccurrence: 'unmeasured',
    boundary: 'Explicit current public-parent manifest. vehicle_build_log_public(p_vehicle_id, p_include_reported:true) only; an absent overload is incomplete and zero reports is missing support. Each report is drilled to its parent listing on the anonymous vehicle_observations route, constrained by source observation and gated vehicle: identity, kind, supersession, capture metadata, microsecond clocks and the exact full sentence. The private activity child is not read; source capability and protected admission are asserted by the reader, not established here. Stored-source support is not capture authenticity, publisher truth or physical occurrence. Separate reads are not a snapshot. Receipts hold hashes and counters, never source text.' };
  const merge = part => { for (const group of ['failures', 'gaps']) for (const [key, count] of Object.entries(part[group] ?? {})) summary[group][key] = (summary[group][key] ?? 0) + count; };
  const failuresByReader = {};
  const readerFailed = reader => {
    failuresByReader[reader] = (failuresByReader[reader] ?? 0) + 1;
    merge({ failures: { [`reported_work_${reader}_reader_failed`]: 1 } });
    if (failuresByReader[reader] >= 2) summary.stopReason = 'two_reported_work_reader_failures_inspect_cause';
  };
  outer: for (let offset = 0, pages = 0; offset < subjects.ids.length; offset += 200, pages++) {
    if (now() >= o.until || pages >= o.maxPages) { summary.stopReason = now() >= o.until ? 'time_budget_reached' : 'page_budget_reached'; break; }
    const batch = subjects.ids.slice(offset, offset + 200), gate = await client.subjects(batch);
    if (!gate.ok || !Array.isArray(gate.value)) { merge({ failures: { reported_work_parent_reader_failed: 1 } }); summary.stopReason = 'reported_work_parent_reader_failed'; break; }
    const eligible = new Set();
    for (const p of gate.value) {
      if (!object(p) || !batch.includes(p.id) || eligible.has(p.id) || p.is_public !== true || p.deleted_at !== null || p.listing_kind === 'non_vehicle_item') {
        merge({ failures: { reported_work_parent_gate_invalid: 1 } }); summary.stopReason = 'reported_work_parent_gate_invalid'; break outer;
      }
      eligible.add(p.id);
    }
    summary.gatedParents += batch.length; summary.eligibleParents += eligible.size; summary.absentOrIneligibleParents += batch.length - eligible.size;
    await emit({ type: 'reported_work_gate', requested: batch.length, eligible: eligible.size, absentOrIneligible: batch.length - eligible.size,
      responseSha256: hash(gate.value), durationMs: gate.durationMs });
    for (const id of batch.filter(x => eligible.has(x))) {
      if (now() >= o.until) { summary.stopReason = 'time_budget_reached'; break outer; }
      const log = await client.rpc('vehicle_build_log_public', { p_vehicle_id: id, p_include_reported: true });
      summary.inspectedParents++;
      if (!log.ok && log.code === 'PGRST202') {
        // The opt-in overload is not deployed: nothing was measured, nothing agrees.
        merge({ gaps: { reported_work_reader_absent: 1 } }); summary.stopReason = 'reported_work_reader_absent';
        await emit({ type: 'reported_work_reader_absent', vehicleId: id, status: log.status, code: log.code, durationMs: log.durationMs });
        break outer;
      }
      if (!log.ok) {
        readerFailed('build_log');
        await emit({ type: 'reported_work_reader_failure', reader: 'vehicle_build_log_public', vehicleId: id, status: log.status, code: log.code, durationMs: log.durationMs });
        if (summary.stopReason) break outer;
        continue;
      }
      const inspected = inspectReportedWork(log.value); merge(inspected);
      if (!inspected.safe) { summary.stopReason = 'unsafe_reported_work_output'; break outer; }
      summary.legacyWorkRecords += inspected.legacyWorkRecords;
      const reported = log.value.reported_work.length;
      summary.selectedReports += reported;
      if (!reported) { summary.parentsWithoutReports++; merge({ gaps: { reported_work_absent_for_parent: 1 } }); }
      else summary.parentsWithReports++;
      let drill = { sourcesFound: 0, matchedReports: 0, failures: {}, gaps: {} }, drillSha256 = null, drillMs = null;
      if (inspected.reports.length) {
        if (now() >= o.until) { summary.stopReason = 'time_budget_reached'; break outer; }
        const wanted = [...new Set(inspected.reports.map(r => r.source_observation_id))];
        const sources = await client.reportSources(id, wanted);
        if (!sources.ok) {
          readerFailed('source');
          await emit({ type: 'reported_work_reader_failure', reader: 'vehicle_observations', vehicleId: id, status: sources.status, code: sources.code, durationMs: sources.durationMs });
          if (summary.stopReason) break outer;
          continue;
        }
        drill = inspectReportedSources(id, inspected.reports, sources.value); merge(drill);
        if (!drill.safe) { summary.stopReason = 'unsafe_reported_work_source'; break outer; }
        drillSha256 = hash(sources.value); drillMs = sources.durationMs;
      }
      summary.sourcesFound += drill.sourcesFound; summary.matchingReports += drill.matchedReports; summary.completedParents++;
      await emit({ type: 'reported_work_parent', vehicleId: id, measuredAt: new Date(now()).toISOString(), responseSha256: hash(log.value),
        durationMs: log.durationMs, legacyWorkRecords: inspected.legacyWorkRecords, reports: reported, sourcesFound: drill.sourcesFound,
        matchedReports: drill.matchedReports, sourceSha256: drillSha256, sourceDurationMs: drillMs,
        failures: { ...inspected.failures, ...drill.failures }, gaps: { ...inspected.gaps, ...drill.gaps } });
      if (summary.inspectedParents % 25 === 0) progress({ inspectedParents: summary.inspectedParents, selectedReports: summary.selectedReports, matchingReports: summary.matchingReports, failures: summary.failures });
    }
  }
  summary.stopReason ??= 'manifest_exhausted';
  summary.ungatedParents = summary.requestedParents - summary.gatedParents;
  summary.unmeasuredReports = summary.selectedReports - summary.matchingReports;
  summary.finishedAt = new Date(now()).toISOString(); summary.networkRequests = client.requests;
  summary.status = Object.keys(summary.failures).length ? 'failed'
    : summary.stopReason !== 'manifest_exhausted' || !summary.inspectedParents || summary.completedParents !== summary.eligibleParents ? 'incomplete'
      : summary.parentsWithoutReports === 0 && summary.selectedReports > 0 && summary.matchingReports === summary.selectedReports ? 'matched_current_reported_work_in_manifest'
        : 'measured_with_missing_or_unmatched_reports';
  summary.exitCode = summary.status === 'failed' ? 1 : summary.status === 'matched_current_reported_work_in_manifest' ? 0 : 2;
  await emit({ type: 'summary', ...summary }); return summary;
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

// Versioned acceptance compiler, not a new reader, collector or launch certificate.
// Gate inputs are declared assay receipts; this mode performs no network requests.
const MATRIX_VERSION = 'public_inventory_acceptance_v1';
const COMMON_GATES = ['evidence', 'identity_context', 'public_delivery', 'source_fidelity', 'semantic_quality', 'refusal_controls', 'freshness', 'service'];
export const PUBLIC_ACCEPTANCE = Object.freeze([
  { id: 'find_open', question: 'Can I find an example and open the correct record in Nuke?',
    grain: 'public_vehicle_record', eligibility: 'public, undeleted vehicle records; missing identity remains eligible',
    routes: ['/search', '/vehicle/:vehicleId'], owners: ['Search', 'useSearchPage', 'universal-search', 'VehicleProfile'],
    requirements: ['supported identity facets', 'stable public record key', 'search-to-detail navigation'], gates: COMMON_GATES },
  { id: 'attributed_inspection', question: 'What supports this example identity, configuration and condition?',
    grain: 'public_record_question', eligibility: 'applicable public record/question pairs, including missing evidence',
    routes: ['/vehicle/:vehicleId', '/vehicle/:vehicleId/observation/:obsId'],
    owners: ['VehicleProfile', 'get_vehicle_specs', 'get_field_provenance'],
    requirements: ['source witness', 'claim versus interpretation', 'configuration context and units', 'visible disagreement and unknowns'],
    gates: [...COMMON_GATES, 'configuration_context', 'units_conflicts'] },
  { id: 'one_inventory', question: 'Can Nuke replace my source rounds with new, changed and repeated listings?',
    grain: 'public_presentation_question', eligibility: 'publicly eligible source presentations, including unresolved assets and single sightings',
    routes: ['/?tab=market', '/search', '/vehicle/:vehicleId'],
    owners: ['HomePage/MarketPulse', 'Search/useSearchPage', 'universal-search', 'listing_feeds', 'public-reader-coverage'],
    requirements: ['original source evidence', 'listing versus asset identity', 'new/change/repeat membership',
      'asking price and unit witnesses', 'source and processing clocks', 'freshness and collection gaps', 'history without outbound source rounds'],
    gates: [...COMMON_GATES, 'presentation_identity', 'new_change_repeat', 'episode_clocks', 'price_units', 'collection_gaps', 'historical_cutoff'],
    knownBoundary: 'FacebookListingHistory/db-stats listing_history is a private bounded diagnostic, not this public inventory' },
].map(c => Object.freeze({ ...c, routes: Object.freeze(c.routes), owners: Object.freeze(c.owners),
  requirements: Object.freeze(c.requirements), gates: Object.freeze(c.gates) })));
const MATRIX_KEY = /^[a-z0-9_.:-]{1,100}$/;
const matrixKey = v => typeof v === 'string' && MATRIX_KEY.test(v);
const BASIS = new Set(['anonymous_runtime', 'deterministic_population_assay', 'independent_review']);
const reasonKey = v => typeof v === 'string' && /^[a-z0-9_]{1,80}$/.test(v);
const count = v => Number.isSafeInteger(v) && v >= 0;
const realClock = v => typeof v === 'string' && Number.isFinite(Date.parse(v));

function assessAcceptanceSubject(a, now) {
  const c = PUBLIC_ACCEPTANCE.find(c => c.id === a?.capability);
  if (!c || !matrixKey(a.key) || !object(a.gates)) throw new AssayError('invalid_acceptance_subject');
  if (Object.keys(a.gates).some(g => !c.gates.includes(g))) throw new AssayError('unknown_acceptance_gate');
  const objectives = a.objectives;
  if (objectives != null && (!object(objectives) ||
    !Number.isFinite(objectives.freshnessSeconds) || objectives.freshnessSeconds <= 0 ||
    !Number.isFinite(objectives.p95Ms) || objectives.p95Ms <= 0 ||
    !Number.isFinite(objectives.errorRateMax) || objectives.errorRateMax < 0 || objectives.errorRateMax > 1))
    throw new AssayError('invalid_acceptance_objectives');
  const reasons = [];
  let failed = false;
  const gates = c.gates.map(name => {
    const g = a.gates[name];
    if (!g || g.status === 'not_assessed') { reasons.push(`${name}_unassessed`); return { gate: name, status: 'not_assessed' }; }
    if (!object(g) || !['passed', 'failed'].includes(g.status)) throw new AssayError('invalid_acceptance_gate');
    if (g.status === 'failed') {
      if (!reasonKey(g.reason)) throw new AssayError('invalid_acceptance_reason');
      failed = true; reasons.push(`${name}:${g.reason}`); return { gate: name, status: 'failed', reason: g.reason };
    }
    const r = g.receipt;
    if (!object(r) || !matrixKey(r.id) || !/^[a-f0-9]{64}$/.test(r.sha256 ?? '') ||
      r.capability !== c.id || r.key !== a.key || r.gate !== name || !realClock(r.measuredAt) || Date.parse(r.measuredAt) > now ||
      !BASIS.has(r.basis) || (name === 'public_delivery' && r.basis !== 'anonymous_runtime') ||
      (['source_fidelity', 'semantic_quality'].includes(name) && r.basis !== 'independent_review')) {
      reasons.push(`${name}_receipt_unqualified`); return { gate: name, status: 'not_assessed' };
    }
    return { gate: name, status: 'passed', receipt: { id: r.id, sha256: r.sha256, measuredAt: r.measuredAt, basis: r.basis } };
  });
  if (!objectives) reasons.push('freshness_service_objectives_missing');
  // Objectives need measured metrics, not a passed flag or a provider timeout.
  for (const name of ['freshness', 'service']) {
    const g = gates.find(g => g.gate === name);
    if (g.status !== 'passed' || !objectives) continue;
    const metrics = a.gates[name].metrics;
    const valid = object(metrics) && (name === 'freshness'
      ? Number.isFinite(metrics.ageSeconds) && metrics.ageSeconds >= 0
      : Number.isFinite(metrics.p95Ms) && metrics.p95Ms >= 0 && Number.isFinite(metrics.errorRate) && metrics.errorRate >= 0 && metrics.errorRate <= 1);
    if (!valid) { g.status = 'not_assessed'; reasons.push(`${name}_metrics_missing`); continue; }
    // ageSeconds is source age at receipt measurement; elapsed time keeps an
    // old low-age receipt from remaining fresh indefinitely. No service TTL is inferred.
    const effectiveAgeSeconds = name === 'freshness'
      ? metrics.ageSeconds + (now - Date.parse(g.receipt.measuredAt)) / 1000 : null;
    g.metrics = name === 'freshness' ? { measuredAt: g.receipt.measuredAt,
      ageSecondsAtMeasurement: metrics.ageSeconds, effectiveAgeSeconds }
      : { measuredAt: g.receipt.measuredAt, p95Ms: metrics.p95Ms, errorRate: metrics.errorRate };
    if (name === 'freshness' ? effectiveAgeSeconds > objectives.freshnessSeconds
      : metrics.p95Ms > objectives.p95Ms || metrics.errorRate > objectives.errorRateMax) {
      g.status = 'failed'; failed = true; reasons.push(`${name}_objective_failed`);
    }
  }
  return { key: a.key, capability: c.id, state: failed ? 'blocked' : reasons.length ? 'not_assessed' : 'ready', reasons, objectives: objectives ? { freshnessSeconds: objectives.freshnessSeconds, p95Ms: objectives.p95Ms, errorRateMax: objectives.errorRateMax } : null, gates };
}

export function acceptanceMatrix(input, now = Date.now()) {
  if (!object(input) || input.schemaVersion !== MATRIX_VERSION || !object(input.population) ||
    !matrixKey(input.population.key) || !['explicit_manifest', 'exhausted_manifest'].includes(input.population.kind) ||
    !realClock(input.population.measuredAt) || Date.parse(input.population.measuredAt) > now ||
    !Array.isArray(input.assessments) || input.assessments.length > 2000 ||
    !Array.isArray(input.targets) || input.targets.length > 200 || typeof input.targetPlanComplete !== 'boolean' || (input.targetPlanComplete && input.targets.length === 0))
    throw new AssayError('invalid_acceptance_manifest');
  const seen = new Set();
  const rows = input.assessments.map(a => {
    const row = assessAcceptanceSubject(a, now);
    const composite = `${row.capability}/${row.key}`;
    if (seen.has(composite)) throw new AssayError('duplicate_acceptance_subject');
    seen.add(composite);
    return row;
  });
  const declared = input.population.denominator ?? null;
  if (declared !== null && !count(declared)) throw new AssayError('invalid_acceptance_denominator');
  if (input.population.kind === 'exhausted_manifest' && declared !== rows.length) throw new AssayError('acceptance_population_not_reconciled');
  const totals = { ready: 0, blocked: 0, not_assessed: 0 };
  for (const row of rows) totals[row.state]++;
  const targetSeen = new Set();
  const targets = input.targets.map(t => {
    if (!object(t) || !matrixKey(t.id) || !matrixKey(t.source) || targetSeen.has(t.id))
      throw new AssayError('invalid_or_duplicate_source_target');
    targetSeen.add(t.id);
    if (!['unknown', 'planned', 'permitted', 'blocked', 'held'].includes(t.access)) throw new AssayError('invalid_target_access');
    const fields = ['channel', 'region', 'query', 'priority', 'evidenceDepth'];
    for (const key of fields) if (t[key] != null && (typeof t[key] !== 'string' || !t[key].trim() || t[key].length > 300)) throw new AssayError('invalid_target_scope');
    for (const key of ['discoveryCadenceSeconds', 'revisitCadenceSeconds']) if (t[key] != null && (!Number.isFinite(t[key]) || t[key] <= 0)) throw new AssayError('invalid_target_cadence');
    const reasons = [...fields, 'discoveryCadenceSeconds', 'revisitCadenceSeconds'].filter(k => t[k] == null).map(k => `${k}_missing`);
    if (t.access !== 'permitted') reasons.push(`access_${t.access}`);
    return { id: t.id, source: t.source, ...Object.fromEntries(fields.map(k => [k, t[k] ?? null])),
      access: t.access, discoveryCadenceSeconds: t.discoveryCadenceSeconds ?? null, revisitCadenceSeconds: t.revisitCadenceSeconds ?? null,
      state: ['blocked', 'held'].includes(t.access) ? 'blocked' : reasons.length ? 'not_assessed' : 'configured_only', reasons,
      enumeration: 'not_assessed', captureDepth: 'not_assessed', revisitDelivery: 'not_assessed' };
  });
  return { schemaVersion: MATRIX_VERSION, evaluatedAt: new Date(now).toISOString(),
    basis: 'supplied_gate_receipts; not independently verified by this offline compiler',
    population: { key: input.population.key, kind: input.population.kind, measuredAt: input.population.measuredAt,
      declaredDenominator: declared, inspectedPairs: rows.length, fullRetained: count(input.population.fullRetained) ? input.population.fullRetained : null,
      fullPublic: count(input.population.fullPublic) ? input.population.fullPublic : null,
      fleetReadinessMeasured: false, coverage: null },
    criteria: PUBLIC_ACCEPTANCE.map(c => { const selected = rows.filter(r => r.capability === c.id);
      return { ...c, freshnessObjective: null, serviceObjective: null,
        state: selected.some(r => r.state === 'blocked') ? 'blocked' : !selected.length || selected.some(r => r.state === 'not_assessed') ? 'not_assessed' : 'ready_in_supplied_scope',
        reasons: selected.length ? [...new Set(selected.flatMap(r => r.reasons))] : ['no_gate_assessments', 'freshness_service_objectives_missing'],
        scopedTotals: { ready: selected.filter(r => r.state === 'ready').length, blocked: selected.filter(r => r.state === 'blocked').length,
          not_assessed: selected.filter(r => r.state === 'not_assessed').length }, fullPopulationReadiness: null };
    }), assessments: rows, scopedTotals: totals,
    targetPlan: { declaredComplete: input.targetPlanComplete, coverageMeasured: false,
      reasons: input.targetPlanComplete ? [] : ['intended_source_inventory_incomplete'], targets },
    publicReadinessCertificate: false, databaseWrites: 0, modelCalls: 0, networkRequests: 0 };
}

const RECONCILIATION_VERSION = 'population_reconciliation_v1';
const DIGEST = /^[a-f0-9]{64}$/;
const POPULATION_GRAINS = new Set(['vehicle_record', ...PUBLIC_ACCEPTANCE.map(c => c.grain)]);
const streamClock = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(v) && realClock(v);
const MAX_STREAM_LINE = 1_000_000;
const MAX_REASON_SETS = 16_384;

function reconciliationContract(input, now) {
  const p = input?.population;
  if (!object(input) || input.schemaVersion !== MATRIX_VERSION || input.mode !== RECONCILIATION_VERSION ||
    !object(p) || !matrixKey(p.key) || !POPULATION_GRAINS.has(p.grain) ||
    typeof p.filter !== 'string' || !p.filter.trim() || p.filter.length > 4000 ||
    !streamClock(p.measuredAt) || !object(p.window) || !streamClock(p.window.start) || !streamClock(p.window.end) ||
    Date.parse(p.window.start) > Date.parse(p.window.end) || Date.parse(p.window.end) > Date.parse(p.measuredAt) ||
    Date.parse(p.measuredAt) > now || !count(p.denominator) ||
    !['cached_census', 'dated_export'].includes(p.evidenceStage) || !object(p.sourceReceipt) ||
    !matrixKey(p.sourceReceipt.id) || !DIGEST.test(p.sourceReceipt.sha256 ?? '') ||
    !Array.isArray(input.capabilities) || !input.capabilities.length || input.capabilities.length > PUBLIC_ACCEPTANCE.length)
    throw new AssayError('invalid_reconciliation_contract');
  for (const name of ['fullRetained', 'fullPublic']) {
    const full = p[name];
    if (!object(full) || !count(full.count) || !POPULATION_GRAINS.has(full.grain) ||
      (full.grain === p.grain && full.count < p.denominator)) throw new AssayError('invalid_full_population_denominator');
  }
  if ((p.fullRetained.grain === p.fullPublic.grain ||
    (p.fullRetained.grain === 'vehicle_record' && p.fullPublic.grain === 'public_vehicle_record')) &&
    p.fullRetained.count < p.fullPublic.count) throw new AssayError('invalid_full_population_denominator');
  const contracts = new Map();
  for (const spec of input.capabilities) {
    const c = PUBLIC_ACCEPTANCE.find(c => c.id === spec?.id);
    if (!c || contracts.has(c.id) || c.grain !== p.grain || spec.grain !== c.grain ||
      typeof spec.eligibilityRule !== 'string' || !spec.eligibilityRule.trim() || spec.eligibilityRule.length > 4000 ||
      !count(spec.eligibleCount) || spec.eligibleCount > p.denominator)
      throw new AssayError('invalid_capability_population_or_grain');
    contracts.set(c.id, { ...c, eligibilityRule: spec.eligibilityRule, eligibleCount: spec.eligibleCount });
  }
  for (const name of ['manifest', 'assessments']) {
    const d = input[name];
    if (!object(d) || typeof d.path !== 'string' || !d.path || !count(d.rows) ||
      !DIGEST.test(d.sha256 ?? '') || d.exhausted !== true) throw new AssayError('invalid_or_unexhausted_stream_descriptor');
  }
  if (input.manifest.rows !== p.denominator) throw new AssayError('population_descriptor_count_mismatch');
  return contracts;
}

// Fixed read buffers plus one bounded JSONL record; never readFile on a population.
// A digest authenticates the supplied bytes, not the truth of an exporter's assertions.
async function* reconciliationStream(descriptor, population, type, verified) {
  const file = await open(descriptor.path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile()) throw new AssayError('stream_not_regular_file');
    const whole = createHash('sha256'), content = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let pending = Buffer.alloc(0), rows = 0, bytes = 0, ended = false, contentDigest;
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      bytes += bytesRead;
      const chunk = buffer.subarray(0, bytesRead);
      whole.update(chunk);
      pending = Buffer.concat([pending, chunk]);
      let start = 0, end;
      while ((end = pending.indexOf(10, start)) !== -1) {
        const line = pending.subarray(start, end + 1); start = end + 1;
        if (ended) throw new AssayError('stream_data_after_end');
        if (line.length > MAX_STREAM_LINE) throw new AssayError('stream_line_too_large');
        let row;
        try { row = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)); }
        catch { throw new AssayError('invalid_stream_json'); }
        if (!object(row)) throw new AssayError('invalid_stream_row');
        if (row.type === 'end') {
          contentDigest = content.digest('hex');
          if (row.populationKey !== population.key || row.grain !== population.grain ||
            row.measuredAt !== population.measuredAt || row.window?.start !== population.window.start ||
            row.window?.end !== population.window.end || row.exhausted !== true ||
            row.rows !== rows || rows !== descriptor.rows || row.sha256 !== contentDigest)
            throw new AssayError('stream_end_receipt_mismatch');
          ended = true;
        } else {
          if (row.type !== type) throw new AssayError('unexpected_stream_row_type');
          content.update(line); rows++;
          if (!count(rows) || rows > descriptor.rows) throw new AssayError('stream_row_count_exceeded');
          yield row;
        }
      }
      pending = Buffer.from(pending.subarray(start));
      if (pending.length > MAX_STREAM_LINE) throw new AssayError('stream_line_too_large');
    }
    if (pending.length || !ended) throw new AssayError('stream_truncated_or_end_missing');
    const after = await file.stat(), sha256 = whole.digest('hex');
    if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs) throw new AssayError('stream_changed_during_reconciliation');
    if (sha256 !== descriptor.sha256) throw new AssayError('stream_sha256_mismatch');
    Object.assign(verified, { rows, bytes, sha256, contentSha256: contentDigest, exhausted: true });
  } finally { await file.close(); }
}

function incrementReasons(map, key) {
  if (!Object.hasOwn(map, key) && Object.keys(map).length >= MAX_REASON_SETS) throw new AssayError('reconciliation_reason_budget_exceeded');
  map[key] = (map[key] ?? 0) + 1;
}

export async function reconcilePopulation(input, { now = Date.now(), emit = async () => {} } = {}) {
  const contracts = reconciliationContract(input, now), p = input.population;
  const verifiedManifest = {}, verifiedAssessments = {}, reasonSets = {};
  const summary = Object.fromEntries([...contracts].map(([id, c]) => [id, {
    id, grain: c.grain, eligibilityRule: c.eligibilityRule, eligibleCount: c.eligibleCount,
    notApplicableInManifest: p.denominator - c.eligibleCount, assessmentReceipts: 0, missingAssessments: 0,
    totals: { ready: 0, blocked: 0, not_assessed: 0 }, reasons: {},
    gates: Object.fromEntries(c.gates.map(g => [g, { passed: 0, failed: 0, not_assessed: 0, reasons: {} }])),
    failedGateIntersections: {}, unassessedGateIntersections: {}, gateStateIntersections: {},
  }]));
  const missing = new Map([...contracts].map(([id]) => [id, assessAcceptanceSubject({ key: 'missing', capability: id, gates: {} }, now)]));
  const manifest = reconciliationStream(input.manifest, p, 'subject', verifiedManifest);
  const receipts = reconciliationStream(input.assessments, p, 'assessment', verifiedAssessments);
  let previousSubject = null, previousReceipt = null, subjects = 0, pairs = 0;
  async function nextReceipt() {
    const n = await receipts.next();
    if (n.done) return null;
    const a = n.value;
    if (!matrixKey(a.key) || !contracts.has(a.capability)) throw new AssayError('invalid_or_ineligible_assessment_key');
    if (a.grain !== p.grain) throw new AssayError('assessment_grain_mismatch');
    if (previousReceipt !== null && (a.key < previousReceipt.key ||
      (a.key === previousReceipt.key && a.capability <= previousReceipt.capability)))
      throw new AssayError('duplicate_or_unsorted_assessment_key');
    previousReceipt = { key: a.key, capability: a.capability };
    return a;
  }
  await emit({ type: 'manifest', schemaVersion: MATRIX_VERSION, mode: RECONCILIATION_VERSION, status: 'in_progress',
    evaluatedAt: new Date(now).toISOString(), population: p, capabilities: [...contracts.values()],
    basis: 'supplied_gate_receipts; offline byte/count/scope reconciliation, not independent receipt verification',
    publicReadinessCertificate: false, databaseWrites: 0, modelCalls: 0, networkRequests: 0 });
  try {
    let assessment = await nextReceipt();
    for await (const subject of manifest) {
      if (!matrixKey(subject.key) || subject.grain !== p.grain) throw new AssayError('invalid_subject_key_or_grain');
      if (previousSubject !== null && subject.key <= previousSubject) throw new AssayError('duplicate_or_unsorted_subject_key');
      previousSubject = subject.key;
      if (!Array.isArray(subject.capabilities) || !subject.capabilities.length ||
        subject.capabilities.some((id, i) => !contracts.has(id) || (i > 0 && id <= subject.capabilities[i - 1])))
        throw new AssayError('invalid_subject_capability_membership');
      subjects++;
      if (assessment && assessment.key < subject.key) throw new AssayError('unmatched_assessment_key');
      if (assessment?.key === subject.key && !subject.capabilities.includes(assessment.capability)) throw new AssayError('ineligible_assessment_key');
      for (const capability of subject.capabilities) {
        const supplied = assessment?.key === subject.key && assessment.capability === capability;
        const row = supplied ? assessAcceptanceSubject(assessment, now) : missing.get(capability);
        // The legacy matrix already withholds overall readiness without objectives.
        // Population gate totals must also withhold these two individual passes.
        if (supplied && !row.objectives) for (const gate of row.gates) {
          if (['freshness', 'service'].includes(gate.gate) && gate.status === 'passed') {
            gate.status = 'not_assessed'; row.reasons.push(`${gate.gate}_objective_unassessed`);
          }
        }
        const s = summary[capability];
        s.totals[row.state]++; pairs++;
        supplied ? s.assessmentReceipts++ : s.missingAssessments++;
        for (const reason of row.reasons) incrementReasons(s.reasons, reason);
        for (const gate of row.gates) {
          s.gates[gate.gate][gate.status]++;
          for (const reason of row.reasons.filter(r => r.startsWith(`${gate.gate}_`) || r.startsWith(`${gate.gate}:`)))
            incrementReasons(s.gates[gate.gate].reasons, reason);
        }
        incrementReasons(s.failedGateIntersections, row.gates.filter(g => g.status === 'failed').map(g => g.gate).join('+') || 'none');
        incrementReasons(s.unassessedGateIntersections, row.gates.filter(g => g.status === 'not_assessed').map(g => g.gate).join('+') || 'none');
        incrementReasons(s.gateStateIntersections, row.gates.map(g => `${g.gate}:${g.status}`).join('|'));
        const reasonSet = { state: row.state, reasons: row.reasons, gates: row.gates.map(g => ({ gate: g.gate, status: g.status, ...(g.reason ? { reason: g.reason } : {}) })) };
        const reasonSetId = hash(reasonSet);
        if (!reasonSets[reasonSetId]) {
          if (Object.keys(reasonSets).length >= MAX_REASON_SETS) throw new AssayError('reconciliation_reason_budget_exceeded');
          reasonSets[reasonSetId] = reasonSet;
        }
        await emit({ type: 'assessment', key: subject.key, grain: p.grain, capability, state: row.state,
          assessmentProvided: supplied, reasonSet: reasonSetId, ...(supplied ? { evaluation: row } : {}) });
        if (supplied) assessment = await nextReceipt();
      }
      if (assessment?.key === subject.key) throw new AssayError('ineligible_assessment_key');
    }
    if (assessment) throw new AssayError('unmatched_assessment_key');
    if (subjects !== p.denominator) throw new AssayError('population_count_mismatch');
    for (const s of Object.values(summary)) {
      if (Object.values(s.totals).reduce((a, b) => a + b, 0) !== s.eligibleCount) throw new AssayError('capability_denominator_mismatch');
    }
    const result = { type: 'summary', schemaVersion: MATRIX_VERSION, mode: RECONCILIATION_VERSION, status: 'reconciled',
      evaluatedAt: new Date(now).toISOString(), population: { ...p, inspectedSubjects: subjects, inspectedPairs: pairs, exhausted: true },
      inputs: { manifest: verifiedManifest, assessments: verifiedAssessments }, capabilities: Object.values(summary), reasonSets,
      unmeasuredCapabilities: PUBLIC_ACCEPTANCE.filter(c => !contracts.has(c.id)).map(c => ({ id: c.id, grain: c.grain, state: 'not_assessed', eligibleCount: null })),
      populationReconciled: true, gateEvidenceIndependentlyVerified: false, fleetReadinessMeasured: false,
      publicReadinessCertificate: false, databaseWrites: 0, modelCalls: 0, networkRequests: 0 };
    await emit(result);
    return result;
  } finally { await manifest.return(); await receipts.return(); }
}

async function runPopulationReconciliation(args, print, now) {
  if (args.length !== 4 || args[0] !== '--reconcile-population' || args[2] !== '--out') throw new AssayError('invalid_reconciliation_arguments');
  let source, output;
  try {
    source = await open(args[1], constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = await source.stat();
    if (!stat.isFile() || stat.size > 2_000_000) throw new AssayError('reconciliation_config_size_or_type');
    const buffer = Buffer.alloc(2_000_001);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await source.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > 2_000_000) throw new AssayError('reconciliation_config_size_or_type');
    const bytes = buffer.subarray(0, length), input = JSON.parse(bytes.toString('utf8'));
    reconciliationContract(input, now);
    for (const name of ['manifest', 'assessments']) input[name].path = path.resolve(path.dirname(path.resolve(args[1])), input[name].path);
    output = await privateOutput(args[3]);
    const assaySourceSha256 = createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex');
    const inputSha256 = createHash('sha256').update(bytes).digest('hex'), digest = createHash('sha256');
    let buffered = '', outputRows = 0;
    const result = await reconcilePopulation(input, { now, emit: async row => {
      if (row.type === 'manifest') Object.assign(row, { assaySourceSha256, inputSha256 });
      if (row.type === 'summary') Object.assign(row, { precedingOutputRows: outputRows, precedingOutputSha256: digest.digest('hex'), assaySourceSha256, inputSha256 });
      const line = JSON.stringify(row) + '\n';
      if (row.type !== 'summary') { digest.update(line); outputRows++; }
      buffered += line;
      if (buffered.length >= 64 * 1024 || row.type === 'summary') { await output.writeFile(buffered); buffered = ''; }
    } });
    print(JSON.stringify({ status: 'population_reconciled', populationKey: result.population.key,
      inspectedSubjects: result.population.inspectedSubjects, capabilities: result.capabilities.map(c => ({ id: c.id, eligibleCount: c.eligibleCount, totals: c.totals })),
      publicReadinessCertificate: false, databaseWrites: 0, modelCalls: 0, networkRequests: 0 }));
    return 0;
  } finally { await source?.close(); await output?.close(); }
}

// Turn the existing reconciler into a pull stream with one pending row. Both
// sides still validate every original manifest/receipt byte and terminal tail;
// comparison never trusts a supplied summary or loads a population into memory.
function pullReconciliation(input, now) {
  let item, release, wake, finished = false, stopped = false, failure;
  const task = reconcilePopulation(input, { now, emit: row => {
    if (stopped) throw new AssayError('comparison_stopped');
    return new Promise((resolve, reject) => {
      item = row; release = { resolve, reject }; wake?.(); wake = undefined;
    });
  } }).catch(error => { failure = error; }).finally(() => { finished = true; wake?.(); });
  return {
    async next() {
      while (item === undefined && !finished) await new Promise(resolve => { wake = resolve; });
      if (item !== undefined) {
        const value = item, ack = release; item = release = undefined; ack.resolve();
        return { value, done: false };
      }
      if (failure) throw failure;
      return { done: true };
    },
    async return() { stopped = true; release?.reject(new AssayError('comparison_stopped')); await task; },
  };
}

const COMPARISON_VERSION = 'population_comparison_v1';
const STATES = ['ready', 'blocked', 'not_assessed'];
const stateCounts = () => Object.fromEntries(STATES.map(state => [state, 0]));
const transitions = () => Object.fromEntries(STATES.map(state => [state, stateCounts()]));

export async function comparePopulations(input, { now = Date.now(), emit = async () => {} } = {}) {
  if (input?.schemaVersion !== MATRIX_VERSION || input?.mode !== COMPARISON_VERSION ||
    !streamClock(input.before?.evaluatedAt) || !streamClock(input.after?.evaluatedAt) ||
    Date.parse(input.before.evaluatedAt) > Date.parse(input.after.evaluatedAt) || Date.parse(input.after.evaluatedAt) > now)
    throw new AssayError('invalid_comparison_contract_or_clocks');
  const before = input.before.configuration, after = input.after.configuration;
  const beforeContracts = reconciliationContract(before, Date.parse(input.before.evaluatedAt));
  const afterContracts = reconciliationContract(after, Date.parse(input.after.evaluatedAt));
  if (Date.parse(before.population.measuredAt) > Date.parse(after.population.measuredAt) ||
    ['start', 'end'].some(key => Date.parse(before.population.window[key]) > Date.parse(after.population.window[key])))
    throw new AssayError('comparison_population_chronology_reversed');
  if (before.population.grain !== after.population.grain || before.population.filter !== after.population.filter ||
    beforeContracts.size !== afterContracts.size || [...beforeContracts].some(([id, c]) => {
      const other = afterContracts.get(id);
      return !other || c.grain !== other.grain || c.eligibilityRule !== other.eligibilityRule;
    })) throw new AssayError('comparison_population_or_capability_rule_changed');
  const summaries = Object.fromEntries([...beforeContracts.keys()].map(id => [id, {
    id, grain: beforeContracts.get(id).grain, eligibilityRule: beforeContracts.get(id).eligibilityRule,
    sharedPairs: 0, beforeTotals: stateCounts(), afterTotals: stateCounts(),
    arrivals: stateCounts(), departures: stateCounts(), transitions: transitions(),
    unchangedObjectiveTransitions: transitions(), changedObjectiveTransitions: transitions(),
    objectiveChanges: 0,
  }]));
  const left = pullReconciliation(before, Date.parse(input.before.evaluatedAt));
  const right = pullReconciliation(after, Date.parse(input.after.evaluatedAt));
  const completed = {};
  async function nextAssessment(stream, side) {
    for (;;) {
      const row = await stream.next();
      if (row.done) {
        if (!completed[side]) throw new AssayError('comparison_reconciliation_incomplete');
        return null;
      }
      if (row.value.type === 'assessment') return row.value;
      if (row.value.type === 'summary') completed[side] = row.value;
    }
  }
  const order = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 :
    a.capability < b.capability ? -1 : a.capability > b.capability ? 1 : 0;
  try {
    await emit({ type: 'manifest', schemaVersion: MATRIX_VERSION, mode: COMPARISON_VERSION, status: 'in_progress',
      evaluatedAt: new Date(now).toISOString(), before: before.population, after: after.population,
      publicReadinessCertificate: false, databaseWrites: 0, modelCalls: 0, networkRequests: 0 });
    let a = await nextAssessment(left, 'before'), b = await nextAssessment(right, 'after');
    while (a || b) {
      const direction = !a ? 1 : !b ? -1 : order(a, b);
      const s = summaries[(direction <= 0 ? a : b).capability];
      if (direction < 0) { s.beforeTotals[a.state]++; s.departures[a.state]++; a = await nextAssessment(left, 'before'); }
      else if (direction > 0) { s.afterTotals[b.state]++; s.arrivals[b.state]++; b = await nextAssessment(right, 'after'); }
      else {
        s.beforeTotals[a.state]++; s.afterTotals[b.state]++; s.sharedPairs++; s.transitions[a.state][b.state]++;
        const changed = JSON.stringify(a.evaluation?.objectives ?? null) !== JSON.stringify(b.evaluation?.objectives ?? null);
        s[changed ? 'changedObjectiveTransitions' : 'unchangedObjectiveTransitions'][a.state][b.state]++;
        if (changed) s.objectiveChanges++;
        if (a.state !== b.state || changed) await emit({ type: 'transition', key: a.key, grain: a.grain,
          capability: a.capability, before: a.state, after: b.state, objectivesChanged: changed });
        a = await nextAssessment(left, 'before'); b = await nextAssessment(right, 'after');
      }
    }
    for (const s of Object.values(summaries)) {
      for (const side of ['before', 'after']) {
        const original = completed[side].capabilities.find(c => c.id === s.id);
        if (STATES.some(state => original.totals[state] !== s[`${side}Totals`][state]))
          throw new AssayError('comparison_totals_mismatch');
        s[`${side}EligibleCount`] = original.eligibleCount;
      }
      s.newlyReadyUnderUnchangedObjectives = s.unchangedObjectiveTransitions.blocked.ready + s.unchangedObjectiveTransitions.not_assessed.ready;
      s.noLongerReadyUnderUnchangedObjectives = s.unchangedObjectiveTransitions.ready.blocked + s.unchangedObjectiveTransitions.ready.not_assessed;
      s.netReadyChangeUnderUnchangedObjectives = s.newlyReadyUnderUnchangedObjectives - s.noLongerReadyUnderUnchangedObjectives;
      s.newlyReadyDecisions = s.transitions.blocked.ready + s.transitions.not_assessed.ready;
      s.noLongerReadyDecisions = s.transitions.ready.blocked + s.transitions.ready.not_assessed;
      s.netReadyDecisionChangeInSharedPopulation = s.newlyReadyDecisions - s.noLongerReadyDecisions;
      s.netReadyPopulationChange = s.afterTotals.ready - s.beforeTotals.ready;
      if (s.netReadyPopulationChange !== s.netReadyDecisionChangeInSharedPopulation + s.arrivals.ready - s.departures.ready)
        throw new AssayError('comparison_delta_mismatch');
    }
    const result = { type: 'summary', schemaVersion: MATRIX_VERSION, mode: COMPARISON_VERSION, status: 'reconciled',
      evaluatedAt: new Date(now).toISOString(), before: { evaluatedAt: input.before.evaluatedAt, population: completed.before.population, inputs: completed.before.inputs },
      after: { evaluatedAt: input.after.evaluatedAt, population: completed.after.population, inputs: completed.after.inputs },
      capabilities: Object.values(summaries),
      basis: 'Recomputed supplied gate receipts at their declared evaluation times; decision changes are not proof of repair causality. Newly assessed, changed-objective and population transitions remain separate.',
      populationReconciled: true, gateEvidenceIndependentlyVerified: false, fleetReadinessMeasured: false,
      publicReadinessCertificate: false, databaseWrites: 0, modelCalls: 0, networkRequests: 0 };
    await emit(result); return result;
  } finally { await Promise.all([left.return(), right.return()]); }
}

async function runPopulationComparison(args, print, now) {
  if (args.length !== 4 || args[0] !== '--compare-populations' || args[2] !== '--out') throw new AssayError('invalid_comparison_arguments');
  let source, output;
  try {
    source = await open(args[1], constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = await source.stat();
    if (!stat.isFile() || stat.size > 2_000_000) throw new AssayError('comparison_config_size_or_type');
    const buffer = Buffer.alloc(2_000_001);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await source.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > 2_000_000) throw new AssayError('comparison_config_size_or_type');
    const bytes = buffer.subarray(0, length), input = JSON.parse(bytes.toString('utf8'));
    for (const side of ['before', 'after']) for (const name of ['manifest', 'assessments']) {
      const descriptor = input[side]?.configuration?.[name];
      if (!descriptor || typeof descriptor.path !== 'string') throw new AssayError('invalid_comparison_stream');
      descriptor.path = path.resolve(path.dirname(path.resolve(args[1])), descriptor.path);
    }
    output = await privateOutput(args[3]);
    const assaySourceSha256 = createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex');
    const inputSha256 = createHash('sha256').update(bytes).digest('hex'), digest = createHash('sha256');
    let rows = 0;
    const result = await comparePopulations(input, { now, emit: async row => {
      if (row.type === 'manifest') Object.assign(row, { assaySourceSha256, inputSha256 });
      if (row.type === 'summary') Object.assign(row, { precedingOutputRows: rows, precedingOutputSha256: digest.digest('hex'), assaySourceSha256, inputSha256 });
      const line = JSON.stringify(row) + '\n';
      if (row.type !== 'summary') { digest.update(line); rows++; }
      await output.writeFile(line);
    } });
    print(JSON.stringify({ status: 'population_comparison_reconciled', capabilities: result.capabilities,
      publicReadinessCertificate: false, databaseWrites: 0, modelCalls: 0, networkRequests: 0 }));
    return 0;
  } finally { await source?.close(); await output?.close(); }
}

async function runAcceptanceMatrix(args, print) {
  if (args.length !== 4 || args[0] !== '--acceptance-matrix' || args[2] !== '--out') throw new AssayError('invalid_matrix_arguments');
  let source, output;
  try {
    source = await open(args[1], constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = await source.stat();
    if (!stat.isFile() || stat.size > 2_000_000) throw new AssayError('matrix_input_size_or_type');
    const buffer = Buffer.alloc(2_000_001);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await source.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > 2_000_000) throw new AssayError('matrix_input_size_or_type');
    const result = acceptanceMatrix(JSON.parse(buffer.subarray(0, length).toString('utf8')));
    result.assaySourceSha256 = createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex');
    result.inputSha256 = createHash('sha256').update(buffer.subarray(0, length)).digest('hex');
    output = await privateOutput(args[3]);
    await output.writeFile(JSON.stringify(result) + '\n');
    print(JSON.stringify({ status: 'acceptance_matrix_compiled', scopedTotals: result.scopedTotals,
      intendedTargets: result.targetPlan.targets.length, targetPlanComplete: result.targetPlan.declaredComplete,
      fleetReadinessMeasured: false, publicReadinessCertificate: false, databaseWrites: 0, modelCalls: 0, networkRequests: 0 }));
    return 0;
  } finally { await source?.close(); await output?.close(); }
}

// Operator evidence acquisition shares this assay owner but is NOT an anonymous
// delivery test. Every query uses the existing read-only, five-second q.sh path.
const IDENTITY_FIELDS = ['year', 'make', 'model'];
const IDENTITY_VERSION = 'public_identity_evidence_v1';

function identityInput(input, now) {
  reconciliationContract(input?.configuration, now);
  const b = input.budget;
  if (input.mode !== IDENTITY_VERSION || input.configuration.population.grain !== 'public_vehicle_record' ||
    input.configuration.capabilities.length !== 1 || input.configuration.capabilities[0].id !== 'find_open' ||
    !object(b) || !Number.isInteger(b.batchSize) || b.batchSize < 1 || b.batchSize > 200 ||
    !Number.isInteger(b.maxRequests) || b.maxRequests < 1 || b.maxRequests > 10000 ||
    !Number.isInteger(b.pauseMs) || b.pauseMs < 100 || b.pauseMs > 60000 ||
    !streamClock(b.until) || Date.parse(b.until) <= now || Date.parse(b.until) > now + 14 * 3600000 ||
    !UUID.test(input.after ?? ZERO) || input.through != null &&
      (!UUID.test(input.through) || input.through.toLowerCase() <= (input.after ?? ZERO).toLowerCase()))
    throw new AssayError('invalid_identity_evidence_scope');
  return { ...b, after: (input.after ?? ZERO).toLowerCase(), through: input.through?.toLowerCase() ?? null, until: Date.parse(b.until) };
}

function identitySubjects(rows, ids) {
  if (!Array.isArray(rows) || rows.length !== ids.length) throw new AssayError('identity_subject_response_incomplete');
  for (let i = 0; i < rows.length; i++) {
    const s = rows[i];
    if (s?.vehicleId !== ids[i] || typeof s.publicEligible !== 'boolean') throw new AssayError('identity_subject_scope_invalid');
    if (!s.publicEligible) {
      if (s.values != null || s.facets != null) throw new AssayError('identity_private_payload_refused');
      continue;
    }
    if (!object(s.values) || !object(s.facets) || !DIGEST.test(s.identitySha256 ?? '')) throw new AssayError('identity_subject_shape_invalid');
    for (const field of IDENTITY_FIELDS) {
      const f = s.facets[field];
      if (!object(f) || !['typedCount', 'plausibleCount', 'otherTypedCount', 'legacyCount', 'legacyMatchingCount'].every(k => count(f[k])) ||
        f.typedCount !== f.plausibleCount + f.otherTypedCount || f.legacyMatchingCount > f.legacyCount)
        throw new AssayError('identity_inventory_counts_invalid');
    }
  }
}

// This classifies only support in the declared source paths. Legacy testimony
// and unimplemented methods remain visible and cannot establish absence or pass.
export function inspectIdentityEvidence(subject, results, complete = true) {
  const facets = {};
  for (const field of IDENTITY_FIELDS) {
    const f = subject.facets?.[field], claims = results.filter(r => r.propertyKey === field);
    let state = 'incomplete';
    if (complete && subject.publicEligible && f && claims.length === f.plausibleCount) {
      if (claims.some(r => r.qualified === true && r.matchesDisplayedValue === true)) state = 'qualified';
      else if (claims.some(r => r.custodyMatches === true && r.matchesDisplayedValue === false)) state = 'value_disagreement';
      else if (f.otherTypedCount > 0 || f.legacyCount > 0) state = 'unsupported_method';
      else if (claims.some(r => r.custodyMatches === false)) state = 'invalid_supported_witness';
      else if (claims.length) state = 'incomplete';
      else state = 'missing_in_supported_paths';
    }
    const qualified = claims.filter(r => r.qualified === true && r.matchesDisplayedValue === true);
    facets[field] = { state, ...(f ?? {}), qualifiedWitnesses: qualified.length,
      // Three replayable examples suffice to witness presence; counts above still
      // exhaust all candidates. This cap never establishes absence or completeness.
      witnesses: qualified.slice(0, 3).map(r => ({ observationId: r.observationId,
        sourceObservationId: r.sourceObservationId, sourceId: r.sourceId,
        sourceRecordedAt: r.sourceRecordedAt, sourceObservedAt: r.sourceObservedAt,
        claimRecordedAt: r.claimRecordedAt, claimObservedAt: r.claimObservedAt,
        sourceEventTimeStatus: r.sourceEventTimeStatus, identityResolutionStatus: r.identityResolutionStatus,
        modelLabelScope: r.modelLabelScope })) };
  }
  const supported = IDENTITY_FIELDS.every(f => facets[f].state === 'qualified');
  return { type: 'identity_evidence', key: subject.vehicleId, publicEligible: subject.publicEligible,
    facets, ...(subject.publicEligible ? { displayedIdentity: subject.values, identitySha256: subject.identitySha256 } : {}),
    evidenceGate: supported ? 'passed' : 'not_assessed',
    // A missing supported path is not a global absence proof. The other seven
    // acceptance gates, including independent semantic review, are untouched.
    readiness: 'not_assessed', collectionExhausted: complete,
    reason: supported ? 'supported_displayed_identity' : subject.publicEligible === true ? 'identity_support_incomplete'
      : subject.publicEligible === false ? 'cohort_member_not_public_now' : 'public_eligibility_unassessed' };
}

export async function acquireIdentityEvidence(input, { query, emit = async () => {}, now = Date.now,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const b = identityInput(input, now()), c = input.configuration, verified = {};
  // Validate the WHOLE dated manifest before issuing any live query. Incomplete
  // input tails must not initiate an expensive partial census.
  let previous = '', afterFound = b.after === ZERO, throughFound = b.through === null;
  for await (const s of reconciliationStream(c.manifest, c.population, 'subject', verified)) {
    if (!UUID.test(s.key ?? '') || s.key !== s.key.toLowerCase() || s.key <= previous ||
      s.grain !== c.population.grain || JSON.stringify(s.capabilities) !== '["find_open"]')
      throw new AssayError('identity_manifest_subject_invalid');
    previous = s.key;
    if (s.key === b.after) afterFound = true;
    if (s.key === b.through) throughFound = true;
  }
  if (!afterFound) throw new AssayError('identity_resume_key_outside_manifest');
  if (!throughFound) throw new AssayError('identity_end_key_outside_manifest');
  const startedAt = new Date(now()).toISOString(), totals = {}, reasons = {}, retryRanges = [], gateTotals = { passed: 0, not_assessed: 0 };
  let requests = 0, inspected = 0, collected = 0, lastKey = b.after, stopReason = 'manifest_exhausted', failures = 0, ownerHash;
  await emit({ type: 'manifest', schemaVersion: IDENTITY_VERSION, population: c.population,
    sourceManifest: verified, startedAt, after: b.after, through: b.through, budget: b,
    anonymous: false, evidenceOnly: true, databaseWrites: 0, modelCalls: 0 });
  async function request(args) {
    if (requests >= b.maxRequests || now() >= b.until) throw new AssayError('identity_request_budget');
    if (requests) await pause(b.pauseMs);
    if (now() >= b.until) throw new AssayError('identity_request_budget');
    requests++;
    const r = await query(args);
    if (r?.schemaVersion !== IDENTITY_VERSION || r.mode !== args.mode || !realClock(r.measuredAt) ||
      Date.parse(r.measuredAt) > now() + 1000 || !DIGEST.test(r.ownerSha256 ?? ''))
      throw new AssayError('identity_reader_contract_invalid');
    if (ownerHash && ownerHash !== r.ownerSha256) throw new AssayError('identity_owner_changed');
    ownerHash = r.ownerSha256;
    return r;
  }
  async function batch(ids) {
    let subjects, cursor = null, prior = '', complete = false, batchReason = null;
    const batchResponses = createHash('sha256');
    const bySubject = new Map(ids.map(id => [id, []])), seen = new Set();
    const readStartedAt = new Date(now()).toISOString();
    try {
      do {
        const r = await request({ mode: 'inventory', vehicleIds: ids, cursor });
        batchResponses.update(JSON.stringify(r) + '\n');
        identitySubjects(r.subjects, ids);
        if (subjects && hash(subjects) !== hash(r.subjects)) throw new AssayError('identity_inventory_changed');
        subjects = r.subjects;
        if (!Array.isArray(r.candidates) || r.candidates.length > 100 || typeof r.hasMore !== 'boolean' ||
          r.candidatePageExhausted !== !r.hasMore || r.hasMore && r.candidates.length !== 100)
          throw new AssayError('identity_candidate_page_invalid');
        for (const item of r.candidates) {
          const key = `${item.vehicleId}:${item.observationId}`;
          if (!bySubject.has(item.vehicleId) || !UUID.test(item.observationId ?? '') ||
            !UUID.test(item.sourceObservationId ?? '') ||
            !IDENTITY_FIELDS.includes(item.propertyKey) || key <= prior || seen.has(item.observationId))
            throw new AssayError('identity_candidate_scope_invalid');
          prior = key; seen.add(item.observationId);
          if (seen.size > 10000) throw new AssayError('identity_candidate_memory_budget');
        }
        if (r.candidates.length) {
          const checked = await request({ mode: 'custody', vehicleIds: ids,
            candidateIds: r.candidates.map(x => x.observationId) });
          batchResponses.update(JSON.stringify(checked) + '\n');
          if (!Array.isArray(checked.results) || checked.results.length !== r.candidates.length)
            throw new AssayError('identity_custody_response_incomplete');
          const expected = new Map(r.candidates.map(x => [x.observationId, x]));
          for (const item of checked.results) {
            const candidate = expected.get(item.observationId);
            if (!candidate || item.vehicleId !== candidate.vehicleId || item.propertyKey !== candidate.propertyKey ||
              typeof item.qualified !== 'boolean' || typeof item.matchesDisplayedValue !== 'boolean' ||
              ![true, false, null].includes(item.custodyMatches) ||
              item.qualified && (item.custodyMatches !== true || item.publicEligible !== true) ||
              item.identitySha256 !== subjects.find(s => s.vehicleId === item.vehicleId)?.identitySha256)
              throw new AssayError('identity_custody_scope_invalid');
            if (item.qualified && (item.sourceObservationId !== candidate.sourceObservationId || !UUID.test(item.sourceId ?? '') ||
              !['sourceRecordedAt', 'claimRecordedAt', 'claimObservedAt'].every(k => realClock(item[k]) && Date.parse(item[k]) <= now()) ||
              item.sourceObservedAt != null && (!realClock(item.sourceObservedAt) || Date.parse(item.sourceObservedAt) > now()) ||
              item.sourceEventTimeStatus !== 'unknown' || item.identityResolutionStatus !== 'unverified'))
              throw new AssayError('identity_witness_receipt_invalid');
            expected.delete(item.observationId);
            bySubject.get(item.vehicleId).push(item);
          }
        }
        cursor = r.nextCursor;
        const last = r.candidates.at(-1);
        if (r.hasMore && (!last || cursor?.vehicleId !== last.vehicleId || cursor?.observationId !== last.observationId) ||
          !r.hasMore && cursor !== null) throw new AssayError('identity_cursor_invalid');
        complete = !r.hasMore;
      } while (!complete);
      for (const s of subjects) for (const field of IDENTITY_FIELDS) if (s.publicEligible &&
        bySubject.get(s.vehicleId).filter(r => r.propertyKey === field).length !== s.facets[field].plausibleCount)
        throw new AssayError('identity_candidate_exhaustion_mismatch');
      failures = 0;
    } catch (e) {
      complete = false; failures++;
      batchReason = e instanceof AssayError ? e.code : 'identity_read_failed';
      retryRanges.push({ after: lastKey, through: ids.at(-1), reason: batchReason });
      if (batchReason === 'identity_request_budget' || batchReason === 'identity_owner_changed' || failures >= 2) stopReason = batchReason;
    }
    const batchResponseSha256 = batchResponses.digest('hex');
    for (const id of ids) {
      const s = subjects?.find(s => s.vehicleId === id) ?? { vehicleId: id, publicEligible: null };
      const row = inspectIdentityEvidence(s, bySubject.get(id), complete);
      if (batchReason) row.reason = batchReason;
      Object.assign(row, { readStartedAt, measuredAt: new Date(now()).toISOString(), ownerSha256: ownerHash ?? null, batchResponseSha256 });
      for (const [field, f] of Object.entries(row.facets)) {
        totals[field] ??= {}; incrementReasons(totals[field], f.state);
      }
      incrementReasons(reasons, row.reason); gateTotals[row.evidenceGate]++; inspected++; if (complete) collected++; lastKey = id;
      await emit(row);
    }
  }
  let ids = [];
  for await (const s of reconciliationStream(c.manifest, c.population, 'subject', {})) {
    if (s.key <= b.after) continue;
    if (stopReason !== 'manifest_exhausted') break;
    if (requests >= b.maxRequests || now() >= b.until) { stopReason = 'identity_request_budget'; break; }
    ids.push(s.key);
    if (ids.length === b.batchSize || s.key === b.through) { await batch(ids); ids = []; }
    if (s.key === b.through) {
      // Preserve a failed last batch's stop reason. A bounded retry is traversal
      // of this range, never proof that the rest of the population was read.
      if (stopReason === 'manifest_exhausted' && s.key !== previous) stopReason = 'range_boundary_reached';
      break;
    }
  }
  if (ids.length && stopReason === 'manifest_exhausted') await batch(ids);
  const result = { type: 'summary', schemaVersion: IDENTITY_VERSION, population: c.population,
    startedAt, completedAt: new Date(now()).toISOString(), after: b.after, through: b.through, resumeAfter: lastKey,
    inspected, collected, uninspectedInFullPopulation: c.population.denominator - inspected,
    segmentExhausted: stopReason === 'manifest_exhausted', fullPopulationAcquired: b.after === ZERO && collected === c.population.denominator,
    rangeExhausted: b.through !== null && lastKey === b.through && ['manifest_exhausted', 'range_boundary_reached'].includes(stopReason),
    stopReason, requests, facets: totals, evidenceGateTotals: gateTotals, reasons, retryRanges, ownerSha256: ownerHash ?? null,
    ready: 0, blocked: 0, notAssessed: c.population.denominator,
    publicReadinessCertificate: false, anonymousDeliveryMeasured: false, databaseWrites: 0, modelCalls: 0 };
  await emit(result); return result;
}

async function runIdentityAcquisition(args, print, deps) {
  if (args.length !== 4 || args[2] !== '--out') throw new AssayError('invalid_identity_arguments');
  let source, output;
  try {
    source = await open(args[1], constants.O_RDONLY | constants.O_NONBLOCK);
    if (!(await source.stat()).isFile() || (await source.stat()).size > 2_000_000) throw new AssayError('identity_config_size_or_type');
    const bytes = Buffer.alloc(2_000_001);
    let size = 0;
    while (size < bytes.length) { const r = await source.read(bytes, size, bytes.length - size, null); if (!r.bytesRead) break; size += r.bytesRead; }
    if (size > 2_000_000) throw new AssayError('identity_config_size_or_type');
    const input = JSON.parse(bytes.subarray(0, size).toString('utf8'));
    for (const name of ['manifest', 'assessments']) input.configuration[name].path = path.resolve(path.dirname(path.resolve(args[1])), input.configuration[name].path);
    const sql = await readFile(path.join(ROOT, 'scripts/discovery/public-identity-evidence.sql'), 'utf8');
    const assaySourceSha256 = createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex');
    output = await privateOutput(args[3]);
    const digest = createHash('sha256'); let rows = 0;
    const result = await acquireIdentityEvidence(input, { ...deps,
      query: deps.query ?? (args => readQuery(sql.replace(/\$1\b/g, () => `'${JSON.stringify(args).replaceAll("'", "''")}'`), 'receipt')),
      emit: async row => {
        if (row.type === 'manifest') Object.assign(row, { assaySourceSha256,
          sqlSha256: createHash('sha256').update(sql).digest('hex'), inputSha256: createHash('sha256').update(bytes.subarray(0, size)).digest('hex') });
        if (row.type === 'summary') Object.assign(row, { precedingOutputRows: rows, precedingOutputSha256: digest.digest('hex') });
        const line = JSON.stringify(row) + '\n';
        if (row.type !== 'summary') { digest.update(line); rows++; }
        await output.writeFile(line);
        if (row.type === 'identity_evidence' && rows % 1000 === 0) print(JSON.stringify({ status: 'identity_acquisition_running', inspected: rows - 1, eligiblePopulation: input.configuration.population.denominator }));
      } });
    print(JSON.stringify(result));
    return result.segmentExhausted || result.rangeExhausted ? 0 : 2;
  } finally { await source?.close(); await output?.close(); }
}

export async function main(args = process.argv.slice(2), deps = {}) {
  const print = deps.print ?? console.log;
  let file;
  try {
    if (args[0] === '--identity-evidence') return await runIdentityAcquisition(args, print, deps);
    if (args[0] === '--compare-populations') return await runPopulationComparison(args, print, (deps.now ?? Date.now)());
    if (args[0] === '--reconcile-population') return await runPopulationReconciliation(args, print, (deps.now ?? Date.now)());
    if (args[0] === '--acceptance-matrix') return await runAcceptanceMatrix(args, print);
    const o = options(args);
    if (o.env) { const require = createRequire(path.join(ROOT, 'nuke_frontend/package.json')); require('dotenv').config({ path: o.env, quiet: true }); }
    const config = anonymousConfiguration(deps.env ?? process.env);
    const client = deps.client ?? publicClient(config);
    const subjects = o.family !== 'price' ? (o.family === 'typed-specifications' ? typedLineageSubjects : lineageSubjects)(JSON.parse(await readFile(o.subjects, 'utf8'))) : null;
    file = await privateOutput(o.out);
    const emit = value => file.writeFile(JSON.stringify(value) + '\n');
    await emit({ type: 'manifest', schemaVersion: 'public_reader_coverage_v2',
      assaySourceSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
      options: { ...o, env: undefined, out: undefined, subjects: undefined },
      anonymous: true, readers: o.family === 'bids' ? ['vehicles', 'vehicle_comments_unified', 'auction_comments', 'vehicle_observations', 'auction_events', 'external_identities']
        : o.family === 'comments' ? ['vehicles', 'auction_comments', 'auction_events', 'external_identities']
        : o.family === 'reported-work' ? ['vehicles', 'vehicle_build_log_public', 'vehicle_observations']
        : subjects ? ['vehicles', 'get_vehicle_specs', 'get_field_provenance'] : ['vehicles', 'vehicle_price_facts'],
      parentFields: subjects ? 'id,is_public,deleted_at,listing_kind' : PARENT_FIELDS,
      outputContains: 'response/page hashes, scope, clocks, counts and bounded public failure UUIDs; no raw source/comment bodies or credentials' });
    const report = o.family === 'bids' ? await runBidLineage(client, o, subjects, { ...deps, emit, progress: value => print(JSON.stringify(value)) })
      : o.family === 'comments' ? await runCommentLineage(client, o, subjects, { ...deps, emit, progress: value => print(JSON.stringify(value)) })
      : o.family === 'typed-specifications' ? await runTypedSpecificationLineage(client, o, subjects, { ...deps, emit, progress: value => print(JSON.stringify(value)) })
      : o.family === 'reported-work' ? await runReportedWorkLineage(client, o, subjects, { ...deps, emit, progress: value => print(JSON.stringify(value)) })
      : subjects ? await runSpecificationLineage(client, o, subjects, { ...deps, emit, progress: value => print(JSON.stringify(value)) })
      : await runCoverage(client, o, { ...deps, emit, progress: value => print(JSON.stringify(value)) });
    print(JSON.stringify({ status: report.status, stopReason: report.stopReason, inspectedRecords: report.inspectedRecords,
      measuredFoldRecords: report.measuredFoldRecords, recordsPerSecond: report.recordsPerSecond, failures: report.failures,
      inspectedParents: report.inspectedParents, selectedReports: report.selectedReports, matchingReports: report.matchingReports,
      selectedClaims: report.selectedClaims, matchedProjectionPairs: report.matchedProjectionPairs, unavailablePairs: report.unavailablePairs,
      unmeasuredPairs: report.unmeasuredPairs, supportedAnswerCoverage: report.supportedAnswerCoverage,
      measuredCommentHeaders: report.measuredCommentHeaders, identityStates: report.identityStates,
      measured: report.measured, nativeAuthorStates: report.nativeAuthorStates,
      parentsWithReports: report.parentsWithReports, parentsWithoutReports: report.parentsWithoutReports, unmeasuredReports: report.unmeasuredReports,
      claimsWithRepeatedAssertion: report.claimsWithRepeatedAssertion, repeatedAssertionObservations: report.repeatedAssertionObservations,
      diagnostics: report.diagnostics, gaps: report.gaps, recordRepairs: 0, verifiedRepairs: 0, databaseWrites: 0, modelCalls: 0 }));
    return report.exitCode;
  } catch (e) { print(JSON.stringify({ status: 'failed', error: e instanceof AssayError ? e.code : 'assay_initialization_or_output_failed' })); return 1; }
  finally { await file?.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
