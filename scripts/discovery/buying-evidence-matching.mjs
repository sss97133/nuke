/** Deterministic comparisons of attributed current listing reports, never asset facts. */
import { normalizeListingUrl } from '../../supabase/functions/_shared/urlNormalization.ts';

export const MATCH_VERSION = 'buying_match_v1';
const PROPERTIES = Object.freeze({
  year: ['integer', null], make: ['string', null], model: ['string', null], vin: ['string', null],
  exterior_color: ['string', null], interior_color: ['string', null], engine_configuration: ['string', null],
  engine_displacement_l: ['number', 'liters'], transmission_type: ['string', null],
  drivetrain_layout: ['string', null], mileage_miles: ['integer', 'miles'],
});
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = value => typeof value === 'string' && value.trim().length > 0;
const scalar = value => string(value) || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const normalized = value => typeof value === 'string' ? value.trim().toLowerCase() : value;
const stable = value => JSON.stringify(value, function (_key, item) {
  return object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
});
const copy = value => JSON.parse(JSON.stringify(value));
const unique = values => [...new Set(values)];

// Preserve PostgreSQL microseconds (and RFC3339 nanoseconds) instead of Date's millisecond rounding.
function instant(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m || +m[2] > 23 || +m[3] > 59 || +m[4] > 59) return null;
  const day = Date.parse(`${m[1]}T00:00:00Z`);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== m[1]) return null;
  let offset = 0;
  if (m[6] !== 'Z') {
    const hours = +m[6].slice(1, 3), minutes = +m[6].slice(4, 6);
    if (hours > 23 || minutes > 59) return null;
    offset = (hours * 60 + minutes) * (m[6][0] === '+' ? 1 : -1);
  }
  return BigInt(day + (+m[2] * 3600 + +m[3] * 60 + +m[4] - offset * 60) * 1000) * 1_000_000n
    + BigInt((m[5] || '').padEnd(9, '0'));
}

export function compareMatchInstants(left, right) {
  const a = instant(left), b = instant(right);
  return a === null || b === null ? null : compare(a, b);
}

// Keep identity query parameters and generic hash routes. Only native Craigslist share pages and
// BaT listing pages have document-section fragments. Their opaque path remains case-sensitive.
export function matchSourceUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const craigslist = ['craigslist.org', 'www.craigslist.org'].includes(url.hostname) && /^\/view\/d\//.test(url.pathname);
    if (craigslist) {
      // Reuse the existing hostname convention only; its broad query/path normalization is not
      // an episode-identity contract. Passing the origin avoids platform-like strings in tokens.
      url.hostname = new URL(normalizeListingUrl(url.origin).normalized).hostname;
    }
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || ['fbclid', 'gclid'].includes(key.toLowerCase())) url.searchParams.delete(key);
    }
    const nativePage = (craigslist && /^\/view\/d\/[^/]+\/?$/.test(url.pathname)) ||
      (['bringatrailer.com', 'www.bringatrailer.com'].includes(url.hostname) && /^\/listing\/[\w-]+\/?$/.test(url.pathname));
    if (nativePage) url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch { return null; }
}

function typed(value, type) {
  return type === 'string' ? string(value)
    : typeof value === 'number' && Number.isFinite(value) && (type !== 'integer' || Number.isInteger(value));
}

export function validateRequest(request) {
  if (!object(request) || request.schema_version !== 'buying_request_v1' || !string(request.id) || !string(request.source_ref))
    throw Error('Invalid buying request identity or schema');
  if (request.source_url !== null && !matchSourceUrl(request.source_url)) throw Error('Invalid request source URL');
  if (instant(request.observed_at) === null || instant(request.recorded_at) === null ||
      (request.valid_until !== null && instant(request.valid_until) === null)) throw Error('Invalid request clocks');
  if (!['open', 'closed', 'unknown'].includes(request.status)) throw Error('Invalid request status');
  if (!Array.isArray(request.criteria) || request.criteria.length > 64) throw Error('Request requires at most 64 criteria');
  const ids = new Set();
  for (const criterion of request.criteria) {
    if (!object(criterion) || !string(criterion.id) || ids.has(criterion.id) || !string(criterion.property_key) ||
        !string(criterion.claim_scope) || !['required', 'preferred'].includes(criterion.requirement) ||
        !(criterion.unit === null || string(criterion.unit))) throw Error('Invalid or duplicate criterion');
    ids.add(criterion.id);
    const { operator, value } = criterion;
    if (!['eq', 'in', 'gte', 'lte', 'between'].includes(operator)) throw Error('Invalid criterion operator');
    if (operator === 'in') {
      if (!Array.isArray(value) || !value.length || value.length > 64 || value.some(v => !scalar(v)) ||
          value.some(v => typeof v !== typeof value[0])) throw Error('Invalid criterion membership values');
    } else if (operator === 'between') {
      if (!Array.isArray(value) || value.length !== 2 || value.some(v => typeof v !== 'number' || !Number.isFinite(v)) ||
          value[0] > value[1]) throw Error('Invalid criterion bounds');
    } else if (!scalar(value) || (['gte', 'lte'].includes(operator) && typeof value !== 'number')) {
      throw Error('Invalid criterion comparison value');
    }
    const property = own(PROPERTIES, criterion.property_key) ? PROPERTIES[criterion.property_key] : null;
    if (property && (Array.isArray(value) ? value : [value]).some(v => !typed(v, property[0])))
      throw Error('Criterion value does not match property type');
  }
  return request;
}

function claimsFor(candidate) {
  if (!object(candidate) || !string(candidate.vehicle_id) || !string(candidate.state) ||
      !(candidate.listing_url === null || typeof candidate.listing_url === 'string') || !Array.isArray(candidate.claims) ||
      candidate.claims.length > 1000 || !object(candidate.coverage) || !string(candidate.coverage.status) ||
      (candidate.field_coverage !== undefined && !object(candidate.field_coverage)) ||
      (candidate.counterevidence !== undefined && !Array.isArray(candidate.counterevidence)) ||
      (candidate.gaps !== undefined && (!Array.isArray(candidate.gaps) || candidate.gaps.some(v => !string(v)))))
    throw Error('Invalid candidate receipt');
  const byKey = new Map(), unidentified = [];
  for (const claim of candidate.claims) {
    if (!object(claim) || !string(claim.property_key) ||
        (claim.observation_id != null && !string(claim.observation_id)) ||
        (claim.qualifiers !== undefined && !object(claim.qualifiers))) throw Error('Invalid candidate claim');
    if (!string(claim.observation_id)) { unidentified.push(claim); continue; }
    const key = stable([claim.property_key, claim.observation_id]);
    if (byKey.has(key) && stable(byKey.get(key)) !== stable(claim)) throw Error('Conflicting duplicate observation custody');
    byKey.set(key, claim);
  }
  return [...byKey.values(), ...unidentified].sort((a, b) => compare(stable(a), stable(b)));
}

function evidenceRef(claim, disposition, reasons = []) {
  return { observation_id: claim.observation_id ?? null, property_key: claim.property_key,
    property_id: claim.property_id ?? null, source_id: claim.source_id ?? null,
    source_observation_id: claim.source_observation_id ?? null, extraction_method: claim.extraction_method ?? null,
    value: copy(claim.value ?? null), unit: claim.unit ?? null, source_url: claim.source_url ?? null,
    observed_at: claim.observed_at ?? null, ingested_at: claim.ingested_at ?? null,
    qualifiers: copy(claim.qualifiers ?? {}), disposition, reasons };
}

function admission(claim, candidate, criterion, cutoff) {
  const reasons = [], property = PROPERTIES[criterion.property_key];
  if (!string(claim.observation_id)) reasons.push('missing_observation_id');
  const source = matchSourceUrl(claim.source_url), listing = matchSourceUrl(candidate.listing_url);
  if (!source) reasons.push('missing_source_attribution');
  if (!listing) reasons.push('listing_identity_unknown');
  if (source && listing && source !== listing) reasons.push('different_listing_episode');
  if (claim.qualifiers?.claim_role !== 'listing_claim') reasons.push('listing_claim_role_unestablished');
  for (const field of ['observed_at', 'ingested_at']) {
    const at = instant(claim[field]);
    if (at === null) reasons.push(`${field}_unknown`);
    else if (at > cutoff) reasons.push(`${field}_after_cutoff`);
  }
  if (claim.unit !== property[1]) reasons.push('claim_unit_unsupported');
  if (!typed(claim.value, property[0])) reasons.push('claim_value_type_unsupported');
  if (claim.qualifiers?.value_is_approximate === true) reasons.push('approximate_value_without_bounds');
  return reasons;
}

function satisfies(value, criterion) {
  const left = normalized(value), right = criterion.value;
  switch (criterion.operator) {
    case 'eq': return left === normalized(right);
    case 'in': return right.some(v => left === normalized(v));
    case 'gte': return left >= right;
    case 'lte': return left <= right;
    case 'between': return left >= right[0] && left <= right[1];
  }
}

function evaluateCriterion(criterion, candidate, claims, cutoff, refused) {
  const result = { criterion_id: criterion.id, property_key: criterion.property_key,
    requirement: criterion.requirement, operator: criterion.operator, value: copy(criterion.value), unit: criterion.unit,
    claim_scope: criterion.claim_scope, status: 'unknown', reasons: [], evidence: [] };
  if (refused) { result.reasons.push(refused); return result; }
  if (!own(PROPERTIES, criterion.property_key)) result.reasons.push('unsupported_property');
  if (criterion.claim_scope !== 'listing_report') result.reasons.push('unsupported_claim_scope');
  const property = own(PROPERTIES, criterion.property_key) ? PROPERTIES[criterion.property_key] : null;
  if (property && criterion.unit !== property[1]) result.reasons.push('unsupported_request_unit');
  if (result.reasons.length) return result;
  const field = candidate.field_coverage?.[criterion.property_key];
  if (field !== undefined && (!object(field) || !string(field.status) ||
      (field.reasons !== undefined && (!Array.isArray(field.reasons) || field.reasons.some(v => !string(v)))) ||
      (field.conflict !== undefined && typeof field.conflict !== 'boolean'))) throw Error('Invalid field coverage');
  const admitted = [];
  for (const claim of claims.filter(c => c.property_key === criterion.property_key)) {
    const reasons = admission(claim, candidate, criterion, cutoff);
    result.evidence.push(evidenceRef(claim, reasons.length ? 'excluded' : 'admitted', reasons));
    if (!reasons.length) admitted.push(claim);
  }
  if (field?.conflict === true) {
    result.status = 'conflict'; result.reasons.push('reader_reports_conflict', ...(field.reasons || []));
    for (const claim of candidate.counterevidence || []) {
      if (!object(claim) || claim.property_key !== criterion.property_key) continue;
      result.evidence.push(evidenceRef(claim, 'counterevidence_unadjudicated'));
    }
  } else if (new Set(admitted.map(c => stable(normalized(c.value)))).size > 1) {
    result.status = 'conflict'; result.reasons.push('distinct_listing_reports');
  } else if ((field?.status ?? candidate.coverage.status) !== 'complete_current_reader') {
    result.reasons.push('incomplete_current_reader', ...(field?.reasons || []));
  } else if (!admitted.length) {
    result.reasons.push('no_admissible_listing_report');
  } else {
    result.status = satisfies(admitted[0].value, criterion) ? 'met' : 'unmet';
    result.reasons.push(result.status === 'met' ? 'listing_report_satisfies_criterion' : 'listing_report_contradicts_criterion');
  }
  result.reasons = unique(result.reasons);
  result.evidence.sort((a, b) => compare(stable(a), stable(b)));
  return result;
}

export function evaluateRequest(request, candidates, cutoff) {
  validateRequest(request);
  const at = instant(cutoff);
  if (at === null) throw Error('Invalid evaluation cutoff');
  if (!Array.isArray(candidates) || candidates.length > 200) throw Error('Supply at most 200 candidates');
  const reasons = [];
  if (request.status !== 'open') reasons.push(`request_${request.status}`);
  if (instant(request.observed_at) > at) reasons.push('request_observed_after_cutoff');
  if (instant(request.recorded_at) > at) reasons.push('request_recorded_after_cutoff');
  if (request.valid_until !== null && instant(request.valid_until) <= at) reasons.push('request_expired');
  const seen = new Set();
  const results = candidates.map(candidate => {
    const claims = claimsFor(candidate), key = stable([candidate.vehicle_id, matchSourceUrl(candidate.listing_url)]);
    if (seen.has(key)) throw Error('Duplicate candidate episode');
    seen.add(key);
    const refusal = reasons.length ? 'request_not_active'
      : candidate.state !== 'public_current_parent' ? 'public_parent_unavailable' : null;
    const criteria = request.criteria.map(c => evaluateCriterion(c, candidate, claims, at, refusal));
    const required = criteria.filter(c => c.requirement === 'required');
    const fit = refusal ? 'refused' : required.some(c => c.status === 'unmet') ? 'criteria_unmet'
      : required.length && required.every(c => c.status === 'met') ? 'criteria_met' : 'needs_evidence';
    return { vehicle_id: candidate.vehicle_id, listing_url: candidate.listing_url, fit, availability: 'unassessed',
      criteria, gaps: unique([...(candidate.gaps || []), ...(!required.length ? ['no_required_criteria'] : []),
        ...(refusal ? [refusal] : [])]), coverage: copy(candidate.coverage) };
  });
  const tiers = { criteria_met: 0, needs_evidence: 1, criteria_unmet: 2, refused: 3 };
  results.sort((a, b) => tiers[a.fit] - tiers[b.fit] || compare(a.vehicle_id, b.vehicle_id)
    || compare(a.listing_url ?? '', b.listing_url ?? ''));
  return { schema_version: MATCH_VERSION, cutoff, request_id: request.id,
    request_state: reasons.length ? 'refused' : 'declared_open', request_reasons: reasons,
    scope: 'captured_current_reader_input', availability: 'unassessed',
    claim_scope: 'attributed_listing_reports_not_verified_configuration_or_true_mileage',
    comparison_semantics: 'typed_values_case_insensitive_trimmed_strings_no_alias_or_unit_inference',
    candidates: results, summary: Object.fromEntries(['criteria_met', 'needs_evidence', 'criteria_unmet', 'refused']
      .map(fit => [fit, results.filter(candidate => candidate.fit === fit).length])) };
}
