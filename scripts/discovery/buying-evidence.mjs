#!/usr/bin/env node
/** Private, read-only retained-evidence finder. No intake, scoring, or inference.
 * Node >=22.18. See buying-evidence.md for scope and receipt semantics.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, realpathSync, existsSync } from 'node:fs';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { extractDescription } from '../../supabase/functions/_shared/batParser.ts';
import { validateRequest, evaluateRequest, compareMatchInstants, matchSourceUrl } from './buying-evidence-matching.mjs';

export const VERSION = 'buying-evidence-v1';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const run = promisify(execFile);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 32_000, MAX_JSON = 64_000, MAX_BODY = 4_194_304;
const sha = value => createHash('sha256').update(value).digest('hex');
const stamp = () => new Date().toISOString();
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
export const MATCH_CAPTURE_VERSION = 'buying_match_capture_v1';
const MATCH_KEYS = new Set(['year', 'make', 'model', 'vin', 'exterior_color', 'interior_color',
  'engine_configuration', 'engine_displacement_l', 'transmission_type', 'drivetrain_layout', 'mileage_miles']);

// Search vocabulary, not a fact/property schema. Extend from reviewed misses.
export const FACETS = {
  maintenance: /\b(?:maint(?:enance|ained)?|servic\w*|receipts?|records?|oil\s+chang\w*|replac\w*|rebuil\w*|repair\w*|timing\s+(?:belt|chain)|water\s+pump|heater\s+core|brakes?|tires?|tyres?|clutch)\b/gi,
  unresolved_work: /\b(?:needs?|due|overdue|inoperative|doesn['’]t\s+work|not\s+working|bypass\w*|leak\w*|misfir\w*|overheat\w*|smok\w*|noise|vibrat\w*|check\s+engine|warning\s+light|defrost|a\/c)\b/gi,
  mileage: /\b(?:odometer|mileage|miles?|kilomet(?:er|re)s?|\d+(?:[,.]\d+)?\s*k\s*(?:mi|mile|km)|tmu|actual\s+miles?|rolled\s+over)\b/gi,
  usage: /\b(?:tow\w*|haul\w*|commut\w*|daily\s+driv\w*|highway|short\s+trips?|off[- ]road|idle\w*|fleet|commercial|work\s+truck|farm|plow\w*|raced?|track\s+use)\b/gi,
  storage: /\b(?:stor(?:ed|age)|garage\w*|carport|sitting|sat\s+(?:for|since)|parked|covered|indoors?|outdoors?)\b/gi,
  exposure: /\b(?:salt\w*|coast\w*|snow|winter|humid\w*|flood\w*|desert|climate|weather|sun\s+damage|road\s+salt|dry\s+state)\b/gi,
  condition: /\b(?:rust\w*|corro\w*|rot|undercoat\w*|undercarriage|frame|wear|worn|crack\w*|dent\w*|scratch\w*|repaint\w*|paint|damage\w*|accident|collision)\b/gi,
  ownership: /\b(?:own(?:er|ers|ed|ership)?|bought|purchased|acquir\w*|sold|title|previous|since\s+\d{4})\b/gi,
};

export function sourceUrl(value) {
  try {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    for (const key of [...u.searchParams.keys()])
      if (/^utm_/i.test(key) || ['fbclid', 'gclid'].includes(key)) u.searchParams.delete(key);
    u.hash = '';
    return u.toString().replace(/\/+$/, '');
  } catch { return null; }
}

// Code-point offsets deliberately match Array.from(text), including emoji.
export function findExcerpts(text, query = null) {
  if (typeof text !== 'string' || text.length > MAX_TEXT) return { state: 'oversized_or_invalid', hits: [] };
  const hits = [];
  // Keep punctuation in the exact source region; no paraphrase or rewritten quote.
  const pieces = text.matchAll(/[\s\S]+?(?:[.!?]+(?=\s|$)|\n|$)/gu);
  for (const piece of pieces) {
    const quote = piece[0];
    const facets = Object.entries(FACETS).flatMap(([name, regex]) => {
      regex.lastIndex = 0;
      const terms = [...quote.matchAll(regex)].map(m => m[0]);
      return terms.length ? [{ name, terms: [...new Set(terms)] }] : [];
    });
    const queryMatched = query !== null && quote.toLowerCase().includes(query.toLowerCase());
    if (query === null ? !facets.length : !queryMatched) continue;
    const start = Array.from(text.slice(0, piece.index)).length;
    hits.push({ quote, start, end: start + Array.from(quote).length,
      offset_unit: 'unicode_code_points', facets, query_matched: queryMatched,
      stage: 'lexical_candidate', review_flags: [
        ...(quote.includes('?') ? ['question_present'] : []),
        ...(/\b(?:if|would|could|should|might|assuming)\b/i.test(quote) ? ['conditional_or_uncertain_language'] : []),
        ...(/\b(?:no|not|never|without|unknown|unsure|don['’]t)\b/i.test(quote) ? ['negation_or_unknown_language'] : []),
        ...(/\b(?:these|those|all\s+of|million[- ]mile|run\s+forever|my\s+other)\b/i.test(quote) ? ['subject_scope_needs_review'] : []),
      ] });
  }
  return { state: 'searched', hits };
}

export function validateOptions(options) {
  if (!Array.isArray(options.vehicleIds) || options.vehicleIds.length < 1 || options.vehicleIds.length > 10 ||
      options.vehicleIds.some(id => !uuid.test(id)) || new Set(options.vehicleIds).size !== options.vehicleIds.length)
    throw Error('Supply 1..10 distinct vehicle UUIDs');
  for (const [key, low, high] of [['pageSize', 1, 200], ['maxPages', 1, 10], ['seconds', 10, 300]])
    if (!Number.isInteger(options[key]) || options[key] < low || options[key] > high) throw Error(`Invalid ${key}`);
  if (options.query !== null && (typeof options.query !== 'string' || !options.query.trim() || options.query.length > 100))
    throw Error('Query must be a nonempty literal string of at most 100 characters');
  return options;
}

export function collectionSQL(family, vehicle, cutoff, pageSize, after = null) {
  if (!uuid.test(vehicle.id) || (after !== null && !uuid.test(after)) || !Number.isFinite(Date.parse(cutoff)) ||
      !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) throw Error('Invalid read boundary');
  const parent = `EXISTS (SELECT 1 FROM public.vehicles p WHERE p.id=${literal(vehicle.id)}::uuid
    AND p.is_public IS TRUE AND p.deleted_at IS NULL AND p.listing_kind IS DISTINCT FROM 'non_vehicle_item')`;
  const cursor = after ? `AND id > ${literal(after)}::uuid` : '';
  const body = field => `CASE WHEN octet_length(${field})<=${MAX_TEXT} THEN ${field} END`;
  const json = field => `CASE WHEN octet_length(${field}::text)<=${MAX_JSON} THEN ${field} END`;
  const base = `vehicle_id=${literal(vehicle.id)}::uuid AND ${parent} ${cursor}`;
  const recorded = `(created_at<=${literal(cutoff)}::timestamptz OR created_at IS NULL)`;
  let sql;
  if (family === 'comments') sql = `SELECT id,vehicle_id,source_url,auction_event_id,posted_at,created_at,
    external_identity_id,author_external_identity_id,is_seller,comment_type,bat_comment_id,
    ${body('comment_text')} AS comment_text,octet_length(comment_text) AS text_bytes
    FROM public.auction_comments WHERE ${base} AND ${recorded}
    AND (posted_at<=${literal(cutoff)}::timestamptz OR posted_at IS NULL)
    ORDER BY id LIMIT ${pageSize}`;
  else if (family === 'observations') sql = `SELECT id,vehicle_id,kind,source_url,source_vehicle_event_id,
    source_snapshot_id,raw_source_ref,source_observation_id,observed_at,ingested_at,extraction_method,
    structured_data->'is_inferred' AS agent_inferred,${body('content_text')} AS content_text,octet_length(content_text) AS text_bytes,
    ${json('structured_data')} AS structured_data,octet_length(structured_data::text) AS structured_bytes
    FROM public.vehicle_observations WHERE ${base} AND subject_type='vehicle'
    AND is_superseded IS NOT TRUE AND public.observation_is_public(kind,structured_data)
    AND kind::text IN ('listing','condition','specification','work_record','ownership','service','provenance')
    AND (ingested_at<=${literal(cutoff)}::timestamptz OR ingested_at IS NULL)
    AND (observed_at<=${literal(cutoff)}::timestamptz OR observed_at IS NULL)
    ORDER BY id LIMIT ${pageSize}`;
  else if (family === 'images') sql = `SELECT id,vehicle_id,source_url,image_url,taken_at,created_at,
    source,is_document,is_duplicate,vision_gate_status,image_vehicle_match_status,vision_analyzed_at,
    vision_model_version,${json('ai_extractions')} AS ai_extractions,
    octet_length(ai_extractions::text) AS structured_bytes
    FROM public.vehicle_images WHERE ${base} AND ${recorded}
    AND is_sensitive IS FALSE AND is_superseded IS NOT TRUE
    ORDER BY id LIMIT ${pageSize}`;
  else if (family === 'snapshots') {
    const urls = [...new Set([vehicle.listing_url, vehicle.bat_auction_url, vehicle.discovery_url]
      .map(sourceUrl).filter(Boolean))];
    // Equality probes use the existing URL index; retain separate URL/episode captures.
    const forms = urls.flatMap(url => [url, `${url}/`]);
    sql = `SELECT id,listing_url,platform,fetched_at,created_at,success,http_status,html_sha256,
      html_storage_path,metadata->>'vehicle_id' AS attested_vehicle_id,
      metadata->>'vehicle_matched' AS vehicle_matched,
      CASE WHEN octet_length(html)<=${MAX_BODY} THEN html END AS html,octet_length(html) AS html_bytes
      FROM public.listing_page_snapshots WHERE ${parent} AND ${forms.length ? `listing_url IN (${forms.map(literal).join(',')})` : 'false'}
      ${cursor} AND ${recorded} AND fetched_at<=${literal(cutoff)}::timestamptz ORDER BY id LIMIT ${pageSize}`;
  } else throw Error('Unknown collection');
  return `BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; ${sql}; COMMIT;`;
}

async function querySQL(sql, deadline, qsh) {
  const remaining = deadline - Date.now();
  if (remaining < 1) throw Error('deadline');
  try {
    const result = await run(qsh, [sql], { timeout: Math.min(remaining, 12_000), maxBuffer: 12_000_000 });
    if (Buffer.byteLength(result.stdout) > 10_000_000) throw Error('response_budget');
    const data = JSON.parse(result.stdout);
    if (!Array.isArray(data) || data.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw Error('invalid_rows');
    return data;
  } catch {
    // q.sh errors can echo SQL or private testimony; never print its stderr.
    throw Error(Date.now() >= deadline ? 'deadline' : 'read_failed');
  }
}

export async function collect(options, query) {
  validateOptions(options);
  const startedAt = stamp(), cutoff = startedAt, deadline = Date.now() + options.seconds * 1000;
  const capture = { schema_version: VERSION, started_at: startedAt, selection_cutoff: cutoff,
    snapshot_semantics: 'separate_current_reads_not_historical_replay', options, vehicles: [], reads: [] };
  const failures = {};
  for (const id of options.vehicleIds) {
    const parentSQL = `BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SELECT id,year,make,model,mileage,
      listing_url,bat_auction_url,discovery_url FROM public.vehicles WHERE id=${literal(id)}::uuid
      AND is_public IS TRUE AND deleted_at IS NULL AND listing_kind IS DISTINCT FROM 'non_vehicle_item'; COMMIT;`;
    let parents;
    try { parents = await query(parentSQL, deadline); }
    catch { capture.vehicles.push({ id, state: 'parent_read_failed', collections: {} }); continue; }
    if (parents.length !== 1 || parents[0].id !== id) {
      capture.vehicles.push({ id, state: 'parent_unavailable', collections: {} }); continue;
    }
    const vehicle = { ...parents[0], state: 'public_current_parent', collections: {} };
    capture.vehicles.push(vehicle);
    for (const family of ['comments', 'observations', 'images', 'snapshots']) {
      const collection = { state: 'partial', pages: 0, rows: [], reason: 'page_budget' };
      vehicle.collections[family] = collection;
      if ((failures[family] || 0) >= 2) { collection.reason = 'repeated_read_failure_stop'; continue; }
      let after = null;
      for (let page = 0; page < options.maxPages; page++) {
        const sql = collectionSQL(family, vehicle, cutoff, options.pageSize, after);
        let rows;
        const readStart = stamp();
        try { rows = await query(sql, deadline); }
        catch (error) {
          collection.reason = error.message === 'deadline' ? 'deadline' : 'read_failed';
          if (collection.reason === 'read_failed') failures[family] = (failures[family] || 0) + 1;
          break;
        }
        failures[family] = 0;
        capture.reads.push({ vehicle_id: id, family, started_at: readStart, ended_at: stamp(),
          query_sha256: sha(sql), rows_sha256: sha(JSON.stringify(rows)), returned_rows: rows.length });
        collection.pages++;
        if (rows.length > options.pageSize || rows.some((row, i) => !uuid.test(row.id) ||
            (i ? row.id <= rows[i - 1].id : after !== null && row.id <= after) ||
            (family !== 'snapshots' && row.vehicle_id !== id))) {
          collection.reason = 'invalid_page'; break;
        }
        if (!rows.length) { collection.state = 'exhausted_selected_scope'; collection.reason = null; break; }
        collection.rows.push(...rows);
        after = rows.at(-1).id;
      }
    }
  }
  capture.ended_at = stamp();
  return capture;
}

// This mode consumes the existing public readers. Record metadata is only a label;
// it cannot fill a missing claim. An anonymous role also applies to operator reads.
export function matchingSQL(kind, ids, property = null) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 10 || ids.some(id => !uuid.test(id)) ||
      new Set(ids).size !== ids.length) throw Error('Invalid matching subjects');
  const keys = ids.map(id => `${literal(id)}::uuid`).join(',');
  const gate = `v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'`;
  let sql;
  if (kind === 'parents') sql = `SELECT v.id,v.year,v.make,v.model,v.listing_url,v.discovery_url,v.bat_auction_url
    FROM public.vehicles v WHERE v.id IN (${keys}) AND ${gate} ORDER BY v.id`;
  else if (kind === 'specifications') sql = `SELECT m AS model FROM public.get_vehicle_specs(ARRAY[${keys}],true) m`;
  else if (kind === 'provenance' && ids.length === 1 && MATCH_KEYS.has(property))
    sql = `SELECT public.get_field_provenance(v.id,${literal(property)}) AS provenance
      FROM public.vehicles v WHERE v.id=${keys} AND ${gate}`;
  else throw Error('Invalid matching reader');
  return `BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SET LOCAL ROLE anon; ${sql}; COMMIT;`;
}

function provenanceValue(value, claim) {
  if (claim.data_type === 'integer' || claim.data_type === 'numeric') {
    if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return undefined;
    const number = Number(value);
    return Number.isFinite(number) && (claim.data_type !== 'integer' || Number.isSafeInteger(number)) ? number : undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

export function reconcileMatchingField(claims, provenance, property, vehicleId, listingUrl, cutoff) {
  const result = { claims: [], counterevidence: [], coverage: { status: 'unavailable', reasons: [] } };
  if (!provenance || provenance.vehicle_id !== vehicleId || provenance.field !== property ||
      provenance.coverage?.status !== 'complete_current_reader' || !Array.isArray(provenance.observations)) {
    result.coverage.reasons.push('provenance_incomplete_or_wrong_subject');
    return result;
  }
  result.coverage.status = 'complete_current_reader';
  for (const claim of claims.filter(c => c.property_key === property)) {
    const witnesses = provenance.observations.filter(o => o.id === claim.observation_id);
    if (claim.status !== 'current_canonical_claim' || witnesses.length !== 1) {
      result.coverage.status = 'unavailable'; result.coverage.reasons.push('canonical_claim_custody_missing'); continue;
    }
    const witness = witnesses[0];
    if (provenanceValue(witness.value, claim) !== claim.value || witness.source_url !== claim.source_url ||
        witness.observed_at !== claim.observed_at || witness.ingested_at !== claim.ingested_at ||
        witness.claim_role !== claim.qualifiers?.claim_role) {
      result.coverage.status = 'unavailable'; result.coverage.reasons.push('canonical_claim_changed_between_reads'); continue;
    }
    // Retain disclosures present only in the provenance drill (e.g. broken odometer).
    result.claims.push({ ...claim, qualifiers: { ...claim.qualifiers,
      odometer_broken: witness.odometer_broken ?? null, odometer_rolled_over: witness.odometer_rolled_over ?? null } });
    if (['observed_at', 'ingested_at'].some(key => {
      const order = compareMatchInstants(claim[key], cutoff); return order === null || order > 0;
    })) continue;
    if (!matchSourceUrl(listingUrl) || matchSourceUrl(claim.source_url) !== matchSourceUrl(listingUrl)) continue;
    for (const alternative of provenance.observations) {
      if (alternative.id === claim.observation_id || !matchSourceUrl(listingUrl) ||
          matchSourceUrl(alternative.source_url) !== matchSourceUrl(listingUrl)) continue;
      const value = provenanceValue(alternative.value, claim);
      if (value === claim.value) continue;
      const clocks = ['observed_at', 'ingested_at'].map(key => compareMatchInstants(alternative[key], cutoff));
      if (clocks.some(order => order === 1)) continue;
      if (clocks.some(order => order === null)) {
        result.coverage.status = 'unavailable'; result.coverage.reasons.push('counterevidence_clock_unknown');
        continue;
      }
      // An alternative is counterevidence, never a newly admitted typed claim.
      // A changing reading/finish may be history; the reader does not adjudicate it.
      result.counterevidence.push({ ...alternative, property_key: property, observation_id: alternative.id,
        value: alternative.value, interpretation: 'same_listing_report_variation_unadjudicated' });
    }
  }
  result.coverage.conflict = result.counterevidence.length > 0;
  if (result.coverage.conflict) result.coverage.reasons.push('same_listing_report_variation_unadjudicated');
  return result;
}

export async function collectMatching(options, request, query) {
  validateOptions(options); validateRequest(request);
  const startedAt = stamp(), deadline = Date.now() + options.seconds * 1000;
  const capture = { schema_version: MATCH_CAPTURE_VERSION, started_at: startedAt, selection_cutoff: startedAt,
    snapshot_semantics: 'separate_current_public_reads_not_historical_replay', options, request,
    request_sha256: sha(JSON.stringify(request)), candidates: [], reads: [] };
  const read = async (kind, ids, property = null) => {
    const sql = matchingSQL(kind, ids, property), start = stamp();
    const rows = await query(sql, deadline);
    capture.reads.push({ kind, property_key: property, vehicle_ids: ids, started_at: start, ended_at: stamp(),
      query_sha256: sha(sql), rows_sha256: sha(JSON.stringify(rows)), returned_rows: rows.length });
    return rows;
  };
  let parents, models;
  try { parents = await read('parents', options.vehicleIds); }
  catch { parents = []; }
  if (!Array.isArray(parents) || parents.some(p => !options.vehicleIds.includes(p.id)) ||
      new Set(parents.map(p => p.id)).size !== parents.length) throw Error('Invalid matching parent page');
  // A denied parent never gets a specification or provenance call.
  try { models = parents.length ? await read('specifications', parents.map(p => p.id)) : []; }
  catch { models = []; }
  if (!Array.isArray(models) || models.some(r => !parents.some(p => p.id === r.model?.vehicle_id)) ||
      new Set(models.map(r => r.model.vehicle_id)).size !== models.length) throw Error('Invalid specification page');
  const properties = [...new Set(request.criteria.map(c => c.property_key))].filter(k => MATCH_KEYS.has(k));
  let failures = 0;
  for (const id of options.vehicleIds) {
    const parent = parents.find(p => p.id === id), model = models.find(m => m.model.vehicle_id === id)?.model;
    const candidate = { vehicle_id: id, state: parent && model ? 'public_current_parent' : 'parent_or_model_unavailable',
      listing_url: parent ? matchSourceUrl(parent.listing_url || parent.discovery_url || parent.bat_auction_url) : null,
      listing_selection_basis: 'current_record_url_not_verified_availability',
      record_label: parent ? [parent.year, parent.make, parent.model].filter(v => v != null).join(' ') : null,
      claims: [], field_coverage: {}, counterevidence: [], gaps: [],
      coverage: { status: 'unavailable' }, availability: 'unassessed' };
    capture.candidates.push(candidate);
    if (!parent || !model || model.schema_version !== 'vehicle_data_model_v1' ||
        model.typed_claims_status !== 'current_core_scope_read' || !Array.isArray(model.typed_claims)) {
      candidate.gaps.push('public_specification_model_unavailable'); continue;
    }
    for (const property of properties) {
      if (failures >= 2) {
        candidate.field_coverage[property] = { status: 'unavailable', reasons: ['repeated_provenance_read_failure_stop'] }; continue;
      }
      let rows;
      try { rows = await read('provenance', [id], property); failures = 0; }
      catch {
        failures++; candidate.field_coverage[property] = { status: 'unavailable', reasons: ['provenance_read_failed'] }; continue;
      }
      const field = reconcileMatchingField(model.typed_claims, rows.length === 1 ? rows[0].provenance : null,
        property, id, candidate.listing_url, capture.selection_cutoff);
      candidate.claims.push(...field.claims); candidate.counterevidence.push(...field.counterevidence);
      candidate.field_coverage[property] = field.coverage;
    }
    candidate.coverage.status = properties.every(k => candidate.field_coverage[k]?.status === 'complete_current_reader')
      ? 'complete_current_reader' : 'unavailable';
  }
  capture.ended_at = stamp();
  return capture;
}

export function buildMatchingReport(capture) {
  if (capture.schema_version !== MATCH_CAPTURE_VERSION || !Array.isArray(capture.candidates) ||
      capture.request_sha256 !== sha(JSON.stringify(capture.request))) throw Error('Invalid matching capture');
  const result = evaluateRequest(capture.request, capture.candidates, capture.selection_cutoff);
  return { ...result, request: capture.request, request_sha256: capture.request_sha256,
    retrieval_started_at: capture.started_at, retrieval_ended_at: capture.ended_at,
    snapshot_semantics: capture.snapshot_semantics,
    population: { grain: 'explicit_candidate_record_and_selected_listing_url', selected: capture.options.vehicleIds.length,
      selection: 'operator_supplied_vehicle_ids', market_total: null, market_coverage: 'unmeasured' },
    labels: Object.fromEntries(capture.candidates.map(c => [c.vehicle_id, c.record_label])),
    interpretation: 'Matches stated requirements against retained listing claims. Physical configuration, current availability, profit and independent source corroboration are unestablished.',
    model_calls: 0, database_writes: 0 };
}

function strings(value, path = '', output = [], depth = 0) {
  if (depth > 12) { output.push({ path, gap: 'structured_depth_budget' }); return output; }
  if (typeof value === 'string') output.push({ path, text: value });
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}/${i}`, output, depth + 1));
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value))
    strings(item, `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`, output, depth + 1);
  return output;
}

export function documentRegions(family, row, vehicle) {
  const regions = [], gaps = [];
  const region = (path, text, basis, method = null) => {
    if (typeof text !== 'string' || !text.trim()) return;
    if (text.length > MAX_TEXT) { gaps.push({ reason: 'text_budget', path }); return; }
    regions.push({ path, text, basis, method, text_sha256: sha(text) });
  };
  if (row.text_bytes > MAX_TEXT || row.structured_bytes > MAX_JSON) gaps.push({ reason: 'source_field_budget' });
  if (family === 'comments') {
    if (row.comment_type === 'bid') return { regions, gaps, excluded: 'bid' };
    region('/comment_text', row.comment_text, 'source_comment');
  } else if (family === 'observations') {
    const method = row.extraction_method || null;
    region('/content_text', row.content_text, 'retained_observation_text', method);
    for (const item of strings(row.structured_data, '/structured_data')) {
      if (item.gap) { gaps.push({ reason: item.gap, path: item.path }); continue; }
      region(item.path, item.text, /\/(raw_description|description|quote)$/.test(item.path)
        ? 'retained_text_field_custody_needs_review' : 'existing_extraction', method);
    }
  } else if (family === 'images') {
    for (const item of strings(row.ai_extractions, '/ai_extractions')) {
      if (item.gap) { gaps.push({ reason: item.gap, path: item.path }); continue; }
      region(item.path, item.text, 'existing_image_extraction_unverified', row.vision_model_version || null);
    }
    if (!regions.length) gaps.push({ reason: 'image_ai_extractions_has_no_searchable_text', path: '/ai_extractions' });
  } else if (family === 'snapshots') {
    if (row.attested_vehicle_id !== vehicle.id || row.vehicle_matched !== 'true')
      gaps.push({ reason: 'capture_vehicle_binding_unverified' });
    else if (!row.html) gaps.push({ reason: row.html_bytes > MAX_BODY ? 'capture_body_budget' :
      row.html_storage_path ? 'offloaded_capture_locator_only' : 'capture_body_unavailable' });
    else if (row.success !== true || row.http_status < 200 || row.http_status >= 300 || row.platform !== 'bat')
      gaps.push({ reason: 'capture_status_or_parser_unqualified' });
    else if (!/^[0-9a-f]{64}$/i.test(row.html_sha256 || '') || sha(row.html) !== row.html_sha256.toLowerCase())
      gaps.push({ reason: 'capture_digest_mismatch_or_unknown' });
    else {
      const text = extractDescription(row.html);
      if (text) region('/html:batParser.extractDescription', text, 'verified_capture_parser_region', 'batParser:1.0.0');
      else gaps.push({ reason: 'description_region_unavailable' });
      // Parser selects a region, not necessarily all prose on the source page.
      gaps.push({ reason: 'parser_region_completeness_unestablished' });
    }
  }
  return { regions, gaps, excluded: null };
}

export function buildReport(capture, query = null) {
  if (capture.schema_version !== VERSION || !Array.isArray(capture.vehicles)) throw Error('Invalid capture version');
  const vehicles = capture.vehicles.map(vehicle => {
    const candidates = [], gaps = [], documents = [], facets = {};
    for (const [family, collection] of Object.entries(vehicle.collections)) {
      if (collection.state !== 'exhausted_selected_scope') gaps.push({ family, reason: collection.reason || 'incomplete_read' });
      for (const row of collection.rows) {
        const found = documentRegions(family, row, vehicle);
        const sourceRef = `${family === 'comments' ? 'auction_comments' : family === 'observations' ?
          'vehicle_observations' : family === 'images' ? 'vehicle_images' : 'listing_page_snapshots'}:${row.id}`;
        const support = { source_ref: sourceRef, source_url: row.source_url || row.listing_url || null,
          native_comment_id: row.bat_comment_id || null,
          episode_id: row.auction_event_id || row.source_vehicle_event_id || null,
          event_at: family === 'comments' ? row.posted_at || null : family === 'observations' ? row.observed_at || null : null,
          recorded_at: row.ingested_at || row.created_at || null,
          captured_at: family === 'snapshots' ? row.fetched_at || null : null,
          image_taken_at_recorded: family === 'images' ? row.taken_at || null : null,
          event_clock_basis: family === 'comments' ? 'source_posted_at' : family === 'observations' ?
            'observation_writer_basis_needs_review' : 'source_event_time_unknown',
          author_identity_id: row.external_identity_id || null,
          legacy_author_identity_id: row.author_external_identity_id || null,
          is_seller_recorded: row.is_seller ?? null,
          agent_inferred_recorded: row.agent_inferred ?? null,
          raw_source_ref: row.raw_source_ref || null,
          source_observation_id: row.source_observation_id || null,
          source_snapshot_id: row.source_snapshot_id || null,
          owner_relation: 'unestablished',
          image_gate: row.vision_gate_status || null, image_match: row.image_vehicle_match_status || null };
        documents.push({ ...support, searched_regions: found.regions.length, excluded: found.excluded,
          source_completeness: 'unknown' });
        for (const gap of found.gaps) gaps.push({ ...gap, source_ref: sourceRef, family });
        for (const item of found.regions) {
          const result = findExcerpts(item.text, query);
          for (const hit of result.hits) {
            candidates.push({ ...support, ...hit, path: item.path, basis: item.basis, method: item.method,
              text_sha256: item.text_sha256,
              // Identical text is a cluster for review, never an independent witness vote.
              duplicate_text_key: sha(`${vehicle.id}\n${hit.quote}`) });
            for (const facet of hit.facets) facets[facet.name] = (facets[facet.name] || 0) + 1;
          }
        }
      }
    }
    return { id: vehicle.id, state: vehicle.state, year: vehicle.year ?? null, make: vehicle.make ?? null,
      model: vehicle.model ?? null, mileage_current_projection: vehicle.mileage ?? null,
      mileage_unit_and_truth: 'unqualified_current_projection',
      collections: Object.fromEntries(Object.entries(vehicle.collections).map(([k, v]) =>
        [k, { state: v.state, reason: v.reason, pages: v.pages, fetched_rows: v.rows.length }])),
      facets, candidates, documents, gaps,
      next_evidence: Object.keys(FACETS).filter(key => !facets[key]).map(facet => ({ facet,
        reason: 'no_lexical_match_in_searched_regions', condition: 'unknown_not_absent' })) };
  });
  return { schema_version: VERSION, generated_at: stamp(), retrieval_started_at: capture.started_at,
    retrieval_ended_at: capture.ended_at, selection_cutoff: capture.selection_cutoff,
    snapshot_semantics: capture.snapshot_semantics, query, scope: capture.options,
    retrieval_boundary: { image_analysis_fields_searched: ['ai_extractions'],
      other_image_analysis_fields: 'not_read', raw_image_pixels: 'not_interpreted',
      snapshot_lookup: 'current_vehicle_listing_bat_and_discovery_urls_only',
      offloaded_snapshot_bodies: 'locator_only' },
    model_calls: 0, database_writes: 0, monetary_weights: 'not_estimated',
    interpretation: 'Search candidates, not verified facts, diagnostic findings, or failure probabilities. Counts are excerpts, not independent witnesses.',
    vehicles };
}

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;',
  '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const link = (url, label) => sourceUrl(url) ? `<a href="${escape(url)}" rel="noreferrer">${escape(label)}</a>` : escape(label);
export function renderReport(report) {
  if (report.schema_version === 'buying_match_v1') return renderMatchingReport(report);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
  <title>Buying evidence review</title><style>body{font:16px system-ui;max-width:1200px;margin:36px auto;padding:0 20px;color:#202623;background:#f6f6f0}h1,h2{font-weight:600}article{background:white;padding:20px;margin:20px 0;border:1px solid #ccd2c8}small{color:#536054}table{border-collapse:collapse;width:100%}td,th{padding:10px;text-align:left;border-bottom:1px solid #ddd}blockquote{margin:12px 0;padding:12px;border-left:3px solid #627558;white-space:pre-wrap}summary{cursor:pointer}code{overflow-wrap:anywhere}a{color:#315642}</style>
  <h1>Buying evidence review</h1><p>${escape(report.interpretation)}</p>
  <p>Captured ${escape(report.retrieval_started_at)} to ${escape(report.retrieval_ended_at)}. Separate current reads. No calibrated cost or reliability estimate.</p>
  <p>Image search covers the existing ai_extractions field. Other analysis fields and raw pixels are unmeasured. Offloaded page captures remain locators.</p>
  <table><tr><th>Recorded vehicle</th><th>Recorded mileage · unit unqualified</th><th>Matching excerpts</th><th>Retrieval / evidence gaps</th></tr>
  ${report.vehicles.map(v => `<tr><td>${escape([v.year, v.make, v.model].filter(Boolean).join(' ') || v.id)}</td><td>${escape(v.mileage_current_projection ?? 'unknown')}</td><td>${v.candidates.length}</td><td>${v.gaps.length} · ${escape(v.state)}</td></tr>`).join('')}</table>
  ${report.vehicles.map(v => `<article><h2>${escape([v.year, v.make, v.model].filter(Boolean).join(' ') || v.id)}</h2>
    <p>${link(`https://nuke.ag/vehicle/${v.id}`, 'Vehicle profile')} · <code>${escape(v.id)}</code></p>
    <p>Search matches: ${escape(Object.entries(v.facets).map(([k, n]) => `${k}: ${n}`).join(' · ') || 'none')}</p>
    <details><summary>Coverage and gaps</summary><pre>${escape(JSON.stringify({ collections: v.collections,
      gaps: v.gaps, next_evidence: v.next_evidence }, null, 2))}</pre></details>
    ${v.candidates.map(c => `<details><summary>${escape(c.facets.map(f => f.name).join(', ') || 'literal query')} · ${escape(c.basis)}${c.is_seller_recorded ? ' · recorded seller' : ''}</summary>
      <blockquote>${escape(c.quote)}</blockquote><p>${link(c.source_url, 'Source')} · <code>${escape(c.source_ref)}</code></p>
      <small>Posted/observed: ${escape(c.event_at ?? 'unknown')} · recorded: ${escape(c.recorded_at ?? 'unknown')} · capture: ${escape(c.captured_at ?? 'unknown')}<br>
      ${escape(c.path)} · offsets ${c.start}–${c.end} code points · ${escape(c.review_flags.join(', ') || 'semantic review required')}<br>Owner relation: unestablished. ${escape(c.event_clock_basis)}.</small></details>`).join('')}</article>`).join('')}</html>`;
}

export function renderMatchingReport(report) {
  const words = value => String(value).replaceAll('_', ' ');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
  <title>Request and listing evidence</title><style>body{font:16px Arial,sans-serif;max-width:1100px;margin:32px auto;padding:0 20px;color:#202623;background:#f6f6f0}h1,h2{font-weight:600}article{background:white;padding:20px;margin:24px 0;border:2px solid #ccd2c8}table{border-collapse:collapse;width:100%}td,th{padding:10px;text-align:left;border-bottom:1px solid #ddd;vertical-align:top}summary{cursor:pointer}pre,code{font-family:'Courier New',monospace;white-space:pre-wrap;overflow-wrap:anywhere}a{color:#315642}small{color:#536054}</style>
  <h1>Request and listing evidence</h1><p>${escape(report.interpretation)}</p>
  <p>Request <code>${escape(report.request_id)}</code> · ${escape(words(report.request_state))} · ${escape(report.request_reasons.join(', '))}</p>
  <p>${report.population.selected} selected candidates. Whole-market coverage unmeasured. Evidence captured ${escape(report.retrieval_started_at)} to ${escape(report.retrieval_ended_at)}.</p>
  <details><summary>Original request and comparison scope</summary><pre>${escape(JSON.stringify({ request: report.request, population: report.population,
    cutoff: report.cutoff, snapshot_semantics: report.snapshot_semantics }, null, 2))}</pre></details>
  ${report.candidates.map(c => `<article><h2>${escape(report.labels[c.vehicle_id] || c.vehicle_id)}</h2>
    <p><strong>${escape(words(c.fit))}</strong> · Availability unassessed</p>
    <p>${link(`https://nuke.ag/vehicle/${c.vehicle_id}`, 'Nuke record')} · ${link(c.listing_url, 'Selected source listing')}</p>
    <table><tr><th>Requirement</th><th>Result</th><th>Evidence / next question</th></tr>
    ${c.criteria.map(criterion => {
      const requested = report.request.criteria.find(r => r.id === criterion.criterion_id);
      return `<tr><td>${escape(words(criterion.property_key))}<br><small>${escape(criterion.requirement)} · ${escape(requested?.operator)} ${escape(JSON.stringify(requested?.value))} ${escape(requested?.unit || '')}</small></td>
      <td>${escape(words(criterion.status))}</td><td>${escape(criterion.reasons.map(words).join('; ') || 'Supported by the retained listing claim')}<details><summary>Source evidence</summary><pre>${escape(JSON.stringify(criterion.evidence, null, 2))}</pre></details></td></tr>`;
    }).join('')}</table><small>${escape(c.gaps.map(g => typeof g === 'string' ? words(g) : JSON.stringify(g)).join('; '))}</small></article>`).join('')}</html>`;
}

function privatePath(path) {
  let ancestor = resolve(path);
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const real = resolve(realpathSync(ancestor), relative(ancestor, resolve(path)));
  for (let check = real; ; check = dirname(check)) {
    if (existsSync(join(check, '.git'))) throw Error('Private output/cache must be outside a git checkout');
    if (check === dirname(check)) break;
  }
  for (const root of [ROOT, join(homedir(), 'nuke')].filter(existsSync)) {
    const rel = relative(realpathSync(root), real);
    if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) throw Error('Private output/cache must be outside the public checkout');
  }
  return real;
}

export async function main(args) {
  const values = {};
  let planMode = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') {
      console.log('node scripts/discovery/buying-evidence.mjs --vehicles UUID[,UUID] --out PRIVATE_DIRECTORY [--query LITERAL | --request PRIVATE_REQUEST_JSON | --plan] [--page-size 100] [--max-pages 5] [--seconds 120] [--qsh PATH]\nOffline: --cache PRIVATE_CAPTURE_JSON --out PRIVATE_DIRECTORY [--query LITERAL]'); return 0;
    }
    if (args[i] === '--plan') {
      if (planMode) throw Error('Invalid arguments; use --help');
      planMode = true; continue;
    }
    if (!['--vehicles', '--out', '--query', '--request', '--page-size', '--max-pages', '--seconds', '--qsh', '--cache'].includes(args[i]) ||
        values[args[i]] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Invalid arguments; use --help');
    values[args[i]] = args[++i];
  }
  if (!values['--out']) throw Error('--out is required');
  const destination = privatePath(values['--out']);
  if (existsSync(destination)) throw Error('Output directory must be new; existing receipts are not overwritten');
  let capture;
  const query = values['--query'] ?? null;
  if (values['--request'] && (values['--query'] || values['--cache'])) throw Error('A request selects its own live mode; replay uses the captured request');
  if (planMode && (values['--query'] || values['--request'] || values['--cache'])) throw Error('Plan mode is live only; replay detects it from the capture');
  if (values['--cache']) {
    if (values['--vehicles'] || values['--qsh']) throw Error('Cache replay does not use database arguments');
    const input = privatePath(values['--cache']);
    capture = JSON.parse(readFileSync(input, 'utf8'));
    validateOptions({ ...capture.options, query });
  } else {
    const options = validateOptions({ vehicleIds: (values['--vehicles'] || '').split(','), query,
      pageSize: Number(values['--page-size'] ?? 100), maxPages: Number(values['--max-pages'] ?? 5),
      seconds: Number(values['--seconds'] ?? 120) });
    const qsh = values['--qsh'] || join(homedir(), 'nuke/scripts/data/q.sh');
    const request = values['--request'] ? validateRequest(JSON.parse(readFileSync(privatePath(values['--request']), 'utf8'))) : null;
    const read = (sql, deadline) => querySQL(sql, deadline, qsh);
    if (planMode) {
      const plan = await import('./buying-evidence-plan.mjs');
      capture = await plan.collectPlan(options, read, plan.loadKeywordTable());
    } else capture = request ? await collectMatching(options, request, read) : await collect(options, read);
  }
  if (capture.schema_version === 'buying_plan_capture_v1') {
    if (query !== null) throw Error('Literal excerpt query does not apply to a plan capture');
    const plan = await import('./buying-evidence-plan.mjs');
    const report = plan.buildPlanReport(capture);
    mkdirSync(destination, { recursive: true, mode: 0o700 });
    for (const [file, contents] of [['capture.json', JSON.stringify(capture, null, 2)],
      ['plan.json', JSON.stringify(report, null, 2)], ['plan.txt', plan.renderPlanText(report)]])
      writeFileSync(join(destination, file), contents, { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ output: destination, vehicles: report.vehicles.length,
      ppi_items: report.vehicles.reduce((n, v) => n + v.ppi_checklist.length, 0),
      incomplete: report.vehicles.filter(v => v.state !== 'public_current_parent' || v.gaps.length).length,
      model_calls: 0, database_writes: 0 }));
    return report.vehicles.some(v => v.state !== 'public_current_parent' || v.gaps.some(g => g.reason !== 'listing_text_absent'))
      || report.rate.state !== 'as_returned' ? 2 : 0;
  }
  if (capture.schema_version === MATCH_CAPTURE_VERSION && query !== null) throw Error('Literal excerpt query does not apply to a matching capture');
  const report = capture.schema_version === MATCH_CAPTURE_VERSION ? buildMatchingReport(capture) : buildReport(capture, query);
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const [file, contents] of [['capture.json', JSON.stringify(capture, null, 2)],
    ['report.json', JSON.stringify(report, null, 2)], ['review.html', renderReport(report)]])
    writeFileSync(join(destination, file), contents, { mode: 0o600, flag: 'wx' });
  if (capture.schema_version === MATCH_CAPTURE_VERSION) {
    console.log(JSON.stringify({ output: destination, candidates: report.candidates.length, summary: report.summary,
      market_coverage: 'unmeasured', model_calls: 0, database_writes: 0 }));
    return capture.candidates.some(c => c.state !== 'public_current_parent' || c.coverage.status !== 'complete_current_reader') ? 2 : 0;
  }
  console.log(JSON.stringify({ output: destination, vehicles: report.vehicles.length,
    matching_excerpts: report.vehicles.reduce((n, v) => n + v.candidates.length, 0),
    incomplete_collections: report.vehicles.reduce((n, v) => n + Object.values(v.collections)
      .filter(c => c.state !== 'exhausted_selected_scope').length, 0), model_calls: 0, database_writes: 0 }));
  return report.vehicles.some(v => v.state !== 'public_current_parent' ||
    Object.values(v.collections).some(c => c.state !== 'exhausted_selected_scope')) ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(() => {
    console.error('Evidence finder failed; no completeness claim. Check arguments, private output path, and read access.');
    process.exitCode = 1;
  });
