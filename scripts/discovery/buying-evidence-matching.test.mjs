import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRequest, validateRequest, matchSourceUrl, compareMatchInstants } from './buying-evidence-matching.mjs';

const DATE = '2026-10-14T12:00:00.123456Z';
const OLD = '2026-10-13T12:00:00Z';
const URL = 'https://example.com/listing/123?listing_id=123';
const criterion = (changes = {}) => ({ id: 'year', property_key: 'year', operator: 'between', value: [1980, 1989],
  unit: null, requirement: 'required', claim_scope: 'listing_report', ...changes });
const request = (changes = {}) => ({ schema_version: 'buying_request_v1', id: 'explicit-wanted-request',
  source_ref: 'operator-request:1', source_url: null, observed_at: OLD, recorded_at: OLD,
  status: 'open', valid_until: null, criteria: [criterion()], ...changes });
const claim = (changes = {}) => ({ property_key: 'year', value: 1985, unit: null, observation_id: 'observation-1',
  source_url: URL, observed_at: OLD, ingested_at: OLD, qualifiers: { claim_role: 'listing_claim' }, ...changes });
const candidate = (changes = {}) => ({ vehicle_id: 'vehicle-1', listing_url: URL,
  state: 'public_current_parent', claims: [claim()], coverage: { status: 'complete_current_reader' }, gaps: [], ...changes });
const evaluate = (r = request(), c = candidate(), cutoff = DATE) => evaluateRequest(r, [c], cutoff);
const first = result => result.candidates[0];

test('source-qualified reports satisfy hard criteria without asserting availability or physical facts', () => {
  const lineage = { property_id: 'year-property', source_id: 'source-1', source_observation_id: 'source-post-1',
    extraction_method: 'retained_listing_projection_v1' };
  const output = evaluate(request(), candidate({ claims: [claim(lineage)] }));
  assert.equal(output.request_state, 'declared_open');
  assert.equal(first(output).fit, 'criteria_met');
  assert.equal(first(output).availability, 'unassessed');
  assert.equal(first(output).criteria[0].evidence[0].observation_id, 'observation-1');
  for (const [key, value] of Object.entries(lineage)) assert.equal(first(output).criteria[0].evidence[0][key], value);
  assert.match(output.claim_scope, /not_verified_configuration_or_true_mileage/);
  assert.equal(output.profit, undefined);
});

test('missing evidence remains unknown and zero hard criteria cannot produce a match', () => {
  const unknown = first(evaluate(request(), candidate({ claims: [] })));
  assert.equal(unknown.fit, 'needs_evidence');
  assert.equal(unknown.criteria[0].status, 'unknown');
  const preferredOnly = first(evaluate(request({ criteria: [criterion({ requirement: 'preferred' })] })));
  assert.equal(preferredOnly.fit, 'needs_evidence');
  assert.ok(preferredOnly.gaps.includes('no_required_criteria'));
  assert.equal(first(evaluate(request({ criteria: [] }))).fit, 'needs_evidence');
});

test('preferred mismatches do not disqualify hard fit; hard mismatch excludes even with other unknowns', () => {
  const color = criterion({ id: 'color', property_key: 'exterior_color', operator: 'eq', value: 'red', requirement: 'preferred' });
  const colorClaim = claim({ property_key: 'exterior_color', value: 'blue', observation_id: 'color-1' });
  const output = first(evaluate(request({ criteria: [criterion(), color] }), candidate({ claims: [claim(), colorClaim] })));
  assert.equal(output.fit, 'criteria_met');
  assert.equal(output.criteria[1].status, 'unmet');
  const rejected = first(evaluate(request({ criteria: [criterion(), { ...color, requirement: 'required' }] }),
    candidate({ claims: [claim({ value: 1975 })] })));
  assert.equal(rejected.fit, 'criteria_unmet');
  assert.equal(rejected.criteria[1].status, 'unknown');
});

test('hard bounds are inclusive and all typed operators operate without string coercion', () => {
  for (const [operator, value, observed, expected] of [
    ['gte', 1980, 1980, 'met'], ['lte', 1989, 1990, 'unmet'], ['between', [1980, 1989], 1989, 'met'],
    ['eq', 1985, 1985, 'met'], ['in', [1980, 1985], 1985, 'met'],
  ]) {
    const result = evaluate(request({ criteria: [criterion({ operator, value })] }), candidate({ claims: [claim({ value: observed })] }));
    assert.equal(first(result).criteria[0].status, expected);
  }
  assert.equal(first(evaluate(request(), candidate({ claims: [claim({ value: '1985' })] }))).fit, 'needs_evidence');
  assert.throws(() => validateRequest(request({ criteria: [criterion({ value: ['1980', '1989'] })] })));
});

test('trimmed case-insensitive text equality does not infer vehicle aliases', () => {
  const r = request({ criteria: [criterion({ property_key: 'make', operator: 'eq', value: 'Chevrolet' })] });
  assert.equal(first(evaluate(r, candidate({ claims: [claim({ property_key: 'make', value: ' CHEVROLET ' })] }))).fit, 'criteria_met');
  assert.equal(first(evaluate(r, candidate({ claims: [claim({ property_key: 'make', value: 'Chevy' })] }))).fit, 'criteria_unmet');
});

test('unsupported properties, scopes and units remain unknown rather than borrowing nearby fields', () => {
  for (const changes of [
    { property_key: 'price_usd', operator: 'lte', value: 20000, unit: 'USD' },
    { claim_scope: 'factory_configuration' }, { unit: 'years' },
    { property_key: '__proto__', operator: 'eq', value: 'anything' },
  ]) assert.equal(first(evaluate(request({ criteria: [criterion(changes)] }))).fit, 'needs_evidence');
});

test('source identity normalization removes tracking only and retains identity query parameters', () => {
  assert.equal(matchSourceUrl('https://example.com/listing/123/?listing_id=123&utm_source=x#reply'), `${URL}#reply`);
  assert.equal(matchSourceUrl('javascript:alert(1)'), null);
  assert.equal(matchSourceUrl('https://user:password@example.com/listing/123'), null);
  const c = candidate({ claims: [claim({ source_url: `${URL}&utm_source=email` })] });
  assert.equal(first(evaluate(request(), c)).fit, 'criteria_met');
  for (const source_url of ['https://example.com/listing/123?listing_id=456', 'https://elsewhere.com/listing/123?listing_id=123', null]) {
    const result = first(evaluate(request(), candidate({ claims: [claim({ source_url })] })));
    assert.equal(result.fit, 'needs_evidence');
    assert.equal(result.criteria[0].evidence[0].disposition, 'excluded');
  }
});

test('only the known Craigslist share-page hostname alias is normalized; opaque identity survives', () => {
  const listing = 'https://craigslist.org/view/d/AbC_123?listing_id=42';
  assert.equal(matchSourceUrl('https://www.craigslist.org/view/d/AbC_123/?listing_id=42&utm_source=x#reply'), listing);
  const matched = evaluate(request(), candidate({ listing_url: listing,
    claims: [claim({ source_url: 'https://www.craigslist.org/view/d/AbC_123?listing_id=42' })] }));
  assert.equal(first(matched).fit, 'criteria_met');
  for (const other of [
    'https://craigslist.org/view/d/abc_123?listing_id=42',
    'https://craigslist.org/view/d/AbC_456?listing_id=42',
    'https://craigslist.org/view/d/AbC_123?listing_id=43',
    'http://craigslist.org/view/d/AbC_123?listing_id=42',
    'https://craigslist.org.evil.test/view/d/AbC_123?listing_id=42',
    'https://www.craigslist.org.evil.test/view/d/AbC_123?listing_id=42',
  ]) assert.notEqual(matchSourceUrl(other), listing);
  assert.notEqual(matchSourceUrl('https://www.example.com/view/d/AbC_123'), matchSourceUrl('https://example.com/view/d/AbC_123'));
  assert.notEqual(matchSourceUrl('https://www.craigslist.org/other/AbC_123'), matchSourceUrl('https://craigslist.org/other/AbC_123'));
  assert.notEqual(matchSourceUrl('https://www.bringatrailer.com/listing/test'), matchSourceUrl('https://bringatrailer.com/listing/test'));
});

test('generic hash routes preserve identity; declared native listing sections do not change episodes', () => {
  assert.notEqual(matchSourceUrl('https://example.com/#listing1'), matchSourceUrl('https://example.com/#listing2'));
  const result = evaluate(request(), candidate({ listing_url: 'https://example.com/#listing1',
    claims: [claim({ source_url: 'https://example.com/#listing2' })] }));
  assert.equal(first(result).fit, 'needs_evidence');
  for (const listing of ['https://craigslist.org/view/d/AbC_123', 'https://bringatrailer.com/listing/1985-test']) {
    assert.equal(matchSourceUrl(`${listing}#comment-1`), matchSourceUrl(listing));
  }
  for (const base of ['https://bringatrailer.com/other/test', 'https://bringatrailer.com/listing/test/extra',
    'https://bringatrailer.com.evil.test/listing/test', 'https://craigslist.org/view/d/token/extra']) {
    assert.notEqual(matchSourceUrl(`${base}#first`), matchSourceUrl(`${base}#second`));
  }
});

test('missing attribution, claim role or source clocks cannot qualify a report', () => {
  for (const changes of [
    { observation_id: null }, { qualifiers: {} }, { qualifiers: { claim_role: 'record_metadata' } },
    { observed_at: null }, { ingested_at: null }, { observed_at: '2026-02-30T00:00:00Z' },
    { unit: 'years' },
  ]) assert.equal(first(evaluate(request(), candidate({ claims: [claim(changes)] }))).fit, 'needs_evidence');
});

test('cutoff compares microseconds and offset-equivalent clocks without rounding away future evidence', () => {
  for (const field of ['observed_at', 'ingested_at']) {
    const future = first(evaluate(request(), candidate({ claims: [claim({ [field]: '2026-10-14T12:00:00.123457Z' })] })));
    assert.equal(future.fit, 'needs_evidence');
    assert.ok(future.criteria[0].evidence[0].reasons.includes(`${field}_after_cutoff`));
    assert.equal(first(evaluate(request(), candidate({ claims: [claim({ [field]: '2026-10-14T05:00:00.123456-07:00' })] }))).fit, 'criteria_met');
  }
  assert.throws(() => evaluate(request(), candidate(), '2026-02-30T00:00:00Z'));
  assert.equal(compareMatchInstants('2026-10-14T12:00:00.123457Z', DATE), 1);
  assert.equal(compareMatchInstants('2026-10-14T05:00:00.123456-07:00', DATE), 0);
  assert.equal(compareMatchInstants(null, DATE), null);
});

test('closed, unknown, future and expired requests refuse active matches while retaining candidates', () => {
  for (const changes of [
    { status: 'closed' }, { status: 'unknown' }, { observed_at: '2026-10-15T00:00:00Z' },
    { recorded_at: '2026-10-15T00:00:00Z' }, { valid_until: DATE }, { valid_until: OLD },
  ]) {
    const result = evaluate(request(changes));
    assert.equal(result.request_state, 'refused');
    assert.equal(first(result).fit, 'refused');
    assert.equal(first(result).criteria[0].evidence.length, 0);
  }
});

test('distinct admitted reports remain conflict, even if both happen to meet the request', () => {
  for (const value of [1986, 1975]) {
    const result = first(evaluate(request(), candidate({ claims: [claim(), claim({ observation_id: 'observation-2', value })] })));
    assert.equal(result.fit, 'needs_evidence');
    assert.equal(result.criteria[0].status, 'conflict');
    assert.equal(result.criteria[0].evidence.length, 2);
  }
});

test('a future contradictory canonical report cannot create conflict at an earlier cutoff', () => {
  const result = first(evaluate(request(), candidate({ claims: [claim(), claim({
    observation_id: 'future-observation', value: 1975, observed_at: '2026-10-14T12:00:00.123457Z',
    ingested_at: '2026-10-14T12:00:00.123457Z',
  })] })));
  assert.equal(result.fit, 'criteria_met');
  assert.equal(result.criteria[0].status, 'met');
  assert.equal(result.criteria[0].evidence.find(e => e.observation_id === 'future-observation').disposition, 'excluded');
});

test('duplicates are idempotent, inconsistent observation custody refuses and multi-property observations survive', () => {
  assert.equal(first(evaluate(request(), candidate({ claims: [claim(), claim()] }))).criteria[0].evidence.length, 1);
  assert.throws(() => evaluate(request(), candidate({ claims: [claim(), claim({ value: 1986 })] })), /duplicate observation custody/);
  assert.throws(() => evaluate(request(), candidate({ claims: [claim(), claim({ source_url: 'https://example.com/other' })] })));
  assert.doesNotThrow(() => evaluate(request(), candidate({ claims: [claim(), claim({ property_key: 'make', value: 'Chevrolet' })] })));
});

test('partial coverage cannot qualify fit but independent complete fields remain usable', () => {
  assert.equal(first(evaluate(request(), candidate({ coverage: { status: 'truncated' } }))).fit, 'needs_evidence');
  const c = candidate({ coverage: { status: 'read_failed' }, field_coverage: {
    year: { status: 'complete_current_reader', conflict: false, reasons: [] },
    model: { status: 'read_failed', conflict: false, reasons: ['timeout'] },
  } });
  assert.equal(first(evaluate(request(), c)).fit, 'criteria_met');
  c.field_coverage.year.status = 'read_failed';
  assert.equal(first(evaluate(request(), c)).fit, 'needs_evidence');
});

test('provenance disagreement is conflict and alternatives are not promoted to positive facts', () => {
  const result = first(evaluate(request(), candidate({ field_coverage: {
    year: { status: 'complete_current_reader', conflict: true, reasons: ['canonical_provenance_disagreement'] },
  }, counterevidence: [claim({ observation_id: 'other-observation', value: '1975' })] })));
  assert.equal(result.fit, 'needs_evidence');
  assert.equal(result.criteria[0].status, 'conflict');
  assert.ok(result.criteria[0].evidence.some(e => e.disposition === 'counterevidence_unadjudicated' && e.observation_id === 'other-observation'));
});

test('units and approximate odometer reports do not become exact mileage or true mileage', () => {
  const r = request({ criteria: [criterion({ property_key: 'mileage_miles', operator: 'lte', value: 100000, unit: 'miles' })] });
  const c = candidate({ claims: [claim({ property_key: 'mileage_miles', value: 90000, unit: 'miles' })] });
  assert.equal(first(evaluate(r, c)).fit, 'criteria_met');
  c.claims[0].qualifiers.value_is_approximate = true;
  assert.equal(first(evaluate(r, c)).fit, 'needs_evidence');
  c.claims[0].qualifiers.value_is_approximate = false;
  c.claims[0].unit = 'kilometers';
  assert.equal(first(evaluate(r, c)).fit, 'needs_evidence');
  assert.equal(first(evaluate({ ...r, criteria: [{ ...r.criteria[0], claim_scope: 'true_mileage' }] }, c)).fit, 'needs_evidence');
});

test('unavailable public parent exposes no claim evidence', () => {
  const result = first(evaluate(request(), candidate({ state: 'parent_unavailable' })));
  assert.equal(result.fit, 'refused');
  assert.equal(result.criteria[0].evidence.length, 0);
});

test('captured input replay is stable under input permutation and does not mutate inputs', () => {
  const r = request(), a = candidate({ vehicle_id: 'a', claims: [claim(), claim({ observation_id: 'second' })] });
  const b = candidate({ vehicle_id: 'b', claims: [claim({ value: 1975 })] });
  const before = structuredClone({ r, a, b });
  const result = evaluateRequest(r, [b, a], DATE);
  assert.deepEqual({ r, a, b }, before);
  assert.deepEqual(result, evaluateRequest(r, [{ ...a, claims: [...a.claims].reverse() }, b], DATE));
  assert.deepEqual(result.candidates.map(c => c.vehicle_id), ['a', 'b']);
  assert.equal(result.scope, 'captured_current_reader_input');
});

test('later discriminating evidence changes the current answer while old captured receipt stays reproducible', () => {
  const r = request({ criteria: [criterion({ property_key: 'transmission_type', operator: 'eq', value: 'manual' })] });
  const oldCandidate = candidate({ claims: [] });
  const oldResult = evaluate(r, oldCandidate);
  const newer = candidate({ claims: [claim({ property_key: 'transmission_type', value: 'automatic', observation_id: 'later-evidence' })] });
  assert.equal(first(oldResult).fit, 'needs_evidence');
  assert.equal(first(evaluate(r, newer)).fit, 'criteria_unmet');
  assert.deepEqual(evaluate(r, oldCandidate), oldResult);
});

test('malformed requests and duplicate candidate episodes refuse deterministically', () => {
  for (const changes of [
    { schema_version: 'other' }, { source_ref: '' }, { source_url: 'javascript:void(0)' },
    { criteria: [criterion(), criterion()] }, { criteria: [criterion({ operator: 'execute' })] },
    { criteria: [criterion({ operator: 'between', value: [1989, 1980] })] },
    { criteria: [criterion({ operator: 'in', value: [] })] },
    { criteria: [criterion({ operator: 'eq', value: Infinity })] },
  ]) assert.throws(() => validateRequest(request(changes)));
  assert.throws(() => evaluateRequest(request(), [candidate(), candidate()], DATE), /Duplicate candidate/);
  assert.throws(() => evaluateRequest(request(), [candidate(), candidate({ listing_url: `${URL}&utm_source=x` })], DATE), /Duplicate candidate/);
});
