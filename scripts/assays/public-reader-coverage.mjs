#!/usr/bin/env node
/**
 * Current public parent -> existing price/specification/comment/bid reader assay.
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
    if (!['--out', '--env', '--scope', '--page-size', '--max-pages', '--after', '--until', '--family', '--subjects', '--comment-limit', '--bid-limit'].includes(name) ||
      seen.has(name) || !args[i + 1] || args[i + 1].startsWith('--')) throw new AssayError('invalid_arguments');
    seen.add(name);
    const v = args[i + 1];
    if (name === '--page-size') o.pageSize = /^\d+$/.test(v) ? Number(v) : NaN;
    else if (name === '--comment-limit') o.commentLimit = /^\d+$/.test(v) ? Number(v) : NaN;
    else if (name === '--bid-limit') o.bidLimit = /^\d+$/.test(v) ? Number(v) : NaN;
    else if (name === '--max-pages') o.maxPages = /^\d+$/.test(v) ? Number(v) : NaN;
    else if (name === '--until') o.until = Date.parse(v);
    else o[name.slice(2)] = v;
  }
  if (!o.out || !['price', 'specifications', 'comments', 'bids'].includes(o.family) ||
    (seen.has('--comment-limit') && o.family !== 'comments') ||
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
    commentHeaders(id, cursor) {
      if (!UUID.test(id)) throw new AssayError('invalid_reader_scope');
      if (cursor !== undefined && (!object(cursor) || !UUID.test(cursor.id ?? '') || !commentClock(cursor.postedAt))) throw new AssayError('invalid_reader_scope');
      const q = new URLSearchParams({
        select: 'id,vehicle_id,auction_event_id,posted_at,platform,external_identity_id,author_external_identity_id,comment_type,is_seller',
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

async function commentCollection(client, id, until, now, emit, limit) {
  const rows = [], ids = new Set(), hashes = []; let previous;
  for (let page = 0; page < 100; page++) {
    if (now() >= until) return { ok: true, complete: false, gaps: { comment_collection_time_unmeasured: 1 }, stopReason: 'time_budget_reached' };
    const response = await client.commentHeaders(id, previous && { id: previous.id, postedAt: previous.posted_at });
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

export async function runCommentLineage(client, o, subjects, { now = Date.now, emit = async () => {}, progress = () => {} } = {}) {
  const commentLimit = o.commentLimit ?? 1000;
  const summary = { stage: 'read_only_public_comment_header_lineage_assay', startedAt: new Date(now()).toISOString(),
    requestedParents: subjects.ids.length, manifestSha256: subjects.sha256, population: subjects.population,
    gatedParents: 0, eligibleParents: 0, absentOrIneligibleParents: 0, inspectedParents: 0, completedParents: 0,
    measuredCommentHeaders: 0, matchedAuctionParents: 0, matchingRecordedNamespaces: 0,
    identityStates: { absent: 0, legacyOnly: 0, canonicalOnly: 0, agreeing: 0, conflicting: 0 },
    failures: {}, gaps: {}, commentLimit, databaseWrites: 0, modelCalls: 0, recordRepairs: 0,
    boundary: `Explicit manifest, current anonymous public-parent gate. 200-row microsecond/UUID keyset pages continue until empty, at most 100 pages/${commentLimit} posted non-bid headers per parent; overflow refuses that collection. This is a resource ceiling, not a record target or evidence of exhaustion. Separate current reads are not an immutable snapshot. Header and identity counters cover completed collections only. Metadata only, not quotes, inferred atoms, mood, expertise, independent sources, source publication or historical identity replay. Namespace label differences preserve unresolved aliases. Missing child context is unknown, never zero activity.` };
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
      const source = await commentCollection(client, id, o.until, now, emit, commentLimit); summary.inspectedParents++;
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
    const subjects = o.family !== 'price' ? lineageSubjects(JSON.parse(await readFile(o.subjects, 'utf8'))) : null;
    file = await privateOutput(o.out);
    const emit = value => file.writeFile(JSON.stringify(value) + '\n');
    await emit({ type: 'manifest', schemaVersion: 'public_reader_coverage_v2',
      assaySourceSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
      options: { ...o, env: undefined, out: undefined, subjects: undefined },
      anonymous: true, readers: o.family === 'bids' ? ['vehicles', 'vehicle_comments_unified', 'auction_comments', 'vehicle_observations', 'auction_events', 'external_identities']
        : o.family === 'comments' ? ['vehicles', 'auction_comments', 'auction_events', 'external_identities']
        : subjects ? ['vehicles', 'get_vehicle_specs', 'get_field_provenance'] : ['vehicles', 'vehicle_price_facts'],
      parentFields: subjects ? 'id,is_public,deleted_at,listing_kind' : PARENT_FIELDS,
      outputContains: 'response/page hashes, scope, clocks, counts and bounded public failure UUIDs; no raw source/comment bodies or credentials' });
    const report = o.family === 'bids' ? await runBidLineage(client, o, subjects, { ...deps, emit, progress: value => print(JSON.stringify(value)) })
      : o.family === 'comments' ? await runCommentLineage(client, o, subjects, { ...deps, emit, progress: value => print(JSON.stringify(value)) })
      : subjects ? await runSpecificationLineage(client, o, subjects, { ...deps, emit, progress: value => print(JSON.stringify(value)) })
      : await runCoverage(client, o, { ...deps, emit, progress: value => print(JSON.stringify(value)) });
    print(JSON.stringify({ status: report.status, stopReason: report.stopReason, inspectedRecords: report.inspectedRecords,
      measuredFoldRecords: report.measuredFoldRecords, recordsPerSecond: report.recordsPerSecond, failures: report.failures,
      inspectedParents: report.inspectedParents, selectedReports: report.selectedReports, matchingReports: report.matchingReports,
      measuredCommentHeaders: report.measuredCommentHeaders, identityStates: report.identityStates,
      measured: report.measured, nativeAuthorStates: report.nativeAuthorStates,
      diagnostics: report.diagnostics, gaps: report.gaps, recordRepairs: 0, verifiedRepairs: 0, databaseWrites: 0, modelCalls: 0 }));
    return report.exitCode;
  } catch (e) { print(JSON.stringify({ status: 'failed', error: e instanceof AssayError ? e.code : 'assay_initialization_or_output_failed' })); return 1; }
  finally { await file?.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
